// Does the fast model rank plans the way the tick engine does?
//
// The planner in web/js/fastsim.js compares candidate plans analytically because a search cannot afford
// 1500 engine ticks per candidate. That is only legitimate if the model's ORDERING of plans matches what
// the engine produces, so this script runs the same handful of plans through both and prints the
// comparison. It first FITS the one scalar the model is missing (`efficiency`) against the engine's CORAL
// count on the shipped plan — the analytic cycle is faster than a robot that has to turn, be pushed off a
// hexagon and back out of a corner queue — then checks whether the fitted model still ranks the plans
// correctly. A model that ranks them wrongly is a reason not to ship the planner, not a reason to tune
// until the plot looks nice.
//
// Run: npm run fastsim

import { playMatch } from '../web/js/league.js';
import { simulateMatch, INTENT } from '../web/js/engine.js';
import { greedyPolicy } from '../web/js/policy.js';
import { SAMPLES, defaultScenario, layout } from '../web/js/model.js';
import { makeContext, estimateAlliance, planValue, DEFAULT_PLAN } from '../web/js/fastsim.js';

const N = 24;
const BASES = [9000, 21000];
const L3 = ['L3', 'L4', 'L2', 'L1'];
const PLANS = [
  ['shipped: L4 first, 20 s', DEFAULT_PLAN],
  ['L3 first, 20 s', { ...DEFAULT_PLAN, placeOrder: L3 }],
  ['L4 first, 12 s', { ...DEFAULT_PLAN, climbWindowSec: 12 }],
  ['L4 first, 6 s', { ...DEFAULT_PLAN, climbWindowSec: 6 }],
  ['L3 first, 6 s', { ...DEFAULT_PLAN, placeOrder: L3, climbWindowSec: 6 }],
  ['one on ALGAE, 12 s', { ...DEFAULT_PLAN, climbWindowSec: 12, algaeSlots: [2] }],
  // The spread is the plan field the fleet's own bid has to run, so the engine arm asks for it in the policy's
  // units (seconds of drive per teammate on the corner) while the model arm reads the plan flag.
  ['station spread, 6 s', { ...DEFAULT_PLAN, climbWindowSec: 6, spread: true }],
];

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const se = (a) => {
  const mu = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1) / a.length);
};
const geo = layout();
const scenario = defaultScenario();
const toOpts = (plan) => ({
  placeOrder: plan.placeOrder,
  climbWindowSec: plan.climbWindowSec,
  algaeSlots: plan.algaeSlots,
  // the plan flag in the policy's own units: seconds of drive a machine will pay to avoid a corner a
  // teammate is bound for, which is what `SPREAD_PENALTY` is in `fastsim.js`.
  stationSpread: plan.spread ? 0.91 : 0,
});

function engineArm(base, plan) {
  const totals = [];
  const coral = [];
  const algae = [];
  for (let i = 0; i < N; i++) {
    const f = playMatch({ seed: base + i * 977, bluePolicyOpts: toOpts(plan), redPolicyOpts: toOpts(plan) }).final.blue;
    totals.push(f.total);
    coral.push(['L1', 'L2', 'L3', 'L4'].reduce((a, lv) => a + f.coral[lv].auto + f.coral[lv].tele, 0));
    algae.push(f.algae.processor);
  }
  return { totals, coral, algae };
}

// The model's cycle is a straight drive plus the action times; the engine's is the same robot fighting
// its own teammates for a corner. One scalar carries that difference, and it is fitted here so the number
// is reproducible rather than a constant somebody liked.
function modelEstimate(plan, efficiency) {
  const ctx = makeContext({ profiles: SAMPLES, geo, side: 'blue', scenario });
  ctx.efficiency = efficiency;
  return estimateAlliance(ctx, plan);
}

function fitEfficiency(targetCoral) {
  let lo = 0.8;
  let hi = 4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (modelEstimate(DEFAULT_PLAN, mid).coral > targetCoral) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

for (const base of BASES) {
  const shipped = engineArm(base, DEFAULT_PLAN);
  const targetCoral = mean(shipped.coral);
  const eff = fitEfficiency(targetCoral);
  const mShipped = modelEstimate(DEFAULT_PLAN, eff);
  const vShipped = planValue(mShipped);
  console.log(`\nseed base ${base}: engine (n=${N} mirror MATCHes, blue side) against the analytic model`);
  console.log(`  fitted efficiency ${(eff).toFixed(3)} — model cycle times are that multiple of the straight-line estimate`);
  console.log(`  shipped plan: CORAL engine ${targetCoral.toFixed(1)} · model ${mShipped.coral.toFixed(1)} (fitted), ALGAE engine ${mean(shipped.algae).toFixed(1)} · model ${mShipped.algae}, total engine ${mean(shipped.totals).toFixed(1)} · model ${mShipped.total.toFixed(1)} · plan value ${vShipped.toFixed(1)}`);
  const rows = [];
  for (let k = 1; k < PLANS.length; k++) {
    const arm = engineArm(base, PLANS[k][1]);
    const m = modelEstimate(PLANS[k][1], eff);
    // Both sides of the comparison are ONE ALLIANCE'S POINTS, because both sides are played the same plan: in a
    // mirror the margin a plan wins is symmetric by construction and carries no signal, while what a plan is
    // worth shows up in how many points the fleet that runs it banks. The margin terms `planValue` reads
    // (the ALGAE the opponent's HUMAN PLAYER converts, the fouls a crossing donates) are checked where they
    // are not symmetric — one-sided arms in `npm run verify` guard 26.
    const d = arm.totals.map((v, i) => v - shipped.totals[i]);
    rows.push({ name: PLANS[k][0], eng: mean(d), engSe: se(d), fastD: m.total - mShipped.total, valueD: planValue(m) - vShipped, differ: d.filter((x) => x !== 0).length });
    console.log(`  ${PLANS[k][0].padEnd(24)} engine ${(mean(d) >= 0 ? '+' : '') + mean(d).toFixed(1)} ± ${se(d).toFixed(1)} pts (${d.filter((x) => x !== 0).length}/${N} differ) · model ${(m.total - mShipped.total >= 0 ? '+' : '') + (m.total - mShipped.total).toFixed(1)} pts · value ${(planValue(m) - vShipped >= 0 ? '+' : '') + (planValue(m) - vShipped).toFixed(1)} (donated ${m.donated.toFixed(1)}) · CORAL ${m.coral.toFixed(1)} ALGAE ${m.algae} BARGE ${m.barge.deep}D/${m.barge.shallow}S/${m.barge.park}P/${m.barge.missed}x RP ${m.rp.auto}/${m.rp.coral}/${m.rp.barge}`);
  }
  const engOrder = [...rows].sort((a, b) => b.eng - a.eng);
  // Position-exact agreement over five arms is a harsh and noisy metric: two arms whose ENGINE difference is
  // inside the error bar have no order to reproduce. So the test is pairwise and only counts the pairs the
  // engine can actually separate — which is the question the planner cares about, since it reads an ordering.
  const pairs = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const se = Math.hypot(a.engSe, b.engSe);
      pairs.push({ a: a.name, b: b.name, gap: a.eng - b.eng, se, decidable: Math.abs(a.eng - b.eng) > 2 * se, ok: Math.sign(a.eng - b.eng) === Math.sign(a.fastD - b.fastD) });
    }
  }
  const decidable = pairs.filter((p) => p.decidable);
  const agree = decidable.filter((p) => p.ok).length;
  const wrongSign = rows.filter((r) => Math.abs(r.eng) > 2 * r.engSe && Math.sign(r.eng) !== Math.sign(r.fastD));
  const wrongSize = rows.filter((r) => Math.abs(r.eng - r.fastD) > 4);
  console.log(`  pairwise agreement ${agree}/${decidable.length} decidable of ${pairs.length} pairs · engine order ${engOrder.map((r) => r.name.split(',')[0]).join(' > ')}`);
  for (const p of decidable.filter((x) => !x.ok)) console.log(`  ?? order flipped: ${p.a} vs ${p.b} (engine gap ${p.gap.toFixed(1)} ± ${p.se.toFixed(1)})`);
  if (wrongSign.length) console.log(`  !! wrong SIGN: ${wrongSign.map((r) => `${r.name} (engine ${r.eng.toFixed(1)}, model ${r.fastD.toFixed(1)})`).join(' | ')}`);
  if (wrongSize.length) console.log(`  ~ off by more than 4 pts: ${wrongSize.map((r) => `${r.name} (engine ${r.eng.toFixed(1)} vs model ${r.fastD.toFixed(1)})`).join(' | ')}`);
}

// The tail, measured rather than estimated. `fastsim.js` prices a climb from the REEF face and deliberately
// does NOT apply the fitted traffic factor to that leg; the claim it rests on is that interrupting a drive
// costs nothing, because the engine re-decides every 0.2 s while a ROBOT is moving. This is the number that
// says so: when the fleet asks to climb, how long to the pipe, and what the BARGE column ends up worth at
// each window. If an early commit ever starts costing CAGE points, the model's window ranking is wrong and
// the planner is choosing the endgame off a broken lever.
const TAIL_N = 12;

function tailProbe(window, seed) {
  const asked = [];
  const inner = greedyPolicy('blue', { climbWindowSec: window });
  const pol = {
    reset: () => inner.reset(),
    onPeriodStart: (p, o) => inner.onPeriodStart?.(p, o),
    configure: (patch) => inner.configure(patch),
    decide(rb, obs) {
      const w = inner.decide(rb, obs);
      if (w?.mode === INTENT.CLIMB && !asked.some((a) => a.slot === rb.slot)) asked.push({ slot: rb.slot, t: obs.t });
      return w;
    },
  };
  const r = simulateMatch({
    blueProfiles: SAMPLES,
    redProfiles: SAMPLES,
    bluePolicy: pol,
    redPolicy: greedyPolicy('red', { climbWindowSec: window }),
    scenario: { ...defaultScenario(), seed },
    record: true,
  });
  const on = new Map();
  for (const f of r.frames) {
    for (const rb of f.robots) {
      if (rb.side === 'blue' && rb.climb && !on.has(rb.slot)) on.set(rb.slot, f.t);
    }
  }
  return { asked, on, barge: r.final.blue.barge };
}

console.log(`\nthe endgame tail (${TAIL_N} mirror MATCHes per window, blue side read)`);
for (const window of [6, 12, 20]) {
  const rows = [];
  for (let i = 0; i < TAIL_N; i++) rows.push(tailProbe(window, 9000 + i * 977));
  const req = [];
  const lat = [];
  for (const r of rows) {
    for (const a of r.asked) {
      req.push(a.t);
      const l = r.on.get(a.slot);
      if (l !== undefined) lat.push(l - a.t);
    }
  }
  const per = (k) => rows.reduce((a, r) => a + r.barge[k], 0) / rows.length;
  console.log(`  commit with ${String(window).padStart(2)} s left: asks at t=${mean(req).toFixed(1)} (max ${Math.max(...req).toFixed(1)}), on the pipe ${(mean(lat) >= 0 ? '' : '-')}${mean(lat).toFixed(2)} s later (max ${Math.max(...lat).toFixed(2)}) · BARGE ${per('deep').toFixed(2)} DEEP / ${per('shallow').toFixed(2)} SHALLOW / ${per('park').toFixed(2)} PARK`);
}
