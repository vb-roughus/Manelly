import { describe, expect, it } from 'vitest';
import type { SessionsResponse, StreamFinding } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient, type JellyfinClient } from '../src/jellyfin/client.js';
import type { JfSessionInfo } from '../src/jellyfin/types.js';
import { toStreamSession } from '../src/sessions.js';
import { createStreamContextCache, loadStreamContext, type StreamContext } from '../src/streamHealth.js';

const MINUTE_TICKS = 60_000 * 10_000;

/** A 100-minute movie at minute 30, transcoded from 24 fps HEVC. */
function transcode(info: JfSessionInfo['TranscodingInfo'] = {}, video: Record<string, unknown> = {}, extra: Partial<JfSessionInfo> = {}): JfSessionInfo {
  return {
    Id: 's1',
    UserId: 'u1',
    UserName: 'Anna',
    RemoteEndPoint: '192.168.1.20',
    NowPlayingItem: {
      Id: 'movie',
      Name: 'Film',
      Type: 'Movie',
      RunTimeTicks: 100 * MINUTE_TICKS,
      MediaStreams: [
        { Type: 'Video', Index: 0, Codec: 'hevc', BitDepth: 8, RealFrameRate: 24, BitRate: 30_000_000, VideoRange: 'SDR', ...video },
        { Type: 'Audio', Index: 1, Codec: 'eac3', Channels: 6, BitRate: 640_000 },
      ],
    },
    PlayState: { PositionTicks: 30 * MINUTE_TICKS, PlayMethod: 'Transcode' },
    TranscodingInfo: { IsVideoDirect: false, IsAudioDirect: true, VideoCodec: 'h264', Framerate: 60, CompletionPercentage: 40, ...info },
    ...extra,
  };
}

const context = (overrides: Partial<StreamContext> = {}): StreamContext => ({
  hardwareAcceleration: 'qsv',
  hardwareEncoding: true,
  hardwareDecodingCodecs: ['h264', 'hevc', 'vc1'],
  hevc10Bit: true,
  vp910Bit: true,
  toneMapping: true,
  remoteBitrateLimit: 0,
  userRemoteBitrateLimits: new Map(),
  ...overrides,
});

const findings = (session: JfSessionInfo, ctx: StreamContext | null = context()) => toStreamSession(session, ctx).health.findings;
const find = <K extends StreamFinding['kind']>(list: StreamFinding[], kind: K) =>
  list.find((finding): finding is Extract<StreamFinding, { kind: K }> => finding.kind === kind);

describe('stream health', () => {
  it('measures whether the transcoder keeps up', () => {
    // 60 fps for a 24 fps movie, 10 minutes ahead of playback.
    expect(find(findings(transcode()), 'throughput')).toEqual({
      kind: 'throughput',
      severity: 'good',
      speed: 2.5,
      transcodeFps: 60,
      sourceFps: 24,
      bufferAheadMs: 600_000,
    });
    // Slow, and only 6 s ahead: playback will stall.
    expect(find(findings(transcode({ Framerate: 18, CompletionPercentage: 30.1 })), 'throughput')).toMatchObject({
      severity: 'critical',
      speed: 0.75,
      bufferAheadMs: 6_000,
    });
    expect(find(findings(transcode({ Framerate: 26, CompletionPercentage: 30.1 })), 'throughput')?.severity).toBe('warning');
    // Slow but far ahead – e.g. throttled on purpose – is fine.
    expect(find(findings(transcode({ Framerate: 12 })), 'throughput')?.severity).toBe('good');
    // Remuxing costs nothing worth measuring.
    expect(find(findings(transcode({ IsVideoDirect: true })), 'throughput')).toBeUndefined();
  });

  it('accepts real time for live TV and flags only dropped frames', () => {
    const live = (Framerate: number) =>
      transcode({ Framerate, CompletionPercentage: undefined }, {}, { NowPlayingItem: { ...transcode().NowPlayingItem, Type: 'TvChannel', RunTimeTicks: undefined } });
    expect(find(findings(live(24)), 'throughput')).toBeUndefined();
    expect(find(findings(live(20)), 'throughput')?.severity).toBe('critical');
  });

  it('points out transcoding without hardware acceleration', () => {
    expect(find(findings(transcode(), context({ hardwareAcceleration: null })), 'softwareTranscoding')?.severity).toBe('info');
    const slow = transcode({ Framerate: 18, CompletionPercentage: 30.1 });
    expect(find(findings(slow, context({ hardwareAcceleration: null })), 'softwareTranscoding')?.severity).toBe('warning');
    expect(find(findings(transcode()), 'softwareTranscoding')).toBeUndefined();
  });

  it('finds codecs that are decoded in software despite hardware acceleration', () => {
    // Jellyfin's default codec list only has H.264 and VC-1.
    expect(find(findings(transcode(), context({ hardwareDecodingCodecs: ['h264', 'vc1'] })), 'softwareDecoding')).toMatchObject({
      hardware: 'qsv',
      codec: 'hevc',
      cause: 'codecDisabled',
    });
    expect(find(findings(transcode({}, { BitDepth: 10 }), context({ hevc10Bit: false })), 'softwareDecoding')?.cause).toBe('tenBitDisabled');
    expect(find(findings(transcode({}, { BitDepth: 10 })), 'softwareDecoding')).toBeUndefined();
    expect(find(findings(transcode(), context({ hardwareDecodingCodecs: null })), 'softwareDecoding')).toBeUndefined();
    expect(find(findings(transcode(), context({ hardwareEncoding: false })), 'softwareEncoding')).toMatchObject({ hardware: 'qsv' });
  });

  it('warns about HDR converted to SDR without tone mapping or in software', () => {
    const hdr = transcode({}, { BitDepth: 10, VideoRange: 'HDR', VideoRangeType: 'DOVI' });
    expect(find(findings(hdr, context({ toneMapping: false })), 'toneMapping')).toMatchObject({ cause: 'disabled', videoRangeType: 'DOVI' });
    expect(find(findings(hdr, context({ hardwareAcceleration: null })), 'toneMapping')?.cause).toBe('software');
    expect(find(findings(hdr), 'toneMapping')).toBeUndefined();
    // HEVC output keeps HDR for clients that support it.
    const keepsHdr = transcode({ VideoCodec: 'hevc' }, { BitDepth: 10, VideoRange: 'HDR', VideoRangeType: 'HDR10' });
    expect(find(findings(keepsHdr, context({ toneMapping: false })), 'toneMapping')).toBeUndefined();
  });

  it('names the limit that forces a lower bitrate', () => {
    const limited = (address: string) => transcode({ TranscodeReasons: ['ContainerBitrateExceedsLimit'] }, {}, { RemoteEndPoint: address });
    const remote = limited('203.0.113.9');
    expect(find(findings(remote, context({ remoteBitrateLimit: 8_000_000 })), 'bitrateLimit')).toMatchObject({
      limitedBy: 'server',
      limit: 8_000_000,
      sourceBitrate: 30_640_000,
    });
    const userLimit = context({ remoteBitrateLimit: 8_000_000, userRemoteBitrateLimits: new Map([['u1', 4_000_000]]) });
    expect(find(findings(remote, userLimit), 'bitrateLimit')).toMatchObject({ limitedBy: 'user', limit: 4_000_000 });
    // Remote limits do not apply in the local network: the client's quality setting does it.
    expect(find(findings(limited('192.168.1.20'), userLimit), 'bitrateLimit')?.limitedBy).toBe('client');
    expect(find(findings(remote, null), 'bitrateLimit')?.limitedBy).toBe('unknown');
  });

  it('notes high bitrates over the internet and sorts findings by severity', () => {
    const directPlay: JfSessionInfo = { ...transcode(), TranscodingInfo: undefined, PlayState: { PlayMethod: 'DirectPlay' }, RemoteEndPoint: '203.0.113.9' };
    expect(findings(directPlay)).toEqual([{ kind: 'remoteBitrate', severity: 'info', bitrate: 30_640_000 }]);

    const health = toStreamSession(transcode({ Framerate: 18, CompletionPercentage: 30.1 }), context({ hardwareAcceleration: null })).health;
    expect(health.findings.map((finding) => finding.kind)).toEqual(['throughput', 'softwareTranscoding']);
    expect(health.severity).toBe('critical');
    expect(health.settingsKnown).toBe(true);
    expect(toStreamSession(transcode(), null).health.settingsKnown).toBe(false);
  });
});

describe('stream context', () => {
  it('reads the transcoding settings and user limits', async () => {
    const client = {
      getEncodingOptions: async () => ({ HardwareAccelerationType: 'none', HardwareDecodingCodecs: ['H264'], EnableTonemapping: false }),
      getServerConfiguration: async () => ({ RemoteClientBitrateLimit: 10_000_000 }),
      getUsers: async () => [{ Id: 'u1', Policy: { RemoteClientBitrateLimit: 2_000_000 } }, { Id: 'u2' }],
    } as unknown as JellyfinClient;
    expect(await loadStreamContext(client)).toEqual({
      hardwareAcceleration: null,
      hardwareEncoding: true,
      hardwareDecodingCodecs: ['h264'],
      hevc10Bit: true,
      vp910Bit: true,
      toneMapping: false,
      remoteBitrateLimit: 10_000_000,
      userRemoteBitrateLimits: new Map([
        ['u1', 2_000_000],
        ['u2', 0],
      ]),
    });
  });

  it('is cached per connection and survives failures', async () => {
    let time = 0;
    let loads = 0;
    const cache = createStreamContextCache({
      now: () => time,
      load: async () => {
        loads += 1;
        if (loads === 2) throw new Error('403');
        return context();
      },
    });
    const client = {} as JellyfinClient;
    expect(await cache.get(client)).not.toBeNull();
    time = 30_000;
    await cache.get(client);
    expect(loads).toBe(1);
    time = 61_000;
    expect(await cache.get(client)).toBeNull();
    expect(await cache.get({} as JellyfinClient)).not.toBeNull();
    expect(loads).toBe(3);
  });

  it('feeds the diagnosis of the sessions API', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/Sessions') return Response.json([transcode({}, {}, { RemoteEndPoint: '203.0.113.9' })]);
      if (url.pathname === '/System/Configuration/encoding') return Response.json({ HardwareAccelerationType: 'vaapi', HardwareDecodingCodecs: ['h264', 'vc1'] });
      if (url.pathname === '/System/Configuration') return Response.json({ RemoteClientBitrateLimit: 0 });
      if (url.pathname === '/Users') return Response.json([{ Id: 'u1', Policy: {} }]);
      return new Response(null, { status: 404 });
    };
    const connection = await createConnection({
      store: { load: async () => ({ url: 'http://jellyfin.test', apiKey: 'key' }), save: async () => {} },
      envSettings: null,
      createClient: (settings) => createJellyfinClient(settings, { fetch }),
    });
    const app = await buildApp({ config: { staticDir: null }, connection });

    const body = (await app.inject('/api/sessions')).json<SessionsResponse>();
    const [stream] = body.sessions;
    expect(stream?.health.settingsKnown).toBe(true);
    expect(stream?.health.findings.map((finding) => finding.kind)).toEqual(['softwareDecoding', 'remoteBitrate', 'throughput']);
    expect(body.summary.struggling).toBe(0);
  });
});
