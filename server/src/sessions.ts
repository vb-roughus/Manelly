import { isIP } from 'node:net';
import type {
  AudioStreamInfo,
  ImageAspect,
  ImageRef,
  NowPlayingItem,
  PlayMethod,
  SessionsResponse,
  SessionsSummary,
  SourceMedia,
  StreamSession,
  SubtitleStreamInfo,
  TranscodeLogInfo,
  TranscodingDetails,
  TranscodingOrigin,
  VideoStreamInfo,
} from '@manelly/shared';
import type { JfBaseItem, JfMediaStream, JfSessionInfo, JfTranscodingInfo } from './jellyfin/types.js';
import { assessStream, type StreamContext } from './streamHealth.js';
import { normalizeMediaSourceId } from './transcodeLog.js';

/** Jellyfin measures time in ticks of 100 ns. */
const TICKS_PER_MS = 10_000;

export function buildSessionsResponse(
  sessions: JfSessionInfo[],
  now = new Date(),
  context: StreamContext | null = null,
  logs: Map<string, TranscodeLogInfo> = new Map(),
  origins: Map<string, TranscodingOrigin> = new Map(),
): SessionsResponse {
  const playing = sessions.filter((session) => session.NowPlayingItem);
  const streams = playing
    .map((session) => toStreamSession(session, context, transcodeLogOf(session, logs), origins.get(session.Id ?? '')))
    .sort((a, b) => a.user.name.localeCompare(b.user.name) || a.device.localeCompare(b.device) || a.id.localeCompare(b.id));

  return {
    sessions: streams,
    idleSessions: sessions.length - playing.length,
    summary: summarize(streams),
    fetchedAt: now.toISOString(),
  };
}

/** Video is transcoded – or Jellyfin calls it a transcode without saying more. */
const videoTranscoded = (session: JfSessionInfo) =>
  Boolean(session.NowPlayingItem) &&
  (session.TranscodingInfo ? session.TranscodingInfo.IsVideoDirect === false : session.PlayState?.PlayMethod === 'Transcode');

/** The media source ids of sessions whose video is transcoded – the ones with an FFmpeg transcode log. */
export function transcodedMediaSources(sessions: JfSessionInfo[]): string[] {
  return sessions.flatMap((session) => (videoTranscoded(session) && session.PlayState?.MediaSourceId ? [session.PlayState.MediaSourceId] : []));
}

function transcodeLogOf(session: JfSessionInfo, logs: Map<string, TranscodeLogInfo>): TranscodeLogInfo | null {
  const id = session.PlayState?.MediaSourceId;
  return id && videoTranscoded(session) ? (logs.get(normalizeMediaSourceId(id)) ?? null) : null;
}

export function toStreamSession(
  session: JfSessionInfo,
  context: StreamContext | null = null,
  transcodeLog: TranscodeLogInfo | null = null,
  origin: TranscodingOrigin = 'jellyfin',
): StreamSession {
  const item = session.NowPlayingItem ?? {};
  const playState = session.PlayState ?? {};
  const source = selectSourceMedia(item, playState.AudioStreamIndex, playState.SubtitleStreamIndex);
  const transcoding = session.TranscodingInfo
    ? toTranscodingDetails(session.TranscodingInfo, origin)
    : playState.PlayMethod === 'Transcode' && transcodeLog
      ? transcodingFromLog(transcodeLog)
      : null;
  const remoteAddress = session.RemoteEndPoint ? normalizeAddress(session.RemoteEndPoint) : null;

  const stream = {
    id: session.Id ?? session.DeviceId ?? '',
    user: {
      id: session.UserId ?? null,
      name: session.UserName ?? 'Unbekannt',
      imageTag: session.UserPrimaryImageTag ?? null,
    },
    client: session.Client ?? 'Unbekannter Client',
    device: session.DeviceName ?? 'Unbekanntes Gerät',
    appVersion: session.ApplicationVersion ?? null,
    remoteAddress,
    isLocalNetwork: remoteAddress ? isPrivateAddress(remoteAddress) : null,
    lastActivity: session.LastActivityDate ?? null,
    item: toNowPlayingItem(item),
    playback: {
      positionMs: ticksToMs(playState.PositionTicks) ?? 0,
      isPaused: playState.IsPaused ?? false,
      isMuted: playState.IsMuted ?? false,
      method: resolvePlayMethod(session),
    },
    source,
    transcoding,
    estimatedBitrate: estimateBitrate(source, transcoding),
    transcodeLog,
  };
  return { ...stream, health: assessStream(stream, context) };
}

/** Mirrors the play method shown by Jellyfin's dashboard (jellyfin-web `getDisplayPlayMethod`). */
export function resolvePlayMethod(session: JfSessionInfo): PlayMethod {
  const transcoding = session.TranscodingInfo;
  if (transcoding?.IsVideoDirect) {
    return transcoding.IsAudioDirect ? 'Remux' : 'DirectStream';
  }
  if (session.PlayState?.PlayMethod === 'Transcode') return 'Transcode';
  return 'DirectPlay';
}

function toNowPlayingItem(item: JfBaseItem): NowPlayingItem {
  return {
    id: item.Id ?? '',
    type: item.Type ?? 'Unknown',
    name: item.Name ?? 'Unbekannter Titel',
    seriesName: item.SeriesName ?? null,
    seasonNumber: item.ParentIndexNumber ?? null,
    episodeNumber: item.IndexNumber ?? null,
    album: item.Album ?? null,
    artists: item.Artists?.length ? item.Artists : item.AlbumArtist ? [item.AlbumArtist] : [],
    productionYear: item.ProductionYear ?? null,
    durationMs: ticksToMs(item.RunTimeTicks),
    videoType: item.VideoType ?? null,
    poster: selectPoster(item),
    backdrop: selectBackdrop(item),
  };
}

function selectPoster(item: JfBaseItem): ImageRef | null {
  if (item.Type === 'Episode' && item.SeriesId && item.SeriesPrimaryImageTag) {
    return { itemId: item.SeriesId, type: 'Primary', tag: item.SeriesPrimaryImageTag, aspect: 'portrait' };
  }
  if (item.Type === 'Audio' && item.AlbumId && item.AlbumPrimaryImageTag) {
    return { itemId: item.AlbumId, type: 'Primary', tag: item.AlbumPrimaryImageTag, aspect: 'square' };
  }
  const tag = item.ImageTags?.Primary;
  if (item.Id && tag) {
    return { itemId: item.Id, type: 'Primary', tag, aspect: aspectOf(item) };
  }
  return null;
}

function aspectOf(item: JfBaseItem): ImageAspect {
  if (item.Type === 'Movie' || item.Type === 'Series') return 'portrait';
  if (item.Type === 'Audio' || item.Type === 'MusicAlbum') return 'square';
  const ratio = item.PrimaryImageAspectRatio;
  if (ratio === undefined) return 'landscape';
  if (ratio < 0.85) return 'portrait';
  if (ratio > 1.2) return 'landscape';
  return 'square';
}

function selectBackdrop(item: JfBaseItem): ImageRef | null {
  const ownTag = item.BackdropImageTags?.[0];
  if (item.Id && ownTag) {
    return { itemId: item.Id, type: 'Backdrop', tag: ownTag, aspect: 'landscape' };
  }
  const parentTag = item.ParentBackdropImageTags?.[0];
  if (item.ParentBackdropItemId && parentTag) {
    return { itemId: item.ParentBackdropItemId, type: 'Backdrop', tag: parentTag, aspect: 'landscape' };
  }
  return null;
}

function selectSourceMedia(item: JfBaseItem, audioIndex?: number, subtitleIndex?: number): SourceMedia {
  const streams = item.MediaStreams ?? [];
  const video = streams.find((stream) => stream.Type === 'Video');
  const audioStreams = streams.filter((stream) => stream.Type === 'Audio');
  const audio =
    (audioIndex !== undefined ? audioStreams.find((stream) => stream.Index === audioIndex) : undefined) ??
    audioStreams.find((stream) => stream.IsDefault) ??
    audioStreams[0];
  // Jellyfin uses -1 for "subtitles off".
  const subtitle =
    subtitleIndex !== undefined && subtitleIndex >= 0
      ? streams.find((stream) => stream.Type === 'Subtitle' && stream.Index === subtitleIndex)
      : undefined;

  return {
    container: item.Container ?? null,
    video: video ? toVideoStream(video) : null,
    audio: audio ? toAudioStream(audio) : null,
    subtitle: subtitle ? toSubtitleStream(subtitle) : null,
  };
}

function toVideoStream(stream: JfMediaStream): VideoStreamInfo {
  return {
    codec: stream.Codec ?? null,
    profile: stream.Profile ?? null,
    width: stream.Width ?? null,
    height: stream.Height ?? null,
    bitDepth: stream.BitDepth ?? null,
    frameRate: stream.RealFrameRate ?? stream.AverageFrameRate ?? null,
    bitrate: stream.BitRate ?? null,
    videoRange: stream.VideoRange ?? null,
    videoRangeType: stream.VideoRangeType ?? null,
    dvProfile: stream.DvProfile ?? null,
    level: stream.Level ?? null,
    codecTag: stream.CodecTag ?? null,
    isInterlaced: stream.IsInterlaced ?? false,
    refFrames: stream.RefFrames ?? null,
    displayTitle: stream.DisplayTitle ?? null,
  };
}

function toAudioStream(stream: JfMediaStream): AudioStreamInfo {
  return {
    codec: stream.Codec ?? null,
    profile: stream.Profile ?? null,
    channels: stream.Channels ?? null,
    channelLayout: stream.ChannelLayout ?? null,
    language: stream.Language ?? null,
    bitrate: stream.BitRate ?? null,
    sampleRate: stream.SampleRate ?? null,
    bitDepth: stream.BitDepth ?? null,
    displayTitle: stream.DisplayTitle ?? null,
  };
}

function toSubtitleStream(stream: JfMediaStream): SubtitleStreamInfo {
  return {
    codec: stream.Codec ?? null,
    language: stream.Language ?? null,
    isExternal: stream.IsExternal ?? false,
    displayTitle: stream.DisplayTitle ?? null,
  };
}

function toTranscodingDetails(info: JfTranscodingInfo, origin: TranscodingOrigin): TranscodingDetails {
  const hwAccel = info.HardwareAccelerationType;
  return {
    container: info.Container ?? null,
    videoCodec: info.VideoCodec ?? null,
    audioCodec: info.AudioCodec ?? null,
    isVideoDirect: info.IsVideoDirect ?? false,
    isAudioDirect: info.IsAudioDirect ?? false,
    width: info.Width ?? null,
    height: info.Height ?? null,
    framerate: info.Framerate ?? null,
    audioChannels: info.AudioChannels ?? null,
    bitrate: info.Bitrate ?? null,
    completionPercentage: info.CompletionPercentage ?? null,
    hardwareAcceleration: hwAccel && hwAccel.toLowerCase() !== 'none' ? hwAccel : null,
    reasons: info.TranscodeReasons ?? [],
    origin,
  };
}

/** h264_qsv → h264, libx265 → hevc; null for copy. */
function codecOfEncoder(encoder: string | null): string | null {
  if (!encoder || encoder === 'copy') return null;
  if (/264/.test(encoder)) return 'h264';
  if (/265|hevc/.test(encoder)) return 'hevc';
  if (/av1/.test(encoder)) return 'av1';
  if (/vp9/.test(encoder)) return 'vp9';
  return encoder;
}

/** What the FFmpeg log tells when Jellyfin reports nothing: the codecs, but no reasons and no live values. */
function transcodingFromLog(log: TranscodeLogInfo): TranscodingDetails {
  return {
    container: log.container,
    videoCodec: codecOfEncoder(log.encoder),
    audioCodec: log.audioEncoder === 'copy' ? null : log.audioEncoder,
    isVideoDirect: log.encoder === 'copy',
    isAudioDirect: log.audioEncoder === 'copy',
    width: null,
    height: null,
    framerate: null,
    audioChannels: log.audioChannels,
    bitrate: null,
    completionPercentage: null,
    // h264_qsv → qsv
    hardwareAcceleration: log.encoderHardware && log.encoder ? (log.encoder.split('_').pop() ?? null) : null,
    reasons: [],
    origin: 'log',
  };
}

function estimateBitrate(source: SourceMedia, transcoding: TranscodingDetails | null): number | null {
  if (transcoding?.bitrate) return transcoding.bitrate;
  const total = (source.video?.bitrate ?? 0) + (source.audio?.bitrate ?? 0);
  return total > 0 ? total : null;
}

function summarize(sessions: StreamSession[]): SessionsSummary {
  const count = (predicate: (session: StreamSession) => boolean) => sessions.filter(predicate).length;
  return {
    total: sessions.length,
    directPlay: count((s) => s.playback.method === 'DirectPlay'),
    directStream: count((s) => s.playback.method === 'Remux' || s.playback.method === 'DirectStream'),
    transcode: count((s) => s.playback.method === 'Transcode'),
    // With an FFmpeg log, count what really ran on the hardware; otherwise what is set up.
    hardwareTranscodes: count(
      (s) => s.playback.method === 'Transcode' && (s.transcodeLog ? s.transcodeLog.encoderHardware === true : s.transcoding?.hardwareAcceleration != null),
    ),
    struggling: count((s) => s.health.findings.some((f) => f.kind === 'throughput' && f.severity === 'critical')),
    estimatedBandwidth: sessions.reduce((sum, s) => sum + (s.estimatedBitrate ?? 0), 0),
  };
}

export function ticksToMs(ticks: number | undefined): number | null {
  return ticks === undefined ? null : Math.floor(ticks / TICKS_PER_MS);
}

function normalizeAddress(address: string): string {
  return address.replace(/^::ffff:/i, '');
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower);
  }
  return false;
}
