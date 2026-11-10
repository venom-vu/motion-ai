import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { PIPELINE_CONFIGS } from '../dist/modules/pipelines/pipeline-config.js';
import { PipelinesService } from '../dist/modules/pipelines/pipelines.service.js';

const VARS = ['RUNNINGHUB_MODE_FACESWAP', 'RUNNINGHUB_MODE_BODY_RESHAPE'];
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('PipelinesService.getRunMode: chọn ai-app hoặc workflow theo env', () => {
  const svc = new PipelinesService();

  it('để trống thì dùng mặc định: face_swap là ai-app, body_retouch là workflow', () => {
    for (const k of VARS) delete process.env[k];
    assert.equal(svc.getRunMode(PIPELINE_CONFIGS.face_swap), 'ai-app');
    assert.equal(svc.getRunMode(PIPELINE_CONFIGS.body_retouch), 'workflow');
  });

  it('mỗi chức năng chọn độc lập qua biến của chính nó', () => {
    process.env.RUNNINGHUB_MODE_FACESWAP = 'workflow';
    process.env.RUNNINGHUB_MODE_BODY_RESHAPE = 'ai-app';
    assert.equal(svc.getRunMode(PIPELINE_CONFIGS.face_swap), 'workflow');
    assert.equal(svc.getRunMode(PIPELINE_CONFIGS.body_retouch), 'ai-app');
  });

  it('không phân biệt hoa thường và khoảng trắng; "ai-model" cũng là ai-app', () => {
    process.env.RUNNINGHUB_MODE_FACESWAP = '  AI-Model ';
    process.env.RUNNINGHUB_MODE_BODY_RESHAPE = ' Workflow ';
    assert.equal(svc.getRunMode(PIPELINE_CONFIGS.face_swap), 'ai-app');
    assert.equal(svc.getRunMode(PIPELINE_CONFIGS.body_retouch), 'workflow');
  });

  it('giá trị lạ thì ném lỗi nêu tên biến, không đoán', () => {
    process.env.RUNNINGHUB_MODE_BODY_RESHAPE = 'comfy';
    assert.throws(
      () => svc.getRunMode(PIPELINE_CONFIGS.body_retouch),
      /RUNNINGHUB_MODE_BODY_RESHAPE không hợp lệ/,
    );
  });

  it('onModuleInit từ chối giá trị lạ để api và worker không khởi động sai', () => {
    process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';
    process.env.RUNNINGHUB_WORKFLOW_MOTION ??= 'wf-motion';
    process.env.RUNNINGHUB_MODE_FACESWAP = 'xyz';
    assert.throws(() => svc.onModuleInit(), /RUNNINGHUB_MODE_FACESWAP không hợp lệ/);
  });
});
