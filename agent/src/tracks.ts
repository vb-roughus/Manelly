import type { DiscStream, DiscTitle } from '@manelly/shared';

/**
 * Which audio and subtitle tracks to keep: a suggestion (the first track's language and German, each in its best
 * sound), and finding the tracks of a disc again in the file MakeMKV wrote from it.
 */

/** What tells tracks apart here: as MakeMKV lists a disc's streams, or as mkvmerge describes a file's tracks. */
export interface TrackLike {
  type: string;
  language: string | null;
  /** "DTS-HD MA", "TrueHD Atmos", "AC-3", "PGS" … */
  codec: string | null;
  /** Matroska's codec id, e.g. "A_DTS", "S_HDMV/PGS". */
  codecId: string | null;
  /** Audio channels, e.g. 6 for 5.1. */
  channels: number | null;
}

/** ISO 639-2/T codes that differ from the /B codes Matroska uses. */
const T_TO_B: Record<string, string> = {
  deu: 'ger',
  fra: 'fre',
  nld: 'dut',
  ces: 'cze',
  zho: 'chi',
  ell: 'gre',
  fas: 'per',
  hye: 'arm',
  isl: 'ice',
  kat: 'geo',
  mkd: 'mac',
  msa: 'may',
  mya: 'bur',
  ron: 'rum',
  slk: 'slo',
  sqi: 'alb',
  bod: 'tib',
  cym: 'wel',
  eus: 'baq',
  mri: 'mao',
};
/** Two-letter codes of the languages that come up on discs. */
const TWO_LETTERS: Record<string, string> = { de: 'ger', en: 'eng', fr: 'fre', it: 'ita', es: 'spa', nl: 'dut', ja: 'jpn', pt: 'por', ru: 'rus', pl: 'pol', cs: 'cze', tr: 'tur', zh: 'chi' };

/** "deu", "ger", "de", "de-CH" → "ger"; null for none or "und". */
export function languageKey(code: string | null | undefined): string | null {
  const plain = code?.trim().toLowerCase().split(/[-_]/)[0];
  if (!plain || plain === 'und' || plain === 'mul' || plain === 'zxx') return null;
  return T_TO_B[plain] ?? TWO_LETTERS[plain] ?? (plain === 'gsw' ? 'ger' : plain);
}

/** The kind of sound or subtitles, the same whether MakeMKV or mkvmerge names it. */
export function familyOf(track: Pick<TrackLike, 'codec' | 'codecId'>): string | null {
  const text = `${track.codec ?? ''} ${track.codecId ?? ''}`.toLowerCase();
  if (/truehd|mlp|atmos/.test(text)) return 'truehd';
  if (/dts-?hd ?ma|master audio|dts:x|dts-x/.test(text)) return 'dts-ma';
  if (/dts-?hd ?hr|high res/.test(text)) return 'dts-hr';
  if (/dts/.test(text)) return 'dts';
  if (/e-?ac-?3|dd\+|eac3|plus/.test(text)) return 'eac3';
  if (/ac-?3|\bdd\b|dolby digital/.test(text)) return 'ac3';
  // MakeMKV may write a disc's LPCM as FLAC: the same sound.
  if (/pcm|flac/.test(text)) return 'pcm';
  if (/aac/.test(text)) return 'aac';
  if (/opus|vorbis/.test(text)) return 'opus';
  if (/mpeg|mp2|mp3|\bmpa\b/.test(text)) return 'mpeg';
  if (/pgs|hdmv/.test(text)) return 'pgs';
  if (/vobsub/.test(text)) return 'vobsub';
  if (/srt|utf-?8|text|ass|ssa/.test(text)) return 'text';
  return null;
}

const LOSSLESS = new Set(['truehd', 'dts-ma', 'pcm']);
/** Within lossless and lossy alike, the richer format wins a tie in channels. */
const RANK: Record<string, number> = { truehd: 9, 'dts-ma': 9, pcm: 8, 'dts-hr': 7, dts: 6, eac3: 5, ac3: 4, aac: 3, opus: 3, mpeg: 1 };

/**
 * How good a sound is: lossless before lossy, then more channels, then the format – DTS 5.1 before Dolby Digital 5.1,
 * Dolby Digital 5.1 before stereo, TrueHD 7.1 before DTS-HD MA 5.1.
 */
export function soundQuality(track: Pick<TrackLike, 'codec' | 'codecId' | 'channels'>): number {
  const family = familyOf(track);
  return (family && LOSSLESS.has(family) ? 1000 : 0) + (track.channels ?? 2) * 10 + (family ? (RANK[family] ?? 0) : 0);
}

/**
 * The tracks to keep, by their position in `tracks`: of the audio the best track in the language of the first one and
 * the best in `preferred` (a first track without a language stays as it is); of the subtitles the first and all in
 * `preferred`. Video and everything else always stays.
 */
export function suggestKeep(tracks: TrackLike[], preferred = 'ger'): Set<number> {
  const keep = new Set<number>();
  const audio = tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.type === 'audio');
  const subtitles = tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.type === 'subtitles');
  tracks.forEach((track, index) => {
    if (track.type !== 'audio' && track.type !== 'subtitles') keep.add(index);
  });
  const wanted = languageKey(preferred);
  const first = audio[0];
  if (first) {
    const firstLanguage = languageKey(first.track.language);
    if (firstLanguage === null) keep.add(first.index);
    for (const language of new Set([firstLanguage, wanted])) {
      if (language === null) continue;
      // The best of that language; of two as good, the earlier – usually the film's own track, not a commentary.
      const best = audio
        .filter(({ track }) => languageKey(track.language) === language)
        .reduce<(typeof audio)[number] | null>((winner, candidate) => (!winner || soundQuality(candidate.track) > soundQuality(winner.track) ? candidate : winner), null);
      if (best) keep.add(best.index);
    }
  }
  if (subtitles[0]) keep.add(subtitles[0].index);
  for (const { track, index } of subtitles) if (wanted !== null && languageKey(track.language) === wanted) keep.add(index);
  return keep;
}

/** What a track is told apart by when found again: its kind, its language and (sound) its channels. */
const groupOf = (track: TrackLike) => `${track.type}|${languageKey(track.language) ?? '-'}|${track.type === 'audio' ? (track.channels ?? '?') : ''}`;

/**
 * The ids of the file's tracks that the chosen disc streams became, plus every track that matches none of the streams
 * (kept, to lose nothing that cannot be told apart). MakeMKV writes the streams it took perhaps in another order (by
 * language), so a track is matched within its kind, language and channels – of the same format if there is one – in
 * the disc's order. `fileTracks` carry their ids; `streams` and `chosen` (positions in `streams`) are of one type each.
 */
export function matchStreams<T extends TrackLike & { id: number }>(fileTracks: T[], streams: TrackLike[], chosen: ReadonlySet<number>): { keep: number[]; unmatched: number } {
  const used = new Set<number>();
  const keep: number[] = [];
  let unmatched = 0;
  for (const track of fileTracks) {
    const group = groupOf(track);
    const family = familyOf(track);
    const candidates = streams.map((stream, index) => ({ stream, index })).filter(({ stream, index }) => !used.has(index) && groupOf(stream) === group);
    const sameFormat = candidates.find(({ stream }) => {
      const other = familyOf(stream);
      return family === null || other === null || other === family;
    });
    const match = sameFormat ?? candidates[0];
    if (!match) {
      unmatched++;
      keep.push(track.id);
      continue;
    }
    used.add(match.index);
    if (chosen.has(match.index)) keep.push(track.id);
  }
  return { keep, unmatched };
}

/** A disc stream as MakeMKV listed it, for comparing with tracks. */
export const streamTrack = (type: 'audio' | 'subtitles', stream: DiscStream): TrackLike => ({
  type,
  language: stream.language,
  codec: stream.codec,
  codecId: stream.codecId ?? null,
  channels: stream.channelCount ?? null,
});

/** The streams of a disc title to keep, by their positions in its `audio` and `subtitles`. */
export interface StreamKeep {
  audio: { streams: DiscStream[]; chosen: number[] };
  subtitles: { streams: DiscStream[]; chosen: number[] };
}

/** The ids of the audio and subtitle tracks of the ripped file that the chosen streams became (see matchStreams). */
export function keepFromStreams<T extends TrackLike & { id: number }>(fileTracks: T[], keep: StreamKeep): number[] {
  const of = (type: 'audio' | 'subtitles') =>
    matchStreams(
      fileTracks.filter((track) => track.type === type),
      keep[type].streams.map((stream) => streamTrack(type, stream)),
      new Set(keep[type].chosen),
    ).keep;
  return [...of('audio'), ...of('subtitles')];
}

/** Marks the streams of each title suggested to keep (see suggestKeep). */
export function markSuggested(titles: DiscTitle[], preferred: string): void {
  for (const title of titles) {
    const tracks = [...title.audio.map((stream) => streamTrack('audio', stream)), ...title.subtitles.map((stream) => streamTrack('subtitles', stream))];
    const keep = suggestKeep(tracks, preferred);
    title.audio.forEach((stream, index) => (stream.keep = keep.has(index)));
    title.subtitles.forEach((stream, index) => (stream.keep = keep.has(title.audio.length + index)));
  }
}
