---
title: 'Story 5.7: [FE] Tải video mẫu và thanh Trim'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '7b3aa278131967b25e94e1ef192e04f93715b79f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/web` chưa có cách chọn video mẫu cho Motion Control: không kiểm tra video phía client, không tải video lên theo luồng `POST /uploads` → PUT → `confirm`, và không có thanh chọn đoạn theo từng giây. Story 5.8 (trang Motion Control) cần một thành phần dùng được ngay.

**Approach:** Thêm thành phần `VideoTrimmer` (chọn file, kiểm tra, tải lên, xem trước cục bộ, hai tay cầm giây nguyên, giới hạn theo Cap) phát ra `videoKey`, `trimStart`, `trimEnd`. Tách logic tải lên của `ImageUploader` thành phần dùng chung, không sao chép mã; mở rộng `api-client` để xác nhận video.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/web/**` (nhánh `fe/*`). **Quyết định:** "chế độ mock" nghĩa là test chạy thành phần với client giả và các hằng `MOCK_*` của contracts (lỗi tải, hủy, thử lại, video quay dọc), không có công tắc chạy thật; dùng hợp đồng 5.1 (`UploadCreateRequestSchema`, `UploadConfirmVideoResponseSchema`, `MOTION_MIN_TRIM_SECONDS`, `getValidationReasonMessageVi`, `MOCK_UPLOAD_VIDEO_CONFIRM_RESPONSE`). Pipeline tên `motion_control`; không có `consent`.
- Kiểm tra client: `video/mp4`|`video/quicktime`, ≤ 100 MB, độ dài từ metadata ≥ 3 giây, lỗi tiếng Việt. Hiển thị kích thước file, tiến trình tải, nút hủy khi đang tải, nút thử lại khi lỗi.
- File hợp lệ thì tải ngay (`createUpload` → PUT → `confirmUpload`) trong lúc vẫn kéo được thanh trượt; xem trước từ URL đối tượng cục bộ, phát lặp trong đoạn chọn, độc lập việc tải xong chưa; thu hồi URL khi rời trang.
- Hai tay cầm, mọi giá trị là số giây nguyên; độ dài đoạn ≥ 3 và ≤ min(Cap, độ dài video làm tròn xuống). Chạm được (vùng ≥ 48px) và bàn phím (mũi tên ±1 giây), có `aria-label` "Điểm bắt đầu video" / "Điểm kết thúc video".
- `confirm` trả `durationSeconds` khác giá trị client: dùng giá trị server làm giới hạn trên và tự thu hẹp đoạn nếu vượt.
- Video dài hơn Cap: hiện "Gói {tên} cho phép tối đa {cap} giây" kèm liên kết "Nâng cấp" dẫn tới `/pricing` (route thật; AC ghi `/topup` nhưng route này không tồn tại, **quyết định** dùng `/pricing`); Cap lấy từ `GET /me` và `GET /config/pricing`, không hardcode.
- Hiển thị thời điểm bắt đầu, kết thúc, độ dài đã chọn; phát sự kiện kèm `videoKey`, `trimStart`, `trimEnd`.
- Slate Cyber, icon Lucide, không emoji, dùng được ở 360 px.

**Never:**
- Không sửa file ngoài `apps/web`; không đổi hành vi hay giao diện của `ImageUploader`; không tính hay hiển thị giá (thuộc 5.8); không tạo trang `/motion-control`; không thêm chế độ mock chạy thật (`mockMode`) vào `apps/web`; không thêm phụ thuộc.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hợp lệ | MP4 12 s, 20 MB, Cap 10 | Tải lên ngay; đoạn mặc định 0–min(Cap,12); emit sau confirm | N/A |
| Sai định dạng | `video/webm` | Từ chối trước khi tải | "Chỉ hỗ trợ video MP4 hoặc MOV." |
| Quá lớn | 100 MB + 1 | Từ chối | Thông báo 100 MB |
| Quá ngắn | 2 s | Từ chối | `VIDEO_TOO_SHORT` |
| Không đọc được metadata | file hỏng | Từ chối | Thông báo không đọc được video |
| Server lệch | client 12,6 s, server 11 | Giới hạn trên = 11, đoạn tự thu hẹp | N/A |
| Vượt Cap | video 15 s, Cap 5 | Tay cầm kẹt ở 5 giây; hiện dòng Cap + "Nâng cấp" | N/A |
| Kéo | tay cầm vượt vùng hợp lệ | Kẹp về khoảng [3, min(Cap, dài)] | N/A |
| Bàn phím | ←/→ trên tay cầm | ±1 giây, không vượt giới hạn | N/A |
| Lỗi tải | PUT hoặc confirm lỗi (`VIDEO_UNREADABLE`) | Hiện lỗi tiếng Việt, nút thử lại | Thử lại tải lại đúng file |
| Hủy | bấm hủy khi đang tải | Dừng tải, về trạng thái chưa chọn | N/A |
| Video quay dọc | 720×1280 | Xem trước đúng chiều, không tràn ở 360 px | N/A |
| Rời trang | unmount | Thu hồi URL cục bộ, hủy tải đang dở | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/components/ImageUploader.vue` -- luồng tải ảnh dòng ~271–390 (`handleFileSelect` → `validateImageFile` → `startUpload`: `createUpload` → `uploadPresignedFile` → `confirmUpload`), `AbortController`, tiến trình, thử lại, hủy, thu hồi URL. Tách phần dùng chung ra composable; giữ nguyên props/emit/giao diện (smoke và body-retouch test biên dịch file này).
- `apps/web/composables/` -- chỗ đặt composable tải lên dùng chung mới (cạnh `useApiClient.ts`).
- `apps/web/utils/image-upload.ts` -- `normalizeImageMimeType`, `formatFileSizeVi`, `validateImageFile`, `getImageDimensions`; thêm kiểm tra và đọc độ dài video tương ứng, tái dùng `formatFileSizeVi`.
- `apps/web/utils/api-client.ts` -- `uploadPresignedFile` (~244, XHR có tiến trình/hủy) dùng nguyên; `createUpload` (~542) đã nhận khai báo video qua `UploadCreateRequestSchema`; `confirmUpload` (~559) chỉ parse `UploadConfirmResponseSchema` (ảnh) nên hỏng với `{key, video}` — thêm nhánh xác nhận video, không đổi hành vi ảnh.
- `apps/web/composables/usePricingConfig.ts` -- `currentTier`, `currentTierCapSeconds`, `pricing`, `me`; `apps/web/utils/catalog.ts` `getTierCapSeconds`, `resolveTierConfig` cho Cap.
- `apps/web/pages/body-retouch.vue` -- mẫu cách trang dùng `ImageUploader`, `usePricingConfig`, `useApiClient`.
- `apps/web/test/body-retouch.test.mjs` -- mẫu harness (`compileScript`/`compileTemplate`, SSR render, stub component); `test/smoke.test.mjs` đang phủ `ImageUploader`.
- `packages/contracts/src/mocks.ts` -- `MOCK_UPLOAD_VIDEO_CONFIRM_RESPONSE` (12,5 s, 720×1280, dọc), `MOCK_PRICING_CONFIG_RESPONSE`, `MOCK_ME_*`; `packages/contracts/src/tasks.ts` `getValidationReasonMessageVi`, `MOTION_MIN_TRIM_SECONDS`.
- `_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/EXPERIENCE.md` mục `VideoTrimmer`, `DESIGN.md` `video-trimmer-handle` -- nhãn, chạm 48px, glow khi chạm.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/composables/useUploadFlow.ts` -- logic tải lên dùng chung (tạo → PUT → confirm, tiến trình, hủy, thử lại) -- không sao chép mã giữa ảnh và video
- [x] `apps/web/components/ImageUploader.vue` -- chuyển sang dùng composable, không đổi hành vi -- dùng chung
- [x] `apps/web/utils/image-upload.ts`, `apps/web/utils/api-client.ts` -- kiểm tra video client, đọc độ dài, xác nhận video -- hỗ trợ video
- [x] `apps/web/components/VideoTrimmer.vue` -- chọn file, trạng thái, xem trước lặp, hai tay cầm, Cap, sự kiện -- thành phần chính
- [x] `apps/web/test/video-trimmer.test.mjs` -- test I/O Matrix với client giả và hằng `MOCK_*`; chạy lại test ảnh -- phủ ranh giới

**Acceptance Criteria:**
- Given `ImageUploader` sau khi tách, when chạy test web hiện có, then pass, không đổi giao diện ảnh.
- Given viewport 360 px, when hiển thị `VideoTrimmer`, then không tràn ngang, mọi vùng chạm ≥ 48px.
- Given `pnpm run lint && pnpm run typecheck && pnpm run build`, when chạy, then pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Kết quả `aborted` của lần tải cũ ghi đè trạng thái lần mới ở `ImageUploader` | medium | patch | Đọc `startUpload`: đặt `idle` vô điều kiện; đã vá bằng so `currentFile` |
| Cap < 3 hoặc độ dài server floor < 3 vẫn phát `ready` | medium | patch | `computeTrimLimits` ép `max(3, …)`; đã thêm cờ `usable` và test hàm thuần |
| `getVideoDuration` có thể treo mãi | medium | patch | Không có timeout; đã thêm 10 giây và nút hủy khi `validating` |
| Unmount khi đang `validating` vẫn tạo URL và tải | medium | patch | Đã thêm cờ `unmounted`, kiểm sau mọi `await` |
| Tay cầm không nhận focus nên phím mũi tên không dùng được | low | patch | `pointerdown.prevent`; đã gọi `focus()` |
| Hằng `3`, cast `as 'video/mp4'` lặp lại hợp đồng | low | patch | Đã dùng `MOTION_MIN_TRIM_SECONDS` và `VideoMimeType` |
| Thiếu giá/credit theo thời gian thực | false | - | Spec ghi 5.7 không hiển thị giá, thuộc 5.8 |
| Tệp tải dở không dọn trên R2 | low | reject | `in-raw/` do lifecycle và `expireStalePending` của Epic 2 dọn |
| Test thành phần chỉ so chuỗi, không mount | low | defer | Cần hạ tầng mount; hàm thuần và `useUploadFlow` đã có test hành vi |
| Test hook `durationSeconds` trong `getVideoDuration` ship vào production | low | defer | Vô hại với `File` thật; tách thành tham số khi có hạ tầng mount |

## Design Notes

Thành phần chỉ phát `videoKey`, `trimStart`, `trimEnd`, `durationSeconds`; giá `motionPrice(trimEnd − trimStart)` do trang 5.8 hiển thị. `durationSeconds` của server có thể là số thực nên giới hạn trên là `Math.floor`. Tách logic bằng composable giúp `VideoTrimmer` và `ImageUploader` cùng dựa vào một luồng, mỗi nơi tự lo kiểm tra và hiển thị riêng.

## Verification

**Commands:**
- `pnpm --filter @flowvis/web test` -- expected: pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass (chỉ file trong `apps/web` và artifact BMad của story)
