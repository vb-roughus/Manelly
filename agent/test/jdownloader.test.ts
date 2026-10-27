import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJDownloader, createJDownloaderApi } from '../src/jdownloader.js';
import { createSettingsStore, type SettingsStore } from '../src/schedule.js';

/** JDownloader's local API and Jellyfin's sessions, as the agent sees them. */
function fakeWorld() {
  const jd = { state: 'RUNNING', limitEnabled: false, limit: 0, streams: 0, up: true, calls: [] as string[] };
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.host === 'jellyfin:8096') {
      return Response.json(Array.from({ length: jd.streams }, () => ({ NowPlayingItem: { Name: 'Film' } })));
    }
    if (!jd.up) throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:3128') });
    jd.calls.push(`${url.pathname}${url.search}`);
    const params = url.search ? url.search.slice(1).split('&').map((param) => JSON.parse(decodeURIComponent(param)) as unknown) : [];
    // Some answers come wrapped, some as they are – the agent takes both.
    const wrapped = (data: unknown) => Response.json({ data });
    switch (url.pathname) {
      case '/downloadcontroller/getCurrentState':
        return wrapped(jd.state);
      case '/downloadcontroller/getSpeedInBps':
        return Response.json(jd.state === 'RUNNING' ? 2_500_000 : 0);
      case '/downloadcontroller/pause':
        jd.state = params[0] ? 'PAUSE' : 'RUNNING';
        return wrapped(true);
      case '/downloadcontroller/start':
        jd.state = 'RUNNING';
        return wrapped(true);
      case '/downloadcontroller/stop':
        jd.state = 'STOPPED';
        return wrapped(true);
      case '/config/get':
        return wrapped(params[2] === 'DownloadSpeedLimitEnabled' ? jd.limitEnabled : jd.limit);
      case '/config/set':
        if (params[2] === 'DownloadSpeedLimitEnabled') jd.limitEnabled = params[3] as boolean;
        else jd.limit = params[3] as number;
        return wrapped(true);
      case '/downloadsV2/queryPackages':
        return Response.json([
          { uuid: 1, name: 'Fertig', bytesLoaded: 100, bytesTotal: 100, finished: true, status: 'Entpacken OK', hosts: ['rapidgator.net'], childCount: 2, eta: -1 },
          { uuid: 2, name: 'Serie S01', bytesLoaded: 40, bytesTotal: 100, speed: 2_500_000, eta: 120, running: true, hosts: ['ddownload.com'], childCount: 10, saveTo: 'D:\\Downloads\\Serie S01' },
        ]);
      default:
        return new Response('not found', { status: 404 });
    }
  };
  return { jd, fetch };
}

let dataDir: string;
let settings: SettingsStore;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'manelly-jd-'));
  settings = await createSettingsStore(dataDir);
  await settings.setJellyfin({ url: 'http://jellyfin:8096', apiKey: 'key' });
});
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const enable = (mode: 'off' | 'limit' | 'pause', limitKBps = 2048) => settings.setJDownloader({ enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode, limitKBps } });

describe('JDownloader API', () => {
  it('passes every parameter as JSON and reads wrapped and plain answers', async () => {
    const { jd, fetch } = fakeWorld();
    const api = createJDownloaderApi('http://127.0.0.1:3128', fetch);
    await api.setLimit(true, 2_097_152);
    expect(jd.calls).toEqual([
      '/config/set?%22org.jdownloader.settings.GeneralSettings%22&%22null%22&%22DownloadSpeedLimit%22&2097152',
      '/config/set?%22org.jdownloader.settings.GeneralSettings%22&%22null%22&%22DownloadSpeedLimitEnabled%22&true',
    ]);
    expect(await api.limit()).toEqual({ enabled: true, bytesPerSecond: 2_097_152 });
    expect(await api.state()).toBe('RUNNING');
    expect(await api.speed()).toBe(2_500_000);
  });

  it('explains an unreachable JDownloader', async () => {
    const { jd, fetch } = fakeWorld();
    jd.up = false;
    await expect(createJDownloaderApi('http://127.0.0.1:3128', fetch).state()).rejects.toThrow(
      'JDownloader ist unter http://127.0.0.1:3128 nicht erreichbar (connect ECONNREFUSED 127.0.0.1:3128). Läuft er, und ist die «Deprecated API» eingeschaltet?',
    );
  });
});

describe('JDownloader', () => {
  it('reports state, speed, limit and packages, unfinished first', async () => {
    const { fetch } = fakeWorld();
    const jdownloader = createJDownloader({ settings, fetch, tickMs: 0 });
    expect(await jdownloader.status()).toMatchObject({ reachable: false, error: null, packages: [] });

    await enable('off');
    const status = await jdownloader.status();
    expect(status).toMatchObject({ reachable: true, state: 'RUNNING', speedBps: 2_500_000, limit: { enabled: false, bytesPerSecond: 0 }, throttling: { active: false } });
    expect(status.packages.map((pkg) => [pkg.name, pkg.finished, pkg.eta])).toEqual([
      ['Serie S01', false, 120],
      ['Fertig', true, null],
    ]);
    expect(status.packages[1]).toMatchObject({ status: 'Entpacken OK', childCount: 2, hosts: ['rapidgator.net'] });
  });

  it('limits the speed while somebody streams and puts the old limit back afterwards', async () => {
    const { jd, fetch } = fakeWorld();
    let clock = 0;
    const jdownloader = createJDownloader({ settings, fetch, now: () => clock, quietMs: 300_000, tickMs: 0 });
    await enable('limit', 2048);

    jd.streams = 2;
    await jdownloader.check();
    expect(jd).toMatchObject({ limitEnabled: true, limit: 2048 * 1024 });
    expect((await jdownloader.status()).throttling).toEqual({ active: true, reason: 'Auf 2 MB/s gedrosselt, weil jemand streamt.' });

    // Set by hand meanwhile: that is what comes back afterwards.
    await jdownloader.setLimit(true, 10 * 1024 * 1024);
    jd.streams = 0;
    clock = 60_000;
    await jdownloader.check();
    expect(settings.get().jdownloaderHold).not.toBeNull();
    clock = 400_000;
    await jdownloader.check();
    expect(jd).toMatchObject({ limitEnabled: true, limit: 10 * 1024 * 1024 });
    expect(settings.get().jdownloaderHold).toBeNull();
  });

  it('pauses while somebody streams, but leaves a JDownloader paused by hand paused', async () => {
    const { jd, fetch } = fakeWorld();
    let clock = 0;
    const jdownloader = createJDownloader({ settings, fetch, now: () => clock, quietMs: 0, tickMs: 0 });
    await enable('pause');

    jd.streams = 1;
    await jdownloader.check();
    expect(jd.state).toBe('PAUSE');
    jd.streams = 0;
    clock = 1;
    await jdownloader.check();
    expect(jd.state).toBe('RUNNING');

    jd.state = 'PAUSE';
    jd.streams = 1;
    await jdownloader.check();
    jd.streams = 0;
    clock = 2;
    await jdownloader.check();
    expect(jd.state).toBe('PAUSE');
  });

  it('puts JDownloader back after a restart, and when the throttle is switched off', async () => {
    const { jd, fetch } = fakeWorld();
    await enable('limit', 512);
    jd.streams = 1;
    await createJDownloader({ settings, fetch, tickMs: 0 }).check();
    expect(jd.limitEnabled).toBe(true);

    // A restart in the middle of a stream: the agent remembers what to put back.
    const reloaded = await createSettingsStore(dataDir);
    const restarted = createJDownloader({ settings: reloaded, fetch, tickMs: 0 });
    jd.streams = 0;
    await restarted.check();
    expect(jd.limitEnabled).toBe(false);

    jd.streams = 1;
    await restarted.check();
    expect(jd.limitEnabled).toBe(true);
    await reloaded.setJDownloader({ enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'off', limitKBps: 512 } });
    await restarted.check();
    expect(jd.limitEnabled).toBe(false);
  });

  it('starts, stops, pauses and resumes', async () => {
    const { jd, fetch } = fakeWorld();
    const jdownloader = createJDownloader({ settings, fetch, tickMs: 0 });
    await jdownloader.control('pause');
    expect(jd.state).toBe('PAUSE');
    await jdownloader.control('resume');
    expect(jd.state).toBe('RUNNING');
    await jdownloader.control('stop');
    expect(jd.state).toBe('STOPPED');
    await jdownloader.control('start');
    expect(jd.state).toBe('RUNNING');
  });
});
