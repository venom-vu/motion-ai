import {
  API_ERROR_MESSAGES_VI,
  ApiErrorCode,
  AuthGoogleCallbackQuerySchema,
  AuthGoogleCallbackResponseSchema,
  AuthGoogleQuerySchema,
  AuthGoogleResponseSchema,
  AuthLogoutResponseSchema,
  AuthRefreshResponseSchema,
  MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE,
  MOCK_AUTH_GOOGLE_RESPONSE,
  MOCK_AUTH_LOGOUT_RESPONSE,
  MOCK_AUTH_REFRESH_RESPONSE,
  MOCK_ME_RESPONSE,
  MOCK_PRICING_CONFIG_RESPONSE,
  MOCK_WALLET_LEDGER_ITEMS,
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
  type LedgerEntry,
  type MeResponse,
  type PricingConfigResponse,
  type WalletLedgerQuery,
  type WalletLedgerResponse,
} from '@motion-ai/contracts';

export { API_ERROR_MESSAGES_VI, ApiErrorCode, getApiErrorMessageVi };

export type ApiMode = 'mock' | 'live';

export interface MotionApiMockOverrides {
  pricingConfig?: unknown;
  me?: unknown;
  walletLedgerItems?: LedgerEntry[];
  walletLedgerResponse?: unknown;
  authGoogleResponse?: unknown;
  authGoogleCallbackResponse?: unknown;
  authRefreshResponse?: unknown;
  authLogoutResponse?: unknown;
  simulatedErrorCode?: ApiErrorCode | (string & {}) | null;
}

export interface MotionApiClientOptions {
  mode?: ApiMode;
  baseUrl?: string;
  fetchImpl?: typeof globalThis.fetch;
  getAccessToken?: () => string | null | undefined;
  mockOverrides?: MotionApiMockOverrides;
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

function buildMockLedgerPage(
  items: LedgerEntry[],
  query: WalletLedgerQuery,
): WalletLedgerResponse {
  const { pageSize, cursor } = query;
  let startIndex = 0;

  if (cursor) {
    const foundIdx = items.findIndex((item) => item.id === cursor);
    startIndex = foundIdx >= 0 ? foundIdx + 1 : items.length;
  }

  const pageItems = items.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + pageSize < items.length;
  const nextCursor =
    hasMore && pageItems.length > 0
      ? (pageItems[pageItems.length - 1]?.id ?? null)
      : null;

  return WalletLedgerResponseSchema.parse({
    items: pageItems,
    pageSize,
    hasMore,
    nextCursor,
  });
}

export function createMotionApiClient(options: MotionApiClientOptions = {}) {
  const mode: ApiMode = options.mode === 'live' ? 'live' : 'mock';
  const baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(
    /\/+$/,
    '',
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const overrides = options.mockOverrides ?? {};

  function throwIfSimulatedError(): void {
    if (
      overrides.simulatedErrorCode !== undefined &&
      overrides.simulatedErrorCode !== null
    ) {
      throw new MotionApiClientError({
        status: 400,
        code: overrides.simulatedErrorCode,
      });
    }
  }

  async function requestLive<T>(
    path: string,
    init: RequestInit,
    parseResponse: (data: unknown) => T,
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
    mode,

    async getPricingConfig(): Promise<PricingConfigResponse> {
      throwIfSimulatedError();
      if (mode === 'mock') {
        const raw = overrides.pricingConfig ?? MOCK_PRICING_CONFIG_RESPONSE;
        return PricingConfigResponseSchema.parse(raw);
      }
      return requestLive('/config/pricing', { method: 'GET' }, (data) =>
        PricingConfigResponseSchema.parse(data),
      );
    },

    async getMe(): Promise<MeResponse> {
      throwIfSimulatedError();
      if (mode === 'mock') {
        const raw = overrides.me ?? MOCK_ME_RESPONSE;
        return MeResponseSchema.parse(raw);
      }
      return requestLive('/me', { method: 'GET' }, (data) =>
        MeResponseSchema.parse(data),
      );
    },

    async getWalletLedger(
      rawQuery?: Partial<WalletLedgerQuery>,
    ): Promise<WalletLedgerResponse> {
      throwIfSimulatedError();
      const query = WalletLedgerQuerySchema.parse(rawQuery ?? {});

      if (mode === 'mock') {
        if (overrides.walletLedgerResponse !== undefined) {
          return WalletLedgerResponseSchema.parse(
            overrides.walletLedgerResponse,
          );
        }
        const items = overrides.walletLedgerItems ?? MOCK_WALLET_LEDGER_ITEMS;
        return buildMockLedgerPage(items, query);
      }

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
      throwIfSimulatedError();
      const query = AuthGoogleQuerySchema.parse(rawQuery);
      if (mode === 'mock') {
        const raw = overrides.authGoogleResponse ?? MOCK_AUTH_GOOGLE_RESPONSE;
        return AuthGoogleResponseSchema.parse(raw);
      }
      const params = new URLSearchParams({
        tosVersion: query.tosVersion,
        deviceId: query.deviceId,
      });
      return requestLive(
        `/auth/google?${params.toString()}`,
        { method: 'GET' },
        (data) => AuthGoogleResponseSchema.parse(data),
      );
    },

    async handleGoogleCallback(
      rawQuery: AuthGoogleCallbackQuery,
    ): Promise<AuthGoogleCallbackResponse> {
      throwIfSimulatedError();
      const query = AuthGoogleCallbackQuerySchema.parse(rawQuery);
      if (mode === 'mock') {
        if ('error' in query) {
          throw new MotionApiClientError({
            status: 400,
            code: query.error,
            serverMessage: query.error_description ?? query.error,
          });
        }
        const raw =
          overrides.authGoogleCallbackResponse ??
          MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE;
        return AuthGoogleCallbackResponseSchema.parse(raw);
      }
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
      );
    },

    async refreshSession(): Promise<AuthRefreshResponse> {
      throwIfSimulatedError();
      if (mode === 'mock') {
        const raw = overrides.authRefreshResponse ?? MOCK_AUTH_REFRESH_RESPONSE;
        return AuthRefreshResponseSchema.parse(raw);
      }
      return requestLive('/auth/refresh', { method: 'POST' }, (data) =>
        AuthRefreshResponseSchema.parse(data),
      );
    },

    async logout(): Promise<AuthLogoutResponse> {
      throwIfSimulatedError();
      if (mode === 'mock') {
        const raw = overrides.authLogoutResponse ?? MOCK_AUTH_LOGOUT_RESPONSE;
        return AuthLogoutResponseSchema.parse(raw);
      }
      return requestLive('/auth/logout', { method: 'POST' }, (data) =>
        AuthLogoutResponseSchema.parse(data),
      );
    },
  };
}

export type MotionApiClient = ReturnType<typeof createMotionApiClient>;
