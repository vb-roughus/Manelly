import { describe, expect, it } from 'vitest';
import type { MediaDiagnosisResponse, TitleDiagnosis } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import type { JfBaseItem } from '../src/jellyfin/types.js';
import { diagnoseTitle } from '../src/media/diagnose.js';
import { buildMediaIndex } from '../src/media/indexer.js';
import { createMediaIndexStore } from '../src/media/store.js';

const hex = (n: number) => n.toString(16).padStart(32, '0');
const FILME = hex(0xf1);
const HOME = hex(0xf3);
const OLD = '2024-01-01T00:00:00Z';

const libraries = [
  { Name: 'Filme', ItemId: FILME, CollectionType: 'movies', Locations: ['/media/filme'] },
  { Name: 'Serien', ItemId: hex(0xf2), CollectionType: 'tvshows', Locations: ['/media/serien/'] },
  { Name: 'Heimvideos', ItemId: HOME, CollectionType: 'homevideos', Locations: ['/media/home'] },
];

const item = (n: number, Name: string, Type: string, Path: string, extra: Partial<JfBaseItem> = {}): JfBaseItem => ({
  Id: hex(n),
  Name,
  Type,
  Path,
  DateCreated: OLD,
  MediaSources: [{ MediaStreams: [{ Type: 'Audio', Language: 'ger', Codec: 'aac', Channels: 2 }] }],
  ...extra,
});

function fakeLibrary() {
  // What Jellyfin lists per library, and everything its search finds.
  const listed: JfBaseItem[] = [item(1, 'Spider-Man', 'Movie', '/media/filme/Spider-Man (2002)/movie.mkv')];
  const searchable: JfBaseItem[] = [
    ...listed,
    item(3, 'Ghost', 'Movie', '/media/filme/Ghost/ghost.mkv'),
    item(5, 'Urlaub 2019', 'Video', '/media/home/urlaub.mp4'),
    item(6, 'Konzert', 'Movie', '/media/home/konzert.mkv'),
    item(7, 'Lost', 'Movie', '/mnt/usb/lost.mkv'),
  ];

  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    if (url.pathname === '/Library/VirtualFolders') return Response.json(libraries);
    if (url.pathname !== '/Items') return new Response(null, { status: 404 });

    const term = params.get('searchTerm');
    if (term) {
      const hits = searchable.filter((entry) => entry.Name!.toLowerCase().includes(term.toLowerCase()));
      return Response.json({ Items: hits, TotalRecordCount: hits.length });
    }
    const type = params.get('includeItemTypes');
    let items = params.get('parentId') === FILME && type === 'Movie' ? listed : [];
    const ids = params.get('ids');
    if (ids) items = items.filter((entry) => entry.Id === ids);
    const start = Number(params.get('startIndex') ?? 0);
    const limit = Number(params.get('limit') ?? items.length);
    return Response.json({ Items: items.slice(start, start + limit), TotalRecordCount: items.length });
  };

  /** A title Jellyfin lists in the library (and its search finds). */
  const add = (entry: JfBaseItem) => {
    listed.push(entry);
    searchable.push(entry);
  };
  return { fetch, add };
}

async function setup() {
  const fake = fakeLibrary();
  const client = createJellyfinClient({ url: 'http://jellyfin.test', apiKey: 'key' }, { fetch: fake.fetch });
  const index = await buildMediaIndex(client);
  return { fake, client, index };
}

const verdictOf = (results: TitleDiagnosis[], name: string) => results.find((result) => result.name === name);

describe('missing title diagnosis', () => {
  it('confirms visible titles and names the filters that hide them', async () => {
    const { client, index } = await setup();
    expect(verdictOf(await diagnoseTitle(client, index, 'spider', {}), 'Spider-Man')).toMatchObject({
      verdict: 'visible',
      library: { name: 'Filme', collectionType: 'movies' },
    });
    expect(verdictOf(await diagnoseTitle(client, index, 'spider', { audioLanguage: ['de'], audioFormat: ['atmos'], yearFrom: 2010 }), 'Spider-Man')).toMatchObject({
      verdict: 'filtered',
      failingFilters: ['year', 'audio'],
    });
  });

  it('matches the search text regardless of punctuation and spaces', async () => {
    const { client, index } = await setup();
    for (const q of ['spiderman', 'Spider Man', 'spider-man']) {
      expect(verdictOf(await diagnoseTitle(client, index, 'spider', { q }), 'Spider-Man')?.verdict).toBe('visible');
    }
    expect(verdictOf(await diagnoseTitle(client, index, 'spider', { q: 'batman' }), 'Spider-Man')?.failingFilters).toEqual(['q']);
  });

  it('explains titles Manelly does not read', async () => {
    const { client, index } = await setup();
    const results = await Promise.all(['Urlaub', 'Konzert', 'Lost', 'Ghost'].map((title) => diagnoseTitle(client, index, title, {})));
    expect(results.map(([result]) => result?.verdict)).toEqual(['unsupportedType', 'unsupportedLibrary', 'noLibrary', 'notInLibraryQuery']);
  });

  it('tells new titles apart from ones the index is missing', async () => {
    const { fake, client, index } = await setup();
    fake.add(item(2, 'Neuer Film', 'Movie', '/media/filme/neu.mkv', { DateCreated: new Date(Date.now() + 60_000).toISOString() }));
    fake.add(item(4, 'Verpasst', 'Movie', '/media/filme/verpasst.mkv'));

    expect((await diagnoseTitle(client, index, 'neuer', {}))[0]?.verdict).toBe('newerThanIndex');
    expect((await diagnoseTitle(client, index, 'verpasst', {}))[0]?.verdict).toBe('missingFromIndex');
    expect((await diagnoseTitle(client, null, 'verpasst', {}))[0]?.verdict).toBe('indexNotReady');
  });

  it('is available through the API with the current filters', async () => {
    const fake = fakeLibrary();
    const connection = await createConnection({
      store: { load: async () => ({ url: 'http://jellyfin.test', apiKey: 'key' }), save: async () => {} },
      envSettings: null,
      createClient: (settings) => createJellyfinClient(settings, { fetch: fake.fetch }),
    });
    const app = await buildApp({ config: { staticDir: null }, connection, mediaStore: createMediaIndexStore(connection) });

    const response = await app.inject('/api/media/diagnose?title=spider&type=Series');
    expect(response.statusCode).toBe(200);
    const body = response.json<MediaDiagnosisResponse>();
    expect(body.title).toBe('spider');
    expect(body.results[0]).toMatchObject({ name: 'Spider-Man', type: 'Movie' });
    expect((await app.inject('/api/media/diagnose')).statusCode).toBe(400);
  });
});
