import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCKFILE = 'pnpm-lock.yaml';

/**
 * Normalize a file path to POSIX relative format without leading `./` or `/`.
 * @param {string} filePath
 * @returns {string}
 */
export function normalizePath(filePath) {
  const raw = (filePath ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw) return '';
  const normalized = path.posix.normalize(raw);
  return normalized === '.' ? '' : normalized;
}

/**
 * Determine whether a file path is allowed for a given branch prefix.
 * @param {string} branch
 * @param {string} rawFile
 * @returns {boolean}
 */
export function isFileAllowedForBranch(branch, rawFile) {
  const cleanBranch = (branch ?? '').trim().replace(/^refs\/heads\//, '');
  const file = normalizePath(rawFile);
  if (!file) return true;

  if (file === '..' || file.startsWith('../')) {
    return false;
  }

  if (cleanBranch.startsWith('fe/')) {
    return file === LOCKFILE || file.startsWith('apps/web/');
  }

  if (cleanBranch.startsWith('be/')) {
    return (
      file === LOCKFILE ||
      file.startsWith('apps/api/') ||
      file.startsWith('deploy/')
    );
  }

  if (cleanBranch.startsWith('contract/')) {
    return file === LOCKFILE || file.startsWith('packages/contracts/');
  }

  if (cleanBranch.startsWith('shared/')) {
    return true;
  }

  // Non-prefixed branches such as main/master/integration/* are unrestricted
  return true;
}

/**
 * Validate a list of changed files against branch boundary rules.
 * @param {{ branch: string; changedFiles: string[] }} params
 * @returns {{ valid: boolean; branch: string; violations: string[]; message: string }}
 */
export function validateBranchBoundaries({ branch, changedFiles }) {
  const cleanBranch = (branch ?? '').trim().replace(/^refs\/heads\//, '');
  const files = (changedFiles ?? [])
    .map(normalizePath)
    .filter((f) => f.length > 0);

  const violations = files.filter(
    (file) => !isFileAllowedForBranch(cleanBranch, file),
  );

  if (violations.length > 0) {
    const lines = [
      `Branch boundary violation on branch "${cleanBranch}":`,
      ...violations.map((v) => `  - ${v}`),
    ];
    return {
      valid: false,
      branch: cleanBranch,
      violations,
      message: lines.join('\n'),
    };
  }

  return {
    valid: true,
    branch: cleanBranch,
    violations: [],
    message: `Branch boundary check passed for branch "${cleanBranch}" (${files.length} file(s) checked).`,
  };
}

function resolveBranchFromGit() {
  try {
    const name = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return name === 'HEAD' ? '' : name;
  } catch {
    return '';
  }
}

function tryGitLines(args) {
  try {
    const out = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
}

function resolveChangedFilesFromGit(baseRef) {
  const targetBase = baseRef || process.env.GITHUB_BASE_REF;
  if (targetBase) {
    const fromOrigin = tryGitLines([
      'diff',
      '--name-only',
      '--no-renames',
      `origin/${targetBase}...HEAD`,
    ]);
    if (fromOrigin !== null) return fromOrigin;

    const fromLocalBase = tryGitLines([
      'diff',
      '--name-only',
      '--no-renames',
      `${targetBase}...HEAD`,
    ]);
    if (fromLocalBase !== null) return fromLocalBase;
    return null;
  }

  const collected = new Set();
  const branchDiff =
    tryGitLines(['diff', '--name-only', '--no-renames', 'origin/main...HEAD']) ??
    tryGitLines(['diff', '--name-only', '--no-renames', 'main...HEAD']);
  if (branchDiff === null) return null;
  const workingTreeDiff =
    tryGitLines(['diff', '--name-only', '--no-renames', 'HEAD']) ?? [];
  const untrackedFiles =
    tryGitLines(['ls-files', '--others', '--exclude-standard']) ?? [];

  for (const file of [...branchDiff, ...workingTreeDiff, ...untrackedFiles]) {
    collected.add(file);
  }

  return [...collected];
}

function parseCliArgs(argv) {
  let branch =
    process.env.BRANCH_NAME ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    '';
  let hasExplicitFiles = process.env.CHANGED_FILES !== undefined;
  let filesRaw = process.env.CHANGED_FILES ?? '';
  let baseRef = process.env.BASE_REF || '';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--branch' && argv[i + 1] !== undefined) {
      branch = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--branch=')) {
      branch = arg.slice('--branch='.length);
    } else if (arg === '--files' && argv[i + 1] !== undefined) {
      hasExplicitFiles = true;
      filesRaw = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--files=')) {
      hasExplicitFiles = true;
      filesRaw = arg.slice('--files='.length);
    } else if (arg === '--base' && argv[i + 1] !== undefined) {
      baseRef = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--base=')) {
      baseRef = arg.slice('--base='.length);
    }
  }

  const resolvedBranch = branch || resolveBranchFromGit();
  if (!resolvedBranch) {
    throw new Error(
      'Cannot determine branch name (detached HEAD or git unavailable). Pass --branch or set BRANCH_NAME.',
    );
  }
  const changedFiles = hasExplicitFiles
    ? filesRaw
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : resolveChangedFilesFromGit(baseRef);
  if (changedFiles === null) {
    throw new Error(
      'Cannot compute changed files from git (missing base ref or shallow clone). Fetch the base branch or pass --files.',
    );
  }

  return { branch: resolvedBranch, changedFiles };
}

export function runCli(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const { branch, changedFiles } = parsed;
  const result = validateBranchBoundaries({ branch, changedFiles });

  if (!result.valid) {
    console.error(result.message);
    return 1;
  }

  console.log(result.message);
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exitCode = runCli();
}
