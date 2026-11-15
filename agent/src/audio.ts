import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { constants as osConstants, setPriority } from 'node:os';
import type { AudioResult, AudioTask } from '@manelly/shared';
import { AgentError } from './errors.js';
import { pathApiFor, TEMP_FOLDER_PREFIX } from './paths.js';

/** A track as `mkvmerge -J` describes it. */
export interface MkvTrack {
  /** Track id, for mkvmerge's options. */
  id: number;
  type: string;
  /** Track number in the file, for mkvpropedit's `track:@n`. */
  number: number;
  language: string | null;
  languageIetf: string | null;
  default: boolean;
  forced: boolean;
  /** "DTS-HD Master Audio", "AC-3", "HDMV PGS" … */
  codec: string | null;
  /** "A_DTS", "S_HDMV/PGS" … */
  codecId: string | null;
  channels: number | null;
  name: string | null;
}

/** The spellings of a language, by its ISO 639-2/B code as Manelly stores it. */
const LANGUAGES: Record<string, { codes: string[]; adjective: string }> = {
  ger: { codes: ['ger', 'deu', 'de', 'gsw'], adjective: 'deutsche' },
  eng: { codes: ['eng', 'en'], adjective: 'englische' },
  fre: { codes: ['fre', 'fra', 'fr'], adjective: 'französische' },
  ita: { codes: ['ita', 'it'], adjective: 'italienische' },
  spa: { codes: ['spa', 'es'], adjective: 'spanische' },
};

export const isAudioLanguage = (code: unknown): code is string => typeof code === 'string' && code in LANGUAGES;
const adjective = (language: string) => LANGUAGES[language]?.adjective ?? `«${language}»-`;

export function matchesLanguage(track: Pick<MkvTrack, 'language' | 'languageIetf'>, language: string): boolean {
  const codes = LANGUAGES[language]?.codes ?? [language];
  const plain = track.language?.toLowerCase();
  const ietf = track.languageIetf?.toLowerCase().split('-')[0];
  return Boolean((plain && codes.includes(plain)) || (ietf && codes.includes(ietf)));
}

/** What to change so the file plays `language` first: default flags, and maybe the order of the tracks. */
export interface AudioPlan {
  preferred: MkvTrack | null;
  /** Tracks whose default flag changes, with the new value. */
  flags: Array<{ track: MkvTrack; value: boolean }>;
  /** Track ids in their new order; null when the order stays. */
  order: number[] | null;
}

/**
 * The preferred track becomes the only default audio track; a subtitle track marked default in another language loses
 * its mark (forced ones stay), so it does not show over the preferred sound. With `first`, the preferred track also
 * moves in front of the other audio tracks – for players that ignore the flag and take the first.
 */
export function planAudio(tracks: MkvTrack[], language: string, first: boolean): AudioPlan {
  const audio = tracks.filter((track) => track.type === 'audio');
  const preferred = audio.find((track) => matchesLanguage(track, language)) ?? null;
  if (!preferred) return { preferred, flags: [], order: null };
  const flags: AudioPlan['flags'] = [];
  for (const track of audio) if (track.default !== (track === preferred)) flags.push({ track, value: track === preferred });
  for (const track of tracks) {
    if (track.type === 'subtitles' && track.default && !track.forced && !matchesLanguage(track, language)) flags.push({ track, value: false });
  }
  const order =
    first && audio[0] !== preferred
      ? [
          ...tracks.filter((track) => track.type === 'video'),
          preferred,
          ...audio.filter((track) => track !== preferred),
          ...tracks.filter((track) => track.type !== 'video' && track.type !== 'audio'),
        ].map((track) => track.id)
      : null;
  return { preferred, flags, order };
}

/** The tracks of a Matroska file, read from its header only. */
export function identify(mkvmerge: string, file: string): Promise<MkvTrack[]> {
  return new Promise((resolve, reject) => {
    execFile(mkvmerge, ['-J', file], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error && !stdout) return reject(new AgentError(500, `mkvmerge konnte ${pathApiFor(file).basename(file)} nicht lesen: ${error.message}`));
      try {
        const parsed = JSON.parse(stdout) as {
          errors?: string[];
          tracks?: Array<{ id: number; type: string; codec?: string; properties?: Record<string, unknown> }>;
        };
        if (!parsed.tracks) return reject(new AgentError(400, parsed.errors?.[0] ?? `${pathApiFor(file).basename(file)} ist keine MKV-Datei.`));
        resolve(
          parsed.tracks.map((track) => {
            const props = track.properties ?? {};
            return {
              id: track.id,
              type: track.type,
              number: typeof props.number === 'number' ? props.number : track.id + 1,
              language: typeof props.language === 'string' ? props.language : null,
              languageIetf: typeof props.language_ietf === 'string' ? props.language_ietf : null,
              default: props.default_track === true,
              forced: props.forced_track === true,
              codec: typeof track.codec === 'string' ? track.codec : null,
              codecId: typeof props.codec_id === 'string' ? props.codec_id : null,
              channels: typeof props.audio_channels === 'number' ? props.audio_channels : null,
              name: typeof props.track_name === 'string' ? props.track_name : null,
            };
          }),
        );
      } catch {
        reject(new AgentError(500, `mkvmerge hat für ${pathApiFor(file).basename(file)} nichts Lesbares geantwortet.`));
      }
    });
  });
}

/** mkvpropedit lies next to mkvmerge in every MKVToolNix installation. */
export function mkvpropeditFor(mkvmerge: string): string {
  const api = pathApiFor(mkvmerge);
  const name = api.basename(mkvmerge).replace(/mkvmerge/i, 'mkvpropedit');
  const directory = api.dirname(mkvmerge);
  return directory === '.' ? name : api.join(directory, name);
}

/** Runs a tool at low priority, so Jellyfin keeps streaming smoothly; mkvmerge ends with 1 for warnings. */
function run(tool: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
    try {
      if (child.pid) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Not allowed everywhere.
    }
    let said = '';
    const keep = (chunk: Buffer) => (said = (said + chunk.toString()).slice(-600));
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (error) => reject(Object.assign(error, { spawnFailed: true })));
    child.on('close', (code) => {
      if (signal?.aborted) return reject(new AgentError(499, 'Abgebrochen.'));
      if (code === 0 || code === 1) return resolve();
      const last = said.trim().split(/\r?\n/).filter(Boolean).pop();
      reject(new AgentError(500, `${pathApiFor(tool).basename(tool)} ist fehlgeschlagen (Exit-Code ${code})${last ? `: ${last}` : ''}.`));
    });
  });
}

const removable = (track: MkvTrack) => track.type === 'audio' || track.type === 'subtitles';

/**
 * Writes the file anew next to it and puts it in place of the old one: the tracks in `plan.order` (if any), with the
 * plan's default flags, and – with `kept` – only those tracks of audio and subtitles. Nothing is encoded.
 */
async function remux(mkvmerge: string, file: string, plan: AudioPlan, tracks: MkvTrack[], signal?: AbortSignal, kept?: MkvTrack[]): Promise<void> {
  const api = pathApiFor(file);
  const temp = api.join(api.dirname(file), `${TEMP_FOLDER_PREFIX}audio-${randomUUID()}`);
  const output = api.join(temp, api.basename(file));
  const remaining = kept ?? tracks;
  // Every audio track gets its flag when one is preferred; a changed subtitle flag too.
  const flags = new Map<number, boolean>(plan.preferred ? remaining.filter((track) => track.type === 'audio').map((track) => [track.id, track === plan.preferred]) : []);
  for (const { track, value } of plan.flags) if (remaining.includes(track)) flags.set(track.id, value);
  const ids = (type: string) => remaining.filter((track) => track.type === type).map((track) => track.id);
  const selection = kept
    ? [
        ...(ids('audio').length > 0 ? ['--audio-tracks', ids('audio').join(',')] : ['--no-audio']),
        ...(ids('subtitles').length > 0 ? ['--subtitle-tracks', ids('subtitles').join(',')] : ['--no-subtitles']),
      ]
    : [];
  try {
    await mkdir(temp);
    await run(
      mkvmerge,
      [
        '-o',
        output,
        ...selection,
        ...[...flags].flatMap(([id, value]) => ['--default-track-flag', `${id}:${value ? 1 : 0}`]),
        ...(plan.order ? ['--track-order', plan.order.map((id) => `0:${id}`).join(',')] : []),
        file,
      ],
      signal,
    );
    const [before, after] = await Promise.all([stat(file), stat(output)]);
    if (kept) {
      // Tracks went: the new file must hold exactly the others – and its picture, so not be tiny.
      const written = await identify(mkvmerge, output);
      if (written.length !== remaining.length || after.size < before.size * 0.3) {
        throw new AgentError(500, `mkvmerge hat nicht die erwarteten Spuren geschrieben – ${api.basename(file)} bleibt, wie sie war.`);
      }
    } else if (after.size < before.size * 0.95) {
      // Only the order changed: a much smaller file means something went missing.
      throw new AgentError(500, `mkvmerge hat eine zu kleine Datei geschrieben – ${api.basename(file)} bleibt, wie sie war.`);
    }
    try {
      await rename(output, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new AgentError(409, `${api.basename(file)} liess sich nicht ersetzen (${code ?? 'Fehler'}) – wird die Datei gerade abgespielt?`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

/** "2 Tonspuren und 1 Untertitelspur". */
function removedText(removed: MkvTrack[]): string {
  const audio = removed.filter((track) => track.type === 'audio').length;
  const subtitles = removed.filter((track) => track.type === 'subtitles').length;
  return [audio > 0 && `${audio} ${audio === 1 ? 'Tonspur' : 'Tonspuren'}`, subtitles > 0 && `${subtitles} ${subtitles === 1 ? 'Untertitelspur' : 'Untertitelspuren'}`]
    .filter(Boolean)
    .join(' und ');
}

export interface AdjustOptions {
  mkvmerge: string;
  /** Made the default (and with `first` the first) audio track; null leaves the flags. */
  language: string | null;
  first: boolean;
  /**
   * The ids of the audio and subtitle tracks to keep – or how to find them from the file's tracks; the others go.
   * Left out: all stay. Video and everything else always stays.
   */
  keep?: readonly number[] | ((tracks: MkvTrack[]) => readonly number[]);
  signal?: AbortSignal;
}

/**
 * Takes out the tracks not kept and makes `language` the sound a player picks – in one go: when tracks go, mkvmerge
 * writes the file anew with the flags and the order; otherwise only the flags change (see preferAudio).
 */
export async function adjustTracks(file: string, { mkvmerge, language, first, keep, signal }: AdjustOptions): Promise<Omit<AudioResult, 'path'>> {
  const tracks = await identify(mkvmerge, file);
  const ids = typeof keep === 'function' ? keep(tracks) : keep;
  // Ids of the video and the like are fine – those always stay; an id the file does not have is not.
  if (ids?.some((id) => !tracks.some((track) => track.id === id))) {
    throw new AgentError(409, 'Die Spuren der Datei sind nicht mehr dieselben – den Dialog nochmals öffnen.');
  }
  const removed = ids ? tracks.filter((track) => removable(track) && !ids.includes(track.id)) : [];
  if (removed.length === 0) {
    if (language) return preferAudio(file, { mkvmerge, language, first, signal, tracks });
    return { changed: false, message: 'Alle Spuren bleiben.' };
  }
  const kept = tracks.filter((track) => !removed.includes(track));
  if (tracks.some((track) => track.type === 'audio') && !kept.some((track) => track.type === 'audio')) throw new AgentError(400, 'Mindestens eine Tonspur muss bleiben.');
  const plan = language ? planAudio(kept, language, first) : { preferred: null, flags: [], order: null };
  await remux(mkvmerge, file, plan, tracks, signal, kept);
  const name = language ? adjective(language) : '';
  const sound = !language
    ? ''
    : !plan.preferred
      ? ` Keine ${name} Tonspur.`
      : plan.order
        ? ` Die ${name} Tonspur steht jetzt zuerst und ist Standard.`
        : plan.flags.length > 0
          ? ` Die ${name} Tonspur ist jetzt Standard.`
          : '';
  return { changed: true, message: `${removedText(removed)} entfernt.${sound}` };
}

/**
 * Makes `language` the sound a player picks: the default flag on its first track (mkvpropedit, only the header
 * changes), and with `first` that track in front of the others (mkvmerge writes the file anew, nothing is encoded).
 */
export async function preferAudio(
  file: string,
  { mkvmerge, language, first, signal, tracks: known }: { mkvmerge: string; language: string; first: boolean; signal?: AbortSignal; tracks?: MkvTrack[] },
): Promise<Omit<AudioResult, 'path'>> {
  const tracks = known ?? (await identify(mkvmerge, file));
  const plan = planAudio(tracks, language, first);
  const name = adjective(language);
  if (!plan.preferred) return { changed: false, message: `Keine ${name} Tonspur.` };
  if (plan.order) {
    await remux(mkvmerge, file, plan, tracks, signal);
    return { changed: true, message: `Die ${name} Tonspur steht jetzt zuerst und ist Standard.` };
  }
  if (plan.flags.length === 0) return { changed: false, message: `Die ${name} Tonspur ist schon Standard${first ? ' und steht zuerst' : ''}.` };
  const args = [file, ...plan.flags.flatMap(({ track, value }) => ['--edit', `track:@${track.number}`, '--set', `flag-default=${value ? 1 : 0}`])];
  try {
    await run(mkvpropeditFor(mkvmerge), args, signal);
  } catch (error) {
    // Without mkvpropedit, mkvmerge writes the file anew with the flags, in the same order.
    if (!(error as { spawnFailed?: boolean }).spawnFailed) throw error;
    await remux(mkvmerge, file, { ...plan, order: tracks.map((track) => track.id) }, tracks, signal);
  }
  return { changed: true, message: `Die ${name} Tonspur ist jetzt Standard.` };
}

/** The MKV files of an entry of the extraction folder: the file itself, or those in a folder and below (at most `limit`). */
export async function mkvFiles(full: string, limit = 500): Promise<string[]> {
  const info = await lstat(full).catch(() => null);
  if (!info) throw new AgentError(404, 'Gibt es im Entpack-Ordner nicht (mehr).');
  if (info.isFile()) return /\.mkv$/i.test(full) ? [full] : [];
  if (!info.isDirectory()) return [];
  const api = pathApiFor(full);
  const found: string[] = [];
  const folders = [full];
  while (folders.length > 0 && found.length < limit) {
    const folder = folders.shift()!;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(TEMP_FOLDER_PREFIX)) continue;
      const path = api.join(folder, entry.name);
      if (entry.isDirectory()) folders.push(path);
      else if (entry.isFile() && /\.mkv$/i.test(entry.name) && found.length < limit) found.push(path);
    }
  }
  return found.sort();
}

/** A file of an audio task. */
export interface TaskFile {
  path: string;
  shown: string;
  busy: string | null;
  /** The ids of the audio and subtitle tracks to keep; left out: all stay. */
  keep?: number[];
}

export interface AudioFixerOptions {
  /** mkvmerge, if installed. */
  tool: () => Promise<string | null>;
  /** Tells Jellyfin about changed files of the libraries. */
  notify?: (updates: Array<{ Path: string; UpdateType: 'Modified' }>) => Promise<unknown>;
  log?: (message: string) => void;
}

/**
 * Sets the preferred audio track in many files, one after the other, in the background: files of the libraries
 * (Jellyfin hears about each changed one) or of the extraction folder. One task at a time.
 */
export function createAudioFixer({ tool, notify, log = () => {} }: AudioFixerOptions) {
  let task: AudioTask | null = null;
  let running: Promise<void> | null = null;

  async function work(current: AudioTask, files: TaskFile[], library: boolean) {
    const mkvmerge = await tool();
    const changed: string[] = [];
    for (const file of files) {
      current.current = file.shown;
      try {
        if (file.busy) throw new AgentError(409, file.busy);
        if (!mkvmerge) throw new AgentError(503, 'mkvmerge fehlt auf dem Server – MKVToolNix installieren.');
        const result = await adjustTracks(file.path, { mkvmerge, language: current.language, first: current.first, keep: file.keep });
        current.results.push({ path: file.shown, ...result });
        if (result.changed) changed.push(file.path);
      } catch (error) {
        current.results.push({ path: file.shown, changed: false, message: (error as Error).message, error: true });
      }
      current.done++;
    }
    current.current = null;
    current.state = 'done';
    current.finishedAt = new Date().toISOString();
    const failed = current.results.filter((result) => result.error).length;
    log(`${current.kind === 'tracks' ? 'Spuren' : 'Tonspuren'}: ${changed.length} von ${files.length} Dateien geändert${failed ? `, ${failed} mit Fehler` : ''}.`);
    if (library && changed.length > 0) await notify?.(changed.map((path) => ({ Path: path, UpdateType: 'Modified' as const })));
  }

  const status = (): AudioTask | null => (task ? { ...task, results: task.results.map((result) => ({ ...result })) } : null);

  return {
    status,

    /** mkvmerge, as the tasks find it. */
    mkvmerge: tool,

    /**
     * `busy` says why a file must stay as it is (being converted, moved …); `shown` is how the file is named in the
     * answer; `keep` the tracks to keep (kind tracks).
     */
    start(files: TaskFile[], options: { language: string | null; first: boolean; library: boolean; kind?: 'audio' | 'tracks' }): AudioTask {
      if (task?.state === 'running') throw new AgentError(409, 'Es werden gerade schon Spuren angepasst – danach nochmals.');
      if (files.length === 0) throw new AgentError(400, 'Keine MKV-Dateien gefunden.');
      const current: AudioTask = {
        id: randomUUID(),
        state: 'running',
        kind: options.kind ?? 'audio',
        language: options.language,
        first: options.first,
        total: files.length,
        done: 0,
        current: null,
        results: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      task = current;
      running = work(current, files, options.library).finally(() => (running = null));
      return status()!;
    },

    /** What an update's restart waits for. */
    busy: (): AudioTask | null => (task?.state === 'running' ? task : null),

    async idle(): Promise<void> {
      await running;
    },
  };
}

export type AudioFixer = ReturnType<typeof createAudioFixer>;
