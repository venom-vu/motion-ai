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
  MOCK_FACE_SWAP_CREATE_REQUEST,
  MOCK_ME_PRO_RESPONSE,
  MOCK_PRICING_CONFIG_RESPONSE,
  MOCK_TASK_CANCELLED,
  MOCK_TASK_FAILED,
  MOCK_TASK_QUEUED,
  MOCK_TASK_RUNNING,
  MOCK_TASK_SUCCEEDED,
  MOCK_TASK_TIMED_OUT,
  MOCK_UPLOAD_CONFIRM_RESPONSE,
  MOCK_UPLOAD_CREATE_RESPONSE,
  MOCK_WALLET_LEDGER_ITEMS,
  TOS_VERSION,
} from '@motion-ai/contracts';
import { SLATE_CYBER_COLORS } from '../tailwind.config.ts';
import {
  MotionApiClientError,
  createMotionApiClient,
  resolveApiErrorMessageVi,
  uploadPresignedFile,
} from '../utils/api-client.ts';
import {
  formatFileSizeVi,
  getImageDimensions,
  normalizeImageMimeType,
  validateImageFile,
} from '../utils/image-upload.ts';
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

  it('createSessionLostHandler: đánh dấu đã kiểm tra, chỉ xóa dữ liệu và về trang chủ khi request đã mang token', async () => {
    const calls = [];
    const handler = createSessionLostHandler({
      markChecked: () => calls.push('mark'),
      clearData: () => calls.push('clear'),
      navigate: (path) => calls.push(`nav:${path}`),
    });
    await handler(true);
    assert.deepEqual(calls, ['mark', 'clear', 'nav:/']);
    calls.length = 0;
    await handler(false);
    assert.deepEqual(calls, ['mark'], 'khách xem công khai giữ nguyên trang');
  });

  it('runLogout về trang chủ và đi qua cùng hằng đường dẫn', async () => {
    const paths = [];
    await runLogout({
      apiLogout: async () => {},
      clearSession: () => {},
      navigate: (path) => paths.push(path),
    });
    assert.deepEqual(paths, ['/']);
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

  it('runLogout: API lỗi vẫn xóa phiên rồi về trang chủ', async () => {
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
      assert.match(unauthHtml, /<button[^>]*data-testid="history-login-button"/);
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

describe('@motion-ai/web — Header cố định, popover tài khoản và đăng nhập bằng dialog', () => {
  const read = (rel) => fs.readFileSync(path.join(webRoot, rel), 'utf8');
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('không còn trang /login và không còn đường dẫn /login trong mã nguồn FE', () => {
    assert.equal(fs.existsSync(path.join(webRoot, 'pages/login.vue')), false);
    for (const rel of [
      'components/AppTopHeader.vue',
      'components/AppBottomNav.vue',
      'components/AccountPopover.vue',
      'pages/history.vue',
      'utils/auth-session.ts',
    ]) {
      assert.doesNotMatch(read(rel), /['"`]\/login['"`]/, `${rel} không được trỏ tới /login`);
    }
  });

  it('header cố định (fixed) và layout chừa 68px, không còn sticky', () => {
    const header = read('components/AppTopHeader.vue');
    assert.match(header, /fixed inset-x-0 top-0/);
    assert.doesNotMatch(header, /sticky top-0/);
    assert.match(read('layouts/default.vue'), /pt-\[68px\]/);
  });

  it('header: menu căn trái; khách thấy Bảng giá, đã đăng nhập thấy Nạp Credit sát avatar', () => {
    const header = read('components/AppTopHeader.vue');
    assert.doesNotMatch(header, /Lịch Sử|lucide:history/);
    assert.doesNotMatch(header, /labelVi: 'Bảng Giá'/);
    // Menu nằm ngay sau logo (không justify-between), cụm bên phải đẩy sang phải bằng ml-auto.
    assert.doesNotMatch(header, /justify-between/);
    assert.match(header, /ml-auto flex items-center/);
    // Khách: Bảng giá; đã đăng nhập: Nạp Credit đứng trước khung credit.
    assert.match(header, /v-if="!isLoggedIn"[\s\S]{0,80}data-testid="pricing-link"[\s\S]*?>\s*Bảng giá\s*</);
    assert.match(header, /v-if="isLoggedIn"[\s\S]{0,80}data-testid="topup-link"[\s\S]*?<span>Nạp Credit<\/span>/);
    assert.ok(
      header.indexOf('data-testid="credit-badge"') < header.indexOf('data-testid="topup-link"') &&
        header.indexOf('data-testid="topup-link"') < header.indexOf('<AccountPopover'),
      'Nạp Credit phải nằm giữa khung credit và avatar (sát avatar)',
    );
    assert.match(header, /bg-cyber-violet[^"]*text-cyber-text[^"]*hover:bg-cyber-violet\/90/);
    assert.match(header, /v-if="isLoggedIn"[\s\S]{0,120}data-testid="credit-badge"/);
    assert.match(header, /<AccountPopover v-if="isLoggedIn"/);
    assert.match(header, /data-testid="login-button"/);
  });

  it('trang Bảng giá và Lịch sử không còn chú thích endpoint API; Bảng giá bỏ 3 card đơn giá công cụ', () => {
    const pricing = read('pages/pricing.vue');
    const history = read('pages/history.vue');
    assert.doesNotMatch(pricing, /GET \/config\/pricing|đồng bộ/);
    assert.doesNotMatch(pricing, /pricing-pipelines-section|credit \/ lượt|credit \/ giây/);
    assert.match(pricing, /data-testid="pricing-tiers-grid"/);
    assert.doesNotMatch(history, /GET \/wallet\/ledger|Sổ cái bất biến/);
  });

  it('popover có Thông tin tài khoản, Lịch sử (sang /history) và Đăng xuất', () => {
    const popover = read('components/AccountPopover.vue');
    assert.match(popover, /data-testid="account-button"/);
    assert.match(popover, /data-testid="menu-account-info"/);
    assert.match(popover, /openAuthDialog\('account'\)/);
    assert.match(popover, /data-testid="menu-history"/);
    assert.match(popover, /navigateTo\('\/history'\)/);
    assert.match(popover, /data-testid="logout-button"/);
    assert.match(popover, /Escape/);
    assert.match(popover, /pointerdown/);
  });

  it('dialog thông tin tài khoản không còn nút đăng xuất', () => {
    const dialog = read('components/AuthDialog.vue');
    assert.doesNotMatch(dialog, /logout-button|Đăng xuất|useAuth\(/);
  });

  it('khách bấm tab Tôi mở dialog đăng nhập thay vì chuyển trang', () => {
    const nav = read('components/AppBottomNav.vue');
    assert.match(nav, /openAuthDialog\('login'\)/);
    assert.doesNotMatch(nav, /navigateTo/);
  });

  it('SSR trang chủ khi chưa đăng nhập: header cố định, có nút Đăng nhập và Bảng giá, ẩn credit và avatar', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const { pathname } = new URL(String(input));
      if (pathname === '/config/pricing') return json(MOCK_PRICING_CONFIG_RESPONSE);
      return json({ code: 'UNAUTHORIZED' }, 401);
    };
    try {
      const worker = (await import('../.output/public/_worker.js/index.js')).default;
      const res = await worker.fetch(
        new Request('https://motion.ai.vn/'),
        { ASSETS: { fetch: async () => new Response('x', { status: 404 }) } },
        { waitUntil() {}, passThroughOnException() {} },
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /data-testid="app-top-header"[^>]*fixed/);
      assert.match(html, /data-testid="login-button"/);
      assert.match(html, /data-testid="pricing-link"/);
      assert.doesNotMatch(html, /data-testid="credit-badge"/);
      assert.doesNotMatch(html, /data-testid="account-button"/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('/login không còn là trang riêng (không render page-login)', async () => {
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
      const html = await res.text();
      assert.doesNotMatch(html, /data-testid="page-login"/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('@motion-ai/web — Story 2.10 Thành phần tải ảnh có cam kết ToS', () => {
  it('kiểm tra tính hợp lệ phía client: từ chối MIME không hỗ trợ, file > 10MB, cạnh ngắn < 512px, tỷ lệ sai', async () => {
    // 1. MIME không hỗ trợ (ví dụ image/gif)
    const gifFile = {
      name: 'animation.gif',
      type: 'image/gif',
      size: 1024 * 100,
      width: 600,
      height: 600,
    };
    const resMime = await validateImageFile(gifFile);
    assert.equal(resMime.valid, false);
    assert.match(resMime.errorVi, /Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP/);

    // 2. Dung lượng quá 10 MB
    const largeFile = {
      name: 'large.jpg',
      type: 'image/jpeg',
      size: 11 * 1024 * 1024,
      width: 1000,
      height: 1000,
    };
    const resSize = await validateImageFile(largeFile);
    assert.equal(resSize.valid, false);
    assert.match(resSize.errorVi, /10 MB/);

    // 3. Cạnh ngắn < 512px
    const smallFile = {
      name: 'small.png',
      type: 'image/png',
      size: 1024 * 50,
      width: 480,
      height: 800,
    };
    const resSmall = await validateImageFile(smallFile);
    assert.equal(resSmall.valid, false);
    assert.match(resSmall.errorVi, /512px/);

    // 4. Tỷ lệ vượt quá 2:1 (ví dụ 1400x600 = 2.33:1, cạnh ngắn 600 >= 512px)
    const wideFile = {
      name: 'wide.webp',
      type: 'image/webp',
      size: 1024 * 100,
      width: 1400,
      height: 600,
    };
    const resWide = await validateImageFile(wideFile);
    assert.equal(resWide.valid, false);
    assert.match(resWide.errorVi, /1:2 đến 2:1/);

    // 5. Ảnh hợp lệ (JPG 800x1000, tỷ lệ 1.25, 2 MB)
    const validFile = {
      name: 'portrait.jpg',
      type: 'image/jpeg',
      size: 2 * 1024 * 1024,
      width: 800,
      height: 1000,
    };
    const resValid = await validateImageFile(validFile);
    assert.equal(resValid.valid, true);
    assert.equal(resValid.meta.width, 800);
    assert.equal(resValid.meta.height, 1000);

    const dims = await getImageDimensions(validFile);
    assert.equal(dims.width, 800);
    assert.equal(dims.height, 1000);
  });

  it('createMotionApiClient hỗ trợ createUpload và confirmUpload đúng schema', async () => {
    let requestedPath = '';
    let requestedMethod = '';

    const mockFetch = async (url, init) => {
      const u = new URL(String(url));
      requestedPath = u.pathname;
      requestedMethod = init.method;

      if (u.pathname === '/uploads' && init.method === 'POST') {
        return Response.json(MOCK_UPLOAD_CREATE_RESPONSE);
      }
      if (u.pathname.includes('/confirm') && init.method === 'POST') {
        return Response.json(MOCK_UPLOAD_CONFIRM_RESPONSE);
      }
      return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
    };

    const client = createMotionApiClient({
      baseUrl: 'http://localhost:8080',
      fetchImpl: mockFetch,
    });

    // 1. createUpload
    const created = await client.createUpload({
      mimeType: 'image/jpeg',
      sizeBytes: 2 * 1024 * 1024,
    });
    assert.equal(requestedPath, '/uploads');
    assert.equal(requestedMethod, 'POST');
    assert.equal(created.key, MOCK_UPLOAD_CREATE_RESPONSE.key);
    assert.equal(created.method, 'PUT');

    // 2. confirmUpload
    const confirmed = await client.confirmUpload(created.key);
    assert.match(requestedPath, /\/confirm$/);
    assert.equal(requestedMethod, 'POST');
    assert.equal(confirmed.key, MOCK_UPLOAD_CONFIRM_RESPONSE.key);
    assert.equal(confirmed.image.width, 1024);
  });

  it('uploadPresignedFile tải file qua PUT, đo tiến trình và hỗ trợ hủy bằng AbortSignal', async () => {
    let headersReceived = {};

    const mockFetch = async (url, init) => {
      headersReceived = init.headers;
      if (init.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return new Response('', { status: 200 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const dummyFile = new Blob(['sample-image-content'], {
        type: 'image/jpeg',
      });
      let progressReported = 0;

      await uploadPresignedFile({
        uploadUrl: 'https://r2.storage.example/presigned',
        file: dummyFile,
        headers: { 'Content-Type': 'image/jpeg' },
        onProgress: (p) => {
          progressReported = p;
        },
      });

      assert.equal(headersReceived['Content-Type'], 'image/jpeg');
      assert.equal(progressReported, 100);

      // Thử hủy bằng controller đã abort
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        () =>
          uploadPresignedFile({
            uploadUrl: 'https://r2.storage.example/presigned',
            file: dummyFile,
            signal: controller.signal,
          }),
        (err) => err.name === 'AbortError',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('SSR render ImageUploader: đầy đủ các thành phần, input file accept, ToS checkbox phiên bản 2026-11-01 và touch target >= 48px', async () => {
    const uploaderSfcRaw = fs.readFileSync(
      path.join(webRoot, 'components/ImageUploader.vue'),
      'utf8',
    );
    const { descriptor } = parse(uploaderSfcRaw);
    const compiled = compileTemplate({
      id: 'test-image-uploader',
      filename: 'ImageUploader.vue',
      source: descriptor.template.content,
      ssr: true,
      ssrCssVars: [],
    });
    assert.equal(compiled.errors.length, 0);

    const tmpUploaderFile = path.join(
      webRoot,
      'test',
      `.tmp-uploader-${Date.now()}.mjs`,
    );
    fs.writeFileSync(tmpUploaderFile, compiled.code, 'utf8');

    try {
      const { ssrRender } = await import(pathToFileURL(tmpUploaderFile).href);

      // 1. Trạng thái idle
      const idleApp = createSSRApp({
        ssrRender,
        setup() {
          return {
            status: 'idle',
            labelVi: 'Tải ảnh khuôn mặt',
            descriptionVi: 'JPG, PNG, WebP ≤ 10 MB',
            idPrefix: 'test-uploader',
            disabled: false,
            showTosConsent: true,
            isUploading: false,
            isDragging: false,
            localConsent: false,
            TOS_VERSION,
            openLibrary: () => {},
            openCamera: () => {},
            onFileInputChange: () => {},
            onDrop: () => {},
            updateConsent: () => {},
          };
        },
      });
      idleApp.component('Icon', {
        props: ['name'],
        ssrRender(_ctx, push) {
          push('<span class="icon-mock"></span>');
        },
      });
      idleApp.component('ApiErrorBanner', {
        props: ['messageVi'],
        ssrRender() {},
      });

      const idleHtml = await renderToString(idleApp);
      assert.match(idleHtml, /data-testid="image-uploader"/);
      assert.match(idleHtml, /data-testid="open-library-button"/);
      assert.match(idleHtml, /data-testid="open-camera-button"/);
      assert.match(idleHtml, /data-testid="image-uploader-tos-checkbox"/);
      assert.match(idleHtml, /2026-11-01/);
      assert.match(idleHtml, /accept="image\/jpeg,image\/png,image\/webp"/);
      assert.match(idleHtml, /capture="environment"/);
      assert.match(idleHtml, /touch-target/);

      // 2. Trạng thái ready (đã tải xong)
      const readyApp = createSSRApp({
        ssrRender,
        setup() {
          return {
            status: 'ready',
            idPrefix: 'test-ready',
            previewUrl: '/preview-sample.jpg',
            currentFile: { name: 'portrait.jpg', size: 1024 * 1024 },
            currentMeta: {
              width: 1024,
              height: 1280,
              mimeType: 'image/jpeg',
              sizeBytes: 1024 * 1024,
            },
            disabled: false,
            isUploading: false,
            showTosConsent: true,
            localConsent: true,
            TOS_VERSION,
            formatFileSizeVi,
            handleChangeImage: () => {},
            handleCancel: () => {},
            updateConsent: () => {},
          };
        },
      });
      readyApp.component('Icon', {
        props: ['name'],
        ssrRender(_ctx, push) {
          push('<span class="icon-mock"></span>');
        },
      });
      readyApp.component('ApiErrorBanner', {
        props: ['messageVi'],
        ssrRender() {},
      });

      const readyHtml = await renderToString(readyApp);
      assert.match(readyHtml, /data-testid="upload-ready-state"/);
      assert.match(readyHtml, /data-testid="image-preview"/);
      assert.match(readyHtml, /data-testid="change-image-button"/);
      assert.match(readyHtml, /data-testid="remove-image-button"/);
      assert.match(readyHtml, /1024 × 1280 px/);

      // 3. Trạng thái uploading: thanh tiến trình với ARIA role progressbar và nút hủy
      const uploadingApp = createSSRApp({
        ssrRender,
        setup() {
          return {
            status: 'uploading',
            idPrefix: 'test-uploading',
            uploadProgress: 65,
            currentFile: { name: 'sample.jpg', size: 1024 * 512 },
            showTosConsent: false,
            localConsent: false,
            TOS_VERSION,
            formatFileSizeVi,
            handleCancel: () => {},
          };
        },
      });
      uploadingApp.component('Icon', {
        props: ['name'],
        ssrRender(_ctx, push) {
          push('<span class="icon-mock"></span>');
        },
      });
      const uploadingHtml = await renderToString(uploadingApp);
      assert.match(uploadingHtml, /data-testid="uploading-state"/);
      assert.match(uploadingHtml, /role="progressbar"/);
      assert.match(uploadingHtml, /aria-valuenow="65"/);
      assert.match(uploadingHtml, /data-testid="cancel-upload-button"/);

      // 4. Trạng thái error: banner tiếng Việt kèm hai nút chọn lại (thư viện + camera)
      const errorApp = createSSRApp({
        ssrRender,
        setup() {
          return {
            status: 'error',
            idPrefix: 'test-error',
            errorMessageVi: 'Tệp không hợp lệ',
            showTosConsent: false,
            localConsent: false,
            TOS_VERSION,
            handleRetry: () => {},
            handleCancel: () => {},
            openLibrary: () => {},
            openCamera: () => {},
          };
        },
      });
      errorApp.component('Icon', {
        props: ['name'],
        ssrRender(_ctx, push) {
          push('<span class="icon-mock"></span>');
        },
      });
      errorApp.component('ApiErrorBanner', {
        props: ['messageVi'],
        ssrRender(ctx, push) {
          push(`<div data-testid="api-error-banner">${ctx.messageVi}</div>`);
        },
      });
      const errorHtml = await renderToString(errorApp);
      assert.match(errorHtml, /data-testid="upload-error-state"/);
      assert.match(errorHtml, /data-testid="reselect-image-button"/);
      assert.match(errorHtml, /data-testid="reselect-camera-button"/);
    } finally {
      if (fs.existsSync(tmpUploaderFile)) {
        fs.unlinkSync(tmpUploaderFile);
      }
    }
  });

  it('normalizeImageMimeType chuẩn hóa đúng MIME và đuôi tệp cho thiết bị di động', () => {
    assert.equal(normalizeImageMimeType('', 'photo.jpg'), 'image/jpeg');
    assert.equal(normalizeImageMimeType('image/jpg', 'photo.jpg'), 'image/jpeg');
    assert.equal(normalizeImageMimeType('IMAGE/PNG', 'photo.png'), 'image/png');
    assert.equal(normalizeImageMimeType('', 'avatar.webp'), 'image/webp');
    assert.equal(normalizeImageMimeType('application/pdf', 'file.pdf'), 'application/pdf');
  });

  it('FeatureWorkspaceDialog tích hợp ImageUploader và vô hiệu hóa nút Submit khi chưa tải ảnh hoặc chưa tích ToS (FR19)', async () => {
    const dialogRaw = fs.readFileSync(
      path.join(webRoot, 'components/FeatureWorkspaceDialog.vue'),
      'utf8',
    );
    assert.match(dialogRaw, /ImageUploader/);
    assert.match(dialogRaw, /v-model="uploadedKey"/);
    assert.match(dialogRaw, /v-model:consent="acceptedConsent"/);
    assert.match(dialogRaw, /canSubmit/);
  });

  it('MotionApiClientError bảo toàn serverMessage tùy biến khi code là null và chuẩn hóa mã ApiErrorCode', () => {
    // 1. Trường hợp code là null nhưng có serverMessage tiếng Việt tùy biến
    const customErr = new MotionApiClientError({
      status: 400,
      code: null,
      serverMessage: 'Không thể kết nối tới máy chủ tải ảnh',
    });
    assert.equal(customErr.status, 400);
    assert.equal(customErr.code, null);
    assert.equal(customErr.userMessageVi, 'Không thể kết nối tới máy chủ tải ảnh');
    assert.equal(customErr.message, 'Không thể kết nối tới máy chủ tải ảnh');
    assert.equal(resolveApiErrorMessageVi(customErr), 'Không thể kết nối tới máy chủ tải ảnh');

    // 2. Trường hợp có mã ApiErrorCode hợp lệ
    const codeErr = new MotionApiClientError({
      status: 403,
      code: ApiErrorCode.INSUFFICIENT_CREDIT,
    });
    assert.equal(codeErr.code, ApiErrorCode.INSUFFICIENT_CREDIT);
    assert.equal(
      codeErr.userMessageVi,
      API_ERROR_MESSAGES_VI[ApiErrorCode.INSUFFICIENT_CREDIT],
    );

    // 3. Trường hợp cả code và serverMessage đều null -> fallback mặc định
    const fallbackErr = new MotionApiClientError({
      status: 500,
      code: null,
    });
    assert.match(fallbackErr.userMessageVi, /Đã xảy ra lỗi không xác định/);
  });

  it('uploadPresignedFile hoạt động chính xác với XMLHttpRequest (tiến trình, hoàn tất, lỗi HTTP, lỗi mạng, hủy AbortSignal)', async () => {
    const originalXHR = globalThis.XMLHttpRequest;

    try {
      // 1. Kiểm tra thành công và gọi onProgress
      const progressValues = [];
      let xhrHeaders = {};
      globalThis.XMLHttpRequest = class MockXHR {
        constructor() {
          this.upload = {};
          this.headers = {};
          xhrHeaders = this.headers;
        }
        open(method, url) {
          this.method = method;
          this.url = url;
        }
        setRequestHeader(k, v) {
          this.headers[k] = v;
        }
        send() {
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded: 50,
            total: 100,
          });
          this.status = 200;
          this.onload?.();
        }
        abort() {}
      };

      const mockFile = new Blob(['sample-content'], { type: 'image/jpeg' });
      await uploadPresignedFile({
        uploadUrl: 'https://r2.example.com/upload-test',
        headers: { 'Content-Type': 'image/jpeg' },
        file: mockFile,
        onProgress: (p) => progressValues.push(p),
      });

      assert.equal(progressValues.includes(50), true);
      assert.equal(progressValues[progressValues.length - 1], 100);
      assert.equal(xhrHeaders['Content-Type'], 'image/jpeg');

      // 2. Kiểm tra lỗi HTTP (status 403) ném MotionApiClientError
      globalThis.XMLHttpRequest = class FailingXHR {
        open() {}
        setRequestHeader() {}
        send() {
          this.status = 403;
          this.onload?.();
        }
        abort() {}
      };

      await assert.rejects(
        uploadPresignedFile({
          uploadUrl: 'https://r2.example.com/upload-fail',
          file: mockFile,
        }),
        (err) => {
          assert.ok(err instanceof MotionApiClientError);
          assert.equal(err.status, 403);
          assert.match(err.message, /HTTP 403/);
          return true;
        },
      );

      // 3. Kiểm tra lỗi kết nối mạng (onerror)
      globalThis.XMLHttpRequest = class NetworkErrXHR {
        open() {}
        setRequestHeader() {}
        send() {
          this.status = 0;
          this.onerror?.();
        }
        abort() {}
      };

      await assert.rejects(
        uploadPresignedFile({
          uploadUrl: 'https://r2.example.com/network-err',
          file: mockFile,
        }),
        (err) => {
          assert.ok(err instanceof MotionApiClientError);
          assert.equal(err.status, 0);
          assert.match(err.message, /Lỗi kết nối mạng/);
          return true;
        },
      );

      // 4. Kiểm tra AbortSignal hủy tải lên
      let abortedCalled = false;
      globalThis.XMLHttpRequest = class AbortableXHR {
        open() {}
        setRequestHeader() {}
        send() {}
        abort() {
          abortedCalled = true;
        }
      };

      const ac = new AbortController();
      const abortPromise = uploadPresignedFile({
        uploadUrl: 'https://r2.example.com/abort-test',
        file: mockFile,
        signal: ac.signal,
      });
      ac.abort();

      await assert.rejects(abortPromise, (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      });
      assert.equal(abortedCalled, true);
    } finally {
      globalThis.XMLHttpRequest = originalXHR;
    }
  });

  it('getImageDimensions truyền { imageOrientation: "from-image" } cho createImageBitmap', async () => {
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    let passedOptions = null;
    try {
      globalThis.createImageBitmap = async (_file, options) => {
        passedOptions = options;
        return {
          width: 800,
          height: 1000,
          close: () => {},
        };
      };

      const dummyFile = new Blob([''], { type: 'image/jpeg' });
      const dims = await getImageDimensions(dummyFile);
      assert.equal(dims.width, 800);
      assert.equal(dims.height, 1000);
      assert.deepEqual(passedOptions, { imageOrientation: 'from-image' });
    } finally {
      globalThis.createImageBitmap = originalCreateImageBitmap;
    }
  });

  it('FeatureWorkspaceDialog SSR kiểm tra trạng thái disabled của submit-task-button theo canSubmit', async () => {
    const dialogRaw = fs.readFileSync(
      path.join(webRoot, 'components/FeatureWorkspaceDialog.vue'),
      'utf8',
    );
    const { descriptor } = parse(dialogRaw);
    const compiled = compileTemplate({
      id: 'test-fwd-submit-button',
      filename: 'FeatureWorkspaceDialog.vue',
      source: descriptor.template.content,
      ssr: true,
      ssrCssVars: [],
    });
    assert.equal(compiled.errors.length, 0);

    const tmpFile = path.join(webRoot, 'test', `.tmp-fwd-test-${Date.now()}.mjs`);
    fs.writeFileSync(tmpFile, compiled.code, 'utf8');

    try {
      const { ssrRender } = await import(pathToFileURL(tmpFile).href);

      const makeDialogApp = (canSubmitValue) => {
        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              open: true,
              feature: {
                id: 'face-swap',
                titleVi: 'Thay Đổi Khuôn Mặt',
                icon: 'lucide:sparkles',
                category: 'face',
                pricingMode: 'per_image',
                credits: 100,
                priceNoteVi: '100 credit / lượt',
                descriptionVi: 'Mô tả test',
                inputRequirementVi: 'Tải ảnh chân dung rõ mặt',
              },
              userTier: 'FREE',
              userBalance: 500,
              isAuthenticated: true,
              hasEnoughBalance: true,
              canSubmit: canSubmitValue,
              uploadedKey: canSubmitValue ? 'in/mock/sample.jpg' : null,
              sourceKey: null,
              targetKey: null,
              acceptedConsent: canSubmitValue,
              mockMode: false,
              activeTask: null,
              isSubmitting: false,
              submitErrorVi: null,
              compareSplitPercent: 50,
              TOS_VERSION,
              estimatedCredits: 100,
              formatNumberVi: (n) => String(n),
              emit: () => {},
              handleSubmit: () => {},
            };
          },
        });
        app.component('Icon', {
          props: ['name'],
          ssrRender(_ctx, push) {
            push('<span class="icon-mock"></span>');
          },
        });
        app.component('NuxtLink', {
          props: ['to'],
          ssrRender(_ctx, push) {
            push('<a href="#">MockLink</a>');
          },
        });
        app.component('ImageUploader', {
          props: ['modelValue', 'consent'],
          ssrRender(_ctx, push) {
            push('<div data-testid="mock-image-uploader"></div>');
          },
        });
        app.component('TaskProgressCard', {
          props: ['task'],
          ssrRender(_ctx, push) {
            push('<div data-testid="mock-task-progress-card"></div>');
          },
        });
        return app;
      };

      // canSubmit = false -> nút submit phải có thuộc tính disabled
      const disabledHtml = await renderToString(makeDialogApp(false));
      assert.match(
        disabledHtml,
        /<button[^>]*data-testid="submit-task-button"[^>]*\sdisabled(=|"|\s|>)/,
      );

      // canSubmit = true -> nút submit không có thuộc tính disabled (không nhầm với class disabled:...)
      const enabledHtml = await renderToString(makeDialogApp(true));
      assert.doesNotMatch(
        enabledHtml,
        /<button[^>]*data-testid="submit-task-button"[^>]*\sdisabled(=|"|\s|>)/,
      );
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  describe('@motion-ai/web — Story 2.11 Trang Face Swap và tiến trình xử lý', () => {
    it('createMotionApiClient hỗ trợ createFaceSwapTask, getTask và cancelTask đúng schema hợp đồng', async () => {
      const calls = [];
      const mockFetch = async (input, init) => {
        const urlStr = String(input);
        calls.push({ url: urlStr, method: init?.method, body: init?.body });

        if (urlStr.endsWith('/tasks/face-swap')) {
          return Response.json(MOCK_TASK_QUEUED, { status: 201 });
        }
        if (urlStr.includes('/tasks/70000000-0000-4000-8000-000000000002')) {
          return Response.json(MOCK_TASK_RUNNING, { status: 200 });
        }
        if (urlStr.includes('/cancel')) {
          return Response.json(MOCK_TASK_CANCELLED, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      const client = createMotionApiClient({
        baseUrl: 'http://localhost:3001',
        fetchImpl: mockFetch,
      });

      // 1. Tạo Task Face Swap
      const createdTask = await client.createFaceSwapTask(
        MOCK_FACE_SWAP_CREATE_REQUEST,
      );
      assert.equal(createdTask.id, MOCK_TASK_QUEUED.id);
      assert.equal(createdTask.status, 'queued');
      assert.equal(createdTask.queuePosition, 3);
      assert.equal(calls[0].method, 'POST');
      assert.match(calls[0].url, /\/tasks\/face-swap$/);

      // 2. Lấy thông tin Task theo ID
      const fetchedTask = await client.getTask(
        '70000000-0000-4000-8000-000000000002',
      );
      assert.equal(fetchedTask.id, MOCK_TASK_RUNNING.id);
      assert.equal(fetchedTask.status, 'running');

      // 3. Hủy Task khi đang queued
      const cancelledTask = await client.cancelTask(
        '70000000-0000-4000-8000-000000000006',
      );
      assert.equal(cancelledTask.status, 'cancelled');
      assert.equal(cancelledTask.reasonCode, 'USER_CANCEL');

      // 4. Tự động unwrap payload bọc dạng { data: ... }
      const wrappedClient = createMotionApiClient({
        baseUrl: 'http://localhost:3001',
        fetchImpl: async () => Response.json({ code: 'OK', data: MOCK_TASK_QUEUED }),
      });
      const unwrappedTask = await wrappedClient.getTask(
        '70000000-0000-4000-8000-000000000001',
      );
      assert.equal(unwrappedTask.id, MOCK_TASK_QUEUED.id);
      assert.equal(unwrappedTask.status, 'queued');
    });

    it('TaskProgressCard SSR render chính xác các trạng thái vòng đời Task (queued, running, succeeded, failed, timed_out, cancelled)', async () => {
      const cardRaw = fs.readFileSync(
        path.join(webRoot, 'components/TaskProgressCard.vue'),
        'utf8',
      );
      const { descriptor } = parse(cardRaw);
      const compiled = compileTemplate({
        id: 'test-task-progress-card',
        filename: 'TaskProgressCard.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpCardFile = path.join(
        webRoot,
        'test',
        `.tmp-card-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpCardFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpCardFile).href);

        const makeCardApp = (taskData) => {
          const app = createSSRApp({
            ssrRender,
            setup() {
              return {
                localTask: taskData,
                isQueued: taskData.status === 'queued',
                isRunning: taskData.status === 'running',
                isSucceeded: taskData.status === 'succeeded',
                isFailed:
                  taskData.status === 'failed' ||
                  taskData.status === 'timed_out' ||
                  taskData.status === 'cancelled',
                reasonMessageVi:
                  taskData.status === 'cancelled'
                    ? 'Tác vụ đã được hủy theo yêu cầu của bạn.'
                    : taskData.reasonCode === 'NO_FACE'
                      ? 'Không tìm thấy khuôn mặt rõ ràng trong ảnh nguồn.'
                      : taskData.reasonCode === 'FREE_WAIT_EXPIRED'
                        ? 'Hết hạn thời gian chờ trong hàng đợi miễn phí.'
                        : 'Lỗi không xác định',
                actionErrorVi: null,
                isCancelling: false,
                pipelineLabelVi: 'Hoán đổi khuôn mặt',
                handleCancel: () => {},
                handleRetry: () => {},
              };
            },
          });
          app.component('Icon', {
            props: ['name'],
            ssrRender(_ctx, push) {
              push('<span class="icon-mock"></span>');
            },
          });
          app.component('NuxtLink', {
            props: ['to'],
            ssrRender(ctx, push, _parent, attrs) {
              const testIdAttr = attrs?.['data-testid']
                ? ` data-testid="${attrs['data-testid']}"`
                : '';
              push(`<a href="${ctx.to || '#'}"${testIdAttr}>MockLink</a>`);
            },
          });
          return app;
        };

        // 1. Queued: Vị trí hàng đợi #3 + Nút hủy
        const queuedHtml = await renderToString(
          makeCardApp(MOCK_TASK_QUEUED),
        );
        assert.match(queuedHtml, /data-testid="task-queued-state"/);
        assert.match(queuedHtml, /data-testid="queue-position-badge"/);
        assert.match(queuedHtml, /#3/);
        assert.match(queuedHtml, /data-testid="cancel-task-button"/);

        // 2. Running: Trạng thái thực thi + Thanh tiến trình nhịp xung + KHÔNG CÓ nút hủy
        const runningHtml = await renderToString(
          makeCardApp(MOCK_TASK_RUNNING),
        );
        assert.match(runningHtml, /data-testid="task-running-state"/);
        assert.match(runningHtml, /data-testid="running-status-badge"/);
        assert.match(runningHtml, /role="progressbar"/);
        assert.doesNotMatch(runningHtml, /data-testid="cancel-task-button"/);

        // 3. Succeeded: Hoàn tất + Nút xem kết quả
        const succeededHtml = await renderToString(
          makeCardApp(MOCK_TASK_SUCCEEDED),
        );
        assert.match(succeededHtml, /data-testid="task-succeeded-state"/);
        assert.match(succeededHtml, /data-testid="succeeded-status-badge"/);
        assert.match(succeededHtml, /data-testid="view-result-button"/);
        assert.match(succeededHtml, /data-testid="create-new-button"/);

        // 4. Failed với NO_FACE: Thông báo lý do + Hoàn 100% credit + Nút thử lại
        const failedHtml = await renderToString(
          makeCardApp(MOCK_TASK_FAILED),
        );
        assert.match(failedHtml, /data-testid="task-failed-state"/);
        assert.match(failedHtml, /data-testid="credit-refund-note"/);
        assert.match(failedHtml, /100% credit \(100 CR\)/);
        assert.match(failedHtml, /data-testid="retry-task-button"/);

        // 5. Timed out với FREE_WAIT_EXPIRED: Gợi ý nạp credit nâng hạng
        const timedOutHtml = await renderToString(
          makeCardApp(MOCK_TASK_TIMED_OUT),
        );
        assert.match(timedOutHtml, /data-testid="task-failed-state"/);
        assert.match(timedOutHtml, /data-testid="free-wait-expired-hint"/);
        assert.match(timedOutHtml, /data-testid="upgrade-tier-button"/);
        assert.match(timedOutHtml, /data-testid="credit-refund-note"/);

        // 6. Cancelled: Thông báo đã hủy
        const cancelledHtml = await renderToString(
          makeCardApp(MOCK_TASK_CANCELLED),
        );
        assert.match(cancelledHtml, /data-testid="task-failed-state"/);
        assert.match(cancelledHtml, /Tác vụ đã được hủy/);
      } finally {
        if (fs.existsSync(tmpCardFile)) {
          fs.unlinkSync(tmpCardFile);
        }
      }
    });

    it('pages/face-swap.vue SSR render đầy đủ 2 uploader, giá 100 credit, ToS checkbox và nút Tạo Face Swap', async () => {
      const pageRaw = fs.readFileSync(
        path.join(webRoot, 'pages/face-swap.vue'),
        'utf8',
      );
      const { descriptor } = parse(pageRaw);
      const compiled = compileTemplate({
        id: 'test-page-face-swap',
        filename: 'pages/face-swap.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpPageFile = path.join(
        webRoot,
        'test',
        `.tmp-page-fs-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpPageFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpPageFile).href);

        const makePageApp = ({
          hasBalance = true,
          canSubmitVal = false,
          hasTask = false,
          isAuth = true,
        }) => {
          const app = createSSRApp({
            ssrRender,
            setup() {
              return {
                faceSwapCreditCost: 100,
                userBalance: hasBalance ? 500 : 50,
                hasEnoughBalance: hasBalance,
                isAuthenticated: isAuth,
                canSubmit: canSubmitVal,
                isSubmitting: false,
                submitErrorVi: null,
                sourceKey: canSubmitVal ? 'in/mock/source.jpg' : null,
                targetKey: canSubmitVal ? 'in/mock/target.jpg' : null,
                acceptedConsent: canSubmitVal,
                activeTask: hasTask ? MOCK_TASK_QUEUED : null,
                isMockMode: false,
                TOS_VERSION,
                handleSubmit: () => {},
                handleReset: () => {},
                openAuthDialog: () => {},
              };
            },
          });
          app.component('Icon', {
            props: ['name'],
            ssrRender(_ctx, push) {
              push('<span class="icon-mock"></span>');
            },
          });
          app.component('NuxtLink', {
            props: ['to'],
            ssrRender(ctx, push, _parent, attrs) {
              const testIdAttr = attrs?.['data-testid']
                ? ` data-testid="${attrs['data-testid']}"`
                : '';
              push(`<a href="${ctx.to || '#'}"${testIdAttr}>MockLink</a>`);
            },
          });
          app.component('ImageUploader', {
            props: ['modelValue', 'idPrefix', 'labelVi'],
            ssrRender(_ctx, push) {
              push('<div data-testid="mock-uploader"></div>');
            },
          });
          app.component('TaskProgressCard', {
            props: ['task'],
            ssrRender(_ctx, push) {
              push('<div data-testid="mock-task-progress-card"></div>');
            },
          });
          return app;
        };

        // 1. Trạng thái form ban đầu (chưa đủ điều kiện submit)
        const initialHtml = await renderToString(
          makePageApp({ hasBalance: true, canSubmitVal: false, hasTask: false }),
        );
        assert.match(initialHtml, /data-testid="page-face-swap"/);
        assert.match(initialHtml, /data-testid="source-image-section"/);
        assert.match(initialHtml, /data-testid="target-image-section"/);
        assert.match(initialHtml, /data-testid="face-swap-tos-checkbox"/);
        assert.match(initialHtml, /100 Credit/);
        assert.match(initialHtml, /500 Credit/);
        assert.match(
          initialHtml,
          /<button[^>]*data-testid="create-face-swap-button"[^>]*\sdisabled(=|"|\s|>)/,
        );

        // 2. Trạng thái số dư dưới 100: hiện ghi chú và nút nạp credit
        const outOfCreditHtml = await renderToString(
          makePageApp({ hasBalance: false, canSubmitVal: false, hasTask: false }),
        );
        assert.match(outOfCreditHtml, /data-testid="insufficient-credit-note"/);
        assert.match(outOfCreditHtml, /data-testid="topup-credit-button"/);

        // 3. Trạng thái đủ điều kiện: nút submit bật
        const readyHtml = await renderToString(
          makePageApp({ hasBalance: true, canSubmitVal: true, hasTask: false }),
        );
        assert.doesNotMatch(
          readyHtml,
          /<button[^>]*data-testid="create-face-swap-button"[^>]*\sdisabled(=|"|\s|>)/,
        );

        // 4. Trạng thái đã có Task: render TaskProgressCard
        const taskActiveHtml = await renderToString(
          makePageApp({ hasBalance: true, canSubmitVal: false, hasTask: true }),
        );
        assert.match(taskActiveHtml, /data-testid="mock-task-progress-card"/);

        // 5. Trạng thái khách chưa đăng nhập: hiển thị banner yêu cầu đăng nhập
        const guestHtml = await renderToString(
          makePageApp({ hasBalance: true, canSubmitVal: false, hasTask: false, isAuth: false }),
        );
        assert.match(guestHtml, /data-testid="guest-login-notice"/);
        assert.match(guestHtml, /data-testid="face-swap-login-button"/);
      } finally {
        if (fs.existsSync(tmpPageFile)) {
          fs.unlinkSync(tmpPageFile);
        }
      }
    });

    it('FeatureWorkspaceDialog SSR render hỗ trợ 2 uploader cho Face Swap, nút mở trang riêng /face-swap và nút đăng nhập cho khách', async () => {
      const dialogRaw = fs.readFileSync(
        path.join(webRoot, 'components/FeatureWorkspaceDialog.vue'),
        'utf8',
      );
      const { descriptor } = parse(dialogRaw);
      const compiled = compileTemplate({
        id: 'test-fwd-face-swap-dual',
        filename: 'FeatureWorkspaceDialog.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpFwdFile = path.join(
        webRoot,
        'test',
        `.tmp-fwd-fs-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpFwdFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpFwdFile).href);

        const makeFwdApp = ({ isGuest = false }) => {
          const app = createSSRApp({
            ssrRender,
            setup() {
              return {
                open: true,
                feature: {
                  id: 'face-swap',
                  titleVi: 'Hoán Đổi Khuôn Mặt',
                  icon: 'lucide:sparkles',
                  category: 'face',
                  categoryLabelVi: 'Khuôn mặt',
                  pricingMode: 'per_image',
                  credits: 100,
                  priceBadgeVi: '100 CR / lượt',
                  descriptionVi: 'Mô tả test',
                  inputRequirementVi: 'Tải 2 ảnh',
                  beforeLabelVi: 'Ảnh gốc',
                  afterLabelVi: 'Ảnh sau swap',
                  outputFormatVi: 'JPEG',
                },
                userTier: 'FREE',
                userBalance: isGuest ? null : 500,
                isAuthenticated: !isGuest,
                hasEnoughBalance: !isGuest,
                canSubmit: false,
                uploadedKey: null,
                sourceKey: null,
                targetKey: null,
                acceptedConsent: false,
                mockMode: false,
                activeTask: null,
                isSubmitting: false,
                submitErrorVi: null,
                compareSplitPercent: 50,
                TOS_VERSION,
                estimatedCredits: 100,
                formatNumberVi: (n) => String(n),
                emit: () => {},
                handleSubmit: () => {},
                openAuthDialog: () => {},
              };
            },
          });
          app.component('Icon', {
            props: ['name'],
            ssrRender(_ctx, push) {
              push('<span class="icon-mock"></span>');
            },
          });
          app.component('NuxtLink', {
            props: ['to'],
            ssrRender(ctx, push, _parent, attrs) {
              const testIdAttr = attrs?.['data-testid']
                ? ` data-testid="${attrs['data-testid']}"`
                : '';
              push(`<a href="${ctx.to || '#'}"${testIdAttr}>MockLink</a>`);
            },
          });
          app.component('ImageUploader', {
            props: ['modelValue', 'idPrefix', 'labelVi'],
            ssrRender(ctx, push) {
              push(`<div data-testid="mock-uploader-${ctx.idPrefix || 'default'}"></div>`);
            },
          });
          app.component('TaskProgressCard', {
            props: ['task'],
            ssrRender(_ctx, push) {
              push('<div data-testid="mock-task-progress-card"></div>');
            },
          });
          return app;
        };

        // 1. Kiểm tra SSR render 2 uploader và liên kết /face-swap
        const authHtml = await renderToString(makeFwdApp({ isGuest: false }));
        assert.match(authHtml, /data-testid="workspace-face-swap-inputs"/);
        assert.match(authHtml, /workspace-source-face/);
        assert.match(authHtml, /workspace-target-face/);
        assert.match(authHtml, /href="\/face-swap"/);
        assert.match(authHtml, /id="workspace-face-swap-tos"/);

        // 2. Kiểm tra khách chưa đăng nhập: hiển thị nút workspace-login-button
        const guestHtml = await renderToString(makeFwdApp({ isGuest: true }));
        assert.match(guestHtml, /data-testid="workspace-login-button"/);
        assert.match(
          guestHtml,
          /<button[^>]*data-testid="submit-task-button"[^>]*\sdisabled(=|"|\s|>)/,
        );
      } finally {
        if (fs.existsSync(tmpFwdFile)) {
          fs.unlinkSync(tmpFwdFile);
        }
      }
    });

    it('Tuân thủ Slate Cyber tokens, vùng chạm tối thiểu 48px và không có emoji UTF-8 trong UI chrome', () => {
      const faceSwapPageRaw = fs.readFileSync(
        path.join(webRoot, 'pages/face-swap.vue'),
        'utf8',
      );
      const cardComponentRaw = fs.readFileSync(
        path.join(webRoot, 'components/TaskProgressCard.vue'),
        'utf8',
      );

      // 1. Vùng chạm tối thiểu 48px
      assert.match(faceSwapPageRaw, /min-h-\[48px\]/);
      assert.match(cardComponentRaw, /min-h-\[48px\]/);
      assert.match(faceSwapPageRaw, /touch-target/);
      assert.match(cardComponentRaw, /touch-target/);

      // 2. Không chứa emoji UTF-8 trong UI chrome
      const emojiRegex =
        /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/u;
      assert.equal(
        emojiRegex.test(faceSwapPageRaw),
        false,
        'pages/face-swap.vue không được chứa emoji UTF-8',
      );
      assert.equal(
        emojiRegex.test(cardComponentRaw),
        false,
        'components/TaskProgressCard.vue không được chứa emoji UTF-8',
      );
    });
  });
});
