export const CONTRACTS_PACKAGE_VERSION = '0.1.0' as const;

export interface HealthContract {
  status: 'ok';
}

export * from './errors.js';
export * from './auth.js';
export * from './wallet.js';
export * from './mocks.js';
