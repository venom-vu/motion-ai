---
title: 'Story 6.8: [FE] Trang vận hành Admin'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
baseline_commit: '31f0b881fd2866a97adc0c8a44f0e62906ee33e5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Admin chưa có màn hình để xem trạng thái ngắt mạch/ngân sách RunningHub, mở lại nhận Task, xem thống kê, khóa/mở khóa và bù credit tài khoản, gỡ nội dung vi phạm, đọc nhật ký; phải chạm vào cơ sở dữ liệu.

**Approach:** Thêm trang `/admin/ops` (layout `admin`) gồm các khối: trạng thái, thống kê, tài khoản, gỡ nội dung, nhật ký; thêm method vào `api-client`, composable `useAdminOps`, thông báo tiếng Việt cho 4 `details.reason` mới. Chỉ sửa `apps/web`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/web/**` (nhánh `fe/*`); dùng schema/mock từ `@flowvis/contracts`, parse mọi phản hồi qua Zod; phong cách Vercel của layout admin, icon Lucide, không emoji, vùng chạm 48px, dùng được ở 360px.
- Chặn truy cập như `/admin/topups`: chưa đăng nhập hoặc `role !== 'admin'` thấy 403, không gọi API ops nào.
- Trạng thái làm mới định kỳ; thẻ có `readAt`/`at` quá cũ thì có nhãn cảnh báo.
- "Mở lại nhận Task" chỉ bật khi `intakePaused || rhBudgetExhausted`; hộp xác nhận nêu rủi ro Task thất bại nhanh và số dư lần đọc cuối; chỉ sau xác nhận mới `POST /admin/ops/resume`.
- Thống kê: chọn `from`/`to` và `scope`; ô giá thử (`motionPricePerSecond`, `imagePrice`) chỉ gửi làm query tính lại, không đổi giá thật.
- Khóa/Mở khóa/Gỡ nội dung bắt buộc lý do; Cộng/Trừ bù: số nguyên khác 0, lý do, hộp xác nhận nêu số dư trước/sau, `requestId` sinh một lần khi mở form (bấm hai lần không cộng hai lần); khóa nút khi đang gửi.
- Quyết định (Câu hỏi 1 = C): contracts chưa có danh sách token chia sẻ, nên khối gỡ nội dung hiển thị Task, chủ Task, `filesRemovedAt` và dòng "Token chia sẻ sẽ bị thu hồi khi gỡ" thay cho danh sách token; không sửa contracts.
- "Gỡ bỏ ngay" vô hiệu kèm giải thích khi Task chưa kết thúc (`queued`/`running`).
- Nhật ký mới nhất trước, lọc `action`/`target`, tải thêm theo cursor.
- `VALIDATION_FAILED` với `REASON_REQUIRED`, `TASK_NOT_FINISHED`, `ADJUST_OVER_LIMIT`, `ADJUST_INSUFFICIENT_BALANCE` hiển thị thông báo tiếng Việt qua bảng của contracts.

**Never:**
- Không sửa `packages/contracts`, `apps/api`, cấu hình gốc; không thêm phụ thuộc; không thêm `ApiErrorCode`; không hiển thị dữ liệu trước khi xác nhận là admin.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Không phải admin | role `user`/khách | 403, không gọi API | N/A |
| Không có cờ | cả hai cờ false | Nút mở lại bị vô hiệu | N/A |
| Đang tạm dừng | `intakePaused` true | Xác nhận rồi POST resume, cập nhật thẻ | Lỗi hiển thị tiếng Việt |
| Bù credit | `amount` 0 / 1.5 / lý do rỗng | Chặn tại form | Thông báo trên trường |
| Bù vượt giới hạn/thiếu số dư | server trả reason | Thông báo tiếng Việt tương ứng | `ADJUST_OVER_LIMIT`, `ADJUST_INSUFFICIENT_BALANCE` |
| Bấm bù hai lần | cùng `requestId` | Server idempotent; form dùng lại `requestId` | N/A |
| Tra cứu Task | dán `shareUrl` hoặc `taskId` | Gọi `lookup` đúng một tham số | Không tìm thấy: thông báo lỗi |
| Task chưa kết thúc | `queued`/`running` | Nút gỡ vô hiệu + giải thích | `TASK_NOT_FINISHED` nếu server từ chối |

</frozen-after-approval>

## Code Map

- `apps/web/pages/admin/topups.vue` -- mẫu chặn 403 (`useAsyncData(ME_KEY)`, `isMePending`, `isAdmin`) và UI admin; tái dùng.
- `apps/web/composables/useAdminTopups.ts` -- mẫu composable (cursor, chống gọi chồng, `runAction`).
- `apps/web/utils/api-client.ts` -- thêm method `adminOps*` cạnh `adminListTopups` (~dòng 841); re-export type ở khối `export {…}`.
- `apps/web/layouts/admin.vue` -- thêm mục điều hướng `/admin/ops`.
- `packages/contracts/src/{ops,admin,mocks}.ts` -- schema và `MOCK_OPS_*`, `MOCK_ADMIN_*` (chỉ đọc).
- `apps/web/test/admin-topups.test.mjs` -- mẫu test (fetch giả + compile SFC). Không có chế độ mock runtime (README): "mock" = `MOCK_*` qua `fetchImpl`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/utils/api-client.ts` -- thêm `getOpsStatus`, `resumeOps`, `getAdminStats`, `searchAdminUser`, `getAdminUserLedger`, `lockUser`, `unlockUser`, `adjustUser`, `lookupAdminTask`, `takedownTask`, `listAdminAudit` -- gọi endpoint 6.1
- [x] `apps/web/composables/useAdminOps.ts` -- trạng thái + làm mới định kỳ, thống kê, tài khoản, gỡ nội dung, nhật ký -- logic tách khỏi trang
- [x] `apps/web/pages/admin/ops.vue` (+ component con nếu cần) -- 5 khối UI, hộp xác nhận, 403 -- AC story
- [x] `apps/web/layouts/admin.vue` -- thêm mục `/admin/ops`
- [x] `apps/web/test/admin-ops.test.mjs` -- test client, composable, I/O Matrix, 403 và thông báo reason -- phủ

**Acceptance Criteria:**
- Given non-admin, when mở `/admin/ops`, then 403 và không gọi API.
- Given mock tạm dừng/hết ngân sách, when tải, then thẻ hiển thị đúng và nút mở lại bật; mock bình thường thì nút tắt.
- Given `pnpm run lint`, `typecheck`, `test` ở gốc, then pass; không file ngoài `apps/web` đổi.

## Implementation Notes

- Ngưỡng nhãn "cũ" do triển khai chọn: số dư RunningHub 30 phút, sao lưu 36 giờ; làm mới trạng thái mỗi 30 giây.
- Không có test chạy trình duyệt thật ở 360px; kiểm bằng SSR, chạy script thật của `ops.vue` (composable bị stub) và test composable.
- 3 test fail có sẵn ở nhánh gốc (Motion Control 5.8, popover tài khoản), không do story này; `check:boundaries` so với `main` nên báo cả file của các story trước trên nhánh.
- Đã vá sau review: `requestId` bù theo payload, lỗi sổ cái không bỏ user, chống ghi đè muộn, seq poll/resume, bộ lọc nhật ký đã áp dụng, email trong hộp xác nhận.
- Hoãn: truy cập bàn phím của hộp xác nhận và dừng polling khi mất quyền (xem `deferred-work.md`).

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm --filter @flowvis/web test` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `adjustRequestId` giữ nguyên khi Admin sửa số tiền/lý do sau lần gửi lỗi | medium | patch | `adjustUser` chỉ sinh id khi null; gửi lại payload khác với id cũ. |
| `searchUser` bỏ user đã tìm thấy khi `loadLedger` lỗi | medium | patch | `loadLedger` nằm trong cùng `try`; `catch` đặt `user=null`. |
| Phản hồi lock/unlock/adjust/takedown/loadMoreLedger ghi đè user/task mới tìm | medium | patch | `current` bắt trước `await`, gán `user.value = ...` không kiểm tra id. |
| `resumeIntake` trả `false` không báo lỗi khi cờ vừa tắt | low | patch | `!canResume()` return sớm, `resumeErrorVi` null, hộp xác nhận im lặng. |
| Poll status cũ ghi đè kết quả resume | low | patch | `refreshStatus` và `resumeIntake` cùng ghi `status` không có seq. |
| Load-more nhật ký dùng bộ lọc đang sửa thay vì bộ lọc đã áp dụng | low | patch | `fetchAudit(false)` đọc `auditAction/auditTarget` hiện tại với cursor cũ. |
| Dòng "Token chia sẻ sẽ bị thu hồi" vẫn hiện khi đã gỡ | low | patch | Dòng tĩnh, không phụ thuộc `filesRemovedAt`. |
| Hộp xác nhận lock/unlock/adjust không nêu email tài khoản | low | patch | Chỉ nêu lý do/số dư. |
| Không test chạy script thật của `ops.vue` (403 không gọi API, `runConfirm`, `start`); thiếu test `unlockUser`, takedown thành công, `loadMoreLedger`, `fetchStats`, seq nhật ký | medium | patch | SSR test truyền sẵn binding; hàng I/O "Không phải admin: không gọi API" chưa được kiểm bằng test chạy script. |
| `isTaskFinished` kiểm phủ định `queued/running` | false | - | Enum contracts chỉ có queued, running và 4 trạng thái kết thúc; hiện tương đương. |
| Điều hướng `/admin` bị đánh dấu trùng `/admin/ops` | false | - | `admin.vue` so sánh `route.path === item.to` chính xác. |
| `lastBackup.result` lạ hiển thị "Thất bại" | false | - | Enum chỉ `success|failed`. |
| `getMe` lỗi hiện 403; `type=email`; key theo index; `gpuCostUsd` thô; seconds của `to` mặc định; submit stats bị bỏ khi đang tải; ZodError chung; test harness ghi file tạm; test `cap`/fallback của `resolveAdminErrorMessageVi` | low | reject | Không thấy hậu quả cụ thể trong dùng thường ngày; cùng mẫu với `/admin/topups`; sửa phức tạp hơn lợi ích. |
| Modal thiếu `aria-labelledby`/focus trap/Esc; polling không dừng khi mất quyền admin hoặc 401/403 | low | defer | Có thật nhưng không do story này gây riêng; ghi vào `deferred-work.md`. |
