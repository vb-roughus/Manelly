import { createHash, timingSafeEqual } from 'node:crypto';
import { stat, unlink, writeFile } from 'node:fs/promises';
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
  ArchivedOriginals,
  ConversionRequest,
  DriveCredentialRequest,
  ExtractedMoveRequest,
  HardwareTestRequest,
  JDownloaderAction,
  JDownloaderSettings,
  LinkGrabberContainerAnswer,
  LinkGrabberContainerRequest,
  LinkGrabberMoveRequest,
  NetworkDrives,
  NetworkRole,
  WorkFolderRequest,
  WorkFolderStatus,
} from '@manelly/shared';
import { defaultFreeBytes, defaultTotalBytes } from './convert.js';
import type { Drives } from './drives.js';
import { AgentError } from './errors.js';
import { MAX_RANGE_MS, type Recorder } from './history.js';
import { HARDWARE_TESTS, runHardwareTest } from './hwtest.js';
import { AGENT_VERSION } from './jellyfin.js';
import { deleteSamples, findSamples, listExtracted } from './extracted.js';
import type { Mover } from './moves.js';
import { containerType, MAX_CONTAINER_BYTES, type JDownloader } from './jdownloader.js';
import type { JobQueue } from './jobs.js';
import type { Originals } from './originals.js';
import type { NetworkMonitor } from './network.js';
import type { ResourceMonitor } from './resources.js';
import { NETWORK_ROLES, parseCopyLimit, parseHistorySettings, parseJDownloaderSettings, parseJellyfinAccess, parseSchedule, type NetworkSelection, type SettingsStore } from './schedule.js';
import { toolsReady, type Tools } from './tools.js';
import type { Updater } from './updater.js';
import { isWithin, pathApiFor, type PathAccess } from './paths.js';

const MAX_BODY_BYTES = 64 * 1024;
/** A container file comes as base64, a third larger than the file. */
const MAX_CONTAINER_BODY_BYTES = Math.ceil(MAX_CONTAINER_BYTES / 3) * 4 + 4096;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_MONITORED = 16;
const MAX_MOVED = 5000;
/** "\\nas", "\\192.168.1.20": a server, without share. */
const SERVER = /^\\\\[^\\/\s]{1,253}$/;

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
  /** Updates while the agent keeps running, and restarts it afterwards; without it, the runner updates on exit. */
  updater?: Updater;
  /** Connects the network drive a path from Manelly needs (Windows, started without logon). */
  access?: PathAccess;
  /** The originals that conversions in the work folder replaced and kept there. */
  originals?: Pick<Originals, 'list' | 'remove'>;
  /** Moves from the extraction folder into the libraries; from 0.27.0. */
  mover?: Mover;
  /** The user's network drives, whether the agent reaches them, and the logins Manelly hands over for them. */
  drives?: Pick<Drives, 'list' | 'setCredential' | 'removeCredential'>;
  /** Current tools; `refresh` looks for them again, e.g. after installing one. */
  tools: (refresh?: boolean) => Promise<Tools>;
  freeBytes?: (directory: string) => Promise<number | null>;
  totalBytes?: (directory: string) => Promise<number | null>;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Comparing hashes keeps the comparison constant-time regardless of length.
  return given.length > 0 && timingSafeEqual(digest(given), digest(token));
}

async function readJson<T>(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new AgentError(413, 'Anfrage zu gross.');
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
  const { token, roots, queue, settings, network, resources, jdownloader, recorder, tools, freeBytes = defaultFreeBytes, totalBytes = defaultTotalBytes } = options;
  async function networkList(): Promise<AgentNetworkList> {
    const interfaces = await network.list().catch((error: Error) => {
      throw new AgentError(503, error.message);
    });
    const selected = settings.get().network;
    return { interfaces, selected: selected.map((entry) => entry.id), roles: Object.fromEntries(selected.map((entry) => [entry.id, entry.roles])) };
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

  /** The work folder as Manelly set it, with the free space and the size of its disk – or why it cannot be used right now. */
  async function workStatus(): Promise<WorkFolderStatus> {
    const { work: directory, copyLimit } = settings.get();
    if (!directory) return { directory: null, freeBytes: null, totalBytes: null, error: null, copyLimit };
    await options.access?.prepare(directory);
    const there = await stat(directory).then((info) => info.isDirectory(), () => false);
    return there
      ? { directory, freeBytes: await freeBytes(directory), totalBytes: await totalBytes(directory), error: null, copyLimit }
      : { directory, freeBytes: null, totalBytes: null, error: `Den Arbeitsordner ${directory} gibt es auf dem Server nicht (mehr).`, copyLimit };
  }

  /** Only a folder that is there – and takes files when `writable`; nothing is created or searched. */
  async function checkFolder(input: unknown, example: string, writable = true): Promise<string> {
    const folder = typeof input === 'string' ? input.trim() : '';
    if (!folder || folder.length > 400) throw new AgentError(400, `Einen Ordner erwartet, z. B. ${example}.`);
    const api = pathApiFor(folder);
    if (!api.isAbsolute(folder)) throw new AgentError(400, `«${folder}» ist kein absoluter Pfad, z. B. ${example}.`);
    if (roots.length > 0 && !roots.some((root) => isWithin(folder, root, api))) throw new AgentError(403, `${folder} liegt ausserhalb der freigegebenen Ordner.`);
    await options.access?.prepare(folder);
    if (!(await stat(folder).then((info) => info.isDirectory(), () => false))) {
      throw new AgentError(404, `Den Ordner ${folder} gibt es auf dem Server nicht – zuerst anlegen.`);
    }
    if (!writable) return folder;
    const probe = api.join(folder, '.manelly-write-test');
    try {
      await writeFile(probe, '');
      await unlink(probe);
    } catch (error) {
      throw new AgentError(403, `In ${folder} darf der Agent nicht schreiben (${(error as NodeJS.ErrnoException).code ?? 'Fehler'}).`);
    }
    return folder;
  }

  /** The extraction folder from the settings; without one, nothing there can be moved or deleted. */
  function requireExtractTo(): string {
    const directory = settings.get().jdownloader.extractTo;
    if (!directory) throw new AgentError(409, 'In den JDownloader-Einstellungen ist kein Entpack-Ordner festgelegt.');
    return directory;
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
        jdownloader: { enabled: settings.get().jdownloader.enabled, linkgrabber: true, accounts: true, containers: true, extracted: true, moves: Boolean(options.mover) },
        history: { enabled: settings.get().history.enabled },
        process: await options.process(),
        drives: (await options.drives?.list()) ?? [],
        work: await workStatus(),
        originals: Boolean(options.originals),
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
      // The network drives of these paths first, as for a conversion.
      for (const path of [body.source, ...(Array.isArray(body.directories) ? body.directories.slice(0, 50) : [])]) {
        if (typeof path === 'string') await options.access?.prepare(path);
      }
      const sourceBytes = typeof body.source === 'string' ? await stat(body.source).then((info) => (info.isFile() ? info.size : null), () => null) : null;
      // Only the free space of the folders Manelly names – nothing is listed or searched.
      const directories = await Promise.all(
        (Array.isArray(body.directories) ? body.directories.slice(0, 50) : []).map(async (path) => ({
          path,
          freeBytes: typeof path === 'string' ? await freeBytes(path) : null,
        })),
      );
      const result: AgentCheckResponse = { sourceBytes, directories, work: await workStatus() };
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
    if (route === 'GET /api/jdownloader') return send(response, 200, await jdownloader.status(url.searchParams.get('links') === '1'));
    if (route === 'PUT /api/jdownloader/settings') {
      const body = await readJson<Partial<JDownloaderSettings>>(request);
      const parsed = parseJDownloaderSettings(body);
      // Left out (an older Manelly): keep the extraction folder; empty: none.
      const extractTo =
        body.extractTo === undefined
          ? (settings.get().jdownloader.extractTo ?? null)
          : parsed.extractTo === null
            ? null
            : await checkFolder(parsed.extractTo, 'D:\\Downloads\\Entpackt', false);
      await settings.setJDownloader({ ...parsed, extractTo });
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
      const { update, force } = await readJson<Partial<AgentRestartRequest>>(request);
      if (!(await options.process()).restartable) {
        throw new AgentError(409, 'Der Agent läuft ohne scripts\\run-agent.ps1 und kann sich nicht neu starten. Einmal scripts\\start-agent.cmd -Install als Administrator ausführen.');
      }
      // A restart pauses a running conversion; it continues afterwards, but only when asked to.
      const busy = queue.running();
      if (busy && force !== true) {
        const progress = busy.progress === null ? '' : ` (${Math.round(busy.progress * 100)} %)`;
        throw new AgentError(409, `Gerade läuft die Umwandlung «${busy.title}»${progress}. Ein Neustart würde sie unterbrechen – warte, bis sie fertig ist, oder bestätige den Neustart.`);
      }
      const moving = options.mover?.running();
      if (moving && force !== true) {
        const progress = moving.bytesTotal ? ` (${Math.round((moving.bytesDone / moving.bytesTotal) * 100)} %)` : '';
        throw new AgentError(409, `Gerade verschiebt der Agent «${moving.paths[0]}» nach ${moving.label}${progress}. Ein Neustart würde das unterbrechen – warte, bis es fertig ist, oder bestätige den Neustart.`);
      }
      // Looks for a newer version first and keeps answering meanwhile; restarts only when there was one.
      if (update === true && options.updater) return send(response, 202, { restarting: false, update: options.updater.start({ force: force === true }) });
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
    if (route === 'GET /api/jdownloader/extracted/moves' && options.mover) return send(response, 200, options.mover.list());
    if (route === 'POST /api/jdownloader/extracted/move' && options.mover) {
      const directory = requireExtractTo();
      const { paths, target, label } = await readJson<Partial<ExtractedMoveRequest>>(request);
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > 500 || paths.some((path) => typeof path !== 'string') || typeof label !== 'string' || !label.trim()) {
        throw new AgentError(400, 'Einträge, Zielordner und Mediathek erwartet.');
      }
      await options.access?.prepare(directory);
      const folder = await checkFolder(target, 'D:\\Filme');
      return send(response, 202, await options.mover.add(directory, paths, folder, label.trim()));
    }
    if (route === 'GET /api/jdownloader/extracted/samples') {
      const directory = requireExtractTo();
      await options.access?.prepare(directory);
      return send(response, 200, await findSamples(directory));
    }
    if (route === 'POST /api/jdownloader/extracted/samples/delete') {
      const directory = requireExtractTo();
      const { paths } = await readJson<{ paths?: unknown }>(request);
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > 2000 || paths.some((path) => typeof path !== 'string')) throw new AgentError(400, 'Die Samples zum Löschen erwartet.');
      await options.access?.prepare(directory);
      return send(response, 200, await deleteSamples(directory, paths as string[]));
    }
    if (route === 'GET /api/jdownloader/extracted') {
      const directory = settings.get().jdownloader.extractTo ?? null;
      if (directory) await options.access?.prepare(directory);
      return send(response, 200, await listExtracted(directory, url.searchParams.get('path') ?? '', freeBytes));
    }
    if (route === 'GET /api/jdownloader/linkgrabber') return send(response, 200, await jdownloaderCall(() => jdownloader.linkgrabber()));
    if (route === 'GET /api/jdownloader/accounts') return send(response, 200, await jdownloaderCall(() => jdownloader.accounts()));
    if (route === 'POST /api/jdownloader/accounts/refresh') {
      const { ids } = await readJson<{ ids?: unknown }>(request);
      if (!Array.isArray(ids) || ids.length > MAX_MOVED || !ids.every((id) => Number.isSafeInteger(id))) throw new AgentError(400, 'Ungültige Accounts.');
      const all = ids.length ? (ids as number[]) : (await jdownloaderCall(() => jdownloader.accounts())).accounts.map((account) => account.id);
      await jdownloaderCall(() => jdownloader.refreshAccounts(all));
      return send(response, 202, { refreshing: all.length });
    }
    if (route === 'POST /api/jdownloader/linkgrabber/move') {
      const body = await readJson<Partial<LinkGrabberMoveRequest>>(request);
      const ids = (value: unknown) => (Array.isArray(value) && value.length <= MAX_MOVED && value.every((id) => Number.isSafeInteger(id)) ? (value as number[]) : null);
      const packageIds = ids(body.packageIds ?? []);
      const linkIds = ids(body.linkIds ?? []);
      if (!packageIds || !linkIds || packageIds.length + linkIds.length === 0) throw new AgentError(400, 'Keine Pakete oder Links zum Übernehmen angegeben.');
      await jdownloaderCall(() => jdownloader.moveToDownloads(packageIds, linkIds));
      return send(response, 200, await jdownloaderCall(() => jdownloader.linkgrabber()));
    }
    if (route === 'POST /api/jdownloader/linkgrabber/container') {
      const { name, content } = await readJson<Partial<LinkGrabberContainerRequest>>(request, MAX_CONTAINER_BODY_BYTES);
      if (typeof name !== 'string' || !name || name.length > 255 || typeof content !== 'string' || !content || !BASE64.test(content)) {
        throw new AgentError(400, 'Name und Inhalt der Datei (base64) erwartet.');
      }
      const type = containerType(name);
      if (!type) throw new AgentError(400, `${name} ist keine DLC-Datei.`);
      const file = Buffer.from(content, 'base64');
      if (file.length > MAX_CONTAINER_BYTES) throw new AgentError(413, `${name} ist zu gross (höchstens 1 MB).`);
      await jdownloaderCall(() => jdownloader.addContainer(type, file));
      const answer: LinkGrabberContainerAnswer = { added: name };
      return send(response, 202, answer);
    }
    if (route === 'GET /api/originals') {
      const work = await workStatus();
      const answer: ArchivedOriginals = { originals: (await options.originals?.list()) ?? [], freeBytes: work.freeBytes };
      return send(response, 200, answer);
    }
    const original = url.pathname.match(/^\/api\/originals\/([\w-]+)$/);
    if (original && request.method === 'DELETE') {
      if (!options.originals) throw new AgentError(404, 'Dieses Original gibt es nicht (mehr).');
      await options.originals.remove(original[1]!);
      const answer: ArchivedOriginals = { originals: await options.originals.list(), freeBytes: (await workStatus()).freeBytes };
      return send(response, 200, answer);
    }
    if (route === 'PUT /api/work') {
      const { directory } = await readJson<Partial<WorkFolderRequest>>(request);
      await settings.setWork(directory === null ? null : await checkFolder(directory, 'E:\\Manelly'));
      return send(response, 200, await workStatus());
    }
    if (route === 'PUT /api/work/copy-limit') {
      await settings.setCopyLimit(parseCopyLimit(await readJson(request)));
      return send(response, 200, await workStatus());
    }
    if (route === 'PUT /api/drives/credentials') {
      const { server, username, password } = await readJson<Partial<DriveCredentialRequest>>(request);
      if (typeof server !== 'string' || !SERVER.test(server) || typeof username !== 'string' || !username.trim() || username.length > 256 || typeof password !== 'string' || password.length > 256) {
        throw new AgentError(400, 'Server (z. B. \\\\nas), Benutzername und Passwort erwartet.');
      }
      if (!options.drives) throw new AgentError(400, 'Netzlaufwerke verbindet der Agent nur unter Windows.');
      const answer: NetworkDrives = { drives: await options.drives.setCredential(server, username.trim(), password) };
      return send(response, 200, answer);
    }
    if (route === 'DELETE /api/drives/credentials') {
      const server = url.searchParams.get('server') ?? '';
      if (!SERVER.test(server)) throw new AgentError(400, 'Server (z. B. \\\\nas) erwartet.');
      if (!options.drives) throw new AgentError(400, 'Netzlaufwerke verbindet der Agent nur unter Windows.');
      const answer: NetworkDrives = { drives: await options.drives.removeCredential(server) };
      return send(response, 200, answer);
    }
    if (route === 'GET /api/network/interfaces') return send(response, 200, await networkList());
    if (route === 'PUT /api/network/interfaces') {
      const body = await readJson<{ interfaces?: unknown; roles?: unknown }>(request);
      const ids = Array.isArray(body.interfaces) ? [...new Set(body.interfaces.filter((id): id is string => typeof id === 'string'))] : null;
      if (!ids || ids.length > MAX_MONITORED) throw new AgentError(400, `Eine Liste von höchstens ${MAX_MONITORED} Schnittstellen erwartet.`);
      // Without roles (Manelly before agent 0.19.0) the interfaces keep theirs.
      const kept = Object.fromEntries(settings.get().network.map((entry) => [entry.id, entry.roles]));
      const roles = body.roles ?? kept;
      if (typeof roles !== 'object' || Array.isArray(roles)) throw new AgentError(400, 'Die Rollen werden je Schnittstelle erwartet.');
      // Only interfaces this machine has; their names are kept for the display.
      const available = ids.length ? await network.list() : [];
      const selection = ids.map((id): NetworkSelection => {
        const nic = available.find((candidate) => candidate.id === id);
        if (!nic) throw new AgentError(400, 'Diese Netzwerkschnittstelle gibt es auf dem Server nicht (mehr).');
        const wanted = (roles as Record<string, unknown>)[id] ?? [];
        if (!Array.isArray(wanted) || wanted.some((role) => !NETWORK_ROLES.includes(role as NetworkRole))) {
          throw new AgentError(400, `Unbekannte Rolle für ${nic.name}; möglich sind ${NETWORK_ROLES.join(', ')}.`);
        }
        return { id: nic.id, name: nic.name, description: nic.description, roles: NETWORK_ROLES.filter((role) => wanted.includes(role)) };
      });
      await settings.setNetwork(selection);
      network.restart();
      return send(response, 200, await networkList());
    }
    if (route === 'GET /api/jobs') return send(response, 200, queue.list());
    if (route === 'POST /api/jobs') return send(response, 201, await queue.add(await readJson<ConversionRequest>(request)));

    const job = url.pathname.match(/^\/api\/jobs\/([\w-]+)(\/cancel|\/start|\/pause|\/resume)?$/);
    if (job && request.method === 'GET' && !job[2]) return send(response, 200, queue.get(job[1]!));
    if (job && request.method === 'POST' && job[2] === '/cancel') return send(response, 200, queue.cancel(job[1]!));
    if (job && request.method === 'POST' && job[2] === '/start') return send(response, 200, queue.startNow(job[1]!));
    if (job && request.method === 'POST' && job[2] === '/pause') return send(response, 200, await queue.pause(job[1]!));
    if (job && request.method === 'POST' && job[2] === '/resume') return send(response, 200, await queue.resume(job[1]!));
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
