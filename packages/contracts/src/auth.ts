import { z } from 'zod';

/**
 * Phiên bản Điều khoản dịch vụ (ToS) hiện hành dùng chung cho cả Frontend và Backend (FR19, AD-12).
 */
export const TOS_VERSION = '2026-11-01' as const;

export const USER_ROLES = ['user', 'admin'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * GET /auth/google — Query khởi tạo luồng đăng nhập Google OAuth kèm xác nhận ToS và mã thiết bị.
 */
export const AuthGoogleQuerySchema = z.object({
  tosVersion: z.string().trim().min(1, 'tosVersion là bắt buộc'),
  deviceId: z.string().trim().min(1, 'deviceId là bắt buộc'),
});
export const AuthGoogleRequestSchema = AuthGoogleQuerySchema;
export type AuthGoogleQuery = z.infer<typeof AuthGoogleQuerySchema>;
export type AuthGoogleRequest = AuthGoogleQuery;

export const AuthGoogleResponseSchema = z.object({
  redirectUrl: z.string().url(),
});
export type AuthGoogleResponse = z.infer<typeof AuthGoogleResponseSchema>;

/**
 * GET /auth/google/callback — Query callback từ Google OAuth2 và phản hồi cấp phiên JWT.
 */
export const AuthGoogleCallbackSuccessQuerySchema = z.object({
  code: z.string().trim().min(1, 'code là bắt buộc'),
  state: z.string().trim().min(1, 'state là bắt buộc'),
});
/** Google gọi lại với lỗi (ví dụ user bấm Hủy: error=access_denied); state vẫn bắt buộc để chống CSRF. */
export const AuthGoogleCallbackErrorQuerySchema = z.object({
  error: z.string().trim().min(1, 'error là bắt buộc'),
  error_description: z.string().optional(),
  state: z.string().trim().min(1, 'state là bắt buộc'),
});
export const AuthGoogleCallbackQuerySchema = z.union([
  AuthGoogleCallbackSuccessQuerySchema,
  AuthGoogleCallbackErrorQuerySchema,
]);
export const AuthGoogleCallbackRequestSchema = AuthGoogleCallbackQuerySchema;
export type AuthGoogleCallbackQuery = z.infer<
  typeof AuthGoogleCallbackQuerySchema
>;
export type AuthGoogleCallbackRequest = AuthGoogleCallbackQuery;

export const AuthTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

export const AuthGoogleCallbackResponseSchema = AuthTokenResponseSchema.extend({
  isNewUser: z.boolean().optional(),
  grantedCredits: z.number().int().nonnegative().optional(),
});
export type AuthGoogleCallbackResponse = z.infer<
  typeof AuthGoogleCallbackResponseSchema
>;

/**
 * POST /auth/refresh — Làm mới Access JWT bằng Refresh Token trong httpOnly cookie.
 */
export const AuthRefreshRequestSchema = z.object({}).strict().optional();
export type AuthRefreshRequest = z.infer<typeof AuthRefreshRequestSchema>;

export const AuthRefreshResponseSchema = AuthTokenResponseSchema;
export type AuthRefreshResponse = z.infer<typeof AuthRefreshResponseSchema>;

/**
 * POST /auth/logout — Thu hồi Refresh Token và xóa cookie phiên đăng nhập.
 */
export const AuthLogoutRequestSchema = z.object({}).strict().optional();
export type AuthLogoutRequest = z.infer<typeof AuthLogoutRequestSchema>;

export const AuthLogoutResponseSchema = z.object({
  success: z.literal(true),
});
export type AuthLogoutResponse = z.infer<typeof AuthLogoutResponseSchema>;
