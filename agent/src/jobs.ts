import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConversionJob, ConversionRequest } from '@manelly/shared';
import { overallProgress, runConversion, type ConversionContext, type ConversionResult } from './convert.js';
import { AgentError } from './errors.js';
import { pathApiFor, planOutput, type OutputPlan } from './paths.js';
import { toolsReady, type Tools } from './tools.js';

interface StoredJob {
  job: ConversionJob;
  request: ConversionRequest;
  plan: OutputPlan;
}

export interface JobQueueOptions {
  dataDir: string;
  roots: string[];
  tools: () => Promise<Tools>;
  run?: (ctx: ConversionContext) => Promise<ConversionResult>;
  /** Free bytes on a volume; injectable for tests. */
  freeBytes?: ConversionContext['freeBytes'];
  now?: () => Date;
  log?: (message: string) => void;
}

const HISTORY_LIMIT = 50;
const JOBS_FILE = 'jobs.json';

/** Runs one conversion at a time and keeps the history in jobs.json. */
export async function createJobQueue(options: JobQueueOptions) {
  const { dataDir, roots, tools, run = runConversion, freeBytes, now = () => new Date(), log = () => {} } = options;
  const file = join(dataDir, JOBS_FILE);
  let entries: StoredJob[] = [];
  try {
    entries = JSON.parse(await readFile(file, 'utf8')) as StoredJob[];
  } catch {
    entries = [];
  }
  // Whatever was running when the agent stopped did not finish.
  for (const { job } of entries) {
    if (job.state === 'queued' || job.state === 'running') {
      Object.assign(job, { state: 'failed', step: null, finishedAt: now().toISOString(), error: 'Der Agent wurde beendet, bevor die Umwandlung fertig war.' });
    }
  }

  let current: { id: string; controller: AbortController } | null = null;
  let saving = Promise.resolve();

  function save() {
    // Serialize writes and replace the file atomically.
    saving = saving.then(async () => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(entries.slice(0, HISTORY_LIMIT), null, 2));
      await rename(`${file}.tmp`, file);
    }).catch((error: unknown) => log(`jobs.json konnte nicht gespeichert werden: ${(error as Error).message}`));
    return saving;
  }

  function find(id: string): StoredJob {
    const entry = entries.find((candidate) => candidate.job.id === id);
    if (!entry) throw new AgentError(404, 'Diese Umwandlung gibt es nicht.');
    return entry;
  }

  async function next() {
    if (current) return;
    const entry = [...entries].reverse().find((candidate) => candidate.job.state === 'queued');
    if (!entry) return;
    const { job } = entry;
    const controller = new AbortController();
    current = { id: job.id, controller };
    Object.assign(job, { state: 'running', startedAt: now().toISOString(), step: 'probe', progress: null });
    void save();
    log(`Umwandlung gestartet: ${job.source}`);
    try {
      const result = await run({
        jobId: job.id,
        request: entry.request,
        plan: entry.plan,
        tools: await tools(),
        signal: controller.signal,
        freeBytes,
        onProgress: (step, fraction) => {
          job.step = step;
          job.progress = overallProgress(step, fraction);
        },
      });
      Object.assign(job, { state: 'done', step: null, progress: 1, output: result.output, backup: result.backup, warning: result.warning });
      log(`Umwandlung fertig: ${result.output}`);
    } catch (error) {
      const canceled = controller.signal.aborted;
      Object.assign(job, {
        state: canceled ? 'canceled' : 'failed',
        error: canceled ? null : (error as Error).message,
        log: (error as { log?: string | null }).log ?? null,
      });
      log(canceled ? `Umwandlung abgebrochen: ${job.source}` : `Umwandlung fehlgeschlagen: ${(error as Error).message}`);
    } finally {
      job.finishedAt = now().toISOString();
      current = null;
      await save();
      void next();
    }
  }

  return {
    list(): ConversionJob[] {
      return entries.map((entry) => entry.job);
    },

    get(id: string): ConversionJob {
      return find(id).job;
    },

    /** Checks the request completely before accepting it, so mistakes show up in Manelly right away. */
    async add(request: ConversionRequest): Promise<ConversionJob> {
      if (!request || typeof request.source !== 'string' || !request.output) throw new AgentError(400, 'Unvollständiger Auftrag.');
      if (!toolsReady(await tools())) {
        throw new AgentError(503, 'Es fehlen Werkzeuge (ffmpeg, dovi_tool oder mkvmerge) – siehe Agent-Status in Manelly.');
      }
      const plan = await planOutput(request, roots);
      // Two jobs must not write the same file.
      const busy = entries.some(({ job }) => (job.state === 'queued' || job.state === 'running') && (job.output === plan.output || job.source === request.source));
      if (busy) throw new AgentError(409, 'Für diese Datei läuft schon eine Umwandlung.');

      const api = pathApiFor(request.source);
      const job: ConversionJob = {
        id: randomUUID(),
        title: request.title || api.basename(request.source),
        source: request.source,
        mode: request.output.mode,
        output: plan.output,
        backup: plan.backup,
        state: 'queued',
        step: null,
        progress: null,
        createdAt: now().toISOString(),
        startedAt: null,
        finishedAt: null,
        error: null,
        log: null,
        warning: null,
      };
      entries.unshift({ job, request, plan });
      await save();
      void next();
      return job;
    },

    cancel(id: string): ConversionJob {
      const { job } = find(id);
      if (job.state === 'queued') {
        Object.assign(job, { state: 'canceled', finishedAt: now().toISOString() });
        void save();
      } else if (job.state === 'running' && current?.id === id) {
        current.controller.abort();
      }
      return job;
    },

    async remove(id: string): Promise<void> {
      const { job } = find(id);
      if (job.state === 'queued' || job.state === 'running') throw new AgentError(409, 'Eine laufende Umwandlung zuerst abbrechen.');
      entries = entries.filter((entry) => entry.job.id !== id);
      await save();
    },

    /** Stops the running conversion (its temporary files are removed) and waits for the history to be saved. */
    async stop(): Promise<void> {
      current?.controller.abort();
      while (current) await new Promise((resolve) => setTimeout(resolve, 50));
      await saving;
    },
  };
}

export type JobQueue = Awaited<ReturnType<typeof createJobQueue>>;
