import type { ExtractedMoveTarget } from '@manelly/shared';
import { AppError } from '../errors.js';
import type { JellyfinClient } from '../jellyfin/client.js';
import { isInFolder, pathApiFor } from './conversions.js';

const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** A folder name Windows takes, without anything that would lead out of the folder it goes into. */
export function isFolderName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    name !== '.' &&
    name !== '..' &&
    !/[<>:"/\\|?*\u0000-\u001f]/.test(name) &&
    !/[ .]$/.test(name) &&
    !RESERVED_NAMES.test(name)
  );
}

/**
 * Where entries of the extraction folder may go: the folder of a library, the folder of a series or season in it –
 * always as Jellyfin names them, never a path from the browser – or a new folder right in the library's folder. The
 * label tells where, e.g. "Serien › The Expanse".
 */
export async function resolveMoveTarget(client: JellyfinClient, request: ExtractedMoveTarget): Promise<{ target: string; label: string; create?: true }> {
  if (request.newFolder !== undefined && request.itemId) throw new AppError('BAD_REQUEST', 'Entweder eine Serie oder Staffel oder einen neuen Ordner erwartet.');
  const library = (await client.getLibraries()).find((candidate) => (candidate.Locations ?? []).includes(request.target));
  if (!library) throw new AppError('BAD_REQUEST', 'Das Ziel ist kein Ordner einer Mediathek in Jellyfin.');
  const name = library.Name ?? 'Mediathek';
  if (request.newFolder !== undefined) {
    const folder = request.newFolder.trim();
    if (!isFolderName(folder)) throw new AppError('BAD_REQUEST', `«${folder}» geht nicht als Ordnername – ohne < > : " / \\ | ? * und nicht mit Punkt oder Leerzeichen am Ende.`);
    const api = pathApiFor(request.target);
    return { target: api.join(request.target, folder), label: `${name} › ${folder}`, create: true };
  }
  if (!request.itemId) return { target: request.target, label: name };

  const query = new URLSearchParams({ ids: request.itemId, fields: 'Path', enableImages: 'false', enableUserData: 'false' });
  const item = (await client.getItems(query)).Items?.[0];
  if (!item || (item.Type !== 'Series' && item.Type !== 'Season')) throw new AppError('BAD_REQUEST', 'Diese Serie oder Staffel kennt Jellyfin nicht (mehr).');
  if (!item.Path || !isInFolder(item.Path, request.target)) throw new AppError('BAD_REQUEST', `«${item.Name ?? 'Serie'}» liegt nicht im Ordner ${request.target} von ${name}.`);
  const title = item.Type === 'Season' ? `${item.SeriesName ?? 'Serie'} › ${item.Name ?? 'Staffel'}` : (item.Name ?? 'Serie');
  return { target: item.Path, label: `${name} › ${title}` };
}
