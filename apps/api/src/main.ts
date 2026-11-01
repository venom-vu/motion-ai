import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

export async function bootstrapApi(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number.parseInt(process.env.PORT || '3001', 10);
  await app.listen(port);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  void bootstrapApi();
}
