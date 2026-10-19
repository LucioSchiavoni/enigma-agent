import { z } from 'zod';
import { AgentTool, ToolContext } from './agent-tool';

const inputSchema = z.object({}).strict();

export const listServicesTool: AgentTool<typeof inputSchema> = {
  name: 'list_services',
  description:
    'Lista los servicios activos del negocio con su duración en minutos y su precio. Úsala para cualquier pregunta sobre qué servicios hay, cuánto duran o cuánto cuestan.',
  inputSchema,
  async execute(_input, context: ToolContext) {
    const services = await context.scope.service.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return {
      services: services.map((service) => ({
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        price: service.priceCents === null ? null : { amount: service.priceCents / 100, currency: service.currency },
      })),
    };
  },
};
