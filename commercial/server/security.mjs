import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export class Fault extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new Fault(status, code); };
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const mac = (secret, text) => createHmac('sha256', secret).update(text).digest('base64url');
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function object(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some((k) => !keys.includes(k))) fail(400, 'INVALID_REQUEST');
  return value;
}
export function text(value, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max) fail(400, 'INVALID_REQUEST');
  return value;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail(400, 'INVALID_ID');
  return value;
}
export function pin(value) {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) fail(400, 'PIN_MUST_BE_SIX_DIGITS');
  return value;
}
export const ICONS = Object.freeze(['fox', 'panda', 'tiger', 'wolf', 'robot', 'rocket']);
export const START_OPTIONS = Object.freeze(['test', 'year', 'a1']); // placement test (recommended), start at the year's sector, start from A1
export const YEAR_LEVELS = Object.freeze([1, 2, 3, 4, 5, 6]); // primary years; Sector A = Year 1 … Sector F = Year 6
export function startInput(body) {
  const age = body.age === undefined || body.age === null ? null : body.age;
  if (age !== null && (!Number.isInteger(age) || age < 3 || age > 17)) fail(400, 'INVALID_PROFILE');
  const yearLevel = body.yearLevel === undefined || body.yearLevel === null ? null : body.yearLevel;
  if (yearLevel !== null && !YEAR_LEVELS.includes(yearLevel)) fail(400, 'INVALID_PROFILE');
  const start = body.start === undefined || body.start === null ? (yearLevel ? 'test' : 'a1') : body.start;
  if (!START_OPTIONS.includes(start) || (start !== 'a1' && yearLevel === null)) fail(400, 'INVALID_START'); // a test or a year start needs the year
  return { age, yearLevel, start };
}
export function childInput(body) {
  object(body, ['nickname', 'icon', 'pin', 'age', 'yearLevel', 'start']);
  const nickname = text(body.nickname, 1, 24).normalize('NFC').trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,23}$/u.test(nickname) || !ICONS.includes(body.icon)) fail(400, 'INVALID_PROFILE');
  return { nickname, icon: body.icon, pin: pin(body.pin), ...startInput(body) };
}
export function publicChild(c) {
  return { id: c.id, nickname: c.nickname, icon: c.icon, status: c.status, yearLevel: c.demographics?.yearLevel ?? null, start: c.start?.option || null };
}

// A pepper is kept in Secret Manager, never in Firestore or a client bundle.
// Fixed parameters prevent a modified hash from requesting arbitrary CPU/memory.
const derive = promisify(scrypt);
// Each pepper is named by the first 8 hex of its SHA-256, and that name is written into every
// hash (`scrypt-v2:<kid>:<salt>:<hash>`), so a pepper can be rotated: the new one hashes, the
// retired ones still verify, and a PIN is silently re-hashed the next time it is entered.
// The unnamed pre-rotation format `scrypt-v1:<salt>:<hash>` is tried against every known pepper.
export const pepperId = (pepper) => sha256(pepper).slice(0, 8);
export function pinHasher(pepper, previous = []) {
  let busy = false;
  const current = pepperId(pepper);
  const peppers = new Map([[current, pepper], ...previous.map((p) => [pepperId(p), p])]);
  async function key(secret, familyId, childId, code, salt) {
    if (busy) fail(503, 'PIN_SERVICE_BUSY');
    busy = true;
    try {
      return await derive(mac(secret, `${familyId}:${childId}:${code}`), salt, 32,
        { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
    } finally { busy = false; }
  }
  function parse(stored) {
    if (typeof stored !== 'string') return null;
    let m = stored.match(/^scrypt-v2:([a-f0-9]{8}):([a-f0-9]{32}):([a-f0-9]{64})$/);
    if (m) return peppers.has(m[1]) ? { kids: [m[1]], salt: m[2], expected: m[3], stale: m[1] !== current } : null;
    m = stored.match(/^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/);
    return m ? { kids: [...peppers.keys()], salt: m[1], expected: m[2], stale: true } : null;
  }
  return {
    async hash(familyId, childId, code) {
      const salt = randomBytes(16).toString('hex');
      const value = await key(pepper, familyId, childId, pin(code), salt);
      return `scrypt-v2:${current}:${salt}:${value.toString('hex')}`;
    },
    async verify(familyId, childId, code, stored) {
      pin(code);
      const p = parse(stored);
      if (!p) return false;
      for (const kid of p.kids) {
        if (equal((await key(peppers.get(kid), familyId, childId, code, p.salt)).toString('hex'), p.expected)) return true;
      }
      return false;
    },
    // true when the stored hash was made under a retired pepper or the unnamed legacy format
    needsRehash(stored) { const p = parse(stored); return !!p && p.stale; },
  };
}

// Login-CSRF protection without allocating database rows for anonymous visitors.
export function preauth(secret, now) {
  const value = `pre.${randomToken()}.${now + 10 * 60_000}`;
  return `${value}.${mac(secret, value)}`;
}
export function preauthCsrf(secret, cookie, now) {
  if (typeof cookie !== 'string' || !/^pre\.[A-Za-z0-9_-]{43}\.\d{13}\.[A-Za-z0-9_-]{43}$/.test(cookie)) return null;
  const parts = cookie.split('.');
  if (Number(parts[2]) <= now || Number(parts[2]) > now + 10 * 60_000 ||
      !equal(parts[3], mac(secret, parts.slice(0, 3).join('.')))) return null;
  return mac(secret, `csrf:${cookie}`);
}
