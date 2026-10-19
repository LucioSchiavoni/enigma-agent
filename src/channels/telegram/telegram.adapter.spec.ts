import { Bot } from 'grammy';
import type { Message, Update, UserFromGetMe } from 'grammy/types';
import { InboundMessage } from '../channel-adapter';
import { MAX_INBOUND_TEXT_LENGTH, normalizeTelegramMessage } from './normalize-telegram-message';
import { TelegramAdapter } from './telegram.adapter';
import { isValidWebhookSecret } from './webhook-secret';

const WEBHOOK_SECRET = 'webhook-secret-for-tests-0123456789';

vi.mock('../../config/env', () => ({
  loadEnv: () => ({ TELEGRAM_MODE: 'webhook', TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-for-tests-0123456789' }),
}));

const botInfo: UserFromGetMe = {
  id: 987654321,
  is_bot: true,
  first_name: 'Demo',
  username: 'demo_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

function privateMessage(overrides: Partial<Message> = {}): Message {
  return {
    message_id: 42,
    date: 1_800_000_000,
    chat: { id: 555, type: 'private', first_name: 'Ana' },
    from: { id: 555, is_bot: false, first_name: 'Ana', last_name: 'García' },
    text: 'Hola',
    ...overrides,
  } as Message;
}

describe('normalizeTelegramMessage', () => {
  it('maps a private text message to an inbound message', () => {
    expect(normalizeTelegramMessage('987654321', privateMessage())).toEqual({
      channelType: 'TELEGRAM',
      channelExternalId: '987654321',
      externalUserId: '555',
      externalMessageId: '42',
      displayName: 'Ana García',
      text: 'Hola',
      receivedAt: new Date(1_800_000_000 * 1000),
    });
  });

  it('ignores groups and bots', () => {
    expect(normalizeTelegramMessage('1', privateMessage({ chat: { id: -1, type: 'group', title: 'g' } }))).toBeNull();
    expect(normalizeTelegramMessage('1', privateMessage({ from: { id: 9, is_bot: true, first_name: 'Bot' } }))).toBeNull();
  });

  it('marks empty and non-text private messages as unsupported content', () => {
    expect(normalizeTelegramMessage('1', privateMessage({ text: '   ' }))?.text).toBeNull();
    expect(normalizeTelegramMessage('1', privateMessage({ text: undefined }))?.text).toBeNull();
  });

  it('caps the text length', () => {
    const inbound = normalizeTelegramMessage('1', privateMessage({ text: 'a'.repeat(5000) }));
    expect(inbound?.text).toHaveLength(MAX_INBOUND_TEXT_LENGTH);
  });
});

describe('isValidWebhookSecret', () => {
  it('accepts only the exact secret', () => {
    expect(isValidWebhookSecret(WEBHOOK_SECRET, WEBHOOK_SECRET)).toBe(true);
    expect(isValidWebhookSecret(WEBHOOK_SECRET, `${WEBHOOK_SECRET}x`)).toBe(false);
    expect(isValidWebhookSecret(WEBHOOK_SECRET, undefined)).toBe(false);
    expect(isValidWebhookSecret(undefined, 'anything')).toBe(false);
    expect(isValidWebhookSecret(WEBHOOK_SECRET, '')).toBe(false);
  });
});

describe('TelegramAdapter', () => {
  let bot: Bot;
  let adapter: TelegramAdapter;
  let received: InboundMessage[];
  let sent: { method: string; payload: unknown }[];

  beforeEach(async () => {
    bot = new Bot('123456:test-token', { botInfo });
    sent = [];
    bot.api.config.use(async (_previous, method, payload) => {
      sent.push({ method, payload });
      return { ok: true, result: { message_id: 1, date: 1, chat: { id: 1, type: 'private' } } } as never;
    });
    adapter = new TelegramAdapter(bot);
    received = [];
    await adapter.start(async (message) => {
      received.push(message);
    });
  });

  const update = (): Update => ({ update_id: 1, message: privateMessage() as NonNullable<Update['message']> });

  it('takes the external id from the bot info obtained on start', () => {
    expect(adapter.externalId).toBe('987654321');
  });

  it('shows the typing indicator to the telegram user id', async () => {
    await adapter.showTyping('987654321', '555');
    expect(sent).toEqual([{ method: 'sendChatAction', payload: { chat_id: 555, action: 'typing' } }]);
  });

  it('sends text to the telegram user id', async () => {
    await adapter.send('987654321', { externalUserId: '555', text: 'Hola Ana' });
    expect(sent).toEqual([{ method: 'sendMessage', payload: { chat_id: 555, text: 'Hola Ana' } }]);
  });

  it('rejects webhook updates without a valid secret token', async () => {
    expect(await adapter.handleWebhookUpdate(undefined, update())).toBe('forbidden');
    expect(await adapter.handleWebhookUpdate('wrong', update())).toBe('forbidden');
    expect(received).toEqual([]);
  });

  it('processes webhook updates carrying the secret token', async () => {
    expect(await adapter.handleWebhookUpdate(WEBHOOK_SECRET, update())).toBe('accepted');
    expect(received).toHaveLength(1);
    expect(received[0].externalUserId).toBe('555');
    expect(received[0].channelExternalId).toBe('987654321');
  });

  it('rejects malformed webhook bodies after verifying the secret', async () => {
    expect(await adapter.handleWebhookUpdate(WEBHOOK_SECRET, { nope: true })).toBe('invalid');
    expect(received).toEqual([]);
  });

  it('keeps going when the handler fails', async () => {
    const failing = new TelegramAdapter(bot);
    await failing.start(async () => {
      throw new Error('boom with patient data');
    });
    await expect(failing.handleWebhookUpdate(WEBHOOK_SECRET, update())).resolves.toBe('accepted');
  });
});
