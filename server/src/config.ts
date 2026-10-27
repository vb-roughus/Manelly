import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface JellyfinConfig {
  url: string;
  apiKey: string;
}

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  /** Connection from JELLYFIN_URL / JELLYFIN_API_KEY; settings saved in the UI take precedence. */
  jellyfin: JellyfinConfig | null;
  /** Directory for data Manelly writes itself, e.g. the settings saved in the UI. */
  dataDir: string;
  /** Directory with the built web frontend; null serves the API only. */
  staticDir: string | null;
  /** The Manelly checkout, where git and the start scripts work. */
  rootDir: string;
}

export class ConfigError extends Error {}

// server/src/config.ts and server/dist/index.js both sit two levels below the repo root.
const DEFAULT_STATIC_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`PORT muss eine Zahl zwischen 0 und 65535 sein, ist aber "${env.PORT}".`);
  }

  const staticDir = env.STATIC_DIR ?? DEFAULT_STATIC_DIR;

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    logLevel: env.LOG_LEVEL ?? 'info',
    jellyfin: parseJellyfinConfig(env),
    dataDir: env.DATA_DIR || DEFAULT_DATA_DIR,
    staticDir: existsSync(staticDir) ? staticDir : null,
    rootDir: ROOT_DIR,
  };
}

function parseJellyfinConfig(env: NodeJS.ProcessEnv): JellyfinConfig | null {
  const rawUrl = env.JELLYFIN_URL?.trim();
  const apiKey = env.JELLYFIN_API_KEY?.trim();
  if (!rawUrl || !apiKey) return null;
  return { url: normalizeJellyfinUrl(rawUrl, 'JELLYFIN_URL'), apiKey };
}

/**
 * Validates a Jellyfin base URL and returns it without trailing slash.
 * `label` names the setting in error messages.
 */
export function normalizeJellyfinUrl(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConfigError(`${label} ist keine gültige URL: "${raw}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`${label} muss mit http:// oder https:// beginnen: "${raw}".`);
  }

  // Keep a base path (Jellyfin behind a reverse proxy at /jellyfin), but drop query and hash, and the
  // web client's /web path, which ends up here when the address is copied from the browser.
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/web(\/(index\.html)?)?$/, '');
  return url.toString().replace(/\/+$/, '');
}
