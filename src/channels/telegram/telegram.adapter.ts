import { Inject, Injectable, Logger } from '@nestjs/common';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { z } from 'zod';
import { loadEnv } from '../../config/env';
import { ChannelType } from '../../generated/prisma/client';
import { ChannelAdapter, InboundMessageHandler, OutboundMessage } from '../channel-adapter';
import { normalizeTelegramMessage } from './normalize-telegram-message';
import { isValidWebhookSecret } from './webhook-secret';

export const TELEGRAM_BOT = Symbol('TELEGRAM_BOT');

const webhookUpdateSchema = z.object({ update_id: z.number().int() }).loose();

export type WebhookResult = 'accepted' | 'forbidden' | 'invalid';

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? ` ${error.code}` : '';
    return `${error.name}${code}`;
  }
  return 'UnknownError';
}

@Injectable()
export class TelegramAdapter implements ChannelAdapter {
  readonly type = ChannelType.TELEGRAM;
  private readonly logger = new Logger(TelegramAdapter.name);
  private handler: InboundMessageHandler | undefined;
  private botId: string | undefined;
  private polling = false;

  constructor(@Inject(TELEGRAM_BOT) private readonly bot: Bot) {
    this.bot.on('message', async (context) => {
      const botId = this.botId;
      const handler = this.handler;
      if (!botId || !handler) {
        return;
      }
      const inbound = normalizeTelegramMessage(botId, context.message);
      if (!inbound) {
        this.logger.debug(`Ignored unsupported update ${context.update.update_id}`);
        return;
      }
      try {
        await handler(inbound);
      } catch (error) {
        this.logger.error(`Failed to process update ${context.update.update_id}: ${describeError(error)}`);
      }
    });
  }

  get externalId(): string {
    if (!this.botId) {
      throw new Error('Telegram adapter has not been started');
    }
    return this.botId;
  }

  async start(handler: InboundMessageHandler): Promise<void> {
    this.handler = handler;
    await this.bot.init();
    this.botId = String(this.bot.botInfo.id);
    const { TELEGRAM_MODE: mode } = loadEnv();
    this.logger.log(`Telegram bot ${this.botId} ready in ${mode} mode`);

    if (mode === 'polling') {
      this.polling = true;
      this.bot.start().catch((error: unknown) => {
        this.polling = false;
        this.logger.error(`Telegram polling stopped: ${describeError(error)}`);
      });
    }
  }

  async stop(): Promise<void> {
    if (this.polling) {
      this.polling = false;
      await this.bot.stop();
    }
  }

  async send(_channelExternalId: string, message: OutboundMessage): Promise<void> {
    await this.bot.api.sendMessage(Number(message.externalUserId), message.text);
  }

  async showTyping(_channelExternalId: string, externalUserId: string): Promise<void> {
    await this.bot.api.sendChatAction(Number(externalUserId), 'typing');
  }

  async handleWebhookUpdate(secretHeader: string | undefined, body: unknown): Promise<WebhookResult> {
    if (!isValidWebhookSecret(loadEnv().TELEGRAM_WEBHOOK_SECRET, secretHeader)) {
      return 'forbidden';
    }
    const parsed = webhookUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return 'invalid';
    }
    await this.bot.handleUpdate(parsed.data as Update);
    return 'accepted';
  }
}
