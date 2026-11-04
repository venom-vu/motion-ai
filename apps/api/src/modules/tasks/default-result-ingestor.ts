import { Injectable } from '@nestjs/common';
import type { IngestTask, ResultIngestor } from '../../ports/index.js';
import { TasksService } from './tasks.service.js';

/** Bản mặc định: chưa có nhập kết quả thật (Story 2.6) nên luôn RELEASED, không bao giờ CAPTURED. */
@Injectable()
export class DefaultResultIngestor implements ResultIngestor {
  constructor(private readonly tasks: TasksService) {}

  async ingest(task: IngestTask): Promise<void> {
    await this.tasks.transition(task.id, 'running', 'failed', 'OUTPUT_UPLOAD_ERROR');
  }
}
