import type { FastifyInstance } from 'fastify';
import type { ConnectionSettings, SaveSettingsRequest, SaveSettingsResponse } from '@manelly/shared';
import { normalizeJellyfinUrl } from '../config.js';
import type { JellyfinConnection } from '../connection.js';
import { AppError } from '../errors.js';
import { fetchServerStatus } from '../status.js';

const KEY_HINT_LENGTH = 4;

export async function settingsRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection }) {
  const { connection } = opts;

  app.get('/', async (): Promise<ConnectionSettings> => toConnectionSettings(connection));

  app.put<{ Body: SaveSettingsRequest }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['jellyfinUrl'],
          properties: {
            jellyfinUrl: { type: 'string', minLength: 1, maxLength: 2048 },
            apiKey: { type: 'string', maxLength: 256 },
          },
        },
      },
    },
    async (request): Promise<SaveSettingsResponse> => {
      const url = normalizeJellyfinUrl(request.body.jellyfinUrl, 'Die Server-Adresse');
      const apiKey = request.body.apiKey?.trim() || connection.settings?.apiKey;
      if (!apiKey) {
        throw new AppError('BAD_REQUEST', 'Bitte gib einen API-Schlüssel ein.');
      }

      // Only settings that actually reach Jellyfin are saved.
      const candidate = { url, apiKey };
      const server = await fetchServerStatus(connection.createClient(candidate));
      try {
        await connection.save(candidate);
      } catch (error) {
        request.log.error(error);
        throw new AppError(
          'INTERNAL_ERROR',
          'Die Verbindung funktioniert, konnte aber nicht gespeichert werden. Ist das Datenverzeichnis (DATA_DIR) beschreibbar?',
        );
      }
      request.log.info(`Jellyfin-Verbindung geändert: ${url}`);

      return { settings: toConnectionSettings(connection), server };
    },
  );
}

function toConnectionSettings(connection: JellyfinConnection): ConnectionSettings {
  const { settings, source } = connection;
  const key = settings?.apiKey ?? '';
  return {
    jellyfinUrl: settings?.url ?? null,
    apiKeyConfigured: key.length > 0,
    // Short keys would be revealed completely, so only hint at long ones.
    apiKeyHint: key.length >= 16 ? key.slice(-KEY_HINT_LENGTH) : null,
    source,
  };
}
