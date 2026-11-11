import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NOTIFIER_PORT, type NotifierPort } from '../../ports/index.js';
import { TasksService } from '../tasks/tasks.service.js';
import { SettingsService, type BreakerTriggerRecord } from './settings.service.js';

export const BREAKER_WINDOW_MS = 30 * 60_000;
export const BREAKER_MIN_TASKS = 20;
/** Tỷ lệ lỗi phải VƯỢT 15% (so sánh số nguyên: lỗi*100 > 15*mẫu). */
export const BREAKER_RATE_PERCENT = 15;
export const BREAKER_CONSECUTIVE = 5;

@Injectable()
export class BreakerService implements OnModuleInit {
  private readonly logger = new Logger(BreakerService.name);

  constructor(
    private readonly tasks: TasksService,
    private readonly settings: SettingsService,
    @Inject(NOTIFIER_PORT) private readonly notifier: NotifierPort,
  ) {}

  onModuleInit(): void {
    this.tasks.onTerminal(() => this.evaluate());
  }

  /** Đánh giá ngắt mạch; idempotent. Trả true nếu lần gọi này vừa kích hoạt. */
  async evaluate(): Promise<boolean> {
    // Chỉ bộ test dùng công tắc này để các suite khác không bị ngắt mạch bởi lỗi cố ý của chúng.
    if (process.env.NODE_ENV === 'test' && process.env.OPS_BREAKER_DISABLED === '1') return false;
    if (await this.settings.isIntakePaused()) return false;
    const resetAt = await this.settings.getBreakerResetAt();
    const s = await this.tasks.breakerWindowStats(BREAKER_WINDOW_MS, resetAt);
    let rule: string | null = null;
    if (s.eligible >= BREAKER_MIN_TASKS && s.systemFailures * 100 > BREAKER_RATE_PERCENT * s.eligible) {
      rule = 'ERROR_RATE_15_PERCENT_20_TASKS_30_MIN';
    } else if (s.consecutiveFailures >= BREAKER_CONSECUTIVE) {
      rule = 'CONSECUTIVE_5_SYSTEM_FAILURES';
    }
    if (!rule) return false;
    const trigger: BreakerTriggerRecord = {
      at: new Date().toISOString(),
      rule,
      metrics: {
        eligibleTasks: s.eligible,
        systemFailures: s.systemFailures,
        errorRate: s.eligible > 0 ? Number((s.systemFailures / s.eligible).toFixed(4)) : 0,
        consecutiveFailures: s.consecutiveFailures,
      },
    };
    if (!(await this.settings.pauseIntake(trigger))) return false;
    try {
      await this.notifier.notify({
        kind: 'ops.breaker_triggered',
        severity: 'error',
        message: 'Ngắt mạch đã tạm dừng nhận Task mới do lỗi hệ thống tăng cao. Admin cần kiểm tra rồi mở lại.',
        data: { rule, ...trigger.metrics },
      });
    } catch (err) {
      this.logger.error(`Không gửi được cảnh báo ngắt mạch: ${String(err)}`);
    }
    return true;
  }
}
