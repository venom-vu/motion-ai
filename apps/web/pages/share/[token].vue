<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue';
import {
  setResponseStatus,
  useAsyncData,
  useHead,
  useRequestEvent,
  useRequestURL,
  useRoute,
  useRuntimeConfig,
} from '#imports';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

interface SharePageState {
  notFound: boolean;
  rateLimited: boolean;
  imageUrl: string | null;
}

const route = useRoute();
const config = useRuntimeConfig();
const requestUrl = useRequestURL();

const token = computed<string>(() => {
  const raw = route.params.token;
  if (Array.isArray(raw)) {
    return raw[0] || '';
  }
  return typeof raw === 'string' ? raw : '';
});

const apiBaseUrl = computed(() => {
  const raw = (config.public?.apiBaseUrl || 'http://localhost:8080') as string;
  return raw.replace(/\/+$/, '');
});

const { data: asyncState, error: asyncError } = await useAsyncData<SharePageState>(
  `share-page-${token.value}`,
  async () => {
    // Kiểm tra định dạng token (32 byte base64url = 43 ký tự)
    if (!token.value || !TOKEN_RE.test(token.value)) {
      return { notFound: true, rateLimited: false, imageUrl: null };
    }

    const shareEndpoint = `${apiBaseUrl.value}/s/${encodeURIComponent(token.value)}`;
    try {
      // Dùng redirect: 'manual' để không follow 302 sang S3/R2 bằng HEAD (tránh SignatureDoesNotMatch 403)
      const res = await $fetch.raw(shareEndpoint, {
        method: 'HEAD',
        redirect: 'manual',
        ignoreResponseError: true,
      });

      if (res.status === 404) {
        return { notFound: true, rateLimited: false, imageUrl: null };
      }
      if (res.status === 429) {
        return { notFound: false, rateLimited: true, imageUrl: null };
      }
      if (res.status === 302 || res.status === 200) {
        return { notFound: false, rateLimited: false, imageUrl: shareEndpoint };
      }
      if (res.status >= 400) {
        return { notFound: true, rateLimited: false, imageUrl: null };
      }

      return {
        notFound: false,
        rateLimited: false,
        imageUrl: shareEndpoint,
      };
    } catch {
      // Fallback endpoint cho trường hợp mạng lỗi
      return {
        notFound: false,
        rateLimited: false,
        imageUrl: shareEndpoint,
      };
    }
  },
  {
    default: () => ({
      notFound: false,
      rateLimited: false,
      imageUrl: null,
    }),
  },
);

const shareState = ref<SharePageState>({
  notFound: asyncState.value?.notFound ?? false,
  rateLimited: asyncState.value?.rateLimited ?? false,
  imageUrl: asyncState.value?.imageUrl ?? null,
});

// Đồng bộ khi asyncState thay đổi hoặc có asyncError
watchEffect(() => {
  if (asyncError.value) {
    shareState.value = {
      notFound: true,
      rateLimited: false,
      imageUrl: null,
    };
  } else if (asyncState.value) {
    shareState.value = {
      notFound: Boolean(asyncState.value.notFound),
      rateLimited: Boolean(asyncState.value.rateLimited),
      imageUrl: asyncState.value.imageUrl,
    };
  }
});

// Thiết lập mã HTTP 404 trong phản hồi SSR nếu token không tồn tại hoặc đã thu hồi
if (import.meta.server && (shareState.value.notFound || asyncError.value)) {
  const event = useRequestEvent();
  if (event) {
    setResponseStatus(event, 404, 'Not Found');
  }
}

const isNotFound = computed(() => shareState.value.notFound);
const isRateLimited = computed(() => shareState.value.rateLimited);
const currentImageUrl = computed(() => shareState.value.imageUrl);

const pageTitle = computed(() => {
  if (isRateLimited.value) {
    return 'Hệ thống đang bận — Motion AI';
  }
  return isNotFound.value
    ? 'Liên kết không còn tồn tại — Motion AI'
    : 'Kết quả tạo ảnh AI — Motion AI';
});

const pageDescription = computed(() => {
  if (isRateLimited.value) {
    return 'Bạn thao tác quá nhanh hoặc hệ thống đang xử lý nhiều yêu cầu. Vui lòng thử lại sau.';
  }
  return isNotFound.value
    ? 'Đường dẫn chia sẻ này không tồn tại, đã bị thu hồi hoặc đã hết hạn.'
    : 'Xem tác phẩm AI được tạo trên Motion AI. Thử tạo ảnh hoặc video AI miễn phí!';
});

const ogImageUrl = computed(() => {
  if (isNotFound.value || isRateLimited.value) {
    return null;
  }
  return `${apiBaseUrl.value}/s/${encodeURIComponent(token.value)}`;
});

const currentOrigin = computed(() => {
  if (import.meta.client && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return requestUrl?.origin || 'https://motion-ai.vn';
});

const ogUrl = computed(() => {
  return `${currentOrigin.value}/share/${encodeURIComponent(token.value)}`;
});

useHead({
  title: pageTitle,
  meta: [
    { property: 'og:site_name', content: 'Motion AI' },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: () => pageTitle.value },
    { property: 'og:description', content: () => pageDescription.value },
    { property: 'og:url', content: () => ogUrl.value },
    { name: 'description', content: () => pageDescription.value },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: () => pageTitle.value },
    { name: 'twitter:description', content: () => pageDescription.value },
    { property: 'og:image', content: () => ogImageUrl.value ?? undefined },
    { name: 'twitter:image', content: () => ogImageUrl.value ?? undefined },
    {
      name: 'robots',
      content: () => (isNotFound.value ? 'noindex, nofollow' : undefined),
    },
  ],
});

const toastMessage = ref<string | null>(null);
const isDownloading = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  toastMessage.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.value = null;
  }, 3000);
}

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer);
});

function handleImageError(): void {
  // Khi ảnh tải thất bại phía client trình duyệt
  shareState.value.notFound = true;
}

async function handleDownload(): Promise<void> {
  if (!currentImageUrl.value || isDownloading.value) return;
  isDownloading.value = true;
  toastMessage.value = null;

  try {
    const res = await fetch(currentImageUrl.value);
    if (!res.ok) throw new Error('Download request failed');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `motion-ai-shared-${token.value.slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    showToast('Đang tải ảnh HD về máy!');
  } catch {
    // Fallback mở tab mới nếu fetch blob bị lỗi
    window.open(currentImageUrl.value, '_blank');
  } finally {
    isDownloading.value = false;
  }
}

async function handleShareLink(): Promise<void> {
  const url = typeof window !== 'undefined' ? window.location.href : ogUrl.value;
  toastMessage.value = null;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'Kết quả tạo ảnh AI — Motion AI',
        text: 'Xem tác phẩm AI được tạo trên Motion AI:',
        url,
      });
      showToast('Đã mở bảng chia sẻ thành công!');
      return;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Đã sao chép liên kết vào khay nhớ tạm!');
    } catch {
      showToast(`Đường dẫn: ${url}`);
    }
  }
}
</script>

<template>
  <div
    class="mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-6 sm:px-6 sm:py-10"
    data-testid="share-page-container"
  >
    <!-- 1. Trạng thái Quá tải / Rate limited (429) -->
    <div
      v-if="isRateLimited"
      class="flex w-full max-w-md flex-col items-center rounded-2xl border border-cyber-border bg-cyber-surface/90 p-8 text-center shadow-xl backdrop-blur"
      data-testid="share-rate-limit-view"
    >
      <div
        class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyber-border bg-cyber-bg text-amber-400"
      >
        <Icon name="lucide:clock" class="h-8 w-8 text-amber-400" aria-hidden="true" />
      </div>

      <h1 class="text-xl font-bold text-cyber-text sm:text-2xl">
        Hệ thống đang bận
      </h1>

      <p class="mt-3 text-sm leading-relaxed text-cyber-muted">
        Bạn thao tác quá nhanh hoặc hệ thống đang xử lý nhiều yêu cầu. Vui lòng thử lại
        sau ít phút.
      </p>

      <div class="mt-8 flex w-full flex-col gap-3">
        <button
          type="button"
          class="touch-target flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-cyan px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:opacity-90"
          data-testid="retry-share-button"
          @click="() => route.path"
        >
          <Icon name="lucide:refresh-cw" class="h-4 w-4" aria-hidden="true" />
          <span>Thử lại</span>
        </button>

        <NuxtLink
          to="/"
          class="touch-target flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-6 py-3 text-sm font-medium text-cyber-text transition hover:bg-cyber-bg"
          data-testid="back-home-button"
        >
          <Icon name="lucide:arrow-left" class="h-4 w-4" aria-hidden="true" />
          <span>Về trang chủ Motion AI</span>
        </NuxtLink>
      </div>
    </div>

    <!-- 2. Trạng thái không tìm thấy hoặc đã thu hồi (404) -->
    <div
      v-else-if="isNotFound"
      class="flex w-full max-w-md flex-col items-center rounded-2xl border border-cyber-border bg-cyber-surface/90 p-8 text-center shadow-xl backdrop-blur"
      data-testid="share-not-found-view"
    >
      <div
        class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyber-border bg-cyber-bg text-cyber-muted"
      >
        <Icon name="lucide:link-2-off" class="h-8 w-8 text-cyber-muted" aria-hidden="true" />
      </div>

      <h1 class="text-xl font-bold text-cyber-text sm:text-2xl">
        Liên kết không còn tồn tại
      </h1>

      <p class="mt-3 text-sm leading-relaxed text-cyber-muted">
        Đường dẫn chia sẻ này không tồn tại, đã bị thu hồi bởi chủ sở hữu hoặc đã hết hạn
        lưu trữ.
      </p>

      <div class="mt-8 w-full">
        <NuxtLink
          to="/"
          class="touch-target flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-cyan px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:opacity-90"
          data-testid="back-home-button"
        >
          <Icon name="lucide:arrow-left" class="h-4 w-4" aria-hidden="true" />
          <span>Về trang chủ Motion AI</span>
        </NuxtLink>
      </div>
    </div>

    <!-- 3. Trạng thái hiển thị tác phẩm chia sẻ thành công -->
    <div
      v-else
      class="flex w-full flex-col items-center"
      data-testid="share-success-view"
    >
      <!-- Khung ảnh kết quả -->
      <div
        class="group relative flex w-full max-w-2xl flex-col items-center overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface/90 shadow-2xl backdrop-blur"
        data-testid="share-image-frame"
      >
        <!-- Badge thông tin tác phẩm -->
        <div
          class="flex w-full items-center justify-between border-b border-cyber-border/80 bg-cyber-bg/60 px-4 py-3 sm:px-6"
        >
          <div class="flex items-center gap-2">
            <span
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-cyber-cyan/10 text-cyber-cyan"
            >
              <Icon name="lucide:sparkles" class="h-4 w-4" aria-hidden="true" />
            </span>
            <span class="text-xs font-medium text-cyber-text sm:text-sm">
              Tác phẩm AI từ Motion AI
            </span>
          </div>

          <span
            class="rounded-md border border-cyber-cyan/20 bg-cyber-cyan/10 px-2.5 py-1 text-[11px] font-medium text-cyber-cyan"
            data-testid="share-tag"
          >
            Công khai
          </span>
        </div>

        <!-- Ảnh kết quả -->
        <div
          class="relative flex min-h-[260px] w-full items-center justify-center bg-cyber-bg/40 p-2 sm:p-4"
        >
          <img
            v-if="currentImageUrl"
            :src="currentImageUrl"
            alt="Kết quả tạo ảnh AI — Motion AI"
            class="max-h-[75vh] w-full max-w-full rounded-xl object-contain shadow-md"
            data-testid="share-result-image"
            @error="handleImageError"
          />
          <div
            v-else
            class="flex h-64 w-full items-center justify-center text-sm text-cyber-muted"
          >
            Đang tải ảnh tác phẩm...
          </div>
        </div>
      </div>

      <!-- Khung thông báo sao chép Toast -->
      <div
        v-if="toastMessage"
        role="status"
        aria-live="polite"
        class="mt-4 flex items-center gap-2 rounded-xl border border-cyber-cyan/30 bg-cyber-surface px-4 py-2 text-xs font-medium text-cyber-cyan shadow sm:text-sm"
        data-testid="share-toast"
      >
        <Icon name="lucide:check" class="h-4 w-4 text-cyber-cyan" aria-hidden="true" />
        <span>{{ toastMessage }}</span>
      </div>

      <!-- Các nút hành động & Kêu gọi dùng thử (CTA) -->
      <div
        class="mt-6 flex w-full max-w-2xl flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center"
      >
        <!-- Nút Kêu gọi dùng thử (Chính) -->
        <NuxtLink
          to="/"
          class="touch-target flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-cyber-cyan px-6 py-3.5 text-center text-sm font-semibold text-zinc-950 shadow-lg shadow-cyber-cyan/20 transition hover:opacity-90 hover:shadow-cyber-cyan/30"
          data-testid="try-motion-ai-button"
        >
          <Icon name="lucide:sparkles" class="h-4 w-4" aria-hidden="true" />
          <span>Thử tạo ảnh tương tự miễn phí</span>
        </NuxtLink>

        <!-- Nút Tải ảnh HD -->
        <button
          type="button"
          :disabled="isDownloading"
          class="touch-target flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-5 py-3.5 text-sm font-medium text-cyber-text transition hover:border-cyber-muted hover:bg-cyber-bg disabled:opacity-60"
          data-testid="download-share-image-button"
          @click="handleDownload"
        >
          <Icon name="lucide:download" class="h-4 w-4 text-cyber-muted" aria-hidden="true" />
          <span>{{ isDownloading ? 'Đang tải...' : 'Tải ảnh HD' }}</span>
        </button>

        <!-- Nút Chia sẻ liên kết -->
        <button
          type="button"
          class="touch-target flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-5 py-3.5 text-sm font-medium text-cyber-text transition hover:border-cyber-muted hover:bg-cyber-bg"
          data-testid="re-share-button"
          @click="handleShareLink"
        >
          <Icon name="lucide:share-2" class="h-4 w-4 text-cyber-muted" aria-hidden="true" />
          <span>Chia sẻ</span>
        </button>
      </div>
    </div>
  </div>
</template>
