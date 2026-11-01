# Review ARCHITECTURE-SPINE.md (Motion AI) theo checklist "good spine"

Ngày review: 2026-11-01. Đối chiếu với `prd.md` (FR-1..FR-22, NFR). Không sửa spine.

## Kết luận
**CẦN SỬA TRƯỚC KHI CHỐT (có điều kiện).** Khung rất chắc (ledger append-only, cổng terminal hai tầng, DB là nguồn sự thật, version đã verify). Còn 2 lỗ hổng mức High có thể làm hai đơn vị code khác nhau, và một số lỗi lệch PRD cần sửa ở PRD hoặc spine.

| # | Tiêu chí | Kết quả |
| --- | --- | --- |
| 1 | Chốt đủ điểm phân kỳ ở tầng dưới | Một phần: thiếu 5 điểm (xem H1, H2, M1..M3) |
| 2 | Rule của mỗi AD kiểm tra được và ngăn đúng phân kỳ | Phần lớn đạt; AD-1 và AD-4 có mâu thuẫn nội bộ; AD-14 thiếu mẫu số |
| 3 | Deferred không để hai đơn vị lệch nhau | Phần lớn đạt; rate limiting và hiệu năng nsfwjs là ngoại lệ |
| 4 | Công nghệ nêu tên đã verify còn mới | Đạt, trừ thiếu phụ thuộc chạy nsfwjs trên Node và ffmpeg |
| 5 | Capability map phủ FR-1..22, NFR-1..6 | Chưa đạt: FR-19, FR-21, NFR-6/7 thực chất không có AD; đánh số NFR sai |
| 6 | Mọi chiều altitude sở hữu được quyết định/hoãn/mở | Phần lớn đạt; bảo mật và FE hosting còn hở |

## Phát hiện (theo mức độ)

### HIGH

**H1. Phát hiện mặt/người đặt trong workflow SAU khi HOLD, mâu thuẫn PRD (AD-9 vs UJ-1 Edge, FR-1/FR-3, bảng validate)**
- PRD UJ-1: "ảnh không có mặt → báo lỗi ngay trước khi trừ credit"; bảng tham số yêu cầu đúng 1 mặt ≥10% (source_face), có mặt (target), có ≥1 người (Body Retouch); bảng lỗi: validate sai không tạo Task, không Hold.
- Spine AD-9: "Server không chạy model pose", phát hiện người/mặt là node đầu của workflow RunningHub, lỗi `NO_FACE`/`NO_POSE` thì RELEASED. Tức là Face Swap/Body Retouch ảnh lỗi vẫn HOLD, vào hàng đợi, chiếm Lane GPU rồi mới hoàn; UX "báo ngay" và "không tạo Task" không thực hiện được. Đây là điểm hai đội (FE/validate vs pipelines) sẽ tự diễn giải khác nhau.
- Đề xuất: quyết định rõ ba loại kiểm tra: (a) hình học/định dạng ở API (kích thước, tỷ lệ, dung lượng, resize 2048 px: hiện không AD nào sở hữu việc resize/ffprobe ảnh), (b) mặt/người: hoặc thêm bước nhẹ ở API (và ghi vào stack), hoặc sửa PRD chấp nhận "báo lỗi sau khi hoàn credit" cho ảnh; (c) pose video (FR-5) đúng là ở workflow. Ghi vào AD-9.

**H2. AD-1 mâu thuẫn AD-4: ai ghi `ledger_entries` và transaction chung giữa `tasks` và `wallet` chưa quy định**
- AD-1: chỉ `wallet` ghi `ledger_entries`/`users.balance`; chỉ `tasks` ghi `tasks.status`. AD-4: cùng một transaction vừa UPDATE `tasks.status` vừa ghi `CAPTURED`/`RELEASED`; AD-3 tương tự với HOLD. Không nói cách truyền transaction (tx context của Prisma, hay `wallet` cung cấp hàm nhận `tx`), nên một người sẽ gọi `wallet` ngoài transaction (mất tính nguyên tử), người khác ghi thẳng ledger (vi phạm AD-1).
- Đề xuất: Rule bổ sung "mọi hàm `wallet.*` nhận `tx` do `tasks` mở; không được tự mở transaction", hoặc gộp điểm duy nhất `tasks.finalize(taskId, outcome)` gọi `wallet.capture/release(tx, …)`.

### MEDIUM

**M1. AD-4 tầng Redis có thể làm Task kẹt**: bên thắng `SET NX` crash trước khi UPDATE DB, bên còn lại (bộ quét AD-6, timeout) bị khoá "bỏ qua im lặng" suốt TTL dài hơn timeout lớn nhất. Task treo `running` trong khi Redis lock chặn. Redis lock cũng thừa vì tầng 2 đã đủ (DB trọng tài). Đề xuất bỏ tầng 1, hoặc quy định bên thua phải kiểm tra lại DB và bộ quét bỏ qua lock.

**M2. AD-5 không buộc chuyển trạng thái hợp lệ ở tầng DB**: câu UPDATE của AD-4 (`status NOT IN terminal`) cho phép `queued→succeeded`; bảng chuyển hợp lệ chỉ ở mức hàm. Cũng thiếu rule cho: hủy vs worker nhặt job (cần `UPDATE … WHERE status='queued'` cho `queued→running`), và khi `timed_out`/`cancelled` ở `queued` thì job BullMQ vẫn còn: worker phải bỏ qua job mà Task không còn `queued`, và phải xoá job khi hủy. Đề xuất ghi vào AD-5/AD-6: `WHERE status = <from>` bắt buộc, worker kiểm tra trạng thái đầu job.

**M3. Sổ cái: dấu và định nghĩa "số dư" chưa rõ (AD-2 vs FR-9)**: PRD nói số dư là tổng bút toán; spine có `users.balance` phi chuẩn và không nói quy ước dấu (HOLD âm? RELEASED dương? CAPTURED bằng 0 vì đã trừ ở HOLD?), cũng không có rule đối soát. Hai người viết `wallet` có thể cộng trừ khác nhau. Cần quy ước dấu + invariant `balance = SUM(...)` + job đối soát. Tương tự cần nêu: "tổng HOLD đang mở" (AD-10) tính từ HOLD chưa có bút toán kết thúc hay cột riêng.

**M4. AD-10 thiếu thời điểm đánh giá Tier và so với FR-11**
- Rule không nói khi nào `wallet` tính lại (mốc hợp lý: sau CAPTURED/ADJUST/TOPUP; HOLD/RELEASED không đổi tổng). PRD FR-11 viết "số dư dưới 100" (mơ hồ giữa khả dụng và tổng); AD-10 đã đánh dấu ASSUMPTION và chọn "balance + HOLD mở". Hướng này khớp ý PRD ("Hold không làm hạ Tier") nhưng PRD phải được sửa chữ cho khớp; hiện hai tài liệu mâu thuẫn mặt chữ.
- Thiếu: quy tắc 100-149 credit (giữ Tier nhưng Motion 150 bị từ chối thiếu credit) chỉ nằm ở PRD, AD-3 chỉ nói "kiểm tra số dư". Acceptance FR-11 (Pro còn 5.000 nạp Starter vẫn Priority 2) cần xác nhận AD-10 "giữ gói cao nhất" lưu ở đâu (cột `users.tier` đủ, nhưng ghi rõ).

**M5. AD-14 thiếu mẫu số/ngưỡng mẫu tối thiểu**: tỷ lệ 15% trên "cửa sổ trượt 30 phút" nhưng không nói mẫu số (Task đã kết thúc? gồm cả `succeeded`?) và số Task tối thiểu; 1 lỗi trên 1 Task = 100% sẽ ngắt mạch ngay khi mới mở bán. Hai dev sẽ cài khác nhau. Cũng thiếu: ai tắt cờ sau ngắt, và PRD §4.5 bảng lỗi "Hết credit RunningHub → tạm chặn Task mới" mà AD-14 chỉ cảnh báo, không chặn.

**M6. Vận hành RunningHub: retry/idempotency PRD không có trong spine**: PRD §4.5 yêu cầu retry 1 lần sau 5 giây với idempotency key theo Task ID. AD-6 chỉ xử lý "ghi `runninghub_task_id` sau submit", không xử lý crash giữa submit và ghi DB (job RunningHub mồ côi, tốn tiền) và không xác nhận RunningHub hỗ trợ idempotency key. Cần ghi nhận là giả định/câu hỏi mở.

**M7. Capability map thiếu và đánh số NFR sai**
- PRD có NFR-1,2,3,4,6,7 (không có NFR-5). Spine bind "NFR-1..6" và dùng NFR-5/NFR-6 theo nghĩa khác (AD-8 bind NFR-5 không tồn tại; AD-7/AD-14 bind NFR-6 là "quan sát" nhưng PRD NFR-6 là mobile web, quan sát là NFR-7). `binds` frontmatter cần sửa thành NFR-1,2,3,4,6,7.
- Không có AD sở hữu: FR-19 (lưu thời điểm + phiên bản ToS, không có bảng/consent trong ER), FR-21 (khoá tài khoản vi phạm lặp lại, không có cột trạng thái user), NFR-3 (rate limit theo tài khoản và IP, bị đẩy xuống Deferred dù là NFR), NFR-6 (OG động khi chia sẻ, route trang chia sẻ công khai), NFR-7 (log/đo thành công/chi phí: có `gpu_coins`, nhưng không có quy ước đo). Bảng map gộp "NFR-1..6 → toàn hệ thống" che các lỗ hổng này.
- Thiếu rule lên cổng Upload: PRD yêu cầu ≤10 MB/≤100 MB; AD-8 dùng presigned PUT, mà PUT không ép được giới hạn dung lượng (cần POST policy hoặc kiểm tra HEAD sau khi tải). Bỏ trống thì mỗi dev tự chọn.

**M8. Bảo mật/hosting còn hở**: (a) AD-12 yêu cầu FE và API "cùng tên miền gốc" nhưng sơ đồ nêu FE "Vercel hoặc Cloudflare Pages": chưa chốt một nơi, kéo theo cấu hình cookie/CORS/CSRF cho refresh token (không có rule CSRF/SameSite). (b) Thiếu: bảo vệ route admin ngoài role (2FA/allowlist), quản lý bí mật trên VPS, mã hoá/kiểm tra khôi phục backup (backup 7 bản lên R2, chưa nói test restore), CORS cho R2. (c) Fingerprint thiết bị do client gửi, dễ giả mạo; chấp nhận được cho MVP nhưng nên ghi là rủi ro. (d) Đếm IP trong 24 giờ trong transaction vẫn có race (3 đăng ký đồng thời); cần advisory lock hoặc unique counter.

### LOW

- **L1. Mâu thuẫn từ vựng PRD vs spine (PRD cần sửa theo đúng memlog)**: PRD/addendum còn "PostgreSQL (Supabase)" và bảng `transactions`, trong khi spine dùng Postgres container + OAuth NestJS + `ledger_entries`; PRD Glossary/FR-9/FR-10/FR-15 dùng Hold/Settle/Release, spine dùng HOLD/CAPTURED/RELEASED (+ `GRANT`, `ADJUST`); PRD §4.5/§6 nói "poll/webhook" và FR-18 "Telegram/Discord", spine chỉ poll và chỉ Telegram; PRD ghi Nuxt 3 (memlog), spine Nuxt 4. PRD `status: final` nhưng cần cập nhật.
- **L2. FR-5**: PRD nói worker "reject Task ngay" nhưng `rejected` trong PRD §4.5 là Task bị Pre-check chặn trước Hold (không có Hold). Spine ánh xạ `NO_POSE` thành `failed` + RELEASED. Thống nhất: dùng `failed/NO_POSE`, sửa chữ "reject" trong FR-5; thông báo người dùng "Không nhận diện được chuyển động cơ thể trong video mẫu" phải gắn cứng với `NO_POSE` trong bảng ánh xạ.
- **L3. Stack thiếu thành phần dùng thật**: nsfwjs 4.4.0 trên Node cần backend TF (`@tensorflow/tfjs-node` hoặc wasm) và bộ giải mã ảnh; chỉ liệt kê `@tensorflow/tfjs ^4` (đã chú thích peer dep nhưng không đủ để chạy ở Node 22); `ffprobe/ffmpeg` (AD-7, AD-11) và thư viện ảnh (resize, EXIF) chưa được nêu trong Stack/Docker image. EXIF chỉ áp dụng cho ảnh, AD-7 chưa nói video.
- **L4. `gpu_coins numeric` vs quy ước "tiền là số nguyên bigint"**: đây là coin RunningHub (không phải credit) nhưng nên ghi chú để tránh nhầm.
- **L5. Deferred**: "Hiệu năng nsfwjs" nên là ngưỡng quyết định (nếu >X ms thì AD-9 chuyển sang worker) thay vì chỉ "cần đo". Deferred rate limiting cần nêu tối thiểu chốt thư viện/nơi áp dụng vì NFR-3.

## Kiểm chứng công nghệ (npm registry, 2026-11-01)
Đã xác minh: NestJS core 12.3.2, `@nestjs/bullmq` 12.0.0, bullmq 6.5.3, ioredis 6.0.0, nsfwjs 4.4.0 (peer `@tensorflow/tfjs ^4`), Nuxt 4.6.3 đều là bản `latest`. Prisma: `latest` hiện là 8.0.0-rc.29 (rc), `prev` 7.10.1, spine ghim 7.10.1 đúng và ghi lý do. Postgres 16 và Redis 7 là pin có chủ ý (không phải mới nhất); ổn nhưng nên ghi là chủ ý, không phải "current". Yêu cầu Node của Prisma 7.10.1 chưa kiểm lại trong review này (lấy theo spine).

## Phủ FR/NFR (tóm tắt)
- Phủ tốt: FR-1..3,6..18, FR-20, FR-22, NFR-1,2,4.
- Phủ yếu hoặc không có AD: FR-4 (UI so sánh: chấp nhận ở cấp feature), FR-5 (xem L2), FR-19, FR-21, NFR-3, NFR-6, NFR-7.
- Ngoài PRD nhưng spine tự thêm: bảng `admin_audit`, `settings`, `signup_grants`, `moderation_events` chưa có trong ER chính.

## Việc cần làm theo thứ tự
1. Sửa H1 (vị trí kiểm tra mặt/người và validate ảnh) và H2 (ranh giới transaction giữa tasks và wallet).
2. Sửa M1, M2, M3, M5 (rule kỹ thuật cụ thể), M4 (thời điểm tính Tier) và đồng bộ chữ PRD.
3. Sửa đánh số NFR và bổ sung dòng Capability map cho FR-19, FR-21, NFR-3, NFR-6, NFR-7.
4. Chốt hosting FE và các điểm bảo mật (M8).
5. Cập nhật PRD theo L1/L2.
