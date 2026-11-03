import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AuthGoogleCallbackResponseSchema,
  AuthGoogleResponseSchema,
  MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE,
  MOCK_AUTH_GOOGLE_RESPONSE,
  MOCK_ME_RESPONSE,
  MOCK_ME_ZERO_BALANCE_RESPONSE,
  MOCK_WALLET_LEDGER_RESPONSE,
  MeResponseSchema,
  TOS_VERSION,
  WalletLedgerResponseSchema,
} from '@motion-ai/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const composeFiles = [
  path.join(repoRoot, 'deploy', 'compose.yml'),
  path.join(repoRoot, 'deploy', 'compose.smoke.yml'),
];

function startFakeGoogle(port) {
  const tokens = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fake');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && url.pathname === '/token') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const code = new URLSearchParams(body).get('code') ?? '';
        const token = `fake-access-${code}`;
        tokens.set(token, code);
        res.end(JSON.stringify({ access_token: token, token_type: 'Bearer' }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/userinfo') {
      const token = String(req.headers.authorization ?? '').replace('Bearer ', '');
      const code = tokens.get(token);
      if (!code) {
        res.statusCode = 401;
        res.end('{}');
        return;
      }
      res.end(
        JSON.stringify({
          sub: `sub-${code}`,
          email: `${code}@smoke.test`,
          name: `Smoke ${code}`,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

describe('Smoke đăng nhập FE-BE trên stack Compose', () => {
  it(
    'đăng nhập Google giả, tặng 500 credit một lần, chống lạm dụng, hợp đồng và đối soát',
    {
      skip:
        process.env.RUN_COMPOSE_E2E === '1'
          ? false
          : 'Đặt RUN_COMPOSE_E2E=1 để chạy (cần Docker, build image, dựng cả stack)',
      timeout: 900_000,
    },
    async () => {
      const project = 'motion-ai-smoke';
      const apiPort = '3102';
      const googlePort = 3199;
      const base = `http://127.0.0.1:${apiPort}`;
      const env = {
        ...process.env,
        PORT: apiPort,
        POSTGRES_PORT: '15433',
        REDIS_PORT: '16380',
        GOOGLE_TOKEN_URL: `http://host.docker.internal:${googlePort}/token`,
        GOOGLE_USERINFO_URL: `http://host.docker.internal:${googlePort}/userinfo`,
      };
      delete env.DATABASE_URL;
      delete env.REDIS_URL;
      const compose = (args, options = {}) =>
        execFileSync(
          'docker',
          [
            'compose',
            '-p',
            project,
            ...composeFiles.flatMap((f) => ['-f', f]),
            ...args,
          ],
          { cwd: repoRoot, env, encoding: 'utf8', stdio: 'pipe', ...options },
        );

      let google;
      try {
        google = await startFakeGoogle(googlePort);
        compose(['up', '-d', '--build', '--wait']);

        // Đăng nhập: /auth/google (cấp cookie thiết bị) -> callback JSON
        async function login(label, deviceCookie) {
          const q = new URLSearchParams({
            tosVersion: TOS_VERSION,
            deviceId: 'client-device',
          });
          const r1 = await fetch(`${base}/auth/google?${q}`, {
            headers: deviceCookie ? { Cookie: deviceCookie } : {},
          });
          assert.equal(r1.status, 200);
          const start = AuthGoogleResponseSchema.parse(await r1.json());
          const setCookie = r1.headers.getSetCookie().find((c) => c.startsWith('motion_device='));
          const cookie = setCookie ? setCookie.split(';')[0] : deviceCookie;
          const state = new URL(start.redirectUrl).searchParams.get('state');
          assert.ok(state);
          const r2 = await fetch(
            `${base}/auth/google/callback?${new URLSearchParams({ code: label, state })}`,
            { headers: { Cookie: cookie } },
          );
          assert.equal(r2.status, 200);
          const session = AuthGoogleCallbackResponseSchema.parse(await r2.json());
          const auth = { Authorization: `Bearer ${session.accessToken}` };
          const meRes = await fetch(`${base}/me`, { headers: auth });
          assert.equal(meRes.status, 200);
          const me = MeResponseSchema.parse(await meRes.json());
          const ledRes = await fetch(`${base}/wallet/ledger?pageSize=20`, { headers: auth });
          assert.equal(ledRes.status, 200);
          const ledger = WalletLedgerResponseSchema.parse(await ledRes.json());
          return { cookie, session, me, ledger, start };
        }

        // Người dùng mới
        const first = await login('alice', undefined);
        assert.ok(first.cookie, 'phải có cookie motion_device');
        assert.equal(first.session.isNewUser, true);
        assert.equal(first.session.grantedCredits, 500);
        assert.equal(first.me.balance, 500);
        assert.equal(first.me.email, 'alice@smoke.test');
        assert.equal(first.ledger.items.filter((i) => i.type === 'GRANT').length, 1);
        assert.equal(first.ledger.items.length, 1);

        // Tài khoản thứ hai cùng thiết bị
        const second = await login('bob', first.cookie);
        assert.equal(second.session.isNewUser, true);
        assert.ok(
          second.session.grantedCredits === 0 || second.session.grantedCredits === undefined,
          `grantedCredits của tài khoản thứ hai phải là 0 hoặc vắng, nhận ${second.session.grantedCredits}`,
        );
        assert.equal(second.me.balance, 0);
        assert.equal(second.ledger.items.filter((i) => i.type === 'GRANT').length, 0);

        // Hợp đồng: MOCK_* và phản hồi BE thật cùng parse qua schema, cùng hình dạng
        AuthGoogleResponseSchema.parse(MOCK_AUTH_GOOGLE_RESPONSE);
        AuthGoogleCallbackResponseSchema.parse(MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE);
        MeResponseSchema.parse(MOCK_ME_RESPONSE);
        MeResponseSchema.parse(MOCK_ME_ZERO_BALANCE_RESPONSE);
        WalletLedgerResponseSchema.parse(MOCK_WALLET_LEDGER_RESPONSE);
        assert.deepEqual(Object.keys(first.me).sort(), Object.keys(MOCK_ME_RESPONSE).sort());
        // `note` là trường tùy chọn nên dòng GRANT thật có thể không có; mọi khóa thật phải nằm trong mock.
        const mockLedgerKeys = new Set(Object.keys(MOCK_WALLET_LEDGER_RESPONSE.items[0]));
        for (const key of Object.keys(first.ledger.items[0])) {
          assert.ok(mockLedgerKeys.has(key), `khóa ledger thật lạ: ${key}`);
        }
        assert.deepEqual(
          Object.keys(first.session).filter((k) => k !== 'isNewUser' && k !== 'grantedCredits').sort(),
          Object.keys(MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE)
            .filter((k) => k !== 'isNewUser' && k !== 'grantedCredits')
            .sort(),
        );

        // Đối soát trong container worker: execFileSync ném lỗi nếu mã thoát khác 0
        const out = compose([
          'exec',
          '-T',
          'nestjs-worker',
          'node',
          'apps/api/dist/scripts/reconcile.js',
        ]);
        assert.match(out, /"status":"ok"/);
      } finally {
        try {
          compose(['down', '-v']);
        } catch {
          // best-effort cleanup
        }
        if (google) await new Promise((r) => google.close(r));
      }
    },
  );

  it('MOCK_* parse được qua schema contracts (không cần Docker)', () => {
    MeResponseSchema.parse(MOCK_ME_RESPONSE);
    WalletLedgerResponseSchema.parse(MOCK_WALLET_LEDGER_RESPONSE);
    AuthGoogleResponseSchema.parse(MOCK_AUTH_GOOGLE_RESPONSE);
    AuthGoogleCallbackResponseSchema.parse(MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE);
  });
});
