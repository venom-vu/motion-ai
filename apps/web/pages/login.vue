<script setup lang="ts">
import { ref } from 'vue';
import { TOS_VERSION } from '@motion-ai/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { usePricingConfig } from '~/composables/usePricingConfig';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import { formatNumberVi } from '~/utils/catalog';

const { client } = useApiClient();
const { pricing, me } = usePricingConfig();

const acceptedTos = ref<boolean>(false);
const authRedirectUrl = ref<string | null>(null);
const loginErrorVi = ref<string | null>(null);

async function handleGoogleLogin(): Promise<void> {
  loginErrorVi.value = null;
  if (!acceptedTos.value) {
    loginErrorVi.value = resolveApiErrorMessageVi('CONSENT_REQUIRED');
    return;
  }

  try {
    const response = await client.getGoogleAuthUrl({
      tosVersion: TOS_VERSION,
      deviceId: 'fp_device_12345678',
    });
    authRedirectUrl.value = response.redirectUrl;
  } catch (error) {
    loginErrorVi.value = resolveApiErrorMessageVi(error);
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-6" data-testid="page-login">
    <section
      class="rounded-2xl border border-cyber-border bg-cyber-surface p-6 shadow-xl"
    >
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
        >
          <Icon name="lucide:shield-check" class="h-6 w-6" />
        </span>
        <div>
          <h1 class="font-display text-xl font-bold text-cyber-text sm:text-2xl">
            Đăng Nhập & Cam Kết Điều Khoản
          </h1>
          <p class="text-xs text-cyber-muted">
            Phiên bản điều khoản hiện hành:
            <span class="font-mono text-cyber-cyan">{{ TOS_VERSION }}</span>
          </p>
        </div>
      </div>

      <p v-if="pricing" class="mt-4 text-sm text-cyber-muted">
        Tài khoản đăng ký lần đầu trên thiết bị hợp lệ được tặng
        <span class="font-mono font-semibold text-cyber-cyan">
          {{ formatNumberVi(pricing.trialGrantCredits) }} credit
        </span>
        dùng thử.
      </p>

      <div class="mt-5 space-y-4">
        <ApiErrorBanner
          :message-vi="loginErrorVi"
          @retry="handleGoogleLogin"
          @dismiss="loginErrorVi = null"
        />

        <!-- Checkbox cam kết ToS với vùng chạm >= 48px -->
        <label
          for="tos-consent-checkbox"
          class="touch-target flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border border-cyber-border bg-cyber-bg/70 p-3.5 text-sm text-cyber-text transition hover:border-cyber-violet/60"
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
          :disabled="!acceptedTos"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-cyber-violet px-5 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleGoogleLogin"
        >
          <Icon name="lucide:log-in" class="h-4 w-4 shrink-0" />
          <span>Đăng Nhập Bằng Google</span>
        </button>

        <div
          v-if="authRedirectUrl"
          data-testid="mock-oauth-result"
          class="rounded-xl border border-cyber-success/40 bg-cyber-success/10 p-3.5 text-xs text-cyber-text"
        >
          <p class="font-semibold text-cyber-success">
            Đã khởi tạo đường dẫn xác thực Google OAuth (Mock):
          </p>
          <p class="mt-1 break-all font-mono text-[11px] text-cyber-muted">
            {{ authRedirectUrl }}
          </p>
        </div>
      </div>
    </section>

    <!-- Thông tin tài khoản hiện hành từ GET /me -->
    <section
      v-if="me"
      class="rounded-2xl border border-cyber-border bg-cyber-surface p-5"
    >
      <h2 class="font-display text-base font-bold text-cyber-text">
        Trạng Thái Ví Hiện Tại (Dữ Liệu Từ GET /me)
      </h2>
      <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
          <span class="block text-xs text-cyber-muted">Email</span>
          <span class="mt-1 block truncate font-mono text-xs text-cyber-text">
            {{ me.email }}
          </span>
        </div>
        <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
          <span class="block text-xs text-cyber-muted">Số dư khả dụng</span>
          <span class="mt-1 block font-mono text-sm font-bold text-cyber-cyan">
            {{ formatNumberVi(me.balance) }} CR
          </span>
        </div>
        <div class="col-span-2 rounded-xl border border-cyber-border bg-cyber-bg/70 p-3 sm:col-span-1">
          <span class="block text-xs text-cyber-muted">Đang tạm giữ (HOLD)</span>
          <span class="mt-1 block font-mono text-sm font-bold text-cyber-warning">
            {{ formatNumberVi(me.held) }} CR
          </span>
        </div>
      </div>
    </section>
  </div>
</template>
