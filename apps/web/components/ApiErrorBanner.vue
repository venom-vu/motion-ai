<script setup lang="ts">
import { computed } from 'vue';
import { resolveApiErrorMessageVi } from '~/utils/api-client';

const props = withDefaults(
  defineProps<{
    error?: unknown;
    messageVi?: string | null;
    dismissible?: boolean;
  }>(),
  {
    messageVi: null,
    dismissible: true,
  },
);

const emit = defineEmits<{
  dismiss: [];
  retry: [];
}>();

const resolvedMessage = computed<string | null>(() => {
  if (typeof props.messageVi === 'string' && props.messageVi.trim().length > 0) {
    return props.messageVi.trim();
  }
  if (props.error !== null && props.error !== undefined && props.error !== '') {
    return resolveApiErrorMessageVi(props.error);
  }
  return null;
});
</script>

<template>
  <div
    v-if="resolvedMessage"
    role="alert"
    aria-live="polite"
    data-testid="api-error-banner"
    class="flex flex-col gap-3 rounded-xl border border-cyber-danger/50 bg-cyber-danger/10 p-4 text-cyber-text sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="flex items-start gap-3">
      <Icon
        name="lucide:triangle-alert"
        class="mt-0.5 h-5 w-5 shrink-0 text-cyber-danger"
      />
      <div class="space-y-1">
        <p class="text-sm font-semibold text-cyber-text">
          Thông báo hệ thống
        </p>
        <p
          data-testid="api-error-message"
          class="text-sm text-cyber-muted"
        >
          {{ resolvedMessage }}
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2 self-end sm:self-center">
      <button
        type="button"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-lg border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-medium text-cyber-text transition hover:border-cyber-violet"
        @click="emit('retry')"
      >
        <Icon name="lucide:refresh-cw" class="h-4 w-4" />
        <span>Thử lại</span>
      </button>

      <button
        v-if="dismissible"
        type="button"
        aria-label="Đóng thông báo lỗi"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border border-cyber-border/70 bg-cyber-bg/60 p-2.5 text-cyber-muted transition hover:text-cyber-text"
        @click="emit('dismiss')"
      >
        <Icon name="lucide:x" class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
