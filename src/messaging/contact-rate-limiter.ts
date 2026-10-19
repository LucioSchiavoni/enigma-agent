export type RateLimitDecision = 'allowed' | 'limited_first' | 'limited';

interface Window {
  timestamps: number[];
  notified: boolean;
}

export class ContactRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly maxMessages: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitDecision {
    const current = this.now();
    const window = this.windows.get(key) ?? { timestamps: [], notified: false };
    window.timestamps = window.timestamps.filter((timestamp) => current - timestamp < this.windowMs);

    if (window.timestamps.length >= this.maxMessages) {
      this.windows.set(key, window);
      if (window.notified) {
        return 'limited';
      }
      window.notified = true;
      return 'limited_first';
    }

    window.timestamps.push(current);
    window.notified = false;
    this.windows.set(key, window);
    this.prune(current);
    return 'allowed';
  }

  private prune(current: number): void {
    if (this.windows.size < 1000) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (window.timestamps.every((timestamp) => current - timestamp >= this.windowMs)) {
        this.windows.delete(key);
      }
    }
  }
}
