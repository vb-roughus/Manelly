import type { AudioStreamInfo, NowPlayingItem, VideoStreamInfo } from '@manelly/shared';

const LOCALE = 'de-CH';

/** 754 000 ms → "12:34", 4 520 000 ms → "1:15:20". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

const number = (value: number, digits: number) =>
  value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Bits per second → "8.2 Mbit/s". */
export function formatBitrate(bps: number): string {
  if (bps >= 1_000_000_000) return `${number(bps / 1_000_000_000, 2)} Gbit/s`;
  if (bps >= 1_000_000) return `${number(bps / 1_000_000, bps >= 100_000_000 ? 0 : 1)} Mbit/s`;
  if (bps >= 1_000) return `${number(bps / 1_000, 0)} kbit/s`;
  return `${number(bps, 0)} bit/s`;
}

/** 52 000 000 000 → "48.4 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${number(bytes / 1024 ** 4, 2)} TB`;
  if (bytes >= 1024 ** 3) return `${number(bytes / 1024 ** 3, 1)} GB`;
  if (bytes >= 1024 ** 2) return `${number(bytes / 1024 ** 2, 0)} MB`;
  return `${number(bytes / 1024, 0)} KB`;
}

/** "vor 4 s", "vor 3 min" – for timestamps in the recent past. */
export function formatAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return 'gerade eben';
  if (seconds < 60) return `vor ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} min`;
  return `vor ${Math.round(minutes / 60)} h`;
}

export function resolutionLabel(width: number | null, height: number | null): string | null {
  if (!width && !height) return null;
  // Compare by width too, so cinemascope 1920×800 still counts as 1080p.
  const w = width ?? 0;
  const h = height ?? 0;
  if (w >= 3800 || h >= 2100) return '4K';
  if (w >= 2500 || h >= 1400) return '1440p';
  if (w >= 1900 || h >= 1000) return '1080p';
  if (w >= 1260 || h >= 700) return '720p';
  if (h >= 560) return '576p';
  return h ? `${h}p` : 'SD';
}

const CODEC_LABELS: Record<string, string> = {
  h264: 'H.264',
  avc: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  vc1: 'VC-1',
  aac: 'AAC',
  ac3: 'AC3',
  eac3: 'E-AC3',
  truehd: 'TrueHD',
  dts: 'DTS',
  flac: 'FLAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  alac: 'ALAC',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  pgssub: 'PGS',
  dvdsub: 'VobSub',
  dvbsub: 'DVB',
  subrip: 'SRT',
  srt: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  mov_text: 'MP4-Text',
};

export function codecLabel(codec: string | null): string | null {
  if (!codec) return null;
  return CODEC_LABELS[codec.toLowerCase()] ?? codec.toUpperCase();
}

export function channelsLabel(channels: number | null): string | null {
  switch (channels) {
    case null:
      return null;
    case 1:
      return 'Mono';
    case 2:
      return 'Stereo';
    case 6:
      return '5.1';
    case 8:
      return '7.1';
    default:
      return `${channels} Kanäle`;
  }
}

// Jellyfin stores ISO 639-2/B codes (ger, fre, ...), Intl expects BCP 47 codes.
const BIBLIOGRAPHIC_TO_BCP47: Record<string, string> = {
  ger: 'de', fre: 'fr', dut: 'nl', chi: 'zh', cze: 'cs', gre: 'el', per: 'fa', rum: 'ro', slo: 'sk',
  alb: 'sq', arm: 'hy', baq: 'eu', bur: 'my', geo: 'ka', ice: 'is', mac: 'mk', mao: 'mi', may: 'ms',
  tib: 'bo', wel: 'cy',
};

const languageNames = new Intl.DisplayNames(['de'], { type: 'language', fallback: 'none' });

export function languageLabel(code: string | null): string | null {
  if (!code || code === 'und') return null;
  const normalized = BIBLIOGRAPHIC_TO_BCP47[code.toLowerCase()] ?? code;
  try {
    return languageNames.of(normalized) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function joinParts(parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(' · ');
}

const RANGE_TYPE_LABELS: Record<string, string> = {
  SDR: 'SDR',
  HDR10: 'HDR10',
  HDR10Plus: 'HDR10+',
  HLG: 'HLG',
  DOVI: 'Dolby Vision ohne Rückfallebene',
  DOVIWithHDR10: 'Dolby Vision mit HDR10-Basis',
  DOVIWithHLG: 'Dolby Vision mit HLG-Basis',
  DOVIWithSDR: 'Dolby Vision mit SDR-Basis',
  DOVIWithEL: 'Dolby Vision mit Enhancement Layer',
  DOVIWithHDR10Plus: 'Dolby Vision mit HDR10+',
  DOVIWithELHDR10Plus: 'Dolby Vision mit Enhancement Layer und HDR10+',
  DOVIInvalid: 'Dolby Vision, fehlerhaft konfiguriert',
};

/**
 * HDR format of a video. Short: "Dolby Vision P7", "HDR10+" for compact lines;
 * long: "Dolby Vision Profil 7 mit Enhancement Layer" for explanations.
 */
export function videoRangeLabel(video: VideoStreamInfo, form: 'short' | 'long'): string | null {
  const type = video.videoRangeType;
  if (!type || type === 'Unknown') return null;
  if (!type.startsWith('DOVI')) return RANGE_TYPE_LABELS[type] ?? type;
  if (form === 'short') return video.dvProfile ? `Dolby Vision P${video.dvProfile}` : 'Dolby Vision';
  const label = RANGE_TYPE_LABELS[type] ?? 'Dolby Vision';
  return video.dvProfile ? label.replace('Dolby Vision', `Dolby Vision Profil ${video.dvProfile}`) : label;
}

export function describeVideo(video: VideoStreamInfo): string {
  const range = video.videoRangeType !== 'SDR' ? videoRangeLabel(video, 'short') : null;
  return joinParts([resolutionLabel(video.width, video.height), codecLabel(video.codec), range]);
}

export function describeAudio(audio: AudioStreamInfo): string {
  return joinParts([languageLabel(audio.language), codecLabel(audio.codec), channelsLabel(audio.channels)]);
}

/** Headline and secondary line for a playing item, e.g. series name + "S02E05 · Episode". */
export function itemHeadline(item: NowPlayingItem): { title: string; subtitle: string | null } {
  switch (item.type) {
    case 'Episode': {
      const code =
        item.seasonNumber !== null && item.episodeNumber !== null
          ? `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
          : null;
      return item.seriesName
        ? { title: item.seriesName, subtitle: joinParts([code, item.name]) }
        : { title: item.name, subtitle: code };
    }
    case 'Audio':
      return { title: item.name, subtitle: joinParts([item.artists.join(', '), item.album]) || null };
    case 'TvChannel':
      return { title: item.name, subtitle: 'Live-TV' };
    default:
      return { title: item.name, subtitle: item.productionYear ? String(item.productionYear) : null };
  }
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}
