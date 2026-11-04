---
title: 'Story 2.2: [BE] Tải ảnh lên R2 an toàn'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'a87216836893889cda1798c68decd10708f361e9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** API chưa có đường tải ảnh đầu vào: không cấp presigned URL, không xác nhận và kiểm tra ảnh, không bảng `uploads` để đếm giới hạn 10 file tạm, nên Story 2.3 (tạo Task) chưa có khóa `in/` đáng tin để dùng.

**Approach:** Module `storage` (chủ duy nhất của bảng `uploads`) cung cấp `POST /uploads` và `POST /uploads/:key/confirm` trên `StoragePort` (adapter S3/R2 thật + bản giả trong test), migration bảng `uploads`, và script cấu hình bucket (riêng tư, CORS, lifecycle).

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` và `deploy/` (tiền tố `be/*`); dùng schema/hằng số từ `@motion-ai/contracts` (`UploadCreateRequestSchema`, `ImageMetaSchema`, `MAX_UNCONFIRMED_RAW_UPLOADS`, …), lỗi qua `ApiErrorCode` như `MeController`.
- Route cần `JwtAuthGuard` + `AccountLockedGuard`. Khóa do server sinh `in-raw/<userId>/<uuid>`; `confirm` kiểm khóa thuộc `user.sub` qua bản ghi `uploads` (không tin chuỗi khóa), sai chủ → `FORBIDDEN`, không tồn tại → `NOT_FOUND`, đã `confirmed`/`expired` → `CONFLICT`.
- Presigned PUT ký kèm `Content-Type` và `Content-Length` đúng kích thước khai báo, hạn ngắn (10 phút); trả header cần gửi.
- Đếm giới hạn bằng `uploads` (`status = 'pending'` và `created_at` trong 24 giờ), trong transaction có khóa dòng user để hai request song song không vượt 10; vượt → `VALIDATION_FAILED` với thông báo về giới hạn file tạm. Không dùng `ListObjects`.
- `confirm`: `HEAD` lấy size + ETag; size khác khai báo hoặc nội dung không phải ảnh hợp lệ (sharp đọc metadata) hoặc không đạt `ImageMetaSchema` → xóa đối tượng `in-raw/`, bản ghi `expired`, trả `VALIDATION_FAILED`. Cạnh dài > 2048 px thì resize về 2048 giữ tỷ lệ bằng sharp (ghi đè đối tượng, ETag mới) trước khi copy; đo `width`/`height` sau resize.
- `CopyObject` sang `in/<userId>/<uuid>` với `CopySourceIfMatch = ETag`; ETag đổi → từ chối, không tạo khóa `in/` (và `confirm` trả `CONFLICT`). Thành công ghi `status=confirmed`, `size_bytes`, `etag`, `width`, `height`, `confirmed_at`; `duration_seconds` để null.
- Bản ghi `pending` quá 24 giờ chuyển `expired` bằng job định kỳ của worker (cùng chu kỳ lifecycle `in-raw/`) và không còn được tính vào giới hạn.
- Bảng `uploads` chỉ `storage` ghi (AD-1). Migration: `kind` ∈ (`image`,`video`), `status` ∈ (`pending`,`confirmed`,`expired`) bằng `CHECK` trong SQL thô, `key` unique, chỉ mục `(user_id, status, created_at)`.
- Bucket riêng tư; CORS chỉ cho `FRONTEND_URL`; lifecycle `in-raw/` 1 ngày, `in/` 7 ngày (script idempotent chạy được thủ công, ghi trong README/.env.example).
- Mọi test dùng `StoragePort` giả; không gọi R2 thật.

**Never:**
- Không tạo Task/HOLD (Story 2.3), không xác nhận video (Epic 5), không sửa `packages/contracts`.
- Không để client chọn khóa; không log presigned URL hay secret R2; không thêm cấu hình R2 vào code ngoài biến môi trường.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo URL hợp lệ | `image/jpeg`, 2 MB, <10 pending | 201, `key` dạng `in-raw/<userId>/<uuid>`, URL PUT ký `Content-Length` 2 MB, 1 bản ghi `pending` | N/A |
| Khai báo sai | `image/gif`, hoặc 10 MB + 1 | Không cấp URL, không ghi `uploads` | `VALIDATION_FAILED` |
| Lần thứ 11 | 10 `pending` chưa quá 24h | Từ chối | `VALIDATION_FAILED` (thông báo giới hạn file tạm) |
| Pending quá 24h | job quét chạy | Chuyển `expired`, lần tạo tiếp theo được | N/A |
| Confirm hợp lệ | ảnh 1000x800 đúng size | `in/` mới, `confirmed`, ghi size/etag/width/height | N/A |
| Ảnh lớn | 4000x3000 | Resize 2048x1536 trước copy; width/height ghi 2048/1536 | N/A |
| Khóa người khác | B confirm khóa của A | Không HEAD/copy | `FORBIDDEN` |
| Size thật ≠ khai báo / không phải ảnh / cạnh ngắn <512 / tỷ lệ >2:1 | — | Xóa `in-raw/`, bản ghi `expired` | `VALIDATION_FAILED` |
| ETag đổi giữa HEAD và Copy | adapter giả ném precondition failed | Không có khóa `in/` | `CONFLICT` |
| Confirm lặp / khóa lạ | đã confirmed, hoặc không có bản ghi | — | `CONFLICT` / `NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `apps/api/src/ports/index.ts` -- `StoragePort` đang rỗng; mở rộng: `presignPut`, `head`, `getObject`, `putObject`, `copyIfMatch`, `delete`, lỗi `PreconditionFailed`.
- `apps/api/src/modules/storage/index.ts` -- `StorageModule` rỗng; thêm service, controller, adapter S3, job hết hạn; giữ export qua `index.ts`.
- `apps/api/src/modules/auth/me.controller.ts` -- mẫu guard, `safeParse`, ném lỗi `ApiErrorCode`; `JwtUserPayload.sub` là userId.
- `apps/api/src/modules/wallet/wallet.service.ts` -- mẫu khóa dòng user `FOR UPDATE` trong `$transaction`.
- `apps/api/src/modules/ops/ops.module.ts`, `reconcile.service.ts` -- mẫu job `@nestjs/schedule` chỉ chạy trong worker (`MOTION_PROCESS_ROLE`).
- `apps/api/src/app.module.ts`, `src/worker.ts` -- đã import `StorageModule`; kiểm worker nạp module để job chạy.
- `apps/api/prisma/schema.prisma` + `prisma/migrations/` -- thêm model `Upload` và migration `uploads` kèm `CHECK` SQL thô (theo `migrations/README.md`).
- `apps/api/.env.example`, `apps/api/package.json` -- thêm `R2_*`, thêm `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (3.1161.0), `sharp` (0.35.5).
- `apps/api/test/wallet.test.mjs` -- mẫu test tích hợp PostgreSQL thật (`ensureInfra`).

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/package.json` -- thêm 3 phụ thuộc đúng phiên bản spine -- bắt buộc cho S3 và sharp
- [x] `apps/api/prisma/schema.prisma`, migration mới -- bảng `uploads` + `CHECK`/chỉ mục -- bộ đếm giới hạn
- [x] `apps/api/src/ports/index.ts` -- giao diện `StoragePort` -- cô lập R2
- [x] `apps/api/src/modules/storage/*` -- `S3StorageAdapter`, `UploadsService`, `UploadsController`, job hết hạn, module -- logic chính
- [x] `apps/api/src/scripts/configure-bucket.ts`, `.env.example`, `deploy/README.md` -- CORS/lifecycle/riêng tư -- AC cấu hình bucket
- [x] `apps/api/test/uploads.test.mjs` -- phủ I/O Matrix với `StoragePort` giả trên PostgreSQL thật, gồm hai request song song vượt giới hạn -- xác minh

**Acceptance Criteria:**
- Given đã đăng nhập, when `POST /uploads` hợp lệ, then nhận khóa `in-raw/<userId>/<uuid>` và URL ký `Content-Length`.
- Given bảng `uploads`, when chạy migration, then đủ cột theo AC và `CHECK` hoạt động trên PostgreSQL thật.
- Given bucket cấu hình bằng script, when kiểm tra, then riêng tư, CORS chỉ `FRONTEND_URL`, lifecycle 1/7 ngày.

## Implementation Notes

- Thêm cột `confirmed_key`, `declared_bytes`, `mime_type` vào `uploads` (ngoài danh sách AC) để so kích thước thật với khai báo và trả khóa `in/`.
- `confirm` trả 200 (không phải 201); chưa có file trên R2 → `VALIDATION_FAILED`, giữ `pending` để thử lại; ETag đổi → `CONFLICT`, giữ `pending`.
- Bản ghi `pending` quá 24 giờ thôi được đếm ngay, và chuyển `expired` khi job mỗi giờ của worker chạy.
- Chưa kiểm với R2 thật: adapter `S3StorageAdapter` (ký header presigned PUT, `requestChecksumCalculation: 'WHEN_REQUIRED'`) và `configure-bucket.ts`; cần thử với bucket thật trước khi Story 2.3 phụ thuộc.
- Xác minh: lint, typecheck, build, `check:boundaries` qua; `pnpm --filter @motion-ai/api test` 121 pass, 0 fail, 2 skip có sẵn; `uploads.test.mjs` 11/11.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Nhánh resize: `reHead` sau `putObject` lấy ETag của đối tượng bị ghi đè qua presigned PUT còn hạn, byte chưa kiểm vào `in/` | medium | patch | `uploads.service.ts` resize path; nhánh không resize an toàn vì `copyIfMatch` dùng ETag của `head` trước `getObject`; sửa: `putObject` trả ETag và dùng nó, bỏ `reHead` |
| Resize không `.rotate()`: sharp bỏ EXIF orientation nên ảnh điện thoại > 2048 px bị nằm ngang | medium | patch | Ảnh 4000x3000 orientation 6 là loại phổ biến; kiểm tỷ lệ/cạnh ngắn đối xứng nên không sai, chỉ phần xuất ảnh; thêm `.rotate()` |
| Thiếu test: cổng `MOTION_PROCESS_ROLE` của `scheduledExpire`; confirm khi chưa có file; hai confirm song song; adapter thật (ký `content-length`, ánh xạ 404/412) | medium | patch | Verification-gap đã xác minh: đảo cổng role hoặc bỏ `content-length` khỏi `signableHeaders` mà test vẫn qua; thêm test, adapter ở file riêng để không dính prototype giả |
| Hai confirm song song / expiry xen giữa để lại `in/` mồ côi | low | reject | Khóa `in/` là hàm của khóa gốc nên hai bên ghi cùng một khóa; mồ côi chỉ tồn tại tới lifecycle 7 ngày |
| Confirm sau 24 giờ khi chưa quét | low | reject | Chỉ lệch thời gian tới lần quét kế; đối tượng đã bị lifecycle xóa thì trả `VALIDATION_FAILED`, không gây hại |
| Không giới hạn tần suất `confirm` (CPU sharp), `rejectInvalid` nhả hạn mức | medium | defer | Có thật nhưng thuộc AD-17 (giới hạn tải theo người dùng/IP) chưa làm cho upload; đánh dấu chưa kiểm chứng mức độ |
| `ScheduleModule.forRoot()` import ở cả `StorageModule` và `OpsModule` có thể chạy cron hai lần | maybe-false | defer | Nest gộp dynamic module cùng cấu hình thành một instance nên khả năng cao không lặp; cần test đếm số lần `scheduledExpire` được gọi mới chắc |
| Script bucket ghi đè toàn bộ lifecycle (mất rule `out/` sau này), không kiểm bucket riêng tư, `FRONTEND_URL` rỗng rơi về localhost | low | defer | Script chạy thủ công; rule `out/` 30 ngày thuộc Story 2.6; ghi lại để thêm khi có `out/` |
| EXIF/GPS còn nguyên ở ảnh không resize; animated WebP; `limitInputPixels` | low | reject | Ngoài AC; 10 MB giới hạn; sửa thêm nhánh/tham số |
| `getObject` không giới hạn bộ nhớ; Content-Type không so với đối tượng | false | - | Kích thước `head` đã bằng khai báo ≤ 10 MB trước `getObject`; định dạng thật do sharp quyết định |
| Hạn mức 10 file giữ người dùng 24 giờ khi chưa PUT | false | - | Đúng yêu cầu AC (đếm `pending` trong 24 giờ) |
| Khóa chứa `/` trong path param `confirm` | low | reject | carried: hợp đồng 2.1 đã chốt, README yêu cầu client mã hóa URL; Express giải mã `%2F` đúng, test đã chạy qua |
| Thiếu validate `R2_*` lúc khởi động; HEAD thiếu ContentLength thành 0; index `(status, created_at)` cho job quét; ép kiểu `as UploadConfirmResponse`; `CHECK` liên cột; lỗi 503 cho lỗi storage; mã riêng cho vượt hạn mức | low | reject | Không gây hại trong dùng thường; sửa thêm nhánh/tham số hoặc thuộc hợp đồng 2.1 (mã lỗi riêng) |

## Design Notes

Hai request `POST /uploads` song song: khóa dòng user (`SELECT … FOR UPDATE`) trước khi đếm, tránh vượt 10. Resize ghi đè đối tượng `in-raw/` rồi `HEAD` lại để lấy ETag mới cho `CopySourceIfMatch`; ETag đổi giữa hai bước đó vẫn bị phát hiện.

## Verification

**Commands:**
- `pnpm install` -- expected: lockfile gốc cập nhật, không lockfile con
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua compose)
- `pnpm run check:boundaries` -- expected: pass
