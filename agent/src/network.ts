import { readdir, readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import type { AgentNetworkInterface, AgentNetworkStatus, MonitoredInterface, NetworkRatePoint } from '@manelly/shared';
import { ASCII_JSON, defaultPowershell, runPowershell, streamPowershell } from './powershell.js';
import type { NetworkSelection } from './schedule.js';

/** One reading of the byte counters of the monitored interfaces. */
export interface CounterSample {
  t: number;
  nics: Array<{ id: string; rx: number; tx: number; up: boolean; speed: number | null }>;
}

/** Where the counters come from. */
export interface CounterSource {
  list(): Promise<AgentNetworkInterface[]>;
  /** Reads the counters of these interfaces every `intervalMs` until the returned function is called. */
  start(ids: string[], intervalMs: number, onSample: (sample: CounterSample) => void, onError: (message: string) => void): () => void;
}

const speedOf = (value: unknown) => (typeof value === 'number' && value > 0 && value < 1e13 ? value : null);

// --- Windows: the .NET counters, read by Windows PowerShell ------------------------------

const LIST_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$list = @(foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
  $type = [string]$nic.NetworkInterfaceType
  if ($type -eq 'Loopback' -or $type -eq 'Tunnel') { continue }
  [pscustomobject]@{
    id = $nic.Id; name = $nic.Name; description = $nic.Description; type = $type
    up = ([string]$nic.OperationalStatus -eq 'Up'); speed = $nic.Speed
    addresses = @($nic.GetIPProperties().UnicastAddresses | ForEach-Object { $_.Address.ToString() })
  }
})
$json = ConvertTo-Json -Compress -Depth 4 -InputObject $list
[Console]::Out.Write(${ASCII_JSON})
`;

const sampleScript = (ids: string[], intervalMs: number) => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ids = @(${ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ')})
while ($true) {
  $nics = @(foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($ids -notcontains $nic.Id) { continue }
    try {
      $stats = $nic.GetIPStatistics()
      [pscustomobject]@{ id = $nic.Id; rx = $stats.BytesReceived; tx = $stats.BytesSent; up = ([string]$nic.OperationalStatus -eq 'Up'); speed = $nic.Speed }
    } catch { }
  })
  $json = ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{ nics = $nics })
  [Console]::Out.WriteLine(${ASCII_JSON})
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${Math.round(intervalMs)}
}
`;

export function powershellSource({ executable, now = Date.now }: { executable: string; now?: () => number }): CounterSource {
  return {
    async list() {
      let list: Array<Omit<AgentNetworkInterface, 'speedBps'> & { speed?: number }>;
      try {
        list = JSON.parse(await runPowershell(executable, LIST_SCRIPT)) as typeof list;
      } catch (error) {
        const message = (error as Error).message;
        throw new Error(message.startsWith('PowerShell') ? message : `Die Netzwerkschnittstellen liessen sich nicht lesen: ${message}`);
      }
      return list.map(({ speed, ...nic }) => ({ ...nic, description: nic.description || null, addresses: nic.addresses ?? [], speedBps: speedOf(speed) }));
    },

    start(ids, intervalMs, onSample, onError) {
      return streamPowershell(
        executable,
        sampleScript(ids, intervalMs),
        (line) => {
          try {
            const { nics } = JSON.parse(line) as { nics: Array<{ id: string; rx: number; tx: number; up: boolean; speed: number }> };
            onSample({ t: now(), nics: (nics ?? []).map((nic) => ({ ...nic, speed: speedOf(nic.speed) })) });
          } catch {
            // A broken line; the next one follows shortly.
          }
        },
        onError,
      );
    },
  };
}

// --- Linux: the kernel's counters in sysfs -------------------------------------------

const systemAddresses = (name: string) => (networkInterfaces()[name] ?? []).map((entry) => entry.address);

export function sysfsSource({
  root = '/sys/class/net',
  addressesOf = systemAddresses,
  now = Date.now,
}: { root?: string; addressesOf?: (name: string) => string[]; now?: () => number } = {}): CounterSource {
  const read = (name: string, file: string) => readFile(path.join(root, name, file), 'utf8').then((text) => text.trim());
  const exists = (name: string, entry: string) => stat(path.join(root, name, entry)).then(() => true, () => false);

  return {
    async list() {
      const names = (await readdir(root)).filter((name) => name !== 'lo').sort();
      return Promise.all(
        names.map(async (name): Promise<AgentNetworkInterface> => {
          const mbit = Number(await read(name, 'speed').catch(() => ''));
          const type = (await exists(name, 'wireless')) ? 'Wireless80211' : (await exists(name, 'device')) ? 'Ethernet' : 'Virtual';
          return {
            id: name,
            name,
            description: null,
            type,
            up: (await read(name, 'operstate').catch(() => 'down')) === 'up',
            speedBps: speedOf(mbit * 1e6),
            addresses: addressesOf(name),
          };
        }),
      );
    },

    start(ids, intervalMs, onSample, onError) {
      let failed = false;
      const sample = async () => {
        try {
          const nics = await Promise.all(
            ids.map(async (id) => ({
              id,
              rx: Number(await read(id, 'statistics/rx_bytes')),
              tx: Number(await read(id, 'statistics/tx_bytes')),
              up: (await read(id, 'operstate').catch(() => 'down')) === 'up',
              speed: speedOf(Number(await read(id, 'speed').catch(() => '')) * 1e6),
            })),
          );
          onSample({ t: now(), nics });
        } catch (error) {
          if (failed) return;
          failed = true;
          clearInterval(timer);
          onError(`Die Zähler der Netzwerkschnittstellen liessen sich nicht lesen: ${(error as Error).message}`);
        }
      };
      const timer = setInterval(() => void sample(), intervalMs);
      void sample();
      return () => clearInterval(timer);
    },
  };
}

export function defaultSource(platform: NodeJS.Platform = process.platform): CounterSource | null {
  if (platform === 'win32') return powershellSource({ executable: defaultPowershell() });
  if (platform === 'linux') return sysfsSource();
  return null;
}

// --- Monitor ---------------------------------------------------------------------------

export interface NetworkMonitorOptions {
  /** null: this system is not supported. */
  source: CounterSource | null;
  selection: () => NetworkSelection[];
  intervalMs?: number;
  /** Measuring stops this long after Manelly last asked. */
  lingerMs?: number;
  historyMs?: number;
  /** A failed measurement is retried after this long at the earliest. */
  retryMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

/** Measures the selected interfaces while Manelly asks for them, and keeps the rates of the last minutes. */
export function createNetworkMonitor(options: NetworkMonitorOptions) {
  const { source, selection, intervalMs = 2000, lingerMs = 10 * 60_000, historyMs = 10 * 60_000, retryMs = 30_000, now = Date.now, log = () => {} } = options;
  const last = new Map<string, { t: number; rx: number; tx: number }>();
  const state = new Map<string, { up: boolean; speed: number | null }>();
  const history = new Map<string, NetworkRatePoint[]>();
  let stopSampler: (() => void) | null = null;
  let lastDemand = Number.NEGATIVE_INFINITY;
  let failedAt = Number.NEGATIVE_INFINITY;
  let error: string | null = null;

  function onSample(sample: CounterSample) {
    error = null;
    for (const nic of sample.nics) {
      state.set(nic.id, { up: nic.up, speed: nic.speed });
      const previous = last.get(nic.id);
      last.set(nic.id, { t: sample.t, rx: nic.rx, tx: nic.tx });
      if (!previous || sample.t <= previous.t) continue;
      const seconds = (sample.t - previous.t) / 1000;
      const rxBps = ((nic.rx - previous.rx) * 8) / seconds;
      const txBps = ((nic.tx - previous.tx) * 8) / seconds;
      // A counter that went back (adapter reset) gives no rate.
      if (rxBps < 0 || txBps < 0) continue;
      const points = history.get(nic.id) ?? [];
      points.push({ t: sample.t, rxBps: Math.round(rxBps), txBps: Math.round(txBps) });
      while (points.length && points[0]!.t < sample.t - historyMs) points.shift();
      history.set(nic.id, points);
    }
  }

  function stop() {
    stopSampler?.();
    stopSampler = null;
    // A later start must not compute a rate across the gap.
    last.clear();
    state.clear();
    history.clear();
  }

  function ensureRunning() {
    const ids = selection().map((entry) => entry.id);
    if (!source || ids.length === 0 || stopSampler || now() - failedAt < retryMs) return;
    log(`Netzwerkmessung gestartet: ${selection().map((entry) => entry.name).join(', ')}`);
    stopSampler = source.start(ids, intervalMs, onSample, (message) => {
      log(message);
      error = message;
      failedAt = now();
      stopSampler = null;
      last.clear();
    });
  }

  const linger = setInterval(() => {
    if (stopSampler && now() - lastDemand > lingerMs) {
      log('Netzwerkmessung angehalten – niemand schaut zu.');
      stop();
    }
  }, Math.min(30_000, lingerMs));
  linger.unref();

  return {
    list: async (): Promise<AgentNetworkInterface[]> => {
      if (!source) throw new Error('Auf diesem System kann der Agent das Netzwerk nicht messen (nur Windows und Linux).');
      return source.list();
    },

    /** The monitored interfaces with their rates; starts measuring if needed. */
    status(): AgentNetworkStatus {
      lastDemand = now();
      ensureRunning();
      const fresh = now() - 3 * intervalMs;
      const interfaces = selection().map((entry): MonitoredInterface => {
        const points = history.get(entry.id) ?? [];
        const latest = points.at(-1);
        const current = latest && latest.t >= fresh ? latest : null;
        return {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          roles: entry.roles,
          up: state.get(entry.id)?.up ?? true,
          speedBps: state.get(entry.id)?.speed ?? null,
          rxBps: current?.rxBps ?? null,
          txBps: current?.txBps ?? null,
          history: points,
        };
      });
      const unsupported = source ? null : 'Auf diesem System kann der Agent das Netzwerk nicht messen (nur Windows und Linux).';
      return { interfaces, intervalMs, error: unsupported ?? error };
    },

    /** After the selection changed: measure the new set from scratch. */
    restart() {
      const running = Boolean(stopSampler);
      stop();
      failedAt = Number.NEGATIVE_INFINITY;
      error = null;
      if (running) ensureRunning();
    },

    stop() {
      clearInterval(linger);
      stop();
    },
  };
}

export type NetworkMonitor = ReturnType<typeof createNetworkMonitor>;
