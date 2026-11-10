import { Controller, Get, Header, Param, Redirect, UseGuards } from '@nestjs/common';
import type { ShareInfoResponse } from '@flowvis/contracts';
import { ShareThrottlerGuard } from '../auth/throttler.guard.js';
import { ShareService } from './share.service.js';

/** GET /s/<token> — công khai, không đăng nhập; chuyển hướng tới URL ký của file `out/`. */
@Controller('s')
@UseGuards(ShareThrottlerGuard)
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async open(@Param('token') token: string): Promise<{ url: string; statusCode: number }> {
    return { url: await this.share.resolve(token), statusCode: 302 };
  }

  @Get(':token/info')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async info(@Param('token') token: string): Promise<ShareInfoResponse> {
    return this.share.info(token);
  }

  @Get(':token/poster')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async poster(@Param('token') token: string): Promise<{ url: string; statusCode: number }> {
    return { url: await this.share.poster(token), statusCode: 302 };
  }
}
