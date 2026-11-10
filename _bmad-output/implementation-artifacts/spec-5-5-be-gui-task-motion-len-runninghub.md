---
title: 'Story 5.5: [BE] Gửi Task Motion lên RunningHub'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '62532063f92faf7a9229d6d67e1fbf862b588666'
route: 'dispatch'
review_loop_iteration: 0
context:
- '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 5.4 đã cắt được video nhưng worker còn chặn tạm Task `motion_control` (`failed`/`INTERNAL_ERROR`), pipeline chưa có ánh xạ node RunningHub và hạn xử lý vẫn là 180 giây chung.

**Approach:** Gỡ nhánh chặn, khai báo ánh xạ node cho `motion_control`, và cho `deadline_at` của Motion là 360 giây tính từ lúc qua cổng, ngay trước khi tải input lên RunningHub. Dùng lại nguyên đường upload, submit, poll và khôi phục của Story 2.5.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` (nhánh `be/*`); không thêm `ApiErrorCode`/`ReasonCode`; mọi chuyển trạng thái qua `tasks.transition`, RELEASED 100% khi `failed`/`timed_out`.
- `deadline_at` ghi một lần (`setDeadlineIfNull`) sau khi chuẩn bị và cắt xong, nên 120 giây chuẩn bị không nằm trong 360 giây. Face Swap/Body Retouch giữ 180 giây.
- **Quyết định:** nodeId/fieldName của Motion là `[ASSUMPTION]` chưa xác nhận bằng lần chạy thật (như Face Swap ở 2.5); đối chiếu khi chạy benchmark ở 5.9.
- **Quyết định:** nhập kết quả video/ảnh bìa thuộc Story 5.6; tới lúc đó Task Motion `SUCCESS` có thể kết thúc `failed`/`OUTPUT_UPLOAD_ERROR` và RELEASED. Không sửa `result-ingestor.ts` ở story này.
- Thư mục tạm của Task do `videoTrim.prepare` xóa (đã có từ 5.4); không thêm đường ghi đĩa mới.

**Never:** Submit lại RunningHub khi worker khởi động lại (giữ `submit_started_at`/`runninghub_task_id` như 2.5); sửa `packages/contracts`; gọi RunningHub thật trong test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thành công | Task motion qua prepare và cổng | `deadline_at` ≈ now+360s; upload 2 file (`characterKey`, `videoKey`), submit một lần với node đã ánh xạ, poll | N/A |
| Hạn chuẩn bị | Task motion `deadline_at` NULL | `deadline_at` không đổi trước khi prepare xong | N/A |
| `NO_POSE` / `NO_FACE` | RunningHub FAILED có tiền tố đó | `failed` với đúng reasonCode, RELEASED 100%, lưu `gpu_coins` | N/A |
| Quá 360s | `deadline_at` đã qua khi poll | `timed_out`/`RH_TIMEOUT`, đặt `rh_orphan_until`, kết quả đến muộn bị bỏ qua | N/A |
| Khởi động lại | Có `runninghub_task_id` | Tiếp tục poll, không upload/submit lại | N/A |
| Pipeline khác | Face Swap, Body Retouch | `deadline_at` vẫn 180s | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/task-worker.service.ts` -- gỡ nhánh chặn tạm (dòng ~196); `deadlineMs()` nhận pipeline; `passGate` truyền `row.pipeline`.
- `apps/api/src/modules/pipelines/pipeline-config.ts` -- `motion_control.inputs` thêm ánh xạ node; có thể thêm `deadlineMs` vào `PipelineConfig`.
- `apps/api/test/motion-control.test.mjs` -- test "worker nhấc Task motion_control: failed/INTERNAL_ERROR" (dòng ~272) phải thay.
- `apps/api/test/task-worker.test.mjs`, `test-overrides.test.mjs` -- mẫu giả `worker.rh`/`storage`; `deadlineMs()` không đối số vẫn trả 180000.
- Giữ nguyên: `video-trim.service.ts`, `result-ingestor.ts`, `mapRunningHubFailure` (đã có `NO_POSE`/`NO_FACE`), `tasks.service.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/pipelines/pipeline-config.ts` -- thêm `inputs` cho `motion_control` (`characterKey`, `videoKey`, nodeId `[ASSUMPTION]`) và hạn 360s -- ánh xạ node
- [x] `apps/api/src/modules/tasks/task-worker.service.ts` -- gỡ nhánh chặn; hạn theo pipeline, giữ ghi đè `RH_DEADLINE_MS` khi `NODE_ENV=test` -- chạy Motion thật
- [x] `apps/api/test/motion-control.test.mjs` -- thay test chặn tạm bằng các dòng ma trận (thành công, hạn 360s so với 180s, NO_POSE/NO_FACE, RH_TIMEOUT, khôi phục không submit lại)
- [x] `apps/api/test/test-overrides.test.mjs` -- khẳng định `deadlineMs()` mặc định 180000, Motion 360000

**Acceptance Criteria:**
- Given Task motion qua cổng, when worker upload, then `deadline_at - now` ≈ 360s và `submit_started_at` đặt sau đó.
- Given `pnpm run lint && pnpm run typecheck && pnpm test`, then đều xanh.

## Implementation Notes

- `deadlineMs(pipeline?)` đọc `PipelineConfig.deadlineMs` (Motion 360000), mặc định 180000; `RH_DEADLINE_MS` vẫn ghi đè khi `NODE_ENV=test`.
- nodeId `1`/`2` của Motion do agent chọn, là `[ASSUMPTION]`.
- Suite `reconcile-script` fail sẵn ở baseline; `signup-grant` (429) fail lẻ cả ở baseline: không do story này.

## Spec Change Log

## Review Triage Log

| Phát hiện | Verdict | Bằng chứng / xử lý |
|---|---|---|
| Test node mapping chỉ kiểm chuỗi con, không ghép node với file | medium | patch: đổi sang `deepEqual` trên danh sách node submit (`f1` -> node 1/image, `f2` -> node 2/video) |
| Khẳng định thứ tự `submit_started_at` gần như vô nghĩa; deadline chưa được chốt trước upload | medium | patch: đọc `deadline_at` trong stub `uploadFile` và khẳng định đã khác NULL; so `submit_started_at` với `deadline_at - 360s` |
| Test 360s phụ thuộc `RH_DEADLINE_MS` môi trường | low | patch: test xóa rồi khôi phục biến này |
| Sweeper/recovery/poll còn dùng hạn 180s cho Motion | false | grep: mọi nơi chỉ đọc `deadline_at` đã lưu (`task-sweeper`, `result-ingestor`, `tasks.service`); không có hằng 180s nào khác |
| Face Swap 180s chỉ test ở mức hàm | low | reject: `passGate` chỉ truyền `row.pipeline` vào hàm đã test; `task-worker.test.mjs` chạy Face Swap qua cổng và vẫn xanh |
| nodeId/fieldName đoán, không có cờ xác nhận | medium | defer: đã nêu `[ASSUMPTION]` trong spec; đối chiếu ở 5.9 |
| Ingestor ảnh chưa xử lý video; Task Motion thành công kết thúc `OUTPUT_UPLOAD_ERROR` | medium | defer: spec ghi rõ thuộc Story 5.6 |
| Workflow Motion có thể cần tham số không phải file | maybe-false | defer: chưa biết workflow thật; xác nhận ở 5.9 |
| Checkbox/Implementation Notes của spec chưa điền | low | reject: sửa spec của build này |

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: thành công
- `pnpm test` -- expected: xanh, kể cả `motion-control.test.mjs`, `task-worker.test.mjs`, `test-overrides.test.mjs`
