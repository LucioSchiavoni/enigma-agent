import { Inject, Injectable } from '@nestjs/common';
import { ChannelType } from '../generated/prisma/client';
import { CHANNEL_ADAPTERS, ChannelAdapter } from './channel-adapter';

@Injectable()
export class ChannelRegistry {
  private readonly byType: ReadonlyMap<ChannelType, ChannelAdapter>;

  constructor(@Inject(CHANNEL_ADAPTERS) readonly adapters: readonly ChannelAdapter[]) {
    this.byType = new Map(adapters.map((adapter) => [adapter.type, adapter]));
  }

  get(type: ChannelType): ChannelAdapter {
    const adapter = this.byType.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for channel ${type}`);
    }
    return adapter;
  }
}
