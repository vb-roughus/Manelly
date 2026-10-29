import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import type { CopyThrottle, ExtractedMove } from '@manelly/shared';
import { formatBytes, pace } from './convert.js';
import { AgentError } from './errors.js';
import { measure, resolveExtracted } from './extracted.js';
import { isWithin, pathApiFor } from './paths.js';

const CHUNK_BYTES = 8 * 1024 * 1024;
/** Finished moves shown at most. */
const KEEP_FINISHED = 20;
/** A copy on its way; an interrupted one is cleared before the next try. */
const PART_SUFFIX = '.manelly-part';
/** The rate is averaged over this long, so writing in big chunks still shows a steady figure. */
const RATE_WINDOW_MS = 6000;

interface Source {
  path: string;
  full: string;
  bytes: number;
}

interface Job {
  view: ExtractedMove;
  sources: Source[];
  copying: boolean;
  samples: Array<{ t: number; bytes: number }>;
}

export interface MoverOptions {
  /** The copy limit of the moment, as for conversions; null: full speed. */
  copyLimit?: () => CopyThrottle | null;
  /** Tells Jellyfin about the new paths, so it picks them up right away. */
  notify?: (updates: Array<{ Path: string; UpdateType: 'Created' }>) => Promise<unknown>;
  log?: (message: string) => void;
  /** For tests: the first try, a plain rename. */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Moves entries of the extraction folder into a library folder, one move after the other. On the same disk a move is a
 * rename; else everything is copied under a temporary name (as fast as the copy limit allows), renamed, and only then
 * deleted at the source – an interrupted move leaves the source as it was.
 */
export function createMover(options: MoverOptions = {}) {
  const jobs: Job[] = [];
  let working = false;

  const exists = (path: string) => lstat(path).then(() => true, () => false);

  function progress(job: Job, bytes: number) {
    job.view.bytesDone += bytes;
    const now = Date.now();
    job.samples.push({ t: now, bytes: job.view.bytesDone });
    while (job.samples.length > 2 && now - job.samples[0]!.t > RATE_WINDOW_MS) job.samples.shift();
  }

  async function copyFile(from: string, to: string, job: Job) {
    const reader = createReadStream(from, { highWaterMark: CHUNK_BYTES });
    const writer = createWriteStream(to, { flags: 'wx' });
    const limit = () => options.copyLimit?.()?.bytesPerSecond ?? null;
    try {
      let since = Date.now();
      for await (const chunk of reader as AsyncIterable<Buffer>) {
        if (!writer.write(chunk)) await once(writer, 'drain');
        progress(job, chunk.length);
        await pace(chunk.length, since, limit, new AbortController().signal);
        since = Date.now();
      }
      writer.end();
      await finished(writer);
    } finally {
      reader.destroy();
      writer.destroy();
    }
    const [source, copy] = await Promise.all([lstat(from), lstat(to)]);
    if (source.size !== copy.size) throw new AgentError(500, `Die Kopie von ${from} ist unvollständig (${formatBytes(copy.size)} von ${formatBytes(source.size)}).`);
  }

  async function copyTree(from: string, to: string, job: Job) {
    const info = await lstat(from);
    if (info.isFile()) return copyFile(from, to, job);
    if (!info.isDirectory()) return;
    await mkdir(to);
    const [fromApi, toApi] = [pathApiFor(from), pathApiFor(to)];
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isFile()) await copyTree(fromApi.join(from, entry.name), toApi.join(to, entry.name), job);
    }
  }

  async function moveOne(job: Job, source: Source): Promise<string> {
    const name = pathApiFor(source.full).basename(source.full);
    const destination = pathApiFor(job.view.target).join(job.view.target, name);
    if (await exists(destination)) throw new AgentError(409, `«${name}» gibt es in ${job.view.label} schon.`);
    try {
      await (options.rename ?? rename)(source.full, destination);
      progress(job, source.bytes);
      return destination;
    } catch (error) {
      // Another disk: copy, then delete.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    }
    const part = `${destination}${PART_SUFFIX}`;
    const before = job.view.bytesDone;
    await rm(part, { recursive: true, force: true });
    job.copying = true;
    try {
      await copyTree(source.full, part, job);
      await rename(part, destination);
    } catch (error) {
      job.view.bytesDone = before;
      await rm(part, { recursive: true, force: true }).catch(() => {});
      throw error;
    } finally {
      job.copying = false;
      job.samples = [];
    }
    await rm(source.full, { recursive: true, force: true });
    return destination;
  }

  async function execute(job: Job) {
    job.view.state = 'running';
    const created: string[] = [];
    for (const source of job.sources) {
      try {
        created.push(await moveOne(job, source));
        options.log?.(`«${source.path}» nach ${job.view.target} verschoben`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        job.view.problems.push({ path: source.path, error: message });
        options.log?.(`«${source.path}» nicht verschoben: ${message}`);
      }
    }
    if (created.length > 0) await options.notify?.(created.map((path) => ({ Path: path, UpdateType: 'Created' as const }))).catch(() => {});
    job.view.state = created.length === 0 ? 'failed' : 'done';
    job.view.finishedAt = new Date().toISOString();
  }

  async function work() {
    if (working) return;
    working = true;
    try {
      for (let job = jobs.find((entry) => entry.view.state === 'queued'); job; job = jobs.find((entry) => entry.view.state === 'queued')) await execute(job);
    } finally {
      working = false;
    }
    const finishedJobs = jobs.filter((job) => job.view.finishedAt);
    for (const old of finishedJobs.slice(0, Math.max(0, finishedJobs.length - KEEP_FINISHED))) jobs.splice(jobs.indexOf(old), 1);
  }

  function view(job: Job): ExtractedMove {
    const [first, last] = [job.samples[0], job.samples.at(-1)];
    const rate = job.copying && first && last && last.t > first.t ? ((last.bytes - first.bytes) * 1000) / (last.t - first.t) : null;
    return { ...job.view, problems: [...job.view.problems], bytesPerSecond: rate, copyThrottle: job.copying ? (options.copyLimit?.() ?? null) : null };
  }

  const busy = () => jobs.find((job) => job.view.state === 'running' || job.view.state === 'queued') ?? null;

  return {
    /**
     * Queues moving `paths` of the extraction folder `directory` into `target`, a folder the server checked. A folder
     * and something in it count once; nothing can move into itself.
     */
    async add(directory: string, paths: string[], target: string, label: string): Promise<ExtractedMove> {
      const fulls = paths.map((path) => ({ path, full: resolveExtracted(directory, path) }));
      const outer = fulls.filter((entry) => !fulls.some((other) => other !== entry && other.full !== entry.full && isWithin(entry.full, other.full, pathApiFor(other.full))));
      const unique = outer.filter((entry, index) => outer.findIndex((other) => other.full === entry.full) === index);
      const sources: Source[] = [];
      for (const { path, full } of unique) {
        if (isWithin(target, full, pathApiFor(full))) throw new AgentError(400, `«${path}» kann nicht in sich selbst verschoben werden.`);
        const info = await lstat(full).catch(() => null);
        if (!info || !(info.isFile() || info.isDirectory())) throw new AgentError(404, `«${path}» gibt es im Entpack-Ordner nicht (mehr).`);
        sources.push({ path, full, bytes: info.isFile() ? info.size : (await measure(full, pathApiFor(full))).bytes });
      }
      const job: Job = {
        view: {
          id: randomUUID(),
          paths: sources.map((source) => source.path),
          target,
          label,
          state: 'queued',
          bytesTotal: sources.reduce((sum, source) => sum + source.bytes, 0),
          bytesDone: 0,
          bytesPerSecond: null,
          copyThrottle: null,
          problems: [],
          createdAt: new Date().toISOString(),
          finishedAt: null,
        },
        sources,
        copying: false,
        samples: [],
      };
      jobs.push(job);
      void work();
      return view(job);
    },

    /** Newest first. */
    list: (): ExtractedMove[] => jobs.map(view).reverse(),

    /** The move running or waiting, if any – a restart would interrupt it. */
    running: (): ExtractedMove | null => {
      const job = busy();
      return job && view(job);
    },

    /** Resolves once nothing is moved any more. */
    async idle(): Promise<void> {
      while (busy()) await new Promise((resolve) => setTimeout(resolve, 1000));
    },
  };
}

export type Mover = ReturnType<typeof createMover>;
