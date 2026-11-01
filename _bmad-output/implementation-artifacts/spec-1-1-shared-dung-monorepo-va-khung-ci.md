---
title: 'Story 1.1: [SHARED] Dựng monorepo và khung CI'
type: 'feature'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
baseline_commit: '739941783ccb92dda2abae4d8b4b475a6a91abc8'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Kho mã hiện mới chứa tài liệu quy hoạch (BMad), chưa có cấu trúc monorepo (`apps/web`, `apps/api`, `packages/contracts`, `deploy/`), chưa có cấu hình dùng chung và chưa có pipeline CI để kiểm tra chất lượng cũng như cưỡng chế ranh giới thư mục giữa hai luồng phát triển độc lập (Backend và Frontend).

**Approach:** Khởi tạo monorepo bằng trình quản lý gói duy nhất (`npm` workspaces với một `package-lock.json` ở thư mục gốc), ghim Node.js `>= 22.22.3` qua `.nvmrc` và `engines`, dựng bộ khung rỗng cho 3 gói (`packages/contracts`, `apps/api` với NestJS `12.3.2` ESM 2 entrypoint + 8 module + 3 port, `apps/web` với Nuxt `4.6.3`) cùng `deploy/compose.yml` giữ chỗ, và thiết lập GitHub Actions CI chạy lint, typecheck, build, test kèm script kiểm tra ranh giới đường dẫn theo tiền tố nhánh (`be/*`, `fe/*`, `contract/*`, `shared/*`).

## Boundaries & Constraints

**Always:**
- Sử dụng đúng một trình quản lý gói duy nhất (`npm` workspaces) với một file khóa duy nhất (`package-lock.json`) tại thư mục gốc và ghi rõ hướng dẫn vào `README.md` cùng `CLAUDE.md`.
- Khai báo Node.js `>= 22.22.3` trong trường `engines` của `package.json` gốc và file `.nvmrc` (`22.22.3`).
- Ghim chính xác phiên bản các thư viện cốt lõi được cài ở story này theo `ARCHITECTURE-SPINE.md` (không dùng `^` hoặc `~` cho các gói đã ghim): `nuxt` `4.6.3` trong `apps/web`; `@nestjs/core` `12.3.2`, `@nestjs/common` `12.3.2`, `@nestjs/platform-express` `12.3.2` (chạy chế độ ESM `"type": "module"`) trong `apps/api`. Các thư viện chuyên biệt khác (Prisma, BullMQ, ioredis, Passport, S3, Sharp...) để dành cài ở đúng story cần dùng.
- Tạo đủ cấu trúc thư mục mục tiêu: `apps/web`, `apps/api` (có `src/main.ts`, `src/worker.ts`, 8 thư mục module `auth`, `wallet`, `tasks`, `pipelines`, `topups`, `storage`, `ops`, `audit` và 3 port `RunningHubPort`, `StoragePort`, `NotifierPort`), `packages/contracts`, và `deploy/compose.yml`.
- Mọi lệnh `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` chạy tại thư mục gốc phải thực thi thành công trên cả 3 gói (`packages/contracts`, `apps/api`, `apps/web`).
- CI workflow (`.github/workflows/ci.yml`) phải chạy lint, typecheck, build, test và kiểm tra ranh giới nhánh (branch path boundary check) khi mở Pull Request.

**Never:**
- Không cài đặt trước các thư viện thuộc các story sau (như Prisma, BullMQ, ioredis, `@aws-sdk`, `sharp`, `@nestjs/jwt`, v.v.) vào `package.json` của story này.
- Không triển khai nghiệp vụ cụ thể của API, Worker, DB schema hay giao diện người dùng ngoài mã khung tối thiểu để pass lint, typecheck, build và test.
- Không cho phép nhánh `fe/*` sửa file ngoài `apps/web/` (trừ lockfile gốc) hoặc nhánh `be/*` sửa file ngoài `apps/api/` và `deploy/` (trừ lockfile gốc); chỉ nhánh `contract/*` và `shared/*` mới được sửa `packages/contracts/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nhánh `fe/*` hợp lệ | Nhánh `fe/login-ui` sửa `apps/web/app.vue` và `package-lock.json` | Script kiểm tra ranh giới nhánh trả về exit code `0`, in thông báo hợp lệ | N/A |
| Nhánh `fe/*` vi phạm ranh giới | Nhánh `fe/login-ui` sửa `apps/api/src/main.ts` hoặc `packages/contracts/src/index.ts` | Script trả về exit code `1` | Liệt kê rõ từng đường dẫn file vi phạm ra stderr/stdout |
| Nhánh `be/*` hợp lệ | Nhánh `be/db-setup` sửa `apps/api/src/main.ts`, `deploy/compose.yml`, `package-lock.json` | Script trả về exit code `0` | N/A |
| Nhánh `be/*` vi phạm ranh giới | Nhánh `be/db-setup` sửa `apps/web/nuxt.config.ts` hoặc `packages/contracts/src/index.ts` | Script trả về exit code `1` | Liệt kê rõ từng đường dẫn file vi phạm ra stderr/stdout |
| Nhánh `contract/*` sửa hợp đồng | Nhánh `contract/1-2-auth-wallet` chỉ sửa các file trong `packages/contracts/` và `package-lock.json` | Script trả về exit code `0` | N/A |
| Nhánh `contract/*` sửa sang app | Nhánh `contract/1-2-auth-wallet` sửa `apps/web/app.vue` hoặc `apps/api/src/main.ts` | Script trả về exit code `1` | Liệt kê rõ từng đường dẫn file vi phạm (nhánh `contract/*` chỉ được sửa `packages/contracts/` và lockfile) |
| Nhánh `shared/*` sửa toàn repo | Nhánh `shared/1-1-monorepo` sửa cấu hình gốc, `packages/contracts/`, `apps/*`, `deploy/` | Script trả về exit code `0` | N/A |

</frozen-after-approval>

## Code Map

- `.nvmrc` -- Khai báo phiên bản Node.js chuẩn (`22.22.3`).
- `.gitignore` -- Bỏ qua `node_modules/`, `dist/`, `.nuxt/`, `.output/`, `.env*` (trừ `.env.example`), log và cache.
- `package.json` -- Cấu hình workspace gốc (`packages/*`, `apps/*`), `engines.node >= 22.22.3`, và các script `lint`, `typecheck`, `build`, `test`, `check:boundaries`.
- `tsconfig.base.json` -- Cấu hình TypeScript strict dùng chung cho toàn monorepo.
- `eslint.config.mjs` -- Cấu hình ESLint Flat Config dùng chung cho toàn monorepo (`@eslint/js`, `typescript-eslint`).
- `scripts/check-branch-boundaries.mjs` -- Script Node.js kiểm tra danh sách file thay đổi theo tên nhánh (`fe/*`, `be/*`, `contract/*`, `shared/*`).
- `scripts/check-branch-boundaries.test.mjs` -- Unit test (dùng `node:test`) kiểm thử toàn bộ các kịch bản ranh giới nhánh trong I/O Matrix.
- `packages/contracts/package.json` -- Gói `@motion-ai/contracts` xuất kiểu và module dùng chung.
- `packages/contracts/tsconfig.json` -- Cấu hình TypeScript kế thừa `tsconfig.base.json` để build ra `dist/`.
- `packages/contracts/src/index.ts` -- Entrypoint khung của gói hợp đồng.
- `apps/api/package.json` -- Gói `@motion-ai/api` chạy ESM (`"type": "module"`), ghim `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` ở `12.3.2`.
- `apps/api/tsconfig.json` -- Cấu hình TypeScript cho NestJS ESM (`emitDecoratorMetadata`, `experimentalDecorators`).
- `apps/api/src/main.ts` -- Entrypoint khởi động HTTP API của NestJS (`AppModule`).
- `apps/api/src/worker.ts` -- Entrypoint khởi động Worker (`ApplicationContext` không mở cổng HTTP).
- `apps/api/src/app.module.ts` -- Module gốc kết nối 8 domain module khung (`auth`, `wallet`, `tasks`, `pipelines`, `topups`, `storage`, `ops`, `audit`).
- `apps/api/src/modules/*/index.ts` -- Khung 8 module domain theo `ARCHITECTURE-SPINE.md`.
- `apps/api/src/ports/index.ts` -- Khung 3 port interface (`RunningHubPort`, `StoragePort`, `NotifierPort`).
- `apps/web/package.json` -- Gói `@motion-ai/web` ghim `nuxt` `4.6.3`.
- `apps/web/nuxt.config.ts` -- Cấu hình Nuxt 4 tối thiểu tương thích TypeScript.
- `apps/web/app.vue` -- Component gốc tối thiểu của Nuxt 4.
- `deploy/compose.yml` -- File Docker Compose khung tại thư mục `deploy/` (sẽ được hoàn thiện 4 container ở Story 1.3).
- `.github/workflows/ci.yml` -- Pipeline GitHub Actions chạy trên PR và push: cài đặt bằng `npm ci`, kiểm tra ranh giới nhánh, chạy `lint`, `typecheck`, `build`, `test`.
- `README.md` -- Tài liệu hướng dẫn cài đặt, trình quản lý gói (`npm`), cấu trúc monorepo và các lệnh phát triển.
- `CLAUDE.md` -- Cập nhật trạng thái repo và các lệnh build/lint/test thật theo hướng dẫn trong file.

## Tasks & Acceptance

**Execution:**
- [x] `.nvmrc`, `.gitignore`, `package.json`, `tsconfig.base.json`, `eslint.config.mjs` -- Khởi tạo cấu hình gốc của monorepo với `npm` workspaces (`packages/*`, `apps/*`), `engines.node >= 22.22.3`, TypeScript strict và ESLint Flat Config -- Đảm bảo một trình quản lý gói duy nhất, một lockfile và cấu hình lint/typecheck thống nhất.
- [x] `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts` -- Dựng gói `@motion-ai/contracts` với các script `lint`, `typecheck`, `build`, `test` -- Tạo nơi chứa hợp đồng chung cho Story 1.2.
- [x] `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/main.ts`, `apps/api/src/worker.ts`, `apps/api/src/app.module.ts`, `apps/api/src/modules/*/index.ts`, `apps/api/src/ports/index.ts` -- Dựng gói `@motion-ai/api` dùng NestJS `12.3.2` (ESM) với 2 entrypoint (`main.ts` và `worker.ts`), 8 module rỗng (`auth`, `wallet`, `tasks`, `pipelines`, `topups`, `storage`, `ops`, `audit`) và 3 port (`RunningHubPort`, `StoragePort`, `NotifierPort`) -- Đáp ứng đúng kiến trúc Modular Monolith trong AR1 và AR2.
- [x] `apps/web/package.json`, `apps/web/ tsconfig.json`, `apps/web/nuxt.config.ts`, `apps/web/app.vue` -- Dựng gói `@motion-ai/web` với Nuxt `4.6.3` và các script `lint`, `typecheck`, `build`, `test` -- Đáp ứng khung Frontend theo AR1 và AR2.
- [x] `deploy/compose.yml` -- Tạo file khung Docker Compose cho hạ tầng triển khai -- Đáp ứng yêu cầu cấu trúc thư mục `deploy/` của AR1.
- [x] `scripts/check-branch-boundaries.mjs`, `scripts/check-branch-boundaries.test.mjs` -- Viết script kiểm tra ranh giới đường dẫn theo tên nhánh (`fe/*`, `be/*`, `contract/*`, `shared/*`) hỗ trợ truyền tên nhánh và danh sách file qua biến môi trường/tham số hoặc lấy từ `git diff`, kèm bộ unit test kiểm증 toàn bộ kịch bản trong I/O Matrix -- Cưỡng chế quy tắc làm việc hai luồng song song không đụng độ file.
- [x] `.github/workflows/ci.yml` -- Thiết lập GitHub Actions workflow chạy trên Node `22.22.3`, thực thi `npm ci`, `check:boundaries`, `lint`, `typecheck`, `build`, `test` -- Đảm bảo CI chặn merge nếu bất kỳ bước kiểm tra nào thất bại.
- [x] `README.md`, `CLAUDE.md` -- Viết tài liệu hướng dẫn trình quản lý gói (`npm`), yêu cầu Node `>= 22.22.3`, quy ước nhánh và cập nhật các lệnh build/lint/test thật vào `CLAUDE.md` -- Hoàn thiện tài liệu cho lập trình viên và AI agent.

**Acceptance Criteria:**
- Given kho mã ở nhánh chính, when chạy `npm install` ở thư mục gốc, then cài đặt thành công toàn bộ workspace với duy nhất một file `package-lock.json` ở thư mục gốc, tồn tại đầy đủ `apps/web`, `apps/api`, `packages/contracts`, `deploy/`, và Node `>= 22.22.3` được khai báo trong cả `package.json` (`engines`) lẫn `.nvmrc`.
- Given monorepo vừa dựng, when chạy `npm run lint`, `npm run typecheck`, `npm run build`, và `npm test` ở thư mục gốc, then cả ba gói (`@motion-ai/contracts`, `@motion-ai/api`, `@motion-ai/web`) và bài test ranh giới nhánh đều chạy thành công với exit code `0`.
- Given một Pull Request trên GitHub, when workflow `.github/workflows/ci.yml` kích hoạt, then CI thực thi đầy đủ các bước kiểm tra ranh giới nhánh, lint, typecheck, build và test.
- Given phiên bản đã ghim trong `ARCHITECTURE-SPINE.md`, when kiểm tra `package.json` của từng gói, then `nuxt` được ghim đúng `4.6.3` và `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` được ghim đúng `12.3.2`.

## Implementation Notes

- Khởi tạo `npm` workspaces tại `package.json` gốc với một `package-lock.json` duy nhất, ghim Node `>= 22.22.3` trong `engines` và `22.22.3` trong `.nvmrc`.
- Thiết lập `@motion-ai/contracts`, `@motion-ai/api` (NestJS `12.3.2` ESM với 2 entrypoint `src/main.ts`, `src/worker.ts`, 8 domain module và 3 port `RunningHubPort`, `StoragePort`, `NotifierPort`), và `@motion-ai/web` (Nuxt `4.6.3`).
- Xây dựng `scripts/check-branch-boundaries.mjs` và bộ unit test `scripts/check-branch-boundaries.test.mjs` bao phủ toàn bộ 7 kịch bản trong I/O & Edge-Case Matrix.
- Cấu hình `.github/workflows/ci.yml` chạy `npm ci`, `npm run check:boundaries`, `npm run lint`, `npm run typecheck`, `npm run build`, và `npm test`.

## Spec Change Log

## Review Triage Log

- `[blind-hunter #1]` (`scripts/check-branch-boundaries.mjs:21-51`) — `false`: Quy ước nhánh trong Acceptance Criteria của `epics.md` chỉ áp đặt ranh giới thư mục lên các nhánh có tiền tố `fe/*`, `be/*`, `contract/*`, `shared/*`; các nhánh khác (`main`, `master`, `integration/*`, v.v.) không bị hạn chế ranh giới thư mục.
- `[blind-hunter #2 / edge-case-hunter #1 / verification-gap other #1]` (`scripts/check-branch-boundaries.mjs:95-119`) — `medium` (`patch`): Khi chạy cục bộ trên nhánh tính năng sau khi đã commit mà không truyền `BASE_REF`/`GITHUB_BASE_REF`, `resolveChangedFilesFromGit()` chỉ chạy `git diff --name-only HEAD` nên trả về danh sách rỗng và bỏ sót các commit trên nhánh so với `origin/main` hoặc `main`.
- `[blind-hunter #3 / edge-case-hunter #4]` (`scripts/check-branch-boundaries.mjs:118-156`) — `low` (`patch`): `parseCliArgs()` kiểm tra `if (arg === '--files' && argv[i + 1])` và `filesRaw ? ...` nên khi truyền `--files ""` (danh sách rỗng tường minh) lại rơi về `resolveChangedFilesFromGit()` thay vì kiểm tra danh sách 0 file.
- `[blind-hunter #4]` (`scripts/check-branch-boundaries.test.mjs`) — `low` (`patch`): `package-lock.json` đã tồn tại ở thư mục gốc (chỉ được loại khỏi file diff tạm để giữ kích thước diff nhỏ cho reviewer), tuy nhiên bổ sung một assertion trong unit test kiểm tra sự tồn tại của `package-lock.json` gốc và không có lockfile con/ngoại lai sẽ bảo vệ bất biến một lockfile của AC1.
- `[blind-hunter #5 / edge-case-hunter #5 / edge-case-hunter #6]` (`apps/api/src/main.ts:6-13`, `apps/api/src/worker.ts:11-13`) — `medium` (`patch`): Điều kiện `import.meta.url === \`file://\${process.argv[1]}\`` sẽ sai khi `process.argv[1]` là đường dẫn tương đối hoặc chứa khoảng trắng, và `Number(process.env.PORT ?? 3001)` trả về `0` khi `PORT=""`; cần dùng `path.resolve(process.argv[1])` so với `fileURLToPath(import.meta.url)` và đọc cổng an toàn.
- `[blind-hunter #6]` (`apps/api/test/app.test.mjs`) — `low` (`patch`): `bootstrapApi` trong `apps/api/src/main.ts` chưa được import/kiểm tra trong `apps/api/test/app.test.mjs`.
- `[blind-hunter #7]` (`package.json:14`, `apps/web/package.json:9`) — `low` (`patch`): `eslint .` ở root lint trùng các workspace và `apps/web` chỉ lint `nuxt.config.ts test`; chỉnh lại để root lint các file cấp gốc (`scripts`, `eslint.config.mjs`) rồi chạy `npm run lint --workspaces`.
- `[blind-hunter #8]` (`apps/web/tsconfig.json`) — `false`: Nuxt 4 tự sinh `.nuxt/tsconfig.json` với `strict: true` làm mặc định và `nuxt typecheck` đã kiểm tra kiểu nghiêm ngặt cho toàn bộ `apps/web`.
- `[blind-hunter #9]` (`packages/contracts/package.json`, `apps/api/package.json`) — `low` (rejected): Với bộ khung hiện tại không có đổi tên/xóa file `.ts`, việc thêm bước xóa `dist/` không cần thiết cho phạm vi Story 1.1.
- `[blind-hunter #10]` (`spec-1-1-shared-dung-monorepo-va-khung-ci.md`) — `false` (rejected): Theo quy tắc triage, bác bỏ các finding yêu cầu sửa file spec hoặc tối ưu vi mô thứ tự script npm không gây lỗi.
- `[edge-case-hunter #2]` (`scripts/check-branch-boundaries.mjs:8-10`) — `low` (`patch`): `normalizePath()` chưa gọi `path.posix.normalize()` nên đường dẫn chứa `..` như `apps/web/../api/src/main.ts` có thể lọt qua `startsWith('apps/web/')`.
- `[edge-case-hunter #3]` (`scripts/check-branch-boundaries.mjs:18-44`) — `low` (`patch`): `isFileAllowedForBranch()` nên tự strip tiền tố `refs/heads/` giống `validateBranchBoundaries()` để an toàn khi được gọi trực tiếp.
- `[verification-gap #1]` (`scripts/check-branch-boundaries.test.mjs`) — `medium` (`patch`): Bổ sung unit test gọi CLI/hàm với biến môi trường `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, `CHANGED_FILES` để bảo vệ hợp đồng giữa `.github/workflows/ci.yml` và `scripts/check-branch-boundaries.mjs`.
- `[verification-gap #2]` (`apps/api/test/app.test.mjs`) — `medium` (`patch`): Bổ sung kiểm tra `ctx.get(...)` cho đủ 8 domain module (`AuthModule`, `WalletModule`, `TasksModule`, `PipelinesModule`, `TopupsModule`, `StorageModule`, `OpsModule`, `AuditModule`) trong `apps/api/test/app.test.mjs`.

## Verification

**Commands:**
- `npm run lint` -- expected: exit code 0 trên toàn bộ workspace
- `npm run typecheck` -- expected: exit code 0 trên cả `packages/contracts`, `apps/api`, `apps/web`
- `npm run build` -- expected: exit code 0, biên dịch thành công `packages/contracts`, `apps/api`, và `apps/web`
- `npm test` -- expected: exit code 0, bao gồm toàn bộ unit test của `scripts/check-branch-boundaries.test.mjs` và test của các gói
