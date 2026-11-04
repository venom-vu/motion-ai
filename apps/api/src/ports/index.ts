export const RUNNING_HUB_PORT = Symbol('RUNNING_HUB_PORT');
export const STORAGE_PORT = Symbol('STORAGE_PORT');
export const NOTIFIER_PORT = Symbol('NOTIFIER_PORT');

export interface RunningHubPort {
  readonly portName?: 'RunningHubPort';
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
  getObject(key: string): Promise<Buffer>;
  /** Trả ETag của đối tượng vừa ghi (theo phản hồi PutObject). */
  putObject(key: string, body: Buffer, contentType: string): Promise<string>;
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
