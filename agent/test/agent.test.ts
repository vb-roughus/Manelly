import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentNetworkList,
  AgentNetworkStatus,
  AgentResourceStatus,
  AgentScheduleStatus,
  AgentStatus,
  ArchivedOriginals,
  ConversionJob,
  ConversionStep,
  ExtractedFolder,
  ExtractedMove,
  HistoryResponse,
  JDownloaderStatus,
  WorkFolderStatus,
} from '@manelly/shared';
import { runConversion } from '../src/convert.js';
import { createRecorder, type Recorder } from '../src/history.js';
import { createNotifier } from '../src/jellyfin.js';
import { createJDownloader, type JDownloader } from '../src/jdownloader.js';
import { createJobQueue, type JobQueue } from '../src/jobs.js';
import { createMover } from '../src/moves.js';
import { createCopyLimiter } from '../src/copyLimit.js';
import { createOriginals } from '../src/originals.js';
import { createNetworkMonitor, type CounterSource, type NetworkMonitor } from '../src/network.js';
import { createResourceMonitor, type ResourceMonitor } from '../src/resources.js';
import { planOutput } from '../src/paths.js';
import { createGate, createSettingsStore } from '../src/schedule.js';
import { createAgentServer } from '../src/server.js';
import { discoverTools, type Tools } from '../src/tools.js';

const TOKEN = 'test-token-0123456789';

/**
 * Stand-ins for ffmpeg, ffprobe, dovi_tool and mkvmerge: they copy their input
 * to their output like the real tools would, and record their arguments.
 * Environment variables make them fail or slow down.
 */
const FAKES: Record<string, string> = {
  ffmpeg: `
    const args = process.argv.slice(2);
    const input = args[args.indexOf('-i') + 1];
    fs.copyFileSync(input, args[args.length - 1]);
    console.log('out_time_us=2000000');
    console.log('progress=end');`,
  ffprobe: `
    const dv = process.env.FAKE_NO_DV ? [] : [{ dv_profile: 7 }];
    const muxed = process.argv[process.argv.length - 1].endsWith('output.mkv');
    const duration = process.env.FAKE_SHORT_MUX && muxed ? '1.0' : '4.0';
    console.log(JSON.stringify({ streams: [{ r_frame_rate: '24000/1001', side_data_list: dv }], format: { duration } }));`,
  dovi_tool: `
    const args = process.argv.slice(2);
    if (process.env.FAKE_DOVI_FAIL) { console.error('Error: no RPU found'); process.exit(1); }
    const done = () => fs.copyFileSync(args[args.indexOf('--discard') + 1], args[args.indexOf('-o') + 1]);
    // Signs of life while it works; a held process leaves none.
    if (process.env.FAKE_DOVI_TICKS) setInterval(() => fs.appendFileSync(process.env.FAKE_DOVI_TICKS, 'x'), 20);
    setTimeout(() => { done(); process.exit(0); }, Number(process.env.FAKE_DOVI_SLEEP || 0));`,
  mkvmerge: `
    const args = process.argv.slice(2);
    fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify(args));
    const out = args[args.indexOf('-o') + 1];
    fs.writeFileSync(out, fs.readFileSync(args[args.indexOf('--no-video') - 1]));
    console.log('#GUI#progress 50%');
    // Ended by something else halfway, as Windows does it: exit code 1, which mkvmerge also uses for warnings.
    if (process.env.FAKE_SHORT_MUX) process.exit(1);
    console.log('#GUI#progress 100%');`,
};

async function createFakeTools(dir: string): Promise<Tools> {
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(FAKES)) {
    const file = path.join(dir, name);
    // Only real work, not the version checks of the tool discovery.
    const record = `if (process.env.FAKE_CALLS && process.argv.length > 3) fs.appendFileSync(process.env.FAKE_CALLS, '${name}\\n');`;
    await writeFile(file, `#!/usr/bin/env node\nconst fs = require('node:fs');\n${record}\n${body}\n`);
    await chmod(file, 0o755);
  }
  return discoverTools({ agentDir: dir, platform: 'linux', env: { PATH: dir } });
}

let root: string;
let media: string;
let source: string;
let baseUrl: string;
let close: () => Promise<void>;
let free = Number.MAX_SAFE_INTEGER;
/** Size of the disk of the work folder. */
const TOTAL = 2_000_000_000_000;
let tools: Tools;
let queue: JobQueue;
let network: NetworkMonitor;
let resources: ResourceMonitor;
let jdownloader: JDownloader;
let recorder: Recorder;

// The network interfaces of the server: one Ethernet adapter whose counters grow by 1 MB per second.
const fakeNetwork: CounterSource = {
  list: async () => [{ id: '{A1}', name: 'Ethernet', description: 'Intel I219-V', type: 'Ethernet', up: true, speedBps: 1e9, addresses: ['192.168.1.2'] }],
  start(ids, _interval, onSample) {
    for (const t of [1000, 2000]) onSample({ t, nics: ids.map((id) => ({ id, rx: t * 100, tx: t * 1000, up: true, speed: 1e9 })) });
    return () => {};
  },
};

// Jellyfin as the agent sees it: a number of streams, and the calls it received.
let streams = 0;
let jellyfinCalls: string[] = [];
const fakeJellyfin: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  jellyfinCalls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
  if (url.pathname === '/Sessions') {
    // Idle sessions (an open app, Manelly itself) have no NowPlayingItem.
    return Response.json([{ DeviceName: 'Manelly' }, ...Array.from({ length: streams }, () => ({ NowPlayingItem: { Name: 'Film' } }))]);
  }
  // JDownloader, for the container files.
  if (url.pathname === '/linkgrabberv2/addContainer') return Response.json({ data: { id: 4242 } });
  return new Response(null, { status: 204 });
};
let clock = new Date(2026, 9, 26, 2, 0);
const PROCESS = { pid: 4711, startedAt: '2026-10-27T02:00:00.000Z', node: 'v22.12.0', execPath: 'C:\\Program Files\\nodejs\\node.exe', autostart: true, port: 8790 };
let exits: string[] = [];
let restartable = false;
// The network drives of a Windows server, and the logins Manelly hands over for them.
let driveLogins: string[] = [];
const fakeDrives = {
  list: async () => [{ letter: 'Z:', remote: '\\\\nas\\filme', connected: false, error: 'Benutzername oder Passwort falsch.', username: null }],
  setCredential: async (server: string, username: string, password: string) => {
    driveLogins.push(`${server} ${username} ${password}`);
    return [{ letter: 'Z:', remote: '\\\\nas\\filme', connected: true, error: null, username }];
  },
  removeCredential: async (server: string) => {
    driveLogins.push(`- ${server}`);
    return fakeDrives.list();
  },
};

// Agents from 0.11.0 update while running; without an updater the runner updates after the exit.
let withUpdater = false;
/** Holds a move in the extraction folder back until resolved. */
let moveHold: Promise<void> = Promise.resolve();
const updates: string[] = [];
const fakeUpdater = {
  progress: () => null,
  start: () => {
    updates.push('start');
    return { step: 'check' as const, steps: ['check' as const], since: '2026-10-27T14:00:00Z', behind: null, subject: null };
  },
};

async function start() {
  tools = await createFakeTools(path.join(root, 'bin'));
  const dataDir = path.join(root, 'data');
  const settings = await createSettingsStore(dataDir);
  const originals = await createOriginals(dataDir);
  queue = await createJobQueue({
    dataDir,
    roots: [],
    tools: async () => tools,
    freeBytes: async () => free,
    gate: createGate({ settings: settings.get, fetch: fakeJellyfin, now: () => clock, quietMs: 0 }),
    tickMs: 0,
    notify: createNotifier(() => settings.get().jellyfin, { fetch: fakeJellyfin }),
    workFolder: () => settings.get().work,
    copyLimit: createCopyLimiter({ settings, fetch: fakeJellyfin }).current,
    originals,
  });
  network = createNetworkMonitor({ source: fakeNetwork, selection: () => settings.get().network, now: () => 2000 });
  resources = createResourceMonitor({ source: { start: () => () => {} }, ownProcesses: () => new Set() });
  jdownloader = createJDownloader({ settings, fetch: fakeJellyfin, tickMs: 0 });
  recorder = createRecorder({ dir: path.join(dataDir, 'history'), settings, resources, network, fetch: fakeJellyfin, now: () => 2500, tickMs: 0 });
  const server = createAgentServer({
    token: TOKEN,
    roots: [],
    queue,
    settings,
    network,
    resources,
    jdownloader,
    recorder,
    tools: async () => tools,
    freeBytes: async () => free,
    totalBytes: async () => TOTAL,
    process: async () => ({ ...PROCESS, restartable, lastUpdate: null }),
    onExit: (how) => void exits.push(how),
    get updater() {
      return withUpdater ? fakeUpdater : undefined;
    },
    drives: fakeDrives,
    originals,
    mover: createMover({
      rename: async (from, to) => {
        await moveHold;
        await rename(from, to);
      },
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = async () => {
    network.stop();
    resources.stop();
    jdownloader.stop();
    recorder.stop();
    await queue.stop();
    await new Promise((resolve) => server.close(resolve));
  };
}

const call = (pathname: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${pathname}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init.headers } });

async function waitFor(id: string, done: (job: ConversionJob) => boolean): Promise<ConversionJob> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await (await call(`/api/jobs/${id}`)).json()) as ConversionJob;
    if (done(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out');
}

const finished = (job: ConversionJob) => !['queued', 'running'].includes(job.state);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manelly-agent-'));
  media = path.join(root, 'Filme', 'Film (2000)');
  await mkdir(media, { recursive: true });
  source = path.join(media, 'Film (2000).mkv');
  await writeFile(source, 'original');
  free = Number.MAX_SAFE_INTEGER;
  streams = 0;
  jellyfinCalls = [];
  driveLogins = [];
  clock = new Date(2026, 9, 26, 2, 0);
  process.env.FAKE_LOG = path.join(root, 'mkvmerge-args.json');
  process.env.FAKE_CALLS = path.join(root, 'calls.txt');
  delete process.env.FAKE_DOVI_FAIL;
  delete process.env.FAKE_DOVI_SLEEP;
  delete process.env.FAKE_DOVI_TICKS;
  delete process.env.FAKE_NO_DV;
  await start();
});

afterEach(async () => {
  await close();
  await rm(root, { recursive: true, force: true });
});

describe('agent', () => {
  it('requires the token, except for the health check', async () => {
    expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/jobs`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/jobs`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    const status = (await (await call('/api/status')).json()) as AgentStatus;
    expect(status.ready).toBe(true);
    expect(status.tools.doviTool.path).toMatch(/dovi_tool$/);
  });

  it('converts a file next to the original and cleans up', async () => {
    const response = await call('/api/jobs', { method: 'POST', body: JSON.stringify({ source, output: { mode: 'alongside' }, title: 'Film' }) });
    expect(response.status).toBe(201);
    const job = await waitFor(((await response.json()) as ConversionJob).id, finished);

    expect(job).toMatchObject({ state: 'done', title: 'Film', progress: 1, output: path.join(media, 'Film (2000) - DV P8.mkv'), error: null });
    // The size of the original, measured when the job was added.
    expect(job.sourceBytes).toBe((await stat(source)).size);
    expect(await readFile(job.output, 'utf8')).toBe('original');
    expect((await readdir(media)).sort()).toEqual(['Film (2000) - DV P8.mkv', 'Film (2000).mkv']);
    // The frame rate from ffprobe keeps the timing; everything but the video comes from the original.
    const args = JSON.parse(await readFile(process.env.FAKE_LOG!, 'utf8')) as string[];
    expect(args).toContain('--default-duration');
    expect(args).toContain('0:24000/1001p');
    expect(args.slice(-2)).toEqual(['--no-video', source]);
  });

  it('never reports an incomplete muxed file as done', async () => {
    process.env.FAKE_SHORT_MUX = '1';
    try {
      const created = (await (await post('/api/jobs', { source, output: { mode: 'replace' } })).json()) as ConversionJob;
      const job = await waitFor(created.id, finished);
      expect(job).toMatchObject({ state: 'failed', error: expect.stringContaining('Die zusammengesetzte Datei ist unvollständig') });
      // The original stays where and as it was; nothing is left behind.
      expect(await readFile(source, 'utf8')).toBe('original');
      expect((await readdir(media)).sort()).toEqual(['Film (2000).mkv']);
    } finally {
      delete process.env.FAKE_SHORT_MUX;
    }
  });

  it('replaces the original and moves it into an ignored backup folder', async () => {
    const created = (await (await call('/api/jobs', { method: 'POST', body: JSON.stringify({ source, output: { mode: 'replace' } }) })).json()) as ConversionJob;
    const job = await waitFor(created.id, finished);
    expect(job).toMatchObject({ state: 'done', output: source, backup: path.join(media, '.manelly-backup', 'Film (2000).mkv') });
    expect((await readdir(path.join(media, '.manelly-backup'))).sort()).toEqual(['.ignore', 'Film (2000).mkv']);
  });

  it('reports what a failing tool said and leaves no temporary files', async () => {
    process.env.FAKE_DOVI_FAIL = '1';
    const created = (await (await call('/api/jobs', { method: 'POST', body: JSON.stringify({ source, output: { mode: 'alongside' } }) })).json()) as ConversionJob;
    const job = await waitFor(created.id, finished);
    expect(job).toMatchObject({ state: 'failed', error: 'dovi_tool ist fehlgeschlagen (Exit-Code 1).' });
    expect(job.log).toContain('no RPU found');
    expect(await readdir(media)).toEqual(['Film (2000).mkv']);
  });

  it('can be canceled while converting', async () => {
    process.env.FAKE_DOVI_SLEEP = '5000';
    const created = (await (await call('/api/jobs', { method: 'POST', body: JSON.stringify({ source, output: { mode: 'alongside' } }) })).json()) as ConversionJob;
    await waitFor(created.id, (job) => job.step === 'convert');
    await call(`/api/jobs/${created.id}/cancel`, { method: 'POST' });
    const job = await waitFor(created.id, finished);
    expect(job.state).toBe('canceled');
    expect(await readdir(media)).toEqual(['Film (2000).mkv']);
    expect((await call(`/api/jobs/${created.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/jobs/${created.id}`)).status).toBe(404);
  });

  it('checks space and Dolby Vision before writing anything', async () => {
    free = 10;
    const lowSpace = (await (await call('/api/jobs', { method: 'POST', body: JSON.stringify({ source, output: { mode: 'alongside' } }) })).json()) as ConversionJob;
    expect((await waitFor(lowSpace.id, finished)).error).toMatch(/^Zu wenig Speicherplatz/);

    free = Number.MAX_SAFE_INTEGER;
    process.env.FAKE_NO_DV = '1';
    const noDv = (await (await call('/api/jobs', { method: 'POST', body: JSON.stringify({ source, output: { mode: 'alongside' } }) })).json()) as ConversionJob;
    expect((await waitFor(noDv.id, finished)).error).toBe('Die Datei enthält kein Dolby Vision.');
    expect(await readdir(media)).toEqual(['Film (2000).mkv']);
  });

  it('refuses invalid requests right away', async () => {
    const response = await call('/api/jobs', { method: 'POST', body: JSON.stringify({ source, output: { mode: 'alongside', fileName: 'x.avi' } }) });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain('.mkv');
  });

  it('reports sizes and free space only for the paths it is given', async () => {
    const response = await call('/api/check', { method: 'POST', body: JSON.stringify({ source, directories: [media] }) });
    expect(await response.json()).toEqual({ sourceBytes: 8, directories: [{ path: media, freeBytes: free }], work: { directory: null, freeBytes: null, totalBytes: null, error: null, copyLimit: { mode: 'off', limitMbps: 400, storageMbps: 1600 } } });
  });

});

const post = (pathname: string, body?: unknown) => call(pathname, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = (pathname: string, body: unknown) => call(pathname, { method: 'PUT', body: JSON.stringify(body) });
const toolCalls = async () => (await readFile(process.env.FAKE_CALLS!, 'utf8').catch(() => '')).split('\n').filter(Boolean);

describe('schedule', () => {
  beforeEach(async () => {
    expect((await put('/api/jellyfin', { url: 'http://jellyfin:8096/', apiKey: 'key' })).status).toBe(204);
    expect((await put('/api/schedule', { window: { start: '01:00', end: '06:00' }, idleOnly: true })).status).toBe(200);
  });

  it('starts scheduled conversions only within the window and while nobody streams', async () => {
    clock = new Date(2026, 9, 26, 12, 0);
    const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, scheduled: true })).json()) as ConversionJob;
    expect(created).toMatchObject({ state: 'queued', scheduled: true });
    await queue.check();
    expect((await waitFor(created.id, () => true)).waitReason).toBe('Wartet auf das Zeitfenster 01:00–06:00.');
    // Outside the window, Jellyfin is left alone.
    expect(jellyfinCalls).toEqual([]);

    clock = new Date(2026, 9, 26, 2, 0);
    streams = 2;
    await queue.check();
    expect((await waitFor(created.id, () => true)).waitReason).toBe('Wartet, bis die 2 laufenden Streams enden.');
    const status = (await (await call('/api/status')).json()) as AgentStatus;
    expect(status.schedule).toMatchObject({ idleOnly: true, jellyfinUrl: 'http://jellyfin:8096', gate: { open: false, streams: 2 } });

    streams = 0;
    await queue.check();
    const job = await waitFor(created.id, finished);
    expect(job).toMatchObject({ state: 'done', interruptions: 0, jellyfinNotified: true });
    expect(jellyfinCalls).toContain('POST /Library/Media/Updated');
  });

  it('pauses when a stream begins and continues after the last finished step', async () => {
    process.env.FAKE_DOVI_SLEEP = '5000';
    const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, scheduled: true })).json()) as ConversionJob;
    await waitFor(created.id, (job) => job.step === 'convert');

    streams = 1;
    await queue.check();
    const paused = await waitFor(created.id, (job) => job.state === 'queued');
    expect(paused).toMatchObject({ interruptions: 1, waitReason: 'Wartet, bis der laufende Stream endet.' });
    // The extracted video waits in the temporary folder.
    const temp = path.join(media, `.manelly-tmp-${created.id}`);
    expect((await readdir(temp)).sort()).toEqual(['.ignore', 'checkpoint.json', 'video.hevc']);

    delete process.env.FAKE_DOVI_SLEEP;
    streams = 0;
    await queue.check();
    const job = await waitFor(created.id, finished);
    expect(job.state).toBe('done');
    // The video was extracted only once; dovi_tool ran again (the first run may have been stopped before it got going);
    // the last ffprobe checks the muxed file.
    expect((await toolCalls()).filter((tool) => tool !== 'dovi_tool')).toEqual(['ffprobe', 'ffmpeg', 'mkvmerge', 'ffprobe']);
    expect((await readdir(media)).sort()).toEqual(['Film (2000) - DV P8.mkv', 'Film (2000).mkv']);
  });

  it('starts a waiting conversion right away on request', async () => {
    clock = new Date(2026, 9, 26, 12, 0);
    const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, scheduled: true })).json()) as ConversionJob;
    const started = (await (await post(`/api/jobs/${created.id}/start`)).json()) as ConversionJob;
    expect(started.scheduled).toBe(false);
    expect((await waitFor(created.id, finished)).state).toBe('done');
  });

  it('waits when Jellyfin is out of reach', async () => {
    expect((await put('/api/jellyfin', { url: 'http://unreachable:8096', apiKey: 'key' })).status).toBe(204);
    const settings = await createSettingsStore(path.join(root, 'data'));
    const gate = createGate({ settings: settings.get, fetch: async () => Promise.reject(new TypeError('fetch failed', { cause: new Error('ENOTFOUND') })), now: () => clock });
    expect(await gate(false)).toMatchObject({ open: false, pause: false, reason: 'Jellyfin ist unter http://unreachable:8096 nicht erreichbar (ENOTFOUND). Ohne Blick auf die Streams startet keine Umwandlung.' });
  });

  it('checks the schedule it is given', async () => {
    expect((await put('/api/schedule', { window: { start: '25:00', end: '06:00' }, idleOnly: true })).status).toBe(400);
    expect((await put('/api/schedule', { window: { start: '06:00', end: '06:00' }, idleOnly: false })).status).toBe(400);
    expect((await put('/api/jellyfin', { url: 'ftp://x', apiKey: 'key' })).status).toBe(400);
    const saved = (await (await put('/api/schedule', { window: null, idleOnly: false })).json()) as AgentScheduleStatus;
    expect(saved).toMatchObject({ window: null, idleOnly: false, jellyfinUrl: 'http://jellyfin:8096' });
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('pause', () => {
  it.skipIf(process.platform === 'win32')('holds the running tool and lets it go on right there', async () => {
    process.env.FAKE_DOVI_SLEEP = '1000';
    process.env.FAKE_DOVI_TICKS = path.join(root, 'ticks');
    const ticks = async () => (await readFile(process.env.FAKE_DOVI_TICKS!, 'utf8').catch(() => '')).length;
    const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' } })).json()) as ConversionJob;
    await waitFor(created.id, (job) => job.step === 'convert');
    await sleep(100);

    expect(await (await post(`/api/jobs/${created.id}/pause`)).json()).toMatchObject({ state: 'running', paused: true });
    await sleep(100);
    const held = await ticks();
    // Longer than dovi_tool needs: held, it neither works nor ends.
    await sleep(1500);
    expect(await ticks()).toBe(held);
    expect(await (await call(`/api/jobs/${created.id}`)).json()).toMatchObject({ state: 'running', step: 'convert', paused: true });

    expect(await (await post(`/api/jobs/${created.id}/resume`)).json()).toMatchObject({ paused: false });
    expect(await waitFor(created.id, finished)).toMatchObject({ state: 'done', interruptions: 0 });
    // Not started again: the same dovi_tool went on.
    expect((await toolCalls()).filter((tool) => tool === 'dovi_tool')).toHaveLength(1);
  });

  it('stays paused across a restart, then goes on after the last finished step', async () => {
    process.env.FAKE_DOVI_SLEEP = '5000';
    const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' } })).json()) as ConversionJob;
    await waitFor(created.id, (job) => job.step === 'convert');
    await post(`/api/jobs/${created.id}/pause`);
    await close();

    delete process.env.FAKE_DOVI_SLEEP;
    const restarted = await createJobQueue({ dataDir: path.join(root, 'data'), roots: [], tools: async () => tools, tickMs: 0 });
    try {
      await sleep(200);
      expect(restarted.get(created.id)).toMatchObject({ state: 'queued', paused: true, interruptions: 1, waitReason: 'Pausiert – geht nach «Fortsetzen» beim zuletzt fertigen Schritt weiter.' });
      await restarted.resume(created.id);
      for (let attempt = 0; attempt < 200 && restarted.get(created.id).state !== 'done'; attempt++) await sleep(25);
      expect(restarted.get(created.id)).toMatchObject({ state: 'done', paused: false });
      // The video was extracted only once.
      expect((await toolCalls()).filter((tool) => tool === 'ffmpeg')).toHaveLength(1);
    } finally {
      await restarted.stop();
    }
  });

  it('stops after the last finished step where a tool cannot be held', async () => {
    process.env.FAKE_DOVI_SLEEP = '5000';
    const dataDir = path.join(root, 'no-suspend');
    const logged: string[] = [];
    const strict = await createJobQueue({
      dataDir,
      roots: [],
      tools: async () => tools,
      tickMs: 0,
      log: (line) => logged.push(line),
      suspend: async () => {
        throw new Error('nicht erlaubt');
      },
    });
    try {
      const { id } = await strict.add({ source, output: { mode: 'alongside' } });
      for (let attempt = 0; attempt < 200 && strict.get(id).step !== 'convert'; attempt++) await sleep(25);
      await strict.pause(id);
      for (let attempt = 0; attempt < 200 && strict.get(id).state !== 'queued'; attempt++) await sleep(25);
      expect(strict.get(id)).toMatchObject({ state: 'queued', paused: true, interruptions: 1 });
      expect(logged.some((line) => line.startsWith('Anhalten ging nicht (nicht erlaubt)'))).toBe(true);

      delete process.env.FAKE_DOVI_SLEEP;
      await strict.resume(id);
      for (let attempt = 0; attempt < 200 && strict.get(id).state !== 'done'; attempt++) await sleep(25);
      expect(strict.get(id).state).toBe('done');
    } finally {
      await strict.stop();
    }
  });
});

describe('work folder', () => {
  it('takes only a folder that is there and takes files', async () => {
    const work = path.join(root, 'work');
    expect(((await (await call('/api/status')).json()) as AgentStatus).work).toEqual({ directory: null, freeBytes: null, totalBytes: null, error: null, copyLimit: { mode: 'off', limitMbps: 400, storageMbps: 1600 } });
    const refused = async (directory: unknown) => {
      const response = await put('/api/work', { directory });
      return [response.status, ((await response.json()) as { error: { message: string } }).error.message];
    };
    expect(await refused('work')).toEqual([400, '«work» ist kein absoluter Pfad, z. B. E:\\Manelly.']);
    expect(await refused(work)).toEqual([404, `Den Ordner ${work} gibt es auf dem Server nicht – zuerst anlegen.`]);
    await mkdir(work);
    const saved = await put('/api/work', { directory: ` ${work} ` });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual<WorkFolderStatus>({ directory: work, freeBytes: free, totalBytes: TOTAL, error: null, copyLimit: { mode: 'off', limitMbps: 400, storageMbps: 1600 } });
    // The write test leaves nothing behind.
    expect(await readdir(work)).toEqual([]);
    expect(((await (await call('/api/status')).json()) as AgentStatus).work?.directory).toBe(work);

    await rm(work, { recursive: true });
    expect(((await (await call('/api/status')).json()) as AgentStatus).work).toMatchObject({ directory: work, freeBytes: null, error: `Den Arbeitsordner ${work} gibt es auf dem Server nicht (mehr).` });
    expect(await (await put('/api/work', { directory: null })).json()).toMatchObject({ directory: null, freeBytes: null, error: null });
  });

  it('keeps copying to and from the work folder to the limit set in Manelly', async () => {
    const work = path.join(root, 'work');
    await mkdir(work);
    await put('/api/work', { directory: work });
    const refused = async (body: unknown) => {
      const response = await put('/api/work/copy-limit', body);
      return [response.status, ((await response.json()) as { error: { message: string } }).error.message];
    };
    const range = 'Die Werte müssen zwischen 1 und 100000 Mbit/s liegen.';
    expect(await refused({ mode: 'sometimes', limitMbps: 400, storageMbps: 1600 })).toEqual([400, 'Unbekannte Art der Begrenzung.']);
    expect(await refused({ mode: 'always', limitMbps: 0, storageMbps: 1600 })).toEqual([400, range]);
    expect(await refused({ mode: 'always', limitMbps: 400, storageMbps: 100_001 })).toEqual([400, range]);
    expect(await refused({ mode: 'streaming', limitMbps: 400 })).toEqual([400, range]);
    // From a Manelly before agent 0.23.0, in MB/s.
    const legacy = await put('/api/work/copy-limit', { mode: 'streaming', limitMBps: 50, storageMBps: 220 });
    expect(((await legacy.json()) as WorkFolderStatus).copyLimit).toEqual({ mode: 'streaming', limitMbps: 419, storageMbps: 1845 });
    const saved = await put('/api/work/copy-limit', { mode: 'always', limitMbps: 8, storageMbps: 1850 });
    expect(((await saved.json()) as WorkFolderStatus).copyLimit).toEqual({ mode: 'always', limitMbps: 8, storageMbps: 1850 });

    // 1.5 MB at 8 Mbit/s (1 000 000 bytes a second): the copy into the work folder takes about one and a half seconds, and the job says why.
    await writeFile(source, Buffer.alloc(1.5 * 1024 * 1024));
    const started = Date.now();
    const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, work: true })).json()) as ConversionJob;
    const copying = await waitFor(created.id, (job) => job.step === 'fetch');
    expect(copying.copyThrottle).toEqual({ bytesPerSecond: 1_000_000, streams: null, streamsBitsPerSecond: null });
    const done = await waitFor(created.id, finished);
    expect(done.state).toBe('done');
    expect(done.copyThrottle).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
  });

  it('copies the original into the work folder, converts there and copies the result back', async () => {
    const work = path.join(root, 'work');
    await mkdir(work);
    // Without a work folder, the request is refused.
    expect((await post('/api/jobs', { source, output: { mode: 'alongside' }, work: true })).status).toBe(400);
    await put('/api/work', { directory: work });

    const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, work: true })).json()) as ConversionJob;
    expect(created.work).toBe(work);
    const job = await waitFor(created.id, finished);
    expect(job).toMatchObject({ state: 'done', output: path.join(media, 'Film (2000) - DV P8.mkv'), backup: null, progress: 1 });
    // Muxed from the copy in the work folder, not from the storage.
    const args = JSON.parse(await readFile(process.env.FAKE_LOG!, 'utf8')) as string[];
    expect(args.slice(-2)).toEqual(['--no-video', path.join(work, `.manelly-tmp-${job.id}`, 'source.mkv')]);
    // Next to the original, the original stays on the storage; nothing is left in the work folder.
    expect(await readdir(work)).toEqual([]);
    expect((await readdir(media)).sort()).toEqual(['Film (2000) - DV P8.mkv', 'Film (2000).mkv']);
    expect(((await (await call('/api/originals')).json()) as ArchivedOriginals).originals).toEqual([]);
  });

  it('keeps a replaced original in the work folder instead of on the storage, until it is deleted', async () => {
    const work = path.join(root, 'work');
    await mkdir(work);
    await put('/api/work', { directory: work });
    const created = (await (await post('/api/jobs', { source, output: { mode: 'replace' }, work: true, title: 'Film (2000)' })).json()) as ConversionJob;
    const archived = path.join(work, 'Originale', 'Film (2000).mkv');
    expect(created.backup).toBe(archived);
    const job = await waitFor(created.id, finished);
    expect(job).toMatchObject({ state: 'done', output: source, backup: archived });
    // The storage holds only the result; the original is in the work folder.
    expect(await readdir(media)).toEqual(['Film (2000).mkv']);
    expect(await readdir(work)).toEqual(['Originale']);
    expect(await readFile(archived, 'utf8')).toBe('original');

    const listed = (await (await call('/api/originals')).json()) as ArchivedOriginals;
    expect(listed).toEqual({ freeBytes: free, originals: [{ id: expect.any(String), title: 'Film (2000)', source, path: archived, bytes: 8, archivedAt: expect.any(String) }] });
    expect(((await (await call('/api/status')).json()) as AgentStatus).originals).toBe(true);

    expect((await call('/api/originals/unknown', { method: 'DELETE' })).status).toBe(404);
    const deleted = await call(`/api/originals/${listed.originals[0]!.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as ArchivedOriginals).originals).toEqual([]);
    expect(await readdir(path.join(work, 'Originale'))).toEqual([]);
  });

  it('forgets an original deleted by hand, and leaves an original alone that changed meanwhile', async () => {
    const work = path.join(root, 'work');
    await mkdir(work);
    await put('/api/work', { directory: work });
    const first = (await (await post('/api/jobs', { source, output: { mode: 'replace' }, work: true })).json()) as ConversionJob;
    await waitFor(first.id, finished);
    await rm(path.join(work, 'Originale', 'Film (2000).mkv'));
    expect(((await (await call('/api/originals')).json()) as ArchivedOriginals).originals).toEqual([]);

    // Someone replaces the file on the storage while it is converted: it is not touched.
    process.env.FAKE_DOVI_SLEEP = '300';
    await writeFile(source, 'original');
    const second = (await (await post('/api/jobs', { source, output: { mode: 'replace' }, work: true })).json()) as ConversionJob;
    await waitFor(second.id, (job) => job.step === 'convert');
    await writeFile(source, 'a newer file');
    const failed = await waitFor(second.id, finished);
    expect(failed.error).toBe(`${source} hat sich während der Umwandlung verändert – das Original bleibt, wie es ist.`);
    expect(await readFile(source, 'utf8')).toBe('a newer file');
    expect(await readdir(path.join(work, 'Originale'))).toEqual([]);
    expect((await readdir(work)).sort()).toEqual(['Originale']);
  });

  it('continues a copy that was interrupted, and goes through every step', async () => {
    const work = path.join(root, 'work');
    const jobId = 'resumed';
    // A pause stopped the copy into the work folder after three bytes.
    await mkdir(path.join(work, `.manelly-tmp-${jobId}`), { recursive: true });
    const plan = await planOutput({ source, output: { mode: 'alongside' }, work: true }, [], 'linux', undefined, work);
    await writeFile(path.join(work, `.manelly-tmp-${jobId}`, 'source.mkv.part'), 'ori');
    const steps: ConversionStep[] = [];
    const result = await runConversion({
      jobId,
      request: { source, output: { mode: 'alongside' }, work: true },
      plan,
      tools,
      signal: new AbortController().signal,
      freeBytes: async () => free,
      onProgress: (step) => void (steps.at(-1) !== step && steps.push(step)),
    });
    expect(await readFile(result.output, 'utf8')).toBe('original');
    expect(steps).toEqual(['fetch', 'probe', 'extract', 'convert', 'mux', 'store', 'finalize']);
    expect(await readdir(work)).toEqual([]);
    expect((await readdir(media)).sort()).toEqual(['Film (2000) - DV P8.mkv', 'Film (2000).mkv']);
  });

  it('checks the space in the work folder, and cleans up a failed conversion there', async () => {
    const work = path.join(root, 'work');
    await mkdir(work);
    await put('/api/work', { directory: work });
    process.env.FAKE_DOVI_FAIL = '1';
    const failed = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, work: true })).json()) as ConversionJob;
    expect((await waitFor(failed.id, finished)).error).toBe('dovi_tool ist fehlgeschlagen (Exit-Code 1).');
    expect(await readdir(work)).toEqual([]);
    expect(await readdir(media)).toEqual(['Film (2000).mkv']);

    delete process.env.FAKE_DOVI_FAIL;
    // Enough at the target for the result, but not in the work folder for the copy and both video streams.
    free = 10;
    const tight = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, work: true })).json()) as ConversionJob;
    expect((await waitFor(tight.id, finished)).error).toMatch(/^Zu wenig Speicherplatz im Arbeitsordner /);
    expect(await readdir(work)).toEqual([]);
  });
});

describe('network drive logins', () => {
  it('takes the login for a server from Manelly and answers with the drives', async () => {
    expect(((await (await call('/api/status')).json()) as AgentStatus).drives).toEqual([
      { letter: 'Z:', remote: '\\\\nas\\filme', connected: false, error: 'Benutzername oder Passwort falsch.', username: null },
    ]);
    const saved = await put('/api/drives/credentials', { server: '\\\\nas', username: ' rolf ', password: 'Grüezi 123' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ drives: [{ letter: 'Z:', remote: '\\\\nas\\filme', connected: true, error: null, username: 'rolf' }] });
    const removed = await call(`/api/drives/credentials?server=${encodeURIComponent('\\\\nas')}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(driveLogins).toEqual(['\\\\nas rolf Grüezi 123', '- \\\\nas']);

    for (const body of [
      { server: 'nas', username: 'rolf', password: 'x' },
      { server: '\\\\nas\\filme', username: 'rolf', password: 'x' },
      { server: '\\\\nas', username: ' ', password: 'x' },
      { server: '\\\\nas', username: 'rolf' },
    ]) {
      expect((await put('/api/drives/credentials', body)).status).toBe(400);
    }
    expect((await call('/api/drives/credentials?server=nas', { method: 'DELETE' })).status).toBe(400);
    expect(driveLogins).toHaveLength(2);
  });
});

describe('network drives', () => {
  /** A drive that refuses the given calls, counted from the first; the first is the check when the job is added. */
  async function queueWithDrive(refuse: (call: number) => boolean) {
    let calls = 0;
    const problem = 'Das Netzlaufwerk Z: (\\\\nas\\filme) ist für den Agent nicht erreichbar: das NAS ist nicht erreichbar (Netzwerkpfad nicht gefunden).';
    const access = { prepare: async () => (refuse(++calls) ? problem : null), networkHint: null };
    const queue = await createJobQueue({ dataDir: path.join(root, 'drives'), roots: [], tools: async () => tools, tickMs: 0, retryMs: 20, access });
    return { queue, problem };
  }

  it('tries again when the drive is not there yet, e.g. right after Windows started', async () => {
    const { queue: drives } = await queueWithDrive((call) => call === 2 || call === 3);
    try {
      const { id } = await drives.add({ source, output: { mode: 'alongside' } });
      for (let attempt = 0; attempt < 200 && drives.get(id).state !== 'done'; attempt++) await sleep(25);
      expect(drives.get(id).state).toBe('done');
    } finally {
      await drives.stop();
    }
  });

  it('fails with the reason when the drive stays away', async () => {
    const { queue: drives, problem } = await queueWithDrive((call) => call > 1);
    try {
      const { id } = await drives.add({ source, output: { mode: 'alongside' } });
      for (let attempt = 0; attempt < 200 && drives.get(id).state !== 'failed'; attempt++) await sleep(25);
      expect(drives.get(id)).toMatchObject({ state: 'failed', error: problem });
      expect(await toolCalls()).toEqual([]);
    } finally {
      await drives.stop();
    }
  });
});

describe('restart', () => {
  it('continues a conversion that a restart interrupted', async () => {
    // A restart during the mux step: the converted video and the checkpoint are there.
    const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, scheduled: true })).json()) as ConversionJob;
    await close();
    const dataDir = path.join(root, 'data');
    const stored = JSON.parse(await readFile(path.join(dataDir, 'jobs.json'), 'utf8')) as Array<{ job: ConversionJob }>;
    const job = stored[0]!.job;
    // The job in the file may already be done; make it look like the restart came during muxing.
    Object.assign(job, { state: 'running', step: 'mux', progress: 0.8, finishedAt: null, interruptions: 0, output: path.join(media, 'Film (2000) - DV P8.mkv') });
    await writeFile(path.join(dataDir, 'jobs.json'), JSON.stringify(stored));
    await rm(job.output, { force: true });
    const temp = path.join(media, `.manelly-tmp-${created.id}`);
    await mkdir(temp, { recursive: true });
    await writeFile(path.join(temp, 'video_p8.hevc'), 'converted');
    await writeFile(path.join(temp, 'checkpoint.json'), JSON.stringify({ done: 'convert', info: { durationMs: 4000, frameRate: '24000/1001', hasDolbyVision: true } }));
    await rm(process.env.FAKE_CALLS!, { force: true });

    const restarted = await createJobQueue({ dataDir, roots: [], tools: async () => tools, tickMs: 0 });
    try {
      for (let attempt = 0; attempt < 200 && restarted.get(created.id).state !== 'done'; attempt++) await new Promise((resolve) => setTimeout(resolve, 25));
      expect(restarted.get(created.id)).toMatchObject({ state: 'done', interruptions: 1 });
      // Muxed again from the converted video, and checked: it plays as long as the original.
      expect(await toolCalls()).toEqual(['mkvmerge', 'ffprobe']);
      expect(await readFile(job.output, 'utf8')).toBe('converted');
      expect(await readdir(media)).not.toContain(`.manelly-tmp-${created.id}`);
    } finally {
      await restarted.stop();
    }
  });

  it('gives up on a conversion after repeated restarts', async () => {
    const dataDir = path.join(root, 'restart');
    await mkdir(dataDir);
    const job = { id: 'j1', title: 'Film', source, mode: 'alongside', output: 'x', backup: null, state: 'running', step: 'convert', progress: 0.5 };
    await writeFile(path.join(dataDir, 'jobs.json'), JSON.stringify([{ job, request: {}, plan: { directory: media }, restarts: 5 }]));
    const restarted = await createJobQueue({ dataDir, roots: [], tools: async () => tools, tickMs: 0 });
    expect(restarted.list()[0]).toMatchObject({ state: 'failed', error: 'Der Agent wurde 5-mal mitten in dieser Umwandlung beendet – sie wird nicht mehr fortgesetzt.' });
    await restarted.stop();
  });
});

describe('network', () => {
  it('monitors the interfaces picked in Manelly', async () => {
    const list = (await (await call('/api/network/interfaces')).json()) as AgentNetworkList;
    expect(list).toMatchObject({ interfaces: [{ id: '{A1}', name: 'Ethernet', speedBps: 1e9 }], selected: [] });
    expect(((await (await call('/api/network')).json()) as AgentNetworkStatus).interfaces).toEqual([]);

    expect((await put('/api/network/interfaces', { interfaces: ['{nope}'] })).status).toBe(400);
    expect((await put('/api/network/interfaces', { interfaces: ['{A1}'] })).status).toBe(200);
    expect(((await (await call('/api/status')).json()) as AgentStatus).network).toEqual({ selected: ['{A1}'] });
    expect(((await (await call('/api/network/interfaces')).json()) as AgentNetworkList).roles).toEqual({ '{A1}': [] });

    const status = (await (await call('/api/network')).json()) as AgentNetworkStatus;
    expect(status.interfaces).toEqual([
      { id: '{A1}', name: 'Ethernet', description: 'Intel I219-V', roles: [], up: true, speedBps: 1e9, rxBps: 800_000, txBps: 8_000_000, history: [{ t: 2000, rxBps: 800_000, txBps: 8_000_000 }] },
    ]);
  });

  it('keeps the roles of the monitored interfaces – several on one, none for the others', async () => {
    const roles = await put('/api/network/interfaces', { interfaces: ['{A1}'], roles: { '{A1}': ['storage', 'streaming', 'storage'], '{B2}': ['management'] } });
    expect(roles.status).toBe(200);
    expect(((await roles.json()) as AgentNetworkList).roles).toEqual({ '{A1}': ['streaming', 'storage'] });
    expect(((await (await call('/api/network')).json()) as AgentNetworkStatus).interfaces[0]?.roles).toEqual(['streaming', 'storage']);

    const refused = async (body: unknown) => {
      const response = await put('/api/network/interfaces', body);
      return [response.status, ((await response.json()) as { error: { message: string } }).error.message];
    };
    expect(await refused({ interfaces: ['{A1}'], roles: { '{A1}': ['backup'] } })).toEqual([400, 'Unbekannte Rolle für Ethernet; möglich sind streaming, management, storage.']);
    expect(await refused({ interfaces: ['{A1}'], roles: { '{A1}': 'storage' } })).toEqual([400, 'Unbekannte Rolle für Ethernet; möglich sind streaming, management, storage.']);
    expect(await refused({ interfaces: ['{A1}'], roles: ['storage'] })).toEqual([400, 'Die Rollen werden je Schnittstelle erwartet.']);
    // A selection without roles keeps them.
    expect(((await (await put('/api/network/interfaces', { interfaces: ['{A1}'] })).json()) as AgentNetworkList).roles).toEqual({ '{A1}': ['streaming', 'storage'] });
    // Kept over a restart.
    expect((await createSettingsStore(path.join(root, 'data'))).get().network[0]?.roles).toEqual(['streaming', 'storage']);
  });
});

describe('resources', () => {
  it('reports CPU and GPU on request', async () => {
    expect(((await (await call('/api/status')).json()) as AgentStatus).resources).toEqual({ supported: true });
    const status = (await (await call('/api/resources')).json()) as AgentResourceStatus;
    expect(status).toMatchObject({ cpu: null, gpus: [], processes: [], intervalMs: 3000, error: null });
  });
});

describe('JDownloader routes', () => {
  it('checks the settings and refuses to control a JDownloader that is switched off', async () => {
    expect(((await (await call('/api/status')).json()) as AgentStatus).jdownloader).toEqual({
      enabled: false,
      linkgrabber: true,
      accounts: true,
      containers: true,
      extracted: true,
      moves: true,
      newFolders: true,
      remove: true,
      extractedDelete: true,
    });
    expect((await post('/api/jdownloader/control', { action: 'start' })).status).toBe(409);
    expect((await call('/api/jdownloader/linkgrabber')).status).toBe(409);
    expect((await call('/api/jdownloader/accounts')).status).toBe(409);
    expect((await post('/api/jdownloader/accounts/refresh', { ids: ['7'] })).status).toBe(400);
    expect((await put('/api/jdownloader/settings', { enabled: true, url: 'ftp://x', throttle: { mode: 'off', limitKBps: 1024 } })).status).toBe(400);
    expect((await put('/api/jdownloader/settings', { enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'fast', limitKBps: 1024 } })).status).toBe(400);
    const saved = await put('/api/jdownloader/settings', { enabled: true, url: 'http://127.0.0.1:3128/', throttle: { mode: 'limit', limitKBps: 2048 } });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as JDownloaderStatus).settings).toEqual({ enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'limit', limitKBps: 2048 }, extractTo: null });
    expect((await post('/api/jdownloader/control', { action: 'jump' })).status).toBe(400);
    expect((await post('/api/jdownloader/linkgrabber/move', { packageIds: [], linkIds: [] })).status).toBe(400);
    expect((await post('/api/jdownloader/linkgrabber/move', { packageIds: ['1'] })).status).toBe(400);
    expect((await post('/api/jdownloader/linkgrabber/remove', { packageIds: [], linkIds: [] })).status).toBe(400);
    expect((await post('/api/jdownloader/downloads/remove', { packageIds: [1], linkIds: [], deleteFiles: 'ja' })).status).toBe(400);
    expect((await post('/api/jdownloader/linkgrabber/remove', { packageIds: [1], linkIds: [] })).status).toBe(200);
    expect((await post('/api/jdownloader/downloads/remove', { packageIds: [1], linkIds: [2], deleteFiles: true })).status).toBe(200);
    expect(jellyfinCalls.filter((entry) => entry.includes('removeLinks') || entry.includes('cleanup'))).toEqual([
      'GET /linkgrabberv2/removeLinks',
      'GET /downloadsV2/cleanup',
    ]);
    expect(await (await call('/api/jdownloader/linkgrabber')).json()).toEqual({ collecting: false, packages: [] });
  });

  it('keeps the extraction folder Manelly names and lists what lies in it', async () => {
    const settings = { enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'off', limitKBps: 1024 } };
    const extracted = path.join(root, 'entpackt');
    const listing = async (folder = '') => (await call(`/api/jdownloader/extracted?path=${encodeURIComponent(folder)}`)).json() as Promise<ExtractedFolder>;
    expect(await listing()).toEqual({ directory: null, path: '', entries: [], freeBytes: null, error: null });

    const missing = await put('/api/jdownloader/settings', { ...settings, extractTo: extracted });
    expect(missing.status).toBe(404);
    await mkdir(path.join(extracted, 'Dune (2024)', 'Sample'), { recursive: true });
    await writeFile(path.join(extracted, 'Dune (2024)', 'Dune.mkv'), '12345678');
    await writeFile(path.join(extracted, 'Dune (2024)', 'Sample', 'sample.mkv'), 'abc');
    await writeFile(path.join(extracted, 'readme.nfo'), 'nfo');
    const saved = await put('/api/jdownloader/settings', { ...settings, extractTo: ` ${extracted} ` });
    expect(((await saved.json()) as JDownloaderStatus).settings.extractTo).toBe(extracted);
    // An older Manelly leaves it out: it stays.
    await put('/api/jdownloader/settings', settings);

    const top = await listing();
    expect(top).toMatchObject({ directory: extracted, path: '', error: null, freeBytes: free });
    expect(top.entries.map(({ name, path: entry, kind, bytes, files, complete }) => ({ name, entry, kind, bytes, files, complete }))).toEqual(
      expect.arrayContaining([
        { name: 'Dune (2024)', entry: 'Dune (2024)', kind: 'directory', bytes: 11, files: 2, complete: true },
        { name: 'readme.nfo', entry: 'readme.nfo', kind: 'file', bytes: 3, files: null, complete: true },
      ]),
    );
    const inside = await listing('Dune (2024)');
    expect(inside.entries.map((entry) => [entry.path, entry.kind])).toEqual([
      ['Dune (2024)/Sample', 'directory'],
      ['Dune (2024)/Dune.mkv', 'file'],
    ]);
    expect(inside.freeBytes).toBeNull();

    // Nothing outside the folder, and a folder that is gone says so.
    expect((await call(`/api/jdownloader/extracted?path=${encodeURIComponent('../data')}`)).status).toBe(400);
    expect((await call(`/api/jdownloader/extracted?path=${encodeURIComponent('Dune (2024)\\..\\..')}`)).status).toBe(400);
    expect((await call('/api/jdownloader/extracted?path=Arrival')).status).toBe(404);
    await rm(extracted, { recursive: true });
    expect((await listing()).error).toBe(`Den Entpack-Ordner ${extracted} gibt es auf dem Server nicht (mehr).`);

    // Emptied in Manelly: none.
    expect(((await (await put('/api/jdownloader/settings', { ...settings, extractTo: '' })).json()) as JDownloaderStatus).settings.extractTo).toBeNull();
  });

  it('moves entries of the extraction folder into a library, and finds and deletes samples there', async () => {
    const extracted = path.join(root, 'entpackt');
    const library = path.join(root, 'filme');
    await mkdir(path.join(extracted, 'Dune (2024)', 'Sample'), { recursive: true });
    await writeFile(path.join(extracted, 'Dune (2024)', 'Dune.mkv'), 'dune');
    await writeFile(path.join(extracted, 'Dune (2024)', 'Sample', 'dune-sample.mkv'), 'sm');
    await mkdir(library);
    const move = { paths: ['Dune (2024)'], target: library, label: 'Filme' };
    expect(((await (await call('/api/status')).json()) as AgentStatus).jdownloader).toMatchObject({ moves: true, newFolders: true });
    // Without an extraction folder there is nothing to move.
    expect((await post('/api/jdownloader/extracted/move', move)).status).toBe(409);
    await put('/api/jdownloader/settings', { enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'off', limitKBps: 1024 }, extractTo: extracted });

    expect(await (await call('/api/jdownloader/extracted/samples')).json()).toEqual({ samples: [{ path: 'Dune (2024)/Sample/dune-sample.mkv', bytes: 2 }] });
    const deleted = await post('/api/jdownloader/extracted/samples/delete', { paths: ['Dune (2024)/Sample/dune-sample.mkv'] });
    expect(await deleted.json()).toEqual({ deleted: ['Dune (2024)/Sample/dune-sample.mkv'], problems: [] });
    expect((await post('/api/jdownloader/extracted/samples/delete', { paths: [] })).status).toBe(400);
    expect((await post('/api/jdownloader/extracted/delete', { paths: [] })).status).toBe(400);
    await writeFile(path.join(extracted, 'alt.nfo'), 'nfo');
    const removed = await post('/api/jdownloader/extracted/delete', { paths: ['alt.nfo', '../filme'] });
    expect(await removed.json()).toEqual({ deleted: ['alt.nfo'], problems: [{ path: '../filme', error: 'Ungültiger Ordner im Entpack-Ordner.' }] });

    expect((await post('/api/jdownloader/extracted/move', { ...move, target: path.join(root, 'gibts-nicht') })).status).toBe(404);
    expect((await post('/api/jdownloader/extracted/move', { ...move, label: '' })).status).toBe(400);
    expect((await post('/api/jdownloader/extracted/move', { ...move, paths: ['../filme'] })).status).toBe(400);
    // A new folder: only a valid name, in a folder that is there.
    const refusedFolder = async (target: string) => {
      const response = await post('/api/jdownloader/extracted/move', { ...move, target, create: true });
      return [response.status, ((await response.json()) as { error: { message: string } }).error.message];
    };
    expect(await refusedFolder(path.join(root, 'gibts-nicht', 'Dune'))).toEqual([404, `Den Ordner ${path.join(root, 'gibts-nicht')} gibt es auf dem Server nicht – zuerst anlegen.`]);
    expect(await refusedFolder(`${library}/..`)).toEqual([400, '«..» ist kein gültiger Ordnername.']);
    expect(await refusedFolder(path.join(library, 'Dune: Part Two'))).toEqual([400, '«Dune: Part Two» ist kein gültiger Ordnername.']);

    // A restart would interrupt a move: asked first.
    exits = [];
    restartable = true;
    let release = () => {};
    moveHold = new Promise((resolve) => (release = resolve));
    const started = await post('/api/jdownloader/extracted/move', move);
    expect(started.status).toBe(202);
    const refused = await call('/api/restart', { method: 'POST', body: JSON.stringify({ update: false }) });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
      'Gerade verschiebt der Agent «Dune (2024)» nach Filme (0 %). Ein Neustart würde das unterbrechen – warte, bis es fertig ist, oder bestätige den Neustart.',
    );
    release();
    moveHold = Promise.resolve();
    for (let i = 0; i < 50 && (((await (await call('/api/jdownloader/extracted/moves')).json()) as ExtractedMove[])[0]?.state ?? 'running') === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(((await (await call('/api/jdownloader/extracted/moves')).json()) as ExtractedMove[])[0]).toMatchObject({ state: 'done', paths: ['Dune (2024)'], target: library, label: 'Filme' });
    expect(await readdir(path.join(library, 'Dune (2024)'))).toEqual(['Dune.mkv']);
    expect(exits).toEqual([]);
    restartable = false;

    await writeFile(path.join(extracted, 'Dark.S01E01.mkv'), 'dark');
    const created = await post('/api/jdownloader/extracted/move', { paths: ['Dark.S01E01.mkv'], target: path.join(library, 'Dark'), label: 'Serien › Dark', create: true });
    expect(created.status).toBe(202);
    for (let i = 0; i < 50 && (((await (await call('/api/jdownloader/extracted/moves')).json()) as ExtractedMove[])[0]?.state ?? 'running') !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await readdir(path.join(library, 'Dark'))).toEqual(['Dark.S01E01.mkv']);
  });

  it('hands DLC files to the link grabber', async () => {
    const dlc = { name: 'Dune.dlc', content: Buffer.from('ZGxj').toString('base64') };
    expect((await post('/api/jdownloader/linkgrabber/container', dlc)).status).toBe(409);
    await put('/api/jdownloader/settings', { enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'off', limitKBps: 1024 } });
    const added = await post('/api/jdownloader/linkgrabber/container', dlc);
    expect(added.status).toBe(202);
    expect(await added.json()).toEqual({ added: 'Dune.dlc' });
    expect(jellyfinCalls).toContain('POST /linkgrabberv2/addContainer');

    const refused = async (body: unknown) => {
      const response = await post('/api/jdownloader/linkgrabber/container', body);
      return [response.status, ((await response.json()) as { error: { message: string } }).error.message];
    };
    expect(await refused({ ...dlc, name: 'Dune.txt' })).toEqual([400, 'Dune.txt ist keine DLC-Datei.']);
    expect(await refused({ ...dlc, content: 'kein base64!' })).toEqual([400, 'Name und Inhalt der Datei (base64) erwartet.']);
    expect(await refused({ name: 'Dune.dlc' })).toEqual([400, 'Name und Inhalt der Datei (base64) erwartet.']);
    expect(await refused({ ...dlc, content: Buffer.alloc(1024 * 1024 + 1).toString('base64') })).toEqual([413, 'Dune.dlc ist zu gross (höchstens 1 MB).']);
    expect((await post('/api/jdownloader/linkgrabber/container', { ...dlc, content: 'A'.repeat(2 * 1024 * 1024) })).status).toBe(413);
  });
});

describe('history routes', () => {
  it('records once switched on, and answers for a range', async () => {
    const status = (await (await call('/api/status')).json()) as AgentStatus;
    expect(status.history).toEqual({ enabled: false });
    await call('/api/jellyfin', { method: 'PUT', body: JSON.stringify({ url: 'http://jellyfin:8096', apiKey: 'key' }) });
    await call('/api/network/interfaces', { method: 'PUT', body: JSON.stringify({ interfaces: ['{A1}'] }) });
    network.status();
    streams = 1;

    expect((await call('/api/history/settings', { method: 'PUT', body: JSON.stringify({ enabled: true, retentionDays: 0 }) })).status).toBe(400);
    const saved = await call('/api/history/settings', { method: 'PUT', body: JSON.stringify({ enabled: true, retentionDays: 7 }) });
    expect(await saved.json()).toEqual({ enabled: true, retentionDays: 7 });

    const history = (await (await call('/api/history?from=0&to=60000')).json()) as HistoryResponse;
    expect(history.points).toMatchObject([{ t: 0, cpu: null, streams: 1, transcodes: 0, network: { '{A1}': { rx: 800_000, tx: 8_000_000 } } }]);
    expect(history.streams).toMatchObject([{ start: 2500, ongoing: true, phases: [{ type: 'start', title: 'Film', method: 'DirectPlay' }] }]);
    expect(history.interfaces).toEqual([{ id: '{A1}', name: 'Ethernet' }]);

    expect((await call('/api/history?from=10&to=5')).status).toBe(400);
    expect((await call('/api/history', { method: 'DELETE' })).status).toBe(204);
    expect(((await (await call('/api/history?from=0&to=60000')).json()) as HistoryResponse).points).toEqual([]);
  });
});

describe('process', () => {
  it('tells its version without the key, and its process with it', async () => {
    expect(await (await fetch(`${baseUrl}/api/health`)).json()).toEqual({ status: 'ok', version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    expect(((await (await call('/api/status')).json()) as AgentStatus).process).toEqual({ ...PROCESS, restartable: false, lastUpdate: null });
  });

  it('ends itself on request, only with the key, after answering', async () => {
    exits = [];
    expect((await fetch(`${baseUrl}/api/shutdown`, { method: 'POST' })).status).toBe(401);
    expect(exits).toEqual([]);
    const response = await call('/api/shutdown', { method: 'POST' });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ stopping: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(exits).toEqual(['stop']);
  });

  it('restarts, with an update first if asked, only under its runner', async () => {
    exits = [];
    restartable = false;
    const refused = await call('/api/restart', { method: 'POST', body: JSON.stringify({ update: false }) });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/start-agent\.cmd -Install/);

    restartable = true;
    expect((await call('/api/restart', { method: 'POST', body: JSON.stringify({ update: false }) })).status).toBe(202);
    expect((await call('/api/restart', { method: 'POST', body: JSON.stringify({ update: true }) })).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(exits).toEqual(['restart', 'update']);

    // With the updater, an update starts while the agent keeps running; it restarts by itself later.
    withUpdater = true;
    const started = await call('/api/restart', { method: 'POST', body: JSON.stringify({ update: true }) });
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ restarting: false, update: { step: 'check' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updates).toEqual(['start']);
    expect(exits).toEqual(['restart', 'update']);
    withUpdater = false;
    restartable = false;
  });

  it('asks before a restart interrupts a running conversion, and waits for it when the update needs that', async () => {
    exits = [];
    restartable = true;
    process.env.FAKE_DOVI_SLEEP = '400';
    try {
      const created = (await (await post('/api/jobs', { source, output: { mode: 'alongside' }, title: 'Film' })).json()) as ConversionJob;
      await waitFor(created.id, (job) => job.step === 'convert');
      const refused = await call('/api/restart', { method: 'POST', body: JSON.stringify({ update: true }) });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/^Gerade läuft die Umwandlung «Film» \(\d+ %\)\. Ein Neustart würde sie unterbrechen/);
      expect(exits).toEqual([]);
      expect((await call('/api/restart', { method: 'POST', body: JSON.stringify({ update: false, force: true }) })).status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(exits).toEqual(['restart']);

      // Waiting for the running job holds back the next one until the restart.
      const second = path.join(media, 'Zweiter (2001).mkv');
      await writeFile(second, 'original');
      const waited = queue.idle().then(() => queue.list().map((job) => [job.title, job.state]));
      await post('/api/jobs', { source: second, output: { mode: 'alongside' }, title: 'Zweiter' });
      expect(await waited).toEqual([
        ['Zweiter', 'queued'],
        ['Film', 'done'],
      ]);
    } finally {
      delete process.env.FAKE_DOVI_SLEEP;
      restartable = false;
    }
  });
});
