import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch (e) {
      this.logger.error(`Redis ping failed: ${(e as Error).message}`);
      return false;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, raw, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, raw);
    }
  }

  /** Simple fixed-window counter used by rate limiting and resend throttles. */
  async incrementWindow(key: string, ttlSeconds: number): Promise<number> {
    const tx = this.client.multi();
    tx.incr(key);
    tx.expire(key, ttlSeconds);
    const results = await tx.exec();
    const value = results?.[0]?.[1];
    return typeof value === 'number' ? value : Number(value ?? 1);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const url = process.env.REDIS_URL;
        if (url) {
          return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
        }
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: Number(process.env.REDIS_PORT || 6379),
          password: process.env.REDIS_PASSWORD || undefined,
          db: Number(process.env.REDIS_DB || 0),
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          retryStrategy: (times) => Math.min(times * 250, 5_000),
        });
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
