// 🇸🇬 SINGAPORE — the Singapore-standard word problems that were 🧭 Navigator from v3.0 until 19 Sep 2026, kept whole as the
// core of Olympia's SG-Moon (modelled on SIMCC's Singapore Math Challenge: the MOE syllabus plus its heuristics). The owner
// found them too hard for a Year 1 or 2 child as the second live track — fractions by Sector B, measures and time — so
// Navigator now tells Engine's own numbers in words (navigator.mjs) and this track waits for the moon that fits it.
// Six pools, one per Engine sector; inside a level, tier 1–5 widens the numbers.
//
// A question: { display: { layout: "word", text, choices?, figure? }, answer: { type: "int"|"dec"|"choice", v }, read }
//   int    → keypad, whole number
//   dec    → keypad with a "." key, compared to 2 dp
//   choice → tap one of `choices`; v is the index of the right one. Never fewer than four: two is a coin flip.
// `figure` is a graph the client draws — bars, pie, table or line (see fig() for the shape). A question with a
// figure must be answerable from the figure alone, and its `read` keeps the numbers in the sentence for the 🔊 button.

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

// Four facts whose order is beyond argument — every step at least `ratio` times the next — so a ranking
// question has one answer and no child can argue for another. The four come from a window of the table
// (every table is written smallest first): drawing from the whole of a short table would put the ant and
// the elephant in almost every question, and then "which is the smallest" always has the same answer.
const farFour = (table, ratio = 3, each = (f) => f) => {
  for (let t = 0; t < 60; t++) {
    const lo = ri(0, table.length - 4), hi = ri(lo + 3, table.length - 1);
    const four = shuffle(table.slice(lo, hi + 1)).slice(0, 4).map(each), desc = [...four].sort((a, b) => b[1] - a[1]);
    if (desc.every((f, i) => i === 0 || desc[i - 1][1] >= f[1] * ratio)) return four;
  }
  const n = table.length; return [0, n >> 2, n >> 1, n - 1].map((i) => table[i]); // spread across the table: far apart whatever the draw
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const orList = (xs) => `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`;

const q = (text, answer, choices, read) => ({ display: { layout: "word", text, choices: choices || null }, answer, read: read || text });
const num = (text, v, read) => q(text, { type: "int", v }, null, read);
const dec = (text, v, read) => q(text, { type: "dec", v: Math.round(v * 100) / 100 }, null, read);
const choice = (text, options, correct, read) => q(text, { type: "choice", v: correct }, options, read);
// a choice question whose options are shuffled — pass the right answer as a string
const pickOne = (text, options, right, read) => { const o = shuffle(options); return choice(text, o, o.indexOf(right), read); };
// hang a graph on a question. The client draws one of:
//   { kind: "bars",  title, unit, bars:   [{ label, value }] }      3–6 bars,   whole values
//   { kind: "pie",   title,       slices: [{ label, pct }] }        2–5 slices, whole percents adding to 100
//   { kind: "table", title, head: [...],  rows: [{ cells: [...] }] } 2–4 columns, 2–6 rows (a row is an object: Firestore refuses an array inside an array)
//   { kind: "line",  title, unit, points: [{ label, value }] }      3–6 points, whole values
const fig = (question, figure) => ({ ...question, display: { ...question.display, figure } });

// ---- shared comparison templates, scaled by level ----
const manyOf = (n, name) => { const s = name.replace(/^an? /, ""); return `${n} ${s.includes(" of ") ? s.replace(/^(\w+) of/, "$1s of") : s + "s"}`; };
const ORDINAL = ["", "second ", "third "];
// Rank four things by a real-world value. The four things are the options, so the question itself stays
// short; the fourth place is never asked for, because that is the other end's first.
const rank = (table, ask, each) => {
  const four = farFour(table, 3, each), desc = [...four].sort((a, b) => b[1] - a[1]);
  const k = ri(0, 2), top = Math.random() < 0.5, text = ask(ORDINAL[k], top);
  // the options are the only place the four things are named, so speech gets them in the sentence instead
  return pickOne(text, four.map((f) => cap(f[0])), cap((top ? desc[k] : desc[3 - k])[0]), `${text.slice(0, -1)} — ${orList(four.map((f) => f[0]))}?`);
};
const someOf = (f) => { const n = pick([1, 1, 1, 2, 3, 5, 10]); return n === 1 ? f : [manyOf(n, f[0]), f[1] * n]; };
const heavier = () => rank(MASS_G, (o, top) => `Which is the ${o}${top ? "heaviest" : "lightest"}?`, someOf);
const longer = () => rank(LEN_CM, (o, top) => `Which is the ${o}${top ? "longest" : "shortest"}?`);
const holdsMore = () => rank(CAP_ML, (o, top) => `Which holds the ${o}${top ? "most" : "least"} water?`);
const takesLonger = () => rank(TIME_MIN, (o, top) => `Which takes the ${o}${top ? "longest" : "shortest"} time?`);
const faster = () => rank(SPEED_KMH, (o, top) => `Which is the ${o}${top ? "fastest" : "slowest"}?`);
// "about how much" — the true value in a sensible unit
const fmtMass = (g) => (g >= 1000 ? `${Math.round(g / 1000)} kg` : g >= 1 ? `${Math.round(g)} g` : `${g} g`);
const fmtLen = (cm) => (cm >= 100000 ? `${Math.round(cm / 100000)} km` : cm >= 100 ? `${Math.round(cm / 100)} m` : `${cm} cm`);
const fmtCap = (ml) => (ml >= 1000 ? `${Math.round(ml / 1000)} L` : `${ml} ml`);
// Asked the other way round — the size is given and the four things are the options — so the answer moves
// with the number instead of being a fact a child can memorise per object. 4× apart: "about" is a fuzzy word.
const about = (kind) => {
  const k = ["m", "l", "c"].includes(kind) ? kind : pick(["m", "l", "c"]); // listed bare in a level it is handed the tier, which means "any kind"
  const [table, f, ask] = k === "m" ? [MASS_G.slice(2, 10), fmtMass, (v) => `Which of these weighs about ${v}?`]
    : k === "l" ? [LEN_CM.slice(1, 7), fmtLen, (v) => `Which of these is about ${v} long?`]
      : [CAP_ML.slice(0, 5), fmtCap, (v) => `Which of these holds about ${v}?`]; // the teaspoon is in: without it, millilitres could only ever mean the cup
  const four = farFour(table, 4), right = pick(four), text = ask(f(right[1]));
  return pickOne(text, four.map((x) => cap(x[0])), cap(right[0]), `${text.slice(0, -1)} — ${orList(four.map((x) => x[0]))}?`);
};
const ordering = () => {
  const w = names(4); const attr = pick([["taller", "tallest", "shortest"], ["older", "oldest", "youngest"], ["faster", "fastest", "slowest"]]);
  const k = ri(0, 1), top = Math.random() < 0.5; // a chain of three comparisons puts all four in order
  return pickOne(`${w[0]} is ${attr[0]} than ${w[1]}. ${w[1]} is ${attr[0]} than ${w[2]}. ${w[2]} is ${attr[0]} than ${w[3]}. Who is the ${ORDINAL[k]}${top ? attr[1] : attr[2]}?`,
    w, top ? w[k] : w[3 - k]);
};

// ---- legs: single kind at A (small counts), two kinds at once from B ----
const LEGS = [["spider", 8], ["dog", 4], ["bird", 2], ["ant", 6], ["cat", 4], ["chicken", 2], ["beetle", 6]];
const twoLegs = (lo, hi, where) => { const [[a, la], [b, lb]] = shuffle(LEGS).slice(0, 2); const na = ri(lo, hi), nb = ri(lo, hi); return num(`${where} ${na} ${a}s and ${nb} ${b}s. How many legs altogether?`, na * la + nb * lb); };

// ---- fractions: halves & quarters first · thirds from tier 3 · eighths & tenths from tier 4 (paper 61 on) ----
const FRAC_DENS = (t) => (t >= 4 ? [2, 3, 4, 8, 10] : t >= 3 ? [2, 3, 4] : [2, 4]);
const FRAC_NAME = { 2: "half", 3: "third", 4: "quarter", 8: "eighth", 10: "tenth" };
const fracOf = (d) => (d === 2 ? "Half" : d === 8 ? "An eighth" : `A ${FRAC_NAME[d]}`);
const fracA = (t) => {
  const dens = FRAC_DENS(t);
  const kind = ri(1, 4);
  if (kind === 1) { // which is bigger, worked out as four amounts — at tier 1 there are only two denominators to put side by side
    const parts = shuffle([2, 3, 4, 5, 6]).slice(0, 4).map((v) => { const d = pick(dens); return [`${fracOf(d)} of ${v * d}`, v]; });
    const big = Math.random() < 0.5, want = parts.reduce((a, b) => ((b[1] > a[1]) === big ? b : a));
    const text = `Which is ${big ? "the biggest" : "the smallest"}?`;
    return pickOne(text, parts.map((p) => p[0]), want[0], `${text.slice(0, -1)} — ${orList(parts.map((p) => p[0].toLowerCase()))}?`);
  }
  if (kind === 2) { // fraction of a set
    const d = pick(dens); const n = d * ri(2, t >= 4 ? 6 : 5); const it = pick(ITEMS);
    return num(`${fracOf(d)} of ${n} ${it}s is ___.`, n / d);
  }
  if (kind === 3) { // how many make a whole / a half
    const d = pick(dens.filter((x) => x !== 2)); const half = d % 2 === 0 && Math.random() < 0.5;
    return num(`How many ${FRAC_NAME[d]}s make ${half ? "a half" : "one whole"}?`, half ? d / 2 : d);
  }
  const d = pick(dens.filter((x) => x > 2)); const k = ri(1, d - 1); const right = `${d - k}/${d}`; // what fraction is left
  // near misses: the part eaten, a piece out either way, and the bottom doubled or two too many — every one still a real fraction
  const decoys = [...new Set([`${k}/${d}`, `${d - k + 1}/${d}`, `${d - k - 1}/${d}`, `${d - k}/${d * 2}`, `${k}/${d * 2}`, `${d - k}/${d + 2}`])]
    .filter((x) => { const [n, den] = x.split("/").map(Number); return x !== right && n >= 1 && n < den; }).slice(0, 3);
  return decoys.length < 3 ? null
    : pickOne(`A ${pick(["cake", "pizza"])} is cut into ${d} equal pieces. ${k} ${k === 1 ? "piece is" : "pieces are"} eaten. What fraction is left?`, [right, ...decoys], right);
};

// ---- trip times: same hour → across the hour → over an hour → 24-hour clock with hours AND minutes (tier 4–5) ----
const VEHICLES = ["train", "bus", "ferry", "MRT train"];
const hm = (h, m) => `${h}:${String(m).padStart(2, "0")}`;
const trip = (t) => {
  const v = pick(VEHICLES);
  if (t <= 1) { const h = ri(1, 11), m1 = pick([0, 5, 10, 15, 20, 25]), d = pick([5, 10, 15, 20, 25, 30]); return num(`The ${v} leaves at ${hm(h, m1)} and arrives at ${hm(h, m1 + d)}. The ride took ___ minutes.`, d); }
  if (t === 2) { const h = ri(1, 10), m1 = ri(4, 11) * 5, d = ri(3, 11) * 5, end = h * 60 + m1 + d; return num(`The ${v} leaves at ${hm(h, m1)} and arrives at ${hm(Math.floor(end / 60), end % 60)}. The ride took ___ minutes.`, d); }
  if (t === 3) { const h = ri(1, 9), m1 = ri(0, 11) * 5, d = ri(7, 24) * 5, end = h * 60 + m1 + d; return num(`The ${v} leaves at ${hm(h, m1)} and arrives at ${hm(Math.floor(end / 60), end % 60)}. The ride took ___ minutes.`, d); }
  const h = ri(6, 16), m1 = ri(0, 11) * 5, dh = ri(1, t >= 5 ? 6 : 4), dm = ri(1, 11) * 5, end = h * 60 + m1 + dh * 60 + dm;
  const text = `The ${v} leaves at ${hm(h, m1)} and arrives at ${hm(Math.floor(end / 60), end % 60)}.`;
  return pick([num(`${text} The trip took ${plural(dh, "hour")} and ___ minutes.`, dm), num(`${text} The trip took ___ hours and ${dm} minutes.`, dh)]);
};

// ====================================================================
// LEVEL A  (≈ P2): to 1,000 · 2-step add/sub · small × only (2,3,5,10 — NO division) · ½ ¼ · m/cm · kg/g · L · $ · time to 5 min
// ====================================================================
const A = [
  (t) => { const n = ri(10, 100 * t); const k = ri(1, 9 + t * 2); return pick([num(`___ is ${k} less than ${n}.`, n - k), num(`___ is ${k} more than ${n}.`, n + k), num(`${k} more than ${n} is ___.`, n + k)]); },
  (t) => { const n = ri(100, 200 + 150 * t); const k = pick([10, 20, 30, 50, 100]); return num(`___ is ${k} more than ${n}.`, n + k); },
  // multiplication only, and small: rows × 2/3/5/10 — no division at Sector A (that starts at B)
  (t) => { const r = ri(Math.min(4, 1 + t), Math.min(5, 2 + t)), c = pick([2, 3, 5, 10]); return num(`A box has ${r} rows of ${c} eggs. How many eggs altogether?`, r * c); },
  (t) => { const [a] = names(1); const k = ri(Math.min(4, 1 + t), Math.min(5, 2 + t)), each = pick(t >= 3 ? [2, 3, 5, 10] : [2, 3, 5]); return num(`${a} has ${k} bags with ${each} sweets in each bag. How many sweets altogether?`, k * each); },
  (t) => { const [a] = names(1); const had = ri(10, 15 + 10 * t), spent = ri(3, had - 4), found = ri(1, 9); return num(`${a} had $${had}. ${a} spent $${spent}, then found $${found}. How much does ${a} have now?`, had - spent + found); },
  (t) => { const m = ri(1, 1 + Math.floor(t / 2)), cut = ri(15, 85); return num(`A rope is ${m} m long. ${cut} cm is cut off. How many cm are left?`, m * 100 - cut); },
  fracA, fracA,
  trip, trip,
  ordering,
  heavier, longer, holdsMore, takesLonger,
  () => about("m"), // kilograms and grams at A; the other measures come with about() from Sector B
  (t) => { const [a, b] = names(2); const it = pick(ITEMS); const d = ri(2, 9), x = ri(d + 3, 20 + 10 * t); return pick([num(`${a} has ${x} ${it}s. ${b} has ${d} fewer. How many does ${b} have?`, x - d), num(`${a} has ${x} ${it}s, ${d} more than ${b}. How many does ${b} have?`, x - d), num(`${a} has ${x} ${it}s. ${b} has ${x + d}. How many more does ${b} have?`, d)]); },
  (t) => { const total = ri(20, 40 + 20 * t), gone = ri(5, total - 5), more = ri(2, 12); return num(`${total} birds sit on a wire. ${gone} fly away, then ${more} come back. How many birds now?`, total - gone + more); },
  // legs: counts grow with the tier (2–3 at first, up to 6 spiders = 48 legs by paper 61); two kinds at once only at tier 5, kept small
  (t) => { const n = ri(t >= 4 ? 3 : 2, t >= 4 ? 6 : t >= 3 ? 5 : t >= 2 ? 4 : 3); const [what, legs] = pick(LEGS); return num(`A ${what} has ${legs} legs. How many legs do ${n} ${what}s have?`, legs * n); },
  (t) => (t >= 5 ? twoLegs(2, 3, "In the garden there are") : null),
  () => { const d = ri(1, 9); const c = ri(1, 9) * 10; return dec(`${d} dollars and ${c} cents is $___.`, d + c / 100); },
];

// ====================================================================
// LEVEL B  (≈ P3): to 10,000 · tables 6–9 · 2-step with × · equivalent fractions · perimeter · km/ml · 24-h time · graphs
// ====================================================================
const B = [
  (t) => { const a = ri(2, 9), b = ri(6, 9); return pick([num(`___ × ${b} = ${a * b}.`, a), num(`${a * b} ÷ ${b} = ___.`, a), num(`${a} × ___ = ${a * b}.`, b)]); },
  (t) => { const boxes = ri(3, 5 + t), per = ri(6, 9), broken = ri(2, 12); return num(`A shop gets ${boxes} boxes of ${per} pens. ${broken} pens are broken. How many good pens?`, boxes * per - broken); },
  (t) => { const k = pick([2, 3, 4, 5, 6]); const each = ri(2, 5 + t); const [a] = names(1); return num(`${a} shares ${k * each} sweets equally among ${k} friends. Each friend gets ___.`, each); },
  // fractions at B: find the equivalent one, or put four with the same top or the same bottom in order
  () => { const kind = ri(1, 3);
    if (kind === 1) { const d = pick([2, 3, 4, 5, 8, 10]), k = pick([2, 3]), same = `${k}/${d * k}`; // only the first is worth 1/d — a slip in the top or the bottom is not
      return pickOne(`Which fraction is the same as 1/${d}?`, [same, `${k + 1}/${d * k}`, `${k}/${d * k + 1}`, `${k - 1}/${d * k}`], same); }
    const top = kind === 2, n = top ? pick([1, 2, 3]) : pick([5, 8, 10, 12]);
    const parts = shuffle(top ? [2, 3, 4, 5, 6, 8, 10, 12].filter((x) => x > n) : [1, 2, 3, 4, 5, 6, 7].filter((x) => x < n)).slice(0, 4);
    const big = Math.random() < 0.5, want = top === big ? Math.min(...parts) : Math.max(...parts); // same top: the bigger the bottom, the smaller the piece
    const text = `Which fraction is the ${big ? "biggest" : "smallest"}?`, opts = parts.map((x) => (top ? `${n}/${x}` : `${x}/${n}`));
    return pickOne(text, opts, top ? `${n}/${want}` : `${want}/${n}`, `${text.slice(0, -1)} — ${orList(opts)}?`); },
  (t) => twoLegs(3, 5 + t, pick(["There are", "In a pet shop there are", "On a leaf there are"])),
  (t) => trip(t >= 3 ? 5 : 4),
  (t) => { const l = ri(3, 10 + t * 2), w = ri(2, l - 1); return pick([num(`A rectangle is ${l} cm long and ${w} cm wide. Its perimeter is ___ cm.`, 2 * (l + w)), num(`A square has sides of ${l} cm. Its perimeter is ___ cm.`, 4 * l)]); },
  // the big units at B, with the three ways a zero goes missing or turns up as the wrong answers
  () => { const v = ri(2, 9), km = Math.random() < 0.5, u = km ? "m" : "ml";
    return pickOne(`${v} ${km ? "km" : "L"} is the same as how many ${km ? "metres" : "millilitres"}?`, [v * 1000, v * 100, v * 10, v * 10000].map((x) => `${x} ${u}`), `${v * 1000} ${u}`); },
  (t) => { const each = pick([100, 150, 200, 250]); const start = pick([1000, 1500, 2000]); const cups = ri(2, Math.min(4 + Math.floor(t / 2), Math.floor(start / each) - 1)); return num(`A bottle holds ${start} ml. After pouring ${cups} cups of ${each} ml, ___ ml are left.`, start - cups * each); },
  () => { const h = ri(13, 23); return num(`${h}:00 on a 24-hour clock is ___ o'clock in the afternoon or evening.`, h - 12); },
  (t) => { const [a, b] = names(2); const it = pick(ITEMS); const k = ri(2, 4), x = ri(4, 10 + 3 * t); return pick([num(`${a} has ${k} times as many ${it}s as ${b}. ${b} has ${x}. Together they have ___.`, k * x + x), num(`${a} has ${k} times as many ${it}s as ${b}. ${b} has ${x}. ${a} has ___ more than ${b}.`, k * x - x)]); },
  () => { const n = pick([4, 5, 6]), c = n * pick([1, 2]); return pickOne(`${n} pencils cost $${c}. How much do ${n * 2} pencils cost?`, [`$${c * 2}`, `$${c}`, `$${c * 3}`, `$${c * 4}`], `$${c * 2}`); },
  // a real bar chart: the numbers are in the picture, so the sentence only asks — the 🔊 line still reads them out
  (t) => { const days = ["Mon", "Tue", "Wed", "Thu", "Fri"], full = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], step = 6 + t;
    const v = shuffle([0, 1, 2, 3, 4]).map((k) => 8 + ri(0, 4) + k * step); // five bar heights nobody has to squint at, and no two the same
    const [i, j] = shuffle([0, 1, 2, 3, 4]).slice(0, 2).sort((a, b) => v[b] - v[a]);
    return fig(num(`How many more people came on ${days[i]} than on ${days[j]}?`, v[i] - v[j],
      `A graph shows visitors: ${full.map((d, k) => `${d} ${v[k]}`).join(", ")}. How many more people came on ${full[i]} than on ${full[j]}?`),
    { kind: "bars", title: "Visitors this week", unit: "people", bars: days.map((label, k) => ({ label, value: v[k] })) }); },
  // a real table, read row by row
  () => { const who = names(4), v = shuffle([3, 5, 6, 8, 9, 11, 12, 15]).slice(0, 4), most = Math.random() < 0.5;
    const text = `Who read the ${most ? "most" : "fewest"} books?`;
    return fig(pickOne(text, who, who[v.indexOf(most ? Math.max(...v) : Math.min(...v))],
      `A table shows books read: ${who.map((n, i) => `${n} ${v[i]}`).join(", ")}. ${text}`),
    { kind: "table", title: "Books read this month", head: ["Name", "Books"], rows: who.map((n, i) => ({ cells: [n, String(v[i])] })) }); },
  (t) => { const n = ri(100, 900 + 900 * t); const k = pick([100, 200, 500, 1000]); return num(`___ is ${k} more than ${n}.`, n + k); },
  (t) => { const [a] = names(1); const c = ri(6, 9), rows = ri(3, 6 + t), left = ri(1, c - 1); return num(`${a} plants ${rows} rows of ${c} seeds and has ${left} seeds left over. How many seeds did ${a} start with?`, rows * c + left); },
  ordering, heavier, longer, about, takesLonger,
  // order who is tallest: four heights given, one place asked for
  () => { const who = names(4), base = ri(105, 125), hs = shuffle([0, 5, 9, 14]).map((d) => base + d), order = [...hs].sort((a, b) => b - a);
    const k = ri(0, 1), top = Math.random() < 0.5;
    return pickOne(`${who.map((n, i) => `${n} is ${hs[i]} cm tall`).join(". ")}. Who is the ${ORDINAL[k]}${top ? "tallest" : "shortest"}?`,
      who, who[hs.indexOf(top ? order[k] : order[3 - k])]); },
];

// ====================================================================
// LEVEL C  (≈ P4): to 100,000 · factors & multiples · decimals · multi-step money · angles · area · time across hours
// ====================================================================
const C = [
  (t) => { const a = ri(1, 9) + pick([0.25, 0.5, 0.75]); const k = pick([0.5, 0.25, 1.5, 0.75]); return dec(`___ is ${k} more than ${a}.`, a + k); },
  // one multiple among three numbers a step or three away — a step that small can never land on a multiple of 6 to 9 too
  () => { const b = pick([6, 7, 8, 9]), right = b * ri(2, 9), near = shuffle([1, 2, 3, -1, -2, -3]).slice(0, 3);
    return pickOne(`Which of these is a multiple of ${b}?`, [right, ...near.map((o) => right + o)].map(String), String(right)); },
  (t) => { const s = ri(4, 9 + t * 2), w = ri(2, s - 1); return pick([num(`A square field has sides of ${s} m. Its area is ___ m².`, s * s), num(`A rectangle is ${s} m long and ${w} m wide. Its area is ___ m².`, s * w)]); },
  () => { const n = ri(2, 5), each = ri(300, 1500); return dec(`${n} shirts cost ${money(n * each)}. One shirt costs $___.`, each / 100); },
  () => { const kind = ri(1, 3), deg = (a) => `${a}°`;
    if (kind === 3) { const near = pick([80, 85, 95, 100]), far = shuffle([20, 30, 45, 135, 150, 170]).slice(0, 3); // 10° out at most against 45° out at least
      return pickOne("Which angle is closest to a right angle?", [near, ...far].map(deg), deg(near)); }
    const up = kind === 1, one = pick(up ? [100, 120, 135, 150, 170] : [20, 30, 45, 60, 80]), three = shuffle(up ? [20, 30, 45, 60, 80] : [100, 120, 135, 150, 170]).slice(0, 3);
    return pickOne(`A right angle is 90°. Which angle is ${up ? "bigger" : "smaller"} than a right angle?`, [one, ...three].map(deg), deg(one)); },
  (t) => { const seats = pick([40, 45, 50]), buses = ri(2, 3 + Math.floor(t / 2)), pupils = ri(seats * buses - 40, seats * buses - 5); return num(`A bus has ${seats} seats. ${buses} buses take ${pupils} pupils. How many seats are empty?`, seats * buses - pupils); },
  // every option a different distance away in tenths, so "closest" has one answer and no argument
  () => { const w = ri(2, 8), near = pick([1, -1, 2, -2]), offs = shuffle([near, ...shuffle([-4, 5, -7, 9]).slice(0, 3)]);
    return pickOne(`Which number is closest to ${w}?`, offs.map((o) => (w + o / 10).toFixed(1)), (w + near / 10).toFixed(1)); },
  (t) => { const [a] = names(1); const wk = ri(3, 6), each = ri(500, 1500), spent = ri(500, wk * each - 300); return dec(`${a} saved ${money(each)} every week for ${wk} weeks, then spent ${money(spent)}. ${a} has $___ left.`, (wk * each - spent) / 100); },
  // the wrong ends are the three slips: an hour too many, an hour too few, and the minutes forgotten
  () => { const h = ri(16, 19), m = pick([10, 20, 40, 50]), dh = ri(1, 2), dm = pick([15, 25, 35, 45]), end = h * 60 + m + dh * 60 + dm, at = (x) => hm(Math.floor(x / 60), x % 60); // late enough to be an evening film, early enough that an hour too many is still a clock time
    return pickOne(`A film starts at ${hm(h, m)} and lasts ${dh} h ${dm} min. What time does it end?`, [end, end + 60, end - 60, end - dm].map(at), at(end)); },
  () => { const a = pick([4, 6, 8]), b = pick([6, 9, 10, 12]); if (a === b) return num(`The smallest number that is a multiple of both 3 and 5 is ___.`, 15); const l = (a * b) / gcd(a, b); return num(`The smallest number that is a multiple of both ${a} and ${b} is ___.`, l); },
  (t) => { const k = pick([1000, 2000, 5000]); const n = ri(k + 500, 9000 + 9000 * t); return num(`___ is ${k} less than ${n}.`, n - k); },
  () => { const [a, b] = names(2); const x = ri(2, 9) + pick([0.2, 0.4, 0.5, 0.6, 0.8]); const y = pick([1.5, 2.5, 0.75, 1.25]); return dec(`${a} runs ${x} km. ${b} runs ${y} km more. How far does ${b} run, in km?`, x + y); },
  // build the number from its factor, then take three that divide it with something left over
  () => { const right = pick([3, 4, 5, 6, 7, 8, 9]), n = right * ri(2, 9), no = shuffle([2, 3, 4, 5, 6, 7, 8, 9]).filter((x) => n % x).slice(0, 3);
    return no.length < 3 ? null : pickOne(`Which of these is a factor of ${n}?`, [right, ...no].map(String), String(right)); },
  // a real price list: the bill can only be worked out from the table
  () => { const items = shuffle([["Pencil", 60], ["Ruler", 120], ["Eraser", 45], ["Glue", 150], ["Notebook", 210], ["Marker", 175]]).slice(0, 4);
    const [a] = names(1), [x, y] = items, k = ri(2, 4), text = `${a} buys ${k} ${x[0].toLowerCase()}s and one ${y[0].toLowerCase()}. The bill is $___.`;
    return fig(dec(text, (k * x[1] + y[1]) / 100, `A price list shows ${items.map((i) => `${i[0]} ${money(i[1])}`).join(", ")}. ${text}`),
      { kind: "table", title: "Price list", head: ["Item", "Price"], rows: items.map((i) => ({ cells: [i[0], money(i[1])] })) }); },
  heavier, about, faster, ordering,
  (t) => twoLegs(6, 10 + 2 * t, pick(["A farm has", "In the zoo there are"])),
  () => { const [what, legs] = pick(LEGS.filter((x) => x[1] >= 4)); const n = ri(6, 12); return num(`Some ${what}s have ${legs * n} legs altogether. How many ${what}s are there?`, n); },
  (t) => { const n = ri(2, 4), per = ri(15, 30 + 5 * t), cars = ri(5, 25); return num(`${cars + n * per} pupils go on a trip. ${cars} ride in cars and the rest fill ${n} equal buses. How many pupils on each bus?`, per); },
];

// ====================================================================
// LEVEL D  (≈ P5): percentage · ratio · average · rate · volume · fraction of a set · discount
// ====================================================================
const D = [
  () => { const p = pick([10, 20, 25, 50, 75]), n = pick([40, 60, 80, 120, 200, 300]); return num(`${p}% of ${n} is ___.`, (p * n) / 100); },
  (t) => { const a = ri(2, 5); let b = ri(1, 4); if (b === a) b = a + 1; const k = ri(3, 5 + t); return num(`Boys to girls in a class is ${a} : ${b}. There are ${a * k} boys. How many girls?`, b * k); },
  () => { let x; do { x = [ri(5, 30), ri(5, 30), ri(5, 30)]; } while ((x[0] + x[1] + x[2]) % 3 !== 0); return num(`The average of ${x[0]}, ${x[1]} and ${x[2]} is ___.`, (x[0] + x[1] + x[2]) / 3); },
  () => { const rate = pick([4, 5, 8, 10]), tank = rate * ri(6, 12), k = tank / rate; // the last one is the tank take away the rate: subtracting instead of dividing
    return pickOne(`A tap fills ${rate} litres a minute. How long to fill a ${tank}-litre tank?`, [k, k + 2, k - 2, tank - rate].map((x) => `${x} min`), `${k} min`); },
  (t) => { const l = ri(4, 10 + t), w = ri(2, 6), h = ri(2, 5); return num(`A box is ${l} cm × ${w} cm × ${h} cm. Its volume is ___ cm³.`, l * w * h); },
  () => { const f = pick([[1, 2], [1, 4], [3, 4], [2, 3], [1, 3], [3, 5]]); const n = f[1] * ri(4, 12); return num(`${f[0]}/${f[1]} of a class of ${n} chose football. How many chose football?`, (n * f[0]) / f[1]); },
  // the three slips: stopping at the money off, reading the % as dollars, and adding the discount on
  () => { const price = pick([40, 60, 80]), off = pick([10, 25, 30]), disc = (price * off) / 100;
    return pickOne(`A $${price} jacket is ${off}% off. What is the sale price?`, [price - disc, disc, price - off, price + disc].map((x) => `$${x}`), `$${price - disc}`); },
  (t) => { const b = ri(4, 12 + t), h = ri(3, 10); const area = (b * h) / 2; return Number.isInteger(area) ? num(`A triangle has base ${b} cm and height ${h} cm. Its area is ___ cm².`, area) : num(`A triangle has base ${b} cm and height ${h + 1} cm. Its area is ___ cm².`, (b * (h + 1)) / 2); },
  () => { const [a] = names(1); const d = pick([3, 4, 5, 6]); const n = d * ri(5, 15); return num(`After giving away 1/${d} of ${a}'s ${n} stamps, ${a} has ___ left.`, n - n / d); },
  () => { const k = ri(2, 6), a = ri(1, 4), b = ri(1, 4) + 4; return pickOne(`The ratio ${a * k} : ${b * k} is the same as which?`, [`${a} : ${b}`, `${a} : ${b + 1}`, `${a + 1} : ${b}`, `${b} : ${a}`], `${a} : ${b}`); },
  () => { const total = pick([100, 200, 250, 500]); const p = pick([20, 30, 40, 60, 80]); return num(`${p}% of the ${total} pupils walk to school. How many do NOT walk?`, total - (total * p) / 100); },
  () => { const km = pick([60, 90, 120, 150, 180]), h = pick([2, 3]); return num(`A cyclist rides ${km} km in ${h} hours at a steady speed. How far in 1 hour?`, km / h); },
  (t) => { const [a, b] = names(2); const it = pick(ITEMS); const r = [ri(2, 5), ri(1, 4)]; const unit = ri(4, 8 + t); return num(`${a} and ${b} share ${it}s in the ratio ${r[0]} : ${r[1]}. ${a} has ${r[0] * unit}. How many do they have altogether?`, (r[0] + r[1]) * unit); },
  about, faster, heavier,
  // four percentages of four different totals: the biggest percent is not the most pages
  () => { const who = names(4), ps = shuffle([10, 20, 25, 50, 75]).slice(0, 4), ns = shuffle([40, 60, 80, 120, 200]).slice(0, 4);
    const got = ps.map((p, i) => (p * ns[i]) / 100), order = [...got].sort((a, b) => b - a);
    const k = ri(0, 1), most = Math.random() < 0.5;
    return new Set(got).size < 4 ? null : pickOne(`${who.map((n, i) => `${n} read ${ps[i]}% of a book with ${ns[i]} pages`).join(". ")}. Who read the ${ORDINAL[k]}${most ? "most" : "fewest"} pages?`,
      who, who[got.indexOf(most ? order[k] : order[3 - k])]); },
  // a real bar chart at D, where the average is the question
  () => { const days = ["Mon", "Tue", "Wed", "Thu"], full = ["Monday", "Tuesday", "Wednesday", "Thursday"], v = days.map(() => ri(8, 40));
    v[3] += (4 - (v[0] + v[1] + v[2] + v[3]) % 4) % 4; // nudge the last day so the four share out evenly
    const text = "What is the average number of cakes sold each day?";
    return fig(num(text, (v[0] + v[1] + v[2] + v[3]) / 4, `A graph shows cakes sold: ${full.map((d, i) => `${d} ${v[i]}`).join(", ")}. ${text}`),
      { kind: "bars", title: "Cakes sold", unit: "cakes", bars: days.map((label, i) => ({ label, value: v[i] })) }); },
];

// ====================================================================
// LEVEL E  (≈ P6): speed · simple algebra · percentage change · pie charts · work backwards · circles · ratio share
// ====================================================================
const E = [
  () => { const s = pick([40, 50, 60, 80, 90]), h = ri(2, 5); return pick([num(`A car travels ${s * h} km in ${h} hours. Its speed is ___ km/h.`, s), num(`A car travels at ${s} km/h for ${h} hours. How far does it go, in km?`, s * h), num(`At ${s} km/h, how many hours to travel ${s * h} km?`, h)]); },
  () => { const n = ri(4, 15), k = ri(3, 8); return num(`A box holds n apples, so ${k} boxes hold ${k}n apples. If ${k}n = ${k * n}, then n = ___.`, n); },
  () => { const from = pick([20, 40, 50, 80, 200]); const p = pick([10, 20, 25, 50]); const to = from + (from * p) / 100; return pick([num(`A price rises from $${from} to $${to}. The increase is ___ %.`, p), num(`A price falls from $${to} to $${from}. It went down by $___.`, to - from)]); },
  // a real pie chart. The splits are written out because four different whole percents must still make exactly 100.
  () => { const cols = shuffle(["Red", "Blue", "Green", "Yellow", "Purple"]).slice(0, 4);
    const pcts = shuffle(pick([[40, 25, 20, 15], [35, 30, 20, 15], [45, 25, 20, 10], [50, 25, 15, 10], [40, 30, 20, 10], [45, 30, 15, 10], [35, 30, 25, 10], [40, 35, 15, 10]]));
    const order = [...pcts].sort((a, b) => b - a), k = ri(0, 2), top = Math.random() < 0.5;
    const text = `Which colour is the ${ORDINAL[k]}${top ? "biggest" : "smallest"} slice?`;
    return fig(pickOne(text, cols, cols[pcts.indexOf(top ? order[k] : order[3 - k])], `A pie chart shows ${cols.map((c, i) => `${c} ${pcts[i]}%`).join(", ")}. ${text}`),
      { kind: "pie", title: "Our class colours", slices: cols.map((label, i) => ({ label, pct: pcts[i] })) }); },
  () => { const [a] = names(1); const left = ri(4, 20), extra = ri(2, 10); const start = 2 * (left + extra); return num(`${a} had some money, spent half of it, then spent $${extra} more, and had $${left} left. How much did ${a} start with?`, start); },
  () => { const r = pick([7, 14, 21, 3.5]); return num(`Taking π as 22/7, the circumference of a circle with radius ${r} cm is ___ cm.`, Math.round(2 * (22 / 7) * r)); },
  // four riders, four different times: nobody is fastest just for going furthest
  () => { const who = names(4), sp = shuffle([10, 12, 16, 18, 20, 24, 30]).slice(0, 4), mins = who.map(() => pick([30, 60, 90, 120]));
    const fast = Math.random() < 0.5;
    return pickOne(`${who.map((n, i) => `${n} cycles ${(sp[i] * mins[i]) / 60} km in ${mins[i]} minutes`).join(". ")}. Who is the ${fast ? "fastest" : "slowest"}?`,
      who, who[sp.indexOf(fast ? Math.max(...sp) : Math.min(...sp))]); },
  () => { const [a, b] = names(2); const r = [ri(2, 7), ri(1, 6)]; const unit = ri(3, 12); const total = (r[0] + r[1]) * unit; return num(`${a} and ${b} share $${total} in the ratio ${r[0]} : ${r[1]}. ${b} gets $___.`, r[1] * unit); },
  () => { const n = pick([1, 2, 3]), d = pick([3, 4, 5]), k = pick([2, 3, 4]); const g = gcd(n, d * k); return num(`${n}/${d} ÷ ${k} = ${n / g}/___.`, (d * k) / g); },
  // never 50 %, where the part that is full and the part that is empty would be the same option twice
  () => { const L = pick([2, 3, 4, 5]), p = pick([20, 25, 40, 75]);
    return pickOne(`A ${L}-litre bottle is ${p}% full. How many litres are in it?`, [(L * p) / 100, (L * (100 - p)) / 100, (2 * L * p) / 100, (L * p) / 10].map((x) => plural(x, "litre")), plural((L * p) / 100, "litre")); },
  () => { const a = ri(2, 9), x = ri(2, 9), k = ri(1, 20); return num(`${a}x + ${k} = ${a * x + k}. What is x?`, x); },
  () => { const w = pick([25, 40, 50]), l = w * pick([2, 3]); return num(`A rectangle's length is ${l / w} times its width. The width is ${w} cm. The perimeter is ___ cm.`, 2 * (l + w)); },
  () => { const total = pick([120, 150, 200, 240]); const pa = pick([30, 40, 50]); const pb = pick([20, 25, 30]); return num(`Of ${total} pupils, ${pa}% chose art and ${pb}% chose music. The rest chose drama. How many chose drama?`, total - (total * (pa + pb)) / 100); },
  // a real line graph: the steps are all different, so the steepest week is not a matter of opinion
  () => { const ups = shuffle([2, 3, 5, 8]), h = [ri(4, 10)]; ups.forEach((u) => h.push(h.at(-1) + u));
    const best = ups.indexOf(Math.max(...ups)), text = "Between which two weeks did the plant grow the most?";
    return fig(pickOne(text, ups.map((_, i) => `Week ${i + 1} to ${i + 2}`), `Week ${best + 1} to ${best + 2}`,
      `A line graph shows a plant: ${h.map((cm, i) => `Week ${i + 1} ${cm} cm`).join(", ")}. ${text}`),
    { kind: "line", title: "Plant height", unit: "cm", points: h.map((value, i) => ({ label: `Week ${i + 1}`, value })) }); },
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
  // ten fractions, no two of them equal, so any four can be put in a strict order
  () => { const fs = shuffle([[5, 8], [7, 12], [3, 5], [4, 7], [2, 3], [5, 9], [7, 11], [1, 2], [3, 4], [5, 6]]).slice(0, 4), s = (f) => `${f[0]}/${f[1]}`;
    const order = [...fs].sort((a, b) => b[0] / b[1] - a[0] / a[1]), k = ri(0, 1), big = Math.random() < 0.5;
    const text = `Which fraction is the ${ORDINAL[k]}${big ? "largest" : "smallest"}?`;
    return pickOne(text, fs.map(s), s(big ? order[k] : order[3 - k]), `${text.slice(0, -1)} — ${orList(fs.map(s))}?`); },
  () => { const taps = pick([2, 3, 4]), hours = pick([6, 8, 12]); const more = taps + pick([1, 2, 3]); const t = (taps * hours) / more; return Number.isInteger(t) ? num(`${taps} taps fill a tank in ${hours} hours. How many hours would ${more} such taps take?`, t) : num(`${taps} taps fill a tank in ${hours} hours. How many hours would ${taps * 2} such taps take?`, hours / 2); },
  () => { const [a, b] = names(2); const before = [ri(2, 5), 1]; const give = ri(4, 20); const unit = give * 2; return num(`${a} had ${before[0]} times as much money as ${b}. After ${a} spent $${give * (before[0] - 1)}, they had the same amount. How much did ${b} have?`, give); },
  () => { const total = pick([120, 180, 240, 300]); const pa = pick([20, 25, 40]); const rest = total - (total * pa) / 100; const half = rest / 2; return Number.isInteger(half) ? num(`${pa}% of ${total} apples are red. Half of the rest are green and the others yellow. How many are yellow?`, half) : num(`${pa}% of ${total} apples are red. How many are not red?`, rest); },
  () => { const s = pick([60, 72, 80, 90]); const stop = pick([15, 20, 30]); const d = s * 2; return num(`A bus travels ${d} km at ${s} km/h, stopping for ${stop} minutes on the way. The whole trip takes ___ minutes.`, 120 + stop); },
  about, faster,
];

// generators drop `null` from a template that couldn't build a clean instance — retry another.
// A template that fed one of the last few questions at this level is skipped, so a session of
// 15 questions doesn't keep serving the same story with new numbers.
const GENS = [A, B, C, D, E, F];
const recent = GENS.map(() => []);
export function genSingapore(levelIdx, tier) {
  const li = Math.min(levelIdx, GENS.length - 1), pool = GENS[li], used = recent[li];
  const keep = Math.max(4, pool.length - 3); // cycle through nearly the whole pool before any story comes round again
  for (let i = 0; i < 60; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    if (i < 45 && used.includes(idx)) continue;
    try {
      const out = pool[idx](tier);
      if (out && out.display && out.answer && (out.answer.type !== "int" || Number.isInteger(out.answer.v))) { used.push(idx); if (used.length > keep) used.shift(); return out; }
    } catch (e) {}
  }
  return num("What is 10 less than 100?", 90);
}

// per-question seconds for Navigator: reading time on top of the level's base, +5s per tier
export const singaporeSecondsFor = (levelIdx, tier, mult) => Math.round((50 + levelIdx * 5 + (tier - 1) * 5) * mult);

export const SINGAPORE_TOPICS = [
  { title: "Sector A · Navigator", lines: ["Numbers to 1,000 — more than, less than, fill the blank.", "Easy multiplication in stories: rows of eggs, bags of sweets, legs on animals — 2s, 3s, 5s and 10s. No dividing yet. The counts grow as the papers go on.", "Halves and quarters first; thirds from paper 41; eighths and tenths from paper 61 — which is bigger, how many make a whole, a quarter of 20.", "Trip times: same hour first, then across the hour, then 24-hour clock with hours AND minutes from paper 61.", "Metres and centimetres, kilograms, litres, dollars and cents. Which is the heaviest, the second longest, the one that holds the least — four real things at a time."] },
  { title: "Sector B · Navigator", lines: ["Numbers to 10,000. Tables 6, 7, 8, 9 in two-step stories.", "Two kinds of animal at once — 5 spiders and 7 ants, how many legs altogether?", "Fractions: equivalent pairs, same top or same bottom — which is bigger, which is smaller? Perimeter of rectangles and squares.", "Kilometres and millilitres. The 24-hour clock and trips that last hours and minutes. Reading a bar chart and a table.", "Times as many, how many more, order who is tallest."] },
  { title: "Sector C · Navigator", lines: ["Numbers to 100,000. Factors and multiples.", "Decimals: money and measures with a decimal point (there's a . key).", "Area of squares and rectangles. Angles bigger or smaller than a right angle.", "Time across the hour. Multi-step money from a price list."] },
  { title: "Sector D · Navigator", lines: ["Percentages of a number. Ratio. Average.", "Rate — litres per minute, km per hour. Volume of a box.", "Fraction of a set. Discounts: what is the sale price? An average read off a bar chart.", "Area of a triangle."] },
  { title: "Sector E · Navigator", lines: ["Speed, distance and time. Simple algebra with n and x.", "Percentage increase and decrease. Pie charts and line graphs to read.", "Work backwards from what's left. Circles with π = 22/7.", "Sharing in a ratio. Dividing fractions."] },
  { title: "Sector F · Navigator", lines: ["PSLE heuristics: guess and check, before–after, remainders, supposition.", "Chickens and cows. Ages in the future. Meeting in the middle.", "Unitary method, number patterns, averages that change.", "Read twice. Draw the model in your head. Then answer."] },
];
