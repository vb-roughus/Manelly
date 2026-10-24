import type { FastifyInstance } from 'fastify';
import type { ServerStatus, SessionsResponse } from '@manelly/shared';
import type { JellyfinConnection } from '../connection.js';
import { requireClient } from '../errors.js';
import { buildSessionsResponse } from '../sessions.js';
import { fetchServerStatus } from '../status.js';

export async function apiRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection }) {
  const { connection } = opts;

  // Liveness of Manelly itself, independent of Jellyfin (used by the Docker health check).
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/server', async (): Promise<ServerStatus> => {
    return fetchServerStatus(requireClient(connection.client));
  });

  app.get('/sessions', async (): Promise<SessionsResponse> => {
    const jellyfin = requireClient(connection.client);
    return buildSessionsResponse(await jellyfin.getSessions());
  });
}
