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
import { ri, pick, shuffle, sum, names, thing, money, int, dec, frac, mcOnly, withFigure, bars, buildHeat, slots, phase, explain, bar, cap, ord, gcd, lcm, digitsOf } from './common.mjs';
import { genSingapore } from '../singapore.mjs';

const band = (y) => (y <= 2 ? 1 : y <= 4 ? 2 : 3);
// the word a bar model's box goes by: a box for Grades 1–2, a unit from Grade 3 (STEPS.md)
const unitWord = (y, n) => `${n} ${band(y) === 1 ? 'box' : 'unit'}${n === 1 ? '' : band(y) === 1 ? 'es' : 's'}`;
const pl = (n) => (n === 1 ? '' : 's');
const hm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

// a Singapore-standard word problem for the year, as a seed: the module's own choices stay its choices. The wrapped question
// carries no working of its own (singapore.mjs gives text, answer, read and a figure), so its solution is the honest generic
// one — the numbers to pick out, the order of work, the answer — the only kind allowed that shape (STEPS.md)
const answerOf = (a) => (a.type === 'frac' ? `${a.n}/${a.d}` : a.type === 'dec' ? String(Math.round(a.v * 100) / 100) : String(a.v));
const syllabusSteps = (seed, ans) => {
  const nums = (seed.text.match(/\d+(?:[.,:]\d+)?/g) || []).slice(0, 6);
  const fig = seed.figure ? ({ bars: 'bar graph', pie: 'pie chart', table: 'table', line: 'line graph' }[seed.figure.kind] || 'figure') : null;
  return [
    fig ? `Read the numbers off the ${fig} first, then read the question again.` : nums.length ? `Read the question twice and note its numbers: ${nums.join(', ')}.` : 'Read the question twice and picture each thing it names.',
    'Decide what is asked for, then do the sums one step at a time from the words.',
    `The answer is ${ans}.`,
  ];
};
const SYLLABUS_TIP = 'Read twice, find the numbers, decide the operation, then check the answer makes sense.';
const syllabus = (y) => {
  for (let t = 0; t < 8; t++) {
    const q = genSingapore(y - 1, ri(2, 5)); if (!q || !q.display) continue;
    const seed = { cat: 'syllabus word problem', text: q.display.text, read: q.read, ...(q.display.figure ? { figure: q.display.figure } : {}) };
    if (q.answer.type === 'choice') { const right = q.display.choices[q.answer.v]; return explain({ ...seed, answer: null, right, decoys: q.display.choices.filter((_, i) => i !== q.answer.v), mcOnly: true }, syllabusSteps(seed, right), SYLLABUS_TIP); }
    // a fraction is only ever an option on the real paper
    return explain({ ...seed, answer: q.answer, ...(q.answer.type === 'frac' ? { mcOnly: true } : {}) }, syllabusSteps(seed, answerOf(q.answer)), SYLLABUS_TIP);
  }
  return null;
};
// ---- heuristics ----
const listing = (y) => {
  if (y <= 2) {
    const [w] = names(1), k = ri(2, 3), n = ri(4, 6), towers = Array.from({ length: n }, (_, i) => (i + 1) * k), total = (k * n * (n + 1)) / 2;
    return explain(int('systematic listing', `${w} builds towers of blocks. The 1st tower uses ${k} blocks, the 2nd uses ${2 * k}, the 3rd uses ${3 * k}, and the pattern continues. How many blocks are needed altogether for the first ${n} towers?`, total), [
      `Each tower uses ${k} more blocks than the one before, so list them: ${towers.join(', ')}.`,
      `Add the list: ${towers.join(' + ')} = ${total}.`,
      `So the first ${n} towers need ${total} blocks altogether.`,
    ], 'When a pattern is short, write every term out and add them up.');
  }
  if (y <= 4) {
    const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3).sort(), [a, b, c] = ds;
    return explain(int('systematic listing', `How many different two-digit numbers can be made from the digits ${ds.join(', ')}, using each digit at most once in a number?`, 6), [
      `Start with ${a} in the tens place: ${a}${b}, ${a}${c}.`,
      `Then ${b} in the tens place: ${b}${a}, ${b}${c}.`,
      `Then ${c} in the tens place: ${c}${a}, ${c}${b}.`,
      '2 + 2 + 2 = 6. So 6 different two-digit numbers can be made.',
    ], 'List in order: fix the first digit, then run through the rest, so nothing is missed or counted twice.');
  }
  const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4).sort(), [a, b, c, d] = ds;
  return explain(int('systematic listing', `How many different three-digit numbers can be made from the digits ${ds.join(', ')}, using each digit at most once in a number?`, 24), [
    `Fix ${a} in the hundreds place and list the rest: ${a}${b}${c}, ${a}${b}${d}, ${a}${c}${b}, ${a}${c}${d}, ${a}${d}${b}, ${a}${d}${c}. That is 6 numbers.`,
    'Each of the 4 digits can take the hundreds place, and each gives 6 numbers in the same way.',
    '4 × 6 = 24. So 24 different three-digit numbers can be made.',
  ], 'Fix the first digit, count the arrangements of the rest, then multiply by the choices for the first digit.');
};
const beforeAfter = (y) => {
  const [a, b] = names(2), it = thing();
  if (y <= 2) {
    const x = ri(3, 12), g = ri(1, 5), had = ri(1, 12);
    return explain(int('before and after', `${a} had ${x + g} ${it}s and ${b} had ${had}. ${a} gave ${g} ${it}${g > 1 ? 's' : ''} to ${b}. How many ${it}s does ${b} have now?`, had + g), [
      `The question is about ${b}, who starts with ${had} ${it}s.`,
      `${b} gets ${g} more from ${a}: ${had} + ${g} = ${had + g}.`,
      `So ${b} has ${had + g} ${it}s now.`,
    ], 'Find the person the question asks about, then follow only what happens to them.');
  }
  const k = pick([2, 3]), x = ri(4, 20) * 2, g = (k - 1) * (x / 2);
  return explain(int('before and after', `${a} had ${k} times as many ${it}s as ${b}. After ${a} gave ${b} ${g} ${it}s, they had the same number. How many ${it}s did ${a} have at first?`, k * x), [
    'Before:',
    bar(a, k, unitWord(y, k)),
    bar(b, 1, unitWord(y, 1)),
    `${a} gives ${g} and ${b} gets ${g}, so the gap between them closes by ${g} + ${g} = ${2 * g}.`,
    k === 2 ? `The gap is ${unitWord(y, 1)}, so ${unitWord(y, 1)} = ${2 * g}.` : `The gap is ${unitWord(y, k - 1)}, so ${unitWord(y, 1)} = ${2 * g} ÷ ${k - 1} = ${x}.`,
    `${a} had ${unitWord(y, k)}: ${k} × ${x} = ${k * x}. So ${a} had ${k * x} ${it}s at first.`,
  ], 'When one gives and the other gets, the gap between them shrinks by twice the gift.');
};
const guessCheck = (y) => {
  if (y <= 2) {
    const c = ri(2, 6), r = ri(1, 5), n = c + r, legs = 2 * c + 4 * r;
    return explain(int('guess and check', `A farmer has some chickens and rabbits: ${n} heads and ${legs} legs. How many rabbits are there?`, r), [
      `Pretend all ${n} animals are chickens: ${n} × 2 = ${2 * n} legs.`,
      `But there are ${legs} legs, so ${legs - 2 * n} legs are extra.`,
      `Each rabbit has 2 more legs than a chicken: ${legs - 2 * n} ÷ 2 = ${r}.`,
      `So there are ${r} rabbits.`,
    ], 'Start with the animal that has fewer legs, then count the extra legs.');
  }
  const c = ri(3, 15), r = ri(2, 12), [one, other, a, b, part] = pick([['chickens', 'rabbits', 2, 4, 'legs'], ['bicycles', 'tricycles', 2, 3, 'wheels'], ['spiders', 'ants', 8, 6, 'legs'], ['small taxis', 'big taxis', 4, 6, 'seats']]);
  const n = c + r, total = c * a + r * b, all = n * a, diff = Math.abs(total - all), per = Math.abs(b - a), oneS = one.slice(0, -1), otherS = other.slice(0, -1);
  return explain(int('guess and check', `There are ${n} ${one} and ${other} altogether, with ${total} ${part} in all. How many ${other} are there?`, r), [
    `Pretend all ${n} are ${one}: ${n} × ${a} = ${all} ${part}.`,
    b > a ? `But there are ${total} ${part}, so ${diff} ${part} are missing.` : `But there are only ${total} ${part}, so that is ${diff} ${part} too many.`,
    `Each ${otherS} has ${per} ${b > a ? 'more' : 'fewer'} ${per === 1 ? part.slice(0, -1) : part} than a ${oneS}: ${diff} ÷ ${per} = ${r}.`,
    `So there are ${r} ${other}.`,
  ], 'Pretend they are all one kind, then see how far the total is out and what each swap changes.');
};
const workBack = (y) => {
  const [w] = names(1), it = thing();
  if (y <= 2) {
    const first = ri(5, 20), a = ri(2, 7), g = ri(2, 9), now = first - a + g;
    return explain(int('working backwards', `${w} had some ${it}s. ${w} gave ${a} away and then got ${g} more. Now ${w} has ${now}. How many ${it}s did ${w} have at first?`, first), [
      `Start at the end: ${w} has ${now} now.`,
      `Undo the ${g} that came in: ${now} − ${g} = ${now - g}.`,
      `Undo the ${a} given away: ${now - g} + ${a} = ${first}.`,
      `So ${w} had ${first} ${it}s at first.`,
    ], '"At first" is a clue to work backwards: undo each change in reverse order.');
  }
  if (y <= 4) {
    const first = ri(8, 40), k = pick([2, 3]), a = ri(2, 12), result = first * k - a;
    return explain(int('working backwards', `A number is multiplied by ${k}, then ${a} is subtracted. The result is ${result}. What is the number?`, first), [
      `Start at the end: the result is ${result}.`,
      `Undo the subtraction: ${result} + ${a} = ${first * k}.`,
      `Undo the multiplication: ${first * k} ÷ ${k} = ${first}.`,
      `So the number is ${first}.`,
    ], 'Work backwards: undo the last step first, and swap each operation for its opposite.');
  }
  const first = ri(10, 60), k = pick([2, 3, 4]), a = ri(2, 20), d = pick([2, 5]); const inner = first * k + a; if (inner % d !== 0) return null;
  return explain(int('working backwards', `A number is multiplied by ${k}, ${a} is added, and the result is divided by ${d} to give ${inner / d}. What is the number?`, first), [
    `Start at the end: ${inner / d}.`,
    `Undo the division: ${inner / d} × ${d} = ${inner}.`,
    `Undo the addition: ${inner} − ${a} = ${first * k}.`,
    `Undo the multiplication: ${first * k} ÷ ${k} = ${first}.`,
    `So the number is ${first}.`,
  ], 'Work backwards: undo the last step first, and swap each operation for its opposite.');
};
// the fraction pairs carry their own working: what is left after the book, the pen's share of the whole, and what is left of the whole
const remainderFrac = () => {
  const [w] = names(1), [f1, f2, mult, rem, penF, leftF] = pick([['1/3', '1/4', 2, '2/3', '1/6', '1/2'], ['1/4', '1/3', 2, '3/4', '1/4', '1/2'], ['1/2', '1/3', 3, '1/2', '1/6', '1/3'], ['2/5', '1/3', 5 / 2, '3/5', '1/5', '2/5']]), c = mult === 5 / 2 ? ri(4, 20) * 2 : ri(5, 60), total = c * mult;
  return explain(int('fraction of a remainder', `${w} spent ${f1} of ${w}'s money on a book, then ${f2} of the remainder on a pen. ${w} had ${money(c)} left. How much money did ${w} have at first (in dollars)?`, total), [
    `The book took ${f1} of the money, so ${rem} of the money was left.`,
    `The pen took ${f2} of that remainder: ${f2} of ${rem} = ${penF} of the whole.`,
    `Left: ${rem} − ${penF} = ${leftF} of the whole, and that is $${c}.`,
    leftF === '2/5' ? `2/5 of the money is ${c}, so 1/5 is ${c / 2} and the whole is 5 × ${c / 2} = ${total}.` : `${leftF} of the money is ${c}, so the whole is ${mult} × ${c} = ${total}.`,
    `So ${w} had $${total} at first.`,
  ], 'Turn every fraction into a fraction of the whole, then see what fraction the money left is.');
};
const gapDiff = (y) => {
  const small = ri(y <= 2 ? 2 : 5, y <= 2 ? 10 : y <= 4 ? 40 : 200), d = ri(2, y <= 2 ? 6 : y <= 4 ? 12 : 60), big = small + d, total = 2 * small + d;
  return explain(int('sum and difference', `The sum of two numbers is ${total} and their difference is ${d}. What is the bigger number?`, big), [
    `Add the difference to the sum: ${total} + ${d} = ${2 * big}. That is two of the bigger number.`,
    `${2 * big} ÷ 2 = ${big}.`,
    `Check: the smaller number is ${big} − ${d} = ${small}, and ${big} + ${small} = ${total}.`,
    `So the bigger number is ${big}.`,
  ], 'Sum + difference = two of the bigger number; sum − difference = two of the smaller.');
};
const units = () => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const a = ri(2, 5), b = ri(a + 1, 9), u = ri(3, 15); if (gcd(a, b) !== 1) return null;
    return explain(int('ratio', `The ratio of boys to girls in a club is ${a} : ${b}. There are ${u * (b - a)} more girls than boys. How many children are in the club?`, u * (a + b)), [
      bar('Boys', a, `${a} units`),
      bar('Girls', b, `${b} units`),
      b - a === 1 ? `Girls have 1 unit more than boys, so 1 unit = ${u}.` : `Girls have ${b - a} units more than boys: ${b - a} units = ${u * (b - a)}, so 1 unit = ${u * (b - a)} ÷ ${b - a} = ${u}.`,
      `All the children: ${a + b} units = ${a + b} × ${u} = ${u * (a + b)}.`,
      `So there are ${u * (a + b)} children in the club.`,
    ], 'A ratio gives the units; the difference between the two sides tells you what one unit is worth.');
  }
  if (kind === 2) {
    const t = pick([40, 60, 80, 120, 150, 200]), p = pick([10, 20, 25, 30, 40, 50, 60, 75].filter((x) => (t * x) % 100 === 0)), no = t - (t * p) / 100;
    return explain(int('percentage', `${p}% of the ${t} pupils in a hall wear glasses. How many pupils do not wear glasses?`, no), [
      `If ${p}% wear glasses, then 100% − ${p}% = ${100 - p}% do not.`,
      `${100 - p}% of ${t} = ${t} × ${100 - p} ÷ 100 = ${no}.`,
      `So ${no} pupils do not wear glasses.`,
    ], 'The part you want is often 100% minus the part you are told.');
  }
  const price = pick([20, 40, 50, 80, 120]), off = pick([10, 20, 25, 30, 50].filter((x) => (price * x) % 100 === 0)), disc = (price * off) / 100;
  return explain(int('percentage', `A shirt costs ${money(price)}. It is sold at a discount of ${off}%. What is the discount, in dollars?`, disc), [
    `${off}% means ${off} out of every 100.`,
    `${off}% of ${price} = ${price} × ${off} ÷ 100 = ${disc}.`,
    `So the discount is $${disc}.`,
  ], 'A percentage of a price: multiply by the percentage, then divide by 100.');
};
// the papers' figures are composite: a bent wire, a length three times its breadth, an L-shape, a quarter circle with π = 3.14
const geometry = (y) => {
  const b = band(y), kind = b === 1 ? ri(1, 2) : b === 2 ? ri(1, 3) : ri(1, 5);
  if (b === 1) {
    if (kind === 1) {
      const side = ri(3, 12), coins = 4 * (side - 1);
      return explain(int('coins round a square', `${coins} coins are placed to form a square, with the same number of coins along each side and one coin at each corner. How many coins are along each side?`, side), [
        `Each corner coin belongs to 2 sides, so count the 4 corners first: ${coins} − 4 = ${coins - 4} coins are not at a corner.`,
        `Share those among the 4 sides: ${coins - 4} ÷ 4 = ${side - 2} coins in the middle of each side.`,
        `Add the 2 corners of that side: ${side - 2} + 2 = ${side}.`,
        `So there are ${side} coins along each side.`,
      ], 'Corner coins belong to two sides: count the corners once, then share the rest among the 4 sides.');
    }
    const l = ri(4, 12), w = ri(2, l - 1);
    return explain(int('perimeter', `A rectangle is ${l} cm by ${w} cm. What is its perimeter, in cm?`, 2 * (l + w)), [
      `A rectangle has 2 sides of ${l} cm and 2 sides of ${w} cm.`,
      `${l} + ${w} = ${l + w}, and ${l + w} × 2 = ${2 * (l + w)}.`,
      `So the perimeter is ${2 * (l + w)} cm.`,
    ], 'Perimeter of a rectangle: add the length and the breadth, then double.');
  }
  if (kind === 1) {
    const w = ri(3, 12), k = pick([2, 3, 4]), per = 2 * (k + 1) * w;
    return explain(int('length and breadth', `The length of a rectangle is ${k} times its breadth. Its perimeter is ${per} cm. What is its area, in cm²?`, k * w * w), [
      bar('Breadth', 1, '1 unit'),
      bar('Length', k, `${k} units`),
      `The perimeter is 2 lengths + 2 breadths = ${2 * (k + 1)} units = ${per} cm, so 1 unit = ${per} ÷ ${2 * (k + 1)} = ${w} cm.`,
      `Breadth ${w} cm, length ${k} × ${w} = ${k * w} cm.`,
      `Area = ${k * w} × ${w} = ${k * w * w}. So the area is ${k * w * w} cm².`,
    ], 'Call the breadth 1 unit; the perimeter is then a known number of units.');
  }
  if (kind === 2) {
    const L = ri(8, 25), W = ri(6, 20), l = ri(2, L - 3), w = ri(2, W - 3);
    return explain(int('composite figures', `An L-shaped figure is a ${L} cm by ${W} cm rectangle with a ${l} cm by ${w} cm rectangle cut from one corner. What is its area, in cm²?`, L * W - l * w), [
      `The full rectangle: ${L} × ${W} = ${L * W} cm².`,
      `The corner cut away: ${l} × ${w} = ${l * w} cm².`,
      `${L * W} − ${l * w} = ${L * W - l * w}. So the area is ${L * W - l * w} cm².`,
    ], 'An L-shape is a big rectangle with a corner missing: subtract the corner.');
  }
  if (kind === 3) {
    const total = pick([100, 120, 160, 200, 240]), s1 = ri(5, total / 4 - 5), rest = total - 4 * s1; if (rest % 4) return null;
    return explain(int('composite figures', `A wire ${total} cm long is cut into two pieces. Each piece is bent into a square. One square has sides of ${s1} cm. How long is each side of the other square, in cm?`, rest / 4), [
      `The first square uses 4 × ${s1} = ${4 * s1} cm of wire.`,
      `The other piece is ${total} − ${4 * s1} = ${rest} cm long.`,
      `A square has 4 equal sides: ${rest} ÷ 4 = ${rest / 4}.`,
      `So each side of the other square is ${rest / 4} cm.`,
    ], 'A bent wire keeps its length: the perimeter of the shape is the wire.');
  }
  if (kind === 4) {
    const a = ri(30, 100), c = ri(20, 170 - a);
    return explain(int('angles', `In a triangle, two angles are ${a}° and ${c}°. Find the third angle, in degrees.`, 180 - a - c), [
      'The three angles of a triangle add up to 180°.',
      `${a} + ${c} = ${a + c}.`,
      `180 − ${a + c} = ${180 - a - c}. So the third angle is ${180 - a - c} degrees.`,
    ], 'Angles in a triangle add up to 180°.');
  }
  if (ri(1, 2) === 1) {
    const r = pick([5, 10, 20]), area = Math.round(3.14 * r * r * 100) / 100;
    return explain(dec('circles', `Taking π as 3.14, find the area of a circle with radius ${r} cm, in cm².`, 3.14 * r * r), [
      'Area of a circle = π × radius × radius.',
      `${r} × ${r} = ${r * r}.`,
      `3.14 × ${r * r} = ${area}. So the area is ${area} cm².`,
    ], 'Square the radius first, then multiply by π.');
  }
  const r = pick([10, 20]), full = Math.round(3.14 * r * r * 100) / 100, quarter = Math.round(((3.14 * r * r) / 4) * 100) / 100;
  return explain(dec('circles', `Taking π as 3.14, find the area of a quarter circle with radius ${r} cm, in cm².`, (3.14 * r * r) / 4), [
    `The whole circle: 3.14 × ${r} × ${r} = ${full} cm².`,
    `A quarter of it: ${full} ÷ 4 = ${quarter}.`,
    `So the area is ${quarter} cm².`,
  ], 'Find the whole circle first, then take the fraction you need.');
};
// digit puzzles, as the papers ask them: pages that carry a digit, the largest number from given digits, the smallest with a digit sum
// pages with a digit, counted the way a child can check: 1–99 by the ones place and the tens place, then each hundred as a block
const pagesSteps = (n, d, c) => {
  const has = (k) => digitsOf(k).includes(d), m = Math.min(n, 99), ones = [], tens = [];
  for (let k = 1; k <= m; k++) { if (k % 10 === d) ones.push(k); if (Math.floor(k / 10) === d) tens.push(k); }
  const both = ones.filter((k) => tens.includes(k)), c1 = ones.length + tens.length - both.length, parts = [c1], lines = [
    `From 1 to ${m}, ${d} is the ones digit of ${ones.length} number${pl(ones.length)}: ${ones.join(', ')}.`,
    tens.length === 0 ? `No number up to ${m} has ${d} as its tens digit.` : tens.length === 1 ? `It is the tens digit of 1 number: ${tens[0]}.` : `It is the tens digit of ${tens.length} numbers: ${tens[0]} to ${tens[tens.length - 1]}.`,
    both.length ? `${both[0]} has ${d} in both places and was counted twice, so 1 to ${m} gives ${ones.length} + ${tens.length} − 1 = ${c1}.` : `So 1 to ${m} gives ${ones.length} + ${tens.length} = ${c1}.`,
  ];
  if (n >= 100) {
    const hi = Math.min(n, 199); let c2 = 0; for (let k = 100; k <= hi; k++) if (has(k)) c2++;
    parts.push(c2);
    lines.push(hi === 100 ? (d === 1 ? 'Page 100 has a 1: 1 more.' : `Page 100 has no ${d}.`) : d === 1 ? `Every page from 100 to ${hi} has a 1 in the hundreds place: ${c2} more.` : `From 100 to ${hi} the last two digits run 00 to ${hi - 100}, just like 1 to ${hi - 100}: ${c2} more.`);
    if (n === 200) { parts.push(d === 2 ? 1 : 0); lines.push(d === 2 ? 'Page 200 has a 2: 1 more.' : `Page 200 has no ${d}.`); }
    if (parts.slice(1).some((p) => p)) lines.push(`Altogether ${parts.join(' + ')} = ${c}.`);
  }
  lines.push(`So ${c} page numbers contain the digit ${d}.`);
  return lines;
};
const digitsQ = (y) => {
  const b = band(y), kind = b === 1 ? ri(1, 2) : ri(1, 3);
  if (b === 1 && kind === 1) {
    const w = names(5), k = ri(1, 5), ords = ['1st', '2nd', '3rd', '4th', '5th'], who = w[5 - k];
    return explain(mcOnly('ordinal numbers', `Five children stand in a line, from the left: ${w.join(', ')}. Who is ${ords[k - 1]} from the right?`, who, w.filter((_, i) => i !== 5 - k)), [
      `Read the line from the right instead: ${[...w].reverse().join(', ')}.`,
      `Count ${k} along that list: ${who}.`,
      `So ${who} is ${ords[k - 1]} from the right.`,
    ], 'Write the line again reading from the other end, then count.');
  }
  if (kind === 1 || b === 1) {
    const d = ri(1, 9), n = b === 1 ? pick([30, 40, 50]) : pick([100, 120, 150, 200]); let c = 0; for (let k = 1; k <= n; k++) if (digitsOf(k).includes(d)) c++;
    return explain(int('digit puzzles', `A book has pages numbered 1 to ${n}. How many page numbers contain the digit ${d}?`, c), pagesSteps(n, d, c), 'Count the ones place and the tens place separately, and watch for the number that has the digit in both.');
  }
  if (kind === 2) {
    const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4), desc = [...ds].sort((p, q) => q - p), big = Number(desc.join(''));
    return explain(int('digit puzzles', `What is the largest four-digit number that can be made with the digits ${ds.join(', ')}, each used once?`, big), [
      `The thousands place counts most, so put the biggest digit there, then the next biggest, and so on.`,
      `From biggest to smallest the digits are ${desc.join(', ')}.`,
      `So the largest number is ${big}.`,
    ], 'For the largest number, order the digits from biggest to smallest; for the smallest, the other way.');
  }
  const total = ri(10, 27), n = pick([3, 4]); let k = 10 ** (n - 1); while (sum(digitsOf(k)) !== total) k++;
  const ds = digitsOf(k), front = ds[0], rest = ds.slice(1);
  return explain(int('digit puzzles', `What is the smallest ${n}-digit number whose digits add up to ${total}?`, k), [
    'To keep a number small, keep the front digit small and push the big digits to the back.',
    `The other ${n - 1} digits can add to at most ${9 * (n - 1)}, so the front digit must be at least ${Math.max(1, total - 9 * (n - 1))}: use ${front}.`,
    `The remaining ${n - 1} digits must add to ${total - front}: fill from the right with 9s, giving ${rest.join(', ')}.`,
    `So the smallest ${n}-digit number is ${k} (${ds.join(' + ')} = ${total}).`,
  ], 'Smallest number with a digit sum: smallest possible front digit, then 9s from the back.');
};
const timeMoney = (y) => {
  const kind = ri(1, 2);
  if (kind === 1) {
    const h = ri(1, 10), m = pick([0, 15, 30, 45]), d = y <= 2 ? pick([30, 60]) : pick([25, 40, 45, 70, 95]), start = h * 60 + m, e = start + d, lines = [];
    let t = start, left = d;
    if (left >= 60) { lines.push(d === 60 ? `60 minutes is 1 hour. 1 hour after ${hm(t)} is ${hm(t + 60)}.` : `${d} minutes is 1 hour and ${d - 60} minutes. 1 hour after ${hm(t)} is ${hm(t + 60)}.`); t += 60; left -= 60; }
    if (left > 0) {
      const past = t % 60;
      if (past === 0 || past + left < 60) lines.push(`${hm(t)} + ${left} minutes = ${hm(t + left)}.`);
      else if (past + left === 60) lines.push(`${hm(t)} + ${left} minutes brings it exactly to ${hm(t + left)}.`);
      else lines.push(`From ${hm(t)} to ${hm(t + 60 - past)} is ${60 - past} minutes, then ${left - (60 - past)} minutes more: ${hm(t + left)}.`);
    }
    lines.push(`So the lesson ends at ${hm(e)}.`);
    return explain(mcOnly('time', `A lesson starts at ${hm(start)} and lasts ${d} minutes. When does it end?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 60)]), lines, 'Add whole hours first, then count on the minutes to the next hour, then the rest.');
  }
  const coins = y <= 2 ? [[50, ri(1, 4)], [20, ri(1, 4)], [10, ri(1, 5)]] : [[100, ri(1, 3)], [50, ri(1, 4)], [20, ri(1, 4)], [5, ri(1, 6)]]; const total = sum(coins.map(([v, n]) => v * n)), [w] = names(1);
  return explain(dec('money', `${w} has ${coins.map(([v, n]) => `${n} ${v === 100 ? '$1' : `${v}-cent`} coin${n > 1 ? 's' : ''}`).join(', ').replace(/, ([^,]*)$/, ' and $1')}. How much money is that, in dollars?`, total / 100), [
    ...coins.map(([v, n]) => (v === 100 ? `${n} × $1 = ${n * 100} cents.` : `${n} × ${v} cents = ${n * v} cents.`)),
    `Add: ${coins.map(([v, n]) => n * v).join(' + ')} = ${total} cents.`,
    `${total} cents = ${Math.round(total) / 100} dollars. So ${w} has $${(total / 100).toFixed(2)}.`,
  ], 'Count each kind of coin first, add the cents, then change to dollars: 100 cents = $1.');
};
const fractionsQ = (y) => {
  if (y <= 2) {
    const [w] = names(1), it = thing(), d = pick([2, 4]), n = d * ri(2, 6);
    return explain(int('fractions', `${w} has ${n} ${it}s and gives ${d === 2 ? 'half' : 'a quarter'} of them away. How many are given away?`, n / d), [
      `${d === 2 ? 'Half' : 'A quarter'} means 1 of ${d} equal shares.`,
      `${n} ÷ ${d} = ${n / d}.`,
      `So ${n / d} ${it}s are given away.`,
    ], 'Half means divide by 2; a quarter means divide by 4.');
  }
  // a fraction is only ever an option on the real paper
  if (y <= 4) {
    const d = pick([3, 4, 5, 6, 8]), a = ri(1, d - 2), b = ri(1, d - a - 1), g = gcd(a + b, d), rn = (a + b) / g, rd = d / g;
    return explain(frac('fractions', `What is ${a}/${d} + ${b}/${d}? Give your answer in its simplest form.`, a + b, d, { mcOnly: true }), [
      `The bottoms are the same, so add the tops: ${a} + ${b} = ${a + b}.`,
      `${a}/${d} + ${b}/${d} = ${a + b}/${d}.`,
      g > 1 ? `Simplify: divide the top and the bottom by ${g}: ${rn}/${rd}.` : `${a + b} and ${d} share no factor, so it is already in its simplest form.`,
      `So the answer is ${rn}/${rd}.`,
    ], 'Same bottom: add the tops, keep the bottom, then simplify.');
  }
  const d1 = pick([2, 3, 4]), d2 = pick([3, 4, 6]), n1 = 1, n2 = 1; if (d1 === d2) return null; const n = n1 * d2 + n2 * d1, d = d1 * d2; if (n >= d) return null;
  const L = lcm(d1, d2), t1 = L / d1, t2 = L / d2, g = gcd(t1 + t2, L), rn = (t1 + t2) / g, rd = L / g;
  return explain(frac('fractions', `What is 1/${d1} + 1/${d2}? Give your answer in its simplest form.`, n, d, { mcOnly: true }), [
    `Make the bottoms the same: ${L} is a multiple of both ${d1} and ${d2}.`,
    `1/${d1} = ${t1}/${L} and 1/${d2} = ${t2}/${L}.`,
    `${t1}/${L} + ${t2}/${L} = ${t1 + t2}/${L}.`,
    g > 1 ? `Simplify: divide the top and the bottom by ${g}: ${rn}/${rd}.` : `${t1 + t2} and ${L} share no factor, so it is already in its simplest form.`,
    `So 1/${d1} + 1/${d2} = ${rn}/${rd}.`,
  ], 'Different bottoms: change both to the same bottom first, then add the tops.');
};

// ---- the paper's tiers (20 Sep 2026): the staples of the 2023 papers ----
const graphMoney = (y) => {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu'], vals = labels.map(() => ri(3, band(y) === 3 ? 30 : 12) * 5), price = pick([2, 3, 4, 5, 8]), i = ri(0, 3), f = bars('Tickets sold', null, labels.map((l, k) => [l, vals[k]])), all = sum(vals);
  if (ri(1, 2) === 1) return explain(withFigure(int('graphs', `The bar graph shows the tickets a museum sold on four days. Each ticket costs ${money(price)}. How much money did the museum take on ${labels[i]}, in dollars?`, price * vals[i]), f), [
    `Read the bar for ${labels[i]}: ${vals[i]} tickets.`,
    `${vals[i]} tickets × $${price} = $${price * vals[i]}.`,
    `So the museum took $${price * vals[i]} on ${labels[i]}.`,
  ], 'Read the bar first, then multiply by the price.');
  return explain(withFigure(int('graphs', `The bar graph shows the tickets a museum sold on four days. Each ticket costs ${money(price)}. How much money did the museum take over the four days altogether, in dollars?`, price * all), f), [
    `Read the four bars: ${vals.join(', ')}.`,
    `Tickets altogether: ${vals.join(' + ')} = ${all}.`,
    `${all} × $${price} = $${price * all}.`,
    `So the museum took $${price * all} over the four days.`,
  ], 'Add the bars first, then multiply once by the price.');
};
const changeFromNotes = () => {
  const [n, v] = pick([[2, 50], [1, 50], [3, 10], [2, 20], [1, 100]]), paid = n * v, cents = ri(105, paid * 100 - 5), cost = cents / 100, change = (paid * 100 - cents) / 100, [w] = names(1), up = cents % 100 === 0 ? 0 : 100 - (cents % 100), next = (cents + up) / 100;
  return explain(dec('money', `${w} buys a book for $${cost.toFixed(2)} and pays with ${n === 1 ? 'a' : n} $${v} note${n > 1 ? 's' : ''}. How much change is there, in dollars?`, change), [
    `${n === 1 ? 'One' : n} $${v} note${pl(n)} = $${paid}.`,
    up ? `Count on from $${cost.toFixed(2)}: ${up} cents brings it to $${next}.` : `The price is a whole number of dollars: $${cost}.`,
    next < paid ? `From $${next} to $${paid} is $${paid - next} more.` : `That already reaches $${paid}.`,
    `Change: ${up ? (next < paid ? `${up} cents + $${paid - next}` : `${up} cents`) : `$${paid} − $${cost}`} = $${change.toFixed(2)}, that is ${Math.round(change * 100) / 100} dollars.`,
  ], 'Count on from the price to the next dollar, then up to the note: that is the change.');
};
const bulkDeal = (y) => {
  const k = pick([3, 4, 5, 6]), p = ri(2, 9), n = k * ri(2, band(y) === 1 ? 4 : 8), it = thing(), cost = (n / k) * p;
  return explain(int('price lists', `${cap(it)}s are sold at ${k} for ${money(p)}. How much do ${n} cost, in dollars?`, cost), [
    `${n} ${it}s make ${n} ÷ ${k} = ${n / k} groups of ${k}.`,
    `Each group costs $${p}: ${n / k} × ${p} = ${cost}.`,
    `So ${n} ${it}s cost $${cost}.`,
  ], 'Count the groups first, then multiply by the price of one group.');
};
const spacing = () => {
  const n = ri(4, 8), w = pick([20, 25, 30, 35, 40, 50]), g = pick([15, 25, 40, 60, 75, 100, 125]), len = n * w + (n - 1) * g;
  return explain(int('spacing', `${n} bins, each ${w} cm wide, stand in a row with equal gaps between them. The row is ${len} cm long from the left edge of the first bin to the right edge of the last. How wide is each gap, in cm?`, g), [
    `The bins themselves take ${n} × ${w} = ${n * w} cm.`,
    `The gaps take the rest: ${len} − ${n * w} = ${(n - 1) * g} cm.`,
    `${n} bins in a row have ${n - 1} gaps between them: ${(n - 1) * g} ÷ ${n - 1} = ${g}.`,
    `So each gap is ${g} cm wide.`,
  ], 'Things in a row have one fewer gap than things.');
};
const twoQuantities = () => {
  const a = ri(30, 150), b = ri(10, 60), n1 = pick([3, 4, 5]), n2 = ri(1, n1 - 1), [x, z] = pick([['wallet', 'pouch'], ['tray', 'dish'], ['case', 'brush'], ['crate', 'box']]), c1 = a + n1 * b, c2 = a + n2 * b, dn = n1 - n2;
  return explain(int('units and parts', `A ${x} and ${n1} ${z}es cost ${money(c1)}. The same ${x} and ${n2} ${z}${n2 > 1 ? 'es' : ''} cost ${money(c2)}. How much does the ${x} cost, in dollars?`, a), [
    `The two buys differ by ${n1} − ${n2} = ${dn} ${z}${dn > 1 ? 'es' : ''} and by $${c1} − $${c2} = $${dn * b}.`,
    `So 1 ${z} costs ${dn * b} ÷ ${dn} = $${b}.`,
    `Take the ${z}${n2 > 1 ? 'es' : ''} out of the second buy: ${c2} − ${n2} × ${b} = ${c2} − ${n2 * b} = ${a}.`,
    `So the ${x} costs $${a}.`,
  ], 'Compare the two buys: what is different between them costs the difference in price.');
};
const shortOf = () => {
  const price = ri(6, 40) * 10, n1 = ri(3, 6), n2 = n1 + ri(2, 5), had = price * n1 + ri(1, 9) * 20, left = had - price * n1, short = price * n2 - had; if (short <= 0) return null; const [w] = names(1);
  return explain(int('units and parts', `${w} has just enough money to buy ${n1} cookies with ${left} cents left over, but would be ${short} cents short of buying ${n2} cookies. What is the price of a cookie, in cents?`, price), [
    `${n1} cookies leave ${left} cents spare; ${n2} cookies need ${short} cents more than ${w} has.`,
    `So the extra ${n2} − ${n1} = ${n2 - n1} cookies cost ${left} + ${short} = ${left + short} cents.`,
    `${left + short} ÷ ${n2 - n1} = ${price}.`,
    `So a cookie costs ${price} cents.`,
  ], 'Left over plus short is what the extra cookies cost.');
};
const permutations = () => {
  const n = pick([3, 4]), what = pick(['stand in a row for a photo', 'sit in a row on a bench', 'line up at a counter']), ways = n === 3 ? 6 : 24;
  return explain(int('permutations', `In how many different orders can ${n} friends ${what}?`, ways), n === 3 ? [
    'Call them A, B and C and list every order: ABC, ACB, BAC, BCA, CAB, CBA.',
    'Any of the 3 can be first, then either of the 2 left, then the last one: 3 × 2 × 1 = 6.',
    'So there are 6 different orders.',
  ] : [
    'Call them A, B, C and D. With A first, the other three can be arranged in 6 ways: ABCD, ABDC, ACBD, ACDB, ADBC, ADCB.',
    'Each of the 4 friends can be first, and each gives 6 orders: 4 × 6 = 24.',
    'So there are 24 different orders.',
  ], 'Fix who is first, count the orders of the rest, then multiply by the choices for first.');
};
const cycleStars = (y) => {
  const b = band(y), cols = shuffle(['red', 'blue', 'green', 'yellow']).slice(0, 3), pat = [cols[0], cols[0], cols[1], cols[2]], n = b === 1 ? ri(12, 40) : b === 2 ? ri(30, 120) : ri(200, 999), ask = ri(0, 2), per = ask === 0 ? 2 : 1, full = Math.floor(n / 4), rem = n % 4, extra = pat.slice(0, rem).filter((c) => c === cols[ask]).length, count = full * per + extra;
  return explain(int('repeating patterns', `A row of ${n} stars is coloured in a repeating pattern: ${pat.join(', ')}, ${pat.join(', ')}, and so on. How many ${cols[ask]} stars are there?`, count), [
    `The pattern repeats every 4 stars, and each group of 4 has ${per} ${cols[ask]} star${pl(per)}.`,
    `${n} ÷ 4 = ${full} full groups${rem ? ` with ${rem} star${pl(rem)} left over` : ' exactly'}.`,
    `${full} groups × ${per} = ${full * per}${rem ? `, and the ${rem} leftover star${pl(rem)} (${pat.slice(0, rem).join(', ')}) ${rem === 1 ? 'adds' : 'add'} ${extra ? `${extra} more` : `no ${cols[ask]}`}` : ''}.`,
    `So there are ${count} ${cols[ask]} stars.`,
  ], 'Find the repeating block, count how many whole blocks fit, then look at the leftover part.');
};
const agesQ = (y = 5) => {
  const k = pick([3, 4, 5, 6]), x = ri(4, 12), who = pick(['son', 'daughter']), total = (k + 1) * x;
  return explain(int('ages', `A mother is ${k} times as old as her ${who}. Their ages add up to ${total}. How old is the child?`, x), [
    bar('Child', 1, unitWord(y, 1)),
    bar('Mother', k, unitWord(y, k)),
    `Together: ${unitWord(y, k + 1)} = ${total}, so ${unitWord(y, 1)} = ${total} ÷ ${k + 1} = ${x}.`,
    `So the child is ${x} years old.`,
  ], '"Times as old" is a comparison model: draw the child as 1 bar and the mother as that many equal bars.');
};
const ratioChange = () => {
  const a = ri(2, 6), b = ri(1, 6), u = ri(6, 30), p = ri(2, a * u - 4), q = ri(2, 40); if (gcd(a, b) !== 1 || a === b) return null; const m2 = a * u - p, w2 = b * u + q, g = gcd(m2, w2); if (g < 4 || m2 * b === w2 * a) return null;
  const r1 = m2 / g, r2 = w2 / g, lhs = a * r2, rhs = b * r1;
  return explain(int('ratio with a change', `The ratio of men to women in a club was ${a} : ${b}. After ${p} men left and ${q} women joined, the ratio became ${r1} : ${r2}. How many men were in the club at first?`, a * u), [
    `At first: men ${a} units, women ${b} units.`,
    `Now: men ${a} units − ${p}, women ${b} units + ${q}, and men : women = ${r1} : ${r2}.`,
    `So ${r2} × (${a} units − ${p}) = ${r1} × (${b} units + ${q}): ${lhs} units − ${p * r2} = ${rhs} units + ${q * r1}.`,
    `${lhs - rhs} units = ${p * r2 + q * r1}, so 1 unit = ${p * r2 + q * r1} ÷ ${lhs - rhs} = ${u}.`,
    `Men at first: ${a} × ${u} = ${a * u}. So there were ${a * u} men at first.`,
  ], 'Keep the first ratio as units, write the new ratio as a balance of units, then find one unit.');
};
const avgLeavers = () => {
  const n = ri(6, 15), avg1 = ri(20, 60) * 5, avg2 = avg1 - ri(3, 20) * 5, lost = n * (avg1 - avg2);
  return explain(int('averages', `${n} pupils have ${money(avg1)} each on average. Two of them lose all their money, and the average for all ${n} pupils becomes ${money(avg2)}. How much money was lost altogether, in dollars?`, lost), [
    `Total at first: ${n} × ${avg1} = ${n * avg1}.`,
    `Total after: ${n} × ${avg2} = ${n * avg2}.`,
    `Lost: ${n * avg1} − ${n * avg2} = ${lost}.`,
    `So $${lost} was lost altogether.`,
  ], 'Average × how many = the total; compare the two totals.');
};
const discountGST = () => {
  const p = pick([200, 400, 500, 800, 1000, 1500, 2000, 2500]), d = pick([10, 15, 20, 25, 30]), g = pick([5, 8, 9, 10]), v = (p * (100 - d) * (100 + g)) / 10000; if (!Number.isInteger(v)) return null;
  const sale = (p * (100 - d)) / 100, tax = v - sale;
  return explain(int('discount and tax', `A laptop is priced at ${money(p)}. In a sale ${d}% is taken off, then ${g}% tax is added to the sale price. What is the final price, in dollars?`, v), [
    `Sale price: ${100 - d}% of ${p} = ${p} × ${100 - d} ÷ 100 = ${sale}.`,
    `Tax: ${g}% of ${sale} = ${sale} × ${g} ÷ 100 = ${tax}.`,
    `${sale} + ${tax} = ${v}.`,
    `So the final price is $${v}.`,
  ], 'Take the discount off first; the tax is worked out on the sale price, not the old price.');
};
const workTogether = () => {
  const [t1, t2, h] = pick([[6, 3, 2], [4, 4, 2], [6, 12, 4], [10, 15, 6], [4, 12, 3], [8, 8, 4], [5, 20, 4], [12, 6, 4], [3, 6, 2]]), L = lcm(t1, t2), ra = L / t1, rb = L / t2;
  return explain(int('work rate', `Robot A can paint a wall in ${t1} hours and robot B can paint the same wall in ${t2} hours. Working together at the same rates, how many minutes do they take to paint the wall?`, h * 60), [
    `Think of the wall as ${L} equal parts (${L} is a multiple of both ${t1} and ${t2}).`,
    `A paints ${ra} part${pl(ra)} an hour and B paints ${rb}: together ${ra} + ${rb} = ${ra + rb} parts an hour.`,
    `${L} ÷ ${ra + rb} = ${h} hours.`,
    `${h} × 60 = ${h * 60}. So they take ${h * 60} minutes.`,
  ], 'Cut the job into parts that both times divide, then add the parts each does in an hour.');
};
const shelvesLCM = () => {
  const [a, b, c] = pick([[4, 5, 7], [3, 4, 5], [4, 6, 9], [5, 6, 8], [3, 5, 7], [6, 8, 10]]), l = lcm(lcm(a, b), c), k = ri(2, Math.max(2, Math.floor(999 / l))), lo = Math.floor((k * l) / 100) * 100, hi = lo + 100; if (k * l > 999 || Math.floor(hi / l) - Math.floor(lo / l) !== 1 || (k * l) % 100 === 0) return null;
  return explain(int('common multiples', `A library has between ${lo} and ${hi} books. They can be arranged on shelves of ${a}, of ${b} or of ${c} with none left over. How many books are there?`, k * l), [
    `A number that ${a}, ${b} and ${c} all divide is a common multiple of them; the smallest is ${l}.`,
    `The multiples of ${l} near ${lo}: ${(k - 1) * l}, ${k * l}, ${(k + 1) * l}.`,
    `Only ${k * l} is between ${lo} and ${hi}.`,
    `So there are ${k * l} books.`,
  ], '"None left over" for several shelf sizes means a common multiple: find the smallest, then count up.');
};
const fruitRatio = () => {
  const a = ri(2, 9), b = ri(2, 9), p = pick([2, 3, 4, 5]), q = pick([2, 3, 4, 5]); if (gcd(a, b) !== 1 || a === b) return null; const u = lcm(p, q) * ri(2, 12), rotten = (a * u) / p + (b * u) / q; if (!Number.isInteger(rotten)) return null;
  const m = lcm(p, q), small = u / m, ra = (a * m) / p, rb = (b * m) / q;
  return explain(int('ratio and fractions', `The ratio of apples to oranges in a crate was ${a} : ${b}. Then 1/${p} of the apples and 1/${q} of the oranges went rotten, ${rotten} fruits in all. How many fruits were in the crate at first?`, (a + b) * u), [
    `Make units that both fractions can cut: apples ${a * m} units, oranges ${b * m} units (still ${a} : ${b}).`,
    `Rotten apples: ${a * m} ÷ ${p} = ${ra} units. Rotten oranges: ${b * m} ÷ ${q} = ${rb} units.`,
    `${ra} + ${rb} = ${ra + rb} units = ${rotten} fruits, so 1 unit = ${rotten} ÷ ${ra + rb} = ${small}.`,
    `All the fruit: ${(a + b) * m} units × ${small} = ${(a + b) * u}.`,
    `So there were ${(a + b) * u} fruits in the crate at first.`,
  ], 'Choose units that every fraction in the question can divide, so no unit is ever split.');
};
const spendTwice = () => {
  const p = pick([4, 5, 8, 10]), n = ri(1, 4), q = pick([5, 6, 8, 10]); if (n >= q) return null; const x2 = ri(20, 200) * 10, c1 = ri(1, 9) * 10, c2 = ri(1, 9) * 10, x1 = ((x2 + c2) * q) / (q - n); if (!Number.isInteger(x1)) return null; const x0 = ((x1 + c1) * p) / (p - 1); if (!Number.isInteger(x0)) return null; const [w] = names(1);
  const g = gcd(n, q), n2 = n / g, q2 = q / g, X = x2 + c2, Y = x1 + c1;
  return explain(int('working backwards', `${w} spent 1/${p} of ${w}'s savings and another ${money(c1)} on a bag, then ${n}/${q} of the remaining money and another ${money(c2)} on shoes. ${w} then had ${money(x2)} left. How much did ${w} have at first, in dollars?`, x0), [
    `Start at the end: $${x2} left after the shoes.`,
    `Before the extra $${c2} there was ${x2} + ${c2} = ${X}. That is ${q2 - n2} units out of ${q2} (${n2}/${q2} was spent).`,
    `1 unit = ${X} ÷ ${q2 - n2} = ${X / (q2 - n2)}, so after the bag there was ${q2} × ${X / (q2 - n2)} = ${x1}.`,
    `Before the extra $${c1} there was ${x1} + ${c1} = ${Y}. That is ${p - 1} units out of ${p} (1/${p} was spent).`,
    `1 unit = ${Y} ÷ ${p - 1} = ${Y / (p - 1)}, so the savings were ${p} × ${Y / (p - 1)} = ${x0}.`,
    `So ${w} had $${x0} at first.`,
  ], 'Work backwards: undo the fixed amount first, then the fraction, one purchase at a time.');
};
const meetOnTrack = () => {
  const v1 = pick([10, 12, 14, 15, 16]), v2 = pick([10, 12, 14, 15, 16, 18]), m = pick([15, 20, 30, 33, 36, 45]); if (v1 === v2) return null; const L = ((v1 + v2) * m) / 60, shown = Math.round(L * 100) / 100; if (shown !== L) return null;
  return explain(int('meeting', `Two joggers start from the same point on a ${shown} km circular track at the same time and run in opposite directions at ${v1} km/h and ${v2} km/h. After how many minutes do they meet?`, m), [
    `Running opposite ways, together they cover ${v1} + ${v2} = ${v1 + v2} km every hour.`,
    `They meet when together they have run the whole track, ${shown} km.`,
    `${shown} ÷ ${v1 + v2} of an hour = ${shown} ÷ ${v1 + v2} × 60 = ${m} minutes.`,
    `So they meet after ${m} minutes.`,
  ], 'Moving towards each other, add the speeds; the distance to share is the whole track.');
};

// ---- the widened pools (20 Sep 2026): the Singapore-syllabus heuristics the thin sections lacked — comparison and part–whole
// models, transfers, equal groups, money and measures, time, patterns, ages, excess and shortage, coins of two kinds, weighing,
// joined tables, posts and gaps — most serving Grades 1–4 with numbers scaled by band, and the harder ones Grades 5–6 too ----
const compareTimes = (y) => {
  const b = band(y), [a, c] = names(2), it = thing(), k = b === 1 ? pick([2, 3]) : pick([2, 3, 4, 5]), u = b === 1 ? ri(2, 10) : ri(4, 40), total = (k + 1) * u, askBig = ri(1, 2) === 1, who = askBig ? a : c, ans = askBig ? k * u : u;
  return explain(int('comparison model', `${a} has ${k} times as many ${it}s as ${c}. Together they have ${total} ${it}s. How many ${it}s does ${who} have?`, ans), [
    bar(c, 1, unitWord(y, 1)),
    bar(a, k, unitWord(y, k)),
    `Together: ${unitWord(y, k + 1)} = ${total}, so ${unitWord(y, 1)} = ${total} ÷ ${k + 1} = ${u}.`,
    askBig ? `${a} has ${unitWord(y, k)}: ${k} × ${u} = ${k * u}.` : `${c} has ${unitWord(y, 1)}, which is ${u}.`,
    `So ${who} has ${ans} ${it}s.`,
  ], 'Draw the smaller amount as 1 bar and the bigger as that many equal bars, then share the total among all the bars.');
};
const howManyMore = (y) => {
  const b = band(y), [a, c] = names(2), it = thing(), lo = b === 1 ? ri(3, 20) : ri(15, 90), d = b === 1 ? ri(2, 9) : ri(6, 45), hi = lo + d;
  if (ri(1, 2) === 1) return explain(int('how many more', `${a} has ${hi} ${it}s and ${c} has ${lo} ${it}s. How many more ${it}s does ${a} have than ${c}?`, d), [
    `Line them up: ${a} ${hi}, ${c} ${lo}.`,
    `"How many more" is the difference: ${hi} − ${lo} = ${d}.`,
    `So ${a} has ${d} more ${it}s than ${c}.`,
  ], '"How many more" or "how many fewer" means subtract the smaller from the bigger.');
  return explain(int('how many more', `${c} has ${lo} ${it}s. ${a} has ${hi} ${it}s. How many more ${it}s must ${c} get to have as many as ${a}?`, d), [
    `${c} needs to go from ${lo} up to ${hi}.`,
    `Count on: ${hi} − ${lo} = ${d}.`,
    `So ${c} must get ${d} more ${it}s.`,
  ], 'To find how many more are needed, count on from the smaller number to the bigger.');
};
const threeParts = (y) => {
  const b = band(y), [c1, c2, c3] = shuffle(['red', 'blue', 'green', 'yellow', 'white']).slice(0, 3), it = pick(['marble', 'bead', 'button', 'balloon']), p = b === 1 ? ri(2, 12) : ri(10, 60), q = b === 1 ? ri(2, 12) : ri(10, 60), r = b === 1 ? ri(2, 12) : ri(10, 60), total = p + q + r;
  return explain(int('three parts', `A box holds ${total} ${it}s in three colours. ${p} are ${c1} and ${q} are ${c2}. The rest are ${c3}. How many ${c3} ${it}s are there?`, r), [
    `The whole is ${total}; two of the three parts are ${p} and ${q}.`,
    `${p} + ${q} = ${p + q}.`,
    `${total} − ${p + q} = ${r}.`,
    `So there are ${r} ${c3} ${it}s.`,
  ], 'Part–whole with three parts: add the parts you know, then take them from the whole.');
};
const equalGroups = (y) => {
  const b = band(y), [w] = names(1), it = pick(['sweet', 'sticker', 'marble', 'card']), k = b === 1 ? ri(2, 5) : ri(3, 9), each = b === 1 ? ri(2, 6) : ri(4, 12), left = ri(1, k - 1), total = k * each + left, askLeft = ri(1, 2) === 1;
  return explain(int('equal groups', `${w} shares ${total} ${it}s equally among ${k} friends, giving each friend as many as possible. How many ${it}s ${askLeft ? 'are left over' : 'does each friend get'}?`, askLeft ? left : each), [
    `Count in ${k}s: ${k} × ${each} = ${k * each}, and ${k} × ${each + 1} = ${k * (each + 1)} is too many.`,
    `So each friend gets ${each} ${it}s, using ${k * each} of them.`,
    `${total} − ${k * each} = ${left} left over.`,
    askLeft ? `So ${left} ${it}${pl(left)} ${left === 1 ? 'is' : 'are'} left over.` : `So each friend gets ${each} ${it}s.`,
  ], 'Sharing with some left over: find the biggest multiple that fits, then see what remains.');
};
const shopping = (y) => {
  const b = band(y), [w] = names(1), [x, z] = pick([['pen', 'ruler'], ['ball', 'kite'], ['book', 'puzzle'], ['cap', 'bag'], ['toy car', 'yo-yo']]), p1 = b === 1 ? ri(2, 9) : ri(6, 45), p2 = b === 1 ? ri(2, 9) : ri(6, 45), paid = b === 1 ? pick([20, 30, 50]) : pick([50, 100]); if (p1 + p2 >= paid) return null;
  return explain(int('shopping', `${w} buys a ${x} for ${money(p1)} and a ${z} for ${money(p2)} and pays with a ${money(paid)} note. How much change does ${w} get, in dollars?`, paid - p1 - p2), [
    `Spent altogether: ${p1} + ${p2} = ${p1 + p2}.`,
    `Change: ${paid} − ${p1 + p2} = ${paid - p1 - p2}.`,
    `So ${w} gets $${paid - p1 - p2} change.`,
  ], 'Add up what was bought first, then take it from what was paid.');
};
const twoUnits = (y) => {
  const b = band(y), i = ri(0, 2), [U, u, f] = [['m', 'cm', 100], ['kg', 'g', 1000], ['L', 'ml', 1000]][i], big = b === 1 ? ri(1, 3) : ri(2, 9), small = b === 1 ? ri(1, 9) * 10 : ri(1, 99) * 10, total = big * f + small, take = b === 1 ? ri(1, 9) * 10 : ri(2, 99) * 10;
  if (small >= f || take >= total) return null;
  const text = i === 0 ? `A ribbon is ${big} m ${small} cm long. ${take} cm is cut off. How long is the ribbon now, in cm?` : i === 1 ? `A sack of flour weighs ${big} kg ${small} g. ${take} g of flour is used. How much flour is left, in g?` : `A jug holds ${big} L ${small} ml of juice. ${take} ml is poured out. How much juice is left, in ml?`;
  return explain(int('measures in two units', text, total - take), [
    `1 ${U} = ${f} ${u}, so ${big} ${U} = ${big} × ${f} = ${big * f} ${u}.`,
    `${big} ${U} ${small} ${u} = ${big * f} + ${small} = ${total} ${u}.`,
    `${total} − ${take} = ${total - take}.`,
    `So ${total - take} ${u} ${i === 0 ? 'is the length now' : 'is left'}.`,
  ], 'Change everything into the small unit first, then subtract.');
};
const timeInterval = (y) => {
  const b = band(y), h = ri(1, 9), m = b === 1 ? pick([0, 30]) : pick([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]), start = h * 60 + m, d = b === 1 ? pick([30, 60, 90, 120]) : ri(7, 27) * 5, end = start + d, what = pick(['A film', 'A football match', 'A swimming lesson', 'A bus journey']);
  const lines = [], parts = []; let t = start;
  if (m > 0 && start + (60 - m) < end) { lines.push(`From ${hm(start)} to ${hm(start + 60 - m)} is ${60 - m} minutes.`); parts.push(60 - m); t = start + 60 - m; }
  const lastHour = end - (end % 60), hours = t % 60 === 0 && lastHour > t ? (lastHour - t) / 60 : 0;
  if (hours > 0) { lines.push(`From ${hm(t)} to ${hm(lastHour)} is ${hours} hour${pl(hours)} = ${hours * 60} minutes.`); parts.push(hours * 60); t = lastHour; }
  if (end > t) { lines.push(t % 60 ? `From ${hm(t)} to ${hm(end)} is ${end % 60} − ${t % 60} = ${end - t} minutes.` : `From ${hm(t)} to ${hm(end)} is ${end - t} minutes.`); parts.push(end - t); }
  if (parts.length > 1) lines.push(`${parts.join(' + ')} = ${d}.`);
  lines.push(`So it lasts ${d} minutes.`);
  return explain(int('time intervals', `${what} starts at ${hm(start)} and ends at ${hm(end)}. How long does it last, in minutes?`, d), lines, 'Count on in pieces: to the next hour, then whole hours, then the last minutes.');
};
const growingPattern = (y) => {
  const b = band(y), a0 = ri(1, 9), step = b === 1 ? ri(2, 5) : ri(3, 9), n = b === 1 ? ri(6, 10) : ri(10, 20), terms = Array.from({ length: 4 }, (_, i) => a0 + i * step), nth = a0 + (n - 1) * step;
  return explain(int('growing pattern', `${terms.join(', ')}, … The numbers go on in the same way. What is the ${ord(n)} number?`, nth), [
    `Look at the jumps: ${terms[1]} − ${terms[0]} = ${step} and ${terms[2]} − ${terms[1]} = ${step}. Each number is ${step} more than the one before.`,
    `From the 1st number to the ${ord(n)} there are ${n - 1} jumps: ${n - 1} × ${step} = ${(n - 1) * step}.`,
    `${a0} + ${(n - 1) * step} = ${nth}.`,
    `So the ${ord(n)} number is ${nth}.`,
  ], 'Count the jumps, not the numbers: the nth number is the first one plus n − 1 jumps.');
};
const ageDifference = (y) => {
  const b = band(y), [w] = names(1), c = b === 1 ? ri(5, 9) : ri(6, 12), d = b === 1 ? ri(20, 30) : ri(22, 38), t = b === 1 ? ri(2, 5) : ri(3, 12), who = pick(['mother', 'father', 'aunt', 'uncle']);
  return explain(int('age difference', `${w} is ${c} years old. ${w}'s ${who} is ${d} years older than ${w}. How old will ${w}'s ${who} be in ${t} years?`, c + d + t), [
    `${cap(who)} now: ${c} + ${d} = ${c + d}.`,
    `In ${t} years: ${c + d} + ${t} = ${c + d + t}.`,
    `So ${w}'s ${who} will be ${c + d + t} years old.`,
  ], 'Do one step at a time: the age now first, then the years ahead.');
};
const excessShortage = (y) => {
  const b = band(y), [w] = names(1), it = pick(['sticker', 'sweet', 'marble', 'card']), n = b === 1 ? ri(3, 8) : ri(5, 15), k = b === 1 ? ri(2, 4) : ri(3, 8), m = k + (b === 1 ? 1 : ri(1, 3)), p = b === 1 ? ri(1, 6) : ri(2, 20), total = k * n + p, q = m * n - total; if (q <= 0) return null;
  const askItems = b !== 1 && ri(1, 2) === 1;
  return explain(int('excess and shortage', `${w} shares some ${it}s among ${w}'s friends. If each friend gets ${k}, there are ${p} left over. If each friend gets ${m}, ${w} is ${q} short. How many ${askItems ? `${it}s does ${w} have` : 'friends are there'}?`, askItems ? total : n), [
    `Going from ${k} each to ${m} each gives every friend ${m - k} more.`,
    `That uses up the ${p} left over and still needs ${q} more: ${p} + ${q} = ${p + q}.`,
    `${p + q} ÷ ${m - k} = ${n} friends.`,
    askItems ? `${n} friends × ${k} + ${p} left over = ${total}. So ${w} has ${total} ${it}s.` : `So there are ${n} friends.`,
  ], 'Excess + shortage = the extra handed out; divide by the extra each one gets.');
};
const giveToEqual = (y) => {
  const b = band(y), [a, c] = names(2), it = thing(), lo = b === 1 ? ri(2, 12) : ri(10, 60), g = b === 1 ? ri(1, 5) : ri(3, 20), hi = lo + 2 * g;
  return explain(int('sharing to make equal', `${a} has ${hi} ${it}s and ${c} has ${lo} ${it}s. How many ${it}s must ${a} give to ${c} so that they have the same number?`, g), [
    `The difference is ${hi} − ${lo} = ${2 * g}.`,
    `Every ${it} ${a} gives closes the gap by 2: one fewer for ${a}, one more for ${c}.`,
    `${2 * g} ÷ 2 = ${g}.`,
    `Check: ${hi} − ${g} = ${hi - g} and ${lo} + ${g} = ${lo + g}. So ${a} must give ${g} ${it}${pl(g)}.`,
  ], 'To make two amounts equal, give half the difference.');
};
const busStops = (y) => {
  const b = band(y), first = b === 1 ? ri(8, 20) : ri(15, 45), off1 = ri(2, Math.min(9, first - 1)), on1 = b === 1 ? ri(2, 8) : ri(3, 14), after1 = first - off1 + on1, tip = 'Work backwards from the end and undo each stop: getting off becomes adding, getting on becomes taking away.';
  if (b === 1) {
    const off2 = ri(1, Math.min(9, after1 - 1)), now = after1 - off2;
    return explain(int('passengers', `A bus had some passengers. At the first stop ${off1} got off and ${on1} got on. At the second stop ${off2} got off. Now there are ${now} passengers. How many were on the bus at first?`, first), [
      `Start at the end: ${now} passengers now.`,
      `Undo the second stop: ${now} + ${off2} = ${after1}.`,
      `Undo the first stop: ${after1} − ${on1} = ${after1 - on1}, then ${after1 - on1} + ${off1} = ${first}.`,
      `So there were ${first} passengers at first.`,
    ], tip);
  }
  const off2 = ri(2, Math.min(12, after1 - 1)), on2 = ri(2, 12), after2 = after1 - off2 + on2, off3 = ri(2, Math.min(12, after2 - 1)), now = after2 - off3;
  return explain(int('passengers', `A bus had some passengers. At the first stop ${off1} got off and ${on1} got on. At the second stop ${off2} got off and ${on2} got on. At the third stop ${off3} got off. Now there are ${now} passengers. How many were on the bus at first?`, first), [
    `Start at the end: ${now} passengers now.`,
    `Undo the third stop: ${now} + ${off3} = ${after2}.`,
    `Undo the second stop: ${after2} − ${on2} + ${off2} = ${after1}.`,
    `Undo the first stop: ${after1} − ${on1} + ${off1} = ${first}.`,
    `So there were ${first} passengers at first.`,
  ], tip);
};
const simpleRatio = () => {
  const [a, c] = names(2), it = thing(), p = ri(1, 5), q = ri(1, 5), u = ri(3, 12); if (p === q || gcd(p, q) !== 1) return null;
  return explain(int('simple ratio', `${a} and ${c} share ${(p + q) * u} ${it}s in the ratio ${p} : ${q}. How many ${it}s does ${a} get?`, p * u), [
    bar(a, p, `${p} unit${pl(p)}`),
    bar(c, q, `${q} unit${pl(q)}`),
    `${p + q} units = ${(p + q) * u}, so 1 unit = ${(p + q) * u} ÷ ${p + q} = ${u}.`,
    `${a} gets ${p} unit${pl(p)}: ${p} × ${u} = ${p * u}.`,
    `So ${a} gets ${p * u} ${it}s.`,
  ], 'A ratio says how many equal units each side has; share the total among all the units.');
};
const fractionOfSet = () => {
  const d = pick([3, 4, 5, 6, 8]), nn = ri(1, d - 1), u = ri(2, 12), total = d * u, [it, part, rest] = pick([['pupils in a class', 'girls', 'boys'], ['marbles in a bag', 'red', 'blue'], ['cars in a car park', 'white', 'not white'], ['books on a shelf', 'story books', 'not story books']]); if (gcd(nn, d) !== 1) return null;
  return explain(int('fraction of a set', `${nn}/${d} of the ${total} ${it} are ${part}. How many are ${rest}?`, (d - nn) * u), [
    `Cut ${total} into ${d} equal units: 1 unit = ${total} ÷ ${d} = ${u}.`,
    `${cap(part)}: ${nn} unit${pl(nn)} = ${nn * u}. ${cap(rest)}: the other ${d - nn} unit${pl(d - nn)}.`,
    `${d - nn} × ${u} = ${(d - nn) * u}.`,
    `So ${(d - nn) * u} are ${rest}.`,
  ], 'A fraction of a set: divide by the bottom number to get one unit, then count the units you need.');
};
const rowsPattern = (y) => {
  const b = band(y), first = b === 1 ? ri(2, 5) : ri(3, 8), step = b === 1 ? ri(1, 3) : ri(2, 5), n = b === 1 ? ri(4, 6) : ri(6, 10), rows = Array.from({ length: n }, (_, i) => first + i * step), total = sum(rows), [what, where] = pick([['chairs', 'a hall'], ['tiles', 'a path'], ['cans', 'a display'], ['seats', 'a theatre']]);
  return explain(int('rows of chairs', `In ${where}, the 1st row has ${first} ${what}, and each row after it has ${step} more ${what} than the row before. How many ${what} are there in the first ${n} rows altogether?`, total), [
    `Write out the rows: ${rows.join(', ')}.`,
    `Add them: ${rows.join(' + ')} = ${total}.`,
    ...(n % 2 === 0 ? [`Check by pairing the ends: ${rows[0]} + ${rows[n - 1]} = ${rows[0] + rows[n - 1]}, and ${n / 2} pairs × ${rows[0] + rows[n - 1]} = ${total}.`] : []),
    `So there are ${total} ${what} in the first ${n} rows.`,
  ], 'Write the rows out and add; pairing the first and last rows checks the sum quickly.');
};
const countingWays = (y) => {
  const b = band(y), [w] = names(1), a = b === 1 ? ri(2, 4) : ri(3, 6), c = b === 1 ? ri(2, 3) : ri(2, 5), third = b !== 1 && ri(1, 2) === 1 ? ri(2, 3) : 0, ways = a * c * (third || 1);
  return explain(int('counting ways', `${w} has ${a} shirts${third ? `, ${c} pairs of shorts and ${third} caps` : ` and ${c} pairs of shorts`}. How many different outfits (${third ? 'a shirt, a pair of shorts and a cap' : 'a shirt and a pair of shorts'}) can ${w} make?`, ways), [
    `For each of the ${a} shirts there are ${c} choices of shorts: ${a} × ${c} = ${a * c}.`,
    ...(third ? [`Each of those ${a * c} pairs goes with any of the ${third} caps: ${a * c} × ${third} = ${ways}.`] : []),
    `So ${w} can make ${ways} different outfits.`,
  ], 'Choices made one after another multiply: for each first choice, branch out the second.');
};
const fencePosts = (y) => {
  const b = band(y), g = b === 1 ? pick([2, 5, 10]) : pick([3, 4, 5, 6, 8]), gaps = b === 1 ? ri(3, 10) : ri(8, 30), L = g * gaps, loop = b !== 1 && ri(1, 2) === 1, tip = 'Along a line, posts = gaps + 1; round a closed loop, posts = gaps.';
  if (loop) return explain(int('fence posts', `Posts are placed every ${g} m around a circular pond that is ${L} m round. How many posts are there?`, gaps), [
    `All the way round, the gaps add up to ${L} m: ${L} ÷ ${g} = ${gaps} gaps.`,
    'Round a closed loop every post starts one gap, so there are as many posts as gaps.',
    `So there are ${gaps} posts.`,
  ], tip);
  return explain(int('fence posts', `Posts are placed every ${g} m along a straight fence ${L} m long, with a post at each end. How many posts are there?`, gaps + 1), [
    `${L} ÷ ${g} = ${gaps} gaps.`,
    `A straight line has one more post than gaps: ${gaps} + 1 = ${gaps + 1}.`,
    `So there are ${gaps + 1} posts.`,
  ], tip);
};
const gapAfterGiving = (y) => {
  const b = band(y), [a, c] = names(2), it = thing(), g = b === 1 ? ri(1, 4) : ri(3, 15), d = 2 * g + (b === 1 ? ri(1, 6) : ri(2, 20));
  return explain(int('gap after giving', `${a} has ${d} more ${it}s than ${c}. After ${a} gives ${c} ${g} ${it}${pl(g)}, how many more ${it}s does ${a} have than ${c}?`, d - 2 * g), [
    `${a} gives ${g} away and ${c} gets ${g}, so the gap closes by ${g} + ${g} = ${2 * g}.`,
    `${d} − ${2 * g} = ${d - 2 * g}.`,
    `So ${a} now has ${d - 2 * g} more ${it}s than ${c}.`,
  ], 'A gift closes the gap by twice its size: one side loses it and the other gains it.');
};
const agesApart = (y) => {
  const b = band(y), [w] = names(1);
  if (b === 1) {
    const c = ri(4, 10), k = pick([3, 4, 5]), dad = k * c;
    return explain(int('ages apart', `${w} is ${c} years old. ${w}'s father is ${k} times as old as ${w}. How old was the father when ${w} was born?`, dad - c), [
      bar(w, 1, unitWord(y, 1)),
      bar('Father', k, unitWord(y, k)),
      `Father now: ${k} × ${c} = ${dad}.`,
      `The gap between their ages never changes: ${dad} − ${c} = ${dad - c}.`,
      `When ${w} was born, ${w} was 0, so the father was ${dad - c}. So the father was ${dad - c} years old.`,
    ], 'The gap between two ages never changes, however many years pass.');
  }
  const c = ri(4, 12), m = pick([2, 3, 4]), t = ri(2, 15), later = c + t, M = m * later - t; if (M - c < 18 || M > 60) return null;
  return explain(int('ages apart', `${w} is ${c} years old and ${w}'s mother is ${M} years old. In how many years will the mother be ${m} times as old as ${w}?`, t), [
    `The gap between their ages never changes: ${M} − ${c} = ${M - c}.`,
    'Then:',
    bar(w, 1, '1 unit'),
    bar('Mother', m, `${m} units`),
    `The gap is ${m - 1} unit${pl(m - 1)} = ${M - c}, so 1 unit = ${M - c} ÷ ${m - 1} = ${later}: that is ${w}'s age then.`,
    `${later} − ${c} = ${t}. So the mother will be ${m} times as old in ${t} years.`,
  ], 'The gap between two ages never changes: use it to find one unit in the later model.');
};
const coinsTwoKinds = (y) => {
  const b = band(y), [w] = names(1), [lo, hi] = b === 1 ? [10, 50] : pick([[10, 50], [20, 50], [10, 20], [5, 20]]), n = b === 1 ? ri(4, 8) : ri(8, 20), r = ri(1, n - 1), total = lo * (n - r) + hi * r;
  return explain(int('coins of two kinds', `${w} has ${n} coins. Some are ${lo}-cent coins and the rest are ${hi}-cent coins. Altogether they are worth ${total} cents. How many ${hi}-cent coins are there?`, r), [
    `Pretend all ${n} coins are ${lo}-cent coins: ${n} × ${lo} = ${n * lo} cents.`,
    `The real total is ${total} cents, so ${total} − ${n * lo} = ${total - n * lo} cents are extra.`,
    `Swapping one ${lo}-cent coin for a ${hi}-cent coin adds ${hi - lo} cents: ${total - n * lo} ÷ ${hi - lo} = ${r}.`,
    `So there ${r === 1 ? 'is' : 'are'} ${r} ${hi}-cent coin${pl(r)}.`,
  ], 'Pretend every coin is the small one, then see how many swaps the extra cents need.');
};
const shareThree = (y) => {
  const b = band(y), [a, c, e] = names(3), it = thing(), u = b === 1 ? ri(2, 8) : ri(5, 30), d = b === 1 ? ri(1, 5) : ri(2, 20), k = b === 1 ? 2 : pick([2, 3, 4]), total = (k + 2) * u + d, askE = b !== 1 && ri(1, 2) === 1;
  return explain(int('three friends share', `${a}, ${c} and ${e} share ${total} ${it}s. ${c} has ${d} more than ${a}, and ${e} has ${k} times as many as ${a}. How many ${it}s does ${askE ? e : a} have?`, askE ? k * u : u), [
    bar(a, 1, unitWord(y, 1)),
    bar(c, 1, `${unitWord(y, 1)} + ${d}`),
    bar(e, k, unitWord(y, k)),
    `Together: ${unitWord(y, k + 2)} + ${d} = ${total}, so ${unitWord(y, k + 2)} = ${total} − ${d} = ${total - d}.`,
    `${unitWord(y, 1)} = ${total - d} ÷ ${k + 2} = ${u}.`,
    askE ? `${e} has ${unitWord(y, k)}: ${k} × ${u} = ${k * u}. So ${e} has ${k * u} ${it}s.` : `So ${a} has ${u} ${it}s.`,
  ], 'Draw the one everyone is compared with as 1 bar, build the others from it, then take the extra off the total.');
};
const weighing = (y) => {
  const b = band(y), [big, small] = pick([['pear', 'plum'], ['melon', 'apple'], ['pumpkin', 'pear'], ['brick', 'block']]), k = b === 1 ? 2 : ri(2, 4), p = b === 1 ? 1 : ri(1, 3), q = b === 1 ? ri(1, 3) : ri(1, 4), unit = b === 1 ? ri(1, 5) * 10 : ri(4, 30) * 5, total = (p * k + q) * unit;
  const an = /^[aeiou]/.test(small) ? 'an' : 'a';
  return explain(int('weighing', `A ${big} weighs as much as ${k} ${small}s. ${p} ${big}${pl(p)} and ${q} ${small}${pl(q)} together weigh ${total} g. How much does ${an} ${small} weigh, in grams?`, unit), [
    `Swap each ${big} for ${k} ${small}s: ${p} ${big}${pl(p)} = ${p} × ${k} = ${p * k} ${small}s.`,
    `So ${p * k} + ${q} = ${p * k + q} ${small}s weigh ${total} g.`,
    `${total} ÷ ${p * k + q} = ${unit}.`,
    `So ${an} ${small} weighs ${unit} g.`,
  ], 'Swap the heavy thing for the light things it equals, so only one kind is left to share.');
};
const joinedTables = (y) => {
  if (band(y) === 1) {
    const n = ri(3, 8), seats = 2 * n + 2;
    return explain(int('joined tables', `1 square table seats 4 people. When 2 tables are joined in a row they seat 6, and 3 tables in a row seat 8. How many people can sit at ${n} tables joined in a row?`, seats), [
      'Each extra table adds 2 seats: 4, 6, 8, 10, and so on.',
      `${n} tables: 4 + ${n - 1} × 2 = 4 + ${2 * (n - 1)} = ${seats}.`,
      `So ${seats} people can sit at ${n} tables.`,
    ], 'Look at what each new table adds, then count the extra tables.');
  }
  const n = ri(6, 24), seats = 2 * n + 2;
  return explain(int('joined tables', `1 square table seats 4 people. When 2 tables are joined in a row they seat 6, and 3 tables in a row seat 8. How many tables joined in a row are needed to seat exactly ${seats} people?`, n), [
    'Each extra table adds 2 seats, and 1 table seats 4.',
    `${seats} − 4 = ${seats - 4} seats come from the extra tables: ${seats - 4} ÷ 2 = ${(seats - 4) / 2} extra tables.`,
    `1 + ${(seats - 4) / 2} = ${n}.`,
    `So ${n} tables are needed.`,
  ], 'Look at what each new table adds, then work back from the seats to the tables.');
};
const quizScores = () => {
  const [w] = names(1), n = ri(10, 20), p = pick([4, 5, 10]), q = pick([1, 2, 3]), wrong = ri(1, 5), right = n - wrong, score = p * right - q * wrong;
  return explain(int('quiz scores', `In a quiz of ${n} questions, ${p} points are given for each correct answer and ${q} point${pl(q)} ${q === 1 ? 'is' : 'are'} taken away for each wrong one. ${w} answered all ${n} questions and scored ${score} points. How many did ${w} get right?`, right), [
    `Pretend all ${n} answers are right: ${n} × ${p} = ${n * p} points.`,
    `The real score is ${score}, so ${n * p} − ${score} = ${n * p - score} points were lost.`,
    `Each wrong answer loses the ${p} it would have earned and ${q} more: ${p} + ${q} = ${p + q}. ${n * p - score} ÷ ${p + q} = ${wrong} wrong.`,
    `${n} − ${wrong} = ${right}. So ${w} got ${right} right.`,
  ], 'Pretend all are right, then each wrong answer costs the points it would have earned plus the penalty.');
};
const perimeterComposite = () => {
  if (ri(1, 2) === 1) {
    const k = ri(2, 5), sd = ri(2, 12), per = 2 * sd * (k + 1);
    return explain(int('perimeter of a composite', `${k} identical squares, each with sides of ${sd} cm, are placed in a row to form a rectangle. What is the perimeter of the rectangle, in cm?`, per), [
      `The rectangle is ${k} × ${sd} = ${k * sd} cm long and ${sd} cm wide.`,
      `Perimeter = 2 × (${k * sd} + ${sd}) = 2 × ${k * sd + sd} = ${per}.`,
      `So the perimeter is ${per} cm.`,
    ], 'Squares in a row make a rectangle: find its length and width, then use the perimeter rule.');
  }
  const L = ri(8, 25), W = ri(6, 20), l = ri(2, L - 3), w = ri(2, W - 3);
  return explain(int('perimeter of a composite', `A ${l} cm by ${w} cm rectangle is cut from one corner of a ${L} cm by ${W} cm rectangle. What is the perimeter of the L-shape that is left, in cm?`, 2 * (L + W)), [
    'Slide the two cut edges out to the corner: the L-shape has exactly the same perimeter as the full rectangle.',
    `2 × (${L} + ${W}) = 2 × ${L + W} = ${2 * (L + W)}.`,
    `So the perimeter is ${2 * (L + W)} cm.`,
  ], 'Cutting a corner from a rectangle does not change its perimeter: push the edges back out.');
};

const T = (cat, gen, ...sections) => ({ cat, gen, sections });
const R = (cat, gen, ...sections) => ({ cat, gen, sections, repeatable: true }); // the syllabus pool may serve a heat more than once
// the kinds added on 20 Sep 2026 that serve Grades 1–4 alike, numbers scaled by band; each pool adds its own beyond these
const WIDER_1_2 = [T('comparison model', compareTimes, 'M2'), T('how many more', howManyMore, 'M2'), T('three parts', threeParts, 'M2'), T('equal groups', equalGroups, 'M2'), T('shopping', shopping, 'M2'), T('measures in two units', twoUnits, 'M2', 'M3'), T('time intervals', timeInterval, 'M2', 'M3'), T('growing pattern', growingPattern, 'M2', 'M3'), T('age difference', ageDifference, 'M2'),
  T('excess and shortage', excessShortage, 'M3', 'M4'), T('sharing to make equal', giveToEqual, 'M3'), T('passengers', busStops, 'M3', 'M4'), T('rows of chairs', rowsPattern, 'M3'), T('counting ways', countingWays, 'M3'), T('fence posts', fencePosts, 'M3', 'M4'), T('gap after giving', gapAfterGiving, 'M3', 'M4'),
  T('ages apart', agesApart, 'M4'), T('coins of two kinds', coinsTwoKinds, 'M4'), T('three friends share', shareThree, 'M4'), T('weighing', weighing, 'M4'), T('joined tables', joinedTables, 'M4')];
const POOL_1 = [R('syllabus', syllabus, 'M2', 'M3'), R('syllabus 2', syllabus, 'M2', 'M3'), T('listing', listing, 'M3'), T('before and after', beforeAfter, 'M3'), T('guess and check', guessCheck, 'M3', 'M4'), T('working backwards', workBack, 'M3', 'M4'), T('sum and difference', gapDiff, 'M2'), T('geometry', geometry, 'M2', 'M3'), T('digits', digitsQ, 'M2', 'M3', 'M4'), T('time and money', timeMoney, 'M2'), T('fractions', fractionsQ, 'M2'), T('price lists', bulkDeal, 'M2', 'M3'), T('ages', agesQ, 'M4'), T('repeating patterns', cycleStars, 'M4'),
  ...WIDER_1_2];
const POOL_2 = [R('syllabus', syllabus, 'M2', 'M3'), R('syllabus 2', syllabus, 'M2', 'M3'), R('graphs', syllabus, 'M2', 'M3'), T('listing', listing, 'M2'), T('before and after', beforeAfter, 'M3'), T('guess and check', guessCheck, 'M3', 'M4'), T('working backwards', workBack, 'M3'), T('sum and difference', gapDiff, 'M2'), T('geometry', geometry, 'M2', 'M3', 'M4'), T('digits', digitsQ, 'M2', 'M3'), T('time and money', timeMoney, 'M2'), T('fractions', fractionsQ, 'M2'),
  T('graph money', graphMoney, 'M3'), T('change', changeFromNotes, 'M2', 'M3'), T('price lists', bulkDeal, 'M2'), T('spacing', spacing, 'M4'), T('units and parts', twoQuantities, 'M4'), T('short of', shortOf, 'M4'), T('permutations', permutations, 'M2', 'M3'), T('repeating patterns', cycleStars, 'M3'), T('ages', agesQ, 'M3'),
  ...WIDER_1_2, T('simple ratio', simpleRatio, 'M3'), T('fraction of a set', fractionOfSet, 'M3'), T('quiz scores', quizScores, 'M4'), T('perimeter of a composite', perimeterComposite, 'M3', 'M4')];
const POOL_3 = [R('syllabus', syllabus, 'M2', 'M3'), R('syllabus 2', syllabus, 'M2', 'M3'), R('graphs', syllabus, 'M2', 'M3'), T('listing', listing, 'M2'), T('before and after', beforeAfter, 'M2'), T('guess and check', guessCheck, 'M2', 'M3'), T('working backwards', workBack, 'M2', 'M3'), T('fraction of a remainder', remainderFrac, 'M3', 'M4'), T('sum and difference', gapDiff, 'M2'), T('ratio and percentage', units, 'M2', 'M3'), T('geometry', geometry, 'M2', 'M3', 'M4'), T('digits', digitsQ, 'M2'), T('time and money', timeMoney, 'M2'), T('fractions', fractionsQ, 'M2'),
  T('graph money', graphMoney, 'M3'), T('change', changeFromNotes, 'M2'), T('spacing', spacing, 'M3'), T('units and parts', twoQuantities, 'M3'), T('short of', shortOf, 'M3'), T('repeating patterns', cycleStars, 'M2'), T('ages', agesQ, 'M2'),
  T('ratio with a change', ratioChange, 'M4'), T('averages', avgLeavers, 'M4'), T('discount and tax', discountGST, 'M4'), T('work rate', workTogether, 'M4'), T('common multiples', shelvesLCM, 'M3', 'M4'), T('ratio and fractions', fruitRatio, 'M4'), T('spending twice', spendTwice, 'M4'), T('meeting', meetOnTrack, 'M4'),
  T('simple ratio', simpleRatio, 'M2'), T('fraction of a set', fractionOfSet, 'M2'), T('fence posts', fencePosts, 'M2'), T('counting ways', countingWays, 'M2'), T('joined tables', joinedTables, 'M2'), T('weighing', weighing, 'M2'), T('perimeter of a composite', perimeterComposite, 'M2'), T('excess and shortage', excessShortage, 'M3'), T('quiz scores', quizScores, 'M3'), T('ages apart', agesApart, 'M3'), T('coins of two kinds', coinsTwoKinds, 'M3'), T('three friends share', shareThree, 'M3')];
const POOL = (y) => (band(y) === 1 ? POOL_1 : band(y) === 2 ? POOL_2 : POOL_3);
// the real paper (the 2023 contest papers): 90 minutes for 40 questions at Grades 1–2, 45 at Grades 3–4 and 32 at Grades 5–6,
// 100 marks, almost all typed on an answer sheet with a few four-option items at Grades 2–4 and none at 5–6, climbing from 2
// to 4 marks. Three sections by marks, the 90 minutes split 30 + 30 + 30 (the owner, 20 Sep 2026)
const n = (y, a, b, c) => (band(y) === 1 ? a : band(y) === 2 ? b : c);
export const PHASES = [
  phase('alpha', '2 marks', 2, 30, (y) => slots([['M2', 'mc', band(y) === 3 ? 0 : 2], ['M2', 'sa', n(y, 14, 15, 12)]])),
  phase('beta', '3 marks', 3, 30, (y) => slots([['M3', 'sa', n(y, 14, 16, 11)]])),
  phase('gamma', '4 marks', 4, 30, (y) => slots([['M4', 'sa', n(y, 10, 12, 9)]]))];
export const build = (shape, year) => buildHeat(shape, POOL(year), year, { options: 4 });
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['2 marks: the Singapore-standard word problems, sum and difference, coins round a square, halves and quarters', '3 marks: towers and lists, chickens and rabbits, working backwards, before and after, pages with a digit', '4 marks: ages that add up, a repeating row of stars, the harder heuristics', 'almost all typed, as the real paper: only two multiple choice'] },
  { band: 'Grades 3–4', lines: ['2 marks: the word problems, two-digit numbers from digits, change from notes, orders in a row', '3 marks: a bar graph then money, before and after, repeating patterns, ages, composite figures', '4 marks: gaps between bins, a wallet and its pouches, short of the price, bent wire', 'almost all typed, as the real paper: only two multiple choice'] },
  { band: 'Grades 5–6', lines: ['2 marks: the word problems, ratio and percentage, the largest number from digits, a repeating row of stars', '3 marks: fraction of a remainder, a bar graph then money, spacing, units and parts, books on shelves', '4 marks: a ratio with a change, averages after a loss, a discount then tax, robots painting together', 'apples and oranges gone rotten, spending twice, joggers meeting round a track, circles with π = 3.14'] },
];
