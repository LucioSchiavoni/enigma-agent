import { ContactRateLimiter } from './contact-rate-limiter';
import { ReplyScheduler } from './reply-scheduler';

describe('ContactRateLimiter', () => {
  it('allows up to the limit, notifies once, then silently limits', () => {
    let now = 0;
    const limiter = new ContactRateLimiter(2, 1000, () => now);

    expect(limiter.check('a')).toBe('allowed');
    expect(limiter.check('a')).toBe('allowed');
    expect(limiter.check('a')).toBe('limited_first');
    expect(limiter.check('a')).toBe('limited');
    expect(limiter.check('b')).toBe('allowed');

    now = 1001;
    expect(limiter.check('a')).toBe('allowed');
    expect(limiter.check('a')).toBe('allowed');
    expect(limiter.check('a')).toBe('limited_first');
  });
});

describe('ReplyScheduler', () => {
  it('runs a single job after a burst, using the latest one', async () => {
    const scheduler = new ReplyScheduler({ waitMs: 40, maxWaitMs: 400 });
    const ran: string[] = [];

    scheduler.schedule('k', async () => {
      ran.push('first');
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    scheduler.schedule('k', async () => {
      ran.push('second');
    });
    await scheduler.idle();

    expect(ran).toEqual(['second']);
  });

  it('caps the total wait of a continuous burst', async () => {
    const scheduler = new ReplyScheduler({ waitMs: 80, maxWaitMs: 120 });
    const startedAt = Date.now();
    let firedAfter = 0;

    for (let index = 0; index < 6; index++) {
      scheduler.schedule('k', async () => {
        firedAfter = Date.now() - startedAt;
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await scheduler.idle();

    expect(firedAfter).toBeLessThan(320);
  });

  it('keeps jobs of different keys independent and serializes jobs of the same key', async () => {
    const scheduler = new ReplyScheduler({ waitMs: 10, maxWaitMs: 100 });
    const events: string[] = [];

    scheduler.schedule('a', async () => {
      events.push('a:start');
      await new Promise((resolve) => setTimeout(resolve, 60));
      events.push('a:end');
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    scheduler.schedule('a', async () => {
      events.push('a2:start');
    });
    scheduler.schedule('b', async () => {
      events.push('b');
    });
    await scheduler.idle();

    expect(events.indexOf('a:end')).toBeLessThan(events.indexOf('a2:start'));
    expect(events).toContain('b');
  });

  it('survives a failing job', async () => {
    const scheduler = new ReplyScheduler({ waitMs: 5, maxWaitMs: 50 });
    const ran: string[] = [];

    scheduler.schedule('k', async () => {
      throw new Error('boom');
    });
    await scheduler.idle();
    scheduler.schedule('k', async () => {
      ran.push('after');
    });
    await scheduler.idle();

    expect(ran).toEqual(['after']);
  });
});
