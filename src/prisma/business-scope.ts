import { PrismaClient } from '../generated/prisma/client';

type OperationArgs = {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: unknown;
};

const createOperations = new Set(['create', 'createMany', 'createManyAndReturn']);

function assertUuid(businessId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId)) {
    throw new Error('businessId must be a UUID');
  }
}

function withBusinessId(data: unknown, businessId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => withBusinessId(item, businessId));
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('Scoped create requires a data object');
  }
  if ('business' in data) {
    throw new Error('Scoped create cannot set the business relation');
  }
  return { ...data, businessId };
}

export function createBusinessScope(client: PrismaClient, businessId: string) {
  assertUuid(businessId);
  return client.$extends({
    name: 'businessScope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const scoped: OperationArgs = { ...(args as OperationArgs) };
          const tenantKey = model === 'Business' ? 'id' : 'businessId';

          if (createOperations.has(operation)) {
            if (model === 'Business') {
              throw new Error('Businesses cannot be created through a business scope');
            }
            scoped.data = withBusinessId(scoped.data, businessId);
          } else {
            scoped.where = { ...scoped.where, [tenantKey]: businessId };
            if (operation === 'upsert') {
              scoped.create = withBusinessId(scoped.create, businessId);
            }
          }
          return query(scoped);
        },
      },
    },
  });
}

export type BusinessScope = ReturnType<typeof createBusinessScope>;
