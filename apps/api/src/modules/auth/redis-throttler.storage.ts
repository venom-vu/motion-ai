import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { RedisService } from '../../infra/redis.service.js';

/**
 * Lưu bộ đếm rate-limit trong Redis để dùng chung giữa các replica và sống qua restart.
 * Redis lỗi thì fail-open (cho qua) để không chặn đăng nhập; gate chống lạm dụng thật nằm ở DB.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;
    try {
      const blockTtl = await this.redis.client.pttl(blockKey);
      if (blockTtl > 0) {
        return { totalHits: limit + 1, timeToExpire: blockTtl, isBlocked: true, timeToBlockExpire: blockTtl };
      }
      const hits = await this.redis.client.incr(hitsKey);
      if (hits === 1) await this.redis.client.pexpire(hitsKey, ttl);
      let timeToExpire = await this.redis.client.pttl(hitsKey);
      if (timeToExpire < 0) {
        await this.redis.client.pexpire(hitsKey, ttl);
        timeToExpire = ttl;
      }
      let isBlocked = false;
      let timeToBlockExpire = 0;
      if (hits > limit) {
        isBlocked = true;
        if (blockDuration > 0) {
          await this.redis.client.set(blockKey, '1', 'PX', blockDuration);
          timeToBlockExpire = blockDuration;
        } else {
          timeToBlockExpire = timeToExpire;
        }
      }
      return { totalHits: hits, timeToExpire, isBlocked, timeToBlockExpire };
    } catch {
      return { totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
