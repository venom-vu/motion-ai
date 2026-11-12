<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { definePageMeta } from '#imports';
import { useAdminAccess } from '~/composables/useAdminAccess';
import { useAdminOps } from '~/composables/useAdminOps';
import { formatNumberVi, formatVndVi } from '~/utils/catalog';
import { getPipelineLabelVi } from '~/utils/task-format';
import { ui } from '~/utils/admin-ui';
import type { BarRow, BarSeries } from '~/components/AdminBarChart.vue';

definePageMeta({ layout: 'admin' });

const { isMePending, isAdmin } = useAdminAccess();
const ops = useAdminOps();
const { stats, isStatsLoading, statsErrorVi } = ops;

/* Màu chart: 3 slot đầu bảng màu categorical (đã kiểm tra CVD trên nền #111111), gán theo thứ tự cố định. */
const SERIES_1 = '#3987e5';
const SERIES_2 = '#d95926';

const successSeries: BarSeries[] = [{ key: 'rate', labelVi: 'Tỷ lệ thành công', color: SERIES_1 }];
const successRows = computed<BarRow[]>(() =>
  (stats.value?.pipelines ?? []).map((p) => ({ labelVi: getPipelineLabelVi(p.pipeline), values: [p.successRate === null ? null : p.successRate * 100] })),
);

const timeSeries: BarSeries[] = [
  { key: 'avg', labelVi: 'Trung bình', color: SERIES_1 },
  { key: 'p95', labelVi: 'p95', color: SERIES_2 },
];
const timeRows = computed<BarRow[]>(() =>
  (stats.value?.pipelines ?? []).map((p) => ({ labelVi: getPipelineLabelVi(p.pipeline), values: [p.avgProcessingSeconds, p.p95ProcessingSeconds] })),
);

const costSeries: BarSeries[] = [
  { key: 'retail', labelVi: 'Giá lẻ', color: SERIES_1 },
  { key: 'standardPack', labelVi: 'Giá gói', color: SERIES_2 },
];
const costRows = computed<BarRow[]>(() =>
  (stats.value?.pipelines ?? []).map((p) => ({
    labelVi: getPipelineLabelVi(p.pipeline),
    values: [p.avgCostVnd?.retail ?? null, p.avgCostVnd?.standardPack ?? null],
  })),
);

const taskTotalSeries: BarSeries[] = [
  { key: 'succeeded', labelVi: 'Thành công', color: SERIES_1 },
  { key: 'failed', labelVi: 'Lỗi / hết giờ / hủy', color: SERIES_2 },
];
const taskTotalRows = computed<BarRow[]>(() =>
  (stats.value?.pipelines ?? []).map((p) => {
    const c = p.taskCounts;
    return { labelVi: getPipelineLabelVi(p.pipeline), values: [c.succeeded, c.failed + c.timed_out + c.cancelled] };
  }),
);

const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtSecs = (v: number) => `${v.toFixed(1)}s`;
const fmtVnd = (v: number) => formatVndVi(Math.round(v));
const fmtCount = (v: number) => formatNumberVi(v);

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const statsFrom = ref<string>(toLocalInput(new Date(Date.now() - 7 * 24 * 3600 * 1000)));
const statsTo = ref<string>(toLocalInput(new Date()));
const statsScope = ref<'real' | 'benchmark'>('real');
const scopeOptions = [
  { value: 'real', label: 'Thực tế (real)' },
  { value: 'benchmark', label: 'Đo thử (benchmark)' },
] as const;
const trialMotionPrice = ref<string>('');
const trialImagePrice = ref<string>('');
const statsFormErrorVi = ref<string | null>(null);

function parseTrial(raw: string, label: string): number | undefined | null {
  const v = raw.trim();
  if (v === '') return undefined;
  if (!/^\d+$/.test(v) || Number(v) <= 0) {
    statsFormErrorVi.value = `${label} phải là số nguyên dương.`;
    return null;
  }
  return Number(v);
}

async function submitStats(): Promise<void> {
  statsFormErrorVi.value = null;
  const from = new Date(statsFrom.value);
  const to = new Date(statsTo.value);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    statsFormErrorVi.value = 'Vui lòng chọn khoảng thời gian hợp lệ.';
    return;
  }
  if (to.getTime() < from.getTime()) {
    statsFormErrorVi.value = 'Thời điểm kết thúc không được sớm hơn thời điểm bắt đầu.';
    return;
  }
  const motion = parseTrial(trialMotionPrice.value, 'Giá thử mỗi giây Motion');
  const image = parseTrial(trialImagePrice.value, 'Giá thử mỗi ảnh');
  if (motion === null || image === null) return;
  await ops.fetchStats({
    from: from.toISOString(),
    to: to.toISOString(),
    scope: statsScope.value,
    motionPricePerSecond: motion,
    imagePrice: image,
  });
}

function pct(v: number | null | undefined): string {
  return v == null ? '-' : `${(v * 100).toFixed(1)}%`;
}
function secs(v: number | null | undefined): string {
  return v == null ? '-' : `${v.toFixed(1)}s`;
}

onMounted(() => {
  if (isAdmin.value) void submitStats();
});
watch(isAdmin, (admin) => {
  if (admin && !stats.value) void submitStats();
});
</script>

<template>
  <div data-testid="page-admin-stats" class="space-y-8">
    <AdminAccessGate :pending="isMePending" :admin="isAdmin">
      <header class="border-b border-[#2E2E2E] pb-6">
        <h1 :class="ui.pageTitle">Thống kê</h1>
        <p :class="ui.pageLead">Hiệu quả từng tính năng AI, chi phí GPU và biên gộp theo khoảng thời gian.</p>
      </header>

      <section class="space-y-5">
        <form data-testid="ops-stats-section" :class="ui.card" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" @submit.prevent="submitStats">
          <label :class="ui.label">
            <span>Từ</span>
            <BaseInput v-model="statsFrom" variant="admin" type="datetime-local" data-testid="ops-stats-from" />
          </label>
          <label :class="ui.label">
            <span>Đến</span>
            <BaseInput v-model="statsTo" variant="admin" type="datetime-local" data-testid="ops-stats-to" />
          </label>
          <div :class="ui.label">
            <label for="ops-stats-scope-select" class="block">Phạm vi</label>
            <BaseSelect
              id="ops-stats-scope-select"
              v-model="statsScope"
              variant="admin"
              :options="scopeOptions"
              data-testid="ops-stats-scope"
            />
          </div>
          <label :class="ui.label">
            <span>Giá thử mỗi giây Motion (credit)</span>
            <BaseInput v-model="trialMotionPrice" variant="admin" inputmode="numeric" data-testid="ops-stats-motion-price" placeholder="Để trống = giá thật" />
          </label>
          <label :class="ui.label">
            <span>Giá thử mỗi ảnh (credit)</span>
            <BaseInput v-model="trialImagePrice" variant="admin" inputmode="numeric" data-testid="ops-stats-image-price" placeholder="Để trống = giá thật" />
          </label>
          <div class="flex items-end">
            <button type="submit" data-testid="ops-stats-submit" :disabled="isStatsLoading" :class="[ui.btnPrimary, 'w-full']">
              Xem thống kê
            </button>
          </div>
          <p class="sm:col-span-2 xl:col-span-3" :class="ui.muted">Giá thử chỉ dùng để tính lại thống kê, không thay đổi giá thật.</p>
        </form>

        <p v-if="statsFormErrorVi" data-testid="ops-stats-form-error" role="alert" :class="ui.error">{{ statsFormErrorVi }}</p>
        <p v-if="statsErrorVi" data-testid="ops-stats-error" role="alert" :class="ui.error">{{ statsErrorVi }}</p>

        <template v-if="stats">
          <div class="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <div :class="ui.card" class="space-y-1">
              <p class="text-sm font-medium text-[#B4B4B4]">Đơn nạp đã duyệt</p>
              <p class="text-3xl font-semibold tracking-tight text-[#EDEDED]">{{ formatNumberVi(stats.successMetrics.approvedTopups) }}</p>
            </div>
            <div :class="ui.card" class="space-y-1">
              <p class="text-sm font-medium text-[#B4B4B4]">Tỷ lệ chuyển đổi 30 ngày</p>
              <p class="text-3xl font-semibold tracking-tight text-[#EDEDED]">{{ pct(stats.successMetrics.conversionRate) }}</p>
            </div>
            <div :class="ui.card" class="col-span-2 space-y-1 xl:col-span-1">
              <p class="text-sm font-medium text-[#B4B4B4]">Chi phí GPU</p>
              <p class="text-3xl font-semibold tracking-tight text-[#EDEDED]">{{ stats.successMetrics.gpuCostUsd.toFixed(2) }} USD</p>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div :class="ui.card">
              <AdminBarChart data-testid="stats-chart-tasks" title="Số Task theo tính năng" :series="taskTotalSeries" :rows="taskTotalRows" :format="fmtCount" />
            </div>
            <div :class="ui.card">
              <AdminBarChart data-testid="stats-chart-success" title="Tỷ lệ thành công" :series="successSeries" :rows="successRows" :format="fmtPct" :max="100" />
            </div>
            <div :class="ui.card">
              <AdminBarChart data-testid="stats-chart-time" title="Thời gian xử lý (giây)" :series="timeSeries" :rows="timeRows" :format="fmtSecs" />
            </div>
            <div :class="ui.card">
              <AdminBarChart data-testid="stats-chart-cost" title="Chi phí GPU trung bình mỗi Task" :series="costSeries" :rows="costRows" :format="fmtVnd" />
            </div>
          </div>

          <h3 class="pt-2 text-lg font-semibold text-[#EDEDED]">Bảng số liệu theo tính năng</h3>
          <div :class="ui.tableWrap">
            <table :class="ui.table" data-testid="ops-stats-pipelines">
              <thead>
                <tr>
                  <th :class="ui.th">Tính năng</th><th :class="ui.th">Thành công</th><th :class="ui.th">TB</th><th :class="ui.th">p95</th><th :class="ui.th">Phí GPU TB (lẻ)</th><th :class="ui.th">Phí GPU TB (gói)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in stats.pipelines" :key="p.pipeline">
                  <td :class="ui.td">{{ getPipelineLabelVi(p.pipeline) }}</td>
                  <td :class="ui.td">{{ pct(p.successRate) }}</td>
                  <td :class="ui.td">{{ secs(p.avgProcessingSeconds) }}</td>
                  <td :class="ui.td">{{ secs(p.p95ProcessingSeconds) }}</td>
                  <td :class="ui.td">{{ p.avgCostVnd ? formatVndVi(Math.round(p.avgCostVnd.retail)) : '-' }}</td>
                  <td :class="ui.td">{{ p.avgCostVnd ? formatVndVi(Math.round(p.avgCostVnd.standardPack)) : '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 class="pt-2 text-lg font-semibold text-[#EDEDED]">Biên gộp</h3>
          <div :class="ui.tableWrap">
            <table :class="ui.table" data-testid="ops-stats-margins">
              <thead>
                <tr><th :class="ui.th">Tính năng</th><th :class="ui.th">Gói</th><th :class="ui.th">Kịch bản</th><th :class="ui.th">Doanh thu</th><th :class="ui.th">Chi phí</th><th :class="ui.th">Biên gộp</th></tr>
              </thead>
              <tbody>
                <tr v-for="(m, i) in stats.margins" :key="i">
                  <td :class="ui.td">{{ getPipelineLabelVi(m.pipeline) }}</td>
                  <td :class="ui.td">{{ m.pack }}</td>
                  <td :class="ui.td">{{ m.scenario === 'retail' ? 'Giá lẻ' : 'Giá gói' }}</td>
                  <td :class="ui.td">{{ formatVndVi(Math.round(m.revenueVnd)) }}</td>
                  <td :class="ui.td">{{ formatVndVi(Math.round(m.costVnd)) }}</td>
                  <td :class="[ui.td, m.marginVnd < 0 ? ui.bad : '']">{{ formatNumberVi(Math.round(m.marginVnd)) }}đ ({{ pct(m.marginRate) }})</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
    </AdminAccessGate>
  </div>
</template>
