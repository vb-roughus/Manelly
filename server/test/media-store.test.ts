import { describe, expect, it } from 'vitest';
import type { JellyfinConfig } from '../src/config.js';
import { createConnection } from '../src/connection.js';
import type { JellyfinClient } from '../src/jellyfin/client.js';
import type { MediaIndex } from '../src/media/indexer.js';
import { createMediaIndexStore } from '../src/media/store.js';

const emptyIndex = (label: string): MediaIndex => ({
  builtAt: 0,
  items: [],
  byId: new Map(),
  facets: {
    genres: [{ value: label, count: 1 }],
    officialRatings: [],
    years: { min: null, max: null },
    audioLanguages: [],
    audioFormats: [],
    resolutions: [],
    dynamicRanges: [],
    videoCodecs: [],
    libraries: [],
  },
  counts: { movies: 0, series: 0, episodes: 0 },
});

/** A build function whose runs are resolved or rejected by the test. */
function controlledBuild() {
  const runs: Array<{ client: JellyfinClient; resolve: (index: MediaIndex) => void; reject: (error: Error) => void }> = [];
  const build = (client: JellyfinClient) =>
    new Promise<MediaIndex>((resolve, reject) => {
      runs.push({ client, resolve, reject });
    });
  return { runs, build };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup() {
  let clock = 1_000_000;
  const connection = await createConnection({
    store: { load: async () => ({ url: 'http://one.test', apiKey: 'key' }), save: async () => {} },
    envSettings: null,
    createClient: (settings: JellyfinConfig) => ({ baseUrl: settings.url }) as JellyfinClient,
  });
  const { runs, build } = controlledBuild();
  const store = createMediaIndexStore(connection, { build, now: () => clock, maxAgeMs: 1000, retryAfterMs: 500 });
  return { connection, store, runs, tick: (ms: number) => (clock += ms) };
}

describe('media index store', () => {
  it('builds once on first use and serves the result', async () => {
    const { store, runs } = await setup();
    expect(store.get()).toBeNull();
    expect(store.status().state).toBe('building');
    store.get();
    expect(runs).toHaveLength(1);

    runs[0]!.resolve(emptyIndex('first'));
    await flush();
    expect(store.status().state).toBe('ready');
    expect(store.get()?.facets.genres[0]?.value).toBe('first');
  });

  it('keeps serving an old index while rebuilding it in the background', async () => {
    const { store, runs, tick } = await setup();
    store.get();
    runs[0]!.resolve(emptyIndex('old'));
    await flush();

    tick(1500);
    expect(store.get()?.facets.genres[0]?.value).toBe('old');
    expect(runs).toHaveLength(2);
    expect(store.status().state).toBe('building');
  });

  it('waits before retrying a failed build, unless asked to', async () => {
    const { store, runs, tick } = await setup();
    store.get();
    runs[0]!.reject(new Error('Jellyfin down'));
    await flush();
    expect(store.status()).toMatchObject({ state: 'error', error: 'Jellyfin down' });

    store.get();
    expect(runs).toHaveLength(1);
    tick(600);
    store.get();
    expect(runs).toHaveLength(2);

    store.refresh();
    expect(runs).toHaveLength(2); // already building
  });

  it('drops the index when the connection changes and ignores late results', async () => {
    const { connection, store, runs } = await setup();
    store.get();
    runs[0]!.resolve(emptyIndex('one'));
    await flush();

    store.refresh(); // a rebuild for the first server is still running …
    await connection.save({ url: 'http://two.test', apiKey: 'key' });
    expect(store.get()).toBeNull(); // … when the connection changes
    expect(runs.map((run) => run.client.baseUrl)).toEqual(['http://one.test', 'http://one.test', 'http://two.test']);

    runs[1]!.resolve(emptyIndex('late one'));
    await flush();
    expect(store.get()).toBeNull();

    runs[2]!.resolve(emptyIndex('two'));
    await flush();
    expect(store.get()?.facets.genres[0]?.value).toBe('two');
  });
});
