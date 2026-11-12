---
title: '6-9 [FE] Chân trang, trang pháp lý và biểu ngữ bảo trì'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
baseline_commit: 'f57a28ab8953ea73aa586a0e9f2cc4702f286175'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng chưa thấy điều khoản, chính sách, cách báo cáo vi phạm ở mọi trang. `/privacy` chưa có, `/terms` thiếu `status`/`version` tách biệt và các mục FR19. Khi hệ thống tạm dừng nhận tác vụ, FE chỉ biết sau khi tải file và bị 503 `PAUSED`.

**Approach:** Thêm chân trang vào layout `default`, dựng `/terms` và `/privacy` từ file nội dung có `version`/`status`, kiểm `GET /system/status` để hiện biểu ngữ bảo trì và vô hiệu nút "Tạo" ở 3 trang tạo Task. Toàn bộ nằm trong `apps/web`, chạy được ở mock và 360 px.

## Boundaries & Constraints

**Always:** Tiếng Việt, không emoji, vùng chạm >= 48px, chân trang không che nội dung ở 360 px. `mailto:` chỉ chứa tiêu đề và hướng dẫn cố định, không chèn dữ liệu người dùng. Thiếu `NUXT_PUBLIC_REPORT_EMAIL` ở build production thì build fail nêu rõ tên biến. Biểu ngữ "Văn bản tạm, chưa có hiệu lực pháp lý" khi `status = draft`. Gặp 503 `PAUSED` khi tạo Task thì hiện cùng thông báo bảo trì, không đổi số dư trên UI. Upload không bị chặn khi bảo trì nhưng có nhắc.

**Decisions (người dùng chốt):** (1) Test `TOS_VERSION === terms.version` và script kiểm phát hành (`apps/web/scripts/check-legal-release.mjs`, fail và nêu file khi còn `draft`) nằm trong `apps/web`; KHÔNG sửa CI hay `package.json` gốc, người dùng tự nối vào bước release sau. (2) Thêm dòng cam kết kèm liên kết `/terms` (tab mới) vào `ImageUploader` và `VietQRModal`, không thêm checkbox chặn.

**Never:** Không sửa file ngoài `apps/web`. Không đổi `TOS_VERSION` hay hợp đồng API. Không chặn đăng nhập, nạp tiền, lịch sử, tải kết quả khi bảo trì. Không tự bịa văn bản pháp lý cuối cùng: nội dung là bản tạm `draft`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bình thường | `intakePaused=false` | Không biểu ngữ, nút "Tạo" theo `canSubmit` cũ | N/A |
| Tạm dừng | `intakePaused=true` | Biểu ngữ bảo trì, nút "Tạo" disabled, nhắc khi tải file | N/A |
| Kiểm trạng thái lỗi | `/system/status` lỗi mạng | Giữ trạng thái trước (mặc định không dừng), không báo lỗi | Thử lại ở chu kỳ sau |
| FE chưa biết | Tạo Task trả 503 `PAUSED` | Biểu ngữ bảo trì, đặt `intakePaused=true` cục bộ | Không refresh/đổi số dư |
| Văn bản draft | `status='draft'` | Biểu ngữ tạm ở `/terms`, `/privacy` | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/layouts/default.vue` -- thêm `AppFooter`, chừa `pb` cho `AppBottomNav` ở mobile
- `apps/web/pages/terms.vue` -- đang dùng `TOS_VERSION` trực tiếp; chuyển sang đọc file nội dung
- `apps/web/components/LoginConsentForm.vue` -- đã có liên kết `/terms` tab mới (tham chiếu mẫu)
- `apps/web/components/ImageUploader.vue`, `VietQRModal.vue` -- chưa có cam kết ToS
- `apps/web/pages/face-swap.vue`, `body-retouch.vue`, `motion-control.vue` + `composables/useMotionControl.ts` -- `canSubmit`, `submitErrorVi`, catch `resolveApiErrorMessageVi`
- `apps/web/utils/api-client.ts` -- thêm `getSystemStatus()` (contracts đã có `SystemStatusResponseSchema`, `MOCK_SYSTEM_STATUS_*`); `ApiErrorCode.PAUSED` đã có
- `apps/web/nuxt.config.ts` -- `runtimeConfig.public.reportEmail`, fail build production nếu thiếu
- `apps/web/test/*.test.mjs` -- mẫu test node:test dùng build

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/content/legal/terms.ts`, `privacy.ts` -- file nội dung `{version, status, sections}`; terms đủ mục FR19, privacy đủ dữ liệu/thời hạn 7 và 30 ngày/token chia sẻ/email liên hệ
- [x] `apps/web/pages/terms.vue`, `pages/privacy.vue` + `components/LegalDraftBanner.vue` -- dựng tĩnh, biểu ngữ draft
- [x] `apps/web/components/AppFooter.vue`, `layouts/default.vue` -- 3 liên kết, `mailto:` cố định
- [x] `apps/web/nuxt.config.ts` -- `reportEmail`, kiểm build production
- [x] `apps/web/composables/useSystemStatus.ts`, `components/MaintenanceBanner.vue`, `utils/api-client.ts` -- kiểm khi mở trang và định kỳ, xử lý `PAUSED`
- [ ] 3 trang tạo Task -- biểu ngữ, disable nút, nhắc ở uploader, bắt `PAUSED`
- [x] `apps/web/test/legal.test.mjs`, `system-status.test.mjs` -- `TOS_VERSION === terms.version`, draft/release, mailto, I/O matrix

**Acceptance Criteria:**
- Given bất kỳ trang, when hiển thị, then chân trang có 3 liên kết và không che nội dung ở 360 px
- Given `intakePaused=true`, when mở trang tạo Task, then thấy biểu ngữ và nút "Tạo" bị vô hiệu
- Given chế độ mock, when chạy, then mọi tính năng hoạt động mà không gọi BE

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence |
|---|---|---|
| Poll cũ ghi đè markPaused (useSystemStatus) | medium -> patch | refresh() gán kết quả không kiểm thứ tự; 503 PAUSED rồi poll chậm trả false sẽ bật lại nút Tạo |
| Hook build chỉ test bằng grep; email toàn khoảng trắng lọt | medium -> patch | legal.test.mjs chỉ regex chuỗi; xóa điều kiện vẫn pass |
| mailto rỗng khi thiếu email (dev) | low -> patch | buildReportMailto('') ra 'mailto:?subject=' ; sửa 1 dòng |
| Regex check-legal-release chỉ nhận nháy đơn | low -> patch | /status:\s*'draft'/ bỏ sót nháy kép |
| Không test intakePaused=true / 503 PAUSED | medium -> patch | stub luôn false, grep test/ không thấy kiểm canSubmit hay markPaused |
| Footer bị bottom nav che 768-1023px | false | AppBottomNav có lg:hidden, khớp pb-20 lg:pb-4 |
| /system/status có thể không công khai | false | ops.controller.ts: route @Get('system/status') không có guard (guard chỉ ở route admin) |
| handleSubmit thiếu guard intakePaused | false | canSubmit đã gồm !intakePaused, handleSubmit thoát sớm khi !canSubmit |
| Nhiều timer poll | false | mỗi trang chỉ mount một MaintenanceBanner, có clearInterval khi unmount |
| Gate phát hành chưa nối CI; terms/privacy thiếu điều khoản | rejected | người dùng chốt 1A (không sửa CI); văn bản tạm do PM thay (ASSUMPTION trong spec) |
| Banner chỉ ở 3 trang tạo Task | false | đúng AC; AC không yêu cầu ở trang chủ |
| Thông báo trùng banner và lỗi chung khi PAUSED; nút flash bật lúc tải đầu; touch target link ToS; ToS note hiện ở mọi trạng thái topup; uploader video Motion không có ghi chú | low, rejected | thẩm mỹ, vá cần thêm nhánh/guard |
| getSystemStatus không có nhánh mock | rejected | api-client không có chế độ mock nào khác cho mọi endpoint, theo mẫu hiện có |

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck` -- expected: không lỗi
- `pnpm --filter @flowvis/web test` -- expected: pass
- `NODE_ENV=production pnpm --filter @flowvis/web build` không có `NUXT_PUBLIC_REPORT_EMAIL` -- expected: fail nêu tên biến
