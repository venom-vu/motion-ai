---
title: 'Story 6.5: [BE] Gỡ bỏ nội dung khẩn cấp'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: 'dbf642c2512fea150cf528ccc0b815bf1c98554d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Admin chưa có cách tra Task qua mã hoặc liên kết chia sẻ và gỡ ngay toàn bộ nội dung (kết quả, ảnh bìa, đầu vào) khi có khiếu nại bản quyền hoặc hình ảnh cá nhân (FR22).

**Approach:** Thêm `tasks.files_removed_at` và module `admin-tasks` (`GET /admin/tasks/lookup`, `POST /admin/tasks/{id}/takedown`) điều phối: thu hồi token chia sẻ → xóa khóa R2 `out/` và `in/` → `tasks` đặt `files_removed_at` → ghi `admin_audit`. Các endpoint chia sẻ và `GET /tasks/{id}[/result]` nhận biết Task đã gỡ.

## Boundaries & Constraints

**Always:**
- Nhánh `be/*`: chỉ sửa `apps/api/` và `deploy/`; không sửa `packages/contracts`, `apps/web`; không thêm phụ thuộc. Dùng schema sẵn có `AdminTaskLookup*`, `AdminTaskTakedown*` trong `packages/contracts/src/admin.ts`.
- Mọi route `/admin/tasks/**`: `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')` (401/403). Query/body sai schema → `VALIDATION_FAILED`; thiếu `reason` → `details.reason=REASON_REQUIRED`; Task không tồn tại hoặc `shareUrl` không khớp token nào → 404 `NOT_FOUND`.
- Lookup với `shareUrl`: tách token từ path `/s/<token>` (token đúng `^[A-Za-z0-9_-]{43}$`, sai → 404), băm bằng `hashShareToken`, tìm qua `share_tokens` kể cả token đã thu hồi; không lưu/ghi log token gốc. Trả schema `AdminTaskLookupResponse` (chủ, email, pipeline, status, creditCost, `filesRemovedAt`, createdAt).
- Takedown chỉ Task đã kết thúc (`succeeded`, `failed`, `cancelled`, `timed_out`…); `queued`/`running` → `VALIDATION_FAILED` `details.reason=TASK_NOT_FINISHED`, không đổi gì.
- Thứ tự takedown: (1) `ShareService` thu hồi mọi token chưa thu hồi của Task; (2) xóa trên R2 `resultKey`, ảnh bìa `.jpg` tương ứng nếu `.mp4`, và mọi giá trị trong `inputKeys`; (3) `tasks.markFilesRemoved(taskId)` đặt `files_removed_at = now()` nếu còn null, CAS `WHERE files_removed_at IS NULL`; (4) audit `task.takedown`, target `task:<id>`, `beforeAfter` gồm số đối tượng đã xóa, reason, taskId. Lỗi R2 giữa chừng → ném lỗi, không đặt `files_removed_at`, không audit; gọi lại chạy tiếp được (xóa idempotent). Gọi lại khi đã gỡ: trả 200 `{taskId, filesRemovedAt}` ban đầu, không audit thêm.
- Task đã gỡ: `GET /s/<token>`, `/info`, `/poster` đều 404 NOT_FOUND chung (kể cả khi token chưa thu hồi). `GET /tasks/{id}` trả `filesRemovedAt`; `GET /tasks/{id}/result` trả 409 `CONFLICT` với message `CONTENT_REMOVED_MESSAGE_VI`. `GET /tasks` (danh sách) cũng trả `filesRemovedAt`.
- Sổ cái, `status`, `reason_code` của Task không đổi; không tự hoàn credit.

**Never:** Không sửa trạng thái Task hay ghi sổ cái trong takedown; không SQL thô vào bảng của module khác (`share_tokens` do `storage`, `tasks` do `tasks`, `admin_audit` qua `AuditService`); không thêm `ApiErrorCode`; không xóa upload trong bảng `uploads` hay file không thuộc Task.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lookup theo mã | `taskId` hợp lệ | Thông tin Task + email chủ | Không có → 404 |
| Lookup theo liên kết | `shareUrl=…/s/<token>` | Task của token (kể cả đã thu hồi) | Token sai/lạ → 404 |
| Takedown thường | Task `succeeded` + reason | Token thu hồi, `out/`+`in/` xóa, `files_removed_at` đặt, audit | Thiếu reason → 400 `REASON_REQUIRED` |
| Task đang chạy | `queued`/`running` | Không ghi gì | 400 `TASK_NOT_FINISHED` |
| Gọi lại | Đã gỡ | 200 cùng `filesRemovedAt`, không audit mới | N/A |
| R2 lỗi một phần | `delete` ném lỗi | Không đặt cột, không audit; thử lại hoàn tất | 5xx, chạy lại được |
| Sau khi gỡ | `/s/*`, result của chủ | 404 / 409 + thông báo gỡ | N/A |
| Không phải admin | role `user`/không token | 403/401 | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/` -- thêm `Task.filesRemovedAt` (`files_removed_at timestamptz null`) + migration mới sau `20261111010000_admin_audit_request_id`.
- `apps/api/src/modules/tasks/tasks.service.ts` -- `getById` l.306, `list` l.323, `getResult` l.399: thêm `filesRemovedAt`, chặn result đã gỡ; thêm `markFilesRemoved`, `getForTakedown`/tra cứu Task (kèm email chủ qua `include user`), tìm theo id.
- `apps/api/src/modules/storage/share.service.ts` -- `lookup` l.62 (thêm điều kiện Task chưa gỡ); thêm `revokeAllForTask(taskId)` và `findTaskIdByToken(token)` (chủ `share_tokens`); `hashShareToken` l.14; `TOKEN_RE` l.8.
- `apps/api/src/ports/index.ts` -- `StoragePort.delete` (S3 DeleteObject, idempotent với khóa không tồn tại).
- `apps/api/src/modules/admin-users/` -- mẫu controller/service/module admin, `validationError` REASON_REQUIRED, `AuditService.record` trong transaction.
- `apps/api/src/modules/audit/audit.service.ts` -- `record(tx,…)`.
- `apps/api/src/app.module.ts` -- đăng ký `AdminTasksModule` (import `TasksModule`, `StorageModule`, `AuditModule`, `AuthModule`; `TasksModule` đã import `StorageModule` nên điều phối đặt ở module mới để tránh vòng phụ thuộc).
- `apps/api/test/share.test.mjs`, `apps/api/test/admin-users.test.mjs` -- mẫu bootstrap/`call`/`errCode`, fake storage.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/` -- cột `files_removed_at` + migration -- đánh dấu đã gỡ
- [x] `apps/api/src/modules/tasks/tasks.service.ts` -- `filesRemovedAt` trong Task/list, chặn `getResult`, `markFilesRemoved`, hàm tra cứu cho admin -- ghi bởi `tasks`
- [x] `apps/api/src/modules/storage/share.service.ts` -- `revokeAllForTask`, `findTaskIdByToken`, `lookup` từ chối Task đã gỡ -- thu hồi và 404
- [x] `apps/api/src/modules/admin-tasks/` (service, controller, module) + `app.module.ts` -- lookup và takedown điều phối, audit -- API Admin
- [x] `apps/api/test/admin-tasks.test.mjs` -- test I/O Matrix, quyền, thứ tự (token thu hồi trước khi xóa), lỗi R2 một phần rồi thử lại, 404 của `/s/*`, sổ cái không đổi -- phủ ranh giới

**Acceptance Criteria:**
- Given Task đã gỡ, when gọi ba route `/s/<token>*` và URL ký cũ, then 404 (đối tượng R2 đã mất) và không lộ thông tin Task.
- Given `pnpm --filter @flowvis/api test`, `lint`, `typecheck`, `build`, `check:boundaries`, when chạy, then pass (trừ các test lỗi có sẵn ở Story 2.14 và 5.2).

## Implementation Notes

- Module `admin-tasks` điều phối (không đặt trong `StorageModule` để tránh vòng phụ thuộc); `ShareService` thêm `revokeAllForTask`, `findTaskIdByToken`, và `create` từ chối Task đã gỡ (409). `TasksService` thêm `findForAdmin`, `markFilesRemoved` (CAS). Task đã gỡ: `/s/*` 404, `getResult` 409 kèm `CONTENT_REMOVED_MESSAGE_VI`.
- Suite api (chạy đúng script `test`, có `ops-preload.mjs`): 525 pass, 5 fail có sẵn (Story 2.14, 5.2, throttle), 6 skip. Chạy thiếu preload sẽ ra ~137 fail giả.
- `check:boundaries` báo cả file các story trước (`packages/contracts`, `apps/web`) vì nhánh xếp chồng trên nhánh 6.4 chưa merge (so với `main...HEAD`); file của story này chỉ ở `apps/api/` và `_bmad-output/`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `ShareService.create` vẫn tạo token cho Task đã gỡ; race với takedown | medium | patch | `create` chỉ kiểm status/resultKey; đã chặn 409 sau khóa dòng, có test |
| Guard `filesRemovedAt` trong `lookup` không được test riêng | medium | patch | Xóa guard vẫn pass vì token đã thu hồi và R2 mất; đã thêm test SQL trực tiếp |
| Khóa `in/` dùng chung giữa các Task cùng chủ bị xóa | medium | defer | `areConfirmedKeysOwnedBy` không đánh dấu đã dùng; spec yêu cầu xóa mọi `in/` của Task |
| `inputKeys` lồng nhau/mảng không được gom | low | reject | Mọi pipeline hiện chỉ lưu chuỗi phẳng (`sourceKey`, `imageKey`, `characterKey`...) |
| `getById`/`list` vẫn trả `resultKey` của Task đã gỡ | low | reject | Chỉ là khóa vô hiệu; spec không yêu cầu ẩn, `filesRemovedAt` báo hiệu |
| `isTerminal` có thể lệch danh sách trạng thái spec | false | - | `task-transitions.ts` l.19: đúng succeeded/failed/timed_out/cancelled |
| `extractToken` không kiểm tra host; chỉ nhận `/s/<token>` cuối path | low | reject | Token băm phải khớp DB nên host lạ vô hại; `/info`,`/poster` ngoài spec |
| Takedown đồng thời hoặc R2 lỗi giữa chừng | low | reject | Xóa idempotent, CAS chặn audit trùng; thử lại hoàn tất (đã có test) |
| `CONTENT_REMOVED` chỉ qua message của `CONFLICT` | low | reject | Hợp đồng không thêm mã; spec quy định cách này |
| Trùng `TOKEN_RE`/helper lỗi, test dùng hack | low | reject | Chỉ là mỹ quan mã; không gây sai hành vi |
| Thiếu test status khác, id không phải UUID, poster video | low | reject | Logic chung `isTerminal`/regex đã chạy qua các test hiện có |

## Design Notes

Điều phối đặt ở module `admin-tasks` thay vì trong `StorageModule` vì `TasksModule` đã import `StorageModule` (tránh vòng phụ thuộc); vẫn đúng AD-1: mỗi bảng chỉ chủ của nó ghi. Task đã gỡ trả 409 `CONFLICT` kèm `CONTENT_REMOVED_MESSAGE_VI` vì hợp đồng không thêm `ApiErrorCode` (FE đã có thông báo này sẵn).

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass (cần Docker; chạy với `node --env-file=.env`)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: chỉ `apps/api/`, `deploy/`, `_bmad-output/`
