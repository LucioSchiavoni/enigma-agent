import { z } from 'zod';
import { BusinessScope } from '../prisma/business-scope';

export interface ToolContext {
  businessId: string;
  conversationId: string;
  contactId: string;
  scope: BusinessScope;
}

export interface AgentTool<Schema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema;
  execute(input: z.output<Schema>, context: ToolContext): Promise<unknown>;
}
