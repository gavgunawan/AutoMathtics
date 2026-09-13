// The public pages (the owner's request of 13 Sep 2026): pricing, terms, privacy, refunds and contact — in English at /pricing,
// /terms, /privacy, /refunds and /contact, and in Bahasa Indonesia under /id/. A payment provider reviews them before it lets
// the business take money, and a parent should be able to read them before any account exists, so they are plain documents
// rendered here: no script, no sign-in, nothing that waits on the app to load, in the app's own stylesheet. Their words live
// in site-pages.mjs; this file holds the facts those words quote, and turns blocks into HTML.
import { VERSION } from './version.mjs';
import { sitePages } from './site-pages.mjs';
import { MONTHLY_PRICES, monthlyPrice, annualPrice } from './pricing.mjs';

// The version of the terms a parent agrees to. Creating a family requires it (service.createFamily records it on the parent),
// /api/bootstrap tells the app which version it is asking about, and the terms page prints it: new terms are a new agreement,
// so change this with the words.
export const TERMS_VERSION = 'terms-2026-09-13.3'; // .3: payments are not refunded but for the listed exceptions; .2: yearly plans and offers that never stack — both 13 Sep 2026
const UPDATED = Object.freeze({ en: '13 September 2026', id: '13 September 2026' });

// Who runs the business, exactly as registered with the payment provider. A line without a value is left off the Contact page
// rather than printed with a placeholder: fill these in before the provider's review and they appear.
export const BUSINESS = Object.freeze({ brand: 'AutoMathtics', legalName: null, address: null, phone: null, email: 'support@automathtics.net' });

// The prices live in server/pricing.mjs (the owner's rules of 13 Sep 2026): the pages quote them from there and the payment adapter
// charges by the same functions, so what a parent reads and what a parent pays cannot drift apart.
export { MONTHLY_PRICES, monthlyPrice, annualPrice };
const group = (n, separator) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
const money = { en: (n) => `IDR ${group(n, ',')}`, id: (n) => `Rp${group(n, '.')}`, monthly: monthlyPrice, annual: annualPrice };

// The opening trial, the same moments /join states (app.js TRIAL), in WIB for everyone
const TRIAL = Object.freeze({
  en: { opens: '19 September 2026, 00:00 WIB', ends: '10 October 2026, 23:59 WIB', firstCharge: '11 October 2026' },
  id: { opens: '19 September 2026 pukul 00.00 WIB', ends: '10 Oktober 2026 pukul 23.59 WIB', firstCharge: '11 Oktober 2026' },
});

const PAGES = sitePages({ money, trial: TRIAL, updated: UPDATED, termsVersion: TERMS_VERSION, business: BUSINESS });
export const SITE_PAGES = Object.freeze(['pricing', 'terms', 'privacy', 'refunds', 'contact']);
const NAV = { en: ['Pricing', 'Terms', 'Privacy', 'Refunds', 'Contact'], id: ['Harga', 'Syarat', 'Privasi', 'Pengembalian Dana', 'Kontak'] };
const LANGUAGES = { en: 'English', id: 'Bahasa Indonesia' };
const TAGLINE = { en: 'MATHS PRACTICE THEY ASK TO DO', id: 'LATIHAN MATEMATIKA YANG DISUKAI ANAK' };
export const sitePath = (page, lang = 'en') => (lang === 'id' ? `/id/${page}` : `/${page}`);
const ROUTES = new Map(SITE_PAGES.flatMap((page) => Object.keys(LANGUAGES).map((lang) => [sitePath(page, lang), { page, lang }])));
export const isSitePath = (path) => ROUTES.has(path);

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// Only our own paths and our own addresses are ever linked: the words are ours, but a slip in them must not become a link elsewhere.
const HREF = /^\/[a-z0-9/-]*$/;
function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, href) => (HREF.test(href) ? `<a href="${href}">${label}</a>` : all))
    .replace(/(?<![\w.@-])([a-z0-9][a-z0-9.-]*@automathtics\.net)\b/g, '<a href="mailto:$1">$1</a>');
}
function block([kind, value]) {
  switch (kind) {
    case 'h2': return `<h2>${inline(value)}</h2>`;
    case 'p': return `<p>${inline(value)}</p>`;
    case 'note': return `<p class="doc-note">${inline(value)}</p>`;
    case 'ul': return `<ul>${value.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
    case 'table': return `<div class="doc-table"><table><thead><tr>${value.head.map((h) => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${
      value.rows.map(([first, ...rest]) => `<tr><th scope="row">${inline(first)}</th>${rest.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    case 'cta':
      if (!HREF.test(value.href)) throw Error('A call to action links to one of our own pages.');
      return `<p class="doc-cta"><a class="primary" href="${value.href}">${esc(value.label)}</a></p>`;
    default: throw Error(`Unknown block: ${kind}`);
  }
}

/** The page at `path` as a whole HTML document, or null when the path is not one of the public pages. */
export function renderSitePage(path, { origin = '' } = {}) {
  const route = ROUTES.get(path);
  if (!route) return null;
  const { page, lang } = route, doc = PAGES[page][lang], release = `v${VERSION.split('.').slice(0, 2).join('.')}`;
  const languages = Object.entries(LANGUAGES).map(([l, name]) => `<a href="${sitePath(page, l)}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="page"' : ''}>${name}</a>`).join('');
  const nav = SITE_PAGES.map((p, i) => `<a href="${sitePath(p, lang)}"${p === page ? ' aria-current="page"' : ''}>${NAV[lang][i]}</a>`).join('');
  const links = origin ? [`<link rel="canonical" href="${origin}${sitePath(page, lang)}">`,
    ...Object.keys(LANGUAGES).map((l) => `<link rel="alternate" hreflang="${l}" href="${origin}${sitePath(page, l)}">`)] : [];
  return `<!doctype html>
<html lang="${lang}" data-mode="site">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#07091A">
<title>${esc(doc.title)} — AutoMathtics</title>
<meta name="description" content="${esc(doc.description)}">
${links.join('\n')}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2307091A'/%3E%3Cpath d='M17 51 32 13l15 38' fill='none' stroke='%2335E0FF' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M24 38h16' stroke='%23FF2DA8' stroke-width='7' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="apple-touch-icon" href="/icons/icon-180.png">
<link rel="preload" href="/fonts/Rajdhani-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/Orbitron-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="masthead"><a href="/" class="brand">AUTO<span>MATHTICS</span><small>${TAGLINE[lang]}</small></a></header>
<main id="app"><article class="panel doc">
<nav class="doc-lang" aria-label="${lang === 'en' ? 'Language' : 'Bahasa'}">${languages}</nav>
<p class="kicker">${esc(doc.kicker)}</p>
<h1>${esc(doc.title)}</h1>
<p class="intro muted">${inline(doc.intro)}</p>
${doc.blocks.map(block).join('\n')}
</article></main>
<footer class="site-foot"><nav aria-label="${lang === 'en' ? 'AutoMathtics pages' : 'Halaman AutoMathtics'}">${nav}</nav><span>${release} · © 2026 AutoMathtics</span></footer>
</body>
</html>
`;
}
