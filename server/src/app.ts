import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import { createAgentConnection, type AgentConnection } from './agent/connection.js';
import type { AppConfig } from './config.js';
import type { JellyfinConnection } from './connection.js';
import { errorBody, handleError } from './errors.js';
import { createMediaIndexStore, type MediaIndexStore } from './media/store.js';
import { agentRoutes } from './routes/agent.js';
import { apiRoutes } from './routes/api.js';
import { collectionsRoutes } from './routes/collections.js';
import { imageRoutes } from './routes/images.js';
import { mediaRoutes } from './routes/media.js';
import { serverRoutes } from './routes/server.js';
import { settingsRoutes } from './routes/settings.js';
import { createTranscodeLogReader } from './transcodeLog.js';

export interface AppOptions {
  config: Pick<AppConfig, 'staticDir'>;
  connection: JellyfinConnection;
  /** Defaults to an index of the connection's libraries, built on first use. */
  mediaStore?: MediaIndexStore;
  /** The agent on the Jellyfin server; defaults to none configured. */
  agent?: AgentConnection;
  logger?: FastifyServerOptions['logger'];
}

const noAgentStore = { load: async () => null, save: async () => {} };

export async function buildApp({ config, connection, mediaStore, agent, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    // The dashboard polls every few seconds; logging each request would drown everything else.
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.setErrorHandler(handleError);

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
  });

  const logs = createTranscodeLogReader();
  await app.register(apiRoutes, { prefix: '/api', connection, logs });
  await app.register(settingsRoutes, { prefix: '/api/settings', connection });
  await app.register(imageRoutes, { prefix: '/api/images', connection });
  const store = mediaStore ?? createMediaIndexStore(connection, { log: app.log });
  await app.register(mediaRoutes, { prefix: '/api/media', connection, store });
  await app.register(collectionsRoutes, { prefix: '/api/collections', connection, store });
  const agentConnection = agent ?? (await createAgentConnection({ store: noAgentStore }));
  await app.register(agentRoutes, { prefix: '/api/agent', connection, store, agent: agentConnection });
  await app.register(serverRoutes, { prefix: '/api/server', connection, agent: agentConnection, logs });

  if (config.staticDir) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      setHeaders: (reply, filePath) => {
        // Vite fingerprints everything in assets/, index.html must always be revalidated.
        const cacheControl = /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache';
        reply.header('cache-control', cacheControl);
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (!isApi && config.staticDir && request.method === 'GET') {
      // Client-side routes (e.g. /media) are rendered by the single-page app.
      return reply.sendFile('index.html');
    }
    return reply.status(404).send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} existiert nicht.`));
  });

  return app;
}
