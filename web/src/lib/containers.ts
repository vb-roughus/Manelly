/** JDownloader takes DLC files of up to 1 MB into its link grabber (the agent checks the same). */
export const MAX_CONTAINER_BYTES = 1024 * 1024;

/** Why a file cannot go to JDownloader, or null. */
export function containerProblem(file: { name: string; size: number }): string | null {
  if (!/\.dlc$/i.test(file.name)) return 'ist keine DLC-Datei.';
  if (file.size === 0) return 'ist leer.';
  if (file.size > MAX_CONTAINER_BYTES) return 'ist zu gross (höchstens 1 MB).';
  return null;
}

/** The file's bytes as base64, the way the API takes them. */
export function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(new Error('Die Datei liess sich nicht lesen.'));
    reader.readAsDataURL(file);
  });
}
