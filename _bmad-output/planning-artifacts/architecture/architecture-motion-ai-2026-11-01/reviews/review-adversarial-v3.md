# Review đối kháng vòng 3 — ARCHITECTURE-SPINE (bản đã sửa)

Phạm vi: chỉ các lỗ hổng CÒN LẠI hoặc MỚI phát sinh sau khi spine đóng các mục vòng 1-2 (CAS AD-4, tx handle AD-16, sổ cái có dấu AD-2, bộ quét AD-6, luật submit-crash, khóa R2 AD-8, ngắt mạch AD-14). Mỗi lỗ hổng đã đối chiếu với câu chữ spine; các giả thuyết chỉ suy đoán đã loại ở cuối.

Kết luận: spine tốt hơn rõ rệt, nhưng chưa an toàn để giao nhiều đơn vị làm song song. Có 3 lỗ hổng Cao (khôi phục sau restart mâu thuẫn với CAS, đơn nạp tiền hết hạn trước giờ admin duyệt, Lane/RunningHub bị chiếm bởi job mồ côi và job treo) và nhiều lỗ hổng Trung bình do spine để hở "ai tính số tiền / ai giữ khóa / ai chạy bộ quét".

---

## Cao

### H1. Khôi phục sau restart mâu thuẫn với AD-5 "0 dòng thì job tự hủy" (AD-5 vs AD-6)
- Căn cứ: AD-5: `queued→running` là thao tác đầu tiên của worker, "nếu 0 dòng thì job tự hủy". AD-6: sau restart worker thấy `runninghub_task_id` thì "poll tiếp". Nhưng Task đang `running`, nên khi BullMQ giao lại job (stalled) thì `queued→running` trả 0 dòng, và đơn vị làm theo AD-5 đúng chữ sẽ hủy job. Hai đơn vị cùng đúng chữ AD: worker-unit hủy job; sweeper-unit chờ `deadline_at`. Kết quả: Task có id RunningHub bị `timed_out`/`RH_TIMEOUT`, người dùng được RELEASED dù RunningHub đã chạy xong (GPU đã tốn, kết quả bỏ).
- Hệ quả mở rộng: BullMQ mặc định `maxStalledCount = 1`; qua giới hạn là job `failed` rồi bị xóa (`removeOnFail: true`) khi Task còn `running`. Bộ quét AD-6 chỉ enqueue lại Task `queued` thiếu job, không có luật cho Task `running` thiếu job. Mỗi lần triển khai (`compose up` tạo lại worker) đều đẩy mọi Task đang chạy vào đường này, và `RH_TIMEOUT`/`RH_SUBMIT_UNKNOWN` là lý do hệ thống nên đẩy tỷ lệ lỗi của AD-14 lên, có thể bật `intake_paused` sai chỉ vì deploy.
- Cũng chưa có luật cho Task `running` mà chưa có `submit_started_at` (restart trong lúc ffmpeg cắt video): không nói chạy lại cắt hay không.
- Đề xuất đổi AD:
  - AD-5: tách rõ hai trường hợp. Job nhận `queued→running` 0 dòng thì đọc hàng: nếu `running` và chưa có `submit_started_at` thì tiếp tục từ đầu (cắt, submit) với điều kiện CAS trên `attempt`; nếu có `runninghub_task_id` thì vào thẳng vòng poll; nếu `submit_started_at` mà không có id thì `RH_SUBMIT_UNKNOWN`; nếu terminal thì thoát.
  - AD-6 bộ quét: thêm "Task `running` không có job sống thì enqueue lại" (cùng `jobId = taskId`), đặt `maxStalledCount` cao hơn và `lockDuration` rõ ràng.
  - Thêm luật dừng worker có kiểm soát: SIGTERM thì ngừng nhận job, chờ job đang chạy tới `stop_grace_period`, nếu không xong thì để nguyên cho đường khôi phục; không tính `RH_TIMEOUT` do restart vào tử số AD-14 (đánh dấu `reason_detail=RESTART`).

### H2. Đơn nạp tiền hết hạn 15 phút nhưng admin được phép duyệt tới 08:00 (AD-13 tự mâu thuẫn)
- Căn cứ: AD-13: "đơn quá `expires_at` chuyển `expired` và không duyệt được"; "mã QR và đơn hết hạn sau 15 phút"; "thời hạn duyệt của admin 15 phút trong 08:00-23:00 (ngoài giờ chờ đến 08:00)". Người dùng chuyển khoản lúc 23:30: đơn hết hạn 23:45, admin online 08:00 sáng không duyệt được, tiền đã vào ngân hàng. Bộ đếm "tối đa 3 đơn pending" cũng bị ảnh hưởng.
- Hai đơn vị cùng đúng chữ: đơn vị `topups` chuyển `expired` bằng job quét đúng 15 phút; đơn vị `/admin` hiển thị nút duyệt cho đơn "chờ đến 08:00". Hai bên không thể cùng đúng.
- Đề xuất: tách `qr_expires_at` (hiển thị/tạo mã, 15 phút) và `approve_by` (hạn duyệt = 15 phút trong giờ làm việc, tính theo lịch 08:00-23:00). Chỉ chuyển `expired` theo `approve_by`. Thêm đường có kiểm toán `expired → approved` (admin bắt buộc nhập `bank_ref`, ghi `admin_audit`) cho tiền đã về sau hạn, vì mất tiền khách thật hại hơn một thao tác thủ công.

### H3. Lane = 2 chỉ là Lane của ta; RunningHub và Lane bị chiếm bởi job mồ côi và job treo (AD-6, AD-14)
- Căn cứ (a): `RH_SUBMIT_UNKNOWN` và `RH_TIMEOUT` đều được spine chấp nhận là "job chạy nốt, tốn GPU" vì không xác nhận được hủy. Nhưng RunningHub giới hạn đồng thời theo tài khoản; spine không nói giới hạn đó, mọi con số 180/360 giây cũng chưa nói có gồm hàng chờ phía RunningHub. Khi nhiều Task timeout, job mồ côi chiếm slot phía RunningHub, Task mới bị RunningHub xếp hàng, `deadline_at` của ta trôi, thêm timeout: vòng lặp tự khuếch đại, đồng thời bật ngắt mạch (timeout là lỗi hệ thống) và tiền tệ cũng bị đốt.
- Căn cứ (b): AD-6 hứa "bộ quét cưỡng chế deadline bất kể job còn sống hay không", Prevents có "job treo đóng băng Lane". Nhưng sweeper chỉ sửa DB. Handler còn treo trong ffmpeg, tải R2, upload lên RunningHub (chỉ poll HTTP có timeout 10s) vẫn giữ nguyên slot `concurrency` của BullMQ vì khóa job tự gia hạn; Lane bị đóng băng thật, nhất là khi cả hai Lane cùng treo.
- Đề xuất:
  - AD-6: mọi thao tác trong handler (ffmpeg, R2 get/put, upload RunningHub) chạy với `AbortSignal` hết hạn tại `deadline_at`; ffmpeg bị kill; hết hạn thì handler tự thoát.
  - Thêm bộ đếm "RunningHub đang chạy ước tính" gồm cả job đã timeout hoặc `RH_SUBMIT_UNKNOWN` có id cho đến khi poll thấy kết thúc; bộ quét tiếp tục poll thưa (ví dụ 30 giây) các id mồ côi đó để ghi `gpu_coins` và giải phóng. Giới hạn đồng thời RunningHub của tài khoản ghi thành biến cấu hình, và Lane không được lớn hơn nó trừ đi mồ côi (hoặc tạm dừng nhận job khi vượt).
  - Thêm Task `queued` quá hạn tối đa cho mọi hạng (không chỉ FREE) để không có Task trả phí quay vô hạn (xem M1).

---

## Trung bình

### M1. Task `queued` hạng trả phí không có trạng thái kết thúc; "poison job" quay vĩnh viễn (AD-3, AD-6)
- Căn cứ: chỉ FREE có timeout `queued`. Nếu handler ném lỗi trước `queued→running` (lỗi dựng payload ở `pipelines`, DB chập chờn), job `failed` rồi bị xóa (`removeOnFail: true`), Task vẫn `queued`, 30 giây sau bộ quét enqueue lại, lặp mãi, giữ HOLD và một trong 3 slot AD-17 của người dùng. Không đơn vị nào sai chữ.
- Đề xuất: cột `enqueue_count`/`last_error`; sau N lần (ví dụ 5) hoặc sau X phút thì `failed`/`INTERNAL_ERROR` + RELEASED; đồng thời `INTERNAL_ERROR` vào enum reasonCode (hiện chưa có chỗ cho lỗi hệ thống không phải RunningHub; nếu dùng `RH_ERROR` sẽ sai ngữ nghĩa số liệu).

### M2. Số tiền của RELEASED và định nghĩa "HOLD đang mở" không có nguồn duy nhất (AD-1, AD-2, AD-10, AD-16)
- Căn cứ: ER có `tasks.hold_amount` và `ledger_entries.amount` của HOLD; AD-2 nói RELEASED "trả đúng bằng HOLD của Task", nhưng chữ ký `wallet.release(tx, …)` không quy định số tiền lấy từ đâu. Đơn vị `tasks` truyền `hold_amount` (cột của nó), đơn vị `wallet` có thể đọc hàng HOLD: hai nguồn có thể lệch (ví dụ sửa giá cấu hình giữa chừng, hay bug làm tròn). Tương tự "tổng HOLD đang mở" của AD-10: `wallet` bị cấm đọc bảng `tasks` (AD-1), nên chỉ tính được từ sổ cái bằng "HOLD không có bút toán kết thúc cùng `task_id`"; spine không nói vậy, và truy vấn này chạy trong mọi bút toán.
- Điều không lỗi (đã kiểm): CAPTURED amount 0 làm `balance` không đổi nhưng "balance + HOLD mở" giảm đúng bằng HOLD của Task vừa đóng, nên recompute sau CAPTURED là đúng; RELEASED +n và HOLD mở -n triệt tiêu nhau nên Tier không đổi, hợp lý.
- Đề xuất: AD-2: `release`/`capture` chỉ nhận `taskId`, tự đọc số tiền từ hàng HOLD duy nhất; `tasks.hold_amount` chỉ là bản sao hiển thị và được đối soát. AD-10: "HOLD đang mở" = HOLD không có `CAPTURED|RELEASED` cùng `task_id`, hoặc giữ cột `users.held` do `wallet` cập nhật nguyên tử và đối soát hằng ngày.

### M3. Khóa dòng user chỉ được quy định ở HOLD; tính Tier ở các bút toán khác có thể đọc số liệu cũ (AD-3, AD-10)
- Căn cứ: AD-3 yêu cầu `SELECT … FOR UPDATE`, AD-10 yêu cầu tính Tier "cùng transaction" cho GRANT/TOPUP/ADJUST/CAPTURED/RELEASED nhưng không nói thứ tự: nếu một đơn vị tính Tier từ `balance` đọc trước rồi mới INSERT/UPDATE (ví dụ admin duyệt topup khi worker đang CAPTURED), hai transaction cùng đọc số cũ và ghi `users.tier` theo nhau ngược lại; kết quả khác nhau tùy trình tự. Kiểu "cả hai đều hợp chữ AD" đúng như đề bài.
- Đề xuất: AD-10/AD-16: câu lệnh đầu tiên của mọi hàm `wallet` ghi sổ là khóa dòng user (`FOR UPDATE`), rồi mới đọc số dư/HOLD mở, ghi bút toán, tính Tier. Test đồng thời (topup vs capture) trong CI.

### M4. Tier và ADJUST/GRANT: gói đã bị xóa nhưng credit quay lại (AD-10)
- Căn cứ: "rơi về FREE thì xóa gói đã nạp"; "lần TOPUP sau tính độc lập theo gói vừa nạp". Nhưng `ADJUST`/`GRANT` làm lại số dư mà không mang gói. Admin hoàn credit bù lỗi cho user đã rơi FREE (balance 500 sau ADJUST) mà vẫn là FREE: người dùng có 500 credit nhận hạng FREE, hàng đợi thấp nhất và bị `FREE_WAIT_EXPIRED` sau 15 phút. Spine không nói đây là cố ý hay thiếu.
- Đề xuất: AD-10 thêm bảng quyết định: Tier tính từ (gói đã lưu hoặc ngưỡng credit) và nói rõ ADJUST có đổi Tier không. Nếu có thì ADJUST nhận thêm tham số `pack` tùy chọn có ghi `admin_audit`.

### M5. Hết hạn FREE vs job BullMQ còn tồn tại; ordering của sweeper (AD-6)
- Căn cứ: sweeper chuyển `queued→timed_out` ở DB nhưng không nói gỡ job khỏi BullMQ. Job mồ côi nằm lại trong tập `prioritized`; khi bị lấy sẽ tự hủy (AD-5), vô hại nhưng tốn một lần lấy job. Kiểm tra "Task `queued` thiếu job" cần một truy vấn mỗi Task đến BullMQ (hoặc `getJobs`); với hàng nghìn Task `queued` (đúng loại rủi ro AD-17 nhắc) tốn Redis mỗi 30 giây. Khi `removeOnComplete` bật, "job thiếu" không phân biệt được "đã xong" với "chưa bao giờ có", nhưng may là Task chỉ `queued` khi chưa xong nên vẫn đúng. Mức độ: thấp-trung bình; không lỗi đúng sai, chỉ chi phí/độ rõ ràng.
- Đề xuất: sweeper gỡ job (`job.remove()`) khi chuyển `timed_out`/`cancelled`; thêm giới hạn lô và dùng một lần `getJobs(['prioritized','waiting','active'])` rồi đối chiếu tập hợp thay vì gọi từng Task.

### M6. Cắt video: bộ khóa ffmpeg tính vào `deadline_at` và mâu thuẫn "concurrency" (AD-11 vs AD-6)
- Căn cứ: AD-11 nói "giới hạn số ffmpeg bằng `concurrency`" và ngay sau đó "chỉ một tiến trình ffmpeg trên toàn worker; Lane thứ hai chờ khóa": hai câu mâu thuẫn. Hơn nữa `deadline_at = running_at + 360s` mà `running_at` đặt khi Lane lấy job, trước khi chờ khóa: Lane thứ hai chờ ffmpeg của Lane đầu (re-encode video tối đa Cap giây, có thể hàng chục giây tới phút trên VPS 4 vCPU dùng chung Postgres/Redis) cộng download/upload cũng nằm trong 360 giây, nên sinh ra `RH_TIMEOUT` oan (tính vào tử số AD-14 làm ngắt mạch bật sai). Khóa nội bộ trong tiến trình chỉ đúng nếu có đúng một worker; trong lúc deploy kiểu `up -d` hai worker chồng nhau (thành 4 Lane, 2 ffmpeg).
- Đề xuất: AD-11: bỏ câu "bằng concurrency", giữ một khóa. AD-6: đặt `deadline_at` (hoặc tách `trim_deadline` và `rh_deadline`) sau khi xong ffmpeg và lấy khóa, hoặc cộng thêm ngân sách cắt cố định; ghi `reason_detail` để phân biệt timeout do RunningHub với timeout do cắt. Deploy: `stop_first` (dừng worker cũ rồi mới bật worker mới) hoặc khóa tư vấn Postgres thay cho khóa nội bộ.

### M7. Ngắt mạch: đóng băng khi admin tắt cờ, ngưỡng không bao giờ chạm, và ffmpeg trước khi biết hết tiền (AD-14)
- (a) Admin tắt `intake_paused` thủ công nhưng cửa sổ trượt 30 phút vẫn chứa các lỗi cũ vượt 15%, nên lần đánh giá kế tiếp bật cờ lại ngay. Spine không có điểm reset. Đề xuất: ghi `intake_resumed_at`; cửa sổ chỉ tính Task kết thúc sau mốc đó.
- (b) Ngưỡng "tối thiểu 20 Task trong 30 phút" ở MVP mới ra mắt (lưu lượng thấp) gần như không bao giờ đạt, nên ngắt mạch tỷ lệ gần như không bao giờ hoạt động; chỉ `RH_BUDGET` thực sự bật cờ. Đề xuất: thêm điều kiện đếm tuyệt đối (ví dụ ≥5 lỗi hệ thống liên tiếp) bên cạnh tỷ lệ.
- (c) AD-14 nói các Task `queued` "thử submit, thất bại nhanh", nhưng với Motion, worker cắt video bằng ffmpeg (nối tiếp, cả phút CPU) trước khi submit nên không "nhanh" và còn đốt CPU. Đề xuất: kiểm tra `intake_paused`/`RH_BUDGET` đã biết trước ffmpeg; nếu cờ do `RH_BUDGET` đang bật thì RELEASED ngay mà không cắt.
- (d) Poll số dư RunningHub: spine chưa nói RunningHub có endpoint số dư, đơn vị (USD hay coin) nên ngưỡng "USD 15" chưa so sánh được với `gpu_coins`; chỉ cảnh báo, không tự bật cờ. Đề xuất: ghi giả định cần xác nhận, và khi poll lỗi liên tiếp thì cảnh báo "không poll được". Mức: thấp.

### M8. Luồng presigned: TOCTOU giữa kiểm tra và sao chép, thiếu kiểm tra sở hữu khi xác nhận (AD-8)
- Căn cứ: URL PUT presigned còn hiệu lực sau khi người dùng bấm xác nhận; server `HEAD` rồi kiểm tra nội dung trên "bản đã lưu" rồi `CopyObject`. Người dùng có thể ghi đè `in-raw/` ngay giữa kiểm tra và sao chép (nội dung khác, to hơn 100 MB), nên `in/` chứa bản chưa kiểm. Spine không bắt buộc `CopySourceIfMatch` theo ETag. Ngoài ra bước xác nhận nhận khóa từ client, spine không nói kiểm tra khóa thuộc user và do server cấp (một bảng/phiên hoặc kiểm tiền tố `userId`), nên user B có thể xác nhận khóa của user A nếu lộ.
- Ngoài ra "kiểm tra định dạng/kích thước thật trên bản đã lưu" với video 100 MB buộc API VPS đọc cả tệp hoặc ffprobe qua URL, nhưng Prevents lại nói API không gánh luồng 100 MB. Phân định rõ: chỉ ffprobe qua URL ký (đọc đầu/đuôi) và ảnh qua sharp có giới hạn 10 MB.
- Không giới hạn tổng dung lượng `in-raw/` mỗi người dùng trong 24 giờ (chỉ throttler route).
- Đề xuất: AD-8: bảng `uploads(key, user_id, status, size, etag)` do server tạo cùng presigned URL; xác nhận chỉ chấp nhận khóa của chính user; `CopyObject` kèm `CopySourceIfMatch=etag` đã HEAD; URL presigned có hạn ngắn (5 phút) và `Content-Length` giới hạn khi ký; hạn mức byte `in-raw` theo user/ngày.

### M9. Backup/restore sổ cái (Deferred + Triển khai)
- Căn cứ: RPO 24 giờ cho `pg_dump` 03:00. Sau khôi phục: (1) `topups` đã duyệt trong ngày mất, tiền đã chuyển khoản nhưng không có `bank_ref` trong DB, và nếu admin duyệt lại thì không kiểm trùng được; (2) Redis (AOF) có thể "mới hơn" PG: job cho Task không tồn tại hoặc Task đã khôi phục thành `queued`/`running` với id RunningHub đã xong; handler không có luật cho "Task không tồn tại" hay trạng thái cũ; (3) ledger/`users.balance` bị lệch với thực tế khách đã nhận kết quả (khách có video nhưng credit chưa trừ). Bản thân bất biến AD-2 vẫn đúng sau khôi phục, nên đối soát nội bộ không báo gì.
- Đề xuất: Deferred -> AD ngắn "Khôi phục": sau restore bắt buộc xả Redis (`FLUSHALL`) và để bộ quét dựng lại; handler gặp Task không tồn tại thì thoát; quy trình đối soát tiền với sao kê ngân hàng và nhật ký `admin_audit` trên R2 (xuất sự kiện duyệt topup ra R2 ngay lúc duyệt, append-only) để mất không quá vài phút tiền đã duyệt. Cân nhắc WAL archiving khi có doanh thu.

---

## Thấp

### L1. Ranh giới transaction cho đăng ký và nạp tiền chưa được phủ bởi AD-16 (AD-12, AD-13, AD-1)
- AD-16 chỉ mô tả `tasks` -> `wallet`. Đăng ký (`auth` tạo user + `wallet` GRANT) và duyệt topup (`topups` + `wallet` TOPUP + Tier) cũng cần chung transaction; AD-12 nói "một transaction" nhưng AD-1 cấm `auth` ghi `users.balance/tier`. Đề xuất: mở rộng AD-16 thành quy tắc chung "mọi hàm `wallet` ghi nhận `tx` bắt buộc", nêu rõ `auth` tạo hàng `users` rồi gọi `wallet.grant(tx, …)`.
- `pg_advisory_xact_lock(hash IP)` chỉ tuần tự hóa theo IP; chống trùng fingerprint dựa vào unique, và hai IP khác nhau đua cùng fingerprint sẽ gặp vi phạm unique làm hỏng transaction đăng ký (user không được tạo) thay vì nhận GRANT 0. Đề xuất: `INSERT … ON CONFLICT DO NOTHING` rồi quyết định 0/500, và khóa advisory dùng khóa 64-bit có tiền tố để không đụng khóa khác.

### L2. Chủ sở hữu bộ quét, đối soát, ngắt mạch, poll số dư chưa chỉ rõ tiến trình (AD-6, AD-14, Triển khai)
- Spine nói bộ quét "độc lập với job" nhưng không nói chạy ở `api` hay `worker`; cả hai nơi đều có thể (CAS giữ an toàn nhưng chạy 2 lần). Nếu chỉ ở worker thì worker chết là sweeper cũng chết (timeout FREE, `deadline_at` ngừng được cưỡng chế). Nếu ở api thì api lại giữ BullMQ producer và Telegram. Đề xuất: ghi "bộ quét và cron của `ops` là BullMQ repeatable job trong `worker` + một watchdog ở `api` cảnh báo Telegram nếu heartbeat của sweeper quá 2 phút".

### L3. `queued_at` gốc khi enqueue lại không bảo đảm FIFO, chấp nhận được nhưng nên ghi vào test (AD-3, AD-6)
- Spine đã nêu "FIFO có thể lệch nhẹ", nên không phải lỗi; chỉ ghi chú để khỏi bị coi là bug sau này.

---

## Đã kiểm và loại (suy đoán hoặc spine đã bao phủ)
- Tranh chấp CAS giữa timeout/hủy/sweeper/kết quả muộn: AD-4 xử lý đủ; kết quả muộn chỉ để lại file mồ côi trong `out/`, lifecycle 30 ngày dọn.
- Enqueue đồng thời của API và bộ quét cho cùng `jobId`: BullMQ bỏ qua trùng khi job còn; khi job đã xóa thì thêm lại được; an toàn.
- `CAPTURED` amount 0 làm sai bất biến SUM: không, vì HOLD (-n) đã được trừ ngay, CAPTURED chỉ đánh dấu (xem M2 về nguồn số tiền).
- `removeOnComplete` vs sweeper chặn enqueue lại: spine đã đặt `removeOnComplete: true`, nên không còn job cũ chặn `jobId`.
- Hold hai lần/Release hai lần: ràng buộc unique một phần của AD-2 chặn.

## Tóm tắt đề xuất thay đổi AD
| Hole | AD cần sửa |
| --- | --- |
| H1 | AD-5 (nhánh khôi phục thay cho "0 dòng thì hủy"), AD-6 (sweeper Task `running` thiếu job, SIGTERM) |
| H2 | AD-13 (`qr_expires_at` và `approve_by`, đường `expired→approved` có kiểm toán) |
| H3 | AD-6 (AbortSignal tới `deadline_at`, theo dõi mồ côi, giới hạn đồng thời RunningHub) |
| M1 | AD-3/AD-6 (`enqueue_count`, `INTERNAL_ERROR`, trần thời gian `queued` mọi hạng) |
| M2 | AD-2/AD-10 (số tiền RELEASED từ hàng HOLD; định nghĩa HOLD mở hoặc `users.held`) |
| M3 | AD-10/AD-16 (khóa user là câu lệnh đầu của mọi hàm ghi `wallet`) |
| M4 | AD-10 (ADJUST/GRANT và Tier) |
| M5 | AD-6 (gỡ job khi timed_out/cancelled, đối chiếu theo lô) |
| M6 | AD-11/AD-6 (bỏ mâu thuẫn concurrency, `deadline_at` sau khóa ffmpeg, deploy stop-first) |
| M7 | AD-14 (mốc resume, ngưỡng tuyệt đối, kiểm cờ trước ffmpeg, giả định API số dư) |
| M8 | AD-8 (bảng `uploads`, ETag-conditional copy, sở hữu khóa, hạn mức byte) |
| M9 | Deferred -> AD khôi phục (xả Redis, xuất sự kiện topup ra R2, quy trình đối soát) |
| L1-L2 | AD-16 mở rộng, AD-12 `ON CONFLICT`, vị trí chạy sweeper |
