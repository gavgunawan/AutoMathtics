// The public pages (server/site.mjs; the owner's request of 13 Sep 2026): pricing, terms, privacy, refunds and contact, in English
// and Bahasa Indonesia, for anyone and without a session. The facts they quote agree with the service's own, a family is made only
// under the terms as they stand, forms are taken from the canonical address and the hosts listed beside it and from nowhere else,
// and the home-screen app an iPhone needs for full screen is served whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/http.mjs';
import { fixture, secret } from './support.mjs';
import { BUSINESS, SITE_PAGES, TERMS_VERSION, monthlyPrice, renderSitePage, sitePath } from '../server/site.mjs';

const LANGS = ['en', 'id'];
async function serve(t, cfg = {}) {
  const f = fixture();
  const server = createApp(f.service, { origin: 'https://automathtics.net', secret, emulator: false, web: { authDomain: 'demo-am-foundation.firebaseapp.com' }, ...cfg });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { f, base: `http://127.0.0.1:${server.address().port}` };
}

test('every public page answers in English and in Bahasa Indonesia, to anyone, as a whole document with no script, one tap from its other language', async (t) => {
  const { base } = await serve(t);
  for (const page of SITE_PAGES) for (const lang of LANGS) {
    const path = sitePath(page, lang), res = await fetch(base + path), html = await res.text();
    assert.equal(res.status, 200, path); assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8/);
    assert.ok(html.startsWith('<!doctype html>') && html.includes(`<html lang="${lang}" data-mode="site">`), path);
    assert.ok(!/<script|\sstyle=|\son[a-z]+=/i.test(html), `${path}: no script, no inline style, no handler — the CSP refuses all three`);
    assert.ok(html.includes(`<link rel="canonical" href="https://automathtics.net${path}">`), `${path}: canonical on the configured origin`);
    assert.ok(html.includes(`href="${sitePath(page, lang === 'en' ? 'id' : 'en')}"`), `${path}: the other language`);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  }
  assert.equal((await fetch(`${base}/id/join`)).status, 404, 'only the pages that exist');
  assert.equal((await (await fetch(`${base}/api/bootstrap`)).json()).terms, TERMS_VERSION, 'the app is told which terms the sign-up agrees to');
});

// The owner's prices of 13 Sep 2026 replaced 150,000 for one child and 125,000 for each after it: every place a stranger reads a
// price says the new one, and the old ones are gone from all of them.
test('the prices are the owner’s — IDR 199,000 for one child, 379,000 for two, 519,000 for three, 599,000 for four — in both languages, /join says the same, and no old price is left', async () => {
  assert.deepEqual([1, 2, 3, 4].map(monthlyPrice), [199_000, 379_000, 519_000, 599_000]);
  assert.equal(monthlyPrice(5), null, 'nothing is priced beyond four children'); assert.equal(monthlyPrice(0), null);
  const en = renderSitePage('/pricing'), id = renderSitePage('/id/pricing');
  for (const s of ['IDR 199,000', 'IDR 379,000', 'IDR 519,000', 'IDR 599,000', 'For five or more children, write to', '19 September 2026, 00:00 WIB', '10 October 2026, 23:59 WIB', '11 October 2026']) assert.ok(en.includes(s), s);
  for (const s of ['Rp199.000', 'Rp379.000', 'Rp519.000', 'Rp599.000', 'Untuk lima anak atau lebih, hubungi', '10 Oktober 2026 pukul 23.59 WIB', '11 Oktober 2026']) assert.ok(id.includes(s), s);
  // yearly: twelve months less 20% (server/pricing.mjs), in the same table
  for (const s of ['Yearly, 20% off', 'IDR 1,910,400', 'IDR 3,638,400', 'IDR 4,982,400', 'IDR 5,750,400']) assert.ok(en.includes(s), s);
  for (const s of ['Tahunan, hemat 20%', 'Rp1.910.400', 'Rp3.638.400', 'Rp4.982.400', 'Rp5.750.400']) assert.ok(id.includes(s), s);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const s of ["endsWords: '10 October 2026, 23:59 WIB'", 'IDR 199,000 a month', 'IDR 379,000 a month', 'IDR 519,000 a month', 'IDR 599,000 a month', 'Or pay yearly: twelve months for 20% less.']) assert.ok(app.includes(s), `the introduction: ${s}`);
  for (const old of ['150,000', '275,000', '125,000', '150.000', '275.000', '125.000'])
    assert.ok(![en, id, app].some((text) => text.includes(old)), `the old price ${old} is gone everywhere`);
});

test('the terms carry their version and give the Indonesian text precedence; refunds are listed case by case; no page holds a placeholder or a link to nowhere', () => {
  for (const lang of LANGS) assert.ok(renderSitePage(sitePath('terms', lang)).includes(TERMS_VERSION), lang);
  assert.ok(renderSitePage('/terms').includes('the Bahasa Indonesia version prevails'));
  assert.ok(renderSitePage('/id/terms').includes('versi Bahasa Indonesia yang berlaku'));
  // the leaving offers never stack, and the terms say so in both languages
  assert.ok(renderSitePage('/terms').includes('offers cannot be combined with each other or with any other discount, and the yearly price is never reduced further'));
  assert.ok(renderSitePage('/id/terms').includes('penawaran tidak dapat digabungkan satu sama lain maupun dengan potongan lain, dan harga tahunan tidak pernah dipotong lagi'));
  assert.ok(renderSitePage('/refunds').includes('You were charged twice for the same month.'));
  // no refunds (the owner, 13 Sep 2026): said plainly in both languages, with only the exceptions a wrong charge or an ended service
  // leaves no choice about — and nothing left that promised more
  assert.ok(renderSitePage('/refunds').includes('Payments to AutoMathtics are not refunded.'));
  assert.ok(renderSitePage('/id/refunds').includes('Pembayaran kepada AutoMathtics tidak dikembalikan.'));
  assert.ok(renderSitePage('/terms').includes('Payments are not refunded, except as the <a href="/refunds">Refund Policy</a> sets out.'));
  for (const gone of ['72 hours', 'decide it fairly', 'we do not usually refund']) assert.ok(!renderSitePage('/refunds').includes(gone), gone);
  for (const gone of ['72 jam', 'putuskan secara adil', 'biasanya tidak mengembalikan']) assert.ok(!renderSitePage('/id/refunds').includes(gone), gone);
  assert.ok(renderSitePage('/privacy').includes('<b>__session</b>'), 'the one cookie is named');
  const known = new Set(['/', '/join', '/styles.css', '/icons/icon-180.png', '/fonts/Rajdhani-500.woff2', '/fonts/Orbitron-700.woff2', ...SITE_PAGES.flatMap((p) => LANGS.map((l) => sitePath(p, l)))]);
  for (const page of SITE_PAGES) for (const lang of LANGS) {
    const html = renderSitePage(sitePath(page, lang));
    assert.ok(!/\b(?:TODO|TBD|lorem|null|undefined)\b|\]\(/i.test(html), `${page} (${lang}): nothing unfinished, no link markup left unrendered`);
    for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) assert.ok(known.has(href), `${page} (${lang}): ${href} exists`);
    for (const [, to] of html.matchAll(/href="mailto:([^"]*)"/g)) assert.match(to, /^[a-z0-9.-]+@automathtics\.net$/);
  }
  assert.equal(renderSitePage('/nope'), null);
});

test('the contact page names the business with what is known, and prints no line for what is not', () => {
  for (const lang of LANGS) {
    const html = renderSitePage(sitePath('contact', lang));
    assert.ok(html.includes('<a href="mailto:support@automathtics.net">support@automathtics.net</a>'), lang);
    assert.ok(html.includes(BUSINESS.legalName || BUSINESS.brand), lang);
    if (!BUSINESS.address) assert.ok(!html.includes(lang === 'en' ? 'Address:' : 'Alamat:'), `${lang}: no empty address line`);
    if (!BUSINESS.phone) assert.ok(!html.includes('WhatsApp:'), `${lang}: no empty phone line`);
  }
});

test('a family is made only under the terms as they stand, and the parent’s record keeps the version agreed to', async () => {
  const f = fixture(), a = await f.login('parentA');
  for (const body of [{ label: 'Fam', adultAttestation: true }, { label: 'Fam', adultAttestation: true, consentVersion: 'pilot-v1' }, { label: 'Fam', adultAttestation: false, consentVersion: TERMS_VERSION }])
    await assert.rejects(f.service.createFamily(a.ctx, body), { code: 'CONSENT_REQUIRED' }, JSON.stringify(body));
  await f.service.createFamily(a.ctx, { label: 'Fam', adultAttestation: true, consentVersion: TERMS_VERSION });
  const parent = await f.store.get('parents/parentA');
  assert.equal(parent.consentVersion, TERMS_VERSION); assert.ok(Number.isFinite(parent.attestedAt));
});

test('forms are taken from the canonical address and from the hosts listed beside it, and refused from anywhere else', async (t) => {
  const { base } = await serve(t, { origins: ['https://automathtics.net', 'https://automathtics-v3-staging.web.app'] });
  const post = async (origin) => {
    const boot = await fetch(`${base}/api/bootstrap`), { csrf } = await boot.json(), cookie = boot.headers.get('set-cookie').split(';')[0];
    const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf }, body: '{}' });
    return [res.status, (await res.json()).error ?? null];
  };
  assert.deepEqual(await post('https://automathtics.net'), [200, null]);
  assert.deepEqual(await post('https://automathtics-v3-staging.web.app'), [200, null], 'a device that opened the app on the project’s own host');
  assert.deepEqual(await post('https://automathtics.net.example'), [403, 'ORIGIN_DENIED']);
  const single = await serve(t); // a configuration from before the list existed: its one origin, as always
  const boot = await fetch(`${single.base}/api/bootstrap`), { csrf } = await boot.json(), cookie = boot.headers.get('set-cookie').split(';')[0];
  const other = await fetch(`${single.base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://automathtics-v3-staging.web.app', Cookie: cookie, 'X-CSRF-Token': csrf }, body: '{}' });
  assert.equal(other.status, 403);
});

test('the home-screen app: the page links a manifest the CSP admits, and the manifest and every icon it names are served as what they claim to be', async (t) => {
  const { base } = await serve(t);
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const s of ['<link rel="manifest" href="/manifest.webmanifest">', '<link rel="apple-touch-icon" href="/icons/icon-180.png">', '<meta name="apple-mobile-web-app-capable" content="yes">']) assert.ok(page.includes(s), s);
  const res = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /^application\/manifest\+json/);
  assert.match(res.headers.get('content-security-policy'), /manifest-src 'self'/);
  const manifest = await res.json();
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.display, 'fullscreen');
  for (const src of ['/icons/icon-180.png', ...manifest.icons.map((i) => i.src)]) {
    const icon = await fetch(base + src), bytes = Buffer.from(await icon.arrayBuffer());
    assert.equal(icon.status, 200, src); assert.equal(icon.headers.get('content-type'), 'image/png', src);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${src} is a PNG`);
    const size = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, named = manifest.icons.find((i) => i.src === src)?.sizes;
    assert.equal(size, named || '180x180', src);
  }
});
