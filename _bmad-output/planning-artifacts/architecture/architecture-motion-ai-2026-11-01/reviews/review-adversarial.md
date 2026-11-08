---
type: review-adversarial
target: ARCHITECTURE-SPINE.md
date: 2026-11-01
---
# Review đối kháng — Architecture Spine flowvis

**Phương pháp:** với mỗi lỗ hổng, dựng hai đơn vị (hai engineer / hai code path) đều tuân thủ từng chữ của mọi AD nhưng build ra hệ thống không tương thích hoặc sai tiền. Mỗi lỗ hổng đã lý giải lại từ văn bản AD, không suy đoán.

**Kết luận: CHƯA ĐẠT (needs revision).** Có 4 lỗ hổng mức Critical/High liên quan trực tiếp đến tiền và GPU. Khung AD đúng hướng (DB là trọng tài, ledger append-only) nhưng thiếu "bản lề" giữa các AD: ranh giới transaction giữa module, điều kiện nguồn của chuyển trạng thái, và ngữ nghĩa dấu của bút toán.

---
## H-1 [Critical] Cổng AD-4 cho phép sweeper/cancel ghi đè Task đang `running` (đua queued→running vs timed_out/cancelled)
- **Đơn vị A (worker):** lấy job, gọi `tasks.transition(id, running, …)`, bắt đầu submit RunningHub (tốn GPU thật).
- **Đơn vị B (sweeper FREE, AD-6):** chọn Task FREE `queued` quá 15 phút, rồi chạy cổng AD-4: `UPDATE … SET status='timed_out' WHERE id=? AND status NOT IN (terminal)`.
- **Vì sao đúng từng chữ AD:** AD-4 định nghĩa điều kiện là "NOT IN terminal", chứ không phải "status = trạng thái nguồn mong đợi". `running` không nằm trong terminal, nên UPDATE của B khớp 1 dòng ngay cả khi A đã chuyển sang `running` giữa lúc SELECT và UPDATE. B thắng, ghi `RELEASED`, trong khi A vẫn đang chạy GPU. Kết quả: credit hoàn, GPU đã tiêu, kết quả bị bỏ (A thua cổng sau đó). Mỗi lần là một khoản GPU miễn phí cho người dùng. Cùng cơ chế: yêu cầu hủy (PRD nói chỉ hủy được khi `queued`) khớp cả Task `running` vì AD-4 không giữ điều kiện nguồn; AD-5 liệt kê `queued→cancelled` nhưng AD-4 mâu thuẫn bằng điều kiện rộng hơn. Hai trọng tài (AD-4 và bảng chuyển hợp lệ AD-5) không được nối với nhau.
- **Ngược lại:** Task đã `cancelled`/`timed_out` ở `queued` nhưng job BullMQ vẫn còn trong hàng; worker lấy job và, nếu không kiểm tra, submit RunningHub cho Task đã Release. AD-6 không bắt worker kiểm tra trạng thái trước khi submit, cũng không bắt gỡ job.
- **Đóng bằng AD mới (AD-16 "Chuyển trạng thái có điều kiện nguồn"):** mọi UPDATE trạng thái phải là compare-and-set `WHERE id=? AND status = <from>` với `from` lấy từ bảng AD-5 (không dùng NOT IN). `queued→running` là CAS và là cổng bắt buộc đầu tiên của job; rowcount 0 thì job thoát không làm gì. Hủy/timeout-queued chỉ từ `queued`; timeout-running chỉ từ `running`. Khi hủy/timeout ở `queued`, gọi `queue.remove(jobId)` best effort, và CAS ở worker là lưới an toàn.

## H-2 [Critical] Khóa Redis tầng 1 của AD-4 có thể làm Task kẹt vĩnh viễn và chặn chính sweeper
- **Đơn vị A (worker):** `SET NX task:terminal:<id>` thành công, rồi crash (hoặc transaction DB ném lỗi, ví dụ vi phạm ràng buộc) trước khi UPDATE commit.
- **Đơn vị B (sweeper/timeout):** cũng đi qua cổng hai tầng như AD-4 quy định; tầng 1 thất bại vì khóa còn đó, "bên thua bỏ qua im lặng".
- **Hậu quả:** Task ở `running`, Hold giữ nguyên, mọi bên khác đều im lặng bỏ qua cho đến hết TTL ("dài hơn timeout lớn nhất", tức nhiều phút đến nhiều giờ). Trong khoảng đó 1 trong 2 Lane có thể bị chiếm bởi job zombie nếu poll không dừng. Mệnh đề "Redis mất thì vẫn đúng" chỉ đúng chiều Redis mất, không đúng chiều Redis giữ khóa mồ côi. Tầng 1 không mang lại tính đúng, chỉ thêm đường lỗi.
- **Đóng:** bỏ tầng 1 khỏi đường đúng đắn (chỉ DB CAS quyết định), hoặc nếu giữ như tối ưu thì: khóa chỉ là gợi ý, thất bại lấy khóa không được dừng đường xử lý mà phải rơi xuống CAS; khóa phải được giải phóng khi transaction rollback; sweeper bỏ qua tầng 1.

## H-3 [Critical] Ranh giới transaction giữa `tasks` và `wallet` không được định nghĩa (AD-1 mâu thuẫn AD-4)
- **Đơn vị A (tasks):** theo AD-4, mở transaction Prisma, CAS trạng thái, rồi gọi `wallet.capture(taskId)`.
- **Đơn vị B (wallet):** theo AD-1 "chỉ wallet ghi ledger", `wallet.capture` tự mở `prisma.$transaction` riêng cho bút toán + `users.balance` + tính lại Tier.
- **Hậu quả:** hai transaction. Crash giữa chúng: Task đã `succeeded` mà không có CAPTURED (người dùng được video miễn phí, Hold treo vĩnh viễn, balance thấp hơn thực), hoặc ngược lại. Ràng buộc unique chặn trùng nhưng không sửa được trạng thái nửa vời; cổng CAS lần sau thấy Task đã terminal nên "bên thua bỏ qua im lặng", không ai vá bút toán. AD-4 nói "cùng transaction" nhưng không nói truyền transaction qua ranh giới module bằng cách nào (Prisma tx client / CLS / tham số `tx`).
- **Đóng (AD mới "Tx-context"):** API công khai của `wallet` nhận bắt buộc tham số `tx` do `tasks` mở (`wallet.settleInTx(tx, …)`), cấm `wallet` tự mở transaction cho các thao tác gắn Task. Thêm sweeper đối soát: Task terminal thiếu bút toán kết thúc, hoặc có HOLD mở mà Task đã terminal, là bất biến bị vi phạm, phải báo động.

## H-4 [High] Ngữ nghĩa dấu và tác động `balance` của HOLD/CAPTURED/RELEASED không xác định
- AD-2 nói `users.balance` là "số dư khả dụng" đổi cùng bút toán; FR-9 nói "số dư là tổng bút toán"; AD-3 trừ `balance` ngay khi HOLD. Spec không nói `amount` mang dấu nào cho từng loại, và CAPTURED có đụng `balance` hay không.
- **Đơn vị A:** HOLD = −100 và trừ balance; CAPTURED = −100 (vì "trừ hẳn"), trừ balance lần nữa → thu **gấp đôi**. RELEASED = +100.
- **Đơn vị B:** CAPTURED = 0 hoặc amount dương chỉ để ghi nhận, không đụng balance. Hai cách đều thỏa AD-2. Báo cáo/đối soát cũng lệch (tổng ledger ≠ balance tuỳ cách).
- **Đóng:** chốt bảng: HOLD: `amount = −n`, `balance −= n`; CAPTURED: `amount = 0`, `balance` không đổi, `ref_amount = n`; RELEASED: `amount = +n`, `balance += n`; bất biến kiểm: `balance = SUM(amount)` trên user, thêm test và job đối soát. Thêm cột `users.held` (hoặc view) cho tổng HOLD mở dùng ở AD-10, tránh mỗi nơi tự tính.

## H-5 [High] Ngắt mạch AD-14 bị đầu độc bằng lỗi do người dùng, đồng thời đốt GPU miễn phí
- AD-9 buộc `NO_POSE`/`NO_FACE` chạy ở RunningHub (tốn GPU) rồi `failed` + RELEASED. AD-14 đếm mọi `failed + timed_out`, chỉ loại `rejected`/`cancelled`, không xét `reasonCode`.
- **Khai thác:** kẻ xấu (hoặc nhiều tài khoản FREE × 500 credit) gửi video không có người: mỗi Task tốn GPU RunningHub nhưng được hoàn 100% (chi phí thật bằng 0 cho attacker), đồng thời đẩy tỷ lệ lỗi lên trên 15% → `intake_paused` → toàn bộ khách trả phí nhận 503. DoS dịch vụ chỉ với vài tài khoản. Thêm: cửa sổ 30 phút không có mẫu tối thiểu, nên 1 lỗi trên 2 Task (50%) đã cắt mạch.
- **Đóng:** AD-14 chỉ đếm lỗi hệ thống (`RH_ERROR`, `RH_TIMEOUT`, `OUTPUT_INVALID`), loại `NO_POSE`/`NO_FACE`/`MODERATION`/`USER_CANCEL`; đặt mẫu tối thiểu (ví dụ ≥ 20 Task); giới hạn tần suất Task `failed` do người dùng theo tài khoản (cooldown/khóa sau N lần `NO_POSE`/giờ); ưu tiên phát hiện khung xương ở API (frame đầu bằng ffmpeg) trước khi Hold để không đốt GPU.

## H-6 [High] Presigned upload: TOCTOU, IDOR khóa file, kích thước không bị ép
- **TOCTOU:** AD-3 kiểm tra (ffprobe, nsfwjs) trước HOLD trên đối tượng R2; presigned PUT còn hiệu lực cho phép người dùng ghi đè cùng key sau khi đã qua Pre-check nhưng trước khi worker tải input lên RunningHub. Họ đưa ảnh NSFW/video dài hơn (giá đã tính theo video cũ, ffprobe cũ) vào pipeline: vượt kiểm duyệt và đốt GPU nhiều hơn số credit Hold. AD-8 không ghim phiên bản/ETag.
- **IDOR:** Task nhận key `in/...` từ client; AD-8 không bắt key gắn `userId` và server phát sinh. Người dùng A nộp Task với key của B (key lộ qua link, log) → A nhận kết quả xử lý ảnh riêng của B.
- **Kích thước:** presigned PUT không ép được `content-length` (cần presigned POST với `content-length-range`), PRD giới hạn 10 MB/100 MB chỉ do FE. Upload không giới hạn số lượng; lifecycle 7 ngày không chặn chi phí lưu trữ/egress trong thời gian đó.
- **Đóng (AD mới):** key do server sinh dạng `in/<userId>/<uploadId>`, mỗi `uploads` row ghi owner, size, content-type, ETag/`version`; dùng presigned POST với điều kiện size/type, hạn ≤ 5 phút; bước "confirm" HEAD đối tượng, kiểm ETag, rồi **sao chép sang key bất biến** (`in/<userId>/<taskId>/…`) mà từ đó mới đưa vào Pre-check/ffprobe/worker; Task chỉ tham chiếu `uploadId` thuộc cùng user; quota upload chưa gắn Task theo user.

## H-7 [High] Cửa sổ crash giữa submit RunningHub và ghi `runninghub_task_id`, cùng retry chồng lớp
- AD-6 yêu cầu "ghi ngay sau khi submit" nhưng giữa response và UPDATE DB luôn có cửa sổ crash. Job chạy lại thấy `runninghub_task_id` null → submit lần hai → hai job GPU, chỉ một id được theo dõi, một khoản GPU bị mồ côi (cả hai cùng cung cấp bởi khách đã bị Release hoặc Capture một lần).
- PRD §4.5 yêu cầu "thử lại 1 lần sau 5 giây với idempotency key theo Task ID", AD-6 không nhắc; nếu engineer bật BullMQ `attempts` (mặc định mọi ví dụ NestJS) thì có thêm lớp retry thứ hai. Hai lớp retry × cửa sổ crash = tối đa nhiều job RunningHub cho một Task, trong khi RunningHub có thể không hỗ trợ idempotency key thật sự (cần xác minh).
- **Đóng (AD mới):** (1) ghi `submit_state='submitting'` + `attempt_no` trước khi gọi; (2) nếu khởi động lại thấy `submitting` mà không có id thì tra cứu/đối soát theo tham số nhận dạng gắn trong payload (nếu RunningHub hỗ trợ) hoặc fail-safe `failed`/Release và ghi cảnh báo thay vì submit lại mù quáng; (3) BullMQ `attempts: 1`, một chính sách retry duy nhất do worker kiểm soát; (4) đặt `removeOnComplete/Fail` (xem H-8).

## H-8 [High] `jobId = taskId` làm bộ quét enqueue lại thành no-op im lặng
- BullMQ bỏ qua `add` khi `jobId` đã tồn tại (kể cả job đã completed/failed còn lưu). AD-3 và AD-6 dùng cùng `jobId`, không quy định `removeOnComplete/removeOnFail`. Sweeper "enqueue lại Task queued thiếu job" thấy job cũ ở trạng thái failed/completed → `add` trả về job cũ, không có job mới chạy; Task kẹt `queued` đến khi FREE hết hạn, hoặc với Task trả phí thì vĩnh viễn (không có hạn queued cho Task trả phí!). Bộ quét tự cho là đã xử lý.
- Thêm: Task trả phí `queued` không có timeout nào (AD-6 chỉ quét FREE), nên mất Redis + lỗi quét = Hold giữ vô hạn.
- **Đóng:** quy định `removeOnComplete: true, removeOnFail: true`; sweeper phải kiểm tra `queue.getJob` theo trạng thái và `remove` job chết trước khi `add`; thêm trần chờ `queued` cho mọi Tier (ví dụ 60 phút → `timed_out`/`QUEUE_STUCK`) làm lưới cuối.

## H-9 [Medium-High] Job treo không có người cứu; Lane bị đóng băng
- Sweeper chỉ xử lý "running quá hạn mà **không còn job**". Job còn sống nhưng treo (HTTP poll không có timeout, hoặc đang chờ RunningHub trả về) sẽ không bị sweeper đụng; chỉ phép đo hạn chót nằm trong chính job. `concurrency=2` nghĩa là hai job treo là cả hệ thống ngừng, và FR-17 ("quét quá 360 giây rồi timed_out") không đạt.
- Schema thiếu `running_at`/`deadline_at`/`queued_at` nên hai đơn vị tự chọn cách tính hạn khác nhau (có/không tính tải kết quả về R2, tính từ `created` hay `running`).
- **Đóng:** thêm cột `queued_at, running_at, deadline_at`; sweeper cưỡng chế hạn chót bất kể job còn sống (CAS `running→timed_out`), đồng thời job tự hủy khi thấy trạng thái đã đổi (kiểm tra trước mỗi poll, AbortController cho mọi HTTP có timeout ≤ 10 giây). Quy định hạn chót bao gồm cả tải kết quả (khớp PRD).

## H-10 [Medium] Tier: ai kích hoạt tính lại, và đọc từ đâu
- AD-10 quy định điều kiện rơi về FREE trên `balance + HOLD mở` nhưng không nói **thời điểm** tính lại. Đơn vị A tính lại khi TOPUP, HOLD và ADJUST; đơn vị B tính thêm cả khi CAPTURED (tổng sở hữu giảm). Hệ quả: A giữ Creator với tổng 40 cho đến lần HOLD kế tiếp, B hạ ngay. Hai hệ thống hiển thị tier/priority khác nhau.
- Snapshot: sweeper re-enqueue phải lấy priority từ `tasks.tier_snapshot`, không từ `users.tier`; AD-6 không nói rõ, một engineer dùng `users.tier` sẽ làm đổi priority sau khi nâng cấp/hạ cấp. Re-enqueue cũng làm mất vị trí FIFO (counter mới) trong khi UI hiển thị vị trí.
- **Đóng:** liệt kê chính xác sự kiện kích hoạt (mọi thao tác của wallet ghi ledger: TOPUP, CAPTURED, RELEASED, ADJUST; HOLD thì không), tính lại là một hàm thuần trong cùng transaction; re-enqueue dùng `tasks.tier_snapshot` và `timestamp` gốc của `queued_at` (BullMQ không cho giữ FIFO nên ghi nhận ngoại lệ rõ ràng, hoặc dùng `priority` kết hợp composite).

## H-11 [Medium] Hai chủ sở hữu cột của `tasks`; vị trí xử lý job mơ hồ
- AD-1 chỉ giao `tasks.status` cho `tasks`. Các cột `runninghub_task_id`, `gpu_coins`, `reason_code`, `tier_snapshot`, `hold_amount` không có chủ. `pipelines` (dựng payload), worker processor và `tasks` đều có lý do ghi chúng; processor thuộc module nào cũng không nêu. Hai đơn vị khác nhau ghi `reason_code` ngoài `transition` (AD-5 đòi `reasonCode` đi qua `transition`, nhưng worker ghi chuỗi lỗi thô vào cột) là rất dễ xảy ra.
- `NO_POSE` ánh xạ sang `rejected` hay `failed`: sơ đồ trạng thái chỉ cho `rejected` từ `[*]` (trước Hold) nhưng PRD FR-5 dùng từ "reject" cho lỗi ở worker. Nếu một bên chọn `rejected` + RELEASED thì bất biến "rejected không có bút toán" gãy, và nó rơi khỏi mẫu số của AD-14.
- **Đóng:** AD-1 mở rộng: `tasks` sở hữu **mọi** cột của bảng `tasks` (kể cả `runninghub_task_id`, `gpu_coins`); processor nằm trong `tasks` (gọi `pipelines` qua port để dựng payload); `rejected` chỉ có trước Hold, mọi lỗi sau Hold là `failed`.

## H-12 [Medium] FREE bị bỏ đói + concurrency=2: hậu quả chưa được thiết kế
- Theo FR-8 FREE chỉ chạy khi không còn Task trả phí. Với tải trả phí liên tục, mọi Task FREE đều `timed_out` sau 15 phút (đúng ý nhưng mỗi cái còn tốn 1 Hold/Release, 1 lần Pre-check nsfwjs, và 1 bản ghi). Kẻ tấn công dùng 500 credit tặng × nhiều tài khoản làm đầy hàng đợi FREE (không giới hạn số Task `queued` mỗi người dùng) và buộc sweeper xử lý hàng nghìn Task; ngược lại không có trần số Task `queued` của một user.
- Task video 360 giây trên 2 Lane: hai video Creator liên tiếp chặn ảnh 3–5 giây của khách khác tới 6 phút mà PRD hứa "xen kẽ tự nhiên", điều đó chỉ đúng khi cùng Tier. Không có đo lường hoặc cảnh báo SLA hàng đợi.
- **Đóng:** giới hạn Task đang `queued/running` theo người dùng (ví dụ 3), và theo IP đối với FREE; sweeper FREE xử lý theo lô có LIMIT; ghi nhận rõ trong AD-6 rằng hàng đợi một-lane là quyết định đã chấp nhận rủi ro SLA ảnh.

## H-13 [Medium] Nạp tiền: thiếu hạn hiệu lực và khoá số tiền
- AD-13 không có `expires_at` và không ghi `amount_vnd` cố định lúc tạo; PRD hứa QR hiệu lực 15 phút. Admin duyệt `pending` quá hạn vẫn cộng credit (đơn vị A), đơn vị B từ chối đơn quá hạn. Người dùng spam nhiều `pending` khác nhau cho cùng một giao dịch ngân hàng thật rồi xin duyệt nhiều lần: UNIQUE `code` chỉ chặn trùng mã, không chặn một chuyển khoản chuyển thành nhiều đơn.
- **Đóng:** `topups(amount_vnd, pack, expires_at, bank_ref unique nullable)`; duyệt bắt buộc nhập `bank_ref` duy nhất của giao dịch ngân hàng; giới hạn số `pending` mỗi user; trạng thái `expired` có chủ.

## H-14 [Low-Medium] Ràng buộc DB mà Prisma không biểu diễn được
- AD-2 dựa vào: unique một phần `(task_id)` cho `HOLD`, unique một phần cho `{CAPTURED, RELEASED}` và `CHECK (balance >= 0)`. Prisma schema không khai báo được chỉ mục một phần hay CHECK; chỉ có thể nằm trong migration SQL thủ công, và lần `migrate dev` kế tiếp có thể báo drift hoặc bị người khác tạo lại migration mất ràng buộc. Toàn bộ an toàn tiền phụ thuộc vào đó.
- **Đóng:** AD nêu rõ ràng buộc nằm trong migration SQL thô, kèm test tích hợp chạy trên Postgres thật khẳng định hai ràng buộc tồn tại và từ chối ghi trùng (kiểm trong CI).

---
## Thứ tự ưu tiên đóng
1. H-1 + H-2 + H-3 (cổng CAS, bỏ khóa Redis khỏi đường đúng, ranh giới tx) gộp thành một AD "Máy trạng thái CAS và tx-context".
2. H-4 (bảng dấu ledger) và H-7/H-8 (submit crash, jobId).
3. H-6 (upload) và H-5 (breaker poisoning) trước khi mở bán, vì liên quan trực tiếp đến chi phí GPU và an toàn nội dung.
4. H-9..H-14 làm trước epic tương ứng.
