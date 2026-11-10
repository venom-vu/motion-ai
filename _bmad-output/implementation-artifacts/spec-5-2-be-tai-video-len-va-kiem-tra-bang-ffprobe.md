---
title: 'Story 5.2: [BE] Tải video lên và kiểm tra bằng ffprobe'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '1ab79fd88e6236f12e0c1beca52597850fabadf6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `POST /uploads` và `confirm` của `apps/api` chỉ biết ảnh (`kind: 'image'`, giải mã bằng `sharp`), nên người dùng chưa thể tải video mẫu cho Motion Control và server chưa có số liệu video đo thật (độ dài, kích thước) để Story 5.3 tính giá.

**Approach:** Mở rộng `UploadsService` cho video: ký presigned PUT, khi `confirm` thì HEAD, `ffprobe` qua URL ký GET ngắn hạn (tối đa 2 tiến trình đồng thời), kiểm container/luồng video/độ dài, lưu `duration_seconds`/`width`/`height` vào `uploads`, rồi `CopyObject` sang `in/` kèm ETag. Thêm `ffprobe` vào image `nestjs-api`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`, `deploy/**` và `.github/workflows/ci.yml` (nhánh `shared/story-5-2-upload-video-ffprobe`, đổi từ `be/*` vì phải sửa `ci.yml`). **Quyết định:** CI build image `nestjs-api` và chạy `ffprobe -version` cùng `ffmpeg -encoders` ngay trong story này; dùng hợp đồng 5.1 (`UploadCreateRequestSchema`, `UploadConfirmVideoResponseSchema`, `VALIDATION_REASONS`); không thêm `ApiErrorCode`/`ReasonCode`.
- `POST /uploads` video: `video/mp4`|`video/quicktime`, ≤ 100 MB, khóa `in-raw/<userId>/<uuid>`, presigned PUT ký `Content-Length`; tính vào giới hạn 10 file chưa xác nhận chung với ảnh (thông báo hết hạn mức không được nói riêng "ảnh").
- `confirm` video: kiểm khóa đúng chủ (người khác bị từ chối), HEAD khớp kích thước khai báo, rồi `ffprobe` đọc qua `presignGet` ngắn hạn, timeout 10 giây, gọi bằng mảng đối số cố định (không qua shell) kèm `-protocol_whitelist https,tls,tcp`, không ghép khóa hay tên file người dùng vào đối số.
- Hợp lệ khi `format_name` chứa `mov` hoặc `mp4`, có ít nhất một luồng video, độ dài hữu hạn ≥ 3; trả `durationSeconds` làm tròn xuống, `width`, `height`; lưu cả ba vào bản ghi `uploads` (kind `video`) để 5.3 dùng thay giá trị client.
- Lỗi `VALIDATION_FAILED` kèm `details.reason`: Matroska/WebM đổi đuôi, chỉ có âm thanh, file cụt, `ffprobe` quá 10 giây → `VIDEO_UNREADABLE`; dưới 3 giây → `VIDEO_TOO_SHORT`; đối tượng `in-raw/` bị xóa và bản ghi chuyển `expired`.
- Đạt thì `copyIfMatch` sang `in/<userId>/<uuid>` với ETag, ETag đổi thì từ chối (`CONFLICT`); lifecycle `in/` 7 ngày giữ nguyên.
- Tối đa 2 `ffprobe` chạy cùng lúc trong tiến trình `api`, yêu cầu còn lại chờ lượt; route `confirm` chịu `@nestjs/throttler`.
- Image Docker `nestjs-api` có `ffprobe` chạy được, và CI kiểm tra điều đó cùng `ffmpeg -encoders` trong một bước kiểm tra image. Test dùng video mẫu nhỏ trong repo và `StoragePort` giả.

**Never:**
- Không sửa `packages/contracts`, `apps/web`; không đổi hành vi ảnh; không dùng `shell: true`/`exec`; không tin `durationSeconds`/kích thước do client gửi; không tạo Task Motion (5.3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo hợp lệ | `video/mp4`, 50 MB | 201, khóa `in-raw/…`, PUT ký `Content-Length` | N/A |
| MIME/size sai | `video/webm`; 100 MB + 1 | Không cấp URL | `VALIDATION_FAILED` |
| Quá hạn mức | đã 10 pending (ảnh + video) | Từ chối | `VALIDATION_FAILED` |
| MP4/MOV hợp lệ | file đạt, 7,6 s | 200 `{key:'in/…', video:{durationSeconds:7,width,height}}`, DB lưu 3 trường, đã copy | N/A |
| Quay dọc có metadata xoay | MOV xoay 90° | `width`/`height` theo chiều hiển thị sau xoay | N/A |
| Không đọc được | Matroska đổi đuôi, chỉ âm thanh, cụt, quá 10 s | 400, xóa `in-raw/` | `VIDEO_UNREADABLE` |
| Quá ngắn | 2,4 s | 400, xóa `in-raw/` | `VIDEO_TOO_SHORT` |
| Kích thước lệch | HEAD ≠ khai báo | 400, xóa | `VALIDATION_FAILED` |
| ETag đổi | đổi giữa HEAD và copy | Từ chối | `CONFLICT` |
| Khóa người khác | B dùng khóa của A | Từ chối | `FORBIDDEN` |
| Đồng thời | 5 confirm cùng lúc | Tối đa 2 `ffprobe` chạy | Còn lại chờ |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/storage/uploads.service.ts` -- `create` (hard-code `kind:'image'`, thông báo hạn mức nói "ảnh"), `confirm` (HEAD → `getObject` → `sharp` → resize → `copyIfMatch` → `updateMany pending→confirmed`), `rejectInvalid` (đánh dấu `expired`, xóa, ném `VALIDATION_FAILED`). Thêm nhánh video theo `upload.kind`/MIME, tái dùng `rejectInvalid` (thêm `details.reason`). `areConfirmedKeysOwnedBy` đang lọc `kind:'image'` — không đổi (5.3 xử lý).
- `apps/api/src/modules/storage/uploads.controller.ts` -- `confirm` trả kiểu union ảnh/video; thêm throttler cho route `confirm`.
- `apps/api/src/modules/auth/throttler.guard.ts` -- mẫu `TopupThrottlerGuard` (`getXThrottleOptions` đọc env, key riêng theo handler); thêm guard/tùy chọn riêng cho `confirm` upload.
- `apps/api/src/ports/index.ts` -- `StoragePort.presignGet`, `head`, `copyIfMatch`, `delete` đã đủ; không cần đổi.
- `apps/api/src/modules/storage/storage.module.ts` -- đăng ký dịch vụ `ffprobe` mới (tách spawn khỏi đánh giá kết quả để test được).
- `apps/api/prisma/schema.prisma` -- `Upload` đã có `width`, `height`, `durationSeconds`, `kind`; không cần migration.
- `deploy/Dockerfile` -- runtime `node:22-bookworm-slim` chưa có ffmpeg/ffprobe; cài `ffmpeg` (gồm `ffprobe`) ở stage `runtime`.
- `apps/api/test/uploads.test.mjs` -- `FakeStorage` đè lên prototype `S3StorageAdapter`, `bootstrapApi`, `newUser`, `post`; làm mẫu cho `uploads-video.test.mjs` mới. Video mẫu đặt ở `apps/api/test/fixtures/`.
- `.github/workflows/ci.yml` -- chưa có bước kiểm tra image; thêm bước build `deploy/Dockerfile` và chạy `ffprobe -version`, `ffmpeg -encoders` trong container.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/storage/video-probe.service.ts` -- spawn `ffprobe -v error -print_format json -show_format -show_streams` bằng mảng đối số + whitelist + timeout 10 s, hàng đợi tối đa 2, hàm thuần đánh giá JSON → `{durationSeconds,width,height}` hoặc lý do -- cô lập phần chạy tiến trình
- [x] `apps/api/src/modules/storage/uploads.service.ts` -- `create`/`confirm` cho video, `details.reason`, lưu 3 trường, thông báo hạn mức dùng chung -- logic chính
- [x] `apps/api/src/modules/storage/uploads.controller.ts`, `apps/api/src/modules/auth/throttler.guard.ts`, `storage.module.ts` -- kiểu trả về, throttler, đăng ký dịch vụ -- nối route
- [x] `deploy/Dockerfile`, `.github/workflows/ci.yml` -- cài `ffmpeg`/`ffprobe`, thêm bước CI kiểm image -- image `nestjs-api`
- [x] `apps/api/test/fixtures/*` và `apps/api/test/uploads-video.test.mjs` -- MP4/MOV hợp lệ, quay dọc xoay, Matroska đổi đuôi, chỉ âm thanh, cụt, ngắn, test timeout, đồng thời tối đa 2, khóa người khác, ETag đổi; test I/O Matrix -- phủ ranh giới

**Acceptance Criteria:**
- Given video đạt kiểm tra, when xác nhận, then bản ghi `uploads` có `duration_seconds`, `width`, `height` và khóa `in/` đã tạo.
- Given ảnh, when tải và xác nhận, then hành vi và thông báo cũ không đổi, `uploads.test.mjs` vẫn pass.
- Given `pnpm run lint && pnpm run typecheck && pnpm run build`, when chạy, then pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| File âm thanh có ảnh bìa (`attached_pic`) lọt qua như video | medium | patch | Đã chạy: m4a có ảnh bìa cho luồng `video` với `disposition.attached_pic=1`; `find(codec_type==='video')` sẽ nhận, trái AC "chỉ có âm thanh" |
| URL ký 60 giây được tạo trước khi chờ hàng đợi `ffprobe` nên có thể hết hạn | medium | patch | `presignGet` chạy trước `probeUrl`; chờ lượt + tối đa 10 giây/probe có thể vượt 60 giây khi tải cao |
| Test xác nhận video đều chạy qua stub `runFfprobe`, chưa chạy runner thật, đối số thật, ánh xạ lỗi | medium | patch | `uploads-video.test.mjs` đè `runFfprobe` bằng `ffprobe` cục bộ không có `-protocol_whitelist` và nuốt lỗi thành `{}` |
| Test timeout chỉ giả lập từ chối, không kiểm xóa `in-raw/` và bản ghi `expired` | medium | patch | Test `probeHook` chỉ kiểm `details.reason` |
| Throttler của `confirm` không có test | medium | patch | Gỡ `@UseGuards` hoặc đổi tracker sang IP, mọi test vẫn pass |
| Thông báo "3 giây" cứng, tách khỏi `MIN_VIDEO_SECONDS`; `rejectInvalid` dựng hai đối tượng lỗi | low | patch | Sửa trực tiếp, không thêm bề mặt công khai |
| `ffprobe` timeout hoặc lỗi mạng xóa upload (nên giữ pending và trả 503) | false | - | AC ghi rõ: `ffprobe` quá 10 giây là `VIDEO_UNREADABLE` và đối tượng `in-raw/` bị xóa |
| `ffprobe` thiếu binary trả 500, upload kẹt pending | low | reject | Image có `ffprobe` và CI kiểm; sửa cần thêm đường lỗi mới |
| Hàng đợi `ffprobe` không giới hạn, không timeout chờ | low | reject | Spec yêu cầu các yêu cầu còn lại chờ lượt; đã có throttler 30 lần/phút/người dùng |
| Hai `confirm` đua trên một khóa; mồ côi `in/` khi mất CAS; `rejectInvalid` xóa `in-raw/` | low | defer | Mẫu này có sẵn ở nhánh ảnh từ Story 2.2, không do story này gây ra |
| Thông báo hạn mức đổi "ảnh tạm" thành "tệp tạm" làm đổi hành vi ảnh | false | - | Spec Always yêu cầu thông báo hạn mức không nói riêng "ảnh"; grep không có test nào khẳng định câu cũ |
| Throttler áp lên cả `confirm` ảnh; đọc env mỗi request; tracker rơi về IP | false | - | AC: "route xác nhận chịu `@nestjs/throttler`"; cùng mẫu `TopupThrottlerGuard` |
| `apt-get` chạy sau `USER node` làm hỏng build | false | - | `Dockerfile`: `RUN apt-get` ở dòng 20, `USER node` ở dòng 34 |
| MIME khai báo không so với `format_name`; không có giới hạn trên về độ dài/độ phân giải/codec | low | reject | `format_name` là `mov,mp4,...` cho cả hai MIME nên không phân biệt được; Cap theo Tier do 5.3 kiểm; ffmpeg 5.4 re-encode |
| `Math.floor(59.9)` thành 59 | false | - | AC: "làm tròn xuống số nguyên" |
| Ép kiểu `as UploadConfirmVideoResponse`, `kind` suy từ `startsWith('video/')` | low | reject | Schema hợp đồng chỉ cho `video/mp4`,`video/quicktime` nên không có `video/*` khác tới được |
| Cache CI `docker build`, ghim phiên bản apt, ffmpeg đầy đủ thay vì chỉ ffprobe | low | reject | Worker 5.4 cần `ffmpeg`; thông số CI không thuộc yêu cầu |
| Thiếu test xoay `tags.rotate`, -90, 270, 180 | low | reject | Hàm thuần chỉ ảnh hưởng số đo; `abs % 180` đã xử lý các giá trị này |
| `tier.test` (`GET /config/pricing`) hỏng vì `tier.ts` chưa trả `motionControlMinSeconds` | medium | defer | Chạy lại trên baseline (stash) vẫn hỏng; do hợp đồng 5.1 thêm trường; thuộc 5.3 hoặc bản vá `tier.ts` |
| `reconcile-script.test` hỏng, script thoát mã 2 | maybe-false | defer | Chạy tay thấy thiếu `RUNNINGHUB_WORKFLOW_BODY_RESHAPE`; cũng hỏng trên baseline; cần xác nhận môi trường CI có biến này |

## Design Notes

URL ký R2 thật là `https`, còn `FakeStorage` trả URL không truy cập được; vì vậy `ffprobe` được bọc sau một cổng có thể ghi đè trong test (chạy `ffprobe` thật trên file mẫu cục bộ nhưng dùng cùng hàm đánh giá kết quả). Đối số dựng riêng được test để chắc chắn có whitelist, timeout và không có shell.

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass (cần `ffprobe` trên máy chạy test)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
