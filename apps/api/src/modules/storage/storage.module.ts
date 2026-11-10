import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { STORAGE_PORT } from '../../ports/index.js';
import { AuthModule } from '../auth/auth.module.js';
import { S3StorageAdapter } from './s3-storage.adapter.js';
import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsExpiryService } from './uploads-expiry.service.js';
import { VideoProbeService } from './video-probe.service.js';
import { UploadsService } from './uploads.service.js';

@Module({
  imports: [AuthModule, ScheduleModule.forRoot()],
  controllers: [UploadsController, ShareController],
  providers: [
    S3StorageAdapter,
    { provide: STORAGE_PORT, useExisting: S3StorageAdapter },
    UploadsService,
    VideoProbeService,
    UploadsExpiryService,
    ShareService,
  ],
  exports: [STORAGE_PORT, UploadsService, ShareService],
})
export class StorageModule {}
