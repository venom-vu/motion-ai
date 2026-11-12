<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * Biểu đồ cột ngang so sánh hạng mục (SVG thuần). Mỗi hàng có thể có nhiều series cạnh nhau.
 * Nhãn giá trị in ở cuối cột, hover/focus cột hiện tooltip; có legend khi >= 2 series.
 */
export interface BarSeries {
  key: string;
  labelVi: string;
  /** Màu theo thứ tự cố định của bảng màu chart, không theo thứ hạng. */
  color: string;
}
export interface BarRow {
  labelVi: string;
  /** Một giá trị cho mỗi series; null = không có dữ liệu. */
  values: Array<number | null>;
}

const props = withDefaults(
  defineProps<{
    title: string;
    series: BarSeries[];
    rows: BarRow[];
    format?: (v: number) => string;
    /** Giá trị lớn nhất của trục; mặc định lấy max dữ liệu. */
    max?: number;
  }>(),
  { format: (v: number) => String(v), max: undefined },
);

const BAR_H = 14;
const GAP = 4;
const ROW_PAD = 14;
const LABEL_W = 132;
const VALUE_W = 88;
const WIDTH = 640;
const plotW = WIDTH - LABEL_W - VALUE_W;

const rowH = computed(() => props.series.length * BAR_H + (props.series.length - 1) * GAP + ROW_PAD * 2);
const height = computed(() => Math.max(1, props.rows.length) * rowH.value);
const maxValue = computed(() => {
  if (props.max !== undefined) return props.max;
  const all = props.rows.flatMap((r) => r.values.filter((v): v is number => v !== null));
  return Math.max(1, ...all.map((v) => Math.abs(v)));
});

const hover = ref<{ row: number; s: number } | null>(null);
const tip = computed(() => {
  const h = hover.value;
  if (!h) return null;
  const row = props.rows[h.row];
  const v = row?.values[h.s];
  if (!row || v === undefined) return null;
  return {
    label: row.labelVi,
    series: props.series[h.s]?.labelVi ?? '',
    value: v === null ? 'Không có dữ liệu' : props.format(v),
    top: h.row * rowH.value + ROW_PAD + h.s * (BAR_H + GAP),
  };
});

function barW(v: number | null): number {
  if (v === null || v <= 0) return 0;
  return Math.max(2, (v / maxValue.value) * plotW);
}
</script>

<template>
  <figure class="admin-chart space-y-3" :aria-label="title">
    <figcaption class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-base font-semibold text-[#EDEDED]">{{ title }}</span>
      <span v-if="series.length >= 2" class="flex flex-wrap gap-4 text-sm text-[#B4B4B4]" data-testid="chart-legend">
        <span v-for="s in series" :key="s.key" class="inline-flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-sm" :style="{ background: s.color }" />
          {{ s.labelVi }}
        </span>
      </span>
    </figcaption>
    <div class="relative overflow-x-auto">
      <svg
        :viewBox="`0 0 ${WIDTH} ${height}`"
        class="block w-full min-w-[480px]"
        role="img"
        :aria-label="title"
        @pointerleave="hover = null"
      >
        <g v-for="(row, ri) in rows" :key="ri" :transform="`translate(0 ${ri * rowH})`">
          <line v-if="ri > 0" x1="0" :x2="WIDTH" y1="0" y2="0" stroke="#2C2C2A" stroke-width="1" />
          <text :x="0" :y="rowH / 2" dominant-baseline="middle" fill="#EDEDED" font-size="14">{{ row.labelVi }}</text>
          <g v-for="(v, si) in row.values" :key="si">
            <rect
              :x="LABEL_W"
              :y="ROW_PAD + si * (BAR_H + GAP) - 4"
              :width="plotW + VALUE_W"
              :height="BAR_H + 8"
              fill="transparent"
              tabindex="0"
              :aria-label="`${row.labelVi}, ${series[si]?.labelVi}: ${v === null ? 'không có dữ liệu' : format(v)}`"
              class="cursor-default outline-none"
              @pointermove="hover = { row: ri, s: si }"
              @focus="hover = { row: ri, s: si }"
              @blur="hover = null"
            />
            <rect
              :x="LABEL_W"
              :y="ROW_PAD + si * (BAR_H + GAP)"
              :width="barW(v)"
              :height="BAR_H"
              rx="2"
              :fill="series[si]?.color"
              :opacity="hover && (hover.row !== ri || hover.s !== si) ? 0.55 : 1"
              pointer-events="none"
            />
            <text
              :x="LABEL_W + barW(v) + 6"
              :y="ROW_PAD + si * (BAR_H + GAP) + BAR_H / 2"
              dominant-baseline="middle"
              fill="#B4B4B4"
              font-size="13"
              class="tabular-nums"
              pointer-events="none"
            >
              {{ v === null ? '-' : format(v) }}
            </text>
          </g>
        </g>
      </svg>
      <div
        v-if="tip"
        role="tooltip"
        class="pointer-events-none absolute right-2 z-10 rounded-md border border-[#3A3A3A] bg-[#0A0A0A] px-3 py-2 text-sm shadow-lg"
        :style="{ top: `calc(${(tip.top / height) * 100}% - 8px)` }"
      >
        <div class="font-semibold text-[#EDEDED]">{{ tip.value }}</div>
        <div class="text-[#B4B4B4]">{{ tip.label }}<template v-if="series.length >= 2"> · {{ tip.series }}</template></div>
      </div>
    </div>
  </figure>
</template>
