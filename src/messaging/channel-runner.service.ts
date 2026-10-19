import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ChannelRegistry } from '../channels/channel-registry';
import { InboundMessageService } from './inbound-message.service';

@Injectable()
export class ChannelRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    private readonly channels: ChannelRegistry,
    private readonly inbound: InboundMessageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const adapter of this.channels.adapters) {
      await adapter.start((message) => this.inbound.handle(message));
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const adapter of this.channels.adapters) {
      await adapter.stop();
    }
  }
}
