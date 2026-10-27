import { describe, expect, it } from 'vitest';
import type { AgentJellyfinAccess, AgentNetworkList, AgentNetworkStatus, AgentOverview, AgentResourceStatus, JDownloaderStatus, AgentScheduleStatus, HistoryResponse, HistorySettings, ConversionJob, ConversionOptions, ConversionRequest, ConversionSchedule } from '@manelly/shared';
import { createAgentClient, type AgentSettings } from '../src/agent/client.js';
import { createAgentConnection, normalizeAgentUrl } from '../src/agent/connection.js';
import { buildApp } from '../src/app.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';

const SOURCE = 'D:\\Filme\\Pitch Black (2000)\\Pitch Black (2000).mkv';
const AGENT_TOKEN = 'agent-token-0123456789';

const movie = (videoRangeType: string, DvProfile?: number) => ({
  Id: 'movie',
  Name: 'Pitch Black',
  ProductionYear: 2000,
  RunTimeTicks: 6_713_000 * 10_000,
  MediaSources: [
    {
      Id: 'ms1',
      Path: SOURCE,
      Size: 50_000_000_000,
      MediaStreams: [{ Type: 'Video', Codec: 'hevc', VideoRangeType: videoRangeType, DvProfile, RealFrameRate: 23.976 }],
    },
  ],
});

function fakeWorld(options: { videoRangeType?: string; dvProfile?: number; agentVersion?: string } = {}) {
  const sent: {
    jobs: ConversionRequest[];
    mediaUpdates: unknown[];
    jellyfin: AgentJellyfinAccess[];
    schedules: ConversionSchedule[];
    started: string[];
    jdownloader: Array<{ method: string; path: string; body: unknown }>;
    history: Array<{ method: string; path: string; body: unknown }>;
    shutdowns: number;
  } = {
    shutdowns: 0,
    jdownloader: [],
    history: [],
    jobs: [],
    mediaUpdates: [],
    jellyfin: [],
    schedules: [],
    started: [],
  };
  const jobs: ConversionJob[] = [];
  // Agents from 0.2.0 on report their schedule and what Jellyfin they know.
  const agent = { schedule: { window: null, idleOnly: false, jellyfinUrl: null, gate: null, timeZone: 'Europe/Zurich' } as AgentScheduleStatus, network: [] as string[] };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.host === 'agent.test:8790') {
      if (new Headers(init?.headers).get('authorization') !== `Bearer ${AGENT_TOKEN}`) return Response.json({ error: { message: 'nope' } }, { status: 401 });
      if (url.pathname === '/api/status') {
        const version = options.agentVersion ?? '0.2.0';
        return Response.json({
          version,
          hostname: 'jellyfin-pc',
          platform: 'win32',
          tools: {},
          roots: [],
          ready: true,
          ...(version === '0.1.0' ? {} : { schedule: agent.schedule }),
          // Agents from 0.7.0 on tell their process and can end themselves.
          ...(Number(version.split('.')[1]) >= 7 ? { process: { pid: 4711, startedAt: '2026-10-27T02:00:00.000Z', node: 'v22.12.0', execPath: 'node.exe', autostart: true, port: 8790 } } : {}),
        });
      }
      if (url.pathname === '/api/jellyfin' && init?.method === 'PUT') {
        sent.jellyfin.push(body);
        agent.schedule.jellyfinUrl = body.url;
        return new Response(null, { status: 204 });
      }
      if (url.pathname === '/api/schedule' && init?.method === 'PUT') {
        sent.schedules.push(body);
        Object.assign(agent.schedule, body);
        return Response.json(agent.schedule);
      }
      if (url.pathname === '/api/network/interfaces') {
        if (init?.method === 'PUT') agent.network = body.interfaces;
        return Response.json({ interfaces: [{ id: '{A1}', name: 'Ethernet', description: 'Intel I219-V', type: 'Ethernet', up: true, speedBps: 1e9, addresses: [] }], selected: agent.network });
      }
      if (url.pathname.startsWith('/api/jdownloader/linkgrabber')) {
        sent.jdownloader.push({ method: init?.method ?? 'GET', path: url.pathname, body });
        return Response.json({ collecting: false, packages: [] });
      }
      if (url.pathname.startsWith('/api/jdownloader')) {
        sent.jdownloader.push({ method: init?.method ?? 'GET', path: url.pathname, body });
        return Response.json({ settings: body ?? { enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'off', limitKBps: 1024 } }, reachable: true, error: null, state: 'RUNNING', speedBps: 0, limit: null, packages: [], throttling: { active: false, reason: null } });
      }
      if (url.pathname === '/api/shutdown' && init?.method === 'POST') {
        sent.shutdowns++;
        return Response.json({ stopping: true }, { status: 202 });
      }
      if (url.pathname.startsWith('/api/history')) {
        sent.history.push({ method: init?.method ?? 'GET', path: `${url.pathname}${url.search}`, body });
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        if (init?.method === 'PUT') return Response.json(body);
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        return Response.json({ settings: { enabled: true, retentionDays: 30 }, from, to, step: 15_000, points: [], streams: [], interfaces: [], oldest: null, bytes: 0, error: null });
      }
      if (url.pathname === '/api/resources') {
        return Response.json({ cpu: { total: 60, jellyfin: 40, conversion: 0, model: 'Intel', cores: 6 }, gpus: [], gpuNote: null, processes: [], history: [], intervalMs: 3000, error: null });
      }
      if (url.pathname === '/api/network') {
        return Response.json({ interfaces: agent.network.map((id: string) => ({ id, name: 'Ethernet', description: null, up: true, speedBps: 1e9, rxBps: 1e6, txBps: 4e7, history: [] })), intervalMs: 2000, error: null });
      }
      const start = url.pathname.match(/^\/api\/jobs\/(\w+)\/start$/);
      if (start && init?.method === 'POST') {
        sent.started.push(start[1]!);
        return Response.json({ ...jobs.find((job) => job.id === start[1]), scheduled: false });
      }
      if (url.pathname === '/api/check') {
        return Response.json({ sourceBytes: 40_000_000_000, directories: body.directories.map((path: string) => ({ path, freeBytes: 500_000_000_000 })) });
      }
      if (url.pathname === '/api/jobs' && init?.method === 'POST') {
        sent.jobs.push(body);
        const job = { id: `job${jobs.length + 1}`, title: body.title, source: body.source, mode: body.output.mode, output: 'D:\\Filme\\Pitch Black (2000)\\Pitch Black (2000) - DV P8.mkv', backup: null, state: 'queued' } as ConversionJob;
        jobs.push(job);
        return Response.json(job, { status: 201 });
      }
      if (url.pathname === '/api/jobs') return Response.json(jobs);
      return new Response(null, { status: 404 });
    }
    if (url.pathname === '/Items') return Response.json({ Items: url.searchParams.get('ids') === 'movie' ? [movie(options.videoRangeType ?? 'DOVIWithEL', options.dvProfile ?? 7)] : [] });
    if (url.pathname === '/Library/VirtualFolders') {
      return Response.json([
        { Name: 'Filme', ItemId: 'f1', CollectionType: 'movies', Locations: ['D:\\Filme'] },
        { Name: 'UHD', ItemId: 'f2', CollectionType: 'movies', Locations: ['E:\\UHD'] },
        { Name: 'Musik', ItemId: 'f3', CollectionType: 'music', Locations: ['D:\\Musik'] },
      ]);
    }
    if (url.pathname === '/Library/Media/Updated') {
      sent.mediaUpdates.push(body);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };
  return { fetch, sent, jobs, agent };
}

async function setup(world = fakeWorld(), saved: AgentSettings | null = { url: 'http://agent.test:8790', token: AGENT_TOKEN }) {
  const connection = await createConnection({
    store: { load: async () => ({ url: 'http://jellyfin.test', apiKey: 'key' }), save: async () => {} },
    envSettings: null,
    createClient: (settings) => createJellyfinClient(settings, { fetch: world.fetch }),
  });
  let stored = saved;
  const agent = await createAgentConnection({
    store: { load: async () => stored, save: async (next) => void (stored = next) },
    createClient: (settings) => createAgentClient(settings, { fetch: world.fetch }),
  });
  const app = await buildApp({ config: { staticDir: null }, connection, agent });
  return { app, world, saved: () => stored };
}

describe('agent connection', () => {
  it('reports that no agent is set up yet', async () => {
    const { app } = await setup(fakeWorld(), null);
    expect((await app.inject('/api/agent')).json<AgentOverview>()).toEqual({ configured: false, status: null, error: null });
    expect((await app.inject('/api/agent/jobs')).statusCode).toBe(400);
  });

  it('saves only settings that reach the agent', async () => {
    const { app, saved } = await setup(fakeWorld(), null);
    const wrong = await app.inject({ method: 'PUT', url: '/api/agent/settings', payload: { url: 'agent.test:8790', token: 'wrong' } });
    expect(wrong.statusCode).toBe(502);
    expect(saved()).toBeNull();

    const ok = await app.inject({ method: 'PUT', url: '/api/agent/settings', payload: { url: 'agent.test:8790/', token: AGENT_TOKEN } });
    expect(ok.json<AgentOverview>()).toMatchObject({ configured: true, status: { hostname: 'jellyfin-pc' } });
    expect(saved()).toEqual({ url: 'http://agent.test:8790', token: AGENT_TOKEN });
    expect((await app.inject('/api/agent/settings')).json()).toEqual({ url: 'http://agent.test:8790', hasToken: true });
    expect(normalizeAgentUrl('https://nas:8790/agent/')).toBe('https://nas:8790/agent');
  });

  it('offers the places to save the converted file, with Windows paths from Jellyfin', async () => {
    const { app } = await setup();
    const options = (await app.inject('/api/agent/conversions/options?itemId=movie')).json<ConversionOptions>();
    expect(options).toMatchObject({
      item: { id: 'movie', name: 'Pitch Black', year: 2000 },
      source: { mediaSourceId: 'ms1', path: SOURCE, bytes: 40_000_000_000, videoRangeType: 'DOVIWithEL', dvProfile: 7 },
      requiredBytes: 84_000_000_000,
      alongside: { directory: 'D:\\Filme\\Pitch Black (2000)', fileName: 'Pitch Black (2000) - DV P8.mkv', freeBytes: 500_000_000_000 },
      replace: { path: SOURCE, backup: 'D:\\Filme\\Pitch Black (2000)\\.manelly-backup\\Pitch Black (2000).mkv' },
      subfolder: 'Pitch Black (2000)',
    });
    // Only video libraries; music folders are no place for a movie.
    expect(options.folders.map((folder) => folder.path)).toEqual(['D:\\Filme', 'E:\\UHD']);
  });

  it('starts a conversion with the path from Jellyfin and only into library folders', async () => {
    const { app, world } = await setup();
    const outside = await app.inject({ method: 'POST', url: '/api/agent/jobs', payload: { itemId: 'movie', output: { mode: 'folder', directory: 'C:\\Windows' } } });
    expect(outside.statusCode).toBe(400);
    expect(world.sent.jobs).toHaveLength(0);

    const started = await app.inject({
      method: 'POST',
      url: '/api/agent/jobs',
      payload: { itemId: 'movie', output: { mode: 'folder', directory: 'e:\\uhd', subfolder: 'Pitch Black (2000)' } },
    });
    expect(started.statusCode).toBe(201);
    expect(world.sent.jobs[0]).toEqual({
      source: SOURCE,
      output: { mode: 'folder', directory: 'E:\\UHD', subfolder: 'Pitch Black (2000)' },
      title: 'Pitch Black (2000)',
      hints: { durationMs: 6_713_000, frameRate: 23.976 },
    });
  });

  it('refuses titles without Dolby Vision profile 7', async () => {
    const { app, world } = await setup(fakeWorld({ videoRangeType: 'DOVIWithHDR10', dvProfile: 8 }));
    const response = await app.inject({ method: 'POST', url: '/api/agent/jobs', payload: { itemId: 'movie', output: { mode: 'alongside' } } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('Profil 7');
    expect(world.sent.jobs).toHaveLength(0);
    const unknown = await app.inject({ method: 'POST', url: '/api/agent/jobs', payload: { itemId: 'other', output: { mode: 'alongside' } } });
    expect(unknown.statusCode).toBe(404);
  });

  it('tells Jellyfin about the new file once a conversion is done', async () => {
    const { app, world } = await setup();
    await app.inject({ method: 'POST', url: '/api/agent/jobs', payload: { itemId: 'movie', output: { mode: 'alongside' } } });
    await app.inject('/api/agent/jobs');
    expect(world.sent.mediaUpdates).toHaveLength(0);

    world.jobs[0]!.state = 'done';
    await app.inject('/api/agent/jobs');
    await app.inject('/api/agent/jobs');
    expect(world.sent.mediaUpdates).toEqual([{ Updates: [{ Path: 'D:\\Filme\\Pitch Black (2000)\\Pitch Black (2000) - DV P8.mkv', UpdateType: 'Created' }] }]);
    await app.close();
  });

  it('hands the Jellyfin connection to the agent once, and again when the agent lost it', async () => {
    const { app, world } = await setup();
    await app.inject('/api/agent');
    await app.inject('/api/agent');
    expect(world.sent.jellyfin).toEqual([{ url: 'http://jellyfin.test', apiKey: 'key' }]);
    // E.g. the agent's data folder was deleted.
    world.agent.schedule.jellyfinUrl = null;
    await app.inject('/api/agent');
    expect(world.sent.jellyfin).toHaveLength(2);

    const old = await setup(fakeWorld({ agentVersion: '0.1.0' }));
    expect((await old.app.inject('/api/agent')).json<AgentOverview>().status?.version).toBe('0.1.0');
    expect(old.world.sent.jellyfin).toEqual([]);
  });

  it('saves the schedule on the agent', async () => {
    const { app, world } = await setup();
    const invalid = await app.inject({ method: 'PUT', url: '/api/agent/schedule', payload: { window: { start: '1:00', end: '06:00' }, idleOnly: true } });
    expect(invalid.statusCode).toBe(400);
    const saved = await app.inject({ method: 'PUT', url: '/api/agent/schedule', payload: { window: { start: '01:00', end: '06:00' }, idleOnly: true } });
    expect(saved.json<AgentScheduleStatus>()).toMatchObject({ window: { start: '01:00', end: '06:00' }, idleOnly: true, jellyfinUrl: 'http://jellyfin.test' });
    expect(world.sent.schedules).toEqual([{ window: { start: '01:00', end: '06:00' }, idleOnly: true }]);
    expect(world.sent.jellyfin).toHaveLength(1);
  });

  it('queues scheduled conversions and starts them on request', async () => {
    const { app, world } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/agent/jobs', payload: { itemId: 'movie', output: { mode: 'alongside' }, scheduled: true } });
    expect(created.statusCode).toBe(201);
    expect(world.sent.jobs[0]).toMatchObject({ scheduled: true });
    const started = await app.inject({ method: 'POST', url: '/api/agent/jobs/job1/start' });
    expect(started.json<ConversionJob>()).toMatchObject({ id: 'job1', scheduled: false });
    expect(world.sent.started).toEqual(['job1']);
  });

  it('leaves telling Jellyfin to agents that did it themselves', async () => {
    const { app, world } = await setup();
    await app.inject({ method: 'POST', url: '/api/agent/jobs', payload: { itemId: 'movie', output: { mode: 'alongside' } } });
    Object.assign(world.jobs[0]!, { state: 'done', jellyfinNotified: true });
    await app.inject('/api/agent/jobs');
    expect(world.sent.mediaUpdates).toEqual([]);
    await app.close();
  });

  it('lets Manelly pick the network interfaces the agent measures', async () => {
    const { app, world } = await setup();
    expect((await app.inject('/api/agent/network/interfaces')).json<AgentNetworkList>().interfaces[0]?.name).toBe('Ethernet');
    const tooMany = await app.inject({ method: 'PUT', url: '/api/agent/network/interfaces', payload: { interfaces: Array.from({ length: 17 }, (_, i) => `{${i}}`) } });
    expect(tooMany.statusCode).toBe(400);
    const saved = await app.inject({ method: 'PUT', url: '/api/agent/network/interfaces', payload: { interfaces: ['{A1}'] } });
    expect(saved.json<AgentNetworkList>().selected).toEqual(['{A1}']);
    expect(world.agent.network).toEqual(['{A1}']);
    expect((await app.inject('/api/agent/network')).json<AgentNetworkStatus>().interfaces[0]).toMatchObject({ id: '{A1}', txBps: 4e7 });
  });

  it('passes on CPU and GPU of the Jellyfin server', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/agent/resources')).json<AgentResourceStatus>().cpu).toMatchObject({ total: 60, jellyfin: 40 });
    const none = await setup(fakeWorld(), null);
    expect((await none.app.inject('/api/agent/resources')).statusCode).toBe(400);
  });

  it('passes JDownloader settings and commands to the agent, and hands over Jellyfin for the throttle', async () => {
    const { app, world } = await setup();
    const invalid = await app.inject({ method: 'PUT', url: '/api/agent/jdownloader/settings', payload: { enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'fast', limitKBps: 1 } } });
    expect(invalid.statusCode).toBe(400);
    const settings = { enabled: true, url: 'http://127.0.0.1:3128', throttle: { mode: 'limit', limitKBps: 2048 } };
    expect((await app.inject({ method: 'PUT', url: '/api/agent/jdownloader/settings', payload: settings })).statusCode).toBe(200);
    expect(world.sent.jellyfin).toHaveLength(1);
    await app.inject({ method: 'POST', url: '/api/agent/jdownloader/control', payload: { action: 'pause' } });
    await app.inject({ method: 'PUT', url: '/api/agent/jdownloader/limit', payload: { enabled: true, kbps: 512 } });
    expect((await app.inject({ method: 'POST', url: '/api/agent/jdownloader/control', payload: { action: 'explode' } })).statusCode).toBe(400);
    expect(world.sent.jdownloader).toEqual([
      { method: 'PUT', path: '/api/jdownloader/settings', body: settings },
      { method: 'POST', path: '/api/jdownloader/control', body: { action: 'pause' } },
      { method: 'PUT', path: '/api/jdownloader/limit', body: { enabled: true, kbps: 512 } },
    ]);
    expect((await app.inject('/api/agent/jdownloader')).json<JDownloaderStatus>().state).toBe('RUNNING');
  });

  it('passes the link grabber and moves from it to the agent', async () => {
    const { app, world } = await setup();
    expect((await app.inject('/api/agent/jdownloader/linkgrabber')).json()).toEqual({ collecting: false, packages: [] });
    expect((await app.inject({ method: 'POST', url: '/api/agent/jdownloader/linkgrabber/move', payload: { packageIds: ['x'], linkIds: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/agent/jdownloader/linkgrabber/move', payload: { packageIds: [11] } })).statusCode).toBe(400);
    const moved = await app.inject({ method: 'POST', url: '/api/agent/jdownloader/linkgrabber/move', payload: { packageIds: [11, 12], linkIds: [101] } });
    expect(moved.statusCode).toBe(200);
    expect(world.sent.jdownloader).toEqual([
      { method: 'GET', path: '/api/jdownloader/linkgrabber', body: undefined },
      { method: 'POST', path: '/api/jdownloader/linkgrabber/move', body: { packageIds: [11, 12], linkIds: [101] } },
    ]);
  });

  it('ends the agent on request, but not an agent too old to end itself', async () => {
    const old = await setup(fakeWorld({ agentVersion: '0.6.0' }));
    const refused = await old.app.inject({ method: 'POST', url: '/api/agent/shutdown' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe('Der Agent auf jellyfin-pc ist zu alt, um sich selbst zu beenden (Version 0.6.0).');
    expect(old.world.sent.shutdowns).toBe(0);

    const { app, world } = await setup(fakeWorld({ agentVersion: '0.7.0' }));
    expect((await app.inject({ method: 'POST', url: '/api/agent/shutdown' })).statusCode).toBe(204);
    expect(world.sent.shutdowns).toBe(1);
  });

  it('passes the recording settings and queries to the agent, and hands over Jellyfin to record streams', async () => {
    const { app, world } = await setup();
    expect((await app.inject({ method: 'PUT', url: '/api/agent/history/settings', payload: { enabled: true, retentionDays: 0 } })).statusCode).toBe(400);
    expect((await app.inject('/api/agent/history?from=abc&to=5')).statusCode).toBe(400);

    const saved = await app.inject({ method: 'PUT', url: '/api/agent/history/settings', payload: { enabled: true, retentionDays: 30 } });
    expect(saved.json<HistorySettings>()).toEqual({ enabled: true, retentionDays: 30 });
    expect(world.sent.jellyfin).toHaveLength(1);
    expect((await app.inject('/api/agent/history?from=1000&to=61000')).json<HistoryResponse>()).toMatchObject({ from: 1000, to: 61000, step: 15_000 });
    expect((await app.inject({ method: 'DELETE', url: '/api/agent/history' })).statusCode).toBe(204);
    expect(world.sent.history).toEqual([
      { method: 'PUT', path: '/api/history/settings', body: { enabled: true, retentionDays: 30 } },
      { method: 'GET', path: '/api/history?from=1000&to=61000', body: undefined },
      { method: 'DELETE', path: '/api/history', body: undefined },
    ]);
  });
});
