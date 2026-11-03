import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

export async function bootstrapWorker(): Promise<INestApplicationContext> {
  process.env.MOTION_PROCESS_ROLE = 'worker';
  const appContext = await NestFactory.createApplicationContext(AppModule);
  appContext.enableShutdownHooks();

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
