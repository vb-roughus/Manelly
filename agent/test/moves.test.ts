import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExtractedMove } from '@manelly/shared';
import { deleteSamples, findSamples } from '../src/extracted.js';
import { createMover, type MoverOptions } from '../src/moves.js';

let root: string;
let extracted: string;
let library: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manelly-moves-'));
  extracted = path.join(root, 'entpackt');
  library = path.join(root, 'filme');
  await mkdir(path.join(extracted, 'Dune (2024)', 'Sample'), { recursive: true });
  await writeFile(path.join(extracted, 'Dune (2024)', 'Dune.mkv'), 'dune-video');
  await writeFile(path.join(extracted, 'Dune (2024)', 'Sample', 'dune-sample.mkv'), 'sm');
  await writeFile(path.join(extracted, 'Arrival.mkv'), 'arrival');
  await mkdir(library);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function settle(mover: ReturnType<typeof createMover>): Promise<ExtractedMove> {
  await mover.idle();
  return mover.list()[0]!;
}

/** As between two disks: the plain rename fails, so the mover copies. */
const acrossDisks: MoverOptions['rename'] = async () => {
  throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
};

describe('moving into a library', () => {
  it('renames on the same disk and tells Jellyfin about the new paths', async () => {
    const told: unknown[] = [];
    const mover = createMover({ notify: async (updates) => void told.push(...updates) });
    const queued = await mover.add(extracted, ['Dune (2024)', 'Arrival.mkv'], library, 'Filme');
    expect(queued).toMatchObject({ state: 'running', label: 'Filme', bytesTotal: 10 + 2 + 7 });
    const done = await settle(mover);
    expect(done).toMatchObject({ state: 'done', problems: [], bytesDone: 19, bytesPerSecond: null });
    expect((await readdir(library)).sort()).toEqual(['Arrival.mkv', 'Dune (2024)']);
    expect(await readdir(extracted)).toEqual([]);
    expect(told).toEqual([
      { Path: path.join(library, 'Dune (2024)'), UpdateType: 'Created' },
      { Path: path.join(library, 'Arrival.mkv'), UpdateType: 'Created' },
    ]);
  });

  it('copies to another disk, keeps to the copy limit, and deletes the source only afterwards', async () => {
    // A copy left over from an interrupted move is cleared first.
    await mkdir(path.join(library, 'Dune (2024).manelly-part'));
    await writeFile(path.join(library, 'Dune (2024).manelly-part', 'half.mkv'), 'x');
    const mover = createMover({ rename: acrossDisks, copyLimit: () => ({ bytesPerSecond: 1_000_000, streams: 1, streamsBitsPerSecond: 60_000_000 }) });
    await mover.add(extracted, ['Dune (2024)'], library, 'Filme');
    const done = await settle(mover);
    expect(done).toMatchObject({ state: 'done', bytesDone: 12, copyThrottle: null });
    expect(await readFile(path.join(library, 'Dune (2024)', 'Dune.mkv'), 'utf8')).toBe('dune-video');
    expect(await readFile(path.join(library, 'Dune (2024)', 'Sample', 'dune-sample.mkv'), 'utf8')).toBe('sm');
    expect(await readdir(library)).toEqual(['Dune (2024)']);
    expect(await readdir(extracted)).toEqual(['Arrival.mkv']);
  });

  it('leaves the source alone when the copy fails, and reports each entry that could not move', async () => {
    await mkdir(path.join(library, 'Dune (2024)'));
    const mover = createMover({
      rename: async (from, to) => {
        if (from.endsWith('Arrival.mkv')) throw Object.assign(new Error('Zugriff verweigert'), { code: 'EPERM' });
        return rename(from, to);
      },
    });
    await mover.add(extracted, ['Dune (2024)', 'Arrival.mkv'], library, 'Filme');
    const failed = await settle(mover);
    expect(failed.state).toBe('failed');
    expect(failed.problems).toEqual([
      { path: 'Dune (2024)', error: '«Dune (2024)» gibt es in Filme schon.' },
      { path: 'Arrival.mkv', error: 'Zugriff verweigert' },
    ]);
    expect((await readdir(extracted)).sort()).toEqual(['Arrival.mkv', 'Dune (2024)']);
  });

  it('counts a folder and what is in it once, and refuses what is not in the extraction folder or would move into itself', async () => {
    const mover = createMover();
    const queued = await mover.add(extracted, ['Dune (2024)/Dune.mkv', 'Dune (2024)', 'Dune (2024)'], library, 'Filme');
    expect(queued.paths).toEqual(['Dune (2024)']);
    await settle(mover);
    await expect(mover.add(extracted, ['../filme'], library, 'Filme')).rejects.toThrow('Ungültiger Ordner im Entpack-Ordner.');
    await expect(mover.add(extracted, [''], library, 'Filme')).rejects.toThrow('Einen Eintrag im Entpack-Ordner erwartet.');
    await expect(mover.add(extracted, ['Gibts nicht'], library, 'Filme')).rejects.toThrow('«Gibts nicht» gibt es im Entpack-Ordner nicht (mehr).');
    await mkdir(path.join(extracted, 'Serien', 'Neu'), { recursive: true });
    await expect(mover.add(extracted, ['Serien'], path.join(extracted, 'Serien', 'Neu'), 'Serien')).rejects.toThrow('«Serien» kann nicht in sich selbst verschoben werden.');
  });

  it('creates a new folder for the entries when the move starts, and moves into it when it is there already', async () => {
    const told: Array<{ Path: string }> = [];
    const mover = createMover({ notify: async (updates) => void told.push(...updates) });
    const series = path.join(library, 'Dark (2017)');
    await mover.add(extracted, ['Dune (2024)', 'Arrival.mkv'], series, 'Serien › Dark (2017)', true);
    expect((await settle(mover)).state).toBe('done');
    expect((await readdir(series)).sort()).toEqual(['Arrival.mkv', 'Dune (2024)']);
    expect(told.map((update) => update.Path)).toEqual([path.join(series, 'Dune (2024)'), path.join(series, 'Arrival.mkv')]);

    await writeFile(path.join(extracted, 'Dark.S02E01.mkv'), 'dark');
    await mover.add(extracted, ['Dark.S02E01.mkv'], series, 'Serien › Dark (2017)', true);
    expect((await settle(mover)).state).toBe('done');
    expect(await readdir(series)).toContain('Dark.S02E01.mkv');
  });

  it('moves nothing when the new folder cannot be created', async () => {
    await writeFile(path.join(library, 'Dark'), 'a file, not a folder');
    const mover = createMover();
    await mover.add(extracted, ['Arrival.mkv'], path.join(library, 'Dark'), 'Serien › Dark', true);
    const done = await settle(mover);
    expect(done.state).toBe('failed');
    expect(done.problems[0]?.error).toMatch(/^Den Ordner .*Dark kann der Agent nicht anlegen: /);
    expect(await readdir(extracted)).toContain('Arrival.mkv');
  });
});

describe('samples', () => {
  it('finds files with "sample" in the name on all levels, and deletes only those, with a sample folder they leave empty', async () => {
    await writeFile(path.join(extracted, 'Arrival-SAMPLE.mkv'), 'sample!');
    expect(await findSamples(extracted)).toEqual({
      samples: [
        { path: 'Arrival-SAMPLE.mkv', bytes: 7 },
        { path: 'Dune (2024)/Sample/dune-sample.mkv', bytes: 2 },
      ],
    });
    const result = await deleteSamples(extracted, ['Dune (2024)/Sample/dune-sample.mkv', 'Arrival.mkv', '../x-sample.mkv', 'weg-sample.mkv']);
    expect(result).toEqual({
      deleted: ['Dune (2024)/Sample/dune-sample.mkv'],
      problems: [
        { path: 'Arrival.mkv', error: 'Kein Sample – im Namen fehlt «sample».' },
        { path: '../x-sample.mkv', error: 'Ungültiger Ordner im Entpack-Ordner.' },
        { path: 'weg-sample.mkv', error: 'Die Datei gibt es nicht (mehr).' },
      ],
    });
    expect(await readdir(path.join(extracted, 'Dune (2024)'))).toEqual(['Dune.mkv']);
    expect((await stat(path.join(extracted, 'Arrival.mkv'))).size).toBe(7);
  });
});
