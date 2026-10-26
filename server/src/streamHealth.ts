import type { FindingSeverity, StreamFinding, StreamHealth, StreamSession } from '@manelly/shared';
import type { JellyfinClient } from './jellyfin/client.js';

/** Jellyfin settings that decide how expensive a transcode is and which limits apply. */
export interface StreamContext {
  /** e.g. qsv, vaapi, nvenc; null when Jellyfin has no hardware acceleration set up. */
  hardwareAcceleration: string | null;
  hardwareEncoding: boolean;
  /** Source codecs decoded in hardware; null when Jellyfin does not report them. */
  hardwareDecodingCodecs: string[] | null;
  hevc10Bit: boolean;
  vp910Bit: boolean;
  toneMapping: boolean;
  /** Server-wide limit for remote clients in bits per second; 0 means none. */
  remoteBitrateLimit: number;
  /** Per-user limits for remote clients; 0 means the server-wide limit applies. */
  userRemoteBitrateLimits: Map<string, number>;
  /** windows, linux or macos – which hardware accelerations exist depends on it. */
  operatingSystem: OperatingSystem | null;
}

export type OperatingSystem = 'windows' | 'linux' | 'macos';

/** Accelerations Jellyfin supports per system (see jellyfin.org: Hardware Acceleration). */
export const PLATFORM_ACCELERATIONS: Record<OperatingSystem, string[]> = {
  windows: ['qsv', 'nvenc', 'amf'],
  linux: ['vaapi', 'qsv', 'nvenc', 'v4l2m2m', 'rkmpp'],
  macos: ['videotoolbox'],
};

export function operatingSystemOf(info: { OperatingSystem?: string; OperatingSystemDisplayName?: string }): OperatingSystem | null {
  const text = `${info.OperatingSystem ?? ''} ${info.OperatingSystemDisplayName ?? ''}`;
  if (/windows/i.test(text)) return 'windows';
  if (/darwin|mac ?os|os x/i.test(text)) return 'macos';
  if (/linux|unix|bsd/i.test(text)) return 'linux';
  return null;
}

export async function loadStreamContext(client: JellyfinClient): Promise<StreamContext> {
  const [encoding, config, users, system] = await Promise.all([
    client.getEncodingOptions(),
    client.getServerConfiguration(),
    client.getUsers(),
    client.getSystemInfo(),
  ]);
  const hardware = encoding.HardwareAccelerationType?.toLowerCase();
  return {
    hardwareAcceleration: hardware && hardware !== 'none' ? hardware : null,
    hardwareEncoding: encoding.EnableHardwareEncoding !== false,
    hardwareDecodingCodecs: encoding.HardwareDecodingCodecs?.map((codec) => codec.toLowerCase()) ?? null,
    hevc10Bit: encoding.EnableDecodingColorDepth10Hevc !== false,
    vp910Bit: encoding.EnableDecodingColorDepth10Vp9 !== false,
    toneMapping: Boolean(encoding.EnableTonemapping || encoding.EnableVppTonemapping || encoding.EnableVideoToolboxTonemapping),
    remoteBitrateLimit: config.RemoteClientBitrateLimit ?? 0,
    userRemoteBitrateLimits: new Map(users.flatMap((user) => (user.Id ? [[user.Id, user.Policy?.RemoteClientBitrateLimit ?? 0]] : []))),
    operatingSystem: operatingSystemOf(system),
  };
}

/**
 * The settings change rarely, but the dashboard polls every few seconds; read
 * them at most once per `ttlMs`. A failure (e.g. a key without admin rights)
 * yields null, so the dashboard still works – just with fewer findings.
 */
export function createStreamContextCache(options: { ttlMs?: number; now?: () => number; load?: typeof loadStreamContext } = {}) {
  const { ttlMs = 60_000, now = Date.now, load = loadStreamContext } = options;
  let cached: { client: JellyfinClient; at: number; context: Promise<StreamContext | null> } | null = null;
  return {
    get(client: JellyfinClient): Promise<StreamContext | null> {
      if (!cached || cached.client !== client || now() - cached.at > ttlMs) {
        cached = { client, at: now(), context: load(client).catch(() => null) };
      }
      return cached.context;
    },
  };
}

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'warning', 'info', 'good'];
// Jellyfin only knows hardware decoders for these source codecs.
const HARDWARE_DECODABLE = new Set(['h264', 'hevc', 'mpeg2video', 'mpeg4', 'vc1', 'vp8', 'vp9', 'av1']);
// A transcoder this far ahead of playback is fine, however slow it currently runs
// (with throttling enabled, Jellyfin pauses it on purpose).
const COMFORTABLE_BUFFER_MS = 60_000;
// Above this, a stream over the internet can saturate a typical home upload.
const HIGH_REMOTE_BITRATE = 25_000_000;

type StreamFacts = Omit<StreamSession, 'health'>;

/** Explains what a stream costs the server and why it may stutter. */
export function assessStream(stream: StreamFacts, context: StreamContext | null): StreamHealth {
  const findings: StreamFinding[] = [];
  const { source, transcoding, item, playback } = stream;
  const videoTranscoded = Boolean(transcoding && !transcoding.isVideoDirect && source.video && item.type !== 'Audio');

  const throughput = videoTranscoded ? assessThroughput(stream) : null;
  if (throughput) findings.push(throughput);
  const struggling = throughput?.severity === 'critical' || throughput?.severity === 'warning';

  if (videoTranscoded && context && transcoding && source.video) {
    const hardware = context.hardwareAcceleration;
    if (!hardware) {
      findings.push({ kind: 'softwareTranscoding', severity: struggling ? 'warning' : 'info' });
    } else {
      // The FFmpeg log tells what really runs; without it, the settings tell what should.
      const log = stream.transcodeLog;
      const codec = source.video.codec?.toLowerCase() ?? '';
      const bitDepth = source.video.bitDepth;
      const decodable = context.hardwareDecodingCodecs;
      const decodedInSoftware = log ? !log.decoderHardware : true;
      if (decodable && HARDWARE_DECODABLE.has(codec) && decodedInSoftware) {
        const cause = !decodable.includes(codec)
          ? 'codecDisabled'
          : bitDepth === 10 && hardware !== 'videotoolbox' && ((codec === 'hevc' && !context.hevc10Bit) || (codec === 'vp9' && !context.vp910Bit))
            ? 'tenBitDisabled'
            : log
              ? 'fallback'
              : null;
        if (cause) findings.push({ kind: 'softwareDecoding', severity: 'warning', hardware, codec, bitDepth, cause });
      }

      const encodedInSoftware = log ? log.encoderHardware === false : !context.hardwareEncoding;
      if (encodedInSoftware) {
        // Mirrors EncodingHelper.GetH26xOrAv1Encoder: these are the cases in which Jellyfin picks a software encoder.
        const platform = context.operatingSystem;
        const cause = !context.hardwareEncoding
          ? 'disabled'
          : platform && !PLATFORM_ACCELERATIONS[platform].includes(hardware)
            ? 'platform'
            : item.videoType && item.videoType !== 'VideoFile'
              ? 'discImage'
              : 'unavailable';
        const severity = struggling || cause === 'platform' || cause === 'unavailable' ? 'warning' : 'info';
        findings.push({ kind: 'softwareEncoding', severity, hardware, encoder: log?.encoder ?? null, cause, operatingSystem: platform });
      } else if (log?.encoder && log.decoderHardware) {
        findings.push({ kind: 'hardwareUsage', severity: 'good', decoder: log.decoder, encoder: log.encoder, toneMapping: log.toneMapping });
      }
    }

    // H.264 output is always SDR; Dolby Vision without HDR10 base needs mapping on any non-DV client.
    const toSdr =
      transcoding.videoCodec?.toLowerCase() === 'h264' ||
      (transcoding.reasons.includes('VideoRangeTypeNotSupported') && source.video.videoRangeType === 'DOVI');
    if (source.video.videoRange === 'HDR' && toSdr) {
      // Without hardware acceleration Jellyfin tone maps in software regardless of the setting.
      const cause = !hardware ? 'software' : !context.toneMapping ? 'disabled' : null;
      if (cause) findings.push({ kind: 'toneMapping', severity: 'warning', videoRangeType: source.video.videoRangeType, cause });
    }
  }

  if (stream.transcodeLog?.errors.length) {
    findings.push({ kind: 'ffmpegErrors', severity: 'warning', errors: stream.transcodeLog.errors, logFile: stream.transcodeLog.fileName });
  }

  if (transcoding?.reasons.some((reason) => reason === 'ContainerBitrateExceedsLimit' || reason === 'VideoBitrateNotSupported')) {
    findings.push(bitrateLimit(stream, context));
  }

  if (stream.isLocalNetwork === false && (stream.estimatedBitrate ?? 0) >= HIGH_REMOTE_BITRATE && !playback.isPaused) {
    findings.push({ kind: 'remoteBitrate', severity: 'info', bitrate: stream.estimatedBitrate! });
  }

  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return { severity: findings[0]?.severity ?? null, findings, settingsKnown: context !== null };
}

function assessThroughput({ source, transcoding, item, playback }: StreamFacts): StreamFinding | null {
  const transcodeFps = transcoding?.framerate || null;
  const sourceFps = source.video?.frameRate || null;
  const speed = transcodeFps && sourceFps ? transcodeFps / sourceFps : null;
  const completion = transcoding?.completionPercentage;
  const bufferAheadMs =
    completion != null && item.durationMs ? Math.max(0, Math.round((completion / 100) * item.durationMs - playback.positionMs)) : null;
  const facts = { kind: 'throughput', speed, transcodeFps, sourceFps, bufferAheadMs } as const;

  // Live TV is read at its native rate: about 1× is normal, below means dropped frames.
  if (item.type === 'TvChannel' || !item.durationMs) {
    return speed !== null && speed < 0.95 ? { ...facts, severity: 'critical' } : null;
  }
  if (bufferAheadMs !== null && bufferAheadMs >= COMFORTABLE_BUFFER_MS) return { ...facts, severity: 'good' };
  if (speed === null) return bufferAheadMs !== null && bufferAheadMs < 10_000 ? { ...facts, severity: 'warning' } : null;
  if (speed < 1) return { ...facts, severity: 'critical' };
  if (speed < 1.2) return { ...facts, severity: 'warning' };
  return { ...facts, severity: 'good' };
}

/** Which limit forces the lower bitrate – mirrors Jellyfin's MediaInfoHelper.GetMaxBitrate. */
function bitrateLimit(stream: StreamFacts, context: StreamContext | null): StreamFinding {
  const sourceBitrate = (stream.source.video?.bitrate ?? 0) + (stream.source.audio?.bitrate ?? 0) || null;
  const base = { kind: 'bitrateLimit', severity: 'info', sourceBitrate } as const;
  if (!context) return { ...base, limitedBy: 'unknown', limit: null };
  const userLimit = (stream.user.id && context.userRemoteBitrateLimits.get(stream.user.id)) || 0;
  const remoteLimit = userLimit > 0 ? userLimit : context.remoteBitrateLimit;
  if (stream.isLocalNetwork === false && remoteLimit > 0) {
    return { ...base, limitedBy: userLimit > 0 ? 'user' : 'server', limit: remoteLimit };
  }
  return { ...base, limitedBy: 'client', limit: null };
}
