import {
  RunningHubError,
  RunningHubNetworkError,
  type RunningHubNodeInfo,
  type RunningHubOutputs,
  type RunningHubPort,
  type RunningHubRunMode,
} from '../../ports/index.js';

export const RUNNINGHUB_DEFAULT_HOST = 'https://www.runninghub.ai';

const CODE_OK = 0;

/**
 * Mã lỗi tạm thời theo bảng "API Error Code Reference": máy chủ bận hoặc giới hạn tần suất.
 * 415 hết instance riêng, 421 hết hạn mức đồng thời, 1000/500/1005 lỗi máy chủ, 1003 giới hạn tần suất.
 * RunningHub từ chối trước khi tạo task nên thử lại an toàn.
 */
const TRANSIENT_CODES = new Set([415, 421, 500, 1000, 1003, 1005]);

/** Lỗi kết nối xảy ra trước khi byte nào được gửi đi: an toàn để thử lại. */
const PRE_SEND_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** Phong bì chung: upload dùng `{code,msg,data}`; v2 (run/ai-app, query) dùng `{taskId,status,errorCode,errorMessage,results}`. */
interface Envelope {
  readonly code?: unknown;
  readonly msg?: unknown;
  readonly data?: unknown;
  readonly taskId?: unknown;
  readonly status?: unknown;
  readonly errorCode?: unknown;
  readonly errorMessage?: unknown;
  readonly results?: unknown;
  readonly failedReason?: unknown;
}

/** v2 trả HTTP 200 kèm `errorCode` (chuỗi) khi lỗi; rỗng hoặc '0' nghĩa là không lỗi. */
function v2ErrorCode(env: Envelope): string | null {
  const c = env.errorCode;
  const s = typeof c === 'number' ? String(c) : typeof c === 'string' ? c.trim() : '';
  return s && s !== '0' ? s : null;
}

/** `fetch` bọc lỗi socket trong `cause`; khi thử nhiều địa chỉ (IPv4/IPv6) `cause` là AggregateError có `errors[]`. */
function requestMaybeSent(err: unknown): boolean {
  const cause = (err as { cause?: { code?: unknown; errors?: unknown } })?.cause;
  const codes: unknown[] = [cause?.code];
  if (Array.isArray(cause?.errors)) {
    for (const e of cause.errors as Array<{ code?: unknown }>) codes.push(e?.code);
  }
  const known = codes.filter((c): c is string => typeof c === 'string');
  return !(known.length > 0 && known.every((c) => PRE_SEND_ERROR_CODES.has(c)));
}

/** `taskId` là int64 (> 2^53): bọc thành chuỗi trước khi JSON.parse để không mất chữ số cuối. */
function parseEnvelope(text: string): Envelope | null {
  const safe = text.replace(/("taskId"\s*:\s*)(\d{15,})/g, '$1"$2"');
  try {
    const v: unknown = JSON.parse(safe);
    return v && typeof v === 'object' ? (v as Envelope) : null;
  } catch {
    return null;
  }
}

/** RunningHub suy loại file từ đuôi tên; worker đặt tên không có đuôi nên thêm theo magic bytes. */
export function withImageExtension(name: string, bytes: Buffer): string {
  if (/\.[A-Za-z0-9]{2,5}$/.test(name)) return name;
  if (bytes.length >= 8 && bytes.subarray(0, 4).toString('hex') === '89504e47') return `${name}.png`;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return `${name}.jpg`;
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return `${name}.webp`;
  }
  return name;
}

function isTransientCode(code: unknown): boolean {
  const n = typeof code === 'string' ? Number(code) : code;
  return typeof n === 'number' && TRANSIENT_CODES.has(n);
}

function v2FailureMessage(env: Envelope): string {
  const reason = env.failedReason as { exception_message?: unknown } | null | undefined;
  if (typeof reason?.exception_message === 'string' && reason.exception_message.trim()) {
    return reason.exception_message.trim();
  }
  return typeof env.errorMessage === 'string' && env.errorMessage.trim()
    ? env.errorMessage.trim()
    : 'RunningHub báo task thất bại';
}

/**
 * Adapter RunningHub thật (nền tảng .ai): upload qua `/task/openapi/upload` (trả `fileName` cho node LoadImage),
 * chạy AI App qua `/openapi/v2/run/ai-app/{appId}` và truy vấn qua `/openapi/v2/query`.
 * Gửi `Authorization: Bearer`; upload còn kèm `apiKey` trong form. Không bao giờ ghi apiKey vào thông báo lỗi.
 *
 * Phân loại lỗi theo hợp đồng của worker (AD-5/AD-6):
 * - `RunningHubError`: RunningHub từ chối rõ ràng (code khác 0, HTTP 4xx).
 * - `RunningHubNetworkError`: lỗi tạm thời/không rõ (mạng, HTTP 5xx/429, phản hồi không đọc được).
 * - AbortError/TimeoutError được ném nguyên để worker tự phân biệt.
 */
export class RunningHubOpenApiAdapter implements RunningHubPort {
  readonly portName = 'RunningHubPort' as const;
  private readonly host: string;

  constructor(
    private readonly apiKey: string,
    host: string = RUNNINGHUB_DEFAULT_HOST,
  ) {
    if (!apiKey) throw new Error('Thiếu RUNNINGHUB_API_KEY');
    this.host = host.replace(/\/+$/, '');
  }

  private async post(path: string, body: string | FormData, signal: AbortSignal): Promise<Envelope> {
    let res: Response;
    try {
      res = await fetch(`${this.host}${path}`, {
        method: 'POST',
        // Tài liệu .ai đánh dấu Authorization là bắt buộc và vẫn yêu cầu apiKey trong body: gửi cả hai.
        headers:
          typeof body === 'string'
            ? { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }
            : { Authorization: `Bearer ${this.apiKey}` },
        body,
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      const name = (err as { name?: string })?.name ?? 'Error';
      throw new RunningHubNetworkError(`Không gọi được RunningHub (${name})`, requestMaybeSent(err));
    }
    if (res.status >= 500 || res.status === 429) {
      await res.body?.cancel().catch(() => {});
      throw new RunningHubNetworkError(`RunningHub HTTP ${res.status}`, true);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new RunningHubError(`RunningHub HTTP ${res.status}`);
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      if (signal.aborted) throw err;
      throw new RunningHubNetworkError('Không đọc được phản hồi RunningHub', true);
    }
    const env = parseEnvelope(text);
    if (!env) throw new RunningHubNetworkError('Phản hồi RunningHub không phải JSON hợp lệ', true);
    return env;
  }

  async uploadFile(bytes: Buffer, name: string, signal: AbortSignal): Promise<string> {
    const form = new FormData();
    form.set('apiKey', this.apiKey);
    form.set('fileType', 'input');
    form.set('file', new Blob([new Uint8Array(bytes)]), withImageExtension(name, bytes));
    const env = await this.post('/task/openapi/upload', form, signal);
    const fileName = (env.data as { fileName?: unknown } | null | undefined)?.fileName;
    if (isTransientCode(env.code)) {
      throw new RunningHubNetworkError(`RunningHub bận (code ${String(env.code)})`, false);
    }
    if (env.code !== CODE_OK || typeof fileName !== 'string' || !fileName) {
      throw new RunningHubError(`RunningHub từ chối upload (code ${String(env.code)}${typeof env.msg === 'string' && env.msg ? `: ${env.msg}` : ''})`);
    }
    return fileName;
  }

  /**
   * mode 'ai-app' (mặc định): `workflowId` là App ID của AI App (vd. RUNNINGHUB_WORKFLOW_FACESWAP),
   * gọi `POST /openapi/v2/run/ai-app/{appId}`.
   * mode 'workflow': `workflowId` là ID workflow ComfyUI (vd. RUNNINGHUB_WORKFLOW_BODY_RESHAPE),
   * gọi `POST /openapi/v2/run/workflow/{id}`; `addMetadata: false` để kết quả không mang metadata workflow.
   * Cả hai chỉ dùng header Bearer, không có apiKey trong body.
   */
  async submit(
    workflowId: string,
    nodeInfoList: RunningHubNodeInfo[],
    signal: AbortSignal,
    mode: RunningHubRunMode = 'ai-app',
  ): Promise<string> {
    const path =
      mode === 'workflow'
        ? `/openapi/v2/run/workflow/${encodeURIComponent(workflowId)}`
        : `/openapi/v2/run/ai-app/${encodeURIComponent(workflowId)}`;
    const payload =
      mode === 'workflow'
        ? { addMetadata: false, nodeInfoList, instanceType: 'default', usePersonalQueue: 'false' }
        : { nodeInfoList, instanceType: 'default', usePersonalQueue: 'false' };
    const env = await this.post(path, JSON.stringify(payload), signal);
    const err = v2ErrorCode(env);
    // Bận/giới hạn tần suất: task chưa được tạo nên thử lại an toàn (requestSent=false).
    if (err && isTransientCode(err)) {
      throw new RunningHubNetworkError(`RunningHub bận (errorCode ${err})`, false);
    }
    if (err || env.status === 'FAILED') {
      throw new RunningHubError(`RunningHub từ chối task (errorCode ${err ?? 'FAILED'}${typeof env.errorMessage === 'string' && env.errorMessage ? `: ${env.errorMessage}` : ''})`);
    }
    const id = env.taskId;
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id) === '') {
      throw new RunningHubError('Phản hồi submit thiếu taskId');
    }
    return String(id);
  }

  /** `POST /openapi/v2/query`. Trạng thái: QUEUED/RUNNING/SUCCESS/FAILED; lỗi trả HTTP 200 với `status` rỗng và `errorCode`. */
  async outputs(runninghubTaskId: string, signal: AbortSignal): Promise<RunningHubOutputs> {
    const env = await this.post('/openapi/v2/query', JSON.stringify({ taskId: runninghubTaskId }), signal);
    const status = typeof env.status === 'string' ? env.status.trim().toUpperCase() : '';
    const err = v2ErrorCode(env);

    if (status === 'SUCCESS') {
      const results = Array.isArray(env.results) ? (env.results as Array<{ url?: unknown }>) : [];
      const first = results.find((r) => typeof r?.url === 'string' && r.url);
      // SUCCESS mà không có url: worker ghi OUTPUT_UPLOAD_ERROR và hoàn credit.
      return { status: 'SUCCESS', fileUrl: first?.url as string | undefined };
    }
    if (status === 'FAILED') return { status: 'FAILED', errorMessage: v2FailureMessage(env) };
    if (status === 'QUEUED' || status === 'RUNNING' || status === 'CREATE') return { status: 'RUNNING' };

    if (err) {
      // Bận/giới hạn tần suất khi poll: tạm thời, worker thử lại tới deadline_at.
      if (isTransientCode(err)) throw new RunningHubNetworkError(`RunningHub bận (errorCode ${err})`, true);
      throw new RunningHubError(`RunningHub báo lỗi khi truy vấn (errorCode ${err})`);
    }
    throw new RunningHubError(`RunningHub trả trạng thái không rõ (${status || 'rỗng'})`);
  }

  /** Đọc số dư qua đường dẫn cấu hình `RH_BALANCE_ENDPOINT` (POST, trả `data.remainCoins`/`data.coins`/`coins`). */
  async getBalance(signal: AbortSignal): Promise<number> {
    const endpoint = process.env.RH_BALANCE_ENDPOINT?.trim();
    if (!endpoint) throw new RunningHubError('Chưa cấu hình RH_BALANCE_ENDPOINT');
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const env = await this.post(path, JSON.stringify({ apiKey: this.apiKey }), signal);
    const data = (env.data ?? {}) as { remainCoins?: unknown; coins?: unknown };
    const raw = data.remainCoins ?? data.coins ?? (env as { coins?: unknown }).coins;
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      throw new RunningHubError('Phản hồi số dư không hợp lệ');
    }
    return n;
  }
}
