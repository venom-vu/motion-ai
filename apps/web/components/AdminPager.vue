<script setup lang="ts">
import { ui } from '~/utils/admin-ui';

defineProps<{
  page: number;
  pageCount: number;
  hasMore: boolean;
  canPrev: boolean;
  canNext: boolean;
  loading?: boolean;
}>();
const emit = defineEmits<{ prev: []; next: [] }>();
</script>

<template>
  <nav aria-label="Phân trang" data-testid="admin-pager" class="flex flex-wrap items-center justify-between gap-3">
    <span :class="ui.muted" data-testid="admin-pager-label">
      Trang {{ page }}<template v-if="!hasMore"> / {{ pageCount }}</template>
    </span>
    <div class="flex gap-2">
      <button type="button" data-testid="admin-pager-prev" :disabled="!canPrev || loading" :class="ui.btn" @click="emit('prev')">
        <Icon name="lucide:chevron-left" class="h-4 w-4" />
        <span>Trước</span>
      </button>
      <button type="button" data-testid="admin-pager-next" :disabled="!canNext || loading" :class="ui.btn" @click="emit('next')">
        <span>Sau</span>
        <Icon :name="loading ? 'lucide:loader-2' : 'lucide:chevron-right'" class="h-4 w-4" :class="{ 'animate-spin': loading }" />
      </button>
    </div>
  </nav>
</template>
