import { Module } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { LlmModule } from '../llm/llm.module';
import { ToolRegistry } from '../tools/tool-registry';
import { AGENT_OPTIONS, AgentOptions } from './agent-options';
import { AgentUsageService } from './agent-usage.service';
import { AgentService } from './agent.service';

@Module({
  imports: [LlmModule],
  providers: [
    {
      provide: AGENT_OPTIONS,
      useFactory: (): AgentOptions => {
        const env = loadEnv();
        return {
          historyLimit: env.AGENT_HISTORY_LIMIT,
          maxToolIterations: env.AGENT_MAX_TOOL_ITERATIONS,
          maxOutputTokens: env.AGENT_MAX_OUTPUT_TOKENS,
          dailyModelCallsPerBusiness: env.AGENT_DAILY_MODEL_CALLS_PER_BUSINESS,
        };
      },
    },
    AgentUsageService,
    ToolRegistry,
    AgentService,
  ],
  exports: [AgentService],
})
export class AgentModule {}
