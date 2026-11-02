import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  Res,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiErrorCode,
  AuthGoogleCallbackQuerySchema,
  AuthGoogleQuerySchema,
  TOS_VERSION,
  getApiErrorMessageVi,
  type AuthGoogleCallbackResponse,
  type AuthGoogleResponse,
  type AuthLogoutResponse,
  type AuthRefreshResponse,
} from '@motion-ai/contracts';
import { AuthService, ConsentRequiredException } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Roles } from './decorators/roles.decorator.js';
import { AccountLockedGuard } from './guards/account-locked.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import type { JwtUserPayload } from './jwt.strategy.js';

export interface RequestWithCookies {
  cookies?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
  user?: unknown;
}

export interface ResponseWithCookies {
  redirect(url: string): void;
  cookie(name: string, val: string, options?: unknown): void;
  clearCookie(name: string, options?: unknown): void;
}

export const REFRESH_COOKIE_NAME = 'refreshToken';

export function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'false' ? false : true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 ngày
  };
}

export function buildFrontendRedirect(
  path: string,
  query?: Record<string, string>,
): string {
  const base = (process.env.FRONTEND_URL ?? '').split(',')[0]?.trim() || 'http://localhost:3000';
  const url = new URL(path, base.replace(/\/+$/, '') + '/');
  for (const [k, v] of Object.entries(query ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('google')
  async googleAuth(
    @Query() rawQuery: Record<string, unknown>,
  ): Promise<AuthGoogleResponse> {
    const tosVersion =
      typeof rawQuery?.tosVersion === 'string'
        ? rawQuery.tosVersion.trim()
        : '';
    if (!tosVersion || tosVersion !== TOS_VERSION) {
      throw new ConsentRequiredException();
    }

    const parsed = AuthGoogleQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
        details: parsed.error.format(),
      });
    }

    return this.authService.getGoogleAuthUrl(parsed.data);
  }

  /**
   * Google redirect trình duyệt thẳng về endpoint này. Khi là điều hướng của trình duyệt
   * (Accept: text/html) thì đặt cookie phiên rồi chuyển về FE; client API/test vẫn nhận JSON.
   */
  @Get('google/callback')
  async googleCallback(
    @Query() rawQuery: unknown,
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: ResponseWithCookies,
  ): Promise<AuthGoogleCallbackResponse | void> {
    const wantsRedirect = String(req.headers?.accept ?? '').includes('text/html');

    try {
      const parsed = AuthGoogleCallbackQuerySchema.safeParse(rawQuery);
      if (!parsed.success) {
        throw new BadRequestException({
          code: ApiErrorCode.VALIDATION_FAILED,
          message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
          details: parsed.error.format(),
        });
      }

      const session = await this.authService.handleGoogleCallback(parsed.data);

      // Gửi refresh token qua httpOnly, Secure cookie
      res.cookie(
        REFRESH_COOKIE_NAME,
        session.refreshToken,
        getRefreshCookieOptions(),
      );

      if (wantsRedirect) {
        return res.redirect(buildFrontendRedirect('/auth/callback'));
      }

      return {
        accessToken: session.accessToken,
        tokenType: session.tokenType,
        expiresIn: session.expiresIn,
        isNewUser: session.isNewUser,
      };
    } catch (err) {
      if (!wantsRedirect) {
        throw err;
      }
      const body = (err as { getResponse?: () => unknown }).getResponse?.();
      const code =
        body && typeof body === 'object' && 'code' in body
          ? String((body as { code: unknown }).code)
          : 'OAUTH_FAILED';
      return res.redirect(buildFrontendRedirect('/', { authError: code }));
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: ResponseWithCookies,
  ): Promise<AuthRefreshResponse> {
    const token =
      (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) ||
      (req.cookies?.refresh_token as string | undefined);

    const session = await this.authService.refreshSession(token);

    // Xoay vòng cookie refresh token mới
    res.cookie(
      REFRESH_COOKIE_NAME,
      session.newRefreshToken,
      getRefreshCookieOptions(),
    );

    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresIn: session.expiresIn,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: ResponseWithCookies,
  ): Promise<AuthLogoutResponse> {
    const token =
      (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) ||
      (req.cookies?.refresh_token as string | undefined);

    await this.authService.logout(token);

    // Xóa cookie phiên với đầy đủ thuộc tính bảo mật
    const cookieOpts = getRefreshCookieOptions();
    res.clearCookie(REFRESH_COOKIE_NAME, cookieOpts);
    res.clearCookie('refresh_token', cookieOpts);

    return { success: true };
  }

  /**
   * Route kiểm thử quyền admin dành cho bộ test tự động và xác minh phân quyền (AC5).
   */
  @Get('admin-probe')
  @UseGuards(JwtAuthGuard, RolesGuard, AccountLockedGuard)
  @Roles('admin')
  adminProbe(@CurrentUser() user: JwtUserPayload) {
    return {
      success: true,
      role: user.role,
      email: user.email,
    };
  }

  /**
   * Route kiểm thử tài khoản bị khóa dành cho bộ test tự động (AC6).
   */
  @Get('user-probe')
  @UseGuards(JwtAuthGuard, AccountLockedGuard)
  userProbe(@CurrentUser() user: JwtUserPayload) {
    return {
      success: true,
      sub: user.sub,
      role: user.role,
    };
  }
}
