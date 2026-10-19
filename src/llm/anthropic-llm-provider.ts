import Anthropic from '@anthropic-ai/sdk';
import {
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmStopReason,
  LlmToolCall,
  LlmToolDefinition,
} from './llm-provider';

export interface AnthropicLlmProviderOptions {
  apiKey: string;
  model: string;
  client?: Anthropic;
}

function toAnthropicTool(tool: LlmToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { type: 'object', ...tool.inputSchema },
  };
}

function toAnthropicSystem(request: LlmRequest): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
  ];
  if (request.dynamicContext.length > 0) {
    blocks.push({ type: 'text', text: request.dynamicContext });
  }
  return blocks;
}

function toAnthropicMessage(message: LlmMessage): Anthropic.MessageParam | null {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.text };
    case 'tool':
      return {
        role: 'user',
        content: message.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.toolCallId,
          content: result.content,
          is_error: result.isError,
        })),
      };
    case 'assistant': {
      if (Array.isArray(message.providerState)) {
        return { role: 'assistant', content: message.providerState as Anthropic.ContentBlockParam[] };
      }
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.text.length > 0) {
        content.push({ type: 'text', text: message.text });
      }
      for (const call of message.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      return content.length > 0 ? { role: 'assistant', content } : null;
    }
  }
}

function toStopReason(reason: Anthropic.Message['stop_reason']): LlmStopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

export class AnthropicLlmProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicLlmProviderOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxOutputTokens,
      output_config: { effort: 'low' },
      system: toAnthropicSystem(request),
      tools: request.tools.map(toAnthropicTool),
      messages: request.messages.map(toAnthropicMessage).filter((message) => message !== null),
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const toolCalls: LlmToolCall[] = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));

    return {
      text,
      toolCalls,
      stopReason: toStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      providerState: response.content,
    };
  }
}
