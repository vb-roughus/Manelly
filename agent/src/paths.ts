import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ConversionRequest } from '@manelly/shared';
import { AgentError } from './errors.js';

export const SOURCE_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.ts', '.m2ts', '.mts']);
/** Folders Jellyfin skips while scanning (dot folders, plus a .ignore file inside). */
export const BACKUP_FOLDER = '.manelly-backup';
export const TEMP_FOLDER_PREFIX = '.manelly-tmp-';
/** In the work folder: the originals that conversions replaced, until they are deleted in Manelly. */
export const ARCHIVE_FOLDER = 'Originale';

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
  return (await inspect(file)).kind;
}

/** What is at a path, and when nothing is reachable there, the error code that says why. */
async function inspect(file: string): Promise<{ kind: 'file' | 'directory' | null; code: string | null }> {
  try {
    const info = await stat(file);
    return { kind: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : null, code: null };
  } catch (error) {
    return { kind: null, code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' };
  }
}

/** How the agent reaches the paths Manelly names: network drives it connects first, and what helps when it cannot. */
export interface PathAccess {
  /** Connects what a path needs, e.g. its network drive; resolves to why it cannot be reached, or null. */
  prepare(path: string): Promise<string | null>;
  /** Added when a network path refuses access, e.g. how the agent gets credentials. */
  networkHint: string | null;
}

const isNetworkPath = (file: string) => /^\\\\[^\\]/.test(file);

/** Why a path Manelly named is not there for the agent: missing, or not reachable – and what helps. */
function unreachable(what: 'Die Datei' | 'Der Ordner', file: string, code: string | null, access: PathAccess | undefined): string {
  const hint = isNetworkPath(file) && access?.networkHint ? ` ${access.networkHint}` : '';
  if (code === 'EACCES' || code === 'EPERM') return `Kein Zugriff auf ${file}.${hint}`;
  if (code && code !== 'ENOENT' && code !== 'ENOTDIR') return `${file} ist für den Agent nicht erreichbar (${code}).${hint}`;
  return `${what} ${file} wurde nicht gefunden.`;
}

/** The kind of a path, after connecting what it needs; throws why when it is not the expected kind. */
async function requireKind(what: 'Die Datei' | 'Der Ordner', file: string, kind: 'file' | 'directory', access: PathAccess | undefined): Promise<void> {
  const problem = await access?.prepare(file);
  const found = await inspect(file);
  if (found.kind === kind) return;
  throw new AgentError(404, problem ?? unreachable(what, file, found.kind ? null : found.code, access));
}

export interface OutputPlan {
  /** Folder the converted file ends up in; the temporary files live in a dot folder inside it. */
  directory: string;
  output: string;
  backup: string | null;
  /** folder mode: the subfolder does not exist yet. */
  createDirectory: boolean;
  /**
   * The work folder to convert in: the original is copied there and the result back. Null converts where the files
   * are; missing in jobs from before agent 0.17.0.
   */
  work?: string | null;
}

function stem(file: string, api: PathApi): string {
  return api.basename(file, api.extname(file));
}

/** "Film.2026-10-25T18-30-00.mkv": another name for a file whose name is taken already. */
function stamped(file: string, api: PathApi): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return api.join(api.dirname(file), `${stem(file, api)}.${stamp}${api.extname(file)}`);
}

/** Where a replaced original goes in the work folder: under its own name, or with a time stamp when that is taken. */
export async function archivePath(work: string, source: string): Promise<string> {
  const api = pathApiFor(work);
  const path = api.join(work, ARCHIVE_FOLDER, pathApiFor(source).basename(source));
  return (await kindOf(path)) ? stamped(path, api) : path;
}

export function defaultFileName(source: string, mode: ConversionRequest['output']['mode']): string {
  const api = pathApiFor(source);
  return mode === 'alongside' ? `${stem(source, api)} - DV P8.mkv` : `${stem(source, api)}.mkv`;
}

/**
 * Checks a request and works out where everything goes – before any file is touched. `workFolder` is the agent's
 * work folder, for a request that asks to convert there.
 */
export async function planOutput(
  request: ConversionRequest,
  roots: string[],
  platform: NodeJS.Platform = process.platform,
  access?: PathAccess,
  workFolder: string | null = null,
): Promise<OutputPlan> {
  const { source, output } = request;
  const api = pathApiFor(source, platform);
  const allowed = (file: string) => roots.length === 0 || roots.some((root) => isWithin(file, root, api));

  if (typeof source !== 'string' || !api.isAbsolute(source)) throw new AgentError(400, 'Die Quelldatei braucht einen absoluten Pfad.');
  if (!SOURCE_EXTENSIONS.has(api.extname(source).toLowerCase())) {
    throw new AgentError(400, `Dateityp ${api.extname(source) || '(ohne Endung)'} wird nicht unterstützt.`);
  }
  if (!allowed(source)) throw new AgentError(403, `${source} liegt ausserhalb der freigegebenen Ordner.`);
  await requireKind('Die Datei', source, 'file', access);

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
    await requireKind('Der Ordner', base, 'directory', access);
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
    // Keep earlier backups: "Film.mkv" → "Film.2026-10-25T18-30-00.mkv".
    if (await kindOf(backup)) backup = stamped(backup, api);
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

  let work: string | null = null;
  if (request.work === true) {
    if (!workFolder) throw new AgentError(400, 'Für den Agent ist kein Arbeitsordner eingerichtet – in Manelly unter Umwandlungen eintragen.');
    await requireKind('Der Ordner', workFolder, 'directory', access);
    work = workFolder;
    // Replaced in the work folder, the original stays there instead of in a backup folder on the storage.
    if (output.mode === 'replace') backup = await archivePath(work, source);
  }
  return { directory, output: target, backup, createDirectory, work };
}
