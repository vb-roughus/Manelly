import type { JellyfinConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { JfSessionInfo, JfSystemInfo } from './types.js';

const CLIENT_NAME = 'Manelly';
const CLIENT_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 8000;

/** Jellyfin could not be reached or answered with an error. */
export class JellyfinError extends AppError {
  override name = 'JellyfinError';
}

export interface ImageRequest {
  /** Path below the Jellyfin base URL, e.g. `/Items/<id>/Images/Primary`. */
  path: string;
  query: URLSearchParams;
}

export interface JellyfinClient {
  readonly baseUrl: string;
  getSystemInfo(): Promise<JfSystemInfo>;
  getSessions(): Promise<JfSessionInfo[]>;
  /** Returns the raw upstream response so the caller can stream it. */
  getImage(request: ImageRequest): Promise<Response>;
}

export interface JellyfinClientOptions {
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createJellyfinClient(
  config: JellyfinConfig,
  options: JellyfinClientOptions = {},
): JellyfinClient {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const authorization =
    `MediaBrowser Client="${CLIENT_NAME}", Device="${CLIENT_NAME} Server", ` +
    `DeviceId="manelly-server", Version="${CLIENT_VERSION}", Token="${config.apiKey}"`;

  async function request(path: string, accept: string): Promise<Response> {
    const url = `${config.url}${path}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: authorization, Accept: accept },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new JellyfinError('TIMEOUT', `Jellyfin hat nicht innerhalb von ${timeoutMs / 1000} s geantwortet (${config.url}).`);
      }
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
      throw new JellyfinError('UNREACHABLE', `Jellyfin ist unter ${config.url} nicht erreichbar: ${cause}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new JellyfinError('UNAUTHORIZED', 'Jellyfin hat den API-Schlüssel abgelehnt.', response.status);
    }
    return response;
  }

  async function getJson<T>(path: string): Promise<T> {
    const response = await request(path, 'application/json');
    if (!response.ok) {
      throw new JellyfinError('UPSTREAM_ERROR', `Jellyfin antwortete auf ${path} mit HTTP ${response.status}.`, response.status);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new JellyfinError('UPSTREAM_ERROR', `Jellyfin lieferte auf ${path} kein gültiges JSON. Stimmt JELLYFIN_URL?`);
    }
  }

  return {
    baseUrl: config.url,
    getSystemInfo: () => getJson<JfSystemInfo>('/System/Info'),
    // 960 s matches the window Jellyfin's own dashboard uses for "active" devices.
    getSessions: () => getJson<JfSessionInfo[]>('/Sessions?activeWithinSeconds=960'),
    getImage: ({ path, query }) => {
      const search = query.toString();
      return request(search ? `${path}?${search}` : path, 'image/*');
    },
  };
}
