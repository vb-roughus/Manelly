import { describe, expect, it } from 'vitest';
import type { AgentOverview, ConversionJob, ConversionOptions, ConversionRequest } from '@manelly/shared';
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

function fakeWorld(options: { videoRangeType?: string; dvProfile?: number } = {}) {
  const sent: { jobs: ConversionRequest[]; mediaUpdates: unknown[] } = { jobs: [], mediaUpdates: [] };
  const jobs: ConversionJob[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.host === 'agent.test:8790') {
      if (new Headers(init?.headers).get('authorization') !== `Bearer ${AGENT_TOKEN}`) return Response.json({ error: { message: 'nope' } }, { status: 401 });
      if (url.pathname === '/api/status') {
        return Response.json({ version: '0.1.0', hostname: 'jellyfin-pc', platform: 'win32', tools: {}, roots: [], ready: true });
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
  return { fetch, sent, jobs };
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
});
