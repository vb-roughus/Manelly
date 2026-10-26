import type { FastifyInstance } from 'fastify';
import type { ServerStatus, SessionsResponse } from '@manelly/shared';
import type { JellyfinConnection } from '../connection.js';
import { requireClient } from '../errors.js';
import { buildSessionsResponse, transcodedMediaSources } from '../sessions.js';
import { fetchServerStatus } from '../status.js';
import { createStreamContextCache } from '../streamHealth.js';
import type { TranscodeLogReader } from '../transcodeLog.js';

export async function apiRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection; logs: TranscodeLogReader }) {
  const { connection, logs } = opts;
  const streamContext = createStreamContextCache();

  // Liveness of Manelly itself, independent of Jellyfin (used by the Docker health check).
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/server', async (): Promise<ServerStatus> => {
    return fetchServerStatus(requireClient(connection.client));
  });

  app.get('/sessions', async (): Promise<SessionsResponse> => {
    const jellyfin = requireClient(connection.client);
    // The settings for the stream diagnosis are cached and never fail the request.
    const [sessions, context] = await Promise.all([jellyfin.getSessions(), streamContext.get(jellyfin)]);
    // The FFmpeg log shows whether a transcode really runs on the hardware; without access the diagnosis uses the settings.
    const transcodeLogs = await logs.forMediaSources(jellyfin, transcodedMediaSources(sessions)).catch(() => new Map());
    return buildSessionsResponse(sessions, new Date(), context, transcodeLogs);
  });
}
