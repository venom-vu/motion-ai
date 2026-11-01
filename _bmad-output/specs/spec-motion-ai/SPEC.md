---
id: SPEC-motion-ai
companions:
  - ../../planning-artifacts/prds/prd-motion-ai-2026-10-31/prd.md
  - ../../planning-artifacts/prds/prd-motion-ai-2026-10-31/addendum.md
  - ../../planning-artifacts/architecture/architecture-motion-ai-2026-11-01/ARCHITECTURE-SPINE.md
sources: []
---

> **Canonical contract.** SPEC này và các file trong `companions:` là hợp đồng đầy đủ về cái cần xây, kiểm thử và xác nhận. PRD giữ các bảng tham số, bảng lỗi và bảng kinh tế đơn vị; ARCHITECTURE-SPINE giữ các quyết định AD-1..AD-18. Khi hai bên lệch nhau, PRD thắng về hành vi sản phẩm, spine thắng về cơ chế kỹ thuật.

# Motion AI MVP

## Why

Ủy nhiệm thương mại kiêm cơ hội: người dùng Việt Nam hiện phải thuê làm ngoài (30.000–100.000 VNĐ/ảnh, 50.000–150.000 VNĐ/clip) hoặc dùng app nước ngoài không có thanh toán nội địa. MVP kiểm chứng họ có trả tiền cho ghép mặt, chỉnh dáng và điều khiển chuyển động chỉ bằng một lần bấm, với chi phí GPU tối đa USD 50–100 và không giữ GPU nhàn rỗi. Mọi đánh đổi giữa tốc độ làm, chi phí GPU và an toàn tiền của khách đều quy về phép thử này.

## Capabilities

- **CAP-1**
  - **intent:** Người dùng ghép khuôn mặt từ ảnh nguồn vào ảnh đích bằng một lần bấm (Face Swap, 100 credit).
  - **success:** Ảnh kết quả có trên R2 trong ≤ 60 giây tính từ lúc worker bắt đầu khi GPU không nghẽn; ảnh không có mặt thì Task `failed` và RELEASED 100% kèm thông báo.

- **CAP-2**
  - **intent:** Người dùng chỉnh dáng cơ thể trong ảnh theo mức `intensity` 1–10 mà giữ nguyên khuôn mặt và phông nền (Body Retouch, 100 credit).
  - **success:** Ảnh kết quả cùng kích thước đầu vào, hiển thị so sánh trước/sau; benchmark chạy mốc 3, 5, 8.

- **CAP-3**
  - **intent:** Người dùng cho nhân vật trong ảnh chuyển động theo video mẫu đã cắt (Motion Control, 50 credit/giây, tối thiểu 3 giây, tối đa theo Tier 5/10/15/20 giây).
  - **success:** MP4 720p 24 FPS có độ dài bằng đoạn cắt ±0,5 giây; giá hiển thị khi kéo thanh trượt bằng đúng số credit bị HOLD; video không có khung xương người thì `failed` và RELEASED 100%.

- **CAP-4**
  - **intent:** Hệ thống ghi mọi biến động credit vào sổ cái bất biến với HOLD, CAPTURED, RELEASED.
  - **success:** Với bất kỳ user nào, số dư bằng tổng bút toán; mỗi Task có đúng một HOLD và tối đa một bút toán kết thúc; test đồng thời không tạo được số dư âm hay hoàn tiền hai lần.

- **CAP-5**
  - **intent:** Tier, độ ưu tiên và hàng đợi dùng chung quyết định ai chạy trước.
  - **success:** Tier bằng gói cao nhất đã nạp khi tổng credit sở hữu (số dư khả dụng cộng đang HOLD) còn ≥ 100, nếu không là FREE; Tier chụp tại lúc bấm Tạo; với 2 Lane bận, Task Priority 1 vào sau vẫn chạy trước Priority 3 vào trước; Task FREE không chạy khi còn Task trả phí chờ và hết hạn sau 15 phút.

- **CAP-6**
  - **intent:** Người dùng nạp credit bằng VietQR và Admin duyệt thủ công.
  - **success:** QR đúng số tiền, hiệu lực 15 phút; đơn đã bấm "Đã chuyển khoản" giữ chờ Admin đến 08:00 nếu ngoài giờ; duyệt hai lần hoặc dùng lại một `bank_ref` không cộng credit lần hai; duyệt cập nhật credit và Tier trong cùng một giao dịch.

- **CAP-7**
  - **intent:** Người dùng đăng nhập bằng Google và nhận credit dùng thử có kiểm soát lạm dụng.
  - **success:** 500 credit một lần mỗi thiết bị; tối đa 3 tài khoản nhận credit tặng mỗi IP trong 24 giờ, tài khoản thứ 4 trở đi nhận 0; không có trần theo ngày hay trần tổng.

- **CAP-8**
  - **intent:** Mọi lỗi kỹ thuật được hoàn credit tự động, không cần khiếu nại.
  - **success:** Mọi Task kết thúc `failed`, `timed_out` hoặc `cancelled` có RELEASED 100% đúng một lần và có thông báo trên giao diện; kết quả xấu nhưng workflow thành công không tự hoàn, Admin cộng bù tay khi xác nhận lỗi hệ thống.

- **CAP-9**
  - **intent:** Hệ thống tự bảo vệ ngân sách GPU và báo cho Admin khi có sự cố.
  - **success:** Khi hơn 15% Task lỗi hệ thống trong 30 phút (tối thiểu 20 Task) hoặc 5 lỗi liên tiếp, route tạo Task trả 503 `PAUSED` và Discord nhận cảnh báo; Discord cũng nhận đơn VietQR mới và số dư RunningHub dưới USD 15; khi RunningHub hết tiền, Task đang chờ thất bại nhanh với RELEASED, nạp credit và tải kết quả vẫn dùng được.

- **CAP-10**
  - **intent:** Cổng tuân thủ của MVP gồm cam kết ToS, khóa tài khoản và gỡ bỏ khẩn cấp.
  - **success:** Không tích ToS thì không gửi được; phiên bản ToS được lưu; Admin khóa được tài khoản và xóa file trên R2 ngay, sau đó link chia sẻ của file trả lỗi không tồn tại.

- **CAP-11**
  - **intent:** Kết quả được lưu và chia sẻ có kiểm soát.
  - **success:** Kết quả nằm ở bucket riêng tư trên R2, tải bằng URL ký ngắn hạn, mang EXIF `AI-Generated Content`; chia sẻ công khai chỉ qua token người dùng tự tạo; đầu vào tự xóa sau 7 ngày, kết quả sau 30 ngày.

- **CAP-12**
  - **intent:** Người vận hành kiểm chứng kinh tế đơn vị và hạ tầng trước khi bật VietQR thương mại.
  - **success:** Benchmark 10 ảnh + 10 video đạt biên gộp gói Creator ≥ 70% và 0% lỗi kỹ thuật; thêm 1–2 ảnh nhạy cảm để bắt chuỗi lỗi thật của node lọc; năm bước hạ tầng (Discord, ffmpeg clip 20 giây, endpoint số dư và hủy của RunningHub, benchmark, khôi phục `pg_dump` từ R2) đều pass.

## Constraints

- Ngăn xếp cố định: Nuxt 4 trên Cloudflare Pages; NestJS với hai entrypoint `api` và `worker`; PostgreSQL 16 và Redis 7 dạng container; Cloudflare R2; một VPS 4 vCPU/8GB với đúng 4 container; Cloudflare Proxy với Origin CA, `ufw` chỉ mở cổng cho dải IP Cloudflare. Không có server GPU.
- Bảng giá: ảnh 100 credit, video 50 credit/giây; gói 49k/99k/199k VNĐ = 5.000/12.000/30.000 credit, không hết hạn; tặng 500.
- RunningHub: poll mỗi 3 giây bằng `/task/openapi/outputs`, không webhook; hạn chuẩn bị 120 giây, hạn xử lý ảnh 180 giây, video 360 giây tính từ lúc bắt đầu tải input lên; không có khóa idempotency nên không bao giờ submit lại; cửa sổ job mồ côi 10 phút; nhận diện mặt và khung xương chạy trong workflow sau HOLD.
- PostgreSQL là nguồn sự thật của trạng thái Task (compare-and-set); Redis chỉ là gợi ý; tiền và trạng thái đổi trong cùng một transaction.
- An toàn nội dung của MVP dựa vào ToS, node lọc sẵn có của RunningHub (mã `CONTENT_BLOCKED`, chuỗi lỗi thật chưa biết đến khi chạy benchmark) và báo cáo/gỡ bỏ. Pre-check nsfwjs hoãn sang v2.
- Phạm vi: chỉ Việt Nam, giao diện tiếng Việt, người dùng từ 18 tuổi; ảnh đầu vào tối đa 10 MB (cạnh dài resize về 2048 px), video đầu vào tối đa 100 MB (MP4/MOV); ffmpeg cắt re-encode libx264 preset veryfast 24 FPS, mỗi lúc một tiến trình.

## Non-goals

- Đối soát ngân hàng tự động, thanh toán thẻ, đa ngôn ngữ, người dùng ngoài Việt Nam.
- Face Swap trên video, xử lý hàng loạt, API công khai, ứng dụng native.
- Hoàn tiền thật (VNĐ) cho credit đã nạp.
- Pre-check nội dung tự động (v2), kiểm duyệt đầu ra, nhãn C2PA (MVP chỉ dùng EXIF).
- Hệ thống ticket hỗ trợ (khiếu nại xử lý thủ công ngoài hệ thống), hành trình riêng cho Admin, môi trường staging.

## Success signal

Trong 30 ngày đầu có ít nhất 30 đơn nạp tiền được duyệt, tỷ lệ chuyển đổi từ tài khoản đã tạo ít nhất một Task sang nạp tiền đạt ≥ 5%, tỷ lệ Task thành công ≥ 90%, chi phí GPU không vượt USD 50–100, và mọi Task lỗi đều được hoàn credit.

## Assumptions

- PRD, ARCHITECTURE-SPINE và addendum được nhận làm companion theo đường dẫn, không sao chép: các bảng tham số, bảng lỗi, kinh tế đơn vị ở PRD và AD-1..AD-18 ở spine là nguồn chính thức.
- Các sửa đổi spine sau vòng review cuối (cổng Cloudflare, Discord, `CONTENT_BLOCKED`, `pg_dump` trong worker) chưa được reviewer độc lập kiểm; polish `bmad-review` chưa chạy; sơ đồ Mermaid chưa qua parser.

## Open Questions

- Nội dung cam kết ToS bổ sung (độ tuổi 18, quyền sử dụng hình ảnh, FR-19) chưa nhận được.
- Endpoint hủy task và endpoint số dư ví của RunningHub chưa xác nhận; chuỗi lỗi thật của node lọc nội dung chưa biết. Cả ba nằm trong CAP-12.
- Chưa chọn nhà cung cấp VPS và vùng; DNS phải đặt ở Cloudflare; preset Nitro (`cloudflare-pages` hay `cloudflare_module`) kiểm lúc build FE.
- Chi phí đơn vị (13 giây GPU mỗi giây video, 3–5 giây GPU mỗi ảnh, 0,4 coin/giây) là ước tính của người dùng, chưa đo.
- Khi ngắt mạch hoặc hết ngân sách RunningHub, khách trả phí cũng bị chặn tạo Task; chưa quyết định có đường ưu tiên cho họ không.
- Chưa có kiểm soát kỹ thuật cho nội dung có người dưới 18 tuổi; cần tư vấn pháp lý (đồng ý của người bị ghép mặt, nhãn AI, quy định tại Việt Nam).
