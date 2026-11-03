import {
  API_ERROR_MESSAGES_VI,
  ApiErrorCode,
  AuthGoogleCallbackQuerySchema,
  AuthGoogleCallbackResponseSchema,
  AuthGoogleQuerySchema,
  AuthGoogleResponseSchema,
  AuthLogoutResponseSchema,
  AuthRefreshResponseSchema,
  MeResponseSchema,
  PricingConfigResponseSchema,
  WalletLedgerQuerySchema,
  WalletLedgerResponseSchema,
  getApiErrorMessageVi,
  type AuthGoogleCallbackQuery,
  type AuthGoogleCallbackResponse,
  type AuthGoogleQuery,
  type AuthGoogleResponse,
  type AuthLogoutResponse,
  type AuthRefreshResponse,
  type MeResponse,
  type PricingConfigResponse,
  type WalletLedgerQuery,
  type WalletLedgerResponse,
} from '@motion-ai/contracts';

export { API_ERROR_MESSAGES_VI, ApiErrorCode, getApiErrorMessageVi };

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
    const userMessageVi = getApiErrorMessageVi(normalizedCode);
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
 * thông qua bảng ánh xạ duy nhất `API_ERROR_MESSAGES_VI` của `@motion-ai/contracts`.
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

    return parseResponse(payload);
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
  };
}

export type MotionApiClient = ReturnType<typeof createMotionApiClient>;
