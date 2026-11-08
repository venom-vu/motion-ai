<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "#imports";
// import { TOS_VERSION } from '@motion-ai/contracts';
import { useAuthDialog } from "~/composables/useAuthDialog";
import { usePricingConfig } from "~/composables/usePricingConfig";
import { resolveApiErrorMessageVi } from "~/utils/api-client";
import { formatNumberVi } from "~/utils/catalog";

const { pricing, me } = usePricingConfig();
const { mode, errorVi, open, close } = useAuthDialog();
const route = useRoute();
const router = useRouter();

function handleKeydown(event: KeyboardEvent): void {
  if (mode.value && event.key === "Escape") {
    close();
  }
}

// Đăng nhập thành công thì tự đóng dialog đăng nhập.
watch(me, (next) => {
  if (next && mode.value === "login") {
    close();
  }
});

// BE redirect về /?authError=<code> khi Google OAuth thất bại: mở lại dialog kèm thông báo.
onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  const err = route.query.authError;
  if (typeof err === "string" && err) {
    open("login", resolveApiErrorMessageVi(err));
    void router.replace({ path: route.path, query: {} });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div
    v-if="mode"
    role="dialog"
    aria-modal="true"
    aria-labelledby="auth-dialog-title"
    data-testid="auth-dialog"
    class="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-cyber-bg/80 p-3 backdrop-blur-sm sm:p-6"
    @click.self="close"
  >
    <div
      class="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-cyber-border bg-cyber-surface p-6 text-cyber-text shadow-2xl"
    >
      <button
        type="button"
        aria-label="Đóng"
        class="touch-target absolute right-3 top-3 inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl text-cyber-muted transition hover:text-cyber-text"
        @click="close"
      >
        <Icon name="lucide:x" class="h-5 w-5" />
      </button>

      <!-- Đăng nhập -->
      <template v-if="mode === 'login'">
        <div class="flex items-center gap-3 pr-12">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon name="lucide:shield-check" class="h-6 w-6" />
          </span>
          <div>
            <h2 id="auth-dialog-title" class="font-display text-xl font-bold">
              Đăng Nhập
            </h2>
            <!-- <p class="text-xs text-cyber-muted">
              Điều khoản phiên bản
              <span class="font-mono text-cyber-cyan">{{ TOS_VERSION }}</span>
            </p> -->
          </div>
        </div>

        <p v-if="pricing" class="mt-2.5 text-sm text-cyber-muted">
          Tài khoản đăng ký lần đầu được tặng
          <span class="font-mono font-semibold text-cyber-cyan">
            {{ formatNumberVi(pricing.trialGrantCredits) }} credit
          </span>
          dùng thử.
        </p>

        <div class="mt-3">
          <LoginConsentForm id-prefix="dialog" :initial-error-vi="errorVi" />
        </div>
      </template>

      <!-- Thông tin tài khoản -->
      <template v-else>
        <div class="flex items-center gap-3 pr-12">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon name="lucide:user-round" class="h-6 w-6" />
          </span>
          <div class="min-w-0">
            <h2 id="auth-dialog-title" class="font-display text-xl font-bold">
              Tài Khoản
            </h2>
            <p class="truncate font-mono text-xs text-cyber-muted">
              {{ me?.email ?? "Đang tải..." }}
            </p>
          </div>
        </div>

        <dl v-if="me" class="mt-5 grid grid-cols-2 gap-3 text-xs">
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Vai trò</dt>
            <dd class="mt-1 font-mono">{{ me.role }}</dd>
          </div>
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Hạng</dt>
            <dd class="mt-1 font-mono">{{ me.tier }}</dd>
          </div>
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Số dư khả dụng</dt>
            <dd class="mt-1 font-mono font-bold text-cyber-cyan">
              {{ formatNumberVi(me.balance) }} CR
            </dd>
          </div>
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3">
            <dt class="text-cyber-muted">Đang tạm giữ</dt>
            <dd class="mt-1 font-mono font-bold text-cyber-warning">
              {{ formatNumberVi(me.held) }} CR
            </dd>
          </div>
          <div
            class="col-span-2 rounded-xl border border-cyber-border bg-cyber-bg/70 p-3"
          >
            <dt class="text-cyber-muted">Điều khoản đã đồng ý</dt>
            <dd class="mt-1 font-mono">{{ me.tosVersion }}</dd>
          </div>
        </dl>
      </template>
    </div>
  </div>
</template>
