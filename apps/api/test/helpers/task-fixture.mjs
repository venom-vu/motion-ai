const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNAPSHOT = JSON.stringify({ tier: 'free', priority: 10, maxVideoSeconds: 5 });

/** INSERT một dòng tasks (SQL thô, chỉ dùng trong test) để thỏa FK ledger_entries.task_id; status succeeded để không làm nhiễu hàng đợi/giới hạn Task của test khác chạy song song. */
export async function insertTaskRow(db, userId, taskId, holdAmount = 100) {
  await db.$executeRaw`INSERT INTO tasks (id, user_id, pipeline, status, tier_snapshot, consent, tos_version, input_keys, params, hold_amount, result_key, updated_at)
    VALUES (${taskId}::uuid, ${userId}::uuid, 'face_swap', 'succeeded', ${SNAPSHOT}::jsonb, true, 'test', '{}'::jsonb, '{}'::jsonb, ${holdAmount}, ${'out/' + userId + '/' + taskId}, now())
    ON CONFLICT (id) DO NOTHING`;
}

/** INSERT một dòng topups (SQL thô, chỉ dùng trong test) để thỏa FK ledger_entries.topup_id; status approved vì ví chỉ ghi nhận sau khi duyệt. */
export async function insertTopupRow(db, userId, topupId, amountVnd = 1000, pack = 'pro') {
  const code = topupId.replace(/-/g, '').slice(0, 12).toUpperCase();
  await db.$executeRaw`INSERT INTO topups (id, user_id, code, pack, amount_vnd, status, qr_expires_at, bank_ref, tos_version, updated_at)
    VALUES (${topupId}::uuid, ${userId}::uuid, ${code}, ${pack}, ${amountVnd}, 'approved', now(), ${'ref-' + topupId}, 'test', now())
    ON CONFLICT (id) DO NOTHING`;
}

/** Bọc wallet.hold: khóa user rồi tạo dòng tasks trước khi HOLD (tránh deadlock KEY SHARE/FOR UPDATE). */
export function withTaskRows(wallet) {
  const origHold = wallet.hold.bind(wallet);
  wallet.hold = async (tx, userId, taskId, amount) => {
    if (
      tx && typeof tx.$queryRaw === 'function' &&
      typeof userId === 'string' && UUID_RE.test(userId) &&
      typeof taskId === 'string' && UUID_RE.test(taskId)
    ) {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      await insertTaskRow(tx, userId, taskId, Number.isSafeInteger(amount) && amount > 0 ? amount : 1);
    }
    return origHold(tx, userId, taskId, amount);
  };
  const origTopup = wallet.topup.bind(wallet);
  wallet.topup = async (tx, userId, topupId, amount, pack) => {
    if (
      tx && typeof tx.$queryRaw === 'function' &&
      typeof userId === 'string' && UUID_RE.test(userId) &&
      typeof topupId === 'string' && UUID_RE.test(topupId) &&
      ['starter', 'pro', 'creator'].includes(pack)
    ) {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      await insertTopupRow(tx, userId, topupId, 1000, pack);
    }
    return origTopup(tx, userId, topupId, amount, pack);
  };
  return wallet;
}
