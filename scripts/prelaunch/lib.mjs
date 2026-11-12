// Hàm thuần cho các script cổng trước khi bật VietQR thương mại (Story 6.11).
// Không đọc file, không gọi mạng, không đọc process.env trực tiếp: mọi giá trị truyền vào qua tham số.
import path from 'node:path';

/** Mã thoát chung: 0 = đạt, 1 = không đạt, 2 = lỗi chạy (thiếu biến, thiếu file, lệnh lỗi). */
export const EXIT_PASS = 0;
export const EXIT_FAIL = 1;
export const EXIT_ERROR = 2;

/**
 * Lý do do người dùng/nội dung: không tính là lỗi kỹ thuật của benchmark. Cổng benchmark cố ý chặt hơn ngắt mạch
 * (SYSTEM_FAILURE_REASONS trong tasks.service.ts): RH_BUDGET và RH_GATE_TIMEOUT ở đây TÍNH là lỗi kỹ thuật.
 */
export const NON_TECHNICAL_REASONS = Object.freeze([
  'NO_POSE',
  'NO_FACE',
  'CONTENT_BLOCKED',
  'USER_CANCEL',
  'FREE_WAIT_EXPIRED',
]);

export const TERMINAL_STATUSES = Object.freeze(['succeeded', 'failed', 'timed_out', 'cancelled']);

/** Ngưỡng mặc định `[ASSUMPTION]` của epic; ghi đè bằng biến môi trường PRELAUNCH_*. */
export const DEFAULT_THRESHOLDS = Object.freeze({
  discordMaxMs: 10_000,
  trimMaxSeconds: 60,
  healthP95MaxMs: 1000,
  minCreatorMargin: 0.7,
  coinsPerGpuSecond: 0.4,
  durationToleranceSeconds: 0.5,
  faceSwapSlaSeconds: 60,
  benchmarkSampleCount: 20,
  bodyIntensities: Object.freeze([3, 3, 5, 5, 8]),
  motionSeconds: Object.freeze([3, 3, 5, 5, 5, 10, 10, 15, 15, 20]),
  faceSwapCount: 5,
});

const NUMERIC_ENV = {
  discordMaxMs: 'PRELAUNCH_DISCORD_MAX_MS',
  trimMaxSeconds: 'PRELAUNCH_TRIM_MAX_SECONDS',
  healthP95MaxMs: 'PRELAUNCH_HEALTH_P95_MAX_MS',
  minCreatorMargin: 'PRELAUNCH_MIN_CREATOR_MARGIN',
  coinsPerGpuSecond: 'PRELAUNCH_COINS_PER_GPU_SECOND',
  durationToleranceSeconds: 'PRELAUNCH_DURATION_TOLERANCE',
  faceSwapSlaSeconds: 'PRELAUNCH_FACESWAP_SLA_SECONDS',
  benchmarkSampleCount: 'PRELAUNCH_BENCHMARK_SAMPLES',
};

function parseIntList(raw) {
  const list = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  return list.length > 0 && list.every((n) => Number.isInteger(n) && n > 0) ? list : null;
}

/** Đọc ngưỡng từ env (đối tượng truyền vào). Giá trị sai định dạng bị bỏ qua và ghi vào `invalid`. */
export function readThresholds(env = {}) {
  const t = { ...DEFAULT_THRESHOLDS };
  const invalid = [];
  for (const [key, name] of Object.entries(NUMERIC_ENV)) {
    const raw = env[name];
    if (raw == null || String(raw).trim() === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) t[key] = n;
    else invalid.push(name);
  }
  for (const [key, name] of [
    ['bodyIntensities', 'PRELAUNCH_BODY_INTENSITIES'],
    ['motionSeconds', 'PRELAUNCH_MOTION_SECONDS'],
  ]) {
    const raw = env[name];
    if (raw == null || String(raw).trim() === '') continue;
    const list = parseIntList(raw);
    if (list) t[key] = list;
    else invalid.push(name);
  }
  return { thresholds: t, invalid };
}

/** Tên biến môi trường còn thiếu (rỗng hoặc chỉ khoảng trắng). */
export function missingEnv(names, env = {}) {
  return names.filter((n) => env[n] == null || String(env[n]).trim() === '');
}

/** URL http(s) hợp lệ hay không. */
export function isHttpUrl(raw) {
  try {
    const u = new URL(String(raw ?? '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Phân vị theo hạng gần nhất (nearest-rank). Mảng rỗng trả null. */
export function percentile(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (!(p > 0 && p <= 100)) throw new RangeError('p phải trong (0, 100]');
  const rank = Math.ceil((p / 100) * xs.length);
  return xs[Math.min(xs.length, Math.max(1, rank)) - 1];
}

/** Giây GPU suy ra từ coin RunningHub (mặc định 0,4 coin/giây). */
export function gpuSecondsFromCoins(coins, coinsPerSecond = DEFAULT_THRESHOLDS.coinsPerGpuSecond) {
  if (!Number.isFinite(coins) || coins < 0 || !(coinsPerSecond > 0)) return null;
  return coins / coinsPerSecond;
}

/** Sai số độ dài video so với đoạn đã cắt; null khi thiếu số liệu. */
export function durationError(actualSeconds, expectedSeconds) {
  if (!Number.isFinite(actualSeconds) || !Number.isFinite(expectedSeconds)) return null;
  return Math.round((actualSeconds - expectedSeconds) * 1000) / 1000;
}

export function withinTolerance(error, tolerance = DEFAULT_THRESHOLDS.durationToleranceSeconds) {
  return error != null && Math.abs(error) <= tolerance;
}

/** Số giây giữa hai mốc ISO; null khi thiếu. */
export function secondsBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round(b - a) / 1000;
}

/** "12.34%" -> 12.34; không đọc được -> null. */
export function parseDockerPercent(raw) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/.exec(String(raw ?? ''));
  return m ? Number(m[1]) : null;
}

const SIZE_UNITS = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/** "1.5GiB" / "512MB" / "0B" -> số byte; không đọc được -> null. */
export function parseDockerSize(raw) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kKmMgGtT]?i?[bB])\s*$/.exec(String(raw ?? ''));
  if (!m) return null;
  const unit = SIZE_UNITS[m[2].toLowerCase()];
  return unit ? Math.round(Number(m[1]) * unit) : null;
}

/** "100MiB / 2GiB" -> byte đang dùng. */
export function parseMemUsage(raw) {
  return parseDockerSize(String(raw ?? '').split('/')[0]);
}

/** Gộp mẫu `docker stats` (mỗi mẫu là mảng dòng JSON đã parse) thành CPU/RAM cao nhất theo container. */
export function summarizeDockerStats(samples) {
  const out = {};
  for (const sample of samples) {
    for (const row of sample) {
      const name = String(row?.Name ?? row?.Container ?? '').trim();
      if (!name) continue;
      const cpu = parseDockerPercent(row.CPUPerc);
      const mem = parseMemUsage(row.MemUsage);
      const cur = (out[name] ??= { maxCpuPercent: null, maxMemBytes: null });
      if (cpu != null && (cur.maxCpuPercent == null || cpu > cur.maxCpuPercent)) cur.maxCpuPercent = cpu;
      if (mem != null && (cur.maxMemBytes == null || mem > cur.maxMemBytes)) cur.maxMemBytes = mem;
    }
  }
  return out;
}

/** Định dạng docker inspect: tên, RestartCount, OOMKilled, StartedAt. */
export const INSPECT_FORMAT = '{{.Name}} {{.RestartCount}} {{.State.OOMKilled}} {{.State.StartedAt}}';

/** Dòng theo INSPECT_FORMAT -> bản ghi theo tên container. */
export function parseInspectLines(text) {
  const out = {};
  for (const line of String(text ?? '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const name = parts[0].replace(/^\//, '');
    out[name] = { restartCount: Number(parts[1]), oomKilled: parts[2] === 'true', startedAt: parts[3] ?? null };
  }
  return out;
}

/**
 * Khởi động lại và OOM phát sinh giữa hai lần inspect. Khởi động lại = RestartCount tăng, StartedAt đổi
 * (container bị tạo lại/khởi động lại thủ công) hoặc container biến mất. OOM chỉ tính khi chuyển từ false
 * sang true, hoặc khi container khởi động lại và lần chạy mới bị OOM (cờ cũ còn true từ trước không tính).
 */
export function diffInspect(before, after) {
  let restarts = 0;
  const oomKilled = [];
  for (const [name, a] of Object.entries(after)) {
    const b = before[name];
    if (!b) {
      restarts += 1; // container mới xuất hiện: đã bị tạo lại
      if (a.oomKilled) oomKilled.push(name);
      continue;
    }
    const delta = a.restartCount - b.restartCount;
    const restarted = (Number.isFinite(delta) && delta > 0) || (a.startedAt != null && b.startedAt != null && a.startedAt !== b.startedAt);
    if (restarted) restarts += Number.isFinite(delta) && delta > 0 ? delta : 1;
    if (a.oomKilled && (!b.oomKilled || restarted)) oomKilled.push(name);
  }
  for (const name of Object.keys(before)) {
    if (!after[name]) restarts += 1; // container biến mất giữa chừng: coi như khởi động lại
  }
  return { restarts, oomKilled };
}

/** Bước 1: đạt khi gửi được và độ trễ không quá ngưỡng. */
export function evaluateDiscord(result, thresholds = DEFAULT_THRESHOLDS) {
  const ok = result?.ok === true && Number.isFinite(result.latencyMs);
  return { pass: ok && result.latencyMs <= thresholds.discordMaxMs, maxMs: thresholds.discordMaxMs };
}

/** Bước 2: cắt ≤ ngưỡng, /health p95 < ngưỡng, không lỗi /health, 0 restart, 0 OOM, file cắt hợp lệ. */
export function evaluateTrim(m, thresholds = DEFAULT_THRESHOLDS) {
  const healthP95Ms = percentile(m.healthLatenciesMs ?? [], 95);
  const checks = {
    trimOk: m.trimOk === true,
    trimWithinLimit: Number.isFinite(m.trimMs) && m.trimMs <= thresholds.trimMaxSeconds * 1000,
    healthP95BelowLimit: healthP95Ms != null && healthP95Ms < thresholds.healthP95MaxMs,
    healthNoErrors: (m.healthErrors ?? 0) === 0,
    noRestart: (m.restarts ?? 0) === 0,
    noOom: (m.oomKilled ?? []).length === 0,
  };
  return { pass: Object.values(checks).every(Boolean), healthP95Ms, checks };
}

/** Lỗi kỹ thuật: Task kết thúc không thành công vì lý do không thuộc người dùng/nội dung. */
export function isTechnicalFailure(status, reasonCode) {
  if (status === 'succeeded') return false;
  return !NON_TECHNICAL_REASONS.includes(reasonCode);
}

/** Che các giá trị bí mật trong chuỗi (giá trị ngắn hơn 4 ký tự bị bỏ qua để tránh che nhầm). */
export function maskSecrets(text, secrets = []) {
  let s = String(text ?? '');
  const list = secrets
    .filter((v) => typeof v === 'string' && v.trim().length >= 4)
    .map((v) => v.trim())
    .sort((a, b) => b.length - a.length);
  for (const v of list) s = s.split(v).join('***');
  s = s.replace(/https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'<>]+/gi, '***');
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1***');
  s = s.replace(/("?apiKey"?\s*[:=]\s*"?)[^"\s,}&]+/gi, '$1***');
  return s;
}

/** Child nằm trong (hoặc trùng) thư mục parent. */
export function isInsideDir(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

export function mimeFromPath(file) {
  return MIME_BY_EXT[path.extname(String(file)).toLowerCase()] ?? null;
}

const FILE_FIELDS = {
  face_swap: ['source', 'target'],
  body_retouch: ['image'],
  motion_control: ['character', 'video'],
};

function sameMultiset(a, b) {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Kiểm tra manifest benchmark. `errors` chặn chạy; `warnings` chỉ báo lệch so với phân bổ mặc định.
 * Đường dẫn file được giải theo `baseDir`; file nằm trong `repoRoot` là lỗi (không commit mẫu vào repo).
 */
export function validateManifest(manifest, { baseDir, repoRoot, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const errors = [];
  const warnings = [];
  const samples = [];
  const sensitive = [];
  const list = Array.isArray(manifest?.samples) ? manifest.samples : null;
  if (!list) return { errors: ['Manifest thiếu mảng "samples".'], warnings, samples, sensitive };

  list.forEach((raw, i) => {
    const label = `samples[${i}]${raw?.id ? ` (${raw.id})` : ''}`;
    const pipeline = raw?.pipeline;
    const fields = FILE_FIELDS[pipeline];
    if (!fields) {
      errors.push(`${label}: pipeline phải là face_swap, body_retouch hoặc motion_control.`);
      return;
    }
    const files = {};
    for (const f of fields) {
      const v = raw[f];
      if (typeof v !== 'string' || v.trim() === '') {
        errors.push(`${label}: thiếu đường dẫn "${f}".`);
        continue;
      }
      const abs = baseDir ? path.resolve(baseDir, v) : v;
      if (repoRoot && isInsideDir(abs, repoRoot)) errors.push(`${label}: "${f}" nằm trong repo, hãy để mẫu ngoài repo.`);
      const mime = mimeFromPath(abs);
      const wantVideo = f === 'video';
      if (!mime || mime.startsWith('video/') !== wantVideo) {
        errors.push(`${label}: "${f}" phải là ${wantVideo ? 'video .mp4/.mov' : 'ảnh .jpg/.png/.webp'}.`);
      }
      files[f] = abs;
    }
    const sample = { index: i, id: String(raw.id ?? `sample-${i + 1}`), pipeline, files, sensitive: raw.sensitive === true };
    if (pipeline === 'body_retouch') {
      const n = raw.intensity ?? 5;
      if (!Number.isInteger(n) || n < 1 || n > 10) errors.push(`${label}: intensity phải là số nguyên 1-10.`);
      sample.intensity = n;
    }
    if (pipeline === 'motion_control') {
      const { trimStart, trimEnd } = raw;
      if (!Number.isInteger(trimStart) || !Number.isInteger(trimEnd) || trimStart < 0 || trimEnd - trimStart < 3) {
        errors.push(`${label}: trimStart/trimEnd phải là số nguyên giây, đoạn cắt tối thiểu 3 giây.`);
      }
      sample.trimStart = trimStart;
      sample.trimEnd = trimEnd;
      sample.seconds = Number.isInteger(trimEnd) && Number.isInteger(trimStart) ? trimEnd - trimStart : null;
      if (raw.aspectRatio != null) sample.aspectRatio = raw.aspectRatio;
      if (raw.prompt != null) sample.prompt = raw.prompt;
    }
    (sample.sensitive ? sensitive : samples).push(sample);
  });

  if (samples.length !== thresholds.benchmarkSampleCount) {
    errors.push(`Cần đúng ${thresholds.benchmarkSampleCount} mẫu không nhạy cảm, đang có ${samples.length}.`);
  }
  const ids = new Set();
  for (const s of [...samples, ...sensitive]) {
    if (ids.has(s.id)) errors.push(`id trùng: ${s.id}.`);
    ids.add(s.id);
  }
  const by = (p) => samples.filter((s) => s.pipeline === p);
  if (by('face_swap').length !== thresholds.faceSwapCount) {
    warnings.push(`Face Swap: ${by('face_swap').length} mẫu (mặc định ${thresholds.faceSwapCount}).`);
  }
  const intensities = by('body_retouch').map((s) => s.intensity);
  if (!sameMultiset(intensities, thresholds.bodyIntensities)) {
    warnings.push(`Body Retouch intensity ${intensities.join(',') || '(trống)'} khác mặc định ${thresholds.bodyIntensities.join(',')}.`);
  }
  const secs = by('motion_control').map((s) => s.seconds);
  if (!sameMultiset(secs, thresholds.motionSeconds)) {
    warnings.push(`Motion số giây ${secs.join(',') || '(trống)'} khác mặc định ${thresholds.motionSeconds.join(',')}.`);
  }
  if (sensitive.length > 0 && !sensitive.some((s) => s.pipeline === 'body_retouch')) {
    warnings.push('Nên có ít nhất một mẫu nhạy cảm chạy qua Body Retouch.');
  }
  return { errors, warnings, samples, sensitive };
}

/** Số liệu một lượt benchmark từ Task kết thúc + chỉ số đo (gpu_coins, mốc thời gian, độ dài thật). */
export function sampleMetrics(sample, task, metrics, thresholds = DEFAULT_THRESHOLDS) {
  const coins = metrics?.gpuCoins ?? null;
  const gpuSeconds = coins == null ? null : gpuSecondsFromCoins(coins, thresholds.coinsPerGpuSecond);
  const processingSeconds = secondsBetween(metrics?.runningAt, metrics?.finishedAt);
  const totalSeconds = secondsBetween(metrics?.queuedAt, metrics?.finishedAt);
  const out = {
    id: sample.id,
    pipeline: sample.pipeline,
    sensitive: sample.sensitive === true,
    taskId: task?.id ?? null,
    status: task?.status ?? null,
    reasonCode: task?.reasonCode ?? null,
    gpuCoins: coins,
    gpuSeconds,
    processingSeconds,
    totalSeconds,
    // Lỗi của bộ chạy (HTTP 401, PUT lỗi, poll lỗi) không phải trạng thái Task: không tính là lỗi kỹ thuật,
    // nhưng làm bước 4 thoát 2 (lỗi chạy).
    harnessError: metrics?.harnessError === true,
    technicalFailure:
      metrics?.harnessError === true ? false : task ? isTechnicalFailure(task.status, task.reasonCode) : true,
  };
  if (sample.pipeline === 'body_retouch') out.intensity = sample.intensity;
  if (sample.pipeline === 'motion_control') {
    out.trimSeconds = sample.seconds;
    out.gpuSecondsPerVideoSecond =
      gpuSeconds != null && sample.seconds > 0 ? Math.round((gpuSeconds / sample.seconds) * 1000) / 1000 : null;
    out.outputSeconds = metrics?.outputSeconds ?? null;
    out.durationErrorSeconds = durationError(out.outputSeconds, sample.seconds);
    out.durationOk =
      out.durationErrorSeconds == null ? null : withinTolerance(out.durationErrorSeconds, thresholds.durationToleranceSeconds);
    if (sample.seconds >= 15) out.manualReviewSecondHalf = 'CHƯA XEM';
  }
  if (sample.pipeline === 'face_swap') {
    out.withinSla = totalSeconds == null ? null : totalSeconds <= thresholds.faceSwapSlaSeconds;
  }
  return out;
}

/**
 * Điều kiện thông qua (PRD §12): biên gộp Creator kịch bản nạp lẻ ≥ ngưỡng ở mọi pipeline (đọc từ
 * /admin/stats scope=benchmark) và 0% lỗi kỹ thuật trên các mẫu không nhạy cảm. SLA Face Swap chỉ ghi nhận.
 */
export function evaluateBenchmark(results, stats, thresholds = DEFAULT_THRESHOLDS, pipelines = ['face_swap', 'body_retouch', 'motion_control']) {
  const counted = results.filter((r) => !r.sensitive);
  const technicalFailures = counted.filter((r) => r.technicalFailure).length;
  const technicalFailureRate = counted.length === 0 ? null : technicalFailures / counted.length;
  const margins = Array.isArray(stats?.margins) ? stats.margins : [];
  const creatorMargins = pipelines.map((pipeline) => {
    const m = margins.find((x) => x.pipeline === pipeline && x.pack === 'creator' && x.scenario === 'retail');
    const marginRate = m?.marginRate ?? null;
    return { pipeline, marginRate, pass: marginRate != null && marginRate >= thresholds.minCreatorMargin };
  });
  const durationFailures = counted.filter((r) => r.durationOk === false).map((r) => r.id);
  // Motion thành công nhưng không đo được độ dài (thiếu ffprobe, tải lỗi): không được coi là đạt.
  const durationUnmeasured = counted
    .filter((r) => r.pipeline === 'motion_control' && r.status === 'succeeded' && r.durationOk == null)
    .map((r) => r.id);
  const harnessErrors = counted.filter((r) => r.harnessError).map((r) => r.id);
  const slaExceeded = counted.filter((r) => r.withinSla === false).map((r) => r.id);
  const checks = {
    creatorMarginAllPipelines: creatorMargins.every((m) => m.pass),
    zeroTechnicalFailures: counted.length > 0 && technicalFailures === 0,
    durationWithinTolerance: durationFailures.length === 0 && durationUnmeasured.length === 0,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    minCreatorMargin: thresholds.minCreatorMargin,
    creatorMargins,
    countedSamples: counted.length,
    technicalFailures,
    technicalFailureRate,
    durationFailures,
    durationUnmeasured,
    harnessErrors,
    faceSwapSlaExceeded: slaExceeded,
    manualReviewPending: counted.filter((r) => r.manualReviewSecondHalf).map((r) => r.id),
  };
}

/** Tách chuỗi lệnh compose (ví dụ "docker compose -f deploy/compose.yml") thành [cmd, ...args]. */
export function splitCommand(raw) {
  const parts = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length === 0 ? null : parts;
}

/** Lấy dòng JSON cuối cùng parse được từ stdout của CLI. */
export function lastJsonLine(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines[i]);
      if (v && typeof v === 'object') return v;
    } catch {
      // dòng log không phải JSON
    }
  }
  return null;
}

/** Lọc dòng log worker chứa lỗi RunningHub thô của một Task. */
export function extractRawFailure(logText, taskId) {
  return String(logText ?? '')
    .split('\n')
    .filter((l) => l.includes(taskId) && /RunningHub báo|FAILED|errorCode/i.test(l))
    .map((l) => l.trim());
}
