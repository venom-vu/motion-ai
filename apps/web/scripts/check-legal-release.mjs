// Kiểm tra phát hành: fail và nêu file khi văn bản pháp lý còn status 'draft'.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['content/legal/terms.ts', 'content/legal/privacy.ts'];
const drafts = files.filter((f) =>
  /status:\s*['"`]draft['"`]/.test(fs.readFileSync(path.join(root, f), 'utf8')),
);
if (drafts.length > 0) {
  console.error(`Văn bản pháp lý còn ở trạng thái draft: ${drafts.join(', ')}`);
  process.exit(1);
}
console.log('Văn bản pháp lý đã final.');
