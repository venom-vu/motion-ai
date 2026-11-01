import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

export async function bootstrapWorker() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  appContext.enableShutdownHooks();
  return appContext;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  void bootstrapWorker();
}
