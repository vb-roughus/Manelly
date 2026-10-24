import type { JellyfinConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { JfItemsResult, JfSessionInfo, JfSystemInfo, JfUser, JfVirtualFolder } from './types.js';

const CLIENT_NAME = 'Manelly';
const CLIENT_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 8000;
// Pages of library items with all media streams can take a while on small servers.
const ITEMS_TIMEOUT_MS = 60_000;

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
  getLibraries(): Promise<JfVirtualFolder[]>;
  /** GET /Items with the given query; API keys see all libraries without a user id. */
  getItems(query: URLSearchParams): Promise<JfItemsResult>;
  getUsers(): Promise<JfUser[]>;
  /** Creates a collection (BoxSet) with the given items and returns its id. */
  createCollection(name: string, itemIds: string[]): Promise<string>;
  /** Adds items to a collection; Jellyfin skips the ones already in it. */
  addToCollection(collectionId: string, itemIds: string[]): Promise<void>;
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

  async function request(path: string, accept: string, requestTimeoutMs = timeoutMs, method = 'GET'): Promise<Response> {
    const url = `${config.url}${path}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Authorization: authorization, Accept: accept },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new JellyfinError('TIMEOUT', `Jellyfin hat nicht innerhalb von ${requestTimeoutMs / 1000} s geantwortet (${config.url}).`);
      }
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
      throw new JellyfinError('UNREACHABLE', `Jellyfin ist unter ${config.url} nicht erreichbar: ${cause}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new JellyfinError('UNAUTHORIZED', 'Jellyfin hat den API-Schlüssel abgelehnt.', response.status);
    }
    return response;
  }

  async function getJson<T>(path: string, requestTimeoutMs?: number, method?: string): Promise<T> {
    const response = await request(path, 'application/json', requestTimeoutMs, method);
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
    getLibraries: () => getJson<JfVirtualFolder[]>('/Library/VirtualFolders'),
    getItems: (query) => getJson<JfItemsResult>(`/Items?${query}`, ITEMS_TIMEOUT_MS),
    getUsers: () => getJson<JfUser[]>('/Users'),
    createCollection: async (name, itemIds) => {
      const query = new URLSearchParams({ name, isLocked: 'false' });
      // An empty ids parameter would make Jellyfin parse "" as an item id.
      if (itemIds.length) query.set('ids', itemIds.join(','));
      const result = await getJson<{ Id?: string }>(`/Collections?${query}`, ITEMS_TIMEOUT_MS, 'POST');
      if (!result.Id) throw new JellyfinError('UPSTREAM_ERROR', 'Jellyfin hat die Sammlung ohne ID angelegt.');
      return result.Id;
    },
    addToCollection: async (collectionId, itemIds) => {
      const path = `/Collections/${encodeURIComponent(collectionId)}/Items?ids=${itemIds.join(',')}`;
      const response = await request(path, 'application/json', ITEMS_TIMEOUT_MS, 'POST');
      if (!response.ok) {
        throw new JellyfinError('UPSTREAM_ERROR', `Jellyfin konnte die Titel nicht zur Sammlung hinzufügen (HTTP ${response.status}).`, response.status);
      }
    },
    getImage: ({ path, query }) => {
      const search = query.toString();
      return request(search ? `${path}?${search}` : path, 'image/*');
    },
  };
}
