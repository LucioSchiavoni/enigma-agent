import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { FixedReply } from '../agent/fixed-replies';
import { ChannelAdapter, InboundMessage } from '../channels/channel-adapter';
import { ChannelRegistry } from '../channels/channel-registry';
import { Prisma } from '../generated/prisma/client';
import { BusinessDataService } from '../prisma/business-data.service';
import { BusinessScope } from '../prisma/business-scope';
import { PrismaService } from '../prisma/prisma.service';
import { ContactRateLimiter } from './contact-rate-limiter';
import { MESSAGING_OPTIONS } from './messaging-options';
import type { MessagingOptions } from './messaging-options';
import { ReplyScheduler } from './reply-scheduler';
import { startTyping } from './typing-indicator';

const MAX_IDENTITY_ATTEMPTS = 3;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

interface ReplyTarget {
  businessId: string;
  conversationId: string;
  contactId: string;
  message: InboundMessage;
}

@Injectable()
export class InboundMessageService implements OnApplicationShutdown {
  private readonly logger = new Logger(InboundMessageService.name);
  private readonly scheduler: ReplyScheduler;
  private readonly rateLimiter: ContactRateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly data: BusinessDataService,
    private readonly agent: AgentService,
    private readonly channels: ChannelRegistry,
    @Inject(MESSAGING_OPTIONS) options: MessagingOptions,
  ) {
    this.scheduler = new ReplyScheduler({ waitMs: options.burstWaitMs, maxWaitMs: options.burstMaxWaitMs });
    this.rateLimiter = new ContactRateLimiter(options.contactMessagesPerWindow, options.contactWindowSeconds * 1000);
  }

  onApplicationShutdown(): void {
    this.scheduler.cancelAll();
  }

  async settled(): Promise<void> {
    await this.scheduler.idle();
  }

  async handle(message: InboundMessage): Promise<void> {
    const channel = await this.prisma.client.businessChannel.findUnique({
      where: { type_externalId: { type: message.channelType, externalId: message.channelExternalId } },
    });
    if (!channel || !channel.active) {
      this.logger.warn(`No active ${message.channelType} channel for ${message.channelExternalId}`);
      return;
    }

    const businessId = channel.businessId;
    const scope = this.data.forBusiness(businessId);
    const business = await scope.business.findFirst({ where: { active: true } });
    if (!business) {
      this.logger.warn(`Business ${businessId} is not active`);
      return;
    }

    const adapter = this.channels.get(message.channelType);
    const decision = this.rateLimiter.check(`${channel.id}:${message.externalUserId}`);
    if (decision !== 'allowed') {
      if (decision === 'limited_first') {
        this.logger.warn(`Contact rate limit reached on channel ${channel.id}`);
        await this.sendFixed(adapter, message, FixedReply.contactRateLimit);
      }
      return;
    }

    if (message.text === null) {
      await this.sendFixed(adapter, message, FixedReply.unsupportedContent);
      return;
    }

    const contactId = await this.resolveContact(scope, message);
    const conversation = await this.resolveConversation(scope, contactId, channel.id);

    const stored = await this.storeInboundMessage(scope, conversation.id, message, message.text);
    if (!stored) {
      this.logger.log(`Duplicate message ignored in conversation ${conversation.id}`);
      return;
    }
    await scope.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

    if (conversation.status !== 'OPEN') {
      this.logger.log(`Conversation ${conversation.id} is ${conversation.status}; no automatic reply`);
      return;
    }

    const target: ReplyTarget = { businessId, conversationId: conversation.id, contactId, message };
    this.scheduler.schedule(conversation.id, () => this.respond(target, adapter));
  }

  private async respond(target: ReplyTarget, adapter: ChannelAdapter): Promise<void> {
    const scope = this.data.forBusiness(target.businessId);
    const open = await scope.conversation.findFirst({ where: { id: target.conversationId, status: 'OPEN' } });
    if (!open) {
      this.logger.log(`Conversation ${target.conversationId} is no longer open; reply skipped`);
      return;
    }

    const startedAt = new Date();
    const { channelExternalId, externalUserId } = target.message;
    const stopTyping = startTyping(adapter, channelExternalId, externalUserId);
    let text: string | null;
    try {
      text = await this.agent.reply({
        businessId: target.businessId,
        conversationId: target.conversationId,
        contactId: target.contactId,
      });
    } finally {
      stopTyping();
    }
    if (text === null) {
      return;
    }

    await scope.message.create({
      data: { conversationId: target.conversationId, role: 'ASSISTANT', content: text, createdAt: startedAt },
    });
    await adapter.send(channelExternalId, { externalUserId, text });
    this.logger.log(`Replied in conversation ${target.conversationId}`);
  }

  private async sendFixed(adapter: ChannelAdapter, message: InboundMessage, text: string): Promise<void> {
    await adapter.send(message.channelExternalId, { externalUserId: message.externalUserId, text });
  }

  private async resolveContact(scope: BusinessScope, message: InboundMessage): Promise<string> {
    for (let attempt = 0; attempt < MAX_IDENTITY_ATTEMPTS; attempt++) {
      const existing = await this.findIdentity(scope, message);
      if (existing) {
        return existing.contactId;
      }

      const contact = await scope.contact.create({ data: { displayName: message.displayName } });
      try {
        await scope.contactIdentity.create({
          data: { contactId: contact.id, channel: message.channelType, externalUserId: message.externalUserId },
        });
        return contact.id;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        await scope.contact.delete({ where: { id: contact.id } });
      }
    }
    throw new Error('Could not resolve the contact identity');
  }

  private findIdentity(scope: BusinessScope, message: InboundMessage) {
    return scope.contactIdentity.findFirst({
      where: { channel: message.channelType, externalUserId: message.externalUserId },
    });
  }

  private async resolveConversation(scope: BusinessScope, contactId: string, businessChannelId: string) {
    const findActive = () =>
      scope.conversation.findFirst({
        where: { contactId, businessChannelId, status: { in: ['OPEN', 'HANDED_OFF'] } },
        orderBy: { lastMessageAt: 'desc' },
      });

    const existing = await findActive();
    if (existing) {
      return existing;
    }
    try {
      return await scope.conversation.create({ data: { contactId, businessChannelId } });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const winner = await findActive();
      if (!winner) {
        throw error;
      }
      return winner;
    }
  }

  private async storeInboundMessage(
    scope: BusinessScope,
    conversationId: string,
    message: InboundMessage,
    text: string,
  ): Promise<boolean> {
    try {
      await scope.message.create({
        data: { conversationId, role: 'USER', content: text, externalMessageId: message.externalMessageId },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }
}
