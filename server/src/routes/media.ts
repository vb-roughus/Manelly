import type { FastifyInstance } from 'fastify';
import type {
  MediaDetail,
  MediaDiagnosisResponse,
  MediaFacetsResponse,
  MediaIndexStatus,
  MediaSearchParams,
  MediaSearchResponse,
} from '@manelly/shared';
import type { JellyfinConnection } from '../connection.js';
import { AppError, requireClient } from '../errors.js';
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
    dynamicRange: list({ type: 'string', enum: ['DV', 'HDR10+', 'HDR10', 'HLG', 'SDR'] }),
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

export async function mediaRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection; store: MediaIndexStore }) {
  const { connection, store } = opts;

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
