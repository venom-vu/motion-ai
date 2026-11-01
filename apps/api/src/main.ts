import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

export async function bootstrapApi(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const parsedPort = Number.parseInt(process.env.PORT || '3001', 10);
  const port = Number.isNaN(parsedPort) || parsedPort < 0 ? 3001 : parsedPort;
  await app.listen(port);
  return app;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  bootstrapApi().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
