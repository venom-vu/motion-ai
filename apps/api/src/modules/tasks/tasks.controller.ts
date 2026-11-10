import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiErrorCode,
  BodyRetouchCreateRequestSchema,
  FaceSwapCreateRequestSchema,
  MotionCreateRequestSchema,
  getValidationReasonMessageVi,
  type MotionCreateResponse,
  TaskIdParamsSchema,
  TaskListQuerySchema,
  type Task,
  getApiErrorMessageVi,
  type BodyRetouchCreateResponse,
  type FaceSwapCreateResponse,
  type TaskListResponse,
  type TaskResultResponse,
  type TaskShareResponse,
  type TaskShareRevokeResponse,
} from '@flowvis/contracts';
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
      const code = ApiErrorCode.VALIDATION_FAILED;
      throw new BadRequestException({
        code,
        message: parsed.error.issues[0]?.message ?? getApiErrorMessageVi(code),
      });
    }
    return this.tasks.createFaceSwap(user.sub, parsed.data);
  }

  @Post('body-retouch')
  async createBodyRetouch(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: unknown,
  ): Promise<BodyRetouchCreateResponse> {
    const parsed = BodyRetouchCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      const code = ApiErrorCode.VALIDATION_FAILED;
      throw new BadRequestException({
        code,
        message: parsed.error.issues[0]?.message ?? getApiErrorMessageVi(code),
      });
    }
    return this.tasks.createBodyRetouch(user.sub, parsed.data);
  }

  @Post('motion')
  async createMotion(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: unknown,
  ): Promise<MotionCreateResponse> {
    const parsed = MotionCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      const code = ApiErrorCode.VALIDATION_FAILED;
      // Thứ tự xác định: trimStart trước trimEnd.
      const trimIssue = ['trimStart', 'trimEnd']
        .map((k) => parsed.error.issues.find((i) => i.path[0] === k))
        .find((i) => i !== undefined);
      let reason: 'TRIM_NOT_WHOLE_SECOND' | 'TRIM_OUT_OF_VIDEO' | null = null;
      if (trimIssue?.code === 'too_small') reason = 'TRIM_OUT_OF_VIDEO';
      else if (trimIssue?.code === 'invalid_type' && trimIssue.expected === 'integer') {
        reason = 'TRIM_NOT_WHOLE_SECOND';
      }
      if (reason) {
        throw new BadRequestException({
          code,
          message: getValidationReasonMessageVi(reason),
          details: { reason },
        });
      }
      throw new BadRequestException({
        code,
        message: parsed.error.issues[0]?.message ?? getApiErrorMessageVi(code),
      });
    }
    return this.tasks.createMotionControl(user.sub, parsed.data);
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
