// 🪐 OLYMPIA's eight moons (the owner's naming, 19 Sep 2026: a place, so a parent gets the idea). Each is practice modelled on
// one olympiad's real paper — its shape, its topics, its answer style — and none is affiliated with the competition it is named
// after, which the hub says under every moon. The owner's order opened SEAMO, AMO, SMC and WMI first (v3.79); HK, BKK and PHI
// followed the same day, and DC-Moon (the AMC 8: the American paper the owner asked for beyond AMO) that evening. A visit is a
// ten-question heat, ~3 minutes a question (SMC brisker, the AMC 8 brisker still), and the child's year — from sign-up, or the
// sector reached when that is further (olympia.mjs yearOf) — picks the band. AMO has no Year 1 paper, so US-Moon opens at
// Year 2; the AMC 8 is a Grade 8 paper, so DC-Moon opens at Year 4.
import { heat as seaHeat, TOPICS as SEA_TOPICS } from './sea.mjs';
import { heat as usHeat, TOPICS as US_TOPICS } from './us.mjs';
import { heat as sgHeat, TOPICS as SG_TOPICS } from './sg.mjs';
import { heat as tHeat, TOPICS as T_TOPICS } from './t.mjs';
import { heat as hkHeat, TOPICS as HK_TOPICS } from './hk.mjs';
import { heat as bkkHeat, TOPICS as BKK_TOPICS } from './bkk.mjs';
import { heat as phiHeat, TOPICS as PHI_TOPICS } from './phi.mjs';
import { heat as dcHeat, TOPICS as DC_TOPICS } from './dc.mjs';

export const HEAT_QUESTIONS = 10;
export const MOONS = Object.freeze([
  { id: 'sea', name: 'SEA-Moon', emoji: '🌊', c: 'c-cyan', modelled: 'SEAMO', long: 'the Southeast Asian Mathematical Olympiad (Singapore)', years: [1, 6], seconds: 200,
    blurb: 'heuristics: working backwards, queues, pigeonholes, shortest paths, patterns', shape: '8 multiple choice + 2 short answer · five options with “None of the above” on every paper, as the real ones', open: true, heat: seaHeat, topics: SEA_TOPICS },
  { id: 'us', name: 'US-Moon', emoji: '🦅', c: 'c-magenta', modelled: 'AMO', long: 'the American Mathematics Olympiad (SIMCC with Southern Illinois University)', years: [2, 6], seconds: 200,
    blurb: 'the model method, cryptarithms, divisibility, patterns, spatial puzzles', shape: '6 multiple choice (five options) + 4 short answer · from Year 2, like the real paper', open: true, heat: usHeat, topics: US_TOPICS },
  { id: 'sg', name: 'SG-Moon', emoji: '🦁', c: 'c-gold', modelled: 'SMC', long: 'the Singapore Math Challenge (SIMCC)', years: [1, 6], seconds: 170,
    blurb: 'the Singapore syllabus with its heuristics: bar models, before-and-after, guess and check', shape: '2 multiple choice (four options) + 8 short answer · almost all typed numbers and brisker, as the real paper is', open: true, heat: sgHeat, topics: SG_TOPICS },
  { id: 't', name: 'T-Moon', emoji: '🏮', c: 'c-violet', modelled: 'WMI', long: 'the World Mathematics Invitational (Taiwan)', years: [1, 6], seconds: 190,
    blurb: 'a logic half and an applications half, all multiple choice', shape: 'Section A logical reasoning ×5 + Section B applications ×5 · all multiple choice', open: true, heat: tHeat, topics: T_TOPICS },
  { id: 'hk', name: 'HK-Moon', emoji: '🐉', c: 'c-mint', modelled: 'HKIMO', long: 'the Hong Kong International Mathematical Olympiad (Olympiad Champion Education Centre)', years: [1, 6], seconds: 210,
    blurb: 'our number-theory-and-counting cut of the OCEC paper: factors, unit digits, remainders, permutations', shape: 'all short answer · two from each of Logical thinking, Arithmetic, Number theory, Geometry, Combinatorics', open: true, heat: hkHeat, topics: HK_TOPICS },
  { id: 'bkk', name: 'BKK-Moon', emoji: '🐘', c: 'c-gold', modelled: 'TIMO', long: 'the Thailand International Mathematical Olympiad (Olympiad Champion Education Centre)', years: [1, 6], seconds: 210,
    blurb: 'our logic-and-arithmetic cut of the OCEC paper: chicken and rabbit, periodic beads, 25 × 32 × 125', shape: 'all short answer · two from each of the same five categories as HK-Moon', open: true, heat: bkkHeat, topics: BKK_TOPICS },
  { id: 'phi', name: 'PHI-Moon', emoji: '🌴', c: 'c-cyan', modelled: 'PhIMO', long: 'the Philippine International Mathematical Olympiad (Math Olympiads Training League)', years: [1, 6], seconds: 200,
    blurb: 'the Philippine strands: number sense, geometry, patterns and algebra, measurement, statistics and probability', shape: '5 multiple choice (five options with “None of the above”) then 5 short answer, one of each strand in each half · the easy-to-hard ramp of the real paper', open: true, heat: phiHeat, topics: PHI_TOPICS },
  { id: 'dc', name: 'DC-Moon', emoji: '🦬', c: 'c-violet', modelled: 'AMC 8', long: 'the American Mathematics Competitions 8 (Mathematical Association of America)', years: [4, 6], seconds: 120,
    blurb: 'the MAA paper for Grade 8 and below: geometry, counting and probability, number theory, algebra — climbing from warm-up to the closing problems', shape: '10 multiple choice, five options, no short answer · four warm-up, three middle, three closing, climbing as the real paper does · from Year 4', open: true, heat: dcHeat, topics: DC_TOPICS },
]);
export const moonById = (id) => MOONS.find((m) => m.id === id) || null;
export const moonPublic = (m) => ({ id: m.id, name: m.name, emoji: m.emoji, c: m.c, modelled: m.modelled, long: m.long, years: m.years, seconds: m.seconds, blurb: m.blurb, shape: m.shape, open: m.open, topics: m.topics ? m.topics : null });
/** The band a year is asked at, for the hub's words: SEAMO's lettered papers, the others a paper per grade. */
export const bandOf = (moon, year) => (moon.id === 'sea' ? `Paper ${year <= 2 ? 'A' : year <= 4 ? 'B' : 'C'}` : `Grade ${year}`);
export function buildVisit(moon, year) {
  if (!moon.open || typeof moon.heat !== 'function') throw Error(`moon ${moon.id} is not open`);
  const y = Math.max(moon.years[0], Math.min(moon.years[1], year));
  return moon.heat(y);
}
