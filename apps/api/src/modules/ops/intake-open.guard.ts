import {
  CanActivate,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ApiErrorCode, getApiErrorMessageVi } from '@flowvis/contracts';
import { SettingsService } from './settings.service.js';

/** Đánh dấu route tạo Task; test CI duyệt route yêu cầu có IntakeOpenGuard đi kèm. */
export const CREATES_TASK_KEY = 'ops:creates-task';
export const CreatesTask = () => SetMetadata(CREATES_TASK_KEY, true);

export class IntakePausedException extends HttpException {
  constructor() {
    super(
      { code: ApiErrorCode.PAUSED, message: getApiErrorMessageVi(ApiErrorCode.PAUSED) },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

@Injectable()
export class IntakeOpenGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(): Promise<boolean> {
    if (await this.settings.isIntakePaused()) throw new IntakePausedException();
    return true;
  }
}
