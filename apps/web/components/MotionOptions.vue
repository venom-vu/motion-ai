<script setup lang="ts">
import {
  MOTION_ASPECT_RATIOS,
  MOTION_PROMPT_MAX_LENGTH,
  type MotionAspectRatio,
} from '@flowvis/contracts';

defineProps<{ idPrefix?: string; disabled?: boolean }>();
const aspectRatio = defineModel<MotionAspectRatio>('aspectRatio', { required: true });
const prompt = defineModel<string>('prompt', { required: true });
</script>

<template>
  <div class="min-w-0 space-y-3" data-testid="motion-options">
    <div class="space-y-2">
      <p class="flex items-center gap-2 text-xs font-semibold text-cyber-text sm:text-sm">
        <Icon name="lucide:crop" class="h-4 w-4 text-cyber-cyan" />
        <span>Khung hình</span>
      </p>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Khung hình video">
        <button
          v-for="r in MOTION_ASPECT_RATIOS"
          :key="r.id"
          type="button"
          role="radio"
          :aria-checked="aspectRatio === r.id"
          :disabled="disabled"
          :data-testid="`${idPrefix ?? 'motion'}-ratio-${r.id}`"
          class="touch-target min-h-[48px] rounded-xl border px-2 py-2 text-left text-[11px] leading-tight transition disabled:opacity-50"
          :class="
            aspectRatio === r.id
              ? 'border-cyber-cyan bg-cyber-cyan/15 text-cyber-cyan'
              : 'border-cyber-border bg-cyber-bg/60 text-cyber-muted hover:border-cyber-cyan/50'
          "
          @click="aspectRatio = r.id"
        >
          <span class="block font-mono text-xs font-bold">{{ r.id }}</span>
          <span class="block">{{ r.labelVi.replace(/^[^(]*\(?/, '').replace(/\)$/, '') || r.labelVi }}</span>
        </button>
      </div>
    </div>

    <div class="space-y-1.5">
      <label
        :for="`${idPrefix ?? 'motion'}-prompt`"
        class="flex items-center gap-2 text-xs font-semibold text-cyber-text sm:text-sm"
      >
        <Icon name="lucide:message-square-text" class="h-4 w-4 text-cyber-violet" />
        <span>Prompt (tùy chọn)</span>
      </label>
      <textarea
        :id="`${idPrefix ?? 'motion'}-prompt`"
        v-model="prompt"
        :maxlength="MOTION_PROMPT_MAX_LENGTH"
        :disabled="disabled"
        rows="3"
        placeholder="Mô tả bối cảnh hoặc hành động, ví dụ: cô gái nhảy trong phòng tập, ánh sáng ấm"
        class="w-full resize-none rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 text-xs text-cyber-text placeholder:text-cyber-muted focus:border-cyber-cyan focus:outline-none"
        :data-testid="`${idPrefix ?? 'motion'}-prompt`"
      />
      <p class="text-right font-mono text-[11px] text-cyber-muted">
        {{ prompt.length }}/{{ MOTION_PROMPT_MAX_LENGTH }}
      </p>
    </div>
  </div>
</template>
