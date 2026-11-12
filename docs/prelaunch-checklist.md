# Checklist cổng trước khi bật VietQR thương mại (Story 6.11)

Không bật cổng nạp tiền VietQR thương mại khi còn bất kỳ dòng nào **chưa đạt** và chưa có quyết định chấp nhận rủi ro bằng văn bản của PM. Kết quả từng dòng ghi vào `docs/prelaunch-report.md`.

## Chuẩn bị

- Build trên máy chạy script: `pnpm install && pnpm --filter @flowvis/contracts run build && pnpm --filter @flowvis/api run build` (hoặc dùng image đã build trên VPS, các CLI nằm ở `apps/api/dist/scripts/`).
- Bí mật chỉ đặt qua biến môi trường của phiên shell hoặc `deploy/.env` trên VPS, không commit (xem phần "Cổng trước khi bật VietQR" trong `deploy/.env.example`).
- Ảnh/video mẫu và ảnh nhạy cảm để **ngoài repo**; manifest benchmark chép từ `scripts/prelaunch/benchmark-manifest.example.json` ra ngoài repo rồi sửa đường dẫn.
- Mọi script in một dòng JSON ở stdout để dán vào báo cáo. Mã thoát: `0` đạt, `1` không đạt, `2` lỗi chạy (thiếu biến, thiếu file, docker lỗi, lỗi HTTP của bộ chạy). Riêng bước 4 `--sensitive` chỉ ghi nhận: thoát `0`, hoặc `2` khi lỗi chạy.
- Ngưỡng mặc định là `[ASSUMPTION]` của epic, PM điều chỉnh bằng biến `PRELAUNCH_*`; ghi ngưỡng đã dùng vào báo cáo.

## Năm bước tự động

| Bước | Lệnh (chạy tại gốc repo) | Đạt khi |
|------|--------------------------|---------|
| 1. Discord | `DISCORD_WEBHOOK_URL=... node scripts/prelaunch/step1-discord.mjs` (hoặc `--compose` trên VPS để dùng biến của container worker) | Gửi qua `DiscordNotifierAdapter` thành công, `latencyMs` ≤ 10 000 và người vận hành thấy tin trong kênh Discord thật |
| 2. ffmpeg | Trên host VPS: `node scripts/prelaunch/step2-ffmpeg.mjs /đường/dẫn/clip-20s-1080p.mp4 --seconds 20` | Cắt (đúng `nice -n 19 ffmpeg` + `buildFfmpegArgs` của Story 5.4) xong ≤ 60 s, `/health` p95 < 1 s, không lỗi `/health`, 0 container khởi động lại, 0 OOM |
| 3. RunningHub | `RUNNINGHUB_API_KEY=... RH_BALANCE_ENDPOINT=... node scripts/prelaunch/step3-runninghub.mjs` (hoặc `--compose`) | HTTP 2xx và `adapterCoins` là số; chép `host`, `endpoint`, `httpStatus`, `rawResponse` (đã che khóa), header giới hạn tần suất vào `docs/runninghub-api-notes.md` |
| 4. Benchmark | `PRELAUNCH_API_URL=... PRELAUNCH_BENCH_JWT=... PRELAUNCH_ADMIN_JWT=... node scripts/prelaunch/step4-benchmark.mjs --manifest /ngoài-repo/manifest.json` | Biên gộp Creator kịch bản nạp lẻ ≥ 70% ở cả 3 pipeline (`GET /admin/stats?scope=benchmark`), 0% lỗi kỹ thuật trên 20 mẫu, sai số độ dài Motion trong ±0,5 s |
| 4b. Mẫu nhạy cảm | Thêm `--sensitive` (cùng manifest, các mục `"sensitive": true`) | Chỉ ghi nhận (thoát 0, hoặc 2 khi lỗi chạy); ghi nguyên văn chuỗi lỗi RunningHub (`rawFailure`) hoặc "không có lớp lọc nội dung" |
| 5. Khôi phục | Trên VPS: `node scripts/prelaunch/step5-restore.mjs` (mặc định chạy trong container `nestjs-worker`) | `backup-now` thành công, `restore-drill` `ok: true`; ghi `rtoMs` làm RTO ban đầu |

Ghi chú từng bước:

- **Bước 1:** script không bao giờ rơi về adapter log; thiếu hoặc sai `DISCORD_WEBHOOK_URL` thì thoát 2.
- **Bước 2:** script chép clip vào container worker (cấp quyền đọc bằng `exec -u root chmod 644` vì worker chạy `USER node`, xóa bằng root sau khi đo), lấy mẫu `docker stats --no-stream` liên tục (mỗi lần gọi mất khoảng 2 s nên thực tế mỗi 2–3 s một mẫu), gọi `/health` mỗi 200 ms (`PRELAUNCH_HEALTH_URL`, mặc định `http://127.0.0.1:3001/health`), so `RestartCount`/`StartedAt`/`OOMKilled` trước và sau (cờ `OOMKilled` đã `true` từ trước không tính, trừ khi container khởi động lại trong lúc đo). Ghi `trimMs`, CPU/RAM cao nhất từng container, `maxTmpBytes`, `healthP95Ms`.
- **Bước 3:** `RunningHubPort` không có endpoint hủy task và kiến trúc không phụ thuộc việc hủy; chỉ ghi chú vào `runninghub-api-notes.md` nếu RunningHub có endpoint hủy. Nếu phản hồi số dư khác dạng adapter đang đọc (`data.remainCoins|data.coins|coins`), mở story sửa adapter.
- **Bước 4:** tài khoản benchmark có email trong `BENCHMARK_USER_EMAILS`, đã nạp gói Creator qua luồng nạp thật (đơn thử `bank_ref` bắt đầu bằng `BENCH-`). Access token hết hạn sau 15 phút: đặt `PRELAUNCH_BENCH_REFRESH_TOKEN` và `PRELAUNCH_ADMIN_REFRESH_TOKEN` (giá trị cookie `refreshToken`), script gọi `POST /auth/refresh` trước mỗi mẫu và trước `/admin/stats`, giữ token đã xoay vòng trong bộ nhớ (refresh token cũ bị thu hồi, đăng nhập lại để lấy token mới sau khi chạy). Lỗi của bộ chạy (401, PUT upload lỗi, poll lỗi sau vài lần thử, không đọc được `gpu_coins`) không tính là lỗi kỹ thuật mà làm bước thoát 2; chạy lại sau khi xử lý. Mẫu Motion thành công nhưng không đo được độ dài (thiếu `ffprobe`, tải lỗi) bị coi là chưa đạt (`durationUnmeasured`). Script tạo Task qua API công khai, đọc `gpu_coins`, `running_at`, `finished_at` bằng CLI chỉ đọc `prelaunch-task-metrics` (trong container worker; `--local-metrics` để chạy cục bộ, cần `DATABASE_URL`), đo độ dài video thật bằng `ffprobe` (cần có trên máy chạy). Với clip 15 và 20 giây, người vận hành xem thủ công nửa sau video và ghi đạt/không đạt (`manualReviewSecondHalf`). Face Swap ghi kèm SLA 60 s (không chặn tự động).
- **Bước 4b:** khi có chuỗi lỗi thật cho nội dung bị chặn, điền `RH_CONTENT_BLOCKED_PREFIXES` trong `apps/api/src/modules/pipelines/pipeline-config.ts` và thêm fixture kiểm thử từ chuỗi đã ghi (story riêng). Không đoán chuỗi. Đồng thời ghi chuỗi lỗi thật cho `NO_FACE`, `NO_POSE` và hết tiền.
- **Bước 5:** `backup-now` dùng đúng `BackupService` của Story 6.7; `restore-drill` khôi phục vào CSDL tạm, đối soát sổ cái rồi xóa CSDL tạm (xem `deploy/RESTORE.md`).

## Kế hoạch B (khi biên gộp không đạt)

PM chọn nâng giá Motion lên 60–70 credit/giây hoặc giảm credit trong gói bằng cấu hình giá phía server (không đổi kiến trúc). Tính lại bằng `GET /admin/stats?scope=benchmark&from=...&to=...&motionPricePerSecond=65` (hoặc `imagePrice=...`), ghi quyết định vào báo cáo. Chỉ chạy lại benchmark khi thời gian GPU thay đổi.

## Mục duyệt thủ công

Mỗi mục ghi **đạt / không đạt** kèm ngày và người duyệt trong `docs/prelaunch-report.md`.

- [ ] Tên miền và DNS đặt ở Cloudflare
- [ ] Chứng chỉ Origin CA đã cài, SSL Full (strict) chạy
- [ ] `ufw` chỉ nhận dải IP Cloudflare; truy cập thẳng IP VPS bị từ chối
- [ ] Header `CF-Connecting-IP` giả mạo từ nguồn không phải Cloudflare bị bỏ qua
- [ ] Preset Nitro đã kiểm (Story 1.4), FE đã chạy trên Cloudflare Pages
- [ ] Lifecycle R2 đã áp dụng (`in-raw/` 1 ngày, `in/` 7 ngày, `out/` 30 ngày); CORS R2 chỉ cho miền FE
- [ ] Biến môi trường đã đặt: `ADMIN_EMAILS`, workflow ID (`RUNNINGHUB_WORKFLOW_*`), thông tin tài khoản nhận tiền (`TOPUP_BANK_*`), `DISCORD_WEBHOOK_URL`, `NUXT_PUBLIC_REPORT_EMAIL`, `BENCHMARK_USER_EMAILS`
- [ ] Ví RunningHub đã nạp trong trần USD 50–100
- [ ] `/terms` và `/privacy` có `status: 'final'` sau tư vấn pháp lý (kiểm bằng `node apps/web/scripts/check-legal-release.mjs`, thoát 0 khi đã final)
- [ ] Văn bản cam kết ToS bổ sung về độ tuổi 18 và quyền sử dụng hình ảnh (FR19) đã hoàn thiện
- [ ] Sao lưu 03:00 (`Asia/Ho_Chi_Minh`) đã chạy ít nhất một đêm (`lastBackup` ở `/admin/ops`)

## Sau khi chạy

- PM xem toàn bộ báo cáo: mọi dòng đạt hoặc có quyết định chấp nhận rủi ro bằng văn bản; PM ghi tên và ngày.
- Cập nhật ngược phát hiện vào spine (mục Deferred), PRD §9 và §12, danh sách ánh xạ cấu hình, rồi ghi một dòng vào `.memlog.md`.
