<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * Biểu đồ cột theo ngày (SVG thuần), một series. Trục Y bắt đầu từ 0, lưới ngang mảnh;
 * crosshair bắt theo ngày gần con trỏ nhất, tooltip hiện ngày + giá trị.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    points: Array<{ date: string; count: number }>;
    color?: string;
    unitVi?: string;
  }>(),
  { color: '#3987e5', unitVi: '' },
);

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 36 };
const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

/** Bước trục đẹp (1, 2, 5 × 10^n) để có khoảng 4 vạch. */
const ticks = computed<number[]>(() => {
  const max = Math.max(1, ...props.points.map((p) => p.count));
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v));
  return out;
});
const yMax = computed(() => ticks.value[ticks.value.length - 1] || 1);
const slot = computed(() => plotW / Math.max(1, props.points.length));
const barW = computed(() => Math.max(2, slot.value * 0.7));

const y = (v: number) => PAD.top + plotH - (v / yMax.value) * plotH;
const x = (i: number) => PAD.left + i * slot.value + (slot.value - barW.value) / 2;

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/** Nhãn trục X thưa: khoảng 6 nhãn, luôn có ngày cuối. */
const xLabels = computed(() => {
  const n = props.points.length;
  const every = Math.max(1, Math.ceil(n / 6));
  return props.points
    .map((p, i) => ({ i, label: shortDate(p.date) }))
    .filter(({ i }) => (n - 1 - i) % every === 0);
});

const total = computed(() => props.points.reduce((a, p) => a + p.count, 0));

const hoverIdx = ref<number | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
function onMove(e: PointerEvent): void {
  const el = svgRef.value;
  if (!el || props.points.length === 0) return;
  const r = el.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * WIDTH - PAD.left;
  hoverIdx.value = Math.min(props.points.length - 1, Math.max(0, Math.floor(px / slot.value)));
}
const tip = computed(() => {
  const i = hoverIdx.value;
  if (i === null) return null;
  const p = props.points[i];
  if (!p) return null;
  return { date: p.date, count: p.count, leftPct: ((x(i) + barW.value / 2) / WIDTH) * 100 };
});
</script>

<template>
  <figure class="admin-chart space-y-3" :aria-label="title">
    <figcaption class="flex flex-wrap items-baseline justify-between gap-3">
      <span class="text-base font-semibold text-[#EDEDED]">{{ title }}</span>
      <span class="text-sm text-[#B4B4B4]">Tổng {{ total }}{{ unitVi ? ` ${unitVi}` : '' }}</span>
    </figcaption>
    <div class="relative">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        class="block w-full touch-pan-y"
        role="img"
        :aria-label="title"
        tabindex="0"
        @pointermove="onMove"
        @pointerleave="hoverIdx = null"
        @blur="hoverIdx = null"
        @keydown.right.prevent="hoverIdx = Math.min(points.length - 1, (hoverIdx ?? -1) + 1)"
        @keydown.left.prevent="hoverIdx = Math.max(0, (hoverIdx ?? points.length) - 1)"
      >
        <g v-for="t in ticks" :key="t">
          <line :x1="PAD.left" :x2="WIDTH - PAD.right" :y1="y(t)" :y2="y(t)" :stroke="t === 0 ? '#383835' : '#2C2C2A'" stroke-width="1" />
          <text :x="PAD.left - 6" :y="y(t)" text-anchor="end" dominant-baseline="middle" fill="#898781" font-size="12" class="tabular-nums">{{ t }}</text>
        </g>
        <rect
          v-for="(p, i) in points"
          :key="p.date"
          :x="x(i)"
          :y="y(p.count)"
          :width="barW"
          :height="Math.max(0, PAD.top + plotH - y(p.count))"
          rx="1.5"
          :fill="color"
          :opacity="hoverIdx !== null && hoverIdx !== i ? 0.55 : 1"
        />
        <line
          v-if="tip"
          :x1="(tip.leftPct / 100) * WIDTH"
          :x2="(tip.leftPct / 100) * WIDTH"
          :y1="PAD.top"
          :y2="PAD.top + plotH"
          stroke="#EDEDED"
          stroke-opacity="0.35"
          stroke-width="1"
          pointer-events="none"
        />
        <text
          v-for="l in xLabels"
          :key="l.i"
          :x="x(l.i) + barW / 2"
          :y="HEIGHT - 8"
          text-anchor="middle"
          fill="#898781"
          font-size="12"
        >
          {{ l.label }}
        </text>
      </svg>
      <div
        v-if="tip"
        role="tooltip"
        class="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-[#3A3A3A] bg-[#0A0A0A] px-3 py-2 text-sm shadow-lg"
        :style="{ left: `clamp(56px, ${tip.leftPct}%, calc(100% - 56px))` }"
      >
        <div class="font-semibold text-[#EDEDED]">{{ tip.count }}{{ unitVi ? ` ${unitVi}` : '' }}</div>
        <div class="text-[#B4B4B4]">{{ shortDate(tip.date) }}/{{ tip.date.slice(0, 4) }}</div>
      </div>
    </div>
  </figure>
</template>
