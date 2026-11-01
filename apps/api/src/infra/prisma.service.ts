import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export { Prisma, PrismaClient };
export type PrismaTransactionClient = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL || '';
    const pool = new pg.Pool({
      connectionString,
      connectionTimeoutMillis: 2000,
    });
    pool.on('error', () => {
      // Prevent unhandled idle client error events from crashing the process
    });
    const adapter = new PrismaPg(pool, { disposeExternalPool: true });
    super({ adapter });
    this.pool = pool;
  }

  async checkHealth(): Promise<'up' | 'down'> {
    try {
      await this.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
