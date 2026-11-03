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

watch(
  () => props.initialErrorVi,
  (next) => {
    errorVi.value = next;
  },
);

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
</script>

<template>
  <div class="space-y-4" data-testid="login-consent-form">
    <ApiErrorBanner
      :message-vi="errorVi"
      @retry="handleGoogleLogin"
      @dismiss="errorVi = null"
    />

    <label
      :for="`${idPrefix}-tos-consent-checkbox`"
      class="touch-target flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border border-cyber-border bg-cyber-bg/70 p-3.5 text-sm transition hover:border-cyber-violet/60"
    >
      <input
        :id="`${idPrefix}-tos-consent-checkbox`"
        v-model="acceptedTos"
        type="checkbox"
        data-testid="tos-checkbox"
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
