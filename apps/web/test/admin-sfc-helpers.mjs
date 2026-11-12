import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { createSSRApp, defineComponent } from 'vue';
import { renderToString } from '@vue/server-renderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const webRoot = path.resolve(__dirname, '..');

const { ui } = await import(pathToFileURL(path.join(webRoot, 'utils/admin-ui.ts')).href);
export { ui };

/** Biên dịch template SFC thành hàm ssrRender (file tạm nằm trong test/ để 'vue' phân giải đúng). */
export async function compileSsr(relFile) {
  const { descriptor } = parse(fs.readFileSync(path.join(webRoot, relFile), 'utf8'));
  const compiled = compileTemplate({
    id: `t-${path.basename(relFile)}-${Math.random().toString(36).slice(2)}`,
    filename: relFile,
    source: descriptor.template.content,
    ssr: true,
  });
  if (compiled.errors.length) throw new Error(`${relFile}: ${compiled.errors.join('; ')}`);
  const tmp = path.join(webRoot, 'test', `.tmp-sfc-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, compiled.code, 'utf8');
  try {
    return (await import(pathToFileURL(tmp).href)).ssrRender;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const formUiUrl = pathToFileURL(path.join(webRoot, 'utils/form-ui.ts')).href;

/** Biên dịch đầy đủ một SFC nhỏ (có script setup + template) để dùng trong test SSR. */
export async function compileFullSfc(relFile) {
  const { descriptor } = parse(fs.readFileSync(path.join(webRoot, relFile), 'utf8'));
  const id = `sfc-${path.basename(relFile)}-${Math.random().toString(36).slice(2)}`;
  const script = compileScript(descriptor, { id, inlineTemplate: false });
  const template = compileTemplate({
    id,
    filename: relFile,
    source: descriptor.template.content,
    ssr: true,
    compilerOptions: { bindingMetadata: script.bindings },
  });
  if (template.errors.length) throw new Error(`${relFile}: ${template.errors.join('; ')}`);
  const scriptCode = script.content.replaceAll("'~/utils/form-ui'", JSON.stringify(formUiUrl));
  const tmpScript = path.join(webRoot, 'test', `.tmp-script-${process.pid}-${Math.random().toString(36).slice(2)}.ts`);
  const tmpTpl = path.join(webRoot, 'test', `.tmp-tpl-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmpScript, scriptCode, 'utf8');
  fs.writeFileSync(tmpTpl, template.code, 'utf8');
  try {
    const comp = (await import(pathToFileURL(tmpScript).href)).default;
    const { ssrRender } = await import(pathToFileURL(tmpTpl).href);
    return defineComponent({ ...comp, ssrRender });
  } finally {
    fs.rmSync(tmpScript, { force: true });
    fs.rmSync(tmpTpl, { force: true });
  }
}

const shared = {
  gate: await compileSsr('components/AdminAccessGate.vue'),
  pager: await compileSsr('components/AdminPager.vue'),
  confirm: await compileSsr('components/AdminConfirmDialog.vue'),
  bar: await compileSsr('components/AdminBarChart.vue'),
  daily: await compileSsr('components/AdminDailyChart.vue'),
  baseInput: await compileFullSfc('components/BaseInput.vue'),
  baseTextarea: await compileFullSfc('components/BaseTextarea.vue'),
  baseSelect: await compileFullSfc('components/BaseSelect.vue'),
};

/** Một trang có số trang cố định để dựng setup cho test SSR. */
export function staticPager(items, { page = 1, pageSize = 20, hasMore = false } = {}) {
  const ref = (value) => ({ value });
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  return {
    page: ref(page),
    pageCount: ref(pageCount),
    pageItems: ref(items.slice((page - 1) * pageSize, page * pageSize)),
    canPrev: ref(page > 1),
    canNext: ref(page < pageCount || hasMore),
    isPaging: ref(false),
    next() {},
    prev() {},
    reset() {},
  };
}

/* Biểu đồ: dựng lại phần tính toán của script setup ở mức đủ cho SSR (không hover). */
const chartComponent = (render, props, setup) => ({ props, ssrRender: render, setup });

function barSetup(p) {
  const s = p.series.length;
  const rowH = s * 14 + (s - 1) * 4 + 28;
  const all = p.rows.flatMap((r) => r.values.filter((v) => v !== null));
  const max = p.max ?? Math.max(1, ...all.map((v) => Math.abs(v)));
  const plotW = 640 - 132 - 88;
  return {
    BAR_H: 14, GAP: 4, ROW_PAD: 14, LABEL_W: 132, VALUE_W: 88, WIDTH: 640, plotW,
    rowH, height: Math.max(1, p.rows.length) * rowH, hover: null, tip: null,
    format: p.format ?? String,
    barW: (v) => (v === null || v <= 0 ? 0 : Math.max(2, (v / max) * plotW)),
  };
}

function dailySetup(p) {
  const PAD = { top: 12, right: 8, bottom: 28, left: 36 };
  const plotW = 640 - PAD.left - PAD.right;
  const plotH = 220 - PAD.top - PAD.bottom;
  const max = Math.max(1, ...p.points.map((x) => x.count));
  const slot = plotW / Math.max(1, p.points.length);
  const barW = Math.max(2, slot * 0.7);
  return {
    WIDTH: 640, HEIGHT: 220, PAD, plotW, plotH, ticks: [0, max], slot, barW, hoverIdx: null, tip: null, svgRef: null,
    total: p.points.reduce((a, x) => a + x.count, 0),
    y: (v) => PAD.top + plotH - (v / max) * plotH,
    x: (i) => PAD.left + i * slot + (slot - barW) / 2,
    xLabels: p.points.map((x, i) => ({ i, label: x.date })),
    shortDate: (d) => d, onMove() {}, color: p.color ?? '#3987e5', unitVi: p.unitVi ?? '',
  };
}

/** Render trang admin với các component admin dùng chung thật; Icon/NuxtLink là stub. */
export async function renderAdminPage(ssrRender, setupData, extraComponents = {}) {
  const app = createSSRApp({ ssrRender, setup: () => ({ ui, ...setupData }) });
  const withUi = (render, props, emits = []) => ({ props, emits, ssrRender: render, setup: () => ({ ui, openAuthDialog() {}, emit() {} }) });
  app.component('AdminAccessGate', withUi(shared.gate, ['pending', 'admin']));
  app.component('AdminPager', withUi(shared.pager, ['page', 'pageCount', 'hasMore', 'canPrev', 'canNext', 'loading'], ['prev', 'next']));
  app.component('AdminConfirmDialog', withUi(shared.confirm, ['open', 'title', 'busy', 'errorVi'], ['cancel', 'confirm']));
  app.component('AdminBarChart', chartComponent(shared.bar, ['title', 'series', 'rows', 'format', 'max'], barSetup));
  app.component('AdminDailyChart', chartComponent(shared.daily, ['title', 'points', 'color', 'unitVi'], dailySetup));
  app.component('BaseInput', shared.baseInput);
  app.component('BaseTextarea', shared.baseTextarea);
  app.component('BaseSelect', shared.baseSelect);
  app.component('Icon', { props: ['name'], ssrRender(_c, push) { push('<span class="mock-lucide-icon"></span>'); } });
  app.component('NuxtLink', {
    props: ['to'],
    ssrRender(c, push, _p, _a, _s, slots) {
      push(`<a href="${c.to}">`);
      slots.default?.();
      push('</a>');
    },
  });
  for (const [name, def] of Object.entries(extraComponents)) app.component(name, def);
  return renderToString(app);
}
