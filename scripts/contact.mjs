// What the §7.4.4 opponent-contact family is calibrated against.
//
// engine.js's CONTACT_HIT_SEVERITY / CONTACT_TIP_SEVERITY / CONTACT_UNABLE_SEVERITY are thresholds on a
// severity this engine produces, so they have to be placed inside its own distribution rather than copied
// from the 2026 build. This script measures that distribution: it runs MATCHes with the floor at 0 and the
// damage probability at 0, which logs every collision and assesses none, so the sample comes from a MATCH
// that played normally.
//
// Two samples, because the one that matters is not the mirror fleet. Two greedy ALLIANCES working their own
// REEFs almost never touch — the first arm below is the evidence — so a threshold placed against that sample
// would be placed against nothing. The second arm fields a defender, which is the play that produces contact
// and therefore the play the trio prices.
//
// Run: npm run contact

import { playMatch } from '../web/js/league.js';

const N = 24;
const BASES = [9000, 21000];
const PROBE = { contactHitSeverity: 0, contactImpairP: 0 };

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

const arms = [
  ['two greedy fleets', {}],
  ['one defender (blue slot 2)', { defendSlots: [2] }],
  ['two defenders (blue slots 1-2)', { defendSlots: [1, 2] }],
];

for (const [label, pol] of arms) {
  for (const base of BASES) {
    const hits = [];
    for (let i = 0; i < N; i++) {
      const m = playMatch({ seed: base + i, bluePolicyOpts: pol, scenarioOverride: PROBE });
      hits.push(...m.contactHits);
    }
    console.log(
      `${label} seedBase ${base}: ${hits.length} collisions over ${N} MATCHes (${(hits.length / N).toFixed(1)} a MATCH) ` +
      `median ${q(hits, 0.5)} p90 ${q(hits, 0.9)} p95 ${q(hits, 0.95)} p99 ${q(hits, 0.99)} max ${hits.length ? Math.max(...hits) : '—'}`,
    );
  }
}

// What the shipped thresholds actually hand out, on the same paired seeds. `foulLog.points` is what the
// fouls cost, and the raw columns are the score without them, so the two halves of a defender's bill —
// the machine it is not cycling and the points it donates — stay separable.
const tally = {};
for (const base of BASES) {
  const per = [];
  let points = 0;
  for (let i = 0; i < N; i++) {
    const m = playMatch({ seed: base + i, bluePolicyOpts: { defendSlots: [2] } });
    const n = m.foulLog.blue.minor + m.foulLog.blue.major + m.foulLog.red.minor + m.foulLog.red.major;
    per.push(n);
    points += m.foulLog.blue.points + m.foulLog.red.points;
    for (const side of ['blue', 'red']) {
      for (const rb of m.final[side].robots) {
        for (const [c, k] of Object.entries(rb.fouls)) tally[`${c}:${side[0]}`] = (tally[`${c}:${side[0]}`] || 0) + k;
      }
    }
  }
  const all = per.reduce((a, x) => a + x, 0);
  console.log(`with one defender, seedBase ${base}: ${(all / N).toFixed(1)} fouls a MATCH (${per.join(', ')}) for ${(points / N).toFixed(1)} points`);
}
console.log('fouls by code over 48 MATCHes:', JSON.stringify(tally));
