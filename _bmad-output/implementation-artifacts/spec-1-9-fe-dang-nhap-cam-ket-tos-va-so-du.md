---
title: 'Story 1.9: [FE] Đăng nhập, cam kết ToS và số dư'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
baseline_commit: '2e969066de967477d52cfa76e9b0448acad9a128'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FE đã có `AuthDialog`, huy hiệu số dư và `useAuth`, nhưng chưa có trang `/login`, client không tự `POST /auth/refresh` khi gặp 401, trang chính không nhắc nạp khi 0 credit, và đăng xuất không về `/login`.

**Approach:** Thêm trang `/login` dùng lại phần cam kết ToS và đăng nhập Google của dialog (tách thành component dùng chung). Thêm cơ chế refresh-một-lần-rồi-thử-lại vào API client. Bổ sung thông báo 0 credit và luồng đăng xuất. Chỉ sửa `apps/web/` (nhánh `fe/*`).

## Boundaries & Constraints

**Always:** Giao diện tiếng Việt, Slate Cyber, icon Lucide, không emoji, vùng chạm >= 48px. Nút đăng nhập bị vô hiệu khi chưa tích ToS. Gửi `tosVersion = TOS_VERSION` và `deviceId` tới `GET /auth/google`. Mọi mã lỗi đi qua `resolveApiErrorMessageVi`. Dùng chung một lời gọi refresh đang chạy (refresh token xoay vòng). Access token chỉ nằm trong bộ nhớ.

**Never:** Không sửa `apps/api` hay `packages/contracts`. Không thêm thư viện fingerprint (BE đã cấp cookie thiết bị ký, `deviceId` ở FE chỉ để thỏa hợp đồng). Không chặn truy cập các trang xem công khai bằng route guard toàn cục. Không refresh quá một lần cho mỗi request.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chưa tích ToS | `/login`, checkbox trống | Nút Google bị vô hiệu | N/A |
| Đã tích ToS | Bấm đăng nhập | Gọi `GET /auth/google?tosVersion&deviceId`, chuyển tới `redirectUrl` | Lỗi API: banner tiếng Việt, nút bật lại |
| Access JWT hết hạn | API trả 401 | Gọi `POST /auth/refresh` đúng một lần, thử lại request gốc | Refresh lỗi: xóa phiên, chuyển `/login` |
| Nhiều request 401 song song | 3 request cùng 401 | Chỉ một lời gọi refresh, cả ba thử lại | Như trên |
| Số dư 0 | `GET /me` balance = 0 | Trang chính hiện thông báo cần nạp credit kèm liên kết `/pricing` | N/A |
| Tài khoản mới | `GET /me` balance = 500 | Header hiện 500 CR và huy hiệu Tier | N/A |
| Lỗi `CONSENT_REQUIRED`/`ACCOUNT_LOCKED`/`RATE_LIMITED`/`EMAIL_LINKED_TO_OTHER_ACCOUNT` | BE trả mã lỗi hoặc `?authError=` | Hiện thông báo tiếng Việt tương ứng | N/A |
| Đăng xuất | Bấm "Đăng xuất" | Gọi `POST /auth/logout`, xóa phiên, chuyển `/login` | Logout lỗi vẫn xóa phiên cục bộ |

</frozen-after-approval>

## Code Map

- `apps/web/utils/api-client.ts` -- `requestLive`: thêm tùy chọn `onUnauthorized` để refresh rồi thử lại một lần; `refreshSession`/`logout`/`getGoogleAuthUrl` không tự refresh.
- `apps/web/composables/useApiClient.ts` -- tạo client, truyền `onUnauthorized`.
- `apps/web/composables/useAuth.ts` -- `restoreSession` có `inflight` dùng chung; `logout` cần điều hướng `/login`.
- `apps/web/components/AuthDialog.vue` -- chứa form ToS, `getDeviceId`, `handleGoogleLogin`: tách phần form thành component dùng lại.
- `apps/web/pages/auth/callback.vue`, `plugins/session.client.ts` -- giữ nguyên hành vi.
- `apps/web/pages/index.vue` -- nơi thêm thông báo 0 credit.
- `apps/web/components/AppTopHeader.vue`, `AppBottomNav.vue` -- đã có huy hiệu số dư/Tier; nút tài khoản khi chưa đăng nhập chuyển sang `/login`.
- `apps/web/test/smoke.test.mjs` -- khung test hiện có, thêm test mới.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/components/LoginConsentForm.vue` -- tạo form ToS + nút Google + banner lỗi, dùng chung cho dialog và `/login` -- tránh nhân đôi logic
- [x] `apps/web/pages/login.vue` -- tạo trang `/login`, đã đăng nhập thì chuyển `/`, đọc `?authError=` -- AC đăng nhập
- [x] `apps/web/components/AuthDialog.vue` -- dùng `LoginConsentForm`; logout chuyển `/login` -- bỏ trùng lặp
- [x] `apps/web/utils/api-client.ts` + `composables/useApiClient.ts` -- refresh một lần khi 401, dùng chung inflight, lỗi thì xóa phiên và `navigateTo('/login')` -- AC phiên
- [x] `apps/web/composables/useAuth.ts` -- `logout` gọi API, xóa phiên rồi về `/login`
- [x] `apps/web/pages/index.vue` -- thông báo 0 credit kèm liên kết nạp
- [x] `apps/web/components/AppTopHeader.vue`, `AppBottomNav.vue` -- nút Tôi/Đăng nhập khi chưa đăng nhập dẫn tới `/login`
- [x] `apps/web/test/smoke.test.mjs` -- test I/O Matrix: refresh một lần, song song, refresh lỗi, ánh xạ mã lỗi, 0 credit, SSR `/login`

**Acceptance Criteria:**
- Given chưa tích ToS ở `/login`, when xem nút, then nút bị vô hiệu và văn bản ToS hiển thị.
- Given đã tích ToS, when bấm đăng nhập, then gọi `GET /auth/google` có `tosVersion` và `deviceId`.
- Given đã đăng nhập, when vào trang bất kỳ, then tiêu đề hiện số dư và Tier từ `GET /me`.
- Given 401, when gọi API, then refresh đúng một lần rồi thử lại; refresh lỗi thì về `/login`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Nguồn | Phát hiện | Verdict | Bằng chứng / Xử lý |
|---|-------|-----------|---------|--------------------|
| 1 | verification-gap | Test dùng bản sao inline của `onUnauthorized`, không chạy `refreshAccessTokenShared`/`useApiClient` thật | medium → patch | `smoke.test.mjs` `makeClient()` tự cài lại logic; xóa `??=` hoặc `finally` ở mã thật vẫn pass. Tách module thuần rồi test mã thật. |
| 2 | verification-gap, blind | Logout/0 credit/redirect `/login` chỉ kiểm bằng regex nguồn | medium → patch | Regex `/me\.balance === 0/` không chạy mã. Gộp vào patch #1. |
| 3 | verification-gap | Không có test hiển thị `authError` | low → patch | SSR `/login?authError=...` chưa có case. Thêm một case. |
| 4 | edge, blind, gap | Lỗi `authError` lưu trong `useState` không bao giờ xóa, hiện lại ở lần vào `/login` sau | medium → patch | `login.vue` chỉ gán khi có `authError`. Luôn gán lại. |
| 5 | blind, edge | `submitting` kẹt true sau khi quay lại bằng Back/bfcache | medium → patch | `LoginConsentForm.vue` gán `window.location.href` rồi không reset. Reset khi `pageshow` persisted. |
| 6 | edge, blind | `redirectUrl` không kiểm tra scheme/host | false | URL do BE `GET /auth/google` dựng cố định `https://accounts.google.com/o/oauth2/v2/auth` (`google-oauth.service.ts:57`) và qua Zod `z.string().url()`; không nhận từ người dùng. |
| 7 | edge | Retry đã tiêu thụ body, upload FormData | false | Story 1.9 chỉ có request GET/POST không body; chưa có upload. |
| 8 | edge | Retry có thể dùng header Authorization cũ | false | `requestLive` đọc lại `options.getAccessToken()` ở mỗi lần gọi, kể cả lần retry (đệ quy). |
| 9 | edge | Guest 401 ở endpoint công khai kích hoạt refresh | false | Hành vi theo spec ("401 -> refresh đúng một lần"); khách không có cookie nhận 401 từ refresh và giữ nguyên trang (không redirect khi `sentToken` rỗng). |
| 10 | edge, blind | `refreshInflight`/`restoring` là biến module, có thể rò giữa request SSR | false | `onUnauthorized` trả sớm khi `import.meta.server`; `restoreSession` chỉ chạy từ hook `app:mounted` (client). |
| 11 | edge | Thông báo lỗi chưa đọc cho trình đọc màn hình | false | `ApiErrorBanner.vue:36-37` đã có `role="alert"` và `aria-live="polite"`. |
| 12 | blind | `getDeviceId` fallback sinh id mới mỗi lần khi `localStorage` lỗi | false | BE không còn tin `deviceId` của client (cookie `motion_device` ký phía server, commit sửa Story 1.8). |
| 13 | blind | Banner "thử lại" bỏ qua nút đã vô hiệu, gọi song song `getGoogleAuthUrl` | low → reject | Banner chỉ hiện khi có lỗi (đã `submitting=false`); sửa cần thêm nhánh bảo vệ, khả năng gặp rất thấp. |
| 14 | blind | Thông báo 0 credit chỉ so sánh `=== 0`, bỏ qua số dư dưới giá tác vụ | low → reject | Đúng AC ("0 credit"); mở rộng là thay đổi ý định, ngoài AC. |
| 15 | blind | Không có đường quay lại (`redirect` query) sau đăng nhập | low → reject | Ngoài AC; cần thiết kế OAuth state mang đích về, thuộc story tích hợp. |
| 16 | edge | `navigateTo('/login')` khi đang ở `/login`, `logout` nuốt lỗi, `close()` sau điều hướng | low → reject | Vue Router bỏ qua điều hướng trùng; `AuthDialog.close()` chạy sau `await` nên không kẹt; sửa chỉ thêm guard. |
| 17 | blind | `/login` thoáng hiện form trước khi `restoreSession` xong | low → reject | `login.vue` chuyển `/` ngay khi `me` có; nhấp nháy ngắn, không sai chức năng. |
| 18 | blind | Văn bản ToS thiếu liên kết, thiếu `aria-describedby` | low → defer | Văn bản ToS vẫn là bản tạm chờ PM (PRD §10); thêm liên kết khi có trang điều khoản. |
| 19 | edge | Refresh lỗi khi không gửi token thì không chuyển `/login` (lệch hàng ma trận) | low → reject | Cố ý: khách xem công khai không bị đẩy sang `/login`; ghi rõ ở Design Notes. |
| 20 | edge | `refreshNuxtData` lỗi làm `restoreSession` reject | low → reject | `refreshNuxtData` không ném lỗi theo hợp đồng Nuxt (lỗi nằm ở `error` của asyncData). |
| 21 | edge | SSR test phụ thuộc `.output` build sẵn | low → reject | `pnpm --filter @motion-ai/web test` luôn build trước; cùng mẫu với test Story 1.4. |

## Design Notes

Văn bản ToS vẫn là bản tạm (PRD §10 ghi phần bổ sung 18 tuổi và quyền hình ảnh chưa nhận được); dùng chung một hằng văn bản để thay một chỗ khi PM cung cấp.

## Verification

**Commands:**
- `pnpm run lint` -- expected: không lỗi
- `pnpm run typecheck` -- expected: không lỗi
- `pnpm --filter @motion-ai/web test` -- expected: toàn bộ pass
- `pnpm run check:boundaries` -- expected: chỉ sửa `apps/web/` (cùng `_bmad-output/` là ngoại lệ có sẵn)
