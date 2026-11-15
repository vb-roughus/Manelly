import { channelLayoutLabel, languageLabel } from './format';

/** A track to pick, whether MakeMKV listed it on a disc or mkvmerge in a file. */
export interface PickTrack {
  language: string | null;
  /** As the source names it, for languages Intl does not know. */
  languageName?: string | null;
  codec: string | null;
  /** "5.1(side)", "stereo" – or a number of channels. */
  channels: string | number | null;
  /** Suggested to keep. */
  keep?: boolean;
  /** Forced subtitles: only the foreign parts. */
  forced?: boolean;
  name?: string | null;
}

/** 6 → "5.1", 8 → "7.1", 2 → "Stereo", 1 → "Mono"; a layout as it comes, without «(side)». */
export function channelsText(channels: string | number | null): string | null {
  if (channels === null) return null;
  if (typeof channels === 'string') return channelLayoutLabel(channels);
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels >= 3 && channels <= 8) return `${channels - 1}.1`;
  return `${channels} Kanäle`;
}

/** "Deutsch", "Englisch"; the source's own name or the code when Intl does not know it. */
export function trackLanguage(track: Pick<PickTrack, 'language' | 'languageName'>): string {
  return languageLabel(track.language) ?? track.languageName ?? track.language ?? 'ohne Sprache';
}

/** "DTS-HD MA 5.1", "AC-3 Stereo". */
export function trackFormat(track: Pick<PickTrack, 'codec' | 'channels'>): string {
  return [track.codec, channelsText(track.channels)].filter(Boolean).join(' ');
}

/**
 * Titles or files with the same tracks – same languages, formats and channels in the same order – share one choice:
 * the episodes of a series disc, the files of a season.
 */
export function layoutOf(audio: PickTrack[], subtitles: PickTrack[]): string {
  const part = (track: PickTrack) => [track.language ?? '', track.codec ?? '', track.channels ?? '', track.forced ? 'f' : ''].join(':');
  return `${audio.map(part).join(',')}|${subtitles.map(part).join(',')}`;
}

/** The suggested choice: the positions of the tracks marked to keep. */
export const suggested = (tracks: PickTrack[]) => new Set(tracks.flatMap((track, index) => (track.keep ? [index] : [])));
