import type { FastifyInstance } from 'fastify';
import type {
  LibraryScanRequest,
  LibraryScanStatus,
  MediaDetail,
  MediaDiagnosisResponse,
  MediaFacetsResponse,
  MediaIndexStatus,
  LibrarySeries,
  MediaLibrary,
  MediaSearchParams,
  MediaSearchResponse,
  SeriesSeason,
} from '@manelly/shared';
import type { JellyfinConnection } from '../connection.js';
import { samePath } from '../agent/conversions.js';
import { AppError, requireClient } from '../errors.js';
import type { LibraryScanner } from '../media/scan.js';
import type { MediaIndexStore } from '../media/store.js';
import { diagnoseTitle } from '../media/diagnose.js';
import { mediaDetail, searchMedia } from '../media/search.js';

const AUDIO_FORMATS = ['atmos', 'dtsx', 'truehd', 'eac3', 'ac3', 'dts-hd-ma', 'dts-hd', 'dts', 'aac', 'flac', 'pcm', 'opus', 'mp3', 'vorbis', 'other'];

const list = (items: object = { type: 'string', maxLength: 200 }) => ({ type: 'array', maxItems: 50, items });

// Fastify coerces single values to arrays, so ?genre=Drama and ?genre=Drama&genre=Krimi both work.
export const searchQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 200 },
    type: { type: 'string', enum: ['Movie', 'Series'] },
    genre: list(),
    yearFrom: { type: 'integer', minimum: 1800, maximum: 3000 },
    yearTo: { type: 'integer', minimum: 1800, maximum: 3000 },
    minRating: { type: 'number', minimum: 0, maximum: 10 },
    officialRating: list(),
    resolution: list({ type: 'string', enum: ['4K', '1080p', '720p', 'SD'] }),
    dynamicRange: list({ type: 'string', enum: ['DV', 'DV7', 'HDR10+', 'HDR10', 'HLG', 'SDR'] }),
    videoCodec: list({ type: 'string', enum: ['hevc', 'h264', 'av1', 'vp9', 'mpeg4', 'mpeg2', 'vc1', 'other'] }),
    library: list(),
    audioLanguage: list({ type: 'string', maxLength: 20 }),
    audioFormat: list({ type: 'string', enum: AUDIO_FORMATS }),
    audioMinChannels: { type: 'integer', minimum: 1, maximum: 32 },
    audioMode: { type: 'string', enum: ['has', 'lacks'] },
    audioCoverage: { type: 'string', enum: ['any', 'all'] },
    sort: { type: 'string', enum: ['name', 'year', 'rating', 'added'] },
    order: { type: 'string', enum: ['asc', 'desc'] },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
} as const;

export async function mediaRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection; store: MediaIndexStore; scanner: LibraryScanner }) {
  const { connection, store, scanner } = opts;

  const status = (): MediaIndexStatus => {
    requireClient(connection.client);
    return store.status();
  };

  app.get('/status', async (): Promise<MediaIndexStatus> => status());

  app.post('/refresh', async (): Promise<MediaIndexStatus> => {
    requireClient(connection.client);
    store.refresh();
    return store.status();
  });

  // The libraries and their folders, e.g. as targets for what JDownloader extracted.
  app.get('/libraries', async (): Promise<MediaLibrary[]> =>
    (await requireClient(connection.client).getLibraries()).map((library) => ({
      id: library.ItemId ?? null,
      name: library.Name ?? 'Unbenannt',
      type: library.CollectionType ?? null,
      locations: library.Locations ?? [],
    })),
  );

  const id = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F-]{1,64}$' } } };
  const noFrills = { enableImages: 'false', enableUserData: 'false' };

  // The series of a library with their folders, e.g. as a target for new episodes or seasons.
  app.get<{ Params: { id: string } }>('/libraries/:id/series', { schema: { params: id } }, async (request): Promise<LibrarySeries[]> => {
    const query = new URLSearchParams({ parentId: request.params.id, includeItemTypes: 'Series', recursive: 'true', fields: 'Path', sortBy: 'SortName', sortOrder: 'Ascending', ...noFrills });
    const result = await requireClient(connection.client).getItems(query);
    return (result.Items ?? [])
      .filter((item) => item.Id && item.Path)
      .map((item) => ({ id: item.Id!, name: item.Name ?? 'Unbenannt', year: item.ProductionYear ?? null, path: item.Path! }));
  });

  // The seasons of a series that have a folder of their own; where episodes lie in the series folder itself, none.
  app.get<{ Params: { id: string } }>('/series/:id/seasons', { schema: { params: id } }, async (request): Promise<SeriesSeason[]> => {
    const client = requireClient(connection.client);
    const [series, seasons] = await Promise.all([
      client.getItems(new URLSearchParams({ ids: request.params.id, fields: 'Path', ...noFrills })),
      client.getItems(new URLSearchParams({ parentId: request.params.id, includeItemTypes: 'Season', fields: 'Path', sortBy: 'IndexNumber', sortOrder: 'Ascending', ...noFrills })),
    ]);
    const folder = series.Items?.[0]?.Path;
    if (!folder) throw new AppError('NOT_FOUND', 'Diese Serie kennt Jellyfin nicht (mehr).');
    return (seasons.Items ?? [])
      .filter((season) => season.Id && season.Path && !samePath(season.Path, folder))
      .map((season) => ({ id: season.Id!, name: season.Name ?? 'Staffel', index: season.IndexNumber ?? null, path: season.Path! }));
  });

  // Jellyfin's scan of its libraries; once it ended, the index is read again.
  app.get('/scan', async (): Promise<LibraryScanStatus> => scanner.status());
  // Without a body, or without a library, all libraries are scanned.
  app.post<{ Body: LibraryScanRequest }>(
    '/scan',
    {
      preValidation: async (request) => {
        request.body ??= {};
      },
      schema: { body: { type: 'object', additionalProperties: false, properties: { libraryId: { type: 'string', minLength: 1, maxLength: 64 } } } },
    },
    async (request): Promise<LibraryScanStatus> => (request.body.libraryId ? scanner.startLibrary(request.body.libraryId) : scanner.start()),
  );
  app.delete('/scan', async (): Promise<LibraryScanStatus> => scanner.cancel());

  app.get('/facets', async (): Promise<MediaFacetsResponse> => {
    status();
    return { facets: store.get()?.facets ?? null, index: store.status() };
  });

  app.get<{ Querystring: MediaSearchParams }>(
    '/search',
    { schema: { querystring: searchQuerySchema } },
    async (request): Promise<MediaSearchResponse> => {
      status();
      const index = store.get();
      const result = index ? searchMedia(index, request.query) : { items: [], total: 0 };
      return { ...result, offset: request.query.offset ?? 0, index: store.status() };
    },
  );

  // Why is a title (not) in the search? Takes the current filters plus the title to look for.
  app.get<{ Querystring: MediaSearchParams & { title: string } }>(
    '/diagnose',
    {
      schema: {
        querystring: {
          ...searchQuerySchema,
          required: ['title'],
          properties: { ...searchQuerySchema.properties, title: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request): Promise<MediaDiagnosisResponse> => {
      const client = requireClient(connection.client);
      const { title, ...filters } = request.query;
      const index = store.get();
      const status = store.status();
      const results = await diagnoseTitle(client, index, title.trim(), filters, { building: status.state === 'building' });
      return { title: title.trim(), index: status, results };
    },
  );

  app.get<{ Params: { id: string }; Querystring: MediaSearchParams }>(
    '/items/:id',
    { schema: { querystring: searchQuerySchema } },
    async (request): Promise<MediaDetail> => {
      status();
      const item = store.get()?.byId.get(request.params.id);
      if (!item) throw new AppError('NOT_FOUND', 'Dieser Titel ist nicht (mehr) im Medien-Index.');
      return mediaDetail(item, request.query);
    },
  );
}
