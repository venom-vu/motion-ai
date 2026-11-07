import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TopupsController } from './topups.controller.js';
import { TopupsService } from './topups.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TopupsController],
  providers: [TopupsService],
  exports: [TopupsService],
})
export class TopupsModule {}
