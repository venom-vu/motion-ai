import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { STORAGE_PORT, type StoragePort } from '../../ports/index.js';
import { AlertService } from './alert.service.js';
import { childEnv, execFileRunner, pgConnectionFromUrl, type CommandRunner } from './backup-pg.js';
import { SettingsService } from './settings.service.js';

export const BACKUP_RUNNER = Symbol('BACKUP_RUNNER');
export const BACKUP_PREFIX = 'db-backup/';
export const BACKUP_KEEP = 7;
export const BACKUP_STALE_MS = 36 * 3600_000;
export const BACKUP_SCAN_INTERVAL_MS = 30_000;

export type BackupStep = 'dump' | 'verify' | 'upload' | 'confirm' | 'retention';

export interface BackupResult {
  ok: boolean;
  step?: BackupStep;
  key?: string;
  sizeBytes?: number;
}

class StepError extends Error {
  constructor(readonly step: BackupStep) {
    super(`backup:${step}`);
  }
}

export const BACKUP_KEY_RE = /^db-backup\/\d{8}T\d{6}Z\.dump$/;

/** Khóa sắp theo thời gian: db-backup/20261111T030000Z.dump */
export function backupKey(now: Date): string {
  return `${BACKUP_PREFIX}${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.dump`;
}

/** Sao lưu PostgreSQL lên R2 (AR22). Chỉ chạy ở tiến trình worker. */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private running = false;
  private scanning = false;
  private readonly runner: CommandRunner;

  constructor(
    private readonly settings: SettingsService,
    private readonly alerts: AlertService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Optional() @Inject(BACKUP_RUNNER) runner?: CommandRunner,
  ) {
    this.runner = runner ?? execFileRunner;
  }

  @Cron('0 3 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async scheduledBackup(): Promise<void> {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    await this.backup();
  }

  @Interval(BACKUP_SCAN_INTERVAL_MS)
  async scheduledStaleCheck(): Promise<void> {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    await this.checkStale();
  }

  /** Một lần sao lưu; không ném lỗi, không chạy chồng. */
  async backup(now = new Date()): Promise<BackupResult> {
    if (this.running) return { ok: false };
    this.running = true;
    let dir: string | undefined;
    try {
      dir = await mkdtemp(path.join(tmpdir(), 'flowvis-backup-'));
      return await this.run(dir, now);
    } catch (err) {
      const step: BackupStep = err instanceof StepError ? err.step : 'dump';
      this.logger.error(`Sao lưu thất bại ở bước ${step}`);
      await this.fail(step, now);
      return { ok: false, step };
    } finally {
      this.running = false;
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async run(dir: string, now: Date): Promise<BackupResult> {
    const file = path.join(dir, 'db.dump');
    let env: NodeJS.ProcessEnv;
    try {
      const conn = pgConnectionFromUrl(process.env.DATABASE_URL);
      env = childEnv(conn.env);
      await this.runner(
        'pg_dump',
        ['--format=custom', `--file=${file}`, `--dbname=${conn.database}`],
        env,
      );
    } catch {
      throw new StepError('dump');
    }
    let size: number;
    try {
      size = (await stat(file)).size;
      if (size <= 0) throw new Error('empty');
      await this.runner('pg_restore', ['--list', file], env);
    } catch {
      throw new StepError('verify');
    }
    const key = backupKey(now);
    try {
      await this.storage.putObject(key, await readFile(file), 'application/octet-stream');
    } catch {
      throw new StepError('upload');
    }
    try {
      const head = await this.storage.head(key);
      if (!head || head.sizeBytes !== size) throw new Error('mismatch');
    } catch {
      throw new StepError('confirm');
    }
    await this.settings.saveLastBackup({ at: now.toISOString(), result: 'success', sizeBytes: size });
    try {
      const existing = (await this.storage.list(BACKUP_PREFIX)).map((i) => i.key).filter((k) => BACKUP_KEY_RE.test(k));
      const ordered = [...new Set([key, ...existing])].sort().reverse();
      for (const k of ordered.slice(BACKUP_KEEP)) if (k !== key) await this.storage.delete(k);
    } catch {
      this.logger.error('Giữ 7 bản sao lưu thất bại ở bước retention');
      await this.alerts.raise(`backup_retention:${now.toISOString()}`, {
        kind: 'ops.backup_retention_failed',
        severity: 'warn',
        message: 'Sao lưu đã tải lên nhưng bước retention (xóa bản cũ) thất bại.',
        data: { step: 'retention' },
      });
    }
    return { ok: true, key, sizeBytes: size };
  }

  private async fail(step: BackupStep, now: Date): Promise<void> {
    try {
      await this.settings.saveLastBackup({ at: now.toISOString(), result: 'failed', sizeBytes: null });
    } catch (err) {
      this.logger.error(`Không ghi được last_backup: ${String(err)}`);
    }
    await this.alerts.raise(`backup_failed:${now.toISOString()}`, {
      kind: 'ops.backup_failed',
      severity: 'error',
      message: `Sao lưu PostgreSQL thất bại ở bước ${step}.`,
      data: { step },
    });
  }

  /** Cảnh báo một lần khi quá 36 giờ không có bản `success`. Không ném lỗi. */
  async checkStale(now = new Date()): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const state = await this.settings.getBackupStaleState();
      const lastOk = await this.settings.getLastBackupSuccessAt();
      let ref = lastOk;
      if (!ref) {
        if (!state.watchSince) {
          await this.settings.setBackupStaleState({ ...state, watchSince: now.toISOString() });
          return;
        }
        ref = new Date(state.watchSince);
      }
      if (now.getTime() - ref.getTime() > BACKUP_STALE_MS) {
        if (!state.alerted) {
          const raised = await this.alerts.raise(`backup_stale:${now.toISOString()}`, {
            kind: 'ops.backup_stale',
            severity: 'error',
            message: 'Quá 36 giờ chưa có bản sao lưu PostgreSQL thành công.',
            data: { lastSuccessAt: lastOk ? lastOk.toISOString() : null },
          });
          if (raised) await this.settings.setBackupStaleState({ ...state, alerted: true });
        }
      } else if (state.alerted) {
        await this.settings.setBackupStaleState({ alerted: false, watchSince: state.watchSince });
      }
    } catch (err) {
      this.logger.error(`Kiểm tra sao lưu quá hạn lỗi: ${String(err)}`);
    } finally {
      this.scanning = false;
    }
  }
}
