// 🦁 SG-MOON — practice modelled on SMC (the Singapore Math Challenge, SIMCC); not affiliated. The real paper is the Singapore
// primary syllabus almost verbatim plus "heuristics skills" at every grade: bar models, before-and-after, guess and check,
// working backwards, remainders, making a list. Its word problems are the Singapore-standard ones that were Navigator until
// 19 Sep 2026 (singapore.mjs, one pool per year), joined here by the heuristics. The published 2023 papers (one a grade,
// 32–45 questions in 90 minutes, no key) are almost all short answer written on an answer sheet, with a few four-option items
// at Grades 2–4 and none at 5–6, and a fraction appears only as an option, never typed — so a heat is two multiple-choice and
// eight short-answer questions, brisker than the other moons (2–2.8 minutes a question there; the source check of 20 Sep 2026
// corrected olympia-research.md §3, whose "15 MC + 16 SA" matched no published paper). The papers climb — two-mark openers,
// three-mark middles, four- and five-mark closers — so the heat is five two-mark questions (the two multiple choice among
// them), three three-mark and two four-mark, every kind tagged with the tiers it may fill in each band; the kinds after "the
// paper's tiers" are the staples of the 2023 papers the first build lacked (20 Sep 2026).
import { ri, pick, shuffle, sum, names, thing, money, int, dec, frac, mcOnly, withFigure, bars, buildHeat, slots, cap, gcd, lcm, digitsOf } from './common.mjs';
import { genSingapore } from '../singapore.mjs';

const band = (y) => (y <= 2 ? 1 : y <= 4 ? 2 : 3);

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
  const c = ri(3, 15), r = ri(2, 12), [one, other, a, b, part] = pick([['chickens', 'rabbits', 2, 4, 'legs'], ['bicycles', 'tricycles', 2, 3, 'wheels'], ['spiders', 'ants', 8, 6, 'legs'], ['small taxis', 'big taxis', 4, 6, 'seats']]);
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
const units = () => {
  const kind = ri(1, 3);
  if (kind === 1) { const a = ri(2, 5), b = ri(a + 1, 9), u = ri(3, 15); if (gcd(a, b) !== 1) return null; return int('ratio', `The ratio of boys to girls in a club is ${a} : ${b}. There are ${u * (b - a)} more girls than boys. How many children are in the club?`, u * (a + b)); }
  if (kind === 2) { const t = pick([40, 60, 80, 120, 150, 200]), p = pick([10, 20, 25, 30, 40, 50, 60, 75].filter((x) => (t * x) % 100 === 0)); return int('percentage', `${p}% of the ${t} pupils in a hall wear glasses. How many pupils do not wear glasses?`, t - (t * p) / 100); }
  const price = pick([20, 40, 50, 80, 120]), off = pick([10, 20, 25, 30, 50].filter((x) => (price * x) % 100 === 0)); return int('percentage', `A shirt costs ${money(price)}. It is sold at a discount of ${off}%. What is the discount, in dollars?`, (price * off) / 100);
};
// the papers' figures are composite: a bent wire, a length three times its breadth, an L-shape, a quarter circle with π = 3.14
const geometry = (y) => {
  const b = band(y), kind = b === 1 ? ri(1, 2) : b === 2 ? ri(1, 3) : ri(1, 5);
  if (b === 1) { if (kind === 1) { const s = ri(3, 12); return int('coins round a square', `${4 * (s - 1)} coins are placed to form a square, with the same number of coins along each side and one coin at each corner. How many coins are along each side?`, s); } const l = ri(4, 12), w = ri(2, l - 1); return int('perimeter', `A rectangle is ${l} cm by ${w} cm. What is its perimeter, in cm?`, 2 * (l + w)); }
  if (kind === 1) { const w = ri(3, 12), k = pick([2, 3, 4]); return int('length and breadth', `The length of a rectangle is ${k} times its breadth. Its perimeter is ${2 * (k + 1) * w} cm. What is its area, in cm²?`, k * w * w); }
  if (kind === 2) { const L = ri(8, 25), W = ri(6, 20), l = ri(2, L - 3), w = ri(2, W - 3); return int('composite figures', `An L-shaped figure is a ${L} cm by ${W} cm rectangle with a ${l} cm by ${w} cm rectangle cut from one corner. What is its area, in cm²?`, L * W - l * w); }
  if (kind === 3) { const total = pick([100, 120, 160, 200, 240]), s1 = ri(5, total / 4 - 5), rest = total - 4 * s1; if (rest % 4) return null; return int('composite figures', `A wire ${total} cm long is cut into two pieces. Each piece is bent into a square. One square has sides of ${s1} cm. How long is each side of the other square, in cm?`, rest / 4); }
  if (kind === 4) { const a = ri(30, 100), c = ri(20, 170 - a); return int('angles', `In a triangle, two angles are ${a}° and ${c}°. Find the third angle, in degrees.`, 180 - a - c); }
  if (ri(1, 2) === 1) { const r = pick([5, 10, 20]); return dec('circles', `Taking π as 3.14, find the area of a circle with radius ${r} cm, in cm².`, 3.14 * r * r); } const r = pick([10, 20]); return dec('circles', `Taking π as 3.14, find the area of a quarter circle with radius ${r} cm, in cm².`, (3.14 * r * r) / 4);
};
// digit puzzles, as the papers ask them: pages that carry a digit, the largest number from given digits, the smallest with a digit sum
const digitsQ = (y) => {
  const b = band(y), kind = b === 1 ? ri(1, 2) : ri(1, 3);
  if (b === 1 && kind === 1) { const w = names(5), k = ri(1, 5), ords = ['1st', '2nd', '3rd', '4th', '5th']; return mcOnly('ordinal numbers', `Five children stand in a line, from the left: ${w.join(', ')}. Who is ${ords[k - 1]} from the right?`, w[5 - k], w.filter((_, i) => i !== 5 - k)); }
  if (kind === 1 || b === 1) { const d = ri(1, 9), n = b === 1 ? pick([30, 40, 50]) : pick([100, 120, 150, 200]); let c = 0; for (let k = 1; k <= n; k++) if (digitsOf(k).includes(d)) c++; return int('digit puzzles', `A book has pages numbered 1 to ${n}. How many page numbers contain the digit ${d}?`, c); }
  if (kind === 2) { const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4); return int('digit puzzles', `What is the largest four-digit number that can be made with the digits ${ds.join(', ')}, each used once?`, Number([...ds].sort((p, q) => q - p).join(''))); }
  const s = ri(10, 27), n = pick([3, 4]); let k = 10 ** (n - 1); while (sum(digitsOf(k)) !== s) k++; return int('digit puzzles', `What is the smallest ${n}-digit number whose digits add up to ${s}?`, k);
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

// ---- the paper's tiers (20 Sep 2026): the staples of the 2023 papers ----
const graphMoney = (y) => { const labels = ['Mon', 'Tue', 'Wed', 'Thu'], vals = labels.map(() => ri(3, band(y) === 3 ? 30 : 12) * 5), price = pick([2, 3, 4, 5, 8]), i = ri(0, 3), f = bars('Tickets sold', null, labels.map((l, k) => [l, vals[k]])); if (ri(1, 2) === 1) return withFigure(int('graphs', `The bar graph shows the tickets a museum sold on four days. Each ticket costs ${money(price)}. How much money did the museum take on ${labels[i]}, in dollars?`, price * vals[i]), f); return withFigure(int('graphs', `The bar graph shows the tickets a museum sold on four days. Each ticket costs ${money(price)}. How much money did the museum take over the four days altogether, in dollars?`, price * sum(vals)), f); };
const changeFromNotes = () => { const [n, v] = pick([[2, 50], [1, 50], [3, 10], [2, 20], [1, 100]]), paid = n * v, cents = ri(105, paid * 100 - 5), cost = cents / 100; return dec('money', `${names(1)[0]} buys a book for $${cost.toFixed(2)} and pays with ${n === 1 ? 'a' : n} $${v} note${n > 1 ? 's' : ''}. How much change is there, in dollars?`, (paid * 100 - cents) / 100); };
const bulkDeal = (y) => { const k = pick([3, 4, 5, 6]), p = ri(2, 9), n = k * ri(2, band(y) === 1 ? 4 : 8); return int('price lists', `${cap(thing())}s are sold at ${k} for ${money(p)}. How much do ${n} cost, in dollars?`, (n / k) * p); };
const spacing = () => { const n = ri(4, 8), w = pick([20, 25, 30, 35, 40, 50]), g = pick([15, 25, 40, 60, 75, 100, 125]); return int('spacing', `${n} bins, each ${w} cm wide, stand in a row with equal gaps between them. The row is ${n * w + (n - 1) * g} cm long from the left edge of the first bin to the right edge of the last. How wide is each gap, in cm?`, g); };
const twoQuantities = () => { const a = ri(30, 150), b = ri(10, 60), n1 = pick([3, 4, 5]), n2 = ri(1, n1 - 1), [x, z] = pick([['wallet', 'pouch'], ['tray', 'dish'], ['case', 'brush'], ['crate', 'box']]); return int('units and parts', `A ${x} and ${n1} ${z}es cost ${money(a + n1 * b)}. The same ${x} and ${n2} ${z}${n2 > 1 ? 'es' : ''} cost ${money(a + n2 * b)}. How much does the ${x} cost, in dollars?`, a); };
const shortOf = () => { const price = ri(6, 40) * 10, n1 = ri(3, 6), n2 = n1 + ri(2, 5), had = price * n1 + ri(1, 9) * 20, left = had - price * n1, short = price * n2 - had; if (short <= 0) return null; return int('units and parts', `${names(1)[0]} has just enough money to buy ${n1} cookies with ${left} cents left over, but would be ${short} cents short of buying ${n2} cookies. What is the price of a cookie, in cents?`, price); };
const permutations = () => { const n = pick([3, 4]), what = pick(['stand in a row for a photo', 'sit in a row on a bench', 'line up at a counter']); return int('permutations', `In how many different orders can ${n} friends ${what}?`, n === 3 ? 6 : 24); };
const cycleStars = (y) => { const b = band(y), cols = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 3), pat = [cols[0], cols[0], cols[1], cols[2]], n = b === 1 ? ri(12, 40) : b === 2 ? ri(30, 120) : ri(200, 999), ask = ri(0, 2), count = Math.floor(n / 4) * (ask === 0 ? 2 : 1) + pat.slice(0, n % 4).filter((c) => c === cols[ask]).length; return int('repeating patterns', `A row of ${n} stars is coloured in a repeating pattern: ${pat.join(', ')}, ${pat.join(', ')}, and so on. How many ${cols[ask]} stars are there?`, count); };
const agesQ = () => { const k = pick([3, 4, 5, 6]), x = ri(4, 12); return int('ages', `A mother is ${k} times as old as her ${pick(['son', 'daughter'])}. Their ages add up to ${(k + 1) * x}. How old is the child?`, x); };
const ratioChange = () => { const a = ri(2, 6), b = ri(1, 6), u = ri(6, 30), p = ri(2, a * u - 4), q = ri(2, 40); if (gcd(a, b) !== 1 || a === b) return null; const m2 = a * u - p, w2 = b * u + q, g = gcd(m2, w2); if (g < 4 || m2 * b === w2 * a) return null; return int('ratio with a change', `The ratio of men to women in a club was ${a} : ${b}. After ${p} men left and ${q} women joined, the ratio became ${m2 / g} : ${w2 / g}. How many men were in the club at first?`, a * u); };
const avgLeavers = () => { const n = ri(6, 15), avg1 = ri(20, 60) * 5, avg2 = avg1 - ri(3, 20) * 5; return int('averages', `${n} pupils have ${money(avg1)} each on average. Two of them lose all their money, and the average for all ${n} pupils becomes ${money(avg2)}. How much money was lost altogether, in dollars?`, n * (avg1 - avg2)); };
const discountGST = () => { const p = pick([200, 400, 500, 800, 1000, 1500, 2000, 2500]), d = pick([10, 15, 20, 25, 30]), g = pick([5, 8, 9, 10]), v = (p * (100 - d) * (100 + g)) / 10000; if (!Number.isInteger(v)) return null; return int('discount and tax', `A laptop is priced at ${money(p)}. In a sale ${d}% is taken off, then ${g}% tax is added to the sale price. What is the final price, in dollars?`, v); };
const workTogether = () => { const [t1, t2, h] = pick([[6, 3, 2], [4, 4, 2], [6, 12, 4], [10, 15, 6], [4, 12, 3], [8, 8, 4], [5, 20, 4], [12, 6, 4], [3, 6, 2]]); return int('work rate', `Robot A can paint a wall in ${t1} hours and robot B can paint the same wall in ${t2} hours. Working together at the same rates, how many minutes do they take to paint the wall?`, h * 60); };
const shelvesLCM = () => { const [a, b, c] = pick([[4, 5, 7], [3, 4, 5], [4, 6, 9], [5, 6, 8], [3, 5, 7], [6, 8, 10]]), l = lcm(lcm(a, b), c), k = ri(2, Math.max(2, Math.floor(999 / l))), lo = Math.floor((k * l) / 100) * 100, hi = lo + 100; if (k * l > 999 || Math.floor(hi / l) - Math.floor(lo / l) !== 1 || (k * l) % 100 === 0) return null; return int('common multiples', `A library has between ${lo} and ${hi} books. They can be arranged on shelves of ${a}, of ${b} or of ${c} with none left over. How many books are there?`, k * l); };
const fruitRatio = () => { const a = ri(2, 9), b = ri(2, 9), p = pick([2, 3, 4, 5]), q = pick([2, 3, 4, 5]); if (gcd(a, b) !== 1 || a === b) return null; const u = lcm(p, q) * ri(2, 12), rotten = (a * u) / p + (b * u) / q; if (!Number.isInteger(rotten)) return null; return int('ratio and fractions', `The ratio of apples to oranges in a crate was ${a} : ${b}. Then 1/${p} of the apples and 1/${q} of the oranges went rotten, ${rotten} fruits in all. How many fruits were in the crate at first?`, (a + b) * u); };
const spendTwice = () => { const p = pick([4, 5, 8, 10]), n = ri(1, 4), q = pick([5, 6, 8, 10]); if (n >= q) return null; const x2 = ri(20, 200) * 10, c1 = ri(1, 9) * 10, c2 = ri(1, 9) * 10, x1 = ((x2 + c2) * q) / (q - n); if (!Number.isInteger(x1)) return null; const x0 = ((x1 + c1) * p) / (p - 1); if (!Number.isInteger(x0)) return null; const [w] = names(1); return int('working backwards', `${w} spent 1/${p} of ${w}'s savings and another ${money(c1)} on a bag, then ${n}/${q} of the remaining money and another ${money(c2)} on shoes. ${w} then had ${money(x2)} left. How much did ${w} have at first, in dollars?`, x0); };
const meetOnTrack = () => { const v1 = pick([10, 12, 14, 15, 16]), v2 = pick([10, 12, 14, 15, 16, 18]), m = pick([15, 20, 30, 33, 36, 45]); if (v1 === v2) return null; const L = ((v1 + v2) * m) / 60, shown = Math.round(L * 100) / 100; if (shown !== L) return null; return int('meeting', `Two joggers start from the same point on a ${shown} km circular track at the same time and run in opposite directions at ${v1} km/h and ${v2} km/h. After how many minutes do they meet?`, m); };

const T = (cat, gen, ...sections) => ({ cat, gen, sections });
const R = (cat, gen, ...sections) => ({ cat, gen, sections, repeatable: true }); // the syllabus pool may serve a heat more than once
const POOL_1 = [R('syllabus', syllabus, 'M2', 'M3'), R('syllabus 2', syllabus, 'M2', 'M3'), T('listing', listing, 'M3'), T('before and after', beforeAfter, 'M3'), T('guess and check', guessCheck, 'M3', 'M4'), T('working backwards', workBack, 'M3', 'M4'), T('sum and difference', gapDiff, 'M2'), T('geometry', geometry, 'M2', 'M3'), T('digits', digitsQ, 'M2', 'M3', 'M4'), T('time and money', timeMoney, 'M2'), T('fractions', fractionsQ, 'M2'), T('price lists', bulkDeal, 'M2', 'M3'), T('ages', agesQ, 'M4'), T('repeating patterns', cycleStars, 'M4')];
const POOL_2 = [R('syllabus', syllabus, 'M2', 'M3'), R('syllabus 2', syllabus, 'M2', 'M3'), R('graphs', syllabus, 'M2', 'M3'), T('listing', listing, 'M2'), T('before and after', beforeAfter, 'M3'), T('guess and check', guessCheck, 'M3', 'M4'), T('working backwards', workBack, 'M3'), T('sum and difference', gapDiff, 'M2'), T('geometry', geometry, 'M2', 'M3', 'M4'), T('digits', digitsQ, 'M2', 'M3'), T('time and money', timeMoney, 'M2'), T('fractions', fractionsQ, 'M2'),
  T('graph money', graphMoney, 'M3'), T('change', changeFromNotes, 'M2', 'M3'), T('price lists', bulkDeal, 'M2'), T('spacing', spacing, 'M4'), T('units and parts', twoQuantities, 'M4'), T('short of', shortOf, 'M4'), T('permutations', permutations, 'M2', 'M3'), T('repeating patterns', cycleStars, 'M3'), T('ages', agesQ, 'M3')];
const POOL_3 = [R('syllabus', syllabus, 'M2', 'M3'), R('syllabus 2', syllabus, 'M2', 'M3'), R('graphs', syllabus, 'M2', 'M3'), T('listing', listing, 'M2'), T('before and after', beforeAfter, 'M2'), T('guess and check', guessCheck, 'M2', 'M3'), T('working backwards', workBack, 'M2', 'M3'), T('fraction of a remainder', remainderFrac, 'M3', 'M4'), T('sum and difference', gapDiff, 'M2'), T('ratio and percentage', units, 'M2', 'M3'), T('geometry', geometry, 'M2', 'M3', 'M4'), T('digits', digitsQ, 'M2'), T('time and money', timeMoney, 'M2'), T('fractions', fractionsQ, 'M2'),
  T('graph money', graphMoney, 'M3'), T('change', changeFromNotes, 'M2'), T('spacing', spacing, 'M3'), T('units and parts', twoQuantities, 'M3'), T('short of', shortOf, 'M3'), T('repeating patterns', cycleStars, 'M2'), T('ages', agesQ, 'M2'),
  T('ratio with a change', ratioChange, 'M4'), T('averages', avgLeavers, 'M4'), T('discount and tax', discountGST, 'M4'), T('work rate', workTogether, 'M4'), T('common multiples', shelvesLCM, 'M3', 'M4'), T('ratio and fractions', fruitRatio, 'M4'), T('spending twice', spendTwice, 'M4'), T('meeting', meetOnTrack, 'M4')];
const POOL = (y) => (band(y) === 1 ? POOL_1 : band(y) === 2 ? POOL_2 : POOL_3);
// the paper's climb: five two-mark questions (the two multiple choice among them), three three-mark, two four-mark — all but the two typed
const SHAPE = slots([['M2', 'mc', 2], ['M2', 'sa', 3], ['M3', 'sa', 3], ['M4', 'sa', 2]]);
export const heat = (year) => buildHeat(SHAPE, POOL(year), year, { options: 4 });
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['2 marks: the Singapore-standard word problems, sum and difference, coins round a square, halves and quarters', '3 marks: towers and lists, chickens and rabbits, working backwards, before and after, pages with a digit', '4 marks: ages that add up, a repeating row of stars, the harder heuristics', 'almost all typed, as the real paper: only two multiple choice'] },
  { band: 'Grades 3–4', lines: ['2 marks: the word problems, two-digit numbers from digits, change from notes, orders in a row', '3 marks: a bar graph then money, before and after, repeating patterns, ages, composite figures', '4 marks: gaps between bins, a wallet and its pouches, short of the price, bent wire', 'almost all typed, as the real paper: only two multiple choice'] },
  { band: 'Grades 5–6', lines: ['2 marks: the word problems, ratio and percentage, the largest number from digits, a repeating row of stars', '3 marks: fraction of a remainder, a bar graph then money, spacing, units and parts, books on shelves', '4 marks: a ratio with a change, averages after a loss, a discount then tax, robots painting together', 'apples and oranges gone rotten, spending twice, joggers meeting round a track, circles with π = 3.14'] },
];
