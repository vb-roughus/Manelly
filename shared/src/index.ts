// API contract between the Manelly server and the web frontend.
// The server translates Jellyfin's API into these shapes, so the frontend
// never has to know Jellyfin's naming quirks (ticks, PascalCase, ...).

/**
 * How a stream reaches the client, using the same categories as
 * Jellyfin's own dashboard:
 * - DirectPlay: the file is sent as-is.
 * - Remux: audio and video are copied, only the container changes.
 * - DirectStream: video is copied, audio is transcoded.
 * - Transcode: video (or, for audio items, the audio) is re-encoded.
 */
export type PlayMethod = 'DirectPlay' | 'Remux' | 'DirectStream' | 'Transcode';

export type ApiErrorCode =
  | 'NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface ServerStatus {
  id: string;
  name: string;
  version: string;
  operatingSystem: string | null;
  hasPendingRestart: boolean;
  hasUpdateAvailable: boolean;
  /** Base URL Manelly uses to talk to Jellyfin. */
  url: string;
}

export type ImageAspect = 'portrait' | 'square' | 'landscape';

/** Reference to a Jellyfin image, served through `/api/images/items/:itemId/:type`. */
export interface ImageRef {
  itemId: string;
  type: 'Primary' | 'Backdrop' | 'Thumb';
  tag: string;
  aspect: ImageAspect;
}

export interface NowPlayingItem {
  id: string;
  /** Jellyfin item type, e.g. Movie, Episode, Audio, TvChannel. */
  type: string;
  name: string;
  seriesName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  album: string | null;
  artists: string[];
  productionYear: number | null;
  durationMs: number | null;
  poster: ImageRef | null;
  backdrop: ImageRef | null;
}

export interface PlaybackState {
  positionMs: number;
  isPaused: boolean;
  isMuted: boolean;
  method: PlayMethod;
}

export interface VideoStreamInfo {
  codec: string | null;
  profile: string | null;
  width: number | null;
  height: number | null;
  bitDepth: number | null;
  frameRate: number | null;
  bitrate: number | null;
  /** SDR, HDR, ... */
  videoRange: string | null;
  /** SDR, HDR10, HDR10Plus, DOVI, HLG, ... */
  videoRangeType: string | null;
  displayTitle: string | null;
}

export interface AudioStreamInfo {
  codec: string | null;
  channels: number | null;
  channelLayout: string | null;
  language: string | null;
  bitrate: number | null;
  displayTitle: string | null;
}

export interface SubtitleStreamInfo {
  codec: string | null;
  language: string | null;
  isExternal: boolean;
  displayTitle: string | null;
}

/** The media as stored on the server (the streams the client selected). */
export interface SourceMedia {
  container: string | null;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
  subtitle: SubtitleStreamInfo | null;
}

/** What the transcoder produces; only present while Jellyfin transcodes or remuxes. */
export interface TranscodingDetails {
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  isVideoDirect: boolean;
  isAudioDirect: boolean;
  width: number | null;
  height: number | null;
  framerate: number | null;
  audioChannels: number | null;
  bitrate: number | null;
  /** How far the transcoder has progressed through the item, 0-100. */
  completionPercentage: number | null;
  /** e.g. vaapi, qsv, nvenc; null when encoding in software. */
  hardwareAcceleration: string | null;
  /** Jellyfin TranscodeReason values, e.g. VideoCodecNotSupported. */
  reasons: string[];
}

export interface StreamSession {
  id: string;
  user: {
    id: string | null;
    name: string;
    imageTag: string | null;
  };
  client: string;
  device: string;
  appVersion: string | null;
  remoteAddress: string | null;
  /** True when the client connects from a private or loopback address. */
  isLocalNetwork: boolean | null;
  lastActivity: string | null;
  item: NowPlayingItem;
  playback: PlaybackState;
  source: SourceMedia;
  transcoding: TranscodingDetails | null;
  /** Bits per second sent to the client; transcoder output or source stream bitrates. */
  estimatedBitrate: number | null;
}

export interface SessionsSummary {
  total: number;
  directPlay: number;
  /** Remux and DirectStream together: light load, no video encoding. */
  directStream: number;
  transcode: number;
  hardwareTranscodes: number;
  /** Sum of all known stream bitrates in bits per second. */
  estimatedBandwidth: number;
}

export interface SessionsResponse {
  sessions: StreamSession[];
  /** Connected clients that are not playing anything. */
  idleSessions: number;
  summary: SessionsSummary;
  fetchedAt: string;
}

/** Where the active Jellyfin connection comes from. */
export type SettingsSource = 'ui' | 'env';

/** The saved connection; the API key itself never leaves the server. */
export interface ConnectionSettings {
  jellyfinUrl: string | null;
  apiKeyConfigured: boolean;
  /** Last characters of the key, so it can be recognised. */
  apiKeyHint: string | null;
  source: SettingsSource | null;
}

export interface SaveSettingsRequest {
  jellyfinUrl: string;
  /** Omit or leave empty to keep the saved key. */
  apiKey?: string;
}

export interface SaveSettingsResponse {
  settings: ConnectionSettings;
  server: ServerStatus;
}
