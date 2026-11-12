<script setup lang="ts">
import { computed, ref, useAttrs, useId } from 'vue';
import {
  getFormFieldClasses,
  useUiVariant,
  type FocusAccent,
  type UiVariant,
} from '~/utils/form-ui';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    id?: string;
    label?: string;
    hint?: string;
    error?: string | null;
    variant?: UiVariant;
    focusAccent?: FocusAccent;
    resize?: boolean;
  }>(),
  {
    id: undefined,
    label: undefined,
    hint: undefined,
    error: null,
    variant: undefined,
    focusAccent: 'default',
    resize: false,
  },
);

const modelValue = defineModel<string>({ default: '' });

const attrs = useAttrs();
const generatedId = useId();
const resolvedId = computed(() => props.id ?? (props.label ? `textarea-${generatedId}` : undefined));

const resolvedVariant = useUiVariant(() => props.variant);
const textareaEl = ref<HTMLTextAreaElement | null>(null);

const wrapperClass = computed(() => attrs.class);
const textareaAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});

const fieldClass = computed(() => [
  getFormFieldClasses(resolvedVariant.value, {
    multiline: true,
    error: Boolean(props.error),
    focusAccent: props.focusAccent,
  }),
  props.resize ? 'resize-y' : 'resize-none',
]);

const labelClass = computed(() =>
  resolvedVariant.value === 'admin'
    ? 'block text-sm font-medium text-[#EDEDED]'
    : 'block text-sm font-semibold text-cyber-text',
);

const hintClass = computed(() =>
  resolvedVariant.value === 'admin' ? 'text-sm text-[#B4B4B4]' : 'text-xs text-cyber-muted',
);

const errorClass = computed(() =>
  resolvedVariant.value === 'admin' ? 'text-sm text-[#FF6166]' : 'text-xs text-cyber-danger',
);

defineExpose({
  focus: () => textareaEl.value?.focus(),
  el: textareaEl,
});
</script>

<template>
  <div class="w-full min-w-0" :class="[label || hint || error ? 'space-y-1.5' : '', wrapperClass]">
    <label v-if="label" :for="resolvedId" :class="labelClass">
      {{ label }}
    </label>
    <textarea
      :id="resolvedId"
      ref="textareaEl"
      v-model="modelValue"
      v-bind="textareaAttrs"
      :aria-invalid="error ? 'true' : undefined"
      :class="fieldClass"
    />
    <p v-if="error" role="alert" :class="errorClass">{{ error }}</p>
    <p v-else-if="hint" :class="hintClass">{{ hint }}</p>
  </div>
</template>

