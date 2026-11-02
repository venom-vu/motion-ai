import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
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
  MeResponseSchema,
  PricingConfigResponseSchema,
  WalletLedgerResponseSchema,
} from '@motion-ai/contracts';
import { SLATE_CYBER_COLORS } from '../tailwind.config.ts';
import {
  MotionApiClientError,
  createMotionApiClient,
  resolveApiErrorMessageVi,
} from '../utils/api-client.ts';
import {
  FEATURE_CATEGORIES,
  buildAiFeatureCatalog,
  calculateFeatureEstimatedCredits,
  getTierCapSeconds,
} from '../utils/catalog.ts';

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

describe('@motion-ai/web — Story 1.4 Nuxt 4 mobile-first & mock API', () => {
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

  it('AC3 & I/O Row 1: client API ở chế độ mock trả dữ liệu khớp Zod schema mà không gọi mạng, và ném lỗi khi dữ liệu sai schema', async () => {
    let networkCalled = false;
    const forbiddenFetch = async () => {
      networkCalled = true;
      throw new Error('Không được phép gọi fetch trong chế độ mock');
    };

    const mockClient = createMotionApiClient({
      mode: 'mock',
      fetchImpl: forbiddenFetch,
    });

    const pricing = await mockClient.getPricingConfig();
    assert.deepEqual(
      PricingConfigResponseSchema.parse(pricing),
      MOCK_PRICING_CONFIG_RESPONSE,
    );

    const me = await mockClient.getMe();
    assert.equal(MeResponseSchema.parse(me).tier, 'FREE');
    assert.equal(me.balance, 500);

    const ledgerPage1 = await mockClient.getWalletLedger({ pageSize: 3 });
    WalletLedgerResponseSchema.parse(ledgerPage1);
    assert.equal(ledgerPage1.items.length, 3);
    assert.equal(ledgerPage1.hasMore, true);
    assert.equal(typeof ledgerPage1.nextCursor, 'string');

    const ledgerPage2 = await mockClient.getWalletLedger({
      pageSize: 3,
      cursor: ledgerPage1.nextCursor ?? undefined,
    });
    WalletLedgerResponseSchema.parse(ledgerPage2);
    assert.equal(ledgerPage2.items.length, 3);
    assert.notEqual(ledgerPage2.items[0].id, ledgerPage1.items[0].id);

    const oauthRes = await mockClient.getGoogleAuthUrl({
      tosVersion: '2026-11-01',
      deviceId: 'fp_test_device_01',
    });
    assert.match(oauthRes.redirectUrl, /^https:\/\/accounts\.google\.com/);

    const callbackRes = await mockClient.handleGoogleCallback({
      code: 'mock_auth_code',
      state: 'mock_csrf_state',
    });
    assert.equal(callbackRes.tokenType, 'Bearer');

    const refreshRes = await mockClient.refreshSession();
    assert.equal(refreshRes.tokenType, 'Bearer');

    const logoutRes = await mockClient.logout();
    assert.equal(logoutRes.success, true);
    assert.equal(networkCalled, false);

    // Kiểm tra mô phỏng lỗi OAuth trong mock mode
    const oauthErrorClient = createMotionApiClient({
      mode: 'mock',
      fetchImpl: forbiddenFetch,
      mockOverrides: {
        simulatedErrorCode: ApiErrorCode.CONSENT_REQUIRED,
      },
    });

    await assert.rejects(
      () =>
        oauthErrorClient.getGoogleAuthUrl({
          tosVersion: '2026-11-01',
          deviceId: 'fp_test_device_01',
        }),
      (err) => {
        assert.equal(err instanceof MotionApiClientError, true);
        assert.equal(err.code, ApiErrorCode.CONSENT_REQUIRED);
        return true;
      },
    );

    await assert.rejects(
      () =>
        oauthErrorClient.handleGoogleCallback({
          code: 'bad_code',
          state: 'bad_state',
        }),
      (err) => {
        assert.equal(err instanceof MotionApiClientError, true);
        assert.equal(err.code, ApiErrorCode.CONSENT_REQUIRED);
        return true;
      },
    );

    // Kiểm tra callback nhận param error từ Google OAuth (e.g. access_denied)
    const callbackDeniedClient = createMotionApiClient({
      mode: 'mock',
      fetchImpl: forbiddenFetch,
    });
    await assert.rejects(
      () =>
        callbackDeniedClient.handleGoogleCallback({
          error: 'access_denied',
          error_description: 'User denied consent',
          state: 'mock_state',
        }),
      (err) => {
        assert.equal(err instanceof MotionApiClientError, true);
        assert.equal(err.code, 'access_denied');
        return true;
      },
    );

    // Kiểm tra ném lỗi nếu dữ liệu mock sai Zod schema
    const brokenMockClient = createMotionApiClient({
      mode: 'mock',
      fetchImpl: forbiddenFetch,
      mockOverrides: {
        me: {
          id: 'not-a-uuid',
          email: 'invalid',
          role: 'user',
          tier: 'FREE',
          balance: -100,
          held: 0,
          tosVersion: '2026-11-01',
        },
      },
    });

    await assert.rejects(
      () => brokenMockClient.getMe(),
      (err) => err instanceof Error && err.name === 'ZodError',
    );
  });

  it('AC4 & I/O Row 2, 3, 4: client API ở chế độ live parse Zod khi 200 và ánh xạ đầy đủ ApiErrorCode cũng như mã lỗi lạ sang tiếng Việt', async () => {
    const requestedHeaders = [];
    const liveOkClient = createMotionApiClient({
      mode: 'live',
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
        mode: 'live',
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
      mode: 'live',
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

    // 2. Kiểm tra đầy đủ 5 trang khung tiếng Việt
    const requiredPages = [
      'pages/index.vue',
      'pages/login.vue',
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

  it('AC1, AC2, AC5: SSR render cả 5 route (/, /login, /history, /pricing, /admin) qua Cloudflare Pages Worker bundle (.output/public/_worker.js/index.js)', async () => {
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
        path: '/login',
        mustInclude: [
          'data-testid="page-login"',
          'Đăng Nhập Bằng Google',
          '2026-11-01',
          '500 credit',
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
