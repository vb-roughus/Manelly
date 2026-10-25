// The subset of Jellyfin's API types Manelly reads.
// Field names follow the Jellyfin OpenAPI spec (PascalCase); every field is
// optional because Jellyfin omits empty values from its responses.

export type JfPlayMethod = 'Transcode' | 'DirectStream' | 'DirectPlay';

export interface JfSystemInfo {
  Id?: string;
  ServerName?: string;
  Version?: string;
  OperatingSystem?: string;
  OperatingSystemDisplayName?: string;
  HasPendingRestart?: boolean;
  HasUpdateAvailable?: boolean;
}

export interface JfMediaStream {
  Type?: 'Audio' | 'Video' | 'Subtitle' | 'EmbeddedImage' | 'Data' | 'Lyric';
  Index?: number;
  Codec?: string;
  Profile?: string;
  Language?: string;
  Title?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  IsExternal?: boolean;
  BitRate?: number;
  BitDepth?: number;
  Width?: number;
  Height?: number;
  AverageFrameRate?: number;
  RealFrameRate?: number;
  Channels?: number;
  ChannelLayout?: string;
  VideoRange?: string;
  VideoRangeType?: string;
  /** Codec level as reported by ffprobe, e.g. 153 for HEVC 5.1 or 41 for H.264 4.1. */
  Level?: number;
  /** e.g. hvc1, hev1, dvh1. */
  CodecTag?: string;
  IsInterlaced?: boolean;
  RefFrames?: number;
  DvProfile?: number;
  SampleRate?: number;
}

export interface JfMediaSource {
  Id?: string;
  Name?: string;
  Container?: string;
  MediaStreams?: JfMediaStream[];
}

export interface JfBaseItem {
  Id?: string;
  Name?: string;
  Path?: string;
  SortName?: string;
  OriginalTitle?: string;
  Overview?: string;
  Type?: string;
  Container?: string;
  Genres?: string[];
  OfficialRating?: string;
  CommunityRating?: number;
  DateCreated?: string;
  EndDate?: string;
  RunTimeTicks?: number;
  ProductionYear?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  SeriesName?: string;
  SeriesId?: string;
  SeriesPrimaryImageTag?: string;
  Album?: string;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  AlbumArtist?: string;
  Artists?: string[];
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  PrimaryImageAspectRatio?: number;
  MediaStreams?: JfMediaStream[];
  MediaSources?: JfMediaSource[];
  /** Folders and collections; only filled with a user context. */
  ChildCount?: number;
}

export interface JfItemsResult {
  Items?: JfBaseItem[];
  TotalRecordCount?: number;
}

export interface JfUser {
  Id?: string;
  Name?: string;
  Policy?: { IsAdministrator?: boolean; IsDisabled?: boolean; RemoteClientBitrateLimit?: number };
}

/** GET /System/Configuration/encoding (the parts Manelly uses). */
export interface JfEncodingOptions {
  /** none, qsv, vaapi, nvenc, amf, videotoolbox, v4l2m2m, rkmpp. */
  HardwareAccelerationType?: string;
  EnableHardwareEncoding?: boolean;
  /** Source codecs decoded in hardware, e.g. h264, hevc, vp9, av1. */
  HardwareDecodingCodecs?: string[];
  EnableDecodingColorDepth10Hevc?: boolean;
  EnableDecodingColorDepth10Vp9?: boolean;
  EnableTonemapping?: boolean;
  EnableVppTonemapping?: boolean;
  EnableVideoToolboxTonemapping?: boolean;
}

/** GET /System/Configuration (the parts Manelly uses). */
export interface JfServerConfiguration {
  /** Bits per second for clients outside the local network; 0 means no limit. */
  RemoteClientBitrateLimit?: number;
}

export interface JfVirtualFolder {
  Name?: string;
  ItemId?: string;
  Locations?: string[];
  /** movies, tvshows, music, mixed, ...; missing for older mixed libraries. */
  CollectionType?: string | null;
}

export interface JfPlayerState {
  PositionTicks?: number;
  IsPaused?: boolean;
  IsMuted?: boolean;
  PlayMethod?: JfPlayMethod;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  MediaSourceId?: string;
}

export interface JfTranscodingInfo {
  AudioCodec?: string;
  VideoCodec?: string;
  Container?: string;
  IsVideoDirect?: boolean;
  IsAudioDirect?: boolean;
  Bitrate?: number;
  Framerate?: number;
  CompletionPercentage?: number;
  Width?: number;
  Height?: number;
  AudioChannels?: number;
  HardwareAccelerationType?: string;
  TranscodeReasons?: string[];
}

export interface JfSessionInfo {
  Id?: string;
  UserId?: string;
  UserName?: string;
  UserPrimaryImageTag?: string;
  Client?: string;
  DeviceName?: string;
  DeviceId?: string;
  ApplicationVersion?: string;
  RemoteEndPoint?: string;
  LastActivityDate?: string;
  NowPlayingItem?: JfBaseItem;
  PlayState?: JfPlayerState;
  TranscodingInfo?: JfTranscodingInfo;
}
