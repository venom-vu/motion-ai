/**
 * Class dùng chung cho bảng dữ liệu phía người dùng (Lịch sử, Tác vụ, Đơn nạp)
 * theo bảng màu Slate Cyber; bảng cuộn ngang trong khung trên màn 360px.
 */
export const USER_TABLE_PAGE_SIZE = 10;

export const userTable = {
  wrap: 'overflow-x-auto',
  table: 'w-full min-w-[720px] border-collapse text-left text-sm',
  th: 'whitespace-nowrap border-b border-cyber-border bg-cyber-bg/60 px-4 py-3 font-mono text-xs font-semibold uppercase tracking-wide text-cyber-muted sm:px-6',
  td: 'border-b border-cyber-border/70 px-4 py-3 align-middle text-cyber-text sm:px-6',
  row: 'transition hover:bg-cyber-bg/50',
  footer: 'border-t border-cyber-border p-4 sm:px-6',
} as const;
