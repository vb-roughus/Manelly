import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConversionJob, ConversionRequest } from '@manelly/shared';
import { discardTemp, overallProgress, PAUSE, runConversion, type ConversionContext, type ConversionResult } from './convert.js';
import { suspendProcess, type Suspender } from './suspend.js';
import { AgentError } from './errors.js';
import { pathApiFor, planOutput, type OutputPlan, type PathAccess } from './paths.js';
import type { GateCheck } from './schedule.js';
import { toolsReady, type Tools } from './tools.js';

interface StoredJob {
  job: ConversionJob;
  request: ConversionRequest;
  plan: OutputPlan;
  /** How often the agent stopped while this job ran; guards against a job that keeps crashing it. */
  restarts?: number;
}

export interface JobQueueOptions {
  dataDir: string;
  roots: string[];
  tools: () => Promise<Tools>;
  run?: (ctx: ConversionContext) => Promise<ConversionResult>;
  /** Free bytes on a volume; injectable for tests. */
  freeBytes?: ConversionContext['freeBytes'];
  /** Whether scheduled jobs may run now; without it they run like the others. */
  gate?: (running: boolean) => Promise<GateCheck>;
  /** How often the gate is checked while scheduled jobs wait or run; 0 checks only on changes (tests). */
  tickMs?: number;
  /** Tells Jellyfin about a finished conversion; resolves to whether that worked. */
  notify?: (job: ConversionJob) => Promise<boolean>;
  /** Holds and continues the running tool for a pause; injectable for tests. */
  suspend?: Suspender;
  /** Connects the network drive a path needs; on Windows, started without a logon. */
  access?: PathAccess;
  /** Pause between attempts to reach the files of a job that is to start, e.g. right after Windows started. */
  retryMs?: number;
  /** The work folder set in Manelly, for jobs that convert there. */
  workFolder?: () => string | null;
  now?: () => Date;
  log?: (message: string) => void;
}

const HISTORY_LIMIT = 50;
const JOBS_FILE = 'jobs.json';
const MAX_RESTARTS = 5;
const OPEN_GATE: GateCheck = { open: true, pause: false, reason: null, streams: null, checkedAt: new Date(0).toISOString() };

/** Runs one conversion at a time and keeps the history in jobs.json. */
export async function createJobQueue(options: JobQueueOptions) {
  const { dataDir, roots, tools, run = runConversion, freeBytes, gate = async () => OPEN_GATE, tickMs = 60_000, notify, now = () => new Date(), log = () => {} } = options;
  const suspend = options.suspend ?? suspendProcess;
  const { access, retryMs = 30_000, workFolder = () => null } = options;
  const file = join(dataDir, JOBS_FILE);
  let entries: StoredJob[] = [];
  try {
    entries = JSON.parse(await readFile(file, 'utf8')) as StoredJob[];
  } catch {
    entries = [];
  }
  // A restart (like the nightly one) interrupts the running job; it continues after its last finished step.
  for (const entry of entries) {
    const { job } = entry;
    job.scheduled ??= false;
    job.interruptions ??= 0;
    // A paused job stays paused across a restart; it continues after its last finished step once continued.
    job.paused ??= false;
    if (job.state !== 'running') continue;
    entry.restarts = (entry.restarts ?? 0) + 1;
    if (entry.restarts > MAX_RESTARTS) {
      Object.assign(job, { state: 'failed', step: null, finishedAt: now().toISOString(), error: `Der Agent wurde ${MAX_RESTARTS}-mal mitten in dieser Umwandlung beendet – sie wird nicht mehr fortgesetzt.` });
      await discardTemp(job.source, entry.plan, job.id);
    } else {
      Object.assign(job, { state: 'queued', step: null, progress: null, interruptions: job.interruptions + 1 });
    }
  }

  /** The running job, its tools right now, those of them that are held, and the next tool waiting for a continue. */
  interface Current {
    entry: StoredJob;
    controller: AbortController;
    pids: Set<number>;
    held: Set<number>;
    waiting: Array<() => void>;
    /** Holding and releasing one after the other: Windows counts suspensions, and one must not overtake the other. */
    turns: Promise<void>;
  }
  let current: Current | null = null;
  let lastGate: GateCheck | null = null;
  let checking: Promise<void> | null = null;
  let again = false;
  let stopping = false;
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

  const waitsForGate = () => entries.some(({ job }) => job.state === 'queued' && job.scheduled) || Boolean(current?.entry.job.scheduled);

  function waitReason(job: ConversionJob): string | null {
    if (job.state !== 'queued') return null;
    if (job.paused) return 'Pausiert – geht nach «Fortsetzen» beim zuletzt fertigen Schritt weiter.';
    if (job.scheduled && lastGate && !lastGate.open) return lastGate.reason;
    if (current?.entry.job.paused) return 'Wartet, bis die pausierte Umwandlung weitergeht oder abgebrochen wird.';
    if (current) return 'Wartet, bis die laufende Umwandlung fertig ist.';
    return job.scheduled && !lastGate ? 'Prüft den Zeitplan …' : null;
  }

  const view = (job: ConversionJob): ConversionJob => ({ ...job, waitReason: waitReason(job) });

  /** Looks at the schedule: starts what may start, pauses a scheduled job when somebody streams. */
  async function checkOnce() {
    try {
      if (waitsForGate()) {
        lastGate = await gate(Boolean(current?.entry.job.scheduled));
        // A job paused by hand holds nothing that a stream would need.
        if (lastGate.pause && current?.entry.job.scheduled && !current.entry.job.paused) {
          log(`Umwandlung pausiert: ${lastGate.reason ?? ''}`);
          current.controller.abort(PAUSE);
        }
      } else {
        lastGate = null;
      }
    } catch (error) {
      log(`Zeitplan konnte nicht geprüft werden: ${(error as Error).message}`);
    }
    void next();
  }

  function check(): Promise<void> {
    // A change during a check (a new job, a new schedule) gets a check of its own.
    if (checking) {
      again = true;
      return checking;
    }
    checking = (async () => {
      do {
        again = false;
        await checkOnce();
      } while (again);
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  const timer = tickMs > 0 ? setInterval(() => void check(), tickMs) : null;
  timer?.unref();

  function inTurn(running: Current, action: () => Promise<void>): Promise<void> {
    running.turns = running.turns.then(action);
    return running.turns;
  }

  /** Suspends the running tools of a paused job; when that is not possible, stops the job after its last finished step. */
  const hold = (running: Current) =>
    inTurn(running, async () => {
      if (!running.entry.job.paused) return;
      try {
        for (const pid of running.pids) {
          if (running.held.has(pid)) continue;
          await suspend(pid, 'suspend');
          running.held.add(pid);
        }
      } catch (error) {
        log(`Anhalten ging nicht (${(error as Error).message}) – die Umwandlung wird unterbrochen und macht beim Fortsetzen beim zuletzt fertigen Schritt weiter.`);
        await letGo(running);
        running.controller.abort(PAUSE);
      }
    });

  async function letGo(running: Current) {
    for (const pid of [...running.held]) {
      await suspend(pid, 'resume').catch((error: unknown) => log(`Fortsetzen ging nicht: ${(error as Error).message}`));
      running.held.delete(pid);
    }
  }

  /** Lets held tools go on; also before stopping them, which a held process would not notice. */
  const release = (running: Current) => inTurn(running, () => letGo(running));

  async function abort(running: Current, reason?: string) {
    await release(running);
    running.controller.abort(reason);
  }

  /**
   * Whether the files of a job are there for the agent; connects their network drive first. Right after Windows
   * started, the network may not be up yet: it tries again a few times before the job fails.
   */
  async function reachable(entry: StoredJob, signal: AbortSignal): Promise<string | null> {
    if (!access) return null;
    for (let attempt = 1; ; attempt++) {
      const problem =
        (await access.prepare(entry.request.source)) ??
        (await access.prepare(entry.plan.directory)) ??
        (entry.plan.work ? await access.prepare(entry.plan.work) : null);
      const there = !problem && (await stat(entry.request.source).then(() => true, () => false));
      if (there || attempt >= 4 || signal.aborted) return problem;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, retryMs);
        signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
      });
    }
  }

  async function next() {
    if (current || stopping) return;
    const entry = [...entries].reverse().find(({ job }) => job.state === 'queued' && !job.paused && (!job.scheduled || lastGate?.open));
    if (!entry) return;
    const { job } = entry;
    const controller = new AbortController();
    const running: Current = { entry, controller, pids: new Set(), held: new Set(), waiting: [], turns: Promise.resolve() };
    current = running;
    Object.assign(job, { state: 'running', startedAt: now().toISOString(), step: 'probe', progress: null });
    void save();
    log(`Umwandlung ${job.interruptions ? 'fortgesetzt' : 'gestartet'}: ${job.source}`);
    try {
      const problem = await reachable(entry, controller.signal);
      if (controller.signal.aborted) throw new AgentError(499, 'Abgebrochen.');
      if (problem) {
        // What an interrupted run left there, as far as it can be reached.
        if (job.interruptions) await discardTemp(job.source, entry.plan, job.id);
        throw new AgentError(404, problem);
      }
      const result = await run({
        jobId: job.id,
        request: entry.request,
        plan: entry.plan,
        tools: await tools(),
        signal: controller.signal,
        freeBytes,
        onProgress: (step, fraction) => {
          job.step = step;
          job.progress = overallProgress(step, fraction, Boolean(entry.plan.work));
        },
        control: {
          proceed: () =>
            job.paused && !controller.signal.aborted
              ? new Promise<void>((resolve) => {
                  running.waiting.push(resolve);
                  controller.signal.addEventListener('abort', () => resolve(), { once: true });
                })
              : Promise.resolve(),
          started: (pid) => {
            running.pids.add(pid);
            // Paused just while the tool started.
            if (job.paused) void hold(running);
          },
          ended: (pid) => {
            running.pids.delete(pid);
            running.held.delete(pid);
          },
        },
      });
      Object.assign(job, { state: 'done', step: null, progress: 1, output: result.output, backup: result.backup, warning: result.warning, finishedAt: now().toISOString() });
      log(`Umwandlung fertig: ${result.output}`);
      if (notify) job.jellyfinNotified = await notify(job).catch(() => false);
    } catch (error) {
      if (controller.signal.reason === PAUSE) {
        // Back into the queue; the temporary files stay for the next run.
        Object.assign(job, { state: 'queued', step: null, progress: null, interruptions: (job.interruptions ?? 0) + 1 });
      } else {
        const canceled = controller.signal.aborted;
        Object.assign(job, {
          state: canceled ? 'canceled' : 'failed',
          error: canceled ? null : (error as Error).message,
          log: (error as { log?: string | null }).log ?? null,
          finishedAt: now().toISOString(),
        });
        log(canceled ? `Umwandlung abgebrochen: ${job.source}` : `Umwandlung fehlgeschlagen: ${(error as Error).message}`);
      }
    } finally {
      current = null;
      await save();
      void next();
    }
  }

  // Jobs from before a restart continue.
  void check();

  return {
    list(): ConversionJob[] {
      return entries.map((entry) => view(entry.job));
    },

    get(id: string): ConversionJob {
      return view(find(id).job);
    },

    /** The last look at the schedule; null while no scheduled job waits or runs. */
    gate(): GateCheck | null {
      return lastGate;
    },

    /** Looks at the schedule now, e.g. after it changed. */
    check,

    /** Checks the request completely before accepting it, so mistakes show up in Manelly right away. */
    async add(request: ConversionRequest): Promise<ConversionJob> {
      if (!request || typeof request.source !== 'string' || !request.output) throw new AgentError(400, 'Unvollständiger Auftrag.');
      if (!toolsReady(await tools())) {
        throw new AgentError(503, 'Es fehlen Werkzeuge (ffmpeg, dovi_tool oder mkvmerge) – siehe Agent-Status in Manelly.');
      }
      const plan = await planOutput(request, roots, process.platform, access, workFolder());
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
        scheduled: request.scheduled === true,
        interruptions: 0,
        paused: false,
        work: plan.work ?? null,
      };
      entries.unshift({ job, request, plan });
      await save();
      void (job.scheduled ? check() : next());
      return view(job);
    },

    /** Starts a scheduled job without waiting for the schedule. */
    startNow(id: string): ConversionJob {
      const { job } = find(id);
      if (job.state !== 'queued') throw new AgentError(409, 'Diese Umwandlung wartet nicht.');
      job.scheduled = false;
      void save();
      void next();
      return view(job);
    },

    cancel(id: string): ConversionJob {
      const entry = find(id);
      const { job } = entry;
      if (job.state === 'queued') {
        Object.assign(job, { state: 'canceled', finishedAt: now().toISOString() });
        // An interrupted job left its temporary files for the next run.
        if (job.interruptions) void discardTemp(job.source, entry.plan, job.id);
        void save();
      } else if (job.state === 'running' && current?.entry === entry) {
        void abort(current);
      }
      return view(job);
    },

    /**
     * Pauses a conversion: holds the running tool where it is, so it goes on right there; where the system does not
     * allow that, stops it after its last finished step. A queued one waits until it is continued.
     */
    async pause(id: string): Promise<ConversionJob> {
      const entry = find(id);
      const { job } = entry;
      if (job.state !== 'queued' && job.state !== 'running') throw new AgentError(409, 'Diese Umwandlung läuft nicht mehr.');
      if (!job.paused) {
        job.paused = true;
        void save();
        if (current?.entry === entry) {
          log(`Umwandlung pausiert: ${job.source}`);
          await hold(current);
        }
      }
      return view(job);
    },

    /** Continues a paused conversion where its tool was held, or after its last finished step. */
    async resume(id: string): Promise<ConversionJob> {
      const entry = find(id);
      const { job } = entry;
      if (job.paused) {
        job.paused = false;
        if (current?.entry === entry) {
          await release(current);
          for (const go of current.waiting.splice(0)) go();
          log(`Umwandlung fortgesetzt: ${job.source}`);
        }
        void save();
        void next();
      }
      return view(job);
    },

    async remove(id: string): Promise<void> {
      const { job } = find(id);
      if (job.state === 'queued' || job.state === 'running') throw new AgentError(409, 'Eine laufende Umwandlung zuerst abbrechen.');
      entries = entries.filter((entry) => entry.job.id !== id);
      await save();
    },

    /** Pauses the running conversion, so it continues after the next start, and waits for the history to be saved. */
    async stop(): Promise<void> {
      stopping = true;
      if (timer) clearInterval(timer);
      if (current) await abort(current, PAUSE);
      while (current) await new Promise((resolve) => setTimeout(resolve, 50));
      await saving;
    },
  };
}

export type JobQueue = Awaited<ReturnType<typeof createJobQueue>>;
