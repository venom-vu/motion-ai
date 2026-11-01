import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONTRACTS_PACKAGE_VERSION } from '@motion-ai/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('@motion-ai/web skeleton', () => {
  it('resolves shared @motion-ai/contracts workspace package', () => {
    assert.equal(CONTRACTS_PACKAGE_VERSION, '0.1.0');
  });

  it('has app.vue and nuxt.config.ts files', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'app.vue')));
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'nuxt.config.ts')));
  });
});
