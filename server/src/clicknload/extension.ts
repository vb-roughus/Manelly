import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createZip } from '../zip.js';

/**
 * The browser extension from the folder extension/ as a ZIP, with the address of this Manelly in manelly.json – the
 * address the browser that downloads it uses, so it works from there without setting anything.
 */
export async function extensionZip(directory: string, manellyUrl: string): Promise<Buffer> {
  const files: Array<{ path: string; content: Buffer }> = [];
  async function add(folder: string, prefix: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'manelly.json') continue;
      if (entry.isDirectory()) await add(join(folder, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile()) files.push({ path: `manelly-clicknload/${prefix}${entry.name}`, content: await readFile(join(folder, entry.name)) });
    }
  }
  await add(directory, '');
  files.push({ path: 'manelly-clicknload/manelly.json', content: Buffer.from(`${JSON.stringify({ url: manellyUrl }, null, 2)}\n`) });
  return createZip(files);
}
