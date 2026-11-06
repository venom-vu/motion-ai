import { Controller, Get, Param, Redirect, UseGuards } from '@nestjs/common';
import { AuthThrottlerGuard } from '../auth/throttler.guard.js';
import { ShareService } from './share.service.js';

/** GET /s/<token> — công khai, không đăng nhập; chuyển hướng tới URL ký của file `out/`. */
@Controller('s')
@UseGuards(AuthThrottlerGuard)
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Get(':token')
  @Redirect()
  async open(@Param('token') token: string): Promise<{ url: string; statusCode: number }> {
    return { url: await this.share.resolve(token), statusCode: 302 };
  }
}
