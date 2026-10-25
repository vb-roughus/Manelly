import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError } from '../config.js';
import { createAgentClient, type AgentClient, type AgentSettings } from './client.js';

export interface AgentSettingsStore {
  load(): Promise<AgentSettings | null>;
  save(settings: AgentSettings): Promise<void>;
}

export function createFileAgentSettingsStore(dataDir: string): AgentSettingsStore {
  const file = join(dataDir, 'agent.json');
  return {
    async load() {
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      let parsed: { url?: unknown; token?: unknown };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        throw new ConfigError(`${file} ist beschädigt (kein gültiges JSON). Lösche die Datei und richte den Agent neu ein.`);
      }
      return typeof parsed.url === 'string' && typeof parsed.token === 'string' && parsed.url && parsed.token ? { url: parsed.url, token: parsed.token } : null;
    },
    async save(settings) {
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}

/** The configured agent, if any; replaced at runtime when the settings change. */
export interface AgentConnection {
  readonly client: AgentClient | null;
  readonly settings: AgentSettings | null;
  createClient(settings: AgentSettings): AgentClient;
  save(settings: AgentSettings): Promise<void>;
}

export async function createAgentConnection(options: {
  store: AgentSettingsStore;
  createClient?: (settings: AgentSettings) => AgentClient;
}): Promise<AgentConnection> {
  const createClient = options.createClient ?? ((settings: AgentSettings) => createAgentClient(settings));
  let settings = await options.store.load();
  let client = settings ? createClient(settings) : null;
  return {
    get client() {
      return client;
    },
    get settings() {
      return settings;
    },
    createClient,
    async save(next) {
      await options.store.save(next);
      settings = next;
      client = createClient(next);
    },
  };
}

/** Accepts "jellyfin-pc:8790" as well as "http://jellyfin-pc:8790/". */
export function normalizeAgentUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ConfigError('Die Agent-Adresse ist keine gültige URL, z. B. http://jellyfin-pc:8790.');
  }
  if (url.search || url.hash) throw new ConfigError('Die Agent-Adresse darf keine Parameter enthalten.');
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}
