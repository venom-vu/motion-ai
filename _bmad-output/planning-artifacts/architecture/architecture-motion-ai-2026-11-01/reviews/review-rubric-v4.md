# Review ARCHITECTURE-SPINE.md v4 theo checklist "good spine"
Ngày review: 2026-11-01. Đối chiếu `prd.md` (FR-1..FR-22, NFR-1..4, 6, 7). Không sửa spine. Các phát hiện đã nêu ở reviews/ trước (v3 và rubric v1) không lặp lại; chỉ ghi lỗi còn tồn tại hoặc mới sinh ra sau hai vòng sửa.

## Kết luận
**CẦN SỬA NHẸ TRƯỚC KHI CHỐT.** Khung đã chắc hơn nhiều (sổ cái có dấu, CAS, ranh giới transaction AD-16, nhánh khôi phục AD-5). Còn 4 lỗi High, đều là lệch nội bộ giữa các AD sau chỉnh sửa, đủ để hai đơn vị code cài khác nhau. Phần Medium chủ yếu là điểm phân kỳ chưa có chủ và các chiều vận hành chưa được quyết định hay hoãn rõ.

| # | Tiêu chí | Kết quả |
| --- | --- | --- |
| 1 | Chốt đủ điểm phân kỳ ở tầng dưới | Một phần: H1, H2, H4, M3, M4, M7 |
| 2 | Rule của mỗi AD kiểm tra được và ngăn đúng phân kỳ | Một phần: AD-6 cổng đồng thời (H3), AD-2 P2002 (M1), AD-13 bank_ref (M5) |
| 3 | Deferred không để hai đơn vị lệch nhau | Một phần: M8 (Open Graph, ToS, khóa tài khoản, xóa dữ liệu) |
| 4 | Công nghệ nêu tên đã verify còn mới | Đạt cho các gói npm (xem mục Kiểm chứng); thiếu một số công nghệ chưa gọi tên (M10) |
| 5 | Phủ FR-1..22, NFR-1..4, 6, 7 | Đạt về mặt có AD; Capability map còn thiếu liên kết (L2) |
| 6 | Các chiều altitude sở hữu | Một phần: thiếu nhà cung cấp/vùng, reverse proxy, log, khóa bí mật, RTO, mã hóa và cảnh báo sao lưu (M9) |
| 7 | Đã bỏ chú thích mẫu | Gần đạt: còn ghi chú meta của reviewer và nhãn `[ADOPTED]` không định nghĩa (L1) |
| 8 | Mermaid hợp lệ và khớp AD | Cú pháp hợp lệ; sơ đồ trạng thái thiếu cạnh (H1), ERD thiếu cột (M6) |

## HIGH

### H1. Bảng chuyển hợp lệ AD-5 không chứa các chuyển mà AD-6 thực hiện; `PREP_TIMEOUT` có hai trạng thái đích
- AD-6 bộ quét (1): Task `queued` quá 5 lần enqueue thì `failed`/`INTERNAL_ERROR` + RELEASED. AD-5 chỉ cho `queued→running|cancelled|timed_out`; AD-4 buộc CAS theo đúng bảng đó. Sơ đồ trạng thái cũng không có `queued → failed`. Hoặc là `queued→failed` bị từ chối trong code, hoặc mỗi người tự thêm.
- `PREP_TIMEOUT`: AD-5 nhánh khôi phục ghi `failed`/`PREP_TIMEOUT`; AD-6 bộ quét (3) ghi `timed_out` (`PREP_TIMEOUT`); PRD §4.5 xếp quá hạn là `timed_out`. AD-14 đếm cả hai nên breaker không lệch, nhưng UI, lịch sử và PRD SM-3 phân loại khác nhau.
- Đề xuất: thêm `queued→failed` vào AD-5 và sơ đồ; chốt `PREP_TIMEOUT` luôn là `timed_out` (hoặc luôn `failed`) ở mọi nơi.

### H2. Ranh giới transaction chưa phủ mọi chỗ cần nguyên tử; AD-3 phá AD-1 và còn lỗi đánh số
- AD-3 đánh số (1) (2) (3) nhưng câu cuối nói "crash giữa (3) và (4)": không có bước (4). Thứ tự đúng là enqueue ở bước (3), nên phải sửa thành "crash sau commit (2) và trước khi enqueue xong (3)".
- AD-3 yêu cầu `tasks` tự `SELECT … FOR UPDATE` dòng `users`, kiểm tra số dư và chụp `tier_snapshot`. Bảng lớp ở đầu spine cấm đọc bảng của module khác, và AD-1 giao `users.balance/held/tier` cho `wallet`. Chưa nêu rõ khóa và kiểm tra số dư nằm trong `wallet.hold` (trả về snapshot) hay trong `tasks`. Đây là điểm hai đơn vị sẽ làm khác nhau.
- AD-16 chỉ định nghĩa mẫu `tx` cho `tasks`↔`wallet`. Hai chỗ khác cũng cần một transaction chung giữa module: AD-12 (`auth` ghi `users` + `signup_grants`, `wallet` ghi `GRANT`) và AD-13 (`topups` cập nhật trạng thái, `wallet` ghi `TOPUP`). Không có quy tắc, mỗi nơi sẽ tự chọn cách.
- Việc tạo Task (`→queued`) không đi qua `tasks.transition` (AD-5 nói mọi chuyển trạng thái chỉ qua transition) nhưng AD-16 chỉ đặc tả `transition` mở `tx`. Cần nói rõ `tasks.create` là hàm tương tự.
- Đề xuất: khái quát AD-16 thành "module chủ giao dịch mở `tx`, module khác nhận `tx`", liệt kê bốn luồng (tạo Task, kết thúc Task, đăng ký, duyệt nạp), và đặt khóa user trong `wallet.hold`.

### H3. Cổng đồng thời RunningHub (AD-6 bước b) không nguyên tử và có thể gây thất bại dây chuyền
- Hai Lane chạy song song đọc cùng lúc "số Task có id chưa kết thúc + số job mồ côi" rồi cùng đi tiếp. Với `RH_MAX_CONCURRENT = 2` và 1 job mồ côi, cả hai thấy 1 < 2 và cùng submit, thành 3. Rule không nêu cơ chế loại trừ (mutex trong tiến trình hay đặt chỗ bằng cột DB). Task đã qua (b) nhưng chưa ghi id ở (d) cũng không được tính.
- Thời gian chờ cổng nằm trong `prep_deadline_at` (120 giây) vì `deadline_at` chỉ được đặt ở (c); PRD §4.5 chỉ nói bước chuẩn bị gồm chờ khóa ffmpeg và cắt video. Job mồ côi giữ 10 phút (`rh_orphan_until`), lâu hơn 120 giây rất nhiều. Hệ quả: sau một vài `RH_TIMEOUT`, các Task tiếp theo chờ cổng quá 120 giây và kết thúc `PREP_TIMEOUT`, là lỗi hệ thống theo AD-14, kích hoạt luật 5 lỗi liên tiếp và `intake_paused`. Cơ chế bảo vệ gây ra cú ngắt nhận Task.
- Đề xuất: đếm chỗ trống bằng một bộ đếm có khóa (ví dụ đặt chỗ dưới `FOR UPDATE` trên dòng `settings` hoặc mutex tiến trình, vì worker duy nhất), chốt thời gian chờ cổng tính vào hạn nào, và cân nhắc loại `PREP_TIMEOUT` do chờ cổng khỏi mẫu số/tử số của AD-14.

### H4. Nhánh khôi phục AD-5 và `deadline_at`
- AD-5: `running` chưa có `submit_started_at` thì chạy lại bước chuẩn bị nếu chưa quá `prep_deadline_at`, nếu không thì `PREP_TIMEOUT`. Nhưng `deadline_at` được đặt ở bước (c), trước `submit_started_at` ở (d). Worker crash lúc đang tải input lên RunningHub (giữa c và d) làm Task có `deadline_at` hợp lệ, chưa hết hạn, nhưng AD-5 vẫn xét `prep_deadline_at`; nếu `prep_deadline_at` đã qua thì Task bị hủy oan, nếu chạy lại (c) thì `deadline_at` có thể bị đặt lại và kéo dài.
- Bộ quét (3) dùng đúng quy tắc khác ("quá `prep_deadline_at` khi chưa có `deadline_at`"), nên AD-5 và AD-6 mâu thuẫn nhau.
- Đề xuất: AD-5 nhánh này khóa theo "chưa có `deadline_at`" và nêu rõ `deadline_at` chỉ ghi một lần (`COALESCE`).

## MEDIUM

### M1. AD-2: kiểm thử P2002 mô tả chưa đúng bản chất PostgreSQL
Trong interactive transaction, một lỗi vi phạm unique làm transaction ở trạng thái aborted; mọi truy vấn sau đó fail cho đến khi rollback, Prisma không tự dùng savepoint. Rule yêu cầu "chạy truy vấn tiếp theo vẫn đúng" nhưng không nói thiết kế nào đạt được điều đó. Cần chốt: P2002 luôn rollback toàn transaction (CAS AD-4 là chốt chính, unique chỉ là lưới an toàn), hoặc dùng `INSERT … ON CONFLICT DO NOTHING` bằng SQL thô. Thêm `CHECK (held >= 0)` cùng `CHECK (balance >= 0)`.

### M2. AD-10: RELEASED được liệt kê là bút toán làm đổi tổng sở hữu
Tổng sở hữu = `balance + held`; RELEASED chuyển +n sang `balance` và −n khỏi `held` nên tổng không đổi, giống HOLD. Danh sách "GRANT, TOPUP, ADJUST, CAPTURED, RELEASED" lẫn lý do với câu sau đó. Không sai kết quả nhưng sẽ làm người cài hiểu sai, hoặc đòi tính lại Tier vô ích. AD-2 (dấu) và AD-10 (tổng) khớp nhau về mặt số học; chỉ cần sửa danh sách và lời giải thích.

### M3. Chủ sở hữu ghi của nhiều bảng chưa được gán
AD-1 chỉ gán `ledger_entries`, `users.(balance|held|tier)`, `tasks`, `topups`. Chưa có chủ cho `admin_audit` (ghi từ `topups`, `wallet`, `storage`, `auth`), `share_tokens`, `settings` (do `ops` và Admin ghi), `signup_grants`, `users.locked_at`, `users.tos_*`, `users.role`. `users` còn bị nhiều module ghi cột khác nhau, trái với tiêu đề AD-1 "mỗi bảng đúng một chủ". Cũng chưa nói `ops` (breaker, đối soát) và hàm vị trí hàng đợi đọc `tasks`/`ledger_entries` qua service hay đọc trực tiếp; bảng lớp cấm đọc bảng khác. Đề xuất: AD-1 thêm bảng chủ sở hữu theo từng bảng/cột và một service ghi `admin_audit` duy nhất.

### M4. Mã lỗi (`reasonCode`) và mã lỗi API
- AD-5 enum có `PAUSED` nhưng đây là mã 503 của route tạo Task, không phải lý do kết thúc Task; AD-14 không xếp nó vào tử số hay mẫu số. Mọi lý do kết thúc khác đều được phân loại, riêng `PAUSED` thì không.
- Consistency nói `code` lấy từ "enum reasonCode/lỗi chung" nhưng không có enum lỗi chung: thiếu credit (PRD §4.4 có thông báo riêng), vượt giới hạn 3 Task, tài khoản bị khóa, chưa tích ToS, validate. FE sẽ bị chia nhánh theo chuỗi. Cần một enum lỗi API trong `packages/contracts` và quyết định `PAUSED` thuộc enum nào.
- Số liệu kiểm tra: AD-14 liệt kê 9 mã lỗi hệ thống + 5 mã loại trừ = 14; AD-5 có 15 (thừa `PAUSED`).

### M5. AD-13: "mỗi giao dịch ngân hàng dùng một lần" chỉ được ép ở đường duyệt đơn `expired`
`bank_ref` bắt buộc chỉ ở đường `expired`; đường duyệt thường không nói bắt buộc, nên cùng một chuyển khoản vẫn có thể duyệt cho nhiều đơn, trái với Prevents. Các điểm còn thiếu: `needs_review` đi tiếp sang trạng thái nào; chuyển `awaiting_transfer→expired` do tiến trình nào chạy (bộ quét AD-6 chỉ liệt kê Task) và cách xử lý đua với thao tác bấm "Đã chuyển khoản"; chủ của cảnh báo Telegram khi quá `approve_by` (và chống gửi lặp); `reject_reason` bắt buộc khi từ chối (PRD FR-14); đơn `needs_review` có tính vào giới hạn 3 đơn không; PRD FR-19 yêu cầu tích ToS khi nạp tiền nhưng `topups` không lưu cam kết.

### M6. ERD thiếu cột mà các AD phụ thuộc
- `signup_grants` không có `created_at` nhưng AD-12 đếm số tài khoản theo IP trong 24 giờ; không có chỉ mục/unique `fingerprint_hash` trong ERD.
- `ledger_entries` không có `created_at`; `share_tokens` thiếu giá trị token (hoặc hash), thời điểm tạo và hạn.
- `tasks` thiếu khóa input/output trên R2, tham số (intensity, trim_start, trim_end), giá HOLD, `pose_video` đo được; AD-3, AD-7, AD-8 và FR-7 cần các trường này nhưng không có chỗ. `users` thiếu `email`/`google_sub`.
- Bảng lưu refresh token (hoặc quyết định không lưu, kèm cách thu hồi khi khóa tài khoản) chưa có. Bảng/nguồn đếm "tối đa 10 đối tượng `in-raw/` chưa xác nhận" (AD-8) chưa có; đếm bằng `ListObjects` trên R2 mỗi lần thì tốn và không nguyên tử.

### M7. Một số điểm phân kỳ không có AD
- **Phục vụ kết quả công khai và Open Graph (NFR-6):** bucket riêng tư, URL ký ngắn hạn, nhưng crawler của mạng xã hội cần URL ảnh ổn định. Chưa quyết định ai phục vụ liên kết chia sẻ (proxy qua API, tên miền R2 riêng với token, hay trang Nuxt SSR) và cách OG lấy ảnh. Deferred đẩy "Open Graph động" xuống cấp feature, nhưng quyết định này kiến trúc phải chốt vì nó đổi cấu hình bucket.
- **Tạo mã VietQR:** dùng API công cộng bên thứ ba hay thư viện EMVCo tại server; cấu hình tài khoản nhận tiền; chưa nêu trong AD-13 hay Stack.
- **Giá trị `gpu_coins` cho Task không thành công (NFR-7, SM-4):** AD-7 chỉ ghi `consumeMoney` khi `SUCCESS`; Task lỗi sau khi chạy GPU không lưu chi phí, nên chi phí thực tế bị đánh giá thấp. Chưa nói có đọc `consumeMoney` khi `FAILED` hay không.
- **Xóa cờ ngắt mạch:** có hai cờ (`intake_paused`, `rh_budget_exhausted`); AD-14 viết "Admin tắt cờ thủ công" mà không nói một thao tác xóa cả hai, hay thứ tự. Tắt `intake_paused` mà còn `rh_budget_exhausted` làm mọi Task mới thất bại nhanh. Luật "5 lỗi liên tiếp" cũng chưa nói thành công hay lý do loại trừ có cắt chuỗi hay không, và ngắt mạch được đánh giá khi nào (mỗi lần kết thúc Task hay theo bộ quét).
- **Công việc định kỳ:** đối soát hằng ngày, cảnh báo quá hạn duyệt nạp, poll số dư RunningHub, hết hạn `topups`, `pg_dump` mỗi nơi chạy ở đâu (BullMQ repeatable, `@nestjs/schedule`, cron container) chưa chốt; Stack cũng không có thư viện lập lịch. Endpoint số dư RunningHub chưa được xác nhận (không có trong Deferred).
- **Xác thực:** thư viện Google OAuth/JWT chưa gọi tên; nơi lưu access JWT và cách xoay/thu hồi refresh token chưa nói; Prevents ghi CSRF nhưng Rule chỉ có `SameSite=Lax`; cấu hình CORS của API (khác CORS R2) không nêu. Cách cấp tài khoản Admin đầu tiên cũng chưa có.
- **Kích thước tải lên:** presigned PUT không tự giới hạn dung lượng; spine chỉ HEAD sau khi tải xong, nên một đối tượng `in-raw/` lớn vẫn tốn băng thông và lưu trữ trong 1 ngày. Cần ký kèm `Content-Length` hoặc nêu đó là rủi ro chấp nhận.
- **Quy tắc validate đầu vào theo Pipeline** (cạnh ngắn ≥ 512, tỷ lệ 1:2 đến 2:1, định dạng) chưa có nơi duy nhất; AD-8 chỉ nói "định dạng, kích thước thật". FE và BE sẽ viết hai bản. `ffprobe` chạy ở tiến trình nào (API khi tạo Task, trong khi AD-11 nói ffmpeg ở worker) cũng chưa nêu, ảnh hưởng yêu cầu "queued trong 2 giây" của FR-1.
- **Lệch PRD §4.5:** bước chuẩn bị theo PRD gồm "chờ khóa ffmpeg, cắt video", spine ngầm thêm chờ cổng đồng thời (H3). Cần ghi rõ vào PRD hoặc loại khỏi hạn này.

### M8. Deferred có mục mâu thuẫn hoặc chưa an toàn
- "Ghi nhật ký phiên bản ToS (FR-19)" và "khóa tài khoản (FR-21)" bị hoãn xuống cấp feature, trong khi AD-18 đã quyết định cả hai (`tos_version`, `locked_at`).
- "Xóa dữ liệu theo yêu cầu người dùng" xung đột tiềm ẩn với sổ cái append-only và khóa ngoại (xóa cứng hay ẩn danh hóa). Nên ghi nguyên tắc ở mức spine dù triển khai để sau.
- "Open Graph động": xem M7.
- Mục "Kiểm tra khôi phục sao lưu" và mục "Sao lưu" lặp cùng nội dung; nhiều mục (benchmark, xác nhận endpoint hủy, thử khôi phục) thực chất là cổng trước mở bán, không phải hoãn. Nên nhóm thành "Cổng trước mở bán" có chủ và hạn.
- "Chịu lỗi VPS" chỉ có RPO 24 giờ; thiếu RTO và kế hoạch dựng lại (compose + restore + bộ quét dựng lại hàng đợi).

### M9. Các chiều altitude chưa quyết định cũng chưa hoãn
- **Hạ tầng/nhà cung cấp:** nhà cung cấp và vùng VPS, nhà cung cấp tên miền/DNS, có đặt Cloudflare phía trước API hay không (ảnh hưởng IP thật cho AD-12/AD-17), vùng và jurisdiction của R2. Reverse proxy chưa gọi tên và không có trong Stack, nhưng AD-12 phụ thuộc cấu hình "proxy đáng tin".
- **FE hosting:** "Vercel hoặc Cloudflare Pages" là chưa chọn; hai nền dùng preset Nitro khác nhau, ảnh hưởng SSR và OG. Cần chọn hoặc ghi là câu hỏi mở.
- **Vận hành:** không có xoay vòng/lưu trữ log (log Docker mặc định không xoay có thể đầy đĩa VPS), cảnh báo khi cron `pg_dump` thất bại, giám sát VPS (đĩa, RAM, CPU, container chết), chống Telegram gửi lặp. NFR-7 chỉ được đáp ứng nếu các truy vấn trên `tasks` là nguồn đo; nên ghi rõ đó là quyết định.
- **Bảo mật:** quản lý bí mật chỉ là "biến môi trường" (không nói lưu `.env` ở đâu, ai xoay khóa); bảo vệ khu vực `/admin` (MFA, giới hạn IP) không có; sao lưu `pg_dump` chứa dữ liệu cá nhân (hash IP/fingerprint) nhưng chưa nêu mã hóa và phân quyền khóa R2 riêng cho `db-backup/` (lifecycle `in-raw/in/out` không được áp dụng lên đó); tiêu đề bảo mật HTTP/CSP chưa có; dữ liệu cá nhân trong log chưa có chính sách.
- **Môi trường:** có Deferred cho staging. Chưa nêu cách phát triển cục bộ khi RunningHub tốn tiền (nên có adapter giả sau `RunningHubPort`).

### M10. Stack thiếu công nghệ được dùng
Chưa gọi tên và chưa ghim: thư viện OAuth/JWT, Telegram client, thư viện lập lịch, image Node và image base (quyết định ffmpeg/libx264), reverse proxy, Docker/Compose, `pg_dump` client, công cụ sinh VietQR. `redis:7` và `postgres:16-alpine` là tag trôi theo minor, trong khi spine ghim kỹ các gói npm; nên ghim minor hoặc digest và ghi ngày hết hỗ trợ của Redis 7 (chưa kiểm chứng được trong lượt này).

## LOW

### L1. Dọn tài liệu
- Mục Deferred "Nâng Node" còn câu "theo reviewer, chưa kiểm nguồn chính thức": ghi chú meta của reviewer, phải gỡ. (Mốc cuối tháng 4/2027 cho Node 22 khớp lịch phát hành công khai.)
- Nhãn `[ADOPTED]` xuất hiện ở AD-2, 3, 4, 6, 9, 10, 11, 12 nhưng không ở các AD khác và không được định nghĩa; nên bỏ hoặc giải thích. Frontmatter `status: draft`, `companions: []` đúng mẫu nhưng nên cập nhật khi chốt.
- Không còn chú thích hướng dẫn mẫu dạng HTML comment (đã grep).

### L2. Capability map và Binds chưa đồng bộ
- AD-3 và frontmatter `binds` liệt kê FR-20 là đã ràng buộc, nhưng FR-20 hoãn sang v2 (AD-9).
- Hàng "Credit và Tier" không nhắc AD-3 và AD-4 (HOLD khi tạo Task, CAS); hàng "Nạp VietQR" thiếu AD-2, AD-10, AD-18 (kiểm toán duyệt) và AD-17; hàng "Tuân thủ nội dung" thiếu AD-3 (kiểm `consent`) và AD-12 (cam kết khi đăng ký, PRD FR-19).
- Hàng NFR thiếu AD-7 (NFR-2, NFR-7), AD-14 (NFR-7), AD-1 và AD-2 (NFR-4). NFR-1 (không chi phí GPU rảnh) không được AD nào bind rõ (gần nhất là AD-6, AD-9).
- FR-4 (thanh so sánh), FR-2 chia sẻ/tải về và `apps/web` không có quyết định nào ở tầng FE; chấp nhận được nếu coi là cấp feature, nhưng nên ghi vào Deferred.

### L3. Sơ đồ
- Cú pháp mermaid cả ba sơ đồ hợp lệ; ERD dùng `o{` đúng. Sơ đồ triển khai đặt R2 trong khối "Edge" chưa đúng ngữ nghĩa và không thể hiện `in-raw/` (xóa sau 1 ngày), Google OAuth, reverse proxy được gọi tên, hay bảng trạng thái Admin.
- Sơ đồ trạng thái thiếu `queued → failed` (H1). Nhãn `queued → timed_out` chỉ ghi FREE, khớp AD-6. ERD không vẽ `admin_audit → users`.

## Kiểm chứng công nghệ (npm view, 2026-11-01)
Khớp spine: Nuxt 4.6.3 (latest, engines `^22.22.3 || ^24.15.0 || >=26`), `@nestjs/core` 12.3.2 (engines Node >= 20), `@nestjs/bullmq` 12.0.0 (peer `bullmq ^6`, `@nestjs/core ^12`), bullmq 6.5.3 (ioredis chỉ là peer tùy chọn nên việc ghim ioredis 5.11.1 trong Stack là cần thiết), `@prisma/adapter-pg` 7.10.1, `@aws-sdk/client-s3` 3.1161.0, sharp 0.35.5, `@nestjs/throttler` 6.7.1 (peer hỗ trợ Nest 12), ioredis 5.11.1 tồn tại và `latest` đúng là 6.0.0. Prisma 7.10.1 yêu cầu Node `^20.19 || ^22.12 || >=24`; tag `latest` của `prisma` hiện là 8.0.0-rc.29, đúng như spine ghi. Chưa kiểm chứng trong lượt này: các điểm chi tiết của RunningHub (`/status` ngừng bảo trì, `consumeMoney`, định dạng lỗi hết tiền), `@aws-sdk/s3-request-presigner` 3.1161.0 (cùng dòng phát hành với client-s3), và tình trạng hỗ trợ của Redis 7.

## Kiểm tra chéo yêu cầu
- AD-1/AD-16 và `users.held`: `wallet` sở hữu `held`, cùng transaction với bút toán; thống nhất với AD-2. Lỗi nằm ở chỗ khóa user (H2), không ở quyền sở hữu `held`.
- AD-2 và AD-10: dấu HOLD −n, RELEASED +n, CAPTURED 0 cho kết quả `tổng = balance + held` đúng. Chỉ cần sửa danh sách sự kiện (M2).
- AD-5 nhánh khôi phục, job AD-6 và bộ quét: mâu thuẫn ở H1 và H4; còn lại khớp (bộ quét (4) enqueue lại, nhánh "có id thì tiếp tục poll").
- AD-6 `deadline_at`/`prep_deadline_at` với PRD §4.5: 180/360 và 120 giây khớp; lệch ở phần chờ cổng (H3, M7).
- AD-13 với PRD FR-13/UJ-4: các trạng thái đều có đủ nghĩa; thiếu chi tiết ở M5. `awaiting_transfer` là trạng thái thêm so với PRD (chấp nhận được, nên ghi vào PRD).
- AD-14 với AD-5: M4.
- Stack với AD: mọi gói được AD dùng đều có dòng; thiếu công nghệ chưa gọi tên ở M10. Dòng Prisma 7 + adapter-pg khớp ghi chú `prisma.config.ts`.
