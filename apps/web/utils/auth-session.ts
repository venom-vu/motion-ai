// Logic phiên không phụ thuộc Nuxt để kiểm thử trực tiếp.

export const LOGIN_PATH = '/login';

export interface RefreshedSession {
  accessToken: string;
}

/**
 * Kết quả một lần làm mới phiên:
 * - `ok`: có access token mới.
 * - `invalid`: BE từ chối cookie refresh (401/403) nên phiên đã mất thật.
 * - `transient`: lỗi mạng hoặc 5xx; cookie có thể vẫn hợp lệ, không được coi là mất phiên.
 */
export type RefreshOutcome = 'ok' | 'invalid' | 'transient';

function isSessionRejected(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

/** Gộp mọi lời gọi refresh đồng thời thành một (refresh token xoay vòng sau mỗi lần dùng). */
export function createRefreshCoordinator() {
  let inflight: Promise<RefreshOutcome> | null = null;
  return function refreshShared(
    refresh: () => Promise<RefreshedSession>,
    setToken: (token: string | null) => void,
  ): Promise<RefreshOutcome> {
    inflight ??= refresh()
      .then((session): RefreshOutcome => {
        setToken(session.accessToken);
        return 'ok';
      })
      .catch((error): RefreshOutcome => (isSessionRejected(error) ? 'invalid' : 'transient'))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

export type RefreshShared = ReturnType<typeof createRefreshCoordinator>;

export function createUnauthorizedHandler(deps: {
  getToken: () => string | null;
  setToken: (token: string | null) => void;
  refresh: () => Promise<RefreshedSession>;
  refreshShared: RefreshShared;
  isServer: boolean;
  onSessionLost: (hadToken: boolean) => void | Promise<void>;
}) {
  return async function onUnauthorized(
    sentToken: string | null,
  ): Promise<boolean> {
    // SSR không có cookie refresh của trình duyệt.
    if (deps.isServer) {
      return false;
    }
    // Request khác đã làm mới phiên trong lúc request này bay: chỉ cần thử lại.
    const current = deps.getToken();
    if (current && current !== sentToken) {
      return true;
    }
    const outcome = await deps.refreshShared(deps.refresh, deps.setToken);
    if (outcome === 'invalid') {
      deps.setToken(null);
      await deps.onSessionLost(Boolean(sentToken));
    }
    // `transient`: giữ nguyên token, request gốc báo lỗi của chính nó.
    return outcome === 'ok';
  };
}

/** Xử lý khi phiên đã mất: chỉ chuyển /login nếu request đó đã mang token (khách giữ nguyên trang). */
export function createSessionLostHandler(deps: {
  markChecked: () => void;
  clearData: () => void;
  navigate: (path: string) => Promise<unknown> | unknown;
}) {
  return async function onSessionLost(hadToken: boolean): Promise<void> {
    deps.markChecked();
    if (hadToken) {
      deps.clearData();
      await deps.navigate(LOGIN_PATH);
    }
  };
}

/** Logout lỗi API vẫn xóa phiên cục bộ rồi chuyển trang. */
export async function runLogout(deps: {
  apiLogout: () => Promise<unknown>;
  clearSession: () => void;
  navigate: (path: string) => Promise<unknown> | unknown;
}): Promise<void> {
  try {
    await deps.apiLogout();
  } catch {
    // bỏ qua
  } finally {
    deps.clearSession();
  }
  await deps.navigate(LOGIN_PATH);
}

export function isOutOfCredit(me: { balance: number } | null | undefined): boolean {
  return Boolean(me) && me!.balance === 0;
}
