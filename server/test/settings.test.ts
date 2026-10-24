import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, normalizeJellyfinUrl } from '../src/config.js';
import { createFileSettingsStore } from '../src/settings.js';

describe('file settings store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'manelly-data-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null before anything was saved', async () => {
    expect(await createFileSettingsStore(join(dir, 'missing')).load()).toBeNull();
  });

  it('saves and loads the connection, readable only by the owner', async () => {
    const store = createFileSettingsStore(join(dir, 'nested'));
    await store.save({ url: 'http://jellyfin:8096', apiKey: 'secret' });

    expect(await store.load()).toEqual({ url: 'http://jellyfin:8096', apiKey: 'secret' });
    const file = join(dir, 'nested', 'settings.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('fails loudly on a corrupt file', async () => {
    await writeFile(join(dir, 'settings.json'), '{ not json');
    await expect(createFileSettingsStore(dir).load()).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('normalizeJellyfinUrl', () => {
  it.each([
    ['http://192.168.1.10:8096/', 'http://192.168.1.10:8096'],
    [' https://media.example.org/jellyfin/ ', 'https://media.example.org/jellyfin'],
    ['http://jellyfin:8096/web/#/home', 'http://jellyfin:8096'],
    ['https://media.example.org/jellyfin/web/index.html#!/home.html', 'https://media.example.org/jellyfin'],
    ['http://jellyfin:8096/?x=1', 'http://jellyfin:8096'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeJellyfinUrl(input, 'URL')).toBe(expected);
  });

  it('rejects other protocols and garbage', () => {
    expect(() => normalizeJellyfinUrl('ftp://jellyfin', 'URL')).toThrow(ConfigError);
    expect(() => normalizeJellyfinUrl('jellyfin:8096', 'URL')).toThrow(ConfigError);
    expect(() => normalizeJellyfinUrl('nicht eine url', 'URL')).toThrow(ConfigError);
  });
});
