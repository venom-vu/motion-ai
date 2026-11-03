import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, compileTemplate } from '@vue/compiler-sfc';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  API_ERROR_MESSAGES_VI,
  ApiErrorCode,
  CONTRACTS_PACKAGE_VERSION,
  MOCK_ME_PRO_RESPONSE,
  MOCK_PRICING_CONFIG_RESPONSE,
  MOCK_WALLET_LEDGER_ITEMS,
} from '@motion-ai/contracts';
import { SLATE_CYBER_COLORS } from '../tailwind.config.ts';
import {
  MotionApiClientError,
  createMotionApiClient,
  resolveApiErrorMessageVi,
} from '../utils/api-client.ts';
import {
  createRefreshCoordinator,
  createSessionLostHandler,
  createUnauthorizedHandler,
  isOutOfCredit,
  isUnauthorizedError,
  runLogout,
} from '../utils/auth-session.ts';
import {
  FEATURE_CATEGORIES,
  buildAiFeatureCatalog,
  calculateFeatureEstimatedCredits,
  formatSignedCreditsVi,
  getTierCapSeconds,
} from '../utils/catalog.ts';
import {
  createWalletLedgerPagination,
  formatTimestampVi,
} from '../utils/wallet-ledger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

function collectFiles(dirPath, extensions) {
  const results = [];
  if (!fs.existsSync(dirPath)) {
    return results;
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.nuxt' ||
      entry.name === '.output' ||
      entry.name === 'dist'
    ) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('@motion-ai/web — Story 1.4 Nuxt 4 mobile-first & API client', () => {
  it('AC1: ghim cố định phiên bản trong package.json (Nuxt 4.6.3) và cấu hình preset cloudflare-pages', () => {
    assert.equal(CONTRACTS_PACKAGE_VERSION, '0.1.0');

    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'),
    );
    assert.equal(pkgJson.dependencies.nuxt, '4.6.3');

    const allDeps = {
      ...(pkgJson.dependencies ?? {}),
      ...(pkgJson.devDependencies ?? {}),
    };
    for (const [depName, version] of Object.entries(allDeps)) {
      if (depName === '@motion-ai/contracts') {
        assert.equal(version, 'workspace:*');
        continue;
      }
      assert.equal(
        /^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(version)),
        true,
        `Dependency ${depName} phải ghim phiên bản cố định, nhận được: ${version}`,
      );
    }

    const nuxtConfigRaw = fs.readFileSync(
      path.join(webRoot, 'nuxt.config.ts'),
      'utf8',
    );
    assert.match(nuxtConfigRaw, /preset:\s*'cloudflare-pages'/);

    const workerIndexPath = path.join(
      webRoot,
      '.output',
      'public',
      '_worker.js',
      'index.js',
    );
    const routesJsonPath = path.join(
      webRoot,
      '.output',
      'public',
      '_routes.json',
    );

    if (!fs.existsSync(workerIndexPath) || !fs.existsSync(routesJsonPath)) {
      execFileSync('pnpm', ['run', 'build'], {
        cwd: webRoot,
        stdio: 'inherit',
      });
    }

    assert.equal(
      fs.existsSync(workerIndexPath),
      true,
      'Phải sinh .output/public/_worker.js/index.js cho Cloudflare Pages',
    );
    assert.equal(
      fs.existsSync(routesJsonPath),
      true,
      'Phải sinh .output/public/_routes.json cho Cloudflare Pages',
    );

    const routesJson = JSON.parse(fs.readFileSync(routesJsonPath, 'utf8'));
    assert.equal(routesJson.version, 1);
    assert.equal(Array.isArray(routesJson.include), true);

    const readmeRaw = fs.readFileSync(path.join(webRoot, 'README.md'), 'utf8');
    assert.match(readmeRaw, /cloudflare-pages/);
    assert.match(readmeRaw, /_worker\.js\/index\.js/);
    assert.match(readmeRaw, /_routes\.json/);
  });

  it('AC4 & I/O Row 2, 3, 4: client API parse Zod khi 200 và ánh xạ đầy đủ ApiErrorCode cũng như mã lỗi lạ sang tiếng Việt', async () => {
    const requestedHeaders = [];
    const liveOkClient = createMotionApiClient({
      baseUrl: 'https://api.motion.ai.vn/',
      getAccessToken: () => 'jwt_live_token_123',
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        requestedHeaders.push({
          url: String(url),
          auth: headers.get('Authorization'),
        });
        return new Response(JSON.stringify(MOCK_ME_PRO_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const proProfile = await liveOkClient.getMe();
    assert.equal(proProfile.tier, 'Pro');
    assert.equal(proProfile.balance, 12050);
    assert.equal(requestedHeaders[0].url, 'https://api.motion.ai.vn/me');
    assert.equal(requestedHeaders[0].auth, 'Bearer jwt_live_token_123');

    // Kiểm tra toàn bộ 7 mã lỗi chuẩn trong ApiErrorCode
    for (const code of Object.values(ApiErrorCode)) {
      const errorClient = createMotionApiClient({
          fetchImpl: async () =>
          new Response(
            JSON.stringify({
              code,
              message: `Raw technical message for ${code}`,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
      });

      await assert.rejects(
        () => errorClient.getPricingConfig(),
        (error) => {
          assert.equal(error instanceof MotionApiClientError, true);
          assert.equal(error.code, code);
          assert.equal(error.userMessageVi, API_ERROR_MESSAGES_VI[code]);
          assert.equal(
            resolveApiErrorMessageVi(error),
            API_ERROR_MESSAGES_VI[code],
          );
          assert.equal(error.userMessageVi.includes('Raw technical'), false);
          return true;
        },
      );
    }

    // Kiểm tra mã lỗi lạ, thiếu code, null, undefined
    const fallbackMessageVi =
      'Đã xảy ra lỗi không xác định. Vui lòng thử lại sau.';
    assert.equal(
      resolveApiErrorMessageVi({ code: 'UNKNOWN_ERR' }),
      fallbackMessageVi,
    );
    assert.equal(resolveApiErrorMessageVi({}), fallbackMessageVi);
    assert.equal(resolveApiErrorMessageVi(null), fallbackMessageVi);
    assert.equal(resolveApiErrorMessageVi(undefined), fallbackMessageVi);

    const unknownCodeClient = createMotionApiClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ code: 'SOME_NEW_BACKEND_CODE' }), {
          status: 502,
        }),
    });

    await assert.rejects(
      () => unknownCodeClient.getMe(),
      (error) => {
        assert.equal(error instanceof MotionApiClientError, true);
        assert.equal(error.userMessageVi, fallbackMessageVi);
        return true;
      },
    );
  });

  it('AC5 & I/O Row 5: danh mục công cụ và tính phí lấy động từ GET /config/pricing theo từng Tier, không hardcode', () => {
    const pricing = MOCK_PRICING_CONFIG_RESPONSE;

    assert.equal(getTierCapSeconds(pricing, 'FREE'), 5);
    assert.equal(getTierCapSeconds(pricing, 'Starter'), 10);
    assert.equal(getTierCapSeconds(pricing, 'Pro'), 15);
    assert.equal(getTierCapSeconds(pricing, 'Creator'), 20);

    const freeCatalog = buildAiFeatureCatalog(pricing, 'FREE');
    assert.equal(freeCatalog.length, 3);

    const faceSwap = freeCatalog.find((f) => f.id === 'face-swap');
    const bodyRetouch = freeCatalog.find((f) => f.id === 'body-retouch');
    const motionControlFree = freeCatalog.find(
      (f) => f.id === 'motion-control',
    );

    assert.ok(faceSwap);
    assert.ok(bodyRetouch);
    assert.ok(motionControlFree);

    assert.equal(faceSwap.unitCredits, pricing.pipelines.faceSwapCredits);
    assert.equal(bodyRetouch.unitCredits, pricing.pipelines.bodyRetouchCredits);
    assert.equal(
      motionControlFree.unitCredits,
      pricing.pipelines.motionControlCreditsPerSecond,
    );
    assert.equal(motionControlFree.tierCapSeconds, 5);
    assert.equal(
      calculateFeatureEstimatedCredits(motionControlFree, 4),
      4 * pricing.pipelines.motionControlCreditsPerSecond,
    );
    // Clamped ở trần 5 giây của FREE
    assert.equal(
      calculateFeatureEstimatedCredits(motionControlFree, 12),
      5 * pricing.pipelines.motionControlCreditsPerSecond,
    );

    const creatorCatalog = buildAiFeatureCatalog(pricing, 'Creator');
    const motionControlCreator = creatorCatalog.find(
      (f) => f.id === 'motion-control',
    );
    assert.ok(motionControlCreator);
    assert.equal(motionControlCreator.tierCapSeconds, 20);
    assert.equal(
      calculateFeatureEstimatedCredits(motionControlCreator, 18),
      18 * pricing.pipelines.motionControlCreditsPerSecond,
    );

    assert.equal(FEATURE_CATEGORIES.length, 3);
  });

  it('AC2, AC6 & I/O Row 6: tuân thủ Slate Cyber tokens, @nuxt/icon lucide, vùng chạm >= 48px, Centered Dialog 980px, Left Sidebar 220px cho /admin và không có emoji UTF-8', async () => {
    // 1. Kiểm tra bảng màu Slate Cyber
    assert.equal(SLATE_CYBER_COLORS.bg, '#0F172A');
    assert.equal(SLATE_CYBER_COLORS.surface, '#1E293B');
    assert.equal(SLATE_CYBER_COLORS.border, '#334155');
    assert.equal(SLATE_CYBER_COLORS.violet, '#8B5CF6');
    assert.equal(SLATE_CYBER_COLORS.cyan, '#06B6D4');
    assert.equal(SLATE_CYBER_COLORS.text, '#F8FAFC');
    assert.equal(SLATE_CYBER_COLORS.muted, '#94A3B8');
    assert.equal(SLATE_CYBER_COLORS.success, '#10B981');
    assert.equal(SLATE_CYBER_COLORS.warning, '#F59E0B');
    assert.equal(SLATE_CYBER_COLORS.danger, '#EF4444');
    assert.equal(SLATE_CYBER_COLORS.adminBg, '#0A0A0A');

    // 2. Kiểm tra đầy đủ 4 trang khung tiếng Việt
    const requiredPages = [
      'pages/index.vue',
      'pages/history.vue',
      'pages/pricing.vue',
      'pages/admin/index.vue',
    ];
    for (const relPage of requiredPages) {
      assert.equal(
        fs.existsSync(path.join(webRoot, relPage)),
        true,
        `Thiếu trang bắt buộc: ${relPage}`,
      );
    }

    // 3. Kiểm tra Bottom Nav 4 tab ở mobile và Top Header 68px ở desktop
    const bottomNavRaw = fs.readFileSync(
      path.join(webRoot, 'components/AppBottomNav.vue'),
      'utf8',
    );
    for (const tabLabel of ['Kho AI', 'Lịch sử', 'Bảng giá', 'Tôi']) {
      assert.equal(
        bottomNavRaw.includes(tabLabel),
        true,
        `AppBottomNav thiếu tab "${tabLabel}"`,
      );
    }
    assert.match(bottomNavRaw, /min-h-\[48px\]/);

    const topHeaderRaw = fs.readFileSync(
      path.join(webRoot, 'components/AppTopHeader.vue'),
      'utf8',
    );
    assert.match(topHeaderRaw, /h-\[68px\]/);
    assert.match(topHeaderRaw, /min-h-\[48px\]/);

    // 4. Kiểm tra Centered Dialog FeatureWorkspaceDialog (max-w-[980px], Escape, role="dialog")
    const workspaceDialogRaw = fs.readFileSync(
      path.join(webRoot, 'components/FeatureWorkspaceDialog.vue'),
      'utf8',
    );
    assert.match(workspaceDialogRaw, /role="dialog"/);
    assert.match(workspaceDialogRaw, /aria-modal="true"/);
    assert.match(workspaceDialogRaw, /max-w-\[980px\]/);
    assert.match(workspaceDialogRaw, /items-center justify-center/);
    assert.match(workspaceDialogRaw, /Escape/);
    assert.equal(
      /drawer|bottom-sheet/i.test(workspaceDialogRaw),
      false,
      'FeatureWorkspaceDialog không được dùng Drawer hoặc Bottom Sheet',
    );

    // Kiểm tra thực thi SSR và render động FeatureWorkspaceDialog khi open=true
    const { descriptor } = parse(workspaceDialogRaw);
    const compiled = compileTemplate({
      id: 'test-feature-workspace-dialog',
      filename: 'FeatureWorkspaceDialog.vue',
      source: descriptor.template.content,
      ssr: true,
      ssrCssVars: [],
    });
    assert.equal(
      compiled.errors.length,
      0,
      'Template FeatureWorkspaceDialog phải biên dịch không có lỗi',
    );

    const tmpDialogSsrFile = path.join(
      webRoot,
      'test',
      `.tmp-dialog-${Date.now()}.mjs`,
    );
    fs.writeFileSync(tmpDialogSsrFile, compiled.code, 'utf8');
    try {
      const { ssrRender } = await import(
        pathToFileURL(tmpDialogSsrFile).href
      );
      const testDialogApp = createSSRApp({
        ssrRender,
        setup() {
          return {
            open: true,
            feature: {
              id: 'motion-control',
              nameVi: 'Điều Khiển Chuyển Động',
              icon: 'lucide:video',
              unitCredits: 50,
              tierCapSeconds: 5,
              badgeVi: '50 credit/giây',
              descriptionVi: 'Mô tả test',
              category: 'motion',
              priceNoteVi: '50 credit / giây',
              demoImageBeforeUrl: '/before.png',
              demoImageAfterUrl: '/after.png',
            },
            userTier: 'FREE',
            userBalance: 500,
            compareSplitPercent: 50,
            selectedSeconds: 3,
            mockUploadState: 'idle',
            maxSeconds: 5,
            estimatedCredits: 150,
            hasEnoughBalance: true,
            formatNumberVi: (n) => String(n),
            emit: () => {},
            handleSubmit: () => {},
          };
        },
      });
      testDialogApp.component('Icon', {
        props: ['name'],
        ssrRender(_ctx, _push) {
          _push('<span class="icon-mock"></span>');
        },
      });
      testDialogApp.component('NuxtLink', {
        props: ['to'],
        ssrRender(_ctx, _push) {
          _push('<a href="#">MockLink</a>');
        },
      });

      const renderedDialogHtml = await renderToString(testDialogApp);
      assert.match(
        renderedDialogHtml,
        /data-testid="feature-workspace-dialog"/,
      );
      assert.match(renderedDialogHtml, /role="dialog"/);
      assert.match(renderedDialogHtml, /max-w-\[980px\]/);
      assert.match(renderedDialogHtml, /aria-modal="true"/);
      assert.match(renderedDialogHtml, /Tạo Tác Vụ AI/);
    } finally {
      if (fs.existsSync(tmpDialogSsrFile)) {
        fs.unlinkSync(tmpDialogSsrFile);
      }
    }

    // 5. Kiểm tra layout /admin dùng Left Sidebar 220px, nền #0A0A0A, font-mono
    const adminLayoutRaw = fs.readFileSync(
      path.join(webRoot, 'layouts/admin.vue'),
      'utf8',
    );
    assert.match(adminLayoutRaw, /lg:w-\[220px\]/);
    assert.match(adminLayoutRaw, /#0A0A0A/);
    assert.match(adminLayoutRaw, /font-mono/);

    // 6. Quét toàn bộ file nguồn trong apps/web đảm bảo không có emoji UTF-8
    const sourceFiles = collectFiles(webRoot, ['.vue', '.ts', '.css']);
    const emojiRegex = /\p{Extended_Pictographic}/u;
    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.equal(
        emojiRegex.test(content),
        false,
        `Phát hiện ký tự emoji UTF-8 bị cấm trong file: ${path.relative(webRoot, filePath)}`,
      );
    }
  });

  it('AC1, AC2, AC5: SSR render cả 4 route (/, /history, /pricing, /admin) qua Cloudflare Pages Worker bundle (.output/public/_worker.js/index.js)', async () => {
    // Giả lập backend ở ranh giới HTTP: SSR gọi API thật nên test cần phản hồi mẫu.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const { pathname } = new URL(String(input));
      const json = (body, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (pathname === '/config/pricing') {
        return json(MOCK_PRICING_CONFIG_RESPONSE);
      }
      if (pathname === '/wallet/ledger') {
        return json({
          items: MOCK_WALLET_LEDGER_ITEMS.slice(0, 20),
          pageSize: 20,
          hasMore: false,
          nextCursor: null,
        });
      }
      return json({ code: 'UNAUTHORIZED' }, 401);
    };
    after(() => {
      globalThis.fetch = originalFetch;
    });

    const workerModule = await import('../.output/public/_worker.js/index.js');
    const worker = workerModule.default;
    assert.equal(typeof worker?.fetch, 'function');

    const env = {
      ASSETS: {
        fetch: async () => new Response('Not found', { status: 404 }),
      },
    };
    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    };

    const routeExpectations = [
      {
        path: '/',
        mustInclude: [
          'data-testid="page-catalog"',
          'data-testid="app-top-header"',
          'data-testid="app-bottom-nav"',
          '100 credit / lượt',
          '50 credit / giây',
          'Tối đa 5 giây (Hạng FREE)',
        ],
      },
      {
        path: '/history',
        mustInclude: [
          'data-testid="page-history"',
          'Tặng',
          'Nạp',
          'Giữ',
          'Hoàn',
          'Chốt',
          'Điều chỉnh',
        ],
      },
      {
        path: '/pricing',
        mustInclude: [
          'data-testid="page-pricing"',
          'Hạng FREE',
          'Hạng Starter',
          'Hạng Pro',
          'Hạng Creator',
          '49.000đ',
          '99.000đ',
          '199.000đ',
        ],
      },
      {
        path: '/admin',
        mustInclude: [
          'data-testid="page-admin"',
          'data-testid="admin-left-sidebar"',
          'BANK_REF',
        ],
      },
    ];

    const emojiRegex = /\p{Extended_Pictographic}/u;

    for (const { path: routePath, mustInclude } of routeExpectations) {
      const response = await worker.fetch(
        new Request(`https://motion.ai.vn${routePath}`),
        env,
        ctx,
      );
      assert.equal(
        response.status,
        200,
        `Route ${routePath} phải trả HTTP 200`,
      );
      const html = await response.text();
      for (const snippet of mustInclude) {
        assert.equal(
          html.includes(snippet),
          true,
          `HTML của route ${routePath} phải chứa "${snippet}"`,
        );
      }
      if (routePath === '/') {
        assert.equal(
          html.includes('fonts.googleapis.com'),
          true,
          'HTML trang chủ phải chứa link nhúng Google Fonts',
        );
      }
      assert.equal(
        emojiRegex.test(html),
        false,
        `HTML render của route ${routePath} không được chứa emoji UTF-8`,
      );
    }
  });
});

describe('@motion-ai/web — Story 1.9 đăng nhập, ToS và phiên', () => {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  function makeClient({ hadToken = true, isServer = false } = {}) {
    const state = {
      token: hadToken ? 'old' : null,
      calls: [],
      refreshCount: 0,
      refreshOk: true,
      refreshMode: null,
      refreshStatus: null,
      lost: [],
    };
    const refreshShared = createRefreshCoordinator();
    const client = createMotionApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: () => state.token,
      onUnauthorized: createUnauthorizedHandler({
        getToken: () => state.token,
        setToken: (t) => {
          state.token = t;
        },
        refresh: () => client.refreshSession(),
        refreshShared,
        isServer,
        onSessionLost: (had) => {
          state.lost.push(had);
        },
      }),
      fetchImpl: async (url, init) => {
        const { pathname } = new URL(String(url));
        const auth = new Headers(init?.headers).get('Authorization');
        state.calls.push({ pathname, auth });
        if (pathname === '/auth/refresh') {
          state.refreshCount += 1;
          await new Promise((r) => setTimeout(r, 5));
          if (state.refreshMode === 'network') throw new TypeError('network down');
          if (state.refreshMode === 'server-error') return json({ code: 'X' }, 503);
          return state.refreshOk
            ? json({ accessToken: 'new', tokenType: 'Bearer', expiresIn: 900 })
            : json({ code: 'UNAUTHORIZED' }, state.refreshStatus ?? 401);
        }
        if (auth === 'Bearer new') return json(MOCK_ME_PRO_RESPONSE);
        return json({ code: 'UNAUTHORIZED' }, 401);
      },
    });
    return { client, state };
  }

  it('401: refresh đúng một lần rồi thử lại request gốc', async () => {
    const { client, state } = makeClient();
    const me = await client.getMe();
    assert.equal(me.tier, 'Pro');
    assert.equal(state.refreshCount, 1);
    assert.deepEqual(
      state.calls.map((c) => c.pathname),
      ['/me', '/auth/refresh', '/me'],
    );
  });

  it('3 request 401 song song: chỉ một lời gọi refresh, cả ba thử lại thành công', async () => {
    const { client, state } = makeClient();
    const results = await Promise.all([
      client.getMe(),
      client.getMe(),
      client.getMe(),
    ]);
    assert.equal(results.length, 3);
    assert.equal(state.refreshCount, 1);
  });

  it('refresh lỗi: request gốc ném lỗi 401, không refresh lần hai, refresh không tự đệ quy', async () => {
    const { client, state } = makeClient();
    state.refreshOk = false;
    await assert.rejects(
      () => client.getMe(),
      (e) => e instanceof MotionApiClientError && e.status === 401,
    );
    assert.equal(state.refreshCount, 1);
    assert.deepEqual(state.lost, [true]);
    assert.equal(state.token, null);
  });

  it('refresh lỗi khi chưa gửi token: báo mất phiên với hadToken=false (không chuyển trang)', async () => {
    const { client, state } = makeClient({ hadToken: false });
    state.refreshOk = false;
    await assert.rejects(() => client.getMe());
    assert.deepEqual(state.lost, [false]);
  });

  it('refresh lỗi mạng hoặc 5xx: giữ token, không báo mất phiên, request gốc báo lỗi của nó', async () => {
    for (const mode of ['network', 'server-error']) {
      const { client, state } = makeClient();
      state.refreshMode = mode;
      await assert.rejects(
        () => client.getMe(),
        (e) => e instanceof MotionApiClientError && e.status === 401,
      );
      assert.equal(state.refreshCount, 1, mode);
      assert.deepEqual(state.lost, [], `${mode}: không được báo mất phiên`);
      assert.equal(state.token, 'old', `${mode}: token phải được giữ`);
    }
  });

  it('refresh bị từ chối 401/403 mới là mất phiên', async () => {
    for (const status of [401, 403]) {
      const { client, state } = makeClient();
      state.refreshOk = false;
      state.refreshStatus = status;
      await assert.rejects(() => client.getMe());
      assert.deepEqual(state.lost, [true], `status ${status}`);
      assert.equal(state.token, null);
    }
  });

  it('request 401 đến muộn khi token đã được request khác làm mới: thử lại, không refresh thêm', async () => {
    let refreshes = 0;
    const handler = createUnauthorizedHandler({
      getToken: () => 'new',
      setToken: () => {},
      refresh: async () => {
        refreshes += 1;
        return { accessToken: 'x' };
      },
      refreshShared: createRefreshCoordinator(),
      isServer: false,
      onSessionLost: () => {
        throw new Error('không được báo mất phiên');
      },
    });
    assert.equal(await handler('old'), true);
    assert.equal(refreshes, 0);
  });

  it('createSessionLostHandler: đánh dấu đã kiểm tra, chỉ xóa dữ liệu và chuyển /login khi request đã mang token', async () => {
    const calls = [];
    const handler = createSessionLostHandler({
      markChecked: () => calls.push('mark'),
      clearData: () => calls.push('clear'),
      navigate: (path) => calls.push(`nav:${path}`),
    });
    await handler(true);
    assert.deepEqual(calls, ['mark', 'clear', 'nav:/login']);
    calls.length = 0;
    await handler(false);
    assert.deepEqual(calls, ['mark'], 'khách xem công khai giữ nguyên trang');
  });

  it('runLogout chuyển tới /login và đi qua cùng hằng đường dẫn', async () => {
    const paths = [];
    await runLogout({
      apiLogout: async () => {},
      clearSession: () => {},
      navigate: (path) => paths.push(path),
    });
    assert.deepEqual(paths, ['/login']);
  });

  it('trang chính render thông báo hết credit ở balance = 0, kèm liên kết /pricing, và không render ở balance 500', async () => {
    const raw = fs.readFileSync(path.join(webRoot, 'pages/index.vue'), 'utf8');
    const { descriptor } = parse(raw);
    const compiled = compileTemplate({
      id: 'test-index-page',
      filename: 'index.vue',
      source: descriptor.template.content,
      ssr: true,
      ssrCssVars: [],
    });
    assert.equal(compiled.errors.length, 0);

    const tmpFile = path.join(webRoot, 'test', `.tmp-index-${Date.now()}.mjs`);
    fs.writeFileSync(tmpFile, compiled.code, 'utf8');
    try {
      const { ssrRender } = await import(pathToFileURL(tmpFile).href);
      async function render(me) {
        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              me,
              isOutOfCredit,
              pricing: MOCK_PRICING_CONFIG_RESPONSE,
              currentTier: 'FREE',
              currentTierCapSeconds: 5,
              features: [],
              filteredFeatures: [],
              categories: [],
              FEATURE_CATEGORIES: [],
              isLoading: false,
              errorMessageVi: null,
              selectedCategory: 'all',
              searchKeyword: '',
              activeFeature: null,
              isWorkspaceOpen: false,
              formatNumberVi: (n) => String(n),
              refreshAll: () => {},
              clearError: () => {},
              openWorkspace: () => {},
              closeWorkspace: () => {},
            };
          },
        });
        for (const name of ['Icon', 'ApiErrorBanner', 'FeatureCard', 'FeatureWorkspaceDialog']) {
          app.component(name, { ssrRender(_c, push) { push('<span></span>'); } });
        }
        app.component('NuxtLink', {
          props: ['to'],
          ssrRender(ctx, push) {
            push(`<a href="${ctx.to}">link</a>`);
          },
        });
        return renderToString(app);
      }

      const empty = await render({ ...MOCK_ME_PRO_RESPONSE, balance: 0 });
      assert.match(empty, /data-testid="zero-credit-notice"/);
      assert.match(empty, /href="\/pricing"/);

      const funded = await render({ ...MOCK_ME_PRO_RESPONSE, balance: 500 });
      assert.doesNotMatch(funded, /data-testid="zero-credit-notice"/);

      const guest = await render(null);
      assert.doesNotMatch(guest, /data-testid="zero-credit-notice"/);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it('SSR không bao giờ refresh', async () => {
    const { client, state } = makeClient({ isServer: true });
    await assert.rejects(() => client.getMe());
    assert.equal(state.refreshCount, 0);
  });

  it('runLogout: API lỗi vẫn xóa phiên rồi chuyển /login', async () => {
    const order = [];
    await runLogout({
      apiLogout: async () => {
        order.push('api');
        throw new Error('boom');
      },
      clearSession: () => order.push('clear'),
      navigate: () => order.push('nav'),
    });
    assert.deepEqual(order, ['api', 'clear', 'nav']);
  });

  it('isOutOfCredit: chỉ true khi balance = 0', () => {
    assert.equal(isOutOfCredit({ balance: 0 }), true);
    assert.equal(isOutOfCredit({ balance: 500 }), false);
    assert.equal(isOutOfCredit(null), false);
  });

  it('sau retry vẫn 401 thì không refresh thêm', async () => {
    let refreshes = 0;
    const client = createMotionApiClient({
      onUnauthorized: async () => {
        refreshes += 1;
        return true;
      },
      fetchImpl: async () => json({ code: 'UNAUTHORIZED' }, 401),
    });
    await assert.rejects(() => client.getMe());
    assert.equal(refreshes, 1);
  });

  it('ánh xạ mã lỗi đăng nhập sang tiếng Việt', () => {
    for (const code of [
      'CONSENT_REQUIRED',
      'ACCOUNT_LOCKED',
      'RATE_LIMITED',
      'EMAIL_LINKED_TO_OTHER_ACCOUNT',
    ]) {
      const msg = resolveApiErrorMessageVi(code);
      assert.equal(msg, API_ERROR_MESSAGES_VI[code]);
      assert.ok(msg.length > 0);
    }
  });

  it('getGoogleAuthUrl gửi tosVersion và deviceId; lỗi 401 không kích hoạt refresh', async () => {
    let refreshes = 0;
    let seenUrl = '';
    const client = createMotionApiClient({
      baseUrl: 'https://api.test',
      onUnauthorized: async () => {
        refreshes += 1;
        return true;
      },
      fetchImpl: async (url) => {
        seenUrl = String(url);
        return json({ code: 'CONSENT_REQUIRED' }, 401);
      },
    });
    await assert.rejects(() =>
      client.getGoogleAuthUrl({ tosVersion: '2026-11-01', deviceId: 'dev_abcdefgh12345678' }),
    );
    assert.equal(refreshes, 0);
    assert.match(seenUrl, /tosVersion=/);
    assert.match(seenUrl, /deviceId=/);
  });

  it('SSR /login trả 200 với nút Google bị vô hiệu và văn bản ToS', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const { pathname } = new URL(String(input));
      if (pathname === '/config/pricing') return json(MOCK_PRICING_CONFIG_RESPONSE);
      return json({ code: 'UNAUTHORIZED' }, 401);
    };
    try {
      const worker = (await import('../.output/public/_worker.js/index.js')).default;
      const res = await worker.fetch(
        new Request('https://motion.ai.vn/login'),
        { ASSETS: { fetch: async () => new Response('x', { status: 404 }) } },
        { waitUntil() {}, passThroughOnException() {} },
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /data-testid="page-login"/);
      assert.match(html, /data-testid="google-login-button"[^>]*disabled/);
      assert.match(html, /Điều khoản dịch vụ phiên bản/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('SSR /login?authError=ACCOUNT_LOCKED hiện thông báo tiếng Việt đã ánh xạ', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const { pathname } = new URL(String(input));
      if (pathname === '/config/pricing') return json(MOCK_PRICING_CONFIG_RESPONSE);
      return json({ code: 'UNAUTHORIZED' }, 401);
    };
    try {
      const worker = (await import('../.output/public/_worker.js/index.js')).default;
      const res = await worker.fetch(
        new Request('https://motion.ai.vn/login?authError=ACCOUNT_LOCKED'),
        { ASSETS: { fetch: async () => new Response('x', { status: 404 }) } },
        { waitUntil() {}, passThroughOnException() {} },
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      const escaped = API_ERROR_MESSAGES_VI.ACCOUNT_LOCKED
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      assert.ok(html.includes(escaped), 'HTML phải chứa thông báo ACCOUNT_LOCKED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('@motion-ai/web — Story 1.10 Lịch sử credit & phân trang vô tận', () => {
  it('isUnauthorizedError: nhận diện đúng status 401, code UNAUTHORIZED, cause 401 và loại trừ 500/mạng', () => {
    assert.equal(isUnauthorizedError({ status: 401 }), true);
    assert.equal(isUnauthorizedError({ statusCode: 401 }), true);
    assert.equal(isUnauthorizedError({ code: 'UNAUTHORIZED' }), true);
    assert.equal(isUnauthorizedError({ cause: { status: 401 } }), true);
    assert.equal(isUnauthorizedError({ cause: { code: 'UNAUTHORIZED' } }), true);
    assert.equal(
      isUnauthorizedError(new MotionApiClientError({ status: 401, code: ApiErrorCode.UNAUTHORIZED })),
      true,
    );

    assert.equal(isUnauthorizedError({ status: 500 }), false);
    assert.equal(isUnauthorizedError({ code: 'RATE_LIMITED' }), false);
    assert.equal(isUnauthorizedError(null), false);
    assert.equal(isUnauthorizedError(undefined), false);
    assert.equal(isUnauthorizedError('some string'), false);
    assert.equal(isUnauthorizedError(new Error('network error')), false);
  });

  it('SSR render các trạng thái giao diện của pages/history.vue: đầy đủ 6 nhãn tiếng Việt, skeleton, chưa đăng nhập, rỗng, lỗi tải thêm & hết dữ liệu', async () => {
    const raw = fs.readFileSync(path.join(webRoot, 'pages/history.vue'), 'utf8');
    const { descriptor } = parse(raw);
    const compiled = compileTemplate({
      id: 'test-history-page',
      filename: 'history.vue',
      source: descriptor.template.content,
      ssr: true,
      ssrCssVars: [],
    });
    assert.equal(compiled.errors.length, 0, 'Template history.vue phải biên dịch thành công');

    const tmpFile = path.join(webRoot, 'test', `.tmp-history-${Date.now()}.mjs`);
    fs.writeFileSync(tmpFile, compiled.code, 'utf8');

    try {
      const { ssrRender } = await import(pathToFileURL(tmpFile).href);

      function createHistoryApp(overrides = {}) {
        const defaultState = {
          entries: MOCK_WALLET_LEDGER_ITEMS,
          ledgerAsync: {
            data: { value: { items: MOCK_WALLET_LEDGER_ITEMS, hasMore: false, nextCursor: null, pageSize: 20 } },
            pending: { value: false },
            error: { value: null },
            refresh: () => {},
          },
          isUnauthenticated: false,
          ledgerErrorVi: null,
          hasMore: false,
          loadingMore: false,
          loadMoreErrorVi: null,
          bottomSentinel: null,
          formatSignedCreditsVi,
          formatTimestampVi,
          refreshLedger: () => {},
          loadMore: () => {},
          ...overrides,
        };

        const app = createSSRApp({
          ssrRender,
          setup() {
            return defaultState;
          },
        });

        app.component('Icon', {
          props: ['name'],
          ssrRender(ctx, push) {
            push(`<span class="icon-${ctx.name}"></span>`);
          },
        });
        app.component('NuxtLink', {
          props: ['to'],
          ssrRender(ctx, push) {
            push(`<a href="${ctx.to}" ${ctx.$attrs?.['data-testid'] ? `data-testid="${ctx.$attrs['data-testid']}"` : ''}>Link</a>`);
          },
        });
        app.component('ApiErrorBanner', {
          props: ['messageVi', 'dismissible'],
          ssrRender(ctx, push) {
            if (ctx.messageVi) {
              push(`<div data-testid="api-error-banner">${ctx.messageVi}</div>`);
            }
          },
        });

        return app;
      }

      // 1. Trạng thái có danh sách: đủ 6 nhãn tiếng Việt và định dạng credit có dấu
      const populatedHtml = await renderToString(createHistoryApp());
      assert.match(populatedHtml, /data-testid="page-history"/);
      assert.match(populatedHtml, /data-testid="ledger-list"/);
      for (const label of ['Tặng', 'Nạp', 'Giữ', 'Hoàn', 'Chốt', 'Điều chỉnh']) {
        assert.ok(
          populatedHtml.includes(label),
          `Danh sách lịch sử phải chứa nhãn tiếng Việt: "${label}"`,
        );
      }
      assert.match(populatedHtml, /\+12\.000 credit/);
      assert.match(populatedHtml, /-250 credit/);
      assert.match(populatedHtml, /0 credit/);
      assert.match(populatedHtml, /text-cyber-success/);
      assert.match(populatedHtml, /text-cyber-warning/);
      assert.match(populatedHtml, /text-cyber-muted/);
      assert.match(populatedHtml, /data-testid="all-loaded-notice"/);
      assert.match(populatedHtml, /Đã hiển thị toàn bộ lịch sử/);

      // 2. Trạng thái đang tải trang đầu (skeleton)
      const skeletonHtml = await renderToString(
        createHistoryApp({
          entries: [],
          ledgerAsync: {
            pending: { value: true },
            data: { value: null },
            error: { value: null },
            refresh: () => {},
          },
        }),
      );
      assert.match(skeletonHtml, /data-testid="history-skeleton"/);
      assert.match(skeletonHtml, /animate-pulse/);
      assert.match(skeletonHtml, /role="status"/);
      assert.match(skeletonHtml, /aria-busy="true"/);
      assert.doesNotMatch(skeletonHtml, /data-testid="ledger-list"/);

      // 3. Trạng thái chưa đăng nhập: ưu tiên hiển thị thẻ chưa đăng nhập ngay cả khi entries đã có dữ liệu trước đó
      const unauthHtml = await renderToString(
        createHistoryApp({
          entries: MOCK_WALLET_LEDGER_ITEMS,
          isUnauthenticated: true,
          ledgerAsync: {
            pending: { value: false },
            data: { value: null },
            error: { value: new MotionApiClientError({ status: 401, code: 'UNAUTHORIZED' }) },
            refresh: () => {},
          },
        }),
      );
      assert.match(unauthHtml, /data-testid="history-unauthenticated"/);
      assert.match(unauthHtml, /Yêu Cầu Đăng Nhập/);
      assert.match(unauthHtml, /href="\/login"/);
      assert.doesNotMatch(unauthHtml, /data-testid="ledger-list"/);

      // 4. Trạng thái rỗng (đã đăng nhập, không có bút toán nào)
      const emptyHtml = await renderToString(
        createHistoryApp({
          entries: [],
          isUnauthenticated: false,
          ledgerErrorVi: null,
          ledgerAsync: {
            pending: { value: false },
            data: { value: { items: [], hasMore: false, nextCursor: null, pageSize: 20 } },
            error: { value: null },
            refresh: () => {},
          },
        }),
      );
      assert.match(emptyHtml, /data-testid="history-empty"/);
      assert.match(emptyHtml, /Chưa Có Biến Động Số Dư Nào/);
      assert.match(emptyHtml, /icon-lucide:inbox/);

      // 5. Trạng thái lỗi tải trang đầu khi danh sách rỗng (chỉ hiện thẻ trong khung, không trùng banner trên)
      const errorHtml = await renderToString(
        createHistoryApp({
          entries: [],
          isUnauthenticated: false,
          ledgerErrorVi: 'Máy chủ phản hồi chậm. Vui lòng thử lại.',
          ledgerAsync: {
            pending: { value: false },
            data: { value: null },
            error: { value: new Error('500') },
            refresh: () => {},
          },
        }),
      );
      assert.match(errorHtml, /data-testid="history-error-state"/);
      assert.match(errorHtml, /role="alert"/);
      assert.match(errorHtml, /Không Thể Tải Sổ Cái/);
      assert.match(errorHtml, /data-testid="history-retry-button"/);
      assert.doesNotMatch(errorHtml, /data-testid="api-error-banner"/);

      // 5b. Trạng thái lỗi làm mới khi danh sách đã có dữ liệu (banner trên hiện, danh sách cũ được giữ)
      const refreshErrorHtml = await renderToString(
        createHistoryApp({
          entries: MOCK_WALLET_LEDGER_ITEMS,
          isUnauthenticated: false,
          ledgerErrorVi: 'Không thể làm mới sổ cái.',
          ledgerAsync: {
            pending: { value: false },
            data: { value: { items: MOCK_WALLET_LEDGER_ITEMS, hasMore: false, nextCursor: null, pageSize: 20 } },
            error: { value: new Error('500') },
            refresh: () => {},
          },
        }),
      );
      assert.match(refreshErrorHtml, /data-testid="api-error-banner"/);
      assert.match(refreshErrorHtml, /data-testid="ledger-list"/);
      assert.doesNotMatch(refreshErrorHtml, /data-testid="history-error-state"/);

      // 6. Phân trang: có thêm trang (hasMore = true) hiển thị nút dự phòng và sentinel
      const hasMoreHtml = await renderToString(
        createHistoryApp({
          hasMore: true,
          loadingMore: false,
        }),
      );
      assert.match(hasMoreHtml, /data-testid="load-more-button"/);
      assert.match(hasMoreHtml, /data-testid="bottom-sentinel"/);
      assert.doesNotMatch(hasMoreHtml, /data-testid="all-loaded-notice"/);

      // 7. Phân trang: đang tải thêm (loadingMore = true) hiển thị spinner với role status
      const loadingMoreHtml = await renderToString(
        createHistoryApp({
          hasMore: true,
          loadingMore: true,
        }),
      );
      assert.match(loadingMoreHtml, /data-testid="loading-more-spinner"/);
      assert.match(loadingMoreHtml, /role="status"/);
      assert.match(loadingMoreHtml, /aria-live="polite"/);
      assert.match(loadingMoreHtml, /Đang tải thêm bút toán/);

      // 8. Phân trang: lỗi tải thêm hiển thị banner lỗi với role alert, không làm mất danh sách cũ
      const loadMoreErrorHtml = await renderToString(
        createHistoryApp({
          hasMore: true,
          loadingMore: false,
          loadMoreErrorVi: 'Lỗi đường truyền khi tải trang tiếp theo.',
        }),
      );
      assert.match(loadMoreErrorHtml, /data-testid="load-more-error"/);
      assert.match(loadMoreErrorHtml, /role="alert"/);
      assert.match(loadMoreErrorHtml, /data-testid="ledger-list"/);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it('hành vi logic phân trang cursor qua createWalletLedgerPagination: chống gọi trùng, giữ nguyên danh sách khi lỗi và làm mới sổ cái', async () => {
    const page1Items = [MOCK_WALLET_LEDGER_ITEMS[0], MOCK_WALLET_LEDGER_ITEMS[1]];
    // Chèn lặp ID MOCK_WALLET_LEDGER_ITEMS[0].id vào page2 để kiểm chứng deduplication
    const page2Items = [MOCK_WALLET_LEDGER_ITEMS[0], MOCK_WALLET_LEDGER_ITEMS[2], MOCK_WALLET_LEDGER_ITEMS[3]];
    const page3Items = [MOCK_WALLET_LEDGER_ITEMS[4]];

    const requestedCursors = [];
    let shouldFail = false;
    let isPending = false;

    const mockClient = {
      async getWalletLedger(query) {
        requestedCursors.push(query.cursor ?? null);
        if (shouldFail && query.cursor === 'cursor_p1') {
          throw new MotionApiClientError({ status: 500, code: null, serverMessage: 'Server 500' });
        }
        if (query.cursor === 'cursor_p1') {
          return {
            items: page2Items,
            pageSize: 2,
            hasMore: true,
            nextCursor: 'cursor_p2',
          };
        }
        if (query.cursor === 'cursor_p2') {
          return {
            items: page3Items,
            pageSize: 2,
            hasMore: false,
            nextCursor: null,
          };
        }
        return {
          items: page1Items,
          pageSize: 2,
          hasMore: true,
          nextCursor: 'cursor_p1',
        };
      },
    };

    const pagination = createWalletLedgerPagination({
      client: mockClient,
      pageSize: 2,
      isInitialPending: () => isPending,
    });

    pagination.syncInitialData({
      items: page1Items,
      pageSize: 2,
      hasMore: true,
      nextCursor: 'cursor_p1',
    });

    // 1. Tải ban đầu
    assert.equal(pagination.entries.value.length, 2);
    assert.equal(pagination.hasMore.value, true);
    assert.equal(pagination.nextCursor.value, 'cursor_p1');

    // 2. Tải thêm trang 2 thành công
    const okPage2 = await pagination.loadMore();
    assert.equal(okPage2, true);
    assert.equal(pagination.entries.value.length, 4);
    assert.equal(pagination.hasMore.value, true);
    assert.equal(pagination.nextCursor.value, 'cursor_p2');
    assert.equal(pagination.loadMoreErrorVi.value, null);

    // 3. Chống gọi trùng: khi isPending hoặc loadingMore đang chạy thì bỏ qua
    isPending = true;
    const callsBefore = requestedCursors.length;
    const okBlocked = await pagination.loadMore();
    assert.equal(okBlocked, false);
    assert.equal(requestedCursors.length, callsBefore, 'Không được gọi API khi đang pending');
    isPending = false;

    // 4. Lỗi tải thêm: giữ nguyên danh sách hiện tại và giữ nguyên cursor để thử lại
    shouldFail = true;
    pagination.nextCursor.value = 'cursor_p1'; // Thử lại cursor_p1 với lỗi
    const okFailed = await pagination.loadMore();
    assert.equal(okFailed, false);
    assert.equal(pagination.entries.value.length, 4, 'Bút toán đã tải trước đó không bị xóa khi lỗi');
    assert.ok(pagination.loadMoreErrorVi.value !== null);
    assert.equal(pagination.nextCursor.value, 'cursor_p1', 'Cursor phải được giữ nguyên để thử lại');

    // 5. Thử lại sau lỗi thành công
    shouldFail = false;
    const okRetry = await pagination.loadMore();
    assert.equal(okRetry, true);
    assert.equal(pagination.loadMoreErrorVi.value, null);
    assert.equal(pagination.nextCursor.value, 'cursor_p2');

    // 6. Tải trang cuối cùng: hasMore chuyển false, nextCursor chuyển null
    const okEnd = await pagination.loadMore();
    assert.equal(okEnd, true);
    assert.equal(pagination.hasMore.value, false);
    assert.equal(pagination.nextCursor.value, null);
    assert.equal(pagination.entries.value.length, 5);

    // 7. Bấm làm mới sổ cái: tải lại từ trang 1, đồng bộ lại danh sách ban đầu
    await pagination.refresh();
    assert.equal(pagination.entries.value.length, 2);
    assert.equal(pagination.hasMore.value, true);
    assert.equal(pagination.nextCursor.value, 'cursor_p1');
    assert.equal(pagination.loadMoreErrorVi.value, null);

    // 8. Làm mới thất bại qua onRefreshInitial: không làm mất additionalItems đã tải
    let refreshShouldFail = true;
    const paginationWithRefreshGuard = createWalletLedgerPagination({
      client: mockClient,
      pageSize: 2,
      onRefreshInitial: async () => {
        if (refreshShouldFail) {
          return undefined; // Mô phỏng useAsyncData.refresh() gặp lỗi
        }
        return {
          items: page1Items,
          pageSize: 2,
          hasMore: true,
          nextCursor: 'cursor_p1',
        };
      },
    });
    paginationWithRefreshGuard.syncInitialData({
      items: page1Items,
      pageSize: 2,
      hasMore: true,
      nextCursor: 'cursor_p1',
    });
    await paginationWithRefreshGuard.loadMore();
    assert.equal(paginationWithRefreshGuard.entries.value.length, 4);

    // Khi refresh thất bại, entries phải giữ nguyên 4
    await paginationWithRefreshGuard.refresh();
    assert.equal(
      paginationWithRefreshGuard.entries.value.length,
      4,
      'Khi refresh thất bại, additionalItems không được bị xóa',
    );

    // Khi refresh thành công, entries được đồng bộ về 2
    refreshShouldFail = false;
    await paginationWithRefreshGuard.refresh();
    assert.equal(
      paginationWithRefreshGuard.entries.value.length,
      2,
      'Khi refresh thành công, syncInitialData cập nhật lại trang đầu',
    );

    // 9. Chuẩn hóa hasMore khi nextCursor rỗng hoặc null
    const emptyCursorPagination = createWalletLedgerPagination({
      client: mockClient,
      pageSize: 2,
      initialData: () => ({
        items: page1Items,
        pageSize: 2,
        hasMore: true,
        nextCursor: null,
      }),
    });
    assert.equal(
      emptyCursorPagination.hasMore.value,
      false,
      'hasMore phải là false nếu nextCursor là null',
    );
  });

  it('formatTimestampVi xử lý chuỗi rỗng và chuỗi không hợp lệ an toàn mà không ném RangeError', () => {
    assert.equal(formatTimestampVi(''), '-');
    assert.equal(formatTimestampVi('invalid-date'), '-');
    const formatted = formatTimestampVi('2026-11-03T12:00:00.000Z');
    assert.ok(formatted.length > 5);
  });

  it('logic isUnauthenticated xác định đúng trạng thái chưa đăng nhập khi không pending', () => {
    function computeIsUnauthenticated({ isUnauthorized, isAuthenticated, isPending }) {
      if (isUnauthorized) return true;
      if (!isAuthenticated && !isPending) return true;
      return false;
    }
    assert.equal(computeIsUnauthenticated({ isUnauthorized: true, isAuthenticated: false, isPending: false }), true);
    assert.equal(computeIsUnauthenticated({ isUnauthorized: false, isAuthenticated: false, isPending: false }), true);
    assert.equal(computeIsUnauthenticated({ isUnauthorized: false, isAuthenticated: true, isPending: false }), false);
    assert.equal(computeIsUnauthenticated({ isUnauthorized: false, isAuthenticated: false, isPending: true }), false);
  });

  it('tuân thủ vùng chạm tối thiểu 48px (touch-target) và không chứa emoji UTF-8 trong pages/history.vue', () => {
    const historyFile = path.join(webRoot, 'pages/history.vue');
    const content = fs.readFileSync(historyFile, 'utf8');

    // Không chứa emoji
    const emojiRegex = /\p{Extended_Pictographic}/u;
    assert.equal(
      emojiRegex.test(content),
      false,
      'pages/history.vue không được chứa ký tự emoji UTF-8',
    );

    // Vùng chạm tối thiểu 48px
    assert.match(content, /touch-target.*min-h-\[48px\]/);
    assert.match(content, /data-testid="refresh-ledger-button"/);
    assert.match(content, /data-testid="history-login-button"/);
    assert.match(content, /data-testid="history-retry-button"/);
    assert.match(content, /data-testid="load-more-button"/);
  });

  it('SSR /history qua Cloudflare Pages Worker bundle trả 200, hiển thị danh sách bút toán và không có emoji', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const { pathname } = new URL(String(input));
      const makeJson = (body, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });

      if (pathname === '/config/pricing') {
        return makeJson(MOCK_PRICING_CONFIG_RESPONSE);
      }
      if (pathname === '/wallet/ledger') {
        return makeJson({
          items: MOCK_WALLET_LEDGER_ITEMS,
          pageSize: 20,
          hasMore: false,
          nextCursor: null,
        });
      }
      return makeJson({ code: 'UNAUTHORIZED' }, 401);
    };

    try {
      const worker = (await import('../.output/public/_worker.js/index.js')).default;
      const res = await worker.fetch(
        new Request('https://motion.ai.vn/history'),
        { ASSETS: { fetch: async () => new Response('x', { status: 404 }) } },
        { waitUntil() {}, passThroughOnException() {} },
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /data-testid="page-history"/);
      assert.match(html, /Tặng/);
      assert.match(html, /Nạp/);
      assert.match(html, /Giữ/);
      assert.match(html, /Hoàn/);
      assert.match(html, /Chốt/);
      assert.match(html, /Điều chỉnh/);
      assert.match(html, /Đã hiển thị toàn bộ lịch sử/);

      const emojiRegex = /\p{Extended_Pictographic}/u;
      assert.equal(emojiRegex.test(html), false, 'SSR /history không được chứa ký tự emoji UTF-8');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('SSR /history qua Cloudflare Pages Worker bundle khi nhận 401 UNAUTHORIZED render ra data-testid="history-unauthenticated"', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const { pathname } = new URL(String(input));
      const makeJson = (body, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });

      if (pathname === '/config/pricing') {
        return makeJson(MOCK_PRICING_CONFIG_RESPONSE);
      }
      if (pathname === '/wallet/ledger') {
        return makeJson({ code: 'UNAUTHORIZED', message: 'Unauthorized' }, 401);
      }
      return makeJson({ code: 'UNAUTHORIZED' }, 401);
    };

    try {
      const worker = (await import('../.output/public/_worker.js/index.js')).default;
      const res = await worker.fetch(
        new Request('https://motion.ai.vn/history'),
        { ASSETS: { fetch: async () => new Response('x', { status: 404 }) } },
        { waitUntil() {}, passThroughOnException() {} },
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /data-testid="page-history"/);
      assert.match(html, /data-testid="history-unauthenticated"/);
      assert.match(html, /Yêu Cầu Đăng Nhập/);
      assert.match(html, /data-testid="history-login-button"/);
      assert.doesNotMatch(html, /data-testid="ledger-list"/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
