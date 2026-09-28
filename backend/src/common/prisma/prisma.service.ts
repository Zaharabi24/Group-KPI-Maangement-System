import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma client wrapper with soft-delete aware helpers and connection lifecycle.
 * `audit_log` is append-only at the application layer (§18): the service exposes
 * no update/delete helper for it.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query' | 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly slowQueryMs = Number(process.env.SLOW_QUERY_MS ?? 750);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit(): Promise<void> {
    if (process.env.PRISMA_QUERY_LOG === 'true') {
      this.$on('query', (e) => {
        if (e.duration >= this.slowQueryMs) {
          this.logger.warn(`slow query ${e.duration}ms: ${e.query}`);
        }
      });
    }
    this.$on('warn', (e) => this.logger.warn(e.message));
    this.$on('error', (e) => this.logger.error(e.message));

    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  /** Convenience: run a callback in a serialisable transaction. */
  async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
  }

  /** Health probe used by /health. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
