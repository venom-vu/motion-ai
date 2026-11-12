import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ref } from 'vue';
import { buildPageTokens } from '../utils/pagination.ts';
import {
  BADGE_TONE_CLASS,
  getTaskStatusBadge,
  getTopupPackBadge,
  getTopupStatusBadge,
} from '../utils/status-badge.ts';
import { useCursorPager } from '../composables/useCursorPager.ts';

describe('buildPageTokens: số trang kèm dấu "…"', () => {
  it('ít trang: hiện đủ, không có "…"', () => {
    assert.deepEqual(buildPageTokens(1, 1), [1]);
    assert.deepEqual(buildPageTokens(2, 5), [1, 2, 3, 4, 5]);
  });
  it('nhiều trang: giữ trang đầu, cuối và trang kề trang hiện tại', () => {
    assert.deepEqual(buildPageTokens(1, 12), [1, 2, 'ellipsis', 12]);
    assert.deepEqual(buildPageTokens(6, 12), [1, 'ellipsis', 5, 6, 7, 'ellipsis', 12]);
    assert.deepEqual(buildPageTokens(12, 12), [1, 'ellipsis', 11, 12]);
  });
  it('khoảng trống chỉ 1 trang thì hiện số thay vì "…"', () => {
    assert.deepEqual(buildPageTokens(4, 7), [1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('useCursorPager.goTo', () => {
  it('nhảy tới trang đã tải, kẹp trong [1, pageCount]', () => {
    const items = ref(Array.from({ length: 35 }, (_, i) => i));
    const p = useCursorPager(items, ref(false), async () => {}, 10);
    p.goTo(3);
    assert.equal(p.page.value, 3);
    assert.deepEqual(p.pageItems.value, [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
    p.goTo(99);
    assert.equal(p.page.value, 4);
    p.goTo(0);
    assert.equal(p.page.value, 1);
  });
});

describe('Badge trạng thái: nhãn ngắn, màu khác nhau trong cùng cột', () => {
  const distinctTones = (specs) => new Set(specs.map((b) => b.tone)).size === specs.length;

  it('trạng thái Task không kèm "hoàn credit" và mỗi trạng thái một màu', () => {
    const specs = ['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'].map((status) =>
      getTaskStatusBadge({ status, queuePosition: null }),
    );
    assert.ok(distinctTones(specs));
    for (const b of specs) {
      assert.doesNotMatch(b.label, /credit/i);
      assert.ok(b.label.length <= 12, b.label);
    }
    assert.equal(getTaskStatusBadge({ status: 'queued', queuePosition: 3 }).label, 'Đang chờ #3');
  });

  it('trạng thái đơn nạp và gói nạp mỗi giá trị một màu', () => {
    const statuses = ['awaiting_transfer', 'pending', 'approved', 'rejected', 'needs_review', 'expired'];
    assert.ok(distinctTones(statuses.map(getTopupStatusBadge)));
    assert.ok(distinctTones(['starter', 'pro', 'creator'].map(getTopupPackBadge)));
    for (const tone of Object.keys(BADGE_TONE_CLASS)) {
      assert.match(BADGE_TONE_CLASS[tone], /^border-\S+ bg-\S+ text-\S+$/);
    }
  });
});
