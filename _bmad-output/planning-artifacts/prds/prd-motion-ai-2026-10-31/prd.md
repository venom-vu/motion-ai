---
title: Motion AI
created: 2026-10-31
updated: 2026-11-01
status: final
---
# PRD: Motion AI
*Tên tạm — cần xác nhận.*

## 0. Mục đích tài liệu
PRD kỹ thuật cho bản MVP thương mại của Motion AI, dành cho PM, người ra quyết định ngân sách và các workflow downstream (UX, kiến trúc, epics). Tài liệu chỉ chuẩn hóa spec và luồng dữ liệu, không chứa code. Cấu trúc: Glossary làm gốc từ vựng, tính năng gom nhóm với FR đánh số toàn cục, giả định gắn thẻ `[ASSUMPTION]` ngay tại chỗ và được tổng hợp ở §10. Chi phí GPU và chi tiết kỹ thuật nằm trong `addendum.md`. Đặc tả thiết kế giao diện & trải nghiệm người dùng hoàn chỉnh (DESIGN.md, EXPERIENCE.md và mockups) nằm tại `_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/`.

## 1. Tầm nhìn
Motion AI là web responsive (ưu tiên mobile web) cho phép người dùng Việt Nam tạo ảnh/video AI chỉ bằng một lần bấm: ghép khuôn mặt, chỉnh dáng cơ thể, và điều khiển chuyển động nhân vật theo video mẫu. Việc xử lý chạy trên RunningHub qua API, không giữ server GPU nhàn rỗi.

Hiện nay người dùng phải thuê làm ngoài (30.000–100.000 VNĐ/ảnh, 50.000–150.000 VNĐ/clip) hoặc dùng app nước ngoài không có thanh toán nội địa. Motion AI trả kết quả trong vài chục giây đến vài phút, trả bằng credit nạp qua VietQR.

MVP là một phép thử thương mại: kiểm chứng mức sẵn sàng chi trả với ngân sách GPU tối đa USD 50–100.

## 2. Người dùng mục tiêu
### 2.1 Jobs To Be Done
- Tạo nội dung bắt mắt cho TikTok/mạng xã hội mà không cần kỹ năng chỉnh sửa.
- Chỉnh dáng, làm đẹp ảnh mà không cần thuê designer.
- Cho nhân vật ảnh tĩnh chuyển động theo một điệu nhảy/hành động có sẵn.
- Biết trước chi phí và không bị trừ tiền khi hệ thống lỗi.

### 2.2 Không phải người dùng (v1)
- Người dùng ngoài Việt Nam (chưa có thanh toán quốc tế, UI chỉ tiếng Việt).
- Người dùng dưới 18 tuổi hoặc ảnh có người dưới 18 tuổi.
- Doanh nghiệp cần API/tích hợp hàng loạt.

### 2.3 Hành trình người dùng chính
Mỗi tính năng là một pipeline độc lập; hành trình "1-click" nghĩa là sau khi chọn đầu vào, người dùng chỉ bấm một nút tạo duy nhất.

- **UJ-1. Linh (22 tuổi, TikToker) đổi mặt vào ảnh mẫu.**
  - **Entry:** vừa đăng nhập Google, còn 500 credit, đến từ link chia sẻ.
  - **Path:** chọn "Face Swap" → tải ảnh mặt nguồn → tải ảnh đích → tích cam kết ToS → bấm **Tạo (100 credit)**.
  - **Climax:** thấy thanh tiến trình, vài chục giây sau ảnh kết quả hiện cạnh ảnh gốc, kèm nút Tải về/Chia sẻ.
  - **Resolution:** số dư còn 400, ảnh lưu trong Lịch sử.
  - **Edge:** ảnh không có mặt → hệ thống vẫn HOLD credit, node đầu tiên trên RunningHub kiểm tra mặt và ngắt ngay (dưới 1 giây GPU); worker RELEASED 100% credit và báo rõ lý do cho người dùng.

- **UJ-2. Hà (28 tuổi, chủ shop thời trang online) chỉnh dáng ảnh sản phẩm.**
  - **Entry:** đã nạp gói Starter, số dư 4.800 credit.
  - **Path:** chọn "Body Retouch" → tải ảnh toàn thân → kéo thanh **Mức độ điều chỉnh** → tích ToS → bấm **Tạo (100 credit)**.
  - **Climax:** ảnh mới giữ nguyên mặt và phông nền, đường nét tự nhiên; có thanh so sánh trước/sau.
  - **Resolution:** tải ảnh về, số dư 4.700.
  - **Edge:** thanh trượt mức độ có giới hạn tối đa để tránh méo hình.

- **UJ-3. Minh (19 tuổi, người làm clip nhảy) làm video chuyển động.**
  - **Entry:** gói Pro, cap 15 giây, số dư 12.000 credit.
  - **Path:** chọn "Motion Control" → tải ảnh nhân vật toàn thân → tải video mẫu → kéo thanh cắt đoạn (3–15 giây) → xem giá hiện ngay (ví dụ 10 giây = 500 credit) → tích ToS → bấm **Tạo**.
  - **Climax:** trang chờ báo vị trí hàng đợi, rồi video chạy ngay tại chỗ.
  - **Resolution:** tải MP4; nếu quá hạn hoặc lỗi, hệ thống tự hoàn credit và báo rõ.

- **UJ-4. Nam (người mới) nạp credit bằng VietQR.**
  - **Path:** vào "Nạp credit" → chọn gói → hệ thống sinh QR đúng số tiền kèm nội dung `NAP <MÃ_GIAO_DỊCH>` → chuyển khoản → bấm "Đã chuyển khoản".
  - **Climax:** trạng thái "Đang chờ duyệt"; khi admin duyệt, credit và hạng tài khoản cập nhật.
  - **Edge:** sai nội dung hoặc sai số tiền → admin xử lý thủ công, giao dịch ở trạng thái "Cần xem xét".

## 3. Glossary
- **Credit** — đơn vị tiền tệ nội bộ, không hết hạn, được ghi sổ bằng bút toán cộng/trừ.
- **Task** — một yêu cầu xử lý thuộc đúng một **Pipeline**; có vòng đời trạng thái (§4.5).
- **Pipeline** — một trong ba luồng độc lập: **Face Swap**, **Body Retouch**, **Motion Control**; mỗi Pipeline ánh xạ một **Workflow** RunningHub.
- **Workflow** — workflow RunningHub đã fork và tinh giản, nhận diện bằng workflow ID cấu hình qua môi trường.
- **Tier** — hạng tài khoản: **FREE**, **Starter**, **Pro**, **Creator**; quyết định thời lượng tối đa và độ ưu tiên hàng đợi.
- **Cap** — thời lượng video đầu ra tối đa của một Task Motion Control theo Tier.
- **Priority** — số nguyên, càng nhỏ càng được xử lý trước (Creator = 1, FREE = 10).
- **HOLD** — bút toán giữ tạm credit khi Task được gửi; số dư khả dụng giảm ngay nhưng credit vẫn thuộc sở hữu người dùng cho đến khi chốt.
- **CAPTURED / RELEASED** — CAPTURED: chốt khoản HOLD thành khoản trừ cuối cùng khi Task thành công; RELEASED: trả HOLD về số dư khi Task kết thúc không thành công (hoàn credit).
- **Lane** — một luồng GPU RunningHub chạy song song; MVP có 2 Lane.
- **Trim** — đoạn video mẫu được chọn bằng thanh trượt ở frontend; worker cắt đoạn đó bằng ffmpeg trên server trước khi gửi RunningHub.
- **Tier Snapshot** — bản chụp Tier, Priority và Cap của tài khoản tại đúng thời điểm bấm Tạo; Task dùng snapshot này đến hết vòng đời.
- **LOW_BALANCE** — trạng thái tổng credit sở hữu (số dư khả dụng cộng credit đang HOLD) dưới 100; tài khoản rơi về FREE.

## 4. Tính năng

### 4.1 Face Swap
**Mô tả:** Ghép khuôn mặt từ ảnh nguồn vào nhân vật trong ảnh đích, trả về một ảnh hoàn chỉnh. Hiện thực UJ-1. Chi phí cố định 100 credit/Task.

**Bảng tham số**

| Tham số | Hướng | Bắt buộc | Quy tắc validate |
|---|---|---|---|
| `source_face` | Input | Có | Ảnh JPG/PNG/WebP; ≤ 10 MB; cạnh ngắn ≥ 512 px, cạnh dài > 2048 px được tự động resize về 2048 px, giữ nguyên tỷ lệ gốc; có đúng 1 khuôn mặt rõ, chiếm ≥ 10% diện tích ảnh |
| `target_image` | Input | Có | Cùng định dạng, dung lượng và quy tắc resize như trên; tỷ lệ từ 1:2 đến 2:1; có ít nhất 1 khuôn mặt; nếu có nhiều mặt, chỉ hoán đổi mặt có bounding box lớn nhất (nhận diện bằng InsightFace/RetinaFace), các mặt khác giữ nguyên |
| `consent` | Input | Có | Đã tích ToS (§4.6) |
| `result_image` | Output | — | 1 ảnh PNG/JPG, lưu trên Storage; kích thước bằng `target_image` |

#### FR-1: Gửi Task Face Swap
Hệ thống phải cho phép người dùng đã đăng nhập tải lên `source_face` và `target_image` và tạo Task bằng một lần bấm, khi số dư ≥ 100 credit. Realizes UJ-1.
- **Acceptance:** Task ở trạng thái `queued` trong 2 giây sau khi bấm; số dư giảm 100 dưới dạng HOLD. Nếu `target_image` hoặc `source_face` không có mặt, Task chuyển `failed` và RELEASED 100% credit, kèm thông báo "Không nhận diện được khuôn mặt trong ảnh".
- **Ngoài phạm vi:** đổi mặt trong video; chọn nhiều mặt thủ công.

#### FR-2: Kết quả Face Swap
Hệ thống phải trả `result_image` đã lưu trên Storage của hệ thống (không dùng link CDN RunningHub) cùng nút Tải về/Chia sẻ, ghi metadata EXIF vào file kết quả (`Software`: AI Generator, `Comment`: AI-Generated Content). C2PA hoãn sang v2 vì cần chứng chỉ số và chữ ký mật mã. Realizes UJ-1.

**NFR riêng:** SLA Face Swap ≤ 60 giây, tính từ lúc worker bắt đầu xử lý đến khi ảnh kết quả tải lên R2 thành công, trong điều kiện GPU không nghẽn.

### 4.2 Body Retouch
**Mô tả:** Định hình đường nét cơ thể bằng inpainting/ControlNet theo mức độ điều chỉnh, giữ nguyên khuôn mặt và phông nền. Hiện thực UJ-2. Chi phí cố định 100 credit/Task.

**Bảng tham số**

| Tham số | Hướng | Bắt buộc | Quy tắc validate |
|---|---|---|---|
| `input_image` | Input | Có | JPG/PNG/WebP; ≤ 10 MB; cạnh ngắn ≥ 512 px, cạnh dài > 2048 px được tự động resize về 2048 px, giữ nguyên tỷ lệ gốc; tỷ lệ 1:2 đến 2:1; phải phát hiện tối thiểu 1 người; nếu có nhiều người, lấy người nổi bật nhất (diện tích lớn nhất) |
| `intensity` | Input | Có | Số nguyên 1–10, mặc định 5. Mức 1–3: uốn nhẹ dáng; 4–7: chuẩn tự nhiên; 8–10: đường cong tối đa |
| `consent` | Input | Có | Đã tích ToS |
| `result_image` | Output | — | 1 ảnh PNG/JPG cùng kích thước đầu vào |

#### FR-3: Gửi Task Body Retouch
Hệ thống phải cho phép tạo Task Body Retouch bằng một lần bấm với `input_image` và `intensity`. Realizes UJ-2.

#### FR-4: So sánh trước/sau
Hệ thống phải hiển thị ảnh gốc và ảnh kết quả cạnh nhau (thanh trượt so sánh) trên trang kết quả.

**NFR riêng:** MVP không có Pre-check nội dung tự động (hoãn sang v2); an toàn nội dung dựa vào cam kết ToS (FR-19), khóa tài khoản (FR-21) và báo cáo, gỡ bỏ khẩn cấp (FR-22).

### 4.3 Motion Control
**Mô tả:** Điều khiển chuyển động nhân vật trong ảnh theo video mẫu (pose extraction kết hợp mô hình tạo video). Hiện thực UJ-3. Chi phí 50 credit mỗi giây video đầu ra, tối thiểu 3 giây (150 credit) và tối đa theo Cap của Tier.

**Bảng tham số**

| Tham số | Hướng | Bắt buộc | Quy tắc validate |
|---|---|---|---|
| `character_image` | Input | Có | JPG/PNG/WebP; ≤ 10 MB; cạnh ngắn ≥ 512 px; cạnh dài > 2048 px tự động resize về 2048 px; ảnh toàn thân rõ 1 người |
| `pose_video` | Input | Có | MP4/MOV; ≤ 100 MB trước Trim (video 1080p 20 giây từ smartphone thường nặng 40–80 MB); chuẩn hóa về 24 FPS; phải nhận diện được khung xương người (OpenPose/DWPose) của nhân vật chiếm tiêu điểm chính ở frame đầu tiên; nếu không, Task bị reject (xem FR-5) |
| `trim_start`, `trim_end` | Input | Có | Đoạn sau Trim dài từ 3 giây đến Cap của Tier (FREE 5, Starter 10, Pro 15, Creator 20); thanh trượt theo bước 1 giây |
| `consent` | Input | Có | Đã tích ToS |
| `result_video` | Output | — | 1 MP4 (H.264/AAC), 720p (1280x720), 24 FPS; độ dài = đoạn Trim, dung sai ±0,5 giây, không hoàn phần lẻ; lưu Storage |

#### FR-5: Từ chối video không có chuyển động người
Nếu node đầu tiên của workflow không trích xuất được khung xương người từ `pose_video`, worker phải chuyển Task sang `failed` ngay, RELEASED 100% credit và hiển thị: "Không nhận diện được chuyển động cơ thể trong video mẫu". Realizes UJ-3.

#### FR-6: Trim bắt buộc ở frontend
Hệ thống phải bắt buộc người dùng chọn đoạn video bằng thanh trượt, cắt theo bước 1 giây, và không cho gửi nếu đoạn vượt Cap hoặc dưới 3 giây. Backend phải đo lại độ dài đoạn Trim thực tế, không tin giá trị client gửi lên. Việc cắt video do worker thực hiện bằng ffmpeg trên server trước khi gửi RunningHub (không dùng tham số cắt của node ComfyUI), cắt bằng re-encode (libx264, preset veryfast, chuẩn hóa 24 FPS) để chính xác theo giây; tại một thời điểm chỉ chạy một tiến trình ffmpeg để không làm nghẽn API và cơ sở dữ liệu trên VPS. Realizes UJ-3.

#### FR-7: Hiển thị giá trước khi gửi
Hệ thống phải tính và hiển thị giá (50 × số giây nguyên sau Trim) theo thời gian thực khi người dùng kéo thanh trượt; số credit HOLD phải bằng đúng giá hiển thị. Dung sai ±0,5 giây của file đầu ra không làm đổi số credit đã trừ. Realizes UJ-3.

#### FR-8: Hàng đợi chung theo Priority
Hệ thống phải xếp mọi Task của cả ba Pipeline (ảnh và video) vào một hàng đợi chung, dùng chung 2 Lane, không có Lane riêng cho FREE. Worker lấy Task theo Priority của Tier Snapshot (số nhỏ chạy trước); cùng Priority thì FIFO. Task FREE (Priority 10) chỉ được lấy khi hàng đợi không còn Task trả phí nào. Task ảnh chạy nhanh (3–5 giây GPU) nên xen kẽ tự nhiên giữa các Task video, không cần tách hàng đợi trong MVP. Hiển thị vị trí hàng đợi cho người dùng.
- **Giới hạn chờ của FREE:** Task FREE chờ quá 15 phút (`MAX_QUEUE_WAIT_TIME` = 15m, tránh job tồn đọng trong hàng đợi) bị gỡ khỏi hàng đợi, chuyển `timed_out`, RELEASED 100% và báo người dùng thử lại hoặc nạp credit.
- **Acceptance:** với 2 Lane bận, Task Priority 1 vào sau vẫn chạy trước Task Priority 3 vào trước; Task FREE không chạy khi còn Task trả phí ở hàng đợi.

**NFR riêng:** thời gian chờ và xử lý lâu hơn ảnh; đặt timeout riêng (§4.5).

### 4.4 Credit và Tier
**Mô tả:** Credit là cơ chế thanh toán duy nhất. Nạp bằng VietQR, duyệt tay trong MVP.

**Bảng gói và Tier**

| Tier | Giá (VNĐ) | Credit nhận | Cap video | Priority |
|---|---|---|---|---|
| FREE | 0 | 500 (tặng một lần khi đăng ký Google) | 5 giây | 10 |
| Starter | 49.000 | 5.000 | 10 giây | 3 |
| Pro | 99.000 | 12.000 | 15 giây | 2 |
| Creator | 199.000 | 30.000 | 20 giây | 1 |

**Bảng định mức:** Face Swap 100 credit/Task; Body Retouch 100 credit/Task; Motion Control 50 credit/giây (3 giây = 150, 20 giây = 1.000).

#### FR-9: Sổ cái credit
Hệ thống phải ghi mọi thay đổi số dư thành bút toán bất biến (loại: cộng nạp, tặng, HOLD, CAPTURED, RELEASED, điều chỉnh tay), số dư là tổng bút toán; không cho số dư âm.

#### FR-10: HOLD → CAPTURED/RELEASED
Khi gửi Task, hệ thống phải HOLD đúng số credit trong cùng một giao dịch CSDL với việc tạo Task; Task thành công thì CAPTURED; Task thất bại hoặc hủy thì RELEASED. Mỗi Task chỉ CAPTURED hoặc RELEASED đúng một lần (idempotent). Task chuyển sang trạng thái kết thúc đầu tiên thì thắng: kết quả đến muộn sau `timed_out`, hoặc yêu cầu hủy đến sau khi Task đã `running`, bị bỏ qua và không làm đổi sổ cái. HOLD ghi kèm Tier Snapshot.

#### FR-11: Xác định Tier
Tier của tài khoản là gói cao nhất đã nạp kể từ lần gần nhất tài khoản ở hạng FREE, và chỉ còn hiệu lực khi tổng credit sở hữu (số dư khả dụng cộng tổng credit đang HOLD) còn từ 100 trở lên. Nạp gói thấp hơn khi đang giữ gói cao hơn thì cộng dồn credit và giữ Tier cao.
- **Rơi về FREE:** khi tổng credit sở hữu (số dư khả dụng cộng tổng credit đang HOLD) dưới 100 (LOW_BALANCE), tài khoản rơi về FREE và xóa sạch lịch sử gói cũ. Lần nạp kế tiếp tính Tier độc lập theo đúng gói vừa nạp (ví dụ từng nạp Creator, cạn credit, rồi nạp Starter thì chỉ nhận quyền Starter: Priority 3, Cap 10 giây). Ngưỡng này gộp từ hai ngưỡng 100 và 150 cũ, vì dưới 100 credit không đủ cho bất kỳ tác vụ nào; tổng credit từ 100 đến 149 vẫn giữ Tier nhưng không đủ cho Motion tối thiểu 150 credit nên Task Motion bị từ chối với thông báo thiếu credit.
- **Tier Snapshot:** Tier, Priority và Cap được chụp tại lúc bấm Tạo. Việc HOLD credit không làm hạ Tier của Task đang chờ trong hàng đợi.
- **Acceptance:** tài khoản Creator còn 40 credit sau khi dùng hết, nạp Starter thì có Priority 3; tài khoản đang Pro còn 5.000 credit nạp thêm Starter thì vẫn Priority 2.

#### FR-12: Tặng credit dùng thử một lần
Hệ thống phải cấp 500 credit khi đăng ký Google thành công, mỗi thiết bị một lần (theo Device Fingerprint); mỗi địa chỉ IP chỉ có tối đa 3 tài khoản nhận credit tặng trong 24 giờ. Tài khoản thứ 4 trở đi từ cùng IP trong ngày vẫn được đăng ký nhưng có số dư khởi tạo 0 credit và phải nạp tiền để dùng. Không đặt trần theo ngày và không đặt trần tổng toàn hệ thống cho credit tặng, để không chặn người dùng mới. Chi phí của credit tặng được kiểm soát gián tiếp bằng Device Fingerprint, giới hạn IP, cảnh báo số dư RunningHub (FR-18) và ngắt mạch khi tỷ lệ lỗi cao. IP dùng chung (ví dụ CGNAT) có thể khiến người thật nhận 0 credit; đây là đánh đổi được chấp nhận trong MVP.

#### FR-13: Nạp credit qua VietQR
Hệ thống phải sinh mã VietQR có số tiền chính xác và nội dung `NAP <MÃ_GIAO_DỊCH>`; người dùng bấm "Đã chuyển khoản" để tạo yêu cầu ở trạng thái `pending`. Mỗi `MÃ_GIAO_DỊCH` là duy nhất và chỉ dùng được một lần. Realizes UJ-4.
- **Acceptance:** hai yêu cầu cùng `MÃ_GIAO_DỊCH` không thể cùng được duyệt; QR sinh ra khớp số tiền của gói đã chọn.

**Giới hạn thời gian VietQR:** mã QR hiệu lực 15 phút; admin duyệt yêu cầu trong vòng 15 phút trong giờ làm việc 08:00–23:00. Chỉ đơn chưa bấm "Đã chuyển khoản" mới hết hạn sau 15 phút. Đơn đã bấm được giữ chờ Admin, kể cả ngoài giờ làm việc (chờ đến 08:00 sáng hôm sau); Admin vẫn duyệt được đơn đã hết hạn nếu nhập mã giao dịch ngân hàng.

#### FR-14: Duyệt nạp trên dashboard nội bộ
Hệ thống phải gửi thông báo Discord cho Admin khi có đơn nạp mới chuyển sang `pending`. Admin phải xem được danh sách yêu cầu nạp, đối chiếu biến động số dư ngân hàng và bấm duyệt; duyệt thì cộng credit, cập nhật Tier và Priority. Từ chối cần ghi lý do. Mỗi yêu cầu chỉ duyệt một lần, và mọi thao tác duyệt/từ chối được ghi nhật ký (người thao tác, thời điểm). Dashboard chỉ truy cập được bằng tài khoản admin được xác thực.
- **Acceptance:** bấm duyệt hai lần chỉ cộng credit một lần; sau khi duyệt, số dư và Tier của người dùng cập nhật ngay.

### 4.5 Xử lý lỗi và hoàn credit
**Vòng đời Task:** `created → queued → running → succeeded | failed | timed_out | cancelled`. `timed_out` có thể xảy ra từ `queued` (FREE chờ quá lâu) hoặc từ `running`. Chỉ hủy được khi còn `queued`.

**Bảng lỗi**

| Tình huống | Phát hiện | Xử lý | Credit |
|---|---|---|---|
| Validate sai định dạng/dung lượng/tỷ lệ | Client + server | Báo lỗi cụ thể, không tạo Task | Không HOLD |
| RunningHub trả lỗi 5xx hoặc lỗi mạng | Khi gọi API | Thử lại tự động 1 lần, chỉ khi request chưa gửi được và chưa có id từ RunningHub; RunningHub không có khóa idempotency nên nếu worker crash giữa lúc submit và lưu id thì không submit lại, chuyển `failed` | RELEASED 100% |
| RunningHub báo workflow lỗi | Khi poll | `failed`, hiển thị "Xử lý thất bại, đã hoàn credit" | RELEASED 100% |
| Timeout | Quá ngưỡng chạy | Hủy phía RunningHub nếu có thể, `timed_out` | RELEASED 100% |
| Kết quả hỏng hoặc lệch thời lượng ngoài ±0,5 giây | Kiểm tra đầu ra | `failed` | RELEASED 100% |
| Không tải được kết quả về Storage | Sau khi RunningHub xong | Thử lại tải 3 lần, sau đó `failed` | RELEASED 100% |
| Không có mặt hoặc không có khung xương người | Node đầu tiên của workflow RunningHub | `failed` (`NO_FACE`/`NO_POSE`), báo rõ lý do | RELEASED 100% |
| Node lọc nội dung của RunningHub chặn | Workflow RunningHub | `failed` (`CONTENT_BLOCKED`), thông báo: "Ảnh/video vi phạm tiêu chuẩn cộng đồng, vui lòng chọn file khác." | RELEASED 100% |
| Người dùng hủy khi còn `queued` | UI | `cancelled` | RELEASED 100% |
| Task FREE chờ quá giới hạn hàng đợi (FR-8) | Worker/hàng đợi | `timed_out`, gỡ khỏi hàng đợi | RELEASED 100% |
| Hết credit RunningHub (ngân sách trần) | API trả lỗi tài khoản khi submit | `failed` (`RH_BUDGET`); bật cờ dừng nhận Task mới và cảnh báo Admin; vẫn cho phép nạp credit | RELEASED 100% |

**Ngưỡng timeout:** ảnh 180 giây; video 360 giây (6 phút), tính từ lúc bắt đầu tải input lên RunningHub, gồm thời gian render và tải kết quả về Storage. Bước chuẩn bị trước đó (chờ khóa ffmpeg, cắt video) có hạn riêng 120 giây (gồm tải input từ R2 và ffmpeg) tính từ lúc Task chuyển sang `running`; thời gian chờ đến lượt gửi RunningHub (giới hạn đồng thời) có hạn riêng 15 phút và không tính vào tỷ lệ lỗi của ngắt mạch. Trần thời gian render GPU RunningHub cho video là 200–260 giây (20 giây video × ~13 giây GPU/giây). Không đặt 600 giây để tránh giữ Lane GPU vô ích khi mất kết nối.

#### FR-15: Hoàn credit tự động và idempotent
Hệ thống phải tự động ghi RELEASED cho mọi Task đã HOLD kết thúc ở `failed`, `timed_out`, `cancelled`, không cần người dùng khiếu nại, và phải gửi thông báo trong UI. Khi kết quả poll lặp lại, RELEASED không được thực hiện hai lần.

#### FR-16: Chính sách chất lượng kết quả
Hệ thống không hoàn credit tự động khi workflow chạy thành công và trả về file, kể cả khi kết quả xấu hoặc méo (chất lượng phụ thuộc nhiều vào ảnh/video đầu vào). Hoàn tự động 100% chỉ áp dụng cho lỗi kỹ thuật: crash, timeout, RunningHub báo lỗi node, file đầu ra đen hoặc hỏng. Người dùng có thể gửi ticket kèm hình ảnh; Admin cộng bù credit thủ công khi xác nhận lỗi do model hoặc hệ thống.

#### FR-17: Task treo
Hệ thống phải có tiến trình quét định kỳ phát hiện Task `running` quá ngưỡng timeout mà không nhận phản hồi, chuyển sang `timed_out` và RELEASED.
- **Acceptance:** Task video quá hạn chót 360 giây (tính từ lúc bắt đầu tải input lên RunningHub) được chuyển `timed_out` và hoàn credit trong chu kỳ quét kế tiếp.

#### FR-18: Cảnh báo vận hành
Khi tỷ lệ Task thất bại (`failed` hoặc `timed_out`) vượt 15% trong cửa sổ trượt 30 phút (hoặc có 5 lỗi hệ thống liên tiếp), hệ thống phải tự động tạm dừng nhận Task mới và gửi cảnh báo qua Discord cho Admin. Đây là ngắt mạch vận hành, khác với mục tiêu SM-3 (≥ 90% thành công, đo theo ngày) và tiêu chí benchmark §12 (0% lỗi trên 20 mẫu). Admin cũng phải nhận cảnh báo qua Discord khi số dư tài khoản RunningHub xuống dưới USD 15, để có khoảng 2–4 giờ nạp thêm trước khi cạn ví.
- **Khi RunningHub cạn tiền thật:** hệ thống dừng nhận Task mới (người dùng thấy thông báo bảo trì), Task đang chờ thất bại nhanh và được RELEASED 100% (không tốn GPU), nhưng đăng nhập, nạp credit, lịch sử và tải kết quả vẫn hoạt động. Hệ thống tự mở lại khi Admin tắt cờ sau khi nạp tiền vào RunningHub.

### 4.6 Tuân thủ nội dung
**Mô tả:** Cổng bắt buộc cho mọi Pipeline trước khi chi tiền GPU.

#### FR-19: Cam kết ToS trước khi tải lên
Hệ thống phải yêu cầu người dùng tích cam kết trước mỗi lần tải ảnh/video lên: sở hữu quyền hợp pháp với ảnh, người trong ảnh đủ 18 tuổi, người có khuôn mặt trong ảnh (kể cả khuôn mặt bị ghép trong Face Swap) đã đồng ý cho xử lý hình ảnh. Không tích thì không gửi được. Cam kết này cũng bắt buộc khi tạo tài khoản và khi nạp tiền, với nội dung: chỉ dùng hình ảnh thuộc quyền sở hữu cá nhân; nghiêm cấm tạo nội dung khiêu dâm hoặc bôi nhọ danh dự người khác; hệ thống miễn trừ trách nhiệm pháp lý nếu người dùng cố tình vi phạm. Hệ thống lưu thời điểm và phiên bản ToS đã đồng ý.

#### FR-20: Pre-check nội dung — hoãn sang v2
MVP không có Pre-check nội dung tự động; lớp lọc của MVP là cam kết ToS (FR-19) cộng node lọc sẵn có trong workflow RunningHub (theo người dùng; hành vi của node này chưa được kiểm chứng và sẽ được kiểm trong benchmark §12). Khi làm ở v2: kiểm tra mọi ảnh đầu vào (và khung hình đại diện của video) bằng model kiểm duyệt nhẹ ở backend (nsfwjs hoặc tương đương) trước khi HOLD credit; từ chối khi điểm nhãn Porn hoặc Hentai vượt 0,85 để hạn chế bắt nhầm ảnh bikini hay đồ tập hợp lệ. Model này không ước tính được tuổi nên không thay thế được cam kết ToS.

#### FR-21: Chính sách không khoan nhượng
Nội dung liên quan người dưới 18 tuổi hoặc deepfake mạo danh ác ý bị cấm tuyệt đối; hệ thống phải khóa tài khoản vi phạm lặp lại và giữ nhật ký phục vụ điều tra.

#### FR-22: Báo cáo và gỡ bỏ khẩn cấp
Hệ thống phải có nút hoặc email báo cáo vi phạm ở chân trang. Khi nhận khiếu nại về bản quyền hoặc hình ảnh cá nhân, Admin phải xóa được ngay file liên quan trên Cloudflare R2 và ghi nhật ký thao tác.
- **Acceptance:** sau khi Admin xóa, đường dẫn chia sẻ của file trả về lỗi không tồn tại.

**Ghi chú:**
- `[NOTE FOR PM]` Body Retouch ngực/cơ thể có rủi ro NSFW cao hơn các tính năng còn lại, đặc biệt ở `intensity` 8–10. MVP không có bộ lọc tự động (hoãn sang v2), nên rủi ro này đang được chấp nhận; cần quyết định trách nhiệm pháp lý trước khi mở bán.
- `[NOTE FOR PM]` Face Swap có rủi ro deepfake mạo danh; cần tư vấn pháp lý về đồng ý của người bị ghép mặt, nhãn nội dung AI và quy định hiện hành tại Việt Nam trước khi mở bán.
- `[NOTE FOR PM]` MVP không kiểm duyệt tự động ảnh/video đầu vào lẫn đầu ra (xem §7.2); cần cân nhắc rủi ro này khi chốt ngày mở bán.

## 5. Yêu cầu phi chức năng chung
- **NFR-1 Zero Idle Cost:** không duy trì GPU; mọi xử lý đẩy sang RunningHub theo từng Task.
- **NFR-2 Lưu trữ:** kết quả được sao chép từ CDN RunningHub về Cloudflare R2/S3; ảnh gốc tải lên và kết quả tự xóa sau thời hạn lưu 7 ngày với ảnh/video đầu vào (Lifecycle Rule), 30 ngày với kết quả.
- **NFR-3 Bảo mật:** workflow ID và API key RunningHub chỉ ở backend; giới hạn tần suất theo tài khoản và IP.
- **NFR-4 Toàn vẹn credit:** mọi thao tác ví nằm trong giao dịch CSDL; không có race condition làm âm số dư khi gửi đồng thời nhiều Task.
- **NFR-6 Mobile web:** hoạt động trên trình duyệt di động phổ biến; tải ảnh từ camera/thư viện; chia sẻ có Open Graph động; người dùng tự bấm Chia sẻ cho từng kết quả, mặc định không công khai.
- **NFR-7 Quan sát:** log theo Task ID, đo tỷ lệ thành công, thời gian xử lý và chi phí GPU thực tế trên mỗi Task.

## 6. Luồng dữ liệu (cấp spec)
1. **Gửi:** Frontend validate → tải file lên Storage tạm (URL ký) → Backend validate lại → trong một giao dịch: tạo Task, HOLD credit → đẩy vào hàng đợi theo Priority.
2. **Xử lý:** Worker lấy Task khi có Lane rảnh → cắt video bằng ffmpeg (Motion Control) → tải input lên RunningHub → chạy Workflow với workflow ID của Pipeline (node đầu tiên kiểm tra mặt hoặc khung xương) → theo dõi bằng poll (không dùng webhook).
3. **Kết thúc thành công:** tải kết quả từ CDN RunningHub về Storage → kiểm tra đầu ra → CAPTURED → thông báo cho người dùng.
4. **Kết thúc thất bại:** gán trạng thái theo §4.5 → RELEASED → thông báo.

## 7. Phạm vi MVP
### 7.1 Trong phạm vi
- Ba Pipeline độc lập, web responsive tiếng Việt.
- Đăng nhập Google; credit; bốn Tier; VietQR duyệt tay; dashboard admin tối thiểu.
- Hàng đợi 2 Lane theo Priority; hoàn credit tự động.
- Cổng tuân thủ (ToS, báo cáo và gỡ bỏ khẩn cấp).
- Tier Snapshot; hàng đợi chung ảnh/video.

### 7.2 Ngoài phạm vi MVP
- Thanh toán tự động (webhook ngân hàng) — để v2, MVP duyệt tay cho nhanh.
- Quốc tế hóa, đa ngôn ngữ, thanh toán thẻ.
- Face Swap trong video; xử lý hàng loạt; API công khai.
- Ứng dụng native; hoàn tiền thật (tiền VNĐ) cho credit đã nạp.
- Đối soát VietQR tự động và xử lý khách chuyển khoản mà không bấm xác nhận — hoãn sang v2.
- Nhãn nội dung AI theo chuẩn C2PA (MVP chỉ dùng EXIF).
- Hệ thống ticket hỗ trợ (MVP xử lý khiếu nại thủ công ngoài hệ thống), hành trình người dùng riêng cho admin, lịch sử và đăng nhập nâng cao.
- Pre-check nội dung tự động đầu vào (nsfwjs hoặc tương đương, FR-20) — hoãn sang v2 vì khối lượng công việc MVP.
- Kiểm duyệt ảnh/video đầu ra; quy tắc riêng tư chi tiết cho chia sẻ công khai; xử lý dữ liệu xuyên biên giới.
- Chống lạm dụng nâng cao ngoài Device Fingerprint và giới hạn IP.

## 8. Chỉ số thành công
**Chính**
- **SM-1:** Tỷ lệ chuyển đổi từ dùng thử sang nạp tiền ≥ 5%. Mẫu số: tài khoản đã tạo ít nhất 1 Task; tử số: những tài khoản đó có ít nhất 1 lần nạp tiền được duyệt trong 30 ngày kể từ ngày đăng ký. Validates FR-1, FR-3, FR-7, FR-12, FR-13.
- **SM-2:** ≥ 30 đơn nạp thành công trong 30 ngày đầu. Validates FR-13, FR-14.

**Phụ**
- **SM-3:** Tỷ lệ Task thành công ≥ 90%. Validates FR-15, FR-17.
- **SM-4:** Chi phí GPU thực tế nạp vào RunningHub không vượt trần USD 50–100 (≈ 1,25–2,5 triệu VNĐ). Validates FR-8, FR-18.

**Chỉ số đối trọng**
- **SM-C1:** Không tối ưu số lượng tài khoản dùng thử mà bỏ qua chi phí GPU: chi phí GPU cho credit tặng không được làm cạn ngân sách RunningHub (xem SM-4); đối trọng của SM-1.
- **SM-C2:** Không bỏ các kiểm tra tính hợp lệ của đầu vào để tăng tốc độ; đối trọng của SM-3.

## 9. Câu hỏi mở
1. Chạy Pre-launch Benchmark Checklist (§12) và đạt Pass Criteria trước khi bật cổng VietQR thương mại. Phương án nếu không đạt: xem §12 (Kế hoạch B).
2. Điều khoản ToS và Chính sách quyền riêng tư cần soạn trước khi ra mắt (cần tư vấn pháp lý), gồm đồng ý của người bị ghép mặt và nhãn nội dung AI.
3. Cách chặn nội dung có người dưới 18 tuổi vì MVP không có Pre-check tự động (FR-20 hoãn sang v2; xem các `[NOTE FOR PM]` ở §4.6).

## 10. Chỉ mục giả định
Các giả định đã được người dùng chốt: FREE chờ tối đa 15 phút; ngưỡng rơi về FREE 100 credit (tính trên số dư khả dụng cộng credit đang HOLD); Pre-check nsfwjs hoãn sang v2 (giữ ngưỡng 0,85 cho v2); EXIF thay C2PA; nhận diện mặt và khung xương chạy sau HOLD trong workflow RunningHub; QR 15 phút và duyệt trong 15 phút (08:00–23:00); mẫu số SM-1; hạn chuẩn bị 120 giây; cửa sổ job mồ côi 10 phút; tối đa 10 file tải lên chưa tạo Task mỗi người; thanh Trim bước 1 giây (tối thiểu 3, tối đa 20 giây); ffmpeg re-encode một tiến trình; ngắt mạch khi 5 lỗi liên tiếp; cảnh báo vận hành qua Discord webhook; hành vi khi RunningHub cạn tiền.

Còn mở:
- Nội dung cam kết ToS bổ sung về độ tuổi 18 và quyền sử dụng hình ảnh (FR-19): đoạn dán bị mất chữ.
- Chuỗi lỗi thật mà node lọc nội dung của RunningHub trả về (FR-20): chưa biết, bắt bằng 1–2 ảnh thử trong benchmark §12.

## 11. Kinh tế đơn vị và ràng buộc vận hành
Biên gộp tính thuần theo giá vốn GPU (COGS), chưa tính phí lưu trữ và hao hụt tải.

| Gói | Thu / 100 credit | Giá bán Motion / giây | Biên gộp (vốn 37 VNĐ/giây) | Biên gộp (vốn 74 VNĐ/giây) |
|---|---|---|---|---|
| Starter | 980 VNĐ | 490 VNĐ | ~92% | ~85% |
| Pro | 825 VNĐ | 412,5 VNĐ | ~91% | ~82% |
| Creator | 663 VNĐ | 331,5 VNĐ | ~89% | ~77,6% |

Giá vốn Motion: 37 VNĐ/giây khi nạp gói chuẩn (USD 10 = 36.000 coin), 74 VNĐ/giây khi nạp lẻ (USD 10 = 18.000 coin). Ảnh tĩnh: giá vốn 17–28 VNĐ, biên gộp khoảng 95%. Mốc dùng trong PRD: 91% (kịch bản chuẩn) và 82% (nạp lẻ, gói Pro).

**Phần chưa tính vào bảng trên:** Task lỗi vẫn tốn GPU, retry, 500 credit tặng, phí thanh toán và phí lưu trữ. Mỗi tài khoản mới tốn tối đa 500 credit, tức 10 giây video ≈ 740 VNĐ GPU ở kịch bản nạp lẻ; vì không có trần tổng, chi phí này tăng tuyến tính theo số tài khoản mới (1.000 tài khoản ≈ 740.000 VNĐ).

**Ràng buộc vận hành:** không áp dụng voucher phần trăm hoặc chiết khấu affiliate vượt 15% cho gói Creator, để giữ biên gộp an toàn.

## 12. Danh sách kiểm tra tiền phát hành (Pre-launch Benchmark Checklist)
Bắt buộc hoàn tất trước khi mở cổng nạp VietQR thương mại.

**Bộ mẫu đo kiểm (20 tác vụ)**

| Nhóm | Số tác vụ | Nội dung |
|---|---|---|
| Face Swap | 5 | Ảnh góc nghiêng, ảnh đủ sáng, ảnh chân dung bán thân |
| Body Retouch | 5 | Các mốc `intensity` 3, 5, 8 |
| Motion Control 3 giây | 2 | Đo độ trễ khởi động node (cold start) |
| Motion Control 5 giây | 3 | Mốc trần gói FREE |
| Motion Control 10 giây | 2 | Mốc trần gói Starter |
| Motion Control 15 giây | 2 | Mốc trần gói Pro |
| Motion Control 20 giây | 1 | Mốc trần gói Creator, kiểm tra độ ổn định Sliding Context Window |

**Chỉ số ghi nhận sau mỗi lượt chạy**
- Số RunningHub coin tiêu hao thực tế (lấy từ response API RunningHub).
- Giây GPU thực tế trên mỗi 1 giây video đầu ra.
- Sai số thời lượng giữa đoạn Trim và file MP4 xuất ra (dung sai ±0,5 giây).
- Chất lượng chuyển động ở nửa sau video 15–20 giây (mặt méo, cơ thể trôi dạt).

**Thử bổ sung (không tính vào 20 mẫu):** chạy 1–2 ảnh nhạy cảm để bắt chính xác chuỗi JSON hoặc mã lỗi mà RunningHub trả về khi node lọc nội dung chặn. Kết quả dùng để viết phần ánh xạ sang `CONTENT_BLOCKED`; các Task này là lỗi mong đợi và không tính vào tỷ lệ lỗi kỹ thuật ở điều kiện thông qua.

**Điều kiện thông qua**
- Biên lợi nhuận gộp thực tế của gói Creator không dưới 70%.
- Tỷ lệ lỗi kỹ thuật trên 20 mẫu là 0% (hoàn thành 100%).

**Kế hoạch B nếu không đạt:** nếu biên gộp thực tế của gói Creator dưới 70% hoặc GPU tốn hơn dự tính, điều chỉnh biểu phí trước khi mở cổng nạp, không cần đổi kiến trúc: nâng Motion Control từ 50 lên 60–70 credit/giây, hoặc giảm số credit trong các gói nạp.

**Kiểm thử hạ tầng trước khi bật VietQR thương mại:**
1. Discord: bắn thử tin nhắn webhook từ NestJS.
2. ffmpeg: cắt thử clip 20 giây trên VPS, kiểm tra CPU không bị nghẽn.
3. RunningHub API: kiểm tra endpoint số dư ví và endpoint hủy task.
4. Benchmark ở trên: 10 ảnh + 10 video, kiểm chứng lượng coin tiêu hao.
5. Khôi phục DB: chạy pg_dump, đẩy lên R2 và diễn tập khôi phục một lần.
