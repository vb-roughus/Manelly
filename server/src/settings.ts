import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError, type JellyfinConfig } from './config.js';

/** Persists the Jellyfin connection entered in the UI. */
export interface SettingsStore {
  load(): Promise<JellyfinConfig | null>;
  save(settings: JellyfinConfig): Promise<void>;
}

interface SettingsFile {
  version: 1;
  jellyfin?: { url?: unknown; apiKey?: unknown };
}

export function createFileSettingsStore(dataDir: string): SettingsStore {
  const file = join(dataDir, 'settings.json');

  return {
    async load() {
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }

      let parsed: SettingsFile;
      try {
        parsed = JSON.parse(raw) as SettingsFile;
      } catch {
        throw new ConfigError(`${file} ist beschädigt (kein gültiges JSON). Lösche die Datei und richte die Verbindung neu ein.`);
      }
      const { url, apiKey } = parsed.jellyfin ?? {};
      return typeof url === 'string' && typeof apiKey === 'string' && url && apiKey ? { url, apiKey } : null;
    },

    async save(settings) {
      await mkdir(dataDir, { recursive: true });
      const content: SettingsFile = { version: 1, jellyfin: { url: settings.url, apiKey: settings.apiKey } };
      // Write next to the target and rename, so a crash never leaves a half-written file.
      const tmp = `${file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}
