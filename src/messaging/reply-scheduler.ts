import { Logger } from '@nestjs/common';

interface PendingReply {
  job: () => Promise<void>;
  timer: NodeJS.Timeout | undefined;
  firstScheduledAt: number | undefined;
  tail: Promise<void>;
}

export interface ReplySchedulerOptions {
  waitMs: number;
  maxWaitMs: number;
}

export class ReplyScheduler {
  private readonly logger = new Logger(ReplyScheduler.name);
  private readonly pending = new Map<string, PendingReply>();

  constructor(private readonly options: ReplySchedulerOptions) {}

  schedule(key: string, job: () => Promise<void>): void {
    const now = Date.now();
    const entry = this.pending.get(key) ?? {
      job,
      timer: undefined,
      firstScheduledAt: undefined,
      tail: Promise.resolve(),
    };
    clearTimeout(entry.timer);
    entry.job = job;
    entry.firstScheduledAt ??= now;
    const remainingBudget = this.options.maxWaitMs - (now - entry.firstScheduledAt);
    const delay = Math.max(0, Math.min(this.options.waitMs, remainingBudget));
    entry.timer = setTimeout(() => this.fire(key), delay);
    this.pending.set(key, entry);
  }

  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending.values()].map((entry) => entry.tail));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  cancelAll(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  private fire(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) {
      return;
    }
    entry.timer = undefined;
    entry.firstScheduledAt = undefined;
    const job = entry.job;
    const run = entry.tail
      .then(job)
      .catch((error: unknown) => {
        this.logger.error(`Scheduled reply failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
      })
      .finally(() => {
        if (this.pending.get(key) === entry && entry.timer === undefined && entry.tail === run) {
          this.pending.delete(key);
        }
      });
    entry.tail = run;
  }
}
