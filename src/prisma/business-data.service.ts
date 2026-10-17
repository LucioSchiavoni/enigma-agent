import { Injectable } from '@nestjs/common';
import { BusinessScope, createBusinessScope } from './business-scope';
import { PrismaService } from './prisma.service';

@Injectable()
export class BusinessDataService {
  constructor(private readonly prisma: PrismaService) {}

  forBusiness(businessId: string): BusinessScope {
    return createBusinessScope(this.prisma.client, businessId);
  }
}
