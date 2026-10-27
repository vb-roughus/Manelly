import type { FastifyInstance } from 'fastify';
import type { ManellyRestartRequest, ManellyStatus } from '@manelly/shared';
import { AppError } from '../errors.js';
import type { ManellyProcess } from '../manelly.js';

export async function manellyRoutes(app: FastifyInstance, opts: { manelly: ManellyProcess }) {
  const { manelly } = opts;

  app.get('/', async (): Promise<ManellyStatus> => manelly.status());

  // A restart answers first, then ends; the start script starts Manelly again. An update keeps Manelly running
  // while it looks for a newer version, pulls and builds; it restarts only when there was one.
  app.post<{ Body: Partial<ManellyRestartRequest> | null }>('/restart', async (request, reply) => {
    if (!(await manelly.status()).restartable) {
      throw new AppError(
        'BAD_REQUEST',
        'Manelly läuft nicht über scripts/start-mac.sh oder scripts\\start-windows.cmd und kann sich deshalb nicht selbst neu starten.',
      );
    }
    if (request.body?.update === true) return reply.status(202).send({ restarting: false, update: manelly.update() });
    reply.raw.once('finish', () => manelly.restart());
    return reply.status(202).send({ restarting: true });
  });
}
