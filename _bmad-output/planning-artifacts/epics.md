---
status: final
stepsCompleted:
  [
    "step-01-validate-prerequisites",
    "step-02-design-epics",
    "step-03-create-stories",
    "step-04-final-validation",
  ]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-motion-ai-2026-10-31/prd.md
  - _bmad-output/planning-artifacts/prds/prd-motion-ai-2026-10-31/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-motion-ai-2026-11-01/ARCHITECTURE-SPINE.md
  - _bmad-output/specs/spec-motion-ai/SPEC.md
  - _bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/EXPERIENCE.md
---

# motion-ai - Epic Breakdown

## Overview

Tài liệu này phân rã yêu cầu từ PRD, kiến trúc (ARCHITECTURE-SPINE), SPEC và bộ đôi hợp đồng UX (DESIGN.md, EXPERIENCE.md tại `_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/`) thành epic và story có thể triển khai. Toàn bộ các story giao diện (frontend) tuân thủ nghiêm ngặt nhận diện thị giác Slate Cyber, chuẩn icon vector Lucide (`nuxt-icon`, tuyệt đối không dùng emoji UTF-8 trong UI chrome), vùng chạm tối thiểu 48px và các quy chuẩn hành vi (Before/After split slider, 1s video trimmer, VietQR in-context sheet, microcopy minh bạch tài chính). Mã FR/NFR giữ nguyên số của PRD (FR1 = FR-1). PRD không có NFR5 nên danh sách NFR bỏ qua số này.

## Requirements Inventory

### Functional Requirements

FR1: Người dùng đã đăng nhập tải lên `source_face` và `target_image` và tạo Task Face Swap bằng một lần bấm khi số dư ≥ 100 credit; Task ở trạng thái `queued` trong 2 giây và credit bị HOLD 100. Ảnh không có mặt thì Task `failed` và RELEASED 100% kèm thông báo "Không nhận diện được khuôn mặt trong ảnh".
FR2: Hệ thống trả `result_image` đã lưu trên R2 (không dùng link CDN RunningHub) kèm nút Tải về/Chia sẻ, ghi EXIF (`Software`: AI Generator, `Comment`: AI-Generated Content). SLA Face Swap ≤ 60 giây tính từ lúc worker bắt đầu đến khi ảnh lên R2, khi GPU không nghẽn.
FR3: Người dùng tạo Task Body Retouch bằng một lần bấm với `input_image` và `intensity` (số nguyên 1–10, mặc định 5), 100 credit.
FR4: Trang kết quả hiển thị ảnh gốc và ảnh kết quả cạnh nhau bằng thanh trượt so sánh.
FR5: Nếu node đầu tiên của workflow không trích xuất được khung xương người từ `pose_video`, Task chuyển `failed` ngay, RELEASED 100% và hiển thị "Không nhận diện được chuyển động cơ thể trong video mẫu".
FR6: Người dùng bắt buộc chọn đoạn video bằng thanh trượt bước 1 giây (3 giây đến Cap của Tier); backend đo lại độ dài thật và không tin giá trị client; worker cắt bằng ffmpeg re-encode (libx264, preset veryfast, 24 FPS), mỗi lúc một tiến trình.
FR7: Giá Motion Control (50 credit × số giây nguyên sau Trim) hiển thị theo thời gian thực khi kéo thanh trượt; số credit HOLD bằng đúng giá hiển thị; dung sai ±0,5 giây của file đầu ra không đổi số credit đã trừ.
FR8: Một hàng đợi chung cho cả ba Pipeline, 2 Lane dùng chung; lấy Task theo Priority của Tier Snapshot (số nhỏ chạy trước), cùng Priority thì FIFO; Task FREE (Priority 10) chỉ chạy khi không còn Task trả phí chờ và bị gỡ, hoàn credit sau 15 phút; hiển thị vị trí hàng đợi cho người dùng.
FR9: Sổ cái credit gồm bút toán bất biến (nạp, tặng, HOLD, CAPTURED, RELEASED, điều chỉnh tay); số dư là tổng bút toán; không cho số dư âm.
FR10: Khi gửi Task, HOLD đúng số credit trong cùng giao dịch CSDL với việc tạo Task; thành công thì CAPTURED, thất bại hoặc hủy thì RELEASED; mỗi Task chỉ CAPTURED hoặc RELEASED đúng một lần; trạng thái kết thúc đầu tiên thắng, kết quả đến muộn bị bỏ qua.
FR11: Tier là gói cao nhất đã nạp kể từ lần gần nhất ở hạng FREE, còn hiệu lực khi tổng credit sở hữu (số dư khả dụng cộng credit đang HOLD) ≥ 100; dưới 100 thì rơi về FREE và xóa lịch sử gói; Tier chụp snapshot lúc bấm Tạo.
FR12: Cấp 500 credit khi đăng ký Google thành công, mỗi thiết bị một lần (Device Fingerprint); tối đa 3 tài khoản nhận credit tặng mỗi IP trong 24 giờ, tài khoản thứ 4 trở đi nhận 0 credit; không có trần theo ngày hay trần tổng.
FR13: Sinh mã VietQR đúng số tiền với nội dung `NAP <MÃ_GIAO_DỊCH>` (duy nhất, dùng một lần); người dùng bấm "Đã chuyển khoản" để đơn chuyển `pending`; QR hiệu lực 15 phút, đơn đã bấm xác nhận giữ chờ Admin đến 08:00 nếu ngoài giờ.
FR14: Discord thông báo Admin khi có đơn nạp mới `pending`; Admin xem danh sách, đối chiếu ngân hàng, duyệt (bắt buộc nhập `bank_ref` duy nhất) hoặc từ chối (ghi lý do); duyệt cộng credit, cập nhật Tier và Priority; mỗi đơn duyệt một lần; mọi thao tác ghi nhật ký; dashboard chỉ cho Admin đã xác thực.
FR15: Tự động RELEASED cho mọi Task đã HOLD kết thúc ở `failed`, `timed_out`, `cancelled`, kèm thông báo trong giao diện; không RELEASED hai lần khi kết quả poll lặp lại.
FR16: Không tự hoàn credit khi workflow thành công mà kết quả xấu; chỉ hoàn tự động với lỗi kỹ thuật (crash, timeout, RunningHub báo lỗi node, file đầu ra đen/hỏng); Admin cộng bù tay khi xác nhận lỗi hệ thống.
FR17: Tiến trình quét định kỳ chuyển Task `running` quá hạn sang `timed_out` và RELEASED (ảnh 180 giây, video 360 giây tính từ lúc tải input lên RunningHub; bước chuẩn bị có hạn riêng 120 giây).
FR18: Khi hơn 15% Task lỗi hệ thống trong cửa sổ trượt 30 phút (hoặc 5 lỗi liên tiếp), tạm dừng nhận Task mới và gửi cảnh báo Discord; cảnh báo Discord khi số dư RunningHub dưới USD 15; khi RunningHub cạn tiền, dừng nhận Task mới, Task chờ thất bại nhanh và RELEASED, nạp credit và tải kết quả vẫn hoạt động.
FR19: Bắt buộc tích cam kết ToS trước mỗi lần tải ảnh/video lên, khi tạo tài khoản và khi nạp tiền (quyền sở hữu hình ảnh, người trong ảnh đủ 18 tuổi, người có khuôn mặt đã đồng ý, cấm nội dung khiêu dâm/bôi nhọ, miễn trừ trách nhiệm); lưu thời điểm và phiên bản ToS.
FR20: [HOÃN SANG v2 — không thuộc MVP] Pre-check nội dung tự động bằng nsfwjs hoặc tương đương (ngưỡng 0,85 nhãn Porn/Hentai) trước khi HOLD. MVP dựa vào ToS và node lọc sẵn có của workflow RunningHub (mã `CONTENT_BLOCKED`, thông báo "Ảnh/video vi phạm tiêu chuẩn cộng đồng, vui lòng chọn file khác.").
FR21: Cấm tuyệt đối nội dung liên quan người dưới 18 tuổi và deepfake mạo danh ác ý; Admin khóa được tài khoản vi phạm lặp lại; giữ nhật ký phục vụ điều tra.
FR22: Nút hoặc email báo cáo vi phạm ở chân trang; Admin xóa ngay file trên R2 khi có khiếu nại và ghi nhật ký; link chia sẻ của file đó trả lỗi không tồn tại.

### NonFunctional Requirements

NFR1: Zero Idle Cost — không duy trì GPU; mọi xử lý đẩy sang RunningHub theo từng Task.
NFR2: Kết quả được sao chép từ CDN RunningHub về R2; đầu vào tự xóa sau 7 ngày, kết quả sau 30 ngày (Lifecycle Rule).
NFR3: Workflow ID và API key RunningHub chỉ ở backend; giới hạn tần suất theo tài khoản và IP.
NFR4: Toàn vẹn credit — mọi thao tác ví nằm trong giao dịch CSDL; không race condition làm âm số dư khi gửi đồng thời nhiều Task.
NFR6: Mobile web — chạy trên trình duyệt di động phổ biến, tải ảnh từ camera/thư viện; chia sẻ có Open Graph động; người dùng tự bấm Chia sẻ cho từng kết quả, mặc định không công khai.
NFR7: Quan sát — log theo Task ID, đo tỷ lệ thành công, thời gian xử lý và chi phí GPU thực tế mỗi Task.

### Additional Requirements

Kiến trúc không chỉ định starter template; dự án greenfield, nên Epic 1 Story 1 là dựng bộ khung monorepo.

- AR1: Monorepo: `apps/web` (Nuxt 4), `apps/api` (NestJS, hai entrypoint `src/main.ts` và `src/worker.ts`; module `auth`, `wallet`, `tasks`, `pipelines`, `topups`, `storage`, `ops`, `audit`; port `RunningHubPort`, `StoragePort`, `NotifierPort`), `packages/contracts` (DTO, `reasonCode`, `ApiErrorCode`, schema validate dùng chung FE/BE), `deploy/compose.yml`.
- AR2: Phiên bản ghim: Node ≥ 22.22.3, Nuxt 4.6.3, NestJS 12.3.2, `@nestjs/bullmq` 12.0.0, bullmq 6.5.3, Prisma 7.10.1 + `@prisma/adapter-pg` 7.10.1 (cần `prisma.config.ts`, generator `prisma-client`), ioredis 5.11.1, sharp 0.35.5, `@nestjs/throttler` 6.7.1, `@nestjs/schedule` 12.0.2, `@nestjs/jwt` 12.0.3, `@nestjs/passport` 12.0.0, passport-google-oauth20 2.0.0, `@aws-sdk/client-s3` và `s3-request-presigner` 3.1161.0, PostgreSQL 16, Redis 7.
- AR3: Hạ tầng: VPS 4 vCPU/8GB chạy đúng 4 container (`nestjs-api`, `nestjs-worker`, `postgres-16`, `redis-7`) bằng Docker Compose; Cloudflare Proxy với SSL Full (strict) và Origin CA cài vào NestJS (HTTPS options); `ufw` chỉ mở cổng API cho dải IP Cloudflare; tin `CF-Connecting-IP` chỉ khi đến từ dải đó; tắt worker cũ trước khi bật worker mới.
- AR4: FE Nuxt 4 chạy trên Cloudflare Pages; checklist dựng FE: kiểm preset Nitro trong `nuxt.config.ts` (`cloudflare-pages` hoặc `cloudflare_module`) và chạy `npm run build` ở máy để xác nhận đúng thư mục đầu ra trước khi đẩy lên git.
- AR5: CSDL: migration SQL thô cho các chỉ mục duy nhất một phần và `CHECK (balance >= 0)`, `CHECK (held >= 0)`; lỗi P2002 trong luồng ví luôn rollback toàn bộ transaction; test CI trên PostgreSQL thật xác nhận các ràng buộc và việc pool dùng lại được sau lỗi.
- AR6: Sổ cái (AD-2): `ledger_entries` chỉ INSERT; dấu `GRANT/TOPUP` +n, `ADJUST` ±n, `HOLD` −n, `RELEASED` +n, `CAPTURED` 0; `users.balance = SUM(amount)`, `users.held` do `wallet` giữ cùng transaction; job đối soát hằng ngày cảnh báo lệch.
- AR7: Mỗi bảng một module chủ ghi (AD-1); chung transaction theo AD-16: module chủ luồng mở `tx` cho module kia, bốn luồng (tạo Task, kết thúc Task, đăng ký, duyệt nạp tiền); `wallet.capture/release` chỉ nhận `taskId`; service `audit` duy nhất ghi `admin_audit`.
- AR8: Trình tự tạo Task (AD-3): validate (kèm `consent`, `locked_at`), transaction (`wallet.hold`, INSERT Task), sau commit mới enqueue BullMQ với `jobId = taskId`, `removeOnComplete/removeOnFail: true`; bộ quét enqueue lại Task `queued` thiếu job.
- AR9: Máy trạng thái bằng compare-and-set trên DB (AD-4, AD-5): `tasks.transition(taskId, from, to, reasonCode)`; chuyển hợp lệ `queued→running|cancelled|timed_out|failed`, `running→succeeded|failed|timed_out`; Redis `SET NX` chỉ là gợi ý; nhánh khôi phục khi job được giao lại; enum `reasonCode` và enum riêng `ApiErrorCode`.
- AR10: Hàng đợi và worker (AD-6): một hàng đợi BullMQ, `concurrency = 2`, priority không dùng 0; cột `queued_at`, `running_at`, `prep_deadline_at`, `deadline_at` (ghi một lần), `submit_started_at`, `finished_at`, `rh_orphan_until`, `gate_deadline`, `enqueue_attempts`; cổng đồng thời RunningHub bằng mutex trong tiến trình (`RH_MAX_CONCURRENT`, mặc định 2); không bao giờ submit lại; poll `/task/openapi/outputs` mỗi 3 giây; `AbortSignal` cho mọi thao tác dài; bộ quét 30 giây; hủy Task chỉ khi `queued`.
- AR11: Nhập kết quả (AD-7): tải về R2 (3 lần), kiểm tra file (không rỗng, không toàn đen, độ dài ±0,5 giây), ghi EXIF, lưu `consumeMoney` vào `gpu_coins` kể cả khi `FAILED` nếu có, rồi mới CAPTURED.
- AR12: Lưu trữ (AD-8): presigned PUT vào `in-raw/<userId>/<uuid>` (ký kèm Content-Length), `HEAD` kiểm kích thước và ETag, `CopyObject` có `CopySourceIfMatch` sang `in/`; tối đa 10 file tạm chưa tạo Task mỗi người; lifecycle `in-raw/` 1 ngày, `in/` 7 ngày, `out/` 30 ngày; bucket riêng tư, CORS chỉ miền FE; chia sẻ qua token: `GET /s/<token>` chuyển hướng tới URL ký, trang Nuxt SSR `/share/<token>` đặt Open Graph.
- AR13: Nhận diện mặt và khung xương là node đầu tiên của workflow ComfyUI trên RunningHub, chạy sau HOLD; lỗi có tiền tố `NO_POSE`, `NO_FACE`, `CONTENT_BLOCKED`; server không chạy model nhận diện.
- AR14: Tier (AD-10): chỉ `wallet` tính, hàm thuần chạy trong cùng transaction với `GRANT/TOPUP/ADJUST/CAPTURED`; mỗi transaction ví khóa đúng một dòng user.
- AR15: Giá và Trim (AD-11): bảng giá và Cap cấu hình phía server; `ffprobe` ở API khi tạo Task; ảnh resize cạnh dài 2048 px bằng sharp; ffmpeg một khóa trong tiến trình worker, thời gian chờ khóa nằm trong `prep_deadline_at`.
- AR16: Xác thực (AD-12): Google OAuth qua NestJS, access JWT 15 phút, refresh token ngẫu nhiên lưu hash trong `refresh_tokens`, xoay mỗi lần dùng, thu hồi khi khóa tài khoản; cookie `Secure`, `SameSite=Lax`; transaction đăng ký dùng `pg_advisory_xact_lock(hash IP)`; Admin đầu tiên cấp bằng `ADMIN_EMAILS`.
- AR17: Nạp tiền (AD-13): trạng thái `awaiting_transfer → pending → approved | rejected | needs_review`, `expired`; `qr_expires_at`, `approve_by` (15 phút sau thời điểm đầu tiên trong 08:00–23:00 giờ Việt Nam), `bank_ref` bắt buộc mọi lần duyệt; QR sinh cục bộ theo VietQR/EMVCo; tối đa 3 đơn chờ mỗi người.
- AR18: Ngắt mạch (AD-14): cờ `intake_paused` và `rh_budget_exhausted` lưu trong bảng `settings`, `breaker_reset_at`, API trả 503 `PAUSED` chỉ cho route tạo Task; poll số dư RunningHub và cảnh báo khi dưới USD 15.
- AR19: Redis (AD-15): `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction`; `maxRetriesPerRequest: null` cho kết nối worker; không lưu dữ liệu duy nhất trong Redis.
- AR20: Giới hạn tải (AD-17): `@nestjs/throttler` theo tài khoản và IP cho route ghi; tối đa 3 Task `queued` hoặc `running` mỗi người.
- AR21: Tuân thủ và Admin (AD-18): `tos_version`, `tos_accepted_at`, `consent` trên Task, `locked_at`, `share_tokens`, `admin_audit`.
- AR22: Công việc định kỳ bằng `@nestjs/schedule` trong worker (bộ quét, hết hạn/cảnh báo đơn nạp, đối soát sổ cái, poll số dư RunningHub); `pg_dump` 03:00 chạy trong image worker (`postgresql-client-16`, `@aws-sdk/client-s3`), đẩy lên R2, giữ 7 bản.
- AR23: Cảnh báo vận hành qua Discord webhook (`NotifierPort`): đơn VietQR mới, ngắt mạch, số dư RunningHub dưới USD 15, đơn quá `approve_by`.
- AR24: Cổng trước khi bật VietQR thương mại: (1) bắn thử webhook Discord; (2) cắt thử clip 20 giây bằng ffmpeg trên VPS và kiểm tra CPU; (3) kiểm tra endpoint số dư ví và endpoint hủy task của RunningHub; (4) benchmark 10 ảnh + 10 video (5 Face Swap, 5 Body Retouch ở intensity 3/5/8, video 3/5/10/15/20 giây) cộng 1–2 ảnh nhạy cảm để bắt chuỗi lỗi thật của node lọc; điều kiện qua: biên gộp gói Creator ≥ 70% và 0% lỗi kỹ thuật; (5) chạy `pg_dump`, đẩy lên R2 và diễn tập khôi phục một lần. Kế hoạch B nếu không đạt: nâng Motion Control lên 60–70 credit/giây hoặc giảm credit trong gói.
- AR25: Kiểm thử CI bắt buộc: ràng buộc DB tồn tại và từ chối ghi trùng; P2002 rồi pool còn dùng được; `ffmpeg -encoders` có `libx264`; BullMQ chạy đúng với ioredis đã ghim.

### UX Design Requirements

Không có tài liệu UX (DESIGN.md, EXPERIENCE.md) trong lần chạy này, nên không có mục UX-DR. Chi tiết giao diện do hành trình UJ-1..UJ-4 của PRD quy định.

### FR Coverage Map

FR1: Epic 2 - Tạo Task Face Swap một lần bấm, HOLD 100 credit
FR2: Epic 2 - Kết quả trên R2, tải về/chia sẻ, EXIF, SLA 60 giây
FR3: Epic 4 - Tạo Task Body Retouch với `intensity`
FR4: Epic 4 - Thanh trượt so sánh trước/sau
FR5: Epic 5 - Từ chối video không có khung xương người
FR6: Epic 5 - Thanh trượt Trim bước 1 giây, ffmpeg cắt trên worker
FR7: Epic 5 - Giá Motion hiển thị theo thời gian thực, bằng đúng số credit HOLD
FR8: Epic 2 - Hàng đợi chung, 2 Lane, Priority, FIFO, FREE hết hạn 15 phút, vị trí hàng đợi
FR9: Epic 1 - Sổ cái credit bất biến
FR10: Epic 2 - HOLD → CAPTURED/RELEASED, trạng thái kết thúc đầu tiên thắng
FR11: Epic 1 - Tier, rơi về FREE, Tier Snapshot
FR12: Epic 1 - Tặng 500 credit, chống lạm dụng theo thiết bị và IP
FR13: Epic 3 - VietQR đúng số tiền, QR 15 phút, "Đã chuyển khoản"
FR14: Epic 3 - Discord báo đơn mới, Admin duyệt với `bank_ref`, `admin_audit`
FR15: Epic 2 - Tự động RELEASED khi lỗi, idempotent
FR16: Epic 6 - Chính sách chất lượng: không tự hoàn, Admin cộng bù tay
FR17: Epic 2 - Bộ quét Task quá hạn → `timed_out` + RELEASED
FR18: Epic 6 - Ngắt mạch, cảnh báo Discord, xử lý RunningHub hết tiền
FR19: Epic 1, 2, 3 - ToS khi đăng ký (Epic 1), trước mỗi lần tải lên (Epic 2), khi nạp tiền (Epic 3)
FR20: Hoãn sang v2 - không có story trong MVP
FR21: Epic 6 - Khóa tài khoản, nhật ký điều tra
FR22: Epic 6 - Báo cáo vi phạm và gỡ bỏ file khẩn cấp trên R2

NFR1: Epic 2 · NFR2: Epic 2, 6 · NFR3: Epic 1 · NFR4: Epic 1 · NFR6: Epic 2, 6 · NFR7: Epic 6

## Epic List

### Quy ước hai luồng song song (BE và FE)

Mỗi epic gồm story **[CONTRACT]** (nếu có), các story **[BE]** và **[FE]** tách riêng, và có thể có story **[INTEGRATION]** cuối epic.

- **Hợp đồng trước:** `packages/contracts` là nguồn duy nhất cho DTO, schema validate, `reasonCode`, `ApiErrorCode`, bảng giá và Cap. Chỉ story [CONTRACT] hoặc [SHARED] mới sửa thư mục này; story [CONTRACT] của epic phải merge trước khi hai luồng của epic đó rẽ nhánh.
- **FE chạy trên mock:** FE gọi API qua client có kiểu sinh từ `packages/contracts` và dữ liệu giả cùng schema; một test hợp đồng ở CI kiểm tra phản hồi của mock và của BE đều khớp schema.
- **Ranh giới thư mục:** luồng BE chỉ sửa `apps/api` và `deploy/`; luồng FE chỉ sửa `apps/web`. Muốn đổi hợp đồng, luồng FE ghi yêu cầu cho luồng BE thay vì tự sửa.
- **Cổng tuần tự:** Story 1.1 và 1.2 làm trước, tuần tự; hai luồng song song bắt đầu sau khi chúng merge.
- **Mỗi luồng một nhánh git/worktree**, merge thường xuyên.

### Epic 1: Nền tảng, đăng nhập và credit dùng thử

Người dùng đăng nhập bằng Google, nhận 500 credit tặng có kiểm soát lạm dụng và thấy số dư cùng Tier của mình. Epic này dựng monorepo (`apps/web`, `apps/api` với hai entrypoint, `packages/contracts`, `deploy/compose.yml`, CI) và hợp đồng chung để hai luồng làm độc lập.
**FRs covered:** FR9, FR11, FR12, FR19 (phần đăng ký)
**Ghi chú:** dự án greenfield nên Story 1.1 là bộ khung monorepo; gồm sổ cái, ràng buộc DB, Tier Snapshot (AD-1, AD-2, AD-10, AD-12, AD-16), AR1–AR5, AR19, AR25.

### Epic 2: Face Swap một lần bấm, hoàn credit khi lỗi

Người dùng ghép mặt chỉ bằng một lần bấm, nhận ảnh kết quả trên R2, tải về hoặc chia sẻ, và được hoàn credit tự động khi hệ thống lỗi. Epic này dựng động cơ xử lý Task dùng chung cho mọi pipeline: upload, hàng đợi, worker, RunningHub, máy trạng thái, HOLD/CAPTURED/RELEASED, bộ quét.
**FRs covered:** FR1, FR2, FR8, FR10, FR15, FR17, FR19 (trước mỗi lần tải lên)
**Ghi chú:** epic nặng nhất, gồm AR8–AR12 (kể cả cổng đồng thời RunningHub và cửa sổ job mồ côi, vì job mồ côi phát sinh từ mọi pipeline), AR13; có phần chia sẻ kết quả bằng token và Open Graph. Việc đo SLA 60 giây của Face Swap nằm ở benchmark Epic 6, vì smoke test dùng RunningHub giả.

### Epic 3: Nạp credit bằng VietQR

Người dùng nạp credit bằng VietQR và lên Tier; Admin duyệt đơn trên dashboard. Epic này chỉ cần Epic 1, không phụ thuộc Epic 2.
**FRs covered:** FR13, FR14, FR19 (khi nạp tiền)
**Ghi chú:** AR17, AR23 (Discord báo đơn mới), `admin_audit`, `bank_ref`; dashboard Admin là phần FE độc lập nhất.

### Epic 4: Body Retouch

Người dùng chỉnh dáng ảnh theo mức `intensity` 1–10 và xem so sánh trước/sau. Epic này dùng lại động cơ Task của Epic 2 nên nhỏ.
**FRs covered:** FR3, FR4

### Epic 5: Motion Control

Người dùng cho nhân vật chuyển động theo video mẫu, cắt đoạn bằng thanh trượt Trim và thấy giá theo thời gian thực, giới hạn thời lượng theo Tier.
**FRs covered:** FR5, FR6, FR7
**Ghi chú:** `ffprobe` ở API, khóa ffmpeg một tiến trình ở worker và hạn chuẩn bị 120 giây gồm cả thời gian chờ khóa (AR15). Cổng đồng thời RunningHub và job mồ côi đã làm ở Epic 2.

### Epic 6: Vận hành an toàn, tuân thủ và cổng mở bán

Admin được bảo vệ ngân sách GPU và có công cụ xử lý vi phạm; hệ thống sẵn sàng bật VietQR thương mại sau khi qua các bước kiểm thử bắt buộc.
**FRs covered:** FR16, FR18, FR21, FR22
**Ghi chú:** ngắt mạch, cảnh báo Discord, khóa tài khoản, gỡ file R2, `pg_dump` lên R2 và 5 bước kiểm thử trước khi mở bán (AR18, AR22, AR23, AR24). Cần Epic 1–3 (adapter Discord ở Story 3.4, dịch vụ `audit` ở Story 3.5); story cổng mở bán cần thêm Epic 4–5 vì benchmark chạy cả ba pipeline.

## Epic 1: Nền tảng, đăng nhập và credit dùng thử

Người dùng đăng nhập bằng Google, nhận 500 credit tặng có kiểm soát lạm dụng và thấy số dư cùng Tier của mình. Monorepo, hợp đồng chung và hai luồng BE/FE độc lập được dựng ở epic này.

**Thứ tự và hai luồng:** 1.1 rồi 1.2 làm tuần tự. Sau khi hai story đó merge: luồng BE làm 1.3 → 1.5 → 1.6 → 1.7 → 1.8; luồng FE làm 1.4 → 1.9 → 1.10 (chạy trên mock). Story 1.11 chỉ bắt đầu khi cả hai luồng xong.

**Lưu ý chung:** bảng được tạo ở đúng story cần đến nó. `ledger_entries.task_id` và `topup_id` chưa có khóa ngoại vì bảng `tasks` và `topups` chưa tồn tại; khóa ngoại được thêm ở epic tạo các bảng đó. `NotifierPort` được định nghĩa ở 1.7 với adapter ghi log; adapter Discord thêm ở Epic 3.

### Story 1.1: [SHARED] Dựng monorepo và khung CI

**Phủ:** AR1, AR2, AR25

As a nhà phát triển của cả hai luồng (BE và FE),
I want một monorepo có sẵn ba gói, cấu hình dùng chung và pipeline CI,
So that hai luồng rẽ nhánh làm độc lập mà không xung đột cấu hình.

**Acceptance Criteria:**

**Given** kho mã trống ở nhánh chính
**When** chạy lệnh cài đặt ở thư mục gốc
**Then** cài được toàn bộ workspace bằng một trình quản lý gói duy nhất với một lockfile (chọn một trình quản lý và ghi vào README)
**And** tồn tại `apps/web`, `apps/api`, `packages/contracts`, `deploy/`, và Node ≥ 22.22.3 được khai báo qua `engines` và `.nvmrc`.

**Given** monorepo vừa dựng
**When** chạy lint, typecheck và build ở thư mục gốc
**Then** cả ba gói chạy thành công với mã khung rỗng.

**Given** một pull request
**When** CI chạy
**Then** CI thực hiện lint, typecheck, build và test, và fail thì chặn merge.

**Given** quy ước tên nhánh `be/*`, `fe/*`, `contract/*`, `shared/*`
**When** một PR từ nhánh `fe/*` sửa file ngoài `apps/web` (trừ lockfile), hoặc nhánh `be/*` sửa file ngoài `apps/api` và `deploy/`
**Then** một check kiểm tra đường dẫn trong CI fail và nêu rõ file vi phạm
**And** chỉ nhánh `contract/*` và `shared/*` được sửa `packages/contracts`.

**Given** phiên bản đã ghim trong ARCHITECTURE-SPINE
**When** mở `package.json` của từng gói
**Then** các thư viện được cài ở story này khai báo đúng phiên bản đã ghim, thư viện khác thêm ở story cần dùng nó.

### Story 1.2: [CONTRACT] Hợp đồng chung cho đăng nhập và ví

**Phủ:** AR1, FR19

As a nhà phát triển của luồng BE và FE,
I want gói `packages/contracts` có kiểu, schema và dữ liệu mock cho đăng nhập và ví,
So that hai luồng thống nhất hình dạng API trước khi viết mã.

**Acceptance Criteria:**

**Given** `packages/contracts`
**When** build gói
**Then** gói xuất enum `ApiErrorCode` gồm `PAUSED`, `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `CONSENT_REQUIRED`, `VALIDATION_FAILED`, `RATE_LIMITED`
**And** xuất kiểu lỗi API `{ code, message, details? }`.

**Given** các endpoint của epic này
**When** đọc hợp đồng
**Then** hợp đồng định nghĩa `GET /auth/google` (nhận `tosVersion` và `deviceId`), `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me` (id, email, role, tier, balance, held, tosVersion), `GET /wallet/ledger` (phân trang, mới nhất trước), `GET /config/pricing` (bảng giá, Cap, Priority, các gói nạp)
**And** mỗi endpoint có schema request và response dùng chung cho FE và BE.

**Given** hằng số phiên bản cam kết ToS
**When** FE và BE cùng import
**Then** cả hai thấy cùng một giá trị `TOS_VERSION`.

**Given** schema của hợp đồng
**When** chạy test hợp đồng
**Then** dữ liệu mock của `/me`, `/wallet/ledger`, `/config/pricing` đều khớp schema
**And** thư viện schema do người triển khai chọn và ghi vào README `[ASSUMPTION: ARCHITECTURE-SPINE chưa ghim thư viện schema]`.

### Story 1.3: [BE] Khung api, worker, PostgreSQL và Redis

**Phủ:** AR2, AR3, AR5, AR19, AR25, NFR3

As a nhà phát triển luồng BE,
I want NestJS có hai entrypoint chạy cùng Prisma 7, Redis và Docker Compose bốn container,
So that các story BE sau có nền chạy được và kiểm thử trên PostgreSQL thật.

**Acceptance Criteria:**

**Given** `deploy/compose.yml`
**When** chạy `docker compose up`
**Then** đúng bốn dịch vụ khởi động: `nestjs-api`, `nestjs-worker`, `postgres-16` (`postgres:16-alpine`), `redis-7`
**And** Redis chạy với `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction`.

**Given** các container đã chạy
**When** gọi `GET /health`
**Then** nhận 200 kèm trạng thái kết nối PostgreSQL và Redis
**And** tiến trình `worker` chạy không mở cổng HTTP.

**Given** Prisma 7.10.1 với `@prisma/adapter-pg` 7.10.1, `prisma.config.ts` và generator `prisma-client`
**When** chạy migration trên CSDL trống
**Then** migration chạy thành công và có cơ chế thêm migration SQL thô.

**Given** CI có PostgreSQL thật
**When** chạy test hạ tầng về lỗi trùng khóa
**Then** sau khi một lỗi P2002 làm rollback một interactive transaction, kết nối từ pool vẫn chạy truy vấn đúng ở lần kế tiếp (dùng một bảng tạm riêng của test).

**Given** ioredis 5.11.1 và BullMQ 6.5.3
**When** chạy test BullMQ trên Redis thật
**Then** worker xử lý được một job mẫu với `maxRetriesPerRequest: null`.

**Given** cấu hình
**When** kiểm tra mã nguồn
**Then** mọi bí mật chỉ đọc từ biến môi trường, có `.env.example`, không có bí mật nào trong repo.

### Story 1.4: [FE] Khung Nuxt 4 mobile-first chạy trên mock

**Phủ:** AR4, NFR6

As a nhà phát triển luồng FE,
I want ứng dụng Nuxt 4 có layout mobile-first, routing, client API có kiểu và chế độ mock,
So that tôi dựng giao diện mà không cần chờ BE.

**Acceptance Criteria:**

**Given** Nuxt 4.6.3 trong `apps/web`
**When** xác nhận `nuxt.config.ts` và chạy lệnh build ở máy
**Then** preset Nitro là `cloudflare-pages` (hoặc `cloudflare_module`) và thư mục đầu ra đúng định dạng của Cloudflare
**And** kết quả kiểm tra được ghi vào README trước khi đẩy lên git.

**Given** viewport di động rộng 360 px và viewport máy tính `>= 1024 px`
**When** mở trang `/`, `/login`, `/history` (trang khung)
**Then** ở 360 px không có thanh cuộn ngang, điều hướng bằng Bottom Navigation Bar và dùng được bằng một tay
**And** ở `>= 1024 px` giao diện người dùng sử dụng **Top Header** (không dùng Sidebar trái), trang chủ hiển thị lưới Card tính năng có ảnh minh họa toàn màn hình và khi click vào card mở Dialog làm việc của chức năng đó (riêng `/admin` dùng Left Sidebar tối giản phong cách Vercel) theo mục `Responsive & Platform` của `EXPERIENCE.md`
**And** giao diện chỉ có tiếng Việt.

**Given** biến môi trường chế độ API `mock` hoặc `live`
**When** ở chế độ `mock`
**Then** client API có kiểu sinh từ `packages/contracts` trả dữ liệu mock cùng schema, không gọi mạng.

**Given** một phản hồi lỗi có `code` thuộc `ApiErrorCode`
**When** FE nhận lỗi
**Then** hiển thị thông báo tiếng Việt lấy từ một bảng ánh xạ duy nhất theo `code`
**And** `code` lạ hiển thị thông báo chung mà không vỡ giao diện.

**Given** giá và Cap theo Tier
**When** FE cần hiển thị
**Then** FE lấy từ `GET /config/pricing`, không hardcode.

**Given** hợp đồng UX tại `_bmad-output/planning-artifacts/ux-designs/ux-motion-ai-2026-11-01/DESIGN.md` và `EXPERIENCE.md`
**When** dựng khung giao diện và cấu hình Tailwind
**Then** bảng màu kế thừa đầy đủ Design Tokens Slate Cyber (nền `#0F172A`, thẻ `#1E293B`, viền `#334155`, primary `#8B5CF6`, accent `#06B6D4`)
**And** tích hợp `nuxt-icon` với iconset `lucide`, nghiêm cấm sử dụng icon ký tự UTF-8/emoji trong UI chrome
**And** mọi vùng chạm bấm đạt tối thiểu 48px cho thao tác ngón cái trên di động.

**Given** story này
**When** xem diff
**Then** không có file nào ngoài `apps/web` bị sửa (trừ lockfile).

### Story 1.5: [BE] Đăng nhập Google và phiên JWT

**Phủ:** AR16, FR19, NFR3

As a người dùng,
I want đăng nhập bằng Google,
So that tôi có tài khoản và phiên đăng nhập an toàn.

**Acceptance Criteria:**

**Given** một người dùng mới và `tosVersion` hợp lệ
**When** hoàn tất OAuth Google
**Then** tạo bản ghi `users` (khóa Google, email, role `user`, `tos_version`, `tos_accepted_at`)
**And** trả access JWT sống 15 phút và refresh token trong cookie `httpOnly`, `Secure`, `SameSite=Lax`
**And** refresh token chỉ lưu hash trong bảng `refresh_tokens`.

**Given** người dùng mới nhưng thiếu hoặc sai `tosVersion`
**When** hoàn tất OAuth
**Then** nhận lỗi `CONSENT_REQUIRED` và không tạo tài khoản.

**Given** một refresh token hợp lệ
**When** gọi `POST /auth/refresh`
**Then** nhận access JWT mới và refresh token mới, refresh token cũ bị thu hồi
**And** dùng lại refresh token đã thu hồi bị từ chối với 401.

**Given** người dùng đang đăng nhập
**When** gọi `POST /auth/logout`
**Then** refresh token hiện tại bị thu hồi.

**Given** email nằm trong `ADMIN_EMAILS`
**When** tài khoản được tạo
**Then** role là `admin`
**And** route dành cho admin trả 403 với người dùng role `user`.

**Given** `users.locked_at` khác rỗng
**When** gọi route ghi hoặc `POST /auth/refresh`
**Then** nhận 403 `ACCOUNT_LOCKED`.

**Given** yêu cầu từ miền khác miền FE
**When** gọi API
**Then** CORS chỉ cho phép miền FE.

**Given** story này
**When** xem migration
**Then** chỉ tạo bảng `users` (không có số dư) và `refresh_tokens`
**And** test chạy với Google được giả ở ranh giới HTTP.

### Story 1.6: [BE] Sổ cái credit bất biến

**Phủ:** FR9, FR10, AR5, AR6, AR7, NFR4

As a hệ thống,
I want một sổ cái credit chỉ ghi thêm với HOLD, CAPTURED, RELEASED,
So that mọi biến động credit đúng, truy vết được và không thể âm.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy trên PostgreSQL thật
**Then** có bảng `ledger_entries` (id, `user_id`, `type`, `amount` bigint, `task_id` và `topup_id` chưa có khóa ngoại, `pack` (null, chỉ có giá trị với bút toán `TOPUP`), `created_at`) và cột `users.balance`, `users.held`
**And** các chỉ mục duy nhất một phần và `CHECK (balance >= 0)`, `CHECK (held >= 0)` nằm trong migration SQL thô.

**Given** CI chạy test ràng buộc trên PostgreSQL thật
**When** thử ghi hai HOLD cho cùng một `task_id`, hoặc CAPTURED và RELEASED cùng một `task_id`
**Then** lần ghi thứ hai bị từ chối
**And** test fail nếu một ràng buộc không tồn tại.

**Given** `wallet.hold(tx, userId, taskId, amount)`
**When** gọi với số dư đủ
**Then** `balance` giảm `amount`, `held` tăng `amount`, ghi một HOLD mang dấu âm
**And** hàm từ chối chạy khi không nhận `tx`.

**Given** `wallet.capture(tx, taskId)` và `wallet.release(tx, taskId)`
**When** gọi với một Task đã có HOLD
**Then** số tiền được đọc từ dòng HOLD, không nhận từ nơi gọi
**And** CAPTURED giảm `held` mà không đổi `balance`, RELEASED trả đúng số HOLD về `balance`.

**Given** `wallet.grant(tx, userId, amount)` và `wallet.topup(tx, userId, topupId, amount, pack)` với `pack` thuộc `starter`, `pro`, `creator`
**When** gọi với `tx` hợp lệ
**Then** ghi một bút toán dương (`GRANT` hoặc `TOPUP`) và tăng `balance` đúng `amount`, bút toán `TOPUP` lưu thêm `pack`
**And** cả hai hàm từ chối chạy khi không nhận `tx`; các nơi gọi sau này (tặng credit khi đăng ký, duyệt nạp tiền) phải dùng đúng chữ ký này.

**Given** số dư nhỏ hơn số cần HOLD
**When** gọi `wallet.hold`
**Then** trả `INSUFFICIENT_CREDIT` và không ghi gì.

**Given** hai lệnh HOLD đồng thời của cùng một user mà tổng vượt số dư
**When** chạy song song
**Then** đúng một lệnh thành công và số dư không bao giờ âm
**And** mỗi transaction khóa đúng một dòng user bằng `SELECT … FOR UPDATE`.

**Given** một vi phạm unique (P2002) trong luồng ví
**When** xảy ra
**Then** toàn bộ transaction bị rollback và trả lỗi, không chạy truy vấn tiếp trong transaction đã lỗi.

**Given** mọi user
**When** truy vấn kiểm tra
**Then** `balance` bằng `SUM(amount)` và `held` bằng tổng HOLD chưa có CAPTURED hoặc RELEASED.

### Story 1.7: [BE] Tier, API ví và đối soát sổ cái

**Phủ:** FR11, AR6, AR14

As a người dùng,
I want hệ thống tự xác định Tier theo credit tôi sở hữu và cho tôi xem số dư cùng lịch sử,
So that tôi biết mình ở hạng nào và credit đi đâu.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** bảng `users` có thêm cột `tier_pack` (null khi tài khoản đang ở hạng FREE)
**And** `wallet` là module duy nhất ghi cột này, cập nhật trong cùng transaction với bút toán `TOPUP`: nếu trước đó tài khoản đang FREE thì `tier_pack` bằng gói vừa nạp, nếu không thì bằng gói cao hơn giữa gói hiện có và gói vừa nạp.

**Given** bảng giá, Cap và Priority cấu hình phía server (FREE 5s/10, Starter 10s/3, Pro 15s/2, Creator 20s/1)
**When** gọi `GET /config/pricing`
**Then** trả đúng cấu hình đó, cùng nguồn với logic tính Tier.

**Given** `wallet` có hàm tính Tier thuần
**When** có bút toán `GRANT`, `TOPUP`, `ADJUST` hoặc `CAPTURED`
**Then** Tier được tính lại trong cùng transaction
**And** `HOLD` và `RELEASED` không kích hoạt tính lại.

**Given** tổng credit sở hữu (`balance + held`) dưới 100
**When** tính Tier
**Then** Tier là FREE và lịch sử gói bị xóa
**And** lần `TOPUP` sau tính độc lập theo gói vừa nạp.

**Given** tài khoản Creator còn 40 credit tổng sở hữu rồi nạp gói Starter
**When** tính lại Tier
**Then** Tier là Starter (Priority 3, Cap 10 giây).

**Given** tài khoản Pro còn 5.000 credit nạp thêm gói Starter
**When** tính lại Tier
**Then** Tier vẫn là Pro.

**Given** `wallet.hold` thành công
**When** trả kết quả
**Then** kèm Tier Snapshot (Tier, Priority, Cap) đọc trong cùng transaction
**And** một HOLD không làm giảm Tier của chính Task đó.

**Given** người dùng đã đăng nhập
**When** gọi `GET /me` và `GET /wallet/ledger`
**Then** `/me` trả tier, balance, held; `/wallet/ledger` chỉ trả bút toán của chính người đó, mới nhất trước, có phân trang.

**Given** `NotifierPort` và job đối soát hằng ngày bằng `@nestjs/schedule`
**When** job phát hiện user có `balance` hoặc `held` lệch với sổ cái
**Then** ghi log mức lỗi và gọi `NotifierPort` bằng adapter ghi log (adapter Discord thêm ở Epic 3).

### Story 1.8: [BE] Tặng 500 credit và chống lạm dụng

**Phủ:** FR12, FR19, AR16, NFR3

As a người dùng mới,
I want nhận 500 credit dùng thử khi đăng ký,
So that tôi thử sản phẩm trước khi nạp tiền, trong khi hệ thống chặn việc lạm dụng.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** có bảng `signup_grants` (`user_id` khóa chính, `fingerprint_hash` duy nhất khi `granted > 0`, `ip_hash`, `granted` bigint, `created_at`)
**And** `created_at` có chỉ mục theo `ip_hash` để đếm tài khoản nhận bonus theo IP trong 24 giờ.

**Given** một thiết bị chưa từng nhận credit và IP có dưới 3 tài khoản nhận bonus trong 24 giờ
**When** đăng ký bằng Google thành công
**Then** tài khoản nhận 500 credit bằng một bút toán `GRANT`
**And** việc tạo user, ghi `signup_grants` và `wallet.grant` nằm trong cùng một transaction do `auth` mở.

**Given** một thiết bị đã nhận credit
**When** đăng ký tài khoản mới với cùng `deviceId`
**Then** tài khoản vẫn được tạo nhưng số dư là 0 và không có bút toán `GRANT`.

**Given** đã có 3 tài khoản nhận bonus từ cùng một IP trong 24 giờ
**When** tài khoản thứ 4 đăng ký
**Then** tài khoản được tạo với số dư 0 và `signup_grants` ghi `granted = 0`.

**Given** 5 lượt đăng ký đồng thời từ cùng một IP
**When** chạy song song
**Then** đúng 3 tài khoản nhận 500 credit (khóa `pg_advisory_xact_lock` theo hash IP)
**And** không có đua dẫn tới nhận bonus quá 3 lần.

**Given** yêu cầu có header `CF-Connecting-IP`
**When** kết nối đến từ dải IP Cloudflare
**Then** dùng giá trị header làm IP khách
**And** khi kết nối không đến từ dải IP đó thì bỏ qua header và dùng IP của kết nối.

**Given** IP và `deviceId`
**When** lưu `signup_grants`
**Then** chỉ lưu giá trị băm một chiều có khóa bí mật phía server, không lưu giá trị gốc.

**Given** 1.000 tài khoản với thiết bị và IP đều khác nhau
**When** đăng ký
**Then** cả 1.000 đều nhận 500 credit, không có trần theo ngày hay trần tổng.

**Given** các route đăng nhập
**When** một IP gửi quá giới hạn
**Then** `@nestjs/throttler` trả `RATE_LIMITED`.

### Story 1.9: [FE] Đăng nhập, cam kết ToS và số dư

**Phủ:** FR19, FR11

As a người dùng mới,
I want đăng nhập bằng Google sau khi tích cam kết ToS và thấy số dư cùng Tier,
So that tôi biết mình có 500 credit để dùng thử.

**Acceptance Criteria:**

**Given** người dùng chưa đăng nhập ở `/login`
**When** chưa tích ô cam kết ToS
**Then** nút "Đăng nhập bằng Google" bị vô hiệu
**And** văn bản cam kết lấy nội dung từ FR19 trong PRD (cấm nội dung khiêu dâm, bôi nhọ, miễn trừ trách nhiệm); văn bản cuối cùng do PM cung cấp `[ASSUMPTION: phần bổ sung về độ tuổi 18 và quyền sử dụng hình ảnh chưa nhận được, dùng văn bản tạm]`.

**Given** đã tích ô cam kết
**When** bấm đăng nhập
**Then** FE chuyển tới `GET /auth/google` kèm `tosVersion` và `deviceId`
**And** `deviceId` tạo bằng một thư viện nhẹ do người triển khai chọn và ghi vào Stack `[ASSUMPTION: cách tạo Device Fingerprint ở FE chưa chốt]`.

**Given** người dùng đã đăng nhập
**When** vào bất kỳ trang nào
**Then** tiêu đề hiển thị số dư và huy hiệu Tier lấy từ `GET /me`
**And** tài khoản mới hiển thị 500 credit.

**Given** tài khoản có 0 credit
**When** vào trang chính
**Then** hiển thị thông báo cần nạp credit để sử dụng.

**Given** access JWT hết hạn
**When** gọi API nhận 401
**Then** FE tự gọi `POST /auth/refresh` đúng một lần rồi thử lại
**And** nếu refresh thất bại thì chuyển về `/login`.

**Given** các lỗi `CONSENT_REQUIRED`, `ACCOUNT_LOCKED`, `RATE_LIMITED`
**When** FE nhận
**Then** hiển thị thông báo tiếng Việt tương ứng.

**Given** nút "Đăng xuất"
**When** bấm
**Then** gọi `POST /auth/logout` và về `/login`
**And** story chạy đầy đủ ở chế độ mock và ở viewport 360 px.

### Story 1.10: [FE] Lịch sử credit

**Phủ:** FR9

As a người dùng,
I want xem lịch sử các biến động credit của mình,
So that tôi hiểu vì sao số dư thay đổi.

**Acceptance Criteria:**

**Given** người dùng đã đăng nhập
**When** mở `/history`
**Then** thấy danh sách bút toán mới nhất trước, mỗi dòng có loại bằng tiếng Việt (Tặng, Nạp, Giữ, Hoàn, Chốt, Điều chỉnh), số credit có dấu và thời gian theo giờ Việt Nam.

**Given** danh sách dài hơn một trang
**When** cuộn đến cuối
**Then** tải thêm trang tiếp theo từ `GET /wallet/ledger`.

**Given** người dùng chưa có bút toán nào
**When** mở `/history`
**Then** hiển thị trạng thái rỗng có giải thích.

**Given** đang tải hoặc API lỗi
**When** mở `/history`
**Then** hiển thị trạng thái đang tải hoặc thông báo lỗi tiếng Việt kèm nút thử lại
**And** trang chạy đầy đủ ở chế độ mock và ở viewport 360 px.

### Story 1.11: [INTEGRATION] Nối FE với BE và smoke test đăng nhập

**Phủ:** FR9, FR11, FR12

As a nhà phát triển,
I want tắt mock và chạy FE với BE thật,
So that xác nhận Epic 1 chạy trọn vẹn từ đăng nhập đến số dư.

**Acceptance Criteria:**

**Given** stack Docker Compose bốn container và FE ở chế độ `live`
**When** chạy smoke test với nhà cung cấp Google được giả trong CI
**Then** người dùng mới đăng nhập, thấy 500 credit và một dòng "Tặng" trong lịch sử.

**Given** tài khoản thứ hai dùng cùng `deviceId`
**When** đăng nhập
**Then** thấy số dư 0 và không có dòng "Tặng".

**Given** test hợp đồng ở CI
**When** chạy
**Then** phản hồi của mock và của BE thật đều khớp schema trong `packages/contracts`.

**Given** job đối soát sổ cái
**When** chạy sau smoke test
**Then** không báo lệch.

**Given** README
**When** người mới đọc
**Then** làm theo được các bước chạy stack, chạy FE ở hai chế độ và chạy test; việc đăng nhập Google thật chạy thủ công một lần khi có thông tin OAuth.

## Epic 2: Face Swap một lần bấm, hoàn credit khi lỗi

Người dùng ghép mặt bằng một lần bấm, nhận ảnh kết quả lưu trên R2, tải về hoặc chia sẻ, và được hoàn credit tự động khi hệ thống lỗi. Epic này dựng động cơ xử lý Task dùng chung cho cả Body Retouch (Epic 4) và Motion Control (Epic 5).

**Thứ tự và hai luồng:** 2.1 làm trước, rồi hai luồng rẽ nhánh. BE: 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 → 2.9. FE (chạy trên mock): 2.10 → 2.11 → 2.12 → 2.13. Story 2.14 chỉ bắt đầu khi cả hai luồng xong.

**Lưu ý chung:** RunningHub được giả ở ranh giới `RunningHubPort` trong mọi test; kiểm tra với RunningHub thật nằm ở benchmark Epic 6. Lỗi mà workflow trả về được ánh xạ sang `reasonCode` bằng một danh sách cấu hình (Story 2.5). `CONTENT_BLOCKED` chưa biết chuỗi lỗi thật và được điền ở Epic 6. Sau bước dựng bảng `tasks` ở 2.3, các story sau thêm cột đúng lúc cần dùng.

### Story 2.1: [CONTRACT] Hợp đồng cho tải lên, Task và kết quả

**Phủ:** FR1, FR2, FR15, AR9

As a nhà phát triển của luồng BE và FE,
I want `packages/contracts` có endpoint, schema, mã lý do và dữ liệu mock cho tải lên, Task và kết quả,
So that hai luồng thống nhất hình dạng API trước khi viết mã Epic 2.

**Acceptance Criteria:**

**Given** `packages/contracts`
**When** build gói
**Then** gói xuất enum `reasonCode` gồm `RH_ERROR`, `RH_TIMEOUT`, `RH_SUBMIT_UNKNOWN`, `RH_BUDGET`, `PREP_TIMEOUT`, `RH_GATE_TIMEOUT`, `FFMPEG_ERROR`, `INPUT_FETCH_ERROR`, `OUTPUT_UPLOAD_ERROR`, `OUTPUT_INVALID`, `INTERNAL_ERROR`, `NO_POSE`, `NO_FACE`, `CONTENT_BLOCKED`, `FREE_WAIT_EXPIRED`, `USER_CANCEL`
**And** xuất enum trạng thái Task `queued`, `running`, `succeeded`, `failed`, `timed_out`, `cancelled`.

**Given** các endpoint của epic
**When** đọc hợp đồng
**Then** định nghĩa `POST /uploads` (loại, kích thước khai báo → khóa và URL tải lên), `POST /uploads/{key}/confirm`, `POST /tasks/face-swap` (khóa ảnh nguồn, khóa ảnh đích, `consent`), `GET /tasks` (phân trang), `GET /tasks/{id}` (trạng thái, vị trí hàng đợi, `reasonCode`, khóa kết quả), `POST /tasks/{id}/cancel`, `GET /tasks/{id}/result` (trả `resultUrl` là URL ký, và `sourceUrl` là URL ký của ảnh gốc, có thể rỗng khi ảnh gốc đã quá thời hạn lưu 7 ngày), `POST /tasks/{id}/share`, `DELETE /tasks/{id}/share`, `GET /s/{token}`
**And** mỗi endpoint có schema request và response dùng chung FE và BE.

**Given** quy tắc validate ảnh (JPG/PNG/WebP, ≤ 10 MB, cạnh ngắn ≥ 512 px, tỷ lệ 1:2 đến 2:1)
**When** FE và BE cùng import
**Then** cả hai dùng một schema duy nhất, không viết hai bản.

**Given** bảng ánh xạ `reasonCode` sang thông báo tiếng Việt, có thể ghi đè theo `pipeline` (ví dụ `NO_POSE` hiển thị khác nhau cho Body Retouch và Motion Control)
**When** FE cần hiển thị
**Then** thông báo lấy từ bảng này, gồm "Không nhận diện được khuôn mặt trong ảnh" cho `NO_FACE` và "Ảnh/video vi phạm tiêu chuẩn cộng đồng, vui lòng chọn file khác." cho `CONTENT_BLOCKED`.

**Given** dữ liệu mock
**When** chạy test hợp đồng
**Then** mock của Task ở mọi trạng thái, của hàng đợi, của kết quả đều khớp schema.

### Story 2.2: [BE] Tải ảnh lên R2 an toàn

**Phủ:** FR19, AR12, NFR2, NFR3

As a người dùng,
I want tải ảnh lên trực tiếp lên kho lưu trữ và được kiểm tra,
So that ảnh của tôi sẵn sàng để xử lý mà máy chủ không phải gánh luồng file.

**Acceptance Criteria:**

**Given** người dùng đã đăng nhập
**When** gọi `POST /uploads` với loại và kích thước khai báo hợp lệ
**Then** nhận khóa do server sinh dạng `in-raw/<userId>/<uuid>` và presigned URL PUT ký kèm `Content-Length` đúng kích thước khai báo.

**Given** kích thước khai báo vượt 10 MB, loại không phải JPG/PNG/WebP
**When** gọi `POST /uploads`
**Then** nhận `VALIDATION_FAILED` và không cấp URL.

**Given** người dùng đã có 10 đối tượng `in-raw/` chưa xác nhận
**When** gọi `POST /uploads` lần thứ 11
**Then** nhận `VALIDATION_FAILED` kèm thông báo về giới hạn file tạm
**And** bộ đếm chạy bằng bảng `uploads` trong CSDL, không dùng `ListObjects` trên R2.

**Given** migration của story này
**When** chạy
**Then** có bảng `uploads` (id, `user_id`, `key`, `kind` thuộc `image` hoặc `video`, `status` thuộc `pending`, `confirmed`, `expired`, `size_bytes`, `etag`, `width`, `height`, `duration_seconds` cho phép null, `created_at`, `confirmed_at`)
**And** `confirm` thành công ghi các giá trị đo được vào bản ghi này; `width`, `height` đo bằng sharp cho ảnh; `duration_seconds` để trống ở story này và do luồng xác nhận video của Epic 5 điền
**And** bản ghi `pending` quá 24 giờ chuyển `expired` cùng chu kỳ lifecycle xóa `in-raw/`, và không còn bị tính vào giới hạn 10 file.

**Given** file đã tải lên
**When** gọi `POST /uploads/{key}/confirm`
**Then** server kiểm khóa thuộc đúng người dùng, `HEAD` lấy kích thước thật và ETag, kiểm tra định dạng, cạnh ngắn ≥ 512 px và tỷ lệ 1:2 đến 2:1
**And** nếu cạnh dài trên 2048 px thì resize về 2048 px bằng sharp giữ nguyên tỷ lệ
**And** `CopyObject` sang `in/<userId>/<uuid>` với `CopySourceIfMatch` bằng ETag.

**Given** ETag của đối tượng đã đổi giữa `HEAD` và `CopyObject`
**When** xác nhận
**Then** việc sao chép bị từ chối và không có khóa `in/` nào được tạo.

**Given** người dùng B dùng khóa của người dùng A
**When** gọi `confirm`
**Then** bị từ chối.

**Given** kích thước thật khác kích thước khai báo, hoặc nội dung không phải ảnh hợp lệ
**When** xác nhận
**Then** bị từ chối và đối tượng `in-raw/` bị xóa.

**Given** cấu hình bucket
**When** kiểm tra
**Then** bucket riêng tư, CORS chỉ cho phép miền FE, lifecycle `in-raw/` xóa sau 1 ngày và `in/` sau 7 ngày
**And** R2 được giả ở `StoragePort` trong test.

### Story 2.3: [BE] Tạo Task Face Swap và xếp vào hàng đợi

**Phủ:** FR1, FR10, FR19, AR7, AR8, AR20, NFR4

As a người dùng,
I want bấm một lần để tạo Task Face Swap,
So that tôi bị giữ đúng 100 credit và Task vào hàng đợi.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** có bảng `tasks` (id, `user_id`, `pipeline`, `status`, `reason_code`, `tier_snapshot`, `consent`, `tos_version`, `input_keys`, `params`, `hold_amount`, `queued_at`, `enqueue_attempts`) và cột `task_id` của `ledger_entries` có khóa ngoại tới `tasks`.

**Given** người dùng có số dư ≥ 100, không bị khóa, hai khóa ảnh `in/` hợp lệ, `consent` đúng
**When** gọi `POST /tasks/face-swap`
**Then** trong một transaction do `tasks.create` mở: gọi `wallet.hold(tx, …, 100)` rồi INSERT Task `queued` kèm Tier Snapshot
**And** sau commit mới enqueue BullMQ với `jobId = taskId`, `removeOnComplete: true`, `removeOnFail: true`
**And** phản hồi trong 2 giây.

**Given** `consent` sai hoặc thiếu
**When** gọi
**Then** nhận `CONSENT_REQUIRED`, không HOLD, không tạo Task
**And** `consent` và `tos_version` được lưu trên Task khi thành công.

**Given** tài khoản có `locked_at`
**When** gọi
**Then** nhận `ACCOUNT_LOCKED` và không tạo Task.

**Given** số dư dưới 100
**When** gọi
**Then** nhận `INSUFFICIENT_CREDIT`, không tạo Task.

**Given** người dùng đã có 3 Task `queued` hoặc `running`
**When** gọi
**Then** nhận `TASK_LIMIT`, kiểm tra nằm trong cùng transaction.

**Given** giá Face Swap
**When** tạo Task
**Then** số credit HOLD lấy từ cấu hình giá phía server (100), không nhận từ client.

**Given** crash giữa commit và enqueue
**When** xảy ra
**Then** Task `queued` vẫn tồn tại trong CSDL và không mất tiền; việc enqueue lại Task thiếu job do bộ quét của epic này đảm nhiệm khi bộ quét ra đời

**Given** ba request cùng lúc làm tổng HOLD vượt số dư
**When** chạy song song
**Then** số dư không âm và các request vượt bị `INSUFFICIENT_CREDIT`.

### Story 2.4: [BE] Máy trạng thái Task bằng compare-and-set

**Phủ:** FR10, FR15, AR9, AR7

As a hệ thống,
I want mọi chuyển trạng thái Task đi qua một hàm compare-and-set duy nhất kèm bút toán ví,
So that tiền và trạng thái luôn khớp, không hoàn tiền hai lần và kết quả đến muộn bị bỏ qua.

**Acceptance Criteria:**

**Given** `tasks.transition(taskId, from, to, reasonCode)`
**When** gọi với chuyển hợp lệ
**Then** thực hiện `UPDATE … WHERE id=? AND status=<from>` trong một transaction mở bởi `tasks`
**And** chuyển hợp lệ gồm `queued→running|cancelled|timed_out|failed` và `running→succeeded|failed|timed_out`
**And** chuyển ngoài bảng này bị từ chối.

**Given** chuyển sang `succeeded`
**When** CAS thành công
**Then** gọi `wallet.capture(tx, taskId)` trong cùng transaction.

**Given** chuyển sang `failed`, `timed_out` hoặc `cancelled`
**When** CAS thành công
**Then** gọi `wallet.release(tx, taskId)` trong cùng transaction
**And** thông báo cho người dùng sinh từ `reasonCode`.

**Given** UPDATE ảnh hưởng 0 dòng
**When** một bên đến muộn (ví dụ kết quả đến sau `timed_out`)
**Then** bên đó bỏ qua im lặng và sổ cái không đổi.

**Given** hai chuyển trạng thái kết thúc đồng thời cho cùng một Task
**When** chạy song song trên PostgreSQL thật
**Then** đúng một bên thắng và đúng một bút toán CAPTURED hoặc RELEASED được ghi.

**Given** khóa Redis `task:terminal:<taskId>` bị mồ côi hoặc Redis tắt
**When** chuyển trạng thái
**Then** chuyển trạng thái vẫn chạy bình thường, Redis chỉ là bộ lọc nhanh.

**Given** `tasks.cancel` cho Task `queued`
**When** người dùng gọi `POST /tasks/{id}/cancel`
**Then** CAS `queued→cancelled` với `USER_CANCEL`, RELEASED, rồi xóa job BullMQ
**And** hủy Task đã `running` bị từ chối.

**Given** `GET /tasks/{id}` cho Task `queued`
**When** gọi
**Then** vị trí hàng đợi tính từ CSDL theo số Task `queued` đứng trước theo `(priority, queued_at)`
**And** người dùng chỉ xem được Task của chính mình.

### Story 2.5: [BE] Worker xử lý Task qua RunningHub

**Phủ:** FR1, FR8, FR17, AR10, AR13, NFR1

As a hệ thống,
I want worker lấy Task, gửi lên RunningHub và theo dõi đến khi xong,
So that ảnh được xử lý mà không submit trùng và không bỏ rơi Task khi restart.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** bảng `tasks` có thêm `running_at`, `prep_deadline_at`, `deadline_at`, `submit_started_at`, `finished_at`, `runninghub_task_id`, `rh_orphan_until`, `gate_deadline`, `gpu_coins`
**And** `tasks.transition` đặt `finished_at` trong cùng câu UPDATE ở mọi chuyển sang trạng thái kết thúc

**Given** `RunningHubPort` với adapter giả trong test
**When** worker nhận một job của Task `queued`
**Then** CAS `queued→running` đặt `running_at`, `prep_deadline_at` = `running_at` + 120 giây
**And** nếu CAS ảnh hưởng 0 dòng thì đọc lại Task và xử lý theo nhánh khôi phục, không bỏ job.

**Given** cổng đồng thời với `RH_MAX_CONCURRENT` (mặc định 2) và mutex trong tiến trình
**When** số Task đã qua cổng chưa kết thúc cộng số job mồ côi còn trong `rh_orphan_until` đã bằng mức tối đa
**Then** nhả mutex và hoãn job 5 giây
**And** chờ quá `gate_deadline` (15 phút từ `running_at`) thì `timed_out` với `RH_GATE_TIMEOUT`.

**Given** Task qua được cổng
**When** tải input lên RunningHub
**Then** `deadline_at` được ghi một lần (không bao giờ đặt lại) bằng lúc đó + 180 giây cho ảnh
**And** tiếp theo ghi `submit_started_at`, submit, ghi `runninghub_task_id` ngay.

**Given** job được giao lại sau khi worker khởi động lại
**When** Task đã `running` và có `runninghub_task_id`
**Then** worker tiếp tục poll, không submit lại
**And** Task có `submit_started_at` mà chưa có id thì `failed` với `RH_SUBMIT_UNKNOWN`, RELEASED và đặt `rh_orphan_until` = bây giờ + 10 phút
**And** Task `running` chưa có `submit_started_at` thì chạy lại từ bước phù hợp theo `deadline_at` hoặc `prep_deadline_at`; quá `prep_deadline_at` thì `timed_out` với `PREP_TIMEOUT`
**And** Task đã kết thúc thì bỏ job.

**Given** cấu hình pipeline (workflow ID, giá, ảnh tham chiếu, ánh xạ tham số sang node của workflow)
**When** worker gửi Task lên RunningHub
**Then** worker lấy workflow ID và danh sách node cần điền từ cấu hình pipeline của Task, không viết mã riêng cho từng pipeline
**And** pipeline mới (Body Retouch ở Epic 4, Motion Control ở Epic 5) chỉ cần thêm một mục cấu hình
**And** cấu hình pipeline cho phép khai báo một bước `prepare` tùy chọn chạy trong giai đoạn chuẩn bị, trước cổng đồng thời, với hạn `prep_deadline_at`; pipeline không khai báo (Face Swap, Body Retouch) bỏ qua bước này và hành vi không đổi.

**Given** Task đã submit
**When** poll
**Then** gọi `POST /task/openapi/outputs` mỗi 3 giây, mọi HTTP có timeout ≤ 10 giây
**And** kiểm tra Task còn `running` trước mỗi lần poll, và thao tác dài nhận `AbortSignal` khi Task bị hủy hoặc quá hạn.

**Given** lỗi mạng khi request chưa gửi đi
**When** submit
**Then** thử lại đúng một lần; lỗi khác thì không thử lại.

**Given** RunningHub trả lỗi workflow
**When** worker nhận
**Then** lỗi được ánh xạ sang `reasonCode` bằng danh sách cấu hình: tiền tố `NO_FACE` → `NO_FACE`, `NO_POSE` → `NO_POSE`, lỗi hết tiền → `RH_BUDGET`, còn lại → `RH_ERROR`
**And** Task chuyển `failed` với RELEASED qua `tasks.transition`
**And** danh sách ánh xạ `CONTENT_BLOCKED` để trống trong cấu hình, được điền sau benchmark ở Epic 6.

**Given** worker chạy với `concurrency = 2`
**When** có 5 Task
**Then** không quá 2 Task được xử lý đồng thời.

### Story 2.6: [BE] Nhập kết quả về R2 và chốt tiền

**Phủ:** FR2, FR15, AR11, NFR2, NFR7

As a người dùng,
I want ảnh kết quả được lưu về kho của hệ thống và credit chỉ bị chốt khi ảnh đạt,
So that tôi nhận file dùng được và không mất tiền cho file hỏng.

**Acceptance Criteria:**

**Given** RunningHub báo `SUCCESS` kèm `fileUrl`
**When** worker nhập kết quả
**Then** tải file về R2 dưới khóa `out/<userId>/<uuid>`, thử lại tối đa 3 lần trong `deadline_at`
**And** hết 3 lần thì Task `failed` với `OUTPUT_UPLOAD_ERROR` và RELEASED.

**Given** file đã tải về
**When** kiểm tra
**Then** file không rỗng, không toàn đen và giải mã được như ảnh, kích thước bằng ảnh tham chiếu của pipeline (Face Swap: ảnh đích; các pipeline ảnh khác khai báo ảnh tham chiếu của riêng nó trong cấu hình pipeline)
**And** kiểm tra thất bại thì `failed` với `OUTPUT_INVALID` và RELEASED.

**Given** file đạt kiểm tra
**When** chốt
**Then** ghi EXIF `Software: AI Generator` và `Comment: AI-Generated Content`
**And** lưu `consumeMoney` vào `gpu_coins` và `finished_at`
**And** chuyển `running→succeeded` kèm CAPTURED qua `tasks.transition`.

**Given** RunningHub báo `FAILED` có trả `consumeMoney`
**When** worker xử lý
**Then** vẫn lưu `consumeMoney` vào `gpu_coins`.

**Given** `GET /tasks/{id}/result`
**When** Task `succeeded` và người gọi là chủ Task
**Then** trả `resultUrl` là URL ký ngắn hạn tới file `out/`
**And** trả `sourceUrl` là URL ký ngắn hạn tới ảnh gốc `in/` nếu ảnh còn trong thời hạn lưu 7 ngày, ngược lại `sourceUrl` rỗng
**And** người khác nhận lỗi không có quyền.

**Given** Task chưa `succeeded`
**When** gọi `GET /tasks/{id}/result`
**Then** trả lỗi tương ứng, không trả URL.

**Given** link CDN của RunningHub
**When** API trả kết quả
**Then** không bao giờ lộ link đó cho người dùng
**And** lifecycle `out/` xóa sau 30 ngày.

### Story 2.7: [BE] Bộ quét Task treo và hạn chót

**Phủ:** FR15, FR17, AR10

As a hệ thống,
I want một bộ quét định kỳ xử lý Task kẹt và quá hạn,
So that không có Task nào giữ credit hoặc giữ Lane vô thời hạn.

**Acceptance Criteria:**

**Given** bộ quét `@nestjs/schedule` trong tiến trình worker, chạy mỗi 30 giây
**When** một Task `running` quá `deadline_at`
**Then** CAS sang `timed_out` với `RH_TIMEOUT` và RELEASED trong chu kỳ kế tiếp, bất kể job còn sống hay không
**And** Task chưa có `deadline_at` mà quá `prep_deadline_at` thì `timed_out` với `PREP_TIMEOUT`.

**Given** một Task `running` quá hạn mà RunningHub có thể vẫn đang chạy
**When** chuyển sang `timed_out` hoặc `RH_SUBMIT_UNKNOWN`
**Then** đặt `rh_orphan_until` = bây giờ + 10 phút để cổng đồng thời tính job mồ côi.

**Given** Task `running` không còn job sống và chưa quá hạn
**When** quét
**Then** enqueue job khôi phục (xử lý theo nhánh ở Story 2.5).

**Given** Task `queued` thiếu job trong hàng đợi
**When** quét
**Then** enqueue lại với `tier_snapshot` và `queued_at` gốc và tăng `enqueue_attempts`
**And** quá 5 lần thì `failed` với `INTERNAL_ERROR` và RELEASED.

**Given** sau mỗi lần CAS sang trạng thái kết thúc
**When** hoàn tất
**Then** xóa job BullMQ cùng `taskId` nếu còn, và job dư vô hại nhờ CAS.

**Given** thao tác dài đang chạy cho một Task đã bị bộ quét kết thúc
**When** `AbortSignal` kích hoạt
**Then** thao tác dừng và giải phóng Lane.

**Given** Task đã `timed_out`
**When** kết quả RunningHub đến muộn
**Then** bị bỏ qua và sổ cái không đổi.

### Story 2.8: [BE] Ưu tiên theo Tier và hết hạn hàng đợi FREE

**Phủ:** FR8

As a người dùng trả phí,
I want Task của tôi chạy trước Task dùng thử,
So that tôi được phục vụ theo hạng đã mua.

**Acceptance Criteria:**

**Given** hai Lane bận và Task Priority 1 vào sau Task Priority 3
**When** một Lane rảnh
**Then** Task Priority 1 chạy trước
**And** cùng Priority thì Task vào trước chạy trước (FIFO), và không dùng priority 0.

**Given** còn Task trả phí đang chờ
**When** một Lane rảnh
**Then** Task FREE (Priority 10) không được lấy.

**Given** một Task FREE `queued` quá 15 phút
**When** bộ quét chạy
**Then** CAS `queued→timed_out` với `FREE_WAIT_EXPIRED` và RELEASED, xử lý theo lô có LIMIT
**And** người dùng nhận thông báo thử lại hoặc nạp credit.

**Given** Priority lấy từ Tier Snapshot
**When** Tier của người dùng đổi sau khi tạo Task
**Then** Task đang chờ giữ Priority cũ.

**Given** Priority không ngắt job đang chạy
**When** có Task ưu tiên cao đến
**Then** job đang chạy vẫn hoàn tất.

**Given** test trên Redis thật
**When** chạy kịch bản trên
**Then** thứ tự thực tế đúng như mô tả.

### Story 2.9: [BE] Chia sẻ kết quả bằng token

**Phủ:** FR2, AR12, NFR6

As a người dùng,
I want chia sẻ ảnh kết quả bằng một đường dẫn do tôi tự tạo,
So that tôi đăng lên mạng xã hội mà không công khai file riêng tư.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** có bảng `share_tokens` (id, `task_id`, `user_id`, `token_hash`, `created_at`, `revoked_at`).

**Given** chủ của Task `succeeded`
**When** gọi `POST /tasks/{id}/share`
**Then** nhận một token ngẫu nhiên và đường dẫn chia sẻ; chỉ lưu hash của token
**And** mặc định kết quả không công khai trước khi gọi.

**Given** một token hợp lệ
**When** gọi `GET /s/<token>` không cần đăng nhập
**Then** chuyển hướng tới URL ký ngắn hạn của file `out/`
**And** bucket vẫn riêng tư.

**Given** chủ Task gọi `DELETE /tasks/{id}/share`
**When** thu hồi
**Then** token bị đánh dấu `revoked_at` và `GET /s/<token>` trả lỗi không tồn tại.

**Given** token không tồn tại, đã thu hồi hoặc file đã bị xóa
**When** gọi `GET /s/<token>`
**Then** trả 404, không tiết lộ thông tin nào về Task.

**Given** người khác không phải chủ Task
**When** gọi tạo hoặc thu hồi token
**Then** bị từ chối.

**Given** `GET /s/<token>` bị gọi quá nhiều
**When** vượt giới hạn
**Then** `@nestjs/throttler` trả `RATE_LIMITED`.

### Story 2.10: [FE] Thành phần tải ảnh có cam kết ToS

**Phủ:** FR1, FR19, NFR6

As a người dùng,
I want chọn ảnh từ camera hoặc thư viện, thấy tiến trình tải và tích cam kết trước khi gửi,
So that ảnh của tôi được tải lên hợp lệ.

**Acceptance Criteria:**

**Given** thành phần tải ảnh dùng lại được cho Face Swap, Body Retouch và Motion Control
**When** người dùng chọn file
**Then** có thể chọn từ camera hoặc thư viện trên mobile web
**And** thành phần kiểm tra phía client bằng schema trong `packages/contracts` (định dạng, ≤ 10 MB, cạnh ngắn ≥ 512 px, tỷ lệ 1:2 đến 2:1) và hiển thị lỗi tiếng Việt.

**Given** file hợp lệ
**When** tải lên
**Then** thanh tiến trình hiển thị; có nút hủy khi đang tải và nút thử lại khi lỗi
**And** thành phần gọi `POST /uploads`, PUT lên URL ký rồi `confirm`.

**Given** server từ chối (`VALIDATION_FAILED`)
**When** FE nhận
**Then** hiển thị lý do và cho chọn lại.

**Given** ô cam kết ToS
**When** chưa tích
**Then** nút gửi ở trang dùng thành phần bị vô hiệu
**And** cam kết phải tích lại cho mỗi lần tải lên mới, theo FR19.

**Given** file đã tải xong
**When** hiển thị
**Then** có ảnh xem trước và nút đổi ảnh.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock, ở viewport 360 px và không sửa file ngoài `apps/web`.

### Story 2.11: [FE] Trang Face Swap và tiến trình xử lý

**Phủ:** FR1, FR8, FR15

As a người dùng,
I want chọn hai ảnh, bấm một nút và theo dõi tiến trình,
So that tôi biết Task của mình đang ở đâu và có được hoàn credit khi lỗi không.

**Acceptance Criteria:**

**Given** trang `/face-swap`
**When** mở
**Then** có hai thành phần tải ảnh (ảnh mặt nguồn và ảnh đích) và nút "Tạo" hiển thị giá 100 credit lấy từ `GET /config/pricing`.

**Given** hai ảnh đã tải xong và đã tích cam kết
**When** số dư ≥ 100
**Then** nút "Tạo" bật; bấm một lần gọi `POST /tasks/face-swap`
**And** bấm hai lần liên tiếp không tạo hai Task.

**Given** số dư dưới 100
**When** mở trang
**Then** nút "Tạo" bị vô hiệu kèm thông báo cần nạp credit.

**Given** Task đã tạo
**When** ở trạng thái `queued`
**Then** hiển thị vị trí hàng đợi, cập nhật định kỳ, và nút hủy
**And** ở `running` hiển thị trạng thái đang xử lý.

**Given** Task kết thúc `failed`, `timed_out` hoặc `cancelled`
**When** FE nhận
**Then** hiển thị thông báo tiếng Việt theo `reasonCode` và nêu rõ credit đã được hoàn
**And** riêng `FREE_WAIT_EXPIRED` có gợi ý thử lại hoặc nạp credit.

**Given** các lỗi `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `PAUSED`
**When** nhận khi tạo Task
**Then** hiển thị thông báo tiếng Việt tương ứng.

**Given** Task `succeeded`
**When** FE nhận
**Then** chuyển sang trang kết quả.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock với mọi trạng thái Task và ở viewport 360 px.

### Story 2.12: [FE] Trang kết quả và lịch sử Task

**Phủ:** FR2, NFR6

As a người dùng,
I want xem ảnh kết quả, tải về, chia sẻ và xem lại các Task đã làm,
So that tôi lưu và dùng được thành quả của mình.

**Acceptance Criteria:**

**Given** Task `succeeded`
**When** mở trang kết quả
**Then** hiển thị ảnh kết quả cạnh ảnh gốc khi `sourceUrl` có giá trị (ngược lại chỉ hiển thị ảnh kết quả), nút "Tải về" và nút "Chia sẻ"
**And** ảnh lấy từ URL ký của `GET /tasks/{id}/result`.

**Given** URL ký đã hết hạn
**When** người dùng tải lại
**Then** FE lấy URL mới thay vì hiển thị ảnh hỏng.

**Given** bấm "Chia sẻ"
**When** thành công
**Then** FE gọi `POST /tasks/{id}/share` rồi sao chép đường dẫn hoặc mở khay chia sẻ của thiết bị
**And** có nút "Ngừng chia sẻ" gọi `DELETE /tasks/{id}/share`.

**Given** trang `/tasks`
**When** mở
**Then** danh sách Task mới nhất trước với pipeline, trạng thái bằng tiếng Việt và thời gian giờ Việt Nam
**And** tải thêm khi cuộn, có trạng thái rỗng và trạng thái lỗi.

**Given** Task `queued`
**When** xem trong danh sách hoặc chi tiết
**Then** có nút hủy; Task không còn `queued` thì không có nút này.

**Given** ảnh đã quá thời hạn lưu 30 ngày
**When** mở Task
**Then** hiển thị thông báo kết quả đã hết hạn lưu.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock và ở viewport 360 px.

### Story 2.13: [FE] Trang chia sẻ công khai có Open Graph

**Phủ:** NFR6, AR12

As a người nhận đường dẫn chia sẻ,
I want mở trang xem kết quả mà không cần đăng nhập và thấy bản xem trước đẹp khi dán lên mạng xã hội,
So that tôi xem được thành quả người khác chia sẻ.

**Acceptance Criteria:**

**Given** trang `/share/<token>` dựng bằng SSR
**When** trình thu thập của mạng xã hội tải trang
**Then** HTML trả về có thẻ `og:title`, `og:description`, `og:image` và `og:url`
**And** `og:image` trỏ tới `GET /s/<token>` để crawler luôn thấy URL ổn định.

**Given** token hợp lệ
**When** người dùng mở trang
**Then** hiển thị ảnh kết quả và nút kêu gọi dùng thử, không hiển thị thông tin riêng của chủ Task.

**Given** token không tồn tại hoặc đã thu hồi
**When** mở trang
**Then** hiển thị trang thông báo "Liên kết không còn tồn tại" với mã 404.

**Given** tối ưu cho di động
**When** mở ở viewport 360 px
**Then** ảnh vừa khung, không có cuộn ngang.

**Given** story này
**When** build với preset Nitro của Cloudflare Pages
**Then** trang SSR chạy đúng trên đầu ra của preset (đã kiểm ở Story 1.4)
**And** chạy được ở chế độ mock.

### Story 2.14: [INTEGRATION] Nối FE với BE và smoke test Face Swap

**Phủ:** FR1, FR2, FR8, FR10, FR15, FR17

As a nhà phát triển,
I want tắt mock và chạy Face Swap từ đầu đến cuối với BE thật,
So that xác nhận động cơ Task, ví và giao diện hoạt động cùng nhau.

**Acceptance Criteria:**

**Given** stack bốn container, FE ở chế độ `live`, RunningHub và R2 được giả
**When** chạy smoke test đường thành công
**Then** người dùng có 500 credit tạo Task Face Swap, số dư còn 400 (HOLD), Task đi `queued → running → succeeded`, CAPTURED, ảnh kết quả xem và tải được.

**Given** RunningHub giả trả lỗi `NO_FACE`
**When** chạy smoke test đường không có mặt
**Then** Task `failed`, số dư trở lại 500 (RELEASED), FE hiển thị "Không nhận diện được khuôn mặt trong ảnh".

**Given** RunningHub giả không bao giờ trả kết quả
**When** quá hạn chót ảnh 180 giây (đồng hồ được tăng tốc trong test)
**Then** Task `timed_out`, RELEASED, số dư trở lại, kết quả đến muộn bị bỏ qua.

**Given** người dùng chia sẻ kết quả
**When** mở `/share/<token>` không đăng nhập
**Then** thấy ảnh và thẻ Open Graph; sau khi thu hồi, đường dẫn trả 404.

**Given** job đối soát sổ cái
**When** chạy sau các smoke test
**Then** không báo lệch.

**Given** test hợp đồng ở CI
**When** chạy
**Then** phản hồi của mock và của BE thật đều khớp schema trong `packages/contracts`.

**Given** README
**When** cập nhật
**Then** ghi cách chạy ba smoke test, và ghi rõ SLA 60 giây chưa đo ở đây mà đo ở benchmark Epic 6.

## Epic 3: Nạp credit bằng VietQR

Người dùng nạp credit bằng VietQR và lên Tier; Admin được báo qua Discord và duyệt đơn trên dashboard. Epic này chỉ cần Epic 1, không phụ thuộc Epic 2.

**Thứ tự và hai luồng:** 3.1 làm trước, rồi hai luồng rẽ nhánh. BE: 3.2 → 3.3 → 3.4 → 3.5. FE (chạy trên mock): 3.6 → 3.7. Story 3.8 chỉ bắt đầu khi cả hai luồng xong.

**Lưu ý chung:** bảng `topups` tạo ở 3.2, bảng `admin_audit` tạo ở 3.5. Gói nạp: Starter 49.000 VNĐ = 5.000 credit, Pro 99.000 = 12.000, Creator 199.000 = 30.000, lấy từ `GET /config/pricing`, không hardcode ở nơi nào khác. Giờ làm việc của Admin tính theo múi giờ Việt Nam (UTC+7), khung 08:00–23:00 gồm 08:00 và không gồm 23:00 `[ASSUMPTION: cách tính biên khung giờ do người viết story đề xuất]`. Thông tin tài khoản nhận tiền (mã ngân hàng, số tài khoản, tên chủ tài khoản) cấu hình bằng biến môi trường, chưa được cung cấp `[ASSUMPTION]`.

### Story 3.1: [CONTRACT] Hợp đồng cho nạp tiền và duyệt đơn

**Phủ:** FR13, FR14

As a nhà phát triển của luồng BE và FE,
I want `packages/contracts` có endpoint, trạng thái và dữ liệu mock cho nạp tiền và duyệt đơn,
So that hai luồng thống nhất hình dạng API trước khi viết mã Epic 3.

**Acceptance Criteria:**

**Given** `packages/contracts`
**When** build gói
**Then** gói xuất enum trạng thái đơn `awaiting_transfer`, `pending`, `approved`, `rejected`, `needs_review`, `expired`
**And** xuất enum gói nạp `starter`, `pro`, `creator`
**And** `ApiErrorCode` có thêm `TOPUP_LIMIT`, `BANK_REF_DUPLICATE`, `TOPUP_STATE_INVALID`, `TOPUP_QR_EXPIRED`.

**Given** các endpoint của người dùng
**When** đọc hợp đồng
**Then** định nghĩa `POST /topups` (gói, `consent`) trả mã đơn, nội dung chuyển khoản `NAP <MÃ_GIAO_DỊCH>`, số tiền VNĐ, chuỗi `qrPayload`, thông tin tài khoản nhận tiền, `qr_expires_at`
**And** `POST /topups/{id}/confirm-transfer`, `GET /topups` (phân trang, của chính người dùng), `GET /topups/{id}`.

**Given** các endpoint của Admin
**When** đọc hợp đồng
**Then** định nghĩa `GET /admin/topups` (lọc theo trạng thái, phân trang, cờ quá `approve_by`), `POST /admin/topups/{id}/approve` (`bank_ref`), `POST /admin/topups/{id}/approve-expired` (`bank_ref`), `POST /admin/topups/{id}/reject` (`reject_reason`), `POST /admin/topups/{id}/needs-review` (ghi chú), `POST /admin/topups/{id}/return-to-pending`
**And** mỗi endpoint có schema request và response dùng chung FE và BE.

**Given** thông báo cho người dùng theo trạng thái đơn và theo mã lỗi mới
**When** FE cần hiển thị
**Then** bảng ánh xạ tiếng Việt nằm trong `packages/contracts`, gồm "Đang chờ duyệt" cho `pending` và "Cần xem xét" cho `needs_review`.

**Given** dữ liệu mock
**When** chạy test hợp đồng
**Then** mock của đơn ở mọi trạng thái và danh sách Admin đều khớp schema.

### Story 3.2: [BE] Tạo đơn nạp và mã VietQR

**Phủ:** FR13, FR19, AR17, NFR3

As a người dùng,
I want chọn một gói nạp và nhận mã VietQR đúng số tiền,
So that tôi chuyển khoản đúng và hệ thống nhận ra đơn của tôi.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** có bảng `topups` (id, `user_id`, `code` duy nhất, `pack`, `amount_vnd`, `status`, `qr_expires_at`, `approve_by`, `bank_ref` duy nhất cho phép null, `reject_reason`, `tos_version`, `notified_at`, `overdue_notified_at`, `created_at`)
**And** cột `topup_id` của `ledger_entries` có khóa ngoại tới `topups`.

**Given** người dùng đã đăng nhập, không bị khóa và `consent` đúng
**When** gọi `POST /topups` với gói hợp lệ
**Then** tạo đơn `awaiting_transfer` với `amount_vnd` lấy từ cấu hình giá phía server, `qr_expires_at` = bây giờ + 15 phút
**And** lưu `tos_version` của cam kết (FR19, khi nạp tiền)
**And** số tiền không bao giờ nhận từ client.

**Given** `consent` sai hoặc thiếu
**When** gọi
**Then** nhận `CONSENT_REQUIRED` và không tạo đơn.

**Given** người dùng đã có 3 đơn ở trạng thái `awaiting_transfer`, `pending` hoặc `needs_review`
**When** gọi `POST /topups`
**Then** nhận `TOPUP_LIMIT` và không tạo đơn.

**Given** mã giao dịch
**When** tạo đơn
**Then** `code` là chuỗi ngẫu nhiên khó đoán, duy nhất, và nội dung chuyển khoản là `NAP <code>`
**And** va chạm mã được xử lý bằng việc sinh lại, không làm lỗi yêu cầu.

**Given** `qrPayload` do server sinh theo chuẩn VietQR/EMVCo bằng mã cục bộ, không gọi dịch vụ ngoài
**When** chạy test
**Then** chuỗi có đúng số tiền, đúng nội dung chuyển khoản và mã kiểm tra CRC hợp lệ
**And** thông tin tài khoản nhận tiền đọc từ biến môi trường, có `.env.example`.

**Given** tài khoản có `locked_at`
**When** gọi
**Then** nhận `ACCOUNT_LOCKED`.

**Given** `GET /topups` và `GET /topups/{id}`
**When** gọi
**Then** chỉ trả đơn của chính người đó, mới nhất trước, có phân trang
**And** người khác nhận lỗi không có quyền.

**Given** route ghi
**When** một người dùng hoặc IP gọi quá giới hạn
**Then** `@nestjs/throttler` trả `RATE_LIMITED`.

### Story 3.3: [BE] Xác nhận chuyển khoản, hạn QR và hạn duyệt

**Phủ:** FR13, AR17

As a người dùng,
I want bấm "Đã chuyển khoản" để đơn của tôi chờ Admin duyệt, kể cả khi tôi chuyển ngoài giờ làm việc,
So that tiền tôi đã chuyển không bị hết hạn oan.

**Acceptance Criteria:**

**Given** đơn `awaiting_transfer` chưa quá `qr_expires_at`
**When** chủ đơn gọi `POST /topups/{id}/confirm-transfer`
**Then** CAS `awaiting_transfer→pending` và đặt `approve_by`
**And** gọi lần hai không tạo thay đổi nào và không báo lỗi sai.

**Given** `approve_by` bằng 15 phút sau thời điểm đầu tiên nằm trong khung 08:00–23:00 giờ Việt Nam
**When** xác nhận lúc 10:00
**Then** `approve_by` là 10:15 cùng ngày
**And** xác nhận lúc 23:30 thì `approve_by` là 08:15 sáng hôm sau
**And** xác nhận lúc 07:00 thì `approve_by` là 08:15 cùng ngày
**And** xác nhận lúc 22:50 thì `approve_by` là 23:05 cùng ngày (áp dụng đúng nguyên văn quy tắc, kể cả khi vượt khung).

**Given** đơn `awaiting_transfer` đã quá `qr_expires_at`
**When** gọi `confirm-transfer`
**Then** nhận `TOPUP_QR_EXPIRED` và đơn chuyển `expired`.

**Given** bộ quét `@nestjs/schedule` trong worker
**When** đơn `awaiting_transfer` quá `qr_expires_at`
**Then** CAS `awaiting_transfer→expired` bằng UPDATE có điều kiện
**And** nếu người dùng bấm xác nhận cùng lúc, đúng một bên thắng và đơn không bao giờ vừa `pending` vừa `expired`.

**Given** đơn đã `pending`
**When** quá `qr_expires_at` hoặc quá `approve_by`
**Then** đơn không bao giờ tự chuyển `expired` hay `rejected`, vẫn chờ Admin xử lý.

**Given** người khác không phải chủ đơn
**When** gọi `confirm-transfer`
**Then** bị từ chối.

**Given** đơn ở trạng thái khác `awaiting_transfer`
**When** gọi `confirm-transfer`
**Then** nhận `TOPUP_STATE_INVALID`, trừ trường hợp lặp lại thao tác đã thành công như trên.

### Story 3.4: [BE] Thông báo Discord cho Admin

**Phủ:** FR14, AR23

As a Admin,
I want nhận thông báo trên Discord khi có đơn nạp mới hoặc đơn quá hạn duyệt,
So that tôi duyệt kịp thời mà không phải canh dashboard.

**Acceptance Criteria:**

**Given** `NotifierPort` và adapter Discord webhook (địa chỉ webhook đọc từ biến môi trường, có `.env.example`)
**When** đơn chuyển sang `pending`
**Then** gửi đúng một thông báo gồm mã đơn, gói, số tiền VNĐ và thời hạn duyệt
**And** đặt `notified_at` sau khi gửi thành công.

**Given** Discord không phản hồi hoặc trả lỗi
**When** gửi thông báo
**Then** yêu cầu xác nhận chuyển khoản của người dùng vẫn thành công
**And** bộ quét gửi lại các đơn `pending` còn `notified_at` rỗng, tối đa 5 lần cho mỗi đơn, rồi ghi log lỗi.

**Given** đơn `pending` quá `approve_by`
**When** bộ quét chạy
**Then** gửi đúng một thông báo quá hạn và đặt `overdue_notified_at`
**And** không gửi lặp ở các lần quét sau.

**Given** adapter Discord
**When** thay adapter ghi log của Story 1.7 bằng adapter này trong môi trường chạy thật
**Then** cảnh báo đối soát sổ cái cũng đi qua Discord.

**Given** nội dung thông báo
**When** kiểm tra
**Then** không chứa email, token hay thông tin tài khoản nhận tiền
**And** test dùng máy chủ HTTP giả thay Discord thật.

### Story 3.5: [BE] Duyệt và từ chối đơn, nhật ký Admin

**Phủ:** FR14, AR17, AR7

As a Admin,
I want duyệt hoặc từ chối đơn nạp sau khi đối chiếu ngân hàng,
So that credit và Tier của khách được cập nhật đúng và mọi thao tác đều truy vết được.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** có bảng `admin_audit` (id, `admin_id`, `action`, `target`, `before_after`, `at`)
**And** service `audit` là nơi duy nhất ghi bảng này.

**Given** route `/admin/**`
**When** người dùng role `user` hoặc chưa đăng nhập gọi
**Then** nhận 403 hoặc 401.

**Given** `GET /admin/topups`
**When** Admin gọi
**Then** trả danh sách theo bộ lọc trạng thái, mới nhất trước, có phân trang
**And** mỗi đơn có cờ quá `approve_by`.

**Given** đơn `pending` hoặc `needs_review` và `bank_ref` hợp lệ chưa dùng
**When** Admin gọi `POST /admin/topups/{id}/approve`
**Then** trong một transaction do `topups` mở: CAS sang `approved`, lưu `bank_ref`, gọi `wallet.topup(tx, userId, topupId, amount, pack)` và ghi `admin_audit`
**And** credit đúng theo gói (5.000, 12.000 hoặc 30.000), Tier và `tier_pack` được tính lại trong cùng transaction
**And** Admin duyệt gói Creator thì người dùng có Priority 1 ngay sau đó.

**Given** thiếu `bank_ref`
**When** gọi `approve`
**Then** nhận `VALIDATION_FAILED` và không có gì thay đổi.

**Given** `bank_ref` đã được dùng cho đơn khác
**When** gọi `approve`
**Then** nhận `BANK_REF_DUPLICATE`, không cộng credit.

**Given** Admin bấm duyệt hai lần hoặc hai Admin duyệt đồng thời
**When** chạy song song trên PostgreSQL thật
**Then** credit chỉ được cộng một lần.

**Given** đơn `expired`
**When** Admin gọi `POST /admin/topups/{id}/approve-expired` kèm `bank_ref`
**Then** duyệt được qua đường riêng và `admin_audit` ghi rõ đây là duyệt đơn đã hết hạn
**And** `approve` thường với đơn `expired` nhận `TOPUP_STATE_INVALID`.

**Given** đơn `pending` hoặc `needs_review`
**When** Admin gọi `reject` kèm `reject_reason`
**Then** đơn chuyển `rejected`, lưu lý do, ghi `admin_audit`
**And** thiếu lý do thì nhận `VALIDATION_FAILED`.

**Given** đơn `pending`
**When** Admin gọi `needs-review` kèm ghi chú
**Then** đơn chuyển `needs_review` và ghi `admin_audit`
**And** `return-to-pending` đưa đơn `needs_review` về `pending` và cũng được ghi nhật ký.

**Given** đơn đã `approved` hoặc `rejected`
**When** gọi bất kỳ thao tác duyệt nào
**Then** nhận `TOPUP_STATE_INVALID`.

**Given** đơn được duyệt
**When** người dùng gọi `GET /me`
**Then** thấy số dư và Tier mới.

### Story 3.6: [FE] Trang nạp credit và theo dõi đơn

**Phủ:** FR13, FR19, NFR6

As a người dùng,
I want chọn gói, quét mã QR, chuyển khoản và theo dõi trạng thái đơn,
So that tôi nạp credit nhanh và biết khi nào credit về.

**Acceptance Criteria:**

**Given** trang `/topup`
**When** mở
**Then** hiển thị ba gói với giá VNĐ, số credit, thời lượng tối đa và độ ưu tiên, lấy từ `GET /config/pricing`
**And** có ô cam kết ToS bắt buộc tích cho mỗi lần nạp; chưa tích thì nút tạo đơn bị vô hiệu.

**Given** người dùng chọn gói và tạo đơn
**When** đơn `awaiting_transfer` được tạo
**Then** hiển thị ảnh QR dựng từ `qrPayload`, số tiền, nội dung chuyển khoản `NAP <MÃ>` với nút sao chép, và thông tin tài khoản nhận tiền
**And** có đồng hồ đếm ngược 15 phút tính từ `qr_expires_at` của server, không từ đồng hồ máy.

**Given** đồng hồ về 0 mà chưa bấm xác nhận
**When** hết hạn
**Then** hiển thị "Mã đã hết hạn" kèm nút tạo mã mới, và nút "Đã chuyển khoản" bị vô hiệu.

**Given** người dùng đã chuyển khoản
**When** bấm "Đã chuyển khoản"
**Then** gọi `confirm-transfer` đúng một lần dù bấm nhiều lần
**And** trạng thái đổi thành "Đang chờ duyệt".

**Given** đơn `pending` được tạo ngoài khung 08:00–23:00
**When** hiển thị
**Then** có dòng giải thích đơn sẽ được duyệt từ 08:00 sáng hôm sau.

**Given** đơn chuyển `approved`
**When** FE nhận trạng thái mới
**Then** hiển thị thông báo thành công, cập nhật số dư và Tier trên tiêu đề.

**Given** đơn `rejected`, `needs_review`, `expired`
**When** FE nhận
**Then** hiển thị lần lượt lý do từ chối, "Cần xem xét" kèm hướng dẫn liên hệ, và nút tạo đơn mới.

**Given** các lỗi `TOPUP_LIMIT`, `CONSENT_REQUIRED`, `ACCOUNT_LOCKED`, `RATE_LIMITED`
**When** nhận khi tạo đơn
**Then** hiển thị thông báo tiếng Việt tương ứng.

**Given** danh sách đơn của người dùng
**When** mở
**Then** hiển thị mới nhất trước, tải thêm khi cuộn, có trạng thái rỗng và trạng thái lỗi
**And** giao diện nạp tiền và modal QR tuân thủ đặc tả tại `mockups/vietqr-modal.html` và `EXPERIENCE.md`: hỗ trợ mở dạng In-Context Bottom Sheet khi thiếu credit để giữ nguyên dữ liệu đang thao tác, toàn bộ icon sử dụng vector Lucide (`lucide:copy`, `lucide:clock`, `lucide:x`, `lucide:check`).

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock với mọi trạng thái đơn và ở viewport 360 px
**And** thư viện dựng ảnh QR do người triển khai chọn và ghi vào Stack `[ASSUMPTION: spine chưa ghim thư viện này]`.

### Story 3.7: [FE] Dashboard Admin duyệt đơn nạp

**Phủ:** FR14

As a Admin,
I want xem và xử lý các đơn nạp trên một màn hình,
So that tôi duyệt đúng, nhanh và không bỏ sót đơn quá hạn.

**Acceptance Criteria:**

**Given** người dùng role `user` hoặc chưa đăng nhập
**When** mở `/admin/topups`
**Then** FE chuyển về trang đăng nhập hoặc hiển thị trang 403, không lộ dữ liệu nào.

**Given** Admin đã đăng nhập
**When** mở `/admin/topups`
**Then** thấy danh sách đơn có bộ lọc theo trạng thái (mặc định `pending`), mã đơn, gói, số tiền, thời gian tạo và thời hạn duyệt
**And** đơn quá `approve_by` có nhãn nổi bật.

**Given** một đơn `pending`
**When** Admin mở chi tiết và bấm Duyệt
**Then** form bắt buộc nhập `bank_ref`, hiển thị số tiền cần đối chiếu và thông báo xác nhận trước khi gửi
**And** bấm nhiều lần chỉ gửi một yêu cầu.

**Given** thao tác Từ chối
**When** Admin bấm
**Then** form bắt buộc nhập lý do.

**Given** thao tác Đánh dấu "Cần xem xét" và "Đưa về chờ duyệt"
**When** Admin bấm
**Then** gọi đúng endpoint tương ứng.

**Given** đơn `expired`
**When** Admin muốn duyệt
**Then** giao diện có lối riêng, hiển thị cảnh báo đây là đơn đã hết hạn và yêu cầu nhập `bank_ref`.

**Given** `BANK_REF_DUPLICATE`, `TOPUP_STATE_INVALID`, `VALIDATION_FAILED`
**When** FE nhận
**Then** hiển thị thông báo tiếng Việt, và danh sách tự làm mới khi trạng thái đơn đã đổi bởi Admin khác.

**Given** danh sách dài
**When** cuộn
**Then** tải thêm trang tiếp theo; có trạng thái rỗng và trạng thái lỗi.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock và dùng được ở viewport 360 px.

### Story 3.8: [INTEGRATION] Nối FE với BE và smoke test nạp tiền

**Phủ:** FR13, FR14

As a nhà phát triển,
I want tắt mock và chạy nạp tiền từ đầu đến cuối với BE thật,
So that xác nhận QR, hạn, Discord, duyệt và sổ cái hoạt động cùng nhau.

**Acceptance Criteria:**

**Given** stack bốn container, FE ở chế độ `live`, Discord được giả bằng máy chủ HTTP
**When** chạy smoke test đường thành công
**Then** người dùng chọn gói Pro, tạo đơn, bấm "Đã chuyển khoản", Discord giả nhận đúng một thông báo, Admin nhập `bank_ref` và duyệt
**And** số dư tăng 12.000, Tier thành Pro, lịch sử credit có một dòng "Nạp".

**Given** một đơn khác dùng cùng `bank_ref`
**When** Admin duyệt
**Then** nhận lỗi trùng và không cộng credit.

**Given** đơn được xác nhận lúc 23:30 giờ Việt Nam (đồng hồ được giả trong test)
**When** kiểm tra
**Then** đơn ở `pending`, `approve_by` là 08:15 sáng hôm sau, và quá `qr_expires_at` vẫn không chuyển `expired`.

**Given** đơn không bấm "Đã chuyển khoản"
**When** quá 15 phút
**Then** đơn thành `expired` và FE hiển thị nút tạo mã mới.

**Given** Admin bấm duyệt đồng thời trên hai phiên
**When** chạy song song
**Then** credit chỉ được cộng một lần.

**Given** job đối soát sổ cái
**When** chạy sau các smoke test
**Then** không báo lệch.

**Given** test hợp đồng ở CI
**When** chạy
**Then** phản hồi của mock và của BE thật đều khớp schema trong `packages/contracts`.

**Given** README
**When** cập nhật
**Then** ghi cách chạy smoke test và liệt kê các biến môi trường cần cung cấp: thông tin tài khoản nhận tiền và địa chỉ webhook Discord.

## Epic 4: Body Retouch

Người dùng chỉnh dáng ảnh theo mức `intensity` 1–10 bằng một lần bấm và xem so sánh trước/sau. Epic này dùng lại động cơ Task, ví, hàng đợi, kết quả và chia sẻ của Epic 2, chỉ thêm pipeline mới. Cần Epic 2 xong; độc lập với Epic 3.

**Thứ tự và hai luồng:** 4.1 làm trước, rồi hai luồng rẽ nhánh. BE: 4.2 → 4.3. FE (chạy trên mock): 4.4 → 4.5. Story 4.6 chỉ bắt đầu khi cả hai luồng xong.

**Lưu ý chung:** mọi chuyển trạng thái và bút toán đi qua `tasks.transition` và `wallet` của Epic 1–2, không viết đường riêng cho Body Retouch. Workflow ID đọc từ biến môi trường `RUNNINGHUB_WORKFLOW_BODY_RESHAPE`. Lỗi "không thấy người trong ảnh" từ workflow dùng lại mã `NO_POSE` (không thêm mã mới để giữ nguyên enum trong kiến trúc); chỉ khác thông báo tiếng Việt theo pipeline. Body Retouch là pipeline dễ chạm node lọc nội dung của RunningHub nhất, đặc biệt ở `intensity` 8–10; danh sách ánh xạ `CONTENT_BLOCKED` vẫn do Epic 6 điền.

### Story 4.1: [CONTRACT] Hợp đồng cho Body Retouch

**Phủ:** FR3, FR4

As a nhà phát triển của luồng BE và FE,
I want `packages/contracts` có endpoint, schema `intensity` và thông báo cho Body Retouch,
So that hai luồng thống nhất hình dạng API trước khi viết mã Epic 4.

**Acceptance Criteria:**

**Given** `packages/contracts`
**When** build gói
**Then** gói xuất enum `pipeline` có thêm giá trị `body_retouch`
**And** xuất schema `intensity` là số nguyên từ 1 đến 10, mặc định 5, dùng chung cho FE và BE.

**Given** các endpoint của epic
**When** đọc hợp đồng
**Then** định nghĩa `POST /tasks/body-retouch` nhận khóa ảnh `in/`, `intensity` và `consent`, trả Task cùng hình dạng như `POST /tasks/face-swap`
**And** các endpoint đọc Task, hủy, kết quả và chia sẻ của Epic 2 dùng chung cho mọi pipeline mà không đổi hình dạng.

**Given** nhãn mức điều chỉnh
**When** FE cần hiển thị
**Then** hợp đồng có hằng số ba vùng: 1–3 "Uốn nhẹ dáng", 4–7 "Tự nhiên", 8–10 "Đường cong tối đa".

**Given** bảng thông báo theo `pipeline`
**When** gặp `NO_POSE` ở pipeline `body_retouch`
**Then** thông báo tiếng Việt là "Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân."
**And** thông báo `NO_POSE` của Motion Control là thông báo khác, do Epic 5 định nghĩa.

**Given** dữ liệu mock
**When** chạy test hợp đồng
**Then** mock Task `body_retouch` ở mọi trạng thái và mock kết quả có `sourceUrl` khớp schema.

### Story 4.2: [BE] Tạo Task Body Retouch

**Phủ:** FR3, AR10

As a người dùng,
I want bấm một lần để tạo Task Body Retouch với mức điều chỉnh tôi chọn,
So that tôi bị giữ đúng 100 credit và Task vào hàng đợi.

**Acceptance Criteria:**

**Given** pipeline `body_retouch` đăng ký trong cấu hình pipeline với giá 100 credit, workflow ID đọc từ `RUNNINGHUB_WORKFLOW_BODY_RESHAPE`, ảnh tham chiếu để kiểm kích thước đầu ra là ảnh đầu vào
**When** khởi động
**Then** thiếu biến môi trường workflow ID thì tiến trình `api` và `worker` không khởi động và báo rõ biến nào thiếu.

**Given** người dùng đã đăng nhập, không bị khóa, số dư ≥ 100, một khóa ảnh `in/` hợp lệ, `consent` đúng và `intensity` từ 1 đến 10
**When** gọi `POST /tasks/body-retouch`
**Then** dùng lại `tasks.create` của Epic 2: HOLD 100 credit trong cùng transaction, INSERT Task `queued` kèm Tier Snapshot, sau commit mới enqueue
**And** `intensity` lưu trong `params` của Task và phản hồi trong 2 giây.

**Given** `intensity` ngoài 1–10, không phải số nguyên, hoặc thiếu
**When** gọi
**Then** nhận `VALIDATION_FAILED`, không HOLD, không tạo Task
**And** thiếu `intensity` thì dùng giá trị mặc định 5 theo hợp đồng.

**Given** `consent` sai, tài khoản bị khóa, số dư dưới 100, hoặc đã có 3 Task `queued` hoặc `running`
**When** gọi
**Then** nhận lần lượt `CONSENT_REQUIRED`, `ACCOUNT_LOCKED`, `INSUFFICIENT_CREDIT`, `TASK_LIMIT` giống Face Swap.

**Given** worker lấy Task `body_retouch`
**When** gửi lên RunningHub
**Then** upload ảnh, truyền `intensity` làm tham số của workflow đúng tên node đã khai báo trong cấu hình pipeline
**And** dùng cùng đường poll, hạn chót 180 giây, bộ quét và khôi phục như Epic 2.

**Given** workflow trả lỗi có tiền tố `NO_POSE`
**When** worker nhận
**Then** Task `failed` với `NO_POSE` và RELEASED 100% qua `tasks.transition`, không có đường xử lý riêng.

**Given** hai pipeline cùng chạy
**When** có Task Face Swap và Body Retouch trong hàng đợi
**Then** cùng xếp một hàng đợi chung, cùng 2 Lane, theo Priority rồi FIFO.

**Given** test
**When** chạy
**Then** RunningHub được giả ở `RunningHubPort`, không gọi mạng thật.

### Story 4.3: [BE] Kết quả Body Retouch

**Phủ:** FR3, FR4, AR11

As a người dùng,
I want ảnh kết quả giữ đúng kích thước ảnh gốc và xem được ảnh gốc để so sánh,
So that tôi nhận file dùng được và thấy sự khác biệt.

**Acceptance Criteria:**

**Given** RunningHub báo `SUCCESS` cho Task `body_retouch`
**When** worker nhập kết quả theo Story 2.6
**Then** kiểm tra file có kích thước bằng ảnh đầu vào (ảnh tham chiếu của pipeline này)
**And** lệch kích thước thì `failed` với `OUTPUT_INVALID` và RELEASED.

**Given** kết quả đạt kiểm tra
**When** chốt
**Then** ghi EXIF, lưu `gpu_coins`, `running→succeeded` kèm CAPTURED giống Epic 2.

**Given** Task `succeeded` và ảnh gốc còn trong thời hạn lưu 7 ngày
**When** chủ Task gọi `GET /tasks/{id}/result`
**Then** nhận `resultUrl` và `sourceUrl` đều là URL ký ngắn hạn.

**Given** ảnh gốc đã quá 7 ngày
**When** gọi `GET /tasks/{id}/result`
**Then** `sourceUrl` rỗng và `resultUrl` vẫn hợp lệ.

**Given** người khác không phải chủ Task
**When** gọi
**Then** bị từ chối.

**Given** chia sẻ kết quả theo Story 2.9
**When** chủ Task tạo token cho Task `body_retouch`
**Then** `GET /s/<token>` chỉ chuyển hướng tới `resultUrl`, không bao giờ lộ ảnh gốc.

### Story 4.4: [FE] Trang Body Retouch và thanh mức điều chỉnh

**Phủ:** FR3

As a người dùng,
I want chọn một ảnh, kéo thanh mức điều chỉnh và bấm một nút,
So that tôi chỉnh dáng ảnh theo ý mình.

**Acceptance Criteria:**

**Given** trang `/body-retouch`
**When** mở
**Then** có một thành phần tải ảnh (Story 2.10) và thanh trượt `intensity` từ 1 đến 10, mặc định 5
**And** nút "Tạo" hiển thị giá 100 credit lấy từ `GET /config/pricing`.

**Given** người dùng kéo thanh trượt
**When** giá trị thay đổi
**Then** hiển thị giá trị số và nhãn ba vùng theo hợp đồng ("Uốn nhẹ dáng", "Tự nhiên", "Đường cong tối đa")
**And** dùng được bằng ngón tay trên di động, bước 1.

**Given** ảnh đã tải xong, đã tích cam kết, số dư ≥ 100
**When** bấm "Tạo"
**Then** gọi `POST /tasks/body-retouch` đúng một lần dù bấm nhiều lần
**And** vào màn tiến trình và vị trí hàng đợi dùng lại của Story 2.11.

**Given** số dư dưới 100
**When** mở trang
**Then** nút "Tạo" bị vô hiệu kèm thông báo cần nạp credit.

**Given** Task `failed` với `NO_POSE` ở pipeline này
**When** FE nhận
**Then** hiển thị "Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân." và nêu rõ credit đã được hoàn.

**Given** các lỗi `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `PAUSED`, `CONSENT_REQUIRED`
**When** nhận khi tạo Task
**Then** hiển thị thông báo tiếng Việt tương ứng.

**Given** trang chọn tính năng hoặc điều hướng chính
**When** hiển thị
**Then** có lối vào "Body Retouch" cạnh "Face Swap".

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock với mọi trạng thái Task và ở viewport 360 px, không sửa file ngoài `apps/web`.

### Story 4.5: [FE] So sánh trước/sau

**Phủ:** FR4

As a người dùng,
I want kéo thanh trượt để so sánh ảnh gốc và ảnh đã chỉnh,
So that tôi thấy rõ phần được thay đổi.

**Acceptance Criteria:**

**Given** Task `body_retouch` `succeeded` và `sourceUrl` có giá trị
**When** mở trang kết quả
**Then** hiển thị thành phần so sánh hai ảnh chồng nhau với thanh kéo ngang, ảnh gốc một bên và ảnh kết quả một bên
**And** kéo bằng ngón tay mượt trên di động, hai ảnh luôn cùng kích thước và căn khớp.

**Given** thanh kéo ở vị trí bất kỳ
**When** người dùng thả tay
**Then** thanh giữ nguyên vị trí và hai ảnh không bị méo.

**Given** `sourceUrl` rỗng vì ảnh gốc đã quá thời hạn lưu
**When** mở trang kết quả
**Then** chỉ hiển thị ảnh kết quả kèm dòng "Ảnh gốc đã hết hạn lưu", không hiển thị thanh so sánh hỏng.

**Given** URL ký của một trong hai ảnh đã hết hạn
**When** người dùng tải lại hoặc ảnh lỗi tải
**Then** FE lấy lại URL mới thay vì hiển thị ảnh vỡ.

**Given** trang kết quả
**When** mở
**Then** vẫn có nút "Tải về" (chỉ tải ảnh kết quả), "Chia sẻ" và "Ngừng chia sẻ" của Story 2.12.

**Given** thành phần so sánh
**When** thiết kế
**Then** dùng lại được cho pipeline khác có ảnh gốc, và thao tác được bằng bàn phím (mũi tên di chuyển thanh) cũng như có nhãn đọc màn hình
**And** tuân thủ đặc tả UX tại `mockups/split-compare.html` và `EXPERIENCE.md`: núm trượt 36px chứa vector icon `lucide:arrow-left-right`, nút Tải HD không watermark dùng `lucide:download`, nút sao chép dùng `lucide:link`, tuyệt đối không dùng icon emoji.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock (có và không có `sourceUrl`) và ở viewport 360 px.

### Story 4.6: [INTEGRATION] Nối FE với BE và smoke test Body Retouch

**Phủ:** FR3, FR4

As a nhà phát triển,
I want tắt mock và chạy Body Retouch từ đầu đến cuối với BE thật,
So that xác nhận pipeline mới chạy cùng động cơ Task đã có.

**Acceptance Criteria:**

**Given** stack bốn container, FE ở chế độ `live`, RunningHub và R2 được giả
**When** chạy smoke test đường thành công với `intensity` 8
**Then** số dư giảm 100 (HOLD) rồi CAPTURED, Task `succeeded`, trang kết quả có thanh so sánh trước/sau
**And** RunningHub giả nhận đúng giá trị `intensity` 8.

**Given** RunningHub giả trả lỗi `NO_POSE`
**When** chạy smoke test đường không có người
**Then** Task `failed`, RELEASED, số dư trở lại, FE hiển thị thông báo của pipeline Body Retouch.

**Given** một Task Face Swap và một Task Body Retouch cùng được tạo
**When** worker chạy
**Then** cả hai dùng chung hàng đợi, không quá 2 Task đồng thời, và sổ cái ghi đúng hai bộ HOLD/CAPTURED.

**Given** ảnh gốc đã quá thời hạn lưu (đồng hồ được tăng tốc)
**When** mở lại kết quả
**Then** FE chỉ hiển thị ảnh kết quả, không lỗi.

**Given** job đối soát sổ cái
**When** chạy sau các smoke test
**Then** không báo lệch.

**Given** test hợp đồng ở CI
**When** chạy
**Then** phản hồi của mock và của BE thật đều khớp schema trong `packages/contracts`.

**Given** README
**When** cập nhật
**Then** ghi cách chạy smoke test và nhắc ít nhất một ảnh trong 1–2 ảnh nhạy cảm của benchmark Epic 6 phải chạy qua Body Retouch.

## Epic 5: Motion Control

Người dùng cho nhân vật trong ảnh chuyển động theo video mẫu: tải video, cắt đoạn bằng thanh trượt Trim bước 1 giây, thấy giá theo thời gian thực, và nhận video MP4 kết quả. Thời lượng tối đa theo Tier (FREE 5, Starter 10, Pro 15, Creator 20 giây). Cần Epic 2 xong; độc lập với Epic 3 và Epic 4.

**Thứ tự và hai luồng:** 5.1 làm trước, rồi hai luồng rẽ nhánh. BE: 5.2 → 5.3 → 5.4 → 5.5 → 5.6. FE (chạy trên mock): 5.7 → 5.8. Story 5.9 chỉ bắt đầu khi cả hai luồng xong. Các story được phát triển trên nhánh và epic chỉ triển khai lên môi trường thật sau 5.9 (route tạo Task Motion có trước khi worker xử lý được pipeline này).

**Lưu ý chung:**

- Cổng đồng thời RunningHub, job mồ côi, bộ quét và nhánh khôi phục đã có từ Epic 2; epic này chỉ thêm bước chuẩn bị (ffmpeg) phía trước và pipeline `motion`.
- Giá Motion = 50 credit × số giây nguyên; dung sai ±0,5 giây của file đầu ra không đổi số credit đã giữ và không có hoàn phần lẻ (FR7).
- Cap kiểm theo Tier Snapshot lúc bấm Tạo, phía server là bên quyết định; FE chỉ hiển thị lại lỗi khi Cap đã đổi.
- Chi tiết sai khác của môi trường thật (tải CPU của ffmpeg, dung lượng đĩa tạm trên VPS 4 vCPU) được đo ở bước kiểm thử ffmpeg của Epic 6, không đo ở đây.
- `ffprobe` và `ffmpeg` luôn được gọi bằng mảng đối số (không qua shell), không ghép khóa hay tên file do người dùng cung cấp vào lệnh.
- Hạn chuẩn bị 120 giây (gồm chờ khóa ffmpeg, tải file từ R2, cắt) giữ nguyên như kiến trúc; hạn xử lý video là 360 giây tính từ lúc bắt đầu tải input lên RunningHub.

### Story 5.1: [CONTRACT] Hợp đồng cho Motion Control

**Phủ:** FR5, FR6, FR7

As a nhà phát triển của luồng BE và FE,
I want `packages/contracts` có endpoint, schema Trim, hàm tính giá và thông báo cho Motion Control,
So that hai luồng thống nhất hình dạng API trước khi viết mã Epic 5.

**Acceptance Criteria:**

**Given** `packages/contracts`
**When** build gói
**Then** enum `pipeline` có thêm giá trị `motion`
**And** xuất hàm `motionPrice(seconds)` trả 50 × `seconds` mà cả FE và BE cùng import, và hàm này là nơi duy nhất giữ hằng số 50 phía mã nguồn (nguồn giá thật vẫn là cấu hình phía server).

**Given** `GET /config/pricing`
**When** đọc hợp đồng
**Then** phản hồi có giá Motion mỗi giây (50), số giây tối thiểu (3) và Cap theo Tier (5, 10, 15, 20); trường nào chưa có từ Story 1.2 được bổ sung ở đây.

**Given** các endpoint của epic
**When** đọc hợp đồng
**Then** `POST /uploads` nhận thêm loại `video` (MIME `video/mp4` hoặc `video/quicktime`, kích thước khai báo tối đa 100 MB)
**And** `POST /uploads/{key}/confirm` với video trả thêm `durationSeconds`, `width`, `height`
**And** `POST /tasks/motion` nhận `characterKey`, `videoKey`, `trimStart`, `trimEnd` (số giây nguyên), `consent` và trả Task cùng hình dạng như các pipeline khác kèm `price`.

**Given** kết quả của Task
**When** đọc hợp đồng của `GET /tasks/{id}/result`
**Then** phản hồi có thêm `mediaType` (`image` hoặc `video`), `posterUrl` (chỉ video), `durationSeconds` (chỉ video); `sourceUrl` của Motion luôn rỗng
**And** có thêm `GET /s/{token}/info` (trả `mediaType`, `durationSeconds`) và `GET /s/{token}/poster` (chuyển hướng tới URL ký của ảnh bìa).

**Given** lỗi `VALIDATION_FAILED` liên quan video và Trim
**When** đọc hợp đồng
**Then** `details.reason` thuộc enum `VIDEO_UNREADABLE`, `VIDEO_TOO_SHORT`, `TRIM_TOO_SHORT`, `TRIM_EXCEEDS_CAP`, `TRIM_OUT_OF_VIDEO`, `TRIM_NOT_WHOLE_SECOND`
**And** `TRIM_EXCEEDS_CAP` kèm `details.cap`
**And** `ApiErrorCode` không thêm giá trị mới.

**Given** bảng thông báo tiếng Việt theo `pipeline`
**When** FE cần hiển thị cho pipeline `motion`
**Then** `NO_POSE` là "Không nhận diện được chuyển động cơ thể trong video mẫu"
**And** `NO_FACE` là "Không nhận diện được nhân vật trong ảnh. Vui lòng chọn ảnh toàn thân rõ người."
**And** có thông báo cho từng `details.reason` (ví dụ `TRIM_EXCEEDS_CAP`: "Gói của bạn cho phép tối đa {cap} giây").

**Given** dữ liệu mock
**When** chạy test hợp đồng
**Then** mock Task `motion` ở mọi trạng thái, mock xác nhận tải video và mock kết quả video (có `posterUrl`) đều khớp schema.

### Story 5.2: [BE] Tải video lên và kiểm tra bằng ffprobe

**Phủ:** FR6, AR15, AR12

As a người dùng,
I want tải video mẫu lên trực tiếp và được kiểm tra ngay,
So that tôi biết video có dùng được không trước khi chọn đoạn.

**Acceptance Criteria:**

**Given** người dùng đã đăng nhập
**When** gọi `POST /uploads` với loại `video` và MIME `video/mp4` hoặc `video/quicktime`, kích thước khai báo ≤ 100 MB
**Then** nhận khóa `in-raw/<userId>/<uuid>` và presigned PUT ký kèm `Content-Length`
**And** upload này được tính vào giới hạn 10 file chưa xác nhận của Story 2.2.

**Given** MIME khác, kích thước khai báo trên 100 MB
**When** gọi `POST /uploads`
**Then** nhận `VALIDATION_FAILED` và không cấp URL.

**Given** file đã tải lên
**When** gọi `POST /uploads/{key}/confirm`
**Then** server kiểm khóa thuộc đúng người dùng, `HEAD` lấy kích thước thật và ETag, kích thước thật phải khớp khai báo
**And** `ffprobe` đọc file qua URL ký GET ngắn hạn với timeout 10 giây, mảng đối số cố định và `-protocol_whitelist https,tls,tcp`.

**Given** `ffprobe` thành công
**When** kiểm tra
**Then** container thuộc họ MP4/MOV (`format_name` chứa `mov` hoặc `mp4`), có ít nhất một luồng video, `durationSeconds` hữu hạn và ≥ 3
**And** phản hồi trả `durationSeconds` (làm tròn xuống số nguyên), `width`, `height`
**And** server lưu `duration_seconds`, `width`, `height` vào bản ghi `uploads` của khóa đó (bảng đã có từ Epic 2), để bước tạo Task Motion dùng giá trị này thay vì giá trị client gửi.

**Given** file là Matroska/WebM đổi đuôi `.mp4`, file chỉ có âm thanh, file bị cắt cụt, file ngắn dưới 3 giây, hoặc `ffprobe` quá 10 giây
**When** xác nhận
**Then** nhận `VALIDATION_FAILED` với `details.reason` lần lượt `VIDEO_UNREADABLE`, `VIDEO_UNREADABLE`, `VIDEO_UNREADABLE`, `VIDEO_TOO_SHORT`, `VIDEO_UNREADABLE`
**And** đối tượng `in-raw/` bị xóa.

**Given** video đạt kiểm tra
**When** xác nhận thành công
**Then** `CopyObject` sang `in/<userId>/<uuid>` với `CopySourceIfMatch` bằng ETag; ETag đổi thì từ chối
**And** lifecycle `in/` vẫn xóa sau 7 ngày.

**Given** image Docker của `nestjs-api`
**When** chạy CI
**Then** `ffprobe` có trong image và chạy được (không chỉ trong image của worker)
**And** kiểm tra này chạy trong cùng nhóm kiểm tra image với `ffmpeg -encoders`.

**Given** số `ffprobe` chạy đồng thời của tiến trình `api`
**When** nhiều yêu cầu xác nhận đến cùng lúc
**Then** tối đa 2 `ffprobe` chạy cùng lúc `[ASSUMPTION: giới hạn 2 do người viết story đề xuất để bảo vệ CPU của VPS]`, các yêu cầu còn lại chờ lượt
**And** route xác nhận chịu `@nestjs/throttler`.

**Given** người dùng B dùng khóa của người dùng A
**When** gọi `confirm`
**Then** bị từ chối.

**Given** test
**When** chạy
**Then** dùng bộ video mẫu nhỏ trong repo (MP4 hợp lệ, MOV hợp lệ, video quay dọc có metadata xoay, các trường hợp lỗi trên), và R2 được giả ở `StoragePort`.

### Story 5.3: [BE] Tạo Task Motion Control và tính giá phía server

**Phủ:** FR6, FR7, AR15

As a người dùng,
I want bấm một lần để tạo Task Motion Control với đoạn video tôi chọn,
So that tôi bị giữ đúng số credit bằng giá đã hiển thị và Task vào hàng đợi.

**Acceptance Criteria:**

**Given** pipeline `motion` được đăng ký trong cấu hình pipeline với giá lấy từ cấu hình giá phía server (50 credit mỗi giây, tối thiểu 3 giây) và workflow ID đọc từ `RUNNINGHUB_WORKFLOW_MOTION`
**When** khởi động
**Then** thiếu biến môi trường workflow ID thì tiến trình `api` và `worker` không khởi động và báo rõ biến nào thiếu.

**Given** người dùng đã đăng nhập, không bị khóa, một khóa ảnh `in/` và một khóa video `in/` hợp lệ của chính mình, `consent` đúng, `trimStart` và `trimEnd` là số nguyên
**When** gọi `POST /tasks/motion`
**Then** server tính `seconds = trimEnd − trimStart`, đối chiếu với `durationSeconds` đã lưu ở Story 5.2 (không tin giá trị client)
**And** giá = `motionPrice(seconds)`; HOLD đúng số này.

**Given** `trimStart < 0`, `trimEnd` vượt `durationSeconds` đã lưu, hoặc `seconds < 3`, hoặc giá trị không phải số nguyên
**When** gọi
**Then** nhận `VALIDATION_FAILED` với `details.reason` lần lượt `TRIM_OUT_OF_VIDEO`, `TRIM_OUT_OF_VIDEO`, `TRIM_TOO_SHORT`, `TRIM_NOT_WHOLE_SECOND`
**And** không HOLD, không tạo Task.

**Given** trong transaction do `tasks.create` mở
**When** `wallet.hold` trả Tier Snapshot
**Then** nếu `seconds` lớn hơn Cap của snapshot thì toàn bộ transaction rollback (HOLD bị hoàn tác) và trả `VALIDATION_FAILED` với `details.reason = TRIM_EXCEEDS_CAP` kèm `details.cap`
**And** sổ cái không có bút toán nào của yêu cầu này.

**Given** Cap theo Tier (FREE 5, Starter 10, Pro 15, Creator 20 giây)
**When** kiểm thử
**Then** FREE tạo được 5 giây (250 credit) và bị từ chối 6 giây; Starter bị từ chối 12 giây; Creator tạo được 20 giây (1.000 credit); 3 giây luôn là 150 credit.

**Given** Tier của người dùng đổi sau khi tải video (ví dụ rơi về FREE vì credit dưới 100)
**When** gọi `POST /tasks/motion`
**Then** Cap lấy từ Tier Snapshot tại thời điểm tạo Task, không từ Tier cũ.

**Given** số dư nhỏ hơn giá
**When** gọi
**Then** nhận `INSUFFICIENT_CREDIT`, không tạo Task.

**Given** `consent` sai, tài khoản bị khóa, hoặc đã có 3 Task `queued` hoặc `running`
**When** gọi
**Then** nhận lần lượt `CONSENT_REQUIRED`, `ACCOUNT_LOCKED`, `TASK_LIMIT`.

**Given** Task được tạo thành công
**When** lưu
**Then** `params` chứa `trimStart`, `trimEnd`, `seconds` và `price`, và `hold_amount` bằng `price`
**And** Task xếp vào hàng đợi chung theo Priority của Tier Snapshot như mọi pipeline.

**Given** test
**When** chạy
**Then** với mọi `seconds` từ 3 đến 20 giá HOLD bằng `motionPrice(seconds)`
**And** RunningHub được giả ở `RunningHubPort`.

### Story 5.4: [BE] Cắt video bằng ffmpeg ở bước chuẩn bị của worker

**Phủ:** FR6, AR15

As a hệ thống,
I want worker cắt đúng đoạn video người dùng chọn trước khi gửi lên RunningHub, mỗi lúc chỉ một ffmpeg,
So that video nhỏ, chính xác theo giây và VPS không bị nghẽn.

**Acceptance Criteria:**

**Given** cấu hình pipeline có thêm bước `prepare` tùy chọn chạy trong giai đoạn chuẩn bị, trước cổng đồng thời RunningHub
**When** worker nhận Task `motion`
**Then** chạy bước `prepare` của pipeline này; các pipeline Face Swap và Body Retouch không có bước này nên hành vi của chúng không đổi.

**Given** bước `prepare` của `motion`
**When** bắt đầu
**Then** lấy một khóa ffmpeg trong tiến trình worker rồi mới tải video `in/` từ R2 về thư mục tạm riêng của Task
**And** hàng chờ khóa theo thứ tự đến trước, Lane còn lại chờ khóa và thời gian chờ nằm trong `prep_deadline_at`.

**Given** hai Task `motion` chạy trên hai Lane
**When** chạy kiểm thử đồng thời
**Then** khoảng thời gian chạy của hai tiến trình ffmpeg không bao giờ chồng nhau.

**Given** khóa đã lấy
**When** cắt
**Then** ffmpeg dùng `-ss trimStart` và `-t seconds`, re-encode libx264 preset veryfast, chuẩn hóa 24 FPS, bỏ âm thanh `[ASSUMPTION: bỏ âm thanh vì workflow chỉ cần hình, người viết story đề xuất]`, chạy với `nice` thấp, mảng đối số cố định
**And** video quay dọc từ điện thoại có metadata xoay cho ra file đã xoay đúng chiều
**And** không đổi độ phân giải ở bước này `[ASSUMPTION: độ phân giải đầu ra 720p do workflow quyết định]`.

**Given** file cắt xong
**When** kiểm tra bằng `ffprobe`
**Then** có đúng một luồng video 24 FPS, độ dài bằng `seconds` ±0,5 giây
**And** sai lệch thì Task `failed` với `FFMPEG_ERROR` và RELEASED.

**Given** ffmpeg thoát lỗi
**When** xảy ra
**Then** Task `failed` với `FFMPEG_ERROR` và RELEASED
**And** tải video từ R2 thất bại sau 3 lần thử thì `failed` với `INPUT_FETCH_ERROR` và RELEASED.

**Given** thời gian chờ khóa, tải và cắt vượt `prep_deadline_at`
**When** xảy ra
**Then** Task `timed_out` với `PREP_TIMEOUT` và RELEASED qua `tasks.transition`
**And** `AbortSignal` kết thúc tiến trình ffmpeg ngay và xóa thư mục tạm.

**Given** dung lượng tạm
**When** chuẩn bị tải video về
**Then** thiếu chỗ trống (dưới 3 lần kích thước file đầu vào `[ASSUMPTION: hệ số 3 do người viết story đề xuất]`) thì `failed` với `INTERNAL_ERROR` và RELEASED
**And** thư mục tạm của Task bị xóa khi xong, khi lỗi và khi bị hủy, và worker xóa mọi thư mục tạm còn sót khi khởi động.

**Given** image Docker của worker
**When** chạy CI
**Then** `ffmpeg -encoders` có `libx264` và `ffprobe` chạy được.

**Given** story này
**When** xem tài liệu
**Then** ghi rõ việc đo tải CPU và đĩa thật trên VPS nằm ở bước kiểm thử ffmpeg của Epic 6.

### Story 5.5: [BE] Gửi Task Motion lên RunningHub

**Phủ:** FR5, AR10

As a hệ thống,
I want gửi ảnh nhân vật và đoạn video đã cắt lên workflow Motion rồi theo dõi đến khi xong,
So that video chuyển động được tạo mà không submit trùng và không bỏ rơi Task.

**Acceptance Criteria:**

**Given** cấu hình pipeline `motion` có workflow ID và ánh xạ tham số sang node (ảnh nhân vật, video mẫu đã cắt)
**When** worker qua được cổng đồng thời
**Then** `deadline_at` được ghi một lần bằng lúc bắt đầu tải input lên RunningHub cộng 360 giây
**And** thời gian chuẩn bị và cắt ffmpeg không nằm trong 360 giây này.

**Given** hai file cần tải
**When** upload lên RunningHub
**Then** tải ảnh nhân vật `in/` và đoạn video đã cắt, rồi dùng các định danh nhận về làm tham số node của workflow
**And** sau khi tải xong (hoặc khi thất bại) thư mục tạm của Task bị xóa.

**Given** worker khởi động lại giữa lúc đang chuẩn bị, tải input hoặc submit
**When** job được giao lại
**Then** hành vi khôi phục theo Story 2.5 áp dụng nguyên vẹn: bước chuẩn bị chạy lại nếu chưa có `deadline_at`, không bao giờ submit lại khi đã có `submit_started_at`.

**Given** workflow trả lỗi có tiền tố `NO_POSE` (node đầu tiên không thấy khung xương người ở frame đầu của đoạn đã cắt)
**When** worker nhận
**Then** Task `failed` với `NO_POSE` và RELEASED 100% qua `tasks.transition`
**And** FE hiển thị "Không nhận diện được chuyển động cơ thể trong video mẫu".

**Given** workflow trả lỗi có tiền tố `NO_FACE` cho ảnh nhân vật
**When** worker nhận
**Then** Task `failed` với `NO_FACE` và RELEASED 100%, thông báo theo pipeline `motion`
**And** việc workflow có báo cả hai tiền tố hay không còn phải xác nhận khi chạy benchmark `[ASSUMPTION]`.

**Given** Task `motion` quá 360 giây tính từ `deadline_at`
**When** bộ quét chạy (đồng hồ được tăng tốc trong test)
**Then** Task `timed_out` với `RH_TIMEOUT`, RELEASED, đặt `rh_orphan_until`, và kết quả đến muộn bị bỏ qua.

**Given** `consumeMoney` trả về
**When** Task kết thúc ở `SUCCESS` hoặc `FAILED`
**Then** lưu vào `gpu_coins`.

**Given** Task `motion` và Task ảnh cùng trong hàng đợi
**When** có Lane rảnh
**Then** tuân thủ Priority rồi FIFO, không quá 2 Task đồng thời, và Task `motion` giữ Lane của nó trong lúc chờ khóa ffmpeg.

### Story 5.6: [BE] Nhập kết quả video, ảnh bìa và chia sẻ

**Phủ:** FR7, AR11, NFR2

As a người dùng,
I want video kết quả được lưu về kho của hệ thống, kiểm tra và có ảnh bìa,
So that tôi tải về, xem và chia sẻ được, và credit chỉ bị chốt khi video đạt.

**Acceptance Criteria:**

**Given** RunningHub báo `SUCCESS` cho Task `motion`
**When** worker nhập kết quả
**Then** tải video về thư mục tạm, thử lại tối đa 3 lần trong `deadline_at`
**And** hết 3 lần thì `failed` với `OUTPUT_UPLOAD_ERROR` và RELEASED.

**Given** video đã tải về
**When** kiểm tra bằng `ffprobe` (dưới khóa ffmpeg)
**Then** có luồng video H.264, 24 FPS, cạnh ngắn 720 px (chấp nhận 1280×720 và 720×1280 `[ASSUMPTION: PRD ghi 1280x720; chấp nhận cả ảnh dọc, xác nhận bằng benchmark]`)
**And** độ dài bằng `seconds` ±0,5 giây.

**Given** độ dài lệch 0,4 giây
**When** chốt
**Then** Task `succeeded` và CAPTURED đúng số credit đã HOLD, không thu thêm, không hoàn phần lẻ.

**Given** độ dài lệch quá 0,5 giây, file rỗng hoặc không giải mã được
**When** kiểm tra
**Then** Task `failed` với `OUTPUT_INVALID` và RELEASED.

**Given** video đạt kiểm tra
**When** gắn nhãn
**Then** remux không re-encode, ghi thẻ metadata MP4 `comment = AI-Generated Content` và `software = AI Generator` `[ASSUMPTION: video dùng thẻ metadata MP4 thay cho EXIF, vì PRD chỉ nêu EXIF cho ảnh]`
**And** lỗi gắn nhãn thì Task `failed` với `FFMPEG_ERROR` và RELEASED.

**Given** video đã gắn nhãn
**When** tạo ảnh bìa
**Then** trích khung hình đầu thành JPEG, lưu `out/<userId>/<uuid>.jpg` cạnh video
**And** video lưu `out/<userId>/<uuid>.mp4` với `Content-Type: video/mp4`, hỗ trợ tải theo khoảng (range).

**Given** mọi bước thành công
**When** chốt
**Then** lưu `gpu_coins`, `finished_at` và chuyển `running→succeeded` kèm CAPTURED qua `tasks.transition`
**And** thư mục tạm bị xóa trong mọi trường hợp.

**Given** Task `motion` `succeeded` và người gọi là chủ Task
**When** gọi `GET /tasks/{id}/result`
**Then** nhận `mediaType = video`, `resultUrl` và `posterUrl` là URL ký ngắn hạn, `durationSeconds`, và `sourceUrl` rỗng
**And** người khác nhận lỗi không có quyền.

**Given** chủ Task tạo token chia sẻ theo Story 2.9
**When** gọi `GET /s/<token>`, `GET /s/<token>/info`, `GET /s/<token>/poster`
**Then** lần lượt chuyển hướng tới video, trả `mediaType` và `durationSeconds`, và chuyển hướng tới ảnh bìa
**And** token không tồn tại, đã thu hồi hoặc file đã bị xóa thì cả ba trả 404, không lộ thông tin Task
**And** ba route đều chịu `@nestjs/throttler`.

### Story 5.7: [FE] Tải video mẫu và thanh Trim

**Phủ:** FR6

As a người dùng,
I want chọn video mẫu, kéo thanh trượt chọn đoạn theo từng giây và xem trước đoạn đã chọn,
So that tôi chọn đúng đoạn chuyển động cần dùng.

**Acceptance Criteria:**

**Given** thành phần `VideoTrimmer` dùng chung logic tải lên với Story 2.10 (không sao chép mã)
**When** người dùng chọn file từ camera hoặc thư viện trên di động
**Then** kiểm tra phía client: MP4 hoặc MOV, ≤ 100 MB, độ dài đọc từ metadata ≥ 3 giây, lỗi hiển thị tiếng Việt
**And** hiển thị kích thước file và thanh tiến trình khi tải, có nút hủy khi đang tải và nút thử lại khi lỗi.

**Given** file hợp lệ
**When** chọn xong
**Then** tải lên ngay theo luồng `POST /uploads` → PUT → `confirm`, trong lúc người dùng vẫn chỉnh được thanh trượt
**And** xem trước đoạn đã chọn từ chính file trên máy bằng URL đối tượng cục bộ, phát lặp trong đoạn chọn, không phụ thuộc việc tải lên đã xong chưa
**And** URL đối tượng được thu hồi khi rời trang.

**Given** thanh chọn đoạn
**When** người dùng kéo
**Then** có hai tay cầm (bắt đầu và kết thúc), mọi giá trị là số giây nguyên, độ dài ≥ 3 giây và ≤ min(Cap của Tier, độ dài video làm tròn xuống)
**And** thao tác được bằng ngón tay (vùng chạm đủ lớn) và bằng bàn phím (mũi tên di chuyển 1 giây), có nhãn đọc màn hình.

**Given** `confirm` trả `durationSeconds` khác giá trị client đọc
**When** nhận phản hồi
**Then** FE dùng giá trị của server làm giới hạn trên và tự thu hẹp đoạn đã chọn nếu vượt.

**Given** video dài hơn Cap của Tier
**When** hiển thị
**Then** có dòng "Gói {tên} cho phép tối đa {cap} giây" kèm liên kết "Nâng cấp" tới `/topup`
**And** Cap lấy từ `GET /me` và `GET /config/pricing`, không hardcode.

**Given** thành phần hiển thị
**When** người dùng chọn đoạn
**Then** hiển thị rõ thời điểm bắt đầu, kết thúc và độ dài đã chọn
**And** phát ra sự kiện kèm `videoKey`, `trimStart`, `trimEnd` cho trang cha.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock (gồm lỗi tải, hủy, thử lại, video quay dọc) và ở viewport 360 px, không sửa file ngoài `apps/web`.

### Story 5.8: [FE] Trang Motion Control, giá trực tiếp và kết quả video

**Phủ:** FR5, FR7, NFR6

As a người dùng,
I want chọn ảnh và video, thấy giá cập nhật khi kéo thanh trượt, bấm một nút và nhận video,
So that tôi biết trước mình trả bao nhiêu và xem, tải, chia sẻ video kết quả.

**Acceptance Criteria:**

**Given** trang `/motion`
**When** mở
**Then** có thành phần tải ảnh nhân vật (Story 2.10), `VideoTrimmer` (Story 5.7) và nút "Tạo"
**And** mỗi lần tải ảnh hoặc video lên đều có ô cam kết ToS phải tích lại theo FR19.

**Given** người dùng kéo thanh trượt
**When** độ dài đổi
**Then** hiển thị giá `motionPrice(độ dài)` ngay lập tức bằng hàm trong `packages/contracts`, kèm số dư còn lại sau khi trừ
**And** giá hiển thị luôn bằng số credit mà server sẽ HOLD.

**Given** nút "Tạo"
**When** đánh giá điều kiện
**Then** bị vô hiệu khi chưa tải xong ảnh hoặc video, chưa tích cam kết, độ dài vượt Cap
**And** khi giá lớn hơn số dư, hiển thị thông báo ngữ cảnh thông minh: "Bạn đang có {balance} credit (cần {required} cr để tạo đoạn {duration}s). Nạp nhanh gói Starter 49k (+5.000 cr) nhé?" kèm nút mở Modal VietQR nạp nhanh tại chỗ mà không làm mất form nhập liệu (theo UX `mockups/studio.html` và `EXPERIENCE.md`)
**And** toàn bộ nút bấm, timeline trimmer và badge sử dụng vector icon Lucide (`lucide:clapperboard`, `lucide:zap`, `lucide:play`, `lucide:alert-circle`), không sử dụng emoji Unicode
**And** bấm hai lần liên tiếp chỉ gửi một yêu cầu `POST /tasks/motion`.

**Given** server trả `VALIDATION_FAILED` với `details.reason = TRIM_EXCEEDS_CAP` (Cap đã đổi sau khi tải video)
**When** FE nhận
**Then** gọi lại `GET /me` và `GET /config/pricing`, thu hẹp thanh trượt về Cap mới và hiển thị "Gói hiện tại của bạn cho phép tối đa {cap} giây".

**Given** các lỗi `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `PAUSED`, `CONSENT_REQUIRED` và các `details.reason` khác
**When** nhận khi tạo Task
**Then** hiển thị thông báo tiếng Việt tương ứng.

**Given** Task đã tạo
**When** ở `queued` hoặc `running`
**Then** dùng lại màn tiến trình của Story 2.11, hiển thị vị trí hàng đợi và dòng "Video thường mất vài phút, bạn có thể rời trang và quay lại từ Lịch sử"
**And** hủy được khi còn `queued`.

**Given** Task kết thúc `failed` hoặc `timed_out`
**When** FE nhận `reasonCode`
**Then** `NO_POSE` hiển thị "Không nhận diện được chuyển động cơ thể trong video mẫu", `NO_FACE` hiển thị thông báo của pipeline `motion`, các mã khác hiển thị thông báo chung "Xử lý thất bại"
**And** mọi trường hợp nêu rõ credit đã được hoàn.

**Given** Task `succeeded`
**When** mở trang kết quả
**Then** có trình phát video (`playsinline`, có nút điều khiển, ảnh bìa lấy từ `posterUrl`), nút "Tải về" file MP4, "Chia sẻ" và "Ngừng chia sẻ"
**And** không hiển thị thanh so sánh trước/sau.

**Given** danh sách Task của Story 2.12
**When** có Task video
**Then** thẻ Task hiển thị ảnh bìa và độ dài thay cho ảnh kết quả.

**Given** trang chia sẻ công khai của Story 2.13
**When** `GET /s/<token>/info` trả `mediaType = video`
**Then** trang hiển thị trình phát video thay cho ảnh
**And** thẻ Open Graph dùng `og:image` trỏ tới `GET /s/<token>/poster` và `og:video` trỏ tới `GET /s/<token>`.

**Given** trang chọn tính năng hoặc điều hướng chính
**When** hiển thị
**Then** có lối vào "Motion Control" cạnh Face Swap và Body Retouch.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock với mọi trạng thái Task và ở viewport 360 px, không sửa file ngoài `apps/web`.

### Story 5.9: [INTEGRATION] Nối FE với BE và smoke test Motion Control

**Phủ:** FR5, FR6, FR7

As a nhà phát triển,
I want tắt mock và chạy Motion Control từ đầu đến cuối với BE thật,
So that xác nhận tải video, cắt, giá, hàng đợi, ví và giao diện hoạt động cùng nhau.

**Acceptance Criteria:**

**Given** stack bốn container, FE ở chế độ `live`, RunningHub và R2 được giả, ffmpeg thật chạy trên video mẫu nhỏ
**When** chạy smoke test đường thành công với gói Creator, đoạn 10 giây
**Then** giá hiển thị 500 credit, số dư giảm 500 (HOLD) rồi CAPTURED, Task đi `queued → running → succeeded`, trang kết quả có trình phát video, ảnh bìa và nút tải về.

**Given** RunningHub giả trả lỗi `NO_POSE`
**When** chạy smoke test đường không có khung xương
**Then** Task `failed`, số dư trở lại, FE hiển thị "Không nhận diện được chuyển động cơ thể trong video mẫu".

**Given** người dùng gói Starter chọn đoạn 12 giây
**When** FE chặn và gọi API trực tiếp
**Then** nút "Tạo" bị vô hiệu ở FE, còn gọi API trực tiếp nhận `TRIM_EXCEEDS_CAP` kèm `cap` bằng 10 và sổ cái không có bút toán nào.

**Given** tài khoản FREE có 500 credit
**When** tạo một video 5 giây rồi thêm một video 5 giây nữa
**Then** cả hai thành công (250 credit mỗi lần) và lần thứ ba bị `INSUFFICIENT_CREDIT`.

**Given** hai Task `motion` được tạo cùng lúc
**When** worker chạy với 2 Lane
**Then** hai tiến trình ffmpeg không chạy chồng nhau và cả hai Task hoàn tất.

**Given** RunningHub giả không bao giờ trả kết quả
**When** quá 360 giây tính từ `deadline_at` (đồng hồ được tăng tốc)
**Then** Task `timed_out`, RELEASED, kết quả đến muộn bị bỏ qua, và thời gian ffmpeg không bị tính vào 360 giây.

**Given** video kết quả giả có độ dài lệch 0,4 giây rồi 0,6 giây so với đoạn đã chọn
**When** nhập kết quả
**Then** trường hợp 0,4 giây `succeeded` với CAPTURED đủ số credit, trường hợp 0,6 giây `failed` với `OUTPUT_INVALID` và RELEASED.

**Given** người dùng chia sẻ video kết quả
**When** mở `/share/<token>` không đăng nhập
**Then** thấy trình phát video và thẻ Open Graph có `og:image` là ảnh bìa; sau khi thu hồi, ba đường dẫn `/s/<token>` trả 404.

**Given** thư mục tạm của worker
**When** kết thúc mọi smoke test
**Then** không còn thư mục tạm nào của Task.

**Given** job đối soát sổ cái
**When** chạy sau các smoke test
**Then** không báo lệch.

**Given** test hợp đồng ở CI
**When** chạy
**Then** phản hồi của mock và của BE thật đều khớp schema trong `packages/contracts`.

**Given** README
**When** cập nhật
**Then** ghi cách chạy smoke test và nhắc rằng tải CPU, đĩa của ffmpeg trên VPS 4 vCPU, hành vi thật của workflow Motion (tiền tố lỗi, độ phân giải đầu ra) và SLA xử lý video được đo ở benchmark Epic 6.

## Epic 6: Vận hành an toàn, tuân thủ và cổng mở bán

Admin được bảo vệ ngân sách GPU và có công cụ xử lý vi phạm; hệ thống sẵn sàng bật VietQR thương mại sau khi qua các bước kiểm thử bắt buộc. Epic này cần Epic 1–3 (adapter Discord ở Story 3.4, dịch vụ `audit` và route Admin ở Story 3.5, giao diện Admin ở Story 3.7); riêng story cổng mở bán (6.11) cần thêm Epic 4–5.

**Thứ tự và hai luồng:** 6.1 làm trước, rồi hai luồng rẽ nhánh. BE: 6.2 → 6.3 → 6.4 → 6.5 → 6.6 → 6.7. FE (chạy trên mock): 6.8 → 6.9. Story 6.10 chỉ bắt đầu khi cả hai luồng xong. Story 6.11 làm cuối cùng, chạy trên hệ thống đã nối ghép và có người vận hành thật tham gia.

**Lưu ý chung:**

- Các route tạo Task của Epic 2, 4, 5 chưa kiểm cờ `intake_paused` và worker chưa kiểm cờ `rh_budget_exhausted`. Epic này thêm một guard dùng chung gắn vào các route đã có (không viết lại các epic trước), nên trước khi Epic 6 xong thì ngắt mạch chưa có tác dụng. Điều này chấp nhận được vì chưa mở bán trước đó.
- Báo cáo vi phạm (FR22) chỉ dùng liên kết `mailto:` ở chân trang; không có form và không có bảng báo cáo. Admin nhận email rồi dùng chức năng gỡ bỏ ở Story 6.5.
- Hệ thống ticket hỗ trợ nằm ngoài MVP (PRD §7.2); khiếu nại về chất lượng được Admin xử lý thủ công bằng bút toán `ADJUST` (Story 6.4).
- Cảnh báo Discord tính theo thay đổi trạng thái (gửi khi chuyển trạng thái), không gửi lặp khi trạng thái giữ nguyên. Gửi thất bại thì thử lại ở chu kỳ quét sau, tối đa 5 lần, như Story 3.4.
- Bảng `settings` (khóa/giá trị) tạo ở 6.2; cột `request_id` của `admin_audit` thêm ở 6.4; cột `files_removed_at` của `tasks` thêm ở 6.5.
- Lập lịch theo múi giờ `Asia/Ho_Chi_Minh`.

### Story 6.1: [CONTRACT] Hợp đồng cho vận hành và quản trị

**Phủ:** FR16, FR18, FR21, FR22

As a nhà phát triển của luồng BE và FE,
I want `packages/contracts` có endpoint, schema và dữ liệu mock cho trạng thái hệ thống, thống kê, quản lý tài khoản và gỡ bỏ,
So that hai luồng thống nhất hình dạng API trước khi viết mã Epic 6.

**Acceptance Criteria:**

**Given** `packages/contracts`
**When** build gói
**Then** định nghĩa `GET /system/status` (công khai, chỉ trả `intakePaused` kiểu boolean, không trả lý do hay số liệu nào)
**And** định nghĩa `GET /admin/ops/status` (cờ `intakePaused` và `rhBudgetExhausted`, `lastBreakerTrigger` gồm thời điểm, quy tắc kích hoạt và số liệu, `rhBalance` gồm số coin và thời điểm đọc, `lastBackup` gồm thời điểm, kết quả và dung lượng) và `POST /admin/ops/resume`.

**Given** các endpoint Admin khác
**When** đọc hợp đồng
**Then** định nghĩa `GET /admin/stats` (tham số `from`, `to`, `scope` thuộc `real` hoặc `benchmark`, và tùy chọn `motionPricePerSecond`, `imagePrice` để tính thử), `GET /admin/audit` (lọc theo `action` và `target`, phân trang)
**And** `GET /admin/users?email=`, `GET /admin/users/{id}`, `GET /admin/users/{id}/ledger` (phân trang), `POST /admin/users/{id}/lock` và `/unlock` (`reason`), `POST /admin/users/{id}/adjust` (`amount`, `reason`, `requestId`)
**And** `GET /admin/tasks/lookup` (nhận `taskId` hoặc `shareUrl`) và `POST /admin/tasks/{id}/takedown` (`reason`).

**Given** lỗi `VALIDATION_FAILED`
**When** đọc hợp đồng
**Then** `details.reason` có thêm `REASON_REQUIRED`, `TASK_NOT_FINISHED`, `ADJUST_OVER_LIMIT`, `ADJUST_INSUFFICIENT_BALANCE`
**And** `ApiErrorCode` không thêm giá trị mới.

**Given** hình dạng Task trả cho người dùng
**When** đọc hợp đồng
**Then** `GET /tasks/{id}` có thêm `filesRemovedAt` (có thể rỗng)
**And** thông báo tiếng Việt cho trạng thái này là "Nội dung đã bị gỡ do vi phạm hoặc theo yêu cầu".

**Given** hình dạng thống kê
**When** đọc hợp đồng
**Then** gồm số Task theo pipeline và trạng thái, tỷ lệ thành công, thời gian xử lý trung bình và phân vị 95, `gpuCoins` trung bình, tổng `gpuCoins` của Task không thành công, chi phí quy ra VNĐ và biên gộp theo gói trong hai kịch bản nạp lẻ và nạp gói chuẩn, số đơn nạp được duyệt và tỷ lệ chuyển đổi theo định nghĩa SM-1.

**Given** dữ liệu mock
**When** chạy test hợp đồng
**Then** mock cho trạng thái hệ thống bình thường, tạm dừng, hết ngân sách, thống kê, tìm kiếm tài khoản và tìm kiếm Task đều khớp schema.

### Story 6.2: [BE] Ngắt mạch và chặn tạo Task khi tạm dừng

**Phủ:** FR18, AR18, NFR7

As a Admin,
I want hệ thống tự tạm dừng nhận Task mới khi tỷ lệ lỗi hệ thống cao,
So that GPU không bị đốt vào các Task chắc chắn lỗi và khách không mất credit oan.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** có bảng `settings` (khóa duy nhất, giá trị JSON, thời điểm cập nhật) với các khóa `intake_paused`, `rh_budget_exhausted`, `breaker_reset_at`, `last_breaker_trigger`
**And** chỉ module `ops` ghi bảng này.

**Given** mọi chuyển trạng thái kết thúc của Task
**When** `tasks.transition` chạy
**Then** cột `finished_at` được đặt trong cùng câu UPDATE nếu chưa có
**And** có test kiểm tra điều này cho cả sáu đường kết thúc (`succeeded`, `failed`, `timed_out`, `cancelled` và hai biến thể lỗi).

**Given** `ops` cần đếm Task
**When** tính tỷ lệ lỗi
**Then** `ops` gọi một hàm của service `tasks`, không đọc bảng `tasks` trực tiếp.

**Given** lỗi hệ thống gồm Task `failed` hoặc `timed_out` với `reasonCode` thuộc `RH_ERROR`, `RH_TIMEOUT`, `RH_SUBMIT_UNKNOWN`, `PREP_TIMEOUT`, `FFMPEG_ERROR`, `INPUT_FETCH_ERROR`, `OUTPUT_UPLOAD_ERROR`, `OUTPUT_INVALID`, `INTERNAL_ERROR`
**When** tính mẫu số
**Then** mẫu số là mọi Task đã kết thúc trong cửa sổ trượt 30 phút trừ các lý do `NO_POSE`, `NO_FACE`, `CONTENT_BLOCKED`, `USER_CANCEL`, `FREE_WAIT_EXPIRED`, `RH_BUDGET`, `RH_GATE_TIMEOUT`
**And** chỉ tính Task kết thúc sau `breaker_reset_at`.

**Given** 20 Task đủ điều kiện trong cửa sổ, trong đó 4 lỗi hệ thống (20%)
**When** Task thứ 20 kết thúc
**Then** `intake_paused` được đặt thành bật và `last_breaker_trigger` ghi thời điểm, quy tắc và số liệu
**And** với 3 lỗi trên 20 (đúng 15%) thì không kích hoạt, vì quy tắc là vượt 15%.

**Given** chưa đủ 20 Task trong cửa sổ
**When** có 5 lỗi hệ thống liên tiếp
**Then** vẫn kích hoạt; một Task `succeeded` cắt chuỗi; các Task có lý do loại trừ không cắt chuỗi và không được đếm.

**Given** 30 Task liên tiếp kết thúc với `NO_POSE` hoặc `CONTENT_BLOCKED`
**When** đánh giá
**Then** ngắt mạch không kích hoạt.

**Given** ngắt mạch kích hoạt
**When** chuyển trạng thái
**Then** gửi đúng một cảnh báo Discord nêu quy tắc, tỷ lệ và số lượng, không chứa email hay token
**And** khi đã tạm dừng thì các Task kết thúc sau không gửi thêm cảnh báo.

**Given** việc đánh giá ngắt mạch
**When** chạy
**Then** chạy sau mỗi lần Task kết thúc (tin hiệu phát ra sau khi commit) và bộ quét 30 giây cũng đánh giá lại, nên mất tín hiệu không làm mất kích hoạt.

**Given** guard `intake-open` dùng chung
**When** gắn vào các route `POST /tasks/face-swap`, `POST /tasks/body-retouch`, `POST /tasks/motion`
**Then** khi `intake_paused` bật, ba route trả 503 với `code = PAUSED` và không HOLD, không tạo Task
**And** các route đăng nhập, nạp tiền, lịch sử, đọc Task, tải kết quả, hủy Task và chia sẻ không bị chặn.

**Given** một test duyệt danh sách route
**When** chạy ở CI
**Then** test fail nếu có route nào đánh dấu "tạo Task" mà thiếu guard, nên pipeline thêm sau không thể bỏ sót.

**Given** `POST /admin/ops/resume`
**When** Admin gọi
**Then** trong một thao tác: tắt cả `intake_paused` lẫn `rh_budget_exhausted`, đặt `breaker_reset_at` = bây giờ, ghi `admin_audit`
**And** các Task lỗi trước thời điểm này không làm ngắt mạch kích hoạt lại ngay
**And** người dùng role `user` gọi nhận 403.

**Given** `GET /system/status` và `GET /admin/ops/status`
**When** gọi
**Then** trả đúng theo hợp đồng, bản công khai chỉ có boolean.

### Story 6.3: [BE] Xử lý hết ngân sách RunningHub và cảnh báo số dư

**Phủ:** FR18, AR18, AR23

As a Admin,
I want hệ thống tự dừng và hoàn credit khi RunningHub hết tiền, và báo trước khi cạn,
So that khách không mất credit oan và tôi kịp nạp ví.

**Acceptance Criteria:**

**Given** RunningHub từ chối vì hết tiền (nhận diện bằng danh sách ánh xạ cấu hình của Story 2.5)
**When** worker nhận lỗi
**Then** Task đó `failed` với `RH_BUDGET` và RELEASED qua `tasks.transition`
**And** đặt cả `rh_budget_exhausted` và `intake_paused`, và gửi đúng một cảnh báo Discord.

**Given** cờ `rh_budget_exhausted` bật
**When** worker nhận một job
**Then** ngay sau CAS `queued→running` và trước bước `prepare` hay mọi lệnh gọi RunningHub, Task `failed` với `RH_BUDGET` và RELEASED
**And** test xác nhận không có tiến trình ffmpeg nào được chạy và không có lần tải nào lên RunningHub.

**Given** các Task đang `running` lúc cờ được đặt
**When** chúng tiếp tục
**Then** vẫn poll bình thường; chỉ Task nào bị RunningHub từ chối mới `failed` với `RH_BUDGET`.

**Given** cờ bật
**When** người dùng nạp credit, đăng nhập, xem lịch sử hoặc tải kết quả đã có
**Then** các thao tác này hoạt động bình thường.

**Given** `RunningHubPort.getBalance()` và job `@nestjs/schedule` chạy mỗi 10 phút `[ASSUMPTION: chu kỳ 10 phút do người viết story đề xuất]`
**When** đọc được số dư
**Then** lưu vào `settings` kèm thời điểm đọc
**And** số dư dưới ngưỡng `RH_BALANCE_ALERT_COINS` thì gửi đúng một cảnh báo Discord, và chỉ gửi lại sau khi số dư đã lên trên ngưỡng rồi giảm xuống lần nữa.

**Given** ngưỡng USD 15
**When** cấu hình
**Then** mặc định `RH_BALANCE_ALERT_COINS` = 27.000 coin, quy đổi theo giá nạp lẻ 18.000 coin = USD 10 `[ASSUMPTION: cần xác nhận lại theo gói nạp thật của tài khoản RunningHub]`.

**Given** đọc số dư thất bại 3 lần liên tiếp
**When** xảy ra
**Then** gửi một cảnh báo Discord "Không đọc được số dư RunningHub" và chỉ gửi lại sau khi một lần đọc thành công
**And** việc này không bật `intake_paused`.

**Given** endpoint số dư của RunningHub chưa xác nhận
**When** viết story
**Then** `RunningHubPort.getBalance()` có adapter giả dùng trong test; adapter thật đọc đường dẫn endpoint từ cấu hình `RH_BALANCE_ENDPOINT` (chưa có giá trị) và được điền khi người vận hành xác nhận endpoint ở bước kiểm thử cuối epic
**And** adapter thật chưa có thì job báo lỗi đọc số dư theo quy tắc trên thay vì sập.

**Given** `POST /admin/ops/resume` (Story 6.2) được gọi khi ví RunningHub vẫn chưa nạp
**When** Task đầu tiên bị từ chối vì hết tiền
**Then** cờ bật lại và cảnh báo Discord lại được gửi (vì trạng thái đã đổi từ tắt sang bật).

### Story 6.4: [BE] Khóa tài khoản và cộng bù credit

**Phủ:** FR16, FR21

As a Admin,
I want khóa tài khoản vi phạm và cộng hoặc trừ bù credit khi cần,
So that tôi xử lý vi phạm và khiếu nại ngay trong hệ thống với đầy đủ dấu vết.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** bảng `admin_audit` có thêm cột `request_id` duy nhất cho phép null.

**Given** `GET /admin/users?email=`
**When** Admin gọi
**Then** trả id, email, role, Tier, `balance`, `held`, `locked_at`; không tìm thấy trả 404
**And** `GET /admin/users/{id}/ledger` trả sổ cái của người đó, phân trang, mới nhất trước.

**Given** Admin gọi `POST /admin/users/{id}/lock` kèm `reason`
**When** thành công
**Then** đặt `locked_at`, thu hồi toàn bộ refresh token của người đó và ghi `admin_audit` (ai, khi nào, lý do, trước/sau)
**And** thiếu `reason` thì nhận `VALIDATION_FAILED` với `details.reason = REASON_REQUIRED`.

**Given** access JWT cấp trước khi khóa vẫn còn hạn
**When** người đó gọi route ghi ngay sau khi bị khóa
**Then** nhận 403 `ACCOUNT_LOCKED`, vì guard đọc `locked_at` từ CSDL chứ không từ JWT.

**Given** người dùng bị khóa có Task `queued` hoặc `running`
**When** xảy ra
**Then** các Task đó vẫn được xử lý và kết thúc bình thường (credit nhất quán) `[ASSUMPTION: không tự hủy Task đang chờ của tài khoản bị khóa; Admin dùng chức năng gỡ bỏ nội dung của epic này nếu cần xóa nội dung]`
**And** không thể tạo Task mới, đơn nạp mới hay chia sẻ mới.

**Given** `POST /admin/users/{id}/unlock` kèm `reason`
**When** gọi
**Then** xóa `locked_at` và ghi `admin_audit`; người dùng đăng nhập lại được.

**Given** `wallet.adjust(tx, userId, amount)` được thêm ở story này (loại `ADJUST` đã có trong sổ cái từ AD-2)
**When** Admin gọi `POST /admin/users/{id}/adjust` với `amount` là số nguyên khác 0, `reason` và `requestId`
**Then** `auth`/`admin` mở `tx`, `wallet.adjust` ghi bút toán `ADJUST` mang dấu của `amount`, tăng hoặc giảm `balance`, tính lại Tier trong cùng transaction, và ghi `admin_audit` kèm lý do, `taskId` tham chiếu nếu có và số dư trước/sau
**And** bút toán `ADJUST` có `task_id` rỗng nên không vi phạm ràng buộc một HOLD và một bút toán kết thúc mỗi Task.

**Given** `requestId` đã dùng trước đó
**When** gọi lại (ví dụ bấm hai lần)
**Then** trả lại kết quả của lần đầu và không ghi bút toán thứ hai.

**Given** `|amount|` vượt `ADMIN_ADJUST_MAX` (mặc định 30.000 credit, bằng gói lớn nhất `[ASSUMPTION]`)
**When** gọi
**Then** nhận `VALIDATION_FAILED` với `details.reason = ADJUST_OVER_LIMIT`.

**Given** `amount` âm làm `balance` âm
**When** gọi
**Then** nhận `VALIDATION_FAILED` với `details.reason = ADJUST_INSUFFICIENT_BALANCE` và không ghi gì.

**Given** chính sách chất lượng của FR16
**When** kiểm thử
**Then** không có đường mã nào tự RELEASED một Task đã `succeeded`; việc bù credit cho kết quả xấu chỉ đi qua `adjust` do Admin thực hiện.

**Given** mọi route `/admin/**` của story này
**When** người dùng role `user` hoặc chưa đăng nhập gọi
**Then** nhận 403 hoặc 401.

**Given** nhật ký
**When** xem mã nguồn
**Then** không có đường xóa hay sửa bản ghi `admin_audit`, và Task cùng sổ cái của tài khoản bị khóa được giữ nguyên để điều tra.

### Story 6.5: [BE] Gỡ bỏ nội dung khẩn cấp

**Phủ:** FR22

As a Admin,
I want tìm một Task qua liên kết chia sẻ hoặc mã Task và gỡ toàn bộ nội dung của nó ngay,
So that tôi xử lý khiếu nại bản quyền hoặc hình ảnh cá nhân trong vài phút.

**Acceptance Criteria:**

**Given** migration của story này
**When** chạy
**Then** bảng `tasks` có thêm cột `files_removed_at`, do module `tasks` ghi.

**Given** `GET /admin/tasks/lookup` nhận `taskId` hoặc `shareUrl`
**When** Admin gọi
**Then** với `shareUrl` server tách token, băm rồi tìm Task tương ứng (token gốc không được lưu)
**And** trả chủ Task, pipeline, trạng thái, thời gian tạo, còn hay đã gỡ file, các token chia sẻ còn hiệu lực; không tìm thấy trả 404.

**Given** Task đã kết thúc và Admin gọi `POST /admin/tasks/{id}/takedown` kèm `reason`
**When** thành công
**Then** thao tác do `storage` điều phối: thu hồi mọi token chia sẻ của Task trước, rồi xóa trên R2 các khóa kết quả `out/` (kể cả ảnh bìa của video) và các khóa đầu vào `in/` của Task, rồi gọi `tasks` đặt `files_removed_at`
**And** ghi `admin_audit` (ai, khi nào, Task, số đối tượng đã xóa, lý do).

**Given** Task `queued` hoặc `running`
**When** gọi `takedown`
**Then** nhận `VALIDATION_FAILED` với `details.reason = TASK_NOT_FINISHED`.

**Given** thiếu `reason`
**When** gọi
**Then** nhận `VALIDATION_FAILED` với `details.reason = REASON_REQUIRED`.

**Given** Task đã gỡ
**When** gọi `GET /s/<token>`, `GET /s/<token>/info`, `GET /s/<token>/poster`
**Then** cả ba trả 404, không lộ thông tin nào về Task
**And** các URL ký đã phát hành trước đó cũng ngừng hoạt động vì đối tượng đã bị xóa.

**Given** chủ Task gọi `GET /tasks/{id}` và `GET /tasks/{id}/result` sau khi gỡ
**When** xem
**Then** `filesRemovedAt` có giá trị và `result` trả lỗi tương ứng thay vì URL; sổ cái và trạng thái Task không đổi (không tự hoàn credit).

**Given** xóa một số đối tượng trên R2 thất bại
**When** xảy ra
**Then** token đã bị thu hồi và liên kết chia sẻ đã chết ngay
**And** phản hồi liệt kê khóa chưa xóa được, `files_removed_at` chưa đặt, và gọi lại `takedown` xóa tiếp phần còn lại mà không ghi trùng `admin_audit` cho phần đã xóa.

**Given** gọi `takedown` lần nữa trên Task đã gỡ xong
**When** xảy ra
**Then** trả thành công không đổi gì và không ghi thêm nhật ký.

**Given** test
**When** chạy
**Then** R2 được giả ở `StoragePort`, và các route `/admin/**` từ chối người dùng role `user`.

### Story 6.6: [BE] Thống kê vận hành và nhật ký Admin

**Phủ:** NFR7

As a Admin,
I want xem tỷ lệ thành công, thời gian xử lý, chi phí GPU và biên lợi nhuận,
So that tôi biết hệ thống có đạt các chỉ số thành công và có lời không.

**Acceptance Criteria:**

**Given** `GET /admin/stats` với khoảng thời gian
**When** Admin gọi
**Then** trả theo từng pipeline: số Task theo trạng thái, tỷ lệ thành công (thành công trên mẫu số của ngắt mạch ở Story 6.2), thời gian xử lý trung bình và phân vị 95 tính từ `running_at` đến `finished_at`, và `gpu_coins` trung bình của Task thành công
**And** tổng `gpu_coins` của Task không thành công, gọi là chi phí lãng phí.

**Given** cấu hình `USD_VND` (mặc định 25.000 `[ASSUMPTION: PRD §11 làm tròn hơi khác]`) và `RH_COINS_PER_USD` theo hai kịch bản: nạp lẻ 1.800 và gói chuẩn 3.600
**When** tính chi phí
**Then** trả chi phí VNĐ trung bình mỗi Task theo cả hai kịch bản.

**Given** doanh thu mỗi 100 credit của từng gói (Starter 980, Pro 825, Creator 663 VNĐ, tính từ bảng giá cấu hình)
**When** tính biên gộp
**Then** trả biên gộp mỗi pipeline theo từng gói và từng kịch bản nạp, theo công thức (doanh thu − chi phí) / doanh thu, trong đó Motion tính theo mỗi giây video
**And** có tham số tùy chọn `motionPricePerSecond` và `imagePrice` để tính lại như thể đổi giá, không thay đổi giá thật.

**Given** các chỉ số thành công của PRD
**When** gọi
**Then** trả tỷ lệ Task thành công (SM-3), tổng chi phí GPU quy ra USD so với trần 50–100 (SM-4), số đơn nạp được duyệt và tỷ lệ chuyển đổi với mẫu số là tài khoản đã tạo ít nhất một Task, tử số là tài khoản đó có đơn nạp được duyệt trong 30 ngày kể từ ngày đăng ký (SM-1, SM-2).

**Given** biến môi trường `BENCHMARK_USER_EMAILS`
**When** `scope = real` (mặc định)
**Then** loại Task, đơn nạp và tài khoản của các email này khỏi mọi chỉ số
**And** `scope = benchmark` chỉ tính chính các tài khoản đó.

**Given** `GET /admin/audit`
**When** Admin gọi
**Then** trả `admin_audit` mới nhất trước, lọc được theo `action` và `target`, phân trang.

**Given** log của `api` và `worker`
**When** xử lý một Task
**Then** mỗi dòng log là JSON có `taskId` và `userId`, và không chứa email, token hay khóa bí mật (NFR7)
**And** có test xác nhận điều này.

**Given** truy vấn thống kê
**When** chạy trên 10.000 Task thử
**Then** trả trong dưới 2 giây `[ASSUMPTION: ngưỡng do người viết story đề xuất]`, truy vấn đọc qua service `tasks`, `wallet`, `topups`, không đọc bảng của module khác.

**Given** người dùng role `user`
**When** gọi các route này
**Then** nhận 403.

### Story 6.7: [BE] Sao lưu PostgreSQL lên R2

**Phủ:** AR22

As a Admin,
I want cơ sở dữ liệu được sao lưu mỗi đêm lên R2 và khôi phục được,
So that sự cố VPS không làm mất sổ cái và đơn nạp.

**Acceptance Criteria:**

**Given** image của `nestjs-worker`
**When** build
**Then** có `postgresql-client-16`, và CI chạy `pg_dump --version` để xác nhận
**And** không thêm container nào; vẫn đúng bốn container.

**Given** job `@nestjs/schedule` lúc 03:00 giờ Việt Nam, chạy chỉ trong tiến trình `worker`
**When** chạy
**Then** chạy `pg_dump` định dạng custom bằng mảng đối số cố định, mật khẩu truyền qua biến môi trường chứ không qua tham số dòng lệnh
**And** ghi ra thư mục tạm riêng rồi xóa thư mục này trong mọi trường hợp.

**Given** file dump đã tạo
**When** kiểm tra trước khi tải lên
**Then** `pg_restore --list` thoát thành công và file không rỗng
**And** thất bại thì không tải lên và không xóa bản cũ nào.

**Given** kiểm tra đạt
**When** tải lên
**Then** `@aws-sdk/client-s3` ghi vào khóa `db-backup/<ngày-giờ>.dump`, rồi `HEAD` xác nhận kích thước khớp file local `[ASSUMPTION: dump nhỏ hơn 5 GB nên một lần PutObject đủ cho MVP]`
**And** sau khi xác nhận mới giữ lại 7 bản mới nhất và xóa phần còn lại.

**Given** tiền tố `db-backup/`
**When** cấu hình bucket
**Then** các quy tắc lifecycle của `in-raw/`, `in/`, `out/` không áp dụng cho tiền tố này
**And** ghi vào tài liệu rằng mã hóa phía ứng dụng và khóa R2 riêng cho sao lưu nằm ngoài MVP (R2 mã hóa lưu trữ mặc định).

**Given** bất kỳ bước nào thất bại
**When** xảy ra
**Then** gửi một cảnh báo Discord nêu bước lỗi, không chứa mật khẩu hay đường dẫn kết nối
**And** `settings` ghi `last_backup` gồm thời điểm, kết quả và dung lượng.

**Given** không có lần sao lưu thành công nào trong 36 giờ qua `[ASSUMPTION: ngưỡng 36 giờ do người viết story đề xuất]`
**When** bộ quét 30 giây kiểm tra
**Then** gửi đúng một cảnh báo "Quá 36 giờ chưa có bản sao lưu" (để phát hiện cả trường hợp job không chạy)
**And** chỉ gửi lại sau khi có một bản thành công rồi lại quá hạn.

**Given** `deploy/RESTORE.md` và script `scripts/restore-drill`
**When** chạy trên một PostgreSQL trống
**Then** tải bản mới nhất từ R2, khôi phục vào cơ sở dữ liệu tạm, chạy kiểm tra `balance = SUM(amount)` và `held` khớp sổ cái, rồi báo đạt hoặc lỗi và thời gian khôi phục
**And** CI chạy script này trên một dump nhỏ.

**Given** Redis không được sao lưu
**When** mô tả cách dựng lại
**Then** `RESTORE.md` ghi rằng sau khi khôi phục PostgreSQL, bộ quét của Story 2.7 dựng lại hàng đợi từ trạng thái Task.

### Story 6.8: [FE] Trang vận hành Admin

**Phủ:** FR16, FR18, FR21, FR22

As a Admin,
I want một màn hình xem trạng thái hệ thống, mở lại nhận Task, xem thống kê và xử lý tài khoản, nội dung,
So that tôi xử lý sự cố và vi phạm mà không cần chạm vào cơ sở dữ liệu.

**Acceptance Criteria:**

**Given** người dùng role `user` hoặc chưa đăng nhập
**When** mở `/admin/ops`
**Then** FE chuyển về đăng nhập hoặc hiển thị trang 403, không lộ dữ liệu nào.

**Given** Admin mở `/admin/ops`
**When** tải xong
**Then** thấy thẻ trạng thái: `intake_paused`, `rh_budget_exhausted`, lần kích hoạt gần nhất (thời điểm, quy tắc, số liệu), số dư RunningHub và thời điểm đọc, lần sao lưu gần nhất và kết quả
**And** số liệu làm mới định kỳ; thẻ nào quá cũ có nhãn cảnh báo.

**Given** có ít nhất một cờ đang bật
**When** Admin bấm "Mở lại nhận Task"
**Then** hộp xác nhận nêu rõ rằng nếu ví RunningHub chưa nạp thì Task sẽ lại thất bại nhanh, kèm số dư lần đọc cuối
**And** xác nhận mới gọi `POST /admin/ops/resume`; không có cờ nào bật thì nút bị vô hiệu.

**Given** khối thống kê
**When** Admin chọn khoảng thời gian và phạm vi `real` hay `benchmark`
**Then** hiển thị bảng theo pipeline (số Task, tỷ lệ thành công, thời gian xử lý, chi phí), bảng biên gộp theo gói và kịch bản nạp, và các chỉ số SM-1 đến SM-4
**And** ô nhập giá thử cho phép tính lại biên gộp mà không đổi giá thật.

**Given** khối tài khoản
**When** Admin tìm theo email
**Then** thấy Tier, số dư, `held`, trạng thái khóa và sổ cái gần nhất
**And** có hành động Khóa và Mở khóa (bắt buộc nhập lý do), và Cộng/Trừ bù credit (số nguyên có dấu, bắt buộc lý do, hộp xác nhận nêu số dư trước và sau, `requestId` sinh một lần khi mở form để bấm hai lần không cộng hai lần).

**Given** khối gỡ bỏ nội dung
**When** Admin dán liên kết chia sẻ hoặc mã Task
**Then** thấy thông tin Task, chủ Task và các token còn hiệu lực
**And** nút "Gỡ bỏ ngay" bắt buộc nhập lý do và có hộp xác nhận; Task chưa kết thúc thì nút bị vô hiệu kèm giải thích.

**Given** khối nhật ký
**When** Admin mở
**Then** thấy danh sách `admin_audit` mới nhất trước, lọc được, tải thêm khi cuộn.

**Given** các lỗi `VALIDATION_FAILED` với `details.reason` mới (`REASON_REQUIRED`, `TASK_NOT_FINISHED`, `ADJUST_OVER_LIMIT`, `ADJUST_INSUFFICIENT_BALANCE`)
**When** FE nhận
**Then** hiển thị thông báo tiếng Việt tương ứng.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock (gồm trạng thái tạm dừng, hết ngân sách, lỗi từng thao tác) và dùng được ở viewport 360 px, không sửa file ngoài `apps/web`.

### Story 6.9: [FE] Chân trang, trang pháp lý và biểu ngữ bảo trì

**Phủ:** FR19, FR22

As a người dùng,
I want thấy điều khoản, chính sách và cách báo cáo vi phạm ở mọi trang, và được báo khi hệ thống tạm dừng nhận tác vụ,
So that tôi biết quyền và nghĩa vụ của mình và không mất công tải file rồi mới bị từ chối.

**Acceptance Criteria:**

**Given** layout chung của ứng dụng
**When** hiển thị bất kỳ trang nào
**Then** chân trang có liên kết "Điều khoản dịch vụ" (`/terms`), "Chính sách quyền riêng tư" (`/privacy`) và "Báo cáo vi phạm"
**And** chân trang không che nội dung ở viewport 360 px.

**Given** liên kết "Báo cáo vi phạm"
**When** bấm
**Then** mở `mailto:` tới địa chỉ cấu hình bằng biến môi trường công khai `NUXT_PUBLIC_REPORT_EMAIL`, với tiêu đề và nội dung soạn sẵn hướng dẫn nêu liên kết hoặc mã Task cùng lý do
**And** không chèn bất kỳ dữ liệu người dùng nào vào email soạn sẵn.

**Given** build production
**When** thiếu `NUXT_PUBLIC_REPORT_EMAIL`
**Then** build fail với thông báo nêu rõ biến thiếu.

**Given** `/terms` và `/privacy` dựng tĩnh từ file nội dung trong `apps/web`, mỗi file có `version` và `status` (`draft` hoặc `final`)
**When** `status` là `draft`
**Then** trang hiển thị biểu ngữ "Văn bản tạm, chưa có hiệu lực pháp lý"
**And** nội dung tạm của `/terms` gồm đủ các mục: cam kết quyền sở hữu hình ảnh, người trong ảnh đủ 18 tuổi và đã đồng ý, nghiêm cấm nội dung liên quan người dưới 18 tuổi, bôi nhọ nhân phẩm và nội dung khiêu dâm không đồng thuận, vai trò công cụ trung gian và miễn trừ trách nhiệm `[ASSUMPTION: văn bản mẫu do người viết story soạn, PM thay bằng văn bản đã qua tư vấn pháp lý; phần bổ sung về độ tuổi 18 và quyền sử dụng hình ảnh (FR19) vẫn chờ PM]`.

**Given** nội dung tạm của `/privacy`
**When** soạn
**Then** nêu dữ liệu thu thập (email, giá trị băm của IP và thiết bị, ảnh và video tải lên, kết quả), thời hạn lưu (đầu vào 7 ngày, kết quả 30 ngày), việc chia sẻ chỉ qua token người dùng tự tạo, và địa chỉ email liên hệ
**And** cũng có biểu ngữ khi `status` là `draft`.

**Given** `TOS_VERSION` trong `packages/contracts`
**When** chạy test ở CI
**Then** test fail nếu giá trị này khác `version` trong file `/terms`
**And** các ô cam kết ở đăng nhập, tải lên và nạp tiền đều có liên kết mở `/terms` ở tab mới.

**Given** một bản build dành cho release (nhánh hoặc tag phát hành)
**When** một file pháp lý có `status = draft`
**Then** CI fail ở bước kiểm tra phát hành và nêu rõ file nào.

**Given** `GET /system/status`
**When** `intakePaused` là true
**Then** các trang tạo Task (`/face-swap`, `/body-retouch`, `/motion`) hiển thị biểu ngữ "Hệ thống đang bảo trì, tạm dừng nhận tác vụ mới" và vô hiệu nút "Tạo"
**And** trạng thái được kiểm khi mở trang và định kỳ; việc tải lên file không bị chặn bởi biểu ngữ nhưng có nhắc người dùng.

**Given** server trả 503 `PAUSED` dù FE chưa biết
**When** FE nhận lỗi khi tạo Task
**Then** hiển thị cùng thông báo bảo trì và không trừ số dư trên giao diện.

**Given** story này
**When** chạy
**Then** hoạt động đầy đủ ở chế độ mock và ở viewport 360 px, không sửa file ngoài `apps/web`.

### Story 6.10: [INTEGRATION] Nối FE với BE và smoke test vận hành

**Phủ:** FR18, FR21, FR22, AR22

As a nhà phát triển,
I want tắt mock và chạy các tình huống vận hành từ đầu đến cuối với BE thật,
So that xác nhận ngắt mạch, hết ngân sách, khóa tài khoản, gỡ bỏ và sao lưu hoạt động cùng nhau.

**Acceptance Criteria:**

**Given** stack bốn container, FE ở chế độ `live`, RunningHub, R2 và Discord được giả
**When** RunningHub giả trả `RH_ERROR` cho 5 Task liên tiếp
**Then** yêu cầu tạo Task thứ sáu ở cả ba route trả 503 `PAUSED`
**And** đăng nhập, nạp tiền, lịch sử và tải kết quả vẫn dùng được
**And** Discord giả nhận đúng một cảnh báo và các trang tạo Task hiển thị biểu ngữ bảo trì.

**Given** ngắt mạch đang bật
**When** Admin bấm "Mở lại nhận Task" trên giao diện
**Then** tạo Task được lại và các lỗi cũ không làm ngắt mạch kích hoạt lại ngay.

**Given** 20 Task với 4 lỗi hệ thống và 10 Task `NO_POSE`
**When** chạy
**Then** ngắt mạch kích hoạt ở quy tắc 15%, và riêng 30 Task `NO_POSE` thì không kích hoạt.

**Given** RunningHub giả trả lỗi hết tiền
**When** một Task bị từ chối
**Then** Task `failed` với `RH_BUDGET` và RELEASED, hai cờ được đặt, một cảnh báo Discord được gửi
**And** một Task Motion đang chờ thất bại nhanh với `RH_BUDGET` mà không có tiến trình ffmpeg nào được chạy
**And** nạp credit vẫn hoạt động; sau khi Admin mở lại, Task chạy bình thường.

**Given** Admin khóa một người dùng đang đăng nhập
**When** người đó dùng access JWT cũ để tạo Task
**Then** nhận `ACCOUNT_LOCKED`; làm mới phiên bị từ chối; mở khóa thì đăng nhập lại được.

**Given** Admin cộng bù +300 credit kèm lý do, rồi thử trừ vượt số dư, rồi gửi lại cùng `requestId`
**When** chạy
**Then** lần đầu ghi một bút toán `ADJUST` và số dư tăng 300, lần trừ vượt bị từ chối, lần gửi lại không ghi thêm
**And** `admin_audit` có bản ghi tương ứng.

**Given** người dùng chia sẻ một video kết quả
**When** Admin tìm bằng liên kết chia sẻ và gỡ bỏ
**Then** `/s/<token>`, `/s/<token>/info`, `/s/<token>/poster` trả 404, các khóa `in/` và `out/` không còn trong R2 giả, `GET /tasks/{id}` báo `filesRemovedAt`, số dư không đổi.

**Given** job sao lưu chạy với R2 giả
**When** có 9 bản cũ trong `db-backup/`
**Then** sau khi tải bản mới lên chỉ còn 7 bản mới nhất
**And** khi giả lập lỗi `pg_dump` thì không bản cũ nào bị xóa và Discord giả nhận đúng một cảnh báo.

**Given** script `restore-drill` chạy trên bản sao lưu vừa tạo
**When** khôi phục vào cơ sở dữ liệu trống rồi xóa sạch Redis
**Then** kiểm tra sổ cái đạt, và bộ quét dựng lại hàng đợi cho Task `queued` có sẵn.

**Given** mọi trang
**When** kiểm tra bằng trình duyệt tự động
**Then** chân trang có ba liên kết và `mailto:` trỏ đúng địa chỉ cấu hình.

**Given** job đối soát sổ cái
**When** chạy sau các smoke test
**Then** không báo lệch.

**Given** test hợp đồng ở CI
**When** chạy
**Then** phản hồi của mock và của BE thật đều khớp schema trong `packages/contracts`.

**Given** README
**When** cập nhật
**Then** ghi cách chạy các smoke test này và runbook ngắn cho Admin: khi nhận cảnh báo ngắt mạch, hết ngân sách, sao lưu lỗi hoặc đơn nạp quá hạn thì làm gì.

### Story 6.11: [OPS] Cổng trước khi bật VietQR thương mại

**Phủ:** AR24, FR2, FR19

As a PM và người vận hành,
I want một bộ script, checklist và báo cáo cho năm bước kiểm thử với RunningHub và VPS thật,
So that chỉ bật cổng nạp tiền thương mại khi kinh tế đơn vị và hạ tầng đã được kiểm chứng.

Story này có hai phần: AI viết script, tài liệu và cấu hình; người vận hành chạy chúng với tài khoản RunningHub, VPS và Discord thật rồi ghi kết quả. Story chỉ hoàn tất khi báo cáo đã ghi đủ và PM xác nhận.

**Acceptance Criteria:**

**Given** thư mục `scripts/prelaunch/` và `docs/prelaunch-checklist.md`
**When** viết xong
**Then** có một lệnh cho mỗi bước trong năm bước và một mẫu báo cáo `docs/prelaunch-report.md` có cột kết quả, ngày, người chạy
**And** không script nào chứa khóa API hay địa chỉ webhook; mọi giá trị bí mật đọc từ biến môi trường.

**Given** bước 1: Discord
**When** chạy lệnh CLI của `apps/api` gửi tin thử qua `NotifierPort`
**Then** kênh Discord thật nhận tin trong 10 giây
**And** kết quả ghi vào báo cáo.

**Given** bước 2: ffmpeg
**When** chạy script cắt một clip nguồn 20 giây 1080p bằng đúng lệnh sản xuất của Story 5.4 trên VPS, đồng thời đo CPU, bộ nhớ, đĩa tạm và độ trễ của `GET /health`
**Then** ghi lại thời gian cắt, mức CPU cao nhất, đĩa tạm cao nhất và độ trễ phân vị 95 của `/health` trong lúc cắt
**And** kết quả đạt khi cắt xong trong 60 giây, `/health` phân vị 95 dưới 1 giây và không container nào khởi động lại hay bị tắt vì thiếu bộ nhớ `[ASSUMPTION: ngưỡng do người viết story đề xuất, PM điều chỉnh]`.

**Given** bước 3: endpoint RunningHub
**When** chạy script thử endpoint số dư ví (có thể là mục "Get Account Information" trong tài liệu) và endpoint hủy task bằng một Task thử rẻ
**Then** ghi vào `docs/runninghub-api-notes.md` đường dẫn, tham số và dạng phản hồi thật của từng endpoint, cùng host dùng (`.ai` hay `.cn`) và giới hạn tần suất nếu có
**And** cập nhật adapter thật của `RunningHubPort.getBalance()` (Story 6.3) theo ghi chú này
**And** nếu endpoint hủy không tồn tại thì ghi rõ và giữ nguyên kiến trúc, vì spine không phụ thuộc vào việc hủy.

**Given** bước 4: benchmark với tài khoản có email trong `BENCHMARK_USER_EMAILS`, đã nạp gói Creator qua luồng nạp thật của Epic 3 (đơn thử có `bank_ref` bắt đầu bằng `BENCH-`)
**When** chạy bộ 20 mẫu qua API công khai: 5 Face Swap (ảnh góc nghiêng, ảnh đủ sáng, ảnh bán thân), 5 Body Retouch (`intensity` 3, 3, 5, 5, 8 `[ASSUMPTION: phân bổ do người viết story đề xuất]`), 10 Motion (2 clip 3 giây, 3 clip 5 giây, 2 clip 10 giây, 2 clip 15 giây, 1 clip 20 giây)
**Then** mỗi lượt ghi số coin thực tế từ `gpu_coins`, giây GPU suy ra bằng `gpu_coins` chia 0,4, giây GPU trên mỗi giây video thành phẩm, sai số độ dài so với đoạn đã cắt (ngưỡng ±0,5 giây) và thời gian từ `running_at` đến `finished_at`
**And** với các clip 15 và 20 giây, người vận hành xem thủ công nửa sau video và ghi đạt hoặc không đạt cho từng clip (mặt biến dạng, cơ thể trôi dạt).

**Given** kết quả benchmark
**When** đánh giá điều kiện thông qua theo PRD §12
**Then** biên gộp thực tế của gói Creator không dưới 70% ở kịch bản nạp lẻ cho mọi pipeline (đọc từ `GET /admin/stats` với `scope = benchmark`) `[ASSUMPTION: dùng kịch bản nạp lẻ vì xấu nhất]`
**And** tỷ lệ lỗi kỹ thuật trên 20 mẫu là 0%
**And** thời gian Face Swap của từng mẫu được ghi kèm SLA 60 giây; nếu có mẫu vượt thì ghi kết quả và PM quyết định điều chỉnh SLA hoặc tối ưu workflow, đây không phải điều kiện chặn tự động.

**Given** điều kiện thông qua không đạt
**When** PM quyết định theo Kế hoạch B
**Then** nâng giá Motion Control lên 60–70 credit/giây hoặc giảm số credit trong các gói bằng cách đổi cấu hình giá phía server, không đổi kiến trúc
**And** dùng `GET /admin/stats` với giá thử để tính lại biên gộp rồi ghi quyết định vào báo cáo; chỉ chạy lại benchmark khi thời gian GPU thay đổi.

**Given** thêm 1–2 ảnh nhạy cảm, không tính vào 20 mẫu, do người vận hành tự chuẩn bị và không đưa vào kho mã, trong đó ít nhất một ảnh chạy qua Body Retouch
**When** chạy
**Then** ghi nguyên văn chuỗi hoặc mã lỗi JSON mà RunningHub trả về khi node lọc nội dung chặn (đã loại bỏ nội dung nhạy cảm), điền danh sách ánh xạ `CONTENT_BLOCKED` trong cấu hình và thêm một fixture kiểm thử từ chuỗi đã ghi
**And** xác nhận Task `failed` với `CONTENT_BLOCKED`, RELEASED và người dùng thấy "Ảnh/video vi phạm tiêu chuẩn cộng đồng, vui lòng chọn file khác."
**And** nếu node lọc không chặn ảnh nào thì ghi rõ "không có lớp lọc nội dung" vào báo cáo và PRD §9, để PM quyết định trước khi mở bán (chấp nhận rủi ro hoặc đưa Pre-check của v2 lên trước).

**Given** các bài đo trên workflow thật
**When** hoàn tất
**Then** ghi chuỗi lỗi thật cho `NO_FACE`, `NO_POSE` và lỗi hết tiền vào danh sách ánh xạ của Story 2.5, xác nhận workflow Motion có báo cả `NO_FACE` hay không, độ phân giải và hướng video đầu ra thật, và nếu khác giả định thì cập nhật tiêu chí của Story 5.6 và PRD.

**Given** bước 5: khôi phục cơ sở dữ liệu
**When** chạy `pg_dump` thật lên R2 rồi chạy `scripts/restore-drill` vào cơ sở dữ liệu tạm trên VPS
**Then** kiểm tra sổ cái đạt và ghi thời gian khôi phục thực tế làm số liệu RTO ban đầu.

**Given** `docs/prelaunch-checklist.md`
**When** người vận hành duyệt các mục không tự động hóa được
**Then** mỗi mục có dòng đạt hoặc không đạt: tên miền và DNS đặt ở Cloudflare, chứng chỉ Origin CA đã cài và SSL Full (strict) chạy; `ufw` chỉ nhận dải IP Cloudflare và truy cập thẳng vào IP của VPS bị từ chối; header `CF-Connecting-IP` giả mạo từ nguồn không phải Cloudflare bị bỏ qua; preset Nitro đã kiểm (Story 1.4) và FE đã chạy trên Cloudflare Pages; quy tắc lifecycle R2 đã áp dụng (`in-raw/` 1 ngày, `in/` 7 ngày, `out/` 30 ngày) và CORS chỉ cho miền FE; toàn bộ biến môi trường đã đặt (`ADMIN_EMAILS`, workflow ID, thông tin tài khoản nhận tiền, webhook Discord, `NUXT_PUBLIC_REPORT_EMAIL`, `BENCHMARK_USER_EMAILS`); ví RunningHub đã nạp trong trần USD 50–100; `/terms` và `/privacy` có `status = final` sau tư vấn pháp lý; văn bản cam kết ToS bổ sung về độ tuổi 18 và quyền sử dụng hình ảnh (FR19) đã hoàn thiện; sao lưu 03:00 đã chạy ít nhất một đêm.

**Given** toàn bộ báo cáo
**When** PM xem lại
**Then** mọi dòng ở trạng thái đạt hoặc có quyết định chấp nhận rủi ro bằng văn bản, PM ghi tên và ngày xác nhận
**And** các phát hiện được cập nhật ngược vào spine (mục Deferred), PRD §9 và §12 và danh sách ánh xạ cấu hình, rồi ghi một dòng vào `.memlog.md`.

**Given** bất kỳ dòng nào chưa đạt và chưa có quyết định chấp nhận rủi ro
**When** PM quyết định bật cổng nạp tiền thương mại
**Then** story vẫn ở trạng thái chưa hoàn tất, và README ghi rõ không bật VietQR thương mại khi còn dòng như vậy.
