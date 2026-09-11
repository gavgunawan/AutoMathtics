import { VERSION } from './version.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Fault, fail, equal, object, preauth, preauthCsrf, sha256 } from './security.mjs';
import { WEBHOOK_BODY_LIMIT } from './payments.mjs';
import { REMEMBER_MS } from './service.mjs';

// Firebase Hosting forwards only the specially named __session cookie to Cloud Run.
const COOKIE = '__session';
const FILES = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
  '/auth.js': ['auth.js', 'text/javascript'], '/sms-schedule.js': ['sms-schedule.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'],
  // the game's own faces, served from this origin (public/fonts, SIL Open Font License): no third-party request at sign-in
  ...Object.fromEntries(['Orbitron-700', 'Rajdhani-500', 'Rajdhani-600', 'Rajdhani-700', 'JetBrainsMono-600'].map((f) => [`/fonts/${f}.woff2`, [`fonts/${f}.woff2`, 'font/woff2']])) };
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
// The last entry was appended by the Google frontend that accepted the connection and cannot be forged by the caller: through
// Hosting it is Hosting's egress (shared by everyone); straight at the run.app hostname — reachable, since Hosting's rewrites
// need the service public — it is the caller itself. With the hop count measured through Hosting, a direct caller who forges
// one entry would otherwise choose its own client address; so every address budget is spent twice, on the client's key (fine)
// and on the peer's (coarse, peerFactor times wider), and the forger runs into the peer's wall (Stage 4 review, third round).
const peerAddress = (req) => {
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean);
  const ip = chain.length ? chain[chain.length - 1] : req.socket.remoteAddress;
  return /^[A-Za-z0-9.:]{1,64}$/.test(ip || '') ? ip : 'unknown';
};
async function rawBody(req, limit) {
  if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') fail(415, 'JSON_REQUIRED');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(415, 'ENCODING_UNSUPPORTED');
  let total = 0; const parts = [];
  for await (const chunk of req) { total += chunk.length; if (total > limit) fail(413, 'REQUEST_TOO_LARGE'); parts.push(chunk); }
  return Buffer.concat(parts);
}
async function body(req) {
  const raw = await rawBody(req, 16_384);
  try { return JSON.parse(raw.toString('utf8')); } catch { fail(400, 'INVALID_JSON'); }
}
// RFC 8058 one-click unsubscribe: the mailbox provider POSTs the one field List-Unsubscribe=One-Click, as multipart/form-data
// (which the RFC prefers) or form-encoded. True when the body says exactly that.
async function oneClick(req) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded' && type !== 'multipart/form-data') fail(415, 'FORM_REQUIRED');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(415, 'ENCODING_UNSUPPORTED');
  let total = 0; const parts = [];
  for await (const chunk of req) { total += chunk.length; if (total > 4096) fail(413, 'REQUEST_TOO_LARGE'); parts.push(chunk); }
  const text = Buffer.concat(parts).toString('utf8');
  return type === 'multipart/form-data' ? /name="List-Unsubscribe"\r?\n(?:[^\r\n]+\r?\n)*\r?\nOne-Click\r?\n/i.test(text) : new URLSearchParams(text).get('List-Unsubscribe') === 'One-Click';
}
export function createApp(service, cfg, { publicDir = new URL('../public/', import.meta.url), reportError = () => {}, learning = null, game = null, billing = null, payments = null, support = null, recovery = null, email = null, feedback = null, peerFactor = 20 } = {}) {
  // A session cookie lives exactly as long as the session row it names (F12), read back from the row the service has just
  // written: 30 minutes for a parent, 12 hours on the launch pad, or what is left of 30 days on a remembered device. The
  // rotation has already committed, so a failed read never fails the request (review of PR #44): the cookie then gets the
  // longest life any session can have, and the row's own expiry still ends the session on time.
  async function sessionCookie(res, token) {
    let row = null;
    try { row = await service.store.get(`sessions/${sha256(token)}`); } catch { /* committed already: sized by the ceiling */ }
    const left = row ? Math.ceil((row.expiresAt - service.now()) / 1000) : 0;
    setCookie(res, token, left > 0 ? left : Math.ceil(REMEMBER_MS / 1000));
  }
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
  // an address budget is spent on the client's key and on the peer's (peerAddress); one key when they coincide
  const budgets = (name, req) => { const client = clientAddress(req, cfg.proxyHops), peer = peerAddress(req); return client === peer ? [[`${name}:${client}`, 1]] : [[`${name}:${client}`, 1], [`${name}:peer:${peer}`, peerFactor]]; };
  const spend = async (name, req, maximum, windowMs) => { for (const [bucket, factor] of budgets(name, req)) await service.rate(bucket, maximum * factor, windowMs); };
  // A failed token check (the sign-up consent, an email button) spends the failure budgets: per instance in memory, per address and
  // per peer in the store; a spent budget turns the failure into 429. A validly signed token never reads them, so junk from anywhere
  // cannot lock a parent out of recording a consent or using a real button.
  const failedCheck = async (name, req) => { throttle(`${name}-fail:all`, 200, 60 * 60_000); await spend(`${name}-fail`, req, 20, 60 * 60_000); };
  // One sign-up token or one email link is good for `maximum` uses an hour: looked at before the work, counted after it (throttle
  // with no ceiling) only when the token passed its check, so junk never adds a key and the map stays the size of real use.
  const reused = (key, maximum) => { const h = hits.get(key); if (h && h.until > service.now() && h.count >= maximum) fail(429, 'TOO_MANY_ATTEMPTS'); };
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
        "style-src 'self'", "font-src 'self'", "img-src 'self' data: https://www.gstatic.com/recaptcha/",
        `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://www.google.com/recaptcha/${cfg.emulator ? ' http://127.0.0.1:9099' : ''}`,
        `frame-src https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/ https://${cfg.web.authDomain}/__/auth/`,
      ].join('; '));
      const path = new URL(req.url, cfg.origin).pathname;
      if (req.method === 'GET' && FILES[path]) {
        const [file, type] = FILES[path];
        if (type === 'font/woff2') { res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } // a font never changes under its name
        else res.setHeader('Content-Type', `${type}; charset=utf-8`);
        return res.end(await readFile(new URL(file, publicDir)));
      }
      if (req.method === 'GET' && path === '/api/health') { // not /healthz: the Cloud Run frontend swallows that path
        // `forwarded` counts the X-Forwarded-For entries the server saw, and `leading` echoes the first one only when it is an
        // RFC 5737 documentation address (never a real client), so TRUSTED_PROXY_HOPS can be measured on the live origin
        // with one curl and no code change (DEPLOY_V3.md §5).
        const entries = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',').map((s) => s.trim()) : [];
        // `release`: the commit the running revision was deployed from (RELEASE_SHA), so which code staging runs is readable, not remembered
        return json(200, { status: 'ok', version: VERSION, release: cfg.releaseSha || null, ...(entries.length ? { forwarded: entries.length, ...(/^203\.0\.113\.\d{1,3}$/.test(entries[0]) ? { leading: entries[0] } : {}) } : {}) });
      }
      if (!path.startsWith('/api/')) fail(404, 'NOT_FOUND');
      // Provider webhooks (Stage 3.3). A payment server sends no cookie, CSRF token or Origin: the
      // signature over the raw bytes is the whole authentication, checked inside payments.receive().
      // Signature failures are budgeted per client address, like bad logins.
      const hook = path.match(/^\/api\/webhooks\/([^/]{1,32})$/);
      if (hook) {
        if (!payments) fail(404, 'NOT_FOUND');
        if (req.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED');
        const raw = await rawBody(req, WEBHOOK_BODY_LIMIT);
        try { return json(200, await payments.receive(hook[1], raw, req.headers)); }
        catch (error) {
          if (error instanceof Fault && error.status === 401) {
            try { await spend('webhook-fail', req, 60, 10 * 60_000); }
            catch (limit) { if (limit instanceof Fault && limit.status === 429) throw limit; }
          }
          throw error;
        }
      }
      // email-v1 unsubscribe. A GET is a person clicking the List-Unsubscribe link, or a scanner: nothing changes, the app opens
      // on the same token, in the fragment (which no server and no request log sees), and asks. A POST is the mailbox provider's
      // RFC 8058 one-click, cross-site with no cookie, Origin or CSRF token, so it sits here before those checks, like the webhooks:
      // the signed token is its whole authentication, it can only switch the weekly report off, and a failed token is budgeted per
      // address. RFC 8058 needs the token in this URL's query, so request logs do record these stop-the-report tokens (PRIVACY.md).
      if (email && path === '/api/email/unsubscribe') {
        const t = new URL(req.url, cfg.origin).searchParams.get('t') || '';
        if (req.method === 'GET') { res.statusCode = 303; res.setHeader('Location', /^v1\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{43}$/.test(t) ? `/#email=${t}` : '/'); return res.end(); }
        if (req.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED');
        if (!(await oneClick(req))) fail(400, 'ONE_CLICK_REQUIRED');
        try { const done = await email.unsubscribe(t); res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end(done.message); }
        catch (error) {
          if (error instanceof Fault && error.status < 500) { try { await spend('unsubscribe-fail', req, 60, 10 * 60_000); } catch (limit) { if (limit instanceof Fault && limit.status === 429) throw limit; } }
          throw error;
        }
      }
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
        object(data, ['idToken', 'remember']);
        if (data.remember !== undefined && typeof data.remember !== 'boolean') fail(400, 'INVALID_REQUEST'); // Remember this device: true, false, or not asked
        // Failures are counted per client address (see clientAddress); successes cost nothing here
        // and are limited per account inside login(), so a flood of bad tokens from one address —
        // or from everyone behind a mis-measured proxy — cannot lock honest parents out.
        let next;
        try {
          // A token without even a valid signature costs a saturated address nothing more than a read: the budgets are looked at
          // before any work (Stage 4 review, third round). A validly signed token is never refused for its address.
          if (!(await service.identity.verifyLocal(data.idToken))) { for (const [bucket, factor] of budgets('login-fail', req)) await service.peek(bucket, 30 * factor); fail(401, 'INVALID_LOGIN'); }
          next = await service.login(data.idToken, token, { remember: data.remember });
        }
        catch (error) {
          // Address budgets count failed credentials only. A saturated shared IP must not block a
          // subsequently valid signed login (office Wi-Fi / carrier NAT); bad attempts stay 429.
          if (error instanceof Fault && error.status !== 429) {
            try { await spend('login-fail', req, 30, 10 * 60_000); }
            catch (limit) { if (limit instanceof Fault && limit.status === 429) throw limit; }
          }
          throw error;
        }
        await sessionCookie(res, next); return json(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/auth/logout') {
        object(data, []);
        if (stored) await service.logout({ key: sha256(token), uid: stored.uid });
        setCookie(res, '', 0); return json(200, { ok: true });
      }
      // Stage 4.4: recovery runs before any session can exist (the parent cannot pass the second factor). The same
      // Origin and CSRF checks as login apply; budgeted per address here and per email inside; the answer never
      // says whether an account exists (RECOVERY.md).
      if (recovery && req.method === 'POST' && (path === '/api/auth/recovery/start' || path === '/api/auth/recovery/complete')) {
        throttle(`recovery:${clientAddress(req, cfg.proxyHops)}`, 20, 60 * 60_000); throttle(`recovery:peer:${peerAddress(req)}`, 20 * peerFactor, 60 * 60_000);
        throttle('recovery:all', 200, 60 * 60_000); // per instance: probing many addresses at once is capped whatever the keys say
        return json(200, path.endsWith('/start') ? await recovery.start(data) : await recovery.complete(data));
      }
      // email-v1: the sign-up boxes are recorded before any session exists, like recovery: the same Origin and pre-authentication
      // CSRF checks; the new account's own ID token is the proof (server/email.mjs). Only a token that fails its check spends the
      // budgets (failedCheck), so a parent's consent is never lost to a 429 that someone else's junk earned; one token is good for
      // ten tries an hour.
      if (email && req.method === 'POST' && path === '/api/auth/consent') {
        const key = typeof data?.idToken === 'string' ? `consent-token:${sha256(data.idToken)}` : null; if (key) reused(key, 10);
        try { const result = await email.consent(data); if (key) throttle(key, Infinity, 60 * 60_000); return json(200, result); }
        catch (error) { if (error instanceof Fault && error.status === 401) await failedCheck('consent', req); throw error; }
      }
      // email-v1: the app's panel for an email button (#email=<token>): what the button does, then, on a tap, doing it. Before any
      // session like recovery, so it works signed in or not: Origin and CSRF as for any POST. The signed token is the authority and
      // the server re-checks the family, its owner and the child every time. A spoiled or expired link spends the failure budgets
      // (failedCheck); a valid one never does, and one link can be opened thirty times an hour.
      if (email && req.method === 'POST' && (path === '/api/email/describe' || path === '/api/email/apply')) {
        const key = typeof data?.t === 'string' ? `email-link:${sha256(data.t)}` : null; if (key) reused(key, 30);
        let result;
        try { result = path === '/api/email/describe' ? await email.describe(data) : await email.apply(data); }
        catch (error) { if (error instanceof Fault && (error.code === 'LINK_INVALID' || error.code === 'LINK_EXPIRED')) await failedCheck('email-button', req); throw error; }
        if (result.valid === false && result.reason !== 'gone') await failedCheck('email-button', req); // describe answers a spoiled link rather than throwing
        else if (key) throttle(key, Infinity, 60 * 60_000);
        return json(200, result);
      }
      // Feedback (server/feedback.mjs): from the sign-in screen with the pre-authentication CSRF token, or inside a parent's session.
      // The session, never the body, says who sent it; a child's or the launch pad's session is refused, as no free text ever comes
      // from a child (PRIVACY.md). The body is checked first, so a malformed request spends nothing; then the budgets: a hundred an
      // hour per instance, five an hour per address (and the peer's share), ten a day per session or pre-authentication cookie.
      if (feedback && req.method === 'POST' && path === '/api/feedback') {
        const input = feedback.parse(data), live = stored && stored.expiresAt > service.now() ? stored : null;
        if (live && live.role !== 'parent') fail(403, 'PARENT_REQUIRED');
        throttle('feedback:all', 100, 60 * 60_000); await spend('feedback', req, 5, 60 * 60_000); await service.rate(`feedback:session:${sha256(token)}`, 10, 24 * 60 * 60_000);
        return json(200, await feedback.record(input, live ? { uid: live.uid, familyId: live.familyId || null, email: typeof live.email === 'string' ? live.email : null } : null));
      }
      if (stored) throttle(`session:${sha256(token)}`, 120, 60_000);
      const ctx = await service.authenticate(token);
      if (req.method === 'GET' && path === '/api/me') return json(200, await service.me(ctx));
      if (recovery && req.method === 'POST' && path === '/api/auth/recovery/ack') return json(200, await recovery.acknowledge(ctx));
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
      // Stage 3.5: the family's own data, for the parent to keep (read-only; recent sign-in). Nothing consumes it.
      if (support && req.method === 'GET' && path === '/api/family/export') return json(200, await support.exportFamily(ctx));
      if (req.method !== 'POST') fail(404, 'NOT_FOUND');
      if (learning && path === '/api/learn/session') return json(200, await learning.start(ctx, data));
      if (learning && path === '/api/learn/answer') return json(200, await learning.answer(ctx, data));
      if (learning && path === '/api/learn/quit') return json(200, await learning.quit(ctx, data));
      if (billing && path === '/api/billing/trial') return json(200, await billing.startTrial(ctx, data));
      if (billing && path === '/api/billing/cancel') return json(200, await (payments ? payments.cancel(ctx, data) : billing.cancel(ctx, data))); // Stage 4.2: the provider hears it first
      if (billing && path === '/api/billing/seats') return json(200, await billing.seats(ctx, data));
      if (payments && path === '/api/billing/checkout') return json(200, await payments.checkout(ctx, data));
      if (payments && path === '/api/billing/plan') return json(200, await payments.changePlan(ctx, data));
      if (support && path === '/api/family/deletion') return json(200, await support.requestDeletion(ctx, data));
      if (support && path === '/api/family/deletion/cancel') return json(200, await support.cancelDeletion(ctx, data));
      if (support && path === '/api/account/deletion') return json(200, await support.deleteAccount(ctx, data)); // Stage 4: the sign-in account, once no family remains
      if (email && path === '/api/account/email') return json(200, await email.setPrefs(ctx, data)); // email-v1: Mission Control's switches (recent sign-in)
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
        if (next) await sessionCookie(res, next);
        return json(200, result);
      }
      if (path === '/api/children') return json(201, await service.createChild(ctx, data, req.headers['idempotency-key']));
      if (path === '/api/session/lock') { object(data, []); const next = await service.lock(ctx); await sessionCookie(res, next); return json(200, { ok: true }); }
      if (path === '/api/session/select') { object(data, []); const next = await service.selector(ctx); await sessionCookie(res, next); return json(200, { ok: true }); }
      const match = path.match(/^\/api\/children\/([a-f0-9-]+)\/(enter|pin|start)$/);
      if (match) {
        if (match[2] === 'start') return json(200, await service.setChildStart(ctx, match[1], data));
        object(data, ['pin']);
        if (match[2] === 'enter') { const next = await service.selectChild(ctx, match[1], data.pin); await sessionCookie(res, next); }
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
