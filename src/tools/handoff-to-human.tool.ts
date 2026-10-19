import { z } from 'zod';
import { AgentTool, ToolContext } from './agent-tool';

export const handoffReasons = [
  'user_request',
  'booking_request',
  'complaint',
  'urgent',
  'out_of_scope',
  'other',
] as const;

const inputSchema = z.object({
  reason: z.enum(handoffReasons),
});

export const handoffToHumanTool: AgentTool<typeof inputSchema> = {
  name: 'handoff_to_human',
  description:
    'Deriva la conversación a una persona del equipo. Tras usarla, el asistente deja de responder en esta conversación. Motivos: user_request (lo pide la persona), booking_request (quiere agendar, mover o cancelar una cita), complaint (queja), urgent (urgencia o dolor intenso), out_of_scope (fuera de lo que puedes resolver), other.',
  inputSchema,
  async execute(input, context: ToolContext) {
    const updated = await context.scope.conversation.updateMany({
      where: { id: context.conversationId, status: 'OPEN' },
      data: { status: 'HANDED_OFF' },
    });
    return { status: 'handed_off', reason: input.reason, changed: updated.count > 0 };
  },
};
