import { parseEnv } from './env';

describe('parseEnv', () => {
  const base = { DATABASE_URL: 'postgresql://a', DIRECT_URL: 'postgresql://b' };

  it('accepts only the database urls', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.JOBS_SECRET).toBeUndefined();
  });

  it('fails naming the missing variables without echoing values', () => {
    const attempt = () => parseEnv({ DATABASE_URL: 'secret-value' });
    expect(attempt).toThrow('DIRECT_URL');
    expect(attempt).not.toThrow(/secret-value/);
  });
});
