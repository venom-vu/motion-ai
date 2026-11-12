import { computed, inject, type ComputedRef, type InjectionKey } from 'vue';

export type UiVariant = 'admin' | 'cyber';
export type FocusAccent = 'default' | 'violet' | 'cyan' | 'rose' | 'orange';

export const UI_VARIANT_KEY = Symbol('flowvis-ui-variant') as InjectionKey<UiVariant>;

export function useUiVariant(explicit?: () => UiVariant | undefined): ComputedRef<UiVariant> {
  const injected = inject(UI_VARIANT_KEY, 'cyber');
  return computed<UiVariant>(() => explicit?.() ?? injected);
}

const FIELD_BASE =
  'w-full outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [color-scheme:dark]';

const ADMIN_FOCUS: Record<FocusAccent, string> = {
  default: 'focus:border-[#EDEDED]',
  violet: 'focus:border-[#EDEDED]',
  cyan: 'focus:border-[#52A8FF]',
  rose: 'focus:border-rose-400',
  orange: 'focus:border-orange-400',
};

const CYBER_FOCUS: Record<FocusAccent, string> = {
  default: 'focus:border-cyber-violet hover:border-cyber-violet/60',
  violet: 'focus:border-cyber-violet hover:border-cyber-violet/60',
  cyan: 'focus:border-cyber-cyan hover:border-cyber-cyan/60',
  rose: 'focus:border-cyber-danger hover:border-cyber-danger/60',
  orange: 'focus:border-cyber-warning hover:border-cyber-warning/60',
};

export interface FormFieldClassOptions {
  error?: boolean;
  open?: boolean;
  multiline?: boolean;
  hasLeftIcon?: boolean;
  hasRightIcon?: boolean;
  focusAccent?: FocusAccent;
}

/**
 * Class nền tảng dùng chung cho mọi input, textarea và select trigger để giữ
 * đồng bộ chiều cao (48px), padding, bo góc, viền, focus và dark color-scheme.
 */
export function getFormFieldClasses(
  variant: UiVariant,
  opts: FormFieldClassOptions = {},
): string {
  const {
    error = false,
    open = false,
    multiline = false,
    hasLeftIcon = false,
    hasRightIcon = false,
    focusAccent = 'default',
  } = opts;

  const sizeClasses = multiline ? 'min-h-[96px] py-3' : 'min-h-[48px]';
  const paddingX = `${hasLeftIcon ? 'pl-10' : 'pl-3.5'} ${hasRightIcon ? 'pr-10' : 'pr-3.5'}`;

  if (variant === 'admin') {
    const surface =
      'rounded-md border bg-[#0A0A0A] text-base text-[#EDEDED] placeholder:text-[#8F8F8F]';
    const borderState = error
      ? 'border-[#FF6166] focus:border-[#FF6166]'
      : open
        ? 'border-[#EDEDED]'
        : `border-[#3A3A3A] hover:border-[#525252] ${ADMIN_FOCUS[focusAccent]}`;
    return `${FIELD_BASE} ${sizeClasses} ${paddingX} ${surface} ${borderState}`;
  }

  const surface =
    'rounded-xl border bg-cyber-bg text-sm text-cyber-text placeholder:text-cyber-muted';
  const borderState = error
    ? 'border-cyber-danger focus:border-cyber-danger'
    : open
      ? focusAccent === 'cyan'
        ? 'border-cyber-cyan'
        : 'border-cyber-violet'
      : `border-cyber-border ${CYBER_FOCUS[focusAccent]}`;
  return `${FIELD_BASE} ${sizeClasses} ${paddingX} ${surface} ${borderState}`;
}

export function getSelectMenuClasses(variant: UiVariant): string {
  if (variant === 'admin') {
    return 'rounded-md border border-[#3A3A3A] bg-[#111111] p-1 shadow-xl shadow-black/70';
  }
  return 'rounded-xl border border-cyber-border bg-cyber-surface p-1.5 shadow-2xl shadow-black/50';
}

export function getSelectOptionClasses(
  variant: UiVariant,
  state: { selected: boolean; highlighted: boolean; disabled?: boolean },
): string {
  if (variant === 'admin') {
    const base =
      'flex min-h-[44px] w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-base transition-colors';
    if (state.disabled) return `${base} cursor-not-allowed text-[#8F8F8F] opacity-40`;
    if (state.selected) return `${base} bg-[#1F1F1F] font-medium text-[#EDEDED]`;
    if (state.highlighted) return `${base} bg-[#1A1A1A] text-[#EDEDED]`;
    return `${base} text-[#B4B4B4] hover:bg-[#1A1A1A] hover:text-[#EDEDED]`;
  }

  const base =
    'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors';
  if (state.disabled) return `${base} cursor-not-allowed text-cyber-muted opacity-40`;
  if (state.selected) return `${base} bg-cyber-violet/15 font-medium text-cyber-text`;
  if (state.highlighted) return `${base} bg-cyber-bg text-cyber-text`;
  return `${base} text-cyber-muted hover:bg-cyber-bg hover:text-cyber-text`;
}

