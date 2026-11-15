import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWholeSync, writeWhole } from '../src/persist.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manelly-persist-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const held = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

describe('writing state files whole', () => {
  it('writes through a temporary file', async () => {
    const file = path.join(root, 'discs.json');
    await writeWhole(file, '{"a":1}');
    expect(await readFile(file, 'utf8')).toBe('{"a":1}');
    expect(await readdir(root)).toEqual(['discs.json']);
  });

  it('tries the rename again while Windows holds the new file, and keeps the content in the end anyway', async () => {
    const file = path.join(root, 'discs.json');
    let refused = 0;
    const waits: number[] = [];
    // Held twice, then free.
    await writeWhole(file, '{"b":2}', {
      move: async (from, to) => {
        if (refused++ < 2) throw held();
        const { rename } = await import('node:fs/promises');
        await rename(from, to);
      },
      wait: async (ms) => void waits.push(ms),
    });
    expect(await readFile(file, 'utf8')).toBe('{"b":2}');
    expect(waits).toEqual([100, 200]);
    // Held for good: written in place, no temporary file left.
    await writeWhole(file, '{"c":3}', { move: async () => Promise.reject(held()), wait: async () => {} });
    expect(await readFile(file, 'utf8')).toBe('{"c":3}');
    expect(await readdir(root)).toEqual(['discs.json']);
    // Another error is no hold: it fails.
    await expect(writeWhole(file, '{}', { move: async () => Promise.reject(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })) })).rejects.toThrow('ENOSPC');
  });

  it('reads the temporary file when the rename never came about', async () => {
    const file = path.join(root, 'discs.json');
    expect(readWholeSync(file)).toBeNull();
    await writeFile(`${file}.tmp`, '{"d":4}');
    expect(readWholeSync(file)).toBe('{"d":4}');
    await writeFile(file, 'kaputt');
    expect(readWholeSync(file)).toBe('{"d":4}');
    await writeFile(file, '{"e":5}');
    await utimes(`${file}.tmp`, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    expect(readWholeSync(file)).toBe('{"e":5}');
    // A newer temporary file holds what an older agent failed to rename into place.
    await utimes(file, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    expect(readWholeSync(file)).toBe('{"d":4}');
  });
});
