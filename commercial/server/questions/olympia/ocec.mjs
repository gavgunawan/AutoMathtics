// 🐉🐘 The OCEC family — what HK-Moon (HKIMO) and BKK-Moon (TIMO) share (olympia-research.md §5, §7 and the addendum). The real
// heats are twins: five categories — Logical Thinking, Arithmetic, Number Theory, Geometry, Combinatorics — five short answers
// each, four marks each, ninety minutes, no calculators, and at primary the answer is mostly a whole number (a few fractions,
// and at P1–P2 the odd word answer, occur on the real papers). The official sample papers are one template with the numbers
// changed and the 2025 heat papers spread evenly over the five areas, so the "HKIMO leans on number theory, TIMO on logic"
// split below is OUR differentiation, not the competitions' (the source check of 20 Sep 2026). The categories live here once,
// every kind tagged, and each moon's heat prefers its own tags: two questions a category, all typed answers, in the syllabus's
// own progression by primary year. The kinds under "the papers' staples" (20 Sep 2026) are what the 2025 heat papers ask that the
// first build lacked: cryptarithms, work and rest, give and take, defined operations, sums and multiples, telescoping sums, unit
// digits of sums of powers, three remainders at once, pyramids and prisms, exterior angles, compound routes, arrangements.
// Every seed now carries its worked solution in the house style (STEPS.md, 20 Sep 2026): explain(seed, steps, tip), every number
// in the lines computed from the generator's own variables, the method the child's year uses (bar models, working backwards, the
// assumption method, listing, pairing, counting by size; units language from Year 3). The kinds under "the lower grades" widen
// P1–P3, where five a category left the paper repeating families: number bonds, what number am I, magic squares, shape patterns,
// days of the week, doubling and halving, counting in steps, number clues, sums of digits, counting multiples, ordering,
// matchsticks, sides and corners, counting triangles, the distance round a shape, halves and quarters, lining up, paying with
// coins, colouring flags, choosing two.
import { ri, pick, shuffle, sum, names, thing, int, withFigure, grid, buildHeat, slots, phase, explain, bar, isPrime, factorsOf, digitsOf, gcd, lcm, ord } from './common.mjs';

const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
const COLOURS = ['red', 'blue', 'green', 'yellow', 'white', 'black'];
const OBJECTS = [['ball', 'cube', 'marble'], ['apple', 'pear', 'plum'], ['brick', 'block', 'bead'], ['jar', 'can', 'coin']]; // regular plurals only: an "s" is added
// small helpers for the steps: a list "a, b, c", a sum "a + b + c", a plural "s", the prime factors of n as [[p, e], …] for a factor tree
const list = (xs) => xs.join(', ');
const plus = (xs) => xs.join(' + ');
const es = (n) => (n === 1 ? '' : 's');
const primeFactors = (n) => { const out = []; let m = n; for (let p = 2; p * p <= m; p++) { let e = 0; while (m % p === 0) { m /= p; e++; } if (e) out.push([p, e]); } if (m > 1) out.push([m, 1]); return out; };
const powerText = (p, e) => (e === 1 ? `${p}` : e === 2 ? `${p}²` : `${p}^${e}`);

// ---- Logical Thinking ----
const balance = (y) => {
  const [a, b, c] = pick(OBJECTS), p = ri(2, y <= 2 ? 4 : 6), q = ri(2, y <= 2 ? 3 : 5);
  if (y <= 3) return explain(int('logical thinking · balance', `On a balance, 1 ${a} weighs the same as ${p} ${b}s, and 1 ${b} weighs the same as ${q} ${c}s. How many ${c}s weigh the same as 1 ${a}?`, p * q), [
    `1 ${a} is as heavy as ${p} ${b}s.`,
    `Swap every ${b} for ${q} ${c}s: ${p} ${b}s become ${p} × ${q} = ${p * q} ${c}s.`,
    `So ${p * q} ${c}s weigh the same as 1 ${a}.`,
  ], 'Swap the middle object for the small one, one step at a time.');
  const k = ri(2, 4), n = ri(2, 3); // k a's = kp b's, so one a is p b's
  return explain(int('logical thinking · balance', `On a balance, ${k} ${a}s weigh the same as ${k * p} ${b}s, and 1 ${b} weighs the same as ${q} ${c}s. How many ${c}s weigh the same as ${n} ${a}s?`, n * p * q), [
    `${k} ${a}s = ${k * p} ${b}s, so 1 ${a} = ${k * p} ÷ ${k} = ${p} ${b}s.`,
    `1 ${b} = ${q} ${c}s, so 1 ${a} = ${p} × ${q} = ${p * q} ${c}s.`,
    `${n} ${a}s = ${n} × ${p * q} = ${n * p * q} ${c}s.`,
    `So ${n * p * q} ${c}s weigh the same as ${n} ${a}s.`,
  ], 'Find what 1 of the big object is worth first, then multiply.');
};
const guessTwoDigit = () => {
  const t = ri(3, 9), u = ri(0, t - 1);
  return explain(int('logical thinking · guessing a number', `A two-digit number has digits that add up to ${t + u}. Its tens digit is ${t - u} more than its ones digit. What is the number?`, 10 * t + u), [
    `The two digits add up to ${t + u}, and the tens digit is ${t - u} more than the ones digit.`,
    `Take the extra ${t - u} away: ${t + u} − ${t - u} = ${2 * u}. That is two ones digits.`,
    `Ones digit: ${2 * u} ÷ 2 = ${u}. Tens digit: ${u} + ${t - u} = ${t}.`,
    `So the number is ${10 * t + u}.`,
  ], 'Sum and difference: take the difference off the sum and halve it to find the smaller one.');
};
const guessFourDigit = () => {
  const h = pick([2, 3]), th = 2 * h, t = 3 * h, o = t - 5, S = th + h + t + o;
  // the digit sum pins the number: without it 4261 and 6394 both fit the clues (the source check of 20 Sep 2026)
  return explain(int('logical thinking · guessing a number', `In a four-digit number, the thousands digit is twice the hundreds digit, the tens digit is the sum of the thousands and hundreds digits, the ones digit is 5 less than the tens digit, and the four digits add up to ${th + h + t + o}. What is the number?`, 1000 * th + 100 * h + 10 * t + o), [
    'Call the hundreds digit 1 unit. Then the thousands digit is 2 units, the tens digit 2 + 1 = 3 units, and the ones digit 3 units − 5.',
    `All four digits: 2 + 1 + 3 + 3 = 9 units − 5 = ${S}.`,
    `9 units = ${S} + 5 = ${9 * h}, so 1 unit = ${9 * h} ÷ 9 = ${h}.`,
    `Hundreds ${h}, thousands ${th}, tens ${t}, ones ${t} − 5 = ${o}.`,
    `So the number is ${1000 * th + 100 * h + 10 * t + o}.`,
  ], 'Call the digit every clue points at 1 unit, and write the others in units.');
};
const periodic = (y) => {
  const p = ri(3, y <= 3 ? 4 : 6), cs = shuffle(COLOURS).slice(0, p), counts = cs.map(() => ri(1, y <= 3 ? 2 : 3)), cycle = cs.flatMap((c, i) => Array(counts[i]).fill(c)), L = cycle.length, n = ri(y <= 3 ? 15 : 40, y <= 3 ? 40 : 120);
  const kind = y >= 4 && Math.random() < 0.5 ? 2 : 1;
  const words = `Beads are threaded in a repeating pattern: ${cycle.join(', ')}, and then the pattern repeats.`;
  if (kind === 1) {
    const col = cycle[(n - 1) % L], per = counts[cs.indexOf(col)], full = Math.floor(n / L), rem = n % L, extra = cycle.slice(0, rem).filter((c) => c === col).length, cnt = full * per + extra;
    return explain(int('logical thinking · periodic problems', `${words} How many ${col} beads are there among the first ${n} beads?`, cnt), [
      `One pattern is ${L} beads long and has ${per} ${col} bead${es(per)} in it.`,
      `${n} ÷ ${L} = ${full} full patterns, remainder ${rem}.`,
      `${full} full patterns give ${full} × ${per} = ${full * per} ${col} beads.`,
      rem ? `The ${rem} bead${es(rem)} left over start${rem === 1 ? 's' : ''} the pattern again: ${extra} of them ${extra === 1 ? 'is' : 'are'} ${col}.` : 'No beads are left over.',
      `${full * per} + ${extra} = ${cnt}. So there are ${cnt} ${col} beads among the first ${n}.`,
    ], 'Divide by the length of the pattern: count the full repeats, then look at the leftover.');
  }
  const target = pick(cs), k = ri(3, y <= 4 ? 8 : 20); // the position of the k-th bead of that colour
  let seen = 0, pos = 0; while (seen < k) { pos++; if (cycle[(pos - 1) % L] === target) seen++; }
  const per = counts[cs.indexOf(target)], full = Math.floor((k - 1) / per), remK = k - full * per;
  let idx = 0, c2 = 0; for (let i = 0; i < L; i++) { if (cycle[i] === target) { c2++; if (c2 === remK) { idx = i + 1; break; } } }
  return explain(int('logical thinking · periodic problems', `${words} In which position is the ${ord(k)} ${target} bead?`, pos), [
    `One pattern is ${L} beads long and has ${per} ${target} bead${es(per)} in it.`,
    full ? `${full} full pattern${es(full)} give${full === 1 ? 's' : ''} ${full * per} ${target} beads and use${full === 1 ? 's' : ''} ${full} × ${L} = ${full * L} beads.` : `Fewer than ${per + 1} ${target} beads are needed, so the ${ord(k)} ${target} bead is inside the first pattern.`,
    `Inside the next pattern, the ${ord(remK)} ${target} bead is at place ${idx}.`,
    `${full * L} + ${idx} = ${pos}. So the ${ord(k)} ${target} bead is in position ${pos}.`,
  ], 'Count how many full patterns are used up, then find the place inside the next pattern.');
};
const pigeonhole = (y) => {
  const cs = shuffle(COLOURS).slice(0, y <= 3 ? 2 : 3), counts = cs.map(() => ri(4, 12)), it = pick(['sock', 'marble', 'ball']);
  const kind = y >= 5 ? ri(1, 3) : ri(1, 2);
  const bag = cs.map((c, i) => `${counts[i]} ${c}`).join(', ').replace(/, ([^,]*)$/, ' and $1');
  if (kind === 1) return explain(int('logical thinking · pigeonhole', `A drawer has ${bag} ${it}s, all mixed up. In the dark, what is the smallest number of ${it}s you must take to be sure of two of the same colour?`, cs.length + 1), [
    `There are ${cs.length} colours: ${list(cs)}.`,
    `The worst case is one ${it} of each colour: ${cs.length} ${it}s, all different.`,
    `The next ${it} must match one of them: ${cs.length} + 1 = ${cs.length + 1}.`,
    `So you must take ${cs.length + 1} ${it}s.`,
  ], 'Think of the worst luck first, then add one more.');
  if (kind === 2) {
    const i = ri(0, cs.length - 1), others = cs.map((c, j) => (j === i ? null : `${counts[j]} ${c}`)).filter(Boolean).join(' and '), rest = sum(counts) - counts[i];
    return explain(int('logical thinking · pigeonhole', `A drawer has ${bag} ${it}s, all mixed up. In the dark, what is the smallest number of ${it}s you must take to be sure of one ${cs[i]} ${it}?`, rest + 1), [
      `The worst case is taking every ${it} that is not ${cs[i]} first.`,
      `Not ${cs[i]}: ${others}, that is ${rest} ${it}s.`,
      `The next ${it} has to be ${cs[i]}: ${rest} + 1 = ${rest + 1}.`,
      `So you must take ${rest + 1} ${it}s.`,
    ], 'Think of the worst luck first, then add one more.');
  }
  const m = ri(3, 4);
  return explain(int('logical thinking · pigeonhole', `A drawer has ${bag} ${it}s, all mixed up. In the dark, what is the smallest number of ${it}s you must take to be sure of ${m} of the same colour?`, (m - 1) * cs.length + 1), [
    `The worst case is ${m - 1} of every colour and still no ${m} the same.`,
    `${m - 1} × ${cs.length} colours = ${(m - 1) * cs.length} ${it}s with no colour reaching ${m}.`,
    `The next ${it} makes ${m} of some colour: ${(m - 1) * cs.length} + 1 = ${(m - 1) * cs.length + 1}.`,
    `So you must take ${(m - 1) * cs.length + 1} ${it}s.`,
  ], 'Think of the worst luck first, then add one more.');
};
const chickenRabbit = (y) => {
  const c = ri(4, y <= 4 ? 14 : 30), r = ri(3, y <= 4 ? 10 : 24), [one, other, a, b] = pick([['chickens', 'rabbits', 2, 4], ['bicycles', 'cars', 2, 4], ['spiders', 'beetles', 8, 6]]);
  const heads = c + r, legs = c * a + r * b, unit = one === 'bicycles' ? 'wheels' : 'legs', oneS = one.slice(0, -1), otherS = other.slice(0, -1);
  return explain(int('logical thinking · chicken and rabbit', `A yard holds only ${one} and ${other}: ${c + r} heads and ${c * a + r * b} legs altogether. How many ${other} are there?`.replace('legs', one === 'bicycles' ? 'wheels' : 'legs').replace('heads', one === 'bicycles' ? 'vehicles' : 'heads'), r), b > a ? [
    `Pretend all ${heads} are ${one}: ${heads} × ${a} = ${heads * a} ${unit}.`,
    `But there are ${legs} ${unit}, so ${legs - heads * a} ${unit} are extra.`,
    `Each ${otherS} has ${b - a} more ${unit} than a ${oneS}: ${legs - heads * a} ÷ ${b - a} = ${r}.`,
    `So there are ${r} ${other}.`,
  ] : [
    `Pretend all ${heads} are ${one}: ${heads} × ${a} = ${heads * a} ${unit}.`,
    `But there are only ${legs} ${unit}, so that is ${heads * a - legs} ${unit} too many.`,
    `Each ${otherS} has ${a - b} fewer ${unit} than a ${oneS}: ${heads * a - legs} ÷ ${a - b} = ${r}.`,
    `So there are ${r} ${other}.`,
  ], 'Pretend they are all one kind, then share out the extra legs.');
};
const speed = (y) => {
  const kind = ri(1, 3);
  if (kind === 1) { const v = pick([40, 50, 60, 80, 90]), t = ri(2, 5); return explain(int('logical thinking · speed', `A train travels at ${v} km/h. How far does it go in ${t} hours, in km?`, v * t), [
    `In 1 hour the train goes ${v} km.`,
    `In ${t} hours: ${v} × ${t} = ${v * t} km.`,
    `So it goes ${v * t} km.`,
  ], 'Distance = speed × time.'); }
  if (kind === 2) { const v1 = pick([40, 50, 60, 80]), v2 = pick([30, 40, 70, 90]), t = ri(2, 7); return explain(int('logical thinking · speed', `Two towns are ${(v1 + v2) * t} km apart. A car leaves one at ${v1} km/h and a van leaves the other at ${v2} km/h at the same time, driving toward each other. After how many hours do they meet?`, t), [
    `Every hour the car and the van together close ${v1} + ${v2} = ${v1 + v2} km of the gap.`,
    `${(v1 + v2) * t} ÷ ${v1 + v2} = ${t}.`,
    `So they meet after ${t} hours.`,
  ], 'Moving toward each other: add the speeds, then divide the distance by that sum.'); }
  const v = pick([4, 5, 6]), t = ri(2, 4), back = pick([2, 3]), dist = v * t; if (dist % back || t <= back) return null; // cycling back must be faster than walking there
  return explain(int('logical thinking · speed', `${names(1)[0]} walks to a lake at ${v} km/h in ${t} hours and cycles back the same way in ${back} hours. What is the cycling speed, in km/h?`, dist / back), [
    `Walking there: ${v} × ${t} = ${dist} km, so the lake is ${dist} km away.`,
    `Cycling back covers the same ${dist} km in ${back} hours: ${dist} ÷ ${back} = ${dist / back} km/h.`,
    `So the cycling speed is ${dist / back} km/h.`,
  ], 'Find the distance first; the way back is the same distance.');
};
const ages = (y) => {
  const t = pick([3, 4, 5, 6, 8, 9, 10, 12, 15]), [k, m] = pick([[3, 2], [4, 2], [4, 3], [5, 3], [5, 2], [6, 4], [7, 4]]);
  const x = (t * (m - 1)) / (k - m); if (!Number.isInteger(x) || k * x < x + 18 || k * x > x + 45) return null; // now: child x, mother kx; in t years mother is m times — and a mother 18 to 45 years older, not 5 or 120 (the source check)
  return explain(int('logical thinking · ages', `A mother is ${k} times as old as her ${pick(['son', 'daughter'])}. In ${t} years she will be ${m} times as old. How old is the child now?`, x), [
    `Now the child is 1 unit and the mother is ${k} units, so the mother is ${k - 1} units older.`,
    `The gap never changes. In ${t} years the child is 1 unit + ${t}, and the mother is ${m} times that: ${m} units + ${m * t}.`,
    `The gap then is ${m - 1} units + ${(m - 1) * t}, and it must equal ${k - 1} units, so ${k - 1} − ${m - 1} = ${k - m} unit${es(k - m)} = ${(m - 1) * t}.`,
    `1 unit = ${(m - 1) * t} ÷ ${k - m} = ${x}.`,
    `So the child is ${x} years old now.`,
  ], 'The difference between two ages never changes.');
};
const daysBetween = (y) => {
  const months = [['March', 31], ['April', 30], ['May', 31], ['June', 30], ['July', 31], ['August', 31], ['September', 30], ['October', 31]]; const i = ri(0, months.length - 2), d1 = ri(1, 25), d2 = ri(1, 28); const days = months[i][1] - d1 + d2;
  const [m1, len] = months[i], m2 = months[i + 1][0], first = len - d1 + 1;
  return explain(int('logical thinking · dates', `How many days are there from ${d1} ${months[i][0]} to ${d2} ${months[i + 1][0]} of the same year, counting both days?`, days + 1), [
    `${m1} has ${len} days. From ${d1} ${m1} to ${len} ${m1}, counting both: ${len} − ${d1} + 1 = ${first} days.`,
    `Then ${d2} day${es(d2)} of ${m2}, from the 1st to the ${ord(d2)}.`,
    `${first} + ${d2} = ${days + 1}. So there are ${days + 1} days.`,
  ], 'Count the days left in the first month (add 1 to include the start), then the days of the next month.');
};
const rowsOfDots = (y) => {
  const a = ri(1, 4), k = ri(1, 3), n = ri(4, y <= 2 ? 6 : 10);
  const rows = Array.from({ length: n }, (_, i) => a + i * k), last = rows[n - 1], total = n * a + (k * n * (n - 1)) / 2;
  return explain(int('logical thinking · figure patterns', `Row 1 of a figure has ${a} dot${a === 1 ? '' : 's'}, row 2 has ${a + k}, row 3 has ${a + 2 * k}, and each row has ${k} more than the one before. How many dots are there in the first ${n} rows altogether?`, total), [
    `The rows go up by ${k} each time: ${list(rows)}.`,
    n <= 6 ? `Add them up: ${plus(rows)} = ${total}.` : `Pair the first row with the last: ${a} + ${last} = ${a + last}, and every pair from the outside in makes ${a + last}.`,
    n <= 6 ? '' : `${n} rows make ${n} ÷ 2 pairs, so the total is ${a + last} × ${n} ÷ 2 = ${total}.`,
    `So there are ${total} dots in the first ${n} rows.`,
  ], 'When the rows go up by the same jump, pair the first with the last.');
};
const pairsCount = (y) => {
  const a = ri(2, y <= 2 ? 4 : 6), b = ri(2, y <= 2 ? 5 : 8), [x, z] = pick([['shirts', 'hats'], ['drinks', 'snacks'], ['roads into town', 'roads out of it'], ['kinds of bread', 'fillings']]);
  return explain(int('combinatorics · pairs', `${names(1)[0]} has ${a} ${x} and ${b} ${z}. How many different ways are there to choose one of each?`, a * b), [
    `For each of the ${a} ${x} there are ${b} ${z} to go with it.`,
    `${a} × ${b} = ${a * b}.`,
    `So there are ${a * b} different ways.`,
  ], 'One from here and one from there: multiply the two counts.');
};
const largestWithDigitSum = (y) => {
  const s = ri(3, 17), t = Math.min(9, s), o = s - t; if (o > 9) return null;
  return explain(int('number theory · digit sums', `What is the largest two-digit number whose digits add up to ${s}?`, 10 * t + o), [
    'To make the number as large as possible, make the tens digit as big as it can be.',
    s >= 9 ? `A digit can be 9 at most, so the tens digit is 9 and the ones digit is ${s} − 9 = ${o}.` : `The tens digit can take all of ${s}: tens digit ${t}, ones digit ${s} − ${t} = ${o}.`,
    `So the largest number is ${10 * t + o}.`,
  ], 'For the largest number, put the most into the front digit.');
};
// ---- Arithmetic ----
const smartAdd = (y) => {
  if (y <= 2) {
    const ps = shuffle([[19, 21], [38, 12], [27, 13], [46, 14], [35, 25], [18, 22], [44, 16], [29, 11]]).slice(0, 2), pairs = ps.flat();
    return explain(int('arithmetic · smart addition', `${shuffle(pairs).join(' + ')} = ?`, sum(pairs)), [
      `Look for two numbers that make a round ten: ${ps[0][0]} + ${ps[0][1]} = ${ps[0][0] + ps[0][1]}.`,
      `The other two: ${ps[1][0]} + ${ps[1][1]} = ${ps[1][0] + ps[1][1]}.`,
      `${ps[0][0] + ps[0][1]} + ${ps[1][0] + ps[1][1]} = ${sum(pairs)}. So the answer is ${sum(pairs)}.`,
    ], 'Pair the numbers whose ones digits add up to 10 first.');
  }
  const base = pick([98, 99, 97, 995, 996]), k = ri(3, 6), round = base < 100 ? 100 : 1000, d = round - base;
  return explain(int('arithmetic · smart addition', `${Array(k).fill(base).join(' + ')} = ?`, base * k), [
    `Each ${base} is ${d} less than ${round}.`,
    `${k} × ${round} = ${k * round}, and the ${k} lots of ${d} we added come to ${k} × ${d} = ${k * d}.`,
    `${k * round} − ${k * d} = ${base * k}. So the answer is ${base * k}.`,
  ], 'Round each number up to 100 or 1000, then take away what you added.');
};
const gauss = (y) => {
  if (y <= 4) { const n = y === 3 ? pick([10, 20, 30]) : pick([50, 100]); return explain(int('arithmetic · Gaussian addition', `1 + 2 + 3 + … + ${n} = ?`, (n * (n + 1)) / 2), [
    `Pair the first with the last: 1 + ${n} = ${n + 1}, 2 + ${n - 1} = ${n + 1}, 3 + ${n - 2} = ${n + 1}, and so on.`,
    `There are ${n} ÷ 2 = ${n / 2} pairs, each making ${n + 1}.`,
    `${n + 1} × ${n / 2} = ${(n * (n + 1)) / 2}. So the sum is ${(n * (n + 1)) / 2}.`,
  ], 'Pair the first with the last: every pair is the same.'); }
  const a = ri(2, 9), d = pick([3, 4, 5, 6, 7]), n = ri(10, 30), last = a + (n - 1) * d;
  return explain(int('arithmetic · Gaussian addition', `${a} + ${a + d} + ${a + 2 * d} + … + ${last} = ?`, (n * (a + last)) / 2), [
    `Count the terms: from ${a} to ${last} in steps of ${d} is (${last} − ${a}) ÷ ${d} + 1 = ${n} terms.`,
    `Pair the first with the last: ${a} + ${last} = ${a + last}, and every pair from the outside in makes ${a + last}.`,
    `${n} terms make ${n} ÷ 2 pairs: ${a + last} × ${n} ÷ 2 = ${(n * (a + last)) / 2}.`,
    `So the sum is ${(n * (a + last)) / 2}.`,
  ], 'Evenly spaced numbers: (first + last) × how many ÷ 2.');
};
const smartFourDigit = () => {
  const kind = ri(1, 3);
  if (kind === 1) { const parts = [9999, 999, 99, 9], rounds = parts.map((p) => p + 1); return explain(int('arithmetic · smart calculation', '9999 + 999 + 99 + 9 = ?', 11106), [
    `Each number is 1 less than a round number: ${rounds.map((r) => `${r} − 1`).join(', ')}.`,
    `${plus(rounds)} = ${sum(rounds)}.`,
    `Take away the ${parts.length} ones: ${sum(rounds)} − ${parts.length} = ${sum(rounds) - parts.length}.`,
    `So the answer is ${sum(rounds) - parts.length}.`,
  ], 'Numbers like 999 are 1 less than a round number: add the round numbers, then take away the 1s.'); }
  if (kind === 2) { const a = ri(1000, 9999), b = 10000 - a + ri(0, 999), r = a + b - 10000; return explain(int('arithmetic · smart calculation', `${a} + ${b} = ?`, a + b), [
    `${a} needs ${10000 - a} more to reach 10000.`,
    `Take ${10000 - a} from ${b}: ${b} − ${10000 - a} = ${r}.`,
    `10000 + ${r} = ${a + b}. So the answer is ${a + b}.`,
  ], 'Make one number up to a round 10000, then add what is left.'); }
  const n = ri(1001, 4999);
  return explain(int('arithmetic · smart calculation', `${n} + 9999 = ?`, n + 9999), [
    '9999 is 1 less than 10000.',
    `${n} + 10000 = ${n + 10000}, then take away the 1: ${n + 10000} − 1 = ${n + 9999}.`,
    `So the answer is ${n + 9999}.`,
  ], 'Add the round number, then take away the 1 you added.');
};
const multiplyTrick = () => {
  const kind = ri(1, 3);
  if (kind === 1) { const a = pick([4, 8, 16, 32]); return explain(int('arithmetic · smart calculation', `25 × ${a} × 125 = ?`, 25 * a * 125), a === 4 ? [
    '25 × 4 = 100, so pair the 25 with the 4 first.',
    `100 × 125 = ${100 * 125}.`,
    `So the answer is ${25 * a * 125}.`,
  ] : [
    `125 × 8 = 1000, and ${a} = 8 × ${a / 8}, so 125 × ${a} = ${125 * a}.`,
    `25 × ${125 * a} = ${25 * a * 125}.`,
    `So the answer is ${25 * a * 125}.`,
  ], '25 × 4 = 100 and 125 × 8 = 1000: look for these pairs before multiplying.'); }
  if (kind === 2) { const a = ri(3, 9); return explain(int('arithmetic · smart calculation', `999 × ${a} = ?`, 999 * a), [
    '999 is 1 less than 1000.',
    `1000 × ${a} = ${1000 * a}, then take away 1 × ${a} = ${a}: ${1000 * a} − ${a} = ${999 * a}.`,
    `So the answer is ${999 * a}.`,
  ], 'Multiply by the round number, then take away the extra.'); }
  const a = ri(11, 19), b = ri(11, 19);
  return explain(int('arithmetic · 3-digit multiplication', `${a * 10} × ${b} = ?`, a * 10 * b), [
    `${a * 10} × ${b} is ${a} × ${b} with a 0 put back at the end.`,
    `${a} × ${b}: ${a} × 10 = ${a * 10} and ${a} × ${b - 10} = ${a * (b - 10)}, so ${a * 10} + ${a * (b - 10)} = ${a * b}.`,
    `${a * b} × 10 = ${a * b * 10}. So the answer is ${a * 10 * b}.`,
  ], 'Take the 0 off, multiply, then put the 0 back.');
};
const geometricSum = () => {
  const kind = ri(1, 2);
  if (kind === 1) { const n = ri(6, 10); return explain(int('arithmetic · sum of a geometric sequence', `1 + 2 + 4 + 8 + … + ${2 ** n} = ?`, 2 ** (n + 1) - 1), [
    'Each number is double the one before. Try short sums: 1 + 2 = 3, 1 + 2 + 4 = 7, 1 + 2 + 4 + 8 = 15.',
    'Every sum is 1 less than the next number in the line: 3 = 4 − 1, 7 = 8 − 1, 15 = 16 − 1.',
    `The last number is ${2 ** n}, so the next would be ${2 ** (n + 1)}: the sum is ${2 ** (n + 1)} − 1 = ${2 ** (n + 1) - 1}.`,
    `So the sum is ${2 ** (n + 1) - 1}.`,
  ], 'Doubling sums: the total is 1 less than the next double.'); }
  const n = ri(4, 6);
  return explain(int('arithmetic · sum of a geometric sequence', `1 + 3 + 9 + … + ${3 ** n} = ?`, (3 ** (n + 1) - 1) / 2), [
    'Each number is 3 times the one before. Try short sums: 1 + 3 = 4, 1 + 3 + 9 = 13, 1 + 3 + 9 + 27 = 40.',
    'Every sum is half of (the next number − 1): 4 = (9 − 1) ÷ 2, 13 = (27 − 1) ÷ 2, 40 = (81 − 1) ÷ 2.',
    `The next number after ${3 ** n} is ${3 ** (n + 1)}: (${3 ** (n + 1)} − 1) ÷ 2 = ${(3 ** (n + 1) - 1) / 2}.`,
    `So the sum is ${(3 ** (n + 1) - 1) / 2}.`,
  ], 'Try the first few sums and spot the pattern against the next term.');
};
const squaresSum = () => {
  const n = ri(5, 12), sq = Array.from({ length: n }, (_, i) => (i + 1) * (i + 1)), total = (n * (n + 1) * (2 * n + 1)) / 6;
  return explain(int('arithmetic · sum of squares', `1² + 2² + 3² + … + ${n}² = ?`, total), [
    `Work out each square: ${list(sq)}.`,
    `Add them: ${plus(sq)} = ${total}.`,
    `Check with the pattern: ${n} × ${n + 1} × ${2 * n + 1} ÷ 6 = ${total}.`,
    `So the sum is ${total}.`,
  ], 'The first n squares add up to n × (n + 1) × (2n + 1) ÷ 6.');
};
const decimalTrick = () => {
  const kind = ri(1, 2);
  if (kind === 1) { const a = ri(13, 99); return explain(int('arithmetic · decimals', `0.25 × ${a} × 4 = ?`, a), [
    '0.25 × 4 = 1, so pair those two first.',
    `1 × ${a} = ${a}.`,
    `So the answer is ${a}.`,
  ], '0.25 × 4 = 1, 0.5 × 2 = 1 and 12.5 × 8 = 100: find the pair that makes a round number.'); }
  const a = ri(2, 9);
  return explain(int('arithmetic · decimals', `0.5 × ${a * 2} × 12.5 × 8 = ?`, a * 100), [
    `0.5 × ${a * 2} = ${a}, and 12.5 × 8 = 100.`,
    `${a} × 100 = ${a * 100}.`,
    `So the answer is ${a * 100}.`,
  ], '0.25 × 4 = 1, 0.5 × 2 = 1 and 12.5 × 8 = 100: find the pair that makes a round number.');
};
const fractionChain = () => {
  const base = pick([2, 3]), n = ri(4, 7), p = base ** n, num0 = p - 1, den0 = base === 2 ? p : 2 * p, g = gcd(num0, den0), A = num0 / g, B = den0 / g;
  // one wording for every length and base, so the sweep sees the answer move (the explicit four-term form always answered 31 and failed a deploy's test run, 20 Sep 2026)
  return explain(int('arithmetic · fractions', `1/${base} + 1/${base * base} + 1/${base ** 3} + … + 1/${p} is a fraction a/b in its simplest form. What is a + b?`, num0 / g + den0 / g), base === 2 ? [
    'Think of a cake: 1/2, then 1/4, then 1/8 … each piece is half of what is left.',
    `After ${n} pieces, 1/${p} of the cake is left, so the pieces add up to 1 − 1/${p} = ${A}/${B}.`,
    `a + b = ${A} + ${B} = ${A + B}. So a + b = ${A + B}.`,
  ] : [
    'Each fraction is half of a gap: 1/3 = (1 − 1/3) ÷ 2, 1/9 = (1/3 − 1/9) ÷ 2, 1/27 = (1/9 − 1/27) ÷ 2, and so on.',
    `Add the gaps and the middle parts cancel: (1 − 1/${p}) ÷ 2.`,
    `1 − 1/${p} = ${p - 1}/${p}, and half of that is ${A}/${B}.`,
    `a + b = ${A} + ${B} = ${A + B}. So a + b = ${A + B}.`,
  ], 'A chain that keeps dividing by the same number: look at what is left of the whole.');
};
const missingDigit = (y) => {
  const A = ri(1, 9), a = ri(0, 9), b = ri(10, y <= 2 ? 50 : 89), s = 10 * A + a + b;
  return explain(int('arithmetic · missing digit', `In the sum ▢${a} + ${b} = ${s}, what digit is ▢?`, A, { read: `A two-digit number with ones digit ${a} plus ${b} makes ${s}. What is its tens digit?` }), [
    `The number ▢${a} plus ${b} makes ${s}, so ▢${a} = ${s} − ${b} = ${s - b}.`,
    `${s - b} has ones digit ${a} and tens digit ${A}.`,
    `So ▢ is ${A}.`,
  ], 'To find a missing part of a sum, take the known part away from the total.');
};
// ---- Number Theory ----
const evenOddCount = (y) => {
  const a = ri(1, 20), n = ri(10, y <= 2 ? 30 : 60), b = a + n, even = Math.random() < 0.5; let c = 0; for (let k = a; k <= b; k++) if ((k % 2 === 0) === even) c++;
  const want = even ? 0 : 1, f = a % 2 === want ? a : a + 1, l = b % 2 === want ? b : b - 1, w = even ? 'even' : 'odd';
  return explain(int('number theory · odd and even', `How many ${even ? 'even' : 'odd'} numbers are there from ${a} to ${b}, counting both?`, c), [
    `The first ${w} number from ${a} is ${f}, and the last ${w} number up to ${b} is ${l}.`,
    `${even ? 'Even' : 'Odd'} numbers go up in 2s: from ${f} to ${l} is (${l} − ${f}) ÷ 2 = ${(l - f) / 2} jumps.`,
    `${(l - f) / 2} jumps means ${(l - f) / 2} + 1 = ${c} numbers.`,
    `So there are ${c} ${w} numbers.`,
  ], 'Find the first and the last, count the jumps of 2, then add 1.');
};
const digitCount = (y) => {
  const d = ri(1, 9), n = y <= 3 ? pick([50, 60, 80, 100]) : pick([100, 150, 200]); let c = 0; for (let k = 1; k <= n; k++) c += digitsOf(k).filter((x) => x === d).length;
  let ones = 0, tens = 0, hundreds = 0; for (let k = 1; k <= n; k++) { if (k % 10 === d) ones++; if (Math.floor(k / 10) % 10 === d) tens++; if (Math.floor(k / 100) % 10 === d) hundreds++; }
  return explain(int('number theory · digits', `When the whole numbers from 1 to ${n} are written down, how many times is the digit ${d} written?`, c), [
    `Count place by place. In the ones place: ${d}, ${10 + d}, ${20 + d}, … once in every ten numbers: ${ones} times.`,
    `In the tens place: ${10 * d} to ${10 * d + 9}${n >= 100 + 10 * d ? `, and ${100 + 10 * d} to ${Math.min(n, 100 + 10 * d + 9)}` : ''}: ${tens} times.`,
    hundreds ? `In the hundreds place: from ${100 * d}: ${hundreds} time${es(hundreds)}.` : '',
    `${ones} + ${tens}${hundreds ? ` + ${hundreds}` : ''} = ${c}. So the digit ${d} is written ${c} times.`,
  ], 'Count place by place: ones, then tens, then hundreds.');
};
const primesQ = (y) => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const lo = pick([10, 20, 30, 40, 50, 60]), hi = lo + pick([10, 20, 30]); let n = 0; for (let k = lo + 1; k < hi; k++) if (isPrime(k)) n++;
    const ps = []; for (let k = lo + 1; k < hi; k++) if (isPrime(k)) ps.push(k);
    return explain(int('number theory · primes', `How many prime numbers are there between ${lo} and ${hi}?`, n), [
      'Cross out the even numbers, then the multiples of 3, 5 and 7: whatever is left below 100 is prime.',
      `The primes between ${lo} and ${hi}: ${list(ps)}.`,
      `Count them: ${n}. So there are ${n} prime numbers.`,
    ], 'Below 100, a number is prime when 2, 3, 5 and 7 do not divide it.');
  }
  if (kind === 2) {
    const n = ri(30, 120); let p = n - 1; while (!isPrime(p)) p--;
    const skipped = []; for (let k = n - 1; k > p; k--) { let f = 2; while (k % f) f++; skipped.push(`${k} = ${f} × ${k / f}`); }
    return explain(int('number theory · primes', `What is the largest prime number less than ${n}?`, p), [
      `Go down from ${n - 1} and test each number for a small factor.`,
      skipped.length ? `Not prime: ${list(skipped)}.` : `${n - 1} is the first number below ${n}.`,
      `${p} has no factor except 1 and itself, so it is prime.`,
      `So the largest prime less than ${n} is ${p}.`,
    ], 'Go down from the number and test each one for a small factor.');
  }
  const lo = pick([10, 20, 30]), hi = lo + 10; let s = 0; for (let k = lo + 1; k < hi; k++) if (isPrime(k)) s += k;
  const ps = []; for (let k = lo + 1; k < hi; k++) if (isPrime(k)) ps.push(k);
  return explain(int('number theory · primes', `What is the sum of all the prime numbers between ${lo} and ${hi}?`, s), [
    `The primes between ${lo} and ${hi} are ${list(ps)}.`,
    `${plus(ps)} = ${s}.`,
    `So the sum is ${s}.`,
  ], 'List the primes first, then add.');
};
const lcmHcf = () => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const a = pick([4, 6, 8, 9, 10, 12, 15]), b = pick([6, 8, 9, 10, 12, 14, 18]); if (a === b) return null;
    const L = lcm(a, b), ma = [], mb = []; for (let k = a; k <= L; k += a) ma.push(k); for (let k = b; k <= L; k += b) mb.push(k);
    return explain(int('number theory · LCM', `Two lights flash every ${a} seconds and every ${b} seconds. They flash together now. After how many seconds do they next flash together?`, lcm(a, b)), [
      `The first light flashes at ${list(ma)} seconds.`,
      `The second light flashes at ${list(mb)} seconds.`,
      `The first number in both lists is ${L}.`,
      `So they next flash together after ${L} seconds.`,
    ], 'The first time two things happen together is the lowest common multiple.');
  }
  if (kind === 2) {
    const g = pick([6, 8, 12, 15]), a = g * pick([2, 3, 5]), b = g * pick([3, 4, 7]); if (a === b) return null; const G = gcd(a, b);
    return explain(int('number theory · HCF', `What is the highest common factor of ${a} and ${b}?`, gcd(a, b)), [
      `Factors of ${a}: ${list(factorsOf(a))}.`,
      `Factors of ${b}: ${list(factorsOf(b))}.`,
      `The largest number in both lists is ${G}.`,
      `So the highest common factor is ${G}.`,
    ], 'List the factors of both numbers and pick the largest one they share.');
  }
  const g = pick([4, 6, 9, 12]), a = g * pick([2, 3, 5]), b = g * pick([4, 7]), G = gcd(a, b);
  return explain(int('number theory · HCF', `Ribbons of ${a} cm and ${b} cm are cut into pieces of the same length, as long as possible, with nothing left over. How long is each piece, in cm?`, gcd(a, b)), [
    `The piece must measure exactly into both ${a} cm and ${b} cm, so its length is a common factor.`,
    `Factors of ${a}: ${list(factorsOf(a))}. Factors of ${b}: ${list(factorsOf(b))}.`,
    `The largest factor in both lists is ${G}.`,
    `So each piece is ${G} cm long.`,
  ], '"As long as possible with nothing left over" means the highest common factor.');
};
const divisibility = (y) => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const d = pick([3, 9]), a = ri(1, 9), b = ri(0, 9), c = ri(0, 9); let x = 0; while ((a + b + c + x) % d !== 0) x++; const s = a + b + c;
    return explain(int('number theory · divisibility', `What is the smallest digit that can replace ▢ so that ${a}${b}${c}▢ is divisible by ${d}?`, x, { read: `What is the smallest digit that can go on the end of ${a}${b}${c} so the number is divisible by ${d}?` }), [
      `A number is divisible by ${d} when its digits add up to a multiple of ${d}.`,
      `${a} + ${b} + ${c} = ${s}.`,
      `The smallest multiple of ${d} that is at least ${s} is ${s + x}, so ▢ = ${s + x} − ${s} = ${x}.`,
      `So the smallest digit is ${x}.`,
    ], 'Divisible by 3 or 9: add the digits and test the sum.');
  }
  if (kind === 2) {
    const d = pick([6, 7, 8, 9, 12]), n = pick([100, 200, 300]), q = Math.floor(n / d);
    return explain(int('number theory · divisibility', `How many multiples of ${d} are there from 1 to ${n}?`, Math.floor(n / d)), [
      `The multiples of ${d} are ${d}, ${2 * d}, ${3 * d}, … one in every ${d} numbers.`,
      `${n} ÷ ${d} = ${q} remainder ${n % d}, so ${q} multiples fit: the last is ${d} × ${q} = ${d * q}.`,
      `So there are ${q} multiples of ${d}.`,
    ], 'How many multiples up to n: divide n and ignore the remainder.');
  }
  const a = pick([3, 4, 5]), b = pick([4, 5, 6, 7]); if (a === b) return null; const n = pick([100, 200, 300]), L = lcm(a, b), qa = Math.floor(n / a), qL = Math.floor(n / L);
  return explain(int('number theory · divisibility', `How many whole numbers from 1 to ${n} are divisible by ${a} but not by ${b}?`, Math.floor(n / a) - Math.floor(n / lcm(a, b))), [
    `Multiples of ${a} up to ${n}: ${n} ÷ ${a} = ${qa} (ignore the remainder).`,
    `Some of these are also multiples of ${b}: those are the multiples of ${L}, and ${n} ÷ ${L} = ${qL}.`,
    `${qa} − ${qL} = ${qa - qL}. So there are ${qa - qL} such numbers.`,
  ], 'Count the multiples, then take away the ones that also fit the other number.');
};
const factorsCount = () => {
  const n = pick([36, 48, 60, 72, 84, 90, 96, 100, 120, 144, 180, 200, 240, 360, 720]), pf = primeFactors(n), tree = pf.flatMap(([p, e]) => Array(e).fill(p)), cnt = factorsOf(n).length;
  return explain(int('number theory · number of factors', `How many positive factors does ${n} have?`, factorsOf(n).length), [
    `Break ${n} into primes: ${n} = ${tree.join(' × ')}.`,
    `As powers: ${pf.map(([p, e]) => powerText(p, e)).join(' × ')}. The powers are ${list(pf.map(([, e]) => e))}.`,
    `Add 1 to each power and multiply: ${pf.map(([, e]) => `(${e} + 1)`).join(' × ')} = ${pf.map(([, e]) => e + 1).join(' × ')} = ${cnt}.`,
    `So ${n} has ${cnt} factors.`,
  ], 'Number of factors: add 1 to each prime power and multiply.');
};
const factorsSum = () => {
  const n = pick([12, 18, 20, 24, 28, 30, 36, 40, 45, 48]), fs = factorsOf(n), pairs = fs.filter((f) => f * f <= n).map((f) => `${f} × ${n / f}`);
  return explain(int('number theory · sum of factors', `What is the sum of all the positive factors of ${n}?`, sum(factorsOf(n))), [
    `Find the factors in pairs that multiply to ${n}: ${list(pairs)}.`,
    `So the factors are ${list(fs)}.`,
    `${plus(fs)} = ${sum(fs)}.`,
    `So the sum is ${sum(fs)}.`,
  ], 'List factors in pairs that multiply to the number so none is missed.');
};
const unitDigit = () => {
  const base = pick([2, 3, 4, 7, 8, 9]), cyc = { 2: [2, 4, 8, 6], 3: [3, 9, 7, 1], 4: [4, 6], 7: [7, 9, 3, 1], 8: [8, 4, 2, 6], 9: [9, 1] }[base], n = ri(10, 99), L = cyc.length, r = n % L, ans = cyc[(n - 1) % L];
  return explain(int('number theory · unit digit', `What is the ones digit of ${base} to the power ${n}, that is ${base} multiplied by itself ${n} times?`, cyc[(n - 1) % cyc.length]), [
    `The ones digits of the powers of ${base} repeat: ${list(cyc)}, then again. The cycle is ${L} long.`,
    `${n} ÷ ${L} = ${Math.floor(n / L)} remainder ${r}.`,
    r ? `A remainder of ${r} means the ${ord(r)} digit of the cycle: ${ans}.` : `A remainder of 0 means the last digit of the cycle: ${ans}.`,
    `So the ones digit is ${ans}.`,
  ], 'Ones digits of powers repeat in a short cycle: find the cycle, then use the remainder.');
};
const remainders = () => {
  const a = pick([3, 4, 5]), b = pick([5, 7]); if (a === b) return null; const ra = ri(1, a - 1), rb = ri(1, b - 1); if (ra === rb) return null; let N = 1; while (N % a !== ra || N % b !== rb) N++; if (N <= b) return null;
  const cands = []; for (let k = rb; k <= N; k += b) cands.push(k);
  return explain(int('number theory · remainders', `A number leaves a remainder of ${ra} when divided by ${a}, and a remainder of ${rb} when divided by ${b}. What is the smallest such number?`, N), [
    `Numbers that leave ${rb} when divided by ${b}: ${list(cands)}, …`,
    `Divide each by ${a} and look at the remainder: ${cands.map((k) => `${k} leaves ${k % a}`).join(', ')}.`,
    `${N} is the first to leave ${ra}: ${N} ÷ ${a} = ${Math.floor(N / a)} remainder ${ra}, and ${N} ÷ ${b} = ${Math.floor(N / b)} remainder ${rb}.`,
    `So the smallest such number is ${N}.`,
  ], 'List the numbers that fit the bigger divisor, then test them against the smaller one.');
};
const digitSumProperty = () => {
  const s = ri(12, 24), n = pick([3, 4]); let k = 10 ** (n - 1); while (sum(digitsOf(k)) !== s) k++;
  const front = Math.max(1, s - 9 * (n - 1)), ds = digitsOf(k);
  return explain(int('number theory · digit sums', `What is the smallest ${n}-digit number whose digits add up to ${s}?`, k), [
    'To keep the number small, keep the front digit small and push the digit sum to the back with 9s.',
    `The back ${n - 1} digits can hold at most ${9 * (n - 1)}, so the front digit must be at least ${front}: use ${front}.`,
    `The other digits must add up to ${s} − ${front} = ${s - front}: fill from the right with 9s, then what is left.`,
    `That gives ${k}. Check: ${plus(ds)} = ${s}.`,
    `So the smallest ${n}-digit number is ${k}.`,
  ], 'Smallest number with a digit sum: smallest front digit, then 9s at the back.');
};
// ---- Geometry ----
const shapesQ = () => {
  const c = pick([
    ['How many sides does a hexagon have?', 6, ['A hexagon is the shape with 6 sides, like a honeycomb cell.', 'So a hexagon has 6 sides.']],
    ['How many corners does an octagon have?', 8, ['An octagon has 8 sides, like a stop sign.', 'A flat shape has as many corners as sides: 8.', 'So an octagon has 8 corners.']],
    ['How many sides do a triangle and a pentagon have altogether?', 8, ['A triangle has 3 sides and a pentagon has 5 sides.', '3 + 5 = 8.', 'So they have 8 sides altogether.']],
    ['How many corners do two squares and a triangle have altogether?', 11, ['A square has 4 corners, so two squares have 4 + 4 = 8.', 'A triangle has 3 corners: 8 + 3 = 11.', 'So there are 11 corners altogether.']],
    ['How many faces does a cube have?', 6, ['A cube is like a dice: top, bottom, front, back, left and right.', 'That is 6 faces.', 'So a cube has 6 faces.']],
    ['How many edges does a cube have?', 12, ['A cube has 4 edges round the top, 4 round the bottom and 4 standing up.', '4 + 4 + 4 = 12.', 'So a cube has 12 edges.']],
    ['How many vertices does a square-based pyramid have?', 5, ['The square base has 4 corners.', 'The point at the top is 1 more: 4 + 1 = 5.', 'So it has 5 vertices.']],
    ['How many edges does a triangular prism have?', 9, ['Each triangle end has 3 edges: 3 + 3 = 6.', 'Three more edges join the two ends: 6 + 3 = 9.', 'So it has 9 edges.']],
    ['How many faces does a cuboid have?', 6, ['A cuboid is a box: top, bottom, front, back, left and right.', 'That is 6 faces.', 'So a cuboid has 6 faces.']],
  ]);
  return explain(int('geometry · shapes and solids', c[0], c[1]), c[2], 'Tri means 3, penta 5, hexa 6, octa 8; for a solid, count the top, the bottom and what joins them.');
};
const countSquares = (y) => {
  const n = y <= 2 ? 2 : y <= 4 ? 3 : pick([4, 5]);
  if (y >= 5 && Math.random() < 0.5) {
    const r = ri(2, 3), c = ri(3, 4), H = choose(r + 1, 2), V = choose(c + 1, 2);
    return explain(withFigure(int('geometry · counting figures', `How many rectangles of every size, squares included, are there in this ${r} by ${c} grid?`, choose(r + 1, 2) * choose(c + 1, 2)), grid('Count the rectangles', r, c)), [
      `A rectangle is made by choosing 2 of the ${r + 1} horizontal lines and 2 of the ${c + 1} vertical lines.`,
      `Pairs of horizontal lines: ${r + 1} × ${r} ÷ 2 = ${H}. Pairs of vertical lines: ${c + 1} × ${c} ÷ 2 = ${V}.`,
      `${H} × ${V} = ${H * V}. So there are ${H * V} rectangles.`,
    ], 'Every rectangle is two horizontal lines and two vertical lines.');
  }
  const sizes = Array.from({ length: n }, (_, i) => (n - i) * (n - i)), total = sum(sizes);
  return explain(withFigure(int('geometry · counting figures', `How many squares of every size are there in this ${n} by ${n} grid?`, sum(Array.from({ length: n }, (_, i) => (i + 1) * (i + 1)))), grid('Count the squares', n, n)), [
    'Count by size, small to large.',
    ...Array.from({ length: n }, (_, i) => `${i + 1} by ${i + 1} squares: ${n - i} × ${n - i} = ${(n - i) * (n - i)}.`),
    `${plus(sizes)} = ${total}. So there are ${total} squares.`,
  ], 'Count the squares size by size: 1 by 1, then 2 by 2, and so on.');
};
const perimeterArea = (y) => {
  const kind = y <= 4 ? ri(1, 3) : ri(1, 4);
  if (kind === 1) { const l = ri(4, 20), w = ri(2, l - 1); return explain(int('geometry · perimeter', `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter, in cm?`, 2 * (l + w)), [
    `The perimeter is the distance all the way round: ${l} + ${w} + ${l} + ${w}.`,
    `${l} + ${w} = ${l + w}, and twice that is ${2 * (l + w)}.`,
    `So the perimeter is ${2 * (l + w)} cm.`,
  ], 'Perimeter of a rectangle: add the length and the width, then double.'); }
  if (kind === 2) { const s = ri(3, 15); return explain(int('geometry · area', `A square has a perimeter of ${4 * s} cm. What is its area, in cm²?`, s * s), [
    `A square has 4 equal sides: ${4 * s} ÷ 4 = ${s} cm each.`,
    `Area = side × side = ${s} × ${s} = ${s * s}.`,
    `So the area is ${s * s} cm².`,
  ], 'From the perimeter of a square, divide by 4 to get the side first.'); }
  if (kind === 3) { const n = ri(3, 12); return explain(int('geometry · perimeter', `${n} unit squares are placed side by side in one row to make a rectangle. What is the perimeter of the rectangle?`, 2 * n + 2), [
    `The rectangle is ${n} units long and 1 unit wide.`,
    `Perimeter = ${n} + 1 + ${n} + 1 = ${2 * n + 2}.`,
    `So the perimeter is ${2 * n + 2}.`,
  ], 'Squares in a row make a rectangle n long and 1 wide.'); }
  const L = ri(8, 20), W = ri(6, 15), l = ri(2, L - 3), w = ri(2, W - 3);
  return explain(int('geometry · area', `An L-shaped floor is a ${L} m by ${W} m rectangle with a ${l} m by ${w} m rectangle cut from one corner. What is its area, in m²?`, L * W - l * w), [
    `The whole rectangle: ${L} × ${W} = ${L * W} m².`,
    `The corner cut out: ${l} × ${w} = ${l * w} m².`,
    `${L * W} − ${l * w} = ${L * W - l * w}. So the area is ${L * W - l * w} m².`,
  ], 'An L-shape is a big rectangle with a small one cut out.');
};
const anglesQ = () => {
  const kind = ri(1, 3);
  if (kind === 1) { const a = ri(25, 80), b = ri(20, 175 - a); return explain(int('geometry · angles', `Two angles of a triangle are ${a}° and ${b}°. What is the third angle, in degrees?`, 180 - a - b), [
    'The three angles of a triangle add up to 180°.',
    `${a} + ${b} = ${a + b}, and 180 − ${a + b} = ${180 - a - b}.`,
    `So the third angle is ${180 - a - b}°.`,
  ], 'Triangle 180°, four-sided shape 360°, straight line 180°.'); }
  if (kind === 2) { const a = ri(50, 120), b = ri(50, 120), c = ri(30, 359 - a - b - 20); return explain(int('geometry · angles', `Three angles of a quadrilateral are ${a}°, ${b}° and ${c}°. What is the fourth angle, in degrees?`, 360 - a - b - c), [
    'The four angles of a quadrilateral add up to 360°.',
    `${a} + ${b} + ${c} = ${a + b + c}, and 360 − ${a + b + c} = ${360 - a - b - c}.`,
    `So the fourth angle is ${360 - a - b - c}°.`,
  ], 'Triangle 180°, four-sided shape 360°, straight line 180°.'); }
  const a = ri(30, 150);
  return explain(int('geometry · angles', `Two angles together make a straight line. One is ${a}°. What is the other, in degrees?`, 180 - a), [
    'Angles on a straight line add up to 180°.',
    `180 − ${a} = ${180 - a}.`,
    `So the other angle is ${180 - a}°.`,
  ], 'Triangle 180°, four-sided shape 360°, straight line 180°.');
};
const circleQ = () => {
  const r = pick([7, 14, 21, 28]), kind = ri(1, 2);
  if (kind === 1) return explain(int('geometry · circles', `Taking π as 22/7, what is the area of a circle of radius ${r} cm, in cm²?`, (22 / 7) * r * r), [
    'Area of a circle = π × radius × radius.',
    `22/7 × ${r} × ${r}: divide by 7 first, ${r} ÷ 7 = ${r / 7}, then 22 × ${r / 7} × ${r} = ${(22 / 7) * r * r}.`,
    `So the area is ${(22 / 7) * r * r} cm².`,
  ], 'With π as 22/7, divide by 7 first, then multiply by 22.');
  return explain(int('geometry · circles', `Taking π as 22/7, what is the circumference of a circle of diameter ${2 * r} cm, in cm?`, 2 * (22 / 7) * r), [
    'Circumference = π × diameter.',
    `22/7 × ${2 * r}: divide by 7 first, ${2 * r} ÷ 7 = ${(2 * r) / 7}, then 22 × ${(2 * r) / 7} = ${2 * (22 / 7) * r}.`,
    `So the circumference is ${2 * (22 / 7) * r} cm.`,
  ], 'With π as 22/7, divide by 7 first, then multiply by 22.');
};
const volumeSurface = () => {
  const kind = ri(1, 3);
  if (kind === 1) { const s = ri(2, 9); return explain(int('geometry · volume', `What is the volume of a cube with edges of ${s} cm, in cm³?`, s ** 3), [
    'Volume of a cube = edge × edge × edge.',
    `${s} × ${s} = ${s * s}, and ${s * s} × ${s} = ${s ** 3}.`,
    `So the volume is ${s ** 3} cm³.`,
  ], 'Volume is length × width × height; a cube has all three the same.'); }
  if (kind === 2) { const s = ri(2, 9); return explain(int('geometry · surface area', `What is the total surface area of a cube with edges of ${s} cm, in cm²?`, 6 * s * s), [
    `One face is a square: ${s} × ${s} = ${s * s} cm².`,
    `A cube has 6 faces: 6 × ${s * s} = ${6 * s * s}.`,
    `So the surface area is ${6 * s * s} cm².`,
  ], 'Surface area of a cube: one face, times 6.'); }
  const l = ri(3, 10), w = ri(2, 8), h = ri(2, 6);
  return explain(int('geometry · volume', `A cuboid is ${l} cm by ${w} cm by ${h} cm. What is its volume, in cm³?`, l * w * h), [
    'Volume of a cuboid = length × width × height.',
    `${l} × ${w} = ${l * w}, and ${l * w} × ${h} = ${l * w * h}.`,
    `So the volume is ${l * w * h} cm³.`,
  ], 'Volume is length × width × height.');
};
const areaRatio = () => {
  const kind = ri(1, 2);
  if (kind === 1) { const A = ri(5, 30) * 2; return explain(int('geometry · ratio of areas', `A triangle is drawn inside a rectangle with the same base and the same height. The rectangle has an area of ${A} cm². What is the area of the triangle, in cm²?`, A / 2), [
    'A triangle with the same base and height as a rectangle fills exactly half of it.',
    `${A} ÷ 2 = ${A / 2}.`,
    `So the area of the triangle is ${A / 2} cm².`,
  ], 'Same base and height: the triangle is half the rectangle.'); }
  const s = ri(2, 9), k = pick([2, 3]);
  return explain(int('geometry · ratio of areas', `A square has an area of ${s * s} cm². Every side is made ${k} times as long. What is the new area, in cm²?`, s * s * k * k), [
    `The side is ${s} cm, because ${s} × ${s} = ${s * s}.`,
    `The new side is ${s} × ${k} = ${s * k} cm.`,
    `New area: ${s * k} × ${s * k} = ${s * s * k * k}. So the new area is ${s * s * k * k} cm².`,
  ], 'Make the sides k times as long and the area becomes k × k times as big.');
};
// ---- Combinatorics ----
const twoDigitFromDigits = (y) => {
  const k = y <= 2 ? 3 : ri(3, 4), ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k).sort((a, b) => a - b);
  if (y >= 3 && Math.random() < 0.5) {
    const evens = ds.filter((d) => d % 2 === 0).length; if (!evens) return null; const ev = ds.filter((d) => d % 2 === 0);
    return explain(int('combinatorics · forming numbers', `Using the digits ${ds.join(', ')}, with no digit used twice in a number, how many different even two-digit numbers can be formed?`, evens * (k - 1)), [
      `An even number ends in an even digit. The even digits here: ${list(ev)}, so ${evens} choice${es(evens)} for the ones digit.`,
      `The tens digit can be any of the other ${k - 1} digits.`,
      `${evens} × ${k - 1} = ${evens * (k - 1)}. So ${evens * (k - 1)} even two-digit numbers can be formed.`,
    ], 'Fill the place with a rule first, then the other places.');
  }
  const all = []; for (const t of ds) for (const u of ds) if (t !== u) all.push(10 * t + u);
  return explain(int('combinatorics · forming numbers', `Using the digits ${ds.join(', ')}, with no digit used twice in a number, how many different two-digit numbers can be formed?`, k * (k - 1)), [
    `The tens digit can be any of the ${k} digits.`,
    `The ones digit can be any of the ${k - 1} digits left.`,
    k === 3 ? `List them: ${list(all)}.` : '',
    `${k} × ${k - 1} = ${k * (k - 1)}. So ${k * (k - 1)} two-digit numbers can be formed.`,
  ], 'Fill the places one at a time and multiply the choices.');
};
const threeDigitFromDigits = () => {
  const withZero = Math.random() < 0.5, k = ri(4, 5), ds = (withZero ? [0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k - 1)] : shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k)).sort((a, b) => a - b);
  const total = withZero ? (k - 1) * (k - 1) * (k - 2) : k * (k - 1) * (k - 2);
  return explain(int('combinatorics · forming numbers', `Using the digits ${ds.join(', ')}, with no digit used twice in a number, how many different three-digit numbers can be formed?`, total), withZero ? [
    `The hundreds digit cannot be 0: ${k - 1} choices.`,
    `The tens digit: any of the ${k - 1} digits left (0 is allowed now).`,
    `The ones digit: ${k - 2} digits left.`,
    `${k - 1} × ${k - 1} × ${k - 2} = ${total}. So ${total} three-digit numbers can be formed.`,
  ] : [
    `Hundreds digit: ${k} choices. Tens digit: ${k - 1} left. Ones digit: ${k - 2} left.`,
    `${k} × ${k - 1} × ${k - 2} = ${total}.`,
    `So ${total} three-digit numbers can be formed.`,
  ], 'A number cannot start with 0: fill the front place first.');
};
const handshakes = (y) => {
  const n = ri(4, y <= 3 ? 8 : 15), seq = Array.from({ length: n - 1 }, (_, i) => n - 1 - i), h = (n * (n - 1)) / 2;
  return explain(int('combinatorics · handshakes', `${n} people at a party each shake hands once with everyone else. How many handshakes are there?`, (n * (n - 1)) / 2), y <= 3 ? [
    `The 1st person shakes hands with ${n - 1} others. The 2nd has ${n - 2} new people left, the 3rd ${n - 3}, and so on.`,
    `${plus(seq)} = ${h}.`,
    `So there are ${h} handshakes.`,
  ] : [
    `Each of the ${n} people shakes hands with ${n - 1} others: ${n} × ${n - 1} = ${n * (n - 1)}.`,
    `That counts every handshake twice, once from each person: ${n * (n - 1)} ÷ 2 = ${h}.`,
    `So there are ${h} handshakes.`,
  ], 'Everyone with everyone once: multiply and halve, or add the new handshakes person by person.');
};
const routing = (y) => {
  const [r, c] = y <= 3 ? pick([[1, 3], [2, 2], [2, 3]]) : pick([[2, 4], [3, 3], [3, 4], [2, 5]]);
  const dp = Array.from({ length: r + 1 }, () => Array(c + 1).fill(1)); for (let i = 1; i <= r; i++) for (let j = 1; j <= c; j++) dp[i][j] = dp[i - 1][j] + dp[i][j - 1];
  return explain(withFigure(int('combinatorics · routing', `The grid has ${r} row${r > 1 ? 's' : ''} and ${c} columns of blocks. Walking along the lines only to the right or down, how many different shortest routes are there from corner A to corner B?`, choose(r + c, r)), grid('Routes from A to B', r, c, { '0,0': 'A', [`${r - 1},${c - 1}`]: 'B' })), [
    `Every shortest route is ${r} step${es(r)} down and ${c} steps right, in some order.`,
    'Write at each corner how many ways reach it: the number above it plus the number to its left (1 all along the top and left edges).',
    `The corners, row by row: ${dp.map((row) => row.join(' ')).join(' / ')}.`,
    `The number at B is ${dp[r][c]}. So there are ${dp[r][c]} shortest routes.`,
  ], 'Ways to reach a corner = ways from above + ways from the left.');
};
const distribution = () => {
  const kind = ri(1, 2);
  if (kind === 1) { const n = ri(5, 10), k = pick([2, 3]), it = thing(); return explain(int('combinatorics · distribution', `${n} identical ${it}s are put into ${k} boxes so that every box has at least one. In how many ways can this be done?`, choose(n - 1, k - 1)), [
    `Lay the ${n} ${it}s in a row: there are ${n - 1} gaps between them.`,
    `Put ${k - 1} divider${es(k - 1)} in the gaps to split the row into ${k} boxes, each with at least one.`,
    k === 2 ? `The divider can go in any of the ${n - 1} gaps: ${n - 1} ways.` : `Choose 2 of the ${n - 1} gaps: ${n - 1} × ${n - 2} ÷ 2 = ${choose(n - 1, 2)} ways.`,
    `So there are ${choose(n - 1, k - 1)} ways.`,
  ], 'Line up the items, then choose the gaps for the dividers.'); }
  const n = ri(3, 5), seq = Array.from({ length: n }, (_, i) => n - i);
  return explain(int('combinatorics · distribution', `${n} different books are given to ${n} children, one book each. In how many ways can this be done?`, fact(n)), [
    `The first child can get any of the ${n} books, the next any of the ${n - 1} left, and so on.`,
    `${seq.join(' × ')} = ${fact(n)}.`,
    `So there are ${fact(n)} ways.`,
  ], 'Give out one at a time and multiply the choices.');
};
const excessDeficiency = () => {
  const kids = ri(4, 12), a = ri(2, 5), c = a + ri(1, 3), left = ri(1, 9), items = a * kids + left, short = c * kids - items; if (short <= 0) return null; const it = thing();
  return explain(int('combinatorics · excess and deficiency', `A teacher shares ${it}s among a class. Giving ${a} to each child leaves ${left} over; giving ${c} to each child would be ${short} short. How many children are in the class?`, kids), [
    `Going from ${a} each to ${c} each, every child needs ${c - a} more.`,
    `That uses up the ${left} left over and still needs ${short} more: ${left} + ${short} = ${left + short} extra ${it}s in all.`,
    `${left + short} ÷ ${c - a} = ${kids}.`,
    `So there are ${kids} children in the class.`,
  ], 'Excess plus shortage, divided by the extra each child gets, gives the number of children.');
};
const combinationsQ = () => {
  const kind = ri(1, 2);
  if (kind === 1) { const n = ri(5, 9), k = pick([2, 3]), C = choose(n, k); return explain(int('combinatorics · combinations', `A team of ${k} is chosen from ${n} players. How many different teams are possible?`, choose(n, k)), k === 2 ? [
    `Pick the players in order: ${n} choices, then ${n - 1}: ${n} × ${n - 1} = ${n * (n - 1)}.`,
    `Each pair was counted twice (A then B, or B then A): ${n * (n - 1)} ÷ 2 = ${C}.`,
    `So there are ${C} teams.`,
  ] : [
    `Pick the players in order: ${n} × ${n - 1} × ${n - 2} = ${n * (n - 1) * (n - 2)}.`,
    `Each team of 3 was counted 3 × 2 × 1 = 6 times, once for every order: ${n * (n - 1) * (n - 2)} ÷ 6 = ${C}.`,
    `So there are ${C} teams.`,
  ], 'Choosing without order: count in order, then divide by the ways to order the chosen ones.'); }
  const n = ri(4, 8), C = choose(n, 2);
  return explain(int('combinatorics · combinations', `How many different lines can be drawn through pairs of ${n} points, no three of which lie on a line?`, choose(n, 2)), [
    `Each point joins to ${n - 1} others: ${n} × ${n - 1} = ${n * (n - 1)}.`,
    `Each line was counted from both ends: ${n * (n - 1)} ÷ 2 = ${C}.`,
    `So there are ${C} lines.`,
  ], 'A line joins 2 points: multiply and halve, just like handshakes.');
};
const permutationsQ = () => {
  const kind = ri(1, 2);
  if (kind === 1) { const n = ri(3, 5), seq = Array.from({ length: n }, (_, i) => n - i); return explain(int('combinatorics · permutations', `In how many different orders can ${n} different books be placed in a row on a shelf?`, fact(n)), [
    `${n} choices for the first place, ${n - 1} for the next, and so on down to 1.`,
    `${seq.join(' × ')} = ${fact(n)}.`,
    `So there are ${fact(n)} orders.`,
  ], 'Order matters: multiply the choices place by place.'); }
  const n = ri(4, 7);
  return explain(int('combinatorics · permutations', `${n} runners race. In how many ways can the gold, silver and bronze medals be given out?`, n * (n - 1) * (n - 2)), [
    `Gold: any of the ${n} runners. Silver: ${n - 1} left. Bronze: ${n - 2} left.`,
    `${n} × ${n - 1} × ${n - 2} = ${n * (n - 1) * (n - 2)}.`,
    `So there are ${n * (n - 1) * (n - 2)} ways.`,
  ], 'Order matters: multiply the choices place by place.');
};
const inclusionExclusion = () => {
  const n = ri(30, 45), both = ri(4, 10), onlyA = ri(5, 12), onlyB = ri(5, 12), neither = n - both - onlyA - onlyB; if (neither < 1) return null; const [x, z] = pick([['maths', 'science'], ['football', 'swimming'], ['drawing', 'music']]);
  const A = onlyA + both, B = onlyB + both;
  return explain(int('combinatorics · inclusion and exclusion', `In a class of ${n} pupils, ${onlyA + both} like ${x}, ${onlyB + both} like ${z}, and ${both} like both. How many like neither?`, neither), [
    `${A} like ${x} and ${B} like ${z}, but the ${both} who like both are counted in both groups.`,
    `Like at least one: ${A} + ${B} − ${both} = ${A + B - both}.`,
    `Neither: ${n} − ${A + B - both} = ${neither}.`,
    `So ${neither} pupils like neither.`,
  ], 'Add the two groups, take away the overlap, then subtract from the class.');
};
const diceWays = () => {
  const t = ri(4, 10); let n = 0; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b === t) n++;
  const ps = []; for (let a = 1; a <= 6; a++) { const b = t - a; if (b >= 1 && b <= 6) ps.push(`(${a}, ${b})`); }
  return explain(int('combinatorics · counting outcomes', `Two dice are rolled. In how many ways can the two numbers add up to ${t}?`, n), [
    `List the pairs (first die, second die) that add up to ${t}: ${list(ps)}.`,
    `Count them: ${n}. So there are ${n} ways.`,
  ], 'Make a list in order so nothing is missed or counted twice.');
};
// ---- the papers' staples the source check found missing (20 Sep 2026: the HKIMO 2025 heat papers P2, P4, P6, the two official samples) ----
const cryptAB = () => {
  const D = pick([0, 2, 4, 6, 8]), B = (10 + D) / 2;
  // 2(10A + B) = 100 + 10A + D forces A = 9
  return explain(int('logical thinking · cryptarithm', `In the addition AB + AB = 1A${D}, each letter stands for one digit. What is A + B?`, 9 + B), [
    'Doubling AB gives a three-digit number, so AB is 50 or more, and the answer has tens digit A again.',
    `Ones column: B + B ends in ${D}. The tens column only works with a carry, so B + B = ${10 + D} and B = ${B}.`,
    'Tens column: A + A + 1 (the carry) must end in A, so A = 9 (9 + 9 + 1 = 19: digit 9, carry 1 into the hundreds).',
    `A + B = 9 + ${B} = ${9 + B}. So A + B = ${9 + B}.`,
  ], 'In a cryptarithm, start from the ones column and follow the carries.');
};
const workRest = (y) => {
  const t = ri(y <= 2 ? 5 : 10, y <= 2 ? 12 : 30), r = ri(2, 8), n = ri(3, 8), total = n * t + (n - 1) * r;
  return explain(int('logical thinking · work and rest', `${names(1)[0]} makes a drawing in ${t} minutes and rests ${r} minutes before starting the next one. How many minutes pass from starting the first drawing to finishing the ${ord(n)}?`, n * t + (n - 1) * r), [
    `${n} drawings take ${n} × ${t} = ${n * t} minutes.`,
    `There are only ${n - 1} rests, one between each pair of drawings: ${n - 1} × ${r} = ${(n - 1) * r} minutes.`,
    `${n * t} + ${(n - 1) * r} = ${total}. So ${total} minutes pass.`,
  ], 'Between n things there are only n − 1 gaps.');
};
const giveTake = () => {
  const [m, e, a] = names(3), g = ri(3, 12), t = ri(3, 15); if (g === t) return null;
  return explain(int('logical thinking · give and take', `${m} gives ${g} marbles to ${e} and takes ${t} marbles from ${a}. Now the three children have the same number of marbles. How many more marbles did ${a} have than ${e} at first?`, g + t), [
    `Now all three are equal. Work backwards: before the gift, ${e} had ${g} fewer than now.`,
    `Before the marbles were taken, ${a} had ${t} more than now.`,
    `So at first ${a} had ${t} + ${g} = ${g + t} more than ${e}.`,
    `So the answer is ${g + t}.`,
  ], 'Work backwards from the moment they are equal.');
};
const definedOp = () => {
  const [sym, f, words, show] = pick([
    ['⊗', (a, b) => (a + b) * (2 * a - b), 'a ⊗ b = (a + b) × (2a − b)', (a, b) => `(${a} + ${b}) × (2 × ${a} − ${b}) = ${a + b} × ${2 * a - b}`],
    ['⊕', (a, b) => a * b - a - b, 'a ⊕ b = a × b − a − b', (a, b) => `${a} × ${b} − ${a} − ${b} = ${a * b} − ${a} − ${b}`],
    ['⊙', (a, b) => 2 * a + 3 * b, 'a ⊙ b = 2a + 3b', (a, b) => `2 × ${a} + 3 × ${b} = ${2 * a} + ${3 * b}`],
    ['⊛', (a, b) => a * a - b, 'a ⊛ b = a² − b', (a, b) => `${a} × ${a} − ${b} = ${a * a} − ${b}`],
  ]), a = ri(2, 6), b = ri(1, 5), c = ri(2, 20), inner = f(a, b); if (inner < 1 || inner > 40) return null; const v = f(c, inner); if (v < 0 || v > 100000) return null;
  return explain(int('logical thinking · defined operations', `For whole numbers, ${words}. What is ${c} ${sym} (${a} ${sym} ${b})?`, v), [
    `The sign ${sym} is a recipe: ${words}. Work out the bracket first.`,
    `${a} ${sym} ${b} = ${show(a, b)} = ${inner}.`,
    `Then ${c} ${sym} ${inner} = ${show(c, inner)} = ${v}.`,
    `So the answer is ${v}.`,
  ], 'A made-up sign is just a recipe: put the numbers in, brackets first.');
};
const sumMultiple = () => {
  const k = ri(3, 12), B = ri(20, 300), A = k * B, S = A + B;
  const model = [bar('B', 1), bar('A', k, `A + B = ${S}`), `B is 1 unit and A is ${k} units, so ${k} + 1 = ${k + 1} units make ${S}.`, `1 unit = ${S} ÷ ${k + 1} = ${B}.`];
  if (ri(1, 2) === 1) return explain(int('logical thinking · sum and multiple', `A + B = ${A + B}, and A is ${k} times B. What is B?`, B), [...model, `So B = ${B}.`], 'Draw B as 1 box and A as k boxes: the total is k + 1 boxes.');
  return explain(int('logical thinking · sum and multiple', `A + B = ${A + B}, and A is ${k} times B. What is A − B?`, A - B), [...model, `A − B is ${k} − 1 = ${k - 1} units: ${k - 1} × ${B} = ${A - B}. So A − B = ${A - B}.`], 'Draw B as 1 box and A as k boxes: the total is k + 1 boxes.');
};
const decreasingDiffs = () => {
  const start = ri(60, 99), d0 = ri(2, 5), terms = [start]; for (let i = 1; i < 7; i++) terms.push(terms[i - 1] - (d0 + i - 1)); if (terms[6] < 0) return null;
  const diffs = [1, 2, 3, 4].map((i) => terms[i - 1] - terms[i]);
  return explain(int('logical thinking · number sequences', `${terms.slice(0, 5).join(', ')}, A, B, … The numbers follow a rule. What is A + B?`, terms[5] + terms[6]), [
    `Look at the jumps between the numbers: ${list(diffs)}. Each jump is 1 bigger than the one before.`,
    `The next jumps are ${d0 + 4} and ${d0 + 5}: A = ${terms[4]} − ${d0 + 4} = ${terms[5]}, B = ${terms[5]} − ${d0 + 5} = ${terms[6]}.`,
    `A + B = ${terms[5]} + ${terms[6]} = ${terms[5] + terms[6]}. So A + B = ${terms[5] + terms[6]}.`,
  ], 'When the pattern is not obvious, look at the jumps between the numbers.');
};
const averageMissing = () => {
  const a = ri(30, 99), b = ri(30, 99), avg = ri(40, 95), x = 3 * avg - a - b; if (x < 1 || x > 150) return null;
  return explain(int('logical thinking · averages', `The average of ${a}, ${b} and a third number is ${avg}. What is the third number?`, x), [
    `Three numbers with an average of ${avg} add up to 3 × ${avg} = ${3 * avg}.`,
    `${3 * avg} − ${a} − ${b} = ${x}.`,
    `So the third number is ${x}.`,
  ], 'Average × how many = the total.');
};
const ratioChickenRabbit = () => {
  const k = ri(2, 8), r = ri(4, 30), legs = 2 * k * r + 4 * r;
  return explain(int('logical thinking · chicken and rabbit', `A farm has ${k} times as many chickens as rabbits, and ${2 * k * r + 4 * r} legs altogether. How many rabbits are there?`, r), [
    `Put 1 rabbit with its ${k} chickens in a group: 4 + ${k} × 2 = ${4 + 2 * k} legs in each group.`,
    `${legs} ÷ ${4 + 2 * k} = ${r} groups.`,
    `Each group has 1 rabbit, so there are ${r} rabbits.`,
  ], 'Group 1 rabbit with its chickens and count the legs of one group.');
};
const workBackFractions = () => {
  const left = ri(5, 40), c2 = ri(2, 9), c1 = ri(2, 9), q = pick([3, 4, 5]), x1 = ((left + c2) * q) / (q - 1); if (!Number.isInteger(x1)) return null; const x0 = 2 * (x1 - c1); if (x0 <= 0) return null;
  const fr = ['', '', 'half', 'third', 'quarter', 'fifth'][q], frs = ['', '', 'halves', 'thirds', 'quarters', 'fifths'][q], part = (left + c2) / (q - 1);
  return explain(int('logical thinking · working backwards', `A shop had some books. In the morning it sold ${c1} fewer than half of them, and in the afternoon it sold ${c2} more than a ${['', '', 'half', 'third', 'quarter', 'fifth'][q]} of the rest. ${left} books were left. How many books were there at first?`, x0), [
    `Work backwards from the ${left} books left.`,
    `Afternoon: a ${fr} of the rest plus ${c2} were sold, so ${left} + ${c2} = ${left + c2} books make ${q - 1} ${frs} of the rest.`,
    `1 ${fr} of the rest = ${left + c2} ÷ ${q - 1} = ${part}, so the rest was ${q} × ${part} = ${x1}.`,
    `Morning: ${c1} fewer than half were sold, so the ${x1} left is half plus ${c1}. Half = ${x1} − ${c1} = ${x1 - c1}.`,
    `${x1 - c1} × 2 = ${x0}. So there were ${x0} books at first.`,
  ], '"Left" at the end is the clue: work backwards, undoing each step.');
};
const workBackOps = () => {
  const x = ri(10, 60), a = ri(2, 9), k = pick([3, 4, 5]), c = ri(2, 9), d = pick([2, 3, 4, 6]), v = (x - a) * k + c; if (v % d) return null;
  return explain(int('logical thinking · working backwards', `A number has ${a} subtracted from it, the result is multiplied by ${k}, then ${c} is added, and the result is divided by ${d} to give ${v / d}. What is the number?`, x), [
    `Start from the end and undo each step. Undo ÷ ${d}: ${v / d} × ${d} = ${v}.`,
    `Undo + ${c}: ${v} − ${c} = ${v - c}.`,
    `Undo × ${k}: ${v - c} ÷ ${k} = ${x - a}.`,
    `Undo − ${a}: ${x - a} + ${a} = ${x}.`,
    `So the number is ${x}.`,
  ], 'Work backwards and undo each step: ÷ becomes ×, + becomes −.');
};
const multiplesSum = (y) => {
  if (y <= 3 || ri(1, 2) === 1) {
    const base = pick([11, 111, 22, 33]), n = ri(4, 6), seq = Array.from({ length: n }, (_, i) => i + 1), T = (n * (n + 1)) / 2;
    return explain(int('arithmetic · multiples sum', `${Array.from({ length: n }, (_, i) => base * (i + 1)).join(' + ')} = ?`, (base * n * (n + 1)) / 2), [
      `Every number is a multiple of ${base}: ${base} × 1, ${base} × 2, … ${base} × ${n}.`,
      `So the sum is ${base} × (${plus(seq)}) = ${base} × ${T}.`,
      `${base} × ${T} = ${base * T}. So the answer is ${base * T}.`,
    ], 'Take out the common factor, then add 1 + 2 + … + n.');
  }
  const k = ri(11, 25), n = ri(10, 25), T = (n * (n + 1)) / 2;
  return explain(int('arithmetic · multiples sum', `${k} + ${2 * k} + ${3 * k} + … + ${n * k} = ?`, (k * n * (n + 1)) / 2), [
    `Every number is a multiple of ${k}, so the sum is ${k} × (1 + 2 + … + ${n}).`,
    `1 + 2 + … + ${n} = ${n} × ${n + 1} ÷ 2 = ${T}.`,
    `${k} × ${T} = ${k * T}. So the answer is ${k * T}.`,
  ], 'Take out the common factor, then add 1 + 2 + … + n.');
};
const triangularSum = () => {
  const n = ri(8, 14), tri = Array.from({ length: n }, (_, i) => ((i + 1) * (i + 2)) / 2), total = (n * (n + 1) * (n + 2)) / 6;
  return explain(int('arithmetic · triangular numbers', `1 + 3 + 6 + 10 + … + ${(n * (n + 1)) / 2} = ?`, (n * (n + 1) * (n + 2)) / 6), [
    `These are the triangular numbers, each adding the next counting number: ${list(tri)}.`,
    `Add them: ${plus(tri)} = ${total}.`,
    `Check with the pattern: ${n} × ${n + 1} × ${n + 2} ÷ 6 = ${total}.`,
    `So the sum is ${total}.`,
  ], 'The first n triangular numbers add up to n × (n + 1) × (n + 2) ÷ 6.');
};
const computeMixed = () => {
  const a = ri(11, 30), b = ri(11, 60), c = ri(50, 120), d = pick([50, 25, 20]), e = ri(11, 40), f = ri(11, 60), v = a * b + c * d + e * f;
  return explain(int('arithmetic · mixed calculation', `${a} × ${b} + ${c} × ${d} + ${e} × ${f} = ?`, a * b + c * d + e * f), [
    `Multiply first. ${a} × ${b} = ${a * b}.`,
    `${c} × ${d}: ${d} is 100 ÷ ${100 / d}, so ${c} × 100 ÷ ${100 / d} = ${c * d}.`,
    `${e} × ${f} = ${e * f}.`,
    `${a * b} + ${c * d} + ${e * f} = ${v}. So the answer is ${v}.`,
  ], 'Multiply before you add, and use 25 = 100 ÷ 4 and 50 = 100 ÷ 2.');
};
const squareMinus = () => {
  const a = ri(31, 99), b = ri(11, 30), c = ri(50, 200), v = a * a - b * c; if (v < 0) return null;
  return explain(int('arithmetic · squares', `${a}² − ${b} × ${c} = ?`, v), [
    `${a}² = ${a} × ${a} = ${a * a}.`,
    `${b} × ${c} = ${b * c}.`,
    `${a * a} − ${b * c} = ${v}. So the answer is ${v}.`,
  ], 'Work out the square and the product separately, then subtract.');
};
const squaresRange = () => {
  const a = ri(5, 15), n = ri(5, 12), b = a + n - 1, S = (k) => (k * (k + 1) * (2 * k + 1)) / 6, sq = Array.from({ length: n }, (_, i) => (a + i) * (a + i)), v = S(b) - S(a - 1);
  return explain(int('arithmetic · sum of squares', `${a}² + ${a + 1}² + … + ${b}² = ?`, S(b) - S(a - 1)), [
    `Work out each square: ${list(sq)}.`,
    `Add them: ${plus(sq)} = ${v}.`,
    `Check: (1² + … + ${b}²) − (1² + … + ${a - 1}²) = ${S(b)} − ${S(a - 1)} = ${v}.`,
    `So the sum is ${v}.`,
  ], 'A run of squares: add them up, or take one sum of squares from another.');
};
const telescopingOdd = () => {
  const n = ri(4, 12), num = n, den = 3 * (2 * n + 3), g = gcd(num, den), A = num / g, B = den / g;
  // each term is half of 1/(2k+1) − 1/(2k+3)
  return explain(int('arithmetic · telescoping', `1/15 + 1/35 + 1/63 + … + 1/${(2 * n + 1) * (2 * n + 3)} is a fraction a/b in its simplest form. What is a + b?`, num / g + den / g), [
    `Each bottom is a product of neighbours: 15 = 3 × 5, 35 = 5 × 7, … ${(2 * n + 1) * (2 * n + 3)} = ${2 * n + 1} × ${2 * n + 3}.`,
    'Each fraction splits into half a gap: 1/15 = (1/3 − 1/5) ÷ 2, 1/35 = (1/5 − 1/7) ÷ 2, and so on.',
    `Add them and the middle parts cancel: (1/3 − 1/${2 * n + 3}) ÷ 2.`,
    `1/3 − 1/${2 * n + 3} = ${2 * n}/${3 * (2 * n + 3)}, and half of that is ${n}/${3 * (2 * n + 3)} = ${A}/${B} in simplest form.`,
    `a + b = ${A} + ${B} = ${A + B}. So a + b = ${A + B}.`,
  ], 'When the bottoms are products of neighbours, split each fraction into a difference.');
};
const seriesAverage = () => {
  const a = ri(1000, 2000), d = pick([7, 14, 21]), n = ri(10, 40); if ((2 * a + (n - 1) * d) % 2) return null; const last = a + (n - 1) * d;
  return explain(int('arithmetic · averages', `What is the average of ${a}, ${a + d}, ${a + 2 * d}, …, ${a + (n - 1) * d}?`, (2 * a + (n - 1) * d) / 2), [
    `The numbers go up by ${d} each time, so they are evenly spaced.`,
    `For evenly spaced numbers the average is halfway between the first and the last: (${a} + ${last}) ÷ 2.`,
    `${a + last} ÷ 2 = ${(a + last) / 2}. So the average is ${(a + last) / 2}.`,
  ], 'Evenly spaced numbers: the average is halfway between the first and the last.');
};
const eggsBoxes = () => {
  const a = ri(20, 99), b = ri(5, 40), box = pick([6, 10, 12, 24, 30]), q = Math.floor((a + b) / box), rem = (a + b) % box, need = Math.ceil((a + b) / box);
  return explain(int('arithmetic · division', `${a} + ${b} eggs are packed in boxes of ${box}. How many boxes are needed to pack them all?`, Math.ceil((a + b) / box)), [
    `${a} + ${b} = ${a + b} eggs.`,
    `${a + b} ÷ ${box} = ${q} remainder ${rem}.`,
    rem ? `The ${rem} egg${es(rem)} left over still need a box: ${q} + 1 = ${need}.` : `They fill ${q} boxes exactly.`,
    `So ${need} boxes are needed.`,
  ], 'If some are left over, they still need a box: round up.');
};
const smallestMultiple = () => {
  const m = ri(13, 49), q = Math.floor(100 / m), r = 100 % m, ans = m * Math.ceil(100 / m);
  return explain(int('arithmetic · multiples', `What is the smallest three-digit multiple of ${m}?`, m * Math.ceil(100 / m)), [
    `The smallest three-digit number is 100. 100 ÷ ${m} = ${q} remainder ${r}.`,
    r ? `${m} × ${q} = ${m * q} is under 100, so take the next multiple: ${m} × ${q + 1} = ${ans}.` : `100 is exactly ${m} × ${q}, so 100 itself is a multiple of ${m}.`,
    `So the smallest three-digit multiple of ${m} is ${ans}.`,
  ], 'Divide 100 by the number; if there is a remainder, go up to the next multiple.');
};
const evensInRange = () => {
  const a = ri(50, 150), b = ri(a + 100, 999); let c = 0; for (let k = a; k <= b; k++) if (k % 2 === 0) c++;
  const f = a % 2 ? a + 1 : a, l = b % 2 ? b - 1 : b;
  return explain(int('number theory · odd and even', `How many even numbers are there from ${a} to ${b}?`, c), [
    `The first even number from ${a} is ${f}, and the last even number up to ${b} is ${l}.`,
    `Even numbers go up in 2s: (${l} − ${f}) ÷ 2 = ${(l - f) / 2} jumps, and ${(l - f) / 2} + 1 = ${c} numbers.`,
    `So there are ${c} even numbers.`,
  ], 'Find the first and the last, count the jumps of 2, then add 1.');
};
const unitDigitSumPowers = () => {
  const base = pick([2, 3, 7, 8]), m = ri(2, 5), n = ri(20, 99), cyc = { 2: [2, 4, 8, 6], 3: [3, 9, 7, 1], 7: [7, 9, 3, 1], 8: [8, 4, 2, 6] }[base]; let s = 0; for (let k = m; k <= n; k++) s += cyc[(k - 1) % 4];
  const count = n - m + 1, full = Math.floor(count / 4), rem = count % 4, left = Array.from({ length: rem }, (_, i) => cyc[(n - rem + i) % 4]);
  return explain(int('number theory · unit digit', `What is the ones digit of ${base}^${m} + ${base}^${m + 1} + … + ${base}^${n}?`, s % 10), [
    `The ones digits of the powers of ${base} repeat every 4: ${list(cyc)}. Any 4 in a row add up to ${sum(cyc)}, which ends in 0.`,
    `From ${base}^${m} to ${base}^${n} there are ${n} − ${m} + 1 = ${count} powers: ${full} full groups of 4 and ${rem} left over.`,
    'The full groups add up to a number ending in 0.',
    rem === 0 ? 'Nothing is left over, so the whole sum ends in 0.' : rem === 1 ? `The last power, ${base}^${n}, has ones digit ${left[0]}.` : `The last ${rem} ones digits are ${list(left)}: ${plus(left)} = ${sum(left)}, which ends in ${sum(left) % 10}.`,
    `So the ones digit is ${s % 10}.`,
  ], 'Four powers in a row have ones digits adding to a multiple of 10: only the leftover ones matter.');
};
const crtLargest = () => {
  const [m1, m2, m3] = pick([[6, 5, 7], [4, 5, 7], [3, 5, 8], [5, 7, 9]]), r1 = ri(1, m1 - 1), r2 = ri(1, m2 - 1), r3 = ri(1, m3 - 1); let N = 999; while (N > 100 && (N % m1 !== r1 || N % m2 !== r2 || N % m3 !== r3)) N--; if (N <= 100) return null;
  const L = m1 * m2 * m3; let N0 = r3; while (N0 % m1 !== r1 || N0 % m2 !== r2) N0 += m3; const chain = []; for (let k = N0; k <= 999; k += L) chain.push(k);
  return explain(int('number theory · remainders', `What is the largest three-digit number that leaves a remainder of ${r1} when divided by ${m1}, ${r2} when divided by ${m2}, and ${r3} when divided by ${m3}?`, N), [
    `Start with numbers that leave ${r3} when divided by ${m3}: ${r3}, ${r3 + m3}, ${r3 + 2 * m3}, … and test the other two remainders.`,
    `The first that also leaves ${r2} when divided by ${m2} and ${r1} when divided by ${m1} is ${N0}.`,
    `The three divisors share no factor, so the pattern repeats every ${m1} × ${m2} × ${m3} = ${L}.`,
    `Keep adding ${L}: ${list(chain)}. The largest three-digit one is ${N}.`,
    `So the largest such number is ${N}.`,
  ], 'Find the smallest number that fits, then keep adding the product of the divisors.');
};
const phiCount = () => {
  const n = pick([30, 36, 42, 60, 84, 90, 120, 210, 330, 420]); let c = 0; for (let k = 1; k < n; k++) if (gcd(k, n) === 1) c++;
  const pf = primeFactors(n), ps = pf.map(([p]) => p), lines = []; let cur = n; for (const p of ps) { const next = (cur * (p - 1)) / p; lines.push(`Cross out the multiples of ${p}: ${cur} × ${p - 1}/${p} = ${next} left.`); cur = next; }
  return explain(int('number theory · coprime', `How many proper fractions with denominator ${n} are in their simplest form?`, c), [
    `${n} = ${pf.map(([p, e]) => powerText(p, e)).join(' × ')}: its primes are ${list(ps)}. A fraction is in simplest form when its top shares none of them.`,
    `Start with the ${n} tops from 1 to ${n}.`,
    ...lines,
    `So ${c} fractions are in their simplest form.`,
  ], 'For each prime in the bottom, keep the fraction of tops it does not divide.');
};
const divisibleEither = () => {
  const a = pick([3, 5, 7]), b = pick([5, 7, 8, 9]); if (a === b) return null; let c = 0; for (let k = 100; k <= 999; k++) if (k % a === 0 || k % b === 0) c++;
  const cnt = (x) => Math.floor(999 / x) - Math.floor(99 / x), L = lcm(a, b);
  return explain(int('number theory · divisibility', `How many three-digit numbers are divisible by ${a} or by ${b}?`, c), [
    `Multiples of ${a} from 100 to 999: ${Math.floor(999 / a)} − ${Math.floor(99 / a)} = ${cnt(a)}.`,
    `Multiples of ${b}: ${Math.floor(999 / b)} − ${Math.floor(99 / b)} = ${cnt(b)}.`,
    `Multiples of both are multiples of ${L}, and they were counted twice: ${Math.floor(999 / L)} − ${Math.floor(99 / L)} = ${cnt(L)}.`,
    `${cnt(a)} + ${cnt(b)} − ${cnt(L)} = ${c}. So there are ${c} numbers.`,
  ], 'Add the two counts, then take away the ones counted twice.');
};
const largestSmallestDigits = () => {
  const ds = [0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3)], desc = [...ds].sort((a, b) => b - a), asc = [...ds].sort((a, b) => a - b);
  const big = Number(desc.slice(0, 3).join('')), small = Number([asc[1], asc[0], asc[2]].join(''));
  return explain(int('number theory · digits', `Using three of the digits ${shuffle(ds).join(', ')}, each at most once, the largest three-digit number and the smallest three-digit number are formed. What is their difference?`, Number(desc.slice(0, 3).join('')) - Number([asc[1], asc[0], asc[2]].join(''))), [
    `Largest: the biggest digits in front, ${desc[0]}, then ${desc[1]}, then ${desc[2]}: ${big}.`,
    `Smallest: the front digit cannot be 0, so ${asc[1]} first, then 0, then ${asc[2]}: ${small}.`,
    `${big} − ${small} = ${big - small}. So the difference is ${big - small}.`,
  ], 'The smallest number cannot start with 0: put the smallest non-zero digit first, then the 0.');
};
const pyramidPrism = (y) => {
  const n = ri(4, y <= 4 ? 8 : 20);
  // a pyramid on an n-gon: n + 1 vertices, 2n edges; a prism on an n-gon: 2n vertices, 3n edges, n + 2 faces
  if (ri(1, 2) === 1) return explain(int('geometry · solids', `A pyramid has ${n + 1} vertices. How many edges does it have?`, 2 * n), [
    `A pyramid has 1 vertex at the top, so the base has ${n + 1} − 1 = ${n} corners.`,
    `Edges: ${n} round the base and ${n} going up to the top: ${n} + ${n} = ${2 * n}.`,
    `So the pyramid has ${2 * n} edges.`,
  ], 'Find the number of corners on the base first; everything else follows.');
  return explain(int('geometry · solids', `A prism has ${2 * n} vertices. How many edges and faces does it have altogether?`, 4 * n + 2), [
    `A prism has two matching ends, so each end has ${2 * n} ÷ 2 = ${n} corners.`,
    `Edges: ${n} on each end and ${n} joining the ends: ${n} + ${n} + ${n} = ${3 * n}.`,
    `Faces: ${n} sides and 2 ends: ${n} + 2 = ${n + 2}.`,
    `${3 * n} + ${n + 2} = ${4 * n + 2}. So there are ${4 * n + 2} edges and faces altogether.`,
  ], 'Find the number of corners on the base first; everything else follows.');
};
const minMaxArea = () => {
  const P = ri(10, 50) * 2, half = P / 2;
  if (ri(1, 2) === 1) return explain(int('geometry · area', `A rectangle has a perimeter of ${P} cm and whole-number sides. What is the smallest possible area, in cm²?`, half - 1), [
    `Length + width = ${P} ÷ 2 = ${half}.`,
    `The thinnest rectangle has the least area: 1 cm by ${half - 1} cm.`,
    `1 × ${half - 1} = ${half - 1}. So the smallest area is ${half - 1} cm².`,
  ], 'Same perimeter: the squarer the rectangle, the bigger the area; the thinner, the smaller.');
  const a = Math.floor(half / 2);
  return explain(int('geometry · area', `A rectangle has a perimeter of ${P} cm and whole-number sides. What is the largest possible area, in cm²?`, a * (half - a)), [
    `Length + width = ${P} ÷ 2 = ${half}.`,
    `The rectangle closest to a square has the most area: ${a} cm by ${half - a} cm.`,
    `${a} × ${half - a} = ${a * (half - a)}. So the largest area is ${a * (half - a)} cm².`,
  ], 'Same perimeter: the squarer the rectangle, the bigger the area; the thinner, the smaller.');
};
const exteriorAngle = () => {
  const n = pick([5, 6, 8, 9, 10, 12, 15, 18, 20]), ext = 360 / n;
  if (ri(1, 2) === 1) return explain(int('geometry · angles', `Each exterior angle of a regular polygon is ${360 / n}°. How many sides does it have?`, n), [
    'The exterior angles of any polygon add up to 360°, one at each corner.',
    `360 ÷ ${ext} = ${n}.`,
    `So the polygon has ${n} sides.`,
  ], 'Exterior angles always add up to 360°: divide 360 by one exterior angle.');
  return explain(int('geometry · angles', `Each interior angle of a regular polygon is ${180 - 360 / n}°. How many sides does it have?`, n), [
    `An interior angle and its exterior angle make a straight line: 180 − ${180 - ext} = ${ext}° for each exterior angle.`,
    'The exterior angles of any polygon add up to 360°.',
    `360 ÷ ${ext} = ${n}. So the polygon has ${n} sides.`,
  ], 'Exterior angles always add up to 360°: divide 360 by one exterior angle.');
};
const coinsSquare = () => {
  const s = ri(3, 15), total = 4 * (s - 1);
  return explain(int('geometry · coins round a square', `${4 * (s - 1)} coins form a square with the same number of coins along each side and one at each corner. How many coins are along each side?`, s), [
    'Each corner coin belongs to two sides, so going round the square, give each side all its coins except one corner.',
    `4 sides × (coins on a side − 1) = ${total}, so coins on a side − 1 = ${total} ÷ 4 = ${s - 1}.`,
    `${s - 1} + 1 = ${s}. So there are ${s} coins along each side.`,
  ], 'Coins round a square: the 4 corners are shared, so the total is 4 × (side − 1).');
};
const wireSquares = () => {
  const total = pick([100, 120, 160, 200, 240]), s1 = ri(5, total / 4 - 5), rest = total - 4 * s1; if (rest % 4) return null;
  return explain(int('geometry · perimeter', `A wire ${total} cm long is cut into two pieces and each is bent into a square. One square has sides of ${s1} cm. How long is each side of the other square, in cm?`, rest / 4), [
    `The first square uses 4 × ${s1} = ${4 * s1} cm of wire.`,
    `Left for the second square: ${total} − ${4 * s1} = ${rest} cm.`,
    `A square has 4 equal sides: ${rest} ÷ 4 = ${rest / 4}. So each side of the other square is ${rest / 4} cm.`,
  ], 'The wire is the perimeter: 4 sides for each square.');
};
const routesCompound = (y) => {
  const a = ri(2, 4), b = ri(2, 3), direct = ri(1, 2), c = ri(2, 4);
  if (y <= 3) return explain(int('combinatorics · routes', `There are ${a} roads from the zoo to the station and ${b} roads from the station to the cinema, and ${direct} road${direct > 1 ? 's' : ''} straight from the zoo to the cinema. How many different ways are there to go from the zoo to the cinema?`, a * b + direct), [
    `Through the station: ${a} roads there, then ${b} roads on: ${a} × ${b} = ${a * b} ways.`,
    `Straight from the zoo to the cinema: ${direct} more way${es(direct)}.`,
    `${a * b} + ${direct} = ${a * b + direct}. So there are ${a * b + direct} ways.`,
  ], 'Add the ways when it is either-or; multiply when it is one after the other.');
  return explain(int('combinatorics · routes', `There are ${a} roads from the zoo to the station, ${b} roads from the station to the cinema and ${direct} road${direct > 1 ? 's' : ''} straight from the zoo to the cinema, then ${c} roads from the cinema to the park. How many different ways are there to go from the zoo to the park through the cinema?`, (a * b + direct) * c), [
    `Zoo to cinema: through the station ${a} × ${b} = ${a * b} ways, plus ${direct} direct: ${a * b + direct} ways.`,
    `Cinema to park: ${c} roads, for each of those ${a * b + direct} ways.`,
    `${a * b + direct} × ${c} = ${(a * b + direct) * c}. So there are ${(a * b + direct) * c} ways.`,
  ], 'Add the ways when it is either-or; multiply when it is one after the other.');
};
const bigCombinations = () => {
  const n = ri(10, 17), k = ri(3, Math.floor(n / 2)), falling = Array.from({ length: k }, (_, i) => n - i), perm = falling.reduce((p, x) => p * x, 1), C = choose(n, k);
  return explain(int('combinatorics · combinations', `${k} pupils are chosen from ${n} to form a team. How many different teams are possible?`, choose(n, k)), [
    `Pick the ${k} pupils in order: ${falling.join(' × ')} = ${perm}.`,
    `Each team was counted once for every order of its ${k} pupils: ${k}! = ${fact(k)} times.`,
    `${perm} ÷ ${fact(k)} = ${C}. So there are ${C} teams.`,
  ], 'Choosing k from n: multiply k falling numbers, then divide by k!.');
};
const multinomial = () => {
  const [a, b, c] = pick([[2, 2, 1], [3, 2, 1], [3, 3, 1], [4, 2, 1], [3, 2, 2], [4, 3, 1], [4, 2, 2], [5, 2, 1], [3, 3, 2], [4, 3, 2], [5, 3, 1], [5, 3, 2], [4, 4, 2], [6, 3, 2], [7, 5, 3]]), n = a + b + c, cols = shuffle(['red', 'blue', 'green', 'white']).slice(0, 3);
  const C1 = choose(n, a), C2 = choose(n - a, b), total = Math.round(fact(n) / (fact(a) * fact(b) * fact(c)));
  return explain(int('combinatorics · arrangements', `${a} identical ${cols[0]} cups, ${b} identical ${cols[1]} cups and ${c} identical ${cols[2]} cup${c > 1 ? 's' : ''} are placed in a row. How many different arrangements are there?`, Math.round(fact(n) / (fact(a) * fact(b) * fact(c)))), [
    `There are ${n} places in the row. Choose the ${a} places for the ${cols[0]} cups: ${C1} ways.`,
    `Then choose ${b} of the ${n - a} places left for the ${cols[1]} cups: ${C2} ways. The ${cols[2]} cup${es(c)} fill${c === 1 ? 's' : ''} the rest.`,
    `${C1} × ${C2} = ${total}. So there are ${total} arrangements.`,
  ], 'Identical things: choose their places instead of ordering them.');
};
const complementCount = () => {
  const kind = ri(1, 3), d = ri(1, 9);
  if (kind === 1) return explain(int('combinatorics · complement counting', `How many three-digit numbers do not contain the digit ${d}?`, 648), [
    `Hundreds digit: not 0 and not ${d}, so 8 choices. Tens digit: not ${d}, so 9 choices. Ones digit: 9 choices.`,
    `8 × 9 × 9 = ${8 * 9 * 9}.`,
    `So ${8 * 9 * 9} three-digit numbers do not contain the digit ${d}.`,
  ], 'Count place by place, leaving out the forbidden digit.');
  if (kind === 2) { const e = pick([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((x) => x !== d)); return explain(int('combinatorics · complement counting', `How many three-digit numbers contain neither the digit ${d} nor the digit ${e}?`, 7 * 8 * 8), [
    `Hundreds digit: not 0, not ${d}, not ${e}, so 7 choices. Tens digit: not ${d} or ${e}, so 8 choices. Ones digit: 8 choices.`,
    `7 × 8 × 8 = ${7 * 8 * 8}.`,
    `So ${7 * 8 * 8} three-digit numbers contain neither digit.`,
  ], 'Count place by place, leaving out the forbidden digits.'); }
  return explain(int('combinatorics · complement counting', `How many three-digit numbers contain the digit ${d} at least once?`, 900 - 648), [
    'There are 900 three-digit numbers, from 100 to 999.',
    `Numbers with no ${d} at all: 8 × 9 × 9 = ${8 * 9 * 9} (hundreds digit not 0 and not ${d}; tens and ones not ${d}).`,
    `900 − ${8 * 9 * 9} = ${900 - 8 * 9 * 9}. So ${900 - 8 * 9 * 9} numbers contain the digit ${d} at least once.`,
  ], 'Count the ones that do not, then take them away from all.');
};
const digitRestricted = () => {
  const ds = [0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 5)].sort((a, b) => a - b), bound = pick([300, 400, 500, 600]), odd = ri(1, 2) === 1; let c = 0; for (const a of ds) for (const b of ds) for (const e of ds) { if (a === 0 || a === b || b === e || a === e) continue; const n = 100 * a + 10 * b + e; if (n > bound && (odd ? n % 2 === 1 : n % 2 === 0)) c++; } if (!c) return null;
  const H = ds.filter((h) => h !== 0 && h >= bound / 100), parts = H.map((h) => [h, ds.filter((x) => x !== h && (odd ? x % 2 === 1 : x % 2 === 0)).length]), w = odd ? 'odd' : 'even';
  return explain(int('combinatorics · forming numbers', `Using three different digits from ${ds.join(', ')}, how many ${odd ? 'odd' : 'even'} three-digit numbers greater than ${bound} can be formed?`, c), [
    `The hundreds digit must be ${bound / 100} or more: ${list(H)}.`,
    `For each hundreds digit, the ones digit must be ${w} and different from it, and the tens digit can be any of the 4 digits left.`,
    `${parts.map(([h, o]) => `Hundreds ${h}: ${o} × 4 = ${o * 4}`).join('; ')}.`,
    `${plus(parts.map(([, o]) => o * 4))} = ${c}. So ${c} numbers can be formed.`,
  ], 'Split into cases by the hundreds digit, then multiply the choices for the other places.');
};

// ---- the lower grades (20 Sep 2026): five a category left P1–P3 repeating families, so the OCEC P1–P3 staples the first build skipped ----
const numberBond = (y) => {
  const kind = ri(1, 3), top = y <= 1 ? 20 : 100;
  if (kind === 1) { const s = ri(6, top), a = ri(1, s - 1); return explain(int('arithmetic · number bonds', `${a} + ▢ = ${s}. What number goes in the box?`, s - a, { read: `${a} plus what makes ${s}?` }), [
    `${a} and the missing number make ${s} altogether.`,
    `Take the part you know from the whole: ${s} − ${a} = ${s - a}.`,
    `Check: ${a} + ${s - a} = ${s}. So the missing number is ${s - a}.`,
  ], 'A missing part is the whole take away the part you know.'); }
  if (kind === 2) { const a = ri(1, top / 2), d = ri(1, top / 2); return explain(int('arithmetic · number bonds', `▢ − ${a} = ${d}. What number goes in the box?`, d + a, { read: `What number take away ${a} leaves ${d}?` }), [
    `Some number take away ${a} leaves ${d}.`,
    `Put the ${a} back: ${d} + ${a} = ${d + a}.`,
    `Check: ${d + a} − ${a} = ${d}. So the missing number is ${d + a}.`,
  ], 'To undo a take-away, add it back.'); }
  const a = ri(6, top), d = ri(1, a - 1);
  return explain(int('arithmetic · number bonds', `${a} − ▢ = ${d}. What number goes in the box?`, a - d, { read: `${a} take away what leaves ${d}?` }), [
    `${a} take away the missing number leaves ${d}.`,
    `The missing number is the gap from ${d} up to ${a}: ${a} − ${d} = ${a - d}.`,
    `Check: ${a} − ${a - d} = ${d}. So the missing number is ${a - d}.`,
  ], 'The number taken away is the gap between what is left and what you started with.');
};
const whatNumber = (y) => {
  const kind = y <= 1 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) { const n = ri(2, y <= 1 ? 10 : 50); return explain(int('logical thinking · what number am I', `I am a number. When you add me to myself, you get ${2 * n}. What number am I?`, n), [
    `Adding a number to itself is doubling it, so double the number is ${2 * n}.`,
    `Half of ${2 * n} is ${n}.`,
    `Check: ${n} + ${n} = ${2 * n}. So the number is ${n}.`,
  ], 'Undo a double by halving.'); }
  if (kind === 2) { const k = ri(1, y <= 1 ? 5 : 9), lo = 10 * k - ri(1, 9), hi = 10 * k + ri(1, 9); return explain(int('logical thinking · what number am I', `I am a number. I am more than ${lo} and less than ${hi}, and I end in 0. What number am I?`, 10 * k), [
    `Numbers that end in 0 near ${lo}: ${10 * k - 10}, ${10 * k}, ${10 * k + 10}.`,
    `${10 * k - 10} is not more than ${lo}, and ${10 * k + 10} is not less than ${hi}.`,
    `Only ${10 * k} is more than ${lo} and less than ${hi}. So the number is ${10 * k}.`,
  ], 'List the numbers that fit one clue, then test them against the other clue.'); }
  const n = ri(2, 30), a = ri(1, 9), D = 2 * (n + a);
  return explain(int('logical thinking · what number am I', `I am a number. Add ${a} to me, then double the result, and you get ${D}. What number am I?`, n), [
    `Work backwards. Undo the doubling: ${D} ÷ 2 = ${n + a}.`,
    `Undo adding ${a}: ${n + a} − ${a} = ${n}.`,
    `Check: (${n} + ${a}) × 2 = ${D}. So the number is ${n}.`,
  ], 'Undo the steps in reverse order: the last step first.');
};
const magicSquare = (y) => {
  const t = ri(0, y <= 1 ? 5 : 12); let sq = [[2, 7, 6], [9, 5, 1], [4, 3, 8]].map((row) => row.map((v) => v + t)); // the Lo Shu square shifted, then turned or flipped
  if (Math.random() < 0.5) sq = sq[0].map((_, j) => sq.map((row) => row[j])); if (Math.random() < 0.5) sq = [...sq].reverse(); if (Math.random() < 0.5) sq = sq.map((row) => [...row].reverse());
  const M = 15 + 3 * t, r0 = ri(0, 2), c0 = ri(0, 2), r1 = (r0 + ri(1, 2)) % 3, [a, b, c] = sq[r1], known = sq[r0].filter((_, j) => j !== c0), miss = sq[r0][c0];
  const at = {}; for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) at[`${r},${cc}`] = r === r0 && cc === c0 ? '?' : String(sq[r][cc]);
  const rowsText = sq.map((row, r) => row.map((v, cc) => (r === r0 && cc === c0 ? '?' : v)).join(', '));
  return explain(withFigure(int('logical thinking · magic square', 'In this magic square every row, every column and both diagonals add up to the same total. What number should replace the ?', miss, { read: `A 3 by 3 magic square: row 1 is ${rowsText[0]}; row 2 is ${rowsText[1]}; row 3 is ${rowsText[2]}. Every row, column and diagonal adds up to the same total. What number replaces the ?` }), grid('Magic square', 3, 3, at)), [
    `Use a complete row: ${a} + ${b} + ${c} = ${M}, so every line adds up to ${M}.`,
    `The row with the ? has ${known[0]} and ${known[1]}: ${known[0]} + ${known[1]} = ${known[0] + known[1]}.`,
    `${M} − ${known[0] + known[1]} = ${miss}. Check: ${known[0]} + ${known[1]} + ${miss} = ${M}.`,
    `So the ? should be ${miss}.`,
  ], 'Find the magic total from a complete line first, then take away the two numbers you know.');
};
const SHAPES = ['circle', 'square', 'triangle', 'star', 'heart'];
const shapePattern = (y) => {
  const p = ri(2, 3), ss = shuffle(SHAPES).slice(0, p), counts = ss.map(() => ri(1, 2)), cycle = ss.flatMap((s, i) => Array(counts[i]).fill(s)), L = cycle.length; if (L < 3) return null;
  const n = ri(8, y <= 1 ? 15 : 24), target = pick(ss), per = counts[ss.indexOf(target)], full = Math.floor(n / L), rem = n % L, extra = cycle.slice(0, rem).filter((s) => s === target).length, cnt = full * per + extra;
  return explain(int('logical thinking · shape patterns', `Shapes are drawn in a row in a repeating pattern: ${cycle.join(', ')}, and then the pattern repeats. How many ${target}s are there among the first ${n} shapes?`, cnt), [
    `One pattern is ${L} shapes long and has ${per} ${target}${es(per)} in it.`,
    `${n} ÷ ${L} = ${full} full patterns, remainder ${rem}.`,
    `${full} full patterns give ${full} × ${per} = ${full * per} ${target}s.`,
    rem ? `The ${rem} shape${es(rem)} left over start${rem === 1 ? 's' : ''} the pattern again (${list(cycle.slice(0, rem))}): ${extra} more ${target}${es(extra)}.` : 'No shapes are left over.',
    `${full * per} + ${extra} = ${cnt}. So there are ${cnt} ${target}s among the first ${n} shapes.`,
  ], 'Divide by the length of the pattern: count the full repeats, then look at the leftover.');
};
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const daysOfWeek = (y) => {
  if (ri(1, 2) === 1) { const w = ri(2, y <= 1 ? 3 : 6), d = ri(1, 6); return explain(int('logical thinking · days of the week', `How many days are there in ${w} weeks and ${d} day${es(d)}?`, 7 * w + d), [
    `1 week = 7 days, so ${w} weeks = ${w} × 7 = ${7 * w} days.`,
    `${7 * w} + ${d} = ${7 * w + d}.`,
    `So there are ${7 * w + d} days.`,
  ], 'A week is 7 days: multiply the weeks by 7, then add the extra days.'); }
  const i = ri(0, 6), k = ri(1, 6), j = (i + k) % 7, walk = Array.from({ length: k }, (_, s) => `${DAYS[(i + s + 1) % 7]} (${s + 1})`);
  return explain(int('logical thinking · days of the week', `Today is ${DAYS[i]}. In how many days will it next be ${DAYS[j]}?`, k), [
    `Count on from ${DAYS[i]}, one day at a time: ${list(walk)}.`,
    `${DAYS[j]} is ${k} day${es(k)} on.`,
    `So it will next be ${DAYS[j]} in ${k} days.`,
  ], 'Count on one day at a time, and remember the week goes round: after Sunday comes Monday.');
};
const doubleHalf = (y) => {
  const kind = y <= 1 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) { const n = ri(2, y <= 1 ? 8 : 25); return explain(int('arithmetic · doubling and halving', `A number is doubled, and the answer is doubled again. The result is ${4 * n}. What was the number?`, n), [
    `Work backwards. Undo the second doubling: ${4 * n} ÷ 2 = ${2 * n}.`,
    `Undo the first doubling: ${2 * n} ÷ 2 = ${n}.`,
    `Check: ${n} → ${2 * n} → ${4 * n}. So the number was ${n}.`,
  ], 'Undo a double by halving; two doubles means halve twice.'); }
  if (kind === 2) { const h = ri(2, y <= 1 ? 10 : 30); return explain(int('arithmetic · doubling and halving', `Half of a number is ${h}. What is double the number?`, 4 * h), [
    `Half is ${h}, so the number is ${h} × 2 = ${2 * h}.`,
    `Double the number: ${2 * h} × 2 = ${4 * h}.`,
    `So double the number is ${4 * h}.`,
  ], 'Half → number → double: two doublings, so 4 times the half.'); }
  const n = ri(3, 40), a = ri(1, 9), D = 2 * n + a;
  return explain(int('arithmetic · doubling and halving', `A number is doubled and then ${a} is added. The result is ${D}. What is the number?`, n), [
    `Work backwards. Undo adding ${a}: ${D} − ${a} = ${2 * n}.`,
    `Undo the doubling: ${2 * n} ÷ 2 = ${n}.`,
    `Check: ${n} × 2 + ${a} = ${D}. So the number is ${n}.`,
  ], 'Work backwards: undo the last step first.');
};
const countingSteps = (y) => {
  const s = pick(y <= 1 ? [2, 5, 10] : [2, 3, 4, 5, 10]);
  if (ri(1, 2) === 1) { const k = ri(4, 10), seq = Array.from({ length: k }, (_, i) => s * (i + 1)); return explain(int('arithmetic · counting in steps', `Counting in ${s}s from ${s}: ${s}, ${2 * s}, ${3 * s}, … What is the ${ord(k)} number said?`, s * k), [
    `Counting in ${s}s: ${list(seq)}.`,
    `The ${ord(k)} number is ${s} × ${k} = ${s * k}.`,
    `So the ${ord(k)} number said is ${s * k}.`,
  ], 'The k-th number when counting in steps of s is s × k.'); }
  const start = s * ri(8, 12), k = ri(4, 7), seq = Array.from({ length: k }, (_, i) => start - s * i);
  return explain(int('arithmetic · counting in steps', `Counting down in ${s}s from ${start}: ${start}, ${start - s}, ${start - 2 * s}, … What is the ${ord(k)} number said?`, start - s * (k - 1)), [
    `Counting down in ${s}s: ${list(seq)}.`,
    `From the 1st number to the ${ord(k)} is ${k - 1} jumps of ${s}: ${start} − ${s} × ${k - 1} = ${start - s * (k - 1)}.`,
    `So the ${ord(k)} number said is ${start - s * (k - 1)}.`,
  ], 'From the 1st to the k-th number there are only k − 1 jumps.');
};
const numberClues = (y) => {
  const kind = y <= 1 ? ri(1, 2) : ri(1, 4);
  if (kind === 1) { const u = ri(0, 9); return explain(int('number theory · number clues', `What is the largest two-digit number whose ones digit is ${u}?`, 90 + u), [
    'The tens digit can be 9 at most.',
    `Tens digit 9, ones digit ${u}: ${90 + u}.`,
    `So the largest such number is ${90 + u}.`,
  ], 'Largest: make the front digit as big as it can be. Smallest: as small as it can be, but not 0.'); }
  if (kind === 2) { const u = ri(0, 9); return explain(int('number theory · number clues', `What is the smallest two-digit number whose ones digit is ${u}?`, 10 + u), [
    'The tens digit cannot be 0, so the smallest it can be is 1.',
    `Tens digit 1, ones digit ${u}: ${10 + u}.`,
    `So the smallest such number is ${10 + u}.`,
  ], 'Largest: make the front digit as big as it can be. Smallest: as small as it can be, but not 0.'); }
  const p = pick([4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 24, 28, 30, 32, 36]), nums = []; for (let k = 10; k <= 99; k++) { const [t, u] = digitsOf(k); if (t * u === p) nums.push(k); }
  const pairs = nums.filter((k) => digitsOf(k)[0] <= digitsOf(k)[1]).map((k) => `${digitsOf(k)[0]} × ${digitsOf(k)[1]}`), small = kind === 3, ans = small ? nums[0] : nums[nums.length - 1];
  return explain(int('number theory · number clues', `What is the ${small ? 'smallest' : 'largest'} two-digit number whose digits multiply to give ${p}?`, ans), [
    `Pairs of digits that multiply to ${p}: ${list(pairs)}.`,
    `The two-digit numbers made from them: ${list(nums)}.`,
    `The ${small ? 'smallest' : 'largest'} is ${ans}. So the number is ${ans}.`,
  ], 'List every number that fits the clue, then pick the one asked for.');
};
const sumOfDigits = (y) => {
  const kind = y <= 1 ? pick([1, 3]) : ri(1, 3);
  if (kind === 1) { const N = y <= 1 ? ri(10, 99) : ri(100, 999), ds = digitsOf(N); return explain(int('number theory · sum of digits', `What is the sum of the digits of ${N}?`, sum(ds)), [
    `The digits of ${N} are ${list(ds)}.`,
    `${plus(ds)} = ${sum(ds)}.`,
    `So the sum of the digits is ${sum(ds)}.`,
  ], 'The digits are the single figures a number is written with: add them one by one.'); }
  if (kind === 2) { const s = ri(3, 17), nums = []; for (let k = 10; k <= 99; k++) if (sum(digitsOf(k)) === s) nums.push(k); return explain(int('number theory · sum of digits', `How many two-digit numbers have digits that add up to ${s}?`, nums.length), [
    `List them in order, tens digit from small to large: ${list(nums)}.`,
    `Count them: ${nums.length}. So there are ${nums.length} such numbers.`,
  ], 'List in order, tens digit 1 first, then 2, then 3, so nothing is missed.'); }
  const s = ri(3, 17), u = ri(Math.max(0, s - 9), Math.min(9, s - 1)), t = s - u, N = 10 * t + u;
  return explain(int('number theory · sum of digits', `The digits of a two-digit number add up to ${s}. Its ones digit is ${u}. What is the number?`, N), [
    `The tens digit and ${u} add up to ${s}, so the tens digit is ${s} − ${u} = ${t}.`,
    `Tens digit ${t}, ones digit ${u}: ${N}.`,
    `Check: ${t} + ${u} = ${s}. So the number is ${N}.`,
  ], 'The tens digit is the digit sum take away the ones digit.');
};
const countMultiples = (y) => {
  const d = pick(y <= 1 ? [2, 5, 10] : [2, 3, 4, 5, 10]), n = ri(15, y <= 1 ? 40 : 100), q = Math.floor(n / d), r = n % d, ms = Array.from({ length: q }, (_, i) => d * (i + 1));
  return explain(int('number theory · counting multiples', `How many numbers from 1 to ${n} are multiples of ${d}?`, q), [
    q <= 12 ? `The multiples of ${d} up to ${n}: ${list(ms)}.` : `The multiples of ${d} go ${d}, ${2 * d}, ${3 * d}, … The last one up to ${n} is ${d * q}.`,
    `${n} ÷ ${d} = ${q} remainder ${r}: the multiples are ${d} × 1 up to ${d} × ${q}.`,
    `So there are ${q} multiples of ${d}.`,
  ], 'How many multiples up to n: divide n by the number and ignore the remainder.');
};
const ordering = (y) => {
  const lo = y <= 1 ? 10 : pick([10, 100]), hi = lo === 10 ? (y <= 1 ? 50 : 99) : 999, xs = []; while (xs.length < 4) { const v = ri(lo, hi); if (!xs.includes(v)) xs.push(v); }
  const mx = Math.max(...xs), mn = Math.min(...xs);
  if (ri(1, 2) === 1) return explain(int('number theory · ordering', `What is the difference between the largest and the smallest of these numbers: ${list(xs)}?`, mx - mn), [
    `Largest: ${mx}. Smallest: ${mn}.`,
    `${mx} − ${mn} = ${mx - mn}.`,
    `So the difference is ${mx - mn}.`,
  ], 'Find the biggest and the smallest first, then subtract.');
  return explain(int('number theory · ordering', `What is the sum of the largest and the smallest of these numbers: ${list(xs)}?`, mx + mn), [
    `Largest: ${mx}. Smallest: ${mn}.`,
    `${mx} + ${mn} = ${mx + mn}.`,
    `So the sum is ${mx + mn}.`,
  ], 'Find the biggest and the smallest first, then add.');
};
const matchsticks = (y) => {
  const kind = y <= 1 ? ri(1, 2) : ri(1, 3), n = ri(2, y <= 1 ? 6 : 12);
  if (kind === 1) return explain(int('geometry · matchsticks', `${n} squares are made in a row from matchsticks, each square sharing a side with the next. How many matchsticks are used?`, 3 * n + 1), [
    'The first square needs 4 sticks.',
    `Each new square shares a side with the one before, so it needs only 3 more: ${n - 1} × 3 = ${3 * (n - 1)}.`,
    `4 + ${3 * (n - 1)} = ${3 * n + 1}. So ${3 * n + 1} matchsticks are used.`,
  ], 'The first shape costs full price; each next one shares a side and costs one less.');
  if (kind === 2) return explain(int('geometry · matchsticks', `${n} triangles are made in a row from matchsticks, each triangle sharing a side with the next. How many matchsticks are used?`, 2 * n + 1), [
    'The first triangle needs 3 sticks.',
    `Each new triangle shares a side with the one before, so it needs only 2 more: ${n - 1} × 2 = ${2 * (n - 1)}.`,
    `3 + ${2 * (n - 1)} = ${2 * n + 1}. So ${2 * n + 1} matchsticks are used.`,
  ], 'The first shape costs full price; each next one shares a side and costs one less.');
  return explain(int('geometry · matchsticks', `A row of squares made from matchsticks, each square sharing a side with the next, uses ${3 * n + 1} matchsticks. How many squares are there?`, n), [
    'The first square uses 4 sticks, and every square after it adds 3.',
    `${3 * n + 1} − 4 = ${3 * n - 3} sticks are for the extra squares: ${3 * n - 3} ÷ 3 = ${n - 1} more squares.`,
    `1 + ${n - 1} = ${n}. So there are ${n} squares.`,
  ], 'Take away the first shape, then divide by what each extra shape costs.');
};
const sidesCorners = (y) => {
  const a = ri(1, 5), b = ri(1, 5), kind = y <= 1 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) return explain(int('geometry · sides and corners', `A picture has ${a} triangle${es(a)} and ${b} square${es(b)}. How many sides do the shapes have altogether?`, 3 * a + 4 * b), [
    `Each triangle has 3 sides: ${a} × 3 = ${3 * a}.`,
    `Each square has 4 sides: ${b} × 4 = ${4 * b}.`,
    `${3 * a} + ${4 * b} = ${3 * a + 4 * b}. So there are ${3 * a + 4 * b} sides altogether.`,
  ], 'Count each kind of shape separately, then add.');
  if (kind === 2) return explain(int('geometry · sides and corners', `A picture has ${a} triangle${es(a)} and ${b} rectangle${es(b)}. How many corners do the shapes have altogether?`, 3 * a + 4 * b), [
    `Each triangle has 3 corners: ${a} × 3 = ${3 * a}.`,
    `Each rectangle has 4 corners: ${b} × 4 = ${4 * b}.`,
    `${3 * a} + ${4 * b} = ${3 * a + 4 * b}. So there are ${3 * a + 4 * b} corners altogether.`,
  ], 'Count each kind of shape separately, then add.');
  return explain(int('geometry · sides and corners', `A picture has ${a} pentagon${es(a)} and ${b} hexagon${es(b)}. How many corners do the shapes have altogether?`, 5 * a + 6 * b), [
    `A pentagon has 5 corners: ${a} × 5 = ${5 * a}.`,
    `A hexagon has 6 corners: ${b} × 6 = ${6 * b}.`,
    `${5 * a} + ${6 * b} = ${5 * a + 6 * b}. So there are ${5 * a + 6 * b} corners altogether.`,
  ], 'Penta means 5 and hexa means 6: count each kind, then add.');
};
const countTriangles = (y) => {
  const n = y <= 1 ? ri(2, 3) : ri(3, 6), seq = Array.from({ length: n }, (_, i) => n - i), total = (n * (n + 1)) / 2;
  return explain(int('geometry · counting triangles', `A large triangle is cut into ${n} small triangles side by side by ${n - 1} line${es(n - 1)} drawn from its top corner to its bottom side. How many triangles of every size are there in the figure?`, total), [
    'Count by size, from the smallest. Every run of small triangles side by side makes one bigger triangle.',
    `Made of 1 small triangle: ${n}, ${seq.slice(1).map((v, i) => `of ${i + 2} side by side: ${v}`).join(', ')}.`,
    `${plus(seq)} = ${total}. So there are ${total} triangles.`,
  ], 'Count by size, small to large, so nothing is missed.');
};
const distanceRound = (y) => {
  const kind = y <= 1 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) { const l = ri(3, y <= 1 ? 10 : 20), w = ri(1, l - 1); return explain(int('geometry · distance round a shape', `A rectangle is ${l} cm long and ${w} cm wide. How far is it all the way round the rectangle, in cm?`, 2 * (l + w)), [
    `All the way round means all 4 sides: ${l} + ${w} + ${l} + ${w}.`,
    `${l} + ${w} = ${l + w}, and ${l + w} + ${l + w} = ${2 * (l + w)}.`,
    `So it is ${2 * (l + w)} cm all the way round.`,
  ], 'Round a rectangle: length + width, then double.'); }
  if (kind === 2) { const s = ri(2, y <= 1 ? 10 : 25); return explain(int('geometry · distance round a shape', `A square has sides of ${s} cm. How far is it all the way round the square, in cm?`, 4 * s), [
    'A square has 4 equal sides.',
    `${s} + ${s} + ${s} + ${s} = 4 × ${s} = ${4 * s}.`,
    `So it is ${4 * s} cm all the way round.`,
  ], 'Round a square: 4 times one side.'); }
  const l = ri(4, 15), w = ri(1, l - 1), P = 2 * (l + w);
  return explain(int('geometry · distance round a shape', `All the way round a rectangle is ${P} cm. The rectangle is ${l} cm long. How wide is it, in cm?`, w), [
    `Length + width is half of the way round: ${P} ÷ 2 = ${l + w}.`,
    `${l + w} − ${l} = ${w}.`,
    `Check: ${l} + ${w} + ${l} + ${w} = ${P}. So the rectangle is ${w} cm wide.`,
  ], 'Half the way round is one length plus one width.');
};
const halvesQuarters = (y) => {
  const kind = y <= 1 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) { const a = ri(2, y <= 1 ? 10 : 25); return explain(int('geometry · halves and quarters', `A square sheet of paper is folded in half, then in half again. The folded piece has an area of ${a} cm². What was the area of the whole sheet, in cm²?`, 4 * a), [
    'Folding in half makes 2 equal pieces; folding in half again makes 4 equal pieces.',
    `4 × ${a} = ${4 * a}.`,
    `So the whole sheet had an area of ${4 * a} cm².`,
  ], 'Half of a half is a quarter: two folds make 4 equal pieces.'); }
  if (kind === 2) { const A = 4 * ri(2, y <= 1 ? 8 : 25); return explain(int('geometry · halves and quarters', `A rectangle has an area of ${A} cm². It is cut into 4 equal parts. What is the area of one part, in cm²?`, A / 4), [
    `4 equal parts share ${A} cm² equally: ${A} ÷ 4 = ${A / 4}.`,
    `Check: 4 × ${A / 4} = ${A}. So one part has an area of ${A / 4} cm².`,
  ], 'Equal parts: divide the whole by how many parts.'); }
  const s = pick([4, 6, 8, 10, 12]);
  return explain(int('geometry · halves and quarters', `A square has sides of ${s} cm. It is cut in half along a line from one corner to the opposite corner. What is the area of one half, in cm²?`, (s * s) / 2), [
    `The square's area is ${s} × ${s} = ${s * s} cm².`,
    `The cut from corner to corner makes 2 equal triangles: ${s * s} ÷ 2 = ${(s * s) / 2}.`,
    `So one half has an area of ${(s * s) / 2} cm².`,
  ], 'A corner-to-corner cut halves a square.');
};
const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
const lineUp = (y) => {
  const n = y <= 1 ? ri(2, 3) : ri(3, 4), seq = Array.from({ length: n }, (_, i) => n - i), kids = names(n), letters = kids.map((k) => k[0]), distinct = new Set(letters).size === n;
  return explain(int('combinatorics · lining up', `In how many different orders can ${n} friends stand in a line for a photo?`, fact(n)), n <= 3 && distinct ? [
    `Call the friends ${kids.join(', ')}: ${letters.join(', ')} for short.`,
    `List every order: ${perms(letters).map((p) => p.join('')).join(', ')}.`,
    `Count them: ${fact(n)}. So there are ${fact(n)} different orders.`,
  ] : [
    `The first place can be any of the ${n} friends, the next any of the ${n - 1} left, and so on down to 1.`,
    `${seq.join(' × ')} = ${fact(n)}.`,
    `So there are ${fact(n)} different orders.`,
  ], 'Fill the places one at a time and multiply the choices, or list every order when there are few.');
};
const payCoins = (y) => {
  const [small, big] = pick(y <= 1 ? [[1, 2], [5, 10]] : [[1, 2], [2, 5], [5, 10]]);
  const S = small === 1 ? ri(4, y <= 1 ? 8 : 12) : small === 5 ? 5 * ri(3, y <= 1 ? 8 : 12) : pick([10, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25]);
  const combos = []; for (let b = Math.floor(S / big); b >= 0; b--) { const rest = S - b * big; if (rest % small) continue; const a = rest / small; combos.push([b ? `${b} × $${big}` : '', a ? `${a} × $${small}` : ''].filter(Boolean).join(' + ')); }
  if (combos.length < 2 || combos.length > 7) return null;
  return explain(int('combinatorics · paying with coins', `In how many different ways can you pay exactly $${S} using only $${small} coins and $${big} coins? You may use just one kind.`, combos.length), [
    `List the ways in order, starting with the most $${big} coins.`,
    `${combos.join('; ')}.`,
    `Count them: ${combos.length}. So there are ${combos.length} ways.`,
  ], 'List in order, starting with the biggest coin, so nothing is missed or repeated.');
};
const colourFlags = (y) => {
  const k = ri(3, y <= 1 ? 4 : 5), kind = y <= 1 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) return explain(int('combinatorics · colouring flags', `A flag has 2 stripes, one above the other. Each stripe is painted one of ${k} colours, and the two stripes must be different colours. How many different flags can be made?`, k * (k - 1)), [
    `The top stripe can be any of the ${k} colours.`,
    `The bottom stripe must be different, so ${k - 1} choices for each top colour.`,
    `${k} × ${k - 1} = ${k * (k - 1)}. So ${k * (k - 1)} different flags can be made.`,
  ], 'Colour one stripe at a time and multiply the choices.');
  if (kind === 2) return explain(int('combinatorics · colouring flags', `A flag has 2 stripes, one above the other. Each stripe is painted one of ${k} colours. The stripes may be the same colour or different. How many different flags can be made?`, k * k), [
    `The top stripe can be any of the ${k} colours.`,
    `The bottom stripe can also be any of the ${k} colours, even the same one.`,
    `${k} × ${k} = ${k * k}. So ${k * k} different flags can be made.`,
  ], 'Colour one stripe at a time and multiply the choices.');
  return explain(int('combinatorics · colouring flags', `A flag has 3 stripes, one above the other. Each stripe is painted one of ${k} colours, and stripes next to each other must be different colours. How many different flags can be made?`, k * (k - 1) * (k - 1)), [
    `The top stripe can be any of the ${k} colours.`,
    `The middle stripe must differ from the top: ${k - 1} choices. The bottom must differ from the middle: ${k - 1} choices (it may match the top).`,
    `${k} × ${k - 1} × ${k - 1} = ${k * (k - 1) * (k - 1)}. So ${k * (k - 1) * (k - 1)} different flags can be made.`,
  ], 'Colour one stripe at a time and multiply the choices.');
};
const FRUITS = ['apple', 'pear', 'plum', 'fig', 'kiwi', 'mango', 'grape', 'melon'];
const chooseTwo = (y) => {
  const n = y <= 1 ? ri(3, 4) : ri(3, 5), fr = shuffle(FRUITS).slice(0, n), seq = Array.from({ length: n - 1 }, (_, i) => n - 1 - i), C = choose(n, 2);
  const pairs = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push(`${fr[i]} and ${fr[j]}`);
  return explain(int('combinatorics · choosing two', `${names(1)[0]} chooses 2 different fruits from ${n} kinds: ${list(fr)}. How many different pairs of fruits can be chosen?`, C), [
    `Pair ${fr[0]} with each of the other ${n - 1}: ${n - 1} pairs. Then ${fr[1]} with each fruit after it: ${n - 2} pairs, and so on.`,
    n <= 4 ? `The pairs: ${list(pairs)}.` : '',
    `${plus(seq)} = ${C}.`,
    `So there are ${C} different pairs.`,
  ], 'Pair the first with everyone, then the second with those after it, so no pair is counted twice.');
};

// each category's kinds, with the years they suit and the moon that leans on them ('hk' number theory and counting, 'bkk' logic set-pieces and arithmetic tricks)
const KINDS = {
  LT: [['balance', balance, [1, 6], 'bkk'], ['guess two-digit', guessTwoDigit, [2, 4]], ['guess four-digit', guessFourDigit, [5, 6]], ['periodic', periodic, [3, 6], 'bkk'], ['pigeonhole', pigeonhole, [3, 6]], ['chicken and rabbit', chickenRabbit, [4, 6], 'bkk'], ['speed', speed, [5, 6], 'bkk'], ['ages', ages, [3, 6]], ['dates', daysBetween, [3, 6]], ['figure patterns', rowsOfDots, [1, 4]],
    ['cryptarithm', cryptAB, [2, 4], 'hk'], ['work and rest', workRest, [1, 4], 'bkk'], ['give and take', giveTake, [3, 6]], ['defined operations', definedOp, [4, 6], 'hk'], ['sum and multiple', sumMultiple, [3, 6]], ['number sequences', decreasingDiffs, [2, 5], 'bkk'], ['averages', averageMissing, [3, 6]], ['ratio chicken and rabbit', ratioChickenRabbit, [5, 6], 'bkk'], ['working backwards with fractions', workBackFractions, [4, 6]], ['working backwards', workBackOps, [4, 6]],
    ['what number am I', whatNumber, [1, 3]], ['magic square', magicSquare, [1, 3], 'hk'], ['shape patterns', shapePattern, [1, 2], 'bkk'], ['days of the week', daysOfWeek, [1, 3]]],
  AR: [['smart addition', smartAdd, [1, 3], 'bkk'], ['Gaussian addition', gauss, [3, 6], 'bkk'], ['smart four-digit', smartFourDigit, [4, 6], 'bkk'], ['multiplication trick', multiplyTrick, [4, 6], 'bkk'], ['geometric sum', geometricSum, [5, 6], 'bkk'], ['sum of squares', squaresSum, [5, 6]], ['decimals', decimalTrick, [5, 6]], ['fraction chain', fractionChain, [5, 6]], ['missing digit', missingDigit, [1, 4]],
    ['multiples sum', multiplesSum, [2, 6], 'bkk'], ['triangular numbers', triangularSum, [4, 6]], ['mixed calculation', computeMixed, [4, 6]], ['squares', squareMinus, [5, 6]], ['squares in a range', squaresRange, [5, 6]], ['telescoping', telescopingOdd, [5, 6]], ['series average', seriesAverage, [5, 6]], ['eggs in boxes', eggsBoxes, [1, 3]], ['smallest multiple', smallestMultiple, [2, 4]],
    ['number bonds', numberBond, [1, 2]], ['doubling and halving', doubleHalf, [1, 3], 'bkk'], ['counting in steps', countingSteps, [1, 2]]],
  NT: [['odd and even', evenOddCount, [1, 3]], ['largest with a digit sum', largestWithDigitSum, [1, 3]], ['digit count', digitCount, [2, 6], 'hk'], ['primes', primesQ, [4, 6], 'hk'], ['LCM and HCF', lcmHcf, [4, 6]], ['divisibility', divisibility, [4, 6], 'hk'], ['number of factors', factorsCount, [4, 6], 'hk'], ['sum of factors', factorsSum, [5, 6], 'hk'], ['unit digit', unitDigit, [5, 6], 'hk'], ['remainders', remainders, [5, 6], 'hk'], ['digit sums', digitSumProperty, [3, 5]],
    ['evens in a range', evensInRange, [2, 4]], ['unit digit of a sum', unitDigitSumPowers, [5, 6], 'hk'], ['three remainders', crtLargest, [5, 6], 'hk'], ['coprime', phiCount, [6, 6], 'hk'], ['divisible by either', divisibleEither, [4, 6], 'hk'], ['largest and smallest', largestSmallestDigits, [2, 4]],
    ['number clues', numberClues, [1, 3], 'hk'], ['sum of digits', sumOfDigits, [1, 3], 'hk'], ['counting multiples', countMultiples, [1, 3]], ['ordering', ordering, [1, 2]]],
  GE: [['shapes and solids', shapesQ, [1, 2]], ['counting figures', countSquares, [1, 6]], ['perimeter and area', perimeterArea, [3, 6]], ['angles', anglesQ, [4, 6]], ['circles', circleQ, [5, 6]], ['volume and surface', volumeSurface, [5, 6]], ['ratio of areas', areaRatio, [5, 6]],
    ['pyramids and prisms', pyramidPrism, [3, 6]], ['smallest and largest area', minMaxArea, [4, 6]], ['exterior angles', exteriorAngle, [5, 6]], ['coins round a square', coinsSquare, [1, 3]], ['wire into squares', wireSquares, [3, 6]],
    ['matchsticks', matchsticks, [1, 3]], ['sides and corners', sidesCorners, [1, 2]], ['counting triangles', countTriangles, [1, 3]], ['distance round a shape', distanceRound, [1, 2]], ['halves and quarters', halvesQuarters, [1, 3]]],
  CO: [['two-digit numbers', twoDigitFromDigits, [1, 4]], ['pairs', pairsCount, [1, 3]], ['three-digit numbers', threeDigitFromDigits, [4, 6], 'hk'], ['handshakes', handshakes, [2, 6]], ['routing', routing, [3, 6], 'hk'], ['distribution', distribution, [4, 6]], ['excess and deficiency', excessDeficiency, [4, 6], 'bkk'], ['combinations', combinationsQ, [5, 6], 'hk'], ['permutations', permutationsQ, [5, 6], 'hk'], ['inclusion and exclusion', inclusionExclusion, [5, 6], 'hk'], ['dice', diceWays, [5, 6]],
    ['routes', routesCompound, [2, 5], 'hk'], ['big teams', bigCombinations, [6, 6], 'hk'], ['arrangements', multinomial, [6, 6], 'hk'], ['complement counting', complementCount, [5, 6], 'hk'], ['restricted digits', digitRestricted, [4, 6]],
    ['lining up', lineUp, [1, 3]], ['paying with coins', payCoins, [1, 3], 'bkk'], ['colouring flags', colourFlags, [1, 3]], ['choosing two', chooseTwo, [1, 2], 'hk']],
};
export const CATEGORIES = Object.freeze({ LT: 'Logical thinking', AR: 'Arithmetic', NT: 'Number theory', GE: 'Geometry', CO: 'Combinatorics' });
// the pool a moon draws from: every kind that suits the year, its own leanings first three times in four (buildHeat picks by category)
function pool(year, lean) {
  const out = [];
  for (const [cat, kinds] of Object.entries(KINDS)) {
    const fit = kinds.filter(([, , [lo, hi]]) => year >= lo && year <= hi), own = fit.filter((k) => k[3] === lean), copies = own.length ? 3 : 0;
    for (const [name, gen, , tag] of fit) for (let c = 0; c < (tag === lean ? copies : 1); c++) out.push({ cat: `${cat}:${name}`, gen, sections: [cat] });
  }
  return out;
}
// the real heat paper: 25 short answers in 90 minutes, five a category in the order Logical Thinking, Arithmetic, Number Theory,
// Geometry, Combinatorics, 4 marks each. Three sittings of ours: two categories, two categories, then the last (the owner, 20 Sep 2026)
export const PHASES = [phase('alpha', 'Logical thinking · Arithmetic', 4, 36, slots([['LT', 'sa', 5], ['AR', 'sa', 5]])), phase('beta', 'Number theory · Geometry', 4, 36, slots([['NT', 'sa', 5], ['GE', 'sa', 5]])), phase('gamma', 'Combinatorics', 4, 18, slots([['CO', 'sa', 5]]))];
/** A section of short answers in the real order; `lean` names the moon whose signature kinds come up three times as often. */
export function ocecBuild(shape, year, lean) {
  return buildHeat(shape, pool(year, lean), year).map((q) => ({ ...q, cat: q.cat.replace(/^[A-Z]{2}:/, `${CATEGORIES[q.section].toLowerCase()} · `) }));
}
