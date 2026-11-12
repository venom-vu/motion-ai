<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { AdminTopup } from '@flowvis/contracts';
import { formatNumberVi, formatVndVi } from '~/utils/catalog';

export type AdminTopupActionType =
  | 'approve'
  | 'approve-expired'
  | 'reject'
  | 'needs-review';

const props = withDefaults(
  defineProps<{
    open: boolean;
    topup: AdminTopup | null;
    actionType: AdminTopupActionType | null;
    isSubmitting?: boolean;
    errorMessageVi?: string | null;
  }>(),
  {
    isSubmitting: false,
    errorMessageVi: null,
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (
    e: 'confirm',
    payload: {
      actionType: AdminTopupActionType;
      topupId: string;
      bankRef?: string;
      rejectReason?: string;
      note?: string;
    },
  ): void;
}>();

const bankRef = ref<string>('');
const rejectReason = ref<string>('');
const note = ref<string>('');
const localErrorVi = ref<string | null>(null);

const dialogRef = ref<HTMLElement | null>(null);
const inputFieldRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);

watch(
  () => [props.open, props.actionType, props.topup?.id],
  () => {
    bankRef.value = '';
    rejectReason.value = '';
    note.value = '';
    localErrorVi.value = null;
  },
);

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      await nextTick();
      inputFieldRef.value?.focus();
    }
  },
  { flush: 'post' },
);

function handleKeydownTab(e: KeyboardEvent): void {
  if (!dialogRef.value) {
    return;
  }
  const focusable = dialogRef.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (!focusable.length) {
    e.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    return;
  }

  if (e.shiftKey) {
    if (document.activeElement === first) {
      last.focus();
      e.preventDefault();
    }
  } else {
    if (document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }
}

const modalTitle = computed<string>(() => {
  switch (props.actionType) {
    case 'approve':
      return 'Duyệt đơn nạp VietQR';
    case 'approve-expired':
      return 'Duyệt đơn nạp đã hết hạn';
    case 'reject':
      return 'Từ chối đơn nạp';
    case 'needs-review':
      return 'Đánh dấu đơn cần xem xét';
    default:
      return 'Xử lý đơn nạp';
  }
});

const submitButtonLabel = computed<string>(() => {
  switch (props.actionType) {
    case 'approve':
      return 'Xác nhận duyệt đơn';
    case 'approve-expired':
      return 'Xác nhận duyệt đơn quá hạn';
    case 'reject':
      return 'Xác nhận từ chối';
    case 'needs-review':
      return 'Lưu ghi chú xem xét';
    default:
      return 'Xác nhận';
  }
});

const submitButtonClass = computed<string>(() => {
  switch (props.actionType) {
    case 'approve':
      return 'bg-[#EDEDED] hover:bg-white text-black border-transparent font-semibold';
    case 'approve-expired':
      return 'bg-amber-500 hover:bg-amber-400 text-black border-transparent font-bold';
    case 'reject':
      return 'bg-rose-500 hover:bg-rose-400 text-white border-transparent font-semibold';
    case 'needs-review':
      return 'bg-orange-500 hover:bg-orange-400 text-white border-transparent font-semibold';
    default:
      return 'bg-[#1A1A1A] hover:bg-[#1A1A1A] text-[#EDEDED] border-[#262626]';
  }
});

const displayErrorVi = computed<string | null>(() => {
  return localErrorVi.value || props.errorMessageVi || null;
});

function handleClose(): void {
  if (props.isSubmitting) {
    return;
  }
  emit('close');
}

function handleSubmit(): void {
  if (props.isSubmitting || !props.topup || !props.actionType) {
    return;
  }
  localErrorVi.value = null;

  if (props.actionType === 'approve' || props.actionType === 'approve-expired') {
    const trimmed = bankRef.value.trim();
    if (!trimmed) {
      localErrorVi.value =
        'Vui lòng nhập mã giao dịch ngân hàng (bank_ref).';
      return;
    }
    if (trimmed.length > 128) {
      localErrorVi.value = 'Mã giao dịch ngân hàng tối đa 128 ký tự.';
      return;
    }
    emit('confirm', {
      actionType: props.actionType,
      topupId: props.topup.id,
      bankRef: trimmed,
    });
    return;
  }

  if (props.actionType === 'reject') {
    const trimmed = rejectReason.value.trim();
    if (!trimmed) {
      localErrorVi.value = 'Vui lòng nhập lý do từ chối.';
      return;
    }
    if (trimmed.length > 500) {
      localErrorVi.value = 'Lý do từ chối tối đa 500 ký tự.';
      return;
    }
    emit('confirm', {
      actionType: props.actionType,
      topupId: props.topup.id,
      rejectReason: trimmed,
    });
    return;
  }

  if (props.actionType === 'needs-review') {
    const trimmed = note.value.trim();
    if (!trimmed) {
      localErrorVi.value = 'Vui lòng nhập ghi chú.';
      return;
    }
    if (trimmed.length > 500) {
      localErrorVi.value = 'Ghi chú tối đa 500 ký tự.';
      return;
    }
    emit('confirm', {
      actionType: props.actionType,
      topupId: props.topup.id,
      note: trimmed,
    });
  }
}
</script>

<template>
  <div
    v-if="open && topup"
    data-testid="admin-topup-action-modal"
    class="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 font-geist text-[#EDEDED]"
    @keydown.esc="handleClose"
    @keydown.tab="handleKeydownTab"
  >
    <!-- Backdrop làm mờ -->
    <div
      class="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
      aria-hidden="true"
      @click="handleClose"
    />

    <!-- Hộp thoại Centered Dialog -->
    <div
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="modalTitle"
      class="relative z-10 w-full max-w-lg rounded-xl border border-[#262626] bg-[#0A0A0A] p-5 shadow-2xl sm:p-6 focus:outline-none"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-[#262626] pb-4">
        <div class="flex items-center gap-2">
          <Icon
            v-if="actionType === 'approve'"
            name="lucide:check-circle-2"
            class="h-5 w-5 text-emerald-400"
          />
          <Icon
            v-else-if="actionType === 'approve-expired'"
            name="lucide:alert-triangle"
            class="h-5 w-5 text-amber-400"
          />
          <Icon
            v-else-if="actionType === 'reject'"
            name="lucide:x-circle"
            class="h-5 w-5 text-rose-400"
          />
          <Icon
            v-else
            name="lucide:help-circle"
            class="h-5 w-5 text-orange-400"
          />
          <h2 class="text-base font-semibold tracking-tight text-[#EDEDED] sm:text-lg">
            {{ modalTitle }}
          </h2>
        </div>

        <button
          type="button"
          aria-label="Đóng hộp thoại"
          data-testid="modal-close-button"
          :disabled="isSubmitting"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-[#B4B4B4] transition hover:bg-[#1A1A1A] hover:text-[#EDEDED] disabled:opacity-50"
          @click="handleClose"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <!-- Tóm tắt thông tin đơn nạp -->
      <div class="mt-4 rounded-xl border border-[#262626] bg-[#1A1A1A] p-3.5 text-sm">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#262626] pb-2">
          <div class="flex items-center gap-2">
            <span class="text-[#B4B4B4]">Mã đơn:</span>
            <span class="font-bold text-[#EDEDED]">NAP {{ topup.code }}</span>
          </div>
          <span class="rounded bg-[#1A1A1A] px-2 py-0.5 text-sm font-semibold text-[#B4B4B4]">
            Gói {{ topup.pack }}
          </span>
        </div>

        <div class="mt-2.5 grid grid-cols-2 gap-2 text-sm sm:text-sm">
          <div>
            <span class="text-[#B4B4B4]">Số tiền đối chiếu:</span>
            <p class="font-bold text-[#52A8FF] text-sm">
              {{ formatVndVi(topup.amountVnd) }}
            </p>
          </div>
          <div>
            <span class="text-[#B4B4B4]">Credit cộng:</span>
            <p class="font-bold text-emerald-400 text-sm">
              +{{ formatNumberVi(topup.credits) }} CR
            </p>
          </div>
        </div>

        <div class="mt-2 text-sm text-[#B4B4B4]">
          <span>Nội dung chuyển khoản: </span>
          <span class="font-semibold text-[#EDEDED]">{{ topup.transferContent }}</span>
        </div>
      </div>

      <!-- Cảnh báo đơn hết hạn nếu actionType === 'approve-expired' -->
      <div
        v-if="actionType === 'approve-expired'"
        data-testid="expired-warning-banner"
        class="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
      >
        <Icon name="lucide:alert-triangle" class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div class="space-y-1">
          <p class="font-bold">CẢNH BÁO: Đơn nạp này đã hết hạn hiệu lực chuyển khoản!</p>
          <p class="text-sm text-amber-300/90">
            Chỉ thực hiện duyệt đơn quá hạn khi bạn đã đối chiếu sao kê và chắc chắn tài khoản ngân hàng đã nhận được số tiền trên.
          </p>
        </div>
      </div>

      <!-- Thông báo xác nhận đối chiếu nếu actionType === 'approve' -->
      <div
        v-if="actionType === 'approve'"
        class="mt-4 flex items-start gap-2.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-200"
      >
        <Icon name="lucide:shield-check" class="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
        <p class="text-sm leading-relaxed">
          Đảm bảo đã đối chiếu khớp số tiền <strong>{{ formatVndVi(topup.amountVnd) }}</strong> trên sao kê ngân hàng trước khi xác nhận. Thao tác này sẽ cộng <strong>{{ formatNumberVi(topup.credits) }} credit</strong> cho người dùng ngay lập tức và không thể hoàn tác.
        </p>
      </div>

      <!-- Form nhập liệu theo actionType -->
      <form class="mt-4 space-y-4" @submit.prevent="handleSubmit">
        <!-- Nhập bank_ref khi duyệt (pending hoặc expired) -->
        <div v-if="actionType === 'approve' || actionType === 'approve-expired'">
          <label
            for="admin-bank-ref-input"
            class="block text-sm font-semibold text-[#EDEDED]"
          >
            Mã giao dịch ngân hàng (bank_ref) <span class="text-rose-400">*</span>
          </label>
          <p class="mt-0.5 text-sm text-[#B4B4B4]">
            Mã tham chiếu duy nhất từ thông báo biến động số dư hoặc sao kê.
          </p>
          <BaseInput
            id="admin-bank-ref-input"
            ref="inputFieldRef"
            v-model="bankRef"
            variant="admin"
            focus-accent="cyan"
            class="mt-1.5"
            data-testid="modal-bank-ref-input"
            type="text"
            maxlength="128"
            autofocus
            placeholder="Ví dụ: FT26305991820 hoặc VCB123456"
            :disabled="isSubmitting"
            @input="localErrorVi = null"
          />
        </div>

        <!-- Nhập rejectReason khi từ chối -->
        <div v-else-if="actionType === 'reject'">
          <div class="flex items-center justify-between">
            <label
              for="admin-reject-reason-input"
              class="block text-sm font-semibold text-[#EDEDED]"
            >
              Lý do từ chối <span class="text-rose-400">*</span>
            </label>
            <span class="text-sm text-[#B4B4B4]">
              {{ rejectReason.length }} / 500
            </span>
          </div>
          <p class="mt-0.5 text-sm text-[#B4B4B4]">
            Lý do sẽ được hiển thị cho người dùng khi xem chi tiết đơn nạp.
          </p>
          <BaseTextarea
            id="admin-reject-reason-input"
            ref="inputFieldRef"
            v-model="rejectReason"
            variant="admin"
            focus-accent="rose"
            class="mt-1.5"
            data-testid="modal-reject-reason-input"
            rows="3"
            maxlength="500"
            autofocus
            placeholder="Ví dụ: Không tìm thấy giao dịch chuyển khoản trên sao kê tài khoản ngân hàng."
            :disabled="isSubmitting"
            @input="localErrorVi = null"
          />
        </div>

        <!-- Nhập note khi cần xem xét -->
        <div v-else-if="actionType === 'needs-review'">
          <div class="flex items-center justify-between">
            <label
              for="admin-note-input"
              class="block text-sm font-semibold text-[#EDEDED]"
            >
              Ghi chú xem xét <span class="text-orange-400">*</span>
            </label>
            <span class="text-sm text-[#B4B4B4]">
              {{ note.length }} / 500
            </span>
          </div>
          <p class="mt-0.5 text-sm text-[#B4B4B4]">
            Ghi chú nội bộ để các Admin khác nắm tình hình hoặc đối chiếu bổ sung.
          </p>
          <BaseTextarea
            id="admin-note-input"
            ref="inputFieldRef"
            v-model="note"
            variant="admin"
            focus-accent="orange"
            class="mt-1.5"
            data-testid="modal-note-input"
            rows="3"
            maxlength="500"
            autofocus
            placeholder="Ví dụ: Số tiền chuyển bị thiếu hoặc nội dung chuyển sai mã đơn, đang liên hệ hỗ trợ."
            :disabled="isSubmitting"
            @input="localErrorVi = null"
          />
        </div>

        <!-- Thông báo lỗi (nếu có) -->
        <div
          v-if="displayErrorVi"
          role="alert"
          aria-live="polite"
          data-testid="modal-error-message"
          class="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-sm text-rose-300"
        >
          <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span class="leading-tight">{{ displayErrorVi }}</span>
        </div>

        <!-- Footer Buttons -->
        <div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-testid="modal-cancel-button"
            :disabled="isSubmitting"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border border-[#262626] bg-[#111111] px-4 py-2 text-sm font-medium text-[#B4B4B4] transition hover:bg-[#1A1A1A] hover:text-[#EDEDED] disabled:opacity-50"
            @click="handleClose"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            data-testid="modal-submit-button"
            :disabled="isSubmitting"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
            :class="submitButtonClass"
          >
            <Icon
              v-if="isSubmitting"
              name="lucide:loader-2"
              class="h-4 w-4 animate-spin"
            />
            <span>{{ isSubmitting ? 'Đang xử lý...' : submitButtonLabel }}</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
