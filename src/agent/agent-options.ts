export interface AgentOptions {
  historyLimit: number;
  maxToolIterations: number;
  maxOutputTokens: number;
  dailyModelCallsPerBusiness: number;
  now?: () => Date;
}

export const AGENT_OPTIONS = Symbol('AGENT_OPTIONS');
