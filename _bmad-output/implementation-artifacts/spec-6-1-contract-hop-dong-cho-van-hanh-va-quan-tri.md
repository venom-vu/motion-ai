---
title: 'Story 6.1: [CONTRACT] Hợp đồng cho vận hành và quản trị'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '0e3cf0319f94cd463350367b884628ff440d34b9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `@flowvis/contracts` chưa có schema cho trạng thái hệ thống, thống kê, quản lý tài khoản, nhật ký Admin và gỡ bỏ nội dung, nên luồng BE (6.2–6.7) và FE (6.8–6.9) chưa thể chạy song song trên cùng một hình dạng API.

**Approach:** Thêm `ops.ts` (system/ops status, resume, stats, audit) và `admin.ts` (users, lock/unlock/adjust, tasks lookup/takedown); mở rộng `tasks.ts` (`filesRemovedAt`, `details.reason` mới, thông báo), kèm mock, test hợp đồng và README mục 9.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `packages/contracts/**` (nhánh `contract/*`); `zod` `3.24.4`, phong cách hiện có (schema + `z.infer`, `.strict()` cho request, thông báo tiếng Việt, phân trang cursor như `pagedResponse`).
- `GET /system/status` công khai: đúng `{ intakePaused: boolean }`, `.strict()`, không lý do, không số liệu.
- `GET /admin/ops/status`: `intakePaused`, `rhBudgetExhausted`, `lastBreakerTrigger` (`at`, `rule`, `metrics`; nullable), `rhBalance` (`coins`, `readAt`; nullable), `lastBackup` (`at`, `result` `success|failed`, `sizeBytes` nullable; nullable). `POST /admin/ops/resume`: body rỗng `.strict()`, trả cùng hình dạng status.
- `GET /admin/stats`: query `from`, `to` (ISO), `scope` `real|benchmark` (mặc định `real`), tùy chọn `motionPricePerSecond`, `imagePrice` (số nguyên dương). Phản hồi: theo pipeline (số Task theo trạng thái, `successRate`, `avgProcessingSeconds`, `p95ProcessingSeconds`, `avgGpuCoins`, `wastedGpuCoins`, chi phí VNĐ trung bình theo hai kịch bản `retail` và `standardPack`); biên gộp mỗi pipeline × gói × kịch bản; chỉ số SM-1…SM-4 (`approvedTopups`, `conversionRate`, `gpuCostUsd`).
- `GET /admin/audit` (lọc `action`, `target`, phân trang); `GET /admin/users?email=`, `GET /admin/users/{id}`, `GET /admin/users/{id}/ledger` (dùng lại `LedgerEntrySchema`, mới nhất trước); `POST /admin/users/{id}/lock|unlock` (`reason`); `POST .../adjust` (`amount` số nguyên khác 0, `reason`, `requestId` uuid); `GET /admin/tasks/lookup` (đúng một trong `taskId`|`shareUrl`); `POST /admin/tasks/{id}/takedown` (`reason`).
- `reason` là chuỗi sau `trim`, bắt buộc không rỗng. `VALIDATION_FAILED` `details.reason` thêm `REASON_REQUIRED`, `TASK_NOT_FINISHED`, `ADJUST_OVER_LIMIT`, `ADJUST_INSUFFICIENT_BALANCE` (không kèm `cap`), mỗi reason có thông báo tiếng Việt.
- `Task` (kết quả `GET /tasks/{id}`) thêm `filesRemovedAt` (datetime, nullable, tùy chọn); hằng thông báo "Nội dung đã bị gỡ do vi phạm hoặc theo yêu cầu".
- Mock: trạng thái bình thường, tạm dừng, hết ngân sách; thống kê; tìm tài khoản; tìm Task; mọi mock khớp schema.

**Never:**
- Không sửa `apps/*`, `deploy/`, cấu hình gốc; không thêm phụ thuộc; không thêm giá trị `ApiErrorCode`; không nhận credit hay giá thật từ client; không có endpoint xóa/sửa `admin_audit`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Trạng thái công khai | `{intakePaused:true}`; thêm trường `reason` | Hợp lệ; từ chối (`.strict()`) | N/A |
| Adjust hợp lệ | `amount:300`, `reason`, `requestId` uuid | Parse thành công | N/A |
| Adjust sai | `amount` 0, 1.5, thiếu `requestId`, `reason` rỗng/khoảng trắng | Từ chối | Lỗi tiếng Việt trên trường đó |
| Lookup | chỉ `taskId`; chỉ `shareUrl`; cả hai; không có | Hợp lệ; hợp lệ; từ chối; từ chối | Lỗi chung của query |
| Stats scope | `scope=benchmark`; `scope=all`; `to` < `from` | Hợp lệ; từ chối; từ chối | N/A |
| Reason mới | 4 giá trị mới; giá trị lạ; kèm `cap` | 4 hợp lệ; từ chối; từ chối | Không thêm `ApiErrorCode` |
| Task đã gỡ | `filesRemovedAt` có giá trị / vắng | Cả hai hợp lệ | N/A |
| Phân trang | audit, ledger: `hasMore` lệch `nextCursor` | Từ chối | Như `pagedResponse` |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/tasks.ts` -- `TaskBaseSchema` (thêm `filesRemovedAt`), `VALIDATION_REASONS`, `ValidationDetailsSchema` (cap chỉ cho `TRIM_EXCEEDS_CAP`), `VALIDATION_REASON_MESSAGES_VI`; `TASK_PIPELINES`, `TaskStatusSchema`, `SharePublicParamsSchema` dùng lại.
- `packages/contracts/src/topups.ts` -- `pagedResponse` hiện không export; export lại để dùng chung (không đổi hành vi).
- `packages/contracts/src/wallet.ts` -- `LedgerEntrySchema`, `AccountTierSchema`, `TopupPackIdSchema`, `UserRoleSchema` (từ `auth.ts`) dùng lại; không đổi.
- `packages/contracts/src/mocks.ts` -- mẫu `MOCK_ADMIN_TOPUP_LIST_RESPONSE`; thêm `MOCK_OPS_*`, `MOCK_ADMIN_*`.
- `packages/contracts/src/index.ts` -- export `ops.js`, `admin.js`.
- `packages/contracts/test/index.test.mjs` -- thêm `describe('Epic 6 contracts')`; `README.md` mục 9.
- Không đổi: `errors.ts` (`PAUSED`, `ACCOUNT_LOCKED` đã có); `apps/*` import `TaskSchema` nên `filesRemovedAt` phải tùy chọn.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/ops.ts` -- system/ops status, resume, stats, audit -- hợp đồng vận hành
- [x] `packages/contracts/src/admin.ts` -- users, lock/unlock/adjust, tasks lookup/takedown -- hợp đồng quản trị
- [x] `packages/contracts/src/tasks.ts` -- `filesRemovedAt`, 4 reason mới, thông báo gỡ nội dung -- hợp đồng Task/lỗi
- [x] `packages/contracts/src/topups.ts`, `index.ts` -- export `pagedResponse`, `ops`, `admin` -- dùng chung
- [x] `packages/contracts/src/mocks.ts` -- mock Epic 6 -- FE chạy không cần BE
- [x] `packages/contracts/test/index.test.mjs`, `README.md` -- test I/O Matrix, mục Epic 6 -- phủ ranh giới, tài liệu

**Acceptance Criteria:**
- Given gói contracts, when build, then có đủ endpoint của AC story 6.1 và `ApiErrorCode` không thêm giá trị.
- Given `GET /system/status`, when đọc hợp đồng, then chỉ có boolean `intakePaused`.
- Given `GET /tasks/{id}` của Task đã gỡ, when đọc hợp đồng, then có `filesRemovedAt` và thông báo tiếng Việt tương ứng.
- Given mock, when chạy test hợp đồng, then mọi mock Epic 6 khớp schema; `pnpm run typecheck` của api và web vẫn pass.

## Implementation Notes

- Tên trường do triển khai chọn (spec để mở): thống kê dùng `taskCounts`, `avgCostVnd`, `margins`, `successMetrics`; nhật ký dùng `adminId`, `action`, `target`, `reason`, `requestId`; `AdminUserSchema` có `lockedAt`. BE 6.2–6.7 phải bám các tên này.
- `GET /admin/users?email=` trả một `AdminUser` (không tìm thấy là 404), không phân trang, theo AC 6.4.
- `check:boundaries` so với `main` nên liệt kê cả file Epic 4–5; từ baseline không có file nào ngoài `packages/contracts/` và `_bmad-output/`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `amount` không chặn số vượt ngưỡng an toàn (2^60 qua `.int()`) | medium | patch | Chạy được trước vá; thêm `.safe()` và test |
| Thiếu test cho schema phản hồi lock/adjust/takedown, query ledger/audit/search, `MOCK_ADMIN_USER_LOCKED`; không có khẳng định `ApiErrorCode` không đổi | medium | patch | AC yêu cầu; đã thêm test, 55/55 pass |
| `successMetrics` chỉ 3 trường so với "SM-1…SM-4" | low | defer | SM-1/2 gộp thành `conversionRate`; BE 6.6 chốt ánh xạ |
| Thiếu `pausedReason`, hành vi `resume` khi ví RH còn cạn | low | defer | Ngoài AC 6.1; thuộc 6.2/6.3 |
| `rule`/`metrics` của ngắt mạch, `action`/`target` của audit là chuỗi tự do | low | defer | Enum chốt khi BE 6.2/6.4/6.5 biết đủ giá trị |
| Phản hồi `result`/`share` của Task đã gỡ chưa có hình dạng riêng | medium | defer | AC 6.5 mô tả; chốt ở 6.5 cùng FE 6.9, mất thêm quyết định hợp đồng |
| `from`/`to` chưa nhận offset; không giới hạn khoảng thời gian | low | reject | Sửa chỉ thêm tham số/nhánh, ít gặp |
| `shareUrl` chưa ép dạng `/s/{token}`; email chưa chuẩn hóa | low | reject | BE tách token và 404 theo AC 6.5 |
| Ràng buộc chéo `rhBudgetExhausted ⇒ intakePaused`, `failed ⇒ sizeBytes null` | low | reject | Spec không yêu cầu; thêm nhánh |
| `.max(500)` của `reason` không có trong spec | low | reject | Hợp lý, có thông báo tiếng Việt |
| Export `pagedResponse` làm lộ helper, trùng `isoDate` | low | reject | Code Map đã nêu export; tách `common.ts` là refactor |
| Margin mock âm, thiếu test `to === from`, `<` thành `<=` | low | reject | Cosmetic |
| Spec `in-review` còn sprint-status `in-progress` | false | - | Đúng quy trình; đồng bộ ở bước present |

## Verification

**Commands:**
- `pnpm --filter @flowvis/contracts test` -- expected: pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass
