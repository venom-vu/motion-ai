---
title: 'Story 2.9: [BE] Chia sẻ kết quả bằng token'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'oneshot'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng chưa có cách đăng kết quả lên mạng xã hội mà không công khai file riêng tư trên R2.

**Approach:** Module `storage` (chủ sở hữu `share_tokens`, AD-1) thêm `ShareService`: `POST/DELETE /tasks/{id}/share` cho chủ Task `succeeded`, và `GET /s/<token>` công khai chuyển hướng 302 tới URL ký ngắn hạn của `out/`. Token ngẫu nhiên 32 byte base64url, chỉ lưu SHA-256; mỗi Task tối đa một token hiệu lực (unique một phần); `GET /s` dùng `AuthThrottlerGuard` (429 `RATE_LIMITED`).

</frozen-after-approval>

## Implementation Notes

- Migration `20261106010000_share_tokens` + model `ShareToken`; `AuthModule` export `AuthThrottlerGuard`.
- Tạo lại token thu hồi token cũ trong cùng transaction. Người không phải chủ nhận 404 (không lộ sự tồn tại); Task chưa `succeeded` nhận 409.
- `GET /s` trả 404 chung cho token sai định dạng, không tồn tại, đã thu hồi, Task không còn `succeeded` hoặc file `out/` đã bị xóa (`head` rỗng).
- `shareUrl` dựng từ `API_PUBLIC_URL` (mặc định `http://localhost:<PORT>`); biến này cần khai báo khi triển khai.
- Test: `apps/api/test/share.test.mjs` (PostgreSQL/Redis thật, kho R2 giả).
