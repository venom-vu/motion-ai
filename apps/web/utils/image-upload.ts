import {
  IMAGE_MIME_TYPES,
  ImageFileDeclarationSchema,
  ImageMetaSchema,
  MAX_IMAGE_ASPECT_RATIO,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_SHORT_SIDE_PX,
  type ImageMeta,
  type ImageMimeType,
} from '@motion-ai/contracts';

export {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_ASPECT_RATIO,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_SHORT_SIDE_PX,
  type ImageMeta,
  type ImageMimeType,
};

/**
 * Chuẩn hóa kiểu MIME của ảnh từ mimeType của trình duyệt hoặc phần mở rộng tệp.
 * Khắc phục trường hợp mobile browser trả về type rỗng hoặc image/jpg không chuẩn.
 */
export function normalizeImageMimeType(
  rawType: string | undefined | null,
  fileName: string | undefined | null,
): ImageMimeType | string {
  const cleanType = (rawType ?? '').trim().toLowerCase();
  if (
    cleanType === 'image/jpeg' ||
    cleanType === 'image/jpg' ||
    cleanType === 'image/pjpeg'
  ) {
    return 'image/jpeg';
  }
  if (cleanType === 'image/png') {
    return 'image/png';
  }
  if (cleanType === 'image/webp') {
    return 'image/webp';
  }

  const ext = (fileName ?? '').split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') {
    return 'image/jpeg';
  }
  if (ext === 'png') {
    return 'image/png';
  }
  if (ext === 'webp') {
    return 'image/webp';
  }

  return cleanType;
}

/**
 * Định dạng dung lượng byte sang chuỗi hiển thị thân thiện (KB, MB).
 */
export function formatFileSizeVi(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Đọc kích thước điểm ảnh (width, height) từ File hoặc Blob.
 */
export function getImageDimensions(
  file: Blob | (Blob & { width?: number; height?: number }),
): Promise<{ width: number; height: number }> {
  // Nếu đối tượng đã có sẵn thuộc tính width/height (hữu ích cho unit test & mock)
  const candidate = file as { width?: unknown; height?: unknown };
  if (
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    candidate.width > 0 &&
    candidate.height > 0
  ) {
    return Promise.resolve({
      width: candidate.width,
      height: candidate.height,
    });
  }

  return new Promise((resolve, reject) => {
    // 1. Thử createImageBitmap nếu môi trường hỗ trợ (kèm tự động xoay theo EXIF mobile)
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file, { imageOrientation: 'from-image' })
        .then((bitmap) => {
          const width = bitmap.width;
          const height = bitmap.height;
          bitmap.close?.();
          resolve({ width, height });
        })
        .catch(() => fallbackWithImg());
      return;
    }

    fallbackWithImg();

    function fallbackWithImg() {
      if (typeof window === 'undefined' || typeof Image === 'undefined') {
        // Môi trường SSR hoặc Node không có Image
        resolve({ width: 0, height: 0 });
        return;
      }

      let objectUrl = '';
      try {
        objectUrl = URL.createObjectURL(file);
      } catch {
        resolve({ width: 0, height: 0 });
        return;
      }

      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Không thể đọc dữ liệu ảnh. Vui lòng chọn ảnh khác.'));
      };
      img.src = objectUrl;
    }
  });
}

/**
 * Kiểm tra file ảnh phía client bằng ImageFileDeclarationSchema và ImageMetaSchema từ @motion-ai/contracts.
 */
export async function validateImageFile(
  file: File | (Blob & { name?: string; width?: number; height?: number }),
): Promise<
  | { valid: true; meta: ImageMeta }
  | { valid: false; errorVi: string; meta?: never }
> {
  // 1. Kiểm tra định dạng (MIME) và dung lượng byte
  const fileName = 'name' in file ? file.name : undefined;
  const normalizedMime = normalizeImageMimeType(file.type, fileName);
  const declResult = ImageFileDeclarationSchema.safeParse({
    mimeType: normalizedMime,
    sizeBytes: file.size,
  });

  if (!declResult.success) {
    const issue = declResult.error.issues[0];
    return {
      valid: false,
      errorVi:
        issue?.message ??
        'Tệp không hợp lệ. Vui lòng chọn ảnh JPG, PNG hoặc WebP ≤ 10 MB.',
    };
  }

  // 2. Đọc kích thước điểm ảnh
  let dimensions: { width: number; height: number };
  try {
    dimensions = await getImageDimensions(file);
  } catch {
    return {
      valid: false,
      errorVi: 'Không thể đọc kích thước ảnh. Vui lòng chọn ảnh khác.',
    };
  }

  // 3. Kiểm tra bằng ImageMetaSchema (cạnh ngắn >= 512px, tỷ lệ 1:2 đến 2:1)
  const metaResult = ImageMetaSchema.safeParse({
    mimeType: normalizedMime,
    sizeBytes: file.size,
    width: dimensions.width,
    height: dimensions.height,
  });

  if (!metaResult.success) {
    const issue = metaResult.error.issues[0];
    return {
      valid: false,
      errorVi:
        issue?.message ??
        'Kích thước hoặc tỷ lệ ảnh không hợp lệ (cạnh ngắn ≥ 512px, tỷ lệ 1:2 đến 2:1).',
    };
  }

  return {
    valid: true,
    meta: metaResult.data,
  };
}

