import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeLink, KnowledgeLinkInput } from '@manelly/shared';
import { ConfigError } from './config.js';
import { AppError } from './errors.js';

export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 300;
export const MAX_URL = 2000;
/** More would not fit a menu anyway. */
const MAX_LINKS = 200;

/** The links of the menu «Links», in the order they were added. */
export interface LinksStore {
  list(): Promise<KnowledgeLink[]>;
  add(input: KnowledgeLinkInput): Promise<KnowledgeLink>;
  update(id: string, input: KnowledgeLinkInput): Promise<KnowledgeLink>;
  remove(id: string): Promise<void>;
}

/** Trimmed, and only a web address: the browser opens it, so nothing like javascript: may get in. */
export function checkLink(input: KnowledgeLinkInput): KnowledgeLinkInput {
  const name = input.name.trim();
  const description = input.description.trim();
  const url = input.url.trim();
  if (!name) throw new AppError('BAD_REQUEST', 'Der Link braucht einen Namen.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('BAD_REQUEST', `«${url}» ist keine gültige Adresse.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new AppError('BAD_REQUEST', 'Nur Adressen mit http:// oder https:// gehen.');
  return { name, description, url: parsed.href };
}

/** Keeps the links in memory and, with `persist`, writes each change through. */
export function createLinksStore(initial: KnowledgeLink[] = [], persist: (links: KnowledgeLink[]) => Promise<void> = async () => {}): LinksStore {
  let links = initial;
  // One change at a time, so two quick saves cannot overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  const change = <T>(apply: (current: KnowledgeLink[]) => { next: KnowledgeLink[]; result: T }): Promise<T> => {
    const run = queue.then(async () => {
      const { next, result } = apply(links);
      await persist(next);
      links = next;
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };
  const find = (current: KnowledgeLink[], id: string) => {
    const index = current.findIndex((link) => link.id === id);
    if (index < 0) throw new AppError('NOT_FOUND', 'Diesen Link gibt es nicht (mehr).');
    return index;
  };

  return {
    list: async () => links,
    add: (input) =>
      change((current) => {
        if (current.length >= MAX_LINKS) throw new AppError('BAD_REQUEST', `Mehr als ${MAX_LINKS} Links gehen nicht.`);
        const link = { id: randomUUID(), ...checkLink(input) };
        return { next: [...current, link], result: link };
      }),
    update: (id, input) =>
      change((current) => {
        const index = find(current, id);
        const link = { id, ...checkLink(input) };
        return { next: current.map((entry, at) => (at === index ? link : entry)), result: link };
      }),
    remove: (id) =>
      change((current) => {
        find(current, id);
        return { next: current.filter((link) => link.id !== id), result: undefined };
      }),
  };
}

interface LinksFile {
  version: 1;
  links: KnowledgeLink[];
}

const isLink = (value: unknown): value is KnowledgeLink => {
  const link = value as Partial<KnowledgeLink> | null;
  return typeof link?.id === 'string' && typeof link.name === 'string' && typeof link.description === 'string' && typeof link.url === 'string';
};

/** The links in links.json of the data folder. */
export async function createFileLinksStore(dataDir: string): Promise<LinksStore> {
  const file = join(dataDir, 'links.json');
  let initial: KnowledgeLink[] = [];
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<LinksFile>;
    initial = Array.isArray(parsed.links) ? parsed.links.filter(isLink) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ConfigError(`${file} ist beschädigt (kein gültiges JSON). Lösche die Datei – die Links sind dann weg.`);
    }
  }
  return createLinksStore(initial, async (links) => {
    await mkdir(dataDir, { recursive: true });
    const content: LinksFile = { version: 1, links };
    // Write next to the target and rename, so a crash never leaves a half-written file.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(content, null, 2)}\n`);
    await rename(tmp, file);
  });
}
