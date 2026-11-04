import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiErrorCode,
  UploadConfirmParamsSchema,
  UploadCreateRequestSchema,
  getApiErrorMessageVi,
  type UploadConfirmResponse,
  type UploadCreateResponse,
} from '@motion-ai/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccountLockedGuard } from '../auth/guards/account-locked.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { UploadsService } from './uploads.service.js';

@Controller('uploads')
@UseGuards(JwtAuthGuard, AccountLockedGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  async create(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: unknown,
  ): Promise<UploadCreateResponse> {
    const parsed = UploadCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message:
          parsed.error.issues[0]?.message ??
          getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    return this.uploads.create(user.sub, parsed.data);
  }

  @Post(':key/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentUser() user: JwtUserPayload,
    @Param('key') key: string,
  ): Promise<UploadConfirmResponse> {
    const parsed = UploadConfirmParamsSchema.safeParse({ key });
    if (!parsed.success) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    return this.uploads.confirm(user.sub, parsed.data.key);
  }
}
