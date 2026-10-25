import type { MediaSearchParams, TitleDiagnosis, TitleVerdict } from '@manelly/shared';
import type { JellyfinClient } from '../jellyfin/client.js';
import type { JfBaseItem, JfVirtualFolder } from '../jellyfin/types.js';
import { listLibraryIds, VIDEO_LIBRARIES, type MediaIndex } from './indexer.js';
import { failingFilters } from './search.js';

const INDEXED_TYPES = new Set(['Movie', 'Series']);
// Small clock differences between Jellyfin and Manelly are not worth a remark.
const FUTURE_TOLERANCE_MS = 10 * 60_000;

/**
 * Explains why titles named like `title` do or do not show up in the media
 * search: looks them up in Jellyfin directly and compares with the index.
 */
export async function diagnoseTitle(
  client: JellyfinClient,
  index: MediaIndex | null,
  title: string,
  filters: MediaSearchParams,
  options: { building?: boolean; now?: number } = {},
): Promise<TitleDiagnosis[]> {
  const now = options.now ?? Date.now();
  const [libraries, found] = await Promise.all([
    client.getLibraries(),
    client.getItems(
      new URLSearchParams({
        searchTerm: title,
        recursive: 'true',
        includeItemTypes: 'Movie,Series,Video,MusicVideo',
        fields: 'Path,DateCreated',
        enableImages: 'false',
        enableUserData: 'false',
        limit: '20',
      }),
    ),
  ]);

  // Listing a library is the expensive part; do it once per library and type.
  const listings = new Map<string, Promise<{ total: number; ids: Set<string> }>>();
  const listing = (libraryId: string, type: string) => {
    const key = `${libraryId}|${type}`;
    if (!listings.has(key)) listings.set(key, listLibraryIds(client, libraryId, type));
    return listings.get(key)!;
  };

  const results: TitleDiagnosis[] = [];
  for (const raw of found.Items ?? []) {
    if (!raw.Id) continue;
    const library = libraryOf(raw.Path, libraries);
    const indexed = index?.byId.get(raw.Id);
    const failing = indexed ? failingFilters(indexed, filters) : [];
    let libraryTotal: number | null = null;
    let verdict: TitleVerdict;
    if (indexed) {
      verdict = failing.length ? 'filtered' : 'visible';
    } else {
      const unsupported = unsupportedVerdict(raw, library);
      if (unsupported) {
        verdict = unsupported;
      } else if (!index || options.building) {
        verdict = 'indexNotReady';
      } else {
        // Read the library the way the index build does, instead of trusting dates.
        const listed = await listing(library!.ItemId!, raw.Type!);
        libraryTotal = listed.total;
        verdict = listed.ids.has(raw.Id) ? 'notIndexed' : 'notInLibraryQuery';
      }
    }

    const created = raw.DateCreated ? Date.parse(raw.DateCreated) : NaN;
    results.push({
      id: raw.Id,
      name: raw.Name ?? 'Unbekannter Titel',
      type: raw.Type ?? 'Unknown',
      year: raw.ProductionYear ?? null,
      library: library ? { name: library.Name ?? 'Bibliothek', collectionType: library.CollectionType ?? null } : null,
      path: raw.Path ?? null,
      dateCreated: raw.DateCreated ?? null,
      dateCreatedInFuture: created > now + FUTURE_TOLERANCE_MS,
      listing: libraryTotal === null ? null : { libraryTotal },
      verdict,
      failingFilters: failing,
      incompleteMedia: index?.skipped.some((skipped) => skipped.id === raw.Id) ?? false,
    });
  }
  return results;
}

/** Why Manelly never reads the title; null when it belongs in the index. */
function unsupportedVerdict(item: JfBaseItem, library: JfVirtualFolder | null): TitleVerdict | null {
  if (!INDEXED_TYPES.has(item.Type ?? '')) return 'unsupportedType';
  if (!library?.ItemId) return 'noLibrary';
  if (!VIDEO_LIBRARIES[library.CollectionType ?? 'mixed']) return 'unsupportedLibrary';
  return null;
}

/** The library whose folder contains `path` (the most specific one if folders are nested). */
function libraryOf(path: string | undefined, libraries: JfVirtualFolder[]): JfVirtualFolder | null {
  if (!path) return null;
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const target = normalize(path);
  let best: { library: JfVirtualFolder; length: number } | null = null;
  for (const library of libraries) {
    for (const location of library.Locations ?? []) {
      const folder = normalize(location);
      if ((target === folder || target.startsWith(`${folder}/`)) && folder.length > (best?.length ?? -1)) {
        best = { library, length: folder.length };
      }
    }
  }
  return best?.library ?? null;
}
