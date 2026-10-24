import { describe, expect, it } from 'vitest';
import type { AddToCollectionResponse, CollectionPreview, CollectionsResponse, MediaIndexStatus } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import type { JfBaseItem, JfUser } from '../src/jellyfin/types.js';
import { createMediaIndexStore } from '../src/media/store.js';

const hex = (n: number) => n.toString(16).padStart(32, '0');
const LIB = hex(0xf1);
const ADMIN = hex(0xa1);
const ATMOS = { Type: 'Audio', Language: 'ger', Codec: 'truehd', Profile: 'Dolby TrueHD + Dolby Atmos', Channels: 8 } as const;
const STEREO = { Type: 'Audio', Language: 'ger', Codec: 'aac', Channels: 2 } as const;

const movie = (n: number, streams: object[]): JfBaseItem => ({
  Id: hex(n),
  Name: `Film ${n}`,
  Type: 'Movie',
  MediaSources: [{ MediaStreams: streams as JfBaseItem['MediaStreams'] }],
});

/**
 * Behaves like Jellyfin where it matters: collection contents are only
 * resolved with a user id, and one unknown id rejects a whole batch.
 */
function fakeJellyfin(options: { users?: JfUser[]; movies?: JfBaseItem[] } = {}) {
  const users = options.users ?? [
    { Id: hex(0xb2), Name: 'Gast', Policy: { IsAdministrator: false } },
    { Id: ADMIN, Name: 'Admin', Policy: { IsAdministrator: true } },
  ];
  const movies = options.movies ?? [movie(1, [ATMOS]), movie(2, [ATMOS]), movie(3, [ATMOS]), movie(4, [STEREO])];
  const known = new Set(movies.map((m) => m.Id));
  const collections = new Map<string, { name: string; items: Set<string> }>([[hex(0xc1), { name: 'Atmos', items: new Set([hex(1)]) }]]);
  const calls: string[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    const params = url.searchParams;
    if (url.pathname === '/Users') return Response.json(users);
    if (url.pathname === '/Library/VirtualFolders') return Response.json([{ Name: 'Filme', ItemId: LIB, CollectionType: 'movies' }]);
    if (url.pathname === '/Items') {
      if (params.get('includeItemTypes') === 'BoxSet') {
        const items = [...collections].map(([Id, c]) => ({ Id, Name: c.name, Type: 'BoxSet', ChildCount: params.get('userId') ? c.items.size : undefined }));
        return Response.json({ Items: items, TotalRecordCount: items.length });
      }
      const ids = params.get('ids');
      if (ids) {
        const collection = collections.get(ids);
        const found = collection ? [{ Id: ids, Name: collection.name, Type: 'BoxSet' }] : movies.filter((m) => m.Id === ids);
        return Response.json({ Items: found, TotalRecordCount: found.length });
      }
      const parent = params.get('parentId');
      const collection = parent ? collections.get(parent) : undefined;
      if (collection) {
        // Without a user Jellyfin only looks at direct children, and collections have none.
        const items = params.get('userId') ? [...collection.items].map((Id) => ({ Id })) : [];
        return Response.json({ Items: items, TotalRecordCount: items.length });
      }
      if (parent === LIB && params.get('includeItemTypes') === 'Movie') {
        const start = Number(params.get('startIndex') ?? 0);
        const limit = Number(params.get('limit') ?? movies.length);
        return Response.json({ Items: movies.slice(start, start + limit), TotalRecordCount: movies.length });
      }
      return Response.json({ Items: [], TotalRecordCount: 0 });
    }
    if (url.pathname === '/Collections' && method === 'POST') {
      const Id = hex(0xc2);
      collections.set(Id, { name: params.get('name') ?? '', items: new Set() });
      return Response.json({ Id });
    }
    const add = url.pathname.match(/^\/Collections\/(\w+)\/Items$/);
    if (add && method === 'POST') {
      const ids = (params.get('ids') ?? '').split(',');
      if (ids.some((id) => !known.has(id))) return new Response('No item exists with the supplied Id', { status: 400 });
      for (const id of ids) collections.get(add[1]!)!.items.add(id);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };

  return { fetch, collections, known, calls };
}

async function setup(fake = fakeJellyfin()) {
  const connection = await createConnection({
    store: { load: async () => ({ url: 'http://jellyfin.test', apiKey: 'key' }), save: async () => {} },
    envSettings: null,
    createClient: (settings) => createJellyfinClient(settings, { fetch: fake.fetch }),
  });
  const app = await buildApp({ config: { staticDir: null }, connection, mediaStore: createMediaIndexStore(connection) });
  // Build the media index before the collection calls need it.
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await app.inject('/api/media/status')).json<MediaIndexStatus>().state === 'ready') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { app, fake };
}

const atmosFilters = { audioLanguage: ['de'], audioFormat: ['atmos'] };

describe('collections', () => {
  it('lists collections with their size, read as an administrator', async () => {
    const { app } = await setup();
    const response = await app.inject('/api/collections');
    expect(response.json<CollectionsResponse>().collections).toEqual([{ id: hex(0xc1), name: 'Atmos', itemCount: 1 }]);
  });

  it('previews which matching titles are already in the collection', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/collections/preview',
      payload: { collectionId: hex(0xc1), filters: atmosFilters },
    });
    expect(response.json<CollectionPreview>()).toEqual({ matching: 3, alreadyIn: 1, toAdd: 2 });

    const forNew = await app.inject({ method: 'POST', url: '/api/collections/preview', payload: { collectionId: null, filters: atmosFilters } });
    expect(forNew.json<CollectionPreview>()).toEqual({ matching: 3, alreadyIn: 0, toAdd: 3 });
  });

  it('adds only the missing titles to an existing collection', async () => {
    const { app, fake } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/collections/add', payload: { collectionId: hex(0xc1), filters: atmosFilters } });
    expect(response.json<AddToCollectionResponse>()).toEqual({
      collection: { id: hex(0xc1), name: 'Atmos' },
      added: 2,
      alreadyIn: 1,
      failed: 0,
    });
    expect([...fake.collections.get(hex(0xc1))!.items].sort()).toEqual([hex(1), hex(2), hex(3)]);
  });

  it('creates a new collection by name', async () => {
    const { app, fake } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/collections/add', payload: { name: ' Deutsch Atmos ', filters: atmosFilters } });
    expect(response.json<AddToCollectionResponse>()).toMatchObject({ collection: { name: 'Deutsch Atmos' }, added: 3, alreadyIn: 0 });
    expect(fake.collections.get(hex(0xc2))?.items.size).toBe(3);
  });

  it('skips titles Jellyfin no longer knows instead of failing the whole batch', async () => {
    const { app, fake } = await setup();
    fake.known.delete(hex(3)); // deleted in Jellyfin after the index was built
    const response = await app.inject({ method: 'POST', url: '/api/collections/add', payload: { collectionId: hex(0xc1), filters: atmosFilters } });
    expect(response.json<AddToCollectionResponse>()).toMatchObject({ added: 1, alreadyIn: 1, failed: 1 });
    expect(fake.collections.get(hex(0xc1))!.items.has(hex(2))).toBe(true);
  });

  it('rejects unclear or invalid requests', async () => {
    const { app } = await setup();
    const add = (payload: object) => app.inject({ method: 'POST', url: '/api/collections/add', payload });
    expect((await add({ filters: atmosFilters })).statusCode).toBe(400);
    expect((await add({ collectionId: hex(0xc1), name: 'X', filters: atmosFilters })).statusCode).toBe(400);
    expect((await add({ collectionId: hex(1), filters: atmosFilters })).statusCode).toBe(404); // a movie, not a collection
    expect((await add({ name: 'Leer', filters: { q: 'gibt es nicht' } })).statusCode).toBe(400);
    expect((await add({ collectionId: '../Users', filters: {} })).statusCode).toBe(400);
  });

  it('explains when Jellyfin has no administrator', async () => {
    const { app } = await setup(fakeJellyfin({ users: [{ Id: hex(0xb2), Policy: { IsAdministrator: false } }] }));
    const response = await app.inject('/api/collections');
    expect(response.statusCode).toBe(502);
    expect(response.json().error.message).toContain('Administrator');
  });
});
