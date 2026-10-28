import type { AgentJellyfinAccess, ConversionJob } from '@manelly/shared';

export const AGENT_VERSION = '0.24.0';
const TIMEOUT_MS = 8000;

interface JfMediaStream {
  Type?: string;
  Index?: number;
  IsDefault?: boolean;
  Codec?: string;
  Height?: number;
  VideoRangeType?: string;
  Channels?: number;
  BitRate?: number;
}

/** The parts of a Jellyfin session the agent records. */
export interface JfSession {
  Id?: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  DeviceId?: string;
  RemoteEndPoint?: string;
  NowPlayingItem?: {
    Id?: string;
    Name?: string;
    Type?: string;
    SeriesName?: string;
    ParentIndexNumber?: number;
    IndexNumber?: number;
    ProductionYear?: number;
    Artists?: string[];
    Container?: string;
    MediaStreams?: JfMediaStream[];
  };
  PlayState?: { PlayMethod?: string; AudioStreamIndex?: number };
  TranscodingInfo?: {
    Container?: string;
    VideoCodec?: string;
    AudioCodec?: string;
    IsVideoDirect?: boolean;
    IsAudioDirect?: boolean;
    Height?: number;
    AudioChannels?: number;
    Bitrate?: number;
    HardwareAccelerationType?: string;
    TranscodeReasons?: string[];
  };
}

/** What the agent asks Jellyfin: who streams what, and to scan a new file. */
export interface JellyfinApi {
  sessions(): Promise<JfSession[]>;
  countStreams(): Promise<number>;
  mediaUpdated(updates: Array<{ Path: string; UpdateType: 'Created' | 'Modified' | 'Deleted' }>): Promise<void>;
}

export function createJellyfinApi(access: AgentJellyfinAccess, fetchImpl: typeof fetch = fetch): JellyfinApi {
  const authorization =
    `MediaBrowser Client="Manelly Agent", Device="Manelly Agent", DeviceId="manelly-agent", ` +
    `Version="${AGENT_VERSION}", Token="${access.apiKey}"`;

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${access.url}${path}`, {
        method,
        headers: { Authorization: authorization, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : (error as Error).message;
      throw new Error(`Jellyfin ist unter ${access.url} nicht erreichbar (${cause}).`);
    }
    if (response.status === 401 || response.status === 403) throw new Error('Jellyfin lehnt den API-Schlüssel ab.');
    if (!response.ok) throw new Error(`Jellyfin antwortete mit HTTP ${response.status}.`);
    return response;
  }

  async function sessions(): Promise<JfSession[]> {
    const list = (await (await request('GET', '/Sessions?activeWithinSeconds=960')).json()) as unknown;
    return Array.isArray(list) ? (list as JfSession[]) : [];
  }

  return {
    sessions,
    async countStreams() {
      // Paused streams count too: whoever paused will likely continue.
      return (await sessions()).filter((session) => session.NowPlayingItem).length;
    },
    async mediaUpdated(updates) {
      await request('POST', '/Library/Media/Updated', { Updates: updates });
    },
  };
}

/** The changed paths of a finished conversion, as Jellyfin's scanner wants them. */
export function mediaUpdatesFor(job: ConversionJob): Parameters<JellyfinApi['mediaUpdated']>[0] {
  if (job.output === job.source) return [{ Path: job.output, UpdateType: 'Modified' }];
  const updates: Parameters<JellyfinApi['mediaUpdated']>[0] = [{ Path: job.output, UpdateType: 'Created' }];
  if (job.backup) updates.push({ Path: job.source, UpdateType: 'Deleted' });
  return updates;
}

/** Tells Jellyfin about finished conversions, so it scans the new file right away – even when Manelly is not running. */
export function createNotifier(access: () => AgentJellyfinAccess | null, options: { fetch?: typeof fetch; log?: (message: string) => void } = {}) {
  return async (job: ConversionJob): Promise<boolean> => {
    const current = access();
    if (!current) return false;
    try {
      await createJellyfinApi(current, options.fetch).mediaUpdated(mediaUpdatesFor(job));
      return true;
    } catch (error) {
      options.log?.(`Jellyfin konnte nicht über die neue Datei informiert werden: ${(error as Error).message}`);
      return false;
    }
  };
}
