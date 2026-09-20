// 🦅 US-MOON — practice modelled on AMO (the American Mathematics Olympiad, SIMCC with Southern Illinois University); not
// affiliated. The real paper is US Common Core content delivered through the Singapore model method, with a non-routine
// strand that names cryptarithms, divisibility tests, number patterns, spatial visualisation and logic. AMO starts at Grade 2,
// so this moon opens at Year 2; the syllabus is banded 2–4 and 5–6, and so are these generators. The paper is 15 multiple-choice
// questions at three marks, then five open answers at five and five at six, 90 minutes, five options, no penalty (SIU's AMO
// Info Pack 2025, the source check of 20 Sep 2026) — so a heat is six three-mark multiple choice then two five-mark and two
// six-mark typed answers, every kind tagged with the tiers it may fill in each band, and the kinds after "the paper's tiers" are
// the staples the Info Pack's worked examples ask that the first build lacked.
import { ri, pick, shuffle, sum, names, thing, money, int, frac, mcOnly, withFigure, grid, table, buildHeat, slots, phase, explain, bar, digitsOf, gcd, ord } from './common.mjs';

const upper = (y) => y >= 5;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---- word problems by the model method ----
const model = (y) => {
  const kind = upper(y) ? ri(1, 4) : ri(1, 2), [a, b] = names(2), it = thing();
  if (kind === 1) { const small = ri(y <= 3 ? 3 : 8, y <= 3 ? 15 : 40), d = ri(2, y <= 3 ? 8 : 20); return int('model method', `${a} and ${b} have ${2 * small + d} ${it}s altogether. ${a} has ${d} more than ${b}. How many ${it}s does ${b} have?`, small); }
  if (kind === 2) { const k = ri(2, y <= 3 ? 3 : 5), u = ri(2, y <= 3 ? 9 : 15); if (ri(1, 2) === 1) return int('model method', `${a} has ${k} times as many ${it}s as ${b}. Together they have ${(k + 1) * u}. How many ${it}s does ${a} have?`, k * u); return int('model method', `${a} has ${k} times as many ${it}s as ${b}. Together they have ${(k + 1) * u}. How many more ${it}s does ${a} have than ${b}?`, (k - 1) * u); }
  if (kind === 3) { const d = pick([5, 7, 8, 9]), n = ri(3, d - 1), diff = 2 * n - d, u = ri(2, 12); if (diff <= 0 || gcd(n, d) !== 1) return null; return int('model method', `In a class, ${n}/${d} of the pupils are girls. There are ${diff * u} more girls than boys. How many pupils are in the class?`, d * u); }
  return equalAfter();
};
// b had x, a had kx; a gives g and they are equal: kx − g = x + g, so g = (k−1)x/2 — pick x so that g is whole
const equalAfter = () => { const k = pick([2, 3, 5]), [a, b] = names(2), x = (k === 2 ? 2 : 1) * ri(2, 12), g = ((k - 1) * x) / 2; return int('model method', `${a} had ${k} times as much money as ${b}. After ${a} gave ${b} ${money(g)}, they had the same amount. How much money did ${b} have at first (in dollars)?`, x); };
// ---- cryptarithms: one letter stands for one digit ----
const crypt = (y) => {
  if (!upper(y)) { const A = ri(1, 9), p = ri(0, 9), q = ri(1, 9), s = (10 * A + p) + (10 * q + A); return int('cryptarithm', `In this addition each A stands for the same digit: A${p} + ${q}A = ${s}. What digit is A?`, A); }
  const A = ri(1, 9), p = ri(0, 9), q = ri(1, 9), r = ri(0, 9), s = (100 * A + 10 * p + q) + (100 * r + 10 * A + A); return int('cryptarithm', `In this addition each A stands for the same digit: A${p}${q} + ${r}AA = ${s}. What digit is A?`, A);
};
// ---- divisibility ----
const divisibility = (y) => {
  const kind = upper(y) ? ri(1, 3) : ri(1, 2);
  if (kind === 1) { const d = upper(y) ? pick([3, 4, 6, 9]) : pick([2, 3, 5, 10]); const right = d * ri(upper(y) ? 30 : 10, upper(y) ? 200 : 40); const wrongs = new Set(); while (wrongs.size < 4) { const w = right + pick([1, -1, 2, -2, 3, -3, 5, -5]); if (w % d !== 0 && w > 0) wrongs.add(w); } return mcOnly('divisibility', `Which of these numbers is divisible by ${d}?`, right, [...wrongs]); }
  if (kind === 2) { const d = pick([3, 9]), a = ri(1, 9), b = ri(0, 9), c = ri(0, 9), base = a * 100 + b * 10 + c; let x = 0; while ((sum(digitsOf(base)) + x) % d !== 0) x++; return int('divisibility', `What is the smallest digit that can go in the blank so that ${a}${b}${c}_ is divisible by ${d}?`, x); }
  const a = pick([3, 4, 5, 6]), b = pick([4, 6, 7, 8, 9]); if (a === b) return null; const l = (a * b) / gcd(a, b), n = pick([100, 200, 300]); return int('divisibility', `How many whole numbers from 1 to ${n} are divisible by both ${a} and ${b}?`, Math.floor(n / l));
};
// ---- patterns ----
const patterns = (y) => {
  const kind = upper(y) ? ri(1, 3) : ri(1, 2);
  if (kind === 1) { const s = ri(1, 12), k = ri(2, upper(y) ? 9 : 5), n = upper(y) ? ri(15, 40) : ri(8, 12); return int('number patterns', `${[s, s + k, s + 2 * k, s + 3 * k].join(', ')}, … What is the ${ord(n)} number in this pattern?`, s + (n - 1) * k); }
  if (kind === 2) { const k = ri(2, 4), n = ri(5, upper(y) ? 12 : 8); return withFigure(int('number patterns', `Figure 1 uses ${k + 1} dots, Figure 2 uses ${2 * k + 1}, Figure 3 uses ${3 * k + 1}, and the pattern continues. How many dots does Figure ${n} use?`, k * n + 1), table('Dots in each figure', ['Figure', 'Dots'], [[1, k + 1], [2, 2 * k + 1], [3, 3 * k + 1], [4, 4 * k + 1]])); }
  const n = ri(6, 12); return int('number patterns', `1, 4, 9, 16, 25, … What is the ${ord(n)} number in this pattern?`, n * n);
};
// ---- spatial visualisation ----
const spatial = (y) => {
  const kind = upper(y) ? ri(1, 3) : 1;
  if (kind === 1) { const n = upper(y) ? 3 : 2, h = {}; let total = 0; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const k = ri(1, upper(y) ? 4 : 3); h[`${r},${c}`] = String(k); total += k; } return withFigure(int('spatial visualisation', `Cubes are stacked in columns on a ${n} by ${n} board. The number in each square is the height of that column. How many cubes are there altogether?`, total), grid('Height of each column', n, n, h)); }
  if (kind === 2) { const n = pick([3, 4, 5]), what = pick([['exactly two faces painted', 12 * (n - 2)], ['exactly one face painted', 6 * (n - 2) * (n - 2)], ['exactly three faces painted', 8], ['no face painted', (n - 2) ** 3], ['at least two faces painted', 8 + 12 * (n - 2)]]); return int('spatial visualisation', `A large cube is painted red all over, then cut into ${n * n * n} small cubes (${n} by ${n} by ${n}). How many small cubes have ${what[0]}?`, what[1]); }
  const n = pick([3, 4, 5]); return int('spatial visualisation', `A ${n} by ${n} by ${n} cube is built from ${n ** 3} unit cubes, and then the 8 corner cubes are removed. What is the surface area of the shape that is left, in square units?`, 6 * n * n); // each corner cube exposes three faces and takes three away
};
// ---- logic ----
const logic = (y) => {
  const kind = ri(1, 3);
  if (kind === 1) { const w = names(3), pets = shuffle(['a cat', 'a dog', 'a fish']); return mcOnly('logic', `${w[0]}, ${w[1]} and ${w[2]} each have one pet: ${pets.slice().sort().join(', ')}. ${w[0]} does not have ${pets[1]} or ${pets[2]}. ${w[1]} does not have ${pets[2]}. Who has ${pets[2]}?`, w[2], [w[0], w[1], 'Cannot be told', 'Nobody']); }
  if (kind === 2) { const d = ri(0, 6), n = upper(y) ? ri(30, 100) : ri(8, 20); return mcOnly('logic', `Today is ${DAYS[d]}. What day of the week will it be in ${n} days?`, DAYS[(d + n) % 7], DAYS.filter((_, i) => i !== (d + n) % 7).slice(0, 4)); }
  const [a, b] = names(2), age = ri(6, 12), diff = ri(2, 6), yrs = ri(2, 8); return int('logic', `${a} is ${age} years old and ${b} is ${age + diff}. In ${yrs} years, what will their ages add up to?`, 2 * age + diff + 2 * yrs);
};
// ---- arithmetic and statistics ----
const stats = (y) => {
  if (!upper(y)) { const xs = Array.from({ length: 5 }, () => ri(2, 12)); const kind = ri(1, 2); if (kind === 1) return int('statistics', `Here are the numbers of goals five teams scored: ${xs.join(', ')}. What is the difference between the most and the fewest?`, Math.max(...xs) - Math.min(...xs)); const counts = {}; for (const x of xs) counts[x] = (counts[x] || 0) + 1; const top = Object.entries(counts).sort((p, q) => q[1] - p[1]); if (top.length > 1 && top[0][1] === top[1][1]) return null; return int('statistics', `Five children scored these marks in a quiz: ${xs.join(', ')}. Which mark appears most often?`, Number(top[0][0])); }
  const kind = ri(1, 3);
  if (kind === 1) { const n = ri(4, 6), avg = ri(10, 40), xs = Array.from({ length: n - 1 }, () => ri(avg - 9, avg + 9)), last = n * avg - sum(xs); if (last < 1) return null; return int('statistics', `The mean (average) of ${n} numbers is ${avg}. ${n - 1} of them are ${xs.join(', ')}. What is the remaining number?`, last); }
  if (kind === 2) { const xs = Array.from({ length: 5 }, () => ri(3, 40)).sort((p, q) => p - q); return int('statistics', `Find the median of ${shuffle(xs).join(', ')}.`, xs[2]); }
  const xs = Array.from({ length: 4 }, () => ri(5, 60)), t = sum(xs); if (t % 4 !== 0) return null; return int('statistics', `What is the mean (average) of ${xs.join(', ')}?`, t / 4);
};
// ---- geometry and mensuration ----
const geometry = (y) => {
  const kind = upper(y) ? ri(1, 4) : ri(1, 2);
  if (kind === 1) { const l = ri(3, upper(y) ? 30 : 12), w = ri(2, l - 1); return int('geometry', `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter, in cm?`, 2 * (l + w)); }
  if (kind === 2) { const l = ri(3, upper(y) ? 25 : 10), w = ri(2, l - 1); return int('geometry', `A rectangle is ${l} cm long and ${w} cm wide. What is its area, in cm²?`, l * w); }
  if (kind === 3) { const L = ri(8, 20), W = ri(6, 15), l = ri(2, L - 3), w = ri(2, W - 3); return int('geometry', `An L-shaped garden is a ${L} m by ${W} m rectangle with a ${l} m by ${w} m rectangle cut from one corner. What is its area, in m²?`, L * W - l * w); }
  const a = ri(25, 80), b = ri(20, 175 - a); return int('geometry', `In a triangle, two of the angles are ${a}° and ${b}°. What is the third angle, in degrees?`, 180 - a - b);
};
// ---- money, time and multi-step word problems ----
const money$ = (y) => {
  const kind = ri(1, 2), [w] = names(1);
  if (kind === 1) { const ad = pick([6, 8, 10, 12]), ch = pick([3, 4, 5]), na = ri(1, 3), nc = ri(1, 4), paid = pick([50, 60, 100]), cost = ad * na + ch * nc; if (cost >= paid) return null; return int('word problems', `Tickets cost ${money(ad)} for an adult and ${money(ch)} for a child. ${w}'s family of ${na} adult${na > 1 ? 's' : ''} and ${nc} child${nc > 1 ? 'ren' : ''} pays with ${money(paid)}. How much change do they get (in dollars)?`, paid - cost); }
  const price = ri(2, upper(y) ? 15 : 8), n = ri(3, upper(y) ? 12 : 6), had = price * n + ri(1, 20); return int('word problems', `${w} has ${money(had)} and buys ${n} ${thing()}s at ${money(price)} each. How much money is left (in dollars)?`, had - price * n);
};
const timeQ = () => { const h = ri(7, 11), m = pick([0, 15, 30, 45]), d = pick([45, 75, 90, 105, 120, 150]), e = h * 60 + m + d, hm = (t) => { const hh = Math.floor(t / 60); return `${hh > 12 ? hh - 12 : hh}:${String(t % 60).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`; }, took = [Math.floor(d / 60) ? `${Math.floor(d / 60)} h` : '', d % 60 ? `${d % 60} min` : ''].filter(Boolean).join(' '); return mcOnly('time', `A class trip leaves school at ${hm(h * 60 + m)} and the bus ride takes ${took}. When does it arrive?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 60), hm(e - 30)]); };
const fractionQ = (y) => { if (!upper(y)) { const d = pick([2, 3, 4, 5]), n = d * ri(2, 8); return int('fractions', `What is 1/${d} of ${n}?`, n / d); } const d = pick([4, 5, 6, 8, 10]), n1 = ri(1, d - 1), n2 = ri(1, d - n1); if (n1 + n2 >= d || gcd(n1, d) !== 1 || gcd(n2, d) !== 1) return null; return frac('fractions', `${names(1)[0]} ate ${n1}/${d} of a pizza and a friend ate ${n2}/${d}. What fraction of the pizza is left? Give it in its simplest form.`, d - n1 - n2, d); };
const numberSense = (y) => { if (!upper(y)) { const lo = ri(1, 8) * 10, s = ri(3, 15); const cands = []; for (let n = lo + 1; n < lo + 10; n++) if (sum(digitsOf(n)) === s) cands.push(n); if (cands.length !== 1) return null; return int('number sense', `A whole number is greater than ${lo} and less than ${lo + 10}. The sum of its two digits is ${s}. What is the number?`, cands[0]); } const a = ri(2, 9), b = ri(2, 9); return int('number sense', `The product of two whole numbers is ${a * b} and their sum is ${a + b}. What is the larger of the two numbers?`, Math.max(a, b)); };

// ---- the paper's tiers (built 20 Sep 2026 from the source check): the staples of the Info Pack's worked examples ----
const pm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} pm`;
const elapsed = () => { const s = ri(1, 8) * 60 + pick([0, 15, 30, 45]), d = ri(7, 35) * 5; return int('elapsed time', `A film starts at ${pm(s)} and ends at ${pm(s + d)}. How many minutes long is it?`, d); };
const symbols = () => { const [s1, s2] = shuffle(['♥', '▲', '★', '●', '■']).slice(0, 2), a = ri(3, 15), b = ri(1, a - 1); if (a === b) return null; if (ri(1, 2) === 1) return int('symbol equations', `${s1} + ${s1} + ${s2} = ${2 * a + b} and ${s1} + ${s2} = ${a + b}. Each symbol stands for one number. What number is ${s1}?`, a); return int('symbol equations', `${s1} + ${s2} = ${a + b} and ${s1} − ${s2} = ${a - b}. Each symbol stands for one number. What number is ${s1}?`, a); };
const commonMult = () => { const [p, q] = pick([[5, 7], [4, 6], [6, 8], [3, 8], [4, 9], [5, 6], [6, 9], [7, 8]]), l = (p * q) / gcd(p, q), N = l + ri(1, l - 1); return int('common multiples', `${names(1)[0]} has fewer than ${N} stickers. They can be put into packs of ${p} with none left over, and into packs of ${q} with none left over. How many stickers are there?`, l); };
const sums = (y) => { if (!upper(y) || ri(1, 2) === 1) { const n = upper(y) ? ri(10, 20) : ri(5, 10); return int('sums', `Sticks of lengths 1 cm, 3 cm, 5 cm, … up to ${2 * n - 1} cm are joined end to end in a line. How long is the whole line, in cm?`, n * n); } const n = pick([20, 30, 40, 50, 60, 100]); return int('sums', `What is 1 + 2 + 3 + … + ${n}?`, (n * (n + 1)) / 2); };
const sumSquares = (y) => { const n = upper(y) ? ri(5, 8) : ri(4, 6); return int('sum of squares', `Boxes are filled in a pattern: 1 apple in the first box, 4 in the second, 9 in the third, 16 in the fourth, and so on. How many apples are in the first ${n} boxes altogether?`, (n * (n + 1) * (2 * n + 1)) / 6); };
const rate = () => { const c1 = pick([2, 3, 4, 5]), t1 = pick([2, 3, 4, 5]), b1 = pick([2, 3, 4, 5, 6]), m = ri(2, 4), p = ri(2, 4), it = pick(['paper boats', 'paper cranes', 'sandwiches']); return int('rate', `${c1} children make ${b1} ${it} in ${t1} minutes, all working at the same pace. How many ${it} do ${c1 * m} children make in ${t1 * p} minutes?`, b1 * m * p); };
const wages = () => { const base = ri(5, 20) * 10, r = ri(6, 15), h1 = pick([20, 24, 25, 30]), h2 = h1 + pick([10, 16, 20]), h3 = h1 + pick([4, 5, 6, 8]); return int('wages', `A job pays a fixed amount plus the same amount for every hour worked. Working ${h1} hours earns ${money(base + r * h1)} and working ${h2} hours earns ${money(base + r * h2)}. How much does working ${h3} hours earn, in dollars?`, base + r * h3); };
const fracRemainder = () => { const d = pick([3, 4, 5, 6, 8, 10]), n = ri(1, d - 1), u = ri(5, 60); if (gcd(n, d) !== 1) return null; return int('fraction of a remainder', `After reading ${n}/${d} of a book, ${(d - n) * u} pages are left. How many pages does the book have?`, d * u); };
const marbleFractions = () => { const [d1, d2] = pick([[5, 2], [3, 4], [4, 6], [5, 4], [3, 5], [8, 4]]), n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1), L = (d1 * d2) / gcd(d1, d2), r = L - (n1 * L) / d1 - (n2 * L) / d2; if (r <= 0 || gcd(n1, d1) !== 1 || gcd(n2, d2) !== 1) return null; const u = ri(1, 6), [c1, c2, c3] = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 3); return int('fractions of a whole', `In a bag of marbles, ${n1}/${d1} are ${c1}, ${n2}/${d2} are ${c2} and the remaining ${r * u} are ${c3}. How many marbles are ${c1}?`, ((n1 * L) / d1) * u); };
const ratioTransfer = () => { const a = ri(1, 6), b = ri(a + 1, 9), u = ri(2, 20) * 2; if (gcd(a, b) !== 1) return null; const g = ((b - a) * u) / 2, [p, q] = names(2); return int('ratio with a transfer', `${p} and ${q} have money in the ratio ${a} : ${b}. After ${q} gives ${p} ${money(g)}, they have the same amount. How much do they have altogether, in dollars?`, (a + b) * u); };
const factorCount = () => { if (ri(1, 2) === 1) { const k = ri(3, 6); return int('factor count', `How many factors does ${(10 ** k).toLocaleString('en-US')} have, 1 and the number itself included?`, (k + 1) * (k + 1)); } const a = ri(1, 4), b = ri(1, 3); return int('factor count', `How many factors does ${2 ** a * 3 ** b} have, 1 and the number itself included?`, (a + 1) * (b + 1)); };
const digitArrange = () => { const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3).sort((p, q) => p - q), big = ds[2] * 100 + ds[1] * 10 + ds[0], small = ds[0] * 100 + ds[1] * 10 + ds[2]; return int('digit arrangements', `Using each of the digits ${shuffle(ds).join(', ')} exactly once, the largest three-digit number and the smallest three-digit number are made. What is the difference between them?`, big - small); };
const adjacentSums = () => { const a = ri(1, 9), b = ri(1, 9), c = ri(0, 9), n = ri(10, 40), row = [a, b, c]; return int('adjacent sums', `In a long row of digits, any three digits next to each other add up to ${a + b + c}. The first two digits are ${a} and ${b}. What is the ${ord(n)} digit in the row?`, row[(n - 1) % 3]); };
const gridSteps = () => { const x1 = ri(0, 6), y1 = ri(0, 6), x2 = ri(0, 12), y2 = ri(0, 12), d = Math.abs(x2 - x1) + Math.abs(y2 - y1); if (d < 3) return null; return int('grid steps', `A robot on a grid moves one square at a time — up, down, left or right. What is the fewest moves it needs to go from square (${x1}, ${y1}) to square (${x2}, ${y2})?`, d); };
const squareRects = () => { const s = pick([8, 12, 16, 20, 24]); return int('square into rectangles', `A square is cut into 4 identical rectangles by lines parallel to one of its sides. Each rectangle has a perimeter of ${(5 * s) / 2} cm. What is the area of the square, in cm²?`, s * s); };
const meanCount = () => { const n = pick([200, 300, 400, 500, 600]), mean = pick([1.5, 2.4, 2.5, 3.2, 4.5]), median = pick([1.2, 1.5, 2, 2.5]); if (median >= mean) return null; return int('mean and count', `${n} cards were sold at a fair. The mean price of a card was $${mean.toFixed(2)} and the median price was $${median.toFixed(2)}. How much money was taken altogether, in dollars?`, Math.round(n * mean)); };
const avgSpeed = () => { const [v1, v2] = pick([[30, 60], [40, 60], [60, 30], [60, 40], [20, 60], [60, 20], [30, 20], [20, 30], [12, 6], [6, 12]]), d = pick([60, 120, 180, 240]), avg = (2 * d) / (d / v1 + d / v2); if (!Number.isInteger(avg) || !Number.isInteger(d / v1) || !Number.isInteger(d / v2)) return null; return int('average speed', `A bus drives ${d} km from one town to another at ${v1} km/h and comes straight back the same way at ${v2} km/h. What is its average speed for the whole trip, in km/h?`, avg); };
const halving = () => { const k = ri(2, 5); return frac('halving', `A spray kills half of the germs on a surface each time it is used. After ${k} uses, what fraction of the germs has been killed? Give a fraction in its simplest form.`, 2 ** k - 1, 2 ** k); };
const compositePerimeter = () => { const L = ri(8, 20), W = ri(5, L - 1), l = ri(2, L - 3), w = ri(2, W - 3); return int('composite figures', `An L-shaped figure is made by cutting a ${l} cm by ${w} cm rectangle from one corner of a ${L} cm by ${W} cm rectangle. What is the perimeter of the L-shaped figure, in cm?`, 2 * (L + W)); };

// each kind with the tiers it may fill: Grades 2–4, then Grades 5–6 (an empty list keeps a kind out of that band)
const P = (cat, gen, low, up = low) => ({ cat, gen, low, up });
const POOL = [
  P('model method', model, ['M3', 'M5']), P('equal after giving', equalAfter, ['M5']), P('cryptarithm', crypt, ['M3', 'M5']), P('divisibility', divisibility, ['M3', 'M5']), P('number patterns', patterns, ['M3', 'M5']), P('spatial visualisation', spatial, ['M3', 'M5'], ['M5', 'M6']), P('logic', logic, ['M3', 'M5']), P('statistics', stats, ['M3', 'M5'], ['M5', 'M6']), P('geometry', geometry, ['M3', 'M5']), P('money', money$, ['M3', 'M5']), P('time', timeQ, ['M3']), P('fractions', fractionQ, ['M3'], ['M5']), P('number sense', numberSense, ['M3', 'M5']),
  P('elapsed time', elapsed, ['M3', 'M5'], ['M3']), P('symbol equations', symbols, ['M3', 'M5'], ['M3']), P('common multiples', commonMult, ['M5'], ['M3', 'M5']), P('sums', sums, ['M5', 'M6'], ['M3', 'M5']), P('sum of squares', sumSquares, ['M6'], ['M5', 'M6']), P('rate', rate, ['M5', 'M6'], ['M3', 'M5']), P('wages', wages, ['M6'], ['M5', 'M6']), P('fraction of a remainder', fracRemainder, ['M5'], ['M3', 'M5']), P('fractions of a whole', marbleFractions, [], ['M5', 'M6']), P('ratio with a transfer', ratioTransfer, [], ['M5', 'M6']), P('factor count', factorCount, [], ['M6']), P('digit arrangements', digitArrange, ['M5'], ['M3', 'M5']), P('adjacent sums', adjacentSums, [], ['M5', 'M6']), P('grid steps', gridSteps, ['M5'], ['M3']), P('square into rectangles', squareRects, ['M6'], ['M5', 'M6']), P('mean and count', meanCount, [], ['M6']), P('average speed', avgSpeed, [], ['M6']), P('halving', halving, [], ['M5', 'M6']), P('composite figures', compositePerimeter, ['M5'], ['M3']),
];
const pool = (y) => POOL.map((e) => ({ cat: e.cat, gen: e.gen, sections: upper(y) ? e.up : e.low })).filter((e) => e.sections.length);
// the real paper (SIU's AMO InfoPack): 25 questions in 90 minutes — fifteen 3-mark multiple choice of five options, then five
// 5-mark and five 6-mark open answers, typed. The 90 minutes are ours to split: 40 + 25 + 25 (the owner, 20 Sep 2026)
export const PHASES = [phase('alpha', 'Questions 1–15', 3, 40, slots([['M3', 'mc', 15]])), phase('beta', 'Questions 16–20', 5, 25, slots([['M5', 'sa', 5]])), phase('gamma', 'Questions 21–25', 6, 25, slots([['M6', 'sa', 5]]))];
export const build = (shape, year) => buildHeat(shape, pool(Math.max(2, year)), Math.max(2, year), { options: 5 });
export const TOPICS = [
  { band: 'Grades 2–4', lines: ['3 marks: the model method, cryptarithms, divisibility, patterns, elapsed time, symbol equations', '5 marks, typed: equal after giving, common multiples, fractions of a remainder, digit arrangements, grid steps', '6 marks, typed: sticks in a line, apples in boxes, children making boats, wages with a fixed part', 'five options, no “None of the above”; from Year 2, as the real paper'] },
  { band: 'Grades 5–6', lines: ['3 marks: fractions of a remainder, rates, sums, digit arrangements, L-shaped perimeters', '5 marks, typed: marbles by fractions, a ratio with a transfer, adjacent sums, painted cubes, a spray that halves the germs', '6 marks, typed: the factors of a million, mean times count, average speed there and back', 'squares cut into rectangles, wages with a fixed part, apples in boxes'] },
];
