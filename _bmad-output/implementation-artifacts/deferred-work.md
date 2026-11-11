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

## Deferred from: code review of spec-3-7-fe-dashboard-admin-duyet-don-nap (2026-11-08)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-fe-dashboard-admin-duyet-don-nap.md`
  summary: Các ô chỉ số thống kê vận hành trên đỉnh trang admin phụ thuộc vào tab lọc hiện tại do thiếu endpoint backend tổng hợp.
  evidence: Backend hiện chỉ có `GET /admin/topups` danh sách phân trang theo filter, chưa có route API tổng hợp chỉ số vận hành toàn hệ thống (thuộc phạm vi Epic 6).

## Deferred from: code review of spec-3-2-be-tao-don-nap-va-ma-vietqr (2026-11-08)

- Đơn `awaiting_transfer` quá `qr_expires_at` vẫn tính vào giới hạn 3 đơn (`topups.service.ts`): người dùng bỏ 3 mã QR bị `TOPUP_LIMIT` cho tới khi bộ quét hết hạn của Story 3.3 chạy. Kiểm tra lại khi 3.3 merge.
- `toDto` lấy tài khoản nhận và `qrPayload` từ env hiện tại cho mọi đơn: đổi tài khoản làm đơn cũ hiển thị tài khoản mới; thiếu env làm `GET /topups` trả 500. Cần quyết định sản phẩm về snapshot tài khoản trên bảng `topups`.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-8-integration-noi-fe-voi-be-va-smoke-test-nap-tien.md`
  summary: Smoke nạp tiền chưa phủ reject, Discord lỗi, cảnh báo quá hạn duyệt, 403 đơn người khác và giải mã `qrPayload`.
  evidence: Ngoài ma trận I/O của story 3.8; các story 3.2-3.5 có test riêng nhưng chưa có ở mức stack Compose.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-8-integration-noi-fe-voi-be-va-smoke-test-nap-tien.md`
  summary: Chưa có kiểm tra FE thật (CORS, cookie, nút "tạo mã mới" khi QR hết hạn) trên stack live.
  evidence: Spec chỉ xác nhận ở mức hợp đồng; cần test trình duyệt (xác nhận chưa xác minh, mức medium).

## Deferred from: code review Epic 3 (2026-11-08)

Đã sửa trong lượt review này: `bank_ref` chuẩn hoá chữ hoa (chặn duyệt trùng `FT1`/`ft1`), kiểm tra định dạng `TOPUP_BANK_BIN`/`TOPUP_BANK_ACCOUNT_NO`, cảnh báo quá hạn có giới hạn lượt và giãn cách (cột `overdue_notify_attempts`), không gửi trùng Discord khi ghi `notified_at` lỗi, QR cũ không ghi đè QR mới, "Tạo mã mới" báo cần đồng ý ToS, test Discord (cắt 2000 ký tự, timeout), test script `pages/admin/topups.vue` và `pages/topup.vue`.

- Đã quyết (2026-11-08): `returnToPending` tính lại `approve_by`; spec 3.5 đã sửa khớp code.
- DB chưa ép bất biến trạng thái: thiếu CHECK `bank_ref` khi `approved`, `reject_reason` khi `rejected`, `note` khi `needs_review`; FK `ledger_entries_topup_id_fkey` thêm `NOT VALID` chưa `VALIDATE`; `admin_audit` chỉ append-only theo quy ước (chưa trigger/REVOKE), `admin_id` chưa có index.
- Bốn ô thống kê trang admin chỉ đếm danh sách đang tải (đã gắn nhãn); cần endpoint tổng hợp (Epic 6).
- `needs_review` không có hạn hay cảnh báo; đơn `expired` không từ chối được; `MAX_OPEN_TOPUPS` tính cả `needs_review`.
- `GET /topups`, `GET /topups/:id` chưa có throttle riêng; Discord adapter chưa xử lý 429/`Retry-After`, chấp nhận `http:`.
- Hai nguồn đồng hồ: `qrExpiresAt` và `isOverdue` dùng đồng hồ ứng dụng, các so sánh khác dùng `now()` của DB.
- Biến test `TOPUP_FAKE_NOW`, `TOPUP_QR_TTL_MS`, `TOPUP_SWEEP_INTERVAL` chưa có trong `.env.example` (chỉ có hiệu lực khi `NODE_ENV=test`).
- FE: `VietQRModal` thiếu focus trap/khôi phục focus, Esc đóng khi đang xác nhận; thẻ gói nạp chưa điều khiển bằng bàn phím; polling không tạm dừng khi tab ẩn; `confirmTransfer` gán `expired` cục bộ thay vì tải lại; `runAction` ném `Error` thường khi bấm kép; `qrcode` import tĩnh; `isApprovalDeferred` dựa `updatedAt` nên có thể lệch khi bộ quét cập nhật dòng.
- Test chưa phủ: script `VietQRModal` (Esc, copy, khoá cuộn), `computeApproveBy` quanh 07:59/23:00, kiểm thử trình duyệt thật cho CORS/cookie.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-5-fe-so-sanh-truoc-sau.md`
  summary: Khắc phục race condition ENOENT trong hàm collectFiles của smoke.test.mjs khi quét các file .ts tạm sinh ra từ các test suite chạy song song
  evidence: smoke.test.mjs:456 quét toàn bộ webRoot bao gồm test/ trong khi các suite khác tạo và xóa file tạm trong test/ dẫn tới lỗi đọc file không tồn tại

## Deferred from: code review of spec-4-5-fe-so-sanh-truoc-sau.md (2026-11-09)

- Nút Quay lại / Lịch sử tại `apps/web/pages/tasks/[id].vue:318` vi phạm WCAG 2.5.3 (Label in Name) do `aria-label="Quay lại"` không chứa chuỗi văn bản hiển thị trực quan `<span>Lịch sử</span>` (vấn đề pre-existing kế thừa từ Story 2.12).

## Deferred from: code review of spec-4-1-contract-hop-dong-cho-body-retouch.md (2026-11-09)

- `_bmad-output/implementation-artifacts/epic-4-context.md` ghi `POST /tasks/body-retouch` nhận `consent`, trong khi spec 4.1 (frozen) và code `.strict()` loại `consent`. Cần đối chiếu và cập nhật file ngữ cảnh để Story 4.2/4.6 không hiểu nhầm (chưa tự kiểm chứng trực tiếp trong file).

## Deferred from: code review of spec-4-2-be-tao-task-body-retouch.md (2026-11-09)

- `apps/api/src/modules/pipelines/pipeline-config.ts:58`: `nodeId`/`fieldName` của `body_retouch` (`10`/`image`, `20`/`intensity`) còn `[ASSUMPTION]`, chưa xác nhận trên RunningHub thật. Cần một lần chạy thật (smoke Story 4.6) để đối chiếu; test hiện tại chỉ phản chiếu cấu hình qua `rh` giả.

## Deferred from: code review of spec-4-3-be-ket-qua-body-retouch.md (2026-11-09)

- `apps/api/test/body-retouch-result.test.mjs`: chưa có test đường lỗi nhập kết quả cho `body_retouch` (tải HTTP 4xx/5xx, body không phải ảnh, `putObject` lỗi, `ingest` gọi hai lần, hủy giữa chừng). Mã nhập kết quả dùng chung với Face Swap từ Epic 2, nên nên phủ ở một story test chung.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-contract-hop-dong-cho-motion-control.md`
  summary: Đổi `mediaType` (kết quả) và `motionControlMinSeconds` (cấu hình giá) thành bắt buộc sau khi BE 5.3/5.6 trả hai trường này.
  evidence: Hiện để tùy chọn vì `apps/api` chưa trả và 5.1 không được sửa `apps/*`.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-contract-hop-dong-cho-motion-control.md`
  summary: BE 5.3 phải kiểm `trimEnd > trimStart`, độ dài 3..Cap và giới hạn trên của Trim bằng `details.reason`; làm tròn `durationSeconds` kết quả (BE 5.6); thêm mock lỗi `VALIDATION_FAILED` kèm `details.reason` cho FE 5.7.
  evidence: Đã chạy `MotionCreateRequestSchema` với (7,2), (0,1), (0,1e21) vẫn parse; `VideoMeta.durationSeconds` là số thực còn kết quả là số nguyên.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-be-tai-video-len-va-kiem-tra-bang-ffprobe.md`
  summary: Chạy `confirm` song song hai request trên một khóa có thể xóa `in-raw/` hoặc để mồ côi `in/` (cả ảnh lẫn video).
  evidence: `reconcile-script.test` đã xác nhận pass khi đặt `RUNNINGHUB_WORKFLOW_BODY_RESHAPE` (chỉ thiếu biến môi trường khi chạy tay); mẫu `confirm` đua có từ Story 2.2.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-be-tai-video-len-va-kiem-tra-bang-ffprobe.md`
  summary: Thống nhất `DATABASE_URL` mặc định của test và `.env.example` (`motion_user`) với user Postgres của container local (`flowvis_user`).
  evidence: Chạy test phải truyền `DATABASE_URL` tay vì container local dùng `flowvis_user`; chưa rõ bên nào là cấu hình chuẩn nên chưa sửa.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-be-tao-task-motion-control-va-tinh-gia-phia-server.md`
  summary: Trước khi triển khai thật, gỡ nhánh chặn tạm `motion_control` → `failed`/`INTERNAL_ERROR` ở `task-worker.service.ts` (Story 5.5) và cân nhắc cờ chặn route `POST /tasks/motion` nếu có triển khai trước 5.5.
  evidence: Giữa 5.3 và 5.5 mọi Task Motion được tạo rồi luôn `failed`, người dùng sẽ thấy lỗi; chủ ý theo quyết định 3A.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-be-tao-task-motion-control-va-tinh-gia-phia-server.md`
  summary: Kiểm lại khóa/độ dài video trong cùng transaction với HOLD và thêm test hai `POST /tasks/motion` đồng thời cùng khóa.
  evidence: Có cửa sổ ngắn giữa kiểm khóa và HOLD (TOCTOU), cùng mẫu với Face Swap/Body Retouch; chưa có test đồng thời.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-7-fe-tai-video-mau-va-thanh-trim.md`
  summary: Thêm test mount `VideoTrimmer`/`ImageUploader` (phát `change`, hủy, thử lại, unmount) và tách bộ đọc độ dài khỏi hook kiểm thử `durationSeconds` trong `getVideoDuration`.
  evidence: Test thành phần hiện chỉ so chuỗi và biên dịch template; hàm thuần và `useUploadFlow` đã có test hành vi.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-4-be-cat-video-bang-ffmpeg-o-buoc-chuan-bi-cua-worker.md`
  summary: Thêm backoff cho `fetchWithRetry`, stream video vào/ra đĩa thay vì giữ cả `Buffer`, thư mục tạm theo tiến trình khi nhân bản worker, và tách singleton `videoTrim` khỏi vòng phụ thuộc `pipelines/` ↔ `tasks/` (DI) khi 5.5 đổi cấu trúc `prepare`.
  evidence: Giới hạn hiện tại 100 MB, 2 Lane, một worker; đo tải CPU/đĩa thật thuộc bước kiểm thử ffmpeg của Epic 6.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-8-fe-trang-motion-control-gia-truc-tiep-va-ket-qua-video.md`
  summary: Bổ sung `og:video:secure_url`/kích thước/Twitter player cho trang chia sẻ video, tải MP4 bằng liên kết thay vì blob, làm mới ảnh bìa hết hạn, và đo tải N+1 `GET /tasks/{id}/result` của thẻ lịch sử khi nối BE thật.
  evidence: Review nêu; spec cho phép N+1 ở Design Notes, kiểm ở Story 5.9.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-8-fe-trang-motion-control-gia-truc-tiep-va-ket-qua-video.md`
  summary: Tách `MotionWorkspacePanel` khỏi `FeatureWorkspaceDialog` (hiện `useMotionControl` chạy trong mọi dialog), gỡ `selectedSeconds` còn sót, và tìm hiểu lại quyết định bỏ ô cam kết ToS/`VietQRModal` tại chỗ nếu sản phẩm cần.
  evidence: Lệch AC 5.8 theo quyết định của người dùng (2A/3A/4B); `selectedSeconds` không còn dùng sau khi dialog nhúng `VideoTrimmer`.

- source_spec: `spec-5-5-be-gui-task-motion-len-runninghub.md`
  summary: Đối chiếu nodeId/fieldName của workflow Motion và các tham số không phải file bằng một lần chạy thật.
  evidence: nodeId `1`/`2` là `[ASSUMPTION]`; ánh xạ sai sẽ làm Task Motion thất bại ở RunningHub sau khi đã dùng GPU (Story 5.9).
- source_spec: `spec-5-5-be-gui-task-motion-len-runninghub.md`
  summary: Không bật Motion cho người dùng thật trước Story 5.6 (nhập kết quả video).
  evidence: Ingestor hiện tại chưa xử lý MP4; Task Motion `SUCCESS` kết thúc `failed`/`OUTPUT_UPLOAD_ERROR`, hoàn credit nhưng tốn GPU.
- source_spec: `spec-5-5-be-gui-task-motion-len-runninghub.md`
  summary: Hai suite không ổn định có từ trước: `reconcile-script.test.mjs` (fail ở baseline) và `signup-grant.test.mjs` (429 lẻ).
  evidence: Chạy lại với bản chưa sửa vẫn fail (reconcile mọi lần; signup-grant 1 trên 3 lần).

- source_spec: `spec-5-6-be-nhap-ket-qua-video-anh-bia-va-chia-se.md`
  summary: Tải video lên R2 bằng luồng thay vì đọc cả file vào bộ nhớ.
  evidence: `StoragePort.putObject` chỉ nhận `Buffer`; `ingestVideo` dùng `readFile` cho video tối đa 100 MB, nên ingest đồng thời có thể tốn bộ nhớ lớn.
- source_spec: `spec-5-6-be-nhap-ket-qua-video-anh-bia-va-chia-se.md`
  summary: Dọn khóa `out/` mồ côi khi worker chết giữa `putObject` và `transition`.
  evidence: Khóa đã ghi nhưng Task chưa `succeeded` không có bộ quét nào xóa; ingest chạy lại tạo cặp khóa mới.
- source_spec: `spec-5-6-be-nhap-ket-qua-video-anh-bia-va-chia-se.md`
  summary: Kiểm tra SSRF theo DNS đã phân giải thay vì chỉ tên host cho URL kết quả RunningHub.
  evidence: `isPublicHttpUrl` chỉ xét chuỗi URL; tên host công khai trỏ về IP nội bộ vẫn qua, và nhánh video nay tải tới 100 MB từ đó.
- source_spec: `spec-5-6-be-nhap-ket-qua-video-anh-bia-va-chia-se.md`
  summary: Test chia sẻ của Body Retouch trả 429 thay vì 302 (`body-retouch-result.test.mjs`, nhóm "chia sẻ").
  evidence: Fail cả khi bỏ thay đổi của story 5.6 (baseline 11 pass, 1 fail); Redis không còn khóa throttle sót lại nên chưa rõ nguyên nhân.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-9-integration-noi-fe-voi-be-va-smoke-test-motion-control.md`
  summary: Smoke Motion Control chưa quan sát được hai ffmpeg chạy chồng nhau trong worker (chỉ khẳng định `maxActive <= 2` ở RunningHub giả).
  evidence: Khóa FIFO được test đơn vị ở Story 5.4 nhưng không có tín hiệu cấp container; cần cơ chế đo (log hoặc đếm tiến trình ffmpeg trong worker), nên gộp vào benchmark ffmpeg của Epic 6.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-9-integration-noi-fe-voi-be-va-smoke-test-motion-control.md`
  summary: Job `smoke` của CI không cài hoặc kiểm `ffmpeg`/`ffprobe` (libx264) trên runner host trước khi smoke Motion Control sinh video mẫu.
  evidence: Smoke gọi `ffmpeg -f lavfi ... libx264` trên host `ubuntu-latest`; nếu image runner đổi, lỗi là ENOENT khó hiểu; cần bước `ffmpeg -version` hoặc cài đặt rõ ràng.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-1-contract-hop-dong-cho-van-hanh-va-quan-tri.md`
  summary: Chốt ánh xạ SM-1…SM-4 sang trường `successMetrics` (hiện 3 trường).
  evidence: SM-1/2 gộp vào `conversionRate`; BE 6.6 cần xác nhận và bổ sung nếu thiếu.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-1-contract-hop-dong-cho-van-hanh-va-quan-tri.md`
  summary: Định nghĩa `pausedReason` và hành vi `POST /admin/ops/resume` khi ví RunningHub vẫn cạn.
  evidence: Hợp đồng 6.1 chưa nêu; thuộc 6.2/6.3.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-1-contract-hop-dong-cho-van-hanh-va-quan-tri.md`
  summary: Chốt enum `rule`/`metrics` ngắt mạch và `action`/`target` nhật ký audit.
  evidence: Đang là chuỗi tự do; BE 6.2/6.4/6.5 có thể phát tên lệch nhau.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-1-contract-hop-dong-cho-van-hanh-va-quan-tri.md`
  summary: Định nghĩa hình dạng `GET /tasks/{id}/result` và `/s/{token}/info` cho Task đã gỡ (có `filesRemovedAt`).
  evidence: Chỉ có `filesRemovedAt` và hằng thông báo; BE 6.5 và FE 6.9 cần cùng quyết định.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-2-be-ngat-mach-va-chan-tao-task-khi-tam-dung.md`
  summary: Dựng cơ chế thử lại tối đa 5 lần cho cảnh báo Discord của ngắt mạch (và các cảnh báo Epic 6 khác), dùng chung ở 6.3/6.7.
  evidence: Hiện chỉ gửi một lần; nếu Discord lỗi đúng lúc kích hoạt thì admin không nhận cảnh báo, chỉ thấy cờ ở /system/status.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-2-be-ngat-mach-va-chan-tao-task-khi-tam-dung.md`
  summary: Thêm assert Cancel và chia sẻ không bị chặn khi `intake_paused` bật.
  evidence: `IntakeOpenGuard` chỉ gắn ba route tạo Task; test hiện chỉ kiểm GET /tasks và /system/status.
