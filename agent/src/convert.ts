import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, rmdir, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { constants as osConstants, setPriority } from 'node:os';
import { finished } from 'node:stream/promises';
import type { ConversionRequest, ConversionStep } from '@manelly/shared';
import { AgentError } from './errors.js';
import { pathApiFor, TEMP_FOLDER_PREFIX, type OutputPlan } from './paths.js';
import type { Tools } from './tools.js';

export interface ConversionContext {
  jobId: string;
  request: ConversionRequest;
  plan: OutputPlan;
  tools: Tools;
  signal: AbortSignal;
  onProgress: (step: ConversionStep, progress: number | null) => void;
  /** Injectable for tests: free bytes on the volume of `directory`. */
  freeBytes?: (directory: string) => Promise<number | null>;
  /** Lets the job pause: it learns which tool runs, and holds the next one back while paused. */
  control?: ToolControl;
}

/** How a paused job holds its tools: the running one is suspended, the next one waits. */
export interface ToolControl {
  /** Resolves once the job may go on: at once, or when it is continued or aborted. */
  proceed(): Promise<void>;
  started(pid: number): void;
  ended(pid: number): void;
}

export interface ConversionResult {
  output: string;
  backup: string | null;
  warning: string | null;
}

// Share of the whole job per step, roughly by how much data each step moves.
const STEP_SPAN: Record<ConversionStep, [number, number]> = {
  fetch: [0, 0],
  probe: [0, 0.01],
  extract: [0.01, 0.4],
  convert: [0.4, 0.7],
  mux: [0.7, 0.98],
  store: [0.98, 0.98],
  finalize: [0.98, 1],
};
// In a work folder on a local disk: copying over the network takes about as long as all the steps there together.
const STAGED_SPAN: Record<ConversionStep, [number, number]> = {
  fetch: [0, 0.25],
  probe: [0.25, 0.26],
  extract: [0.26, 0.42],
  convert: [0.42, 0.56],
  mux: [0.56, 0.72],
  store: [0.72, 0.98],
  finalize: [0.98, 1],
};
// Peak usage: the extracted and the converted video stream exist side by side.
const SPACE_FACTOR = 2.1;
// In the work folder the copy of the original comes on top; at the target only the result is copied to.
const WORK_SPACE_FACTOR = 3.1;
const TARGET_SPACE_FACTOR = 1.05;
const COPY_CHUNK_BYTES = 8 * 1024 * 1024;
/** Abort reason for a pause: the temporary files stay, and the next run continues after the last finished step. */
export const PAUSE = 'manelly:pause';

/** At the target: the temporary files of a conversion there, or the copy of the result from the work folder. */
export function tempFolderFor(source: string, plan: OutputPlan, jobId: string): string {
  return pathApiFor(source).join(plan.directory, `${TEMP_FOLDER_PREFIX}${jobId}`);
}

/** The job's own folder in the work folder; null when it converts where the files are. */
export function workFolderFor(plan: OutputPlan, jobId: string): string | null {
  return plan.work ? pathApiFor(plan.work).join(plan.work, `${TEMP_FOLDER_PREFIX}${jobId}`) : null;
}

export function overallProgress(step: ConversionStep, fraction: number | null, staged = false): number | null {
  if (fraction === null) return null;
  const [start, end] = (staged ? STAGED_SPAN : STEP_SPAN)[step];
  return start + (end - start) * Math.min(1, Math.max(0, fraction));
}

export async function defaultFreeBytes(directory: string): Promise<number | null> {
  try {
    const info = await statfs(directory);
    return info.bavail * info.bsize;
  } catch {
    return null;
  }
}

interface ToolRun {
  tool: string;
  label: string;
  args: string[];
  signal: AbortSignal;
  control?: ToolControl;
  onLine?: (line: string) => void;
  /** mkvmerge exits with 1 for warnings, which still means success. */
  okCodes?: number[];
}

/** Process ids of the tools a conversion runs right now; the CPU/GPU view tells them from Jellyfin's FFmpeg. */
export const conversionProcesses = new Set<number>();

/** Runs a tool at low priority, so that Jellyfin keeps streaming smoothly meanwhile; not while the job is paused. */
async function runTool({ tool, label, args, signal, control, onLine, okCodes = [0] }: ToolRun): Promise<void> {
  await control?.proceed();
  if (signal.aborted) throw new AgentError(499, 'Abgebrochen.');
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    const pid = child.pid;
    if (pid) {
      conversionProcesses.add(pid);
      control?.started(pid);
      child.once('exit', () => {
        conversionProcesses.delete(pid);
        control?.ended(pid);
      });
    }
    try {
      if (child.pid) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Not allowed everywhere; the conversion works without it.
    }
    const tail: string[] = [];
    const remember = (line: string) => {
      if (!line.trim()) return;
      tail.push(line);
      if (tail.length > 30) tail.shift();
    };
    let buffer = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        onLine?.(line);
        if (!line.startsWith('#GUI#progress') && !/^\w+=/.test(line)) remember(line);
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => chunk.split(/\r?\n/).forEach(remember));
    child.on('error', (error) => {
      if (signal.aborted) reject(new AgentError(499, 'Abgebrochen.'));
      else reject(Object.assign(new AgentError(500, `${label} konnte nicht gestartet werden: ${error.message}`), { log: null }));
    });
    child.on('close', (code) => {
      if (signal.aborted) return reject(new AgentError(499, 'Abgebrochen.'));
      if (code !== null && okCodes.includes(code)) return resolve();
      reject(Object.assign(new AgentError(500, `${label} ist fehlgeschlagen (Exit-Code ${code}).`), { log: tail.join('\n') || null }));
    });
  });
}

interface Probe {
  durationMs: number | null;
  /** As mkvmerge wants it, e.g. "24000/1001". */
  frameRate: string | null;
  hasDolbyVision: boolean | null;
}

/** Reads only the file header; falls back to what Jellyfin knows. */
async function probe(ctx: ConversionContext, input: string): Promise<Probe> {
  const hints = ctx.request.hints ?? {};
  const fallback: Probe = { durationMs: hints.durationMs ?? null, frameRate: frameRateFromNumber(hints.frameRate ?? null), hasDolbyVision: null };
  if (!ctx.tools.ffprobe.path) return fallback;
  let json = '';
  try {
    await runTool({
      tool: ctx.tools.ffprobe.path,
      label: 'ffprobe',
      args: ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate:stream_side_data=dv_profile:format=duration', '-of', 'json', input],
      signal: ctx.signal,
      control: ctx.control,
      onLine: (line) => (json += line),
    });
  } catch (error) {
    if (error instanceof AgentError && error.status === 499) throw error;
    return fallback;
  }
  try {
    const data = JSON.parse(json) as {
      streams?: Array<{ r_frame_rate?: string; side_data_list?: Array<{ dv_profile?: number }> }>;
      format?: { duration?: string };
    };
    const stream = data.streams?.[0];
    const duration = Number(data.format?.duration);
    const rate = stream?.r_frame_rate && /^\d+\/\d+$/.test(stream.r_frame_rate) && !stream.r_frame_rate.startsWith('0/') ? stream.r_frame_rate : null;
    return {
      durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : fallback.durationMs,
      frameRate: rate ?? fallback.frameRate,
      hasDolbyVision: stream ? Boolean(stream.side_data_list?.some((side) => side.dv_profile !== undefined)) : null,
    };
  } catch {
    return fallback;
  }
}

/** 23.976 → "24000/1001", 25 → "25/1". */
export function frameRateFromNumber(rate: number | null): string | null {
  if (!rate || rate <= 0) return null;
  for (const base of [24, 30, 48, 60, 120]) {
    if (Math.abs(rate - (base * 1000) / 1001) < 0.01) return `${base * 1000}/1001`;
  }
  return Number.isInteger(Math.round(rate * 1000) / 1000) ? `${Math.round(rate)}/1` : null;
}

/** Written to the temporary folder after each finished step, so a pause or a restart does not start over. */
interface Checkpoint {
  done: Stage;
  /** Known from the probe on; null after the copy into the work folder only. */
  info: Probe | null;
}

/** The steps that leave a file behind, in their order. */
const STAGES = ['fetch', 'extract', 'convert', 'mux'] as const;
type Stage = (typeof STAGES)[number];

async function readCheckpoint(file: string, outputs: Record<Stage, string>): Promise<Checkpoint | null> {
  try {
    const checkpoint = JSON.parse(await readFile(file, 'utf8')) as Checkpoint;
    if (!STAGES.includes(checkpoint.done) || typeof checkpoint.info !== 'object') return null;
    return (await exists(outputs[checkpoint.done])) ? checkpoint : null;
  } catch {
    return null;
  }
}

async function writeCheckpoint(file: string, checkpoint: Checkpoint): Promise<void> {
  await writeFile(`${file}.tmp`, JSON.stringify(checkpoint));
  await rename(`${file}.tmp`, file);
}

async function requireSpace(directory: string, required: number, what: string, ctx: ConversionContext): Promise<void> {
  const free = await (ctx.freeBytes ?? defaultFreeBytes)(directory);
  if (free !== null && free < required) {
    throw new AgentError(507, `Zu wenig Speicherplatz ${what} ${directory}: frei ${formatBytes(free)}, nötig etwa ${formatBytes(required)}.`);
  }
}

/**
 * Copies a file in chunks, into "<to>.part" first: shows progress, waits while the job is paused, and continues a
 * copy that a pause or a restart interrupted. Reads and writes one stream each – the network sees one long transfer.
 */
async function copyResumable(from: string, to: string, step: 'fetch' | 'store', ctx: ConversionContext): Promise<void> {
  const total = (await stat(from)).size;
  if ((await stat(to).then((info) => info.size, () => null)) === total) return;
  const partial = `${to}.part`;
  let copied = await stat(partial).then((info) => info.size, () => 0);
  if (copied > total) copied = 0;
  ctx.onProgress(step, total ? copied / total : 1);
  const reader = createReadStream(from, { start: copied, highWaterMark: COPY_CHUNK_BYTES });
  const writer = createWriteStream(partial, { flags: copied ? 'a' : 'w' });
  try {
    for await (const chunk of reader as AsyncIterable<Buffer>) {
      await ctx.control?.proceed();
      if (ctx.signal.aborted) throw new AgentError(499, 'Abgebrochen.');
      if (!writer.write(chunk)) await once(writer, 'drain');
      copied += chunk.length;
      ctx.onProgress(step, total ? copied / total : 1);
    }
    writer.end();
    await finished(writer);
  } finally {
    reader.destroy();
    writer.destroy();
  }
  await rename(partial, to);
}

/**
 * Turns a Dolby Vision profile 7 file into profile 8.1: extract the video, convert the RPU, mux it back with all other tracks.
 * With a work folder, the original is copied there first and the result copied back at the end; the storage is
 * busy only while copying. Aborted with PAUSE, it keeps its temporary files and continues there next time.
 */
export async function runConversion(ctx: ConversionContext): Promise<ConversionResult> {
  const { request, plan, tools, signal } = ctx;
  const api = pathApiFor(request.source);
  if (!tools.ffmpeg.path || !tools.doviTool.path || !tools.mkvmerge.path) {
    throw new AgentError(503, 'Es fehlen Werkzeuge (ffmpeg, dovi_tool oder mkvmerge) – siehe Agent-Status in Manelly.');
  }

  const work = workFolderFor(plan, ctx.jobId);
  // At the target: the temporary files, or – with a work folder – the copy of the result, next to where it ends up.
  const landing = tempFolderFor(request.source, plan, ctx.jobId);
  const temp = work ?? landing;
  const tempApi = pathApiFor(temp);
  const input = work ? tempApi.join(work, `source${api.extname(request.source).toLowerCase()}`) : request.source;
  const video = tempApi.join(temp, 'video.hevc');
  const converted = tempApi.join(temp, 'video_p8.hevc');
  const muxed = tempApi.join(temp, 'output.mkv');
  const checkpointFile = tempApi.join(temp, 'checkpoint.json');

  const sourceBytes = (await stat(request.source)).size;
  const resumed = await readCheckpoint(checkpointFile, { fetch: input, extract: video, convert: converted, mux: muxed });
  const reached = (stage: Stage) => resumed !== null && STAGES.indexOf(resumed.done) >= STAGES.indexOf(stage);
  if (!resumed) {
    if (plan.createDirectory) await mkdir(plan.directory, { recursive: true });
    try {
      await requireSpace(plan.directory, Math.ceil(sourceBytes * (work ? TARGET_SPACE_FACTOR : SPACE_FACTOR)), 'in', ctx);
      if (plan.work) await requireSpace(plan.work, Math.ceil(sourceBytes * WORK_SPACE_FACTOR), 'im Arbeitsordner', ctx);
    } catch (error) {
      if (plan.createDirectory) await rmdir(plan.directory).catch(() => {});
      throw error;
    }
  }

  try {
    if (!resumed) {
      // Leftovers of a run that did not get far enough for a checkpoint; a partial copy is kept and continued.
      for (const name of ['video.hevc', 'video_p8.hevc', 'output.mkv', 'checkpoint.json']) await rm(tempApi.join(temp, name), { force: true });
      await mkdir(temp, { recursive: true });
      // Jellyfin skips dot folders anyway; .ignore also covers its real-time monitor.
      await writeFile(tempApi.join(temp, '.ignore'), '');
    }

    if (work && !reached('fetch')) {
      await copyResumable(request.source, input, 'fetch', ctx);
      await writeCheckpoint(checkpointFile, { done: 'fetch', info: null });
    }

    let info = resumed?.info ?? null;
    if (!reached('extract') || !info) {
      ctx.onProgress('probe', null);
      info = await probe(ctx, input);
      if (info.hasDolbyVision === false) throw new AgentError(422, 'Die Datei enthält kein Dolby Vision.');

      const duration = info.durationMs;
      ctx.onProgress('extract', duration ? 0 : null);
      await runTool({
        tool: tools.ffmpeg.path,
        label: 'ffmpeg',
        args: ['-hide_banner', '-nostdin', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-i', input, '-map', '0:v:0', '-c:v', 'copy', '-bsf:v', 'hevc_mp4toannexb', '-f', 'hevc', video],
        signal,
        control: ctx.control,
        onLine: (line) => {
          const match = line.match(/^out_time_us=(\d+)/);
          if (match && duration) ctx.onProgress('extract', Number(match[1]) / 1000 / duration);
        },
      });
      await writeCheckpoint(checkpointFile, { done: 'extract', info });
    }

    if (!reached('convert')) {
      ctx.onProgress('convert', 0);
      await rm(converted, { force: true });
      const videoBytes = (await stat(video)).size;
      const watch = setInterval(() => {
        stat(converted).then(
          (current) => ctx.onProgress('convert', videoBytes ? current.size / videoBytes : null),
          () => {},
        );
      }, 1000);
      try {
        await runTool({ tool: tools.doviTool.path, label: 'dovi_tool', args: ['-m', '2', 'convert', '--discard', video, '-o', converted], signal, control: ctx.control });
      } finally {
        clearInterval(watch);
      }
      await writeCheckpoint(checkpointFile, { done: 'convert', info });
      await unlink(video);
    }

    if (!reached('mux')) {
      ctx.onProgress('mux', 0);
      await rm(muxed, { force: true });
      await runTool({
        tool: tools.mkvmerge.path,
        label: 'mkvmerge',
        args: [
          '--gui-mode',
          '-o',
          muxed,
          ...(info.frameRate ? ['--default-duration', `0:${info.frameRate}p`] : []),
          converted,
          // Everything but the video from the original: audio, subtitles, chapters, attachments.
          '--no-video',
          input,
        ],
        signal,
        control: ctx.control,
        okCodes: [0, 1],
        onLine: (line) => {
          const match = line.match(/^#GUI#progress (\d+)%/);
          if (match) ctx.onProgress('mux', Number(match[1]) / 100);
        },
      });
      await writeCheckpoint(checkpointFile, { done: 'mux', info });
      await unlink(converted);
      // The copy of the original is not needed any more; the work folder only holds the result now.
      if (work) await unlink(input);
    }

    let result = muxed;
    if (work) {
      await mkdir(landing, { recursive: true });
      await writeFile(api.join(landing, '.ignore'), '');
      result = api.join(landing, 'output.mkv');
      await copyResumable(muxed, result, 'store', ctx);
    }

    ctx.onProgress('finalize', 0);
    const done = await finalize(result, request, plan);
    await rm(landing, { recursive: true, force: true });
    if (work) await rm(work, { recursive: true, force: true });
    return { ...done, warning: done.warning ?? (info.frameRate ? null : 'Die Bildrate war unbekannt; mkvmerge hat sie aus dem Video übernommen.') };
  } catch (error) {
    if (!(signal.aborted && signal.reason === PAUSE)) await discardTemp(request.source, plan, ctx.jobId);
    throw error;
  }
}

/** Removes the temporary files of a conversion – at the target and in the work folder – and the folder it created for it if that is empty now. */
export async function discardTemp(source: string, plan: OutputPlan, jobId: string): Promise<void> {
  await rm(tempFolderFor(source, plan, jobId), { recursive: true, force: true }).catch(() => {});
  const work = workFolderFor(plan, jobId);
  if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
  if (plan.createDirectory) await rmdir(plan.directory).catch(() => {});
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

/** fs.rename replaces an existing target, on Windows too; Manelly never overwrites files. */
async function moveNew(from: string, to: string): Promise<void> {
  if (await exists(to)) throw new AgentError(409, `${to} gibt es inzwischen – Manelly überschreibt keine Dateien.`);
  await rename(from, to);
}

async function finalize(muxed: string, request: ConversionRequest, plan: OutputPlan): Promise<ConversionResult> {
  const api = pathApiFor(request.source);
  if (!plan.backup) {
    await moveNew(muxed, plan.output);
    return { output: plan.output, backup: null, warning: null };
  }

  const backupDir = api.dirname(plan.backup);
  await mkdir(backupDir, { recursive: true });
  await writeFile(api.join(backupDir, '.ignore'), '');
  try {
    await moveNew(request.source, plan.backup);
  } catch (error) {
    // Typically a file Jellyfin is streaming right now (Windows locks it). Keep the work instead of throwing it away.
    const name = api.basename(request.source, api.extname(request.source));
    let fallback = api.join(api.dirname(request.source), `${name} - DV P8.mkv`);
    for (let n = 2; await exists(fallback); n++) fallback = api.join(api.dirname(request.source), `${name} - DV P8 (${n}).mkv`);
    await rename(muxed, fallback);
    return {
      output: fallback,
      backup: null,
      warning: `Das Original liess sich nicht verschieben (${(error as NodeJS.ErrnoException).code ?? 'Fehler'} – wird es gerade abgespielt?). Die umgewandelte Datei liegt daneben.`,
    };
  }
  try {
    // The original was moved away just now, so its name is free.
    await moveNew(muxed, plan.output);
  } catch (error) {
    await rename(plan.backup, request.source).catch(() => {});
    throw new AgentError(500, `Die umgewandelte Datei liess sich nicht an ihren Platz verschieben: ${(error as Error).message}`);
  }
  return { output: plan.output, backup: plan.backup, warning: null };
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}
