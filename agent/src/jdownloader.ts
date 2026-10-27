import type {
  JDownloaderAccount,
  JDownloaderAccounts,
  JDownloaderAccountState,
  JDownloaderAction,
  JDownloaderExtraction,
  JDownloaderLink,
  JDownloaderPackage,
  JDownloaderSettings,
  JDownloaderStatus,
  LinkAvailability,
  LinkGrabberLink,
  LinkGrabberPackage,
  LinkGrabberStatus,
} from '@manelly/shared';
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
/** Every part with its progress, and whether its archive is being unpacked (advancedStatus carries the percentage). */
const MAX_LINKS = 5000;
const LINK_QUERY = {
  bytesLoaded: true,
  bytesTotal: true,
  enabled: true,
  eta: true,
  extractionStatus: true,
  finished: true,
  host: true,
  running: true,
  speed: true,
  status: true,
  advancedStatus: true,
  startAt: 0,
  maxResults: MAX_LINKS,
};
/** Every account with what JDownloader knows about its premium time and traffic. */
const ACCOUNT_QUERY = {
  startAt: 0,
  maxResults: -1,
  userName: true,
  validUntil: true,
  trafficLeft: true,
  trafficMax: true,
  enabled: true,
  valid: true,
  error: true,
};
const ACCOUNT_ERRORS: Record<string, JDownloaderAccountState> = { EXPIRED: 'expired', INVALID: 'invalid', TEMP_DISABLED: 'blocked', PLUGIN_ERROR: 'error' };
const EXTRACTION_FAILED = new Set(['ERROR', 'ERROR_PW', 'ERROR_CRC', 'ERROR_NOT_ENOUGH_SPACE', 'ERRROR_FILE_NOT_FOUND']);
/** The link grabber, with the availability of every link as JDownloader checked it. */
const GRABBER_PACKAGE_QUERY = {
  bytesTotal: true,
  childCount: true,
  enabled: true,
  hosts: true,
  saveTo: true,
  availableOnlineCount: true,
  availableOfflineCount: true,
  availableUnknownCount: true,
  availableTempUnknownCount: true,
  startAt: 0,
  maxResults: MAX_PACKAGES,
};
const MAX_GRABBER_LINKS = 2000;
const GRABBER_LINK_QUERY = { availability: true, bytesTotal: true, enabled: true, host: true, startAt: 0, maxResults: MAX_GRABBER_LINKS };
const AVAILABILITIES: LinkAvailability[] = ['ONLINE', 'OFFLINE', 'UNKNOWN', 'TEMP_UNKNOWN'];
/** Container files JDownloader reads into the link grabber, by extension. */
const CONTAINER_TYPES = ['dlc'];
export const MAX_CONTAINER_BYTES = 1024 * 1024;

/** What JDownloader is told the file is, from its name; null for a file it should not get. */
export function containerType(name: string): string | null {
  const type = name.match(/\.(\w+)$/)?.[1]?.toLowerCase();
  return type && CONTAINER_TYPES.includes(type) ? type : null;
}

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

interface RawLink {
  uuid?: number;
  name?: string;
  packageUUID?: number;
  host?: string;
  bytesLoaded?: number;
  bytesTotal?: number;
  speed?: number;
  eta?: number;
  finished?: boolean;
  running?: boolean;
  enabled?: boolean;
  status?: string;
  extractionStatus?: string;
  advancedStatus?: { PluginProgress?: { id?: string; current?: number; total?: number } };
}

interface RawAccount {
  /** JDownloader spells it after the Java property; accept the ways it comes. */
  uuid?: number;
  UUID?: number;
  hostname?: string;
  username?: string;
  enabled?: boolean;
  valid?: boolean;
  errorType?: string | null;
  errorString?: string | null;
  /** Milliseconds; -1 or missing when unknown. */
  validUntil?: number;
  /** Bytes; -1 means unlimited. */
  trafficLeft?: number;
  trafficMax?: number;
}

interface RawCrawledPackage {
  uuid?: number;
  name?: string;
  bytesTotal?: number;
  childCount?: number;
  hosts?: string[];
  saveTo?: string;
  enabled?: boolean;
  onlineCount?: number;
  offlineCount?: number;
  unknownCount?: number;
  tempUnknownCount?: number;
}

interface RawCrawledLink {
  uuid?: number;
  name?: string;
  packageUUID?: number;
  bytesTotal?: number;
  host?: string;
  availability?: string;
  enabled?: boolean;
}

/**
 * JDownloader's local API (the "Deprecated API" in its advanced settings, port 3128):
 * GET /namespace/method?param1&param2, every parameter as JSON.
 */
export function createJDownloaderApi(url: string, fetchImpl: typeof fetch = fetch) {
  const call = <T>(path: string, ...params: unknown[]) => request<T>('GET', path, params);

  /** With POST the parameters go in the body, encoded as in the address: for what is too big for an address. */
  async function request<T>(method: 'GET' | 'POST', path: string, params: unknown[]): Promise<T> {
    const encoded = params.map((param) => encodeURIComponent(JSON.stringify(param))).join('&');
    const query = method === 'GET' && encoded ? `?${encoded}` : '';
    let response: Response;
    try {
      response = await fetchImpl(`${url}/${path}${query}`, {
        method,
        headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}) },
        body: method === 'POST' ? encoded : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
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
    links: () => call<RawLink[]>('downloadsV2/queryLinks', LINK_QUERY),
    grabberPackages: () => call<RawCrawledPackage[]>('linkgrabberv2/queryPackages', GRABBER_PACKAGE_QUERY),
    accounts: () => call<RawAccount[]>('accountsV2/listAccounts', ACCOUNT_QUERY),
    refreshAccounts: (ids: number[]) => call<void>('accountsV2/refreshAccounts', ids),
    grabberLinks: () => call<RawCrawledLink[]>('linkgrabberv2/queryLinks', GRABBER_LINK_QUERY),
    collecting: () => call<boolean>('linkgrabberv2/isCollecting'),
    moveToDownloads: (linkIds: number[], packageIds: number[]) => call<void>('linkgrabberv2/moveToDownloadlist', linkIds, packageIds),
    /**
     * Hands JDownloader a container file as a data URL; it reads the links in the background. The file goes in the
     * body, where a large one fits; a JDownloader that only reads the address gets it there. Answers the job's id.
     */
    async addContainer(type: string, file: Buffer): Promise<number> {
      const params = [type, `data:application/${type};base64,${file.toString('base64')}`];
      const job = await request<{ id?: number } | null>('POST', 'linkgrabberv2/addContainer', params)
        .then((answer) => (answer?.id === undefined ? null : answer))
        .catch(() => null);
      const id = (job ?? (await call<{ id?: number } | null>('linkgrabberv2/addContainer', ...params)))?.id;
      if (id === undefined) throw new Error('JDownloader hat die Datei nicht angenommen.');
      return id;
    },
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

/** An account as Manelly shows it: works, or why not; how long and how much is left. */
export function toAccount(raw: RawAccount): JDownloaderAccount {
  const error = raw.errorType ? (ACCOUNT_ERRORS[raw.errorType] ?? 'error') : null;
  const state: JDownloaderAccountState = raw.enabled === false ? 'disabled' : error ?? (raw.valid === false ? 'invalid' : raw.valid === true ? 'ok' : 'unchecked');
  const bytes = (value: number | undefined) => (value !== undefined && value >= 0 ? value : null);
  return {
    id: raw.uuid ?? raw.UUID ?? 0,
    hoster: raw.hostname ?? 'unbekannt',
    username: raw.username || null,
    state,
    error: raw.errorString || null,
    validUntil: raw.validUntil !== undefined && raw.validUntil > 0 ? new Date(raw.validUntil).toISOString() : null,
    trafficLeft: bytes(raw.trafficLeft),
    trafficMax: bytes(raw.trafficMax),
    unlimited: raw.trafficLeft === -1 || raw.trafficMax === -1,
  };
}

/** Unpacking as JDownloader reports it on a part: under way (with a percentage), done or failed. */
function extractionOf(raw: RawLink): JDownloaderExtraction | null {
  const progress = raw.advancedStatus?.PluginProgress;
  const message = raw.status || null;
  if (raw.extractionStatus === 'RUNNING' || progress?.id === 'EXTRACTION') {
    const percent = progress?.id === 'EXTRACTION' && progress.total ? Math.min(100, Math.max(0, Math.round(((progress.current ?? 0) / progress.total) * 100))) : null;
    return { state: 'running', percent, message };
  }
  if (raw.extractionStatus && EXTRACTION_FAILED.has(raw.extractionStatus)) return { state: 'failed', percent: null, message };
  if (raw.extractionStatus === 'SUCCESSFUL') return { state: 'done', percent: null, message };
  return null;
}

function toLink(raw: RawLink): JDownloaderLink {
  return {
    uuid: raw.uuid ?? 0,
    name: raw.name ?? 'Unbenannte Datei',
    host: raw.host ?? null,
    bytesLoaded: raw.bytesLoaded ?? 0,
    bytesTotal: raw.bytesTotal !== undefined && raw.bytesTotal > 0 ? raw.bytesTotal : 0,
    speedBps: raw.speed ?? 0,
    eta: raw.eta !== undefined && raw.eta >= 0 ? raw.eta : null,
    finished: raw.finished ?? false,
    running: raw.running ?? false,
    enabled: raw.enabled ?? true,
    status: raw.status || null,
    extraction: extractionOf(raw),
  };
}

/** A package unpacks while any of its archives does; it failed when one failed; it is done when all that were unpacked are. */
export function packageExtraction(links: JDownloaderLink[]): JDownloaderExtraction | null {
  const states = links.flatMap((link) => (link.extraction ? [link.extraction] : []));
  const running = states.filter((state) => state.state === 'running');
  if (running.length) {
    const percents = running.flatMap((state) => (state.percent === null ? [] : [state.percent]));
    return { state: 'running', percent: percents.length ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length) : null, message: running[0]!.message };
  }
  return states.find((state) => state.state === 'failed') ?? (states.length ? { state: 'done', percent: null, message: states[0]!.message } : null);
}

function toPackage(raw: RawPackage, links: JDownloaderLink[] | null, withLinks: boolean): JDownloaderPackage {
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
    extraction: links ? packageExtraction(links) : null,
    ...(withLinks && links ? { links } : {}),
  };
}

function toGrabberLink(raw: RawCrawledLink): LinkGrabberLink {
  return {
    uuid: raw.uuid ?? 0,
    name: raw.name ?? 'Unbenannter Link',
    bytesTotal: raw.bytesTotal !== undefined && raw.bytesTotal > 0 ? raw.bytesTotal : 0,
    host: raw.host ?? null,
    availability: AVAILABILITIES.includes(raw.availability as LinkAvailability) ? (raw.availability as LinkAvailability) : 'UNKNOWN',
    enabled: raw.enabled ?? true,
  };
}

function toGrabberPackage(raw: RawCrawledPackage, links: LinkGrabberLink[]): LinkGrabberPackage {
  return {
    uuid: raw.uuid ?? 0,
    name: raw.name ?? 'Unbenanntes Paket',
    bytesTotal: raw.bytesTotal !== undefined && raw.bytesTotal > 0 ? raw.bytesTotal : 0,
    childCount: raw.childCount ?? links.length,
    hosts: raw.hosts ?? [],
    saveTo: raw.saveTo ?? null,
    enabled: raw.enabled ?? true,
    online: raw.onlineCount ?? 0,
    offline: raw.offlineCount ?? 0,
    unknown: (raw.unknownCount ?? 0) + (raw.tempUnknownCount ?? 0),
    links,
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

    /** With `withLinks`, every package lists its parts too. */
    async status(withLinks = false): Promise<JDownloaderStatus> {
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
        // Without the parts the packages still show; they only lack the unpacking.
        const [state, speed, limit, packages, links] = await Promise.all([jd.state(), jd.speed(), jd.limit(), jd.packages(), jd.links().catch(() => null)]);
        const byPackage = new Map<number, JDownloaderLink[]>();
        for (const raw of links ?? []) {
          const list = byPackage.get(raw.packageUUID ?? 0) ?? [];
          list.push(toLink(raw));
          byPackage.set(raw.packageUUID ?? 0, list);
        }
        // Unfinished first, in JDownloader's order; finished ones after them.
        const sorted = (packages ?? [])
          .map((raw) => toPackage(raw, links ? (byPackage.get(raw.uuid ?? 0) ?? []) : null, withLinks))
          .sort((a, b) => Number(a.finished) - Number(b.finished));
        return { ...empty, reachable: true, state: state ?? null, speedBps: typeof speed === 'number' ? speed : null, limit, packages: sorted.slice(0, MAX_PACKAGES) };
      } catch (error) {
        return { ...empty, error: (error as Error).message };
      }
    },

    /** What waits in the link grabber, package by package. */
    async linkgrabber(): Promise<LinkGrabberStatus> {
      const jd = api();
      const [collecting, packages, links] = await Promise.all([jd.collecting(), jd.grabberPackages(), jd.grabberLinks()]);
      const byPackage = new Map<number, LinkGrabberLink[]>();
      for (const raw of links ?? []) {
        const list = byPackage.get(raw.packageUUID ?? 0) ?? [];
        list.push(toGrabberLink(raw));
        byPackage.set(raw.packageUUID ?? 0, list);
      }
      return { collecting: collecting === true, packages: (packages ?? []).map((raw) => toGrabberPackage(raw, byPackage.get(raw.uuid ?? 0) ?? [])) };
    },

    /** The premium accounts, by hoster. */
    async accounts(): Promise<JDownloaderAccounts> {
      const accounts = ((await api().accounts()) ?? []).map(toAccount);
      return { accounts: accounts.sort((a, b) => a.hoster.localeCompare(b.hoster) || (a.username ?? '').localeCompare(b.username ?? '')) };
    },

    /** Lets JDownloader ask the hosters again; the new numbers come in after a moment. */
    async refreshAccounts(ids: number[]): Promise<void> {
      await api().refreshAccounts(ids);
    },

    /** A container file (see containerType) for the link grabber; its packages show up there once JDownloader has read it. */
    async addContainer(type: string, file: Buffer): Promise<void> {
      await api().addContainer(type, file);
    },

    /** Whole packages and single links from the link grabber to the download list. */
    async moveToDownloads(packageIds: number[], linkIds: number[]): Promise<void> {
      await api().moveToDownloads(linkIds, packageIds);
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
