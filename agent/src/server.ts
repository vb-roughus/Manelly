import { createHash, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import type { AgentCheckRequest, AgentCheckResponse, AgentScheduleStatus, AgentStatus, ConversionRequest, HardwareTestRequest } from '@manelly/shared';
import { defaultFreeBytes } from './convert.js';
import { AgentError } from './errors.js';
import { HARDWARE_TESTS, runHardwareTest } from './hwtest.js';
import { AGENT_VERSION } from './jellyfin.js';
import type { JobQueue } from './jobs.js';
import { parseJellyfinAccess, parseSchedule, type SettingsStore } from './schedule.js';
import { toolsReady, type Tools } from './tools.js';

const MAX_BODY_BYTES = 64 * 1024;

export interface AgentServerOptions {
  token: string;
  roots: string[];
  queue: JobQueue;
  settings: SettingsStore;
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
export function createAgentServer({ token, roots, queue, settings, tools, freeBytes = defaultFreeBytes }: AgentServerOptions) {
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

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://agent');
    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /api/health') return send(response, 200, { status: 'ok' });
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
