<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { TOS_VERSION } from '@motion-ai/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { resolveApiErrorMessageVi } from '~/utils/api-client';

const props = withDefaults(
  defineProps<{
    initialErrorVi?: string | null;
    idPrefix?: string;
  }>(),
  { initialErrorVi: null, idPrefix: 'login' },
);

const { client } = useApiClient();

const acceptedTos = ref<boolean>(false);
const submitting = ref<boolean>(false);
const errorVi = ref<string | null>(props.initialErrorVi);
const tosErrorVi = ref<string | null>(null);

watch(
  () => props.initialErrorVi,
  (next) => {
    errorVi.value = next;
  },
);

watch(acceptedTos, (accepted) => {
  if (accepted) {
    tosErrorVi.value = null;
  }
});

const DEVICE_ID_KEY = 'flowvis-device-id';

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

// Quay lại bằng nút Back (bfcache) thì trang giữ nguyên trạng thái: bật lại nút.
function handlePageShow(event: PageTransitionEvent): void {
  if (event.persisted) {
    submitting.value = false;
  }
}

onMounted(() => window.addEventListener('pageshow', handlePageShow));
onBeforeUnmount(() => window.removeEventListener('pageshow', handlePageShow));

async function handleGoogleLogin(): Promise<void> {
  errorVi.value = null;
  tosErrorVi.value = null;
  if (!acceptedTos.value) {
    tosErrorVi.value = 'Vui lòng đồng ý với Điều khoản dịch vụ trước khi đăng nhập.';
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
</script>

<template>
  <div class="space-y-2.5" data-testid="login-consent-form">
    <ApiErrorBanner
      :message-vi="errorVi"
      @retry="handleGoogleLogin"
      @dismiss="errorVi = null"
    />

    <div class="space-y-1.5">
      <button
        type="button"
        data-testid="google-login-button"
        :disabled="submitting"
        class="touch-target group flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border border-cyber-border bg-cyber-bg/70 px-4 py-2.5 text-left text-sm font-medium text-cyber-text transition hover:border-cyber-violet hover:bg-cyber-bg disabled:cursor-not-allowed disabled:opacity-50"
        @click="handleGoogleLogin"
      >
        <span class="flex items-center gap-3">
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm"
            aria-hidden="true"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
          </span>
          <span>Đăng nhập bằng Google</span>
        </span>
        <Icon
          name="lucide:chevron-right"
          class="h-4 w-4 shrink-0 text-cyber-muted transition group-hover:translate-x-0.5 group-hover:text-cyber-text"
        />
      </button>

      <p
        v-if="tosErrorVi"
        role="alert"
        data-testid="tos-error"
        class="flex items-center gap-1.5 text-xs text-cyber-danger"
      >
        <Icon name="lucide:circle-alert" class="h-4 w-4 shrink-0" />
        <span>{{ tosErrorVi }}</span>
      </p>
    </div>

    <label
      :for="`${idPrefix}-tos-consent-checkbox`"
      class="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-cyber-muted"
    >
      <input
        :id="`${idPrefix}-tos-consent-checkbox`"
        v-model="acceptedTos"
        type="checkbox"
        data-testid="tos-checkbox"
        class="h-4 w-4 shrink-0 cursor-pointer accent-cyber-violet"
      />
      <span>
        Tôi đủ 18 tuổi và đồng ý với
        <NuxtLink
          to="/terms"
          target="_blank"
          rel="noopener"
          class="text-cyber-violet underline"
          data-testid="tos-link"
          @click.stop
        >Điều khoản dịch vụ</NuxtLink>
      </span>
    </label>
  </div>
</template>
