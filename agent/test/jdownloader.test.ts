import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJDownloader, createJDownloaderApi, packageExtraction } from '../src/jdownloader.js';
import { createSettingsStore, type SettingsStore } from '../src/schedule.js';

/** JDownloader's local API and Jellyfin's sessions, as the agent sees them. */
function fakeWorld() {
  const jd = { state: 'RUNNING', limitEnabled: false, limit: 0, streams: 0, up: true, calls: [] as string[], grabber: [11, 12], linksFail: false };
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
      case '/linkgrabberv2/isCollecting':
        return wrapped(true);
      case '/linkgrabberv2/queryPackages':
        return Response.json(
          [
            { uuid: 11, name: 'Dune Part Two', bytesTotal: 60e9, childCount: 2, hosts: ['rapidgator.net'], saveTo: 'D:\\Downloads\\Dune', onlineCount: 1, offlineCount: 1, enabled: true },
            { uuid: 12, name: 'Noch unklar', childCount: 1, unknownCount: 1, tempUnknownCount: 1, bytesTotal: -1 },
          ].filter((pkg) => jd.grabber.includes(pkg.uuid)),
        );
      case '/linkgrabberv2/queryLinks':
        return wrapped(
          [
            { uuid: 101, packageUUID: 11, name: 'dune.part1.rar', bytesTotal: 30e9, host: 'rapidgator.net', availability: 'ONLINE', enabled: true },
            { uuid: 102, packageUUID: 11, name: 'dune.part2.rar', bytesTotal: 30e9, host: 'rapidgator.net', availability: 'OFFLINE', enabled: true },
            { uuid: 201, packageUUID: 12, name: 'unklar.mkv', host: 'example.com', availability: 'SOMETHING_NEW' },
          ].filter((link) => jd.grabber.includes(link.packageUUID)),
        );
      case '/linkgrabberv2/moveToDownloadlist':
        jd.grabber = jd.grabber.filter((uuid) => !(params[1] as number[]).includes(uuid));
        return wrapped(null);
      case '/downloadsV2/queryPackages':
        return Response.json([
          { uuid: 1, name: 'Fertig', bytesLoaded: 100, bytesTotal: 100, finished: true, status: 'Entpacken OK', hosts: ['rapidgator.net'], childCount: 2, eta: -1 },
          { uuid: 2, name: 'Serie S01', bytesLoaded: 40, bytesTotal: 100, speed: 2_500_000, eta: 120, running: true, hosts: ['ddownload.com'], childCount: 10, saveTo: 'D:\\Downloads\\Serie S01' },
          { uuid: 3, name: 'Film', bytesLoaded: 200, bytesTotal: 200, finished: true, childCount: 2 },
        ]);
      case '/downloadsV2/queryLinks':
        if (jd.linksFail) return new Response('nope', { status: 500 });
        return Response.json([
          { uuid: 101, packageUUID: 1, name: 'fertig.part1.rar', bytesLoaded: 50, bytesTotal: 50, finished: true, extractionStatus: 'SUCCESSFUL', status: 'Entpacken OK' },
          { uuid: 201, packageUUID: 2, name: 'serie.e01.mkv', bytesLoaded: 40, bytesTotal: 50, running: true, speed: 2_500_000, eta: 4, host: 'ddownload.com' },
          { uuid: 202, packageUUID: 2, name: 'serie.e02.mkv', bytesTotal: -1, eta: -1 },
          { uuid: 301, packageUUID: 3, name: 'film.part1.rar', bytesLoaded: 100, bytesTotal: 100, finished: true, extractionStatus: 'RUNNING', status: 'Entpacken', advancedStatus: { PluginProgress: { id: 'EXTRACTION', current: 30, total: 120 } } },
          { uuid: 302, packageUUID: 3, name: 'film.part2.rar', bytesLoaded: 100, bytesTotal: 100, finished: true, extractionStatus: 'RUNNING', advancedStatus: { PluginProgress: { id: 'EXTRACTION', current: 60, total: 120 } } },
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
      ['Film', true, null],
    ]);
    expect(status.packages[1]).toMatchObject({ status: 'Entpacken OK', childCount: 2, hosts: ['rapidgator.net'] });
  });

  it('tells from the parts whether a package is being unpacked, and lists the parts on request', async () => {
    const { jd, fetch } = fakeWorld();
    await enable('off');
    const jdownloader = createJDownloader({ settings, fetch, tickMs: 0 });
    const status = await jdownloader.status();
    expect(status.packages.map((pkg) => [pkg.name, pkg.extraction])).toEqual([
      ['Serie S01', null],
      ['Fertig', { state: 'done', percent: null, message: 'Entpacken OK' }],
      // Finished downloading, still unpacking: the average of its parts.
      ['Film', { state: 'running', percent: 38, message: 'Entpacken' }],
    ]);
    expect(status.packages.some((pkg) => 'links' in pkg)).toBe(false);

    const detailed = await jdownloader.status(true);
    expect(detailed.packages[0]!.links).toEqual([
      { uuid: 201, name: 'serie.e01.mkv', host: 'ddownload.com', bytesLoaded: 40, bytesTotal: 50, speedBps: 2_500_000, eta: 4, finished: false, running: true, enabled: true, status: null, extraction: null },
      { uuid: 202, name: 'serie.e02.mkv', host: null, bytesLoaded: 0, bytesTotal: 0, speedBps: 0, eta: null, finished: false, running: false, enabled: true, status: null, extraction: null },
    ]);

    // Without the parts, the packages still show – only without the unpacking.
    jd.linksFail = true;
    const without = await jdownloader.status(true);
    expect(without.reachable).toBe(true);
    expect(without.packages.map((pkg) => [pkg.name, pkg.extraction, pkg.links])).toEqual([
      ['Serie S01', null, undefined],
      ['Fertig', null, undefined],
      ['Film', null, undefined],
    ]);
  });

  it('counts a failed archive over the unpacked ones', () => {
    const link = (state: 'running' | 'done' | 'failed' | null, message: string | null = null) =>
      ({ extraction: state && { state, percent: null, message } }) as Parameters<typeof packageExtraction>[0][number];
    expect(packageExtraction([link('done'), link('failed', 'Passwort falsch'), link(null)])).toEqual({ state: 'failed', percent: null, message: 'Passwort falsch' });
    expect(packageExtraction([link('done'), link(null)])).toMatchObject({ state: 'done' });
    expect(packageExtraction([link(null)])).toBeNull();
    expect(packageExtraction([link('failed'), link('running')])).toMatchObject({ state: 'running', percent: null });
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

  it('lists the link grabber by package, and moves packages to the download list', async () => {
    const { jd, fetch } = fakeWorld();
    await enable('off');
    const jdownloader = createJDownloader({ settings, fetch, tickMs: 0 });
    const grabber = await jdownloader.linkgrabber();
    expect(grabber.collecting).toBe(true);
    expect(grabber.packages).toEqual([
      {
        uuid: 11,
        name: 'Dune Part Two',
        bytesTotal: 60e9,
        childCount: 2,
        hosts: ['rapidgator.net'],
        saveTo: 'D:\\Downloads\\Dune',
        enabled: true,
        online: 1,
        offline: 1,
        unknown: 0,
        links: [
          { uuid: 101, name: 'dune.part1.rar', bytesTotal: 30e9, host: 'rapidgator.net', availability: 'ONLINE', enabled: true },
          { uuid: 102, name: 'dune.part2.rar', bytesTotal: 30e9, host: 'rapidgator.net', availability: 'OFFLINE', enabled: true },
        ],
      },
      // Sizes JDownloader does not know yet, and states this agent does not know, read as unknown.
      expect.objectContaining({ uuid: 12, bytesTotal: 0, unknown: 2, links: [expect.objectContaining({ availability: 'UNKNOWN', bytesTotal: 0 })] }),
    ]);

    jd.calls = [];
    await jdownloader.moveToDownloads([11], []);
    // Link ids first, then package ids, as JDownloader's method takes them.
    expect(jd.calls).toEqual(['/linkgrabberv2/moveToDownloadlist?%5B%5D&%5B11%5D']);
    expect((await jdownloader.linkgrabber()).packages.map((pkg) => pkg.uuid)).toEqual([12]);
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
