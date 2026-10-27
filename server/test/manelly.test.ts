import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ManellyStatus } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import { createManellyProcess, readCommit, readUpdateReport } from '../src/manelly.js';

const COMMIT = '24b94a106ea60a89dcbe5df74e8ea0d67f00e829';

async function checkout(head: string, files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'manelly-root-'));
  await mkdir(join(root, '.git', 'refs', 'heads'), { recursive: true });
  await writeFile(join(root, '.git', 'HEAD'), `${head}\n`);
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, '.git', path), content);
  return root;
}

/** A stand-in for scripts/update.mjs: finds nothing new and writes its report. */
async function upToDateScript(dataDir: string) {
  const script = join(dataDir, 'update.mjs');
  await writeFile(
    script,
    `import { writeFileSync } from 'node:fs';
const done = { event: 'done', at: '2026-10-27T14:10:00Z', ok: true, upToDate: true, from: '24b94a1', to: '24b94a1', message: 'Schon auf dem neuesten Stand (24b94a1).' };
process.stdout.write(JSON.stringify({ event: 'step', step: 'check' }) + '\\n');
await new Promise((r) => setTimeout(r, 100));
process.stdout.write(JSON.stringify(done) + '\\n');
writeFileSync(process.argv[2], JSON.stringify(done));`,
  );
  return script;
}

async function app(env: NodeJS.ProcessEnv, exits: number[] = []) {
  const root = await checkout('ref: refs/heads/main', { 'refs/heads/main': `${COMMIT}\n` });
  const dataDir = await mkdtemp(join(tmpdir(), 'manelly-data-'));
  const connection = await createConnection({
    store: { load: async () => null, save: async () => {} },
    envSettings: null,
    createClient: (settings) => createJellyfinClient(settings),
  });
  const manelly = await createManellyProcess({
    root,
    dataDir,
    port: 3000,
    env,
    onExit: (code) => exits.push(code),
    log: () => {},
    updateScript: await upToDateScript(dataDir),
  });
  return buildApp({ config: { staticDir: null }, connection, manelly });
}

describe('readCommit', () => {
  it('follows HEAD to the branch, also when it is packed', async () => {
    expect(await readCommit(await checkout('ref: refs/heads/main', { 'refs/heads/main': `${COMMIT}\n` }))).toBe('24b94a1');
    expect(await readCommit(await checkout('ref: refs/heads/main', { 'packed-refs': `# pack-refs with: peeled\n${COMMIT} refs/heads/main\n` }))).toBe('24b94a1');
    expect(await readCommit(await checkout(COMMIT))).toBe('24b94a1');
  });

  it('is null outside a checkout', async () => {
    expect(await readCommit(await mkdtemp(join(tmpdir(), 'manelly-plain-')))).toBeNull();
  });
});

describe('readUpdateReport', () => {
  it('reads what the update wrote, with or without BOM', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'manelly-update-')), 'update.json');
    await writeFile(file, '﻿{"at":"2026-10-27T14:00:00Z","ok":true,"from":"c76436b","to":"24b94a1","message":"Aktualisiert von c76436b auf 24b94a1."}');
    expect(await readUpdateReport(file)).toEqual({ at: '2026-10-27T14:00:00Z', ok: true, upToDate: false, from: 'c76436b', to: '24b94a1', message: 'Aktualisiert von c76436b auf 24b94a1.' });
    await writeFile(file, '{"message":"kaputt"}');
    expect(await readUpdateReport(file)).toBeNull();
    expect(await readUpdateReport(null)).toBeNull();
  });
});

describe('/api/manelly', () => {
  it('tells what runs and whether it can restart', async () => {
    const server = await app({});
    const status = (await server.inject({ method: 'GET', url: '/api/manelly' })).json<ManellyStatus>();
    expect(status).toMatchObject({ commit: '24b94a1', pid: process.pid, port: 3000, restartable: false, lastUpdate: null });
  });

  it('restarts only under a start script, and ends after answering', async () => {
    const exits: number[] = [];
    const refused = await app({}, exits);
    const response = await refused.inject({ method: 'POST', url: '/api/manelly/restart', payload: { update: true } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/start-mac\.sh/);

    const supervised = await app({ MANELLY_SUPERVISED: '1' }, exits);
    expect((await supervised.inject({ method: 'POST', url: '/api/manelly/restart', payload: { update: false } })).statusCode).toBe(202);
    expect(exits).toEqual([75]);
  });

  it('updates while running, and stays when there is nothing new', async () => {
    const exits: number[] = [];
    const server = await app({ MANELLY_SUPERVISED: '1' }, exits);
    const started = await server.inject({ method: 'POST', url: '/api/manelly/restart', payload: { update: true } });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ restarting: false, update: { step: 'check', steps: ['check'] } });
    expect((await server.inject({ method: 'GET', url: '/api/manelly' })).json<ManellyStatus>().update).toMatchObject({ step: 'check' });

    let status = (await server.inject({ method: 'GET', url: '/api/manelly' })).json<ManellyStatus>();
    for (let i = 0; i < 100 && status.update; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      status = (await server.inject({ method: 'GET', url: '/api/manelly' })).json<ManellyStatus>();
    }
    expect(status.update).toBeNull();
    expect(status.lastUpdate).toMatchObject({ ok: true, upToDate: true, message: 'Schon auf dem neuesten Stand (24b94a1).' });
    expect(exits).toEqual([]);
  });
});
