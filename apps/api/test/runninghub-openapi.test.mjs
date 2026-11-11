import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  RunningHubOpenApiAdapter,
  withImageExtension,
} from '../dist/modules/tasks/runninghub-openapi.adapter.js';
import { createRunningHubPort } from '../dist/modules/tasks/runninghub-http.adapter.js';
import { UnconfiguredRunningHubAdapter } from '../dist/modules/tasks/runninghub-unconfigured.adapter.js';
import { RunningHubError, RunningHubNetworkError } from '../dist/ports/index.js';

const API_KEY = 'test-key-123';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
const signal = () => new AbortController().signal;

let server;
let base;
let next; // phản hồi kế tiếp do từng test đặt: { status, body } hoặc hàm
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      const r = typeof next === 'function' ? next(req) : next;
      res.statusCode = r.status ?? 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const adapter = () => new RunningHubOpenApiAdapter(API_KEY, base);

describe('RunningHubOpenApiAdapter', () => {
  it('uploadFile: gửi multipart có apiKey, fileType=input, tên có đuôi; trả data.fileName', async () => {
    seen.length = 0;
    next = { body: { code: 0, msg: 'success', data: { fileName: 'api/abc.png', fileType: 'input' } } };
    const name = await adapter().uploadFile(PNG, 'task1-sourceKey', signal());
    assert.equal(name, 'api/abc.png');
    const req = seen[0];
    assert.equal(req.url, '/task/openapi/upload');
    assert.equal(req.headers.authorization, `Bearer ${API_KEY}`);
    assert.match(req.headers['content-type'], /^multipart\/form-data/);
    const text = req.body.toString('latin1');
    assert.match(text, /name="apiKey"\r\n\r\ntest-key-123/);
    assert.match(text, /name="fileType"\r\n\r\ninput/);
    assert.match(text, /name="file"; filename="task1-sourceKey\.png"/);
  });

  it('uploadFile: code khác 0 là RunningHubError và không lộ apiKey', async () => {
    next = { body: { code: 1001, msg: 'bad', data: null } };
    await assert.rejects(adapter().uploadFile(PNG, 'x', signal()), (e) => {
      assert.ok(e instanceof RunningHubError);
      assert.ok(!e.message.includes(API_KEY));
      return true;
    });
  });

  it('submit: gọi /openapi/v2/run/ai-app/{appId} chỉ với Bearer, không có apiKey trong body; giữ taskId int64 lớn', async () => {
    seen.length = 0;
    next = {
      body: '{"taskId":1910246754753896450,"status":"QUEUED","errorCode":"","errorMessage":"","results":null}',
    };
    const nodes = [{ nodeId: '10', fieldName: 'image', fieldValue: 'api/abc.png' }];
    const id = await adapter().submit('1915026059757322242', nodes, signal());
    assert.equal(id, '1910246754753896450');
    const req = seen[0];
    assert.equal(req.url, '/openapi/v2/run/ai-app/1915026059757322242');
    assert.equal(req.headers.authorization, `Bearer ${API_KEY}`);
    const body = JSON.parse(req.body.toString());
    assert.deepEqual(body, { nodeInfoList: nodes, instanceType: 'default', usePersonalQueue: 'false' });
    assert.ok(!('apiKey' in body));
  });

  it("submit mode 'workflow': gọi /openapi/v2/run/workflow/{id} với addMetadata=false và usePersonalQueue, chỉ Bearer", async () => {
    seen.length = 0;
    next = { body: '{"taskId":2097300000000000001,"status":"QUEUED","errorCode":"","errorMessage":"","results":null}' };
    const nodes = [{ nodeId: '10', fieldName: 'image', fieldValue: 'api/abc.png' }];
    const id = await adapter().submit('2097271148131237890', nodes, signal(), 'workflow');
    assert.equal(id, '2097300000000000001');
    const req = seen[0];
    assert.equal(req.url, '/openapi/v2/run/workflow/2097271148131237890');
    assert.equal(req.headers.authorization, `Bearer ${API_KEY}`);
    const body = JSON.parse(req.body.toString());
    assert.deepEqual(body, {
      addMetadata: false,
      nodeInfoList: nodes,
      instanceType: 'default',
      usePersonalQueue: 'false',
    });
    assert.ok(!('apiKey' in body));
  });

  it('submit: errorCode (HTTP 200) là RunningHubError, gồm 821 hết credit trả phí và 380', async () => {
    for (const errorCode of ['821', '380', '433', '1002']) {
      next = { body: { taskId: '', status: '', errorCode, errorMessage: 'x', results: null } };
      await assert.rejects(adapter().submit('app', [], signal()), (e) => e instanceof RunningHubError && e.message.includes(errorCode));
    }
    next = { body: { taskId: '1', status: 'FAILED', errorCode: '', errorMessage: '', results: null } };
    await assert.rejects(adapter().submit('app', [], signal()), RunningHubError);
    next = { body: { taskId: '', status: 'QUEUED', errorCode: '', errorMessage: '', results: null } };
    await assert.rejects(adapter().submit('app', [], signal()), RunningHubError);
  });

  it('upload/submit: msg và errorMessage có từ khóa hết tiền được đưa vào RunningHubError (RH_BUDGET)', async () => {
    const { mapRunningHubFailure } = await import('../dist/modules/pipelines/pipeline-config.js');
    next = { body: { code: 1001, msg: 'Insufficient balance', data: null } };
    await assert.rejects(adapter().uploadFile(PNG, 'x', signal()), (e) => {
      assert.ok(e instanceof RunningHubError);
      assert.equal(mapRunningHubFailure(e.message), 'RH_BUDGET');
      return true;
    });
    next = { body: { taskId: '', status: '', errorCode: '821', errorMessage: 'Not enough coins', results: null } };
    await assert.rejects(adapter().submit('app', [], signal()), (e) => {
      assert.ok(e instanceof RunningHubError);
      assert.equal(mapRunningHubFailure(e.message), 'RH_BUDGET');
      return true;
    });
  });

  it('getBalance: đọc RH_BALANCE_ENDPOINT; data.remainCoins, data.coins, coins cấp trên; lỗi khi thiếu cấu hình/không hợp lệ/không OK', async () => {
    const saved = process.env.RH_BALANCE_ENDPOINT;
    try {
      delete process.env.RH_BALANCE_ENDPOINT;
      await assert.rejects(adapter().getBalance(signal()), RunningHubError);
      process.env.RH_BALANCE_ENDPOINT = 'balance/path';
      seen.length = 0;
      next = { body: { code: 0, data: { remainCoins: '12345' } } };
      assert.equal(await adapter().getBalance(signal()), 12345);
      assert.equal(seen[0].url, '/balance/path');
      next = { body: { code: 0, data: { coins: 7 } } };
      assert.equal(await adapter().getBalance(signal()), 7);
      next = { body: { coins: 0 } };
      assert.equal(await adapter().getBalance(signal()), 0);
      for (const body of [{ data: { coins: 'abc' } }, { data: { coins: -1 } }, { data: {} }]) {
        next = { body };
        await assert.rejects(adapter().getBalance(signal()), RunningHubError);
      }
      next = { status: 403, body: {} };
      await assert.rejects(adapter().getBalance(signal()), RunningHubError);
      next = { status: 500, body: {} };
      await assert.rejects(adapter().getBalance(signal()), RunningHubNetworkError);
    } finally {
      if (saved === undefined) delete process.env.RH_BALANCE_ENDPOINT; else process.env.RH_BALANCE_ENDPOINT = saved;
    }
  });

  it('query: QUEUED và RUNNING là RUNNING; gọi /openapi/v2/query với {taskId}', async () => {
    seen.length = 0;
    for (const status of ['QUEUED', 'RUNNING']) {
      next = { body: { taskId: '1', status, errorCode: '', errorMessage: '', results: null } };
      assert.deepEqual(await adapter().outputs('1910246754753896450', signal()), { status: 'RUNNING' });
    }
    assert.equal(seen[0].url, '/openapi/v2/query');
    assert.equal(seen[0].headers.authorization, `Bearer ${API_KEY}`);
    assert.deepEqual(JSON.parse(seen[0].body.toString()), { taskId: '1910246754753896450' });
  });

  it('query: SUCCESS lấy results[0].url', async () => {
    next = { body: { taskId: '1', status: 'SUCCESS', errorCode: '', errorMessage: '', results: [{ url: 'https://cdn.example/out.jpg', outputType: 'jpg' }] } };
    const out = await adapter().outputs('1', signal());
    assert.equal(out.status, 'SUCCESS');
    assert.equal(out.fileUrl, 'https://cdn.example/out.jpg');
  });

  it('query: SUCCESS nhiều đầu ra (zip trước png): chọn ảnh, bỏ file zip', async () => {
    next = { body: { taskId: '1', status: 'SUCCESS', errorCode: '', errorMessage: '', results: [
      { url: 'https://cdn.example/pack.zip', outputType: 'zip' },
      { url: 'https://cdn.example/out.png', outputType: 'png' },
    ] } };
    const out = await adapter().outputs('1', signal());
    assert.equal(out.fileUrl, 'https://cdn.example/out.png');
  });

  it('query: SUCCESS không có url thì trả SUCCESS không fileUrl (worker hoàn credit)', async () => {
    next = { body: { taskId: '1', status: 'SUCCESS', errorCode: '', errorMessage: '', results: [] } };
    const out = await adapter().outputs('1', signal());
    assert.equal(out.status, 'SUCCESS');
    assert.equal(out.fileUrl, undefined);
  });

  it('query: FAILED lấy errorMessage hoặc failedReason.exception_message', async () => {
    next = { body: { taskId: '1', status: 'FAILED', errorCode: '1000', errorMessage: 'NO_FACE: không thấy mặt', results: null, failedReason: {} } };
    assert.deepEqual(await adapter().outputs('1', signal()), { status: 'FAILED', errorMessage: 'NO_FACE: không thấy mặt' });
    next = { body: { taskId: '1', status: 'FAILED', errorCode: '1000', errorMessage: 'chung', results: null, failedReason: { exception_message: 'NO_POSE: x' } } };
    assert.equal((await adapter().outputs('1', signal())).errorMessage, 'NO_POSE: x');
  });

  it('query: HTTP 200 với status rỗng và errorCode không bị coi là còn chạy', async () => {
    next = { body: { taskId: '1', status: '', errorCode: '806', errorMessage: 'APIKEY_USER_NOT_FOUND', results: null } };
    await assert.rejects(adapter().outputs('1', signal()), RunningHubError);
    next = { body: { taskId: '1', status: '', errorCode: '1004', errorMessage: 'not found', results: null } };
    await assert.rejects(adapter().outputs('1', signal()), RunningHubError);
    next = { body: { taskId: '1', status: '', errorCode: '', errorMessage: '', results: null } };
    await assert.rejects(adapter().outputs('1', signal()), RunningHubError);
  });

  it('mã bận 415/421/1003/1005 là RunningHubNetworkError; submit/upload báo requestSent=false', async () => {
    for (const errorCode of ['415', '421', '1003', '1005']) {
      next = { body: { taskId: '', status: '', errorCode, errorMessage: 'busy', results: null } };
      await assert.rejects(adapter().submit('app', [], signal()), (e) => e instanceof RunningHubNetworkError && e.requestSent === false);
      await assert.rejects(adapter().outputs('1', signal()), RunningHubNetworkError);
    }
    next = { body: { code: 421, msg: 'busy', data: null } };
    await assert.rejects(adapter().uploadFile(PNG, 'x', signal()), (e) => e instanceof RunningHubNetworkError && e.requestSent === false);
  });

  it('HTTP 5xx và 429 là RunningHubNetworkError (tạm thời); 4xx là RunningHubError', async () => {
    for (const status of [500, 503, 429]) {
      next = { status, body: {} };
      await assert.rejects(adapter().outputs('1', signal()), RunningHubNetworkError);
    }
    next = { status: 401, body: {} };
    await assert.rejects(adapter().outputs('1', signal()), RunningHubError);
  });

  it('phản hồi không phải JSON là RunningHubNetworkError', async () => {
    next = { body: '<html>bad gateway</html>' };
    await assert.rejects(adapter().outputs('1', signal()), RunningHubNetworkError);
  });

  it('kết nối bị từ chối trước khi gửi: requestSent=false; abort được ném nguyên', async () => {
    // Lấy một cổng trống thật rồi đóng lại: kết nối tới đó bị ECONNREFUSED (cổng 1 bị fetch chặn là "bad port").
    const probe = http.createServer();
    await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const freePort = probe.address().port;
    await new Promise((r) => probe.close(r));
    const dead = new RunningHubOpenApiAdapter(API_KEY, `http://127.0.0.1:${freePort}`);
    await assert.rejects(dead.submit('wf', [], signal()), (e) => e instanceof RunningHubNetworkError && e.requestSent === false);
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(adapter().outputs('1', ctrl.signal), (e) => !(e instanceof RunningHubError) && !(e instanceof RunningHubNetworkError));
  });

  it('thiếu apiKey thì từ chối khởi tạo', () => {
    assert.throws(() => new RunningHubOpenApiAdapter('', base));
  });
});

describe('withImageExtension', () => {
  it('thêm đuôi theo magic bytes, giữ nguyên khi đã có đuôi', () => {
    assert.equal(withImageExtension('a', PNG), 'a.png');
    assert.equal(withImageExtension('a', Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'a.jpg');
    assert.equal(withImageExtension('a', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'a.webp');
    assert.equal(withImageExtension('a.jpeg', PNG), 'a.jpeg');
    assert.equal(withImageExtension('a', Buffer.from('xyz')), 'a');
  });
});

describe('createRunningHubPort: chọn adapter', () => {
  const KEYS = ['NODE_ENV', 'RUNNINGHUB_BASE_URL', 'RUNNINGHUB_API_KEY', 'RUNNINGHUB_API_HOST'];
  it('có RUNNINGHUB_API_KEY thì dùng adapter OpenAPI, không thì adapter chưa cấu hình', () => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    try {
      delete process.env.RUNNINGHUB_BASE_URL;
      delete process.env.RUNNINGHUB_API_HOST;
      process.env.NODE_ENV = 'production';
      delete process.env.RUNNINGHUB_API_KEY;
      assert.ok(createRunningHubPort() instanceof UnconfiguredRunningHubAdapter);
      process.env.RUNNINGHUB_API_KEY = '  ';
      assert.ok(createRunningHubPort() instanceof UnconfiguredRunningHubAdapter);
      process.env.RUNNINGHUB_API_KEY = API_KEY;
      assert.ok(createRunningHubPort() instanceof RunningHubOpenApiAdapter);
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
