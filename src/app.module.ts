import { Module } from '@nestjs/common';
import { MessagingModule } from './messaging/messaging.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, MessagingModule],
})
export class AppModule {}
