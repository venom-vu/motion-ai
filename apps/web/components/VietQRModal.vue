<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { Topup, TopupPackId } from '@flowvis/contracts';
import { formatNumberVi, formatVndVi } from '~/utils/catalog';
import {
  formatCountdown,
  generateQrSvg,
  getRemainingSeconds,
  getTopupStatusBadgeClass,
  getTopupStatusLabelVi,
  isApprovalDeferred,
  isQrExpired,
  OFF_HOURS_MESSAGE_VI,
} from '~/utils/topup';

const props = withDefaults(
  defineProps<{
    open: boolean;
    topup: Topup | null;
    isCreating?: boolean;
    isConfirming?: boolean;
    confirmErrorVi?: string | null;
    remainingSeconds?: number;
    isExpired?: boolean;
    formattedCountdown?: string;
    isOutsideHours?: boolean;
  }>(),
  {
    isCreating: false,
    isConfirming: false,
    confirmErrorVi: null,
    remainingSeconds: undefined,
    isExpired: undefined,
    formattedCountdown: undefined,
    isOutsideHours: undefined,
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'confirm'): void;
  (e: 'recreate', pack: TopupPackId): void;
}>();

const qrSvg = ref<string>('');
const copiedField = ref<'content' | 'account' | null>(null);

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    emit('close');
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (typeof document !== 'undefined') {
      if (isOpen) {
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKeydown);
      } else {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', onKeydown);
      }
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
    window.removeEventListener('keydown', onKeydown);
  }
});

const resolvedCountdown = computed<string>(() => {
  if (props.formattedCountdown !== undefined) {
    return props.formattedCountdown;
  }
  if (!props.topup) {
    return '00:00';
  }
  const rem =
    props.remainingSeconds !== undefined
      ? props.remainingSeconds
      : getRemainingSeconds(props.topup.qrExpiresAt);
  return formatCountdown(rem);
});

const resolvedIsExpired = computed<boolean>(() => {
  if (props.isExpired !== undefined) {
    return props.isExpired;
  }
  if (!props.topup) {
    return false;
  }
  if (props.topup.status === 'expired') {
    return true;
  }
  if (props.topup.status === 'awaiting_transfer') {
    return isQrExpired(props.topup.qrExpiresAt);
  }
  return false;
});

const resolvedIsOutsideHours = computed<boolean>(() => {
  if (props.isOutsideHours !== undefined) {
    return props.isOutsideHours;
  }
  if (!props.topup) {
    return false;
  }
  return isApprovalDeferred(props.topup);
});

const packName = computed<string>(() => {
  if (!props.topup) {
    return '';
  }
  const p = props.topup.pack;
  return p.charAt(0).toUpperCase() + p.slice(1);
});

let qrRequestSeq = 0;

async function loadQrSvg(): Promise<void> {
  // Mỗi lần gọi có số thứ tự riêng: kết quả của đơn cũ về muộn không được ghi đè QR của đơn mới.
  const seq = ++qrRequestSeq;
  const payload = props.topup?.qrPayload;
  if (!payload) {
    qrSvg.value = '';
    return;
  }
  try {
    const svg = await generateQrSvg(payload);
    if (seq === qrRequestSeq) qrSvg.value = svg;
  } catch {
    if (seq === qrRequestSeq) qrSvg.value = '';
  }
}

watch(
  () => props.topup?.qrPayload,
  () => {
    void loadQrSvg();
  },
  { immediate: true },
);

async function copyText(
  text: string,
  field: 'content' | 'account',
): Promise<void> {
  let copied = false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
  }
  if (!copied && typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch {
      copied = false;
    }
  }
  if (copied) {
    copiedField.value = field;
    setTimeout(() => {
      if (copiedField.value === field) {
        copiedField.value = null;
      }
    }, 2000);
  }
}

function handleRecreate(): void {
  if (props.topup?.pack) {
    emit('recreate', props.topup.pack);
  }
}
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->
  <div
    v-if="open && topup"
    data-testid="vietqr-modal-backdrop"
    class="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-cyber-bg/80 p-3 backdrop-blur-sm sm:p-6"
    @click.self="emit('close')"
  >
    <!-- Centered Dialog Modal trên cả mobile và desktop (bố cục ngang rộng rãi, tránh cuộn dọc) -->
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vietqr-modal-title"
      data-testid="vietqr-modal"
      class="relative max-h-[92dvh] w-full max-w-[740px] overflow-y-auto rounded-2xl border border-cyber-border bg-cyber-surface text-cyber-text shadow-2xl"
    >
      <!-- Modal Header chuẩn Slate Cyber -->
      <div
        class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-cyber-border bg-cyber-surface/95 px-5 py-3.5 backdrop-blur"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon name="lucide:qr-code" class="h-5 w-5" />
          </span>
          <div class="min-w-0">
            <h2
              id="vietqr-modal-title"
              data-testid="vietqr-modal-title"
              class="font-display text-base font-bold text-cyber-text sm:text-lg"
            >
              Nạp Credit Qua VietQR
            </h2>
            <p class="truncate text-xs text-cyber-muted">
              Gói {{ packName }} •
              <span class="font-mono font-semibold text-cyber-cyan">{{
                formatVndVi(topup.amountVnd)
              }}</span>
              •
              <span class="font-mono font-semibold text-cyber-text">+{{ formatNumberVi(topup.credits) }} CR</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="vietqr-modal-close-button"
          aria-label="Đóng"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl border border-cyber-border bg-cyber-bg/80 p-2.5 text-cyber-muted transition hover:border-cyber-violet hover:text-cyber-text"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <div class="space-y-3.5 p-4 sm:p-5">
        <!-- Lỗi xác nhận chuyển khoản -->
        <div
          v-if="confirmErrorVi"
          data-testid="vietqr-confirm-error"
          aria-live="polite"
          class="flex items-start gap-2.5 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-3 text-xs text-cyber-danger"
        >
          <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ confirmErrorVi }}</span>
        </div>

        <!-- Trạng thái 1: awaiting_transfer (Chờ chuyển khoản - Bố cục 2 cột ngang) -->
        <template v-if="topup.status === 'awaiting_transfer'">
          <div
            data-testid="vietqr-card"
            class="grid grid-cols-1 gap-4 sm:grid-cols-[236px_minmax(0,1fr)] sm:items-stretch"
          >
            <!-- Cột trái: Đếm ngược + Mã QR + Hướng dẫn quét -->
            <div
              class="flex flex-col items-center justify-between gap-3 rounded-2xl border border-cyber-border bg-cyber-bg/70 p-4"
            >
              <!-- Đếm ngược thời gian thanh toán -->
              <div
                v-if="!resolvedIsExpired"
                data-testid="vietqr-timer-pill"
                aria-live="polite"
                class="inline-flex items-center gap-1.5 rounded-full border border-cyber-warning/40 bg-cyber-warning/15 px-3 py-1 text-xs font-semibold text-cyber-warning"
              >
                <Icon name="lucide:clock" class="h-3.5 w-3.5" />
                <span>
                  Hết hạn sau:
                  <strong class="font-mono text-cyber-text">{{
                    resolvedCountdown
                  }}</strong>
                </span>
              </div>

              <div
                v-else
                data-testid="vietqr-expired-pill"
                aria-live="polite"
                class="inline-flex items-center gap-1.5 rounded-full border border-cyber-danger/40 bg-cyber-danger/15 px-3 py-1 text-xs font-bold text-cyber-danger"
              >
                <Icon name="lucide:alert-circle" class="h-3.5 w-3.5" />
                <span>Mã đã hết hạn</span>
              </div>

              <!-- Khung QR SVG -->
              <div
                data-testid="vietqr-box"
                class="relative flex h-[196px] w-[196px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-cyber-border bg-white p-2.5 shadow-lg"
              >
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div
                  v-if="qrSvg"
                  data-testid="vietqr-svg-container"
                  class="flex h-full w-full items-center justify-center transition [&>svg]:h-full [&>svg]:w-full"
                  :class="{ 'opacity-25 blur-[2px]': resolvedIsExpired }"
                  v-html="qrSvg"
                />
                <div
                  v-else
                  class="flex h-full w-full items-center justify-center text-xs text-cyber-muted"
                >
                  Đang tạo mã QR...
                </div>
                <div
                  v-if="resolvedIsExpired"
                  data-testid="vietqr-expired-overlay"
                  class="absolute inset-0 flex flex-col items-center justify-center bg-cyber-bg/85 p-3 text-center text-cyber-text"
                >
                  <Icon
                    name="lucide:alert-circle"
                    class="mb-1.5 h-6 w-6 text-cyber-danger"
                  />
                  <span class="text-xs font-bold text-cyber-danger">Mã đã hết hạn</span>
                </div>
              </div>

              <!-- Hướng dẫn thanh toán gọn dưới mã QR -->
              <p class="text-center text-[11px] leading-relaxed text-cyber-muted">
                Quét mã bằng ứng dụng ngân hàng để tự động điền số tiền &amp; nội dung chính xác 100%.
              </p>
            </div>

            <!-- Cột phải: Bảng chi tiết chuyển khoản + Cảnh báo + Nút hành động -->
            <div class="flex min-w-0 flex-col justify-between gap-3">
              <!-- Bảng chi tiết chuyển khoản chuẩn Slate Cyber -->
              <div
                class="w-full divide-y divide-cyber-border overflow-hidden rounded-2xl border border-cyber-border bg-cyber-bg/70 text-xs"
              >
                <div class="grid grid-cols-2 divide-x divide-cyber-border">
                  <div class="px-3.5 py-2.5">
                    <span class="block text-[11px] text-cyber-muted">Số tiền cần chuyển</span>
                    <span
                      data-testid="vietqr-amount"
                      class="mt-0.5 block font-mono text-sm font-bold text-cyber-cyan"
                    >
                      {{ formatVndVi(topup.amountVnd) }}
                    </span>
                  </div>

                  <div class="px-3.5 py-2.5">
                    <span class="block text-[11px] text-cyber-muted">Credit nhận được</span>
                    <span
                      class="mt-0.5 block font-mono text-sm font-bold text-cyber-success"
                    >
                      +{{ formatNumberVi(topup.credits) }} CR
                    </span>
                  </div>
                </div>

                <div class="grid grid-cols-2 divide-x divide-cyber-border">
                  <div class="px-3.5 py-2.5">
                    <span class="block text-[11px] text-cyber-muted">Ngân hàng</span>
                    <span
                      data-testid="vietqr-bank"
                      class="mt-0.5 block font-mono font-semibold text-cyber-text"
                    >
                      {{ topup.bankCode }}
                    </span>
                  </div>

                  <div class="px-3.5 py-2.5">
                    <span class="block text-[11px] text-cyber-muted">Chủ tài khoản</span>
                    <span
                      data-testid="vietqr-account-name"
                      class="mt-0.5 block truncate font-mono font-semibold uppercase text-cyber-text"
                    >
                      {{ topup.accountName }}
                    </span>
                  </div>
                </div>

                <div class="flex items-center justify-between gap-3 px-3.5 py-2">
                  <div class="min-w-0 space-y-0.5">
                    <span class="block text-[11px] text-cyber-muted">Số tài khoản nhận</span>
                    <span
                      data-testid="vietqr-account-number"
                      class="block break-all font-mono text-sm font-bold text-cyber-text"
                    >
                      {{ topup.accountNumber }}
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="copy-account-button"
                    class="touch-target inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-surface px-3 py-2 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
                    @click="copyText(topup.accountNumber, 'account')"
                  >
                    <Icon
                      :name="
                        copiedField === 'account'
                          ? 'lucide:check'
                          : 'lucide:copy'
                      "
                      class="h-3.5 w-3.5"
                      :class="
                        copiedField === 'account'
                          ? 'text-cyber-success'
                          : 'text-cyber-cyan'
                      "
                    />
                    <span>{{
                      copiedField === 'account' ? 'Đã chép' : 'Sao chép'
                    }}</span>
                  </button>
                </div>

                <div class="flex items-center justify-between gap-3 px-3.5 py-2">
                  <div class="min-w-0 space-y-0.5">
                    <span class="block text-[11px] text-cyber-muted">Nội dung chuyển khoản (bắt buộc)</span>
                    <span
                      data-testid="vietqr-content"
                      class="block break-all font-mono text-sm font-bold text-cyber-violet"
                    >
                      {{ topup.transferContent }}
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="copy-content-button"
                    class="touch-target inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-surface px-3 py-2 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
                    @click="copyText(topup.transferContent, 'content')"
                  >
                    <Icon
                      :name="
                        copiedField === 'content'
                          ? 'lucide:check'
                          : 'lucide:copy'
                      "
                      class="h-3.5 w-3.5"
                      :class="
                        copiedField === 'content'
                          ? 'text-cyber-success'
                          : 'text-cyber-cyan'
                      "
                    />
                    <span>{{
                      copiedField === 'content' ? 'Đã chép' : 'Sao chép'
                    }}</span>
                  </button>
                </div>
              </div>

              <!-- Banner giải thích ngoài khung giờ (08:00 - 23:00 UTC+7) -->
              <div
                v-if="resolvedIsOutsideHours"
                data-testid="vietqr-off-hours-banner"
                aria-live="polite"
                class="flex items-start gap-2 rounded-xl border border-cyber-cyan/40 bg-cyber-cyan/10 px-3 py-2.5 text-xs leading-relaxed text-cyber-cyan"
              >
                <Icon name="lucide:info" class="mt-0.5 h-4 w-4 shrink-0" />
                <span>{{ OFF_HOURS_MESSAGE_VI }}</span>
              </div>

              <!-- Hướng dẫn liên hệ nếu đã chuyển khoản khi mã hết hạn -->
              <div
                v-if="resolvedIsExpired"
                data-testid="vietqr-expired-contact-hint"
                aria-live="polite"
                class="flex items-start gap-2 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 px-3 py-2.5 text-xs leading-relaxed text-cyber-danger"
              >
                <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Nếu bạn đã lỡ chuyển khoản sau khi mã hết hạn, vui lòng liên hệ bộ
                  phận hỗ trợ kèm mã giao dịch ngân hàng để được hỗ trợ cộng credit
                  thủ công.
                </span>
              </div>

              <!-- Các nút thao tác -->
              <div>
                <button
                  v-if="!resolvedIsExpired"
                  type="button"
                  data-testid="confirm-transfer-button"
                  :disabled="isConfirming"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-violet px-5 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
                  @click="emit('confirm')"
                >
                  <Icon
                    :name="isConfirming ? 'lucide:loader-2' : 'lucide:check'"
                    class="h-4 w-4"
                    :class="{ 'animate-spin': isConfirming }"
                  />
                  <span>{{
                    isConfirming
                      ? 'Đang gửi xác nhận...'
                      : 'Tôi Đã Chuyển Khoản Xong'
                  }}</span>
                </button>

                <div v-else class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled
                    class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-3.5 py-2.5 text-xs font-semibold text-cyber-muted opacity-50"
                  >
                    <Icon name="lucide:check" class="h-4 w-4" />
                    <span>Tôi Đã Chuyển Khoản Xong</span>
                  </button>

                  <button
                    type="button"
                    data-testid="recreate-order-button"
                    :disabled="isCreating"
                    class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-violet px-3.5 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:opacity-50"
                    @click="handleRecreate"
                  >
                    <Icon
                      :name="isCreating ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                      class="h-4 w-4"
                      :class="{ 'animate-spin': isCreating }"
                    />
                    <span>{{
                      isCreating ? 'Đang tạo mã mới...' : 'Tạo mã mới'
                    }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Trạng thái 2: pending (Đang chờ duyệt) -->
        <template v-else-if="topup.status === 'pending'">
          <div
            data-testid="vietqr-pending-card"
            aria-live="polite"
            class="space-y-4 rounded-2xl border border-cyber-border bg-cyber-bg/70 p-5"
          >
            <div class="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyber-cyan/40 bg-cyber-cyan/15 text-cyber-cyan"
              >
                <Icon name="lucide:clock" class="h-6 w-6" />
              </div>

              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h3 class="font-display text-base font-bold text-cyber-text">
                    Đã ghi nhận xác nhận chuyển khoản
                  </h3>
                  <span
                    class="inline-block rounded-full border px-3 py-0.5 font-mono text-xs font-semibold"
                    :class="getTopupStatusBadgeClass(topup.status)"
                  >
                    {{ getTopupStatusLabelVi(topup.status) }}
                  </span>
                </div>
                <p class="text-xs leading-relaxed text-cyber-muted">
                  Hệ thống sẽ đối chiếu với giao dịch ngân hàng và tự động cộng
                  credit vào tài khoản của bạn.
                </p>
              </div>
            </div>

            <div
              v-if="resolvedIsOutsideHours"
              data-testid="vietqr-pending-off-hours-banner"
              aria-live="polite"
              class="rounded-xl border border-cyber-cyan/40 bg-cyber-cyan/10 p-3 text-left text-xs leading-relaxed text-cyber-cyan"
            >
              <div class="flex items-start gap-2">
                <Icon name="lucide:info" class="mt-0.5 h-4 w-4 shrink-0" />
                <span>{{ OFF_HOURS_MESSAGE_VI }}</span>
              </div>
            </div>

            <div
              class="grid grid-cols-1 divide-y divide-cyber-border overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface text-left text-xs sm:grid-cols-3 sm:divide-x sm:divide-y-0"
            >
              <div class="px-3.5 py-2.5">
                <span class="block text-[11px] text-cyber-muted">Mã đơn</span>
                <span class="mt-0.5 block font-mono font-bold text-cyber-text">NAP {{ topup.code }}</span>
              </div>
              <div class="px-3.5 py-2.5">
                <span class="block text-[11px] text-cyber-muted">Số tiền</span>
                <span class="mt-0.5 block font-mono font-bold text-cyber-cyan">{{
                  formatVndVi(topup.amountVnd)
                }}</span>
              </div>
              <div class="px-3.5 py-2.5">
                <span class="block text-[11px] text-cyber-muted">Credit nhận được</span>
                <span class="mt-0.5 block font-mono font-bold text-cyber-success">+{{ formatNumberVi(topup.credits) }} CR</span>
              </div>
            </div>

            <button
              type="button"
              data-testid="vietqr-close-pending-button"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
              @click="emit('close')"
            >
              <span>Đóng cửa sổ</span>
            </button>
          </div>
        </template>

        <!-- Trạng thái 3: approved (Đã duyệt) -->
        <template v-else-if="topup.status === 'approved'">
          <div
            data-testid="vietqr-approved-card"
            aria-live="polite"
            class="space-y-4 rounded-2xl border border-cyber-success/40 bg-cyber-success/10 p-5"
          >
            <div class="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyber-success/40 bg-cyber-success/20 text-cyber-success"
              >
                <Icon name="lucide:check-circle-2" class="h-6 w-6" />
              </div>

              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h3 class="font-display text-base font-bold text-cyber-text">
                    Nạp credit thành công!
                  </h3>
                  <span
                    class="inline-block rounded-full border px-3 py-0.5 font-mono text-xs font-semibold"
                    :class="getTopupStatusBadgeClass(topup.status)"
                  >
                    {{ getTopupStatusLabelVi(topup.status) }}
                  </span>
                </div>
                <p class="text-xs leading-relaxed text-cyber-muted">
                  Đã cộng
                  <strong class="font-mono text-cyber-success">+{{ formatNumberVi(topup.credits) }} credit</strong>
                  vào tài khoản. Hạng tài khoản đã được nâng cấp theo gói.
                </p>
              </div>
            </div>

            <div
              v-if="topup.bankRef"
              class="rounded-xl border border-cyber-border bg-cyber-surface px-3.5 py-2.5 text-left text-xs"
            >
              <div class="flex justify-between">
                <span class="text-cyber-muted">Mã GD Ngân Hàng</span>
                <span class="font-mono font-bold text-cyber-text">{{
                  topup.bankRef
                }}</span>
              </div>
            </div>

            <button
              type="button"
              data-testid="vietqr-finish-approved-button"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
              @click="emit('close')"
            >
              <Icon name="lucide:sparkles" class="h-4 w-4" />
              <span>Bắt đầu sáng tạo</span>
            </button>
          </div>
        </template>

        <!-- Trạng thái 4: rejected (Bị từ chối) -->
        <template v-else-if="topup.status === 'rejected'">
          <div
            data-testid="vietqr-rejected-card"
            aria-live="polite"
            class="space-y-4 rounded-2xl border border-cyber-danger/40 bg-cyber-danger/10 p-5"
          >
            <div class="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyber-danger/40 bg-cyber-danger/20 text-cyber-danger"
              >
                <Icon name="lucide:alert-circle" class="h-6 w-6" />
              </div>

              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h3 class="font-display text-base font-bold text-cyber-text">
                    Đơn nạp bị từ chối
                  </h3>
                  <span
                    class="inline-block rounded-full border px-3 py-0.5 font-mono text-xs font-semibold"
                    :class="getTopupStatusBadgeClass(topup.status)"
                  >
                    {{ getTopupStatusLabelVi(topup.status) }}
                  </span>
                </div>
                <p
                  v-if="topup.rejectReason"
                  data-testid="vietqr-reject-reason"
                  class="text-xs font-medium text-cyber-danger"
                >
                  Lý do: {{ topup.rejectReason }}
                </p>
                <p class="text-xs leading-relaxed text-cyber-muted">
                  Vui lòng kiểm tra lại sao kê hoặc liên hệ bộ phận hỗ trợ để được
                  trợ giúp.
                </p>
              </div>
            </div>

            <div class="flex gap-2.5">
              <button
                type="button"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] flex-1 items-center justify-center rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
                @click="emit('close')"
              >
                Đóng
              </button>
              <button
                type="button"
                data-testid="vietqr-recreate-rejected-button"
                :disabled="isCreating"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:opacity-50"
                @click="handleRecreate"
              >
                <Icon
                  :name="isCreating ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                  class="h-4 w-4"
                  :class="{ 'animate-spin': isCreating }"
                />
                <span>{{ isCreating ? 'Đang tạo...' : 'Tạo đơn mới' }}</span>
              </button>
            </div>
          </div>
        </template>

        <!-- Trạng thái 5: needs_review (Cần xem xét) -->
        <template v-else-if="topup.status === 'needs_review'">
          <div
            data-testid="vietqr-needs-review-card"
            aria-live="polite"
            class="space-y-4 rounded-2xl border border-cyber-warning/40 bg-cyber-warning/10 p-5"
          >
            <div class="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyber-warning/40 bg-cyber-warning/20 text-cyber-warning"
              >
                <Icon name="lucide:alert-circle" class="h-6 w-6" />
              </div>

              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h3 class="font-display text-base font-bold text-cyber-text">
                    Đơn nạp cần xem xét
                  </h3>
                  <span
                    class="inline-block rounded-full border px-3 py-0.5 font-mono text-xs font-semibold"
                    :class="getTopupStatusBadgeClass(topup.status)"
                  >
                    {{ getTopupStatusLabelVi(topup.status) }}
                  </span>
                </div>
                <p
                  v-if="topup.note"
                  data-testid="vietqr-review-note"
                  class="text-xs font-medium text-cyber-warning"
                >
                  Ghi chú: {{ topup.note }}
                </p>
                <p class="text-xs leading-relaxed text-cyber-muted">
                  Đơn nạp đang được Admin đối chiếu thủ công. Bạn có thể liên hệ
                  bộ phận hỗ trợ để xử lý nhanh hơn.
                </p>
              </div>
            </div>

            <button
              type="button"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
              @click="emit('close')"
            >
              Đóng
            </button>
          </div>
        </template>

        <!-- Trạng thái 6: expired (Đã hết hạn) -->
        <template v-else-if="topup.status === 'expired'">
          <div
            data-testid="vietqr-expired-card"
            aria-live="polite"
            class="space-y-4 rounded-2xl border border-cyber-border bg-cyber-bg/70 p-5"
          >
            <div class="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyber-border bg-cyber-surface text-cyber-muted"
              >
                <Icon name="lucide:clock" class="h-6 w-6" />
              </div>

              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h3 class="font-display text-base font-bold text-cyber-text">
                    Mã QR đã hết hạn
                  </h3>
                  <span
                    class="inline-block rounded-full border px-3 py-0.5 font-mono text-xs font-semibold"
                    :class="getTopupStatusBadgeClass(topup.status)"
                  >
                    {{ getTopupStatusLabelVi(topup.status) }}
                  </span>
                </div>
                <p class="text-xs leading-relaxed text-cyber-muted">
                  Thời gian giữ phiên thanh toán đã kết thúc. Vui lòng tạo mã QR
                  mới để nạp credit.
                </p>
              </div>
            </div>

            <div class="flex gap-2.5">
              <button
                type="button"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] flex-1 items-center justify-center rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
                @click="emit('close')"
              >
                Đóng
              </button>
              <button
                type="button"
                data-testid="vietqr-recreate-expired-button"
                :disabled="isCreating"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:opacity-50"
                @click="handleRecreate"
              >
                <Icon
                  :name="isCreating ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                  class="h-4 w-4"
                  :class="{ 'animate-spin': isCreating }"
                />
                <span>{{ isCreating ? 'Đang tạo...' : 'Tạo mã mới' }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
