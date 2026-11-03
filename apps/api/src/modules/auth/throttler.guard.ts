import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
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
