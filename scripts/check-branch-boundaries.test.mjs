import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
      'pnpm-lock.yaml',
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
      'pnpm-lock.yaml',
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
      'pnpm-lock.yaml',
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
    assert.ok(fs.existsSync(path.join(repoRoot, 'pnpm-lock.yaml')));
    const forbidden = [
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
      'bun.lockb',
      'bun.lock',
    ];
    for (const rootForeign of ['package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock']) {
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

  describe('git-based changed file resolution (đường CI thật sự dùng)', () => {
    function git(cwd, ...args) {
      return execFileSync('git', args, { cwd, encoding: 'utf8' });
    }

    function makeRepo() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-'));
      git(dir, 'init', '-q', '-b', 'main');
      git(dir, 'config', 'user.email', 't@example.com');
      git(dir, 'config', 'user.name', 'T');
      git(dir, 'config', 'commit.gpgsign', 'false');
      fs.mkdirSync(path.join(dir, 'apps/api/src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'apps/api/src/a.ts'), 'export const a = 1;\n'.repeat(20));
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'base');
      return dir;
    }

    function runGit(cwd, env) {
      const clean = { ...process.env };
      for (const key of ['BRANCH_NAME', 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'GITHUB_BASE_REF', 'BASE_REF', 'CHANGED_FILES']) {
        delete clean[key];
      }
      return spawnSync(process.execPath, [scriptPath], {
        cwd,
        encoding: 'utf8',
        env: { ...clean, ...env },
      });
    }

    it('flags out-of-bounds files from git diff against GITHUB_BASE_REF without --files', () => {
      const dir = makeRepo();
      git(dir, 'checkout', '-q', '-b', 'fe/x');
      fs.mkdirSync(path.join(dir, 'apps/web'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'apps/web/ok.vue'), '<template />\n');
      fs.writeFileSync(path.join(dir, 'apps/api/src/b.ts'), 'export const b = 1;\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'change');
      const res = runGit(dir, { GITHUB_HEAD_REF: 'fe/x', GITHUB_BASE_REF: 'main' });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /apps\/api\/src\/b\.ts/);
      assert.doesNotMatch(res.stderr, /apps\/web\/ok\.vue/);
    });

    it('reports the old path of a renamed file', () => {
      const dir = makeRepo();
      git(dir, 'checkout', '-q', '-b', 'fe/x');
      fs.mkdirSync(path.join(dir, 'apps/web'), { recursive: true });
      git(dir, 'mv', 'apps/api/src/a.ts', 'apps/web/a.ts');
      git(dir, 'commit', '-q', '-m', 'move');
      const res = runGit(dir, { GITHUB_HEAD_REF: 'fe/x', GITHUB_BASE_REF: 'main' });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /apps\/api\/src\/a\.ts/);
    });

    it('fails closed (exit 2) when the base ref cannot be resolved', () => {
      const dir = makeRepo();
      git(dir, 'checkout', '-q', '-b', 'fe/x');
      const res = runGit(dir, { GITHUB_HEAD_REF: 'fe/x', GITHUB_BASE_REF: 'does-not-exist' });
      assert.equal(res.status, 2);
      assert.match(res.stderr, /Cannot compute changed files/);
    });

    it('fails closed (exit 2) on detached HEAD with no branch env', () => {
      const dir = makeRepo();
      git(dir, 'checkout', '-q', '--detach');
      const res = runGit(dir, { GITHUB_BASE_REF: 'main' });
      assert.equal(res.status, 2);
      assert.match(res.stderr, /Cannot determine branch/);
    });
  });
});
