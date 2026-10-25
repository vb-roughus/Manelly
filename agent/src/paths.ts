import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ConversionRequest } from '@manelly/shared';
import { AgentError } from './errors.js';

export const SOURCE_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.ts', '.m2ts', '.mts']);
/** Folders Jellyfin skips while scanning (dot folders, plus a .ignore file inside). */
export const BACKUP_FOLDER = '.manelly-backup';
export const TEMP_FOLDER_PREFIX = '.manelly-tmp-';

export type PathApi = typeof path.posix;

/** Windows paths ("D:\…", "\\nas\…") need win32 semantics, whatever system reads them. */
export function pathApiFor(file: string, platform: NodeJS.Platform = process.platform): PathApi {
  return platform === 'win32' || /^[a-zA-Z]:[\\/]|^\\\\/.test(file) ? path.win32 : path.posix;
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** A single path segment that is valid on Windows and everywhere else. */
export function isValidSegment(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    name !== '.' &&
    name !== '..' &&
    !/[<>:"/\\|?*\u0000-\u001f]/.test(name) &&
    !/[ .]$/.test(name) &&
    !RESERVED_NAMES.test(name)
  );
}

export function isWithin(child: string, root: string, api: PathApi): boolean {
  const normalize = (value: string) => {
    const resolved = api.resolve(value);
    return api === path.win32 ? resolved.toLowerCase() : resolved;
  };
  const relative = api.relative(normalize(root), normalize(child));
  return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative));
}

function samePath(a: string, b: string, api: PathApi): boolean {
  return api === path.win32 ? api.resolve(a).toLowerCase() === api.resolve(b).toLowerCase() : api.resolve(a) === api.resolve(b);
}

async function kindOf(file: string): Promise<'file' | 'directory' | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? 'file' : info.isDirectory() ? 'directory' : null;
  } catch {
    return null;
  }
}

export interface OutputPlan {
  /** Folder the converted file ends up in; the temporary files live in a dot folder inside it. */
  directory: string;
  output: string;
  backup: string | null;
  /** folder mode: the subfolder does not exist yet. */
  createDirectory: boolean;
}

function stem(file: string, api: PathApi): string {
  return api.basename(file, api.extname(file));
}

export function defaultFileName(source: string, mode: ConversionRequest['output']['mode']): string {
  const api = pathApiFor(source);
  return mode === 'alongside' ? `${stem(source, api)} - DV P8.mkv` : `${stem(source, api)}.mkv`;
}

/** Checks a request and works out where everything goes – before any file is touched. */
export async function planOutput(request: ConversionRequest, roots: string[], platform: NodeJS.Platform = process.platform): Promise<OutputPlan> {
  const { source, output } = request;
  const api = pathApiFor(source, platform);
  const allowed = (file: string) => roots.length === 0 || roots.some((root) => isWithin(file, root, api));

  if (typeof source !== 'string' || !api.isAbsolute(source)) throw new AgentError(400, 'Die Quelldatei braucht einen absoluten Pfad.');
  if (!SOURCE_EXTENSIONS.has(api.extname(source).toLowerCase())) {
    throw new AgentError(400, `Dateityp ${api.extname(source) || '(ohne Endung)'} wird nicht unterstützt.`);
  }
  if (!allowed(source)) throw new AgentError(403, `${source} liegt ausserhalb der freigegebenen Ordner.`);
  if ((await kindOf(source)) !== 'file') throw new AgentError(404, `Die Datei ${source} wurde nicht gefunden.`);

  const fileName = output.fileName ?? defaultFileName(source, output.mode);
  if (!isValidSegment(fileName) || api.extname(fileName).toLowerCase() !== '.mkv') {
    throw new AgentError(400, `«${fileName}» ist kein gültiger Dateiname; er muss auf .mkv enden.`);
  }

  let directory = api.dirname(source);
  let createDirectory = false;
  let backup: string | null = null;

  if (output.mode === 'folder') {
    const base = output.directory;
    if (!base || !api.isAbsolute(base)) throw new AgentError(400, 'Für «Anderer Ordner» fehlt der Zielordner.');
    if (!allowed(base)) throw new AgentError(403, `${base} liegt ausserhalb der freigegebenen Ordner.`);
    if ((await kindOf(base)) !== 'directory') throw new AgentError(404, `Der Ordner ${base} wurde nicht gefunden.`);
    directory = base;
    if (output.subfolder) {
      if (!isValidSegment(output.subfolder)) throw new AgentError(400, `«${output.subfolder}» ist kein gültiger Ordnername.`);
      directory = api.join(base, output.subfolder);
      const kind = await kindOf(directory);
      if (kind === 'file') throw new AgentError(409, `${directory} ist eine Datei, kein Ordner.`);
      createDirectory = kind === null;
    }
  } else if (output.mode === 'replace') {
    backup = api.join(directory, BACKUP_FOLDER, api.basename(source));
    if (await kindOf(backup)) {
      // Keep earlier backups: "Film.mkv" → "Film.2026-10-25T18-30-00.mkv".
      const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      backup = api.join(directory, BACKUP_FOLDER, `${stem(source, api)}.${stamp}${api.extname(source)}`);
    }
  } else if (output.mode !== 'alongside') {
    throw new AgentError(400, 'Unbekannter Speicherort.');
  }

  const target = output.mode === 'replace' ? api.join(directory, `${stem(source, api)}.mkv`) : api.join(directory, fileName);
  if (output.mode !== 'replace' && samePath(target, source, api)) {
    throw new AgentError(409, 'Die umgewandelte Datei braucht einen anderen Namen als das Original.');
  }
  // Replacing an .mkv reuses its name; any other existing file stays untouched.
  if (!(output.mode === 'replace' && samePath(target, source, api)) && (await kindOf(target))) {
    throw new AgentError(409, `${target} gibt es schon – Manelly überschreibt keine Dateien.`);
  }
  return { directory, output: target, backup, createDirectory };
}
