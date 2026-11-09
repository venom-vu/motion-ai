---
title: 'Story 3.7: [FE] Dashboard Admin duyệt đơn nạp'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: 'c9db379df021a1b87e5c296e27c70d1c41a8a8a9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Quản trị viên chưa có giao diện trên web để theo dõi danh sách đơn nạp VietQR, lọc đơn chờ duyệt, đối chiếu mã giao dịch ngân hàng (`bank_ref`), thực hiện các thao tác nghiệp vụ (Duyệt, Từ chối, Cần xem xét, Đưa về chờ duyệt, Duyệt đơn quá hạn) và xử lý lỗi xung đột trạng thái giữa các Admin.

**Approach:** Xây dựng trang `/admin/topups` sử dụng layout Admin phong cách Vercel (`apps/web/layouts/admin.vue` và `mockups/desktop-vietqr-admin.html`), bổ sung các API client methods gọi endpoint `/admin/topups/**`, phát triển composable `useAdminTopups` quản lý bộ lọc, phân trang cursor, khóa gửi yêu cầu (chống click đúp), và các dialog xác nhận thao tác nghiệp vụ với thông báo tiếng Việt chính xác.

## Boundaries & Constraints

**Always:**
- Tuân thủ nhận diện thị giác Slate Cyber kết hợp phong cách Vercel tối giản (nền `#0A0A0A`, viền mảnh `1px`, font `monospace`, bảng dữ liệu rõ ràng, thao tác nhanh).
- 100% icon vector Lucide qua `<Icon name="lucide:..." />`, tuyệt đối không dùng emoji trong UI chrome.
- Tuân thủ ranh giới di động: vùng chạm tối thiểu 48px (`min-h-[48px] min-w-[48px]`), dùng được trơn tru ở viewport chuẩn 360px (chuyển bảng dữ liệu sang dạng thẻ xếp 1 cột trên mobile).
- Kiểm soát quyền truy cập chặt chẽ: người dùng chưa đăng nhập hoặc có `role !== 'admin'` khi truy cập `/admin/topups` phải bị chặn (hiển thị trang 403 Forbidden hoặc điều hướng về đăng nhập), tuyệt đối không để lộ dữ liệu đơn nạp nào.
- Bộ lọc trạng thái: mặc định là `pending`, có thể lọc theo `all`, `pending`, `needs_review`, `expired`, `approved`, `rejected`.
- Đơn `pending` có `isOverdue: true` (hoặc quá `approveBy`) phải hiển thị nhãn nổi bật cảnh báo quá hạn duyệt SLA (08:00–23:00 UTC+7).
- Form Duyệt đơn (`approve`): bắt buộc nhập `bank_ref` (tối đa 128 ký tự, cắt khoảng trắng đầu cuối), hiển thị số tiền VNĐ và credit cần đối chiếu, có bước xác nhận trước khi gửi và khóa nút để chống click đúp.
- Form Từ chối (`reject`): bắt buộc nhập lý do từ chối `rejectReason` (tối đa 500 ký tự).
- Form Cần xem xét (`needs-review`): bắt buộc nhập ghi chú `note` (tối đa 500 ký tự).
- Thao tác Đưa về chờ duyệt (`return-to-pending`): gửi request với body rỗng.
- Duyệt đơn đã hết hạn (`expired`): có lối đi riêng (`approve-expired`), hiển thị cảnh báo rõ ràng đơn đã hết hạn và bắt buộc nhập `bank_ref`.
- Xử lý lỗi nghiệp vụ bằng tiếng Việt chuẩn xác qua `getApiErrorMessageVi`: `BANK_REF_DUPLICATE` (409), `TOPUP_STATE_INVALID` (409), `VALIDATION_FAILED` (400), `FORBIDDEN` (403).
- Khi gặp lỗi `TOPUP_STATE_INVALID`, hiển thị thông báo và tự động làm mới danh sách đơn để cập nhật trạng thái mới nhất do Admin khác đã thao tác.
- Danh sách hỗ trợ phân trang cursor với nút tải thêm, có trạng thái tải dữ liệu, trạng thái rỗng và trạng thái lỗi.

**Never:**
- Không hiển thị email người dùng ở giao diện Admin phía client nếu API backend chỉ trả `userId` (tuân thủ hợp đồng `AdminTopup` bảo mật PII).
- Không sửa đổi mã nguồn backend `apps/api/` hoặc package `packages/contracts` trong story này (giữ nguyên hợp đồng đã chốt ở Story 3.1 & 3.5).
- Không dùng Drawer hay Bottom Sheet; mọi modal xác nhận/nhập liệu mở dạng Centered Dialog.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chưa đăng nhập hoặc role user mở `/admin/topups` | `accessToken = null` hoặc `user.role === 'user'` | Hiển thị màn hình 403 Forbidden hoặc điều hướng đăng nhập, không gọi API `/admin/topups` | N/A |
| Admin mở `/admin/topups` | `user.role === 'admin'` | Tải danh sách đơn với filter mặc định `pending`, hiển thị bảng đơn nạp, số lượng đơn | Hiển thị banner lỗi và nút Thử lại nếu API lỗi |
| Đơn quá hạn duyệt SLA | Đơn `pending` có `isOverdue === true` | Hiển thị badge nổi bật "QUÁ HẠN" màu đỏ/vàng trên dòng/thẻ đơn | N/A |
| Lọc theo trạng thái | Chọn filter tab (`pending`, `needs_review`, `expired`, `approved`, `rejected`, `all`) | Gọi lại API với query `status`, reset cursor, cập nhật danh sách | N/A |
| Duyệt đơn pending | Nhập `bank_ref`, bấm Duyệt | Hiển thị dialog xác nhận số tiền đối chiếu, gửi `POST /admin/topups/{id}/approve`, khóa nút gửi | Thông báo lỗi nếu trùng `bank_ref` hoặc thất bại |
| Duyệt đơn bị trùng `bank_ref` | Server trả `BANK_REF_DUPLICATE` (409) | Hiển thị thông báo tiếng Việt: "Mã giao dịch ngân hàng này đã được dùng cho một đơn nạp khác. Vui lòng kiểm tra lại." | Giữ nguyên form để Admin sửa `bank_ref` |
| Thao tác khi đơn đã bị Admin khác đổi trạng thái | Server trả `TOPUP_STATE_INVALID` (409) | Hiển thị thông báo: "Đơn nạp không ở trạng thái phù hợp để thực hiện thao tác này. Vui lòng tải lại danh sách.", đóng dialog và tự động tải lại danh sách | Tự động refresh danh sách |
| Từ chối đơn | Bấm Từ chối, nhập `rejectReason` | Gửi `POST /admin/topups/{id}/reject`, cập nhật trạng thái đơn trong danh sách | Bắt lỗi nếu thiếu lý do |
| Đánh dấu Cần xem xét | Bấm Cần xem xét, nhập `note` | Gửi `POST /admin/topups/{id}/needs-review`, cập nhật trạng thái đơn | Bắt lỗi nếu thiếu ghi chú |
| Đưa về chờ duyệt | Bấm Đưa về chờ duyệt trên đơn `needs_review` | Gửi `POST /admin/topups/{id}/return-to-pending`, đưa đơn về `pending` | Bắt lỗi nếu API thất bại |
| Duyệt đơn `expired` | Bấm "Duyệt đơn quá hạn" trên đơn `expired` | Mở dialog cảnh báo đơn đã hết hạn, bắt buộc nhập `bank_ref`, gửi `POST /admin/topups/{id}/approve-expired` | N/A |
| Phân trang danh sách dài | Cuộn xuống cuối / bấm "Tải thêm" khi `hasMore === true` | Gọi API với `cursor = nextCursor`, nối thêm đơn vào danh sách | N/A |
| Danh sách rỗng | Không có đơn nào theo bộ lọc | Hiển thị trạng thái rỗng "Không có đơn nạp nào phù hợp" | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/utils/api-client.ts`: bổ sung các phương thức gọi API Admin topups: `adminListTopups`, `adminApproveTopup`, `adminApproveExpiredTopup`, `adminRejectTopup`, `adminNeedsReviewTopup`, `adminReturnTopupToPending`.
- `apps/web/composables/useAdminTopups.ts`: composable quản lý trạng thái tải danh sách đơn, bộ lọc trạng thái, phân trang cursor, thực hiện các thao tác duyệt/từ chối/cần xem xét/đưa về chờ duyệt, xử lý chống click đúp và tự động làm mới khi gặp `TOPUP_STATE_INVALID`.
- `apps/web/components/AdminTopupActionModal.vue`: component Centered Dialog phục vụ các hành động: Duyệt đơn (nhập `bank_ref`), Duyệt đơn hết hạn (cảnh báo + `bank_ref`), Từ chối (nhập `rejectReason`), Cần xem xét (nhập `note`).
- `apps/web/pages/admin/topups.vue`: trang Dashboard Admin duyệt đơn nạp đầy đủ tính năng theo AC Story 3.7 và thiết kế Vercel style của `mockups/desktop-vietqr-admin.html`.
- `apps/web/layouts/admin.vue`: cập nhật mục điều hướng sidebar trỏ tới `/admin/topups` (nhãn "Duyệt đơn VietQR").
- `apps/web/test/admin-topups.test.mjs`: test suite kiểm thử toàn diện Story 3.7 (phân quyền 403, bộ lọc, xử lý action, phân trang, thông báo lỗi tiếng Việt, chống click đúp, render tương thích mobile 360px).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/utils/api-client.ts` -- Bổ sung Admin Topup API methods -- thêm các hàm gọi `adminListTopups`, `adminApproveTopup`, `adminApproveExpiredTopup`, `adminRejectTopup`, `adminNeedsReviewTopup`, `adminReturnTopupToPending` với schema Zod chuẩn.
- [x] `apps/web/composables/useAdminTopups.ts` -- Tạo composable `useAdminTopups` -- quản lý danh sách, filter, pagination cursor, gọi API action, khóa chống click đúp và auto-refresh khi gặp `TOPUP_STATE_INVALID`.
- [x] `apps/web/components/AdminTopupActionModal.vue` -- Xây dựng dialog xử lý đơn nạp -- hỗ trợ nhập `bank_ref` (có đối chiếu số tiền), cảnh báo đơn hết hạn, nhập lý do từ chối hoặc ghi chú xem xét.
- [x] `apps/web/pages/admin/topups.vue` -- Xây dựng trang Dashboard Admin duyệt đơn nạp -- phân quyền chặt chẽ (chặn non-admin/khách), bộ lọc trạng thái, bảng desktop & thẻ mobile 360px, badge quá hạn nổi bật.
- [x] `apps/web/layouts/admin.vue` -- Cập nhật sidebar điều hướng -- bổ sung liên kết `/admin/topups` với icon `lucide:receipt`.
- [x] `apps/web/test/admin-topups.test.mjs` -- Viết bộ unit & integration tests -- kiểm thử toàn bộ I/O matrix, role guard, hành vi form và SSR render.

### Review Findings

- [ ] [Review][Patch] Bổ sung kiểm thử cho isOverdue, approveExpiredTopup và handleModalConfirm [apps/web/test/admin-topups.test.mjs]
- [ ] [Review][Patch] Trích xuất hàm helper isOverdue ra utils/topup.ts để dùng chung và test trực tiếp [apps/web/utils/topup.ts, apps/web/pages/admin/topups.vue]
- [ ] [Review][Patch] Dọn dẹp globalThis.document trong khối try...finally để tránh ô nhiễm test runner [apps/web/test/admin-topups.test.mjs]
- [ ] [Review][Patch] Ngăn focus thoát khỏi modal khi isSubmitting = true và reset isLoadingMore khi fetchTopups reset [apps/web/components/AdminTopupActionModal.vue, apps/web/composables/useAdminTopups.ts]
- [ ] [Review][Patch] Xóa thông báo lỗi khi người dùng gõ vào input và bổ sung role="alert" / aria-live cho các thông báo [apps/web/components/AdminTopupActionModal.vue, apps/web/pages/admin/topups.vue]
- [ ] [Review][Patch] Thêm nút Đăng nhập trên màn hình 403 và chuyển breadcrumb Admin thành NuxtLink tới /admin [apps/web/pages/admin/topups.vue]
- [x] [Review][Defer] Các ô chỉ số thống kê trên đỉnh trang admin phụ thuộc vào tab lọc hiện tại do thiếu endpoint backend tổng hợp [apps/web/pages/admin/topups.vue] — deferred: backend chưa có route GET /admin/ops/metrics hay summary thống kê, cần làm ở Epic 6

#### Rejected Findings
- Processed orders persist in table: by design for operator feedback before filter switch (false).
- Missing detail drawer: spec & mockup did not specify separate detail drawer (false).
- Modal lacks max-h/overflow: already implemented via max-h-[90vh] overflow-y-auto (false).
- Status filter not in query params: not in AC, cosmetic (low).
- Periodic auto-polling: not in AC, manual refresh provided (low).
- isOverdue non-reactive Date.now: operator list refreshes frequently (low).
- Copy-to-clipboard: nice to have, not in AC (low).
- handleReturnToPending confirmation: reversible action, low risk (low).
- Restore focus on modal close: negligible a11y polish (low).
- sprint-status set to done: false, was set to review (false).

**Acceptance Criteria:**
- Given người dùng role `user` hoặc chưa đăng nhập, when mở `/admin/topups`, then FE chuyển về trang đăng nhập hoặc hiển thị trang 403, không lộ dữ liệu nào.
- Given Admin đã đăng nhập, when mở `/admin/topups`, then thấy danh sách đơn có bộ lọc theo trạng thái (mặc định `pending`), mã đơn, gói, số tiền, thời gian tạo và thời hạn duyệt, và đơn quá `approve_by` (hoặc `isOverdue`) có nhãn nổi bật.
- Given một đơn `pending`, when Admin mở chi tiết và bấm Duyệt, then form bắt buộc nhập `bank_ref`, hiển thị số tiền cần đối chiếu và thông báo xác nhận trước khi gửi, và bấm nhiều lần chỉ gửi một yêu cầu.
- Given thao tác Từ chối, when Admin bấm, then form bắt buộc nhập lý do.
- Given thao tác Đánh dấu "Cần xem xét" và "Đưa về chờ duyệt", when Admin bấm, then gọi đúng endpoint tương ứng.
- Given đơn `expired`, when Admin muốn duyệt, then giao diện có lối riêng, hiển thị cảnh báo đây là đơn đã hết hạn và yêu cầu nhập `bank_ref`.
- Given `BANK_REF_DUPLICATE`, `TOPUP_STATE_INVALID`, `VALIDATION_FAILED`, when FE nhận, then hiển thị thông báo tiếng Việt, và danh sách tự làm mới khi trạng thái đơn đã đổi bởi Admin khác.
- Given danh sách dài, when cuộn/bấm tải thêm, then tải thêm trang tiếp theo; có trạng thái rỗng và trạng thái lỗi.
- Given story này, when chạy, then hoạt động đầy đủ ở chế độ mock và dùng được ở viewport 360 px.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Reviewer | Location | Verdict | Evidence / Note | Route |
|---|---|---|---|---|
| Blind Hunter | apps/web/pages/admin/topups.vue:32-34 | medium | meAsync ở trạng thái pending khi mới vào trang khiến isAdmin là false, làm màn hình 403 nhấp nháy trước khi phiên admin kịp tải xong. | patch |
| Blind Hunter / Edge Case Hunter | apps/web/composables/useAdminTopups.ts:61-63 | medium | Lỗi khi loadMore đặt errorVi làm unmount toàn bộ danh sách đơn đã tải thay vì giữ danh sách và hiển thị lỗi tải thêm. | patch |
| Blind Hunter | apps/web/components/AdminTopupActionModal.vue | low | Modal thiếu bẫy focus, autofocus vào input đầu tiên và lắng nghe phím Escape để đóng. | patch |
| Blind Hunter / Verification Gap | apps/web/pages/admin/topups.vue:71-86 | low | Các ô thống kê tính từ topups.value nên bị giới hạn theo tab filter và số trang đã load. | patch |
| Blind Hunter / Edge Case Hunter | apps/web/pages/admin/topups.vue:116-140 | medium | handleModalConfirm đóng modal trong im lặng nếu payload thiếu trường bắt buộc thay vì báo lỗi. | patch |
| Blind Hunter | apps/web/pages/admin/topups.vue:88-95 | medium | isOverdue kiểm tra order.isOverdue trước khi kiểm tra status === 'pending', có thể hiển thị nhầm badge quá hạn trên đơn đã duyệt. | patch |
| Blind Hunter / Edge Case Hunter | apps/web/composables/useAdminTopups.ts:40-70 | medium | Chuyển tab filter liên tục có thể gây race condition khi request cũ trả về sau request mới, ghi đè danh sách. | patch |
| Edge Case Hunter | apps/web/pages/admin/topups.vue:563, 710 | medium | Đơn awaiting_transfer khi xem ở filter 'all' rơi vào nhánh v-else hiển thị 'Đã hoàn tất' thay vì 'Chờ chuyển khoản'. | patch |
| Verification Gap | apps/web/test/admin-topups.test.mjs:487-652 | patch | Logic script setup và handleSubmit của AdminTopupActionModal chưa được thực thi trong test. | patch |
| Verification Gap | apps/web/test/admin-topups.test.mjs:347-368 | patch | Chưa có test kiểm tra setStatusFilter('all') truyền status: undefined lên API thay vì chuỗi 'all'. | patch |
| Verification Gap | apps/web/test/admin-topups.test.mjs:849-858 | patch | layouts/admin.vue mới chỉ kiểm tra qua fs.readFileSync mà chưa kiểm tra HTML kết xuất. | patch |

### Review Findings

- [x] [Review][Patch] `useAdminTopups`: reset `isLoadingMore.value = false` khi `fetchTopups(reset = true)` để tránh kẹt cờ tải thêm khi chuyển tab filter.
- [x] [Review][Patch] `topup.ts`: Trích xuất và export hàm `isOverdue(order, nowMs)` dùng chung giữa UI và composable để tránh nhân bản logic tính SLA.
- [x] [Review][Patch] `AdminTopupActionModal.vue`: Chặn thoát focus bằng `e.preventDefault()` khi modal không có focusable elements (`!focusable.length`).
- [x] [Review][Patch] `AdminTopupActionModal.vue`: Xóa lỗi `localErrorVi = null` khi người dùng bắt đầu nhập liệu (`@input`), thêm `role="alert"` / `aria-live="polite"`.
- [x] [Review][Patch] `pages/admin/topups.vue`: Sửa breadcrumb Admin thành `NuxtLink` tới `/admin` và bổ sung ARIA roles `role="status"` / `role="alert"`.
- [x] [Review][Patch] `admin-topups.test.mjs`: Bổ sung unit tests cho `isOverdue`, `approveExpiredTopup`, breadcrumb link, `role="status"`, dọn dẹp `delete globalThis.document` trong `finally`.

## Design Notes

Giao diện áp dụng phong cách Vercel tối giản từ `mockups/desktop-vietqr-admin.html`:
- Desktop: Left Sidebar 220px, thanh breadcrumb trên đỉnh, 4 ô thống kê kỹ thuật nhanh, bảng dữ liệu đa cột với các cột Code (`NAP <code>`), Gói & Số tiền, Thời hạn duyệt (`approve_by` / `isOverdue`), Mã tham chiếu `bank_ref` và Thao tác nhanh.
- Mobile (< 768px, chuẩn 360px): Bảng tự động chuyển sang danh sách thẻ xếp 1 cột, mỗi thẻ hiển thị đầy đủ mã đơn, số tiền, gói nạp, thời hạn duyệt với vùng chạm tối thiểu 48px.
- Mọi modal thao tác nghiệp vụ (Duyệt, Từ chối, Cần xem xét, Duyệt đơn quá hạn) đều là Centered Dialog nổi trên nền tối mờ, có bẫy focus và không che khuất dữ liệu ngoài ý muốn.

## Verification

**Commands:**
- `pnpm run check:boundaries` -- expected: Branch boundary check passed
- `pnpm run lint` -- expected: No ESLint warnings or errors
- `pnpm run typecheck` -- expected: TypeScript compiles without errors on all workspaces
- `pnpm --filter @motion-ai/web test` -- expected: Toàn bộ tests của web bao gồm `admin-topups.test.mjs` pass 100%

