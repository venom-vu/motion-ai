import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPublicHttpUrl } from '../dist/modules/tasks/result-ingestor.js';

describe('isPublicHttpUrl (chặn SSRF khi tải kết quả)', () => {
  for (const url of [
    'https://rh.example.test/out/a.png',
    'http://8.8.8.8/a.png',
    'https://172.32.0.1/a.png',
  ]) it(`cho phép ${url}`, () => assert.equal(isPublicHttpUrl(url), true));

  for (const url of [
    'ftp://rh.example.test/a.png',
    'not a url',
    'http://localhost/a',
    'http://foo.localhost/a',
    'http://127.0.0.1/a',
    'http://0.0.0.0/a',
    'http://10.1.2.3/a',
    'http://172.16.0.1/a',
    'http://172.31.255.255/a',
    'http://192.168.1.1/a',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/a',
    'http://[fd00::1]/a',
    'http://[fe80::1]/a',
    'http://[::ffff:127.0.0.1]/a',
    'http://db.internal/a',
  ]) it(`chặn ${url}`, () => assert.equal(isPublicHttpUrl(url), false));
});
