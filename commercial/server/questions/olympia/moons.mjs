// 🪐 OLYMPIA's eight moons (the owner's naming, 19 Sep 2026: a place, so a parent gets the idea). Each is practice modelled on
// one olympiad's real paper — its shape, its topics, its answer style — and none is affiliated with the competition it is named
// after, which the hub says under every moon. The owner's order opened SEAMO, AMO, SMC and WMI first (v3.79); HK, BKK and PHI
// followed the same day, and DC-Moon (the AMC 8: the American paper the owner asked for beyond AMO) that evening.
//
// Since 20 Sep 2026 a moon is the real paper, whole: the paper's own number of questions in its own sections, with the paper's
// own total time (the owner: "the format AND number of questions should follow actual paper … total time across them 90
// minutes too"; SEAMO, AMO, SMC, HKIMO, TIMO and PhIMO sit 90 minutes, WMI's two sittings 80, the AMC 8 40). Ninety minutes
// straight is too long for a child, so every paper is three phases the child picks one at a time — α Alpha, β Beta, γ Gamma —
// each one of the paper's sections on its own clock, with its own log of the last ten scores and durations (olympia.mjs). The
// split of the minutes between the phases is ours; each module says its own. The child's year — from sign-up, or the sector
// reached when that is further (olympia.mjs yearOf) — picks the band. AMO has no Year 1 paper, so US-Moon opens at Year 2;
// the AMC 8 is a Grade 8 paper, so DC-Moon opens at Year 4.
import * as sea from './sea.mjs';
import * as us from './us.mjs';
import * as sg from './sg.mjs';
import * as t from './t.mjs';
import * as hk from './hk.mjs';
import * as bkk from './bkk.mjs';
import * as phi from './phi.mjs';
import * as dc from './dc.mjs';

export const PHASE_NAMES = Object.freeze({ alpha: { name: 'Alpha', sym: 'α' }, beta: { name: 'Beta', sym: 'β' }, gamma: { name: 'Gamma', sym: 'γ' } });
export const MOONS = Object.freeze([
  { id: 'sea', name: 'SEA-Moon', emoji: '🌊', c: 'c-cyan', modelled: 'SEAMO', long: 'the Southeast Asian Mathematical Olympiad (Singapore)', years: [1, 6], minutes: 90,
    blurb: 'heuristics: working backwards, queues, pigeonholes, shortest paths, patterns', shape: 'the real paper: 25 questions in 90 minutes · Section A ten 3-mark and Section B ten 4-mark multiple choice, five options with “None of the above” · Section C five 6-mark typed answers', open: true, mod: sea },
  { id: 'us', name: 'US-Moon', emoji: '🦅', c: 'c-magenta', modelled: 'AMO', long: 'the American Mathematics Olympiad (SIMCC with Southern Illinois University)', years: [2, 6], minutes: 90,
    blurb: 'the model method, cryptarithms, divisibility, patterns, spatial puzzles', shape: 'the real paper: 25 questions in 90 minutes · fifteen 3-mark multiple choice of five options, then five 5-mark and five 6-mark typed answers · from Year 2, like the real paper', open: true, mod: us },
  { id: 'sg', name: 'SG-Moon', emoji: '🦁', c: 'c-gold', modelled: 'SMC', long: 'the Singapore Math Challenge (SIMCC)', years: [1, 6], minutes: 90,
    blurb: 'the Singapore syllabus with its heuristics: bar models, before-and-after, guess and check', shape: 'the real paper: 90 minutes for 40 questions at Grades 1–2, 45 at Grades 3–4, 32 at Grades 5–6 · almost all typed, climbing from 2 to 4 marks, with two four-option questions at Grades 1–4', open: true, mod: sg },
  { id: 't', name: 'T-Moon', emoji: '🏮', c: 'c-violet', modelled: 'WMI', long: 'the World Mathematics Invitational (Taiwan)', years: [1, 6], minutes: 80,
    blurb: 'a logic half and an applications half, all multiple choice', shape: 'the real preliminary paper: 25 multiple choice of four options in 80 minutes · Section A fifteen logical reasoning (ten 6-mark, five 8-mark) · Section B ten 10-mark applications', open: true, mod: t },
  { id: 'hk', name: 'HK-Moon', emoji: '🐉', c: 'c-mint', modelled: 'HKIMO', long: 'the Hong Kong International Mathematical Olympiad (Olympiad Champion Education Centre)', years: [1, 6], minutes: 90,
    blurb: 'our number-theory-and-counting cut of the OCEC paper: factors, unit digits, remainders, permutations', shape: 'the real heat paper: 25 short answers in 90 minutes, five from each of Logical thinking, Arithmetic, Number theory, Geometry, Combinatorics · 4 marks each', open: true, mod: hk },
  { id: 'bkk', name: 'BKK-Moon', emoji: '🐘', c: 'c-gold', modelled: 'TIMO', long: 'the Thailand International Mathematical Olympiad (Olympiad Champion Education Centre)', years: [1, 6], minutes: 90,
    blurb: 'our logic-and-arithmetic cut of the OCEC paper: chicken and rabbit, periodic beads, 25 × 32 × 125', shape: 'the real heat paper: 25 short answers in 90 minutes, five from each of the same five categories as HK-Moon · 4 marks each', open: true, mod: bkk },
  { id: 'phi', name: 'PHI-Moon', emoji: '🌴', c: 'c-cyan', modelled: 'PhIMO', long: 'the Philippine International Mathematical Olympiad (Math Olympiads Training League)', years: [1, 6], minutes: 90,
    blurb: 'the Philippine strands: number sense, geometry, patterns and algebra, measurement, statistics and probability', shape: 'the real heat paper: 25 questions in 90 minutes · Part 1 ten 2-mark multiple choice, five options with “None of the above” · Part 2 ten 3-mark then five 5-mark typed answers across the strands', open: true, mod: phi },
  { id: 'dc', name: 'DC-Moon', emoji: '🦬', c: 'c-violet', modelled: 'AMC 8', long: 'the American Mathematics Competitions 8 (Mathematical Association of America)', years: [4, 6], minutes: 40,
    blurb: 'the MAA paper for Grade 8 and below: geometry, counting and probability, number theory, algebra — climbing from warm-up to the closing problems', shape: 'the real paper: 25 multiple choice of five options in 40 minutes, climbing from problem 1 to 25 · in three sittings of 10, 10 and 5 · from Year 4', open: true, mod: dc },
].map((m) => Object.freeze({ ...m, phases: m.mod.PHASES, build: m.mod.build, topics: m.mod.TOPICS })));
export const moonById = (id) => MOONS.find((m) => m.id === id) || null;
export const phaseById = (moon, id) => moon.phases.find((p) => p.id === id) || null;
/** The band a year is asked at, for the hub's words: SEAMO's lettered papers, the others a paper per grade. */
export const bandOf = (moon, year) => (moon.id === 'sea' ? `Paper ${year <= 2 ? 'A' : year <= 4 ? 'B' : 'C'}` : `Grade ${year}`);
const clampYear = (moon, year) => Math.max(moon.years[0], Math.min(moon.years[1], year));
/** One phase as the hub and the play header name it: the Greek name, the paper's title for the section, how many questions, the marks, the minutes, and whether it is tapped or typed. */
export function phasePublic(moon, ph, year) {
  const shape = ph.shape(clampYear(moon, year)), mc = shape.filter((s) => s.kind === 'mc').length;
  return { id: ph.id, ...PHASE_NAMES[ph.id], title: ph.title, count: shape.length, marks: ph.marks, minutes: ph.minutes, kind: mc === shape.length ? 'mc' : mc === 0 ? 'sa' : 'mixed', mc };
}
export const moonPublic = (m, year = m.years[0]) => ({ id: m.id, name: m.name, emoji: m.emoji, c: m.c, modelled: m.modelled, long: m.long, years: m.years, minutes: m.minutes, blurb: m.blurb, shape: m.shape, open: m.open,
  phases: m.phases.map((ph) => phasePublic(m, ph, year)), topics: m.topics ? m.topics : null });
/** The questions of one phase of a moon's paper for a year: the section's shape, filled from the moon's pool. */
export function buildVisit(moon, year, phaseId) {
  if (!moon.open || typeof moon.build !== 'function') throw Error(`moon ${moon.id} is not open`);
  const ph = phaseById(moon, phaseId); if (!ph) throw Error(`moon ${moon.id} has no phase ${phaseId}`);
  const y = clampYear(moon, year);
  return moon.build(ph.shape(y), y);
}
