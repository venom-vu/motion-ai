import { Injectable } from '@nestjs/common';
import {
  TASK_PIPELINES,
  TASK_STATUSES,
  type AdminStatsMargin,
  type AdminStatsPipeline,
  type AdminStatsQuery,
  type AdminStatsResponse,
  type TaskPipeline,
} from '@flowvis/contracts';
import { AuthService } from '../auth/auth.service.js';
import { TasksService, type TaskPipelineStatsRow } from '../tasks/tasks.service.js';
import { TopupsService } from '../topups/topups.service.js';
import { PRICING_CONFIG } from '../wallet/tier.js';

const CONVERSION_DAYS = 30;

const EMPTY_ROW = (pipeline: string): TaskPipelineStatsRow => ({
  pipeline,
  counts: {},
  succeeded: 0,
  system_failed: 0,
  avg_proc: null,
  p95_proc: null,
  ok_gpu_sum: null,
  wasted_gpu: null,
  ok_seconds: null,
  all_gpu: null,
});

function positiveEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseBenchmarkEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

@Injectable()
export class AdminStatsService {
  constructor(
    private readonly tasks: TasksService,
    private readonly topups: TopupsService,
    private readonly auth: AuthService,
  ) {}

  async compute(q: AdminStatsQuery): Promise<AdminStatsResponse> {
    const usdVnd = positiveEnv('USD_VND', 25000);
    const coinsPerUsd = {
      retail: positiveEnv('RH_COINS_PER_USD_RETAIL', 1800),
      standardPack: positiveEnv('RH_COINS_PER_USD_STANDARD', 3600),
    };
    const toVnd = (coins: number, scenario: 'retail' | 'standardPack') => (coins / coinsPerUsd[scenario]) * usdVnd;

    const from = new Date(q.from);
    const to = new Date(q.to);
    const benchmark = q.scope === 'benchmark';
    const benchIds = await this.auth.findUserIdsByEmails(parseBenchmarkEmails(process.env.BENCHMARK_USER_EMAILS));

    const [rows, approvedTopups, accounts] = await Promise.all([
      this.tasks.statsByPipeline(from, to, benchIds, benchmark),
      this.topups.countApproved(from, to, benchIds, benchmark),
      this.auth.listUsersCreatedBetween(from, to, benchIds, benchmark),
    ]);

    const withTasks = await this.tasks.userIdsWithTasks(accounts.map((a) => a.id));
    const cohort = accounts.filter((a) => withTasks.has(a.id));
    const converted = await this.topups.accountsWithApprovedWithin(cohort, CONVERSION_DAYS);
    const conversionRate = cohort.length === 0 ? null : converted.size / cohort.length;

    const byPipeline = new Map(rows.map((r) => [r.pipeline, r]));
    const pipelines: AdminStatsPipeline[] = [];
    const margins: AdminStatsMargin[] = [];
    let totalGpu = 0;

    for (const pipeline of TASK_PIPELINES as readonly TaskPipeline[]) {
      const r = byPipeline.get(pipeline) ?? EMPTY_ROW(pipeline);
      totalGpu += r.all_gpu ?? 0;
      const taskCounts = Object.fromEntries(TASK_STATUSES.map((s) => [s, r.counts[s] ?? 0])) as AdminStatsPipeline['taskCounts'];
      const denom = r.succeeded + r.system_failed;
      const okGpu = r.ok_gpu_sum ?? 0;
      const hasSucceeded = r.succeeded > 0;
      const avgCoins = hasSucceeded ? okGpu / r.succeeded : null;
      pipelines.push({
        pipeline,
        taskCounts,
        successRate: denom === 0 ? null : r.succeeded / denom,
        avgProcessingSeconds: r.avg_proc,
        p95ProcessingSeconds: r.p95_proc,
        avgGpuCoins: avgCoins,
        wastedGpuCoins: r.wasted_gpu ?? 0,
        avgCostVnd:
          avgCoins === null ? null : { retail: toVnd(avgCoins, 'retail'), standardPack: toVnd(avgCoins, 'standardPack') },
      });

      // Biên gộp: chỉ khi có chi phí để tính (Task succeeded).
      if (!hasSucceeded) continue;
      const isMotion = pipeline === 'motion_control';
      let unitCoins: number;
      let unitCredits: number;
      if (isMotion) {
        const secs = r.ok_seconds ?? 0;
        if (secs <= 0) continue;
        unitCoins = okGpu / secs;
        unitCredits = q.motionPricePerSecond ?? PRICING_CONFIG.pipelines.motionControlCreditsPerSecond;
      } else {
        unitCoins = okGpu / r.succeeded;
        unitCredits =
          q.imagePrice ??
          (pipeline === 'face_swap' ? PRICING_CONFIG.pipelines.faceSwapCredits : PRICING_CONFIG.pipelines.bodyRetouchCredits);
      }
      for (const pack of PRICING_CONFIG.topupPacks) {
        const revenuePer100 = (pack.priceVnd / pack.credits) * 100;
        const revenueVnd = (revenuePer100 * unitCredits) / 100;
        for (const scenario of ['retail', 'standardPack'] as const) {
          const costVnd = toVnd(unitCoins, scenario);
          const marginVnd = revenueVnd - costVnd;
          margins.push({
            pipeline,
            pack: pack.id,
            scenario,
            revenueVnd,
            costVnd,
            marginVnd,
            marginRate: revenueVnd === 0 ? null : marginVnd / revenueVnd,
          });
        }
      }
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      scope: q.scope,
      pipelines,
      margins,
      successMetrics: {
        approvedTopups,
        conversionRate,
        gpuCostUsd: totalGpu / coinsPerUsd.retail,
      },
    };
  }
}
