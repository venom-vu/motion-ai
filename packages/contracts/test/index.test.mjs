import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONTRACTS_PACKAGE_VERSION } from '../dist/index.js';

describe('@motion-ai/contracts', () => {
  it('exports package version constant', () => {
    assert.equal(CONTRACTS_PACKAGE_VERSION, '0.1.0');
  });
});
