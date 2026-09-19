// 🏮 T-MOON — practice modelled on WMI (the World Mathematics Invitational, Taiwan); not affiliated. The real preliminary is
// split into two named halves, Section A "Logical Reasoning" and Section B "Applications", every question multiple choice, and
// its topic chart puts logical reasoning, word problems and a "math puzzle" at every grade from kindergarten up: the content is
// the ordinary curriculum, the difficulty is the puzzle framing and the pace. A heat is five from each half, one paper per
// grade as WMI has it (olympia-research.md §2).
import { ri, pick, shuffle, sum, names, thing, int, mcOnly, withFigure, table, bars, buildHeat, slots, isPrime, gcd, lcm, cap } from './common.mjs';
import { lengthWindow } from './phi.mjs';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const money = (n) => `Rp${n.toLocaleString('en-US')}`;
const SHAPES = [['🔺', 'triangle'], ['🔵', 'circle'], ['🟩', 'square'], ['⭐', 'star']];

// ---- Section A: logical reasoning ----
const lineUp = (y) => {
  const w = names(y <= 2 ? 3 : 4);
  if (y <= 2) return mcOnly('order and direction', `Three children stand in a line. ${w[0]} is in front of ${w[1]}. ${w[2]} is behind ${w[1]}. Who is second in the line?`, w[1], [w[0], w[2], 'Cannot be decided']);
  const order = shuffle(w), pos = ['first', 'second', 'third', 'last'], k = ri(0, 3);
  return mcOnly('order and direction', `Four children stand in a line. ${order[0]} is first. ${order[2]} is right behind ${order[1]}. ${order[3]} is last. Who is ${pos[k]}?`, order[k], order.filter((_, i) => i !== k));
};
const shapePattern = (y) => {
  const [a, b, c] = shuffle(SHAPES).slice(0, 3), period = y <= 2 ? pick([[a, b], [a, b, b], [a, a, b]]) : pick([[a, b, c], [a, b, b, c], [a, c, b, b]]), n = ri(9, 14);
  const seq = Array.from({ length: n }, (_, i) => period[i % period.length]), next = period[n % period.length];
  return mcOnly('patterns', `${seq.map((s) => s[0]).join(' ')} … Which shape comes next?`, next[0], SHAPES.filter((s) => s !== next).map((s) => s[0]), { read: `The pattern goes ${seq.map((s) => s[1]).join(', ')}. Which shape comes next: ${SHAPES.map((s) => s[1]).join(', ')}?` });
};
const oddOne = (y) => {
  const kind = y <= 2 ? 1 : y <= 4 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) { const evens = Array.from({ length: 3 }, () => ri(1, y <= 2 ? 20 : 50) * 2), odd = ri(1, y <= 2 ? 20 : 50) * 2 - 1; return mcOnly('odd one out', `Which number does not belong with the others: ${shuffle([...evens, odd]).join(', ')}?`, odd, evens); }
  if (kind === 2) { const m = pick([3, 4, 5]), ins = Array.from({ length: 3 }, () => ri(2, 12) * m); let out = ri(5, 60); while (out % m === 0) out++; return mcOnly('odd one out', `Which number does not belong with the others: ${shuffle([...ins, out]).join(', ')}?`, out, ins); }
  const ps = shuffle([11, 13, 17, 19, 23, 29, 31, 37, 41]).slice(0, 3), comp = pick([15, 21, 25, 27, 33, 35, 39]); return mcOnly('odd one out', `Three of these numbers are prime. Which one is not: ${shuffle([...ps, comp]).join(', ')}?`, comp, ps);
};
const balance = (y) => {
  const [a, b] = shuffle([['🍎', 'apple'], ['🍐', 'pear'], ['🍊', 'orange'], ['🍋', 'lemon']]).slice(0, 2), p = ri(1, 3), q = ri(p + 1, y <= 2 ? 4 : 6), k = ri(2, y <= 2 ? 3 : 5);
  return int('balance puzzles', `${a[0].repeat(p)} weighs the same as ${b[0].repeat(q)}. How many ${b[1]}s weigh the same as ${p * k} ${a[1]}s?`, q * k, { read: `${p} ${a[1]}${p > 1 ? 's' : ''} weigh the same as ${q} ${b[1]}s. How many ${b[1]}s weigh the same as ${p * k} ${a[1]}s?` });
};
const ages = (y) => {
  const [a, b] = names(2);
  if (y <= 4) { const age = ri(5, 12), d = ri(2, 8), yrs = ri(2, 10); return int('ages', `${a} is ${age} and ${b} is ${age + d}. How old will ${b} be when ${a} is ${age + yrs}?`, age + d + yrs); }
  const x = ri(6, 14), d = ri(2, 8), yrs = ri(2, 8); return int('ages', `${a} is ${d} years older than ${b}. In ${yrs} years their ages will add up to ${2 * x + d + 2 * yrs}. How old is ${b} now?`, x);
};
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const calendar = (y) => { const d = ri(0, 6), n = y <= 2 ? ri(3, 12) : ri(14, 29), m = pick(['May', 'August', 'October']); return mcOnly('calendar logic', `The 1st of ${m} is a ${DAYS[d]}. What day of the week is the ${ord(n + 1)} of ${m}?`, DAYS[(d + n) % 7], DAYS.filter((_, i) => i !== (d + n) % 7).slice(0, 3)); };
const puzzle = (y) => {
  const kind = y <= 2 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) { const s = ri(6, y <= 2 ? 20 : 100), a = ri(1, s - 1); return int('math puzzle', `${a} + ▢ = ${s}. What number is ▢?`, s - a, { read: `${a} plus what number makes ${s}?` }); }
  if (kind === 2) { const a = ri(2, y <= 2 ? 9 : 12); return int('math puzzle', `▢ + ▢ + ▢ = ${3 * a}. What number is ▢?`, a, { read: `Three of the same number add up to ${3 * a}. What is the number?` }); }
  const a = ri(2, 9), b = ri(2, 9); return int('math puzzle', `▢ × △ = ${a * b} and ▢ + △ = ${a + b}. What is the bigger of the two numbers?`, Math.max(a, b), { read: `Two numbers multiply to ${a * b} and add to ${a + b}. What is the bigger one?` });
};
const truth = () => { const w = names(3); return mcOnly('logic', `One of three friends broke a vase. ${w[0]} says: "It was ${w[1]}." ${w[1]} says: "It was not me." ${w[2]} says: "It was not me." Exactly one of them is lying. Who broke the vase?`, w[2], [w[0], w[1], 'Cannot be decided']); };
const countRange = (y) => { const a = ri(3, y <= 2 ? 9 : 20), b = a + ri(5, y <= 2 ? 12 : 40); return int('counting', `How many whole numbers are there from ${a} to ${b}, counting both ${a} and ${b}?`, b - a + 1); };
const legs = (y) => { const n = ri(2, y <= 2 ? 6 : 12), m = ri(1, y <= 2 ? 5 : 10); return int('counting', `In a garden there are ${n} birds and ${m} cats. How many legs are there altogether?`, 2 * n + 4 * m); };

// ---- Section B: applications by grade ----
const addSubWords = (y) => { const [w] = names(1), it = thing(); if (y === 1) { const a = ri(3, 12), b = ri(2, 20 - a); return int('word problems', `${w} has ${a} ${it}s and gets ${b} more. How many ${it}s does ${w} have now?`, a + b); } const hi = y === 2 ? 100 : y <= 4 ? 1000 : 10000, a = ri(hi / 5, hi), b = ri(1, a); return int('word problems', `A shop had ${a} ${it}s and sold ${b}. How many are left?`, a - b); };
const measure = (y) => {
  if (y <= 2) { const items = lengthWindow(), top = Math.random() < 0.5, best = items.reduce((p, q) => ((q[1] > p[1]) === top ? q : p)); return mcOnly('measurement', `Which of these is the ${top ? 'longest' : 'shortest'}?`, cap(best[0]), items.filter((i) => i !== best).map((i) => cap(i[0]))); }
  const kind = ri(1, 2); if (kind === 1) { const m = ri(2, 9), cm = ri(1, 99); return int('units', `How many centimetres are there in ${m} m ${cm} cm?`, m * 100 + cm); } const kg = ri(1, 9), g = ri(1, 9) * 100; return int('units', `How many grams are there in ${kg} kg ${g} g?`, kg * 1000 + g);
};
const dataQ = (y) => {
  const names4 = shuffle(['Adi', 'Sari', 'Bayu', 'Putri', 'Wira']).slice(0, 4), vals = names4.map(() => ri(1, y <= 2 ? 9 : 40)), what = pick(['stickers', 'books read', 'goals']);
  const hi = vals.indexOf(Math.max(...vals)), lo = vals.indexOf(Math.min(...vals)); if (hi === lo) return null;
  const f = y <= 2 ? table(cap(what), ['Name', cap(what)], names4.map((n, i) => [n, '⭐'.repeat(vals[i])])) : bars(cap(what), null, names4.map((n, i) => [n, vals[i]]));
  const kind = ri(1, 3);
  const shows = `The ${y <= 2 ? 'picture graph' : 'bar chart'} shows how many ${what} four children have${y <= 2 ? ' (each ⭐ is one)' : ''}.`;
  if (kind === 1) return withFigure(mcOnly('data and graphs', `${shows} Who has the most?`, names4[hi], names4.filter((_, i) => i !== hi)), f);
  if (kind === 2) return withFigure(int('data and graphs', `${shows} How many more does ${names4[hi]} have than ${names4[lo]}?`, vals[hi] - vals[lo]), f);
  return withFigure(int('data and graphs', `${shows} How many altogether?`, sum(vals)), f);
};
const shapesQ = () => { const c = pick([['How many sides does a hexagon have?', 6, [5, 8, 4]], ['How many sides does a pentagon have?', 5, [6, 4, 8]], ['How many corners does a rectangle have?', 4, [3, 6, 8]], ['How many sides does an octagon have?', 8, [6, 7, 10]], ['How many faces does a cube have?', 6, [4, 8, 12]]]); return mcOnly('shapes', c[0], c[1], c[2]); };
const mulDiv = (y) => { const kind = ri(1, 2), [w] = names(1), it = thing(); if (kind === 1) { const n = ri(2, y === 2 ? 5 : 9), k = ri(2, y === 2 ? 5 : y <= 4 ? 9 : 12); return int('multiplication and division', `${w} puts ${k} ${it}s in each of ${n} boxes. How many ${it}s is that?`, n * k); } const k = ri(2, y === 2 ? 5 : 9), n = ri(2, y === 2 ? 5 : 12); return int('multiplication and division', `${w} shares ${n * k} ${it}s equally among ${k} friends. How many does each friend get?`, n); };
const moneyQ = (y) => { const [w] = names(1); if (y <= 4) { const p = ri(2, 20) * 500, n = ri(2, 6), had = p * n + ri(1, 10) * 1000; return int('money', `${w} has ${money(had)} and buys ${n} ${thing()}s at ${money(p)} each. How much money is left, in rupiah?`, had - p * n); } const p = pick([80000, 120000, 150000, 200000]), off = pick([10, 20, 25, 50]), up = pick([10, 20, 25]); const sale = p - (p * off) / 100, final = sale + (sale * up) / 100; if (!Number.isInteger(final)) return null; return int('financial literacy', `A bag costs ${money(p)}. In a sale its price is cut by ${off}%. The next week the sale price is raised by ${up}%. What is the final price, in rupiah?`, final); };
const timeQ = (y) => { const h = ri(1, 10), m = y <= 2 ? pick([0, 30]) : pick([0, 15, 30, 45]), d = y <= 2 ? pick([30, 60, 90]) : pick([25, 40, 45, 70, 95, 135]), e = h * 60 + m + d, hm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; return mcOnly('time', `A film starts at ${hm(h * 60 + m)} and lasts ${d >= 60 ? `${Math.floor(d / 60)} h ${d % 60 ? `${d % 60} min` : ''}`.trim() : `${d} min`}. When does it end?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 30)]); };
const fractionsQ = (y) => { const d = pick(y <= 4 ? [2, 3, 4, 5] : [3, 4, 5, 6, 8]), n = ri(1, d - 1), whole = d * ri(2, y <= 4 ? 8 : 15); return int('fractions', `${names(1)[0]} has ${whole} ${thing()}s and gives away ${n}/${d} of them. How many are given away?`, (whole / d) * n); };
const factors = (y) => { const kind = ri(1, 3); if (kind === 1) { const a = pick([4, 6, 8, 9, 10, 12]), b = pick([6, 8, 10, 12, 15]); if (a === b) return null; return int('factors and multiples', `What is the lowest common multiple of ${a} and ${b}?`, lcm(a, b)); } if (kind === 2) { const g = pick([4, 6, 8, 12]), a = g * pick([2, 3, 5]), b = g * pick([3, 4, 7]); if (a === b) return null; return int('factors and multiples', `What is the highest common factor of ${a} and ${b}?`, gcd(a, b)); } const ps = shuffle([2, 3, 5, 7, 11, 13, 17, 19, 23]).slice(0, 3), c = pick([4, 6, 8, 9, 10, 12, 14, 15, 21]); return mcOnly('prime or composite', `Which of these numbers is NOT prime: ${shuffle([...ps, c]).join(', ')}?`, c, ps); };
const ratioQ = () => { const a = ri(1, 4), b = ri(a + 1, 7), u = ri(2, 12); return int('ratio', `Blue and white paint are mixed in the ratio ${a} : ${b}. If ${a * u} litres of blue paint are used, how many litres of white paint are needed?`, b * u); };
const areaVolume = (y) => { const kind = y === 5 ? ri(1, 2) : ri(1, 3); if (kind === 1) { const l = ri(3, 12), w = ri(2, 10), h = ri(2, 8); return int('area and volume', `A box is ${l} cm long, ${w} cm wide and ${h} cm tall. What is its volume, in cm³?`, l * w * h); } if (kind === 2) { const l = ri(4, 20), w = ri(2, l); return int('area and volume', `A rectangle is ${l} cm by ${w} cm. What is its area, in cm²?`, l * w); } const r = pick([7, 14, 21]); return int('circles', `Taking π as 22/7, what is the area of a circle with radius ${r} cm, in cm²?`, (22 / 7) * r * r); };
const probability = () => { const r = ri(1, 5), b = ri(1, 5), total = r + b; return mcOnly('probability', `A box has ${r} red and ${b} blue balls. One ball is picked without looking. Which is true?`, r > b ? 'Red is more likely' : r < b ? 'Blue is more likely' : 'Red and blue are equally likely', [r > b ? 'Blue is more likely' : 'Red is more likely', r === b ? 'Red is more likely' : 'Red and blue are equally likely', 'It cannot be told'].filter((x, i, xs) => xs.indexOf(x) === i && x !== (r > b ? 'Red is more likely' : r < b ? 'Blue is more likely' : 'Red and blue are equally likely'))); };
const algebra = (y) => { const kind = ri(1, 2); if (kind === 1) { const a = ri(2, 9), x = ri(2, 15), b = ri(1, 20); return int('algebraic thinking', `If ${a}x + ${b} = ${a * x + b}, what is x?`, x); } const x = ri(3, 30), a = ri(2, 9); return int('algebraic thinking', `A number is multiplied by ${a} and the result is ${a * x}. What is the number?`, x); };
const speedQ = () => { const v = pick([40, 50, 60, 80]), t = ri(2, 5); return int('speed', `A train travels at ${v} km/h for ${t} hours. How far does it go, in km?`, v * t); };
const negative = () => { const t1 = ri(-9, 5), d = ri(3, 12), up = Math.random() < 0.5; return int('negative numbers', `The temperature was ${t1}°C. It ${up ? 'rose' : 'fell'} by ${d}°C. What is the temperature now, in °C?`, up ? t1 + d : t1 - d); };
const exponents = () => { const b = pick([2, 3, 5, 10]), n = b === 2 ? ri(3, 8) : b === 3 ? ri(2, 5) : ri(2, 4); return int('exponents', `What is ${b} to the power ${n}, that is ${Array(n).fill(b).join(' × ')}?`, b ** n); };
const percentQ = () => { const t = pick([40, 60, 80, 120, 200, 250]), p = pick([10, 15, 20, 25, 30, 40, 60, 75]); return int('percentages', `${p}% of ${t} children in a school take the bus. How many take the bus?`, (t * p) / 100); };

const A = (y) => [['order and direction', lineUp], ['patterns', shapePattern], ['odd one out', oddOne], ['balance puzzles', balance], ['calendar logic', calendar], ['math puzzle', puzzle], ['counting', y <= 2 ? legs : countRange], ...(y >= 3 ? [['ages', ages], ['logic', truth]] : [])].map(([cat, gen]) => ({ cat, gen, sections: ['A'] }));
const B = (y) => {
  const rows = [['word problems', addSubWords], ['measurement', measure], ['data and graphs', dataQ], ['time', timeQ]];
  if (y === 1) rows.push(['shapes', shapesQ]);
  if (y >= 2) rows.push(['multiplication and division', mulDiv], ['shapes', shapesQ]);
  if (y >= 3) rows.push(['money', moneyQ], ['fractions', fractionsQ]);
  if (y >= 5) rows.push(['factors and multiples', factors], ['ratio', ratioQ], ['area and volume', areaVolume], ['probability', probability], ['algebraic thinking', algebra], ['financial literacy', moneyQ]);
  if (y >= 6) rows.push(['speed', speedQ], ['negative numbers', negative], ['exponents', exponents], ['percentages', percentQ]);
  return rows.map(([cat, gen]) => ({ cat, gen, sections: ['B'] }));
};
const SHAPE = slots([['A', 'mc', 5], ['B', 'mc', 5]]);
export const heat = (year) => buildHeat(SHAPE, [...A(year), ...B(year)], year, { options: 4 });
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['A: who is second in the line, the next shape, the odd one out, balance puzzles', 'A: what day it is in n days, the missing number in a box', 'B: adding and taking away in words, longest and shortest, picture graphs', 'B: what time a film ends, sides of shapes, equal groups'] },
  { band: 'Grades 3–4', lines: ['A: four in a line, ages, who is lying', 'A: multiples and the odd one out, counting whole numbers between', 'B: metres and centimetres, kilograms and grams, bar charts', 'B: rupiah left after shopping, fractions of a set'] },
  { band: 'Grades 5–6', lines: ['A: primes among the numbers, two numbers from their sum and product', 'B: LCM and HCF, ratio of paints, volume of a box, the area of a circle', 'B: a discount then a rise, finding x, which colour is more likely', 'B (Grade 6): speed, temperatures below zero, powers, percentages'] },
];
