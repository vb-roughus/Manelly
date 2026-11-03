import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeLink } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import { ConfigError } from '../src/config.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import { createFileLinksStore } from '../src/links.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'manelly-links-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const connection = await createConnection({
    store: { load: async () => null, save: async () => {} },
    envSettings: null,
    createClient: (settings) => createJellyfinClient(settings),
  });
  return buildApp({ config: { staticDir: null }, connection, links: await createFileLinksStore(dir) });
}

const WIKI = { name: 'Jellyfin-Doku', description: 'Offizielle Dokumentation', url: 'https://jellyfin.org/docs/' };

describe('links', () => {
  it('adds, changes and deletes links, kept in the data folder', async () => {
    const app = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/links' })).json()).toEqual([]);

    const added = await app.inject({ method: 'POST', url: '/api/links', payload: { ...WIKI, name: '  Jellyfin-Doku ' } });
    expect(added.statusCode).toBe(201);
    const link = added.json() as KnowledgeLink;
    expect(link).toMatchObject(WIKI);
    const second = (await app.inject({ method: 'POST', url: '/api/links', payload: { name: 'Trash Guides', description: '', url: 'https://trash-guides.info' } })).json() as KnowledgeLink;
    expect(second.url).toBe('https://trash-guides.info/');

    const changed = await app.inject({ method: 'PUT', url: `/api/links/${link.id}`, payload: { ...WIKI, description: 'Alles zu Jellyfin' } });
    expect(changed.json()).toEqual({ id: link.id, ...WIKI, description: 'Alles zu Jellyfin' });
    expect((await app.inject({ method: 'DELETE', url: `/api/links/${second.id}` })).statusCode).toBe(204);

    const kept = JSON.parse(await readFile(join(dir, 'links.json'), 'utf8'));
    expect(kept).toEqual({ version: 1, links: [{ id: link.id, ...WIKI, description: 'Alles zu Jellyfin' }] });
    // After a restart, they are still there.
    expect(await (await createFileLinksStore(dir)).list()).toEqual(kept.links);
    await app.close();
  });

  it('takes only web addresses and a name', async () => {
    const app = await setup();
    const refused = async (payload: object) => {
      const response = await app.inject({ method: 'POST', url: '/api/links', payload });
      return [response.statusCode, (response.json() as { error: { message: string } }).error.message];
    };
    expect(await refused({ ...WIKI, url: 'javascript:alert(1)' })).toEqual([400, 'Nur Adressen mit http:// oder https:// gehen.']);
    expect(await refused({ ...WIKI, url: 'file:///etc/passwd' })).toEqual([400, 'Nur Adressen mit http:// oder https:// gehen.']);
    expect(await refused({ ...WIKI, url: 'jellyfin docs' })).toEqual([400, '«jellyfin docs» ist keine gültige Adresse.']);
    expect(await refused({ ...WIKI, name: '   ' })).toEqual([400, 'Der Link braucht einen Namen.']);
    expect((await app.inject({ method: 'POST', url: '/api/links', payload: { name: 'Ohne Adresse', description: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/links', payload: { ...WIKI, name: 'x'.repeat(81) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/links/2f1c7a52-8d1e-4c5b-9a43-1f0e6b7d9c21', payload: WIKI })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/links/../settings' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/links' })).json()).toEqual([]);
    await app.close();
  });

  it('keeps every one of several quick saves', async () => {
    const store = await createFileLinksStore(dir);
    await Promise.all(['A', 'B', 'C'].map((name) => store.add({ name, description: '', url: `https://${name.toLowerCase()}.example.org/` })));
    expect((await store.list()).map((link) => link.name)).toEqual(['A', 'B', 'C']);
    expect(JSON.parse(await readFile(join(dir, 'links.json'), 'utf8')).links).toHaveLength(3);
  });

  it('fails loudly on a damaged file', async () => {
    await writeFile(join(dir, 'links.json'), '{ kaputt');
    await expect(createFileLinksStore(dir)).rejects.toBeInstanceOf(ConfigError);
  });
});
