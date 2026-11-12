import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_THRESHOLDS,
  diffInspect,
  durationError,
  evaluateBenchmark,
  evaluateDiscord,
  evaluateTrim,
  extractRawFailure,
  gpuSecondsFromCoins,
  isHttpUrl,
  isInsideDir,
  isTechnicalFailure,
  lastJsonLine,
  maskSecrets,
  missingEnv,
  parseDockerPercent,
  parseDockerSize,
  parseInspectLines,
  percentile,
  readThresholds,
  sampleMetrics,
  secondsBetween,
  summarizeDockerStats,
  validateManifest,
  withinTolerance,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

describe('ngưỡng', () => {
  it('mặc định theo [ASSUMPTION] của epic', () => {
    const { thresholds, invalid } = readThresholds({});
    assert.deepEqual(invalid, []);
    assert.equal(thresholds.trimMaxSeconds, 60);
    assert.equal(thresholds.healthP95MaxMs, 1000);
    assert.equal(thresholds.minCreatorMargin, 0.7);
    assert.deepEqual([...thresholds.bodyIntensities], [3, 3, 5, 5, 8]);
    assert.equal(thresholds.motionSeconds.length, 10);
  });
  it('ghi đè bằng env, giá trị sai bị báo', () => {
    const { thresholds, invalid } = readThresholds({
      PRELAUNCH_TRIM_MAX_SECONDS: '90',
      PRELAUNCH_MIN_CREATOR_MARGIN: '0.65',
      PRELAUNCH_BODY_INTENSITIES: '2,4,6',
      PRELAUNCH_HEALTH_P95_MAX_MS: 'abc',
      PRELAUNCH_MOTION_SECONDS: '3,x',
    });
    assert.equal(thresholds.trimMaxSeconds, 90);
    assert.equal(thresholds.minCreatorMargin, 0.65);
    assert.deepEqual(thresholds.bodyIntensities, [2, 4, 6]);
    assert.equal(thresholds.healthP95MaxMs, 1000);
    assert.deepEqual(invalid.sort(), ['PRELAUNCH_HEALTH_P95_MAX_MS', 'PRELAUNCH_MOTION_SECONDS']);
  });
  it('missingEnv và isHttpUrl', () => {
    assert.deepEqual(missingEnv(['A', 'B', 'C'], { A: 'x', B: '  ' }), ['B', 'C']);
    assert.equal(isHttpUrl('https://example.com/x'), true);
    assert.equal(isHttpUrl('ftp://example.com'), false);
    assert.equal(isHttpUrl('khong-phai-url'), false);
    assert.equal(isHttpUrl(undefined), false);
  });
});

describe('phân vị và quy đổi', () => {
  it('p95 nearest-rank', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(xs, 95), 95);
    assert.equal(percentile([5], 95), 5);
    assert.equal(percentile([], 95), null);
    assert.equal(percentile([3, 1, 2], 50), 2);
  });
  it('giây GPU = coins / 0,4', () => {
    assert.equal(gpuSecondsFromCoins(40), 100);
    assert.equal(gpuSecondsFromCoins(0), 0);
    assert.equal(gpuSecondsFromCoins(-1), null);
    assert.equal(gpuSecondsFromCoins(10, 0.5), 20);
  });
  it('sai số độ dài ±0,5 giây', () => {
    assert.equal(durationError(10.4, 10), 0.4);
    assert.equal(withinTolerance(durationError(10.4, 10)), true);
    assert.equal(withinTolerance(durationError(10.5, 10)), true);
    assert.equal(withinTolerance(durationError(10.6, 10)), false);
    assert.equal(withinTolerance(durationError(9.4, 10)), false);
    assert.equal(withinTolerance(null), false);
  });
  it('secondsBetween', () => {
    assert.equal(secondsBetween('2026-11-12T00:00:00.000Z', '2026-11-12T00:00:42.500Z'), 42.5);
    assert.equal(secondsBetween(null, '2026-11-12T00:00:00Z'), null);
  });
});

describe('docker', () => {
  it('parse phần trăm và kích thước', () => {
    assert.equal(parseDockerPercent('152.3%'), 152.3);
    assert.equal(parseDockerPercent('--'), null);
    assert.equal(parseDockerSize('1.5GiB'), 1.5 * 1024 ** 3);
    assert.equal(parseDockerSize('512MB'), 512e6);
    assert.equal(parseDockerSize('0B'), 0);
    assert.equal(parseDockerSize('abc'), null);
  });
  it('tóm tắt CPU/RAM cao nhất', () => {
    const s = summarizeDockerStats([
      [{ Name: 'flowvis-nestjs-worker-1', CPUPerc: '20%', MemUsage: '100MiB / 2GiB' }],
      [{ Name: 'flowvis-nestjs-worker-1', CPUPerc: '180.5%', MemUsage: '50MiB / 2GiB' }],
    ]);
    assert.deepEqual(s['flowvis-nestjs-worker-1'], { maxCpuPercent: 180.5, maxMemBytes: 100 * 1024 ** 2 });
  });
  it('restart và OOM giữa hai lần inspect', () => {
    const before = parseInspectLines('/a 0 false T1\n/b 2 false T1\n');
    assert.deepEqual(diffInspect(before, parseInspectLines('/a 0 false T1\n/b 2 false T1')), { restarts: 0, oomKilled: [] });
    assert.deepEqual(diffInspect(before, parseInspectLines('/a 1 false T2\n/b 2 true T1')), { restarts: 1, oomKilled: ['b'] });
    assert.equal(diffInspect(before, parseInspectLines('/a 0 false T1')).restarts, 1);
  });
  it('OOMKilled=true có từ trước không tính; StartedAt đổi là khởi động lại', () => {
    const before = parseInspectLines('/a 0 true T1');
    assert.deepEqual(diffInspect(before, parseInspectLines('/a 0 true T1')), { restarts: 0, oomKilled: [] });
    assert.deepEqual(diffInspect(before, parseInspectLines('/a 0 true T2')), { restarts: 1, oomKilled: ['a'] });
    assert.deepEqual(diffInspect(parseInspectLines('/a 0 false T1'), parseInspectLines('/a 0 false T2')), { restarts: 1, oomKilled: [] });
  });
});

describe('đánh giá bước 1 và 2', () => {
  it('Discord đạt khi ≤ 10 s', () => {
    assert.equal(evaluateDiscord({ ok: true, latencyMs: 800 }).pass, true);
    assert.equal(evaluateDiscord({ ok: true, latencyMs: 10_001 }).pass, false);
    assert.equal(evaluateDiscord({ ok: false, latencyMs: 100 }).pass, false);
  });
  const good = { trimOk: true, trimMs: 45_000, healthLatenciesMs: Array(100).fill(30), healthErrors: 0, restarts: 0, oomKilled: [] };
  it('cắt đạt', () => {
    const v = evaluateTrim(good);
    assert.equal(v.pass, true);
    assert.equal(v.healthP95Ms, 30);
  });
  it('cắt không đạt theo từng điều kiện', () => {
    assert.equal(evaluateTrim({ ...good, trimMs: 60_001 }).checks.trimWithinLimit, false);
    assert.equal(evaluateTrim({ ...good, healthLatenciesMs: [...Array(90).fill(30), ...Array(10).fill(1000)] }).pass, false);
    assert.equal(evaluateTrim({ ...good, healthLatenciesMs: [] }).pass, false);
    assert.equal(evaluateTrim({ ...good, restarts: 1 }).pass, false);
    assert.equal(evaluateTrim({ ...good, oomKilled: ['w'] }).pass, false);
    assert.equal(evaluateTrim({ ...good, trimOk: false }).pass, false);
    assert.equal(evaluateTrim({ ...good, healthErrors: 2 }).pass, false);
  });
});

describe('che bí mật', () => {
  it('che giá trị, webhook Discord, Bearer và apiKey', () => {
    const s = maskSecrets(
      'key=abcd1234efgh url=https://discord.com/api/webhooks/123/tok-en Authorization: Bearer eyJ.a.b {"apiKey":"zzz999"}',
      ['abcd1234efgh'],
    );
    assert.ok(!s.includes('abcd1234efgh'));
    assert.ok(!s.includes('discord.com/api/webhooks'));
    assert.ok(!s.includes('eyJ.a.b'));
    assert.ok(!s.includes('zzz999'));
    assert.match(s, /Bearer \*\*\*/);
  });
  it('bỏ qua giá trị quá ngắn', () => {
    assert.equal(maskSecrets('abc def', ['ab', undefined, '']), 'abc def');
  });
});

describe('lỗi kỹ thuật', () => {
  it('lý do người dùng/nội dung không tính', () => {
    assert.equal(isTechnicalFailure('succeeded', null), false);
    assert.equal(isTechnicalFailure('failed', 'NO_FACE'), false);
    assert.equal(isTechnicalFailure('failed', 'CONTENT_BLOCKED'), false);
    assert.equal(isTechnicalFailure('failed', 'RH_ERROR'), true);
    assert.equal(isTechnicalFailure('timed_out', 'RH_TIMEOUT'), true);
    assert.equal(isTechnicalFailure('failed', 'RH_BUDGET'), true);
  });
});

describe('manifest', () => {
  const example = JSON.parse(fs.readFileSync(path.join(here, 'benchmark-manifest.example.json'), 'utf8'));
  it('mẫu ví dụ hợp lệ: 20 mẫu đúng phân bổ + 2 mẫu nhạy cảm', () => {
    const r = validateManifest(example, { baseDir: '/srv', repoRoot });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.samples.length, 20);
    assert.equal(r.sensitive.length, 2);
  });
  it('từ chối file trong repo, thiếu trường, sai số mẫu', () => {
    const r = validateManifest(
      { samples: [{ id: 'x', pipeline: 'face_swap', source: 'a.jpg', target: 'b.txt' }, { pipeline: 'nope' }] },
      { baseDir: repoRoot, repoRoot },
    );
    assert.ok(r.errors.some((e) => e.includes('nằm trong repo')));
    assert.ok(r.errors.some((e) => e.includes('"target" phải là ảnh')));
    assert.ok(r.errors.some((e) => e.includes('pipeline phải là')));
    assert.ok(r.errors.some((e) => e.includes('Cần đúng 20')));
  });
  it('motion cắt dưới 3 giây là lỗi; lệch phân bổ chỉ cảnh báo', () => {
    const samples = example.samples.filter((s) => !s.sensitive).map((s) => ({ ...s }));
    samples[10].trimEnd = 2;
    samples[5].intensity = 9;
    const r = validateManifest({ samples }, { baseDir: '/srv', repoRoot });
    assert.ok(r.errors.some((e) => e.includes('tối thiểu 3 giây')));
    assert.ok(r.warnings.some((w) => w.includes('intensity')));
  });
  it('isInsideDir', () => {
    assert.equal(isInsideDir('/a/b/c', '/a/b'), true);
    assert.equal(isInsideDir('/a/bc', '/a/b'), false);
  });
});

describe('benchmark', () => {
  const motion = { id: 'm1', pipeline: 'motion_control', seconds: 10, sensitive: false };
  it('số liệu một lượt Motion', () => {
    const r = sampleMetrics(
      motion,
      { id: 't1', status: 'succeeded', reasonCode: null },
      { gpuCoins: 80, runningAt: '2026-11-12T00:00:00Z', finishedAt: '2026-11-12T00:01:30Z', outputSeconds: 10.3 },
    );
    assert.equal(r.gpuSeconds, 200);
    assert.equal(r.gpuSecondsPerVideoSecond, 20);
    assert.equal(r.processingSeconds, 90);
    assert.equal(r.durationErrorSeconds, 0.3);
    assert.equal(r.durationOk, true);
    assert.equal(r.technicalFailure, false);
  });
  it('clip ≥ 15 s cần xem thủ công; Face Swap ghi SLA', () => {
    assert.equal(sampleMetrics({ ...motion, seconds: 15 }, { status: 'succeeded' }, {}).manualReviewSecondHalf, 'CHƯA XEM');
    const f = sampleMetrics(
      { id: 'f', pipeline: 'face_swap' },
      { id: 't', status: 'succeeded' },
      { queuedAt: '2026-11-12T00:00:00Z', finishedAt: '2026-11-12T00:01:05Z' },
    );
    assert.equal(f.withinSla, false);
  });
  const margins = (rate) =>
    ['face_swap', 'body_retouch', 'motion_control'].flatMap((p) => [
      { pipeline: p, pack: 'creator', scenario: 'retail', marginRate: rate },
      { pipeline: p, pack: 'creator', scenario: 'standardPack', marginRate: 0.99 },
    ]);
  const ok = (id) => ({ id, sensitive: false, technicalFailure: false, durationOk: true });
  it('đạt khi biên Creator nạp lẻ ≥ 70% mọi pipeline và 0% lỗi kỹ thuật', () => {
    const v = evaluateBenchmark([ok('a'), ok('b')], { margins: margins(0.72) });
    assert.equal(v.pass, true);
    assert.equal(v.technicalFailureRate, 0);
  });
  it('biên đúng 70% vẫn đạt, dưới 70% không đạt', () => {
    assert.equal(evaluateBenchmark([ok('a')], { margins: margins(0.7) }).pass, true);
    assert.equal(evaluateBenchmark([ok('a')], { margins: margins(0.69) }).pass, false);
  });
  it('thiếu pipeline trong stats, có lỗi kỹ thuật, lệch độ dài -> không đạt', () => {
    assert.equal(evaluateBenchmark([ok('a')], { margins: margins(0.8).slice(0, 2) }).pass, false);
    assert.equal(evaluateBenchmark([ok('a'), { ...ok('b'), technicalFailure: true }], { margins: margins(0.8) }).pass, false);
    assert.equal(evaluateBenchmark([{ ...ok('a'), durationOk: false }], { margins: margins(0.8) }).pass, false);
    assert.equal(evaluateBenchmark([ok('a')], null).pass, false);
  });
  it('Motion thành công nhưng không đo được độ dài -> không đạt', () => {
    const v = evaluateBenchmark(
      [ok('a'), { id: 'm', pipeline: 'motion_control', status: 'succeeded', sensitive: false, technicalFailure: false, durationOk: null }],
      { margins: margins(0.8) },
    );
    assert.equal(v.pass, false);
    assert.deepEqual(v.durationUnmeasured, ['m']);
  });
  it('lỗi bộ chạy không tính là lỗi kỹ thuật nhưng được liệt kê', () => {
    const r = sampleMetrics({ id: 'h', pipeline: 'face_swap' }, { id: 't', status: null }, { harnessError: true });
    assert.equal(r.technicalFailure, false);
    assert.equal(r.harnessError, true);
    const v = evaluateBenchmark([ok('a'), r], { margins: margins(0.8) });
    assert.equal(v.technicalFailures, 0);
    assert.deepEqual(v.harnessErrors, ['h']);
  });
  it('mẫu nhạy cảm không tính; SLA chỉ ghi nhận', () => {
    const v = evaluateBenchmark(
      [ok('a'), { id: 's', sensitive: true, technicalFailure: true }, { ...ok('f'), withinSla: false }],
      { margins: margins(0.8) },
    );
    assert.equal(v.pass, true);
    assert.equal(v.countedSamples, 2);
    assert.deepEqual(v.faceSwapSlaExceeded, ['f']);
  });
  it('ngưỡng ghi đè được', () => {
    const t = { ...DEFAULT_THRESHOLDS, minCreatorMargin: 0.6 };
    assert.equal(evaluateBenchmark([ok('a')], { margins: margins(0.65) }, t).pass, true);
  });
});

describe('tiện ích', () => {
  it('lastJsonLine bỏ qua log', () => {
    assert.deepEqual(lastJsonLine('log\n{"a":1}\nkhác\n{"b":2}\n'), { b: 2 });
    assert.equal(lastJsonLine('không có json'), null);
  });
  it('extractRawFailure', () => {
    const lines = extractRawFailure('x\nTask t1: RunningHub báo FAILED: NSFW blocked\nTask t2: RunningHub báo FAILED: y', 't1');
    assert.deepEqual(lines, ['Task t1: RunningHub báo FAILED: NSFW blocked']);
  });
});

describe('script và bí mật', () => {
  it('step1 không có env thoát 2 kèm thông báo tiếng Việt', () => {
    const env = { PATH: process.env.PATH };
    const r = spawnSync(process.execPath, [path.join(here, 'step1-discord.mjs')], { env, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Thiếu biến môi trường DISCORD_WEBHOOK_URL/);
    assert.equal(JSON.parse(r.stdout.trim()).exitCode, 2);
  });
  it('step3 thiếu env thoát 2; step4 thiếu --manifest thoát 2', () => {
    const env = { PATH: process.env.PATH };
    assert.equal(spawnSync(process.execPath, [path.join(here, 'step3-runninghub.mjs')], { env }).status, 2);
    assert.equal(spawnSync(process.execPath, [path.join(here, 'step4-benchmark.mjs')], { env }).status, 2);
  });
  it('step2 clip không tồn tại thoát 2', () => {
    const env = { PATH: process.env.PATH };
    assert.equal(spawnSync(process.execPath, [path.join(here, 'step2-ffmpeg.mjs'), '/khong/ton/tai.mp4'], { env }).status, 2);
  });
  it('step4 manifest hợp lệ: thiếu PRELAUNCH_ADMIN_JWT thoát 2; --sensitive không đòi ADMIN_JWT', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvis-prelaunch-test-'));
    try {
      const example = JSON.parse(fs.readFileSync(path.join(here, 'benchmark-manifest.example.json'), 'utf8'));
      const samples = example.samples.map((s) => {
        const out = { ...s };
        for (const f of ['source', 'target', 'image', 'character', 'video']) {
          if (typeof s[f] === 'string') {
            out[f] = `${s.id}-${f}${path.extname(s[f])}`;
            fs.writeFileSync(path.join(dir, out[f]), '');
          }
        }
        return out;
      });
      const manifest = path.join(dir, 'manifest.json');
      fs.writeFileSync(manifest, JSON.stringify({ samples }));
      const script = path.join(here, 'step4-benchmark.mjs');
      const r = spawnSync(process.execPath, [script, '--manifest', manifest], {
        env: { PATH: process.env.PATH, PRELAUNCH_API_URL: 'http://127.0.0.1:9', PRELAUNCH_BENCH_JWT: 'x' },
        encoding: 'utf8',
      });
      assert.equal(r.status, 2);
      assert.match(r.stderr, /Thiếu biến môi trường: .*PRELAUNCH_ADMIN_JWT/);
      const s = spawnSync(process.execPath, [script, '--manifest', manifest, '--sensitive'], {
        env: { PATH: process.env.PATH, PRELAUNCH_API_URL: 'khong-phai-url', PRELAUNCH_BENCH_JWT: 'x' },
        encoding: 'utf8',
      });
      assert.equal(s.status, 2);
      assert.doesNotMatch(s.stderr, /PRELAUNCH_ADMIN_JWT/);
      assert.match(s.stderr, /PRELAUNCH_API_URL không hợp lệ/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('không script nào chứa webhook, Bearer token hay khóa thật', () => {
    const files = [
      ...fs.readdirSync(here).map((f) => path.join(here, f)),
      ...['prelaunch-notify', 'prelaunch-trim', 'prelaunch-rh-probe', 'prelaunch-task-metrics', 'backup-now'].map((n) =>
        path.join(repoRoot, 'apps', 'api', 'src', 'scripts', `${n}.ts`),
      ),
    ].filter((f) => !f.endsWith('lib.test.mjs'));
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /discord(?:app)?\.com\/api\/webhooks\/\d+/i, f);
      assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9._-]{20,}/, f);
      assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, f);
      assert.doesNotMatch(text, /postgres(?:ql)?:\/\/[^$\s'"`]+:[^@\s'"`]+@/, f);
    }
  });
  it('git không theo dõi ảnh/video mẫu trong scripts/prelaunch', () => {
    let out = '';
    try {
      out = execFileSync('git', ['ls-files', 'scripts/prelaunch'], { cwd: repoRoot, encoding: 'utf8' });
    } catch {
      return; // không có git
    }
    assert.doesNotMatch(out, /\.(jpe?g|png|webp|mp4|mov)$/im);
  });
});
