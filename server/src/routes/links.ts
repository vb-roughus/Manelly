import type { FastifyInstance } from 'fastify';
import type { KnowledgeLink, KnowledgeLinkInput } from '@manelly/shared';
import { MAX_DESCRIPTION, MAX_NAME, MAX_URL, type LinksStore } from '../links.js';

const body = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'url'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: MAX_NAME },
    description: { type: 'string', maxLength: MAX_DESCRIPTION },
    url: { type: 'string', minLength: 1, maxLength: MAX_URL },
  },
};

const params = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-f-]{36}$' } } };

/** The links of the menu «Links», kept by Manelly for every browser. */
export async function linksRoutes(app: FastifyInstance, opts: { links: LinksStore }) {
  const { links } = opts;

  app.get('/', async (): Promise<KnowledgeLink[]> => links.list());

  app.post<{ Body: KnowledgeLinkInput }>('/', { schema: { body } }, async (request, reply): Promise<KnowledgeLink> => {
    const link = await links.add(request.body);
    request.log.info(`Link hinzugefügt: ${link.name} (${link.url})`);
    return reply.status(201).send(link);
  });

  app.put<{ Params: { id: string }; Body: KnowledgeLinkInput }>('/:id', { schema: { params, body } }, async (request): Promise<KnowledgeLink> => {
    const link = await links.update(request.params.id, request.body);
    request.log.info(`Link geändert: ${link.name} (${link.url})`);
    return link;
  });

  app.delete<{ Params: { id: string } }>('/:id', { schema: { params } }, async (request, reply) => {
    await links.remove(request.params.id);
    request.log.info('Link gelöscht');
    return reply.status(204).send();
  });
}
