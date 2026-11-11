import { computed, ref, watch } from 'vue';
import {
  MOTION_ASPECT_RATIO_DEFAULT,
  MOTION_MIN_TRIM_SECONDS,
  type MotionAspectRatio,
  type Task,
} from '@flowvis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { usePricingConfig } from '~/composables/usePricingConfig';
import {
  MotionApiClientError,
  getValidationReasonMessageVi,
  motionPrice,
  resolveApiErrorMessageVi,
} from '~/utils/api-client';

export interface MotionTrimChange {
  videoKey: string | null;
  trimStart: number;
  trimEnd: number;
  durationSeconds: number;
}

/**
 * Luồng tạo Task Motion Control dùng chung cho trang `/motion-control`
 * và `FeatureWorkspaceDialog`: giá trực tiếp, điều kiện nút Tạo, chống bấm đôi,
 * xử lý lỗi tiếng Việt (kể cả TRIM_EXCEEDS_CAP).
 */
export function useMotionControl() {
  const { me, currentTier, currentTierCapSeconds, refreshAll } =
    usePricingConfig();
  const { client } = useApiClient();

  const characterKey = ref<string | null>(null);
  const videoKey = ref<string | null>(null);
  const trimStart = ref<number>(0);
  const trimEnd = ref<number>(0);
  const aspectRatio = ref<MotionAspectRatio>(MOTION_ASPECT_RATIO_DEFAULT);
  const prompt = ref<string>('');
  const activeTask = ref<Task | null>(null);
  const isSubmitting = ref<boolean>(false);
  const submitErrorVi = ref<string | null>(null);
  // Cap do server vừa báo (TRIM_EXCEEDS_CAP); luôn lấy giá trị nhỏ hơn với Cap từ cấu hình.
  const serverCapOverride = ref<number | null>(null);

  const isAuthenticated = computed<boolean>(() => Boolean(me.value));

  const capSeconds = computed<number | null>(() => {
    const tierCap = currentTierCapSeconds.value;
    const override = serverCapOverride.value;
    if (tierCap == null) return override;
    return override == null ? tierCap : Math.min(tierCap, override);
  });

  const capUsable = computed<boolean>(
    () => capSeconds.value != null && capSeconds.value >= MOTION_MIN_TRIM_SECONDS,
  );

  const seconds = computed<number>(() => trimEnd.value - trimStart.value);

  const hasValidTrim = computed<boolean>(
    () => Number.isInteger(seconds.value) && seconds.value >= MOTION_MIN_TRIM_SECONDS,
  );

  const overCap = computed<boolean>(
    () => capSeconds.value != null && seconds.value > capSeconds.value,
  );

  /** Giá theo contracts (motionPrice); null khi chưa có đoạn Trim hợp lệ. */
  const price = computed<number | null>(() =>
    Number.isInteger(seconds.value) && seconds.value > 0
      ? motionPrice(seconds.value)
      : null,
  );

  const balance = computed<number>(() => me.value?.balance ?? 0);

  const remainingBalance = computed<number | null>(() =>
    price.value == null ? null : balance.value - price.value,
  );

  const hasEnoughBalance = computed<boolean>(() => {
    if (price.value == null) return true;
    if (typeof me.value?.balance !== 'number') return true;
    return me.value.balance >= price.value;
  });

  const insufficientNoteVi = computed<string | null>(() => {
    if (!isAuthenticated.value || price.value == null || hasEnoughBalance.value) {
      return null;
    }
    return `Bạn đang có ${balance.value} credit (cần ${price.value} cr để tạo đoạn ${seconds.value}s). Hãy nạp thêm credit để tiếp tục.`;
  });

  const canSubmit = computed<boolean>(() =>
    Boolean(
      isAuthenticated.value &&
        characterKey.value &&
        videoKey.value &&
        capUsable.value &&
        hasValidTrim.value &&
        !overCap.value &&
        hasEnoughBalance.value &&
        !isSubmitting.value,
    ),
  );

  watch(
    [characterKey, videoKey, trimStart, trimEnd],
    () => {
      submitErrorVi.value = null;
    },
    { flush: 'sync' },
  );

  function onTrimChange(payload: MotionTrimChange): void {
    videoKey.value = payload.videoKey;
    trimStart.value = payload.trimStart;
    trimEnd.value = payload.trimEnd;
  }

  async function handleSubmitError(error: unknown): Promise<void> {
    if (
      error instanceof MotionApiClientError &&
      error.details?.reason === 'TRIM_EXCEEDS_CAP'
    ) {
      const cap = Number(error.details.cap);
      if (Number.isInteger(cap) && cap > 0) {
        serverCapOverride.value = cap;
        try {
          await refreshAll();
        } catch {
          // Giữ thông báo cũ nếu tải lại thất bại.
        }
        submitErrorVi.value = `Gói hiện tại của bạn cho phép tối đa ${cap} giây`;
        return;
      }
    }
    if (error instanceof MotionApiClientError) {
      const reason = error.details?.reason;
      if (typeof reason === 'string') {
        const cap =
          typeof error.details?.cap === 'number' ? error.details.cap : null;
        const message = getValidationReasonMessageVi(reason, cap);
        if (message !== getValidationReasonMessageVi(null)) {
          submitErrorVi.value = message;
          return;
        }
      }
    }
    submitErrorVi.value = resolveApiErrorMessageVi(error);
  }

  async function submit(): Promise<Task | null> {
    // Chống bấm đôi: cờ đặt đồng bộ trước mọi await.
    if (isSubmitting.value || !canSubmit.value) return null;
    isSubmitting.value = true;
    submitErrorVi.value = null;
    try {
      const task = await client.createMotionControlTask({
        characterKey: characterKey.value!,
        videoKey: videoKey.value!,
        trimStart: trimStart.value,
        trimEnd: trimEnd.value,
        aspectRatio: aspectRatio.value,
        prompt: prompt.value.trim(),
      });
      activeTask.value = task;
      refreshAll().catch(() => {});
      return task;
    } catch (error: unknown) {
      await handleSubmitError(error);
      return null;
    } finally {
      isSubmitting.value = false;
    }
  }

  /** Xóa mọi trạng thái nhập/lỗi (không tải lại ví). */
  function clearState(): void {
    activeTask.value = null;
    submitErrorVi.value = null;
    serverCapOverride.value = null;
    characterKey.value = null;
    videoKey.value = null;
    trimStart.value = 0;
    trimEnd.value = 0;
    aspectRatio.value = MOTION_ASPECT_RATIO_DEFAULT;
    prompt.value = '';
  }

  function reset(): void {
    clearState();
    refreshAll().catch(() => {});
  }

  return {
    me,
    currentTier,
    refreshAll,
    isAuthenticated,
    characterKey,
    videoKey,
    trimStart,
    trimEnd,
    aspectRatio,
    prompt,
    activeTask,
    isSubmitting,
    submitErrorVi,
    capSeconds,
    capUsable,
    seconds,
    price,
    balance,
    remainingBalance,
    hasEnoughBalance,
    insufficientNoteVi,
    canSubmit,
    onTrimChange,
    submit,
    reset,
    clearState,
  };
}
