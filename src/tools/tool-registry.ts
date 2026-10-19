import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmToolCall, LlmToolDefinition, LlmToolResult } from '../llm/llm-provider';
import { AgentTool, ToolContext } from './agent-tool';
import { handoffToHumanTool } from './handoff-to-human.tool';
import { listServicesTool } from './list-services.tool';
import { searchFaqTool } from './search-faq.tool';

function toDefinition(tool: AgentTool): LlmToolDefinition {
  const { $schema: _schema, ...inputSchema } = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, inputSchema };
}

@Injectable()
export class ToolRegistry {
  private readonly tools: ReadonlyMap<string, AgentTool>;
  readonly definitions: readonly LlmToolDefinition[];

  constructor() {
    const tools: AgentTool[] = [handoffToHumanTool, listServicesTool, searchFaqTool];
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.definitions = [...tools].sort((a, b) => a.name.localeCompare(b.name)).map(toDefinition);
  }

  async execute(call: LlmToolCall, context: ToolContext): Promise<LlmToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { toolCallId: call.id, content: 'Herramienta desconocida.', isError: true };
    }
    const input = tool.inputSchema.safeParse(call.input);
    if (!input.success) {
      return { toolCallId: call.id, content: 'Entrada inválida para la herramienta.', isError: true };
    }
    try {
      const output = await tool.execute(input.data, context);
      return { toolCallId: call.id, content: JSON.stringify(output), isError: false };
    } catch {
      return { toolCallId: call.id, content: 'La herramienta falló.', isError: true };
    }
  }
}
