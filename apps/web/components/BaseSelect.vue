<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from 'vue';
import {
  getFormFieldClasses,
  getSelectMenuClasses,
  getSelectOptionClasses,
  useUiVariant,
  type FocusAccent,
  type UiVariant,
} from '~/utils/form-ui';

export interface BaseSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    options: ReadonlyArray<BaseSelectOption>;
    id?: string;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    error?: string | null;
    variant?: UiVariant;
    focusAccent?: FocusAccent;
  }>(),
  {
    id: undefined,
    label: undefined,
    placeholder: 'Chọn...',
    disabled: false,
    error: null,
    variant: undefined,
    focusAccent: 'default',
  },
);

const modelValue = defineModel<string>({ required: true });

const attrs = useAttrs();
const generatedId = useId();
const resolvedId = computed(() => props.id ?? `select-${generatedId}`);
const listboxId = computed(() => `${resolvedId.value}-listbox`);

const resolvedVariant = useUiVariant(() => props.variant);

const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const isOpen = ref(false);
const highlightedIndex = ref(-1);

const wrapperClass = computed(() => attrs.class);
const triggerAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});

const selectedOption = computed(() =>
  props.options.find((opt) => opt.value === modelValue.value) ?? null,
);

const activeDescendantId = computed(() =>
  isOpen.value && highlightedIndex.value >= 0
    ? `${resolvedId.value}-opt-${highlightedIndex.value}`
    : undefined,
);

const triggerClass = computed(() => [
  getFormFieldClasses(resolvedVariant.value, {
    error: Boolean(props.error),
    open: isOpen.value,
    focusAccent: props.focusAccent,
  }),
  'flex items-center justify-between gap-3 text-left',
]);

const menuClass = computed(() => getSelectMenuClasses(resolvedVariant.value));

const labelClass = computed(() =>
  resolvedVariant.value === 'admin'
    ? 'block text-sm font-medium text-[#EDEDED]'
    : 'block text-sm font-semibold text-cyber-text',
);

const errorClass = computed(() =>
  resolvedVariant.value === 'admin' ? 'text-sm text-[#FF6166]' : 'text-xs text-cyber-danger',
);

function findFirstEnabledIndex(): number {
  return props.options.findIndex((opt) => !opt.disabled);
}

function findNextEnabledIndex(start: number, step: 1 | -1): number {
  const len = props.options.length;
  if (len === 0) return -1;
  let idx = start;
  for (let i = 0; i < len; i++) {
    idx = (idx + step + len) % len;
    if (!props.options[idx]?.disabled) return idx;
  }
  return -1;
}

function openMenu(): void {
  if (props.disabled) return;
  isOpen.value = true;
  const selectedIdx = props.options.findIndex(
    (opt) => opt.value === modelValue.value && !opt.disabled,
  );
  highlightedIndex.value = selectedIdx >= 0 ? selectedIdx : findFirstEnabledIndex();
}

function closeMenu(restoreFocus = false): void {
  if (!isOpen.value) return;
  isOpen.value = false;
  highlightedIndex.value = -1;
  if (restoreFocus) {
    triggerEl.value?.focus();
  }
}

function toggleMenu(): void {
  if (props.disabled) return;
  if (isOpen.value) {
    closeMenu();
  } else {
    openMenu();
  }
}

function selectOption(opt: BaseSelectOption): void {
  if (opt.disabled) return;
  modelValue.value = opt.value;
  closeMenu(true);
}

function handleTriggerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  if (event.key === 'Escape') {
    if (isOpen.value) {
      event.preventDefault();
      closeMenu(true);
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!isOpen.value) {
      openMenu();
    } else {
      highlightedIndex.value = findNextEnabledIndex(
        highlightedIndex.value < 0 ? -1 : highlightedIndex.value,
        1,
      );
    }
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!isOpen.value) {
      openMenu();
    } else {
      highlightedIndex.value = findNextEnabledIndex(
        highlightedIndex.value < 0 ? 0 : highlightedIndex.value,
        -1,
      );
    }
    return;
  }
  if (event.key === 'Home' && isOpen.value) {
    event.preventDefault();
    highlightedIndex.value = findFirstEnabledIndex();
    return;
  }
  if (event.key === 'End' && isOpen.value) {
    event.preventDefault();
    highlightedIndex.value = findNextEnabledIndex(0, -1);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!isOpen.value) {
      openMenu();
    } else if (highlightedIndex.value >= 0) {
      const opt = props.options[highlightedIndex.value];
      if (opt) selectOption(opt);
    }
  }
}

function handleOutsidePointer(event: PointerEvent): void {
  if (!isOpen.value) return;
  const target = event.target;
  if (rootEl.value && target instanceof Node && !rootEl.value.contains(target)) {
    closeMenu();
  }
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeMenu();
  },
);

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointer);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer);
});

defineExpose({
  focus: () => triggerEl.value?.focus(),
  open: openMenu,
  close: closeMenu,
  isOpen,
});
</script>

<template>
  <div ref="rootEl" class="w-full min-w-0" :class="[label || error ? 'space-y-1.5' : '', wrapperClass]">
    <label v-if="label" :for="resolvedId" :class="labelClass">
      {{ label }}
    </label>
    <div class="relative w-full min-w-0" @keydown="handleTriggerKeydown">
      <button
        :id="resolvedId"
        ref="triggerEl"
        type="button"
        role="combobox"
        :disabled="disabled"
        aria-haspopup="listbox"
        :aria-expanded="isOpen"
        :aria-controls="listboxId"
        :aria-activedescendant="activeDescendantId"
        :aria-invalid="error ? 'true' : undefined"
        v-bind="triggerAttrs"
        :class="triggerClass"
        @click="toggleMenu"
      >
        <span
          class="min-w-0 flex-1 truncate text-left"
          :class="!selectedOption ? (resolvedVariant === 'admin' ? 'text-[#8F8F8F]' : 'text-cyber-muted') : ''"
        >
          {{ selectedOption?.label ?? placeholder }}
        </span>
        <Icon
          name="lucide:chevron-down"
          class="h-4 w-4 shrink-0 transition-transform duration-150"
          :class="[
            isOpen
              ? resolvedVariant === 'admin'
                ? 'rotate-180 text-[#EDEDED]'
                : 'rotate-180 text-cyber-text'
              : resolvedVariant === 'admin'
                ? 'text-[#B4B4B4]'
                : 'text-cyber-muted',
          ]"
        />
      </button>

      <div
        v-if="isOpen"
        :id="listboxId"
        role="listbox"
        :aria-labelledby="label ? resolvedId : undefined"
        class="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-64 overflow-y-auto focus:outline-none"
        :class="menuClass"
      >
        <button
          v-for="(opt, idx) in options"
          :id="`${resolvedId}-opt-${idx}`"
          :key="opt.value"
          type="button"
          role="option"
          :disabled="opt.disabled"
          :aria-selected="opt.value === modelValue"
          :class="
            getSelectOptionClasses(resolvedVariant, {
              selected: opt.value === modelValue,
              highlighted: idx === highlightedIndex,
              disabled: opt.disabled,
            })
          "
          @mouseenter="highlightedIndex = idx"
          @click="selectOption(opt)"
        >
          <span class="min-w-0 flex-1 truncate">{{ opt.label }}</span>
          <Icon
            v-if="opt.value === modelValue"
            name="lucide:check"
            class="h-4 w-4 shrink-0"
            :class="resolvedVariant === 'admin' ? 'text-[#EDEDED]' : 'text-cyber-violet'"
          />
        </button>
      </div>
    </div>
    <p v-if="error" role="alert" :class="errorClass">{{ error }}</p>
  </div>
</template>
