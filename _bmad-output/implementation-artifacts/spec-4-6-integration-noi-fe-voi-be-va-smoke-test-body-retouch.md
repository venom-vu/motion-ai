---
title: 'Story 4.6: [INTEGRATION] Nối FE với BE và smoke test Body Retouch'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'feff1048219f32be863b11f663a7f0c007ac16d2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FE (4.4–4.5) và BE (4.2–4.3) của Body Retouch mới được kiểm thử riêng rẽ. Chưa có bằng chứng pipeline `body_retouch` chạy trọn vẹn trên stack thật, dùng chung hàng đợi, ví và đối soát với Face Swap.

**Approach:** Thêm smoke test HTTP trên stack Compose bốn container (mẫu `smoke-face-swap.test.mjs` của Story 2.14), RunningHub và R2 giả trong tiến trình test, tái sử dụng adapter HTTP và các ghi đè chỉ-khi-`test` đã có. Bốn kịch bản: thành công `intensity` 8, `NO_POSE`, chạy chung với Face Swap, ảnh gốc hết hạn. Thêm đối soát, test hợp đồng mock và BE thật, cập nhật README.

## Decisions

- Smoke chỉ gọi HTTP API thật (không trình duyệt, không dựng FE SSR); thanh so sánh trước/sau được kiểm ở mức hợp đồng: `/tasks/:id/result` có `sourceUrl` không rỗng khi ảnh gốc còn, `null` khi hết hạn. Giao diện đã có test của Story 4.5.
- "Đồng hồ tăng tốc" cho ảnh gốc quá 7 ngày được mô phỏng bằng xóa đối tượng `in/` khỏi S3 giả (BE quyết định `sourceUrl` bằng `storage.head`), không thêm biến môi trường mới.
- Không sửa logic ví, máy trạng thái, bộ quét, pipeline-config; chỉ thêm test, env compose, tài liệu.

## Boundaries & Constraints

**Always:**
- Nhánh `shared/*` được sửa toàn repo; schema `packages/contracts` là nguồn sự thật.
- Smoke mặc định bị bỏ qua, chỉ chạy khi `RUN_COMPOSE_E2E=1`.
- Không đặt bí mật thật vào repo; project/cổng riêng, không trùng smoke khác (api `3105`, Postgres `15436`, Redis `16383`).

**Never:**
- Không thêm container thứ năm; không làm yếu `isPublicHttpUrl` ở production.
- Không đo SLA 60 giây (thuộc Epic 6); không điền ánh xạ `CONTENT_BLOCKED` (Epic 6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thành công | User 500 credit, `intensity` 8, RH giả SUCCESS + ảnh cùng kích thước | HOLD còn 400; `queued→running→succeeded`; CAPTURED; result có `resultUrl` và `sourceUrl`; RH nhận `workflowId` `smoke-workflow-body-reshape`, node ảnh và `intensity` = `8` | N/A |
| Không có người | RH giả FAILED `NO_POSE` | Task `failed` `NO_POSE`, RELEASED, số dư 500; `getReasonCodeMessageVi('NO_POSE','body_retouch')` = thông báo Body Retouch | N/A |
| Chung hàng đợi | Một Face Swap và một Body Retouch cùng tạo, RH giả giữ RUNNING rồi SUCCESS | Không quá 2 Task đồng thời tại RH giả; cả hai `succeeded`; mỗi Task đúng một HOLD và một CAPTURED | N/A |
| Ảnh gốc hết hạn | Task `succeeded`, đối tượng `in/` bị xóa | `/result` 200, `sourceUrl` `null`, `resultUrl` tải được | N/A |
| Đối soát | Sau mọi kịch bản | `reconcile.js` thoát mã 0 | Lệch thì fail |

</frozen-after-approval>

## Code Map

- `apps/api/test/smoke-face-swap.test.mjs` -- mẫu: fake Google/RH/S3, `login`, `waitFor`, `ledgerTypes`, reconcile; sao chép phần cần thiết, không sửa file này.
- `apps/api/test/smoke-body-retouch.test.mjs` (mới) -- bốn kịch bản, hợp đồng, đối soát; fake RH ghi `submitBodies` và đếm Task đang chạy.
- `deploy/compose.smoke.yml` -- đã có `RUNNINGHUB_WORKFLOW_BODY_RESHAPE` và `RUNNINGHUB_BASE_URL`; kiểm tra, không cần sửa nếu đủ cho api và worker.
- `apps/api/src/modules/pipelines/pipeline-config.ts:45` -- node ảnh `10/image`, `intensity` tại node `20/intensity` (dùng để khẳng định payload).
- `apps/api/src/modules/tasks/tasks.service.ts:329` -- `getResult` quyết định `sourceUrl` qua `storage.head`.
- `packages/contracts/src/mocks.ts:410`, `tasks.ts:218` -- `MOCK_BODY_RETOUCH_*`, `BodyRetouchCreateResponseSchema`; không sửa schema.
- `.github/workflows/ci.yml:53,78`, `README.md:60`, `deploy/README.md:25` -- đổi tên bước smoke, ghi cách chạy và nhắc benchmark Epic 6.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/test/smoke-body-retouch.test.mjs` -- thêm smoke bốn kịch bản + hợp đồng + đối soát, cùng một `it` Docker bị skip khi không có `RUN_COMPOSE_E2E` và một `it` hợp đồng không cần Docker -- theo mẫu 2.14
- [x] `deploy/compose.smoke.yml` -- xác nhận env cho api và worker; chỉ sửa nếu thiếu -- worker cần workflow ID để khởi động
- [x] `.github/workflows/ci.yml` -- cập nhật tên bước/job smoke có Body Retouch -- minh bạch
- [x] `README.md`, `deploy/README.md` -- mục Smoke Body Retouch (Story 4.6): cách chạy, bốn kịch bản, nhắc ít nhất một ảnh nhạy cảm trong 1–2 ảnh của benchmark Epic 6 phải chạy qua Body Retouch

**Acceptance Criteria:**
- Given stack bốn container, RH và R2 giả, when chạy đường thành công `intensity` 8, then số dư 500→400→400, Task `succeeded`, ledger HOLD+CAPTURED, `/result` có `sourceUrl`, RH giả nhận `intensity` 8.
- Given `NO_POSE`, then `failed`, RELEASED, số dư hoàn lại, thông báo theo pipeline Body Retouch.
- Given Face Swap và Body Retouch cùng tạo, then chung hàng đợi, không quá 2 đồng thời, hai bộ HOLD/CAPTURED.
- Given ảnh gốc hết hạn, then chỉ `resultUrl`, `sourceUrl` `null`, không lỗi.
- Given đối soát sau smoke, then thoát mã 0.
- Given test hợp đồng ở CI, then `MOCK_BODY_RETOUCH_*` và phản hồi BE thật cùng parse qua schema.
- Given README, then ghi cách chạy và nhắc benchmark Epic 6.

## Implementation Notes

## Spec Change Log

## Review Triage Log

- F1 `servers.push(await ..., await ..., await ...)` rò server đã listen nếu một cổng bận (Edge): `low`, `patch` -- sửa một dòng thành ba lần push riêng; đã áp dụng.
- F2 Cổng cố định 3197/3198/3199 dùng chung giữa các file smoke (Edge, Blind, Verification): `false` -- `apps/api/package.json` chạy `node --test --test-concurrency=1`, các file chạy tuần tự.
- F3 Kiểm tra "không quá 2 đồng thời" không thể fail vì chỉ có hai Task (Blind, Verification): `low`, reject -- spec và AC mô tả đúng một Face Swap và một Body Retouch; thêm Task thứ ba là phức tạp mới, giới hạn 2 đã có test ở `task-worker.test.mjs`.
- F4 `submitBodies[0]` giả định thuộc t1, `rh.active` còn sót (Edge): `false` -- kịch bản chạy tuần tự, Task alice là submit đầu tiên; `active` được xóa ở lần poll terminal của kịch bản 1 và 2.
- F5 Thiếu kiểm tra EXIF, lưu R2, `resultUrl` không trỏ CDN RunningHub (Blind): `low`, reject -- không thuộc AC của 4.6; đã có `body-retouch-result.test.mjs`, `task-result.test.mjs` và `smoke-face-swap.test.mjs` bao phủ (cùng pipeline nhập kết quả).
- F6 Thiếu ca đầu vào xấu (`intensity` ngoài khoảng, thiếu số dư, 401, khóa ảnh của người khác), `PREP_TIMEOUT`, 5xx, `CONTENT_BLOCKED` (Blind): `low`, reject -- ngoài AC của 4.6; validate ở `body-retouch.test.mjs` (Story 4.2), `CONTENT_BLOCKED` do Epic 6.
- F7 Kiểm hợp đồng chỉ một chiều (khóa thật nằm trong khóa mock) (Blind, Verification, Edge): `low`, reject -- cùng mẫu đã chấp nhận ở Story 2.14 (F17); `TaskSchema.parse` đã chặn thiếu trường bắt buộc.
- F8 `reconcile` kiểm bằng regex `"status":"ok"` (Blind, Edge): `low`, reject -- `compose exec` ném lỗi khi thoát khác 0; cùng mẫu 2.14.
- F9 Smoke bị bỏ qua khi thiếu `RUN_COMPOSE_E2E` nên không chặn merge (Verification): `false` -- job `smoke` của CI đặt `RUN_COMPOSE_E2E: '1'`; quy ước chung của mọi smoke, không phải thay đổi của diff này.
- F10 Một `it` lớn, `compose down` nuốt lỗi, fake quá dễ tính, fake RH dùng cờ `mode` toàn cục (Blind, Edge): `low`, reject -- cùng mẫu đã chấp nhận ở 2.14 (F10, F18); các kịch bản chạy tuần tự.
- F11 Kết quả giả luôn 640x640, chưa kiểm so khớp kích thước (Edge): `false` -- so khớp kích thước đã có test ở Story 4.3; smoke dùng ảnh vào cũng 640x640.
- F12 Đóng góp tài liệu và CI: tên job gộp ba tính năng, chưa có mục theo dõi cho ảnh nhạy cảm Epic 6, README không nhắc test hợp đồng offline (Blind): `low`, reject -- README đã nhắc đúng yêu cầu của AC; tách job CI là thay đổi hạ tầng ngoài phạm vi.

## Verification

**Commands:**
- `pnpm run typecheck` -- expected: không lỗi
- `pnpm run lint` -- expected: không lỗi
- `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` -- expected: smoke Body Retouch và các smoke khác pass (Docker có sẵn)
- `pnpm test` -- expected: pass, smoke Docker bị bỏ qua
