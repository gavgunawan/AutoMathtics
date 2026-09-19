// 🐉 HK-MOON — practice modelled on HKIMO (the Hong Kong International Mathematical Olympiad, Olympiad Champion Education
// Centre); not affiliated. The real heat is twenty-five short answers, five from each of Logical Thinking, Arithmetic, Number
// Theory, Geometry and Combinatorics, four marks each, whole-number answers, no calculators, one paper per grade. HKIMO's own
// emphasis, told apart from its Thai twin, is number theory and counting: factors, unit digits, remainders, permutations and
// combinations, inclusion-exclusion (olympia-research.md §5). The shared generators live in ocec.mjs.
import { ocecHeat } from './ocec.mjs';

export const heat = (year) => ocecHeat(year, 'hk');
export const TOPICS = [
  { band: 'Grades 1–2', lines: ['logical thinking: balance puzzles, figure patterns', 'arithmetic: smart addition, a missing digit', 'number theory and geometry: odd and even, digits, shapes, counting squares', 'combinatorics: two-digit numbers from given digits, handshakes'] },
  { band: 'Grades 3–4', lines: ['logical thinking: periodic beads, pigeonholes, ages, dates, chicken and rabbit', 'arithmetic: Gaussian addition, 9999 + 999 + 99 + 9, 25 × 32 × 125', 'number theory: primes, LCM and HCF, divisibility, how often a digit is written', 'combinatorics: routes on a grid, three-digit numbers, sharing with something over'] },
  { band: 'Grades 5–6', lines: ['number theory: the number of factors, the sum of factors, unit digits, remainders', 'combinatorics: combinations, permutations, inclusion and exclusion, dice', 'arithmetic: geometric sums, sums of squares, decimals, fraction chains', 'geometry: circles with π as 22/7, volume and surface area, ratios of areas'] },
];
