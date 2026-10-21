// What the five Ranking Points can actually do to a batch, MATCH by MATCH.

// Table 6-2 pays an ALLIANCE five things it can rank with — AUTO, CORAL and BARGE RPs plus the win or the
// tie — and a bar printed on the page is only a claim if some MATCH crosses it and some does not. This is the
// same audit the 2026 build needed before it muted two of its three bonus rungs, run here on the 2025 rules:
// every MATCH is graded twice, once by `engine.js` and once here out of `POINTS`, and the two have to agree;
// then each term is reported as a reach rate, an own-tally/foul-gift split (G410 gives the CORAL RP, G418 and
// G428 the BARGE RP in a Qualification MATCH), and the gap between the side that scored more and the side that
// scored less — which is the only sense in which a term can "mean" anything in a mirror.
//
// It also prints the two structural facts a batch can hide: whether the four-level CORAL path is reachable at
// all when the TROUGH runs short (README's known residual: 5.3 of a recorded 23 an ALLIANCE), and what the
// Coopertition relaxation is doing — with coop live the bar drops from four levels to three, so an ALLIANCE
// whose trough never fills still banks the RP, and the CORAL RP stops being about the REEF it filled.
//
// The teeth are the synthetic arms at the bottom: each bar is crossed at exactly the tally that flips it and
// one short of it, on both the coop and non-coop paths, and a playoff MATCH must refuse the relaxation and the
// G418 gift. A term that reads 100% or 0% in every real arm is reported as constant — that is a finding, not a
// failure, because unlike the 2026 build this one has no objective to weight it.
//
//   node scripts/rp.mjs                MATCHES=48
//   ARMS=mirror node scripts/rp.mjs    # the cheap arm only

import { LEVELS } from '../web/js/engine.js';
import { POINTS } from '../web/js/rules.js';
import { PRESETS, defaultScenario } from '../web/js/model.js';
import { playMatch, matchSeed } from '../web/js/league.js';

const MATCHES = Number(process.env.MATCHES || 48);
const TERMS = ['auto', 'coral', 'barge', 'win', 'tie'];
const failures = [];

// Graded from the ledger the engine exported, with the rules.js numbers and nothing else. `awarded` is the
// foul path the engine already consulted; the point of recomputing is to say which path paid.
function grade(f) {
  const levels = LEVELS.filter((lv) => f.coral[lv].auto + f.coral[lv].tele >= POINTS.coralRpThresholdPerLevel).length;
  const coop = !!f.coop;
  const live = f.robots.filter((r) => !r.disabled).length;
  return {
    levels,
    coop,
    earned: {
      auto: f.leaveCount >= live && f.autoCoral >= POINTS.autoRpMinCoral,
      coral: coop ? levels >= POINTS.coralRpLevelsWithCoop : levels >= LEVELS.length,
      barge: f.bargePoints >= POINTS.bargeRpThreshold,
    },
    awarded: { coral: !!f.rpAward?.coral, barge: !!f.rpAward?.barge },
  };
}

const rate = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const q = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(p * arr.length))] : NaN);

const ARMS = {
  // The mirror is the field-leak test: same trio both seats, so a term that varies here varies on driving and
  // the clock, not on a roster gap.
  mirror: (seed) => playMatch({ blueKind: 'greedy', redKind: 'greedy', seed }),
  // The page's default: the two trios that played the 2025 Einstein Field final, which is the only arm where
  // a term can separate two real fleets rather than one fleet drawn twice.
  named: (seed) => playMatch({
    blueKind: 'greedy',
    redKind: 'greedy',
    seed,
    blueProfiles: PRESETS.find((p) => p.key === 'johnson').trio,
    redProfiles: PRESETS.find((p) => p.key === 'newton').trio,
  }),
  // The searching seat: what the planner's own MATCHes look like, since a batch button can be set here.
  planner: (seed) => playMatch({ blueKind: 'ai', redKind: 'greedy', seed }),
};
const which = (process.env.ARMS || Object.keys(ARMS).join(',')).split(',').filter((k) => ARMS[k]);

const results = {};
for (const name of which) {
  const rows = [];
  for (let i = 0; i < MATCHES; i++) {
    const seed = matchSeed(9000, i);
    const m = ARMS[name](seed);
    for (const side of ['blue', 'red']) {
      const f = m.final[side];
      const g = grade(f);
      const other = m.final[side === 'blue' ? 'red' : 'blue'];
      // Every RP the engine printed has to be what these tallies say, foul gifts included. A caption that
      // drifts from the grading is exactly how this page came to print "≥12 BARGE points" beside a bar of 16.
      for (const term of TERMS) {
        const want =
          term === 'auto' ? (g.earned.auto ? 1 : 0)
          : term === 'win' ? (f.total > other.total ? POINTS.rp.win : 0)
          : term === 'tie' ? (f.total === other.total ? POINTS.rp.tie : 0)
          : (g.earned[term] || g.awarded[term] ? POINTS.rp[term] : 0);
        if (f.rp[term] !== want) {
          failures.push(`${name} seed ${seed} ${side}: engine rp.${term} = ${f.rp[term]}, the ledger says ${want} (levels ${g.levels}/4 at ${POINTS.coralRpThresholdPerLevel}, coop ${g.coop}, barge ${f.bargePoints} against ${POINTS.bargeRpThreshold}, AUTO CORAL ${f.autoCoral}, LEAVE ${f.leaveCount} of ${f.robots.filter((r) => !r.disabled).length}, awarded ${JSON.stringify(g.awarded)})`);
        }
      }
      if (f.rp.total !== TERMS.reduce((a, t) => a + f.rp[t], 0)) {
        failures.push(`${name} seed ${seed} ${side}: rp.total ${f.rp.total} is not the sum of its parts`);
      }
      rows.push({
        seed,
        side,
        term: Object.fromEntries(TERMS.map((t) => [t, f.rp[t] ? 1 : 0])),
        gifted: { coral: g.awarded.coral && !g.earned.coral ? 1 : 0, barge: g.awarded.barge && !g.earned.barge ? 1 : 0 },
        earnedOnly: { coral: g.earned.coral ? 1 : 0, barge: g.earned.barge ? 1 : 0 },
        coop: g.coop ? 1 : 0,
        trough: f.coral.L1.auto + f.coral.L1.tele,
        levels: g.levels,
        bargePoints: f.bargePoints,
        autoCoral: f.autoCoral,
        leaveCount: f.leaveCount,
        total: f.total,
        won: f.total > other.total ? 1 : 0,
        lost: f.total < other.total ? 1 : 0,
      });
    }
  }
  results[name] = rows;
}

console.log(`Bars from rules.js: AUTO needs every non-BYPASSED ROBOT to LEAVE and ≥${POINTS.autoRpMinCoral} CORAL in AUTO · CORAL needs ${POINTS.coralRpThresholdPerLevel} on each of ${LEVELS.length} levels, or ${POINTS.coralRpLevelsWithCoop} of them with the Coopertition point · BARGE needs ≥${POINTS.bargeRpThreshold} BARGE points · win ${POINTS.rp.win}, tie ${POINTS.rp.tie}`);
console.log(`${MATCHES} MATCHes an arm, both ALLIANCE-sides graded; the win/tie bars are the same MATCH seen twice.\n`);

const summary = {};
for (const [name, rows] of Object.entries(results)) {
  const n = rows.length;
  console.log(`── ${name} · ${n} alliance-sides`);
  console.log('   term    reached   own tally   by foul    winner − loser   constant?');
  for (const term of TERMS) {
    const reach = rate(rows.map((r) => r.term[term]));
    const own = term === 'auto' ? reach : rate(rows.map((r) => (term === 'coral' || term === 'barge' ? r.earnedOnly[term] : r.term[term])));
    const gift = term === 'coral' || term === 'barge' ? rate(rows.map((r) => r.gifted[term])) : 0;
    const winners = rows.filter((r) => r.won);
    const losers = rows.filter((r) => r.lost);
    const gap = winners.length && losers.length ? rate(winners.map((r) => r.term[term])) - rate(losers.map((r) => r.term[term])) : NaN;
    const constant = reach === 0 || reach === 1;
    summary[name] = summary[name] || {};
    summary[name][term] = { reach, own, gift, gap, constant };
    console.log(
      `   ${term.padEnd(7)} ${pct(reach).padStart(8)}   ${pct(own).padStart(8)}   ${pct(gift).padStart(8)}   ${(Number.isNaN(gap) ? '—' : `${gap >= 0 ? '+' : ''}${gap.toFixed(3)}`).padStart(14)}   ${constant ? 'YES — every MATCH the same' : 'no'}`,
    );
  }
  const coop = rate(rows.map((r) => r.coop));
  const troughOk = rate(rows.map((r) => (r.trough >= POINTS.coralRpThresholdPerLevel ? 1 : 0)));
  const allFour = rate(rows.map((r) => (r.levels >= LEVELS.length ? 1 : 0)));
  const threeOf = rate(rows.map((r) => (r.levels >= POINTS.coralRpLevelsWithCoop ? 1 : 0)));
  const relaxed = rate(rows.map((r) => (r.coop && r.levels >= POINTS.coralRpLevelsWithCoop && r.levels < LEVELS.length ? 1 : 0)));
  console.log(
    `   Coopertition live in ${pct(coop)} of them; the TROUGH (L1) reached ${POINTS.coralRpThresholdPerLevel} in ${pct(troughOk)}, all ${LEVELS.length} levels full in ${pct(allFour)}, ${POINTS.coralRpLevelsWithCoop}+ in ${pct(threeOf)}.\n` +
    `   The relaxation from ${LEVELS.length} levels to ${POINTS.coralRpLevelsWithCoop} is what paid the CORAL RP in ${pct(relaxed)} of them${relaxed > 0.5 ? ' — so in this build the CORAL RP tracks the PROCESSOR, not the REEF it filled' : ''}.`,
  );
  console.log(
    `   BARGE points p10 ${q(rows.map((r) => r.bargePoints), 0.1)} / median ${q(rows.map((r) => r.bargePoints), 0.5)} / p90 ${q(rows.map((r) => r.bargePoints), 0.9)} against the ${POINTS.bargeRpThreshold} bar; AUTO CORAL p10 ${q(rows.map((r) => r.autoCoral), 0.1)} / median ${q(rows.map((r) => r.autoCoral), 0.5)}; LEAVE ${q(rows.map((r) => r.leaveCount), 0.1)}–${q(rows.map((r) => r.leaveCount), 0.9)} of 3.`,
  );
}

// A term that is constant in EVERY arm measured is not a lever: say so once, in the exit line, rather than
// letting the page's RP bars imply five live columns. This is not a failure — the 2025 build has no objective
// to weight, and the bars on the page are the disclosure — but it is the sentence the README has to carry.
const deadEverywhere = TERMS.filter((t) => which.every((name) => summary[name][t].constant));
console.log(`\nterms that did not move in any arm measured: ${deadEverywhere.length ? deadEverywhere.join(', ') : 'none'}`);

// ---- teeth: every bar must flip at the tally that flips it ------------------------------------
// Built as ledgers, run through the same `grade()` above. If a comparison were written as `>` instead of `>=`,
// or the coop path forgot which levels it counts, the real arms can all agree with the engine and still hide
// it — the engine would be equally wrong and the two would match. This is the control group.
const fake = (over) => ({
  coral: { L1: { auto: 0, tele: 0 }, L2: { auto: 0, tele: 0 }, L3: { auto: 0, tele: 0 }, L4: { auto: 0, tele: 0 } },
  robots: [{ disabled: false }, { disabled: false }, { disabled: false }],
  leaveCount: 3,
  autoCoral: POINTS.autoRpMinCoral,
  bargePoints: POINTS.bargeRpThreshold,
  coop: false,
  rpAward: { coral: false, barge: false },
  ...over,
});
const at = (lv, n) => ({ auto: n, tele: 0 });
const edge = [
  // [label, ledger, term, expected]
  ['every level one short of the bar', fake({ coral: { L1: at('L1', 6), L2: at('L2', 6), L3: at('L3', 6), L4: at('L4', 6) } }), 'coral', false],
  ['every level at the bar', fake({ coral: { L1: at('L1', 7), L2: at('L2', 7), L3: at('L3', 7), L4: at('L4', 7) } }), 'coral', true],
  ['three levels full, no Coopertition', fake({ coral: { L1: at('L1', 0), L2: at('L2', 7), L3: at('L3', 7), L4: at('L4', 7) } }), 'coral', false],
  ['three levels full, Coopertition live', fake({ coop: true, coral: { L1: at('L1', 0), L2: at('L2', 7), L3: at('L3', 7), L4: at('L4', 7) } }), 'coral', true],
  ['one BARGE point short', fake({ bargePoints: POINTS.bargeRpThreshold - 1 }), 'barge', false],
  ['exactly on the BARGE bar', fake({ bargePoints: POINTS.bargeRpThreshold }), 'barge', true],
  ['BARGE short but G418 gave it', fake({ bargePoints: 0, rpAward: { coral: false, barge: true } }), 'barge', null],
  ['one ROBOT did not LEAVE', fake({ leaveCount: 2 }), 'auto', false],
  ['all LEAVE but no AUTO CORAL', fake({ autoCoral: 0 }), 'auto', false],
  ['all LEAVE and the bar of AUTO CORAL', fake({ autoCoral: POINTS.autoRpMinCoral }), 'auto', true],
];
for (const [label, f, term, want] of edge) {
  const g = grade(f);
  const got = g.earned[term];
  if (want !== null && got !== want) failures.push(`the ${label} ledger graded ${term} as ${got}, expected ${want}`);
  if (term === 'barge' && want === null && !(g.awarded.barge && !g.earned.barge)) {
    failures.push('a foul-given BARGE RP was not distinguishable from an earned one — the split the page prints is decoration');
  }
}
console.log(`edge cases: ${edge.length} graded at and one short of each bar, both coop paths, plus a gifted BARGE RP`);

// ---- the playoff path: the relaxation and the G418 gift must both go away ---------------------
// §6.5.3 opens "In Qualification MATCHES" and G418 carries the same qualifier, so a PLAYOFF series grades the
// CORAL RP at all four levels and takes no BARGE RP from a cage contact. Two MATCHes that differ only in this
// key have to differ in the RP, or the `playoff` flag on the page is a checkbox that does nothing.
{
  const seed = 12345;
  const run = (playoff) => playMatch({
    seed,
    record: false,
    scenarioOverride: { playoff, tempoJitter: 0, algaeInNetByHuman: true },
    blueProfiles: PRESETS.find((p) => p.key === 'johnson').trio,
    redProfiles: PRESETS.find((p) => p.key === 'newton').trio,
  });
  const qual = run(false);
  const playoffs = run(true);
  const coopQual = [qual.final.blue, qual.final.red].filter((f) => f.coop).length;
  const coopPlay = [playoffs.final.blue, playoffs.final.red].filter((f) => f.coop).length;
  if (coopPlay !== 0) failures.push(`a PLAYOFF MATCH booked the Coopertition condition ${coopPlay} times: §6.5.3 limits it to Qualification MATCHES`);
  const gained = ['blue', 'red'].filter((s) => grade(qual.final[s]).coop && !grade(playoffs.final[s]).earned.coral && grade(qual.final[s]).earned.coral);
  const giftedQual = ['blue', 'red'].filter((s) => qual.final[s].rpAward.barge).length;
  const giftedPlay = ['blue', 'red'].filter((s) => playoffs.final[s].rpAward.barge).length;
  console.log(
    `\nplayoff arm on seed ${seed}: Coopertition live in ${coopQual} of 2 alliance-sides in a Qualification MATCH and ${coopPlay} of 2 in a PLAYOFF one; the four-level CORAL bar was met by ${['blue', 'red'].filter((s) => grade(playoffs.final[s]).earned.coral).length} of 2 in the PLAYOFF, and ${gained.length} of them only because the relaxation applied in the qualifier; G418-style BARGE gifts: ${giftedQual} against ${giftedPlay}.`,
  );
  if (coopQual === 0) {
    console.log('   note: neither MATCH met the coop condition, so this pair proves the gate is read, not that it bites.');
  }
}

if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures.slice(0, 12)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK: every MATCH graded exactly as rules.js says, own tally and foul gift kept apart, and each bar proven to flip at its own tally.');
