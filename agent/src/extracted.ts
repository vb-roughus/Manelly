import { lstat, readdir, rm, rmdir, unlink } from 'node:fs/promises';
import type { ExtractedDeleted, ExtractedEntry, ExtractedFolder, ExtractedSamples, ExtractedSamplesDeleted } from '@manelly/shared';
import { AgentError } from './errors.js';
import { isWithin, pathApiFor, type PathApi } from './paths.js';

/** Files counted below one folder at most; a folder with more shows "at least". */
const MAX_FILES = 20_000;
/** Entries listed in one folder at most. */
const MAX_ENTRIES = 2_000;

/** The names in "a/b"; refuses anything that could lead out of the extraction folder. */
function namesOf(relative: string): string[] {
  if (relative === '') return [];
  const names = relative.split('/');
  if (relative.length > 2000 || names.some((name) => !name || name === '.' || name === '..' || /[\\\u0000]/.test(name))) {
    throw new AgentError(400, 'Ungültiger Ordner im Entpack-Ordner.');
  }
  return names;
}

const updatedAt = (info: { mtimeMs: number; birthtimeMs: number }) => new Date(Math.max(info.mtimeMs, info.birthtimeMs || 0)).toISOString();

/** An entry of the extraction folder as a full path – never the folder itself, and nothing outside it. */
export function resolveExtracted(directory: string, relative: string): string {
  const names = namesOf(relative);
  const api = pathApiFor(directory);
  const full = api.join(directory, ...names);
  if (names.length === 0 || !isWithin(full, directory, api)) throw new AgentError(400, 'Einen Eintrag im Entpack-Ordner erwartet.');
  return full;
}

/** Size and number of the files below a folder; links are not followed, counting stops at MAX_FILES. */
export async function measure(folder: string, api: PathApi): Promise<{ bytes: number; files: number; complete: boolean }> {
  let bytes = 0;
  let files = 0;
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = api.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        files++;
        bytes += await lstat(full).then((info) => info.size, () => 0);
        if (files >= MAX_FILES) return { bytes, files, complete: false };
      }
    }
  }
  return { bytes, files, complete: true };
}

/**
 * What lies in the folder JDownloader extracts into, or in a folder below it. Only that folder is read – Manelly names
 * it, nothing else is searched.
 */
export async function listExtracted(directory: string | null, relative: string, freeBytes: (directory: string) => Promise<number | null>): Promise<ExtractedFolder> {
  const names = namesOf(relative);
  if (!directory) return { directory: null, path: '', entries: [], freeBytes: null, error: null };
  const api = pathApiFor(directory);
  const folder = api.join(directory, ...names);
  if (!isWithin(folder, directory, api)) throw new AgentError(400, 'Ungültiger Ordner im Entpack-Ordner.');

  let dirents;
  try {
    dirents = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'Fehler';
    if (names.length > 0) throw new AgentError(404, `Den Ordner «${names.join('/')}» gibt es im Entpack-Ordner nicht (mehr).`);
    const reason = code === 'ENOENT' ? `Den Entpack-Ordner ${directory} gibt es auf dem Server nicht (mehr).` : `Den Entpack-Ordner ${directory} kann der Agent nicht lesen (${code}).`;
    return { directory, path: '', entries: [], freeBytes: null, error: reason };
  }

  const entries: ExtractedEntry[] = [];
  for (const dirent of dirents.slice(0, MAX_ENTRIES)) {
    if (!dirent.isDirectory() && !dirent.isFile()) continue;
    const full = api.join(folder, dirent.name);
    const info = await lstat(full).catch(() => null);
    if (!info) continue;
    const path = [...names, dirent.name].join('/');
    if (dirent.isDirectory()) {
      const { bytes, files, complete } = await measure(full, api);
      entries.push({ name: dirent.name, path, kind: 'directory', bytes, files, complete, updatedAt: updatedAt(info) });
    } else {
      entries.push({ name: dirent.name, path, kind: 'file', bytes: info.size, files: null, complete: true, updatedAt: updatedAt(info) });
    }
  }
  // What JDownloader just extracted comes first; inside a folder, the names give the order (episodes, parts).
  entries.sort(
    names.length === 0
      ? (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)
      : (a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) || a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }),
  );
  return { directory, path: names.join('/'), entries, freeBytes: names.length === 0 ? await freeBytes(directory) : null, error: null };
}

/** A sample by its name: "sample.mkv", "dune-2160p-sample.mkv", "Sample-Dune.mkv". */
const SAMPLE = /sample/i;
/** A folder that only held samples, emptied by deleting them. */
const SAMPLE_FOLDER = /^samples?$/i;

/** Every file with "sample" in its name, on all levels of the extraction folder; links are not followed. */
export async function findSamples(directory: string): Promise<ExtractedSamples> {
  const api = pathApiFor(directory);
  const samples: ExtractedSamples['samples'] = [];
  const pending: Array<{ full: string; names: string[] }> = [{ full: directory, names: [] }];
  let seen = 0;
  while (pending.length > 0 && seen < MAX_FILES) {
    const { full, names } = pending.pop()!;
    for (const entry of await readdir(full, { withFileTypes: true }).catch(() => [])) {
      const path = api.join(full, entry.name);
      if (entry.isDirectory()) {
        pending.push({ full: path, names: [...names, entry.name] });
      } else if (entry.isFile()) {
        seen++;
        if (SAMPLE.test(entry.name)) samples.push({ path: [...names, entry.name].join('/'), bytes: await lstat(path).then((info) => info.size, () => 0) });
      }
    }
  }
  samples.sort((a, b) => a.path.localeCompare(b.path, 'de', { numeric: true, sensitivity: 'base' }));
  return { samples };
}

/** Deletes the given samples – only files with "sample" in the name – and a sample folder they leave empty. */
export async function deleteSamples(directory: string, paths: string[]): Promise<ExtractedSamplesDeleted> {
  const api = pathApiFor(directory);
  const result: ExtractedSamplesDeleted = { deleted: [], problems: [] };
  for (const path of paths) {
    try {
      const full = resolveExtracted(directory, path);
      if (!SAMPLE.test(api.basename(full))) throw new AgentError(400, 'Kein Sample – im Namen fehlt «sample».');
      const info = await lstat(full).catch(() => null);
      if (!info?.isFile()) throw new AgentError(404, 'Die Datei gibt es nicht (mehr).');
      await unlink(full);
      result.deleted.push(path);
      const parent = api.dirname(full);
      if (api.resolve(parent) !== api.resolve(directory) && SAMPLE_FOLDER.test(api.basename(parent)) && (await readdir(parent).catch(() => ['?'])).length === 0) await rmdir(parent).catch(() => {});
    } catch (error) {
      result.problems.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** "a/b" is "a" itself or lies in it. */
const within = (inner: string, outer: string) => inner === outer || inner.startsWith(`${outer}/`);

/**
 * Deletes entries of the extraction folder – a folder with all that is in it – for good, without a recycle bin. A
 * folder and something in it count once; what is being moved (`moving`, as paths in the folder) stays.
 */
export async function deleteExtracted(directory: string, paths: string[], moving: readonly string[] = []): Promise<ExtractedDeleted> {
  const result: ExtractedDeleted = { deleted: [], problems: [] };
  const unique = [...new Set(paths)];
  for (const path of unique.filter((candidate) => !unique.some((other) => other !== candidate && within(candidate, other)))) {
    try {
      const full = resolveExtracted(directory, path);
      if (moving.some((busy) => within(busy, path) || within(path, busy))) throw new AgentError(409, 'Wird gerade verschoben – erst danach löschen.');
      const info = await lstat(full).catch(() => null);
      if (!info) throw new AgentError(404, 'Gibt es im Entpack-Ordner nicht (mehr).');
      // A link goes, not what it points to.
      await rm(full, { recursive: info.isDirectory() });
      result.deleted.push(path);
    } catch (error) {
      result.problems.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
