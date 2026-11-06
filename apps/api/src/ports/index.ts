export const RUNNING_HUB_PORT = Symbol('RUNNING_HUB_PORT');
export const STORAGE_PORT = Symbol('STORAGE_PORT');
export const NOTIFIER_PORT = Symbol('NOTIFIER_PORT');

export const RESULT_INGESTOR = Symbol('RESULT_INGESTOR');

/** Lỗi mạng khi gọi RunningHub; `requestSent` cho biết request có thể đã tới RunningHub hay chưa. */
export class RunningHubNetworkError extends Error {
  constructor(
    message: string,
    readonly requestSent: boolean,
  ) {
    super(message);
    this.name = 'RunningHubNetworkError';
  }
}

/** RunningHub từ chối rõ ràng (hoặc adapter chưa cấu hình): luôn là RH_ERROR. */
export class RunningHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunningHubError';
  }
}

export interface RunningHubNodeInfo {
  readonly nodeId: string;
  readonly fieldName: string;
  readonly fieldValue: string;
}

export interface RunningHubOutputs {
  readonly status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  readonly fileUrl?: string;
  readonly errorMessage?: string;
  readonly consumeMoney?: number;
}

export interface RunningHubPort {
  readonly portName?: 'RunningHubPort';
  /** Trả tên file đã upload lên RunningHub. */
  uploadFile(bytes: Buffer, name: string, signal: AbortSignal): Promise<string>;
  /** Trả runninghubTaskId. */
  submit(workflowId: string, nodeInfoList: RunningHubNodeInfo[], signal: AbortSignal): Promise<string>;
  outputs(runninghubTaskId: string, signal: AbortSignal): Promise<RunningHubOutputs>;
}

export interface IngestTask {
  readonly id: string;
  readonly userId: string;
  readonly pipeline: string;
}

/** Cổng nhập kết quả (Story 2.6 thay bản thật). Phải tự chuyển trạng thái Task. */
export interface ResultIngestor {
  ingest(
    task: IngestTask,
    fileUrl: string | undefined,
    consumeMoney: number | undefined,
    signal: AbortSignal,
  ): Promise<void>;
}

export class StoragePreconditionFailedError extends Error {
  constructor(message = 'Đối tượng đã thay đổi so với ETag mong đợi') {
    super(message);
    this.name = 'StoragePreconditionFailedError';
  }
}

export interface StorageHeadResult {
  readonly sizeBytes: number;
  readonly etag: string;
  readonly contentType?: string;
}

export interface StoragePresignPutInput {
  readonly key: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly expiresInSeconds: number;
}

export interface StoragePresignPutResult {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly expiresAt: Date;
}

export interface StoragePort {
  readonly portName?: 'StoragePort';
  presignPut(input: StoragePresignPutInput): Promise<StoragePresignPutResult>;
  /** Trả null nếu đối tượng không tồn tại. */
  head(key: string): Promise<StorageHeadResult | null>;
  getObject(key: string, signal?: AbortSignal): Promise<Buffer>;
  /** URL GET ký ngắn hạn tới đối tượng (không kiểm tra đối tượng có tồn tại). */
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  /** Trả ETag của đối tượng vừa ghi (theo phản hồi PutObject). */
  putObject(key: string, body: Buffer, contentType: string, signal?: AbortSignal): Promise<string>;
  /** Ném StoragePreconditionFailedError khi ETag nguồn khác `etag`. */
  copyIfMatch(sourceKey: string, destKey: string, etag: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface NotifierEvent {
  readonly kind: string;
  readonly message: string;
  readonly severity?: 'info' | 'warn' | 'error';
  readonly data?: Record<string, unknown>;
}

export interface NotifierPort {
  readonly portName?: 'NotifierPort';
  notify(event: NotifierEvent): Promise<void>;
}
