import type { AudioTask } from '@manelly/shared';
import { AppError } from '../errors.js';
import type { JellyfinClient } from '../jellyfin/client.js';
import type { JfBaseItem } from '../jellyfin/types.js';
import type { MediaIndexStore } from '../media/store.js';
import type { AgentClient } from './client.js';

const isMkv = (path: string | null | undefined): path is string => typeof path === 'string' && /\.mkv$/i.test(path);

/** The MKV files of every version of these items, as Jellyfin names them; with a single version, the item's own path will do. */
const filesOf = (items: JfBaseItem[]) =>
  items
    .flatMap((item) => {
      const sources = item.MediaSources ?? [];
      return sources.length > 1 ? sources.map((source) => source.Path) : [sources[0]?.Path ?? item.Path];
    })
    .filter(isMkv);

/**
 * The files whose audio tracks a title in the media has: a movie's versions, or every episode of a series or season.
 * The paths come from Jellyfin, never from the browser.
 */
export async function audioFilesOf(client: JellyfinClient, itemId: string): Promise<{ name: string; files: string[] }> {
  const fields = 'Path,MediaSources';
  const item = (await client.getItems(new URLSearchParams({ ids: itemId, fields, enableImages: 'false', enableUserData: 'false' }))).Items?.[0];
  if (!item?.Id) throw new AppError('NOT_FOUND', 'Diesen Titel kennt Jellyfin nicht (mehr).');
  let files: string[];
  if (item.Type === 'Series' || item.Type === 'Season') {
    const query = new URLSearchParams({ parentId: item.Id, recursive: 'true', includeItemTypes: 'Episode', fields, enableImages: 'false', enableUserData: 'false' });
    files = filesOf((await client.getItems(query)).Items ?? []);
  } else {
    files = filesOf([item]);
  }
  if (files.length === 0) throw new AppError('BAD_REQUEST', 'Dieser Titel hat keine MKV-Datei – nur dort lässt sich die Tonspur so festlegen.');
  return { name: item.Name ?? 'Titel', files: [...new Set(files)] };
}

/**
 * Follows the agent's audio task for files of the libraries: once it is done and changed something, Jellyfin (told by
 * the agent) has read the files again after a while, and so does Manelly's index.
 */
export function watchAudioTask(agent: () => AgentClient | null, store: MediaIndexStore, options: { pollMs?: number; settleMs?: number; maxMs?: number } = {}) {
  const { pollMs = 5_000, settleMs = 45_000, maxMs = 6 * 3_600_000 } = options;
  const since = Date.now();
  const tick = async () => {
    let task: AudioTask | null = null;
    try {
      task = (await agent()?.audioStatus()) ?? null;
    } catch {
      // Gone for a moment, e.g. restarting: look again.
    }
    if (task?.state === 'done') {
      if (task.results.some((result) => result.changed)) setTimeout(() => store.refresh(), settleMs).unref();
      return;
    }
    if (Date.now() - since < maxMs) setTimeout(() => void tick(), pollMs).unref();
  };
  setTimeout(() => void tick(), pollMs).unref();
}
