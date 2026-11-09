---
title: 'Story 3.4: [BE] Thông báo Discord cho Admin'
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

**Problem:** Khi đơn nạp chuyển `pending` hoặc quá hạn duyệt, Admin không được báo; `NotifierPort` mới chỉ có adapter ghi log nên cảnh báo đối soát sổ cái cũng không tới Discord.

**Approach:** Thêm adapter Discord webhook cho `NotifierPort` (chọn theo biến môi trường, thiếu thì giữ adapter log), một dịch vụ thông báo đơn nạp gửi đúng một thông báo `pending` có thử lại tối đa 5 lần qua bộ quét của worker, và đúng một cảnh báo quá `approve_by`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`; chỉ module `topups` ghi bảng `topups`. Không đổi `packages/contracts`.
- `DiscordNotifierAdapter` (`NotifierPort`) gửi `fetch` POST JSON `{content, allowed_mentions:{parse:[]}}` tới `DISCORD_WEBHOOK_URL`, có `AbortSignal.timeout`, cắt nội dung ≤ 2000 ký tự, và **ném lỗi** khi mạng lỗi, timeout hoặc HTTP không phải 2xx (kể cả 429). `createNotifierPort()` trả adapter Discord khi có `DISCORD_WEBHOOK_URL`, ngược lại `LogNotifierAdapter`; `OpsModule` dùng factory này nên cảnh báo `LEDGER_MISMATCH` cũng đi qua Discord.
- Không bao giờ ghi URL webhook vào log. Nội dung chỉ gồm mã đơn (`code`), gói, số tiền VNĐ, thời hạn duyệt, `topupId`; **không** email, token, tên người dùng hay thông tin tài khoản nhận tiền.
- Thông báo `pending`: khi `confirmTransfer` thắng CAS, gọi gửi không chặn (lỗi chỉ ghi log, yêu cầu của người dùng vẫn thành công); idempotent và nhánh lặp không gửi. Trước mỗi lần gửi, "nhận phiên" bằng UPDATE có điều kiện: `status='pending' AND notified_at IS NULL AND notify_attempts < 5 AND (notify_attempted_at IS NULL OR notify_attempted_at < now() - interval '60 seconds')`, đặt `notify_attempts+1` và `notify_attempted_at=now()`; chỉ bên nhận được phiên mới gửi. Gửi xong mới đặt `notified_at=now()` (UPDATE `WHERE notified_at IS NULL`).
- Bộ quét (`TopupSweeperService`, chỉ worker, cùng chu kỳ 30 giây): gửi lại các đơn `pending` còn `notified_at` rỗng theo cùng cách nhận phiên; đơn đạt 5 lần thất bại thì ghi log lỗi một lần (kèm `topupId`) rồi bỏ qua.
- Cảnh báo quá hạn: bộ quét tìm đơn `pending` có `approve_by < now()` và `overdue_notified_at IS NULL`, nhận bằng `UPDATE … SET overdue_notified_at=now() … RETURNING` rồi mới gửi (tối đa một lần, không lặp ở các lần quét sau); gửi lỗi chỉ ghi log lỗi.
- Migration mới thêm `notify_attempts INT NOT NULL DEFAULT 0` và `notify_attempted_at TIMESTAMPTZ`; cập nhật model Prisma; thêm `DISCORD_WEBHOOK_URL=` (tùy chọn, có chú thích) vào `.env.example`.
- Test dùng máy chủ HTTP giả (`http.createServer`, `listen(0)`) thay Discord thật, theo mẫu `test/runninghub-openapi.test.mjs`.

**Never:**
- Không gọi Discord thật trong test; không sửa `apps/web`, `packages/contracts`; không làm `/admin/**`, `admin_audit` hay duyệt/từ chối (story 3.5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Đơn mới `pending` | `confirmTransfer` thắng, Discord ổn | Đúng 1 request tới Discord (mã đơn, gói, số tiền, hạn duyệt); `notified_at` được đặt | N/A |
| Discord lỗi | Server giả trả 500 hoặc không phản hồi | `confirmTransfer` vẫn 200; `notified_at` rỗng, `notify_attempts` = 1 | Ghi log, không ném ra người dùng |
| Thử lại sau lỗi | Đã quá 60 giây, Discord phục hồi | Bộ quét gửi lại, `notified_at` được đặt, không gửi lần hai | N/A |
| Hết lượt thử | 5 lần đều lỗi | Không gửi thêm ở các lần quét sau | Log lỗi 1 lần có `topupId` |
| Hai bên cùng gửi | Request thông báo và bộ quét đua | Đúng 1 request Discord cho đơn | Bên không nhận phiên bỏ qua |
| Xác nhận lặp | Đơn đã `pending` | Không gửi thêm | N/A |
| Quá hạn duyệt | `pending`, `approve_by` đã qua | 1 cảnh báo quá hạn, `overdue_notified_at` được đặt; các lần quét sau không gửi lại | Lỗi gửi chỉ ghi log |
| Nội dung an toàn | Mọi request tới server giả | Không chứa email, token, số tài khoản, tên chủ tài khoản, URL webhook | N/A |
| Không cấu hình webhook | `DISCORD_WEBHOOK_URL` trống | Dùng adapter log, không lỗi | N/A |
| Cảnh báo đối soát | Reconcile gọi `notify` khi có webhook | Đi qua Discord | Lỗi được reconcile bắt như cũ |

</frozen-after-approval>

## Code Map

- `apps/api/src/ports/index.ts` -- `NOTIFIER_PORT`, `NotifierPort.notify(event)`, `NotifierEvent`; không sửa.
- `apps/api/src/modules/ops/log-notifier.adapter.ts`, `ops.module.ts` -- adapter log và binding `useExisting`; đổi binding thành factory `createNotifierPort()`, thêm `discord-notifier.adapter.ts` cùng thư mục (mẫu chọn theo env: `tasks/runninghub-http.adapter.ts` `createRunningHubPort`).
- `apps/api/src/modules/tasks/task-sweeper.service.ts:85` -- mẫu `notify(...).catch(log)`; không sửa.
- `apps/api/src/modules/topups/topups.service.ts` (`confirmTransfer`, nhánh `won.length > 0`), `topup-sweeper.service.ts` (`sweepExpired`, cờ `running`), `topups.module.ts` -- thêm `topup-notifier.service.ts`, import `OpsModule` (như `tasks.module.ts`), mở rộng bộ quét.
- `apps/api/prisma/schema.prisma` (model `Topup` ~dòng 155), `prisma/migrations/20261107000000_topups` -- thêm cột đếm ở migration mới đặt sau nó.
- `apps/api/test/runninghub-openapi.test.mjs` -- mẫu máy chủ HTTP giả; `test/topups.test.mjs` -- thêm test; `.env.example`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/ops/discord-notifier.adapter.ts`, `ops.module.ts` -- adapter Discord và `createNotifierPort()` -- cảnh báo qua Discord khi có webhook
- [x] `apps/api/prisma/schema.prisma`, `prisma/migrations/<mới>/migration.sql` -- cột `notify_attempts`, `notify_attempted_at` -- bộ đếm thử lại
- [x] `apps/api/src/modules/topups/topup-notifier.service.ts`, `topups.service.ts`, `topup-sweeper.service.ts`, `topups.module.ts` -- gửi `pending`, thử lại, cảnh báo quá hạn -- yêu cầu của story
- [x] `apps/api/.env.example` -- `DISCORD_WEBHOOK_URL` -- cấu hình
- [x] `apps/api/test/topups.test.mjs` (và test adapter nếu tách) -- test I/O Matrix với máy chủ HTTP giả -- bằng chứng

**Acceptance Criteria:**
- Given đơn chuyển `pending` và Discord lỗi, when người dùng gọi `confirm-transfer`, then nhận 200 và bộ quét gửi lại thành công sau đó với đúng một thông báo đến Discord.
- Given adapter Discord, when kiểm tra mọi body gửi đi, then không có email, token, thông tin tài khoản nhận tiền hay URL webhook.
- Given có `DISCORD_WEBHOOK_URL`, when Reconcile phát `LEDGER_MISMATCH`, then request tới Discord giả.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Cảnh báo quá hạn: đặt `overdue_notified_at` trước khi gửi nên Discord lỗi làm mất cảnh báo vĩnh viễn, không test | high | patch | `catch` chỉ ghi log; đã hoàn tác `overdue_notified_at=NULL` khi gửi lỗi và thêm test gửi lỗi rồi gửi lại đúng một lần |
| `SELECT` thử lại không lọc `notify_attempts`, đơn hết lượt chiếm hết cửa sổ `LIMIT 100` | medium | patch | Từ 100 đơn hết lượt trở lên, đơn mới không bao giờ được thử lại; đã thêm `notify_attempts < 5` vào truy vấn |
| Log "hết lượt" dùng `Set` trong bộ nhớ: tăng không giới hạn, log lại sau mỗi lần khởi động | medium | patch | Đã bỏ `Set`; log ngay tại lượt thất bại thứ 5 dựa vào `notify_attempts` ở DB |
| `sweepExpired` ném lỗi thì bỏ qua `sweepNotifications` trong cùng nhịp | low | patch | Tự bắt lỗi nên khó xảy ra, nhưng sửa là một dòng `try/catch`; đã cô lập |
| `DISCORD_WEBHOOK_URL` sai định dạng làm mọi lần gửi đều lỗi và cạn 5 lượt | medium | patch | `fetch` ném `TypeError`; đã kiểm tra URL, sai thì dùng adapter log và ghi một dòng lỗi không in URL |
| Cắt `slice(0, 2000)` có thể tách cặp surrogate | low | patch | Đã cắt theo code point, thêm dấu `…` |
| Test khôi phục `DISCORD_WEBHOOK_URL = prev` khi `prev` là `undefined` thành chuỗi `'undefined'` | medium | patch | Dòng 788 của test; đã sửa thành xóa biến khi `prev` chưa đặt |
| Mỗi lượt thử đốt một lần dù quy trình chết hoặc Discord 429 nên outage ~5 phút làm mất thông báo | low | reject | Spec quy định tối đa 5 lần và ghi log lỗi; xử lý `Retry-After` là mở rộng ngoài AC |
| Quá hạn không có `LIMIT`/digest khi có nhiều đơn cùng lúc | low | reject | Ngoài AC; khối lượng MVP nhỏ |
| `notified_at` UPDATE lỗi sau khi gửi thành công thì gửi trùng | low | reject | Chấp nhận at-least-once; không phải dữ liệu tiền |
| `notifyPending` chạy trong tiến trình API, thử lại chỉ ở worker | false | - | Đúng thiết kế AD: bộ quét chỉ ở worker; `notifyPending` ban đầu không phụ thuộc vai trò |
| SQL thô ghi `topups` từ `TopupNotifierService` vi phạm AD-1 | false | - | Cùng module `topups` sở hữu bảng; `make_interval` đã được test chạy thật |
| Thiếu chỉ mục cho truy vấn thử lại/quá hạn; thiếu CHECK `attempts >= 0` | low | reject | Khối lượng MVP nhỏ; cột có `DEFAULT 0` và chỉ tăng |
| Thiếu liên kết trang Admin, embed, test đa instance, test timeout | low | reject | Ngoài AC; trang Admin thuộc 3.7 |

## Verification

**Commands:**
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua `deploy/compose.yml`; không chạy song song với lượt test khác)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass
