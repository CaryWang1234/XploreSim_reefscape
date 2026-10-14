// How much room is left for a planner in REEFSCAPE, per decision axis, before building one.
//
// The 2025 planner already beats the shipped baseline by ~12 points and was measured as merely reproducing
// the best FIXED rule, so "make the AI stronger" is not a win-rate question. It is a question about which
// axes still have room that a fixed rule cannot take. This answers it with an upper bound: every arm is run
// as a fixed rule, then a machine with hindsight (per seed, the best arm for THAT seed) is scored against it.
//
//   planner    = ai.js as shipped
//   best fixed = the arm whose MEAN is best
//   oracle     = the arm chosen per seed with hindsight — no policy on these knobs can beat this
//
// Room is reported twice: on POINTS and on RANKING POINTS (§6.6: win 3 / tie 2 / loss 1, plus the auto,
// CORAL, BARGE RPs and the Coopertition point). If the two disagree, the planner's OBJECTIVE is the lever,
// not its search. If oracle − best fixed is inside the noise, adaptivity on that axis is not available at
// any sample size and the honest move is to leave the knob pinned.
//
// Run: npm run aicap

import { playMatch } from '../web/js/league.js';
import { SAMPLES } from '../web/js/model.js';

const N = 24;
const base = 9000;

const arm = (seed, opts, kind = 'greedy', patch = null) => playMatch({
  blueKind: kind,
  redKind: 'greedy',
  seed,
  blueProfiles: patch ? SAMPLES.map((p) => ({ ...p, placeSec: { ...p.placeSec }, placeDrop: { ...p.placeDrop }, ...patch })) : SAMPLES,
  redProfiles: SAMPLES,
  bluePolicyOpts: opts,
});

// The four ranking points a 2025 MATCH actually awards, in the order a league table reads them.
const rpOf = (m) => m.final.blue.rp.total + (m.final.blue.coopertition || 0);
const scoreOf = (m) => m.final.blue.total;

// Non-window axes are anchored at the best measured commit window (8 s), otherwise their "room" is really
// the window's room.
const ANCHOR = { climbWindowSec: 8 };

const AXES = [
  ['window (anchored rule: none)', [6, 8, 12].map((climbWindowSec) => ({ opts: { climbWindowSec } }))],
  ['duty (who strips ALGAE)', [null, [0], [1], [2], [0, 1], [0, 1, 2]].map((algaeSlots) => ({ opts: { ...ANCHOR, algaeSlots } }))],
  ['level order', [['L4', 'L3', 'L2', 'L1'], ['L3', 'L4', 'L2', 'L1'], ['L2', 'L3', 'L4', 'L1']].map((placeOrder) => ({ opts: { ...ANCHOR, placeOrder } }))],
  ['level bands', [null, [['L4', 'L4'], ['L3', 'L3'], ['L2', 'L1']]].map((bands) => ({ opts: { ...ANCHOR, bands } }))],
  ['deny (who plays defense)', [null, [2], [1, 2]].map((defendSlots) => ({ opts: { ...ANCHOR, defendSlots } }))],
  // The two CORAL STATIONs are each ALLIANCE's own furniture, so this axis is tempo rather than denial: how
  // hard the bid prices a teammate already bound for the nearer pocket.
  ['station spread', [0, 0.45, 0.91, 1.6].map((stationSpread) => ({ opts: { ...ANCHOR, stationSpread } }))],
  // The cross product, because the strip assignment and the commit window are the same clock.
  ['window × duty', [6, 8, 12].flatMap((climbWindowSec) => [null, [2], [0, 1, 2]].map((algaeSlots) => ({ opts: { climbWindowSec, algaeSlots } })))],
  // Two knobs the ENGINE prices but the plan vocabulary has never carried: how deep the scripted AUTO routine
  // goes, and how long a machine keeps trying a level it is being held off. The AUTO one is the interesting
  // case for an RP objective, because §6.6's auto RP needs EVERY non-bypassed ROBOT to LEAVE — the column is
  // all-or-nothing, while a points-maximiser only sees 6.8 AUTO points against 0.38 of the LEAVE total.
  ['auto (AUTO routine depth)', [1, 2, 3].map((autoCycles) => ({ opts: { ...ANCHOR }, patch: { autoCycles }, label: `autoCycles ${autoCycles}` }))],
  ['retry (when a machine gives up a level)', [1, 2, 4, Infinity].map((placeGiveUp) => ({ opts: { ...ANCHOR, placeGiveUp } }))],
];

const stat = (d) => {
  const mu = d.reduce((a, b) => a + b, 0) / d.length;
  return { mu, se: Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / (d.length - 1) / d.length) };
};
const fmt = ({ mu, se }) => `${(mu >= 0 ? '+' : '') + mu.toFixed(1)} ± ${se.toFixed(1)}`;

const seeds = Array.from({ length: N }, (_, i) => base + i * 977);
const plannerRuns = seeds.map((s) => arm(s, {}, 'ai'));
const planner = {
  score: plannerRuns.map(scoreOf),
  rp: plannerRuns.map(rpOf),
  autoRp: plannerRuns.map((m) => (m.final.blue.rp.auto ? 1 : 0)),
  margin: plannerRuns.map((m) => m.final.blue.total - m.final.red.total),
  wins: plannerRuns.filter((m) => m.final.blue.total > m.final.red.total).length,
};
console.log(`planner (ai.js as shipped) vs greedy: blue ${(planner.score.reduce((a, b) => a + b, 0) / N).toFixed(1)} · win ${planner.wins}/${N} · mean RP ${(planner.rp.reduce((a, b) => a + b, 0) / N).toFixed(2)} · autoRP ${planner.autoRp.reduce((a, b) => a + b, 0)}/${N}`);

for (const [axis, specs] of AXES) {
  // AXES=duty,auto selects by substring, because a full pass is ~30 arms × 24 seeds and one axis is usually
  // the only thing that changed since the last run.
  if (process.env.AXES && !process.env.AXES.split(',').some((k) => axis.toLowerCase().startsWith(k.toLowerCase()))) continue;
  const arms = specs.map((spec) => {
    const ms = seeds.map((s) => arm(s, spec.opts, 'greedy', spec.patch));
    return {
      ms,
      v: spec.label || Object.entries(spec.opts).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${Array.isArray(v) ? JSON.stringify(v) : v}`).join(' '),
      scores: ms.map(scoreOf),
      opp: ms.map((m) => m.final.red.total),
      rps: ms.map(rpOf),
      autoRp: ms.map((m) => (m.final.blue.rp.auto ? 1 : 0)),
      leaves: ms.map((m) => m.final.blue.leave),
      wins: ms.filter((m) => m.final.blue.total > m.final.red.total).length,
    };
  });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / N;
  const marginOf = (m) => m.final.blue.total - m.final.red.total;
  arms.forEach((a) => { a.margins = a.ms.map(marginOf); a.marginWins = a.ms.filter((m) => marginOf(m) > 0).length; });
  let bestI = 0;
  arms.forEach((a, i) => { if (mean(a.scores) > mean(arms[bestI].scores)) bestI = i; });
  let bestMgnI = 0;
  arms.forEach((a, i) => { if (mean(a.margins) > mean(arms[bestMgnI].margins)) bestMgnI = i; });
  let bestRpI = 0;
  arms.forEach((a, i) => { if (mean(a.rps) > mean(arms[bestRpI].rps)) bestRpI = i; });
  const ref = arms[bestI];
  const mref = arms[bestMgnI];
  const oracleScore = seeds.map((_, i) => Math.max(...arms.map((a) => a.scores[i])));
  // Hindsight on the two things a planner can actually be asked to maximize: the win, and the RP a league
  // table records. A fixed rule that is best on points is not necessarily best on either.
  const oracleMargin = seeds.map((_, i) => {
    let k = 0;
    arms.forEach((a, j) => { if (a.margins[i] > arms[k].margins[i]) k = j; });
    return arms[k].margins[i];
  });
  const oracleRp = seeds.map((_, i) => {
    let k = 0;
    arms.forEach((a, j) => { if (a.rps[i] > arms[k].rps[i]) k = j; });
    return arms[k].rps[i];
  });
  console.log(`\n${axis}  (${arms.length} arms, paired on the same ${N} seeds; deltas vs the best fixed arm)`);
  arms.forEach((a) => console.log(`  ${(a.v + ' ').padEnd(46)} blue ${mean(a.scores).toFixed(1)} · margin ${mean(a.margins).toFixed(1)} · win ${String(a.wins).padStart(2)}/${N} · RP ${mean(a.rps).toFixed(2)} · autoRP ${a.autoRp.reduce((x, y) => x + y, 0)}/${N} · LEAVE ${(mean(a.leaves) / 9).toFixed(2)} · pts ${fmt(stat(a.scores.map((s, i) => s - ref.scores[i])))} · off the opponent ${fmt(stat(a.opp.map((o, i) => o - ref.opp[i])))}`));
  console.log(`  best fixed on points: ${ref.v} — ${fmt(stat(ref.scores.map((s, i) => s - planner.score[i])))} vs the planner, win ${ref.wins}/${N}`);
  console.log(`  best fixed on margin: ${mref.v} — mean margin ${mean(mref.margins).toFixed(1)}, win ${mref.marginWins}/${N}`);
  console.log(`  best fixed on RP:     ${arms[bestRpI].v} — mean RP ${mean(arms[bestRpI].rps).toFixed(2)} (planner ${mean(planner.rp).toFixed(2)})`);
  console.log(`  ROOM on points: oracle ${fmt(stat(oracleScore.map((o, i) => o - ref.scores[i])))} · oracle vs planner ${fmt(stat(oracleScore.map((o, i) => o - planner.score[i])))}`);
  console.log(`  ROOM on margin: oracle ${fmt(stat(oracleMargin.map((o, i) => o - mref.margins[i])))} · oracle vs planner ${fmt(stat(oracleMargin.map((o, i) => o - planner.margin[i])))}`);
  console.log(`  ROOM on RP:     oracle ${fmt(stat(oracleRp.map((o, i) => o - arms[bestRpI].rps[i])))} · oracle vs planner ${fmt(stat(oracleRp.map((o, i) => o - planner.rp[i])))}`);
}
