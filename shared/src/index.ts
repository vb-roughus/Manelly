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
  /** File size in bytes; null when Jellyfin does not know it, missing in an index built before. */
  bytes?: number | null;
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

/**
 * Jellyfin's scan for new and changed files: of all libraries (its task «Medienbibliothek scannen»), or of single ones;
 * /api/media/scan.
 */
export interface LibraryScanStatus {
  /** The scan of all libraries; running also right after Manelly asked for it, until Jellyfin reports the task. */
  state: 'idle' | 'running' | 'cancelling';
  /** Percent while it runs, when Jellyfin says. */
  progress: number | null;
  /** The last scan of all libraries that ended, as Jellyfin reports it. */
  lastRun: { startedAt: string | null; endedAt: string | null; result: 'completed' | 'failed' | 'cancelled' | 'aborted'; error: string | null } | null;
  libraries: LibraryScanEntry[];
}

export interface LibraryScanEntry {
  /** Jellyfin's id of the library, for scanning it alone; null when Jellyfin gives none. */
  id: string | null;
  name: string;
  type: string | null;
  locations: string[];
  /** Jellyfin scans it right now (or was just asked to); percent when it says. */
  scanning: boolean;
  progress: number | null;
}

/** POST /api/media/scan: one library, or all of them without an id. */
export interface LibraryScanRequest {
  libraryId?: string;
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
  /**
   * Convert in the agent's work folder (agent from 0.17.0): copy the original there, convert there, copy the result
   * back to `output`. The storage is busy only while copying.
   */
  work?: boolean;
}

export type ConversionJobState = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
/** fetch and store: copying into and out of the work folder. */
export type ConversionStep = 'fetch' | 'probe' | 'extract' | 'convert' | 'mux' | 'store' | 'finalize';

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
  /**
   * Paused by hand: while running, its tool is held where it is; while queued, it waits to be continued.
   * Missing before agent 0.12.0, which cannot pause.
   */
  paused?: boolean;
  /** The work folder it converts in; null when it converts where the files are. Missing before agent 0.17.0. */
  work?: string | null;
  /** Size of the original when the job was added; null when unknown. Missing before agent 0.20.0. */
  sourceBytes?: number | null;
  /**
   * How fast the running step moves the film right now, in bytes per second – as fast as the file it writes grows.
   * null between steps and until measured; missing before agent 0.21.0.
   */
  bytesPerSecond?: number | null;
  /** While copying to or from the work folder is held back; null otherwise. Missing before agent 0.21.0. */
  copyThrottle?: CopyThrottle | null;
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

/**
 * What a monitored interface is for: towards the players, for administration, towards the storage with the films.
 * Not every server has an interface for each, so one interface can have several roles.
 */
export type NetworkRole = 'streaming' | 'management' | 'storage';

/** GET /api/network/interfaces on the agent. */
export interface AgentNetworkList {
  interfaces: AgentNetworkInterface[];
  /** Ids of the monitored interfaces. */
  selected: string[];
  /** Roles of the monitored interfaces by id; missing on agents before 0.19.0. */
  roles?: Record<string, NetworkRole[]>;
}

/** PUT /api/network/interfaces on the agent: which interfaces to monitor, and their roles. */
export interface NetworkInterfacesRequest {
  interfaces: string[];
  /** By interface id; ids that are not monitored are ignored. */
  roles?: Record<string, NetworkRole[]>;
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
  /** Missing on agents before 0.19.0. */
  roles?: NetworkRole[];
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
  /** Unpacking the archives after the download, as its parts tell; null when nothing is unpacked. Missing before agent 0.10.0. */
  extraction?: JDownloaderExtraction | null;
  /** The single files (parts); only when asked for with ?links=1. */
  links?: JDownloaderLink[];
}

export type ExtractionState = 'running' | 'done' | 'failed';

export interface JDownloaderExtraction {
  state: ExtractionState;
  /** 0–100 while unpacking, when JDownloader says. */
  percent: number | null;
  /** JDownloader's words, e.g. why it failed. */
  message: string | null;
}

/** One file of a package, e.g. one part of a split archive. */
export interface JDownloaderLink {
  uuid: number;
  name: string;
  host: string | null;
  bytesLoaded: number;
  bytesTotal: number;
  speedBps: number;
  /** Seconds; null when unknown. */
  eta: number | null;
  finished: boolean;
  running: boolean;
  enabled: boolean;
  /** JDownloader's own status text; null when none. */
  status: string | null;
  extraction: JDownloaderExtraction | null;
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

/** POST /api/jdownloader/linkgrabber/container (agent from 0.15.0): a container file for the link grabber. */
export interface LinkGrabberContainerRequest {
  /** The file's name; it ends in .dlc. */
  name: string;
  /** The file itself, base64; at most 1 MB. */
  content: string;
}

/** JDownloader reads the file in the background; its packages show up in the link grabber a moment later. */
export interface LinkGrabberContainerAnswer {
  added: string;
}

/** POST /api/jdownloader/linkgrabber/move: whole packages and single links go to the download list. */
export interface LinkGrabberMoveRequest {
  packageIds: number[];
  linkIds: number[];
}

/** What JDownloader says about an account: works, or why not. */
export type JDownloaderAccountState = 'ok' | 'disabled' | 'expired' | 'invalid' | 'blocked' | 'error' | 'unchecked';

/** A premium account configured in JDownloader. */
export interface JDownloaderAccount {
  id: number;
  /** The hoster, e.g. rapidgator.net. */
  hoster: string;
  username: string | null;
  state: JDownloaderAccountState;
  /** JDownloader's own words when the account does not work. */
  error: string | null;
  /** ISO time the premium time ends; null when unknown or without end. */
  validUntil: string | null;
  /** Bytes; null when unknown or unlimited (see unlimited). */
  trafficLeft: number | null;
  trafficMax: number | null;
  unlimited: boolean;
}

/** GET /api/jdownloader/accounts on the agent (from 0.13.0). */
export interface JDownloaderAccounts {
  accounts: JDownloaderAccount[];
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

/** The last update the agent's runner made: git pull, dependencies, build. */
export interface AgentUpdateResult {
  /** ISO time. */
  at: string;
  ok: boolean;
  /** There was nothing newer, so nothing changed and nothing restarted; missing before agent 0.11.0. */
  upToDate?: boolean;
  /** Commits before and after the git pull, short form. */
  from: string | null;
  to: string | null;
  message: string;
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
  /** An update under way while the agent keeps running; missing before 0.11.0, which updated while stopped. */
  update?: UpdateProgress | null;
  /** Runs under scripts/run-agent.ps1, which starts it again on request; missing before 0.9.0. */
  restartable?: boolean;
  lastUpdate?: AgentUpdateResult | null;
}

/** A drive letter the Windows user connected to a share, as the agent (started without logon) reaches it. */
export interface NetworkDrive {
  /** "Z:" */
  letter: string;
  /** "\\nas\filme" */
  remote: string;
  connected: boolean;
  /** Why the agent could not connect it, with what helps. */
  error: string | null;
  /** The login Manelly handed over for its server; missing on agents before 0.16.0, which take none. */
  username?: string | null;
}

/** PUT /api/drives/credentials on the agent: the login for the shares of one server, e.g. "\\nas". */
export interface DriveCredentialRequest {
  server: string;
  username: string;
  password: string;
}

/** The network drives after a login was handed over or removed. */
export interface NetworkDrives {
  drives: NetworkDrive[];
}

/** POST /api/restart on the agent: start again, after a git pull and a build when update is set. */
export interface AgentRestartRequest {
  update: boolean;
  /** Also while a conversion runs, which then pauses and continues after the restart; agents from 0.22.0 refuse otherwise. */
  force?: boolean;
}

/** The answer to a restart or update request, from the agent and from Manelly. */
export interface AgentRestartAnswer {
  /** The process ends now; false while an update runs first. */
  restarting: boolean;
  /** The update under way, which restarts only when it found something new. */
  update?: UpdateProgress;
}

/** The steps of an update by scripts/update.mjs, in this order; install only when the dependencies changed. */
export type UpdateStep = 'check' | 'pull' | 'install' | 'build' | 'restart';

/** An update under way in the agent or in Manelly, as far as that process knows. */
export interface UpdateProgress {
  step: UpdateStep;
  /** The steps entered so far, the current one last. */
  steps: UpdateStep[];
  /** ISO time the update started. */
  since: string;
  /** New commits waiting on GitHub, once the check is done. */
  behind: number | null;
  /** The subject of the newest one. */
  subject: string | null;
}

// --- Manelly itself --------------------------------------------------------------------

/** GET /api/manelly: Manelly's own server process. */
export interface ManellyStatus {
  /** Short git commit the running server was started from; null outside a git checkout, e.g. in Docker. */
  commit: string | null;
  pid: number;
  /** ISO time. */
  startedAt: string;
  /** Node.js version, e.g. v22.12.0. */
  node: string;
  platform: string;
  hostname: string;
  port: number;
  /** Runs under scripts/start-mac.sh or scripts/start-windows.ps1, which start it again on request. */
  restartable: boolean;
  /** Runs in a Docker container, which is updated with docker compose instead. */
  docker: boolean;
  /** An update under way, while Manelly keeps running until its restart. */
  update: UpdateProgress | null;
  /** How the last update went; the same report as the agent's. */
  lastUpdate: AgentUpdateResult | null;
}

/** POST /api/manelly/restart: start again, after a git pull and a build when update is set. */
export interface ManellyRestartRequest {
  update: boolean;
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
  /** Missing on agents before 0.5.0; linkgrabber is missing before 0.8.0, accounts before 0.13.0, containers before 0.15.0. */
  jdownloader?: { enabled: boolean; linkgrabber?: boolean; accounts?: boolean; containers?: boolean };
  /** The Windows user's network drives and whether the agent reaches them; missing before 0.14.0, empty elsewhere. */
  drives?: NetworkDrive[];
  /** The work folder for conversions; missing before agent 0.17.0. */
  work?: WorkFolderStatus;
  /** Keeps the originals that conversions in the work folder replaced; missing before agent 0.18.0. */
  originals?: boolean;
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
  /** Missing before agent 0.17.0. */
  work?: WorkFolderStatus;
}

/**
 * A folder on a fast disk of the Jellyfin server where conversions copy the original to, convert, and copy the
 * result back from; set in Manelly, kept by the agent.
 */
export interface WorkFolderStatus {
  directory: string | null;
  freeBytes: number | null;
  /** Why the agent cannot use it right now, e.g. the disk is gone. */
  error: string | null;
  /** How fast conversions copy to and from it; missing before agent 0.21.0. */
  copyLimit?: CopyLimit;
}

/**
 * Copying to and from the work folder: at full speed; while somebody streams with what the streams leave of the
 * storage; or always at a fixed rate.
 */
export type CopyLimitMode = 'off' | 'streaming' | 'always';

/**
 * PUT /api/work/copy-limit on the agent (from 0.21.0). Rates in Mbit/s (1 Mbit = 1 000 000 bits) from agent 0.23.0;
 * older agents store and report `limitMBps` and `storageMBps` in MB/s (1 MB = 1024 × 1024 bytes) instead.
 */
export interface CopyLimit {
  mode: CopyLimitMode;
  /** 'always': copy at most this fast. */
  limitMbps: number;
  /** 'streaming': what the storage manages in all; copying gets that minus the running streams and a reserve. */
  storageMbps: number;
}

/** Why and how much a copy to or from the work folder is held back right now. */
export interface CopyThrottle {
  bytesPerSecond: number;
  /** The running streams that make room for themselves; null when always limited. */
  streams: number | null;
  /** What they read from the storage, estimated from their files; null when always limited. */
  streamsBitsPerSecond: number | null;
}

/** An original that a conversion in the work folder replaced: kept there until it is deleted in Manelly. */
export interface ArchivedOriginal {
  id: string;
  title: string;
  /** Where it was before, on the storage; the converted file is there now. */
  source: string;
  /** Where it is now, in the folder "Originale" of the work folder. */
  path: string;
  bytes: number | null;
  archivedAt: string;
}

/** GET /api/originals on the agent (from 0.18.0), newest first. */
export interface ArchivedOriginals {
  originals: ArchivedOriginal[];
  /** Free space on the disk of the work folder; null without one. */
  freeBytes: number | null;
}

/** PUT /api/work on the agent; null switches the work folder off. */
export interface WorkFolderRequest {
  directory: string | null;
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
  /** The agent's work folder, when one is set; converting there needs space there and only the result's at the target. */
  work: {
    directory: string;
    freeBytes: number | null;
    error: string | null;
    requiredBytes: number | null;
    targetBytes: number | null;
    /** Where the original goes when it is replaced: kept in the work folder, not on the storage. */
    backup: string;
  } | null;
}

export interface StartConversionRequest {
  itemId: string;
  mediaSourceId?: string;
  output: ConversionRequest['output'];
  scheduled?: boolean;
  /** Convert in the agent's work folder. */
  work?: boolean;
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
