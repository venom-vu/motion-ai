import crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ApiErrorCode,
  TOS_VERSION,
  getApiErrorMessageVi,
  type AuthGoogleCallbackQuery,
  type UserRole,
} from '@flowvis/contracts';
import { PrismaService, type PrismaTransactionClient } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';
import { GoogleOAuthService, type GoogleUserProfile } from './google-oauth.service.js';
import {
  SIGNUP_GRANT_AMOUNT,
  SIGNUP_GRANT_IP_WINDOW_MS,
  SIGNUP_GRANT_MAX_PER_IP,
  hmacHex,
  issueDeviceCookie,
  verifyDeviceCookie,
} from './anti-abuse.js';
import { ipRateKey } from './client-ip.js';
import { WalletService } from '../wallet/wallet.service.js';
import { AccountLockedException } from './guards/account-locked.guard.js';

export class ConsentRequiredException extends BadRequestException {
  constructor(message?: string) {
    super({
      code: ApiErrorCode.CONSENT_REQUIRED,
      message: message || getApiErrorMessageVi(ApiErrorCode.CONSENT_REQUIRED),
    });
  }
}

interface OAuthStatePayload {
  nonce: string;
  tosVersion: string;
  deviceId: string;
  createdAt: number;
}

export interface GoogleCallbackSessionResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  isNewUser: boolean;
  grantedCredits?: number;
  refreshToken: string;
}

export interface RefreshSessionResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  newRefreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly walletService: WalletService,
  ) {}

  /** Khóa tài khoản trong transaction của bên gọi: khóa dòng, đặt locked_at, thu hồi mọi refresh token. Trả lockedAt trước đó. */
  async lockAccount(tx: PrismaTransactionClient, userId: string): Promise<{ before: Date | null; after: Date }> {
    const rows = await tx.$queryRaw<Array<{ locked_at: Date | null }>>`SELECT locked_at FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (rows.length !== 1) throw new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND) });
    const after = rows[0].locked_at ?? new Date();
    await tx.user.update({ where: { id: userId }, data: { lockedAt: after } });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { before: rows[0].locked_at, after };
  }

  /** Mở khóa tài khoản trong transaction của bên gọi. */
  async unlockAccount(tx: PrismaTransactionClient, userId: string): Promise<{ before: Date | null }> {
    const rows = await tx.$queryRaw<Array<{ locked_at: Date | null }>>`SELECT locked_at FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (rows.length !== 1) throw new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND) });
    await tx.user.update({ where: { id: userId }, data: { lockedAt: null } });
    return { before: rows[0].locked_at };
  }


  private getJwtSecret(): string {
    return (
      process.env.JWT_SECRET ||
      'flowvis-jwt-dev-secret-change-me-in-production-min-32-chars'
    );
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  resolveRoleForEmail(email: string): UserRole {
    const adminEmailsRaw = process.env.ADMIN_EMAILS || '';
    const adminEmails = adminEmailsRaw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    const normalized = email.trim().toLowerCase();
    return adminEmails.includes(normalized) ? 'admin' : 'user';
  }

  private signOAuthState(payload: OAuthStatePayload): string {
    const rawData = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getJwtSecret())
      .update(rawData)
      .digest('base64url');
    return `${rawData}.${signature}`;
  }

  private async verifyOAuthState(stateStr: string): Promise<OAuthStatePayload> {
    if (!stateStr || typeof stateStr !== 'string') {
      throw new BadRequestException('Thiếu state OAuth');
    }

    const dotIndex = stateStr.lastIndexOf('.');
    if (dotIndex <= 0) {
      throw new BadRequestException('State OAuth không hợp lệ');
    }

    const rawData = stateStr.slice(0, dotIndex);
    const signature = stateStr.slice(dotIndex + 1);

    const expectedSignature = crypto
      .createHmac('sha256', this.getJwtSecret())
      .update(rawData)
      .digest('base64url');

    if (
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      )
    ) {
      throw new BadRequestException('State OAuth chữ ký không hợp lệ');
    }

    let payload: OAuthStatePayload;
    try {
      const jsonStr = Buffer.from(rawData, 'base64url').toString('utf8');
      payload = JSON.parse(jsonStr) as OAuthStatePayload;
    } catch {
      throw new BadRequestException('State OAuth payload không hợp lệ');
    }

    // Kiểm tra hết hạn: state chỉ có hiệu lực trong 10 phút
    const ageMs = Date.now() - payload.createdAt;
    if (ageMs > 10 * 60 * 1000 || ageMs < -60 * 1000) {
      throw new BadRequestException('State OAuth đã hết hạn');
    }

    // Kiểm tra phiên bản ToS
    if (payload.tosVersion !== TOS_VERSION) {
      throw new ConsentRequiredException();
    }

    // Kiểm tra và xóa nonce khỏi Redis (chống tấn công replay)
    let delCount = 0;
    try {
      delCount = await this.redis.client.del(`oauth:state:${payload.nonce}`);
    } catch (err) {
      this.logger.error(`Lỗi kết nối Redis khi xóa state nonce: ${err}`);
      throw new BadRequestException('Không thể xác thực state OAuth');
    }

    if (delCount <= 0) {
      throw new BadRequestException(
        'State OAuth đã được sử dụng hoặc không hợp lệ',
      );
    }

    return payload;
  }

  /**
   * `deviceId` trong query chỉ để tương thích hợp đồng; định danh thiết bị thật do server cấp
   * qua cookie ký (`existingDeviceCookie`). Trả `newDeviceCookie` khi cần đặt cookie mới.
   */
  async getGoogleAuthUrl(
    query: { tosVersion: string; deviceId: string },
    existingDeviceCookie?: unknown,
  ): Promise<{ redirectUrl: string; newDeviceCookie?: string }> {
    if (query.tosVersion !== TOS_VERSION) {
      throw new ConsentRequiredException();
    }

    const cleanDeviceId = (query.deviceId ?? '').trim();
    if (!cleanDeviceId) {
      throw new BadRequestException('Thiếu deviceId');
    }

    let serverDeviceId = verifyDeviceCookie(existingDeviceCookie);
    let newDeviceCookie: string | undefined;
    if (!serverDeviceId) {
      const issued = issueDeviceCookie();
      serverDeviceId = issued.deviceId;
      newDeviceCookie = issued.cookieValue;
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const statePayload: OAuthStatePayload = {
      nonce,
      tosVersion: query.tosVersion,
      deviceId: serverDeviceId,
      createdAt: Date.now(),
    };

    const signedState = this.signOAuthState(statePayload);

    // Lưu state nonce vào Redis với TTL 10 phút
    try {
      await this.redis.client.set(`oauth:state:${nonce}`, '1', 'EX', 600);
    } catch (err) {
      // Fail-closed: không có nonce thì callback chắc chắn bị từ chối, nên báo lỗi ngay từ đầu
      this.logger.error(`Không thể lưu state nonce vào Redis: ${err}`);
      throw new ServiceUnavailableException('Dịch vụ đăng nhập tạm thời không khả dụng');
    }

    const redirectUrl = this.googleOAuthService.getAuthorizationUrl(signedState);
    return { redirectUrl, newDeviceCookie };
  }

  async handleGoogleCallback(
    query: AuthGoogleCallbackQuery,
    clientIp = 'unknown',
  ): Promise<GoogleCallbackSessionResult> {
    // 1. Luôn xác minh state trước để chống CSRF kể cả khi Google trả callback lỗi
    const statePayload = await this.verifyOAuthState(query.state);

    if ('error' in query) {
      this.logger.warn(`Google OAuth error callback: ${query.error}`);
      throw new BadRequestException({
        code: query.error,
        message:
          query.error_description || `Google OAuth từ chối với lỗi ${query.error}`,
      });
    }

    // 2. Trao đổi mã xác thực lấy hồ sơ người dùng Google
    let profile: GoogleUserProfile;
    try {
      profile = await this.googleOAuthService.exchangeCodeAndGetProfile(
        query.code,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Lỗi trao đổi code với Google: ${msg}`);
      throw new BadRequestException(`Xác thực Google thất bại: ${msg}`);
    }

    const normalizedEmail = profile.email.trim().toLowerCase();

    // 3. Tìm người dùng trong DB
    // Chỉ khớp theo googleId. Email đã gắn googleId khác thì từ chối, tránh một danh tính Google
    // khác chiếm tài khoản (và credit) của người khác.
    let user = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (byEmail) {
        this.logger.warn(`Từ chối đăng nhập: email ${normalizedEmail} đã gắn với googleId khác`);
        throw new ConflictException({
          code: ApiErrorCode.EMAIL_LINKED_TO_OTHER_ACCOUNT,
          message: getApiErrorMessageVi(ApiErrorCode.EMAIL_LINKED_TO_OTHER_ACCOUNT),
        });
      }
    }

    let isNewUser = false;
    let granted = 0n;

    if (user) {
      // Kiểm tra tài khoản bị khóa
      if (user.lockedAt !== null) {
        throw new AccountLockedException();
      }

      // Đồng bộ role theo ADMIN_EMAILS và cập nhật cam kết ToS mới nhất
      const role = this.resolveRoleForEmail(normalizedEmail);
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: profile.googleId,
          role,
          tosVersion: statePayload.tosVersion,
          tosAcceptedAt: new Date(),
        },
      });
    } else {
      isNewUser = true;
      const role = this.resolveRoleForEmail(normalizedEmail);

      const ipHash = hmacHex(`ip:${ipRateKey(clientIp)}`);
      const fingerprintHash = hmacHex(`device:${statePayload.deviceId}`);

      try {
      user = await this.prisma.$transaction(
        async (tx) => {
          // Khóa advisory theo thứ tự số cố định để tránh deadlock
          const rows = await tx.$queryRaw<{ k: bigint }[]>`
            SELECT hashtextextended(${ipHash}, 0) AS k
            UNION ALL
            SELECT hashtextextended(${fingerprintHash}, 0) AS k`;
          const keys = [...new Set(rows.map((r) => BigInt(r.k)))].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0,
          );
          for (const key of keys) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`;
          }

          const deviceGranted = await tx.signupGrant.findFirst({
            where: { fingerprintHash, granted: { gt: 0n } },
            select: { userId: true },
          });
          const ipGrants = await tx.signupGrant.count({
            where: {
              ipHash,
              granted: { gt: 0n },
              createdAt: {
                gte: new Date(Date.now() - SIGNUP_GRANT_IP_WINDOW_MS),
              },
            },
          });
          granted =
            !deviceGranted && ipGrants < SIGNUP_GRANT_MAX_PER_IP
              ? SIGNUP_GRANT_AMOUNT
              : 0n;

          const created = await tx.user.create({
            data: {
              googleId: profile.googleId,
              email: normalizedEmail,
              role,
              tosVersion: statePayload.tosVersion,
              tosAcceptedAt: new Date(),
            },
          });
          await tx.signupGrant.create({
            data: { userId: created.id, fingerprintHash, ipHash, granted },
          });
          if (granted > 0n) {
            await this.walletService.grant(tx, created.id, granted);
          }
          return tx.user.findUniqueOrThrow({ where: { id: created.id } });
        },
        { maxWait: 15_000, timeout: 15_000 },
      );
      } catch (err) {
        // Hai callback đồng thời của cùng một tài khoản: bên thua gặp P2002 trên googleId/email.
        // Coi như đăng nhập lại tài khoản vừa được bên kia tạo thay vì trả 500.
        if ((err as { code?: string }).code !== 'P2002') throw err;
        const existing = await this.prisma.user.findUnique({
          where: { googleId: profile.googleId },
        });
        if (!existing) throw err;
        if (existing.lockedAt !== null) throw new AccountLockedException();
        user = existing;
        isNewUser = false;
        granted = 0n;
      }
    }

    // 4. Cấp Access JWT và Refresh Token
    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        jti: crypto.randomUUID(),
      },
      {
        expiresIn: 900, // 15 phút (900 giây)
      },
    );

    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 ngày

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      isNewUser,
      grantedCredits: isNewUser ? Number(granted) : undefined,
      refreshToken: rawRefreshToken,
    };
  }

  async refreshSession(
    rawRefreshToken: string | undefined,
  ): Promise<RefreshSessionResult> {
    if (
      !rawRefreshToken ||
      typeof rawRefreshToken !== 'string' ||
      rawRefreshToken.trim() === ''
    ) {
      throw new UnauthorizedException('Thiếu refresh token trong cookie');
    }

    const tokenHash = this.hashToken(rawRefreshToken.trim());
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    if (stored.revokedAt !== null) {
      throw new UnauthorizedException('Refresh token đã bị thu hồi');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token đã hết hạn');
    }

    if (stored.user.lockedAt !== null) {
      throw new AccountLockedException();
    }

    // Xoay vòng (Rotate) qua Compare-And-Set: đảm bảo chỉ một request đồng thời thu hồi token thành công
    const updateResult = await this.prisma.refreshToken.updateMany({
      where: {
        id: stored.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      throw new UnauthorizedException('Refresh token đã bị thu hồi');
    }

    // Cấp refresh token mới
    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = this.hashToken(newRawRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: stored.user.id,
        tokenHash: newTokenHash,
        expiresAt,
      },
    });

    // Cấp access JWT mới
    const accessToken = this.jwtService.sign(
      {
        sub: stored.user.id,
        email: stored.user.email,
        role: stored.user.role,
        jti: crypto.randomUUID(),
      },
      {
        expiresIn: 900,
      },
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      newRefreshToken: newRawRefreshToken,
    };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (
      rawRefreshToken &&
      typeof rawRefreshToken === 'string' &&
      rawRefreshToken.trim() !== ''
    ) {
      const tokenHash = this.hashToken(rawRefreshToken.trim());
      await this.prisma.refreshToken.updateMany({
        where: {
          tokenHash,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }
  }
}
