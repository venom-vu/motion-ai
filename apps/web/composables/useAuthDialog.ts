import { useState } from '#imports';

export type AuthDialogMode = 'login' | 'account';

export function useAuthDialog() {
  const mode = useState<AuthDialogMode | null>('flowvis-auth-dialog', () => null);
  const errorVi = useState<string | null>(
    'flowvis-auth-dialog-error',
    () => null,
  );

  function open(next: AuthDialogMode, error: string | null = null): void {
    errorVi.value = error;
    mode.value = next;
  }

  function close(): void {
    mode.value = null;
    errorVi.value = null;
  }

  return { mode, errorVi, open, close };
}
