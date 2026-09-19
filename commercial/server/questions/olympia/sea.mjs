// 🌊 SEA-MOON — practice modelled on SEAMO (the Southeast Asian Mathematical Olympiad, Terry Chew Institute, Singapore); not
// affiliated. The real paper's tell is its heuristics named as topics — working backwards, queuing, pigeonhole, shortest path,
// number patterns, sums of sequences — and low reading with high structure. Bands as SEAMO's: Paper A = Years 1–2, B = 3–4,
// C = 5–6. A heat is eight multiple-choice and two short-answer questions; every paper's choices carry the real paper's fifth
// option, "None of the above", which is sometimes the right one: the 2018 Papers A, B and C all have it, only the official
// sample Paper A shows four options (the source check of 20 Sep 2026, against seamo-official.org's samples and syllabi).
import { ri, pick, shuffle, sum, names, thing, money, int, frac, mcOnly, withFigure, grid, bars, buildHeat, slots, isPrime, factorsOf, digitsOf, cap, ord } from './common.mjs';
// Tiers (20 Sep 2026): the real paper climbs — Q1–10 three marks, Q11–20 four, Q21–25 six and free response — so a heat is four
// three-mark and four four-mark multiple choice then two six-mark typed answers, and every kind is tagged with the tiers it may
// fill in each paper (T(...) below); the kinds under "the paper's tiers" are the staples the source check found missing.

const band = (y) => (y <= 2 ? 1 : y <= 4 ? 2 : 3);
const hm = (h, m) => `${h}:${String(m).padStart(2, '0')}`;
const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
const COLOURS = ['red', 'blue', 'green', 'yellow', 'white'];

// ---- Paper A up ----
const workBack = (y) => {
  const b = band(y), [w] = names(1), it = thing();
  if (b === 1) { const a = ri(2, y === 1 ? 6 : 9), g = ri(3, y === 1 ? 9 : 15), first = ri(a + 1, y === 1 ? 18 : 40); return int('working backwards', `${w} had some ${it}s. ${w} gave ${a} to a friend, then got ${g} more. Now ${w} has ${first - a + g}. How many ${it}s did ${w} have at first?`, first); }
  if (b === 2) { const first = ri(6, 30), a = ri(2, 9), g = ri(3, 12); return int('working backwards', `${w} had some ${it}s. ${w} won a game and doubled them, gave ${a} away, then got ${g} more. Now ${w} has ${first * 2 - a + g}. How many ${it}s did ${w} have at first?`, first); }
  const c = ri(4, 30); return int('working backwards', `${w} spent half of ${w}'s money on a book, then a third of what was left on a pen, and had ${money(c)} left. How much money did ${w} have at first (in dollars)?`, c * 3);
};
const pattern = (y) => {
  const b = band(y);
  if (b === 1) { const s = ri(1, 20), k = pick([2, 3, 5, 10]), back = Math.random() < 0.3 && s > 5 * k; const terms = Array.from({ length: 5 }, (_, i) => (back ? s + 5 * k - i * k : s + i * k)); return int('number patterns', `${terms.join(', ')}, ___. What number comes next?`, back ? s : s + 5 * k); }
  if (b === 2) {
    if (Math.random() < 0.5) { const s = ri(2, 30), k = ri(3, 9), n = pick([8, 10, 12]); return int('number patterns', `${Array.from({ length: 4 }, (_, i) => s + i * k).join(', ')}, … What is the ${n}th number in this pattern?`, s + (n - 1) * k); }
    const a = ri(1, 15), terms = [a, a + 2, a + 5, a + 7, a + 10, a + 12]; return int('number patterns', `${terms.slice(0, 5).join(', ')}, ___. What number comes next?`, terms[5]);
  }
  const kind = ri(1, 4);
  if (kind === 1) { const d = pick([0, 1, 2]); return int('number patterns', `${[1, 2, 3, 4, 5].map((n) => n * n + d).join(', ')}, ___. What number comes next?`, 36 + d); }
  if (kind === 2) { const a = pick([3, 5, 7]); return int('number patterns', `${[a, a * 2, a * 4, a * 8].join(', ')}, ___. What number comes next?`, a * 16); }
  if (kind === 3) return int('number patterns', '1, 3, 6, 10, 15, ___. What number comes next?', 21);
  const s = ri(2, 9), k = ri(3, 9), n = ri(8, 15); return int('number patterns', `${[s, s + k, s + 2 * k].join(', ')}, … What is the ${n}th number in this pattern?`, s + (n - 1) * k);
};
const seqSum = (y) => {
  const b = band(y);
  if (b === 1) { const n = ri(y === 1 ? 5 : 8, y === 1 ? 10 : 12); return int('sum of a sequence', `1 + 2 + 3 + … + ${n} = ?`, (n * (n + 1)) / 2); }
  if (b === 2) { const n = ri(15, 30); return int('sum of a sequence', `What is 1 + 2 + 3 + … + ${n}?`, (n * (n + 1)) / 2); }
  const kind = ri(1, 3);
  if (kind === 1) { const n = pick([40, 50, 60, 80, 100]); return int('sum of a sequence', `What is 1 + 2 + 3 + … + ${n}?`, (n * (n + 1)) / 2); }
  if (kind === 2) { const m = ri(10, 25); return int('sum of a sequence', `What is 2 + 4 + 6 + … + ${2 * m}?`, m * (m + 1)); }
  const m = ri(8, 20); return int('sum of a sequence', `What is 1 + 3 + 5 + … + ${2 * m - 1}?`, m * m);
};
const pigeonhole = (y) => {
  const b = band(y), cs = shuffle(COLOURS).slice(0, b === 1 ? 2 : 3), counts = cs.map(() => ri(3, 9)), it = pick(['marble', 'ball', 'bead']);
  const bag = cs.map((c, i) => `${counts[i]} ${c}`).join(cs.length === 2 ? ' and ' : ', ').replace(/, (\d+ \w+)$/, ' and $1');
  const kind = b === 3 ? ri(1, 3) : b === 2 ? ri(1, 2) : 1;
  if (kind === 1) return int('pigeonhole principle', `A bag has ${bag} ${it}s. Without looking, what is the smallest number of ${it}s you must take out to be sure of two of the same colour?`, cs.length + 1);
  if (kind === 2) { const i = ri(0, cs.length - 1); return int('pigeonhole principle', `A bag has ${bag} ${it}s. Without looking, what is the smallest number of ${it}s you must take out to be sure of at least one ${cs[i]} ${it}?`, sum(counts) - counts[i] + 1); }
  return int('pigeonhole principle', `A bag has ${bag} ${it}s. Without looking, what is the smallest number of ${it}s you must take out to be sure of three of the same colour?`, 2 * cs.length + 1);
};
const queue = (y) => {
  const b = band(y), [a, c] = names(2);
  if (b === 1) { const f = ri(2, y === 1 ? 6 : 9), k = ri(2, y === 1 ? 6 : 9); return int('queuing', `${a} is standing in a queue. ${a} is ${ord(f)} from the front and ${ord(k)} from the back. How many people are in the queue?`, f + k - 1); }
  if (b === 2) { const n = ri(12, 25), f = ri(2, 5), k = ri(2, 5); return int('queuing', `${n} children stand in a line. ${a} is ${ord(f)} from the front and ${c} is ${ord(k)} from the back. How many children are between ${a} and ${c}?`, n - f - k); }
  const n = pick([12, 16, 20, 24, 30]), k = ri(1, n / 2); return int('queuing', `${n} children stand in a circle, evenly spaced, numbered 1 to ${n} in order. Which number is directly opposite child ${k}?`, k + n / 2);
};
const oddEven = (y) => {
  const b = band(y), kind = ri(1, 3);
  if (b === 1) { if (kind === 1) { const n = ri(9, y === 1 ? 20 : 40); return int('odd and even numbers', `How many odd numbers are there from 1 to ${n}?`, Math.ceil(n / 2)); } return mcOnly('odd and even numbers', 'When you add an odd number and an odd number, the answer is always…', 'even', ['odd', 'a prime number', 'a two-digit number']); }
  if (b === 2) { if (kind === 1) { const a = ri(10, 40), n = ri(10, 30); return int('odd and even numbers', `How many even numbers are there from ${a} to ${a + n}?`, Math.floor((a + n) / 2) - Math.ceil(a / 2) + 1); } return mcOnly('odd and even numbers', 'The sum of three odd numbers is always…', 'odd', ['even', 'a multiple of 3', 'a square number']); }
  if (kind === 1) return mcOnly('odd and even numbers', `The product of ${ri(3, 9)} odd numbers and one even number is always…`, 'even', ['odd', 'a prime number', 'a multiple of 5']);
  if (kind === 2) { const k = ri(4, 12); return int('odd and even numbers', `What is the sum of the first ${k} odd numbers?`, k * k); }
  const n = ri(5, 12); return mcOnly('odd and even numbers', `Is 2 × 2 × … × 2 (${n} twos multiplied) + 1 odd or even?`, 'odd', ['even', 'it depends on n', 'zero']);
};
const time = (y) => {
  const b = band(y), kind = ri(1, 2);
  if (b === 1) { if (kind === 1) { const h = ri(1, 9), d = ri(1, 3); return int('time', `A film starts at ${hm(h, 0)} and ends at ${hm(h + d, 0)}. How many hours long is it?`, d); } const h = ri(1, 9), m = pick([0, 30]), d = ri(1, 3); const end = hm(h + d, m); return mcOnly('time', `It is ${hm(h, m)} now. What time will it be in ${d} hour${d > 1 ? 's' : ''}?`, end, [hm(h + d + 1, m), hm(h + d, m === 0 ? 30 : 0), hm(h, m)]); }
  if (b === 2) { const h = ri(1, 9), m = ri(1, 11) * 5, d = ri(3, 11) * 5, e = h * 60 + m + d; if (kind === 1) return int('time', `A bus leaves at ${hm(h, m)} and arrives at ${hm(Math.floor(e / 60), e % 60)}. How many minutes does the ride take?`, d); return mcOnly('time', `A lesson starts at ${hm(h, m)} and lasts ${d} minutes. When does it end?`, hm(Math.floor(e / 60), e % 60), [hm(Math.floor((e + 10) / 60), (e + 10) % 60), hm(Math.floor((e - 5) / 60), (e - 5) % 60), hm(Math.floor((e + 60) / 60), (e + 60) % 60)]); }
  const h = ri(13, 21), m = ri(0, 11) * 5, dh = ri(1, 2), dm = ri(1, 11) * 5, e = h * 60 + m + dh * 60 + dm;
  const at = (mins) => { const t = ((mins % 1440) + 1440) % 1440; return hm(Math.floor(t / 60), t % 60); }; // past midnight the clock reads 0:10, never 24:10 (the source check found 24:xx in 1.4 % of these)
  if (kind === 1) return mcOnly('time', `A concert starts at ${hm(h, m)} and lasts ${dh} h ${dm} min. At what time does it end (24-hour clock)?`, at(e), [at(e + 10), at(e - 60), at(e + 5)]);
  const days = ri(2, 6), hrs = ri(1, 23); return int('time', `How many hours are there in ${days} days and ${hrs} hours?`, days * 24 + hrs);
};
const squares = (y) => {
  const b = band(y);
  if (b < 3 || Math.random() < 0.5) { const n = b === 1 ? 2 : b === 2 ? 3 : 4; return withFigure(int('counting figures', `How many squares of every size are there in this ${n} by ${n} grid?`, sum(Array.from({ length: n }, (_, i) => (i + 1) * (i + 1)))), grid('Count the squares', n, n)); }
  const r = ri(2, 3), c = ri(3, 4); return withFigure(int('counting figures', `How many rectangles of every size (squares included) are there in this ${r} by ${c} grid?`, choose(r + 1, 2) * choose(c + 1, 2)), grid('Count the rectangles', r, c));
};
const shortestPath = (y) => {
  const b = band(y), [r, c] = b === 1 ? pick([[2, 2], [2, 3], [3, 2]]) : b === 2 ? pick([[3, 3], [2, 4], [3, 4]]) : pick([[4, 4], [3, 5], [4, 5]]);
  // square to square, as the figure shows it: A and B sit in the corner squares, so the count is C(r+c−2, r−1), not the lattice-point count the old wording implied
  return withFigure(int('shortest path', `The grid has ${r} rows and ${c} columns of squares. Moving only right or down from one square to the next, how many different shortest routes are there from square A to square B?`, choose(r + c - 2, r - 1)), grid('Routes A to B', r, c, { '0,0': 'A', [`${r - 1},${c - 1}`]: 'B' }));
};
const logic = (y) => {
  const b = band(y);
  if (b === 1) { const [a, c, d] = names(3), attr = pick([['taller', 'tallest', 'shortest'], ['older', 'oldest', 'youngest'], ['faster', 'fastest', 'slowest']]), top = Math.random() < 0.5; return mcOnly('logic', `${a} is ${attr[0]} than ${c}. ${d} is ${attr[0]} than ${a}. Who is the ${top ? attr[1] : attr[2]}?`, top ? d : c, [a, top ? c : d, 'Cannot be told']); }
  if (b === 2 || Math.random() < 0.5) { const n = ri(24, 40), both = ri(3, 10), onlyA = ri(4, 12), onlyB = ri(4, 12), neither = n - both - onlyA - onlyB; if (neither < 1) return null; const [x, z] = pick([['tea', 'coffee'], ['football', 'swimming'], ['cats', 'dogs']]); return int('logic', `In a class of ${n} children, ${onlyA + both} like ${x}, ${onlyB + both} like ${z}, and ${neither} like neither. How many like both ${x} and ${z}?`, both); }
  const w = names(4); return mcOnly('logic', `Four runners finished a race. ${w[1]} finished before ${w[2]} but after ${w[0]}. ${w[3]} was last. Who finished second?`, w[1], [w[0], w[2], w[3]]);
};
const speed = (y) => {
  const b = band(y);
  if (b === 1) { const v = ri(2, 5), t = ri(2, 4), [w] = names(1); return int('simple speed', `${w} walks ${v} km every hour. How far does ${w} walk in ${t} hours?`, v * t); }
  if (b === 2) { const v = ri(3, 9) * 10, t = ri(2, 4); return int('simple speed', `A car travels ${v * t} km in ${t} hours at a steady speed. What is its speed in km/h?`, v); }
  const v1 = pick([10, 12, 15, 20]), t1 = ri(1, 3), v2 = pick([3, 4, 5, 6]), t2 = ri(1, 3); return int('speed', `${pick(names(1))} cycles ${v1 * t1} km at ${v1} km/h, then walks ${v2 * t2} km at ${v2} km/h. How many hours does the whole journey take?`, t1 + t2);
};
const addSub = (y) => {
  if (band(y) === 1) { const hi = y === 1 ? 20 : 60, s = ri(8, hi), a = ri(1, s - 1); return int('addition and subtraction', `${a} + ___ = ${s}. What number goes in the blank?`, s - a); }
  const small = ri(5, 40), d = ri(2, 15), s = 2 * small + d; return int('sum and difference', `Two numbers add up to ${s}. One is ${d} more than the other. What is the bigger number?`, small + d);
};
const digits = () => { const t = ri(3, 9), u = ri(0, t - 1); if (t === u) return null; return int('number puzzle', `A two-digit number has digits that add up to ${t + u}. Its tens digit is ${t - u} more than its ones digit. What is the number?`, t * 10 + u); };
const handshakes = (y) => { const n = band(y) === 2 ? ri(4, 7) : ri(6, 12); return int('counting', `${n} friends meet. Each shakes hands once with every other friend. How many handshakes are there?`, (n * (n - 1)) / 2); };
const remainder = (y) => {
  const b = band(y);
  if (b === 2 || Math.random() < 0.4) { const d = ri(4, 9), r = ri(1, d - 1), k = ri(3, 12), N = d * k + r, lo = N - ri(0, d - 2); return int('remainders', `A whole number from ${lo} to ${lo + d - 2} leaves a remainder of ${r} when divided by ${d}. What is the number?`, N); }
  const base = pick([2, 3, 7, 9]), cyc = { 2: [2, 4, 8, 6], 3: [3, 9, 7, 1], 7: [7, 9, 3, 1], 9: [9, 1] }[base], n = ri(5, 30);
  return int('ones digit', `What is the ones digit of ${base} multiplied by itself ${n} times (${base} to the power ${n})?`, cyc[(n - 1) % cyc.length]);
};
const venn = (y) => logic(Math.max(3, y));

// ---- Paper C ----
const newOp = () => {
  const [sym, f, words] = pick([['★', (a, b) => a * b - a - b, 'a ★ b = a × b − a − b'], ['▲', (a, b) => 2 * a + b, 'a ▲ b = 2 × a + b'], ['◆', (a, b) => a * b + a + b, 'a ◆ b = a × b + a + b'], ['●', (a, b) => a * a - b, 'a ● b = a × a − b']]);
  const a = ri(2, 6), b = ri(2, 6), c = ri(2, 5), inner = f(a, b); if (inner < 0 || inner > 60) return null; const v = f(inner, c); if (v < 0 || v > 5000) return null;
  return int('defining new operations', `For any two whole numbers a and b, define ${words}. Find (${a} ${sym} ${b}) ${sym} ${c}.`, v);
};
const fractions = () => {
  const kind = ri(1, 3), [w] = names(1);
  if (kind === 1) { const [f1, f2, mult, rem] = pick([['a third', 'a quarter', 2, 'half'], ['a quarter', 'a third', 2, 'half'], ['a fifth', 'half', 5, 'two fifths'], ['half', 'a third', 3, 'a third']]); const c = mult === 5 ? ri(3, 12) * 2 : ri(4, 40); const first = mult === 5 ? (c * 5) / 2 : c * mult; return int('fractions', `${w} spent ${f1} of ${w}'s money on a book, then ${f2} of the remainder on a pen, and had ${money(c)} left. How much money did ${w} have at first (in dollars)?`, first, { read: `${w} spent ${f1} of the money on a book, then ${f2} of the remainder on a pen, and had ${c} dollars left; ${rem} was left. How much at first?` }); }
  if (kind === 2) { const fs = shuffle([[2, 3], [3, 5], [5, 8], [7, 12], [4, 7], [5, 9], [3, 4], [7, 10], [4, 5], [5, 6], [7, 8], [9, 10], [11, 12]]).slice(0, 4), best = fs.reduce((a, b) => (b[0] * a[1] > a[0] * b[1] ? b : a)); return mcOnly('fractions', 'Which fraction is the largest?', `${best[0]}/${best[1]}`, fs.filter((f) => f !== best).map((f) => `${f[0]}/${f[1]}`)); }
  const d = pick([3, 4, 5, 6, 8]), n = ri(1, d - 1), whole = d * ri(3, 12); return int('fractions', `What is ${n}/${d} of ${whole}?`, (whole / d) * n);
};
const primes = () => {
  const kind = ri(1, 3);
  if (kind === 1) { const lo = pick([10, 20, 30, 40, 50]), hi = lo + pick([10, 20]); let n = 0; for (let k = lo + 1; k < hi; k++) if (isPrime(k)) n++; return int('prime numbers', `How many prime numbers are there between ${lo} and ${hi}?`, n); }
  if (kind === 2) { const n = pick([36, 48, 60, 72, 84, 90, 100, 120]); return int('factors', `How many factors does ${n} have (1 and ${n} included)?`, factorsOf(n).length); }
  const n = pick([30, 42, 66, 70, 78, 84, 90, 105, 110]); const ps = factorsOf(n).filter(isPrime); return int('prime factorisation', `What is the sum of the different prime factors of ${n}?`, sum(ps));
};
const average = () => {
  if (Math.random() < 0.5) { const xs = [ri(8, 30), ri(8, 30), ri(8, 30)], avg = ri(10, 28), fourth = 4 * avg - sum(xs); if (fourth < 1) return null; return int('average', `The average of four numbers is ${avg}. Three of them are ${xs.join(', ')}. What is the fourth number?`, fourth); }
  const n = ri(4, 6), avg = ri(10, 30), avg2 = avg - ri(1, 4), removed = n * avg - (n - 1) * avg2; return int('average', `The average of ${n} numbers is ${avg}. When one number is taken away, the average of the rest is ${avg2}. What number was taken away?`, removed);
};
const ratioPercent = () => {
  const kind = ri(1, 3);
  if (kind === 1) { const p = pick([80, 120, 200, 240, 300]), off = pick([10, 25, 50]); return int('percentage', `A bag costs ${money(p)}. In a sale its price is cut by ${off}%. What is the sale price (in dollars)?`, p - (p * off) / 100); }
  if (kind === 2) { const a = ri(2, 5), b = ri(a + 1, 9), u = ri(3, 12); return int('ratio', `Two friends share ${(a + b) * u} ${thing()}s in the ratio ${a} : ${b}. How many does the one with more get?`, b * u); }
  const total = pick([40, 60, 80, 120, 200]), pct = pick([15, 20, 25, 30, 35, 40, 45, 60, 75]); return int('percentage', `${pct}% of the ${total} pupils in a school walk to school. How many pupils walk?`, (total * pct) / 100);
};
const geometry = () => {
  const kind = ri(1, 4);
  if (kind === 1) { const r = pick([7, 14, 21]); return int('area of a circle', `Taking π as 22/7, what is the area of a circle of radius ${r} cm, in cm²?`, (22 / 7) * r * r); }
  if (kind === 2) { const a = ri(30, 80), b = ri(20, 180 - a - 20); return int('angles in a triangle', `Two angles of a triangle are ${a}° and ${b}°. What is the third angle, in degrees?`, 180 - a - b); }
  if (kind === 3) { const s = ri(3, 12); return int('area and perimeter', `A square has an area of ${s * s} cm². What is its perimeter, in cm?`, 4 * s); }
  const l = ri(6, 20), w = ri(2, l - 1); return int('area and perimeter', `A rectangle has a perimeter of ${2 * (l + w)} cm and a length of ${l} cm. What is its area, in cm²?`, l * w);
};
const probability = () => { const r = ri(1, 6), b = ri(1, 6), col = shuffle(COLOURS).slice(0, 2); return frac('probability', `A bag holds ${r} ${col[0]} and ${b} ${col[1]} marbles. One marble is taken without looking. What is the probability that it is ${col[0]}? Give a fraction in its simplest form.`, r, r + b); };
const chart = (y) => {
  const labels = shuffle(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).slice(0, 4).sort((a, b) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(a) - ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(b)), vals = labels.map(() => ri(2, band(y) === 3 ? 60 : 20) * (band(y) === 3 ? 5 : 1)), what = pick(['books borrowed', 'cakes sold', 'cans collected']);
  const f = bars(cap(what), null, labels.map((l, i) => [l, vals[i]])), kind = ri(1, 3);
  if (kind === 1) return withFigure(int('charts', `The bar chart shows the ${what} on four days. How many were there altogether?`, sum(vals)), f);
  const hi = vals.indexOf(Math.max(...vals)), lo = vals.indexOf(Math.min(...vals)); if (hi === lo) return null;
  if (kind === 2) return withFigure(int('charts', `The bar chart shows the ${what} on four days. How many more on ${labels[hi]} than on ${labels[lo]}?`, vals[hi] - vals[lo]), f);
  return withFigure(mcOnly('charts', `The bar chart shows the ${what} on four days. On which day were there the fewest?`, labels[lo], labels.filter((_, i) => i !== lo)), f);
};

// ---- the paper's tiers (built 20 Sep 2026 from the source check): the real Paper A/B/C is Q1–10 at three marks, Q11–20 at four,
// Q21–25 at six and free response. The kinds below are the staples the 2018 papers and the official samples ask that the first
// build lacked; every kind above and below is tagged with the tiers it may fill, per paper. ----
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const chickenRabbit = (y) => { const b = band(y), [an1, an2, l1, l2] = pick([['chickens', 'rabbits', 2, 4], ['ducks', 'cows', 2, 4], ['ants', 'spiders', 6, 8], ['hens', 'goats', 2, 4]]), n1 = ri(b === 1 ? 2 : 5, b === 1 ? 10 : 40), n2 = ri(b === 1 ? 2 : 5, b === 1 ? 8 : 30), ask2 = Math.random() < 0.5; return int('chicken and rabbit', `A farm has ${n1 + n2} ${an1} and ${an2} altogether, with ${l1 * n1 + l2 * n2} legs in all. How many ${ask2 ? an2 : an1} are there?`, ask2 ? n2 : n1); };
const digitCount = (y) => { const b = band(y), d = ri(1, 9), n = b === 1 ? ri(20, 40) : b === 2 ? pick([60, 80, 99, 100, 120, 150]) : pick([150, 173, 200, 250, 300]); let c = 0; for (let k = 1; k <= n; k++) c += digitsOf(k).filter((x) => x === d).length; return int('counting digits', `When the whole numbers from 1 to ${n} are written down, how many times does the digit ${d} appear?`, c); };
const cycleTerm = (y) => { const b = band(y), len = ri(3, 5), cyc = Array.from({ length: len }, () => ri(0, 9)); if (new Set(cyc).size < 2) return null; const n = b === 1 ? ri(20, 60) : ri(50, 200), shown = [...cyc, ...cyc, ...cyc].slice(0, len * 2 + 1); return int('repeating patterns', `${shown.join(', ')}, … The numbers repeat in the same order. What is the ${ord(n)} number in the pattern?`, cyc[(n - 1) % len]); };
const cycleSum = (y) => { const b = band(y), len = ri(3, 5), cyc = Array.from({ length: len }, () => ri(1, 9)); if (new Set(cyc).size < 2) return null; const n = b === 1 ? ri(12, 30) : ri(30, 80), full = Math.floor(n / len), rest = n % len; return int('repeating sums', `${[...cyc, ...cyc].join(', ')}, … The numbers repeat in the same order. What is the sum of the first ${n} numbers in the pattern?`, full * sum(cyc) + sum(cyc.slice(0, rest))); };
const agesSum = (y) => { const b = band(y), ages = [ri(30, 60), ri(25, 40), ri(3, 12)], t = ri(2, b === 1 ? 6 : 15); return int('ages', `A father is ${ages[0]}, a mother is ${ages[1]} and their child is ${ages[2]} years old. In how many years will their three ages add up to ${sum(ages) + 3 * t}?`, t); };
const calendar = (y) => { const b = band(y), d = ri(0, 6), n = b === 1 ? pick([10, 20, 30, 50, 100]) : ri(60, 300), r = (d + n) % 7; return mcOnly('calendar', `Today is ${DAYS[d]}. What day of the week will it be ${n} days from today?`, DAYS[r], shuffle(DAYS.filter((_, i) => i !== r)).slice(0, 4)); };
const floorsInterval = (y) => { const b = band(y), per = ri(2, b === 1 ? 3 : 5), a = ri(3, 4), c = ri(a + 2, b === 1 ? 8 : 15); return int('intervals', `It takes ${per * (a - 1)} minutes to walk up from the 1st floor to the ${ord(a)} floor of a building. At the same pace, how many minutes does it take to walk up from the 1st floor to the ${ord(c)} floor?`, per * (c - 1)); };
const stampPairs = (y) => { const b = band(y), [v1, v2] = pick([[12, 50], [10, 30], [20, 50], [5, 8], [15, 40]]), n1 = ri(1, b === 1 ? 2 : 3), n2 = ri(1, b === 1 ? 2 : 3), sums = new Set(); for (let i = 0; i <= n1; i++) for (let j = 0; j <= n2; j++) if (i + j > 0) sums.add(i * v1 + j * v2); return int('systematic listing', `${names(1)[0]} has ${n1} stamp${n1 > 1 ? 's' : ''} worth ${v1}¢ each and ${n2} stamp${n2 > 1 ? 's' : ''} worth ${v2}¢ each. Using one or more of the stamps, how many different amounts of postage can be made?`, sums.size); };
const pyramidSum = (y) => { const n = band(y) === 1 ? ri(5, 10) : ri(10, 30); return int('pyramid sum', `1 + 2 + 3 + … + ${n} + … + 3 + 2 + 1 = ?`, n * n); };
// Paper B up
const OPS = [['◐', (a, b) => 2 * a + b], ['◑', (a, b) => a * b + a], ['◒', (a, b) => a + 2 * b], ['◓', (a, b) => a * b - 1], ['⊚', (a, b) => 5 * a - 3 * b], ['⊛', (a, b) => a * a + b], ['⊙', (a, b) => a * b - a - b]];
const definedOp = () => {
  const [sym, f] = pick(OPS), ex = Array.from({ length: 3 }, () => [ri(2, 9), ri(2, 9)]), a = ri(10, 15), b = ri(2, 9), v = f(a, b);
  if (v < 0 || ex.some(([p, q]) => f(p, q) < 0) || new Set(ex.map(String)).size < 3) return null;
  if (OPS.some(([, g]) => g !== f && ex.every(([p, q]) => g(p, q) === f(p, q)))) return null; // the three examples must fit one rule of the family only
  return int('defining new operations', `${ex.map(([p, q]) => `${p} ${sym} ${q} = ${f(p, q)}`).join(', ')}. Following the same rule, what is ${a} ${sym} ${b}?`, v);
};
const excessDeficiency = () => { const n = ri(5, 20), a = ri(2, 8), k = ri(1, 3), left = ri(1, 9), short = k * n - left; if (short < 1) return null; const askTotal = Math.random() < 0.4; return int('excess and deficiency', `Some sweets are shared among a group of children. If each child gets ${a}, ${left} sweets are left over. If each child gets ${a + k}, ${short} sweets are short. How many ${askTotal ? 'sweets' : 'children'} are there?`, askTotal ? a * n + left : n); };
const fencepost = (y) => { const gap = pick([4, 5, 6, 8, 10, 12, 15, 16, 20, 25]), n = band(y) === 2 ? ri(8, 60) : ri(20, 100); if (ri(1, 2) === 1) return int('intervals', `Trees are planted along one side of a ${gap * n} m road, ${gap} m apart, with a tree at each end. How many trees are there?`, n + 1); return int('intervals', `${n + 1} lamp posts stand in a line along a road, ${gap} m apart. How far is it from the first lamp post to the last, in metres?`, gap * n); };
const clockAngle = () => { const h = ri(1, 12), m = pick([0, 10, 20, 30, 40, 50]), a = Math.abs(30 * (h % 12) - 5.5 * m), v = Math.min(a, 360 - a); if (v === 0) return null; return int('clock angles', `What is the smaller angle between the hour hand and the minute hand of a clock at ${h}:${String(m).padStart(2, '0')}, in degrees?`, v); };
const catchUp = () => { const v1 = pick([40, 50, 60, 70, 80]), gain = pick([10, 15, 20, 25]), head = ri(1, 3), t = (v1 * head) / gain; if (!Number.isInteger(t)) return null; return int('catching up', `A train leaves a station at ${v1} km/h. ${head === 1 ? 'One hour' : `${head} hours`} later a second train leaves the same station along the same line at ${v1 + gain} km/h. How many hours after it leaves does the second train catch the first?`, t); };
const meetOffset = () => { const v1 = pick([60, 70, 80, 90, 100]), v2 = v1 - pick([10, 20, 30, 40]), off = pick([5, 10, 15, 20, 30]), t = (2 * off) / (v1 - v2); if (!Number.isInteger(t)) return null; return int('meeting', `${names(2).join(' and ')} start walking toward each other at the same time from the two ends of a path, at ${v1} m/min and ${v2} m/min. They meet ${off} m from the midpoint of the path. How long is the path, in metres?`, (v1 + v2) * t); };
const cryptarithm = () => { if (Math.random() < 0.5) { const s = ri(5, 17); return int('cryptarithm', `In the addition AB + BA = ${11 * s}, A and B stand for two different digits. What is A + B?`, s); } const d = ri(1, 8); return int('cryptarithm', `In the subtraction AB − BA = ${9 * d}, A and B stand for digits. What is A − B?`, d); };
const compositePerimeter = () => { const L = ri(8, 20), W = ri(5, L - 1), l = ri(2, L - 3), w = ri(2, W - 3); return int('perimeter', `An L-shaped figure is made by cutting a ${l} cm by ${w} cm rectangle from one corner of a ${L} cm by ${W} cm rectangle. What is the perimeter of the L-shaped figure, in cm?`, 2 * (L + W)); };
const worstCaseColours = (y) => { const cs = shuffle(COLOURS).slice(0, band(y) === 2 ? 3 : 4), counts = cs.map(() => ri(5, 40)); if (new Set(counts).size < counts.length) return null; const bag = cs.map((c, i) => `${counts[i]} ${c}`).join(', ').replace(/, (\d+ \w+)$/, ' and $1'); if (ri(1, 2) === 1) return int('worst case', `A box has ${bag} balls. Without looking, what is the smallest number of balls you must take out to be sure of having at least one ball of every colour?`, sum(counts) - Math.min(...counts) + 1); const k = ri(3, 6); return int('worst case', `A box has ${bag} balls. Without looking, what is the smallest number of balls you must take out to be sure of ${k} balls of the same colour?`, cs.length * (k - 1) + 1); };
const penaltyScore = () => { const n = pick([10, 15, 20, 25]), plus = pick([4, 5, 8, 10]), minus = pick([1, 2, 3, 4]), right = ri(Math.ceil(n / 2), n - 1); return int('assumption method', `A quiz has ${n} questions. Each right answer scores ${plus} points and each wrong answer loses ${minus} points. ${names(1)[0]} answered every question and scored ${plus * right - minus * (n - right)}. How many answers were wrong?`, n - right); };
const divisionRemainder = () => { const q = ri(12, 40), r = ri(1, 20), d = ri(r + 1, 45); return int('division with remainder', `${d * q + r} ÷ □ = ${q} remainder ${r}. What number goes in the box?`, d); };
// Paper C up
const CYC = { 2: [2, 4, 8, 6], 3: [3, 9, 7, 1], 4: [4, 6], 7: [7, 9, 3, 1], 8: [8, 4, 2, 6], 9: [9, 1] };
const lastDigit = (base, n) => CYC[base][(n - 1) % CYC[base].length];
const unitDigitSum = () => { const a = pick([2, 3, 4, 7, 8, 9]), b = pick([2, 3, 4, 7, 8, 9]), m = ri(11, 99), n = ri(11, 99); if (a === b) return null; return int('ones digit of a sum', `What is the ones digit of ${a}^${m} + ${b}^${n} (${a} to the power ${m}, plus ${b} to the power ${n})?`, (lastDigit(a, m) + lastDigit(b, n)) % 10); };
const telescoping = () => { const n = ri(4, 20); return frac('telescoping sums', `What is 1/(1×2) + 1/(2×3) + 1/(3×4) + … + 1/(${n}×${n + 1})? Give a fraction in its simplest form.`, n, n + 1); };
const pathsVia = () => { const R = pick([4, 5]), C = pick([4, 5, 6]), r1 = ri(1, R - 2), c1 = ri(1, C - 2); return withFigure(int('routes through a point', `The grid has ${R} rows and ${C} columns of squares. Moving only right or down from one square to the next, how many different shortest routes from square A to square B pass through square P?`, choose(r1 + c1, r1) * choose(R - 1 - r1 + (C - 1 - c1), R - 1 - r1)), grid('A to B through P', R, C, { '0,0': 'A', [`${r1},${c1}`]: 'P', [`${R - 1},${C - 1}`]: 'B' })); };
const coprimePairs = () => { const ps = shuffle([2, 3, 5, 7, 11, 13]).slice(0, ri(2, 4)), n = ps.reduce((a, b) => a * b, 1) * pick([1, 1, 2, 3]); if (n > 5000) return null; const k = factorsOf(n).filter(isPrime).length; return int('coprime pairs', `How many different proper fractions in their simplest form have a numerator and a denominator whose product is ${n}?`, 2 ** (k - 1)); };
const drawTwo = () => { const a = ri(2, 4), b = ri(2, 4), [c1, c2] = pick([['20¢', '$1'], ['10¢', '50¢'], ['5¢', '20¢']]), tot = choose(a + b, 2); if (ri(1, 2) === 1) return frac('two draws', `A purse holds ${a} ${c1} coins and ${b} ${c2} coins. Two coins are taken out without looking. What is the probability that they are one of each kind? Give a fraction in its simplest form.`, a * b, tot); return frac('two draws', `A purse holds ${a} ${c1} coins and ${b} ${c2} coins. Two coins are taken out without looking. What is the probability that both are ${c2} coins? Give a fraction in its simplest form.`, (b * (b - 1)) / 2, tot); };
const isosceles = () => { if (ri(1, 2) === 1) { const base = ri(20, 80); return int('angles', `Triangle ABC has AB = AC and angle ABC = ${base}°. What is angle BAC, in degrees?`, 180 - 2 * base); } const apex = ri(10, 60) * 2; return int('angles', `Triangle ABC has AB = AC and angle BAC = ${apex}°. What is angle ABC, in degrees?`, (180 - apex) / 2); };
const mixture = () => { const a = pick([100, 200, 300, 400]), b = pick([100, 200, 300, 600]), p = ri(10, 40), q = ri(10, 60), v = (a * p + b * q) / (a + b); if (!Number.isInteger(v) || p === q) return null; return int('mixtures', `${a} mL of a ${p}% sugar solution is mixed with ${b} mL of a ${q}% sugar solution. What percentage of the mixture is sugar?`, v); };
const truthChests = () => {
  const boxes = ['A', 'B', 'C'];
  const labels = boxes.map((x) => { const k = ri(1, 3); if (k === 1) return { t: `The gold is in box ${x}.`, ok: (g) => g === x }; if (k === 2) return { t: `The gold is not in box ${x}.`, ok: (g) => g !== x }; const o = pick(boxes.filter((z) => z !== x)); return { t: `The gold is not in box ${o}.`, ok: (g) => g !== o }; });
  const fits = boxes.filter((g) => labels.filter((l) => l.ok(g)).length === 1); if (fits.length !== 1) return null;
  return mcOnly('truth and lies', `Gold is hidden in one of three boxes. The label on box A says: "${labels[0].t}" The label on box B says: "${labels[1].t}" The label on box C says: "${labels[2].t}" Exactly one label is true. Which box holds the gold?`, `Box ${fits[0]}`, [...boxes.filter((x) => x !== fits[0]).map((x) => `Box ${x}`), 'Cannot be told']);
};

const T = (cat, gen, ...sections) => ({ cat, gen, sections });
const POOL_A = [T('working backwards', workBack, 'M3', 'M4'), T('number patterns', pattern, 'M3'), T('sum of a sequence', seqSum, 'M3', 'M4'), T('pigeonhole', pigeonhole, 'M4', 'M6'), T('queuing', queue, 'M3', 'M4'), T('odd and even', oddEven, 'M3'), T('time', time, 'M3'), T('counting figures', squares, 'M4', 'M6'), T('shortest path', shortestPath, 'M4', 'M6'), T('logic', logic, 'M3', 'M4'), T('simple speed', speed, 'M3'), T('addition and subtraction', addSub, 'M3'),
  T('chicken and rabbit', chickenRabbit, 'M4', 'M6'), T('counting digits', digitCount, 'M4', 'M6'), T('repeating patterns', cycleTerm, 'M4'), T('repeating sums', cycleSum, 'M6'), T('ages', agesSum, 'M6'), T('calendar', calendar, 'M4'), T('intervals', floorsInterval, 'M3', 'M4'), T('systematic listing', stampPairs, 'M6'), T('pyramid sum', pyramidSum, 'M4', 'M6')];
const POOL_B = [T('working backwards', workBack, 'M3', 'M4'), T('number patterns', pattern, 'M3'), T('sum of a sequence', seqSum, 'M3'), T('pigeonhole', pigeonhole, 'M4'), T('queuing', queue, 'M3'), T('odd and even', oddEven, 'M3'), T('time', time, 'M3'), T('counting figures', squares, 'M4'), T('shortest path', shortestPath, 'M4', 'M6'), T('logic', logic, 'M4', 'M6'), T('simple speed', speed, 'M3'), T('addition and subtraction', addSub, 'M3'), T('number puzzle', digits, 'M4'), T('handshakes', handshakes, 'M3', 'M4'), T('remainders', remainder, 'M4'), T('charts', chart, 'M3'),
  T('chicken and rabbit', chickenRabbit, 'M3', 'M4'), T('counting digits', digitCount, 'M4', 'M6'), T('repeating patterns', cycleTerm, 'M3'), T('repeating sums', cycleSum, 'M4'), T('ages', agesSum, 'M4'), T('calendar', calendar, 'M3'), T('intervals', fencepost, 'M3', 'M4'), T('floors', floorsInterval, 'M3'), T('systematic listing', stampPairs, 'M4'), T('pyramid sum', pyramidSum, 'M3'),
  T('defining new operations', definedOp, 'M4', 'M6'), T('excess and deficiency', excessDeficiency, 'M6'), T('clock angles', clockAngle, 'M6'), T('catching up', catchUp, 'M6'), T('meeting', meetOffset, 'M6'), T('cryptarithm', cryptarithm, 'M4', 'M6'), T('perimeter', compositePerimeter, 'M4'), T('worst case', worstCaseColours, 'M6'), T('assumption method', penaltyScore, 'M4', 'M6'), T('division with remainder', divisionRemainder, 'M4')];
const POOL_C = [T('working backwards', workBack, 'M3'), T('number patterns', pattern, 'M3'), T('sum of a sequence', seqSum, 'M3'), T('pigeonhole', pigeonhole, 'M3', 'M4'), T('queuing', queue, 'M3'), T('odd and even', oddEven, 'M3'), T('time', time, 'M3'), T('counting figures', squares, 'M4'), T('shortest path', shortestPath, 'M4'), T('logic', logic, 'M3', 'M4'), T('speed', speed, 'M3', 'M4'), T('handshakes', handshakes, 'M3'), T('remainders', remainder, 'M3', 'M4'), T('new operations', newOp, 'M4', 'M6'), T('fractions', fractions, 'M3', 'M4'), T('primes and factors', primes, 'M3', 'M4'), T('average', average, 'M4'), T('ratio and percentage', ratioPercent, 'M3'), T('geometry', geometry, 'M3'), T('probability', probability, 'M4'), T('charts', chart, 'M3'),
  T('defining new operations', definedOp, 'M3'), T('excess and deficiency', excessDeficiency, 'M4'), T('clock angles', clockAngle, 'M4', 'M6'), T('catching up', catchUp, 'M4', 'M6'), T('meeting', meetOffset, 'M6'), T('cryptarithm', cryptarithm, 'M3', 'M4'), T('worst case', worstCaseColours, 'M4', 'M6'), T('assumption method', penaltyScore, 'M3'), T('counting digits', digitCount, 'M4'),
  T('ones digit of a sum', unitDigitSum, 'M4', 'M6'), T('telescoping sums', telescoping, 'M6'), T('routes through a point', pathsVia, 'M6'), T('coprime pairs', coprimePairs, 'M6'), T('two draws', drawTwo, 'M6'), T('angles', isosceles, 'M4'), T('mixtures', mixture, 'M4', 'M6'), T('truth and lies', truthChests, 'M4')];
const pool = (y) => (band(y) === 1 ? POOL_A : band(y) === 2 ? POOL_B : POOL_C);
// the paper's ramp: four three-mark and four four-mark multiple choice, then two six-mark free-response answers, typed
const SHAPE = slots([['M3', 'mc', 4], ['M4', 'mc', 4], ['M6', 'sa', 2]]);
export const heat = (year) => buildHeat(SHAPE, pool(year), year, { options: 5, none: true }); // five options with "None of the above" on every paper, as the real ones
export const TOPICS = [
  { band: 'Paper A · Years 1–2', lines: ['3 marks: working backwards, patterns, sums, queues, time, odd and even', '4 marks: chicken and rabbit, counting digits, repeating patterns, calendars, floors', '6 marks, typed: ages, stamps, pyramid sums, pigeonholes, routes on a grid', 'five options, one of them “None of the above”'] },
  { band: 'Paper B · Years 3–4', lines: ['3 marks: Paper A with bigger numbers, trees along a road, bar charts', '4 marks: defined operations, cryptarithms, quiz scores, division with a remainder', '6 marks, typed: excess and deficiency, clock angles, catching up and meeting, worst cases', 'five options, one of them “None of the above”'] },
  { band: 'Paper C · Years 5–6', lines: ['3 marks: fractions, primes, percentages, angles, defined operations', '4 marks: averages, probability, mixtures, isosceles angles, truth and lies', '6 marks, typed: the ones digit of a sum of powers, telescoping sums, routes through a point', 'coprime pairs, two draws from a purse, catching up, meeting off the midpoint'] },
];
