import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

export function resolvePort(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (!/^\d+$/.test(value)) {
    return 3001;
  }
  const port = Number.parseInt(value, 10);
  return port <= 65535 ? port : 3001;
}

export function getAllowedOrigins(rawFrontendUrl: string | undefined): string[] {
  const raw = (rawFrontendUrl ?? '').trim() || 'http://localhost:3000';
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}

export function configureApp(app: INestApplication): INestApplication {
  app.use(cookieParser());

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Cho phép requests không có Origin (curl, server-to-server, health probes)
      if (!origin) {
        return callback(null, true);
      }
      const allowedOrigins = getAllowedOrigins(process.env.FRONTEND_URL);
      const normalized = origin.trim().replace(/\/+$/, '');
      if (allowedOrigins.includes(normalized)) {
        return callback(null, true);
      }
      // Không cấp CORS header cho domain lạ
      return callback(null, false);
    },
    credentials: true,
  });

  app.enableShutdownHooks();
  return app;
}

export async function bootstrapApi(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
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
