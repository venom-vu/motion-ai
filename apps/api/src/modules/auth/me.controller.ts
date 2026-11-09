import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiErrorCode,
  WalletLedgerQuerySchema,
  getApiErrorMessageVi,
  type MeResponse,
  type PricingConfigResponse,
  type UserRole,
  type WalletLedgerResponse,
} from '@flowvis/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import { PRICING_CONFIG } from '../wallet/tier.js';
import { WalletService } from '../wallet/wallet.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { AccountLockedGuard } from './guards/account-locked.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { JwtUserPayload } from './jwt.strategy.js';

@Controller()
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  @Get('config/pricing')
  getPricing(): PricingConfigResponse {
    return PRICING_CONFIG;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, AccountLockedGuard)
  async getMe(@CurrentUser() user: JwtUserPayload): Promise<MeResponse> {
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
    });
    const summary = await this.wallet.getSummary(dbUser.id);
    return {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role as UserRole,
      tier: summary.tier,
      balance: summary.balance,
      held: summary.held,
      tosVersion: dbUser.tosVersion,
    };
  }

  @Get('wallet/ledger')
  @UseGuards(JwtAuthGuard, AccountLockedGuard)
  async getLedger(
    @CurrentUser() user: JwtUserPayload,
    @Query() query: Record<string, unknown>,
  ): Promise<WalletLedgerResponse> {
    const parsed = WalletLedgerQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    return this.wallet.listLedger(
      user.sub,
      parsed.data.pageSize,
      parsed.data.cursor,
    );
  }
}
