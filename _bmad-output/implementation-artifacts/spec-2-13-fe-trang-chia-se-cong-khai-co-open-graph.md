---
title: 'Story 2.13: [FE] Trang chia sẻ công khai có Open Graph'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng khi nhận được đường dẫn chia sẻ kết quả từ mạng xã hội hoặc bạn bè cần có một trang công khai để xem nhanh ảnh tác phẩm AI mà không cần đăng nhập, có đầy đủ thẻ Open Graph để hiển thị bản xem trước đẹp trên mạng xã hội (Facebook, Zalo, X/Twitter), và có nút kêu gọi dùng thử ("Thử tạo ảnh AI miễn phí") dẫn về trang ứng dụng mà hoàn toàn không để lộ thông tin riêng tư của chủ tác vụ.

**Approach:** Xây dựng trang Nuxt SSR `/share/[token]` (`apps/web/pages/share/[token].vue`) cấu hình `useSeoMeta`/`useHead` sinh các thẻ `og:title`, `og:description`, `og:image` (trỏ trực tiếp tới API `GET /s/<token>` để crawler mạng xã hội luôn thấy URL ổn định), `og:url` và thẻ Twitter Card. Trang hỗ trợ xác thực và hiển thị ảnh kết quả (tối ưu hiển thị responsive trên màn hình 360 px không bị cuộn ngang, nút mở xem ảnh gốc hoặc tải về, nút CTA "Thử tạo ảnh AI miễn phí" điều hướng về `/`). Khi token không tồn tại hoặc đã bị thu hồi, trang thiết lập mã phản hồi HTTP 404 qua `setResponseStatus(404)` và hiển thị giao diện thông báo "Liên kết không còn tồn tại" kèm nút quay về trang chủ. Tương thích preset Nitro Cloudflare Pages và hỗ trợ chế độ kiểm thử mock.

</frozen-after-approval>

## Implementation Notes

- Xây dựng trang `apps/web/pages/share/[token].vue`:
  - Trích xuất `token` từ `useRoute().params.token`.
  - Hỗ trợ chế độ mock: khi `route.query.mock` tồn tại hoặc token là mock token, trả dữ liệu mock hợp lệ; nếu `mock === '404'` hoặc token không hợp lệ trả trạng thái 404.
  - Chế độ live: SSR fetch kiểm tra `GET /s/<token>` từ API backend (`NUXT_PUBLIC_API_BASE_URL` hoặc cấu hình runtime) bằng phương thức `HEAD` kết hợp `redirect: 'manual'` để xác định tính hợp lệ của token mà không tự động chuyển hướng sang presigned URL của R2.
  - Phân định rõ trạng thái không tìm thấy (404 / token sai định dạng) và trạng thái bị giới hạn tần suất (429 `RATE_LIMITED` từ `ShareThrottlerGuard`).
  - Khi token không tồn tại hoặc đã thu hồi, gọi `setResponseStatus(event, 404, 'Not Found')` trong SSR, hiển thị giao diện thông báo "Liên kết không còn tồn tại", bổ sung `<meta name="robots" content="noindex, nofollow">` và lược bỏ thẻ `og:image`.
  - Thẻ Open Graph SSR: `og:site_name: 'flowvis'`, `og:type: 'website'`, `og:title`, `og:description`, `og:image` (trỏ tới `${apiBaseUrl}/s/${token}`), `og:url` (sử dụng `useRequestURL().origin`), `twitter:card: 'summary_large_image'`.
  - Giao diện Slate Cyber chuẩn mực: tông màu `cyber-surface`, `cyber-bg`, `cyber-border`, `cyber-cyan`, `cyber-text`, `cyber-muted`, zero emoji trong UI chrome, vùng chạm tối thiểu 48px, không lộ bất kỳ thông tin nào của chủ Task. Nút CTA điều hướng về trang chủ studio `/`.
  - Hỗ trợ tải ảnh HD (fetch blob kiểm tra `res.ok` trước khi tải), sao chép liên kết chia sẻ (tích hợp Web Share API và clipboard với thông báo tự động ẩn sau 3 giây, hỗ trợ `role="status"` và `aria-live="polite"`).
- Cập nhật trang `apps/web/pages/tasks/[id].vue`: bảo đảm `handleShare()` truyền đúng `webShareUrl` (`${window.location.origin}/share/${res.token}`) cho cả `navigator.share()` và clipboard, đồng thời dùng tên pipeline động tiếng Việt.
- Bổ sung bộ kiểm thử tự động trong `apps/web/test/smoke.test.mjs` bao phủ SSR render trạng thái thành công, trạng thái 404, trạng thái 429, thẻ Open Graph, responsive 360 px, Slate Cyber tokens và zero emoji UI chrome.

## Review Triage Log

- Finding 1 (handleShare passed backend URL instead of webShareUrl): `patch` — Đã cập nhật `handleShare()` trong `apps/web/pages/tasks/[id].vue` truyền `webShareUrl` cho `navigator.share()` và clipboard.
- Finding 2 (Hardcoded face swap text in handleShare): `patch` — Đã dùng `getPipelineLabelVi(currentTask.value?.pipeline)` để mô tả động theo pipeline tác vụ.
- Finding 3 ($fetch.raw HEAD followed 302 into R2 presigned GET causing 403 SignatureDoesNotMatch): `patch` — Đã thêm `redirect: 'manual'` trong `pages/share/[token].vue` để giữ nguyên phản hồi 302 từ API.
- Finding 4 (HTTP 429 rate limit grouped into notFound): `patch` — Đã tách biệt trạng thái `isRateLimited` và thêm giao diện cảnh báo thử lại khi bị giới hạn tần suất.
- Finding 5 (watchEffect skipped when asyncError present): `patch` — Đã cập nhật `watchEffect` xử lý `asyncError.value` đặt `notFound: true`.
- Finding 6 (Missing og:type and og:site_name): `patch` — Đã bổ sung `og:type: 'website'` và `og:site_name: 'flowvis'`.
- Finding 7 (Dead og:image and missing robots: noindex on 404): `patch` — Đã bỏ `og:image` trên 404 và gắn `<meta name="robots" content="noindex, nofollow">`.
- Finding 8 (Hardcoded domain in ogUrl): `patch` — Đã sử dụng `useRequestURL().origin` kết hợp `window.location.origin` linh hoạt cho dev/staging/prod.
- Finding 9 (Missing res.ok check in handleDownload): `patch` — Đã bổ sung kiểm tra `res.ok` trước khi chuyển blob và tải file.
- Finding 10 (Dead import.meta.server in client DOM handleImageError): `patch` — Đã lược bỏ kiểm tra phía server trong handler sự kiện client.
- Finding 11 (Lack of video player for Motion Control in Epic 2): `reject (out-of-scope)` — Epic 2 chỉ giới hạn cho Face Swap ảnh; tính năng video chia sẻ công khai đã được lên lịch riêng tại Story 5.8/5.9 thuộc Epic 5.
- Finding 12 (Use of raw zinc-* instead of Slate Cyber tokens): `patch` — Đã chuẩn hóa toàn bộ giao diện sang hệ token màu Slate Cyber (`cyber-surface`, `cyber-bg`, `cyber-border`, `cyber-cyan`, `cyber-text`, `cyber-muted`).
- Finding 13 (Missing auto-dismiss and accessibility attributes on toast): `patch` — Đã thêm bộ hẹn giờ 3 giây `setTimeout`, dọn dẹp `onBeforeUnmount`, và gắn `role="status"` / `aria-live="polite"`.
- Finding 14 (Collateral mock replacement in old smoke test blocks): `patch` — Đã hoàn tác các thay đổi trên test cũ và viết bài test riêng biệt cho Story 2.13.
