// The map in the v2 look (port plan section 2, row 7): the sector's letter as the route — drawn where the DOM has SVG, said in
// words where it has none — the check-point strip, the fluency heatmap in numbers and words (never colour alone), the trophy
// case and the weekly scan, with a tab for each track. Everything on it is the learning state the server keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture, nodes } from './ui-support.mjs';
import { freshProgress } from '../server/progress.mjs';

const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const learning = (h, kid) => `families/${h.a.familyId}/learning/${kid.id}`;
const find = (h, re) => all(h.root).find((n) => re.test(n.className || ''));
async function kidWith(t, progress, options = {}) {
  const h = await uiFixture(t, options); const kid = (await h.f.child(h.a.ctx, 'Allison')).child;
  await h.f.store.put(learning(h, kid), progress);
  await h.api.refresh(); await h.click('Hand over to kids');
  await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick(); h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  return { h, kid };
}
// a session's row with its question log: n questions of one tier, `ok` of them right, s seconds each, a allowed (none: a v2 row)
const row = (tier, n, ok, s, a) => ({ ts: Date.parse('2026-09-05T09:00:00Z'), date: '2026-09-05', track: 'engine', mode: 'paper', level: 1, levelId: 'B', papers: '36–40',
  correct: ok, incorrect: n - ok, timeout: 0, total: n, passed: ok === n, secs: n * s, qlog: Array.from({ length: n }, (_, i) => ({ t: tier, l: 1, track: 'engine', s, ...(a ? { a } : {}), ok: i < ok ? 1 : 0 })) });

test('the map where the DOM cannot draw: the route in words, the check-point strip, the heatmap in numbers and words, the trophies, the scan, and a tab per track', async (t) => {
  const p = freshProgress(); p.engine = { level: 1, paper: 41, bossCleared: 2 }; p.nav = { level: 1, paper: 1, bossCleared: 0 };
  p.history = [row(1, 10, 10, 5, 30), row(1, 5, 5, 40, 0), row(2, 10, 8, 10, 30), row(3, 6, 6, 28, 30), row(4, 3, 3, 9, 30)];
  const { h } = await kidWith(t, p);
  await h.click('🗺 Map');
  const text = () => h.root.textContent;
  assert.ok(text().includes('🗺 SECTOR B ROUTE · ALLISON'), text().slice(0, 120));
  const tabs = h.nodes('BUTTON').filter((b) => b.attrs.role === 'tab');
  assert.deepEqual(tabs.map((b) => [b.textContent, b.attrs['aria-selected']]), [['⚙️ ENGINE', 'true'], ['🧭 NAVIGATOR', 'false']]);
  assert.equal(h.nodes('SVG').length, 0);
  assert.ok(text().includes('🗺 Sector B route: 2 of 5 check points cleared, 40 of 100 papers passed'), 'without SVG the route is said in words');
  const strip = find(h, /^cp-strip$/).children;
  assert.deepEqual(strip.map((c) => c.textContent), ['👑1–20 cleared', '👑21–40 cleared', '⚡41–60 reached', '🔒61–80 locked', '🔒81–100 locked']);
  assert.deepEqual(strip.map((c) => c.style.props['--c'] ?? null), ['#35E0FF', '#2DFFB3', '#FFB020', null, null], 'each check point reached in its own colour (v2 229)');
  assert.equal(strip[0].style.props['--c-soft'], '#35E0FF18');
  const cells = find(h, /^heat-grid$/).children;
  assert.deepEqual(cells.map((c) => c.className), ['heat-cell mint', 'heat-cell red', 'heat-cell gold', 'heat-cell grey', 'heat-cell grey']);
  for (const [i, words] of [[0, ['T1', '100% · 17s', '15q / 30s', '✓ fast']], [1, ['T2', '80% · 10s', '10q / 30s', '✗ practise']], [2, ['T3', '100% · 28s', '6q / 30s', '⏳ slow']],
    [3, ['T4', 'no data', '3q', 'play more']], [4, ['T5', 'no data', '—', 'play more']]]) for (const w of words) assert.ok(cells[i].textContent.includes(w), `T${i + 1} says ${w}: ${cells[i].textContent}`);
  assert.ok(text().includes('FLUENCY HEATMAP') && text().includes('🏆 TROPHY CASE'));
  const tiles = find(h, /^trophies\b/).children;
  assert.deepEqual(tiles.map((n) => n.className), ['trophy done', 'trophy cur', 'trophy', 'trophy', 'trophy', 'trophy']);
  assert.ok(tiles[0].textContent.startsWith('🏆A') && tiles[1].textContent.startsWith('⚙️🧭B') && tiles[5].textContent.startsWith('🔒F'));
  assert.ok(text().includes('1 of 6 sectors cleared · A banked'));
  assert.ok(text().includes('🧠 SYSTEM SCAN · WEEKLY') && h.nodes('BUTTON').some((b) => b.textContent === 'START SCAN ▶'), 'Engine is past papers 16–20 of Sector B and has no scan this week');
  const asked = h.requests.length; await h.click('🧭 NAVIGATOR');
  assert.equal(h.requests.length, asked, 'a tab redraws from what the map fetched');
  assert.ok(text().includes('Sector B route: 0 of 5 check points cleared, 0 of 100 papers passed'));
  assert.equal(h.nodes('BUTTON').find((b) => b.textContent === '🧭 NAVIGATOR').attrs['aria-selected'], 'true');
  assert.deepEqual(find(h, /^cp-strip$/).children.map((c) => c.children[0].textContent), ['⚡', '🔒', '🔒', '🔒', '🔒']);
  assert.ok(find(h, /^heat-grid$/).children.every((c) => c.className === 'heat-cell grey'), 'nothing logged on Navigator yet');
  await h.click('START SCAN ▶'); assert.ok(h.root.textContent.includes('🧠 SCAN'), 'the weekly scan starts from the map');
});

test('the map where the DOM can draw: the letter\'s route lit as far as the papers go in the map theme\'s colour, the check points in the theme\'s colours, the exit and the vehicle', async (t) => {
  const p = freshProgress(); p.engine = { level: 0, paper: 21, bossCleared: 1 };
  Object.assign(p.wallet, { inventory: ['map_lava', 'veh_rocket'], activeMap: 'map_lava', activeVehicle: 'veh_rocket' });
  const { h } = await kidWith(t, p, { svg: true });
  await h.click('🗺 Map');
  const [svg] = h.nodes('SVG'); assert.ok(svg, 'the route is drawn');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg'); assert.equal(svg.attrs.viewBox, '-18 -18 236 276'); assert.equal(svg.attrs.role, 'img');
  assert.equal(svg.attrs['aria-label'], 'Sector A route: 1 of 5 check points cleared, 20 of 100 papers passed');
  assert.ok(!find(h, /^route-text$/), 'the words stand in only where nothing is drawn');
  const map = find(h, /^tronmap\b/);
  assert.equal(map.className, 'tronmap acc-0'); assert.equal(map.style.props['--lit'], '#FF5A2D'); assert.equal(map.style.props['--grid'], 'rgba(255,90,45,.07)');
  const paths = nodes(svg, 'PATH'), lit = paths.find((n) => n.attrs.class === 'route-lit');
  assert.equal(paths.length, 5, 'the crossbar, the letter unlit, the lit stretch, its core and the running light');
  const A = [[36, 226], [68, 128], [100, 16], [132, 128], [164, 226]], len = A.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - A[i][0], q[1] - A[i][1]), 0);
  assert.equal(lit.attrs['stroke-dasharray'], `${Math.round((len / 6) * 10) / 10} ${Math.round(len * 10) / 10}`, 'lit to the first check point: paper 20 of 100');
  assert.equal(lit.attrs.stroke, undefined, 'the lit colour is the class\'s (--lit), not an attribute');
  const rings = nodes(svg, 'CIRCLE').filter((c) => c.attrs.r === '14.5');
  assert.deepEqual(rings.map((c) => c.attrs.stroke), ['#FFB020', '#FF7A2D', '#2A3170', '#2A3170', '#2A3170'], 'cleared and reached in the lava theme\'s colours, the rest unlit');
  assert.deepEqual(nodes(svg, 'G').filter((g) => g.attrs.class === 'cpdue').length, 1, 'the check point reached pulses');
  const texts = nodes(svg, 'TEXT');
  assert.deepEqual(texts.map((n) => n.textContent), ['🔒', '👑', '⚡', '🔒', '🔒', '🔒', '🚀'], 'the exit, the five check points, the vehicle');
  assert.equal(texts.at(-1).attrs.class, 'mapveh'); assert.equal(nodes(svg, 'ANIMATE').length, 1, 'light runs along the lit stretch');
  assert.equal(find(h, /^cp-cell open$/).style.props['--c'], '#FFB020', 'the strip wears the theme too');
  await h.click('Back'); assert.ok(h.root.textContent.includes('grid coins · spend in 🛒'));
});
