export const RUNNING_HUB_PORT = Symbol('RUNNING_HUB_PORT');
export const STORAGE_PORT = Symbol('STORAGE_PORT');
export const NOTIFIER_PORT = Symbol('NOTIFIER_PORT');

export interface RunningHubPort {
  readonly portName?: 'RunningHubPort';
}

export interface StoragePort {
  readonly portName?: 'StoragePort';
}

export interface NotifierPort {
  readonly portName?: 'NotifierPort';
}
