import 'dotenv/config';
import { z } from 'zod';

function positiveInt(fallback: number) {
  return z.coerce.number().int().positive().default(fallback);
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/)
    .optional(),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),
  AGENT_HISTORY_LIMIT: positiveInt(20),
  AGENT_MAX_TOOL_ITERATIONS: positiveInt(5),
  AGENT_MAX_OUTPUT_TOKENS: positiveInt(4096),
  AGENT_DAILY_MODEL_CALLS_PER_BUSINESS: positiveInt(500),
  AGENT_CONTACT_MESSAGES_PER_WINDOW: positiveInt(10),
  AGENT_CONTACT_WINDOW_SECONDS: positiveInt(60),
  AGENT_BURST_WAIT_MS: positiveInt(3000),
  AGENT_BURST_MAX_WAIT_MS: positiveInt(10000),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(1).optional(),
  JOBS_SECRET: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment variables: ${names.join(', ')}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function loadEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
