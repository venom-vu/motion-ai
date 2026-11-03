---
title: 'Story 1.11: [INTEGRATION] Nối FE với BE và smoke test đăng nhập'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'b0a19c46d2fde7703855182eb056f4c1bd45ffa3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FE (Story 1.9–1.10) và BE (Story 1.5–1.8) mới được kiểm thử riêng rẽ; chưa có bằng chứng Epic 1 chạy trọn vẹn từ đăng nhập Google đến số dư và dòng "Tặng" trên stack thật, và chưa có test hợp đồng đối chiếu `MOCK_*` với phản hồi BE thật.

**Approach:** Thêm smoke test HTTP chạy trên stack Docker Compose bốn container với Google được giả bằng ghi đè URL qua biến môi trường. Test kiểm tra người dùng mới (500 credit, một dòng "Tặng"), tài khoản thứ hai cùng thiết bị (0 credit, không dòng "Tặng"), hợp đồng mock và BE thật cùng khớp schema, rồi chạy job đối soát. Gắn vào CI và cập nhật README.

## Decisions

- FE chỉ có một chế độ `live`, không khôi phục chế độ mock. "Mock" là các hằng `MOCK_*` trong `packages/contracts`; test hợp đồng kiểm tra chúng khớp schema và khớp hình dạng phản hồi BE thật. README ghi rõ điều này và hướng dẫn chạy FE với `NUXT_PUBLIC_API_BASE_URL` trỏ BE cục bộ hoặc BE đã triển khai.
- Giả Google bằng `GOOGLE_TOKEN_URL` và `GOOGLE_USERINFO_URL`, chỉ được nhận khi `NODE_ENV !== 'production'`, trỏ về máy chủ giả do tiến trình test dựng ngoài compose.
- Smoke test chỉ gọi HTTP API thật, không dùng trình duyệt.

## Boundaries & Constraints

**Always:**
- Nhánh `shared/*` được sửa toàn repo; schema `packages/contracts` là nguồn sự thật duy nhất.
- Không đặt bí mật thật vào repo. Đăng nhập Google thật chạy thủ công một lần khi có thông tin OAuth, không nằm trong CI.
- Smoke test mặc định bị bỏ qua trong `pnpm test`, chỉ chạy khi `RUN_COMPOSE_E2E=1` (giống test compose hiện có).

**Never:**
- Không thêm container thứ năm vào stack; máy chủ Google giả chạy trong tiến trình test.
- Không làm yếu chống lạm dụng (cookie `motion_device` ký, giới hạn IP) để test chạy được.
- Không sửa logic ví hay đối soát; chỉ thêm điểm vào để chạy đối soát từ ngoài.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Người dùng mới | Google giả, thiết bị mới | Đăng nhập thành công, `/me` balance 500, ledger có đúng 1 dòng `GRANT` | N/A |
| Tài khoản thứ hai cùng thiết bị | Cùng cookie `motion_device`, email khác | `/me` balance 0, ledger không có dòng `GRANT` | N/A |
| Đối soát sau smoke | Chạy script đối soát trong container worker | Thoát mã 0, không có user lệch | Có lệch thì thoát mã khác 0, test fail |
| Hợp đồng | `MOCK_*` và phản hồi BE thật | Cùng parse thành công qua schema contracts | Sai schema thì test fail |
| Chưa bật cờ | `RUN_COMPOSE_E2E` không đặt | Smoke test được bỏ qua kèm lý do | N/A |

</frozen-after-approval>

## Code Map

- `deploy/compose.yml` -- stack bốn container; không sửa số container.
- `deploy/compose.smoke.yml` (mới) -- override chỉ cho smoke: biến môi trường api (`NODE_ENV=test`, `COOKIE_SECURE=false`, `JWT_SECRET`, `ANTI_ABUSE_SECRET`, `GOOGLE_TOKEN_URL`, `GOOGLE_USERINFO_URL`, `FRONTEND_URL`) và `extra_hosts: host.docker.internal:host-gateway` để container tới máy chủ giả trên host.
- `apps/api/src/modules/auth/google-oauth.service.ts` -- hiện cứng `oauth2.googleapis.com` và `www.googleapis.com`; đọc URL từ env khi không phải production.
- `apps/api/src/modules/auth/auth.controller.ts`, `anti-abuse.ts` -- `/auth/google` cấp cookie `motion_device`; callback JSON khi không gửi `Accept: text/html`. Hai tài khoản dùng chung cookie thì cùng thiết bị.
- `apps/api/src/modules/ops/reconcile.service.ts` -- `reconcile()` trả danh sách lệch; tái sử dụng, không sửa.
- `apps/api/src/scripts/reconcile.ts` (mới) -- khởi tạo ngữ cảnh Nest không HTTP, gọi `reconcile()`, thoát 0 nếu rỗng, khác 0 nếu có lệch; biên dịch ra `dist/scripts/reconcile.js`.
- `apps/api/test/app.test.mjs:663` -- mẫu dựng compose (`RUN_COMPOSE_E2E=1`, project riêng, cổng riêng, luôn `down -v`); tái sử dụng cách làm.
- `apps/api/test/smoke-login.test.mjs` (mới) -- smoke và test hợp đồng nằm cùng file vì cần phản hồi BE thật.
- `packages/contracts/src/mocks.ts`, `auth.ts`, `wallet.ts` -- `MOCK_*` và schema Zod dùng để đối chiếu.
- `.github/workflows/ci.yml` -- thêm job `smoke` chạy `RUN_COMPOSE_E2E=1`.
- `README.md`, `deploy/README.md`, `apps/web/README.md` -- hướng dẫn chạy stack, FE, test và đăng nhập Google thật thủ công.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/auth/google-oauth.service.ts` -- đọc `GOOGLE_TOKEN_URL`/`GOOGLE_USERINFO_URL` từ env, bỏ qua (dùng URL Google thật) khi `NODE_ENV === 'production'` -- cho phép giả Google không đụng logic đăng nhập
- [x] `apps/api/src/scripts/reconcile.ts` -- thêm script đối soát chạy một lần với mã thoát -- để chạy đối soát trong container worker sau smoke
- [x] `deploy/compose.smoke.yml` -- thêm override smoke -- giữ stack bốn container mà vẫn trỏ Google về máy chủ giả
- [x] `apps/api/test/smoke-login.test.mjs` -- dựng stack (compose + override), máy chủ Google giả, chạy các kịch bản trong I/O Matrix, kiểm tra hợp đồng, chạy script đối soát, luôn `down -v` -- bằng chứng Epic 1 chạy trọn vẹn
- [x] `.github/workflows/ci.yml` -- thêm job `smoke` -- chạy smoke ở CI
- [x] `README.md`, `deploy/README.md`, `apps/web/README.md` -- viết các bước chạy stack, FE, test, Google thật thủ công -- người mới làm theo được

**Acceptance Criteria:**
- Given stack Compose bốn container và Google được giả, when chạy smoke với người dùng mới, then `/me` có balance 500 và `/wallet/ledger` có đúng một dòng `GRANT`.
- Given tài khoản thứ hai dùng cùng thiết bị, when đăng nhập, then `/me` balance 0 và ledger không có dòng `GRANT`.
- Given test hợp đồng, when chạy, then `MOCK_*` và phản hồi BE thật đều parse thành công qua schema trong `packages/contracts`.
- Given script đối soát, when chạy sau smoke, then thoát mã 0 và không báo lệch.
- Given `NODE_ENV=production`, when đặt `GOOGLE_TOKEN_URL` hay `GOOGLE_USERINFO_URL`, then service vẫn dùng URL Google thật.
- Given README, when người mới đọc, then làm theo được các bước chạy stack, chạy FE, chạy test; đăng nhập Google thật được mô tả là bước thủ công.

## Implementation Notes

- Smoke test chạy thật trên stack Docker (project `motion-ai-smoke`, api 3102, Postgres 15433, Redis 16380, Google giả 3199): 2 pass, 0 fail; `pnpm test` 15 pass, 0 fail khi không bật `RUN_COMPOSE_E2E`; smoke bị bỏ qua kèm lý do khi không có cờ.
- Sửa ngoài danh sách file của spec: `deploy/Dockerfile` thiếu `COPY packages/contracts/node_modules`, khiến container api lỗi `Cannot find package 'zod'`. Thuộc `deploy/**`, hợp lệ với nhánh `shared/*`.
- Thêm `apps/api/test/google-endpoint-override.test.mjs` để phủ AC production (env ghi đè bị bỏ qua khi `NODE_ENV=production`; không đặt env thì dùng URL Google thật).
- Sau review: thêm assert `isNewUser`/`grantedCredits` vào smoke và `apps/api/test/reconcile-script.test.mjs` (nhánh lệch, mã thoát 1). Xác minh lại: lint, typecheck, check:boundaries, `pnpm test` mã 0; smoke Docker và test đối soát 3/3 pass.
- Chưa kiểm chứng: job `smoke` trên GitHub CI; lệnh `docker compose ... --env-file deploy/.env up` trong README.

## Spec Change Log

## Review Triage Log

| # | Nguồn | Phát hiện | Verdict | Bằng chứng / Xử lý |
|---|-------|-----------|---------|--------------------|
| 1 | blind, verification-gap, edge-case | Smoke không assert `isNewUser`/`grantedCredits` của hai tài khoản; chỉ `balance` và đếm `GRANT` | medium → patch | `auth.ts:59-60` để hai trường là optional nên parse schema vẫn qua khi BE bỏ chúng; FE dùng chúng để báo tặng. `signup-grant.test.mjs:529-631` đã phủ ở tầng API nhưng smoke thì không. Thêm assert trong smoke. |
| 2 | verification-gap | Nhánh lệch của script đối soát (mã thoát 1, JSON `mismatch`) không có test nào; ma trận I/O ghi "có lệch thì thoát mã khác 0" | medium → patch | Chỉ `tier.test.mjs:326` gọi `ReconcileService` trực tiếp; không test nào chạy `dist/scripts/reconcile.js`. Thêm test không cần Docker, gieo một user lệch rồi chạy script, assert mã 1. |
| 3 | blind, edge-case | `reconcile.ts` dựng cả `AppModule` với role `script`, có thể chạy worker/HTTP hoặc treo | false | `reconcile.service.ts:26` chỉ cron khi role là `worker`; `worker.ts` chỉ đặt role rồi dựng cùng `AppModule`, không có consumer riêng; script gọi `process.exit` nên không treo. |
| 4 | blind | Đối soát có thể báo ok chỉ vì sổ cái rỗng/không có HOLD | false | Smoke có 2 user và ít nhất một dòng `GRANT`; logic held/balance đã có test ở `tier.test.mjs:326-360`. |
| 5 | edge-case | Nếu `ctx.close()` ném lỗi thì mã 1 bị che thành 2 | low → reject | Cả hai đều khác 0 nên test vẫn fail đúng; không ai gặp trong dùng thường. |
| 6 | blind, edge-case | `resolveEndpoint` dùng denylist `NODE_ENV !== 'production'`; NODE_ENV thiếu + env bị đầu độc có thể lộ secret | low → reject | Cần cả NODE_ENV không phải production lẫn ai đó đặt `GOOGLE_TOKEN_URL`; image runtime đặt `NODE_ENV=production`; quyết định này đã chốt trong spec. Ghi chú để người dùng cân nhắc. |
| 7 | edge-case | Override không phải URL hợp lệ làm `fetch` ném TypeError | low → reject | Chỉ xảy ra khi tự đặt giá trị sai; lỗi lớn tiếng, không im lặng. |
| 8 | blind, edge-case | Job `smoke` không build api nên import `dist` thất bại | false | `apps/api/package.json:14`: `test` là `pnpm run build && node --test ...`. |
| 9 | blind | Job `smoke` chạy cả bộ test api, lặp với job verify | low → reject | Spec chỉ định đúng lệnh này (Code Map, Verification). |
| 10 | blind | Job không dump log compose khi lỗi; cleanup nuốt lỗi | low → reject | Chỉ là tiện chẩn đoán; timeout 30 phút đã bảo vệ CI. |
| 11 | blind, verification-gap, edge-case | Cổng cố định 3102/15433/16380/3199; `up` không timeout, `down -v` có thể rò container | low → reject | Cổng khác test cũ (3101/15432/16379); runner CI sạch mỗi lần; xác suất thấp. |
| 12 | edge-case | Smoke job không có `needs`, chạy cho cả PR fork | low → reject | Thiết kế chủ ý; không phải lỗi hành vi. |
| 13 | blind, edge-case | Dòng `COPY packages/contracts/node_modules` có thể lộ dev dependency hoặc symlink gãy | false | Cả `/app/node_modules` đã được copy nguyên; smoke thật chạy xanh trên image này. |
| 14 | blind | Fake Google bind `0.0.0.0` và `host-gateway` có thể bị tường lửa chặn | low → reject | Chỉ tồn tại trong lúc test, chỉ echo code; giả định Linux có tường lửa là suy đoán. |
| 15 | blind | Secret cứng trong `compose.smoke.yml` | false | File chỉ dành cho smoke, giá trị mang nhãn test; không dùng cho dữ liệu thật. |
| 16 | blind, edge-case | So khóa hợp đồng một chiều; không so kiểu giá trị, `amount`/`note` | low → reject | `LedgerEntrySchema` đã ép `labelVi` đúng theo `type`; số dư 500 và đối soát đã ràng buộc `amount`. |
| 17 | blind | Thiếu test đường lỗi (state sai, ToS sai, code phát lại) | false | Ngoài phạm vi smoke; đã có ở `auth.test.mjs`. |
| 18 | edge-case | Chưa assert có `Set-Cookie motion_device`; mất cookie thì lỗi khó đọc | low → reject | Lỗi vẫn lớn tiếng, chỉ thông báo kém rõ. |
| 19 | edge-case | Handler `/token` giả thiếu `req.on('error')`; không có thăm dò sẵn sàng | low → reject | Chỉ là test hạ tầng nội bộ, lỗi sẽ hiện qua timeout. |
| 20 | edge-case | README `docker compose ... --env-file deploy/.env up` có thể sai đường dẫn | false | `docker compose -f deploy/compose.yml --env-file deploy/.env config -q` thoát mã 0 từ thư mục gốc. |
| 21 | edge-case | `pnpm test` không build trước thì test import `dist` lỗi | false | Script `test` của api tự build trước. |
| 22 | edge-case | Compose có thể không nội suy `PORT`/`POSTGRES_PORT`/`REDIS_PORT` | false | `compose.yml` dùng `${PORT:-3001}`, `${POSTGRES_PORT:-5432}`, `${REDIS_PORT:-6379}`; smoke thật đã chạy trên 3102. |
| 23 | edge-case | Dockerfile và test mới nằm ngoài Code Map | low → reject | Đã ghi trong Implementation Notes; `deploy/**` hợp lệ trên nhánh `shared/*`. |
| 24 | verification-gap | Ca "không cần Docker" chỉ parse `MOCK_*`, không bắt được hồi quy BE | low → reject | Là phần hợp đồng của AC; hồi quy BE được ca Docker phủ. |
| 25 | verification-gap | Không có kiểm tra `compose.yml` production không thừa hưởng `GOOGLE_*` | low → reject | Ghi chú cấu hình, không phải lỗi cụ thể; chính reviewer cũng không dựng được bằng chứng. |
| 26 | blind, edge-case | Khớp `"status":"ok"` trong stdout có thể mong manh | low → reject | Nest logger bị giới hạn ở error/warn; smoke thật đã xanh. |

## Design Notes

- Smoke gọi HTTP bằng `fetch` và parse qua schema contracts thay vì import client TypeScript của `apps/web`, vì client đã có test riêng ở Story 1.9–1.10.
- Script đối soát chạy trong container worker (`docker compose exec`) để dùng đúng `DATABASE_URL` của stack mà không lộ cổng Postgres.

## Verification

**Commands:**
- `pnpm run lint` -- expected: không lỗi.
- `pnpm run typecheck` -- expected: thành công.
- `pnpm test` -- expected: pass; smoke bị bỏ qua khi không có `RUN_COMPOSE_E2E`.
- `RUN_COMPOSE_E2E=1 pnpm --filter @motion-ai/api test` -- expected: smoke và hợp đồng pass, đối soát không lệch (cần Docker).
- `pnpm run check:boundaries` -- expected: hợp lệ với nhánh `shared/*`.
