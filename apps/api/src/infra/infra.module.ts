import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redisService: RedisService) => ({
        connection: redisService.getWorkerConnectionOptions(),
      }),
    }),
  ],
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService, BullModule],
})
export class InfraModule {}
