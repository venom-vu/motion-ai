import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { OpsStatusResponse, SystemStatusResponse } from '@flowvis/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { SettingsService } from './settings.service.js';

@Controller()
export class OpsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('system/status')
  async systemStatus(): Promise<SystemStatusResponse> {
    return { intakePaused: await this.settings.isIntakePaused() };
  }

  @Get('admin/ops/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async opsStatus(): Promise<OpsStatusResponse> {
    return this.buildStatus();
  }

  @Post('admin/ops/resume')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async resume(@CurrentUser() user: JwtUserPayload): Promise<OpsStatusResponse> {
    await this.prisma.$transaction(async (tx) => {
      const { before } = await this.settings.resume(tx);
      await this.audit.record(tx, {
        adminId: user.sub,
        action: 'ops.resume',
        target: 'ops',
        beforeAfter: { before, after: { intakePaused: false, rhBudgetExhausted: false } },
      });
    });
    return this.buildStatus();
  }

  private async buildStatus(): Promise<OpsStatusResponse> {
    return {
      intakePaused: await this.settings.isIntakePaused(),
      rhBudgetExhausted: await this.settings.isRhBudgetExhausted(),
      lastBreakerTrigger: await this.settings.getLastBreakerTrigger(),
      rhBalance: await this.settings.getRhBalance(),
      lastBackup: null,
    };
  }
}
