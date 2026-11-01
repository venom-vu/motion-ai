# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Trạng thái repo

Chưa có mã nguồn ứng dụng, chưa có lệnh build/lint/test. Repo hiện chỉ chứa tài liệu lập kế hoạch do BMad Method sinh ra. Story đầu tiên (`1-1-shared-dựng-monorepo-và-khung-ci`) sẽ dựng monorepo; sau đó hãy cập nhật file này với các lệnh thật.

Ngôn ngữ giao tiếp và tài liệu: **tiếng Việt** (`communication_language` và `document_output_language` trong `_bmad/config.toml`).

## Bố cục

- `_bmad/` và `.claude/skills/`, `.agent/skills/`: cấu hình và skill BMad. Không sửa trực tiếp; tùy biến qua `_bmad/custom/` (skill `bmad-customize`).
- `_bmad-output/planning-artifacts/`: brief, PRD, kiến trúc, UX, `epics.md`.
- `_bmad-output/specs/spec-motion-ai/SPEC.md`: spec đã cô đọng.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: theo dõi tiến độ story (`backlog` → `ready-for-dev` → `in-progress` → `review` → `done`).
- `docs/`: `project_knowledge`, hiện trống.

Nguồn sự thật hiện hành (có nhiều bản cũ theo ngày, dùng bản mới nhất):

- PRD: `prds/prd-motion-ai-2026-10-31/prd.md` + `addendum.md`
- Kiến trúc: `architecture/architecture-motion-ai-2026-11-01/ARCHITECTURE-SPINE.md`
- UX: `ux-designs/ux-motion-ai-2026-11-01/DESIGN.md` và `EXPERIENCE.md`
- Epic/story: `planning-artifacts/epics.md`

## Quy trình làm việc

Dùng skill BMad theo thứ tự; planning đã xong, bước tiếp theo là `bmad-build <story>` (bắt đầu với story 1-1). `bmad-help` cho biết vị trí hiện tại. `bmad-code-review`, `bmad-walkthrough`, `bmad-qa-generate-e2e-tests` và `bmad-retrospective` là bước tùy chọn.

## Kiến trúc đích (tóm tắt từ ARCHITECTURE-SPINE.md)

Motion AI là SaaS tạo ảnh/video AI (Face Swap, Body Retouch, Motion Control) gọi GPU qua RunningHub, tính phí bằng credit. Đọc spine đầy đủ (các mục AD-1…AD-18) trước khi viết mã backend. Những điểm cần nhiều file mới thấy:

- **Modular monolith, ports-and-adapters**: một codebase NestJS, hai entrypoint (`api`, `worker`). Module: `auth`, `wallet`, `tasks`, `pipelines`, `topups`, `storage`, `ops`, `audit`. Port: `RunningHubPort`, `StoragePort`, `NotifierPort`. Worker không mở HTTP công khai.
- **PostgreSQL là nguồn sự thật duy nhất** cho trạng thái Task và sổ cái credit. Redis/BullMQ chỉ điều phối và phải dựng lại được từ DB.
- **Mỗi bảng chỉ một module được ghi** (AD-1). Ví dụ chỉ `wallet` ghi `ledger_entries` và `users.balance/held/tier`, chỉ `tasks` ghi bảng `tasks`. Module khác gọi service công khai của chủ sở hữu, không dùng SQL thô.
- **Sổ cái append-only** (AD-2): `HOLD` −n, `RELEASED` +n, `CAPTURED` 0, `balance = SUM(amount)`. Unique một phần và `CHECK` nằm trong migration SQL thô (Prisma không khai báo được), kèm test tích hợp trên PostgreSQL thật. Lỗi P2002 trong luồng ví luôn rollback cả transaction.
- **Tạo Task** (AD-3): validate → transaction (khóa dòng user, HOLD, INSERT Task) → enqueue BullMQ sau commit với `jobId = taskId`. Bộ quét enqueue lại Task `queued` chưa có job.
- **Chuyển trạng thái chỉ qua compare-and-set** (AD-4/5): `UPDATE … WHERE id=? AND status=<from>` qua `tasks.transition(taskId, from, to, reasonCode)`; khóa Redis chỉ là gợi ý. Worker nhận lại job sau restart phải tiếp tục poll, không submit lại RunningHub.
- Hợp đồng API và enum (`ApiErrorCode`, reasonCode) nằm trong `packages/contracts`.
- Lưu kết quả trên R2 (không dùng link CDN RunningHub); ảnh kết quả ghi EXIF `Software: AI Generator`.

## Quy ước giao diện (frontend)

Theo `DESIGN.md`/`EXPERIENCE.md`:

- Nhận diện **Slate Cyber**, icon Lucide qua `nuxt-icon`, **không dùng emoji trong UI chrome**, vùng chạm tối thiểu 48px.
- **Responsive Mobile-First + Full Desktop Adaptive (Đồng bộ 100% mô hình Kho Card Tính Năng → Dialog Làm Việc)**:
  - **Màn hình chính (`/`) trên cả Mobile và Desktop:** Hiển thị thanh lọc danh mục + tìm kiếm + **Danh sách/Lưới Card Tính Năng Có Ảnh Minh Họa** (Mobile xếp 1 cột dọc; Desktop xếp lưới 3–4 cột toàn màn hình, không có khung làm việc cố định bên phải, sẵn sàng mở rộng lên hàng chục tính năng AI). Khi click/chạm vào một Card tính năng sẽ mở **Dialog làm việc (`FeatureWorkspaceDialog`)** của chức năng đó.
  - **Mobile (`< 768px`, chuẩn 360px):** Điều hướng bằng Bottom Navigation Bar 4 tab (`Kho AI`, `Lịch sử`, `Bảng giá`, `Tôi`); mọi popup (`FeatureWorkspaceDialog` và `VietQRModal`) đều mở dạng **Centered Dialog** giữa màn hình (không dùng Drawer/Bottom Sheet).
  - **Desktop cho User (`>= 1024px`):** **Không dùng Sidebar trái**, dùng **Top Header** (`68px`, gồm Logo, điều hướng `Kho Công Cụ AI` / `Lịch Sử` / `Bảng Giá`, số dư credit, nút Nạp và Avatar); `FeatureWorkspaceDialog` (`max-width: 980px`) và `VietQRModal` mở dạng **Centered Dialog**.
  - **Desktop cho Admin (`/admin`):** Dùng **Left Sidebar đơn giản (`220px`) phong cách Vercel** (nền đen `#0A0A0A`, viền mảnh `1px`, font `monospace`), 4 ô chỉ số kỹ thuật và bảng duyệt đơn `bank_ref` đa cột.
- Linh kiện cốt lõi: slider so sánh Before/After, trimmer video bước 1 giây (giá = 50 credit × số giây, hiển thị thời gian thực), dialog VietQR trong ngữ cảnh.

## Quy tắc nghiệp vụ dễ sai

- Mã FR/NFR giữ số của PRD (FR1 = FR-1); PRD không có NFR5.
- Face Swap và Body Retouch 100 credit; Motion Control 50 credit/giây sau trim. Backend đo lại độ dài thật, không tin client.
- Một hàng đợi chung, 2 Lane; ưu tiên theo Priority của Tier Snapshot (số nhỏ chạy trước), cùng Priority thì FIFO. Task FREE (Priority 10) bị gỡ và hoàn credit sau 15 phút.
- Không có trạng thái `rejected` ở MVP; mọi lỗi sau HOLD (`NO_POSE`, `NO_FACE`…) là `failed` và RELEASED 100%. `PREP_TIMEOUT` luôn là `timed_out`.
