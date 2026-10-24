import type {
  AudioBadge,
  AudioFormat,
  AudioTrack,
  MediaDetail,
  MediaVersion,
  MediaSearchParams,
  MediaSummary,
  SeasonDetail,
} from '@manelly/shared';
import { normalizeText, type IndexedItem, type MediaIndex } from './indexer.js';

interface AudioFilter {
  languages: string[];
  formats: AudioFormat[];
  minChannels: number | null;
  mode: 'has' | 'lacks';
  coverage: 'any' | 'all';
}

/** Null when no track condition is set; mode and coverage alone filter nothing. */
export function audioFilterOf(params: MediaSearchParams): AudioFilter | null {
  const languages = params.audioLanguage ?? [];
  const formats = params.audioFormat ?? [];
  const minChannels = params.audioMinChannels ?? null;
  if (languages.length === 0 && formats.length === 0 && minChannels === null) return null;
  return { languages, formats, minChannels, mode: params.audioMode ?? 'has', coverage: params.audioCoverage ?? 'any' };
}

/** All conditions must hold for the same track: "German and Atmos", not "German, and Atmos in English". */
export function trackMatches(track: AudioTrack, filter: AudioFilter): boolean {
  return (
    (filter.languages.length === 0 || filter.languages.includes(track.language ?? 'und')) &&
    (filter.formats.length === 0 || track.formats.some((format) => filter.formats.includes(format))) &&
    (filter.minChannels === null || (track.channels ?? 0) >= filter.minChannels)
  );
}

/** How many of the item's units (a movie: 1, a series: its episodes) have a matching track. */
export function audioCoverage(item: IndexedItem, filter: AudioFilter): { matching: number; total: number } {
  if (item.type === 'Movie') {
    return { matching: item.tracks.some((track) => trackMatches(track, filter)) ? 1 : 0, total: 1 };
  }
  const matching = item.episodes.filter((episode) => episode.tracks.some((track) => trackMatches(track, filter))).length;
  return { matching, total: item.episodes.length };
}

function passesAudio(item: IndexedItem, filter: AudioFilter): boolean {
  const { matching, total } = audioCoverage(item, filter);
  if (total === 0) return false;
  if (filter.mode === 'has') return filter.coverage === 'all' ? matching === total : matching > 0;
  return filter.coverage === 'all' ? matching === 0 : matching < total;
}

const anyOf = <T>(selected: T[] | undefined, values: T[]) =>
  !selected?.length || values.some((value) => selected.includes(value));

function passes(item: IndexedItem, params: MediaSearchParams, terms: string[], audio: AudioFilter | null): boolean {
  if (params.type && item.type !== params.type) return false;
  if (terms.length && !terms.every((term) => item.searchText.includes(term))) return false;
  if (!anyOf(params.genre, item.genres)) return false;
  if (!anyOf(params.officialRating, item.officialRating ? [item.officialRating] : [])) return false;
  if (!anyOf(params.library, item.libraryIds)) return false;
  if (!anyOf(params.resolution, item.resolutions)) return false;
  if (!anyOf(params.dynamicRange, item.dynamicRanges)) return false;
  if (params.yearFrom !== undefined && (item.year === null || item.year < params.yearFrom)) return false;
  if (params.yearTo !== undefined && (item.year === null || item.year > params.yearTo)) return false;
  if (params.minRating !== undefined && (item.communityRating ?? 0) < params.minRating) return false;
  if (audio && !passesAudio(item, audio)) return false;
  return true;
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

function compare(sort: MediaSearchParams['sort']): (a: IndexedItem, b: IndexedItem) => number {
  switch (sort) {
    case 'year':
      return (a, b) => (a.year ?? 0) - (b.year ?? 0);
    case 'rating':
      return (a, b) => (a.communityRating ?? 0) - (b.communityRating ?? 0);
    case 'added':
      return (a, b) => a.dateCreated - b.dateCreated;
    default:
      return (a, b) => collator.compare(a.sortName, b.sortName);
  }
}

export function searchMedia(index: MediaIndex, params: MediaSearchParams): { items: MediaSummary[]; total: number } {
  const terms = normalizeText(params.q ?? '').split(/\s+/).filter(Boolean);
  const audio = audioFilterOf(params);
  const matches = index.items.filter((item) => passes(item, params, terms, audio));

  const primary = compare(params.sort);
  const direction = params.order === 'desc' ? -1 : 1;
  matches.sort((a, b) => direction * primary(a, b) || collator.compare(a.sortName, b.sortName));

  const offset = params.offset ?? 0;
  const limit = params.limit ?? 60;
  return {
    items: matches.slice(offset, offset + limit).map((item) => toSummary(item, audio)),
    total: matches.length,
  };
}

// Higher ranks are shown first and name the track ("Atmos" rather than "TrueHD").
const FORMAT_RANK: AudioFormat[] = [
  'atmos',
  'dtsx',
  'truehd',
  'dts-hd-ma',
  'dts-hd',
  'eac3',
  'flac',
  'pcm',
  'dts',
  'ac3',
  'aac',
  'opus',
  'vorbis',
  'mp3',
  'other',
];

function mainFormat(track: AudioTrack): AudioFormat {
  return [...track.formats].sort((a, b) => FORMAT_RANK.indexOf(a) - FORMAT_RANK.indexOf(b))[0] ?? 'other';
}

/** Distinct language/format pairs of the tracks; matching ones first, then by format quality. */
export function audioBadges(tracks: AudioTrack[], filter: AudioFilter | null): AudioBadge[] {
  const badges = new Map<string, AudioBadge>();
  for (const track of tracks) {
    const format = mainFormat(track);
    const key = `${track.language ?? 'und'}|${format}`;
    const matches = filter ? trackMatches(track, filter) : false;
    const existing = badges.get(key);
    if (existing) {
      existing.channels = Math.max(existing.channels ?? 0, track.channels ?? 0) || null;
      existing.matches ||= matches;
    } else {
      badges.set(key, { language: track.language, format, channels: track.channels, matches });
    }
  }
  return [...badges.values()].sort(
    (a, b) =>
      Number(b.matches) - Number(a.matches) ||
      FORMAT_RANK.indexOf(a.format) - FORMAT_RANK.indexOf(b.format) ||
      (a.language ?? '~').localeCompare(b.language ?? '~'),
  );
}

export function toSummary(item: IndexedItem, audio: AudioFilter | null): MediaSummary {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    year: item.year,
    endYear: item.endYear,
    communityRating: item.communityRating,
    officialRating: item.officialRating,
    genres: item.genres,
    poster: item.poster,
    resolutions: item.resolutions,
    dynamicRanges: item.dynamicRanges,
    audio: audioBadges(item.tracks, audio),
    episodes:
      item.type === 'Series'
        ? { total: item.episodes.length, matching: audio ? audioCoverage(item, audio).matching : null }
        : null,
  };
}

export function mediaDetail(item: IndexedItem, params: MediaSearchParams): MediaDetail {
  const audio = audioFilterOf(params);
  const mark = (tracks: AudioTrack[]): AudioTrack[] =>
    audio ? tracks.map((track) => ({ ...track, matches: trackMatches(track, audio) })) : tracks;
  const markVersion = (version: MediaVersion): MediaVersion => ({ ...version, audio: mark(version.audio) });
  const seasons = new Map<number | null, SeasonDetail>();
  for (const episode of item.episodes) {
    let season = seasons.get(episode.season);
    if (!season) {
      season = { season: episode.season, episodes: [] };
      seasons.set(episode.season, season);
    }
    const first = episode.versions[0];
    season.episodes.push({
      id: episode.id,
      name: episode.name,
      episode: episode.episode,
      resolution: first?.resolution ?? null,
      dynamicRange: first?.dynamicRange ?? null,
      audio: mark(episode.tracks),
      matches: audio ? episode.tracks.some((track) => trackMatches(track, audio)) : null,
    });
  }

  return {
    summary: toSummary(item, audio),
    originalTitle: item.originalTitle,
    overview: item.overview,
    backdrop: item.backdrop,
    versions: item.versions.map(markVersion),
    seasons: [...seasons.values()],
  };
}
