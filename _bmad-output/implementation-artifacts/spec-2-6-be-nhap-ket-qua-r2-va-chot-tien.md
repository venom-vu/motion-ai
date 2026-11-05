---
title: 'Story 2.6: [BE] Nhập kết quả về R2 và chốt tiền'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '6b943e4d6b50a8498db27a545461ccd13cd3d6a6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi RunningHub báo `SUCCESS`, `DefaultResultIngestor` luôn `failed`/`OUTPUT_UPLOAD_ERROR`: chưa lưu ảnh về R2, chưa kiểm tra, chưa CAPTURED và chưa có endpoint trả kết quả cho chủ Task.

**Approach:** Thay bằng `ResultIngestor` thật (AD-7) trong module `tasks`: tải `fileUrl` về R2 `out/<userId>/<uuid>`, kiểm tra ảnh, ghi EXIF, rồi `running→succeeded` qua `tasks.transition` (tự CAPTURED). Thêm `GET /tasks/{id}/result` trả URL ký ngắn hạn.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`; không sửa `packages/contracts` (đã có `TaskResultResponseSchema`), không sửa `wallet.service.ts`, không migration mới. Mọi đổi trạng thái qua `TasksService.transition`; ingestor tự chuyển trạng thái (worker đã có guard).
- Tải về: chỉ giao thức `http(s)`, mỗi lần tối đa 20 MB và timeout 30 giây; tối đa 3 lần cho cả tải lẫn `putObject`, nghỉ `RH_OUTPUT_RETRY_MS` (mặc định 1000) giữa các lần; không bắt đầu lần mới khi quá `deadline_at` hoặc `signal` đã hủy. Hết lượt → `failed`/`OUTPUT_UPLOAD_ERROR`. Lỗi kiểm tra không thử lại.
- Kiểm tra bằng `sharp`: giải mã được; không rỗng; không toàn đen (mọi kênh màu có `max ≤ 8`); kích thước (sau xoay EXIF) bằng ảnh tham chiếu của pipeline. Sai → `failed`/`OUTPUT_INVALID`. Cấu hình pipeline thêm `referenceInputKey` (Face Swap: `targetKey`); ảnh tham chiếu đọc từ `input_keys` qua `StoragePort`.
- Chốt: mã hóa lại cùng định dạng (PNG không mất dữ liệu; JPEG/WebP chất lượng 95) với EXIF `Software: AI Generator` và `Comment: AI-Generated Content` (UserComment), `putObject` với đúng `Content-Type`, rồi `transition(running→succeeded, { resultKey, gpuCoins })`. CAS không áp dụng (Task đã bị bộ quét xử lý) → xóa đối tượng `out/` vừa ghi, không đổi trạng thái.
- `consumeMoney` (làm tròn, kẹp 0..2147483647) lưu vào `gpu_coins` ở mọi kết thúc do ingestor (`succeeded`, `OUTPUT_*`); nhánh `FAILED` của worker giữ nguyên.
- `StoragePort` thêm `presignGet(key, expiresInSeconds)`; `S3StorageAdapter` hiện thực. `GET /tasks/{id}/result` (JWT): người khác chủ → `FORBIDDEN`; Task chưa `succeeded` → `CONFLICT`, không URL; `resultUrl` ký 10 phút tới `result_key`; `sourceUrl` ký tới ảnh tham chiếu `in/` nếu `head` còn thấy, ngược lại `null`. Không bao giờ trả `fileUrl` của RunningHub.
- `configure-bucket.ts` thêm lifecycle `out/` 30 ngày.

**Never:** HTTP RunningHub thật; chia sẻ bằng token (2.9); sửa bộ quét/deadline (2.7); resize ảnh kết quả.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thành công | `SUCCESS`, ảnh hợp lệ bằng cỡ ảnh đích | `out/` có EXIF; `succeeded`, 1 CAPTURED, `gpu_coins` lưu | N/A |
| Tải lỗi 3 lần | fetch/put ném lỗi | `failed`/`OUTPUT_UPLOAD_ERROR`, RELEASED, `gpu_coins` lưu | không còn đối tượng `out/` |
| Ảnh hỏng/đen/lệch cỡ/rỗng | byte không giải mã được, toàn đen, khác cỡ | `failed`/`OUTPUT_INVALID`, RELEASED, không ghi `out/` | không thử lại |
| Quá deadline giữa các lần thử | `deadline_at` đã qua | dừng thử, `OUTPUT_UPLOAD_ERROR` | RELEASED |
| `GET result` | chủ, `succeeded` / `sourceUrl` quá 7 ngày | hai URL ký / `sourceUrl: null` | N/A |
| `GET result` sai quyền/trạng thái | người khác / chưa `succeeded` | `FORBIDDEN` / `CONFLICT` | không URL |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/default-result-ingestor.ts` -- bản mặc định luôn lỗi; thay bằng `result-ingestor.ts`, xóa file cũ.
- `apps/api/src/modules/tasks/task-worker.service.ts` (~L295-315) -- gọi `ingestor.ingest(task, fileUrl, consumeMoney, signal)`; guard chuyển trạng thái giữ nguyên.
- `apps/api/src/modules/tasks/tasks.module.ts`, `tasks.service.ts`, `tasks.controller.ts` -- đăng ký provider; thêm `getResult` và route `GET :id/result`; tham chiếu `getWorkerRow`, `transition`.
- `apps/api/src/modules/pipelines/pipeline-config.ts` -- thêm `referenceInputKey`.
- `apps/api/src/ports/index.ts`, `modules/storage/s3-storage.adapter.ts` -- thêm `presignGet`; `uploads.service.ts` là mẫu dùng `sharp` và xoay EXIF.
- `apps/api/src/scripts/configure-bucket.ts` -- lifecycle.
- `apps/api/test/task-worker.test.mjs` (test "ingestor mặc định thật"), `s3-storage-adapter.test.mjs`, `helpers/task-fixture.mjs` -- cập nhật/mẫu test.

## Tasks & Acceptance

**Execution:**
- [x] `ports/index.ts`, `s3-storage.adapter.ts` -- thêm `presignGet`; test adapter
- [x] `pipeline-config.ts` -- `referenceInputKey`
- [x] `tasks/result-ingestor.ts`, `tasks.module.ts` -- ingestor thật thay mặc định
- [x] `tasks.service.ts`, `tasks.controller.ts` -- `GET /tasks/:id/result`
- [x] `configure-bucket.ts` -- lifecycle `out/` 30 ngày
- [x] `test/task-result.test.mjs`, `test/task-worker.test.mjs` -- phủ toàn bộ I/O Matrix (PostgreSQL/sharp thật, `fetch`/storage giả); đột biến guard phải làm test fail

**Acceptance Criteria:**
- Given `SUCCESS` hợp lệ, when worker xử lý, then `result_key` dạng `out/<userId>/<uuid>`, EXIF đọc lại đúng hai chuỗi, ledger có đúng một CAPTURED và không RELEASED.
- Given mọi lỗi sau `SUCCESS`, when kết thúc, then đúng một RELEASED, không CAPTURED.

## Implementation Notes

- Triển khai `ResultIngestorService` hiện thực `ResultIngestor` port, thay thế `DefaultResultIngestor`.
- `StoragePort.presignGet` và `S3StorageAdapter.presignGet` tạo presigned GET URL thời hạn 10 phút.
- Thêm route `GET /tasks/:id/result` vào `TasksController` và `TasksService.getResult`: kiểm tra quyền chủ sở hữu, trả `resultUrl` và `sourceUrl` (nếu ảnh gốc còn trong vòng 7 ngày).
- Bổ sung cấu hình `referenceInputKey: 'targetKey'` cho pipeline `face_swap`.
- Thêm quy tắc vòng đời `expire-out-30d` trong `configure-bucket.ts`.
- Bổ sung bộ test `test/task-result.test.mjs` với 35 kịch bản kiểm thử bao phủ toàn bộ ma trận I/O và ca biên.
- Sau review: khắc phục ca orientation ngoại chuẩn (`orientation >= 5 && orientation <= 8`), dời kiểm tra format/kích thước lên trước `stats()`, đảm bảo `gpuCoins` được lưu khi `ingest` ném lỗi trong `task-worker`, và bổ sung test kiểm tra định dạng GIF và ngoại lệ của `storage.head`.

## Review Triage Log

| Finding | Verdict | Evidence / Disposition |
|---------|---------|-------------------------|
| Regex assertion cho lifecycle trong configure-bucket.ts | low | defer: Script cấu hình chạy thủ công; testing với bucket R2 thật được theo dõi trong deferred-work.md. |
| Thiếu test từ chối ảnh hợp lệ định dạng không hỗ trợ (GIF) | low | patch: Đã thêm test case trong task-result.test.mjs xác nhận ném OUTPUT_INVALID. |
| Thiếu test xử lý ngoại lệ storage.head trong getResult | low | patch: Đã thêm test case trong task-result.test.mjs xác nhận trả 200 kèm sourceUrl null. |
| displaySize xử lý orientation >= 9 như xoay | low | patch: Đã sửa điều kiện thành `meta.orientation >= 5 && meta.orientation <= 8`. |
| Gọi stats() giải mã pixel trước khi kiểm tra format/kích thước | low | patch: Đã dời metadata(), format và size check lên trước stats(). |
| Tạo lại instance sharp(bytes) 3 lần | false | refutation: Sharp instance là lightweight wrapper trên libvips streaming, không chiếm dụng bộ nhớ thừa khi gọi tuần tự. |
| withRetry thử lại khi download > 20MB | low | reject: spec quy định chung retry tối đa 3 lần cho tải về; lỗi kích thước lớn từ CDN không đổi giữa các lần nhưng hiếm gặp. |
| OUTPUT_FETCH_TIMEOUT_MS = 30s xung đột AD-6 (timeout <= 10s) | false | refutation: Spec Story 2.6 mục Boundaries & Constraints quy định rõ timeout 30s cho file 20MB; quy tắc review từ chối finding yêu cầu sửa spec. |
| Thiếu SSRF và chặn redirect cho fileUrl RunningHub | medium | defer: Đã ghi nhận vào deferred-work.md theo kế hoạch lập spec. |
| Lỗi đọc ảnh tham chiếu từ R2 phân loại thành OUTPUT_UPLOAD_ERROR | false | refutation: Lỗi R2 khi đọc input là lỗi hệ thống/lưu trữ nên phân loại OUTPUT_UPLOAD_ERROR là đúng thiết kế. |
| GET result không kiểm tra đối tượng tồn tại trên R2 | false | refutation: AC quy định resultUrl luôn trả URL ký tới resultKey; chỉ sourceUrl kiểm tra thời hạn 7 ngày. |
| CORS configure-bucket.ts thiếu Range/If-None-Match | low | defer: Cấu hình CORS chung cho bucket R2 đã ghi nhận vào deferred-work.md. |
| Mất gpuCoins khi ingest ném lỗi trong task-worker | low | patch: Đã tính gpuCoins trước và truyền vào this.finish trong fallback của out.status === SUCCESS. |
| Thiếu trần kích thước khi pipeline không có referenceInputKey | false | refutation: Story 2.6 chỉ làm pipeline Face Swap có referenceInputKey. |
| presignGet thiếu ResponseContentDisposition | false | refutation: Hợp đồng và AC không yêu cầu query param này. |

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua compose)
- `pnpm run check:boundaries` -- expected: pass

