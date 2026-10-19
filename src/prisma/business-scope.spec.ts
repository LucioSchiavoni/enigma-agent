import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { createBusinessScope } from './business-scope';
import { createPrismaClient } from './create-prisma-client';

describe('business scope isolation', () => {
  const runId = randomUUID().slice(0, 8);
  let client: PrismaClient;
  let businessAId = '';
  let businessBId = '';
  let serviceBId = '';
  let contactBId = '';

  beforeAll(async () => {
    client = createPrismaClient(loadEnv().DATABASE_URL);
    const a = await client.business.create({ data: { slug: `test-a-${runId}`, name: 'Test A' } });
    businessAId = a.id;
    const b = await client.business.create({ data: { slug: `test-b-${runId}`, name: 'Test B' } });
    businessBId = b.id;

    const scopeA = createBusinessScope(client, businessAId);
    const scopeB = createBusinessScope(client, businessBId);
    await scopeA.service.create({ data: { name: 'Servicio A', durationMinutes: 30 } });
    const serviceB = await scopeB.service.create({ data: { name: 'Servicio B', durationMinutes: 30 } });
    const contactB = await scopeB.contact.create({ data: { displayName: 'Paciente B' } });
    serviceBId = serviceB.id;
    contactBId = contactB.id;
  });

  afterAll(async () => {
    const ids = [businessAId, businessBId].filter((id) => id !== '');
    if (ids.length > 0) {
      await client.business.deleteMany({ where: { id: { in: ids } } });
    }
    await client.$disconnect();
  });

  it('lists only the rows of its own business', async () => {
    const services = await createBusinessScope(client, businessAId).service.findMany();
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe('Servicio A');
    expect(services.every((service) => service.businessId === businessAId)).toBe(true);
  });

  it('cannot read another business row by id', async () => {
    const scopeA = createBusinessScope(client, businessAId);
    expect(await scopeA.service.findUnique({ where: { id: serviceBId } })).toBeNull();
    expect(await scopeA.service.findFirst({ where: { id: serviceBId } })).toBeNull();
    expect(await scopeA.contact.findMany({ where: { id: contactBId } })).toEqual([]);
    expect(await scopeA.contact.count()).toBe(0);
  });

  it('ignores an explicit businessId filter pointing at another business', async () => {
    const services = await createBusinessScope(client, businessAId).service.findMany({
      where: { businessId: businessBId },
    });
    expect(services.map((service) => service.name)).toEqual(['Servicio A']);
  });

  it('cannot modify another business row', async () => {
    const scopeA = createBusinessScope(client, businessAId);
    await expect(scopeA.service.update({ where: { id: serviceBId }, data: { name: 'hack' } })).rejects.toThrow();
    const updated = await scopeA.service.updateMany({ where: { id: serviceBId }, data: { name: 'hack' } });
    expect(updated.count).toBe(0);
    await expect(scopeA.service.delete({ where: { id: serviceBId } })).rejects.toThrow();
    const deleted = await scopeA.service.deleteMany({ where: { id: serviceBId } });
    expect(deleted.count).toBe(0);

    const untouched = await client.service.findUnique({ where: { id: serviceBId } });
    expect(untouched?.name).toBe('Servicio B');
  });

  it('forces its own businessId on create even if another one is supplied', async () => {
    const scopeA = createBusinessScope(client, businessAId);
    const forged = { displayName: 'Intruso', businessId: businessBId };
    const created = await scopeA.contact.create({ data: forged });
    expect(created.businessId).toBe(businessAId);
    const fromB = await createBusinessScope(client, businessBId).contact.findUnique({
      where: { id: created.id },
    });
    expect(fromB).toBeNull();
  });

  it('scopes the business table to itself', async () => {
    const businesses = await createBusinessScope(client, businessAId).business.findMany();
    expect(businesses.map((business) => business.id)).toEqual([businessAId]);
  });

  it('rejects a businessId that is not a uuid', () => {
    expect(() => createBusinessScope(client, 'not-a-uuid')).toThrow();
  });
});
