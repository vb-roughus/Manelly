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
  /** VideoFile, or Iso, Dvd, BluRay for disc images and folder rips. */
  videoType: string | null;
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
  /** Dolby Vision profile, e.g. 5, 7 or 8. */
  dvProfile: number | null;
  /** Codec level as reported by ffprobe, e.g. 153 for HEVC 5.1 or 41 for H.264 4.1. */
  level: number | null;
  /** e.g. hvc1, hev1, dvh1. */
  codecTag: string | null;
  isInterlaced: boolean;
  refFrames: number | null;
  displayTitle: string | null;
}

export interface AudioStreamInfo {
  codec: string | null;
  /** e.g. "Dolby TrueHD + Dolby Atmos", "LC". */
  profile: string | null;
  channels: number | null;
  channelLayout: string | null;
  language: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
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
  /**
   * Where the details come from when Jellyfin does not report them for the session itself:
   * another session of the same device (Jellyfin reports to the first one), what it reported
   * last for this stream, or the FFmpeg log (no reasons, no live values).
   */
  origin: TranscodingOrigin;
}

export type TranscodingOrigin = 'jellyfin' | 'sameDevice' | 'lastKnown' | 'log';

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
  /** Read from Jellyfin's FFmpeg log while the video is transcoded; null otherwise or when unreadable. */
  transcodeLog: TranscodeLogInfo | null;
  health: StreamHealth;
}

/** What Jellyfin's FFmpeg log of a transcode says about it. */
export interface TranscodeLogInfo {
  fileName: string;
  /** From the file name, in the Jellyfin server's local time. */
  startedAt: string;
  /** Video encoder FFmpeg was told to use, e.g. h264_qsv or libx264. */
  encoder: string | null;
  /** null when the video is copied or the encoder is unknown. */
  encoderHardware: boolean | null;
  /** e.g. "hwaccel d3d11va", hevc_qsv; null for software decoding. */
  decoder: string | null;
  /** False also when the hardware decoder failed and FFmpeg fell back to software. */
  decoderHardware: boolean;
  toneMapping: 'hardware' | 'software' | null;
  /** Audio encoder of the output, e.g. aac, or copy. */
  audioEncoder: string | null;
  audioChannels: number | null;
  /** Segment format of the output, e.g. ts or mp4. */
  container: string | null;
  /** FFmpeg output lines that point to hardware or encoder problems. */
  errors: string[];
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
  | {
      kind: 'softwareDecoding';
      hardware: string;
      codec: string;
      bitDepth: number | null;
      /** fallback: switched on, but FFmpeg still decoded in software (see the FFmpeg log). */
      cause: 'codecDisabled' | 'tenBitDisabled' | 'fallback';
    }
  /** Hardware acceleration is set up, but hardware encoding is switched off. */
  | {
      kind: 'softwareEncoding';
      hardware: string;
      /** The encoder from the FFmpeg log, e.g. libx264; null without a log. */
      encoder: string | null;
      /**
       * disabled: hardware encoding is switched off · platform: this acceleration does not exist on the server's
       * system · discImage: Jellyfin encodes disc images and folder rips in software · unavailable: Jellyfin's FFmpeg
       * did not offer the hardware encoder when Jellyfin started.
       */
      cause: 'disabled' | 'platform' | 'discImage' | 'unavailable';
      operatingSystem: string | null;
    }
  /** The FFmpeg log confirms hardware decoding and encoding. */
  | { kind: 'hardwareUsage'; decoder: string | null; encoder: string; toneMapping: 'hardware' | 'software' | null }
  /** FFmpeg reported hardware or encoder problems. */
  | { kind: 'ffmpegErrors'; errors: string[]; logFile: string }
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
/** DV7: Dolby Vision profile 7 (with enhancement layer); such titles also count as DV. */
export type DynamicRange = 'DV' | 'DV7' | 'HDR10+' | 'HDR10' | 'HLG' | 'SDR';

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
  /** Jellyfin media source id. */
  id: string | null;
  name: string | null;
  container: string | null;
  resolution: Resolution | null;
  dynamicRange: DynamicRange | null;
  /** Jellyfin's VideoRangeType, e.g. DOVIWithEL. */
  videoRangeType: string | null;
  /** Dolby Vision profile, e.g. 7 or 8. */
  dvProfile: number | null;
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

// --- Agent ---------------------------------------------------------------------
// The Manelly agent runs on the Jellyfin server and rewrites files there. Manelly
// always tells it which file to read and where to write; it never browses drives.

/** Where the converted file goes: next to the original, in its place, or into another folder. */
export type ConversionOutputMode = 'alongside' | 'replace' | 'folder';

/** POST /api/jobs on the agent. */
export interface ConversionRequest {
  /** Absolute path of the source file, as Jellyfin reports it. */
  source: string;
  output: {
    mode: ConversionOutputMode;
    /** folder mode: an existing folder, e.g. a library folder. */
    directory?: string;
    /** folder mode: a subfolder of `directory`, created when missing. */
    subfolder?: string;
    /** Defaults to "<name> - DV P8.mkv" (alongside) or the original name (replace, folder). */
    fileName?: string;
  };
  title?: string;
  /** From Jellyfin; the agent prefers what ffprobe reads from the file. */
  hints?: { durationMs?: number | null; frameRate?: number | null };
  /** Wait for the agent's schedule (time window, nobody streaming) instead of starting right away. */
  scheduled?: boolean;
}

export type ConversionJobState = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
export type ConversionStep = 'probe' | 'extract' | 'convert' | 'mux' | 'finalize';

export interface ConversionJob {
  id: string;
  title: string;
  source: string;
  mode: ConversionOutputMode;
  /** Final path of the converted file. */
  output: string;
  /** replace mode: where the original was moved to. */
  backup: string | null;
  state: ConversionJobState;
  step: ConversionStep | null;
  /** 0–1 over all steps; null while unknown. */
  progress: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** Last lines of the failing tool's output. */
  log: string | null;
  /** Finished, but differently than asked, e.g. the original could not be replaced. */
  warning: string | null;
  // The following fields are missing on agents before 0.2.0.
  /** Waits for the agent's schedule; false once started by hand. */
  scheduled?: boolean;
  /** Why a queued conversion does not start yet. */
  waitReason?: string | null;
  /** How often a stream or a restart interrupted it; it continues after the last finished step. */
  interruptions?: number;
  /** The agent told Jellyfin about the new file itself. */
  jellyfinNotified?: boolean;
}

/** "HH:MM" in the time zone of the agent (the Jellyfin server); may span midnight. */
export interface ConversionWindow {
  start: string;
  end: string;
}

/** When scheduled conversions may run. */
export interface ConversionSchedule {
  /** Start only within this window; null means any time. */
  window: ConversionWindow | null;
  /** Start only while nobody streams, and pause when a stream begins. */
  idleOnly: boolean;
}

/** The agent's last look at the schedule. */
export interface ConversionGate {
  /** Scheduled conversions may start. */
  open: boolean;
  /** Why they wait; null when open. */
  reason: string | null;
  /** Streams on Jellyfin; null when not checked. */
  streams: number | null;
  checkedAt: string;
}

export interface AgentScheduleStatus extends ConversionSchedule {
  /** Jellyfin as Manelly handed it to the agent; null until then. */
  jellyfinUrl: string | null;
  /** Null while no scheduled conversion waits or runs. */
  gate: ConversionGate | null;
  /** The agent's time zone, which the window refers to. */
  timeZone: string;
}

/** PUT /api/jellyfin on the agent: Manelly's Jellyfin connection, to see streams and report new files. */
export interface AgentJellyfinAccess {
  url: string;
  apiKey: string;
}

// --- Agent: network ------------------------------------------------------------
// The agent measures the network interfaces of the Jellyfin server, but only those
// picked in Manelly, and only while somebody looks.

/** A network interface of the Jellyfin server. */
export interface AgentNetworkInterface {
  /** Stable id: the adapter GUID on Windows, the name on Linux. */
  id: string;
  /** e.g. "Ethernet" or "WLAN" */
  name: string;
  /** e.g. "Intel(R) Ethernet Connection I219-V"; null on Linux. */
  description: string | null;
  /** e.g. Ethernet, Wireless80211 */
  type: string | null;
  up: boolean;
  /** Link speed in bits per second; null when unknown. */
  speedBps: number | null;
  addresses: string[];
}

/** GET /api/network/interfaces on the agent. */
export interface AgentNetworkList {
  interfaces: AgentNetworkInterface[];
  /** Ids of the monitored interfaces. */
  selected: string[];
}

export interface NetworkRatePoint {
  /** Milliseconds since the epoch. */
  t: number;
  rxBps: number;
  txBps: number;
}

export interface MonitoredInterface {
  id: string;
  name: string;
  description: string | null;
  up: boolean;
  speedBps: number | null;
  /** Bits per second; null until two samples are in. */
  rxBps: number | null;
  txBps: number | null;
  /** The last minutes, oldest first. */
  history: NetworkRatePoint[];
}

/** GET /api/network on the agent: the monitored interfaces with their current rates. */
export interface AgentNetworkStatus {
  interfaces: MonitoredInterface[];
  /** Time between two samples. */
  intervalMs: number;
  /** Why measuring failed; null when it works. */
  error: string | null;
}

// --- Agent: CPU and GPU -------------------------------------------------------------
// How busy the Jellyfin server is, and how much of it Jellyfin's FFmpeg (transcodes)
// and the agent's own conversion use. Measured only while Manelly shows it.

/** Percent of the whole CPU, or of one GPU engine. */
export interface ResourceShares {
  total: number;
  /** Jellyfin's FFmpeg processes: transcodes, and background tasks like trickplay. */
  jellyfin: number;
  /** The agent's conversion (ffmpeg, dovi_tool, mkvmerge). */
  conversion: number;
}

export interface GpuEngineUsage extends ResourceShares {
  /** VideoDecode, VideoEncode, VideoProcessing, 3D, Compute, Copy, … */
  type: string;
}

export interface GpuUsage {
  id: string;
  name: string;
  /** Busiest first. */
  engines: GpuEngineUsage[];
  /** False when only the total is known (Linux), not the shares of Jellyfin and the conversion. */
  sharesKnown: boolean;
}

export type ResourceRole = 'jellyfin' | 'conversion' | 'other';

export interface ResourceProcess {
  pid: number;
  name: string;
  role: ResourceRole;
  /** Percent of the whole CPU. */
  cpu: number;
  /** Busiest GPU engine of this process; null when unknown. */
  gpu: number | null;
}

export interface ResourcePoint {
  t: number;
  cpu: number;
  cpuJellyfin: number;
  cpuConversion: number;
  /** Busiest GPU engine; null without GPU values. */
  gpu: number | null;
  gpuJellyfin: number | null;
  gpuConversion: number | null;
}

/** GET /api/resources on the agent. */
export interface AgentResourceStatus {
  /** null until two samples are in. */
  cpu: (ResourceShares & { model: string | null; cores: number }) | null;
  gpus: GpuUsage[];
  /** Why there are no GPU values; null when there are. */
  gpuNote: string | null;
  processes: ResourceProcess[];
  /** The last minutes, oldest first. */
  history: ResourcePoint[];
  intervalMs: number;
  /** Why measuring failed; null when it works. */
  error: string | null;
}

// --- Agent: JDownloader ----------------------------------------------------------------
// JDownloader on the Jellyfin server, through its local API on port 3128 ("Deprecated API"
// in JDownloader's advanced settings). Only the agent talks to it.

/** While somebody streams: leave JDownloader alone, limit its speed, or pause it. */
export type JDownloaderThrottleMode = 'off' | 'limit' | 'pause';

export interface JDownloaderSettings {
  enabled: boolean;
  /** As the agent reaches it, e.g. http://127.0.0.1:3128. */
  url: string;
  throttle: { mode: JDownloaderThrottleMode; limitKBps: number };
}

export interface JDownloaderPackage {
  uuid: number;
  name: string;
  bytesLoaded: number;
  bytesTotal: number;
  speedBps: number;
  /** Seconds; null when unknown. */
  eta: number | null;
  finished: boolean;
  running: boolean;
  enabled: boolean;
  /** JDownloader's own status text, e.g. "Entpacken OK"; null when none. */
  status: string | null;
  saveTo: string | null;
  hosts: string[];
  childCount: number;
}

/** GET /api/jdownloader on the agent. */
export interface JDownloaderStatus {
  settings: JDownloaderSettings;
  reachable: boolean;
  /** Why JDownloader could not be reached or asked. */
  error: string | null;
  /** RUNNING, PAUSE, IDLE, STOPPING, STOPPED – as JDownloader names it. */
  state: string | null;
  speedBps: number | null;
  limit: { enabled: boolean; bytesPerSecond: number } | null;
  packages: JDownloaderPackage[];
  /** Whether the agent holds JDownloader back right now because somebody streams. */
  throttling: { active: boolean; reason: string | null };
}

export type JDownloaderAction = 'start' | 'stop' | 'pause' | 'resume';

/** Whether the hoster says the file is there: JDownloader checks this while it collects links. */
export type LinkAvailability = 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'TEMP_UNKNOWN';

export interface LinkGrabberLink {
  uuid: number;
  name: string;
  bytesTotal: number;
  host: string | null;
  availability: LinkAvailability;
  enabled: boolean;
}

/** A package in JDownloader's link grabber, before it goes to the download list. */
export interface LinkGrabberPackage {
  uuid: number;
  name: string;
  bytesTotal: number;
  childCount: number;
  hosts: string[];
  saveTo: string | null;
  enabled: boolean;
  /** Links by availability; unknown includes those JDownloader could not check for now. */
  online: number;
  offline: number;
  unknown: number;
  links: LinkGrabberLink[];
}

/** GET /api/jdownloader/linkgrabber on the agent. */
export interface LinkGrabberStatus {
  /** JDownloader is still collecting or checking links. */
  collecting: boolean;
  packages: LinkGrabberPackage[];
}

/** POST /api/jdownloader/linkgrabber/move: whole packages and single links go to the download list. */
export interface LinkGrabberMoveRequest {
  packageIds: number[];
  linkIds: number[];
}

// --- Agent: recorded history ------------------------------------------------------------
// While recording is on, the agent keeps the server's load and every stream on disk, one file
// per day, so the Troubleshooting page can look back. Times the agent was off are gaps.

export interface HistorySettings {
  enabled: boolean;
  /** Older days are deleted. */
  retentionDays: number;
}

/** The source of a stream, or what Jellyfin turns it into. */
export interface RecordedMedia {
  container: string | null;
  videoCodec: string | null;
  /** Lines, e.g. 2160. */
  height: number | null;
  /** Jellyfin's VideoRangeType, e.g. DOVI, HDR10, SDR; source only. */
  videoRange: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
}

export type StreamEventType = 'start' | 'change' | 'stop';

/** A stream started, changed how it plays (e.g. from direct play to a transcode), or stopped. */
export interface StreamEvent {
  t: number;
  type: StreamEventType;
  /** Session and item; the same for the start, the changes and the stop of one stream. */
  stream: string;
  user: string;
  client: string;
  device: string;
  remoteAddress: string | null;
  /** E.g. "Family Guy · S01E02 · Death Has a Shadow" or "Dune (2021)". */
  title: string;
  itemType: string | null;
  method: PlayMethod;
  source: RecordedMedia;
  /** What Jellyfin sends instead; null when it plays the file as it is. */
  transcoding: (RecordedMedia & { videoDirect: boolean; audioDirect: boolean; hardware: string | null }) | null;
  /** Jellyfin's TranscodeReasons, e.g. VideoCodecNotSupported. */
  reasons: string[];
  /** Bits per second, estimated like on the dashboard. */
  bitrate: number | null;
}

/** One stream from start to end, with every change in between. */
export interface StreamSpan {
  id: string;
  start: number;
  /** null while it plays, or when the agent was off when it ended. */
  end: number | null;
  /** Still playing, as far as the agent knows. */
  ongoing: boolean;
  /** How it played at the start, then after every change. */
  phases: StreamEvent[];
}

/** Averages over one step of the history; a step without records is left out. */
export interface HistoryPoint {
  t: number;
  /** Percent of the whole CPU; null when nothing was measured. */
  cpu: number | null;
  /** The highest single record within the step. */
  cpuMax: number | null;
  cpuJellyfin: number | null;
  cpuConversion: number | null;
  /** Busiest GPU engine. */
  gpu: number | null;
  gpuMax: number | null;
  gpuJellyfin: number | null;
  gpuConversion: number | null;
  /** Most streams at once within the step; null when Jellyfin could not be asked. */
  streams: number | null;
  transcodes: number | null;
  /** Estimated bitrate of all streams together, bits per second. */
  bitrate: number | null;
  /** Per interface id, bits per second. */
  network: Record<string, { rx: number; tx: number }>;
}

/** GET /api/history on the agent. */
export interface HistoryResponse {
  settings: HistorySettings;
  from: number;
  to: number;
  /** Length of one point. */
  step: number;
  points: HistoryPoint[];
  /** Streams that ran at some time within the range. */
  streams: StreamSpan[];
  /** The interfaces in the points, with the names they had when picked. */
  interfaces: Array<{ id: string; name: string }>;
  /** Start of the oldest recorded day; null without records. */
  oldest: number | null;
  /** Disk space of all records. */
  bytes: number;
  /** Why streams cannot be recorded right now; null when they can. */
  error: string | null;
}

/** The agent's own process, so it can be found in the Task Manager and stopped from Manelly. */
export interface AgentProcess {
  pid: number;
  /** ISO time. */
  startedAt: string;
  /** Node.js version, e.g. v22.12.0. */
  node: string;
  /** The node executable – the Task Manager lists the agent under this name. */
  execPath: string;
  /** Started by the autostart (the scheduled task "Manelly Agent"), not by hand. */
  autostart: boolean;
  port: number;
}

export interface AgentTool {
  path: string | null;
  version: string | null;
}

/** GET /api/status on the agent. */
export interface AgentStatus {
  version: string;
  hostname: string;
  platform: string;
  tools: { ffmpeg: AgentTool; ffprobe: AgentTool; mkvmerge: AgentTool; doviTool: AgentTool };
  /** Folders the agent may work in; empty means any folder Manelly names. */
  roots: string[];
  /** Whether everything needed for a conversion is installed. */
  ready: boolean;
  /** Missing on agents before 0.2.0. */
  schedule?: AgentScheduleStatus;
  /** Ids of the monitored network interfaces; missing on agents before 0.3.0. */
  network?: { selected: string[] };
  /** Whether the agent can measure CPU and GPU here; missing on agents before 0.4.0. */
  resources?: { supported: boolean };
  /** Missing on agents before 0.5.0; linkgrabber is missing before 0.8.0. */
  jdownloader?: { enabled: boolean; linkgrabber?: boolean };
  /** Whether the agent records the history; missing on agents before 0.6.0. */
  history?: { enabled: boolean };
  /** Missing on agents before 0.7.0, which cannot be stopped from Manelly either. */
  process?: AgentProcess;
}

/** POST /api/check on the agent: sizes for the conversion dialog, without starting anything. */
export interface AgentCheckRequest {
  source: string;
  directories: string[];
}

export interface AgentCheckResponse {
  sourceBytes: number | null;
  /** Free space per requested directory; null when it does not exist. */
  directories: Array<{ path: string; freeBytes: number | null }>;
}

/** GET/PUT /api/agent/settings in Manelly; the token itself never leaves the server. */
export interface AgentSettingsView {
  url: string | null;
  hasToken: boolean;
}

export interface SaveAgentSettingsRequest {
  url: string;
  /** Omit to keep the saved token. */
  token?: string;
}

/** GET /api/agent in Manelly. */
export interface AgentOverview {
  configured: boolean;
  status: AgentStatus | null;
  /** Why the agent could not be reached. */
  error: string | null;
}

/** GET /api/agent/conversions/options in Manelly: everything the conversion dialog offers. */
export interface ConversionOptions {
  item: { id: string; name: string; year: number | null };
  source: { mediaSourceId: string | null; path: string; bytes: number | null; videoRangeType: string | null; dvProfile: number | null };
  /** About twice the file size is needed while converting. */
  requiredBytes: number | null;
  alongside: { directory: string; fileName: string; freeBytes: number | null };
  replace: { path: string; backup: string };
  /** Folders of Jellyfin's movie and mixed libraries. */
  folders: Array<{ library: string; path: string; freeBytes: number | null }>;
  /** Suggested subfolder for folder mode: the folder the original lives in. */
  subfolder: string;
}

export interface StartConversionRequest {
  itemId: string;
  mediaSourceId?: string;
  output: ConversionRequest['output'];
  scheduled?: boolean;
}

// --- Server: transcoding ------------------------------------------------------

/** A finding about Jellyfin's transcoding settings or its recent transcodes. */
export type TranscodingCheck = { severity: FindingSeverity } & (
  | { kind: 'noAcceleration' }
  | { kind: 'platformMismatch'; hardware: string; operatingSystem: string }
  | { kind: 'encodingDisabled'; hardware: string }
  | { kind: 'decodingCodecsMissing'; hardware: string; codecs: string[] }
  | { kind: 'hevc10BitDisabled'; hardware: string }
  | { kind: 'toneMappingDisabled' }
  /** Recent transcodes in which FFmpeg reported hardware or encoder problems. */
  | { kind: 'recentErrors'; count: number; total: number }
  /** Recent transcodes encoded in software although hardware encoding is set up. */
  | { kind: 'recentSoftware'; count: number; total: number }
  | { kind: 'ok'; hardware: string }
);

/** GET /api/server/transcoding */
export interface TranscodingReport {
  /** windows, linux or macos. */
  operatingSystem: string | null;
  hardwareAcceleration: string | null;
  hardwareEncoding: boolean;
  hardwareDecodingCodecs: string[];
  hevc10Bit: boolean;
  toneMapping: boolean;
  allowHevcEncoding: boolean;
  allowAv1Encoding: boolean;
  /** The FFmpeg Jellyfin uses, as Jellyfin shows it. */
  encoderPath: string | null;
  checks: TranscodingCheck[];
  /** The latest FFmpeg transcode logs, newest first. */
  recent: TranscodeLogInfo[];
  /** False when Jellyfin's logs could not be read (the API key needs admin rights). */
  logsReadable: boolean;
}

export type HardwareTestId = 'encode-h264' | 'encode-hevc' | 'decode-h264' | 'decode-hevc' | 'decode-hevc10';

/** POST /api/hwtest on the agent. */
export interface HardwareTestRequest {
  /** qsv, nvenc, amf, vaapi, videotoolbox, v4l2m2m, rkmpp. */
  hardware: string;
  /** Jellyfin's FFmpeg; the agent's own one when empty or missing. */
  ffmpegPath?: string | null;
  vaapiDevice?: string | null;
  tests: HardwareTestId[];
}

export interface HardwareTestResult {
  hardware: string;
  ffmpeg: { path: string | null; version: string | null };
  tests: Array<{
    id: HardwareTestId;
    ok: boolean;
    /** E.g. no software encoder to create a test video for decoding. */
    skipped: boolean;
    message: string | null;
    /** FFmpeg's output when the test failed. */
    log: string | null;
    durationMs: number;
  }>;
}
