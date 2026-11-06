import { spawn } from 'node:child_process';
import type { DiscActivity, DiscDrive, DiscInfo, DiscMessage, DiscStream, DiscTitle } from '@manelly/shared';

/** Titles shorter than this are menus, trailers and the like. */
export const MIN_TITLE_SECONDS = 60;
const LIST_TIMEOUT_MS = 30_000;
/** A scratched disc or one with a copy protection of many fake titles keeps MakeMKV busy for long; it can be canceled. */
const READ_TIMEOUT_MS = 30 * 60_000;
/** Messages kept for the details. */
const KEEP_MESSAGES = 60;

/** One line of makemkvcon's robot mode (-r), e.g. `TINFO:0,9,0,"1:58:32"`, split into its kind and fields. */
export function parseRobotLine(line: string): { kind: string; fields: string[] } | null {
  const match = /^([A-Z]+):(.*)$/.exec(line.trim());
  if (!match) return null;
  const fields: string[] = [];
  const text = match[2]!;
  let current = '';
  let quoted = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (quoted) {
      // Quotes inside a value come as \" (or doubled); a backslash otherwise stays – Windows paths.
      if (char === '\\' && text[at + 1] === '"') {
        current += '"';
        at++;
      } else if (char === '"' && text[at + 1] === '"') {
        current += '"';
        at++;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(current);
      current = '';
    } else current += char;
  }
  fields.push(current);
  return { kind: match[1]!, fields };
}

/** The text of a MSG line: `MSG:code,flags,count,"message",…`. */
const messageOf = (fields: string[]) => fields[3] ?? '';

/** MakeMKV's states of a drive; 256 and more: no drive at that number. */
const DRIVE_STATES: Record<number, DiscDrive['state']> = { 0: 'empty', 1: 'open', 2: 'inserted', 3: 'loading' };
/** Flags of the file systems on a disc. */
const DVD_FILES = 1;
const BLURAY_FILES = 4;

/** The drives in `DRV:index,state,enabled,flags,"drive","disc","device"` lines. */
export function parseDrives(lines: string[]): Array<Omit<DiscDrive, 'busy'>> {
  const drives: Array<Omit<DiscDrive, 'busy'>> = [];
  for (const line of lines) {
    const parsed = parseRobotLine(line);
    if (parsed?.kind !== 'DRV') continue;
    const [index, state, , flags, name, disc, device] = parsed.fields;
    const known = DRIVE_STATES[Number(state)];
    if (!known || !name) continue;
    const bits = Number(flags) || 0;
    drives.push({
      index: Number(index),
      state: known,
      name: name.trim(),
      device: device ?? '',
      disc: known === 'inserted' && disc ? disc : null,
      kind: known !== 'inserted' ? null : bits & BLURAY_FILES ? 'bluray' : bits & DVD_FILES ? 'dvd' : null,
    });
  }
  return drives;
}

/** "1:58:32" → 7112. */
export function durationSeconds(text: string): number {
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// The attributes of CINFO, TINFO and SINFO lines that matter here (apdefs.h of MakeMKV).
const TYPE = 1;
const NAME = 2;
const LANG_CODE = 3;
const LANG_NAME = 4;
const CODEC_SHORT = 6;
const CHAPTERS = 8;
const DURATION = 9;
const SIZE_BYTES = 11;
const CHANNELS = 14;
const VIDEO_SIZE = 19;
const ASPECT = 20;
const VOLUME = 32;
const CHANNEL_LAYOUT = 40;
/** What SINFO type 1 says, as a number in its code field. */
const VIDEO = '6201';
const AUDIO = '6202';
const SUBTITLES = '6203';

/** The disc and its titles from the output of `makemkvcon -r info disc:N`. */
export function parseDiscInfo(drive: number, lines: string[], now = new Date()): DiscInfo {
  const disc = new Map<number, string>();
  const titles = new Map<number, Map<number, string>>();
  const streams = new Map<number, Map<number, { type: string; values: Map<number, string> }>>();
  for (const line of lines) {
    const parsed = parseRobotLine(line);
    if (!parsed) continue;
    const numbers = parsed.fields.map(Number);
    if (parsed.kind === 'CINFO') disc.set(numbers[0]!, parsed.fields[2] ?? '');
    else if (parsed.kind === 'TINFO') {
      const title = titles.get(numbers[0]!) ?? new Map<number, string>();
      title.set(numbers[1]!, parsed.fields[3] ?? '');
      titles.set(numbers[0]!, title);
    } else if (parsed.kind === 'SINFO') {
      const byTitle = streams.get(numbers[0]!) ?? new Map();
      const stream = byTitle.get(numbers[1]!) ?? { type: '', values: new Map<number, string>() };
      if (numbers[2] === TYPE) stream.type = parsed.fields[3] ?? '';
      stream.values.set(numbers[2]!, parsed.fields[4] ?? '');
      byTitle.set(numbers[1]!, stream);
      streams.set(numbers[0]!, byTitle);
    }
  }
  const text = (values: Map<number, string>, id: number) => values.get(id)?.trim() || null;
  const stream = (values: Map<number, string>): DiscStream => ({
    language: text(values, LANG_CODE),
    languageName: text(values, LANG_NAME),
    codec: text(values, CODEC_SHORT),
    channels: text(values, CHANNEL_LAYOUT) ?? (text(values, CHANNELS) ? `${text(values, CHANNELS)} Kanäle` : null),
  });

  const list: DiscTitle[] = [...titles.entries()]
    .map(([index, values]) => {
      const own = [...(streams.get(index)?.values() ?? [])];
      const video = own.find((entry) => entry.type === VIDEO);
      const bytes = Number(values.get(SIZE_BYTES));
      return {
        index,
        durationSeconds: durationSeconds(values.get(DURATION) ?? ''),
        chapters: Number(values.get(CHAPTERS)) || 0,
        bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null,
        video: video ? { size: text(video.values, VIDEO_SIZE), aspect: text(video.values, ASPECT), codec: text(video.values, CODEC_SHORT) } : null,
        audio: own.filter((entry) => entry.type === AUDIO).map((entry) => stream(entry.values)),
        subtitles: own.filter((entry) => entry.type === SUBTITLES).map((entry) => stream(entry.values)),
      };
    })
    .filter((title) => title.durationSeconds >= MIN_TITLE_SECONDS)
    .sort((a, b) => a.index - b.index);
  const label = disc.get(VOLUME)?.trim() || null;
  return { drive, name: disc.get(NAME)?.trim() || label || `Disc ${drive}`, label, type: disc.get(TYPE)?.trim() || null, titles: list, readAt: now.toISOString() };
}

/** MakeMKV's first message, "MakeMKV v1.17.7 … started". */
const STARTED = '1005';

/** Flags of messages meant for debugging, not for people. */
const HIDDEN = 64;
const DEBUG = 32;
const SOUNDS_WRONG = /error|fail|unable|cannot|can't|too old|expired|corrupt|fehler/i;

/**
 * What MakeMKV is at, kept up to date in `target` from its output: steps (PRGT, PRGC), progress (PRGV) and messages
 * (MSG).
 */
export function createActivity<T extends DiscActivity>(target: T, now: () => Date = () => new Date()) {
  const fresh: Required<DiscActivity> = { step: null, stepProgress: null, messages: [] };
  const activity = Object.assign(target, fresh) as T & Required<DiscActivity>;
  let operation: string | null = null;
  let part: string | null = null;
  return {
    activity,
    take(line: string) {
      const parsed = parseRobotLine(line);
      if (!parsed) return;
      if (parsed.kind === 'MSG') {
        const text = messageOf(parsed.fields).trim();
        if (!text || parsed.fields[0] === STARTED || (Number(parsed.fields[1]) || 0) & (HIDDEN | DEBUG)) return;
        const message: DiscMessage = { at: now().toISOString(), text, error: SOUNDS_WRONG.test(text) };
        activity.messages.push(message);
        if (activity.messages.length > KEEP_MESSAGES) activity.messages.splice(0, activity.messages.length - KEEP_MESSAGES);
      } else if (parsed.kind === 'PRGT' || parsed.kind === 'PRGC') {
        // PRGT names the whole operation, PRGC its current part.
        const name = parsed.fields[2]?.trim() || null;
        if (parsed.kind === 'PRGT') {
          operation = name;
          part = null;
          activity.stepProgress = null;
        } else part = name;
        activity.step = [operation, part].filter((value, at, all) => value && all.indexOf(value) === at).join(' – ') || null;
      } else if (parsed.kind === 'PRGV') {
        const [, total, max] = parsed.fields.map(Number);
        if (max! > 0) activity.stepProgress = Math.min(1, total! / max!);
      }
    },
  };
}

/** What makemkvcon said last, for when it fails: the last messages that are not progress. */
function lastMessages(lines: string[], count = 2): string {
  return lines
    .map(parseRobotLine)
    .filter((parsed) => parsed?.kind === 'MSG' && parsed.fields[0] !== STARTED && !((Number(parsed.fields[1]) || 0) & (HIDDEN | DEBUG)))
    .map((parsed) => messageOf(parsed!.fields))
    .filter(Boolean)
    .slice(-count)
    .join(' ');
}

export interface RunOptions {
  onLine?: (line: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Runs makemkvcon to its end; answers its output lines, or fails with what it said last. */
export function runMakemkv(tool: string, args: string[], options: RunOptions = {}): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : null;
    const lines: string[] = [];
    let buffer = '';
    const take = (line: string) => {
      if (!line.trim()) return;
      lines.push(line);
      // Progress comes often; only the messages are kept for errors.
      if (lines.length > 2000) lines.splice(0, lines.length - 1000);
      options.onLine?.(line);
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? '';
      parts.forEach(take);
    });
    let errors = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (errors = (errors + chunk).slice(-2000)));
    const abort = () => child.kill();
    options.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => reject(new Error(`MakeMKV liess sich nicht starten: ${error.message}`)));
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      take(buffer);
      if (code === 0 && !timedOut) return resolve(lines);
      const said = lastMessages(lines) || errors.trim().split(/\r?\n/).pop() || '';
      if (options.signal?.aborted) return reject(new Error('Abgebrochen.'));
      if (timedOut) {
        const seconds = Math.round((options.timeoutMs ?? 0) / 1000);
        const waited = seconds >= 60 ? `${Math.round(seconds / 60)} Minuten` : `${seconds} Sekunden`;
        return reject(new Error(`MakeMKV war nach ${waited} nicht fertig und wurde abgebrochen.${said ? ` Zuletzt: ${said}` : ''}`));
      }
      reject(new Error(signal ? `MakeMKV wurde beendet (${signal}).${said ? ` Zuletzt: ${said}` : ''}` : `MakeMKV ist fehlgeschlagen (Exit-Code ${code})${said ? `: ${said}` : '.'}`));
    });
  });
}

/** The drives, without reading the discs in them. */
export async function listDrives(tool: string): Promise<Array<Omit<DiscDrive, 'busy'>>> {
  return parseDrives(await runMakemkv(tool, ['-r', '--cache=1', 'info', 'disc:9999'], { timeoutMs: LIST_TIMEOUT_MS }));
}

/** Reads the titles of the disc in a drive – for a DVD usually some seconds to a minute; `onLine` sees the progress. */
export async function readDisc(tool: string, drive: number, options: { signal?: AbortSignal; onLine?: (line: string) => void } = {}): Promise<DiscInfo> {
  const lines = await runMakemkv(tool, ['-r', '--progress=-same', `--minlength=${MIN_TITLE_SECONDS}`, 'info', `disc:${drive}`], {
    timeoutMs: READ_TIMEOUT_MS,
    ...options,
  });
  const info = parseDiscInfo(drive, lines);
  if (!lines.some((line) => line.startsWith('TCOUNT:') || line.startsWith('TINFO:'))) {
    throw new Error(`MakeMKV konnte die Disc nicht lesen${lastMessages(lines) ? `: ${lastMessages(lines)}` : '.'}`);
  }
  return info;
}

/**
 * Saves one title as MKV into `directory`. `onProgress` gets 0–1 of the saving, as MakeMKV counts it (PRGV after the
 * "Saving" step began). Answers what MakeMKV said last – it may end well without having saved anything.
 */
export async function ripTitle(
  tool: string,
  drive: number,
  title: number,
  directory: string,
  onProgress: (share: number) => void,
  options: { signal?: AbortSignal; onLine?: (line: string) => void } = {},
): Promise<string> {
  let saving = false;
  const lines = await runMakemkv(tool, ['-r', '--progress=-same', `--minlength=${MIN_TITLE_SECONDS}`, 'mkv', `disc:${drive}`, String(title), directory], {
    signal: options.signal,
    onLine: (line) => {
      options.onLine?.(line);
      const parsed = parseRobotLine(line);
      if (!parsed) return;
      // PRGT names the step whose total the PRGV values count; opening the disc comes before saving.
      if (parsed.kind === 'PRGT') saving = /sav|speicher/i.test(parsed.fields[2] ?? '');
      else if (parsed.kind === 'PRGV' && saving) {
        const [, total, max] = parsed.fields.map(Number);
        if (max! > 0) onProgress(Math.min(1, total! / max!));
      }
    },
  });
  return lastMessages(lines);
}
