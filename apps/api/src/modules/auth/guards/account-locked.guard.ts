import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiErrorCode, getApiErrorMessageVi } from '@flowvis/contracts';
import { PrismaService } from '../../../infra/prisma.service.js';
import type { JwtUserPayload } from '../jwt.strategy.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AccountLockedException extends ForbiddenException {
  constructor(message?: string) {
    super({
      code: ApiErrorCode.ACCOUNT_LOCKED,
      message: message || getApiErrorMessageVi(ApiErrorCode.ACCOUNT_LOCKED),
    });
  }
}

@Injectable()
export class AccountLockedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtUserPayload | undefined;

    if (!user || !user.sub) {
      return true;
    }

    if (!UUID_REGEX.test(user.sub)) {
      throw new UnauthorizedException('User ID không hợp lệ');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { lockedAt: true },
    });

    if (!dbUser) {
      throw new UnauthorizedException('Người dùng không tồn tại');
    }

    if (dbUser.lockedAt !== null) {
      throw new AccountLockedException();
    }

    return true;
  }
}
