import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClickNLoadAnswer, ClickNLoadEvent, ClickNLoadKind, ClickNLoadStatus } from '@manelly/shared';
import type { AgentConnection } from '../agent/connection.js';
import { AppError } from '../errors.js';
import { ClickNLoadError, readRequest } from './decrypt.js';

export const CLICKNLOAD_PORT = 9666;
/** Events kept for the settings; older ones go. */
const KEEP = 20;
/** The same links again within this time are a double click or a page sending twice. */
const DUPLICATE_MS = 60_000;

/** Whether Manelly takes Click'n'Load from the browser on its own computer; saved in the data folder. */
export interface ClickNLoadSettingsStore {
  load(): Promise<{ local: boolean }>;
  save(settings: { local: boolean }): Promise<void>;
}

export function createFileClickNLoadSettings(dataDir: string): ClickNLoadSettingsStore {
  const file = join(dataDir, 'clicknload.json');
  return {
    async load() {
      const stored = await readFile(file, 'utf8').then((raw) => JSON.parse(raw) as { local?: unknown }, () => null);
      // On unless switched off: the port only takes requests from this computer.
      return { local: stored?.local !== false };
    },
    async save(settings) {
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ version: 1, ...settings }, null, 2)}\n`);
      await rename(tmp, file);
    },
  };
}

/** The listener on 127.0.0.1:9666, as far as the service needs it. */
export interface LocalListener {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly listening: boolean;
  readonly error: string | null;
}

export interface ClickNLoadOptions {
  agent: AgentConnection;
  settings?: ClickNLoadSettingsStore;
  /** Makes the listener for this computer; none in tests. */
  listener?: (service: ClickNLoad) => LocalListener;
  log?: (message: string) => void;
  now?: () => number;
}

/** Hands what pages send with Click'n'Load to JDownloader on the Jellyfin server, through the agent. */
export async function createClickNLoad(options: ClickNLoadOptions) {
  const { agent, log = () => {}, now = Date.now } = options;
  const settings = options.settings ?? { load: async () => ({ local: false }), save: async () => {} };
  let enabled = (await settings.load()).local;
  const events: ClickNLoadEvent[] = [];
  const recent = new Map<string, { at: number; event: ClickNLoadEvent }>();

  async function handOver(content: ReturnType<typeof readRequest>): Promise<void> {
    const client = agent.client;
    if (!client) throw new ClickNLoadError('Es ist noch kein Agent eingerichtet – unter Server → Agent verbinden.');
    try {
      if (content.container) {
        const name = `${(content.packageName ?? 'Click-n-Load').replace(/[^\p{L}\p{N} ()._-]+/gu, '_').slice(0, 200)}.dlc`;
        await client.addLinkGrabberContainer({ name, content: content.container });
      } else {
        await client.addLinkGrabberLinks({
          links: content.links,
          ...(content.packageName ? { packageName: content.packageName } : {}),
          ...(content.password ? { password: content.password } : {}),
          ...(content.source ? { source: content.source } : {}),
        });
      }
    } catch (error) {
      // Agents before 0.32.0 know no such route.
      if (error instanceof AppError && error.status === 404 && !content.container) {
        throw new ClickNLoadError('Der Agent ist zu alt für Click\'n\'Load – unter Server → Agent «Aktualisieren & neu starten» (ab 0.32.0).');
      }
      throw error;
    }
  }

  const service = {
    /** Takes a request as the page sent it; the answer says what became of it. */
    async receive(kind: ClickNLoadKind, fields: Record<string, string>, via: ClickNLoadEvent['via']): Promise<ClickNLoadAnswer> {
      const at = now();
      for (const [key, entry] of recent) if (at - entry.at > DUPLICATE_MS) recent.delete(key);
      const key = createHash('sha256')
        .update(JSON.stringify([kind, fields.jk ?? '', fields.crypted ?? '', fields.urls ?? '']))
        .digest('hex');
      const earlier = recent.get(key);
      if (earlier && !earlier.event.error) return { ...earlier.event, duplicate: true };

      const event: ClickNLoadEvent = { id: randomUUID(), at: new Date(at).toISOString(), via, source: fields.source?.trim() || null, packageName: null, links: 0, container: kind === 'addcrypted', error: null };
      try {
        const content = readRequest(kind, fields);
        Object.assign(event, { packageName: content.packageName, links: content.links.length, source: content.source });
        await handOver(content);
        log(`Click'n'Load: ${content.container ? 'DLC-Container' : `${content.links.length} Links`}${content.packageName ? ` («${content.packageName}»)` : ''} an JDownloader${content.source ? ` – von ${content.source}` : ''}`);
      } catch (error) {
        event.error = error instanceof Error ? error.message : String(error);
        log(`Click'n'Load fehlgeschlagen: ${event.error}`);
      }
      recent.set(key, { at, event });
      events.unshift(event);
      events.splice(KEEP);
      return { ...event, duplicate: false };
    },

    status(): ClickNLoadStatus {
      return {
        local: { enabled, port: CLICKNLOAD_PORT, listening: listener?.listening ?? false, error: enabled ? (listener?.error ?? null) : null },
        events: [...events],
      };
    },

    /** Starts the listener for this computer when it is switched on. */
    async start(): Promise<void> {
      if (enabled) await listener?.start();
    },

    async setLocal(on: boolean): Promise<ClickNLoadStatus> {
      await settings.save({ local: on });
      enabled = on;
      if (on) await listener?.start();
      else await listener?.stop();
      return service.status();
    },

    async stop(): Promise<void> {
      await listener?.stop();
    },
  };
  const listener = options.listener?.(service) ?? null;
  return service;
}

export type ClickNLoad = Awaited<ReturnType<typeof createClickNLoad>>;
