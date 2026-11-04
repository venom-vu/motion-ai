import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiErrorCode,
  FaceSwapCreateRequestSchema,
  TaskIdParamsSchema,
  type Task,
  getApiErrorMessageVi,
  type FaceSwapCreateResponse,
} from '@motion-ai/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccountLockedGuard } from '../auth/guards/account-locked.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
@UseGuards(JwtAuthGuard, AccountLockedGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

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

  @Get(':id')
  async get(@CurrentUser() user: JwtUserPayload, @Param('id') id: string): Promise<Task> {
    return this.tasks.getById(user.sub, this.parseId(id));
  }
}
