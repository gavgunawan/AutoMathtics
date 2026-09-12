// ⚙️ ENGINE — the arithmetic track. Generators ported verbatim in behaviour from the v2 game
// (src/automathtics-src.jsx) so a child moving to v3 meets the same questions at the same paper.
// A question: { display, answer }
//   display: { layout: 'stack', top, bottom, sym } | { layout: 'inline', text }
//          | { layout: 'frac', pre?, parts: [{ n, d } | { sym }] }
//   answer:  { type: 'int', v } | { type: 'frac', n, d }   (frac stored reduced)

const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const fmt = (n) => n.toLocaleString('en-US');
const nDigit = (n) => randInt(Math.pow(10, n - 1), Math.pow(10, n) - 1);
function countCarries(a, b) {
  const A = String(a).split('').map(Number).reverse();
  const B = String(b).split('').map(Number).reverse();
  let carry = 0, c = 0;
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    carry = (A[i] || 0) + (B[i] || 0) + carry >= 10 ? 1 : 0;
    if (carry) c++;
  }
  return c;
}
function countBorrows(a, b) {
  const A = String(a).split('').map(Number);
  const B = String(b).padStart(A.length, '0').split('').map(Number);
  const adj = [...A];
  let c = 0;
  for (let i = A.length - 1; i >= 0; i--) {
    if (adj[i] < B[i]) { if (i > 0) adj[i - 1] -= 1; c++; }
  }
  return c;
}
export function reduce(n, d) {
  const g = gcd(n, d) || 1;
  return [n / g, d / g];
}
function randReducedFrac(maxD) {
  for (let t = 0; t < 60; t++) {
    const d = randInt(2, maxD), n = randInt(1, d - 1);
    if (gcd(n, d) === 1) return [n, d];
  }
  return [1, 2];
}

function genAddition(tier) {
  for (let t = 0; t < 300; t++) {
    let a, b;
    if (tier === 1) { a = nDigit(3); b = nDigit(2); }
    else if (tier === 2) { a = nDigit(3); b = nDigit(3); }
    else if (tier === 3) { a = nDigit(3); b = nDigit(3); }
    else if (tier === 4) { a = nDigit(4); b = nDigit(3); }
    else { a = nDigit(4); b = nDigit(4); }
    const need = tier === 1 ? 1 : 2;
    if (countCarries(a, b) >= need) return { display: { layout: 'stack', top: a, bottom: b, sym: '+' }, answer: { type: 'int', v: a + b } };
  }
  return { display: { layout: 'stack', top: 199, bottom: 99, sym: '+' }, answer: { type: 'int', v: 298 } };
}
function genSubtraction(tier) {
  for (let t = 0; t < 300; t++) {
    let a, b;
    if (tier === 1) { a = nDigit(3); b = randInt(10, Math.min(99, a - 1)); }
    else if (tier === 2) { a = nDigit(3); b = randInt(100, a - 1); }
    else if (tier === 3) { a = nDigit(4); b = randInt(100, 999); }
    else if (tier === 4) { a = nDigit(4); b = randInt(1000, a - 1); }
    else { a = nDigit(4); b = randInt(1000, a - 1); }
    if (b >= a) continue;
    const need = tier <= 2 ? 1 : 2;
    if (countBorrows(a, b) >= need) return { display: { layout: 'stack', top: a, bottom: b, sym: '−' }, answer: { type: 'int', v: a - b } };
  }
  return { display: { layout: 'stack', top: 402, bottom: 178, sym: '−' }, answer: { type: 'int', v: 224 } };
}
function genMultiplication(tier) {
  let a, b;
  if (tier === 1) { a = randInt(3, 9); b = randInt(3, 9); }
  else if (tier === 2) { a = randInt(12, 99); b = randInt(3, 9); }
  else if (tier === 3) { a = randInt(102, 999); b = randInt(3, 9); }
  else if (tier === 4) { a = randInt(12, 99); b = randInt(12, 99); }
  else { a = randInt(102, 999); b = randInt(12, 99); }
  return { display: { layout: 'stack', top: a, bottom: b, sym: '×' }, answer: { type: 'int', v: a * b } };
}
function genDivision(tier) {
  let d, q;
  if (tier === 1) { d = randInt(2, 9); q = randInt(2, 9); }
  else if (tier === 2) { d = randInt(2, 9); q = randInt(3, 12); }
  else if (tier === 3) { d = randInt(3, 9); q = randInt(12, 99); }
  else if (tier === 4) { d = randInt(3, 9); q = randInt(102, 999); }
  else { d = randInt(11, 25); q = randInt(12, 99); }
  return { display: { layout: 'inline', text: `${fmt(d * q)} ÷ ${d} =` }, answer: { type: 'int', v: q } };
}
function genFractions1(tier) {
  if (tier === 1) {
    const [n, d] = randReducedFrac(9);
    const k = randInt(2, 6);
    return { display: { layout: 'frac', pre: 'Simplify:', parts: [{ n: n * k, d: d * k }] }, answer: { type: 'frac', n, d } };
  }
  const maxD = tier <= 3 ? 12 : 15;
  const d = randInt(4, maxD);
  let n1, n2, sym;
  if (tier === 2 || (tier >= 4 && Math.random() < 0.5)) {
    sym = '+'; n1 = randInt(1, d - 2); n2 = randInt(1, tier === 5 ? d - 1 : d - 1 - n1 > 0 ? d - 1 - n1 : 1);
  } else {
    sym = '−'; n1 = randInt(2, d - 1); n2 = randInt(1, n1 - 1);
  }
  const rawN = sym === '+' ? n1 + n2 : n1 - n2;
  const [rn, rd] = reduce(rawN, d);
  return { display: { layout: 'frac', parts: [{ n: n1, d }, { sym }, { n: n2, d }] }, answer: rd === 1 ? { type: 'int', v: rn } : { type: 'frac', n: rn, d: rd } };
}
function genFractions2(tier) {
  const maxD = tier === 5 ? 12 : 8;
  const pick = tier === 5 ? randInt(1, 4) : Math.min(tier, 4);
  let [n1, d1] = randReducedFrac(maxD);
  let [n2, d2] = randReducedFrac(maxD);
  let sym, rn, rd;
  if (pick === 1) { sym = '+'; rn = n1 * d2 + n2 * d1; rd = d1 * d2; }
  else if (pick === 2) {
    if (n1 / d1 < n2 / d2) { [n1, d1, n2, d2] = [n2, d2, n1, d1]; }
    if (n1 * d2 === n2 * d1) { n2 = Math.max(1, n2 - 1); }
    sym = '−'; rn = n1 * d2 - n2 * d1; rd = d1 * d2;
  }
  else if (pick === 3) { sym = '×'; rn = n1 * n2; rd = d1 * d2; }
  else { sym = '÷'; rn = n1 * d2; rd = d1 * n2; }
  const [an, ad] = reduce(rn, rd);
  return { display: { layout: 'frac', parts: [{ n: n1, d: d1 }, { sym }, { n: n2, d: d2 }] }, answer: ad === 1 ? { type: 'int', v: an } : { type: 'frac', n: an, d: ad } };
}

export const LEVELS = Object.freeze([
  { id: 'A', name: 'Addition (hundreds)', base: 25 },
  { id: 'B', name: 'Subtraction', base: 30 },
  { id: 'C', name: 'Multiplication', base: 30 },
  { id: 'D', name: 'Division', base: 40 },
  { id: 'E', name: 'Fractions I', base: 40 },
  { id: 'F', name: 'Fractions II', base: 45 },
]);
const GEN = [genAddition, genSubtraction, genMultiplication, genDivision, genFractions1, genFractions2];
export const genEngine = (levelIdx, tier) => GEN[Math.min(Math.max(0, levelIdx), GEN.length - 1)](tier);
// per-question seconds: level base + 5 s per tier step, × the child's pace multiplier
export const engineSecondsFor = (levelIdx, tier, mult = 1) => Math.round((LEVELS[Math.min(levelIdx, LEVELS.length - 1)].base + (tier - 1) * 5) * mult);
