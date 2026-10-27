import type {
  AgentCheckRequest,
  AgentCheckResponse,
  AgentJellyfinAccess,
  AgentNetworkList,
  AgentNetworkStatus,
  AgentResourceStatus,
  AgentScheduleStatus,
  AgentStatus,
  ConversionJob,
  ConversionRequest,
  ConversionSchedule,
  HardwareTestRequest,
  HardwareTestResult,
} from '@manelly/shared';
import { AppError } from '../errors.js';

export interface AgentSettings {
  url: string;
  token: string;
}

export interface AgentClient {
  readonly url: string;
  /** `refresh` makes the agent look for its tools again (it starts a few processes for that). */
  status(refresh?: boolean): Promise<AgentStatus>;
  check(request: AgentCheckRequest): Promise<AgentCheckResponse>;
  listJobs(): Promise<ConversionJob[]>;
  createJob(request: ConversionRequest): Promise<ConversionJob>;
  cancelJob(id: string): Promise<ConversionJob>;
  /** Starts a scheduled conversion without waiting for the schedule. */
  startJob(id: string): Promise<ConversionJob>;
  removeJob(id: string): Promise<void>;
  testHardware(request: HardwareTestRequest): Promise<HardwareTestResult>;
  setSchedule(schedule: ConversionSchedule): Promise<AgentScheduleStatus>;
  /** Lets the agent see streams and report new files to Jellyfin. */
  setJellyfin(access: AgentJellyfinAccess): Promise<void>;
  networkInterfaces(): Promise<AgentNetworkList>;
  setNetworkInterfaces(ids: string[]): Promise<AgentNetworkList>;
  /** Rates of the monitored interfaces; asking keeps the agent measuring. */
  network(): Promise<AgentNetworkStatus>;
  /** CPU and GPU of the Jellyfin server; asking keeps the agent measuring. */
  resources(): Promise<AgentResourceStatus>;
}

const TIMEOUT_MS = 8000;

/** Talks to the Manelly agent on the Jellyfin server. */
export function createAgentClient(settings: AgentSettings, options: { fetch?: typeof fetch } = {}): AgentClient {
  const fetchImpl = options.fetch ?? fetch;

  async function call<T>(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${settings.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${settings.token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new AppError('TIMEOUT', `Der Agent hat nicht innerhalb von ${timeoutMs / 1000} s geantwortet (${settings.url}).`);
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
    status: (refresh = false) => call('GET', refresh ? '/api/status?refresh=1' : '/api/status'),
    check: (request) => call('POST', '/api/check', request),
    listJobs: () => call('GET', '/api/jobs'),
    createJob: (request) => call('POST', '/api/jobs', request),
    cancelJob: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`),
    startJob: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/start`),
    removeJob: (id) => call('DELETE', `/api/jobs/${encodeURIComponent(id)}`),
    // Several short FFmpeg runs; each may take up to a minute on a struggling machine.
    testHardware: (request) => call('POST', '/api/hwtest', request, 5 * 60_000),
    setSchedule: (schedule) => call('PUT', '/api/schedule', schedule),
    setJellyfin: (access) => call('PUT', '/api/jellyfin', access),
    // Listing the interfaces starts a PowerShell on Windows, which can take a few seconds.
    networkInterfaces: () => call('GET', '/api/network/interfaces', undefined, 30_000),
    setNetworkInterfaces: (ids) => call('PUT', '/api/network/interfaces', { interfaces: ids }, 30_000),
    network: () => call('GET', '/api/network'),
    resources: () => call('GET', '/api/resources'),
  };
}
