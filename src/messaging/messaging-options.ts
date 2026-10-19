export interface MessagingOptions {
  burstWaitMs: number;
  burstMaxWaitMs: number;
  contactMessagesPerWindow: number;
  contactWindowSeconds: number;
}

export const MESSAGING_OPTIONS = Symbol('MESSAGING_OPTIONS');
