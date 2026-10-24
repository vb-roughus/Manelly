import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody, ApiErrorCode } from '@manelly/shared';
import { ConfigError } from './config.js';
import type { JellyfinClient } from './jellyfin/client.js';

/** An error with an API error code; the error handler turns it into a JSON response. */
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  NOT_CONFIGURED: 503,
  UNAUTHORIZED: 502,
  UNREACHABLE: 502,
  TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export function requireClient(client: JellyfinClient | null): JellyfinClient {
  if (!client) {
    throw new AppError(
      'NOT_CONFIGURED',
      'Manelly ist noch nicht mit Jellyfin verbunden. Trage Server-Adresse und API-Schlüssel in den Einstellungen ein.',
    );
  }
  return client;
}

export function errorBody(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export function handleError(error: FastifyError | AppError | ConfigError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    request.log.warn({ code: error.code, upstreamStatus: error.status }, error.message);
    return reply.status(STATUS_BY_CODE[error.code]).send(errorBody(error.code, error.message));
  }
  if (error instanceof ConfigError) {
    return reply.status(400).send(errorBody('BAD_REQUEST', error.message));
  }
  if ('validation' in error && error.validation) {
    return reply.status(400).send(errorBody('BAD_REQUEST', error.message));
  }
  request.log.error(error);
  return reply.status(500).send(errorBody('INTERNAL_ERROR', 'Interner Fehler in Manelly.'));
}
