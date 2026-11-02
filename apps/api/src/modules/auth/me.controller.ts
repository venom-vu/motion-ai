import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  DEFAULT_PRICING_CONFIG,
  type MeResponse,
  type WalletLedgerResponse,
  type PricingConfigResponse,
  type UserRole,
} from '@motion-ai/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { AccountLockedGuard } from './guards/account-locked.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { JwtUserPayload } from './jwt.strategy.js';

@Controller()
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('config/pricing')
  getPricing(): PricingConfigResponse {
    return DEFAULT_PRICING_CONFIG;
  }

  /**
   * Danh tính lấy từ DB. Module `wallet` chưa có sổ cái nên balance/held/tier
   * tạm là giá trị mặc định; thay bằng wallet service khi Story ví hoàn tất.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard, AccountLockedGuard)
  async getMe(@CurrentUser() user: JwtUserPayload): Promise<MeResponse> {
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
    });
    return {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role as UserRole,
      tier: 'FREE',
      balance: 0,
      held: 0,
      tosVersion: dbUser.tosVersion,
    };
  }

  /** Chưa có bảng sổ cái (module `wallet`), nên trả trang rỗng đúng schema. */
  @Get('wallet/ledger')
  @UseGuards(JwtAuthGuard, AccountLockedGuard)
  getLedger(): WalletLedgerResponse {
    return { items: [], pageSize: 20, hasMore: false, nextCursor: null };
  }
}
