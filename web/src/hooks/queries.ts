import { useQuery } from '@tanstack/react-query';
import type { ServerStatus, SessionsResponse } from '@manelly/shared';
import { fetchJson } from '../lib/api';

export const SESSIONS_REFRESH_MS = 5_000;

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => fetchJson<SessionsResponse>('/api/sessions', signal),
    refetchInterval: SESSIONS_REFRESH_MS,
  });
}

export function useServerStatus() {
  return useQuery({
    queryKey: ['server'],
    queryFn: ({ signal }) => fetchJson<ServerStatus>('/api/server', signal),
    refetchInterval: 60_000,
  });
}
