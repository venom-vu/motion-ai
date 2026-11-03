import { Injectable, Logger } from '@nestjs/common';
import type { NotifierEvent, NotifierPort } from '../../ports/index.js';

@Injectable()
export class LogNotifierAdapter implements NotifierPort {
  private readonly logger = new Logger('Notifier');

  async notify(event: NotifierEvent): Promise<void> {
    const line = `[${event.kind}] ${event.message} ${JSON.stringify(event.data ?? {})}`;
    if (event.severity === 'error') this.logger.error(line);
    else if (event.severity === 'warn') this.logger.warn(line);
    else this.logger.log(line);
  }
}
