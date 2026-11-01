import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isFileAllowedForBranch,
  validateBranchBoundaries,
} from './check-branch-boundaries.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(__dirname, 'check-branch-boundaries.mjs');

function runBoundaryCli(branch, files) {
  return spawnSync(
    process.execPath,
    [scriptPath, '--branch', branch, '--files', files.join(',')],
    { encoding: 'utf8' },
  );
}

describe('check-branch-boundaries (I/O & Edge-Case Matrix)', () => {
  it('1. Nhánh fe/* hợp lệ: fe/login-ui sửa apps/web/app.vue và package-lock.json -> exit 0', () => {
    const res = runBoundaryCli('fe/login-ui', [
      'apps/web/app.vue',
      'package-lock.json',
    ]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /passed/i);
  });

  it('2. Nhánh fe/* vi phạm ranh giới: fe/login-ui sửa apps/api/src/main.ts hoặc packages/contracts/src/index.ts -> exit 1 + liệt kê file vi phạm', () => {
    const res = runBoundaryCli('fe/login-ui', [
      'apps/web/app.vue',
      'apps/api/src/main.ts',
      'packages/contracts/src/index.ts',
    ]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /apps\/api\/src\/main\.ts/);
    assert.match(res.stderr, /packages\/contracts\/src\/index\.ts/);
  });

  it('3. Nhánh be/* hợp lệ: be/db-setup sửa apps/api/src/main.ts, deploy/compose.yml, package-lock.json -> exit 0', () => {
    const res = runBoundaryCli('be/db-setup', [
      'apps/api/src/main.ts',
      'deploy/compose.yml',
      'package-lock.json',
    ]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /passed/i);
  });

  it('4. Nhánh be/* vi phạm ranh giới: be/db-setup sửa apps/web/nuxt.config.ts hoặc packages/contracts/src/index.ts -> exit 1 + liệt kê file vi phạm', () => {
    const res = runBoundaryCli('be/db-setup', [
      'apps/api/src/main.ts',
      'apps/web/nuxt.config.ts',
      'packages/contracts/src/index.ts',
    ]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /apps\/web\/nuxt\.config\.ts/);
    assert.match(res.stderr, /packages\/contracts\/src\/index\.ts/);
  });

  it('5. Nhánh contract/* sửa hợp đồng: contract/1-2-auth-wallet chỉ sửa packages/contracts/ và package-lock.json -> exit 0', () => {
    const res = runBoundaryCli('contract/1-2-auth-wallet', [
      'packages/contracts/src/index.ts',
      'packages/contracts/package.json',
      'package-lock.json',
    ]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /passed/i);
  });

  it('6. Nhánh contract/* sửa sang app: contract/1-2-auth-wallet sửa apps/web/app.vue hoặc apps/api/src/main.ts -> exit 1 + liệt kê file vi phạm', () => {
    const res = runBoundaryCli('contract/1-2-auth-wallet', [
      'packages/contracts/src/index.ts',
      'apps/web/app.vue',
      'apps/api/src/main.ts',
    ]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /apps\/web\/app\.vue/);
    assert.match(res.stderr, /apps\/api\/src\/main\.ts/);
  });

  it('7. Nhánh shared/* sửa toàn repo: shared/1-1-monorepo sửa cấu hình gốc, packages/contracts/, apps/*, deploy/ -> exit 0', () => {
    const res = runBoundaryCli('shared/1-1-monorepo', [
      'package.json',
      'tsconfig.base.json',
      'packages/contracts/src/index.ts',
      'apps/api/src/main.ts',
      'apps/web/app.vue',
      'deploy/compose.yml',
    ]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /passed/i);
  });

  it('supports direct programmatic validation and strips refs/heads/ in isFileAllowedForBranch', () => {
    assert.equal(
      isFileAllowedForBranch('refs/heads/fe/feature-card', 'deploy/compose.yml'),
      false,
    );
    const result = validateBranchBoundaries({
      branch: 'refs/heads/fe/feature-card',
      changedFiles: ['./apps/web/app.vue', 'deploy/compose.yml'],
    });
    assert.equal(result.valid, false);
    assert.deepEqual(result.violations, ['deploy/compose.yml']);
  });

  it('normalizes .. segments and blocks path traversal bypasses', () => {
    const traversal = validateBranchBoundaries({
      branch: 'fe/login-ui',
      changedFiles: ['apps/web/../api/src/main.ts', '../outside.ts'],
    });
    assert.equal(traversal.valid, false);
    assert.deepEqual(traversal.violations, [
      'apps/api/src/main.ts',
      '../outside.ts',
    ]);
  });

  it('honors GITHUB_HEAD_REF precedence over GITHUB_REF_NAME with CHANGED_FILES and explicit empty --files', () => {
    const envRes = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BRANCH_NAME: '',
        GITHUB_HEAD_REF: 'fe/pr-branch',
        GITHUB_REF_NAME: 'main',
        CHANGED_FILES: 'apps/api/src/main.ts',
      },
    });
    assert.equal(envRes.status, 1);
    assert.match(envRes.stderr, /fe\/pr-branch/);
    assert.match(envRes.stderr, /apps\/api\/src\/main\.ts/);

    const emptyFilesRes = runBoundaryCli('fe/login-ui', []);
    assert.equal(emptyFilesRes.status, 0);
    assert.match(emptyFilesRes.stdout, /0 file\(s\) checked/);
  });

  it('enforces single root package-lock.json with no nested or foreign lockfiles in workspaces', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, 'package-lock.json')));
    const forbidden = [
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lockb',
      'bun.lock',
      'package-lock.json',
    ];
    for (const rootForeign of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']) {
      assert.equal(
        fs.existsSync(path.join(repoRoot, rootForeign)),
        false,
        `Unexpected root lockfile: ${rootForeign}`,
      );
    }
    for (const wsDir of ['apps/api', 'apps/web', 'packages/contracts']) {
      for (const lockName of forbidden) {
        assert.equal(
          fs.existsSync(path.join(repoRoot, wsDir, lockName)),
          false,
          `Unexpected workspace lockfile: ${wsDir}/${lockName}`,
        );
      }
    }
  });
});
