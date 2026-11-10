---
title: 'Story 5.6: [BE] Nhập kết quả video, ảnh bìa và chia sẻ'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'bcab97ad49b35bfdab9f0c2112e1ec77e763ab53'
route: 'dispatch'
review_loop_iteration: 0
context:
- '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi RunningHub báo `SUCCESS` cho Task `motion_control`, ingestor hiện tại chỉ xử lý ảnh (sharp, trần 20 MB) nên Task thất bại `OUTPUT_UPLOAD_ERROR`; `GET /tasks/{id}/result` và `/s/<token>` cũng chưa biết video và ảnh bìa.

**Approach:** Thêm nhánh video cho `ResultIngestorService`: tải về thư mục tạm, kiểm tra bằng ffprobe dưới khóa ffmpeg, remux gắn thẻ metadata, trích ảnh bìa, lưu `out/<userId>/<uuid>.mp4` và `.jpg`, rồi `running→succeeded` qua `tasks.transition`. Mở rộng `getResult` và chia sẻ công khai cho video, suy ra mọi thông tin từ `resultKey` và `params.seconds`, không thêm cột và không migration.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`; không thêm `ApiErrorCode`/`ReasonCode`; mọi chuyển trạng thái qua `tasks.transition`, RELEASED 100% khi `failed`; thư mục tạm xóa trong mọi trường hợp.
- **Quyết định:** `resultKey` video là `out/<userId>/<uuid>.mp4`; ảnh bìa là cùng khóa đổi đuôi `.jpg`. `transition` chấp nhận thêm đuôi `.mp4` tùy chọn (ảnh giữ nguyên dạng cũ). `mediaType` = video khi khóa kết thúc `.mp4`; `durationSeconds` = `params.seconds` do server ghi lúc tạo Task.
- **Quyết định:** nhánh video chọn theo `row.pipeline === 'motion_control'`; trần tải video 100 MB (ảnh giữ 20 MB). Tải theo luồng ra file, không đọc cả video vào bộ nhớ.
- Kiểm tra video: một luồng video H.264, 24 FPS, cạnh ngắn 720 px (cho phép cả dọc và ngang), độ dài = `seconds` ± 0,5 giây; dùng ffprobe/ffmpeg bằng mảng đối số, chạy dưới khóa ffmpeg của `videoTrim`, không ghép dữ liệu người dùng vào lệnh.
- Gắn nhãn bằng remux `-c copy` với `comment=AI-Generated Content`, `software=AI Generator` `[ASSUMPTION: thẻ MP4 thay cho EXIF]`; ảnh bìa là khung hình đầu dạng JPEG.
- Retry tải tối đa 3 lần trong `deadline_at` (dùng lại `withRetry`).
- Chia sẻ: `/s/<token>`, `/info`, `/poster` đều qua `ShareThrottlerGuard`; mọi lỗi (token sai, thu hồi, file mất) là 404 chung, không lộ Task.

**Never:** Sửa đường ảnh của Face Swap/Body Retouch ngoài việc rẽ nhánh theo pipeline; sửa `packages/contracts`; gọi RunningHub hay mạng thật trong test; lưu video không qua `tasks.transition`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thành công | MP4 H.264 24 FPS, 720×1280, dài 5,2 s, `seconds=5` | `succeeded`, CAPTURED đúng số đã HOLD (lệch 0,2 s không đổi tiền), lưu `.mp4` + `.jpg`, `gpu_coins`, thẻ metadata có | N/A |
| Lệch quá 0,5 s | Dài 6,2 s, `seconds=5` | `failed`/`OUTPUT_INVALID`, RELEASED | Không lưu R2 |
| File rỗng/hỏng | 0 byte hoặc không giải mã | `failed`/`OUTPUT_INVALID`, RELEASED | N/A |
| Sai thông số | Không phải H.264, FPS ≠ 24, cạnh ngắn ≠ 720, hơn 1 luồng video | `failed`/`OUTPUT_INVALID`, RELEASED | N/A |
| Tải lỗi | 3 lần lỗi hoặc quá `deadline_at` | `failed`/`OUTPUT_UPLOAD_ERROR`, RELEASED | N/A |
| Remux/ảnh bìa lỗi | ffmpeg thoát ≠ 0 | `failed`/`FFMPEG_ERROR`, RELEASED | Xóa khóa R2 đã ghi |
| Ghi R2 lỗi | `putObject` lỗi | `failed`/`OUTPUT_UPLOAD_ERROR`, RELEASED | Xóa `.mp4`/`.jpg` đã ghi |
| Kết quả của chủ | `GET /tasks/{id}/result` Task motion `succeeded` | `mediaType=video`, `resultUrl`, `posterUrl` ký, `durationSeconds`, `sourceUrl` null | Người khác: NOT_FOUND |
| Chia sẻ | Token hợp lệ | `/s/<t>` 302 tới video; `/info` `{mediaType, durationSeconds}`; `/poster` 302 tới ảnh bìa | Token sai/thu hồi/file mất: 404 cả ba |
| Ảnh | Face Swap/Body Retouch | Kết quả y như cũ (không có `mediaType` ép buộc sai) | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/result-ingestor.ts` -- `ingest` rẽ nhánh video cho `motion_control`; dùng lại `withRetry`, `clampCoins`, `isPublicHttpUrl`, `safeDelete`; thêm tải ra file và `OUTPUT_MAX_BYTES` riêng cho video.
- `apps/api/src/modules/tasks/video-trim.service.ts` -- xuất `run`, `buildLocalFfprobeArgs`, `parseFps`; thêm hàm chạy việc dưới khóa `lock` của `videoTrim` (khóa đang private).
- `apps/api/src/modules/tasks/tasks.service.ts` -- regex `resultKey` trong `transition` (dòng ~104) chấp nhận `.mp4`; `getResult` (dòng ~338) trả video + poster + `durationSeconds`.
- `apps/api/src/modules/storage/share.service.ts`, `share.controller.ts` -- thêm `info` và `poster`; `resolve` dựng theo loại khóa.
- `packages/contracts/src/tasks.ts` -- `TaskResultResponseSchema`, `ShareInfoResponseSchema` đã có sẵn; chỉ đọc, không sửa.
- `apps/api/test/motion-control.test.mjs`, `apps/api/test/result-ingestor*.test.mjs`, test chia sẻ hiện có -- mẫu giả `worker.storage`, `ingestor.fetchFn`; video mẫu tạo bằng ffmpeg như `video-trim.test.mjs`.
- Giữ nguyên: đường ảnh trong `validateAndEncode`, `mapRunningHubFailure`, ví và sổ cái.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/tasks/video-trim.service.ts` -- xuất tiện ích ffmpeg/ffprobe và hàm chạy dưới khóa -- dùng chung một khóa
- [x] `apps/api/src/modules/tasks/result-ingestor.ts` -- nhánh video: tải ra file, ffprobe, remux gắn thẻ, ảnh bìa, ghi R2, chốt -- AC 5.6
- [x] `apps/api/src/modules/tasks/tasks.service.ts` -- regex `resultKey` nhận `.mp4`; `getResult` cho video -- kết quả cho chủ Task
- [x] `apps/api/src/modules/storage/share.service.ts`, `share.controller.ts` -- `/info`, `/poster`, video cho `/s/<t>` -- chia sẻ công khai
- [x] `apps/api/test/*` -- test cho mọi dòng ma trận (video mẫu tạo bằng ffmpeg) -- bảo vệ hành vi

**Acceptance Criteria:**
- Given Task motion `SUCCESS` với video hợp lệ, when ingest, then `succeeded` kèm CAPTURED đúng số HOLD và `out/<userId>/<uuid>.mp4` có `Content-Type: video/mp4` cạnh `.jpg`.
- Given mọi kết thúc (thành công hay lỗi), when ingest xong, then thư mục tạm không còn.
- Given `pnpm run lint && pnpm run typecheck && pnpm test`, then xanh (trừ suite đã ghi nhận không ổn định từ trước).

## Implementation Notes

- Remux cần `-movflags +faststart+use_metadata_tags`; thiếu cờ này muxer MP4 bỏ thẻ `software` và chỉ giữ `comment` (`[ASSUMPTION]` thẻ MP4 thay cho EXIF đã xác nhận bằng ffprobe).
- `VideoTrimService.runExclusive` cho ingest dùng chung khóa ffmpeg với bước cắt; thư mục tạm ingest nằm dưới `videoTrim.tmpRoot`.
- Test chia sẻ của Body Retouch (`body-retouch-result.test.mjs`, 429) và `reconcile-script` fail sẵn ở baseline: không do story này.

## Spec Change Log

## Review Triage Log

| Phát hiện | Verdict | Bằng chứng / xử lý |
|---|---|---|
| Timeout tải cố định 300 s, một lần thử có thể vượt `deadline_at` | medium | patch: timeout mỗi lần thử = min(300 s, thời gian còn lại tới `deadline_at`) |
| Thư mục tạm ingest nằm ngoài `videoTrim.tmpRoot`, `cleanupStale` không dọn khi worker bị SIGKILL | medium | patch: ingest dùng `<tmpRoot>/ingest`; test cập nhật đường dẫn |
| Không test đường mất compare-and-set ở bước chốt | medium | patch: thêm test chuyển Task khỏi `running` giữa ghi R2 và chốt; khẳng định không còn khóa `out/`, không CAPTURED |
| Guard `params.seconds` không có test | low | patch: thêm test `params='{}'` => `failed`/`INTERNAL_ERROR`, RELEASED, không tải |
| `readFile` đưa cả video (tối đa 100 MB) vào bộ nhớ trước `putObject` | medium | defer: `StoragePort.putObject` chỉ nhận `Buffer`; sửa cần đổi cổng chung |
| Kiểm SSRF theo tên host, không phân giải DNS | medium | defer: logic sẵn có của đường ảnh, story này chỉ dùng lại |
| Khóa kết quả bị bỏ rơi nếu worker chết giữa `putObject` và `transition` | medium | defer: cần bộ quét khóa mồ côi, ngoài phạm vi |
| `-map 0:v:0` bỏ âm thanh | low | reject: đầu ra Motion do workflow tạo không có âm thanh theo spec; không có yêu cầu giữ âm |
| Kiểm tra thêm rotation, VFR, pix_fmt | low | reject: spec chỉ yêu cầu H.264, 24 FPS, cạnh ngắn 720, độ dài; thêm guard là mở rộng yêu cầu |
| Thẻ metadata chưa được ffprobe đọc lại | false | test `motion-result.test.mjs` đọc lại bằng ffprobe và khẳng định `software` và `comment` |
| `getResult`/`/info` ném lỗi khi `params.seconds` sai | low | reject: trạng thái do chính server ghi lúc tạo Task; không có đường dẫn đến |
| `/info`, `/poster` thêm lần `head` lên R2 | low | reject: được `ShareThrottlerGuard` giới hạn; chưa có số liệu cần cache |
| `getResult` ký URL ảnh bìa không kiểm `head` | low | reject: ảnh bìa luôn được ghi cùng video trước khi chốt |
| `nice` giả định có trên worker; `PATH` bị đổi trong test | low | reject: image worker dùng chung `deploy/Dockerfile` đã có (đã dùng ở 5.4); test khôi phục `PATH` trong `finally` |
| Spec ghi "file mất: 404 cả ba" nhưng thiếu ảnh bìa vẫn 302 ở `/s/<t>` | low | reject: video vẫn còn nên 302 là đúng; `/poster` mới trả 404 |

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: thành công
- `pnpm test` -- expected: xanh cho các suite Motion, ingestor, chia sẻ; `reconcile-script` và `signup-grant` đã không ổn định sẵn
