import type { MediaSearchParams, TitleDiagnosis, TitleVerdict } from '@manelly/shared';
import type { JellyfinClient } from '../jellyfin/client.js';
import type { JfBaseItem, JfVirtualFolder } from '../jellyfin/types.js';
import { VIDEO_LIBRARIES, type MediaIndex } from './indexer.js';
import { failingFilters } from './search.js';

const INDEXED_TYPES = new Set(['Movie', 'Series']);

/**
 * Explains why titles named like `title` do or do not show up in the media
 * search: looks them up in Jellyfin directly and compares with the index.
 */
export async function diagnoseTitle(
  client: JellyfinClient,
  index: MediaIndex | null,
  title: string,
  filters: MediaSearchParams,
): Promise<TitleDiagnosis[]> {
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

  const results: TitleDiagnosis[] = [];
  for (const raw of found.Items ?? []) {
    if (!raw.Id) continue;
    const library = libraryOf(raw.Path, libraries);
    const indexed = index?.byId.get(raw.Id);
    const failing = indexed ? failingFilters(indexed, filters) : [];
    results.push({
      id: raw.Id,
      name: raw.Name ?? 'Unbekannter Titel',
      type: raw.Type ?? 'Unknown',
      year: raw.ProductionYear ?? null,
      library: library ? { name: library.Name ?? 'Bibliothek', collectionType: library.CollectionType ?? null } : null,
      path: raw.Path ?? null,
      dateCreated: raw.DateCreated ?? null,
      verdict: indexed ? (failing.length ? 'filtered' : 'visible') : await missingVerdict(client, raw, library, index),
      failingFilters: failing,
      incompleteMedia: index?.skipped.some((skipped) => skipped.id === raw.Id) ?? false,
    });
  }
  return results;
}

async function missingVerdict(
  client: JellyfinClient,
  item: JfBaseItem,
  library: JfVirtualFolder | null,
  index: MediaIndex | null,
): Promise<TitleVerdict> {
  if (!INDEXED_TYPES.has(item.Type ?? '')) return 'unsupportedType';
  if (!library?.ItemId) return 'noLibrary';
  if (!VIDEO_LIBRARIES[library.CollectionType ?? 'mixed']) return 'unsupportedLibrary';
  if (!index) return 'indexNotReady';
  if (item.DateCreated && Date.parse(item.DateCreated) > index.builtAt) return 'newerThanIndex';

  // Ask exactly the way the index does: is the title part of its library's listing?
  const listed = await client.getItems(
    new URLSearchParams({
      parentId: library.ItemId,
      recursive: 'true',
      includeItemTypes: item.Type!,
      isMissing: 'false',
      ids: item.Id!,
      enableImages: 'false',
      enableUserData: 'false',
    }),
  );
  return listed.Items?.some((entry) => entry.Id === item.Id) ? 'missingFromIndex' : 'notInLibraryQuery';
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
