import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { RedisOptions as BullRedisOptions } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

export interface WorkerRedisConnectionOptions
  extends BullRedisOptions,
    Omit<RedisOptions, 'family' | 'retryStrategy'> {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls?: RedisOptions['tls'];
  maxRetriesPerRequest: null;
}

export function parseRedisUrlToOptions(
  redisUrl: string,
): WorkerRedisConnectionOptions {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Invalid Redis URL protocol: ${parsed.protocol}`);
  }

  let port = 6379;
  if (parsed.port !== '') {
    if (!/^\d+$/.test(parsed.port)) {
      throw new Error(`Invalid Redis port: ${parsed.port}`);
    }
    port = Number.parseInt(parsed.port, 10);
    if (port < 1 || port > 65535) {
      throw new Error(`Redis port out of range: ${port}`);
    }
  }

  const dbPath = parsed.pathname.replace(/^\//, '');
  let db = 0;
  if (dbPath !== '') {
    if (!/^\d+$/.test(dbPath)) {
      throw new Error(`Invalid Redis db index: ${dbPath}`);
    }
    db = Number.parseInt(dbPath, 10);
    if (!Number.isInteger(db) || db < 0) {
      throw new Error(`Redis db index must be a non-negative integer: ${dbPath}`);
    }
  }

  return {
    host: parsed.hostname || 'localhost',
    port,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly redisUrl: string;
  readonly client: Redis;

  constructor() {
    this.redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL;
    const options = parseRedisUrlToOptions(this.redisUrl);
    this.client = new Redis({
      ...options,
      lazyConnect: true,
      connectTimeout: 2000,
      commandTimeout: 1500,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', () => {
      // Prevent unhandled error events from crashing the process when Redis is unreachable
    });
  }

  /**
   * Kết nối client dùng chung ở nền: giữ tiến trình worker sống, cho phép /health tái dùng kết nối,
   * và không chặn khởi động khi Redis tạm thời không với tới (ioredis tự thử lại).
   */
  onModuleInit(): void {
    this.client.connect().catch(() => {
      // Lỗi kết nối được phản ánh qua /health; ioredis tiếp tục thử lại.
    });
  }

  getWorkerConnectionOptions(): WorkerRedisConnectionOptions {
    return parseRedisUrlToOptions(this.redisUrl);
  }

  createWorkerConnection(overrides?: RedisOptions): Redis {
    const conn = new Redis({
      ...this.getWorkerConnectionOptions(),
      ...overrides,
      maxRetriesPerRequest: null,
    });
    conn.on('error', () => {
      // Handled by caller / BullMQ
    });
    return conn;
  }

  async checkHealth(): Promise<'up' | 'down'> {
    if (this.client.status === 'ready') {
      try {
        const pong = await this.client.ping();
        return pong === 'PONG' ? 'up' : 'down';
      } catch {
        // Fall through to short-timeout probe if client ping fails
      }
    }

    const probe = new Redis({
      ...this.getWorkerConnectionOptions(),
      lazyConnect: true,
      connectTimeout: 1500,
      commandTimeout: 1500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    probe.on('error', () => {
      // Ignore connection errors during health probe
    });

    try {
      await probe.connect();
      const pong = await probe.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      probe.disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'ready') {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    } else {
      this.client.disconnect();
    }
  }
}
