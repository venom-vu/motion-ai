import { computed, ref, watch, type Ref } from 'vue';

export const ADMIN_PAGE_SIZE = 20;

/**
 * Phân trang theo số trang trên danh sách tải theo cursor: các trang đã tải được giữ lại,
 * bấm "Sau" ở trang cuối mới gọi loadMore() lấy thêm từ máy chủ.
 */
export function useCursorPager<T>(
  items: Ref<T[]>,
  hasMore: Ref<boolean>,
  loadMore: () => Promise<unknown>,
  pageSize: number = ADMIN_PAGE_SIZE,
) {
  const page = ref(1);
  const isPaging = ref(false);
  const pageCount = computed(() => Math.max(1, Math.ceil(items.value.length / pageSize)));
  const pageItems = computed(() =>
    items.value.slice((page.value - 1) * pageSize, page.value * pageSize),
  );
  const canPrev = computed(() => page.value > 1);
  const canNext = computed(() => page.value < pageCount.value || hasMore.value);

  // Danh sách bị tải lại ngắn hơn thì kéo trang hiện tại về trang cuối còn dữ liệu.
  watch(pageCount, (n) => {
    if (page.value > n) page.value = n;
  });

  async function next(): Promise<void> {
    if (isPaging.value || !canNext.value) return;
    if (page.value < pageCount.value) {
      page.value += 1;
      return;
    }
    isPaging.value = true;
    try {
      await loadMore();
    } finally {
      isPaging.value = false;
    }
    if (page.value < pageCount.value) page.value += 1;
  }

  function prev(): void {
    if (canPrev.value) page.value -= 1;
  }

  /** Nhảy tới một trang đã tải. */
  function goTo(target: number): void {
    if (isPaging.value) return;
    page.value = Math.min(Math.max(1, Math.trunc(target)), pageCount.value);
  }

  function reset(): void {
    page.value = 1;
  }

  return { page, pageCount, pageItems, canPrev, canNext, isPaging, next, prev, goTo, reset };
}
