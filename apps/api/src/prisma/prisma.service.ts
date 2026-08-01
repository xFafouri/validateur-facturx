/**
 * The Prisma client as an injectable, with its lifecycle tied to Nest's.
 *
 * Connecting on module init rather than lazily on first query means a bad `DATABASE_URL` fails at
 * boot, where a deployment notices it, instead of on the first invoice a user tries to issue.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Base de données connectée.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
