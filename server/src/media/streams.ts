import type { AudioFormat, AudioTrack, DynamicRange, MediaVersion, Resolution, VideoCodec } from '@manelly/shared';
import type { JfBaseItem, JfMediaStream } from '../jellyfin/types.js';

// Codes that say "no particular language": undetermined, no linguistic content, private use.
const UNKNOWN_LANGUAGES = new Set(['und', 'zxx', 'mis']);

/**
 * Jellyfin stores whatever the file says: ISO 639-2/B ("ger"), 639-2/T ("deu")
 * or 639-1 ("de"). Intl knows all aliases and returns the BCP 47 code ("de").
 */
export function canonicalLanguage(code: string | undefined | null): string | null {
  const raw = code?.trim().toLowerCase();
  if (!raw || UNKNOWN_LANGUAGES.has(raw) || /^q[a-t][a-z]$/.test(raw)) return null;
  try {
    const [locale] = Intl.getCanonicalLocales(raw);
    return locale ? locale.split('-')[0]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

const CODEC_FORMATS: Record<string, AudioFormat> = {
  truehd: 'truehd',
  mlp: 'truehd',
  eac3: 'eac3',
  ac3: 'ac3',
  aac: 'aac',
  flac: 'flac',
  opus: 'opus',
  mp3: 'mp3',
  vorbis: 'vorbis',
  alac: 'other',
};

/**
 * Atmos and DTS:X are not codecs but extensions of TrueHD, E-AC3 and DTS-HD MA.
 * FFmpeg reports them in the profile ("Dolby TrueHD + Dolby Atmos"); some files
 * only mention them in the track title.
 */
export function audioFormats(stream: Pick<JfMediaStream, 'Codec' | 'Profile' | 'Title'>): AudioFormat[] {
  const codec = stream.Codec?.toLowerCase() ?? '';
  const profile = stream.Profile ?? '';
  const described = `${profile} ${stream.Title ?? ''}`;

  let base: AudioFormat;
  if (codec === 'dts' || codec === 'dca') {
    base = /\bMA\b/i.test(profile) ? 'dts-hd-ma' : /DTS-HD/i.test(profile) ? 'dts-hd' : 'dts';
  } else if (codec.startsWith('pcm') || codec === 'lpcm') {
    base = 'pcm';
  } else {
    base = CODEC_FORMATS[codec] ?? 'other';
  }

  const formats: AudioFormat[] = [base];
  // Only TrueHD and E-AC3 carry Atmos; an AC3 track titled "... Atmos core" is plain 5.1.
  if (/atmos/i.test(described) && (base === 'truehd' || base === 'eac3')) formats.push('atmos');
  if (/dts[\s:-]?x\b/i.test(described) && base.startsWith('dts')) formats.push('dtsx');
  return formats;
}

export function toAudioTrack(stream: JfMediaStream): AudioTrack {
  return {
    language: canonicalLanguage(stream.Language),
    formats: audioFormats(stream),
    codec: stream.Codec ?? null,
    profile: stream.Profile ?? null,
    channels: stream.Channels ?? null,
    channelLayout: stream.ChannelLayout ?? null,
    title: stream.Title ?? null,
    isDefault: stream.IsDefault ?? false,
  };
}

export function resolutionOf(width: number | undefined, height: number | undefined): Resolution | null {
  const w = width ?? 0;
  const h = height ?? 0;
  if (!w && !h) return null;
  // Width first, so cropped widescreen (3840×1600) still counts as 4K.
  if (w >= 3200 || h >= 2000) return '4K';
  if (w >= 1800 || h >= 1000) return '1080p';
  if (w >= 1200 || h >= 700) return '720p';
  return 'SD';
}

/** Dolby Vision profile 7: UHD Blu-ray style, with an enhancement layer that many players cannot handle. */
export function isDolbyVisionProfile7(version: Pick<MediaVersion, 'videoRangeType' | 'dvProfile'>): boolean {
  return version.dvProfile === 7 || (version.videoRangeType ?? '').startsWith('DOVIWithEL');
}

export function dynamicRangeOf(stream: Pick<JfMediaStream, 'VideoRange' | 'VideoRangeType'>): DynamicRange | null {
  const type = stream.VideoRangeType ?? '';
  if (type.startsWith('DOVI')) return 'DV';
  if (type === 'HDR10Plus') return 'HDR10+';
  if (type === 'HDR10') return 'HDR10';
  if (type === 'HLG') return 'HLG';
  if (type === 'SDR') return 'SDR';
  if (stream.VideoRange === 'HDR') return 'HDR10';
  if (stream.VideoRange === 'SDR') return 'SDR';
  return null;
}

const VIDEO_CODECS: Record<string, VideoCodec> = {
  hevc: 'hevc',
  h265: 'hevc',
  h264: 'h264',
  avc: 'h264',
  av1: 'av1',
  vp9: 'vp9',
  mpeg4: 'mpeg4',
  msmpeg4v3: 'mpeg4',
  msmpeg4v2: 'mpeg4',
  xvid: 'mpeg4',
  divx: 'mpeg4',
  mpeg2video: 'mpeg2',
  mpeg2: 'mpeg2',
  vc1: 'vc1',
  wmv3: 'vc1',
};

/** The codec family of a video stream, e.g. "hevc" for Jellyfin's "hevc" or "h265". */
export function videoCodecFamily(codec: string | null | undefined): VideoCodec | null {
  if (!codec) return null;
  return VIDEO_CODECS[codec.toLowerCase()] ?? 'other';
}

/** All versions (files) of an item; falls back to the item's own streams. */
export function toVersions(item: JfBaseItem): MediaVersion[] {
  const sources = item.MediaSources?.length
    ? item.MediaSources
    : item.MediaStreams?.length
      ? [{ Name: undefined, Container: item.Container, MediaStreams: item.MediaStreams }]
      : [];

  return sources.map((source) => {
    const streams = source.MediaStreams ?? [];
    const video = streams.find((stream) => stream.Type === 'Video');
    return {
      // A single version is just the file; its name would only repeat the title.
      id: source.Id ?? null,
      name: sources.length > 1 ? (source.Name ?? null) : null,
      container: source.Container ?? null,
      resolution: video ? resolutionOf(video.Width, video.Height) : null,
      dynamicRange: video ? dynamicRangeOf(video) : null,
      videoRangeType: video?.VideoRangeType ?? null,
      dvProfile: video?.DvProfile ?? null,
      videoCodec: video?.Codec ?? null,
      audio: streams.filter((stream) => stream.Type === 'Audio').map(toAudioTrack),
    };
  });
}
