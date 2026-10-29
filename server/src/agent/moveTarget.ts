import type { ExtractedMoveTarget } from '@manelly/shared';
import { AppError } from '../errors.js';
import type { JellyfinClient } from '../jellyfin/client.js';
import { isInFolder } from './conversions.js';

/**
 * Where entries of the extraction folder may go: the folder of a library, or the folder of a series or season in it –
 * always as Jellyfin names them, never a path from the browser. The label tells where, e.g. "Serien › The Expanse".
 */
export async function resolveMoveTarget(client: JellyfinClient, request: ExtractedMoveTarget): Promise<{ target: string; label: string }> {
  const library = (await client.getLibraries()).find((candidate) => (candidate.Locations ?? []).includes(request.target));
  if (!library) throw new AppError('BAD_REQUEST', 'Das Ziel ist kein Ordner einer Mediathek in Jellyfin.');
  const name = library.Name ?? 'Mediathek';
  if (!request.itemId) return { target: request.target, label: name };

  const query = new URLSearchParams({ ids: request.itemId, fields: 'Path', enableImages: 'false', enableUserData: 'false' });
  const item = (await client.getItems(query)).Items?.[0];
  if (!item || (item.Type !== 'Series' && item.Type !== 'Season')) throw new AppError('BAD_REQUEST', 'Diese Serie oder Staffel kennt Jellyfin nicht (mehr).');
  if (!item.Path || !isInFolder(item.Path, request.target)) throw new AppError('BAD_REQUEST', `«${item.Name ?? 'Serie'}» liegt nicht im Ordner ${request.target} von ${name}.`);
  const title = item.Type === 'Season' ? `${item.SeriesName ?? 'Serie'} › ${item.Name ?? 'Staffel'}` : (item.Name ?? 'Serie');
  return { target: item.Path, label: `${name} › ${title}` };
}
