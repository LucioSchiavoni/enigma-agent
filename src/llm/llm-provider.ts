export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface LlmUserMessage {
  role: 'user';
  text: string;
}

export interface LlmAssistantMessage {
  role: 'assistant';
  text: string;
  toolCalls: LlmToolCall[];
  providerState?: unknown;
}

export interface LlmToolResultsMessage {
  role: 'tool';
  results: LlmToolResult[];
}

export type LlmMessage = LlmUserMessage | LlmAssistantMessage | LlmToolResultsMessage;

export interface LlmRequest {
  system: string;
  dynamicContext: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  maxOutputTokens: number;
}

export type LlmStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: LlmStopReason;
  usage: LlmUsage;
  providerState?: unknown;
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
