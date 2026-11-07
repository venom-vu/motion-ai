import {
  RunningHubError,
  RunningHubNetworkError,
  type RunningHubNodeInfo,
  type RunningHubOutputs,
  type RunningHubPort,
} from '../../ports/index.js';
import { RunningHubOpenApiAdapter } from './runninghub-openapi.adapter.js';
import { UnconfiguredRunningHubAdapter } from './runninghub-unconfigured.adapter.js';

/**
 * Adapter RunningHub qua HTTP JSON đơn giản. Chỉ được nối khi NODE_ENV === 'test'
 * và có RUNNINGHUB_BASE_URL (xem tasks.module.ts); dùng cho smoke test với máy chủ giả.
 */
export class RunningHubHttpAdapter implements RunningHubPort {
  readonly portName = 'RunningHubPort' as const;
  private readonly base: string;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  private async call(path: string, init: RequestInit, signal: AbortSignal): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { ...init, signal });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new RunningHubNetworkError(String(err), true);
    }
    if (!res.ok) throw new RunningHubError(`RunningHub HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async uploadFile(bytes: Buffer, name: string, signal: AbortSignal): Promise<string> {
    const body = await this.call(
      `/upload?name=${encodeURIComponent(name)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) },
      signal,
    );
    if (typeof body.fileName !== 'string') throw new RunningHubError('Phản hồi upload không hợp lệ');
    return body.fileName;
  }

  async submit(workflowId: string, nodeInfoList: RunningHubNodeInfo[], signal: AbortSignal): Promise<string> {
    const body = await this.call(
      '/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, nodeInfoList }),
      },
      signal,
    );
    if (typeof body.taskId !== 'string') throw new RunningHubError('Phản hồi submit không hợp lệ');
    return body.taskId;
  }

  async outputs(runninghubTaskId: string, signal: AbortSignal): Promise<RunningHubOutputs> {
    const body = await this.call(`/outputs/${encodeURIComponent(runninghubTaskId)}`, { method: 'GET' }, signal);
    const status = body.status;
    if (status !== 'RUNNING' && status !== 'SUCCESS' && status !== 'FAILED') {
      throw new RunningHubError('Phản hồi outputs không hợp lệ');
    }
    return {
      status,
      fileUrl: typeof body.fileUrl === 'string' ? body.fileUrl : undefined,
      errorMessage: typeof body.errorMessage === 'string' ? body.errorMessage : undefined,
      consumeMoney: typeof body.consumeMoney === 'number' ? body.consumeMoney : undefined,
    };
  }
}

/**
 * Chọn adapter RunningHub:
 * 1. NODE_ENV === 'test' và có RUNNINGHUB_BASE_URL: máy chủ giả của smoke test.
 * 2. Có RUNNINGHUB_API_KEY: adapter OpenAPI thật (host mặc định https://www.runninghub.ai, ghi đè bằng RUNNINGHUB_API_HOST).
 * 3. Còn lại: adapter chưa cấu hình (mọi lời gọi ném RH_ERROR).
 */
export function createRunningHubPort(): RunningHubPort {
  if (process.env.NODE_ENV === 'test' && process.env.RUNNINGHUB_BASE_URL) {
    return new RunningHubHttpAdapter(process.env.RUNNINGHUB_BASE_URL);
  }
  const apiKey = process.env.RUNNINGHUB_API_KEY?.trim();
  if (apiKey) {
    return new RunningHubOpenApiAdapter(apiKey, process.env.RUNNINGHUB_API_HOST?.trim() || undefined);
  }
  return new UnconfiguredRunningHubAdapter();
}
