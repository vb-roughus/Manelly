import type { ConversionOutputMode } from '@manelly/shared';

/** What the conversion dialog asks besides the names: where to save, where to convert, when. */
export interface ConvertChoices {
  mode: ConversionOutputMode;
  /** Library folder for the folder mode. */
  folder: string | null;
  /** In the agent's work folder. */
  work: boolean;
  /** After the agent's schedule. */
  scheduled: boolean;
}

/** What this title and this agent allow right now. */
export interface ConvertAvailability {
  folders: string[];
  work: boolean;
  schedule: boolean;
}

const KEY = 'manelly.convert.lastChoices';
const MODES: ConversionOutputMode[] = ['alongside', 'replace', 'folder'];

/** The choices of the last conversion started in this browser; what is missing or broken is left out. */
export function loadChoices(): Partial<ConvertChoices> {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const choices: Partial<ConvertChoices> = {};
    if (MODES.includes(stored.mode as ConversionOutputMode)) choices.mode = stored.mode as ConversionOutputMode;
    if (typeof stored.folder === 'string') choices.folder = stored.folder;
    if (typeof stored.work === 'boolean') choices.work = stored.work;
    if (typeof stored.scheduled === 'boolean') choices.scheduled = stored.scheduled;
    return choices;
  } catch {
    // Storage unavailable (private mode, blocked cookies) or damaged.
    return {};
  }
}

export function saveChoices(choices: ConvertChoices): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choices));
  } catch {
    // Not remembered; the conversion starts anyway.
  }
}

const sameFolder = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

/**
 * What the dialog starts with: the last choices, as far as they fit. Without any, a new file next to the original,
 * in the work folder and after the schedule when there are those.
 */
export function initialChoices(saved: Partial<ConvertChoices>, available: ConvertAvailability): ConvertChoices {
  const folder = (saved.folder ? available.folders.find((candidate) => sameFolder(candidate, saved.folder!)) : undefined) ?? available.folders[0] ?? null;
  const mode = saved.mode === 'folder' && !folder ? 'alongside' : (saved.mode ?? 'alongside');
  return {
    mode,
    folder,
    work: available.work && (saved.work ?? true),
    scheduled: available.schedule && (saved.scheduled ?? true),
  };
}

/**
 * What to remember after a start: a choice the dialog could not offer this time (no work folder, no schedule)
 * keeps what was remembered before.
 */
export function rememberedChoices(chosen: ConvertChoices, saved: Partial<ConvertChoices>, available: ConvertAvailability): ConvertChoices {
  return {
    mode: chosen.mode,
    folder: chosen.mode === 'folder' ? chosen.folder : (saved.folder ?? chosen.folder),
    work: available.work ? chosen.work : (saved.work ?? true),
    scheduled: available.schedule ? chosen.scheduled : (saved.scheduled ?? true),
  };
}
