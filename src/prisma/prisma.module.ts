import { Global, Module } from '@nestjs/common';
import { BusinessDataService } from './business-data.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, BusinessDataService],
  exports: [PrismaService, BusinessDataService],
})
export class PrismaModule {}
