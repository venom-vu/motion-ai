---
title: 'Story 6.7: [BE] Sao lưu PostgreSQL lên R2'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '03b0b0102df405e56a97d601be22771ec6ceeea5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sổ cái credit và đơn nạp chỉ nằm trong một PostgreSQL trên VPS; sự cố VPS làm mất dữ liệu và chưa có cách khôi phục hay cảnh báo khi không có bản sao lưu (AR22).

**Approach:** Job chạy riêng trong tiến trình `worker` lúc 03:00 giờ Việt Nam: `pg_dump` custom format → kiểm tra bằng `pg_restore --list` → tải lên R2 `db-backup/<ngày-giờ>.dump` → `HEAD` xác nhận → giữ 7 bản mới nhất. Kèm cảnh báo Discord, `settings.last_backup`, cảnh báo quá 36 giờ, script restore-drill và `deploy/RESTORE.md`.

## Boundaries & Constraints

**Always:**
- Nhánh `be/*`: chỉ sửa `apps/api/`, `deploy/`, `pnpm-lock.yaml`; không sửa `.github/`, `scripts/` gốc, `packages/contracts`, `apps/web`; không thêm phụ thuộc npm; vẫn đúng bốn container. Phần CI (bước `pg_dump --version`, chạy restore-drill) tách sang nhánh `shared/*` (ghi `deferred-work.md`).
- `deploy/Dockerfile` (stage runtime, cạnh `ffmpeg`): cài `postgresql-client-16` (qua kho PGDG vì Bookworm mặc định là PG15) để có `pg_dump`/`pg_restore` 16, khớp server `postgres:16`.
- Job nằm trong service Nest mới (module `ops`), `@Cron('0 3 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })`, chỉ chạy khi `MOTION_PROCESS_ROLE === 'worker'`; có cờ chống chạy chồng.
- Chạy `pg_dump` bằng `execFile` với mảng đối số cố định (`--format=custom`, `--file`, `--dbname` không chứa mật khẩu), mật khẩu và host/user qua biến môi trường `PG*` suy ra từ `DATABASE_URL` (bỏ `?schema=` trước khi tách). Ghi vào thư mục tạm riêng (`mkdtemp`), xóa thư mục trong `finally`.
- Trước khi tải lên: `pg_restore --list` thoát 0 và file lớn hơn 0 byte; thất bại → không tải lên, không xóa bản cũ. Tải bằng `putObject` một lần (giả định dump < 5 GB), rồi `head` xác nhận `sizeBytes` bằng file local; chỉ sau đó mới giữ 7 bản mới nhất theo tên khóa (`db-backup/` sắp theo thời gian) và xóa phần còn lại. `StoragePort` thêm `list(prefix)` (ListObjectsV2, phân trang).
- Bất kỳ bước nào lỗi: `settings.last_backup` = `{at, result:'failed', sizeBytes:null}` và đúng một cảnh báo Discord nêu tên bước (`dump`, `verify`, `upload`, `confirm`, `retention`), không chứa mật khẩu, đường dẫn kết nối hay stderr thô. Thành công: `{at, result:'success', sizeBytes}`; `ops.controller` `buildStatus` trả `lastBackup` thật (hiện là `null`).
- Cảnh báo "Quá 36 giờ chưa có bản sao lưu": do bộ quét 30 giây trong `worker` kiểm tra; không có bản `success` nào trong 36 giờ → gửi đúng một lần qua `AlertService.raise`, cờ trạng thái trong `settings` (theo mẫu `RhBalanceService`); chỉ gửi lại sau khi có bản thành công rồi lại quá hạn. Hệ thống mới khởi tạo (chưa có `last_backup`) tính 36 giờ từ lần quét đầu ghi mốc khởi điểm.
- `scripts/configure-bucket.ts`: các quy tắc lifecycle hiện có (`in-raw/`, `in/`, `out/`) chỉ theo tiền tố riêng nên không áp dụng cho `db-backup/`; giữ nguyên và thêm chú thích, test xác nhận không có quy tắc nào khớp `db-backup/`. Ghi vào `deploy/README.md` rằng mã hóa phía ứng dụng và khóa R2 riêng cho sao lưu nằm ngoài MVP (R2 mã hóa lưu trữ mặc định).
- Restore-drill: `apps/api/src/scripts/restore-drill.ts` (build ra `dist/scripts/`, vai trò `script`): tải bản mới nhất từ R2, `pg_restore` vào cơ sở dữ liệu tạm (tạo/xóa), kiểm tra với mỗi user `balance = SUM(ledger_entries.amount)` và `held` khớp sổ cái, in JSON `{ok, durationMs, checked}` và thoát 0/1. `deploy/RESTORE.md` (tiếng Việt) mô tả các bước khôi phục, chạy drill, và rằng Redis không sao lưu: sau khôi phục PostgreSQL, bộ quét Story 2.7 dựng lại hàng đợi từ trạng thái Task.
- Worker có đủ biến `R2_*`, `DISCORD_WEBHOOK_URL` trong khối `nestjs-worker` của `deploy/compose.yml` (thêm nếu thiếu).

**Never:** Không truyền mật khẩu qua tham số dòng lệnh hay ghi vào log/cảnh báo; không chạy job trong tiến trình `api`; không xóa bản cũ trước khi bản mới xác nhận; không thêm container; không dùng shell (`exec` với chuỗi); không sửa lifecycle của `in-raw/`, `in/`, `out/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sao lưu thành công | 03:00, DB có dữ liệu | Dump → `--list` đạt → PutObject → HEAD khớp → giữ 7, xóa dư; `last_backup` success + dung lượng; thư mục tạm bị xóa | N/A |
| `pg_dump` lỗi | Lệnh thoát ≠ 0 | Không tải lên, không xóa bản cũ, `last_backup` failed, một cảnh báo bước `dump` | Thư mục tạm vẫn xóa |
| Dump hỏng / rỗng | `pg_restore --list` lỗi hoặc 0 byte | Không tải lên, không xóa bản cũ, cảnh báo bước `verify` | Như trên |
| Tải lên lỗi / lệch kích thước | PutObject lỗi hoặc HEAD khác size | Không xóa bản cũ, cảnh báo `upload`/`confirm` | Như trên |
| Giữ 7 bản | 9 bản trên R2 | Còn 7 mới nhất; lỗi khi xóa không làm mất bản vừa tải, cảnh báo `retention` | N/A |
| Không có bản 36 giờ | Quá 36 giờ không `success` | Đúng một cảnh báo, không lặp ở các lần quét sau | Gửi lại chỉ sau khi có `success` rồi quá hạn lại |
| Lộ bí mật | Lỗi có mật khẩu trong stderr/URL | Cảnh báo và log không chứa mật khẩu hay chuỗi kết nối | N/A |
| Chạy ngoài worker | Tiến trình `api` | Job và bộ quét không chạy | N/A |
| Restore-drill | Dump nhỏ hợp lệ | Khôi phục vào DB tạm, đối chiếu `balance`/`held`, in `{ok:true,durationMs}`, xóa DB tạm | Lệch sổ cái hoặc lỗi → `{ok:false}`, thoát 1 |

</frozen-after-approval>

## Code Map

- `deploy/Dockerfile` l.20–22 -- runtime đã cài `ffmpeg`; thêm kho PGDG và `postgresql-client-16`.
- `deploy/compose.yml` l.83–101 -- khối `nestjs-worker`; thêm `R2_*`, `DISCORD_WEBHOOK_URL` nếu thiếu. `deploy/README.md` (mục Bucket R2), thêm `deploy/RESTORE.md`.
- `apps/api/src/modules/ops/reconcile.service.ts` l.24–42 -- mẫu `@Cron(..., { timeZone: 'Asia/Ho_Chi_Minh' })` + guard worker + `notify` khi lỗi.
- `apps/api/src/modules/ops/settings.service.ts` l.5–69 -- `SETTING_KEYS`, `getRhBalance`/`saveRhBalance`; thêm `last_backup`, `backup_stale_alerted`, `getLastBackup`, `saveLastBackup`.
- `apps/api/src/modules/ops/alert.service.ts`, `modules/tasks/rh-balance.service.ts` l.40–72 -- `raise(key, event)` idempotent; mẫu cờ "cảnh báo một lần đến khi hồi phục".
- `apps/api/src/modules/ops/ops.controller.ts` l.55 -- `lastBackup: null` → `settings.getLastBackup()`; contract `packages/contracts/src/ops.ts` l.24–30 (không đổi).
- `apps/api/src/ports/index.ts` l.102–116, `modules/storage/s3-storage.adapter.ts` -- thêm `list(prefix)` (ListObjectsV2); `putObject`, `head`, `delete` dùng lại.
- `apps/api/src/scripts/configure-bucket.ts` l.45–62 -- lifecycle theo tiền tố; thêm chú thích, không đổi quy tắc.
- `apps/api/src/scripts/reconcile.ts` -- mẫu script vai trò `script`; `apps/api/src/worker.ts`, `modules/ops/ops.module.ts` -- đăng ký service.
- `apps/api/.env.example`, `deploy/.env.example` -- tài liệu biến; `apps/api/test/` -- mẫu `*.test.mjs` và `s3-storage-adapter.test.mjs`.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/Dockerfile`, `deploy/compose.yml`, `deploy/README.md`, `deploy/RESTORE.md` -- client PG16, biến worker, tài liệu bucket và khôi phục -- hạ tầng và tài liệu
- [x] `apps/api/src/ports/index.ts`, `modules/storage/s3-storage.adapter.ts` -- `list(prefix)` có phân trang -- giữ 7 bản
- [x] `apps/api/src/modules/ops/` (service sao lưu với runner `execFile` thay thế được, `SettingsService`, `ops.controller`, `ops.module`) -- job 03:00, kiểm tra, tải, giữ 7, cảnh báo, `last_backup`, bộ quét 36 giờ -- chức năng chính
- [x] `apps/api/src/scripts/restore-drill.ts`, `configure-bucket.ts` -- script restore-drill, chú thích lifecycle -- khôi phục và bucket
- [x] `apps/api/test/backup.test.mjs` -- test I/O Matrix bằng runner/storage giả (không cần `pg_dump` cục bộ), mật khẩu không lộ, không chạy ngoài worker, lifecycle không khớp `db-backup/`; test tích hợp `pg_dump`/restore-drill chỉ chạy khi có binary và báo rõ lý do khi bỏ qua -- phủ ranh giới

**Acceptance Criteria:**
- Given sao lưu lỗi ở bất kỳ bước nào, when xong, then bản cũ nguyên vẹn, thư mục tạm không còn và cảnh báo không chứa mật khẩu hay chuỗi kết nối.
- Given `pnpm --filter @flowvis/api test`, `lint`, `typecheck`, `build`, `check:boundaries` (chỉ file của story này), when chạy, then pass (trừ test lỗi có sẵn ở Story 2.14, 5.2 và throttle).

## Implementation Notes

- `BackupService` (module `ops`, đăng ký ở `OpsAdminModule`) + `backup-pg.ts` (suy `PG*` từ `DATABASE_URL`, `execFile` không shell, môi trường con tối thiểu) + `StoragePort.list` + `scripts/restore-drill.ts`. Bản sao lưu ghi `last_backup` success ngay sau bước `confirm`, rồi mới chạy retention; retention lỗi chỉ gửi một cảnh báo bước `retention`, không đánh dấu thất bại. Retention và restore-drill chỉ xét khóa khớp `BACKUP_KEY_RE`.
- Suite api (đúng script `test`, không chạy song song): 545 pass, 5 fail có sẵn (Story 2.14, 5.2, throttle), 7 skip.
- Đã xác minh thật trong image worker (Docker): `pg_dump`/`pg_restore` 16.15; test tích hợp `pg_dump` thật pass khi mount `test/` và `dist/` vào container; khôi phục dump 54 KB vào DB tạm ra 23 user, 0 lệch `balance` so với sổ cái. Chưa chạy trực tiếp `restore-drill.ts` (cần R2 thật); đã kiểm tra công thức `held` trùng `ReconcileService`.
- Test `lifecycle configure-bucket` đọc file nguồn `src/scripts/configure-bucket.ts` nên chỉ chạy được trong repo, không chạy trong image runtime (image không chứa `src/`).
- `check:boundaries` báo cả file các story trước (`packages/contracts`, `apps/web`) vì nhánh xếp chồng trên nhánh 6.6 chưa merge; file của story này chỉ ở `apps/api/`, `deploy/`, `_bmad-output/`.
- Phần CI (`pg_dump --version`, chạy restore-drill) và các gia cố TLS/PGDG ghi trong `deferred-work.md`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Retention lỗi làm bản đã tải và xác nhận bị ghi `failed`, `last_backup_success_at` không tiến, cảnh báo 36 giờ có thể bắn sai | medium | patch | `run()` ném `StepError('retention')` trước `saveLastBackup(success)`; ba bên cùng báo |
| Retention và "latest" sắp theo chuỗi, khóa lạ hoặc lệch đồng hồ làm xóa nhầm bản tốt hoặc khôi phục nhầm | medium | patch | Chỉ lọc `.endsWith('.dump')`; cần khớp mẫu khóa chuẩn |
| `S3StorageAdapter.list` (phân trang) chưa có test | medium | patch | Test sao lưu dùng storage giả; không test nào chạm `ListObjectsV2` |
| Test "tích hợp pg_dump thật" chỉ kiểm `existsSync(tmpdir())` | medium | patch | Không chạy `pg_dump` dù có binary; spec yêu cầu test tích hợp |
| `lastBackup` của `/admin/ops/status` chưa được kiểm | medium | patch | Không test nào đọc `lastBackup`; trả `null` cố định vẫn pass |
| `fail()` có thể ném làm `backup()` vi phạm cam kết không ném | false | - | `AlertService.raise` bọc try/catch toàn bộ và trả `false` khi lỗi (alert.service.ts l.34–47) |
| Khóa cảnh báo chứa timestamp nên khử trùng của `AlertService` vô dụng | low | reject | Chỉ một lần bắn nhờ cờ `running` và `backup_stale_alerted` trong `settings`; cùng mẫu `RhBalanceService` |
| `pgConnectionFromUrl` bỏ `sslmode` và `childEnv` bỏ `PGSSL*`, `HOME`, `TMPDIR` | low | defer | Postgres chạy trong compose cùng mạng, không TLS; DB từ xa cần TLS là cấu hình tương lai |
| Cron lỡ lúc 03:00 không chạy bù | low | reject | Spec quy định chỉ cảnh báo 36 giờ để phát hiện job không chạy |
| Nhiều worker chạy đồng thời, khóa theo giây | low | reject | Compose chạy đúng một worker; ngoài phạm vi MVP |
| Kiểm tra toàn vẹn chỉ bằng kích thước | low | reject | Spec quy định `HEAD` khớp kích thước và `pg_restore --list` |
| Thông điệp lỗi `execFile` nghèo chẩn đoán (timeout, binary thiếu) | low | reject | Cố ý không đưa stderr hay đối số vào lỗi để không lộ bí mật (spec) |
| `mkdtemp` lỗi báo nhầm bước `dump` | low | reject | Cả hai đều là lỗi chuẩn bị chạy dump; không gây sai hành vi |
| Tải cả dump vào bộ nhớ, trần 5 GB | low | reject | Spec chấp nhận theo giả định dưới 5 GB |
| `checkStale` quét 30 giây, `watchSince` không xóa | low | reject | Spec quy định bộ quét 30 giây; chi phí vài truy vấn nhỏ |
| `saveLastBackup` ghi hai khóa không nguyên tử | low | reject | Lệch chỉ kéo dài một chu kỳ; lần sao lưu sau ghi lại cả hai |
| restore-drill: thiếu `mismatches` trong JSON, `pg_restore` cảnh báo vô hại, nạp dump vào bộ nhớ | low | reject | Spec quy định đúng ba trường `{ok,durationMs,checked}`; công thức `held` khớp `ReconcileService` (reconcile.service.ts l.56–62) |
| Dockerfile tải khóa PGDG qua mạng không ghim vân tay, `curl`/`gnupg` còn trong image | low | defer | Đã build thành công và xác nhận `pg_dump` 16.15; ghim vân tay là gia cố chuỗi cung ứng riêng |
| Cấu hình cron `0 3 * * *` và múi giờ chưa có test | low | reject | Một hằng số, cùng mẫu `ReconcileService` đã chạy |
| Compose/Docker chỉ kiểm thủ công, CI chưa có | low | defer | Đã ghi `deferred-work.md` (làm trên nhánh `shared/*`) |
| `.env.example` và tài liệu RESTORE thiếu RPO/RTO, phiên bản `pg_restore` | low | reject | Tài liệu bổ sung, không sai hành vi; ngoài tiêu chí AC |

## Design Notes

`putObject` nhận nguyên `Buffer` nên dump nằm trong bộ nhớ; chấp nhận cho MVP theo giả định < 5 GB (dump hiện rất nhỏ). Cần `list(prefix)` vì giữ "7 bản mới nhất" phải biết các khóa hiện có. Runner `execFile` được tiêm vào service để test không cần `pg_dump` thật; máy phát triển không cài `postgresql-client`, còn image worker có.

## Verification

**Commands:**
- `node --env-file=.env --import ./test/helpers/ops-preload.mjs --test --test-concurrency=1 test/*.test.mjs` (trong `apps/api`, cần Docker, không chạy song song suite khác) -- expected: chỉ các fail có sẵn
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `docker build -f deploy/Dockerfile -t nestjs-worker:check . && docker run --rm --entrypoint pg_dump nestjs-worker:check --version` -- expected: `pg_dump (PostgreSQL) 16.x`
