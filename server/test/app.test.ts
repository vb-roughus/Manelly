import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionSettings, SaveSettingsResponse, SessionsResponse } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import type { JellyfinConfig } from '../src/config.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import type { JfSessionInfo } from '../src/jellyfin/types.js';
import type { SettingsStore } from '../src/settings.js';

const JELLYFIN_URL = 'http://jellyfin.test';
const API_KEY = '0123456789abcdef0123456789abcd42';
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

/** Answers like Jellyfin at http://jellyfin.test; every other host is unreachable. */
const fakeJellyfin: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.host !== 'jellyfin.test') {
    throw new TypeError('fetch failed', { cause: new Error(`getaddrinfo ENOTFOUND ${url.hostname}`) });
  }
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

function memoryStore(initial: JellyfinConfig | null = null): SettingsStore & { saved: () => JellyfinConfig | null } {
  let saved = initial;
  return {
    saved: () => saved,
    load: async () => saved,
    save: async (settings) => {
      saved = settings;
    },
  };
}

interface SetupOptions {
  saved?: JellyfinConfig | null;
  /** Replaces the in-memory store, e.g. to simulate write errors. */
  store?: SettingsStore;
  env?: JellyfinConfig | null;
  staticDir?: string | null;
  fetch?: typeof fetch;
}

async function setup({ saved = null, store, env = { url: JELLYFIN_URL, apiKey: API_KEY }, staticDir = null, fetch = fakeJellyfin }: SetupOptions = {}) {
  const memory = memoryStore(saved);
  const connection = await createConnection({
    store: store ?? memory,
    envSettings: env,
    createClient: (settings) => createJellyfinClient(settings, { fetch }),
  });
  const app = await buildApp({ config: { staticDir }, connection });
  return { app, store: memory, connection };
}

async function appWith({ apiKey = API_KEY, staticDir = null as string | null } = {}) {
  return (await setup({ env: { url: JELLYFIN_URL, apiKey }, staticDir })).app;
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
    const { app } = await setup({ env: { url: 'http://127.0.0.1:1', apiKey: 'x' }, fetch: globalThis.fetch });
    const response = await app.inject('/api/sessions');
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: 'UNREACHABLE' } });
  });

  it('explains how to configure Manelly when Jellyfin is not set up', async () => {
    const { app } = await setup({ env: null });
    const response = await app.inject('/api/sessions');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok' });
  });
});

describe('settings', () => {
  it('shows the active connection without revealing the API key', async () => {
    const { app } = await setup();
    const response = await app.inject('/api/settings');
    expect(response.json<ConnectionSettings>()).toEqual({
      jellyfinUrl: JELLYFIN_URL,
      apiKeyConfigured: true,
      apiKeyHint: 'cd42',
      source: 'env',
    });
    expect(response.body).not.toContain(API_KEY);
  });

  it('reports a missing connection', async () => {
    const { app } = await setup({ env: null });
    expect((await app.inject('/api/settings')).json()).toEqual({
      jellyfinUrl: null,
      apiKeyConfigured: false,
      apiKeyHint: null,
      source: null,
    });
  });

  it('tests, saves and immediately uses a new connection', async () => {
    const { app, store } = await setup({ env: null });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { jellyfinUrl: 'http://jellyfin.test/', apiKey: ` ${API_KEY} ` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SaveSettingsResponse>();
    expect(body.server).toMatchObject({ name: 'Heimkino', url: JELLYFIN_URL });
    expect(body.settings).toMatchObject({ jellyfinUrl: JELLYFIN_URL, source: 'ui', apiKeyHint: 'cd42' });
    expect(response.body).not.toContain(API_KEY);
    expect(store.saved()).toEqual({ url: JELLYFIN_URL, apiKey: API_KEY });
    expect((await app.inject('/api/sessions')).statusCode).toBe(200);
  });

  it('keeps the saved API key when only the address changes', async () => {
    const { app, store } = await setup();
    const response = await app.inject({ method: 'PUT', url: '/api/settings', payload: { jellyfinUrl: JELLYFIN_URL, apiKey: '' } });
    expect(response.statusCode).toBe(200);
    expect(store.saved()?.apiKey).toBe(API_KEY);
  });

  it('does not save settings that Jellyfin rejects', async () => {
    const { app, store, connection } = await setup({ env: null });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { jellyfinUrl: JELLYFIN_URL, apiKey: 'wrong-key' },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    expect(store.saved()).toBeNull();
    expect(connection.settings).toBeNull();
  });

  it('does not save an unreachable address', async () => {
    const { app, store } = await setup();
    const response = await app.inject({ method: 'PUT', url: '/api/settings', payload: { jellyfinUrl: 'http://down.test:8096' } });
    expect(response.json()).toMatchObject({ error: { code: 'UNREACHABLE' } });
    expect(store.saved()).toBeNull();
  });

  it('explains when the settings cannot be written', async () => {
    const readOnly: SettingsStore = {
      load: async () => null,
      save: async () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const { app, connection } = await setup({ env: null, store: readOnly });
    const response = await app.inject({ method: 'PUT', url: '/api/settings', payload: { jellyfinUrl: JELLYFIN_URL, apiKey: API_KEY } });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(response.json().error.message).toContain('DATA_DIR');
    expect(connection.settings).toBeNull();
  });

  it('rejects invalid input', async () => {
    const { app } = await setup({ env: null });
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', payload });

    const badUrl = await put({ jellyfinUrl: 'ftp://jellyfin.test', apiKey: API_KEY });
    expect(badUrl.statusCode).toBe(400);
    expect(badUrl.json().error.message).toContain('Server-Adresse');

    const noKey = await put({ jellyfinUrl: JELLYFIN_URL });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().error.message).toContain('API-Schlüssel');

    expect((await put({})).statusCode).toBe(400);
  });

  it('prefers settings saved in the UI over environment variables', async () => {
    const { app, connection } = await setup({
      saved: { url: JELLYFIN_URL, apiKey: API_KEY },
      env: { url: 'http://down.test', apiKey: 'old' },
    });
    expect(connection.source).toBe('ui');
    expect((await app.inject('/api/sessions')).statusCode).toBe(200);
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
