// The measurements quoted on the page (#data → "The ALGAE chain"). Run: npm run measure
//
// Each block is the A/B behind one published number, with n stated. The mirror trio is on both ALLIANCES
// so a difference here is the setting under test and not a ROBOT comparison.

import { playMatch, evaluate } from '../web/js/league.js';
import { SAMPLES, HUMAN_PLAYER } from '../web/js/model.js';
import { POINTS } from '../web/js/rules.js';

const N = 24;
const seedBase = 9000;
const one = (seed, scenarioOverride) => playMatch({ seed, scenarioOverride });
const batch = (scenarioOverride) => evaluate({ matches: N, seedBase, profiles: { blue: SAMPLES, red: SAMPLES }, scenarioOverride });
const both = (patch) => ({ humanPlayer: { blue: { ...HUMAN_PLAYER, ...patch }, red: { ...HUMAN_PLAYER, ...patch } } });
const side = (which, patch) => ({ humanPlayer: { [which]: { ...HUMAN_PLAYER, ...patch }, [which === 'blue' ? 'red' : 'blue']: { ...HUMAN_PLAYER } } });
const label = (t) => console.log(`\n${t}`);
const row = (name, e, m) => console.log(`${name.padEnd(26)} blue ${(e.avgBlue.toFixed(1) + ' ± ' + e.blueSe.toFixed(1)).padEnd(12)} red ${(e.avgRed.toFixed(1) + ' ± ' + e.redSe.toFixed(1)).padEnd(12)} margin ${(e.avgMargin.toFixed(1) + ' ± ' + e.marginSe.toFixed(1)).padEnd(12)} B proc/net ${m.final.blue.algae.processor}/${m.final.blue.algae.net} R proc/net ${m.final.red.algae.processor}/${m.final.red.algae.net}`);

label(`ALGAE chain, n=${N} mirror MATCHes (seedBase ${seedBase})`);
const own = [];
for (const acc of [0, 0.25, 0.5, 0.75, 1]) {
  const hp = side('blue', { accuracy: acc });
  const e = batch(hp);
  own.push(e.avgBlue);
  row(`blue HP accuracy ${acc}`, e, one(seedBase, hp));
}
// A sweep that moves nothing is not a result, and a silently-ignored override looks exactly like one.
if (Math.max(...own) - Math.min(...own) < 1) console.log('  !! blue HP accuracy did not move blue mean — the override is not reaching the engine');

label('the same from the other side: the supply a ROBOT prices');
for (const acc of [0, 0.5, 0.75, 1]) {
  const hp = side('red', { accuracy: acc });
  row(`red HP accuracy ${acc}`, batch(hp), one(seedBase, hp));
}

label('HP rates and the G435 area limit');
for (const [name, patch] of [['default', {}], ['throwSec 4', { throwSec: 4 }], ['chute feedSec 3', { feedSec: 3 }], ['chute feedSec 0.5', { feedSec: 0.5 }], ['area storage 1', { storage: 1 }]]) {
  const hp = both(patch);
  const e = batch(hp);
  const m = one(seedBase, hp);
  console.log(`${name.padEnd(26)} blue ${(e.avgBlue.toFixed(1) + ' ± ' + e.blueSe.toFixed(1)).padEnd(12)} NET/MATCH ${m.final.blue.algae.net + m.final.red.algae.net} · G435 overflow ${m.events.filter((x) => x.kind === 'overflow').length}`);
}
label(`the ROBOT's second ALGAE goal: a NET the machine can reach, n=${N} mirror MATCHes`);
// §6.1 gives the ROBOT two goals for an ALGAE and they are not the same trade: the PROCESSOR pays 6 and then
// hands the opponent an expected 4 x accuracy (§5.5), the NET pays 4 and hands them nothing — but the mesh's
// border is 6 ft 4 in up (§5.4.2) and the BARGE is a long way from the REEF. Whether that is worth driving
// is a route-and-time question, so it is measured rather than argued, on the reach the ROBOT does or does not
// have. The shipped trio DOES have it (`netScoreSec` 1.9 / 1.4 / 2.05 s, each one its own L4 time plus 0.5 s),
// so `as shipped` is the baseline row, `netScoreSec 0` is the ablation, and the sweep between 1.2 and 1.9 s is
// where the bid flips.
const reach = (sec) => sec === null ? SAMPLES : SAMPLES.map((p) => ({ ...p, placeSec: { ...p.placeSec }, netScoreSec: sec }));
const reachBatch = (sec, sb = seedBase) => {
  const profiles = reach(sec);
  return evaluate({ matches: N, seedBase: sb, profiles: { blue: profiles, red: profiles } });
};
for (const sec of [null, 0, 1.2, 1.9, 3]) {
  const e = reachBatch(sec);
  const m = playMatch({ seed: seedBase, blueProfiles: reach(sec), redProfiles: reach(sec) });
  const proc = m.final.blue.algae.processor + m.final.red.algae.processor;
  const net = m.final.blue.algae.net + m.final.red.algae.net;
  const dep = m.final.blue.algae.netByRobot + m.final.red.algae.netByRobot;
  console.log(`${`${sec === null ? 'as shipped' : 'netScoreSec ' + sec}`.padEnd(20)} blue ${(e.avgBlue.toFixed(1) + ' ± ' + e.blueSe.toFixed(1)).padEnd(12)} red ${(e.avgRed.toFixed(1) + ' ± ' + e.redSe.toFixed(1)).padEnd(12)} PROC ${String(proc).padStart(2)} NET ${String(net).padStart(2)} (ROBOT ${dep})`);
}
const pairedReach = (sec, sb = seedBase) => {
  const d = [];
  for (let i = 0; i < N; i++) {
    const seed = sb + i * 977;
    const a = playMatch({ seed, blueProfiles: reach(sec), redProfiles: reach(sec) }).final.blue.total;
    const b = playMatch({ seed, blueProfiles: reach(0), redProfiles: reach(0) }).final.blue.total;
    d.push(a - b);
  }
  const mu = d.reduce((a, b) => a + b, 0) / N;
  const se = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / (N - 1) / N);
  console.log(`${`${sec === null ? 'shipped reach' : 'reach ' + sec} vs none, seed ${sb}`.padEnd(38)} ${(mu >= 0 ? '+' : '') + mu.toFixed(1)} ± ${se.toFixed(1)} pts MATCHes (${d.filter((v) => v !== 0).length}/${N} scores differ)`);
};
for (const sec of [null, 1.2, 1.9, 3]) pairedReach(sec);
pairedReach(1.9, 21000);
// The two arms above are MIRRORS, so they can only show what the whole FIELD loses: an ALLIANCE's own NET is
// fed by the OPPONENT's PROCESSING (§5.5, §6.1), and a fleet that lifts its ALGAE in itself refuses both sides
// of that loop. What a team actually asks is the head-to-head — my machines can reach, theirs cannot — so the
// same seeds run with the reach on one side only. That margin is the price of the action, not this loss.
label('the same reach on ONE side only: the price a single ALLIANCE pays or gets');
for (const sec of [null, 1.2, 1.9]) {
  const e = evaluate({ matches: N, seedBase, profiles: { blue: reach(sec), red: reach(0) } });
  const d = [];
  for (let i = 0; i < N; i++) {
    const seed = seedBase + i * 977;
    const on = playMatch({ seed, blueProfiles: reach(sec), redProfiles: reach(0) });
    const off = playMatch({ seed, blueProfiles: reach(0), redProfiles: reach(0) });
    d.push((on.final.blue.total - on.final.red.total) - (off.final.blue.total - off.final.red.total));
  }
  const mu = d.reduce((a, b) => a + b, 0) / N;
  const se = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / (N - 1) / N);
  console.log(`${`${sec === null ? 'blue as shipped' : 'blue reach ' + sec}, red none`.padEnd(30)} blue ${(e.avgBlue.toFixed(1) + ' ± ' + e.blueSe.toFixed(1)).padEnd(12)} red ${(e.avgRed.toFixed(1) + ' ± ' + e.redSe.toFixed(1)).padEnd(12)} margin ${(e.avgMargin.toFixed(1) + ' ± ' + e.marginSe.toFixed(1)).padEnd(12)} paired margin shift vs neither ${(mu >= 0 ? '+' : '') + mu.toFixed(1)} ± ${se.toFixed(1)}`);
}

label(`AUTO cycle budget: the generic trio, n=${N} mirror MATCHes (seedBase ${seedBase})`);
// §6.4 gives AUTO 15 s and §6.5.2 judges LEAVE at the AUTO->TELEOP boundary, so the extra cycle is bought
// with the line crossing. `autoCycles` is a scripted-routine assumption rather than anything in the manual,
// which is why its price is printed next to the rules that bound it.
for (const cyc of [1, 2, 3]) {
  let coral = 0;
  let pts = 0;
  let leave = 0;
  let n = 0;
  for (let i = 0; i < N; i++) {
    const profiles = SAMPLES.map((p) => ({ ...p, placeSec: { ...p.placeSec }, autoCycles: cyc }));
    const m = playMatch({ seed: seedBase + i * 977, blueProfiles: profiles, redProfiles: profiles });
    for (const s of ['blue', 'red']) {
      const f = m.final[s];
      coral += f.coral.L1.auto + f.coral.L2.auto + f.coral.L3.auto + f.coral.L4.auto;
      pts += ['L1', 'L2', 'L3', 'L4'].reduce((a, lv) => a + f.coral[lv].auto * POINTS.coral[lv][0], 0);
      leave += f.leave;
      n += 1;
    }
  }
  console.log(`${`autoCycles ${cyc}`.padEnd(26)} AUTO CORAL ${(coral / n).toFixed(2)} an ALLIANCE · AUTO ${(pts / n).toFixed(1)} pts · LEAVE ${(leave / n).toFixed(2)}`);
}
label(`physics ablations: paired on the same ${N} seeds (blue total, arm A minus arm B)`);
// Paired, because the seed-to-seed spread of the new physics is several points and two independent means
// would swallow a real 5-point effect. Same seeds in both arms, difference per seed, then mean and se.
const paired = (armB, labelA, armA = {}, sb = seedBase) => {
  const d = [];
  for (let i = 0; i < N; i++) {
    const seed = sb + i * 977;
    d.push(one(seed, armA).final.blue.total - one(seed, armB).final.blue.total);
  }
  const m = d.reduce((a, b) => a + b, 0) / N;
  const se = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1) / N);
  const differ = d.filter((v) => v !== 0).length;
  console.log(`${labelA.padEnd(38)} ${(m >= 0 ? '+' : '') + m.toFixed(1)} ± ${se.toFixed(1)} pts MATCHes  (${differ}/${N} scores differ)`);
};
// The ramp row is on two seed bases because on one it was not distinguishable from zero, and a second
// base is the cheapest way to show that is the effect and not the sample.
paired({ turnRampOff: true }, 'shipped minus heading-snaps-at-one-tick');
paired({ turnRampOff: true }, '  same arm, seed base 21000', {}, 21000);
paired({ contactRestitution: -1 }, 'shipped minus no bumper impulse');
paired({ contactRestitution: -1 }, '  same arm, seed base 21000', {}, 21000);
paired({ algaeInNetByHuman: false }, 'shipped minus HUMAN PLAYER throws');
label(`the mirror's own margins: 96 seeds, the per-machine spread on and off`);
// Real reference for what a margin should look like: the three 2025 Einstein Field finals were 295-281,
// 274-285 and 276-293, so |margin| 14, 11, 17 (The Blue Alliance). Both ALLIANCES there were at the top of
// the field, which is the situation this mirror models.
const margins = (jitter) => {
  const abs = [];
  for (let i = 0; i < 96; i++) {
    const m = one(9000 + i * 977, { tempoJitter: jitter });
    abs.push(Math.abs(m.final.blue.total - m.final.red.total));
  }
  const mu = abs.reduce((a, b) => a + b, 0) / abs.length;
  const se = Math.sqrt(abs.reduce((a, b) => a + (b - mu) ** 2, 0) / (abs.length - 1) / abs.length);
  return { mu, se, ties: abs.filter((x) => x === 0).length, near: abs.filter((x) => x <= 3).length };
};
for (const j of [0, 0.1, 0.2, 0.4]) {
  const s = margins(j);
  console.log(`${`tempoJitter ${j.toFixed(2)}`.padEnd(38)} |margin| ${(s.mu.toFixed(1) + ' ± ' + s.se.toFixed(1)).padEnd(12)} exact ties ${s.ties}/96  within 3 points ${s.near}/96`);
}
for (const [name, chassis] of [['every ROBOT on swerve', 'swerve'], ['every ROBOT on tank', 'tank'], ['every ROBOT on mecanum', 'mecanum']]) {
  const profiles = SAMPLES.map((p) => ({ ...p, placeSec: { ...p.placeSec }, chassis }));
  const e = evaluate({ matches: N, seedBase, profiles: { blue: profiles, red: profiles } });
  console.log(`${name.padEnd(38)} blue ${(e.avgBlue.toFixed(1) + ' ± ' + e.blueSe.toFixed(1)).padEnd(13)} red ${(e.avgRed.toFixed(1) + ' ± ' + e.redSe.toFixed(1)).padEnd(13)} margin ${(e.avgMargin.toFixed(2) + ' ± ' + e.marginSe.toFixed(2)).padEnd(12)}`);
}

label('what one MATCH is made of at the shipped tempos');const m = one(12345, {});
for (const side of ['blue', 'red']) {
  const s = m.final[side];
  console.log(`${side.padEnd(26)} CORAL ${s.coralPoints} · ALGAE ${s.algaePoints} (proc ${s.algae.processor} + net ${s.algae.net}, ${s.algae.netByRobot} of them lifted in by a ROBOT) · LEAVE ${s.leave} · BARGE ${s.bargePoints} · fouls ${s.fouls} · total ${s.total}`);
}

label(`the placement model: does a CORAL stay on, n=${N} mirror MATCHes`);
// §6.5.1 scores an L2-L4 CORAL only "if the BRANCH is inside the volume of the CORAL", so the level that goes
// short is an observation, not a knob. The arm with the model off is the engine that filled all 60 branches
// and the 24-piece trough every MATCH, which is what the TBA ledger says a real ALLIANCE does NOT do (its
// 2025cmptx alliances averaged 15.1 trough CORAL against this fleet's 10.0).
const levels = (scenarioOverride, policyOpts = {}) => {
  const out = { L1: 0, L2: 0, L3: 0, L4: 0, dropped: 0, n: 0 };
  for (let i = 0; i < N; i++) {
    const f = playMatch({ seed: seedBase + i * 977, scenarioOverride, bluePolicyOpts: policyOpts, redPolicyOpts: policyOpts }).final;
    for (const s of ['blue', 'red']) {
      for (const lv of ['L1', 'L2', 'L3', 'L4']) out[lv] += f[s].coral[lv].auto + f[s].coral[lv].tele;
      out.dropped += f[s].robots.reduce((a, r) => a + r.dropped, 0);
      out.n += 1;
    }
  }
  return { ...out, per: out.n };
};
for (const [name, over, pol] of [['shipped (can miss)', {}, {}], ['placementRisk off', { placementRisk: false }, {}], ['never gives up a level', {}, { placeGiveUp: Infinity }]]) {
  const l = levels(over, pol);
  console.log(`${name.padEnd(26)} trough ${(l.L1 / l.per).toFixed(1)} · L2 ${(l.L2 / l.per).toFixed(1)} · L3 ${(l.L3 / l.per).toFixed(1)} · L4 ${(l.L4 / l.per).toFixed(1)} per ALLIANCE (12 branches, 24 trough) · ${(l.dropped / l.per).toFixed(1)} CORAL fell`);
}
paired({ placementRisk: false }, 'shipped minus the placement model');
paired({ placementRisk: false }, '  same arm, seed base 21000', {}, 21000);
paired({ contactFouls: false }, 'shipped minus the §7.4.4 trio (no press)');

label(`the deny actions, n=${N} paired MATCHes on two seed bases`);
// Three things the action set can now do that it could not before, each priced against the same seeds.
// The fleet is greedy on its own points, so the question is not whether the engine allows these — guard 24
// drives both deny sources on purpose and shows the books close — it is what they are worth.
const denyArm = (opts, over = {}) => {
  const own = [];
  const opp = [];
  for (const sb of [9000, 21000]) {
    for (let i = 0; i < N; i++) {
      const seed = sb + i * 977;
      const a = playMatch({ seed, bluePolicyOpts: opts, scenarioOverride: over });
      const b = playMatch({ seed, scenarioOverride: over });
      own.push(a.final.blue.total - b.final.blue.total);
      // What the press took off the opponent's OWN play — fouls credited to them excluded, because those are
      // the cost of the press, not its effect.
      opp.push((a.final.red.total - a.final.red.fouls) - (b.final.red.total - b.final.red.fouls));
    }
  }
  const stat = (d) => {
    const m = d.reduce((x, y) => x + y, 0) / d.length;
    return `${(m >= 0 ? '+' : '') + m.toFixed(1)} ± ${Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (d.length - 1) / d.length).toFixed(1)}`;
  };
  return `${stat(own)} own total, ${stat(opp)} off the opponent's, over ${own.length} paired`;
};
console.log(`${'one defender (blue seat 3)'.padEnd(26)} ${denyArm({ defendSlots: [2] })}`);
console.log(`${'  ... fouls off'.padEnd(26)} ${denyArm({ defendSlots: [2] }, { contactFouls: false })}`);
console.log(`${'  ... two defenders'.padEnd(26)} ${denyArm({ defendSlots: [1, 2] })}`);
// The two deny bids are already the shipped default; the arm that turns them off is what measures them.
console.log(`${'no CORAL theft'.padEnd(26)} ${denyArm({ coralTheft: false })}`);
console.log(`${'no opponent-REEF ALGAE'.padEnd(26)} ${denyArm({ enemyAlgae: false })}`);
// A silent arm is a result, not a bug: these two bids never win against the queue at home, so the deny
// sources are in the action set and out of the shipped plan. Guard 24 drives both on purpose to show the
// engine takes them; the numbers say greedy will not.
// The station spread is the other kind of arm: it takes nothing off the opponent at all, because the two
// CORAL STATIONs are each ALLIANCE's own furniture. What it moves is this fleet's cycle time, so the second
// column is expected to read about zero and the first is the whole result.
console.log(`${'station spread 0.91 s'.padEnd(26)} ${denyArm({ stationSpread: 0.91 })}`);
