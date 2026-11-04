import { z } from 'zod';

/**
 * Quy tắc ảnh đầu vào dùng chung cho FE và BE (Epic 2).
 */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MIN_IMAGE_SHORT_SIDE_PX = 512;
/** Tỷ lệ cạnh dài / cạnh ngắn tối đa (1:2 đến 2:1). */
export const MAX_IMAGE_ASPECT_RATIO = 2;
export const MAX_UNCONFIRMED_RAW_UPLOADS = 10;

/** Loại và kích thước khai báo (dùng cho POST /uploads). */
export const ImageFileDeclarationSchema = z.object({
  mimeType: z.enum(IMAGE_MIME_TYPES, {
    errorMap: () => ({ message: 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.' }),
  }),
  sizeBytes: z
    .number({ invalid_type_error: 'Dung lượng ảnh không hợp lệ.' })
    .int('Dung lượng ảnh không hợp lệ.')
    .positive('Dung lượng ảnh không hợp lệ.')
    .max(MAX_IMAGE_BYTES, 'Ảnh vượt quá dung lượng tối đa 10 MB.'),
});
export type ImageFileDeclaration = z.infer<typeof ImageFileDeclarationSchema>;

/** Schema ảnh duy nhất: loại, dung lượng và kích thước đo được. */
export const ImageMetaSchema = ImageFileDeclarationSchema.extend({
  width: z.number().int().positive('Chiều rộng ảnh không hợp lệ.'),
  height: z.number().int().positive('Chiều cao ảnh không hợp lệ.'),
}).superRefine((img, ctx) => {
  const short = Math.min(img.width, img.height);
  const long = Math.max(img.width, img.height);
  if (short < MIN_IMAGE_SHORT_SIDE_PX) {
    const path = img.width <= img.height ? 'width' : 'height';
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: `Cạnh ngắn của ảnh phải từ ${MIN_IMAGE_SHORT_SIDE_PX}px trở lên.`,
    });
  }
  if (short > 0 && long / short > MAX_IMAGE_ASPECT_RATIO) {
    const path = img.width >= img.height ? 'width' : 'height';
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: 'Tỷ lệ ảnh phải nằm trong khoảng từ 1:2 đến 2:1.',
    });
  }
});
export type ImageMeta = z.infer<typeof ImageMetaSchema>;

const UUID_SEG = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** Khóa R2 do server sinh: <tiền tố>/<userId uuid>/<uuid>. */
export const RawUploadKeySchema = z
  .string()
  .regex(new RegExp(`^in-raw/${UUID_SEG}/${UUID_SEG}$`), 'Khóa tải lên không hợp lệ.');
export const ConfirmedUploadKeySchema = z
  .string()
  .regex(new RegExp(`^in/${UUID_SEG}/${UUID_SEG}$`), 'Khóa ảnh đã xác nhận không hợp lệ.');

/** POST /uploads */
export const UploadCreateRequestSchema = ImageFileDeclarationSchema;
export type UploadCreateRequest = z.infer<typeof UploadCreateRequestSchema>;

export const UploadCreateResponseSchema = z.object({
  key: RawUploadKeySchema,
  method: z.literal('PUT'),
  uploadUrl: z.string().url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
});
export type UploadCreateResponse = z.infer<typeof UploadCreateResponseSchema>;

/** POST /uploads/{key}/confirm */
export const UploadConfirmParamsSchema = z.object({ key: RawUploadKeySchema });
export type UploadConfirmParams = z.infer<typeof UploadConfirmParamsSchema>;
export const UploadConfirmRequestSchema = z.object({}).strict().optional();
export type UploadConfirmRequest = z.infer<typeof UploadConfirmRequestSchema>;

export const UploadConfirmResponseSchema = z.object({
  key: ConfirmedUploadKeySchema,
  image: ImageMetaSchema,
});
export type UploadConfirmResponse = z.infer<typeof UploadConfirmResponseSchema>;
