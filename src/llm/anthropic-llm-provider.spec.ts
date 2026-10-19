import Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlmProvider } from './anthropic-llm-provider';
import { LlmRequest } from './llm-provider';

function providerWith(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  const client = { messages: { create } } as unknown as Anthropic;
  return { provider: new AnthropicLlmProvider({ apiKey: 'sk-ant-test', model: 'claude-test-model', client }), create };
}

const request: LlmRequest = {
  system: 'Eres un asistente.',
  dynamicContext: 'Fecha: hoy.',
  maxOutputTokens: 512,
  tools: [
    {
      name: 'search_faq',
      description: 'Busca',
      inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] },
    },
  ],
  messages: [
    { role: 'user', text: 'Hola' },
    { role: 'assistant', text: 'Buenas', toolCalls: [] },
    { role: 'user', text: '¿Horario?' },
    { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'search_faq', input: { query: 'horario' } }] },
    { role: 'tool', results: [{ toolCallId: 't1', content: '{"matches":[]}', isError: false }] },
  ],
};

const endTurn = {
  content: [{ type: 'text', text: 'Hola ' }, { type: 'text', text: 'mundo' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: null },
};

describe('AnthropicLlmProvider', () => {
  it('converts project types into the Anthropic request format', async () => {
    const { provider, create } = providerWith(endTurn);

    await provider.complete(request);

    const sent = create.mock.calls[0][0];
    expect(sent.model).toBe('claude-test-model');
    expect(sent.max_tokens).toBe(512);
    expect(sent.system).toEqual([
      { type: 'text', text: 'Eres un asistente.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Fecha: hoy.' },
    ]);
    expect(sent.tools).toEqual([
      {
        name: 'search_faq',
        description: 'Busca',
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    ]);
    expect(sent.messages).toEqual([
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: [{ type: 'text', text: 'Buenas' }] },
      { role: 'user', content: '¿Horario?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search_faq', input: { query: 'horario' } }] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"matches":[]}', is_error: false }],
      },
    ]);
    expect(sent).not.toHaveProperty('thinking');
    expect(sent).not.toHaveProperty('tool_choice');
  });

  it('omits the dynamic block when there is no dynamic context', async () => {
    const { provider, create } = providerWith(endTurn);

    await provider.complete({ ...request, dynamicContext: '' });

    expect(create.mock.calls[0][0].system).toEqual([
      { type: 'text', text: 'Eres un asistente.', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('replays the provider state of an assistant turn untouched', async () => {
    const { provider, create } = providerWith(endTurn);
    const raw = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 't1', name: 'search_faq', input: { query: 'horario' } },
    ];

    await provider.complete({
      ...request,
      messages: [
        { role: 'user', text: 'Hola' },
        { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'search_faq', input: {} }], providerState: raw },
        { role: 'tool', results: [{ toolCallId: 't1', content: '{}', isError: false }] },
      ],
    });

    expect(create.mock.calls[0][0].messages[1]).toEqual({ role: 'assistant', content: raw });
  });

  it('skips empty assistant turns', async () => {
    const { provider, create } = providerWith(endTurn);

    await provider.complete({
      ...request,
      messages: [
        { role: 'user', text: 'Hola' },
        { role: 'assistant', text: '', toolCalls: [] },
        { role: 'user', text: 'Otra vez' },
      ],
    });

    expect(create.mock.calls[0][0].messages).toHaveLength(2);
  });

  it('maps text, usage and the stop reason back into project types', async () => {
    const { provider } = providerWith(endTurn);

    const response = await provider.complete(request);

    expect(response).toMatchObject({
      text: 'Hola mundo',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 0 },
    });
  });

  it('maps tool use blocks into tool calls and keeps the raw content as provider state', async () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Voy a mirar.' },
      { type: 'tool_use', id: 'toolu_1', name: 'list_services', input: {} },
    ];
    const { provider } = providerWith({ ...endTurn, content, stop_reason: 'tool_use' });

    const response = await provider.complete(request);

    expect(response.stopReason).toBe('tool_use');
    expect(response.text).toBe('Voy a mirar.');
    expect(response.toolCalls).toEqual([{ id: 'toolu_1', name: 'list_services', input: {} }]);
    expect(response.providerState).toEqual(content);
  });

  it.each([
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['stop_sequence', 'end_turn'],
    ['pause_turn', 'end_turn'],
  ])('maps the %s stop reason to %s', async (anthropicReason, expected) => {
    const { provider } = providerWith({ ...endTurn, stop_reason: anthropicReason });
    expect((await provider.complete(request)).stopReason).toBe(expected);
  });
});
