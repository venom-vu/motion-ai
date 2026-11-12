import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { BackupService } from '../modules/ops/backup.service.js';

/**
 * Sao lưu thủ công một lần lên R2 (bước 5 cổng trước khi bật VietQR, Story 6.11).
 * Dùng đúng BackupService của Story 6.7. In JSON một dòng; thoát 0 thành công, 1 thất bại, 2 lỗi khởi động.
 */
async function main(): Promise<number> {
  process.env.MOTION_PROCESS_ROLE = 'script';
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const started = Date.now();
    const result = await ctx.get(BackupService).backup();
    console.log(JSON.stringify({ ...result, durationMs: Date.now() - started }));
    return result.ok ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'backup-now lỗi');
    process.exit(2);
  },
);
