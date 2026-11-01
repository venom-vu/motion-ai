import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { PrismaService } from './infra/prisma.service.js';
import { RedisService } from './infra/redis.service.js';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  postgres: 'up' | 'down';
  redis: 'up' | 'down';
}

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(RedisService) private readonly redisService: RedisService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getHealth(): Promise<HealthResponse> {
    const [postgres, redis] = await Promise.all([
      this.prismaService.checkHealth(),
      this.redisService.checkHealth(),
    ]);

    return {
      status: postgres === 'up' && redis === 'up' ? 'ok' : 'degraded',
      postgres,
      redis,
    };
  }
}
