import type { FastifyInstance } from 'fastify';
import type {
  AddToCollectionRequest,
  AddToCollectionResponse,
  CollectionPreview,
  CollectionPreviewRequest,
  CollectionsResponse,
} from '@manelly/shared';
import {
  addItemsToCollection,
  collectionItemIds,
  collectionName,
  listCollections,
  planCollectionAdd,
} from '../collections.js';
import type { JellyfinConnection } from '../connection.js';
import { AppError, requireClient } from '../errors.js';
import type { MediaIndexStore } from '../media/store.js';
import { searchQuerySchema } from './media.js';

const idSchema = { type: 'string', pattern: '^[0-9a-fA-F]{32}$|^[0-9a-fA-F-]{36}$' } as const;
const filtersSchema = { ...searchQuerySchema, properties: { ...searchQuerySchema.properties } } as const;

export async function collectionsRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection; store: MediaIndexStore }) {
  const { connection, store } = opts;

  const readyIndex = () => {
    const index = store.get();
    if (!index) throw new AppError('BAD_REQUEST', 'Der Medien-Index wird noch aufgebaut – bitte einen Moment warten.');
    return index;
  };

  app.get('/', async (): Promise<CollectionsResponse> => {
    return { collections: await listCollections(requireClient(connection.client)) };
  });

  app.post<{ Body: CollectionPreviewRequest }>(
    '/preview',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['collectionId', 'filters'],
          properties: { collectionId: { anyOf: [idSchema, { type: 'null' }] }, filters: filtersSchema },
        },
      },
    },
    async (request): Promise<CollectionPreview> => {
      const client = requireClient(connection.client);
      const index = readyIndex();
      const { collectionId, filters } = request.body;
      let existing = new Set<string>();
      if (collectionId) {
        await collectionName(client, collectionId);
        existing = await collectionItemIds(client, collectionId);
      }
      const { matching, alreadyIn, toAdd } = planCollectionAdd(index, filters, existing);
      return { matching, alreadyIn, toAdd: toAdd.length };
    },
  );

  app.post<{ Body: AddToCollectionRequest }>(
    '/add',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['filters'],
          properties: {
            collectionId: idSchema,
            name: { type: 'string', minLength: 1, maxLength: 200 },
            filters: filtersSchema,
          },
        },
      },
    },
    async (request): Promise<AddToCollectionResponse> => {
      const client = requireClient(connection.client);
      const index = readyIndex();
      const { collectionId, filters } = request.body;
      const newName = request.body.name?.trim();
      if (Boolean(collectionId) === Boolean(newName)) {
        throw new AppError('BAD_REQUEST', 'Bitte entweder eine bestehende Sammlung wählen oder einen Namen für eine neue angeben.');
      }

      let name = newName ?? '';
      let existing = new Set<string>();
      if (collectionId) {
        name = await collectionName(client, collectionId);
        existing = await collectionItemIds(client, collectionId);
      }
      const plan = planCollectionAdd(index, filters, existing);
      if (!collectionId && plan.toAdd.length === 0) {
        throw new AppError('BAD_REQUEST', 'Keine Treffer – eine leere Sammlung wird nicht angelegt.');
      }
      const id = collectionId ?? (await client.createCollection(name, []));

      const { added, failed } = await addItemsToCollection(client, id, plan.toAdd);
      request.log.info(`${added} Titel zur Sammlung «${name}» hinzugefügt (${plan.alreadyIn} schon vorhanden, ${failed} fehlgeschlagen)`);
      return { collection: { id, name }, added, alreadyIn: plan.alreadyIn, failed };
    },
  );
}
