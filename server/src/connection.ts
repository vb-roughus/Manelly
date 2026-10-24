import type { SettingsSource } from '@manelly/shared';
import type { JellyfinConfig } from './config.js';
import type { JellyfinClient } from './jellyfin/client.js';
import type { SettingsStore } from './settings.js';

export type ClientFactory = (settings: JellyfinConfig) => JellyfinClient;

/** The active Jellyfin connection; replaced at runtime when the settings change. */
export interface JellyfinConnection {
  readonly client: JellyfinClient | null;
  readonly settings: JellyfinConfig | null;
  readonly source: SettingsSource | null;
  /** A client for settings that are not active yet, e.g. to test them before saving. */
  createClient: ClientFactory;
  save(settings: JellyfinConfig): Promise<void>;
}

/** Settings saved in the UI win over the ones from environment variables. */
export async function createConnection(options: {
  store: SettingsStore;
  envSettings: JellyfinConfig | null;
  createClient: ClientFactory;
}): Promise<JellyfinConnection> {
  const { store, envSettings, createClient } = options;
  const saved = await store.load();

  let settings = saved ?? envSettings;
  let source: SettingsSource | null = saved ? 'ui' : envSettings ? 'env' : null;
  let client = settings ? createClient(settings) : null;

  return {
    get client() {
      return client;
    },
    get settings() {
      return settings;
    },
    get source() {
      return source;
    },
    createClient,
    async save(next) {
      await store.save(next);
      settings = next;
      source = 'ui';
      client = createClient(next);
    },
  };
}
