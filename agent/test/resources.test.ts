import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createResourceMonitor, procfsSource, wmiSource, type ResourceSample, type ResourceSource } from '../src/resources.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manelly-res-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const waitFor = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
};

describe('Linux', () => {
  /** A process as /proc shows it; utime and stime in clock ticks. */
  async function process(pid: number, name: string, ticks: number) {
    await mkdir(path.join(root, 'proc', String(pid)), { recursive: true });
    // The name never changes, as with real processes.
    await writeFile(path.join(root, 'proc', String(pid), 'comm'), `${name}\n`, { flag: 'wx' }).catch(() => {});
    // The command may contain ") ", so it is cut at the last parenthesis.
    // Replaced at once, like the kernel's file is never read half-written.
    const stat = path.join(root, 'proc', String(pid), 'stat');
    await writeFile(`${stat}.tmp`, `${pid} (${name}) S 1 1 1 0 -1 4194304 100 0 0 0 ${ticks} 0 0 0 20 0 1 0`);
    await rename(`${stat}.tmp`, stat);
  }

  it('reads the CPU time of the watched processes and the load of AMD graphics', async () => {
    await process(100, 'ffmpeg', 1000);
    await process(200, 'bash', 5000);
    await mkdir(path.join(root, 'drm', 'card0', 'device'), { recursive: true });
    await mkdir(path.join(root, 'drm', 'card0-HDMI-A-1'), { recursive: true });
    await writeFile(path.join(root, 'drm', 'card0', 'device', 'gpu_busy_percent'), '37\n');
    await writeFile(path.join(root, 'drm', 'card0', 'device', 'product_name'), 'Radeon RX 6400\n');

    const samples: ResourceSample[] = [];
    const source = procfsSource({ proc: path.join(root, 'proc'), drm: path.join(root, 'drm'), now: () => 0 });
    const stop = source.start(60_000, (sample) => samples.push(sample), () => {});
    await waitFor(() => samples.length === 1);
    // The first reading gives no rate yet.
    expect(samples[0]?.procs).toEqual([]);
    expect(samples[0]?.gpu).toEqual({
      adapters: [{ id: 'card0', name: 'Radeon RX 6400' }],
      engines: [{ pid: null, adapter: 'card0', engine: 0, type: 'Total', util: 37 }],
      perProcess: false,
      note: null,
    });
    stop();

    // Every reading is one second later; 150 ticks of 1/100 s in one second are 150 % of one core.
    let seconds = 0;
    const second: ResourceSample[] = [];
    const again = procfsSource({ proc: path.join(root, 'proc'), drm: path.join(root, 'drm'), now: () => ++seconds * 1000 });
    const stopAgain = again.start(20, (sample) => second.push(sample), () => {});
    await waitFor(() => second.length === 1);
    await process(100, 'ffmpeg', 1150);
    await waitFor(() => second.some((sample) => sample.procs[0]?.cpu === 150));
    stopAgain();
    expect(second.find((sample) => sample.procs[0]?.cpu === 150)?.procs).toEqual([{ pid: 100, name: 'ffmpeg', cpu: 150 }]);
  });

  it('says why there are no GPU values without AMD graphics', async () => {
    await mkdir(path.join(root, 'proc'), { recursive: true });
    const samples: ResourceSample[] = [];
    const stop = procfsSource({ proc: path.join(root, 'proc'), drm: path.join(root, 'none') }).start(60_000, (sample) => samples.push(sample), () => {});
    await waitFor(() => samples.length === 1);
    stop();
    expect(samples[0]?.gpu.note).toBe('Auf Linux kennt der Agent nur die Auslastung von AMD-Grafikkarten.');
  });
});

describe('Windows', () => {
  it('reads the processes and GPU engines that PowerShell reports', async () => {
    const executable = path.join(root, 'powershell');
    // Stands in for powershell.exe: answers like the WMI script does.
    await writeFile(
      executable,
      `#!/usr/bin/env node
const script = Buffer.from(process.argv[process.argv.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
if (!script.includes('GPUPerformanceCounters_GPUEngine') || !script.includes('PerfProc_Process')) process.exit(3);
console.log(JSON.stringify({
  procs: [{ pid: 4242, name: 'ffmpeg', cpu: 180 }],
  adapters: [{ id: 'luid_0x00000000_0x0000d1b5', name: 'Intel(R) UHD Graphics 630' }],
  engines: [{ pid: 4242, adapter: 'luid_0x00000000_0x0000d1b5', engine: 2, type: 'VideoDecode', util: 41 }],
  gpuNote: null,
}));
setInterval(() => {}, 1000);
`,
    );
    await chmod(executable, 0o755);
    const samples: ResourceSample[] = [];
    const stop = wmiSource({ executable, now: () => 5 }).start(3000, (sample) => samples.push(sample), () => {});
    await waitFor(() => samples.length > 0);
    stop();
    expect(samples[0]).toEqual({
      t: 5,
      procs: [{ pid: 4242, name: 'ffmpeg', cpu: 180 }],
      gpu: {
        adapters: [{ id: 'luid_0x00000000_0x0000d1b5', name: 'Intel(R) UHD Graphics 630' }],
        engines: [{ pid: 4242, adapter: 'luid_0x00000000_0x0000d1b5', engine: 2, type: 'VideoDecode', util: 41 }],
        perProcess: true,
        note: null,
      },
    });
  });
});

describe('monitor', () => {
  /** Four cores; each call advances busy and idle time by the given amounts per core. */
  function fakeCpus() {
    const state = { busy: 0, idle: 0, step: { busy: 0, idle: 0 } };
    return {
      state,
      cpus: () => {
        state.busy += state.step.busy;
        state.idle += state.step.idle;
        return Array.from({ length: 4 }, () => ({ model: 'Intel(R) Core(TM) i5-9500 CPU @ 3.00GHz ', times: { user: state.busy, nice: 0, sys: 0, idle: state.idle, irq: 0 } }));
      },
    };
  }

  function manualSource() {
    const state = { starts: 0, stops: 0, emit: (_sample: ResourceSample) => {} };
    const source: ResourceSource = {
      start(_interval, onSample) {
        state.starts++;
        state.emit = onSample;
        return () => void state.stops++;
      },
    };
    return { source, state };
  }

  const ADAPTER = { id: 'luid_a', name: 'Intel(R) UHD Graphics 630' };

  it('splits CPU and GPU into Jellyfin, the conversion and the rest', () => {
    const { source, state } = manualSource();
    const cpu = fakeCpus();
    const monitor = createResourceMonitor({ source, ownProcesses: () => new Set([2]), cpus: cpu.cpus, now: () => 9000 });
    expect(monitor.status()).toMatchObject({ cpu: null, gpus: [], history: [], error: null });

    // The first reading is the baseline.
    const idle: ResourceSample = { t: 6000, procs: [], gpu: { adapters: [], engines: [], perProcess: true, note: null } };
    state.emit(idle);
    expect(monitor.status()).toMatchObject({ cpu: null, history: [] });

    cpu.state.step = { busy: 60, idle: 40 };
    state.emit({
      t: 9000,
      // Percent of one core: 160 of 400 is 40 % of the CPU.
      procs: [
        { pid: 1, name: 'ffmpeg', cpu: 160 },
        { pid: 2, name: 'dovi_tool', cpu: 40 },
        { pid: 3, name: 'mkvmerge', cpu: 8 },
      ],
      gpu: {
        adapters: [ADAPTER, { id: 'luid_b', name: 'Microsoft Basic Render Driver' }],
        engines: [
          { pid: 1, adapter: 'luid_a', engine: 0, type: 'VideoDecode', util: 30 },
          { pid: 9, adapter: 'luid_a', engine: 0, type: 'VideoDecode', util: 5 },
          { pid: 1, adapter: 'luid_a', engine: 1, type: 'VideoDecode', util: 12 },
          { pid: 1, adapter: 'luid_a', engine: 4, type: 'Compute_0', util: 3 },
        ],
        perProcess: true,
        note: null,
      },
    });

    const status = monitor.status();
    expect(status.cpu).toEqual({ total: 60, jellyfin: 40, conversion: 10, model: 'Intel(R) Core(TM) i5-9500 CPU @ 3.00GHz', cores: 4 });
    expect(status.gpus).toEqual([
      {
        id: 'luid_a',
        name: 'Intel(R) UHD Graphics 630',
        engines: [
          // The busier of the two decode engines.
          { type: 'VideoDecode', total: 35, jellyfin: 30, conversion: 0 },
          { type: 'Compute', total: 3, jellyfin: 3, conversion: 0 },
          { type: 'VideoEncode', total: 0, jellyfin: 0, conversion: 0 },
          { type: 'VideoProcessing', total: 0, jellyfin: 0, conversion: 0 },
          { type: '3D', total: 0, jellyfin: 0, conversion: 0 },
        ],
        sharesKnown: true,
      },
    ]);
    expect(status.processes).toEqual([
      { pid: 1, name: 'ffmpeg', role: 'jellyfin', cpu: 40, gpu: 30 },
      { pid: 2, name: 'dovi_tool', role: 'conversion', cpu: 10, gpu: 0 },
      { pid: 3, name: 'mkvmerge', role: 'other', cpu: 2, gpu: 0 },
    ]);
    expect(status.history).toEqual([{ t: 9000, cpu: 60, cpuJellyfin: 40, cpuConversion: 10, gpu: 35, gpuJellyfin: 30, gpuConversion: 0 }]);
    monitor.stop();
  });

  it('stops measuring when nobody has looked for a while', async () => {
    let clock = 0;
    const { source, state } = manualSource();
    const monitor = createResourceMonitor({ source, ownProcesses: () => new Set(), cpus: fakeCpus().cpus, lingerMs: 20, now: () => clock });
    monitor.status();
    clock = 1000;
    await waitFor(() => state.stops > 0);
    expect(state).toMatchObject({ starts: 1, stops: 1 });
    monitor.stop();
  });

  it('reports unsupported systems', () => {
    const monitor = createResourceMonitor({ source: null, ownProcesses: () => new Set() });
    expect(monitor.supported).toBe(false);
    expect(monitor.status().error).toMatch(/nur Windows und Linux/);
    monitor.stop();
  });
});
