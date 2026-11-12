<script setup lang="ts">
import { computed } from 'vue';
import { buildPageTokens } from '~/utils/pagination';

const props = defineProps<{
  page: number;
  pageCount: number;
  hasMore: boolean;
  canPrev: boolean;
  canNext: boolean;
  loading?: boolean;
}>();
const emit = defineEmits<{ prev: []; next: []; goto: [page: number] }>();

// Máy chủ còn dữ liệu: thêm "…" sau trang cuối đã tải để báo còn trang sau.
const tokens = computed(() => {
  const list = buildPageTokens(props.page, props.pageCount);
  return props.hasMore ? [...list, 'more' as const] : list;
});

const navBtnClass =
  'touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet disabled:cursor-not-allowed disabled:opacity-40';
const numBtnClass =
  'touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border font-mono text-sm font-semibold transition disabled:cursor-not-allowed';
</script>

<template>
  <nav
    aria-label="Phân trang"
    data-testid="user-pager"
    class="flex flex-wrap items-center justify-between gap-3"
  >
    <span data-testid="user-pager-label" class="font-mono text-xs text-cyber-muted">
      Trang {{ page }} / {{ pageCount }}<template v-if="hasMore">+</template>
    </span>

    <div class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        data-testid="user-pager-prev"
        aria-label="Trang trước"
        :disabled="!canPrev || loading"
        :class="navBtnClass"
        @click="emit('prev')"
      >
        <Icon name="lucide:chevron-left" class="h-4 w-4" />
        <span class="hidden sm:inline">Trước</span>
      </button>

      <template v-for="(token, idx) in tokens" :key="`${token}-${idx}`">
        <span
          v-if="token === 'ellipsis' || token === 'more'"
          data-testid="user-pager-ellipsis"
          aria-hidden="true"
          class="inline-flex min-h-[48px] min-w-[32px] items-center justify-center font-mono text-sm text-cyber-muted"
        >
          …
        </span>
        <button
          v-else
          type="button"
          :data-testid="`user-pager-page-${token}`"
          :aria-label="`Trang ${token}`"
          :aria-current="token === page ? 'page' : undefined"
          :disabled="loading"
          :class="[
            numBtnClass,
            token === page
              ? 'border-cyber-violet bg-cyber-violet/20 text-cyber-text'
              : 'border-cyber-border bg-cyber-bg text-cyber-muted hover:border-cyber-violet hover:text-cyber-text',
          ]"
          @click="token !== page && emit('goto', token)"
        >
          {{ token }}
        </button>
      </template>

      <button
        type="button"
        data-testid="user-pager-next"
        aria-label="Trang sau"
        :disabled="!canNext || loading"
        :class="navBtnClass"
        @click="emit('next')"
      >
        <span class="hidden sm:inline">Sau</span>
        <Icon
          :name="loading ? 'lucide:loader-2' : 'lucide:chevron-right'"
          class="h-4 w-4"
          :class="{ 'animate-spin': loading }"
        />
      </button>
    </div>
  </nav>
</template>
