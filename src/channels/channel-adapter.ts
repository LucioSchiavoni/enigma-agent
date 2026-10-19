import { ChannelType } from '../generated/prisma/client';

export interface InboundMessage {
  channelType: ChannelType;
  channelExternalId: string;
  externalUserId: string;
  externalMessageId: string;
  displayName: string | null;
  text: string | null;
  receivedAt: Date;
}

export interface OutboundMessage {
  externalUserId: string;
  text: string;
}

export type InboundMessageHandler = (message: InboundMessage) => Promise<void>;

export interface ChannelAdapter {
  readonly type: ChannelType;
  start(handler: InboundMessageHandler): Promise<void>;
  stop(): Promise<void>;
  send(channelExternalId: string, message: OutboundMessage): Promise<void>;
  showTyping?(channelExternalId: string, externalUserId: string): Promise<void>;
}

export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');
