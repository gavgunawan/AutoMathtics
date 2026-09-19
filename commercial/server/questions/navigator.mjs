// 🧭 NAVIGATOR — Engine's own numbers, dressed in words (the owner's redraw of 19 Sep 2026: "navigator simply reflects
// engine level, with words like real life situations"). Every question here starts as an Engine question of the same
// sector and tier — the same addition with the same carries, the same fraction with the same denominators — and is then
// told as something that happens: shells on a beach, chairs in a hall, a jug of juice. So Navigator is never harder than
// Engine on the numbers, and only the reading is added; fractions arrive in Sector E, as they do in Engine, and a
// Sector B child meets none. One question in three is a piece of simple logic instead: four amounts of the sector, and
// which is the biggest, the smallest, the second biggest or the second smallest — always four options. The Singapore-
// standard track that used to be Navigator lives on in singapore.mjs, as the core of Olympia's SG-Moon.
// A question: { display: { layout: 'word', text, choices? }, answer: { type: 'int'|'frac'|'choice', ... }, read }
import { genEngine, LEVELS } from './engine.mjs';

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = (n) => n.toLocaleString('en-US');
// short lists, easy to grow: the names are the children's own region's first, with a few from the old track kept
const NAMES = ['Ayu', 'Budi', 'Citra', 'Dewi', 'Eko', 'Farah', 'Gita', 'Hadi', 'Intan', 'Joko', 'Kiki', 'Lina', 'Nia', 'Omar', 'Putri', 'Rafi', 'Sari', 'Tono', 'Wati', 'Yusuf', 'Zara', 'Mei', 'Ben', 'Aisha', 'Ravi'];
const names = (n) => shuffle(NAMES).slice(0, n);
const THINGS = ['stickers', 'marbles', 'shells', 'beads', 'stamps', 'cards', 'buttons', 'coins', 'seeds', 'bricks', 'sweets', 'mangoes', 'eggs', 'pencils', 'books', 'cupcakes'];
const SHOPS = ['shop', 'market stall', 'bakery', 'warehouse', 'store room', 'toy shop'];
const BOXES = ['boxes', 'bags', 'packs', 'jars', 'baskets', 'trays', 'crates', 'shelves'];
const PEOPLE = ['friends', 'children', 'cousins', 'players', 'pupils', 'teams'];
const CAKES = ['cake', 'pizza', 'pie', 'chocolate bar', 'watermelon'];
const LIQUID = ['jug', 'bottle', 'bucket', 'kettle', 'tank'];
const one = (plural) => plural.replace(/(x|s)es$/, '$1').replace(/s$/, '');

const q = (text, answer, read) => ({ display: { layout: 'word', text, choices: null }, answer, read: read || text });
const choice = (text, options, right, read) => { const o = shuffle(options); return { display: { layout: 'word', text, choices: o }, answer: { type: 'choice', v: o.indexOf(right) }, read: read || `${text.slice(0, -1)}: ${o.join(', ')}?` }; };
const frac = (n, d) => `${n}/${d}`;
const said = (n, d) => `${n} over ${d}`; // for the 🔊 line

// ---- the words for each of Engine's six sectors. Small numbers happen to a child; big ones to a farm, a stadium, a town ----
const add = (a, b, ans) => {
  const [p, r] = names(2), it = pick(THINGS), A = fmt(a), B = fmt(b);
  return q(pick(a >= 1000 || b >= 1000 ? [
    `A farm picked ${A} ${it} one week and ${B} the next week. How many ${it} is that altogether?`,
    `A stadium sold ${A} tickets on Saturday and ${B} on Sunday. How many tickets over the weekend?`,
    `${p} walked ${A} steps before lunch and ${B} steps after lunch. How many steps in all?`,
    `A town has ${A} people on one side of the river and ${B} on the other. How many people live in the town?`,
    `A library has ${A} books downstairs and ${B} upstairs. How many books does it have?`,
    `A tank holds ${A} litres and a second tank holds ${B}. How many litres do the two tanks hold together?`,
    `${A} plus ${B} — what does that make?`,
  ] : [
    `${p} had ${A} ${it}. Then ${p} got ${B} more. How many ${it} does ${p} have now?`,
    `A ${pick(SHOPS)} had ${A} ${it} in the morning, and ${B} more arrived in the afternoon. How many ${it} altogether?`,
    `${p} has ${A} ${it} and ${r} has ${B}. How many do they have in total?`,
    `A bus carried ${A} passengers on Monday and ${B} on Tuesday. What is the total for the two days?`,
    `${p} saved ${A} coins in one month and ${B} the next. How many coins is that combined?`,
    `One box holds ${A} ${it}. Another holds ${B}. How many ${it} in both boxes together?`,
    `${p} scored ${A} points in the first game and ${B} in the second. What is ${p}'s total?`,
  ]), ans);
};
const sub = (a, b, ans) => {
  const [p, r] = names(2), it = pick(THINGS), A = fmt(a), B = fmt(b);
  return q(pick(a >= 1000 ? [
    `A stadium holds ${A} people. ${B} seats are taken. How many seats are still empty?`,
    `The whole trip is ${A} km. The bus has already driven ${B} km. How far is left to go?`,
    `A tank held ${A} litres. ${B} litres were used. How many litres are left?`,
    `A library has ${A} books. ${B} are out on loan. How many are on the shelves?`,
    `${p} needs ${A} points to win and has ${B} so far. How many more points are needed?`,
    `A farm had ${A} ${it} and sent ${B} to market. How many ${it} are left on the farm?`,
    `What is the difference between ${A} and ${B}?`,
  ] : [
    `${p} had ${A} ${it} and gave ${B} to ${r}. How many ${it} does ${p} have left?`,
    `A ${pick(SHOPS)} had ${A} ${it}. ${B} were sold. How many remain?`,
    `${p} has ${A} ${it}. ${r} has ${B}. How many more does ${p} have than ${r}?`,
    `A jar held ${A} marbles. ${B} rolled out. How many are still in the jar?`,
    `${A} people were in the hall. ${B} of them went home. How many are still there?`,
    `${p} needs ${A} points to win and has ${B} so far. How many more points are needed?`,
    `A rope was ${A} cm long. ${B} cm was cut off. How long is it now, in cm?`,
  ]), ans);
};
const mul = (a, b, ans) => {
  const [p] = names(1), it = pick(THINGS), [s, l] = a <= b ? [a, b] : [b, a], S = fmt(s), L = fmt(l), box = pick(BOXES); // the count of containers is the smaller number
  return q(pick([
    `There are ${S} ${box} with ${L} ${it} in each. How many ${it} altogether?`,
    `${p} reads ${L} pages a day for ${S} days. How many pages is that?`,
    `A hall has ${S} rows of ${L} chairs. How many chairs are there?`,
    `A bus carries ${L} people. How many people can ${S} buses carry?`,
    `${p} puts ${L} ${it} in each of ${S} ${box}. How many ${it} are used?`,
    `A machine makes ${L} ${it} every minute. How many does it make in ${S} minutes?`,
    `${S} teams of ${L} players each. How many players in all?`,
    `A garden has ${S} rows with ${L} plants in each row. How many plants?`,
  ]), ans);
};
const div = (n, d, ans) => {
  const [p] = names(1), it = pick(THINGS), N = fmt(n), D = fmt(d), box = pick(BOXES);
  return q(pick([
    `${N} ${it} are shared equally among ${D} ${pick(PEOPLE)}. How many does each get?`,
    `${N} ${it} are packed ${D} to a ${one(box)}. How many ${box} are filled?`,
    `A rope ${N} m long is cut into ${D} equal pieces. How long is each piece, in metres?`,
    `${N} children stand in ${D} equal rows. How many children in each row?`,
    `${p} has ${N} ${it} and puts the same number on each of ${D} shelves. How many on each shelf?`,
    `${N} litres of juice fill ${D} identical bottles. How much does one bottle hold, in litres?`,
    `A ${pick(SHOPS)} sold ${N} ${it} in ${D} days, the same number each day. How many a day?`,
    `${N} chairs are set out in ${D} equal rows. How many chairs in a row?`,
  ]), ans);
};
const simplify = (nk, dk, ans) => {
  const [p] = names(1), c = pick(CAKES);
  return q(pick([
    `A ${c} is cut into ${dk} equal slices and ${nk} of them are eaten. What fraction of the ${c} is eaten? Give it in its simplest form.`,
    `${nk} of ${p}'s ${dk} marbles are blue. Write the blue part as a fraction in its simplest form.`,
    `A ribbon is cut into ${dk} equal parts and ${p} uses ${nk} of them. What fraction of the ribbon is used, in its simplest form?`,
    `${nk} out of ${dk} seats on a bus are taken. What fraction of the seats is taken? Simplest form.`,
  ]), ans, `${nk} out of ${dk}. What is that as a fraction in its simplest form?`);
};
const fracSame = (a, b, d, sym, ans) => {
  const [p, r] = names(2), c = pick(CAKES), j = pick(LIQUID);
  const text = sym === '+' ? pick([
    `${p} ate ${frac(a, d)} of a ${c} and ${r} ate ${frac(b, d)} of the same ${c}. What fraction did they eat together?`,
    `${p} walked ${frac(a, d)} of the way to school, then another ${frac(b, d)}. How much of the way has ${p} walked?`,
    `A ${j} was ${frac(a, d)} full. ${r} poured in another ${frac(b, d)}. How full is it now?`,
  ]) : pick([
    `A ${j} was ${frac(a, d)} full. ${p} drank ${frac(b, d)} of the ${j}. What fraction is left?`,
    `${p} had ${frac(a, d)} of a ${c} and gave ${frac(b, d)} of the ${c} to ${r}. What fraction does ${p} have now?`,
    `${frac(a, d)} of the garden was planted. ${frac(b, d)} of it was dug up again. What fraction is still planted?`,
  ]);
  return q(text, ans, text.replaceAll(frac(a, d), said(a, d)).replaceAll(frac(b, d), said(b, d)));
};
const fracMixed = (n1, d1, n2, d2, sym, ans) => {
  const [p, r] = names(2), c = pick(CAKES), j = pick(LIQUID), f1 = frac(n1, d1), f2 = frac(n2, d2);
  const text = sym === '+' ? pick([
    `A recipe needs ${f1} of a cup of flour and ${f2} of a cup of sugar. How many cups is that altogether?`,
    `${p} ran ${f1} of a km in the morning and ${f2} of a km in the evening. How far did ${p} run in total, in km?`,
    `${p} has ${f1} of a ${c} and ${r} has ${f2} of a ${c}. How much ${c} do they have together?`,
  ]) : sym === '−' ? pick([
    `${p} had ${f1} of a ${c} and ate ${f2} of a ${c}. What fraction of a ${c} is left?`,
    `A ${j} was ${f1} full. ${f2} of the ${j} was poured out. How full is it now?`,
    `A plank is ${f1} of a metre long. ${p} saws off ${f2} of a metre. How long is the piece that is left, in metres?`,
  ]) : sym === '×' ? pick([
    `${f1} of the class play football, and ${f2} of those players wear boots. What fraction of the whole class wear boots?`,
    `${p} has ${f1} of a ${c} left and gives ${f2} of that to ${r}. What fraction of the whole ${c} does ${r} get?`,
    `A garden is ${f1} vegetables. ${f2} of the vegetables are carrots. What fraction of the garden is carrots?`,
  ]) : pick([
    `A ${j} holds ${f1} of a litre. A cup holds ${f2} of a litre. How many cups does the ${j} fill?`,
    `A ribbon is ${f1} of a metre long. It is cut into pieces ${f2} of a metre long. How many pieces?`,
    `${p} has ${f1} of a bag of flour and each loaf needs ${f2} of a bag. How many loaves can ${p} bake?`,
  ]);
  return q(text, ans, text.replaceAll(f1, said(n1, d1)).replaceAll(f2, said(n2, d2)));
};

// an Engine question of this sector and tier, told in words
function worded(levelIdx, tier) {
  const e = genEngine(levelIdx, tier), d = e.display;
  if (d.layout === 'stack') return d.sym === '+' ? add(d.top, d.bottom, e.answer) : d.sym === '−' ? sub(d.top, d.bottom, e.answer) : mul(d.top, d.bottom, e.answer);
  if (d.layout === 'inline') { const [n, dv] = d.text.split('÷').map((s) => Number(s.replace(/[^0-9]/g, ''))); return div(n, dv, e.answer); }
  const [x, s, y] = d.parts;
  if (!s) return simplify(x.n, x.d, e.answer);
  return x.d === y.d && levelIdx === 4 ? fracSame(x.n, y.n, x.d, s.sym, e.answer) : fracMixed(x.n, x.d, y.n, y.d, s.sym, e.answer);
}
// the value an Engine question is worth, and the short way to show it as one of four options
const value = (e) => (e.answer.type === 'frac' ? e.answer.n / e.answer.d : e.answer.v);
function shown(e) {
  const d = e.display;
  if (d.layout === 'stack') return `${fmt(d.top)} ${d.sym} ${fmt(d.bottom)}`;
  if (d.layout === 'inline') return d.text.replace(/\s*=\s*$/, '');
  const [x, s, y] = d.parts; return s ? `${frac(x.n, x.d)} ${s.sym} ${frac(y.n, y.d)}` : frac(x.n, x.d);
}
const PLACES = [['the biggest', (v) => v[3]], ['the smallest', (v) => v[0]], ['the second biggest', (v) => v[2]], ['the second smallest', (v) => v[1]]];
const HEAD = ['Which sum has', 'Which take-away has', 'Which of these has', 'Which of these has'];
// four amounts of this sector and tier, all different, and one place in their order to name. A child need not work all
// four out: the biggest of four sums shows in the hundreds, and seeing that is the point.
function logic(levelIdx, tier) {
  for (let t = 0; t < 40; t++) {
    const four = Array.from({ length: 4 }, () => genEngine(levelIdx, tier));
    const vals = four.map(value); if (new Set(vals).size < 4) continue;
    const sorted = [...vals].sort((a, b) => a - b), [place, at] = pick(PLACES), want = four[vals.indexOf(at(sorted))];
    const bare = four.every((e) => e.display.layout === 'frac' && e.display.parts.length === 1); // plain fractions to compare, not sums
    const text = bare ? `Which fraction is ${place}?` : `${HEAD[levelIdx] || 'Which of these has'} ${place} answer?`;
    return choice(text, four.map(shown), shown(want), `${text.slice(0, -1)}: ${four.map(shown).join(', ')}?`);
  }
  return worded(levelIdx, tier);
}
export const genNavigator = (levelIdx, tier) => (Math.random() < 0.3 ? logic(levelIdx, tier) : worded(levelIdx, tier));
// Engine's allowance for the same numbers, plus fifteen seconds to read the story
export const navSecondsFor = (levelIdx, tier, mult = 1) => Math.round((LEVELS[Math.min(levelIdx, LEVELS.length - 1)].base + (tier - 1) * 5 + 15) * mult);

// What each sector covers, in a child's words: the How to's second slide (public/app.js holds the same list; a test keeps
// the two the same). The paper numbers are Engine's tiers.
export const NAV_TOPICS = [
  { title: 'Sector A · Navigator', lines: ['The same adding as Engine, told as something that happens: shells on a beach, steps before lunch, tickets at a stadium.', 'Three-digit plus two-digit at first; three-digit plus three-digit from paper 21; four-digit numbers from paper 61.', 'One question in three is logic: four sums, and which has the biggest, the smallest, the second biggest or the second smallest answer.', 'Tap 🔊 to hear any question read out. Read it twice: what do I have, what do I need to find?'] },
  { title: 'Sector B · Navigator', lines: ['Taking away, told in words: what is left in the jar, how far is still to go, how many more one child has than another.', 'Three-digit take away two-digit at first; three-digit from paper 21; four-digit from paper 41.', 'Logic questions: four take-aways, and which leaves the biggest, the smallest, the second biggest or the second smallest.', 'Same numbers as Engine Sector B: if you can do the sum, you can do the story.'] },
  { title: 'Sector C · Navigator', lines: ['Times tables in stories: rows of chairs, boxes of pencils, days of reading.', 'Tables to 9 × 9 at first; two-digit times one digit from paper 21; three-digit times one digit from paper 41; two-digit times two-digit from paper 61; three-digit times two-digit from paper 81.', 'Logic questions: four multiplications, and which makes the most, the least, the second most or the second least.', 'The smaller number is always how many boxes, rows or days there are.'] },
  { title: 'Sector D · Navigator', lines: ['Sharing and grouping: sweets among friends, a rope cut into equal pieces, chairs in equal rows.', 'Sharing by 2 to 9 with answers up to 9 at first, up to 12 from paper 21; two-digit answers from paper 41, three-digit from paper 61; sharing by 11 to 25 from paper 81.', 'Logic questions: four divisions, and which gives the biggest, the smallest, the second biggest or the second smallest.', 'Every share comes out exactly — no remainders on this track.'] },
  { title: 'Sector E · Navigator', lines: ['Fractions of real things: slices of a cake, how full a jug is, the part of the way walked.', 'Simplifying a fraction at first; adding fractions with the same bottom number from paper 21; taking away from paper 41; both from paper 61.', 'Logic questions: four fractions, and which is the biggest, the smallest, the second biggest or the second smallest.', 'The keypad has a ∕ key for a fraction. Give every answer in its simplest form.'] },
  { title: 'Sector F · Navigator', lines: ['Fractions with different bottom numbers, in recipes, ribbons and jugs.', 'Adding at first; taking away from paper 21; multiplying from paper 41; dividing from paper 61; all four mixed from paper 81.', 'Logic questions: four fraction sums, and which has the biggest, the smallest, the second biggest or the second smallest answer.', 'Same numbers as Engine Sector F: if you can do the sum, you can do the story.'] },
];
