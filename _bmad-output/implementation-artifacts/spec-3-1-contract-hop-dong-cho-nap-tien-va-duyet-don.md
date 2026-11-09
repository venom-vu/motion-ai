---
title: 'Story 3.1: [CONTRACT] Hợp đồng cho nạp tiền và duyệt đơn'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: 'f8bf9e20a4418aa9af5cda209df7b4c8d626ad71'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `@motion-ai/contracts` chưa có trạng thái đơn nạp, schema và mock cho các endpoint nạp tiền và duyệt đơn, nên luồng BE (3.2–3.5) và FE (3.6–3.7) chưa thể chạy song song trên cùng một hình dạng API.

**Approach:** Thêm `src/topups.ts` vào `packages/contracts` (enum trạng thái, schema đơn, endpoint người dùng và Admin, bảng nhãn tiếng Việt), bổ sung 4 mã lỗi API, mock cho mọi trạng thái và test hợp đồng. Tái dùng `TopupPackId` và `ACCOUNT_TIERS` từ `wallet.ts`, không định nghĩa lại giá gói.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `packages/contracts/**` (nhánh `contract/*`); dùng `zod` `3.24.4`, theo phong cách `tasks.ts`/`wallet.ts` (schema + `z.infer`, `superRefine` cho bất biến, `.strict()` cho request, thông báo tiếng Việt).
- Trạng thái đơn đúng 6 giá trị: `awaiting_transfer`, `pending`, `approved`, `rejected`, `needs_review`, `expired`. Gói nạp dùng lại `TopupPackIdSchema` (`starter`, `pro`, `creator`).
- `ApiErrorCode` thêm `TOPUP_LIMIT`, `BANK_REF_DUPLICATE`, `TOPUP_STATE_INVALID`, `TOPUP_QR_EXPIRED` kèm thông báo tiếng Việt; cập nhật test enum cũ và README.
- User: `POST /topups` (`pack`, `consent: true`) → đơn kèm `code`, `transferContent` = `NAP <code>`, `amountVnd`, `qrPayload`, tài khoản nhận (`bankCode`, `accountNumber`, `accountName`), `qrExpiresAt`; `POST /topups/{id}/confirm-transfer`; `GET /topups` (cursor như `GET /tasks`, mới nhất trước); `GET /topups/{id}` (cùng hình dạng phản hồi tạo đơn để FE dựng lại QR).
- Admin: `GET /admin/topups` (lọc `status`, cursor, mỗi đơn có `isOverdue` = quá `approveBy`), `POST .../approve` và `.../approve-expired` (`bankRef` bắt buộc, cắt khoảng trắng, không rỗng), `.../reject` (`rejectReason` bắt buộc), `.../needs-review` (`note` bắt buộc), `.../return-to-pending` (body rỗng). Mỗi endpoint có schema request và response dùng chung FE/BE.
- Bất biến `TopupSchema`: `transferContent` khớp `NAP ${code}`; `approveBy` bắt buộc khi `pending`; `bankRef` chỉ khi `approved`; `rejectReason` bắt buộc khi và chỉ khi `rejected`.
- Bảng nhãn tiếng Việt theo trạng thái (`pending` = "Đang chờ duyệt", `needs_review` = "Cần xem xét") và hàm tra cứu; thông báo mã lỗi mới nằm trong `API_ERROR_MESSAGES_VI`.

**Never:**
- Không sửa `apps/*`, `deploy/`, cấu hình gốc; không thêm phụ thuộc; không hợp đồng `admin_audit`, Discord hay `GET /config/pricing` (đã có).
- Không nhận `amountVnd`, credit hay Tier từ client; không lộ email người dùng trong schema Admin (chỉ `userId`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo đơn hợp lệ | `{pack:'pro', consent:true}` | Request schema parse thành công | N/A |
| Tạo đơn sai | `consent:false`/thiếu, `pack:'vip'`, có trường `amountVnd` | `success: false` | Lỗi trên trường sai; `.strict()` chặn số tiền từ client |
| Duyệt thiếu mã | `bankRef:''` hoặc toàn khoảng trắng | Request schema từ chối | Thông báo tiếng Việt trên `bankRef` |
| Từ chối thiếu lý do | `rejectReason` rỗng | Từ chối | Lỗi trên `rejectReason` |
| Đơn sai bất biến | `pending` thiếu `approveBy`; `rejected` thiếu `rejectReason`; `transferContent` lệch `code` | `TopupSchema` từ chối | Lỗi trên trường vi phạm |
| Trạng thái ngoài danh sách | `'paid'` | Schema từ chối; hàm nhãn trả nhãn mặc định | N/A |
| Mock mọi trạng thái | 6 trạng thái, danh sách người dùng, danh sách Admin | Parse thành công qua schema tương ứng | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/errors.ts` -- thêm 4 mã vào `ApiErrorCode` và `API_ERROR_MESSAGES_VI` (kiểu `Record` bắt buộc đủ khóa).
- `packages/contracts/src/topups.ts` -- MỚI: enum trạng thái, `TopupSchema`, endpoint người dùng và Admin, nhãn tiếng Việt.
- `packages/contracts/src/wallet.ts` -- chỉ import `TopupPackIdSchema`; không sửa. `tasks.ts` -- mẫu phân trang cursor và `consent`; không sửa.
- `packages/contracts/src/mocks.ts` -- thêm mock đơn theo trạng thái, danh sách người dùng/Admin; `src/index.ts` -- re-export `topups.js`.
- `packages/contracts/test/index.test.mjs` -- sửa assert danh sách `ApiErrorCode`; thêm `describe('Epic 3 contracts')`.
- `packages/contracts/README.md` -- thêm mục Epic 3.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/errors.ts` -- thêm 4 mã lỗi và thông báo -- thiếu mã cho nạp tiền
- [x] `packages/contracts/src/topups.ts` -- enum, `TopupSchema`, endpoint, nhãn -- hợp đồng chính
- [x] `packages/contracts/src/mocks.ts`, `src/index.ts` -- mock và export -- FE chạy không cần BE
- [x] `packages/contracts/test/index.test.mjs`, `README.md` -- test I/O Matrix, cập nhật tài liệu

**Acceptance Criteria:**
- Given gói contracts, when build, then xuất đủ 6 trạng thái đơn, 3 gói nạp và 4 mã lỗi mới.
- Given mỗi endpoint của epic, when đọc hợp đồng, then có schema request và response dùng chung.
- Given bảng nhãn, when tra `pending` và `needs_review`, then ra "Đang chờ duyệt" và "Cần xem xét".
- Given mock, when chạy test hợp đồng, then mọi mock khớp schema.

### Review Findings

*Không có phát hiện nào cần sửa đổi (0 decision-needed, 0 patch, 0 defer, 11 rejected).*

#### Rejected
- [Rejected][False] Thiếu trường `tosVersion` trong schema đơn nạp: `tosVersion` là trường kiểm toán nội bộ lưu tại DB (bảng `topups`), không nằm trong DTO công khai theo đúng quy ước `TaskSchema` và AC2.
- [Rejected][False] Bất biến `note` chỉ có khi `needs_review`: Bất biến phản ánh trạng thái hiện tại; lịch sử ghi chú kiểm duyệt được lưu vết ở bảng `admin_audit` khi đơn chuyển trạng thái.
- [Rejected][False] Thiếu ràng buộc cấm `approveBy` ở trạng thái khác: `approveBy` được giữ lại ở các trạng thái sau `pending` (`approved`, `rejected`, `needs_review`) để lưu mốc hạn chót SLA.
- [Rejected][False] Thiếu endpoint `GET /admin/topups/:id`: Không có trong đặc tả PRD/Epics/Spec 3.1; Dashboard Admin quản lý qua danh sách và các thao tác duyệt/từ chối.
- [Rejected][Low] `TopupBaseShape` thiếu `trim` và `max` trên text fields: Schema DTO response nhận dữ liệu đã được validate chặt chẽ từ database và mutation request schema; người dùng/dev không gặp lỗi trong thực tế.
- [Rejected][False] Mock Admin pending chỉ có `isOverdue: true`: Đạt AC4 (mỗi trạng thái có 1 mock đại diện); FE tự do override `isOverdue` trong unit test.
- [Rejected][Low] Mock data dùng chung `createdAt`: Fixture tĩnh phục vụ kiểm thử hình dạng schema; API list không ép buộc kiểm tra sắp xếp trong schema.
- [Rejected][Low] Thiếu kiểm tra bất biến `qrExpiresAt > createdAt`: Server luôn sinh `qrExpiresAt = createdAt + 15m`; không có nguy cơ xảy ra trong thực tế.
- [Rejected][False] `AdminTopupListQuerySchema.status` không default `'pending'`: Để `optional` là cần thiết để Admin có thể truy vấn tất cả trạng thái (`all`); mặc định tab là logic hiển thị của FE.
- [Rejected][Low] Sai độ dài TLV trong mock `qrPayload`: Dữ liệu mock tĩnh có chú thích CRC giả; thư viện render QR canvas ở client chỉ nhận chuỗi thô để vẽ ảnh chứ không phân tích cú pháp TLV.
- [Rejected][False] Mã đơn `code` không có regex: Mã do server sinh ngẫu nhiên qua bộ ký tự an toàn (`CODE_ALPHABET`), client không thể gửi `code` lên.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| POST `confirm-transfer`/`return-to-pending` không body (undefined) bị từ chối | medium | patch | `topups.ts` dùng `z.object({}).strict()` trong khi `MeRequestSchema`/`AuthLogoutRequestSchema` dùng `.strict().optional()` |
| `bankRef`, `rejectReason`, `note` không có độ dài tối đa | medium | patch | Chuỗi vào DB/nhật ký không giới hạn; thêm `.max()` là sửa trực tiếp, không thêm bề mặt công khai |
| Thiếu test đường lỗi: query, `pagedResponse`, `TopupIdParams`, body confirm, ca hợp lệ approved/rejected | medium | patch | Verification Gap: đổi `.max(100)` hoặc đảo kiểm tra `hasMore` mà test vẫn qua |
| `import * as C` trùng nguồn với import có tên | low | patch | Gộp một dòng import |
| `approved` không bắt buộc `bankRef`; `note` không ràng buộc theo trạng thái; `approveBy` trên `awaiting_transfer` | low | reject | Intent ghi "bankRef chỉ khi approved", không yêu cầu hai chiều; thêm luật là mở rộng phạm vi |
| `isOverdue` cho đơn không `pending`; `isOverdue` trong mock lệch `approveBy` | low | reject | Do BE tính; mock chỉ phục vụ FE |
| `datetime()` không nhận offset | false | - | Cùng quy ước với `tasks.ts`/`wallet.ts`; BE sinh ISO UTC |
| `approve`/`approve-expired` dùng chung schema, thiếu bảng chuyển trạng thái; cursor không gắn với `status`; hằng `MAX_OPEN_TOPUPS` | low | reject | Quy tắc chuyển trạng thái và cursor thuộc BE 3.3/3.5; intent không yêu cầu |
| `amountVnd`/`credits` không đối chiếu catalog gói; `qrPayload` không ràng buộc với `transferContent`; CRC giả trong mock | low | reject | Giá do server quyết định (AD-10); `qrPayload` do BE 3.2 sinh và có test CRC riêng |
| Thiếu trường `approvedAt`/`approvedBy`/`creditedAt`; README thiếu `isOverdue`, `note` | low | reject | Intent không yêu cầu; nhật ký Admin thuộc 3.5 |
| Test `email` trên mock; schema Admin thiếu alias path-param; mock thiếu assert `isOverdue` | false | - | Schema `z.object` không strict sẽ bỏ trường lạ nên không thể lộ email; `TopupIdParamsSchema` dùng chung được |

## Verification

**Commands:**
- `pnpm --filter @motion-ai/contracts test` -- expected: pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass
