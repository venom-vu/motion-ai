import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ReconcileService } from '../modules/ops/reconcile.service.js';

/** Chạy đối soát sổ cái một lần: thoát 0 nếu không lệch, 1 nếu có lệch, 2 nếu lỗi. */
async function main(): Promise<number> {
  process.env.MOTION_PROCESS_ROLE = 'script';
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const mismatches = await ctx.get(ReconcileService).reconcile();
    if (mismatches.length > 0) {
      console.error(JSON.stringify({ status: 'mismatch', mismatches }));
      return 1;
    }
    console.log(JSON.stringify({ status: 'ok', mismatches: [] }));
    return 0;
  } finally {
    await ctx.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(2);
  },
);
