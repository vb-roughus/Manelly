import type { ServerStatus } from '@manelly/shared';
import { JellyfinError, type JellyfinClient } from './jellyfin/client.js';

export async function fetchServerStatus(client: JellyfinClient): Promise<ServerStatus> {
  const info = await client.getSystemInfo();
  if (!info.Version) {
    throw new JellyfinError('UPSTREAM_ERROR', `Unter ${client.baseUrl} antwortet kein Jellyfin-Server.`);
  }
  return {
    id: info.Id ?? '',
    name: info.ServerName ?? 'Jellyfin',
    version: info.Version,
    operatingSystem: info.OperatingSystemDisplayName ?? info.OperatingSystem ?? null,
    hasPendingRestart: info.HasPendingRestart ?? false,
    hasUpdateAvailable: info.HasUpdateAvailable ?? false,
    url: client.baseUrl,
  };
}
