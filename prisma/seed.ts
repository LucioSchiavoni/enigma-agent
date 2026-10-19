import { fetchTelegramBotId } from '../src/channels/telegram/fetch-telegram-bot-id';
import { loadEnv } from '../src/config/env';
import { PrismaClient } from '../src/generated/prisma/client';
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

const knowledgeSections = [
  {
    title: 'Política de cancelación',
    content:
      'Las citas se pueden cancelar o mover sin ningún cargo hasta 24 horas antes de la hora reservada. Con menos de 24 horas de aviso, o si no se acude a la cita, la clínica puede aplicar un cargo del 50 % del precio del servicio reservado. Para cancelar o mover una cita basta con escribir por este chat.',
    sortOrder: 10,
  },
  {
    title: 'Formas de pago',
    content:
      'Se puede pagar en efectivo, con tarjeta de crédito o débito y por transferencia bancaria. En tratamientos largos se ofrece pago fraccionado sin intereses, que se acuerda con el equipo de la clínica antes de empezar. Se entrega factura de todos los servicios.',
    sortOrder: 20,
  },
  {
    title: 'Ubicación',
    content:
      'La clínica está en la Calle Mayor 12, Madrid, a dos minutos a pie de la parada de metro Sol. Hay un aparcamiento público a 150 metros. El local es accesible para sillas de ruedas y no tiene escalones en la entrada.',
    sortOrder: 30,
  },
  {
    title: 'Preparación para la primera visita',
    content:
      'Conviene llegar 10 minutos antes para completar la ficha del paciente. Hay que traer un documento de identidad, las radiografías o informes dentales anteriores si se tienen, y la lista de medicamentos que se toman y de alergias conocidas. Se recomienda cepillarse los dientes antes de venir. Los menores de edad deben venir acompañados por su madre, padre o tutor legal.',
    sortOrder: 40,
  },
];

async function syncKnowledgeSections(client: PrismaClient, businessId: string): Promise<void> {
  const scope = createBusinessScope(client, businessId);
  if ((await scope.knowledgeSection.count()) === 0) {
    await scope.knowledgeSection.createMany({ data: knowledgeSections });
  }
}

async function syncTelegramChannel(
  client: PrismaClient,
  businessId: string,
  botId: string,
  locationId?: string,
): Promise<void> {
  const scope = createBusinessScope(client, businessId);
  const channel = await scope.businessChannel.findFirst({ where: { type: 'TELEGRAM' } });
  if (!channel) {
    await scope.businessChannel.create({
      data: { type: 'TELEGRAM', externalId: botId, label: 'Telegram demo', locationId },
    });
  } else if (channel.externalId !== botId) {
    await scope.businessChannel.update({ where: { id: channel.id }, data: { externalId: botId } });
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const botId = await fetchTelegramBotId(env.TELEGRAM_BOT_TOKEN);
  const client = createPrismaClient(env.DATABASE_URL);
  try {
    const existing = await client.business.findUnique({ where: { slug: DEMO_SLUG } });
    if (existing) {
      await syncTelegramChannel(client, existing.id, botId);
      await syncKnowledgeSections(client, existing.id);
      console.log(`Demo business already exists: ${existing.id}; Telegram channel bound to bot ${botId}`);
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

    await syncKnowledgeSections(client, business.id);
    await syncTelegramChannel(client, business.id, botId, location.id);

    console.log(`Demo business created: ${business.id}`);
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
