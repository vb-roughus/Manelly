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
