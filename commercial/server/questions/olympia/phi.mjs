// 🌴 PHI-MOON — practice modelled on PhIMO (the Philippine International Mathematical Olympiad, Math Olympiads Training League);
// not affiliated. Its own family, not OCEC's: the Philippine K-12 strands — Number and Number Sense, Geometry, Pattern and
// Algebra, Measurements, Statistics and Probability — at every grade, in a paper that ramps from ten accessible multiple-choice
// questions through ten short answers to five hard ones (olympia-research.md §6 and the addendum). A heat is one multiple-choice
// and one short answer from each strand, the multiple choice first, one paper per grade.
import { ri, pick, shuffle, sum, names, thing, int, dec, frac, mcOnly, withFigure, table, bars, buildHeat, slots, gcd, cap } from './common.mjs';

const low = (y) => y <= 2, mid = (y) => y >= 3 && y <= 4;
// four things of very different lengths, from a window of a long table (shortest first), so the longest and the shortest of the four
// are not the same two things every time
export const LENGTHS = [['an ant', 0.5], ['a paper clip', 3], ['an eraser', 4], ['a pencil', 15], ['a ruler', 30], ['a chair', 90], ['a door', 200], ['a car', 400], ['a bus', 1200], ['a football field', 10000]];
export const lengthWindow = () => { const lo = ri(0, LENGTHS.length - 4); return shuffle(LENGTHS.slice(lo, lo + 4)); };
// ---- Number and Number Sense ----
const numberSense = (y) => {
  const kind = ri(1, 4);
  if (low(y)) { if (kind === 1) { const t = ri(1, 9), o = ri(0, 9); return int('number sense · place value', `What number has ${t} tens and ${o} ones?`, 10 * t + o); } if (kind === 2) { const xs = shuffle([ri(10, 99), ri(10, 99), ri(10, 99), ri(10, 99)]); if (new Set(xs).size < 4) return null; return mcOnly('number sense · comparing', `Which of these numbers is the greatest: ${xs.join(', ')}?`, Math.max(...xs), xs.filter((x) => x !== Math.max(...xs))); } if (kind === 3) { const a = ri(3, 12), b = ri(2, 20 - a); return int('number sense · addition', `${a} + ${b} = ?`, a + b); } const n = ri(11, 98); return int('number sense · counting on', `What number is 10 more than ${n}?`, n + 10); }
  if (mid(y)) { if (kind === 1) { const n = ri(1000, 9999), to = pick([10, 100, 1000]); return int('number sense · rounding', `Round ${n} to the nearest ${to}.`, Math.round(n / to) * to); } if (kind === 2) { const d = pick([3, 4, 5, 6, 8]), n = d * ri(3, 12), k = ri(1, d - 1); return int('number sense · fractions', `What is ${k}/${d} of ${n}?`, (n / d) * k); } if (kind === 3) { const a = ri(12, 99), b = ri(3, 9); return int('number sense · multiplication', `${a} × ${b} = ?`, a * b); } const a = ri(200, 999), b = ri(100, a - 50); return int('number sense · subtraction', `${a} − ${b} = ?`, a - b); }
  if (kind === 1) { const d = pick([4, 5, 8, 10, 20, 25]), n = ri(1, d - 1); return dec('number sense · decimals', `Write ${n}/${d} as a decimal.`, n / d); }
  if (kind === 2) { const fs = shuffle([[2, 3], [3, 5], [5, 8], [7, 12], [4, 7], [3, 4], [5, 6]]).slice(0, 4), best = fs.reduce((a, b) => (b[0] * a[1] > a[0] * b[1] ? b : a)); return mcOnly('number sense · fractions', 'Which fraction is the greatest?', `${best[0]}/${best[1]}`, fs.filter((f) => f !== best).map((f) => `${f[0]}/${f[1]}`)); }
  if (kind === 3) { const d1 = pick([3, 4, 6]), d2 = pick([4, 6, 8]), n1 = 1, n2 = ri(1, d2 - 1); const n = n1 * d2 + n2 * d1, d = d1 * d2; if (d1 === d2 || n >= d) return null; return frac('number sense · fractions', `What is 1/${d1} + ${n2}/${d2}? Give the answer in its simplest form.`, n, d); }
  const p = pick([15, 20, 25, 30, 40, 60, 75]), t = pick([40, 60, 80, 120, 200]); if ((t * p) % 100) return null; return int('number sense · percentages', `What is ${p}% of ${t}?`, (t * p) / 100);
};
// ---- Geometry ----
const geometry = (y) => {
  const kind = ri(1, 3);
  if (low(y)) { if (kind === 1) { const c = pick([['How many sides does a triangle have?', 3, [4, 5, 6]], ['How many corners does a rectangle have?', 4, [3, 5, 6]], ['How many sides does a hexagon have?', 6, [5, 7, 8]], ['How many faces does a cube have?', 6, [4, 8, 12]]]); return mcOnly('geometry · shapes', c[0], c[1], c[2]); } if (kind === 2) { const a = ri(2, 6), b = ri(2, 6); return int('geometry · shapes', `A picture is made of ${a} triangles and ${b} squares. How many sides do the shapes have altogether?`, 3 * a + 4 * b); } const c = pick([['square', 4], ['rectangle', 2], ['equilateral triangle', 3], ['circle', 100]]); return c[0] === 'circle' ? null : int('geometry · symmetry', `How many lines of symmetry does a${c[0][0] === 'e' ? 'n' : ''} ${c[0]} have?`, c[1]); }
  if (mid(y)) { if (kind === 1) { const l = ri(4, 20), w = ri(2, l - 1); return int('geometry · perimeter', `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter, in cm?`, 2 * (l + w)); } if (kind === 2) { const a = ri(30, 80), b = ri(20, 170 - a); return int('geometry · angles', `Two angles of a triangle are ${a}° and ${b}°. What is the third angle, in degrees?`, 180 - a - b); } const c = pick([['acute', 'less than 90°'], ['obtuse', 'more than 90° but less than 180°'], ['right', 'exactly 90°']]); return mcOnly('geometry · angles', `An angle of ${c[0] === 'acute' ? ri(20, 80) : c[0] === 'obtuse' ? ri(100, 170) : 90}° is called…`, `${c[0]} angle`, ['acute angle', 'obtuse angle', 'right angle', 'straight angle'].filter((x) => x !== `${c[0]} angle`)); }
  if (kind === 1) { const r = pick([7, 14, 21]); return int('geometry · circles', `Taking π as 22/7, what is the area of a circle of radius ${r} cm, in cm²?`, (22 / 7) * r * r); }
  if (kind === 2) { const l = ri(3, 10), w = ri(2, 8), h = ri(2, 6); return int('geometry · volume', `A box is ${l} cm by ${w} cm by ${h} cm. What is its volume, in cm³?`, l * w * h); }
  const a = ri(50, 120), b = ri(50, 120), c = ri(40, 359 - a - b - 30); return int('geometry · angles', `Three angles of a quadrilateral are ${a}°, ${b}° and ${c}°. What is the fourth angle, in degrees?`, 360 - a - b - c);
};
// ---- Pattern and Algebra ----
const pattern = (y) => {
  const kind = ri(1, 3);
  if (low(y)) { if (kind === 1) { const s = ri(1, 10), k = pick([2, 3, 5]), n = ri(6, 9); return int('pattern and algebra · number patterns', `Look at the pattern: ${s}, ${s + k}, ${s + 2 * k}, ${s + 3 * k}, … What is the ${n}th number?`, s + (n - 1) * k); } if (kind === 2) { const a = ri(2, 9), b = ri(1, 9); return int('pattern and algebra · missing number', `${a} + ▢ = ${a + b}. What number goes in the box?`, b, { read: `${a} plus what number makes ${a + b}?` }); } const shapes = ['🔺', '🔵', '🟩']; const [p, q] = shuffle(shapes); const seq = Array.from({ length: 9 }, (_, i) => (i % 3 === 2 ? q : p)); return mcOnly('pattern and algebra · shape patterns', `${seq.join(' ')} … Which shape comes next?`, p, shapes.filter((s) => s !== p).concat(['⭐']), { read: 'A pattern of shapes repeats: two of one shape, then one of another. Which shape comes next?' }); }
  if (mid(y)) { if (kind === 1) { const s = ri(2, 20), k = ri(3, 9), n = ri(10, 20); return int('pattern and algebra · number patterns', `${s}, ${s + k}, ${s + 2 * k}, ${s + 3 * k}, … What is the ${n}th number in the pattern?`, s + (n - 1) * k); } if (kind === 2) { const a = ri(2, 9), x = ri(2, 12); return int('pattern and algebra · missing number', `${a} × ▢ = ${a * x}. What number goes in the box?`, x, { read: `${a} times what number makes ${a * x}?` }); } const k = ri(2, 4), n = ri(5, 10); return int('pattern and algebra · growing patterns', `Figure 1 is made of ${k + 1} sticks, Figure 2 of ${2 * k + 1}, Figure 3 of ${3 * k + 1}, and each figure has ${k} more sticks than the one before. How many sticks are in Figure ${n}?`, n * k + 1); }
  if (kind === 1) { const a = ri(2, 9), x = ri(2, 20), b = ri(1, 30); return int('pattern and algebra · equations', `If ${a}x + ${b} = ${a * x + b}, what is x?`, x); }
  if (kind === 2) { const n = ri(6, 15); return int('pattern and algebra · number patterns', `1, 4, 9, 16, 25, … What is the ${n}th number in the pattern?`, n * n); }
  const x = ri(3, 30), k = ri(2, 6), d = ri(1, 20); return int('pattern and algebra · equations', `A number is multiplied by ${k}, then ${d} is subtracted, and the result is ${k * x - d}. What is the number?`, x);
};
// ---- Measurements ----
const measurement = (y) => {
  const kind = ri(1, 3);
  if (low(y)) { if (kind === 1) { const items = lengthWindow(), top = Math.random() < 0.5, best = items.reduce((p, q) => ((q[1] > p[1]) === top ? q : p)); return mcOnly('measurement · comparing lengths', `Which of these is the ${top ? 'longest' : 'shortest'}?`, cap(best[0]), items.filter((i) => i !== best).map((i) => cap(i[0]))); } if (kind === 2) { const h = ri(1, 9), d = pick([1, 2, 3]); return int('measurement · time', `A film starts at ${h} o'clock and lasts ${d} hour${d > 1 ? 's' : ''}. It ends at ___ o'clock. What number goes in the blank?`, h + d); } const a = ri(2, 9), b = ri(2, 9); return int('measurement · length', `A ribbon is ${a} cm long and another is ${b} cm long. How long are they altogether, in cm?`, a + b); }
  if (mid(y)) { if (kind === 1) { const m = ri(2, 9), cm = ri(1, 99); return int('measurement · units', `How many centimetres are there in ${m} m ${cm} cm?`, m * 100 + cm); } if (kind === 2) { const h = ri(1, 10), m = pick([0, 15, 30, 45]), d = pick([25, 40, 45, 70, 95]), e = h * 60 + m + d, hm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; return mcOnly('measurement · time', `A lesson starts at ${hm(h * 60 + m)} and lasts ${d} minutes. When does it end?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 30)]); } const kg = ri(1, 9), g = ri(1, 9) * 100; return int('measurement · mass', `How many grams are there in ${kg} kg ${g} g?`, kg * 1000 + g); }
  if (kind === 1) { const L = ri(10, 20), W = ri(6, 12), p = 1; return int('measurement · area', `A rectangular garden is ${L} m by ${W} m. A path ${p} m wide runs all the way around the inside edge. What is the area of the path, in m²?`, L * W - (L - 2 * p) * (W - 2 * p)); }
  if (kind === 2) { const l = ri(1, 9), ml = ri(1, 9) * 100; return int('measurement · capacity', `How many millilitres are there in ${l} L ${ml} mL?`, l * 1000 + ml); }
  const v = pick([40, 50, 60, 80]), t = ri(2, 5); return int('measurement · speed', `A car travels at ${v} km/h for ${t} hours. How far does it go, in km?`, v * t);
};
// ---- Statistics and Probability ----
const statistics = (y) => {
  const kind = ri(1, 3), kids = shuffle(['Ana', 'Ben', 'Carlo', 'Dina', 'Elsa']).slice(0, 4), vals = kids.map(() => ri(1, low(y) ? 9 : 30)), what = pick(['books read', 'stickers', 'goals']);
  const hi = vals.indexOf(Math.max(...vals)), lo = vals.indexOf(Math.min(...vals)); if (hi === lo) return null;
  const f = low(y) ? table(cap(what), ['Name', cap(what)], kids.map((n, i) => [n, '⭐'.repeat(vals[i])])) : bars(cap(what), null, kids.map((n, i) => [n, vals[i]]));
  const shows = `The ${low(y) ? 'picture graph' : 'bar graph'} shows the ${what} of four children${low(y) ? ' (each ⭐ is one)' : ''}.`;
  if (kind === 1) return withFigure(mcOnly('statistics · graphs', `${shows} Who has the most?`, kids[hi], kids.filter((_, i) => i !== hi)), f);
  if (kind === 2) return withFigure(int('statistics · graphs', `${shows} How many more does ${kids[hi]} have than ${kids[lo]}?`, vals[hi] - vals[lo]), f);
  if (low(y)) return withFigure(int('statistics · graphs', `${shows} How many altogether?`, sum(vals)), f);
  if (mid(y)) { const t = sum(vals); if (t % 4) return null; return withFigure(int('statistics · average', `${shows} What is the average (mean) number per child?`, t / 4), f); }
  const xs = [...vals].sort((a, b) => a - b), middle = xs[1] + xs[2]; if (middle % 2) return null; // four numbers: the median is the mean of the middle two, asked only when it is whole
  return withFigure(int('statistics · median', `${shows} What is the median of the four numbers?`, middle / 2), f);
};
const probability = (y) => {
  const r = ri(1, 6), b = ri(1, 6), cols = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 2);
  if (low(y) || mid(y)) { const words = r > b ? `${cols[0]} is more likely` : r < b ? `${cols[1]} is more likely` : 'both are equally likely'; return mcOnly('probability · chance', `A bag has ${r} ${cols[0]} and ${b} ${cols[1]} marbles. One is taken without looking. Which is true?`, words, [`${cols[0]} is more likely`, `${cols[1]} is more likely`, 'both are equally likely', 'it cannot be told'].filter((w) => w !== words)); }
  const kind = ri(1, 2);
  if (kind === 1) return frac('probability · fractions', `A bag has ${r} ${cols[0]} and ${b} ${cols[1]} marbles. One is taken without looking. What is the probability that it is ${cols[0]}, in simplest form?`, r, r + b);
  const t = ri(3, 11); let n = 0; for (let a = 1; a <= 6; a++) for (let c = 1; c <= 6; c++) if (a + c === t) n++; return int('probability · counting outcomes', `Two dice are rolled. In how many ways can the numbers add up to ${t}?`, n);
};

const STRANDS = [['NS', 'number sense', numberSense], ['GE', 'geometry', geometry], ['PA', 'pattern and algebra', pattern], ['ME', 'measurement', measurement], ['SP', 'statistics and probability', (y) => (Math.random() < 0.5 ? statistics(y) : probability(y))]];
const pool = (y) => STRANDS.map(([code, name, gen]) => ({ cat: name, gen, sections: [code] }));
// one multiple-choice and one short answer from each strand, the five multiple-choice first, as the real paper ramps
const SHAPE = slots([['NS', 'mc', 1], ['GE', 'mc', 1], ['PA', 'mc', 1], ['ME', 'mc', 1], ['SP', 'mc', 1], ['NS', 'sa', 1], ['GE', 'sa', 1], ['PA', 'sa', 1], ['ME', 'sa', 1], ['SP', 'sa', 1]]);
export const heat = (year) => buildHeat(SHAPE, pool(year), year, { options: 4 });
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['number sense: tens and ones, the greatest number, adding within 20', 'geometry and patterns: sides and corners, lines of symmetry, what comes next', 'measurement: longest and shortest, o\'clock, lengths added', 'statistics and probability: picture graphs, which colour is more likely'] },
  { band: 'Grades 3–4', lines: ['number sense: rounding, fractions of a number, multiplying and subtracting', 'geometry: perimeter, angles in a triangle, kinds of angles', 'patterns: the n-th number, missing numbers, growing figures', 'measurement and statistics: metres and centimetres, kilograms, bar graphs and the mean'] },
  { band: 'Grades 5–6', lines: ['number sense: decimals, comparing fractions, adding fractions, percentages', 'geometry: circles with π as 22/7, volume, angles in a quadrilateral', 'patterns and algebra: solving for x, square numbers', 'measurement, statistics and probability: the path around a garden, medians, probabilities as fractions'] },
];
