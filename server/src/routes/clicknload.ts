import type { FastifyInstance } from 'fastify';
import type { ClickNLoadAnswer, ClickNLoadKind, ClickNLoadRequest, ClickNLoadStatus } from '@manelly/shared';
import { extensionZip } from '../clicknload/extension.js';
import type { ClickNLoad } from '../clicknload/service.js';
import { AppError } from '../errors.js';

/**
 * Click'n'Load: the browser extension hands over what pages send to 127.0.0.1:9666; on the computer Manelly runs on,
 * Manelly itself listens there (see clicknload/listener.ts).
 */
export async function clickNLoadRoutes(app: FastifyInstance, opts: { clickNLoad: ClickNLoad; extensionDir: string | null }) {
  const { clickNLoad, extensionDir } = opts;

  app.get('/', async (): Promise<ClickNLoadStatus> => clickNLoad.status());

  app.put<{ Body: { local: boolean } }>(
    '/',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['local'], properties: { local: { type: 'boolean' } } } } },
    async (request): Promise<ClickNLoadStatus> => {
      const status = await clickNLoad.setLocal(request.body.local);
      request.log.info(`Click'n'Load auf diesem Rechner ${request.body.local ? 'eingeschaltet' : 'ausgeschaltet'}`);
      return status;
    },
  );

  // JSON only: a page cannot send that to Manelly by itself, only the extension with its rights can.
  app.post<{ Params: { kind: ClickNLoadKind }; Body: ClickNLoadRequest }>(
    '/:kind',
    {
      bodyLimit: 2 * 1024 * 1024,
      schema: {
        params: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['add', 'addcrypted', 'addcrypted2'] } } },
        body: {
          type: 'object',
          required: ['fields'],
          properties: { fields: { type: 'object', additionalProperties: { type: 'string', maxLength: 2 * 1024 * 1024 } } },
        },
      },
    },
    async (request): Promise<ClickNLoadAnswer> => clickNLoad.receive(request.params.kind, request.body.fields, 'extension'),
  );

  app.get('/extension.zip', async (request, reply) => {
    if (!extensionDir) throw new AppError('NOT_FOUND', 'Die Browser-Erweiterung liegt dieser Manelly-Installation nicht bei.');
    // The address this browser reaches Manelly at; the extension sends the links there.
    const zip = await extensionZip(extensionDir, `${request.protocol}://${request.headers.host ?? 'localhost:3000'}`);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', 'attachment; filename="manelly-clicknload.zip"')
      .header('cache-control', 'no-store')
      .send(zip);
  });
}
