import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function isValidWebhookSecret(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || !received) {
    return false;
  }
  return timingSafeEqual(digest(expected), digest(received));
}
