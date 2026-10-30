import { describe, expect, it } from 'vitest';
import type { ExtractedMove } from '@manelly/shared';
import type { AgentConnection } from '../src/agent/connection.js';
import { createMoveScans } from '../src/agent/moveScans.js';

const move = (id: string, state: ExtractedMove['state'], finished = state === 'done' || state === 'failed'): ExtractedMove => ({
  id,
  paths: ['Dark.S01E01.mkv'],
  target: 'D:\\Serien\\Dark',
  label: 'Serien › Dark',
  state,
  bytesTotal: 10,
  bytesDone: finished ? 10 : 2,
  bytesPerSecond: null,
  copyThrottle: null,
  problems: [],
  createdAt: '2026-10-30T09:00:00Z',
  finishedAt: finished ? '2026-10-30T09:01:00Z' : null,
});

function setup(options: { maxWaitMs?: number; failScan?: boolean } = {}) {
  const world = { moves: [] as ExtractedMove[] | null, scanned: [] as string[], clock: 0 };
  const agent = {
    client: {
      extractedMoves: async () => {
        if (!world.moves) throw new Error('Der Agent antwortet nicht.');
        return world.moves;
      },
    },
  } as unknown as AgentConnection;
  const scanner = {
    startItem: async (id: string) => {
      if (options.failScan) throw new Error('Diese Serie oder Staffel kennt Jellyfin nicht (mehr).');
      world.scanned.push(id);
      return { id, name: 'Dark' };
    },
  };
  const scans = createMoveScans(agent, scanner, { pollMs: 5, maxWaitMs: options.maxWaitMs, now: () => world.clock });
  return { world, scans };
}

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
}

const scanOf = (scans: ReturnType<typeof createMoveScans>, moves: ExtractedMove[]) => scans.annotate(moves)[0]?.scan;

describe('scanning after a move', () => {
  it('waits for the move, also while the agent is away for a moment, and then scans the series', async () => {
    const { world, scans } = setup();
    world.moves = [move('m1', 'running')];
    scans.watch('m1', 'aa11', 'Dark');
    expect(scanOf(scans, world.moves)).toEqual({ name: 'Dark', state: 'waiting', error: null });
    await new Promise((resolve) => setTimeout(resolve, 30));
    world.moves = null;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(world.scanned).toEqual([]);

    world.moves = [move('m1', 'done')];
    await until(() => world.scanned.length === 1);
    expect(world.scanned).toEqual(['aa11']);
    expect(scanOf(scans, world.moves)).toEqual({ name: 'Dark', state: 'started', error: null });
    // Only once; other moves stay as they are.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(world.scanned).toEqual(['aa11']);
    expect(scans.annotate([move('m2', 'done')])[0]).not.toHaveProperty('scan');
    scans.stop();
  });

  it('does not scan when nothing was moved, the agent forgot the move, or it takes too long', async () => {
    const { world, scans } = setup({ maxWaitMs: 1000 });
    world.moves = [move('failed', 'failed'), move('slow', 'running')];
    scans.watch('failed', 'aa11', 'Dark');
    scans.watch('gone', 'aa11', 'Dark');
    scans.watch('slow', 'bb22', 'Dark › Staffel 2');
    await until(() => scanOf(scans, [move('gone', 'done')])?.state === 'skipped');
    expect(scanOf(scans, [move('failed', 'failed')])).toEqual({ name: 'Dark', state: 'skipped', error: 'Es wurde nichts verschoben.' });
    expect(scanOf(scans, [move('gone', 'done')])?.error).toBe('Der Agent kennt das Verschieben nicht mehr – wohl neu gestartet.');
    world.clock = 2000;
    await until(() => scanOf(scans, [move('slow', 'running')])?.state === 'skipped');
    expect(scanOf(scans, [move('slow', 'running')])?.error).toBe('Das Verschieben dauerte zu lange.');
    expect(world.scanned).toEqual([]);
    scans.stop();
  });

  it('says why Jellyfin did not scan', async () => {
    const { world, scans } = setup({ failScan: true });
    world.moves = [move('m1', 'done')];
    scans.watch('m1', 'aa11', 'Dark');
    await until(() => scanOf(scans, world.moves!)?.state === 'failed');
    expect(scanOf(scans, world.moves)?.error).toBe('Diese Serie oder Staffel kennt Jellyfin nicht (mehr).');
    scans.stop();
  });
});
