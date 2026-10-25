import type { AudioTrack, DynamicRange, ImageRef, MediaFacets, MediaType, MediaVersion, Resolution, VideoCodec } from '@manelly/shared';
import type { JellyfinClient } from '../jellyfin/client.js';
import type { JfBaseItem } from '../jellyfin/types.js';
import { toVersions, videoCodecFamily } from './streams.js';

export interface IndexedEpisode {
  id: string;
  name: string;
  season: number | null;
  episode: number | null;
  versions: MediaVersion[];
  /** Audio tracks of all versions, flattened for filtering. */
  tracks: AudioTrack[];
}

export interface IndexedItem {
  id: string;
  type: MediaType;
  name: string;
  sortName: string;
  originalTitle: string | null;
  overview: string | null;
  /** Lower-case, accent-free name and original title for the text search. */
  searchText: string;
  year: number | null;
  endYear: number | null;
  communityRating: number | null;
  officialRating: string | null;
  genres: string[];
  dateCreated: number;
  libraryIds: string[];
  poster: ImageRef | null;
  backdrop: ImageRef | null;
  /** Movies: their files. Series: empty, see `episodes`. */
  versions: MediaVersion[];
  episodes: IndexedEpisode[];
  /** All audio tracks of the item (series: of all episodes). */
  tracks: AudioTrack[];
  resolutions: Resolution[];
  dynamicRanges: DynamicRange[];
  videoCodecs: VideoCodec[];
}

export interface MediaIndex {
  builtAt: number;
  items: IndexedItem[];
  byId: Map<string, IndexedItem>;
  facets: MediaFacets;
  counts: { movies: number; series: number; episodes: number };
}

export type ProgressListener = (loaded: number, total: number) => void;

const PAGE_SIZE = 250;

// Library types that can contain movies or series; others (music, books, ...) are skipped.
const VIDEO_LIBRARIES: Record<string, string[]> = {
  movies: ['Movie'],
  tvshows: ['Series', 'Episode'],
  mixed: ['Movie', 'Series', 'Episode'],
};

const FIELDS: Record<string, string> = {
  Movie: 'SortName,OriginalTitle,Overview,Genres,OfficialRating,DateCreated,MediaSources',
  Series: 'SortName,OriginalTitle,Overview,Genres,OfficialRating,DateCreated',
  Episode: 'MediaSources',
};

interface Job {
  libraryId: string;
  type: string;
  total: number;
}

export async function buildMediaIndex(client: JellyfinClient, onProgress: ProgressListener = () => {}): Promise<MediaIndex> {
  const libraries = (await client.getLibraries()).flatMap((library) => {
    const types = VIDEO_LIBRARIES[library.CollectionType ?? 'mixed'];
    return library.ItemId && types ? [{ id: library.ItemId, name: library.Name ?? 'Bibliothek', types }] : [];
  });

  // Count first, so the progress bar knows the total from the start. (limit=1, because
  // some Jellyfin versions treat limit=0 as "no limit".)
  const jobs: Job[] = [];
  for (const library of libraries) {
    for (const type of library.types) {
      const result = await client.getItems(itemsQuery(library.id, type, 0, 1));
      if (result.TotalRecordCount) jobs.push({ libraryId: library.id, type, total: result.TotalRecordCount });
    }
  }
  const total = jobs.reduce((sum, job) => sum + job.total, 0);
  let loaded = 0;
  onProgress(loaded, total);

  const items = new Map<string, IndexedItem>();
  const episodes: Array<{ seriesId: string; episode: IndexedEpisode }> = [];

  for (const job of jobs) {
    for (let start = 0; start < job.total; start += PAGE_SIZE) {
      const page = (await client.getItems(itemsQuery(job.libraryId, job.type, start, PAGE_SIZE))).Items ?? [];
      for (const raw of page) {
        if (!raw.Id) continue;
        if (job.type === 'Episode') {
          if (raw.SeriesId) episodes.push({ seriesId: raw.SeriesId, episode: toEpisode(raw) });
        } else {
          const existing = items.get(raw.Id);
          if (existing) existing.libraryIds.push(job.libraryId);
          else items.set(raw.Id, toItem(raw, job.type as MediaType, job.libraryId));
        }
      }
      loaded += page.length;
      onProgress(loaded, total);
      if (page.length === 0) break;
    }
  }

  // A series in two libraries would otherwise get its episodes twice.
  const seenEpisodes = new Set<string>();
  for (const { seriesId, episode } of episodes) {
    const series = items.get(seriesId);
    if (series?.type === 'Series' && !seenEpisodes.has(episode.id)) {
      seenEpisodes.add(episode.id);
      series.episodes.push(episode);
    }
  }

  const list = [...items.values()];
  for (const item of list) finalize(item);

  return {
    builtAt: Date.now(),
    items: list,
    byId: items,
    facets: buildFacets(list, libraries),
    counts: {
      movies: list.filter((item) => item.type === 'Movie').length,
      series: list.filter((item) => item.type === 'Series').length,
      episodes: list.reduce((sum, item) => sum + item.episodes.length, 0),
    },
  };
}

function itemsQuery(libraryId: string, type: string, startIndex: number, limit: number): URLSearchParams {
  return new URLSearchParams({
    parentId: libraryId,
    includeItemTypes: type,
    recursive: 'true',
    // Episodes Jellyfin only knows from metadata have no files to inspect.
    isMissing: 'false',
    fields: FIELDS[type] ?? '',
    enableImageTypes: 'Primary,Backdrop',
    imageTypeLimit: '1',
    enableUserData: 'false',
    enableTotalRecordCount: 'true',
    sortBy: 'SortName',
    startIndex: String(startIndex),
    limit: String(limit),
  });
}

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function toItem(raw: JfBaseItem, type: MediaType, libraryId: string): IndexedItem {
  const id = raw.Id!;
  const name = raw.Name ?? 'Unbekannter Titel';
  const posterTag = raw.ImageTags?.Primary;
  const backdropTag = raw.BackdropImageTags?.[0];
  return {
    id,
    type,
    name,
    sortName: raw.SortName ?? name,
    originalTitle: raw.OriginalTitle && raw.OriginalTitle !== name ? raw.OriginalTitle : null,
    overview: raw.Overview ?? null,
    searchText: normalizeText(`${name} ${raw.OriginalTitle ?? ''}`),
    year: raw.ProductionYear ?? null,
    endYear: raw.EndDate ? new Date(raw.EndDate).getUTCFullYear() : null,
    communityRating: raw.CommunityRating ?? null,
    officialRating: raw.OfficialRating ?? null,
    genres: raw.Genres ?? [],
    dateCreated: raw.DateCreated ? Date.parse(raw.DateCreated) : 0,
    libraryIds: [libraryId],
    poster: posterTag ? { itemId: id, type: 'Primary', tag: posterTag, aspect: 'portrait' } : null,
    backdrop: backdropTag ? { itemId: id, type: 'Backdrop', tag: backdropTag, aspect: 'landscape' } : null,
    versions: type === 'Movie' ? toVersions(raw) : [],
    episodes: [],
    tracks: [],
    resolutions: [],
    dynamicRanges: [],
    videoCodecs: [],
  };
}

function toEpisode(raw: JfBaseItem): IndexedEpisode {
  const versions = toVersions(raw);
  return {
    id: raw.Id!,
    name: raw.Name ?? 'Unbekannte Folge',
    season: raw.ParentIndexNumber ?? null,
    episode: raw.IndexNumber ?? null,
    versions,
    tracks: versions.flatMap((version) => version.audio),
  };
}

/** Derives the flattened tracks and video properties used by filters and badges. */
function finalize(item: IndexedItem) {
  const versions = item.type === 'Movie' ? item.versions : item.episodes.flatMap((episode) => episode.versions);
  item.episodes.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
  item.tracks = versions.flatMap((version) => version.audio);
  item.resolutions = unique(versions.map((version) => version.resolution));
  item.dynamicRanges = unique(versions.map((version) => version.dynamicRange));
  item.videoCodecs = unique(versions.map((version) => videoCodecFamily(version.videoCodec)));
}

function unique<T>(values: Array<T | null>): T[] {
  return [...new Set(values.filter((value): value is T => value !== null))];
}

function buildFacets(items: IndexedItem[], libraries: Array<{ id: string; name: string }>): MediaFacets {
  const counter = () => new Map<string, number>();
  const genres = counter();
  const ratings = counter();
  const languages = counter();
  const formats = counter();
  const resolutions = counter();
  const ranges = counter();
  const codecs = counter();
  const libraryCounts = counter();
  let minYear: number | null = null;
  let maxYear: number | null = null;

  // Each item counts once per value, however many tracks or episodes carry it.
  const add = (map: Map<string, number>, values: Iterable<string>) => {
    for (const value of new Set(values)) map.set(value, (map.get(value) ?? 0) + 1);
  };

  for (const item of items) {
    add(genres, item.genres);
    if (item.officialRating) add(ratings, [item.officialRating]);
    add(languages, item.tracks.map((track) => track.language ?? 'und'));
    add(formats, item.tracks.flatMap((track) => track.formats));
    add(resolutions, item.resolutions);
    add(ranges, item.dynamicRanges);
    add(codecs, item.videoCodecs);
    add(libraryCounts, item.libraryIds);
    if (item.year !== null) {
      minYear = minYear === null ? item.year : Math.min(minYear, item.year);
      maxYear = maxYear === null ? item.year : Math.max(maxYear, item.year);
    }
  }

  const sorted = (map: Map<string, number>) =>
    [...map].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'de'));

  return {
    genres: sorted(genres),
    officialRatings: sorted(ratings),
    years: { min: minYear, max: maxYear },
    audioLanguages: sorted(languages),
    audioFormats: sorted(formats),
    resolutions: sorted(resolutions),
    dynamicRanges: sorted(ranges),
    videoCodecs: sorted(codecs),
    libraries: libraries
      .map((library) => ({ value: library.id, name: library.name, count: libraryCounts.get(library.id) ?? 0 }))
      .filter((library) => library.count > 0),
  };
}
