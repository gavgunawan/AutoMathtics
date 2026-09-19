// 🪐 OLYMPIA — what every moon shares (19 Sep 2026). A moon is a module that exports heat(year): ten questions in that
// competition's own shape, built from "seeds". A seed is a question before its answer style is fixed:
//   { cat, text, read?, figure?, answer: { type: "int"|"dec"|"frac", … } | null, right?: string, decoys?: string[], mcOnly?: true }
// finish(seed, "sa") keeps the typed answer; finish(seed, "mc") offers it among distractors — the seed's own, or ones made
// near a whole number — with SEAMO's fifth option "None of the above" where a moon asks for it. Every question that comes
// out is the shape the client already draws and the server already marks (progress.mjs grade):
//   { display: { layout: "word", text, choices, figure? }, answer, read, cat, section }

export const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export const lcm = (a, b) => (a * b) / gcd(a, b);
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
export const isPrime = (n) => { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
export const factorsOf = (n) => { const out = []; for (let d = 1; d <= n; d++) if (n % d === 0) out.push(d); return out; };
export const digitsOf = (n) => String(n).split('').map(Number);
export const NONE = 'None of the above';

// names a child here will know: Indonesian first, the region's after
export const NAMES = ['Dita', 'Rina', 'Adi', 'Budi', 'Citra', 'Sari', 'Bayu', 'Putri', 'Wira', 'Nadia', 'Farel', 'Kiara', 'Raka', 'Zahra', 'Mei', 'Ravi', 'Ben', 'Aisha', 'Kai', 'Nora', 'Tom', 'Lily'];
export const names = (n) => shuffle(NAMES).slice(0, n);
export const THINGS = ['sticker', 'marble', 'card', 'shell', 'bead', 'stamp', 'coin', 'sweet', 'button', 'apple', 'book', 'toy car', 'balloon', 'pencil'];
export const thing = () => pick(THINGS);
export const money = (n) => `$${n}`;

// ---- seeds ----
export const seed = (cat, text, answer, extra = {}) => ({ cat, text, answer, ...extra });
export const int = (cat, text, v, extra = {}) => seed(cat, text, { type: 'int', v }, extra);
export const dec = (cat, text, v, extra = {}) => seed(cat, text, { type: 'dec', v: Math.round(v * 100) / 100 }, extra);
export const frac = (cat, text, n, d, extra = {}) => { const g = gcd(n, d); return seed(cat, text, { type: 'frac', n: n / g, d: d / g }, extra); };
// a question whose answer is a word or a name: choices only, the right one given as a string
export const mcOnly = (cat, text, right, decoys, extra = {}) => seed(cat, text, null, { right: String(right), decoys: decoys.map(String), mcOnly: true, ...extra });
// a figure on a seed. The client draws bars, pie, table, line (see singapore.mjs) and, for the moons, a grid of cells:
//   { kind: "grid", title, rows: [{ cells: ["", "", ""] }] }   2–8 rows and columns; a cell is a short string (a letter, a digit, an emoji) or ""
export const withFigure = (s, figure) => ({ ...s, figure });
export const grid = (title, rows, cols, at = {}) => ({ kind: 'grid', title, rows: Array.from({ length: rows }, (_, r) => ({ cells: Array.from({ length: cols }, (_, c) => at[`${r},${c}`] || '') })) });
export const bars = (title, unit, pairs) => ({ kind: 'bars', title, unit, bars: pairs.map(([label, value]) => ({ label, value })) });
export const table = (title, head, rows) => ({ kind: 'table', title, head, rows: rows.map((cells) => ({ cells: cells.map(String) })) });

// ---- distractors ----
const rev = (v) => Number(String(v).split('').reverse().join(''));
/** `n` distinct whole numbers near v, none equal to v, none under `min`: the slips a child makes (one off, a place wrong, doubled, halved, digits swapped). */
export function nearby(v, n = 3, { min = v > 0 ? 1 : 0 } = {}) {
  const cands = [v + 1, v - 1, v + 2, v - 2, v + 10, v - 10, v * 2, Math.round(v / 2), v + 3, v - 3, v + 5, v - 5, v + 4, v - 4,
    ...(v >= 10 && v % 10 !== 0 ? [rev(v)] : []), ...(v >= 20 ? [v + 20, v - 20] : []), ...(v >= 100 ? [v + 100, v - 100] : [])];
  const out = []; const seen = new Set([v]);
  for (const c of shuffle(cands)) { if (Number.isInteger(c) && c >= min && !seen.has(c)) { seen.add(c); out.push(c); } if (out.length === n) return out; }
  for (let k = 6; out.length < n; k++) { const c = v + k; if (!seen.has(c)) { seen.add(c); out.push(c); } }
  return out;
}
const decNear = (v, n) => { const out = [], seen = new Set([v.toFixed(2)]); for (const d of shuffle([0.1, -0.1, 1, -1, 0.5, -0.5, 0.01, -0.01, 2, -2, 0.2, -0.2])) { const c = Math.round((v + d) * 100) / 100; if (c >= 0 && !seen.has(c.toFixed(2))) { seen.add(c.toFixed(2)); out.push(c); } if (out.length === n) break; } return out.map((x) => String(x)); };
const fracNear = (nn, d, n) => { const out = [], seen = new Set([`${nn}/${d}`]); for (const [a, b] of shuffle([[nn + 1, d], [nn - 1, d], [nn, d + 1], [nn, d - 1], [d - nn, d], [nn, d * 2], [nn + 1, d + 1], [nn * 2, d], [nn, d + 2]])) { if (a >= 1 && b >= 2 && a < b && !seen.has(`${a}/${b}`)) { seen.add(`${a}/${b}`); out.push(`${a}/${b}`); } if (out.length === n) break; } return out; };
const answerString = (a) => (a.type === 'frac' ? `${a.n}/${a.d}` : a.type === 'dec' ? String(Math.round(a.v * 100) / 100) : String(a.v));
const decoysFor = (a, n) => (a.type === 'frac' ? fracNear(a.n, a.d, n) : a.type === 'dec' ? decNear(a.v, n) : nearby(a.v, n).map(String));

/**
 * Fix a seed's answer style. "sa": the typed answer as it is. "mc": the right one among `options - 1` distractors, shuffled;
 * with `none`, SEAMO Paper C's fifth option "None of the above" is the last choice, and one time in eight it is the right one —
 * the listed numbers are then all wrong. A seed that cannot be asked the way the slot wants returns null and the slot draws again.
 */
export function finish(s, kind, { options = 4, none = false, section = null } = {}) {
  if (!s) return null;
  const base = { cat: s.cat, section, display: { layout: 'word', text: s.text, choices: null, ...(s.figure ? { figure: s.figure } : {}) }, read: s.read || s.text };
  if (kind === 'sa') { if (!s.answer) return null; return { ...base, answer: s.answer }; }
  const right = s.right ?? (s.answer ? answerString(s.answer) : null); if (right === null) return null;
  const want = options - (none ? 1 : 0) - 1;
  let decoys = [...new Set((s.decoys || []).map(String).filter((x) => x !== right))];
  if (decoys.length < want && s.answer) decoys = [...new Set([...decoys, ...decoysFor(s.answer, want + 2)])].filter((x) => x !== right);
  if (decoys.length < want) return null;
  decoys = shuffle(decoys).slice(0, want);
  let listed = shuffle([right, ...decoys]), v;
  if (none && s.answer && Math.random() < 1 / 8) { const more = decoysFor(s.answer, want + 4).filter((x) => x !== right && !decoys.includes(x)); if (more.length) { listed = shuffle([...decoys, more[0]]); } }
  const choices = none ? [...listed, NONE] : listed;
  v = choices.indexOf(right); if (v < 0) v = choices.length - 1; // "None of the above" is the answer
  return { ...base, display: { ...base.display, choices }, answer: { type: 'choice', v }, read: `${base.read} Options: ${choices.join(', ')}.` };
}

/**
 * Ten questions for a moon: `shape` says each slot's section and style; `pool(year)` gives the categories a year may be asked,
 * each { cat, gen, sections? }. A category is used once while others remain; a seed that will not fit is dropped and the slot
 * draws again, so a paper never has a hole.
 */
export function buildHeat(shape, pool, year, opts = {}) {
  const out = [], used = new Set();
  for (const slot of shape) {
    const fits = pool.filter((c) => !c.sections || c.sections.includes(slot.section));
    let q = null;
    for (let t = 0; t < 120 && !q; t++) { // a slot whose kinds mostly answer in the other style needs many draws before it is a hole
      const fresh = fits.filter((c) => !used.has(c.cat)), c = pick(fresh.length ? fresh : fits);
      const s = c.gen(year); if (!s) continue;
      if (slot.kind === 'sa' && (s.mcOnly || !s.answer)) continue;
      q = finish(s, slot.kind, { ...opts, section: slot.section }); if (q) used.add(c.cat);
    }
    if (!q) throw Error(`no question for ${slot.section}/${slot.kind} at year ${year}`);
    out.push(q);
  }
  return out;
}
export const slots = (spec) => spec.flatMap(([section, kind, n]) => Array.from({ length: n }, () => ({ section, kind })));
