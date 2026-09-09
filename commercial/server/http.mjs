import { VERSION } from './version.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Fault, fail, equal, object, preauth, preauthCsrf, sha256 } from './security.mjs';

// Firebase Hosting forwards only the specially named __session cookie to Cloud Run.
const COOKIE = '__session';
const FILES = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
  '/auth.js': ['auth.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
const PARENT_COOKIE_S = 30 * 60, DEVICE_COOKIE_S = 12 * 3600; // match the server-side session lifetimes
const cookieToken = (req) => {
  const matches = (req.headers.cookie || '').split(';').map((v) => v.trim()).filter((v) => v.startsWith(`${COOKIE}=`));
  return matches.length === 1 ? matches[0].slice(COOKIE.length + 1) : null;
};
// The client address for throttling. Each of the `hops` trusted proxies appended the address it
// accepted the connection from, so the last `hops` entries are trustworthy and the earliest of
// them is the client; anything before that was supplied by the client and is ignored. With
// hops = 0 the socket address is used, which behind a proxy is the proxy itself — config
// refuses that outside the emulator.
const clientAddress = (req, hops) => {
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean);
  const ip = hops > 0 && chain.length >= hops ? chain[chain.length - hops] : req.socket.remoteAddress;
  return /^[A-Za-z0-9.:]{1,64}$/.test(ip || '') ? ip : 'unknown';
};
async function body(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') fail(415, 'JSON_REQUIRED');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(415, 'ENCODING_UNSUPPORTED');
  let total = 0; const parts = [];
  for await (const chunk of req) { total += chunk.length; if (total > 16_384) fail(413, 'REQUEST_TOO_LARGE'); parts.push(chunk); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail(400, 'INVALID_JSON'); }
}
export function createApp(service, cfg, { publicDir = new URL('../public/', import.meta.url), reportError = () => {}, learning = null, game = null, billing = null } = {}) {
  function setCookie(res, value, maxAge) {
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${cfg.emulator ? '' : '; Secure'}`);
  }
  // Per-process request throttle per session, so one busy cookie cannot spend the identity
  // recheck budget for everyone. Instances do not share it; it is a cap per instance.
  const hits = new Map();
  function throttle(key, maximum, windowMs) {
    const now = service.now(), h = hits.get(key);
    const next = h && h.until > now ? h : { count: 0, until: now + windowMs };
    if (next.count >= maximum) fail(429, 'TOO_MANY_ATTEMPTS');
    next.count++; hits.set(key, next);
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
  }
  const server = createServer(async (req, res) => {
    const json = (status, value) => {
      res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value));
    };
    try {
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      if (!cfg.emulator) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      res.setHeader('Content-Security-Policy', [
        "default-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'", "object-src 'none'",
        // Path-scoped sources: a bare https://www.google.com would admit its JSONP endpoints as script.
        "script-src 'self' https://www.gstatic.com/firebasejs/ https://www.gstatic.com/recaptcha/ https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/",
        "style-src 'self'", "img-src 'self' data: https://www.gstatic.com/recaptcha/",
        `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://www.google.com/recaptcha/${cfg.emulator ? ' http://127.0.0.1:9099' : ''}`,
        `frame-src https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/ https://${cfg.web.authDomain}/__/auth/`,
      ].join('; '));
      const path = new URL(req.url, cfg.origin).pathname;
      if (req.method === 'GET' && FILES[path]) {
        const [file, type] = FILES[path];
        res.setHeader('Content-Type', `${type}; charset=utf-8`);
        return res.end(await readFile(new URL(file, publicDir)));
      }
      if (req.method === 'GET' && path === '/healthz') return json(200, { status: 'ok', version: VERSION });
      if (!path.startsWith('/api/')) fail(404, 'NOT_FOUND');
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) fail(403, 'ORIGIN_DENIED');
      let token = cookieToken(req);
      const stored = /^[A-Za-z0-9_-]{43}$/.test(token || '') ? await service.store.get(`sessions/${sha256(token)}`) : null;
      if (req.method === 'GET' && path === '/api/config') return json(200, { firebase: cfg.web, emulator: cfg.emulator });
      if (req.method === 'GET' && path === '/api/bootstrap') {
        let csrf;
        if (stored && stored.expiresAt > service.now()) csrf = stored.csrf;
        else {
          csrf = preauthCsrf(cfg.secret, token, service.now());
          if (!csrf) { token = preauth(cfg.secret, service.now()); csrf = preauthCsrf(cfg.secret, token, service.now()); setCookie(res, token, 600); }
        }
        return json(200, { csrf });
      }
      if (req.method !== 'GET' && req.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED');
      let data;
      if (req.method === 'POST') {
        if (req.headers.origin !== cfg.origin) fail(403, 'ORIGIN_DENIED');
        const csrf = stored && stored.expiresAt > service.now() ? stored.csrf : preauthCsrf(cfg.secret, token, service.now());
        if (!csrf || !equal(csrf, req.headers['x-csrf-token'])) fail(403, 'CSRF_DENIED');
        data = await body(req);
      }
      if (req.method === 'POST' && path === '/api/auth/session') {
        object(data, ['idToken']);
        // Failures are counted per client address (see clientAddress); successes cost nothing here
        // and are limited per account inside login(), so a flood of bad tokens from one address —
        // or from everyone behind a mis-measured proxy — cannot lock honest parents out.
        const address = `login-fail:${clientAddress(req, cfg.proxyHops)}`;
        let next;
        try { next = await service.login(data.idToken, token); }
        catch (error) {
          // Address budgets count failed credentials only. A saturated shared IP must not block a
          // subsequently valid signed login (office Wi-Fi / carrier NAT); bad attempts stay 429.
          if (error instanceof Fault && error.status !== 429) {
            try { await service.rate(address, 30, 10 * 60_000); }
            catch (limit) { if (limit instanceof Fault && limit.status === 429) throw limit; }
          }
          throw error;
        }
        setCookie(res, next, PARENT_COOKIE_S); return json(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/auth/logout') {
        object(data, []);
        if (stored) await service.logout({ key: sha256(token), uid: stored.uid });
        setCookie(res, '', 0); return json(200, { ok: true });
      }
      if (stored) throttle(`session:${sha256(token)}`, 120, 60_000);
      const ctx = await service.authenticate(token);
      if (req.method === 'GET' && path === '/api/me') return json(200, await service.me(ctx));
      if (req.method === 'GET' && path === '/api/child/profile') {
        const me = await service.me(ctx);
        if (me.role !== 'child') fail(403, 'CHILD_MODE_REQUIRED');
        return json(200, { child: me.child });
      }
      // Learning + game surfaces. Every service re-reads role/family/child authorization inside
      // its own transaction; routes never accept authoritative family/role fields from the browser.
      if (learning && req.method === 'GET' && path === '/api/learn/state') return json(200, await learning.state(ctx));
      if (game && req.method === 'GET' && path === '/api/game/state') return json(200, await game.state(ctx));
      if (game && req.method === 'GET' && path === '/api/game/parent') return json(200, await game.parentState(ctx));
      // Billing (parent role): plans, the derived subscription state, trial eligibility; trial start and cancel are the only browser-initiated events.
      if (billing && req.method === 'GET' && path === '/api/billing') return json(200, await billing.view(ctx));
      if (req.method !== 'POST') fail(404, 'NOT_FOUND');
      if (learning && path === '/api/learn/session') return json(200, await learning.start(ctx, data));
      if (learning && path === '/api/learn/answer') return json(200, await learning.answer(ctx, data));
      if (learning && path === '/api/learn/quit') return json(200, await learning.quit(ctx, data));
      if (billing && path === '/api/billing/trial') return json(200, await billing.startTrial(ctx, data));
      if (billing && path === '/api/billing/cancel') return json(200, await billing.cancel(ctx, data));
      if (billing && path === '/api/billing/seats') return json(200, await billing.seats(ctx, data));
      if (game && path === '/api/game/shop/buy') return json(200, await game.buy(ctx, data));
      if (game && path === '/api/game/shop/equip') return json(200, await game.equip(ctx, data));
      if (game && path === '/api/game/rewards/redeem') return json(200, await game.redeem(ctx, data));
      if (game && path === '/api/game/rocket/fuel') return json(200, await game.fuel(ctx, data));
      if (game && path === '/api/game/parent/rewards') return json(200, await game.setRewards(ctx, data));
      if (game && path === '/api/game/parent/redemption') return json(200, await game.decideRedemption(ctx, data));
      if (game && path === '/api/game/parent/rocket') return json(200, await game.rocket(ctx, data));
      if (game && path === '/api/game/parent/adjust') return json(200, await game.adjust(ctx, data));
      if (game && path === '/api/game/parent/settings') return json(200, await game.settings(ctx, data));
      if (path === '/api/family') {
        const { token: next, ...result } = await service.createFamily(ctx, data);
        if (next) setCookie(res, next, PARENT_COOKIE_S);
        return json(200, result);
      }
      if (path === '/api/children') return json(201, await service.createChild(ctx, data, req.headers['idempotency-key']));
      if (path === '/api/session/lock') { object(data, []); const next = await service.lock(ctx); setCookie(res, next, DEVICE_COOKIE_S); return json(200, { ok: true }); }
      if (path === '/api/session/select') { object(data, []); const next = await service.selector(ctx); setCookie(res, next, DEVICE_COOKIE_S); return json(200, { ok: true }); }
      const match = path.match(/^\/api\/children\/([a-f0-9-]+)\/(enter|pin)$/);
      if (match) {
        object(data, ['pin']);
        if (match[2] === 'enter') { const next = await service.selectChild(ctx, match[1], data.pin); setCookie(res, next, DEVICE_COOKIE_S); }
        else await service.resetPin(ctx, match[1], data.pin);
        return json(200, { ok: true });
      }
      fail(404, 'NOT_FOUND');
    } catch (error) {
      if (!(error instanceof Fault)) reportError({ event: 'request_failed', code: 'INTERNAL_ERROR' });
      // No request bodies, cookies, credentials, PINs, SDK messages or stacks in logs/responses.
      if (!res.headersSent) json(error instanceof Fault ? error.status : 500, { error: error instanceof Fault ? error.code : 'INTERNAL_ERROR' });
      else res.end();
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000;
  return server;
}
