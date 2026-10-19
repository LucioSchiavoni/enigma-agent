import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER } from '../llm/llm-provider';
import type { LlmMessage, LlmProvider, LlmResponse } from '../llm/llm-provider';
import { BusinessScope } from '../prisma/business-scope';
import { BusinessDataService } from '../prisma/business-data.service';
import { ToolContext } from '../tools/agent-tool';
import { ToolRegistry } from '../tools/tool-registry';
import { parseAgentConfig } from './agent-config';
import { AGENT_OPTIONS } from './agent-options';
import type { AgentOptions } from './agent-options';
import { AgentUsageService } from './agent-usage.service';
import { FixedReply } from './fixed-replies';
import { buildContactContextMessage } from './contact-context';
import { buildPromptLayers } from './system-prompt';

export interface AgentInput {
  businessId: string;
  conversationId: string;
  contactId: string;
}

type ReplyOutcome = 'answered' | 'daily_limit' | 'tool_limit' | 'refusal' | 'empty' | 'error';

interface ReplyTotals {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly data: BusinessDataService,
    private readonly usage: AgentUsageService,
    private readonly tools: ToolRegistry,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(AGENT_OPTIONS) private readonly options: AgentOptions,
  ) {}

  async reply(input: AgentInput): Promise<string | null> {
    const scope = this.data.forBusiness(input.businessId);
    const business = await scope.business.findFirst({ where: { active: true } });
    if (!business) {
      return null;
    }
    const messages = await this.loadHistory(scope, input.conversationId);
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return null;
    }

    const { config, valid } = parseAgentConfig(business.agentConfig);
    if (!valid) {
      this.logger.warn(`Business ${business.id} has an invalid agentConfig; using defaults`);
    }
    const knowledge = await scope.knowledgeSection.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }, { id: 'asc' }],
    });
    const contact = await scope.contact.findFirst({ where: { id: input.contactId } });
    const prompt = buildPromptLayers({
      business,
      config,
      knowledge,
      now: (this.options.now ?? (() => new Date()))(),
    });
    const contactContext = buildContactContextMessage(contact?.displayName ?? null);
    if (contactContext) {
      messages.unshift({ role: 'user', text: contactContext });
    }
    const context: ToolContext = {
      businessId: input.businessId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      scope,
    };

    const started = performance.now();
    const totals: ReplyTotals = { modelCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let outcome: ReplyOutcome = 'error';
    let text: string = FixedReply.technicalError;

    try {
      for (let round = 0; ; round++) {
        const allowed = await this.usage.reserveModelCall(
          business.id,
          business.timezone,
          this.options.dailyModelCallsPerBusiness,
        );
        if (!allowed) {
          outcome = 'daily_limit';
          text = FixedReply.dailyLimit;
          break;
        }

        const response = await this.llm.complete({
          system: prompt.stable,
          dynamicContext: prompt.dynamic,
          messages,
          tools: [...this.tools.definitions],
          maxOutputTokens: this.options.maxOutputTokens,
        });
        this.accumulate(totals, response);
        await this.usage.recordTokens(business.id, business.timezone, response.usage);

        if (response.stopReason === 'tool_use' && response.toolCalls.length > 0) {
          if (round >= this.options.maxToolIterations) {
            outcome = 'tool_limit';
            text = FixedReply.toolLimit;
            break;
          }
          messages.push({
            role: 'assistant',
            text: response.text,
            toolCalls: response.toolCalls,
            providerState: response.providerState,
          });
          const results = await Promise.all(response.toolCalls.map((call) => this.tools.execute(call, context)));
          messages.push({ role: 'tool', results });
          continue;
        }

        const answer = response.text.trim();
        if (response.stopReason === 'refusal') {
          outcome = 'refusal';
          text = FixedReply.refusal;
        } else if (answer.length === 0) {
          outcome = 'empty';
          text = FixedReply.emptyReply;
        } else {
          outcome = 'answered';
          text = answer;
        }
        break;
      }
    } catch (error) {
      outcome = 'error';
      text = FixedReply.technicalError;
      this.logger.error(`Model failure in conversation ${input.conversationId}: ${error instanceof Error ? error.name : 'UnknownError'}`);
    }

    this.logReply(input, outcome, totals, performance.now() - started);
    return text;
  }

  private accumulate(totals: ReplyTotals, response: LlmResponse): void {
    totals.modelCalls += 1;
    totals.inputTokens += response.usage.inputTokens;
    totals.outputTokens += response.usage.outputTokens;
    totals.cacheReadTokens += response.usage.cacheReadTokens;
    totals.cacheWriteTokens += response.usage.cacheWriteTokens;
  }

  private logReply(input: AgentInput, outcome: ReplyOutcome, totals: ReplyTotals, latencyMs: number): void {
    this.logger.log(
      `Reply conversation=${input.conversationId} outcome=${outcome} modelCalls=${totals.modelCalls} ` +
        `inputTokens=${totals.inputTokens} outputTokens=${totals.outputTokens} ` +
        `cacheReadTokens=${totals.cacheReadTokens} cacheWriteTokens=${totals.cacheWriteTokens} latencyMs=${Math.round(latencyMs)}`,
    );
  }

  private async loadHistory(scope: BusinessScope, conversationId: string): Promise<LlmMessage[]> {
    const rows = await scope.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: this.options.historyLimit,
    });
    const history: LlmMessage[] = rows.reverse().map((row): LlmMessage =>
      row.role === 'USER'
        ? { role: 'user', text: row.content }
        : { role: 'assistant', text: row.content, toolCalls: [] },
    );
    const firstUser = history.findIndex((message) => message.role === 'user');
    return firstUser === -1 ? [] : history.slice(firstUser);
  }
}
