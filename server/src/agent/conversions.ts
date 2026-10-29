import path from 'node:path';
import type { ConversionJob, ConversionOptions, ConversionRequest, StartConversionRequest } from '@manelly/shared';
import { AppError } from '../errors.js';
import type { JellyfinClient } from '../jellyfin/client.js';
import type { JfBaseItem, JfMediaSource } from '../jellyfin/types.js';
import { VIDEO_LIBRARIES } from '../media/indexer.js';
import type { MediaIndexStore } from '../media/store.js';
import { isDolbyVisionProfile7 } from '../media/streams.js';
import type { AgentClient } from './client.js';
import type { AgentConnection } from './connection.js';

/** The extracted and the converted video stream exist side by side for a while. */
const SPACE_FACTOR = 2.1;
// In the work folder the copy of the original comes on top; at the target only the result is copied to.
const WORK_SPACE_FACTOR = 3.1;
const TARGET_SPACE_FACTOR = 1.05;
const TICKS_PER_MS = 10_000;

/** Jellyfin on Windows reports "D:\…" or "\\nas\…" paths, whatever system Manelly runs on. */
export function pathApiFor(file: string) {
  return /^[a-zA-Z]:[\\/]|^\\\\/.test(file) ? path.win32 : path.posix;
}

export function requireAgent(agent: AgentConnection): AgentClient {
  if (!agent.client) {
    throw new AppError('BAD_REQUEST', 'Es ist noch kein Agent eingerichtet. Trage ihn unter Einstellungen → Agent ein.');
  }
  return agent.client;
}

interface Source {
  item: JfBaseItem;
  source: JfMediaSource & { Path: string };
  video: NonNullable<JfMediaSource['MediaStreams']>[number] | undefined;
}

/** The file to convert: the item's Dolby Vision profile 7 version (or the one asked for). */
async function findSource(client: JellyfinClient, itemId: string, mediaSourceId?: string): Promise<Source> {
  const result = await client.getItems(
    new URLSearchParams({ ids: itemId, fields: 'Path,MediaSources,ProductionYear', enableImages: 'false', enableUserData: 'false' }),
  );
  const item = result.Items?.[0];
  if (!item) throw new AppError('NOT_FOUND', 'Diesen Titel kennt Jellyfin nicht (mehr).');
  const videoOf = (source: JfMediaSource) => source.MediaStreams?.find((stream) => stream.Type === 'Video');
  const isP7 = (source: JfMediaSource) => {
    const video = videoOf(source);
    return Boolean(video && isDolbyVisionProfile7({ videoRangeType: video.VideoRangeType ?? null, dvProfile: video.DvProfile ?? null }));
  };
  const sources = item.MediaSources ?? [];
  const source = mediaSourceId ? sources.find((candidate) => candidate.Id === mediaSourceId) : sources.find(isP7);
  if (!source || !isP7(source)) throw new AppError('BAD_REQUEST', 'Dieser Titel hat keine Version mit Dolby Vision Profil 7.');
  if (!source.Path) throw new AppError('BAD_REQUEST', 'Jellyfin nennt für diese Version keinen Dateipfad.');
  return { item, source: source as Source['source'], video: videoOf(source) };
}

/** Folders of the libraries a movie can go into: movie and mixed libraries. */
async function libraryFolders(client: JellyfinClient): Promise<Array<{ library: string; path: string }>> {
  const libraries = await client.getLibraries();
  return libraries
    .filter((library) => VIDEO_LIBRARIES[library.CollectionType ?? 'mixed']?.includes('Movie'))
    .flatMap((library) => (library.Locations ?? []).map((location) => ({ library: library.Name ?? 'Bibliothek', path: location })));
}

export const samePath = (a: string, b: string) => {
  const api = pathApiFor(a);
  const normalize = (value: string) => api.normalize(value).replace(/[\\/]+$/, '');
  return api === path.win32 ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);
};

/** Whether `child` is `folder` or lies somewhere in it; Windows paths in any case. */
export function isInFolder(child: string, folder: string): boolean {
  const api = pathApiFor(folder);
  const fold = (value: string) => {
    const normal = api.normalize(value).replace(/[\\/]+$/, '');
    return api === path.win32 ? normal.toLowerCase() : normal;
  };
  const relative = api.relative(fold(folder), fold(child));
  return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative));
}

/** Everything the conversion dialog offers, with free space from the agent. */
export async function conversionOptions(client: JellyfinClient, agent: AgentClient, itemId: string, mediaSourceId?: string): Promise<ConversionOptions> {
  const [{ item, source, video }, folders] = await Promise.all([findSource(client, itemId, mediaSourceId), libraryFolders(client)]);
  const api = pathApiFor(source.Path);
  const directory = api.dirname(source.Path);
  const stem = api.basename(source.Path, api.extname(source.Path));
  // Only free space and the size of these very paths – the agent lists nothing.
  const check = await agent.check({ source: source.Path, directories: [directory, ...folders.map((folder) => folder.path)] });
  const free = (dir: string) => check.directories.find((entry) => entry.path === dir)?.freeBytes ?? null;
  const bytes = check.sourceBytes ?? source.Size ?? null;
  const inLibraryRoot = folders.some((folder) => samePath(folder.path, directory));
  const space = (factor: number) => (bytes ? Math.ceil(bytes * factor) : null);

  return {
    item: { id: item.Id ?? itemId, name: item.Name ?? 'Unbekannter Titel', year: item.ProductionYear ?? null },
    source: { mediaSourceId: source.Id ?? null, path: source.Path, bytes, videoRangeType: video?.VideoRangeType ?? null, dvProfile: video?.DvProfile ?? null },
    requiredBytes: space(SPACE_FACTOR),
    alongside: { directory, fileName: `${stem} - DV P8.mkv`, freeBytes: free(directory) },
    replace: { path: api.join(directory, `${stem}.mkv`), backup: api.join(directory, '.manelly-backup', api.basename(source.Path)) },
    folders: folders.map((folder) => ({ ...folder, freeBytes: free(folder.path) })),
    // A movie in its own folder keeps that folder name; a loose file gets one named after it.
    subfolder: inLibraryRoot ? stem : api.basename(directory),
    // Agents before 0.17.0 have none.
    work: check.work?.directory
      ? {
          ...check.work,
          directory: check.work.directory,
          requiredBytes: space(WORK_SPACE_FACTOR),
          targetBytes: space(TARGET_SPACE_FACTOR),
          backup: pathApiFor(check.work.directory).join(check.work.directory, 'Originale', api.basename(source.Path)),
        }
      : null,
  };
}

/** Hands a conversion to the agent; the paths always come from Jellyfin, never from the browser. */
export async function startConversion(client: JellyfinClient, agent: AgentClient, body: StartConversionRequest): Promise<ConversionJob> {
  const { item, source, video } = await findSource(client, body.itemId, body.mediaSourceId);
  const output: ConversionRequest['output'] = { mode: body.output.mode };
  if (body.output.fileName) output.fileName = body.output.fileName;
  if (body.output.mode === 'folder') {
    const folders = await libraryFolders(client);
    const folder = folders.find((candidate) => body.output.directory && samePath(candidate.path, body.output.directory));
    if (!folder) throw new AppError('BAD_REQUEST', 'Als Zielordner sind nur Ordner der Jellyfin-Bibliotheken möglich.');
    output.directory = folder.path;
    if (body.output.subfolder) output.subfolder = body.output.subfolder;
  }
  const name = item.Name ?? 'Unbekannter Titel';
  return agent.createJob({
    source: source.Path,
    output,
    title: item.ProductionYear ? `${name} (${item.ProductionYear})` : name,
    hints: {
      durationMs: item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_MS) : null,
      frameRate: video?.RealFrameRate ?? video?.AverageFrameRate ?? null,
    },
    ...(body.scheduled ? { scheduled: true } : {}),
    ...(body.work ? { work: true } : {}),
  });
}

/**
 * Follows the conversions started from this Manelly; when one finishes, tells
 * Jellyfin about the changed files and refreshes Manelly's index a little later.
 */
export function createConversionWatcher(options: {
  agent: AgentConnection;
  jellyfin: () => JellyfinClient | null;
  store?: MediaIndexStore;
  intervalMs?: number;
  refreshDelayMs?: number;
  log?: (message: string) => void;
}) {
  const { agent, jellyfin, store, intervalMs = 15_000, refreshDelayMs = 60_000, log = () => {} } = options;
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let refreshTimer: NodeJS.Timeout | null = null;

  async function notify(job: ConversionJob) {
    const client = jellyfin();
    if (!client) return;
    const updates: Array<{ path: string; updateType: 'Created' | 'Modified' | 'Deleted' }> = [];
    if (job.output === job.source) updates.push({ path: job.output, updateType: 'Modified' });
    else {
      updates.push({ path: job.output, updateType: 'Created' });
      if (job.backup) updates.push({ path: job.source, updateType: 'Deleted' });
    }
    try {
      await client.notifyMediaUpdated(updates);
    } catch (error) {
      log(`Jellyfin konnte nicht über die neue Datei informiert werden: ${(error as Error).message}`);
    }
  }

  async function finished(job: ConversionJob) {
    // Agents from 0.2.0 on tell Jellyfin themselves.
    if (!job.jellyfinNotified) await notify(job);
    if (store) {
      if (refreshTimer) clearTimeout(refreshTimer);
      // Give Jellyfin time to scan the file before Manelly reads the library again.
      refreshTimer = setTimeout(() => store.refresh(), refreshDelayMs);
      refreshTimer.unref();
    }
  }

  async function observe(jobs: ConversionJob[]) {
    for (const job of jobs) {
      if (!pending.has(job.id) || job.state === 'queued' || job.state === 'running') continue;
      pending.delete(job.id);
      if (job.state === 'done') await finished(job);
    }
  }

  async function poll() {
    timer = null;
    const client = agent.client;
    if (!client || pending.size === 0) return;
    try {
      await observe(await client.listJobs());
    } catch (error) {
      log(`Agent nicht erreichbar: ${(error as Error).message}`);
    }
    if (pending.size > 0) schedule();
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => void poll(), intervalMs);
    timer.unref();
  }

  return {
    observe,
    /** Call with a conversion just started from Manelly. */
    track(job: ConversionJob) {
      pending.add(job.id);
      schedule();
    },
    stop() {
      if (timer) clearTimeout(timer);
      if (refreshTimer) clearTimeout(refreshTimer);
      timer = refreshTimer = null;
    },
  };
}
