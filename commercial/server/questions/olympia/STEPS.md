# The worked solutions — house style (20 Sep 2026)

Every moon question carries its own worked solution, written by the generator that made it, from the same numbers.
It is what **💡 Explain to me** shows during a paper (which then counts for nothing, as before) and what the reveal
shows under every question afterwards — with no call to the AI tutor, so it costs nothing and works whenever the app
does. The AI tutor is kept for the child's follow-up questions where a key is on. The owner's model is the SEAMO Paper B
"Simplest Solutions for an 8-Year-Old" sheets (20 Sep 2026): rewrite → simplest trick → short solution → answer → tip.

## The shape

```js
explain(int('chicken and rabbit', `There are ${n} chickens and rabbits with ${legs} legs. How many rabbits?`, r), [
  `Pretend all ${n} animals are chickens: ${n} × 2 = ${2 * n} legs.`,
  `But there are ${legs} legs, so ${legs - 2 * n} legs are extra.`,
  `Each rabbit has 2 more legs than a chicken: ${legs - 2 * n} ÷ 2 = ${r}.`,
  `So there are ${r} rabbits.`,
], 'Start with the animal that has fewer legs, then count the extra legs.');
```

- `explain(seed, steps, tip)` from common.mjs. `steps` is an array of short lines, 2 to 7 of them; `tip` is one line, the
  reusable trick, or omitted when there is none worth keeping.
- **Every number in the steps is computed from the generator's own variables** (`${2 * n}`), never typed by hand, so the
  working can never disagree with the question. The sweep test checks that the answer appears in the steps.
- The **last line states the answer in the question's own words and unit**: "So there are 12 rabbits.", "The area is
  24 cm².", "So the missing number is 77." For a fraction, the fraction; for a decimal, the decimal; for a word answer
  (mcOnly), the word. Never a choice letter: the options are shuffled after the seed is made.
- One move per line. Digits, not words, for numbers. Plain text: no markdown, no bold, no bullets. The symbols ×, ÷, −,
  =, → are fine; so is ² for a square.
- Lines that draw a **bar model** use `bar(label, units, note)` from common.mjs: `bar('Adi', 3, '?')` gives
  "Adi      ▭▭▭  ?". Equal boxes are equal units; put the known total or the difference in the note. The client sets
  any line with ▭ in a monospace face, so rows line up.
- Where the seed has several sub-kinds (an `if (kind === 1) … return int(…)` ladder), each return gets its own
  explain: the steps belong to the question that was asked.
- A generator that returns `null` to redraw needs nothing.

## The method must fit the child's year

The steps are read by a child of the year the paper is pitched at, and by a parent who may not know the school's
methods. The method is the one the child's school teaches at that age — this is the point of the whole exercise.

- **Years 1–4 (SEAMO Papers A–B, SMC Grades 1–4, AMO Grades 2–4, WMI and OCEC Grades 1–4, PhIMO Grades 1–4): no
  algebra.** No "let x be", no equations with letters, no "solve for". Use instead, in this order of preference:
  - **the bar model** for part–whole, comparison ("3 times as many", "after giving 12 they were equal"), before-and-after
    and fraction-of-a-remainder problems — draw it with `bar()`;
  - **working backwards** with the undone operations in reverse ("Start at the end: 200 + 85 = 285, 285 ÷ 3 = 95 …");
  - **the assumption method** ("Pretend all are chickens …") for chicken-and-rabbit, quiz scores with penalties, coins
    of two kinds;
  - **guess and check** with a short table, or "try the choices" — real SEAMO solutions do this;
  - **make a list / find the pattern / look at the jumps** for sequences and counting;
  - **pair up** for sums (2 + 101 = 103, 17 pairs …), **group** for repeating signs;
  - **count layer by layer, small → medium → large** for figures;
  - **the units idea** ("1 unit = 12, 3 units = 36") — this is the Singapore way of saying what algebra says, and is fine
    from Year 3.
- **Years 5–6 (SEAMO Paper C, SMC 5–6, AMO 5–6, WMI/OCEC/PhIMO 5–6, AMC 8):** still the model method and units first.
  A letter for an unknown is acceptable only where the school method genuinely uses one (AMC 8 algebra kinds, DC-Moon)
  and even then say the idea in words first ("call the number n").
- When a kind serves several years, branch: `y <= 4 ? [bar-model steps] : [units steps]`. When one method serves all,
  use the simplest.
- Tips are the transferable trick, in a child's words: "When a sequence is missing a number, check the differences
  first." "'Finally' is a clue to work backwards." "In a multiple-choice puzzle, testing the choices can be faster than
  making an equation."

## What the sweep test checks (tests/olympia-questions.test.mjs)

- every question of every phase of every moon has `steps` with at least 2 lines, each 3–160 characters, no line empty,
  no `undefined`/`NaN`/`[object`, no markdown asterisks or leading bullets;
- the answer text (`answerText(q)`) appears in the steps, unless the answer is "None of the above";
- the tip, when present, is one line of 10–160 characters.

Run one moon while writing: `MOON=sea node --test tests/olympia-questions.test.mjs`.
