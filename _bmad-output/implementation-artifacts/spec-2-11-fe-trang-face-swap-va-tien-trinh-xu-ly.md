---
title: 'Story 2.11: [FE] Trang Face Swap và tiến trình xử lý'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'oneshot'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng cần thực hiện hoán đổi khuôn mặt (Face Swap) bằng cách tải lên ảnh mặt nguồn và ảnh đích, bấm một nút tạo tác vụ với giá 100 credit lấy từ server, và theo dõi trực tiếp tiến trình xử lý (vị trí hàng đợi, trạng thái queued/running, huỷ tác vụ, xử lý lỗi và hoàn credit tự động theo FR1, FR8, FR15).

**Approach:** Xây dựng trang `/face-swap` và tích hợp vào `FeatureWorkspaceDialog.vue` với hai thành phần `ImageUploader` (ảnh mặt nguồn và ảnh đích), ô cam kết ToS theo FR19, hiển thị giá 100 credit từ `usePricingConfig()`. Khi đủ điều kiện (2 ảnh đã tải, đã cam kết, số dư ≥ 100 credit), cho phép bấm tạo gọi `POST /tasks/face-swap` với cơ chế chống bấm trùng (debounce / submitting state). Xây dựng thành phần theo dõi tiến trình `TaskProgressCard.vue` (có thể tái sử dụng cho Epic 4 và Epic 5) hiển thị vị trí hàng đợi định kỳ kèm nút hủy khi `queued`, trạng thái `running`, thông báo tiếng Việt theo `reasonCode` kèm xác nhận hoàn 100% credit khi `failed`/`timed_out`/`cancelled` (riêng `FREE_WAIT_EXPIRED` có gợi ý thử lại hoặc nạp credit), và chuyển tiếp khi `succeeded`. Bổ sung client API methods trong `apps/web/utils/api-client.ts`, hỗ trợ `mockMode` đầy đủ các trạng thái và tuân thủ Slate Cyber tokens, viewport di động 360px, không sửa file ngoài `apps/web`.

</frozen-after-approval>

## Implementation Notes

- **Client API (`apps/web/utils/api-client.ts`)**:
  - Bổ sung `createFaceSwapTask(body)`, `getTask(id)` và `cancelTask(id)`.
  - Hỗ trợ unwrap payload tự động cho cả dạng bọc `{ data: ... }` lẫn dạng trả về đối tượng `Task` trực tiếp.
  - Xử lý kiểm tra Zod `TaskSchema.parse(...)` đảm bảo tuân thủ chặt chẽ schema hợp đồng `@motion-ai/contracts`.
- **Thành phần `TaskProgressCard.vue`**:
  - Hỗ trợ toàn vẹn 4 trạng thái vòng đời Task: `queued`, `running`, `succeeded`, `failed`/`timed_out`/`cancelled`.
  - Polling trạng thái định kỳ 2500ms, tự dừng khi vào trạng thái kết thúc (terminal state), tự động xóa lỗi chập chờn khi có lượt phản hồi hợp lệ tiếp theo.
  - Cơ chế backoff: sau 30 lần polling (~75 giây), giãn nhịp sang 5000ms để giảm tải băng thông và máy chủ.
  - Hiển thị vị trí hàng đợi `#${queuePosition ?? 1}` và nút Hủy tác vụ khi `queued`.
  - Ẩn nút Hủy khi sang `running`, thay bằng thanh tiến trình nhịp xung điện tử Slate Cyber.
  - Hiển thị thông báo tiếng Việt rõ ràng theo `reasonCode` (`getReasonCodeMessageVi`) và dòng chữ cam kết hoàn trả 100% credit (`localTask.creditCost || 100` CR).
  - Khối gợi ý nâng cấp gói Starter khi gặp mã lỗi `FREE_WAIT_EXPIRED` kèm nút chuyển tới `/pricing`.
- **Trang `apps/web/pages/face-swap.vue`**:
  - Thiết kế mobile-first (360px) chuyển đổi 2 cột trên màn hình rộng, SEO `useHead` đầy đủ tiêu đề và thẻ mô tả.
  - Hai ô tải ảnh riêng biệt (`sourceKey` và `targetKey`) với thành phần `ImageUploader`.
  - Ô cam kết ToS theo FR19 với nội dung chuẩn: `"Tôi xác nhận đủ 18 tuổi, sở hữu quyền hợp pháp đối với cả hai ảnh tải lên, những người trong ảnh đã đồng ý cho xử lý và cam kết tuân thủ Điều khoản dịch vụ (phiên bản 2026-11-01)"`. Tự động bỏ chọn ToS khi thay đổi ảnh nguồn hoặc ảnh đích.
  - Hiển thị đơn giá 100 credit lấy từ `GET /config/pricing`, số dư ví thực tế, cảnh báo số dư không đủ và nút "Nạp thêm Credit" dẫn tới `/pricing`.
  - Kiểm tra trạng thái khách chưa đăng nhập (`!isAuthenticated`), hiển thị banner yêu cầu đăng nhập và nút "Đăng nhập ngay" kích hoạt dialog đăng nhập qua `useAuthDialog`.
  - Chống bấm đúp (double-click lock) khi gửi tạo tác vụ.
- **Tích hợp `apps/web/components/FeatureWorkspaceDialog.vue`**:
  - Hỗ trợ cả 2 uploader riêng biệt khi `feature.id === 'face-swap'`, cam kết ToS chuẩn FR19, chuyển đổi sang `TaskProgressCard` khi có task đang xử lý, và cung cấp nút "Mở trang riêng" chuyển tới `/face-swap`.
  - Hỗ trợ `mockMode` xuyên suốt các thành phần con.
- **Kiểm thử tự động (`apps/web/test/smoke.test.mjs`)**:
  - 5 suite kiểm thử chi tiết kiểm tra API client, SSR render của `TaskProgressCard`, SSR render của `face-swap.vue`, tích hợp `FeatureWorkspaceDialog` và tuân thủ Slate Cyber tokens / min-h 48px / 0 emojis.

## Review Triage Log

- **Finding 1 (Result preview in 2.11)**: Phán quyết: `false` — Việc lấy ảnh kết quả qua URL ký `GET /tasks/{id}/result` và hiển thị trên Before/After slider thuộc phạm vi chi tiết của Story 2.12. Story 2.11 AC tập trung vào trạng thái hoàn tất và điều hướng.
- **Finding 2 (Guest user balance check in face-swap.vue)**: Phán quyết: `true` — Đã khắc phục bằng cách bổ sung kiểm tra `isAuthenticated`, vô hiệu hóa nút submit và hiển thị banner `guest-login-notice` kèm nút mở modal đăng nhập qua `openAuthDialog('login')`.
- **Finding 3 (Clear actionErrorVi in TaskProgressCard)**: Phán quyết: `true` — Đã bổ sung `actionErrorVi.value = null` trong `fetchLatestStatus()` khi nhận phản hồi thành công.
- **Finding 4 & 5 (Fallbacks for queuePosition & creditCost)**: Phán quyết: `true` — Đã bổ sung fallback `localTask.queuePosition ?? 1` và `localTask.creditCost || 100`.
- **Finding 9 & 10 (FR19 ToS wording & mockMode in FeatureWorkspaceDialog)**: Phán quyết: `true` — Đã bổ sung cụm từ `"những người trong ảnh đã đồng ý cho xử lý"` và prop `mockMode` chuyển tiếp cho các thành phần con.
- **Finding 13 (SEO meta useHead)**: Phán quyết: `true` — Đã bổ sung `useHead` tiêu đề và meta description chuẩn nhận diện trong `pages/face-swap.vue`.
- **Finding 14 (Polling backoff)**: Phán quyết: `true` — Đã bổ sung chuyển đổi nhịp polling từ 2.5s sang 5s sau 30 lần thăm dò liên tục.
