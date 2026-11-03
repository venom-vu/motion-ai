// Logic phiên không phụ thuộc Nuxt để kiểm thử trực tiếp.

export interface RefreshedSession {
  accessToken: string;
}

/** Gộp mọi lời gọi refresh đồng thời thành một (refresh token xoay vòng sau mỗi lần dùng). */
export function createRefreshCoordinator() {
  let inflight: Promise<boolean> | null = null;
  return function refreshShared(
    refresh: () => Promise<RefreshedSession>,
    setToken: (token: string | null) => void,
  ): Promise<boolean> {
    inflight ??= refresh()
      .then((session) => {
        setToken(session.accessToken);
        return true;
      })
      .catch(() => false)
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
    const ok = await deps.refreshShared(deps.refresh, deps.setToken);
    if (!ok) {
      deps.setToken(null);
      await deps.onSessionLost(Boolean(sentToken));
    }
    return ok;
  };
}

/** Logout lỗi API vẫn xóa phiên cục bộ rồi chuyển trang. */
export async function runLogout(deps: {
  apiLogout: () => Promise<unknown>;
  clearSession: () => void;
  navigate: () => Promise<unknown> | unknown;
}): Promise<void> {
  try {
    await deps.apiLogout();
  } catch {
    // bỏ qua
  } finally {
    deps.clearSession();
  }
  await deps.navigate();
}

export function isOutOfCredit(me: { balance: number } | null | undefined): boolean {
  return Boolean(me) && me!.balance === 0;
}
