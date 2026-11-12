<script setup lang="ts">
import { ui } from '~/utils/admin-ui';

defineProps<{ open: boolean; title: string; busy: boolean; errorVi?: string | null }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
</script>

<template>
  <div
    v-if="open"
    data-testid="ops-confirm-dialog"
    role="dialog"
    aria-modal="true"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-geist"
  >
    <div class="w-full max-w-md space-y-4 rounded-lg border border-[#2E2E2E] bg-[#111111] p-6 text-[#EDEDED]">
      <h3 class="text-lg font-semibold">{{ title }}</h3>
      <div class="space-y-2 text-base leading-relaxed">
        <slot />
      </div>
      <p v-if="errorVi" data-testid="ops-confirm-error" role="alert" :class="ui.error">{{ errorVi }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" data-testid="ops-confirm-cancel" :disabled="busy" :class="ui.btn" @click="emit('cancel')">
          Hủy
        </button>
        <button type="button" data-testid="ops-confirm-ok" :disabled="busy" :class="ui.btnPrimary" @click="emit('confirm')">
          <Icon v-if="busy" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
          <span>Xác nhận</span>
        </button>
      </div>
    </div>
  </div>
</template>
