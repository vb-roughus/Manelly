import type { ItemScanStarted, LibraryScanStatus } from '@manelly/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { JellyfinConnection } from '../connection.js';
import { AppError, requireClient } from '../errors.js';
import type { JellyfinClient } from '../jellyfin/client.js';
import type { JfTaskInfo, JfVirtualFolder } from '../jellyfin/types.js';
import type { MediaIndexStore } from './store.js';

/** Jellyfin's scheduled task «Medienbibliothek scannen» – the same its dashboard starts for all libraries. */
const TASK_KEY = 'RefreshLibrary';
const RESULTS: Record<string, NonNullable<LibraryScanStatus['lastRun']>['result']> = {
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Aborted: 'aborted',
};

/** Jellyfin scans this library right now, or will in a moment. */
const scanning = (library: JfVirtualFolder) => library.RefreshStatus === 'Active' || library.RefreshStatus === 'Queued';

/** A single library Manelly asked Jellyfin to scan; once it is idle again, the media are read again. */
interface LibraryWatch {
  client: JellyfinClient;
  /** Jellyfin reported it scanning at least once. */
  ran: boolean;
  since: number;
}

/** A scan Manelly waits for, to read the libraries again once it ended. */
interface Watch {
  client: JellyfinClient;
  taskId: string;
  /** When the scan before this one ended; a new end means this one is over. */
  before: string | null;
  /** Jellyfin reported it running at least once. */
  ran: boolean;
  since: number;
}

export interface LibraryScannerOptions {
  /** How often a running scan is checked. */
  pollMs?: number;
  /** A scan Jellyfin never reports as running is given up after this long. */
  startTimeoutMs?: number;
  /**
   * After the scan of a series or season, the media are read again this long after – Jellyfin reports no progress
   * for it, and it is mostly done in seconds; the later read catches slow ones.
   */
  itemRereadsMs?: number[];
  now?: () => number;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>;
}

/**
 * Starts and follows Jellyfin's library scan. When a scan ends – started here or in Jellyfin – Manelly reads its
 * media index again, so new titles show up without waiting for the next rebuild.
 */
export function createLibraryScanner(connection: JellyfinConnection, store: Pick<MediaIndexStore, 'refresh'>, options: LibraryScannerOptions = {}) {
  const { pollMs = 5000, startTimeoutMs = 60_000, itemRereadsMs = [30_000, 120_000], now = Date.now, log } = options;
  let watch: Watch | null = null;
  const libraryWatches = new Map<string, LibraryWatch>();
  let timer: NodeJS.Timeout | null = null;
  let rereads: NodeJS.Timeout[] = [];

  async function findTask(client: JellyfinClient): Promise<JfTaskInfo & { Id: string }> {
    const task = (await client.getScheduledTasks()).find((candidate) => candidate.Key === TASK_KEY);
    if (!task?.Id) throw new AppError('UPSTREAM_ERROR', 'Jellyfin hat keine Aufgabe «Medienbibliothek scannen».');
    return task as JfTaskInfo & { Id: string };
  }

  const lastEnd = (task: JfTaskInfo) => task.LastExecutionResult?.EndTimeUtc ?? null;
  /** Asked for, but Jellyfin does not report it running yet. */
  const pending = (client: JellyfinClient) => watch?.client === client && !watch.ran;

  /** Takes in what Jellyfin says about the task: follows a running scan, and ends the watch when it is over. */
  function observe(client: JellyfinClient, task: JfTaskInfo & { Id: string }) {
    if (task.State && task.State !== 'Idle') {
      if (watch?.client === client) watch.ran = true;
      else watch = { client, taskId: task.Id, before: lastEnd(task), ran: true, since: now() };
      schedule();
      return;
    }
    if (watch?.client !== client) return;
    if (watch.ran || lastEnd(task) !== watch.before) {
      watch = null;
      log?.info('Mediatheken-Scan in Jellyfin beendet – Medien werden neu eingelesen');
      store.refresh();
    } else if (now() - watch.since > startTimeoutMs) {
      watch = null;
      log?.warn('Jellyfin hat den Mediatheken-Scan nicht gestartet');
    } else {
      schedule();
    }
  }

  /** Takes in what Jellyfin says about the libraries: ends the watch of each one that is idle again. */
  function observeLibraries(client: JellyfinClient, libraries: JfVirtualFolder[]) {
    let ended = false;
    for (const [id, libraryWatch] of libraryWatches) {
      const library = libraries.find((candidate) => candidate.ItemId === id);
      if (libraryWatch.client !== client || !library) {
        libraryWatches.delete(id);
      } else if (scanning(library)) {
        libraryWatch.ran = true;
      } else if (libraryWatch.ran || now() - libraryWatch.since >= pollMs) {
        // Idle again – or done so quickly that it was never seen scanning.
        libraryWatches.delete(id);
        log?.info(`Mediathek «${library.Name ?? id}» in Jellyfin gescannt – Medien werden neu eingelesen`);
        ended = true;
      }
    }
    if (ended) store.refresh();
    schedule();
  }

  function schedule() {
    if (timer || (!watch && libraryWatches.size === 0)) return;
    timer = setTimeout(() => void tick(), pollMs);
    timer.unref();
  }

  async function tick() {
    timer = null;
    const client = connection.client;
    if (libraryWatches.size > 0 && client) {
      const libraries = await client.getLibraries().catch(() => null);
      if (libraries) observeLibraries(client, libraries);
    }
    const current = watch;
    if (!current) return;
    // Another Jellyfin now: its scans are not this one.
    if (connection.client !== current.client) {
      watch = null;
      return;
    }
    // Unreachable for a moment (e.g. Jellyfin restarts): ask again next time.
    const task = await current.client.getScheduledTask(current.taskId).catch(() => null);
    if (task && watch === current) observe(current.client, { ...task, Id: current.taskId });
    schedule();
  }

  function toStatus(client: JellyfinClient, task: JfTaskInfo, libraries: JfVirtualFolder[]): LibraryScanStatus {
    const state = task.State === 'Running' || pending(client) ? 'running' : task.State === 'Cancelling' ? 'cancelling' : 'idle';
    const result = task.LastExecutionResult;
    const progress = task.State === 'Running' && typeof task.CurrentProgressPercentage === 'number' ? Math.min(100, Math.max(0, task.CurrentProgressPercentage)) : null;
    return {
      state,
      progress,
      lastRun: result?.EndTimeUtc
        ? { startedAt: result.StartTimeUtc ?? null, endedAt: result.EndTimeUtc, result: RESULTS[result.Status ?? ''] ?? 'failed', error: result.ErrorMessage || null }
        : null,
      libraries: libraries.map((library) => {
        const id = library.ItemId ?? null;
        const asked = id !== null && libraryWatches.get(id)?.client === client && !libraryWatches.get(id)!.ran;
        const busy = scanning(library) || asked;
        return {
          id,
          name: library.Name ?? 'Unbenannt',
          type: library.CollectionType ?? null,
          locations: library.Locations ?? [],
          scanning: busy,
          progress: busy && typeof library.RefreshProgress === 'number' ? Math.min(100, Math.max(0, library.RefreshProgress)) : null,
        };
      }),
    };
  }

  async function status(client: JellyfinClient): Promise<LibraryScanStatus> {
    const [task, libraries] = await Promise.all([findTask(client), client.getLibraries()]);
    observe(client, task);
    observeLibraries(client, libraries);
    return toStatus(client, task, libraries);
  }

  return {
    status: () => status(requireClient(connection.client)),

    /** Scans all libraries; a scan that already runs is left to go on. */
    async start(): Promise<LibraryScanStatus> {
      const client = requireClient(connection.client);
      const task = await findTask(client);
      if (task.State === 'Idle' || !task.State) {
        await client.startScheduledTask(task.Id);
        watch = { client, taskId: task.Id, before: lastEnd(task), ran: false, since: now() };
        log?.info('Mediatheken-Scan in Jellyfin gestartet');
      }
      return status(client);
    },

    /**
     * Scans one library – much faster than all of them when the others are big, e.g. series with many folders.
     * Jellyfin cannot stop such a scan; a scan that already runs is left to go on.
     */
    async startLibrary(id: string): Promise<LibraryScanStatus> {
      const client = requireClient(connection.client);
      const library = (await client.getLibraries()).find((candidate) => candidate.ItemId === id);
      if (!library) throw new AppError('NOT_FOUND', 'Diese Mediathek gibt es in Jellyfin nicht (mehr).');
      if (!scanning(library)) {
        await client.refreshItem(id);
        libraryWatches.set(id, { client, ran: false, since: now() });
        log?.info(`Mediathek «${library.Name ?? id}» wird in Jellyfin gescannt`);
      }
      return status(client);
    },

    /**
     * Scans the folder of one series or season only – a matter of seconds, where the whole library takes minutes.
     * Jellyfin does not say when it is done, so the media are read again after a while.
     */
    async startItem(id: string): Promise<ItemScanStarted> {
      const client = requireClient(connection.client);
      const query = new URLSearchParams({ ids: id, fields: 'Path', enableImages: 'false', enableUserData: 'false' });
      const item = (await client.getItems(query)).Items?.[0];
      if (!item?.Id) throw new AppError('NOT_FOUND', 'Diese Serie oder Staffel kennt Jellyfin nicht (mehr).');
      if (item.Type !== 'Series' && item.Type !== 'Season') throw new AppError('BAD_REQUEST', 'Einzeln scannen lassen sich nur Serien und Staffeln.');
      await client.refreshItem(item.Id);
      const name = item.Type === 'Season' ? `${item.SeriesName ?? 'Serie'} › ${item.Name ?? 'Staffel'}` : (item.Name ?? 'Serie');
      log?.info(`«${name}» wird in Jellyfin gescannt`);
      // A newer scan takes over the reads still to come.
      for (const reread of rereads) clearTimeout(reread);
      rereads = itemRereadsMs.map((delay) => {
        const reread = setTimeout(() => {
          rereads = rereads.filter((other) => other !== reread);
          store.refresh();
        }, delay);
        reread.unref();
        return reread;
      });
      return { id: item.Id, name };
    },

    /** Stops a running scan of all libraries; what it found so far stays in Jellyfin. */
    async cancel(): Promise<LibraryScanStatus> {
      const client = requireClient(connection.client);
      const task = await findTask(client);
      if (task.State === 'Running') {
        await client.stopScheduledTask(task.Id);
        log?.info('Mediatheken-Scan in Jellyfin abgebrochen');
      } else if (pending(client)) {
        // Asked for, but not begun: stop waiting for it.
        watch = null;
      }
      return status(client);
    },

    stop() {
      if (timer) clearTimeout(timer);
      for (const reread of rereads) clearTimeout(reread);
      rereads = [];
      timer = null;
      watch = null;
    },
  };
}

export type LibraryScanner = ReturnType<typeof createLibraryScanner>;
