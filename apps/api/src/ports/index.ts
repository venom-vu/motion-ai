export const RUNNING_HUB_PORT = Symbol('RUNNING_HUB_PORT');
export const STORAGE_PORT = Symbol('STORAGE_PORT');
export const NOTIFIER_PORT = Symbol('NOTIFIER_PORT');

export interface RunningHubPort {
  readonly portName?: 'RunningHubPort';
}

export interface StoragePort {
  readonly portName?: 'StoragePort';
}

export interface NotifierEvent {
  readonly kind: string;
  readonly message: string;
  readonly severity?: 'info' | 'warn' | 'error';
  readonly data?: Record<string, unknown>;
}

export interface NotifierPort {
  readonly portName?: 'NotifierPort';
  notify(event: NotifierEvent): Promise<void>;
}
