import type { DolbyVisionInfo } from '@manelly/shared';

/** Video files, as JDownloader extracts them. */
export const VIDEO = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|mts|iso|webm)$/i;

const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** A folder name Windows takes; the server checks it again. */
export function isFolderName(name: string): boolean {
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

/** `name` in `folder`, with the separator the folder uses ("D:\Serien" or "/mnt/serien"). */
export function joinFolder(folder: string, name: string): string {
  return `${folder.replace(/[\\/]+$/, '')}${folder.includes('\\') ? '\\' : '/'}${name}`;
}

/** A series name from release names, as Jellyfin likes it: "Dark.2017.S01.German.1080p" becomes "Dark (2017)". */
export function guessSeriesName(names: string[]): string {
  for (const name of names) {
    const plain = name.replace(VIDEO, '').replace(/[._]+/g, ' ');
    const marker = /\b(?:s\d{1,2}(?:e\d{1,3})?|season\s*\d+|staffel\s*\d+|\d{1,2}x\d{2,3})\b/i.exec(plain);
    if (!marker) continue;
    const title = plain.slice(0, marker.index).replace(/[\s-]+$/, '').trim();
    const year = /^(.+?)\s*\(?((?:19|20)\d{2})\)?$/.exec(title);
    const guess = year ? `${year[1]} (${year[2]})` : title;
    if (isFolderName(guess)) return guess;
  }
  return '';
}

/** A path for comparing: one kind of separator, any case – the agent runs on Windows. */
const comparable = (path: string) => path.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();

/** Whether `file` (as the agent names it, e.g. a conversion's source) is the entry "a/b" of the extraction folder. */
export function isExtractedFile(file: string, directory: string, path: string): boolean {
  return comparable(file) === comparable(`${directory}/${path}`);
}

/** "DV P7", "DV P8.1": for profile 8, the number after the point is what the base layer is without Dolby Vision. */
export function dolbyVisionLabel(info: DolbyVisionInfo): string {
  return info.profile === 8 && info.compatibility ? `DV P8.${info.compatibility}` : `DV P${info.profile}`;
}

const BASE_LAYERS: Record<number, string> = { 1: 'HDR10', 2: 'SDR', 4: 'HLG', 6: 'HDR10 (Blu-ray)' };

/** «Dolby Vision Profil 7, Basis HDR10 (Blu-ray), mit Enhancement Layer» */
export function describeDolbyVision(info: DolbyVisionInfo): string {
  const base = info.compatibility !== null ? BASE_LAYERS[info.compatibility] : undefined;
  return [`Dolby Vision Profil ${info.profile}`, base && `Basis ${base}`, info.enhancementLayer && 'mit Enhancement Layer'].filter(Boolean).join(', ');
}
