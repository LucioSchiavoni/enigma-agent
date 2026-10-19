import { z } from 'zod';

export const agentConfigSchema = z.object({
  assistantName: z.string().trim().min(1).max(60).default('Asistente virtual'),
  tone: z.string().trim().min(1).max(200).default('cercano, claro y profesional'),
  businessDescription: z.string().trim().max(1000).optional(),
  extraInstructions: z.string().trim().max(2000).optional(),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function parseAgentConfig(raw: unknown): { config: AgentConfig; valid: boolean } {
  const result = agentConfigSchema.safeParse(raw ?? {});
  if (result.success) {
    return { config: result.data, valid: true };
  }
  return { config: agentConfigSchema.parse({}), valid: false };
}
