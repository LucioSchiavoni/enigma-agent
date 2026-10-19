import { Module } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { AnthropicLlmProvider } from './anthropic-llm-provider';
import { LLM_PROVIDER } from './llm-provider';

@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      useFactory: () => {
        const env = loadEnv();
        return new AnthropicLlmProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
