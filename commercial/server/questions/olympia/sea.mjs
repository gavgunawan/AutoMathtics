// 🌊 SEA-MOON — practice modelled on SEAMO (the Southeast Asian Mathematical Olympiad, Terry Chew Institute, Singapore); not
// affiliated. The real paper's tell is its heuristics named as topics — working backwards, queuing, pigeonhole, shortest path,
// number patterns, sums of sequences — and low reading with high structure. Bands as SEAMO's: Paper A = Years 1–2, B = 3–4,
// C = 5–6. A heat is eight multiple-choice and two short-answer questions; every paper's choices carry the real paper's fifth
// option, "None of the above", which is sometimes the right one: the 2018 Papers A, B and C all have it, only the official
// sample Paper A shows four options (the source check of 20 Sep 2026, against seamo-official.org's samples and syllabi).
import { ri, pick, shuffle, sum, gcd, names, thing, money, int, frac, mcOnly, withFigure, grid, bars, buildHeat, slots, phase, explain, bar, isPrime, factorsOf, digitsOf, cap, ord } from './common.mjs';
// Tiers (20 Sep 2026): the real paper climbs — Q1–10 three marks, Q11–20 four, Q21–25 six and free response — so a heat is four
// three-mark and four four-mark multiple choice then two six-mark typed answers, and every kind is tagged with the tiers it may
// fill in each paper (T(...) below); the kinds under "the paper's tiers" are the staples the source check found missing.

const band = (y) => (y <= 2 ? 1 : y <= 4 ? 2 : 3);
const hm = (h, m) => `${h}:${String(m).padStart(2, '0')}`;
const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
const COLOURS = ['red', 'blue', 'green', 'yellow', 'white'];
// ---- pieces the worked solutions share (STEPS.md, 20 Sep 2026) ----
const tri = (n) => (n * (n + 1)) / 2;
// 1 + 2 + … + n by pairing the ends, the middle number on its own when n is odd
const pairSum = (n) => (n % 2 === 0
  ? [`Pair the ends: 1 + ${n} = ${n + 1}, 2 + ${n - 1} = ${n + 1}, and so on.`, `There are ${n / 2} pairs, each making ${n + 1}: ${n / 2} × ${n + 1} = ${tri(n)}.`]
  : [`Pair the ends: 1 + ${n} = ${n + 1}, 2 + ${n - 1} = ${n + 1}, and so on.`, `There are ${(n - 1) / 2} pairs, each making ${n + 1}, and the middle number ${(n + 1) / 2} is on its own.`, `${(n - 1) / 2} × ${n + 1} = ${((n - 1) / 2) * (n + 1)}, and ${((n - 1) / 2) * (n + 1)} + ${(n + 1) / 2} = ${tri(n)}.`]);
// the routes to each square of a grid, moving right or down: 1 along the top and the left, then the square above plus the square to the left
const pascal = (rows, cols) => { const g = []; for (let r = 0; r < rows; r++) { g.push([]); for (let c = 0; c < cols; c++) g[r].push(r === 0 || c === 0 ? 1 : g[r - 1][c] + g[r][c - 1]); } return g; };
const pascalText = (rows, cols) => pascal(rows, cols).map((r) => r.join(' ')).join(' / ');
const primeFactors = (n) => { const out = []; let m = n; for (let p = 2; p <= m; p++) while (m % p === 0) { out.push(p); m /= p; } return out; };
const sing = (w) => w.replace(/s$/, '');
const cycleLine = (base, e) => { const cyc = CYC[base], len = cyc.length, r = e % len; return `Ones digits of the powers of ${base}: ${cyc.join(', ')}, repeating every ${len}. ${e} ÷ ${len} leaves remainder ${r}, so ${base}^${e} ends in ${cyc[(e - 1) % len]}${r === 0 ? ' (the last of the cycle)' : ''}.`; };

// ---- Paper A up ----
const workBack = (y) => {
  const b = band(y), [w] = names(1), it = thing();
  if (b === 1) {
    const a = ri(2, y === 1 ? 6 : 9), g = ri(3, y === 1 ? 9 : 15), first = ri(a + 1, y === 1 ? 18 : 40);
    return explain(int('working backwards', `${w} had some ${it}s. ${w} gave ${a} to a friend, then got ${g} more. Now ${w} has ${first - a + g}. How many ${it}s did ${w} have at first?`, first), [
      `Start at the end: ${w} has ${first - a + g} now.`,
      `Undo the last move. ${w} got ${g}, so take ${g} away: ${first - a + g} − ${g} = ${first - a}.`,
      `Undo the first move. ${w} gave ${a} away, so put ${a} back: ${first - a} + ${a} = ${first}.`,
      `So ${w} had ${first} ${it}s at first.`,
    ], `"At first" is a clue to work backwards: undo each move in reverse order.`);
  }
  if (b === 2) {
    const first = ri(6, 30), a = ri(2, 9), g = ri(3, 12);
    return explain(int('working backwards', `${w} had some ${it}s. ${w} won a game and doubled them, gave ${a} away, then got ${g} more. Now ${w} has ${first * 2 - a + g}. How many ${it}s did ${w} have at first?`, first), [
      `Start at the end: ${w} has ${first * 2 - a + g} now.`,
      `Undo "got ${g} more": ${first * 2 - a + g} − ${g} = ${first * 2 - a}.`,
      `Undo "gave ${a} away": ${first * 2 - a} + ${a} = ${first * 2}.`,
      `Undo "doubled": ${first * 2} ÷ 2 = ${first}.`,
      `So ${w} had ${first} ${it}s at first.`,
    ], `"At first" is a clue to work backwards: undo each move in reverse order.`);
  }
  const c = ri(4, 30);
  return explain(int('working backwards', `${w} spent half of ${w}'s money on a book, then a third of what was left on a pen, and had ${money(c)} left. How much money did ${w} have at first (in dollars)?`, c * 3), [
    `Cut the money into 6 equal parts. The book took half: 3 parts, leaving 3 parts.`,
    `The pen took a third of the 3 parts left: 1 part. So 2 parts were left.`,
    bar('Money', 6, 'book 3 parts, pen 1 part, left 2 parts'),
    `2 parts = ${money(c)}, so 6 parts = 3 lots of 2 parts = ${money(c)} × 3 = ${money(3 * c)}.`,
    `So ${w} had ${3 * c} dollars at first.`,
  ], 'Cut the whole into equal parts that both fractions can use, then count parts.');
};
const pattern = (y) => {
  const b = band(y);
  if (b === 1) {
    const s = ri(1, 20), k = pick([2, 3, 5, 10]), back = Math.random() < 0.3 && s > 5 * k; const terms = Array.from({ length: 5 }, (_, i) => (back ? s + 5 * k - i * k : s + i * k)), next = back ? s : s + 5 * k;
    return explain(int('number patterns', `${terms.join(', ')}, ___. What number comes next?`, next), [
      `Look at the jumps: from ${terms[0]} to ${terms[1]} the numbers go ${back ? 'down' : 'up'} by ${k}, and from ${terms[1]} to ${terms[2]} by ${k} again.`,
      `Every jump is ${back ? 'down' : 'up'} by ${k}, so jump once more: ${terms[4]} ${back ? '−' : '+'} ${k} = ${next}.`,
      `So the next number is ${next}.`,
    ], 'When a pattern is missing a number, check the jumps between neighbours first.');
  }
  if (b === 2) {
    if (Math.random() < 0.5) {
      const s = ri(2, 30), k = ri(3, 9), n = pick([8, 10, 12]), terms = Array.from({ length: 4 }, (_, i) => s + i * k);
      return explain(int('number patterns', `${terms.join(', ')}, … What is the ${n}th number in this pattern?`, s + (n - 1) * k), [
        `Look at the jumps: ${terms[0]} → ${terms[1]} → ${terms[2]} → ${terms[3]}, up by ${k} each time.`,
        `The 1st number is ${s}. To reach the ${n}th number you make ${n} − 1 = ${n - 1} jumps of ${k}.`,
        `${n - 1} × ${k} = ${(n - 1) * k}, and ${s} + ${(n - 1) * k} = ${s + (n - 1) * k}.`,
        `So the ${n}th number is ${s + (n - 1) * k}.`,
      ], 'To reach a far-away number, count the jumps from the first one: one fewer than its position.');
    }
    const a = ri(1, 15), terms = [a, a + 2, a + 5, a + 7, a + 10, a + 12];
    return explain(int('number patterns', `${terms.slice(0, 5).join(', ')}, ___. What number comes next?`, terms[5]), [
      `Look at the jumps: ${terms[0]} → ${terms[1]} is +2, ${terms[1]} → ${terms[2]} is +3, ${terms[2]} → ${terms[3]} is +2, ${terms[3]} → ${terms[4]} is +3.`,
      `The jumps take turns: +2, +3, +2, +3, so the next jump is +2.`,
      `${terms[4]} + 2 = ${terms[5]}.`,
      `So the next number is ${terms[5]}.`,
    ], 'When the jumps are not all the same, look for a pattern in the jumps themselves.');
  }
  const kind = ri(1, 4);
  if (kind === 1) {
    const d = pick([0, 1, 2]), terms = [1, 2, 3, 4, 5].map((n) => n * n + d);
    return explain(int('number patterns', `${terms.join(', ')}, ___. What number comes next?`, 36 + d), [
      `Look at the jumps: ${terms[1] - terms[0]}, ${terms[2] - terms[1]}, ${terms[3] - terms[2]}, ${terms[4] - terms[3]}. Each jump is 2 bigger than the last.`,
      `The next jump is ${terms[4] - terms[3] + 2}: ${terms[4]} + ${terms[4] - terms[3] + 2} = ${36 + d}.`,
      `Another way: the numbers are the squares 1, 4, 9, 16, 25${d ? ` plus ${d}` : ''}, and 6 × 6 = 36${d ? `, plus ${d} is ${36 + d}` : ''}.`,
      `So the next number is ${36 + d}.`,
    ], 'Jumps of 3, 5, 7, 9 … mean square numbers are hiding in the pattern.');
  }
  if (kind === 2) {
    const a = pick([3, 5, 7]);
    return explain(int('number patterns', `${[a, a * 2, a * 4, a * 8].join(', ')}, ___. What number comes next?`, a * 16), [
      `Look at the jumps: ${a} → ${a * 2} → ${a * 4} → ${a * 8}. Each number is double the one before.`,
      `${a * 8} × 2 = ${a * 16}.`,
      `So the next number is ${a * 16}.`,
    ], 'If adding does not give a steady jump, try multiplying instead.');
  }
  if (kind === 3) return explain(int('number patterns', '1, 3, 6, 10, 15, ___. What number comes next?', 21), [
    'Look at the jumps: +2, +3, +4, +5. Each jump is 1 bigger than the last.',
    'The next jump is +6: 15 + 6 = 21.',
    'So the next number is 21.',
  ], 'These are the triangular numbers: add 2, then 3, then 4, and so on.');
  const s = ri(2, 9), k = ri(3, 9), n = ri(8, 15);
  return explain(int('number patterns', `${[s, s + k, s + 2 * k].join(', ')}, … What is the ${n}th number in this pattern?`, s + (n - 1) * k), [
    `Look at the jumps: ${s} → ${s + k} → ${s + 2 * k}, up by ${k} each time.`,
    `The 1st number is ${s}. To reach the ${n}th number you make ${n} − 1 = ${n - 1} jumps of ${k}.`,
    `${n - 1} × ${k} = ${(n - 1) * k}, and ${s} + ${(n - 1) * k} = ${s + (n - 1) * k}.`,
    `So the ${n}th number is ${s + (n - 1) * k}.`,
  ], 'To reach a far-away number, count the jumps from the first one: one fewer than its position.');
};
const seqSum = (y) => {
  const b = band(y);
  const PAIR = 'Pair the first and last numbers: every pair adds up to the same total.';
  if (b === 1) { const n = ri(y === 1 ? 5 : 8, y === 1 ? 10 : 12); return explain(int('sum of a sequence', `1 + 2 + 3 + … + ${n} = ?`, tri(n)), [...pairSum(n), `So 1 + 2 + 3 + … + ${n} = ${tri(n)}.`], PAIR); }
  if (b === 2) { const n = ri(15, 30); return explain(int('sum of a sequence', `What is 1 + 2 + 3 + … + ${n}?`, tri(n)), [...pairSum(n), `So 1 + 2 + 3 + … + ${n} = ${tri(n)}.`], PAIR); }
  const kind = ri(1, 3);
  if (kind === 1) { const n = pick([40, 50, 60, 80, 100]); return explain(int('sum of a sequence', `What is 1 + 2 + 3 + … + ${n}?`, tri(n)), [...pairSum(n), `So 1 + 2 + 3 + … + ${n} = ${tri(n)}.`], PAIR); }
  if (kind === 2) {
    const m = ri(10, 25);
    return explain(int('sum of a sequence', `What is 2 + 4 + 6 + … + ${2 * m}?`, m * (m + 1)), [
      `Count the numbers: 2, 4, 6, … up to ${2 * m} is ${m} numbers.`,
      `The first and last make 2 + ${2 * m} = ${2 * m + 2}, and every pair from the ends makes the same, so the average number is ${2 * m + 2} ÷ 2 = ${m + 1}.`,
      `${m} numbers × ${m + 1} = ${m * (m + 1)}.`,
      `So 2 + 4 + 6 + … + ${2 * m} = ${m * (m + 1)}.`,
    ], 'Sum = how many numbers × (first + last) ÷ 2.');
  }
  const m = ri(8, 20);
  return explain(int('sum of a sequence', `What is 1 + 3 + 5 + … + ${2 * m - 1}?`, m * m), [
    `Count the numbers: 1, 3, 5, … up to ${2 * m - 1} is ${m} numbers.`,
    `The first and last make 1 + ${2 * m - 1} = ${2 * m}, so the average number is ${2 * m} ÷ 2 = ${m}.`,
    `${m} numbers × ${m} = ${m * m}.`,
    `So 1 + 3 + 5 + … + ${2 * m - 1} = ${m * m}.`,
  ], 'The sum of the first few odd numbers is always a square: 1, 4, 9, 16 …');
};
const pigeonhole = (y) => {
  const b = band(y), cs = shuffle(COLOURS).slice(0, b === 1 ? 2 : 3), counts = cs.map(() => ri(3, 9)), it = pick(['marble', 'ball', 'bead']);
  const bag = cs.map((c, i) => `${counts[i]} ${c}`).join(cs.length === 2 ? ' and ' : ', ').replace(/, (\d+ \w+)$/, ' and $1');
  const kind = b === 3 ? ri(1, 3) : b === 2 ? ri(1, 2) : 1, WORST = 'Imagine the worst luck first, then add 1.';
  if (kind === 1) return explain(int('pigeonhole principle', `A bag has ${bag} ${it}s. Without looking, what is the smallest number of ${it}s you must take out to be sure of two of the same colour?`, cs.length + 1), [
    `Think of the worst luck: the first ${cs.length} ${it}s could all be different colours (${cs.join(', ')}).`,
    `The next ${it} must match one of them: ${cs.length} + 1 = ${cs.length + 1}.`,
    `So you must take out ${cs.length + 1} ${it}s.`,
  ], WORST);
  if (kind === 2) {
    const i = ri(0, cs.length - 1), others = cs.map((c, j) => (j === i ? null : `${counts[j]} ${c}`)).filter(Boolean), rest = sum(counts) - counts[i];
    return explain(int('pigeonhole principle', `A bag has ${bag} ${it}s. Without looking, what is the smallest number of ${it}s you must take out to be sure of at least one ${cs[i]} ${it}?`, rest + 1), [
      `Think of the worst luck: every ${it} that is not ${cs[i]} comes out first.`,
      `That is ${others.join(' + ')} = ${rest} ${it}s.`,
      `The next ${it} must be ${cs[i]}: ${rest} + 1 = ${rest + 1}.`,
      `So you must take out ${rest + 1} ${it}s.`,
    ], WORST);
  }
  return explain(int('pigeonhole principle', `A bag has ${bag} ${it}s. Without looking, what is the smallest number of ${it}s you must take out to be sure of three of the same colour?`, 2 * cs.length + 1), [
    `Think of the worst luck: you could take out 2 of every colour and still have no three the same.`,
    `That is 2 × ${cs.length} = ${2 * cs.length} ${it}s.`,
    `The next ${it} makes three of some colour: ${2 * cs.length} + 1 = ${2 * cs.length + 1}.`,
    `So you must take out ${2 * cs.length + 1} ${it}s.`,
  ], WORST);
};
const queue = (y) => {
  const b = band(y), [a, c] = names(2);
  if (b === 1) {
    const f = ri(2, y === 1 ? 6 : 9), k = ri(2, y === 1 ? 6 : 9);
    return explain(int('queuing', `${a} is standing in a queue. ${a} is ${ord(f)} from the front and ${ord(k)} from the back. How many people are in the queue?`, f + k - 1), [
      `${a} is ${ord(f)} from the front, so ${f - 1 === 1 ? '1 person is' : `${f - 1} people are`} in front of ${a}.`,
      `${a} is ${ord(k)} from the back, so ${k - 1 === 1 ? '1 person is' : `${k - 1} people are`} behind ${a}.`,
      `In front + ${a} + behind: ${f - 1} + 1 + ${k - 1} = ${f + k - 1}.`,
      `So there are ${f + k - 1} people in the queue.`,
    ], 'Count the people in front, the people behind, and the person in the middle once.');
  }
  if (b === 2) {
    const n = ri(12, 25), f = ri(2, 5), k = ri(2, 5);
    return explain(int('queuing', `${n} children stand in a line. ${a} is ${ord(f)} from the front and ${c} is ${ord(k)} from the back. How many children are between ${a} and ${c}?`, n - f - k), [
      `From the front, ${a} and the children in front of ${a} make ${f} children.`,
      `From the back, ${c} and the children behind ${c} make ${k} children.`,
      `Take both groups away from the line: ${n} − ${f} − ${k} = ${n - f - k}.`,
      `So there are ${n - f - k} children between ${a} and ${c}.`,
    ], 'Take away the front group and the back group; what is left is in between.');
  }
  const n = pick([12, 16, 20, 24, 30]), k = ri(1, n / 2);
  return explain(int('queuing', `${n} children stand in a circle, evenly spaced, numbered 1 to ${n} in order. Which number is directly opposite child ${k}?`, k + n / 2), [
    `In a circle of ${n}, the child opposite you is half the circle away: ${n} ÷ 2 = ${n / 2} places further round.`,
    `${k} + ${n / 2} = ${k + n / 2}.`,
    `So child ${k + n / 2} is directly opposite child ${k}.`,
  ], 'Opposite in a circle means half the circle further round.');
};
const oddEven = (y) => {
  const b = band(y), kind = ri(1, 3);
  if (b === 1) {
    if (kind === 1) {
      const n = ri(9, y === 1 ? 20 : 40), odd = Math.ceil(n / 2);
      return explain(int('odd and even numbers', `How many odd numbers are there from 1 to ${n}?`, odd), [
        `Odd and even numbers take turns: 1, 2, 3, 4, … so about half the numbers are odd.`,
        n % 2 ? `${n} is odd, so the odd numbers are one ahead: (${n} + 1) ÷ 2 = ${odd}.` : `${n} is even, so exactly half are odd: ${n} ÷ 2 = ${odd}.`,
        `So there are ${odd} odd numbers from 1 to ${n}.`,
      ], 'Odd and even numbers take turns, so about half the numbers are odd.');
    }
    return explain(mcOnly('odd and even numbers', 'When you add an odd number and an odd number, the answer is always…', 'even', ['odd', 'a prime number', 'a two-digit number']), [
      'Try it: 1 + 1 = 2, 3 + 5 = 8, 7 + 9 = 16.',
      'An odd number is pairs with 1 left over; two leftovers make a new pair, so nothing is left over.',
      'So odd + odd is always even.',
    ], 'Try a few small examples first: the pattern shows itself.');
  }
  if (b === 2) {
    if (kind === 1) {
      const a = ri(10, 40), n = ri(10, 30), lo = Math.ceil(a / 2) * 2, hi = Math.floor((a + n) / 2) * 2, count = (hi - lo) / 2 + 1;
      return explain(int('odd and even numbers', `How many even numbers are there from ${a} to ${a + n}?`, count), [
        `The first even number from ${a} is ${lo}, and the last even number up to ${a + n} is ${hi}.`,
        `Even numbers go up in 2s: from ${lo} to ${hi} is (${hi} − ${lo}) ÷ 2 = ${(hi - lo) / 2} jumps.`,
        `${(hi - lo) / 2} jumps means ${(hi - lo) / 2} + 1 = ${count} numbers.`,
        `So there are ${count} even numbers from ${a} to ${a + n}.`,
      ], 'Count the jumps, then add 1 for the first number.');
    }
    return explain(mcOnly('odd and even numbers', 'The sum of three odd numbers is always…', 'odd', ['even', 'a multiple of 3', 'a square number']), [
      'Try it: 1 + 3 + 5 = 9, 3 + 5 + 7 = 15.',
      'Odd + odd = even, and then even + odd = odd.',
      'So the sum of three odd numbers is always odd.',
    ], 'Try a few small examples first: the pattern shows itself.');
  }
  if (kind === 1) {
    const k = ri(3, 9);
    return explain(mcOnly('odd and even numbers', `The product of ${k} odd numbers and one even number is always…`, 'even', ['odd', 'a prime number', 'a multiple of 5']), [
      'Try it: 3 × 5 × 2 = 30, 1 × 3 × 7 × 4 = 84.',
      'Any number times an even number is even, because the even number brings a factor of 2.',
      'So the product is always even.',
    ], 'One even factor is enough to make a whole product even.');
  }
  if (kind === 2) {
    const k = ri(4, 12);
    return explain(int('odd and even numbers', `What is the sum of the first ${k} odd numbers?`, k * k), [
      `List them: 1, 3, 5, … the ${ord(k)} odd number is 2 × ${k} − 1 = ${2 * k - 1}.`,
      `The first and last make 1 + ${2 * k - 1} = ${2 * k}, so the average number is ${k}.`,
      `${k} numbers × ${k} = ${k * k}.`,
      `So the sum of the first ${k} odd numbers is ${k * k}.`,
    ], 'The sum of the first few odd numbers is always a square: 1, 4, 9, 16 …');
  }
  const n = ri(5, 12);
  return explain(mcOnly('odd and even numbers', `Is 2 × 2 × … × 2 (${n} twos multiplied) + 1 odd or even?`, 'odd', ['even', 'it depends on n', 'zero']), [
    `2 × 2 × … × 2 (${n} twos) is even, because it has 2 as a factor.`,
    'An even number plus 1 is always odd.',
    `So 2 × 2 × … × 2 + 1 is odd.`,
  ], 'A product with a factor of 2 is even; add 1 and it becomes odd.');
};
const time = (y) => {
  const b = band(y), kind = ri(1, 2);
  if (b === 1) {
    if (kind === 1) {
      const h = ri(1, 9), d = ri(1, 3), chain = Array.from({ length: d + 1 }, (_, i) => hm(h + i, 0)).join(' → ');
      return explain(int('time', `A film starts at ${hm(h, 0)} and ends at ${hm(h + d, 0)}. How many hours long is it?`, d), [
        `Count on in hours from ${hm(h, 0)}: ${chain}.`,
        `That is ${d} jump${d > 1 ? 's' : ''} of 1 hour.`,
        `So the film is ${d} hour${d > 1 ? 's' : ''} long.`,
      ], 'Count on from the start time, one hour at a time.');
    }
    const h = ri(1, 9), m = pick([0, 30]), d = ri(1, 3); const end = hm(h + d, m), chain = Array.from({ length: d + 1 }, (_, i) => hm(h + i, m)).join(' → ');
    return explain(mcOnly('time', `It is ${hm(h, m)} now. What time will it be in ${d} hour${d > 1 ? 's' : ''}?`, end, [hm(h + d + 1, m), hm(h + d, m === 0 ? 30 : 0), hm(h, m)]), [
      `Count on ${d} hour${d > 1 ? 's' : ''} from ${hm(h, m)}: ${chain}.`,
      `Only the hour changes; the minutes stay at ${String(m).padStart(2, '0')}.`,
      `So in ${d} hour${d > 1 ? 's' : ''} it will be ${end}.`,
    ], 'Adding whole hours changes only the hour; the minutes stay the same.');
  }
  if (b === 2) {
    const h = ri(1, 9), m = ri(1, 11) * 5, d = ri(3, 11) * 5, e = h * 60 + m + d, arr = hm(Math.floor(e / 60), e % 60), toHour = 60 - m, NEXT = 'Jump to the next full hour first, then add the rest.';
    if (kind === 1) return explain(int('time', `A bus leaves at ${hm(h, m)} and arrives at ${arr}. How many minutes does the ride take?`, d), d < toHour
      ? [`Both times are in the same hour, so take the minutes: ${e % 60} − ${m} = ${d}.`, `So the ride takes ${d} minutes.`]
      : d === toHour ? [`From ${hm(h, m)} to ${arr} is exactly up to the next hour: 60 − ${m} = ${d}.`, `So the ride takes ${d} minutes.`]
        : [`First go up to the next hour: ${hm(h, m)} to ${hm(h + 1, 0)} is 60 − ${m} = ${toHour} minutes.`, `Then ${hm(h + 1, 0)} to ${arr} is ${e % 60} more minutes.`, `${toHour} + ${e % 60} = ${d}.`, `So the ride takes ${d} minutes.`], NEXT);
    return explain(mcOnly('time', `A lesson starts at ${hm(h, m)} and lasts ${d} minutes. When does it end?`, arr, [hm(Math.floor((e + 10) / 60), (e + 10) % 60), hm(Math.floor((e - 5) / 60), (e - 5) % 60), hm(Math.floor((e + 60) / 60), (e + 60) % 60)]), d < toHour
      ? [`Add the minutes: ${m} + ${d} = ${m + d}, still inside the same hour.`, `So the lesson ends at ${arr}.`]
      : d === toHour ? [`${m} + ${d} = 60 minutes, which is exactly the next full hour.`, `So the lesson ends at ${arr}.`]
        : [`First go up to the next hour: ${hm(h, m)} + ${toHour} min = ${hm(h + 1, 0)}.`, `${d} − ${toHour} = ${d - toHour} minutes are still to add: ${hm(h + 1, 0)} + ${d - toHour} min = ${arr}.`, `So the lesson ends at ${arr}.`], NEXT);
  }
  const h = ri(13, 21), m = ri(0, 11) * 5, dh = ri(1, 2), dm = ri(1, 11) * 5, e = h * 60 + m + dh * 60 + dm;
  const at = (mins) => { const t = ((mins % 1440) + 1440) % 1440; return hm(Math.floor(t / 60), t % 60); }; // past midnight the clock reads 0:10, never 24:10 (the source check found 24:xx in 1.4 % of these)
  if (kind === 1) return explain(mcOnly('time', `A concert starts at ${hm(h, m)} and lasts ${dh} h ${dm} min. At what time does it end (24-hour clock)?`, at(e), [at(e + 10), at(e - 60), at(e + 5)]), [
    `Add the hours first: ${hm(h, m)} + ${dh} h = ${at(h * 60 + m + dh * 60)}.`,
    m + dm >= 60 ? `Then the minutes: ${m} + ${dm} = ${m + dm}, which is 1 hour and ${m + dm - 60} minutes, so the hour goes up by 1 more.` : `Then the minutes: ${m} + ${dm} = ${m + dm}.`,
    e >= 1440 ? 'Past midnight the clock starts again from 0:00.' : '',
    `So the concert ends at ${at(e)}.`,
  ], 'Add the hours first, then the minutes; 60 minutes makes one more hour.');
  const days = ri(2, 6), hrs = ri(1, 23);
  return explain(int('time', `How many hours are there in ${days} days and ${hrs} hours?`, days * 24 + hrs), [
    `1 day = 24 hours, so ${days} days = ${days} × 24 = ${days * 24} hours.`,
    `${days * 24} + ${hrs} = ${days * 24 + hrs}.`,
    `So there are ${days * 24 + hrs} hours in ${days} days and ${hrs} hours.`,
  ], 'Change the days into hours first, then add the extra hours.');
};
const squares = (y) => {
  const b = band(y);
  if (b < 3 || Math.random() < 0.5) {
    const n = b === 1 ? 2 : b === 2 ? 3 : 4, sizes = Array.from({ length: n }, (_, i) => i + 1), total = sum(sizes.map((s) => s * s));
    return explain(withFigure(int('counting figures', `How many squares of every size are there in this ${n} by ${n} grid?`, total), grid('Count the squares', n, n)), [
      ...sizes.map((s) => `${s} by ${s} squares: ${n - s + 1} × ${n - s + 1} = ${(n - s + 1) * (n - s + 1)}.`),
      `${sizes.map((s) => (n - s + 1) * (n - s + 1)).join(' + ')} = ${total}.`,
      `So there are ${total} squares of every size.`,
    ], 'Count the squares one size at a time, from the smallest to the biggest.');
  }
  const r = ri(2, 3), c = ri(3, 4), pairs = (k) => Array.from({ length: k - 1 }, (_, i) => k - 1 - i).join(' + '), total = choose(r + 1, 2) * choose(c + 1, 2);
  return explain(withFigure(int('counting figures', `How many rectangles of every size (squares included) are there in this ${r} by ${c} grid?`, total), grid('Count the rectangles', r, c)), [
    `A rectangle is made by choosing 2 of the ${r + 1} lines that go across and 2 of the ${c + 1} lines that go down.`,
    `Pairs of lines across: ${pairs(r + 1)} = ${choose(r + 1, 2)}. Pairs of lines down: ${pairs(c + 1)} = ${choose(c + 1, 2)}.`,
    `${choose(r + 1, 2)} × ${choose(c + 1, 2)} = ${total}.`,
    `So there are ${total} rectangles of every size.`,
  ], 'Every rectangle is fixed by 2 lines across and 2 lines down.');
};
const shortestPath = (y) => {
  const b = band(y), [r, c] = b === 1 ? pick([[2, 2], [2, 3], [3, 2]]) : b === 2 ? pick([[3, 3], [2, 4], [3, 4]]) : pick([[4, 4], [3, 5], [4, 5]]);
  // square to square, as the figure shows it: A and B sit in the corner squares, so the count is C(r+c−2, r−1), not the lattice-point count the old wording implied
  const ways = pascal(r, c), total = choose(r + c - 2, r - 1);
  return explain(withFigure(int('shortest path', `The grid has ${r} rows and ${c} columns of squares. Moving only right or down from one square to the next, how many different shortest routes are there from square A to square B?`, total), grid('Routes A to B', r, c, { '0,0': 'A', [`${r - 1},${c - 1}`]: 'B' })), [
    'Write in each square the number of ways to reach it: 1 along the top row and the left column, then the number above plus the number to the left.',
    ...ways.map((row, i) => `Row ${i + 1}: ${row.join(', ')}`),
    `Square B gets ${total}.`,
    `So there are ${total} shortest routes from A to B.`,
  ], 'Number the squares: each one is the square above plus the square to its left.');
};
const logic = (y) => {
  const b = band(y);
  if (b === 1) {
    const [a, c, d] = names(3), attr = pick([['taller', 'tallest', 'shortest'], ['older', 'oldest', 'youngest'], ['faster', 'fastest', 'slowest']]), top = Math.random() < 0.5;
    return explain(mcOnly('logic', `${a} is ${attr[0]} than ${c}. ${d} is ${attr[0]} than ${a}. Who is the ${top ? attr[1] : attr[2]}?`, top ? d : c, [a, top ? c : d, 'Cannot be told']), [
      `Line them up. ${a} is ${attr[0]} than ${c}: ${a}, then ${c}.`,
      `${d} is ${attr[0]} than ${a}, so ${d} goes in front: ${d}, ${a}, ${c}.`,
      `The ${attr[1]} is at the front of the line and the ${attr[2]} is at the back.`,
      `So the ${top ? attr[1] : attr[2]} is ${top ? d : c}.`,
    ], 'Line them up in order, then read off the two ends.');
  }
  if (b === 2 || Math.random() < 0.5) {
    const n = ri(24, 40), both = ri(3, 10), onlyA = ri(4, 12), onlyB = ri(4, 12), neither = n - both - onlyA - onlyB; if (neither < 1) return null; const [x, z] = pick([['tea', 'coffee'], ['football', 'swimming'], ['cats', 'dogs']]);
    return explain(int('logic', `In a class of ${n} children, ${onlyA + both} like ${x}, ${onlyB + both} like ${z}, and ${neither} like neither. How many like both ${x} and ${z}?`, both), [
      `${neither} like neither, so ${n} − ${neither} = ${n - neither} children like at least one of them.`,
      `Add the two groups: ${onlyA + both} + ${onlyB + both} = ${onlyA + onlyB + 2 * both}. Anyone who likes both was counted twice.`,
      `The extra is the "both" group: ${onlyA + onlyB + 2 * both} − ${n - neither} = ${both}.`,
      `So ${both} children like both ${x} and ${z}.`,
    ], 'When two groups are added, anyone in both groups is counted twice.');
  }
  const w = names(4);
  return explain(mcOnly('logic', `Four runners finished a race. ${w[1]} finished before ${w[2]} but after ${w[0]}. ${w[3]} was last. Who finished second?`, w[1], [w[0], w[2], w[3]]), [
    `${w[1]} finished after ${w[0]}, so ${w[0]} is ahead of ${w[1]}.`,
    `${w[1]} finished before ${w[2]}: so far the order is ${w[0]}, ${w[1]}, ${w[2]}.`,
    `${w[3]} was last: ${w[0]}, ${w[1]}, ${w[2]}, ${w[3]}.`,
    `So ${w[1]} finished second.`,
  ], 'Build the order one clue at a time, then read off the place you are asked for.');
};
const speed = (y) => {
  const b = band(y);
  if (b === 1) {
    const v = ri(2, 5), t = ri(2, 4), [w] = names(1);
    return explain(int('simple speed', `${w} walks ${v} km every hour. How far does ${w} walk in ${t} hours?`, v * t), [
      `Every hour ${w} walks ${v} km, so add ${v} km for each of the ${t} hours.`,
      `${Array(t).fill(v).join(' + ')} = ${v * t}, that is ${v} × ${t} = ${v * t}.`,
      `So ${w} walks ${v * t} km.`,
    ], 'The same distance every hour: add it once for each hour, or multiply.');
  }
  if (b === 2) {
    const v = ri(3, 9) * 10, t = ri(2, 4);
    return explain(int('simple speed', `A car travels ${v * t} km in ${t} hours at a steady speed. What is its speed in km/h?`, v), [
      `Speed is the distance for 1 hour, so share the ${v * t} km equally among the ${t} hours.`,
      `${v * t} ÷ ${t} = ${v}.`,
      `So the speed is ${v} km/h.`,
    ], 'Speed = distance ÷ time.');
  }
  const v1 = pick([10, 12, 15, 20]), t1 = ri(1, 3), v2 = pick([3, 4, 5, 6]), t2 = ri(1, 3), w = pick(names(1));
  return explain(int('speed', `${w} cycles ${v1 * t1} km at ${v1} km/h, then walks ${v2 * t2} km at ${v2} km/h. How many hours does the whole journey take?`, t1 + t2), [
    `Cycling: ${v1 * t1} km at ${v1} km/h takes ${v1 * t1} ÷ ${v1} = ${t1} hour${t1 > 1 ? 's' : ''}.`,
    `Walking: ${v2 * t2} km at ${v2} km/h takes ${v2 * t2} ÷ ${v2} = ${t2} hour${t2 > 1 ? 's' : ''}.`,
    `${t1} + ${t2} = ${t1 + t2}.`,
    `So the whole journey takes ${t1 + t2} hours.`,
  ], 'Time = distance ÷ speed, one leg of the journey at a time.');
};
const addSub = (y) => {
  if (band(y) === 1) {
    const hi = y === 1 ? 20 : 60, s = ri(8, hi), a = ri(1, s - 1);
    return explain(int('addition and subtraction', `${a} + ___ = ${s}. What number goes in the blank?`, s - a), [
      `The whole is ${s} and one part is ${a}. The missing part is the whole take away the part you know.`,
      `${s} − ${a} = ${s - a}.`,
      `Check: ${a} + ${s - a} = ${s}.`,
      `So the number in the blank is ${s - a}.`,
    ], 'A missing part is the whole take away the part you know.');
  }
  const small = ri(5, 40), d = ri(2, 15), s = 2 * small + d;
  return explain(int('sum and difference', `Two numbers add up to ${s}. One is ${d} more than the other. What is the bigger number?`, small + d), [
    bar('Smaller', 3, ''),
    bar('Bigger', 3, `and ${d} more   (both together: ${s})`),
    `Take away the extra ${d}: ${s} − ${d} = ${s - d}. That is 2 equal parts.`,
    `1 part = ${s - d} ÷ 2 = ${small}, the smaller number.`,
    `Bigger number: ${small} + ${d} = ${small + d}.`,
    `So the bigger number is ${small + d}.`,
  ], 'Take away the difference first, then share what is left equally.');
};
const digits = () => {
  const t = ri(3, 9), u = ri(0, t - 1); if (t === u) return null;
  return explain(int('number puzzle', `A two-digit number has digits that add up to ${t + u}. Its tens digit is ${t - u} more than its ones digit. What is the number?`, t * 10 + u), [
    bar('Ones', 2, ''),
    bar('Tens', 2, `and ${t - u} more   (both digits together: ${t + u})`),
    `Take away the extra ${t - u}: ${t + u} − ${t - u} = ${2 * u}. That is 2 equal parts.`,
    `Ones digit = ${2 * u} ÷ 2 = ${u}. Tens digit = ${u} + ${t - u} = ${t}.`,
    `So the number is ${t * 10 + u}.`,
  ], 'A sum and a difference: take away the difference, share equally, then add the difference back to one part.');
};
const handshakes = (y) => {
  const n = band(y) === 2 ? ri(4, 7) : ri(6, 12), list = Array.from({ length: n - 1 }, (_, i) => n - 1 - i).join(' + ');
  return explain(int('counting', `${n} friends meet. Each shakes hands once with every other friend. How many handshakes are there?`, (n * (n - 1)) / 2), [
    `The 1st friend shakes hands with the other ${n - 1}.`,
    `The 2nd has already shaken with the 1st, so only ${n - 2} new handshakes; then ${n - 3}, and so on down to 1.`,
    `${list} = ${(n * (n - 1)) / 2}.`,
    `So there are ${(n * (n - 1)) / 2} handshakes.`,
  ], 'Each new person only shakes hands with the people counted before them.');
};
const remainder = (y) => {
  const b = band(y);
  if (b === 2 || Math.random() < 0.4) {
    const d = ri(4, 9), r = ri(1, d - 1), k = ri(3, 12), N = d * k + r, lo = N - ri(0, d - 2);
    return explain(int('remainders', `A whole number from ${lo} to ${lo + d - 2} leaves a remainder of ${r} when divided by ${d}. What is the number?`, N), [
      `A number that leaves remainder ${r} is a multiple of ${d} plus ${r}.`,
      `Find the multiple of ${d} just below the range: ${d} × ${k} = ${d * k}.`,
      `Add the remainder: ${d * k} + ${r} = ${N}, which is between ${lo} and ${lo + d - 2}.`,
      `Check: ${N} ÷ ${d} = ${k} remainder ${r}.`,
      `So the number is ${N}.`,
    ], 'A number that leaves a remainder is a multiple of the divisor plus that remainder.');
  }
  const base = pick([2, 3, 7, 9]), cyc = { 2: [2, 4, 8, 6], 3: [3, 9, 7, 1], 7: [7, 9, 3, 1], 9: [9, 1] }[base], n = ri(5, 30), len = cyc.length, r = n % len, ans = cyc[(n - 1) % len];
  return explain(int('ones digit', `What is the ones digit of ${base} multiplied by itself ${n} times (${base} to the power ${n})?`, ans), [
    `Look at the ones digits of the powers of ${base}: ${cyc.join(', ')}, then they repeat every ${len}.`,
    `${n} ÷ ${len} = ${Math.floor(n / len)} remainder ${r}.`,
    r === 0 ? `A remainder of 0 means the last number of the cycle: ${ans}.` : `A remainder of ${r} means the ${ord(r)} number of the cycle: ${ans}.`,
    `So the ones digit is ${ans}.`,
  ], 'Ones digits of powers go round in a short cycle: divide the power by the cycle length and use the remainder.');
};
const venn = (y) => logic(Math.max(3, y));

// ---- Paper C ----
const newOp = () => {
  const [sym, f, words, show] = pick([['★', (a, b) => a * b - a - b, 'a ★ b = a × b − a − b', (a, b) => `${a} × ${b} − ${a} − ${b}`], ['▲', (a, b) => 2 * a + b, 'a ▲ b = 2 × a + b', (a, b) => `2 × ${a} + ${b}`], ['◆', (a, b) => a * b + a + b, 'a ◆ b = a × b + a + b', (a, b) => `${a} × ${b} + ${a} + ${b}`], ['●', (a, b) => a * a - b, 'a ● b = a × a − b', (a, b) => `${a} × ${a} − ${b}`]]);
  const a = ri(2, 6), b = ri(2, 6), c = ri(2, 5), inner = f(a, b); if (inner < 0 || inner > 60) return null; const v = f(inner, c); if (v < 0 || v > 5000) return null;
  return explain(int('defining new operations', `For any two whole numbers a and b, define ${words}. Find (${a} ${sym} ${b}) ${sym} ${c}.`, v), [
    `Do the bracket first, putting ${a} and ${b} into the rule: ${a} ${sym} ${b} = ${show(a, b)} = ${inner}.`,
    `Now use the rule again with ${inner} and ${c}: ${inner} ${sym} ${c} = ${show(inner, c)} = ${v}.`,
    `So (${a} ${sym} ${b}) ${sym} ${c} = ${v}.`,
  ], 'Work out the bracket first, then put its answer into the rule again.');
};
const fractions = () => {
  const kind = ri(1, 3), [w] = names(1);
  if (kind === 1) {
    const [f1, f2, mult, rem, d1, d2] = pick([['a third', 'a quarter', 2, 'half', 3, 4], ['a quarter', 'a third', 2, 'half', 4, 3], ['a fifth', 'half', 5, 'two fifths', 5, 2], ['half', 'a third', 3, 'a third', 2, 3]]); const c = mult === 5 ? ri(3, 12) * 2 : ri(4, 40); const first = mult === 5 ? (c * 5) / 2 : c * mult;
    const keepN = (d1 - 1) * (d2 - 1), keepD = d1 * d2, g = gcd(keepN, keepD), kn = keepN / g, kd = keepD / g; // the fraction of the money that is left, in lowest terms
    return explain(int('fractions', `${w} spent ${f1} of ${w}'s money on a book, then ${f2} of the remainder on a pen, and had ${money(c)} left. How much money did ${w} have at first (in dollars)?`, first, { read: `${w} spent ${f1} of the money on a book, then ${f2} of the remainder on a pen, and had ${c} dollars left; ${rem} was left. How much at first?` }), [
      `After the book, 1 − 1/${d1} = ${d1 - 1}/${d1} of the money is left.`,
      `The pen takes 1/${d2} of that, so ${d2 - 1}/${d2} of ${d1 - 1}/${d1} = ${keepN}/${keepD} = ${kn}/${kd} of the money is left.`,
      `${kn}/${kd} of the money is ${money(c)}, so 1/${kd} is ${money(c)} ÷ ${kn} = ${money(c / kn)}, and the whole is ${money(c / kn)} × ${kd} = ${money(first)}.`,
      `So ${w} had ${first} dollars at first.`,
    ], 'Find what fraction of the whole is left, then work back from the money that is left.');
  }
  if (kind === 2) {
    const fs = shuffle([[2, 3], [3, 5], [5, 8], [7, 12], [4, 7], [5, 9], [3, 4], [7, 10], [4, 5], [5, 6], [7, 8], [9, 10], [11, 12]]).slice(0, 4), best = fs.reduce((a, b) => (b[0] * a[1] > a[0] * b[1] ? b : a));
    return explain(mcOnly('fractions', 'Which fraction is the largest?', `${best[0]}/${best[1]}`, fs.filter((f) => f !== best).map((f) => `${f[0]}/${f[1]}`)), [
      `Turn each fraction into a decimal: ${fs.map((f) => `${f[0]}/${f[1]} = ${(f[0] / f[1]).toFixed(2)}`).join(', ')}.`,
      `The biggest decimal is ${(best[0] / best[1]).toFixed(2)}.`,
      `So the largest fraction is ${best[0]}/${best[1]}.`,
    ], 'To compare fractions, turn them into decimals or give them the same denominator.');
  }
  const d = pick([3, 4, 5, 6, 8]), n = ri(1, d - 1), whole = d * ri(3, 12);
  return explain(int('fractions', `What is ${n}/${d} of ${whole}?`, (whole / d) * n), [
    `First find 1/${d} of ${whole}: ${whole} ÷ ${d} = ${whole / d}.`,
    `Then take ${n} of those parts: ${whole / d} × ${n} = ${(whole / d) * n}.`,
    `So ${n}/${d} of ${whole} is ${(whole / d) * n}.`,
  ], 'Divide by the bottom number, then multiply by the top number.');
};
const primes = () => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const lo = pick([10, 20, 30, 40, 50]), hi = lo + pick([10, 20]); let n = 0; const found = []; for (let k = lo + 1; k < hi; k++) if (isPrime(k)) { n++; found.push(k); }
    return explain(int('prime numbers', `How many prime numbers are there between ${lo} and ${hi}?`, n), [
      `Write the numbers from ${lo + 1} to ${hi - 1} and cross out the even ones, then the multiples of 3, 5 and 7.`,
      `The numbers left have no factors except 1 and themselves: ${found.join(', ')}.`,
      `Count them: ${n}.`,
      `So there are ${n} prime numbers between ${lo} and ${hi}.`,
    ], 'A prime has exactly two factors, 1 and itself. Cross out multiples of 2, 3, 5 and 7 to find the primes under 100.');
  }
  if (kind === 2) {
    const n = pick([36, 48, 60, 72, 84, 90, 100, 120]), fs = factorsOf(n), pairs = fs.filter((a) => a * a <= n).map((a) => [a, n / a]), sq = pairs.at(-1)[0] === pairs.at(-1)[1];
    return explain(int('factors', `How many factors does ${n} have (1 and ${n} included)?`, fs.length), [
      `Find the factors in pairs that multiply to ${n}: ${pairs.map(([a, b]) => `${a} × ${b}`).join(', ')}.`,
      `That is ${pairs.length} pairs${sq ? `, but ${pairs.at(-1)[0]} × ${pairs.at(-1)[0]} uses the same number twice, so it counts once` : ''}: ${fs.length} factors.`,
      `So ${n} has ${fs.length} factors.`,
    ], 'Find factors in pairs that multiply to the number, so none is missed.');
  }
  const n = pick([30, 42, 66, 70, 78, 84, 90, 105, 110]); const ps = factorsOf(n).filter(isPrime);
  return explain(int('prime factorisation', `What is the sum of the different prime factors of ${n}?`, sum(ps)), [
    `Break ${n} into primes, dividing by the smallest prime each time: ${n} = ${primeFactors(n).join(' × ')}.`,
    `The different primes are ${ps.join(', ')}.`,
    `${ps.join(' + ')} = ${sum(ps)}.`,
    `So the sum of the different prime factors of ${n} is ${sum(ps)}.`,
  ], 'Keep dividing by the smallest prime that fits until only primes are left.');
};
const average = () => {
  if (Math.random() < 0.5) {
    const xs = [ri(8, 30), ri(8, 30), ri(8, 30)], avg = ri(10, 28), fourth = 4 * avg - sum(xs); if (fourth < 1) return null;
    return explain(int('average', `The average of four numbers is ${avg}. Three of them are ${xs.join(', ')}. What is the fourth number?`, fourth), [
      `An average of ${avg} for 4 numbers means their total is ${avg} × 4 = ${4 * avg}.`,
      `The three known numbers add to ${xs.join(' + ')} = ${sum(xs)}.`,
      `${4 * avg} − ${sum(xs)} = ${fourth}.`,
      `So the fourth number is ${fourth}.`,
    ], 'Average × how many = the total.');
  }
  const n = ri(4, 6), avg = ri(10, 30), avg2 = avg - ri(1, 4), removed = n * avg - (n - 1) * avg2;
  return explain(int('average', `The average of ${n} numbers is ${avg}. When one number is taken away, the average of the rest is ${avg2}. What number was taken away?`, removed), [
    `Total of the ${n} numbers: ${avg} × ${n} = ${n * avg}.`,
    `Total of the ${n - 1} numbers left: ${avg2} × ${n - 1} = ${(n - 1) * avg2}.`,
    `The number taken away is the difference: ${n * avg} − ${(n - 1) * avg2} = ${removed}.`,
    `So the number taken away was ${removed}.`,
  ], 'Average × how many = the total. Compare the totals before and after.');
};
const ratioPercent = () => {
  const kind = ri(1, 3);
  if (kind === 1) {
    const p = pick([80, 120, 200, 240, 300]), off = pick([10, 25, 50]), cut = (p * off) / 100;
    return explain(int('percentage', `A bag costs ${money(p)}. In a sale its price is cut by ${off}%. What is the sale price (in dollars)?`, p - cut), [
      `${off}% is ${off === 10 ? 'one tenth' : off === 25 ? 'a quarter' : 'a half'}, so the cut is ${money(p)} ÷ ${100 / off} = ${money(cut)}.`,
      `${money(p)} − ${money(cut)} = ${money(p - cut)}.`,
      `So the sale price is ${p - cut} dollars.`,
    ], '10% is one tenth, 25% is a quarter, 50% is a half.');
  }
  if (kind === 2) {
    const a = ri(2, 5), b = ri(a + 1, 9), u = ri(3, 12), it = thing();
    return explain(int('ratio', `Two friends share ${(a + b) * u} ${it}s in the ratio ${a} : ${b}. How many does the one with more get?`, b * u), [
      `Ratio ${a} : ${b} means ${a} + ${b} = ${a + b} equal units altogether.`,
      `1 unit = ${(a + b) * u} ÷ ${a + b} = ${u}.`,
      `The one with more has ${b} units: ${b} × ${u} = ${b * u}.`,
      `So the one with more gets ${b * u} ${it}s.`,
    ], 'Add the ratio parts to find how many units, then find 1 unit.');
  }
  const total = pick([40, 60, 80, 120, 200]), pct = pick([15, 20, 25, 30, 35, 40, 45, 60, 75]);
  return explain(int('percentage', `${pct}% of the ${total} pupils in a school walk to school. How many pupils walk?`, (total * pct) / 100), [
    `${pct}% means ${pct} out of every 100.`,
    `${pct}% of ${total} = ${total} × ${pct} ÷ 100 = ${total * pct} ÷ 100 = ${(total * pct) / 100}.`,
    `So ${(total * pct) / 100} pupils walk.`,
  ], 'Percent means out of 100: multiply by the percentage, then divide by 100.');
};
const geometry = () => {
  const kind = ri(1, 4);
  if (kind === 1) {
    const r = pick([7, 14, 21]), area = (22 / 7) * r * r;
    return explain(int('area of a circle', `Taking π as 22/7, what is the area of a circle of radius ${r} cm, in cm²?`, area), [
      `Area of a circle = π × radius × radius = 22/7 × ${r} × ${r}.`,
      `Divide one ${r} by 7 first: ${r} ÷ 7 = ${r / 7}, so the area is 22 × ${r / 7} × ${r} = ${area}.`,
      `So the area is ${area} cm².`,
    ], 'With π as 22/7, divide one radius by 7 first to keep the numbers whole.');
  }
  if (kind === 2) {
    const a = ri(30, 80), b = ri(20, 180 - a - 20);
    return explain(int('angles in a triangle', `Two angles of a triangle are ${a}° and ${b}°. What is the third angle, in degrees?`, 180 - a - b), [
      'The three angles of a triangle add up to 180°.',
      `${a} + ${b} = ${a + b}, and 180 − ${a + b} = ${180 - a - b}.`,
      `So the third angle is ${180 - a - b} degrees.`,
    ], 'The angles of a triangle always add up to 180°.');
  }
  if (kind === 3) {
    const s = ri(3, 12);
    return explain(int('area and perimeter', `A square has an area of ${s * s} cm². What is its perimeter, in cm?`, 4 * s), [
      `Which number times itself makes ${s * s}? ${s} × ${s} = ${s * s}, so each side is ${s} cm.`,
      `The perimeter is 4 equal sides: 4 × ${s} = ${4 * s}.`,
      `So the perimeter is ${4 * s} cm.`,
    ], 'From the area of a square, find the side first: which number times itself gives the area?');
  }
  const l = ri(6, 20), w = ri(2, l - 1);
  return explain(int('area and perimeter', `A rectangle has a perimeter of ${2 * (l + w)} cm and a length of ${l} cm. What is its area, in cm²?`, l * w), [
    `Half the perimeter is one length + one width: ${2 * (l + w)} ÷ 2 = ${l + w}.`,
    `Width = ${l + w} − ${l} = ${w}.`,
    `Area = length × width = ${l} × ${w} = ${l * w}.`,
    `So the area is ${l * w} cm².`,
  ], 'Half the perimeter of a rectangle is one length plus one width.');
};
const probability = () => {
  const r = ri(1, 6), b = ri(1, 6), col = shuffle(COLOURS).slice(0, 2), g = gcd(r, r + b);
  return explain(frac('probability', `A bag holds ${r} ${col[0]} and ${b} ${col[1]} marbles. One marble is taken without looking. What is the probability that it is ${col[0]}? Give a fraction in its simplest form.`, r, r + b), [
    `Count all the marbles: ${r} + ${b} = ${r + b}.`,
    `${r} of the ${r + b} marbles are ${col[0]}, so the probability is ${r}/${r + b}.`,
    g > 1 ? `Divide the top and bottom by ${g}: ${r}/${r + b} = ${r / g}/${(r + b) / g}.` : `${r}/${r + b} is already in its simplest form.`,
    `So the probability is ${r / g}/${(r + b) / g}.`,
  ], 'Probability = the number of ways you want ÷ the number of ways there are.');
};
const chart = (y) => {
  const labels = shuffle(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).slice(0, 4).sort((a, b) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(a) - ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(b)), vals = labels.map(() => ri(2, band(y) === 3 ? 60 : 20) * (band(y) === 3 ? 5 : 1)), what = pick(['books borrowed', 'cakes sold', 'cans collected']);
  const f = bars(cap(what), null, labels.map((l, i) => [l, vals[i]])), kind = ri(1, 3), readBars = `Read the height of each bar: ${labels.map((l, i) => `${l} ${vals[i]}`).join(', ')}.`, READ = 'Read each bar against the scale and write its number down before you work anything out.';
  if (kind === 1) return explain(withFigure(int('charts', `The bar chart shows the ${what} on four days. How many were there altogether?`, sum(vals)), f), [
    readBars,
    `Add the four days: ${vals.join(' + ')} = ${sum(vals)}.`,
    `So there were ${sum(vals)} altogether.`,
  ], READ);
  const hi = vals.indexOf(Math.max(...vals)), lo = vals.indexOf(Math.min(...vals)); if (hi === lo) return null;
  if (kind === 2) return explain(withFigure(int('charts', `The bar chart shows the ${what} on four days. How many more on ${labels[hi]} than on ${labels[lo]}?`, vals[hi] - vals[lo]), f), [
    readBars,
    `${labels[hi]} has ${vals[hi]} and ${labels[lo]} has ${vals[lo]}.`,
    `${vals[hi]} − ${vals[lo]} = ${vals[hi] - vals[lo]}.`,
    `So there were ${vals[hi] - vals[lo]} more on ${labels[hi]} than on ${labels[lo]}.`,
  ], READ);
  if (vals.filter((v) => v === vals[lo]).length > 1) return null; // two days tied for the fewest would have two right answers: draw again
  return explain(withFigure(mcOnly('charts', `The bar chart shows the ${what} on four days. On which day were there the fewest?`, labels[lo], labels.filter((_, i) => i !== lo)), f), [
    readBars,
    `The shortest bar is ${labels[lo]}, with ${vals[lo]}.`,
    `So the fewest were on ${labels[lo]}.`,
  ], READ);
};

// ---- the paper's tiers (built 20 Sep 2026 from the source check): the real Paper A/B/C is Q1–10 at three marks, Q11–20 at four,
// Q21–25 at six and free response. The kinds below are the staples the 2018 papers and the official samples ask that the first
// build lacked; every kind above and below is tagged with the tiers it may fill, per paper. ----
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const chickenRabbit = (y) => {
  const b = band(y), [an1, an2, l1, l2] = pick([['chickens', 'rabbits', 2, 4], ['ducks', 'cows', 2, 4], ['ants', 'spiders', 6, 8], ['hens', 'goats', 2, 4]]), n1 = ri(b === 1 ? 2 : 5, b === 1 ? 10 : 40), n2 = ri(b === 1 ? 2 : 5, b === 1 ? 8 : 30), ask2 = Math.random() < 0.5;
  const H = n1 + n2, L = l1 * n1 + l2 * n2;
  return explain(int('chicken and rabbit', `A farm has ${H} ${an1} and ${an2} altogether, with ${L} legs in all. How many ${ask2 ? an2 : an1} are there?`, ask2 ? n2 : n1), [
    `Pretend all ${H} animals are ${an1}: ${H} × ${l1} = ${H * l1} legs.`,
    `But there are ${L} legs, so ${L} − ${H * l1} = ${L - H * l1} legs are extra.`,
    `Each ${sing(an2)} has ${l2 - l1} more legs than ${/^[aeiou]/.test(an1) ? 'an' : 'a'} ${sing(an1)}: ${L - H * l1} ÷ ${l2 - l1} = ${n2} ${an2}.`,
    ask2 ? `So there are ${n2} ${an2}.` : `The rest are ${an1}: ${H} − ${n2} = ${n1}.`,
    ask2 ? '' : `So there are ${n1} ${an1}.`,
  ], 'Start with the animal that has fewer legs, then count the extra legs.');
};
const digitCount = (y) => {
  const b = band(y), d = ri(1, 9), n = b === 1 ? ri(20, 40) : b === 2 ? pick([60, 80, 99, 100, 120, 150]) : pick([150, 173, 200, 250, 300]); let c = 0; for (let k = 1; k <= n; k++) c += digitsOf(k).filter((x) => x === d).length;
  let ones = 0, tens = 0, hundreds = 0; for (let k = 1; k <= n; k++) { if (k % 10 === d) ones++; if (Math.floor(k / 10) % 10 === d) tens++; if (Math.floor(k / 100) % 10 === d) hundreds++; }
  return explain(int('counting digits', `When the whole numbers from 1 to ${n} are written down, how many times does the digit ${d} appear?`, c), [
    `Count one place at a time. In the ones place: ${d}, ${d + 10}, ${d + 20}, … up to ${n}: ${ones} times.`,
    tens ? `In the tens place (${d * 10} to ${d * 10 + 9}${n >= 100 ? ', and again in every hundred' : ''}): ${tens} times.` : `In the tens place: none, because ${d * 10} is more than ${n}.`,
    hundreds ? `In the hundreds place (from ${d * 100}): ${hundreds} times.` : '',
    `${ones} + ${tens}${hundreds ? ` + ${hundreds}` : ''} = ${c}.`,
    `So the digit ${d} appears ${c} times.`,
  ], 'Count one place at a time: ones, then tens, then hundreds.');
};
const cycleTerm = (y) => {
  const b = band(y), len = ri(3, 5), cyc = Array.from({ length: len }, () => ri(0, 9)); if (new Set(cyc).size < 2) return null; const n = b === 1 ? ri(20, 60) : ri(50, 200), shown = [...cyc, ...cyc, ...cyc].slice(0, len * 2 + 1);
  const q = Math.floor(n / len), rest = n % len, ans = cyc[(n - 1) % len];
  return explain(int('repeating patterns', `${shown.join(', ')}, … The numbers repeat in the same order. What is the ${ord(n)} number in the pattern?`, ans), [
    `The numbers go round in groups of ${len}: ${cyc.join(', ')}.`,
    `${len} × ${q} = ${len * q}, so ${q} whole groups end at the ${ord(len * q)} number.`,
    rest === 0 ? `The ${ord(n)} number ends a group, so it is the last one in the group: ${cyc[len - 1]}.` : `Count on ${rest} more: the ${ord(n)} number is the ${ord(rest)} in a group, which is ${cyc[rest - 1]}.`,
    `So the ${ord(n)} number is ${ans}.`,
  ], 'Count in whole groups first; the leftover tells you where in the group you land.');
};
const cycleSum = (y) => {
  const b = band(y), len = ri(3, 5), cyc = Array.from({ length: len }, () => ri(1, 9)); if (new Set(cyc).size < 2) return null; const n = b === 1 ? ri(12, 30) : ri(30, 80), full = Math.floor(n / len), rest = n % len;
  const total = full * sum(cyc) + sum(cyc.slice(0, rest));
  return explain(int('repeating sums', `${[...cyc, ...cyc].join(', ')}, … The numbers repeat in the same order. What is the sum of the first ${n} numbers in the pattern?`, total), [
    `One group is ${cyc.join(' + ')} = ${sum(cyc)}.`,
    `${n} numbers make ${full} whole groups${rest ? ` and ${rest} more` : ''}: ${len} × ${full} = ${len * full}${rest ? `, + ${rest} = ${n}` : ''}.`,
    `${full} groups: ${full} × ${sum(cyc)} = ${full * sum(cyc)}.`,
    rest ? `The ${rest} extra number${rest > 1 ? 's are' : ' is'} ${cyc.slice(0, rest).join(', ')}, adding ${sum(cyc.slice(0, rest))}: ${full * sum(cyc)} + ${sum(cyc.slice(0, rest))} = ${total}.` : '',
    `So the sum of the first ${n} numbers is ${total}.`,
  ], 'Add one group, count the whole groups, then add the leftover numbers.');
};
const agesSum = (y) => {
  const b = band(y), ages = [ri(30, 60), ri(25, 40), ri(3, 12)], t = ri(2, b === 1 ? 6 : 15), S = sum(ages);
  return explain(int('ages', `A father is ${ages[0]}, a mother is ${ages[1]} and their child is ${ages[2]} years old. In how many years will their three ages add up to ${S + 3 * t}?`, t), [
    `Now the three ages add up to ${ages.join(' + ')} = ${S}.`,
    'Every year each of the 3 people gets 1 year older, so the total goes up by 3 each year.',
    `The total must grow by ${S + 3 * t} − ${S} = ${3 * t}.`,
    `${3 * t} ÷ 3 = ${t}.`,
    `So their ages will add up to ${S + 3 * t} in ${t} years.`,
  ], 'When everyone gets older, the total of the ages goes up by the number of people each year.');
};
const calendar = (y) => {
  const b = band(y), d = ri(0, 6), n = b === 1 ? pick([10, 20, 30, 50, 100]) : ri(60, 300), r = (d + n) % 7, q = Math.floor(n / 7), rest = n % 7;
  return explain(mcOnly('calendar', `Today is ${DAYS[d]}. What day of the week will it be ${n} days from today?`, DAYS[r], shuffle(DAYS.filter((_, i) => i !== r)).slice(0, 4)), [
    `Every 7 days it is ${DAYS[d]} again.`,
    `${n} ÷ 7 = ${q} weeks remainder ${rest}, so ${7 * q} days from today is ${DAYS[d]} again.`,
    rest === 0 ? `${n} days is exactly ${q} weeks, so the day is the same.` : `Count on ${rest} more day${rest > 1 ? 's' : ''} from ${DAYS[d]}: ${Array.from({ length: rest }, (_, i) => DAYS[(d + 1 + i) % 7]).join(', ')}.`,
    `So it will be ${DAYS[r]}.`,
  ], 'Take away whole weeks first, then count on the leftover days.');
};
const floorsInterval = (y) => {
  const b = band(y), per = ri(2, b === 1 ? 3 : 5), a = ri(3, 4), c = ri(a + 2, b === 1 ? 8 : 15);
  return explain(int('intervals', `It takes ${per * (a - 1)} minutes to walk up from the 1st floor to the ${ord(a)} floor of a building. At the same pace, how many minutes does it take to walk up from the 1st floor to the ${ord(c)} floor?`, per * (c - 1)), [
    `From the 1st floor to the ${ord(a)} floor is ${a} − 1 = ${a - 1} flights of stairs, not ${a}.`,
    `One flight takes ${per * (a - 1)} ÷ ${a - 1} = ${per} minutes.`,
    `From the 1st floor to the ${ord(c)} floor is ${c} − 1 = ${c - 1} flights: ${c - 1} × ${per} = ${per * (c - 1)}.`,
    `So it takes ${per * (c - 1)} minutes.`,
  ], 'Count the gaps between floors, not the floors: it is always one fewer.');
};
const stampPairs = (y) => {
  const b = band(y), [v1, v2] = pick([[12, 50], [10, 30], [20, 50], [5, 8], [15, 40]]), n1 = ri(1, b === 1 ? 2 : 3), n2 = ri(1, b === 1 ? 2 : 3), sums = new Set(), all = []; for (let i = 0; i <= n1; i++) for (let j = 0; j <= n2; j++) if (i + j > 0) { sums.add(i * v1 + j * v2); all.push(i * v1 + j * v2); }
  const only1 = Array.from({ length: n1 }, (_, i) => `${(i + 1) * v1}¢`), only2 = Array.from({ length: n2 }, (_, j) => `${(j + 1) * v2}¢`), both = []; for (let i = 1; i <= n1; i++) for (let j = 1; j <= n2; j++) both.push(`${i * v1 + j * v2}¢`);
  const dups = [...new Set(all.filter((v, i) => all.indexOf(v) !== i))];
  return explain(int('systematic listing', `${names(1)[0]} has ${n1} stamp${n1 > 1 ? 's' : ''} worth ${v1}¢ each and ${n2} stamp${n2 > 1 ? 's' : ''} worth ${v2}¢ each. Using one or more of the stamps, how many different amounts of postage can be made?`, sums.size), [
    `List the amounts in order. Only ${v1}¢ stamps: ${only1.join(', ')}.`,
    `Only ${v2}¢ stamps: ${only2.join(', ')}.`,
    `Both kinds together: ${both.join(', ')}.`,
    dups.length ? `Some amounts appear twice (${dups.map((v) => `${v}¢`).join(', ')}), so count each only once.` : 'Every amount is different.',
    `Different amounts: ${sums.size}.`,
    `So ${sums.size} different amounts of postage can be made.`,
  ], 'List every combination in order so none is missed and none is counted twice.');
};
const pyramidSum = (y) => {
  const n = band(y) === 1 ? ri(5, 10) : ri(10, 30);
  return explain(int('pyramid sum', `1 + 2 + 3 + … + ${n} + … + 3 + 2 + 1 = ?`, n * n), [
    'Try small ones: 1 + 2 + 1 = 4, 1 + 2 + 3 + 2 + 1 = 9. The answer is always the middle number times itself.',
    `Here the middle number is ${n}: ${n} × ${n} = ${n * n}.`,
    `Check: going up, 1 + 2 + … + ${n} = ${tri(n)}; coming down, ${n - 1} + … + 1 = ${tri(n) - n}; and ${tri(n)} + ${tri(n) - n} = ${n * n}.`,
    `So 1 + 2 + 3 + … + ${n} + … + 3 + 2 + 1 = ${n * n}.`,
  ], 'A pyramid sum is the middle number times itself.');
};
// Paper B up
// each rule of the family: its sign, the rule, the rule in a child's words, and the rule written out with two numbers in it
const OPS = [['◐', (a, b) => 2 * a + b, 'double the first number, then add the second', (a, b) => `2 × ${a} + ${b}`], ['◑', (a, b) => a * b + a, 'multiply the two numbers, then add the first number', (a, b) => `${a} × ${b} + ${a}`], ['◒', (a, b) => a + 2 * b, 'add the first number to double the second', (a, b) => `${a} + 2 × ${b}`], ['◓', (a, b) => a * b - 1, 'multiply the two numbers, then take away 1', (a, b) => `${a} × ${b} − 1`], ['⊚', (a, b) => 5 * a - 3 * b, '5 times the first number, take away 3 times the second', (a, b) => `5 × ${a} − 3 × ${b}`], ['⊛', (a, b) => a * a + b, 'multiply the first number by itself, then add the second', (a, b) => `${a} × ${a} + ${b}`], ['⊙', (a, b) => a * b - a - b, 'multiply the two numbers, then take away both numbers', (a, b) => `${a} × ${b} − ${a} − ${b}`]];
const definedOp = () => {
  const [sym, f, words, show] = pick(OPS), ex = Array.from({ length: 3 }, () => [ri(2, 9), ri(2, 9)]), a = ri(10, 15), b = ri(2, 9), v = f(a, b);
  if (v < 0 || ex.some(([p, q]) => f(p, q) < 0) || new Set(ex.map(String)).size < 3) return null;
  if (OPS.some(([, g]) => g !== f && ex.every(([p, q]) => g(p, q) === f(p, q)))) return null; // the three examples must fit one rule of the family only
  return explain(int('defining new operations', `${ex.map(([p, q]) => `${p} ${sym} ${q} = ${f(p, q)}`).join(', ')}. Following the same rule, what is ${a} ${sym} ${b}?`, v), [
    `Look for the rule in the first example: ${ex[0][0]} ${sym} ${ex[0][1]} = ${show(ex[0][0], ex[0][1])} = ${f(ex[0][0], ex[0][1])}. The rule: ${words}.`,
    `Check it on the others: ${show(ex[1][0], ex[1][1])} = ${f(ex[1][0], ex[1][1])} and ${show(ex[2][0], ex[2][1])} = ${f(ex[2][0], ex[2][1])}. It fits.`,
    `Use the rule: ${a} ${sym} ${b} = ${show(a, b)} = ${v}.`,
    `So ${a} ${sym} ${b} = ${v}.`,
  ], 'Guess a rule from the first example, then check it fits every example before you use it.');
};
const excessDeficiency = () => {
  const n = ri(5, 20), a = ri(2, 8), k = ri(1, 3), left = ri(1, 9), short = k * n - left; if (short < 1) return null; const askTotal = Math.random() < 0.4;
  return explain(int('excess and deficiency', `Some sweets are shared among a group of children. If each child gets ${a}, ${left} sweets are left over. If each child gets ${a + k}, ${short} sweets are short. How many ${askTotal ? 'sweets' : 'children'} are there?`, askTotal ? a * n + left : n), [
    `Giving each child ${a + k} instead of ${a} is ${k} more each.`,
    `That uses up the ${left} left over and needs ${short} more: ${left} + ${short} = ${left + short} extra sweets in all.`,
    `Each child takes ${k} of the extra: ${left + short} ÷ ${k} = ${n} children.`,
    askTotal ? `Sweets: ${n} children × ${a} each + ${left} left over = ${a * n} + ${left} = ${a * n + left}.` : '',
    askTotal ? `So there are ${a * n + left} sweets.` : `So there are ${n} children.`,
  ], 'Compare the two ways of sharing: the difference in sweets is spread evenly over the children.');
};
const fencepost = (y) => {
  const gap = pick([4, 5, 6, 8, 10, 12, 15, 16, 20, 25]), n = band(y) === 2 ? ri(8, 60) : ri(20, 100);
  if (ri(1, 2) === 1) return explain(int('intervals', `Trees are planted along one side of a ${gap * n} m road, ${gap} m apart, with a tree at each end. How many trees are there?`, n + 1), [
    `Count the gaps: ${gap * n} ÷ ${gap} = ${n} gaps.`,
    `With a tree at each end there is 1 more tree than gaps: ${n} + 1 = ${n + 1}.`,
    `So there are ${n + 1} trees.`,
  ], 'With a tree at both ends, trees = gaps + 1.');
  return explain(int('intervals', `${n + 1} lamp posts stand in a line along a road, ${gap} m apart. How far is it from the first lamp post to the last, in metres?`, gap * n), [
    `${n + 1} lamp posts in a line have ${n + 1} − 1 = ${n} gaps between them.`,
    `${n} gaps × ${gap} m = ${gap * n} m.`,
    `So it is ${gap * n} metres from the first lamp post to the last.`,
  ], 'Posts in a line have one gap fewer than posts.');
};
const clockAngle = () => {
  const h = ri(1, 12), m = pick([0, 10, 20, 30, 40, 50]), a = Math.abs(30 * (h % 12) - 5.5 * m), v = Math.min(a, 360 - a); if (v === 0) return null;
  const minuteAt = 6 * m, hourAt = 30 * (h % 12) + m / 2;
  return explain(int('clock angles', `What is the smaller angle between the hour hand and the minute hand of a clock at ${h}:${String(m).padStart(2, '0')}, in degrees?`, v), [
    `The minute hand moves 6° a minute: at ${m} minutes it is ${6} × ${m} = ${minuteAt}° from the 12.`,
    `The hour hand moves 30° an hour and half a degree a minute: ${30} × ${h % 12} + ${m} ÷ 2 = ${hourAt}° from the 12.`,
    `The angle between them: ${Math.max(minuteAt, hourAt)} − ${Math.min(minuteAt, hourAt)} = ${a}°.`,
    a > 180 ? `That is the long way round, so the smaller angle is 360 − ${a} = ${v}°.` : '',
    `So the smaller angle is ${v} degrees.`,
  ], 'The hour hand moves too: half a degree every minute.');
};
const catchUp = () => {
  const v1 = pick([40, 50, 60, 70, 80]), gain = pick([10, 15, 20, 25]), head = ri(1, 3), t = (v1 * head) / gain; if (!Number.isInteger(t)) return null;
  return explain(int('catching up', `A train leaves a station at ${v1} km/h. ${head === 1 ? 'One hour' : `${head} hours`} later a second train leaves the same station along the same line at ${v1 + gain} km/h. How many hours after it leaves does the second train catch the first?`, t), [
    `In ${head} hour${head > 1 ? 's' : ''} the first train gets ${v1} × ${head} = ${v1 * head} km ahead.`,
    `Every hour the second train closes the gap by ${v1 + gain} − ${v1} = ${gain} km.`,
    `${v1 * head} ÷ ${gain} = ${t}.`,
    `So the second train catches the first ${t} hours after it leaves.`,
  ], 'Catching up: the head start ÷ the difference in speeds.');
};
const meetOffset = () => {
  const v1 = pick([60, 70, 80, 90, 100]), v2 = v1 - pick([10, 20, 30, 40]), off = pick([5, 10, 15, 20, 30]), t = (2 * off) / (v1 - v2); if (!Number.isInteger(t)) return null; const who = names(2);
  return explain(int('meeting', `${who.join(' and ')} start walking toward each other at the same time from the two ends of a path, at ${v1} m/min and ${v2} m/min. They meet ${off} m from the midpoint of the path. How long is the path, in metres?`, (v1 + v2) * t), [
    `The faster walker (${v1} m/min) goes ${off} m past the midpoint and the slower one stops ${off} m short of it, so the faster one walks ${off} + ${off} = ${2 * off} m more.`,
    `Every minute the faster walker gains ${v1} − ${v2} = ${v1 - v2} m, so they walk for ${2 * off} ÷ ${v1 - v2} = ${t} minutes.`,
    `Together they cover ${v1} + ${v2} = ${v1 + v2} m every minute: ${v1 + v2} × ${t} = ${(v1 + v2) * t}.`,
    `So the path is ${(v1 + v2) * t} metres long.`,
  ], 'Meeting away from the midpoint: the difference in the distances walked is twice the offset.');
};
const cryptarithm = () => {
  if (Math.random() < 0.5) {
    const s = ri(5, 17);
    return explain(int('cryptarithm', `In the addition AB + BA = ${11 * s}, A and B stand for two different digits. What is A + B?`, s), [
      'Add the ones: B + A. Add the tens: A + B. So AB + BA is (A + B) tens and (A + B) ones, which is 11 × (A + B).',
      `11 × (A + B) = ${11 * s}, so A + B = ${11 * s} ÷ 11 = ${s}.`,
      `So A + B = ${s}.`,
    ], 'AB + BA is always 11 times the sum of the two digits.');
  }
  const d = ri(1, 8);
  return explain(int('cryptarithm', `In the subtraction AB − BA = ${9 * d}, A and B stand for digits. What is A − B?`, d), [
    'AB is 10 × A + B and BA is 10 × B + A. Taking away: 10 × A + B − 10 × B − A = 9 × A − 9 × B = 9 × (A − B).',
    `9 × (A − B) = ${9 * d}, so A − B = ${9 * d} ÷ 9 = ${d}.`,
    `So A − B = ${d}.`,
  ], 'AB − BA is always 9 times the difference of the two digits.');
};
const compositePerimeter = () => {
  const L = ri(8, 20), W = ri(5, L - 1), l = ri(2, L - 3), w = ri(2, W - 3);
  return explain(int('perimeter', `An L-shaped figure is made by cutting a ${l} cm by ${w} cm rectangle from one corner of a ${L} cm by ${W} cm rectangle. What is the perimeter of the L-shaped figure, in cm?`, 2 * (L + W)), [
    `Slide the two cut edges out to the corner: the ${l} cm edge and the ${w} cm edge fill the gaps, so the outline is as long as the whole ${L} by ${W} rectangle.`,
    `Perimeter = 2 × (${L} + ${W}) = 2 × ${L + W} = ${2 * (L + W)}.`,
    `So the perimeter is ${2 * (L + W)} cm.`,
  ], 'Cutting a rectangle out of a corner does not change the perimeter.');
};
const worstCaseColours = (y) => {
  const cs = shuffle(COLOURS).slice(0, band(y) === 2 ? 3 : 4), counts = cs.map(() => ri(5, 40)); if (new Set(counts).size < counts.length) return null; const bag = cs.map((c, i) => `${counts[i]} ${c}`).join(', ').replace(/, (\d+ \w+)$/, ' and $1');
  if (ri(1, 2) === 1) {
    const least = counts.indexOf(Math.min(...counts)), rest = sum(counts) - counts[least];
    return explain(int('worst case', `A box has ${bag} balls. Without looking, what is the smallest number of balls you must take out to be sure of having at least one ball of every colour?`, rest + 1), [
      `Think of the worst luck: the colour with the fewest balls, ${cs[least]} (${counts[least]}), comes out last.`,
      `First every ball of the other colours: ${cs.map((c, i) => (i === least ? null : counts[i])).filter(Boolean).join(' + ')} = ${rest}.`,
      `The next ball must be ${cs[least]}: ${rest} + 1 = ${rest + 1}.`,
      `So you must take out ${rest + 1} balls.`,
    ], 'Imagine the worst luck first, then add 1.');
  }
  const k = ri(3, 6);
  return explain(int('worst case', `A box has ${bag} balls. Without looking, what is the smallest number of balls you must take out to be sure of ${k} balls of the same colour?`, cs.length * (k - 1) + 1), [
    `Think of the worst luck: you could take ${k - 1} of every colour and still have no ${k} the same.`,
    `${cs.length} colours × ${k - 1} = ${cs.length * (k - 1)} balls.`,
    `The next ball makes ${k} of some colour: ${cs.length * (k - 1)} + 1 = ${cs.length * (k - 1) + 1}.`,
    `So you must take out ${cs.length * (k - 1) + 1} balls.`,
  ], 'Imagine the worst luck first, then add 1.');
};
const penaltyScore = () => {
  const n = pick([10, 15, 20, 25]), plus = pick([4, 5, 8, 10]), minus = pick([1, 2, 3, 4]), right = ri(Math.ceil(n / 2), n - 1), score = plus * right - minus * (n - right), [w] = names(1);
  return explain(int('assumption method', `A quiz has ${n} questions. Each right answer scores ${plus} points and each wrong answer loses ${minus} points. ${w} answered every question and scored ${score}. How many answers were wrong?`, n - right), [
    `Pretend all ${n} answers were right: ${n} × ${plus} = ${n * plus} points.`,
    `The real score is ${score}, so ${n * plus} − ${score} = ${n * plus - score} points went missing.`,
    `Each wrong answer loses its ${plus} points and another ${minus}: ${plus} + ${minus} = ${plus + minus} points missing per wrong answer.`,
    `${n * plus - score} ÷ ${plus + minus} = ${n - right}.`,
    `So ${n - right} answers were wrong.`,
  ], 'Pretend every answer was right, then see how many points went missing.');
};
const divisionRemainder = () => {
  const q = ri(12, 40), r = ri(1, 20), d = ri(r + 1, 45);
  return explain(int('division with remainder', `${d * q + r} ÷ □ = ${q} remainder ${r}. What number goes in the box?`, d), [
    `Take the remainder off first: ${d * q + r} − ${r} = ${d * q}. That divides exactly.`,
    `${d * q} shared into ${q} equal parts: ${d * q} ÷ ${q} = ${d}.`,
    `Check: ${d} × ${q} + ${r} = ${d * q + r}.`,
    `So the number in the box is ${d}.`,
  ], 'Take the remainder off first, then divide.');
};
// Paper C up
const CYC = { 2: [2, 4, 8, 6], 3: [3, 9, 7, 1], 4: [4, 6], 7: [7, 9, 3, 1], 8: [8, 4, 2, 6], 9: [9, 1] };
const lastDigit = (base, n) => CYC[base][(n - 1) % CYC[base].length];
const unitDigitSum = () => {
  const a = pick([2, 3, 4, 7, 8, 9]), b = pick([2, 3, 4, 7, 8, 9]), m = ri(11, 99), n = ri(11, 99); if (a === b) return null; const la = lastDigit(a, m), lb = lastDigit(b, n);
  return explain(int('ones digit of a sum', `What is the ones digit of ${a}^${m} + ${b}^${n} (${a} to the power ${m}, plus ${b} to the power ${n})?`, (la + lb) % 10), [
    cycleLine(a, m),
    cycleLine(b, n),
    `Add the two ones digits: ${la} + ${lb} = ${la + lb}, whose ones digit is ${(la + lb) % 10}.`,
    `So the ones digit is ${(la + lb) % 10}.`,
  ], 'Ones digits of powers go round in a short cycle: divide the power by the cycle length and use the remainder.');
};
const telescoping = () => {
  const n = ri(4, 20);
  return explain(frac('telescoping sums', `What is 1/(1×2) + 1/(2×3) + 1/(3×4) + … + 1/(${n}×${n + 1})? Give a fraction in its simplest form.`, n, n + 1), [
    'Split each fraction into two: 1/(1×2) = 1 − 1/2, 1/(2×3) = 1/2 − 1/3, 1/(3×4) = 1/3 − 1/4, and so on.',
    `Add them up and the middle parts cancel: 1 − 1/2 + 1/2 − 1/3 + 1/3 − … − 1/${n + 1}.`,
    `Only the two ends are left: 1 − 1/${n + 1} = ${n}/${n + 1}.`,
    `So the sum is ${n}/${n + 1}.`,
  ], 'Split each fraction into a difference of two unit fractions; everything in the middle cancels out.');
};
const pathsVia = () => {
  const R = pick([4, 5]), C = pick([4, 5, 6]), r1 = ri(1, R - 2), c1 = ri(1, C - 2), toP = choose(r1 + c1, r1), fromP = choose(R - 1 - r1 + (C - 1 - c1), R - 1 - r1);
  return explain(withFigure(int('routes through a point', `The grid has ${R} rows and ${C} columns of squares. Moving only right or down from one square to the next, how many different shortest routes from square A to square B pass through square P?`, toP * fromP), grid('A to B through P', R, C, { '0,0': 'A', [`${r1},${c1}`]: 'P', [`${R - 1},${C - 1}`]: 'B' })), [
    'Every route through P is a route from A to P followed by a route from P to B, so count the two parts and multiply.',
    'Number the squares: each square is the square above plus the square to its left (1 along the top and the left).',
    `From A to P the numbers are ${pascalText(r1 + 1, c1 + 1)}, so A to P has ${toP} routes.`,
    `Number again from P: ${pascalText(R - r1, C - c1)}, so P to B has ${fromP} routes.`,
    `${toP} × ${fromP} = ${toP * fromP}.`,
    `So ${toP * fromP} shortest routes pass through P.`,
  ], 'Break the trip at the square you must pass through, then multiply the two counts.');
};
const coprimePairs = () => {
  const ps = shuffle([2, 3, 5, 7, 11, 13]).slice(0, ri(2, 4)), n = ps.reduce((a, b) => a * b, 1) * pick([1, 1, 2, 3]); if (n > 5000) return null; const k = factorsOf(n).filter(isPrime).length;
  return explain(int('coprime pairs', `How many different proper fractions in their simplest form have a numerator and a denominator whose product is ${n}?`, 2 ** (k - 1)), [
    `Break ${n} into primes: ${n} = ${primeFactors(n).join(' × ')}. There are ${k} different primes.`,
    'In a fraction in its simplest form the top and bottom share no prime, so each prime (with all its copies) goes wholly to the top or wholly to the bottom.',
    `${k} primes, 2 choices each: ${Array(k).fill(2).join(' × ')} = ${2 ** k} ways to split ${n} into top × bottom.`,
    `In half of them the top is smaller than the bottom, which makes a proper fraction: ${2 ** k} ÷ 2 = ${2 ** (k - 1)}.`,
    `So there are ${2 ** (k - 1)} such fractions.`,
  ], 'In a simplest-form fraction, each prime of the product belongs entirely to the top or to the bottom.');
};
const drawTwo = () => {
  const a = ri(2, 4), b = ri(2, 4), [c1, c2] = pick([['20¢', '$1'], ['10¢', '50¢'], ['5¢', '20¢']]), tot = choose(a + b, 2), pairsLine = `Count the pairs of coins: ${a + b} coins, so ${a + b} × ${a + b - 1} ÷ 2 = ${tot} different pairs.`;
  if (ri(1, 2) === 1) {
    const g = gcd(a * b, tot);
    return explain(frac('two draws', `A purse holds ${a} ${c1} coins and ${b} ${c2} coins. Two coins are taken out without looking. What is the probability that they are one of each kind? Give a fraction in its simplest form.`, a * b, tot), [
      pairsLine,
      `Pairs with one of each kind: any of the ${a} ${c1} coins with any of the ${b} ${c2} coins, ${a} × ${b} = ${a * b}.`,
      `Probability = ${a * b}/${tot}${g > 1 ? ` = ${(a * b) / g}/${tot / g} in its simplest form` : ''}.`,
      `So the probability is ${(a * b) / g}/${tot / g}.`,
    ], 'Count all the pairs first, then the pairs you want.');
  }
  const want = (b * (b - 1)) / 2, g = gcd(want, tot);
  return explain(frac('two draws', `A purse holds ${a} ${c1} coins and ${b} ${c2} coins. Two coins are taken out without looking. What is the probability that both are ${c2} coins? Give a fraction in its simplest form.`, want, tot), [
    pairsLine,
    `Pairs of two ${c2} coins: ${b} × ${b - 1} ÷ 2 = ${want}.`,
    `Probability = ${want}/${tot}${g > 1 ? ` = ${want / g}/${tot / g} in its simplest form` : ''}.`,
    `So the probability is ${want / g}/${tot / g}.`,
  ], 'Count all the pairs first, then the pairs you want.');
};
const isosceles = () => {
  if (ri(1, 2) === 1) {
    const base = ri(20, 80);
    return explain(int('angles', `Triangle ABC has AB = AC and angle ABC = ${base}°. What is angle BAC, in degrees?`, 180 - 2 * base), [
      `AB = AC, so the two angles at the base are equal: angle ACB = angle ABC = ${base}°.`,
      `The three angles add up to 180°: 180 − ${base} − ${base} = ${180 - 2 * base}.`,
      `So angle BAC is ${180 - 2 * base} degrees.`,
    ], 'In an isosceles triangle the two angles at the base are equal.');
  }
  const apex = ri(10, 60) * 2;
  return explain(int('angles', `Triangle ABC has AB = AC and angle BAC = ${apex}°. What is angle ABC, in degrees?`, (180 - apex) / 2), [
    `The three angles add up to 180°, so the two base angles share 180 − ${apex} = ${180 - apex}°.`,
    `AB = AC, so the two base angles are equal: ${180 - apex} ÷ 2 = ${(180 - apex) / 2}.`,
    `So angle ABC is ${(180 - apex) / 2} degrees.`,
  ], 'In an isosceles triangle the two angles at the base are equal.');
};
const mixture = () => {
  const a = pick([100, 200, 300, 400]), b = pick([100, 200, 300, 600]), p = ri(10, 40), q = ri(10, 60), v = (a * p + b * q) / (a + b); if (!Number.isInteger(v) || p === q) return null; const s1 = (a * p) / 100, s2 = (b * q) / 100;
  return explain(int('mixtures', `${a} mL of a ${p}% sugar solution is mixed with ${b} mL of a ${q}% sugar solution. What percentage of the mixture is sugar?`, v), [
    `Sugar in the first: ${p}% of ${a} mL = ${a} × ${p} ÷ 100 = ${s1} mL.`,
    `Sugar in the second: ${q}% of ${b} mL = ${b} × ${q} ÷ 100 = ${s2} mL.`,
    `Altogether ${s1} + ${s2} = ${s1 + s2} mL of sugar in ${a} + ${b} = ${a + b} mL of mixture.`,
    `${s1 + s2} ÷ ${a + b} × 100 = ${v}.`,
    `So the mixture is ${v}% sugar.`,
  ], 'Find the real amount of sugar in each, add them, then compare with the total amount.');
};
const truthChests = () => {
  const boxes = ['A', 'B', 'C'];
  const labels = boxes.map((x) => { const k = ri(1, 3); if (k === 1) return { t: `The gold is in box ${x}.`, ok: (g) => g === x }; if (k === 2) return { t: `The gold is not in box ${x}.`, ok: (g) => g !== x }; const o = pick(boxes.filter((z) => z !== x)); return { t: `The gold is not in box ${o}.`, ok: (g) => g !== o }; });
  const fits = boxes.filter((g) => labels.filter((l) => l.ok(g)).length === 1); if (fits.length !== 1) return null;
  return explain(mcOnly('truth and lies', `Gold is hidden in one of three boxes. The label on box A says: "${labels[0].t}" The label on box B says: "${labels[1].t}" The label on box C says: "${labels[2].t}" Exactly one label is true. Which box holds the gold?`, `Box ${fits[0]}`, [...boxes.filter((x) => x !== fits[0]).map((x) => `Box ${x}`), 'Cannot be told']), [
    'Try each box in turn and count how many labels would be true.',
    ...boxes.map((g) => `Gold in box ${g}: ${boxes.map((x, i) => `label ${x} ${labels[i].ok(g) ? 'true' : 'false'}`).join(', ')} → ${labels.filter((l) => l.ok(g)).length} true.`),
    `Only box ${fits[0]} gives exactly 1 true label.`,
    `So the gold is in Box ${fits[0]}.`,
  ], 'Test each possibility in turn and count the true statements.');
};

const T = (cat, gen, ...sections) => ({ cat, gen, sections });
const POOL_A = [T('working backwards', workBack, 'M3', 'M4'), T('number patterns', pattern, 'M3'), T('sum of a sequence', seqSum, 'M3', 'M4'), T('pigeonhole', pigeonhole, 'M4', 'M6'), T('queuing', queue, 'M3', 'M4'), T('odd and even', oddEven, 'M3'), T('time', time, 'M3'), T('counting figures', squares, 'M4', 'M6'), T('shortest path', shortestPath, 'M4', 'M6'), T('logic', logic, 'M3', 'M4'), T('simple speed', speed, 'M3'), T('addition and subtraction', addSub, 'M3'),
  T('chicken and rabbit', chickenRabbit, 'M4', 'M6'), T('counting digits', digitCount, 'M4', 'M6'), T('repeating patterns', cycleTerm, 'M4'), T('repeating sums', cycleSum, 'M6'), T('ages', agesSum, 'M6'), T('calendar', calendar, 'M4'), T('intervals', floorsInterval, 'M3', 'M4'), T('systematic listing', stampPairs, 'M6'), T('pyramid sum', pyramidSum, 'M4', 'M6')];
const POOL_B = [T('working backwards', workBack, 'M3', 'M4'), T('number patterns', pattern, 'M3'), T('sum of a sequence', seqSum, 'M3'), T('pigeonhole', pigeonhole, 'M4'), T('queuing', queue, 'M3'), T('odd and even', oddEven, 'M3'), T('time', time, 'M3'), T('counting figures', squares, 'M4'), T('shortest path', shortestPath, 'M4', 'M6'), T('logic', logic, 'M4', 'M6'), T('simple speed', speed, 'M3'), T('addition and subtraction', addSub, 'M3'), T('number puzzle', digits, 'M4'), T('handshakes', handshakes, 'M3', 'M4'), T('remainders', remainder, 'M4'), T('charts', chart, 'M3'),
  T('chicken and rabbit', chickenRabbit, 'M3', 'M4'), T('counting digits', digitCount, 'M4', 'M6'), T('repeating patterns', cycleTerm, 'M3'), T('repeating sums', cycleSum, 'M4'), T('ages', agesSum, 'M4'), T('calendar', calendar, 'M3'), T('intervals', fencepost, 'M3', 'M4'), T('floors', floorsInterval, 'M3'), T('systematic listing', stampPairs, 'M4'), T('pyramid sum', pyramidSum, 'M3'),
  T('defining new operations', definedOp, 'M4', 'M6'), T('excess and deficiency', excessDeficiency, 'M6'), T('clock angles', clockAngle, 'M6'), T('catching up', catchUp, 'M6'), T('meeting', meetOffset, 'M6'), T('cryptarithm', cryptarithm, 'M4', 'M6'), T('perimeter', compositePerimeter, 'M4'), T('worst case', worstCaseColours, 'M6'), T('assumption method', penaltyScore, 'M4', 'M6'), T('division with remainder', divisionRemainder, 'M4')];
const POOL_C = [T('working backwards', workBack, 'M3'), T('number patterns', pattern, 'M3'), T('sum of a sequence', seqSum, 'M3'), T('pigeonhole', pigeonhole, 'M3', 'M4'), T('queuing', queue, 'M3'), T('odd and even', oddEven, 'M3'), T('time', time, 'M3'), T('counting figures', squares, 'M4'), T('shortest path', shortestPath, 'M4'), T('logic', logic, 'M3', 'M4'), T('speed', speed, 'M3', 'M4'), T('handshakes', handshakes, 'M3'), T('remainders', remainder, 'M3', 'M4'), T('new operations', newOp, 'M4', 'M6'), T('fractions', fractions, 'M3', 'M4'), T('primes and factors', primes, 'M3', 'M4'), T('average', average, 'M4'), T('ratio and percentage', ratioPercent, 'M3'), T('geometry', geometry, 'M3'), T('probability', probability, 'M4'), T('charts', chart, 'M3'),
  T('defining new operations', definedOp, 'M3'), T('excess and deficiency', excessDeficiency, 'M4'), T('clock angles', clockAngle, 'M4', 'M6'), T('catching up', catchUp, 'M4', 'M6'), T('meeting', meetOffset, 'M6'), T('cryptarithm', cryptarithm, 'M3', 'M4'), T('worst case', worstCaseColours, 'M4', 'M6'), T('assumption method', penaltyScore, 'M3'), T('counting digits', digitCount, 'M4'),
  T('ones digit of a sum', unitDigitSum, 'M4', 'M6'), T('telescoping sums', telescoping, 'M6'), T('routes through a point', pathsVia, 'M6'), T('coprime pairs', coprimePairs, 'M6'), T('two draws', drawTwo, 'M6'), T('angles', isosceles, 'M4'), T('mixtures', mixture, 'M4', 'M6'), T('truth and lies', truthChests, 'M4')];
const pool = (y) => (band(y) === 1 ? POOL_A : band(y) === 2 ? POOL_B : POOL_C);
// the real paper (seamo-official.org guidelines): 25 questions in 90 minutes — Section A ten 3-mark and Section B ten 4-mark
// multiple choice of five options with "None of the above", then Section C five 6-mark free-response answers, typed. The 90
// minutes are ours to split: 25 + 35 + 30 (the owner, 20 Sep 2026: the format and the number of questions follow the paper)
export const PHASES = [phase('alpha', 'Section A', 3, 25, slots([['M3', 'mc', 10]])), phase('beta', 'Section B', 4, 35, slots([['M4', 'mc', 10]])), phase('gamma', 'Section C', 6, 30, slots([['M6', 'sa', 5]]))];
export const build = (shape, year) => buildHeat(shape, pool(year), year, { options: 5, none: true }); // five options with "None of the above" on every paper, as the real ones
export const TOPICS = [
  { band: 'Paper A · Years 1–2', lines: ['3 marks: working backwards, patterns, sums, queues, time, odd and even', '4 marks: chicken and rabbit, counting digits, repeating patterns, calendars, floors', '6 marks, typed: ages, stamps, pyramid sums, pigeonholes, routes on a grid', 'five options, one of them “None of the above”'] },
  { band: 'Paper B · Years 3–4', lines: ['3 marks: Paper A with bigger numbers, trees along a road, bar charts', '4 marks: defined operations, cryptarithms, quiz scores, division with a remainder', '6 marks, typed: excess and deficiency, clock angles, catching up and meeting, worst cases', 'five options, one of them “None of the above”'] },
  { band: 'Paper C · Years 5–6', lines: ['3 marks: fractions, primes, percentages, angles, defined operations', '4 marks: averages, probability, mixtures, isosceles angles, truth and lies', '6 marks, typed: the ones digit of a sum of powers, telescoping sums, routes through a point', 'coprime pairs, two draws from a purse, catching up, meeting off the midpoint'] },
];
