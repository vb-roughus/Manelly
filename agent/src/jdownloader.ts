import type { JDownloaderAction, JDownloaderPackage, JDownloaderSettings, JDownloaderStatus } from '@manelly/shared';
import { createJellyfinApi } from './jellyfin.js';
import type { JDownloaderHold, SettingsStore } from './schedule.js';

const TIMEOUT_MS = 5000;
const GENERAL_SETTINGS = 'org.jdownloader.settings.GeneralSettings';
/** All the details the dashboard shows, for every package. */
const PACKAGE_QUERY = {
  bytesLoaded: true,
  bytesTotal: true,
  enabled: true,
  eta: true,
  finished: true,
  running: true,
  speed: true,
  status: true,
  childCount: true,
  hosts: true,
  saveTo: true,
  startAt: 0,
  maxResults: -1,
};
const MAX_PACKAGES = 100;

interface RawPackage {
  uuid?: number;
  name?: string;
  bytesLoaded?: number;
  bytesTotal?: number;
  speed?: number;
  eta?: number;
  finished?: boolean;
  running?: boolean;
  enabled?: boolean;
  status?: string;
  saveTo?: string;
  hosts?: string[];
  childCount?: number;
}

/**
 * JDownloader's local API (the "Deprecated API" in its advanced settings, port 3128):
 * GET /namespace/method?param1&param2, every parameter as JSON.
 */
export function createJDownloaderApi(url: string, fetchImpl: typeof fetch = fetch) {
  async function call<T>(path: string, ...params: unknown[]): Promise<T> {
    const query = params.length ? `?${params.map((param) => encodeURIComponent(JSON.stringify(param))).join('&')}` : '';
    let response: Response;
    try {
      response = await fetchImpl(`${url}/${path}${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : (error as Error).message;
      throw new Error(`JDownloader ist unter ${url} nicht erreichbar (${cause}). Läuft er, und ist die «Deprecated API» eingeschaltet?`);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`JDownloader lehnte ${path} ab (HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}).`);
    if (!text.trim()) return undefined as T;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`JDownloader antwortete auf ${path} nicht mit JSON.`);
    }
    // The value comes as is, or wrapped as {"data": …}.
    return (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? (body as { data: unknown }).data : body) as T;
  }

  // The storage "null" means the normal settings file, as JDownloader's own clients send it.
  const getSetting = (key: string) => call<unknown>('config/get', GENERAL_SETTINGS, 'null', key);
  const setSetting = (key: string, value: unknown) => call<boolean>('config/set', GENERAL_SETTINGS, 'null', key, value);

  return {
    version: () => call<number>('jd/version'),
    state: () => call<string>('downloadcontroller/getCurrentState'),
    speed: () => call<number>('downloadcontroller/getSpeedInBps'),
    start: () => call<boolean>('downloadcontroller/start'),
    stop: () => call<boolean>('downloadcontroller/stop'),
    pause: (paused: boolean) => call<boolean>('downloadcontroller/pause', paused),
    packages: () => call<RawPackage[]>('downloadsV2/queryPackages', PACKAGE_QUERY),
    async limit(): Promise<{ enabled: boolean; bytesPerSecond: number }> {
      const [enabled, bytes] = await Promise.all([getSetting('DownloadSpeedLimitEnabled'), getSetting('DownloadSpeedLimit')]);
      return { enabled: enabled === true || enabled === 'true', bytesPerSecond: Number(bytes) || 0 };
    },
    async setLimit(enabled: boolean, bytesPerSecond: number): Promise<void> {
      if (enabled) await setSetting('DownloadSpeedLimit', Math.round(bytesPerSecond));
      await setSetting('DownloadSpeedLimitEnabled', enabled);
    },
  };
}

export type JDownloaderApi = ReturnType<typeof createJDownloaderApi>;

function toPackage(raw: RawPackage): JDownloaderPackage {
  return {
    uuid: raw.uuid ?? 0,
    name: raw.name ?? 'Unbenanntes Paket',
    bytesLoaded: raw.bytesLoaded ?? 0,
    bytesTotal: raw.bytesTotal ?? 0,
    speedBps: raw.speed ?? 0,
    eta: raw.eta !== undefined && raw.eta >= 0 ? raw.eta : null,
    finished: raw.finished ?? false,
    running: raw.running ?? false,
    enabled: raw.enabled ?? true,
    status: raw.status || null,
    saveTo: raw.saveTo ?? null,
    hosts: raw.hosts ?? [],
    childCount: raw.childCount ?? 0,
  };
}

export interface JDownloaderOptions {
  settings: SettingsStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** After the last stream, wait this long before JDownloader may run at full speed again. */
  quietMs?: number;
  /** How often the streams are checked while the throttle is on; 0 only on request (tests). */
  tickMs?: number;
  log?: (message: string) => void;
}

/**
 * Reads and controls JDownloader, and holds it back while somebody streams: limit its speed
 * or pause it when a stream starts, put it back a few minutes after the last one ended.
 * Only these two moments change JDownloader – whatever is set by hand in between stays.
 */
export function createJDownloader({ settings, fetch: fetchImpl = fetch, now = Date.now, quietMs = 5 * 60_000, tickMs = 30_000, log = () => {} }: JDownloaderOptions) {
  const api = () => createJDownloaderApi(settings.get().jdownloader.url, fetchImpl);
  let lastStreamAt = Number.NEGATIVE_INFINITY;
  let checking: Promise<void> | null = null;

  async function hold(jd: JDownloaderApi, config: JDownloaderSettings) {
    const kbps = config.throttle.limitKBps;
    if (config.throttle.mode === 'limit') {
      const previousLimit = await jd.limit();
      await jd.setLimit(true, kbps * 1024);
      await settings.setJDownloaderHold({ mode: 'limit', previousLimit, wasPaused: false });
      log(`JDownloader auf ${kbps} KB/s gedrosselt – jemand streamt.`);
    } else {
      const wasPaused = (await jd.state()) === 'PAUSE';
      if (!wasPaused) await jd.pause(true);
      await settings.setJDownloaderHold({ mode: 'pause', previousLimit: null, wasPaused });
      log('JDownloader pausiert – jemand streamt.');
    }
  }

  async function release(jd: JDownloaderApi, current: JDownloaderHold) {
    if (current.mode === 'limit' && current.previousLimit) await jd.setLimit(current.previousLimit.enabled, current.previousLimit.bytesPerSecond);
    if (current.mode === 'pause' && !current.wasPaused) await jd.pause(false);
    await settings.setJDownloaderHold(null);
    log('JDownloader läuft wieder wie vorher – niemand streamt mehr.');
  }

  async function checkOnce() {
    const { jdownloader: config, jellyfin, jdownloaderHold: current } = settings.get();
    const wanted = config.enabled && config.throttle.mode !== 'off';
    try {
      if (!wanted) {
        // Switched off while holding JDownloader back: put it back right away.
        if (current) await release(api(), current);
        return;
      }
      if (!jellyfin) return;
      const streams = await createJellyfinApi(jellyfin, fetchImpl).countStreams();
      if (streams > 0) {
        lastStreamAt = now();
        if (!current) await hold(api(), config);
      } else if (current && now() - lastStreamAt >= quietMs) {
        await release(api(), current);
      }
    } catch (error) {
      // JDownloader or Jellyfin out of reach: try again with the next check.
      log(`Drosseln von JDownloader: ${(error as Error).message}`);
    }
  }

  function check(): Promise<void> {
    checking ??= checkOnce().finally(() => {
      checking = null;
    });
    return checking;
  }

  const timer = tickMs > 0 ? setInterval(() => void check(), tickMs) : null;
  timer?.unref();

  return {
    check,

    async status(): Promise<JDownloaderStatus> {
      const { jdownloader: config, jdownloaderHold: current } = settings.get();
      const throttling = {
        active: Boolean(current),
        reason: current
          ? current.mode === 'limit'
            ? `Auf ${config.throttle.limitKBps >= 1024 ? `${Math.round((config.throttle.limitKBps / 1024) * 10) / 10} MB/s` : `${config.throttle.limitKBps} KB/s`} gedrosselt, weil jemand streamt.`
            : 'Pausiert, weil jemand streamt.'
          : null,
      };
      const empty: JDownloaderStatus = { settings: config, reachable: false, error: null, state: null, speedBps: null, limit: null, packages: [], throttling };
      if (!config.enabled) return empty;
      try {
        const jd = api();
        const [state, speed, limit, packages] = await Promise.all([jd.state(), jd.speed(), jd.limit(), jd.packages()]);
        // Unfinished first, in JDownloader's order; finished ones after them.
        const sorted = (packages ?? []).map(toPackage).sort((a, b) => Number(a.finished) - Number(b.finished));
        return { ...empty, reachable: true, state: state ?? null, speedBps: typeof speed === 'number' ? speed : null, limit, packages: sorted.slice(0, MAX_PACKAGES) };
      } catch (error) {
        return { ...empty, error: (error as Error).message };
      }
    },

    async control(action: JDownloaderAction): Promise<void> {
      const jd = api();
      if (action === 'start') await jd.start();
      else if (action === 'stop') await jd.stop();
      else await jd.pause(action === 'pause');
    },

    /** Set by hand: applies now, and is also what comes back after a stream. */
    async setLimit(enabled: boolean, bytesPerSecond: number): Promise<void> {
      await api().setLimit(enabled, bytesPerSecond);
      const current = settings.get().jdownloaderHold;
      if (current?.mode === 'limit') await settings.setJDownloaderHold({ ...current, previousLimit: { enabled, bytesPerSecond } });
    },

    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

export type JDownloader = ReturnType<typeof createJDownloader>;
