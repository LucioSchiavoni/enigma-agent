import type { Message } from 'grammy/types';
import { ChannelType } from '../../generated/prisma/client';
import { InboundMessage } from '../channel-adapter';

export const MAX_INBOUND_TEXT_LENGTH = 4000;

export function normalizeTelegramMessage(botId: string, message: Message): InboundMessage | null {
  const sender = message.from;
  if (message.chat.type !== 'private' || !sender || sender.is_bot) {
    return null;
  }
  const hasText = typeof message.text === 'string' && message.text.trim().length > 0;
  const displayName = [sender.first_name, sender.last_name].filter(Boolean).join(' ');
  return {
    channelType: ChannelType.TELEGRAM,
    channelExternalId: botId,
    externalUserId: String(sender.id),
    externalMessageId: String(message.message_id),
    displayName: displayName.length > 0 ? displayName : null,
    text: hasText && message.text ? message.text.slice(0, MAX_INBOUND_TEXT_LENGTH) : null,
    receivedAt: new Date(message.date * 1000),
  };
}
