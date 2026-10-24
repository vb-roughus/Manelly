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
  /** Null until both JELLYFIN_URL and JELLYFIN_API_KEY are set. */
  jellyfin: JellyfinConfig | null;
  /** Directory with the built web frontend; null serves the API only. */
  staticDir: string | null;
}

export class ConfigError extends Error {}

// server/src/config.ts and server/dist/index.js both sit two levels below the repo root.
const DEFAULT_STATIC_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

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
    staticDir: existsSync(staticDir) ? staticDir : null,
  };
}

function parseJellyfinConfig(env: NodeJS.ProcessEnv): JellyfinConfig | null {
  const rawUrl = env.JELLYFIN_URL?.trim();
  const apiKey = env.JELLYFIN_API_KEY?.trim();
  if (!rawUrl || !apiKey) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError(`JELLYFIN_URL ist keine gültige URL: "${rawUrl}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`JELLYFIN_URL muss mit http:// oder https:// beginnen: "${rawUrl}".`);
  }

  // Keep a base path (Jellyfin behind a reverse proxy at /jellyfin), drop the trailing slash.
  return { url: url.toString().replace(/\/+$/, ''), apiKey };
}
