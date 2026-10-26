import type { FastifyInstance } from 'fastify';
import type {
  AgentOverview,
  AgentSettingsView,
  ConversionJob,
  ConversionOptions,
  SaveAgentSettingsRequest,
  StartConversionRequest,
} from '@manelly/shared';
import type { AgentConnection } from '../agent/connection.js';
import { normalizeAgentUrl } from '../agent/connection.js';
import { conversionOptions, createConversionWatcher, requireAgent, startConversion } from '../agent/conversions.js';
import type { JellyfinConnection } from '../connection.js';
import { AppError, requireClient } from '../errors.js';
import type { MediaIndexStore } from '../media/store.js';

export async function agentRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection; agent: AgentConnection; store: MediaIndexStore }) {
  const { connection, agent, store } = opts;
  const watcher = createConversionWatcher({ agent, jellyfin: () => connection.client, store, log: (message) => app.log.warn(message) });
  app.addHook('onClose', async () => watcher.stop());

  async function overview(refresh = false): Promise<AgentOverview> {
    if (!agent.client) return { configured: false, status: null, error: null };
    try {
      return { configured: true, status: await agent.client.status(refresh), error: null };
    } catch (error) {
      return { configured: true, status: null, error: (error as Error).message };
    }
  }

  // ?refresh=1 (settings page) looks for newly installed tools; the regular polling does not.
  app.get<{ Querystring: { refresh?: string } }>('/', async (request) => overview(request.query.refresh === '1'));

  app.get('/settings', async (): Promise<AgentSettingsView> => ({ url: agent.settings?.url ?? null, hasToken: Boolean(agent.settings?.token) }));

  app.put<{ Body: SaveAgentSettingsRequest }>(
    '/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['url'],
          properties: { url: { type: 'string', minLength: 1, maxLength: 2048 }, token: { type: 'string', maxLength: 256 } },
        },
      },
    },
    async (request): Promise<AgentOverview> => {
      const url = normalizeAgentUrl(request.body.url);
      const token = request.body.token?.trim() || agent.settings?.token;
      if (!token) throw new AppError('BAD_REQUEST', 'Bitte gib den Agent-Schlüssel ein – der Agent zeigt ihn beim Start an.');
      // Only settings that actually reach the agent are saved.
      await agent.createClient({ url, token }).status(true);
      await agent.save({ url, token });
      request.log.info(`Agent eingerichtet: ${url}`);
      return overview();
    },
  );

  app.get('/jobs', async (): Promise<ConversionJob[]> => {
    const jobs = await requireAgent(agent).listJobs();
    await watcher.observe(jobs);
    return jobs;
  });

  app.post<{ Body: StartConversionRequest }>(
    '/jobs',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId', 'output'],
          properties: {
            itemId: { type: 'string', minLength: 1, maxLength: 64 },
            mediaSourceId: { type: 'string', maxLength: 64 },
            output: {
              type: 'object',
              additionalProperties: false,
              required: ['mode'],
              properties: {
                mode: { type: 'string', enum: ['alongside', 'replace', 'folder'] },
                directory: { type: 'string', maxLength: 1024 },
                subfolder: { type: 'string', maxLength: 255 },
                fileName: { type: 'string', maxLength: 255 },
              },
            },
          },
        },
      },
    },
    async (request, reply): Promise<ConversionJob> => {
      const job = await startConversion(requireClient(connection.client), requireAgent(agent), request.body);
      watcher.track(job);
      request.log.info(`Umwandlung gestartet: ${job.source} → ${job.output}`);
      reply.status(201);
      return job;
    },
  );

  app.post<{ Params: { id: string } }>('/jobs/:id/cancel', async (request): Promise<ConversionJob> => requireAgent(agent).cancelJob(request.params.id));

  app.delete<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    await requireAgent(agent).removeJob(request.params.id);
    return reply.status(204).send();
  });

  app.get<{ Querystring: { itemId: string; mediaSourceId?: string } }>(
    '/conversions/options',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['itemId'],
          properties: { itemId: { type: 'string', minLength: 1, maxLength: 64 }, mediaSourceId: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request): Promise<ConversionOptions> =>
      conversionOptions(requireClient(connection.client), requireAgent(agent), request.query.itemId, request.query.mediaSourceId),
  );
}
