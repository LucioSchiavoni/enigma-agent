import {
  AgentUsage,
  Appointment,
  AvailabilityOverride,
  AvailabilityRule,
  BusinessChannel,
  CalendarConnection,
  Contact,
  KnowledgeSection,
  ContactIdentity,
  Conversation,
  FaqEntry,
  Location,
  Message,
  Prisma,
  PrismaClient,
  Professional,
  Service,
} from '../generated/prisma/client';
import { ForeignKey, foreignKeys, scalarFields } from './tenant-schema';

type PlainObject = Record<string, unknown>;

interface Reference {
  target: ForeignKey['target'];
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const createOperations = new Set(['create', 'createMany']);
const bulkCreateOperations = new Set(['createMany']);
const unsupportedOperations = new Set(['upsert', 'createManyAndReturn']);
const updateOperations = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const allowedNestedOperations = new Set(['connect', 'set']);

function assertUuid(businessId: string): void {
  if (!UUID_PATTERN.test(businessId)) {
    throw new Error('businessId must be a UUID');
  }
}

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function requirePlainObject(value: unknown, what: string): PlainObject {
  if (!isPlainObject(value)) {
    throw new Error(`Scoped ${what} requires an object`);
  }
  return value;
}

function rewriteConnectTarget(target: unknown, businessId: string): PlainObject {
  return { ...requirePlainObject(target, 'connect target'), businessId };
}

function rewriteRelationWrite(relation: string, value: unknown, businessId: string): PlainObject {
  const operations = requirePlainObject(value, `relation write on "${relation}"`);
  const rewritten: PlainObject = {};
  for (const [operation, payload] of Object.entries(operations)) {
    if (!allowedNestedOperations.has(operation)) {
      throw new Error(`Nested "${operation}" on "${relation}" is not allowed in a business scope`);
    }
    rewritten[operation] = Array.isArray(payload)
      ? payload.map((target) => rewriteConnectTarget(target, businessId))
      : rewriteConnectTarget(payload, businessId);
  }
  return rewritten;
}

function referencedId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isPlainObject(value) && typeof value.set === 'string') {
    return value.set;
  }
  throw new Error('Foreign key must be a string id');
}

function prepareRecord(
  model: Prisma.ModelName,
  record: unknown,
  mode: 'create' | 'update',
  allowRelations: boolean,
  businessId: string,
  references: Reference[],
): PlainObject {
  const source = requirePlainObject(record, 'write');
  const keys = foreignKeys[model];
  const prepared: PlainObject = {};
  let usesRelations = false;

  for (const [key, value] of Object.entries(source)) {
    if (key === 'businessId') {
      if (mode === 'update' && value !== undefined && value !== businessId) {
        throw new Error('A record cannot be moved to another business');
      }
      continue;
    }
    if (model === 'Business' && key === 'id') {
      throw new Error('A business id cannot be changed');
    }
    if (scalarFields[model].has(key)) {
      const foreignKey = keys.find((candidate) => candidate.scalar === key);
      const id = foreignKey ? referencedId(value) : undefined;
      if (foreignKey && id !== undefined) {
        references.push({ target: foreignKey.target, id });
      }
      prepared[key] = value;
      continue;
    }
    if (key === 'business' || !allowRelations) {
      throw new Error(`Relation "${key}" cannot be written in this business scope`);
    }
    usesRelations = true;
    prepared[key] = rewriteRelationWrite(key, value, businessId);
  }

  if (mode === 'create') {
    const checked = usesRelations && keys.some((candidate) => Object.hasOwn(prepared, candidate.relation));
    if (checked) {
      prepared.business = { connect: { id: businessId } };
    } else {
      prepared.businessId = businessId;
    }
  }
  return prepared;
}

function prepareRecords(
  model: Prisma.ModelName,
  data: unknown,
  mode: 'create' | 'update',
  allowRelations: boolean,
  businessId: string,
  references: Reference[],
): PlainObject | PlainObject[] {
  if (Array.isArray(data)) {
    return data.map((item) => prepareRecord(model, item, mode, allowRelations, businessId, references));
  }
  return prepareRecord(model, data, mode, allowRelations, businessId, references);
}

function referenceCounters(client: PrismaClient): Record<Reference['target'], (where: { id: string; businessId: string }) => Promise<number>> {
  return {
    Location: (where) => client.location.count({ where }),
    BusinessChannel: (where) => client.businessChannel.count({ where }),
    Service: (where) => client.service.count({ where }),
    Professional: (where) => client.professional.count({ where }),
    Contact: (where) => client.contact.count({ where }),
    Conversation: (where) => client.conversation.count({ where }),
    CalendarConnection: (where) => client.calendarConnection.count({ where }),
  };
}

async function assertReferencesBelong(
  client: PrismaClient,
  references: readonly Reference[],
  businessId: string,
): Promise<void> {
  const counters = referenceCounters(client);
  const unique = new Map(references.map((reference) => [`${reference.target}:${reference.id}`, reference]));
  const counts = await Promise.all(
    [...unique.values()].map((reference) => counters[reference.target]({ id: reference.id, businessId })),
  );
  if (counts.some((count) => count === 0)) {
    throw new Error('Referenced record does not belong to this business');
  }
}

function buildScopedArgs(
  model: Prisma.ModelName,
  operation: string,
  args: unknown,
  businessId: string,
  references: Reference[],
): PlainObject {
  const scoped: PlainObject = { ...requirePlainObject(args ?? {}, 'query') };
  const tenantKey = model === 'Business' ? 'id' : 'businessId';

  if (unsupportedOperations.has(operation)) {
    throw new Error(`Operation "${operation}" is not supported in a business scope`);
  }
  if (createOperations.has(operation)) {
    if (model === 'Business') {
      throw new Error('Businesses cannot be created through a business scope');
    }
    scoped.data = prepareRecords(model, scoped.data, 'create', !bulkCreateOperations.has(operation), businessId, references);
    return scoped;
  }

  scoped.where = { ...(isPlainObject(scoped.where) ? scoped.where : {}), [tenantKey]: businessId };
  if (updateOperations.has(operation)) {
    scoped.data = prepareRecords(model, scoped.data, 'update', true, businessId, references);
  }
  return scoped;
}

function extendWithScope(client: PrismaClient, businessId: string) {
  return client.$extends({
    name: 'businessScope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const references: Reference[] = [];
          const scoped = buildScopedArgs(model, operation, args, businessId, references);
          await assertReferencesBelong(client, references, businessId);
          return query(scoped);
        },
      },
    },
  });
}

type ExtendedClient = ReturnType<typeof extendWithScope>;
type RawDelegates = Pick<ExtendedClient, Exclude<keyof ExtendedClient, `$${string}`>>;
type WithoutCreate<Delegate> = Omit<Delegate, 'create' | 'createMany' | 'createManyAndReturn' | 'upsert'>;

type TenantDelegate<Key extends keyof RawDelegates, Row, Checked, Unchecked, Many> = WithoutCreate<RawDelegates[Key]> & {
  create(args: { data: Omit<Checked, 'business'> | Omit<Unchecked, 'businessId'> }): Prisma.PrismaPromise<Row>;
  createMany(args: { data: Omit<Many, 'businessId'>[]; skipDuplicates?: boolean }): Prisma.PrismaPromise<Prisma.BatchPayload>;
};

type ModelDelegates = {
  business: WithoutCreate<RawDelegates['business']>;
  location: TenantDelegate<'location', Location, Prisma.LocationCreateInput, Prisma.LocationUncheckedCreateInput, Prisma.LocationCreateManyInput>;
  businessChannel: TenantDelegate<'businessChannel', BusinessChannel, Prisma.BusinessChannelCreateInput, Prisma.BusinessChannelUncheckedCreateInput, Prisma.BusinessChannelCreateManyInput>;
  service: TenantDelegate<'service', Service, Prisma.ServiceCreateInput, Prisma.ServiceUncheckedCreateInput, Prisma.ServiceCreateManyInput>;
  professional: TenantDelegate<'professional', Professional, Prisma.ProfessionalCreateInput, Prisma.ProfessionalUncheckedCreateInput, Prisma.ProfessionalCreateManyInput>;
  availabilityRule: TenantDelegate<'availabilityRule', AvailabilityRule, Prisma.AvailabilityRuleCreateInput, Prisma.AvailabilityRuleUncheckedCreateInput, Prisma.AvailabilityRuleCreateManyInput>;
  availabilityOverride: TenantDelegate<'availabilityOverride', AvailabilityOverride, Prisma.AvailabilityOverrideCreateInput, Prisma.AvailabilityOverrideUncheckedCreateInput, Prisma.AvailabilityOverrideCreateManyInput>;
  calendarConnection: TenantDelegate<'calendarConnection', CalendarConnection, Prisma.CalendarConnectionCreateInput, Prisma.CalendarConnectionUncheckedCreateInput, Prisma.CalendarConnectionCreateManyInput>;
  faqEntry: TenantDelegate<'faqEntry', FaqEntry, Prisma.FaqEntryCreateInput, Prisma.FaqEntryUncheckedCreateInput, Prisma.FaqEntryCreateManyInput>;
  contact: TenantDelegate<'contact', Contact, Prisma.ContactCreateInput, Prisma.ContactUncheckedCreateInput, Prisma.ContactCreateManyInput>;
  contactIdentity: TenantDelegate<'contactIdentity', ContactIdentity, Prisma.ContactIdentityCreateInput, Prisma.ContactIdentityUncheckedCreateInput, Prisma.ContactIdentityCreateManyInput>;
  conversation: TenantDelegate<'conversation', Conversation, Prisma.ConversationCreateInput, Prisma.ConversationUncheckedCreateInput, Prisma.ConversationCreateManyInput>;
  message: TenantDelegate<'message', Message, Prisma.MessageCreateInput, Prisma.MessageUncheckedCreateInput, Prisma.MessageCreateManyInput>;
  appointment: TenantDelegate<'appointment', Appointment, Prisma.AppointmentCreateInput, Prisma.AppointmentUncheckedCreateInput, Prisma.AppointmentCreateManyInput>;
  agentUsage: TenantDelegate<'agentUsage', AgentUsage, Prisma.AgentUsageCreateInput, Prisma.AgentUsageUncheckedCreateInput, Prisma.AgentUsageCreateManyInput>;
  knowledgeSection: TenantDelegate<'knowledgeSection', KnowledgeSection, Prisma.KnowledgeSectionCreateInput, Prisma.KnowledgeSectionUncheckedCreateInput, Prisma.KnowledgeSectionCreateManyInput>;
};

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

export type BusinessScope = ModelDelegates & {
  $transaction<R>(callback: (tx: ModelDelegates) => Promise<R>, options?: TransactionOptions): Promise<R>;
  $transaction<const Queries extends readonly Prisma.PrismaPromise<unknown>[]>(
    queries: Queries,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<{ -readonly [Index in keyof Queries]: Awaited<Queries[Index]> }>;
};

function guard(client: object): object {
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property === 'symbol') {
        return Reflect.get(client, property);
      }
      if (property === '$transaction') {
        const transaction: unknown = Reflect.get(client, property);
        return (arg: unknown, options?: unknown) => {
          const wrapped = typeof arg === 'function' ? (tx: object) => arg(guard(tx)) : arg;
          return Reflect.apply(transaction as (...parameters: unknown[]) => unknown, client, [wrapped, options]);
        };
      }
      if (property.startsWith('$') || property.startsWith('_')) {
        return undefined;
      }
      return Reflect.get(client, property);
    },
    has(_target, property) {
      if (typeof property === 'string' && (property.startsWith('$') || property.startsWith('_'))) {
        return property === '$transaction';
      }
      return Reflect.has(client, property);
    },
  });
}

export function createBusinessScope(client: PrismaClient, businessId: string): BusinessScope {
  assertUuid(businessId);
  return guard(extendWithScope(client, businessId)) as BusinessScope;
}

