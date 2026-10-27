import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddToCollectionRequest,
  AgentNetworkList,
  AgentNetworkStatus,
  AgentOverview,
  AgentResourceStatus,
  AgentScheduleStatus,
  AgentSettingsView,
  ConversionJob,
  ConversionOptions,
  ConversionSchedule,
  HardwareTestResult,
  HistoryResponse,
  HistorySettings,
  JDownloaderAction,
  JDownloaderSettings,
  JDownloaderStatus,
  LinkGrabberMoveRequest,
  LinkGrabberStatus,
  SaveAgentSettingsRequest,
  StartConversionRequest,
  AddToCollectionResponse,
  CollectionPreview,
  CollectionsResponse,
  ConnectionSettings,
  MediaDetail,
  MediaDiagnosisResponse,
  MediaFacetsResponse,
  MediaIndexStatus,
  MediaSearchResponse,
  SaveSettingsRequest,
  SaveSettingsResponse,
  ServerStatus,
  SessionsResponse,
  TranscodingReport,
} from '@manelly/shared';
import { fetchJson, sendJson } from '../lib/api';
import { toSearchParams, type MediaFilters } from '../lib/media';

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

// --- Media -------------------------------------------------------------------

/** While the index is being built, poll so progress and results appear on their own. */
const whileBuilding = (state: string | undefined) => (state === 'building' ? 1500 : false);

export function useMediaFacets(enabled: boolean) {
  return useQuery({
    queryKey: ['media', 'facets'],
    queryFn: ({ signal }) => fetchJson<MediaFacetsResponse>('/api/media/facets', signal),
    refetchInterval: (query) => whileBuilding(query.state.data?.index.state),
    enabled,
  });
}

export const MEDIA_PAGE_SIZE = 60;

export function useMediaSearch(filters: MediaFilters, enabled: boolean) {
  const query = toSearchParams(filters).toString();
  return useInfiniteQuery({
    queryKey: ['media', 'search', query],
    queryFn: ({ signal, pageParam }) =>
      fetchJson<MediaSearchResponse>(
        `/api/media/search?${toSearchParams({ ...filters, offset: pageParam, limit: MEDIA_PAGE_SIZE })}`,
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total ? next : undefined;
    },
    // Keep the old results on screen while new filters load.
    placeholderData: keepPreviousData,
    refetchInterval: (q) => whileBuilding(q.state.data?.pages[0]?.index.state),
    enabled,
  });
}

export function useMediaDetail(id: string | null, filters: MediaFilters) {
  const query = toSearchParams(filters).toString();
  return useQuery({
    queryKey: ['media', 'detail', id, query],
    queryFn: ({ signal }) => fetchJson<MediaDetail>(`/api/media/items/${encodeURIComponent(id!)}?${query}`, signal),
    enabled: id !== null,
  });
}

/** Why titles named like `title` are (not) in the search; re-checks on its own while the index is rebuilt. */
export function useMediaDiagnosis(title: string, filters: MediaFilters) {
  const query = toSearchParams({ ...filters }).toString();
  return useQuery({
    queryKey: ['media', 'diagnose', title, query],
    queryFn: ({ signal }) =>
      fetchJson<MediaDiagnosisResponse>(`/api/media/diagnose?${new URLSearchParams({ title })}&${query}`, signal),
    enabled: title.length > 0,
    refetchInterval: (q) => whileBuilding(q.state.data?.index.state),
  });
}

export function useRefreshMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<MediaIndexStatus>('POST', '/api/media/refresh', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['media'] }),
  });
}

// --- Collections -------------------------------------------------------------

export function useCollections(enabled: boolean) {
  return useQuery({
    queryKey: ['collections'],
    queryFn: ({ signal }) => fetchJson<CollectionsResponse>('/api/collections', signal),
    enabled,
  });
}

/** How many of the titles matching `filters` are missing from the collection (null: a new one). */
export function useCollectionPreview(collectionId: string | null, filters: MediaFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['collections', 'preview', collectionId, toSearchParams(filters).toString()],
    queryFn: ({ signal }) => sendJson<CollectionPreview>('POST', '/api/collections/preview', { collectionId, filters }, signal),
    enabled,
  });
}

export function useAddToCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AddToCollectionRequest) => sendJson<AddToCollectionResponse>('POST', '/api/collections/add', request),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['collections'] }),
  });
}

// --- Agent -------------------------------------------------------------------

/** `refreshTools` (settings page) lets the agent look for newly installed tools. */
export function useAgent(options: { enabled?: boolean; refreshTools?: boolean; pollMs?: number } = {}) {
  const { enabled = true, refreshTools = false, pollMs = 30_000 } = options;
  return useQuery({
    queryKey: ['agent', refreshTools],
    queryFn: ({ signal }) => fetchJson<AgentOverview>(`/api/agent${refreshTools ? '?refresh=1' : ''}`, signal),
    refetchInterval: pollMs,
    enabled,
  });
}

export function useAgentSettings() {
  return useQuery({
    queryKey: ['agent-settings'],
    queryFn: ({ signal }) => fetchJson<AgentSettingsView>('/api/agent/settings', signal),
  });
}

export function useSaveAgentSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: SaveAgentSettingsRequest) => sendJson<AgentOverview>('PUT', '/api/agent/settings', request),
    onSuccess: (overview) => {
      queryClient.setQueryData(['agent', true], overview);
      void queryClient.invalidateQueries({ queryKey: ['agent'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['conversions'] });
    },
  });
}

const isActive = (job: ConversionJob) => job.state === 'queued' || job.state === 'running';

/** Polls quickly while something converts, slowly otherwise. */
/** Ends the agent's process. Asked again a moment later, the agent is gone. */
export function useStopAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<null>('POST', '/api/agent/shutdown'),
    onSuccess: () => {
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['agent'] }), 1500);
    },
  });
}

/** Ends the agent so its runner starts it again – after a git pull and a build when `update` is set. */
export function useRestartAgent() {
  return useMutation({
    mutationFn: (update: boolean) => sendJson<{ restarting: boolean }>('POST', '/api/agent/restart', { update }),
  });
}

export function useConversions(enabled = true) {
  return useQuery({
    queryKey: ['conversions'],
    queryFn: ({ signal }) => fetchJson<ConversionJob[]>('/api/agent/jobs', signal),
    refetchInterval: (query) => (query.state.data?.some(isActive) ? 2_000 : 15_000),
    enabled,
  });
}

export function useConversionOptions(itemId: string, mediaSourceId: string | null, enabled: boolean) {
  const params = new URLSearchParams({ itemId, ...(mediaSourceId ? { mediaSourceId } : {}) });
  return useQuery({
    queryKey: ['conversion-options', itemId, mediaSourceId],
    queryFn: ({ signal }) => fetchJson<ConversionOptions>(`/api/agent/conversions/options?${params}`, signal),
    enabled,
    // Free space changes; always ask again when the dialog opens.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function useStartConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: StartConversionRequest) => sendJson<ConversionJob>('POST', '/api/agent/jobs', request),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['conversions'] }),
  });
}

export function useCancelConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<ConversionJob>('POST', `/api/agent/jobs/${encodeURIComponent(id)}/cancel`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['conversions'] }),
  });
}

/** Starts a scheduled conversion without waiting for the schedule. */
export function useStartConversionNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<ConversionJob>('POST', `/api/agent/jobs/${encodeURIComponent(id)}/start`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['conversions'] }),
  });
}

export function useSaveSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (schedule: ConversionSchedule) => sendJson<AgentScheduleStatus>('PUT', '/api/agent/schedule', schedule),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent'] });
      void queryClient.invalidateQueries({ queryKey: ['conversions'] });
    },
  });
}

export function useRemoveConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<null>('DELETE', `/api/agent/jobs/${encodeURIComponent(id)}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['conversions'] }),
  });
}

// --- Server ------------------------------------------------------------------

export function useTranscodingReport(enabled = true) {
  return useQuery({
    queryKey: ['transcoding'],
    queryFn: ({ signal }) => fetchJson<TranscodingReport>('/api/server/transcoding', signal),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useHardwareTest() {
  return useMutation({
    mutationFn: () => sendJson<HardwareTestResult>('POST', '/api/server/transcoding/test'),
  });
}

// --- Agent: network ---------------------------------------------------------------

/** All interfaces of the Jellyfin server; listing them takes the agent a moment on Windows. */
export function useNetworkInterfaces(enabled: boolean) {
  return useQuery({
    queryKey: ['network-interfaces'],
    queryFn: ({ signal }) => fetchJson<AgentNetworkList>('/api/agent/network/interfaces', signal),
    enabled,
    retry: false,
  });
}

export function useSaveNetworkInterfaces() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => sendJson<AgentNetworkList>('PUT', '/api/agent/network/interfaces', { interfaces: ids }),
    onSuccess: (list) => {
      queryClient.setQueryData(['network-interfaces'], list);
      void queryClient.invalidateQueries({ queryKey: ['agent'] });
      void queryClient.invalidateQueries({ queryKey: ['network'] });
    },
  });
}

/** Rates of the monitored interfaces; asking keeps the agent measuring. Slow polling while nothing is monitored. */
export function useAgentNetwork(enabled: boolean) {
  return useQuery({
    queryKey: ['network'],
    queryFn: ({ signal }) => fetchJson<AgentNetworkStatus>('/api/agent/network', signal),
    refetchInterval: (query) => (query.state.data?.interfaces.length ? 4_000 : 60_000),
    enabled,
    retry: false,
  });
}

/** CPU and GPU of the Jellyfin server; only while shown, because the agent measures only while asked. */
export function useAgentResources(enabled: boolean) {
  return useQuery({
    queryKey: ['resources'],
    queryFn: ({ signal }) => fetchJson<AgentResourceStatus>('/api/agent/resources', signal),
    refetchInterval: 3_000,
    enabled,
    retry: false,
  });
}

// --- Agent: JDownloader ---------------------------------------------------------------

/** With `links`, every package lists its parts too (the JDownloader page); the dashboard does without. */
export function useJDownloader(enabled: boolean, pollMs: number | false = 4_000, links = false) {
  return useQuery({
    queryKey: links ? ['jdownloader', 'links'] : ['jdownloader'],
    queryFn: ({ signal }) => fetchJson<JDownloaderStatus>(links ? '/api/agent/jdownloader?links=1' : '/api/agent/jdownloader', signal),
    refetchInterval: pollMs,
    enabled,
    retry: false,
  });
}

function useJDownloaderMutation<T>(send: (request: T) => Promise<JDownloaderStatus>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: async (status) => {
      queryClient.setQueryData(['jdownloader'], status);
      void queryClient.invalidateQueries({ queryKey: ['agent'] });
      // The answer lacks the parts; stay pending until the JDownloader page has them fresh.
      await queryClient.invalidateQueries({ queryKey: ['jdownloader', 'links'] });
    },
  });
}

export const useSaveJDownloaderSettings = () =>
  useJDownloaderMutation((settings: JDownloaderSettings) => sendJson<JDownloaderStatus>('PUT', '/api/agent/jdownloader/settings', settings));

export const useControlJDownloader = () =>
  useJDownloaderMutation((action: JDownloaderAction) => sendJson<JDownloaderStatus>('POST', '/api/agent/jdownloader/control', { action }));

export const useJDownloaderLimit = () =>
  useJDownloaderMutation((limit: { enabled: boolean; kbps: number }) => sendJson<JDownloaderStatus>('PUT', '/api/agent/jdownloader/limit', limit));

export function useLinkGrabber(enabled: boolean, pollMs: number) {
  return useQuery({
    queryKey: ['linkgrabber'],
    queryFn: ({ signal }) => fetchJson<LinkGrabberStatus>('/api/agent/jdownloader/linkgrabber', signal),
    refetchInterval: pollMs,
    enabled,
    retry: false,
  });
}

/** Packages and links go to JDownloader's download list; the answer is what is left in the link grabber. */
export function useMoveFromLinkGrabber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: LinkGrabberMoveRequest) => sendJson<LinkGrabberStatus>('POST', '/api/agent/jdownloader/linkgrabber/move', request),
    onSuccess: (status) => {
      queryClient.setQueryData(['linkgrabber'], status);
      void queryClient.invalidateQueries({ queryKey: ['jdownloader'] });
    },
  });
}

// --- Agent: recorded history ------------------------------------------------------------

/** Load and streams recorded by the agent; `end` null follows the present. */
export function useHistory(span: number, end: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['history', span, end],
    queryFn: ({ signal }) => {
      const to = Math.round(end ?? Date.now());
      return fetchJson<HistoryResponse>(`/api/agent/history?from=${to - Math.round(span)}&to=${to}`, signal);
    },
    enabled,
    // The charts keep showing the last range while the next one loads.
    placeholderData: keepPreviousData,
    // The agent records every 15 s; long ranges change slowly.
    refetchInterval: end === null ? Math.max(30_000, span / 720) : false,
    retry: false,
  });
}

export function useSaveHistorySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: HistorySettings) => sendJson<HistorySettings>('PUT', '/api/agent/history/settings', settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      void queryClient.invalidateQueries({ queryKey: ['agent'] });
    },
  });
}

export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<null>('DELETE', '/api/agent/history'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['history'] }),
  });
}
