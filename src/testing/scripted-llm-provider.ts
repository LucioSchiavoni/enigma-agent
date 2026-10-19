import { LlmProvider, LlmRequest, LlmResponse, LlmUsage } from '../llm/llm-provider';

export type Script = (request: LlmRequest, callIndex: number) => LlmResponse | Promise<LlmResponse>;

const usage: LlmUsage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function textResponse(text: string): LlmResponse {
  return { text, toolCalls: [], stopReason: 'end_turn', usage, providerState: [{ type: 'text', text }] };
}

export function toolResponse(calls: { name: string; input: unknown }[], text = ''): LlmResponse {
  return {
    text,
    toolCalls: calls.map((call, index) => ({ id: `call-${index}`, name: call.name, input: call.input })),
    stopReason: 'tool_use',
    usage,
  };
}

export class ScriptedLlmProvider implements LlmProvider {
  readonly requests: LlmRequest[] = [];

  constructor(private script: Script) {}

  setScript(script: Script): void {
    this.script = script;
  }

  reset(): void {
    this.requests.length = 0;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const callIndex = this.requests.length;
    this.requests.push(structuredClone(request));
    return this.script(request, callIndex);
  }
}
