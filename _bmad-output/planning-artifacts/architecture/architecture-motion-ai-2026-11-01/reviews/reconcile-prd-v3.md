# Đối soát PRD (v3) với ARCHITECTURE-SPINE

Phạm vi: `ARCHITECTURE-SPINE.md` so với `prd.md`, `addendum.md` (cùng thư mục PRD) và `.memlog.md` của spine. Chỉ đọc, không sửa tài liệu nào. Ngày: 2026-11-01.

Lưu ý nguồn: `.memlog.md` bị hỏng một phần (nhiều dòng cắt cụt, lẫn chữ, ví dụ dòng "OPEN (1)…", "PRD must Hold/Settle/Release…", dòng cuối "[33 1 ERROR, 5 FAIL]"). Các quyết định đọc được đều đã vào spine; những dòng hỏng không thể xác minh.

## Tóm tắt mức độ

| # | Phát hiện | Mức |
| --- | --- | --- |
| G1 | Vòng đời đơn nạp VietQR: PRD và AD-13 mâu thuẫn hoặc thiếu trạng thái | Cao |
| G2 | Sơ đồ ERD có khả năng không hợp lệ cú pháp Mermaid và thiếu thực thể mà AD đã nêu | Trung bình-cao |
| G3 | Nhóm tuân thủ FR-19, FR-21, FR-22 và tham số `consent` không có AD nào ràng buộc | Trung bình |
| G4 | Tính năng người dùng thấy không có AD: hủy Task, vị trí hàng đợi; thiếu `reasonCode` cho vài lỗi PRD | Trung bình |
| G5 | Quy tắc spine thêm mà PRD chưa đồng bộ; hạn chót 180/360 giây còn chứa cả chờ khóa ffmpeg | Trung bình-thấp |
| G6 | NFR-7, PRD §12, các điểm nhỏ của sơ đồ triển khai, mục mở của memlog chưa vào Deferred | Thấp |

## (a) Yêu cầu PRD chưa có AD hoặc dòng Capability map phủ

Capability map gộp theo dải FR; "có tên dải" không có nghĩa có AD cụ thể. Các điểm rỗng thật sự:

1. **FR-19 (ToS và `consent`)**
   - Map chỉ trỏ AD-8 cho FR-19..22.
   - AD-3 bước (1) "validate đầu vào" không nêu kiểm `consent`. PRD bắt buộc cho mọi Task, khi tạo tài khoản và khi nạp tiền.
   - Không có thực thể lưu thời điểm và phiên bản ToS đã đồng ý (không có trong ERD hay AD).
   - Deferred có ghi "ghi nhật ký phiên bản ToS (FR-19)" là cấp feature/epic. Nhưng việc `consent` nằm trong hợp đồng tạo Task và trong transaction đăng ký (AD-12) là chuyện kiến trúc.
2. **FR-21 (khóa tài khoản vi phạm lặp lại)**
   - Không có cột hay trạng thái khóa trên `users`.
   - Không có điểm cưỡng chế ở auth, route tạo Task, hay thu hồi refresh token.
   - Không có "nhật ký phục vụ điều tra".
   - Deferred chỉ nhắc tên.
3. **FR-22 (báo cáo, gỡ khẩn cấp)**
   - AD-8 chỉ nói "Admin xóa token và file ngay".
   - Không có bảng token chia sẻ (cũng không có trong ERD) và không có nơi nhận báo cáo.
   - `admin_audit` chỉ được AD-13 gắn với topup. Acceptance của FR-22 yêu cầu ghi nhật ký thao tác xóa file.
   - Cần nêu rõ `admin_audit` dùng chung cho mọi thao tác admin (duyệt, từ chối, ADJUST, xóa file, tắt `intake_paused`).
4. **FR-8 (hiển thị vị trí hàng đợi)**
   - Không có AD nào định nghĩa cách tính vị trí.
   - BullMQ priority khiến vị trí là hàm của (priority, `queued_at`) trên DB, không đọc từ Redis. Cần một dòng quy tắc, vì AD-15 cấm coi Redis là nguồn sự thật.
5. **FR-10 / FR-15 và §4.5 (hủy Task khi còn `queued`)**
   - Chuyển trạng thái `queued→cancelled` và `USER_CANCEL` có trong AD-5.
   - Không có AD nào mô tả luồng API: endpoint, kết quả khi Task đã `running` ("yêu cầu hủy đến muộn bị bỏ qua", FR-10), cách job BullMQ còn lại tự hủy (đã ngầm đúng nhờ `queued→running` CAS nhưng chưa nói).
6. **FR-14 (đối chiếu, từ chối cần lý do)**
   - `topups` không có cột lý do từ chối.
   - UJ-4 nêu trạng thái "Cần xem xét" (sai nội dung hoặc sai số tiền). AD-13 chỉ có `pending → approved | rejected | expired`.
7. **FR-4 (so sánh trước/sau)**
   - Thuần FE, chấp nhận được không có AD.
   - Nhưng `in/` hết hạn sau 7 ngày (AD-8) trong khi `out/` giữ 30 ngày. Trang Lịch sử sau ngày 7 không còn ảnh "trước". Cần quyết định hành vi và ghi lại.
8. **FR-2 NFR riêng (SLA Face Swap ≤ 60 giây)**
   - Spine chỉ có hạn chót 180 giây. Không có phép đo hay cảnh báo cho mốc 60 giây.
9. **NFR-7 (đo tỷ lệ thành công, thời gian xử lý, chi phí GPU thực tế)**
   - Chỉ có `gpu_coins`, `queued_at`, `running_at`.
   - Không có mốc `finished_at` hay thời điểm tải xong; "Quan sát" bị hoãn sang Deferred. Có thể dựng lại từ DB nhưng chưa nêu.
10. **PRD §12 (benchmark tiền phát hành) và §11**
    - Không có AD hay dòng Deferred.
    - Chỉ số §12 cần "giây GPU thực tế trên giây video" và "sai số thời lượng Trim so với MP4": cả hai chưa được lưu (chỉ có `gpu_coins`).
    - Kế hoạch B ("đổi biểu phí, không đổi kiến trúc") đã được AD-11 hỗ trợ, vì bảng giá nằm trong cấu hình server.
    - §11 "voucher/affiliate ≤ 15%" không tác động kiến trúc.
11. **§7.1 "dashboard admin tối thiểu"**
    - Spine chỉ nhắc `/admin` cho topups. Chưa có đặc tả tối thiểu: danh sách đơn, `intake_paused`, ADJUST, xóa file, xem ledger.
    - Cần để epic admin không tự chế.

Phần đã phủ tốt (kiểm lại): FR-1,3,6,7 (AD-8, AD-11), FR-5 (AD-9), FR-9..11 (AD-2, 10, 16), FR-12 (AD-12), FR-13 (AD-13, nhưng xem G1), FR-15..18 (AD-4..7, 14), FR-20 (Deferred), NFR-1..4, NFR-6 (AD-8; Open Graph để epic).

## (b) Mâu thuẫn và lệch giữa PRD và spine

Đã nhất quán (không cần sửa): từ vựng HOLD/CAPTURED/RELEASED (PRD §3, FR-9, FR-10 trùng AD-2); không còn `rejected` của Task; Pre-check hoãn v2 (AD-3, AD-9, Deferred khớp FR-20 và §7.2); hạn chót 180/360 giây tính từ `running_at`; luật Tier (AD-10 khớp FR-11, kể cả công thức `balance + HOLD đang mở` < 100); Priority nhỏ chạy trước, FREE chờ 15 phút, 2 Lane; hành vi `RH_BUDGET` (503 `PAUSED` chỉ ở route tạo Task, queued fail nhanh + RELEASED, đăng nhập/nạp/lịch sử/tải vẫn chạy).

### B1. VietQR 15 phút (mâu thuẫn thật, liên quan G1)
- PRD FR-13: QR hiệu lực 15 phút; người dùng bấm "Đã chuyển khoản" thì mới tạo yêu cầu `pending`. Admin duyệt trong 15 phút trong giờ 08:00–23:00. Yêu cầu tạo ngoài giờ "chờ đến 08:00 sáng hôm sau", và nếu đã quá hạn QR thì người dùng tạo mã mới.
- AD-13: bản ghi `topups` có `expires_at` = 15 phút, mã QR và đơn cùng hết hạn sau 15 phút, đơn quá `expires_at` chuyển `expired` và "không duyệt được". Thời hạn duyệt 15 phút, ngoài giờ chờ đến 08:00.
- Hệ quả:
  - Đơn tạo 22:50 mà admin duyệt lúc 08:00 sẽ luôn là `expired`, nên khách đã chuyển tiền thật vẫn không được cộng credit. Điều này tự mâu thuẫn với câu "chờ đến 08:00".
  - Không rõ `expires_at` đo từ lúc sinh QR hay lúc bấm "Đã chuyển khoản". Spine không có trạng thái cho "đã sinh QR nhưng chưa bấm" (PRD cho rằng đơn chưa tồn tại lúc đó), nên ranh giới giữa hai sự kiện không có chỗ lưu.
  - Giới hạn "tối đa 3 đơn `pending` mỗi người" (AD-13) là quy tắc mới, không có trong PRD.
- Đề xuất: tách hai hạn. Hạn QR (thời gian được phép bấm "Đã chuyển khoản") và hạn duyệt của admin. Thêm trạng thái trung gian hoặc quy ước "đơn đã bấm xác nhận không bị `expired` theo QR". Cần quyết định của người dùng.

### B2. Vòng đời Task: `created`
- PRD §4.5: `created → queued → …`. Spine: `[*] → queued` (HOLD thành công, không có trạng thái `created`). Lệch nhẹ về từ vựng; nên bỏ `created` khỏi PRD hoặc ghi chú đây chỉ là bước tiền transaction.
- PRD bảng tham số `pose_video`: "Task bị reject (xem FR-5)". Từ "reject" còn sót, trong khi FR-5 là `failed`. Nên đổi chữ trong PRD.
- Trạng thái `rejected` của `topups` (AD-13) trùng tên với trạng thái đã bị xóa khỏi Task. Hợp lệ nhưng dễ gây hiểu nhầm trong ghi chú "rejected state removed". Nên nêu rõ trong AD-13 là enum của đơn nạp.

### B3. Thử lại submit với lỗi 5xx
- PRD bảng lỗi: "RunningHub trả lỗi 5xx hoặc lỗi mạng → thử lại tự động 1 lần, chỉ khi request chưa gửi được và chưa có id".
- AD-6: thử lại chỉ cho lỗi mạng khi request chưa gửi được. Một phản hồi 5xx nghĩa là request đã gửi, nên theo AD-6 không thử lại (hoặc `RH_SUBMIT_UNKNOWN`/`RH_ERROR`). Spine không nói rõ 5xx rơi vào đâu.
- Cần một dòng quy tắc: 5xx có thử lại không, và `reasonCode` nào.

### B4. Hạn chót 180/360 giây
- PRD: tính từ lúc `running`, gồm render, tải input lên, tải kết quả về. PRD không nêu cắt ffmpeg trong hạn; §6 chỉ nêu trình tự.
- AD-11 + AD-6: `deadline_at` cũng bao ffmpeg re-encode, và "tại một thời điểm chỉ một tiến trình ffmpeg; Lane thứ hai chờ khóa" (thời gian chờ khóa cũng đếm). Trần render GPU 200–260 giây (PRD) cộng trim cho video 100 MB cộng chờ khóa dễ vượt 360 giây ở tải cao, và lúc đó RELEASED nhưng GPU chưa chắc đã bị hủy.
- Đề xuất: ghi nhận trong PRD §4.5 hoặc tách mốc cho trim, hoặc đặt `running_at` sau trim (ảnh hưởng 'Lane' đã giữ). Cần quyết định.

### B5. Tỷ lệ lỗi ngắt mạch (FR-18)
- PRD: tỷ lệ `failed` hoặc `timed_out` > 15% trong cửa sổ 30 phút.
- AD-14: chỉ tính lỗi hệ thống, mẫu số loại các lý do do người dùng gây ra, và có ngưỡng tối thiểu 20 Task, `RH_BUDGET` không tính. Hợp lý nhưng PRD chưa phản ánh; PRD §12 cũng chưa nhắc.

### B6. Thay đổi spine thêm chưa có trong PRD
- AD-17: tối đa 3 Task `queued`/`running` cùng lúc mỗi người dùng. PRD không giới hạn; có thể làm UJ-3 của người dùng trả phí bị chặn bất ngờ.
- AD-13: tối đa 3 đơn `pending`.
- AD-11: "bước 1 giây" được áp như quy tắc, trong khi PRD §10 còn ghi `[ASSUMPTION]` chưa được xác nhận (memlog cũng ghi chưa xác nhận).
- AD-2 và AD-3: bút toán `GRANT` có thể có amount 0 (AD-12), cần chắc là hợp lệ với chỉ mục duy nhất và đối soát.

### B7. Hủy phía RunningHub
- PRD bảng lỗi "Timeout → hủy phía RunningHub nếu có thể".
- AD-6: không phụ thuộc vào hủy, đường dẫn hủy chưa xác nhận, chấp nhận GPU tốn. Nhất quán về nội dung, nhưng sơ đồ triển khai ghi `WK -- submit, poll 3s, cancel --> RH`, ngụ ý có lệnh hủy. Nên bỏ chữ `cancel` hoặc ghi "nếu xác nhận".
- Điểm mở này chưa nằm trong Deferred (chỉ nằm ở AD-6 và memlog).

## (c) Quyết định trong memlog chưa vào spine

Phần lớn quyết định đã vào spine (HOLD/CAPTURED/RELEASED, poll không webhook, Postgres container, Telegram, 503 `PAUSED`, `RH_BUDGET`, ffmpeg libx264 veryfast 24 fps một tiến trình, QR 15 phút, SM-1, loại nsfwjs/`rejected`). Còn thiếu hoặc lệch:

1. **Câu hỏi mở "cancel endpoint chưa xác nhận"**: chỉ ở thân AD-6, không có dòng trong Deferred.
2. **Rủi ro "ffmpeg CPU trên 4 vCPU dùng chung với api, worker, pg, redis"**: memlog nêu là câu hỏi mở. Spine chỉ có `nice` thấp và khóa một tiến trình, không ghi rủi ro hay phép đo trên VPS thật vào Deferred (trong khi Deferred có phép đo tương tự cho nsfwjs).
3. **"reviewer gate must rerun on v2 before finalize"**: spine vẫn `status: draft`, thư mục `reviews/` có 3 review nhưng chưa có bản xác nhận chạy lại sau các sửa đổi PRD v3.
4. **Trim bước 1 giây chưa được xác nhận**: memlog và PRD §10 đều ghi chưa xác nhận; spine AD-11 coi là chốt, không gắn `[ASSUMPTION]` (xem B6).
5. **Sao lưu và độ bền sổ cái**: memlog hỏi, spine chỉ có `cron pg_dump 03:00` trong sơ đồ và Deferred "RPO 24 giờ". Không có AD. Chấp nhận được nhưng vẫn là quyết định chưa thành quy tắc.
6. **Các dòng memlog bị cụt/hỏng**: ví dụ dòng liệt kê "AD-17 per-user NO_POSE not…", "PRD must … only only; NFR NFR-5". Không xác minh được nội dung gốc; nên người dùng rà lại nếu cần.

## Kiểm tra sơ đồ Mermaid

Không chạy trình dựng Mermaid (không có công cụ); kết luận dựa trên đọc cú pháp. Nên chạy `mmdc` để xác nhận.

### Sơ đồ trạng thái (`stateDiagram-v2`)
- Cú pháp hợp lệ. Bảng chuyển khớp AD-5: `queued→running|cancelled|timed_out`, `running→succeeded|failed|timed_out`, bốn trạng thái kết thúc.
- Thiếu so với AD:
  - Không ghi `reasonCode` nào thuộc cạnh nào (chấp nhận được).
  - Nhãn `FREE chờ quá 15 phút` khớp `FREE_WAIT_EXPIRED`.
  - Không có cạnh `queued→failed`, đúng với AD-14 (Task `RH_BUDGET` phải qua `running` trước).
- Vấn đề: lỗi trước khi submit (ffmpeg thất bại, tải input lỗi, tải kết quả về R2 thất bại sau 3 lần) không có `reasonCode` riêng. Enum hiện tại không có mã cho "trim thất bại" hay "tải input thất bại"; "tải kết quả thất bại" cũng không nói rõ dùng `OUTPUT_INVALID` hay `RH_ERROR`. Cần bổ sung enum hoặc quy ước (liên quan G4).

### ERD (`erDiagram`)
- **Cú pháp**: mỗi thực thể viết toàn bộ thuộc tính trên một dòng, ví dụ `users { uuid id string role int tier bigint balance }`. Mermaid yêu cầu mỗi thuộc tính một dòng (`type name`). Nhiều khả năng trình dựng báo lỗi hoặc dựng sai. Cần tách dòng.
- **Thiếu thực thể và cột đã được AD nêu**:
  - `signup_grants` (AD-12) xuất hiện ở quan hệ nhưng không có khai báo thuộc tính.
  - `admin_audit` (AD-13), bảng/cột `settings.intake_paused` (AD-14), token chia sẻ (AD-8), `topup_id` unique cho `TOPUP` (có), bản ghi ToS và cờ khóa tài khoản (G3).
  - Cột `reason_code` có, nhưng thiếu `finished_at`/`reject_reason`.
- **Khớp AD**: các cột thời gian (`queued_at`, `running_at`, `deadline_at`, `submit_started_at`), `hold_amount`, `gpu_coins`, `tier_snapshot` đều có trong `tasks`; quan hệ `ledger_entries` hai nhánh (`task_id`, `topup_id`) khớp AD-2.

### Sơ đồ triển khai (`flowchart LR`)
- Cú pháp có vẻ hợp lệ.
- Lệch so với AD:
  - `in/ 7 ngày` có, nhưng thiếu `in-raw/ 24 giờ` (AD-8).
  - Chỉ có cạnh `API --> TG`, trong khi bộ quét, bộ đếm ngắt mạch và poll số dư RunningHub (AD-6, AD-14) chạy ở worker hoặc `ops`; không rõ entrypoint nào gọi `NotifierPort`. Cần một cạnh `WK --> TG` hoặc ghi rõ ở AD-14.
  - Cạnh `cancel` (xem B7).
  - Không có cạnh từ worker đến R2 cho việc tải input đã cắt (chỉ có cạnh tải kết quả); chấp nhận được nhưng ffmpeg trên worker đọc `in/` từ R2 nên đáng ghi.

## Hành động đề xuất (theo thứ tự)
1. Chốt vòng đời đơn nạp (G1/B1) với người dùng, rồi sửa đồng thời PRD FR-13 và AD-13.
2. Sửa ERD (tách dòng thuộc tính, thêm thực thể thiếu) và chạy `mmdc` kiểm tra cả ba sơ đồ.
3. Thêm một AD (hoặc mở rộng AD-3/AD-8/AD-13) cho `consent`, ToS version, khóa tài khoản, `admin_audit` dùng chung, token chia sẻ, API hủy Task, vị trí hàng đợi.
4. Bổ sung `reasonCode` cho trim/tải input/tải kết quả và quy tắc 5xx.
5. Đồng bộ PRD với các quy tắc spine thêm (B5, B6) và ghi rõ hạn chót bao gồm trim (B4).
6. Thêm vào Deferred: endpoint hủy RunningHub, rủi ro CPU ffmpeg, benchmark §12 và số liệu NFR-7.
