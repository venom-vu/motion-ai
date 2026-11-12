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
    leftIcon?: string;
    rightIcon?: string;
    variant?: UiVariant;
    focusAccent?: FocusAccent;
  }>(),
  {
    id: undefined,
    label: undefined,
    hint: undefined,
    error: null,
    leftIcon: undefined,
    rightIcon: undefined,
    variant: undefined,
    focusAccent: 'default',
  },
);

const modelValue = defineModel<string | number>({ default: '' });

const attrs = useAttrs();
const generatedId = useId();
const resolvedId = computed(() => props.id ?? (props.label ? `input-${generatedId}` : undefined));

const resolvedVariant = useUiVariant(() => props.variant);
const inputEl = ref<HTMLInputElement | null>(null);

const wrapperClass = computed(() => attrs.class);
const inputAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});

const fieldClass = computed(() =>
  getFormFieldClasses(resolvedVariant.value, {
    error: Boolean(props.error),
    hasLeftIcon: Boolean(props.leftIcon),
    hasRightIcon: Boolean(props.rightIcon),
    focusAccent: props.focusAccent,
  }),
);

const iconColorClass = computed(() =>
  resolvedVariant.value === 'admin' ? 'text-[#8F8F8F]' : 'text-cyber-muted',
);

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
  focus: () => inputEl.value?.focus(),
  el: inputEl,
});
</script>

<template>
  <div class="w-full min-w-0" :class="[label || hint || error ? 'space-y-1.5' : '', wrapperClass]">
    <label v-if="label" :for="resolvedId" :class="labelClass">
      {{ label }}
    </label>
    <div class="relative w-full min-w-0">
      <Icon
        v-if="leftIcon"
        :name="leftIcon"
        class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
        :class="iconColorClass"
      />
      <input
        :id="resolvedId"
        ref="inputEl"
        v-model="modelValue"
        v-bind="inputAttrs"
        :aria-invalid="error ? 'true' : undefined"
        :class="fieldClass"
      />
      <Icon
        v-if="rightIcon"
        :name="rightIcon"
        class="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
        :class="iconColorClass"
      />
    </div>
    <p v-if="error" role="alert" :class="errorClass">{{ error }}</p>
    <p v-else-if="hint" :class="hintClass">{{ hint }}</p>
  </div>
</template>

