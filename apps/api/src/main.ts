import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

export function resolvePort(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (!/^\d+$/.test(value)) {
    return 3001;
  }
  const port = Number.parseInt(value, 10);
  return port <= 65535 ? port : 3001;
}

export async function bootstrapApi(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(resolvePort(process.env.PORT));
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
