import type { MediaIndexStatus } from '@manelly/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { JellyfinConnection } from '../connection.js';
import type { JellyfinClient } from '../jellyfin/client.js';
import { buildMediaIndex, type MediaIndex } from './indexer.js';

/** Keeps the media index of the active Jellyfin connection and rebuilds it when it gets old. */
export interface MediaIndexStore {
  /** The current index; starts a (re)build in the background when needed. */
  get(): MediaIndex | null;
  status(): MediaIndexStatus;
  /** Rebuilds now, e.g. after the user added media in Jellyfin. */
  refresh(): void;
}

export interface MediaIndexStoreOptions {
  /** Rebuild in the background once the index is older than this. */
  maxAgeMs?: number;
  /** Wait this long after a failed build before trying again on its own. */
  retryAfterMs?: number;
  now?: () => number;
  build?: typeof buildMediaIndex;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>;
}

export function createMediaIndexStore(connection: JellyfinConnection, options: MediaIndexStoreOptions = {}): MediaIndexStore {
  const { maxAgeMs = 15 * 60_000, retryAfterMs = 60_000, now = Date.now, build = buildMediaIndex, log } = options;

  let index: MediaIndex | null = null;
  let indexClient: JellyfinClient | null = null;
  /** `again`: asked to rebuild while this build ran, which may have missed what changed since it began. */
  let building: { client: JellyfinClient; loaded: number; total: number; again: boolean } | null = null;
  let failure: { client: JellyfinClient; message: string; at: number } | null = null;

  function start(client: JellyfinClient) {
    const job = { client, loaded: 0, total: 0, again: false };
    building = job;
    log?.info('Medien-Index wird aufgebaut …');
    build(client, (loaded, total) => {
      job.loaded = loaded;
      job.total = total;
    }).then(
      (next) => {
        // The connection may have changed while this build was running.
        if (connection.client !== client) return;
        index = { ...next, builtAt: now() };
        indexClient = client;
        failure = null;
        log?.info(`Medien-Index fertig: ${next.counts.movies} Filme, ${next.counts.series} Serien, ${next.counts.episodes} Folgen`);
      },
      (error: unknown) => {
        if (connection.client !== client) return;
        failure = { client, message: error instanceof Error ? error.message : String(error), at: now() };
        log?.warn(`Medien-Index fehlgeschlagen: ${failure.message}`);
      },
    ).finally(() => {
      if (building !== job) return;
      building = null;
      if (job.again && connection.client === client) start(client);
    });
  }

  function ensure(force = false) {
    const client = connection.client;
    if (!client) return;
    if (indexClient !== client) {
      index = null;
      indexClient = null;
    }
    if (building?.client === client) {
      if (force) building.again = true;
      return;
    }
    const recentFailure = failure?.client === client && now() - failure.at < retryAfterMs;
    const stale = !index || now() - index.builtAt > maxAgeMs;
    if (force || (stale && !recentFailure)) start(client);
  }

  return {
    get() {
      ensure();
      return index;
    },
    refresh() {
      ensure(true);
    },
    status() {
      ensure();
      const client = connection.client;
      const job = building?.client === client ? building : null;
      const error = failure?.client === client ? failure.message : null;
      return {
        state: job ? 'building' : index ? 'ready' : error ? 'error' : 'empty',
        builtAt: index ? new Date(index.builtAt).toISOString() : null,
        counts: index ? index.counts : null,
        progress: job ? { loaded: job.loaded, total: job.total } : null,
        error,
        skipped: index ? index.skipped.slice(0, 50) : [],
      };
    },
  };
}
