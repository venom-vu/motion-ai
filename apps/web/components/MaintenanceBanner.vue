<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useSystemStatus } from '~/composables/useSystemStatus';
import { MAINTENANCE_MESSAGE_VI } from '~/utils/system-status';

const POLL_INTERVAL_MS = 60_000;
const { intakePaused, refresh } = useSystemStatus();
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div
    v-if="intakePaused"
    role="status"
    data-testid="maintenance-banner"
    class="flex items-start gap-3 rounded-xl border border-cyber-warning/40 bg-cyber-warning/10 p-4 text-xs text-cyber-warning"
  >
    <Icon name="lucide:wrench" class="mt-0.5 h-4 w-4 shrink-0" />
    <span>{{ MAINTENANCE_MESSAGE_VI }}</span>
  </div>
</template>
