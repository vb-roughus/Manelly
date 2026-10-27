import { createHash, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import type {
  AgentCheckRequest,
  AgentCheckResponse,
  AgentNetworkList,
  AgentProcess,
  AgentRestartRequest,
  AgentScheduleStatus,
  AgentStatus,
  ConversionRequest,
  HardwareTestRequest,
  JDownloaderAction,
  LinkGrabberMoveRequest,
} from '@manelly/shared';
import { defaultFreeBytes } from './convert.js';
import { AgentError } from './errors.js';
import { MAX_RANGE_MS, type Recorder } from './history.js';
import { HARDWARE_TESTS, runHardwareTest } from './hwtest.js';
import { AGENT_VERSION } from './jellyfin.js';
import type { JDownloader } from './jdownloader.js';
import type { JobQueue } from './jobs.js';
import type { NetworkMonitor } from './network.js';
import type { ResourceMonitor } from './resources.js';
import { parseHistorySettings, parseJDownloaderSettings, parseJellyfinAccess, parseSchedule, type SettingsStore } from './schedule.js';
import { toolsReady, type Tools } from './tools.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MONITORED = 16;
const MAX_MOVED = 5000;

export interface AgentServerOptions {
  token: string;
  roots: string[];
  queue: JobQueue;
  settings: SettingsStore;
  network: NetworkMonitor;
  resources: ResourceMonitor;
  jdownloader: JDownloader;
  recorder: Recorder;
  process: () => Promise<AgentProcess>;
  /** Ends the agent after the answer went out – for good, or to be started again by its runner. */
  onExit: (how: 'stop' | 'restart' | 'update') => void;
  /** Current tools; `refresh` looks for them again, e.g. after installing one. */
  tools: (refresh?: boolean) => Promise<Tools>;
  freeBytes?: (directory: string) => Promise<number | null>;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Comparing hashes keeps the comparison constant-time regardless of length.
  return given.length > 0 && timingSafeEqual(digest(given), digest(token));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new AgentError(413, 'Anfrage zu gross.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
  } catch {
    throw new AgentError(400, 'Ungültiges JSON.');
  }
}

const isFile = (file: string) => stat(file).then((info) => info.isFile(), () => false);

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

/** The agent's HTTP API. Everything but the health check needs the token from agent.json. */
const JDOWNLOADER_ACTIONS: JDownloaderAction[] = ['start', 'stop', 'pause', 'resume'];

export function createAgentServer(options: AgentServerOptions) {
  const { token, roots, queue, settings, network, resources, jdownloader, recorder, tools, freeBytes = defaultFreeBytes } = options;
  async function networkList(): Promise<AgentNetworkList> {
    const interfaces = await network.list().catch((error: Error) => {
      throw new AgentError(503, error.message);
    });
    return { interfaces, selected: settings.get().network.map((entry) => entry.id) };
  }

  function schedule(): AgentScheduleStatus {
    const { schedule: current, jellyfin } = settings.get();
    const gate = queue.gate();
    return {
      ...current,
      jellyfinUrl: jellyfin?.url ?? null,
      gate: gate && { open: gate.open, reason: gate.reason, streams: gate.streams, checkedAt: gate.checkedAt },
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  /** JDownloader must be switched on in Manelly; its errors are reported as such. */
  async function jdownloaderCall<T>(action: () => Promise<T>): Promise<T> {
    if (!settings.get().jdownloader.enabled) throw new AgentError(409, 'JDownloader ist in Manelly nicht eingeschaltet.');
    try {
      return await action();
    } catch (error) {
      throw new AgentError(502, (error as Error).message);
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://agent');
    const route = `${request.method} ${url.pathname}`;

    // The version lets the install script tell an old agent from the one it just started.
    if (route === 'GET /api/health') return send(response, 200, { status: 'ok', version: AGENT_VERSION });
    if (!authorized(request, token)) throw new AgentError(401, 'Falscher oder fehlender Agent-Schlüssel.');

    if (route === 'GET /api/status') {
      const found = await tools(url.searchParams.get('refresh') === '1');
      const status: AgentStatus = {
        version: AGENT_VERSION,
        hostname: hostname(),
        platform: process.platform,
        tools: found,
        roots,
        ready: toolsReady(found),
        schedule: schedule(),
        network: { selected: settings.get().network.map((entry) => entry.id) },
        resources: { supported: resources.supported },
        jdownloader: { enabled: settings.get().jdownloader.enabled, linkgrabber: true },
        history: { enabled: settings.get().history.enabled },
        process: await options.process(),
      };
      return send(response, 200, status);
    }
    if (route === 'PUT /api/schedule') {
      await settings.setSchedule(parseSchedule(await readJson(request)));
      // Not awaited: asking Jellyfin may take longer than Manelly waits for this answer.
      void queue.check();
      return send(response, 200, schedule());
    }
    if (route === 'PUT /api/jellyfin') {
      await settings.setJellyfin(parseJellyfinAccess(await readJson(request)));
      return send(response, 204, undefined);
    }
    if (route === 'POST /api/check') {
      const body = await readJson<AgentCheckRequest>(request);
      const sourceBytes = typeof body.source === 'string' ? await stat(body.source).then((info) => (info.isFile() ? info.size : null), () => null) : null;
      // Only the free space of the folders Manelly names – nothing is listed or searched.
      const directories = await Promise.all(
        (Array.isArray(body.directories) ? body.directories.slice(0, 50) : []).map(async (path) => ({
          path,
          freeBytes: typeof path === 'string' ? await freeBytes(path) : null,
        })),
      );
      const result: AgentCheckResponse = { sourceBytes, directories };
      return send(response, 200, result);
    }
    if (route === 'POST /api/hwtest') {
      const body = await readJson<HardwareTestRequest>(request);
      const tests = Array.isArray(body.tests) ? body.tests.filter((id) => HARDWARE_TESTS.includes(id)) : [];
      // Jellyfin's own FFmpeg when Manelly names it, otherwise the one the agent found.
      const found = await tools();
      const ffmpegPath = typeof body.ffmpegPath === 'string' && body.ffmpegPath && (await isFile(body.ffmpegPath)) ? body.ffmpegPath : found.ffmpeg.path;
      return send(response, 200, await runHardwareTest({ ...body, tests }, ffmpegPath));
    }
    if (route === 'GET /api/network') return send(response, 200, network.status());
    if (route === 'GET /api/resources') return send(response, 200, resources.status());
    if (route === 'GET /api/jdownloader') return send(response, 200, await jdownloader.status());
    if (route === 'PUT /api/jdownloader/settings') {
      await settings.setJDownloader(parseJDownloaderSettings(await readJson(request)));
      // Turned off or switched to another JDownloader: let go of it now.
      await jdownloader.check();
      return send(response, 200, await jdownloader.status());
    }
    if (route === 'POST /api/jdownloader/control') {
      const { action } = await readJson<{ action?: JDownloaderAction }>(request);
      if (!action || !JDOWNLOADER_ACTIONS.includes(action)) throw new AgentError(400, 'Unbekannte Aktion für JDownloader.');
      await jdownloaderCall(() => jdownloader.control(action));
      return send(response, 200, await jdownloader.status());
    }
    if (route === 'PUT /api/jdownloader/limit') {
      const { enabled, kbps } = await readJson<{ enabled?: boolean; kbps?: number }>(request);
      if (typeof enabled !== 'boolean' || !Number.isInteger(kbps) || kbps! < 1 || kbps! > 10_000_000) throw new AgentError(400, 'Ungültiges Tempo-Limit.');
      await jdownloaderCall(() => jdownloader.setLimit(enabled, kbps! * 1024));
      return send(response, 200, await jdownloader.status());
    }
    if (route === 'POST /api/shutdown') {
      send(response, 202, { stopping: true });
      response.once('finish', () => options.onExit('stop'));
      return;
    }
    if (route === 'POST /api/restart') {
      const { update } = await readJson<Partial<AgentRestartRequest>>(request);
      if (!(await options.process()).restartable) {
        throw new AgentError(409, 'Der Agent läuft ohne scripts\\run-agent.ps1 und kann sich nicht neu starten. Einmal scripts\\start-agent.cmd -Install als Administrator ausführen.');
      }
      send(response, 202, { restarting: true });
      response.once('finish', () => options.onExit(update === true ? 'update' : 'restart'));
      return;
    }
    if (route === 'GET /api/history') {
      const to = Number(url.searchParams.get('to') ?? Date.now());
      const from = Number(url.searchParams.get('from') ?? to - 6 * 3_600_000);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > MAX_RANGE_MS) throw new AgentError(400, 'Ungültiger Zeitraum.');
      return send(response, 200, await recorder.query(from, to));
    }
    if (route === 'PUT /api/history/settings') {
      await settings.setHistory(parseHistorySettings(await readJson(request)));
      // Starts, stops or prunes right away.
      await recorder.tick();
      return send(response, 200, settings.get().history);
    }
    if (route === 'DELETE /api/history') {
      await recorder.clear();
      return send(response, 204, undefined);
    }
    if (route === 'GET /api/jdownloader/linkgrabber') return send(response, 200, await jdownloaderCall(() => jdownloader.linkgrabber()));
    if (route === 'POST /api/jdownloader/linkgrabber/move') {
      const body = await readJson<Partial<LinkGrabberMoveRequest>>(request);
      const ids = (value: unknown) => (Array.isArray(value) && value.length <= MAX_MOVED && value.every((id) => Number.isSafeInteger(id)) ? (value as number[]) : null);
      const packageIds = ids(body.packageIds ?? []);
      const linkIds = ids(body.linkIds ?? []);
      if (!packageIds || !linkIds || packageIds.length + linkIds.length === 0) throw new AgentError(400, 'Keine Pakete oder Links zum Übernehmen angegeben.');
      await jdownloaderCall(() => jdownloader.moveToDownloads(packageIds, linkIds));
      return send(response, 200, await jdownloaderCall(() => jdownloader.linkgrabber()));
    }
    if (route === 'GET /api/network/interfaces') return send(response, 200, await networkList());
    if (route === 'PUT /api/network/interfaces') {
      const body = await readJson<{ interfaces?: unknown }>(request);
      const ids = Array.isArray(body.interfaces) ? [...new Set(body.interfaces.filter((id): id is string => typeof id === 'string'))] : null;
      if (!ids || ids.length > MAX_MONITORED) throw new AgentError(400, `Eine Liste von höchstens ${MAX_MONITORED} Schnittstellen erwartet.`);
      // Only interfaces this machine has; their names are kept for the display.
      const available = ids.length ? await network.list() : [];
      const selection = ids.map((id) => {
        const nic = available.find((candidate) => candidate.id === id);
        if (!nic) throw new AgentError(400, 'Diese Netzwerkschnittstelle gibt es auf dem Server nicht (mehr).');
        return { id: nic.id, name: nic.name, description: nic.description };
      });
      await settings.setNetwork(selection);
      network.restart();
      return send(response, 200, await networkList());
    }
    if (route === 'GET /api/jobs') return send(response, 200, queue.list());
    if (route === 'POST /api/jobs') return send(response, 201, await queue.add(await readJson<ConversionRequest>(request)));

    const job = url.pathname.match(/^\/api\/jobs\/([\w-]+)(\/cancel|\/start)?$/);
    if (job && request.method === 'GET' && !job[2]) return send(response, 200, queue.get(job[1]!));
    if (job && request.method === 'POST' && job[2] === '/cancel') return send(response, 200, queue.cancel(job[1]!));
    if (job && request.method === 'POST' && job[2] === '/start') return send(response, 200, queue.startNow(job[1]!));
    if (job && request.method === 'DELETE' && !job[2]) {
      await queue.remove(job[1]!);
      return send(response, 204, undefined);
    }
    throw new AgentError(404, 'Unbekannter Pfad.');
  }

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      const status = error instanceof AgentError ? error.status : 500;
      send(response, status, { error: { message: error instanceof Error ? error.message : String(error) } });
    });
  });
}
