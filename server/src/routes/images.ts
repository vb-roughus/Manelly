import type { FastifyInstance, FastifyReply } from 'fastify';
import type { JellyfinConnection } from '../connection.js';
import type { ImageRequest, JellyfinClient } from '../jellyfin/client.js';
import { errorBody, requireClient } from '../errors.js';

// Only these query parameters are forwarded, so the route cannot be used as a
// generic proxy into the Jellyfin API.
const imageQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tag: { type: 'string', pattern: '^[A-Za-z0-9]{1,64}$' },
    maxWidth: { type: 'integer', minimum: 1, maximum: 3840 },
    maxHeight: { type: 'integer', minimum: 1, maximum: 3840 },
    quality: { type: 'integer', minimum: 1, maximum: 100 },
  },
} as const;

const idPattern = '^[0-9a-fA-F]{32}$|^[0-9a-fA-F-]{36}$';

interface ImageQuery {
  tag?: string;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export async function imageRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection }) {
  const { connection } = opts;

  app.get<{ Params: { itemId: string; type: string }; Querystring: ImageQuery }>(
    '/items/:itemId/:type',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            itemId: { type: 'string', pattern: idPattern },
            type: { type: 'string', enum: ['Primary', 'Backdrop', 'Thumb', 'Logo', 'Banner', 'Art'] },
          },
          required: ['itemId', 'type'],
        },
        querystring: imageQuerySchema,
      },
    },
    async (request, reply) => {
      const { itemId, type } = request.params;
      return proxyImage(reply, requireClient(connection.client), {
        path: `/Items/${itemId}/Images/${type}`,
        query: toSearchParams(request.query),
      }, request.query.tag);
    },
  );

  app.get<{ Params: { userId: string }; Querystring: ImageQuery }>(
    '/users/:userId',
    {
      schema: {
        params: {
          type: 'object',
          properties: { userId: { type: 'string', pattern: idPattern } },
          required: ['userId'],
        },
        querystring: imageQuerySchema,
      },
    },
    async (request, reply) => {
      return proxyImage(reply, requireClient(connection.client), {
        path: `/Users/${request.params.userId}/Images/Primary`,
        query: toSearchParams(request.query),
      }, request.query.tag);
    },
  );
}

function toSearchParams(query: ImageQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

async function proxyImage(reply: FastifyReply, client: JellyfinClient, request: ImageRequest, tag: string | undefined) {
  const upstream = await client.getImage(request);
  if (upstream.status === 404) {
    return reply.status(404).send(errorBody('NOT_FOUND', 'Bild nicht gefunden.'));
  }
  const contentType = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !contentType.startsWith('image/')) {
    return reply.status(502).send(errorBody('UPSTREAM_ERROR', `Jellyfin lieferte kein Bild (HTTP ${upstream.status}).`));
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  return reply
    .header('content-type', contentType)
    // The tag changes whenever the image changes, so tagged URLs can be cached forever.
    .header('cache-control', tag ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    .send(body);
}
