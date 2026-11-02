<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from '#imports';
import { TOS_VERSION } from '@motion-ai/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { useAuth } from '~/composables/useAuth';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { usePricingConfig } from '~/composables/usePricingConfig';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import { formatNumberVi } from '~/utils/catalog';

const { client } = useApiClient();
const { logout } = useAuth();
const { pricing, me } = usePricingConfig();
const { mode, errorVi, open, close } = useAuthDialog();
const route = useRoute();
const router = useRouter();

const acceptedTos = ref<boolean>(false);
const submitting = ref<boolean>(false);

const DEVICE_ID_KEY = 'motion-ai-device-id';

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `dev_${crypto.randomUUID()}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev_${crypto.randomUUID()}`;
  }
}

async function handleGoogleLogin(): Promise<void> {
  errorVi.value = null;
  if (!acceptedTos.value) {
    errorVi.value = resolveApiErrorMessageVi('CONSENT_REQUIRED');
    return;
  }
  submitting.value = true;
  try {
    const response = await client.getGoogleAuthUrl({
      tosVersion: TOS_VERSION,
      deviceId: getDeviceId(),
    });
    window.location.href = response.redirectUrl;
  } catch (error) {
    errorVi.value = resolveApiErrorMessageVi(error);
    submitting.value = false;
  }
}

async function handleLogout(): Promise<void> {
  await logout();
  close();
}

function handleKeydown(event: KeyboardEvent): void {
  if (mode.value && event.key === 'Escape') {
    close();
  }
}

// Đăng nhập thành công thì tự đóng dialog đăng nhập.
watch(me, (next) => {
  if (next && mode.value === 'login') {
    close();
  }
});

// BE redirect về /?authError=<code> khi Google OAuth thất bại: mở lại dialog kèm thông báo.
onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  const err = route.query.authError;
  if (typeof err === 'string' && err) {
    open('login', resolveApiErrorMessageVi(err));
    void router.replace({ path: route.path, query: {} });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div
    v-if="mode"
    role="dialog"
    aria-modal="true"
    aria-labelledby="auth-dialog-title"
    data-testid="auth-dialog"
    class="fixed inset-0 z-50 flex items-center justify-center bg-cyber-bg/80 p-3 backdrop-blur-sm sm:p-6"
    @click.self="close"
  >
    <div
      class="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-cyber-border bg-cyber-surface p-6 text-cyber-text shadow-2xl"
    >
      <button
        type="button"
        aria-label="Đóng"
        class="touch-target absolute right-3 top-3 inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl text-cyber-muted transition hover:text-cyber-text"
        @click="close"
      >
        <Icon name="lucide:x" class="h-5 w-5" />
      </button>

      <!-- Đăng nhập -->
      <template v-if="mode === 'login'">
        <div class="flex items-center gap-3 pr-12">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon name="lucide:shield-check" class="h-6 w-6" />
          </span>
          <div>
            <h2 id="auth-dialog-title" class="font-display text-xl font-bold">
              Đăng Nhập
            </h2>
            <p class="text-xs text-cyber-muted">
              Điều khoản phiên bản
              <span class="font-mono text-cyber-cyan">{{ TOS_VERSION }}</span>
            </p>
          </div>
        </div>

        <p v-if="pricing" class="mt-4 text-sm text-cyber-muted">
          Tài khoản đăng ký lần đầu được tặng
          <span class="font-mono font-semibold text-cyber-cyan">
            {{ formatNumberVi(pricing.trialGrantCredits) }} credit
          </span>
          dùng thử.
        </p>

        <div class="mt-5 space-y-4">
          <ApiErrorBanner
            :message-vi="errorVi"
            @retry="handleGoogleLogin"
            @dismiss="errorVi = null"
          />

          <label
            for="tos-consent-checkbox"
            class="touch-target flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border border-cyber-border bg-cyber-bg/70 p-3.5 text-sm transition hover:border-cyber-violet/60"
          >
            <input
              id="tos-consent-checkbox"
              v-model="acceptedTos"
              type="checkbox"
              class="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-cyber-violet"
            />
            <span class="text-xs leading-relaxed text-cyber-muted">
              Tôi xác nhận đủ 18 tuổi, sở hữu quyền hợp pháp đối với hình ảnh/video
              tải lên, cam kết không tạo nội dung vi phạm pháp luật và đồng ý với
              Điều khoản dịch vụ phiên bản {{ TOS_VERSION }}.
            </span>
          </label>

          <button
            type="button"
            data-testid="google-login-button"
            :disabled="!acceptedTos || submitting"
            class="touch-target inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-cyber-violet px-5 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleGoogleLogin"
          >
            <Icon name="lucide:log-in" class="h-4 w-4 shrink-0" />
            <span>Đăng Nhập Bằng Google</span>
          </button>
        </div>
      </template>

      <!-- Thông tin tài khoản -->
      <template v-else>
        <div class="flex items-center gap-3 pr-12">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon name="lucide:user-round" class="h-6 w-6" />
          </span>
          <div class="min-w-0">
            <h2 id="auth-dialog-title" class="font-display text-xl font-bold">
              Tài Khoản
            </h2>
            <p class="truncate font-mono text-xs text-cyber-muted">
              {{ me?.email ?? 'Đang tải...' }}
            </p>
          </div>
        </div>

        <dl v-if="me" class="mt-5 grid grid-cols-2 gap-3 text-xs">
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Vai trò</dt>
            <dd class="mt-1 font-mono">{{ me.role }}</dd>
          </div>
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Hạng</dt>
            <dd class="mt-1 font-mono">{{ me.tier }}</dd>
          </div>
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Số dư khả dụng</dt>
            <dd class="mt-1 font-mono font-bold text-cyber-cyan">
              {{ formatNumberVi(me.balance) }} CR
            </dd>
          </div>
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Đang tạm giữ</dt>
            <dd class="mt-1 font-mono font-bold text-cyber-warning">
              {{ formatNumberVi(me.held) }} CR
            </dd>
          </div>
          <div class="col-span-2 rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Điều khoản đã đồng ý</dt>
            <dd class="mt-1 font-mono">{{ me.tosVersion }}</dd>
          </div>
        </dl>

        <button
          type="button"
          data-testid="logout-button"
          class="touch-target mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-cyber-border px-5 py-3 text-sm font-semibold transition hover:border-cyber-danger hover:text-cyber-danger"
          @click="handleLogout"
        >
          <Icon name="lucide:log-out" class="h-4 w-4 shrink-0" />
          <span>Đăng xuất</span>
        </button>
      </template>
    </div>
  </div>
</template>
