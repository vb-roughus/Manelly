import type { FastifyInstance } from 'fastify';
import type { ServerStatus, SessionsResponse } from '@manelly/shared';
import type { JellyfinClient } from '../jellyfin/client.js';
import { requireClient } from '../errors.js';
import { buildSessionsResponse } from '../sessions.js';

export async function apiRoutes(app: FastifyInstance, opts: { client: JellyfinClient | null }) {
  const { client } = opts;

  // Liveness of Manelly itself, independent of Jellyfin (used by the Docker health check).
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/server', async (): Promise<ServerStatus> => {
    const jellyfin = requireClient(client);
    const info = await jellyfin.getSystemInfo();
    return {
      id: info.Id ?? '',
      name: info.ServerName ?? 'Jellyfin',
      version: info.Version ?? 'unbekannt',
      operatingSystem: info.OperatingSystemDisplayName ?? info.OperatingSystem ?? null,
      hasPendingRestart: info.HasPendingRestart ?? false,
      hasUpdateAvailable: info.HasUpdateAvailable ?? false,
      url: jellyfin.baseUrl,
    };
  });

  app.get('/sessions', async (): Promise<SessionsResponse> => {
    const jellyfin = requireClient(client);
    return buildSessionsResponse(await jellyfin.getSessions());
  });
}
