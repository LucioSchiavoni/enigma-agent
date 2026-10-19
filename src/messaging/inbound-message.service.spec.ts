import { randomUUID } from 'node:crypto';
import { AgentOptions } from '../agent/agent-options';
import { AgentUsageService } from '../agent/agent-usage.service';
import { AgentService } from '../agent/agent.service';
import { FixedReply } from '../agent/fixed-replies';
import { ChannelAdapter, InboundMessage, OutboundMessage } from '../channels/channel-adapter';
import { ChannelRegistry } from '../channels/channel-registry';
import { ChannelType } from '../generated/prisma/client';
import { BusinessDataService } from '../prisma/business-data.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScriptedLlmProvider, textResponse, toolResponse } from '../testing/scripted-llm-provider';
import { ToolRegistry } from '../tools/tool-registry';
import { InboundMessageService } from './inbound-message.service';
import { MessagingOptions } from './messaging-options';

class RecordingAdapter implements ChannelAdapter {
  readonly type = ChannelType.TELEGRAM;
  readonly sent: { channelExternalId: string; message: OutboundMessage }[] = [];
  readonly typing: string[] = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async send(channelExternalId: string, message: OutboundMessage): Promise<void> {
    this.sent.push({ channelExternalId, message });
  }

  async showTyping(_channelExternalId: string, externalUserId: string): Promise<void> {
    this.typing.push(externalUserId);
  }
}

const agentOptions: AgentOptions = {
  historyLimit: 20,
  maxToolIterations: 3,
  maxOutputTokens: 1000,
  dailyModelCallsPerBusiness: 100,
};

const messagingOptions: MessagingOptions = {
  burstWaitMs: 60,
  burstMaxWaitMs: 400,
  contactMessagesPerWindow: 6,
  contactWindowSeconds: 60,
};

describe('InboundMessageService', () => {
  const runId = randomUUID().slice(0, 8);
  const botA = `test-bot-a-${runId}`;
  const botB = `test-bot-b-${runId}`;
  let prisma: PrismaService;
  let data: BusinessDataService;
  let adapter: RecordingAdapter;
  let provider: ScriptedLlmProvider;
  let service: InboundMessageService;
  let businessAId = '';
  let businessBId = '';
  let userCounter = 0;

  function newService(options: Partial<MessagingOptions> = {}): InboundMessageService {
    const usage = new AgentUsageService(data);
    const agent = new AgentService(data, usage, new ToolRegistry(), provider, agentOptions);
    return new InboundMessageService(prisma, data, agent, new ChannelRegistry([adapter]), {
      ...messagingOptions,
      ...options,
    });
  }

  function newUser(): string {
    userCounter += 1;
    return `user-${runId}-${userCounter}`;
  }

  function inbound(externalUserId: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
      channelType: ChannelType.TELEGRAM,
      channelExternalId: botA,
      externalUserId,
      externalMessageId: randomUUID(),
      displayName: 'Ana García',
      text: 'Hola, quiero una cita',
      receivedAt: new Date(),
      ...overrides,
    };
  }

  async function messagesOf(businessId: string, externalUserId: string) {
    const scope = data.forBusiness(businessId);
    const identity = await scope.contactIdentity.findFirst({ where: { externalUserId } });
    if (!identity) {
      return [];
    }
    return scope.message.findMany({
      where: { conversation: { contactId: identity.contactId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    data = new BusinessDataService(prisma);
    adapter = new RecordingAdapter();
    provider = new ScriptedLlmProvider(() => textResponse('Respuesta del modelo'));
    service = newService();

    const a = await prisma.client.business.create({ data: { slug: `test-in-a-${runId}`, name: 'Inbound A' } });
    const b = await prisma.client.business.create({ data: { slug: `test-in-b-${runId}`, name: 'Inbound B' } });
    businessAId = a.id;
    businessBId = b.id;
    await data.forBusiness(businessAId).businessChannel.create({ data: { type: 'TELEGRAM', externalId: botA } });
    await data.forBusiness(businessBId).businessChannel.create({ data: { type: 'TELEGRAM', externalId: botB } });
    await data.forBusiness(businessAId).faqEntry.create({
      data: { question: '¿Cuál es el horario de la clínica?', answer: 'Atendemos de lunes a viernes de 9:00 a 20:00.' },
    });
  });

  afterAll(async () => {
    await service.settled();
    const ids = [businessAId, businessBId].filter((id) => id !== '');
    if (ids.length > 0) {
      await prisma.client.conversation.deleteMany({ where: { businessId: { in: ids } } });
      await prisma.client.business.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.client.$disconnect();
  });

  beforeEach(() => {
    adapter.sent.length = 0;
    adapter.typing.length = 0;
    provider.reset();
    provider.setScript(() => textResponse('Respuesta del modelo'));
  });

  it('answers a frequently asked question end to end and stores the exchange', async () => {
    provider.setScript((_request, index) =>
      index === 0
        ? toolResponse([{ name: 'search_faq', input: { query: 'horario' } }])
        : textResponse('Atendemos de lunes a viernes de 9:00 a 20:00.'),
    );
    const user = newUser();

    await service.handle(inbound(user, { text: '¿Cuál es el horario?', externalMessageId: 'faq-1' }));
    await service.settled();

    const stored = await messagesOf(businessAId, user);
    expect(stored.map((message) => [message.role, message.content])).toEqual([
      ['USER', '¿Cuál es el horario?'],
      ['ASSISTANT', 'Atendemos de lunes a viernes de 9:00 a 20:00.'],
    ]);
    expect(stored[0].externalMessageId).toBe('faq-1');
    expect(adapter.sent).toEqual([
      {
        channelExternalId: botA,
        message: { externalUserId: user, text: 'Atendemos de lunes a viernes de 9:00 a 20:00.' },
      },
    ]);
    expect(adapter.typing).toContain(user);
    expect(provider.requests).toHaveLength(2);
  });

  it('replies once to a burst of messages, using all of them', async () => {
    const user = newUser();
    const bursty = newService({ burstWaitMs: 2500, burstMaxWaitMs: 8000 });

    await Promise.all([
      bursty.handle(inbound(user, { text: 'Hola' })),
      bursty.handle(inbound(user, { text: 'Quería saber el precio' })),
    ]);
    await bursty.handle(inbound(user, { text: 'de una limpieza' }));
    await bursty.settled();

    expect(provider.requests).toHaveLength(1);
    const userTexts = provider.requests[0].messages
      .filter((message) => message.role === 'user')
      .map((message) => message.text)
      .filter((text) => !text.startsWith('[Contexto automático'));
    expect(userTexts).toHaveLength(3);
    expect(userTexts).toEqual(expect.arrayContaining(['Hola', 'Quería saber el precio', 'de una limpieza']));
    expect(adapter.sent).toHaveLength(1);

    const stored = await messagesOf(businessAId, user);
    expect(stored.map((message) => message.role)).toEqual(['USER', 'USER', 'USER', 'ASSISTANT']);
  });

  it('answers messages that arrive while a reply is being generated', async () => {
    const user = newUser();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.setScript(async (_request, index) => {
      if (index === 0) {
        await gate;
        return textResponse('Primera respuesta');
      }
      return textResponse('Segunda respuesta');
    });

    await service.handle(inbound(user, { text: 'Primera pregunta' }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await service.handle(inbound(user, { text: 'Segunda pregunta' }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    await service.settled();

    expect(adapter.sent.map((entry) => entry.message.text)).toEqual(['Primera respuesta', 'Segunda respuesta']);
    const stored = await messagesOf(businessAId, user);
    expect(stored.map((message) => [message.role, message.content])).toEqual([
      ['USER', 'Primera pregunta'],
      ['ASSISTANT', 'Primera respuesta'],
      ['USER', 'Segunda pregunta'],
      ['ASSISTANT', 'Segunda respuesta'],
    ]);
  });

  it('hands off to a human and stops replying afterwards', async () => {
    const user = newUser();
    provider.setScript((_request, index) =>
      index === 0
        ? toolResponse([{ name: 'handoff_to_human', input: { reason: 'user_request' } }])
        : textResponse('Te paso con una persona del equipo.'),
    );

    await service.handle(inbound(user, { text: 'Quiero hablar con alguien' }));
    await service.settled();
    expect(adapter.sent.map((entry) => entry.message.text)).toEqual(['Te paso con una persona del equipo.']);

    provider.reset();
    adapter.sent.length = 0;
    await service.handle(inbound(user, { text: '¿Hay alguien ahí?' }));
    await service.settled();

    expect(provider.requests).toHaveLength(0);
    expect(adapter.sent).toEqual([]);
    const scope = data.forBusiness(businessAId);
    const identity = await scope.contactIdentity.findFirstOrThrow({ where: { externalUserId: user } });
    const conversations = await scope.conversation.findMany({ where: { contactId: identity.contactId } });
    expect(conversations.map((conversation) => conversation.status)).toEqual(['HANDED_OFF']);
    expect(await scope.message.count({ where: { content: '¿Hay alguien ahí?' } })).toBe(1);
  });

  it('replies with a fixed message once when a contact exceeds the message limit, without calling the model', async () => {
    const limited = newService({ contactMessagesPerWindow: 2, burstWaitMs: 20 });
    const user = newUser();

    for (let index = 0; index < 5; index++) {
      await limited.handle(inbound(user, { text: `mensaje ${index}` }));
    }
    await limited.settled();

    const fixed = adapter.sent.filter((entry) => entry.message.text === FixedReply.contactRateLimit);
    expect(fixed).toHaveLength(1);
    expect(provider.requests.length).toBeLessThanOrEqual(2);
    const stored = await messagesOf(businessAId, user);
    expect(stored.filter((message) => message.role === 'USER')).toHaveLength(2);
  });

  it('applies the contact limit per contact', async () => {
    const limited = newService({ contactMessagesPerWindow: 1, burstWaitMs: 20 });
    const first = newUser();
    const second = newUser();

    await limited.handle(inbound(first, { text: 'uno' }));
    await limited.handle(inbound(second, { text: 'dos' }));
    await limited.settled();

    expect(adapter.sent.filter((entry) => entry.message.text === FixedReply.contactRateLimit)).toHaveLength(0);
    expect(adapter.sent).toHaveLength(2);
  });

  it('tells the user that only text messages are supported and stores nothing', async () => {
    const user = newUser();

    await service.handle(inbound(user, { text: null }));
    await service.settled();

    expect(adapter.sent).toEqual([
      { channelExternalId: botA, message: { externalUserId: user, text: FixedReply.unsupportedContent } },
    ]);
    expect(provider.requests).toHaveLength(0);
    expect(await messagesOf(businessAId, user)).toEqual([]);
  });

  it('creates a single contact, identity and conversation for simultaneous first messages', async () => {
    const user = newUser();
    const burst = newService({ contactMessagesPerWindow: 50, burstWaitMs: 30 });

    await Promise.all(
      Array.from({ length: 8 }, (_unused, index) => burst.handle(inbound(user, { text: `mensaje ${index}` }))),
    );
    await burst.settled();

    const scope = data.forBusiness(businessAId);
    const identities = await scope.contactIdentity.findMany({ where: { externalUserId: user } });
    expect(identities).toHaveLength(1);
    const contacts = await scope.contact.findMany({ where: { id: identities[0].contactId } });
    expect(contacts).toHaveLength(1);
    const conversations = await scope.conversation.findMany({ where: { contactId: identities[0].contactId } });
    expect(conversations).toHaveLength(1);
    expect(await scope.message.count({ where: { conversationId: conversations[0].id, role: 'USER' } })).toBe(8);
    expect(await scope.contact.count({ where: { displayName: 'Ana García' } })).toBeGreaterThanOrEqual(1);
  });

  it('does not leave orphan contacts after a simultaneous first message race', async () => {
    const before = await data.forBusiness(businessAId).contact.count();
    const users = [newUser(), newUser(), newUser()];
    const burst = newService({ contactMessagesPerWindow: 50, burstWaitMs: 30 });

    await Promise.all(users.flatMap((user) => [1, 2, 3, 4].map((n) => burst.handle(inbound(user, { text: `m${n}` })))));
    await burst.settled();

    const after = await data.forBusiness(businessAId).contact.count();
    expect(after - before).toBe(3);
    const orphans = await data.forBusiness(businessAId).contact.count({ where: { identities: { none: {} } } });
    expect(orphans).toBe(0);
  });

  it('ignores a duplicated delivery of the same message', async () => {
    const user = newUser();
    const message = inbound(user, { externalMessageId: 'dup-1', text: 'Mensaje repetido' });

    await service.handle(message);
    await service.handle(message);
    await service.settled();

    const stored = await messagesOf(businessAId, user);
    expect(stored.filter((entry) => entry.externalMessageId === 'dup-1')).toHaveLength(1);
    expect(adapter.sent).toHaveLength(1);
  });

  it('keeps each business isolated by the channel the message came through', async () => {
    const user = newUser();

    await service.handle(inbound(user, { channelExternalId: botB, text: 'Hola B' }));
    await service.settled();

    expect(await messagesOf(businessBId, user)).toHaveLength(2);
    expect(await messagesOf(businessAId, user)).toEqual([]);
    expect(adapter.sent.map((entry) => entry.channelExternalId)).toEqual([botB]);
  });

  it('drops messages for unknown or inactive channels and inactive businesses', async () => {
    await service.handle(inbound(newUser(), { channelExternalId: `unknown-${runId}` }));
    expect(adapter.sent).toEqual([]);

    await prisma.client.businessChannel.updateMany({ where: { externalId: botB }, data: { active: false } });
    await service.handle(inbound(newUser(), { channelExternalId: botB, text: 'Canal apagado' }));
    await prisma.client.businessChannel.updateMany({ where: { externalId: botB }, data: { active: true } });
    expect(adapter.sent).toEqual([]);

    await prisma.client.business.update({ where: { id: businessBId }, data: { active: false } });
    await service.handle(inbound(newUser(), { channelExternalId: botB, text: 'Negocio apagado' }));
    await prisma.client.business.update({ where: { id: businessBId }, data: { active: true } });
    await service.settled();
    expect(adapter.sent).toEqual([]);
    expect(provider.requests).toHaveLength(0);
  });
});
