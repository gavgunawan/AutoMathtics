// 🌊 SEA-MOON — practice modelled on SEAMO (the Southeast Asian Mathematical Olympiad, Terry Chew Institute, Singapore); not
// affiliated. The real paper's tell is its heuristics named as topics — working backwards, queuing, pigeonhole, shortest path,
// number patterns, sums of sequences — and low reading with high structure. Bands as SEAMO's: Paper A = Years 1–2, B = 3–4,
// C = 5–6. A heat is eight multiple-choice and two short-answer questions; Paper C's choices carry the real paper's fifth
// option, "None of the above", which is sometimes the right one (olympia-research.md §1).
import { ri, pick, shuffle, sum, names, thing, money, int, frac, mcOnly, withFigure, grid, bars, buildHeat, slots, isPrime, factorsOf, digitsOf, cap, ord } from './common.mjs';

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
  if (kind === 1) return mcOnly('time', `A concert starts at ${hm(h, m)} and lasts ${dh} h ${dm} min. At what time does it end (24-hour clock)?`, hm(Math.floor(e / 60), e % 60), [hm(Math.floor((e + 10) / 60), (e + 10) % 60), hm(Math.floor((e - 60) / 60), (e - 60) % 60), hm(Math.floor((e + 5) / 60), (e + 5) % 60)]);
  const days = ri(2, 6), hrs = ri(1, 23); return int('time', `How many hours are there in ${days} days and ${hrs} hours?`, days * 24 + hrs);
};
const squares = (y) => {
  const b = band(y);
  if (b < 3 || Math.random() < 0.5) { const n = b === 1 ? 2 : b === 2 ? 3 : 4; return withFigure(int('counting figures', `How many squares of every size are there in this ${n} by ${n} grid?`, sum(Array.from({ length: n }, (_, i) => (i + 1) * (i + 1)))), grid('Count the squares', n, n)); }
  const r = ri(2, 3), c = ri(3, 4); return withFigure(int('counting figures', `How many rectangles of every size (squares included) are there in this ${r} by ${c} grid?`, choose(r + 1, 2) * choose(c + 1, 2)), grid('Count the rectangles', r, c));
};
const shortestPath = (y) => {
  const b = band(y), [r, c] = b === 1 ? pick([[1, 2], [2, 2], [1, 3]]) : b === 2 ? pick([[2, 3], [3, 3], [2, 4]]) : pick([[3, 4], [2, 5], [4, 4]]);
  return withFigure(int('shortest path', `The grid has ${r} row${r > 1 ? 's' : ''} and ${c} columns of blocks. Walking along the lines only to the right or down, how many different shortest paths are there from corner A to corner B?`, choose(r + c, r)), grid('Paths from A to B', r, c, { '0,0': 'A', [`${r - 1},${c - 1}`]: 'B' }));
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
const arrays = (y) => { const kind = ri(1, 2), hi = y === 1 ? 5 : 9; if (kind === 1) { const r = ri(2, hi), c = ri(2, hi); return int('multiplication', `A hall has ${r} rows of chairs with ${c} chairs in each row. How many chairs are there?`, r * c); } const n = ri(2, hi); return int('multiplication', `How many wheels do ${n} tricycles have altogether?`, 3 * n); };
const addSub = (y) => {
  if (band(y) === 1) { const hi = y === 1 ? 20 : 60, s = ri(8, hi), a = ri(1, s - 1); return int('addition and subtraction', `${a} + ___ = ${s}. What number goes in the blank?`, s - a); }
  const small = ri(5, 40), d = ri(2, 15), s = 2 * small + d; return int('sum and difference', `Two numbers add up to ${s}. One is ${d} more than the other. What is the bigger number?`, small + d);
};
const digits = () => { const t = ri(3, 9), u = ri(0, t - 1); if (t === u) return null; return int('number puzzle', `A two-digit number has digits that add up to ${t + u}. Its tens digit is ${t - u} more than its ones digit. What is the number?`, t * 10 + u); };
const handshakes = (y) => { const n = band(y) === 2 ? ri(4, 7) : ri(6, 12); return int('counting', `${n} friends meet. Each shakes hands once with every other friend. How many handshakes are there?`, (n * (n - 1)) / 2); };
const remainder = (y) => {
  const b = band(y);
  if (b === 2 || Math.random() < 0.4) { const d = ri(4, 9), r = ri(1, d - 1), k = ri(3, 12), N = d * k + r, lo = N - ri(0, d - 2); return int('remainders', `A number between ${lo} and ${lo + d - 2} leaves a remainder of ${r} when divided by ${d}. What is the number?`, N); }
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
  if (kind === 2) { const fs = shuffle([[2, 3], [3, 5], [5, 8], [7, 12], [4, 7], [5, 9], [3, 4], [7, 10]]).slice(0, 4), best = fs.reduce((a, b) => (b[0] * a[1] > a[0] * b[1] ? b : a)); return mcOnly('fractions', 'Which fraction is the largest?', `${best[0]}/${best[1]}`, fs.filter((f) => f !== best).map((f) => `${f[0]}/${f[1]}`)); }
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
const digitSum = () => { const n = ri(100, 999); return int('digits', `What is the sum of the digits of ${n}?`, sum(digitsOf(n))); };

const POOL_A = [['working backwards', workBack], ['number patterns', pattern], ['sum of a sequence', seqSum], ['pigeonhole', pigeonhole], ['queuing', queue], ['odd and even', oddEven], ['time', time], ['counting figures', squares], ['shortest path', shortestPath], ['logic', logic], ['simple speed', speed], ['multiplication', arrays], ['addition and subtraction', addSub]];
const POOL_B = [...POOL_A, ['number puzzle', digits], ['handshakes', handshakes], ['remainders', remainder], ['sets', venn], ['charts', chart]];
const POOL_C = [['working backwards', workBack], ['number patterns', pattern], ['sum of a sequence', seqSum], ['pigeonhole', pigeonhole], ['queuing', queue], ['odd and even', oddEven], ['time', time], ['counting figures', squares], ['shortest path', shortestPath], ['logic', logic], ['speed', speed], ['handshakes', handshakes], ['remainders', remainder],
  ['new operations', newOp], ['fractions', fractions], ['primes and factors', primes], ['average', average], ['ratio and percentage', ratioPercent], ['geometry', geometry], ['probability', probability], ['charts', chart], ['digits', digitSum]];
const pool = (y) => (band(y) === 1 ? POOL_A : band(y) === 2 ? POOL_B : POOL_C).map(([cat, gen]) => ({ cat, gen }));
const SHAPE = slots([['MC', 'mc', 8], ['SA', 'sa', 2]]);
export const heat = (year) => buildHeat(SHAPE, pool(year), year, band(year) === 3 ? { options: 5, none: true } : { options: 4 });
export const TOPICS = [
  { band: 'Paper A · Years 1–2', lines: ['working backwards, number patterns and sums of a sequence', 'queues, pigeonholes and odd and even', 'counting squares and shortest paths on a grid', 'time, simple speed and equal groups'] },
  { band: 'Paper B · Years 3–4', lines: ['everything in Paper A with bigger numbers', 'remainders and the ones digit', 'number puzzles, handshakes and sets', 'bar charts: totals, differences, the fewest'] },
  { band: 'Paper C · Years 5–6', lines: ['defining new operations', 'fractions of a remainder, ratio and percentage', 'primes, factors, averages and probability', 'circles, angles, perimeter and area · five options, one of them “None of the above”'] },
];
