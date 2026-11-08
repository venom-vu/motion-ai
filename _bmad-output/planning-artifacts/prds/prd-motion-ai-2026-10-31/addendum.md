# Addendum: flowvis

Tài liệu này giữ chi tiết kỹ thuật và dữ liệu chi phí không đủ chỗ trong PRD. Mọi con số dưới đây do người dùng cung cấp và chưa được đo thực tế; việc đo nằm ở PRD §12.

## Stack đã chốt
- Frontend: Nuxt 4, bản ổn định mới nhất, chạy trên Cloudflare Pages (SSR/SSG cho landing, SEO, Open Graph động).
- Backend: NestJS (module/service, DTO validation, giao dịch cho credit, hàng đợi BullMQ).
- CSDL: PostgreSQL 16 chạy bằng container `postgres:16-alpine` trên VPS (không dùng Supabase), đăng nhập Google OAuth qua NestJS và JWT. Bảng chính: `users`, `tasks`, `ledger_entries`, `topups`.
- Storage: Cloudflare R2 hoặc AWS S3.
- Biến môi trường: `RUNNINGHUB_WORKFLOW_FACESWAP`, `RUNNINGHUB_WORKFLOW_MOTION`, `RUNNINGHUB_WORKFLOW_BODY_RESHAPE`.

## Workflow RunningHub
Fork từ workflow cộng đồng về workspace riêng, tinh giản node phụ để giảm giây GPU. Chưa có số liệu thực đo.

## Mô hình chi phí (người dùng cung cấp, chưa đo thực tế)
- Quy đổi nạp lẻ: USD 10 = 18.000 coin RunningHub.
- GPU 48 GB (RTX 4090 / A4000): cố định 0,4 coin/giây chạy GPU.
- Ảnh tĩnh (Face Swap, Body Retouch): 3–5 giây GPU, tức 1,2–2,0 coin (~17–28 VNĐ). Giá bán 100 credit (~825 VNĐ), biên gộp ~95%.
- Video Motion: ~13 giây GPU cho 1 giây video, tức 5,2 coin/giây video (~74 VNĐ/giây ở nạp lẻ, ~37 VNĐ/giây ở gói chuẩn). Giá bán 50 credit/giây (~412 VNĐ).
- Biên gộp đã đối soát (chỉ giá vốn GPU): 91% ở kịch bản chuẩn (37 VNĐ/giây), 82% ở nạp lẻ (74 VNĐ/giây), gói Pro. Gói Creator thấp nhất, ~77,6% ở nạp lẻ. Bảng đầy đủ nằm ở PRD §11.
- Giá 825 VNĐ/100 credit tính theo gói Pro; Starter ~980, Creator ~663 VNĐ/100 credit nên biên mỏng hơn ở gói Creator.
- Cần chạy thử thật cả ba workflow để chốt số GPU-giây.

## Mô hình Tier
Tier gắn với tổng credit sở hữu (số dư khả dụng cộng credit đang HOLD): gói cao nhất đã nạp kể từ lần gần nhất ở hạng FREE, còn hiệu lực khi tổng từ 100 credit. Rơi về FREE thì xóa lịch sử gói. Tier được chụp snapshot lúc bấm Tạo. Nạp gói thấp hơn khi đang giữ gói cao thì cộng credit và giữ Tier cao.

## Chống lạm dụng
Không đặt trần theo ngày. Chặn bằng Device Fingerprint (một thiết bị nhận credit dùng thử một lần), tối đa 3 tài khoản nhận bonus mỗi IP trong 24 giờ. Không có trần tổng cho credit tặng (đã bỏ theo quyết định của người dùng). Rủi ro còn lại: IP dùng chung (CGNAT) làm người thật nhận 0 credit.
