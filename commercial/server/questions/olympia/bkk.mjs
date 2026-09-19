// 🐘 BKK-MOON — practice modelled on TIMO (the Thailand International Mathematical Olympiad, Olympiad Champion Education Centre
// with the Tourism Authority of Thailand); not affiliated. The same five categories and the same twenty-five short answers as its
// Hong Kong twin; what TIMO leans on is the logic set-piece and the arithmetic trick — chicken and rabbit, periodic beads, speed,
// balance puzzles, Gaussian addition, 25 × 32 × 125 (olympia-research.md §7). The shared generators live in ocec.mjs.
import { ocecHeat } from './ocec.mjs';

export const heat = (year) => ocecHeat(year, 'bkk');
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['logical thinking: balance puzzles, rows of dots', 'arithmetic: smart addition that pairs to tens, a missing digit', 'number theory and geometry: odd and even, digits, shapes, counting squares', 'combinatorics: two-digit numbers from given digits, handshakes'] },
  { band: 'Grades 3–4', lines: ['logical thinking: periodic beads, chicken and rabbit, pigeonholes, dates', 'arithmetic: 1 + 2 + … + 100, 9999 + 999 + 99 + 9, 999 × 7', 'number theory: primes, LCM and HCF, divisibility', 'combinatorics: routes on a grid, sharing with something over or short'] },
  { band: 'Grades 5–6', lines: ['logical thinking: speed, distance and time, a four-digit number from clues, ages', 'arithmetic: series with a step, geometric sums, 0.25 × 48 × 4', 'number theory: factors, unit digits, remainders', 'geometry and combinatorics: circles, volume, combinations, dice'] },
];
