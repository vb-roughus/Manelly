import type { AudioFormat, DynamicRange, MediaSearchParams, MediaSort, MediaType, Resolution } from '@manelly/shared';
import { languageLabel } from './format';

export const AUDIO_FORMAT_LABELS: Record<AudioFormat, string> = {
  atmos: 'Dolby Atmos',
  dtsx: 'DTS:X',
  truehd: 'Dolby TrueHD',
  'dts-hd-ma': 'DTS-HD MA',
  'dts-hd': 'DTS-HD',
  eac3: 'Dolby Digital Plus',
  ac3: 'Dolby Digital',
  dts: 'DTS',
  flac: 'FLAC',
  pcm: 'PCM',
  aac: 'AAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  mp3: 'MP3',
  other: 'Andere',
};

/** Short names for badges. */
export const AUDIO_FORMAT_SHORT: Record<AudioFormat, string> = {
  ...AUDIO_FORMAT_LABELS,
  atmos: 'Atmos',
  truehd: 'TrueHD',
  eac3: 'DD+',
  ac3: 'DD',
};

export const AUDIO_FORMAT_ORDER = Object.keys(AUDIO_FORMAT_LABELS) as AudioFormat[];

export const DYNAMIC_RANGE_LABELS: Record<DynamicRange, string> = {
  DV: 'Dolby Vision',
  'HDR10+': 'HDR10+',
  HDR10: 'HDR10',
  HLG: 'HLG',
  SDR: 'SDR',
};

export const RESOLUTION_ORDER: Resolution[] = ['4K', '1080p', '720p', 'SD'];

/** "de" → "Deutsch"; "und" or null → "Unbekannt". */
export function audioLanguageName(code: string | null): string {
  return (code && code !== 'und' && languageLabel(code)) || 'Unbekannt';
}

export function languageShort(code: string | null): string {
  return code && code !== 'und' ? code.toUpperCase() : '?';
}

export const SORT_OPTIONS: Array<{ label: string; sort: MediaSort; order: 'asc' | 'desc' }> = [
  { label: 'Titel A–Z', sort: 'name', order: 'asc' },
  { label: 'Titel Z–A', sort: 'name', order: 'desc' },
  { label: 'Neueste zuerst', sort: 'year', order: 'desc' },
  { label: 'Älteste zuerst', sort: 'year', order: 'asc' },
  { label: 'Beste Bewertung', sort: 'rating', order: 'desc' },
  { label: 'Zuletzt hinzugefügt', sort: 'added', order: 'desc' },
];

const LIST_KEYS = ['genre', 'officialRating', 'resolution', 'dynamicRange', 'library', 'audioLanguage', 'audioFormat'] as const;
const NUMBER_KEYS = ['yearFrom', 'yearTo', 'minRating', 'audioMinChannels'] as const;

export type MediaFilters = Omit<MediaSearchParams, 'offset' | 'limit'>;

/** Reads the filters from the page URL; unknown or malformed values are dropped. */
export function readFilters(search: URLSearchParams): MediaFilters {
  const filters: MediaFilters = {};
  const q = search.get('q')?.trim();
  if (q) filters.q = q;
  const type = search.get('type');
  if (type === 'Movie' || type === 'Series') filters.type = type as MediaType;
  for (const key of LIST_KEYS) {
    const values = search.getAll(key).filter(Boolean);
    if (values.length) (filters as Record<string, unknown>)[key] = values;
  }
  for (const key of NUMBER_KEYS) {
    const raw = search.get(key);
    const value = raw === null || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(value)) filters[key] = value;
  }
  const mode = search.get('audioMode');
  if (mode === 'lacks') filters.audioMode = mode;
  const coverage = search.get('audioCoverage');
  if (coverage === 'all') filters.audioCoverage = coverage;
  const sort = search.get('sort');
  if (sort && SORT_OPTIONS.some((option) => option.sort === sort)) filters.sort = sort as MediaSort;
  const order = search.get('order');
  if (order === 'asc' || order === 'desc') filters.order = order;
  return filters;
}

/** Serializes filters (and paging) into query parameters; empty values are left out. */
export function toSearchParams(params: MediaSearchParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((entry) => search.append(key, String(entry)));
    else search.set(key, String(value));
  }
  return search;
}

export function hasAudioCondition(filters: MediaFilters): boolean {
  return Boolean(filters.audioLanguage?.length || filters.audioFormat?.length || filters.audioMinChannels);
}

/** Number of active filters (search text, type and sorting aside), for the mobile filter button. */
export function activeFilterCount(filters: MediaFilters): number {
  return [...LIST_KEYS, ...NUMBER_KEYS].filter((key) => {
    const value = filters[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  }).length;
}
