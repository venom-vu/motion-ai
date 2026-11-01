# Review v3: kiểm tra lại độ cập nhật công nghệ (ARCHITECTURE-SPINE)

Ngày kiểm: 2026-11-01. Nguồn: npm registry (`/<pkg>/<ver>`: engines, peerDependencies, dependencies), docs BullMQ, Prisma, Cloudflare R2, RunningHub, endoflife.date, Docker Hub, GitHub. Spine không bị sửa. Không lặp lại v1; chỉ xác nhận các sửa đã vào spine và tìm điểm còn lại.

## Kết luận
**Gần đạt, còn 1 vấn đề thực chất cần quyết định (ioredis 6 + BullMQ) và 4 thiếu sót nhỏ.** Tất cả phiên bản ghim đều tồn tại và tương thích trên Node >= 22.22.3. Các lỗi lớn ở v1 (Node, tfjs-node, `/status`, partial index, appendfsync) đã được sửa. Thiếu: Prisma driver adapter chưa nằm trong Stack, và lập luận Redis cần `protocol: 2`.

## 1. Các sửa của v1 đã vào spine chưa

| Mục v1 | Trạng thái | Chứng cứ trong spine |
| --- | --- | --- |
| Node >= 22.22.3 | Đã sửa | Bảng Stack, dòng Node |
| nsfwjs/tfjs-node | Đã gỡ khỏi Stack, đúng chủ ý | Chỉ còn trong Deferred (pre-check v2, ghi rõ WASM, `tfjs-node` không có binary Node 22). AD-9 nay là "không chạy model trên VPS" |
| `/status` -> `/outputs` | Đã sửa | AD-6 Poll dùng `POST /task/openapi/outputs`, ghi `/status` không còn bảo trì |
| Submit không idempotent | Đã sửa | AD-6: `submit_started_at`, không submit lại, `RH_SUBMIT_UNKNOWN` |
| Partial unique + CHECK qua SQL thô | Đã sửa | AD-2, có test tích hợp CI trên PostgreSQL thật |
| `FOR UPDATE` qua `tx.$queryRaw` | Đã sửa | AD-3 |
| priority không dùng 0 | Đã sửa | AD-6 |
| Redis `appendfsync everysec`, `maxRetriesPerRequest: null` | Đã sửa | AD-15 |
| R2 xóa gần đúng (~1 ngày), HEAD kiểm kích thước | Đã sửa | AD-8 |
| Cancel RunningHub | Đã xử lý bằng "không phụ thuộc" | AD-6, nhưng xem mục 5 (sơ đồ mâu thuẫn) |

## 2. Phiên bản (npm registry, đo ngày 2026-11-01)

| Gói | Tồn tại | engines / peer | Nhận xét |
| --- | --- | --- | --- |
| nuxt 4.6.3 | Có, là `latest` | node `^22.22.3 \|\| ^24.15.0 \|\| >=26` | Khớp dòng Node trong Stack |
| @nestjs/core 12.3.2 | Có, `latest` | node >= 20; peer `@nestjs/common ^12` | OK |
| @nestjs/bullmq 12.0.0 | Có, `latest` | peer `bullmq ^3..^6`, `@nestjs/core ^10..^12` | OK với bullmq 6.5.3 |
| bullmq 6.5.3 | Có, `latest` (xuất bản 2026-10-31) | node >= 14.18; **ioredis chỉ là optional peer `>=5.0.0`** | Xem mục 3 |
| prisma / @prisma/client 7.10.1 | Có, tag `prev`; `latest` của CLI là 8.0.0-rc.29 | node `^20.19 \|\| ^22.12 \|\| >=24` | Spine ghi đúng; ghim đúng cả hai gói |
| ioredis 6.0.0 | Có, `latest` (2026-07-31) | node >= 20 | Xem mục 3 |
| sharp 0.35.5 | Có, `latest` | node >= 20.9 | OK |
| @nestjs/throttler 6.7.1 | Có, `latest` | peer cho phép Nest 7..12; node `^20.19 \|\| ^22.12 \|\| >=24` | OK, đã giải quyết "chưa kiểm" ở v1 |
| @aws-sdk/client-s3 3.1161.0 | Có, `latest` | node >= 20 | OK |

Tương thích Nest 12 (chưa kiểm ở v1): `@nestjs/jwt` 12.0.3 peer tới Nest 12; `@nestjs/passport` 12.0.0 peer `@nestjs/common ^12`, `passport ^0.7`. OK.

Node: mọi gói đều thỏa trên >= 22.22.3 (giao của các ràng buộc). Lưu ý vòng đời: Node 22 EOL 2027-04-30 (Node 24 LTS đến 2028-04-30; Node 26 mới phát hành 2026-10-28). Nên ghi dòng Node 24 LTS làm mục tiêu để không phải nâng gấp sau 6 tháng. Chưa thể xác nhận bản patch Node nào có sẵn trong image Docker, cần kiểm khi chọn tag.

## 3. Vấn đề thực chất: BullMQ 6.5.3 và ioredis 6.0.0

- Xác nhận: bullmq 6.5.3 **không còn dependency ioredis riêng** (dependencies: tslib, semver, msgpackr, cron-parser, node-abort-controller). Từ 6.0.0 ioredis là optional peer `>=5`. Vậy "bullmq kéo ioredis 5 riêng" không xảy ra; chỉ có một bản ioredis (6.0.0) do dự án cài. Không còn nguy cơ trộn hai bản.
- Nhưng peer `>=5` chỉ nghĩa là được cài, không phải được kiểm thử. Bằng chứng gián tiếp (PR của người dùng, chưa phải tuyên bố chính thức của BullMQ): BullMQ 6.5.x được phát triển/test với ioredis 5.11.1; ioredis 6 mặc định RESP3 và có ca biên Lua `false` giải mã thành `0` thay vì `null`; vài dự án đặt `protocol: 2` cho BullMQ. Docs BullMQ về kết nối không nhắc ioredis 6.
- Rủi ro cho spine: AD-6 và AD-3 phụ thuộc ngữ nghĩa Lua của BullMQ (jobId, priority, lock). Rủi ro chưa được chứng minh nhưng không đáng đánh cược.
- **Đề xuất (chọn một, ghi vào Stack):** (a) hạ ioredis xuống 5.11.1 (bản BullMQ test), hoặc (b) giữ 6.0.0 nhưng bắt buộc `protocol: 2` ở mọi kết nối BullMQ (Queue, Worker, QueueEvents) và có test tích hợp (add job trùng jobId, priority, removeOnComplete) chạy trên Redis thật trong CI. Ưu tiên (a) vì đơn giản hơn. Mức xác nhận: bằng chứng thứ cấp, cần thử khi cài.
- Ghi chú xác nhận: `maxRetriesPerRequest: null` bắt buộc cho Worker, BullMQ ném lỗi nếu truyền client tự tạo mà không null (docs). Queue phía producer nên để mặc định hoặc nhỏ. Không dùng `keyPrefix` của ioredis.

## 4. Chi tiết ngữ nghĩa

**Prisma 7**
- Driver adapter là **bắt buộc** (xác nhận từ upgrade guide): `new PrismaClient({ adapter })` với `@prisma/adapter-pg` 7.10.1 (kéo `pg ^8.16.3`). **Spine không nhắc adapter-pg, `prisma.config.ts`, hay generator `prisma-client` (output bắt buộc, ESM)**. Nên thêm vào Stack: `@prisma/adapter-pg` 7.10.1 ghim cùng phiên bản. Pool mặc định của `pg` khác Prisma 6 (không có connection timeout), phải đặt `connectionTimeoutMillis`, kích thước pool tính cùng `api` + `worker`.
- `tx.$queryRaw` ... `FOR UPDATE` trong `$transaction(async tx => ...)`: mẫu được dùng thực tế và đúng. Lưu ý: issue prisma/orm #30374 (adapter-pg 7.8.0): sau lỗi DB trong interactive transaction, truy vấn tiếp theo trên cùng client có thể nhận phản hồi của truy vấn khác; **vẫn đang mở**, có PR sửa tham chiếu, 7.10.0 đã sửa rò rỉ connection và deadlock 40P01 thành P2034 nhưng chưa xác nhận #30374 được sửa. Đây liên quan trực tiếp tới luồng AD-3/AD-4/AD-16, nơi P2002 (unique ledger) là lỗi dự kiến xảy ra. Đề xuất: test CI cố ý gây P2002 trong transaction rồi chạy truy vấn tiếp theo kiểm kết quả đúng; xử lý lỗi bằng cách bắt P2002 ngoài transaction. Mức: chưa xác nhận.
- Partial unique index: 7.5.0 giữ nguyên index thủ công khi migrate, và loại chúng khỏi `findUnique`. Hợp với AD-2 (SQL thô). CHECK constraint thô: không có tài liệu mâu thuẫn; migration SQL thô không bị Prisma sửa; chưa kiểm riêng `migrate dev` diff có cố xóa CHECK không (Prisma không introspect CHECK), cần test trong CI như spine đã yêu cầu.

**BullMQ** (docs prioritized)
- Priority hợp lệ 1..2.097.151, 0 là mặc định và chạy **trước** mọi job có priority: spine đã tránh. FIFO cùng mức: khớp. Docs không nói về tương tác với `concurrency`, và không nói preempt. Spine chưa ghi rõ "không preempt" (mức nhỏ).
- `jobId` dedup + `removeOnComplete/removeOnFail: true`: logic AD-3 hợp lý (job bị xóa thì id dùng lại được). Hệ quả đã được xử lý bằng bộ quét DB.
- `concurrency = 2` mỗi Worker instance: đúng. **Chưa thấy `maxStalledCount`/`lockDuration` trong spine** (v1 đã khuyến nghị); job poll lâu cộng ffmpeg khóa CPU có thể làm lock gia hạn trễ. Mức nhỏ, nhưng đã nêu ở v1 mà chưa được áp dụng.

**PostgreSQL 16 / Redis 7**
- `postgres:16-alpine` tồn tại (cập nhật 2026-10-26); PostgreSQL 16 hỗ trợ đến 2028-11-09. `redis:7` tồn tại, trôi theo 7.4.x (EOL 2029-12-01). OK. Lưu ý: redis:7 là tag trôi, ghim patch (ví dụ 7.4.x) khi triển khai. Alpine vs Debian cho postgres: lưu ý collation musl khi restore pg_dump giữa image khác nhau; chưa kiểm cho ứng dụng này, nếu dùng sắp xếp theo locale thì chọn Debian.
- AOF `appendonly yes`, `appendfsync everysec`, `noeviction`: khớp khuyến nghị BullMQ. Cần `maxmemory` thực tế (spine chưa ghi).

**Cloudflare R2**
- HeadObject, CopyObject, PutObject: được hỗ trợ trong tài liệu R2 S3 API. CopyObject hỗ trợ cơ bản và điều kiện copy-source; **không** hỗ trợ tagging, ACL; trang không nêu giới hạn kích thước CopyObject (video 100 MB: nên thử thật trên bucket; chưa xác nhận).
- Lifecycle: đơn vị tối thiểu là **ngày** (không có giờ). **AD-8 ghi `in-raw/` tự xóa sau 24 giờ: lifecycle R2 chỉ có 1 ngày, và xóa "thường trong 24 giờ sau hạn"** nên thực tế tối đa khoảng 2 ngày. Spine đã nói "có thể trễ khoảng 1 ngày"; chỉ cần sửa "24 giờ" thành "1 ngày (xóa trong 1-2 ngày)". Ghi ý: nếu `in-raw/` chứa nội dung chưa qua kiểm thì để lâu hơn mong đợi; không phải lỗi bảo mật vì bucket riêng tư.
- Presigned URL: trang S3 API không nhắc; mức xác nhận tương tự v1 (kiến thức đã biết). Phụ thuộc: cần `@aws-sdk/s3-request-presigner` 3.1161.0 (node >= 20, tồn tại) **chưa có trong Stack**. Cần CORS bucket cho PUT từ origin FE (chưa ghi).

**ffmpeg libx264**: spine chỉ ghi "bản của image Docker, ghim theo tag image", không chọn image. Gói `ffmpeg` của Alpine (có tại v3.22) phụ thuộc x264-libs nên có libx264 theo đúng thực tế thường gặp, nhưng **chưa xác nhận trực tiếp** trong phiên này (chỉ xác nhận trang gói tồn tại). Lưu ý: sharp 0.35.5 dùng libvips prebuilt, trên Alpine chạy musl được hỗ trợ; vẫn nên thống nhất một base image cho `api`/`worker` và chạy `ffmpeg -encoders | grep libx264` trong CI. libx264 là GPL: không phải vấn đề khi chỉ dùng nội bộ trên server, không phân phối binary.

**RunningHub** (doc-8287469)
- Xác nhận: `POST /task/openapi/upload` (multipart, `apiKey`, `fileType=input`, trả `data.fileName`); `POST /task/openapi/ai-app/run` (`webappId`, `apiKey`, `nodeInfoList`, trả `data.taskId`); `POST /task/openapi/outputs` (`apiKey`, `taskId`; code 0 xong, 804 chạy, 813 xếp hàng, 805 lỗi với `failedReason`); `/status` ghi "no longer maintained". Khớp spine.
- Không có endpoint cancel trong trang này; không có idempotency. Spine đã nhận diện.
- Host trong doc là `www.runninghub.cn`; spine không ghi host. Cần xác nhận `.cn` vs `.ai` với tài khoản thật. Tài liệu mẫu poll 5 giây, spine poll 3 giây: kiểm giới hạn tốc độ (chưa có thông tin). Spine dùng "create" như `ai-app/run`; nếu workflow dùng API ComfyUI workflow khác thì đường dẫn khác (chưa xác nhận từ trang này).

## 5. Việc còn lại (ưu tiên)
1. Quyết định ioredis: hạ về 5.11.1, hoặc giữ 6.0.0 + `protocol: 2` + test CI (mục 3).
2. Thêm vào Stack: `@prisma/adapter-pg` 7.10.1, `@aws-sdk/s3-request-presigner` 3.1161.0, cấu hình generator `prisma-client` ESM và pool `pg`; thêm test CI cho rủi ro #30374.
3. Sửa AD-8: "24 giờ" thành "1 ngày (lifecycle R2 tối thiểu 1 ngày, xóa trong 1-2 ngày)"; ghi CORS bucket và thử CopyObject với 100 MB.
4. Chọn và ghi base image cụ thể cho ffmpeg (tag + kiểm libx264 trong CI); ghim patch Redis.
5. Sơ đồ (dòng "submit, poll 3s, cancel" trong sơ đồ hệ thống) vẫn ghi `cancel` trong khi AD-6 nói chưa xác nhận endpoint hủy: bỏ chữ "cancel" khỏi sơ đồ hoặc đánh dấu best-effort.
6. Nhỏ: ghi `maxStalledCount`/`lockDuration`, `maxmemory`, "không preempt" priority; Node 24 LTS làm đích dài hạn; host RunningHub.

## Chưa xác nhận
- Hành vi BullMQ 6.5.3 với ioredis 6.0.0 (RESP3): chỉ bằng chứng thứ cấp.
- Issue prisma/orm #30374 còn tồn tại ở 7.10.1.
- CopyObject R2 với tệp 100 MB; presigned PUT (tài liệu trang S3 API không nhắc).
- libx264 có trong image ffmpeg được chọn.
- Endpoint hủy RunningHub, host `.ai`/`.cn`, giới hạn tần suất poll.
