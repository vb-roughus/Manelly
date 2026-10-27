import { readdir, readFile } from 'node:fs/promises';
import { cpus as systemCpus } from 'node:os';
import path from 'node:path';
import type { AgentResourceStatus, GpuEngineUsage, GpuUsage, ResourcePoint, ResourceProcess, ResourceRole } from '@manelly/shared';
import { ASCII_JSON, defaultPowershell, streamPowershell } from './powershell.js';

/** The processes whose share is shown: Jellyfin transcodes with ffmpeg, a conversion also runs dovi_tool and mkvmerge. */
const WATCHED = ['ffmpeg', 'dovi_tool', 'mkvmerge'];
/** GPU engines that matter for video, shown even while idle. */
const VIDEO_ENGINES = ['VideoDecode', 'VideoEncode', 'VideoProcessing', '3D'];

/** One reading of the watched processes and the busy GPU engines. */
export interface ResourceSample {
  t: number;
  /** cpu: percent of one core, as Windows reports it. */
  procs: Array<{ pid: number; name: string; cpu: number }>;
  gpu: {
    adapters: Array<{ id: string; name: string }>;
    /** Busy engines only; pid null when only the adapter's total is known. */
    engines: Array<{ pid: number | null; adapter: string; engine: number; type: string; util: number }>;
    /** Whether the engines are known per process (and per engine type). */
    perProcess: boolean;
    /** Why there are no GPU values; null when there are. */
    note: string | null;
  };
}

export interface ResourceSource {
  start(intervalMs: number, onSample: (sample: ResourceSample) => void, onError: (message: string) => void): () => void;
}

// --- Windows: performance counters through WMI -----------------------------------------
// The class names are English on every Windows, unlike the counter names typeperf uses.
// Utilization per GPU engine and process is what the Task Manager shows.

const sampleScript = (intervalMs: number) => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Names of the graphics adapters by LUID, the way the GPU counters name them.
$names = @{}
try {
  foreach ($key in Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' -ErrorAction Stop) {
    $p = Get-ItemProperty $key.PSPath
    if ($null -ne $p.AdapterLuid -and $p.Description) {
      $l = [int64]$p.AdapterLuid
      $names[('luid_0x{0:x8}_0x{1:x8}' -f (($l -shr 32) -band [int64]4294967295), ($l -band [int64]4294967295))] = [string]$p.Description
    }
  }
} catch { }
$gpuNote = $null
while ($true) {
  $procs = @(foreach ($p in Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name LIKE 'ffmpeg%' OR Name LIKE 'dovi_tool%' OR Name LIKE 'mkvmerge%'") {
    [pscustomobject]@{ pid = [int]$p.IDProcess; name = ($p.Name -replace '#\\d+$', ''); cpu = [double]$p.PercentProcessorTime }
  })
  $seen = @{}
  $engines = @()
  if ($null -eq $gpuNote) {
    try {
      $engines = @(foreach ($e in Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine) {
        if ($e.Name -notmatch '^pid_(\\d+)_(luid_0x[0-9a-f]+_0x[0-9a-f]+)_phys_\\d+_eng_(\\d+)_engtype_(.+)$') { continue }
        $luid = $Matches[2].ToLower()
        $seen[$luid] = $true
        $util = [double]$e.UtilizationPercentage
        if ($util -le 0) { continue }
        [pscustomobject]@{ pid = [int]$Matches[1]; adapter = $luid; engine = [int]$Matches[3]; type = $Matches[4]; util = $util }
      })
    } catch {
      $gpuNote = 'Windows liefert keine GPU-Auslastung (erst ab Windows 10 1709 mit einem WDDM-2-Grafiktreiber).'
    }
  }
  $adapters = @(foreach ($id in $seen.Keys) { [pscustomobject]@{ id = $id; name = $(if ($names[$id]) { $names[$id] } else { 'Grafikkarte' }) } })
  $json = ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{ procs = $procs; adapters = $adapters; engines = $engines; gpuNote = $gpuNote })
  [Console]::Out.WriteLine(${ASCII_JSON})
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${Math.round(intervalMs)}
}
`;

interface WindowsLine {
  procs?: Array<{ pid: number; name: string; cpu: number }>;
  adapters?: Array<{ id: string; name: string }>;
  engines?: Array<{ pid: number; adapter: string; engine: number; type: string; util: number }>;
  gpuNote?: string | null;
}

export function wmiSource({ executable, now = Date.now }: { executable: string; now?: () => number }): ResourceSource {
  return {
    start(intervalMs, onSample, onError) {
      return streamPowershell(
        executable,
        sampleScript(intervalMs),
        (line) => {
          let data: WindowsLine;
          try {
            data = JSON.parse(line) as WindowsLine;
          } catch {
            return; // A broken line; the next one follows shortly.
          }
          onSample({
            t: now(),
            procs: data.procs ?? [],
            gpu: { adapters: data.adapters ?? [], engines: data.engines ?? [], perProcess: true, note: data.gpuNote ?? null },
          });
        },
        onError,
      );
    },
  };
}

// --- Linux: /proc for the processes, sysfs for AMD graphics ----------------------------

export function procfsSource({
  proc = '/proc',
  drm = '/sys/class/drm',
  clockTicks = 100,
  now = Date.now,
}: { proc?: string; drm?: string; clockTicks?: number; now?: () => number } = {}): ResourceSource {
  return {
    start(intervalMs, onSample, onError) {
      const previous = new Map<number, { ticks: number; t: number }>();
      let failed = false;

      async function processes(t: number): Promise<ResourceSample['procs']> {
        const procs: ResourceSample['procs'] = [];
        const alive = new Set<number>();
        for (const entry of await readdir(proc)) {
          if (!/^\d+$/.test(entry)) continue;
          const pid = Number(entry);
          try {
            const name = (await readFile(path.join(proc, entry, 'comm'), 'utf8')).trim();
            if (!WATCHED.includes(name)) continue;
            // After the command in parentheses: state is the first field, utime and stime the 12th and 13th.
            const stat = await readFile(path.join(proc, entry, 'stat'), 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const ticks = Number(fields[11]) + Number(fields[12]);
            alive.add(pid);
            const before = previous.get(pid);
            previous.set(pid, { ticks, t });
            if (before && t > before.t) procs.push({ pid, name, cpu: (((ticks - before.ticks) / clockTicks) * 100_000) / (t - before.t) });
          } catch {
            // The process ended meanwhile.
          }
        }
        for (const pid of previous.keys()) if (!alive.has(pid)) previous.delete(pid);
        return procs;
      }

      async function graphics(): Promise<ResourceSample['gpu']> {
        const adapters: ResourceSample['gpu']['adapters'] = [];
        const engines: ResourceSample['gpu']['engines'] = [];
        const cards = await readdir(drm).catch(() => [] as string[]);
        for (const card of cards.filter((name) => /^card\d+$/.test(name))) {
          const busy = await readFile(path.join(drm, card, 'device', 'gpu_busy_percent'), 'utf8').catch(() => null);
          if (busy === null) continue;
          const name = (await readFile(path.join(drm, card, 'device', 'product_name'), 'utf8').catch(() => '')).trim();
          adapters.push({ id: card, name: name || `Grafikkarte (${card})` });
          const util = Number(busy.trim());
          if (util > 0) engines.push({ pid: null, adapter: card, engine: 0, type: 'Total', util });
        }
        const note = adapters.length ? null : 'Auf Linux kennt der Agent nur die Auslastung von AMD-Grafikkarten.';
        return { adapters, engines, perProcess: false, note };
      }

      let busy = false;
      async function sample() {
        // A slow reading is not overlapped by the next one; that would mix up the times.
        if (busy) return;
        busy = true;
        try {
          const t = now();
          const [procs, gpu] = await Promise.all([processes(t), graphics()]);
          onSample({ t, procs, gpu });
        } catch (error) {
          if (failed) return;
          failed = true;
          clearInterval(timer);
          onError(`Die Prozesse liessen sich nicht lesen: ${(error as Error).message}`);
        } finally {
          busy = false;
        }
      }
      const timer = setInterval(() => void sample(), intervalMs);
      void sample();
      return () => clearInterval(timer);
    },
  };
}

export function defaultResourceSource(platform: NodeJS.Platform = process.platform): ResourceSource | null {
  if (platform === 'win32') return wmiSource({ executable: defaultPowershell() });
  if (platform === 'linux') return procfsSource();
  return null;
}

// --- Monitor ---------------------------------------------------------------------------

export interface ResourceMonitorOptions {
  /** null: this system is not supported. */
  source: ResourceSource | null;
  /** Processes the agent started for the running conversion. */
  ownProcesses: () => ReadonlySet<number>;
  cpus?: () => Array<{ model: string; times: { user: number; nice: number; sys: number; idle: number; irq: number } }>;
  intervalMs?: number;
  /** While only the recording asks, not Manelly: reading the counters costs CPU itself. */
  backgroundIntervalMs?: number;
  /** Measuring stops this long after Manelly last asked. */
  lingerMs?: number;
  historyMs?: number;
  /** A failed measurement is retried after this long at the earliest. */
  retryMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

/** Manelly asks every few seconds while it shows CPU and GPU. */
const VIEWER_MS = 30_000;
const UNSUPPORTED = 'Auf diesem System kann der Agent CPU und GPU nicht messen (nur Windows und Linux).';
const round = (value: number) => Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;

/** Measures CPU and GPU while Manelly asks for them, and tells Jellyfin's FFmpeg and the agent's conversion apart. */
export function createResourceMonitor(options: ResourceMonitorOptions) {
  const {
    source,
    ownProcesses,
    cpus = systemCpus,
    intervalMs = 3000,
    backgroundIntervalMs = 10_000,
    lingerMs = 10 * 60_000,
    historyMs = 10 * 60_000,
    retryMs = 30_000,
    now = Date.now,
    log = () => {},
  } = options;
  let stopSampler: (() => void) | null = null;
  let pace = intervalMs;
  let lastDemand = Number.NEGATIVE_INFINITY;
  let lastViewer = Number.NEGATIVE_INFINITY;
  let failedAt = Number.NEGATIVE_INFINITY;
  let error: string | null = null;
  let cpuBefore: { busy: number; total: number } | null = null;
  let latest: Omit<AgentResourceStatus, 'history' | 'intervalMs' | 'error'> | null = null;
  let history: ResourcePoint[] = [];

  function cpuTimes() {
    let busy = 0;
    let total = 0;
    for (const { times } of cpus()) {
      const all = times.user + times.nice + times.sys + times.idle + times.irq;
      total += all;
      busy += all - times.idle;
    }
    return { busy, total };
  }

  function onSample(sample: ResourceSample) {
    error = null;
    const info = cpus();
    const cores = Math.max(1, info.length);
    const times = cpuTimes();
    const cpuTotal = cpuBefore && times.total > cpuBefore.total ? ((times.busy - cpuBefore.busy) / (times.total - cpuBefore.total)) * 100 : null;
    cpuBefore = times;

    const own = ownProcesses();
    const roleOf = (pid: number, name: string): ResourceRole => (own.has(pid) ? 'conversion' : name === 'ffmpeg' ? 'jellyfin' : 'other');
    const roles = new Map(sample.procs.map((proc) => [proc.pid, roleOf(proc.pid, proc.name)]));
    const cpuShare = (role: ResourceRole) => sample.procs.filter((proc) => roles.get(proc.pid) === role).reduce((sum, proc) => sum + proc.cpu / cores, 0);

    // Per adapter and engine type: the busiest engine of that type, with the share of each role on it.
    // Windows lists its software renderer like a graphics card.
    const adapters = sample.gpu.adapters.filter((adapter) => !/basic render/i.test(adapter.name));
    const gpus: GpuUsage[] = adapters.map((adapter) => {
      const byEngine = new Map<string, GpuEngineUsage>();
      for (const entry of sample.gpu.engines.filter((engine) => engine.adapter === adapter.id)) {
        const type = /^compute|cuda/i.test(entry.type) ? 'Compute' : entry.type;
        const key = `${type}#${entry.engine}`;
        const usage = byEngine.get(key) ?? { type, total: 0, jellyfin: 0, conversion: 0 };
        usage.total += entry.util;
        const role = entry.pid === null ? null : roles.get(entry.pid);
        if (role === 'jellyfin') usage.jellyfin += entry.util;
        if (role === 'conversion') usage.conversion += entry.util;
        byEngine.set(key, usage);
      }
      const busiest = new Map<string, GpuEngineUsage>();
      for (const usage of byEngine.values()) if ((busiest.get(usage.type)?.total ?? -1) < usage.total) busiest.set(usage.type, usage);
      if (sample.gpu.perProcess) for (const type of VIDEO_ENGINES) if (!busiest.has(type)) busiest.set(type, { type, total: 0, jellyfin: 0, conversion: 0 });
      if (!sample.gpu.perProcess && busiest.size === 0) busiest.set('Total', { type: 'Total', total: 0, jellyfin: 0, conversion: 0 });
      const engines = [...busiest.values()]
        .map((usage) => ({ type: usage.type, total: round(usage.total), jellyfin: round(usage.jellyfin), conversion: round(usage.conversion) }))
        .sort((a, b) => b.total - a.total || VIDEO_ENGINES.indexOf(a.type) - VIDEO_ENGINES.indexOf(b.type));
      return { id: adapter.id, name: adapter.name, engines, sharesKnown: sample.gpu.perProcess };
    });

    const processes: ResourceProcess[] = sample.procs
      .map((proc) => {
        const engines = sample.gpu.engines.filter((engine) => engine.pid === proc.pid);
        return {
          pid: proc.pid,
          name: proc.name,
          role: roles.get(proc.pid)!,
          cpu: round(proc.cpu / cores),
          gpu: sample.gpu.perProcess ? round(Math.max(0, ...engines.map((engine) => engine.util))) : null,
        };
      })
      .sort((a, b) => b.cpu - a.cpu);

    const cpu = cpuTotal === null ? null : { total: round(cpuTotal), jellyfin: round(cpuShare('jellyfin')), conversion: round(cpuShare('conversion')), model: info[0]?.model.trim() || null, cores };
    latest = { cpu, gpus, gpuNote: sample.gpu.note, processes };

    if (cpu) {
      const peak = gpus.flatMap((gpu) => gpu.engines).sort((a, b) => b.total - a.total)[0];
      history.push({
        t: sample.t,
        cpu: cpu.total,
        cpuJellyfin: cpu.jellyfin,
        cpuConversion: cpu.conversion,
        gpu: peak ? peak.total : null,
        gpuJellyfin: peak ? peak.jellyfin : null,
        gpuConversion: peak ? peak.conversion : null,
      });
      history = history.filter((point) => point.t >= sample.t - historyMs);
    }
  }

  function stop() {
    stopSampler?.();
    stopSampler = null;
    cpuBefore = null;
    latest = null;
    history = [];
  }

  function ensureRunning() {
    // Somebody looks at it in Manelly (which asks every few seconds), or only the recording does.
    const wanted = now() - lastViewer <= VIEWER_MS ? intervalMs : backgroundIntervalMs;
    if (!source || (stopSampler && pace === wanted) || now() - failedAt < retryMs) return;
    if (stopSampler) {
      stopSampler();
      // Readings further apart would show as gaps in the dashboard's chart.
      if (wanted < pace) history = [];
    } else {
      log('CPU-/GPU-Messung gestartet.');
    }
    pace = wanted;
    // The first reading is only the baseline; a few milliseconds of CPU time say nothing.
    cpuBefore = null;
    stopSampler = source.start(pace, onSample, (message) => {
      log(message);
      error = message;
      failedAt = now();
      stopSampler = null;
    });
  }

  const linger = setInterval(() => {
    if (stopSampler && now() - lastDemand > lingerMs) {
      log('CPU-/GPU-Messung angehalten – niemand schaut zu.');
      stop();
    }
  }, Math.min(30_000, lingerMs));
  linger.unref();

  return {
    supported: source !== null,

    /** CPU and GPU right now and in the last minutes; starts measuring if needed. `background`: asked by the recording, not by Manelly. */
    status(background = false): AgentResourceStatus {
      lastDemand = now();
      if (!background) lastViewer = lastDemand;
      ensureRunning();
      return {
        cpu: latest?.cpu ?? null,
        gpus: latest?.gpus ?? [],
        gpuNote: latest?.gpuNote ?? null,
        processes: latest?.processes ?? [],
        history,
        intervalMs: pace,
        error: source ? error : UNSUPPORTED,
      };
    },

    stop() {
      clearInterval(linger);
      stop();
    },
  };
}

export type ResourceMonitor = ReturnType<typeof createResourceMonitor>;
