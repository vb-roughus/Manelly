import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import type { DiscDrive, DiscInfo, DiscRead, DiscRip, DiscRipRequest, DiscSettings, DiscsStatus, DiscTitle } from '@manelly/shared';
import { formatBytes } from './convert.js';
import { AgentError } from './errors.js';
import { listDrives, readDisc, ripTitle } from './makemkv.js';
import { isValidSegment, pathApiFor, TEMP_FOLDER_PREFIX } from './paths.js';
import { defaultPowershell, runPowershell } from './powershell.js';

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

/** Ejects a disc: on Windows through the drive itself, as Explorer does it – also without anybody logged on. */
export async function ejectDisc(device: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === 'win32') {
    const letter = /^([A-Za-z]):?\\?$/.exec(device)?.[1];
    if (!letter) throw new Error(`Unbekanntes Laufwerk «${device}».`);
    await runPowershell(
      defaultPowershell(),
      `$ErrorActionPreference = 'Stop'
Add-Type @'
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
$handle = [ManellyEject]::CreateFile('\\\\.\\${letter}:', 0x80000000, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
if ($handle -eq [IntPtr]-1) { throw "Das Laufwerk ${letter}: liess sich nicht öffnen." }
$returned = 0
# IOCTL_STORAGE_EJECT_MEDIA
$ok = [ManellyEject]::DeviceIoControl($handle, 0x2D4808, [IntPtr]::Zero, 0, [IntPtr]::Zero, 0, [ref]$returned, [IntPtr]::Zero)
$code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
[ManellyEject]::CloseHandle($handle) | Out-Null
if (-not $ok) { throw "Windows lehnte das Auswerfen ab (Fehler $code)." }`,
    );
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
}

interface Job {
  view: DiscRip;
  /** The drive's device, for ejecting. */
  device: string;
  abort: AbortController;
  samples: Array<{ t: number; bytes: number }>;
}

const active = (rip: DiscRip) => rip.state === 'queued' || rip.state === 'running';
/** A copy for the answer; the job itself goes on changing. */
const snapshot = (rip: DiscRip): DiscRip => ({ ...rip, titles: rip.titles.map((title) => ({ ...title })) });

/**
 * Reads DVDs with MakeMKV and rips their titles into a new folder of the extraction folder, one rip after the other,
 * without changing the picture or sound. Only the drives MakeMKV names are touched.
 */
export function createDiscs(options: DiscsOptions) {
  const { log = () => {} } = options;
  const eject = options.eject ?? ((device: string) => ejectDisc(device));
  const jobs: Job[] = [];
  const reads = new Map<number, DiscRead>();
  const busy = new Set<number>();
  /** The disc the automatic mode already took, per drive, until the drive is empty again. */
  const handled = new Map<number, string>();
  let drives: { at: number; list: Array<Omit<DiscDrive, 'busy'>> } | null = null;
  let driveError: string | null = null;
  let working = false;
  let timer: NodeJS.Timeout | null = null;
  /** The look of the automatic mode under way; a second one waits for it. */
  let ticking: Promise<void> | null = null;

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
    if (drives && (busy.size > 0 || Date.now() - drives.at < DRIVES_FRESH_MS)) return drives.list;
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

  async function readNow(tool: string, drive: number): Promise<DiscInfo> {
    busy.add(drive);
    reads.set(drive, { drive, state: 'reading', info: null, error: null });
    try {
      const info = await readDisc(tool, drive);
      reads.set(drive, { drive, state: 'done', info, error: null });
      return info;
    } catch (error) {
      reads.set(drive, { drive, state: 'failed', info: null, error: (error as Error).message });
      throw error;
    } finally {
      busy.delete(drive);
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
    busy.add(view.drive);
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
          const said = await ripTitle(tool, view.drive, title.index, temp, (share) => (saved = share), job.abort.signal);
          const made = (await readdir(temp)).filter((name) => !before.has(name) && name.toLowerCase().endsWith('.mkv'));
          if (made.length === 0) throw new Error(`MakeMKV hat Titel ${title.index + 1} nicht gespeichert${said ? `: ${said}` : '.'}`);
          await rename(api.join(temp, made[0]!), destination);
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
      view.error = view.state === 'failed' ? (failed?.error ?? null) : null;
      log(`Disc «${view.disc}» → ${view.folder}: ${done()} von ${view.titles.length} Titeln${view.state === 'done' ? '' : ` (${view.state === 'canceled' ? 'abgebrochen' : view.error})`}`);
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
      busy.delete(view.drive);
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
    const drive = (await currentDrives(tool)).find((candidate) => candidate.index === request.drive);
    if (!drive) throw new AgentError(404, `Laufwerk ${request.drive} gibt es nicht.`);
    if (drive.state !== 'inserted') throw new AgentError(409, 'Im Laufwerk liegt keine Disc.');
    if (jobs.some((job) => active(job.view) && job.view.drive === drive.index)) throw new AgentError(409, 'Von dieser Disc wird schon gerippt.');
    await options.prepare?.(target);
    const api = pathApiFor(target);
    for (const title of request.titles) {
      if (await exists(api.join(target, folder, title.fileName))) throw new AgentError(409, `«${folder}/${title.fileName}» gibt es im Entpack-Ordner schon.`);
    }
    // The sizes MakeMKV named when it read the disc.
    const known = reads.get(drive.index)?.info?.titles ?? [];
    const bytes = request.titles.map((title) => known.find((candidate) => candidate.index === title.index)?.bytes ?? null);
    const needed = bytes.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const free = (await options.freeBytes?.(target)) ?? null;
    if (free !== null && needed * SPACE_MARGIN > free) {
      throw new AgentError(409, `Zu wenig Platz im Entpack-Ordner: braucht etwa ${formatBytes(needed)}, frei sind ${formatBytes(free)}.`);
    }
    const view: DiscRip = {
      id: randomUUID(),
      drive: drive.index,
      disc: reads.get(drive.index)?.info?.name ?? drive.disc ?? `Disc ${drive.index}`,
      folder,
      titles: request.titles.map((title, at) => ({ index: title.index, fileName: title.fileName, bytes: bytes[at] ?? null, state: 'waiting', error: null })),
      state: 'queued',
      progress: 0,
      bytesPerSecond: null,
      error: null,
      eject: request.eject ?? options.settings.get().eject,
      auto,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    jobs.unshift({ view, device: drive.device, abort: new AbortController(), samples: [] });
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

  /** The automatic mode: a new disc is read, its main title ripped and the disc ejected. */
  function tick(): Promise<void> {
    ticking ??= look().finally(() => (ticking = null));
    return ticking;
  }

  async function look(): Promise<void> {
    if (!options.settings.get().auto) return;
    const tool = await options.tool();
    const target = options.target();
    if (!tool || !target || jobs.some((job) => active(job.view))) return;
    for (const drive of await currentDrives(tool)) {
      if (drive.state !== 'inserted') {
        handled.delete(drive.index);
        continue;
      }
      const key = drive.disc ?? '';
      if (busy.has(drive.index) || handled.get(drive.index) === key) continue;
      handled.set(drive.index, key);
      try {
        const info = await readNow(tool, drive.index);
        const main = mainTitle(info.titles);
        if (!main) continue;
        const folder = await freeFolder(target, folderNameFrom(info.name) ?? folderNameFrom(drive.disc ?? '') ?? `Disc ${new Date().toISOString().slice(0, 10)}`);
        await enqueue({ drive: drive.index, folder, titles: [{ index: main.index, fileName: `${folder}.mkv` }], eject: true }, true);
      } catch (error) {
        log(`Automatisches Rippen von «${key}» ging nicht: ${(error as Error).message}`);
      }
    }
  }

  return {
    async status(): Promise<DiscsStatus> {
      const tool = await options.tool();
      const list = tool ? await currentDrives(tool) : [];
      return {
        tool,
        drives: list.map((drive) => ({ ...drive, busy: busy.has(drive.index) })),
        reads: [...reads.values()],
        rips: jobs.map((job) => snapshot(job.view)),
        settings: options.settings.get(),
        target: options.target(),
        error: tool ? driveError : null,
      };
    },

    /** Starts reading the titles of the disc in a drive; GET /api/discs tells when it is done. */
    async read(index: number): Promise<DiscRead> {
      const tool = await requireTool();
      const drive = await findDrive(index);
      if (busy.has(index)) throw new AgentError(409, 'Das Laufwerk ist gerade beschäftigt.');
      if (drive.state !== 'inserted') throw new AgentError(409, 'Im Laufwerk liegt keine Disc.');
      void readNow(tool, index).catch(() => {});
      return reads.get(index)!;
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
      if (busy.has(index)) throw new AgentError(409, 'Das Laufwerk ist gerade beschäftigt.');
      await eject(drive.device);
      reads.delete(index);
      drives = null;
    },

    async setSettings(settings: DiscSettings): Promise<DiscSettings> {
      await options.settings.set(settings);
      if (settings.auto) void tick();
      return settings;
    },

    /** The rip that a restart would interrupt. */
    running: (): DiscRip | null => jobs.find((job) => job.view.state === 'running')?.view ?? null,

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
    },
  };
}

export type Discs = ReturnType<typeof createDiscs>;
