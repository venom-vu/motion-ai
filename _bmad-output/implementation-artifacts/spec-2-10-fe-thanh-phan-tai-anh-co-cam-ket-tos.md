---
title: 'Story 2.10: [FE] Thành phần tải ảnh có cam kết ToS'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'oneshot'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Giao diện người dùng chưa có thành phần tải ảnh dùng chung cho các pipeline AI (Face Swap, Body Retouch, Motion Control) hỗ trợ chọn ảnh từ camera/thư viện di động, kiểm tra kích thước/tỷ lệ phía client, theo dõi tiến trình tải lên và cam kết ToS bắt buộc cho mỗi lần tải mới theo FR19.

**Approach:** Dựng component `ImageUploader.vue` trong `apps/web/components/` kèm các phương thức tải lên trong `apps/web/utils/api-client.ts`. Thành phần hỗ trợ mở camera hoặc thư viện, kiểm tra client-side bằng `ImageMetaSchema` từ `@motion-ai/contracts` (JPG/PNG/WebP, ≤ 10 MB, cạnh ngắn ≥ 512 px, tỷ lệ 1:2–2:1) với thông báo tiếng Việt, hiển thị thanh tiến trình tải có nút hủy (`AbortController`) và nút thử lại khi lỗi, gọi luồng `POST /uploads` → presigned PUT → `confirm`. Tích hợp ô cam kết ToS (phiên bản `TOS_VERSION`) tự động bỏ tích mỗi khi đổi/tải ảnh mới theo FR19, hiển thị xem trước kèm nút đổi ảnh, và cập nhật `FeatureWorkspaceDialog.vue` dùng thành phần mới mà không sửa file ngoài `apps/web`.

</frozen-after-approval>

## Implementation Notes

- Tạo component `apps/web/components/ImageUploader.vue` hỗ trợ tải ảnh từ thư viện/camera, kiểm tra kích thước client-side, thanh tiến trình tải lên (kèm thuộc tính ARIA `role="progressbar"`), xem trước ảnh, nút đổi ảnh, và checkbox cam kết ToS tự động reset khi chọn ảnh mới theo FR19.
- Thêm tiện ích `apps/web/utils/image-upload.ts` gồm `validateImageFile`, `getImageDimensions`, `normalizeImageMimeType` và `formatFileSizeVi`.
- Bổ sung các phương thức `createUpload`, `confirmUpload` và hàm `uploadPresignedFile` vào `apps/web/utils/api-client.ts` hỗ trợ tải trực tiếp lên URL ký, đo tiến trình và hủy bằng `AbortSignal`.
- Cập nhật `FeatureWorkspaceDialog.vue` tích hợp `ImageUploader`, kiểm soát nút submit theo `canSubmit` (đòi hỏi đủ số dư credit, đã tải ảnh thành công và đã tích xác nhận ToS).
- Bổ sung 6 test cases mới trong `apps/web/test/smoke.test.mjs` kiểm tra validation, client API, upload/abort, SSR render của các trạng thái và MIME normalization.

## Review Triage Log

- finding 1 (spec Implementation Notes để trống): verdict `false` — đã được hoàn thiện đầy đủ tại bước Finalize Spec theo quy trình step-oneshot.
- finding 2 (`ImageUploader.vue` thiếu watcher cho `props.modelValue`): verdict `medium` -> `patch` — đã bổ sung watcher đồng bộ trạng thái khi component cha reset hoặc thay đổi modelValue.
- finding 3 (`ImageUploader.vue` chưa áp dụng `disabled` cho toàn bộ tương tác): verdict `low` -> `patch` — đã gắn disabled cho checkbox ToS, nút đổi ảnh và xóa ảnh.
- finding 4 (`ImageUploader.vue` thiếu liên kết xem Điều khoản Dịch vụ): verdict `false` — MVP chưa có route `/terms` riêng, văn bản dẫn trực tiếp phiên bản ToS tương tự `LoginConsentForm.vue`.
- finding 5 (`ImageUploader.vue` xóa ảnh đã tải quá sớm khi bấm "Đổi ảnh"): verdict `medium` -> `patch` — đã chuyển sang mở trực tiếp file picker mà không xóa ảnh trước; chỉ thay thế khi người dùng thực sự chọn file mới.
- finding 6 (`ImageUploader.vue` thiếu thuộc tính ARIA cho thanh tiến trình): verdict `low` -> `patch` — đã thêm `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"` và `aria-label`.
- finding 7 (`ImageUploader.vue` thiếu nút chụp ảnh bằng camera ở màn hình lỗi): verdict `low` -> `patch` — đã bổ sung nút chụp ảnh `openCamera` cạnh nút chọn từ thư viện.
- finding 8 (`ImageUploader.vue` cho phép tương tác checkbox ToS khi lỗi hoặc đang kiểm tra): verdict `low` -> `patch` — vô hiệu hóa checkbox khi `disabled || isUploading`.
- finding 9 (`ImageUploader.vue` biến `mockTimer` chưa được gán): verdict `low` -> `patch` — đã gán `mockTimer = interval` và dọn dẹp khi hủy.
- finding 10 (`ImageUploader.vue` không phát sự kiện `change` khi bắt đầu chọn ảnh mới): verdict `low` -> `patch` — đã emit `change` với giá trị rỗng khi bắt đầu chọn file mới.
- finding 11 (`api-client.ts` thông báo lỗi mạng/HTTP bằng tiếng Anh trong `uploadPresignedFile`): verdict `medium` -> `patch` — đã Việt hóa toàn bộ thông báo lỗi thân thiện.
- finding 12 (`api-client.ts` thiếu tham số `AbortSignal` trong `createUpload` và `confirmUpload`): verdict `low` -> `patch` — đã thêm tùy chọn `signal` chuyển tiếp tới request.
- finding 13 (`image-upload.ts` thiếu cơ chế chuẩn hóa MIME từ đuôi tệp): verdict `medium` -> `patch` — đã thêm hàm `normalizeImageMimeType` xử lý MIME rỗng/không chuẩn trên mobile.
- finding 14 (`FeatureWorkspaceDialog.vue` chưa chặn bấm nhiều lần khi `submitting`): verdict `false` — Story 2.10 tập trung vào thành phần tải ảnh; luồng submitting tác vụ sẽ hoàn thiện ở Story 2.11.
- finding 15 (`FeatureWorkspaceDialog.vue` tồn tại mã thừa `mockUploadState`): verdict `low` -> `patch` — đã dọn sạch `mockUploadState` và chuyển `canSubmit` sang kiểm tra trực tiếp `uploadedKey` và `acceptedConsent`.
- finding 16 (`smoke.test.mjs` thiếu kiểm tra ARIA và MIME normalization): verdict `low` -> `patch` — đã bổ sung test case cho ARIA progress bar, error state buttons và `normalizeImageMimeType`.
