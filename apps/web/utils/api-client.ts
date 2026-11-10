import {
  API_ERROR_MESSAGES_VI,
  AdminTopupApproveExpiredRequestSchema,
  AdminTopupApproveExpiredResponseSchema,
  AdminTopupApproveRequestSchema,
  AdminTopupApproveResponseSchema,
  AdminTopupListQuerySchema,
  AdminTopupListResponseSchema,
  AdminTopupNeedsReviewRequestSchema,
  AdminTopupNeedsReviewResponseSchema,
  AdminTopupRejectRequestSchema,
  AdminTopupRejectResponseSchema,
  AdminTopupReturnToPendingRequestSchema,
  AdminTopupReturnToPendingResponseSchema,
  ApiErrorCode,
  AuthGoogleCallbackQuerySchema,
  AuthGoogleCallbackResponseSchema,
  AuthGoogleQuerySchema,
  AuthGoogleResponseSchema,
  AuthLogoutResponseSchema,
  AuthRefreshResponseSchema,
  BodyRetouchCreateRequestSchema,
  BodyRetouchCreateResponseSchema,
  FaceSwapCreateRequestSchema,
  FaceSwapCreateResponseSchema,
  INTENSITY_DEFAULT,
  INTENSITY_LABEL_ZONES,
  INTENSITY_MAX,
  INTENSITY_MIN,
  IntensitySchema,
  MeResponseSchema,
  PricingConfigResponseSchema,
  TaskIdParamsSchema,
  TaskGetResponseSchema,
  TaskCancelResponseSchema,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskResultResponseSchema,
  TaskShareResponseSchema,
  TaskShareRevokeResponseSchema,
  UploadConfirmParamsSchema,
  UploadConfirmRequestSchema,
  UploadConfirmResponseSchema,
  UploadConfirmVideoResponseSchema,
  UploadCreateRequestSchema,
  UploadCreateResponseSchema,
  TopupConfirmTransferResponseSchema,
  TopupCreateRequestSchema,
  TopupCreateResponseSchema,
  TopupGetResponseSchema,
  TopupIdParamsSchema,
  TopupListQuerySchema,
  TopupListResponseSchema,
  WalletLedgerQuerySchema,
  WalletLedgerResponseSchema,
  getApiErrorMessageVi,
  getIntensityLabelVi,
  getReasonCodeMessageVi,
  type AdminTopup,
  type AdminTopupApproveExpiredRequest,
  type AdminTopupApproveExpiredResponse,
  type AdminTopupApproveRequest,
  type AdminTopupApproveResponse,
  type AdminTopupListQuery,
  type AdminTopupListResponse,
  type AdminTopupNeedsReviewRequest,
  type AdminTopupNeedsReviewResponse,
  type AdminTopupRejectRequest,
  type AdminTopupRejectResponse,
  type AdminTopupReturnToPendingRequest,
  type AdminTopupReturnToPendingResponse,
  type AuthGoogleCallbackQuery,
  type AuthGoogleCallbackResponse,
  type AuthGoogleQuery,
  type AuthGoogleResponse,
  type AuthLogoutResponse,
  type AuthRefreshResponse,
  type BodyRetouchCreateRequest,
  type BodyRetouchCreateResponse,
  type FaceSwapCreateRequest,
  type FaceSwapCreateResponse,
  type Intensity,
  type MeResponse,
  type PricingConfigResponse,
  type ReasonCode,
  type Task,
  type TaskCancelResponse,
  type TaskGetResponse,
  type TaskListQuery,
  type TaskListResponse,
  type TaskResultResponse,
  type TaskShareResponse,
  type TaskShareRevokeResponse,
  type Topup,
  type TopupConfirmTransferResponse,
  type TopupCreateRequest,
  type TopupCreateResponse,
  type TopupGetResponse,
  type TopupListQuery,
  type TopupListResponse,
  type TopupStatus,
  type UploadConfirmRequest,
  type UploadConfirmResponse,
  type UploadConfirmVideoResponse,
  type UploadCreateRequest,
  type UploadCreateResponse,
  type WalletLedgerQuery,
  type WalletLedgerResponse,
} from '@flowvis/contracts';

export {
  API_ERROR_MESSAGES_VI,
  ApiErrorCode,
  BodyRetouchCreateRequestSchema,
  BodyRetouchCreateResponseSchema,
  INTENSITY_DEFAULT,
  INTENSITY_LABEL_ZONES,
  INTENSITY_MAX,
  INTENSITY_MIN,
  IntensitySchema,
  getApiErrorMessageVi,
  getIntensityLabelVi,
  getReasonCodeMessageVi,
  type AdminTopup,
  type AdminTopupApproveExpiredRequest,
  type AdminTopupApproveExpiredResponse,
  type AdminTopupApproveRequest,
  type AdminTopupApproveResponse,
  type AdminTopupListQuery,
  type AdminTopupListResponse,
  type AdminTopupNeedsReviewRequest,
  type AdminTopupNeedsReviewResponse,
  type AdminTopupRejectRequest,
  type AdminTopupRejectResponse,
  type AdminTopupReturnToPendingRequest,
  type AdminTopupReturnToPendingResponse,
  type BodyRetouchCreateRequest,
  type BodyRetouchCreateResponse,
  type FaceSwapCreateRequest,
  type FaceSwapCreateResponse,
  type Intensity,
  type ReasonCode,
  type Task,
  type TaskCancelResponse,
  type TaskGetResponse,
  type TaskListQuery,
  type TaskListResponse,
  type TaskResultResponse,
  type TaskShareResponse,
  type TaskShareRevokeResponse,
  type Topup,
  type TopupConfirmTransferResponse,
  type TopupCreateRequest,
  type TopupCreateResponse,
  type TopupGetResponse,
  type TopupListQuery,
  type TopupListResponse,
  type TopupStatus,
};

export interface MotionApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof globalThis.fetch;
  getAccessToken?: () => string | null | undefined;
  /**
   * Gọi khi request trả 401 (trừ các route xác thực). Nhận access token đã gửi đi.
   * Trả về true nếu đã có phiên mới và client nên thử lại request đúng một lần.
   */
  onUnauthorized?: (sentToken: string | null) => Promise<boolean>;
}

export class MotionApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | (string & {}) | null;
  readonly serverMessage: string;
  readonly userMessageVi: string;
  readonly details?: Record<string, unknown>;

  constructor(params: {
    status: number;
    code?: ApiErrorCode | (string & {}) | null;
    serverMessage?: string;
    details?: Record<string, unknown>;
  }) {
    const normalizedCode =
      typeof params.code === 'string' && params.code.trim().length > 0
        ? params.code.trim()
        : null;
    const userMessageVi = normalizedCode
      ? getApiErrorMessageVi(normalizedCode)
      : (params.serverMessage ?? getApiErrorMessageVi(null));
    super(userMessageVi);
    this.name = 'MotionApiClientError';
    this.status = params.status;
    this.code = normalizedCode;
    this.serverMessage = params.serverMessage ?? userMessageVi;
    this.userMessageVi = userMessageVi;
    this.details = params.details;
  }
}

/**
 * Chuẩn hóa mọi đối tượng lỗi API hoặc mã lỗi sang thông báo tiếng Việt thân thiện
 * thông qua bảng ánh xạ duy nhất `API_ERROR_MESSAGES_VI` của `@flowvis/contracts`.
 */
export function resolveApiErrorMessageVi(errorOrCode: unknown): string {
  if (errorOrCode instanceof MotionApiClientError) {
    return errorOrCode.userMessageVi;
  }

  if (typeof errorOrCode === 'string') {
    return getApiErrorMessageVi(errorOrCode);
  }

  if (errorOrCode && typeof errorOrCode === 'object') {
    const candidate = errorOrCode as {
      code?: unknown;
      data?: { code?: unknown } | null;
      error?: { code?: unknown } | null;
    };
    const rawCode =
      typeof candidate.code === 'string'
        ? candidate.code
        : typeof candidate.data?.code === 'string'
          ? candidate.data.code
          : typeof candidate.error?.code === 'string'
            ? candidate.error.code
            : null;
    return getApiErrorMessageVi(rawCode);
  }

  return getApiErrorMessageVi(null);
}

export interface PresignedUploadOptions {
  uploadUrl: string;
  file: File | Blob;
  headers?: Record<string, string>;
  onProgress?: (progressPercent: number) => void;
  signal?: AbortSignal;
}

/**
 * Tải file trực tiếp lên presigned PUT URL với hỗ trợ tiến trình (onProgress) và hủy (AbortSignal).
 */
export async function uploadPresignedFile(
  options: PresignedUploadOptions,
): Promise<void> {
  const { uploadUrl, file, headers = {}, onProgress, signal } = options;

  if (signal?.aborted) {
    throw new DOMException('Upload aborted', 'AbortError');
  }

  // Sử dụng XMLHttpRequest trong trình duyệt để đo chính xác tiến trình upload
  if (typeof XMLHttpRequest !== 'undefined') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);

      for (const [headerName, headerValue] of Object.entries(headers)) {
        xhr.setRequestHeader(headerName, headerValue);
      }

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (event: ProgressEvent) => {
          if (event.lengthComputable && event.total > 0) {
            const percent = Math.min(
              100,
              Math.round((event.loaded / event.total) * 100),
            );
            onProgress(percent);
          }
        };
      }

      const onAbort = () => {
        xhr.abort();
        reject(new DOMException('Upload aborted', 'AbortError'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      xhr.onload = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve();
        } else {
          reject(
            new MotionApiClientError({
              status: xhr.status,
              code: null,
              serverMessage: `Tải tệp lên máy chủ thất bại (HTTP ${xhr.status}). Vui lòng thử lại sau.`,
            }),
          );
        }
      };

      xhr.onerror = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        reject(
          new MotionApiClientError({
            status: 0,
            code: null,
            serverMessage:
              'Lỗi kết nối mạng khi tải tệp lên. Vui lòng kiểm tra đường truyền và thử lại.',
          }),
        );
      };

      xhr.send(file);
    });
  }

  // Fallback qua fetch trong môi trường không có XMLHttpRequest (SSR / test)
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body: file,
    signal,
  });

  if (!response.ok) {
    throw new MotionApiClientError({
      status: response.status,
      code: null,
      serverMessage: `Tải tệp lên máy chủ thất bại (HTTP ${response.status}). Vui lòng thử lại sau.`,
    });
  }
  onProgress?.(100);
}

export function createMotionApiClient(options: MotionApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(
    /\/+$/,
    '',
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  async function requestLive<T>(
    path: string,
    init: RequestInit,
    parseResponse: (data: unknown) => T,
    requestOptions: { skipRefresh?: boolean; retried?: boolean } = {},
  ): Promise<T> {
    if (typeof fetchImpl !== 'function') {
      throw new MotionApiClientError({
        status: 500,
        code: null,
        serverMessage: 'Fetch implementation is unavailable',
      });
    }

    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');

    const token = options.getAccessToken?.();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      });
    } catch {
      throw new MotionApiClientError({
        status: 0,
        code: null,
        serverMessage: 'Network error',
      });
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (
      response.status === 401 &&
      !requestOptions.skipRefresh &&
      !requestOptions.retried &&
      options.onUnauthorized
    ) {
      let refreshed = false;
      try {
        refreshed = await options.onUnauthorized(token ?? null);
      } catch {
        refreshed = false;
      }
      if (refreshed) {
        return requestLive(path, init, parseResponse, {
          ...requestOptions,
          retried: true,
        });
      }
    }

    if (!response.ok) {
      const errorObj =
        payload && typeof payload === 'object'
          ? (payload as {
              code?: unknown;
              message?: unknown;
              details?: Record<string, unknown>;
              data?: { code?: unknown; message?: unknown } | null;
              error?: { code?: unknown; message?: unknown } | null;
            })
          : undefined;
      const extractedCode =
        typeof errorObj?.code === 'string'
          ? errorObj.code
          : typeof errorObj?.data?.code === 'string'
            ? errorObj.data.code
            : typeof errorObj?.error?.code === 'string'
              ? errorObj.error.code
              : null;
      const extractedMessage =
        typeof errorObj?.message === 'string'
          ? errorObj.message
          : typeof errorObj?.data?.message === 'string'
            ? errorObj.data.message
            : typeof errorObj?.error?.message === 'string'
              ? errorObj.error.message
              : `HTTP ${response.status}`;
      throw new MotionApiClientError({
        status: response.status,
        code: extractedCode,
        serverMessage: extractedMessage,
        details: errorObj?.details,
      });
    }

    const resolvedData =
      payload &&
      typeof payload === 'object' &&
      'data' in payload &&
      (payload as { data?: unknown }).data !== undefined
        ? (payload as { data?: unknown }).data
        : payload;

    try {
      return parseResponse(resolvedData);
    } catch {
      return parseResponse(payload);
    }
  }

  return {
    async getPricingConfig(): Promise<PricingConfigResponse> {
      return requestLive('/config/pricing', { method: 'GET' }, (data) =>
        PricingConfigResponseSchema.parse(data),
      );
    },

    async getMe(): Promise<MeResponse> {
      return requestLive('/me', { method: 'GET' }, (data) =>
        MeResponseSchema.parse(data),
      );
    },

    async getWalletLedger(
      rawQuery?: Partial<WalletLedgerQuery>,
    ): Promise<WalletLedgerResponse> {
      const query = WalletLedgerQuerySchema.parse(rawQuery ?? {});


      const params = new URLSearchParams();
      params.set('pageSize', String(query.pageSize));
      if (query.cursor) {
        params.set('cursor', query.cursor);
      }
      return requestLive(
        `/wallet/ledger?${params.toString()}`,
        { method: 'GET' },
        (data) => WalletLedgerResponseSchema.parse(data),
      );
    },

    async getGoogleAuthUrl(
      rawQuery: AuthGoogleQuery,
    ): Promise<AuthGoogleResponse> {
      const query = AuthGoogleQuerySchema.parse(rawQuery);
      const params = new URLSearchParams({
        tosVersion: query.tosVersion,
        deviceId: query.deviceId,
      });
      return requestLive(
        `/auth/google?${params.toString()}`,
        { method: 'GET' },
        (data) => AuthGoogleResponseSchema.parse(data),
        { skipRefresh: true },
      );
    },

    async handleGoogleCallback(
      rawQuery: AuthGoogleCallbackQuery,
    ): Promise<AuthGoogleCallbackResponse> {
      const query = AuthGoogleCallbackQuerySchema.parse(rawQuery);
      const params = new URLSearchParams();
      if ('code' in query) {
        params.set('code', query.code);
      } else {
        params.set('error', query.error);
        if (query.error_description) {
          params.set('error_description', query.error_description);
        }
      }
      params.set('state', query.state);
      return requestLive(
        `/auth/google/callback?${params.toString()}`,
        { method: 'GET' },
        (data) => AuthGoogleCallbackResponseSchema.parse(data),
        { skipRefresh: true },
      );
    },

    async refreshSession(): Promise<AuthRefreshResponse> {
      return requestLive('/auth/refresh', { method: 'POST' }, (data) =>
        AuthRefreshResponseSchema.parse(data),
        { skipRefresh: true },
      );
    },

    async logout(): Promise<AuthLogoutResponse> {
      return requestLive('/auth/logout', { method: 'POST' }, (data) =>
        AuthLogoutResponseSchema.parse(data),
        { skipRefresh: true },
      );
    },

    async createUpload(
      rawRequest: UploadCreateRequest,
      options?: { signal?: AbortSignal },
    ): Promise<UploadCreateResponse> {
      const data = UploadCreateRequestSchema.parse(rawRequest);
      return requestLive(
        '/uploads',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: options?.signal,
        },
        (payload) => UploadCreateResponseSchema.parse(payload),
      );
    },

    async confirmUpload(
      key: string,
      rawRequest?: UploadConfirmRequest,
      options?: { signal?: AbortSignal },
    ): Promise<UploadConfirmResponse> {
      UploadConfirmParamsSchema.parse({ key });
      const body = rawRequest
        ? JSON.stringify(UploadConfirmRequestSchema.parse(rawRequest))
        : undefined;
      return requestLive(
        `/uploads/${encodeURIComponent(key)}/confirm`,
        {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body,
          signal: options?.signal,
        },
        (payload) => UploadConfirmResponseSchema.parse(payload),
      );
    },

    async confirmVideoUpload(
      key: string,
      options?: { signal?: AbortSignal },
    ): Promise<UploadConfirmVideoResponse> {
      UploadConfirmParamsSchema.parse({ key });
      return requestLive(
        `/uploads/${encodeURIComponent(key)}/confirm`,
        { method: 'POST', signal: options?.signal },
        (payload) => UploadConfirmVideoResponseSchema.parse(payload),
      );
    },

    async createFaceSwapTask(
      rawRequest: FaceSwapCreateRequest,
      options?: { signal?: AbortSignal },
    ): Promise<FaceSwapCreateResponse> {
      const data = FaceSwapCreateRequestSchema.parse(rawRequest);
      return requestLive(
        '/tasks/face-swap',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: options?.signal,
        },
        (payload) => FaceSwapCreateResponseSchema.parse(payload),
      );
    },

    async createBodyRetouchTask(
      rawRequest: BodyRetouchCreateRequest,
      options?: { signal?: AbortSignal },
    ): Promise<BodyRetouchCreateResponse> {
      const data = BodyRetouchCreateRequestSchema.parse(rawRequest);
      return requestLive(
        '/tasks/body-retouch',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: options?.signal,
        },
        (payload) => BodyRetouchCreateResponseSchema.parse(payload),
      );
    },

    async getTask(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<TaskGetResponse> {
      TaskIdParamsSchema.parse({ id });
      return requestLive(
        `/tasks/${encodeURIComponent(id)}`,
        {
          method: 'GET',
          signal: options?.signal,
        },
        (payload) => TaskGetResponseSchema.parse(payload),
      );
    },

    async cancelTask(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<TaskCancelResponse> {
      TaskIdParamsSchema.parse({ id });
      return requestLive(
        `/tasks/${encodeURIComponent(id)}/cancel`,
        {
          method: 'POST',
          signal: options?.signal,
        },
        (payload) => TaskCancelResponseSchema.parse(payload),
      );
    },

    async listTasks(
      rawQuery?: TaskListQuery,
      options?: { signal?: AbortSignal },
    ): Promise<TaskListResponse> {
      const query = TaskListQuerySchema.parse(rawQuery ?? {});
      const params = new URLSearchParams();
      if (query.pageSize) {
        params.set('pageSize', String(query.pageSize));
      }
      if (query.cursor) {
        params.set('cursor', query.cursor);
      }
      const qs = params.toString();
      return requestLive(
        `/tasks${qs ? `?${qs}` : ''}`,
        {
          method: 'GET',
          signal: options?.signal,
        },
        (payload) => TaskListResponseSchema.parse(payload),
      );
    },

    async getTaskResult(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<TaskResultResponse> {
      TaskIdParamsSchema.parse({ id });
      return requestLive(
        `/tasks/${encodeURIComponent(id)}/result`,
        {
          method: 'GET',
          signal: options?.signal,
        },
        (payload) => TaskResultResponseSchema.parse(payload),
      );
    },

    async shareTask(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<TaskShareResponse> {
      TaskIdParamsSchema.parse({ id });
      return requestLive(
        `/tasks/${encodeURIComponent(id)}/share`,
        {
          method: 'POST',
          signal: options?.signal,
        },
        (payload) => TaskShareResponseSchema.parse(payload),
      );
    },

    async revokeTaskShare(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<TaskShareRevokeResponse> {
      TaskIdParamsSchema.parse({ id });
      return requestLive(
        `/tasks/${encodeURIComponent(id)}/share`,
        {
          method: 'DELETE',
          signal: options?.signal,
        },
        (payload) => TaskShareRevokeResponseSchema.parse(payload),
      );
    },

    async createTopup(
      rawRequest: TopupCreateRequest,
      options?: { signal?: AbortSignal },
    ): Promise<TopupCreateResponse> {
      const data = TopupCreateRequestSchema.parse(rawRequest);
      return requestLive(
        '/topups',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: options?.signal,
        },
        (payload) => TopupCreateResponseSchema.parse(payload),
      );
    },

    async confirmTopupTransfer(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<TopupConfirmTransferResponse> {
      TopupIdParamsSchema.parse({ id });
      return requestLive(
        `/topups/${encodeURIComponent(id)}/confirm-transfer`,
        {
          method: 'POST',
          signal: options?.signal,
        },
        (payload) => TopupConfirmTransferResponseSchema.parse(payload),
      );
    },

    async getTopup(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<TopupGetResponse> {
      TopupIdParamsSchema.parse({ id });
      return requestLive(
        `/topups/${encodeURIComponent(id)}`,
        {
          method: 'GET',
          signal: options?.signal,
        },
        (payload) => TopupGetResponseSchema.parse(payload),
      );
    },

    async listTopups(
      rawQuery?: TopupListQuery,
      options?: { signal?: AbortSignal },
    ): Promise<TopupListResponse> {
      const query = TopupListQuerySchema.parse(rawQuery ?? {});
      const params = new URLSearchParams();
      if (query.pageSize) {
        params.set('pageSize', String(query.pageSize));
      }
      if (query.cursor) {
        params.set('cursor', query.cursor);
      }
      const qs = params.toString();
      return requestLive(
        `/topups${qs ? `?${qs}` : ''}`,
        {
          method: 'GET',
          signal: options?.signal,
        },
        (payload) => TopupListResponseSchema.parse(payload),
      );
    },

    async adminListTopups(
      rawQuery?: AdminTopupListQuery,
      options?: { signal?: AbortSignal },
    ): Promise<AdminTopupListResponse> {
      const query = AdminTopupListQuerySchema.parse(rawQuery ?? {});
      const params = new URLSearchParams();
      if (query.status) {
        params.set('status', query.status);
      }
      if (query.pageSize) {
        params.set('pageSize', String(query.pageSize));
      }
      if (query.cursor) {
        params.set('cursor', query.cursor);
      }
      const qs = params.toString();
      return requestLive(
        `/admin/topups${qs ? `?${qs}` : ''}`,
        {
          method: 'GET',
          signal: options?.signal,
        },
        (payload) => AdminTopupListResponseSchema.parse(payload),
      );
    },

    async adminApproveTopup(
      id: string,
      rawRequest: AdminTopupApproveRequest,
      options?: { signal?: AbortSignal },
    ): Promise<AdminTopupApproveResponse> {
      TopupIdParamsSchema.parse({ id });
      const data = AdminTopupApproveRequestSchema.parse(rawRequest);
      return requestLive(
        `/admin/topups/${encodeURIComponent(id)}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: options?.signal,
        },
        (payload) => AdminTopupApproveResponseSchema.parse(payload),
      );
    },

    async adminApproveExpiredTopup(
      id: string,
      rawRequest: AdminTopupApproveExpiredRequest,
      options?: { signal?: AbortSignal },
    ): Promise<AdminTopupApproveExpiredResponse> {
      TopupIdParamsSchema.parse({ id });
      const data = AdminTopupApproveExpiredRequestSchema.parse(rawRequest);
      return requestLive(
        `/admin/topups/${encodeURIComponent(id)}/approve-expired`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: options?.signal,
        },
        (payload) => AdminTopupApproveExpiredResponseSchema.parse(payload),
      );
    },

    async adminRejectTopup(
      id: string,
      rawRequest: AdminTopupRejectRequest,
      options?: { signal?: AbortSignal },
    ): Promise<AdminTopupRejectResponse> {
      TopupIdParamsSchema.parse({ id });
      const data = AdminTopupRejectRequestSchema.parse(rawRequest);
      return requestLive(
        `/admin/topups/${encodeURIComponent(id)}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: options?.signal,
        },
        (payload) => AdminTopupRejectResponseSchema.parse(payload),
      );
    },

    async adminNeedsReviewTopup(
      id: string,
      rawRequest: AdminTopupNeedsReviewRequest,
      options?: { signal?: AbortSignal },
    ): Promise<AdminTopupNeedsReviewResponse> {
      TopupIdParamsSchema.parse({ id });
      const data = AdminTopupNeedsReviewRequestSchema.parse(rawRequest);
      return requestLive(
        `/admin/topups/${encodeURIComponent(id)}/needs-review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: options?.signal,
        },
        (payload) => AdminTopupNeedsReviewResponseSchema.parse(payload),
      );
    },

    async adminReturnTopupToPending(
      id: string,
      rawRequest?: AdminTopupReturnToPendingRequest,
      options?: { signal?: AbortSignal },
    ): Promise<AdminTopupReturnToPendingResponse> {
      TopupIdParamsSchema.parse({ id });
      const data = AdminTopupReturnToPendingRequestSchema.parse(rawRequest ?? {});
      return requestLive(
        `/admin/topups/${encodeURIComponent(id)}/return-to-pending`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data ?? {}),
          signal: options?.signal,
        },
        (payload) => AdminTopupReturnToPendingResponseSchema.parse(payload),
      );
    },
  };
}

export type MotionApiClient = ReturnType<typeof createMotionApiClient>;
