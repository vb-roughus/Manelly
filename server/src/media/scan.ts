import type { LibraryScanStatus } from '@manelly/shared';
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
  now?: () => number;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>;
}

/**
 * Starts and follows Jellyfin's library scan. When a scan ends – started here or in Jellyfin – Manelly reads its
 * media index again, so new titles show up without waiting for the next rebuild.
 */
export function createLibraryScanner(connection: JellyfinConnection, store: Pick<MediaIndexStore, 'refresh'>, options: LibraryScannerOptions = {}) {
  const { pollMs = 5000, startTimeoutMs = 60_000, now = Date.now, log } = options;
  let watch: Watch | null = null;
  let timer: NodeJS.Timeout | null = null;

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

  function schedule() {
    if (timer || !watch) return;
    timer = setTimeout(() => void tick(), pollMs);
    timer.unref();
  }

  async function tick() {
    timer = null;
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
      libraries: libraries.map((library) => ({ name: library.Name ?? 'Unbenannt', type: library.CollectionType ?? null, locations: library.Locations ?? [] })),
    };
  }

  async function status(client: JellyfinClient): Promise<LibraryScanStatus> {
    const [task, libraries] = await Promise.all([findTask(client), client.getLibraries()]);
    observe(client, task);
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

    /** Stops a running scan; what it found so far stays in Jellyfin. */
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
      timer = null;
      watch = null;
    },
  };
}

export type LibraryScanner = ReturnType<typeof createLibraryScanner>;
