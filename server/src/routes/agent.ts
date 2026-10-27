import type { FastifyInstance } from 'fastify';
import type {
  AgentNetworkList,
  AgentNetworkStatus,
  AgentOverview,
  AgentResourceStatus,
  AgentScheduleStatus,
  AgentSettingsView,
  AgentStatus,
  ConversionJob,
  ConversionOptions,
  ConversionSchedule,
  HistoryResponse,
  HistorySettings,
  JDownloaderAction,
  JDownloaderSettings,
  JDownloaderStatus,
  SaveAgentSettingsRequest,
  StartConversionRequest,
} from '@manelly/shared';
import type { AgentClient } from '../agent/client.js';
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

  // What the agent last got from this Manelly: agent, Jellyfin address and key.
  let handedOver: string | null = null;

  /**
   * Gives the agent Manelly's Jellyfin connection, so it sees streams (for the schedule) and
   * reports new files itself. Only when something changed or the agent lost it.
   */
  async function handOverJellyfin(client: AgentClient, status?: AgentStatus): Promise<void> {
    const jellyfin = connection.settings;
    // Agents before 0.2.0 have no use for it.
    if (!jellyfin || (status && !status.schedule)) return;
    const url = jellyfin.url.replace(/\/+$/, '');
    const key = `${client.url}\n${url}\n${jellyfin.apiKey}`;
    if (key === handedOver && (!status || status.schedule?.jellyfinUrl === url)) return;
    try {
      await client.setJellyfin({ url, apiKey: jellyfin.apiKey });
      handedOver = key;
    } catch (error) {
      app.log.warn(`Jellyfin-Verbindung nicht an den Agent übergeben: ${(error as Error).message}`);
    }
  }

  async function overview(refresh = false): Promise<AgentOverview> {
    if (!agent.client) return { configured: false, status: null, error: null };
    try {
      const status = await agent.client.status(refresh);
      await handOverJellyfin(agent.client, status);
      return { configured: true, status, error: null };
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
            scheduled: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply): Promise<ConversionJob> => {
      const client = requireAgent(agent);
      await handOverJellyfin(client);
      const job = await startConversion(requireClient(connection.client), client, request.body);
      watcher.track(job);
      request.log.info(`Umwandlung gestartet: ${job.source} → ${job.output}`);
      reply.status(201);
      return job;
    },
  );

  app.post<{ Params: { id: string } }>('/jobs/:id/cancel', async (request): Promise<ConversionJob> => requireAgent(agent).cancelJob(request.params.id));

  app.post<{ Params: { id: string } }>('/jobs/:id/start', async (request): Promise<ConversionJob> => {
    const job = await requireAgent(agent).startJob(request.params.id);
    request.log.info(`Umwandlung ohne Zeitplan gestartet: ${job.source}`);
    return job;
  });

  app.get('/network/interfaces', async (): Promise<AgentNetworkList> => requireAgent(agent).networkInterfaces());

  app.put<{ Body: { interfaces: string[] } }>(
    '/network/interfaces',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['interfaces'],
          properties: { interfaces: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 256 } } },
        },
      },
    },
    async (request): Promise<AgentNetworkList> => {
      const list = await requireAgent(agent).setNetworkInterfaces(request.body.interfaces);
      const names = list.interfaces.filter((nic) => list.selected.includes(nic.id)).map((nic) => nic.name);
      request.log.info(`Überwachte Netzwerkschnittstellen: ${names.join(', ') || 'keine'}`);
      return list;
    },
  );

  app.get('/network', async (): Promise<AgentNetworkStatus> => requireAgent(agent).network());

  app.get('/resources', async (): Promise<AgentResourceStatus> => requireAgent(agent).resources());

  app.get('/jdownloader', async (): Promise<JDownloaderStatus> => requireAgent(agent).jdownloader());

  app.put<{ Body: JDownloaderSettings }>(
    '/jdownloader/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'url', 'throttle'],
          properties: {
            enabled: { type: 'boolean' },
            url: { type: 'string', minLength: 1, maxLength: 256 },
            throttle: {
              type: 'object',
              additionalProperties: false,
              required: ['mode', 'limitKBps'],
              properties: { mode: { type: 'string', enum: ['off', 'limit', 'pause'] }, limitKBps: { type: 'integer', minimum: 1, maximum: 10_000_000 } },
            },
          },
        },
      },
    },
    async (request): Promise<JDownloaderStatus> => {
      const client = requireAgent(agent);
      // The throttle needs Jellyfin to see whether anybody streams.
      if (request.body.throttle.mode !== 'off') await handOverJellyfin(client);
      return client.setJDownloaderSettings(request.body);
    },
  );

  app.post<{ Body: { action: JDownloaderAction } }>(
    '/jdownloader/control',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: { action: { type: 'string', enum: ['start', 'stop', 'pause', 'resume'] } },
        },
      },
    },
    async (request): Promise<JDownloaderStatus> => {
      const status = await requireAgent(agent).controlJDownloader(request.body.action);
      request.log.info(`JDownloader: ${request.body.action}`);
      return status;
    },
  );

  app.put<{ Body: { enabled: boolean; kbps: number } }>(
    '/jdownloader/limit',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'kbps'],
          properties: { enabled: { type: 'boolean' }, kbps: { type: 'integer', minimum: 1, maximum: 10_000_000 } },
        },
      },
    },
    async (request): Promise<JDownloaderStatus> => requireAgent(agent).setJDownloaderLimit(request.body.enabled, request.body.kbps),
  );

  app.get<{ Querystring: { from: number; to: number } }>(
    '/history',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['from', 'to'],
          properties: { from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 } },
        },
      },
    },
    async (request): Promise<HistoryResponse> => requireAgent(agent).history(request.query.from, request.query.to),
  );

  app.put<{ Body: HistorySettings }>(
    '/history/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'retentionDays'],
          properties: { enabled: { type: 'boolean' }, retentionDays: { type: 'integer', minimum: 1, maximum: 3650 } },
        },
      },
    },
    async (request): Promise<HistorySettings> => {
      const client = requireAgent(agent);
      // The recording asks Jellyfin who streams what.
      if (request.body.enabled) await handOverJellyfin(client);
      return client.setHistorySettings(request.body);
    },
  );

  app.delete('/history', async (_request, reply) => {
    await requireAgent(agent).clearHistory();
    return reply.status(204).send();
  });

  const time = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' };
  app.put<{ Body: ConversionSchedule }>(
    '/schedule',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['window', 'idleOnly'],
          properties: {
            window: {
              type: ['object', 'null'],
              additionalProperties: false,
              required: ['start', 'end'],
              properties: { start: time, end: time },
            },
            idleOnly: { type: 'boolean' },
          },
        },
      },
    },
    async (request): Promise<AgentScheduleStatus> => {
      const client = requireAgent(agent);
      // The agent needs Jellyfin to see whether anybody streams.
      if (request.body.idleOnly) await handOverJellyfin(client);
      const schedule = await client.setSchedule(request.body);
      request.log.info(`Zeitplan der Umwandlungen gespeichert: ${request.body.window ? `${request.body.window.start}–${request.body.window.end}` : 'jederzeit'}${request.body.idleOnly ? ', nur ohne Stream' : ''}`);
      return schedule;
    },
  );

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
