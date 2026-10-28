import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { metered } from '../src/convert.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'manelly-rate-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('step rate', () => {
  it('reports how fast the written file grows, and nothing once the step is over', async () => {
    const file = path.join(dir, 'video.hevc');
    const rates: Array<number | null> = [];
    // A tool that writes 100 KB every 20 ms: about 5 MB/s.
    const step = async () => {
      await writeFile(file, '');
      for (let i = 0; i < 25; i++) {
        await appendFile(file, Buffer.alloc(100 * 1024));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return 'done';
    };
    expect(await metered(file, { onRate: (rate) => rates.push(rate) }, step, 100)).toBe('done');
    expect(rates.some((rate) => rate !== null && rate > 1024 * 1024)).toBe(true);
    expect(rates.at(-1)).toBeNull();
  });
});
