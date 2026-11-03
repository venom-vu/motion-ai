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

### Review Findings

Lượt `bmad-code-review` thứ hai (sau khi vá), chế độ `full`, 4 lớp: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor. 39 phát hiện thô, gộp theo nguyên nhân gốc. Kết quả: 2 quyết định, 3 patch (đã xử lý), 2 hoãn, 21 loại.

- [x] [Review][Decision] Mất phiên khi request chưa gửi token thì không chuyển `/login` — Đã quyết định: giữ nguyên trang. Khách xem công khai không bị đẩy đi; chỉ request đã mang token mới chuyển `/login`. Đây là ngoại lệ có chủ đích của hàng ma trận "Access JWT hết hạn". [auth-session.ts:createSessionLostHandler]
- [x] [Review][Decision] Lỗi tạm thời khi refresh (mạng, 5xx) — Đã quyết định: chỉ 401/403 từ `/auth/refresh` mới mất phiên. Lỗi mạng hoặc 5xx giữ token, request gốc báo lỗi của nó. Hẹp hơn chữ AC "refresh thất bại thì về `/login`", do người dùng chọn. [auth-session.ts:createRefreshCoordinator]
- [x] [Review][Patch] Thiếu test render cho thông báo 0 credit — Đã vá: biên dịch template `pages/index.vue` và render ở balance 0, 500 và khách; kiểm `zero-credit-notice` kèm `href="/pricing"`. [smoke.test.mjs]
- [x] [Review][Patch] Nhánh "token đã được request khác làm mới" — Đã vá: gọi trực tiếp `createUnauthorizedHandler` với `getToken = 'new'`, `sentToken = 'old'`, khẳng định không refresh và trả true. Xóa nhánh này thì test đỏ. [smoke.test.mjs]
- [x] [Review][Patch] Phần nối `onSessionLost` và logout — Đã vá: tách thành `createSessionLostHandler` và hằng `LOGIN_PATH` trong `auth-session.ts`, `useApiClient.ts` và `useAuth.ts` gọi lại; test kiểm thứ tự mark/clear/navigate và `hadToken`. Đảo `if (hadToken)` thì test đỏ. [auth-session.ts, smoke.test.mjs]
- [x] [Review][Defer] Không có đường quay lại trang cũ sau khi đăng nhập hoặc hết phiên — `navigateTo('/login')` không mang `redirect`, `login.vue` luôn về `/`; cần thiết kế OAuth state mang đích về (kiểm tra chỉ nhận đường dẫn tương đối cùng origin) [useApiClient.ts, login.vue] — deferred: ngoài AC của 1.9, thuộc story tích hợp 1.11 (blind-hunter)
- [x] [Review][Defer] Văn bản ToS chưa có liên kết tới trang điều khoản — deferred: đã ghi ở lượt review trước (xem `deferred-work.md`), chờ văn bản ToS cuối của PM [LoginConsentForm.vue] (blind-hunter+acceptance-auditor)

#### Rejected

- `onSessionLost` chạy N lần khi N request 401 song song cùng thất bại (low): `navigateTo('/login')` trùng đích bị Vue Router bỏ qua và `clearNuxtData` idempotent; sửa chỉ thêm cờ một lần.
- Refresh lặp lại khi phiên đã mất, kể cả khách gặp 401 (low): chỉ xảy ra khi có request 401 sau khi mất phiên, hiếm; sửa cần thêm nhánh bảo vệ liên quan `sessionChecked`.
- Biến module `refreshShared`/`restoring` dùng chung giữa các request SSR (false): `onUnauthorized` trả sớm khi `import.meta.server`; `restoreSession` chỉ được gọi từ `plugins/session.client.ts` và `pages/auth/callback.vue` (`onMounted`), cả hai chỉ chạy ở client.
- `refreshNuxtData` reject làm `restoreSession` reject (false): `asyncData.js:415` bắt lỗi của lần làm mới và ghi vào `asyncData.error`, không ném ra.
- `/me` nhận 401 ngay sau khi vừa refresh gây refresh lần hai (low, chưa chứng minh tới được): cần token vừa cấp bị BE từ chối ngay.
- `logout` lỗi API thì cookie refresh còn hiệu lực, tải lại trang đăng nhập lại (low): đúng hành vi spec yêu cầu ("Logout lỗi vẫn xóa phiên cục bộ"); thêm cảnh báo là quyết định UX ngoài AC.
- `navigate` reject sau `clearSession` làm `logout` reject, dialog không đóng (low): `navigateTo` trả kết quả lỗi chứ không ném; sửa chỉ thêm try/catch.
- Lỗi bị đóng trong form nhưng `useAuthDialog().errorVi` vẫn giữ nên lỗi cũ hiện lại (false): `close()` đặt `errorVi = null` (useAuthDialog.ts:17-19), prop đổi sang null nên watcher chạy; mở lại với lỗi mới thì prop đổi lại.
- `redirectUrl` không kiểm tra scheme/host (false): URL do BE dựng cố định `https://accounts.google.com/o/oauth2/v2/auth` (google-oauth.service.ts:57), không nhận từ người dùng.
- Bấm đúp hoặc "thử lại" từ banner gọi song song `getGoogleAuthUrl` (false): `submitting = true` đặt đồng bộ trong handler nên lần bấm sau thấy nút đã vô hiệu; banner chỉ hiện khi `errorVi` có giá trị mà `handleGoogleLogin` xóa ngay đầu hàm.
- `/login` đẩy người dùng ra do `me` cũ hoặc nhấp nháy form trước khi khôi phục phiên (false/low): logout gọi `clearNuxtData` trước khi điều hướng; nhấp nháy ngắn không sai chức năng vì access token chỉ nằm trong bộ nhớ.
- `shownErrorVi` lưu lỗi cũ, `authError` tùy ý, lệch hydration (false): luôn gán lại ở mỗi lần setup; `getApiErrorMessageVi` dùng `hasOwnProperty` và rơi về thông báo chung, Vue escape khi hiển thị; `router.replace` chạy sau lần render đầu.
- `isOutOfCredit` chỉ so `=== 0`, bỏ qua số âm/NaN/dưới giá tác vụ (false/low): CSDL có `CHECK (balance >= 0)` và JSON không có NaN; AC ghi "0 credit".
- Request thử lại vẫn 401 thì không xóa phiên (low, chưa chứng minh tới được): cần token vừa cấp bị từ chối ngay; hiện lỗi vẫn ném ra cho người gọi.
- Test SSR cần build sẵn và regex phụ thuộc thứ tự thuộc tính (low): `pnpm --filter @motion-ai/web test` luôn build trước; thứ tự thuộc tính do template cố định.
- `export { refreshShared }` đặt trước khai báo `const` (false): liên kết export ESM là động và không có mã nào đọc trước khi dòng khai báo chạy.
- Test thiếu cho ToS/`deviceId` qua component, `pageshow`, kiểm tra `CONSENT_REQUIRED` phía client, định tuyến nút tài khoản (low): cần khung test DOM mà repo chưa có; phần hành vi chính đã có test ở mức client và SSR.
- Chế độ `login` của `AuthDialog` là "chết" (false): `AuthDialog.vue:40` vẫn dùng `open('login', ...)` cho redirect `/?authError=` của BE (auth.controller.ts:173).
- `getDeviceId` sinh id mới mỗi lần khi `localStorage` lỗi làm vô hiệu chống lạm dụng (false): BE đã bỏ qua `deviceId` của client, dùng cookie `motion_device` do server ký (commit sửa Story 1.8).
- Đua giữa logout và request 401 đang bay (low): cần logout API lỗi cùng lúc có request đang bay; hiếm và chỉ tạo thêm một lần refresh.
- Đường thử lại có thể dùng token đã bị từ chối (low): cờ `retried` chặn lặp, lần thử lại chỉ chạy một lần.

#### Lượt review thứ ba (sau khi áp dụng 2 quyết định và 3 patch)

Chế độ `full`, 4 lớp, diff 342 dòng (4 file). 0 `decision-needed`, 0 `patch`, 1 `defer`, phần còn lại bị loại. Acceptance Auditor không thấy vi phạm AC; hai điểm thu hẹp hành vi (khách giữ nguyên trang, chỉ 401/403 mất phiên) đã được người dùng chốt.

- [x] [Review][Defer] `useAuth.restoreSession` (ánh xạ `outcome === 'ok'`, `sessionChecked` trong `.finally`) chưa có test chạy composable thật — đảo thành `outcome !== 'invalid'` thì mọi test vẫn xanh; cần khung Nuxt hoặc tách thêm một hàm thuần [useAuth.ts:30-40] — deferred: logic nằm trong một dòng ánh xạ, cần khung test Nuxt mà repo chưa có (verification-gap)

##### Rejected (lượt 3)

- Mã trạng thái cứng, 400/422/429 bị coi là tạm thời, 403 có thể không phải "phiên mất" (low): đã đối chiếu BE, `/auth/refresh` chỉ ném `UnauthorizedException` (401) cho mọi cookie thiếu/sai/thu hồi/hết hạn và `AccountLockedException` (403) khi bị khóa (auth.service.ts, account-locked.guard.ts:15). 401/403 khớp đúng hợp đồng; 429 của throttler cố ý là tạm thời để người dùng bị giới hạn tần suất không bị đăng xuất.
- `sessionChecked` không được đánh dấu ở nhánh tạm thời của interceptor (false): `sessionChecked` chỉ được đọc ở `useAuth.restoreSession` (useAuth.ts:26), và hàm này trả sớm khi đã có `accessToken`; nhánh tạm thời giữ token nên không có gì chờ cờ này.
- Nhánh tạm thời không có thử lại hoặc backoff, mỗi request sau đều gọi refresh lại (low): access token sống 15 phút nên chỉ phát sinh khi mạng hỏng đúng lúc token hết hạn; thêm backoff là thêm trạng thái, ngoài AC.
- Khởi động nguội gặp lỗi tạm thời thì hiện như chưa đăng nhập và không tự thử lại (low): không có route guard nên không bị đẩy đi; tải lại trang khôi phục vì cookie còn hiệu lực. Chỉ gặp khi mạng hỏng đúng lúc mở trang.
- `onSessionLost` chạy N lần với N request 401 song song, và request 401 đến muộn gọi refresh lần hai với cookie đã chết (low): trùng mục đã loại ở lượt 2; `navigateTo` trùng đích bị bỏ qua, `clearNuxtData` idempotent.
- `clearData`/`navigate` ném lỗi che lỗi 401 gốc (low): trùng mục đã loại ở lượt 2; `requestLive` đã bọc `onUnauthorized` trong try/catch (api-client.ts:159-163) nên lỗi không lan ra và request gốc báo lỗi của chính nó.
- Lỗi 401/403 không từ BE (proxy/CDN) ép đăng xuất, hoặc lỗi không có `status` bị coi tạm thời (low): `MotionApiClientError` luôn mang `status` số; giả định có proxy trả 401 cho `/auth/refresh` chưa có bằng chứng.
- Test: thiếu khẳng định `setToken` không được gọi, thiếu ca token gửi là null, thiếu ca trộn `invalid` và `transient` (low): các ca này kiểm tra cùng một nhánh đã được test chặn (đảo `if (current && current !== sentToken)` làm test đỏ).
- Tệp tạm `.tmp-index-*.mjs` trong `apps/web/test/` có thể va chạm hoặc để sót (false): `node --test test/*.test.mjs` chỉ nhận `*.test.mjs` nên không chạy nhầm; tệp phải nằm trong gói để `import 'vue'` phân giải được, và cùng mẫu với test `.tmp-dialog-*` của Story 1.4; có `finally` xóa tệp.
- Stub `setup` của test trang chính cứng nhắc, vỡ khi `index.vue` đổi (low): khi template đổi, test báo lỗi rõ ràng chứ không âm thầm xanh; derive từ script là thay đổi lớn hơn lợi ích.
- Các điểm nhỏ: chú thích đặt trên cả handler, `navigate` trả `Promise<unknown> | unknown`, `clearNuxtData` chỉ có test mock (low): không gây hành vi sai.

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
