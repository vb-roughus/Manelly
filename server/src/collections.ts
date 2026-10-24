import type { CollectionSummary, MediaSearchParams } from '@manelly/shared';
import { AppError } from './errors.js';
import { JellyfinError, type JellyfinClient } from './jellyfin/client.js';
import type { MediaIndex } from './media/indexer.js';
import { filterItems } from './media/search.js';

// Jellyfin rejects request lines above 8 KB; 100 ids of 32 characters stay well below.
const BATCH_SIZE = 100;

const adminIds = new WeakMap<JellyfinClient, string>();

/**
 * Collections consist of linked items, which Jellyfin only resolves for a user:
 * without one, a collection looks empty. An administrator sees every library.
 */
export async function adminUserId(client: JellyfinClient): Promise<string> {
  const cached = adminIds.get(client);
  if (cached) return cached;
  const admin = (await client.getUsers()).find((user) => user.Id && user.Policy?.IsAdministrator && !user.Policy.IsDisabled);
  if (!admin?.Id) {
    throw new AppError('UPSTREAM_ERROR', 'In Jellyfin gibt es keinen aktiven Administrator – ohne ihn kann Manelly Sammlungen nicht lesen.');
  }
  adminIds.set(client, admin.Id);
  return admin.Id;
}

export async function listCollections(client: JellyfinClient): Promise<CollectionSummary[]> {
  const userId = await adminUserId(client);
  const result = await client.getItems(
    new URLSearchParams({
      includeItemTypes: 'BoxSet',
      recursive: 'true',
      userId,
      fields: 'ChildCount,SortName',
      sortBy: 'SortName',
      enableImages: 'false',
      enableUserData: 'false',
    }),
  );
  return (result.Items ?? []).flatMap((item) =>
    item.Id ? [{ id: item.Id, name: item.Name ?? 'Sammlung', itemCount: item.ChildCount ?? null }] : [],
  );
}

/** Name of the collection; fails unless the id belongs to a collection. */
export async function collectionName(client: JellyfinClient, collectionId: string): Promise<string> {
  const userId = await adminUserId(client);
  const [item] = (await client.getItems(new URLSearchParams({ ids: collectionId, userId, enableImages: 'false' }))).Items ?? [];
  if (!item || item.Type !== 'BoxSet') throw new AppError('NOT_FOUND', 'Diese Sammlung gibt es in Jellyfin nicht (mehr).');
  return item.Name ?? 'Sammlung';
}

export async function collectionItemIds(client: JellyfinClient, collectionId: string): Promise<Set<string>> {
  const userId = await adminUserId(client);
  const ids = new Set<string>();
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const page = await client.getItems(
      new URLSearchParams({
        parentId: collectionId,
        userId,
        enableImages: 'false',
        enableUserData: 'false',
        enableTotalRecordCount: 'true',
        startIndex: String(start),
        limit: String(pageSize),
      }),
    );
    for (const item of page.Items ?? []) if (item.Id) ids.add(item.Id);
    if (!page.Items?.length || start + pageSize >= (page.TotalRecordCount ?? 0)) return ids;
  }
}

/** Which of the titles matching the filters are missing from the collection. */
export function planCollectionAdd(index: MediaIndex, filters: MediaSearchParams, existing: Set<string>) {
  const ids = filterItems(index, filters).map((item) => item.id);
  const toAdd = ids.filter((id) => !existing.has(id));
  return { matching: ids.length, alreadyIn: ids.length - toAdd.length, toAdd };
}

/**
 * Adds in batches. Jellyfin rejects a whole batch if one id is unknown (a title
 * deleted since the index was built), so a failed batch is retried item by item.
 */
export async function addItemsToCollection(client: JellyfinClient, collectionId: string, ids: string[]) {
  let added = 0;
  let failed = 0;
  const rejected = (error: unknown) => error instanceof JellyfinError && error.code === 'UPSTREAM_ERROR';

  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    try {
      await client.addToCollection(collectionId, batch);
      added += batch.length;
    } catch (error) {
      if (!rejected(error)) throw error;
      for (const id of batch) {
        try {
          await client.addToCollection(collectionId, [id]);
          added += 1;
        } catch (single) {
          if (!rejected(single)) throw single;
          failed += 1;
        }
      }
    }
  }
  return { added, failed };
}
