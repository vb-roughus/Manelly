import { createCipheriv } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClickNLoadAnswer, ClickNLoadStatus, LinkGrabberContainerRequest, LinkGrabberLinksRequest } from '@manelly/shared';
import type { AgentClient } from '../src/agent/client.js';
import type { AgentConnection } from '../src/agent/connection.js';
import { buildApp } from '../src/app.js';
import { decryptLinks, keyFromJk, readRequest } from '../src/clicknload/decrypt.js';
import { createLocalListener, formFields } from '../src/clicknload/listener.js';
import { createClickNLoad, createFileClickNLoadSettings } from '../src/clicknload/service.js';
import { createConnection } from '../src/connection.js';
import { AppError } from '../src/errors.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import { createZip } from '../src/zip.js';

const KEY_HEX = '31323334353637383930313233343536';

/** Encrypts like a link protector does for CNL2: AES-128-CBC, key as IV, padded with zeros. */
function encrypt(links: string[], keyHex = KEY_HEX): string {
  const key = Buffer.from(keyHex, 'hex');
  const text = Buffer.from(links.join('\r\n'));
  const padded = Buffer.concat([text, Buffer.alloc((16 - (text.length % 16)) % 16)]);
  const cipher = createCipheriv('aes-128-cbc', key, key).setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

const LINKS = ['https://rapidgator.net/file/aaa/dune.part1.rar.html', 'https://rapidgator.net/file/bbb/dune.part2.rar.html'];
const CNL2 = {
  passwords: 'geheim\nanderes',
  source: 'https://filecrypt.cc/Container/ABC.html',
  jk: `function f(){ return '${KEY_HEX}';}`,
  crypted: encrypt(LINKS),
  package: 'Dune (2024)',
};

/** The agent as Manelly sees it: what it got, and whether it knows links. */
function fakeAgent(options: { old?: boolean } = {}) {
  const got = { links: [] as LinkGrabberLinksRequest[], containers: [] as LinkGrabberContainerRequest[] };
  const client = {
    addLinkGrabberLinks: async (request: LinkGrabberLinksRequest) => {
      if (options.old) throw new AppError('BAD_REQUEST', 'Route POST /api/jdownloader/linkgrabber/links gibt es nicht.', 404);
      got.links.push(request);
      return { added: request.links.length };
    },
    addLinkGrabberContainer: async (request: LinkGrabberContainerRequest) => {
      got.containers.push(request);
      return { added: request.name };
    },
  };
  return { got, connection: { client: client as unknown as AgentClient } as AgentConnection };
}

describe('Click\'n\'Load decryption', () => {
  it('reads the key the jk function returns, without running it', () => {
    expect(keyFromJk(`function f(){ return '${KEY_HEX}';}`)?.toString('hex')).toBe(KEY_HEX);
    expect(keyFromJk(`function f() {\n  return "${KEY_HEX.toUpperCase()}";\n}`)?.toString('hex')).toBe(KEY_HEX);
    expect(keyFromJk(KEY_HEX)?.toString('hex')).toBe(KEY_HEX);
    expect(keyFromJk("function f(){ return atob('MzEzMjMz'); }")).toBeNull();
    expect(keyFromJk('function f(){ return "1234"; }')).toBeNull();
  });

  it('decrypts the links, also when a "+" arrived as a space', () => {
    const key = Buffer.from(KEY_HEX, 'hex');
    expect(decryptLinks(key, encrypt(LINKS))).toEqual(LINKS);
    const crypted = encrypt(['https://example.org/a+b?x=1']);
    expect(decryptLinks(key, crypted.replace(/\+/g, ' '))).toEqual(['https://example.org/a+b?x=1']);
    // A wrong key gives garbage, not links.
    expect(() => decryptLinks(Buffer.from('00112233445566778899aabbccddeeff', 'hex'), encrypt(LINKS))).toThrow('Die Links liessen sich nicht entschlüsseln.');
    expect(() => decryptLinks(key, 'AAAA')).toThrow('Die verschlüsselten Links sind unvollständig.');
  });

  it('reads package, first password and source of all three kinds', () => {
    expect(readRequest('addcrypted2', CNL2)).toEqual({ links: LINKS, container: null, packageName: 'Dune (2024)', password: 'geheim', source: CNL2.source });
    expect(readRequest('add', { urls: `${LINKS[0]}\r\n\r\n${LINKS[1]}\nkein link` })).toMatchObject({ links: LINKS, packageName: null, password: null });
    expect(readRequest('addcrypted', { crypted: 'RExD GZpbGU=' })).toMatchObject({ links: [], container: 'RExD+GZpbGU=' });
    expect(() => readRequest('add', { urls: '' })).toThrow('Die Seite hat keine Links mitgeschickt.');
    expect(() => readRequest('addcrypted2', { crypted: CNL2.crypted })).toThrow('Die Seite hat Schlüssel oder Links nicht mitgeschickt.');
    expect(() => readRequest('addcrypted2', { ...CNL2, jk: 'function f(){ return x(); }' })).toThrow(/Den Schlüssel dieser Seite kann Manelly nicht lesen/);
  });
});

describe('Click\'n\'Load service', () => {
  it('hands links to the agent once, and says what became of each request', async () => {
    const { got, connection } = fakeAgent();
    let now = Date.parse('2026-11-03T12:00:00Z');
    const service = await createClickNLoad({ agent: connection, now: () => now });
    const first = await service.receive('addcrypted2', CNL2, 'extension');
    expect(first).toMatchObject({ via: 'extension', links: 2, packageName: 'Dune (2024)', source: CNL2.source, container: false, error: null, duplicate: false });
    expect(got.links).toEqual([{ links: LINKS, packageName: 'Dune (2024)', password: 'geheim', source: CNL2.source }]);
    // The same again a moment later: a double click, not handed over twice.
    now += 5_000;
    expect(await service.receive('addcrypted2', CNL2, 'local')).toMatchObject({ id: first.id, duplicate: true });
    expect(got.links).toHaveLength(1);
    now += 120_000;
    await service.receive('addcrypted2', CNL2, 'local');
    expect(got.links).toHaveLength(2);

    await service.receive('addcrypted', { crypted: 'RExDIGZpbGU=', package: 'Arrival: Teil 1' }, 'extension');
    expect(got.containers).toEqual([{ name: 'Arrival_ Teil 1.dlc', content: 'RExDIGZpbGU=' }]);
    const failed = await service.receive('add', { urls: 'nichts' }, 'local');
    expect(failed.error).toBe('Die Seite hat keine Links mitgeschickt.');
    expect(service.status().events.map((event) => [event.via, event.links, event.error])).toEqual([
      ['local', 0, 'Die Seite hat keine Links mitgeschickt.'],
      ['extension', 0, null],
      ['local', 2, null],
      ['extension', 2, null],
    ]);
  });

  it('says when there is no agent, or one too old', async () => {
    const none = await createClickNLoad({ agent: { client: null } as AgentConnection });
    expect((await none.receive('add', { urls: LINKS[0]! }, 'local')).error).toBe('Es ist noch kein Agent eingerichtet – unter Server → Agent verbinden.');
    const old = await createClickNLoad({ agent: fakeAgent({ old: true }).connection });
    expect((await old.receive('add', { urls: LINKS[0]! }, 'local')).error).toBe("Der Agent ist zu alt für Click'n'Load – unter Server → Agent «Aktualisieren & neu starten» (ab 0.32.0).");
    // A failure may be tried again right away.
    expect((await old.receive('add', { urls: LINKS[0]! }, 'local')).duplicate).toBe(false);
  });
});

describe('Click\'n\'Load on this computer', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'manelly-cnl-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('answers like JDownloader on 127.0.0.1 and takes forms, urlencoded or multipart', async () => {
    const { got, connection } = fakeAgent();
    const service = await createClickNLoad({ agent: connection });
    // Any free port for the test; the real one is 9666.
    const local = createLocalListener(service, 0);
    await local.start();
    const base = `http://127.0.0.1:${local.port}`;
    try {
      const check = await fetch(`${base}/jdcheck.js`);
      expect(await check.text()).toContain('jdownloader=true;');
      expect(check.headers.get('access-control-allow-origin')).toBe('*');
      expect(await (await fetch(`${base}/flash/`)).text()).toBe('JDownloader\r\n');
      const preflight = await fetch(`${base}/flash/addcrypted2`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Private-Network': 'true' } });
      expect([preflight.status, preflight.headers.get('access-control-allow-private-network')]).toEqual([204, 'true']);

      expect(await (await fetch(`${base}/flash/addcrypted2`, { method: 'POST', body: new URLSearchParams(CNL2) })).text()).toBe('success\r\n');
      const form = new FormData();
      form.set('urls', LINKS.join('\n'));
      form.set('package', 'Multipart');
      expect(await (await fetch(`${base}/flash/add`, { method: 'POST', body: form })).text()).toBe('success\r\n');
      expect(await (await fetch(`${base}/flash/add`, { method: 'POST', body: new URLSearchParams({ urls: '' }) })).text()).toBe('failed Die Seite hat keine Links mitgeschickt.\r\n');
      expect((await fetch(`${base}/anderes`)).status).toBe(404);
      expect(got.links.map((request) => request.packageName)).toEqual(['Dune (2024)', 'Multipart']);
      expect(service.status().events[0]?.via).toBe('local');
    } finally {
      await local.stop();
    }
    expect(local.listening).toBe(false);
  });

  it('says when the port is taken, and keeps the switch in the data folder', async () => {
    const { connection } = fakeAgent();
    const first = createLocalListener({ receive: async () => ({}) as ClickNLoadAnswer }, 0);
    await first.start();
    const second = createLocalListener({ receive: async () => ({}) as ClickNLoadAnswer }, first.port);
    await second.start();
    expect([second.listening, second.error]).toEqual([false, `Port ${first.port} ist schon belegt – läuft auf diesem Rechner ein JDownloader? Dann nimmt der die Links an.`]);
    await first.stop();

    const settings = createFileClickNLoadSettings(dir);
    expect(await settings.load()).toEqual({ local: true });
    const service = await createClickNLoad({ agent: connection, settings, listener: (cnl) => createLocalListener(cnl, 0) });
    await service.start();
    expect(service.status().local).toEqual({ enabled: true, port: 9666, listening: true, error: null });
    expect((await service.setLocal(false)).local).toEqual({ enabled: false, port: 9666, listening: false, error: null });
    expect(JSON.parse(await readFile(join(dir, 'clicknload.json'), 'utf8'))).toEqual({ version: 1, local: false });
    expect(await settings.load()).toEqual({ local: false });
    expect((await service.setLocal(true)).local.listening).toBe(true);
    await service.stop();
  });

  it('reads form fields like a browser sends them', async () => {
    expect(await formFields('application/x-www-form-urlencoded', Buffer.from('a=1&b=x%2By+z&a=2'))).toEqual({ a: '1', b: 'x+y z' });
    expect(await formFields(undefined, Buffer.alloc(0))).toEqual({});
  });
});

/** The files of a ZIP without compression, as createZip writes it. */
function unzip(zip: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const content = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(crc32(content)).toBe(zip.readUInt32LE(at + 14));
    files[name] = content.toString('utf8');
    at += 30 + nameLength + size;
  }
  // The central directory lists them all.
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(Object.keys(files).length);
  return files;
}

describe('Click\'n\'Load routes', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'manelly-extension-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup() {
    const { got, connection: agent } = fakeAgent();
    const connection = await createConnection({
      store: { load: async () => null, save: async () => {} },
      envSettings: null,
      createClient: (settings) => createJellyfinClient(settings),
    });
    await mkdir(join(dir, 'icons'));
    await writeFile(join(dir, 'manifest.json'), '{"manifest_version":3}');
    await writeFile(join(dir, 'icons', '16.png'), 'png');
    await writeFile(join(dir, 'manelly.json'), '{"url":"http://stale"}');
    const app = await buildApp({ config: { staticDir: null, extensionDir: dir }, connection, agent });
    return { app, got };
  }

  it('takes JSON from the extension, and tells the state', async () => {
    const { app, got } = await setup();
    const status = (await app.inject({ method: 'GET', url: '/api/cnl' })).json() as ClickNLoadStatus;
    expect(status).toEqual({ local: { enabled: false, port: 9666, listening: false, error: null }, events: [] });

    const answer = await app.inject({ method: 'POST', url: '/api/cnl/addcrypted2', payload: { fields: CNL2 } });
    expect(answer.json()).toMatchObject({ via: 'extension', links: 2, error: null, duplicate: false });
    expect(got.links).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: '/api/cnl/anderes', payload: { fields: {} } })).statusCode).toBe(400);
    // A page cannot post a plain form to Manelly itself.
    const form = await app.inject({ method: 'POST', url: '/api/cnl/add', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `urls=${encodeURIComponent(LINKS[0]!)}` });
    expect(form.statusCode).toBe(415);
    expect(((await app.inject({ method: 'GET', url: '/api/cnl' })).json() as ClickNLoadStatus).events).toHaveLength(1);
    await app.close();
  });

  it('hands out the extension with the address the browser reaches Manelly at', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/cnl/extension.zip', headers: { host: '192.168.1.20:3000' } });
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe('attachment; filename="manelly-clicknload.zip"');
    expect(unzip(response.rawPayload)).toEqual({
      'manelly-clicknload/manifest.json': '{"manifest_version":3}',
      'manelly-clicknload/icons/16.png': 'png',
      'manelly-clicknload/manelly.json': '{\n  "url": "http://192.168.1.20:3000"\n}\n',
    });
    await app.close();
  });

  it('writes a ZIP that keeps names and contents', () => {
    expect(unzip(createZip([{ path: 'ä/b.txt', content: Buffer.from('hallo') }]))).toEqual({ 'ä/b.txt': 'hallo' });
  });
});
