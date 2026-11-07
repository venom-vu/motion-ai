## Deferred from: code review of spec-1-1-shared-dung-monorepo-va-khung-ci (2026-11-01)

- Smoke test spawn `dist/main.js` / `dist/worker.js` (guard entrypoint, PORT): bổ sung ở Story 1.3.
- `apps/web` lint chưa phủ `.vue`: làm khi có component FE.
- CI cần branch protection/required check trên GitHub để thực sự chặn merge.
- CLAUDE.md "Quy trình làm việc" còn ghi story 1-1 là bước tiếp theo.

## Deferred from: code review of spec-1-2-contract-hop-dong-chung-cho-dang-nhap-va-vi (2026-11-01)

- Hình dạng `GET /auth/google` + callback (JSON vs 302 redirect) và hợp đồng cookie refresh token (tên, SameSite, Path, CSRF) chưa được định nghĩa ngoài comment. Chưa xác minh (tối đa medium); cần đối chiếu ARCHITECTURE-SPINE trước Story đăng nhập BE/FE.

## Deferred from: code review of spec-1-3-be-khung-api-worker-postgresql-va-redis (2026-11-02)

- Migration chỉ chạy trong lệnh start của `nestjs-api`; worker/nhiều replica không có thứ tự hay khóa. Worker chưa dùng DB; xử lý khi có bảng nghiệp vụ (service `migrate` one-shot + `depends_on: service_completed_successfully`).
- `?schema=` trong `DATABASE_URL` có thể không được `PrismaPg`/`pg.Pool` áp dụng lúc runtime (chưa xác minh, tối đa medium). Settle bằng truy vấn runtime với schema khác `public`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: Thêm `wallet.adjust()` và API đọc số dư/lịch sử cho module khác dùng.
  evidence: `ADJUST` được CHECK cho phép nhưng chưa có đường ghi; thuộc story 1.7 và story admin.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: Thêm trigger DB chặn UPDATE/DELETE trên `ledger_entries`.
  evidence: Append-only hiện chỉ dựa vào quy ước ứng dụng; ngoài phạm vi AC của 1.6.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: `wallet.grant` chưa có khóa idempotency; retry sẽ cộng tiền lặp.
  evidence: code-review độc lập; story 1.8 chặn bằng chỉ mục duy nhất trên `signup_grants(fingerprint_hash)`.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: Lỗi validation của wallet trả 409 không có `ApiErrorCode`; cần thêm mã lỗi vào `packages/contracts`.
  evidence: code-review độc lập; ngoài ranh giới nhánh `be/*` nên cần story `contract/*`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-be-tier-api-vi-va-doi-soat-so-cai.md`
  summary: Backfill `users.tier_pack` từ bút toán TOPUP khi Epic 3 bắt đầu ghi TOPUP thật.
  evidence: Hiện chưa có luồng gọi `wallet.topup`, nên chưa có dữ liệu cần backfill; nếu có trước migration thì user trả phí sẽ bị FREE.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-be-tier-api-vi-va-doi-soat-so-cai.md`
  summary: Khóa advisory, dedupe và gộp cảnh báo cho job đối soát; tách `ScheduleModule` chỉ vào worker.
  evidence: Nhiều bản sao worker hoặc lệch kéo dài sẽ gửi cảnh báo lặp; cờ `MOTION_PROCESS_ROLE` là biến toàn tiến trình.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-be-tier-api-vi-va-doi-soat-so-cai.md`
  summary: Chỉ mục/cột tuần tự cho `/wallet/ledger`; `adjust` thêm actor và lý do; hợp nhất `PRICING_CONFIG` với contracts.
  evidence: Truy vấn dùng `date_trunc` không dùng được chỉ mục; ADJUST thiếu dấu vết; cấu hình giá bị chép hai nơi.

## Deferred from: code review of spec-1-7-be-tier-api-vi-va-doi-soat-so-cai (2026-11-03)

- Job đối soát tải toàn bộ user không phân trang, một cảnh báo mỗi user, không chống chạy chồng; cần khóa advisory và cảnh báo gộp.
- Đối soát chưa kiểm `tier_pack` so với tổng credit và chưa phát hiện CAPTURED/RELEASED mồ côi; mở rộng sau.
- `PRICING_CONFIG` chép tay khỏi contracts và truy vấn ledger dùng `date_trunc` không tận dụng chỉ mục (đã ghi ở spec).
- Migration `tier_pack` chưa backfill/rollback (đã ghi ở spec); chờ Epic 3.

## Deferred from: code review of spec-1-8-be-tang-500-credit-va-chong-lam-dung (2026-11-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-be-tang-500-credit-va-chong-lam-dung.md`
  summary: Gom nhóm subnet IPv6 (/64) cho rate limit và chống lạm dụng thiết bị IPv6.
  evidence: Thiết bị di động/mạng IPv6 có thể xoay interface ID trong cùng subnet /64; cần chính sách gom subnet khi vận hành thực tế.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-be-tang-500-credit-va-chong-lam-dung.md`
  summary: Phân tách namespace cho pg_advisory_xact_lock(classid, objid).
  evidence: Tránh khả năng đụng độ mã băm 64-bit advisory lock với các tính năng locking khác trong tương lai.
- `WalletService` dùng `@Optional()` cho `PrismaService`, thiếu phụ thuộc chỉ lộ thành 500 lúc request. Lý do hoãn: giữ để test gọi `new WalletService()`; cân nhắc tách `WalletQueryService`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-fe-dang-nhap-cam-ket-tos-va-so-du.md`
  summary: Thêm liên kết tới trang Điều khoản dịch vụ và `aria-describedby` giải thích vì sao nút đăng nhập bị vô hiệu trong `LoginConsentForm`.
  evidence: Văn bản cam kết chỉ nêu phiên bản ToS, người dùng không đọc được nội dung họ đồng ý; chưa có trang điều khoản vì văn bản ToS cuối cùng còn chờ PM (PRD §10).

## Deferred from: code review of spec-1-9-fe-dang-nhap-cam-ket-tos-va-so-du (2026-11-03)

- Không có đường quay lại trang cũ sau khi đăng nhập hoặc hết phiên: `navigateTo('/login')` không mang `redirect` và `login.vue` luôn về `/`. Cần thiết kế OAuth state mang đích về, chỉ nhận đường dẫn tương đối cùng origin. Ngoài AC của 1.9, phù hợp với story tích hợp 1.11.

## Deferred from: code review lượt 3 of spec-1-9-fe-dang-nhap-cam-ket-tos-va-so-du (2026-11-03)

- `useAuth.restoreSession` (ánh xạ `outcome === 'ok'` và `sessionChecked` trong `.finally`) chưa có test chạy composable thật; đảo thành `outcome !== 'invalid'` thì mọi test vẫn xanh. Cần khung test Nuxt hoặc tách thêm một hàm thuần vào `auth-session.ts`.

## Deferred from: code review of spec-1-10-fe-lich-su-credit.md (2026-11-03)

- Kiểm thử reactive watcher `accessToken` trên Nuxt client runtime (`apps/web/pages/history.vue:52-59`): cần bổ sung test harness component mount chuyên dụng (@nuxt/test-utils hoặc @vue/test-utils) hiện chưa cấu hình trong repo.

## Deferred from: code review of spec-2-2-be-tai-anh-len-r2-an-toan (2026-11-04)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-be-tai-anh-len-r2-an-toan.md`
  summary: Giới hạn tần suất `POST /uploads` và `confirm` theo người dùng/IP (AD-17), tính cả upload bị từ chối vào hạn mức.
  evidence: `rejectInvalid` chuyển bản ghi sang `expired` nên vòng tạo, PUT rác, confirm lặp vô hạn và tốn CPU sharp (mức độ chưa kiểm chứng).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-be-tai-anh-len-r2-an-toan.md`
  summary: Kiểm `ScheduleModule.forRoot()` không bị đăng ký hai lần (StorageModule và OpsModule).
  evidence: Nếu lặp, `scheduledExpire` chạy hai lần mỗi giờ; cần test đếm số lần gọi để chắc.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-be-tai-anh-len-r2-an-toan.md`
  summary: Script `configure-bucket` thay toàn bộ lifecycle, chưa có rule `out/` 30 ngày, chưa kiểm bucket riêng tư, `FRONTEND_URL` rỗng rơi về localhost.
  evidence: `PutBucketLifecycleConfiguration` ghi đè; thêm rule `out/` ở Story 2.6.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-be-tao-task-face-swap-va-xep-vao-hang-doi.md`
  summary: Giao dịch tạo Task có thể vượt timeout mặc định 5 giây của Prisma khi chờ khóa dòng user (P2028), chưa kiểm chứng.
  evidence: Chưa có test chờ khóa lâu; cần mô phỏng để quyết định đặt `maxWait`/`timeout` và ánh xạ lỗi.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-be-tao-task-face-swap-va-xep-vao-hang-doi.md`
  summary: Test throttle auth trong `signup-grant.test.mjs` flaky khi chạy cả bộ vì các file test song song dùng chung bộ đếm Redis.
  evidence: Thấy fail một lần ở dòng 881 (429 sớm) trong lần chạy đầu, hai lần sau xanh; diff Story 2.3 không đụng auth.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-be-worker-xu-ly-task-qua-runninghub.md`
  summary: Từ khóa `balance`/`insufficient` ở `mapRunningHubFailure` quá rộng và danh sách `CONTENT_BLOCKED` còn trống.
  evidence: Cần chuỗi lỗi thật của RunningHub (benchmark Epic 6) để thu hẹp và điền; hiện chỉ có test với câu "Insufficient balance".
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-be-worker-xu-ly-task-qua-runninghub.md`
  summary: Mặc định chưa cấu hình RunningHub khiến Task bị HOLD rồi `RH_ERROR`; chưa có fail-fast hay từ chối tạo Task khi pipeline chưa cấu hình.
  evidence: Adapter mặc định ném `RH_ERROR`; cần quyết định cờ cấu hình ở `ops` hoặc kiểm tra khi tạo Task, nên làm cùng adapter thật (Story 2.14).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-be-nhap-ket-qua-r2-va-chot-tien.md`
  summary: Kiểm thử thực thi hoặc mock SDK cho cấu hình lifecycle R2 trong configure-bucket.ts
  evidence: Hiện script cấu hình bucket chỉ được kiểm tra bằng regex trên file nguồn; cần kiểm thử chạy thực tế hoặc kiểm tra đối tượng PutBucketLifecycleConfigurationCommandInput.

## Deferred from: code review of spec-2-3-be-tao-task-face-swap-va-xep-vao-hang-doi (2026-11-05)

- FK `ledger_entries_task_id_fkey` còn `NOT VALID`, cần migration `VALIDATE CONSTRAINT` khi dữ liệu dev sạch.
- Chưa có Idempotency-Key; FE khóa nút khi đang gửi (Story 2.11), hoàn credit qua hủy Task.
- Test throttle `signup-grant` chập chờn.

## Deferred from: code review of spec-2-5-be-worker-xu-ly-task-qua-runninghub (2026-11-05)

- Cổng đồng thời chỉ đúng trong một tiến trình worker; nếu chạy nhiều bản thì dùng `pg_advisory_xact_lock`.

## Deferred from: code review of spec-2-9-be-chia-se-ket-qua-bang-token (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-9-be-chia-se-ket-qua-bang-token.md`
  summary: Tài khoản bị khóa không thu hồi được link chia sẻ vì `AccountLockedGuard` chặn cả `DELETE /tasks/{id}/share`, và link cũ vẫn mở được.
  evidence: AD-18 giao Admin thu hồi token và xóa file khi khóa tài khoản (Epic 6); cân nhắc cho `DELETE` bỏ qua guard khóa nếu cần sớm hơn.

## Deferred from: code review of spec-2-12-fe-trang-ket-qua-va-lich-su-task (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-fe-trang-ket-qua-va-lich-su-task.md`
  summary: Điều hướng mobile bottom nav tab "Lịch sử" (`AppBottomNav.vue`) trỏ về `/history` thay vì `/tasks`.
  evidence: Cần quyết định thiết kế UX/Product xem tab "Lịch sử" trên mobile nên mở `/tasks` (Lịch sử tác vụ kèm lối vào Biến động credit) hay giữ nguyên `/history` (sổ cái ví credit).

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-be-tao-don-nap-va-ma-vietqr.md`
  summary: Đơn `awaiting_transfer` quá `qr_expires_at` vẫn tính vào giới hạn 3 đơn mở nên người dùng bỏ dở 3 đơn bị chặn `TOPUP_LIMIT`.
  evidence: Chưa có chuyển `awaiting_transfer→expired` ở 3.2; Story 3.3 (bộ quét) phải xử lý, kiểm tra lại khi 3.3 xong.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-be-tao-don-nap-va-ma-vietqr.md`
  summary: Phản hồi đơn dùng cấu hình tài khoản nhận hiện tại thay vì tài khoản lúc tạo đơn.
  evidence: `toDto` đọc `TOPUP_BANK_*` mỗi lần; đổi tài khoản nhận thì đơn cũ hiện QR sang tài khoản mới. Cần quyết định có snapshot vào bảng `topups` hay không.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-fe-trang-nap-credit-va-theo-doi-don.md`
  summary: Giao thức webhook Discord trong `DiscordNotifierAdapter` cho phép `http:` ngoài `https:`.
  evidence: Discord webhooks chỉ hoạt động trên HTTPS; cần siết chặt kiểm tra URL chỉ chấp nhận `https:` ở Story 3.4.

## Deferred from: code review of spec-3-6-fe-trang-nap-credit-va-theo-doi-don (2026-11-07)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-fe-trang-nap-credit-va-theo-doi-don.md`
  summary: Polling đơn nạp dừng im lặng sau 5 lỗi liên tiếp hoặc 401/403/404; người dùng không thấy thông báo hay nút làm mới, trạng thái hiển thị bị cũ.
  evidence: `useTopup.ts` `startPolling` gọi `stopPolling()` không đặt thông báo lỗi; cần quyết định thiết kế UX (banner "không cập nhật được" + nút làm mới).

## Deferred from: code review of spec-3-5-be-duyet-va-tu-choi-don-nhat-ky-admin (2026-11-07)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-be-duyet-va-tu-choi-don-nhat-ky-admin.md`
  summary: `bankRef` chỉ được trim; khác hoa/thường hoặc khoảng trắng bên trong vẫn lọt chỉ mục unique, có thể cộng credit hai lần cho cùng một giao dịch ngân hàng.
  evidence: `topups_bank_ref_key` so khớp chính xác; cần quyết định có chuẩn hóa (upper-case) hoặc đặt unique trên `upper(bank_ref)` hay không.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-be-duyet-va-tu-choi-don-nhat-ky-admin.md`
  summary: `return-to-pending` giữ nguyên `approve_by` nên đơn có thể trở lại `pending` đã quá hạn; đơn `needs_review` không có cờ `isOverdue`.
  evidence: Spec đóng băng ghi giữ `approve_by`; cần quyết định UX/nghiệp vụ có tính lại hạn duyệt không.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-be-duyet-va-tu-choi-don-nhat-ky-admin.md`
  summary: `RolesGuard` tin role trong JWT, Admin bị hạ quyền hoặc khóa vẫn duyệt được đến khi token hết hạn (unverified).
  evidence: Kiểm tra lại role trong DB mỗi request thuộc Epic 6.4 (khóa tài khoản); cần xác nhận khi làm story đó.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-be-duyet-va-tu-choi-don-nhat-ky-admin.md`
  summary: `pnpm run reconcile` báo lệch hai user fixture `p-0840a375-9/10@motionai.vn` còn sót trong DB dev từ test cũ (tạo 2026-11-06).
  evidence: Hai user không có bút toán hay đơn nạp nào; một test cũ (nghi `task-priority`) đặt `balance/held` trực tiếp mà không dọn; làm `reconcile` không sạch trên DB dev.
