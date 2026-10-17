import { loadEnv } from '../src/config/env';
import { createBusinessScope } from '../src/prisma/business-scope';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

const DEMO_SLUG = 'clinica-demo';
const weekdays = [1, 2, 3, 4, 5];

const faqs = [
  {
    question: '¿Cuál es el horario de la clínica?',
    answer:
      'Atendemos de lunes a viernes. La Dra. Ruiz de 9:00 a 14:00 y de 16:00 a 20:00, y el Dr. Soler de 10:00 a 18:00.',
  },
  {
    question: '¿Dónde está la clínica?',
    answer: 'Estamos en la Calle Mayor 12, Madrid, a dos minutos de la parada de metro Sol.',
  },
  {
    question: '¿Qué formas de pago aceptan?',
    answer:
      'Aceptamos efectivo, tarjeta y transferencia. En tratamientos largos ofrecemos pago fraccionado sin intereses.',
  },
  {
    question: '¿Cómo cancelo o cambio mi cita?',
    answer: 'Puedes cancelarla o moverla por este chat hasta 24 horas antes sin ningún cargo.',
  },
  {
    question: '¿La primera consulta tiene coste?',
    answer:
      'La consulta de valoración cuesta 35 € y se descuenta del tratamiento si decides continuar con nosotros.',
  },
];

async function main(): Promise<void> {
  const client = createPrismaClient(loadEnv().DATABASE_URL);
  try {
    const existing = await client.business.findUnique({ where: { slug: DEMO_SLUG } });
    if (existing) {
      console.log(`Demo business already exists: ${existing.id}`);
      return;
    }

    const business = await client.business.create({
      data: {
        slug: DEMO_SLUG,
        name: 'Clínica Dental Demo',
        timezone: 'Europe/Madrid',
        locale: 'es-ES',
      },
    });
    const scope = createBusinessScope(client, business.id);

    const location = await scope.location.create({
      data: { name: 'Sede Centro', address: 'Calle Mayor 12, Madrid' },
    });

    const valoracion = await scope.service.create({
      data: {
        name: 'Consulta de valoración',
        description: 'Revisión inicial y plan de tratamiento',
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: 3500,
        currency: 'EUR',
      },
    });
    const limpieza = await scope.service.create({
      data: {
        name: 'Limpieza dental',
        description: 'Higiene bucal profesional',
        durationMinutes: 45,
        bufferMinutes: 10,
        priceCents: 6000,
        currency: 'EUR',
      },
    });
    const empaste = await scope.service.create({
      data: {
        name: 'Empaste',
        description: 'Tratamiento de caries con composite',
        durationMinutes: 60,
        bufferMinutes: 10,
        priceCents: 8500,
        currency: 'EUR',
      },
    });
    const blanqueamiento = await scope.service.create({
      data: {
        name: 'Blanqueamiento dental',
        description: 'Blanqueamiento profesional en clínica',
        durationMinutes: 90,
        bufferMinutes: 15,
        priceCents: 25000,
        currency: 'EUR',
      },
    });

    const ruiz = await scope.professional.create({
      data: {
        name: 'Dra. Marta Ruiz',
        services: {
          connect: [valoracion, limpieza, empaste, blanqueamiento].map((service) => ({ id: service.id })),
        },
      },
    });
    const soler = await scope.professional.create({
      data: {
        name: 'Dr. Javier Soler',
        services: { connect: [valoracion, empaste].map((service) => ({ id: service.id })) },
      },
    });

    await scope.availabilityRule.createMany({
      data: weekdays.flatMap((dayOfWeek) => [
        { professionalId: ruiz.id, locationId: location.id, dayOfWeek, startMinute: 9 * 60, endMinute: 14 * 60 },
        { professionalId: ruiz.id, locationId: location.id, dayOfWeek, startMinute: 16 * 60, endMinute: 20 * 60 },
        { professionalId: soler.id, locationId: location.id, dayOfWeek, startMinute: 10 * 60, endMinute: 18 * 60 },
      ]),
    });

    await scope.faqEntry.createMany({ data: faqs });

    await scope.businessChannel.create({
      data: {
        type: 'TELEGRAM',
        externalId: 'demo-telegram-bot',
        label: 'Telegram demo',
        locationId: location.id,
      },
    });

    console.log(`Demo business created: ${business.id}`);
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
