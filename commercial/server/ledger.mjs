// The per-child ledger: the financial source of truth for Grid Coins and Reward Points.
//
// Every change to a balance is exactly one immutable row under
//   families/{familyId}/learning/{childId}/ledger/{id}
// with a sequence number, a link to the previous row and the balance after it. The wallet's
// cached `gc` / `rp` are derived state: `post()` is the only way they change, and `derive()`
// recomputes them from the rows so a reconciler can prove the cache is honest (or repair it).
//
// Three invariants the primitive itself enforces (audit findings 3.1-A/B/C):
//   - a non-zero balance with no rows is refused until an opening row exists (`bootstrap()`);
//   - a row id is never overwritten: same id + same content is LEDGER_REPLAYED, same id +
//     different content is LEDGER_CONFLICT. The row is the durable receipt (review S3-F1): a
//     caller that reaches the same row again — after its own 24-hour operation receipt has
//     expired — is refused, so the non-currency side effects it built up are never committed
//     a second time without the charge;
//   - an opening row is legal only as sequence 1, and bootstrap stops when rows exist that
//     the wallet's metadata does not know about;
//   - repair happens inside one transaction over the wallet and its rows, and stops on a
//     structurally damaged ledger.
import { fail } from './security.mjs';

// Olympia (19 Sep 2026) put a third currency on the same rows: Olyminerals (`om`), paid in by a medal and taken out by the
// Olympia shop. A row carries `om`, and a balance carries `om`, only from the first row that moves any: every row written before
// the moons opened reads unchanged, and derive() takes a missing `om` as nought.
const TYPES = new Set(['ledger.opening', 'migrate.opening', 'learn.session', 'learn.checkpoint', 'learn.scan', 'streak.shield', 'shop.buy', 'reward.request', 'reward.refund', 'rocket.fuel', 'parent.adjust', 'olympia.medal', 'olympia.buy']);
const OPENING = new Set(['ledger.opening', 'migrate.opening']);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const int = (v) => Number.isSafeInteger(v) && Math.abs(v) <= 10_000_000;
export const OPENING_ROW_ID = 'ledger-opening';

/** Validate a row before it is posted. Amounts are signed deltas; at least one must be non-zero except for an opening row. */
export function entry({ id, type, gc = 0, rp = 0, om = 0, ref = null, note = null, at }) {
  if (typeof id !== 'string' || !ID.test(id) || !TYPES.has(type) || !int(gc) || !int(rp) || !int(om) || !Number.isSafeInteger(at)) fail(400, 'LEDGER_ENTRY_INVALID');
  if (gc === 0 && rp === 0 && om === 0 && !OPENING.has(type)) fail(400, 'LEDGER_ENTRY_EMPTY');
  if (ref !== null && (typeof ref !== 'string' || ref.length > 120)) fail(400, 'LEDGER_ENTRY_INVALID');
  if (note !== null && (typeof note !== 'string' || note.length > 200)) fail(400, 'LEDGER_ENTRY_INVALID');
  return { id, type, gc, rp, ...(om ? { om } : {}), ref, note, at };
}
const sameContent = (row, e) => ['type', 'gc', 'rp', 'ref', 'note'].every((k) => (row[k] ?? null) === (e[k] ?? null)) && (row.om || 0) === (e.om || 0);

/**
 * Post one row inside the caller's transaction and return the progress document with the
 * cached balance advanced. Reads the row's slot first, so call it after the caller's own reads
 * and before its writes. Refuses to take a balance below zero; refuses a non-zero wallet that
 * has no rows yet; never overwrites an existing row.
 */
export async function post(tx, base, prog, e) {
  const w = prog.wallet || {};
  const seq0 = w.ledgerSeq || 0;
  if (seq0 === 0 && ((w.gc || 0) !== 0 || (w.rp || 0) !== 0) && !OPENING.has(e.type)) fail(409, 'LEDGER_NOT_BOOTSTRAPPED');
  if (OPENING.has(e.type) && seq0 !== 0) fail(409, 'LEDGER_OPENING_NOT_FIRST');
  const path = `${base}/ledger/${e.id}`;
  const existing = await tx.get(path);
  if (existing) {
    // The earlier transaction committed this row and everything that came with it. Refusing here
    // makes economic idempotency as durable as the ledger itself, whatever shorter receipt the
    // caller checked first (S3-F1).
    if (sameContent(existing, e)) fail(409, 'LEDGER_REPLAYED');
    fail(409, 'LEDGER_CONFLICT');
  }
  const gc = (w.gc || 0) + e.gc, rp = (w.rp || 0) + e.rp, om = (w.om || 0) + (e.om || 0);
  if (gc < 0) fail(409, 'INSUFFICIENT_GRID_COINS');
  if (rp < 0) fail(409, 'INSUFFICIENT_REWARD_POINTS');
  if (om < 0) fail(409, 'INSUFFICIENT_OLYMINERALS');
  const seq = seq0 + 1;
  const minerals = om || e.om || (w.om || 0) ? { om } : {}; // the balance names Olyminerals once any have moved, and from then on
  tx.set(path, { ...e, seq, prev: w.ledgerLast || null, balance: { gc, rp, ...minerals } });
  return { ...prog, wallet: { ...w, gc, rp, om, ledgerSeq: seq, ledgerLast: e.id } };
}

/** Give a pre-ledger wallet its opening row once. Idempotent: a wallet with rows, or with nothing to carry, is untouched. Rows the wallet does not know about stop it (LEDGER_DAMAGED). */
export async function bootstrap(tx, base, prog, now) {
  const w = prog.wallet || {};
  if ((w.ledgerSeq || 0) > 0) return { prog, opened: false };
  if ((await tx.list(`${base}/ledger`)).length) fail(409, 'LEDGER_DAMAGED'); // metadata says no rows, rows exist: a human looks, nothing is opened
  if ((w.gc || 0) === 0 && (w.rp || 0) === 0) return { prog, opened: false };
  const next = await post(tx, base, { ...prog, wallet: { ...w, gc: 0, rp: 0, ledgerSeq: 0, ledgerLast: null } },
    entry({ id: OPENING_ROW_ID, type: 'ledger.opening', gc: w.gc || 0, rp: w.rp || 0, note: 'balance carried from before the ledger', at: now }));
  return { prog: next, opened: true };
}

/** Recompute the balance from rows and check the chain: contiguous sequence, linked ids, honest running balances. */
export function derive(rows) {
  const sorted = [...rows].filter((r) => r && Number.isSafeInteger(r.seq)).sort((a, b) => a.seq - b.seq);
  const problems = [];
  let gc = 0, rp = 0, om = 0, prev = null;
  sorted.forEach((r, i) => {
    if (r.seq !== i + 1) problems.push(`seq gap: expected ${i + 1}, found ${r.seq} (${r.id})`);
    if ((r.prev || null) !== prev) problems.push(`chain break at ${r.id}: prev ${r.prev} ≠ ${prev}`);
    if (!int(r.gc) || !int(r.rp) || (r.om !== undefined && !int(r.om))) problems.push(`bad amounts on ${r.id}`);
    gc += r.gc || 0; rp += r.rp || 0; om += r.om || 0;
    if (!r.balance || r.balance.gc !== gc || r.balance.rp !== rp || (r.balance.om || 0) !== om) problems.push(`running balance on ${r.id}: stored ${r.balance?.gc}/${r.balance?.rp}/${r.balance?.om || 0}, derived ${gc}/${rp}/${om}`);
    prev = r.id;
  });
  if (rows.length !== sorted.length) problems.push(`${rows.length - sorted.length} rows without a sequence number`);
  return { gc, rp, om, count: sorted.length, last: prev, problems };
}

/** Compare the derived balance with the wallet's cache. */
export function reconcile(rows, wallet) {
  const d = derive(rows);
  const problems = [...d.problems];
  if (d.gc !== (wallet.gc || 0)) problems.push(`gc: ledger ${d.gc}, wallet ${wallet.gc || 0}`);
  if (d.rp !== (wallet.rp || 0)) problems.push(`rp: ledger ${d.rp}, wallet ${wallet.rp || 0}`);
  if (d.om !== (wallet.om || 0)) problems.push(`om: ledger ${d.om}, wallet ${wallet.om || 0}`);
  if (d.count !== (wallet.ledgerSeq || 0)) problems.push(`rows: ledger ${d.count}, wallet.ledgerSeq ${wallet.ledgerSeq || 0}`);
  if ((d.last || null) !== (wallet.ledgerLast || null)) problems.push(`last: ledger ${d.last}, wallet.ledgerLast ${wallet.ledgerLast}`);
  return { derived: { gc: d.gc, rp: d.rp, om: d.om, count: d.count, last: d.last }, cached: { gc: wallet.gc || 0, rp: wallet.rp || 0, om: wallet.om || 0, ledgerSeq: wallet.ledgerSeq || 0, ledgerLast: wallet.ledgerLast || null }, match: problems.length === 0, damaged: d.problems.length > 0, problems };
}

/**
 * Repair the cache from the ledger inside ONE transaction: the wallet and every row are read
 * under the transaction, so a concurrent post() (which always touches the wallet document)
 * makes this retry or fail rather than overwrite. A structurally damaged ledger is never
 * "repaired" — it stops for a human.
 */
export async function repair(tx, base) {
  const prog = await tx.get(base);
  if (!prog) fail(404, 'CHILD_NOT_FOUND');
  const rows = await tx.list(`${base}/ledger`);
  const r = reconcile(rows, prog.wallet || {});
  if (r.match) return { repaired: false, ...r };
  if (r.damaged) fail(409, 'LEDGER_DAMAGED');
  tx.set(base, { ...prog, wallet: { ...(prog.wallet || {}), gc: r.derived.gc, rp: r.derived.rp, om: r.derived.om, ledgerSeq: r.derived.count, ledgerLast: r.derived.last } });
  return { repaired: true, ...r };
}
