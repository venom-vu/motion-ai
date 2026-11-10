---
title: 'Story 5.4: [BE] Cắt video bằng ffmpeg ở bước chuẩn bị của worker'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '4a0045553d4104e04fdefd5604c5666329f12e7c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Task `motion_control` đã tạo được (5.3) nhưng worker chưa có bước chuẩn bị: chưa cắt đúng đoạn `trimStart`/`seconds` của video, chưa giới hạn một ffmpeg mỗi lúc, nên VPS 4 vCPU có thể nghẽn và video gửi đi không đúng đoạn người dùng trả tiền.

**Approach:** Thêm bước `prepare` có ngữ cảnh Task vào `PipelineConfig` (chạy trước cổng RunningHub), cài bước của `motion_control` bằng một dịch vụ cắt ffmpeg: lấy khóa FIFO, tải video `in/` về thư mục tạm riêng, cắt bằng ffmpeg, kiểm lại bằng `ffprobe`, đọc file cắt trả về cho các bước sau, rồi luôn xóa thư mục tạm.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` và `deploy/**` (nhánh `be/*`); pipeline tên `motion_control`; không thêm `ApiErrorCode`/`ReasonCode`; mọi chuyển trạng thái qua `tasks.transition` (`finish` của worker), RELEASED 100% khi `failed`/`timed_out`.
- **Quyết định:** giữ nhánh chặn tạm của 5.3 ở đầu `runFromUpload` (Task `motion_control` thật vẫn `failed`/`INTERNAL_ERROR`, không chạy ffmpeg) cho tới Story 5.5; dịch vụ cắt và `prepare` của `motion_control` được kiểm bằng cách gọi trực tiếp trong test, không đi qua đường worker cho Task thật; Story 5.5 gỡ nhánh chặn.
- `prepare` đổi chữ ký thành nhận ngữ cảnh `{ row, storage, signal }` và tự lấy input (hiện `loadInputs` gọi `getObject` rồi mới `prepare` trên `Buffer`); pipeline không khai báo `prepare` giữ nguyên đường cũ nên Face Swap/Body Retouch không đổi hành vi. Cập nhật test "prepare được áp dụng trước upload" cho chữ ký mới.
- Khóa ffmpeg là một mutex FIFO trong tiến trình worker; chờ khóa, tải và cắt cùng nằm trong `prep_deadline_at` (120 giây từ lúc `running`); quá hạn → `timed_out`/`PREP_TIMEOUT`. `AbortSignal` (hủy, quá hạn, tắt worker) kết thúc tiến trình ffmpeg ngay.
- Thứ tự: lấy khóa → kiểm đĩa trống → tải video từ R2 vào thư mục tạm riêng của Task → cắt. Tải lỗi sau 3 lần thử → `INPUT_FETCH_ERROR`. Đĩa trống < 3 × kích thước file đầu vào (lấy qua `storage.head`) → `INTERNAL_ERROR`.
- ffmpeg gọi qua `execFile` (không shell), mảng đối số cố định, `nice` thấp: `-ss {trimStart}` và `-t {seconds}` (lấy từ `tasks.params`, không tin client), re-encode `libx264` preset `veryfast`, 24 FPS, bỏ âm thanh (`-an`), giữ tự xoay theo metadata (video quay dọc ra đúng chiều), không đổi độ phân giải. Không ghép khóa hay tên file người dùng vào đối số; tên file tạm do server sinh.
- Sau khi cắt, `ffprobe` file cục bộ: đúng một luồng video, 24 FPS, độ dài = `seconds` ± 0,5 giây; sai → `FFMPEG_ERROR`. ffmpeg thoát lỗi → `FFMPEG_ERROR`.
- Thư mục tạm xóa khi xong, khi lỗi và khi hủy; worker xóa mọi thư mục tạm còn sót khi khởi động.
- Kết quả `prepare` trả `Record<string, Buffer>` (video đã cắt + ảnh nhân vật) cho các bước sau; mapping node RunningHub vẫn để Story 5.5. Tài liệu ghi việc đo CPU và đĩa thật trên VPS thuộc bước kiểm thử ffmpeg của Epic 6.

**Never:**
- Không gửi gì lên RunningHub, không điền `inputs` của `motion_control` (5.5); không đổi `StoragePort`; không đổi hợp đồng `packages/contracts`; không gỡ nhánh chặn tạm của 5.3 (thuộc 5.5)uyết định; không sửa `.github/workflows/ci.yml` (nằm ngoài nhánh `be/*`, và bước CI kiểm `ffprobe`/`libx264` của 5.2 đã chạy trên cùng image `deploy/Dockerfile` mà `nestjs-worker` dùng).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cắt hợp lệ | video 12 s, `trimStart:2`, `seconds:5` | File 24 FPS, 1 luồng video, không âm thanh, 5 ± 0,5 s | N/A |
| Quay dọc có xoay | MOV 720×1280 metadata xoay | File ra đã xoay đúng chiều | N/A |
| Hai Task đồng thời | 2 Lane cùng `prepare` | Khoảng chạy ffmpeg không chồng nhau, FIFO | N/A |
| Sai lệch độ dài | ffmpeg ra 6,2 s thay vì 5 | Task `failed` | `FFMPEG_ERROR`, RELEASED |
| ffmpeg thoát lỗi | file hỏng/ffmpeg exit ≠ 0 | Task `failed` | `FFMPEG_ERROR`, RELEASED |
| Tải R2 lỗi | `getObject` lỗi 3 lần | Task `failed` | `INPUT_FETCH_ERROR`, RELEASED |
| Quá hạn chuẩn bị | chờ khóa + cắt > `prep_deadline_at` | Task `timed_out`, ffmpeg bị kill, thư mục tạm xóa | `PREP_TIMEOUT`, RELEASED |
| Hủy khi đang cắt | `AbortSignal` | ffmpeg bị kill, thư mục tạm xóa | Không đổi trạng thái do bước này |
| Thiếu đĩa | trống < 3 × kích thước | Task `failed`, không tải | `INTERNAL_ERROR`, RELEASED |
| Dọn khi khởi động | thư mục tạm sót lại | Bị xóa khi worker khởi động | N/A |
| Pipeline khác | Face Swap, Body Retouch | Không chạy `prepare`, kết quả y như cũ | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/task-worker.service.ts` -- `runFromUpload` (nhánh chặn tạm `motion_control` ở đầu, `loadInputs` gọi `getObject` rồi `config.prepare(out)`, nhánh `INPUT_FETCH_ERROR`), `finish`, `Mutex` FIFO sẵn có làm mẫu khóa, `TaskRow` đã có `params`, `inputKeys`, `prepDeadlineAt`. Chỗ gắn bước `prepare` có ngữ cảnh, tính `AbortSignal.timeout(prepDeadlineAt − now)` → `PREP_TIMEOUT`, và `onModuleInit` dọn thư mục tạm khi `MOTION_PROCESS_ROLE === 'worker'`.
- `apps/api/src/modules/pipelines/pipeline-config.ts` -- `PipelineConfig.prepare` (kiểu cũ nhận `Record<string, Buffer>`); đổi chữ ký, gắn `prepare` cho `motion_control`; `inputs: []` vẫn để 5.5.
- `apps/api/src/modules/tasks/video-trim.service.ts` (mới) -- khóa FIFO, kiểm đĩa (`fs.promises.statfs`), tải vào thư mục tạm riêng, `execFile` ffmpeg với `nice`, hàm đánh giá `ffprobe` cục bộ (một luồng video, 24 FPS, độ dài ± 0,5 s); tách `buildFfmpegArgs` và hàm đánh giá thuần để test.
- `apps/api/src/modules/storage/video-probe.service.ts` -- `buildFfprobeArgs` dùng `-protocol_whitelist https,tls,tcp` cho URL ký nên không đọc được file cục bộ, và `evaluateProbe` không trả FPS/số luồng; không sửa hành vi 5.2, thêm hàm riêng cho file cục bộ trong dịch vụ mới.
- `apps/api/src/ports/index.ts` -- `StoragePort.getObject`/`head` đã đủ (trả `Buffer`; ghi ra file tạm). Không đổi.
- `apps/api/src/modules/tasks/task-sweeper.service.ts` -- đã `expire(..., 'PREP_TIMEOUT')`; chỉ kiểm không xung đột với hạn của `prepare`.
- `apps/api/test/task-worker.test.mjs` -- test "prepare được áp dụng trước upload" (dòng ~438) dùng chữ ký cũ, cập nhật.
- `deploy/Dockerfile`, `deploy/compose.yml` -- runtime đã cài `ffmpeg`; `nestjs-worker` dùng cùng Dockerfile; chỉ thêm ghi chú tài liệu, không đổi.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/tasks/video-trim.service.ts` -- khóa FIFO, kiểm đĩa, tải, ffmpeg, kiểm lại bằng ffprobe cục bộ, dọn thư mục tạm -- logic chính
- [x] `apps/api/src/modules/pipelines/pipeline-config.ts`, `apps/api/src/modules/tasks/task-worker.service.ts`, `tasks.module.ts` -- chữ ký `prepare` mới, gắn cho `motion_control`, `PREP_TIMEOUT`, dọn khi khởi động -- nối vào worker
- [x] `apps/api/test/task-worker.test.mjs` -- cập nhật test `prepare` -- tương thích chữ ký mới
- [x] `apps/api/test/video-trim.test.mjs` và video mẫu nhỏ trong `apps/api/test/fixtures/` -- test I/O Matrix với ffmpeg thật cục bộ -- phủ ranh giới
- [x] `deploy/README.md` hoặc ghi chú trong tài liệu hiện có -- đo CPU/đĩa thật thuộc Epic 6 -- AC tài liệu

**Acceptance Criteria:**
- Given hai Task `motion_control` cùng chuẩn bị, when chạy đồng thời, then hai ffmpeg không bao giờ chồng khoảng thời gian chạy.
- Given Face Swap hoặc Body Retouch, when worker xử lý, then không có bước `prepare` và test cũ của hai pipeline vẫn pass.
- Given `pnpm run lint && pnpm run typecheck && pnpm run build`, when chạy, then pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Video có chiều rộng/cao lẻ làm libx264 yuv420p thất bại thành `FFMPEG_ERROR` | medium | patch | Đã chạy 321x181: "Nothing written into output file"; thêm `scale=trunc(iw/2)*2:trunc(ih/2)*2` |
| Kiểm FPS bỏ lọt `r_frame_rate` `0/0` (NaN) | medium | patch | Đã chạy `evaluateTrimmedProbe` trả true; đã trả false khi không hữu hạn |
| `cleanupStale` không `await` nên chạy đua với job đầu của Worker | medium | patch | Đọc `onModuleInit`; đã `await` trước khi tạo Worker |
| Lỗi đĩa cục bộ (mkdir/mkdtemp/writeFile/readFile) bị gán nhầm `INPUT_FETCH_ERROR` | medium | patch | Đọc `trim()`; đã bọc bằng `fsOp` thành `INTERNAL_ERROR`, kèm test |
| Nhánh `PrepareError` và hạn `PREP_TIMEOUT` ở worker không có test | medium | patch | Đã thêm hai test worker |
| Test quay dọc không khẳng định hướng đầu ra | low | patch | Hành vi đã đúng (320x180 gắn xoay 90 ra 180x320); test nay tự sinh video xoay và khẳng định |
| `prepDeadlineAt` null thì không có hạn trong tiến trình | false | - | Cột này luôn được đặt khi chuyển `running` (`tasks.service.ts` 117); bộ quét xử lý hạn quá |
| Hạ tầng tạm thời (thiếu đĩa) làm Task fail vĩnh viễn thay vì thử lại | low | reject | AC: thiếu chỗ trống thì `failed`/`INTERNAL_ERROR` và RELEASED |
| `fetchWithRetry` không backoff; tải nhân vật sau khi cắt; dùng RAM cho cả file | low | defer | Giới hạn 100 MB, 2 Lane; tối ưu khi đo tải thật ở Epic 6 |
| `video-trim` singleton import vòng giữa `pipelines/` và `tasks/` | low | defer | Cần DI khi 5.5 đổi cấu trúc `prepare`; không gây lỗi hiện tại |
| Hạ tầng triển khai: worker thiếu `nice`/`ffmpeg`, `TMPDIR` nhỏ | low | reject | Worker dùng chung `deploy/Dockerfile` đã có ffmpeg (5.2) và bước CI kiểm |
| Nhiều worker dùng chung `TMPDIR` có thể xóa thư mục của nhau khi khởi động | low | defer | Triển khai hiện tại một worker; thêm thư mục theo tiến trình khi nhân bản |
| Test kill ffmpeg khi đang chạy, giới hạn tolerance 0,5 giây hai chiều | low | reject | Sửa chỉ là thêm test/độ nghiêm ngặt; AC cho ±0,5 giây |

## Design Notes

`getObject` trả cả `Buffer` (tối đa 100 MB) nên ghi ra file tạm là đủ; không thêm tải luồng vào `StoragePort` để khỏi đổi cổng và mọi bản giả trong test. Đĩa trống đo bằng `statfs` trên thư mục gốc tạm, và kích thước đầu vào lấy bằng `storage.head` trước khi tải.

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass (cần `ffmpeg` và `ffprobe` trên máy chạy test)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
