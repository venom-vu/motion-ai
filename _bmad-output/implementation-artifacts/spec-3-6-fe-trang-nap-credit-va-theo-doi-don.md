---
title: 'Story 3.6: [FE] Trang nạp credit và theo dõi đơn'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '7afcd8536b1802b760963d781acca7cb13b7e991'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng chưa có giao diện trên web để chọn gói nạp credit, tạo đơn VietQR, quét mã thanh toán, xác nhận chuyển khoản và theo dõi trạng thái đơn nạp theo thời gian thực; các phương thức API nạp tiền của Story 3.1–3.3 chưa được tích hợp vào client.

**Approach:** Xây dựng trang `/topup` và linh kiện `VietQRModal` dạng Centered Dialog theo đúng thiết kế `mockups/vietqr-modal.html`, tích hợp các phương thức gọi API nạp tiền trong `api-client.ts`, tạo composable `useTopup` quản lý luồng tạo đơn, đếm ngược `qrExpiresAt` server-driven, xác nhận chuyển khoản idempotent, polling trạng thái đơn và tải danh sách lịch sử đơn nạp.

## Boundaries & Constraints

**Always:**
- Tuân thủ thiết kế Slate Cyber, 100% icon vector Lucide qua `<Icon name="lucide:..." />`, không dùng emoji trong UI chrome.
- Tuân thủ ranh giới di động: vùng chạm tối thiểu 48px (`min-h-[48px] min-w-[48px]`), hiển thị và hoạt động trơn tru trên màn hình chuẩn 360px.
- Mọi popup (`VietQRModal`) mở dạng Centered Dialog giữa màn hình theo CLAUDE.md và EXPERIENCE.md (không dùng Drawer/Bottom Sheet).
- Giá gói, số credit, trần thời lượng video và độ ưu tiên luôn lấy từ `GET /config/pricing`, không hardcode; số tiền thanh toán hiển thị theo dữ liệu trả về từ server.
- Bắt buộc tích cam kết ToS trước khi tạo đơn; chưa tích thì nút tạo đơn bị vô hiệu (`disabled`).
- Đồng hồ đếm ngược 15 phút tính dựa trên mốc `qrExpiresAt` do server trả về (`Date.parse(qrExpiresAt) - Date.now()`), không dùng bộ đếm 15 phút độc lập của máy khách. Khi hết hạn: hiển thị "Mã đã hết hạn", vô hiệu nút "Tôi Đã Chuyển Khoản Xong", cung cấp nút tạo mã mới.
- Nút "Tôi Đã Chuyển Khoản Xong" chỉ gọi API `POST /topups/{id}/confirm-transfer` đúng một lần (khóa trạng thái gửi để chống bấm nhiều lần).
- Đơn ở trạng thái `pending` nếu nằm ngoài khung giờ làm việc `[08:00, 23:00)` giờ Việt Nam (UTC+7) phải hiển thị thông báo giải thích đơn sẽ được duyệt từ 08:00 sáng hôm sau.
- Khi đơn chuyển sang `approved`, tự động kích hoạt làm mới thông tin tài khoản (`getMe()`) để cập nhật số dư credit và Tier trên header.
- Hiển thị thông báo tiếng Việt chính xác khi gặp các mã lỗi: `TOPUP_LIMIT`, `CONSENT_REQUIRED`, `ACCOUNT_LOCKED`, `RATE_LIMITED`.
- Danh sách đơn nạp hiển thị mới nhất trước, hỗ trợ phân trang cursor với nút tải thêm, có trạng thái rỗng và trạng thái lỗi.
- Sử dụng thư viện `qrcode` để kết xuất mã QR SVG an toàn cho cả SSR và Client [ASSUMPTION: spine chưa ghim thư viện này].

**Never:**
- Không gửi `amountVnd`, credit hay `tier` lên server khi tạo đơn (chỉ gửi `{ pack, consent: true }`).
- Không dùng Drawer hay Bottom Sheet cho modal VietQR trên di động.
- Không sửa backend (`apps/api`) hoặc packages contracts trong story này; chỉ chỉnh sửa trong phạm vi `apps/web/` và file khóa `pnpm-lock.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mở trang nạp tiền `/topup` | Khách hoặc người dùng đăng nhập | Hiển thị 3 gói nạp (Starter, Pro, Creator) từ `GET /config/pricing`, checkbox ToS chưa tích | Banner lỗi nếu tải bảng giá thất bại |
| Chưa tích ToS | Checkbox `consent = false` | Nút "Nạp gói qua VietQR" bị disabled | Không gửi request |
| Tạo đơn thành công | Đã đăng nhập, tích ToS, bấm chọn gói | Gọi `POST /topups`, mở `VietQRModal` hiển thị ảnh QR, số tiền VNĐ, nội dung `NAP <MÃ>`, STK nhận và đếm ngược | Bắt lỗi nếu API trả lỗi |
| Gặp lỗi giới hạn đơn | Đang có 3 đơn mở | Nhận `TOPUP_LIMIT` (409) | Hiển thị thông báo tiếng Việt: quá số đơn đang mở |
| Gặp lỗi tài khoản bị khóa | Tài khoản bị cấm | Nhận `ACCOUNT_LOCKED` (403) | Hiển thị thông báo tài khoản đã bị khóa |
| Đồng hồ QR về 0 | Đơn `awaiting_transfer` quá `qrExpiresAt` | Hiển thị "Mã đã hết hạn", nút xác nhận bị disabled, hiện nút tạo mã mới | Không cho bấm xác nhận |
| Bấm "Tôi Đã Chuyển Khoản Xong" | Đơn `awaiting_transfer`, còn hạn | Gọi `confirm-transfer` đúng 1 lần, trạng thái chuyển "Đang chờ duyệt" (`pending`) | Khóa nút chống double click |
| Đơn pending ngoài khung giờ | Giờ tạo ngoài `08:00–23:00` UTC+7 | Hiển thị banner giải thích duyệt từ 08:00 sáng hôm sau | N/A |
| Đơn được duyệt | Polling thấy status = `approved` | Thông báo thành công, reload `me` để cập nhật số dư và Tier | N/A |
| Đơn bị từ chối / cần xem xét | Status = `rejected` hoặc `needs_review` | Hiển thị lý do từ chối (`rejectReason`) hoặc ghi chú (`note`), hướng dẫn liên hệ hỗ trợ | N/A |
| Xem lịch sử đơn | Đã đăng nhập, mở `/topup` | Danh sách đơn nạp mới nhất trước, phân trang cursor, badge nhãn trạng thái tiếng Việt | Hiển thị trạng thái rỗng nếu chưa có đơn |

</frozen-after-approval>

## Code Map

- `apps/web/package.json` & `pnpm-lock.yaml`: bổ sung dependency `qrcode` và devDependency `@types/qrcode`.
- `apps/web/utils/topup.ts`: các hàm tiện ích tính giờ ngoài khung làm việc VN (08:00-23:00 UTC+7), tạo chuỗi SVG từ `qrPayload`, định dạng đếm ngược `mm:ss` từ server time.
- `apps/web/utils/api-client.ts`: thêm các phương thức `createTopup`, `confirmTopupTransfer`, `getTopup`, `listTopups` sử dụng schema từ `@motion-ai/contracts`.
- `apps/web/composables/useTopup.ts`: composable quản lý đơn nạp hiện tại, timer đếm ngược, polling trạng thái đơn, xác nhận chuyển khoản và danh sách đơn nạp.
- `apps/web/components/VietQRModal.vue`: component Centered Dialog hiển thị QR code, đồng hồ đếm ngược, nút sao chép thông tin tài khoản/nội dung chuyển khoản và nút xác nhận chuyển khoản.
- `apps/web/pages/topup.vue`: trang nạp tiền và theo dõi đơn đầy đủ tính năng theo AC Story 3.6.
- `apps/web/pages/pricing.vue`: cập nhật nút "Nạp gói qua VietQR" để điều hướng hoặc mở trực tiếp flow nạp tiền.
- `apps/web/test/topup.test.mjs`: test suite riêng kiểm tra toàn bộ luồng Story 3.6, các edge case của I/O Matrix, render component và tương thích viewport 360px.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/utils/topup.ts` -- Viết helper tiện ích -- tính toán khung giờ duyệt, đếm ngược server-driven, tạo ảnh QR SVG
- [x] `apps/web/utils/api-client.ts` -- Bổ sung topup API methods -- kết nối hợp đồng `@motion-ai/contracts` cho nạp tiền
- [x] `apps/web/composables/useTopup.ts` -- Xây dựng composable quản lý topup -- quản lý state đơn, đếm ngược, polling và danh sách đơn
- [x] `apps/web/components/VietQRModal.vue` -- Xây dựng Centered Dialog VietQR -- đúng chuẩn mockups/vietqr-modal.html
- [x] `apps/web/pages/topup.vue` -- Tạo trang nạp tiền và theo dõi đơn -- phủ toàn bộ AC Story 3.6
- [x] `apps/web/pages/pricing.vue` -- Liên kết flow nạp tiền từ bảng giá -- cho phép nạp trực tiếp khi bấm nút gói
- [x] `apps/web/test/topup.test.mjs` -- Viết bộ unit & integration tests -- kiểm thử I/O matrix, edge cases và component rendering

**Acceptance Criteria:**
- Given trang `/topup`, when mở, then hiển thị ba gói với giá VNĐ, số credit, thời lượng tối đa và độ ưu tiên từ `GET /config/pricing`, kèm checkbox ToS bắt buộc tích trước khi tạo đơn.
- Given người dùng chọn gói và bấm tạo đơn, when đơn `awaiting_transfer` được tạo, then hiển thị Centered Dialog với mã QR, số tiền, nội dung `NAP <MÃ>`, thông tin tài khoản nhận và đồng hồ đếm ngược tính từ `qrExpiresAt` của server.
- Given đồng hồ về 0, when chưa xác nhận, then hiển thị "Mã đã hết hạn", vô hiệu nút "Đã chuyển khoản" và hiển thị nút tạo mã mới.
- Given người dùng bấm "Tôi Đã Chuyển Khoản Xong", when gọi `confirm-transfer`, then chỉ gửi request 1 lần duy nhất dù người dùng click nhiều lần, và trạng thái chuyển sang "Đang chờ duyệt".
- Given đơn `pending` được tạo ngoài khung 08:00–23:00 UTC+7, when hiển thị, then có dòng giải thích đơn sẽ được duyệt từ 08:00 sáng hôm sau.
- Given đơn chuyển `approved`, when FE nhận trạng thái mới, then hiển thị thông báo thành công và cập nhật số dư/Tier trên tiêu đề.
- Given đơn chuyển `rejected`, `needs_review` hoặc `expired`, when FE nhận, then hiển thị lý do từ chối, hướng dẫn liên hệ hoặc nút tạo đơn mới tương ứng.
- Given các lỗi `TOPUP_LIMIT`, `CONSENT_REQUIRED`, `ACCOUNT_LOCKED`, `RATE_LIMITED`, when nhận khi tạo đơn, then hiển thị thông báo tiếng Việt chính xác.
- Given danh sách đơn nạp của người dùng, when mở, then hiển thị đơn mới nhất trước, hỗ trợ phân trang cursor, có trạng thái rỗng và lỗi.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- Sử dụng `qrcode.toString(payload, { type: 'svg', margin: 1 })` để tạo SVG thuần túy, an toàn cho SSR và nhẹ hơn canvas.
- Centered Dialog sử dụng CSS flexbox/grid căn giữa màn hình với `z-index: 50`, `max-width: 440px`, backdrop blur tối giản, vùng chạm nút tối thiểu 48px cho mobile 360px.
- Polling trạng thái đơn sử dụng khoảng thời gian 4 giây khi modal đang mở và trạng thái là `pending` hoặc `awaiting_transfer`, dừng ngay khi trạng thái đạt trạng thái cuối (`approved`, `rejected`, `expired`).

## Verification

**Commands:**
- `pnpm --filter @motion-ai/web run lint` -- expected: Không có lỗi ESLint
- `pnpm --filter @motion-ai/web run typecheck` -- expected: Kiểm tra kiểu TypeScript thành công 100%
- `node --test apps/web/test/topup.test.mjs` -- expected: Toàn bộ test case của Story 3.6 đều vượt qua (PASS)
- `pnpm test` -- expected: Toàn bộ monorepo test pass


### Review Findings

Phạm vi review: diff Story 3.4 (`apps/api`, commit `8fe69de`) + Story 3.6 (`apps/web`, chưa commit) so với `7afcd85`. Review ngày 2026-11-07.

- [x] [Review][Decision] "Tạo lại đơn" ép `consent = true` mà người dùng không tích lại ToS — `handleRecreateOrder` đặt `consent.value = true` rồi gọi `createOrder(pack, true)`. Lựa chọn: (a) giữ nguyên vì người dùng đã đồng ý ở đơn trước; (b) chọn sẵn gói nhưng bắt tích lại checkbox. [apps/web/pages/topup.vue:118-122]
- [x] [Review][Decision] `isOutsideHours` của đơn `pending` còn xét cả giờ hiện tại, lệch chữ AC (chỉ xét giờ tạo đơn) — đơn tạo 03:00, xem lúc 10:00 vẫn `pending` thì banner "ngoài giờ" hiện dù đang trong giờ. Lựa chọn: (a) theo đúng AC, chỉ dùng `createdAt`; (b) dùng `approveBy` do server trả làm nguồn sự thật; (c) giữ như hiện tại. [apps/web/composables/useTopup.ts:isOutsideHours]
- [x] [Review][Patch] `alertOverdue`: nếu câu UPDATE hoàn tác `overdue_notified_at` tự ném lỗi thì thoát vòng `for`, các đơn còn lại đã bị đánh dấu nhưng không bao giờ được gửi — bọc lệnh hoàn tác trong try/catch riêng và ghi log. [apps/api/src/modules/topups/topup-notifier.service.ts:222-227]
- [x] [Review][Patch] `sweepNotifications` để `retryPending` và `alertOverdue` chung một try: `retryPending` lỗi DB thì cảnh báo quá hạn bị bỏ qua — tách hai try. [apps/api/src/modules/topups/topup-sweeper.service.ts:36-40]
- [x] [Review][Patch] Thiếu test cho `scheduledSweep()` đường thông báo: xoá dòng `await this.sweepNotifications()` mà mọi test vẫn xanh. Thêm test chạy `scheduledSweep()` với `MOTION_PROCESS_ROLE=worker` (có gửi) và `api` (không gửi), kèm trường hợp `sweepExpired` ném lỗi. [apps/api/test/topups.test.mjs]
- [x] [Review][Patch] Test FE yếu: (1) `assert.match(html, /disabled/)` khớp mọi `disabled` trong HTML — thu hẹp vào `create-topup-button`; (2) chưa có test `confirmTransfer` thành công (sang `pending` và tiếp tục polling), polling dừng ở `rejected`/`expired`/`needs_review`, dừng sau 5 lỗi liên tiếp; (3) test polling `approved` chờ thật 4100 ms, nên dùng fake timer. [apps/web/test/topup.test.mjs]
- [x] [Review][Defer] Polling dừng im lặng sau 5 lỗi liên tiếp hoặc 401/403/404, không có thông báo hay nút làm mới — deferred: cải tiến UX, cần thiết kế thông báo; không phải lỗi sai nghiệp vụ. [apps/web/composables/useTopup.ts:startPolling]
- [x] [Review][Defer] `createNotifierPort` chấp nhận `http:` — deferred: đã ghi ở `deferred-work.md` (mục Story 3.6); siết `https:` sẽ làm hỏng test dùng máy chủ giả cục bộ. [apps/api/src/modules/ops/discord-notifier.adapter.ts:78-89]

#### Trạng thái xử lý (2026-11-07)

- Đã áp dụng: bỏ ép `consent = true` khi tạo lại đơn (chỉ tạo ngay nếu ToS đã tích); banner ngoài giờ của đơn `pending` dựa vào `approveBy` của server (`isApprovalDeferred`); tách try/catch ở `alertOverdue` và `sweepNotifications`; thêm test FE (confirm thành công, dừng polling ở trạng thái cuối, dừng sau 5 lỗi, dừng khi 401, `isApprovalDeferred`), dùng fake timer thay cho chờ 4100 ms, thu hẹp assertion `disabled`.
- Đã kiểm chứng: `typecheck`, `lint` sạch; test web 34/34 đạt.
- Test API `topups.test.mjs` 36/36 đạt (gồm test `scheduledSweep` mới); toàn bộ `pnpm test` đạt 350/353 (3 test E2E compose bị skip do cần `RUN_COMPOSE_E2E=1`), 0 lỗi.

#### Rejected

- `ME_KEY` không khớp key `useAsyncData` (false) — `ME_KEY` được export tại `useApiClient.ts:10` và `clearData` dùng chính key đó.
- Vòng phụ thuộc `TopupsModule` ↔ `OpsModule` (false) — `OpsModule` chỉ import `ScheduleModule`.
- Dữ liệu đơn người dùng cũ còn sau khi đổi tài khoản (false) — `useTopup()` tạo state theo từng lần gọi trong component, trang mới có state rỗng.
- `amount_vnd` là BigInt làm `JSON.stringify` ném lỗi (false) — cột kiểu int, Prisma trả `number`.
- `approve_by` NULL ở đơn `pending` (false) — `approve_by` được ghi cùng lúc chuyển sang `pending`.
- Gửi trùng Discord khi UPDATE `notified_at` lỗi (low) — giao hàng at-least-once, chấp nhận; chữa cần thêm cơ chế phức tạp.
- `alertOverdue` thử lại không giới hạn khi Discord hỏng (low) — hành vi này đã được chấp nhận trong Review Triage Log của 3.4 và có test.
- 429 tính vào 5 lượt thử (low) — Discord chỉ trả 429 khi bão tin; phát sinh tải thấp, fix cần thêm xử lý `Retry-After`.
- `confirmTransfer`/ghi đè `activeTopup` khi đóng modal giữa chừng (low) — polling tự dừng ở nhịp sau vì `isModalOpen = false`.
- Race `loadQrSvg`, khoá cuộn `body.overflow`, timer sao chép chưa dọn, thiếu focus trap (low) — hiếm gặp, fix thêm nhánh bảo vệ.
- Lệch đồng hồ client, trùng lặp khung giờ 08:00–23:00 ở FE/BE, thiếu chỉ mục cục bộ cho truy vấn quét, `?pack=` dạng mảng (low) — không có hậu quả thực tế ở quy mô MVP.
- Nút gói FREE ở `pricing.vue` thành `disabled` (low) — thay đổi vô hại.
