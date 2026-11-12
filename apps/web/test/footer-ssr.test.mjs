// Story 6.10: kiểm chân trang trên HTML SSR của bản Nuxt đã build (không dùng trình duyệt).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(webRoot, '.output/public/_worker.js/index.js');
const REPORT_EMAIL = 'abuse@smoke.test';
const PAGES = ['/', '/terms', '/privacy', '/pricing', '/history'];

describe('Story 6.10 - chân trang trên HTML SSR của bản build', {
  skip: fs.existsSync(entry) ? false : 'Chưa có .output (chạy pnpm --filter @flowvis/web run build)',
}, () => {
  for (const page of PAGES) {
    it(`${page}: có 3 liên kết, mailto đúng địa chỉ cấu hình`, async () => {
      const { default: worker } = await import(pathToFileURL(entry).href);
      const res = await worker.fetch(
        new Request(`http://localhost${page}`),
        { NUXT_PUBLIC_REPORT_EMAIL: REPORT_EMAIL },
        { waitUntil() {}, passThroughOnException() {} },
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      const footer = /<footer[^>]*data-testid="app-footer"[\s\S]*?<\/footer>/.exec(html)?.[0];
      assert.ok(footer, 'thiếu chân trang');
      const hrefs = [...footer.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
      assert.equal(hrefs.length, 3);
      assert.ok(hrefs.includes('/terms'));
      assert.ok(hrefs.includes('/privacy'));
      const mailto = hrefs.find((h) => h.startsWith('mailto:'));
      assert.ok(mailto, 'thiếu liên kết mailto');
      assert.equal(mailto.slice('mailto:'.length).split('?')[0], REPORT_EMAIL);
    });
  }
});
