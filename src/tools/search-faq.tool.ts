import { z } from 'zod';
import { AgentTool, ToolContext } from './agent-tool';

const inputSchema = z.object({
  query: z.string().trim().min(2).max(200),
});

const MAX_MATCHES = 3;
const MIN_TOKEN_LENGTH = 3;

function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

export function scoreFaq(queryTokens: readonly string[], question: string, answer: string): number {
  const questionTokens = new Set(tokenize(question));
  const answerTokens = new Set(tokenize(answer));
  let score = 0;
  for (const token of new Set(queryTokens)) {
    if (questionTokens.has(token)) {
      score += 2;
    } else if (answerTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

export const searchFaqTool: AgentTool<typeof inputSchema> = {
  name: 'search_faq',
  description:
    'Busca en las preguntas frecuentes del negocio (horarios, ubicación, formas de pago, cancelaciones, primera consulta, etc.). Recibe una consulta breve y devuelve las entradas más relevantes.',
  inputSchema,
  async execute(input, context: ToolContext) {
    const queryTokens = tokenize(input.query);
    const entries = await context.scope.faqEntry.findMany({ where: { active: true }, take: 200 });
    const matches = entries
      .map((entry) => ({ entry, score: scoreFaq(queryTokens, entry.question, entry.answer) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MATCHES)
      .map(({ entry }) => ({ question: entry.question, answer: entry.answer }));
    return { matches };
  },
};
