import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { GoogleOAuthService } from '../dist/modules/auth/google-oauth.service.js';

const REAL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REAL_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const FAKE_TOKEN_URL = 'http://host.docker.internal:3199/token';
const FAKE_USERINFO_URL = 'http://host.docker.internal:3199/userinfo';

const ENV_KEYS = [
  'NODE_ENV',
  'GOOGLE_TOKEN_URL',
  'GOOGLE_USERINFO_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
];

/** Chạy trao đổi code và trả về các URL mà service đã gọi (fetch được giả ở ranh giới HTTP). */
async function collectCalledUrls() {
  const urls = [];
  const service = new GoogleOAuthService();
  service.setFetchImpl(async (input) => {
    const url = String(input);
    urls.push(url);
    const body = url.endsWith('/token') || url === REAL_TOKEN_URL
      ? { access_token: 'tok' }
      : { sub: 'sub-1', email: 'a@b.test' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  await service.exchangeCodeAndGetProfile('code-1');
  return urls;
}

describe('Story 1.11: ghi đè endpoint Google bằng env', () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.GOOGLE_TOKEN_URL = FAKE_TOKEN_URL;
    process.env.GOOGLE_USERINFO_URL = FAKE_USERINFO_URL;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('ngoài production: dùng URL ghi đè', async () => {
    process.env.NODE_ENV = 'test';
    assert.deepEqual(await collectCalledUrls(), [FAKE_TOKEN_URL, FAKE_USERINFO_URL]);
  });

  it('ngoài production: không đặt env thì dùng URL Google thật', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.GOOGLE_TOKEN_URL;
    process.env.GOOGLE_USERINFO_URL = '   ';
    assert.deepEqual(await collectCalledUrls(), [REAL_TOKEN_URL, REAL_USERINFO_URL]);
  });

  it('production: bỏ qua env ghi đè, luôn dùng URL Google thật', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_CALLBACK_URL = 'https://api.example.test/auth/google/callback';
    assert.deepEqual(await collectCalledUrls(), [REAL_TOKEN_URL, REAL_USERINFO_URL]);
  });
});
