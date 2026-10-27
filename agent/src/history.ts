import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryPoint, HistoryResponse, StreamEvent, StreamSpan } from '@manelly/shared';
import { createJellyfinApi } from './jellyfin.js';
import type { NetworkMonitor } from './network.js';
import type { ResourceMonitor } from './resources.js';
import type { SettingsStore } from './schedule.js';
import { createStreamTracker } from './streamEvents.js';

const DAY_MS = 86_400_000;
/** The lengths a point can have; the shortest that keeps a range within MAX_POINTS wins. */
const STEPS = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 43_200, 86_400].map((seconds) => seconds * 1000);
const MAX_POINTS = 720;
export const MAX_RANGE_MS = 400 * DAY_MS;

type Kind = 'samples' | 'streams';
const FILE = /^(samples|streams)-(\d{4}-\d{2}-\d{2})\.ndjson$/;
const INTERFACES_FILE = 'interfaces.json';

/** One record on disk; a missing part was not measured. */
export interface SampleLine {
  t: number;
  /** Percent of the whole CPU: total, Jellyfin's FFmpeg, the conversion. */
  cpu?: [number, number, number];
  /** The busiest GPU engine, split the same way. */
  gpu?: [number, number, number];
  /** Per interface id: receive and send, bits per second. */
  net?: Record<string, [number, number]>;
  /** Streams, of which transcodes, and their estimated bitrate. */
  streams?: [number, number, number | null];
}

/** Days in UTC, so a file never depends on the agent's time zone. */
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfDay = (day: string) => Date.parse(`${day}T00:00:00Z`);

export const stepFor = (rangeMs: number) => STEPS.find((step) => rangeMs / step <= MAX_POINTS) ?? STEPS.at(-1)!;

/** One file per day and kind, appended line by line: a crash loses at most the line being written. */
export function createHistoryStore(dir: string) {
  const fileOf = (kind: Kind, day: string) => join(dir, `${kind}-${day}.ndjson`);
  let names: Record<string, string> | null = null;

  async function files(): Promise<Array<{ name: string; kind: Kind; day: string }>> {
    const entries = await readdir(dir).catch(() => [] as string[]);
    return entries.flatMap((name) => {
      const match = FILE.exec(name);
      return match ? [{ name, kind: match[1] as Kind, day: match[2]! }] : [];
    });
  }

  async function readDay<T extends { t: number }>(kind: Kind, day: string): Promise<T[]> {
    const text = await readFile(fileOf(kind, day), 'utf8').catch(() => '');
    const lines: T[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const value = JSON.parse(line) as T;
        if (typeof value?.t === 'number') lines.push(value);
      } catch {
        // Half a line from a crash.
      }
    }
    return lines;
  }

  async function interfaceNames(): Promise<Record<string, string>> {
    names ??= await readFile(join(dir, INTERFACES_FILE), 'utf8').then((text) => JSON.parse(text) as Record<string, string>, () => ({}));
    return names;
  }

  return {
    async append(kind: Kind, value: { t: number }) {
      await mkdir(dir, { recursive: true });
      await appendFile(fileOf(kind, dayOf(value.t)), `${JSON.stringify(value)}\n`);
    },

    /** Everything of one kind between from and to, oldest first. */
    async read<T extends { t: number }>(kind: Kind, from: number, to: number): Promise<T[]> {
      const days = new Set((await files()).filter((file) => file.kind === kind).map((file) => file.day));
      const lines: T[] = [];
      for (let day = startOfDay(dayOf(from)); day <= to; day += DAY_MS) {
        if (days.has(dayOf(day))) lines.push(...(await readDay<T>(kind, dayOf(day))));
      }
      return lines.filter((line) => line.t >= from && line.t <= to).sort((a, b) => a.t - b.t);
    },

    /** The newest record, to know when the agent last recorded. */
    async lastSample(): Promise<SampleLine | null> {
      const days = (await files()).filter((file) => file.kind === 'samples').map((file) => file.day).sort();
      for (const day of days.reverse()) {
        const lines = await readDay<SampleLine>('samples', day);
        if (lines.length) return lines.reduce((latest, line) => (line.t > latest.t ? line : latest));
      }
      return null;
    },

    /** Keeps today and the days before it, `days` in all. */
    async prune(days: number, now: number) {
      const keepFrom = dayOf(startOfDay(dayOf(now)) - (days - 1) * DAY_MS);
      for (const file of await files()) if (file.day < keepFrom) await rm(join(dir, file.name), { force: true });
    },

    async clear() {
      for (const file of await files()) await rm(join(dir, file.name), { force: true });
    },

    async usage(): Promise<{ bytes: number; oldest: number | null }> {
      const all = await files();
      const sizes = await Promise.all(all.map((file) => stat(join(dir, file.name)).then((info) => info.size, () => 0)));
      const days = all.map((file) => file.day).sort();
      return { bytes: sizes.reduce((sum, size) => sum + size, 0), oldest: days.length ? startOfDay(days[0]!) : null };
    },

    /** Names of the interfaces, kept for records whose interface is no longer picked. */
    interfaceNames,

    async rememberInterfaces(selection: Array<{ id: string; name: string }>) {
      const known = await interfaceNames();
      if (selection.every((nic) => known[nic.id] === nic.name)) return;
      names = { ...known, ...Object.fromEntries(selection.map((nic) => [nic.id, nic.name])) };
      await mkdir(dir, { recursive: true });
      const file = join(dir, INTERFACES_FILE);
      await writeFile(`${file}.tmp`, JSON.stringify(names));
      await rename(`${file}.tmp`, file);
    },
  };
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;

const round = (value: number) => Math.round(value * 10) / 10;

class Mean {
  sum = 0;
  count = 0;
  max = Number.NEGATIVE_INFINITY;
  add(value: number) {
    this.sum += value;
    this.count++;
    this.max = Math.max(this.max, value);
  }
  get value() {
    return this.count ? this.sum / this.count : null;
  }
}

/** Averages per step; steps without records are left out, so the chart shows them as gaps. */
export function aggregate(samples: SampleLine[], step: number): HistoryPoint[] {
  const buckets = new Map<number, { cpu: Mean[]; gpu: Mean[]; streams: Mean; transcodes: Mean; bitrate: Mean; network: Map<string, [Mean, Mean]> }>();
  for (const sample of samples) {
    const t = Math.floor(sample.t / step) * step;
    let bucket = buckets.get(t);
    if (!bucket) {
      bucket = { cpu: [new Mean(), new Mean(), new Mean()], gpu: [new Mean(), new Mean(), new Mean()], streams: new Mean(), transcodes: new Mean(), bitrate: new Mean(), network: new Map() };
      buckets.set(t, bucket);
    }
    sample.cpu?.forEach((value, index) => bucket.cpu[index]!.add(value));
    sample.gpu?.forEach((value, index) => bucket.gpu[index]!.add(value));
    if (sample.streams) {
      bucket.streams.add(sample.streams[0]);
      bucket.transcodes.add(sample.streams[1]);
      bucket.bitrate.add(sample.streams[2] ?? 0);
    }
    for (const [id, [rx, tx]] of Object.entries(sample.net ?? {})) {
      const means = bucket.network.get(id) ?? [new Mean(), new Mean()];
      means[0].add(rx);
      means[1].add(tx);
      bucket.network.set(id, means);
    }
  }

  const value = (mean: Mean) => (mean.value === null ? null : round(mean.value));
  const max = (mean: Mean) => (mean.count ? round(mean.max) : null);
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, bucket]) => ({
      t,
      cpu: value(bucket.cpu[0]!),
      cpuMax: max(bucket.cpu[0]!),
      cpuJellyfin: value(bucket.cpu[1]!),
      cpuConversion: value(bucket.cpu[2]!),
      gpu: value(bucket.gpu[0]!),
      gpuMax: max(bucket.gpu[0]!),
      gpuJellyfin: value(bucket.gpu[1]!),
      gpuConversion: value(bucket.gpu[2]!),
      streams: max(bucket.streams),
      transcodes: max(bucket.transcodes),
      bitrate: bucket.bitrate.value === null ? null : Math.round(bucket.bitrate.value),
      network: Object.fromEntries([...bucket.network.entries()].map(([id, [rx, tx]]) => [id, { rx: Math.round(rx.value!), tx: Math.round(tx.value!) }])),
    }));
}

const ORDER = { start: 0, change: 1, stop: 2 } as const;

/** Start, changes and stop of each stream put together; only streams that ran at some time between from and to. */
export function spansOf(events: StreamEvent[], from: number, to: number, playing: ReadonlySet<string>): StreamSpan[] {
  const spans: StreamSpan[] = [];
  const open = new Map<string, StreamSpan>();
  for (const event of [...events].sort((a, b) => a.t - b.t || ORDER[a.type] - ORDER[b.type])) {
    let span = open.get(event.stream);
    if (event.type === 'start' || !span) {
      span = { id: event.stream, start: event.t, end: null, ongoing: false, phases: [] };
      spans.push(span);
      open.set(event.stream, span);
    }
    if (event.type === 'stop') {
      span.end = event.t;
      // Only the stop is known: it still tells what played.
      if (!span.phases.length) span.phases.push(event);
      open.delete(event.stream);
    } else {
      span.phases.push(event);
    }
  }
  for (const [id, span] of open) span.ongoing = playing.has(id);
  return spans.filter((span) => span.start <= to && (span.ongoing ? Number.POSITIVE_INFINITY : (span.end ?? span.phases.at(-1)!.t)) >= from);
}

export interface RecorderOptions {
  dir: string;
  settings: SettingsStore;
  resources: Pick<ResourceMonitor, 'status'>;
  network: Pick<NetworkMonitor, 'status'>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Time between two records; 0 only on request (tests). */
  tickMs?: number;
  log?: (message: string) => void;
}

/**
 * Records load and streams while recording is switched on in Manelly: every tick the averages of
 * CPU, GPU and network since the last one, and what Jellyfin streams. The monitors keep measuring
 * as long as the recording asks them.
 */
export function createRecorder({ dir, settings, resources, network, fetch: fetchImpl = fetch, now = Date.now, tickMs = 15_000, log = () => {} }: RecorderOptions) {
  const store = createHistoryStore(dir);
  const tracker = createStreamTracker({ maxGapMs: Math.max(60_000, 4 * tickMs) });
  let active = false;
  let lastRecord = Number.NEGATIVE_INFINITY;
  let pruned = '';
  let error: string | null = null;
  let ticking: Promise<void> | null = null;

  /** Since when, and over which readings of a monitor, this record averages. */
  function fresh<T extends { t: number }>(points: T[], t: number): T[] {
    const recent = points.filter((point) => point.t > lastRecord && point.t <= t);
    if (recent.length) return recent;
    // Readings and records do not tick in step: take the last reading again if it is not old.
    const latest = points.at(-1);
    return latest && t - latest.t <= 2 * Math.max(tickMs, 15_000) ? [latest] : [];
  }

  const mean = (values: number[]) => round(values.reduce((sum, value) => sum + value, 0) / values.length);

  async function tickOnce() {
    const { history: config, jellyfin, network: selection } = settings.get();
    if (!config.enabled) {
      if (active) log('Aufzeichnung angehalten.');
      active = false;
      tracker.reset();
      return;
    }
    const t = now();
    if (!active) {
      // Streams that were open when the agent stopped: they end now, or play on.
      const last = await store.lastSample();
      tracker.restore(await store.read<StreamEvent>('streams', t - 2 * DAY_MS, t), last?.t ?? t);
      lastRecord = Number.NEGATIVE_INFINITY;
      active = true;
      log('Aufzeichnung läuft.');
    }
    // Once a day, and right away when the retention changed.
    if (`${dayOf(t)}|${config.retentionDays}` !== pruned) {
      pruned = `${dayOf(t)}|${config.retentionDays}`;
      await store.prune(config.retentionDays, t);
    }

    const line: SampleLine = { t };
    const load = fresh(resources.status(true).history, t);
    if (load.length) {
      line.cpu = [mean(load.map((point) => point.cpu)), mean(load.map((point) => point.cpuJellyfin)), mean(load.map((point) => point.cpuConversion))];
      const gpu = load.filter((point) => point.gpu !== null);
      if (gpu.length) line.gpu = [mean(gpu.map((point) => point.gpu!)), mean(gpu.map((point) => point.gpuJellyfin ?? 0)), mean(gpu.map((point) => point.gpuConversion ?? 0))];
    }
    const net: Record<string, [number, number]> = {};
    for (const nic of network.status().interfaces) {
      const points = fresh(nic.history, t);
      if (points.length) net[nic.id] = [Math.round(mean(points.map((point) => point.rxBps))), Math.round(mean(points.map((point) => point.txBps)))];
    }
    if (Object.keys(net).length) {
      line.net = net;
      await store.rememberInterfaces(selection);
    }

    if (!jellyfin) {
      error = 'Manelly hat dem Agent noch keine Jellyfin-Verbindung übergeben – die Streams fehlen deshalb.';
    } else {
      try {
        const { events, counts } = tracker.update(await createJellyfinApi(jellyfin, fetchImpl).sessions(), t);
        line.streams = [counts.streams, counts.transcodes, counts.bitrate];
        for (const event of events) await store.append('streams', event);
        error = null;
      } catch (cause) {
        error = `Streams nicht aufgezeichnet: ${(cause as Error).message}`;
      }
    }

    if (line.cpu || line.net || line.streams) await store.append('samples', line);
    lastRecord = t;
  }

  function tick(): Promise<void> {
    ticking ??= tickOnce()
      .catch((cause: unknown) => log(`Aufzeichnung: ${(cause as Error).message}`))
      .finally(() => {
        ticking = null;
      });
    return ticking;
  }

  const timer = tickMs > 0 ? setInterval(() => void tick(), tickMs) : null;
  timer?.unref();
  if (timer) setTimeout(() => void tick(), 2000).unref();

  return {
    tick,

    async query(from: number, to: number): Promise<HistoryResponse> {
      const step = stepFor(to - from);
      const [samples, events, names, usage] = await Promise.all([
        store.read<SampleLine>('samples', from, to),
        // A stream that ran into the range may have started the day before.
        store.read<StreamEvent>('streams', from - DAY_MS, to),
        store.interfaceNames(),
        store.usage(),
      ]);
      const points = aggregate(samples, step);
      const current = Object.fromEntries(settings.get().network.map((nic) => [nic.id, nic.name]));
      const ids = [...new Set(points.flatMap((point) => Object.keys(point.network)))];
      return {
        settings: settings.get().history,
        from,
        to,
        step,
        points,
        streams: spansOf(events, from, to, active ? tracker.playing() : new Set()),
        interfaces: ids.map((id) => ({ id, name: current[id] ?? names[id] ?? id })),
        oldest: usage.oldest,
        bytes: usage.bytes,
        error: active ? error : null,
      };
    },

    clear: () => store.clear(),

    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;
