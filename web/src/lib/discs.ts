import type { DiscTitle } from '@manelly/shared';

export type DiscKind = 'film' | 'serie';

const MINUTE = 60;

/**
 * What to rip from a disc: on a film disc the main film (the longest title); on a series disc the episodes – two or
 * more titles of about the same length, without the "play all" title, which is about as long as all of them together.
 */
export function suggestSelection(titles: DiscTitle[]): { kind: DiscKind; selected: number[] } {
  const longest = [...titles].sort((a, b) => b.durationSeconds - a.durationSeconds || (b.bytes ?? 0) - (a.bytes ?? 0))[0];
  if (!longest) return { kind: 'film', selected: [] };
  const candidates = titles.filter((title) => title.durationSeconds >= 15 * MINUTE && title.durationSeconds <= 75 * MINUTE);
  const sorted = candidates.map((title) => title.durationSeconds).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const episodes = candidates.filter((title) => Math.abs(title.durationSeconds - median) <= median * 0.2);
  if (episodes.length >= 2) {
    const together = episodes.reduce((sum, title) => sum + title.durationSeconds, 0);
    const playAll = titles.some((title) => !episodes.includes(title) && Math.abs(title.durationSeconds - together) <= together * 0.1);
    if (playAll || longest.durationSeconds < 80 * MINUTE) return { kind: 'serie', selected: episodes.map((title) => title.index) };
  }
  return { kind: 'film', selected: [longest.index] };
}

/** "FINDET_NEMO" → "Findet Nemo", as the agent names folders itself. */
export function nameFromDisc(name: string): string {
  let text = name.replace(/[_.]+/g, ' ').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text === text.toUpperCase()) text = text.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
  return text.replace(/[ .]+$/, '');
}

const SEASON = /\b(?:s|staffel\s*|season\s*)(\d{1,2})\b/i;
const DISC_NUMBER = /\b(?:d|disc|dvd|cd)\s*\d{1,2}\b/gi;

/**
 * Names suggested from a disc's name: for a film without the disc number ("HDR_D1"), for a series also without the
 * season, which comes on its own ("DARK_S2_D1" → «Dark», season 2).
 */
export function namesFromDisc(name: string): { film: string; series: string; season: number | null } {
  const plain = nameFromDisc(name);
  const film = plain.replace(DISC_NUMBER, ' ').replace(/\s+/g, ' ').trim() || plain;
  const series = film.replace(new RegExp(SEASON.source, 'gi'), ' ').replace(/\s+/g, ' ').trim() || film;
  const season = SEASON.exec(film)?.[1];
  return { film, series, season: season ? Number(season) : null };
}

/** What to look for in the library: the name without year, season, disc number and the like. */
export function librarySearchFor(name: string): string {
  return name
    .replace(/\(\s*\d{4}\s*\)/g, ' ')
    .replace(/\b(?:s\d{1,2}(?:e\d{1,3})?|staffel\s*\d+|season\s*\d+|d(?:isc|vd)?\s*\d+|dvd|cd\s*\d+|teil\s*\d+)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const two = (value: number) => String(value).padStart(2, '0');

/** The file names for the chosen titles, in the disc's order: the film by its name, episodes as S01E01. */
export function fileNamesFor(kind: DiscKind, name: string, titles: number[], season: number, firstEpisode: number): Map<number, string> {
  const base = name.trim() || 'Disc';
  const ordered = [...titles].sort((a, b) => a - b);
  return new Map(
    ordered.map((index, at) => [
      index,
      kind === 'serie' ? `${base} S${two(season)}E${two(firstEpisode + at)}.mkv` : at === 0 ? `${base}.mkv` : `${base} - Titel ${index + 1}.mkv`,
    ]),
  );
}

/** A file or folder name Windows takes (as the agent checks it). */
export function isPlainName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && name !== '.' && name !== '..' && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !/[ .]$/.test(name);
}

/** 7112 → "1:58:32", 1330 → "22:10". */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

const languages = (() => {
  try {
    return new Intl.DisplayNames(['de'], { type: 'language' });
  } catch {
    return null;
  }
})();

/** "deu" → "Deutsch"; what MakeMKV says else. */
export function languageName(code: string | null, fallback: string | null): string {
  if (code) {
    try {
      const name = languages?.of(code);
      if (name && name !== code) return name;
    } catch {
      // Not a code Intl knows.
    }
  }
  return fallback ?? code ?? 'unbekannt';
}
