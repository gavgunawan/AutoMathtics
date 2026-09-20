// 🦬 DC-MOON — practice modelled on the AMC 8 (the American Mathematics Competitions 8, Mathematical Association of America,
// Washington DC); not affiliated. The owner's eighth moon (19 Sep 2026): the American paper a Year 4–6 child can actually sit —
// Grade 8 and below and under 14.5 years old, sat abroad through the MAA's official international partners. Twenty-five multiple-choice problems with
// five options in forty minutes, no penalty for a wrong answer, difficulty climbing with the problem number: the first five
// foundational, the last five the real test. Over the 2020–2023 papers word problems and arithmetic are the biggest slice, then
// geometry, then counting and probability, then data, number theory and algebra (the AoPS wiki's papers and keys; the source
// check of 20 Sep 2026). A heat is ten of them, five options each, in three
// climbing bands; Year 4 sits the warm-up and the middle, Years 5–6 the closing problems too.
// Every generator wraps its seed in explain(seed, steps, tip) — the worked solution in the child's method (STEPS.md, 20 Sep 2026):
// the AMC 8's algebra kinds may say "call the number n", but the working prefers working backwards, units, listing and patterns.
import { ri, pick, shuffle, sum, names, thing, money, int, frac, mcOnly, withFigure, grid, bars, buildHeat, slots, phase, explain, bar, factorsOf, digitsOf, lcm, gcd, ord, cap } from './common.mjs';

const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const countDown = (k) => Array.from({ length: k }, (_, i) => k - i);

// ---- warm-up (problems 1–5 of the real paper): one clean step ----
const unitPrice = () => {
  const per = pick([3, 4, 5, 6]), price = ri(2, 9), n = per * ri(2, 6), it = thing(), groups = n / per;
  return explain(int('word problems · rates', `A shop sells ${it}s at ${per} for ${money(price)}. How much do ${n} cost, in dollars?`, groups * price), [
    `${per} ${it}s cost $${price}, so first find how many groups of ${per} there are in ${n}.`,
    `${n} ÷ ${per} = ${groups} groups.`,
    `${groups} groups × $${price} = $${groups * price}.`,
    `So ${n} ${it}s cost ${groups * price} dollars.`,
  ], 'Find how many groups of the price size there are, then multiply by the price of one group.');
};
const percentOf = () => {
  const p = pick([10, 20, 25, 30, 40, 50, 60, 75]), t = pick([40, 60, 80, 120, 200, 240]); if ((t * p) % 100) return null;
  const v = (t * p) / 100;
  return explain(int('percentages', `What is ${p}% of ${t}?`, v), p === 50 ? [
    `50% is a half: ${t} ÷ 2 = ${v}.`,
    `So 50% of ${t} is ${v}.`,
  ] : p % 10 === 0 ? [
    `10% means 1 tenth: 10% of ${t} is ${t} ÷ 10 = ${t / 10}.`,
    p === 10 ? '' : `${p}% is ${p / 10} lots of 10%: ${p / 10} × ${t / 10} = ${v}.`,
    `So ${p}% of ${t} is ${v}.`,
  ] : [
    `25% is a quarter: ${t} ÷ 4 = ${t / 4}.`,
    p === 25 ? `So 25% of ${t} is ${v}.` : `75% is 3 quarters: 3 × ${t / 4} = ${v}.`,
    p === 25 ? '' : `So 75% of ${t} is ${v}.`,
  ], 'Find 10% (divide by 10) or 25% (divide by 4) first, then build the percentage you need.');
};
const meanOf = () => {
  const xs = Array.from({ length: pick([4, 5]) }, () => ri(3, 40)), t = sum(xs); if (t % xs.length) return null;
  return explain(int('statistics · mean', `What is the mean (average) of ${xs.join(', ')}?`, t / xs.length), [
    'Mean = total ÷ how many numbers there are.',
    `Total: ${xs.join(' + ')} = ${t}.`,
    `There are ${xs.length} numbers: ${t} ÷ ${xs.length} = ${t / xs.length}.`,
    `So the mean is ${t / xs.length}.`,
  ], 'Mean: add them all, then share equally by dividing by how many there are.');
};
const orderOps = () => {
  const a = ri(2, 9), b = ri(2, 9), c = ri(2, 9), d = ri(1, 9);
  return explain(int('arithmetic · order of operations', `What is the value of ${a} + ${b} × ${c} − ${d}?`, a + b * c - d), [
    `Multiply before adding or subtracting: ${b} × ${c} = ${b * c}.`,
    `Then work left to right: ${a} + ${b * c} = ${a + b * c}.`,
    `${a + b * c} − ${d} = ${a + b * c - d}.`,
    `So the value is ${a + b * c - d}.`,
  ], 'Order of operations: brackets first, then × and ÷, then + and − from left to right.');
};
const consecutive = () => {
  const n = pick([3, 4, 5]), first = ri(4, 40), s = n * first + (n * (n - 1)) / 2, last = first + n - 1, extras = (n * (n - 1)) / 2, run = Array.from({ length: n }, (_, i) => first + i);
  return explain(int('algebra · consecutive numbers', `The sum of ${n} consecutive whole numbers is ${s}. What is the largest of them?`, last), n % 2 ? [
    `${n} consecutive numbers are evenly spaced, so the middle one is their mean: ${s} ÷ ${n} = ${s / n}.`,
    `The largest is ${(n - 1) / 2} more than the middle one: ${s / n} + ${(n - 1) / 2} = ${last}.`,
    `Check: ${run.join(' + ')} = ${s}.`,
    `So the largest number is ${last}.`,
  ] : [
    `Call the smallest number the start; the others are ${Array.from({ length: n - 1 }, (_, i) => `start + ${i + 1}`).join(', ')}.`,
    `The extras add to ${Array.from({ length: n - 1 }, (_, i) => i + 1).join(' + ')} = ${extras}, so ${n} × start = ${s} − ${extras} = ${n * first}.`,
    `start = ${n * first} ÷ ${n} = ${first}, so the numbers are ${run.join(', ')}.`,
    `So the largest number is ${last}.`,
  ], 'For an odd count of consecutive numbers, the middle one is the sum ÷ the count.');
};
const perimeterQ = () => {
  const l = ri(4, 30), w = ri(2, l - 1);
  return explain(int('geometry · perimeter', `A rectangle has an area of ${l * w} square units and a width of ${w} units. What is its perimeter?`, 2 * (l + w)), [
    `Length = area ÷ width = ${l * w} ÷ ${w} = ${l}.`,
    `Perimeter = 2 × (length + width) = 2 × (${l} + ${w}) = 2 × ${l + w} = ${2 * (l + w)}.`,
    `So the perimeter is ${2 * (l + w)} units.`,
  ], 'The area gives you the missing side: divide the area by the side you know.');
};
const timeToFill = () => {
  const rate = pick([3, 4, 5, 6, 8]), mins = ri(4, 15);
  return explain(int('word problems · filling', `A tap fills a tank at ${rate} litres a minute. How many minutes does it take to fill a ${rate * mins}-litre tank?`, mins), [
    `Every minute adds ${rate} litres, so count how many lots of ${rate} make ${rate * mins}.`,
    `${rate * mins} ÷ ${rate} = ${mins}.`,
    `So it takes ${mins} minutes.`,
  ], 'Time = amount ÷ rate.');
};
const fractionOfFraction = () => {
  const [a, b] = pick([[1, 2], [1, 3], [2, 3], [3, 4], [1, 4], [2, 5]]), [c, d] = pick([[1, 2], [2, 3], [3, 4], [3, 5], [4, 5]]), g = gcd(a * c, b * d);
  return explain(frac('fractions', `What is ${a}/${b} of ${c}/${d}? Give the answer in its simplest form.`, a * c, b * d), [
    `"Of" means multiply: ${a}/${b} × ${c}/${d}.`,
    `Multiply the tops and multiply the bottoms: ${a} × ${c} = ${a * c} and ${b} × ${d} = ${b * d}, giving ${a * c}/${b * d}.`,
    g > 1 ? `Divide the top and the bottom by ${g}: ${(a * c) / g}/${(b * d) / g}.` : `${a * c}/${b * d} is already in its simplest form.`,
    `So the answer is ${(a * c) / g}/${(b * d) / g}.`,
  ], '"Of" means multiply: tops together, bottoms together, then simplify.');
};
// ---- middle (problems 6–15): two steps, a trap or a model ----
const percentTrap = () => {
  const p = pick([100, 200, 400, 500]), up = pick([10, 20, 25, 50]); const after = (p * (100 + up) / 100) * ((100 - up) / 100); if (!Number.isInteger(after)) return null;
  const rise = (p * up) / 100, mid = p + rise, cut = (mid * up) / 100;
  return explain(int('percentages · up then down', `The price of a bag is ${money(p)}. It is raised by ${up}% and then the new price is cut by ${up}%. What is the final price, in dollars?`, after), [
    `Up ${up}%: ${up}% of ${p} is ${rise}, so the price becomes ${p} + ${rise} = ${mid}.`,
    `Down ${up}% of the new price: ${up}% of ${mid} is ${cut}, so it becomes ${mid} − ${cut} = ${after}.`,
    `The cut is ${up}% of a bigger number than the rise was, so the price does not come back to ${p}.`,
    `So the final price is ${after} dollars.`,
  ], 'Up x% then down x% never gets back to the start: the second change is x% of a different amount.');
};
const ratioQ = () => {
  const a = ri(2, 5), b = ri(a + 1, 9), u = ri(3, 12);
  return explain(int('ratio', `The ratio of boys to girls in a choir is ${a} : ${b}. There are ${b * u} girls. How many children are in the choir?`, (a + b) * u), [
    bar('Boys', a),
    bar('Girls', b, String(b * u)),
    `${b} units = ${b * u}, so 1 unit = ${b * u} ÷ ${b} = ${u}.`,
    `All the children are ${a} + ${b} = ${a + b} units: ${a + b} × ${u} = ${(a + b) * u}.`,
    `So there are ${(a + b) * u} children in the choir.`,
  ], 'In a ratio problem, find what 1 unit is worth first.');
};
const divisorsCount = () => {
  const n = pick([36, 48, 60, 72, 84, 90, 96, 100, 120, 144]), fs = factorsOf(n), pairs = fs.filter((p) => p * p <= n).map((p) => [p, n / p]), sq = pairs.at(-1)[0] === pairs.at(-1)[1];
  return explain(int('number theory · divisors', `How many positive divisors does ${n} have?`, fs.length), [
    `List the factor pairs that multiply to ${n}, starting from 1, until the pairs would start to repeat.`,
    `${pairs.map(([p, q]) => `${p} × ${q}`).join(', ')}.`,
    sq ? `${pairs.length} pairs, but ${pairs.at(-1)[0]} × ${pairs.at(-1)[0]} uses the same number twice: ${2 * pairs.length} − 1 = ${fs.length} divisors.` : `${pairs.length} pairs, each of 2 different numbers: ${pairs.length} × 2 = ${fs.length} divisors.`,
    `So ${n} has ${fs.length} positive divisors.`,
  ], 'Factors come in pairs that multiply to the number; stop when the pairs start to repeat.');
};
// a units digit is a digit: the decoys are too
const unitsDigit = () => {
  const base = pick([2, 3, 7, 8, 9]), cyc = { 2: [2, 4, 8, 6], 3: [3, 9, 7, 1], 7: [7, 9, 3, 1], 8: [8, 4, 2, 6], 9: [9, 1] }[base], n = ri(20, 99); const v = cyc[(n - 1) % cyc.length], r = n % cyc.length;
  return explain(int('number theory · units digit', `What is the units digit of ${base}^${n} (${base} to the power ${n})?`, v, { decoys: shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => d !== v)).slice(0, 4) }), [
    `Look at the last digit of ${base}, ${base}², ${base}³, …: ${cyc.join(', ')}, then it repeats every ${cyc.length} powers.`,
    `${n} ÷ ${cyc.length} = ${Math.floor(n / cyc.length)} remainder ${r}.`,
    r ? `A remainder of ${r} means the ${ord(r)} digit of the pattern: ${v}.` : `A remainder of 0 means the last digit of the pattern: ${v}.`,
    `So the units digit of ${base}^${n} is ${v}.`,
  ], 'Last digits of powers repeat in a short cycle: divide the power by the cycle length and use the remainder.');
};
const lcmWords = () => {
  const a = pick([4, 6, 8, 9, 10, 12]), b = pick([6, 8, 9, 10, 14, 15]); if (a === b) return null;
  const L = lcm(a, b), mults = (k) => { const m = []; for (let x = k; x <= L; x += k) m.push(x); return m.length > 8 ? `${m.slice(0, 6).join(', ')}, …, ${L}` : m.join(', '); };
  return explain(int('number theory · LCM', `Two runners circle a track: one lap takes ${a} minutes for the first and ${b} minutes for the second. They start together. After how many minutes are they next at the start together?`, L), [
    `The first runner is at the start after ${a}, ${2 * a}, ${3 * a}, … minutes; the second after ${b}, ${2 * b}, ${3 * b}, … minutes.`,
    `Multiples of ${a}: ${mults(a)}.`,
    `Multiples of ${b}: ${mults(b)}.`,
    `The first number in both lists is ${L}.`,
    `So they are next at the start together after ${L} minutes.`,
  ], 'Together again means the lowest common multiple: list the multiples until one number is in both lists.');
};
// all digits odd: five choices each; first digit fixed and the others even (0, 2, 4, 6, 8): five choices for each other digit — the source check found 20 and 100 stored here
const digitsAllOdd = () => {
  const k = pick([2, 3]), from = pick([1, 5, 7]); const n = from === 1 ? 5 ** k : 5 ** (k - 1);
  return explain(int('counting · digits', from === 1 ? `How many ${k}-digit whole numbers have all their digits odd?` : `How many ${k}-digit whole numbers start with ${from} and have all their other digits even?`, n), from === 1 ? [
    'The odd digits are 1, 3, 5, 7, 9: 5 choices for every place.',
    `${k} places with 5 choices each: ${Array(k).fill(5).join(' × ')} = ${n}.`,
    `So there are ${n} such numbers.`,
  ] : [
    `The first digit must be ${from}: just 1 choice.`,
    `The even digits are 0, 2, 4, 6, 8: 5 choices for each of the other ${k - 1} place${k - 1 === 1 ? '' : 's'}.`,
    `1 × ${Array(k - 1).fill(5).join(' × ')} = ${n}.`,
    `So there are ${n} such numbers.`,
  ], 'Count the choices for each place, then multiply them together.');
};
const handshakes = () => {
  const n = ri(6, 14);
  return explain(int('counting · handshakes', `${n} people at a meeting each shake hands exactly once with everyone else. How many handshakes take place?`, (n * (n - 1)) / 2), [
    `Each of the ${n} people shakes hands with the other ${n - 1}: ${n} × ${n - 1} = ${n * (n - 1)}.`,
    `That counts every handshake twice, once from each end, so halve it: ${n * (n - 1)} ÷ 2 = ${(n * (n - 1)) / 2}.`,
    `So there are ${(n * (n - 1)) / 2} handshakes.`,
  ], 'Handshakes: n × (n − 1) ÷ 2, because each handshake is counted from both ends.');
};
const rectanglesInGrid = () => {
  const r = ri(2, 3), c = ri(3, 5), tri = (k) => (k * (k + 1)) / 2;
  return explain(withFigure(int('counting · geometry', `How many rectangles of every size (squares included) are there in this ${r} by ${c} grid of unit squares?`, choose(r + 1, 2) * choose(c + 1, 2)), grid('Count the rectangles', r, c)), [
    'A rectangle is fixed by choosing its span across and its span down.',
    `Across ${c} squares: ${c} spans of width 1, ${c - 1} of width 2, … 1 of width ${c}: ${countDown(c).join(' + ')} = ${tri(c)}.`,
    `Down ${r} squares: ${countDown(r).join(' + ')} = ${tri(r)}.`,
    `Every across span goes with every down span: ${tri(c)} × ${tri(r)} = ${tri(c) * tri(r)}.`,
    `So there are ${tri(c) * tri(r)} rectangles.`,
  ], 'Count the spans across and the spans down, then multiply.');
};
const triangleInRect = () => {
  const A = ri(6, 40) * 2;
  return explain(int('geometry · area', `A triangle has one side along the bottom of a rectangle of area ${A}, and its top vertex on the top side of the rectangle. What is the area of the triangle?`, A / 2), [
    'The triangle has the same base and the same height as the rectangle.',
    `Triangle area = ½ × base × height, which is half the rectangle: ${A} ÷ 2 = ${A / 2}.`,
    `So the area of the triangle is ${A / 2}.`,
  ], 'A triangle with the same base and height as a rectangle is half its area, wherever the top vertex sits.');
};
const polygonAngles = () => {
  const [name, n] = pick([['pentagon', 5], ['hexagon', 6], ['octagon', 8], ['decagon', 10]]);
  return explain(int('geometry · angles', `What is the sum of the interior angles of a ${name}, in degrees?`, (n - 2) * 180), [
    `Cut the ${name} into triangles from 1 corner: ${n} sides give ${n} − 2 = ${n - 2} triangles.`,
    `The angles of each triangle add to 180°: ${n - 2} × 180 = ${(n - 2) * 180}.`,
    `So the interior angles of a ${name} add to ${(n - 2) * 180} degrees.`,
  ], 'Angle sum of any polygon: (number of sides − 2) × 180°.');
};
const pythagoras = () => {
  const [a, b, c] = pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17]]), k = pick([1, 1, 2]);
  if (ri(1, 2) === 1) {
    return explain(int('geometry · right triangles', `A right triangle has legs of ${a * k} and ${b * k}. How long is its hypotenuse?`, c * k), [
      'In a right triangle, leg² + leg² = hypotenuse².',
      `${a * k}² + ${b * k}² = ${(a * k) ** 2} + ${(b * k) ** 2} = ${(c * k) ** 2}.`,
      `${c * k} × ${c * k} = ${(c * k) ** 2}, so the hypotenuse is ${c * k}.`,
      k > 1 ? `Quicker: ${a * k} and ${b * k} are ${k} × the ${a}-${b}-${c} triple, so the hypotenuse is ${k} × ${c} = ${c * k}.` : `Quicker: ${a}, ${b}, ${c} is a famous Pythagorean triple.`,
      `So the hypotenuse is ${c * k} units long.`,
    ], 'Learn the triples 3-4-5, 5-12-13 and 8-15-17 and their multiples; they save the squaring.');
  }
  return explain(int('geometry · right triangles', `A right triangle has a hypotenuse of ${c * k} and one leg of ${a * k}. How long is the other leg?`, b * k), [
    'In a right triangle, leg² + leg² = hypotenuse², so the other leg² = hypotenuse² − leg².',
    `${c * k}² − ${a * k}² = ${(c * k) ** 2} − ${(a * k) ** 2} = ${(b * k) ** 2}.`,
    `${b * k} × ${b * k} = ${(b * k) ** 2}, so the other leg is ${b * k}.`,
    k > 1 ? `Quicker: ${a * k} and ${c * k} are ${k} × the ${a}-${b}-${c} triple, so the other leg is ${k} × ${b} = ${b * k}.` : `Quicker: ${a}, ${b}, ${c} is a famous Pythagorean triple.`,
    `So the other leg is ${b * k} units long.`,
  ], 'Learn the triples 3-4-5, 5-12-13 and 8-15-17 and their multiples; they save the squaring.');
};
const median5 = () => {
  const xs = Array.from({ length: 5 }, () => ri(2, 50)).sort((p, q) => p - q), shown = shuffle(xs);
  return explain(int('statistics · median', `What is the median of ${shown.join(', ')}?`, xs[2]), [
    `Put the numbers in order: ${xs.join(', ')}.`,
    'The median is the middle one: with 5 numbers, the 3rd.',
    `So the median is ${xs[2]}.`,
  ], 'Median: sort first, then take the middle value.');
};
const dayAfter = () => {
  const d = ri(0, 6), n = ri(30, 200), r = (d + n) % 7, q = Math.floor(n / 7), rem = n % 7;
  return explain(mcOnly('logic · calendar', `Today is ${DAYS[d]}. What day of the week will it be ${n} days from today?`, DAYS[r], shuffle(DAYS.filter((_, i) => i !== r)).slice(0, 4)), [
    'Every 7 days it is the same weekday again, so only the remainder after dividing by 7 matters.',
    `${n} ÷ 7 = ${q} remainder ${rem}.`,
    rem ? `${rem} day${rem === 1 ? '' : 's'} after ${DAYS[d]} is ${DAYS[r]}.` : `A remainder of 0 means the same weekday: ${DAYS[r]}.`,
    `So it will be ${DAYS[r]}.`,
  ], 'Weekdays: divide the days by 7 and count on only the remainder.');
};
const circleArea = () => {
  const r = ri(3, 12);
  return explain(mcOnly('geometry · circles', `What is the area of a circle of radius ${r}?`, `${r * r}π`, [`${2 * r}π`, `${r * r * 2}π`, `${r * r}`, `${(r + 1) * (r + 1)}π`]), [
    'Area of a circle = π × radius × radius.',
    `π × ${r} × ${r} = ${r * r}π.`,
    `So the area is ${r * r}π.`,
  ], 'Area = πr² and circumference = 2πr; leave π in the answer unless a decimal is asked for.');
};
const barChartQ = () => {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], vals = labels.map(() => ri(2, 12) * 5), what = pick(['tickets sold', 'books borrowed', 'laps run']), t = sum(vals); if (t % 5) return null;
  return explain(withFigure(int('statistics · graphs', `The bar chart shows the ${what} on five days. What is the mean per day?`, t / 5), bars(cap(what), null, labels.map((l, i) => [l, vals[i]]))), [
    `Read the five bars: ${labels.map((l, i) => `${l} ${vals[i]}`).join(', ')}.`,
    `Total: ${vals.join(' + ')} = ${t}.`,
    `Mean = total ÷ 5 = ${t} ÷ 5 = ${t / 5}.`,
    `So the mean per day is ${t / 5}.`,
  ], 'Read the bars off carefully first; the mean is the total shared equally over the days.');
};
// ---- closing (problems 16–25): the real test ----
const diceSum = () => {
  const t = ri(4, 10); let n = 0; const pairs = []; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b === t) { n++; pairs.push(`(${a}, ${b})`); }
  const g = gcd(n, 36);
  return explain(frac('probability · dice', `Two fair dice are rolled. What is the probability that the two numbers add up to ${t}? Give a fraction in its simplest form.`, n, 36), [
    '2 dice give 6 × 6 = 36 equally likely results.',
    `Results adding to ${t}: ${pairs.join(', ')}, that is ${n} of them.`,
    `Probability = ${n}/36${g > 1 ? ` = ${n / g}/${36 / g}` : ''}.`,
    `So the probability is ${n / g}/${36 / g}.`,
  ], 'Dice: count the ordered pairs out of 36; (1, 4) and (4, 1) are different results.');
};
const twoMarbles = () => {
  const r = ri(2, 5), b = ri(2, 5), n = r + b, top = r * (r - 1), bot = n * (n - 1), g = gcd(top, bot);
  return explain(frac('probability · without replacement', `A bag holds ${r} red and ${b} blue marbles. Two are drawn without looking, one after the other and not put back. What is the probability that both are red? Give a fraction in its simplest form.`, top, bot), [
    `First marble red: ${r} of the ${n} marbles are red, so ${r}/${n}.`,
    `Then ${r - 1} red are left among ${n - 1} marbles: the second is red with probability ${r - 1}/${n - 1}.`,
    `Both red: ${r}/${n} × ${r - 1}/${n - 1} = ${top}/${bot}${g > 1 ? ` = ${top / g}/${bot / g}` : ''}.`,
    `So the probability is ${top / g}/${bot / g}.`,
  ], 'Without replacement: the second draw has 1 fewer on the top and 1 fewer on the bottom.');
};
const arrangements = () => {
  if (ri(1, 2) === 1) {
    const n = ri(4, 6), v = [1, 1, 2, 6, 24, 120, 720][n];
    return explain(int('counting · arrangements', `In how many different orders can ${n} different books be arranged on a shelf?`, v), [
      `The first place can hold any of the ${n} books, the next any of the ${n - 1} left, and so on down to 1.`,
      `${countDown(n).join(' × ')} = ${v}.`,
      `So there are ${v} different orders.`,
    ], 'Order matters: multiply the choices for each place, n × (n − 1) × … × 1.');
  }
  const n = ri(5, 8), v = choose(n, 3);
  return explain(int('counting · committees', `A committee of 3 is chosen from ${n} students. How many different committees are possible?`, v), [
    `Pick the 3 one at a time: ${n} × ${n - 1} × ${n - 2} = ${n * (n - 1) * (n - 2)} ordered picks.`,
    'Order does not matter in a committee, and the same 3 people can be picked in 3 × 2 × 1 = 6 orders.',
    `${n * (n - 1) * (n - 2)} ÷ 6 = ${v}.`,
    `So there are ${v} different committees.`,
  ], 'Order does not matter: multiply down, then divide by the ways to order the ones chosen.');
};
// square to square, as the figure shows it
const paths = () => {
  const [r, c] = pick([[3, 3], [3, 4], [2, 5], [4, 4], [3, 5]]), m = r + c - 2, k = Math.min(r - 1, c - 1), v = choose(r + c - 2, r - 1);
  const top = Array.from({ length: k }, (_, i) => m - i), bot = countDown(k);
  return explain(withFigure(int('counting · paths', `Moving only right or down from one square to the next, how many different routes lead from square A to square B in this ${r} by ${c} grid?`, v), grid('Routes A to B', r, c, { '0,0': 'A', [`${r - 1},${c - 1}`]: 'B' })), [
    `Every route goes right ${c - 1} times and down ${r - 1} times: ${m} moves in all.`,
    `A route is fixed by choosing which ${k} of the ${m} moves are ${k === r - 1 ? 'down' : 'right'}.`,
    `Ways to choose: (${top.join(' × ')}) ÷ (${bot.join(' × ')}) = ${v}.`,
    `Or write in each square how many ways reach it (the square above + the square to the left): B gets ${v}.`,
    `So there are ${v} different routes.`,
  ], 'Routes on a grid: label each square with the ways to reach it, adding the square above and the one to the left.');
};
const lShape = () => {
  const L = ri(8, 20), W = ri(6, 14), l = ri(2, L - 3), w = ri(2, W - 3);
  return explain(int('geometry · composite area', `An L-shaped region is a ${L} by ${W} rectangle with a ${l} by ${w} rectangle removed from one corner. What is its area?`, L * W - l * w), [
    `Whole rectangle: ${L} × ${W} = ${L * W}.`,
    `Corner removed: ${l} × ${w} = ${l * w}.`,
    `L-shape: ${L * W} − ${l * w} = ${L * W - l * w}.`,
    `So the area is ${L * W - l * w}.`,
  ], 'An L-shape is a rectangle with a corner missing: subtract the missing piece.');
};
const inclusionExclusion = () => {
  const n = ri(30, 50), both = ri(4, 12), onlyA = ri(5, 14), onlyB = ri(5, 14), neither = n - both - onlyA - onlyB; if (neither < 1) return null;
  const A = onlyA + both, B = onlyB + both;
  return explain(int('counting · inclusion-exclusion', `Of ${n} students, ${A} take art, ${B} take band, and ${neither} take neither. How many take both?`, both), [
    `Students taking at least one of the two: ${n} − ${neither} = ${n - neither}.`,
    `Adding the art and band numbers counts the "both" students twice: ${A} + ${B} = ${A + B}.`,
    `The extra is the overlap: ${A + B} − ${n - neither} = ${both}.`,
    `So ${both} students take both.`,
  ], 'Add the two groups, then subtract those in at least one: what is left over is the overlap.');
};
const meanShift = () => {
  const n = ri(4, 8), avg = ri(10, 40), x = ri(avg + 1, avg + 30), newAvg = (n * avg + x) / (n + 1); if (!Number.isInteger(newAvg)) return null;
  return explain(int('statistics · mean', `The mean of ${n} numbers is ${avg}. When the number ${x} is added to the list, what is the new mean?`, newAvg), [
    `The ${n} numbers add to ${n} × ${avg} = ${n * avg}.`,
    `With ${x} added: ${n * avg} + ${x} = ${n * avg + x}, over ${n + 1} numbers.`,
    `New mean = ${n * avg + x} ÷ ${n + 1} = ${newAvg}.`,
    `So the new mean is ${newAvg}.`,
  ], 'Mean × count = total; work with totals when a number is added or removed.');
};
const workBack = () => {
  const x = ri(5, 40), k = pick([2, 3, 4]), a = ri(3, 20);
  return explain(int('algebra · working backwards', `A number is multiplied by ${k}, then ${a} is added, and the result is doubled to give ${2 * (k * x + a)}. What is the number?`, x), [
    `Work backwards from ${2 * (k * x + a)}, undoing each step in reverse order.`,
    `Undo the doubling: ${2 * (k * x + a)} ÷ 2 = ${k * x + a}.`,
    `Undo adding ${a}: ${k * x + a} − ${a} = ${k * x}.`,
    `Undo multiplying by ${k}: ${k * x} ÷ ${k} = ${x}.`,
    `So the number is ${x}.`,
  ], 'Work backwards: do the opposite operations in the opposite order.');
};
const remainders = () => {
  const a = pick([3, 4, 5]), b = pick([5, 7]); if (a === b) return null; const ra = ri(1, a - 1), rb = ri(1, b - 1); let N = 1; while (N % a !== ra || N % b !== rb) N++;
  const cands = []; for (let x = rb; x <= N; x += b) cands.push(x);
  return explain(int('number theory · remainders', `What is the smallest positive integer that leaves a remainder of ${ra} when divided by ${a} and a remainder of ${rb} when divided by ${b}?`, N), [
    `Numbers that leave remainder ${rb} when divided by ${b}: ${rb}, ${rb + b}, ${rb + 2 * b}, … (going up in ${b}s).`,
    `Test each for remainder ${ra} when divided by ${a}: ${cands.map((x) => `${x} → ${x % a}`).join(', ')}.`,
    `The first that gives ${ra} is ${N}.`,
    `So the smallest such number is ${N}.`,
  ], 'List the numbers that fit the larger divisor, then test each one with the smaller divisor.');
};
const clockAngle = () => {
  const h = ri(1, 11), m = pick([0, 30]), angle = Math.abs(30 * h - 5.5 * m), ans = Math.min(angle, 360 - angle), hour = 30 * h + (m === 30 ? 15 : 0);
  return explain(int('geometry · clock angles', `What is the smaller angle between the hour hand and the minute hand of a clock at ${h}:${m === 0 ? '00' : '30'}, in degrees?`, ans), m === 0 ? [
    'The hour hand moves 360° ÷ 12 = 30° for every hour.',
    `At ${h}:00 the minute hand points to 12 and the hour hand to ${h}: ${h} × 30 = ${hour}° apart.`,
    hour > 180 ? `Going round the other way is 360 − ${hour} = ${360 - hour}°, which is smaller.` : '',
    `So the smaller angle is ${ans} degrees.`,
  ] : [
    'At 30 minutes the minute hand points to 6: 180° from the 12.',
    `The hour hand is halfway between ${h} and ${h + 1}: ${h} × 30 + 15 = ${hour}°.`,
    `Difference: ${Math.max(180, hour)} − ${Math.min(180, hour)} = ${angle}°.`,
    angle > 180 ? `Going round the other way is 360 − ${angle} = ${360 - angle}°, which is smaller.` : '',
    `So the smaller angle is ${ans} degrees.`,
  ], 'The hour hand moves 30° an hour, so 15° in half an hour; the minute hand moves 6° a minute.');
};
const speedAverage = () => {
  const d = pick([60, 120, 180, 240]), v1 = pick([30, 40, 60]), v2 = pick([20, 30, 40, 60]); if (v1 === v2) return null; const avg = (2 * v1 * v2) / (v1 + v2); if (!Number.isInteger(avg)) return null;
  const t1 = d / v1, t2 = d / v2;
  return explain(int('word problems · average speed', `A car drives ${d} km at ${v1} km/h and returns the same ${d} km at ${v2} km/h. What is its average speed for the whole trip, in km/h?`, avg), [
    'Average speed = total distance ÷ total time, not the average of the two speeds.',
    `Out: ${d} ÷ ${v1} = ${t1} h. Back: ${d} ÷ ${v2} = ${t2} h.`,
    `Total: ${2 * d} km in ${t1} + ${t2} = ${t1 + t2} h.`,
    `${2 * d} ÷ ${t1 + t2} = ${avg}.`,
    `So the average speed is ${avg} km/h.`,
  ], 'Average speed is total distance ÷ total time; there and back, it is always nearer the slower speed.');
};
const digitSumCount = () => {
  const s = ri(5, 14); let n = 0; const list = []; for (let k = 10; k <= 99; k++) if (sum(digitsOf(k)) === s) { n++; list.push(k); }
  return explain(int('number theory · digits', `How many two-digit whole numbers have digits that add up to ${s}?`, n), [
    `Tens digit + units digit = ${s}. Try each tens digit from 1 to 9 and see if the units digit, ${s} − tens, is between 0 and 9.`,
    `The ones that work: ${list.join(', ')}.`,
    `That is ${n} numbers.`,
    `So there are ${n} two-digit numbers whose digits add up to ${s}.`,
  ], 'Fix the tens digit, then check whether the units digit fits: a short list beats guessing.');
};

// ---- the paper's staples the source check found missing (20 Sep 2026: the 2020, 2022 and 2023 papers with keys on the AoPS wiki) ----
const lineGraphQ = () => {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], vals = labels.map(() => ri(4, 30)); if (new Set(vals).size < 5) return null;
  const f = { kind: 'line', title: 'Noon temperature', unit: '°C', points: labels.map((l, i) => ({ label: l, value: vals[i] })) }, kind = ri(1, 3);
  const readOff = `Read the five points: ${labels.map((l, i) => `${l} ${vals[i]}°C`).join(', ')}.`;
  if (kind === 1) {
    let best = 1; for (let i = 2; i < 5; i++) if (Math.abs(vals[i] - vals[i - 1]) > Math.abs(vals[best] - vals[best - 1])) best = i;
    const ties = [1, 2, 3, 4].filter((i) => Math.abs(vals[i] - vals[i - 1]) === Math.abs(vals[best] - vals[best - 1])); if (ties.length > 1) return null;
    // four decoys for the paper's five options: the three other neighbouring pairs, and the week's ends (a real AMC 8 distractor: the whole-week change)
    return explain(withFigure(mcOnly('statistics · line graphs', 'The line graph shows the noon temperature on five days. Between which two days did it change the most?', `${labels[best - 1]} and ${labels[best]}`, [...[1, 2, 3, 4].filter((i) => i !== best).map((i) => `${labels[i - 1]} and ${labels[i]}`), `${labels[0]} and ${labels[4]}`]), f), [
      readOff,
      `Change from each day to the next: ${[1, 2, 3, 4].map((i) => `${labels[i - 1]} to ${labels[i]} ${Math.abs(vals[i] - vals[i - 1])}`).join(', ')}.`,
      `The biggest change is ${Math.abs(vals[best] - vals[best - 1])}°C, between ${labels[best - 1]} and ${labels[best]}.`,
      `So it changed the most between ${labels[best - 1]} and ${labels[best]}.`,
    ], 'The steepest part of a line graph is the biggest change; compare the jumps, up or down.');
  }
  if (kind === 2) {
    const t = sum(vals); if (t % 5) return null;
    return explain(withFigure(int('statistics · line graphs', 'The line graph shows the noon temperature on five days. What was the mean noon temperature, in °C?', t / 5), f), [
      readOff,
      `Total: ${vals.join(' + ')} = ${t}.`,
      `Mean = ${t} ÷ 5 = ${t / 5}.`,
      `So the mean noon temperature was ${t / 5} °C.`,
    ], 'Mean: add them all, then divide by how many there are.');
  }
  const hi = vals.indexOf(Math.max(...vals)), lo = vals.indexOf(Math.min(...vals));
  return explain(withFigure(int('statistics · line graphs', `The line graph shows the noon temperature on five days. How many degrees warmer was ${labels[hi]} than ${labels[lo]}?`, vals[hi] - vals[lo]), f), [
    readOff,
    `${labels[hi]} was ${vals[hi]}°C and ${labels[lo]} was ${vals[lo]}°C.`,
    `${vals[hi]} − ${vals[lo]} = ${vals[hi] - vals[lo]}.`,
    `So ${labels[hi]} was ${vals[hi] - vals[lo]} degrees warmer.`,
  ], 'Read both values off the graph first, then subtract.');
};
const formulaEval = () => {
  if (ri(1, 2) === 1) {
    const b = ri(3, 8), r = ri(4, 20), w = ri(0, 5);
    return explain(int('algebra · formulas', `A quiz is scored S = ${b}r − 2w, where r is the number of right answers and w the number of wrong ones. What is the score for ${r} right and ${w} wrong?`, b * r - 2 * w), [
      `Put the numbers in place of the letters: S = ${b} × ${r} − 2 × ${w}.`,
      `${b} × ${r} = ${b * r} and 2 × ${w} = ${2 * w}.`,
      `${b * r} − ${2 * w} = ${b * r - 2 * w}.`,
      `So the score is ${b * r - 2 * w}.`,
    ], 'Replace each letter with its number, then multiply before you subtract.');
  }
  const [what, per, a, b, m] = pick([['a taxi ride', 'miles', ri(2, 5), ri(2, 4), ri(3, 15)], ['renting a bike', 'hours', ri(5, 12), ri(2, 6), ri(2, 9)]]);
  return explain(int('algebra · formulas', `The cost of ${what} is C = ${a} + ${b}m dollars, where m is the number of ${per}. What is the cost for m = ${m}, in dollars?`, a + b * m), [
    `Put m = ${m} in place of the letter: C = ${a} + ${b} × ${m}.`,
    `${b} × ${m} = ${b * m}, then ${a} + ${b * m} = ${a + b * m}.`,
    `So the cost is ${a + b * m} dollars.`,
  ], 'Replace the letter with its number, then multiply before you add.');
};
const captureRecapture = () => {
  const N = pick([600, 800, 1000, 1200, 1500, 2000]), tagged = pick([50, 100, 150, 200, 250]), sample = pick([60, 80, 90, 120, 150, 180]), found = (tagged * sample) / N; if (!Number.isInteger(found) || found < 2) return null;
  const k = sample / found;
  return explain(int('word problems · proportion', `${tagged} fish in a lake are caught, tagged and released. Later ${sample} fish are caught, and ${found} of them are tagged. About how many fish are in the lake?`, N), Number.isInteger(k) ? [
    `In the second catch ${found} of the ${sample} fish are tagged: 1 in every ${k}.`,
    `The whole lake should have the same share tagged: 1 in every ${k} fish is one of the ${tagged} tagged ones.`,
    `${tagged} × ${k} = ${N}.`,
    `So there are about ${N} fish in the lake.`,
  ] : [
    'The share of tagged fish in the second catch should match the share in the whole lake.',
    `Catch: ${found} tagged out of ${sample}. Lake: ${tagged} tagged out of the whole.`,
    `Whole lake = ${tagged} × ${sample} ÷ ${found} = ${tagged * sample} ÷ ${found} = ${N}.`,
    `So there are about ${N} fish in the lake.`,
  ], 'Tag and recapture: the tagged share of the sample is the tagged share of the whole.');
};
const equallySpaced = () => {
  const a = ri(2, 20), d = ri(2, 12);
  return explain(int('algebra · equally spaced', `Five numbers are equally spaced. The smallest is ${a} and the largest is ${a + 4 * d}. What is the middle number?`, a + 2 * d), [
    'With 5 equally spaced numbers, the middle one is halfway between the smallest and the largest.',
    `Halfway: (${a} + ${a + 4 * d}) ÷ 2 = ${2 * a + 4 * d} ÷ 2 = ${a + 2 * d}.`,
    `Check: the gap is (${a + 4 * d} − ${a}) ÷ 4 = ${d}, so the numbers are ${a}, ${a + d}, ${a + 2 * d}, ${a + 3 * d}, ${a + 4 * d}.`,
    `So the middle number is ${a + 2 * d}.`,
  ], 'In an evenly spaced list, the middle number is the average of the two ends.');
};
const storyAlgebra = () => {
  const x = ri(3, 30), k = pick([2, 3, 4]), c = ri(1, 15), who = names(1)[0];
  return explain(int('algebra · story', `${who} thinks of a number, multiplies it by ${k}, adds ${c} and gets ${k * x + c}. What was the number?`, x), [
    `Work backwards from ${k * x + c}, undoing each step in reverse order.`,
    `Undo adding ${c}: ${k * x + c} − ${c} = ${k * x}.`,
    `Undo multiplying by ${k}: ${k * x} ÷ ${k} = ${x}.`,
    `Check: ${x} × ${k} + ${c} = ${k * x + c}.`,
    `So the number was ${x}.`,
  ], '"Gets" at the end is a clue to work backwards, undoing each step in reverse.');
};
const coordRect = () => {
  const x1 = ri(-5, 5), y1 = ri(-5, 5), w = ri(2, 9), h = ri(2, 9), sx = x1 < 0 ? `(${x1})` : `${x1}`, sy = y1 < 0 ? `(${y1})` : `${y1}`;
  return explain(int('geometry · coordinates', `A rectangle has vertices at (${x1}, ${y1}), (${x1 + w}, ${y1}), (${x1 + w}, ${y1 + h}) and (${x1}, ${y1 + h}). What is its area?`, w * h), [
    `Width: the x-coordinates run from ${x1} to ${x1 + w}, so ${x1 + w} − ${sx} = ${w}.`,
    `Height: the y-coordinates run from ${y1} to ${y1 + h}, so ${y1 + h} − ${sy} = ${h}.`,
    `Area = width × height = ${w} × ${h} = ${w * h}.`,
    `So the area is ${w * h}.`,
  ], 'On a coordinate grid, a side length is the difference between the coordinates that change.');
};
const stampsMax = () => {
  const [p, q] = pick([[15, 25], [10, 25], [20, 35], [25, 40], [15, 40]]), T = p * ri(2, 12) + q * ri(1, 8), who = names(1)[0];
  let best = 0, bi = 0, bj = 0; for (let i = 0; i * p <= T; i++) if ((T - i * p) % q === 0) { const j = (T - i * p) / q; if (i + j > best) { best = i + j; bi = i; bj = j; } }
  return explain(int('counting · optimisation', `Stamps cost ${p}¢ and ${q}¢. ${who} spends exactly $${(T / 100).toFixed(2)} on stamps. What is the greatest number of stamps that could have been bought?`, best), [
    `$${(T / 100).toFixed(2)} is ${T}¢. Cheaper stamps give more stamps, so use as many ${p}¢ stamps as the total allows.`,
    `The rest must come out exactly in ${q}¢ stamps. The most ${p}¢ stamps that work: ${bi}, costing ${bi * p}¢ and leaving ${T - bi * p}¢${bj ? ` = ${bj} × ${q}¢` : ''}.`,
    bj ? `More ${p}¢ stamps would leave change that ${q}¢ stamps cannot make exactly.` : '',
    `${bi} + ${bj} = ${best} stamps.`,
    `So the greatest number of stamps is ${best}.`,
  ], 'To buy the most, use the cheapest as much as you can and check the change comes out exactly.');
};
const wordArrangements = () => {
  const [w, v] = pick([['LEVEL', 30], ['BANANA', 60], ['PEPPER', 60], ['COFFEE', 180], ['SUCCESS', 420], ['BALLOON', 1260], ['CHEESE', 120], ['LETTER', 180], ['MISSISSIPPI', 34650], ['BEEKEEPER', 3024]]);
  const L = w.length, tally = {}; for (const ch of w) tally[ch] = (tally[ch] || 0) + 1;
  const fact = (k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; }, reps = Object.entries(tally).filter(([, c]) => c > 1), div = reps.reduce((acc, [, c]) => acc * fact(c), 1), calc = fact(L) / div;
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
  return explain(int('counting · letters', `How many different arrangements of the letters of the word ${w} are there?`, v), [
    `${w} has ${L} letters, with ${reps.length ? list(reps.map(([ch, c]) => `${ch} appearing ${c} times`)) : 'no letter repeated'}.`,
    `If all ${L} letters were different there would be ${L}! = ${L <= 7 ? countDown(L).join(' × ') : `${L} × ${L - 1} × ${L - 2} × … × 1`} = ${fact(L)} orders.`,
    reps.length ? `Swapping identical letters gives the same word, so divide by ${list(reps.map(([, c]) => `${c}! = ${fact(c)}`))}: ${fact(L)} ÷ ${div} = ${calc}.` : '',
    `So there are ${v} different arrangements.`,
  ], 'Arrangements of a word: n! divided by the factorial of each repeated letter\'s count.');
};
const telescopingProduct = () => {
  const n = ri(8, 30), D = (n + 1) * (n + 2), g = gcd(2, D);
  return explain(frac('algebra · telescoping product', `What is the value of the product (1/3) × (2/4) × (3/5) × … × (${n}/${n + 2})? Give a fraction in its simplest form.`, 2, D), [
    `Put all the tops together and all the bottoms together: (1 × 2 × 3 × … × ${n}) ÷ (3 × 4 × 5 × … × ${n + 2}).`,
    `Every number from 3 to ${n} is on the top and on the bottom, so it cancels.`,
    `Left on top: 1 × 2 = 2. Left on the bottom: ${n + 1} × ${n + 2} = ${D}.`,
    `2/${D}${g > 1 ? ` = ${2 / g}/${D / g}` : ''}.`,
    `So the product is ${2 / g}/${D / g}.`,
  ], 'In a long product of fractions, line up the tops and bottoms and cancel before multiplying.');
};
const netJumps = () => {
  const up = ri(4, 9), down = ri(1, up - 2), N = ri(30, 200); let pos = 0, n = 0; while (pos < N) { n++; pos += n % 2 ? up : -down; }
  const net = up - down, m = (n - 1) / 2, need = N - up, q = Math.floor(need / net), rem = need % net;
  return explain(int('algebra · net progress', `A frog on a number line starts at 0. Its jumps alternate: ${up} to the right, then ${down} to the left, then ${up} right, ${down} left, and so on. Which jump first lands the frog on or past ${N}?`, n), [
    `A jump right then a jump left together move the frog ${up} − ${down} = ${net} forward, and it first reaches ${N} on a right jump.`,
    `Before that last right jump of ${up} it must be at ${N} − ${up} = ${need} or more: ${need} ÷ ${net} = ${q}${rem ? ` remainder ${rem}` : ''}, so ${m} pairs of jumps are needed.`,
    `After ${m} pairs (${2 * m} jumps) it is at ${m} × ${net} = ${m * net}; the next right jump lands at ${m * net} + ${up} = ${m * net + up}, on or past ${N}.`,
    `After only ${m - 1} pairs the right jump would reach ${(m - 1) * net} + ${up} = ${(m - 1) * net + up}, short of ${N}.`,
    `That is jump number ${2 * m} + 1 = ${n}. So the ${ord(n)} jump is the first to land on or past ${N}.`,
  ], 'Group the jumps in pairs to see the net gain, then check where the next right jump lands.');
};
const socksPercent = () => {
  const r = ri(4, 20), b = ri(4, 20), p = pick([50, 60, 75, 80]), x = (p * (r + b) - 100 * r) / (100 - p); if (!Number.isInteger(x) || x < 1) return null;
  const total = r + b + x;
  return explain(int('percentages · reaching a share', `A drawer has ${r} red socks and ${b} blue socks. How many red socks must be added so that ${p}% of the socks are red?`, x), [
    `Only red socks are added, so the ${b} blue socks stay and must be ${100 - p}% of the new total.`,
    `${100 - p}% of the total is ${b}, so the total is ${b} × 100 ÷ ${100 - p} = ${100 * b} ÷ ${100 - p} = ${total}.`,
    `Red socks then: ${total} − ${b} = ${total - b}, which is ${p}% of ${total}.`,
    `Added: ${total - b} − ${r} = ${x}.`,
    `So ${x} red socks must be added.`,
  ], 'When only one kind is added, start from the kind that stays the same.');
};
const pieLeft = () => {
  const [a, b] = pick([[4, 3], [3, 6], [4, 6], [5, 10], [3, 4], [6, 4]]), c = pick([2, 3, 4]), rem = a * b - a - b; if (rem <= 0) return null;
  const who = names(1)[0], top = rem * (c - 1), bot = a * b * c, g = gcd(top, bot);
  return explain(frac('fractions · what is left', `${who} ate 1/${a} of a pie and a friend ate 1/${b} of it. Then a third friend ate 1/${c} of what was left. What fraction of the pie is left? Give a fraction in its simplest form.`, top, bot), [
    `Eaten first: 1/${a} + 1/${b} = ${b}/${a * b} + ${a}/${a * b} = ${a + b}/${a * b}.`,
    `Left after that: ${a * b}/${a * b} − ${a + b}/${a * b} = ${rem}/${a * b}.`,
    `The third friend eats 1/${c} of that, so ${c - 1}/${c} of it stays: ${c - 1}/${c} × ${rem}/${a * b} = ${top}/${bot}.`,
    g > 1 ? `Simplify by dividing the top and the bottom by ${g}: ${top / g}/${bot / g}.` : '',
    `So ${top / g}/${bot / g} of the pie is left.`,
  ], 'A fraction of what is left: find what is left first, then take the fraction of that.');
};
const modeRange = () => {
  const xs = Array.from({ length: 7 }, () => ri(2, 20)), counts = {}; for (const x of xs) counts[x] = (counts[x] || 0) + 1; const top = Object.entries(counts).sort((p, q) => q[1] - p[1]); if (top[0][1] < 2 || (top[1] && top[1][1] === top[0][1])) return null;
  const sorted = [...xs].sort((p, q) => p - q);
  if (ri(1, 2) === 1) {
    const mode = Number(top[0][0]);
    return explain(int('statistics · mode', `What is the mode of ${xs.join(', ')}?`, mode), [
      `Put them in order so repeats sit together: ${sorted.join(', ')}.`,
      `${mode} appears ${top[0][1]} times; no other number appears that often.`,
      `So the mode is ${mode}.`,
    ], 'Mode = the most common; median = the middle; mean = share out equally; range = biggest − smallest.');
  }
  const hi = Math.max(...xs), lo = Math.min(...xs);
  return explain(int('statistics · range', `What is the range of ${xs.join(', ')}?`, hi - lo), [
    `Put them in order: ${sorted.join(', ')}.`,
    `Largest ${hi}, smallest ${lo}.`,
    `Range = largest − smallest = ${hi} − ${lo} = ${hi - lo}.`,
    `So the range is ${hi - lo}.`,
  ], 'Range = biggest − smallest; sort the list first so you cannot miss one.');
};
const midpointRect = () => {
  const A = ri(8, 60) * 2;
  return explain(int('geometry · midpoints', `The midpoints of the sides of a rectangle of area ${A} are joined in order to make a smaller quadrilateral. What is its area?`, A / 2), [
    'Joining the midpoints cuts off 4 corner triangles and leaves a diamond (a rhombus) in the middle.',
    'Split the rectangle into 4 equal quarters through the midpoints: each corner triangle is exactly half of its quarter.',
    `So the 4 corner triangles make half the rectangle, and the diamond is the other half: ${A} ÷ 2 = ${A / 2}.`,
    `So its area is ${A / 2}.`,
  ], 'The shape joining the midpoints of any rectangle has half its area.');
};
const pairAverages = () => {
  const a = ri(5, 30), b = ri(a + 1, 40), c = ri(b + 1, 50); if ((a + b) % 2 || (b + c) % 2 || (a + c) % 2) return null;
  return explain(int('statistics · pair averages', `Three different numbers are chosen. The averages of the three pairs are ${(a + b) / 2}, ${(a + c) / 2} and ${(b + c) / 2}. What is the largest of the three numbers?`, c), [
    `Each pair average × 2 is that pair's sum: ${a + b}, ${a + c} and ${b + c}.`,
    `Adding the 3 pair sums counts every number twice: ${a + b} + ${a + c} + ${b + c} = ${2 * (a + b + c)}, so the 3 numbers add to ${2 * (a + b + c)} ÷ 2 = ${a + b + c}.`,
    `The largest number is the total minus the 2 smaller ones, and those 2 make the smallest pair sum: ${a + b + c} − ${a + b} = ${c}.`,
    `Check: the numbers are ${a}, ${b} and ${c}.`,
    `So the largest number is ${c}.`,
  ], 'Add all the pair sums: every number is counted twice, so halve to get the total.');
};
const risingDigits = () => {
  const lo = pick([100, 200, 300, 400, 500]); let c = 0; for (let k = lo; k < lo + 100; k++) { const d = digitsOf(k); if (d[0] < d[1] && d[1] < d[2]) c++; } if (!c) return null;
  const h = lo / 100, parts = []; for (let t = h + 1; t <= 8; t++) parts.push(9 - t);
  return explain(int('counting · digits', `How many whole numbers from ${lo} to ${lo + 99} have digits that increase from left to right?`, c), [
    `The hundreds digit is ${h}, so the tens digit must be bigger than ${h} and the units digit bigger than the tens digit.`,
    `Tens digit ${h + 1}: the units digit can be ${h + 2} to 9, that is ${8 - h} numbers. Tens digit ${h + 2}: ${7 - h} numbers, and so on down to tens digit 8: 1 number.`,
    `Add them up: ${parts.join(' + ')} = ${c}.`,
    `So there are ${c} such numbers.`,
  ], 'Fix one digit at a time, count what the next digit can be, then add the cases.');
};
const factorTriples = () => {
  const n = pick([36, 60, 72, 100, 120, 180]); let c = 0; const byA = new Map(); for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) { if (n % (a * b)) continue; if (n / (a * b) > b) { c++; if (!byA.has(a)) byA.set(a, []); byA.get(a).push(`${a} × ${b} × ${n / (a * b)}`); } }
  const rows = [...byA.entries()];
  return explain(int('number theory · factor triples', `In how many ways can ${n} be written as a product a × b × c of three different whole numbers with a < b < c?`, c), [
    'List them in order with a < b < c, starting from the smallest a, so nothing is repeated or missed.',
    ...rows.map(([a, list]) => `a = ${a}: ${list.join(', ')} (${list.length}).`),
    `Total: ${rows.map(([, list]) => list.length).join(' + ')} = ${c}, so there are ${c} ways.`,
  ], 'List in order with a < b < c so nothing is counted twice or missed.');
};

const E = [['rates', unitPrice], ['percent', percentOf], ['mean', meanOf], ['order of operations', orderOps], ['consecutive', consecutive], ['perimeter', perimeterQ], ['filling', timeToFill], ['fractions', fractionOfFraction], ['line graph', lineGraphQ], ['formulas', formulaEval], ['proportion', captureRecapture], ['equally spaced', equallySpaced], ['story', storyAlgebra]];
const M = [['percent trap', percentTrap], ['ratio', ratioQ], ['divisors', divisorsCount], ['units digit', unitsDigit], ['LCM', lcmWords], ['odd digits', digitsAllOdd], ['handshakes', handshakes], ['rectangles', rectanglesInGrid], ['triangle in rectangle', triangleInRect], ['polygon angles', polygonAngles], ['Pythagoras', pythagoras], ['median', median5], ['calendar', dayAfter], ['circle', circleArea], ['bar chart', barChartQ],
  ['coordinates', coordRect], ['stamps', stampsMax], ['letters', wordArrangements], ['telescoping product', telescopingProduct], ['net jumps', netJumps], ['socks', socksPercent], ['pie left', pieLeft], ['mode and range', modeRange]];
const H = [['dice', diceSum], ['two marbles', twoMarbles], ['arrangements', arrangements], ['paths', paths], ['L-shape', lShape], ['inclusion-exclusion', inclusionExclusion], ['mean shift', meanShift], ['working backwards', workBack], ['remainders', remainders], ['clock angles', clockAngle], ['average speed', speedAverage], ['digit sums', digitSumCount],
  ['midpoints', midpointRect], ['pair averages', pairAverages], ['rising digits', risingDigits], ['factor triples', factorTriples]];
// Year 4's closing band is the middle kinds again; Years 5–6 get the real closing problems
const pool = (y) => [...E.map(([cat, gen]) => ({ cat, gen, sections: ['E'] })), ...M.map(([cat, gen]) => ({ cat, gen, sections: y <= 4 ? ['M', 'H'] : ['M'] })), ...(y >= 5 ? H.map(([cat, gen]) => ({ cat, gen, sections: ['H'] })) : [])];
// the real paper (the MAA's Teacher's Manual): 25 multiple choice of five options in 40 minutes, climbing from problem 1 to 25.
// AoPS's bands (1–10, 11–20, 21–25) are the three sittings; the 40 minutes split 12 + 14 + 14 (the owner, 20 Sep 2026)
export const PHASES = [phase('alpha', 'Problems 1–10', 1, 12, slots([['E', 'mc', 10]])), phase('beta', 'Problems 11–20', 1, 14, slots([['M', 'mc', 10]])), phase('gamma', 'Problems 21–25', 1, 14, slots([['H', 'mc', 5]]))];
export const build = (shape, year) => buildHeat(shape, pool(year), year, { options: 5 });
export const TOPICS = [
  { band: 'Grade 4 · problems 1–15', lines: ['warm-up: unit prices, percentages, means, order of operations, a line graph, a formula, tagged fish', 'consecutive numbers, perimeter from area, fractions of fractions, equally spaced numbers', 'middle: ratios, divisors, units digits, handshakes, rectangles in a grid, coordinates, stamps for a sum', 'Pythagorean triples, polygon angles, calendars, circles in terms of π, letters of a word, a frog\'s net jumps'] },
  { band: 'Grades 5–6 · the full paper', lines: ['all of Grade 4 for the first seven', 'closing: dice and marbles as fractions, arrangements and committees, a telescoping product', 'paths on a grid, L-shaped areas, inclusion-exclusion, shifting means, midpoints of a rectangle', 'remainders, clock angles, average speed there and back, pair averages, rising digits, factor triples'] },
];
