---
title: 'Story 4.1: [CONTRACT] Hợp đồng cho Body Retouch'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'cdc811ca77831ab8fd40db6460a24fc7e14eccf9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `@flowvis/contracts` chưa có pipeline `body_retouch`, schema `intensity`, endpoint tạo Task và mock cho Body Retouch, nên luồng BE (4.2–4.3) và FE (4.4–4.5) chưa thể chạy song song trên cùng một hình dạng API. Thông báo `NO_POSE` của `body_retouch` hiện lệch so với yêu cầu.

**Approach:** Mở rộng `src/tasks.ts` (enum pipeline, `IntensitySchema`, hằng ba vùng nhãn, `BodyRetouchCreateRequest/Response`), sửa thông báo `NO_POSE` theo pipeline, thêm mock `body_retouch` ở mọi trạng thái và mock kết quả có `sourceUrl`, kèm test hợp đồng và README. Giá `bodyRetouchCredits` đã có trong `PipelinePricingSchema`, không sửa.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `packages/contracts/**` (nhánh `contract/*`); dùng `zod` `3.24.4`, phong cách `tasks.ts` (schema + `z.infer`, `.strict()` cho request, thông báo tiếng Việt).
- `TASK_PIPELINES` = `['face_swap', 'body_retouch']`; `REASON_MESSAGE_PIPELINES` vẫn gồm `motion_control`, tránh trùng lặp `body_retouch`.
- `IntensitySchema`: số nguyên 1–10, mặc định 5 khi thiếu (`.default(5)`); xuất `INTENSITY_MIN/MAX/DEFAULT`.
- Ba vùng nhãn dạng hằng và hàm tra cứu `getIntensityLabelVi(n)`: 1–3 "Uốn nhẹ dáng", 4–7 "Tự nhiên", 8–10 "Đường cong tối đa".
- `POST /tasks/body-retouch`: body `{ imageKey: ConfirmedUploadKeySchema, intensity }` `.strict()`; response = `TaskSchema`. Không có `consent` trong body: ToS chỉ đồng ý một lần khi đăng nhập (quyết định commit `7ec4c55`, Face Swap cũng không nhận `consent`); lỗi `CONSENT_REQUIRED` vẫn do đường ToS lúc đăng nhập xử lý. Các endpoint đọc, hủy, kết quả, chia sẻ dùng lại schema hiện có, không đổi.
- `NO_POSE` của `body_retouch` = "Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân."; ghi đè của `motion_control` giữ nguyên (Epic 5 định nghĩa).
- Mock: Task `body_retouch` ở đủ 6 trạng thái (`failed` dùng `NO_POSE`), mock request, mock kết quả có `sourceUrl` khớp `TaskResultResponseSchema`.

**Never:**
- Không sửa `apps/*`, `deploy/`, cấu hình gốc; không thêm phụ thuộc; không thêm `ReasonCode`/`ApiErrorCode` mới; không nhận credit hay giá từ client; không sửa `PipelinePricingSchema`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo hợp lệ | `{imageKey:'in/…', intensity:8}` | Parse thành công | N/A |
| Thiếu intensity | `{imageKey}` | Parse, `intensity` = 5 | N/A |
| Intensity sai | `0`, `11`, `5.5`, `'5'`, `null` | Từ chối | `VALIDATION_FAILED` ở BE; lỗi tiếng Việt trên `intensity` |
| Khóa ảnh sai | `in-raw/…` hoặc thiếu | Từ chối | Lỗi trên `imageKey` |
| Trường lạ | có `consent` hoặc `credits` | Từ chối (`.strict()`) | N/A |
| Nhãn vùng | 1, 3, 4, 7, 8, 10 | "Uốn nhẹ dáng", "Uốn nhẹ dáng", "Tự nhiên", "Tự nhiên", "Đường cong tối đa", "Đường cong tối đa" | Giá trị ngoài 1–10 trả `null` hoặc nhãn mặc định |
| NO_POSE theo pipeline | `body_retouch` / `motion_control` / không pipeline | Ba thông báo khác nhau, body_retouch đúng câu yêu cầu | N/A |
| Mock | 6 trạng thái `body_retouch`, mock kết quả | Parse qua `TaskSchema`/`TaskResultResponseSchema` | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/tasks.ts` -- đổi `TASK_PIPELINES`, sửa override `NO_POSE` cho `body_retouch`, thêm `IntensitySchema`, vùng nhãn, `BodyRetouchCreate*`. `FaceSwapCreateRequestSchema` là mẫu.
- `packages/contracts/src/mocks.ts` -- `mockTaskBase` đang cố định `face_swap`; thêm mock `body_retouch` (`MOCK_BODY_RETOUCH_*`), tái dùng `MOCK_USER_ID`.
- `packages/contracts/src/wallet.ts` -- `bodyRetouchCredits` đã có; không sửa.
- `packages/contracts/src/index.ts` -- đã `export * from './tasks.js'`; không cần sửa.
- `packages/contracts/test/index.test.mjs` -- khối `Epic 2 contracts` (~dòng 719–853) có assert pipeline và `NO_POSE`; thêm `describe('Epic 4 contracts')`.
- `packages/contracts/README.md` -- mục 5 (Epic 2); thêm mục Epic 4.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/tasks.ts` -- pipeline, `IntensitySchema`, nhãn, request/response, thông báo `NO_POSE` -- hợp đồng chính
- [x] `packages/contracts/src/mocks.ts` -- mock Task `body_retouch` theo trạng thái, request, kết quả có `sourceUrl` -- FE chạy không cần BE
- [x] `packages/contracts/test/index.test.mjs` -- test I/O Matrix; sửa assert cũ nếu phụ thuộc danh sách pipeline -- phủ ranh giới
- [x] `packages/contracts/README.md` -- thêm mục Epic 4 -- tài liệu

**Acceptance Criteria:**
- Given gói contracts, when build, then xuất `body_retouch` trong enum pipeline và `IntensitySchema` 1–10 mặc định 5.
- Given endpoint `POST /tasks/body-retouch`, when đọc hợp đồng, then có schema request và response (= Task) dùng chung FE/BE.
- Given `NO_POSE` ở `body_retouch`, when tra thông báo, then ra đúng câu yêu cầu và khác của `motion_control`.
- Given mock, when chạy test hợp đồng, then mọi mock `body_retouch` và mock kết quả khớp schema.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Tham số `z` trong `find` che khuất `z` của zod (`tasks.ts`) | low | patch | Đúng tại dòng 213; đổi tên thành `zone`, không đổi hành vi |
| `BodyRetouchCreateRequest` dùng `z.input` nên `intensity` tùy chọn; mặc định 5 âm thầm | false | - | Spec yêu cầu thiếu `intensity` thì mặc định 5; test phủ ca này |
| `Task` không mang `intensity` | false | - | Epic lưu `intensity` trong `params` ở BE (4.2); intent 4.1 không yêu cầu trường này trong `TaskSchema` |
| Cấu trúc khóa theo pipeline, bộ lọc `TaskListQuery` chưa có `body_retouch` | false | - | Grep: chỉ `apps/web/utils/task-format.ts` dùng `TaskPipeline` (kiểu `string`, thuộc FE 4.4, ngoài phạm vi 4.1); `TaskListQuerySchema` không có bộ lọc pipeline |
| Chuỗi `NO_POSE` cũ còn trong test/FE | false | - | Grep không còn chuỗi cũ ở `apps`, `packages` |
| "có người rõ thân" là tiếng Việt gượng | false | - | Nguyên văn theo AC của Story 4.1 |
| Test chỉ so regex ký tự tiếng Việt, thiếu ca `-1`/`Infinity`/`''`; không kiểm bảng vùng liền mạch từng số 1–10 | low | reject | Không gặp trong dùng thực tế; sửa là thêm test, không sửa lỗi |
| Mock `timed_out` dùng `FREE_WAIT_EXPIRED`, thiếu mock `PREP_TIMEOUT`, thiếu test bất biến mock | low | reject | Mock chỉ phục vụ FE; `TaskSchema` đã kiểm bất biến khi parse mock |
| Thiếu mã lỗi riêng cho Body Retouch | false | - | Epic nêu rõ không thêm mã mới, dùng lại `NO_POSE` |
| README thiếu mã trả về/lỗi của endpoint | low | reject | Cùng mức chi tiết với mục Face Swap hiện có |
| Mock `queuePosition`/`resultKey` không gắn với URL kết quả | low | reject | Fixture tĩnh, cùng quy ước mock Epic 2 |

## Verification

**Commands:**
- `pnpm --filter @flowvis/contracts test` -- expected: pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass
