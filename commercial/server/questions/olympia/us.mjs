// 🦅 US-MOON — practice modelled on AMO (the American Mathematics Olympiad, SIMCC with Southern Illinois University); not
// affiliated. The real paper is US Common Core content delivered through the Singapore model method, with a non-routine
// strand that names cryptarithms, divisibility tests, number patterns, spatial visualisation and logic. AMO starts at Grade 2,
// so this moon opens at Year 2; the syllabus is banded 2–4 and 5–6, and so are these generators. The paper is 15 multiple-choice
// questions at three marks, then five open answers at five and five at six, 90 minutes, five options, no penalty (SIU's AMO
// Info Pack 2025, the source check of 20 Sep 2026) — so a heat is six three-mark multiple choice then two five-mark and two
// six-mark typed answers, every kind tagged with the tiers it may fill in each band, and the kinds after "the paper's tiers" are
// the staples the Info Pack's worked examples ask that the first build lacked.
// Every seed is wrapped in explain(seed, steps, tip) — the worked solution in the child's own method (STEPS.md, 20 Sep 2026):
// the bar model and units for the model-method kinds, column by column for the cryptarithms, the quick tests for divisibility,
// jumps for the patterns, and pairing for the sums. Every number in a step is computed from the question's own variables.
import { ri, pick, shuffle, sum, cap, names, thing, money, int, frac, mcOnly, withFigure, grid, table, buildHeat, slots, phase, explain, bar, digitsOf, gcd, ord, factorsOf } from './common.mjs';

const upper = (y) => y >= 5;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const un = (n) => `${n} unit${n === 1 ? '' : 's'}`;
const hrs = (n) => `${n} hour${n === 1 ? '' : 's'}`;

// ---- word problems by the model method ----
const model = (y) => {
  const kind = upper(y) ? ri(1, 4) : ri(1, 2), [a, b] = names(2), it = thing();
  if (kind === 1) {
    const small = ri(y <= 3 ? 3 : 8, y <= 3 ? 15 : 40), d = ri(2, y <= 3 ? 8 : 20), total = 2 * small + d;
    return explain(int('model method', `${a} and ${b} have ${total} ${it}s altogether. ${a} has ${d} more than ${b}. How many ${it}s does ${b} have?`, small), [
      bar(b, 1, '?'),
      bar(a, 1, `and ${d} more`),
      `Take the extra ${d} away from the total: ${total} − ${d} = ${2 * small}.`,
      `Now the 2 bars are equal and share ${2 * small}: ${2 * small} ÷ 2 = ${small}.`,
      `So ${b} has ${small} ${it}s.`,
    ], 'When one person has more, take the extra away first, then share what is left equally.');
  }
  if (kind === 2) {
    const k = ri(2, y <= 3 ? 3 : 5), u = ri(2, y <= 3 ? 9 : 15), total = (k + 1) * u;
    const picture = [bar(b, 1), bar(a, k), `${a}'s ${k} units and ${b}'s 1 unit make ${k + 1} units, and ${k + 1} units = ${total}.`, `1 unit = ${total} ÷ ${k + 1} = ${u}.`];
    if (ri(1, 2) === 1) return explain(int('model method', `${a} has ${k} times as many ${it}s as ${b}. Together they have ${total}. How many ${it}s does ${a} have?`, k * u), [
      ...picture, `${a} has ${k} units: ${k} × ${u} = ${k * u}.`, `So ${a} has ${k * u} ${it}s.`,
    ], '"Times as many" means equal boxes: count the boxes, then share the total among them.');
    return explain(int('model method', `${a} has ${k} times as many ${it}s as ${b}. Together they have ${total}. How many more ${it}s does ${a} have than ${b}?`, (k - 1) * u), [
      ...picture, `${a} has ${k} − 1 = ${un(k - 1)} more than ${b}: ${k - 1} × ${u} = ${(k - 1) * u}.`, `So ${a} has ${(k - 1) * u} more ${it}s than ${b}.`,
    ], '"How many more" on a bar model is the extra boxes: count them, then multiply by 1 unit.');
  }
  if (kind === 3) {
    const d = pick([5, 7, 8, 9]), n = ri(3, d - 1), diff = 2 * n - d, u = ri(2, 12); if (diff <= 0 || gcd(n, d) !== 1) return null;
    return explain(int('model method', `In a class, ${n}/${d} of the pupils are girls. There are ${diff * u} more girls than boys. How many pupils are in the class?`, d * u), [
      `Cut the class into ${d} equal units: girls are ${n} units, boys are ${d} − ${n} = ${un(d - n)}.`,
      bar('Girls', n),
      bar('Boys', d - n, `${diff * u} fewer`),
      diff === 1 ? `Girls have ${n} − ${d - n} = 1 unit more, and that 1 unit is the ${diff * u} extra pupils, so 1 unit = ${u}.` : `Girls have ${n} − ${d - n} = ${un(diff)} more, so ${un(diff)} = ${diff * u} pupils and 1 unit = ${diff * u} ÷ ${diff} = ${u}.`,
      `The whole class is ${d} units: ${d} × ${u} = ${d * u}.`,
      `So there are ${d * u} pupils in the class.`,
    ], 'A fraction of the class tells you the units: the bottom number is the whole class.');
  }
  return equalAfter();
};
// b had x, a had kx; a gives g and they are equal: kx − g = x + g, so g = (k−1)x/2 — pick x so that g is whole
const equalAfter = () => {
  const k = pick([2, 3, 5]), [a, b] = names(2), x = (k === 2 ? 2 : 1) * ri(2, 12), g = ((k - 1) * x) / 2;
  return explain(int('model method', `${a} had ${k} times as much money as ${b}. After ${a} gave ${b} ${money(g)}, they had the same amount. How much money did ${b} have at first (in dollars)?`, x), [
    bar(b, 1),
    bar(a, k),
    `${a} has ${k} − 1 = ${un(k - 1)} more than ${b}.`,
    `Giving $${g} made them equal, so $${g} is half of the difference: the difference is 2 × ${g} = $${2 * g}.`,
    k - 1 === 1 ? `That difference is exactly 1 unit, so 1 unit = $${x}.` : `${un(k - 1)} = $${2 * g}, so 1 unit = ${2 * g} ÷ ${k - 1} = $${x}.`,
    `So ${b} had $${x} at first.`,
  ], 'A gift that makes two people equal is half of the difference between them.');
};
// ---- cryptarithms: one letter stands for one digit ----
const crypt = (y) => {
  if (!upper(y)) {
    const A = ri(1, 9), p = ri(0, 9), q = ri(1, 9), s = (10 * A + p) + (10 * q + A), c = p + A >= 10 ? 1 : 0;
    return explain(int('cryptarithm', `In this addition each A stands for the same digit: A${p} + ${q}A = ${s}. What digit is A?`, A), [
      `Ones column: ${p} + A must end in ${s % 10}.`,
      `${p} + ${A} = ${p + A}, which ends in ${s % 10}${c ? ' and carries 1' : ''}, so A = ${A}.`,
      `Check the tens column: ${A} + ${q}${c ? ' + 1' : ''} = ${Math.floor(s / 10)}, which matches ${s}.`,
      `So A = ${A}.`,
    ], 'In a letter sum, start from the ones column and work to the left.');
  }
  const A = ri(1, 9), p = ri(0, 9), q = ri(1, 9), r = ri(0, 9), s = (100 * A + 10 * p + q) + (100 * r + 10 * A + A), c1 = q + A >= 10 ? 1 : 0, c2 = p + A + c1 >= 10 ? 1 : 0;
  return explain(int('cryptarithm', `In this addition each A stands for the same digit: A${p}${q} + ${r}AA = ${s}. What digit is A?`, A), [
    `Ones column: ${q} + A must end in ${s % 10}.`,
    `${q} + ${A} = ${q + A}, which ends in ${s % 10}${c1 ? ' and carries 1' : ''}, so A = ${A}.`,
    `Tens column: ${p} + ${A}${c1 ? ' + 1' : ''} = ${p + A + c1}, ending in ${(p + A + c1) % 10}${c2 ? ' and carrying 1' : ''}.`,
    `Hundreds column: ${A} + ${r}${c2 ? ' + 1' : ''} = ${A + r + c2}, which gives ${s}.`,
    `So A = ${A}.`,
  ], 'In a letter sum, start from the ones column and work to the left.');
};
// ---- divisibility ----
const RULE = { 2: 'its last digit is 0, 2, 4, 6 or 8', 3: 'its digits add up to a multiple of 3', 4: 'its last two digits make a multiple of 4', 5: 'its last digit is 0 or 5', 6: 'it is even and its digits add up to a multiple of 3', 9: 'its digits add up to a multiple of 9', 10: 'its last digit is 0' };
const passes = (v, d) => { const ds = digitsOf(v), s = sum(ds), last2 = Number(String(v).slice(-2)); if (d === 2 || d === 5 || d === 10) return `${v} ends in ${v % 10}`; if (d === 4) return `${v} ends in ${String(v).slice(-2)}, and ${last2} = 4 × ${last2 / 4}`; if (d === 6) return `${v} is even, and ${ds.join(' + ')} = ${s} = 3 × ${s / 3}`; return `${ds.join(' + ')} = ${s} = ${d} × ${s / d}`; };
const divisibility = (y) => {
  const kind = upper(y) ? ri(1, 3) : ri(1, 2);
  if (kind === 1) {
    const d = upper(y) ? pick([3, 4, 6, 9]) : pick([2, 3, 5, 10]); const right = d * ri(upper(y) ? 30 : 10, upper(y) ? 200 : 40); const wrongs = new Set(); while (wrongs.size < 4) { const w = right + pick([1, -1, 2, -2, 3, -3, 5, -5]); if (w % d !== 0 && w > 0) wrongs.add(w); }
    return explain(mcOnly('divisibility', `Which of these numbers is divisible by ${d}?`, right, [...wrongs]), [
      `A number is divisible by ${d} when ${RULE[d]}.`,
      `Test ${right}: ${passes(right, d)}, so it passes.`,
      `Check: ${right} ÷ ${d} = ${right / d} exactly. The other numbers fail the test.`,
      `So the number divisible by ${d} is ${right}.`,
    ], 'The quick tests: 2, 5 and 10 look at the last digit; 3 and 9 add the digits; 4 looks at the last two digits.');
  }
  if (kind === 2) {
    const d = pick([3, 9]), a = ri(1, 9), b = ri(0, 9), c = ri(0, 9), base = a * 100 + b * 10 + c; let x = 0; while ((sum(digitsOf(base)) + x) % d !== 0) x++; const s = a + b + c;
    return explain(int('divisibility', `What is the smallest digit that can go in the blank so that ${a}${b}${c}_ is divisible by ${d}?`, x), [
      `A number is divisible by ${d} when its digits add up to a multiple of ${d}.`,
      `The digits so far: ${a} + ${b} + ${c} = ${s}.`,
      `The first multiple of ${d} that is ${s} or more is ${s + x}, so the blank must add ${s + x} − ${s} = ${x}.`,
      `Check: ${base * 10 + x} ÷ ${d} = ${(base * 10 + x) / d}.`,
      `So the smallest digit is ${x}.`,
    ], 'For 3 and 9, add the digits and look for the nearest multiple.');
  }
  const a = pick([3, 4, 5, 6]), b = pick([4, 6, 7, 8, 9]); if (a === b) return null; const l = (a * b) / gcd(a, b), n = pick([100, 200, 300]), count = Math.floor(n / l);
  return explain(int('divisibility', `How many whole numbers from 1 to ${n} are divisible by both ${a} and ${b}?`, count), [
    `A number divisible by both ${a} and ${b} is a multiple of their lowest common multiple.`,
    `The lowest common multiple of ${a} and ${b} is ${l}.`,
    `Count the multiples of ${l} up to ${n}: ${n} ÷ ${l} = ${count} remainder ${n % l}.`,
    `So ${count} whole numbers are divisible by both ${a} and ${b}.`,
  ], '"Divisible by both" means count the multiples of the lowest common multiple.');
};
// ---- patterns ----
const patterns = (y) => {
  const kind = upper(y) ? ri(1, 3) : ri(1, 2);
  if (kind === 1) {
    const s = ri(1, 12), k = ri(2, upper(y) ? 9 : 5), n = upper(y) ? ri(15, 40) : ri(8, 12), v = s + (n - 1) * k;
    return explain(int('number patterns', `${[s, s + k, s + 2 * k, s + 3 * k].join(', ')}, … What is the ${ord(n)} number in this pattern?`, v), [
      `Look at the jumps: ${s + k} − ${s} = ${k}, so each number goes up by ${k}.`,
      `From the 1st number to the ${ord(n)} there are ${n} − 1 = ${n - 1} jumps.`,
      `${n - 1} jumps of ${k} make ${n - 1} × ${k} = ${(n - 1) * k}.`,
      `${s} + ${(n - 1) * k} = ${v}.`,
      `So the ${ord(n)} number is ${v}.`,
    ], 'Count the jumps, not the numbers: the 10th number is 9 jumps after the 1st.');
  }
  if (kind === 2) {
    const k = ri(2, 4), n = ri(5, upper(y) ? 12 : 8), v = k * n + 1;
    return explain(withFigure(int('number patterns', `Figure 1 uses ${k + 1} dots, Figure 2 uses ${2 * k + 1}, Figure 3 uses ${3 * k + 1}, and the pattern continues. How many dots does Figure ${n} use?`, v), table('Dots in each figure', ['Figure', 'Dots'], [[1, k + 1], [2, 2 * k + 1], [3, 3 * k + 1], [4, 4 * k + 1]])), [
      `Each new figure adds ${2 * k + 1} − ${k + 1} = ${k} dots.`,
      `Figure ${n} is ${n} − 1 = ${n - 1} steps after Figure 1: ${n - 1} × ${k} = ${(n - 1) * k} extra dots.`,
      `${k + 1} + ${(n - 1) * k} = ${v}.`,
      `So Figure ${n} uses ${v} dots.`,
    ], 'Find how many dots each new figure adds, then count the steps from Figure 1.');
  }
  const n = ri(6, 12);
  return explain(int('number patterns', `1, 4, 9, 16, 25, … What is the ${ord(n)} number in this pattern?`, n * n), [
    `These are the square numbers: 1 × 1 = 1, 2 × 2 = 4, 3 × 3 = 9, 4 × 4 = 16, 5 × 5 = 25.`,
    `The ${ord(n)} number is ${n} × ${n} = ${n * n}.`,
    `So the ${ord(n)} number is ${n * n}.`,
  ], '1, 4, 9, 16, 25, … are the square numbers: position × position.');
};
// ---- spatial visualisation ----
const spatial = (y) => {
  const kind = upper(y) ? ri(1, 3) : 1;
  if (kind === 1) {
    const n = upper(y) ? 3 : 2, h = {}, rowSums = []; let total = 0;
    for (let r = 0; r < n; r++) { let rs = 0; for (let c = 0; c < n; c++) { const k = ri(1, upper(y) ? 4 : 3); h[`${r},${c}`] = String(k); total += k; rs += k; } rowSums.push(rs); }
    return explain(withFigure(int('spatial visualisation', `Cubes are stacked in columns on a ${n} by ${n} board. The number in each square is the height of that column. How many cubes are there altogether?`, total), grid('Height of each column', n, n, h)), [
      ...rowSums.map((rs, r) => `Row ${r + 1}: ${Array.from({ length: n }, (_, c) => h[`${r},${c}`]).join(' + ')} = ${rs}.`),
      `All the rows: ${rowSums.join(' + ')} = ${total}.`,
      `So there are ${total} cubes altogether.`,
    ], 'Every number on the board is a column of cubes: add the numbers row by row.');
  }
  if (kind === 2) {
    const n = pick([3, 4, 5]), what = pick([['exactly two faces painted', 12 * (n - 2)], ['exactly one face painted', 6 * (n - 2) * (n - 2)], ['exactly three faces painted', 8], ['no face painted', (n - 2) ** 3], ['at least two faces painted', 8 + 12 * (n - 2)]]), m = n - 2;
    const how = {
      'exactly two faces painted': [`Cubes with exactly 2 painted faces sit along the edges, but not at the corners.`, `Each edge has ${n} − 2 = ${m} of them, and a cube has 12 edges.`, `12 × ${m} = ${12 * m}.`],
      'exactly one face painted': [`Cubes with exactly 1 painted face are in the middle of each face.`, `Each face has ${m} × ${m} = ${m * m} of them, and a cube has 6 faces.`, `6 × ${m * m} = ${6 * m * m}.`],
      'exactly three faces painted': [`Only a corner cube touches 3 painted faces.`, `A cube has 8 corners, whatever its size.`],
      'no face painted': [`The unpainted cubes are hidden inside, one layer in from every face.`, `That inner block is ${m} by ${m} by ${m}: ${m} × ${m} × ${m} = ${m ** 3}.`],
      'at least two faces painted': [`"At least two" means the corner cubes (3 faces) and the edge cubes (2 faces).`, `Corners: 8. Edge cubes: 12 edges × ${m} = ${12 * m}.`, `8 + ${12 * m} = ${8 + 12 * m}.`],
    }[what[0]];
    return explain(int('spatial visualisation', `A large cube is painted red all over, then cut into ${n * n * n} small cubes (${n} by ${n} by ${n}). How many small cubes have ${what[0]}?`, what[1]), [
      ...how, `So ${what[1]} small cubes have ${what[0]}.`,
    ], 'Corners have 3 painted faces, edge cubes 2, face middles 1, and the inside none.');
  }
  // each corner cube exposes three faces and takes three away
  const n = pick([3, 4, 5]);
  return explain(int('spatial visualisation', `A ${n} by ${n} by ${n} cube is built from ${n ** 3} unit cubes, and then the 8 corner cubes are removed. What is the surface area of the shape that is left, in square units?`, 6 * n * n), [
    `The full cube has 6 faces, each ${n} × ${n} = ${n * n} square units: 6 × ${n * n} = ${6 * n * n}.`,
    `Taking a corner cube away removes 3 squares of surface but uncovers 3 new ones inside.`,
    `So each corner changes the surface by 3 − 3 = 0, and 8 corners change nothing.`,
    `So the surface area is ${6 * n * n} square units.`,
  ], 'Removing a corner cube swaps 3 old faces for 3 new ones: the surface area stays the same.');
};
// ---- logic ----
const logic = (y) => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const w = names(3), pets = shuffle(['a cat', 'a dog', 'a fish']);
    return explain(mcOnly('logic', `${w[0]}, ${w[1]} and ${w[2]} each have one pet: ${pets.slice().sort().join(', ')}. ${w[0]} does not have ${pets[1]} or ${pets[2]}. ${w[1]} does not have ${pets[2]}. Who has ${pets[2]}?`, w[2], [w[0], w[1], 'Cannot be told', 'Nobody']), [
      `${w[0]} does not have ${pets[1]} or ${pets[2]}, so ${w[0]} has ${pets[0]}.`,
      `${w[1]} does not have ${pets[2]}, and ${pets[0]} is taken, so ${w[1]} has ${pets[1]}.`,
      `The only pet left is ${pets[2]}, and the only person left is ${w[2]}.`,
      `So ${w[2]} has ${pets[2]}.`,
    ], 'Start with the person you know most about, then cross out what is already taken.');
  }
  if (kind === 2) {
    const d = ri(0, 6), n = upper(y) ? ri(30, 100) : ri(8, 20), wk = Math.floor(n / 7), r = n % 7, day = DAYS[(d + n) % 7];
    return explain(mcOnly('logic', `Today is ${DAYS[d]}. What day of the week will it be in ${n} days?`, day, DAYS.filter((_, i) => i !== (d + n) % 7).slice(0, 4)), [
      `Every 7 days the same day of the week comes round again.`,
      `${n} ÷ 7 = ${wk} remainder ${r}: ${n} days is ${wk} full week${wk === 1 ? '' : 's'} and ${r} more day${r === 1 ? '' : 's'}.`,
      r ? `${r} day${r === 1 ? '' : 's'} after ${DAYS[d]} is ${day}.` : `Full weeks bring us back to ${DAYS[d]}.`,
      `So it will be ${day}.`,
    ], 'Whole weeks do not change the day: divide by 7 and only the remainder counts.');
  }
  const [a, b] = names(2), age = ri(6, 12), diff = ri(2, 6), yrs = ri(2, 8), total = 2 * age + diff + 2 * yrs;
  return explain(int('logic', `${a} is ${age} years old and ${b} is ${age + diff}. In ${yrs} years, what will their ages add up to?`, total), [
    `In ${yrs} years ${a} will be ${age} + ${yrs} = ${age + yrs}.`,
    `In ${yrs} years ${b} will be ${age + diff} + ${yrs} = ${age + diff + yrs}.`,
    `${age + yrs} + ${age + diff + yrs} = ${total}.`,
    `So their ages will add up to ${total}.`,
  ], 'Everyone gets older by the same number of years, so add those years to each person.');
};
// ---- arithmetic and statistics ----
const stats = (y) => {
  if (!upper(y)) {
    const xs = Array.from({ length: 5 }, () => ri(2, 12)); const kind = ri(1, 2);
    if (kind === 1) {
      const hi = Math.max(...xs), lo = Math.min(...xs);
      return explain(int('statistics', `Here are the numbers of goals five teams scored: ${xs.join(', ')}. What is the difference between the most and the fewest?`, hi - lo), [
        `The most is ${hi} and the fewest is ${lo}.`,
        `${hi} − ${lo} = ${hi - lo}.`,
        `So the difference is ${hi - lo}.`,
      ], 'Find the biggest and the smallest first, then subtract.');
    }
    const counts = {}; for (const x of xs) counts[x] = (counts[x] || 0) + 1; const top = Object.entries(counts).sort((p, q) => q[1] - p[1]); if (top.length > 1 && top[0][1] === top[1][1]) return null;
    const best = Number(top[0][0]), c = top[0][1], sorted = [...xs].sort((p, q) => p - q);
    return explain(int('statistics', `Five children scored these marks in a quiz: ${xs.join(', ')}. Which mark appears most often?`, best), [
      `Put the marks in order so that repeats sit together: ${sorted.join(', ')}.`,
      `${best} appears ${c} times; every other mark appears fewer times.`,
      `So the mark that appears most often is ${best}.`,
    ], 'Put the numbers in order first: the repeats stand next to each other.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const n = ri(4, 6), avg = ri(10, 40), xs = Array.from({ length: n - 1 }, () => ri(avg - 9, avg + 9)), last = n * avg - sum(xs); if (last < 1) return null;
    return explain(int('statistics', `The mean (average) of ${n} numbers is ${avg}. ${n - 1} of them are ${xs.join(', ')}. What is the remaining number?`, last), [
      `Mean × how many = total: ${avg} × ${n} = ${n * avg}.`,
      `The ${n - 1} known numbers add to ${xs.join(' + ')} = ${sum(xs)}.`,
      `${n * avg} − ${sum(xs)} = ${last}.`,
      `So the remaining number is ${last}.`,
    ], 'The mean times the count gives the total; then take away the numbers you know.');
  }
  if (kind === 2) {
    const xs = Array.from({ length: 5 }, () => ri(3, 40)).sort((p, q) => p - q);
    return explain(int('statistics', `Find the median of ${shuffle(xs).join(', ')}.`, xs[2]), [
      `Put the numbers in order: ${xs.join(', ')}.`,
      `The median is the middle one of the 5, the 3rd: ${xs[2]}.`,
      `So the median is ${xs[2]}.`,
    ], 'Median means middle, but only after the numbers are in order.');
  }
  const xs = Array.from({ length: 4 }, () => ri(5, 60)), t = sum(xs); if (t % 4 !== 0) return null;
  return explain(int('statistics', `What is the mean (average) of ${xs.join(', ')}?`, t / 4), [
    `Add them: ${xs.join(' + ')} = ${t}.`,
    `Share among the 4 numbers: ${t} ÷ 4 = ${t / 4}.`,
    `So the mean is ${t / 4}.`,
  ], 'Mean = total ÷ how many.');
};
// ---- geometry and mensuration ----
const geometry = (y) => {
  const kind = upper(y) ? ri(1, 4) : ri(1, 2);
  if (kind === 1) {
    const l = ri(3, upper(y) ? 30 : 12), w = ri(2, l - 1);
    return explain(int('geometry', `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter, in cm?`, 2 * (l + w)), [
      `The perimeter goes all the way round: 2 lengths and 2 widths.`,
      `${l} + ${w} = ${l + w}, and 2 × ${l + w} = ${2 * (l + w)}.`,
      `So the perimeter is ${2 * (l + w)} cm.`,
    ], 'Perimeter of a rectangle = 2 × (length + width).');
  }
  if (kind === 2) {
    const l = ri(3, upper(y) ? 25 : 10), w = ri(2, l - 1);
    return explain(int('geometry', `A rectangle is ${l} cm long and ${w} cm wide. What is its area, in cm²?`, l * w), [
      `Area of a rectangle = length × width.`,
      `${l} × ${w} = ${l * w}.`,
      `So the area is ${l * w} cm².`,
    ], 'Area is length × width; perimeter is the distance round the edge.');
  }
  if (kind === 3) {
    const L = ri(8, 20), W = ri(6, 15), l = ri(2, L - 3), w = ri(2, W - 3);
    return explain(int('geometry', `An L-shaped garden is a ${L} m by ${W} m rectangle with a ${l} m by ${w} m rectangle cut from one corner. What is its area, in m²?`, L * W - l * w), [
      `The whole rectangle: ${L} × ${W} = ${L * W} m².`,
      `The corner cut out: ${l} × ${w} = ${l * w} m².`,
      `${L * W} − ${l * w} = ${L * W - l * w}.`,
      `So the area is ${L * W - l * w} m².`,
    ], 'An L-shape is a big rectangle with a corner missing: big area minus the corner.');
  }
  const a = ri(25, 80), b = ri(20, 175 - a);
  return explain(int('geometry', `In a triangle, two of the angles are ${a}° and ${b}°. What is the third angle, in degrees?`, 180 - a - b), [
    `The 3 angles of a triangle add up to 180°.`,
    `${a} + ${b} = ${a + b}.`,
    `180 − ${a + b} = ${180 - a - b}.`,
    `So the third angle is ${180 - a - b}°.`,
  ], 'The angles in a triangle always add up to 180°.');
};
// ---- money, time and multi-step word problems ----
const money$ = (y) => {
  const kind = ri(1, 2), [w] = names(1);
  if (kind === 1) {
    const ad = pick([6, 8, 10, 12]), ch = pick([3, 4, 5]), na = ri(1, 3), nc = ri(1, 4), paid = pick([50, 60, 100]), cost = ad * na + ch * nc; if (cost >= paid) return null;
    return explain(int('word problems', `Tickets cost ${money(ad)} for an adult and ${money(ch)} for a child. ${w}'s family of ${na} adult${na > 1 ? 's' : ''} and ${nc} child${nc > 1 ? 'ren' : ''} pays with ${money(paid)}. How much change do they get (in dollars)?`, paid - cost), [
      `Adults: ${na} × $${ad} = $${na * ad}.`,
      `Children: ${nc} × $${ch} = $${nc * ch}.`,
      `Total cost: $${na * ad} + $${nc * ch} = $${cost}.`,
      `Change: $${paid} − $${cost} = $${paid - cost}.`,
      `So they get $${paid - cost} change.`,
    ], 'Work out the whole cost first; the change is what was paid minus the cost.');
  }
  const price = ri(2, upper(y) ? 15 : 8), n = ri(3, upper(y) ? 12 : 6), had = price * n + ri(1, 20), it = thing();
  return explain(int('word problems', `${w} has ${money(had)} and buys ${n} ${it}s at ${money(price)} each. How much money is left (in dollars)?`, had - price * n), [
    `${n} ${it}s at $${price} each: ${n} × ${price} = $${n * price}.`,
    `$${had} − $${n * price} = $${had - price * n}.`,
    `So ${w} has $${had - price * n} left.`,
  ], 'Cost = number × price; then take the cost away from what you had.');
};
const timeQ = () => {
  const h = ri(7, 11), m = pick([0, 15, 30, 45]), d = pick([45, 75, 90, 105, 120, 150]), start = h * 60 + m, e = start + d, wh = Math.floor(d / 60), mins = d % 60;
  const hm = (t) => { const hh = Math.floor(t / 60); return `${hh > 12 ? hh - 12 : hh}:${String(t % 60).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`; };
  const took = [wh ? `${wh} h` : '', mins ? `${mins} min` : ''].filter(Boolean).join(' ');
  return explain(mcOnly('time', `A class trip leaves school at ${hm(start)} and the bus ride takes ${took}. When does it arrive?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 60), hm(e - 30)]), [
    `Start at ${hm(start)}.`,
    wh ? `Add ${hrs(wh)}: ${hm(start + 60 * wh)}.` : '',
    mins ? `Add ${mins} minutes: ${hm(start + 60 * wh + mins)}.` : '',
    `So the trip arrives at ${hm(e)}.`,
  ], 'Add the whole hours first, then the minutes.');
};
const fractionQ = (y) => {
  if (!upper(y)) {
    const d = pick([2, 3, 4, 5]), n = d * ri(2, 8);
    return explain(int('fractions', `What is 1/${d} of ${n}?`, n / d), [
      `1/${d} of a number means share it into ${d} equal parts and take 1 part.`,
      `${n} ÷ ${d} = ${n / d}.`,
      `So 1/${d} of ${n} is ${n / d}.`,
    ], 'A unit fraction of a number is a division: 1/3 of something means ÷ 3.');
  }
  const d = pick([4, 5, 6, 8, 10]), n1 = ri(1, d - 1), n2 = ri(1, d - n1); if (n1 + n2 >= d || gcd(n1, d) !== 1 || gcd(n2, d) !== 1) return null;
  const left = d - n1 - n2, g = gcd(left, d), [w] = names(1);
  return explain(frac('fractions', `${w} ate ${n1}/${d} of a pizza and a friend ate ${n2}/${d}. What fraction of the pizza is left? Give it in its simplest form.`, left, d), [
    `Together they ate ${n1}/${d} + ${n2}/${d} = ${n1 + n2}/${d}.`,
    `The whole pizza is ${d}/${d}, so ${d}/${d} − ${n1 + n2}/${d} = ${left}/${d} is left.`,
    g > 1 ? `Simplify: divide the top and the bottom by ${g}: ${left / g}/${d / g}.` : `${left}/${d} is already in its simplest form.`,
    `So ${left / g}/${d / g} of the pizza is left.`,
  ], 'Same bottom numbers: add the tops, then take the answer away from the whole.');
};
const numberSense = (y) => {
  if (!upper(y)) {
    const lo = ri(1, 8) * 10, s = ri(3, 15); const cands = []; for (let n = lo + 1; n < lo + 10; n++) if (sum(digitsOf(n)) === s) cands.push(n); if (cands.length !== 1) return null;
    return explain(int('number sense', `A whole number is greater than ${lo} and less than ${lo + 10}. The sum of its two digits is ${s}. What is the number?`, cands[0]), [
      `The number is between ${lo} and ${lo + 10}, so its tens digit is ${lo / 10}.`,
      `The two digits add up to ${s}, so the ones digit is ${s} − ${lo / 10} = ${s - lo / 10}.`,
      `So the number is ${cands[0]}.`,
    ], 'Fix the tens digit first; the ones digit then has to make up the rest of the sum.');
  }
  const a = ri(2, 9), b = ri(2, 9), P = a * b, lo = Math.min(a, b), hi = Math.max(a, b), pairs = factorsOf(P).filter((f) => f * f <= P).map((f) => `${f} × ${P / f}`);
  return explain(int('number sense', `The product of two whole numbers is ${P} and their sum is ${a + b}. What is the larger of the two numbers?`, hi), [
    `List the pairs that multiply to ${P}: ${pairs.join(', ')}.`,
    `Only ${lo} × ${hi} has the right sum: ${lo} + ${hi} = ${a + b}.`,
    `So the larger number is ${hi}.`,
  ], 'Write out the factor pairs, then check which pair has the right sum.');
};

// ---- the paper's tiers (built 20 Sep 2026 from the source check): the staples of the Info Pack's worked examples ----
const pm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} pm`;
const elapsed = () => {
  const s = ri(1, 8) * 60 + pick([0, 15, 30, 45]), d = ri(7, 35) * 5, e = s + d;
  const m1 = s % 60 ? Math.min(60 - (s % 60), d) : 0, t1 = s + m1, k = Math.floor((e - t1) / 60), t2 = t1 + 60 * k, rest = e - t2, parts = [m1, 60 * k, rest].filter((x) => x > 0);
  return explain(int('elapsed time', `A film starts at ${pm(s)} and ends at ${pm(e)}. How many minutes long is it?`, d), [
    m1 ? `From ${pm(s)} to ${pm(t1)} is ${m1} minutes.` : '',
    k ? `From ${pm(t1)} to ${pm(t2)} is ${hrs(k)} = ${60 * k} minutes.` : '',
    rest ? `From ${pm(t2)} to ${pm(e)} is ${rest} minutes.` : '',
    parts.length > 1 ? `${parts.join(' + ')} = ${d}.` : '',
    `So the film is ${d} minutes long.`,
  ], 'Count up to the next full hour first, then the whole hours, then the minutes left over.');
};
const symbols = () => {
  const [s1, s2] = shuffle(['♥', '▲', '★', '●', '■']).slice(0, 2), a = ri(3, 15), b = ri(1, a - 1); if (a === b) return null;
  if (ri(1, 2) === 1) return explain(int('symbol equations', `${s1} + ${s1} + ${s2} = ${2 * a + b} and ${s1} + ${s2} = ${a + b}. Each symbol stands for one number. What number is ${s1}?`, a), [
    `The first sum has one more ${s1} than the second sum, and nothing else is different.`,
    `So that extra ${s1} is the difference: ${2 * a + b} − ${a + b} = ${a}.`,
    `Check: ${s2} = ${a + b} − ${a} = ${b}, and ${a} + ${a} + ${b} = ${2 * a + b}.`,
    `So ${s1} = ${a}.`,
  ], 'When two sums differ by one symbol, subtract them: the difference is that symbol.');
  return explain(int('symbol equations', `${s1} + ${s2} = ${a + b} and ${s1} − ${s2} = ${a - b}. Each symbol stands for one number. What number is ${s1}?`, a), [
    `${s1} + ${s2} = ${a + b} and ${s1} − ${s2} = ${a - b}, so ${s1} is the bigger number.`,
    `Add the total and the difference: ${a + b} + ${a - b} = ${2 * a}. That is two ${s1}s.`,
    `${s1} = ${2 * a} ÷ 2 = ${a}.`,
    `Check: ${s2} = ${a + b} − ${a} = ${b}, and ${a} − ${b} = ${a - b}.`,
    `So ${s1} = ${a}.`,
  ], 'Bigger number = (sum + difference) ÷ 2; smaller number = (sum − difference) ÷ 2.');
};
const commonMult = () => {
  const [p, q] = pick([[5, 7], [4, 6], [6, 8], [3, 8], [4, 9], [5, 6], [6, 9], [7, 8]]), l = (p * q) / gcd(p, q), N = l + ri(1, l - 1), [w] = names(1);
  const mult = (k) => Array.from({ length: l / k }, (_, i) => (i + 1) * k).join(', ');
  return explain(int('common multiples', `${w} has fewer than ${N} stickers. They can be put into packs of ${p} with none left over, and into packs of ${q} with none left over. How many stickers are there?`, l), [
    `The number must be a multiple of ${p} and a multiple of ${q}.`,
    `Multiples of ${p}: ${mult(p)}. Multiples of ${q}: ${mult(q)}.`,
    `The first number in both lists is ${l}. The next would be ${2 * l}, which is not fewer than ${N}.`,
    `So there are ${l} stickers.`,
  ], 'Packs of two sizes with none left over: list the multiples of each and find the first one they share.');
};
const sums = (y) => {
  if (!upper(y) || ri(1, 2) === 1) {
    const n = upper(y) ? ri(10, 20) : ri(5, 10), top = 2 * n - 1;
    return explain(int('sums', `Sticks of lengths 1 cm, 3 cm, 5 cm, … up to ${top} cm are joined end to end in a line. How long is the whole line, in cm?`, n * n), [
      `The odd numbers from 1 to ${top}: there are ${n} sticks.`,
      `Pair the ends: 1 + ${top} = ${2 * n}, 3 + ${top - 2} = ${2 * n}, … every pair makes ${2 * n}.`,
      n % 2 === 0 ? `${n} sticks make ${n / 2} pairs: ${n / 2} × ${2 * n} = ${n * n}.` : `${n} sticks make ${(n - 1) / 2} pairs and leave the middle stick, ${n} cm: ${(n - 1) / 2} × ${2 * n} + ${n} = ${n * n}.`,
      `That is ${n} × ${n}: the first ${n} odd numbers always add up to ${n} × ${n}.`,
      `So the line is ${n * n} cm long.`,
    ], 'The first n odd numbers add up to n × n: 1 + 3 + 5 + 7 = 16 = 4 × 4.');
  }
  const n = pick([20, 30, 40, 50, 60, 100]), t = (n * (n + 1)) / 2;
  return explain(int('sums', `What is 1 + 2 + 3 + … + ${n}?`, t), [
    `Pair the ends: 1 + ${n} = ${n + 1}, 2 + ${n - 1} = ${n + 1}, 3 + ${n - 2} = ${n + 1}, …`,
    `There are ${n} ÷ 2 = ${n / 2} pairs, each making ${n + 1}.`,
    `${n / 2} × ${n + 1} = ${t}.`,
    `So 1 + 2 + 3 + … + ${n} = ${t}.`,
  ], 'Pair the first number with the last: every pair has the same sum.');
};
const sumSquares = (y) => {
  const n = upper(y) ? ri(5, 8) : ri(4, 6), sq = Array.from({ length: n }, (_, i) => (i + 1) * (i + 1)), total = (n * (n + 1) * (2 * n + 1)) / 6;
  return explain(int('sum of squares', `Boxes are filled in a pattern: 1 apple in the first box, 4 in the second, 9 in the third, 16 in the fourth, and so on. How many apples are in the first ${n} boxes altogether?`, total), [
    `The boxes hold the square numbers: 1 × 1, 2 × 2, 3 × 3, … up to ${n} × ${n} = ${n * n}.`,
    `Write them out: ${sq.join(', ')}.`,
    `Add them: ${sq.join(' + ')} = ${total}.`,
    `So there are ${total} apples in the first ${n} boxes.`,
  ], 'Each box is a square number: write them all out, then add carefully.');
};
const rate = () => {
  const c1 = pick([2, 3, 4, 5]), t1 = pick([2, 3, 4, 5]), b1 = pick([2, 3, 4, 5, 6]), m = ri(2, 4), p = ri(2, 4), it = pick(['paper boats', 'paper cranes', 'sandwiches']);
  return explain(int('rate', `${c1} children make ${b1} ${it} in ${t1} minutes, all working at the same pace. How many ${it} do ${c1 * m} children make in ${t1 * p} minutes?`, b1 * m * p), [
    `${c1 * m} children are ${m} times as many as ${c1}, so in ${t1} minutes they make ${m} × ${b1} = ${m * b1} ${it}.`,
    `${t1 * p} minutes is ${p} times as long as ${t1} minutes, so they make ${p} × ${m * b1} = ${b1 * m * p} ${it}.`,
    `So ${c1 * m} children make ${b1 * m * p} ${it} in ${t1 * p} minutes.`,
  ], 'Change one thing at a time: first the number of workers, then the time.');
};
const wages = () => {
  const base = ri(5, 20) * 10, r = ri(6, 15), h1 = pick([20, 24, 25, 30]), h2 = h1 + pick([10, 16, 20]), h3 = h1 + pick([4, 5, 6, 8]), e1 = base + r * h1, e2 = base + r * h2, e3 = base + r * h3;
  return explain(int('wages', `A job pays a fixed amount plus the same amount for every hour worked. Working ${h1} hours earns ${money(e1)} and working ${h2} hours earns ${money(e2)}. How much does working ${h3} hours earn, in dollars?`, e3), [
    `The extra ${h2} − ${h1} = ${h2 - h1} hours earn the extra $${e2} − $${e1} = $${e2 - e1}.`,
    `So 1 hour pays $${e2 - e1} ÷ ${h2 - h1} = $${r}.`,
    `The fixed amount: $${e1} − ${h1} × $${r} = $${e1} − $${r * h1} = $${base}.`,
    `${h3} hours: $${base} + ${h3} × $${r} = $${base} + $${r * h3} = $${e3}.`,
    `So working ${h3} hours earns $${e3}.`,
  ], 'Compare the two jobs: the difference in pay comes only from the difference in hours.');
};
const fracRemainder = () => {
  const d = pick([3, 4, 5, 6, 8, 10]), n = ri(1, d - 1), u = ri(5, 60); if (gcd(n, d) !== 1) return null;
  return explain(int('fraction of a remainder', `After reading ${n}/${d} of a book, ${(d - n) * u} pages are left. How many pages does the book have?`, d * u), [
    `Cut the book into ${d} equal units: ${n === 1 ? '1 unit' : `${n} units`} read, ${d} − ${n} = ${un(d - n)} left.`,
    bar('Book', d, `${n} read, ${d - n} left = ${(d - n) * u} pages`),
    d - n === 1 ? `The 1 unit left is ${(d - n) * u} pages, so 1 unit = ${u} pages.` : `${un(d - n)} = ${(d - n) * u} pages, so 1 unit = ${(d - n) * u} ÷ ${d - n} = ${u} pages.`,
    `The whole book is ${d} units: ${d} × ${u} = ${d * u}.`,
    `So the book has ${d * u} pages.`,
  ], 'The pages left are the units not yet read: find 1 unit, then the whole.');
};
const marbleFractions = () => {
  const [d1, d2] = pick([[5, 2], [3, 4], [4, 6], [5, 4], [3, 5], [8, 4]]), n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1), L = (d1 * d2) / gcd(d1, d2), r = L - (n1 * L) / d1 - (n2 * L) / d2; if (r <= 0 || gcd(n1, d1) !== 1 || gcd(n2, d2) !== 1) return null;
  const u = ri(1, 6), [c1, c2, c3] = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 3), a1 = (n1 * L) / d1, a2 = (n2 * L) / d2;
  return explain(int('fractions of a whole', `In a bag of marbles, ${n1}/${d1} are ${c1}, ${n2}/${d2} are ${c2} and the remaining ${r * u} are ${c3}. How many marbles are ${c1}?`, a1 * u), [
    `Cut the bag into ${L} equal units, because ${L} is a multiple of both ${d1} and ${d2}.`,
    `${cap(c1)}: ${n1}/${d1} of ${L} units = ${a1} units. ${cap(c2)}: ${n2}/${d2} of ${L} units = ${a2} units.`,
    `${cap(c3)}: ${L} − ${a1} − ${a2} = ${un(r)}, and that is ${r * u} marbles, so 1 unit = ${r * u} ÷ ${r} = ${u}.`,
    `${cap(c1)} marbles: ${a1} × ${u} = ${a1 * u}.`,
    `So ${a1 * u} marbles are ${c1}.`,
  ], 'Two fractions with different bottoms: choose a number of units that both can share.');
};
const ratioTransfer = () => {
  const a = ri(1, 6), b = ri(a + 1, 9), u = ri(2, 20) * 2; if (gcd(a, b) !== 1) return null; const g = ((b - a) * u) / 2, [p, q] = names(2);
  return explain(int('ratio with a transfer', `${p} and ${q} have money in the ratio ${a} : ${b}. After ${q} gives ${p} ${money(g)}, they have the same amount. How much do they have altogether, in dollars?`, (a + b) * u), [
    bar(p, a),
    bar(q, b),
    `${q} has ${b} − ${a} = ${un(b - a)} more than ${p}.`,
    `Giving $${g} makes them equal, so $${g} is half of the difference: the difference is 2 × ${g} = $${2 * g}.`,
    b - a === 1 ? `That difference is exactly 1 unit, so 1 unit = $${u}.` : `${un(b - a)} = $${2 * g}, so 1 unit = ${2 * g} ÷ ${b - a} = $${u}.`,
    `Altogether ${a} + ${b} = ${a + b} units: ${a + b} × ${u} = ${(a + b) * u}.`,
    `So they have $${(a + b) * u} altogether.`,
  ], 'A gift that makes two people equal is half of the difference between them.');
};
const factorCount = () => {
  if (ri(1, 2) === 1) {
    const k = ri(3, 6), N = (10 ** k).toLocaleString('en-US');
    return explain(int('factor count', `How many factors does ${N} have, 1 and the number itself included?`, (k + 1) * (k + 1)), [
      `${N} is ${k} tens multiplied together, and each 10 = 2 × 5, so it is made of ${k} twos and ${k} fives.`,
      `A factor takes some of the twos: none, 1, 2, … up to ${k}, which is ${k + 1} choices. The fives give ${k + 1} choices too.`,
      `${k + 1} × ${k + 1} = ${(k + 1) * (k + 1)}.`,
      `So ${N} has ${(k + 1) * (k + 1)} factors.`,
    ], 'Break the number into primes, then multiply (each power + 1).');
  }
  const a = ri(1, 4), b = ri(1, 3), N = 2 ** a * 3 ** b, fs = factorsOf(N);
  return explain(int('factor count', `How many factors does ${N} have, 1 and the number itself included?`, (a + 1) * (b + 1)), [
    `${N} = ${[...Array(a).fill(2), ...Array(b).fill(3)].join(' × ')}.`,
    `List the factors: ${fs.join(', ')}.`,
    `Shortcut: a factor takes none to ${a} twos (${a + 1} ways) and none to ${b} threes (${b + 1} ways): ${a + 1} × ${b + 1} = ${(a + 1) * (b + 1)}.`,
    `So ${N} has ${(a + 1) * (b + 1)} factors.`,
  ], 'Break the number into primes, then multiply (each power + 1).');
};
const digitArrange = () => {
  const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3).sort((p, q) => p - q), big = ds[2] * 100 + ds[1] * 10 + ds[0], small = ds[0] * 100 + ds[1] * 10 + ds[2];
  return explain(int('digit arrangements', `Using each of the digits ${shuffle(ds).join(', ')} exactly once, the largest three-digit number and the smallest three-digit number are made. What is the difference between them?`, big - small), [
    `Largest: the biggest digit first, then the next: ${big}.`,
    `Smallest: the smallest digit first, then the next: ${small}.`,
    `${big} − ${small} = ${big - small}.`,
    `So the difference is ${big - small}.`,
  ], 'Biggest number: digits from largest to smallest. Smallest number: the other way round.');
};
const adjacentSums = () => {
  const a = ri(1, 9), b = ri(1, 9), c = ri(0, 9), n = ri(10, 40), row = [a, b, c], t = a + b + c, pos = n % 3 === 0 ? 3 : n % 3;
  return explain(int('adjacent sums', `In a long row of digits, any three digits next to each other add up to ${t}. The first two digits are ${a} and ${b}. What is the ${ord(n)} digit in the row?`, row[(n - 1) % 3]), [
    `The 3rd digit: ${t} − ${a} − ${b} = ${c}.`,
    `The 4th digit: ${t} − ${b} − ${c} = ${a}, the same as the 1st. So the row repeats: ${a}, ${b}, ${c}, ${a}, ${b}, ${c}, …`,
    `${n} ÷ 3 = ${Math.floor(n / 3)} remainder ${n % 3}, so the ${ord(n)} digit is the same as the ${ord(pos)} digit.`,
    `So the ${ord(n)} digit is ${row[(n - 1) % 3]}.`,
  ], 'When every 3 neighbours add up to the same total, the digits repeat every 3 places.');
};
const gridSteps = () => {
  const x1 = ri(0, 6), y1 = ri(0, 6), x2 = ri(0, 12), y2 = ri(0, 12), dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1), d = dx + dy; if (d < 3) return null;
  return explain(int('grid steps', `A robot on a grid moves one square at a time — up, down, left or right. What is the fewest moves it needs to go from square (${x1}, ${y1}) to square (${x2}, ${y2})?`, d), [
    `Across: from ${x1} to ${x2} is ${dx} moves.`,
    `Up or down: from ${y1} to ${y2} is ${dy} moves.`,
    `${dx} + ${dy} = ${d}.`,
    `So the fewest moves is ${d}.`,
  ], 'No diagonal moves: count the across moves and the up-and-down moves separately, then add.');
};
const squareRects = () => {
  const s = pick([8, 12, 16, 20, 24]), per = (5 * s) / 2;
  return explain(int('square into rectangles', `A square is cut into 4 identical rectangles by lines parallel to one of its sides. Each rectangle has a perimeter of ${per} cm. What is the area of the square, in cm²?`, s * s), [
    `Each rectangle is as long as the square's side and a quarter as wide.`,
    `Call the short side 1 unit: the long side is 4 units, so the perimeter is 4 + 1 + 4 + 1 = 10 units.`,
    `10 units = ${per} cm, so 1 unit = ${per} ÷ 10 = ${s / 4} cm.`,
    `The square's side is 4 units = ${s} cm, so its area is ${s} × ${s} = ${s * s}.`,
    `So the area is ${s * s} cm².`,
  ], 'Cut a square into 4 strips: each strip is 4 units by 1 unit, so its perimeter is 10 units.');
};
const meanCount = () => {
  const n = pick([200, 300, 400, 500, 600]), mean = pick([1.5, 2.4, 2.5, 3.2, 4.5]), median = pick([1.2, 1.5, 2, 2.5]); if (median >= mean) return null;
  const whole = Math.floor(mean), part = Math.round((mean - whole) * 100) / 100, total = Math.round(n * mean);
  return explain(int('mean and count', `${n} cards were sold at a fair. The mean price of a card was $${mean.toFixed(2)} and the median price was $${median.toFixed(2)}. How much money was taken altogether, in dollars?`, total), [
    `Money taken = mean price × number of cards. The median is not needed.`,
    `${n} × ${whole} = ${n * whole}, and ${n} × ${part.toFixed(2)} = ${Math.round(n * part)}.`,
    `${n * whole} + ${Math.round(n * part)} = ${total}.`,
    `So $${total} was taken altogether.`,
  ], 'Mean × count = total. An extra fact like the median is there to distract you.');
};
const avgSpeed = () => {
  const [v1, v2] = pick([[30, 60], [40, 60], [60, 30], [60, 40], [20, 60], [60, 20], [30, 20], [20, 30], [12, 6], [6, 12]]), d = pick([60, 120, 180, 240]), avg = (2 * d) / (d / v1 + d / v2); if (!Number.isInteger(avg) || !Number.isInteger(d / v1) || !Number.isInteger(d / v2)) return null;
  const t = d / v1 + d / v2;
  return explain(int('average speed', `A bus drives ${d} km from one town to another at ${v1} km/h and comes straight back the same way at ${v2} km/h. What is its average speed for the whole trip, in km/h?`, avg), [
    `Going: ${d} ÷ ${v1} = ${hrs(d / v1)}. Coming back: ${d} ÷ ${v2} = ${hrs(d / v2)}.`,
    `Whole trip: ${d} + ${d} = ${2 * d} km in ${d / v1} + ${d / v2} = ${hrs(t)}.`,
    `Average speed = total distance ÷ total time = ${2 * d} ÷ ${t} = ${avg}.`,
    `So the average speed is ${avg} km/h.`,
  ], 'Average speed is total distance ÷ total time, never the average of the two speeds.');
};
const halving = () => {
  const k = ri(2, 5), left = Array.from({ length: k }, (_, i) => `1/${2 ** (i + 1)}`);
  return explain(frac('halving', `A spray kills half of the germs on a surface each time it is used. After ${k} uses, what fraction of the germs has been killed? Give a fraction in its simplest form.`, 2 ** k - 1, 2 ** k), [
    `Each use halves what is left, so track the germs left: ${left.join(', then ')}.`,
    `After ${k} uses, 1/${2 ** k} of the germs are left.`,
    `Killed: 1 − 1/${2 ** k} = ${2 ** k - 1}/${2 ** k}.`,
    `So ${2 ** k - 1}/${2 ** k} of the germs has been killed.`,
  ], 'Track what is left (it halves each time), then take it away from 1.');
};
const compositePerimeter = () => {
  const L = ri(8, 20), W = ri(5, L - 1), l = ri(2, L - 3), w = ri(2, W - 3);
  return explain(int('composite figures', `An L-shaped figure is made by cutting a ${l} cm by ${w} cm rectangle from one corner of a ${L} cm by ${W} cm rectangle. What is the perimeter of the L-shaped figure, in cm?`, 2 * (L + W)), [
    `Cutting a corner out does not change the perimeter: the 2 new edges are just the 2 removed edges moved inwards.`,
    `So the L-shape has the same perimeter as the whole ${L} cm by ${W} cm rectangle.`,
    `2 × (${L} + ${W}) = 2 × ${L + W} = ${2 * (L + W)}.`,
    `So the perimeter is ${2 * (L + W)} cm.`,
  ], 'Push the inner sides of an L-shape outwards: its perimeter equals the full rectangle\'s.');
};

// ---- the three-mark staples the low band lacked (20 Sep 2026): a picture graph, a table, and a price for several ----
const pictureGraph = () => {
  const it = thing(), w = names(4), scale = pick([2, 3, 5]), vals = w.map(() => ri(1, 6)); if (new Set(vals).size < 4) return null;
  const fig = table(`${cap(it)}s each child has`, ['Name', cap(`${it}s`)], w.map((nm, i) => [nm, '⭐'.repeat(vals[i])]));
  const [i, j] = shuffle([0, 1, 2, 3]).slice(0, 2), [hi, lo] = vals[i] > vals[j] ? [i, j] : [j, i];
  if (ri(1, 2) === 1) return explain(withFigure(int('picture graph', `The picture graph shows the ${it}s of four children. Each ⭐ stands for ${scale} ${it}s. How many ${it}s does ${w[i]} have?`, vals[i] * scale), fig), [
    `Count ${w[i]}'s stars: ${vals[i]}.`,
    `Each star is ${scale} ${it}s: ${vals[i]} × ${scale} = ${vals[i] * scale}.`,
    `So ${w[i]} has ${vals[i] * scale} ${it}s.`,
  ], 'Count the pictures, then multiply by what each picture stands for.');
  return explain(withFigure(int('picture graph', `The picture graph shows the ${it}s of four children. Each ⭐ stands for ${scale} ${it}s. How many more ${it}s does ${w[hi]} have than ${w[lo]}?`, (vals[hi] - vals[lo]) * scale), fig), [
    `${w[hi]} has ${vals[hi]} star${vals[hi] === 1 ? '' : 's'} and ${w[lo]} has ${vals[lo]} star${vals[lo] === 1 ? '' : 's'}.`,
    bar(w[hi], vals[hi]),
    bar(w[lo], vals[lo], `${vals[hi] - vals[lo]} fewer`),
    `${w[hi]} has ${vals[hi]} − ${vals[lo]} = ${vals[hi] - vals[lo]} more star${vals[hi] - vals[lo] === 1 ? '' : 's'}, and each star is ${scale} ${it}s.`,
    `${vals[hi] - vals[lo]} × ${scale} = ${(vals[hi] - vals[lo]) * scale}.`,
    `So ${w[hi]} has ${(vals[hi] - vals[lo]) * scale} more ${it}s than ${w[lo]}.`,
  ], '"How many more" is a subtraction; with a picture graph, remember what each picture is worth.');
};
const tableRead = () => {
  const item = pick(['cakes', 'ice creams', 'buns', 'muffins', 'juices']), days = DAYS.slice(0, 4), vals = days.map(() => ri(5, 40));
  const fig = table(`${cap(item)} sold each day`, ['Day', 'Sold'], days.map((d, i) => [d, vals[i]]));
  const [i, j] = shuffle([0, 1, 2, 3]).slice(0, 2);
  if (ri(1, 2) === 1) return explain(withFigure(int('reading a table', `The table shows how many ${item} a shop sold on four days. How many ${item} were sold on ${days[i]} and ${days[j]} together?`, vals[i] + vals[j]), fig), [
    `Find the two rows: ${days[i]} ${vals[i]}, ${days[j]} ${vals[j]}.`,
    `${vals[i]} + ${vals[j]} = ${vals[i] + vals[j]}.`,
    `So ${vals[i] + vals[j]} ${item} were sold on ${days[i]} and ${days[j]} together.`,
  ], 'Pick out only the rows the question asks about, then add.');
  if (vals[i] === vals[j]) return null; const [hi, lo] = vals[i] > vals[j] ? [i, j] : [j, i], diff = vals[hi] - vals[lo];
  return explain(withFigure(int('reading a table', `The table shows how many ${item} a shop sold on four days. How many more ${item} were sold on ${days[hi]} than on ${days[lo]}?`, diff), fig), [
    `Find the two rows: ${days[hi]} ${vals[hi]}, ${days[lo]} ${vals[lo]}.`,
    `"How many more" means the difference: ${vals[hi]} − ${vals[lo]} = ${diff}.`,
    `So ${diff} more ${item} were sold on ${days[hi]} than on ${days[lo]}.`,
  ], '"How many more" is a subtraction: the bigger number minus the smaller.');
};
const unitPrice = (y) => {
  const it = thing(), u = ri(2, upper(y) ? 15 : 9), k = ri(2, upper(y) ? 8 : 5), m = ri(k + 1, upper(y) ? 20 : 10), p = u * k;
  if (ri(1, 2) === 1) return explain(int('unit price', `${k} ${it}s cost ${money(p)}. How much do ${m} ${it}s cost, in dollars?`, u * m), [
    `First find the price of 1 ${it}: $${p} ÷ ${k} = $${u}.`,
    `${m} ${it}s cost ${m} × $${u} = $${u * m}.`,
    `So ${m} ${it}s cost $${u * m}.`,
  ], 'Find the price of 1 first, then multiply.');
  return explain(int('unit price', `${k} ${it}s cost ${money(p)}. How many ${it}s can be bought with ${money(u * m)}?`, m), [
    `First find the price of 1 ${it}: $${p} ÷ ${k} = $${u}.`,
    `$${u * m} ÷ $${u} = ${m}.`,
    `So ${m} ${it}s can be bought with $${u * m}.`,
  ], 'Find the price of 1 first, then divide.');
};

// each kind with the tiers it may fill: Grades 2–4, then Grades 5–6 (an empty list keeps a kind out of that band)
const P = (cat, gen, low, up = low) => ({ cat, gen, low, up });
const POOL = [
  P('model method', model, ['M3', 'M5']), P('equal after giving', equalAfter, ['M5']), P('cryptarithm', crypt, ['M3', 'M5']), P('divisibility', divisibility, ['M3', 'M5']), P('number patterns', patterns, ['M3', 'M5']), P('spatial visualisation', spatial, ['M3', 'M5'], ['M5', 'M6']), P('logic', logic, ['M3', 'M5']), P('statistics', stats, ['M3', 'M5'], ['M5', 'M6']), P('geometry', geometry, ['M3', 'M5']), P('money', money$, ['M3', 'M5']), P('time', timeQ, ['M3']), P('fractions', fractionQ, ['M3'], ['M5']), P('number sense', numberSense, ['M3', 'M5']),
  P('elapsed time', elapsed, ['M3', 'M5'], ['M3']), P('symbol equations', symbols, ['M3', 'M5'], ['M3']), P('common multiples', commonMult, ['M5'], ['M3', 'M5']), P('sums', sums, ['M5', 'M6'], ['M3', 'M5']), P('sum of squares', sumSquares, ['M6'], ['M5', 'M6']), P('rate', rate, ['M5', 'M6'], ['M3', 'M5']), P('wages', wages, ['M6'], ['M5', 'M6']), P('fraction of a remainder', fracRemainder, ['M5'], ['M3', 'M5']), P('fractions of a whole', marbleFractions, [], ['M5', 'M6']), P('ratio with a transfer', ratioTransfer, [], ['M5', 'M6']), P('factor count', factorCount, [], ['M6']), P('digit arrangements', digitArrange, ['M5'], ['M3', 'M5']), P('adjacent sums', adjacentSums, [], ['M5', 'M6']), P('grid steps', gridSteps, ['M5'], ['M3']), P('square into rectangles', squareRects, ['M6'], ['M5', 'M6']), P('mean and count', meanCount, [], ['M6']), P('average speed', avgSpeed, [], ['M6']), P('halving', halving, [], ['M5', 'M6']), P('composite figures', compositePerimeter, ['M5'], ['M3']),
  P('picture graph', pictureGraph, ['M3'], []), P('reading a table', tableRead, ['M3'], []), P('unit price', unitPrice, ['M3'], ['M3']),
];
const pool = (y) => POOL.map((e) => ({ cat: e.cat, gen: e.gen, sections: upper(y) ? e.up : e.low })).filter((e) => e.sections.length);
// the real paper (SIU's AMO InfoPack): 25 questions in 90 minutes — fifteen 3-mark multiple choice of five options, then five
// 5-mark and five 6-mark open answers, typed. The 90 minutes are ours to split: 40 + 25 + 25 (the owner, 20 Sep 2026)
export const PHASES = [phase('alpha', 'Questions 1–15', 3, 40, slots([['M3', 'mc', 15]])), phase('beta', 'Questions 16–20', 5, 25, slots([['M5', 'sa', 5]])), phase('gamma', 'Questions 21–25', 6, 25, slots([['M6', 'sa', 5]]))];
export const build = (shape, year) => buildHeat(shape, pool(Math.max(2, year)), Math.max(2, year), { options: 5 });
export const TOPICS = [
  { band: 'Grades 2–4', lines: ['3 marks: the model method, cryptarithms, divisibility, patterns, elapsed time, symbol equations, picture graphs and tables, unit prices', '5 marks, typed: equal after giving, common multiples, fractions of a remainder, digit arrangements, grid steps', '6 marks, typed: sticks in a line, apples in boxes, children making boats, wages with a fixed part', 'five options, no “None of the above”; from Year 2, as the real paper'] },
  { band: 'Grades 5–6', lines: ['3 marks: fractions of a remainder, rates, sums, digit arrangements, L-shaped perimeters', '5 marks, typed: marbles by fractions, a ratio with a transfer, adjacent sums, painted cubes, a spray that halves the germs', '6 marks, typed: the factors of a million, mean times count, average speed there and back', 'squares cut into rectangles, wages with a fixed part, apples in boxes'] },
];
