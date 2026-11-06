import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiErrorCode,
  FaceSwapCreateRequestSchema,
  TaskIdParamsSchema,
  TaskListQuerySchema,
  type Task,
  getApiErrorMessageVi,
  type FaceSwapCreateResponse,
  type TaskListResponse,
  type TaskResultResponse,
  type TaskShareResponse,
  type TaskShareRevokeResponse,
} from '@motion-ai/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccountLockedGuard } from '../auth/guards/account-locked.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { ShareService } from '../storage/share.service.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
@UseGuards(JwtAuthGuard, AccountLockedGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly share: ShareService,
  ) {}

  @Post('face-swap')
  async createFaceSwap(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: unknown,
  ): Promise<FaceSwapCreateResponse> {
    const parsed = FaceSwapCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      const consentIssue = parsed.error.issues.some((i) => i.path[0] === 'consent');
      const code = consentIssue ? ApiErrorCode.CONSENT_REQUIRED : ApiErrorCode.VALIDATION_FAILED;
      throw new BadRequestException({
        code,
        message: consentIssue
          ? getApiErrorMessageVi(code)
          : (parsed.error.issues[0]?.message ?? getApiErrorMessageVi(code)),
      });
    }
    return this.tasks.createFaceSwap(user.sub, parsed.data);
  }

  @Get()
  async list(
    @CurrentUser() user: JwtUserPayload,
    @Query() query: unknown,
  ): Promise<TaskListResponse> {
    const parsed = TaskListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    return this.tasks.list(user.sub, parsed.data);
  }

  private parseId(id: string): string {
    const p = TaskIdParamsSchema.safeParse({ id });
    if (!p.success) {
      throw new NotFoundException({
        code: ApiErrorCode.NOT_FOUND,
        message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND),
      });
    }
    return p.data.id;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: JwtUserPayload, @Param('id') id: string): Promise<Task> {
    return this.tasks.cancel(user.sub, this.parseId(id));
  }

  @Post(':id/share')
  async createShare(@CurrentUser() user: JwtUserPayload, @Param('id') id: string): Promise<TaskShareResponse> {
    return this.share.create(user.sub, this.parseId(id));
  }

  @Delete(':id/share')
  async revokeShare(@CurrentUser() user: JwtUserPayload, @Param('id') id: string): Promise<TaskShareRevokeResponse> {
    await this.share.revoke(user.sub, this.parseId(id));
    return { revoked: true };
  }

  @Get(':id/result')
  async result(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
  ): Promise<TaskResultResponse> {
    return this.tasks.getResult(user.sub, this.parseId(id));
  }

  @Get(':id')
  async get(@CurrentUser() user: JwtUserPayload, @Param('id') id: string): Promise<Task> {
    return this.tasks.getById(user.sub, this.parseId(id));
  }
}
