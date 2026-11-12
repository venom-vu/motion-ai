// Story 6.11: hợp đồng JSON của CLI prelaunch-notify (bước 1) mà scripts/prelaunch/step1-discord.mjs đọc.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(apiRoot, 'dist', 'scripts', 'prelaunch-notify.js');

function runCli(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli], { env: { PATH: process.env.PATH, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const lastJson = (text) => JSON.parse(text.trim().split('\n').filter(Boolean).at(-1));

describe('Story 6.11: CLI prelaunch-notify', () => {
  let server;
  let base;
  const hits = [];

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        hits.push({ url: req.url, body });
        res.writeHead(req.url === '/ok' ? 204 : 500);
        res.end();
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((r) => server.close(r)));

  it('webhook trả 204: in {ok:true, latencyMs:number}, thoát 0', async () => {
    const r = await runCli({ DISCORD_WEBHOOK_URL: `${base}/ok` });
    assert.equal(r.code, 0);
    const out = lastJson(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(typeof out.latencyMs, 'number');
    const hit = hits.find((h) => h.url === '/ok');
    assert.ok(hit);
    assert.match(JSON.parse(hit.body).content, /prelaunch\.discord_test/);
  });

  it('webhook trả 500: in {ok:false}, thoát 1, không lộ URL', async () => {
    const r = await runCli({ DISCORD_WEBHOOK_URL: `${base}/fail` });
    assert.equal(r.code, 1);
    const out = lastJson(r.stdout);
    assert.equal(out.ok, false);
    assert.ok(!r.stdout.includes(base));
  });

  it('không có DISCORD_WEBHOOK_URL: thoát 2', async () => {
    const r = await runCli({});
    assert.equal(r.code, 2);
    assert.equal(lastJson(r.stdout).ok, false);
    assert.match(r.stderr, /DISCORD_WEBHOOK_URL/);
  });
});
