// 🪐 OLYMPIA's seven moons (the owner's naming, 19 Sep 2026: a place, so a parent gets the idea). Each is practice modelled on
// one olympiad's real paper — its shape, its topics, its answer style — and none is affiliated with the competition it is named
// after, which the hub says under every moon. Four are open (the owner's order: SEAMO, AMO, SMC and WMI first); HK, BKK and PHI
// are drawn locked until their generators land. A visit is a ten-question heat, ~3 minutes a question (SMC brisker), and the
// child's year from sign-up picks the band. AMO has no Year 1 paper, so US-Moon opens at Year 2.
import { heat as seaHeat, TOPICS as SEA_TOPICS } from './sea.mjs';
import { heat as usHeat, TOPICS as US_TOPICS } from './us.mjs';
import { heat as sgHeat, TOPICS as SG_TOPICS } from './sg.mjs';
import { heat as tHeat, TOPICS as T_TOPICS } from './t.mjs';

export const HEAT_QUESTIONS = 10;
export const MOONS = Object.freeze([
  { id: 'sea', name: 'SEA-Moon', emoji: '🌊', c: 'c-cyan', modelled: 'SEAMO', long: 'the Southeast Asian Mathematical Olympiad (Singapore)', years: [1, 6], seconds: 200,
    blurb: 'heuristics: working backwards, queues, pigeonholes, shortest paths, patterns', shape: '8 multiple choice + 2 short answer · Paper A/B four options, Paper C five with “None of the above”', open: true, heat: seaHeat, topics: SEA_TOPICS },
  { id: 'us', name: 'US-Moon', emoji: '🦅', c: 'c-magenta', modelled: 'AMO', long: 'the American Mathematics Olympiad (SIMCC with Southern Illinois University)', years: [2, 6], seconds: 200,
    blurb: 'the model method, cryptarithms, divisibility, patterns, spatial puzzles', shape: '6 multiple choice (five options) + 4 short answer · from Year 2, like the real paper', open: true, heat: usHeat, topics: US_TOPICS },
  { id: 'sg', name: 'SG-Moon', emoji: '🦁', c: 'c-gold', modelled: 'SMC', long: 'the Singapore Math Challenge (SIMCC)', years: [1, 6], seconds: 170,
    blurb: 'the Singapore syllabus with its heuristics: bar models, before-and-after, guess and check', shape: '5 multiple choice + 5 short answer · brisker, as the real paper is', open: true, heat: sgHeat, topics: SG_TOPICS },
  { id: 't', name: 'T-Moon', emoji: '🏮', c: 'c-violet', modelled: 'WMI', long: 'the World Mathematics Invitational (Taiwan)', years: [1, 6], seconds: 190,
    blurb: 'a logic half and an applications half, all multiple choice', shape: 'Section A logical reasoning ×5 + Section B applications ×5 · all multiple choice', open: true, heat: tHeat, topics: T_TOPICS },
  { id: 'hk', name: 'HK-Moon', emoji: '🐉', c: 'c-mint', modelled: 'HKIMO', long: 'the Hong Kong International Mathematical Olympiad', years: [1, 6], seconds: 210, blurb: 'logical thinking, arithmetic, number theory, geometry, combinatorics', shape: 'all short answer · two from each of the five categories', open: false },
  { id: 'bkk', name: 'BKK-Moon', emoji: '🐘', c: 'c-gold', modelled: 'TIMO', long: 'the Thailand International Mathematical Olympiad', years: [1, 6], seconds: 210, blurb: 'logic puzzles and arithmetic tricks', shape: 'all short answer · two from each of the five categories', open: false },
  { id: 'phi', name: 'PHI-Moon', emoji: '🌴', c: 'c-cyan', modelled: 'PHIMO', long: 'the Philippine International Mathematical Olympiad (MOTLI)', years: [1, 6], seconds: 210, blurb: 'number sense, geometry, patterns and algebra, measurement, statistics', shape: '5 multiple choice + 5 short answer', open: false },
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
