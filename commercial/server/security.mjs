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
export function childInput(body) {
  object(body, ['nickname', 'icon', 'pin']);
  const nickname = text(body.nickname, 1, 24).normalize('NFC').trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,23}$/u.test(nickname) || !ICONS.includes(body.icon)) fail(400, 'INVALID_PROFILE');
  return { nickname, icon: body.icon, pin: pin(body.pin) };
}
export function publicChild(c) {
  return { id: c.id, nickname: c.nickname, icon: c.icon, status: c.status };
}

// A pepper is kept in Secret Manager, never in Firestore or a client bundle.
// Fixed parameters prevent a modified hash from requesting arbitrary CPU/memory.
const derive = promisify(scrypt);
export function pinHasher(pepper) {
  let busy = false;
  async function key(familyId, childId, code, salt) {
    if (busy) fail(503, 'PIN_SERVICE_BUSY');
    busy = true;
    try {
      return await derive(mac(pepper, `${familyId}:${childId}:${code}`), salt, 32,
        { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
    } finally { busy = false; }
  }
  return {
    async hash(familyId, childId, code) {
      const salt = randomBytes(16).toString('hex');
      const value = await key(familyId, childId, pin(code), salt);
      return `scrypt-v1:${salt}:${value.toString('hex')}`;
    },
    async verify(familyId, childId, code, stored) {
      pin(code);
      if (typeof stored !== 'string' || !/^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored)) return false;
      const [, salt, expected] = stored.split(':');
      return equal((await key(familyId, childId, code, salt)).toString('hex'), expected);
    },
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
