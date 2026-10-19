import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { BusinessDataService } from '../prisma/business-data.service';

export function businessDay(now: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

@Injectable()
export class AgentUsageService {
  constructor(private readonly data: BusinessDataService) {}

  async reserveModelCall(businessId: string, timezone: string, dailyLimit: number, now = new Date()): Promise<boolean> {
    const scope = this.data.forBusiness(businessId);
    const day = businessDay(now, timezone);

    for (let attempt = 0; attempt < 2; attempt++) {
      const bumped = await scope.agentUsage.updateMany({
        where: { day, modelCalls: { lt: dailyLimit } },
        data: { modelCalls: { increment: 1 } },
      });
      if (bumped.count === 1) {
        return true;
      }
      if (await scope.agentUsage.findFirst({ where: { day } })) {
        return false;
      }
      try {
        await scope.agentUsage.create({ data: { day, modelCalls: 1 } });
        return true;
      } catch (error) {
        const raced = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!raced) {
          throw error;
        }
      }
    }
    return false;
  }

  async recordTokens(
    businessId: string,
    timezone: string,
    tokens: { inputTokens: number; outputTokens: number },
    now = new Date(),
  ): Promise<void> {
    await this.data.forBusiness(businessId).agentUsage.updateMany({
      where: { day: businessDay(now, timezone) },
      data: { inputTokens: { increment: tokens.inputTokens }, outputTokens: { increment: tokens.outputTokens } },
    });
  }
}
