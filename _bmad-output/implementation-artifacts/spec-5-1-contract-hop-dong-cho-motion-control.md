---
title: 'Story 5.1: [CONTRACT] Hợp đồng cho Motion Control'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'bdf53c1be46ccefc3244bf712a0c94bf392ef1f7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `@flowvis/contracts` chưa có pipeline Motion, hàm tính giá, tải video, schema Trim, kết quả video và thông báo lỗi Motion, nên luồng BE (5.2–5.6) và FE (5.7–5.8) chưa thể chạy song song trên cùng một hình dạng API.

**Approach:** Mở rộng `uploads.ts` (loại `video`, `VideoMeta`), `tasks.ts` (pipeline, `motionPrice`, `MotionCreateRequest`, kết quả `mediaType`, share info/poster, enum `details.reason`, thông báo theo pipeline), `wallet.ts` (số giây tối thiểu trong `GET /config/pricing`), kèm mock, test hợp đồng và README.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `packages/contracts/**` (nhánh `contract/*`); `zod` `3.24.4`, phong cách hiện có (schema + `z.infer`, `.strict()` cho request, thông báo tiếng Việt).
- **Quyết định:** tên pipeline là `motion_control` (giữ khớp mã sẵn có ở `tasks.ts` và `apps/web`, lệch chữ `motion` của AC); thêm vào `TASK_PIPELINES` và bỏ trùng ở `REASON_MESSAGE_PIPELINES`.
- `motionPrice(seconds)` = 50 × `seconds`, là nơi duy nhất giữ hằng 50 phía mã nguồn; FE và BE cùng import.
- `GET /config/pricing`: giá Motion mỗi giây (50), số giây tối thiểu (3), Cap theo Tier (5, 10, 15, 20; đã có ở `tiers[].maxVideoSeconds`); chỉ bổ sung trường còn thiếu.
- `POST /uploads` nhận thêm `video` (`video/mp4` hoặc `video/quicktime`, khai báo tối đa 100 MB); ảnh giữ nguyên hành vi cũ. Confirm video trả thêm `durationSeconds`, `width`, `height`.
- `POST /tasks/motion`: `characterKey`, `videoKey`, `trimStart`, `trimEnd` (số nguyên giây), `.strict()`. **Quyết định:** không có `consent` trong body (ToS đồng ý một lần khi đăng nhập, như Face Swap/Body Retouch; lệch AC); trả Task cùng hình dạng pipeline khác kèm `price`.
- `GET /tasks/{id}/result` thêm `mediaType` (`image`|`video`), `posterUrl` và `durationSeconds` (chỉ video), `sourceUrl` Motion luôn rỗng; thêm `GET /s/{token}/info` (`mediaType`, `durationSeconds`) và `GET /s/{token}/poster` (chuyển hướng, không body).
- `VALIDATION_FAILED` `details.reason` thuộc enum `VIDEO_UNREADABLE`, `VIDEO_TOO_SHORT`, `TRIM_TOO_SHORT`, `TRIM_EXCEEDS_CAP`, `TRIM_OUT_OF_VIDEO`, `TRIM_NOT_WHOLE_SECOND`; `TRIM_EXCEEDS_CAP` kèm `details.cap`; có thông báo tiếng Việt cho từng reason (`TRIM_EXCEEDS_CAP`: "Gói của bạn cho phép tối đa {cap} giây").
- Thông báo Motion: `NO_POSE` = "Không nhận diện được chuyển động cơ thể trong video mẫu"; `NO_FACE` = "Không nhận diện được nhân vật trong ảnh. Vui lòng chọn ảnh toàn thân rõ người."
- Mock: Task Motion ở đủ 6 trạng thái, mock xác nhận video, mock kết quả video có `posterUrl`; mọi mock khớp schema.

**Never:**
- Không sửa `apps/*`, `deploy/`, cấu hình gốc; không thêm phụ thuộc; không thêm giá trị `ApiErrorCode` hay `ReasonCode`; không nhận credit hay giá từ client.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Giá | `motionPrice(1)`, `(20)` | 50, 1000 | Số không nguyên hoặc ≤ 0: từ chối |
| Tạo hợp lệ | khóa `in/…`, `trimStart:2`, `trimEnd:7` | Parse thành công | N/A |
| Trim sai kiểu | `trimStart` 1.5, âm, chuỗi | Từ chối | Lỗi tiếng Việt trên trường đó |
| Trường lạ | có `credits`/`price`/`consent` | Từ chối (`.strict()`) | N/A |
| Tải video | `video/mp4` 100 MB; `video/webm`; 100 MB + 1 | OK; từ chối; từ chối | Lỗi trên `mimeType`/`sizeBytes` |
| Kết quả video | `mediaType:'video'` thiếu `posterUrl`/`durationSeconds`; ảnh có `posterUrl` | Từ chối | Lỗi trên trường tương ứng |
| Lý do lỗi | 6 giá trị reason; giá trị lạ | 6 hợp lệ; từ chối | `TRIM_EXCEEDS_CAP` thiếu `cap`: từ chối |
| Thông báo | `NO_POSE`/`NO_FACE` của Motion vs pipeline khác | Khác nhau, đúng câu yêu cầu | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/uploads.ts` -- hiện chỉ ảnh (`ImageFileDeclarationSchema`, `UploadCreateRequestSchema = ImageFileDeclarationSchema`, confirm trả `{key, image}`); thêm khai báo video, `VideoMetaSchema`, union request/response. `ConfirmedUploadKeySchema` (`in/…`) dùng lại cho `videoKey`. `apps/api` (`uploads.controller/service`) và `apps/web/utils/api-client.ts` đang import các schema này, không được vỡ kiểu.
- `packages/contracts/src/tasks.ts` -- `TASK_PIPELINES` (đang `face_swap`,`body_retouch`; thêm `motion_control`), `REASON_MESSAGE_PIPELINES` + `REASON_CODE_PIPELINE_OVERRIDES_VI` (đã có `motion_control.NO_POSE`, cần sửa câu và thêm `NO_FACE`), `TaskResultResponseSchema`, `SharePublicParamsSchema`; mẫu request: `BodyRetouchCreateRequestSchema`. `TaskSchema` không có `price` — `price` của Motion nằm ở response tạo (mở rộng `TaskSchema`).
- `packages/contracts/src/wallet.ts` -- `PipelinePricingSchema` (có `motionControlCreditsPerSecond: 50`), `TierConfigSchema.maxVideoSeconds`; thêm số giây tối thiểu 3.
- `packages/contracts/src/errors.ts` -- `ApiErrorCode` không đổi; đặt enum `details.reason` và bảng thông báo ở `tasks.ts`/`uploads.ts`.
- `packages/contracts/src/mocks.ts` -- `DEFAULT_PRICING_CONFIG`, `MOCK_BODY_RETOUCH_*` làm mẫu; thêm `MOCK_MOTION_*`.
- `packages/contracts/test/index.test.mjs` -- thêm `describe('Epic 5 contracts')`; README mục 8.
- `apps/api/src/modules/wallet/tier.ts` và `apps/web/utils/catalog.ts` đã đọc `motionControlCreditsPerSecond` — không đổi tên trường này.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/uploads.ts` -- loại `video`, `VideoMeta`, confirm video -- hợp đồng tải video
- [x] `packages/contracts/src/tasks.ts` -- pipeline, `motionPrice`, `MotionCreateRequest/Response`, kết quả video, share info/poster, enum reason, thông báo -- hợp đồng chính
- [x] `packages/contracts/src/wallet.ts` -- số giây tối thiểu trong cấu hình giá -- FE/BE cùng nguồn
- [x] `packages/contracts/src/mocks.ts` -- mock Motion, xác nhận video, kết quả video -- FE chạy không cần BE
- [x] `packages/contracts/test/index.test.mjs` -- test I/O Matrix -- phủ ranh giới
- [x] `packages/contracts/README.md` -- mục Epic 5 -- tài liệu

**Acceptance Criteria:**
- Given gói contracts, when build, then enum pipeline có Motion và `motionPrice` là nơi duy nhất giữ hằng 50.
- Given `GET /config/pricing`, when đọc hợp đồng, then có giá/giây, số giây tối thiểu và Cap 5/10/15/20.
- Given các endpoint của epic, when đọc hợp đồng, then có upload video, confirm video, `POST /tasks/motion`, result video, `GET /s/{token}/info` và `/poster`.
- Given mock, when chạy test hợp đồng, then mọi mock Motion khớp schema; `pnpm run typecheck` của api và web vẫn pass.

## Implementation Notes

- `mediaType` (kết quả) và `motionControlMinSeconds` (cấu hình giá) để tùy chọn vì `apps/api` chưa trả hai trường này và spec cấm sửa `apps/*`; BE 5.3/5.6 phải trả, sau đó nên đổi thành bắt buộc. Vắng `mediaType` nghĩa là ảnh.
- `TaskSchema` tách thành `TaskBaseSchema` + `refineTask` để `MotionCreateResponseSchema` dùng lại bất biến Task.
- `UploadCreateRequestSchema` chọn nhánh theo tiền tố `video/` để giữ thông báo lỗi tiếng Việt theo trường.
- Xác nhận video dùng `UploadConfirmVideoResponseSchema` (`{key, video}`) riêng; BE 5.2 chọn schema theo loại đã khai báo.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Union upload làm ảnh sai MIME trả "Invalid input" | medium | patch | Chạy `image/gif` ra `invalid_union`; đã vá, test phủ |
| `TRIM_EXCEEDS_CAP` thiếu `cap` render "tối đa  giây" | low | patch | Chạy thực tế ra chuỗi hở; trả thông báo chung |
| Response Motion không ghim `pipeline` | medium | patch | Schema chấp nhận `face_swap`; thêm `z.literal` |
| Kết quả video không ép `sourceUrl` null | medium | patch | Spec ghi luôn rỗng; thêm kiểm tra |
| Import `mocks.ts` lẫn `type`, hỏng typecheck | false | - | `pnpm run typecheck` pass cả 3 gói; tên không có `type` đều là kiểu |
| Thiếu kiểm tra chéo `trimEnd > trimStart`, khoảng 3..Cap, giới hạn trên | low | defer | Đã chạy: (7,2), (0,1) vẫn parse; BE 5.3 kiểm bằng `TRIM_*`, cần Cap và độ dài video nên không thuộc schema thuần |
| `durationSeconds` kết quả là int, `VideoMeta` là float | low | defer | Làm tròn thuộc BE 5.6 |
| Xác nhận video thiếu discriminator so với ảnh | low | defer | BE 5.2 phân biệt theo loại đã khai báo |
| `ValidationDetails` chưa nối `ApiErrorSchema`, thiếu mock lỗi Motion | low | defer | `details` là record tự do; FE 5.7 cần mock |
| `mediaType` tùy chọn ở kết quả, bắt buộc ở share info | low | reject | Cố ý để tương thích BE Epic 2–4, ghi ở Implementation Notes |
| Hằng 3 lặp ở `wallet.ts` và `tasks.ts`, README nói chỉ một nơi giữ 50 | low | reject | `z.literal(50)` là bất biến cấu hình có sẵn; README chỉ nói về phía mã nguồn tính giá |
| Câu `NO_POSE` Motion cũ bị thay | false | - | Grep không còn chuỗi cũ ở `apps`, `packages` |
| `check:boundaries` thất bại | false | - | Script so với `main`, kéo theo file Epic 4; không có file 5.1 nào ngoài `packages/contracts/` hay artifact BMad |
| Test chỉ khẳng định `.success`, thiếu một số ca | low | reject | Sửa chỉ là thêm test, ca chính đã phủ |

## Verification

**Commands:**
- `pnpm --filter @flowvis/contracts test` -- expected: pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass
