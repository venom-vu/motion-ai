<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { Topup, TopupPackId } from '@motion-ai/contracts';
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
    class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-cyber-bg/80 p-4 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <!-- Centered Dialog Modal trên cả mobile và desktop -->
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vietqr-modal-title"
      data-testid="vietqr-modal"
      class="relative my-auto w-full max-w-[440px] space-y-4 rounded-2xl border border-cyber-border bg-cyber-surface p-5 shadow-2xl shadow-cyber-violet/20"
    >
      <!-- Modal Header -->
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-0.5">
          <h2
            id="vietqr-modal-title"
            data-testid="vietqr-modal-title"
            class="font-display text-lg font-bold text-cyber-text"
          >
            Nạp Credit Qua VietQR
          </h2>
          <p class="text-xs text-cyber-muted">
            Gói {{ packName }} {{ formatVndVi(topup.amountVnd) }} • Nhận ngay
            {{ formatNumberVi(topup.credits) }} Credit
          </p>
        </div>

        <button
          type="button"
          data-testid="vietqr-modal-close-button"
          aria-label="Đóng"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-cyber-border bg-cyber-bg text-cyber-muted transition hover:bg-cyber-surface hover:text-cyber-text"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
      </div>

      <!-- Lỗi xác nhận chuyển khoản -->
      <div
        v-if="confirmErrorVi"
        data-testid="vietqr-confirm-error"
        aria-live="polite"
        class="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300"
      >
        {{ confirmErrorVi }}
      </div>

      <!-- Trạng thái 1: awaiting_transfer (Chờ chuyển khoản) -->
      <template v-if="topup.status === 'awaiting_transfer'">
        <!-- Thẻ hiển thị mã QR và thông tin thanh toán -->
        <div
          data-testid="vietqr-card"
          class="flex flex-col items-center gap-3 rounded-2xl border border-cyber-border bg-cyber-bg p-4"
        >
          <!-- Đếm ngược thời gian thanh toán -->
          <div
            v-if="!resolvedIsExpired"
            data-testid="vietqr-timer-pill"
            aria-live="polite"
            class="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3.5 py-1 text-xs font-semibold text-rose-400"
          >
            <Icon name="lucide:clock" class="h-3.5 w-3.5" />
            <span>
              Phiên thanh toán hết hạn sau:
              <strong class="font-mono text-rose-300">{{
                resolvedCountdown
              }}</strong>
            </span>
          </div>

          <div
            v-else
            data-testid="vietqr-expired-pill"
            aria-live="polite"
            class="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/20 px-3.5 py-1 text-xs font-bold text-rose-300"
          >
            <Icon name="lucide:alert-circle" class="h-3.5 w-3.5" />
            <span>Mã đã hết hạn</span>
          </div>

          <!-- Khung QR SVG -->
          <div
            data-testid="vietqr-box"
            class="relative flex h-[190px] w-[190px] items-center justify-center overflow-hidden rounded-xl bg-white p-2 shadow-lg"
          >
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              v-if="qrSvg"
              data-testid="vietqr-svg-container"
              class="flex h-full w-full items-center justify-center [&>svg]:h-full [&>svg]:w-full transition"
              :class="{ 'opacity-25 blur-[2px]': resolvedIsExpired }"
              v-html="qrSvg"
            />
            <div
              v-else
              class="flex h-full w-full items-center justify-center text-xs text-slate-400"
            >
              Đang tạo mã QR...
            </div>
            <div
              v-if="resolvedIsExpired"
              data-testid="vietqr-expired-overlay"
              class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 p-2 text-center text-white"
            >
              <Icon name="lucide:alert-circle" class="mb-1 h-6 w-6 text-rose-400" />
              <span class="text-xs font-bold text-rose-300">Mã đã hết hạn</span>
            </div>
          </div>

          <!-- Bảng chi tiết chuyển khoản -->
          <div
            class="w-full space-y-2 rounded-xl border border-cyber-border bg-cyber-surface p-3 text-xs"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-cyber-muted">Số tiền:</span>
              <span
                data-testid="vietqr-amount"
                class="font-mono text-sm font-bold text-cyber-cyan"
              >
                {{ formatVndVi(topup.amountVnd) }}
              </span>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-cyber-muted">Nội dung CK:</span>
              <div class="flex flex-wrap items-center gap-2">
                <span
                  data-testid="vietqr-content"
                  class="break-all font-mono font-bold text-cyber-text"
                >
                  {{ topup.transferContent }}
                </span>
                <button
                  type="button"
                  data-testid="copy-content-button"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-lg border border-cyber-border bg-cyber-bg px-2.5 py-1 text-[11px] font-medium text-cyber-cyan transition hover:border-cyber-cyan"
                  @click="copyText(topup.transferContent, 'content')"
                >
                  <Icon
                    :name="
                      copiedField === 'content'
                        ? 'lucide:check'
                        : 'lucide:copy'
                    "
                    class="h-3 w-3"
                  />
                  <span>{{
                    copiedField === 'content' ? 'Đã chép' : 'Sao chép'
                  }}</span>
                </button>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-cyber-muted">Số tài khoản:</span>
              <div class="flex flex-wrap items-center gap-2">
                <span
                  data-testid="vietqr-account-number"
                  class="break-all font-mono font-bold text-cyber-text"
                >
                  {{ topup.accountNumber }}
                </span>
                <button
                  type="button"
                  data-testid="copy-account-button"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-lg border border-cyber-border bg-cyber-bg px-2.5 py-1 text-[11px] font-medium text-cyber-cyan transition hover:border-cyber-cyan"
                  @click="copyText(topup.accountNumber, 'account')"
                >
                  <Icon
                    :name="
                      copiedField === 'account'
                        ? 'lucide:check'
                        : 'lucide:copy'
                    "
                    class="h-3 w-3"
                  />
                  <span>{{
                    copiedField === 'account' ? 'Đã chép' : 'Sao chép'
                  }}</span>
                </button>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-cyber-muted">Ngân hàng:</span>
              <span
                data-testid="vietqr-bank"
                class="font-medium text-cyber-text"
              >
                {{ topup.bankCode }}
              </span>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-cyber-muted">Chủ tài khoản:</span>
              <span
                data-testid="vietqr-account-name"
                class="font-medium uppercase text-cyber-text"
              >
                {{ topup.accountName }}
              </span>
            </div>
          </div>
        </div>

        <!-- Banner giải thích ngoài khung giờ (08:00 - 23:00 UTC+7) -->
        <div
          v-if="resolvedIsOutsideHours"
          data-testid="vietqr-off-hours-banner"
          aria-live="polite"
          class="flex items-start gap-2.5 rounded-xl border border-cyber-cyan/40 bg-cyber-cyan/10 p-3 text-xs leading-relaxed text-cyber-cyan"
        >
          <Icon name="lucide:info" class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ OFF_HOURS_MESSAGE_VI }}</span>
        </div>

        <!-- Hướng dẫn liên hệ nếu đã chuyển khoản khi mã hết hạn -->
        <div
          v-if="resolvedIsExpired"
          data-testid="vietqr-expired-contact-hint"
          aria-live="polite"
          class="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-300"
        >
          <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>
            Nếu bạn đã lỡ chuyển khoản sau khi mã hết hạn, vui lòng liên hệ bộ phận hỗ trợ kèm mã giao dịch ngân hàng để được hỗ trợ cộng credit thủ công.
          </span>
        </div>

        <!-- Hướng dẫn thanh toán mặc định -->
        <div
          class="flex items-start gap-2.5 rounded-xl border border-cyber-border bg-cyber-bg/50 p-3 text-xs leading-relaxed text-cyber-muted"
        >
          <Icon name="lucide:info" class="mt-0.5 h-4 w-4 shrink-0 text-cyber-cyan" />
          <span>
            Mở app ngân hàng bất kỳ, quét mã QR để điền tự động số tiền &amp; nội dung chuyển khoản chính xác 100%.
          </span>
        </div>

        <!-- Các nút thao tác -->
        <div class="space-y-2 pt-1">
          <button
            v-if="!resolvedIsExpired"
            type="button"
            data-testid="confirm-transfer-button"
            :disabled="isConfirming"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyber-violet to-cyber-cyan px-4 py-3 font-semibold text-white shadow-lg shadow-cyber-violet/30 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
            @click="emit('confirm')"
          >
            <Icon
              :name="isConfirming ? 'lucide:loader-2' : 'lucide:check'"
              class="h-4 w-4"
              :class="{ 'animate-spin': isConfirming }"
            />
            <span>{{
              isConfirming ? 'Đang gửi xác nhận...' : 'Tôi Đã Chuyển Khoản Xong'
            }}</span>
          </button>

          <template v-else>
            <button
              type="button"
              disabled
              class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-4 py-3 text-xs font-semibold text-cyber-muted opacity-50"
            >
              <Icon name="lucide:check" class="h-4 w-4" />
              <span>Tôi Đã Chuyển Khoản Xong</span>
            </button>

            <button
              type="button"
              data-testid="recreate-order-button"
              :disabled="isCreating"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-3 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:opacity-50"
              @click="handleRecreate"
            >
              <Icon
                :name="isCreating ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                class="h-4 w-4"
                :class="{ 'animate-spin': isCreating }"
              />
              <span>{{ isCreating ? 'Đang tạo mã mới...' : 'Tạo mã mới' }}</span>
            </button>
          </template>
        </div>
      </template>

      <!-- Trạng thái 2: pending (Đang chờ duyệt) -->
      <template v-else-if="topup.status === 'pending'">
        <div
          data-testid="vietqr-pending-card"
          aria-live="polite"
          class="space-y-4 rounded-2xl border border-cyber-border bg-cyber-bg p-5 text-center"
        >
          <div
            class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
          >
            <Icon name="lucide:clock" class="h-6 w-6" />
          </div>

          <div class="space-y-1">
            <span
              class="inline-block rounded-full border px-3 py-0.5 text-xs font-semibold"
              :class="getTopupStatusBadgeClass(topup.status)"
            >
              {{ getTopupStatusLabelVi(topup.status) }}
            </span>
            <h3 class="font-display text-base font-bold text-cyber-text">
              Đã ghi nhận xác nhận chuyển khoản
            </h3>
            <p class="text-xs text-cyber-muted">
              Hệ thống sẽ đối chiếu với giao dịch ngân hàng và tự động cộng
              credit vào tài khoản của bạn.
            </p>
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
            class="rounded-xl border border-cyber-border bg-cyber-surface p-3 text-left text-xs space-y-1.5"
          >
            <div class="flex justify-between">
              <span class="text-cyber-muted">Mã đơn:</span>
              <span class="font-mono font-bold text-cyber-text">{{
                topup.code
              }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-cyber-muted">Số tiền:</span>
              <span class="font-mono font-bold text-cyber-cyan">{{
                formatVndVi(topup.amountVnd)
              }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-cyber-muted">Credit nhận được:</span>
              <span class="font-mono font-bold text-cyber-text">+{{ formatNumberVi(topup.credits) }}</span>
            </div>
          </div>

          <button
            type="button"
            data-testid="vietqr-close-pending-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
            @click="emit('close')"
          >
            Đóng cửa sổ
          </button>
        </div>
      </template>

      <!-- Trạng thái 3: approved (Đã duyệt) -->
      <template v-else-if="topup.status === 'approved'">
        <div
          data-testid="vietqr-approved-card"
          aria-live="polite"
          class="space-y-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center"
        >
          <div
            class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
          >
            <Icon name="lucide:check" class="h-6 w-6" />
          </div>

          <div class="space-y-1">
            <span
              class="inline-block rounded-full border px-3 py-0.5 text-xs font-semibold"
              :class="getTopupStatusBadgeClass(topup.status)"
            >
              {{ getTopupStatusLabelVi(topup.status) }}
            </span>
            <h3 class="font-display text-base font-bold text-cyber-text">
              Nạp credit thành công!
            </h3>
            <p class="text-xs text-cyber-muted">
              Đã cộng <strong class="font-mono text-emerald-400">+{{ formatNumberVi(topup.credits) }} credit</strong> vào tài khoản. Hạng tài khoản đã được nâng cấp theo gói.
            </p>
          </div>

          <div
            v-if="topup.bankRef"
            class="rounded-xl border border-cyber-border bg-cyber-bg/80 p-3 text-left text-xs"
          >
            <div class="flex justify-between">
              <span class="text-cyber-muted">Mã GD Ngân Hàng:</span>
              <span class="font-mono font-bold text-cyber-text">{{
                topup.bankRef
              }}</span>
            </div>
          </div>

          <button
            type="button"
            data-testid="vietqr-finish-approved-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-500"
            @click="emit('close')"
          >
            <span>Bắt đầu sáng tạo</span>
          </button>
        </div>
      </template>

      <!-- Trạng thái 4: rejected (Bị từ chối) -->
      <template v-else-if="topup.status === 'rejected'">
        <div
          data-testid="vietqr-rejected-card"
          aria-live="polite"
          class="space-y-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-center"
        >
          <div
            class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/20 text-rose-300"
          >
            <Icon name="lucide:alert-circle" class="h-6 w-6" />
          </div>

          <div class="space-y-1">
            <span
              class="inline-block rounded-full border px-3 py-0.5 text-xs font-semibold"
              :class="getTopupStatusBadgeClass(topup.status)"
            >
              {{ getTopupStatusLabelVi(topup.status) }}
            </span>
            <h3 class="font-display text-base font-bold text-cyber-text">
              Đơn nạp bị từ chối
            </h3>
            <p
              v-if="topup.rejectReason"
              data-testid="vietqr-reject-reason"
              class="text-xs text-rose-300"
            >
              Lý do: {{ topup.rejectReason }}
            </p>
            <p class="text-xs text-cyber-muted">
              Vui lòng kiểm tra lại sao kê hoặc liên hệ bộ phận hỗ trợ để được trợ giúp.
            </p>
          </div>

          <div class="flex gap-2">
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
          class="space-y-4 rounded-2xl border border-orange-500/40 bg-orange-500/10 p-5 text-center"
        >
          <div
            class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-500/40 bg-orange-500/20 text-orange-300"
          >
            <Icon name="lucide:alert-circle" class="h-6 w-6" />
          </div>

          <div class="space-y-1">
            <span
              class="inline-block rounded-full border px-3 py-0.5 text-xs font-semibold"
              :class="getTopupStatusBadgeClass(topup.status)"
            >
              {{ getTopupStatusLabelVi(topup.status) }}
            </span>
            <h3 class="font-display text-base font-bold text-cyber-text">
              Đơn nạp cần xem xét
            </h3>
            <p
              v-if="topup.note"
              data-testid="vietqr-review-note"
              class="text-xs text-orange-300"
            >
              Ghi chú: {{ topup.note }}
            </p>
            <p class="text-xs text-cyber-muted">
              Đơn nạp đang được Admin đối chiếu thủ công. Bạn có thể liên hệ bộ phận hỗ trợ để xử lý nhanh hơn.
            </p>
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
          class="space-y-4 rounded-2xl border border-cyber-border bg-cyber-bg p-5 text-center"
        >
          <div
            class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-500/40 bg-slate-500/20 text-slate-400"
          >
            <Icon name="lucide:clock" class="h-6 w-6" />
          </div>

          <div class="space-y-1">
            <span
              class="inline-block rounded-full border px-3 py-0.5 text-xs font-semibold"
              :class="getTopupStatusBadgeClass(topup.status)"
            >
              {{ getTopupStatusLabelVi(topup.status) }}
            </span>
            <h3 class="font-display text-base font-bold text-cyber-text">
              Mã QR đã hết hạn
            </h3>
            <p class="text-xs text-cyber-muted">
              Thời gian giữ phiên thanh toán đã kết thúc. Vui lòng tạo mã QR mới để nạp credit.
            </p>
          </div>

          <div class="flex gap-2">
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
</template>
