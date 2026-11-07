import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import { ApiErrorCode, getApiErrorMessageVi } from '@motion-ai/contracts';
import { resolveClientIp, type ClientIpRequest } from './client-ip.js';

export function getAuthThrottleOptions(): { limit: number; ttl: number } {
  const limit = Number.parseInt(process.env.AUTH_THROTTLE_LIMIT ?? '', 10);
  const ttl = Number.parseInt(process.env.AUTH_THROTTLE_TTL_MS ?? '', 10);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : 60_000,
  };
}

/** Rate-limit theo IP khách đã giải quyết; vượt giới hạn trả 429 `RATE_LIMITED`. */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return resolveClientIp(req as ClientIpRequest);
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      {
        code: ApiErrorCode.RATE_LIMITED,
        message: getApiErrorMessageVi(ApiErrorCode.RATE_LIMITED),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export function getShareThrottleOptions(): { limit: number; ttl: number } {
  const limit = Number.parseInt(process.env.SHARE_THROTTLE_LIMIT ?? '', 10);
  const ttl = Number.parseInt(process.env.SHARE_THROTTLE_TTL_MS ?? '', 10);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 120,
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : 60_000,
  };
}

/** Giới hạn riêng cho `GET /s/<token>` (công khai, nhiều người xem sau cùng một NAT); không dùng chung bộ đếm với auth. */
@Injectable()
export class ShareThrottlerGuard extends AuthThrottlerGuard {
  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const { limit, ttl } = getShareThrottleOptions();
    return super.handleRequest({
      ...props,
      limit,
      ttl,
      generateKey: (ctx, tracker, name) => props.generateKey(ctx, tracker, `share-${name}`),
    });
  }
}

export function getTopupThrottleOptions(): { limit: number; ttl: number } {
  const limit = Number.parseInt(process.env.TOPUP_THROTTLE_LIMIT ?? '', 10);
  const ttl = Number.parseInt(process.env.TOPUP_THROTTLE_TTL_MS ?? '', 10);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : 60_000,
  };
}

/** Giới hạn riêng cho route ghi `POST /topups`; không dùng chung bộ đếm với auth. */
@Injectable()
export class TopupThrottlerGuard extends AuthThrottlerGuard {
  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const { limit, ttl } = getTopupThrottleOptions();
    return super.handleRequest({
      ...props,
      limit,
      ttl,
      generateKey: (ctx, tracker, name) => props.generateKey(ctx, tracker, `topup-${name}`),
    });
  }
}
