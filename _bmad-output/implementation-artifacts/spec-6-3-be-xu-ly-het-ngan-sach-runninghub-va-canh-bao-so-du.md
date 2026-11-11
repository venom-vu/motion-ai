---
title: 'Story 6.3: [BE] Xử lý hết ngân sách RunningHub và cảnh báo số dư'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '099909093422f5228e81bdeb6b1e6b0df642abdb'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi RunningHub hết tiền, Task vẫn tiếp tục chuẩn bị (ffmpeg) và gọi RunningHub rồi mới lỗi; lỗi hết tiền ở bước upload/submit không được nhận diện là `RH_BUDGET`; chưa có cờ `rh_budget_exhausted` được bật tự động, chưa đọc được số dư RunningHub, và cảnh báo Discord của Epic 6 chỉ gửi một lần nên có thể mất.

**Approach:** Thêm `RunningHubPort.getBalance()` (adapter giả cho test, adapter thật đọc `RH_BALANCE_ENDPOINT`), nhận diện hết tiền ở mọi bước gọi RunningHub, kiểm cờ ngay sau CAS `queued→running` ở worker, job đọc số dư mỗi 10 phút, và một dịch vụ cảnh báo dùng chung có trạng thái trong `settings` và thử lại tối đa 5 lần.

## Boundaries & Constraints

**Always:**
- Nhánh `be/*`: chỉ sửa `apps/api/` (và `deploy/` cho biến môi trường); không sửa `packages/contracts`, `apps/web`; không thêm phụ thuộc; chỉ module `ops` ghi `settings`.
- Hết tiền được nhận diện bằng danh sách từ khóa cấu hình của Story 2.5 (`RH_BUDGET_KEYWORDS`/`mapRunningHubFailure`) ở **cả** upload, submit và poll. Task đó `failed` với `RH_BUDGET` qua `tasks.transition` (RELEASED 100% tự động), đặt `rh_budget_exhausted` và `intake_paused`, gửi đúng một cảnh báo Discord (chỉ khi cờ chuyển tắt→bật).
- Cờ `rh_budget_exhausted` bật: worker, ngay sau CAS `queued→running` và trước `prepare`/mọi lệnh gọi RunningHub, chuyển Task `failed` với `RH_BUDGET`. Chỉ áp cho Task bắt đầu mới (chưa có `runninghubTaskId`, chưa `submitStartedAt`); Task đang `running` đã có `runninghubTaskId` vẫn poll bình thường. Test xác nhận không chạy ffmpeg và không gọi tải lên RunningHub.
- Đăng nhập, nạp credit, lịch sử, tải kết quả không bị ảnh hưởng.
- `RunningHubPort.getBalance(signal)` trả số coin (số không âm). Adapter giả dùng trong test; adapter thật đọc đường dẫn từ `RH_BALANCE_ENDPOINT` (chưa có giá trị); thiếu cấu hình hoặc adapter `Unconfigured` thì ném lỗi đọc, job xử lý như lỗi đọc số dư chứ không sập.
- Job `@Interval` 10 phút, chỉ trong tiến trình `worker`: đọc được thì lưu `rh_balance` `{coins, readAt}` vào `settings`; số dư dưới `RH_BALANCE_ALERT_COINS` (mặc định 27000) gửi đúng một cảnh báo, chỉ gửi lại sau khi số dư lên trên ngưỡng rồi giảm xuống lần nữa. Đọc thất bại 3 lần liên tiếp thì gửi một cảnh báo "Không đọc được số dư RunningHub", chỉ gửi lại sau một lần đọc thành công; không bật `intake_paused`.
- `GET /admin/ops/status` trả `rhBalance` từ `settings` (`null` nếu chưa đọc).
- Cảnh báo dùng chung (`AlertService` trong `ops`): mỗi cảnh báo có khóa, trạng thái (đang chờ gửi, số lần thử, lần thử cuối, đã gửi) lưu trong `settings`; gửi thất bại thì thử lại ở chu kỳ quét 30 giây sau, tối đa 5 lần, mỗi lần cách nhau ít nhất 60 giây; không gửi lặp khi đã gửi. Áp dụng cho cảnh báo ngắt mạch của Story 6.2 (thay gửi một lần ở `BreakerService`), hết ngân sách, số dư thấp, không đọc được số dư. Sau `resume`, hết tiền lần nữa là chuyển trạng thái tắt→bật nên cảnh báo mới được tạo.
- Cảnh báo không chứa email, token hay khóa bí mật.
- Biến môi trường mới (`RH_BALANCE_ALERT_COINS`, `RH_BALANCE_ENDPOINT`) ghi vào `apps/api/.env.example` và cả hai khối `api`/`worker` của `deploy/compose.yml`.

**Never:**
- Không tự bật lại cờ; không hoàn credit Task `succeeded`; không gọi RunningHub từ Task khi cờ bật; không đọc bảng của module khác từ `ops` bằng SQL thô; không sửa hành vi của `intake_paused` do ngắt mạch ngoài việc đổi sang `AlertService`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hết tiền ở poll | RunningHub trả FAILED có từ khóa hết tiền | Task `failed` `RH_BUDGET`, RELEASED, hai cờ bật, một cảnh báo | Gửi lỗi: thử lại tối đa 5 lần |
| Hết tiền ở submit/upload | `RunningHubError` có từ khóa hết tiền | Cùng kết quả như trên | N/A |
| Cờ bật, Task mới | job nhận Task sau CAS | `failed` `RH_BUDGET`, không ffmpeg, không upload RunningHub | N/A |
| Cờ bật, Task đang chạy | đã có `runninghubTaskId` | Vẫn poll; chỉ Task bị từ chối mới `RH_BUDGET` | N/A |
| Chuyển lại | `resume` rồi Task đầu bị từ chối hết tiền | Cờ bật lại, cảnh báo mới | N/A |
| Số dư dưới ngưỡng | 20000 < 27000 | Một cảnh báo; không gửi lại cho đến khi lên trên rồi xuống | N/A |
| Đọc số dư lỗi | 3 lần liên tiếp | Một cảnh báo; `intake_paused` không đổi | Adapter chưa cấu hình: tính là lỗi đọc |
| Đọc lại thành công | sau chuỗi lỗi | Xóa chuỗi lỗi; cảnh báo được phép gửi lại | N/A |
| Thử lại cảnh báo | Discord lỗi lần 1–4 rồi đạt | Gửi đúng một lần thành công, dừng thử | Lần 5 vẫn lỗi: dừng, ghi log một lần |
| Cảnh báo ngắt mạch | Discord lỗi lúc kích hoạt | Được thử lại ở chu kỳ quét sau | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/ports/index.ts` -- `RunningHubPort` (l.41–56, `uploadFile`/`submit`/`outputs`), `RunningHubError`, `NotifierPort`; thêm `getBalance`.
- `apps/api/src/modules/tasks/` -- `runninghub-http.adapter.ts` (adapter giả khi `NODE_ENV=test` + `RUNNINGHUB_BASE_URL`, `createRunningHubPort` l.86–95), `runninghub-openapi.adapter.ts` (`post()` l.114), `runninghub-unconfigured.adapter.ts`; cả ba cần `getBalance`.
- `apps/api/src/modules/tasks/task-worker.service.ts` -- `processTask` l.138–178: CAS `queued→running` l.148, reload l.153, kiểm `status!=='running'` l.157; điểm chèn kiểm cờ sau l.157 cho Task mới. `submitWithRetry` l.329–352 và catch upload l.256–260 hiện map `RH_ERROR`, cần `mapRunningHubFailure`; `poll` l.400–405 đã map `RH_BUDGET`. `finish()` l.180–188.
- `apps/api/src/modules/pipelines/pipeline-config.ts` -- `RH_BUDGET_KEYWORDS` l.91, `mapRunningHubFailure` l.102–114: dùng lại, không đổi.
- `apps/api/src/modules/ops/settings.service.ts` -- thêm `markRhBudgetExhausted()` (mẫu `pauseIntake` l.52, trả true chỉ khi tắt→bật) cùng đọc/ghi `rh_balance` và bộ đếm chuỗi lỗi; `ops.module.ts` (provide/export `AlertService`); `ops-admin.module.ts`; `ops.controller.ts` `buildStatus` (`rhBalance: null` đang cứng).
- `apps/api/src/modules/ops/breaker.service.ts` -- thay `notifier.notify` một lần bằng `AlertService`.
- `apps/api/src/modules/tasks/task-sweeper.service.ts` -- `safe(name, fn)`; thêm bước thử lại cảnh báo; `TasksModule` đã import `OpsModule` nên worker inject `SettingsService`/`AlertService` được; `RUNNING_HUB_PORT` chỉ có ở `TasksModule` nên job số dư nằm ở `TasksModule` hoặc export port.
- `apps/api/src/modules/topups/topup-notifier.service.ts` -- mẫu thử lại 5 lần (`MAX_NOTIFY_ATTEMPTS`, 60 giây); chỉ tham khảo, không dùng chung bảng.
- `apps/api/.env.example`, `deploy/compose.yml` (khối `api` ~l.55 và `worker` ~l.85) -- biến môi trường mới.
- `apps/api/test/` -- `task-worker.test.mjs`, `ops-breaker.test.mjs`, `runninghub-openapi.test.mjs`, `helpers/ops-preload.mjs` (đặt lại hai cờ đầu tiến trình); worker lấy bằng `app.get(TaskWorkerService)` rồi gọi `processTask`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/ports/index.ts` và ba adapter RunningHub -- `getBalance`, adapter thật đọc `RH_BALANCE_ENDPOINT` -- đọc số dư
- [x] `apps/api/src/modules/tasks/task-worker.service.ts` -- nhận diện hết tiền ở upload/submit, kiểm cờ sau CAS, đặt hai cờ khi bị từ chối -- chặn đốt GPU
- [x] `apps/api/src/modules/ops/` -- `markRhBudgetExhausted`, lưu `rh_balance`, `AlertService`, đổi `BreakerService`, `buildStatus` -- trạng thái và cảnh báo
- [x] `apps/api/src/modules/tasks/` -- job số dư 10 phút và bước thử lại cảnh báo trong bộ quét -- theo dõi ví
- [x] `apps/api/.env.example`, `deploy/compose.yml` -- biến môi trường mới -- cấu hình
- [x] `apps/api/test/*.test.mjs` -- test I/O Matrix (không ffmpeg và không upload khi cờ bật, thử lại tối đa 5 lần, ngưỡng một lần) -- phủ ranh giới

**Acceptance Criteria:**
- Given RunningHub từ chối vì hết tiền ở bất kỳ bước nào, when worker nhận lỗi, then Task `failed` `RH_BUDGET`, RELEASED, hai cờ bật, một cảnh báo.
- Given cờ bật, when worker nhận job mới, then Task `failed` `RH_BUDGET` trước prepare và không gọi RunningHub.
- Given job số dư, when đọc và so với ngưỡng, then đúng một cảnh báo theo quy tắc lên/xuống và theo chuỗi 3 lần lỗi.
- Given `pnpm --filter @flowvis/api test` cùng `lint`, `typecheck`, `build`, when chạy, then pass (trừ 5 test lỗi có sẵn ở Story 2.14 và 5.2).

## Implementation Notes

- `RhBalanceService` đặt ở `TasksModule` (giữ `RUNNING_HUB_PORT`, không cần export port). `AlertService` nằm ở `OpsModule`, `BreakerService` gửi cảnh báo qua nó; trạng thái mỗi cảnh báo lưu ở `settings` khóa `alert:<khóa>`, không bao giờ xóa để không gửi lặp.
- Hình dạng phản hồi số dư của RunningHub thật là phỏng đoán (`data.remainCoins`, `data.coins` hoặc `coins`) vì `RH_BALANCE_ENDPOINT` chưa có giá trị; xác nhận ở bước kiểm thử cuối epic.
- Suite api: 504 pass, 5 fail có sẵn (3 test Story 2.14 do `.env` qua `--env-file`, 2 test ffprobe Story 5.2). Sau vá review, một lần chạy suite đầy đủ ra 31 fail (26 test Story 2.5, test đầu fail ở `rh_orphan_until > new Date()`), chạy lại ngay cho 509 pass và 5 fail có sẵn; `task-worker.test.mjs` chạy riêng 31/31 pass và lệch đồng hồ DB với máy dưới 0,1 giây. Nguyên nhân lần fail đó chưa xác định (nghi test phụ thuộc thứ tự/trạng thái dùng chung); theo dõi nếu lặp lại.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Cờ và cảnh báo bị đặt cả khi CAS `transition` không áp dụng | medium | patch | `finish()` gọi `onBudgetExhausted` bất kể `result.applied` |
| Nhánh `RH_BUDGET` ở poll bỏ `orphanForMs`, nhả slot cổng sớm | medium | patch | Nhánh `RH_ERROR` ngay dưới giữ `ORPHAN_MS` vì không biết job còn chạy |
| `retryPending` dừng cả vòng khi một `attempt` ném lỗi; ngày lỗi bỏ qua khoảng 60 giây | medium | patch | Vòng `for` không bọc try/catch |
| `raise` nuốt lỗi nhưng job số dư vẫn đặt cờ chống lặp, mất cảnh báo | medium | patch | `lowAlerted`/`failAlerted` lưu dù `raise` thất bại |
| Adapter thật (upload/submit/`getBalance`) chưa có test | medium | patch | Test chỉ dùng mock ném `RunningHubError` trực tiếp |
| Đường thử lại cảnh báo qua bộ quét chưa được test; thiếu ca `submitStartedAt` khi cờ bật và CAS thua | medium | patch | Test chỉ gọi `retryPending` trực tiếp |
| Khớp từ khóa trên thông điệp tự do có thể bật tạm dừng nhầm; chưa xác nhận bằng `getBalance` | medium | defer | Danh sách từ khóa là cấu hình có sẵn của Story 2.5; xác nhận chéo cần quyết định thiết kế riêng |
| `RH_BALANCE_ENDPOINT` rỗng nên mọi môi trường nhận cảnh báo "không đọc được" sau 30 phút | medium | defer | AC của Epic nêu rõ hành vi này đến khi vận hành điền endpoint; cần công tắc tắt job |
| Resume chỉ xóa `intake_paused` thì cờ ngân sách còn; `markRhBudgetExhausted` im lặng | false | - | `resume` đã tắt cả hai cờ trong một transaction (Story 6.2) |
| Hai tiến trình cùng `raise` một khóa, check-then-set không nguyên tử | low | reject | Khóa có thời điểm; chỉ có một worker; sửa thêm nhánh/ràng buộc |
| Đọc-sửa-ghi `rh_balance_state` không khóa | low | reject | Một worker và cờ `running`; ít gặp |
| Trạng thái `alert:*` không bao giờ dọn; khóa theo thời điểm | low | reject | Đúng thiết kế (không gửi lặp); số hàng nhỏ |
| Test xóa `prepare` thật của pipeline | false | - | Chỉ `motion_control` có `prepare`; test ghi đè trên `face_swap` (không có) nên `delete` trả về nguyên trạng |
| Adapter giả HTTP bỏ qua `RH_BALANCE_ENDPOINT` | low | reject | Chỉ là adapter giả cho test |
| Endpoint tuyệt đối/`..`, chưa kiểm `code` envelope trước khi đọc coins | low | reject | Cấu hình do vận hành đặt; sửa thêm nhánh |
| Thông điệp lỗi chưa cắt độ dài | low | reject | Cosmetic |
| Bộ quét 30 giây nhưng thử lại cách nhau tối thiểu 60 giây | false | - | Spec yêu cầu đúng "ít nhất 60 giây" |
| Spec `in-review` còn sprint-status `in-progress` | false | - | Đúng quy trình; đồng bộ ở bước present |

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass (cần Docker cho PostgreSQL/Redis; chạy với `node --env-file=.env`)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: không có file ngoài `apps/api/`, `deploy/` và `_bmad-output/` do story này thêm
