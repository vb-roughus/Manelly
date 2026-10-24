import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody, ApiErrorCode } from '@manelly/shared';
import { JellyfinError, type JellyfinClient } from './jellyfin/client.js';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  NOT_CONFIGURED: 503,
  UNAUTHORIZED: 502,
  UNREACHABLE: 502,
  TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
};

export function requireClient(client: JellyfinClient | null): JellyfinClient {
  if (!client) {
    throw new JellyfinError(
      'NOT_CONFIGURED',
      'Manelly ist noch nicht mit Jellyfin verbunden. Setze JELLYFIN_URL und JELLYFIN_API_KEY und starte Manelly neu.',
    );
  }
  return client;
}

export function errorBody(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export function handleError(error: FastifyError | JellyfinError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof JellyfinError) {
    request.log.warn({ code: error.code, upstreamStatus: error.status }, error.message);
    return reply.status(STATUS_BY_CODE[error.code]).send(errorBody(error.code, error.message));
  }
  if (error.validation) {
    return reply.status(400).send(errorBody('BAD_REQUEST', error.message));
  }
  request.log.error(error);
  return reply.status(500).send(errorBody('UPSTREAM_ERROR', 'Interner Fehler in Manelly.'));
}
