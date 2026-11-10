---
title: 'Story 5.8: [FE] Trang Motion Control, giá trực tiếp và kết quả video'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '68eb04de56a11be0437c7ab692d96a656601dfa7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/web` chưa có trang tạo Task Motion Control: `api-client` chưa có `createMotionControlTask`, `getShareInfo`; kết quả `/tasks/[id]`, thẻ lịch sử và trang chia sẻ `/share/[token]` chỉ biết ảnh; `FeatureWorkspaceDialog` chỉ có thanh trượt giây đơn giản cho Motion, chưa dùng `VideoTrimmer` (5.7).

**Approach:** Thêm trang `/motion-control` (ảnh nhân vật + `VideoTrimmer` + giá `motionPrice` trực tiếp + nút Tạo, tiến trình dùng lại `TaskProgressCard`), mở rộng `api-client` (tạo Task, share info), thêm nhánh video cho trang kết quả, thẻ lịch sử và trang chia sẻ (kèm Open Graph), và nối `FeatureWorkspaceDialog` sang luồng Motion. Mọi kiểm thử dùng client giả và hằng `MOCK_*` của contracts.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/web/**` (nhánh `fe/*`); dùng hợp đồng 5.1 (`MotionCreateRequestSchema`/`MotionCreateResponseSchema`, `motionPrice`, `ShareInfoResponseSchema`, `TaskResultResponseSchema`, `getReasonCodeMessageVi(code,'motion_control')`, `getValidationReasonMessageVi`, `MOCK_*`). Không thêm phụ thuộc; không hardcode 50 hay Cap (lấy `GET /config/pricing`, `GET /me`).
- **Quyết định đã chốt:** pipeline tên `motion_control`; body `POST /tasks/motion` không có `consent` (ToS đồng ý một lần khi đăng nhập); "mock" nghĩa là test dùng client giả và hằng `MOCK_*`, không có công tắc `mockMode`; liên kết nạp/nâng cấp dẫn tới `/pricing`, không phải `/topup`; route trang là `/motion-control` (AC ghi `/motion` nhưng mã và test hiện có đã dùng `/motion-control`); không có ô cam kết ToS mỗi lần tải (thống nhất Face Swap/Body Retouch, ToS đồng ý một lần khi đăng nhập; lệch AC/FR19); hết credit chỉ hiện liên kết "Nạp thêm Credit" tới `/pricing`, không mở `VietQRModal` tại chỗ (lệch AC); `FeatureWorkspaceDialog` của Motion nhúng đầy đủ `VideoTrimmer` và tạo Task ngay trong dialog, dùng chung logic với trang `/motion-control` (rút phần tạo Task thành composable dùng chung, không lặp mã).
- Giá hiển thị = `motionPrice(trimEnd − trimStart)` cập nhật ngay khi kéo thanh trượt, kèm số dư còn lại sau khi trừ; nút "Tạo" vô hiệu khi chưa tải xong ảnh hoặc video, chưa đăng nhập, Cap không dùng được hoặc vượt Cap; khi giá > số dư hiện thông báo ngữ cảnh "Bạn đang có {balance} credit (cần {required} cr để tạo đoạn {duration}s)…" kèm liên kết "Nạp thêm Credit" tới `/pricing`; bấm hai lần chỉ gửi một `POST /tasks/motion`.
- Lỗi tạo Task hiển thị tiếng Việt: `TRIM_EXCEEDS_CAP` thì gọi lại `GET /me` và `GET /config/pricing`, thu hẹp thanh trượt về Cap mới và hiện "Gói hiện tại của bạn cho phép tối đa {cap} giây"; `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `PAUSED`, `CONSENT_REQUIRED` và các `details.reason` khác dùng bảng thông báo có sẵn.
- Tiến trình dùng lại `TaskProgressCard` (vị trí hàng đợi, hủy khi còn `queued`, dòng "Video thường mất vài phút, bạn có thể rời trang và quay lại từ Lịch sử"); `failed`/`timed_out` hiện thông báo theo `getReasonCodeMessageVi(reasonCode,'motion_control')` và nêu credit đã hoàn.
- Kết quả `succeeded` (mediaType video): `<video playsinline controls poster>` từ `posterUrl`, nút "Tải về" MP4, "Chia sẻ", "Ngừng chia sẻ"; không có thanh so sánh trước/sau; ảnh vẫn dùng `BeforeAfterSplitSlider`. Thẻ lịch sử hiện ảnh bìa và độ dài cho Task video. Trang chia sẻ dùng `GET /s/{token}/info`: video thì hiện trình phát, `og:image` trỏ `/s/{token}/poster`, `og:video` trỏ `/s/{token}`.
- Lối vào "Motion Control" cạnh Face Swap và Body Retouch; Slate Cyber, icon Lucide (`lucide:clapperboard`, `lucide:zap`, `lucide:play`, `lucide:alert-circle`), không emoji, vùng chạm ≥ 48px, dùng được ở 360 px.

**Never:**
- Không sửa file ngoài `apps/web`; không đổi hành vi Face Swap/Body Retouch hay `ImageUploader`/`VideoTrimmer` ngoài phần mở rộng cần thiết; không thêm công tắc mock chạy thật; không tự tạo route `/topup`; không thêm phụ thuộc.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Giá trực tiếp | Kéo 3→8 giây | Giá `motionPrice(5)` = 250, số dư còn lại cập nhật | N/A |
| Đủ điều kiện | Ảnh + video đã xác nhận, đăng nhập, ≤ Cap, đủ số dư | Nút "Tạo" bật; bấm 2 lần gửi 1 `POST` | N/A |
| Thiếu điều kiện | Chưa xong ảnh/video, chưa đăng nhập, vượt Cap | Nút "Tạo" tắt | N/A |
| Thiếu số dư | Giá > số dư | Thông báo ngữ cảnh + lối nạp, giữ nguyên form | N/A |
| Cap đổi | Server trả `TRIM_EXCEEDS_CAP` kèm `cap` | Gọi lại `me`/`pricing`, thu hẹp trượt, hiện "tối đa {cap} giây" | Lỗi tải lại: giữ thông báo cũ |
| Lỗi khác | `INSUFFICIENT_CREDIT`/`TASK_LIMIT`/`ACCOUNT_LOCKED`/`PAUSED`/`CONSENT_REQUIRED` | Thông báo tiếng Việt tương ứng | N/A |
| Tiến trình | `queued`/`running` | `TaskProgressCard`, vị trí hàng đợi, hủy khi `queued` | N/A |
| Thất bại | `NO_POSE`, `NO_FACE`, mã khác | Thông báo riêng pipeline Motion / chung, nêu hoàn credit | N/A |
| Kết quả video | `mediaType:'video'` | Trình phát có `posterUrl`, Tải về/Chia sẻ/Ngừng chia sẻ, không so sánh trước/sau | Hết hạn lưu: thông báo hết hạn |
| Chia sẻ công khai | `info.mediaType = video` | Trình phát + `og:image` poster, `og:video` | 404/429: như ảnh |
| Lịch sử | Task video | Thẻ có ảnh bìa và độ dài | Không có bìa: biểu tượng thay thế |

</frozen-after-approval>

## Code Map

- `apps/web/pages/body-retouch.vue` -- mẫu trang: `usePricingConfig` (`pricing`, `me`, `refreshAll`), `useApiClient`, `canSubmit`, chống bấm đôi (`isSubmitting`), `TaskProgressCard`, banner lỗi/đăng nhập; trang Motion sao theo, thêm `VideoTrimmer` và khối giá.
- `apps/web/pages/` -- thêm trang Motion (route `/motion-control`); `utils/catalog.ts` đã có card `motion-control` (`billingMode: 'per_second'`).
- `apps/web/utils/api-client.ts` -- đã có `confirmVideoUpload`, `getTaskResult`; **thiếu** `createMotionControlTask` (`POST /tasks/motion`, parse `MotionCreateRequestSchema`/`MotionCreateResponseSchema`) và `getShareInfo` (`GET /s/{token}/info`, `ShareInfoResponseSchema`); theo mẫu `createBodyRetouchTask`.
- `apps/web/components/VideoTrimmer.vue`, `utils/video-trim.ts` (5.7) -- phát `change` `{videoKey, trimStart, trimEnd, durationSeconds}`; nhận `capSeconds`, `tierName`; giá không nằm trong component. Thu hẹp theo Cap mới qua `capSeconds` đổi.
- `apps/web/composables/usePricingConfig.ts` -- `currentTier`, `currentTierCapSeconds`, `me.balance`, `refreshAll`.
- `apps/web/components/TaskProgressCard.vue` -- đã có hàng đợi, hủy, tuyên bố "rời trang"; nhận `pipelineLabelVi`; kiểm tra có dòng "Video thường mất vài phút" cho Motion chưa.
- `apps/web/pages/tasks/[id].vue` -- `resultAsync` chỉ ảnh, `handleDownloadImage` tải ảnh theo đuôi ảnh, `BeforeAfterSplitSlider` luôn hiện; `getPipelineRoute` đã trỏ `/motion-control`. Thêm nhánh `mediaType === 'video'` (trình phát, tải MP4, không so sánh).
- `apps/web/components/TaskHistoryCard.vue`, `pages/history.vue`, `pages/tasks/index.vue` -- thẻ chưa có ảnh bìa/độ dài; cần dữ liệu `posterUrl`/`durationSeconds` từ `getTaskResult` hoặc bỏ qua theo thiết kế (kiểm tra nguồn dữ liệu trước khi chọn cách).
- `apps/web/pages/share/[token].vue` -- `HEAD /s/{token}` rồi `<img>`; `og:image` đang trỏ `/s/{token}`; thêm gọi `getShareInfo`, nhánh `<video>`, `og:image` = `/s/{token}/poster`, `og:video` = `/s/{token}`.
- `apps/web/components/FeatureWorkspaceDialog.vue` -- Motion hiện có thanh trượt `selectedSeconds` tối thiểu, không có `createMotionControlTask`; chỉ `face-swap`/`body-retouch` có liên kết "Mở trang riêng" (dòng ~294).
- `apps/web/components/VietQRModal.vue`, `composables/useTopup.ts` -- chỉ dùng ở `pages/pricing.vue`: không dùng ở story này, giữ nguyên.
- `apps/web/test/` -- `video-trimmer.test.mjs` (5.7), `body-retouch*.test.mjs`, `smoke.test.mjs` làm mẫu; ba test đang khẳng định `/motion-control`. Thêm `motion-control.test.mjs`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/utils/api-client.ts` -- `createMotionControlTask`, `getShareInfo` -- gọi hợp đồng 5.1
- [x] `apps/web/pages/<route Motion>.vue` -- trang Motion: ảnh + `VideoTrimmer` + giá + nút Tạo + lỗi + tiến trình -- luồng tạo Task
- [x] `apps/web/pages/tasks/[id].vue` -- nhánh video: trình phát, tải MP4, chia sẻ, bỏ so sánh -- kết quả video
- [x] `apps/web/components/TaskHistoryCard.vue` (+ trang danh sách nếu cần) -- ảnh bìa và độ dài -- lịch sử
- [x] `apps/web/pages/share/[token].vue` -- nhánh video và Open Graph -- chia sẻ công khai
- [x] `apps/web/components/FeatureWorkspaceDialog.vue` / `utils/catalog.ts` -- dialog Motion nhúng `VideoTrimmer` và tạo Task (dùng chung composable với trang) -- điều hướng
- [x] `apps/web/test/motion-control.test.mjs` -- test I/O Matrix bằng client giả và `MOCK_*` -- phủ ranh giới

**Acceptance Criteria:**
- Given trang Motion ở 360 px, when kéo thanh trượt, then giá và số dư còn lại cập nhật ngay và bằng `motionPrice` của contracts.
- Given Task video `succeeded`, when mở kết quả, then có trình phát có ảnh bìa và không có thanh so sánh; Task ảnh không đổi.
- Given `pnpm run lint && pnpm run typecheck && pnpm run build && pnpm --filter @flowvis/web test`, when chạy, then pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `reset()` giữ khóa và Trim cũ nên "Tạo" vẫn bật với đầu vào vô hình | medium | patch | Đọc `reset()`; đã thêm `clearState()` xóa khóa/Trim, bắt lỗi `refreshAll` |
| Dialog không dọn trạng thái Motion (cap kẹt, VideoTrimmer/ImageUploader không remount, thử lại) | medium | patch | Đọc dialog: không gọi reset; đã thêm `resetMotionState()` và `:key` remount |
| Hai nguồn "đã đăng nhập" của dialog lệch nhau; nút không phản ánh `isSubmitting` | medium | patch | Đọc `isAuthenticated` dialog vs composable; đã yêu cầu cả hai |
| "Còn lại sau khi tạo" có thể âm cạnh cảnh báo thiếu credit | low | patch | Đã ẩn khi không đủ credit |
| `isVideoResult` đọc sau await có thể đổi giữa chừng; trang nhảy sang thanh so sánh khi refresh | medium | patch | Đã thêm điều kiện `pipeline === 'motion_control'` |
| Thẻ lịch sử chỉ tải ảnh bìa ở `onMounted` | medium | patch | Đã tải lại theo `[id, status]`, bỏ qua kết quả cũ |
| Trang chia sẻ nuốt lỗi `/info` và coi video là ảnh khi lỗi tạm | medium | patch | Đã thử lại một lần trước khi coi là ảnh |
| Thiếu test hành vi cho dialog, thẻ lịch sử, trang chia sẻ, `reset()` | medium | patch | Đã thêm khối test "hành vi sau review" (a)–(d) |
| Thiếu `og:video:secure_url`, kích thước, Twitter player; tải video bằng blob; poster hết hạn | low | defer | Cải thiện chia sẻ mạng xã hội/tải xuống lớn; làm khi có bản BE thật ở 5.9 |
| Mỗi thẻ video thành công gọi thêm `GET /tasks/{id}/result` (N+1) | low | defer | Spec Design Notes cho phép; đo tải ở 5.9 |
| `useMotionControl` khởi tạo trong mọi dialog; `selectedSeconds` còn sót | low | defer | Tách `MotionWorkspacePanel` khi dọn lại dialog; không gây lỗi |
| Khách chưa đăng nhập thấy uploader trước khi có lời nhắc đăng nhập | low | defer | Cùng hành vi với Face Swap/Body Retouch |
| Thiếu nhãn a11y cho poster/badge; thông điệp tiến trình lặp mọi trạng thái | low | reject | Không gây lỗi; sửa là chỉnh câu chữ |
| Ô cam kết ToS, `VietQRModal` tại chỗ (lệch AC) | false | - | Quyết định của người dùng đã ghi vào khối frozen |

## Design Notes

Nhánh video của `/tasks/[id]` và thẻ lịch sử cần `posterUrl`/`durationSeconds`, chỉ có ở `GET /tasks/{id}/result`; thẻ lịch sử hiện không gọi endpoint này cho từng Task. Chọn cách lấy dữ liệu (gọi lười theo thẻ hiển thị, hoặc chỉ hiện độ dài từ `params` nếu BE trả) thuộc cài đặt; nếu không có dữ liệu thì thẻ dùng biểu tượng `lucide:clapperboard` thay ảnh bìa.

## Verification

**Commands:**
- `pnpm --filter @flowvis/web test` -- expected: pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
