// ================= NAVIGATOR — word & logic problems =================
// The second track. Every level generates from templates with randomised numbers, names and
// objects (never a fixed bank), plus a fact base of real-world things with masses, lengths,
// capacities, durations and speeds for the deductive "which is heavier / about how much" questions.
//
// Difficulty is shifted one year UP from the MOE syllabus year the level letter would suggest:
//   A ≈ Primary 2 · B ≈ P3 · C ≈ P4 · D ≈ P5 · E ≈ P6 · F ≈ PSLE heuristics
// Inside a level, tier 1–5 widens the numbers.
//
// A question: { display: { layout: "word", text, choices? }, answer: { type: "int"|"dec"|"choice", v }, read }
//   int    → keypad, whole number
//   dec    → keypad with a "." key, compared to 2 dp
//   choice → tap one of `choices`; v is the index of the right one

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const NAMES = ["Mei", "Ben", "Ali", "Sara", "Ravi", "Lily", "Tom", "Aisha", "Kai", "Nora", "Zoe", "Omar"];
const names = (n) => shuffle(NAMES).slice(0, n);
const ITEMS = ["sticker", "marble", "sweet", "card", "shell", "coin", "bead", "stamp", "apple", "button", "book", "toy car"];

// ---- fact base ----  (value, then a kid-facing name)
const MASS_G = [["a strand of hair", 0.01], ["a sheet of paper", 5], ["a pencil", 7], ["an egg", 55], ["an apple", 180], ["a football", 430], ["a bottle of water (1 L)", 1000], ["a cat", 4000], ["a bicycle", 12000], ["a fridge", 80000], ["a car", 1300000], ["an elephant", 5000000]];
const LEN_CM = [["an ant", 0.5], ["a paper clip", 3], ["a pencil", 18], ["a ruler", 30], ["a door", 200], ["a bus", 1200], ["a football field", 10000], ["the distance to the next town", 2000000]];
const CAP_ML = [["a teaspoon", 5], ["a cup", 250], ["a water bottle", 1000], ["a bucket", 10000], ["a bathtub", 150000], ["a swimming pool", 500000000]];
const TIME_MIN = [["one blink", 0.005], ["brushing your teeth", 2], ["a lunch break", 30], ["a school day", 360], ["a night's sleep", 600], ["a whole week", 10080]];
const SPEED_KMH = [["a snail", 0.05], ["walking", 5], ["a bicycle", 15], ["a car on the highway", 100], ["a bullet train", 300], ["a plane", 900]];

// two facts far enough apart (ratio ≥ 4) that the answer is never a coin-flip
const farPair = (table) => {
  for (let t = 0; t < 50; t++) {
    const a = pick(table), b = pick(table);
    if (a !== b && Math.max(a[1], b[1]) / Math.min(a[1], b[1]) >= 4) return [a, b];
  }
  return [table[0], table[table.length - 1]];
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const q = (text, answer, choices, read) => ({ display: { layout: "word", text, choices: choices || null }, answer, read: read || text });
const num = (text, v, read) => q(text, { type: "int", v }, null, read);
const dec = (text, v, read) => q(text, { type: "dec", v: Math.round(v * 100) / 100 }, null, read);
const choice = (text, options, correct, read) => q(text, { type: "choice", v: correct }, options, read);
// a choice question whose options are shuffled — pass the right answer as a string
const pickOne = (text, options, right, read) => { const o = shuffle(options); return choice(text, o, o.indexOf(right), read); };

// ---- shared comparison templates, scaled by level ----
const heavier = () => { const [a, b] = farPair(MASS_G); const n = pick([1, 1, 10, 5]); const A = n === 1 ? a[0] : `${n} ${a[0].replace(/^an? /, "")}s`, B = n === 1 ? b[0] : `${n} ${b[0].replace(/^an? /, "")}s`; return pickOne(`Which is heavier — ${A} or ${B}?`, [cap(A), cap(B)], a[1] > b[1] ? cap(A) : cap(B)); };
const longer = () => { const [a, b] = farPair(LEN_CM); return pickOne(`Which is longer — ${a[0]} or ${b[0]}?`, [cap(a[0]), cap(b[0])], a[1] > b[1] ? cap(a[0]) : cap(b[0])); };
const holdsMore = () => { const [a, b] = farPair(CAP_ML); return pickOne(`Which holds more water — ${a[0]} or ${b[0]}?`, [cap(a[0]), cap(b[0])], a[1] > b[1] ? cap(a[0]) : cap(b[0])); };
const takesLonger = () => { const [a, b] = farPair(TIME_MIN); return pickOne(`Which takes longer — ${a[0]} or ${b[0]}?`, [cap(a[0]), cap(b[0])], a[1] > b[1] ? cap(a[0]) : cap(b[0])); };
const faster = () => { const [a, b] = farPair(SPEED_KMH); return pickOne(`Which is faster — ${a[0]} or ${b[0]}?`, [cap(a[0]), cap(b[0])], a[1] > b[1] ? cap(a[0]) : cap(b[0])); };
// "about how much" — the true value in a sensible unit against a decoy 5–10× off
const fmtMass = (g) => (g >= 1000 ? `${Math.round(g / 1000)} kg` : g >= 1 ? `${Math.round(g)} g` : `${g} g`);
const fmtLen = (cm) => (cm >= 100000 ? `${Math.round(cm / 100000)} km` : cm >= 100 ? `${Math.round(cm / 100)} m` : `${cm} cm`);
const fmtCap = (ml) => (ml >= 1000 ? `${Math.round(ml / 1000)} L` : `${ml} ml`);
const about = () => {
  const kind = pick(["m", "l", "c"]);
  const [name, v] = pick(kind === "m" ? MASS_G.slice(2, 10) : kind === "l" ? LEN_CM.slice(1, 7) : CAP_ML.slice(1, 5));
  const f = kind === "m" ? fmtMass : kind === "l" ? fmtLen : fmtCap;
  const decoy = v * pick([0.1, 0.2, 5, 10]);
  const verb = kind === "m" ? "weigh" : kind === "l" ? "measure" : "hold";
  return pickOne(`About how much does ${name} ${verb}?`, [f(v), f(decoy)], f(v));
};
const ordering = () => {
  const [a, b, c] = names(3); const attr = pick([["taller", "tallest", "shortest"], ["older", "oldest", "youngest"], ["faster", "fastest", "slowest"]]);
  const askTop = Math.random() < 0.5;
  return pickOne(`${a} is ${attr[0]} than ${b}. ${b} is ${attr[0]} than ${c}. Who is the ${askTop ? attr[1] : attr[2]}?`, [a, b, c], askTop ? a : c);
};

// ====================================================================
// LEVEL A  (≈ P2): to 1,000 · 2-step add/sub · small × only (2,3,5,10 — NO division) · ½ ¼ · m/cm · kg/g · L · $ · time to 5 min
// ====================================================================
const A = [
  (t) => { const n = ri(10, 100 * t); const k = ri(1, 9 + t * 2); return pick([num(`___ is ${k} less than ${n}.`, n - k), num(`___ is ${k} more than ${n}.`, n + k), num(`${k} more than ${n} is ___.`, n + k)]); },
  (t) => { const n = ri(100, 200 + 150 * t); const k = pick([10, 20, 30, 50, 100]); return num(`___ is ${k} more than ${n}.`, n + k); },
  // multiplication only, and small: rows × 2/3/5/10 — no division at Sector A (that starts at B)
  (t) => { const r = ri(2, Math.min(5, 2 + t)), c = pick([2, 3, 5, 10]); return num(`A box has ${r} rows of ${c} eggs. How many eggs altogether?`, r * c); },
  (t) => { const [a] = names(1); const k = ri(2, Math.min(5, 2 + t)), each = pick([2, 3, 5]); return num(`${a} has ${k} bags with ${each} sweets in each bag. How many sweets altogether?`, k * each); },
  (t) => { const [a] = names(1); const had = ri(10, 15 + 10 * t), spent = ri(3, had - 4), found = ri(1, 9); return num(`${a} had $${had}. ${a} spent $${spent}, then found $${found}. How much does ${a} have now?`, had - spent + found); },
  (t) => { const m = ri(1, 1 + Math.floor(t / 2)), cut = ri(15, 85); return num(`A rope is ${m} m long. ${cut} cm is cut off. How many cm are left?`, m * 100 - cut); },
  () => pickOne("Half of a pizza is more or less than a quarter of the same pizza?", ["More", "Less"], "More"),
  (t) => { const h = ri(1, 11), m1 = pick([0, 5, 10, 15, 20]), d = pick([5, 10, 15, 20, 25, 30]).valueOf() + (t > 3 ? 5 : 0); const m2 = m1 + d; return num(`The train leaves at ${h}:${String(m1).padStart(2, "0")} and arrives at ${h}:${String(m2).padStart(2, "0")}. The ride took ___ minutes.`, d); },
  ordering,
  heavier, longer, holdsMore, takesLonger,
  () => pickOne("A watermelon weighs about 1 kg or 5 kg?", ["1 kg", "5 kg"], "5 kg"),
  (t) => { const [a, b] = names(2); const it = pick(ITEMS); const d = ri(2, 9), x = ri(d + 3, 20 + 10 * t); return pick([num(`${a} has ${x} ${it}s. ${b} has ${d} fewer. How many does ${b} have?`, x - d), num(`${a} has ${x} ${it}s, ${d} more than ${b}. How many does ${b} have?`, x - d), num(`${a} has ${x} ${it}s. ${b} has ${x + d}. How many more does ${b} have?`, d)]); },
  (t) => { const total = ri(20, 40 + 20 * t), gone = ri(5, total - 5), more = ri(2, 12); return num(`${total} birds sit on a wire. ${gone} fly away, then ${more} come back. How many birds now?`, total - gone + more); },
  (t) => { const n = ri(1, Math.min(5, 1 + t)); const [what, legs] = pick([["spider", 8], ["dog", 4], ["bird", 2], ["ant", 6]]); return num(`A ${what} has ${legs} legs. How many legs do ${n} ${what}s have?`, legs * n); },
  () => { const d = ri(1, 9); const c = ri(1, 9) * 10; return dec(`${d} dollars and ${c} cents is $___.`, d + c / 100); },
];

// ====================================================================
// LEVEL B  (≈ P3): to 10,000 · tables 6–9 · 2-step with × · equivalent fractions · perimeter · km/ml · 24-h time · graphs
// ====================================================================
const B = [
  (t) => { const a = ri(2, 9), b = ri(6, 9); return pick([num(`___ × ${b} = ${a * b}.`, a), num(`${a * b} ÷ ${b} = ___.`, a), num(`${a} × ___ = ${a * b}.`, b)]); },
  (t) => { const boxes = ri(3, 5 + t), per = ri(6, 9), broken = ri(2, 12); return num(`A shop gets ${boxes} boxes of ${per} pens. ${broken} pens are broken. How many good pens?`, boxes * per - broken); },
  (t) => { const k = pick([2, 3, 4, 5, 6]); const each = ri(2, 5 + t); const [a] = names(1); return num(`${a} shares ${k * each} sweets equally among ${k} friends. Each friend gets ___.`, each); },
  () => { const d = pick([2, 3, 4, 5]); const k = pick([2, 3]); return pickOne(`Which is bigger — ${k}/${d * k} of a cake or 1/${d} of the same cake?`, [`${k}/${d * k}`, `1/${d}`, "They are equal"], "They are equal"); },
  (t) => { const l = ri(3, 10 + t * 2), w = ri(2, l - 1); return pick([num(`A rectangle is ${l} cm long and ${w} cm wide. Its perimeter is ___ cm.`, 2 * (l + w)), num(`A square has sides of ${l} cm. Its perimeter is ___ cm.`, 4 * l)]); },
  () => pickOne("A car trip to the next town takes about 20 minutes. About how far is it — 3 km or 300 km?", ["3 km", "300 km"], "3 km"),
  (t) => { const each = pick([100, 150, 200, 250]); const start = pick([1000, 1500, 2000]); const cups = ri(2, Math.min(4 + Math.floor(t / 2), Math.floor(start / each) - 1)); return num(`A bottle holds ${start} ml. After pouring ${cups} cups of ${each} ml, ___ ml are left.`, start - cups * each); },
  () => { const h = ri(13, 23); return num(`${h}:00 on a 24-hour clock is ___ o'clock in the afternoon or evening.`, h - 12); },
  (t) => { const [a, b] = names(2); const it = pick(ITEMS); const k = ri(2, 4), x = ri(4, 10 + 3 * t); return pick([num(`${a} has ${k} times as many ${it}s as ${b}. ${b} has ${x}. Together they have ___.`, k * x + x), num(`${a} has ${k} times as many ${it}s as ${b}. ${b} has ${x}. ${a} has ___ more than ${b}.`, k * x - x)]); },
  () => { const n = pick([4, 5, 6]), c = n * pick([1, 2]); return pickOne(`${n} pencils cost $${c}. How much do ${n * 2} pencils cost?`, [`$${c * 2}`, `$${c}`, `$${c * 4}`], `$${c * 2}`); },
  (t) => { const m = ri(20, 40 + 10 * t), w = ri(10, 30), tu = w + ri(5, 30 + 10 * t); return num(`A graph shows visitors: Mon ${m}, Tue ${tu}, Wed ${w}. How many more came on Tue than Wed?`, tu - w); },
  (t) => { const n = ri(100, 900 + 900 * t); const k = pick([100, 200, 500, 1000]); return num(`___ is ${k} more than ${n}.`, n + k); },
  (t) => { const [a] = names(1); const c = ri(6, 9), rows = ri(3, 6 + t), left = ri(1, c - 1); return num(`${a} plants ${rows} rows of ${c} seeds and has ${left} seeds left over. How many seeds did ${a} start with?`, rows * c + left); },
  ordering, heavier, longer, about, takesLonger,
  () => { const [a, b] = names(2); const x = ri(30, 90), y = ri(5, 25); return pickOne(`${a} is ${x} cm tall. ${b} is ${y} cm shorter. Is ${b} taller or shorter than ${x - y - 1} cm?`, ["Taller", "Shorter"], "Taller"); },
];

// ====================================================================
// LEVEL C  (≈ P4): to 100,000 · factors & multiples · decimals · multi-step money · angles · area · time across hours
// ====================================================================
const C = [
  (t) => { const a = ri(1, 9) + pick([0.25, 0.5, 0.75]); const k = pick([0.5, 0.25, 1.5, 0.75]); return dec(`___ is ${k} more than ${a}.`, a + k); },
  () => { const b = pick([6, 7, 8, 9]); const yes = Math.random() < 0.5; const n = yes ? b * ri(2, 9) : b * ri(2, 9) + ri(1, b - 1); return pickOne(`Is ${n} a multiple of ${b}?`, ["Yes", "No"], yes ? "Yes" : "No"); },
  (t) => { const s = ri(4, 9 + t * 2), w = ri(2, s - 1); return pick([num(`A square field has sides of ${s} m. Its area is ___ m².`, s * s), num(`A rectangle is ${s} m long and ${w} m wide. Its area is ___ m².`, s * w)]); },
  () => { const n = ri(2, 5), each = ri(300, 1500); return dec(`${n} shirts cost ${money(n * each)}. One shirt costs $___.`, each / 100); },
  () => { const a = pick([30, 45, 60, 120, 135, 150]); return pickOne(`A right angle is 90°. Is an angle of ${a}° bigger or smaller than a right angle?`, ["Bigger", "Smaller"], a > 90 ? "Bigger" : "Smaller"); },
  (t) => { const seats = pick([40, 45, 50]), buses = ri(2, 3 + Math.floor(t / 2)), pupils = ri(seats * buses - 40, seats * buses - 5); return num(`A bus has ${seats} seats. ${buses} buses take ${pupils} pupils. How many seats are empty?`, seats * buses - pupils); },
  () => { const w = ri(1, 8); const f = pick([[1, 4], [3, 4], [1, 3], [2, 3]]); const near = f[0] / f[1] >= 0.5 ? w + 1 : w; return pickOne(`Is ${w} ${f[0]}/${f[1]} closer to ${w} or ${w + 1}?`, [`${w}`, `${w + 1}`], `${near}`); },
  (t) => { const [a] = names(1); const wk = ri(3, 6), each = ri(500, 1500), spent = ri(500, wk * each - 300); return dec(`${a} saved ${money(each)} every week for ${wk} weeks, then spent ${money(spent)}. ${a} has $___ left.`, (wk * each - spent) / 100); },
  () => { const h = ri(17, 20), m = pick([10, 20, 40, 50]); const dh = ri(1, 2), dm = pick([15, 25, 35, 45]); const end = h * 60 + m + dh * 60 + dm; const mark = pick([20, 21, 22]) * 60; return pickOne(`A film starts at ${h}:${String(m).padStart(2, "0")} and lasts ${dh} h ${dm} min. Does it end before or after ${mark / 60}:00?`, ["Before", "After"], end > mark ? "After" : "Before"); },
  () => { const a = pick([4, 6, 8]), b = pick([6, 9, 10, 12]); if (a === b) return num(`The smallest number that is a multiple of both 3 and 5 is ___.`, 15); const l = (a * b) / gcd(a, b); return num(`The smallest number that is a multiple of both ${a} and ${b} is ___.`, l); },
  (t) => { const k = pick([1000, 2000, 5000]); const n = ri(k + 500, 9000 + 9000 * t); return num(`___ is ${k} less than ${n}.`, n - k); },
  () => { const [a, b] = names(2); const x = ri(2, 9) + pick([0.2, 0.4, 0.5, 0.6, 0.8]); const y = pick([1.5, 2.5, 0.75, 1.25]); return dec(`${a} runs ${x} km. ${b} runs ${y} km more. How far does ${b} run, in km?`, x + y); },
  () => { const n = ri(12, 60); const f = pick([2, 3, 4, 5, 6]); return pickOne(`Is ${f} a factor of ${n}?`, ["Yes", "No"], n % f === 0 ? "Yes" : "No"); },
  heavier, about, faster, ordering,
  (t) => { const n = ri(2, 4), per = ri(15, 30 + 5 * t), cars = ri(5, 25); return num(`${cars + n * per} pupils go on a trip. ${cars} ride in cars and the rest fill ${n} equal buses. How many pupils on each bus?`, per); },
];

// ====================================================================
// LEVEL D  (≈ P5): percentage · ratio · average · rate · volume · fraction of a set · discount
// ====================================================================
const D = [
  () => { const p = pick([10, 20, 25, 50, 75]), n = pick([40, 60, 80, 120, 200, 300]); return num(`${p}% of ${n} is ___.`, (p * n) / 100); },
  (t) => { const a = ri(2, 5); let b = ri(1, 4); if (b === a) b = a + 1; const k = ri(3, 5 + t); return num(`Boys to girls in a class is ${a} : ${b}. There are ${a * k} boys. How many girls?`, b * k); },
  () => { let x; do { x = [ri(5, 30), ri(5, 30), ri(5, 30)]; } while ((x[0] + x[1] + x[2]) % 3 !== 0); return num(`The average of ${x[0]}, ${x[1]} and ${x[2]} is ___.`, (x[0] + x[1] + x[2]) / 3); },
  () => { const rate = pick([4, 5, 8, 10]), tank = rate * ri(6, 12); return pickOne(`A tap fills ${rate} litres a minute. How long to fill a ${tank}-litre tank?`, [`${tank / rate} min`, `${tank / rate + 2} min`, `${tank / rate - 2} min`], `${tank / rate} min`); },
  (t) => { const l = ri(4, 10 + t), w = ri(2, 6), h = ri(2, 5); return num(`A box is ${l} cm × ${w} cm × ${h} cm. Its volume is ___ cm³.`, l * w * h); },
  () => { const f = pick([[1, 2], [1, 4], [3, 4], [2, 3], [1, 3], [3, 5]]); const n = f[1] * ri(4, 12); return num(`${f[0]}/${f[1]} of a class of ${n} chose football. How many chose football?`, (n * f[0]) / f[1]); },
  () => { const price = pick([40, 50, 60, 80, 100]), off = pick([10, 20, 25, 30, 50]); const sale = price * (100 - off) / 100; const mark = Math.round(sale) + pick([-3, 3]); return pickOne(`A $${price} jacket is ${off}% off. Is the sale price more or less than $${mark}?`, ["More", "Less"], sale > mark ? "More" : "Less"); },
  (t) => { const b = ri(4, 12 + t), h = ri(3, 10); const area = (b * h) / 2; return Number.isInteger(area) ? num(`A triangle has base ${b} cm and height ${h} cm. Its area is ___ cm².`, area) : num(`A triangle has base ${b} cm and height ${h + 1} cm. Its area is ___ cm².`, (b * (h + 1)) / 2); },
  () => { const [a] = names(1); const d = pick([3, 4, 5, 6]); const n = d * ri(5, 15); return num(`After giving away 1/${d} of ${a}'s ${n} stamps, ${a} has ___ left.`, n - n / d); },
  () => { const k = ri(2, 6), a = ri(1, 4), b = ri(1, 4) + 4; return pickOne(`The ratio ${a * k} : ${b * k} is the same as which?`, [`${a} : ${b}`, `${a} : ${b + 1}`, `${a + 1} : ${b}`], `${a} : ${b}`); },
  () => { const total = pick([100, 200, 250, 500]); const p = pick([20, 30, 40, 60, 80]); return num(`${p}% of the ${total} pupils walk to school. How many do NOT walk?`, total - (total * p) / 100); },
  () => { const km = pick([60, 90, 120, 150, 180]), h = pick([2, 3]); return num(`A cyclist rides ${km} km in ${h} hours at a steady speed. How far in 1 hour?`, km / h); },
  (t) => { const [a, b] = names(2); const it = pick(ITEMS); const r = [ri(2, 5), ri(1, 4)]; const unit = ri(4, 8 + t); return num(`${a} and ${b} share ${it}s in the ratio ${r[0]} : ${r[1]}. ${a} has ${r[0] * unit}. How many do they have altogether?`, (r[0] + r[1]) * unit); },
  about, faster, heavier,
  () => { const [a, b] = names(2); const p1 = ri(3, 9) * 10, p2 = p1 + pick([5, 10, 15]); return pickOne(`${a} scored ${p1}% on a test. ${b} scored ${p2}%. Who did better?`, [a, b], b); },
];

// ====================================================================
// LEVEL E  (≈ P6): speed · simple algebra · percentage change · pie charts · work backwards · circles · ratio share
// ====================================================================
const E = [
  () => { const s = pick([40, 50, 60, 80, 90]), h = ri(2, 5); return pick([num(`A car travels ${s * h} km in ${h} hours. Its speed is ___ km/h.`, s), num(`A car travels at ${s} km/h for ${h} hours. How far does it go, in km?`, s * h), num(`At ${s} km/h, how many hours to travel ${s * h} km?`, h)]); },
  () => { const n = ri(4, 15), k = ri(3, 8); return num(`A box holds n apples, so ${k} boxes hold ${k}n apples. If ${k}n = ${k * n}, then n = ___.`, n); },
  () => { const from = pick([20, 40, 50, 80, 200]); const p = pick([10, 20, 25, 50]); const to = from + (from * p) / 100; return pick([num(`A price rises from $${from} to $${to}. The increase is ___ %.`, p), num(`A price falls from $${to} to $${from}. It went down by $___.`, to - from)]); },
  () => { const red = pick([25, 40, 50]), blue = pick([20, 25, 30]); const green = 100 - red - blue; return pickOne(`A pie chart: ${red}% red, ${blue}% blue, the rest green. Is green more, less, or the same as blue?`, ["More", "Less", "The same"], green > blue ? "More" : green < blue ? "Less" : "The same"); },
  () => { const [a] = names(1); const left = ri(4, 20), extra = ri(2, 10); const start = 2 * (left + extra); return num(`${a} had some money, spent half of it, then spent $${extra} more, and had $${left} left. How much did ${a} start with?`, start); },
  () => { const r = pick([7, 14, 21, 3.5]); return num(`Taking π as 22/7, the circumference of a circle with radius ${r} cm is ___ cm.`, Math.round(2 * (22 / 7) * r)); },
  () => { const [a, b] = names(2); const da = pick([20, 24, 30]), db = pick([10, 12, 15]), tb = pick([30, 40, 45]); const sa = da, sb = (db * 60) / tb; return pickOne(`${a} cycles ${da} km in 1 hour. ${b} cycles ${db} km in ${tb} minutes. Who is faster?`, [a, b, "Same speed"], sa > sb ? a : sb > sa ? b : "Same speed"); },
  () => { const [a, b] = names(2); const r = [ri(2, 7), ri(1, 6)]; const unit = ri(3, 12); const total = (r[0] + r[1]) * unit; return num(`${a} and ${b} share $${total} in the ratio ${r[0]} : ${r[1]}. ${b} gets $___.`, r[1] * unit); },
  () => { const n = pick([1, 2, 3]), d = pick([3, 4, 5]), k = pick([2, 3, 4]); const g = gcd(n, d * k); return num(`${n}/${d} ÷ ${k} = ${n / g}/___.`, (d * k) / g); },
  () => { const L = pick([2, 3, 4, 5]), p = pick([25, 50, 75]); const have = (L * p) / 100; const mark = have + pick([-0.5, 0.5]); return pickOne(`A ${L}-litre bottle is ${p}% full. Is there more or less than ${mark} litres?`, ["More", "Less"], have > mark ? "More" : "Less"); },
  () => { const a = ri(2, 9), x = ri(2, 9), k = ri(1, 20); return num(`${a}x + ${k} = ${a * x + k}. What is x?`, x); },
  () => { const w = pick([25, 40, 50]), l = w * pick([2, 3]); return num(`A rectangle's length is ${l / w} times its width. The width is ${w} cm. The perimeter is ___ cm.`, 2 * (l + w)); },
  () => { const total = pick([120, 150, 200, 240]); const pa = pick([30, 40, 50]); const pb = pick([20, 25, 30]); return num(`Of ${total} pupils, ${pa}% chose art and ${pb}% chose music. The rest chose drama. How many chose drama?`, total - (total * (pa + pb)) / 100); },
  about, faster, ordering,
];

// ====================================================================
// LEVEL F  (PSLE heuristics): guess & check · before–after · remainder branches · supposition · unitary · patterns · age · meeting speed
// ====================================================================
const F = [
  () => { const cows = ri(3, 12), hens = ri(4, 15); return num(`On a farm, chickens and cows have ${cows + hens} heads and ${cows * 4 + hens * 2} legs altogether. How many cows?`, cows); },
  () => { const [a, b] = names(2); const k = pick([3, 5]); const bb = ri(5, 30) * 2; const g = (bb * (k - 1)) / 2; return num(`${a} has ${k} times as many stickers as ${b}. After ${a} gives ${b} ${g} stickers, they have the same number. How many did ${a} have at first?`, k * bb); },
  () => { const [a] = names(1); const R = ri(5, 40); return pick([num(`${a} spent 1/3 of her money on a book, then 1/2 of the remainder on a pen. She had $${R} left. How much did she have at first?`, 3 * R), num(`${a} spent 1/4 of his money, then 1/3 of what was left. He had $${R * 2} left. How much at first?`, 4 * R)]); },
  () => { const P = pick([50, 100, 200]), up = pick([10, 20, 25, 50]), down = pick([10, 20, 25]); const final = P * (1 + up / 100) * (1 - down / 100); return dec(`A $${P} item is marked up ${up}%, then sold at ${down}% off the new price. The final price is $___.`, final); },
  () => { const avg = ri(10, 30), n = pick([3, 4, 5]); const next = avg + (n + 1) * pick([1, 2, 3]); return num(`The average of ${n} numbers is ${avg}. A number ${next} is added. The new average is ___.`, (avg * n + next) / (n + 1)); },
  () => { const [a] = names(1); const m = ri(6, 12), y = pick([3, 4, 5, 6]), k = pick([3, 4]); const d = (k - 1) * (m + y) - y; return num(`Mum is ${d} years older than ${a}. In ${y} years Mum will be ${k} times as old as ${a}. How old is ${a} now?`, m); },
  () => { const s1 = pick([40, 50, 60]), s2 = pick([30, 40, 70]); const h = ri(2, 4); return num(`Two towns are ${(s1 + s2) * h} km apart. A car leaves one at ${s1} km/h and a van leaves the other at ${s2} km/h, driving toward each other. They meet after ___ hours.`, h); },
  () => { const n = ri(6, 15), each = ri(2, 9), m = ri(2, n - 1); return num(`${n} identical books cost $${n * each}. How much do ${m} books cost?`, m * each); },
  () => { const a = ri(1, 9), d = ri(2, 6), n = pick([10, 15, 20, 25]); return num(`A pattern goes ${a}, ${a + d}, ${a + 2 * d}, ${a + 3 * d}, … What is the ${n}th number?`, a + (n - 1) * d); },
  () => { const [a, b] = names(2); const bb = ri(10, 60), d = ri(4, 30) * 2; return num(`${a} and ${b} have ${2 * bb + d} marbles altogether. ${a} has ${d} more than ${b}. How many does ${b} have?`, bb); },
  () => { const f1 = pick([[5, 8], [7, 12], [3, 5], [4, 7]]), f2 = pick([[2, 3], [5, 9], [7, 11], [1, 2]]); const v1 = f1[0] / f1[1], v2 = f2[0] / f2[1]; return pickOne(`Which fraction is larger — ${f1[0]}/${f1[1]} or ${f2[0]}/${f2[1]}?`, [`${f1[0]}/${f1[1]}`, `${f2[0]}/${f2[1]}`], v1 > v2 ? `${f1[0]}/${f1[1]}` : `${f2[0]}/${f2[1]}`); },
  () => { const taps = pick([2, 3, 4]), hours = pick([6, 8, 12]); const more = taps + pick([1, 2, 3]); const t = (taps * hours) / more; return Number.isInteger(t) ? num(`${taps} taps fill a tank in ${hours} hours. How many hours would ${more} such taps take?`, t) : num(`${taps} taps fill a tank in ${hours} hours. How many hours would ${taps * 2} such taps take?`, hours / 2); },
  () => { const [a, b] = names(2); const before = [ri(2, 5), 1]; const give = ri(4, 20); const unit = give * 2; return num(`${a} had ${before[0]} times as much money as ${b}. After ${a} spent $${give * (before[0] - 1)}, they had the same amount. How much did ${b} have?`, give); },
  () => { const total = pick([120, 180, 240, 300]); const pa = pick([20, 25, 40]); const rest = total - (total * pa) / 100; const half = rest / 2; return Number.isInteger(half) ? num(`${pa}% of ${total} apples are red. Half of the rest are green and the others yellow. How many are yellow?`, half) : num(`${pa}% of ${total} apples are red. How many are not red?`, rest); },
  () => { const s = pick([60, 72, 80, 90]); const stop = pick([15, 20, 30]); const d = s * 2; return num(`A bus travels ${d} km at ${s} km/h, stopping for ${stop} minutes on the way. The whole trip takes ___ minutes.`, 120 + stop); },
  about, faster,
];

// generators drop `null` from a template that couldn't build a clean instance — retry another
const GENS = [A, B, C, D, E, F];
export function genNavigator(levelIdx, tier) {
  const pool = GENS[Math.min(levelIdx, GENS.length - 1)];
  for (let i = 0; i < 40; i++) {
    const g = pick(pool);
    try { const out = g(tier); if (out && out.display && out.answer && (out.answer.type !== "int" || Number.isInteger(out.answer.v))) return out; } catch (e) {}
  }
  return num("What is 10 less than 100?", 90);
}

// per-question seconds for Navigator: reading time on top of the level's base, +5s per tier
export const navSecondsFor = (levelIdx, tier, mult) => Math.round((50 + levelIdx * 5 + (tier - 1) * 5) * mult);

export const NAV_TOPICS = [
  { title: "Sector A · Navigator", lines: ["Numbers to 1,000 — more than, less than, fill the blank.", "Easy multiplication in stories: rows of eggs, bags of sweets, legs on animals — 2s, 3s, 5s and 10s. No dividing yet.", "Halves and quarters. Metres and centimetres, kilograms, litres, dollars and cents.", "Which is heavier, longer, holds more, takes longer — think about the real thing."] },
  { title: "Sector B · Navigator", lines: ["Numbers to 10,000. Tables 6, 7, 8, 9 in two-step stories.", "Equivalent fractions. Perimeter of rectangles and squares.", "Kilometres and millilitres. The 24-hour clock. Reading a graph in words.", "Times as many, how many more, order who is tallest."] },
  { title: "Sector C · Navigator", lines: ["Numbers to 100,000. Factors and multiples.", "Decimals: money and measures with a decimal point (there's a . key).", "Area of squares and rectangles. Angles bigger or smaller than a right angle.", "Time across the hour. Multi-step money."] },
  { title: "Sector D · Navigator", lines: ["Percentages of a number. Ratio. Average.", "Rate — litres per minute, km per hour. Volume of a box.", "Fraction of a set. Discounts: more or less than?", "Area of a triangle."] },
  { title: "Sector E · Navigator", lines: ["Speed, distance and time. Simple algebra with n and x.", "Percentage increase and decrease. Pie charts in words.", "Work backwards from what's left. Circles with π = 22/7.", "Sharing in a ratio. Dividing fractions."] },
  { title: "Sector F · Navigator", lines: ["PSLE heuristics: guess and check, before–after, remainders, supposition.", "Chickens and cows. Ages in the future. Meeting in the middle.", "Unitary method, number patterns, averages that change.", "Read twice. Draw the model in your head. Then answer."] },
];
