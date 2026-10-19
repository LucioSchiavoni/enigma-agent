import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { BusinessScope, createBusinessScope } from './business-scope';
import { createPrismaClient } from './create-prisma-client';

interface Fixture {
  businessId: string;
  contactId: string;
  serviceId: string;
  professionalId: string;
}

const startsAt = new Date('2031-03-03T09:00:00Z');
const endsAt = new Date('2031-03-03T09:30:00Z');

function forbiddenWrite(data: unknown): never {
  return data as never;
}

describe('business scope nested writes, raw access and transactions', () => {
  const runId = randomUUID().slice(0, 8);
  let client: PrismaClient;
  let scopeA: BusinessScope;
  let a: Fixture;
  let b: Fixture;

  async function createFixture(label: string): Promise<{ fixture: Fixture; scope: BusinessScope }> {
    const business = await client.business.create({ data: { slug: `test-${label}-${runId}`, name: `Test ${label}` } });
    const scope = createBusinessScope(client, business.id);
    const contact = await scope.contact.create({ data: { displayName: `Paciente ${label}` } });
    const service = await scope.service.create({ data: { name: `Servicio ${label}`, durationMinutes: 30 } });
    const professional = await scope.professional.create({ data: { name: `Profesional ${label}` } });
    return {
      fixture: { businessId: business.id, contactId: contact.id, serviceId: service.id, professionalId: professional.id },
      scope,
    };
  }

  beforeAll(async () => {
    client = createPrismaClient(loadEnv().DATABASE_URL);
    const first = await createFixture('wa');
    const second = await createFixture('wb');
    a = first.fixture;
    b = second.fixture;
    scopeA = first.scope;
  });

  afterAll(async () => {
    const ids = [a?.businessId, b?.businessId].filter((id): id is string => id !== undefined);
    if (ids.length > 0) {
      await client.appointment.deleteMany({ where: { businessId: { in: ids } } });
      await client.business.deleteMany({ where: { id: { in: ids } } });
    }
    await client.$disconnect();
  });

  describe('references to records of another business', () => {
    it('accepts own records through scalar keys and through connect', async () => {
      const byScalar = await scopeA.appointment.create({
        data: { contactId: a.contactId, serviceId: a.serviceId, professionalId: a.professionalId, startsAt, endsAt },
      });
      expect(byScalar.businessId).toBe(a.businessId);

      const byConnect = await scopeA.appointment.create({
        data: {
          contact: { connect: { id: a.contactId } },
          service: { connect: { id: a.serviceId } },
          professional: { connect: { id: a.professionalId } },
          startsAt: new Date('2031-03-04T09:00:00Z'),
          endsAt: new Date('2031-03-04T09:30:00Z'),
        },
      });
      expect(byConnect.businessId).toBe(a.businessId);
    });

    it('rejects an appointment pointing at a service of another business', async () => {
      await expect(
        scopeA.appointment.create({
          data: { contactId: a.contactId, serviceId: b.serviceId, professionalId: a.professionalId, startsAt, endsAt },
        }),
      ).rejects.toThrow();
      await expect(
        scopeA.appointment.create({
          data: {
            contact: { connect: { id: a.contactId } },
            service: { connect: { id: b.serviceId } },
            professional: { connect: { id: a.professionalId } },
            startsAt,
            endsAt,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects an appointment pointing at a professional of another business', async () => {
      await expect(
        scopeA.appointment.create({
          data: { contactId: a.contactId, serviceId: a.serviceId, professionalId: b.professionalId, startsAt, endsAt },
        }),
      ).rejects.toThrow();
      await expect(
        scopeA.appointment.create({
          data: {
            contact: { connect: { id: a.contactId } },
            service: { connect: { id: a.serviceId } },
            professional: { connect: { id: b.professionalId } },
            startsAt,
            endsAt,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects re-pointing an existing appointment to another business', async () => {
      const appointment = await scopeA.appointment.findFirstOrThrow({ where: { serviceId: a.serviceId } });
      await expect(
        scopeA.appointment.update({ where: { id: appointment.id }, data: { serviceId: b.serviceId } }),
      ).rejects.toThrow();
      await expect(
        scopeA.appointment.update({
          where: { id: appointment.id },
          data: { professional: { connect: { id: b.professionalId } } },
        }),
      ).rejects.toThrow();
      await expect(
        scopeA.appointment.updateMany({ where: { id: appointment.id }, data: { contactId: b.contactId } }),
      ).rejects.toThrow();

      const unchanged = await client.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      expect(unchanged.serviceId).toBe(a.serviceId);
      expect(unchanged.professionalId).toBe(a.professionalId);
      expect(unchanged.contactId).toBe(a.contactId);
    });

    it('rejects connect and set on many-to-many relations with records of another business', async () => {
      await expect(
        scopeA.professional.update({
          where: { id: a.professionalId },
          data: { services: { connect: [{ id: b.serviceId }] } },
        }),
      ).rejects.toThrow();
      await expect(
        scopeA.professional.update({
          where: { id: a.professionalId },
          data: { services: { set: [{ id: b.serviceId }] } },
        }),
      ).rejects.toThrow();
      await expect(
        scopeA.service.update({
          where: { id: a.serviceId },
          data: { professionals: { connect: { id: b.professionalId } } },
        }),
      ).rejects.toThrow();

      const crossLinks = await client.professional.findMany({
        where: { id: { in: [a.professionalId, b.professionalId] }, services: { some: {} } },
      });
      expect(crossLinks).toEqual([]);
    });

    it('connects records of its own business on many-to-many relations', async () => {
      const updated = await scopeA.professional.update({
        where: { id: a.professionalId },
        data: { services: { connect: [{ id: a.serviceId }] } },
        include: { services: true },
      });
      expect(updated.services.map((service) => service.id)).toEqual([a.serviceId]);

      const reset = await scopeA.professional.update({
        where: { id: a.professionalId },
        data: { services: { set: [] } },
        include: { services: true },
      });
      expect(reset.services).toEqual([]);
    });

    it('rejects nested creates, connectOrCreate and other nested operations', async () => {
      const attempts: Promise<unknown>[] = [
        scopeA.professional.update({
          where: { id: a.professionalId },
          data: forbiddenWrite({ services: { connectOrCreate: { where: { id: b.serviceId }, create: { name: 'x', durationMinutes: 10 } } } }),
        }),
        scopeA.professional.update({
          where: { id: a.professionalId },
          data: forbiddenWrite({ services: { create: { name: 'x', durationMinutes: 10, businessId: b.businessId } } }),
        }),
        scopeA.professional.update({
          where: { id: a.professionalId },
          data: forbiddenWrite({ services: { delete: { id: b.serviceId } } }),
        }),
        scopeA.professional.update({
          where: { id: a.professionalId },
          data: forbiddenWrite({ business: { connect: { id: b.businessId } } }),
        }),
      ];
      for (const attempt of attempts) {
        await expect(attempt).rejects.toThrow();
      }
    });

    it('cannot move a record to another business', async () => {
      await expect(
        scopeA.service.update({ where: { id: a.serviceId }, data: { businessId: b.businessId } }),
      ).rejects.toThrow();
      await expect(
        scopeA.service.updateMany({ data: { businessId: b.businessId } }),
      ).rejects.toThrow();
      const service = await client.service.findUniqueOrThrow({ where: { id: a.serviceId } });
      expect(service.businessId).toBe(a.businessId);
    });

    it('does not support upsert or createManyAndReturn', async () => {
      const raw = scopeA as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>;
      await expect(
        raw.service.upsert({ where: { id: a.serviceId }, create: {}, update: {} }),
      ).rejects.toThrow();
      await expect(raw.service.createManyAndReturn({ data: [] })).rejects.toThrow();
    });
  });

  describe('raw access', () => {
    it('does not expose raw query methods or client internals', () => {
      const exposed = scopeA as unknown as Record<string, unknown>;
      for (const name of [
        '$queryRaw',
        '$executeRaw',
        '$queryRawUnsafe',
        '$executeRawUnsafe',
        '$runCommandRaw',
        '$extends',
        '$connect',
        '$disconnect',
        '$on',
        '$use',
        '_originalClient',
      ]) {
        expect(exposed[name]).toBeUndefined();
        expect(name in exposed).toBe(false);
      }
      expect(typeof exposed.$transaction).toBe('function');
    });

    it('does not expose raw query methods inside an interactive transaction', async () => {
      await scopeA.$transaction(async (tx) => {
        const exposed = tx as unknown as Record<string, unknown>;
        expect(exposed.$queryRaw).toBeUndefined();
        expect(exposed.$executeRaw).toBeUndefined();
        expect(exposed.$queryRawUnsafe).toBeUndefined();
        expect(exposed.$executeRawUnsafe).toBeUndefined();
      });
    });
  });

  describe('$transaction', () => {
    it('applies the filter to reads inside an interactive transaction', async () => {
      const result = await scopeA.$transaction(async (tx) => ({
        services: await tx.service.findMany(),
        byId: await tx.service.findUnique({ where: { id: b.serviceId } }),
        foreign: await tx.service.findMany({ where: { businessId: b.businessId } }),
        businesses: await tx.business.findMany(),
      }));
      expect(result.services.map((service) => service.id)).toEqual([a.serviceId]);
      expect(result.byId).toBeNull();
      expect(result.foreign.map((service) => service.id)).toEqual([a.serviceId]);
      expect(result.businesses.map((business) => business.id)).toEqual([a.businessId]);
    });

    it('applies the filter to writes inside an interactive transaction', async () => {
      const updated = await scopeA.$transaction(async (tx) => tx.service.updateMany({ where: { id: b.serviceId }, data: { name: 'hack' } }));
      expect(updated.count).toBe(0);
      const untouched = await client.service.findUniqueOrThrow({ where: { id: b.serviceId } });
      expect(untouched.name).toBe('Servicio wb');
    });

    it('validates references inside an interactive transaction and rolls back', async () => {
      const marker = `rollback-${runId}`;
      await expect(
        scopeA.$transaction(async (tx) => {
          await tx.contact.create({ data: { displayName: marker } });
          await tx.appointment.create({
            data: { contactId: a.contactId, serviceId: b.serviceId, professionalId: a.professionalId, startsAt, endsAt },
          });
        }),
      ).rejects.toThrow();
      expect(await client.contact.count({ where: { displayName: marker } })).toBe(0);
    });

    it('applies the filter to the batch form of $transaction', async () => {
      const [services, count, created] = await scopeA.$transaction([
        scopeA.service.findMany({ where: { id: b.serviceId } }),
        scopeA.service.count(),
        scopeA.contact.create({ data: { displayName: 'En lote' } }),
      ]);
      expect(services).toEqual([]);
      expect(count).toBe(1);
      expect(created.businessId).toBe(a.businessId);
    });

    it('rejects cross-business references in the batch form of $transaction', async () => {
      await expect(
        scopeA.$transaction([
          scopeA.appointment.create({
            data: { contactId: a.contactId, serviceId: b.serviceId, professionalId: a.professionalId, startsAt, endsAt },
          }),
        ]),
      ).rejects.toThrow();
    });
  });
});
