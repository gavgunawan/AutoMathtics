// 🦁 SG-MOON — practice modelled on SMC (the Singapore Math Challenge, SIMCC); not affiliated. The real paper is the Singapore
// primary syllabus almost verbatim plus "heuristics skills" at every grade: bar models, before-and-after, guess and check,
// working backwards, remainders, making a list. Its word problems are the Singapore-standard ones that were Navigator until
// 19 Sep 2026 (singapore.mjs, one pool per year), joined here by the heuristics. The published 2023 papers (one a grade,
// 32–45 questions in 90 minutes, no key) are almost all short answer written on an answer sheet, with a few four-option items
// at Grades 2–4 and none at 5–6, and a fraction appears only as an option, never typed — so a heat is two multiple-choice and
// eight short-answer questions, brisker than the other moons (2–2.8 minutes a question there; the source check of 20 Sep 2026
// corrected olympia-research.md §3, whose "15 MC + 16 SA" matched no published paper).
import { ri, pick, shuffle, sum, names, thing, money, int, dec, frac, mcOnly, buildHeat, slots, cap, gcd } from './common.mjs';
import { genSingapore } from '../singapore.mjs';

// a Singapore-standard word problem for the year, as a seed: the module's own choices stay its choices
const syllabus = (y) => {
  for (let t = 0; t < 8; t++) {
    const q = genSingapore(y - 1, ri(2, 5)); if (!q || !q.display) continue;
    const s = { cat: 'syllabus word problem', text: q.display.text, read: q.read, ...(q.display.figure ? { figure: q.display.figure } : {}) };
    if (q.answer.type === 'choice') return { ...s, answer: null, right: q.display.choices[q.answer.v], decoys: q.display.choices.filter((_, i) => i !== q.answer.v), mcOnly: true };
    return { ...s, answer: q.answer, ...(q.answer.type === 'frac' ? { mcOnly: true } : {}) }; // a fraction is only ever an option on the real paper
  }
  return null;
};
// ---- heuristics ----
const listing = (y) => {
  if (y <= 2) { const k = ri(2, 3), n = ri(4, 6); return int('systematic listing', `${names(1)[0]} builds towers of blocks. The 1st tower uses ${k} blocks, the 2nd uses ${2 * k}, the 3rd uses ${3 * k}, and the pattern continues. How many blocks are needed altogether for the first ${n} towers?`, (k * n * (n + 1)) / 2); }
  if (y <= 4) { const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3).sort(); return int('systematic listing', `How many different two-digit numbers can be made from the digits ${ds.join(', ')}, using each digit at most once in a number?`, 6); }
  const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4).sort(); return int('systematic listing', `How many different three-digit numbers can be made from the digits ${ds.join(', ')}, using each digit at most once in a number?`, 24);
};
const beforeAfter = (y) => {
  const [a, b] = names(2), it = thing();
  if (y <= 2) { const x = ri(3, 12), g = ri(1, 5), had = ri(1, 12); return int('before and after', `${a} had ${x + g} ${it}s and ${b} had ${had}. ${a} gave ${g} ${it}${g > 1 ? 's' : ''} to ${b}. How many ${it}s does ${b} have now?`, had + g); }
  const k = pick([2, 3]), x = ri(4, 20) * 2, g = (k - 1) * (x / 2); return int('before and after', `${a} had ${k} times as many ${it}s as ${b}. After ${a} gave ${b} ${g} ${it}s, they had the same number. How many ${it}s did ${a} have at first?`, k * x);
};
const guessCheck = (y) => {
  if (y <= 2) { const c = ri(2, 6), r = ri(1, 5); return int('guess and check', `A farmer has some chickens and rabbits: ${c + r} heads and ${2 * c + 4 * r} legs. How many rabbits are there?`, r); }
  const c = ri(3, 15), r = ri(2, 12), [one, other, a, b, part] = pick([['chickens', 'rabbits', 2, 4, 'legs'], ['bicycles', 'tricycles', 2, 3, 'wheels'], ['spiders', 'ants', 8, 6, 'legs']]);
  return int('guess and check', `There are ${c + r} ${one} and ${other} altogether, with ${c * a + r * b} ${part} in all. How many ${other} are there?`, r);
};
const workBack = (y) => {
  const [w] = names(1), it = thing();
  if (y <= 2) { const first = ri(5, 20), a = ri(2, 7), g = ri(2, 9); return int('working backwards', `${w} had some ${it}s. ${w} gave ${a} away and then got ${g} more. Now ${w} has ${first - a + g}. How many ${it}s did ${w} have at first?`, first); }
  if (y <= 4) { const first = ri(8, 40), k = pick([2, 3]), a = ri(2, 12); return int('working backwards', `A number is multiplied by ${k}, then ${a} is subtracted. The result is ${first * k - a}. What is the number?`, first); }
  const first = ri(10, 60), k = pick([2, 3, 4]), a = ri(2, 20), d = pick([2, 5]); const inner = first * k + a; if (inner % d !== 0) return null; return int('working backwards', `A number is multiplied by ${k}, ${a} is added, and the result is divided by ${d} to give ${inner / d}. What is the number?`, first);
};
const remainderFrac = () => { const [w] = names(1), [f1, f2, mult] = pick([['1/3', '1/4', 2], ['1/4', '1/3', 2], ['1/2', '1/3', 3], ['2/5', '1/3', 5 / 2]]), c = mult === 5 / 2 ? ri(4, 20) * 2 : ri(5, 60); return int('fraction of a remainder', `${w} spent ${f1} of ${w}'s money on a book, then ${f2} of the remainder on a pen. ${w} had ${money(c)} left. How much money did ${w} have at first (in dollars)?`, c * mult); };
const gapDiff = (y) => { const small = ri(y <= 2 ? 2 : 5, y <= 2 ? 10 : y <= 4 ? 40 : 200), d = ri(2, y <= 2 ? 6 : y <= 4 ? 12 : 60); return int('sum and difference', `The sum of two numbers is ${2 * small + d} and their difference is ${d}. What is the bigger number?`, small + d); };
const units = (y) => {
  const kind = ri(1, 3);
  if (kind === 1) { const a = ri(2, 5), b = ri(a + 1, 9), u = ri(3, 15); if (gcd(a, b) !== 1) return null; return int('ratio', `The ratio of boys to girls in a club is ${a} : ${b}. There are ${u * (b - a)} more girls than boys. How many children are in the club?`, u * (a + b)); }
  if (kind === 2) { const t = pick([40, 60, 80, 120, 150, 200]), p = pick([10, 20, 25, 30, 40, 50, 60, 75].filter((x) => (t * x) % 100 === 0)); return int('percentage', `${p}% of the ${t} pupils in a hall wear glasses. How many pupils do not wear glasses?`, t - (t * p) / 100); }
  const price = pick([20, 40, 50, 80, 120]), off = pick([10, 20, 25, 30, 50].filter((x) => (price * x) % 100 === 0)); return int('percentage', `A shirt costs ${money(price)}. It is sold at a discount of ${off}%. What is the discount, in dollars?`, (price * off) / 100);
};
const geometry = (y) => {
  const kind = y <= 4 ? ri(1, 2) : ri(1, 4);
  if (kind === 1) { const l = ri(4, y <= 2 ? 10 : 30), w = ri(2, l); return int('perimeter', `A rectangle is ${l} cm by ${w} cm. What is its perimeter, in cm?`, 2 * (l + w)); }
  if (kind === 2) { const s = ri(3, 12); return int('area', `A square has sides of ${s} cm. What is its area, in cm²?`, s * s); }
  if (kind === 3) { const a = ri(30, 100), b = ri(20, 170 - a); return int('angles', `In a triangle, two angles are ${a}° and ${b}°. Find the third angle, in degrees.`, 180 - a - b); }
  const r = pick([7, 14, 21, 28]); return int('circles', `Taking π as 22/7, find the circumference of a circle with radius ${r} cm, in cm.`, 2 * (22 / 7) * r);
};
const placeValue = (y) => {
  const kind = ri(1, 3);
  if (y <= 2) { if (kind === 1) { const t = ri(1, 9), o = ri(0, 9); return int('numbers to 100', `What number is ${t} tens and ${o} ones?`, t * 10 + o); } if (kind === 2) { const n = ri(20, y === 1 ? 99 : 999); return int('numbers', `What number is 1 more than ${n}?`, n + 1); } const w = names(5), k = ri(1, 5), ords = ['1st', '2nd', '3rd', '4th', '5th']; return mcOnly('ordinal numbers', `Five children stand in a line, from the left: ${w.join(', ')}. Who is ${ords[k - 1]} from the right?`, w[5 - k], w.filter((_, i) => i !== 5 - k)); }
  if (kind === 1) { const n = ri(1000, 9999), d = String(n)[ri(0, 3)]; return int('place value', `In the number ${n}, what is the value of the digit ${d} in the ${['thousands', 'hundreds', 'tens', 'ones'][String(n).indexOf(d)]} place?`, Number(d) * [1000, 100, 10, 1][String(n).indexOf(d)]); }
  if (kind === 2) { const n = ri(1000, 9999), to = pick([10, 100, 1000]); return int('rounding', `Round ${n} to the nearest ${to}.`, Math.round(n / to) * to); }
  const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4); return int('place value', `What is the largest four-digit number that can be made with the digits ${ds.join(', ')}, each used once?`, Number([...ds].sort((a, b) => b - a).join('')));
};
const timeMoney = (y) => {
  const kind = ri(1, 2);
  if (kind === 1) { const h = ri(1, 10), m = pick([0, 15, 30, 45]), d = y <= 2 ? pick([30, 60]) : pick([25, 40, 45, 70, 95]), e = h * 60 + m + d, hm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; return mcOnly('time', `A lesson starts at ${hm(h * 60 + m)} and lasts ${d} minutes. When does it end?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 60)]); }
  const coins = y <= 2 ? [[50, ri(1, 4)], [20, ri(1, 4)], [10, ri(1, 5)]] : [[100, ri(1, 3)], [50, ri(1, 4)], [20, ri(1, 4)], [5, ri(1, 6)]]; const total = sum(coins.map(([v, n]) => v * n)); return dec('money', `${names(1)[0]} has ${coins.map(([v, n]) => `${n} ${v === 100 ? '$1' : `${v}-cent`} coin${n > 1 ? 's' : ''}`).join(', ').replace(/, ([^,]*)$/, ' and $1')}. How much money is that, in dollars?`, total / 100);
};
const fractionsQ = (y) => {
  if (y <= 2) { const d = pick([2, 4]), n = d * ri(2, 6); return int('fractions', `${names(1)[0]} has ${n} ${thing()}s and gives ${d === 2 ? 'half' : 'a quarter'} of them away. How many are given away?`, n / d); }
  if (y <= 4) { const d = pick([3, 4, 5, 6, 8]), a = ri(1, d - 2), b = ri(1, d - a - 1); return frac('fractions', `What is ${a}/${d} + ${b}/${d}? Give your answer in its simplest form.`, a + b, d, { mcOnly: true }); } // a fraction is only ever an option on the real paper
  const d1 = pick([2, 3, 4]), d2 = pick([3, 4, 6]), n1 = 1, n2 = 1; if (d1 === d2) return null; const n = n1 * d2 + n2 * d1, d = d1 * d2; if (n >= d) return null; return frac('fractions', `What is 1/${d1} + 1/${d2}? Give your answer in its simplest form.`, n, d, { mcOnly: true });
};
const graphs = (y) => syllabus(y); // the syllabus pool draws bar, pie, table and line questions of its own

const POOL = (y) => [['syllabus', syllabus], ['syllabus 2', syllabus], ['listing', listing], ['before and after', beforeAfter], ['guess and check', guessCheck], ['working backwards', workBack], ['sum and difference', gapDiff], ['geometry', geometry], ['place value', placeValue], ['time and money', timeMoney], ['fractions', fractionsQ],
  ...(y >= 5 ? [['fraction of a remainder', remainderFrac], ['ratio and percentage', units]] : []), ...(y >= 3 ? [['graphs', graphs]] : [])].map(([cat, gen]) => ({ cat, gen }));
const SHAPE = slots([['MC', 'mc', 2], ['SA', 'sa', 8]]);
export const heat = (year) => buildHeat(SHAPE, POOL(year), year, { options: 4 });
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['numbers to 100 and 1000, tens and ones, ordinal numbers', 'towers and lists, chickens and rabbits, working backwards', 'halves and quarters, coins, the time a lesson ends', 'the Singapore-standard word problems on measures and graphs'] },
  { band: 'Grades 3–4', lines: ['two-digit numbers from given digits, sum and difference', 'before-and-after with times as many', 'adding fractions with the same bottom, perimeter and area', 'bar charts, tables and line graphs'] },
  { band: 'Grades 5–6', lines: ['fraction of a remainder, ratio and percentage', 'place value and rounding to the thousand', 'angles in a triangle and the circumference of a circle', 'unlike fractions, and the syllabus word problems at their hardest'] },
];
