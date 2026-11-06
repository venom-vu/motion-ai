---
title: 'Story 2.8: [BE] Ưu tiên theo Tier và hết hạn hàng đợi FREE'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'oneshot'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Task FREE `queued` chờ vô thời hạn khi hàng đợi bận Task trả phí; thứ tự ưu tiên theo Tier Snapshot chưa có test trên Redis thật.

**Approach:** Thêm nhánh `free-expired` vào `TaskSweeperService`: Task `queued` có Priority của FREE quá 15 phút → CAS `queued→timed_out`/`FREE_WAIT_EXPIRED` (RELEASED trong `transition`), xóa job, hủy signal, gửi `NotifierPort` (thử lại hoặc nạp credit), theo lô `LIMIT 100`, chạy trước nhánh enqueue lại. Thứ tự chạy dùng `priority` BullMQ từ `tier_snapshot.priority` (đã có từ Story 2.3, không dùng 0); chứng minh bằng test Redis thật.

</frozen-after-approval>

## Implementation Notes

- `tasks.service.ts`: `sweepFreeExpired(waitMs, limit)` đọc `tier_snapshot->>'priority'` (Priority FREE lấy từ `PRICING_CONFIG`), không đọc Tier hiện tại của user.
- `task-sweeper.service.ts`: nhánh mới + `NOTIFIER_PORT`; `tasks.module.ts` import `OpsModule`.
- Priority không ngắt job đang chạy: không có mã ngắt; test xác nhận job đang chạy hoàn tất.
- Test: `apps/api/test/task-priority.test.mjs` (Redis/PostgreSQL thật).
