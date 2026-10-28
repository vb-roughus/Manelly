import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchivedOriginal } from '@manelly/shared';
import { AgentError } from './errors.js';

const ORIGINALS_FILE = 'originals.json';

/**
 * The originals that conversions in the work folder replaced, kept in its folder "Originale". The agent remembers
 * which files it put there – it lists nothing, and deletes only these.
 */
export async function createOriginals(dataDir: string, now: () => Date = () => new Date()) {
  const file = join(dataDir, ORIGINALS_FILE);
  let entries: ArchivedOriginal[] = [];
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (Array.isArray(stored)) entries = stored.filter((entry): entry is ArchivedOriginal => typeof entry?.id === 'string' && typeof entry.path === 'string');
  } catch {
    entries = [];
  }
  let saving = Promise.resolve();

  function save() {
    saving = saving.then(async () => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(entries, null, 2));
      await rename(`${file}.tmp`, file);
    });
    return saving;
  }

  return {
    async add(entry: Omit<ArchivedOriginal, 'id' | 'archivedAt'>): Promise<void> {
      entries.unshift({ id: randomUUID(), archivedAt: now().toISOString(), ...entry });
      await save();
    },

    /** Newest first; one whose file was deleted by hand is forgotten. */
    async list(): Promise<ArchivedOriginal[]> {
      const there = await Promise.all(entries.map((entry) => stat(entry.path).then((info) => info.isFile(), () => false)));
      if (there.includes(false)) {
        entries = entries.filter((_, index) => there[index]);
        await save();
      }
      return entries;
    },

    /** Deletes the file for good; Manelly asks before. */
    async remove(id: string): Promise<void> {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) throw new AgentError(404, 'Dieses Original gibt es nicht (mehr).');
      try {
        await rm(entry.path, { force: true });
      } catch (error) {
        throw new AgentError(500, `${entry.path} liess sich nicht löschen: ${(error as Error).message}`);
      }
      entries = entries.filter((candidate) => candidate.id !== id);
      await save();
    },
  };
}

export type Originals = Awaited<ReturnType<typeof createOriginals>>;
