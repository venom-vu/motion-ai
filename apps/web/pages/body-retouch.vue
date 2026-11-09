<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Task } from '@flowvis/contracts';
import { usePricingConfig } from '~/composables/usePricingConfig';
import { useApiClient } from '~/composables/useApiClient';
import { useAuthDialog } from '~/composables/useAuthDialog';
import {
  ApiErrorCode,
  INTENSITY_DEFAULT,
  INTENSITY_LABEL_ZONES,
  INTENSITY_MAX,
  INTENSITY_MIN,
  IntensitySchema,
  getIntensityLabelVi,
  resolveApiErrorMessageVi,
} from '~/utils/api-client';

useHead({
  title: 'Chỉnh Sửa Vóc Dáng (Body Retouch) — flowvis',
  meta: [
    {
      name: 'description',
      content:
        'Tinh chỉnh tỷ lệ cơ thể tự nhiên theo 10 mức độ chỉ bằng một lần bấm. Bảo toàn chi tiết trang phục, hậu cảnh và độ phân giải gốc.',
    },
  ],
});

const { pricing, me, refreshAll } = usePricingConfig();
const { client } = useApiClient();
const { open: openAuthDialog } = useAuthDialog();

// Trạng thái đăng nhập
const isAuthenticated = computed<boolean>(() => Boolean(me.value));

// Ảnh đầu vào (imageKey) và mức điều chỉnh vóc dáng (intensity: 1..10, mặc định 5)
const imageKey = ref<string | null>(null);
const intensity = ref<number>(INTENSITY_DEFAULT);

// Trạng thái tác vụ
const activeTask = ref<Task | null>(null);
const isSubmitting = ref<boolean>(false);
const submitErrorVi = ref<string | null>(null);

// Xóa thông báo lỗi khi người dùng thay đổi ảnh hoặc mức intensity
watch(
  [imageKey, intensity],
  () => {
    submitErrorVi.value = null;
  },
  { flush: 'sync' },
);

// Nhãn vùng tiếng Việt theo mức intensity hiện tại
const intensityLabelVi = computed<string>(
  () => getIntensityLabelVi(intensity.value) ?? 'Tự nhiên',
);

// Kiểm tra mức intensity hợp lệ theo IntensitySchema (số nguyên 1..10)
const isValidIntensity = computed<boolean>(
  () => IntensitySchema.safeParse(intensity.value).success,
);

// Giá Body Retouch: 100 credit lấy từ GET /config/pricing (fallback 100)
const bodyRetouchCreditCost = computed<number>(
  () => pricing.value?.pipelines.bodyRetouchCredits ?? 100,
);

const userBalance = computed<number>(() => me.value?.balance ?? 0);
const hasEnoughBalance = computed<boolean>(() => {
  if (typeof me.value?.balance !== 'number') return true;
  return me.value.balance >= bodyRetouchCreditCost.value;
});

// Điều kiện kích hoạt nút "Tạo Body Retouch":
// 1. Đã đăng nhập
// 2. Đã tải ảnh (imageKey)
// 3. Mức intensity hợp lệ (số nguyên 1..10)
// 4. Số dư credit >= 100
// 5. Không trong trạng thái đang gửi (isSubmitting)
const canSubmit = computed<boolean>(() => {
  return Boolean(
    isAuthenticated.value &&
      imageKey.value &&
      isValidIntensity.value &&
      hasEnoughBalance.value &&
      !isSubmitting.value,
  );
});

async function handleSubmit(): Promise<void> {
  if (isSubmitting.value) {
    return;
  }

  // Chặn giá trị ngoài 1..10 hoặc không nguyên bằng IntensitySchema ở client
  if (!isValidIntensity.value) {
    submitErrorVi.value = resolveApiErrorMessageVi(
      ApiErrorCode.VALIDATION_FAILED,
    );
    return;
  }

  // Chống bấm hai lần liên tiếp (double click protection) và kiểm tra điều kiện
  if (!canSubmit.value) {
    return;
  }

  isSubmitting.value = true;
  submitErrorVi.value = null;

  try {
    const parsedIntensity = IntensitySchema.parse(intensity.value);
    const task = await client.createBodyRetouchTask({
      imageKey: imageKey.value!,
      intensity: parsedIntensity,
    });

    activeTask.value = task;
    // Cập nhật lại số dư ví sau khi tạo task
    void refreshAll();
  } catch (error: unknown) {
    submitErrorVi.value = resolveApiErrorMessageVi(error);
  } finally {
    isSubmitting.value = false;
  }
}

function handleReset(): void {
  activeTask.value = null;
  submitErrorVi.value = null;
  void refreshAll();
}
</script>

<template>
  <div
    class="mx-auto max-w-4xl space-y-6 py-2 sm:py-4"
    data-testid="page-body-retouch"
  >
    <!-- Thanh điều hướng phụ quay về Kho công cụ AI -->
    <div class="flex items-center justify-between">
      <NuxtLink
        to="/"
        class="touch-target inline-flex min-h-[48px] items-center gap-2 text-xs font-semibold text-cyber-muted transition hover:text-cyber-cyan"
      >
        <Icon name="lucide:arrow-left" class="h-4 w-4" />
        <span>Quay lại Kho Công Cụ AI</span>
      </NuxtLink>

      <span
        data-testid="body-retouch-cost-badge"
        class="inline-flex items-center gap-1.5 rounded-full border border-cyber-violet/40 bg-cyber-violet/15 px-3 py-1 font-mono text-xs font-semibold text-cyber-violet"
      >
        <Icon name="lucide:coins" class="h-3.5 w-3.5 text-cyber-cyan" />
        <span>Chi phí: {{ bodyRetouchCreditCost }} Credit</span>
      </span>
    </div>

    <!-- Header giới thiệu tính năng Body Retouch -->
    <section
      class="rounded-2xl border border-cyber-border bg-gradient-to-br from-cyber-surface via-slate-900 to-cyber-bg p-5 sm:p-6"
    >
      <div class="flex items-start gap-4">
        <span
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyber-cyan/50 bg-cyber-cyan/20 text-cyber-cyan"
        >
          <Icon name="lucide:person-standing" class="h-6 w-6" />
        </span>
        <div class="space-y-1">
          <h1 class="font-display text-lg font-bold sm:text-2xl">
            Chỉnh Sửa Vóc Dáng (Body Retouch)
          </h1>
          <p class="text-xs text-cyber-muted sm:text-sm">
            Tinh chỉnh tỷ lệ cơ thể tự nhiên theo 10 mức độ chỉ bằng một lần
            bấm. Bảo toàn chi tiết trang phục, hậu cảnh và độ phân giải gốc.
          </p>
        </div>
      </div>
    </section>

    <!-- Màn hình theo dõi tiến trình xử lý khi đã có Task -->
    <section v-if="activeTask" class="space-y-4">
      <TaskProgressCard
        :task="activeTask"
        pipeline-label-vi="Chỉnh sửa vóc dáng"
        @update:task="activeTask = $event"
        @retry="handleReset"
        @completed="void refreshAll()"
        @settled="void refreshAll()"
      />
    </section>

    <!-- Form tải ảnh, chọn mức intensity & gửi yêu cầu tạo Task khi chưa có Task đang active -->
    <section v-else class="space-y-6">
      <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
        <!-- Cột 1: Tải ảnh đầu vào -->
        <div
          class="space-y-3 rounded-2xl border border-cyber-border bg-cyber-surface/60 p-4 sm:p-5"
          data-testid="body-image-section"
        >
          <div class="flex items-center gap-2.5">
            <span
              class="flex h-7 w-7 items-center justify-center rounded-lg border border-cyber-cyan/40 bg-cyber-cyan/15 font-mono text-xs font-bold text-cyber-cyan"
            >
              1
            </span>
            <div>
              <h2 class="text-sm font-bold text-cyber-text">
                Ảnh cần chỉnh dáng
              </h2>
              <p class="text-[11px] text-cyber-muted">
                Ảnh toàn thân hoặc bán thân thấy rõ dáng người
              </p>
            </div>
          </div>

          <ImageUploader
            v-model="imageKey"
            id-prefix="body-retouch-image"
            label-vi="Chọn ảnh chỉnh dáng"
            description-vi="Ảnh toàn thân hoặc bán thân rõ dáng, JPG/PNG/WebP ≤ 10 MB"
          />
        </div>

        <!-- Cột 2: Thanh mức điều chỉnh vóc dáng (intensity 1..10, bước 1, mặc định 5) -->
        <div
          class="flex flex-col justify-between space-y-4 rounded-2xl border border-cyber-border bg-cyber-surface/60 p-4 sm:p-5"
          data-testid="intensity-slider-section"
        >
          <div class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2.5">
                <span
                  class="flex h-7 w-7 items-center justify-center rounded-lg border border-cyber-violet/40 bg-cyber-violet/15 font-mono text-xs font-bold text-cyber-violet"
                >
                  2
                </span>
                <div>
                  <label
                    for="body-retouch-intensity-slider"
                    class="block text-sm font-bold text-cyber-text"
                  >
                    Mức điều chỉnh vóc dáng
                  </label>
                  <p class="text-[11px] text-cyber-muted">
                    Kéo thanh trượt từ {{ INTENSITY_MIN }} đến {{ INTENSITY_MAX }} (mặc định {{ INTENSITY_DEFAULT }})
                  </p>
                </div>
              </div>

              <span
                data-testid="intensity-current-badge"
                class="inline-flex items-center gap-1.5 rounded-full border border-cyber-cyan/50 bg-cyber-cyan/15 px-3 py-1 font-mono text-xs font-bold text-cyber-cyan"
              >
                <span data-testid="intensity-current-value">Mức {{ intensity }}/{{ INTENSITY_MAX }}</span>
                <span>•</span>
                <span data-testid="intensity-current-label">{{ intensityLabelVi }}</span>
              </span>
            </div>

            <div class="space-y-2 pt-1">
              <input
                id="body-retouch-intensity-slider"
                v-model.number="intensity"
                type="range"
                :min="INTENSITY_MIN"
                :max="INTENSITY_MAX"
                step="1"
                data-testid="intensity-slider"
                aria-label="Mức điều chỉnh vóc dáng từ 1 đến 10"
                :aria-valuenow="intensity"
                :aria-valuemin="INTENSITY_MIN"
                :aria-valuemax="INTENSITY_MAX"
                :aria-valuetext="intensityLabelVi"
                class="touch-target min-h-[48px] w-full cursor-pointer accent-cyber-cyan"
              />

              <div class="flex items-center justify-between font-mono text-[11px] text-cyber-muted">
                <span>Mức {{ INTENSITY_MIN }}</span>
                <span>Mặc định: {{ INTENSITY_DEFAULT }}</span>
                <span>Mức {{ INTENSITY_MAX }}</span>
              </div>
            </div>

            <!-- Ba mốc vùng nhãn theo INTENSITY_LABEL_ZONES -->
            <div
              data-testid="intensity-zone-markers"
              class="grid grid-cols-3 gap-2 pt-1 text-center text-xs"
            >
              <div
                v-for="zone in INTENSITY_LABEL_ZONES"
                :key="zone.label"
                :data-testid="`intensity-zone-${zone.min}-${zone.max}`"
                class="rounded-xl border px-2 py-2.5 transition"
                :class="[
                  intensity >= zone.min && intensity <= zone.max
                    ? 'border-cyber-cyan/50 bg-cyber-cyan/15 font-semibold text-cyber-cyan'
                    : 'border-cyber-border bg-cyber-bg/60 text-cyber-muted',
                ]"
              >
                <div class="font-mono text-[11px]">
                  {{ zone.min }}–{{ zone.max }}
                </div>
                <div class="mt-0.5 text-[11px] leading-tight sm:text-xs">
                  {{ zone.label }}
                </div>
              </div>
            </div>
          </div>

          <div
            class="rounded-xl border border-cyber-border/70 bg-cyber-bg/60 p-3 text-xs text-cyber-muted"
          >
            <div class="flex items-start gap-2">
              <Icon
                name="lucide:sliders-horizontal"
                class="mt-0.5 h-4 w-4 shrink-0 text-cyber-cyan"
              />
              <span>
                Mức 4–7 (Tự nhiên) được khuyến nghị cho hầu hết ảnh chân dung và
                thời trang để giữ tỷ lệ hài hòa với hậu cảnh.
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Banner thông báo lỗi nếu có khi tạo Task -->
      <div
        v-if="submitErrorVi"
        data-testid="submit-error-banner"
        class="rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-4 text-xs text-cyber-danger"
      >
        <div class="flex items-center gap-2">
          <Icon name="lucide:alert-circle" class="h-4 w-4 shrink-0" />
          <span>{{ submitErrorVi }}</span>
        </div>
      </div>

      <!-- Banner nhắc đăng nhập nếu chưa đăng nhập -->
      <div
        v-if="!isAuthenticated"
        data-testid="guest-login-notice"
        class="flex flex-col gap-3 rounded-xl border border-cyber-cyan/40 bg-cyber-cyan/10 p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-center gap-3">
          <Icon name="lucide:log-in" class="h-5 w-5 shrink-0 text-cyber-cyan" />
          <p class="text-xs text-cyber-cyan sm:text-sm">
            Vui lòng đăng nhập để bắt đầu tạo tác vụ Chỉnh sửa vóc dáng và lưu lịch sử.
          </p>
        </div>
        <button
          type="button"
          data-testid="body-retouch-login-button"
          class="touch-target inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-cyber-cyan px-4 py-2 text-xs font-bold text-black transition hover:bg-cyber-cyan/90"
          @click="openAuthDialog('login')"
        >
          <Icon name="lucide:log-in" class="h-4 w-4" />
          <span>Đăng nhập ngay</span>
        </button>
      </div>

      <!-- Vùng hành động: Số dư credit + Nút Nạp + Nút Tạo Body Retouch -->
      <div
        class="flex flex-col gap-4 rounded-2xl border border-cyber-border bg-cyber-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="text-xs text-cyber-muted">Số dư khả dụng:</span>
            <span
              class="font-mono text-sm font-bold"
              :class="[hasEnoughBalance ? 'text-cyber-cyan' : 'text-cyber-warning']"
            >
              {{ userBalance }} Credit
            </span>
          </div>
          <p
            v-if="!hasEnoughBalance"
            data-testid="insufficient-credit-note"
            class="text-xs font-semibold text-cyber-warning"
          >
            Số dư không đủ {{ bodyRetouchCreditCost }} credit để thực hiện tác vụ.
          </p>
        </div>

        <div class="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
          <!-- Nút Nạp Thêm Credit khi số dư không đủ -->
          <NuxtLink
            v-if="!hasEnoughBalance"
            to="/pricing"
            data-testid="topup-credit-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-warning/50 bg-cyber-warning/15 px-4 py-2.5 text-xs font-semibold text-cyber-warning transition hover:bg-cyber-warning/25"
          >
            <Icon name="lucide:plus-circle" class="h-4 w-4" />
            <span>Nạp thêm Credit</span>
          </NuxtLink>

          <!-- Nút Tạo Body Retouch: min-h 48px, Slate Cyber, disabled nếu chưa đủ ảnh / intensity / credit -->
          <button
            type="button"
            data-testid="create-body-retouch-button"
            :disabled="!canSubmit"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleSubmit"
          >
            <Icon
              v-if="isSubmitting"
              name="lucide:loader-2"
              class="h-4 w-4 animate-spin"
            />
            <Icon v-else name="lucide:play" class="h-4 w-4" />
            <span>
              {{
                isSubmitting
                  ? 'Đang tạo tác vụ...'
                  : `Tạo Body Retouch (${bodyRetouchCreditCost} CR)`
              }}
            </span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
