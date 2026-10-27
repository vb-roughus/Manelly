import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentNetworkStatus, AgentResourceStatus, ResourcePoint, StreamEvent } from '@manelly/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregate, createRecorder, spansOf, stepFor, type SampleLine } from '../src/history.js';
import type { JfSession } from '../src/jellyfin.js';
import { createSettingsStore, type SettingsStore } from '../src/schedule.js';
import { createStreamTracker } from '../src/streamEvents.js';

const hevc4k = {
  Id: 'movie',
  Name: 'Dune',
  Type: 'Movie',
  ProductionYear: 2021,
  Container: 'mkv',
  MediaStreams: [
    { Type: 'Video', Codec: 'hevc', Height: 2160, VideoRangeType: 'DOVIWithHDR10', BitRate: 60_000_000 },
    { Type: 'Audio', Index: 1, Codec: 'truehd', Channels: 8, BitRate: 4_000_000, IsDefault: true },
    { Type: 'Audio', Index: 2, Codec: 'ac3', Channels: 6, BitRate: 640_000 },
  ],
};

const session = (overrides: Partial<JfSession> = {}): JfSession => ({
  Id: 's1',
  UserName: 'Carla',
  Client: 'Jellyfin Web',
  DeviceName: 'Chrome',
  DeviceId: 'dev-1',
  RemoteEndPoint: '::ffff:192.168.1.20',
  NowPlayingItem: hevc4k,
  PlayState: { PlayMethod: 'DirectPlay' },
  ...overrides,
});

const transcode = {
  Container: 'ts',
  VideoCodec: 'h264',
  AudioCodec: 'aac',
  IsVideoDirect: false,
  IsAudioDirect: false,
  Height: 1080,
  AudioChannels: 2,
  Bitrate: 12_000_000,
  HardwareAccelerationType: 'qsv',
  TranscodeReasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'],
};

describe('stream tracker', () => {
  it('records the start, a change of how it plays, and the stop', () => {
    const tracker = createStreamTracker();
    const first = tracker.update([session(), { Id: 'idle', DeviceName: 'Manelly' }], 1000);
    expect(first.counts).toEqual({ streams: 1, transcodes: 0, bitrate: 64_000_000 });
    expect(first.events).toEqual([
      {
        t: 1000,
        type: 'start',
        stream: 's1|movie',
        user: 'Carla',
        client: 'Jellyfin Web',
        device: 'Chrome',
        remoteAddress: '192.168.1.20',
        title: 'Dune (2021)',
        itemType: 'Movie',
        method: 'DirectPlay',
        source: { container: 'mkv', videoCodec: 'hevc', height: 2160, videoRange: 'DOVIWithHDR10', audioCodec: 'truehd', audioChannels: 8 },
        transcoding: null,
        reasons: [],
        bitrate: 64_000_000,
      },
    ]);

    // The same again, only paused: nothing to record.
    expect(tracker.update([session()], 2000).events).toEqual([]);

    const changed = tracker.update([session({ PlayState: { PlayMethod: 'Transcode', AudioStreamIndex: 2 }, TranscodingInfo: transcode })], 3000);
    expect(changed.counts).toEqual({ streams: 1, transcodes: 1, bitrate: 12_000_000 });
    expect(changed.events).toMatchObject([
      {
        t: 3000,
        type: 'change',
        method: 'Transcode',
        source: { audioCodec: 'ac3', audioChannels: 6 },
        transcoding: { videoCodec: 'h264', height: 1080, audioCodec: 'aac', videoDirect: false, hardware: 'qsv' },
        reasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'],
      },
    ]);

    // Only the bitrate moved.
    expect(tracker.update([session({ PlayState: { PlayMethod: 'Transcode' }, TranscodingInfo: { ...transcode, Bitrate: 9_000_000 } })], 4000).events).toEqual([]);

    expect(tracker.update([], 5000).events).toMatchObject([{ t: 5000, type: 'stop', stream: 's1|movie', method: 'Transcode' }]);
    expect(tracker.playing().size).toBe(0);
  });

  it('waits a little for the details of a transcode, and keeps them when Jellyfin leaves them out', () => {
    const tracker = createStreamTracker();
    const episode = { Id: 'ep', Name: 'Death Has a Shadow', Type: 'Episode', SeriesName: 'Family Guy', ParentIndexNumber: 1, IndexNumber: 1 };
    const playing = session({ NowPlayingItem: episode, PlayState: { PlayMethod: 'Transcode' } });

    expect(tracker.update([playing], 1000)).toMatchObject({ events: [], counts: { streams: 1, transcodes: 1 } });
    expect(tracker.update([{ ...playing, TranscodingInfo: transcode }], 16_000).events).toMatchObject([
      { t: 1000, type: 'start', title: 'Family Guy · S01E01 · Death Has a Shadow', reasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'] },
    ]);
    // Gone from this answer, still the same transcode.
    expect(tracker.update([playing], 31_000).events).toEqual([]);
  });

  it('starts without details after waiting long enough', () => {
    const tracker = createStreamTracker();
    const playing = session({ PlayState: { PlayMethod: 'Transcode' } });
    expect(tracker.update([playing], 0).events).toEqual([]);
    expect(tracker.update([playing], 30_000).events).toMatchObject([{ t: 0, type: 'start', method: 'Transcode', transcoding: null, reasons: [] }]);
  });

  it('borrows the details from an idle session of the same device', () => {
    const tracker = createStreamTracker();
    const { events } = tracker.update(
      [session({ Id: 's2', PlayState: { PlayMethod: 'Transcode' } }), { Id: 's1', DeviceId: 'DEV-1', TranscodingInfo: transcode }],
      1000,
    );
    expect(events).toMatchObject([{ type: 'start', stream: 's2|movie', transcoding: { videoCodec: 'h264' }, reasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'] }]);
  });

  it('carries on after a restart, and ends a stream that stopped meanwhile when it was last seen', () => {
    const tracker = createStreamTracker({ maxGapMs: 60_000 });
    const [start] = createStreamTracker().update([session()], 1000).events;
    const [other] = createStreamTracker().update([session({ Id: 's9' })], 1000).events;
    tracker.restore([start!, other!], 50_000);

    const { events } = tracker.update([session()], 600_000);
    expect(events).toMatchObject([{ t: 50_000, type: 'stop', stream: 's9|movie' }]);
    expect(tracker.playing()).toEqual(new Set(['s1|movie']));
  });
});

describe('history', () => {
  it('picks the shortest step that keeps a range within 720 points', () => {
    expect(stepFor(3_600_000)).toBe(15_000);
    expect(stepFor(6 * 3_600_000)).toBe(30_000);
    expect(stepFor(24 * 3_600_000)).toBe(120_000);
    expect(stepFor(7 * 86_400_000)).toBe(900_000);
  });

  it('averages each step, keeps the peaks, and leaves out steps without records', () => {
    const samples: SampleLine[] = [
      { t: 0, cpu: [20, 10, 0], gpu: [40, 30, 0], net: { eth: [1000, 9000] }, streams: [1, 1, 8_000_000] },
      { t: 15_000, cpu: [60, 40, 5], net: { eth: [3000, 11_000] }, streams: [2, 1, 20_000_000] },
      { t: 120_000, streams: [0, 0, null] },
    ];
    expect(aggregate(samples, 30_000)).toEqual([
      {
        t: 0,
        cpu: 40,
        cpuMax: 60,
        cpuJellyfin: 25,
        cpuConversion: 2.5,
        gpu: 40,
        gpuMax: 40,
        gpuJellyfin: 30,
        gpuConversion: 0,
        streams: 2,
        transcodes: 1,
        bitrate: 14_000_000,
        network: { eth: { rx: 2000, tx: 10_000 } },
      },
      { t: 120_000, cpu: null, cpuMax: null, cpuJellyfin: null, cpuConversion: null, gpu: null, gpuMax: null, gpuJellyfin: null, gpuConversion: null, streams: 0, transcodes: 0, bitrate: 0, network: {} },
    ]);
  });

  it('puts start, changes and stop of each stream together', () => {
    const event = (t: number, type: StreamEvent['type'], stream: string) => ({ t, type, stream }) as StreamEvent;
    const events = [event(5000, 'stop', 'a'), event(1000, 'start', 'a'), event(3000, 'change', 'a'), event(4000, 'start', 'b'), event(500, 'stop', 'old'), event(200, 'start', 'old'), event(100, 'start', 'gone')];
    const spans = spansOf(events, 1000, 10_000, new Set(['b']));
    expect(spans.map((span) => [span.id, span.start, span.end, span.ongoing, span.phases.map((phase) => phase.type)])).toEqual([
      ['a', 1000, 5000, false, ['start', 'change']],
      ['b', 4000, null, true, ['start']],
    ]);
  });
});

describe('recorder', () => {
  let dir: string;
  let settings: SettingsStore;
  let clock: number;
  let sessions: JfSession[];
  let resourceHistory: ResourcePoint[];
  let networkStatus: AgentNetworkStatus;

  const resources = { status: () => ({ history: resourceHistory }) as AgentResourceStatus };
  const network = { status: () => networkStatus };
  const jellyfin: typeof fetch = async () => Response.json(sessions);

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'manelly-history-'));
    settings = await createSettingsStore(dir);
    await settings.setJellyfin({ url: 'http://jellyfin:8096', apiKey: 'key' });
    await settings.setNetwork([{ id: '{A1}', name: 'Ethernet', description: null }]);
    clock = Date.UTC(2026, 9, 27, 10, 0, 0);
    sessions = [];
    resourceHistory = [];
    networkStatus = { interfaces: [], intervalMs: 2000, error: null };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const recorder = () => createRecorder({ dir: path.join(dir, 'history'), settings, resources, network, fetch: jellyfin, now: () => clock, tickMs: 0 });
  const point = (t: number, cpu: number): ResourcePoint => ({ t, cpu, cpuJellyfin: cpu / 2, cpuConversion: 0, gpu: null, gpuJellyfin: null, gpuConversion: null });
  const nic = (points: Array<[number, number, number]>) => ({
    interfaces: [{ id: '{A1}', name: 'Ethernet', description: null, up: true, speedBps: 1e9, rxBps: null, txBps: null, history: points.map(([t, rxBps, txBps]) => ({ t, rxBps, txBps })) }],
    intervalMs: 2000,
    error: null,
  });

  it('records nothing until switched on', async () => {
    const history = recorder();
    resourceHistory = [point(clock - 1000, 50)];
    await history.tick();
    expect(await readdir(path.join(dir, 'history')).catch(() => [])).toEqual([]);
    expect(await history.query(clock - 60_000, clock)).toMatchObject({ settings: { enabled: false }, points: [], streams: [], bytes: 0, oldest: null, error: null });
  });

  it('records the averages since the last record and the streams, and answers for a range', async () => {
    await settings.setHistory({ enabled: true, retentionDays: 30 });
    const history = recorder();
    const start = clock;

    resourceHistory = [point(clock - 6000, 20), point(clock - 3000, 40)];
    networkStatus = nic([[clock - 2000, 1000, 9000], [clock, 3000, 11_000]]);
    sessions = [session()];
    await history.tick();

    clock += 15_000;
    resourceHistory.push(point(clock - 1000, 90));
    sessions = [];
    await history.tick();

    const files = (await readdir(path.join(dir, 'history'))).sort();
    expect(files).toEqual(['interfaces.json', 'samples-2026-10-27.ndjson', 'streams-2026-10-27.ndjson']);
    const lines = (await readFile(path.join(dir, 'history', 'samples-2026-10-27.ndjson'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as SampleLine);
    expect(lines).toEqual([
      { t: start, cpu: [30, 15, 0], net: { '{A1}': [2000, 10_000] }, streams: [1, 0, 64_000_000] },
      // The interface sent nothing new: its last reading is fresh enough to count again.
      { t: clock, cpu: [90, 45, 0], net: { '{A1}': [3000, 11_000] }, streams: [0, 0, null] },
    ]);

    const response = await history.query(start - 3_600_000, clock);
    expect(response).toMatchObject({ settings: { enabled: true, retentionDays: 30 }, step: 15_000, interfaces: [{ id: '{A1}', name: 'Ethernet' }], error: null });
    expect(response.points.map((entry) => [entry.t, entry.cpu, entry.streams])).toEqual([
      [start, 30, 1],
      [clock, 90, 0],
    ]);
    expect(response.streams).toMatchObject([{ id: 's1|movie', start, end: clock, ongoing: false, phases: [{ type: 'start', user: 'Carla', title: 'Dune (2021)' }] }]);
    expect(response.oldest).toBe(Date.UTC(2026, 9, 27));
    expect(response.bytes).toBeGreaterThan(0);

    await history.clear();
    expect((await history.query(start - 3_600_000, clock)).points).toEqual([]);
  });

  it('deletes days past the retention', async () => {
    await settings.setHistory({ enabled: true, retentionDays: 2 });
    const history = recorder();
    resourceHistory = [point(clock, 10)];
    await history.tick();
    for (const day of ['2026-10-25', '2026-10-26']) await writeFile(path.join(dir, 'history', `samples-${day}.ndjson`), `${JSON.stringify({ t: Date.parse(`${day}T12:00:00Z`), cpu: [1, 0, 0] })}\n`);

    clock += 86_400_000;
    await history.tick();
    expect((await readdir(path.join(dir, 'history'))).sort()).toEqual(['samples-2026-10-27.ndjson', 'samples-2026-10-28.ndjson']);

    // A shorter retention applies at once.
    await settings.setHistory({ enabled: true, retentionDays: 1 });
    await history.tick();
    expect(await readdir(path.join(dir, 'history'))).toEqual(['samples-2026-10-28.ndjson']);
  });

  it('ends a stream that stopped while the agent was off when it last recorded', async () => {
    await settings.setHistory({ enabled: true, retentionDays: 30 });
    sessions = [session()];
    await recorder().tick();
    const lastRecord = clock;

    // Two hours later, after a restart: the stream is over.
    clock += 2 * 3_600_000;
    sessions = [];
    const restarted = recorder();
    await restarted.tick();
    const { streams } = await restarted.query(lastRecord - 60_000, clock);
    expect(streams).toMatchObject([{ start: lastRecord, end: lastRecord, ongoing: false }]);
  });

  it('records the load without Jellyfin, and says why the streams are missing', async () => {
    const fresh = await createSettingsStore(path.join(dir, 'other'));
    await fresh.setHistory({ enabled: true, retentionDays: 30 });
    const history = createRecorder({ dir: path.join(dir, 'history'), settings: fresh, resources, network, fetch: jellyfin, now: () => clock, tickMs: 0 });
    resourceHistory = [point(clock, 10)];
    await history.tick();
    const response = await history.query(clock - 60_000, clock);
    expect(response.points.map((entry) => [entry.cpu, entry.streams])).toEqual([[10, null]]);
    expect(response.error).toMatch(/keine Jellyfin-Verbindung/);
  });
});
