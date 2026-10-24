import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConnectionSettings,
  SaveSettingsRequest,
  SaveSettingsResponse,
  ServerStatus,
  SessionsResponse,
} from '@manelly/shared';
import { fetchJson, sendJson } from '../lib/api';

export const SESSIONS_REFRESH_MS = 5_000;

/** Pass `enabled: false` until a connection is set up, so nothing polls in the meantime. */
export function useSessions(enabled = true) {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => fetchJson<SessionsResponse>('/api/sessions', signal),
    refetchInterval: SESSIONS_REFRESH_MS,
    enabled,
  });
}

export function useServerStatus(enabled = true) {
  return useQuery({
    queryKey: ['server'],
    queryFn: ({ signal }) => fetchJson<ServerStatus>('/api/server', signal),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => fetchJson<ConnectionSettings>('/api/settings', signal),
    // Only retried while the Manelly server is unreachable; changes come from useSaveSettings.
    refetchInterval: (query) => (query.state.status === 'error' ? SESSIONS_REFRESH_MS : false),
  });
}

export function isConfigured(settings: ConnectionSettings): boolean {
  return settings.jellyfinUrl !== null && settings.apiKeyConfigured;
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: SaveSettingsRequest) => sendJson<SaveSettingsResponse>('PUT', '/api/settings', request),
    onSuccess: ({ settings, server }) => {
      queryClient.setQueryData(['settings'], settings);
      queryClient.setQueryData(['server'], server);
      // Everything else was fetched from the previous server (or none at all).
      void queryClient.invalidateQueries({ predicate: (query) => !['settings', 'server'].includes(String(query.queryKey[0])) });
    },
  });
}
