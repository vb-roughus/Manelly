import { describe, expect, it } from 'vitest';
import type { LibraryScanStatus } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import type { JellyfinConnection } from '../src/connection.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import type { JfTaskInfo } from '../src/jellyfin/types.js';
import { createLibraryScanner } from '../src/media/scan.js';

const TASK_ID = '7738148ffcd07979c7ceb148e06b3aed';
const EARLIER = { StartTimeUtc: '2026-10-27T02:00:00Z', EndTimeUtc: '2026-10-27T02:04:10Z', Status: 'Completed', ErrorMessage: null };

/** Jellyfin with its scheduled tasks; the test moves the library scan along. */
function fakeJellyfin() {
  const jf = {
    task: { Id: TASK_ID, Key: 'RefreshLibrary', Name: 'Medienbibliothek scannen', State: 'Idle', CurrentProgressPercentage: null, LastExecutionResult: EARLIER } as JfTaskInfo,
    hasTask: true,
    calls: [] as string[],
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method !== 'GET') jf.calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/ScheduledTasks') {
      return Response.json([{ Id: 'other', Key: 'CleanTranscodeFolder', State: 'Idle' }, ...(jf.hasTask ? [jf.task] : [])]);
    }
    if (url.pathname === `/ScheduledTasks/${TASK_ID}`) return Response.json(jf.task);
    if (url.pathname === `/ScheduledTasks/Running/${TASK_ID}`) {
      if (method === 'DELETE') jf.task = { ...jf.task, State: 'Cancelling' };
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/Library/VirtualFolders') {
      return Response.json([
        { Name: 'Filme', ItemId: 'a', CollectionType: 'movies', Locations: ['D:\\Filme', '\\\\nas\\Filme'] },
        { Name: 'Gemischt', ItemId: 'b' },
      ]);
    }
    return new Response(null, { status: 404 });
  };
  return { jf, fetch };
}

function setup(options: { startTimeoutMs?: number } = {}) {
  const { jf, fetch } = fakeJellyfin();
  const connection = { client: createJellyfinClient({ url: 'http://jellyfin.test', apiKey: 'key' }, { fetch }) } as JellyfinConnection;
  const store = { refreshes: 0, refresh: () => void store.refreshes++ };
  const scanner = createLibraryScanner(connection, store, { pollMs: 5, ...options });
  return { jf, connection, store, scanner };
}

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
}

describe('library scan', () => {
  it('reports the last scan and the libraries', async () => {
    const { scanner } = setup();
    expect(await scanner.status()).toEqual<LibraryScanStatus>({
      state: 'idle',
      progress: null,
      lastRun: { startedAt: EARLIER.StartTimeUtc, endedAt: EARLIER.EndTimeUtc, result: 'completed', error: null },
      libraries: [
        { name: 'Filme', type: 'movies', locations: ['D:\\Filme', '\\\\nas\\Filme'] },
        { name: 'Gemischt', type: null, locations: [] },
      ],
    });
  });

  it('starts the scan, follows it and reads the media again once it ended', async () => {
    const { jf, store, scanner } = setup();
    // Jellyfin has not reported the task yet: it counts as running from the start.
    expect(await scanner.start()).toMatchObject({ state: 'running', progress: null });
    expect(jf.calls).toEqual([`POST /ScheduledTasks/Running/${TASK_ID}`]);

    jf.task = { ...jf.task, State: 'Running', CurrentProgressPercentage: 42.5 };
    expect(await scanner.status()).toMatchObject({ state: 'running', progress: 42.5 });
    // Asked again while it runs: nothing new is started.
    await scanner.start();
    expect(jf.calls).toHaveLength(1);
    expect(store.refreshes).toBe(0);

    jf.task = { ...jf.task, State: 'Idle', CurrentProgressPercentage: null, LastExecutionResult: { ...EARLIER, EndTimeUtc: '2026-10-27T18:03:00Z', Status: 'Failed', ErrorMessage: 'Zugriff verweigert' } };
    await until(() => store.refreshes === 1);
    expect((await scanner.status()).lastRun).toMatchObject({ endedAt: '2026-10-27T18:03:00Z', result: 'failed', error: 'Zugriff verweigert' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.refreshes).toBe(1);
    scanner.stop();
  });

  it('also reads the media again after a scan started in Jellyfin', async () => {
    const { jf, store, scanner } = setup();
    jf.task = { ...jf.task, State: 'Running', CurrentProgressPercentage: 10 };
    expect((await scanner.status()).state).toBe('running');
    jf.task = { ...jf.task, State: 'Idle', LastExecutionResult: { ...EARLIER, EndTimeUtc: '2026-10-27T18:10:00Z' } };
    await until(() => store.refreshes === 1);
    expect(jf.calls).toEqual([]);
    scanner.stop();
  });

  it('notices a scan over before it was ever seen running', async () => {
    const { jf, store, scanner } = setup();
    await scanner.start();
    jf.task = { ...jf.task, LastExecutionResult: { ...EARLIER, EndTimeUtc: '2026-10-27T18:00:01Z' } };
    await until(() => store.refreshes === 1);
    scanner.stop();
  });

  it('stops waiting for a scan Jellyfin never starts', async () => {
    const { store, scanner } = setup({ startTimeoutMs: 20 });
    await scanner.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await scanner.status()).state).toBe('idle');
    expect(store.refreshes).toBe(0);
    scanner.stop();
  });

  it('cancels a running scan', async () => {
    const { jf, store, scanner } = setup();
    jf.task = { ...jf.task, State: 'Running', CurrentProgressPercentage: 80 };
    expect((await scanner.cancel()).state).toBe('cancelling');
    expect(jf.calls).toEqual([`DELETE /ScheduledTasks/Running/${TASK_ID}`]);
    jf.task = { ...jf.task, State: 'Idle', LastExecutionResult: { ...EARLIER, EndTimeUtc: '2026-10-27T18:20:00Z', Status: 'Cancelled' } };
    await until(() => store.refreshes === 1);
    expect((await scanner.status()).lastRun?.result).toBe('cancelled');
    scanner.stop();
  });

  it('explains a Jellyfin without the scan task', async () => {
    const { jf, scanner } = setup();
    jf.hasTask = false;
    await expect(scanner.start()).rejects.toThrow('Jellyfin hat keine Aufgabe «Medienbibliothek scannen».');
    expect(jf.calls).toEqual([]);
  });

  it('is reachable under /api/media/scan', async () => {
    const { jf, fetch } = fakeJellyfin();
    const connection = await createConnection({
      store: { load: async () => null, save: async () => {} },
      envSettings: { url: 'http://jellyfin.test', apiKey: 'key' },
      createClient: (settings) => createJellyfinClient(settings, { fetch }),
    });
    const app = await buildApp({ config: { staticDir: null }, connection });
    expect((await app.inject('/api/media/scan')).json<LibraryScanStatus>().state).toBe('idle');
    expect((await app.inject({ method: 'POST', url: '/api/media/scan' })).json<LibraryScanStatus>().state).toBe('running');
    jf.task = { ...jf.task, State: 'Running' };
    expect((await app.inject({ method: 'DELETE', url: '/api/media/scan' })).json<LibraryScanStatus>().state).toBe('cancelling');
    expect(jf.calls).toEqual([`POST /ScheduledTasks/Running/${TASK_ID}`, `DELETE /ScheduledTasks/Running/${TASK_ID}`]);
    await app.close();
  });
});
