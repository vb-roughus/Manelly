import type { AgentCheckRequest, AgentCheckResponse, AgentStatus, ConversionJob, ConversionRequest } from '@manelly/shared';
import { AppError } from '../errors.js';

export interface AgentSettings {
  url: string;
  token: string;
}

export interface AgentClient {
  readonly url: string;
  status(): Promise<AgentStatus>;
  check(request: AgentCheckRequest): Promise<AgentCheckResponse>;
  listJobs(): Promise<ConversionJob[]>;
  createJob(request: ConversionRequest): Promise<ConversionJob>;
  cancelJob(id: string): Promise<ConversionJob>;
  removeJob(id: string): Promise<void>;
}

const TIMEOUT_MS = 8000;

/** Talks to the Manelly agent on the Jellyfin server. */
export function createAgentClient(settings: AgentSettings, options: { fetch?: typeof fetch } = {}): AgentClient {
  const fetchImpl = options.fetch ?? fetch;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${settings.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${settings.token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new AppError('TIMEOUT', `Der Agent hat nicht innerhalb von ${TIMEOUT_MS / 1000} s geantwortet (${settings.url}).`);
      }
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
      throw new AppError('UNREACHABLE', `Der Agent ist unter ${settings.url} nicht erreichbar: ${cause}`);
    }
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (response.status === 401) throw new AppError('UNAUTHORIZED', 'Der Agent hat den Schlüssel abgelehnt.', 401);
    if (!response.ok) {
      const message = data?.error?.message ?? `Der Agent antwortete mit HTTP ${response.status}.`;
      // The agent's own checks (missing file, name taken, …) are the user's to fix.
      throw new AppError(response.status < 500 ? 'BAD_REQUEST' : 'UPSTREAM_ERROR', message, response.status);
    }
    return data as T;
  }

  return {
    url: settings.url,
    status: () => call('GET', '/api/status?refresh=1'),
    check: (request) => call('POST', '/api/check', request),
    listJobs: () => call('GET', '/api/jobs'),
    createJob: (request) => call('POST', '/api/jobs', request),
    cancelJob: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`),
    removeJob: (id) => call('DELETE', `/api/jobs/${encodeURIComponent(id)}`),
  };
}
