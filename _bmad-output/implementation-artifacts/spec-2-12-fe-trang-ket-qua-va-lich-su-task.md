---
title: 'Story 2.12: [FE] Trang kết quả và lịch sử Task'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng sau khi tạo tác vụ thành công cần xem kết quả trực quan (so sánh Trước/Sau với ảnh gốc bằng thanh trượt Before/After), tải ảnh HD về máy, chia sẻ ra ngoài hoặc thu hồi chia sẻ, và xem lại toàn bộ lịch sử các tác vụ đã thực hiện với khả năng hủy tác vụ đang chờ trong hàng đợi và thông báo khi ảnh hết hạn lưu 30 ngày theo FR2 và NFR6.

**Approach:** Xây dựng trang `/tasks` (Lịch sử tác vụ với phân trang cuộn/tải thêm, trạng thái tiếng Việt, giờ Việt Nam, nút hủy cho tác vụ `queued`, trạng thái rỗng và lỗi) và trang kết quả `/tasks/[id]` hiển thị thành phần so sánh Trước/Sau `BeforeAfterSplitSlider.vue` (núm trượt 36px với icon vector `lucide:arrow-left-right`, hỗ trợ thao tác kéo vuốt và phím mũi tên bàn phím, tự động chuyển về chế độ hiển thị đơn khi `sourceUrl` rỗng hoặc quá 7 ngày). Tích hợp các nút hành động: Tải ảnh HD (`lucide:download`), Chia sẻ gọi `POST /tasks/{id}/share` mở Web Share API hoặc sao chép link (`lucide:link`), Ngừng chia sẻ gọi `DELETE /tasks/{id}/share`, và tự động lấy lại URL ký mới khi URL hết hạn hoặc tải ảnh lỗi. Xử lý hiển thị thông báo kết quả đã hết hạn lưu khi tuổi tác vụ vượt quá 30 ngày. Bổ sung endpoint `GET /tasks` trong backend API (`apps/api`) phục vụ danh sách phân trang con trỏ, cập nhật client API methods (`listTasks`, `getTaskResult`, `shareTask`, `revokeTaskShare`) trong `apps/web/utils/api-client.ts`, kết nối nút "Xem kết quả" từ `TaskProgressCard.vue` và cập nhật các liên kết điều hướng đồng bộ.

</frozen-after-approval>

## Implementation Notes

- **Backend API (`apps/api`):**
  - Đã bổ sung endpoint `GET /tasks` trong `TasksController` với xác thực JWT và kiểm tra query params qua `TaskListQuerySchema`.
  - `TasksService.list`: Truy vấn danh sách Task của người dùng hiện tại theo thứ tự `createdAt DESC, id DESC`, hỗ trợ cursor pagination. Bổ sung kiểm tra định dạng UUID cho cursor và xử lý lỗi P2025 ném `400 VALIDATION_FAILED`. Tính toán `queuePosition` cho các task đang `queued`.
  - Bổ sung unit/integration tests trong `apps/api/test/tasks.test.mjs` bao phủ trường hợp chưa xác thực (401), phân trang cursor, cô lập dữ liệu theo user, và kiểm tra cursor không hợp lệ (400).
- **Web API Client (`apps/web/utils/api-client.ts`):**
  - Khai báo schema và hàm API: `listTasks`, `getTaskResult`, `shareTask`, `revokeTaskShare`.
- **Thành phần giao diện & trang (`apps/web`):**
  - `BeforeAfterSplitSlider.vue`: Thành phần so sánh Before/After chuẩn Slate Cyber, núm trượt 36px (`lucide:arrow-left-right`), vùng chạm 48px, hỗ trợ con trỏ chuột, cảm ứng pointer capture, phím điều hướng (ArrowLeft, ArrowRight, Home, End), nhãn tách biệt không bị che khuất bởi clip-path khi trượt 0% hoặc 100%, và fallback về chế độ hiển thị 1 ảnh khi `sourceUrl` rỗng hoặc quá 7 ngày.
  - `TaskHistoryCard.vue`: Card hiển thị từng tác vụ với badge trạng thái tiếng Việt, định dạng giờ Việt Nam `vi-VN`, nút hủy tác vụ `queued`, nút xem tiến trình cho `running`, nút xem kết quả cho `succeeded`, và badge cảnh báo hết hạn lưu 30 ngày.
  - `pages/tasks/index.vue`: Trang lịch sử `/tasks` hỗ trợ phân trang con trỏ, tự động tải thêm với IntersectionObserver, xử lý hủy tác vụ kèm hoàn trả credit và đồng bộ số dư credit trên Header.
  - `pages/tasks/[id].vue`: Trang kết quả `/tasks/:id` hiển thị slider Before/After, nút tải ảnh HD (fetch blob tải trực tiếp không mở tab mới), chia sẻ qua Web Share API hoặc clipboard an toàn, tự động thử lại khi URL ký hết hạn (có giới hạn số lần), và hiển thị view cảnh báo khi tác vụ đã quá 30 ngày.
  - Cập nhật nút "Xem Kết Quả" trong `TaskProgressCard.vue` dẫn đến `/tasks/:id` và cập nhật liên kết trong `AccountPopover.vue` phân biệt rõ "Lịch sử tác vụ" và "Biến động credit".
  - Kiểm thử smoke test `apps/web/test/smoke.test.mjs` với 5 bộ test cho Story 2.12 đạt 100% pass, tuân thủ token Slate Cyber và zero emoji UI chrome.

## Review Triage Log

- Finding 1 (Invalid cursor UUID throws 500 in `TasksService.list`): `patch` — Đã thêm kiểm tra regex UUID và bắt lỗi Prisma P2025 ném `400 VALIDATION_FAILED` kèm unit test trong `tasks.test.mjs`.
- Finding 2 (Presigned URL image error retry infinite loop): `patch` — Đã thêm bộ đếm `imageRefreshAttempts` giới hạn số lần thử lại tối đa 1 lần trong `pages/tasks/[id].vue`.
- Finding 3 (Hydration flash of unauthenticated state): `patch` — Đã kiểm tra `import.meta.server` và `sessionChecked` trong `isUnauthenticated` để loại bỏ flash hydration.
- Finding 4 (Parallel SSR execution leaves `resultAsync` null): `patch` — Đã bổ sung fallback lấy `taskAsync.data.value` trong fetcher `resultAsync`.
- Finding 5 (Cross-origin image download redirection): `patch` — Đã nâng cấp `handleDownloadImage` ưu tiên fetch blob và tạo object URL trước khi fallback về anchor click.
- Finding 6 (Tag occlusion in `BeforeAfterSplitSlider.vue`): `patch` — Đã chuyển các nhãn `tag-before` và `tag-after` vào lớp overlay riêng biệt phía trên không bị cắt bởi clip-path.
- Finding 7 (Slider knob sizing and prop reactivity): `patch` — Đã cập nhật kích thước núm tròn 36px (`w-9 h-9`) với vùng chạm 48px và bổ sung `watch` trên `initialPosition`.
- Finding 8 (Header balance out-of-sync after cancelling task): `patch` — Đã thêm `refreshNuxtData(ME_KEY)` trong `handleCancelTask` trên `/tasks`.
- Finding 9 (Ambiguous labels in `AccountPopover.vue`): `patch` — Đã đổi nhãn menu link `/history` thành "Biến động credit" để tách biệt với "Lịch sử tác vụ".
- Finding 10 (Card navigation for queued/running/failed tasks): `patch` — Đã cho phép nhấp vào tên tác vụ để xem chi tiết `/tasks/:id` và bổ sung nút "Xem tiến trình" cho task đang `running`.
- Finding 11 (Clipboard API rejection in non-secure or iframe contexts): `patch` — Đã bọc `navigator.clipboard.writeText` trong try/catch hiển thị URL dự phòng an toàn.
- Finding 12 (Hardcoded Mock URLs in SSR tests): `reject (low)` — Mock URL chỉ phục vụ smoke test và mock query mode, không ảnh hưởng runtime môi trường thực.
- Finding 13 (Missing loading spinner state for image HD download): `reject (low)` — Thời gian fetch blob diễn ra nhanh chóng, biến `isDownloading` đã khóa tránh duplicate click.
- Finding 14 (Window history length navigation edge-case): `reject (low)` — Hàm `handleGoBack` đã có fallback điều hướng về `/tasks` khi không có lịch sử trình duyệt.

### Review Findings

- [x] [Review][Patch] Dò tìm và cách ly cursor đa tenant trong TasksService.list [apps/api/src/modules/tasks/tasks.service.ts:150]
- [x] [Review][Patch] Tự động gắn IntersectionObserver khi sentinelRef xuất hiện trong DOM [apps/web/pages/tasks/index.vue:240]
- [x] [Review][Patch] Sửa flash trạng thái chưa đăng nhập khi người dùng có 0 tác vụ [apps/web/pages/tasks/index.vue:160]
- [x] [Review][Patch] Bọc try/catch cho navigator.clipboard.writeText trong handleCopyShareLink [apps/web/pages/tasks/[id].vue:300]
- [x] [Review][Patch] Chuẩn hóa kích thước núm trượt 36px với lớp bọc vùng chạm 48px [apps/web/components/BeforeAfterSplitSlider.vue:220]
- [x] [Review][Patch] Bổ sung chỉ dẫn ảnh gốc hết hạn lưu 7 ngày trong chế độ 1 ảnh [apps/web/components/BeforeAfterSplitSlider.vue:145]
- [x] [Review][Patch] Làm mới URL ký khi tải ảnh thất bại thay vì mở tab lỗi XML trực tiếp [apps/web/pages/tasks/[id].vue:205]
- [x] [Review][Patch] Bổ sung SSR render assertions cho pages/tasks/index.vue trong smoke test [apps/web/test/smoke.test.mjs:2867]
- [x] [Review][Patch] Kiểm tra thuộc tính href và nhãn 'Xem Kết Quả' của TaskProgressCard [apps/web/test/smoke.test.mjs:2355]
- [x] [Review][Patch] Thêm kiểm tra event.button === 0 khi bắt đầu kéo thanh trượt [apps/web/components/BeforeAfterSplitSlider.vue:50]
- [x] [Review][Patch] Đổi touchAction thành 'pan-y' trên khung ảnh để không chặn cuộn dọc trang [apps/web/components/BeforeAfterSplitSlider.vue:130]
- [x] [Review][Patch] Bổ sung nhãn tiếng Việt cho pipeline body_retouch và motion_control [apps/web/utils/task-format.ts:20]
- [x] [Review][Defer] Điều hướng mobile bottom nav tab 'Lịch sử' trỏ về /history thay vì /tasks [apps/web/components/AppBottomNav.vue:18] — deferred: pre-existing navigation design decision across Epics 1 & 2

#### Rejected
- N+1 query queuePosition trong `TasksService.list`: `reject (low)` — `MAX_ACTIVE_TASKS_PER_USER = 3` nên tối đa 3 truy vấn COUNT cực nhanh, không gây nghẽn.
- Thiếu xác nhận trước khi hủy tác vụ: `reject (low)` — Hành vi hủy tức thời và hoàn tiền 100% đúng theo đặc tả nghiệp vụ, không có yêu cầu modal.

