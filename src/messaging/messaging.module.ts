import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ChannelsModule } from '../channels/channels.module';
import { loadEnv } from '../config/env';
import { ChannelRunner } from './channel-runner.service';
import { InboundMessageService } from './inbound-message.service';
import { MESSAGING_OPTIONS, MessagingOptions } from './messaging-options';

@Module({
  imports: [ChannelsModule, AgentModule],
  providers: [
    {
      provide: MESSAGING_OPTIONS,
      useFactory: (): MessagingOptions => {
        const env = loadEnv();
        return {
          burstWaitMs: env.AGENT_BURST_WAIT_MS,
          burstMaxWaitMs: env.AGENT_BURST_MAX_WAIT_MS,
          contactMessagesPerWindow: env.AGENT_CONTACT_MESSAGES_PER_WINDOW,
          contactWindowSeconds: env.AGENT_CONTACT_WINDOW_SECONDS,
        };
      },
    },
    InboundMessageService,
    ChannelRunner,
  ],
})
export class MessagingModule {}
