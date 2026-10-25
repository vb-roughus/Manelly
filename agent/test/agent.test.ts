import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentStatus, ConversionJob } from '@manelly/shared';
import { createJobQueue } from '../src/jobs.js';
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
    await writeFile(file, `#!/usr/bin/env node\nconst fs = require('node:fs');\n${body}\n`);
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

async function start() {
  const tools = await createFakeTools(path.join(root, 'bin'));
  const queue = await createJobQueue({ dataDir: path.join(root, 'data'), roots: [], tools: async () => tools, freeBytes: async () => free });
  const server = createAgentServer({ token: TOKEN, roots: [], queue, tools: async () => tools, freeBytes: async () => free });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = async () => {
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
  process.env.FAKE_LOG = path.join(root, 'mkvmerge-args.json');
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

  it('marks conversions that were running when the agent stopped as failed', async () => {
    const dataDir = path.join(root, 'restart');
    await mkdir(dataDir);
    const job = { id: 'j1', title: 'Film', source, mode: 'alongside', output: 'x', backup: null, state: 'running', step: 'convert', progress: 0.5 };
    await writeFile(path.join(dataDir, 'jobs.json'), JSON.stringify([{ job, request: {}, plan: {} }]));
    const queue = await createJobQueue({ dataDir, roots: [], tools: async () => (await discoverTools({ agentDir: root })) });
    expect(queue.list()[0]).toMatchObject({ state: 'failed', error: 'Der Agent wurde beendet, bevor die Umwandlung fertig war.' });
  });
});
