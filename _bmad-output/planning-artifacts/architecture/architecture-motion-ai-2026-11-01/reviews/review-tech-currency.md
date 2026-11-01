# Review: độ cập nhật và tính đúng của quyết định công nghệ (ARCHITECTURE-SPINE)

Ngày kiểm: 2026-11-01. Nguồn: npm registry (`/latest`, `/<ver>`), tài liệu BullMQ, Cloudflare R2, RunningHub, Prisma release notes, issue tfjs. Spine không bị sửa.

## Kết luận
**Cần sửa trước khi chốt (CONDITIONAL).** Các phiên bản npm đều tồn tại và khớp. Nhưng có 3 lỗi thực chất: (1) ràng buộc Node không đủ cho Nuxt, (2) nsfwjs/tfjs-node không có binary Node 22, (3) RunningHub: endpoint `/status` đã bị bỏ, không có cancel, không có idempotency khi submit.

## Bảng kiểm

| Hạng mục | Kết quả | Ghi chú |
| --- | --- | --- |
| Nuxt 4.6.3 | OK, nhưng Node sai | `engines.node = ^22.22.3 \|\| ^24.15.0 \|\| >=26`. Spine ghi "Node >= 22.12" là KHÔNG ĐỦ. |
| @nestjs/core 12.3.2 | OK | `type: module`, `engines >= 20`. ESM-only xác nhận ở mức package type module; cần dùng `"type":"module"`/`nodenext` trong api và worker. Chưa kiểm tay hệ sinh thái bên thứ ba (passport, jwt, throttler) tương thích Nest 12. |
| @nestjs/bullmq 12.0.0 | OK | peer `bullmq ^3..^6`, `@nestjs/core ^10..^12`. Tương thích bullmq 6.5.3. |
| bullmq 6.5.3 | OK | `engines node >=14.18`; peer ioredis `>=5`, nên ioredis 6.0.0 hợp lệ về peer. Chưa xác nhận bullmq 6.5.3 tự bundle/dùng ioredis 6 (chạy thử khi cài; nếu bullmq kéo ioredis 5 riêng, tránh truyền instance ioredis 6 dùng chung). |
| ioredis 6.0.0 | OK | `engines node >=20`. |
| Prisma 7.10.1 | OK | `@prisma/client` 7.10.1 engines `^20.19 \|\| ^22.12 \|\| >=24`. `latest` tag của `prisma` là 8.0.0-rc.29 (spine đã ghi đúng); tag `prev` = 7.10.1. Lưu ý: Prisma 7 mặc định `prisma-client` generator ESM, và cần driver adapter (`@prisma/adapter-pg`); spine chưa nhắc. |
| Node 22 cho tất cả | CÓ ĐIỀU KIỆN | Cần `>= 22.22.3` (Nuxt) nếu Nuxt build trên cùng image. FE chạy Vercel/CF nên ảnh hưởng chủ yếu CI/dev; vẫn nên ghim một giá trị duy nhất. nsfwjs 4.4.0 khai báo `engines node 22.13.0` (cứng, kiểu devEngines) và npm `>=10 <12`. |
| nsfwjs 4.4.0 | CẢNH BÁO | peer `@tensorflow/tfjs ^4.0.0` đúng. Package có ESM+CJS. README Node dùng `@tensorflow/tfjs-node`. |
| @tensorflow/tfjs-node | KHÔNG DÙNG | Bản mới nhất 4.22.0 (2024-10), không bảo trì. Issue tfjs #8430: không có prebuilt binary Node 22; phải build từ source (Python, C++, node-gyp), hay lỗi 404 cả trên Node 20 (#8566, #8688). Trong Docker alpine còn tệ hơn (libc musl). |
| Backend TF khác | Đề xuất | Dùng `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-wasm` (không cần binary native, chạy trong `worker_threads`), hoặc `tfjs` thuần CPU (chậm hơn nhiều). Con số 100-300 ms trong Deferred chưa có cơ sở; phải đo. Hoặc cân nhắc thay nsfwjs bằng ONNX Runtime Node. |
| Prisma 7 `SELECT ... FOR UPDATE` | Cần raw | Không có API khóa dòng trong `find*` (issue #17136). Dùng `prisma.$transaction(async tx => { await tx.$queryRaw\`SELECT id FROM users WHERE id=${id} FOR UPDATE\`; ... })`, chỉ dùng `tx`. Spine nói đúng "SELECT FOR UPDATE" nhưng cần ghi rõ là raw và nằm ngoại lệ của AD-1 ("không SQL thô ghi bảng") - SELECT khóa không ghi nên không vi phạm, nhưng nên nói rõ. |
| Partial unique index | Chỉ qua SQL migration (Prisma 7) | Prisma 7 có preview `partialIndexes`; từ 7.5.0 index partial thủ công được giữ nguyên khi migrate; `findUnique` không dùng được trên chúng. Prisma 8 mới hỗ trợ khai báo trong schema. AD-2 yêu cầu unique `(task_id)` cho HOLD và cho tập `{CAPTURED, RELEASED}` - đây BẮT BUỘC là partial unique index (`WHERE type='HOLD'`, `WHERE type IN ('CAPTURED','RELEASED')`) viết tay trong migration. Ghi vào spine; dùng `create` và bắt lỗi P2002 thay vì `upsert` theo khóa đó. |
| BullMQ `jobId` | OK, có bẫy | Id trùng bị bỏ qua im lặng (không lỗi). Chỉ chặn trùng khi job cũ còn trong queue; job bị xóa (`removeOnComplete/Fail`) thì id dùng lại được. Id UUID chứa `-` OK, không chứa `:`. Id toàn số bị từ chối (UUID không sao). Vì vậy `removeOnComplete` nên giữ job một thời gian hoặc dựa vào DB (AD-6 đã làm đúng khi quét). |
| BullMQ `priority` | OK, có bẫy | Phạm vi 1..2.097.151, số nhỏ chạy trước, cùng mức FIFO (khớp spine). Job không có priority (0) chạy TRƯỚC mọi job có priority: mọi job phải luôn đặt priority >= 1. Thêm job có priority tốn O(log n). Tài liệu không mô tả tương tác với `concurrency`; về cơ chế, priority chỉ quyết định thứ tự lấy job, nên với `concurrency = 2` hai Lane lấy lần lượt hai job ưu tiên nhất tại thời điểm rảnh; không preempt job đang chạy (Task FREE đã chạy không bị nhường). Spine nên nêu rõ là không preempt. |
| `concurrency = 2` | OK | Là giới hạn mỗi Worker instance. Chỉ một tiến trình worker nên đúng 2 Lane. Poll 3 giây trong job giữ slot suốt thời gian chạy (180/360 s) - đúng ý, nhưng khóa job BullMQ (lock 30 s mặc định, tự gia hạn) cần event loop không bị chặn; nếu job poll lâu và worker bị chặn thì job bị coi là stalled và chạy lại (spine đã xử lý bằng `runninghub_task_id`). Nên đặt `maxStalledCount` rõ ràng. |
| RunningHub endpoints | LỖI THỜI / THIẾU | Doc chính thức (doc-8287469): `/task/openapi/status` ghi "no longer maintained", dùng `POST /task/openapi/outputs` (body `apiKey`, `taskId`; code 0 = xong, 804 đang chạy, 813 xếp hàng, 805 lỗi, `data.failedReason`). Upload: `POST /task/openapi/upload` (multipart, `fileType=input`, trả `fileName`). Submit: `POST /task/openapi/ai-app/run` (hoặc API workflow tương ứng). Cancel: KHÔNG tìm thấy trong tài liệu công khai. Host trong doc là `www.runninghub.cn`, kiểm tra đúng `.ai` hay `.cn` cho tài khoản. apiKey nằm trong body, không phải header. |
| Submit idempotent | KHÔNG CÓ | Không có idempotency key hay webhook trong tài liệu. Hệ quả: nếu worker crash giữa lúc gọi submit và lúc ghi `runninghub_task_id` (AD-6 "ghi ngay sau khi submit"), job chạy lại sẽ submit lần hai, tốn GPU và có thể vượt 2 Lane phía RunningHub. Khoảng hở này không loại bỏ được hoàn toàn. Giảm thiểu: ghi trạng thái `submitting` + dấu thời gian trước khi gọi; nếu job chạy lại thấy `submitting` mà chưa có id thì KHÔNG tự submit lại, đưa vào xử lý thủ công/`failed` + RELEASED hoặc chấp nhận rủi ro có chủ đích và ghi vào spine; đối chiếu số dư/tác vụ gần đây bằng API nếu có. |
| Cloudflare R2 lifecycle | OK | Lọc theo prefix, `Expiration Days`, tối đa 1000 rule/bucket. Xóa không chính xác: thường trong 24 giờ sau hạn nên `in/` 7 ngày và `out/` 30 ngày là "tối thiểu", không phải chính xác (ảnh hưởng FR-22/chính sách xóa nếu có cam kết cứng). Mặc định có rule hủy multipart 7 ngày. Backup `db-backup` giữ 7 bản cần rule/tiền tố riêng hoặc xóa bằng cron. |
| R2 presigned PUT | OK (không kiểm lại trực tiếp trang này) | R2 hỗ trợ presigned URL S3 cho PUT/GET qua endpoint S3 (không qua custom domain). Cần cấu hình CORS bucket cho PUT từ origin FE. Presigned PUT không ép giới hạn kích thước (khác POST policy): giới hạn 100 MB phải kiểm bằng HEAD sau khi tải và xóa nếu vượt; ghi vào AD-8. Mức xác nhận: kiến thức đã biết, chưa trích dẫn được nguồn mới trong phiên này. |
| Redis 7 AOF/noeviction | OK | Doc BullMQ: `noeviction` là cài đặt duy nhất đảm bảo đúng; khuyến nghị AOF fsync mỗi giây (`appendfsync everysec`); worker đặt `maxRetriesPerRequest: null`. Spine nên ghi `appendfsync everysec` và `maxRetriesPerRequest: null`. Phiên bản Redis tối thiểu của BullMQ 6 không xác nhận trong phiên này (Redis 7 chắc chắn đủ). Cũng cần đặt `maxmemory` thực tế để noeviction không làm ghi thất bại khi đầy. |

## Việc cần làm (ưu tiên)
1. Sửa dòng Node: `>= 22.22.3` hoặc nâng lên Node 24 LTS; ghim cùng một giá trị cho image, CI, `engines`.
2. Bỏ giả định `tfjs-node`; chọn WASM hoặc pure JS (hoặc ONNX) và đo trên VPS trước khi chốt AD-9. Ghi vào Stack.
3. AD-6: thay `/task/openapi/status` bằng `/task/openapi/outputs`; xác nhận bằng tài khoản thật cách hủy (chưa có tài liệu), và ghi rõ rằng submit không idempotent cùng quy tắc xử lý cửa sổ crash.
4. AD-2: ghi rõ các unique là partial unique index viết tay trong migration SQL; `SELECT FOR UPDATE` qua `tx.$queryRaw`.
5. Nhỏ: priority luôn >= 1; không preempt; R2 xóa trong ~24 giờ; presigned PUT cần kiểm kích thước sau khi tải; Redis `appendfsync everysec`; Prisma 7 cần driver adapter.

## Chưa xác nhận
- Hệ sinh thái Nest 12 (passport, jwt, throttler, swagger) có bản tương thích hay chưa.
- bullmq 6.5.3 dùng ioredis phiên bản nào bên trong.
- Endpoint hủy của RunningHub; host `.ai` vs `.cn`.
- Tương tác priority với concurrency chỉ suy ra từ cơ chế, tài liệu không nêu.
