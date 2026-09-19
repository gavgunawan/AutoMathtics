// 🦅 US-MOON — practice modelled on AMO (the American Mathematics Olympiad, SIMCC with Southern Illinois University); not
// affiliated. The real paper is US Common Core content delivered through the Singapore model method, with a non-routine
// strand that names cryptarithms, divisibility tests, number patterns, spatial visualisation and logic. AMO starts at Grade 2,
// so this moon opens at Year 2; the syllabus is banded 2–4 and 5–6, and so are these generators. A heat is six multiple-choice
// questions with five options and four short answers (olympia-research.md §4).
import { ri, pick, shuffle, sum, names, thing, money, int, frac, mcOnly, withFigure, grid, table, buildHeat, slots, digitsOf, gcd, cap } from './common.mjs';

const upper = (y) => y >= 5;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---- word problems by the model method ----
const model = (y) => {
  const kind = upper(y) ? ri(1, 4) : ri(1, 2), [a, b] = names(2), it = thing();
  if (kind === 1) { const small = ri(y <= 3 ? 3 : 8, y <= 3 ? 15 : 40), d = ri(2, y <= 3 ? 8 : 20); return int('model method', `${a} and ${b} have ${2 * small + d} ${it}s altogether. ${a} has ${d} more than ${b}. How many ${it}s does ${b} have?`, small); }
  if (kind === 2) { const k = ri(2, y <= 3 ? 3 : 5), u = ri(2, y <= 3 ? 9 : 15); return int('model method', `${a} has ${k} times as many ${it}s as ${b}. Together they have ${(k + 1) * u}. How many ${it}s does ${a} have?`, k * u); }
  if (kind === 3) { const d = pick([5, 7, 8, 9]), n = ri(3, d - 1), diff = 2 * n - d, u = ri(2, 12); if (diff <= 0) return null; return int('model method', `In a class, ${n}/${d} of the pupils are girls. There are ${diff * u} more girls than boys. How many pupils are in the class?`, d * u); }
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
  if (kind === 1) { const s = ri(1, 12), k = ri(2, upper(y) ? 9 : 5), n = upper(y) ? ri(15, 40) : ri(8, 12); return int('number patterns', `${[s, s + k, s + 2 * k, s + 3 * k].join(', ')}, … What is the ${n}th number in this pattern?`, s + (n - 1) * k); }
  if (kind === 2) { const k = ri(2, 4), n = ri(5, upper(y) ? 12 : 8); return withFigure(int('number patterns', `Figure 1 uses ${k + 1} dots, Figure 2 uses ${2 * k + 1}, Figure 3 uses ${3 * k + 1}, and the pattern continues. How many dots does Figure ${n} use?`, k * n + 1), table('Dots in each figure', ['Figure', 'Dots'], [[1, k + 1], [2, 2 * k + 1], [3, 3 * k + 1], [4, 4 * k + 1]])); }
  const n = ri(6, 12); return int('number patterns', `1, 4, 9, 16, 25, … What is the ${n}th number in this pattern?`, n * n);
};
// ---- spatial visualisation ----
const spatial = (y) => {
  const kind = upper(y) ? ri(1, 3) : ri(1, 2);
  if (kind === 1) { const n = upper(y) ? 3 : 2, h = {}; let total = 0; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const k = ri(1, upper(y) ? 4 : 3); h[`${r},${c}`] = String(k); total += k; } return withFigure(int('spatial visualisation', `Cubes are stacked in columns on a ${n} by ${n} board. The number in each square is the height of that column. How many cubes are there altogether?`, total), grid('Height of each column', n, n, h)); }
  if (kind === 2) return solids();
  const n = pick([3, 4, 5]), what = pick([['exactly two faces painted', 12 * (n - 2)], ['exactly one face painted', 6 * (n - 2) * (n - 2)], ['exactly three faces painted', 8], ['no face painted', (n - 2) ** 3]]); return int('spatial visualisation', `A large cube is painted red all over, then cut into ${n * n * n} small cubes (${n} by ${n} by ${n}). How many small cubes have ${what[0]}?`, what[1]);
};
const solids = () => { const c = pick([['How many edges does a cube have?', '12', ['6', '8', '10', '24']], ['How many faces does a cube have?', '6', ['4', '8', '12', '9']], ['How many vertices (corners) does a cube have?', '8', ['6', '12', '4', '10']], ['How many faces does a square-based pyramid have?', '5', ['4', '6', '8', '3']], ['How many edges does a triangular prism have?', '9', ['6', '8', '12', '5']]]); return mcOnly('spatial visualisation', c[0], c[1], c[2]); };
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
const timeQ = () => { const h = ri(7, 11), m = pick([0, 15, 30, 45]), d = pick([45, 75, 90, 105, 120, 150]), e = h * 60 + m + d, hm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, took = [Math.floor(d / 60) ? `${Math.floor(d / 60)} h` : '', d % 60 ? `${d % 60} min` : ''].filter(Boolean).join(' '); return mcOnly('time', `A class trip leaves school at ${hm(h * 60 + m)} and the bus ride takes ${took}. When does it arrive?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 60), hm(e - 30)]); };
const fractionQ = (y) => { if (!upper(y)) { const d = pick([2, 3, 4, 5]), n = d * ri(2, 8); return int('fractions', `What is 1/${d} of ${n}?`, n / d); } const d = pick([4, 5, 6, 8, 10]), n1 = ri(1, d - 1), n2 = ri(1, d - n1); if (n1 + n2 >= d) return null; return frac('fractions', `${names(1)[0]} ate ${n1}/${d} of a pizza and a friend ate ${n2}/${d}. What fraction of the pizza is left? Give it in its simplest form.`, d - n1 - n2, d); };
const numberSense = (y) => { if (!upper(y)) { const lo = ri(1, 8) * 10, s = ri(3, 15); const cands = []; for (let n = lo + 1; n < lo + 10; n++) if (sum(digitsOf(n)) === s) cands.push(n); if (cands.length !== 1) return null; return int('number sense', `A whole number is greater than ${lo} and less than ${lo + 10}. The sum of its two digits is ${s}. What is the number?`, cands[0]); } const a = ri(2, 9), b = ri(2, 9); return int('number sense', `The product of two whole numbers is ${a * b} and their sum is ${a + b}. What is the larger of the two numbers?`, Math.max(a, b)); };

const POOL_LOW = [['model method', model], ['equal after giving', equalAfter], ['cryptarithm', crypt], ['divisibility', divisibility], ['number patterns', patterns], ['spatial visualisation', spatial], ['solids', solids], ['logic', logic], ['statistics', stats], ['geometry', geometry], ['money', money$], ['time', timeQ], ['fractions', fractionQ], ['number sense', numberSense]];
const pool = () => POOL_LOW.map(([cat, gen]) => ({ cat, gen }));
const SHAPE = slots([['MC', 'mc', 6], ['SA', 'sa', 4]]);
export const heat = (year) => buildHeat(SHAPE, pool(), Math.max(2, year), { options: 5 });
export const TOPICS = [
  { band: 'Grades 2–4', lines: ['word problems by the model method: more than, times as many', 'cryptarithms: a letter stands for a digit', 'divisibility by 2, 3, 5 and 10; number patterns', 'cubes in a stack, solids, logic and money'] },
  { band: 'Grades 5–6', lines: ['fractions and equal-after-giving by the model method', 'divisibility by 3, 4, 6 and 9; the n-th term; square numbers', 'painted cubes, the day in n days, mean and median', 'L-shaped areas, angles in a triangle, fractions left'] },
];
