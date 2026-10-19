import { Logger } from '@nestjs/common';
import { ChannelAdapter } from '../channels/channel-adapter';

const REFRESH_MS = 4000;
const logger = new Logger('TypingIndicator');

export function startTyping(adapter: ChannelAdapter, channelExternalId: string, externalUserId: string): () => void {
  const showTyping = adapter.showTyping?.bind(adapter);
  if (!showTyping) {
    return () => undefined;
  }
  const tick = () => {
    showTyping(channelExternalId, externalUserId).catch((error: unknown) => {
      logger.debug(`Typing indicator failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
    });
  };
  tick();
  const interval = setInterval(tick, REFRESH_MS);
  interval.unref();
  return () => clearInterval(interval);
}
