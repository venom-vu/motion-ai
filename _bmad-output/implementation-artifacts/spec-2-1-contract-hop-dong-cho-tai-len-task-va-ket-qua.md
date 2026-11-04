---
title: 'Story 2.1: [CONTRACT] Hợp đồng cho tải lên, Task và kết quả'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '367508303da39f85d17217db5d3bbbd4d5f97e2d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `@motion-ai/contracts` chưa có enum `reasonCode`, trạng thái Task, schema validate ảnh, schema và mock cho các endpoint tải lên, Task, kết quả, chia sẻ của Epic 2, nên luồng BE (2.2–2.9) và FE (2.10–2.13) chưa thể chạy song song trên cùng một hình dạng API.

**Approach:** Thêm `src/uploads.ts` và `src/tasks.ts` vào `packages/contracts`, bổ sung mã lỗi API còn thiếu, bảng thông báo tiếng Việt theo `reasonCode` (ghi đè được theo pipeline), mock cho mọi trạng thái Task, hàng đợi, kết quả, và test hợp đồng.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `packages/contracts/**` (tiền tố nhánh `contract/*`); tiếp tục dùng `zod` `3.24.4`, theo phong cách `wallet.ts`/`auth.ts` (schema + `z.infer`, `superRefine` cho bất biến, thông báo tiếng Việt).
- `reasonCode` gồm đúng 16 mã của AC: `RH_ERROR`, `RH_TIMEOUT`, `RH_SUBMIT_UNKNOWN`, `RH_BUDGET`, `PREP_TIMEOUT`, `RH_GATE_TIMEOUT`, `FFMPEG_ERROR`, `INPUT_FETCH_ERROR`, `OUTPUT_UPLOAD_ERROR`, `OUTPUT_INVALID`, `INTERNAL_ERROR`, `NO_POSE`, `NO_FACE`, `CONTENT_BLOCKED`, `FREE_WAIT_EXPIRED`, `USER_CANCEL`. Trạng thái Task gồm `queued`, `running`, `succeeded`, `failed`, `timed_out`, `cancelled`.
- Endpoint có schema request và response: `POST /uploads`, `POST /uploads/{key}/confirm`, `POST /tasks/face-swap` (`sourceKey`, `targetKey`, `consent`), `GET /tasks` (phân trang cursor như `wallet/ledger`), `GET /tasks/{id}`, `POST /tasks/{id}/cancel`, `GET /tasks/{id}/result` (`resultUrl`, `sourceUrl` nullable), `POST /tasks/{id}/share`, `DELETE /tasks/{id}/share`, `GET /s/{token}` (params; phản hồi thành công là chuyển hướng nên không có body, 404 dùng `ApiError`).
- Một schema ảnh duy nhất (JPG/PNG/WebP, ≤ 10 MB, cạnh ngắn ≥ 512 px, tỷ lệ 1:2 đến 2:1) kèm hằng số giới hạn; `POST /uploads` dùng cùng schema cho loại và kích thước khai báo.
- `reasonCode` → thông báo tiếng Việt có hàm tra cứu nhận `pipeline` tùy chọn; `NO_FACE` = "Không nhận diện được khuôn mặt trong ảnh", `CONTENT_BLOCKED` = "Ảnh/video vi phạm tiêu chuẩn cộng đồng, vui lòng chọn file khác."; `NO_POSE` ghi đè khác nhau cho Body Retouch và Motion Control.
- Trạng thái và `reasonCode` bất biến ở schema Task: `queued`/`running`/`succeeded` không có `reasonCode`; `failed`/`timed_out`/`cancelled` bắt buộc có; `queuePosition` chỉ có khi `queued`; `resultKey` chỉ khi `succeeded`; `cancelled` chỉ với `USER_CANCEL`; `FREE_WAIT_EXPIRED` chỉ với `timed_out`.
- Bổ sung `ApiErrorCode` `NOT_FOUND`, `FORBIDDEN`, `CONFLICT` (Task không tồn tại hoặc token thu hồi, không phải chủ Task, hủy Task đã `running`/Task chưa `succeeded`) kèm thông báo tiếng Việt; cập nhật test enum cũ và README.
- Không lộ khóa hoặc URL của RunningHub trong bất kỳ schema nào.

**Never:**
- Không sửa `apps/*`, `deploy/`, cấu hình gốc; không định nghĩa hợp đồng Body Retouch, Motion Control, nạp tiền, admin (chỉ để mở rộng `pipeline` enum sau).
- Không nhận số credit từ client; không thêm phụ thuộc mới.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Khai báo tải lên hợp lệ | `image/jpeg`, 2 MB | `UploadCreateRequestSchema` parse thành công | N/A |
| Khai báo sai | `image/gif`, hoặc 10 MB + 1 byte | `success: false` | Thông báo tiếng Việt trên trường sai |
| Ảnh đo được không đạt | cạnh ngắn 511 px, hoặc tỷ lệ 2.1:1 | Schema ảnh từ chối | Lỗi trên `width`/`height` |
| Tạo Task thiếu cam kết | `consent: false` hoặc thiếu | Request schema từ chối | Chỉ `true` được chấp nhận |
| Task sai bất biến | `failed` thiếu `reasonCode`; `succeeded` có `reasonCode`; `queued` thiếu `queuePosition` | `TaskSchema` từ chối | Lỗi trên trường vi phạm |
| Kết quả hết hạn ảnh gốc | `sourceUrl: null` | `TaskResultResponseSchema` chấp nhận | N/A |
| `reasonCode` ngoài danh sách | `'FOO'` | Schema từ chối; hàm tra cứu trả thông báo mặc định | N/A |
| Mock mọi trạng thái | 6 trạng thái, hàng đợi, kết quả | Parse thành công qua schema tương ứng | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/errors.ts` -- thêm `NOT_FOUND`, `FORBIDDEN`, `CONFLICT` vào `ApiErrorCode` và `API_ERROR_MESSAGES_VI` (kiểu `Record` bắt buộc đủ khóa).
- `packages/contracts/src/uploads.ts` -- MỚI: hằng số giới hạn ảnh, `ImageMetaSchema`, schema `POST /uploads` và `confirm`.
- `packages/contracts/src/tasks.ts` -- MỚI: enum `pipeline`, `reasonCode`, trạng thái, `TaskSchema`, endpoint Task/result/share, bảng thông báo và hàm tra cứu theo `reasonCode` + `pipeline`.
- `packages/contracts/src/wallet.ts` -- tham chiếu mẫu phân trang (`WalletLedgerResponseSchema`) và `TierSnapshotSchema`; không sửa.
- `packages/contracts/src/mocks.ts` -- thêm mock upload, Task ở mọi trạng thái, hàng đợi, kết quả, chia sẻ, danh sách Task.
- `packages/contracts/src/index.ts` -- re-export `uploads.js`, `tasks.js`.
- `packages/contracts/test/index.test.mjs` -- sửa assert danh sách `ApiErrorCode`; thêm test cho ma trận trên.
- `packages/contracts/README.md` -- mục Epic 2.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/errors.ts` -- thêm 3 mã lỗi và thông báo -- thiếu mã cho 404/403/409
- [x] `packages/contracts/src/uploads.ts` -- hằng số và schema ảnh, upload -- một nguồn cho FE/BE
- [x] `packages/contracts/src/tasks.ts` -- enum, `TaskSchema`, endpoint, bảng thông báo -- hợp đồng chính
- [x] `packages/contracts/src/mocks.ts`, `src/index.ts` -- mock và export -- FE chạy không cần BE
- [x] `packages/contracts/test/index.test.mjs`, `README.md` -- test I/O Matrix, cập nhật tài liệu

**Acceptance Criteria:**
- Given gói contracts, when build, then xuất đủ 16 `reasonCode` và 6 trạng thái Task.
- Given mỗi endpoint của epic, when đọc hợp đồng, then có schema request và response dùng chung.
- Given FE và BE, when import quy tắc ảnh, then dùng chung một schema.
- Given bảng thông báo, when tra `NO_FACE`, `CONTENT_BLOCKED`, `NO_POSE` theo pipeline, then đúng văn bản/ghi đè.
- Given mock, when chạy test hợp đồng, then mọi mock khớp schema.

## Implementation Notes

- Chỉ sửa `packages/contracts/**`: thêm `src/uploads.ts`, `src/tasks.ts`; sửa `errors.ts`, `mocks.ts`, `index.ts`, test, README.
- `TaskSchema` có thêm `id`, `pipeline`, `creditCost`, `createdAt`, `updatedAt`. `TASK_PIPELINES` hiện chỉ có `face_swap`; ghi đè `NO_POSE` dùng danh sách riêng gồm `body_retouch`, `motion_control`.
- `ImageMetaSchema`: cạnh ngắn < 512 báo trên trường cạnh ngắn; sai tỷ lệ báo trên trường cạnh dài.
- Xác minh: contracts test 20/20, lint, typecheck, `check:boundaries` đều qua (chạy trên `main`, nên luật `contract/*` chưa được thực thi thật).

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Khóa `in-raw/`, `in/`, `out/` dùng `[^/]+`, nhận `..` hoặc chuỗi tùy ý | medium | patch | Khóa do server sinh dạng `<prefix>/<userId>/<uuid>`; mock đều là UUID; siết regex không thêm bề mặt công khai |
| `PREP_TIMEOUT` không bị ép là `timed_out` | medium | patch | CLAUDE.md: "PREP_TIMEOUT luôn là timed_out"; `TaskSchema` hiện nhận `failed` + `PREP_TIMEOUT` |
| Thiếu test `USER_CANCEL` trên trạng thái khác `cancelled` | low | patch | Xóa luật ở `tasks.ts:336-338` mà test vẫn qua |
| Thiếu test `.strict()` (credit từ client) và từ chối khóa `in-raw/` ở `sourceKey` | medium | patch | Bỏ `.strict()` mà test vẫn qua |
| Thiếu test đường dẫn lỗi `height` của `ImageMetaSchema` và biên đúng 2:1 | low | patch | Chỉ có test nhánh `width`; sửa một dòng test |
| Khóa chứa `/` làm tham số đường dẫn của `confirm` chưa nói rõ cách mã hóa | low | patch | Chỉ thêm một dòng README: client mã hóa URL; không đổi schema |
| Giới hạn 10 file chưa có mã lỗi | false | - | Epic 2.2 đã quy định `VALIDATION_FAILED` |
| Ràng buộc `Content-Length` của presigned URL | false | - | Thuộc cài đặt Story 2.2 (AC ký kèm `Content-Length`) |
| Thông báo `NO_FACE` thiếu câu hoàn credit | false | - | AC của 2.1 quy định đúng chuỗi này |
| `NO_POSE`/`CONTENT_BLOCKED` ghi "ảnh/video" cho Face Swap | false | - | `NO_POSE` không xảy ra với Face Swap; chuỗi `CONTENT_BLOCKED` do AC quy định |
| `NOT_FOUND` nói "thu hồi" không đúng với token hết hạn | false | - | Câu có "hoặc", gộp cả không tìm thấy lẫn thu hồi |
| Cảnh báo `cancelled` + `USER_CANCEL` trùng issue | false | - | `cancelled` với `NO_FACE` chỉ sinh một issue; hai luật không chồng nhau |
| `sourceKey === targetKey`; `updatedAt >= createdAt`; chỉ chấp nhận https; giới hạn kích thước tối đa; lọc `status` ở `GET /tasks`; thứ tự mới nhất trước của danh sách Task; `DELETE share` lặp | low | reject | Intent không yêu cầu; sửa thêm nhánh/tham số, hoặc thuộc BE (sharp resize ở 2.2) |
| Cảnh báo sai về mock (cdn.example.test, cùng timestamp, không có `hasMore: true`) | low | reject | Không gây hại cho FE; thêm mock phân trang là phạm vi ngoài |
| `UploadConfirmRequestSchema` không có test riêng | low | reject | Mẫu `MeRequestSchema` đã có sẵn; rủi ro thấp |

## Verification

**Commands:**
- `pnpm --filter @motion-ai/contracts test` -- expected: pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass
