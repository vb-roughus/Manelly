import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionsResponse } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import type { JfSessionInfo } from '../src/jellyfin/types.js';

const JELLYFIN_URL = 'http://jellyfin.test';
const API_KEY = 'test-key';
const ITEM_ID = '0123456789abcdef0123456789abcdef';

const sessions: JfSessionInfo[] = [
  {
    Id: 's1',
    UserName: 'Anna',
    NowPlayingItem: { Id: ITEM_ID, Name: 'Film', Type: 'Movie' },
    PlayState: { PlayMethod: 'DirectPlay' },
  },
  {
    Id: 's2',
    UserName: 'Marco',
    NowPlayingItem: { Id: ITEM_ID, Name: 'Film', Type: 'Movie' },
    PlayState: { PlayMethod: 'Transcode' },
    TranscodingInfo: { IsVideoDirect: false, HardwareAccelerationType: 'vaapi' },
  },
  { Id: 'idle', UserName: 'Lea' },
];

/** Answers like Jellyfin for the few endpoints Manelly calls. */
const fakeJellyfin: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const authorization = new Headers(init?.headers).get('authorization') ?? '';
  if (!authorization.includes(`Token="${API_KEY}"`)) {
    return new Response(null, { status: 401 });
  }
  if (url.pathname === '/System/Info') {
    return Response.json({ Id: 'abc', ServerName: 'Heimkino', Version: '10.11.2' });
  }
  if (url.pathname === '/Sessions') {
    return Response.json(sessions);
  }
  if (url.pathname === `/Items/${ITEM_ID}/Images/Primary`) {
    return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
  }
  if (url.pathname === `/Items/${ITEM_ID}/Images/Thumb`) {
    return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  }
  return new Response(null, { status: 404 });
};

function appWith({ apiKey = API_KEY, staticDir = null as string | null } = {}) {
  const client = createJellyfinClient({ url: JELLYFIN_URL, apiKey }, { fetch: fakeJellyfin });
  return buildApp({ config: { staticDir }, client });
}

describe('API', () => {
  it('returns the running streams', async () => {
    const app = await appWith();
    const response = await app.inject('/api/sessions');
    expect(response.statusCode).toBe(200);

    const body = response.json<SessionsResponse>();
    expect(body.sessions.map((s) => s.user.name)).toEqual(['Anna', 'Marco']);
    expect(body.idleSessions).toBe(1);
    expect(body.summary).toMatchObject({ total: 2, directPlay: 1, transcode: 1, hardwareTranscodes: 1 });
  });

  it('returns server info', async () => {
    const app = await appWith();
    const response = await app.inject('/api/server');
    expect(response.json()).toMatchObject({ name: 'Heimkino', version: '10.11.2', url: JELLYFIN_URL });
  });

  it('reports a rejected API key', async () => {
    const app = await appWith({ apiKey: 'wrong-key' });
    const response = await app.inject('/api/sessions');
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('reports an unreachable server', async () => {
    const app = await buildApp({
      config: { staticDir: null },
      client: createJellyfinClient({ url: 'http://127.0.0.1:1', apiKey: 'x' }),
    });
    const response = await app.inject('/api/sessions');
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: 'UNREACHABLE' } });
  });

  it('explains how to configure Manelly when Jellyfin is not set up', async () => {
    const app = await buildApp({ config: { staticDir: null }, client: null });
    const response = await app.inject('/api/sessions');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok' });
  });
});

describe('image proxy', () => {
  it('proxies item images with long caching for tagged URLs', async () => {
    const app = await appWith();
    const response = await app.inject(`/api/images/items/${ITEM_ID}/Primary?tag=abc123&maxHeight=300`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/svg+xml');
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('refuses to pass through non-image responses', async () => {
    const app = await appWith();
    const response = await app.inject(`/api/images/items/${ITEM_ID}/Thumb`);
    expect(response.statusCode).toBe(502);
  });

  it('rejects ids and image types outside the allowlist', async () => {
    const app = await appWith();
    expect((await app.inject('/api/images/items/../../System/Info/Primary')).statusCode).toBe(404);
    expect((await app.inject(`/api/images/items/${ITEM_ID}/Secret`)).statusCode).toBe(400);
    expect((await app.inject('/api/images/items/not-a-guid/Primary')).statusCode).toBe(400);
  });

  it('passes through missing user images as 404', async () => {
    const app = await appWith();
    const response = await app.inject(`/api/images/users/${ITEM_ID}?tag=abc`);
    expect(response.statusCode).toBe(404);
  });
});

describe('static frontend', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'manelly-static-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>Manelly</title>');
    await writeFile(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the SPA for client-side routes but JSON 404s for unknown API routes', async () => {
    const app = await appWith({ staticDir: dir });

    const page = await app.inject('/media/library');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Manelly</title>');
    expect(page.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject('/assets/app-abc123.js');
    expect(asset.headers['cache-control']).toContain('immutable');

    const api = await app.inject('/api/does-not-exist');
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
