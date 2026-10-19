import { parseEnv } from './env';

describe('parseEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://a',
    DIRECT_URL: 'postgresql://b',
    TELEGRAM_BOT_TOKEN: '123456:abc-DEF_ghi',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    ANTHROPIC_MODEL: 'claude-haiku-5-5',
  };

  it('accepts the required variables and leaves the rest optional', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.TELEGRAM_MODE).toBe('polling');
    expect(env.TELEGRAM_WEBHOOK_SECRET).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBe('claude-haiku-5-5');
    expect(env.AGENT_MAX_TOOL_ITERATIONS).toBe(5);
    expect(env.JOBS_SECRET).toBeUndefined();
  });

  it('requires the anthropic api key', () => {
    const { ANTHROPIC_API_KEY: _removed, ...withoutKey } = base;
    expect(() => parseEnv(withoutKey)).toThrow('ANTHROPIC_API_KEY');
  });

  it('has no default model: it must come from the environment', () => {
    const { ANTHROPIC_MODEL: _removed, ...withoutModel } = base;
    expect(() => parseEnv(withoutModel)).toThrow('ANTHROPIC_MODEL');
  });

  it('lets the limits be overridden', () => {
    expect(parseEnv({ ...base, AGENT_HISTORY_LIMIT: '8' }).AGENT_HISTORY_LIMIT).toBe(8);
  });

  it('requires the telegram bot token', () => {
    const { TELEGRAM_BOT_TOKEN: _removed, ...withoutToken } = base;
    expect(() => parseEnv(withoutToken)).toThrow('TELEGRAM_BOT_TOKEN');
  });

  it('fails naming the variables without echoing values', () => {
    const attempt = () => parseEnv({ DATABASE_URL: 'secret-value', TELEGRAM_BOT_TOKEN: 'not-a-token-secret' });
    expect(attempt).toThrow('DIRECT_URL');
    expect(attempt).toThrow('TELEGRAM_BOT_TOKEN');
    expect(attempt).not.toThrow(/secret-value|not-a-token-secret/);
  });

  it('rejects weak webhook secrets', () => {
    expect(() => parseEnv({ ...base, TELEGRAM_WEBHOOK_SECRET: 'short' })).toThrow('TELEGRAM_WEBHOOK_SECRET');
    expect(parseEnv({ ...base, TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32) }).TELEGRAM_WEBHOOK_SECRET).toBeDefined();
  });
});
