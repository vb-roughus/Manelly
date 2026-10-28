import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentJellyfinAccess, ConversionGate, ConversionSchedule, ConversionWindow, HistorySettings, JDownloaderSettings, NetworkRole } from '@manelly/shared';
import type { NetworkCredential } from './drives.js';
import { AgentError } from './errors.js';
import { createJellyfinApi } from './jellyfin.js';

/** A network interface picked in Manelly; name and description as they were then, for the display. */
export interface NetworkSelection {
  id: string;
  name: string;
  description: string | null;
  roles: NetworkRole[];
}

export const NETWORK_ROLES: readonly NetworkRole[] = ['streaming', 'management', 'storage'];

/** What the agent changed on JDownloader while somebody streamed, to put it back afterwards – also after a restart. */
export interface JDownloaderHold {
  mode: 'limit' | 'pause';
  /** The speed limit as it was before. */
  previousLimit: { enabled: boolean; bytesPerSecond: number } | null;
  /** JDownloader was paused already; then it stays paused. */
  wasPaused: boolean;
}

/** What Manelly sends the agent; kept apart from agent.json, which people edit by hand. */
export interface AgentSettings {
  schedule: ConversionSchedule;
  jellyfin: AgentJellyfinAccess | null;
  network: NetworkSelection[];
  jdownloader: JDownloaderSettings;
  jdownloaderHold: JDownloaderHold | null;
  history: HistorySettings;
  /** Logins for network shares; the passwords encrypted for this computer. */
  networkCredentials: NetworkCredential[];
  /** Where conversions copy the original to and convert, e.g. on a local disk; null converts where the files are. */
  work: string | null;
}

const SETTINGS_FILE = 'settings.json';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_SCHEDULE: ConversionSchedule = { window: null, idleOnly: false };

export function parseSchedule(input: unknown): ConversionSchedule {
  const value = (input ?? {}) as Partial<ConversionSchedule>;
  if (typeof value.idleOnly !== 'boolean') throw new AgentError(400, 'Unvollständiger Zeitplan.');
  if (value.window === null || value.window === undefined) return { window: null, idleOnly: value.idleOnly };
  const { start, end } = value.window as Partial<ConversionWindow>;
  if (typeof start !== 'string' || typeof end !== 'string' || !TIME.test(start) || !TIME.test(end)) {
    throw new AgentError(400, 'Das Zeitfenster braucht Anfang und Ende im Format HH:MM.');
  }
  if (start === end) throw new AgentError(400, 'Anfang und Ende des Zeitfensters sind gleich.');
  return { window: { start, end }, idleOnly: value.idleOnly };
}

export function parseJellyfinAccess(input: unknown): AgentJellyfinAccess {
  const { url, apiKey } = (input ?? {}) as Partial<AgentJellyfinAccess>;
  if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(url) || typeof apiKey !== 'string' || !apiKey || apiKey.length > 256) {
    throw new AgentError(400, 'Ungültige Jellyfin-Verbindung.');
  }
  return { url: url.replace(/\/+$/, ''), apiKey };
}

export const DEFAULT_JDOWNLOADER: JDownloaderSettings = { enabled: false, url: 'http://127.0.0.1:3128', throttle: { mode: 'off', limitKBps: 1024 } };

export function parseJDownloaderSettings(input: unknown): JDownloaderSettings {
  const { enabled, url, throttle } = (input ?? {}) as Partial<JDownloaderSettings>;
  if (typeof enabled !== 'boolean' || typeof url !== 'string' || !/^https?:\/\/[^\s/]+(:\d+)?\/?$/i.test(url)) {
    throw new AgentError(400, 'Die JDownloader-Adresse ist ungültig, z. B. http://127.0.0.1:3128.');
  }
  const mode = throttle?.mode;
  const limitKBps = Number(throttle?.limitKBps);
  if (mode !== 'off' && mode !== 'limit' && mode !== 'pause') throw new AgentError(400, 'Unbekannte Art der Drosselung.');
  if (!Number.isInteger(limitKBps) || limitKBps < 1 || limitKBps > 10_000_000) throw new AgentError(400, 'Das Tempo-Limit muss zwischen 1 KB/s und 10 GB/s liegen.');
  return { enabled, url: url.replace(/\/+$/, ''), throttle: { mode, limitKBps } };
}

export const DEFAULT_HISTORY: HistorySettings = { enabled: false, retentionDays: 30 };

export function parseHistorySettings(input: unknown): HistorySettings {
  const { enabled, retentionDays } = (input ?? {}) as Partial<HistorySettings>;
  if (typeof enabled !== 'boolean') throw new AgentError(400, 'Unvollständige Einstellungen der Aufzeichnung.');
  if (!Number.isInteger(retentionDays) || retentionDays! < 1 || retentionDays! > 3650) throw new AgentError(400, 'Die Aufbewahrung muss zwischen 1 und 3650 Tagen liegen.');
  return { enabled, retentionDays: retentionDays! };
}

const isSelection = (value: unknown): value is NetworkSelection =>
  typeof (value as NetworkSelection)?.id === 'string' && typeof (value as NetworkSelection).name === 'string';

/** Stored before 0.19.0 without roles. */
const withRoles = (entry: NetworkSelection): NetworkSelection => ({
  ...entry,
  roles: Array.isArray(entry.roles) ? NETWORK_ROLES.filter((role) => entry.roles.includes(role)) : [],
});

const isCredential = (value: unknown): value is NetworkCredential =>
  ['server', 'username', 'secret'].every((key) => typeof (value as Record<string, unknown>)?.[key] === 'string');

export async function createSettingsStore(dataDir: string) {
  const file = join(dataDir, SETTINGS_FILE);
  let current: AgentSettings = {
    schedule: DEFAULT_SCHEDULE,
    jellyfin: null,
    network: [],
    jdownloader: DEFAULT_JDOWNLOADER,
    jdownloaderHold: null,
    history: DEFAULT_HISTORY,
    networkCredentials: [],
    work: null,
  };
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as Partial<AgentSettings>;
    current = {
      schedule: stored.schedule ? parseSchedule(stored.schedule) : DEFAULT_SCHEDULE,
      jellyfin: stored.jellyfin ? parseJellyfinAccess(stored.jellyfin) : null,
      network: Array.isArray(stored.network) ? stored.network.filter(isSelection).map(withRoles) : [],
      jdownloader: stored.jdownloader ? parseJDownloaderSettings(stored.jdownloader) : DEFAULT_JDOWNLOADER,
      jdownloaderHold: stored.jdownloaderHold && (stored.jdownloaderHold.mode === 'limit' || stored.jdownloaderHold.mode === 'pause') ? stored.jdownloaderHold : null,
      history: stored.history ? parseHistorySettings(stored.history) : DEFAULT_HISTORY,
      networkCredentials: Array.isArray(stored.networkCredentials) ? stored.networkCredentials.filter(isCredential) : [],
      work: typeof stored.work === 'string' && stored.work ? stored.work : null,
    };
  } catch {
    // Missing or damaged: Manelly sends both again.
  }

  async function save(next: AgentSettings) {
    await mkdir(dataDir, { recursive: true });
    // Holds the Jellyfin API key and the logins for the network shares.
    await writeFile(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    current = next;
  }

  return {
    get: (): AgentSettings => current,
    setSchedule: (schedule: ConversionSchedule) => save({ ...current, schedule }),
    setJellyfin: (jellyfin: AgentJellyfinAccess) => save({ ...current, jellyfin }),
    setNetwork: (network: NetworkSelection[]) => save({ ...current, network }),
    setJDownloader: (jdownloader: JDownloaderSettings) => save({ ...current, jdownloader }),
    setJDownloaderHold: (jdownloaderHold: JDownloaderHold | null) => save({ ...current, jdownloaderHold }),
    setHistory: (history: HistorySettings) => save({ ...current, history }),
    setNetworkCredentials: (networkCredentials: NetworkCredential[]) => save({ ...current, networkCredentials }),
    setWork: (work: string | null) => save({ ...current, work }),
  };
}

export type SettingsStore = Awaited<ReturnType<typeof createSettingsStore>>;

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Local time of the agent; a window like 22:00–06:00 spans midnight. */
export function inWindow(date: Date, window: ConversionWindow): boolean {
  const now = date.getHours() * 60 + date.getMinutes();
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export interface GateCheck extends ConversionGate {
  /** A running scheduled conversion must pause: somebody started streaming. */
  pause: boolean;
}

export interface GateOptions {
  settings: () => AgentSettings;
  fetch?: typeof fetch;
  now?: () => Date;
  /** After a stream ended, wait this long – the next episode may follow. */
  quietMs?: number;
}

/** Decides whether scheduled conversions may run now: within the window, and nobody streaming. */
export function createGate({ settings, fetch: fetchImpl = fetch, now = () => new Date(), quietMs = 5 * 60_000 }: GateOptions) {
  let lastStreamAt = Number.NEGATIVE_INFINITY;

  return async function check(running: boolean): Promise<GateCheck> {
    const { schedule, jellyfin } = settings();
    const date = now();
    const result = (open: boolean, reason: string | null, streams: number | null = null, pause = false): GateCheck => ({
      open,
      reason,
      streams,
      pause,
      checkedAt: date.toISOString(),
    });
    const inside = !schedule.window || inWindow(date, schedule.window);
    const outside = schedule.window ? `Wartet auf das Zeitfenster ${schedule.window.start}–${schedule.window.end}.` : null;

    // Outside the window nothing starts; a conversion that already runs finishes.
    if (!schedule.idleOnly || (!inside && !running)) return result(inside, inside ? null : outside);
    if (!jellyfin) return result(false, 'Wartet auf die Jellyfin-Verbindung – Manelly übergibt sie, sobald es den Agent erreicht.');

    let streams: number;
    try {
      streams = await createJellyfinApi(jellyfin, fetchImpl).countStreams();
    } catch (error) {
      // Without knowing about streams, nothing starts – and nothing running is stopped.
      return result(false, `${(error as Error).message} Ohne Blick auf die Streams startet keine Umwandlung.`);
    }
    if (streams > 0) {
      lastStreamAt = date.getTime();
      return result(false, streams === 1 ? 'Wartet, bis der laufende Stream endet.' : `Wartet, bis die ${streams} laufenden Streams enden.`, streams, true);
    }
    if (!inside) return result(false, outside, 0);
    if (date.getTime() - lastStreamAt < quietMs) return result(false, 'Der letzte Stream endete eben erst – wartet noch ein paar Minuten.', 0);
    return result(true, null, 0);
  };
}

export type Gate = ReturnType<typeof createGate>;
