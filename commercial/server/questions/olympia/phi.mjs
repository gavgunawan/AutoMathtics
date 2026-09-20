// 🌴 PHI-MOON — practice modelled on PhIMO (the Philippine International Mathematical Olympiad, Math Olympiads Training League);
// not affiliated. Its own family, not OCEC's: the Philippine K-12 strands — Number and Number Sense, Geometry, Pattern and
// Algebra, Measurements, Statistics and Probability — at every grade, in a paper that ramps from ten multiple-choice questions
// of five options with "None of the above" (2 marks) through ten short answers (3) to five hard ones (5): the 2025 heat papers,
// 25 questions in 90 minutes, no calculator, no penalty (the source check of 20 Sep 2026). So a heat is five two-mark multiple
// choice — one from each strand — then three three-mark and two five-mark typed answers drawn across the strands, every strand
// carrying a kind for each tier; the kinds are the staples of the 2025 papers and the Malaysian mock: tiling and stacked cubes,
// rule machines and symbol equations, remainders and LCM, frogs in wells, pie charts, pigeonholes, two dice (20 Sep 2026).
// Every seed carries its worked solution in the child's method (STEPS.md, 20 Sep 2026), and every tier at every band offers at
// least three seed families, so a section never has to repeat one.
import { ri, pick, shuffle, sum, names, thing, int, dec, frac, mcOnly, withFigure, grid, table, bars, buildHeat, slots, phase, explain, bar, gcd, lcm, cap, factorsOf, isPrime, digitsOf, ord } from './common.mjs';

const low = (y) => y <= 2, mid = (y) => y >= 3 && y <= 4;
// four things of very different lengths, from a window of a long table (shortest first), so the longest and the shortest of the four
// are not the same two things every time (kept for any moon that still wants it)
export const LENGTHS = [['an ant', 0.5], ['a paper clip', 3], ['an eraser', 4], ['a pencil', 15], ['a ruler', 30], ['a chair', 90], ['a door', 200], ['a car', 400], ['a bus', 1200], ['a football field', 10000]];
export const lengthWindow = () => { const lo = ri(0, LENGTHS.length - 4); return shuffle(LENGTHS.slice(lo, lo + 4)); };
const pie = (title, pairs) => ({ kind: 'pie', title, slices: pairs.map(([label, pct]) => ({ label, pct })) });
const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
const hm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const KIDS = ['Ana', 'Ben', 'Carlo', 'Dina', 'Elsa'];
const bagOf = (cs, counts, it) => `${cs.map((c, i) => `${counts[i]} ${c}`).join(', ').replace(/, (\d+ \w+)$/, ' and $1')} ${it}`;
// for the steps: a fraction in lowest terms, a list of multiples, a count of minutes said in hours and minutes
const fr = (n, d) => { const g = gcd(n, d); return `${n / g}/${d / g}`; };
const multiples = (k, upTo) => Array.from({ length: Math.floor(upTo / k) }, (_, i) => k * (i + 1)).join(', ');
const hmin = (m) => (m >= 60 ? `${Math.floor(m / 60)} hour${Math.floor(m / 60) > 1 ? 's' : ''}${m % 60 ? ` and ${m % 60} minutes` : ''}` : `${m} minutes`);
// the lines that count the minutes from clock time s to clock time e (minutes past midnight), to the next full hour first
const between = (s, e, fmt = hm) => { const nh = s % 60 ? s + 60 - (s % 60) : s; if (nh === s || nh >= e) return [`From ${fmt(s)} to ${fmt(e)} is ${hmin(e - s)}${e - s >= 60 ? ` = ${e - s} minutes` : ''}.`]; return [`From ${fmt(s)} to ${fmt(nh)} is ${nh - s} minutes.`, `From ${fmt(nh)} to ${fmt(e)} is ${hmin(e - nh)}${e - nh >= 60 ? ` = ${e - nh} minutes` : ''}.`, `${nh - s} + ${e - nh} = ${e - s}.`]; };

// ---- Number and Number Sense ----
const nsP1 = (y) => {
  const kind = ri(1, 3);
  if (low(y)) {
    if (kind === 1) {
      const a = ri(6, 40), d = ri(2, 15);
      return explain(int('number sense · more than', `There are ${a} red balloons, and ${d} more blue balloons than red ones. How many balloons are there altogether?`, 2 * a + d), [
        bar('Red', 4, `${a}`), bar('Blue', 5, `${a} + ${d}`),
        `Blue: ${a} + ${d} = ${a + d}.`,
        `Altogether: ${a} + ${a + d} = ${2 * a + d}.`,
        `So there are ${2 * a + d} balloons altogether.`,
      ], '"More than" tells you the second number; find it first, then add the two.');
    }
    if (kind === 2) {
      const m = pick([5, 6, 7, 8, 9]), r = ri(1, m - 1); let n = 99; while (n % m !== r) n--; const q = (n - r) / m;
      return explain(int('number sense · remainders', `What is the largest two-digit number that leaves a remainder of ${r} when divided by ${m}?`, n), [
        `A number that leaves remainder ${r} is ${r} more than a multiple of ${m}.`,
        `Take ${r} from 99: ${99 - r}. The largest multiple of ${m} up to ${99 - r} is ${m} × ${q} = ${m * q}.`,
        `Add the remainder back: ${m * q} + ${r} = ${n}.`,
        `Check: ${n} ÷ ${m} = ${q} remainder ${r}. So the number is ${n}.`,
      ], 'Take the remainder off first, then look for the biggest multiple that fits.');
    }
    const price = pick([2, 3, 4, 5]), [word, k] = pick([['A quarter', 4], ['Half', 2]]);
    return explain(int('number sense · fractions', `${word} of a pizza costs $${price}. How much does the whole pizza cost, in dollars?`, price * k), [
      `${word} means the pizza is cut into ${k} equal pieces.`,
      `Each piece costs $${price}, so the whole pizza costs ${k} × ${price} = ${price * k}.`,
      `So the whole pizza costs ${price * k} dollars.`,
    ], 'A quarter is 1 of 4 equal parts; a half is 1 of 2.');
  }
  if (mid(y)) {
    if (kind === 1) {
      const d = pick([3, 4, 5, 6, 8]), n = d * ri(3, 12), k = ri(1, d - 1); if (gcd(k, d) !== 1) return null;
      return explain(int('number sense · fractions', `What is ${k}/${d} of ${n}?`, (n / d) * k), [
        `Split ${n} into ${d} equal parts: ${n} ÷ ${d} = ${n / d}.`,
        `Take ${k} of those parts: ${k} × ${n / d} = ${(n / d) * k}.`,
        `So ${k}/${d} of ${n} is ${(n / d) * k}.`,
      ], 'Divide by the bottom number, then multiply by the top.');
    }
    if (kind === 2) {
      const m = pick([6, 7, 8, 9, 11, 12]), r = ri(1, m - 1); let n = 999; while (n % m !== r) n--; const q = (n - r) / m;
      return explain(int('number sense · remainders', `What is the largest three-digit number that leaves a remainder of ${r} when divided by ${m}?`, n), [
        `A number that leaves remainder ${r} is ${r} more than a multiple of ${m}.`,
        `Take ${r} from 999: ${999 - r}. The largest multiple of ${m} up to ${999 - r} is ${m} × ${q} = ${m * q}.`,
        `Add the remainder back: ${m * q} + ${r} = ${n}.`,
        `Check: ${n} ÷ ${m} = ${q} remainder ${r}. So the number is ${n}.`,
      ], 'Take the remainder off first, then look for the biggest multiple that fits.');
    }
    const a = ri(2, 6), b = ri(a + 1, 9), u = ri(2, 12); if (gcd(a, b) !== 1) return null;
    return explain(int('number sense · ratio', `Two friends share ${(a + b) * u} stickers in the ratio ${a} : ${b}. How many does the one with more get?`, b * u), [
      bar('First', a, `${a} units`), bar('Second', b, `${b} units`),
      `${a} + ${b} = ${a + b} units share ${(a + b) * u} stickers, so 1 unit = ${(a + b) * u} ÷ ${a + b} = ${u}.`,
      `The friend with more has ${b} units: ${b} × ${u} = ${b * u}.`,
      `So the one with more gets ${b * u} stickers.`,
    ], 'In a ratio, add the parts to see how many units the whole is.');
  }
  if (kind === 1) {
    const p = pick([15, 20, 25, 30, 40, 60, 75]), t = pick([40, 60, 80, 120, 200]); if ((t * p) % 100) return null;
    return explain(int('number sense · percentages', `What is ${p}% of ${t}?`, (t * p) / 100), [
      `${p}% means ${p} out of every 100.`,
      `${p}% of ${t} = ${t} × ${p} ÷ 100 = ${t * p} ÷ 100 = ${(t * p) / 100}.`,
      `So ${p}% of ${t} is ${(t * p) / 100}.`,
    ], '25% is a quarter, 20% is a fifth, 50% is a half: use the fraction when you can.');
  }
  if (kind === 2) {
    const fs = shuffle([[2, 3], [3, 5], [5, 8], [7, 12], [4, 7], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [4, 5], [5, 9]]).slice(0, 4), best = fs.reduce((a, b) => (b[0] * a[1] > a[0] * b[1] ? b : a));
    return explain(mcOnly('number sense · fractions', 'Which fraction is the greatest?', `${best[0]}/${best[1]}`, fs.filter((f) => f !== best).map((f) => `${f[0]}/${f[1]}`)), [
      `Turn each fraction into a decimal: ${fs.map(([n, d]) => `${n}/${d} → ${(n / d).toFixed(2)}`).join(', ')}.`,
      `The biggest decimal is ${(best[0] / best[1]).toFixed(2)}.`,
      `So the greatest fraction is ${best[0]}/${best[1]}.`,
    ], 'To compare fractions with different bottoms, turn them into decimals or give them the same bottom.');
  }
  const n = pick([12, 18, 20, 24, 30, 36, 40, 48, 60]), pairs = factorsOf(n).filter((d) => d * d <= n).map((d) => `${d} × ${n / d}`);
  return explain(int('number sense · factors', `How many different rectangles with whole-number sides have an area of ${n} square units?`, Math.ceil(factorsOf(n).length / 2)), [
    `The two sides multiply to ${n}, so list the factor pairs: ${pairs.join(', ')}.`,
    `Each pair is one rectangle, and there are ${pairs.length} pairs.`,
    `So there are ${pairs.length} different rectangles.`,
  ], 'Pair each factor with its partner and stop when the two numbers meet.');
};
const nsP2 = (y) => {
  if (low(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const cols = shuffle(['red', 'green', 'blue', 'yellow']).slice(0, 3), pat = [...Array(4).fill(cols[0]), ...Array(2).fill(cols[1]), cols[2]], n = ri(15, 60), ask = ri(0, 2), full = Math.floor(n / 7), rest = n % 7, extra = pat.slice(0, rest).filter((c) => c === cols[ask]).length, cnt = full * [4, 2, 1][ask] + extra;
      return explain(int('number sense · repeating patterns', `Balloons hang in a repeating pattern: 4 ${cols[0]}, then 2 ${cols[1]}, then 1 ${cols[2]}, and again. Of the first ${n} balloons, how many are ${cols[ask]}?`, cnt), [
        `One group is 4 ${cols[0]} + 2 ${cols[1]} + 1 ${cols[2]} = 7 balloons.`,
        `${n} ÷ 7 = ${full} full groups with ${rest} balloon${rest === 1 ? '' : 's'} left over.`,
        `The full groups have ${full} × ${[4, 2, 1][ask]} = ${full * [4, 2, 1][ask]} ${cols[ask]} balloons.`,
        rest ? `The ${rest} left over ${rest === 1 ? 'is' : 'are'} ${pat.slice(0, rest).join(', ')}: ${extra} ${cols[ask]}.` : 'Nothing is left over.',
        `${full * [4, 2, 1][ask]} + ${extra} = ${cnt}. So ${cnt} of the first ${n} balloons are ${cols[ask]}.`,
      ], 'Find the size of one repeating group, divide, then look at the leftovers.');
    }
    if (kind === 2) {
      const a = ri(3, 30), b = a + ri(8, 40); let c = 0; for (let k = a; k <= b; k++) if (k % 2) c++; const f = a % 2 ? a : a + 1, l = b % 2 ? b : b - 1;
      return explain(int('number sense · odd and even', `How many odd numbers are there from ${a} to ${b}?`, c), [
        `The first odd number is ${f} and the last is ${l}.`,
        `Odd numbers go up in jumps of 2: from ${f} to ${l} is (${l} − ${f}) ÷ 2 = ${(l - f) / 2} jumps.`,
        `${(l - f) / 2} jumps means ${(l - f) / 2} + 1 = ${c} numbers.`,
        `So there are ${c} odd numbers from ${a} to ${b}.`,
      ], 'Count the jumps from the first to the last, then add 1 for the first one.');
    }
    const [p, q] = names(2), it = thing(), g = ri(2, 9), b = ri(3, 20), a = b + 2 * g;
    return explain(int('number sense · making equal', `${p} has ${a} ${it}s and ${q} has ${b}. How many ${it}s must ${p} give ${q} so that they have the same number?`, g), [
      bar(p, 6, `${a}`), bar(q, 4, `${b}`),
      `${p} has ${a} − ${b} = ${a - b} more than ${q}.`,
      `To make them equal, ${p} gives away half of the difference: ${a - b} ÷ 2 = ${g}.`,
      `Check: ${a} − ${g} = ${a - g} and ${b} + ${g} = ${b + g}. Equal.`,
      `So ${p} must give ${q} ${g} ${it}s.`,
    ], 'To make two amounts equal, move half of the difference.');
  }
  if (mid(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const k = ri(5, 30);
      return explain(int('number sense · fractions', `What is 1/2 of 1/4 of 1/8 of ${64 * k}?`, k), [
        `Work from the right: 1/8 of ${64 * k} = ${64 * k} ÷ 8 = ${8 * k}.`,
        `1/4 of ${8 * k} = ${8 * k} ÷ 4 = ${2 * k}.`,
        `1/2 of ${2 * k} = ${2 * k} ÷ 2 = ${k}.`,
        `So the answer is ${k}.`,
      ], '"Of" with a unit fraction means divide: a chain of fractions is a chain of divisions.');
    }
    if (kind === 2) {
      const [a, b] = pick([[4, 7], [3, 5], [4, 6], [6, 8], [5, 7], [3, 8]]), l = lcm(a, b);
      return explain(int('number sense · common multiples', `Two friends visit a library, one every ${a} days and the other every ${b} days. They meet there today. In how many days will they next meet there?`, l), [
        `One friend comes back on days ${multiples(a, l)}.`,
        `The other comes back on days ${multiples(b, l)}.`,
        `The first day in both lists is ${l}.`,
        `So they next meet there in ${l} days.`,
      ], '"Both again at the same time" asks for the lowest common multiple.');
    }
    if (kind === 3) {
      const start = pick([3, 5, 6, 8, 10]), every = pick([2, 3, 4, 5]), times = ri(3, 5), chain = Array.from({ length: times + 1 }, (_, i) => start * 2 ** i);
      return explain(int('number sense · doubling', `A colony of bacteria doubles every ${every} hours. There are ${start} now. How many will there be in ${every * times} hours?`, start * 2 ** times), [
        `${every * times} hours is ${every * times} ÷ ${every} = ${times} doublings.`,
        `Double ${times} times: ${chain.join(' → ')}.`,
        `So there will be ${start * 2 ** times} bacteria.`,
      ], 'Count how many times it doubles, then double step by step.');
    }
    const t = pick([42, 60, 72, 90, 120]), d1 = pick([5, 6]), d2 = pick([4, 5]), white = t / d1; if (!Number.isInteger(white)) return null; const rest = t - white, blue = rest / d2; if (!Number.isInteger(blue)) return null;
    return explain(int('number sense · fraction of a remainder', `Of ${t} cupcakes, 1/${d1} are white and 1/${d2} of the rest are blue. The others are red. How many are red?`, rest - blue), [
      `White: ${t} ÷ ${d1} = ${white}. The rest is ${t} − ${white} = ${rest}.`,
      `Blue: 1/${d2} of the rest = ${rest} ÷ ${d2} = ${blue}.`,
      `Red: ${rest} − ${blue} = ${rest - blue}.`,
      `So ${rest - blue} cupcakes are red.`,
    ], '"Of the rest" means find the rest first, then take the fraction of that.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const h = pick([6, 8, 12, 15, 23, 46]), p = pick([3, 4, 5, 7]), q = pick([2, 5, 8, 9]); if (gcd(p, q) !== 1) return null;
    return explain(int('number sense · LCM and HCF', `The lowest common multiple of two numbers is ${h * p * q} and their highest common factor is ${h}. One of the numbers is ${h * p}. What is the other?`, h * q), [
      `For two numbers, LCM × HCF = the product of the numbers: ${h * p * q} × ${h} = ${h * p * q * h}.`,
      `So the other number is ${h * p * q * h} ÷ ${h * p} = ${h * q}.`,
      `Check: ${h * p} = ${h} × ${p} and ${h * q} = ${h} × ${q}, so their HCF is ${h} and their LCM is ${h} × ${p} × ${q} = ${h * p * q}.`,
      `So the other number is ${h * q}.`,
    ], 'LCM × HCF = the product of the two numbers.');
  }
  if (kind === 2) {
    const n = pick([120, 150, 180, 200, 240, 300, 360]), k = pick([4, 5, 6]), good = factorsOf(n).filter((d) => d > k && n / d >= 2);
    return explain(int('number sense · factors', `${n} chairs are set out in equal rows, with more than ${k} rows and at least 2 chairs in each row. How many different numbers of rows are possible?`, good.length), [
      `Rows × chairs in a row = ${n}, so the number of rows is a factor of ${n}.`,
      `Factors of ${n}: ${factorsOf(n).join(', ')}.`,
      `Keep those more than ${k}, but not ${n} itself (that would be 1 chair in a row): ${good.join(', ')}.`,
      `So ${good.length} different numbers of rows are possible.`,
    ], 'Equal rows means a factor pair: list the factors, then apply the rules.');
  }
  const k = ri(1, 8), list = Array.from({ length: 9 - k }, (_, i) => `${i + 1}${i + 1 + k}`);
  return explain(int('number sense · digits', `How many two-digit numbers become larger by ${9 * k} when their two digits are swapped?`, 9 - k), [
    `Swapping the digits changes a two-digit number by 9 × (the difference of its digits).`,
    `${9 * k} ÷ 9 = ${k}, so the ones digit must be ${k} more than the tens digit.`,
    9 - k === 1 ? `Only tens digit 1 works: ${list[0]}.` : `Tens digit 1 up to ${9 - k}: ${list.join(', ')}.`,
    9 - k === 1 ? `So there is 1 such number.` : `So there are ${9 - k} such numbers.`,
  ], 'Swapping two digits changes the number by 9 times the difference of the digits.');
};
const nsP3 = (y) => {
  if (low(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const N = pick([500, 800, 1000]), a = ri(2, 12), b = ri(2, 12);
      return explain(int('number sense · place value', `Take ${a} tens and ${b} ones away from ${N}. What is left?`, N - 10 * a - b), [
        `${a} tens = ${10 * a}, and ${b} ones = ${b}.`,
        `${N} − ${10 * a} = ${N - 10 * a}.`,
        `${N - 10 * a} − ${b} = ${N - 10 * a - b}.`,
        `So ${N - 10 * a - b} is left.`,
      ], 'Turn the tens into a number first: 3 tens is 30.');
    }
    if (kind === 2) {
      const d = ri(1, 9), n = pick([30, 40, 50]), hits = []; for (let k = 1; k <= n; k++) if (digitsOf(k).includes(d)) hits.push(k);
      return explain(int('number sense · digits', `The pages of a book are numbered 1 to ${n}. How many page numbers contain the digit ${d}?`, hits.length), [
        `Go through 1 to ${n} and keep every number with a ${d} in it.`,
        `They are ${hits.join(', ')}.`,
        `Count them: ${hits.length}. So ${hits.length} page numbers contain the digit ${d}.`,
      ], 'Check the ones place and the tens place, and count each page only once.');
    }
    if (kind === 3) {
      const [w] = names(1), n = ri(15, 60);
      return explain(int('number sense · counting digits', `${w} writes the numbers from 1 to ${n} in a row. How many digits does ${w} write altogether?`, 9 + 2 * (n - 9)), [
        `The numbers 1 to 9 have 1 digit each: 9 digits.`,
        `From 10 to ${n} there are ${n - 9} numbers with 2 digits each: ${n - 9} × 2 = ${2 * (n - 9)}.`,
        `9 + ${2 * (n - 9)} = ${9 + 2 * (n - 9)}.`,
        `So ${w} writes ${9 + 2 * (n - 9)} digits.`,
      ], 'Count the one-digit numbers and the two-digit numbers separately.');
    }
    const n = pick([10, 12, 14, 16, 18, 20]);
    return explain(int('number sense · pairing sums', `What is 1 + 2 + 3 + … + ${n}?`, (n * (n + 1)) / 2), [
      `Pair the numbers from the two ends: 1 + ${n} = ${n + 1}, 2 + ${n - 1} = ${n + 1}, 3 + ${n - 2} = ${n + 1}, …`,
      `Every pair makes ${n + 1}, and ${n} numbers make ${n / 2} pairs.`,
      `${n / 2} × ${n + 1} = ${(n * (n + 1)) / 2}.`,
      `So the sum is ${(n * (n + 1)) / 2}.`,
    ], 'Pair the first with the last: every pair has the same sum.');
  }
  if (mid(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const A = ri(10, 40), B = ri(10, 40), C = ri(10, 40), D = ri(10, 40), S = A + B + C + D, X = B + C, Y = A + C + D;
      return explain(int('number sense · sums', `Four numbers A, B, C and D add up to ${S}. B + C = ${X} and A + C + D = ${Y}. What is C?`, C), [
        `Add the two clues: (B + C) + (A + C + D) = ${X} + ${Y} = ${X + Y}.`,
        `That counts A, B, C and D once each, and C a second time.`,
        `The extra C is ${X + Y} − ${S} = ${C}.`,
        `So C is ${C}.`,
      ], 'When two clues together cover everything plus one extra, subtract the total.');
    }
    if (kind === 2) {
      const parts = shuffle([100, 110, 120, 150, 90, 80]).slice(0, 3), u = ri(2, 12), w = names(3), i = ri(0, 2), g = gcd(gcd(parts[0], parts[1]), parts[2]), units = parts.map((p) => p / g), total = sum(parts) * u, per = total / sum(units);
      return explain(int('number sense · ratio', `${w.join(', ')} share $${total} in the ratio of their heights, which are ${parts[0]} cm, ${parts[1]} cm and ${parts[2]} cm. How much does ${w[i]} get, in dollars?`, parts[i] * u), [
        `The ratio ${parts[0]} : ${parts[1]} : ${parts[2]} simplifies (divide by ${g}) to ${units.join(' : ')}.`,
        `That is ${sum(units)} units altogether, so 1 unit = ${total} ÷ ${sum(units)} = ${per}.`,
        `${w[i]} has ${units[i]} units: ${units[i]} × ${per} = ${parts[i] * u}.`,
        `So ${w[i]} gets ${parts[i] * u} dollars.`,
      ], 'Simplify a ratio first; the shares stay the same.');
    }
    if (kind === 3) {
      const [a, b, c] = pick([[3, 4, 5], [2, 3, 5], [3, 5, 7], [4, 5, 6], [2, 5, 7], [3, 4, 7]]), r = ri(1, 2), l = lcm(lcm(a, b), c);
      return explain(int('number sense · remainder puzzles', `A basket holds some eggs. Counted in ${a}s, ${r} ${r === 1 ? 'is' : 'are'} left over; counted in ${b}s, ${r} ${r === 1 ? 'is' : 'are'} left over; counted in ${c}s, ${r} ${r === 1 ? 'is' : 'are'} left over. What is the smallest number of eggs there could be?`, l + r), [
        `Take ${r} egg${r === 1 ? '' : 's'} away, and the rest split exactly into ${a}s, ${b}s and ${c}s.`,
        `The smallest number that ${a}, ${b} and ${c} all divide is their lowest common multiple, ${l}.`,
        `Put the ${r} back: ${l} + ${r} = ${l + r}.`,
        `So the smallest number of eggs is ${l + r}.`,
      ], 'The same remainder every time means: the LCM plus that remainder.');
    }
    const k = pick([3, 4, 5]), u = ri(5, 12);
    return explain(int('number sense · age puzzles', `A mother is ${k} times as old as her daughter. Their ages add up to ${(k + 1) * u} years. How old is the daughter?`, u), [
      bar('Daughter', 1, ''), bar('Mother', k, ''),
      `The daughter is 1 unit and the mother is ${k} units: ${k + 1} units altogether.`,
      `${k + 1} units = ${(k + 1) * u}, so 1 unit = ${(k + 1) * u} ÷ ${k + 1} = ${u}.`,
      `So the daughter is ${u} years old.`,
    ], '"Times as old" is a bar model: the smaller one is 1 unit.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const N = ri(100, 2000); let p = 2, prev = 2; while (p * p <= N) { prev = p; p++; while (!isPrime(p)) p++; }
    return explain(int('number sense · factors', `What is the smallest number greater than ${N} that has exactly three factors?`, p * p), [
      `A number with exactly three factors is a prime squared: its factors are 1, the prime and the square.`,
      `Try primes: ${prev}² = ${prev * prev} is not more than ${N}, but ${p}² = ${p * p} is.`,
      `So the smallest such number is ${p * p}.`,
    ], 'Exactly three factors means a prime number squared.');
  }
  if (kind === 2) {
    const n = pick([100, 120, 150, 200, 300]), a = pick([3, 4, 5]), b = pick([5, 6, 7, 8]); if (a === b) return null; const l = lcm(a, b), fa = Math.floor(n / a), fb = Math.floor(n / b), fl = Math.floor(n / l);
    return explain(int('number sense · counting', `How many whole numbers from 1 to ${n} are divisible by ${a} or by ${b} (or both)?`, fa + fb - fl), [
      `Multiples of ${a} up to ${n}: ${n} ÷ ${a} → ${fa}.`,
      `Multiples of ${b} up to ${n}: ${n} ÷ ${b} → ${fb}.`,
      `Multiples of both are multiples of ${l}: ${fl}. They were counted twice.`,
      `${fa} + ${fb} − ${fl} = ${fa + fb - fl}. So ${fa + fb - fl} numbers are divisible by ${a} or by ${b}.`,
    ], 'Add the two counts, then take away the overlap once.');
  }
  const [a, b, c] = pick([[4, 5, 7], [3, 4, 5], [4, 6, 9], [5, 6, 8], [3, 5, 7], [6, 8, 10]]), l = lcm(lcm(a, b), c), k = ri(2, Math.max(2, Math.floor(999 / l))), lo = Math.floor((k * l) / 100) * 100, hi = lo + 100; if (k * l > 999 || Math.floor(hi / l) - Math.floor(lo / l) !== 1 || (k * l) % 100 === 0) return null;
  return explain(int('number sense · common multiples', `A library has between ${lo} and ${hi} books. They fill shelves of ${a}, of ${b} or of ${c} with none left over. How many books are there?`, k * l), [
    `The number of books is a multiple of ${a}, of ${b} and of ${c}: a multiple of their LCM, ${l}.`,
    `Multiples of ${l}: ${multiples(l, Math.min(hi, l * (k + 1)))}, …`,
    `The one between ${lo} and ${hi} is ${l} × ${k} = ${k * l}.`,
    `So the library has ${k * l} books.`,
  ], '"Fills every size of shelf with none left over" means a common multiple.');
};
// ---- Geometry ----
const SYMMETRY = { square: 'A square folds onto itself along both middle lines and both diagonals.', rectangle: 'A rectangle folds onto itself along its two middle lines, but a diagonal fold does not match.', 'equilateral triangle': 'An equilateral triangle folds onto itself along the line from each corner to the middle of the opposite side.' };
// how many rectangles of every size in an r by c grid, counted size by size, one line per height
const rectLines = (r, c) => Array.from({ length: r }, (_, i) => { const h = i + 1, terms = Array.from({ length: c }, (_, j) => (c - j) * (r - h + 1)); return `${h} square${h > 1 ? 's' : ''} tall: ${terms.join(' + ')} = ${sum(terms)}.`; });
const geP1 = (y) => {
  const kind = ri(1, 3);
  if (low(y)) {
    if (kind === 1) {
      const a = ri(2, 6), b = ri(2, 6);
      return explain(int('geometry · shapes', `A picture is made of ${a} triangles and ${b} squares. How many sides do the shapes have altogether?`, 3 * a + 4 * b), [
        `${a} triangles have ${a} × 3 = ${3 * a} sides.`,
        `${b} squares have ${b} × 4 = ${4 * b} sides.`,
        `${3 * a} + ${4 * b} = ${3 * a + 4 * b}. So the shapes have ${3 * a + 4 * b} sides altogether.`,
      ], 'A triangle has 3 sides and a square has 4: multiply, then add.');
    }
    if (kind === 2) {
      const c = pick([['square', 4], ['rectangle', 2], ['equilateral triangle', 3]]);
      return explain(int('geometry · symmetry', `How many lines of symmetry does a${c[0][0] === 'e' ? 'n' : ''} ${c[0]} have?`, c[1]), [
        `A line of symmetry is a fold line where the two halves match exactly.`,
        SYMMETRY[c[0]],
        `So a${c[0][0] === 'e' ? 'n' : ''} ${c[0]} has ${c[1]} lines of symmetry.`,
      ], 'Imagine folding the shape: a fold that matches is a line of symmetry.');
    }
    return explain(withFigure(int('geometry · counting figures', 'How many squares of every size are there in this 2 by 2 grid?', 5), grid('Count the squares', 2, 2)), [
      `Small 1 by 1 squares: 4.`,
      `The big 2 by 2 square: 1.`,
      `4 + 1 = 5. So there are 5 squares.`,
    ], 'Count the small squares first, then each bigger size.');
  }
  if (mid(y)) {
    if (kind === 1) {
      const l = ri(4, 20), w = ri(2, l - 1);
      return explain(int('geometry · perimeter', `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter, in cm?`, 2 * (l + w)), [
        `The perimeter is the distance all the way round: ${l} + ${w} + ${l} + ${w}.`,
        `That is 2 × (${l} + ${w}) = 2 × ${l + w} = ${2 * (l + w)}.`,
        `So the perimeter is ${2 * (l + w)} cm.`,
      ], 'Perimeter of a rectangle: add the length and the width, then double.');
    }
    if (kind === 2) {
      const a = ri(30, 80), b = ri(20, 170 - a);
      return explain(int('geometry · angles', `Two angles of a triangle are ${a}° and ${b}°. What is the third angle, in degrees?`, 180 - a - b), [
        `The three angles of a triangle add up to 180°.`,
        `${a} + ${b} = ${a + b}.`,
        `180 − ${a + b} = ${180 - a - b}. So the third angle is ${180 - a - b} degrees.`,
      ], 'Triangle angles always add up to 180°.');
    }
    const r = ri(2, 3), c = ri(3, 4), A = choose(r + 1, 2), B = choose(c + 1, 2);
    return explain(withFigure(int('geometry · counting figures', `How many rectangles of every size (squares included) are there in this ${r} by ${c} grid?`, A * B), grid('Count the rectangles', r, c)), [
      `Every rectangle is made by choosing 2 of the ${r + 1} horizontal lines and 2 of the ${c + 1} vertical lines.`,
      `2 lines from ${r + 1}: ${A} pairs. 2 lines from ${c + 1}: ${B} pairs.`,
      `${A} × ${B} = ${A * B}. So there are ${A * B} rectangles.`,
    ], 'A rectangle is two horizontal lines and two vertical lines: count the pairs of lines.');
  }
  if (kind === 1) {
    const r = pick([7, 14, 21]);
    return explain(int('geometry · circles', `Taking π as 22/7, what is the area of a circle of radius ${r} cm, in cm²?`, (22 / 7) * r * r), [
      `Area of a circle = π × radius × radius = 22/7 × ${r} × ${r}.`,
      `${r} ÷ 7 = ${r / 7}, so that is 22 × ${r / 7} × ${r} = ${22 * (r / 7) * r}.`,
      `So the area is ${22 * (r / 7) * r} cm².`,
    ], 'With π as 22/7, divide one radius by 7 first to keep the numbers small.');
  }
  if (kind === 2) {
    const l = ri(3, 10), w = ri(2, 8), h = ri(2, 6);
    return explain(int('geometry · volume', `A box is ${l} cm by ${w} cm by ${h} cm. What is its volume, in cm³?`, l * w * h), [
      `Volume of a box = length × width × height = ${l} × ${w} × ${h}.`,
      `${l} × ${w} = ${l * w}, then ${l * w} × ${h} = ${l * w * h}.`,
      `So the volume is ${l * w * h} cm³.`,
    ]);
  }
  const a = ri(50, 120), b = ri(50, 120), c = ri(40, 359 - a - b - 30); if (360 - a - b - c >= 180) return null;
  return explain(int('geometry · angles', `Three angles of a quadrilateral are ${a}°, ${b}° and ${c}°. What is the fourth angle, in degrees?`, 360 - a - b - c), [
    `The four angles of a quadrilateral add up to 360°.`,
    `${a} + ${b} + ${c} = ${a + b + c}.`,
    `360 − ${a + b + c} = ${360 - a - b - c}. So the fourth angle is ${360 - a - b - c} degrees.`,
  ], 'A quadrilateral is two triangles, so its angles add up to 2 × 180° = 360°.');
};
const geP2 = (y) => {
  if (low(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const r = pick([3, 4, 5]), c = pick([3, 5, 7]), q = Math.floor((r * c) / 2);
      return explain(withFigure(int('geometry · tiling', `A ${r} by ${c} board is covered with tiles that are 2 squares long and 1 square wide. What is the greatest number of tiles that fit without overlapping?`, q), grid('Fit the tiles', r, c)), [
        `The board has ${r} × ${c} = ${r * c} squares.`,
        `Each tile covers 2 squares: ${r * c} ÷ 2 = ${q}${(r * c) % 2 ? ' remainder 1' : ''}.`,
        (r * c) % 2 ? `One square must stay empty, so ${q} tiles fit.` : `${q} tiles cover the board exactly.`,
        `So the greatest number of tiles is ${q}.`,
      ], 'A tile covers 2 squares, so divide the number of squares by 2.');
    }
    if (kind === 2) {
      const l = pick([2, 3]), w = pick([2, 3]), h = pick([2, 3]), placed = ri(2, l * w * h - 2); // from 2, so "cubes are in place" is never "1 cubes"
      return explain(int('geometry · solids', `Unit cubes are stacked to build a block ${l} cubes long, ${w} cubes wide and ${h} cubes tall. ${placed} cubes are in place. How many more cubes are needed?`, l * w * h - placed), [
        `The full block needs ${l} × ${w} × ${h} = ${l * w * h} cubes.`,
        `${l * w * h} − ${placed} = ${l * w * h - placed}.`,
        `So ${l * w * h - placed} more cubes are needed.`,
      ], 'Count the whole block first: length × width × height.');
    }
    if (kind === 3) {
      const n = ri(2, 6), s = ri(2, 9);
      return explain(int('geometry · perimeter', `${n} squares, each with sides of ${s} cm, are placed in a row, touching, to make one long rectangle. What is the distance all the way around the rectangle, in cm?`, 2 * s * (n + 1)), [
        `The rectangle is ${n} × ${s} = ${n * s} cm long and ${s} cm wide.`,
        `All the way round: ${n * s} + ${s} + ${n * s} + ${s} = ${2 * s * (n + 1)}.`,
        `So the distance around the rectangle is ${2 * s * (n + 1)} cm.`,
      ], 'Sides that touch inside a shape do not count in the distance around it.');
    }
    const r = pick([2, 3]), c = pick([3, 4]), sizes = Array.from({ length: r }, (_, i) => (r - i) * (c - i));
    return explain(withFigure(int('geometry · counting figures', `How many squares of every size are there in this ${r} by ${c} grid?`, sum(sizes)), grid('Count the squares', r, c)), [
      ...sizes.map((k, i) => `${i + 1} by ${i + 1} squares: ${r - i} × ${c - i} = ${k}.`),
      `${sizes.join(' + ')} = ${sum(sizes)}. So there are ${sum(sizes)} squares.`,
    ], 'Count the small squares first, then each bigger size.');
  }
  if (mid(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const l = ri(2, 5), w = ri(2, 5), h = ri(2, 5);
      return explain(int('geometry · surface area', `A block ${l} cm by ${w} cm by ${h} cm is built from centimetre cubes. What is its surface area, in cm²?`, 2 * (l * w + w * h + l * h)), [
        `Top and bottom: 2 × (${l} × ${w}) = ${2 * l * w}.`,
        `Front and back: 2 × (${l} × ${h}) = ${2 * l * h}.`,
        `Left and right: 2 × (${w} × ${h}) = ${2 * w * h}.`,
        `${2 * l * w} + ${2 * l * h} + ${2 * w * h} = ${2 * (l * w + w * h + l * h)}. So the surface area is ${2 * (l * w + w * h + l * h)} cm².`,
      ], 'A box has three pairs of matching faces.');
    }
    if (kind === 2) {
      const n = pick([3, 4]), placed = ri(5, n ** 3 - 5);
      return explain(int('geometry · solids', `Unit cubes are being stacked to build a ${n} by ${n} by ${n} cube. ${placed} cubes are in place. How many more cubes are needed?`, n ** 3 - placed), [
        `A ${n} by ${n} by ${n} cube has ${n} × ${n} × ${n} = ${n ** 3} small cubes.`,
        `${n ** 3} − ${placed} = ${n ** 3 - placed}.`,
        `So ${n ** 3 - placed} more cubes are needed.`,
      ], 'Count the whole cube first: side × side × side.');
    }
    if (kind === 3) {
      const l = ri(6, 15), w = ri(3, l - 1);
      return explain(int('geometry · area', `A rectangle has an area of ${l * w} cm² and a length of ${l} cm. What is its perimeter, in cm?`, 2 * (l + w)), [
        `Width = area ÷ length = ${l * w} ÷ ${l} = ${w} cm.`,
        `Perimeter = 2 × (${l} + ${w}) = 2 × ${l + w} = ${2 * (l + w)}.`,
        `So the perimeter is ${2 * (l + w)} cm.`,
      ], 'Area = length × width, so area ÷ length gives the width.');
    }
    const s = pick([2, 3, 4, 5]), L = s * ri(3, 8), W = s * ri(2, 6);
    return explain(int('geometry · cutting squares', `A rectangular sheet ${L} cm by ${W} cm is cut into squares with sides of ${s} cm, with nothing wasted. How many squares are there?`, (L / s) * (W / s)), [
      `Along the ${L} cm side: ${L} ÷ ${s} = ${L / s} squares.`,
      `Along the ${W} cm side: ${W} ÷ ${s} = ${W / s} squares.`,
      `${L / s} × ${W / s} = ${(L / s) * (W / s)}. So there are ${(L / s) * (W / s)} squares.`,
    ], 'Count the squares along each side, then multiply.');
  }
  const kind = ri(1, 4);
  if (kind === 1) {
    const L = ri(10, 20), W = ri(6, 12);
    return explain(int('geometry · area', `A rectangular garden is ${L} m by ${W} m. A path 1 m wide runs all the way around the inside edge. What is the area of the path, in m²?`, L * W - (L - 2) * (W - 2)), [
      `The whole garden: ${L} × ${W} = ${L * W} m².`,
      `Inside the path is a rectangle 2 m shorter each way: ${L - 2} × ${W - 2} = ${(L - 2) * (W - 2)} m².`,
      `Path = ${L * W} − ${(L - 2) * (W - 2)} = ${L * W - (L - 2) * (W - 2)}.`,
      `So the area of the path is ${L * W - (L - 2) * (W - 2)} m².`,
    ], 'A border is the outside rectangle minus the inside one.');
  }
  if (kind === 2) {
    const n = pick([3, 4, 5]), wi = ri(0, 2), what = [['exactly two faces painted', 12 * (n - 2)], ['no face painted', (n - 2) ** 3], ['at least two faces painted', 8 + 12 * (n - 2)]][wi];
    return explain(int('geometry · solids', `A ${n} by ${n} by ${n} cube is painted on the outside and cut into ${n ** 3} unit cubes. How many unit cubes have ${what[0]}?`, what[1]), wi === 0 ? [
      `Cubes with exactly two painted faces sit along the edges, but not at the corners.`,
      `Each edge has ${n} − 2 = ${n - 2} of them, and a cube has 12 edges.`,
      `12 × ${n - 2} = ${12 * (n - 2)}. So ${12 * (n - 2)} unit cubes have exactly two faces painted.`,
    ] : wi === 1 ? [
      `Cubes with no paint are hidden inside: take one layer off every side.`,
      `That leaves a ${n - 2} by ${n - 2} by ${n - 2} cube: ${n - 2} × ${n - 2} × ${n - 2} = ${(n - 2) ** 3}.`,
      `So ${(n - 2) ** 3} unit cubes have no face painted.`,
    ] : [
      `Three painted faces: the 8 corner cubes.`,
      `Exactly two painted faces: ${n - 2} cube${n - 2 === 1 ? '' : 's'} on each of the 12 edges, 12 × ${n - 2} = ${12 * (n - 2)}.`,
      `8 + ${12 * (n - 2)} = ${8 + 12 * (n - 2)}. So ${8 + 12 * (n - 2)} unit cubes have at least two faces painted.`,
    ], 'Corners have 3 painted faces, edges 2, the middle of a face 1, the inside 0.');
  }
  if (kind === 3) {
    const a = ri(10, 80) * 2;
    return explain(int('geometry · isosceles triangles', `In an isosceles triangle, the angle between the two equal sides is ${a}°. What is each of the other two angles, in degrees?`, (180 - a) / 2), [
      `The angles of a triangle add up to 180°.`,
      `The other two angles are equal and share 180 − ${a} = ${180 - a}.`,
      `${180 - a} ÷ 2 = ${(180 - a) / 2}. So each of the other angles is ${(180 - a) / 2} degrees.`,
    ], 'In an isosceles triangle the two angles at the base are equal.');
  }
  const L = ri(8, 20), W = ri(5, 12), a = ri(2, L - 3), b = ri(2, W - 2);
  return explain(int('geometry · composite area', `A rectangle ${L} cm by ${W} cm has a ${a} cm by ${b} cm rectangle cut out of one corner. What is the area of the shape that is left, in cm²?`, L * W - a * b), [
    `The whole rectangle: ${L} × ${W} = ${L * W} cm².`,
    `The corner cut out: ${a} × ${b} = ${a * b} cm².`,
    `${L * W} − ${a * b} = ${L * W - a * b}. So the area left is ${L * W - a * b} cm².`,
  ], 'An L-shape is a big rectangle with a small one taken away.');
};
const geP3 = (y) => {
  if (low(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const r = pick([2, 3]), c = pick([3, 4]), lines = rectLines(r, c), subs = lines.map((l) => Number(l.split('= ')[1]));
      return explain(withFigure(int('geometry · counting figures', `How many rectangles of every size (squares included) are there in this ${r} by ${c} grid?`, choose(r + 1, 2) * choose(c + 1, 2)), grid('Count the rectangles', r, c)), [
        `Count by size: for each height, add up the rectangles ${Array.from({ length: c }, (_, j) => j + 1).join(', ')} squares wide.`,
        ...lines,
        `${subs.join(' + ')} = ${sum(subs)}. So there are ${sum(subs)} rectangles.`,
      ], 'Go size by size: each width, then each height, so none is missed.');
    }
    if (kind === 2) {
      const n = ri(4, 8), rows = Array.from({ length: n }, (_, i) => n - i);
      return explain(int('geometry · stacked cubes', `A staircase is built from cubes: the bottom row has ${n} cubes, the row above has ${n - 1}, and so on up to 1 cube at the top. How many cubes are used?`, sum(rows)), [
        `Add the rows from the bottom up: ${rows.join(' + ')} = ${sum(rows)}.`,
        `So ${sum(rows)} cubes are used.`,
      ], 'Count a solid layer by layer or row by row.');
    }
    const [w] = names(1), k = ri(2, 9);
    return explain(int('geometry · shapes from sticks', `${w} uses ${7 * k} sticks to make squares and triangles, the same number of each, with no sticks left over. Each square uses 4 sticks and each triangle uses 3. How many squares does ${w} make?`, k), [
      `One square and one triangle together use 4 + 3 = 7 sticks.`,
      `${7 * k} ÷ 7 = ${k} pairs of one square and one triangle.`,
      `So ${w} makes ${k} squares.`,
    ], '"The same number of each" means group one of each together.');
  }
  if (mid(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const n = pick([3, 4, 5]);
      return explain(int('geometry · solids', `A ${n} by ${n} by ${n} cube is painted on the outside and cut into ${n ** 3} unit cubes. How many unit cubes have exactly one face painted?`, 6 * (n - 2) * (n - 2)), [
        `Cubes with exactly one painted face are in the middle of a face, not on an edge.`,
        `Each face has a ${n - 2} by ${n - 2} patch of them: ${n - 2} × ${n - 2} = ${(n - 2) * (n - 2)}.`,
        `A cube has 6 faces: 6 × ${(n - 2) * (n - 2)} = ${6 * (n - 2) * (n - 2)}.`,
        `So ${6 * (n - 2) * (n - 2)} unit cubes have exactly one face painted.`,
      ], 'Corners have 3 painted faces, edges 2, the middle of a face 1, the inside 0.');
    }
    if (kind === 2) {
      const u = ri(2, 9);
      return explain(int('geometry · perimeter', `A square is cut into 4 equal strips. The perimeter of each strip is ${10 * u} cm. What is the perimeter of the square, in cm?`, 16 * u), [
        `Call the short side of a strip 1 unit. Its long side is the side of the square: 4 units.`,
        `A strip's perimeter is 4 + 1 + 4 + 1 = 10 units = ${10 * u} cm, so 1 unit = ${u} cm.`,
        `The square's side is 4 × ${u} = ${4 * u} cm, and its perimeter is 4 × ${4 * u} = ${16 * u}.`,
        `So the perimeter of the square is ${16 * u} cm.`,
      ], 'Call the smallest length 1 unit and write every other length in units.');
    }
    const k = ri(2, 4), u = ri(2, 8);
    return explain(int('geometry · area', `A rectangle is ${k} times as long as it is wide, and its perimeter is ${2 * (k + 1) * u} cm. What is its area, in cm²?`, k * u * u), [
      `Call the width 1 unit; the length is ${k} units.`,
      `Perimeter = 2 × (${k} + 1) = ${2 * (k + 1)} units = ${2 * (k + 1) * u} cm, so 1 unit = ${u} cm.`,
      `Width ${u} cm, length ${k * u} cm: area = ${u} × ${k * u} = ${k * u * u}.`,
      `So the area is ${k * u * u} cm².`,
    ], 'Call the smallest length 1 unit and write every other length in units.');
  }
  const kind = ri(1, 4);
  if (kind === 1) {
    const n = pick([3, 4, 5]);
    return explain(int('geometry · surface area', `A ${n} by ${n} by ${n} cube is built from unit cubes, and then its 8 corner cubes are removed. What is the surface area of the shape that is left, in square units?`, 6 * n * n), [
      `The full cube's surface area is 6 × ${n} × ${n} = ${6 * n * n}.`,
      `Removing a corner cube takes away 3 square faces but uncovers 3 new ones, so the area does not change.`,
      `So the surface area is still ${6 * n * n} square units.`,
    ], 'Cutting a corner off a cube leaves the surface area the same.');
  }
  if (kind === 2) {
    const l1 = ri(6, 15), w = ri(3, 8), h = ri(2, 6), l2 = ri(3, 10), h2 = ri(2, 6);
    return explain(int('geometry · volume', `Two blocks are glued together: one ${l1} cm by ${w} cm by ${h} cm and one ${l2} cm by ${w} cm by ${h2} cm. What is the volume of the solid, in cm³?`, l1 * w * h + l2 * w * h2), [
      `First block: ${l1} × ${w} × ${h} = ${l1 * w * h} cm³.`,
      `Second block: ${l2} × ${w} × ${h2} = ${l2 * w * h2} cm³.`,
      `${l1 * w * h} + ${l2 * w * h2} = ${l1 * w * h + l2 * w * h2}. So the volume is ${l1 * w * h + l2 * w * h2} cm³.`,
    ], 'Gluing does not change volume: add the two blocks.');
  }
  if (kind === 3) {
    const r = pick([7, 14, 21]), s = 2 * r, circle = 22 * (r / 7) * r;
    return explain(int('geometry · shaded area', `A square has sides of ${s} cm. The largest possible circle is drawn inside it. Taking π as 22/7, what is the area of the square outside the circle, in cm²?`, s * s - circle), [
      `The circle touches all four sides, so its radius is half the side: ${s} ÷ 2 = ${r} cm.`,
      `Circle: 22/7 × ${r} × ${r} = 22 × ${r / 7} × ${r} = ${circle} cm².`,
      `Square: ${s} × ${s} = ${s * s} cm².`,
      `${s * s} − ${circle} = ${s * s - circle}. So the area outside the circle is ${s * s - circle} cm².`,
    ], 'Shaded area is usually one shape minus another.');
  }
  const L = pick([20, 25, 30, 40, 50]), W = pick([10, 20, 30]), rise = ri(2, 9), V = L * W * rise;
  return explain(int('geometry · water level', `A tank with a base ${L} cm by ${W} cm holds some water. A stone of volume ${V} cm³ is dropped in and is covered completely. By how many centimetres does the water level rise?`, rise), [
    `The stone pushes up a layer of water with the same volume, ${V} cm³, spread over the whole base.`,
    `Base area = ${L} × ${W} = ${L * W} cm².`,
    `Rise = ${V} ÷ ${L * W} = ${rise}. So the water rises ${rise} cm.`,
  ], 'A sunken object raises the water by its volume ÷ the base area.');
};
// ---- Pattern and Algebra ----
// a rule machine's rules: the name, the function, how a child says it, and the working with the numbers put in
const RULES = [
  ['a + b', (a, b) => a + b, 'add the two numbers', (a, b) => `${a} + ${b}`],
  ['a × b', (a, b) => a * b, 'multiply the two numbers', (a, b) => `${a} × ${b}`],
  ['2a + b', (a, b) => 2 * a + b, 'double the first number, then add the second', (a, b) => `2 × ${a} + ${b}`],
  ['a + 2b', (a, b) => a + 2 * b, 'add the first number to double the second', (a, b) => `${a} + 2 × ${b}`],
  ['a × b − a', (a, b) => a * b - a, 'multiply the two numbers, then take away the first', (a, b) => `${a} × ${b} − ${a}`],
  ['a² + b²', (a, b) => a * a + b * b, 'square each number and add the squares', (a, b) => `${a}² + ${b}² = ${a * a} + ${b * b}`],
  ['a × b + a + b', (a, b) => a * b + a + b, 'multiply the two numbers, then add both of them', (a, b) => `${a} × ${b} + ${a} + ${b}`],
];
const machine = (rules, hi, cat, star) => {
  const [, f, how, work] = pick(rules), ex = Array.from({ length: 3 }, () => [ri(1, hi), ri(1, hi)]), a = ri(2, hi + 1), b = ri(2, hi + 1);
  if (new Set(ex.map(String)).size < 3 || rules.some(([, g]) => g !== f && ex.every(([p, q]) => g(p, q) === f(p, q)))) return null;
  const steps = [
    `Look for the rule: ${ex[0][0]} and ${ex[0][1]} give ${f(...ex[0])}, and ${work(...ex[0])} = ${f(...ex[0])}. Try: ${how}.`,
    `Check the other examples: ${work(...ex[1])} = ${f(...ex[1])} and ${work(...ex[2])} = ${f(...ex[2])}. The rule fits.`,
    `Use the rule on ${a} and ${b}: ${work(a, b)} = ${f(a, b)}.`,
    star ? `So ${a} ⍟ ${b} = ${f(a, b)}.` : `So the machine gives ${f(a, b)}.`,
  ], tip = 'Guess the rule from one example, then test it on every other example before using it.';
  if (star) return explain(int(cat, `${ex.map(([p, q]) => `${p} ⍟ ${q} = ${f(p, q)}`).join(', ')}. Following the same rule, what is ${a} ⍟ ${b}?`, f(a, b), { read: `${ex.map(([p, q]) => `${p} star ${q} is ${f(p, q)}`).join(', ')}. Following the same rule, what is ${a} star ${b}?` }), steps, tip);
  return explain(int(cat, `A machine turns two numbers into one: ${ex.map(([p, q]) => `${p} and ${q} give ${f(p, q)}`).join('; ')}. What does it give for ${a} and ${b}?`, f(a, b)), steps, tip);
};
const SYMS = ['♥', '▲', '★', '●'];
const paP1 = (y) => {
  if (low(y)) {
    const kind = ri(1, 5);
    if (kind === 1) {
      const s = ri(1, 10), k = pick([2, 3, 5]), n = ri(6, 9);
      return explain(int('pattern and algebra · number patterns', `Look at the pattern: ${s}, ${s + k}, ${s + 2 * k}, ${s + 3 * k}, … What is the ${ord(n)} number?`, s + (n - 1) * k), [
        `The numbers go up by ${k} each time.`,
        `From the 1st number to the ${ord(n)} is ${n - 1} jumps of ${k}: ${n - 1} × ${k} = ${(n - 1) * k}.`,
        `${s} + ${(n - 1) * k} = ${s + (n - 1) * k}. So the ${ord(n)} number is ${s + (n - 1) * k}.`,
      ], 'Count the jumps, not the numbers: the 7th number is 6 jumps from the 1st.');
    }
    if (kind === 2) {
      const a = ri(2, 9), b = ri(1, 9);
      return explain(int('pattern and algebra · missing number', `${a} + ▢ = ${a + b}. What number goes in the box?`, b, { read: `${a} plus what number makes ${a + b}?` }), [
        `The box is what you add to ${a} to reach ${a + b}.`,
        `${a + b} − ${a} = ${b}.`,
        `Check: ${a} + ${b} = ${a + b}. So the number in the box is ${b}.`,
      ], 'To find a missing part, take the known part away from the whole.');
    }
    if (kind === 3) {
      const s = ri(5, 20), terms = [s, s + 1, s + 3, s + 6, s + 10, s + 15];
      return explain(int('pattern and algebra · number patterns', `${terms[0]}, ${terms[1]}, ___, ${terms[3]}, ${terms[4]}, ${terms[5]}. What number is missing?`, terms[2]), [
        `Look at the jumps you can see: ${terms[0]} → ${terms[1]} is +1, ${terms[3]} → ${terms[4]} is +4, ${terms[4]} → ${terms[5]} is +5.`,
        `The jumps grow by 1 each time: +1, +2, +3, +4, +5.`,
        `${terms[1]} + 2 = ${terms[2]}. Check: ${terms[2]} + 3 = ${terms[3]}.`,
        `So the missing number is ${terms[2]}.`,
      ], 'When a number is missing, check the jumps between the numbers you can see.');
    }
    if (kind === 4) {
      const cols = shuffle(['red', 'blue', 'green', 'yellow', 'white']), a = ri(1, 3), b = ri(1, 3), n = ri(10, 40), per = a + b, q = Math.floor(n / per), rem = n % per, colour = rem === 0 ? cols[1] : rem <= a ? cols[0] : cols[1];
      return explain(mcOnly('pattern and algebra · shape patterns', `Beads are threaded in a repeating pattern: ${a} ${cols[0]}, then ${b} ${cols[1]}, then ${a} ${cols[0]} again, and so on. What colour is the ${ord(n)} bead?`, colour, [colour === cols[0] ? cols[1] : cols[0], cols[2], cols[3]]), [
        `One group is ${a} ${cols[0]} + ${b} ${cols[1]} = ${per} beads.`,
        `${n} ÷ ${per} = ${q} full group${q === 1 ? '' : 's'} remainder ${rem}.`,
        rem === 0 ? `No remainder, so the ${ord(n)} bead is the last bead of a group: ${cols[1]}.` : `So the ${ord(n)} bead is the ${ord(rem)} bead of a group, which is ${colour}.`,
        `So the ${ord(n)} bead is ${colour}.`,
      ], 'Divide by the size of the repeating group; the remainder tells you the position in the group.');
    }
    const x = ri(1, 9), a = ri(1, 9);
    return explain(int('pattern and algebra · function machines', `A number machine adds ${a} to any number put in, then doubles the result. What comes out when ${x} is put in?`, 2 * (x + a)), [
      `Add ${a}: ${x} + ${a} = ${x + a}.`,
      `Double it: ${x + a} × 2 = ${2 * (x + a)}.`,
      `So ${2 * (x + a)} comes out.`,
    ], 'Do the machine\'s steps one at a time, in the order given.');
  }
  if (mid(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const s = ri(2, 20), k = ri(3, 9), n = ri(10, 20);
      return explain(int('pattern and algebra · number patterns', `${s}, ${s + k}, ${s + 2 * k}, ${s + 3 * k}, … What is the ${ord(n)} number in the pattern?`, s + (n - 1) * k), [
        `The numbers go up by ${k} each time.`,
        `From the 1st number to the ${ord(n)} is ${n - 1} jumps of ${k}: ${n - 1} × ${k} = ${(n - 1) * k}.`,
        `${s} + ${(n - 1) * k} = ${s + (n - 1) * k}. So the ${ord(n)} number is ${s + (n - 1) * k}.`,
      ], 'Count the jumps, not the numbers: the 10th number is 9 jumps from the 1st.');
    }
    if (kind === 2) {
      const a = ri(2, 9), x = ri(2, 12);
      return explain(int('pattern and algebra · missing number', `${a} × ▢ = ${a * x}. What number goes in the box?`, x, { read: `${a} times what number makes ${a * x}?` }), [
        `${a} times the box makes ${a * x}, so the box is ${a * x} ÷ ${a} = ${x}.`,
        `Check: ${a} × ${x} = ${a * x}. So the number in the box is ${x}.`,
      ], 'Division undoes multiplication.');
    }
    const k = ri(2, 4), n = ri(5, 10);
    return explain(int('pattern and algebra · growing patterns', `Figure 1 is made of ${k + 1} sticks, Figure 2 of ${2 * k + 1}, Figure 3 of ${3 * k + 1}, and each figure has ${k} more sticks than the one before. How many sticks are in Figure ${n}?`, n * k + 1), [
      `Each figure adds ${k} sticks, and Figure 1 is ${k} + 1.`,
      `So Figure ${n} is ${n} lots of ${k}, plus the 1 extra: ${n} × ${k} + 1 = ${n * k + 1}.`,
      `So Figure ${n} has ${n * k + 1} sticks.`,
    ], 'Figure n has n jumps of sticks, plus what Figure 1 has beyond one jump.');
  }
  const kind = ri(1, 5);
  if (kind === 1) {
    const a = ri(2, 9), x = ri(2, 20), b = ri(1, 30);
    return explain(int('pattern and algebra · equations', `If ${a}x + ${b} = ${a * x + b}, what is x?`, x), [
      `Take ${b} from both sides: ${a}x = ${a * x + b} − ${b} = ${a * x}.`,
      `Divide both sides by ${a}: x = ${a * x} ÷ ${a} = ${x}.`,
      `Check: ${a} × ${x} + ${b} = ${a * x + b}. So x is ${x}.`,
    ], 'Undo the last thing that was done first: take away, then divide.');
  }
  if (kind === 2) {
    const n = ri(6, 15);
    return explain(int('pattern and algebra · number patterns', `1, 4, 9, 16, 25, … What is the ${ord(n)} number in the pattern?`, n * n), [
      `1 = 1 × 1, 4 = 2 × 2, 9 = 3 × 3, 16 = 4 × 4: each number is its position times itself.`,
      `The ${ord(n)} number is ${n} × ${n} = ${n * n}.`,
      `So the ${ord(n)} number is ${n * n}.`,
    ], '1, 4, 9, 16, … are the square numbers.');
  }
  if (kind === 3) {
    const s = ri(1000, 1020), d = pick([15, 25, 30]), n = ri(20, 60);
    return explain(int('pattern and algebra · number patterns', `${s}, ${s + d}, ${s + 2 * d}, ${s + 3 * d}, … What is the ${ord(n)} number in the pattern?`, s + (n - 1) * d), [
      `The numbers go up by ${d} each time.`,
      `From the 1st number to the ${ord(n)} is ${n - 1} jumps of ${d}: ${n - 1} × ${d} = ${(n - 1) * d}.`,
      `${s} + ${(n - 1) * d} = ${s + (n - 1) * d}. So the ${ord(n)} number is ${s + (n - 1) * d}.`,
    ], 'Count the jumps, not the numbers: the 20th number is 19 jumps from the 1st.');
  }
  if (kind === 4) {
    const [name, f, , work] = pick(RULES.slice(2)), p = ri(2, 9), q = ri(2, 9);
    return explain(int('pattern and algebra · defined operations', `For any two numbers a and b, a ⍟ b = ${name}. What is ${p} ⍟ ${q}?`, f(p, q), { read: `For any two numbers a and b, a star b is ${name}. What is ${p} star ${q}?` }), [
      `Put a = ${p} and b = ${q} into the rule ${name}.`,
      `${work(p, q)} = ${f(p, q)}.`,
      `So ${p} ⍟ ${q} = ${f(p, q)}.`,
    ], 'A made-up sign is just a recipe: put the numbers in where the letters are.');
  }
  const t = [ri(1, 5), ri(1, 6)], n = ri(7, 9); while (t.length < n) t.push(t.at(-1) + t.at(-2));
  return explain(int('pattern and algebra · adding patterns', `In the pattern ${t.slice(0, 5).join(', ')}, … each number after the first two is the sum of the two before it. What is the ${ord(n)} number?`, t[n - 1]), [
    `Keep adding the last two numbers: ${t.join(', ')}.`,
    `So the ${ord(n)} number is ${t[n - 1]}.`,
  ], 'When each number comes from the ones before it, just keep going until you reach the one asked for.');
};
const paP2 = (y) => {
  if (low(y)) {
    const kind = ri(1, 4);
    if (kind === 1) return machine(RULES.slice(0, 3), 6, 'pattern and algebra · rule machines', false);
    if (kind === 2) {
      const [s1, s2] = shuffle(SYMS).slice(0, 2), a = ri(2, 12), b = ri(1, 12);
      return explain(int('pattern and algebra · symbol equations', `${s1} + ${s1} + ${s2} = ${2 * a + b} and ${s1} + ${s2} = ${a + b}. Each symbol stands for one number. What number is ${s1}?`, a), [
        `The first line has one more ${s1} than the second line, and nothing else is different.`,
        `So that extra ${s1} is ${2 * a + b} − ${a + b} = ${a}.`,
        `Check: ${s2} = ${a + b} − ${a} = ${b}, and ${a} + ${a} + ${b} = ${2 * a + b}. So ${s1} is ${a}.`,
      ], 'Compare two lines that differ by one symbol: the difference is that symbol.');
    }
    if (kind === 3) {
      const [w] = names(1), a = ri(2, 9), b = ri(2, 9), x = ri(3, 20), r = x + a - b; if (r < 1) return null;
      return explain(int('pattern and algebra · working backwards', `${w} thinks of a number, adds ${a}, then takes away ${b}, and gets ${r}. What number did ${w} think of?`, x), [
        `Start at the end and undo each step in reverse order.`,
        `Undo taking away ${b}: ${r} + ${b} = ${r + b}.`,
        `Undo adding ${a}: ${r + b} − ${a} = ${x}.`,
        `Check: ${x} + ${a} − ${b} = ${r}. So the number was ${x}.`,
      ], 'To find a starting number, undo the steps backwards.');
    }
    const s = ri(1, 20), k = ri(2, 9);
    return explain(int('pattern and algebra · number patterns', `${s}, ${s + k}, ▢, ${s + 3 * k}, ${s + 4 * k}. What number goes in the box?`, s + 2 * k, { read: `${s}, ${s + k}, blank, ${s + 3 * k}, ${s + 4 * k}. What number goes in the blank?` }), [
      `Look at the jumps: ${s} → ${s + k} is +${k}, and ${s + 3 * k} → ${s + 4 * k} is +${k}.`,
      `The pattern goes up by ${k} each time, so the box is ${s + k} + ${k} = ${s + 2 * k}.`,
      `Check: ${s + 2 * k} + ${k} = ${s + 3 * k}. So the number in the box is ${s + 2 * k}.`,
    ], 'When a number is missing, check the jumps between the numbers you can see.');
  }
  if (mid(y)) {
    const kind = ri(1, 3);
    if (kind === 1) return machine(RULES.slice(0, 5), 9, 'pattern and algebra · rule machines', false);
    if (kind === 2) {
      const A = ri(10, 40), B = ri(10, 40), C = ri(10, 40), T = 2 * (A + B + C);
      return explain(int('pattern and algebra · sums', `A + B = ${A + B}, B + C = ${B + C} and A + C = ${A + C}. What is B?`, B), [
        `Add all three lines: ${A + B} + ${B + C} + ${A + C} = ${T}. That counts A, B and C twice each.`,
        `So A + B + C = ${T} ÷ 2 = ${T / 2}.`,
        `B = (A + B + C) − (A + C) = ${T / 2} − ${A + C} = ${B}.`,
        `So B is ${B}.`,
      ], 'Adding all three pair-sums counts every number twice.');
    }
    const [s1, s2] = shuffle(SYMS).slice(0, 2), a = ri(3, 30), b = ri(1, a - 1);
    return explain(int('pattern and algebra · symbol equations', `${s1} + ${s2} = ${a + b} and ${s1} − ${s2} = ${a - b}. Each symbol stands for one number. What number is ${s1}?`, a), [
      `Add the two lines: the ${s2} that is added and the ${s2} that is taken away cancel out.`,
      `${s1} + ${s1} = ${a + b} + ${a - b} = ${2 * a}, so ${s1} = ${2 * a} ÷ 2 = ${a}.`,
      `Check: ${s2} = ${a + b} − ${a} = ${b}, and ${a} − ${b} = ${a - b}. So ${s1} is ${a}.`,
    ], 'When one line adds and the other takes away, add the lines and one symbol vanishes.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const x = ri(3, 30), k = ri(2, 6), d = ri(1, 20); if (k * x - d <= 0) return null;
    return explain(int('pattern and algebra · equations', `A number is multiplied by ${k}, then ${d} is subtracted, and the result is ${k * x - d}. What is the number?`, x), [
      `Work backwards. Undo the subtraction: ${k * x - d} + ${d} = ${k * x}.`,
      `Undo the multiplication: ${k * x} ÷ ${k} = ${x}.`,
      `Check: ${x} × ${k} − ${d} = ${k * x - d}. So the number is ${x}.`,
    ], 'Undo the steps in reverse order: the last thing done is the first thing undone.');
  }
  if (kind === 2) return machine(RULES, 9, 'pattern and algebra · rule machines', true);
  const o = ri(2, 30), t = ri(1, 40);
  return explain(int('pattern and algebra · symbol equations', `△ + ○ + △ = ${2 * t + o} and ○ + ○ + ○ = ${3 * o}. What is ○ × △?`, o * t, { read: `Triangle plus circle plus triangle is ${2 * t + o}; three circles make ${3 * o}. What is circle times triangle?` }), [
    `Three circles make ${3 * o}, so one circle is ${3 * o} ÷ 3 = ${o}.`,
    `Two triangles and a circle make ${2 * t + o}, so two triangles make ${2 * t + o} − ${o} = ${2 * t}.`,
    `One triangle is ${2 * t} ÷ 2 = ${t}.`,
    `Circle × triangle = ${o} × ${t} = ${o * t}. So the answer is ${o * t}.`,
  ], 'Start with the line that has only one kind of symbol.');
};
const paP3 = (y) => {
  if (low(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const A = ri(3, 15), B = ri(3, 15), C = ri(3, 15), T = 2 * (A + B + C);
      return explain(int('pattern and algebra · sums', `A + B = ${A + B}, B + C = ${B + C} and A + C = ${A + C}. What is B?`, B), [
        `Add all three lines: ${A + B} + ${B + C} + ${A + C} = ${T}. That counts A, B and C twice each.`,
        `So A + B + C = ${T} ÷ 2 = ${T / 2}.`,
        `B = (A + B + C) − (A + C) = ${T / 2} − ${A + C} = ${B}.`,
        `So B is ${B}.`,
      ], 'Adding all three pair-sums counts every number twice.');
    }
    if (kind === 2) {
      const [s1, s2] = shuffle(SYMS).slice(0, 2), a = ri(2, 10), b = ri(1, 12);
      return explain(int('pattern and algebra · symbol equations', `${s1} + ${s1} + ${s1} = ${3 * a} and ${s1} + ${s2} = ${a + b}. Each symbol stands for one number. What number is ${s2}?`, b), [
        `Three ${s1} make ${3 * a}, so ${s1} = ${3 * a} ÷ 3 = ${a}.`,
        `${s1} + ${s2} = ${a + b}, so ${s2} = ${a + b} − ${a} = ${b}.`,
        `Check: ${a} + ${b} = ${a + b}. So ${s2} is ${b}.`,
      ], 'Start with the line that has only one kind of symbol.');
    }
    const [w] = names(1), x = ri(2, 20), a = ri(1, 9);
    return explain(int('pattern and algebra · working backwards', `${w} thinks of a number, doubles it, then adds ${a}. The answer is ${2 * x + a}. What number did ${w} think of?`, x), [
      `Start at the end and undo each step in reverse order.`,
      `Undo adding ${a}: ${2 * x + a} − ${a} = ${2 * x}.`,
      `Undo doubling: ${2 * x} ÷ 2 = ${x}.`,
      `Check: ${x} × 2 + ${a} = ${2 * x + a}. So the number was ${x}.`,
    ], 'To find a starting number, undo the steps backwards.');
  }
  if (mid(y)) {
    const kind = ri(1, 4);
    if (kind === 1) return machine(RULES, 12, 'pattern and algebra · rule machines', true);
    if (kind === 2) {
      const o = ri(2, 20), t = ri(1, 20);
      return explain(int('pattern and algebra · symbol equations', `△ + ○ + △ = ${2 * t + o} and ○ + ○ + ○ = ${3 * o}. What is ○ × △?`, o * t, { read: `Triangle plus circle plus triangle is ${2 * t + o}; three circles make ${3 * o}. What is circle times triangle?` }), [
        `Three circles make ${3 * o}, so one circle is ${3 * o} ÷ 3 = ${o}.`,
        `Two triangles and a circle make ${2 * t + o}, so two triangles make ${2 * t + o} − ${o} = ${2 * t}.`,
        `One triangle is ${2 * t} ÷ 2 = ${t}.`,
        `Circle × triangle = ${o} × ${t} = ${o * t}. So the answer is ${o * t}.`,
      ], 'Start with the line that has only one kind of symbol.');
    }
    if (kind === 3) {
      const k = ri(2, 5), n = ri(8, 30);
      return explain(int('pattern and algebra · growing patterns', `Figure 1 is made of ${k + 1} sticks, Figure 2 of ${2 * k + 1}, Figure 3 of ${3 * k + 1}, and each figure has ${k} more sticks than the one before. Which figure is made of ${n * k + 1} sticks?`, n), [
        `Each figure adds ${k} sticks, and Figure 1 is ${k} + 1: a figure's number × ${k}, plus 1.`,
        `${n * k + 1} − 1 = ${n * k}, and ${n * k} ÷ ${k} = ${n}.`,
        `Check: ${n} × ${k} + 1 = ${n * k + 1}. So it is Figure ${n}.`,
      ], 'Take off the extra stick, then divide by the jump.');
    }
    const [w] = names(1), k = pick([3, 4, 5]), x = ri(3, 20), a = ri(1, 9) * 2, r = (k * x - a) / 2; if (!Number.isInteger(r) || r < 1) return null;
    return explain(int('pattern and algebra · working backwards', `${w} thinks of a number, multiplies it by ${k}, takes away ${a}, then halves the result and gets ${r}. What number did ${w} think of?`, x), [
      `Start at the end and undo each step in reverse order.`,
      `Undo halving: ${r} × 2 = ${2 * r}.`,
      `Undo taking away ${a}: ${2 * r} + ${a} = ${k * x}.`,
      `Undo multiplying by ${k}: ${k * x} ÷ ${k} = ${x}.`,
      `Check: ${x} × ${k} − ${a} = ${k * x - a}, and half of that is ${r}. So the number was ${x}.`,
    ], 'To find a starting number, undo the steps backwards.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const a = ri(1, 5), d = pick([3, 4, 5, 6, 7]), n = ri(20, 60), last = a + (n - 1) * d, S = (n * (2 * a + (n - 1) * d)) / 2;
    return explain(int('pattern and algebra · series', `What is ${a} + ${a + d} + ${a + 2 * d} + … + ${last}?`, S), [
      `The numbers go up by ${d}. From ${a} to ${last} is (${last} − ${a}) ÷ ${d} = ${n - 1} jumps, so there are ${n} numbers.`,
      `Pair the first with the last: ${a} + ${last} = ${a + last}. The second with the second last: ${a + d} + ${last - d} = ${a + last}. Every pair makes ${a + last}.`,
      `Sum = (first + last) × how many ÷ 2 = ${a + last} × ${n} ÷ 2 = ${S}.`,
      `So the sum is ${S}.`,
    ], 'Pair the first and last: sum = (first + last) × how many ÷ 2.');
  }
  if (kind === 2) {
    const [t1, t2, h] = pick([[6, 3, 2], [4, 4, 2], [6, 12, 4], [10, 15, 6], [4, 12, 3], [8, 8, 4], [5, 20, 4], [3, 6, 2]]), l = lcm(t1, t2), walls = l / t1 + l / t2;
    return explain(int('pattern and algebra · work rate', `Robot A can build a wall in ${t1} hours and robot B can build the same wall in ${t2} hours. Working together at the same rates, how many minutes do they take?`, h * 60), [
      `In ${l} hours, robot A builds ${l} ÷ ${t1} = ${l / t1} wall${l / t1 > 1 ? 's' : ''} and robot B builds ${l} ÷ ${t2} = ${l / t2}: ${walls} walls together.`,
      `So one wall takes them ${l} ÷ ${walls} = ${h} hours.`,
      `${h} hours = ${h} × 60 = ${h * 60} minutes. So they take ${h * 60} minutes.`,
    ], 'Pick a time in which both finish whole walls, then count the walls.');
  }
  const p = pick([4, 5, 8, 10]), n = ri(1, 4), q = pick([5, 6, 8, 10]); if (n >= q) return null; const x2 = ri(20, 200) * 10, c1 = ri(1, 9) * 10, c2 = ri(1, 9) * 10, x1 = ((x2 + c2) * q) / (q - n); if (!Number.isInteger(x1)) return null; const x0 = ((x1 + c1) * p) / (p - 1); if (!Number.isInteger(x0)) return null; const [w] = names(1);
  return explain(int('pattern and algebra · working backwards', `${w} spent 1/${p} of ${w}'s savings and another $${c1} on a bag, then ${n}/${q} of the remaining money and another $${c2} on shoes. ${w} then had $${x2} left. How much did ${w} have at first, in dollars?`, x0), [
    `Work backwards from the $${x2} left.`,
    `Shoes: after spending ${n}/${q} of the money, ${q - n}/${q} of it was left; $${c2} more went, and $${x2} remained.`,
    `So ${q - n}/${q} of the money = ${x2} + ${c2} = ${x2 + c2}, and the money before the shoes was ${x2 + c2} ÷ ${q - n} × ${q} = ${x1}.`,
    `Bag: ${p - 1}/${p} of the savings, less $${c1}, left $${x1}, so ${p - 1}/${p} of the savings = ${x1} + ${c1} = ${x1 + c1}.`,
    `Savings = ${x1 + c1} ÷ ${p - 1} × ${p} = ${x0}.`,
    `So ${w} had ${x0} dollars at first.`,
  ], '"Then had … left" is the clue: start at the end and undo each step.');
};
// ---- Measurements ----
const frog = (D, up, slip) => { let n = 0, pos = 0; for (;;) { n++; pos += up; if (pos >= D) return n; pos -= slip; } };
// the frog's steps: the gain per climb, where it is before the last climb, and why one climb fewer is not enough; `per` minutes a climb, or hours
const frogSteps = (D, up, slip, n, per) => [
  `${per ? `Every ${per} minutes` : 'Each hour'} the frog climbs ${up} m and slips back ${slip} m: a gain of ${up - slip} m.`,
  `After ${n - 1} climb${n - 1 === 1 ? '' : 's'} it is ${n - 1} × ${up - slip} = ${(n - 1) * (up - slip)} m up.`,
  `On the ${ord(n)} climb it goes up ${up} m more: ${(n - 1) * (up - slip)} + ${up} = ${(n - 1) * (up - slip) + up}, which reaches the top of the ${D} m well before it can slip.`,
  `One climb earlier it would only reach ${(n - 2) * (up - slip) + up} m, not enough.`,
  per ? `${n} climbs × ${per} minutes = ${n * per}. So it reaches the top after ${n * per} minutes.` : `So it reaches the top after ${n} hours.`,
];
const FROG_TIP = 'The frog does not slip on the climb that gets it out: count the gains, then add the last climb.';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fmt12 = (t) => `${hm(t >= 13 * 60 ? t - 12 * 60 : t)} ${t >= 12 * 60 ? 'pm' : 'am'}`;
// the lines that add d minutes to clock time t, an hour first, then to the next full hour when the minutes cross one
const addMin = (t, d) => { const out = []; let cur = t, left = d; if (left >= 60) { out.push(`${d} minutes is 1 hour and ${d - 60} minutes. ${hm(cur)} + 1 hour = ${hm(cur + 60)}.`); cur += 60; left -= 60; } if (left > 0) { const toHour = 60 - (cur % 60); if (cur % 60 && left > toHour) out.push(`${hm(cur)} + ${toHour} minutes = ${hm(cur + toHour)}, then ${left - toHour} more minutes = ${hm(cur + left)}.`); else out.push(`${hm(cur)} + ${left} minutes = ${hm(cur + left)}.`); } return out; };
const UNITS = [['metres', 'metre', 'centimetres', 100], ['kilometres', 'kilometre', 'metres', 1000], ['kilograms', 'kilogram', 'grams', 1000], ['litres', 'litre', 'millilitres', 1000], ['hours', 'hour', 'minutes', 60]];
const meP1 = (y) => {
  if (low(y)) {
    const kind = ri(1, 5);
    if (kind === 1) {
      const h = ri(1, 9), d = pick([1, 2, 3]);
      return explain(int('measurement · time', `A film starts at ${h} o'clock and lasts ${d} hour${d > 1 ? 's' : ''}. It ends at ___ o'clock. What number goes in the blank?`, h + d), [
        `Start at ${h} o'clock and count on ${d} hour${d > 1 ? 's' : ''}: ${h} + ${d} = ${h + d}.`,
        `So the film ends at ${h + d} o'clock.`,
      ], 'Count on from the start time.');
    }
    if (kind === 2) {
      const a = ri(2, 9), b = ri(2, 9);
      return explain(int('measurement · length', `A ribbon is ${a} cm long and another is ${b} cm long. How long are they altogether, in cm?`, a + b), [
        `Put the ribbons end to end: ${a} + ${b} = ${a + b}.`,
        `So they are ${a + b} cm altogether.`,
      ]);
    }
    if (kind === 3) {
      const s = ri(1, 9) * 60 + pick([0, 15, 30, 45]), d = pick([15, 30, 45]), chain = Array.from({ length: d / 15 + 1 }, (_, i) => hm(s + 15 * i));
      return explain(int('measurement · time', `A game starts at ${hm(s)} and ends at ${hm(s + d)}. How many minutes does it last?`, d), [
        `Count on in 15-minute jumps: ${chain.join(' → ')}.`,
        `That is ${d / 15} jump${d > 15 ? 's' : ''} of 15 minutes: ${d / 15} × 15 = ${d}.`,
        `So the game lasts ${d} minutes.`,
      ], 'A quarter of an hour is 15 minutes: count on in quarters.');
    }
    if (kind === 4) {
      const [w] = names(1), a = ri(2, 9), b = ri(2, 9);
      return explain(int('measurement · money', `${w} has ${a} ten-cent coins and ${b} five-cent coins. How many cents does ${w} have altogether?`, 10 * a + 5 * b), [
        `${a} ten-cent coins: ${a} × 10 = ${10 * a} cents.`,
        `${b} five-cent coins: ${b} × 5 = ${5 * b} cents.`,
        `${10 * a} + ${5 * b} = ${10 * a + 5 * b}. So ${w} has ${10 * a + 5 * b} cents.`,
      ], 'Count each kind of coin first, then add.');
    }
    const i = ri(0, 6), n = ri(8, 30), q = Math.floor(n / 7), r = n % 7, target = DAYS[(i + n) % 7], chain = Array.from({ length: r + 1 }, (_, j) => DAYS[(i + j) % 7]);
    return explain(mcOnly('measurement · calendar', `Today is ${DAYS[i]}. What day of the week will it be in ${n} days?`, target, shuffle(DAYS.filter((d) => d !== target)).slice(0, 3)), [
      `A week is 7 days, so every 7 days it is ${DAYS[i]} again.`,
      `${n} = ${q} × 7 + ${r}: after ${q} week${q === 1 ? '' : 's'} it is ${DAYS[i]}, then count on ${r} day${r === 1 ? '' : 's'}.`,
      r ? `${chain.join(' → ')}.` : `No days left to count.`,
      `So in ${n} days it will be ${target}.`,
    ], 'Take away whole weeks first; only the remainder moves the day.');
  }
  if (mid(y)) {
    const kind = ri(1, 5);
    if (kind === 1) {
      const s = ri(1, 9) * 60 + pick([0, 10, 20, 30, 40, 50]), d = ri(5, 35) * 5;
      return explain(int('measurement · time', `A lesson starts at ${hm(s)} and ends at ${hm(s + d)}. How many minutes does it last?`, d), [
        ...between(s, s + d),
        `So the lesson lasts ${d} minutes.`,
      ], 'Count to the next full hour first, then the rest.');
    }
    if (kind === 2) {
      const m = pick([5, 10, 15, 20, 25, 40, 45, 50]);
      return explain(int('measurement · angles', `Through how many degrees does the minute hand of a clock turn in ${m} minutes?`, 6 * m), [
        `The minute hand turns a full 360° in 60 minutes: 360 ÷ 60 = 6° every minute.`,
        `${m} × 6 = ${6 * m}. So it turns ${6 * m} degrees.`,
      ], 'The minute hand turns 6° a minute; the hour hand 30° an hour.');
    }
    if (kind === 3) {
      const h = ri(1, 10), m = pick([0, 15, 30, 45]), d = pick([25, 40, 45, 70, 95]), e = h * 60 + m + d;
      return explain(mcOnly('measurement · time', `A lesson starts at ${hm(h * 60 + m)} and lasts ${d} minutes. When does it end?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 30)]), [
        ...addMin(h * 60 + m, d),
        `So the lesson ends at ${hm(e)}.`,
      ], 'Add the hours first, then the minutes, and watch for the next full hour.');
    }
    if (kind === 4) {
      const [big, one, small, k] = pick(UNITS), a = ri(2, 9), b = ri(1, 9) * (k === 60 ? 5 : 10);
      return explain(int('measurement · units', `How many ${small} are there in ${a} ${big} ${b} ${small}?`, k * a + b), [
        `1 ${one} = ${k} ${small}, so ${a} ${big} = ${a} × ${k} = ${a * k} ${small}.`,
        `${a * k} + ${b} = ${a * k + b}.`,
        `So there are ${a * k + b} ${small}.`,
      ], 'Change the big unit first, then add the small ones.');
    }
    const [w] = names(1), n = ri(2, 6), p = ri(2, 9) * 5, D = pick([1, 2, 5]) ; if (n * p >= 100 * D) return null;
    return explain(int('measurement · money', `${w} buys ${n} pencils at ${p} cents each and pays with a $${D} note. How much change does ${w} get, in cents?`, 100 * D - n * p), [
      `The pencils cost ${n} × ${p} = ${n * p} cents.`,
      `$${D} is ${100 * D} cents.`,
      `${100 * D} − ${n * p} = ${100 * D - n * p}. So ${w} gets ${100 * D - n * p} cents change.`,
    ], 'Put everything in the same unit before you subtract.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const v = pick([40, 50, 60, 80]), t = ri(2, 5);
    return explain(int('measurement · speed', `A car travels at ${v} km/h for ${t} hours. How far does it go, in km?`, v * t), [
      `${v} km/h means ${v} km every hour.`,
      `In ${t} hours: ${v} × ${t} = ${v * t}.`,
      `So the car goes ${v * t} km.`,
    ], 'Distance = speed × time.');
  }
  if (kind === 2) {
    const m = pick([5, 10, 15, 20, 25, 35, 40, 50]);
    return explain(int('measurement · angles', `Through how many degrees does the minute hand of a clock turn in ${m} minutes?`, 6 * m), [
      `The minute hand turns a full 360° in 60 minutes: 360 ÷ 60 = 6° every minute.`,
      `${m} × 6 = ${6 * m}. So it turns ${6 * m} degrees.`,
    ], 'The minute hand turns 6° a minute; the hour hand 30° an hour.');
  }
  const s = ri(9, 11) * 60 + pick([0, 15, 30, 45]), d = ri(20, 50) * 5, e = s + d;
  return explain(int('measurement · time', `A film starts at ${hm(s)} am and ends at ${hm(e >= 13 * 60 ? e - 12 * 60 : e)} ${e >= 12 * 60 ? 'pm' : 'am'}. How many minutes does it last?`, d), [
    ...between(s, e, fmt12),
    `So the film lasts ${d} minutes.`,
  ], 'Count to the next full hour first, then the rest; 12:00 pm is noon.');
};
const meP2 = (y) => {
  if (low(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const D = ri(4, 9), up = ri(2, 3), n = frog(D, up, 1);
      return explain(int('measurement · frog in a well', `A frog is at the bottom of a well ${D} m deep. Each hour it climbs ${up} m, then slips back 1 m before the next hour. After how many hours does it reach the top?`, n), frogSteps(D, up, 1, n, 0), FROG_TIP);
    }
    if (kind === 2) {
      const L = ri(12, 40), p = pick([3, 4, 5]), q = Math.floor(L / p);
      return explain(int('measurement · length', `A ribbon ${L} cm long is cut into pieces ${p} cm long. How many centimetres are left over?`, L % p), [
        `${L} ÷ ${p} = ${q} remainder ${L % p}.`,
        `${q} pieces use ${q} × ${p} = ${q * p} cm, and ${L} − ${q * p} = ${L % p}.`,
        `So ${L % p} cm are left over.`,
      ], 'The remainder of the division is what is left over.');
    }
    if (kind === 3) {
      const i0 = ri(0, 6), i1 = ri(0, 6), k = ri(1, 4), off = (i1 - i0 + 7) % 7, date = 1 + off + 7 * (k - 1), dates = Array.from({ length: k }, (_, j) => ord(1 + off + 7 * j));
      return explain(int('measurement · calendar', `The 1st of a month is a ${DAYS[i0]}. What is the date of the ${ord(k)} ${DAYS[i1]} of that month?`, date), [
        off ? `From ${DAYS[i0]} to ${DAYS[i1]} is ${off} day${off === 1 ? '' : 's'}, so the first ${DAYS[i1]} is the ${ord(1 + off)}.` : `The 1st is itself a ${DAYS[i1]}, so the first ${DAYS[i1]} is the 1st.`,
        `Every ${DAYS[i1]} after that is 7 days later: ${dates.join(', ')}.`,
        `So the ${ord(k)} ${DAYS[i1]} is the ${ord(date)}: the date is ${date}.`,
      ], 'The same day of the week comes back every 7 days.');
    }
    const n = ri(2, 6), b = ri(1, 5), e = ri(1, 4), W = e + n * b;
    return explain(int('measurement · mass', `A box holding ${n} identical books weighs ${W} kg. The empty box weighs ${e} kg. How much does one book weigh, in kg?`, b), [
      `The books alone weigh ${W} − ${e} = ${n * b} kg.`,
      `${n * b} ÷ ${n} = ${b}. So one book weighs ${b} kg.`,
    ], 'Take off the box first, then share what is left.');
  }
  if (mid(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const D = ri(6, 12), up = ri(2, 4), slip = ri(1, up - 1), per = pick([10, 15, 20]), n = frog(D, up, slip);
      return explain(int('measurement · frog in a well', `A frog is at the bottom of a well ${D} m deep. Every ${per} minutes it climbs ${up} m, then slips back ${slip} m before the next climb. After how many minutes does it reach the top?`, n * per), frogSteps(D, up, slip, n, per), FROG_TIP);
    }
    if (kind === 2) {
      const L = ri(4, 20) * 5, W = ri(2, 12) * 5, k = pick([5, 10]); if ((2 * (L + W)) % k) return null; const P = 2 * (L + W);
      return explain(int('measurement · perimeter', `Fence posts stand every ${k} m around the edge of a rectangular field ${L} m by ${W} m, with a post at each corner. How many posts are there?`, P / k), [
        `The distance around the field is 2 × (${L} + ${W}) = ${P} m.`,
        `That makes ${P} ÷ ${k} = ${P / k} gaps between posts.`,
        `Around a closed shape, the number of posts equals the number of gaps: ${P / k}.`,
        `So there are ${P / k} posts.`,
      ], 'Around a closed loop, posts = gaps; along a line, posts = gaps + 1.');
    }
    const h = ri(1, 12), m = pick([0, 10, 20, 30, 40, 50]), a = Math.abs(30 * (h % 12) - 5.5 * m), v = Math.min(a, 360 - a); if (v === 0) return null; const ha = 30 * (h % 12) + m / 2, ma = 6 * m;
    return explain(int('measurement · angles', `What is the smaller angle between the hands of a clock at ${h}:${String(m).padStart(2, '0')}, in degrees?`, v), [
      `The minute hand moves 6° a minute. The hour hand moves 30° an hour, which is 0.5° a minute.`,
      `Minute hand: ${m} × 6 = ${ma}°. Hour hand: ${h % 12} × 30 + ${m} × 0.5 = ${ha}°.`,
      `The hands are ${a}° apart${a > 180 ? `, so the smaller angle is 360 − ${a} = ${v}°` : ''}.`,
      `So the smaller angle is ${v} degrees.`,
    ], 'The hour hand moves too: half a degree every minute.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const D = ri(10, 30), up = ri(3, 6), slip = ri(1, up - 1), per = pick([10, 15, 20, 30]), n = frog(D, up, slip);
    return explain(int('measurement · frog in a well', `A frog is at the bottom of a well ${D} m deep. Every ${per} minutes it climbs ${up} m, then slips back ${slip} m before the next climb. After how many minutes does it reach the top?`, n * per), frogSteps(D, up, slip, n, per), FROG_TIP);
  }
  if (kind === 2) {
    const [v1, v2] = pick([[30, 60], [40, 60], [60, 30], [60, 40], [20, 60], [60, 20], [30, 20], [20, 30]]), d = pick([60, 120, 180, 240]), avg = (2 * d) / (d / v1 + d / v2); if (!Number.isInteger(avg) || !Number.isInteger(d / v1) || !Number.isInteger(d / v2)) return null;
    return explain(int('measurement · speed', `A bus drives ${d} km from one town to another at ${v1} km/h and comes straight back the same way at ${v2} km/h. What is its average speed for the whole trip, in km/h?`, avg), [
      `Going: ${d} ÷ ${v1} = ${d / v1} hour${d / v1 === 1 ? '' : 's'}. Coming back: ${d} ÷ ${v2} = ${d / v2} hour${d / v2 === 1 ? '' : 's'}.`,
      `Whole trip: ${2 * d} km in ${d / v1 + d / v2} hours.`,
      `Average speed = ${2 * d} ÷ ${d / v1 + d / v2} = ${avg}. So the average speed is ${avg} km/h.`,
    ], 'Average speed is total distance ÷ total time, not the average of the two speeds.');
  }
  const h = ri(1, 12), m = pick([0, 10, 20, 30, 40, 50]), a = Math.abs(30 * (h % 12) - 5.5 * m), v = Math.min(a, 360 - a); if (v === 0) return null; const ha = 30 * (h % 12) + m / 2, ma = 6 * m;
  return explain(int('measurement · angles', `What is the smaller angle between the hands of a clock at ${h}:${String(m).padStart(2, '0')}, in degrees?`, v), [
    `The minute hand moves 6° a minute. The hour hand moves 30° an hour, which is 0.5° a minute.`,
    `Minute hand: ${m} × 6 = ${ma}°. Hour hand: ${h % 12} × 30 + ${m} × 0.5 = ${ha}°.`,
    `The hands are ${a}° apart${a > 180 ? `, so the smaller angle is 360 − ${a} = ${v}°` : ''}.`,
    `So the smaller angle is ${v} degrees.`,
  ], 'The hour hand moves too: half a degree every minute.');
};
const meP3 = (y) => {
  if (low(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const per = ri(2, 3), a = ri(3, 4), c = ri(a + 2, 8);
      return explain(int('measurement · intervals', `It takes ${per * (a - 1)} minutes to walk up from the 1st floor to the ${ord(a)} floor of a building. At the same pace, how many minutes does it take to walk up from the 1st floor to the ${ord(c)} floor?`, per * (c - 1)), [
        `From the 1st floor to the ${ord(a)} floor is ${a - 1} flights of stairs, not ${a}.`,
        `${per * (a - 1)} ÷ ${a - 1} = ${per} minutes for each flight.`,
        `From the 1st floor to the ${ord(c)} floor is ${c - 1} flights: ${c - 1} × ${per} = ${per * (c - 1)}.`,
        `So it takes ${per * (c - 1)} minutes.`,
      ], 'Count the gaps between floors, not the floors.');
    }
    if (kind === 2) {
      const [w] = names(1), s = ri(1, 9) * 60 + ri(1, 11) * 5, d = ri(4, 18) * 5;
      return explain(int('measurement · time', `${w} starts reading at ${hm(s)} and stops at ${hm(s + d)}. For how many minutes does ${w} read?`, d), [
        ...between(s, s + d),
        `So ${w} reads for ${d} minutes.`,
      ], 'Count to the next full hour first, then the rest.');
    }
    const [w] = names(1), it = pick(['sticker', 'marble', 'sweet', 'balloon', 'pencil', 'shell', 'stamp']), n = ri(2, 5), p = ri(1, 4) * 5, x = n * p + ri(5, 60);
    return explain(int('measurement · money', `${w} has ${x} cents and buys ${n} ${it}s at ${p} cents each. How many cents does ${w} have left?`, x - n * p), [
      `The ${it}s cost ${n} × ${p} = ${n * p} cents.`,
      `${x} − ${n * p} = ${x - n * p}.`,
      `So ${w} has ${x - n * p} cents left.`,
    ], 'Find the total cost first, then take it away.');
  }
  if (mid(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const D = ri(10, 25), up = ri(3, 5), slip = ri(1, up - 1), per = pick([10, 15, 20]), n = frog(D, up, slip);
      return explain(int('measurement · frog in a well', `A frog is at the bottom of a well ${D} m deep. Every ${per} minutes it climbs ${up} m, then slips back ${slip} m before the next climb. After how many minutes does it reach the top?`, n * per), frogSteps(D, up, slip, n, per), FROG_TIP);
    }
    if (kind === 2) {
      const gap = pick([4, 5, 6, 8, 10, 12, 15]), n = ri(8, 60);
      return explain(int('measurement · intervals', `Trees are planted along one side of a ${gap * n} m road, ${gap} m apart, with a tree at each end. How many trees are there?`, n + 1), [
        `The road has ${gap * n} ÷ ${gap} = ${n} gaps between trees.`,
        `With a tree at each end there is one more tree than gaps: ${n} + 1 = ${n + 1}.`,
        `So there are ${n + 1} trees.`,
      ], 'Along a line with a tree at each end: trees = gaps + 1.');
    }
    if (kind === 3) {
      const a = ri(2, 5), b = ri(2, 4), wa = ri(10, 20) * 10, wp = ri(10, 25) * 10, T = a * wa + b * wp;
      return explain(int('measurement · mass', `${a} apples and ${b} pears together weigh ${T} g. Each apple weighs ${wa} g. How much does each pear weigh, in grams?`, wp), [
        `The apples weigh ${a} × ${wa} = ${a * wa} g.`,
        `The pears weigh ${T} − ${a * wa} = ${b * wp} g.`,
        `${b * wp} ÷ ${b} = ${wp}. So each pear weighs ${wp} g.`,
      ], 'Take away what you know, then share what is left.');
    }
    const v = pick([40, 50, 60, 70, 80, 90]), t = ri(2, 4), t2 = ri(5, 9);
    return explain(int('measurement · speed', `A train travels ${v * t} km in ${t} hours. At the same speed, how far does it travel in ${t2} hours?`, v * t2), [
      `In 1 hour it travels ${v * t} ÷ ${t} = ${v} km.`,
      `In ${t2} hours: ${v} × ${t2} = ${v * t2}.`,
      `So it travels ${v * t2} km.`,
    ], 'Find how far it goes in 1 hour first.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const p = pick([200, 250, 300, 350, 400, 500]), d1 = pick([10, 12, 15, 20]), d2 = pick([5, 10]), v = p * (1 - d1 / 100) * (1 - d2 / 100); if (Math.round(v * 100) / 100 !== Math.round(v * 1000) / 1000) return null; const r2 = (x) => Math.round(x * 100) / 100, cut1 = r2((p * d1) / 100), p1 = r2(p - cut1), cut2 = r2((p1 * d2) / 100);
    return explain(dec('measurement · percentages', `A bike is priced at $${p}. The price is cut by ${d1}%, and then the new price is cut by another ${d2}%. What is the final price, in dollars?`, v), [
      `First cut: ${d1}% of ${p} = ${p} × ${d1} ÷ 100 = ${cut1}, so the price becomes ${p} − ${cut1} = ${p1}.`,
      `Second cut: ${d2}% of ${p1} = ${cut2}, so the price becomes ${p1} − ${cut2} = ${r2(v)}.`,
      `So the final price is ${r2(v)} dollars.`,
    ], 'The second cut is taken from the new price, not the original.');
  }
  if (kind === 2) {
    const a = pick([100, 200, 300, 400]), b = pick([100, 200, 300, 600]), pp = ri(10, 40), q = ri(10, 60), v = (a * pp + b * q) / (a + b); if (!Number.isInteger(v) || pp === q) return null;
    return explain(int('measurement · mixtures', `${a} mL of a ${pp}% sugar solution is mixed with ${b} mL of a ${q}% sugar solution. What percentage of the mixture is sugar?`, v), [
      `Sugar in the first: ${pp}% of ${a} mL = ${(a * pp) / 100} mL.`,
      `Sugar in the second: ${q}% of ${b} mL = ${(b * q) / 100} mL.`,
      `Altogether ${(a * pp + b * q) / 100} mL of sugar in ${a + b} mL: ${(a * pp + b * q) / 100} ÷ ${a + b} × 100 = ${v}%.`,
      `So ${v}% of the mixture is sugar.`,
    ], 'Find the actual amount of sugar in each, add, then turn it back into a percentage.');
  }
  const N = 4 * ri(4, 20), p = ri(2, N / 2 - 1), q = N + 1 - p;
  return explain(int('measurement · pages', `A booklet is made of sheets folded in half. Pages ${p} and ${q} are printed on the same side of one sheet, one on the left half and one on the right. How many pages does the booklet have?`, N), [
    `On any sheet, the two page numbers side by side add up to the same total: the first and last pages together, 1 + the last page.`,
    `${p} + ${q} = ${N + 1}, so the last page is ${N + 1} − 1 = ${N}.`,
    `So the booklet has ${N} pages.`,
  ], 'In a folded booklet, the two pages on one side of a sheet add up to the number of pages plus 1.');
};
// ---- Statistics and Probability ----
const FRUITS = ['Mango', 'Banana', 'Apple', 'Grapes', 'Orange'];
const DICE = [
  ['the two numbers add up to an even number', 18, 'The sum is even when both dice are odd (3 × 3 = 9 pairs) or both even (9 pairs): 18 pairs.'],
  ['the two numbers are the same', 6, 'The same number on both: (1,1), (2,2), (3,3), (4,4), (5,5), (6,6): 6 pairs.'],
  ['the two numbers add up to 7', 6, 'Adding to 7: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1): 6 pairs.'],
  ['both numbers are even', 9, 'Both even: each die shows 2, 4 or 6, so 3 × 3 = 9 pairs.'],
  ['both numbers are prime', 9, 'Both prime: each die shows 2, 3 or 5, so 3 × 3 = 9 pairs.'],
  ['the two numbers add up to 10', 3, 'Adding to 10: (4,6), (5,5), (6,4): 3 pairs.'],
];
const WORST = 'Think of the worst luck first, then one more.';
const spP1 = (y) => {
  const kids = shuffle(KIDS).slice(0, 4), what = pick(['books read', 'stickers', 'goals']);
  if (low(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const scale = pick([2, 3, 5]), vals = kids.map(() => ri(1, 6)); if (new Set(vals).size < 4) return null; const i = ri(0, 3);
      return explain(withFigure(int('statistics · graphs', `The picture graph shows the ${what} of four children. Each ⭐ stands for ${scale}. How many ${what.split(' ')[0]} does ${kids[i]} have?`, vals[i] * scale), table(cap(what), ['Name', cap(what)], kids.map((n, k) => [n, '⭐'.repeat(vals[k])]))), [
        `${kids[i]} has ${vals[i]} star${vals[i] === 1 ? '' : 's'} in the graph.`,
        `Each star stands for ${scale}: ${vals[i]} × ${scale} = ${vals[i] * scale}.`,
        `So ${kids[i]} has ${vals[i] * scale} ${what.split(' ')[0]}.`,
      ], 'Always check what one picture stands for before counting.');
    }
    if (kind === 2) {
      const r = ri(1, 6), b = ri(1, 6), cols = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 2); if (r === b) return null; const right = r > b ? `${cols[0]} is more likely` : `${cols[1]} is more likely`;
      return explain(mcOnly('probability · chance', `A bag has ${r} ${cols[0]} and ${b} ${cols[1]} marbles. One is taken without looking. Which is true?`, right, [r > b ? `${cols[1]} is more likely` : `${cols[0]} is more likely`, 'both are equally likely', 'it cannot be told']), [
        `There are ${r} ${cols[0]} and ${b} ${cols[1]} marbles: more ${r > b ? cols[0] : cols[1]} than ${r > b ? cols[1] : cols[0]}.`,
        `The colour with more marbles has more chances of being picked.`,
        `So the true statement is: ${right}.`,
      ], 'More of a colour means more likely; the same number means equally likely.');
    }
    const fruits = shuffle(FRUITS).slice(0, 4), counts = fruits.map(() => ri(2, 12)); if (new Set(counts).size < 4) return null; const fig = table('Favourite fruit', ['Fruit', 'Children'], fruits.map((f, k) => [f, counts[k]]));
    if (kind === 3) {
      const ask = pick(['most', 'least']), target = fruits[counts.indexOf(ask === 'most' ? Math.max(...counts) : Math.min(...counts))];
      return explain(withFigure(mcOnly('statistics · tables', `The table shows the favourite fruit of the children in a class. Which fruit is the ${ask} popular?`, target, fruits.filter((f) => f !== target)), fig), [
        `Read the table: ${fruits.map((f, k) => `${f} ${counts[k]}`).join(', ')}.`,
        `The ${ask === 'most' ? 'biggest' : 'smallest'} number is ${ask === 'most' ? Math.max(...counts) : Math.min(...counts)}, for ${target}.`,
        `So ${target} is the ${ask} popular.`,
      ], 'Find the biggest or smallest number first, then read its label.');
    }
    const [hi, lo] = shuffle([0, 1, 2, 3]).slice(0, 2).sort((p, q) => counts[q] - counts[p]);
    return explain(withFigure(int('statistics · comparing', `The table shows the favourite fruit of the children in a class. How many more children chose ${fruits[hi]} than ${fruits[lo]}?`, counts[hi] - counts[lo]), fig), [
      `${fruits[hi]}: ${counts[hi]} children. ${fruits[lo]}: ${counts[lo]} children.`,
      `${counts[hi]} − ${counts[lo]} = ${counts[hi] - counts[lo]}.`,
      `So ${counts[hi] - counts[lo]} more children chose ${fruits[hi]}.`,
    ], '"How many more" means take the smaller number from the bigger one.');
  }
  if (mid(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const vals = kids.map(() => ri(2, 30)); if (new Set(vals).size < 4) return null; const hi = vals.indexOf(Math.max(...vals)), lo = vals.indexOf(Math.min(...vals));
      return explain(withFigure(int('statistics · graphs', `The bar graph shows the ${what} of four children. How many more does ${kids[hi]} have than ${kids[lo]}?`, vals[hi] - vals[lo]), bars(cap(what), null, kids.map((n, k) => [n, vals[k]]))), [
        `Read the bars: ${kids[hi]} has ${vals[hi]}, the most, and ${kids[lo]} has ${vals[lo]}, the least.`,
        `${vals[hi]} − ${vals[lo]} = ${vals[hi] - vals[lo]}.`,
        `So ${kids[hi]} has ${vals[hi] - vals[lo]} more than ${kids[lo]}.`,
      ], '"How many more" means take the smaller number from the bigger one.');
    }
    if (kind === 2) {
      const parts = pick([[35, 20, 25, 20], [40, 25, 20, 15], [30, 30, 25, 15], [45, 25, 20, 10]]), labels = ['Food', 'Rent', 'Travel', 'Fun'], total = pick([1000, 2000, 4000]), i = ri(0, 1), j = ri(2, 3), pct = parts[i] + parts[j];
      return explain(withFigure(int('statistics · pie charts', `The pie chart shows how a family spent $${total} in a month. How much went on ${labels[i]} and ${labels[j]} together, in dollars?`, (pct * total) / 100), pie('Monthly spending', labels.map((l, k) => [l, parts[k]]))), [
        `${labels[i]} is ${parts[i]}% and ${labels[j]} is ${parts[j]}%: together ${parts[i]} + ${parts[j]} = ${pct}%.`,
        `${pct}% of $${total} = ${total} ÷ 100 × ${pct} = ${(pct * total) / 100}.`,
        `So ${(pct * total) / 100} dollars went on ${labels[i]} and ${labels[j]}.`,
      ], 'Add the percentages first, then take that percentage of the total.');
    }
    if (kind === 3) {
      const [w] = names(1), m = ri(50, 80), a = ri(m - 10, m + 10), b = ri(m - 10, m + 10), c = 3 * m - a - b;
      return explain(int('statistics · average', `${w} scored ${a}, ${b} and ${c} in three tests. What was ${w}'s mean score?`, m), [
        `Add the scores: ${a} + ${b} + ${c} = ${3 * m}.`,
        `Share the total equally among the 3 tests: ${3 * m} ÷ 3 = ${m}.`,
        `So the mean score is ${m}.`,
      ], 'Mean = total ÷ how many.');
    }
    const cs = shuffle([['red', ri(1, 5)], ['blue', ri(1, 5)], ['green', ri(1, 5)]]); if (new Set(cs.map((c) => c[1])).size < 3) return null; const ask = pick(['most', 'least']), best = cs.reduce((p, q) => (ask === 'most' ? (q[1] > p[1] ? q : p) : (q[1] < p[1] ? q : p)));
    return explain(mcOnly('probability · chance', `A spinner is divided into ${sum(cs.map((c) => c[1]))} equal parts: ${cs[0][1]} ${cs[0][0]}, ${cs[1][1]} ${cs[1][0]} and ${cs[2][1]} ${cs[2][0]}. Which colour is the spinner ${ask} likely to land on?`, best[0], [...cs.filter((c) => c !== best).map((c) => c[0]), 'all the same']), [
      `All the parts are the same size, so more parts means more likely.`,
      `The ${ask === 'most' ? 'biggest' : 'smallest'} number of parts is ${best[1]}: ${best[0]}.`,
      `So it is ${ask} likely to land on ${best[0]}.`,
    ], 'With equal parts, just compare how many parts each colour has.');
  }
  const kind = ri(1, 3);
  if (kind === 1) {
    const xs = Array.from({ length: 5 }, () => ri(3, 40)).sort((p, q) => p - q);
    return explain(int('statistics · median', `What is the median of ${shuffle(xs).join(', ')}?`, xs[2]), [
      `Put the numbers in order: ${xs.join(', ')}.`,
      `The median is the middle one, the 3rd of the 5: ${xs[2]}.`,
      `So the median is ${xs[2]}.`,
    ], 'Order first; the median is the middle number.');
  }
  if (kind === 2) {
    const vals = kids.map(() => ri(5, 30)); if (new Set(vals).size < 4 || sum(vals) % 4) return null;
    return explain(withFigure(int('statistics · average', `The bar graph shows the ${what} of four children. What is the mean number per child?`, sum(vals) / 4), bars(cap(what), null, kids.map((n, k) => [n, vals[k]]))), [
      `Read the bars: ${kids.map((n, k) => `${n} ${vals[k]}`).join(', ')}.`,
      `Total: ${vals.join(' + ')} = ${sum(vals)}.`,
      `Mean = ${sum(vals)} ÷ 4 = ${sum(vals) / 4}. So the mean is ${sum(vals) / 4}.`,
    ], 'Mean = total ÷ how many.');
  }
  const parts = pick([[35, 20, 25, 20], [40, 25, 20, 15], [30, 30, 25, 15]]), labels = ['Food', 'Rent', 'Travel', 'Fun'], total = pick([1200, 2400, 3600]), i = ri(0, 3);
  return explain(withFigure(int('statistics · pie charts', `The pie chart shows how a family spent $${total} in a month. How much went on ${labels[i]}, in dollars?`, (parts[i] * total) / 100), pie('Monthly spending', labels.map((l, k) => [l, parts[k]]))), [
    `${labels[i]} is ${parts[i]}% of $${total}.`,
    `${total} ÷ 100 × ${parts[i]} = ${(parts[i] * total) / 100}.`,
    `So ${(parts[i] * total) / 100} dollars went on ${labels[i]}.`,
  ], 'A percentage of a total: divide by 100, then multiply.');
};
const spP2 = (y) => {
  if (low(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const cs = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, ri(2, 3)), counts = cs.map(() => ri(3, 9));
      return explain(int('probability · pigeonhole', `A bag has ${bagOf(cs, counts, 'marbles')}. Without looking, what is the smallest number you must take out to be sure of two of the same colour?`, cs.length + 1), [
        `The worst luck: the first ${cs.length} marbles are all different colours, one of each.`,
        `The next marble must match one of them: ${cs.length} + 1 = ${cs.length + 1}.`,
        `So you must take out ${cs.length + 1} marbles.`,
      ], WORST);
    }
    if (kind === 2) {
      const [w] = names(1), a = ri(2, 5), b = ri(2, 4);
      return explain(int('probability · counting outcomes', `${w} has ${a} T-shirts and ${b} pairs of shorts. How many different outfits of one T-shirt and one pair of shorts can ${w} wear?`, a * b), [
        `For each of the ${a} T-shirts there are ${b} choices of shorts.`,
        `${a} × ${b} = ${a * b}.`,
        `So ${w} can wear ${a * b} different outfits.`,
      ], 'Choices for one thing × choices for the other.');
    }
    const kids = shuffle(KIDS).slice(0, 4), what = pick(['books read', 'stickers', 'goals']), scale = pick([2, 3, 5]), vals = kids.map(() => ri(1, 6)); if (new Set(vals).size < 4) return null;
    return explain(withFigure(int('statistics · picture graphs', `The picture graph shows the ${what} of four children. Each ⭐ stands for ${scale}. How many ${what.split(' ')[0]} do the four children have altogether?`, sum(vals) * scale), table(cap(what), ['Name', cap(what)], kids.map((n, k) => [n, '⭐'.repeat(vals[k])]))), [
      `Count all the stars: ${vals.join(' + ')} = ${sum(vals)}.`,
      `Each star stands for ${scale}: ${sum(vals)} × ${scale} = ${sum(vals) * scale}.`,
      `So the four children have ${sum(vals) * scale} ${what.split(' ')[0]} altogether.`,
    ], 'Always check what one picture stands for before counting.');
  }
  if (mid(y)) {
    const kind = ri(1, 4);
    if (kind === 1) {
      const m = pick([13, 15, 17, 20]);
      return explain(int('probability · pigeonhole', `A pack has ${4 * m} cards, ${m} of each of 4 colours. Without looking, what is the smallest number of cards you must draw to be sure of at least one card of every colour?`, 3 * m + 1), [
        `The worst luck: you draw every card of 3 colours first, 3 × ${m} = ${3 * m} cards, and still have none of the 4th colour.`,
        `The next card must be that missing colour: ${3 * m} + 1 = ${3 * m + 1}.`,
        `So you must draw ${3 * m + 1} cards.`,
      ], WORST);
    }
    if (kind === 2) {
      const t = ri(3, 11), pairs = [], raw = []; for (let a = 1; a <= 6; a++) for (let c = 1; c <= 6; c++) if (a + c === t) { pairs.push(`(${a}, ${c})`); raw.push([a, c]); }
      return explain(int('probability · counting outcomes', `Two dice are rolled. In how many ways can the numbers add up to ${t}?`, pairs.length), [
        `List the pairs (first die, second die) that add up to ${t}: ${pairs.join(', ')}.`,
        `That is ${pairs.length} pairs; (${raw[0][0]}, ${raw[0][1]}) counts separately from (${raw[0][1]}, ${raw[0][0]}) because the dice are different.`,
        `So there are ${pairs.length} ways.`,
      ], 'List them in order of the first die so none is missed or counted twice.');
    }
    if (kind === 3) {
      const n = ri(3, 5), m = ri(10, 30), known = Array.from({ length: n - 1 }, () => ri(m - 8, m + 8)), x = n * m - sum(known); if (x < 1) return null;
      return explain(int('statistics · average', `The mean of ${n} numbers is ${m}. ${n - 1} of the numbers are ${known.join(', ')}. What is the other number?`, x), [
        `The total of the ${n} numbers is ${m} × ${n} = ${n * m}.`,
        `The known numbers add up to ${known.join(' + ')} = ${sum(known)}.`,
        `${n * m} − ${sum(known)} = ${x}. So the other number is ${x}.`,
      ], 'Mean × how many = the total.');
    }
    const r = ri(1, 9), b = ri(1, 9), g = gcd(r, r + b);
    return explain(frac('probability · fractions', `A bag has ${r} red and ${b} blue marbles. One is taken out without looking. What is the probability that it is red? Give a fraction in its simplest form.`, r, r + b), [
      `There are ${r} + ${b} = ${r + b} marbles altogether, and ${r} of them ${r === 1 ? 'is' : 'are'} red.`,
      `Probability = ${r}/${r + b}${g > 1 ? ` = ${fr(r, r + b)} in its simplest form` : ''}.`,
      `So the probability is ${fr(r, r + b)}.`,
    ], 'Probability = the ways you want ÷ all the ways.');
  }
  const kind = ri(1, 4);
  if (kind === 1) {
    const [e, f, why] = pick(DICE);
    return explain(frac('probability · fractions', `Two dice are rolled. What is the probability that ${e}? Give a fraction in its simplest form.`, f, 36), [
      `Two dice give 6 × 6 = 36 equally likely pairs.`,
      why,
      `Probability = ${f}/36 = ${fr(f, 36)}.`,
      `So the probability is ${fr(f, 36)}.`,
    ], 'Two dice make 36 pairs: count the pairs you want.');
  }
  if (kind === 2) {
    const n = ri(4, 8), avg = ri(10, 40), x = ri(avg + 1, avg + 30), nu = (n * avg + x) / (n + 1); if (!Number.isInteger(nu)) return null;
    return explain(int('statistics · average', `The mean of ${n} numbers is ${avg}. When ${x} is added to the list, what is the new mean?`, nu), [
      `The ${n} numbers add up to ${n} × ${avg} = ${n * avg}.`,
      `With ${x}: ${n * avg} + ${x} = ${n * avg + x}, and now there are ${n + 1} numbers.`,
      `${n * avg + x} ÷ ${n + 1} = ${nu}. So the new mean is ${nu}.`,
    ], 'Mean × how many = the total; work with totals.');
  }
  if (kind === 3) {
    const k = pick([3, 4]), zero = ri(0, 1) === 1, digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k); if (zero) digits[k - 1] = 0; digits.sort((p, q) => p - q); const ans = zero ? (k - 1) * (k - 1) * (k - 2) : k * (k - 1) * (k - 2);
    return explain(int('probability · arrangements', `How many different three-digit numbers can be made using the digits ${digits.join(', ')}, each at most once in a number?`, ans), zero ? [
      `The first digit cannot be 0: ${k - 1} choices.`,
      `The second digit: any of the ${k - 1} digits left, and 0 is allowed now.`,
      `The third digit: ${k - 2} choice${k - 2 === 1 ? '' : 's'} left.`,
      `${k - 1} × ${k - 1} × ${k - 2} = ${ans}. So ${ans} numbers can be made.`,
    ] : [
      `The first digit: ${k} choices. The second: ${k - 1} left. The third: ${k - 2} left.`,
      `${k} × ${k - 1} × ${k - 2} = ${ans}. So ${ans} numbers can be made.`,
    ], 'Multiply the choices for each place, and remember a number cannot start with 0.');
  }
  const [w] = names(1), n = ri(4, 6), xs = Array.from({ length: n }, () => ri(5, 60)), mx = Math.max(...xs), mn = Math.min(...xs); if (mx === mn) return null;
  return explain(int('statistics · range', `${w}'s scores in ${n} games were ${xs.join(', ')}. What is the range of the scores?`, mx - mn), [
    `The range is the biggest score minus the smallest.`,
    `Biggest ${mx}, smallest ${mn}: ${mx} − ${mn} = ${mx - mn}.`,
    `So the range is ${mx - mn}.`,
  ], 'Range = biggest − smallest.');
};
const spP3 = (y) => {
  if (low(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const cs = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 3), counts = cs.map(() => ri(4, 9));
      return explain(int('probability · pigeonhole', `A bag has ${bagOf(cs, counts, 'marbles')}. Without looking, what is the smallest number you must take out to be sure of three of the same colour?`, 2 * cs.length + 1), [
        `The worst luck: 2 of every colour first, ${cs.length} colours × 2 = ${2 * cs.length} marbles, and no colour has 3 yet.`,
        `The next marble makes 3 of one colour: ${2 * cs.length} + 1 = ${2 * cs.length + 1}.`,
        `So you must take out ${2 * cs.length + 1} marbles.`,
      ], WORST);
    }
    if (kind === 2) {
      const k = pick([3, 4]), twice = ri(0, 1) === 1, digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k).sort((p, q) => p - q), ans = twice ? k * k : k * (k - 1);
      return explain(int('probability · counting outcomes', `How many different two-digit numbers can be made using the digits ${digits.join(', ')}, ${twice ? 'if a digit may be used twice' : 'if the two digits must be different'}?`, ans), [
        `The tens digit: ${k} choices.`,
        twice ? `The ones digit: ${k} choices again, because a digit may be repeated.` : `The ones digit: ${k - 1} choices, because the tens digit cannot be used again.`,
        `${k} × ${twice ? k : k - 1} = ${ans}. So ${ans} two-digit numbers can be made.`,
      ], 'Count the choices for each place, then multiply.');
    }
    const kids = shuffle(KIDS).slice(0, 4), what = pick(['books read', 'stickers', 'goals']), scale = pick([2, 3, 5]), vals = kids.map(() => ri(1, 6)); if (new Set(vals).size < 4) return null; const [hi, lo] = shuffle([0, 1, 2, 3]).slice(0, 2).sort((p, q) => vals[q] - vals[p]);
    return explain(withFigure(int('statistics · comparing graphs', `The picture graph shows the ${what} of four children. Each ⭐ stands for ${scale}. How many more ${what.split(' ')[0]} does ${kids[hi]} have than ${kids[lo]}?`, (vals[hi] - vals[lo]) * scale), table(cap(what), ['Name', cap(what)], kids.map((n, k) => [n, '⭐'.repeat(vals[k])]))), [
      `${kids[hi]} has ${vals[hi]} stars and ${kids[lo]} has ${vals[lo]}: ${vals[hi]} − ${vals[lo]} = ${vals[hi] - vals[lo]} more stars.`,
      `Each star stands for ${scale}: ${vals[hi] - vals[lo]} × ${scale} = ${(vals[hi] - vals[lo]) * scale}.`,
      `So ${kids[hi]} has ${(vals[hi] - vals[lo]) * scale} more ${what.split(' ')[0]}.`,
    ], 'Compare the pictures first, then use the scale.');
  }
  if (mid(y)) {
    const kind = ri(1, 3);
    if (kind === 1) {
      const cs = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 3), counts = cs.map(() => ri(5, 40)); if (new Set(counts).size < 3) return null; const mi = counts.indexOf(Math.min(...counts)), others = [0, 1, 2].filter((k) => k !== mi);
      return explain(int('probability · pigeonhole', `A box has ${bagOf(cs, counts, 'balls')}. Without looking, what is the smallest number of balls you must take out to be sure of at least one ball of every colour?`, sum(counts) - Math.min(...counts) + 1), [
        `The worst luck: you take out every ${cs[others[0]]} and every ${cs[others[1]]} ball first, ${counts[others[0]]} + ${counts[others[1]]} = ${sum(counts) - counts[mi]}, and still have no ${cs[mi]}.`,
        `The next ball must be ${cs[mi]}: ${sum(counts) - counts[mi]} + 1 = ${sum(counts) - counts[mi] + 1}.`,
        `So you must take out ${sum(counts) - counts[mi] + 1} balls.`,
      ], WORST);
    }
    if (kind === 2) {
      const [w] = names(1), a = ri(2, 5), b = ri(2, 4), c = ri(2, 3);
      return explain(int('probability · counting outcomes', `${w} has ${a} T-shirts, ${b} pairs of shorts and ${c} caps. How many different outfits of one T-shirt, one pair of shorts and one cap can ${w} wear?`, a * b * c), [
        `T-shirt and shorts: ${a} × ${b} = ${a * b} ways.`,
        `Each of those with one of the ${c} caps: ${a * b} × ${c} = ${a * b * c}.`,
        `So ${w} can wear ${a * b * c} different outfits.`,
      ], 'Multiply the choices for each thing.');
    }
    const [w] = names(1), n = ri(3, 5), m = ri(60, 80), m2 = m + ri(1, 4), x = (n + 1) * m2 - n * m; if (x > 100) return null;
    return explain(int('statistics · average', `${w}'s mean score after ${n} tests is ${m}. What must ${w} score in the next test for the mean of all ${n + 1} tests to be ${m2}?`, x), [
      `${n} tests with a mean of ${m}: total so far ${n} × ${m} = ${n * m}.`,
      `For a mean of ${m2} over ${n + 1} tests, the total must be ${n + 1} × ${m2} = ${(n + 1) * m2}.`,
      `${(n + 1) * m2} − ${n * m} = ${x}. So ${w} must score ${x}.`,
    ], 'Mean × how many = the total; compare the two totals.');
  }
  const kind = ri(1, 4);
  if (kind === 1) {
    const a = ri(2, 4), b = ri(2, 4), tot = choose(a + b, 2);
    return explain(frac('probability · two draws', `A bag holds ${a} red and ${b} blue marbles. Two are taken out without looking. What is the probability that both are red? Give a fraction in its simplest form.`, (a * (a - 1)) / 2, tot), [
      `First marble: ${a} red out of ${a + b}, a chance of ${a}/${a + b}.`,
      `Second marble: ${a - 1} red left out of ${a + b - 1}, a chance of ${a - 1}/${a + b - 1}.`,
      `Both: ${a}/${a + b} × ${a - 1}/${a + b - 1} = ${a * (a - 1)}/${(a + b) * (a + b - 1)} = ${fr(a * (a - 1), (a + b) * (a + b - 1))}.`,
      `So the probability is ${fr(a * (a - 1), (a + b) * (a + b - 1))}.`,
    ], 'For two draws without putting back, the second chance uses one fewer marble.');
  }
  if (kind === 2) {
    const cs = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 4), counts = cs.map(() => ri(5, 40)), k = ri(3, 6); if (new Set(counts).size < 4) return null;
    return explain(int('probability · pigeonhole', `A box has ${bagOf(cs, counts, 'balls')}. Without looking, what is the smallest number of balls you must take out to be sure of ${k} balls of the same colour?`, 4 * (k - 1) + 1), [
      `The worst luck: ${k - 1} of every colour first, 4 × ${k - 1} = ${4 * (k - 1)} balls, and no colour has ${k} yet.`,
      `The next ball makes ${k} of one colour: ${4 * (k - 1)} + 1 = ${4 * (k - 1) + 1}.`,
      `So you must take out ${4 * (k - 1) + 1} balls.`,
    ], WORST);
  }
  if (kind === 3) {
    const a = ri(1, 8), b = ri(1, 8), c = ri(1, 8), T = a + b + c;
    return explain(frac('probability · complement', `A bag holds ${a} red, ${b} blue and ${c} green marbles. One is taken out without looking. What is the probability that it is not green? Give a fraction in its simplest form.`, a + b, T), [
      `Altogether ${a} + ${b} + ${c} = ${T} marbles.`,
      `Not green means red or blue: ${a} + ${b} = ${a + b} marbles.`,
      `Probability = ${a + b}/${T} = ${fr(a + b, T)}.`,
      `So the probability is ${fr(a + b, T)}.`,
    ], '"Not" one colour means all the other colours together.');
  }
  const nb = pick([10, 12, 15, 20]), ng = pick([10, 12, 15, 20]), mb = ri(50, 90), mg = ri(50, 90), mean = (nb * mb + ng * mg) / (nb + ng); if (mb === mg || !Number.isInteger(mean)) return null;
  return explain(int('statistics · combined average', `A class has ${nb} boys with a mean score of ${mb} and ${ng} girls with a mean score of ${mg}. What is the mean score of the whole class?`, mean), [
    `Boys' total: ${nb} × ${mb} = ${nb * mb}. Girls' total: ${ng} × ${mg} = ${ng * mg}.`,
    `Whole class: ${nb * mb} + ${ng * mg} = ${nb * mb + ng * mg} over ${nb} + ${ng} = ${nb + ng} children.`,
    `${nb * mb + ng * mg} ÷ ${nb + ng} = ${mean}. So the class mean is ${mean}.`,
  ], 'A combined mean comes from the totals, not from averaging the two means.');
};

// each strand carries a kind for each tier: Part 1 two-mark multiple choice, then three-mark and five-mark typed answers
const T = (cat, gen, ...sections) => ({ cat, gen, sections });
const POOL = [T('number sense', nsP1, 'P1'), T('number sense · 3', nsP2, 'P2'), T('number sense · 5', nsP3, 'P3'), T('geometry', geP1, 'P1'), T('geometry · 3', geP2, 'P2'), T('geometry · 5', geP3, 'P3'), T('pattern and algebra', paP1, 'P1'), T('pattern and algebra · 3', paP2, 'P2'), T('pattern and algebra · 5', paP3, 'P3'), T('measurement', meP1, 'P1'), T('measurement · 3', meP2, 'P2'), T('measurement · 5', meP3, 'P3'), T('statistics and probability', spP1, 'P1'), T('statistics and probability · 3', spP2, 'P2'), T('statistics and probability · 5', spP3, 'P3')];
// the real heat paper (the 2025 papers): 25 questions in 90 minutes — Part 1 ten 2-mark multiple choice of five options with
// "None of the above", Part 2 fifteen typed answers, 3 marks then 5. Split 25 + 35 + 30 (the owner, 20 Sep 2026)
export const PHASES = [phase('alpha', 'Part 1', 2, 25, slots([['P1', 'mc', 10]])), phase('beta', 'Part 2 · 3 marks', 3, 35, slots([['P2', 'sa', 10]])), phase('gamma', 'Part 2 · 5 marks', 5, 30, slots([['P3', 'sa', 5]]))];
// five choices with "None of the above", as the 2025 paper's Part 1 (the source check of 20 Sep 2026)
export const build = (shape, year) => buildHeat(shape, POOL, year, { options: 5, none: true });
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['Part 1, 2 marks: more than, remainders, a quarter of a pizza, sides altogether, patterns, beads in a row, number machines, o\'clock, coins, days of the week, picture graphs and tables', 'Part 2, 3 marks: balloons in a repeating pattern, odd numbers, making two equal, tiles on a board, stacked cubes, squares in a row, rule machines, working backwards, a frog in a well, ribbon left over, the calendar, outfits, two of a colour', 'Part 2, 5 marks: tens and ones taken away, pages with a digit, digits written, 1 to 20 in pairs, rectangles in a grid, a staircase of cubes, sticks, three sums, doubling back, floors, minutes read, cents left, three of a colour', 'five options, one of them “None of the above”'] },
  { band: 'Grades 3–4', lines: ['Part 1, 2 marks: fractions of a number, remainders, ratio, perimeter, angles, growing patterns, minutes, units, change, bar graphs, pie charts, a mean of three, spinners', 'Part 2, 3 marks: halves of quarters, meeting days, doubling, cupcakes, surface area, cutting squares, symbol equations, three sums, frogs, fence posts, clock hands, cards of every colour, dice sums, a missing number in a mean', 'Part 2, 5 marks: four numbers and their sums, shares by height, eggs in threes and fives, ages, painted cubes, strips of a square, star rules, which figure, undoing four steps, trees along a road, apples and pears, every colour, outfits, the next test', 'five options, one of them “None of the above”'] },
  { band: 'Grades 5–6', lines: ['Part 1, 2 marks: percentages, the greatest fraction, rectangles of an area, circles, volume, x, star rules, adding patterns, the minute hand, medians, pie charts', 'Part 2, 3 marks: LCM and HCF, rows of chairs, swapped digits, paths round gardens, painted cubes, isosceles triangles, L-shapes, star rules, frogs, average speed, two dice, a new mean, three-digit numbers, the range', 'Part 2, 5 marks: exactly three factors, divisible by either, books on shelves, corner cubes removed, glued blocks, a circle in a square, a stone in a tank, series', 'robots together, spending twice, two cuts in a price, mixtures, pages on a sheet, two draws, not green, boys and girls, the same colour k times'] },
];
