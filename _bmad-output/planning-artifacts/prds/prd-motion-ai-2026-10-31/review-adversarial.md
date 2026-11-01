# Review đối kháng: PRD Motion AI (prd.md + addendum.md)

Phạm vi: `prd.md` (updated 2026-11-01) và `addendum.md`. Không sửa PRD. Mức độ: **CRITICAL** (chặn phát hành / mất tiền / rủi ro pháp lý), **HIGH** (lỗ hổng logic rõ ràng), **MEDIUM** (mơ hồ, không test được, mâu thuẫn nhẹ), **LOW** (thẩm mỹ, đánh số).

**Phán quyết: CHƯA ĐẠT để chuyển sang kiến trúc/epics.** Số học bảng biên gộp §11 đúng, nhưng logic Tier/Hold/hàng đợi có lỗ hổng gây mất tiền hoặc khóa credit người dùng. Cổng tuân thủ (đặc biệt Body Retouch và Face Swap) chưa đủ để ra mắt thương mại.

---

## 0. Kiểm chứng số học §11 (tự tính lại)

- Thu/100 credit: 49.000/5.000 = 9,8 → 980; 99.000/12.000 = 8,25 → 825; 199.000/30.000 = 6,633 → 663. **Đúng.**
- Giá bán/giây (50 credit): 490; 412,5; 331,5. **Đúng.**
- Biên gộp vốn 37: (490-37)/490 = 92,4%; (412,5-37)/412,5 = 91,0%; (331,5-37)/331,5 = 88,8%. **Khớp** ~92/91/89.
- Biên gộp vốn 74: 84,9%; 82,1%; 77,7%. **Khớp** ~85/82/77,6.
- Gốc giá vốn: 0,4 coin/giây × 13 = 5,2 coin/giây video. 5,2 × (10 USD/18.000) × ~25.600 VNĐ/USD ≈ 74 VNĐ; với 36.000 coin ≈ 37 VNĐ. **Khớp** nếu tỷ giá ~25.600. Tuy nhiên SM-4 (§8) quy đổi USD 50–100 = 1,25–2,5 triệu (tỷ giá 25.000), nên có hai tỷ giá khác nhau trong cùng tài liệu (sai lệch ~2%, mức LOW).
- Ảnh tĩnh: 1,2–2,0 coin × ~14,2 VNĐ/coin (nạp lẻ) = 17–28 VNĐ; biên so với 663–980 VNĐ khoảng 96–98%, "khoảng 95%" là bảo thủ. **OK.**
- Checklist §12: 5+5+2+3+2+2+1 = 20. **Đúng.**

Kết luận: bảng đúng về số học, nhưng **sai về phạm vi** (xem F-9: bỏ sót chi phí thất bại, tặng tự do, hao hụt do dung sai). Con số 37/74/13 giây GPU đều là giả định chưa đo (addendum), trong khi §10 nói "mọi giả định đã được chốt".

---

## CRITICAL

### F-1. Lách Tier: trả một lần gói Creator, về sau nạp lẻ vẫn giữ Tier/Priority/Cap tối đa
- FR-10: "Tier của tài khoản là gói cao nhất từng nạp… Nạp gói thấp hơn khi đang giữ gói cao hơn thì cộng dồn credit và giữ Tier cao."
- Kịch bản: nạp 199.000 → dùng hết → rơi về FREE (FR-10) → nạp Starter 49.000 → "gói cao nhất từng nạp" vẫn là Creator → Priority 1 + Cap 20 giây vĩnh viễn với giá Starter. Hoặc ngược lại: câu chữ "rơi về FREE cho đến lần nạp kế tiếp" cho thấy nạp kế tiếp khôi phục Tier cũ dù gói nhỏ. Bảng gói (§4.4) vì vậy mất ý nghĩa; mâu thuẫn với doanh thu giả định ở §11 (Creator biên mỏng nhất mà lại dễ lách nhất).
- Cần: định nghĩa Tier duy nhất (theo gói nạp gần nhất? theo tổng nạp trong 30 ngày? theo số dư?) và có test case.

### F-2. Hold tự hạ Tier của chính Task đang xếp hàng (Tier tính theo số dư, nhưng Hold làm giảm số dư)
- FR-10: "Khi số dư dưới 100 credit (ảnh) hoặc dưới 150 credit… tài khoản rơi về FREE". FR-9: Hold trừ ngay khi gửi.
- Người dùng Creator có 1.000 credit gửi video 20 giây → Hold 1.000 → số dư 0 → rơi về FREE. Nếu Priority tính lại động tại thời điểm lấy Task (không nói rõ), Task trả đủ tiền của họ bị đẩy xuống Priority 10 và có thể đói vô hạn (xem F-4). Nếu Priority chốt lúc gửi thì phải ghi rõ; PRD không nói.
- Cùng vấn đề: Cap kiểm lúc nào (lúc kéo thanh trượt, lúc bấm gửi, lúc worker chạy)? Tier có thể đổi giữa các thời điểm đó (FR-5, FR-13). Không có FR nào nêu "Tier được chốt tại thời điểm gửi và lưu vào Task".
- Ngoài ra FR-10 có **hai ngưỡng mâu thuẫn**: số dư 120 là "≥ 100 (đủ ảnh)" nhưng "< 150 (không đủ video 3 giây)" → FREE hay không? Addendum nhắc lại cùng câu mơ hồ ("tác vụ nhỏ nhất").
- Người dùng đã trả 199.000 mà còn 99 credit bị tụt xuống FREE với Priority 10: hợp lý về kinh doanh nhưng gây phản ứng tiêu cực, cần quyết định có chủ đích.

### F-3. Tặng 500 credit không có trần chi: ngân sách USD 50–100 có thể bị đốt bởi bot
- FR-11: "mỗi thiết bị một lần (Device Fingerprint)… tối đa 3 tài khoản mỗi IP/24 giờ… Không đặt trần toàn hệ thống theo ngày." Addendum: "ngưỡng chưa chốt" (mâu thuẫn với con số "3" đã cứng trong PRD).
- Tính nhanh: 500 credit dùng cho 1 video 5 giây ×2 ≈ 10 giây × 74 = 740 VNĐ; 1.000 tài khoản ảo ≈ 740.000 VNĐ ≈ 30% ngân sách trần. Fingerprint trên web dễ bị giả; Google account tạo hàng loạt rẻ; IP xoay vòng/proxy. Tài khoản FREE còn dùng credit tặng để chạy Face Swap/Body Retouch ẩn danh (rủi ro pháp lý, xem F-11).
- Mâu thuẫn mục tiêu: SM-4 và §1 coi USD 50–100 là trần cứng, nhưng cơ chế duy nhất là FR-16 "tạm dừng khi tỷ lệ thất bại > 15%" (đo tỷ lệ lỗi, không đo chi tiêu) và cảnh báo "< 20% ngân sách" (chỉ cảnh báo). Không có FR nào "ngừng cấp credit tặng khi chi tiêu GPU trong ngày vượt X". SM-4 không liệt kê FR-11.
- IP: tại Việt Nam nhiều người dùng chung IP CGNAT của nhà mạng di động (ưu tiên mobile web). "Tài khoản thứ 4 trở đi… 0 credit" sẽ phạt người dùng thật và đánh vào SM-1 (chuyển đổi dùng thử). Không có đường khiếu nại.

### F-4. Đói hàng đợi FREE và Hold bị khóa vô thời hạn
- FR-7: "Task FREE (Priority 10) chỉ được chạy khi hàng đợi không còn Task trả phí nào." Chỉ 2 Lane; 1 video 20 giây chiếm Lane ~260 giây GPU (13 × 20). Thông lượng trần ~27 video 20 giây/giờ cho cả hệ thống. Chỉ cần vài người trả phí liên tục là Task FREE không chạy.
- Timeout (§4.5) "tính từ lúc Task chuyển sang `running`" nên chờ hàng đợi không bị timeout: Task `queued` vô hạn, Hold bị khóa (credit tặng không dùng được cả khi hủy chậm). Không có: thời gian chờ tối đa, độ sâu hàng đợi tối đa, ETA, hết hạn `queued`, hay giới hạn số Task đang chờ mỗi người dùng.
- Trải nghiệm dùng thử (giai đoạn chuyển đổi, SM-1) phụ thuộc đúng nhóm bị đói. PRD không nêu hậu quả đối với SM-1.
- Chưa rõ Task ảnh (Face Swap/Body Retouch) có chia sẻ 2 Lane với video không. FR-7 chỉ nói Motion Control, §6 nói "Worker lấy Task khi có Lane rảnh" cho mọi Task. Một video 20 giây có thể chặn mọi ảnh 5 giây (bao gồm người trả phí).
- Priority 4–9 không dùng (Glossary: Creator=1, FREE=10; bảng: 3/2/1). Không phải lỗi nhưng thiếu lý do; BullMQ priority chặt cũng làm "vị trí hàng đợi" (FR-7) thay đổi liên tục khi có Task ưu tiên cao chen vào, trái với kỳ vọng "báo vị trí" ở UJ-3.

---

## HIGH

### F-5. Đua giữa timeout/Release và kết quả đến muộn; hủy vs bắt đầu chạy
- FR-9 chỉ nói "Settle hoặc Release đúng một lần" nhưng **không nêu bên nào thắng khi đua**. Kịch bản: FR-15 quét chuyển `timed_out` → Release; sau đó webhook RunningHub báo `succeeded`. Bảng lỗi nói "Hủy phía RunningHub nếu có thể" (nghĩa là có thể không hủy được): chi phí GPU phát sinh, người dùng được hoàn credit, và có thể vẫn tải được kết quả. Cần: trạng thái cuối bất biến (compare-and-set), quy tắc kết quả muộn bị bỏ và xóa.
- Hủy: "Người dùng hủy khi còn `queued`" nhưng worker có thể chuyển `running` đồng thời; không định nghĩa CAS. Cancel + submit lặp lại cũng chiếm hàng đợi miễn phí (không có giới hạn số Task đồng thời cho mỗi người dùng; NFR-3 chỉ nói "giới hạn tần suất" chung).
- FR-14 "Release không được thực hiện hai lần" chỉ phủ webhook lặp, không phủ cạnh tranh giữa poll, webhook, sweeper (FR-15), cancel.

### F-6. Thử lại 5xx không có idempotency: trả GPU hai lần, thu một lần
- "RunningHub trả lỗi 5xx hoặc lỗi mạng… thử lại tự động 1 lần sau 5 giây". Lỗi mạng/5xx có thể xảy ra sau khi RunningHub đã tạo job; thử lại tạo job thứ hai. Không có idempotency key/đối soát theo task ID. Cũng không rõ retry có tính vào timeout 180/360 giây không và có giữ nguyên vị trí Lane không.

### F-7. Giá hiển thị so với giá bị thu, dung sai ±0,5 giây, làm tròn
- FR-6: giá = "50 × số giây sau Trim"; FR-5/tham số: Trim "độ chính xác theo frame" (24 FPS → số giây không nguyên, ví dụ 4,54 giây). **Không quy tắc làm tròn** (lên/xuống/gần nhất) → giá hiển thị trên UI so với giá server có thể khác nhau.
- `result_video`: "độ dài = đoạn Trim, dung sai ±0,5 giây, không hoàn phần lẻ": người dùng trả 10 giây (500 credit) có thể nhận 9,5 giây (thiếu 5%, ~25 credit) và hệ thống Settle bình thường. Ngược lại, kết quả 9,49 giây của Trim 10 giây thì `failed` và Release 100% sau khi RunningHub đã tính GPU đầy đủ: chi phí chìm, tạo ngưỡng cạnh tranh cho tỷ lệ lỗi và biên gộp (F-9).
- Biên dưới Trim là 3 giây nhưng dung sai cho phép kết quả 2,5 giây; không nhất quán với "tối thiểu 3 giây".
- Nguồn dung lượng: nêu "chuẩn hóa về 24 FPS" trước hay sau Trim "theo frame"? Video nguồn 30/60 FPS (smartphone) làm số frame lệch.
- **Gian lận phía client**: Trim thực hiện ở frontend (FR-5 "Trim bắt buộc ở frontend"; Glossary "cắt ở frontend trước khi tải lên") và `pose_video` ≤ 100 MB "trước Trim". Không có yêu cầu **server đo lại độ dài thực tế** và tính giá theo giá trị đo được. Người dùng có thể khai `trim_end - trim_start = 3 giây` (150 credit) và tải video 20 giây, hoặc vượt Cap. Cần FR: server tính giá và Cap theo `duration` đo được từ file.
- Khả thi: cắt chính xác theo frame và nén video 100 MB trên Safari/Chrome mobile (ffmpeg.wasm/WebCodecs) là rủi ro kỹ thuật lớn, chưa có phương án dự phòng (cắt phía server).

### F-8. Không kiểm duyệt đầu ra; Body Retouch có thể tạo nội dung khiêu dâm từ ảnh hợp lệ
- FR-18 chỉ kiểm "mọi ảnh đầu vào (và khung hình đại diện của video)". Inpainting/ControlNet với `intensity` 8–10 ("đường cong tối đa", §4.2) có thể biến ảnh mặc đồ thành ảnh khỏa thân/gợi dục; Face Swap lên ảnh target hợp lệ cũng cho ra nội dung nhạy cảm. §6 bước 3 "kiểm tra đầu ra" chỉ kiểm hỏng/độ dài (bảng lỗi), không có bước kiểm duyệt NSFW/trẻ vị thành niên trên kết quả trước khi giao hoặc cho phép chia sẻ.
- Motion Control: chỉ kiểm "khung hình đại diện" của `pose_video`; phần còn lại của video không được kiểm tra. `character_image` có được pre-check không? FR-18 nói "mọi ảnh" nhưng không có trong bảng Motion Control.
- `[NOTE FOR PM]` ở cuối §4.6 thừa nhận rủi ro nhưng để mở "ngưỡng lọc và trách nhiệm pháp lý", trong khi FR-3 đã đặc tả đầy đủ tính năng. Cần quyết định trước (chặn phát hành) chứ không để ghi chú. Thanh trượt UJ-2 "có giới hạn tối đa để tránh méo hình" mâu thuẫn với tham số 1–10 "tối đa" (giới hạn nào?).
- `nsfwjs` chỉ phân loại Porn/Hentai/Sexy/Neutral/Drawing, **không phát hiện tuổi**. FR-18 "nghi vấn trẻ vị thành niên… bị từ chối ngay" và §4.2 NFR "ảnh có người dưới 18 tuổi… phải bị chặn" **không thể hiện thực bằng công cụ đã nêu**: không có model ước lượng tuổi, không có ngưỡng, không có tiêu chí đạt/không đạt. Không test được.
- Đồng thời nsfwjs hay báo nhầm với đồ bơi/thời trang, đúng persona Hà (UJ-2, chủ shop thời trang): chặn nhầm với "không tính phí" nhưng không có đường kháng nghị/review thủ công. Không đo tỷ lệ dương tính giả/âm tính giả trong checklist §12.

### F-9. Kinh tế đơn vị: bảng §11 bỏ qua chi phí thật nên biên "91%/82%" bị thổi phồng
- Tự định nghĩa: "thuần theo giá vốn GPU, chưa tính phí lưu trữ và hao hụt tải" nhưng "Mốc dùng trong PRD: 91%… 82%" được dùng như biên thật và là cơ sở Điều kiện thông qua (Creator ≥ 70%).
- Các khoản chưa tính: (a) mọi Task `failed/timed_out/duration mismatch` đã tiêu GPU nhưng Release 100%: nếu SM-3 chỉ yêu cầu ≥ 90% thành công thì 10% GPU là chi phí chìm; (b) retry tự động (F-6); (c) Task FREE (500 credit × mọi người dùng thử) hoàn toàn là chi phí; (d) phí cổng thanh toán/ngân hàng, thuế (VAT/TNDN), nhân công duyệt tay; (e) credit nạp rồi không dùng (có lợi, nhưng cần ghi nhận); (f) chênh lệch tỷ giá USD; (g) video 20 giây cần "Sliding Context Window" nên có thể không đạt 13 giây GPU/giây, hiện chỉ có 1 mẫu 20 giây trong checklist.
- Hệ quả: tại 82% (nạp lẻ) mà cộng 10% hao hụt Task, biên Creator ở mức 74 VNĐ/giây có thể xuống dưới ~70% ngưỡng thông qua, và checklist không đo chi phí Task thất bại.
- Addendum tự thừa nhận: "74/412 cho biên gộp ~82% và 37/412 cho ~91%, không khớp với con số '> 82% / > 65%' bạn nêu. Cần xác nhận lại." PRD §10 lại tuyên bố "Mọi giả định… đã được chốt (xem memlog)": `memlog` không có trong thư mục, và addendum nói "Chưa có số liệu thực đo". §0 nói giả định được gắn thẻ `[ASSUMPTION]` ở chỗ dùng, nhưng không có thẻ nào trong prd.md. Tài liệu tự mâu thuẫn về độ chắc chắn.
- Giá trị: giá bán ~825 VNĐ/ảnh so với đối thủ 30.000–100.000 VNĐ (§1) thấp hơn ~40–120 lần; "SM-1 ≥5%" khó kết luận mức sẵn sàng chi trả khi giá bị đặt quá thấp. Đây là câu hỏi thiết kế thử nghiệm, không phải lỗi số học.
- Ràng buộc "không voucher/affiliate > 15% cho Creator": tính toán tại 74 VNĐ/giây cho thấy 15% giảm giá Creator còn ~281,8 VNĐ/giây bán → biên 73,7%, vẫn trên 70% nhưng sát. Không có ràng buộc tương đương cho Starter/Pro, và không tính việc giảm giá có thể cộng dồn với khuyến mãi khác.

### F-10. Tiền vào: VietQR duyệt tay thiếu chống trùng, hết hạn, đối soát
- FR-12: "bấm 'Đã chuyển khoản' để tạo yêu cầu `pending`" – người dùng tự khai, không có bằng chứng; không có hạn của mã QR/giao dịch, không có SLA duyệt (người dùng mobile trả 49.000 phải đợi bao lâu?), không giới hạn số yêu cầu `pending` mỗi người dùng (spam dashboard admin).
- FR-13 "Mỗi yêu cầu chỉ duyệt một lần" nhưng **không ràng buộc một giao dịch ngân hàng chỉ gắn một yêu cầu** (mã giao dịch ngân hàng/tham chiếu không được ghi): admin có thể duyệt hai yêu cầu cho một lần chuyển, hoặc một người dùng tạo hai yêu cầu cho cùng một khoản.
- Trạng thái "Cần xem xét" (UJ-4 Edge) không tồn tại trong FR-12/13 (chỉ `pending`, duyệt/từ chối). Sai số tiền, thiếu/thừa, sai nội dung: chưa có luồng (hoàn tiền thật nằm ngoài phạm vi §7.2, nên tiền ngân hàng nhận nhầm xử lý thế nào?). Ngân hàng cắt/đổi ký tự nội dung chuyển khoản không được xét.
- Dashboard nội bộ: không có xác thực, vai trò, 2FA, nhật ký kiểm toán, hay giới hạn "điều chỉnh tay" (FR-8, FR-14b). Một tài khoản admin bị chiếm = in credit vô hạn. Ticket "cộng bù" (FR-14b) không có FR, SLA, hạn mức hay chống lạm dụng (người dùng nộp ảnh méo để xin bù liên tục).
- Hoàn tác khi ngân hàng đảo giao dịch/lừa đảo: sổ cái (FR-8) không có loại bút toán "thu hồi" hay trạng thái tài khoản âm; "không cho số dư âm" xung đột với thu hồi khi credit đã tiêu.

### F-11. Pháp lý và bảo mật dữ liệu
- **Quyền hình ảnh người thứ ba**: FR-17 chỉ cam kết "sở hữu quyền hợp pháp với ảnh" và "người trong ảnh đủ 18 tuổi". Face Swap hoán đổi khuôn mặt của người thật: cần **sự đồng ý của người có khuôn mặt** (quyền đối với hình ảnh, Điều 32 Bộ luật Dân sự 2015), không chỉ quyền sở hữu tấm ảnh. FR-19 chỉ cấm "deepfake mạo danh **ác ý**": tiêu chí chủ quan, không thể test; không có phát hiện người nổi tiếng/chính khách, không có quy trình báo cáo vi phạm, gỡ bỏ (takedown), hay phối hợp cơ quan chức năng.
- **Không có dấu hiệu AI**: không yêu cầu watermark/nhãn "nội dung do AI tạo" trên kết quả hay trang chia sẻ (§NFR-5 "chia sẻ có Open Graph động" làm lan truyền công khai). Cần kiểm tra các quy định mới về AI/nội dung số hiện hành tại Việt Nam trước khi mở bán (cần tư vấn pháp lý, hiện Open question #2 chưa có).
- **Dữ liệu sinh trắc/nhạy cảm**: ảnh khuôn mặt, dáng người xử lý bởi RunningHub (nhà cung cấp bên thứ ba, ngoài Việt Nam) và R2/S3: chuyển dữ liệu xuyên biên giới, đồng ý riêng cho dữ liệu cá nhân nhạy cảm, đánh giá tác động xử lý dữ liệu (Nghị định 13/2023/NĐ-CP). FR-17 chỉ có checkbox "đồng ý cho xử lý hình ảnh". Chính sách quyền riêng tư chưa soạn (§9 #2) nhưng đặt ở "Câu hỏi mở", trong khi cổng VietQR lại chỉ phụ thuộc #1 (§12).
- **Mâu thuẫn lưu trữ vs điều tra**: NFR-2 xóa đầu vào sau 7 ngày, kết quả 30 ngày; FR-19 "giữ nhật ký phục vụ điều tra" và "khóa tài khoản vi phạm lặp lại". Không nói log chứa gì (hash ảnh? ảnh vi phạm?), giữ bao lâu, xử lý credit của tài khoản bị khóa (hoàn? tịch thu? ToS?). Ảnh bị chặn bởi Pre-check có lưu để bằng chứng không?
- **Tuổi**: chỉ tự khai (checkbox) và nsfwjs; không có xác minh. Đăng nhập Google không bảo đảm 18+. Thanh toán ngân hàng chỉ gián tiếp. Persona "Minh 19 tuổi" ở sát ranh giới.
- Quy định về credit trả trước (không hết hạn, không hoàn tiền, §7.2), hóa đơn điện tử, thuế, đăng ký kinh doanh thương mại điện tử: không đề cập; cần ghi trong Open questions.
- Chia sẻ: link công khai tới ảnh khuôn mặt/ảnh cơ thể người dùng: chưa quy định quyền truy cập, hết hạn, thu hồi, và ảnh hưởng nếu kết quả bị cờ NSFW.

---

## MEDIUM

### F-12. Mâu thuẫn nội bộ về Hold, Pre-check và trạng thái
- §4.5 bảng lỗi: "Pre-check vi phạm nội dung → `rejected` → **Release 100%**", và FR-14 liệt kê `rejected` trong nhóm phải Release. Nhưng FR-18 và §6: Pre-check chạy "**trước khi trừ credit**"/"trước khi Hold", và dòng "Validate sai → Không Hold". Nếu chưa Hold thì không có gì để Release; nếu Hold rồi thì mâu thuẫn FR-18. UJ-1 Edge cũng nói "báo lỗi ngay trước khi trừ credit".
- FR-20 "worker phải reject Task ngay, Release 100%" cho lỗi pose: worker chạy sau Hold nên hợp lệ, nhưng trạng thái `rejected` được định nghĩa là "bị Pre-check chặn" (§4.5), nên lỗi pose nên là `failed` hay `rejected`? Còn: việc phát hiện pose chạy trong workflow RunningHub (đã tốn GPU) hay ở backend? PRD yêu cầu validate "nhận diện được khung xương ở frame đầu" ngay trong bảng tham số, nhưng không chỉ rõ chỗ chạy.
- UJ-1: "tích cam kết ToS (**một lần mỗi phiên**)" mâu thuẫn với bảng tham số `consent` (Bắt buộc: Có, mỗi Task) và FR-17 "Không tích thì không gửi được". Cũng FR-17 nói cam kết bắt buộc "khi tạo tài khoản và khi nạp tiền" với nội dung khác (cấm khiêu dâm, miễn trừ…), nhưng nội dung ToS còn nằm ở Open question #2 (chưa soạn).
- FR-1 Acceptance: "số dư giảm 100 dưới dạng Hold" nhưng Glossary: Hold là "giữ tạm… chưa trừ hẳn". Với "số dư là tổng bút toán" (FR-8) và loại bút toán gồm Hold, Settle, Release: nếu Hold ghi -100, Settle ghi thêm -100 thì tính đôi. Cần định nghĩa số dư khả dụng, số dư giữ, tổng.
- Timeout 360 giây "gồm thời gian render, tải input lên và tải kết quả về Storage", với trần render video 200–260 giây (20 × 13 = 260) → còn ≤ 100 giây cho tải lên 100 MB (trước Trim), cold start, tải về; chỉ 1 mẫu 20 giây trong benchmark. Hơn nữa hàng đợi nội bộ của RunningHub (nếu có) cũng tính vào `running` của ta.
- FR-16: cửa sổ 30 phút, ngưỡng 15%, **không có mẫu tối thiểu** (2/10 Task lỗi đã kích hoạt), không nêu cách tiếp tục, và không loại lỗi do người dùng (FR-20) khỏi tử số. Người dùng độc hại có thể gửi video lỗi để dừng hệ thống (DoS). Thêm vào đó mâu thuẫn ngưỡng: SM-3 chấp nhận ≥ 90% thành công (tức ≤ 10% lỗi), FR-16 tạm dừng ở > 15%, điều kiện §12 yêu cầu 0% lỗi trên 20 mẫu. Ba ngưỡng khác nhau, không rõ cái nào quyết định.
- Ngưỡng mẫu §12: 0 lỗi trên 20 mẫu chỉ cho cận trên khoảng tin cậy 95% ~14% (quy tắc "rule of three": 3/20 = 15%), không chứng minh gì về SM-3; mẫu 20 giây chỉ 1 mẫu, nhưng gate lại dựa trên biên Creator. Thiếu mẫu cho kiểm duyệt (dương tính giả), kiểm thử tải 2 Lane, và các test tranh chấp Tier/refund.

### F-13. Hạn chế/hành vi chưa đặc tả
- "Hết credit RunningHub (ngân sách trần) → Release 100%": chỉ chặn Task mới, không nói Task đã `queued`/`running` ra sao; và cảnh báo "< 20%" không chặn gì.
- Không có giới hạn số Task đồng thời/ngày cho mỗi người dùng (NFR-3 chỉ "giới hạn tần suất theo tài khoản và IP" mà không có số).
- Lịch sử (UJ-1 "ảnh lưu trong Lịch sử") đối chiếu NFR-2: kết quả xóa sau 30 ngày, đầu vào sau 7 ngày; ảnh so sánh trước/sau (FR-4) cần ảnh gốc: sau 7 ngày thanh so sánh vỡ. Chưa có hành vi UI khi file hết hạn.
- Kết quả kích thước: Face Swap "bằng `target_image`" – ảnh sau resize 2048 hay ảnh gốc? Body Retouch "cùng kích thước đầu vào" tương tự. Quy tắc validate Body Retouch chọn "người nổi bật nhất" nhưng người dưới 18 tuổi khác trong ảnh (không bị đổi) vẫn lọt qua cam kết.
- "chiếm ≥ 10% diện tích ảnh", "rõ", "nổi bật", "nhân vật chiếm tiêu điểm chính", "ảnh toàn thân rõ" là tiêu chí không đo được (không có ngưỡng/detector/độ tin cậy) – không test được.
- Acceptance FR-1 "Task ở `queued` trong 2 giây sau khi bấm" mâu thuẫn với việc backend còn phải validate lại + chạy Pre-check (F-12) – 2 giây có gồm upload không? FR-2 và FR-3..FR-7 không có Acceptance; FR-4, FR-6 không đo được ("thời gian thực").
- NFR-4 "không có race condition làm âm số dư" chỉ là mục tiêu, không có cơ chế (khóa hàng/serializable) hay test đồng thời; FR-9 có "cùng một giao dịch CSDL" nhưng việc kiểm tra số dư với nhiều Task song song chưa có yêu cầu kiểm thử (ví dụ N=10 request đồng thời với số dư đủ cho 1).
- FR-14b: "file đầu ra đen hoặc hỏng" – không có định nghĩa phát hiện; UJ-2 hứa "giữ nguyên mặt và phông nền" nhưng FR-14b nói chất lượng không bảo đảm. Kỳ vọng UJ không khớp chính sách.
- Addendum: bảng CSDL chỉ có `users`, `tasks`, `transactions`: thiếu bảng cho yêu cầu nạp (FR-12/13), đồng ý ToS có phiên bản (FR-17), fingerprint/IP (FR-11), nhật ký kiểm duyệt (FR-19), nhật ký admin. Biến môi trường `RUNNINGHUB_WORKFLOW_BODY_RESHAPE` khác tên "Body Retouch".
- Chưa có tên cho tiêu chí "mặt có bounding box lớn nhất" với source_face "đúng 1 khuôn mặt" trong khi `consent` của nhiều người trong target không được nhắc.

---

## LOW

- **Thứ tự và đánh số FR**: FR-20 đứng *trước* FR-5 trong §4.3; FR-14b không theo số nguyên; §0 nói "FR đánh số toàn cục" nhưng thứ tự đọc là FR-1…4, FR-20, FR-5…7, FR-8…13, FR-14, 14b, 15…19. FR-20 nên là FR-8 hoặc đặt cuối mục.
- Bảng truy vết: SM-1 "Validates FR-1, FR-3, FR-6, FR-11, FR-12" bỏ FR-13 (duyệt tay là nút cổ chai chuyển đổi). SM-3 "Validates FR-14, FR-15" bỏ FR-16, FR-20. SM-4 "Validates FR-7, FR-16" bỏ FR-11 (rủi ro lớn nhất, F-3). SM-C2 "đối trọng của SM-3" gượng ép.
- §4.4 FR-8/FR-14 mô tả "Release" cho `rejected`, nhưng danh sách loại bút toán FR-8 không có "thu hồi/khóa tài khoản".
- Tên "Motion AI" tạm; "50–100 USD ≈ 1,25–2,5 triệu" dùng 25.000 VNĐ/USD khác với 25.600 ngầm trong §11.
- Người dùng mục tiêu: "Doanh nghiệp cần API" bị loại nhưng persona Hà (chủ shop) là dùng thương mại; ToS "chỉ dùng hình ảnh thuộc quyền sở hữu cá nhân" (FR-17) mâu thuẫn với dùng cho shop.
- Glossary Tier: "quyết định thời lượng tối đa và độ ưu tiên" nhưng không giải thích rằng Tier còn phụ thuộc số dư (chỉ ở FR-10).

---

## Khuyến nghị ưu tiên (thứ tự xử lý trước khi chuyển sang kiến trúc)

1. Viết lại FR-10: một định nghĩa Tier duy nhất, chốt Tier + Priority + Cap vào Task lúc gửi, không tính Hold vào ngưỡng; thêm test case F-1/F-2.
2. Thêm trần chi tiêu GPU hằng ngày và cơ chế khóa tặng credit (F-3); đặt tỉ lệ lỗi/thời gian chờ vào FR-7 (F-4).
3. Đặc tả máy trạng thái Task bất biến (CAS), quy tắc kết quả đến muộn, idempotency key RunningHub (F-5, F-6).
4. Server đo lại độ dài video, quy tắc làm tròn giá, đồng nhất dung sai (F-7).
5. Quyết định chính sách Body Retouch/Face Swap + kiểm duyệt đầu ra + model ước lượng tuổi hoặc bỏ yêu cầu "nghi vấn trẻ vị thành niên" khỏi nsfwjs (F-8, F-11); tư vấn pháp lý trở thành gate cùng với benchmark.
6. Cập nhật bảng §11 với chi phí Task lỗi, credit FREE, phí thanh toán; đưa SM-3/FR-16/§12 về một ngưỡng nhất quán (F-9, F-12).
