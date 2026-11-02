import type { Config } from 'tailwindcss';

export const SLATE_CYBER_COLORS = {
  bg: '#0F172A',
  surface: '#1E293B',
  border: '#334155',
  violet: '#8B5CF6',
  cyan: '#06B6D4',
  text: '#F8FAFC',
  muted: '#94A3B8',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  adminBg: '#0A0A0A',
} as const;

export default {
  darkMode: 'class',
  content: [
    './app.vue',
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './composables/**/*.{js,ts}',
    './utils/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: SLATE_CYBER_COLORS.bg,
          surface: SLATE_CYBER_COLORS.surface,
          border: SLATE_CYBER_COLORS.border,
          violet: SLATE_CYBER_COLORS.violet,
          cyan: SLATE_CYBER_COLORS.cyan,
          text: SLATE_CYBER_COLORS.text,
          muted: SLATE_CYBER_COLORS.muted,
          success: SLATE_CYBER_COLORS.success,
          warning: SLATE_CYBER_COLORS.warning,
          danger: SLATE_CYBER_COLORS.danger,
          admin: SLATE_CYBER_COLORS.adminBg,
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      minHeight: {
        touch: '48px',
      },
      minWidth: {
        touch: '48px',
      },
      maxWidth: {
        workspace: '980px',
      },
      spacing: {
        header: '68px',
        'admin-sidebar': '220px',
      },
    },
  },
  plugins: [],
} satisfies Config;
