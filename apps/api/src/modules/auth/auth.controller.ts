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
  user?: unknown;
}

export interface ResponseWithCookies {
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

  @Get('google/callback')
  async googleCallback(
    @Query() rawQuery: unknown,
    @Res({ passthrough: true }) res: ResponseWithCookies,
  ): Promise<AuthGoogleCallbackResponse> {
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

    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresIn: session.expiresIn,
      isNewUser: session.isNewUser,
    };
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
