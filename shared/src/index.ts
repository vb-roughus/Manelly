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
  health: StreamHealth;
}

export type FindingSeverity = 'good' | 'info' | 'warning' | 'critical';

/** Something worth knowing about a stream, with the facts the UI needs to explain it. */
export type StreamFinding = { severity: FindingSeverity } & (
  | {
      /** Whether the transcoder keeps up with playback. */
      kind: 'throughput';
      /** Transcoder frames per second relative to the source frame rate; below 1 it falls behind. */
      speed: number | null;
      transcodeFps: number | null;
      sourceFps: number | null;
      /** How far the transcoder is ahead of the playback position. */
      bufferAheadMs: number | null;
    }
  /** Video is transcoded, but Jellyfin has no hardware acceleration set up. */
  | { kind: 'softwareTranscoding' }
  /** Hardware acceleration is set up, but not enabled for decoding this video. */
  | { kind: 'softwareDecoding'; hardware: string; codec: string; bitDepth: number | null; cause: 'codecDisabled' | 'tenBitDisabled' }
  /** Hardware acceleration is set up, but hardware encoding is switched off. */
  | { kind: 'softwareEncoding'; hardware: string }
  /** HDR is converted to SDR without tone mapping (pale colors) or in software (very slow). */
  | { kind: 'toneMapping'; videoRangeType: string | null; cause: 'disabled' | 'software' }
  /** The bitrate is too high for a limit: the user's or the server's remote limit, or the client's quality setting. */
  | { kind: 'bitrateLimit'; limitedBy: 'user' | 'server' | 'client' | 'unknown'; limit: number | null; sourceBitrate: number | null }
  /** A high bitrate goes over the internet. */
  | { kind: 'remoteBitrate'; bitrate: number }
);

export interface StreamHealth {
  /** Worst severity of the findings; null without findings. */
  severity: FindingSeverity | null;
  /** Most severe first. */
  findings: StreamFinding[];
  /** Whether Jellyfin's transcoding settings and user limits could be read. */
  settingsKnown: boolean;
}

export interface SessionsSummary {
  total: number;
  directPlay: number;
  /** Remux and DirectStream together: light load, no video encoding. */
  directStream: number;
  transcode: number;
  hardwareTranscodes: number;
  /** Streams whose transcoder does not keep up with playback. */
  struggling: number;
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

// ---------------------------------------------------------------------------
// Media search

export type MediaType = 'Movie' | 'Series';

/**
 * Audio formats Manelly distinguishes. A track lists its codec format and, if
 * present, an immersive format on top, e.g. ["truehd", "atmos"].
 */
export type AudioFormat =
  | 'atmos'
  | 'dtsx'
  | 'truehd'
  | 'eac3'
  | 'ac3'
  | 'dts-hd-ma'
  | 'dts-hd'
  | 'dts'
  | 'aac'
  | 'flac'
  | 'pcm'
  | 'opus'
  | 'mp3'
  | 'vorbis'
  | 'other';

export type Resolution = '4K' | '1080p' | '720p' | 'SD';

/** DV = Dolby Vision. */
export type DynamicRange = 'DV' | 'HDR10+' | 'HDR10' | 'HLG' | 'SDR';

/** Video codec families; mpeg4 includes XviD and DivX. */
export type VideoCodec = 'hevc' | 'h264' | 'av1' | 'vp9' | 'mpeg4' | 'mpeg2' | 'vc1' | 'other';

export interface AudioTrack {
  /** BCP 47 language, e.g. "de"; null when the file does not say. */
  language: string | null;
  formats: AudioFormat[];
  codec: string | null;
  /** Codec profile from Jellyfin, e.g. "Dolby TrueHD + Dolby Atmos". */
  profile: string | null;
  channels: number | null;
  channelLayout: string | null;
  title: string | null;
  isDefault: boolean;
  /** Detail view only: whether the track satisfies the active audio filter. */
  matches?: boolean;
}

/** One file of an item; movies can have several versions (e.g. 4K and 1080p). */
export interface MediaVersion {
  name: string | null;
  container: string | null;
  resolution: Resolution | null;
  dynamicRange: DynamicRange | null;
  videoCodec: string | null;
  audio: AudioTrack[];
}

export type AudioFilterMode = 'has' | 'lacks';
export type AudioFilterCoverage = 'any' | 'all';
export type MediaSort = 'name' | 'year' | 'rating' | 'added';

/** Query parameters of GET /api/media/search; lists are repeated parameters. */
export interface MediaSearchParams {
  q?: string;
  type?: MediaType;
  genre?: string[];
  yearFrom?: number;
  yearTo?: number;
  minRating?: number;
  officialRating?: string[];
  resolution?: Resolution[];
  dynamicRange?: DynamicRange[];
  videoCodec?: VideoCodec[];
  library?: string[];
  /** Language, format and channel conditions must all hold for the same track. Use "und" for unknown. */
  audioLanguage?: string[];
  audioFormat?: AudioFormat[];
  audioMinChannels?: number;
  audioMode?: AudioFilterMode;
  /** Series: "all" requires every episode to satisfy the audio filter. */
  audioCoverage?: AudioFilterCoverage;
  sort?: MediaSort;
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface AudioBadge {
  language: string | null;
  /** The most notable format of the track, e.g. "atmos" for TrueHD Atmos. */
  format: AudioFormat;
  channels: number | null;
  /** Whether a track of this kind satisfies the active audio filter. */
  matches: boolean;
}

export interface MediaSummary {
  id: string;
  type: MediaType;
  name: string;
  year: number | null;
  endYear: number | null;
  communityRating: number | null;
  officialRating: string | null;
  genres: string[];
  poster: ImageRef | null;
  resolutions: Resolution[];
  dynamicRanges: DynamicRange[];
  audio: AudioBadge[];
  /** Series only; `matching` is null without an audio filter. */
  episodes: { total: number; matching: number | null } | null;
}

export interface EpisodeDetail {
  id: string;
  name: string;
  episode: number | null;
  resolution: Resolution | null;
  dynamicRange: DynamicRange | null;
  audio: AudioTrack[];
  /** Null without an audio filter. */
  matches: boolean | null;
}

export interface SeasonDetail {
  season: number | null;
  episodes: EpisodeDetail[];
}

export interface MediaDetail {
  summary: MediaSummary;
  originalTitle: string | null;
  overview: string | null;
  backdrop: ImageRef | null;
  /** Movies: the files with their tracks. */
  versions: MediaVersion[];
  /** Series: episodes grouped by season. */
  seasons: SeasonDetail[];
}

export interface MediaIndexStatus {
  state: 'empty' | 'building' | 'ready' | 'error';
  builtAt: string | null;
  counts: { movies: number; series: number; episodes: number } | null;
  /** While building: items loaded so far. */
  progress: { loaded: number; total: number } | null;
  error: string | null;
  /** Titles Jellyfin could not deliver with media details; they are listed without tracks. */
  skipped: SkippedTitle[];
}

export interface SkippedTitle {
  id: string | null;
  name: string | null;
  reason: string;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface MediaFacets {
  genres: FacetValue[];
  officialRatings: FacetValue[];
  years: { min: number | null; max: number | null };
  audioLanguages: FacetValue[];
  audioFormats: FacetValue[];
  resolutions: FacetValue[];
  dynamicRanges: FacetValue[];
  videoCodecs: FacetValue[];
  libraries: Array<FacetValue & { name: string }>;
}

export interface MediaFacetsResponse {
  facets: MediaFacets | null;
  index: MediaIndexStatus;
}

/** Filter groups, e.g. to say which of them hide a title. */
export type FilterKey =
  | 'q'
  | 'type'
  | 'genre'
  | 'year'
  | 'rating'
  | 'officialRating'
  | 'library'
  | 'resolution'
  | 'dynamicRange'
  | 'videoCodec'
  | 'audio';

/** Why a title does or does not show up in the media search. */
export type TitleVerdict =
  /** In the index and matching the current filters. */
  | 'visible'
  /** In the index, hidden by `failingFilters`. */
  | 'filtered'
  /** Jellyfin lists it as something other than a movie or series, e.g. "Video". */
  | 'unsupportedType'
  /** Its library is of a type Manelly does not read, e.g. home videos. */
  | 'unsupportedLibrary'
  /** Its path belongs to none of the libraries. */
  | 'noLibrary'
  | 'indexNotReady'
  /** Jellyfin does not return it when its library is listed – the way the index reads it. */
  | 'notInLibraryQuery'
  /**
   * Jellyfin lists it in its library, but the index does not have it: either
   * the index predates the title, or – after a fresh "Neu einlesen" – a bug.
   */
  | 'notIndexed';

export interface TitleDiagnosis {
  id: string;
  name: string;
  /** Jellyfin item type: Movie, Series, Video, ... */
  type: string;
  year: number | null;
  library: { name: string; collectionType: string | null } | null;
  path: string | null;
  dateCreated: string | null;
  /** Jellyfin's "date added" lies in the future (wrong clock or time zone in Jellyfin, or a file date). */
  dateCreatedInFuture: boolean;
  /** How many entries Jellyfin listed for the title's library when checked. */
  listing: { libraryTotal: number } | null;
  verdict: TitleVerdict;
  failingFilters: FilterKey[];
  /** Listed without audio and video details because Jellyfin could not deliver them. */
  incompleteMedia: boolean;
}

export interface MediaDiagnosisResponse {
  title: string;
  index: MediaIndexStatus;
  results: TitleDiagnosis[];
}

export interface MediaSearchResponse {
  items: MediaSummary[];
  total: number;
  offset: number;
  index: MediaIndexStatus;
}

// ---------------------------------------------------------------------------
// Collections

export interface CollectionSummary {
  id: string;
  name: string;
  itemCount: number | null;
}

export interface CollectionsResponse {
  collections: CollectionSummary[];
}

export interface CollectionPreviewRequest {
  /** Null for a collection that is yet to be created. */
  collectionId: string | null;
  filters: MediaSearchParams;
}

export interface CollectionPreview {
  /** Titles matching the filters. */
  matching: number;
  alreadyIn: number;
  toAdd: number;
}

/** Either `collectionId` (existing collection) or `name` (create a new one). */
export interface AddToCollectionRequest {
  collectionId?: string;
  name?: string;
  filters: MediaSearchParams;
}

export interface AddToCollectionResponse {
  collection: { id: string; name: string };
  added: number;
  alreadyIn: number;
  /** Titles Jellyfin no longer knows, e.g. deleted since the last index refresh. */
  failed: number;
}
