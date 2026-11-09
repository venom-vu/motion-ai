---
name: motion-ai
description: Nền tảng SaaS sáng tạo video chuyển động và hoán đổi khuôn mặt AI 1 chạm trên trình duyệt di động
status: final
sources:
  - /Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/prds/prd-motion-ai-2026-10-31/prd.md
  - /Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/architecture/architecture-motion-ai-2026-11-01/ARCHITECTURE-SPINE.md
  - /Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/epics.md
updated: 2026-11-01
colors:
  bg-base: '#0F172A'
  surface-card: '#1E293B'
  surface-elevated: '#334155'
  border-default: '#334155'
  border-subtle: '#1E293B'
  primary: '#8B5CF6'
  primary-glow: 'rgba(139, 92, 246, 0.4)'
  accent: '#06B6D4'
  accent-glow: 'rgba(6, 182, 212, 0.4)'
  text-primary: '#F8FAFC'
  text-muted: '#94A3B8'
  text-subtle: '#64748B'
  success: '#10B981'
  warning: '#F59E0B'
  error: '#EF4444'
typography:
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  display:
    fontSize: 22px
    fontWeight: '800'
    lineHeight: '1.2'
    letterSpacing: -0.03em
  heading:
    fontSize: 16px
    fontWeight: '700'
    lineHeight: '1.3'
  body:
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  caption:
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 11px
    fontWeight: '700'
icons:
  library: 'lucide'
  integration: 'nuxt-icon'
  strokeWidth: 2
  sizes:
    sm: 14px
    md: 18px
    lg: 22px
    xl: 28px
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  xl: 20px
  2xl: 28px
  full: 9999px
spacing:
  touch-min: 48px
  screen-padding: 16px
  desktop-padding: 36px
  card-padding: 16px
  gap-sm: 8px
  gap-md: 12px
  gap-lg: 16px
  gap-xl: 20px
  header-height: 68px
  workspace-dialog-width: 980px
  admin-sidebar-width: 220px
  admin-max-width: 1360px
breakpoints:
  mobile: 360px
  tablet: 768px
  desktop: 1024px
  wide: 1280px
components:
  button-primary:
    background: 'linear-gradient(135deg, {colors.primary} 0%, {colors.accent} 100%)'
    color: '{colors.text-primary}'
    minHeight: '{spacing.touch-min}'
    radius: '{rounded.lg}'
    shadow: '0 6px 20px -3px {colors.primary-glow}'
    iconSize: '{icons.sizes.md}'
  button-secondary:
    background: '{colors.surface-card}'
    border: '1px solid {colors.border-default}'
    color: '{colors.text-primary}'
    minHeight: '{spacing.touch-min}'
    radius: '{rounded.md}'
    iconSize: '{icons.sizes.md}'
  credit-badge:
    background: 'rgba(6, 182, 212, 0.12)'
    border: '1px solid rgba(6, 182, 212, 0.35)'
    color: '{colors.accent}'
    radius: '{rounded.full}'
    icon: 'lucide:zap'
    iconSize: '{icons.sizes.sm}'
  video-trimmer-handle:
    background: '#FFFFFF'
    width: 6px
    height: 24px
    radius: 3px
  split-slider-divider:
    background: '{colors.accent}'
    width: 2px
    glow: '0 0 10px {colors.accent}'
  split-slider-knob:
    background: '{colors.accent}'
    radius: '{rounded.full}'
    width: 36px
    height: 36px
    icon: 'lucide:arrow-left-right'
    iconColor: '#000000'
---

# flowvis — Design Spine (DESIGN.md)

> Tiêu chuẩn nhận diện thị giác dựa trên đặc tả Google Labs. Quản lý toàn bộ khía cạnh thị giác (*nhìn ra sao*: bảng màu, typography, khoảng cách, icon vector chuẩn Lucide, linh kiện giao diện). Tài liệu này cùng với `EXPERIENCE.md` là hai hợp đồng song hành cao nhất của dự án.

## Brand & Style

**flowvis** mang định hướng phong cách **Sleek Creator Tool kết hợp Dark Studio Accent** (lấy cảm hứng từ sự tiện dụng, tốc độ của CapCut / TikTok Studio kết hợp không gian studio nghệ thuật AI tối tân). 

Sản phẩm được thiết kế ưu tiên tuyệt đối cho môi trường di động (**Mobile-First**), nhắm vào các nhà sáng tạo nội dung mạng xã hội (TikTok, Instagram) và chủ shop thời trang online tại Việt Nam. Trải nghiệm mang tinh thần **1-Click AI** — không đòi hỏi người dùng phải học ComfyUI hay kỹ thuật câu lệnh (prompting) phức tạp: mở web trên điện thoại, chọn ảnh/video, tinh chỉnh trong tầm với ngón cái và bấm tạo.

Không gian thị giác được xây dựng trên nền than chì ánh xanh sâu thẳm ({colors.bg-base}), giúp giảm thiểu tối đa mỏi mắt khi sáng tạo liên tục, đồng thời nâng tầm độ tương phản để làm nổi bật sắc thái da, phom dáng người mẫu và khung hình video render. Các điểm nhấn công nghệ AI mang màu Neon ({colors.primary} & {colors.accent}) tập trung chính xác vào các vùng chạm hành động cốt lõi.

**Quy chuẩn Hệ thống Biểu tượng (Iconography Standard):**
Tuyệt đối **không sử dụng biểu tượng ký tự Unicode UTF-8 / Emoji hệ thống** trong UI Chrome. Toàn bộ icon được chuẩn hóa 100% bằng **vector SVG thông qua `nuxt-icon` kết hợp thư viện `lucide`** (`<Icon name="lucide:..." />`). Điều này loại bỏ hoàn toàn tình trạng icon hiển thị lệch lạc, méo mó giữa iOS, Android và Windows, duy trì vẻ tinh xảo, đồng nhất của một Creative Suite cao cấp.

→ Tham chiếu trực quan: [color-themes.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/color-themes.html), [studio.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/studio.html), [desktop-studio.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/desktop-studio.html), [desktop-vietqr-admin.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/desktop-vietqr-admin.html).

## Colors

Bảng màu **Slate Cyber** được chắt lọc để phục vụ công năng hiển thị nội dung media:

- **Nền chính (Background Base - `{colors.bg-base}`: `#0F172A`):** Tone Slate 900 than chì ánh xanh nhẹ. Tránh dùng màu đen tuyệt đối (#000000) nhằm giảm hiện tượng gắt mắt trên màn hình OLED và tạo chiều sâu không gian khi xếp lớp thẻ.
- **Bề mặt thẻ/khối (Surface/Cards - `{colors.surface-card}`: `#1E293B`):** Nâng 1 bậc sáng so với nền để phân định các vùng chức năng studio, thông số cấu hình và danh mục thẻ.
- **Đường viền & Bề mặt nổi (Elevated/Borders - `{colors.border-default}`: `#334155`):** Phân cách ranh giới linh kiện mỏng sắc sảo 1px, làm khung rãnh trượt cho timeline và thanh cuộn.
- **Màu nhấn hành động chính (Primary CTA - `{colors.primary}`: `#8B5CF6`):** Electric Violet rực rỡ, đại diện cho năng lượng xử lý AI thế hệ mới. Dùng cho nút tạo tác vụ, gradient CTA và trạng thái hoạt động của tab.
- **Màu nhấn thông số & Credit (Accent - `{colors.accent}`: `#06B6D4`):** Neon Cyan tươi sáng, dùng cho nhãn tính giá credit thời gian thực, huy hiệu số dư tài khoản, tay cầm thanh trượt Before/After.
- **Chữ chính (Text Primary - `{colors.text-primary}`: `#F8FAFC`):** Trắng sáng ánh xám, độ tương phản cao vượt chuẩn WCAG AA trên nền tối.
- **Chữ phụ (Text Muted - `{colors.text-muted}`: `#94A3B8`):** Xám trung tính cho mô tả, nhãn phụ, thông số chưa kích hoạt.
- **Trạng thái (Feedback):** Thành công dùng `{colors.success}` (`#10B981`), Cảnh báo/Chờ dùng `{colors.warning}` (`#F59E0B`), Lỗi/Chặn nội dung dùng `{colors.error}` (`#EF4444`).

## Typography & Iconography

Sử dụng hệ phông chữ sans-serif hiện đại (**Inter** kết hợp bộ font hệ thống iOS/Android: `-apple-system, BlinkMacSystemFont, "Segoe UI"`):

- **Display (`{typography.display}`):** 22px, Đậm (Weight 800), Dãn dòng 1.2, Khoảng cách chữ `-0.03em`. Dành riêng cho tiêu đề màn hình chính, tên ứng dụng và tổng số credit nhận được.
- **Heading (`{typography.heading}`):** 16px, Đậm (Weight 700). Tiêu đề các khối công cụ (Face Swap, Body Retouch, Motion Control), tên gói cước.
- **Body (`{typography.body}`):** 14px, Thường (Weight 400). Nội dung hướng dẫn, đoạn văn mô tả điều khoản, nội dung thông báo.
- **Caption (`{typography.caption}`):** 12px, Bán đậm (Weight 500). Nhãn thời gian, đếm ngược chuyển khoản, nhãn Before/After.
- **Mono (`{typography.mono}`):** 11px, Font máy (monospace). Hiển thị mã chuyển khoản `NAP <USER_ID> <ORDER_ID>`, mã hash giao dịch ngân hàng.

### Bảng Định Danh Icon Hệ Thống (Lucide / Nuxt-Icon Map)
Mọi icon dùng thẻ `<Icon name="lucide:NAME" />` với nét vẽ chuẩn `stroke-width: 2`:

| Vai trò / Tính năng | Tên Icon Lucide | Kích thước | Ghi chú vị trí |
|---|---|---|---|
| **Logo / Năng lượng Credit** | `lucide:zap` | `{icons.sizes.md}` (18px) | Header logo, Credit Badge, nút nạp tiền |
| **Studio (Bottom Nav)** | `lucide:wand-2` | `{icons.sizes.md}` (18px) | Tab Studio ở thanh điều hướng đáy |
| **Lịch sử Tác vụ** | `lucide:history` | `{icons.sizes.md}` (18px) | Tab Lịch sử ở thanh điều hướng đáy |
| **Gói cước / Bảng giá** | `lucide:credit-card` | `{icons.sizes.md}` (18px) | Tab Gói cước ở thanh điều hướng đáy |
| **Tài khoản / Cá nhân** | `lucide:user` | `{icons.sizes.md}` (18px) | Tab Tôi ở thanh điều hướng đáy |
| **Tab Ghép mặt** | `lucide:scan-face` | `{icons.sizes.sm}` (14px) | Tab công cụ Face Swap |
| **Tab Chỉnh dáng** | `lucide:sparkles` | `{icons.sizes.sm}` (14px) | Tab công cụ Body Retouch |
| **Tab Chuyển động** | `lucide:clapperboard` | `{icons.sizes.sm}` (14px) | Tab công cụ Motion Control |
| **Tải ảnh / Tải file** | `lucide:upload` | `{icons.sizes.lg}` (22px) | Khung tải ảnh nhân vật, video mẫu |
| **Phát video (Play)** | `lucide:play` | `{icons.sizes.lg}` (22px) | Nút xem video giữa màn hình |
| **Tải về kết quả (HD)** | `lucide:download` | `{icons.sizes.md}` (18px) | Nút CTA Tải ảnh/video HD không watermark |
| **Sao chép liên kết** | `lucide:copy` / `lucide:link` | `{icons.sizes.md}` (18px) | Nút sao chép mã nạp tiền & link chia sẻ |
| **Tạo lại / Đổi kiểu** | `lucide:refresh-cw` | `{icons.sizes.md}` (18px) | Nút render lại ảnh/video |
| **Điều khiển Before/After** | `lucide:arrow-left-right` | `{icons.sizes.sm}` (14px) | Núm trượt chia đôi màn hình |
| **Đồng hồ đếm ngược** | `lucide:clock` | `{icons.sizes.sm}` (14px) | Phiên thanh toán VietQR 15 phút |
| **Cảnh báo thiếu credit** | `lucide:alert-circle` | `{icons.sizes.sm}` (14px) | Khung thông báo thông minh |
| **Đóng modal** | `lucide:x` | `{icons.sizes.md}` (18px) | Nút đóng popup / bottom sheet |
| **Xác nhận / Thành công** | `lucide:check` | `{icons.sizes.sm}` (14px) | Checkbox điều khoản & trạng thái xong |

## Layout & Spacing

Thiết kế đồng bộ 100% mô hình **Kho Thẻ Tính Năng Có Ảnh Minh Họa + Hộp Thoại Làm Việc (`FeatureWorkspaceDialog`)** trên cả **Mobile-First** và **Desktop Adaptive**:

### 1. Mobile & Tablet nhỏ (`< {breakpoints.desktop}` / `360px – 767px`)
- **Chiều rộng chuẩn:** Tối ưu mượt mà từ màn hình tối thiểu `{breakpoints.mobile}` (360px) đến 420px (không xuất hiện thanh cuộn ngang).
- **Điều hướng:** Top App Header gọn (`MOTION.AI`, `credit-badge`, nút `+ Nạp`, Avatar) kết hợp **Bottom Navigation Bar** cố định đáy (cao 64px–68px) với 4 tab (`Kho AI`, `Lịch sử`, `Bảng giá`, `Tôi`).
- **Màn hình chính (`/`) — Danh sách Card Tính Năng Có Ảnh Minh Họa:** Hiển thị ô tìm kiếm + dải lọc danh mục ngang (`Tất cả`, `Hot Trend`, `Khuôn mặt`, `Vóc dáng`, `Video AI`...) + danh sách 1 cột các Card tính năng có ảnh minh họa Before/After trực quan và nhãn giá credit.
- **Khi bấm vào 1 Card Tính Năng:** Mở **Centered Dialog làm việc (`FeatureWorkspaceDialog`)** ngay chính giữa màn hình trên lớp nền mờ `backdrop-blur` (không dùng Drawer/Bottom Sheet; gồm 2 ô tải file, thanh trượt thông số / `VideoTrimmer`, checkbox ToS và nút CTA chính). → [studio.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/studio.html)
- **Vùng chạm tối thiểu (Touch Target):** Mọi nút bấm, đầu kéo trượt, tab chọn đều có kích thước tối thiểu `{spacing.touch-min}` (48px).
- **Khoảng cách lề (Gutter):** `{spacing.screen-padding}` (16px) đều hai bên thân máy; `{spacing.gap-md}` (12px) giữa các trường nhập liệu; `{spacing.gap-lg}` (16px) giữa các khối tác vụ lớn.

### 2. Desktop & Màn hình lớn (`>= {breakpoints.desktop}` / `1024px – 1440px+`)
- **Màn hình Người dùng cuối (User Surface — Không dùng Sidebar):**
  + **Top Header cố định (`{spacing.header-height}`: 68px):** Bên trái là Logo `MOTION.AI` và các liên kết chính (`Kho Công Cụ AI`, `Lịch Sử Tác Vụ`, `Bảng Giá & Gói Cước`); bên phải là `credit-badge`, nút `+ Nạp Credit` và Avatar tài khoản.
  + **Thanh lọc danh mục & tìm kiếm:** Nằm ngay dưới Top Header, hỗ trợ lọc theo nhóm tính năng (`Tất cả công cụ`, `Hot Trend TikTok`, `Khuôn mặt`, `Vóc dáng`, `Chuyển động Video`, `Tăng nét 4K`...) và ô tìm kiếm nhanh — sẵn sàng mở rộng lên hàng chục tính năng AI trong tương lai.
  + **Lưới Thẻ Tính Năng Có Ảnh Minh Họa Toàn Màn Hình (Full-Width Visual Feature Cards Grid — 3 đến 4 cột):** Toàn bộ diện tích màn hình chính chỉ hiển thị lưới các thẻ tính năng (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`, gap `{spacing.gap-xl}` 20px), mỗi thẻ có ảnh minh họa Before/After trực quan, nhãn giá credit và mô tả ngắn (không đặt cột làm việc cố định bên phải).
  + **Hộp Thoại Làm Việc Khi Click Vào Card (`FeatureWorkspaceDialog`, `max-width: {spacing.workspace-dialog-width}` 980px):** Khi người dùng bấm vào bất kỳ Card tính năng nào, một Dialog làm việc của riêng tính năng đó mở ra giữa màn hình (trên lớp nền `backdrop-blur`), gồm vùng tải file + chỉnh thông số/trimmer + ToS + nút Tạo ở bên trái và khung xem kết quả `BeforeAfterSplitSlider` ở bên phải. → [desktop-studio.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/desktop-studio.html)
- **Màn hình Quản trị Admin (`/admin` — Phong cách Vercel tối giản):**
  + Sử dụng **Left Sidebar đơn giản (`{spacing.admin-sidebar-width}`: 220px)** phong cách Vercel (nền `#0A0A0A`, viền mảnh `1px solid #262626`, font số `monospace`), hàng 4 ô chỉ số kỹ thuật và bảng duyệt đơn `bank_ref` đa cột ưu tiên tốc độ thao tác vận hành. → [desktop-vietqr-admin.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/desktop-vietqr-admin.html)

## Elevation & Depth

Sử dụng ngôn ngữ xếp lớp chiều sâu (Tonal Layering) thay vì dùng đổ bóng cứng:

- **Lớp 0 (Nền sàn):** `{colors.bg-base}` (`#0F172A`).
- **Lớp 1 (Thẻ làm việc):** `{colors.surface-card}` (`#1E293B`) với viền mỏng `{colors.border-default}`.
- **Lớp 2 (Centered Dialog — `FeatureWorkspaceDialog` & `VietQRModal`):** Nâng cao chính giữa màn hình trên lớp phủ làm mờ (`backdrop-blur: 8px`) với hiệu ứng bóng mềm `0 24px 60px rgba(0,0,0,0.85)` (không dùng Drawer/Bottom Sheet).
- **Hiệu ứng AI Glow:** Các nút bấm trọng tâm (`cta-primary`) sử dụng hiệu ứng viền sáng nhẹ `{colors.primary-glow}` mang lại cảm giác sinh động.

## Shapes

Ngôn ngữ bo góc phân cấp rõ ràng theo kích thước linh kiện:

- **Bo nhẹ (`{rounded.sm}`: 6px):** Nhãn tag ảnh, huy hiệu trạng thái nhỏ, tay cầm video trimmer.
- **Bo chuẩn (`{rounded.md}`: 10px):** Khung nhập thông số, các nút phụ, khấc phân đoạn timeline.
- **Bo lớn (`{rounded.lg}`: 14px):** Nút CTA chính, hộp xem trước video/ảnh, khối cảnh báo thông minh.
- **Bo thẻ studio (`{rounded.xl}`: 20px):** Thẻ công cụ chính, modal VietQR card.
- **Bo tròn hoàn toàn (`{rounded.full}`: 9999px):** Huy hiệu credit (`credit-badge`), thanh trượt điều hướng, viên nang đếm ngược 15 phút.

## Components

Quy chuẩn thị giác cho các linh kiện then chốt:

- **Nút CTA chính (`button-primary`):** Nền gradient `{components.button-primary.background}`, chữ `{components.button-primary.color}`, bo góc `{components.button-primary.radius}`, chiều cao tối thiểu `{spacing.touch-min}`, tích hợp icon vector Lucide kích thước `{icons.sizes.md}`.
- **Thanh trượt cắt video (`video-trimmer`):** Đường ray viền `{colors.border-default}`, dải chọn phủ màu `{colors.primary}` độ trong suốt 25% kèm viền phát sáng, 2 chốt chặn đầu kéo màu trắng `{components.video-trimmer-handle.background}`.
- **Thanh chia đôi Before/After (`split-slider`):** Ranh giới phân chia mảnh 2px phát sáng `{components.split-slider-divider.glow}`, núm kéo trung tâm `{components.split-slider-knob.background}` đường kính 36px chứa vector icon `lucide:arrow-left-right` sắc nét.
- **Huy hiệu số dư (`credit-badge`):** Thiết kế dạng viên thuốc bo tròn `{components.credit-badge.radius}`, nền mờ cyan `{components.credit-badge.background}`, chữ `{components.credit-badge.color}`, kèm vector icon `lucide:zap`.

## Do's and Don'ts

### Do's (Nên làm)
- Luôn sử dụng icon vector Lucide thông qua `<Icon name="lucide:NAME" />` (hoặc inline SVG tương đương) để đảm bảo độ sắc nét trên mọi mật độ điểm ảnh (Retina / OLED).
- Giữ tỷ lệ tương phản chữ và icon trên nền tối đạt chuẩn WCAG AA (tối thiểu 4.5:1).
- Hiển thị số credit nhảy trực tiếp ngay cạnh vị trí ngón tay đang kéo thanh trượt.
- Mặc định mở thanh trượt so sánh Before/After ngay khi vừa render xong ảnh chỉnh dáng/ghép mặt.
- Cung cấp nút tải về HD 1 chạm trực tiếp không gắn watermark.

### Don'ts (Tuyệt đối tránh)
- **Tuyệt đối không dùng emoji Unicode UTF-8** (như ⚡, 🪄, 📋, 💳, 👤, 👗, ✨, ⏱, ✕, ⟷, ▶, ⬇, 🔗, 🔄) trong giao diện người dùng.
- Không thu nhỏ vùng bấm dưới 48px trên bất kỳ linh kiện nào trên di động.
- Không bắt người dùng rời khỏi trang Studio khi thiếu credit (luôn mở modal VietQR tại chỗ để giữ nguyên dữ liệu đang làm).
- Không hiển thị các mã lỗi kỹ thuật ComfyUI/RunningHub khó hiểu ra màn hình người dùng.
