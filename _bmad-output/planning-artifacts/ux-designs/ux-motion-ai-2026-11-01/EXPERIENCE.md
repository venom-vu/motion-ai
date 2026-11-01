---
name: motion-ai
status: final
sources:
  - /Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/prds/prd-motion-ai-2026-10-31/prd.md
  - /Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/architecture/architecture-motion-ai-2026-11-01/ARCHITECTURE-SPINE.md
  - /Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/epics.md
updated: 2026-11-01
---

# Motion AI — Experience Spine (EXPERIENCE.md)

> Bản hợp đồng trải nghiệm người dùng (_hoạt động ra sao_: kiến trúc thông tin, hành vi linh kiện, quy tắc trạng thái, tương tác và các hành trình nhân vật). Tài liệu này tham chiếu các token thị giác từ `DESIGN.md` qua cú pháp `{path.to.token}`. Cả hai tài liệu là chuẩn cao nhất khi có xung đột với bất kỳ mockup nào.

## Foundation

**Motion AI** là ứng dụng web di động hướng tới sự tinh gọn (**Mobile-First Responsive Web**), phát triển trên nền tảng **Nuxt 4 (Vue 3, Vite, Tailwind CSS, shadcn-vue)** và triển khai trên Cloudflare Pages.

- **Môi trường hoạt động:** Tối ưu hóa theo kiến trúc **Mobile-First kết hợp Full Desktop Adaptive**: mượt mà trên trình duyệt di động (Safari iOS, Chrome Android từ `{breakpoints.mobile}` 360px với vùng thao tác trong **Thumb Zone**), đồng thời trên màn hình máy tính (`>= {breakpoints.desktop}` 1024px) sử dụng **Top Header + Kho Thẻ Tính Năng Có Ảnh Minh Họa toàn màn hình** (không dùng Sidebar cho User, mở rộng thoải mái lên hàng chục tính năng AI; khi click vào một thẻ tính năng sẽ mở **Dialog làm việc** của tính năng đó). Riêng trang Admin (`/admin`) dùng Sidebar tối giản phong cách Vercel.
- **Hệ thống thiết kế:** Kế thừa bộ khung linh kiện của shadcn-vue, áp dụng lớp nhận diện thương hiệu từ `DESIGN.md` (bảng màu `{colors.bg-base}` và điểm nhấn `{colors.primary}`, `{colors.accent}`).
- **Chuẩn biểu tượng (Icon System):** Chuẩn hóa toàn diện bằng **`nuxt-icon` kết hợp thư viện `lucide`** (`<Icon name="lucide:..." />`). Cấm tuyệt đối việc sử dụng icon ký tự Unicode UTF-8 / Emoji trong thanh điều hướng, nút bấm và nhãn trạng thái nhằm đảm bảo tính thẩm mỹ chuẩn công cụ studio chuyên nghiệp trên mọi thiết bị.
- **Mô hình người dùng:** Không gian làm việc cá nhân (Single-tenant user workspace), xác thực đăng nhập bảo mật qua Google OAuth; thanh toán nội địa tiện lợi qua mã chuẩn VietQR.

## Information Architecture

Hệ thống bao gồm 8 màn hình / bề mặt tương tác cốt lõi (thích ứng tự động giữa Mobile và Desktop):

| Màn hình (Surface) | Đường dẫn / Cách mở | Icon (Lucide) | Nhiệm vụ chính & Các thành phần |
|---|---|---|---|
| **Kho Công Cụ AI (Trang chủ)** | `/` (Mobile: Bottom Nav `Kho AI` / Desktop: Top Header) | `lucide:layout-grid` | Đồng bộ trên cả Mobile và Desktop: Hiển thị **Thanh lọc danh mục + Tìm kiếm + Danh sách/Lưới Thẻ Tính Năng Có Ảnh Minh Họa** (Mobile xếp 1 cột dọc; Desktop xếp lưới 3–4 cột toàn màn hình, không có cột làm việc bên phải). Khi click/chạm vào một Card sẽ mở **Dialog làm việc (`FeatureWorkspaceDialog`)** của chức năng đó. → Mobile: [studio.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/studio.html) · Desktop: [desktop-studio.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/desktop-studio.html) |
| **Kết Quả & So Sánh** | `/tasks/:id` (hoặc hiển thị ngay trong `FeatureWorkspaceDialog` trên Desktop) | `lucide:arrow-left-right` | Xem kết quả; mặc định hiển thị **thanh trượt chia đôi Before/After**; nút tải về HD 1 chạm (`lucide:download`); nút sao chép link chia sẻ (`lucide:link`); nút "Đổi mức độ khác" (`lucide:refresh-cw`). → Mobile: [split-compare.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/split-compare.html) · Desktop: [desktop-studio.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/desktop-studio.html) |
| **Modal Nạp Nhanh VietQR** | Popup tại chỗ khi thiếu credit hoặc bấm Nạp | `lucide:zap` | Hiển thị mã VietQR động với đúng số tiền và cú pháp `NAP <MÃ_GIAO_DỊCH>`, bộ đếm ngược 15 phút (`lucide:clock`), nút xác nhận "Tôi đã chuyển khoản". Giữ nguyên dữ liệu form đang làm dở. → [vietqr-modal.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/vietqr-modal.html) |
| **Lịch Sử Tác Vụ** | `/tasks` (Nav: Lịch sử) | `lucide:history` | Danh sách ảnh/video đã tạo (phân trang/cuộn vô tận), thẻ trạng thái `Đang tạo...`, `Hoàn thành`, `Thất bại (Đã hoàn credit)`. Mobile: 1–2 cột; Desktop: lưới 3–4 cột. |
| **Bảng Giá & Gói Cước** | `/pricing` (Nav: Gói cước) | `lucide:credit-card` | Bảng so sánh 4 gói cước (FREE 0đ, Starter 49k, Pro 99k, Creator 199k), thể hiện rõ thời lượng video tối đa (5s - 10s - 15s - 20s) và mức độ ưu tiên hàng đợi. Desktop dàn ngang 4 thẻ gói cước song song. |
| **Trang Chia Sẻ Ngoài** | `/share/:token` (Mở từ link ngoài) | `lucide:share-2` | Trang xem nhanh ảnh/video render, crawler-friendly với Open Graph tags cho Zalo/Facebook, kèm nút kêu gọi "Thử tạo video tương tự miễn phí trên Motion AI". |
| **Tài Khoản & Pháp Lý** | `/profile` (Nav: Tôi) | `lucide:user` | Thông tin Google OAuth, số dư credit khả dụng, lịch sử biến động sổ cái, link Điều khoản dịch vụ (`/terms`), Chính sách bảo mật (`/privacy`), nút "Báo cáo vi phạm". |
| **Quản Trị & Vận Hành Admin** | `/admin` (Chỉ hiển thị cho role `admin`) | `lucide:shield-check` | Giao diện tối giản **phong cách Vercel** với Left Sidebar đơn giản (`220px`), hàng 4 ô chỉ số kỹ thuật và bảng duyệt đơn nạp VietQR (nhập `bank_ref` duy nhất), giám sát ngắt mạch, số dư RunningHub, khóa tài khoản, gỡ nội dung R2 và nhật ký `admin_audit`. → Desktop: [desktop-vietqr-admin.html](file:///Users/huy_vq/Desktop/motion-ai/_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/mockups/desktop-vietqr-admin.html) |

## Voice and Tone

Toàn bộ thông điệp giao diện (Microcopy) sử dụng tiếng Việt tự nhiên, thân thiện, tôn trọng người dùng và **minh bạch tuyệt đối về tài chính**:

| Tình huống                      | Nên dùng (Do)                                                                                                                                  | Không nên dùng (Don't)                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Khi thiếu credit tạo tác vụ** | "Bạn đang có {balance} credit (cần {required} cr để tạo đoạn {duration}s). Nạp nhanh gói Starter 49k (+5.000 cr) nhé?"                         | "Lỗi: Số dư tài khoản không đủ để thực hiện."                        |
| **Khi hệ thống đang xử lý**     | "Đang biến hóa chuyển động... (khoảng 30–60s). Bạn có thể tắt màn hình hoặc chuyển trang, kết quả sẽ tự động lưu vào mục Lịch sử."             | "Hệ thống đang chạy tiến trình GPU, vui lòng không tắt trình duyệt." |
| **Khi lỗi xử lý hoặc timeout**  | "Quá trình dựng gặp chút trục trặc ngoài ý muốn. Hệ thống đã hoàn trả đầy đủ {refund_amount} credit về tài khoản của bạn."                     | "500 Internal Server Error: Render task timed out."                  |
| **Khi ảnh không rõ mặt/dáng**   | "Chưa nhận diện được góc mặt hoặc dáng người rõ nét trong ảnh. Bạn thử đổi một ảnh chụp rõ hơn và hướng trực diện nhé!"                        | "NO_FACE / NO_BODY_KEYPOINTS detected."                              |
| **Khi vi phạm chuẩn cộng đồng** | "Ảnh hoặc video chưa phù hợp với tiêu chuẩn nội dung cộng đồng. Toàn bộ {refund_amount} credit đã được hoàn lại, bạn vui lòng chọn file khác." | "Nội dung vi phạm điều khoản 18+. Bị chặn bởi hệ thống kiểm duyệt."  |

## Component Patterns

### 1. Thanh trượt chia đôi Before/After (`BeforeAfterSplitSlider`)

- **Mục đích:** Mang lại khoảnh khắc "Aha!" thị giác tột đỉnh ngay sau khi tạo ảnh Face Swap hoặc Body Retouch.
- **Hành vi:**
  - Tự động căn vạch phân cách ở vị trí 50% khung hình khi tải trang.
  - Hỗ trợ vuốt chạm bằng ngón tay (Touch Drag) hoặc di chuột để dời vạch phân cách sang trái/phải mượt mà.
  - Núm kéo trung tâm hiển thị icon vector `lucide:arrow-left-right` tương phản cao trên nền `{colors.accent}`.
  - Nhãn `Ảnh Gốc` và `AI Retouch` cố định ở 2 góc trên với nền mờ chống lóa.
  - Nếu ảnh nguồn hết hạn lưu trữ (>7 ngày theo chính sách R2), linh kiện tự động chuyển sang chế độ hiển thị ảnh kết quả đơn lẻ kèm nút tải về `lucide:download`.

### 2. Bộ cắt thời lượng video (`VideoTrimmer`)

- **Mục đích:** Cho phép người dùng chọn chính xác phân đoạn video chuyển động mong muốn mà không cần công cụ edit bên ngoài.
- **Hành vi:**
  - Khấc bước nhảy chẵn 1 giây (`step = 1s`). Không cho phép chọn số lẻ mili-giây để đảm bảo tính giá credit minh bạch.
  - Giới hạn tối thiểu 3 giây (150 credit) và tối đa theo mức trần của gói cước người dùng đang sở hữu (FREE: 5s, Starter: 10s, Pro: 15s, Creator: 20s).
  - Khi kéo một trong hai đầu chốt chặn (`trimStart`, `trimEnd`), số giây và tổng số credit (`50 × duration`) nhảy số thời gian thực ngay cạnh ngón tay cái, kèm icon `lucide:zap`.
  - Vùng video hiển thị xem trước vòng lặp cục bộ (local loop preview) tức thì qua `URL.createObjectURL` không tốn băng thông mạng, nút phát dùng `lucide:play`.

### 3. Hộp thoại Nạp nhanh VietQR (`VietQRModal`)

- **Mục đích:** Xử lý rào cản nạp tiền ngay tại thời điểm người dùng phát sinh nhu cầu, không làm gián đoạn luồng sáng tạo.
- **Hành vi:**
  - Mở dưới dạng **Centered Dialog** giữa màn hình (trên cả Mobile và Desktop, không dùng Drawer/Bottom Sheet), giữ nguyên trạng thái form và các file ảnh/video vừa tải lên trong `FeatureWorkspaceDialog`.
  - Tự động tính toán số credit còn thiếu và gợi ý gói cước tối ưu nhất (mặc định gợi ý gói Starter 49k cho nhu cầu tức thì).
  - Tạo mã VietQR động chứa chính xác số tiền gói cước và nội dung chuyển khoản `NAP <MÃ_GIAO_DỊCH>`, nút copy dùng icon `lucide:copy`.
  - Đồng hồ đếm ngược 15 phút hiển thị kèm icon `lucide:clock`. Nút đóng dialog dùng `lucide:x`.
  - Khi người dùng bấm "Tôi đã chuyển khoản", trạng thái chuyển sang "Đang chờ duyệt" và đóng dialog; hệ thống tự động cộng credit và kích hoạt tác vụ ngay khi giao dịch được xác nhận.

### 4. Checkbox đồng ý Điều khoản bắt buộc (`ToSCheckbox`)

- **Hành vi:** Nút CTA "Tạo tác vụ" bị khóa (disabled) cho đến khi người dùng tick chọn xác nhận đủ 18 tuổi, sở hữu bản quyền hình ảnh và cam kết không tạo nội dung deepfake/đồi trụy. Trạng thái tick hiển thị icon `lucide:check`.

## State Patterns

### Vòng đời tác vụ render (Task Lifecycle States)

1. **Khởi tạo (`holding`):** Tạm giữ số credit tương ứng trong ví người dùng, hiển thị spinner xoay nhẹ `lucide:loader-2`.
2. **Xếp hàng (`queued`):** Hiển thị số thứ tự trong hàng đợi (Queue Position #N) và mức độ ưu tiên của gói cước. Cho phép bấm "Hủy tác vụ" để giải phóng credit ngay lập tức.
3. **Đang xử lý (`running`):** Hiển thị thanh tiến trình ước tính (30–60s) kèm thông điệp trấn an: _"Bạn có thể rời trang, video sẽ tự lưu vào Lịch sử"_.
4. **Hoàn thành (`succeeded`):** Trừ credit chính thức trong sổ cái; tự động chuyển sang màn hình kết quả hoặc mở thanh trượt Before/After.
5. **Thất bại / Hết hạn (`failed` / `timed_out`):** Tự động giải phóng (hoàn trả 100%) số credit đã giữ; hiển thị thông báo an tâm và lý do thân thiện kèm icon `lucide:alert-circle`.

### Trạng thái bảo trì & Ngắt mạch hệ thống (Circuit Breaker Banner)

- Khi RunningHub bảo trì hoặc cạn ngân sách, một thanh banner cảnh báo màu vàng `{colors.warning}` xuất hiện cố định ở đầu trang Studio với icon `lucide:alert-triangle`, vô hiệu hóa nút "Tạo tác vụ" nhưng vẫn cho phép người dùng xem lịch sử, tải lại video cũ và nạp credit bình thường.

## Interaction Primitives

- **Vùng chạm ngón cái (Thumb Ergonomics):** Mọi nút bấm tương tác có chiều cao $\ge 48\text{px}$ (`{spacing.touch-min}`).
- **Vuốt chạm hai chiều (Scrubbing / Dragging):** Thanh chia đôi Before/After và đầu chốt cắt video hỗ trợ thao tác chạm mượt mà trên màn hình cảm ứng di động, có phản hồi thị giác (glow viền sáng khi đang chạm).
- **Phản hồi tức thì (Instant Feedback):** Mỗi cú chạm nút hoặc kéo thanh trượt đều phản hồi bằng thay đổi màu sắc ngay lập tức (<100ms), không có độ trễ thị giác.

## Accessibility Floor

- **Độ tương phản màu sắc:** Toàn bộ chữ chính (`{colors.text-primary}`) trên nền thẻ (`{colors.surface-card}`) và nền chính (`{colors.bg-base}`) đạt tỷ lệ tương phản $\ge 7:1$, vượt xa chuẩn tối thiểu WCAG AA (4.5:1).
- **Hỗ trợ đọc màn hình (Screen Readers):**
  - Toàn bộ icon Lucide đều có `aria-hidden="true"`; văn bản tương ứng đi kèm hoặc nhãn `aria-label` đảm bảo người khiếm thị nhận diện chính xác.
  - Thanh trượt `BeforeAfterSplitSlider` có thuộc tính `role="slider"`, `aria-label="So sánh ảnh trước và sau"`, `aria-valuenow="50"`.
  - Thanh cắt `VideoTrimmer` có nhãn `aria-label="Điểm bắt đầu video"` và `aria-label="Điểm kết thúc video"`.
- **Không phụ thuộc vào âm thanh:** Mọi thông báo lỗi, trạng thái thành công và tiến trình đều thể hiện bằng hình ảnh và chữ viết trực quan.

## Key Flows

### Flow 1: Linh (22t, TikToker) — Ghép mặt 1 chạm theo trend

1. **Khởi động:** Linh mở link Motion AI từ bio TikTok trên điện thoại Safari, thấy giao diện Studio Dark Studio hiện đại.
2. **Thao tác:** Chọn tab "Ghép mặt" (`lucide:scan-face`), tải 1 ảnh selfie chụp góc thẳng và 1 ảnh meme/trend đang hot trên mạng.
3. **Xác nhận:** Thấy nhãn "Chi phí: 100 credit", tick chọn cam kết điều khoản (`lucide:check`) và bấm nút tím "Tạo ảnh ghép mặt".
4. **Trải nghiệm chờ:** Hệ thống báo "Đang biến hóa... (khoảng 30s)", tài khoản giữ 100 credit.
5. **Đỉnh điểm (Climax Beat):** Chưa đầy 40 giây sau, màn hình hiển thị ảnh ghép mặt sắc nét, chuẩn từng sợi tóc. Linh bấm "Tải ảnh HD" (`lucide:download`) không dính watermark và đăng ngay lên TikTok đón trend.

### Flow 2: Hà (28t, Chủ shop thời trang online) — Chỉnh dáng & Trượt so sánh Before/After

1. **Khởi động:** Hà vào Motion AI trên điện thoại để chỉnh loạt ảnh mẫu lookbook vừa chụp ở studio nhưng cần bóp nhẹ vòng eo để tôn phom đầm.
2. **Thao tác:** Vào tab "Chỉnh dáng" (`lucide:sparkles`), tải ảnh người mẫu toàn thân, kéo nhẹ thanh trượt Body Retouch lên mức 5 ("Tự nhiên").
3. **Thực thi:** Bấm nút "Tạo ảnh chỉnh dáng (100 cr)".
4. **Đỉnh điểm (Climax Beat):** Màn hình hiển thị kết quả với **Thanh trượt chia đôi Before/After** (`lucide:arrow-left-right`). Hà dùng ngón tay cái vuốt qua vuốt lại, ngạc nhiên thấy vòng eo thon gọn tự nhiên mà đường vân vải và nền gạch phía sau không hề bị méo mó.
5. **Chuyển đổi:** Hà bấm "Tải ảnh HD" (`lucide:download`) và quyết định nạp ngay gói Pro 99k để chỉnh tiếp toàn bộ 50 ảnh sản phẩm trong bộ sưu tập mới.

### Flow 3: Minh (19t, Dance/Motion Creator) — Cắt video 1s & Nạp tiền thông minh tại chỗ

1. **Khởi động:** Minh có sẵn ảnh một nhân vật hoạt hình và muốn nhân vật nhảy theo điệu nhạc TikTok 15 giây của idol.
2. **Thao tác:** Vào tab "Chuyển động" (`lucide:clapperboard`), tải ảnh nhân vật và tải video nhảy mẫu 15 giây.
3. **Cắt đoạn:** Minh dùng 2 đầu kéo Video Trimmer cắt đúng đoạn điệp khúc sôi động nhất từ giây thứ 3 đến giây thứ 9 (đúng 6 giây). Số credit hiển thị tương ứng: 300 credit (`lucide:zap`).
4. **Khoảnh khắc cứu nguy:** Minh bấm "Tạo video (300 cr)", nhưng ví dùng thử chỉ còn 250 credit. Hệ thống không báo lỗi cụt lủn, mà bật ngay thông báo thông minh kèm icon `lucide:alert-circle`: _"Bạn có 250 credit (thiếu 50 cr). Nạp nhanh gói Starter 49k (+5.000 cr) nhé?"_ kèm mã VietQR 49.000đ mở ngay dạng popup tại chỗ.
5. **Đỉnh điểm (Climax Beat):** Minh mở app ngân hàng quét QR trong 15 giây. Sau khi xác nhận, video bắt đầu render ngay mà Minh không hề bị mất dữ liệu file hay đoạn video vừa căn chỉnh công phu.

### Flow 4: Nam (Người dùng mới) — Nhận 500 cr trải nghiệm & Đăng ký Google

1. **Khởi động:** Nam truy cập qua link chia sẻ của bạn bè `/share/tk_dance99`, ấn tượng với chất lượng video và bấm nút "Thử tạo video tương tự miễn phí trên Motion AI".
2. **Đăng ký:** Nam đăng nhập 1 chạm qua Google OAuth, nhận ngay 500 credit khởi nghiệp vào ví.
3. **Sáng tạo:** Nam tạo thử 1 ảnh Face Swap (100 cr) và 1 video Motion 5s (250 cr), hài lòng tuyệt đối với tốc độ và giao diện tiếng Việt dễ hiểu.
4. **Gắn bó:** Khi nhận thấy hệ thống minh bạch tài chính (hoàn tiền nếu lỗi, không ép mua gói đắt), Nam lưu trang web vào màn hình chính điện thoại (Add to Home Screen) để sử dụng lâu dài.

## Responsive & Platform

Hệ thống thực thi kiến trúc **Mobile-First + Full Desktop Adaptive**, tự động chuyển đổi bố cục theo 3 ngưỡng màn hình chuẩn của Tailwind CSS mà không nhân đôi logic nghiệp vụ:

| Thành phần / Bề mặt | Mobile (`< 768px`, chuẩn `{breakpoints.mobile}` 360px) | Tablet (`768px – 1023px`, `md:`) | Desktop (`>= 1024px`, `lg:` / `xl:`) |
|---|---|---|---|
| **Điều hướng của User (User Navigation)** | **Bottom Navigation Bar** cố định đáy (cao 68px, 4 tab nằm trong Thumb Zone) | **Top Header** gọn + Bottom Bar hoặc Pill Nav | **Top Header cố định (`{spacing.header-height}`: 68px)** — **Không dùng Sidebar trái cho User**. Gồm Logo, các tab điều hướng (`Kho Công Cụ AI`, `Lịch Sử Tác Vụ`, `Bảng Giá & Gói Cước`), `credit-badge`, nút `+ Nạp Credit` và Avatar |
| **Trang chủ / Kho tính năng (`/`, `/face-swap`, `/body-retouch`, `/motion`)** | **Danh sách 1 cột Card Tính Năng Có Ảnh Minh Họa** (kèm tìm kiếm & lọc danh mục ngang); chạm vào một Card mở **Centered Dialog làm việc (`FeatureWorkspaceDialog`)** | **Lưới 2 cột Card Tính Năng** có ảnh minh họa; bấm vào mở Centered Dialog làm việc | **Lưới 3–4 cột Card Tính Năng Có Ảnh Minh Họa Toàn Màn Hình** (`lg:grid-cols-3 xl:grid-cols-4`, kèm thanh lọc danh mục & tìm kiếm, **không đặt khung làm việc bên phải**). Khi click vào một Card → mở **Centered Dialog làm việc (`FeatureWorkspaceDialog`, `max-width: 980px`)** của chức năng đó |
| **Hộp thoại Làm việc của Tính năng (`FeatureWorkspaceDialog`)** | Mở dạng **Centered Dialog** giữa màn hình (không dùng Drawer/Bottom Sheet; chứa ô tải file, trimmer/slider, ToS, nút Tạo); khi xong hiển thị kết quả `BeforeAfterSplitSlider` | Mở dạng **Centered Dialog** (`max-width: 720px`) | Mở dạng **Centered Dialog (`max-width: 980px`)** trên nền `backdrop-blur`: bên trái là vùng tải file + thanh trượt thông số/trimmer + ToS + nút Tạo; bên phải là khung Preview & `BeforeAfterSplitSlider` trực tiếp trong Dialog |
| **Hộp thoại Nạp nhanh (`VietQRModal`)** | Mở dạng **Centered Dialog** giữa màn hình (không dùng Drawer/Bottom Sheet) | **Centered Dialog** (`max-width: 520px`) | **Centered Dialog** mở ngay trong ngữ cảnh (giữ nguyên dữ liệu đang chỉnh trong `FeatureWorkspaceDialog`) |
| **Lịch sử (`/tasks`) & Bảng giá (`/pricing`)** | **1 cột** (hoặc lưới 2 cột nhỏ cho thumbnail lịch sử) | **Lưới 2 cột** (`md:grid-cols-2`) | **Lưới 3–4 cột** (`lg:grid-cols-3 xl:grid-cols-4`, gap `{spacing.gap-lg}` 16px) dưới Top Header |
| **Trang Quản trị (`/admin`)** | **Thẻ xếp dọc 1 cột** (dùng được ở 360px để Admin duyệt đơn khẩn cấp trên điện thoại) | **Lưới 2 cột** cho thẻ chỉ số + danh sách thẻ đơn nạp | **Giao diện tối giản phong cách Vercel (`max-width: 1360px`)**: Có **Left Sidebar đơn giản (`220px`)**, nền đen `#0A0A0A`, viền mảnh `1px solid #262626`, hàng 4 ô chỉ số kỹ thuật và bảng duyệt đơn `bank_ref` đa cột |
| **Phương thức nhập liệu (Input Modalities)** | Chạm ngón cái (`>= 48px`), mở Camera/Thư viện ảnh, vuốt cảm ứng (`touchmove`) | Chạm hoặc chuột | Hỗ trợ **Kéo & Thả file (Drag & Drop)** trực tiếp vào ô tải lên trong Dialog, kéo chuột (`mousedown`/`mousemove`) trên `BeforeAfterSplitSlider` và `VideoTrimmer`, phím `Escape` để đóng Dialog |
