import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ClickNLoadKind } from '@manelly/shared';
import { CLICKNLOAD_PORT, type ClickNLoad, type LocalListener } from './service.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const KINDS: Record<string, ClickNLoadKind> = { '/flash/add': 'add', '/flash/addcrypted': 'addcrypted', '/flash/addcrypted2': 'addcrypted2' };

/** What JDownloader answers there, so pages see it running. */
const JDCHECK = "jdownloader=true;\nvar version='18507';\n";
const CROSSDOMAIN =
  '<?xml version="1.0"?>\n<!DOCTYPE cross-domain-policy SYSTEM "http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd">\n<cross-domain-policy>\n<allow-access-from domain="*" />\n</cross-domain-policy>\n';

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Anfrage zu gross.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Form fields as a page posts them, urlencoded or as multipart; files are left out. */
export async function formFields(contentType: string | undefined, body: Buffer): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  if (body.length === 0) return fields;
  const type = contentType?.toLowerCase() ?? '';
  const form = type.startsWith('multipart/form-data')
    ? await new Request('http://local/', { method: 'POST', headers: { 'content-type': contentType! }, body }).formData()
    : new URLSearchParams(body.toString('utf8'));
  for (const [name, value] of form) if (typeof value === 'string' && !(name in fields)) fields[name] = value;
  return fields;
}

/**
 * Plays JDownloader on 127.0.0.1:9666 of the computer Manelly runs on: pages there post Click'n'Load to that address.
 * Only this computer reaches it.
 */
export function createLocalListener(service: Pick<ClickNLoad, 'receive'>, port = CLICKNLOAD_PORT, host = '127.0.0.1'): LocalListener & { readonly port: number } {
  let listening = false;
  let error: string | null = null;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    // Pages call from their own origin; JDownloader allows that too.
    response.setHeader('Access-Control-Allow-Origin', '*');
    const path = new URL(request.url ?? '/', 'http://local').pathname.replace(/\/+$/, '') || '/';
    const reply = (status: number, body: string, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': request.headers['access-control-request-headers'] ?? '*',
        'Access-Control-Allow-Private-Network': 'true',
      });
      return response.end();
    }
    if (request.method === 'GET' && path === '/jdcheck.js') return reply(200, JDCHECK, 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && path === '/crossdomain.xml') return reply(200, CROSSDOMAIN, 'text/xml; charset=utf-8');
    if (request.method === 'GET' && (path === '/flash' || path === '/')) return reply(200, 'JDownloader\r\n');
    const kind = KINDS[path];
    if (request.method === 'POST' && kind) {
      const fields = await formFields(request.headers['content-type'], await readBody(request));
      const answer = await service.receive(kind, fields, 'local');
      return reply(200, answer.error ? `failed ${answer.error}\r\n` : 'success\r\n');
    }
    return reply(404, 'Not found\r\n');
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((failure: unknown) => {
      if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`failed ${(failure as Error).message}\r\n`);
    });
  });

  return {
    /** The port it listens on; the one asked for until then. */
    get port() {
      return (server.address() as AddressInfo | null)?.port ?? port;
    },
    get listening() {
      return listening;
    },
    get error() {
      return error;
    },
    async start() {
      if (listening) return;
      await new Promise<void>((resolve) => {
        const fail = (failure: NodeJS.ErrnoException) => {
          server.off('listening', done);
          error =
            failure.code === 'EADDRINUSE'
              ? `Port ${port} ist schon belegt – läuft auf diesem Rechner ein JDownloader? Dann nimmt der die Links an.`
              : `Port ${port} lässt sich nicht öffnen: ${failure.message}`;
          resolve();
        };
        const done = () => {
          server.off('error', fail);
          listening = true;
          error = null;
          resolve();
        };
        server.once('error', fail);
        server.once('listening', done);
        server.listen(port, host);
      });
    },
    async stop() {
      error = null;
      if (!listening) return;
      listening = false;
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}
