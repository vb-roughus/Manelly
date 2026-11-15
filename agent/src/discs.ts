import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import type { DiscDrive, DiscInfo, DiscIso, DiscIsoList, DiscRead, DiscRip, DiscRipRequest, DiscSettings, DiscSourceRequest, DiscsStatus, DiscTitle } from '@manelly/shared';
import { formatBytes } from './convert.js';
import { AgentError } from './errors.js';
import { createActivity, listDrives, readDisc, ripTitle, type DiscSource } from './makemkv.js';
import { isValidSegment, isWithin, pathApiFor, TEMP_FOLDER_PREFIX } from './paths.js';
import { markSuggested, type StreamKeep } from './tracks.js';
import { defaultPowershell, scriptArgs, scriptError } from './powershell.js';

/** Finished rips shown at most. */
const KEEP_FINISHED = 20;
/** The drive list is read again after this long at the earliest; every read starts makemkvcon. */
const DRIVES_FRESH_MS = 3000;
/** The rate is averaged over this long. */
const RATE_WINDOW_MS = 6000;
const SAMPLE_MS = 1000;
/** Room kept free beyond the titles' size. */
const SPACE_MARGIN = 1.05;
/** "FINDET_NEMO" → "Findet Nemo": a folder name from a disc's name; null when nothing usable is left. */
export function folderNameFrom(name: string): string | null {
  let text = name.replace(/[_.]+/g, ' ').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Labels are often all capitals; names are nicer in title case.
  if (text === text.toUpperCase()) text = text.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
  text = text.replace(/[ .]+$/, '').slice(0, 120);
  return isValidSegment(text) ? text : null;
}

/** The main title: the longest, and of two as long the bigger one. */
export function mainTitle(titles: DiscTitle[]): DiscTitle | null {
  return [...titles].sort((a, b) => b.durationSeconds - a.durationSeconds || (b.bytes ?? 0) - (a.bytes ?? 0))[0] ?? null;
}

/**
 * What a read or a rip is of: the disc in a drive, by MakeMKV's number, or an image in the ISO folder – by its path
 * there ("Dune.iso", "Dune (2021)/Dune.iso") and its full path.
 */
type IsoSource = { drive?: undefined; iso: string; full: string };
type Source = { drive: number; iso?: undefined; full?: undefined } | IsoSource;
/** Reads, rips and what is busy go by this: "drive:0", "iso:Dune.iso". */
const keyOf = (source: { drive?: number; iso?: string }) => (source.iso !== undefined ? `iso:${source.iso}` : `drive:${source.drive}`);
const driveKey = (drive: number) => `drive:${drive}`;
const opened = (source: Source): DiscSource => (source.iso !== undefined ? { iso: source.full } : { drive: source.drive });
/** "Dune (2021)/Dune.iso" → "Dune". */
const imageName = (iso: string) => iso.split('/').pop()!.replace(/\.iso$/i, '');
/** Images listed at most. */
const MAX_ISOS = 500;
/** Reads of images kept, besides those under way; the oldest go first. */
const KEEP_ISO_READS = 10;

/**
 * The PowerShell script that ejects the disc in drive `letter` through the drive itself, as Explorer does it – also
 * without anybody logged on. Windows PowerShell reads 0x80000000 as a negative Int32, so GENERIC_READ goes in as a
 * UInt32 written out.
 */
export function ejectScript(letter: string): string {
  return `Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ManellyEject {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool DeviceIoControl(IntPtr device, uint code, IntPtr input, uint inputSize, IntPtr output, uint outputSize, out uint returned, IntPtr overlapped);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr handle);
}
'@
# GENERIC_READ, shared for reading and writing, OPEN_EXISTING.
$handle = [ManellyEject]::CreateFile('\\\\.\\${letter}:', [UInt32]2147483648, [UInt32]3, [IntPtr]::Zero, [UInt32]3, [UInt32]0, [IntPtr]::Zero)
if ($handle -eq [IntPtr]-1) { throw "Das Laufwerk ${letter}: liess sich nicht öffnen (Fehler $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
$returned = [UInt32]0
# IOCTL_STORAGE_EJECT_MEDIA
$ok = [ManellyEject]::DeviceIoControl($handle, [UInt32]2967560, [IntPtr]::Zero, [UInt32]0, [IntPtr]::Zero, [UInt32]0, [ref]$returned, [IntPtr]::Zero)
$code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
[ManellyEject]::CloseHandle($handle) | Out-Null
if (-not $ok) { throw "Windows lehnte das Auswerfen ab (Fehler $code)." }`;
}

/** Runs a script with PowerShell; fails with the script's own error in one line, not PowerShell's full report. */
function runScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(defaultPowershell(), scriptArgs(script), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => reject(new Error(`PowerShell liess sich nicht starten: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(scriptError(stdout, stderr, code)))));
  });
}

/** Ejects a disc: on Windows through the drive itself, elsewhere with eject (Linux) or drutil (macOS). */
export async function ejectDisc(device: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === 'win32') {
    const letter = /^([A-Za-z]):?\\?$/.exec(device)?.[1];
    if (!letter) throw new Error(`Unbekanntes Laufwerk «${device}».`);
    await runScript(ejectScript(letter.toUpperCase()));
    return;
  }
  const [command, args] = platform === 'darwin' ? ['drutil', ['eject']] : ['eject', [device]];
  await new Promise<void>((resolve, reject) =>
    execFile(command, args, { timeout: 30_000 }, (error) => (error ? reject(new Error(`Auswerfen ging nicht: ${error.message}`)) : resolve())),
  );
}

export interface DiscsOptions {
  /** makemkvcon, if installed. */
  tool: () => Promise<string | null>;
  settings: { get: () => DiscSettings; set: (settings: DiscSettings) => Promise<void> };
  /** Where rips go: the extraction folder from the JDownloader settings. */
  target: () => string | null;
  freeBytes?: (directory: string) => Promise<number | null>;
  /** Connects the network drive of the target, if it is one. */
  prepare?: (directory: string) => Promise<unknown>;
  eject?: (device: string) => Promise<void>;
  log?: (message: string) => void;
  /** How often the automatic mode looks for a new disc; 0: only when asked (tests). */
  tickMs?: number;
  /** Where the agent keeps which disc of a drive is ripped already, over a restart. */
  stateFile?: string;
  /**
   * After each title: e.g. the preferred audio track first, and with `keep` only the chosen tracks left; a failure there
   * does not fail the rip.
   */
  afterTitle?: (file: string, signal: AbortSignal, keep?: StreamKeep) => Promise<unknown>;
}

interface Job {
  view: DiscRip;
  source: Source;
  /** The drive's device, for ejecting; empty for an image. */
  device: string;
  /** The disc's label as the drive names it, to know it again; an image's path. */
  label: string;
  /** discKey of the read it was ripped from; null without one. */
  fingerprint: string | null;
  /** Per title index: the tracks to keep, when not all of them. */
  keeps: Map<number, StreamKeep>;
  abort: AbortController;
  samples: Array<{ t: number; bytes: number }>;
  /** Feeds MakeMKV's output into the rip's step and messages. */
  take: (line: string) => void;
}

const active = (rip: DiscRip) => rip.state === 'queued' || rip.state === 'running';

/** Discs ripped before, at most this many, the newest first. */
const HISTORY_LIMIT = 500;

/**
 * What tells a disc from another: its name and the length, size and chapters of every title. A label alone is not
 * enough – many discs are just «DVD_VIDEO» –, and the same disc reads the same each time.
 */
export function discKey(info: Pick<DiscInfo, 'name' | 'titles'>): string {
  return [info.name, ...info.titles.map((title) => `${Math.round(title.durationSeconds)}/${title.bytes ?? '?'}/${title.chapters}`)].join('|');
}

interface RippedDisc {
  key: string;
  label: string;
  folder: string;
  at: string;
}
/** A copy for the answer; the job itself goes on changing. */
const snapshot = (rip: DiscRip): DiscRip => ({ ...rip, titles: rip.titles.map((title) => ({ ...title })), messages: [...(rip.messages ?? [])] });

/**
 * Reads DVDs with MakeMKV and rips their titles into a new folder of the extraction folder, one rip after the other,
 * without changing the picture or sound. Only the drives MakeMKV names are touched – and the images in the ISO folder
 * Manelly names, which are read and ripped the same way.
 */
export function createDiscs(options: DiscsOptions) {
  const { log = () => {} } = options;
  const eject = options.eject ?? ((device: string) => ejectDisc(device));
  const jobs: Job[] = [];
  /** By keyOf, as `busy` and `readAborts`. */
  const reads = new Map<string, DiscRead>();
  const busy = new Set<string>();
  const readAborts = new Map<string, AbortController>();
  /** makemkvcon is at work in a drive: the drive list is not asked for meanwhile. */
  const drivesBusy = () => [...busy].some((key) => key.startsWith('drive:'));
  /** The disc each read is of, by its label: a read of a disc no longer in the drive goes. */
  const readOf = new Map<number, string | null>();
  /** The disc the automatic mode or the automatic reading already took, per drive, until the drive is empty again. */
  const handled = new Map<number, string>();
  let drives: { at: number; list: Array<Omit<DiscDrive, 'busy'>> } | null = null;
  let driveError: string | null = null;
  let working = false;
  let timer: NodeJS.Timeout | null = null;
  /** The look of the automatic mode under way; a second one waits for it. */
  let ticking: Promise<void> | null = null;
  /** Before a restart: nothing new starts – no rip, no read; what runs finishes. */
  let held = false;
  /**
   * The disc in each drive that is ripped already, by its label, until the drive is empty: neither the automatic mode
   * nor the automatic reading takes it again – also not after a restart, e.g. when it was not ejected.
   */
  const stored = loadState();
  const ripped = new Map<number, string>(stored.drives);
  /**
   * Every disc ripped, by discKey, the newest first – also once ejected: a server that restarts at night pulls the tray
   * back in, and the automatic mode must not rip the same disc again.
   */
  const history: RippedDisc[] = stored.history;

  function loadState(): { drives: Array<[number, string]>; history: RippedDisc[] } {
    const nothing = { drives: [], history: [] };
    if (!options.stateFile) return nothing;
    try {
      const raw = JSON.parse(readFileSync(options.stateFile, 'utf8')) as Record<string, unknown>;
      // Agents before 0.39.0 kept only the drives, right at the top.
      const drivesOf = (value: unknown) =>
        Object.entries((value ?? {}) as Record<string, unknown>).flatMap(([drive, disc]) =>
          typeof disc === 'string' && /^\d+$/.test(drive) ? [[Number(drive), disc] as [number, string]] : [],
        );
      const history = Array.isArray(raw.history)
        ? (raw.history as RippedDisc[]).filter((entry) => typeof entry?.key === 'string' && typeof entry.folder === 'string' && typeof entry.at === 'string')
        : [];
      return { drives: drivesOf('drives' in raw ? raw.drives : raw), history: history.slice(0, HISTORY_LIMIT) };
    } catch {
      return nothing;
    }
  }

  /** When and where this disc was ripped before, if it was. */
  function rippedBefore(info: Pick<DiscInfo, 'name' | 'titles'>): { at: string; folder: string } | null {
    const key = discKey(info);
    const found = history.find((entry) => entry.key === key);
    return found ? { at: found.at, folder: found.folder } : null;
  }

  /** One write after the other, each whole: a temporary file first, then renamed over the old one. */
  let saving: Promise<void> = Promise.resolve();
  function saveRipped() {
    const file = options.stateFile;
    if (!file) return;
    const content = JSON.stringify({ drives: Object.fromEntries(ripped), history });
    saving = saving.then(() => writeFile(`${file}.tmp`, content).then(() => rename(`${file}.tmp`, file))).catch(() => {});
  }

  /** A drive without a disc forgets what was ripped from it. */
  function forgetEmpty(list: Array<Omit<DiscDrive, 'busy'>>) {
    let changed = false;
    for (const drive of list) if (drive.state !== 'inserted' && ripped.delete(drive.index)) changed = true;
    if (changed) saveRipped();
  }

  function refuseWhileHeld(what: string) {
    if (held) throw new AgentError(409, `Der Agent startet gleich neu, um ein Update zu übernehmen – danach ${what}.`);
  }

  async function requireTool(): Promise<string> {
    const tool = await options.tool();
    if (!tool) throw new AgentError(409, 'MakeMKV fehlt auf dem Server – zuerst installieren (makemkv.com).');
    return tool;
  }

  function requireTarget(): string {
    const target = options.target();
    if (!target) throw new AgentError(409, 'Zuerst in den JDownloader-Einstellungen den Entpack-Ordner festlegen – dorthin kommen die MKV-Dateien.');
    return target;
  }

  /** The drives; while one is busy, the last list – makemkvcon is at work there. */
  async function currentDrives(tool: string): Promise<Array<Omit<DiscDrive, 'busy'>>> {
    if (drives && (drivesBusy() || Date.now() - drives.at < DRIVES_FRESH_MS)) return drives.list;
    try {
      drives = { at: Date.now(), list: await listDrives(tool) };
      driveError = null;
    } catch (error) {
      driveError = (error as Error).message;
      drives = { at: Date.now(), list: drives?.list ?? [] };
    }
    return drives.list;
  }

  async function findDrive(index: number): Promise<Omit<DiscDrive, 'busy'>> {
    const drive = (await currentDrives(await requireTool())).find((candidate) => candidate.index === index);
    if (!drive) throw new AgentError(404, `Laufwerk ${index} gibt es nicht.`);
    return drive;
  }

  /** The ISO folder from the settings; without one, no image can be read. */
  function isoFolder(): string {
    const folder = options.settings.get().isoFolder;
    if (!folder) throw new AgentError(409, 'Zuerst in den Disc-Einstellungen den ISO-Ordner festlegen.');
    return folder;
  }

  /** An image in the ISO folder or a folder right in it, as listed: only .iso files, nothing outside the folder. */
  async function resolveIso(path: unknown): Promise<IsoSource> {
    const folder = isoFolder();
    const names = typeof path === 'string' && path.length <= 1000 ? path.split('/') : [];
    if (names.length === 0 || names.length > 2 || !names.every(isValidSegment) || !/\.iso$/i.test(names.at(-1)!)) {
      throw new AgentError(400, 'Ein ISO-Image im ISO-Ordner erwartet.');
    }
    await options.prepare?.(folder);
    const api = pathApiFor(folder);
    const full = api.join(folder, ...names);
    if (!isWithin(full, folder, api)) throw new AgentError(400, 'Ein ISO-Image im ISO-Ordner erwartet.');
    if (!(await stat(full).then((info) => info.isFile(), () => false))) throw new AgentError(404, `«${names.join('/')}» gibt es im ISO-Ordner nicht (mehr).`);
    return { iso: names.join('/'), full };
  }

  /** The images in the ISO folder and in the folders right in it – nothing deeper, and nothing else is searched. */
  async function listIsos(): Promise<DiscIsoList> {
    const folder = options.settings.get().isoFolder ?? null;
    if (!folder) return { folder: null, isos: [], error: null };
    await options.prepare?.(folder);
    const api = pathApiFor(folder);
    let top;
    try {
      top = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'Fehler';
      const reason = code === 'ENOENT' ? `Den ISO-Ordner ${folder} gibt es auf dem Server nicht (mehr).` : `Den ISO-Ordner ${folder} kann der Agent nicht lesen (${code}).`;
      return { folder, isos: [], error: reason };
    }
    const isos: DiscIso[] = [];
    // Hidden, scratch and system folders ($RECYCLE.BIN) are left out.
    const skipped = (name: string) => name.startsWith('.') || name.startsWith('$');
    const image = (entry: { name: string; isFile(): boolean }) => entry.isFile() && !skipped(entry.name) && /\.iso$/i.test(entry.name);
    async function add(names: string[]) {
      const full = api.join(folder!, ...names);
      const info = await stat(full).catch(() => null);
      if (!info?.isFile()) return;
      // Ripped from before: known by its full path (agents before 0.42.0 kept the path in the ISO folder).
      const path = names.join('/');
      const ripped = history.find((entry) => entry.label === full || entry.label === path);
      isos.push({ path, bytes: info.size, modifiedAt: info.mtime.toISOString(), rippedBefore: ripped ? { at: ripped.at, folder: ripped.folder } : null });
    }
    for (const entry of top) {
      if (isos.length >= MAX_ISOS) break;
      if (image(entry)) await add([entry.name]);
      else if (entry.isDirectory() && !skipped(entry.name)) {
        for (const inner of await readdir(api.join(folder, entry.name), { withFileTypes: true }).catch(() => [])) {
          if (image(inner) && isos.length < MAX_ISOS) await add([entry.name, inner.name]);
        }
      }
    }
    isos.sort((a, b) => a.path.localeCompare(b.path, 'de', { numeric: true, sensitivity: 'base' }));
    return { folder, isos, error: null };
  }

  /** Reads of images beyond the last few go, except those under way. */
  function forgetOldIsoReads() {
    const done = [...reads.entries()].filter(([, read]) => read.drive === null && read.state !== 'reading').map(([key]) => key);
    for (const key of done.slice(0, Math.max(0, done.length - KEEP_ISO_READS))) reads.delete(key);
  }

  /** Reads a disc's titles; what MakeMKV is at shows in `reads` meanwhile. `auto`: nobody asked, the disc came in. */
  async function readNow(tool: string, source: Source, auto = false): Promise<DiscInfo> {
    const key = keyOf(source);
    if (source.drive !== undefined) readOf.set(source.drive, drives?.list.find((candidate) => candidate.index === source.drive)?.disc ?? null);
    busy.add(key);
    const abort = new AbortController();
    readAborts.set(key, abort);
    const iso = source.iso !== undefined ? { iso: source.iso } : {};
    const read: DiscRead = { drive: source.drive ?? null, ...iso, state: 'reading', info: null, error: null, startedAt: new Date().toISOString(), ...(auto ? { auto } : {}) };
    // Its step and messages, updated while MakeMKV works.
    const { take } = createActivity(read);
    // The newest last.
    reads.delete(key);
    reads.set(key, read);
    if (source.iso !== undefined) forgetOldIsoReads();
    try {
      const info = await readDisc(tool, opened(source), { signal: abort.signal, onLine: take });
      // Which tracks to keep, suggested as for the audio track after the rip.
      markSuggested(info.titles, options.settings.get().audioLanguage ?? 'ger');
      read.info = { ...info, ...iso, rippedBefore: rippedBefore(info) };
      read.state = 'done';
      return read.info;
    } catch (error) {
      read.state = abort.signal.aborted ? 'canceled' : 'failed';
      read.error = (error as Error).message;
      log(`${source.iso !== undefined ? `Image «${source.iso}»` : `Disc in Laufwerk ${source.drive}`} lesen: ${read.error}`);
      throw error;
    } finally {
      busy.delete(key);
      readAborts.delete(key);
    }
  }

  const exists = (path: string) => lstat(path).then(() => true, () => false);

  async function size(directory: string, known: Set<string>): Promise<number> {
    let total = 0;
    for (const name of await readdir(directory).catch(() => [] as string[])) {
      if (known.has(name)) continue;
      total += (await stat(pathApiFor(directory).join(directory, name)).catch(() => null))?.size ?? 0;
    }
    return total;
  }

  async function run(job: Job): Promise<void> {
    const { view } = job;
    view.state = 'running';
    view.startedAt = new Date().toISOString();
    const done = () => view.titles.filter((title) => title.state === 'done').length;
    let temp: string | null = null;
    /** What went wrong after a title was saved, e.g. with its audio tracks; the rip itself is done. */
    let afterwards: string | null = null;
    const key = keyOf(job.source);
    busy.add(key);
    try {
      const tool = await requireTool();
      const target = requireTarget();
      await options.prepare?.(target);
      const api = pathApiFor(target);
      const folder = api.join(target, view.folder);
      temp = api.join(target, `${TEMP_FOLDER_PREFIX}rip-${view.id}`);
      await mkdir(folder, { recursive: true });
      await rm(temp, { recursive: true, force: true });
      await mkdir(temp);
      for (const title of view.titles) {
        if (job.abort.signal.aborted) break;
        const destination = api.join(folder, title.fileName);
        if (await exists(destination)) {
          Object.assign(title, { state: 'failed', error: `«${title.fileName}» gibt es schon.` });
          continue;
        }
        title.state = 'running';
        const before = new Set(await readdir(temp));
        let saved = 0;
        job.samples = [];
        const sampler = setInterval(() => {
          void size(temp!, before).then((bytes) => {
            const now = Date.now();
            job.samples.push({ t: now, bytes });
            while (job.samples.length > 2 && now - job.samples[0]!.t > RATE_WINDOW_MS) job.samples.shift();
            const first = job.samples[0]!;
            view.bytesPerSecond = now > first.t && bytes > first.bytes ? Math.round(((bytes - first.bytes) * 1000) / (now - first.t)) : view.bytesPerSecond;
            const share = Math.max(saved, title.bytes ? Math.min(0.99, bytes / title.bytes) : 0);
            view.progress = (done() + share) / view.titles.length;
          });
        }, SAMPLE_MS);
        try {
          const said = await ripTitle(tool, opened(job.source), title.index, temp, (share) => (saved = share), { signal: job.abort.signal, onLine: job.take });
          const made = (await readdir(temp)).filter((name) => !before.has(name) && name.toLowerCase().endsWith('.mkv'));
          if (made.length === 0) throw new Error(`MakeMKV hat Titel ${title.index + 1} nicht gespeichert${said ? `: ${said}` : '.'}`);
          await rename(api.join(temp, made[0]!), destination);
          if (options.afterTitle) {
            const keep = job.keeps.get(title.index);
            view.step = keep ? 'Nimmt die nicht gewählten Spuren heraus' : 'Passt die Tonspuren an';
            try {
              await options.afterTitle(destination, job.abort.signal, keep);
            } catch (error) {
              if (job.abort.signal.aborted) throw error;
              afterwards ??= `Gerippt, aber die Spuren blieben, wie sie waren: ${(error as Error).message}`;
            }
          }
          title.state = 'done';
        } catch (error) {
          Object.assign(title, { state: 'failed', error: job.abort.signal.aborted ? 'Abgebrochen.' : (error as Error).message });
        } finally {
          clearInterval(sampler);
        }
        view.progress = done() / view.titles.length;
      }
      const failed = view.titles.find((title) => title.state === 'failed');
      view.state = job.abort.signal.aborted ? 'canceled' : failed ? 'failed' : 'done';
      view.error = view.state === 'failed' ? (failed?.error ?? null) : view.state === 'done' ? afterwards : null;
      log(`Disc «${view.disc}» → ${view.folder}: ${done()} von ${view.titles.length} Titeln${view.state === 'done' ? '' : ` (${view.state === 'canceled' ? 'abgebrochen' : view.error})`}`);
      if (view.state === 'done') {
        // Ripped: the disc is not taken again while it stays in the drive, nor once it comes back, also after a restart.
        if (job.source.drive !== undefined) ripped.set(job.source.drive, job.label);
        if (job.fingerprint) {
          const before = history.findIndex((entry) => entry.key === job.fingerprint);
          if (before >= 0) history.splice(before, 1);
          history.unshift({ key: job.fingerprint, label: job.label, folder: view.folder, at: new Date().toISOString() });
          history.splice(HISTORY_LIMIT);
          // The titles shown for the drive or image now say so too.
          const shown = reads.get(key)?.info;
          if (shown && discKey(shown) === job.fingerprint) shown.rippedBefore = { at: history[0]!.at, folder: view.folder };
        }
        saveRipped();
      }
      if (view.state === 'done' && view.eject && job.device) {
        await eject(job.device).catch((error: Error) => {
          view.error = `Fertig, aber das Auswerfen ging nicht: ${error.message}`;
        });
      }
    } catch (error) {
      view.state = job.abort.signal.aborted ? 'canceled' : 'failed';
      view.error = (error as Error).message;
    } finally {
      if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
      busy.delete(key);
      view.bytesPerSecond = null;
      view.finishedAt = new Date().toISOString();
      // The drive's state changed: read it again next time.
      drives = null;
    }
  }

  async function work() {
    if (working) return;
    working = true;
    try {
      for (let job = jobs.find((entry) => entry.view.state === 'queued'); job; job = jobs.find((entry) => entry.view.state === 'queued')) await run(job);
    } finally {
      working = false;
    }
    const finished = jobs.filter((job) => !active(job.view));
    for (const job of finished.slice(KEEP_FINISHED)) jobs.splice(jobs.indexOf(job), 1);
  }

  async function enqueue(request: DiscRipRequest, auto: boolean): Promise<DiscRip> {
    refuseWhileHeld('rippen');
    const tool = await requireTool();
    const target = requireTarget();
    const folder = typeof request.folder === 'string' ? request.folder.trim() : '';
    if (!isValidSegment(folder)) throw new AgentError(400, `«${folder}» ist kein gültiger Ordnername.`);
    if (!Array.isArray(request.titles) || request.titles.length === 0 || request.titles.length > 200) throw new AgentError(400, 'Mindestens einen Titel wählen.');
    const names = new Set<string>();
    for (const title of request.titles) {
      if (!Number.isInteger(title?.index) || title.index < 0 || typeof title.fileName !== 'string') throw new AgentError(400, 'Titel und Dateinamen erwartet.');
      if (!isValidSegment(title.fileName) || !/\.mkv$/i.test(title.fileName)) throw new AgentError(400, `«${title.fileName}» ist kein gültiger Dateiname; er muss auf .mkv enden.`);
      if (names.has(title.fileName.toLowerCase())) throw new AgentError(400, `«${title.fileName}» kommt zweimal vor.`);
      names.add(title.fileName.toLowerCase());
    }
    let source: Source;
    let device = '';
    let label: string;
    let fallback: string;
    if (request.iso !== undefined) {
      source = await resolveIso(request.iso);
      // Its full path, so the list of the ISO folder knows it as ripped.
      label = source.full;
      fallback = imageName(source.iso);
    } else {
      const drive = (await currentDrives(tool)).find((candidate) => candidate.index === request.drive);
      if (!drive) throw new AgentError(404, `Laufwerk ${request.drive} gibt es nicht.`);
      if (drive.state !== 'inserted') throw new AgentError(409, 'Im Laufwerk liegt keine Disc.');
      source = { drive: drive.index };
      device = drive.device;
      label = drive.disc ?? '';
      fallback = drive.disc ?? `Disc ${drive.index}`;
    }
    const key = keyOf(source);
    if (jobs.some((job) => active(job.view) && keyOf(job.source) === key)) {
      throw new AgentError(409, source.iso !== undefined ? 'Von diesem Image wird schon gerippt.' : 'Von dieser Disc wird schon gerippt.');
    }
    await options.prepare?.(target);
    const api = pathApiFor(target);
    for (const title of request.titles) {
      if (await exists(api.join(target, folder, title.fileName))) throw new AgentError(409, `«${folder}/${title.fileName}» gibt es im Entpack-Ordner schon.`);
    }
    // The sizes MakeMKV named when it read the disc.
    const read = reads.get(key)?.info;
    const known = read?.titles ?? [];
    // The tracks to keep, as positions in the title's streams; all of them need nothing done.
    const keeps = new Map<number, StreamKeep>();
    for (const title of request.titles) {
      if (title.audio === undefined && title.subtitles === undefined) continue;
      const streams = known.find((candidate) => candidate.index === title.index);
      if (!streams) throw new AgentError(409, `Die Spuren von Titel ${title.index + 1} kennt der Agent nicht (mehr) – zuerst neu lesen.`);
      const positions = (value: unknown, count: number): number[] | null =>
        value === undefined
          ? [...Array(count).keys()]
          : Array.isArray(value) && value.length <= 500 && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry < count)
            ? [...new Set(value as number[])].sort((a, b) => a - b)
            : null;
      const audio = positions(title.audio, streams.audio.length);
      const subtitles = positions(title.subtitles, streams.subtitles.length);
      if (!audio || !subtitles) throw new AgentError(400, `Ungültige Spuren für Titel ${title.index + 1}.`);
      if (streams.audio.length > 0 && audio.length === 0) throw new AgentError(400, `Titel ${title.index + 1}: mindestens eine Tonspur behalten.`);
      if (audio.length === streams.audio.length && subtitles.length === streams.subtitles.length) continue;
      keeps.set(title.index, { audio: { streams: streams.audio, chosen: audio }, subtitles: { streams: streams.subtitles, chosen: subtitles } });
    }
    const bytes = request.titles.map((title) => known.find((candidate) => candidate.index === title.index)?.bytes ?? null);
    const needed = bytes.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const free = (await options.freeBytes?.(target)) ?? null;
    if (free !== null && needed * SPACE_MARGIN > free) {
      throw new AgentError(409, `Zu wenig Platz im Entpack-Ordner: braucht etwa ${formatBytes(needed)}, frei sind ${formatBytes(free)}.`);
    }
    const view: DiscRip = {
      id: randomUUID(),
      drive: source.drive ?? null,
      ...(source.iso !== undefined ? { iso: source.iso } : {}),
      disc: read?.name ?? fallback,
      folder,
      titles: request.titles.map((title, at) => ({ index: title.index, fileName: title.fileName, bytes: bytes[at] ?? null, state: 'waiting', error: null })),
      state: 'queued',
      progress: 0,
      bytesPerSecond: null,
      error: null,
      // An image has nothing to eject.
      eject: source.iso === undefined && (request.eject ?? options.settings.get().eject),
      auto,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    jobs.unshift({ view, source, device, label, fingerprint: read ? discKey(read) : null, keeps, abort: new AbortController(), samples: [], take: createActivity(view).take });
    log(`Disc «${view.disc}»: ${view.titles.length} Titel nach ${folder}${auto ? ' (automatisch)' : ''}`);
    const answer = snapshot(view);
    void work();
    return answer;
  }

  /** A folder name not used yet in the target, for the automatic mode, which asks nobody. */
  async function freeFolder(target: string, name: string): Promise<string> {
    const api = pathApiFor(target);
    for (let number = 1; number < 100; number++) {
      const candidate = number === 1 ? name : `${name} (${number})`;
      if (!(await exists(api.join(target, candidate)))) return candidate;
    }
    return `${name} ${Date.now()}`;
  }

  /** Whether anything looks for discs that come in. */
  const watching = (settings: DiscSettings) => settings.auto || settings.read === true;

  /**
   * Looks for discs that came in. The automatic mode reads a new disc, rips its main title and ejects it; otherwise,
   * with automatic reading, a new disc is only read, so its titles are ready when somebody opens the page.
   */
  function tick(): Promise<void> {
    ticking ??= look().finally(() => (ticking = null));
    return ticking;
  }

  async function look(): Promise<void> {
    const settings = options.settings.get();
    if (!watching(settings) || held) return;
    const tool = await options.tool();
    if (!tool) return;
    // Where the automatic mode rips to; without a target it only reads, if that is on.
    const ripTo = settings.auto ? options.target() : null;
    // The automatic mode takes the next disc once the rip under way is done.
    if (ripTo && jobs.some((job) => active(job.view))) return;
    if (!ripTo && settings.read !== true) return;
    const list = await currentDrives(tool);
    forgetEmpty(list);
    for (const drive of list) {
      if (drive.state !== 'inserted') {
        handled.delete(drive.index);
        continue;
      }
      const key = drive.disc ?? '';
      if (busy.has(driveKey(drive.index)) || handled.get(drive.index) === key) continue;
      handled.set(drive.index, key);
      if (ripped.get(drive.index) === key) continue;
      if (!ripTo) {
        // Read by hand already: nothing more to do.
        if (reads.has(driveKey(drive.index)) && readOf.get(drive.index) === drive.disc) continue;
        log(`Disc «${key || 'ohne Namen'}» in Laufwerk ${drive.index} eingelegt – wird gelesen.`);
        await readNow(tool, { drive: drive.index }, true).catch(() => {});
        continue;
      }
      try {
        const info = await readNow(tool, { drive: drive.index });
        if (info.rippedBefore) {
          log(`Disc «${key || info.name}» wurde schon gerippt (${info.rippedBefore.folder}) – der automatische Modus lässt sie aus.`);
          continue;
        }
        const main = mainTitle(info.titles);
        if (!main) continue;
        const folder = await freeFolder(ripTo, folderNameFrom(info.name) ?? folderNameFrom(drive.disc ?? '') ?? `Disc ${new Date().toISOString().slice(0, 10)}`);
        // Only the suggested tracks, when so set.
        const kept = (streams: DiscTitle['audio']) => streams.flatMap((stream, index) => (stream.keep ? [index] : []));
        const tracks = settings.trimTracks === true ? { audio: kept(main.audio), subtitles: kept(main.subtitles) } : {};
        await enqueue({ drive: drive.index, folder, titles: [{ index: main.index, fileName: `${folder}.mkv`, ...tracks }], eject: true }, true);
      } catch (error) {
        log(`Automatisches Rippen von «${key}» ging nicht: ${(error as Error).message}`);
      }
    }
  }

  return {
    /** `refresh` asks the drives again right away, e.g. after a new disc went in. */
    async status(refresh = false): Promise<DiscsStatus> {
      const tool = await options.tool();
      if (refresh && !drivesBusy()) drives = null;
      const list = tool ? await currentDrives(tool) : [];
      forgetEmpty(list);
      // While Manelly looks, a disc that came in is noticed within seconds rather than at the next tick.
      if (tool && watching(options.settings.get())) void tick();
      // Titles read from a disc that was taken out or swapped by hand are no longer what is in the drive.
      // Images stay until another ISO folder is set.
      for (const [key, read] of reads) {
        const index = read.drive;
        if (index === null) continue;
        const drive = list.find((candidate) => candidate.index === index);
        if (read.state !== 'reading' && (!drive || drive.state !== 'inserted' || drive.disc !== readOf.get(index))) reads.delete(key);
      }
      return {
        tool,
        drives: list.map((drive) => ({ ...drive, busy: busy.has(driveKey(drive.index)) })),
        reads: [...reads.values()].map((read) => ({ ...read, messages: [...(read.messages ?? [])] })),
        rips: jobs.map((job) => snapshot(job.view)),
        settings: options.settings.get(),
        target: options.target(),
        error: tool ? driveError : null,
      };
    },

    /** Starts reading the titles of the disc in a drive, or of an image; GET /api/discs tells when it is done. */
    async read(target: DiscSourceRequest): Promise<DiscRead> {
      refuseWhileHeld('lesen');
      const tool = await requireTool();
      let source: Source;
      if (target.iso !== undefined) {
        source = await resolveIso(target.iso);
        if (busy.has(keyOf(source))) throw new AgentError(409, 'Das Image wird gerade gelesen oder gerippt.');
      } else {
        const drive = await findDrive(target.drive);
        if (busy.has(driveKey(drive.index))) throw new AgentError(409, 'Das Laufwerk ist gerade beschäftigt.');
        if (drive.state !== 'inserted') throw new AgentError(409, 'Im Laufwerk liegt keine Disc.');
        source = { drive: drive.index };
      }
      void readNow(tool, source).catch(() => {});
      return reads.get(keyOf(source))!;
    },

    /** Stops reading a disc or an image, e.g. one that keeps MakeMKV busy for too long. */
    cancelRead(target: DiscSourceRequest): DiscRead {
      const key = keyOf(target);
      const read = reads.get(key);
      const abort = readAborts.get(key);
      if (!read || read.state !== 'reading' || !abort) {
        throw new AgentError(409, target.iso !== undefined ? 'Dieses Image wird gerade nicht gelesen.' : 'Von diesem Laufwerk wird gerade nichts gelesen.');
      }
      abort.abort();
      return { ...read, messages: [...(read.messages ?? [])] };
    },

    /** The images in the ISO folder; only when Manelly asks, e.g. while its tab is open. */
    isos: listIsos,

    /** Deletes an image of the ISO folder for good – not while it is read or ripped; a folder it leaves empty goes too. */
    async deleteIso(path: unknown): Promise<{ deleted: string }> {
      const source = await resolveIso(path);
      const key = keyOf(source);
      if (busy.has(key) || jobs.some((job) => active(job.view) && keyOf(job.source) === key)) {
        throw new AgentError(409, 'Das Image wird gerade gelesen oder gerippt – erst danach löschen.');
      }
      try {
        await unlink(source.full);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        throw new AgentError(409, `«${source.iso}» liess sich nicht löschen (${code ?? 'Fehler'}) – ist es noch geöffnet, z. B. eingebunden?`);
      }
      const folder = isoFolder();
      const api = pathApiFor(folder);
      const parent = api.dirname(source.full);
      if (api.resolve(parent) !== api.resolve(folder) && (await readdir(parent).catch(() => ['?'])).length === 0) await rmdir(parent).catch(() => {});
      reads.delete(key);
      log(`Image «${source.iso}» im ISO-Ordner gelöscht.`);
      return { deleted: source.iso };
    },

    rip: (request: DiscRipRequest) => enqueue(request, false),

    cancel(id: string): DiscRip {
      const job = jobs.find((entry) => entry.view.id === id);
      if (!job) throw new AgentError(404, 'Diesen Auftrag gibt es nicht (mehr).');
      if (job.view.state === 'queued') {
        job.view.state = 'canceled';
        job.view.finishedAt = new Date().toISOString();
      }
      job.abort.abort();
      return snapshot(job.view);
    },

    async eject(index: number): Promise<void> {
      const drive = await findDrive(index);
      if (busy.has(driveKey(index))) throw new AgentError(409, 'Das Laufwerk ist gerade beschäftigt.');
      await eject(drive.device);
      reads.delete(driveKey(index));
      drives = null;
    },

    async setSettings(settings: DiscSettings): Promise<DiscSettings> {
      const before = options.settings.get().isoFolder ?? null;
      await options.settings.set(settings);
      if ((settings.isoFolder ?? null) !== before) {
        // What was read from images of the old folder says nothing about those of the new one.
        for (const [key, read] of reads) {
          if (read.drive !== null) continue;
          readAborts.get(key)?.abort();
          reads.delete(key);
        }
      }
      if (watching(settings)) void tick();
      return settings;
    },

    /** The rip that a restart would interrupt. */
    running: (): DiscRip | null => jobs.find((job) => job.view.state === 'running')?.view ?? null,

    /** A rip that runs or waits its turn: an update's restart waits for it. */
    active: (): DiscRip | null => {
      const job = jobs.find((entry) => entry.view.state === 'running') ?? jobs.find((entry) => active(entry.view));
      return job ? snapshot(job.view) : null;
    },

    /** Before a restart: no new rip and no read starts from now on – neither asked for nor automatic. */
    hold() {
      held = true;
    },

    tick,

    start() {
      if (options.tickMs && !timer) {
        timer = setInterval(() => void tick(), options.tickMs);
        timer.unref();
      }
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const job of jobs) job.abort.abort();
    },

    /** Resolves once nothing waits or runs any more (tests). */
    async idle(): Promise<void> {
      while (ticking || working || jobs.some((job) => active(job.view))) {
        await ticking;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await saving;
    },
  };
}

export type Discs = ReturnType<typeof createDiscs>;
