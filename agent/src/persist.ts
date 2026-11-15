import { readFileSync, statSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';

/** Errors with which Windows refuses a rename while a virus scanner or the indexer holds the new file. */
const HELD = new Set(['EPERM', 'EACCES', 'EBUSY']);
const ATTEMPTS = 8;

/**
 * Writes a file whole: a temporary file first, then renamed over the old one, so a crash never leaves half a file. On
 * Windows a virus scanner or the indexer may hold the new file for a moment: the rename is tried again for a few
 * seconds, and as a last resort the file is written in place – it is kept either way.
 */
export async function writeWhole(
  file: string,
  content: string,
  {
    mode,
    move = rename,
    wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: { mode?: number; move?: (from: string, to: string) => Promise<void>; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<void> {
  const temp = `${file}.tmp`;
  const options = mode === undefined ? {} : { mode };
  await writeFile(temp, content, options);
  for (let attempt = 1; ; attempt++) {
    try {
      await move(temp, file);
      return;
    } catch (error) {
      if (!HELD.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      if (attempt >= ATTEMPTS) break;
      await wait(50 * 2 ** attempt);
    }
  }
  await writeFile(file, content, options);
  await rm(temp, { force: true }).catch(() => {});
}

/**
 * What writeWhole wrote last: the file – or its temporary file when that is newer, because the rename never came about
 * (an agent before 0.43.0 gave up on it without a word). Null when there is neither, or neither is whole JSON.
 */
export function readWholeSync(file: string): string | null {
  let best: { content: string; at: number } | null = null;
  for (const candidate of [file, `${file}.tmp`]) {
    try {
      const content = readFileSync(candidate, 'utf8');
      JSON.parse(content);
      const at = statSync(candidate).mtimeMs;
      if (!best || at > best.at) best = { content, at };
    } catch {
      // Missing or broken: the other one.
    }
  }
  return best?.content ?? null;
}
