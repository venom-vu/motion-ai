export type PageToken = number | 'ellipsis';

/**
 * Danh sách nút số trang: luôn có trang đầu, trang cuối và các trang kề trang hiện tại;
 * khoảng trống từ 2 trang trở lên thu gọn thành "…".
 * Ví dụ (trang 6 / 12): 1 … 5 6 7 … 12.
 */
export function buildPageTokens(page: number, pageCount: number, siblings = 1): PageToken[] {
  const total = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), total);
  const keep = new Set<number>([1, total]);
  for (let i = current - siblings; i <= current + siblings; i += 1) {
    if (i >= 1 && i <= total) keep.add(i);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const tokens: PageToken[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev === 2) {
      tokens.push(prev + 1);
    } else if (n - prev > 2) {
      tokens.push('ellipsis');
    }
    tokens.push(n);
    prev = n;
  }
  return tokens;
}
