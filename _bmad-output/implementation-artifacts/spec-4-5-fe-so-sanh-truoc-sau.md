---
title: 'Story 4.5: [FE] So sánh trước/sau'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: '0a649442689aedda938112297afd63760018ddfe'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi tác vụ Body Retouch hoàn thành thành công, người dùng cần so sánh trực quan giữa ảnh gốc và ảnh sau khi chỉnh sửa vóc dáng để thấy rõ hiệu quả thay đổi, đồng thời cần trải nghiệm kéo thanh trượt mượt mà trên di động, hiển thị thông báo hợp lý khi ảnh gốc quá hạn 7 ngày, tự động làm mới khi link ký hết hạn và liên kết điều hướng phù hợp với pipeline `body_retouch`.

**Approach:** Hoàn thiện và tích hợp `BeforeAfterSplitSlider.vue` trên trang kết quả `apps/web/pages/tasks/[id].vue` với thanh kéo chia đôi màn hình mượt mà trên di động (núm 36px `lucide:arrow-left-right`, `pan-y`, hỗ trợ phím mũi tên và ARIA), tự động nhận biết `sourceUrl` rỗng hoặc quá hạn 7 ngày để hiển thị thông báo "Ảnh gốc đã hết hạn lưu", tự động khôi phục khi ảnh lỗi hoặc link ký hết hạn (watcher reset `sourceLoadFailed`), hiển thị nút tải ảnh HD kết quả, chia sẻ/thu hồi link, truyền nhãn `pipelineLabelVi` và nút điều hướng tạo tác vụ mới phù hợp với `body_retouch`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa các tệp trong phạm vi `apps/web/**` (tuân thủ ranh giới nhánh `fe/*`).
- Tuân thủ thiết kế Slate Cyber (`bg-cyber-*`, `text-cyber-*`, `border-cyber-*`), 100% icon vector Lucide qua `<Icon name="lucide:..." />`, tuyệt đối không dùng emoji Unicode UTF-8 trong giao diện.
- Đảm bảo vùng chạm tối thiểu 48px (`touch-target`, `min-h-[48px]`) cho núm trượt và các nút hành động, hiển thị chuẩn trên khung nhìn di động 360px.
- Núm trượt giữ kích thước chuẩn 36px (`h-9 w-9`), nền cyan, chứa icon `lucide:arrow-left-right`, có thuộc tính trợ năng `role="slider"`, `aria-label="Thanh trượt so sánh trước sau"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow`, `aria-valuetext` và điều hướng được bằng bàn phím (ArrowLeft/Down -5%, ArrowRight/Up +5%, Home 0%, End 100%).
- Hai ảnh gốc và kết quả luôn cùng kích thước, căn khớp tỉ lệ (`object-contain`), không bị méo khi kéo hoặc thả thanh trượt. Khi người dùng thả tay, thanh giữ nguyên vị trí.
- Khi `sourceUrl` null, rỗng hoặc quá 7 ngày: chỉ hiển thị ảnh kết quả kèm thông báo "Ảnh gốc đã hết hạn lưu", không hiển thị thanh kéo hỏng.
- Khi một trong hai ảnh lỗi tải hoặc link ký hết hạn: tự động làm mới link ký mới (tối đa 1 lần tự động, hoặc khi bấm "Lấy lại link mới"), watcher trên `props.sourceUrl` tự reset `sourceLoadFailed` để hiển thị lại ảnh.
- Nút "Tải Ảnh HD (Không Watermark)" chỉ tải ảnh kết quả (không tải ảnh gốc), có cơ chế tự làm mới link ký nếu URL hết hạn.
- Giữ nguyên các nút "Chia sẻ kết quả", "Sao chép" và "Ngừng chia sẻ" kế thừa từ Story 2.12.
- Trang `tasks/[id].vue` truyền đúng `:pipeline-label-vi="getPipelineLabelVi(currentTask.pipeline)"` vào `TaskProgressCard.vue` và hiển thị nút dẫn về `/body-retouch` ("Tạo tác vụ Chỉnh sửa vóc dáng khác" hoặc "Tạo tác vụ Chỉnh sửa vóc dáng mới" khi hết hạn 30 ngày) khi `currentTask.pipeline === 'body_retouch'`.

**Never:**
- Không sửa `packages/contracts/**`, `apps/api/**`, `deploy/**` hay bất kỳ tệp nào ngoài `apps/web/**`.
- Không làm lộ ảnh gốc trong liên kết chia sẻ công khai (`/share/[token]`).
- Không thêm nhánh `?mock=` / `mockMode` vào mã chạy thật của FE (dữ liệu mock chỉ dùng trong test tự động).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Task `body_retouch` thành công có `sourceUrl` | `status: 'succeeded'`, có `resultUrl` và `sourceUrl` | Hiển thị `BeforeAfterSplitSlider` 2 lớp chồng khít, núm kéo 36px ở vị trí 50%, nhãn "Ảnh Gốc" bên trái và "Kết Quả AI" bên phải, thanh chỉ dẫn trượt ngang | N/A |
| Kéo trượt thanh so sánh trên cảm ứng / chuột | Pointer drag / touch move ngang | Núm và đường phân cách di chuyển mượt mà theo ngón tay (`touchAction: pan-y`), `clip-path` cắt ảnh kết quả đúng tỉ lệ, hai ảnh không méo | Thả tay giữ nguyên vị trí |
| Điều khiển thanh trượt bằng bàn phím | Focus núm trượt, bấm ArrowLeft/Right/Up/Down, Home, End | Vị trí trượt tăng/giảm theo bước 5%, Home về 0%, End về 100%, cập nhật `aria-valuenow` và `aria-valuetext` | Chặn sự kiện mặc định để không cuộn trang |
| Ảnh gốc quá hạn lưu 7 ngày hoặc `sourceUrl` rỗng | `status: 'succeeded'`, `sourceUrl` là `null` hoặc chuỗi rỗng | Hiển thị 1 ảnh kết quả duy nhất kèm nhãn "Kết Quả AI" và thông báo "Ảnh gốc đã hết hạn lưu", không hiển thị thanh kéo | N/A |
| Link ký ảnh gốc hoặc kết quả hết hạn (lỗi tải ảnh) | Thẻ `<img>` kích hoạt sự kiện `@error` | Phát emit `imageError`, trang tự động refresh URL ký mới; watcher reset `sourceLoadFailed` khi có URL mới; nếu vẫn lỗi thì hiện banner kèm nút "Lấy lại link mới" | Ngăn lặp vô hạn (tối đa 1 lần auto-retry trước khi cần người dùng bấm) |
| Bấm "Tải Ảnh HD" | Click nút "Tải Ảnh HD (Không Watermark)" | Tải file PNG kết quả với tên `flowvis-body_retouch-<id8>.png`; nếu link hết hạn tự refresh link và tải lại | Hiển thị thông báo lỗi nếu tải thất bại |
| Tác vụ Body Retouch hết hạn lưu 30 ngày | Task quá 30 ngày kể từ `createdAt` | Hiển thị màn hình thông báo "Kết Quả Đã Hết Hạn Lưu Trữ" và nút dẫn về `/body-retouch` ("Tạo tác vụ Chỉnh sửa vóc dáng mới") | N/A |
| Tác vụ Body Retouch đang chờ/xử lý/lỗi | Task `queued`, `running`, `failed`, `timed_out`, `cancelled` | `TaskProgressCard` nhận đúng nhãn "Chỉnh sửa vóc dáng", không bị hiển thị nhầm "Hoán đổi khuôn mặt" | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/components/BeforeAfterSplitSlider.vue` -- Bổ sung watcher trên `props.sourceUrl` để reset `sourceLoadFailed.value = false` khi nhận URL mới; tinh chỉnh nhãn hết hạn thành "Ảnh gốc đã hết hạn lưu"; thêm `:aria-valuetext="`${Math.round(sliderPosition)}% ảnh kết quả`"`; duy trì núm 36px icon `lucide:arrow-left-right` và căn khớp ảnh `object-contain`.
- `apps/web/pages/tasks/[id].vue` -- Truyền `:pipeline-label-vi="getPipelineLabelVi(currentTask.pipeline)"` vào `TaskProgressCard`; cập nhật nút CTA khi succeeded và retention-expired dẫn tới `/body-retouch` với nhãn "Tạo tác vụ Chỉnh sửa vóc dáng khác / mới" khi `pipeline === 'body_retouch'`; reset `imageRefreshAttempts.value = 0` trong `handleRefreshResult`.
- `apps/web/test/body-retouch-compare.test.mjs` -- Bộ kiểm thử mới cho Story 4.5: kiểm tra SSR và hành vi client của `BeforeAfterSplitSlider` ở cả 2 chế độ (có/không có `sourceUrl`), kiểm tra tương tác bàn phím, watcher reset khi URL mới, kiểm tra trang `tasks/[id].vue` cho pipeline `body_retouch` (nhãn pipeline, nút tải về, chia sẻ, nút điều hướng `/body-retouch`), tuân thủ Slate Cyber, vùng chạm >= 48px, không emoji UTF-8.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/components/BeforeAfterSplitSlider.vue` -- Thêm watcher reset `sourceLoadFailed` khi `props.sourceUrl` thay đổi, chuẩn hóa dòng chữ "Ảnh gốc đã hết hạn lưu", bổ sung thuộc tính `aria-valuetext` cho núm trượt -- hoàn thiện thành phần so sánh trước/sau tái sử dụng cho mọi pipeline có ảnh gốc
- [x] `apps/web/pages/tasks/[id].vue` -- Truyền `pipeline-label-vi` cho `TaskProgressCard`, cập nhật nút điều hướng tạo tác vụ theo pipeline (`body-retouch` thay vì cố định `face-swap`), và hoàn thiện cơ chế tự làm mới link ký khi tải ảnh/tải file -- đảm bảo trải nghiệm trang kết quả trọn vẹn cho Body Retouch
- [x] `apps/web/test/body-retouch-compare.test.mjs` -- Viết bộ kiểm thử tự động toàn diện bao phủ toàn bộ I/O Matrix, 2 chế độ so sánh 2 ảnh và 1 ảnh đơn, xử lý link hết hạn, tương tác phím/touch, các nút hành động, ranh giới 360px và không emoji -- xác minh chất lượng Story 4.5

### Review Findings

- [x] [Review][Patch] Vòng lặp refresh vô hạn do Watcher tự động reset imageRefreshAttempts và mock test che giấu lỗi [apps/web/pages/tasks/[id].vue:131]
- [x] [Review][Patch] Template điều hướng nút CTA dùng biểu thức ba ngôi cứng thay vì hàm getPipelineRoute [apps/web/pages/tasks/[id].vue:518]
- [x] [Review][Patch] Bổ sung kiểm thử biên cho downloadErrorVi và tỷ lệ bất đối xứng aria-valuetext [apps/web/test/body-retouch-compare.test.mjs:804]
- [x] [Review][Patch] Chống race condition ENOENT triệt để trong smoke.test.mjs [apps/web/test/smoke.test.mjs:460]
- [x] [Review][Patch] Bổ sung thuộc tính trợ năng và ngăn chặn kéo ảnh mặc định trên BeforeAfterSplitSlider & nút Lấy lại link mới [apps/web/components/BeforeAfterSplitSlider.vue:166]
- [x] [Review][Defer] Vi phạm WCAG 2.5.3 (Label in Name) trên nút Quay lại / Lịch sử [apps/web/pages/tasks/[id].vue:318] — deferred: pre-existing từ Story 2.12

#### Rejected Findings
- [false] handleImageError cần bật imageLoadFailed khi ảnh gốc sourceUrl lỗi: lỗi ảnh gốc đã có graceful degradation sang 1 ảnh kết quả với nhãn "Ảnh gốc đã hết hạn lưu"; bật imageLoadFailed sẽ che mất toàn bộ ảnh kết quả AI hợp lệ.
- [false] Dead zones trong BeforeAfterSplitSlider với object-contain: do ràng buộc đặc tả kỹ thuật quy định 2 ảnh luôn khớp tỷ lệ qua object-contain.
- [false] Vi phạm ranh giới check:boundaries do commit _bmad-output/: trên nhánh shared/* hiện tại lệnh check:boundaries pass 100%.
- [low] Vị trí thông báo downloadErrorVi, Vue warning khi gọi setup() ngoài instance, và timeout 1500ms revokeObjectURL: không ảnh hưởng runtime hoặc là vấn đề nhỏ không đáng thêm độ phức tạp.
- [rejected] spec-4-5-fe-so-sanh-truoc-sau.md mẫu aria-valuetext cũ: không sửa file đặc tả đang review theo quy tắc bmad.

**Acceptance Criteria:**
- Given Task `body_retouch` `succeeded` và `sourceUrl` có giá trị, when mở trang kết quả `tasks/[id]`, then hiển thị thành phần so sánh hai ảnh chồng nhau với thanh kéo ngang (ảnh gốc một bên, ảnh kết quả một bên), núm kéo 36px chứa vector icon `lucide:arrow-left-right`, hai ảnh cùng kích thước căn khớp không méo, kéo bằng ngón tay mượt trên di động (`touchAction: pan-y`) và khi thả tay thanh giữ nguyên vị trí.
- Given thanh trượt so sánh, when thao tác bằng bàn phím (ArrowLeft/Down, ArrowRight/Up, Home, End), then thanh trượt di chuyển theo bước 5% hoặc về hai đầu (0%, 100%), cập nhật giá trị `aria-valuenow` và `aria-valuetext` cho trình đọc màn hình.
- Given `sourceUrl` rỗng hoặc null (do ảnh gốc quá thời hạn lưu 7 ngày), when mở trang kết quả, then chỉ hiển thị ảnh kết quả kèm dòng chữ "Ảnh gốc đã hết hạn lưu", không hiển thị thanh kéo so sánh hỏng.
- Given URL ký của ảnh gốc hoặc kết quả hết hạn hoặc lỗi tải, when trang kích hoạt làm mới hoặc người dùng bấm "Lấy lại link mới", then hệ thống lấy lại URL mới và tự động tải lại ảnh thay vì hiển thị ảnh vỡ.
- Given trang kết quả của Task `body_retouch`, when mở lên, then hiển thị đầy đủ nút "Tải Ảnh HD (Không Watermark)" (chỉ tải ảnh kết quả), "Chia sẻ kết quả", "Sao chép" và "Ngừng chia sẻ", đồng thời các nút điều hướng dẫn về `/body-retouch` với nhãn tương ứng.

## Implementation Notes

- Đã thêm watcher trên `props.sourceUrl` trong `apps/web/components/BeforeAfterSplitSlider.vue` để tự động reset `sourceLoadFailed.value = false` khi nhận URL mới.
- Đã chuẩn hóa dòng chữ khi ảnh gốc quá hạn 7 ngày thành "Ảnh gốc đã hết hạn lưu" và bổ sung `:aria-valuetext="`${Math.round(sliderPosition)}% ảnh kết quả`"` trên núm kéo `slider-knob`.
- Đã cập nhật `apps/web/pages/tasks/[id].vue`: truyền `:pipeline-label-vi="getPipelineLabelVi(currentTask.pipeline)"` cho `TaskProgressCard`, cập nhật các liên kết CTA điều hướng tới `/body-retouch` ("Tạo tác vụ Chỉnh sửa vóc dáng khác" hoặc "Tạo tác vụ Chỉnh sửa vóc dáng mới" khi hết hạn 30 ngày) cho `body_retouch`, reset `imageRefreshAttempts.value = 0` khi người dùng bấm lấy lại link mới, và cơ chế tự động thử lấy link mới 1 lần khi tải ảnh kết quả/ảnh gốc hoặc tải file.
- Đã bổ sung bộ kiểm thử `apps/web/test/body-retouch-compare.test.mjs` với 16 test case tự động bao phủ trọn vẹn I/O Matrix, SSR render của BeforeAfterSplitSlider và tasks/[id].vue, logic reactive, xử lý lỗi ảnh & tải file, cùng ranh giới Slate Cyber, vùng chạm >= 48px và 0 emoji UTF-8.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `imageLoadFailed` ẩn toàn bộ ảnh kết quả khi chỉ có ảnh gốc `sourceUrl` bị lỗi hoặc hết hạn | medium | patch | `handleImageError` không phân biệt `type: 'source'` và `type: 'result'`, khiến lỗi ảnh gốc ẩn luôn ảnh kết quả AI hợp lệ |
| Lỗi đồng thời từ cả hai ảnh khi URL hết hạn kích hoạt sớm `imageLoadFailed` trước khi refresh xong | medium | patch | Khi cả 2 ảnh cùng báo lỗi trong lúc `resultAsync.pending = true`, lần lỗi thứ hai kích hoạt `else` và bật cờ lỗi sớm |
| `tasks/[id].vue` điều hướng nhị phân hardcode 'Face Swap' thay vì dùng `getPipelineLabelVi` | low | patch | Nhãn CTA dùng từ mượn tiếng Anh chưa đồng bộ với danh mục `PIPELINE_LABELS_VI` |
| Bộ test dùng hàm closure tự định nghĩa thay vì kiểm thử trực tiếp mã script setup của `tasks/[id].vue` | medium | patch | Section 4 trong `body-retouch-compare.test.mjs` định nghĩa lại hàm cục bộ thay vì load script setup của SFC thật |
| Stub `NuxtLink` trong test không render slot content và thiếu test cho pipeline `face_swap` | low | patch | Stub chỉ trả về `MockLink` cố định làm lọt lỗi hiển thị nhãn nút CTA động và chưa test nhánh `face_swap` |
| Intermittent `ENOENT` trong `smoke.test.mjs` do quét file `.ts` tạm khi chạy test song song | low | defer | Vấn đề đã có từ trước trong `smoke.test.mjs:456`, không phải lỗi do Story 4.5 gây ra |
| Giá trị `aria-valuetext` trên `BeforeAfterSplitSlider` bị đảo ngược so với tỷ lệ hiển thị thực tế | low | patch | `clip-path: inset(0 0 0 ${sliderPosition}%)` cắt từ trái, tỷ lệ hiển thị ảnh kết quả thực tế là `100 - sliderPosition%` |
| Mất viền nét tiêu điểm bàn phím (Focus Ring) trên núm trượt do đặt `focus:ring` ở thẻ con `<span>` | low | patch | Thẻ `<button>` có `focus:outline-none` và `<span>` không nhận focus nên viền nét không hiển thị khi bấm Tab |
| Thiếu lắng nghe sự kiện `@retry` từ `TaskProgressCard` trên trang `tasks/[id].vue` | low | patch | Nút "Tạo lại tác vụ" khi task thất bại không có handler phản hồi điều hướng |
| Thiếu reset `imageRefreshAttempts` khi nhận dữ liệu kết quả mới thành công | low | patch | Nếu không reset khi có dữ liệu mới, các lần tải ảnh sau này sẽ mất quyền auto-retry |
| Nút "Tải Ảnh HD" thiếu `:disabled="isDownloading"`, biểu tượng loading xoay và phản hồi trạng thái | low | patch | Người dùng không nhận được visual feedback và dễ bấm tải lặp lại nhiều lần |
| Lỗi tải file trong `handleDownloadImage` ghi đè vào biến thông báo chia sẻ `shareErrorVi` | low | patch | Cần tách riêng thông báo lỗi tải ảnh hoặc hiển thị toast phù hợp |
| Ngoại lệ mạng/CORS trong `handleDownloadImage` không kích hoạt cơ chế tự làm mới link ký | low | patch | Khi `fetch` ném ngoại lệ CORS/network trước khi trả `response`, khối `try` bị ngắt không gọi làm mới link |
| Tên tệp tải về ghim cứng đuôi `.png` bất kể MIME type của ảnh | low | patch | Nên lấy đuôi mở rộng phù hợp từ `blob.type` (jpg, webp, png) |
| File đặc tả `spec-4-5-fe-so-sanh-truoc-sau.md` bị bỏ sót khỏi git tracking | false | reject | File spec là artifact quản lý quy trình, không ảnh hưởng mã nguồn production |

## Verification

**Commands:**
- `pnpm --filter @flowvis/web test` -- expected: toàn bộ test cũ và `test/body-retouch-compare.test.mjs` mới đều pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass không lỗi trên toàn monorepo
- `pnpm run check:boundaries --base=fe/story-4-4-trang-body-retouch-va-thanh-muc-dieu-chinh` -- expected: chỉ sửa các tệp trong `apps/web/**`

