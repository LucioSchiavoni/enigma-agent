import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { createPrismaClient } from './create-prisma-client';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = createPrismaClient(loadEnv().DATABASE_URL);

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
