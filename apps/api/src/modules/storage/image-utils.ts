import type { Metadata } from 'sharp';

/** Định dạng sharp → MIME được chấp nhận (dùng chung cho tải lên và kết quả). */
export const FORMAT_TO_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Kích thước hiển thị (sau xoay EXIF orientation 5-8) của ảnh. */
export function displaySize(meta: Metadata): { width: number; height: number } {
  const o = meta.orientation ?? 1;
  const rotated = o >= 5 && o <= 8;
  return {
    width: (rotated ? meta.height : meta.width) ?? 0,
    height: (rotated ? meta.width : meta.height) ?? 0,
  };
}
