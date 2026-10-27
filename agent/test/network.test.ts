import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNetworkMonitor, powershellSource, sysfsSource, type CounterSample, type CounterSource } from '../src/network.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manelly-net-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A network interface as Linux shows it in /sys/class/net. */
async function sysfsInterface(name: string, files: Record<string, string>, dirs: string[] = []) {
  await mkdir(path.join(root, name, 'statistics'), { recursive: true });
  for (const dir of dirs) await mkdir(path.join(root, name, dir));
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(root, name, file), `${content}\n`);
}

const waitFor = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
};

describe('Linux counters', () => {
  it('lists the interfaces with type and link speed, and reads their counters', async () => {
    await sysfsInterface('eth0', { operstate: 'up', speed: '1000', 'statistics/rx_bytes': '1000', 'statistics/tx_bytes': '5000' }, ['device']);
    await sysfsInterface('wlan0', { operstate: 'down', speed: '-1', 'statistics/rx_bytes': '0', 'statistics/tx_bytes': '0' }, ['device', 'wireless']);
    await sysfsInterface('docker0', { operstate: 'up', 'statistics/rx_bytes': '0', 'statistics/tx_bytes': '0' });
    await sysfsInterface('lo', { operstate: 'unknown' });
    const source = sysfsSource({ root, addressesOf: (name) => (name === 'eth0' ? ['192.168.1.2'] : []), now: () => 42 });

    expect(await source.list()).toEqual([
      { id: 'docker0', name: 'docker0', description: null, type: 'Virtual', up: true, speedBps: null, addresses: [] },
      { id: 'eth0', name: 'eth0', description: null, type: 'Ethernet', up: true, speedBps: 1e9, addresses: ['192.168.1.2'] },
      { id: 'wlan0', name: 'wlan0', description: null, type: 'Wireless80211', up: false, speedBps: null, addresses: [] },
    ]);

    const samples: CounterSample[] = [];
    const stop = source.start(['eth0'], 1000, (sample) => samples.push(sample), () => {});
    await waitFor(() => samples.length > 0);
    stop();
    expect(samples[0]).toEqual({ t: 42, nics: [{ id: 'eth0', rx: 1000, tx: 5000, up: true, speed: 1e9 }] });
  });
});

describe('Windows counters', () => {
  /** Stands in for powershell.exe: answers the list script and the sample script like .NET on Windows would. */
  async function fakePowershell() {
    const file = path.join(root, 'powershell');
    await writeFile(
      file,
      `#!/usr/bin/env node
const script = Buffer.from(process.argv[process.argv.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
if (!script.includes('GetIPStatistics')) {
  // Escaped like the real script does it: "Bluetooth-Netzwerkverbindung Ä".
  console.log(JSON.stringify([
    { id: '{A1}', name: 'Ethernet', description: 'Intel(R) Ethernet I219-V', type: 'Ethernet', up: true, speed: 1000000000, addresses: ['192.168.1.2', 'fe80::1'] },
    { id: '{B2}', name: 'Bluetooth-Netzwerkverbindung \\\\u00c4', description: '', type: 'Ethernet', up: false, speed: -1, addresses: [] },
  ]).replace(/\\\\\\\\u/g, '\\\\u'));
} else {
  const ids = [...script.matchAll(/'(\\{[^']+\\})'/g)].map((match) => match[1]);
  let n = 0;
  const tick = () => { n++; console.log(JSON.stringify({ nics: ids.map((id) => ({ id, rx: n * 1000, tx: n * 10000, up: true, speed: 1000000000 })) })); };
  tick();
  setInterval(tick, 50);
}
`,
    );
    await chmod(file, 0o755);
    return file;
  }

  it('reads the interfaces and the counters from PowerShell', async () => {
    const source = powershellSource({ executable: await fakePowershell(), now: () => 7 });
    expect(await source.list()).toEqual([
      { id: '{A1}', name: 'Ethernet', description: 'Intel(R) Ethernet I219-V', type: 'Ethernet', up: true, speedBps: 1e9, addresses: ['192.168.1.2', 'fe80::1'] },
      { id: '{B2}', name: 'Bluetooth-Netzwerkverbindung Ä', description: null, type: 'Ethernet', up: false, speedBps: null, addresses: [] },
    ]);

    const samples: CounterSample[] = [];
    const errors: string[] = [];
    const stop = source.start(['{A1}'], 50, (sample) => samples.push(sample), (message) => errors.push(message));
    await waitFor(() => samples.length >= 2);
    stop();
    expect(samples[0]).toEqual({ t: 7, nics: [{ id: '{A1}', rx: 1000, tx: 10000, up: true, speed: 1e9 }] });
    // Stopping on purpose is no error.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(errors).toEqual([]);
  });

  it('reports a PowerShell that cannot start', async () => {
    const source = powershellSource({ executable: path.join(root, 'missing') });
    await expect(source.list()).rejects.toThrow(/PowerShell liess sich nicht starten/);
  });
});

describe('monitor', () => {
  const selection = [{ id: 'eth0', name: 'Ethernet', description: 'Intel I219-V' }];

  /** A source whose samples the test hands in. */
  function manualSource() {
    const state = { starts: 0, stops: 0, emit: (_sample: CounterSample) => {}, fail: (_message: string) => {} };
    const source: CounterSource = {
      list: async () => [],
      start(_ids, _interval, onSample, onError) {
        state.starts++;
        state.emit = onSample;
        state.fail = onError;
        return () => void state.stops++;
      },
    };
    return { source, state };
  }

  it('measures only while asked, and computes bits per second', () => {
    let clock = 10_000;
    const { source, state } = manualSource();
    const monitor = createNetworkMonitor({ source, selection: () => selection, intervalMs: 2000, now: () => clock });
    expect(state.starts).toBe(0);

    // The first look starts measuring; rates need two samples.
    expect(monitor.status().interfaces).toEqual([{ id: 'eth0', name: 'Ethernet', description: 'Intel I219-V', up: true, speedBps: null, rxBps: null, txBps: null, history: [] }]);
    expect(state.starts).toBe(1);
    state.emit({ t: 10_000, nics: [{ id: 'eth0', rx: 0, tx: 0, up: true, speed: 1e9 }] });
    clock = 12_000;
    state.emit({ t: 12_000, nics: [{ id: 'eth0', rx: 250_000, tx: 12_500_000, up: true, speed: 1e9 }] });
    expect(monitor.status().interfaces[0]).toMatchObject({ speedBps: 1e9, rxBps: 1_000_000, txBps: 50_000_000, history: [{ t: 12_000, rxBps: 1_000_000, txBps: 50_000_000 }] });

    // A counter that went back gives no rate; old rates go stale.
    clock = 14_000;
    state.emit({ t: 14_000, nics: [{ id: 'eth0', rx: 10, tx: 10, up: true, speed: 1e9 }] });
    clock = 30_000;
    expect(monitor.status().interfaces[0]).toMatchObject({ rxBps: null, txBps: null });
    expect(state.starts).toBe(1);
    monitor.stop();
  });

  it('stops measuring when nobody has looked for a while', async () => {
    let clock = 0;
    const { source, state } = manualSource();
    const monitor = createNetworkMonitor({ source, selection: () => selection, lingerMs: 20, now: () => clock });
    monitor.status();
    expect(state.starts).toBe(1);
    clock = 1000;
    await waitFor(() => state.stops > 0);
    expect(state.stops).toBe(1);
    // The next look starts it again.
    monitor.status();
    expect(state.starts).toBe(2);
    monitor.stop();
  });

  it('retries a failed measurement only after a while', () => {
    let clock = 0;
    const { source, state } = manualSource();
    const monitor = createNetworkMonitor({ source, selection: () => selection, retryMs: 30_000, now: () => clock });
    monitor.status();
    state.fail('Die Messung endete unerwartet (Exit-Code 1).');
    clock = 10_000;
    expect(monitor.status().error).toBe('Die Messung endete unerwartet (Exit-Code 1).');
    expect(state.starts).toBe(1);
    clock = 31_000;
    monitor.status();
    expect(state.starts).toBe(2);
    monitor.stop();
  });

  it('measures nothing without a selection or on unsupported systems', () => {
    const { source, state } = manualSource();
    const empty = createNetworkMonitor({ source, selection: () => [] });
    expect(empty.status()).toMatchObject({ interfaces: [], error: null });
    expect(state.starts).toBe(0);
    empty.stop();

    const unsupported = createNetworkMonitor({ source: null, selection: () => selection });
    expect(unsupported.status().error).toMatch(/nur Windows und Linux/);
    unsupported.stop();
  });

  it('starts over when the selection changes', () => {
    const { source, state } = manualSource();
    const monitor = createNetworkMonitor({ source, selection: () => selection });
    monitor.status();
    monitor.restart();
    expect(state).toMatchObject({ starts: 2, stops: 1 });
    monitor.stop();
    expect(state.stops).toBe(2);
  });
});
