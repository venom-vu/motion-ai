import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOS_VERSION } from '@flowvis/contracts';
import { terms } from '../content/legal/terms.ts';
import { privacy } from '../content/legal/privacy.ts';
import {
  REPORT_MAILTO_BODY,
  REPORT_MAILTO_SUBJECT,
  buildReportMailto,
} from '../utils/system-status.ts';
import { assertReportEmail } from '../scripts/assert-report-email.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Story 6.9 - văn bản pháp lý', () => {
  it('TOS_VERSION trùng terms.version', () => {
    assert.equal(terms.version, TOS_VERSION);
  });
  it('terms và privacy có nội dung bắt buộc', () => {
    const t = JSON.stringify(terms);
    for (const k of ['18 tuổi', 'đồng ý', 'khiêu dâm', 'bôi nhọ', 'Miễn trừ']) {
      assert.ok(t.includes(k), k);
    }
    const p = JSON.stringify(privacy);
    for (const k of ['băm', '7 ngày', '30 ngày', 'token', 'email']) assert.ok(p.includes(k), k);
  });
  it('script kiểm phát hành fail và nêu file khi còn draft', () => {
    const r = spawnSync(process.execPath, [path.join(webRoot, 'scripts/check-legal-release.mjs')], { encoding: 'utf8' });
    for (const [doc, file] of [[terms, /terms\.ts/], [privacy, /privacy\.ts/]]) {
      if (doc.status === 'draft') assert.match(r.stderr, file);
      else assert.doesNotMatch(r.stderr, file);
    }
    assert.equal(r.status, [terms, privacy].some((d) => d.status === 'draft') ? 1 : 0);
  });
  it('mailto cố định: đúng tiêu đề và hướng dẫn, không chứa dữ liệu người dùng', () => {
    assert.equal(REPORT_MAILTO_SUBJECT, 'Báo cáo vi phạm flowvis');
    assert.equal(
      REPORT_MAILTO_BODY,
      'Vui lòng nêu mã tác vụ hoặc liên kết chia sẻ và mô tả vi phạm.',
    );
    assert.equal(
      buildReportMailto('abuse@example.com'),
      'mailto:abuse@example.com?subject=' +
        encodeURIComponent('Báo cáo vi phạm flowvis') +
        '&body=' +
        encodeURIComponent('Vui lòng nêu mã tác vụ hoặc liên kết chia sẻ và mô tả vi phạm.'),
    );
  });
  it('mailto rỗng hoặc chỉ khoảng trắng trả về "#"', () => {
    assert.equal(buildReportMailto(''), '#');
    assert.equal(buildReportMailto('   '), '#');
  });
  it('assertReportEmail: production throw khi thiếu/rỗng/khoảng trắng, qua khi có địa chỉ', () => {
    for (const v of [undefined, '', ' ']) {
      assert.throws(() => assertReportEmail(v, 'production'), /NUXT_PUBLIC_REPORT_EMAIL/);
    }
    assert.doesNotThrow(() => assertReportEmail('abuse@example.com', 'production'));
    assert.doesNotThrow(() => assertReportEmail(undefined, 'development'));
  });
  it('nuxt.config gọi assertReportEmail ở hook nitro:build:before', () => {
    const cfg = fs.readFileSync(path.join(webRoot, 'nuxt.config.ts'), 'utf8');
    assert.match(cfg, /nitro:build:before[\s\S]*assertReportEmail/);
    assert.match(cfg, /reportEmail/);
  });
  it('layout có AppFooter với 3 liên kết', () => {
    assert.match(fs.readFileSync(path.join(webRoot, 'layouts/default.vue'), 'utf8'), /<AppFooter/);
    const f = fs.readFileSync(path.join(webRoot, 'components/AppFooter.vue'), 'utf8');
    for (const k of ['/terms', '/privacy', 'Điều khoản dịch vụ', 'Chính sách quyền riêng tư', 'Báo cáo vi phạm']) assert.ok(f.includes(k));
  });
});
