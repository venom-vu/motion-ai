---
title: 'Story 4.3: [BE] Kết quả Body Retouch'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: '051d658147083bb99571b89b7f4f0de061457426'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.2 đã tạo và chạy Task `body_retouch`, nhưng chưa có bằng chứng (test) rằng bước nhập kết quả, `GET /tasks/{id}/result` và chia sẻ hoạt động đúng cho pipeline này: kết quả phải cùng kích thước ảnh đầu vào, `sourceUrl` rỗng khi ảnh gốc quá hạn lưu, và link chia sẻ không bao giờ lộ ảnh gốc.

**Approach:** Các đường này đã dùng chung theo cấu hình pipeline (`referenceInputKey: 'imageKey'` ở 4.2; `ResultIngestorService`, `TasksService.getResult`, `ShareService`). Story này kiểm chứng bằng test tích hợp cho `body_retouch`, và chỉ sửa mã sản xuất khi test cho thấy hành vi lệch yêu cầu; không viết đường xử lý riêng cho Body Retouch.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` (nhánh `be/*`). Mọi chuyển trạng thái và bút toán vẫn qua `tasks.transition`/`wallet`; kết quả nhập theo Story 2.6 (kiểm kích thước sau xoay EXIF, EXIF `Software: AI Generator`, lưu `gpu_coins`, `running→succeeded` kèm CAPTURED).
- Lệch kích thước so với ảnh đầu vào (`inputKeys.imageKey`) thì `failed`/`OUTPUT_INVALID` và RELEASED 100%.
- `GET /tasks/{id}/result` trả `resultUrl` và `sourceUrl` là URL ký ngắn hạn; ảnh gốc quá 7 ngày (hoặc không còn trên R2) thì `sourceUrl` là `null` và `resultUrl` vẫn hợp lệ; người không phải chủ nhận 404.
- Chia sẻ: `GET /s/<token>` của Task `body_retouch` chỉ chuyển hướng tới URL ký của `resultKey`, không chứa khóa hay URL ảnh gốc.
- Test dùng `RunningHubPort`, storage và `fetch` giả; không gọi mạng thật.

**Never:**
- Không sửa `apps/web`, `packages/contracts`; không thêm mã lỗi, endpoint hay đường chuyển trạng thái; không đổi hành vi Face Swap; không nới lỏng kiểm tra kích thước.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Kết quả đúng cỡ | Task `body_retouch` running, kết quả cùng kích thước ảnh đầu vào | `succeeded`, EXIF đúng, `gpu_coins` lưu, một CAPTURED, không RELEASED | N/A |
| Kết quả lệch cỡ | Kết quả khác kích thước ảnh đầu vào | `failed`/`OUTPUT_INVALID`, một RELEASED, không `out/` còn lại | N/A |
| Ảnh đầu vào xoay EXIF | Ảnh gốc EXIF orientation 6, kết quả khớp kích thước sau xoay | `succeeded` | N/A |
| Lấy kết quả còn ảnh gốc | Chủ Task, `succeeded`, ảnh `in/` còn trên R2 | `resultUrl` và `sourceUrl` đều là URL ký | N/A |
| Ảnh gốc quá hạn | `head` ảnh gốc trả `null` | `sourceUrl` = `null`, `resultUrl` hợp lệ | N/A |
| Người khác chủ | Token của người dùng khác | 404 `NOT_FOUND`, không URL | N/A |
| Chưa `succeeded` | Task `queued`/`running`/`failed` | 409 `CONFLICT` | N/A |
| Chia sẻ | Chủ tạo token cho Task `body_retouch` | `GET /s/<token>` 302 tới URL ký `out/…`; không có khóa `in/` hay `sourceUrl` trong `Location` | Token thu hồi: 404 |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/result-ingestor.ts` -- `validateAndEncode` (~dòng 258–310): kiểm kích thước theo `referenceInputKey`, ghi EXIF. Dùng chung, chỉ sửa nếu test lệch.
- `apps/api/src/modules/tasks/tasks.service.ts` -- `getResult` (~dòng 330–360): dựng `resultUrl`/`sourceUrl` từ `referenceInputKey`.
- `apps/api/src/modules/storage/share.service.ts` -- `create`/`resolve`: chỉ dùng `resultKey`.
- `apps/api/src/modules/pipelines/pipeline-config.ts` -- `body_retouch.referenceInputKey = 'imageKey'` (từ 4.2).
- `apps/api/test/task-result.test.mjs` -- mẫu: helper `runningTask`, `ingest`, `solid`, `fakeStorage`; hiện cố định `pipeline: 'face_swap'`. `apps/api/test/share.test.mjs` -- mẫu `succeededTask` (SQL `INSERT` với `pipeline` cố định).
- `apps/api/test/body-retouch.test.mjs` -- file test của 4.2 (đã stub ingestor); mẫu tạo Task `body_retouch` và `fakeStorage`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/test/body-retouch-result.test.mjs` -- test tích hợp đủ I/O Matrix cho `body_retouch` (nhập kết quả đúng/lệch cỡ/EXIF xoay, `GET /tasks/{id}/result`, chia sẻ) với storage và fetch giả -- chứng minh hành vi
- [x] `apps/api/src/modules/tasks/*`, `apps/api/src/modules/storage/*` -- chỉ sửa tối thiểu nếu test phát hiện lệch yêu cầu, ghi lại trong Implementation Notes -- sửa lỗi thật

**Acceptance Criteria:**
- Given Task `body_retouch` và kết quả RunningHub, when worker nhập kết quả, then cùng kích thước thì `succeeded` kèm CAPTURED và EXIF, lệch kích thước thì `failed`/`OUTPUT_INVALID` kèm RELEASED.
- Given Task `succeeded`, when chủ gọi `GET /tasks/{id}/result`, then nhận `resultUrl` và `sourceUrl` đều là URL ký, và `sourceUrl` là `null` khi ảnh gốc đã quá hạn.
- Given token chia sẻ của Task `body_retouch`, when mở `GET /s/<token>`, then chỉ chuyển hướng tới ảnh kết quả.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Test xoay EXIF không kiểm byte lưu khi kết quả tải về mang orientation (bỏ `.rotate()` vẫn qua) | medium | patch | Đúng: test cũ chỉ dùng PNG không thẻ. Đã thêm test kết quả JPEG orientation 6, kiểm ảnh lưu 40x60 và không còn thẻ orientation |
| Thiếu ca đối chứng: đầu vào orientation 6, kết quả 60x40 (kích thước thô) phải bị loại | medium | patch | Đã thêm test, kỳ vọng `failed`/`OUTPUT_INVALID` và một RELEASED |
| Gán `Queue.prototype`/env ở cấp module, không khôi phục | false | - | `pnpm test` chạy `node --test` mỗi file một tiến trình riêng (`--test-concurrency=1`); cùng mẫu với `body-retouch.test.mjs` của 4.2 |
| Ghi đè trường riêng `svc.storage`, `ingestor.fetchFn` | low | reject | Cùng mẫu `task-result.test.mjs` của Epic 2; đổi tên trường sẽ làm test fail rõ ràng |
| `runningTask` đặt `failed` mọi Task của các user trong lần chạy; `RH_MAX_CONCURRENT` tính theo toàn DB | low | reject | Test chạy tuần tự; cùng helper `clearGate` của Epic 2 |
| Thiếu ca ingest lỗi (ảnh hỏng, 500, quá cỡ, abort, JPEG/WebP, ingest hai lần, R2 lỗi) | low | reject | Đã có test cho chính các ca này ở `task-result.test.mjs` (Story 2.6) trên cùng `ResultIngestorService`; không phụ thuộc pipeline |
| Thiếu kiểm số dư user sau CAPTURED/RELEASED; `gpu_coins`=4 từ 3.6 chưa có ghi chú | low | reject | Bút toán đã kiểm bằng số dòng sổ cái, đối soát số dư có job riêng; làm tròn đã có test `consumeMoney` ở Story 2.6 |
| `/result` thiếu ca 401, id không hợp lệ, `timed_out`/`cancelled`; chia sẻ thiếu ca không chủ, token lạ | low | reject | Đã có ở `task-result.test.mjs` và `share.test.mjs` (Story 2.6, 2.9) trên cùng mã dùng chung |
| `!loc.includes('in/')` có thể khớp nhầm | low | reject | `Location` là `https://r2.example.test/out/<uuid>/<uuid>?…`, không có chuỗi `in/` hợp lệ khác; kiểm thêm khóa đầu vào đã có |
| `head` ném lỗi khi kiểm ảnh gốc | false | - | Đã có test ở Story 2.6 (`storage.head ném lỗi`: `sourceUrl = null`), `getResult` bọc try/catch |
| Không giả `RunningHubPort` | false | - | Test gọi trực tiếp ingestor nên không có đường tới RunningHub; không gọi mạng |
| Ingest gọi với đối tượng dựng tay thay vì hàng DB | false | - | Ingestor tự đọc `inputKeys` từ DB qua `getWorkerRow(task.id)` (`result-ingestor.ts:113`) |
| Hết hạn 7 ngày theo thời gian chưa kiểm | low | reject | Hạn do lifecycle R2 (`in/` 7 ngày); BE chỉ kiểm tồn tại bằng `head`, đúng thiết kế |
| Mật khẩu DB mặc định trong test, tự chạy docker/migrate | low | reject | Cùng helper `ensureInfra` ở mọi test hiện có |

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass (cần `RUNNINGHUB_WORKFLOW_BODY_RESHAPE` và Redis riêng nếu có dev worker đang chạy)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: chỉ báo các file `_bmad-output/**` chưa commit (ngoài mã story)
