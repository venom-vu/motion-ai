---
title: 'Story 4.4: [FE] Trang Body Retouch và thanh mức điều chỉnh'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'ac6f49a0a7282ff3d955519b5a2345ff938cf42e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng chưa có trang riêng `/body-retouch` cũng như thanh trượt chọn mức `intensity` (1–10) và luồng gọi API `POST /tasks/body-retouch` trong hộp thoại `FeatureWorkspaceDialog`, khiến chưa thể tải ảnh lên, điều chỉnh mức độ chỉnh dáng một lần bấm và theo dõi tiến trình xử lý Task `body_retouch`.

**Approach:** Bổ sung `createBodyRetouchTask` và các hằng/hàm `intensity` từ `@flowvis/contracts` vào `apps/web/utils/api-client.ts`; xây dựng trang `/body-retouch` tái sử dụng `ImageUploader.vue` và `TaskProgressCard.vue` kèm thanh trượt `intensity` số nguyên 1–10 (mặc định 5, hiển thị nhãn 3 vùng theo hợp đồng) và nút tạo hiển thị giá 100 credit từ `GET /config/pricing`; đồng thời tích hợp thanh trượt `intensity`, gọi `POST /tasks/body-retouch` và nút mở trang riêng `/body-retouch` vào `FeatureWorkspaceDialog.vue`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa các tệp trong phạm vi `apps/web/**` (tuân thủ ranh giới nhánh `fe/*`).
- Tuân thủ thiết kế Slate Cyber (`bg-cyber-*`, `text-cyber-*`, `border-cyber-*`), 100% icon vector Lucide qua `<Icon name="lucide:..." />`, tuyệt đối không dùng emoji Unicode UTF-8 trong giao diện.
- Đảm bảo vùng chạm tối thiểu 48px (`touch-target`, `min-h-[48px]`) cho mọi nút bấm và thanh trượt `intensity`, hiển thị chuẩn trên khung nhìn di động 360px.
- Thanh trượt `intensity` dùng số nguyên từ `INTENSITY_MIN` (1) đến `INTENSITY_MAX` (10), bước nhảy `step="1"`, mặc định `INTENSITY_DEFAULT` (5), hiển thị số hiện tại và nhãn vùng từ `getIntensityLabelVi(intensity)` cùng 3 mốc `INTENSITY_LABEL_ZONES` (`1–3`: "Uốn nhẹ dáng", `4–7`: "Tự nhiên", `8–10`: "Đường cong tối đa") từ `@flowvis/contracts`.
- Giá tạo Task lấy từ `pricing.value?.pipelines.bodyRetouchCredits ?? 100` (`GET /config/pricing`).
- Khi chưa đăng nhập: khóa nút Tạo, hiển thị thông báo yêu cầu đăng nhập kèm nút mở hộp thoại đăng nhập. Khi số dư `< 100` credit: khóa nút Tạo, hiển thị cảnh báo thiếu credit kèm lối dẫn `/pricing`.
- Khi đủ điều kiện và bấm "Tạo": khóa chống bấm trùng (`isSubmitting`), gọi `POST /tasks/body-retouch` với `{ imageKey, intensity }` đúng một lần (không gửi trường `consent` vì ToS đã đồng ý khi đăng nhập theo hợp đồng Story 4.1), chuyển sang hiển thị `TaskProgressCard.vue` và làm mới thông tin ví (`refreshAll()`).
- Khi Task `failed` với `reasonCode: 'NO_POSE'` ở pipeline `body_retouch`: hiển thị đúng câu "Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân." và xác nhận đã hoàn 100% credit.
- Khi tạo Task gặp lỗi `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `PAUSED`, `CONSENT_REQUIRED`, `VALIDATION_FAILED`: hiển thị thông báo tiếng Việt tương ứng qua `resolveApiErrorMessageVi`.
- `TaskProgressCard.vue` ở trạng thái `succeeded` hiển thị tiêu đề theo prop `pipelineLabelVi` (`{{ pipelineLabelVi }} thành công!`) thay vì cố định "Hoán đổi khuôn mặt thành công!".

**Never:**
- Không sửa `packages/contracts/**`, `apps/api/**`, `deploy/**` hay bất kỳ tệp nào ngoài `apps/web/**`.
- Không sửa `BeforeAfterSplitSlider.vue` (thuộc phạm vi Story 4.5).
- Không gửi giá credit hoặc trường `consent` trong body của `POST /tasks/body-retouch`.
- Không thêm nhánh `?mock=` / `mockMode` vào mã chạy thật của FE (tuân thủ mục hành động số 8 của Retrospective Epic 2; dữ liệu `MOCK_BODY_RETOUCH_*` chỉ dùng trong kiểm thử).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mở `/body-retouch` hoặc `FeatureWorkspaceDialog` (`body-retouch`) | Mặc định khi mới mở | Hiển thị 1 `ImageUploader`, thanh trượt `intensity` ở mức `5` kèm nhãn "Tự nhiên" và 3 mốc vùng, nút Tạo hiển thị `100 CR` từ `/config/pricing`, nút Tạo bị `disabled` khi chưa có ảnh | N/A |
| Kéo thanh trượt `intensity` | Chọn giá trị `1..3` / `4..7` / `8..10` | Hiển thị đúng số nguyên vừa chọn và nhãn vùng tương ứng ("Uốn nhẹ dáng" / "Tự nhiên" / "Đường cong tối đa") | Giá trị ngoài `1..10` hoặc không nguyên bị chặn bởi `IntensitySchema` ở client |
| Khách chưa đăng nhập | `me === null` | Nút Tạo bị `disabled`, hiện banner nhắc đăng nhập kèm nút mở dialog đăng nhập | Không gọi API tạo Task |
| Số dư không đủ | Đã đăng nhập, `balance < 100` | Nút Tạo bị `disabled`, hiện cảnh báo thiếu credit và nút dẫn tới `/pricing` | Không gọi API tạo Task |
| Tạo Task hợp lệ & bấm nhiều lần | Đã đăng nhập, `balance >= 100`, đã có `imageKey`, `intensity = 8`, click đúp nút Tạo | Gửi đúng 1 request `POST /tasks/body-retouch` với `{ imageKey, intensity: 8 }`, hiển thị `TaskProgressCard` với vị trí hàng đợi và làm mới số dư | Khóa nút khi `isSubmitting = true` |
| Task thất bại `NO_POSE` | Task `body_retouch` chuyển sang `failed` với `reasonCode = 'NO_POSE'` | `TaskProgressCard` hiển thị "Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân." và thông báo hoàn 100% credit | Cho phép bấm "Thử lại với ảnh khác" để quay về form |
| Lỗi API khi tạo Task | API trả `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `PAUSED`, `CONSENT_REQUIRED`, `VALIDATION_FAILED` | Hiển thị banner lỗi tiếng Việt tương ứng, giữ lại ảnh và mức `intensity` đã chọn | Mở khóa `isSubmitting` để người dùng xử lý |

</frozen-after-approval>

## Code Map

- `apps/web/utils/api-client.ts` -- Re-export `BodyRetouchCreateRequestSchema`, `BodyRetouchCreateResponseSchema`, `INTENSITY_DEFAULT`, `INTENSITY_LABEL_ZONES`, `INTENSITY_MAX`, `INTENSITY_MIN`, `IntensitySchema`, `getIntensityLabelVi`, `type BodyRetouchCreateRequest`, `type BodyRetouchCreateResponse`, `type Intensity` từ `@flowvis/contracts`; thêm phương thức `createBodyRetouchTask` ngay sau `createFaceSwapTask` (~dòng 573).
- `apps/web/components/TaskProgressCard.vue` -- Tại dòng 331–333 (trạng thái `succeeded`), đổi tiêu đề cố định `"Hoán đổi khuôn mặt thành công!"` thành `{{ pipelineLabelVi }} thành công!` để hiển thị đúng cho cả Face Swap và Body Retouch.
- `apps/web/pages/body-retouch.vue` -- Trang mới `/body-retouch` theo cấu trúc chuẩn của `apps/web/pages/face-swap.vue`: SEO `useHead`, nút quay lại `/`, huy hiệu giá `bodyRetouchCredits`, 1 `ImageUploader`, thanh trượt `intensity` (`1..10`, `step="1"`, mặc định `5`, nhãn vùng `getIntensityLabelVi` và 3 mốc `INTENSITY_LABEL_ZONES`), kiểm tra đăng nhập/số dư, chống bấm trùng, gọi `client.createBodyRetouchTask`, hiển thị `TaskProgressCard` (`pipeline-label-vi="Chỉnh sửa vóc dáng"`).
- `apps/web/components/FeatureWorkspaceDialog.vue` -- Tích hợp nhánh `feature.id === 'body-retouch'`: thêm state `intensity` (reset về `5` khi đổi feature/mở lại dialog), khối thanh trượt `intensity` dưới `ImageUploader` của nhánh 1 ảnh, gọi `client.createBodyRetouchTask` trong `handleSubmit()`, truyền `pipeline-label-vi` theo feature cho `TaskProgressCard`, và hiển thị nút `"Mở trang riêng"` dẫn tới `/body-retouch`.
- `apps/web/utils/catalog.ts` & `apps/web/utils/task-format.ts` -- Đã có sẵn card `body-retouch` và nhãn `PIPELINE_LABELS_VI.body_retouch`; tái sử dụng nguyên vẹn, không sửa.
- `apps/web/test/body-retouch.test.mjs` -- Tệp kiểm thử mới cho Story 4.4: kiểm tra `createBodyRetouchTask` với mock fetch, SSR render và script logic của `pages/body-retouch.vue`, `FeatureWorkspaceDialog.vue` (`body-retouch`), `TaskProgressCard.vue` ở mọi trạng thái `MOCK_BODY_RETOUCH_TASKS_BY_STATUS` (bao gồm `NO_POSE`), và kiểm tra chuẩn Slate Cyber / `min-h-[48px]` / không emoji.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/utils/api-client.ts` -- Re-export các hằng/schema `intensity` và `BodyRetouchCreate*` từ `@flowvis/contracts`, thêm phương thức `createBodyRetouchTask` gọi `POST /tasks/body-retouch` -- cung cấp client API chuẩn hợp đồng cho FE
- [x] `apps/web/components/TaskProgressCard.vue` -- Cập nhật tiêu đề trạng thái `succeeded` dùng `{{ pipelineLabelVi }} thành công!` -- hiển thị đúng tên pipeline khi hoàn tất
- [x] `apps/web/pages/body-retouch.vue` -- Xây dựng trang `/body-retouch` với `ImageUploader`, thanh trượt `intensity` 1–10 (mặc định 5, nhãn 3 vùng), hiển thị giá 100 credit từ `/config/pricing`, kiểm tra đăng nhập/số dư, chống bấm trùng và theo dõi tiến trình qua `TaskProgressCard` -- đáp ứng đầy đủ trải nghiệm trang riêng Body Retouch
- [x] `apps/web/components/FeatureWorkspaceDialog.vue` -- Bổ sung thanh trượt `intensity`, luồng gọi `createBodyRetouchTask`, nhãn pipeline và liên kết `"Mở trang riêng"` (`/body-retouch`) khi `feature.id === 'body-retouch'` -- đồng bộ trải nghiệm từ Kho Công Cụ AI và hộp thoại làm việc
- [x] `apps/web/test/body-retouch.test.mjs` -- Viết bộ kiểm thử tự động bao phủ toàn bộ I/O Matrix, 6 trạng thái `MOCK_BODY_RETOUCH_TASKS_BY_STATUS`, thông báo `NO_POSE` hoàn 100% credit, ranh giới 360px / `min-h-[48px]` / 0 emoji -- chứng minh hành vi đúng theo AC

**Acceptance Criteria:**
- Given trang `/body-retouch` hoặc hộp thoại làm việc của tính năng Body Retouch, when người dùng mở lên, then hiển thị thành phần tải ảnh dùng chung, thanh trượt `intensity` từ 1 đến 10 (mặc định 5, kéo bước 1, vùng chạm >= 48px), nhãn 3 vùng ("Uốn nhẹ dáng", "Tự nhiên", "Đường cong tối đa") và nút "Tạo" hiển thị giá 100 credit từ `GET /config/pricing`.
- Given người dùng đã đăng nhập, có số dư >= 100 credit và đã tải ảnh xong, when chọn mức `intensity` và bấm "Tạo" (kể cả bấm đúp nhiều lần), then chỉ gửi đúng 1 yêu cầu `POST /tasks/body-retouch` và chuyển sang màn tiến trình cùng vị trí hàng đợi.
- Given số dư < 100 credit hoặc chưa đăng nhập, when người dùng mở trang `/body-retouch` hoặc hộp thoại Body Retouch, then nút "Tạo" bị vô hiệu kèm thông báo và lối dẫn nạp thêm credit (`/pricing`) hoặc đăng nhập tương ứng.
- Given Task `body_retouch` chuyển sang `failed` với mã `NO_POSE` hoặc quá trình tạo gặp lỗi `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `PAUSED`, `CONSENT_REQUIRED`, `VALIDATION_FAILED`, when hiển thị trên giao diện, then hiện đúng thông báo tiếng Việt theo hợp đồng và xác nhận hoàn 100% credit khi Task lỗi.

### Review Findings

- [x] [Review][Patch] Cập nhật đoạn mô tả trạng thái running trong TaskProgressCard theo pipeline [apps/web/components/TaskProgressCard.vue:305-307]
- [x] [Review][Patch] Thêm role="alert" và aria-live="assertive" cho banner lỗi submit trên trang và dialog [apps/web/pages/body-retouch.vue:339, apps/web/components/FeatureWorkspaceDialog.vue:477]

#### Rejected
- TaskProgressCard success heading defaults to Face Swap in generic views [apps/web/components/TaskProgressCard.vue:14–22]: false — Trang `/tasks/[id]` thuộc phạm vi Story 4.5 và không hiển thị TaskProgressCard khi succeeded.
- Missing min/default/max boundary markers on FeatureWorkspaceDialog slider [apps/web/components/FeatureWorkspaceDialog.vue:415–474]: false — Dialog hiển thị tối giản với 3 chip mốc vùng 1–3, 4–7, 8–10 ngay dưới slider để tránh quá tải giao diện modal.
- Unauthenticated guest balance check in body-retouch.vue [apps/web/pages/body-retouch.vue:70–73]: false — Quy ước thiết kế toàn hệ thống để ẩn cảnh báo thiếu số dư cho khách chưa đăng nhập, ưu tiên banner yêu cầu đăng nhập.
- Non-interactive zone marker chips on touch screens [apps/web/pages/body-retouch.vue:257–275]: false — Tiêu chí nghiệm thu của Epic và spec yêu cầu 3 mốc nhãn hiển thị vùng dưới thanh trượt, không yêu cầu làm nút bấm chọn nhanh.
- Synthetic script setup mocking in SSR test suites [apps/web/test/body-retouch.test.mjs:191–230]: false — Mô hình test SSR chuẩn của toàn monorepo (smoke.test.mjs, topup.test.mjs).
- Binary ternary for :pipeline-label-vi in FeatureWorkspaceDialog [apps/web/components/FeatureWorkspaceDialog.vue:320–324]: low — Hiện chỉ có Face Swap và Body Retouch hoạt động; Epic 5 sẽ mở rộng cho Motion Control.
- Hardcoded route path ternary for standalone page link in FeatureWorkspaceDialog [apps/web/components/FeatureWorkspaceDialog.vue:294–296]: low — Đường dẫn hoạt động chính xác cho cả 2 tính năng hiện có.
- Missing formatNumberVi on credit values in body-retouch.vue [apps/web/pages/body-retouch.vue:173]: low — Đơn giá 100 và số dư hiển thị nhất quán với face-swap.vue.
- Suppression of detailed Zod validation messages on invalid intensity [apps/web/pages/body-retouch.vue:98–103]: low — Slider giới hạn 1..10 ở UI, thông báo lỗi tiếng Việt chung cho VALIDATION_FAILED là chuẩn hệ thống.
- resolveApiErrorMessageVi unhandled ZodError fallback [apps/web/utils/api-client.ts:204–228]: low — Hàm tiện ích kế thừa từ Epic 1, không thuộc phạm vi Story 4.4.
- FeatureWorkspaceDialog.vue handleSubmit() emit seconds cho body-retouch: false — Payload metadata dùng chung cho dialog event.
- body-retouch.vue handleReset() không reset intensity về 5: false — Giữ lại mức điều chỉnh người dùng vừa chọn khi thử lại với ảnh khác là UX tiện lợi.

## Implementation Notes

- Đã bổ sung re-export `BodyRetouchCreateRequestSchema`, `BodyRetouchCreateResponseSchema`, `INTENSITY_DEFAULT`, `INTENSITY_LABEL_ZONES`, `INTENSITY_MAX`, `INTENSITY_MIN`, `IntensitySchema`, `getIntensityLabelVi` và phương thức `createBodyRetouchTask` trong `apps/web/utils/api-client.ts`.
- Đã cập nhật tiêu đề trạng thái `succeeded` trong `apps/web/components/TaskProgressCard.vue` sang `{{ pipelineLabelVi }} thành công!`.
- Đã xây dựng trang `apps/web/pages/body-retouch.vue` và tích hợp nhánh `feature.id === 'body-retouch'` vào `apps/web/components/FeatureWorkspaceDialog.vue` cùng bộ kiểm thử `apps/web/test/body-retouch.test.mjs`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Unverified API error handling and client validation in `FeatureWorkspaceDialog.handleSubmit` for Body Retouch (`apps/web/test/body-retouch.test.mjs`) | medium | patch | Test cũ chưa kiểm tra nhánh lỗi khi submit từ dialog; đã thêm test cho `INSUFFICIENT_CREDIT`, `VALIDATION_FAILED`, reset `isSubmitting` và `activeTask === null` |
| Unverified dynamic pipeline label prop binding for `TaskProgressCard` in `FeatureWorkspaceDialog` (`apps/web/test/body-retouch.test.mjs`) | low | patch | SSR test cũ truyền `activeTask: null`; đã thêm SSR render assertion kiểm tra `TaskProgressCard` nhận `data-label="Chỉnh sửa vóc dáng"` |
| `body-retouch.vue` và `FeatureWorkspaceDialog.vue` thiếu `:aria-valuetext="intensityLabelVi"` trên range slider | low | patch | Đã thêm `:aria-valuetext="intensityLabelVi"` và `:aria-valuenow="intensity"` cho cả 2 slider để hỗ trợ screen readers |
| `body-retouch.vue` và `FeatureWorkspaceDialog.vue` không tự xóa `submitErrorVi` khi người dùng đổi ảnh hoặc mức intensity | low | patch | Đã thêm watcher `{ flush: 'sync' }` trên dữ liệu đầu vào để tự động xóa lỗi cũ khi thay đổi ảnh/intensity |
| `body-retouch.vue`: `hasEnoughBalance` trả về `true` khi khách chưa đăng nhập làm ẩn cảnh báo thiếu số dư | false | - | Thiết kế có chủ đích chung với `face-swap.vue` để khách chưa đăng nhập chỉ thấy banner yêu cầu đăng nhập, tránh hiện trùng cảnh báo thiếu credit |
| `body-retouch.vue`: `bodyRetouchCreditCost` và `userBalance` không dùng `formatNumberVi` | low | reject | Chi phí cố định 100 và số dư hiển thị bình thường; cùng mẫu hiển thị với `face-swap.vue`, thêm helper không mang lại giá trị thực tế |
| `FeatureWorkspaceDialog.vue`: `:pipeline-label-vi` dùng toán tử 3 ngôi nhị phân thay vì tra cứu động | low | reject | Hiện monorepo mới chỉ có Face Swap và Body Retouch hoạt động; Motion Control thuộc Epic 5 sẽ mở rộng khi triển khai |
| `TaskProgressCard.vue`: prop `pipelineLabelVi` mặc định là 'Hoán đổi khuôn mặt' | low | reject | Giá trị mặc định đảm bảo tương thích ngược; các vị trí sử dụng Body Retouch đều truyền rõ prop; trang `/tasks/[id]` thuộc phạm vi Story 4.5 |
| Ba chip nhãn vùng `INTENSITY_LABEL_ZONES` là thẻ `<div>` tĩnh thay vì nút bấm chọn preset | false | - | AC Story 4.4 yêu cầu hiển thị 3 mốc vùng nhãn dưới thanh trượt, không yêu cầu làm nút bấm chọn nhanh |
| `FeatureWorkspaceDialog.vue`: `handleSubmit()` emit `seconds: selectedSeconds.value` cho body-retouch | false | - | Payload emit là metadata sự kiện dùng chung của dialog cho component cha, không ảnh hưởng logic |
| `body-retouch.vue`: `handleReset()` không reset `intensity` về 5 | false | - | Giữ lại mức intensity người dùng vừa chọn khi thử lại với ảnh khác là UX tiện lợi, không phải lỗi |
| `body-retouch.test.mjs`: test chỉ dùng giá tĩnh 100 credit, chưa test giá động khác | false | - | Hợp đồng `@flowvis/contracts` (Story 4.1) quy định cứng `bodyRetouchCredits: z.literal(100)`, không có giá khác |
| `api-client.ts`: `createBodyRetouchTask` không kiểm tra khoảng trắng trước khi parse | false | - | Zod schema `BodyRetouchCreateRequestSchema` đã kiểm tra nghiêm ngặt `ConfirmedUploadKeySchema`, loại bỏ mọi chuỗi sai định dạng |

## Verification

**Commands:**
- `pnpm --filter @flowvis/web test` -- expected: toàn bộ test cũ và `test/body-retouch.test.mjs` mới đều pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass không lỗi trên toàn monorepo
- `pnpm run check:boundaries --base=be/story-4-3-ket-qua-body-retouch` -- expected: chỉ sửa trong `apps/web/**` (ngoài các file `_bmad-output/**` chưa commit)

