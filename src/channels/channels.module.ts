import { Module } from '@nestjs/common';
import { Bot } from 'grammy';
import { loadEnv } from '../config/env';
import { CHANNEL_ADAPTERS } from './channel-adapter';
import { ChannelRegistry } from './channel-registry';
import { TELEGRAM_BOT, TelegramAdapter } from './telegram/telegram.adapter';

@Module({
  providers: [
    { provide: TELEGRAM_BOT, useFactory: () => new Bot(loadEnv().TELEGRAM_BOT_TOKEN) },
    TelegramAdapter,
    { provide: CHANNEL_ADAPTERS, useFactory: (telegram: TelegramAdapter) => [telegram], inject: [TelegramAdapter] },
    ChannelRegistry,
  ],
  exports: [ChannelRegistry],
})
export class ChannelsModule {}
