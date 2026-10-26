import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddToCollectionRequest,
  AgentOverview,
  AgentSettingsView,
  ConversionJob,
  ConversionOptions,
  HardwareTestResult,
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
export function useAgent(options: { enabled?: boolean; refreshTools?: boolean } = {}) {
  const { enabled = true, refreshTools = false } = options;
  return useQuery({
    queryKey: ['agent', refreshTools],
    queryFn: ({ signal }) => fetchJson<AgentOverview>(`/api/agent${refreshTools ? '?refresh=1' : ''}`, signal),
    refetchInterval: 30_000,
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
