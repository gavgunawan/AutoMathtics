// 🐘 BKK-MOON — practice modelled on TIMO (the Thailand International Mathematical Olympiad, Olympiad Champion Education Centre;
// the paper's letterhead names the Thailand Mathematics Society); not affiliated. The same five categories and the same twenty-five
// short answers as its Hong Kong twin; this moon's cut of the shared pool leans on the logic set-piece and the arithmetic trick —
// chicken and rabbit, periodic beads, speed, balance puzzles, Gaussian addition, 25 × 32 × 125 — our own way of telling the twins
// apart, not the paper's (the source check of 20 Sep 2026). The shared generators live in ocec.mjs.
import { ocecBuild, PHASES } from './ocec.mjs';

export { PHASES };
export const build = (shape, year) => ocecBuild(shape, year, 'bkk');
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['logical thinking: balance puzzles, rows of dots, work and rest, sequences with a changing step', 'arithmetic: smart addition that pairs to tens, a missing digit', 'number theory and geometry: odd and even, digits, shapes, counting squares', 'combinatorics: two-digit numbers from given digits, handshakes'] },
  { band: 'Grades 3–4', lines: ['logical thinking: periodic beads, chicken and rabbit, pigeonholes, dates, sums and multiples, working backwards', 'arithmetic: 1 + 2 + … + 100, 9999 + 999 + 99 + 9, 999 × 7', 'number theory: primes, LCM and HCF, divisibility', 'combinatorics: routes on a grid, sharing with something over or short'] },
  { band: 'Grades 5–6', lines: ['logical thinking: speed, distance and time, a four-digit number from clues, ages', 'arithmetic: series with a step and their averages, geometric and telescoping sums, 0.25 × 48 × 4', 'number theory: factors, unit digits, remainders', 'geometry and combinatorics: circles, volume, combinations, dice'] },
];
