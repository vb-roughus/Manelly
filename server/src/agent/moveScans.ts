import type { ExtractedMove, MoveScan } from '@manelly/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { LibraryScanner } from '../media/scan.js';
import type { AgentConnection } from './connection.js';

/** Scans remembered at most; the oldest finished ones go first. */
const KEEP = 50;

interface Watch extends MoveScan {
  itemId: string;
  since: number;
}

export interface MoveScansOptions {
  /** How often the agent is asked about the moves waited for. */
  pollMs?: number;
  /** A move still not done after this long is no longer waited for. */
  maxWaitMs?: number;
  now?: () => number;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>;
}

/**
 * «Verschieben & scannen»: once the agent is done moving entries of the extraction folder into a series or season,
 * Jellyfin scans just that folder. Followed here on the server, so it happens also with the browser closed.
 */
export function createMoveScans(agent: AgentConnection, scanner: Pick<LibraryScanner, 'startItem'>, options: MoveScansOptions = {}) {
  const { pollMs = 5000, maxWaitMs = 24 * 3_600_000, now = Date.now, log } = options;
  const watches = new Map<string, Watch>();
  let timer: NodeJS.Timeout | null = null;

  const waiting = () => [...watches.values()].filter((watch) => watch.state === 'waiting');

  function settle(watch: Watch, state: MoveScan['state'], error: string | null = null) {
    watch.state = state;
    watch.error = error;
    if (error) log?.warn(`Kein Scan von «${watch.name}» nach dem Verschieben: ${error}`);
  }

  async function check(id: string, watch: Watch, moves: ExtractedMove[] | null) {
    const move = moves?.find((candidate) => candidate.id === id);
    if (moves && !move) settle(watch, 'skipped', 'Der Agent kennt das Verschieben nicht mehr – wohl neu gestartet.');
    else if (move?.finishedAt) {
      if (move.state !== 'done') return settle(watch, 'skipped', 'Es wurde nichts verschoben.');
      try {
        const started = await scanner.startItem(watch.itemId);
        settle(watch, 'started');
        log?.info(`Nach dem Verschieben scannt Jellyfin «${started.name}»`);
      } catch (error) {
        settle(watch, 'failed', (error as Error).message);
      }
    } else if (now() - watch.since > maxWaitMs) {
      settle(watch, 'skipped', 'Das Verschieben dauerte zu lange.');
    }
  }

  async function tick() {
    timer = null;
    // The agent away for a moment (e.g. restarting): asked again next time.
    const moves = (await agent.client?.extractedMoves().catch(() => null)) ?? null;
    for (const [id, watch] of watches) if (watch.state === 'waiting') await check(id, watch, moves);
    schedule();
  }

  function schedule() {
    if (timer || waiting().length === 0) return;
    timer = setTimeout(() => void tick(), pollMs);
    timer.unref();
  }

  return {
    /** Scans the series or season `itemId` once the move `moveId` is done. */
    watch(moveId: string, itemId: string, name: string) {
      watches.set(moveId, { itemId, name, state: 'waiting', error: null, since: now() });
      const finished = [...watches.keys()].filter((id) => watches.get(id)!.state !== 'waiting');
      for (const id of finished.slice(0, Math.max(0, watches.size - KEEP))) watches.delete(id);
      schedule();
    },

    /** The moves with the scan that follows them, where there is one. */
    annotate(moves: ExtractedMove[]): ExtractedMove[] {
      return moves.map((move) => {
        const watch = watches.get(move.id);
        return watch ? { ...move, scan: { name: watch.name, state: watch.state, error: watch.error } } : move;
      });
    },

    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type MoveScans = ReturnType<typeof createMoveScans>;
