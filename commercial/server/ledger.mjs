// The per-child ledger: the financial source of truth for Grid Coins and Reward Points.
//
// Every change to a balance is exactly one immutable row under
//   families/{familyId}/learning/{childId}/ledger/{id}
// with a sequence number, a link to the previous row and the balance after it. The wallet's
// cached `gc` / `rp` are derived state: `post()` is the only way they change, and `derive()`
// recomputes them from the rows so a reconciler can prove the cache is honest (or repair it).
// Rows are never edited or deleted; a mistake is corrected by another row.
import { fail } from './security.mjs';

const TYPES = new Set(['learn.session', 'learn.checkpoint', 'learn.scan', 'streak.shield', 'shop.buy', 'reward.request', 'reward.refund', 'rocket.fuel', 'parent.adjust', 'migrate.opening', 'reconcile.repair']);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const int = (v) => Number.isSafeInteger(v) && Math.abs(v) <= 10_000_000;

/** Validate a row before it is posted. Amounts are signed deltas; at least one must be non-zero except for an opening row. */
export function entry({ id, type, gc = 0, rp = 0, ref = null, note = null, at }) {
  if (typeof id !== 'string' || !ID.test(id) || !TYPES.has(type) || !int(gc) || !int(rp) || !Number.isSafeInteger(at)) fail(400, 'LEDGER_ENTRY_INVALID');
  if (gc === 0 && rp === 0 && type !== 'migrate.opening') fail(400, 'LEDGER_ENTRY_EMPTY');
  if (ref !== null && (typeof ref !== 'string' || ref.length > 120)) fail(400, 'LEDGER_ENTRY_INVALID');
  if (note !== null && (typeof note !== 'string' || note.length > 200)) fail(400, 'LEDGER_ENTRY_INVALID');
  return { id, type, gc, rp, ref, note, at };
}

/**
 * Post one row inside the caller's transaction and return the progress document with the
 * cached balance advanced. Call it after every read in the transaction (it only writes).
 * Refuses to take a balance below zero; the caller decides which error code to surface first.
 */
export function post(tx, base, prog, e) {
  const w = prog.wallet;
  const gc = (w.gc || 0) + e.gc, rp = (w.rp || 0) + e.rp;
  if (gc < 0) fail(409, 'INSUFFICIENT_GRID_COINS');
  if (rp < 0) fail(409, 'INSUFFICIENT_REWARD_POINTS');
  const seq = (w.ledgerSeq || 0) + 1;
  tx.set(`${base}/ledger/${e.id}`, { ...e, seq, prev: w.ledgerLast || null, balance: { gc, rp } });
  return { ...prog, wallet: { ...w, gc, rp, ledgerSeq: seq, ledgerLast: e.id } };
}

/** Recompute the balance from rows and check the chain: contiguous sequence, linked ids, honest running balances. */
export function derive(rows) {
  const sorted = [...rows].filter((r) => r && Number.isSafeInteger(r.seq)).sort((a, b) => a.seq - b.seq);
  const problems = [];
  let gc = 0, rp = 0, prev = null;
  sorted.forEach((r, i) => {
    if (r.seq !== i + 1) problems.push(`seq gap: expected ${i + 1}, found ${r.seq} (${r.id})`);
    if ((r.prev || null) !== prev) problems.push(`chain break at ${r.id}: prev ${r.prev} ≠ ${prev}`);
    if (!int(r.gc) || !int(r.rp)) problems.push(`bad amounts on ${r.id}`);
    gc += r.gc || 0; rp += r.rp || 0;
    if (!r.balance || r.balance.gc !== gc || r.balance.rp !== rp) problems.push(`running balance on ${r.id}: stored ${r.balance?.gc}/${r.balance?.rp}, derived ${gc}/${rp}`);
    prev = r.id;
  });
  if (rows.length !== sorted.length) problems.push(`${rows.length - sorted.length} rows without a sequence number`);
  return { gc, rp, count: sorted.length, last: prev, problems };
}

/** Compare the derived balance with the wallet's cache. */
export function reconcile(rows, wallet) {
  const d = derive(rows);
  const problems = [...d.problems];
  if (d.gc !== (wallet.gc || 0)) problems.push(`gc: ledger ${d.gc}, wallet ${wallet.gc || 0}`);
  if (d.rp !== (wallet.rp || 0)) problems.push(`rp: ledger ${d.rp}, wallet ${wallet.rp || 0}`);
  if (d.count !== (wallet.ledgerSeq || 0)) problems.push(`rows: ledger ${d.count}, wallet.ledgerSeq ${wallet.ledgerSeq || 0}`);
  if ((d.last || null) !== (wallet.ledgerLast || null)) problems.push(`last: ledger ${d.last}, wallet.ledgerLast ${wallet.ledgerLast}`);
  return { derived: { gc: d.gc, rp: d.rp, count: d.count, last: d.last }, cached: { gc: wallet.gc || 0, rp: wallet.rp || 0, ledgerSeq: wallet.ledgerSeq || 0, ledgerLast: wallet.ledgerLast || null }, match: problems.length === 0, problems };
}
