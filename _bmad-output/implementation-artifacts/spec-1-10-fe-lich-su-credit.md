---
title: 'Story 1.10: [FE] Lịch sử credit'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
baseline_commit: '99814442fd116138eecd8359556c35e11bff3cfa'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trang `/history` hiện tại mới chỉ hiển thị danh sách tĩnh 20 bút toán đầu tiên, chưa hỗ trợ cuộn phân trang vô tận (`hasMore`, `nextCursor`), chưa có giao diện skeleton khi đang tải, chưa có trạng thái rỗng có giải thích rõ ràng và chưa xử lý tải tiếp khi API lỗi.

**Approach:** Nâng cấp `apps/web/pages/history.vue` với cơ chế tải phân trang theo cursor (`GET /wallet/ledger?pageSize=20&cursor=...`), kích hoạt khi cuộn chạm đáy danh sách qua `IntersectionObserver` (kèm nút dự phòng), hiển thị skeleton khi tải lần đầu, spinner khi tải thêm, banner lỗi tiếng Việt kèm nút thử lại ở cả 2 cấp (tải đầu / tải thêm), và trạng thái rỗng thân thiện khi người dùng chưa có bút toán hoặc chưa đăng nhập.

## Boundaries & Constraints

**Always:**
- Nhận diện Slate Cyber: nền tối `#0A0A0A`, viền `#1E1E1E` (`border-cyber-border`), bề mặt `bg-cyber-surface`, chữ `text-cyber-text` và `text-cyber-muted`, icon Lucide qua `nuxt-icon`.
- Tuyệt đối không dùng emoji trong UI chrome; vùng chạm tối thiểu 48px (`touch-target`).
- Định dạng thời gian theo giờ Việt Nam (`Asia/Ho_Chi_Minh` qua `Intl.DateTimeFormat`), nhãn tiếng Việt chuẩn 6 loại bút toán (`Tặng`, `Nạp`, `Giữ`, `Hoàn`, `Chốt`, `Điều chỉnh`), số credit có dấu (+/-) qua `formatSignedCreditsVi`.
- Màu sắc trực quan theo quy tắc: số dương màu xanh (`text-cyber-success`), số âm màu vàng/cam (`text-cyber-warning`), số 0 màu xám (`text-cyber-muted`).
- Tương thích hoàn toàn màn hình điện thoại 360px (mobile-first) và desktop toàn màn hình.
- Chỉ sửa đổi mã nguồn trong `apps/web/` (nhánh `fe/*`).

**Never:**
- Không sửa `apps/api/` hoặc `packages/contracts/`.
- Không xóa các bút toán đã tải khi một trang tiếp theo gặp lỗi (giữ nguyên danh sách hiện tại và chỉ hiển thị lỗi kèm nút thử lại tải thêm).
- Không gọi API trùng lặp khi một yêu cầu tải trang đang chạy (`loadingMore` guard).
- Không chặn trang bằng route guard ép chuyển hướng khi chưa đăng nhập; hiển thị trạng thái chưa đăng nhập thân thiện kèm nút mở đăng nhập.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tải trang lần đầu thành công | Đã đăng nhập, mở `/history` | Hiển thị danh sách bút toán mới nhất trước, nhãn tiếng Việt, giờ VN, số credit có dấu | N/A |
| Đang tải trang đầu | `pending = true`, chưa có dữ liệu | Hiển thị 3–4 dòng skeleton nhấp nháy giữ chỗ | N/A |
| Trang đầu rỗng | Đã đăng nhập, `items = []` | Hiển thị thẻ rỗng có icon `lucide:inbox` và lời giải thích thân thiện | N/A |
| Chưa đăng nhập | Khách mở `/history` (`accessToken = null`) | Hiển thị thông báo cần đăng nhập kèm nút dẫn sang `/login` | N/A |
| Cuộn đến cuối trang | `hasMore = true`, chạm đáy danh sách | Tự động gọi `GET /wallet/ledger?cursor=...`, nối thêm dữ liệu vào danh sách | N/A |
| Hết toàn bộ dữ liệu | `hasMore = false` sau khi tải trang cuối | Hiển thị dòng ghi chú "Đã hiển thị toàn bộ lịch sử" | N/A |
| Lỗi API tải trang đầu | `GET /wallet/ledger` lỗi 5xx hoặc mạng | Hiển thị `ApiErrorBanner` tiếng Việt kèm nút "Thử lại" | Bấm nút thử lại gọi lại trang đầu |
| Lỗi API tải trang tiếp theo | Lỗi khi đang tải thêm bằng cursor | Giữ nguyên danh sách cũ, hiển thị cảnh báo lỗi tải thêm kèm nút "Thử lại" | Bấm thử lại gọi lại trang với cursor hiện tại |
| Bấm "Làm mới sổ cái" | Bấm nút refresh ở header trang | Tải lại từ trang đầu tiên (xóa cursor), cập nhật lại danh sách | Báo lỗi banner nếu thất bại |

</frozen-after-approval>

## Code Map

- `apps/web/pages/history.vue` -- trang lịch sử credit; nâng cấp để quản lý danh sách `items`, `nextCursor`, `hasMore`, trạng thái tải đầu (`pending`), trạng thái tải thêm (`loadingMore`), lỗi tải thêm (`loadMoreErrorVi`), skeleton, sentinel cuộn đáy qua `IntersectionObserver`.
- `apps/web/utils/catalog.ts` -- chứa `formatSignedCreditsVi`, `formatNumberVi` đã có sẵn; tái sử dụng định dạng credit và số.
- `apps/web/utils/api-client.ts` -- chứa `createMotionApiClient`, `resolveApiErrorMessageVi`; `client.getWalletLedger({ pageSize, cursor })` đã hỗ trợ cursor.
- `apps/web/composables/useApiClient.ts` -- cung cấp `client` và `accessToken`.
- `apps/web/composables/useAuth.ts` -- cung cấp `isAuthenticated`.
- `apps/web/components/ApiErrorBanner.vue` -- tái sử dụng hiển thị thông báo lỗi và nút thử lại chuẩn của hệ thống.
- `apps/web/test/smoke.test.mjs` -- bổ sung bộ test kiểm chứng các kịch bản của Story 1.10 (phân trang, rỗng, skeleton/đang tải, lỗi & thử lại, viewport 360px).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/pages/history.vue` -- nâng cấp giao diện lịch sử với phân trang cursor, infinite scroll qua sentinel `IntersectionObserver`, trạng thái skeleton khi khởi tạo, spinner tải thêm, trạng thái rỗng và thẻ chưa đăng nhập, xử lý lỗi và nút thử lại ở cả 2 tầng.
- [x] `apps/web/test/smoke.test.mjs` -- bổ sung bộ unit/component test kiểm chứng Story 1.10: SSR `/history`, danh sách bút toán có đủ 6 nhãn tiếng Việt và định dạng credit có dấu, trạng thái rỗng khi không có bút toán, trạng thái chưa đăng nhập, hành vi nối trang khi phân trang theo cursor và xử lý lỗi tải thêm.

**Acceptance Criteria:**
- Given người dùng đã đăng nhập, when mở `/history`, then thấy danh sách bút toán mới nhất trước, mỗi dòng có loại tiếng Việt (Tặng, Nạp, Giữ, Hoàn, Chốt, Điều chỉnh), số credit có dấu (+/-) và thời gian theo giờ Việt Nam.
- Given danh sách dài hơn một trang và người dùng cuộn đến cuối danh sách, when chạm sentinel đáy, then gọi `GET /wallet/ledger` với cursor tương ứng và nối thêm các dòng mới vào danh sách mà không làm gián đoạn vị trí cuộn.
- Given người dùng chưa có bút toán nào, when mở `/history`, then hiển thị khối trạng thái rỗng có biểu tượng và thông điệp giải thích vì sao chưa có biến động.
- Given API trả lỗi ở lần tải đầu hoặc lần tải thêm, when xem giao diện, then hiển thị thông báo lỗi tiếng Việt thân thiện kèm nút thử lại; ở lần tải thêm, các bút toán đã tải trước đó không bị biến mất.
- Given màn hình thiết bị 360 px, when xem trang, then toàn bộ thành phần không bị tràn ngang, các nút thao tác đạt diện tích chạm tối thiểu 48 px.

### Review Findings

- [x] [Review][Patch] Không xóa các bút toán đã tải và không trả về dữ liệu cũ khi refresh thất bại [apps/web/pages/history.vue:28-31, apps/web/utils/wallet-ledger.ts:161-167]
- [x] [Review][Patch] Sửa logic isUnauthenticated và dọn sạch dữ liệu cũ khi đăng xuất [apps/web/pages/history.vue:61-73]
- [x] [Review][Patch] Khử race condition session restore khi mở trang chưa có token nhưng sau đó có token [apps/web/pages/history.vue:52-59]
- [x] [Review][Patch] Chuẩn hóa hasMore kết hợp kiểm tra nextCursor để tránh kẹt nút tải thêm [apps/web/utils/wallet-ledger.ts:74-76,145]
- [x] [Review][Patch] Bắt lỗi an toàn trong formatTimestampVi tránh ném RangeError khi thời gian không hợp lệ [apps/web/utils/wallet-ledger.ts:17-19]
- [x] [Review][Patch] Thêm kiểm thử hồi quy cho deduplication, refresh thất bại và isUnauthenticated [apps/web/test/smoke.test.mjs:1169-1268]
- [x] [Review][Patch] Bỏ qua kết quả loadMore muộn nếu phiên đăng nhập đã thay đổi hoặc đã xóa danh sách [apps/web/utils/wallet-ledger.ts:141-144]
- [x] [Review][Patch] Bổ sung thuộc tính trợ năng role=alert, aria-busy và trạng thái disabled cho nút tải thêm [apps/web/pages/history.vue:178,227,351]
- [x] [Review][Defer] Kiểm thử reactive watcher accessToken trên Nuxt client runtime [apps/web/pages/history.vue:52-59] — deferred: Cần bổ sung test harness component mount chuyên dụng (@nuxt/test-utils hoặc @vue/test-utils) hiện chưa cấu hình trong repo.

#### Rejected
- `BF9`: Bỏ qua việc sửa nhật ký Review Triage Log trong spec vì quy tắc review không sửa spec đang xét.


## Implementation Notes

- Đã nâng cấp `apps/web/pages/history.vue` với đầy đủ các trạng thái:
  1. Phân trang cursor với `IntersectionObserver` qua sentinel `<div ref="bottomSentinel">` (kèm nút dự phòng "Tải thêm lịch sử" khi chưa chạm đáy).
  2. Guard `loadingMore` ngăn ngừa gọi trùng API khi đang tải trang tiếp theo.
  3. Xử lý lỗi tải thêm linh hoạt: không xóa các mục đã tải, hiển thị `load-more-error` với nút "Thử lại" gọi lại đúng cursor hiện tại.
  4. Skeleton 4 dòng nhấp nháy (`history-skeleton`) hiển thị khi `pending = true` và chưa có dữ liệu.
  5. Thẻ trạng thái chưa đăng nhập (`history-unauthenticated`) với nút liên kết tới `/login`.
  6. Thẻ trạng thái rỗng (`history-empty`) với icon `lucide:inbox` và giải thích khi tài khoản đã đăng nhập nhưng chưa có biến động.
  7. Làm mới sổ cái xóa cursor và `additionalItems`, tải lại trang đầu mượt mà.
  8. Định dạng 6 nhãn tiếng Việt (`Tặng`, `Nạp`, `Giữ`, `Hoàn`, `Chốt`, `Điều chỉnh`), màu sắc credit (+ xanh, - cam, 0 xám) và múi giờ Việt Nam.
  9. Toàn bộ nút đạt vùng chạm tối thiểu 48px (`touch-target`, `min-h-[48px]`, `min-w-[48px]`), 100% không chứa emoji UTF-8.
- Xuất helper chuẩn `isUnauthorizedError` trong `apps/web/utils/auth-session.ts` và tái sử dụng nhất quán trong cả `usePricingConfig.ts` và `history.vue`.
- Mở rộng bộ kiểm thử `apps/web/test/smoke.test.mjs` với 5 test case mới cho Story 1.10 (tổng cộng 28 test đều pass 100%).

## Spec Change Log

## Review Triage Log

| # | Nguồn | Phát hiện | Verdict | Bằng chứng / Xử lý |
|---|-------|-----------|---------|--------------------|
| 1 | blind-hunter, edge-case | Rò rỉ dữ liệu phiên & không dọn dẹp khi đăng xuất / hết phiên: điều kiện `entries.length === 0` chặn màn hình chưa đăng nhập | high → patch | Đã vá: bỏ điều kiện `&& entries.length === 0` khi kiểm tra `isUnauthenticated` ở template; `watch(accessToken)` dọn dẹp `additionalItems` khi logout và refresh khi đổi token. [history.vue] |
| 2 | blind-hunter | Trùng lặp banner lỗi phía trên và thẻ lỗi trong khung khi tải trang đầu thất bại | medium → patch | Đã vá: truyền `:message-vi="entries.length > 0 ? ledgerErrorVi : null"` cho `ApiErrorBanner` phía trên để chỉ hiển thị một thẻ lỗi trong card khi danh sách rỗng. [history.vue] |
| 3 | blind-hunter | `refreshLedger()` xóa `additionalItems` trước khi gọi API, nếu lỗi mạng thì mất dữ liệu cũ | medium → patch | Đã vá: không xóa `additionalItems` trước khi refresh; chỉ đồng bộ và dọn dẹp khi API trả về kết quả thành công. [wallet-ledger.ts, history.vue] |
| 4 | blind-hunter | Nút thử lại `history-retry-button` thiếu `:disabled` và icon xoay khi pending | medium → patch | Đã vá: thêm `:disabled="ledgerAsync.pending.value || loadingMore"` và class `animate-spin`. [history.vue] |
| 5 | blind-hunter | Nút tải thêm và sentinel rơi vào trạng thái im lặng nếu `hasMore = true` nhưng `nextCursor` rỗng | low → patch | Đã vá: `createWalletLedgerPagination` chuẩn hóa kiểm tra cursor và hasMore. [wallet-ledger.ts] |
| 6 | blind-hunter | Nguy cơ kẹt cuộn vô tận nếu sentinel không rời khỏi viewport trên màn hình lớn | low → reject | Đã có nút dự phòng "Tải thêm lịch sử" để người dùng click tải tiếp bất kỳ lúc nào. [history.vue] |
| 7 | blind-hunter | Watcher `bottomSentinel` thiếu unobserve phần tử cũ khi sentinel thay đổi | low → patch | Đã vá: watcher unobserve `oldEl` trước khi observe `newEl`. [history.vue] |
| 8 | blind-hunter | Gửi request API thừa thãi khi khách chưa đăng nhập truy cập `/history` | false | Chuẩn hành vi Nuxt SSR data fetching: request 401 được bắt và render ngay lập tức sang trạng thái Yêu Cầu Đăng Nhập. [history.vue] |
| 9 | blind-hunter | Tái tạo `new Intl.DateTimeFormat` liên tục trong render mỗi item | low → patch | Đã vá: khởi tạo `VIETNAM_TIMESTAMP_FORMATTER` một lần ở cấp module trong `utils/wallet-ledger.ts`. |
| 10 | blind-hunter, verification-gap | Broken verification: logic phân trang và refresh được test qua object mock inline thay vì code thật | medium → patch | Đã vá: tách `createWalletLedgerPagination` sang `utils/wallet-ledger.ts` và import kiểm thử trực tiếp trong `smoke.test.mjs`. |
| 11 | blind-hunter | Trạng thái story trong sprint-status.yaml chưa đồng bộ sang `review` | false | Trạng thái story được đồng bộ tự động theo từng bước của quy trình BMAD (`in-review` trong review step và `done` khi merge). |
| 12 | blind-hunter | Thiếu thuộc tính ARIA cho spinner tải thêm và khối lỗi tải thêm | low → patch | Đã vá: thêm `role="status" aria-live="polite"` cho spinner và `role="alert"` cho khối lỗi. [history.vue] |
| 13 | edge-case-hunter | Sentinel hoặc click kích hoạt `loadMore()` khi đang refresh | medium → patch | Đã vá: thêm `ledgerAsync.pending.value` vào guard của `loadMore()`. [wallet-ledger.ts, history.vue] |
| 14 | edge-case-hunter | Click retry khi `refreshLedger()` đang chạy | medium → patch | Đã vá: thêm `ledgerAsync.pending.value` vào guard của `refreshLedger()`. [wallet-ledger.ts, history.vue] |
| 15 | edge-case-hunter | `accessToken` đổi hoặc thành null khi đăng xuất | high → patch | Đã gộp và vá cùng mục #1: watcher dọn dẹp và refresh. [history.vue] |
| 16 | edge-case-hunter | Hết phiên 401 khi entries không rỗng bị chặn hiển thị chưa đăng nhập | high → patch | Đã gộp và vá cùng mục #1: ưu tiên render `isUnauthenticated`. [history.vue] |
| 17 | verification-gap | Regression gap: thiếu test SSR worker khi `/history` nhận 401 UNAUTHORIZED | medium → patch | Đã vá: bổ sung test case SSR worker 401 trong `smoke.test.mjs` khẳng định render `data-testid="history-unauthenticated"`. |

## Design Notes

- Sử dụng `IntersectionObserver` gắn vào một phần tử sentinel `<div ref="bottomSentinel">` ở cuối danh sách để kích hoạt tải trang tiếp theo một cách mượt mà khi người dùng cuộn tới.
- Để đảm bảo SSR và môi trường không hỗ trợ `IntersectionObserver` (hoặc khi test), bổ sung một nút bấm "Tải thêm" rõ ràng khi `hasMore === true && !loadingMore`.
- Khóa bảo vệ `loadingMore`: khi một request phân trang đang chạy, các sự kiện cuộn tiếp theo bị bỏ qua để tránh gọi đúp hoặc gửi sai cursor.

## Verification

**Commands:**
- `pnpm run lint` -- expected: không có lỗi lint toàn monorepo.
- `pnpm run typecheck` -- expected: TypeScript biên dịch thành công không có lỗi kiểu.
- `pnpm --filter @motion-ai/web test` -- expected: toàn bộ test của web pass 100%.
- `pnpm run check:boundaries` -- expected: kiểm tra ranh giới nhánh hợp lệ (chỉ sửa `apps/web/`).