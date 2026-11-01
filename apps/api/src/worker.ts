import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { RedisService } from './infra/index.js';

export async function bootstrapWorker(): Promise<INestApplicationContext> {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  appContext.enableShutdownHooks();

  const redisService = appContext.get(RedisService);
  const workerRedisOptions = redisService.getWorkerConnectionOptions();
  if (workerRedisOptions.maxRetriesPerRequest !== null) {
    await appContext.close();
    throw new Error(
      'Worker Redis connection must configure maxRetriesPerRequest: null',
    );
  }

  return appContext;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  bootstrapWorker().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
