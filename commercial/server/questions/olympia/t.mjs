// 🏮 T-MOON — practice modelled on WMI (the World Mathematics Invitational, Taiwan); not affiliated. The real preliminary is
// split into two named halves, Section A "Logical Reasoning" and Section B "Applications", every question multiple choice of
// four options, and its topic chart puts logical reasoning, word problems and a "math puzzle" at every grade from kindergarten
// up. Section A is 15 questions — ten at six marks, five at eight — and Section B ten at ten marks, 40 minutes each (wminv.org,
// the official samples with keys and the retyped 2022 papers; the source check of 20 Sep 2026). So a heat is three six-mark and
// two eight-mark logic questions, then five applications, one paper per grade as WMI has it; the kinds after "the paper's
// tiers" are the staples of those papers the first build lacked — sequences that interleave, rule machines, positions in a
// row, the assumption method, three balances, symbol equations, order of operations, unit traps, remainders, decimals.
// Every seed carries its worked solution in the child's method (STEPS.md, 20 Sep 2026), and the pools were widened the same
// day for the real paper's ten-slot sections: Grades 1–2 got WMI's K–2 applications (counting a picture, lengths, coins,
// o'clock and half past, days of the week, number stories, equal groups, queues, sides and corners, the ruler trap) and more
// logic; Grades 5–6 got growing sequences, swapped digits, handshakes, cuts and pieces, page numbers.
import { ri, pick, shuffle, sum, names, thing, int, dec, mcOnly, withFigure, grid, table, bars, buildHeat, slots, phase, explain, bar, isPrime, gcd, lcm, cap, factorsOf } from './common.mjs';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const money = (n) => `Rp${n.toLocaleString('en-US')}`;
const SHAPES = [['🔺', 'triangle'], ['🔵', 'circle'], ['🟩', 'square'], ['⭐', 'star']];
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
// a bar-model row only when it can be drawn box by box (bar() stops at 24 boxes); explain() drops the empty line otherwise
const barIf = (label, n, note = '') => (n >= 1 && n <= 20 ? bar(label, n, note) : '');
const pl = (n) => (n === 1 ? '' : 's');

// ---- Section A: logical reasoning ----
const lineUp = (y) => {
  const w = names(y <= 2 ? 3 : 4);
  const tip = 'Write the names in a row as you read each clue, then count from the front.';
  if (y <= 2) return explain(mcOnly('order and direction', `Three children stand in a line. ${w[0]} is in front of ${w[1]}. ${w[2]} is behind ${w[1]}. Who is second in the line?`, w[1], [w[0], w[2], 'Cannot be decided']), [
    `${w[0]} is in front of ${w[1]}, so write ${w[0]} first: ${w[0]}, ${w[1]}.`,
    `${w[2]} is behind ${w[1]}, so ${w[2]} goes after ${w[1]}: ${w[0]}, ${w[1]}, ${w[2]}.`,
    `Count from the front: ${w[0]} is first, ${w[1]} is second, ${w[2]} is third.`,
    `So ${w[1]} is second in the line.`,
  ], tip);
  const order = shuffle(w), pos = ['first', 'second', 'third', 'last'], k = ri(1, 2); // first and last are stated: ask second or third
  return explain(mcOnly('order and direction', `Four children stand in a line. ${order[0]} is first. ${order[2]} is right behind ${order[1]}. ${order[3]} is last. Who is ${pos[k]}?`, order[k], order.filter((_, i) => i !== k)), [
    `${order[0]} is first and ${order[3]} is last, so the two middle places belong to ${order[1]} and ${order[2]}.`,
    `${order[2]} is right behind ${order[1]}, so ${order[1]} is second and ${order[2]} is third.`,
    `The line is ${order.join(', ')}.`,
    `So ${order[k]} is ${pos[k]}.`,
  ], tip);
};
const shapePattern = (y) => {
  const [a, b, c] = shuffle(SHAPES).slice(0, 3), period = y <= 2 ? pick([[a, b], [a, b, b], [a, a, b]]) : pick([[a, b, c], [a, b, b, c], [a, c, b, b]]), n = ri(9, 14);
  const seq = Array.from({ length: n }, (_, i) => period[i % period.length]), next = period[n % period.length], L = period.length, full = Math.floor(n / L), rest = n % L;
  return explain(mcOnly('patterns', `${seq.map((s) => s[0]).join(' ')} … Which shape comes next?`, next[0], SHAPES.filter((s) => s !== next).map((s) => s[0]), { read: `The pattern goes ${seq.map((s) => s[1]).join(', ')}. Which shape comes next: ${SHAPES.map((s) => s[1]).join(', ')}?` }), [
    `The pattern repeats in groups of ${L}: ${period.map((p) => p[1]).join(', ')}.`,
    `${n} shapes are shown: ${full} full groups${rest ? ` and ${rest} more` : ''} (${full} × ${L}${rest ? ` + ${rest}` : ''} = ${n}).`,
    rest ? `The next shape is the ${ord(rest + 1)} of a group: ${next[1]}.` : `The next shape starts a new group: ${next[1]}.`,
    `So the next shape is ${next[0]} (${next[1]}).`,
  ], 'Find the group that repeats, then count how many full groups have been used up.');
};
const oddOne = (y) => {
  const kind = y <= 2 ? 1 : y <= 4 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) {
    const evens = Array.from({ length: 3 }, () => ri(1, y <= 2 ? 20 : 50) * 2), odd = ri(1, y <= 2 ? 20 : 50) * 2 - 1, list = shuffle([...evens, odd]);
    return explain(mcOnly('odd one out', `Which number does not belong with the others: ${list.join(', ')}?`, odd, evens), [
      'Check whether each number is even or odd.',
      `${evens.join(', ')} are even: each ends in 0, 2, 4, 6 or 8.`,
      `${odd} is odd: it ends in ${odd % 10}.`,
      `So the number that does not belong is ${odd}.`,
    ], 'Even numbers end in 0, 2, 4, 6 or 8; odd numbers end in 1, 3, 5, 7 or 9.');
  }
  if (kind === 2) {
    const m = pick([3, 4, 5]), ins = Array.from({ length: 3 }, () => ri(2, 12) * m); let out = ri(5, 60); while (out % m === 0) out++;
    const list = shuffle([...ins, out]), lo = Math.floor(out / m);
    return explain(mcOnly('odd one out', `Which number does not belong with the others: ${list.join(', ')}?`, out, ins), [
      'Look for a times table the numbers share.',
      `${ins.map((x) => `${x} = ${m} × ${x / m}`).join(', ')}: all in the ${m} times table.`,
      `${out} is not: ${m} × ${lo} = ${m * lo} and ${m} × ${lo + 1} = ${m * (lo + 1)}, so ${out} is skipped.`,
      `So the number that does not belong is ${out}.`,
    ], 'When the numbers are not all odd or all even, look for a times table they share.');
  }
  const ps = shuffle([11, 13, 17, 19, 23, 29, 31, 37, 41]).slice(0, 3), comp = pick([15, 21, 25, 27, 33, 35, 39]), f = [3, 5, 7].find((d) => comp % d === 0), list = shuffle([...ps, comp]);
  return explain(mcOnly('odd one out', `Three of these numbers are prime. Which one is not: ${list.join(', ')}?`, comp, ps), [
    'A prime number has no factors except 1 and itself.',
    `${comp} = ${f} × ${comp / f}, so ${comp} has another factor and is not prime.`,
    `${ps.join(', ')} cannot be split like that: each is prime.`,
    `So the one that is not prime is ${comp}.`,
  ], 'To test a number for being prime, try dividing it by 2, 3, 5 and 7.');
};
const balance = (y) => {
  const [a, b] = shuffle([['🍎', 'apple'], ['🍐', 'pear'], ['🍊', 'orange'], ['🍋', 'lemon']]).slice(0, 2), p = ri(1, 3), q = ri(p + 1, y <= 2 ? 4 : 6), k = ri(2, y <= 2 ? 3 : 5);
  return explain(int('balance puzzles', `${a[0].repeat(p)} weighs the same as ${b[0].repeat(q)}. How many ${b[1]}s weigh the same as ${p * k} ${a[1]}s?`, q * k, { read: `${p} ${a[1]}${p > 1 ? 's' : ''} weigh the same as ${q} ${b[1]}s. How many ${b[1]}s weigh the same as ${p * k} ${a[1]}s?` }), [
    `${p} ${a[1]}${pl(p)} balance${p > 1 ? '' : 's'} ${q} ${b[1]}s.`,
    p > 1 ? `${p * k} ${a[1]}s make ${k} groups of ${p}: ${p * k} ÷ ${p} = ${k}.` : '',
    p > 1 ? `Swap each group for ${q} ${b[1]}s: ${k} × ${q} = ${q * k}.` : `Swap each of the ${k} ${a[1]}s for ${q} ${b[1]}s: ${k} × ${q} = ${q * k}.`,
    `So ${q * k} ${b[1]}s weigh the same as ${p * k} ${a[1]}s.`,
  ], p > 1 ? 'Count how many times the known group fits, then swap every group.' : 'Swap every one of the known fruit for what it balances.');
};
const ages = (y) => {
  const [a, b] = names(2);
  if (y <= 4) {
    const age = ri(5, 12), d = ri(2, 8), yrs = ri(2, 10);
    return explain(int('ages', `${a} is ${age} and ${b} is ${age + d}. How old will ${b} be when ${a} is ${age + yrs}?`, age + d + yrs), [
      `${b} is ${age + d} − ${age} = ${d} years older than ${a}, and that never changes.`,
      `${a} goes from ${age} to ${age + yrs}: ${yrs} years pass.`,
      `${b} also gets ${yrs} years older: ${age + d} + ${yrs} = ${age + d + yrs}.`,
      `So ${b} will be ${age + d + yrs}.`,
    ], 'The difference between two ages never changes.');
  }
  const x = ri(6, 14), d = ri(2, 8), yrs = ri(2, 8), total = 2 * x + d + 2 * yrs;
  return explain(int('ages', `${a} is ${d} years older than ${b}. In ${yrs} years their ages will add up to ${total}. How old is ${b} now?`, x), [
    `In ${yrs} years each of them is ${yrs} older, so take ${yrs} off twice: ${total} − ${2 * yrs} = ${2 * x + d}. That is what their ages add up to now.`,
    bar(b, 1, '?'),
    bar(a, 1, `+ ${d}`),
    `Take away the extra ${d}: ${2 * x + d} − ${d} = ${2 * x}, which is 2 equal units.`,
    `1 unit = ${2 * x} ÷ 2 = ${x}.`,
    `So ${b} is ${x} now.`,
  ], 'Take the years off first, then draw the two ages as bars with the difference sticking out.');
};
const calendar = (y) => {
  const d = ri(0, 6), n = y <= 2 ? ri(3, 12) : ri(14, 29), m = pick(['May', 'August', 'October']), r = n % 7, w = Math.floor(n / 7), end = (d + n) % 7;
  return explain(mcOnly('calendar logic', `The 1st of ${m} is a ${DAYS[d]}. What day of the week is the ${ord(n + 1)} of ${m}?`, DAYS[end], DAYS.filter((_, i) => i !== end).slice(0, 3)), [
    `From the 1st to the ${ord(n + 1)} is ${n} days on.`,
    w ? `${n} days is ${w} week${pl(w)}${r ? ` and ${r} day${pl(r)}` : ' exactly'} (7 × ${w}${r ? ` + ${r}` : ''} = ${n}).` : `${n} days is less than a week, so just count on.`,
    w ? `Every whole week lands back on a ${DAYS[d]}${r ? `, so only the ${r} extra day${pl(r)} matter${r === 1 ? 's' : ''}` : ''}.` : '',
    r ? `Count ${r} day${pl(r)} on from ${DAYS[d]}: ${Array.from({ length: r }, (_, i) => DAYS[(d + 1 + i) % 7]).join(', ')}.` : '',
    `So the ${ord(n + 1)} of ${m} is a ${DAYS[end]}.`,
  ], 'Every 7 days the same day of the week comes round again, so only the leftover days matter.');
};
const puzzle = (y) => {
  const kind = y <= 2 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) {
    const t = ri(6, y <= 2 ? 20 : 100), a = ri(1, t - 1);
    return explain(int('math puzzle', `${a} + ▢ = ${t}. What number is ▢?`, t - a, { read: `${a} plus what number makes ${t}?` }), [
      `${a} and ▢ are the two parts; ${t} is the whole.`,
      `Take the known part from the whole: ${t} − ${a} = ${t - a}.`,
      `Check: ${a} + ${t - a} = ${t}.`,
      `So ▢ is ${t - a}.`,
    ], 'Whole − the part you know = the missing part.');
  }
  if (kind === 2) {
    const a = ri(2, y <= 2 ? 9 : 12);
    return explain(int('math puzzle', `▢ + ▢ + ▢ = ${3 * a}. What number is ▢?`, a, { read: `Three of the same number add up to ${3 * a}. What is the number?` }), [
      `Three of the same number make ${3 * a}, so share ${3 * a} into 3 equal parts.`,
      `${3 * a} ÷ 3 = ${a}.`,
      `Check: ${a} + ${a} + ${a} = ${3 * a}.`,
      `So ▢ is ${a}.`,
    ], 'Equal parts of a total: share it out by dividing.');
  }
  const a = ri(2, 9), b = ri(2, 9), P = a * b, S = a + b, pairs = []; for (let p = 1; p * p <= P; p++) if (P % p === 0) pairs.push([p, P / p]);
  return explain(int('math puzzle', `▢ × △ = ${P} and ▢ + △ = ${S}. What is the bigger of the two numbers?`, Math.max(a, b), { read: `Two numbers multiply to ${P} and add to ${S}. What is the bigger one?` }), [
    `List the pairs that multiply to ${P}: ${pairs.map(([p, q]) => `${p} and ${q}`).join(', ')}.`,
    `Add each pair: ${pairs.map(([p, q]) => `${p} + ${q} = ${p + q}`).join(', ')}.`,
    `Only ${Math.min(a, b)} and ${Math.max(a, b)} add up to ${S}.`,
    `So the bigger of the two numbers is ${Math.max(a, b)}.`,
  ], 'List the pairs that multiply to the product, then pick the pair with the right sum.');
};
// with one liar the third friend is the one who CANNOT have done it; with one truth-teller it is the only one who can (the source check of 20 Sep 2026)
const truth = () => {
  const w = names(3);
  return explain(mcOnly('logic', `One of three friends broke a vase. ${w[0]} says: "It was ${w[1]}." ${w[1]} says: "It was not me." ${w[2]} says: "It was not me." Exactly one of them is telling the truth. Who broke the vase?`, w[2], [w[0], w[1], 'Cannot be decided']), [
    'Suppose each friend did it in turn and count the true statements.',
    `If ${w[0]} did it: ${w[0]} is lying, but ${w[1]} and ${w[2]} both tell the truth. 2 truths, not 1.`,
    `If ${w[1]} did it: ${w[0]} and ${w[2]} both tell the truth. 2 truths, not 1.`,
    `If ${w[2]} did it: ${w[0]} and ${w[2]} are lying and only ${w[1]} tells the truth. Exactly 1: this fits.`,
    `So ${w[2]} broke the vase.`,
  ], 'Suppose each person did it in turn, and count how many statements come out true.');
};
const countRange = (y) => {
  const a = ri(3, y <= 2 ? 9 : 20), b = a + ri(5, y <= 2 ? 12 : 40);
  return explain(int('counting', `How many whole numbers are there from ${a} to ${b}, counting both ${a} and ${b}?`, b - a + 1), [
    `${b} − ${a} = ${b - a} counts the jumps from ${a} to ${b}, not the numbers.`,
    `There is one more number than jumps: ${b - a} + 1 = ${b - a + 1}.`,
    `So there are ${b - a + 1} whole numbers from ${a} to ${b}.`,
  ], 'Last − first + 1 counts both ends.');
};
const legs = (y) => {
  const n = ri(2, y <= 2 ? 6 : 12), m = ri(1, y <= 2 ? 5 : 10);
  return explain(int('counting', `In a garden there are ${n} birds and ${m} cats. How many legs are there altogether?`, 2 * n + 4 * m), [
    `Each bird has 2 legs: ${n} × 2 = ${2 * n}.`,
    `Each cat has 4 legs: ${m} × 4 = ${4 * m}.`,
    `${2 * n} + ${4 * m} = ${2 * n + 4 * m}.`,
    `So there are ${2 * n + 4 * m} legs altogether.`,
  ], 'Count each kind of animal separately, then add.');
};
// the paper's tiers: Section A staples of the 2022 papers and the official samples
const orderOps = (y) => {
  const tip = 'Multiply and divide before you add and take away.';
  const twoDivs = (b, q1, d, q2) => explain(int('order of operations', `${b * q1} ÷ ${b} + ${d * q2} ÷ ${d} = ?`, q1 + q2), [
    `Do the two divisions first: ${b * q1} ÷ ${b} = ${q1} and ${d * q2} ÷ ${d} = ${q2}.`,
    `Then add: ${q1} + ${q2} = ${q1 + q2}.`,
    `So the answer is ${q1 + q2}.`,
  ], tip);
  if (y <= 4) return twoDivs(ri(2, 9), ri(3, 30), ri(2, 9), ri(2, 12));
  if (ri(1, 2) === 1) {
    const b = pick([2, 3, 4, 5, 6]), q1 = ri(20, 120), c = ri(11, 30), e = ri(11, 30);
    return explain(int('order of operations', `${b * q1} ÷ ${b} + ${c} × ${e} = ?`, q1 + c * e), [
      `Divide first: ${b * q1} ÷ ${b} = ${q1}.`,
      `Multiply next: ${c} × ${e} = ${c * e}.`,
      `Then add: ${q1} + ${c * e} = ${q1 + c * e}.`,
      `So the answer is ${q1 + c * e}.`,
    ], tip);
  }
  return twoDivs(ri(11, 29), ri(12, 40), ri(2, 9), ri(3, 12));
};
const interleaved = (y) => {
  const s1 = ri(1, 9), d1 = ri(2, y <= 2 ? 3 : 6), s2 = ri(1, 9), d2 = ri(1, y <= 2 ? 3 : 6); if (d1 === d2 && s1 === s2) return null;
  const n = y <= 2 ? 6 : 8, seq = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? s1 + (i / 2) * d1 : s2 + ((i - 1) / 2) * d2)), next = n % 2 === 0 ? s1 + (n / 2) * d1 : s2 + ((n - 1) / 2) * d2;
  const first = seq.filter((_, i) => i % 2 === 0), second = seq.filter((_, i) => i % 2 === 1), toFirst = n % 2 === 0, last = toFirst ? first.at(-1) : second.at(-1), jump = toFirst ? d1 : d2;
  return explain(int('number sequences', `${seq.join(', ')}, ? What number comes next?`, next), [
    'The jumps are not steady, so look at every other number.',
    `The 1st, 3rd, 5th … numbers: ${first.join(', ')}, going up by ${d1} each time.`,
    `The 2nd, 4th, 6th … numbers: ${second.join(', ')}, going up by ${d2} each time.`,
    `The missing number is the ${ord(n + 1)}, so it belongs to the ${toFirst ? 'first' : 'second'} chain: ${last} + ${jump} = ${next}.`,
    `So the next number is ${next}.`,
  ], 'When the jumps are not steady, check every other number: two patterns may be woven together.');
};
// a rule as the machine computes it, as the working shows it with the numbers in, and as a child would say it
const RULES = [
  ['a + b', (a, b) => a + b, (a, b) => `${a} + ${b}`, 'add the two numbers'],
  ['a × b', (a, b) => a * b, (a, b) => `${a} × ${b}`, 'multiply the two numbers'],
  ['2a + b', (a, b) => 2 * a + b, (a, b) => `2 × ${a} + ${b}`, 'double the first number, then add the second'],
  ['a + 2b', (a, b) => a + 2 * b, (a, b) => `${a} + 2 × ${b}`, 'double the second number, then add the first'],
  ['a × b − a', (a, b) => a * b - a, (a, b) => `${a} × ${b} − ${a}`, 'multiply the two numbers, then take away the first'],
  ['a + b + 1', (a, b) => a + b + 1, (a, b) => `${a} + ${b} + 1`, 'add the two numbers, then add 1'],
  ['2a − b', (a, b) => 2 * a - b, (a, b) => `2 × ${a} − ${b}`, 'double the first number, then take away the second'],
];
const ruleGuess = (y) => {
  const pool = y <= 2 ? RULES.slice(0, 4) : RULES, [, f, show, words] = pick(pool), ex = Array.from({ length: 3 }, () => [ri(1, y <= 2 ? 6 : 9), ri(1, y <= 2 ? 6 : 9)]), a = ri(2, 9), b = ri(2, 9);
  if (ex.some(([p, q]) => f(p, q) < 0) || new Set(ex.map(String)).size < 3 || f(a, b) < 0) return null;
  if (pool.some(([, g]) => g !== f && ex.every(([p, q]) => g(p, q) === f(p, q)))) return null;
  return explain(int('rule machine', `A machine turns two numbers into one: ${ex.map(([p, q]) => `${p} and ${q} give ${f(p, q)}`).join('; ')}. What does it give for ${a} and ${b}?`, f(a, b)), [
    `Try a rule on the examples: ${words}.`,
    `Check: ${ex.map(([p, q]) => `${show(p, q)} = ${f(p, q)}`).join(', ')}. It fits all three.`,
    `Use the rule for ${a} and ${b}: ${show(a, b)} = ${f(a, b)}.`,
    `So the machine gives ${f(a, b)}.`,
  ], 'Try adding, then multiplying, then doubling one number; keep the rule that fits every example.');
};
const positionRow = (y) => {
  const n = pick(y <= 2 ? [9, 13] : [13, 17, 21, 25, 29, 33]), c = (n + 1) / 2, w = names(3), v = (c + n) / 2;
  return explain(int('position in a row', `${n} children stand in a row. ${w[0]} is last. ${w[1]} is exactly in the centre of the row. ${w[2]} stands exactly halfway between ${w[1]} and ${w[0]}. Counting from the front, what position is ${w[2]} in?`, v), [
    `${w[0]} is last, so ${w[0]} is in position ${n}.`,
    `The centre of ${n} children has ${(n - 1) / 2} in front and ${(n - 1) / 2} behind, so ${w[1]} is in position ${c}.`,
    `From ${w[1]} at ${c} to ${w[0]} at ${n} is ${n - c} places; halfway is ${n - c} ÷ 2 = ${(n - c) / 2} places on.`,
    `${c} + ${(n - c) / 2} = ${v}.`,
    `So ${w[2]} is in position ${v}.`,
  ], 'Turn each clue into a position number, then find the middle by adding and halving.');
};
const assumption = (y) => {
  if (ri(1, 2) === 1) {
    const n = y <= 2 ? 10 : pick([10, 15, 20]), plus = y <= 2 ? pick([2, 5]) : pick([5, 8, 10]), minus = y <= 2 ? 1 : pick([2, 3, 4]), right = ri(Math.ceil(n / 2), n - 1), score = plus * right - minus * (n - right), wrong = n - right, [w] = names(1);
    return explain(int('assumption method', `A quiz has ${n} questions. A right answer scores ${plus} points and a wrong answer loses ${minus} points. ${w} answered all ${n} and scored ${score}. How many answers were wrong?`, wrong), [
      `Pretend all ${n} answers were right: ${n} × ${plus} = ${n * plus} points.`,
      `The real score is ${score}, which is ${n * plus - score} points less.`,
      `Each wrong answer costs ${plus} + ${minus} = ${plus + minus} points: the ${plus} not scored and the ${minus} lost.`,
      `${n * plus - score} ÷ ${plus + minus} = ${wrong}.`,
      `So ${wrong} answer${pl(wrong)} ${wrong === 1 ? 'was' : 'were'} wrong.`,
    ], 'Pretend every answer was right, then see how many points each wrong one takes away.');
  }
  const sh = ri(y <= 2 ? 5 : 15, y <= 2 ? 12 : 40), clovers = ri(1, y <= 2 ? 2 : 4), leaves = 3 * sh + 4 * clovers;
  return explain(int('assumption method', `A vase holds shamrocks with 3 leaves each and ${clovers} clover${clovers > 1 ? 's' : ''} with 4 leaves each. There are ${leaves} leaves altogether. How many shamrocks are there?`, sh), [
    `The ${clovers} clover${clovers > 1 ? 's have' : ' has'} ${clovers} × 4 = ${4 * clovers} leaves.`,
    `The other leaves belong to shamrocks: ${leaves} − ${4 * clovers} = ${3 * sh}.`,
    `Each shamrock has 3 leaves: ${3 * sh} ÷ 3 = ${sh}.`,
    `So there are ${sh} shamrocks.`,
  ], 'Take away the leaves you already know about, then share the rest.');
};
const threeBalances = (y) => {
  const fruits = shuffle([['🍎', 'apple'], ['🍌', 'banana'], ['🍒', 'cherry'], ['🍐', 'pear']]).slice(0, 3), [f1, f2, f3] = fruits, hi = y <= 2 ? 20 : 400, vals = [ri(2, hi), ri(2, hi), ri(2, hi)], ask = ri(0, 2), [a, b, c] = vals, total = a + b + c;
  const other = [b + c, a + c, a + b][ask], pair = [[f2, f3], [f1, f3], [f1, f2]][ask];
  return explain(int('three balances', `${f1[0]} and ${f2[0]} together weigh ${a + b} g. ${f2[0]} and ${f3[0]} together weigh ${b + c} g. ${f1[0]} and ${f3[0]} together weigh ${a + c} g. How much does one ${fruits[ask][1]} weigh, in grams?`, vals[ask], { read: `${cap(f1[1])} plus ${f2[1]} weighs ${a + b} grams; ${f2[1]} plus ${f3[1]} weighs ${b + c}; ${f1[1]} plus ${f3[1]} weighs ${a + c}. How much does one ${fruits[ask][1]} weigh?` }), [
    `Add all three weighings: ${a + b} + ${b + c} + ${a + c} = ${2 * total}. Every fruit is counted twice.`,
    `So one of each together weigh ${2 * total} ÷ 2 = ${total} g.`,
    `Take away the ${pair[0][1]} and ${pair[1][1]} pair: ${total} − ${other} = ${vals[ask]}.`,
    `So one ${fruits[ask][1]} weighs ${vals[ask]} g.`,
  ], 'Adding all three pairs counts each thing twice; halve it to get the total of the three.');
};
const symbolEq = (y) => {
  if (y <= 4 || ri(1, 2) === 1) {
    const o = ri(2, 30), t = ri(1, 40), s1 = 2 * t + o, s2 = 3 * o;
    return explain(int('symbol equations', `△ + ○ + △ = ${s1} and ○ + ○ + ○ = ${s2}. What is ○ × △?`, o * t, { read: `Triangle plus circle plus triangle is ${s1}; three circles make ${s2}. What is circle times triangle?` }), [
      `Three circles make ${s2}, so ○ = ${s2} ÷ 3 = ${o}.`,
      `Put ○ = ${o} into the first line: △ + △ = ${s1} − ${o} = ${2 * t}.`,
      `△ = ${2 * t} ÷ 2 = ${t}.`,
      `○ × △ = ${o} × ${t} = ${o * t}.`,
      `So ○ × △ is ${o * t}.`,
    ], 'Start with the line that has only one kind of symbol.');
  }
  const r = ri(2, 9);
  return explain(int('symbol equations', `▢ × ▢ × ▢ = ${r ** 3}. What number is ▢?`, r, { read: `A number multiplied by itself three times gives ${r ** 3}. What is the number?` }), [
    'Try numbers multiplied by themselves three times.',
    `${r} × ${r} = ${r * r}, and ${r * r} × ${r} = ${r ** 3}. That matches.`,
    `So ▢ is ${r}.`,
  ], 'Learn the cubes: 1, 8, 27, 64, 125, 216, 343, 512, 729.');
};
const adjacentRing = (y) => {
  const a = ri(1, 9), b = ri(1, 9), c = ri(0, 9), n = y <= 4 ? ri(8, 15) : ri(16, 40), row = [a, b, c], i = ri(4, n - 1), j = i + ri(1, 3); if (j > n) return null;
  const total = a + b + c, pi = (i - 1) % 3, pj = (j - 1) % 3, v = row[pi] + row[pj], why = (k, p) => (p === 2 ? `${k} is a multiple of 3` : `${k} is ${p + 1} more than a multiple of 3`);
  return explain(int('adjacent sums', `${n} boxes stand in a row, and the numbers in any three boxes next to each other add up to ${total}. The first box holds ${a} and the second holds ${b}. What is the number in box ${i} plus the number in box ${j}?`, v), [
    `Boxes 1, 2 and 3 add up to ${total}, so box 3 holds ${total} − ${a} − ${b} = ${c}.`,
    `Boxes 2, 3 and 4 add up to ${total} too, so box 4 holds ${a} again: the numbers repeat ${a}, ${b}, ${c}, ${a}, ${b}, ${c}, …`,
    `Box ${i} holds the same as box ${pi + 1}, because ${why(i, pi)}: ${row[pi]}.`,
    `Box ${j} holds the same as box ${pj + 1}, because ${why(j, pj)}: ${row[pj]}.`,
    `${row[pi]} + ${row[pj]} = ${v}.`,
    `So the two boxes add up to ${v}.`,
  ], 'When every three in a row add to the same total, the numbers repeat every three boxes.');
};
const countFigures = (y) => {
  const n = y <= 2 ? 2 : y <= 4 ? 3 : 4, parts = Array.from({ length: n }, (_, i) => (n - i) * (n - i)), total = sum(parts);
  return explain(withFigure(int('counting figures', `How many squares of every size are there in this ${n} by ${n} grid?`, total), grid('Count the squares', n, n)), [
    'Count by size, from the smallest squares up.',
    ...Array.from({ length: n }, (_, i) => `Squares ${i + 1} by ${i + 1}: ${n - i} × ${n - i} = ${(n - i) * (n - i)}.`),
    `${parts.join(' + ')} = ${total}.`,
    `So there are ${total} squares.`,
  ], 'Count the small squares first, then the bigger ones, then add them all.');
};

// ---- Section B: applications by grade ----
const addSubWords = (y) => {
  const [w] = names(1), it = thing();
  if (y === 1) {
    const a = ri(3, 12), b = ri(2, 20 - a);
    return explain(int('word problems', `${w} has ${a} ${it}s and gets ${b} more. How many ${it}s does ${w} have now?`, a + b), [
      bar('Had', a, `${a}`),
      bar('Got', b, `${b}`),
      'Getting more means adding: put the two parts together.',
      `${a} + ${b} = ${a + b}.`,
      `So ${w} has ${a + b} ${it}s now.`,
    ], 'Gets more means add: count on from the bigger number.');
  }
  const hi = y === 2 ? 100 : y <= 4 ? 1000 : 10000, a = ri(hi / 5, hi), b = ri(1, a);
  return explain(int('word problems', `A shop had ${a} ${it}s and sold ${b}. How many are left?`, a - b), [
    `Sold means taken away, so take ${b} from ${a}.`,
    `${a} − ${b} = ${a - b}.`,
    `Check by adding back: ${a - b} + ${b} = ${a}.`,
    `So ${a - b} ${it}s are left.`,
  ], 'Sold or given away means take away; check by adding back.');
};
const measure = () => {
  const kind = ri(1, 2), tip = 'Change the big unit first, then add the small part.';
  if (kind === 1) {
    const m = ri(2, 9), cm = ri(1, 99);
    return explain(int('units', `How many centimetres are there in ${m} m ${cm} cm?`, m * 100 + cm), [
      `1 m = 100 cm, so ${m} m = ${m} × 100 = ${m * 100} cm.`,
      `Add the extra centimetres: ${m * 100} + ${cm} = ${m * 100 + cm}.`,
      `So there are ${m * 100 + cm} centimetres.`,
    ], tip);
  }
  const kg = ri(1, 9), g = ri(1, 9) * 100;
  return explain(int('units', `How many grams are there in ${kg} kg ${g} g?`, kg * 1000 + g), [
    kg > 1 ? `1 kg = 1000 g, so ${kg} kg = ${kg} × 1000 = ${kg * 1000} g.` : '1 kg = 1000 g.',
    `Add the extra grams: ${kg * 1000} + ${g} = ${kg * 1000 + g}.`,
    `So there are ${kg * 1000 + g} grams.`,
  ], tip);
};
const dataQ = (y) => {
  const names4 = shuffle(['Adi', 'Sari', 'Bayu', 'Putri', 'Wira']).slice(0, 4), vals = names4.map(() => ri(1, y <= 2 ? 9 : 40)), what = pick(['stickers', 'books read', 'goals']);
  const hi = vals.indexOf(Math.max(...vals)), lo = vals.indexOf(Math.min(...vals)); if (hi === lo || new Set(vals).size !== vals.length) return null;
  const f = y <= 2 ? table(cap(what), ['Name', cap(what)], names4.map((n, i) => [n, '⭐'.repeat(vals[i])])) : bars(cap(what), null, names4.map((n, i) => [n, vals[i]]));
  const kind = ri(1, 3);
  const shows = `The ${y <= 2 ? 'picture graph' : 'bar chart'} shows how many ${what} four children have${y <= 2 ? ' (each ⭐ is one)' : ''}.`;
  const readAll = `Read each ${y <= 2 ? 'row' : 'bar'}: ${names4.map((n, i) => `${n} ${vals[i]}`).join(', ')}.`;
  if (kind === 1) return explain(withFigure(mcOnly('data and graphs', `${shows} Who has the most?`, names4[hi], names4.filter((_, i) => i !== hi)), f), [
    readAll,
    `The biggest number is ${vals[hi]}, and that is ${names4[hi]}'s.`,
    `So ${names4[hi]} has the most.`,
  ], 'Read the number for each person from the graph before you compare.');
  if (kind === 2) return explain(withFigure(int('data and graphs', `${shows} How many more does ${names4[hi]} have than ${names4[lo]}?`, vals[hi] - vals[lo]), f), [
    readAll,
    `${names4[hi]} has ${vals[hi]} and ${names4[lo]} has ${vals[lo]}.`,
    `${vals[hi]} − ${vals[lo]} = ${vals[hi] - vals[lo]}.`,
    `So ${names4[hi]} has ${vals[hi] - vals[lo]} more than ${names4[lo]}.`,
  ], 'How many more means take the smaller number from the bigger one.');
  return explain(withFigure(int('data and graphs', `${shows} How many altogether?`, sum(vals)), f), [
    readAll,
    `Add them: ${vals.join(' + ')} = ${sum(vals)}.`,
    `So there are ${sum(vals)} altogether.`,
  ], 'Altogether means add every number in the graph.');
};
const SHAPE_FACTS = [
  ['How many sides does a hexagon have?', 6, [5, 8, 4], 'Hex means 6, like the 6-sided cells of a honeycomb: a hexagon has 6 sides.'],
  ['How many sides does a pentagon have?', 5, [6, 4, 8], 'Pent means 5: a pentagon has 5 sides, like the outline of a house with a pointed roof.'],
  ['How many corners does a rectangle have?', 4, [3, 6, 8], 'A rectangle has 4 sides, and each side meets the next at a corner: 4 corners.'],
  ['How many sides does an octagon have?', 8, [6, 7, 10], 'Oct means 8, like an octopus with 8 arms: an octagon has 8 sides, the shape of a stop sign.'],
];
const shapesQ = () => {
  const c = pick(SHAPE_FACTS);
  return explain(mcOnly('shapes', c[0], c[1], c[2]), [c[3], `So the answer is ${c[1]}.`], 'The start of the name tells you the number: tri 3, quad 4, pent 5, hex 6, oct 8.');
};
const mulDiv = (y) => {
  const kind = ri(1, 2), [w] = names(1), it = thing();
  if (kind === 1) {
    const n = ri(2, y === 2 ? 5 : 9), k = ri(2, y === 2 ? 5 : 9);
    return explain(int('multiplication and division', `${w} puts ${k} ${it}s in each of ${n} boxes. How many ${it}s is that?`, n * k), [
      `There are ${n} boxes with ${k} ${it}s in each: ${n} groups of ${k}.`,
      `${Array(n).fill(k).join(' + ')} = ${n * k}, or ${n} × ${k} = ${n * k}.`,
      `So that is ${n * k} ${it}s.`,
    ], 'Equal groups: multiply the number of groups by the size of each group.');
  }
  const k = ri(2, y === 2 ? 5 : 9), n = ri(2, y === 2 ? 5 : 12);
  return explain(int('multiplication and division', `${w} shares ${n * k} ${it}s equally among ${k} friends. How many does each friend get?`, n), [
    `Share ${n * k} into ${k} equal groups: ${n * k} ÷ ${k} = ${n}.`,
    `Check: ${k} × ${n} = ${n * k}.`,
    `So each friend gets ${n} ${it}s.`,
  ], 'Sharing equally is dividing; check by multiplying back.');
};
const moneyQ = (y) => {
  const [w] = names(1);
  if (y <= 4) {
    const p = ri(2, 20) * 500, n = ri(2, 6), had = p * n + ri(1, 10) * 1000, it = thing(), left = had - p * n;
    return explain(int('money', `${w} has ${money(had)} and buys ${n} ${it}s at ${money(p)} each. How much money is left, in rupiah?`, left, { decoys: shuffle([left + 1000, left - 1000, left + 500, left + 5000, had - p * (n - 1), had - p].filter((x) => x > 0 && x !== left)).map(String) }), [
      `${n} ${it}s at ${money(p)} each cost ${n} × ${p} = ${p * n} rupiah.`,
      `Take that from the money ${w} had: ${had} − ${p * n} = ${left}.`,
      `So ${left} rupiah is left (${money(left)}).`,
    ], 'Work out the total cost first, then take it away from the money you started with.');
  }
  const p = pick([80000, 120000, 150000, 200000]), off = pick([10, 20, 25, 50]), up = pick([10, 20, 25]);
  const sale = p - (p * off) / 100, final = sale + (sale * up) / 100; if (!Number.isInteger(final)) return null;
  return explain(int('financial literacy', `A bag costs ${money(p)}. In a sale its price is cut by ${off}%. The next week the sale price is raised by ${up}%. What is the final price, in rupiah?`, final, { decoys: shuffle([...new Set([p, sale, final + 1000, final - 1000, final + 5000, p + (p * up) / 100 - (p * off) / 100].map(Math.round).filter((x) => x > 0 && x !== final))]).map(String) }), [
    `${off}% of ${p} is ${p} × ${off} ÷ 100 = ${(p * off) / 100}, so the sale price is ${p} − ${(p * off) / 100} = ${sale}.`,
    `The rise is ${up}% of the sale price, not of the first price: ${sale} × ${up} ÷ 100 = ${(sale * up) / 100}.`,
    `${sale} + ${(sale * up) / 100} = ${final}.`,
    `So the final price is ${final} rupiah (${money(final)}).`,
  ], 'Each percentage is taken of the price it is applied to: the rise is a percentage of the sale price.');
};
const timeQ = (y) => {
  const h = ri(1, 10), m = y <= 2 ? pick([0, 30]) : pick([0, 15, 30, 45]), d = y <= 2 ? pick([30, 60, 90]) : pick([25, 40, 45, 70, 95, 135]), e = h * 60 + m + d, hm = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const start = h * 60 + m, H = Math.floor(d / 60), M = d % 60, afterH = start + 60 * H, toHour = 60 - (afterH % 60);
  return explain(mcOnly('time', `A film starts at ${hm(start)} and lasts ${d >= 60 ? `${Math.floor(d / 60)} h ${d % 60 ? `${d % 60} min` : ''}`.trim() : `${d} min`}. When does it end?`, hm(e), [hm(e + 15), hm(e - 15), hm(e + 30)]), [
    `Start at ${hm(start)}.`,
    H ? `Add the ${H} hour${pl(H)}: ${hm(start)} → ${hm(afterH)}.` : '',
    M ? (afterH % 60 && M > toHour ? `Add the ${M} minutes in two parts: ${toHour} minutes reach ${hm(afterH + toHour)}, and ${M - toHour} more make ${hm(e)}.` : `Add the ${M} minutes: ${hm(afterH)} → ${hm(e)}.`) : '',
    `So the film ends at ${hm(e)}.`,
  ], 'Add the whole hours first, then the minutes; go up to the next o\'clock, then the rest.');
};
const fractionsQ = (y) => {
  const d = pick(y <= 4 ? [2, 3, 4, 5] : [3, 4, 5, 6, 8]), n = ri(1, d - 1), whole = d * ri(2, y <= 4 ? 8 : 15), [w] = names(1), it = thing();
  return explain(int('fractions', `${w} has ${whole} ${it}s and gives away ${n}/${d} of them. How many are given away?`, (whole / d) * n), [
    bar('All', d, `${whole}`),
    bar('Given', n, '?'),
    `Cut the ${whole} into ${d} equal parts: ${whole} ÷ ${d} = ${whole / d} in each part.`,
    `${n} part${pl(n)} ${n === 1 ? 'is' : 'are'} given away: ${n} × ${whole / d} = ${(whole / d) * n}.`,
    `So ${(whole / d) * n} ${it}s are given away.`,
  ], 'Find one part first by dividing by the bottom number, then multiply by the top number.');
};
const factors = () => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const a = pick([4, 6, 8, 9, 10, 12]), b = pick([6, 8, 10, 12, 15]); if (a === b) return null;
    const L = lcm(a, b), big = Math.max(a, b), small = Math.min(a, b), ms = Array.from({ length: L / big }, (_, i) => big * (i + 1));
    return explain(int('factors and multiples', `What is the lowest common multiple of ${a} and ${b}?`, L), [
      `List the multiples of the bigger number, ${big}: ${ms.join(', ')}.`,
      `Stop at the first one that ${small} also divides into: ${L} = ${small} × ${L / small}.`,
      `So the lowest common multiple is ${L}.`,
    ], 'List the multiples of the bigger number and stop at the first one the smaller number divides.');
  }
  if (kind === 2) {
    const g = pick([4, 6, 8, 12]), a = g * pick([2, 3, 5]), b = g * pick([3, 4, 7]); if (a === b) return null;
    const G = gcd(a, b);
    return explain(int('factors and multiples', `What is the highest common factor of ${a} and ${b}?`, G), [
      `Factors of ${a}: ${factorsOf(a).join(', ')}.`,
      `Factors of ${b}: ${factorsOf(b).join(', ')}.`,
      `The biggest number in both lists is ${G}.`,
      `So the highest common factor is ${G}.`,
    ], 'Write out both factor lists and pick the biggest number that is in both.');
  }
  const ps = shuffle([2, 3, 5, 7, 11, 13, 17, 19, 23]).slice(0, 3), c = pick([4, 6, 8, 9, 10, 12, 14, 15, 21]), f = [2, 3, 5, 7].find((d) => c % d === 0), list = shuffle([...ps, c]);
  return explain(mcOnly('prime or composite', `Which of these numbers is NOT prime: ${list.join(', ')}?`, c, ps), [
    'A prime has exactly two factors: 1 and itself.',
    `${c} = ${f} × ${c / f}, so ${c} has more factors than that.`,
    `${ps.join(', ')} cannot be split into two smaller factors: each is prime.`,
    `So the number that is NOT prime is ${c}.`,
  ], 'To test for a prime, try dividing by 2, 3, 5 and 7.');
};
const ratioQ = () => {
  const a = ri(1, 4), b = ri(a + 1, 7), u = ri(2, 12); if (gcd(a, b) !== 1) return null;
  return explain(int('ratio', `Blue and white paint are mixed in the ratio ${a} : ${b}. If ${a * u} litres of blue paint are used, how many litres of white paint are needed?`, b * u), [
    bar('Blue', a, `${a * u} litres`),
    bar('White', b, '?'),
    a > 1 ? `Blue is ${a} units and ${a} units = ${a * u} litres, so 1 unit = ${a * u} ÷ ${a} = ${u} litres.` : `Blue is 1 unit, so 1 unit = ${u} litres.`,
    `White is ${b} units: ${b} × ${u} = ${b * u}.`,
    `So ${b * u} litres of white paint are needed.`,
  ], 'Find what 1 unit is worth first, then count the units you need.');
};
const areaVolume = (y) => {
  const kind = y === 5 ? ri(1, 2) : ri(1, 3);
  if (kind === 1) {
    const l = ri(3, 12), w = ri(2, 10), h = ri(2, 8);
    return explain(int('area and volume', `A box is ${l} cm long, ${w} cm wide and ${h} cm tall. What is its volume, in cm³?`, l * w * h), [
      'Volume of a box = length × width × height.',
      `${l} × ${w} = ${l * w}, then ${l * w} × ${h} = ${l * w * h}.`,
      `So the volume is ${l * w * h} cm³.`,
    ], 'Volume of a box: multiply the three edges.');
  }
  if (kind === 2) {
    const l = ri(4, 20), w = ri(2, l);
    return explain(int('area and volume', `A rectangle is ${l} cm by ${w} cm. What is its area, in cm²?`, l * w), [
      'Area of a rectangle = length × width.',
      `${l} × ${w} = ${l * w}.`,
      `So the area is ${l * w} cm².`,
    ], 'Area of a rectangle: length × width.');
  }
  const r = pick([7, 14, 21]), A = (22 * r * r) / 7;
  return explain(int('circles', `Taking π as 22/7, what is the area of a circle with radius ${r} cm, in cm²?`, (22 / 7) * r * r), [
    'Area of a circle = π × radius × radius.',
    `${r} × ${r} = ${r * r}.`,
    `Divide by 7 first, then multiply by 22: ${r * r} ÷ 7 = ${(r * r) / 7}, and ${(r * r) / 7} × 22 = ${A}.`,
    `So the area is ${A} cm².`,
  ], 'With π as 22/7, divide by 7 before multiplying by 22 when the radius is a multiple of 7.');
};
const algebra = () => {
  const kind = ri(1, 2);
  if (kind === 1) {
    const a = ri(2, 9), x = ri(2, 15), b = ri(1, 20);
    return explain(int('algebraic thinking', `If ${a}x + ${b} = ${a * x + b}, what is x?`, x), [
      `${a}x means ${a} lots of x: ${a} lots of x, plus ${b}, make ${a * x + b}.`,
      `Undo the adding first: ${a * x + b} − ${b} = ${a * x}, so ${a} lots of x make ${a * x}.`,
      `Undo the multiplying: ${a * x} ÷ ${a} = ${x}.`,
      `So x is ${x}.`,
    ], 'Undo the last thing done first: take away, then divide.');
  }
  const x = ri(3, 30), a = ri(2, 9);
  return explain(int('algebraic thinking', `A number is multiplied by ${a} and the result is ${a * x}. What is the number?`, x), [
    `Work backwards: the opposite of multiplying by ${a} is dividing by ${a}.`,
    `${a * x} ÷ ${a} = ${x}.`,
    `Check: ${x} × ${a} = ${a * x}.`,
    `So the number is ${x}.`,
  ], 'To undo a multiplication, divide.');
};
const speedQ = () => {
  const v = pick([40, 50, 60, 80]), t = ri(2, 5);
  return explain(int('speed', `A train travels at ${v} km/h for ${t} hours. How far does it go, in km?`, v * t), [
    `${v} km/h means ${v} km every hour.`,
    `In ${t} hours: ${v} × ${t} = ${v * t}.`,
    `So the train goes ${v * t} km.`,
  ], 'Distance = speed × time.');
};
// decoys below zero too, or the one negative option gives itself away
const negative = () => {
  const t1 = ri(-9, 5), d = ri(3, 12), up = Math.random() < 0.5, v = up ? t1 + d : t1 - d;
  const move = up
    ? (t1 < 0 && v > 0 ? `From ${t1} up to 0 takes ${-t1} of the ${d} steps; the other ${d + t1} steps go above 0: ${v}.` : `${t1} + ${d} = ${v}.`)
    : (t1 > 0 && v < 0 ? `From ${t1} down to 0 takes ${t1} of the ${d} steps; the other ${d - t1} steps go below 0: ${v}.` : `${t1} − ${d} = ${v}.`);
  return explain(int('negative numbers', `The temperature was ${t1}°C. It ${up ? 'rose' : 'fell'} by ${d}°C. What is the temperature now, in °C?`, v, { decoys: shuffle([...new Set([up ? t1 - d : t1 + d, -v, v + 2, v - 2, v + 1, v - 1, -t1].filter((x) => x !== v))]).slice(0, 5).map(String) }), [
    `Put ${t1}°C on a number line. ${up ? 'Rising' : 'Falling'} ${d}°C means moving ${up ? 'up' : 'down'} ${d} steps.`,
    move,
    `So the temperature is now ${v}°C.`,
  ], 'Cross zero in two parts: first the steps to 0, then the rest on the other side.');
};
const exponents = () => {
  const b = pick([2, 3, 5, 10]), n = b === 2 ? ri(3, 8) : b === 3 ? ri(2, 5) : ri(2, 4), run = Array.from({ length: n }, (_, i) => b ** (i + 1));
  return explain(int('exponents', `What is ${b}^${n} (${b} to the power ${n})?`, b ** n), [
    `${b}^${n} means ${n} copies of ${b} multiplied together: ${Array(n).fill(b).join(' × ')}.`,
    `Build it up one multiplication at a time: ${run.join(', ')}.`,
    `So ${b}^${n} = ${b ** n}.`,
  ], 'A power says how many times to multiply, not how many times to add.');
};
const percentQ = () => {
  const t = pick([40, 60, 80, 120, 200, 250]), p = pick([10, 15, 20, 25, 30, 40, 60, 75]); if ((t * p) % 100) return null;
  const v = (t * p) / 100;
  return explain(int('percentages', `${p}% of ${t} children in a school take the bus. How many take the bus?`, v), [
    `${p}% means ${p} out of every 100.`,
    `${p}% of ${t} = ${t} × ${p} ÷ 100: ${t} × ${p} = ${t * p}, and ${t * p} ÷ 100 = ${v}.`,
    `So ${v} children take the bus.`,
  ], 'Percent means out of 100: multiply by the percentage, then divide by 100.');
};
// the paper's tiers: Section B staples
const bracketsOps = () => {
  const a = ri(5, 30), b = ri(3, 20), k = ri(2, 6), c = ri(1, 40), v = (a + b) * k - c; if (v < 0) return null;
  return explain(int('order of operations', `(${a} + ${b}) × ${k} − ${c} = ?`, v), [
    `Brackets first: ${a} + ${b} = ${a + b}.`,
    `Multiply next: ${a + b} × ${k} = ${(a + b) * k}.`,
    `Take away last: ${(a + b) * k} − ${c} = ${v}.`,
    `So the answer is ${v}.`,
  ], 'Brackets, then multiply or divide, then add or take away.');
};
const unitTrap = (y) => {
  const tip = 'Put every length into the same unit before you compare.';
  if (y <= 2) {
    const cands = shuffle([[200, '2 m'], [150, '150 cm'], [180, '1 m 80 cm'], [95, '95 cm'], [120, '1 m 20 cm'], [300, '3 m'], [45, '45 cm']]).slice(0, 4), top = cands.reduce((p, q) => (q[0] > p[0] ? q : p));
    return explain(mcOnly('measurement', 'Which of these lengths is the longest?', top[1], cands.filter((c) => c !== top).map((c) => c[1])), [
      `Change every length into centimetres: ${cands.map((c) => (c[1] === `${c[0]} cm` ? c[1] : `${c[1]} = ${c[0]} cm`)).join(', ')}.`,
      `The biggest number of centimetres is ${top[0]}.`,
      `So the longest is ${top[1]}.`,
    ], tip);
  }
  const lo = ri(3, 9) * 10, hi = lo + ri(4, 9) * 10, fmt = (cm) => pick([() => `${cm} cm`, () => (cm < 100 ? `${cm} cm` : cm % 100 === 0 ? `${cm / 100} m` : `${Math.floor(cm / 100)} m ${cm % 100} cm`), () => `${cm * 10} mm`])(), inside = ri(lo + 1, hi - 1), outs = shuffle([Math.max(1, lo - ri(1, 30)), hi + ri(1, 40), (lo + hi) * 3, Math.max(1, Math.floor(lo / 4))]).slice(0, 3);
  const sLo = fmt(lo), sHi = fmt(hi), sIn = fmt(inside), sOuts = outs.map((o) => fmt(o));
  return explain(mcOnly('measurement', `A rope is longer than ${sLo} and shorter than ${sHi}. Which of these could be its length?`, sIn, sOuts), [
    `Change everything to centimetres: ${sLo} = ${lo} cm and ${sHi} = ${hi} cm.`,
    `The choices: ${[[sIn, inside], ...outs.map((o, i) => [sOuts[i], o])].map(([str, v]) => (str === `${v} cm` ? str : `${str} = ${v} cm`)).join(', ')}.`,
    `Only ${inside} cm is between ${lo} cm and ${hi} cm.`,
    `So the rope could be ${sIn}.`,
  ], tip);
};
const statsMMR = (y) => {
  const xs = Array.from({ length: 5 }, () => ri(2, y <= 4 ? 20 : 60)), sorted = [...xs].sort((p, q) => p - q), kind = ri(1, 4);
  if (kind === 1) return explain(int('statistics', `What is the range of ${xs.join(', ')}?`, sorted[4] - sorted[0]), [
    `The biggest number is ${sorted[4]} and the smallest is ${sorted[0]}.`,
    `Range = biggest − smallest = ${sorted[4]} − ${sorted[0]} = ${sorted[4] - sorted[0]}.`,
    `So the range is ${sorted[4] - sorted[0]}.`,
  ], 'Range: biggest − smallest.');
  if (kind === 2) return explain(int('statistics', `What is the median of ${xs.join(', ')}?`, sorted[2]), [
    `Put the numbers in order: ${sorted.join(', ')}.`,
    `The median is the middle one, the 3rd of 5: ${sorted[2]}.`,
    `So the median is ${sorted[2]}.`,
  ], 'Median: order the numbers first, then take the middle one.');
  if (kind === 3) {
    const t = sum(xs); if (t % 5) return null;
    return explain(int('statistics', `What is the mean (average) of ${xs.join(', ')}?`, t / 5), [
      `Add them all: ${xs.join(' + ')} = ${t}.`,
      `Share equally among the 5 numbers: ${t} ÷ 5 = ${t / 5}.`,
      `So the mean is ${t / 5}.`,
    ], 'Mean: add them all, then divide by how many there are.');
  }
  const counts = {}; for (const x of xs) counts[x] = (counts[x] || 0) + 1; const top = Object.entries(counts).sort((p, q) => q[1] - p[1]); if (top[0][1] < 2 || (top[1] && top[1][1] === top[0][1])) return null;
  const mode = Number(top[0][0]), times = top[0][1];
  return explain(int('statistics', `What is the mode of ${xs.join(', ')}?`, mode), [
    `Count how often each number appears: ${Object.entries(counts).map(([k, c]) => `${k} appears ${c} time${pl(c)}`).join(', ')}.`,
    `${mode} appears ${times} times, more than any other number.`,
    `So the mode is ${mode}.`,
  ], 'Mode: the number that appears most often.');
};
const remainderSystem = () => {
  const [m1, m2] = pick([[6, 8], [4, 6], [5, 8], [6, 9], [3, 5], [4, 5]]), r = ri(1, Math.min(m1, m2) - 1), l = lcm(m1, m2), k = ri(1, Math.floor(200 / l)), N = k * l + r, lo = Math.floor(N / 10) * 10, m3 = pick([5, 7, 9].filter((m) => m !== m1 && m !== m2)), inRange = []; for (let x = lo; x < lo + 10; x++) if (x % m1 === r && x % m2 === r) inRange.push(x); if (inRange.length !== 1) return null;
  return explain(int('remainders', `A farmer has between ${lo} and ${lo + 10} apples. Packed in bags of ${m1} there is ${r} left over, and packed in bags of ${m2} there is also ${r} left over. How many apples are left over when they are packed in bags of ${m3}?`, N % m3), [
    `Bags of ${m1} leave ${r} and bags of ${m2} leave ${r}: the number is ${r} more than a multiple of both ${m1} and ${m2}.`,
    `The common multiples of ${m1} and ${m2} are the multiples of ${l}; the one near ${lo} is ${l} × ${k} = ${k * l}.`,
    `${k * l} + ${r} = ${N}, and ${N} is between ${lo} and ${lo + 10}, so there are ${N} apples.`,
    `${N} ÷ ${m3} = ${Math.floor(N / m3)} remainder ${N % m3}.`,
    `So ${N % m3} apple${pl(N % m3)} ${N % m3 === 1 ? 'is' : 'are'} left over.`,
  ], 'The same remainder for both bag sizes means the number is that remainder above a common multiple.');
};
const decimalOps = () => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const a = ri(11, 99) / 10, b = ri(2, 9), v = Math.round(a * b * 100) / 100, A = Math.round(a * 10);
    return explain(dec('decimals', `${a} × ${b} = ?`, a * b), [
      `Ignore the decimal point first: ${A} × ${b} = ${A * b}.`,
      `${a} has 1 decimal place, so put the point back 1 place from the end: ${v}.`,
      `So ${a} × ${b} = ${v}.`,
    ], 'Multiply as whole numbers, then put the decimal point back.');
  }
  if (kind === 2) {
    const a = ri(11, 99) / 10, b = ri(11, 99) / 10, A = Math.round(a * 10), B = Math.round(b * 10), v = (A + B) / 10;
    return explain(dec('decimals', `${a} + ${b} = ?`, a + b), [
      `Line up the decimal points and think in tenths: ${a} is ${A} tenths and ${b} is ${B} tenths.`,
      `${A} + ${B} = ${A + B} tenths, which is ${v}.`,
      `So ${a} + ${b} = ${v}.`,
    ], 'Line up the decimal points before you add.');
  }
  const q = ri(2, 12), b = ri(2, 9) / 10, P = Math.round(q * b * 100) / 100, P10 = Math.round(P * 10), B = Math.round(b * 10);
  return explain(dec('decimals', `${P} ÷ ${b} = ?`, q), [
    `Multiply both numbers by 10 so the divisor is whole: ${P} ÷ ${b} becomes ${P10} ÷ ${B}.`,
    `${P10} ÷ ${B} = ${q}.`,
    `So ${P} ÷ ${b} = ${q}.`,
  ], 'Move the decimal point the same number of places in both numbers, then divide whole numbers.');
};
const compositeVolume = () => {
  const l1 = ri(6, 15), w = ri(3, 8), h = ri(2, 6), l2 = ri(3, 10), h2 = ri(2, 6), v1 = l1 * w * h, v2 = l2 * w * h2;
  return explain(int('area and volume', `A solid is made of two blocks glued together: one ${l1} cm by ${w} cm by ${h} cm and one ${l2} cm by ${w} cm by ${h2} cm. What is its volume, in cm³?`, v1 + v2), [
    `First block: ${l1} × ${w} × ${h} = ${v1}.`,
    `Second block: ${l2} × ${w} × ${h2} = ${v2}.`,
    `${v1} + ${v2} = ${v1 + v2}.`,
    `So the volume is ${v1 + v2} cm³.`,
  ], 'Split a solid into boxes, find each volume, then add.');
};
const DIV_RULES = { 3: 'a number divides by 3 when its digits add up to a multiple of 3', 4: 'a number divides by 4 when halving it twice gives a whole number', 5: 'a number divides by 5 when it ends in 0 or 5', 6: 'a number divides by 6 when it is even and its digits add up to a multiple of 3', 9: 'a number divides by 9 when its digits add up to a multiple of 9' };
const divisibleCount = () => {
  const ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, ri(3, 4)).sort((p, q) => p - q), m = pick([3, 4, 5, 6, 9]), hits = []; for (const a of ds) for (const b of ds) if ((10 * a + b) % m === 0) hits.push(10 * a + b);
  const n = hits.length; if (n === 0) return null;
  return explain(int('divisibility', `How many two-digit numbers can be made from the digits ${ds.join(', ')} (a digit may be used twice in a number) that are divisible by ${m}?`, n), [
    `With ${ds.length} digits there are ${ds.length} × ${ds.length} = ${ds.length * ds.length} two-digit numbers to test.`,
    `Rule: ${DIV_RULES[m]}.`,
    `The ones that pass: ${hits.join(', ')}.`,
    `So ${n} of them are divisible by ${m}.`,
  ], 'Use the divisibility rule instead of dividing every number.');
};
const twoStepChart = (y) => {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu'], vals = labels.map(() => ri(2, y <= 4 ? 9 : 20)), price = pick([2000, 2500, 5000, 10000]), i = ri(0, 2), f = bars('Books sold', null, labels.map((l, k) => [l, vals[k]])), both = vals[i] + vals[i + 1];
  return explain(withFigure(int('data and graphs', `The bar chart shows the books a stall sold on four days. Each book costs ${money(price)}. How much did the stall take on ${labels[i]} and ${labels[i + 1]} together, in rupiah?`, price * both, { decoys: [...new Set([price * vals[i], price * vals[i + 1], price * (both + 1), price * (both - 1), price * (vals[i + 1] + vals[i + 2])])].filter((x) => x > 0 && x !== price * both).map(String) }), f), [
    `Read the chart: ${labels[i]} ${vals[i]} books, ${labels[i + 1]} ${vals[i + 1]} books.`,
    `${vals[i]} + ${vals[i + 1]} = ${both} books.`,
    `Each book is ${price} rupiah: ${both} × ${price} = ${price * both}.`,
    `So the stall took ${price * both} rupiah.`,
  ], 'Read the two numbers from the chart first, then add, then multiply by the price.');
};
const perimArea34 = () => {
  const l = ri(6, 20), w = ri(2, l - 1);
  if (ri(1, 2) === 1) return explain(int('perimeter and area', `A rectangle has a perimeter of ${2 * (l + w)} cm and a length of ${l} cm. What is its area, in cm²?`, l * w), [
    `Half the perimeter is length + width: ${2 * (l + w)} ÷ 2 = ${l + w}.`,
    `Width = ${l + w} − ${l} = ${w}.`,
    `Area = length × width = ${l} × ${w} = ${l * w}.`,
    `So the area is ${l * w} cm².`,
  ], 'Half the perimeter is one length plus one width.');
  return explain(int('perimeter and area', `A rectangle has an area of ${l * w} cm² and a width of ${w} cm. What is its perimeter, in cm?`, 2 * (l + w)), [
    `Length = area ÷ width = ${l * w} ÷ ${w} = ${l}.`,
    `Perimeter = 2 × (length + width) = 2 × (${l} + ${w}) = 2 × ${l + w} = ${2 * (l + w)}.`,
    `So the perimeter is ${2 * (l + w)} cm.`,
  ], 'Area ÷ one side gives the other side.');
};
const rounding34 = () => {
  const n = ri(1000, 9999), to = pick([10, 100, 1000]), digit = Math.floor(n / (to / 10)) % 10, place = { 10: 'tens', 100: 'hundreds', 1000: 'thousands' }[to], v = Math.round(n / to) * to, below = Math.floor(n / to) * to;
  return explain(int('rounding', `Round ${n} to the nearest ${to}.`, v), [
    `${n} lies between ${below} and ${below + to}.`,
    `Look at the digit just after the ${place} place: it is ${digit}.`,
    `${digit} is ${digit >= 5 ? '5 or more, so round up' : 'less than 5, so round down'}: ${v}.`,
    `So ${n} rounded to the nearest ${to} is ${v}.`,
  ], 'Look at the next digit: 5 or more rounds up, 4 or less rounds down.');
};
const DICE = [
  ['both dice show an even number', '1/4', ['1/2', '1/3', '1/6'], 'Each die is even 3 ways out of 6 (2, 4, 6), so 3 × 3 = 9 pairs out of 36: 9/36 = 1/4.'],
  ['both dice show a prime number', '1/4', ['1/2', '1/9', '1/6'], 'The primes on a die are 2, 3 and 5: 3 ways each, so 3 × 3 = 9 pairs out of 36: 9/36 = 1/4.'],
  ['the two numbers add up to 7', '1/6', ['1/12', '1/4', '7/36'], 'Pairs that add to 7: 1+6, 2+5, 3+4, 4+3, 5+2, 6+1, that is 6 pairs out of 36: 6/36 = 1/6.'],
  ['both dice show the same number', '1/6', ['1/36', '1/12', '1/3'], 'Doubles: 1-1, 2-2, 3-3, 4-4, 5-5, 6-6, that is 6 pairs out of 36: 6/36 = 1/6.'],
  ['both dice show a number greater than 4', '1/9', ['1/3', '1/6', '4/9'], 'Each die shows 5 or 6: 2 ways each, so 2 × 2 = 4 pairs out of 36: 4/36 = 1/9.'],
  ['the two numbers add up to 12', '1/36', ['1/12', '1/6', '2/36'], 'Only 6 and 6 add up to 12: 1 pair out of 36.'],
];
const diceProb = () => {
  const [e, right, wrong, why] = pick(DICE);
  return explain(mcOnly('probability', `Two fair dice are rolled. What is the probability that ${e}?`, right, wrong), [
    'Two dice give 6 × 6 = 36 equally likely pairs.',
    why,
    `So the probability is ${right}.`,
  ], 'Count the pairs that work out of the 36 pairs, then simplify the fraction.');
};

// ---- kinds added 20 Sep 2026 for the ten-slot sections ----
// Section A, Grades 1–4: who is tallest, from clues that must be lined up first
const chainCompare = (y) => {
  const w = names(y <= 2 ? 3 : 4), [more, less, most, least] = pick([['taller', 'shorter', 'tallest', 'shortest'], ['heavier', 'lighter', 'heaviest', 'lightest'], ['older', 'younger', 'oldest', 'youngest'], ['faster', 'slower', 'fastest', 'slowest']]), askTop = ri(1, 2) === 1;
  const tip = 'Line the people up in order as you read the clues, then read off the ends.';
  if (y <= 2) {
    const clue2 = ri(1, 2) === 1 ? `${w[1]} is ${more} than ${w[2]}` : `${w[2]} is ${less} than ${w[1]}`;
    return explain(mcOnly('comparing', `${w[0]} is ${more} than ${w[1]}. ${clue2}. Who is the ${askTop ? most : least}?`, askTop ? w[0] : w[2], [askTop ? w[1] : w[0], askTop ? w[2] : w[1], 'Cannot be decided']), [
      `Line them up from ${most} to ${least} as you read the clues.`,
      `${w[0]} is ${more} than ${w[1]}: ${w[0]}, ${w[1]}.`,
      `${clue2}, so ${w[2]} goes after ${w[1]}: ${w[0]}, ${w[1]}, ${w[2]}.`,
      `So the ${askTop ? most : least} is ${askTop ? w[0] : w[2]}.`,
    ], tip);
  }
  const clues = shuffle([`${w[1]} is ${less} than ${w[0]}`, `${w[2]} is ${more} than ${w[3]}`, `${w[1]} is ${more} than ${w[2]}`]);
  return explain(mcOnly('comparing', `${clues.join('. ')}. Who is the ${askTop ? most : least}?`, askTop ? w[0] : w[3], askTop ? [w[1], w[2], w[3]] : [w[0], w[1], w[2]]), [
    `Line them up from ${most} to ${least}, one clue at a time.`,
    `${w[1]} is ${less} than ${w[0]}: ${w[0]}, ${w[1]}.`,
    `${w[1]} is ${more} than ${w[2]}: ${w[0]}, ${w[1]}, ${w[2]}.`,
    `${w[2]} is ${more} than ${w[3]}: ${w[0]}, ${w[1]}, ${w[2]}, ${w[3]}.`,
    `So the ${askTop ? most : least} is ${askTop ? w[0] : w[3]}.`,
  ], tip);
};
// Section A, Grades 1–4: a counting sequence with one gap — look at the jumps
const missingNumber = (y) => {
  const step = y <= 2 ? pick([1, 2, 2, 3, 5, 10]) : pick([3, 4, 6, 7, 9, 11, 25]), start = y <= 2 ? ri(1, step === 10 ? 30 : 12) : ri(2, 40), gap = ri(1, 3), down = y >= 2 && ri(1, 3) === 1;
  const seq = Array.from({ length: 5 }, (_, i) => (down ? start + (4 - i) * step : start + i * step)), v = seq[gap], shown = seq.map((x, i) => (i === gap ? '▢' : String(x))), [p, q] = gap >= 2 ? [seq[0], seq[1]] : [seq[3], seq[4]], sign = down ? '−' : '+';
  return explain(int('missing number', `${shown.join(', ')}. What number goes in ▢?`, v, { read: `The numbers go ${shown.map((x) => (x === '▢' ? 'blank' : x)).join(', ')}. What number goes in the blank?`, decoys: [...new Set([v + step, v - step, v + 1, v - 1])].filter((x) => x > 0 && x !== v).map(String) }), [
    `Look at the jump between two numbers you can see: from ${p} to ${q} is ${down ? 'down' : 'up'} ${step}.`,
    `Every jump is the same: ${down ? 'down' : 'up'} ${step} each time.`,
    `${seq[gap - 1]} ${sign} ${step} = ${v}. Check: ${v} ${sign} ${step} = ${seq[gap + 1]}.`,
    `So the missing number is ${v}.`,
  ], 'Find the jump between two neighbours you can see, then use it to fill the gap.');
};
// Section A, all grades: cuts and pieces — cuts are one fewer than pieces
const cutsPieces = (y) => {
  if (y <= 2) {
    if (ri(1, 2) === 1) {
      const c = ri(2, 6);
      return explain(int('cuts and pieces', `A ribbon is cut ${c} times. How many pieces are there?`, c + 1), [
        '1 cut makes 2 pieces and 2 cuts make 3 pieces: there is always 1 more piece than cuts.',
        `${c} cuts: ${c} + 1 = ${c + 1}.`,
        `So there are ${c + 1} pieces.`,
      ], 'Pieces are always one more than cuts.');
    }
    const p = ri(3, 8);
    return explain(int('cuts and pieces', `A rope is cut into ${p} pieces. How many cuts were made?`, p - 1), [
      '1 cut makes 2 pieces and 2 cuts make 3 pieces: cuts are always 1 fewer than pieces.',
      `${p} pieces: ${p} − 1 = ${p - 1}.`,
      `So ${p - 1} cuts were made.`,
    ], 'Cuts are always one fewer than pieces.');
  }
  if (y <= 4) {
    const p = ri(4, 12), t = pick([2, 3, 4, 5]);
    return explain(int('cuts and pieces', `A log is sawn into ${p} pieces. Each cut takes ${t} minutes. How long does it take altogether, in minutes?`, (p - 1) * t, { decoys: [p * t, (p - 2) * t, (p + 1) * t].map(String) }), [
      `${p} pieces need only ${p} − 1 = ${p - 1} cuts: the last cut makes two pieces at once.`,
      `${p - 1} cuts at ${t} minutes each: ${p - 1} × ${t} = ${(p - 1) * t}.`,
      `So it takes ${(p - 1) * t} minutes.`,
    ], 'Count the cuts, not the pieces: cuts are one fewer.');
  }
  const p = ri(3, 7), t = pick([2, 3, 4, 5, 6]), p2 = p + ri(2, 6), T = (p - 1) * t, v = (p2 - 1) * t;
  return explain(int('cuts and pieces', `It takes ${T} minutes to saw a log into ${p} pieces. How long will it take to saw a log just like it into ${p2} pieces, in minutes?`, v, { decoys: [...new Set([Math.round((T * p2) / p), p2 * t, (p2 - 2) * t])].filter((x) => x !== v).map(String) }), [
    `${p} pieces need ${p} − 1 = ${p - 1} cuts, so one cut takes ${T} ÷ ${p - 1} = ${t} minutes.`,
    `${p2} pieces need ${p2} − 1 = ${p2 - 1} cuts.`,
    `${p2 - 1} × ${t} = ${v}.`,
    `So it will take ${v} minutes.`,
  ], 'Time goes with cuts, not pieces: cuts are one fewer than pieces.');
};
// Section A, Grades 3–6: handshakes and league matches — every pair once
const handshakes = (y) => {
  const n = ri(5, y <= 4 ? 8 : 12), [who, does, what, one, each, all] = pick([['people at a party', 'shakes hands with every other person exactly once', 'handshakes', 'handshake', 'person', 'people'], ['teams in a league', 'plays every other team exactly once', 'matches', 'match', 'team', 'teams']]), v = (n * (n - 1)) / 2;
  const seed = int('handshakes', `There are ${n} ${who}. Each ${does}. How many ${what} are there altogether?`, v, { decoys: [n * (n - 1), n - 1, v + n].map(String) });
  if (y <= 4) {
    const parts = Array.from({ length: n - 1 }, (_, i) => n - 1 - i);
    return explain(seed, [
      `The first ${each} meets ${n - 1} others.`,
      `The second ${each} has already met the first, so only ${n - 2} new ${what}; the third ${n - 3} new, and so on down to 1.`,
      `${parts.join(' + ')} = ${v}.`,
      `So there are ${v} ${what} altogether.`,
    ], 'Count only the new meetings each time: the numbers count down to 1, then add them.');
  }
  return explain(seed, [
    `Each of the ${n} ${all} meets ${n} − 1 = ${n - 1} others: ${n} × ${n - 1} = ${n * (n - 1)}.`,
    `That counts every ${one} twice, once from each side.`,
    `${n * (n - 1)} ÷ 2 = ${v}.`,
    `So there are ${v} ${what} altogether.`,
  ], 'Each pair is counted twice when you count from both sides, so halve it.');
};
// Section A, Grades 3–6: a sequence whose jumps grow
const growingJumps = (y) => {
  const first = ri(1, y <= 4 ? 6 : 12), j0 = ri(1, 5), inc = pick(y <= 4 ? [1, 1, 2] : [1, 2, 3]), n = 6, seq = [first]; for (let i = 1; i <= n; i++) seq.push(seq[i - 1] + j0 + (i - 1) * inc);
  const jumps = Array.from({ length: n }, (_, i) => j0 + i * inc), next = seq[n], shown = seq.slice(0, n);
  return explain(int('growing sequences', `${shown.join(', ')}, ? What number comes next?`, next, { decoys: [next - inc, next + inc, next + jumps[n - 1]].map(String) }), [
    `Write the jumps between the numbers: ${jumps.slice(0, n - 1).join(', ')}.`,
    `The jumps themselves grow by ${inc} each time, so the next jump is ${jumps[n - 2]} + ${inc} = ${jumps[n - 1]}.`,
    `${shown.at(-1)} + ${jumps[n - 1]} = ${next}.`,
    `So the next number is ${next}.`,
  ], 'When the jumps are not equal, look at the jumps between the jumps.');
};
// Section A, Grades 5–6: a two-digit number from its digit sum and what swapping the digits does
const digitPuzzle = (y) => {
  const tens = ri(1, 6), diff = ri(1, 9 - tens), units = tens + diff, N = 10 * tens + units, R = 10 * units + tens, total = tens + units;
  if (ri(1, 2) === 1) return explain(int('digit puzzles', `The two digits of a two-digit number add up to ${total}. When the digits are swapped, the number becomes ${R - N} bigger. What is the number?`, N, { decoys: [...new Set([R, N + 9, N - 9, N + 10, N - 10, 10 * (tens + 1) + (units - 1)])].filter((x) => x > 9 && x < 100 && x !== N).map(String) }), [
    `Swapping the digits changes a number by 9 × (the difference of its digits): ${R - N} ÷ 9 = ${diff}.`,
    `The digits add up to ${total} and differ by ${diff}: the bigger digit is (${total} + ${diff}) ÷ 2 = ${units}, the smaller is ${units} − ${diff} = ${tens}.`,
    `Swapping makes the number bigger, so the smaller digit is in front: ${N}.`,
    `Check: ${tens} + ${units} = ${total} and ${R} − ${N} = ${R - N}.`,
    `So the number is ${N}.`,
  ], 'Swapping two digits changes the number by 9 times the difference of the digits.');
  const list = []; for (let t = 1; t <= 9; t++) { const u = total - t; if (u >= 0 && u <= 9) list.push(10 * t + u); }
  return explain(int('digit puzzles', `A two-digit number has digits that add up to ${total}. Its units digit is ${diff} more than its tens digit. What is the number?`, N, { decoys: [...new Set([R, N + 9, N - 9, N + 10, N - 10, 10 * (tens + 1) + (units - 1)])].filter((x) => x > 9 && x < 100 && x !== N).map(String) }), [
    `List the two-digit numbers whose digits add up to ${total}: ${list.join(', ')}.`,
    `Check each one: only ${N} has a units digit ${diff} more than its tens digit (${units} − ${tens} = ${diff}).`,
    `So the number is ${N}.`,
  ], 'When a two-digit number is described by its digits, list every number that fits the first clue and test the second.');
};
// Section A, Grades 5–6: how many digits number the pages of a book
const pageNumbers = (y) => {
  const N = ri(110, 350), v = 9 + 180 + (N - 99) * 3;
  return explain(int('page numbers', `A book has ${N} pages, numbered from 1 to ${N}. How many digits are printed to number all the pages?`, v, { decoys: [...new Set([N, v - 3, v + 3, N * 3])].filter((x) => x !== v).map(String) }), [
    'Pages 1 to 9: 9 pages with 1 digit each, 9 digits.',
    'Pages 10 to 99: 90 pages with 2 digits each, 90 × 2 = 180 digits.',
    `Pages 100 to ${N}: ${N} − 99 = ${N - 99} pages with 3 digits each, ${N - 99} × 3 = ${(N - 99) * 3} digits.`,
    `9 + 180 + ${(N - 99) * 3} = ${v}.`,
    `So ${v} digits are printed.`,
  ], 'Count the 1-digit, 2-digit and 3-digit pages as three separate groups.');
};

// ---- Section B, Grades 1–2: WMI's K–2 applications (the picture, lengths, coins, the clock, the week, stories, groups, queues, shapes, the ruler) ----
const countPicture = (y) => {
  const [a, b] = shuffle([['🍎', 'apples'], ['⭐', 'stars'], ['🐟', 'fish'], ['🌸', 'flowers'], ['🍬', 'sweets'], ['🐞', 'ladybirds']]).slice(0, 2), rows = y === 1 ? 3 : 4, cols = 4, nA = ri(y === 1 ? 4 : 6, y === 1 ? 8 : 11), nB = ri(2, Math.min(nA - 1, rows * cols - nA - 1));
  const cells = shuffle(Array.from({ length: rows * cols }, (_, i) => i)), at = {};
  cells.slice(0, nA).forEach((i) => { at[`${Math.floor(i / cols)},${i % cols}`] = a[0]; });
  cells.slice(nA, nA + nB).forEach((i) => { at[`${Math.floor(i / cols)},${i % cols}`] = b[0]; });
  const fig = grid(`${cap(a[1])} and ${b[1]}`, rows, cols, at), perRow = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => at[`${r},${c}`]).filter((x) => x === a[0]).length);
  const kind = ri(1, 3), read = `A picture shows ${nA} ${a[1]} and ${nB} ${b[1]} mixed up.`;
  if (kind === 1) return explain(withFigure(int('counting objects', `Look at the picture. How many ${a[1]} are there?`, nA, { read: `${read} How many ${a[1]} are there?` }), fig), [
    `Look along each row and count only the ${a[1]}.`,
    `Row by row: ${perRow.join(' + ')} = ${nA}.`,
    `So there are ${nA} ${a[1]}.`,
  ], 'Count row by row, and tick each one so you do not count it twice.');
  if (kind === 2) return explain(withFigure(int('counting objects', `Look at the picture. How many ${a[1]} and ${b[1]} are there altogether?`, nA + nB, { read: `${read} How many are there altogether?` }), fig), [
    `Count the ${a[1]}: ${nA}. Count the ${b[1]}: ${nB}.`,
    `Altogether means add: ${nA} + ${nB} = ${nA + nB}.`,
    `So there are ${nA + nB} altogether.`,
  ], 'Count each kind on its own, then add.');
  return explain(withFigure(int('counting objects', `Look at the picture. How many more ${a[1]} than ${b[1]} are there?`, nA - nB, { read: `${read} How many more ${a[1]} than ${b[1]} are there?` }), fig), [
    `Count the ${a[1]}: ${nA}. Count the ${b[1]}: ${nB}.`,
    `How many more means take away: ${nA} − ${nB} = ${nA - nB}.`,
    `So there are ${nA - nB} more ${a[1]}.`,
  ], 'How many more: count both, then take the smaller from the bigger.');
};
const compareLengths = (y) => {
  const items = shuffle(['pencil', 'ribbon', 'crayon', 'straw', 'stick', 'spoon']).slice(0, 3), lo = y === 1 ? 3 : 5, hi = y === 1 ? 15 : 20;
  const lens = shuffle(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)).slice(0, 3);
  if (ri(1, 2) === 1) {
    const longest = ri(1, 2) === 1, idx = lens.indexOf(longest ? Math.max(...lens) : Math.min(...lens)), ordered = [...lens].sort((p, q) => q - p);
    return explain(mcOnly('comparing lengths', `The ${items[0]} is ${lens[0]} cm long, the ${items[1]} is ${lens[1]} cm and the ${items[2]} is ${lens[2]} cm. Which is the ${longest ? 'longest' : 'shortest'}?`, items[idx], [...items.filter((_, i) => i !== idx), 'They are all the same']), [
      `Put the lengths in order from longest to shortest: ${ordered.map((l) => `${l} cm`).join(', ')}.`,
      `The ${longest ? 'biggest' : 'smallest'} number is ${lens[idx]} cm, and that is the ${items[idx]}.`,
      `So the ${longest ? 'longest' : 'shortest'} is the ${items[idx]}.`,
    ], 'The longest has the biggest number of centimetres, the shortest the smallest.');
  }
  const [x, z] = lens, big = Math.max(x, z), small = Math.min(x, z), longer = x > z ? items[0] : items[1], shorter = x > z ? items[1] : items[0];
  return explain(int('comparing lengths', `A ${items[0]} is ${x} cm long and a ${items[1]} is ${z} cm long. How much longer is the ${longer} than the ${shorter}?`, big - small), [
    barIf(cap(longer), big, `${big} cm`),
    barIf(cap(shorter), small, `${small} cm`),
    `The difference is ${big} − ${small} = ${big - small}.`,
    `So the ${longer} is ${big - small} cm longer.`,
  ], 'How much longer: take the shorter length from the longer one.');
};
const coinsQ = (y) => {
  const [w] = names(1), it = thing();
  if (ri(1, 2) === 1) {
    const n1 = ri(1, y === 1 ? 4 : 6), n2 = ri(1, y === 1 ? 3 : 5), v = 500 * n1 + 1000 * n2;
    return explain(int('coins and money', `${w} has ${n1} coin${pl(n1)} of ${money(500)} and ${n2} coin${pl(n2)} of ${money(1000)}. How much money does ${w} have, in rupiah?`, v, { decoys: [...new Set([v + 500, v - 500, v + 1000, (n1 + n2) * 1000, (n1 + n2) * 500])].filter((x) => x > 0 && x !== v).map(String) }), [
      `Count the ${money(500)} coins in 500s: ${Array.from({ length: n1 }, (_, i) => (i + 1) * 500).join(', ')}.`,
      `Count the ${money(1000)} coins in 1000s: ${Array.from({ length: n2 }, (_, i) => (i + 1) * 1000).join(', ')}.`,
      `${500 * n1} + ${1000 * n2} = ${v}.`,
      `So ${w} has ${v} rupiah (${money(v)}).`,
    ], 'Count each kind of coin on its own, then add the two amounts.');
  }
  const note = pick(y === 1 ? [2000, 5000] : [5000, 10000]), p = ri(1, note / 500 - 1) * 500, v = note - p;
  return explain(int('coins and money', `A ${it} costs ${money(p)}. ${w} pays with a ${money(note)} note. How much change does ${w} get, in rupiah?`, v, { decoys: [...new Set([v + 500, v - 500, v + 1000, p, note, v * 2, v + 1500])].filter((x) => x > 0 && x !== v).map(String) }), [
    'Change is the money paid take away the price.',
    `Count on from ${p} up to ${note}: ${p} + ${v} = ${note}.`,
    `So the change is ${v} rupiah (${money(v)}).`,
  ], 'To find change, count on from the price up to the money paid.');
};
const clockQ = (y) => {
  const h = ri(1, 11), kind = y === 1 ? ri(1, 2) : ri(1, 3), oclock = (x) => `${x} o'clock`, half = (x) => `half past ${x}`;
  if (kind === 1) return explain(mcOnly('telling the time', `On a clock the short hand points to ${h} and the long hand points to 12. What time is it?`, oclock(h), [half(h), oclock(h + 1), oclock(h === 1 ? 12 : h - 1)]), [
    'The long hand on 12 means no minutes past: it is exactly an o\'clock time.',
    `The short hand is the hour hand, and it points to ${h}.`,
    `So it is ${oclock(h)}.`,
  ], 'Short hand for the hour, long hand for the minutes; long hand on 12 means o\'clock.');
  if (kind === 2) return explain(mcOnly('telling the time', `On a clock the long hand points to 6 and the short hand is halfway between ${h} and ${h + 1}. What time is it?`, half(h), [oclock(h), half(h + 1), oclock(h + 1)]), [
    'The long hand on 6 means half an hour has passed: it is a half past time.',
    `The short hand has moved halfway from ${h} to ${h + 1}, so the hour is still ${h}.`,
    `So it is ${half(h)}.`,
  ], 'Long hand on 6 means half past; the hour is the number the short hand has just passed.');
  const k = ri(1, 12 - h), t = h + k;
  return explain(mcOnly('telling the time', `It is ${oclock(h)} now. What time will it be in ${k} hour${pl(k)}?`, oclock(t), [oclock(t === 12 ? 1 : t + 1), oclock(t - 1), half(t)]), [
    `Count on ${k} hour${pl(k)} from ${h}: ${Array.from({ length: k }, (_, i) => h + i + 1).join(', ')}.`,
    `${h} + ${k} = ${t}.`,
    `So it will be ${oclock(t)}.`,
  ], 'Count on one hour at a time.');
};
const weekDaysQ = (y) => {
  const d = ri(0, 6), kind = ri(1, 3), others = (t) => shuffle(DAYS.filter((_, i) => i !== t)).slice(0, 3);
  if (kind === 1) {
    const k = ri(2, y === 1 ? 4 : 6), t = (d + k) % 7;
    return explain(mcOnly('days of the week', `Today is ${DAYS[d]}. What day will it be in ${k} days?`, DAYS[t], others(t)), [
      `The days go ${DAYS.join(', ')}, then start again.`,
      `Count on ${k} days from ${DAYS[d]}: ${Array.from({ length: k }, (_, i) => DAYS[(d + 1 + i) % 7]).join(', ')}.`,
      `So in ${k} days it will be ${DAYS[t]}.`,
    ], 'Count on one day at a time, and after Sunday comes Monday again.');
  }
  if (kind === 2) {
    const k = ri(2, y === 1 ? 4 : 6), t = (d - k + 7) % 7;
    return explain(mcOnly('days of the week', `Today is ${DAYS[d]}. What day was it ${k} days ago?`, DAYS[t], others(t)), [
      `The days go ${DAYS.join(', ')}, then start again.`,
      `Count back ${k} days from ${DAYS[d]}: ${Array.from({ length: k }, (_, i) => DAYS[(d - 1 - i + 14) % 7]).join(', ')}.`,
      `So ${k} days ago it was ${DAYS[t]}.`,
    ], 'Count back one day at a time, and before Monday comes Sunday.');
  }
  const t = (d + 3) % 7;
  return explain(mcOnly('days of the week', `Yesterday was ${DAYS[d]}. What day will it be the day after tomorrow?`, DAYS[t], others(t)), [
    `Yesterday was ${DAYS[d]}, so today is ${DAYS[(d + 1) % 7]}.`,
    `Tomorrow is ${DAYS[(d + 2) % 7]}, and the day after tomorrow is ${DAYS[t]}.`,
    `So the day after tomorrow will be ${DAYS[t]}.`,
  ], 'Step from yesterday to today first, then count on.');
};
const storyQ = (y) => {
  const [w] = names(1), it = thing(), hi = y === 1 ? 20 : 40, kind = ri(1, 3);
  if (kind === 1) {
    const [what, where, went] = pick([['birds', 'on a wire', 'flew away'], ['frogs', 'on a log', 'jumped into the pond'], ['children', 'in a playground', 'went home'], ['ducks', 'on a pond', 'swam away']]), a = ri(6, hi), b = ri(2, a - 1);
    return explain(int('number stories', `There were ${a} ${what} ${where}. ${b} ${went}. How many ${what} are left?`, a - b), [
      barIf('Were', a, `${a}`),
      barIf('Left', a - b, `? (${b} ${went})`),
      `${b} ${went}, so take ${b} away: ${a} − ${b} = ${a - b}.`,
      `So ${a - b} ${what} are left.`,
    ], 'Going away means take away.');
  }
  if (kind === 2) {
    const a = ri(6, hi), b = ri(2, a - 2), c = ri(2, hi - (a - b));
    return explain(int('number stories', `${w} had ${a} ${it}s. ${w} gave ${b} to a friend and then got ${c} more. How many ${it}s does ${w} have now?`, a - b + c), [
      `First the giving away: ${a} − ${b} = ${a - b}.`,
      `Then the getting more: ${a - b} + ${c} = ${a - b + c}.`,
      `So ${w} has ${a - b + c} ${it}s now.`,
    ], 'Do the story one step at a time, in the order it happens.');
  }
  const t = ri(8, hi), a = ri(2, t - 2);
  return explain(int('number stories', `${w} needs ${t} ${it}s for a game and has only ${a}. How many more ${it}s does ${w} need?`, t - a), [
    barIf('Needs', t, `${t}`),
    barIf('Has', a, `${a}`),
    `The missing part is the difference: ${t} − ${a} = ${t - a}.`,
    `Check: ${a} + ${t - a} = ${t}.`,
    `So ${w} needs ${t - a} more ${it}s.`,
  ], 'How many more to reach the total: take what you have from what you need.');
};
const equalGroups = (y) => {
  const [w] = names(1), it = thing(), kind = ri(1, 3);
  if (kind === 1) {
    const [item, part, k] = pick([['bicycle', 'wheels', 2], ['tricycle', 'wheels', 3], ['car', 'wheels', 4], ['chair', 'legs', 4], ['hand', 'fingers', 5], ['spider', 'legs', 8], ['triangle', 'corners', 3]]), n = ri(2, y === 1 ? 5 : 9);
    return explain(int('equal groups', `How many ${part} do ${n} ${item}s have altogether?`, n * k), [
      `Each ${item} has ${k} ${part}.`,
      `${n} ${item}s: ${Array(n).fill(k).join(' + ')} = ${n * k}.`,
      `So ${n} ${item}s have ${n * k} ${part} altogether.`,
    ], 'Equal groups: add the same number again and again, or count in that number.');
  }
  if (kind === 2) {
    const k = pick(y === 1 ? [2, 5] : [2, 3, 4, 5]), n = ri(2, y === 1 ? 5 : 8);
    return explain(int('equal groups', `${w} has ${n * k} ${it}s and puts them into bags of ${k}. How many bags does ${w} fill?`, n), [
      `Count in ${k}s up to ${n * k}: ${Array.from({ length: n }, (_, i) => (i + 1) * k).join(', ')}.`,
      `That is ${n} groups of ${k}.`,
      `So ${w} fills ${n} bags.`,
    ], 'To make equal groups, count in that number until you reach the total.');
  }
  const n = ri(2, y === 1 ? 6 : 10);
  return explain(int('equal groups', `There are ${2 * n} socks in a drawer. How many pairs of socks is that?`, n), [
    'A pair is 2 socks.',
    `Count in 2s up to ${2 * n}: ${Array.from({ length: n }, (_, i) => (i + 1) * 2).join(', ')}. That is ${n} twos.`,
    `So ${2 * n} socks make ${n} pairs.`,
  ], 'Pairs: count in 2s, or halve the number.');
};
const ordinalQ = (y) => {
  const [w] = names(1), kind = ri(1, 3), hi = y === 1 ? 10 : 20;
  if (kind === 1) {
    const n = ri(5, hi), k = ri(2, n - 1), v = n - k + 1;
    return explain(int('ordinal position', `${n} children stand in a queue. ${w} is ${ord(k)} from the front. Counting from the back, what position is ${w} in?`, v, { decoys: [...new Set([n - k, n - k + 2, k])].filter((x) => x > 0 && x !== v).map(String) }), [
      `${w} is ${ord(k)} from the front, so ${k - 1} children are in front of ${w}.`,
      `Behind ${w}: ${n} − ${k} = ${n - k} child${n - k === 1 ? '' : 'ren'}.`,
      `From the back, count ${n - k === 1 ? 'that 1' : `those ${n - k}`} and then ${w}: ${n - k} + 1 = ${v}.`,
      `So ${w} is ${ord(v)} from the back, position ${v}.`,
    ], 'Position from the back = the number behind you + 1.');
  }
  if (kind === 2) {
    const k = ri(3, hi);
    return explain(int('ordinal position', `${w} is ${ord(k)} in a line. How many children are in front of ${w}?`, k - 1), [
      `${ord(k)} means ${w} is child number ${k}, so the children in front are the 1st to the ${ord(k - 1)}.`,
      `${k} − 1 = ${k - 1}.`,
      `So ${k - 1} children are in front of ${w}.`,
    ], 'The children in front of the nth child are 1 fewer than n.');
  }
  const k = ri(2, hi - 2), m = ri(1, hi - k);
  return explain(int('ordinal position', `${w} is ${ord(k)} in a queue and ${m} child${m === 1 ? ' is' : 'ren are'} behind ${w}. How many children are in the queue?`, k + m), [
    `${w} is ${ord(k)}, so ${w} and the children in front make ${k}.`,
    `Add the ${m} behind: ${k} + ${m} = ${k + m}.`,
    `So there are ${k + m} children in the queue.`,
  ], 'Your own position counts everyone up to you; then add the ones behind.');
};
const sidesCorners = (y) => {
  const shapes = [['triangle', 3], ['square', 4], ['rectangle', 4], ['pentagon', 5], ['hexagon', 6]].slice(0, y === 1 ? 3 : 5), part = pick(['sides', 'corners']);
  if (ri(1, 2) === 1) {
    const [name, k] = pick(shapes), n = ri(2, y === 1 ? 4 : 6);
    return explain(int('sides and corners', `How many ${part} do ${n} ${name}s have altogether?`, n * k), [
      `A ${name} has ${k} ${part}.`,
      `${n} ${name}s: ${Array(n).fill(k).join(' + ')} = ${n * k}.`,
      `So ${n} ${name}s have ${n * k} ${part} altogether.`,
    ], 'Count the sides or corners of one shape, then add that number once for each shape.');
  }
  const [[n1, k1], [n2, k2]] = shuffle(shapes).slice(0, 2), c1 = ri(1, 3), c2 = ri(1, 3);
  return explain(int('sides and corners', `How many ${part} do ${c1} ${n1}${pl(c1)} and ${c2} ${n2}${pl(c2)} have altogether?`, c1 * k1 + c2 * k2), [
    `A ${n1} has ${k1} ${part} and a ${n2} has ${k2} ${part}.`,
    `${c1} ${n1}${pl(c1)}: ${c1} × ${k1} = ${c1 * k1}. ${c2} ${n2}${pl(c2)}: ${c2} × ${k2} = ${c2 * k2}.`,
    `${c1 * k1} + ${c2 * k2} = ${c1 * k1 + c2 * k2}.`,
    `So they have ${c1 * k1 + c2 * k2} ${part} altogether.`,
  ], 'Count each kind of shape on its own, then add.');
};
const rulerQ = (y) => {
  const [w] = names(1), hi = y === 1 ? 15 : 30, kind = ri(1, 3), item = pick(['crayon', 'pencil', 'leaf', 'key', 'straw']);
  if (kind === 1) {
    const a = ri(1, 6), len = ri(3, hi - a), b = a + len;
    return explain(int('measuring in cm', `A ${item} lies along a ruler. One end is at the ${a} cm mark and the other end is at the ${b} cm mark. How long is the ${item}, in cm?`, len, { decoys: [...new Set([b, len + 1, len - 1, b + a])].filter((x) => x > 0 && x !== len).map(String) }), [
      `The ${item} does not start at the 0 mark: it starts at ${a}.`,
      `Length = end mark − start mark = ${b} − ${a} = ${len}.`,
      `So the ${item} is ${len} cm long.`,
    ], 'When something starts past the 0 mark, take away the start mark.');
  }
  if (kind === 2) {
    const a = ri(8, hi), b = ri(2, a - 2);
    return explain(int('measuring in cm', `A ribbon is ${a} cm long. ${w} cuts off ${b} cm. How long is the ribbon now, in cm?`, a - b), [
      barIf('Ribbon', a, `${a} cm`),
      barIf('Cut off', b, `${b} cm`),
      `Cutting off means take away: ${a} − ${b} = ${a - b}.`,
      `So the ribbon is now ${a - b} cm long.`,
    ], 'Cutting off is taking away.');
  }
  const a = ri(3, hi - 3), b = ri(3, hi - a);
  return explain(int('measuring in cm', `Two sticks, ${a} cm and ${b} cm long, are laid end to end. How long are they together, in cm?`, a + b), [
    barIf('Stick 1', a, `${a} cm`),
    barIf('Stick 2', b, `${b} cm`),
    `End to end means the lengths add: ${a} + ${b} = ${a + b}.`,
    `So together they are ${a + b} cm long.`,
  ], 'End to end: add the lengths.');
};

// ---- the pools: Section A by tier (six-mark A6, eight-mark A8), Section B ----
const A = (y) => {
  const rows = [], add = (cat, gen, ...sections) => rows.push({ cat, gen, sections });
  if (y <= 2) { add('order and direction', lineUp, 'A6'); add('patterns', shapePattern, 'A6'); add('odd one out', oddOne, 'A6'); add('balance puzzles', balance, 'A6', 'A8'); add('calendar logic', calendar, 'A6'); add('math puzzle', puzzle, 'A6'); add('counting', legs, 'A6'); add('number sequences', interleaved, 'A6', 'A8'); add('rule machine', ruleGuess, 'A8'); add('position in a row', positionRow, 'A8'); add('assumption method', assumption, 'A8'); add('three balances', threeBalances, 'A8'); add('counting figures', countFigures, 'A6', 'A8'); add('comparing', chainCompare, 'A6'); add('missing number', missingNumber, 'A6'); add('cuts and pieces', cutsPieces, 'A6'); }
  else if (y <= 4) { add('order and direction', lineUp, 'A6'); add('patterns', shapePattern, 'A6'); add('odd one out', oddOne, 'A6'); add('calendar logic', calendar, 'A6'); add('math puzzle', puzzle, 'A6'); add('counting', countRange, 'A6'); add('number sequences', interleaved, 'A6'); add('rule machine', ruleGuess, 'A6', 'A8'); add('order of operations', orderOps, 'A6'); add('balance puzzles', balance, 'A8'); add('ages', ages, 'A8'); add('logic', truth, 'A8'); add('position in a row', positionRow, 'A8'); add('assumption method', assumption, 'A8'); add('three balances', threeBalances, 'A8'); add('symbol equations', symbolEq, 'A8'); add('adjacent sums', adjacentRing, 'A8'); add('counting figures', countFigures, 'A6', 'A8'); add('comparing', chainCompare, 'A6'); add('missing number', missingNumber, 'A6'); add('cuts and pieces', cutsPieces, 'A6', 'A8'); add('growing sequences', growingJumps, 'A6'); add('handshakes', handshakes, 'A8'); }
  else { add('number sequences', interleaved, 'A6'); add('rule machine', ruleGuess, 'A6'); add('order of operations', orderOps, 'A6'); add('calendar logic', calendar, 'A6'); add('math puzzle', puzzle, 'A6'); add('counting', countRange, 'A6'); add('odd one out', oddOne, 'A6'); add('ages', ages, 'A8'); add('logic', truth, 'A8'); add('position in a row', positionRow, 'A8'); add('assumption method', assumption, 'A8'); add('three balances', threeBalances, 'A8'); add('symbol equations', symbolEq, 'A8'); add('adjacent sums', adjacentRing, 'A8'); add('counting figures', countFigures, 'A8'); add('balance puzzles', balance, 'A8'); add('growing sequences', growingJumps, 'A6'); add('digit puzzles', digitPuzzle, 'A6'); add('handshakes', handshakes, 'A6'); add('cuts and pieces', cutsPieces, 'A6'); add('page numbers', pageNumbers, 'A6'); }
  return rows;
};
const B = (y) => {
  const rows = [['word problems', addSubWords], ['data and graphs', dataQ], ['time', timeQ], ['measurement', unitTrap]];
  if (y === 1) rows.push(['shapes', shapesQ]);
  if (y <= 2) rows.push(['counting objects', countPicture], ['comparing lengths', compareLengths], ['coins and money', coinsQ], ['telling the time', clockQ], ['days of the week', weekDaysQ], ['number stories', storyQ], ['equal groups', equalGroups], ['ordinal position', ordinalQ], ['sides and corners', sidesCorners], ['measuring in cm', rulerQ]);
  if (y >= 2 && y <= 4) rows.push(['multiplication and division', mulDiv]);
  if (y >= 3) rows.push(['units', measure], ['money', moneyQ], ['fractions', fractionsQ], ['two-step charts', twoStepChart]);
  if (y >= 3 && y <= 4) rows.push(['brackets', bracketsOps], ['perimeter and area', perimArea34], ['rounding', rounding34]);
  if (y >= 4) rows.push(['statistics', statsMMR]);
  if (y >= 5) rows.push(['factors and multiples', factors], ['ratio', ratioQ], ['area and volume', areaVolume], ['composite solids', compositeVolume], ['probability', diceProb], ['algebraic thinking', algebra], ['financial literacy', moneyQ], ['remainders', remainderSystem], ['decimals', decimalOps], ['divisibility', divisibleCount]);
  if (y >= 6) rows.push(['speed', speedQ], ['negative numbers', negative], ['exponents', exponents], ['percentages', percentQ]);
  return rows.map(([cat, gen]) => ({ cat, gen, sections: ['B'] }));
};
// the real preliminary paper (wminv.org): 25 multiple choice of four options in two 40-minute sittings — Section A fifteen logical
// reasoning (ten 6-mark, five 8-mark) and Section B ten 10-mark applications. Its 80 minutes split 25 + 15 + 40 (the owner, 20 Sep 2026)
export const PHASES = [phase('alpha', 'Section A · 6 marks', 6, 25, slots([['A6', 'mc', 10]])), phase('beta', 'Section A · 8 marks', 8, 15, slots([['A8', 'mc', 5]])), phase('gamma', 'Section B', 10, 40, slots([['B', 'mc', 10]]))];
export const build = (shape, year) => buildHeat(shape, [...A(year), ...B(year)], year, { options: 4 });
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['A, 6 marks: who is second in the line, the next shape, the odd one out, balance puzzles, two sequences woven together, who is tallest, the missing number, cuts and pieces', 'A, 8 marks: a rule machine, the centre of a row, shamrocks and clovers, three balances, squares in a grid', 'B: adding and taking away in words, the longest length, picture graphs, what time a film ends, counting a picture, coins and change', 'B: equal groups, sides and corners, o\'clock and half past, days of the week, queues, the ruler that starts past 0, number stories'] },
  { band: 'Grades 3–4', lines: ['A, 6 marks: four in a line, sequences woven together, rule machines, order of operations, calendars, who is tallest, growing jumps, cuts and pieces', 'A, 8 marks: ages, who is lying, the centre of a row, quiz scores, three balances, symbol equations, adjacent sums, handshakes', 'B: metres and centimetres, a rope between two lengths, bar charts then money, brackets', 'B: rupiah left after shopping, fractions of a set, perimeter and area, rounding, mean and median'] },
  { band: 'Grades 5–6', lines: ['A, 6 marks: sequences woven together, growing jumps, rule machines, order of operations, primes among the numbers, swapped digits, handshakes, page numbers', 'A, 8 marks: ages, who is lying, symbol equations, adjacent sums, three balances, squares in a grid', 'B: LCM and HCF, ratio of paints, glued blocks, two dice, remainders in bags, decimals, digits that divide', 'B (Grade 6): speed, temperatures below zero, powers, percentages'] },
];
