/**
 * Class dùng chung cho các trang quản trị: nền tối trung tính kiểu Vercel Docs,
 * chữ tối thiểu 14px, tương phản cao, vùng chạm 48px.
 */
const btnBase =
  'touch-target inline-flex min-h-[48px] min-w-[48px] shrink-0 whitespace-nowrap items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

export const ui = {
  pageTitle: 'text-3xl font-semibold tracking-tight text-[#EDEDED]',
  pageLead: 'mt-2 text-base leading-relaxed text-[#B4B4B4]',
  sectionTitle: 'text-xl font-semibold tracking-tight text-[#EDEDED]',
  btn: `${btnBase} border-[#3A3A3A] bg-[#111111] text-[#EDEDED] hover:bg-[#1F1F1F]`,
  btnPrimary: `${btnBase} border-transparent bg-[#EDEDED] text-[#0A0A0A] hover:bg-white`,
  btnDanger: `${btnBase} border-[#5C2326] bg-[#111111] text-[#FF6166] hover:bg-[#2A1215]`,
  input:
    'min-h-[48px] w-full rounded-md border border-[#3A3A3A] bg-[#0A0A0A] px-3.5 text-base text-[#EDEDED] outline-none transition-colors duration-150 placeholder:text-[#8F8F8F] hover:border-[#525252] focus:border-[#EDEDED] disabled:cursor-not-allowed disabled:opacity-50 [color-scheme:dark]',
  label: 'block space-y-1.5 text-sm font-medium text-[#EDEDED]',
  card: 'rounded-lg border border-[#2E2E2E] bg-[#111111] p-5',
  tableWrap: 'overflow-x-auto rounded-lg border border-[#2E2E2E]',
  table: 'w-full min-w-[640px] border-collapse text-left text-sm',
  th: 'border-b border-[#2E2E2E] bg-[#111111] px-4 py-3 font-medium text-[#B4B4B4]',
  td: 'border-b border-[#1F1F1F] px-4 py-3 align-top text-[#EDEDED]',
  muted: 'text-sm text-[#B4B4B4]',
  error: 'text-sm text-[#FF6166]',
  notice: 'rounded-md border border-[#2E2E2E] bg-[#111111] px-4 py-3 text-sm text-[#EDEDED]',
  ok: 'text-[#4ADE80]',
  warn: 'text-[#FBBF24]',
  bad: 'text-[#FF6166]',
} as const;
