import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentNetworkList, AgentNetworkStatus, AgentResourceStatus, AgentScheduleStatus, AgentStatus, ConversionJob, HistoryResponse, JDownloaderStatus } from '@manelly/shared';
import { createRecorder, type Recorder } from '../src/history.js';
import { createNotifier } from '../src/jellyfin.js';
import { createJDownloader, type JDownloader } from '../src/jdownloader.js';
import { createJobQueue, type JobQueue } from '../src/jobs.js';
import { createNetworkMonitor, type CounterSource, type NetworkMonitor } from '../src/network.js';
import { createResourceMonitor, type ResourceMonitor } from '../src/resources.js';
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
    console.log(JSON.stringify({ streams: [{ r_frame_rate: '24000/1001', side_data_list: dv }], format: { duration: '4.0' } }));`,
  dovi_tool: `
    const args = process.argv.slice(2);
    if (process.env.FAKE_DOVI_FAIL) { console.error('Error: no RPU found'); process.exit(1); }
    const done = () => fs.copyFileSync(args[args.indexOf('--discard') + 1], args[args.indexOf('-o') + 1]);
    setTimeout(done, Number(process.env.FAKE_DOVI_SLEEP || 0));`,
  mkvmerge: `
    const args = process.argv.slice(2);
    fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify(args));
    const out = args[args.indexOf('-o') + 1];
    fs.writeFileSync(out, fs.readFileSync(args[args.indexOf('--no-video') - 1]));
    console.log('#GUI#progress 50%');
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
  return new Response(null, { status: 204 });
};
let clock = new Date(2026, 9, 26, 2, 0);
const PROCESS = { pid: 4711, startedAt: '2026-10-27T02:00:00.000Z', node: 'v22.12.0', execPath: 'C:\\Program Files\\nodejs\\node.exe', autostart: true, port: 8790 };
let exits: string[] = [];
let restartable = false;
// Agents from 0.11.0 update while running; without an updater the runner updates after the exit.
let withUpdater = false;
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
  queue = await createJobQueue({
    dataDir,
    roots: [],
    tools: async () => tools,
    freeBytes: async () => free,
    gate: createGate({ settings: settings.get, fetch: fakeJellyfin, now: () => clock, quietMs: 0 }),
    tickMs: 0,
    notify: createNotifier(() => settings.get().jellyfin, { fetch: fakeJellyfin }),
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
    process: async () => ({ ...PROCESS, restartable, lastUpdate: null }),
    onExit: (how) => void exits.push(how),
    get updater() {
      return withUpdater ? fakeUpdater : undefined;
    },
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
  clock = new Date(2026, 9, 26, 2, 0);
  process.env.FAKE_LOG = path.join(root, 'mkvmerge-args.json');
  process.env.FAKE_CALLS = path.join(root, 'calls.txt');
  delete process.env.FAKE_DOVI_FAIL;
  delete process.env.FAKE_DOVI_SLEEP;
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
    expect(await readFile(job.output, 'utf8')).toBe('original');
    expect((await readdir(media)).sort()).toEqual(['Film (2000) - DV P8.mkv', 'Film (2000).mkv']);
    // The frame rate from ffprobe keeps the timing; everything but the video comes from the original.
    const args = JSON.parse(await readFile(process.env.FAKE_LOG!, 'utf8')) as string[];
    expect(args).toContain('--default-duration');
    expect(args).toContain('0:24000/1001p');
    expect(args.slice(-2)).toEqual(['--no-video', source]);
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
    expect(await response.json()).toEqual({ sourceBytes: 8, directories: [{ path: media, freeBytes: free }] });
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
    // The video was extracted only once; dovi_tool ran again (the first run may have been stopped before it got going).
    expect((await toolCalls()).filter((tool) => tool !== 'dovi_tool')).toEqual(['ffprobe', 'ffmpeg', 'mkvmerge']);
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
      expect(await toolCalls()).toEqual(['mkvmerge']);
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

    const status = (await (await call('/api/network')).json()) as AgentNetworkStatus;
    expect(status.interfaces).toEqual([
      { id: '{A1}', name: 'Ethernet', description: 'Intel I219-V', up: true, speedBps: 1e9, rxBps: 800_000, txBps: 8_000_000, history: [{ t: 2000, rxBps: 800_000, txBps: 8_000_000 }] },
    ]);
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
    expect(((await (await call('/api/status')).json()) as AgentStatus).jdownloader).toEqual({ enabled: false, linkgrabber: true });
    expect((await post('/api/jdownloader/control', { action: 'start' })).status).toBe(409);
    expect((await call('/api/jdownloader/linkgrabber')).status).toBe(409);
    expect((await put('/api/jdownloader/settings', { enabled: true, url: 'ftp://x', throttle: { mode: 'off', limitKBps: 1024 } })).status).toBe(400);
    expect((await put('/api/jdownloader/settings', { enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'fast', limitKBps: 1024 } })).status).toBe(400);
    const saved = await put('/api/jdownloader/settings', { enabled: true, url: 'http://127.0.0.1:3128/', throttle: { mode: 'limit', limitKBps: 2048 } });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as JDownloaderStatus).settings).toEqual({ enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'limit', limitKBps: 2048 } });
    expect((await post('/api/jdownloader/control', { action: 'jump' })).status).toBe(400);
    expect((await post('/api/jdownloader/linkgrabber/move', { packageIds: [], linkIds: [] })).status).toBe(400);
    expect((await post('/api/jdownloader/linkgrabber/move', { packageIds: ['1'] })).status).toBe(400);
    expect(await (await call('/api/jdownloader/linkgrabber')).json()).toEqual({ collecting: false, packages: [] });
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
});
