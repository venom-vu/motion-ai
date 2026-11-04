import { Injectable } from '@nestjs/common';
import { RunningHubError, type RunningHubPort } from '../../ports/index.js';

/** Adapter mặc định khi chưa có adapter HTTP thật: mọi lời gọi ném RH_ERROR. */
@Injectable()
export class UnconfiguredRunningHubAdapter implements RunningHubPort {
  readonly portName = 'RunningHubPort' as const;

  private fail(): never {
    throw new RunningHubError('RunningHub chưa được cấu hình');
  }
  uploadFile(): Promise<string> {
    return Promise.reject(new RunningHubError('RunningHub chưa được cấu hình'));
  }
  submit(): Promise<string> {
    return Promise.reject(new RunningHubError('RunningHub chưa được cấu hình'));
  }
  outputs(): Promise<never> {
    return this.fail();
  }
}
