---
title: 'Story 1.4: [FE] Khung Nuxt 4 mobile-first chạy trên mock'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
baseline_commit: '3f37fd6b812bb802477af59ed18c07eb34df376c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Gói `@motion-ai/web` (`apps/web`) mới chỉ có khung tối thiểu từ Story 1.1, chưa cấu hình preset Nitro cho Cloudflare Pages, chưa tích hợp Design Tokens Slate Cyber (Tailwind CSS) và icon vector Lucide (`@nuxt/icon`), chưa có layout thích ứng Mobile-First (`360px`) / Desktop Adaptive (`>= 1024px`) và chưa có client API có kiểu chạy trên mock/live từ `@motion-ai/contracts`.

**Approach:** Cấu hình Nuxt `4.6.3` với preset `cloudflare-pages`, tích hợp Tailwind CSS (Slate Cyber tokens) và `@nuxt/icon` (`lucide`), xây dựng client API có kiểu dùng schema/mock của `@motion-ai/contracts` (hỗ trợ `mock` không gọi mạng, đọc giá/Cap từ `GET /config/pricing`, ánh xạ tập trung `ApiErrorCode` sang tiếng Việt), và dựng layout cùng các trang khung tiếng Việt (`/`, `/login`, `/history`, `/pricing`, `/admin`).

## Boundaries & Constraints

**Always:**
- Chỉ sửa file trong `apps/web/**` và `pnpm-lock.yaml` ở thư mục gốc để tuân thủ ranh giới nhánh `fe/*`.
- Giữ Nuxt `4.6.3` và ghim cố định phiên bản (không dùng `^`, `~`) cho mọi dependency trong `apps/web/package.json`.
- Đặt `nitro.preset = 'cloudflare-pages'` trong `apps/web/nuxt.config.ts`, xác nhận `pnpm --filter @motion-ai/web run build` sinh `.output/public/_worker.js` + `_routes.json`, và ghi kết quả vào `apps/web/README.md`.
- Áp dụng bảng màu Slate Cyber từ `DESIGN.md` (`#0F172A`, `#1E293B`, `#334155`, `#8B5CF6`, `#06B6D4`, `#F8FAFC`, `#94A3B8`, `#10B981`, `#F59E0B`, `#EF4444`), dùng `@nuxt/icon` với bộ `lucide` (`stroke-width: 2`), cấm emoji UTF-8 trong UI chrome, vùng chạm tối thiểu `48px`, giao diện 100% tiếng Việt.
- Bố cục theo `EXPERIENCE.md`: ở `360px` không cuộn ngang, điều hướng bằng Bottom Navigation Bar 4 tab (`Kho AI`, `Lịch sử`, `Bảng giá`, `Tôi`); ở `>= 1024px` dùng Top Header `68px` (không Sidebar trái), trang `/` hiển thị lọc/tìm kiếm + lưới 3–4 cột Card tính năng mở Centered Dialog `FeatureWorkspaceDialog` (`max-width: 980px`) khi click; riêng `/admin` dùng Left Sidebar `220px` phong cách Vercel (`#0A0A0A`, viền `1px`, `monospace`).
- Client API sinh từ `@motion-ai/contracts` hỗ trợ chế độ `mock` (trả mock khớp Zod schema, không gọi mạng) và `live`, đọc giá/Cap theo Tier từ `GET /config/pricing` (không hardcode), ánh xạ lỗi qua một bảng duy nhất theo `ApiErrorCode` (mã lạ hiển thị thông báo chung).

**Never:**
- Không sửa file ngoài `apps/web/**` và `pnpm-lock.yaml`.
- Không dùng emoji UTF-8 hay Drawer/Bottom Sheet cho `FeatureWorkspaceDialog`.
- Không hardcode giá credit (100 cr, 50 cr/s) hay trần giây video (5s/10s/15s/20s) trong UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gọi client API ở chế độ `mock` | `apiMode = 'mock'`, gọi `getPricingConfig()`, `getMe()`, `getWalletLedger()` khi `fetch` bị khóa | Trả dữ liệu mock khớp Zod schema của `@motion-ai/contracts`, không gọi mạng | Ném lỗi nếu dữ liệu sai schema |
| Gọi client API ở chế độ `live` | `apiMode = 'live'`, `fetch` trả `200` hoặc lỗi `{ code, message }` | Trả dữ liệu đã parse Zod khi `200`; ném `MotionApiClientError` kèm `userMessageVi` khi lỗi | Ánh xạ `code` sang tiếng Việt |
| Nhận lỗi có `code` thuộc `ApiErrorCode` | `PAUSED`, `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `CONSENT_REQUIRED`, `VALIDATION_FAILED`, `RATE_LIMITED` | Hiển thị đúng thông báo tiếng Việt từ bảng `API_ERROR_MESSAGES_VI` | Không lộ mã lỗi kỹ thuật thô |
| Nhận lỗi có `code` lạ hoặc thiếu `code` | `{ code: 'UNKNOWN_ERR' }` hoặc `null` / `undefined` | Trả về `"Đã xảy ra lỗi không xác định. Vui lòng thử lại sau."` mà không vỡ UI | Fallback qua `getApiErrorMessageVi` |
| Hiển thị giá và Cap theo Tier | Phản hồi `GET /config/pricing` | Card tính năng, `FeatureWorkspaceDialog` và `/pricing` hiển thị đúng credit và Cap giây từ API | Hiển thị trạng thái tải/lỗi tiếng Việt |
| Mở/đóng `FeatureWorkspaceDialog` | Click/chạm Card tính năng trên `/` ở `360px` hoặc `>= 1024px` | Mở Centered Dialog (`max-width: 980px`) của tính năng đó; đóng khi bấm nút đóng hoặc `Escape` | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/package.json` & `apps/web/eslint.config.mjs` -- Ghim `@nuxt/icon`, `@iconify-json/lucide`, `@nuxtjs/tailwindcss`, `tailwindcss`, `eslint-plugin-vue`, `vue-eslint-parser`; cấu hình lint phủ cả `.vue`.
- `apps/web/nuxt.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/assets/css/main.css` -- Cấu hình `nitro.preset: 'cloudflare-pages'`, `runtimeConfig.public` (`apiMode`, `apiBaseUrl`), Tailwind Slate Cyber tokens, `@nuxt/icon` (`lucide`) và `overflow-x: hidden`.
- `apps/web/utils/api-client.ts` & `apps/web/utils/catalog.ts` -- Client API có kiểu (`createMotionApiClient`, `MotionApiClientError`) chạy `mock`/`live` và bộ danh mục công cụ AI lấy giá/Cap động từ `PricingConfigResponse`.
- `apps/web/composables/useApiClient.ts` & `apps/web/composables/usePricingConfig.ts` -- Composable cung cấp client API, cấu hình `/config/pricing` và thông tin `/me`.
- `apps/web/components/AppTopHeader.vue`, `apps/web/components/AppBottomNav.vue`, `apps/web/components/FeatureCard.vue`, `apps/web/components/FeatureWorkspaceDialog.vue`, `apps/web/components/ApiErrorBanner.vue` -- Linh kiện điều hướng, Card tính năng Before/After, Centered Dialog làm việc và banner lỗi tiếng Việt.
- `apps/web/layouts/default.vue` & `apps/web/layouts/admin.vue` -- Layout người dùng (Bottom Nav ở mobile, Top Header ở desktop) và layout Admin phong cách Vercel (Left Sidebar `220px`).
- `apps/web/app.vue`, `apps/web/pages/index.vue`, `apps/web/pages/login.vue`, `apps/web/pages/history.vue`, `apps/web/pages/pricing.vue`, `apps/web/pages/admin/index.vue` -- Các trang khung tiếng Việt.
- `apps/web/README.md` & `apps/web/test/smoke.test.mjs` -- Tài liệu hóa kết quả build Cloudflare Pages và bộ kiểm thử tự động.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json`, `apps/web/eslint.config.mjs`, `pnpm-lock.yaml` -- Cài đặt `@nuxt/icon`, `@iconify-json/lucide`, `@nuxtjs/tailwindcss`, `tailwindcss`, `eslint-plugin-vue`, `vue-eslint-parser` (ghim cố định) và cấu hình lint phủ `.vue` -- Chuẩn bị hạ tầng UI/icon và đóng mục deferred lint `.vue` từ Story 1.1.
- [x] `apps/web/nuxt.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/assets/css/main.css` -- Đặt `nitro.preset = 'cloudflare-pages'`, tích hợp Tailwind Slate Cyber tokens và `@nuxt/icon` (`lucide`) -- Đáp ứng AC1, AC6.
- [x] `apps/web/utils/api-client.ts`, `apps/web/utils/catalog.ts`, `apps/web/composables/useApiClient.ts`, `apps/web/composables/usePricingConfig.ts` -- Xây dựng client API `mock`/`live` có kiểu từ `@motion-ai/contracts`, ánh xạ lỗi `ApiErrorCode` tiếng Việt và đọc giá/Cap động từ `/config/pricing` -- Đáp ứng AC3, AC4, AC5.
- [x] `apps/web/layouts/default.vue`, `apps/web/layouts/admin.vue`, `apps/web/components/AppTopHeader.vue`, `apps/web/components/AppBottomNav.vue`, `apps/web/components/FeatureCard.vue`, `apps/web/components/FeatureWorkspaceDialog.vue`, `apps/web/components/ApiErrorBanner.vue` -- Dựng layout responsive (`360px` Bottom Nav, `>= 1024px` Top Header, `/admin` Left Sidebar `220px`), lưới Card và `FeatureWorkspaceDialog` Centered Dialog (chạm `>= 48px`, không emoji) -- Đáp ứng AC2, AC6.
- [x] `apps/web/app.vue`, `apps/web/pages/index.vue`, `apps/web/pages/login.vue`, `apps/web/pages/history.vue`, `apps/web/pages/pricing.vue`, `apps/web/pages/admin/index.vue`, `apps/web/README.md` -- Tạo các trang khung tiếng Việt, xác nhận đầu ra `nuxt build` cho Cloudflare Pages và ghi vào `apps/web/README.md` -- Đáp ứng AC1, AC2, AC5.
- [x] `apps/web/test/smoke.test.mjs` -- Viết unit/smoke test kiểm chứng preset Cloudflare Pages, client API `mock` không gọi mạng, chế độ `live` + bảng lỗi `ApiErrorCode`/mã lạ, lấy giá/Cap từ `/config/pricing`, không có emoji UTF-8 và vùng chạm `48px` -- Bảo chứng toàn bộ I/O Matrix và AC.

**Acceptance Criteria:**
- Given Nuxt `4.6.3` trong `apps/web`, when chạy `pnpm --filter @motion-ai/web run build`, then preset Nitro là `cloudflare-pages`, thư mục `.output/public` có `_worker.js/index.js` và `_routes.json`, và kết quả kiểm tra được ghi vào `apps/web/README.md`.
- Given viewport `360px` và `>= 1024px`, when mở `/`, `/login`, `/history`, `/pricing`, `/admin`, then ở `360px` không cuộn ngang và điều hướng bằng Bottom Navigation Bar, ở `>= 1024px` dùng Top Header (không Sidebar trái) với lưới Card tính năng mở Centered Dialog `FeatureWorkspaceDialog` khi click (riêng `/admin` dùng Left Sidebar `220px` phong cách Vercel), và giao diện chỉ có tiếng Việt.
- Given chế độ API `mock`, when gọi client API, then trả dữ liệu mock khớp schema `@motion-ai/contracts` mà không gọi mạng.
- Given phản hồi lỗi có `code` thuộc `ApiErrorCode` hoặc `code` lạ, when FE xử lý lỗi, then hiển thị thông báo tiếng Việt từ bảng ánh xạ duy nhất và mã lạ hiển thị thông báo chung không làm vỡ giao diện.
- Given giá và Cap theo Tier trên UI, when hiển thị, then luôn lấy từ `GET /config/pricing`, không hardcode.
- Given hợp đồng UX `DESIGN.md` và `EXPERIENCE.md`, when kiểm tra mã nguồn `apps/web`, then cấu hình đủ Design Tokens Slate Cyber, dùng `@nuxt/icon` (`lucide`), không có emoji UTF-8 trong UI chrome, vùng chạm tối thiểu `48px`, và không sửa file nào ngoài `apps/web/**` và `pnpm-lock.yaml`.

## Implementation Notes

- Đã ghim cố định phiên bản trong `apps/web/package.json`: `nuxt@4.6.3`, `@nuxt/icon@2.6.2`, `@iconify-json/lucide@1.2.150`, `@nuxtjs/tailwindcss@6.14.0`, `tailwindcss@3.4.19`, `eslint-plugin-vue@10.12.0`, `vue-eslint-parser@10.4.1`, và cấu hình `apps/web/eslint.config.mjs` phủ toàn bộ `.vue`, `.ts`, `.mjs`.
- Cấu hình `apps/web/nuxt.config.ts` với `nitro.preset = 'cloudflare-pages'` và `nitro.output` xuất thẳng vào `.output/public` (sinh `.output/public/_worker.js/index.js` và `.output/public/_routes.json`), kết hợp hệ màu Slate Cyber trong `apps/web/tailwind.config.ts` và `apps/web/assets/css/main.css` (`overflow-x: hidden`, vùng chạm tối thiểu `48px`, icon `lucide` `stroke-width: 2`).
- Xây dựng client API có kiểu trong `apps/web/utils/api-client.ts` (`createMotionApiClient`, `MotionApiClientError`, `resolveApiErrorMessageVi`) hỗ trợ chế độ `mock` (validate Zod từ `@motion-ai/contracts`, không gọi mạng) và `live` (ánh xạ tập trung `ApiErrorCode` sang tiếng Việt qua `API_ERROR_MESSAGES_VI` và fallback an toàn cho mã lỗi lạ), cùng `apps/web/utils/catalog.ts` tính động giá/Cap theo Tier từ `GET /config/pricing`.
- Dựng layout người dùng (`apps/web/layouts/default.vue`, `AppTopHeader.vue` `68px`, `AppBottomNav.vue` 4 tab di động), layout quản trị (`apps/web/layouts/admin.vue` Left Sidebar `220px` `#0A0A0A` `font-mono`), `FeatureCard.vue`, `FeatureWorkspaceDialog.vue` (Centered Dialog `max-w-[980px]`, hỗ trợ phím `Escape`, trimmer video bước 1 giây) và 5 trang tiếng Việt (`/`, `/login`, `/history`, `/pricing`, `/admin`).
- Tài liệu hóa kết quả build Cloudflare Pages vào `apps/web/README.md` và bổ sung bộ kiểm thử tự động trong `apps/web/test/smoke.test.mjs`.

## Spec Change Log

## Review Triage Log

- **Composables & Authentication (`usePricingConfig.ts`):** Xử lý ngoại lệ 401 unauthenticated khi khách chưa đăng nhập truy cập `/` hoặc `/pricing`, không hiển thị banner lỗi đỏ gây hoang mang cho người dùng mới.
- **Phân quyền & Hiển thị Admin (`AppTopHeader.vue`, `default.vue`):** Ẩn liên kết `/admin` trên Top Header trừ khi `me?.role === 'admin'`; kiểm tra hợp lệ `Number.isFinite(balance)` tránh hiển thị số dư không xác định.
- **Trải nghiệm Hộp thoại Làm việc (`FeatureWorkspaceDialog.vue`):**
  - Thêm xử lý kéo thanh trượt Before / After cập nhật trực quan độ rộng `width: ${compareSplitPercent}%` và đường viền phân tách.
  - Khóa cuộn trang `document.body.style.overflow = 'hidden'` khi hộp thoại mở và khôi phục khi đóng/unmount.
  - Bổ sung sự kiện phát lệnh `submit` khi bấm nút "Tạo Tác Vụ AI" kèm kiểm tra điều kiện đủ số dư credit.
- **Thao tác Thẻ Tính năng (`FeatureCard.vue`, `pages/index.vue`):**
  - Cho phép click toàn bộ thân thẻ tính năng hoặc bấm phím `Enter`/`Space` để mở ngay `FeatureWorkspaceDialog`.
  - Chuẩn hóa tiếng Việt bỏ dấu (`normalizeTextVi`) trong thanh tìm kiếm công cụ AI (`pages/index.vue`).
  - Bổ sung khối giao diện báo lỗi tải cấu hình hệ thống kèm nút "Thử tải lại" khi `pricing` rỗng.
- **Client API & Mô phỏng (`api-client.ts`):**
  - Kiểm tra chặt chẽ `mockOverrides.simulatedErrorCode !== undefined && !== null`.
  - Hỗ trợ mô phỏng và bóc tách tham số lỗi OAuth Google callback (`access_denied`, `error_description`).
  - Trích xuất mã lỗi phân cấp (`error.code`, `error.data.code`, `error.error.code`) khi ở chế độ `live`.
- **Giao diện & Thiết bị Di động (`AppBottomNav.vue`, `nuxt.config.ts`):**
  - Bổ sung khoảng đệm an toàn `pb-[env(safe-area-inset-bottom)]` cho Bottom Navigation Bar trên thiết bị di động có thanh điều hướng hoặc tai thỏ.
  - Nhúng font Google Fonts (`Space Grotesk`, `JetBrains Mono`) qua `app.head.link` trong `nuxt.config.ts`.
- **Kiểm thử Tự động & Chất lượng (`smoke.test.mjs`, `package.json`, `eslint.config.mjs`):**
  - Biên dịch và SSR render thực thi trực tiếp SFC template `FeatureWorkspaceDialog.vue` trong môi trường test để bảo đảm không có lỗi runtime/binding.
  - Bổ sung ca kiểm thử mô phỏng lỗi OAuth và từ chối cấp quyền trong chế độ mock.
  - Thêm cấu hình ESLint loại trừ quy tắc component cho các file test `.mjs`.
  - Tự động hóa build `@motion-ai/contracts` và `@motion-ai/web` trước khi chạy bộ test unit.

## Verification

**Commands:**
- `pnpm run check:boundaries -- --branch fe/1-4-nuxt-4-mobile-first-mock` -- expected: exit code 0, chỉ sửa `apps/web/**` và `pnpm-lock.yaml`
- `pnpm run lint` -- expected: exit code 0 trên toàn monorepo (kể cả `.vue`)
- `pnpm run typecheck` -- expected: exit code 0 trên cả 3 gói
- `pnpm run build` -- expected: exit code 0 và sinh `.output/public/_worker.js/index.js` + `_routes.json`
- `pnpm test` -- expected: exit code 0 cho toàn bộ test
