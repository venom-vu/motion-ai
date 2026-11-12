import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createSSRApp, ref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { compileFullSfc, compileSsr, renderAdminPage, ui } from './admin-sfc-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const formUi = await import(pathToFileURL(path.join(webRoot, 'utils/form-ui.ts')).href);

describe('Base Form UI & sửa lỗi vỡ giao diện', () => {
  it('form-ui.ts giữ đồng bộ chiều cao 48px, padding ngang, dark color-scheme và trạng thái lỗi', () => {
    const adminIdle = formUi.getFormFieldClasses('admin');
    assert.ok(adminIdle.includes('min-h-[48px]'));
    assert.ok(adminIdle.includes('pl-3.5'));
    assert.ok(adminIdle.includes('pr-3.5'));
    assert.ok(adminIdle.includes('[color-scheme:dark]'));
    assert.ok(adminIdle.includes('border-[#3A3A3A]'));

    const cyberSearch = formUi.getFormFieldClasses('cyber', { hasLeftIcon: true, focusAccent: 'violet' });
    assert.ok(cyberSearch.includes('min-h-[48px]'));
    assert.ok(cyberSearch.includes('pl-10'));
    assert.ok(cyberSearch.includes('pr-3.5'));
    assert.ok(cyberSearch.includes('focus:border-cyber-violet'));

    const adminError = formUi.getFormFieldClasses('admin', { error: true });
    assert.match(adminError, /border-\[#FF6166\]/);

    const menuAdmin = formUi.getSelectMenuClasses('admin');
    assert.match(menuAdmin, /bg-\[#111111\]/);
    assert.match(menuAdmin, /border-\[#3A3A3A\]/);

    const optSelected = formUi.getSelectOptionClasses('admin', { selected: true, highlighted: false });
    assert.match(optSelected, /bg-\[#1F1F1F\]/);
    assert.match(optSelected, /text-\[#EDEDED\]/);
  });

  it('admin-ui.ts nút bấm có shrink-0 và whitespace-nowrap để không vỡ chữ 2 dòng', () => {
    for (const key of ['btn', 'btnPrimary', 'btnDanger']) {
      assert.match(ui[key], /\bshrink-0\b/, `${key} thiếu shrink-0`);
      assert.match(ui[key], /\bwhitespace-nowrap\b/, `${key} thiếu whitespace-nowrap`);
    }
  });

  it('BaseInput SSR: tách class wrapper và gắn data-testid lên thẻ input, hỗ trợ leftIcon', async () => {
    const BaseInput = await compileFullSfc('components/BaseInput.vue');
    const app = createSSRApp({
      components: { BaseInput },
      setup() {
        return { kw: ref('') };
      },
      template:
        '<BaseInput v-model="kw" variant="cyber" left-icon="lucide:search" class="flex-1" data-testid="search-box" placeholder="Tìm" />',
    });
    app.component('Icon', {
      props: ['name'],
      ssrRender(ctx, push) {
        push(`<span data-icon="${ctx.name}"></span>`);
      },
    });
    const html = await renderToString(app);
    assert.match(html, /^<div class="w-full min-w-0 flex-1">/);
    assert.match(html, /data-icon="lucide:search"/);
    assert.match(html, /<input[^>]*data-testid="search-box"/);
    assert.match(html, /<input[^>]*class="[^"]*pl-10[^"]*"/);
  });

  it('BaseTextarea SSR: đồng bộ min-h-[96px] và gắn data-testid lên textarea', async () => {
    const BaseTextarea = await compileFullSfc('components/BaseTextarea.vue');
    const app = createSSRApp({
      components: { BaseTextarea },
      setup() {
        return { text: ref('') };
      },
      template:
        '<BaseTextarea v-model="text" variant="admin" focus-accent="rose" data-testid="reason-box" rows="3" />',
    });
    const html = await renderToString(app);
    assert.match(html, /<textarea[^>]*data-testid="reason-box"/);
    assert.match(html, /min-h-\[96px\]/);
    assert.match(html, /focus:border-rose-400/);
  });

  it('BaseSelect SSR: dùng combobox custom thay native select, mũi tên cách border phải bằng pr-3.5', async () => {
    const BaseSelect = await compileFullSfc('components/BaseSelect.vue');
    const app = createSSRApp({
      components: { BaseSelect },
      setup() {
        return {
          scope: ref('real'),
          options: [
            { value: 'real', label: 'Thực tế (real)' },
            { value: 'benchmark', label: 'Đo thử (benchmark)' },
          ],
        };
      },
      template: '<BaseSelect v-model="scope" variant="admin" :options="options" data-testid="scope-select" />',
    });
    app.component('Icon', {
      props: ['name'],
      ssrRender(ctx, push) {
        push(`<span data-icon="${ctx.name}"></span>`);
      },
    });
    const html = await renderToString(app);
    assert.doesNotMatch(html, /<select\b/);
    assert.match(html, /<button[^>]*role="combobox"[^>]*data-testid="scope-select"/);
    assert.match(html, /aria-haspopup="listbox"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /\bpr-3\.5\b/);
    assert.match(html, /\bgap-3\b/);
    assert.match(html, /data-icon="lucide:chevron-down"/);
    assert.match(html, /Thực tế \(real\)/);
  });

  it('BaseSelect script: mở/đóng dropdown, chọn option, điều hướng bàn phím và khóa khi disabled', async () => {
    const { descriptor } = parse(fs.readFileSync(path.join(webRoot, 'components/BaseSelect.vue'), 'utf8'));
    const compiled = compileScript(descriptor, { id: 'base-select-behavior-test' });
    const formUiUrl = pathToFileURL(path.join(webRoot, 'utils/form-ui.ts')).href;
    const code = compiled.content.replaceAll("'~/utils/form-ui'", JSON.stringify(formUiUrl));
    const tmp = path.join(webRoot, 'test', `.tmp-baseselect-${process.pid}.ts`);
    fs.writeFileSync(tmp, code, 'utf8');
    try {
      const comp = (await import(pathToFileURL(tmp).href)).default;
      const runWithInstance = async (props) => {
        let captured;
        const origSetup = comp.setup;
        const wrapped = {
          ...comp,
          ssrRender() {},
          setup(p, ctx) {
            captured = origSetup(p, ctx);
            return captured;
          },
        };
        const app = createSSRApp(wrapped, props);
        await renderToString(app);
        return captured;
      };

      const emitted = [];
      const options = [
        { value: 'real', label: 'Thực tế (real)' },
        { value: 'disabled-opt', label: 'Khóa', disabled: true },
        { value: 'benchmark', label: 'Đo thử (benchmark)' },
      ];
      const state = await runWithInstance({
        modelValue: 'real',
        options,
        disabled: false,
        variant: 'admin',
        'onUpdate:modelValue': (val) => emitted.push(val),
      });

      assert.equal(state.isOpen.value, false);
      state.handleTriggerKeydown({ key: 'ArrowDown', preventDefault() {} });
      assert.equal(state.isOpen.value, true);
      assert.equal(state.highlightedIndex.value, 0);

      // ArrowDown bỏ qua option disabled ở index 1 -> nhảy sang index 2
      state.handleTriggerKeydown({ key: 'ArrowDown', preventDefault() {} });
      assert.equal(state.highlightedIndex.value, 2);

      // Enter chọn option index 2 và đóng menu
      state.handleTriggerKeydown({ key: 'Enter', preventDefault() {} });
      assert.deepEqual(emitted, ['benchmark']);
      assert.equal(state.isOpen.value, false);

      // Escape đóng menu khi đang mở
      state.openMenu();
      assert.equal(state.isOpen.value, true);
      state.handleTriggerKeydown({ key: 'Escape', preventDefault() {} });
      assert.equal(state.isOpen.value, false);

      // Disabled không mở được menu
      const disabledState = await runWithInstance({
        modelValue: 'real',
        options,
        disabled: true,
        variant: 'admin',
      });
      disabledState.toggleMenu();
      assert.equal(disabledState.isOpen.value, false);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it('stats.vue và takedown.vue SSR: dùng BaseSelect và bố cục Tra cứu không bị vỡ', async () => {
    const noop = () => {};
    const statsHtml = await renderAdminPage(await compileSsr('pages/admin/stats.vue'), {
      isMePending: false,
      isAdmin: true,
      stats: null,
      isStatsLoading: false,
      statsErrorVi: null,
      statsFormErrorVi: null,
      statsFrom: '',
      statsTo: '',
      statsScope: 'real',
      scopeOptions: [
        { value: 'real', label: 'Thực tế (real)' },
        { value: 'benchmark', label: 'Đo thử (benchmark)' },
      ],
      trialMotionPrice: '',
      trialImagePrice: '',
      submitStats: noop,
      taskTotalSeries: [],
      taskTotalRows: [],
      successSeries: [],
      successRows: [],
      timeSeries: [],
      timeRows: [],
      costSeries: [],
      costRows: [],
      fmtPct: String,
      fmtSecs: String,
      fmtVnd: String,
      fmtCount: String,
      pct: String,
      secs: String,
      formatNumberVi: String,
      formatVndVi: String,
      getPipelineLabelVi: String,
    });
    assert.doesNotMatch(statsHtml, /<select\b/);
    assert.match(statsHtml, /<button[^>]*role="combobox"[^>]*data-testid="ops-stats-scope"/);
    assert.match(statsHtml, /Thực tế \(real\)/);

    const takedownHtml = await renderAdminPage(await compileSsr('pages/admin/takedown.vue'), {
      isMePending: false,
      isAdmin: true,
      notificationVi: null,
      task: null,
      taskErrorVi: null,
      isTaskLoading: false,
      isTakedownLoading: false,
      lookupInput: '',
      takedownReason: '',
      takedownReasonErrorVi: null,
      taskFinished: true,
      canTakedown: false,
      confirmOpen: false,
      confirmErrorVi: null,
      ops: { lookupTask: noop },
      requestTakedown: noop,
      closeConfirm: noop,
      runConfirm: noop,
      formatTopupTimestampVi: String,
    });
    assert.match(takedownHtml, /<button[^>]*data-testid="ops-task-lookup"[^>]*whitespace-nowrap/);
    assert.match(takedownHtml, /class="w-full min-w-0 flex-1"/);
  });
});
