// The measurements quoted on the page (#data → "The ALGAE chain"). Run: npm run measure
//
// Each block is the A/B behind one published number, with n stated. The mirror trio is on both ALLIANCES
// so a difference here is the setting under test and not a ROBOT comparison.

import { playMatch, evaluate } from '../web/js/league.js';
import { SAMPLES, PRESETS, HUMAN_PLAYER, layout } from '../web/js/model.js';
import { reefPenetration } from '../web/js/engine.js';
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

label(`the NET's two changes (lanes + a ceiling), paired n=${N} mirror MATCHes on both seed bases`);
// #117. `netLaneSpread: false` puts every stand-off back at the middle of the 12 ft face — the engine the
// replay was made before — and `netCapacity: 18` takes the ceiling off the mesh, because §6.5.1 caps nothing
// and the 9 is geometry (three 16 in rings along each 48 in lane, §5.4.2 + §5.7.2). They are priced apart
// because they are two claims: one about traffic, one about a resource that runs out.
const netArm = (sb, over) => {
  const rows = [];
  for (let i = 0; i < N; i++) {
    const m = playMatch({ seed: sb + i * 977, rosterIdx: i, scenarioOverride: over, blueProfiles: SAMPLES, redProfiles: SAMPLES });
    rows.push({
      sum: m.final.blue.total + m.final.red.total,
      net: m.final.blue.algae.net + m.final.red.algae.net,
      proc: m.final.blue.algae.processor + m.final.red.algae.processor,
      unstick: m.events.filter((e) => e.kind === 'unstick').length,
    });
  }
  return rows;
};
const netMean = (rs, k) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
const netDelta = (a, b, k) => {
  const d = a.map((r, i) => b[i][k] - r[k]);
  const m = d.reduce((s, v) => s + v, 0) / N;
  const se = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (N - 1) / N);
  return `${(m >= 0 ? '+' : '') + m.toFixed(2)} ± ${se.toFixed(2)} (${d.filter((v) => v !== 0).length}/${N} differ)`;
};
const NET_LANES_OFF = { netLaneSpread: false, netCapacity: 18 };
for (const sb of [9000, 21000]) {
  const A = netArm(sb, NET_LANES_OFF); // the engine before #117
  const B = netArm(sb, { netCapacity: 18 }); // lanes only
  const C = netArm(sb, { netLaneSpread: false }); // ceiling only
  const D = netArm(sb, {}); // shipped
  console.log(`  seed base ${sb}: A one point/18 rings sum ${netMean(A, 'sum').toFixed(1)} NET ${netMean(A, 'net').toFixed(2)} PROC ${netMean(A, 'proc').toFixed(2)} unstick ${netMean(A, 'unstick').toFixed(1)}`);
  console.log(`             B lanes/18     sum ${netMean(B, 'sum').toFixed(1)} NET ${netMean(B, 'net').toFixed(2)} PROC ${netMean(B, 'proc').toFixed(2)} unstick ${netMean(B, 'unstick').toFixed(1)}`);
  console.log(`             C one point/9   sum ${netMean(C, 'sum').toFixed(1)} NET ${netMean(C, 'net').toFixed(2)} PROC ${netMean(C, 'proc').toFixed(2)} unstick ${netMean(C, 'unstick').toFixed(1)}`);
  console.log(`             D shipped       sum ${netMean(D, 'sum').toFixed(1)} NET ${netMean(D, 'net').toFixed(2)} PROC ${netMean(D, 'proc').toFixed(2)} unstick ${netMean(D, 'unstick').toFixed(1)}`);
  console.log(`    lanes alone  B-A: sum ${netDelta(A, B, 'sum')} | NET ${netDelta(A, B, 'net')} | PROC ${netDelta(A, B, 'proc')} | unstick ${netDelta(A, B, 'unstick')}`);
  console.log(`    ceiling alone C-A: sum ${netDelta(A, C, 'sum')} | NET ${netDelta(A, C, 'net')} | PROC ${netDelta(A, C, 'proc')}`);
  console.log(`    both together D-A: sum ${netDelta(A, D, 'sum')} | NET ${netDelta(A, D, 'net')} | PROC ${netDelta(A, D, 'proc')} | unstick ${netDelta(A, D, 'unstick')}`);
}
// The one-sided reach arm reversed sign under the ceiling, so it is printed on both settings of it: the
// alliance that lifts its own rings can no longer spend more than nine of them there.
label(`one side has the lift and the other does not: what the ceiling does to that arm (n=${N})`);
for (const cap of [18, 9]) {
  for (const sb of [9000, 21000]) {
    const d = [];
    for (let i = 0; i < N; i++) {
      const seed = sb + i * 977;
      const m = playMatch({
        seed,
        rosterIdx: i,
        scenarioOverride: { netCapacity: cap },
        blueProfiles: SAMPLES,
        redProfiles: SAMPLES.map((p) => ({ ...p, netScoreSec: 0 })),
      });
      d.push(m.final.blue.total - m.final.red.total);
    }
    const mean = d.reduce((a, b) => a + b, 0) / N;
    const se = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / (N - 1) / N);
    console.log(`  netCapacity ${cap}, seed base ${sb}: margin ${(mean >= 0 ? '+' : '') + mean.toFixed(1)} ± ${se.toFixed(1)} for the lifting alliance`);
  }
}
label(`AUTO cycle budget: the generic trio, n=${N} mirror MATCHes (seedBase ${seedBase})`);// §6.4 gives AUTO 15 s and §6.5.2 judges LEAVE at the AUTO->TELEOP boundary, so the extra cycle is bought
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
label('the press per second of ring held');
// `policy.js` prices a press the way a drive team does: what does one second of shadowing buy over the second
// of cycling it costs? So the denominator is the seconds the machine actually spent in the ring (the engine's
// own `defendSec`), not the MATCH, and the numerator is the scoreline MARGIN on the TOTALS — a foul the
// defender donates is points the other alliance really gets, and hiding them in a "play" column is how a press
// that loses matches came to look like one that wins.
{
  const d = [];
  const sec = [];
  for (const sb of [9000, 21000]) {
    for (let i = 0; i < N; i++) {
      const seed = sb + i * 977;
      const a = playMatch({ seed });
      const b = playMatch({ seed, bluePolicyOpts: { defendSlots: [2] } });
      const held = (m) => m.final.blue.robots.reduce((s, r) => s + r.defend, 0);
      sec.push(held(b) - held(a));
      d.push((b.final.blue.total - b.final.red.total) - (a.final.blue.total - a.final.red.total));
    }
  }
  const m = d.reduce((x, y) => x + y, 0) / d.length;
  const se = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1) / d.length);
  const ps = sec.reduce((x, y) => x + y, 0) / sec.length;
  console.log(`${'one seat in the ring'.padEnd(26)} margin ${m >= 0 ? '+' : ''}${m.toFixed(2)} ± ${se.toFixed(2)} `
    + `over ${ps.toFixed(1)} s a MATCH of ring = ${(m / (ps || 1)).toFixed(3)} a press-second`);
}

label(`the planner's budget pins: planner against the same planner with the rules off (n=${N * 2}, 24 on each base)`);
// Four of the planner's pins have no equivalent in the baseline — a cycle has to have clock left before it is
// started, the hopper is emptied before a climb, a piece a teammate is bound for is not chased, and its AUTO
// routine does not send three machines at the same CORAL MARK. A fifth (a press priced per second) is measured
// in the DEFEND arm above. Per column, because "the total went up" does not say whether the climb was bought by
// parking machines.
{
  const seeds = [];
  for (const sb of [9000, 21000]) for (let i = 0; i < N; i++) seeds.push(sb + i * 977);
  const noPins = { cycleCutoffSec: 0, spendBeforeClimb: false, pieceSpread: 0, autoCrowdSec: 0 };
  const cols = (m) => ({
    total: m.final.blue.total + m.final.red.total,
    coral: m.final.blue.coralPoints + m.final.red.coralPoints,
    algae: m.final.blue.algaePoints + m.final.red.algaePoints,
    barge: m.final.blue.bargePoints + m.final.red.bargePoints,
    deep: m.final.blue.barge.deep + m.final.red.barge.deep,
    shallow: m.final.blue.barge.shallow + m.final.red.barge.shallow,
    park: m.final.blue.barge.park + m.final.red.barge.park,
    leave: m.final.blue.leave + m.final.red.leave,
    autoCoral: m.final.blue.autoCoral + m.final.red.autoCoral,
  });
  const run = (opts) => seeds.map((seed) => cols(playMatch({ blueKind: 'ai', redKind: 'ai', seed, bluePolicyOpts: opts, redPolicyOpts: opts })));
  const on = run({});
  const off = run(noPins);
  const mean = (rows, k) => rows.reduce((s, c) => s + c[k], 0) / rows.length;
  const diff = (k) => {
    const d = mean(on, k) - mean(off, k);
    return `${k} ${(d >= 0 ? '+' : '') + d.toFixed(2)}`;
  };
  console.log(`${'pins on minus off'.padEnd(26)} ${['total', 'coral', 'algae', 'barge', 'deep', 'shallow', 'park', 'leave', 'autoCoral'].map(diff).join(' ')}`);
  // A switch that silently stopped reaching the policy reads exactly like a pin worth nothing.
  if (Math.abs(mean(on, 'total') - mean(off, 'total')) < 1) console.log('  !! the pins did not move the planner — the four switches are not reaching policy.js');
}

label(`AUTO supply, and what the routine does with the seconds it has (n=${N} mirror MATCHes, both seats)`);
// The AUTO column is the one the 2025cmptx_f1m1 ledger puts at 9 CORAL an ALLIANCE (all of them on L4, because
// 9 x 7 = 63 is what its AUTO row has to be for 295 to add up) and the fleet here lands 7.29 for the named
// preset and 6.25 for the generic trio. Four explanations were tested; three died here — the scripted
// `autoCycles` pin, the straight-line budget's own conservatism, and the per-team `auto_coral` rounding the preset
// file could have used instead of the alliance split — and the fourth, de-conflicting the three machines off one
// CORAL MARK, is what the planner pins at 1.5 s (guard 30).
// What is left is the clock — an ALLIANCE can reach 3 preloads plus its 3 CORAL MARKS without leaving its own
// half, and the ninth piece has to come off a CORAL STATION pocket ~190 in away at the corner where the
// ALLIANCE WALL meets the guardrail, which the budget test says does not fit with the cross of the line in it.
{
  const LVS = ['L1', 'L2', 'L3', 'L4'];
  const autoOf = (f) => LVS.reduce((a, lv) => a + f.coral[lv].auto, 0);
  const ptsOf = (f) => LVS.reduce((a, lv) => a + f.coral[lv].auto * POINTS.coral[lv][0], 0);
  const seeds = [];
  for (let i = 0; i < N; i++) seeds.push(seedBase + i * 977);
  // (1) Is `REF_CORAL_PER_ROBOT` the base machine's real throughput? The named presets are built by scaling
  // SAMPLES[0] by REF / (that team's CORAL column), so if REF is not what the unscaled machine actually scores
  // the whole named file is systematically slow.
  const baseThree = [SAMPLES[0], SAMPLES[0], SAMPLES[0]];
  let baseCoral = 0;
  for (const seed of seeds) {
    const m = playMatch({ seed, blueProfiles: baseThree, redProfiles: baseThree });
    for (const side of ['blue', 'red']) baseCoral += LVS.reduce((x, lv) => x + m.final[side].coral[lv].auto + m.final[side].coral[lv].tele, 0);
  }
  const baseRobot = baseCoral / (seeds.length * 2) / 3;
  console.log(`  base machine (SAMPLES[0] three-up): ${baseRobot.toFixed(2)} CORAL a ROBOT a MATCH, which is what`
    + ` REF_CORAL_PER_ROBOT claims (16.5) — the named file is fitted against that, so a wrong claim here would make`
    + ` every named machine systematically slow`);
  if (Math.abs(baseRobot - 16.5) > 3) console.log(`  !! the base machine scores ${baseRobot.toFixed(2)}, not 16.5 — REF_CORAL_PER_ROBOT needs refitting`);
  // (2) Where the AUTO pieces come from, and how much of the 15 s the routine leaves unused. The rows are read
  // after the arms below, so the closing paragraph quotes the same batch rather than a copy of an old one.
  const supply = (name, profiles) => {
    const pick = { mark: 0, station: 0, loose: 0 };
    let idle = 0; let ticks = 0; let sides = 0; let stationLeft = 0; let auto = 0;
    for (const seed of seeds) {
      const m = playMatch({ seed, blueProfiles: profiles, redProfiles: profiles, record: true });
      // The floor record carries ALGAE too, and §6.3.4.2 stages six of them on the same MARKS the CORAL sit on;
      // without the kind filter a CORAL pick beside an ALGAE mark reads as a MARK pick.
      const marks = m.frames[0].floor.filter((f) => f.side === 'blue' && f.kind === 'coral').map((f) => [f.x, f.y]);
      const held = {}; const aiming = {};
      for (const fr of m.frames) {
        if (fr.t >= 15) break;
        for (const r of fr.robots) {
          if (r.side !== 'blue') continue;
          ticks += 1;
          if (!r.busy && (r.intent === 'idle' || !r.intent)) idle += 1;
          // A recorded frame carries its target as a `[x, y]` pair, not an object.
          if (r.busy === 'fetch-coral' && r.target) aiming[r.slot] = [r.target[0], r.target[1]];
          const had = held[r.slot] ?? 0;
          if (r.coral > had) {
            const [tx, ty] = aiming[r.slot] ?? [r.x, r.y];
            // The MARK test has to come first: #123 put the marks 38 in off the ALLIANCE WALL, inside the x
            // band this used to reserve for the STATION corners, and the fleet's AUTO picks all read as
            // station picks.
            if (marks.some(([x, y]) => Math.hypot(x - tx, y - ty) < 12)) pick.mark += 1;
            else if (tx < 60) pick.station += 1;
            else pick.loose += 1;
          }
          held[r.slot] = r.coral;
        }
        if (fr.t > 14.7) { stationLeft += fr.stations.blue.reduce((a, b) => a + b, 0); sides += 1; }
      }
      auto += autoOf(m.final.blue);
    }
    const n = pick.mark + pick.station + pick.loose;
    console.log(`  ${name.padEnd(14)} AUTO ${(auto / seeds.length).toFixed(2)} an ALLIANCE · AUTO picks: ${(pick.mark / N).toFixed(2)} at a MARK`
      + ` (${(100 * pick.mark / n).toFixed(0)}%), ${(pick.station / N).toFixed(2)} at its own STATION (${(100 * pick.station / n).toFixed(0)}%),`
      + ` ${(pick.loose / N).toFixed(2)} re-picked loose (${(100 * pick.loose / n).toFixed(0)}%)`
      + ` · idle ${(100 * idle / ticks).toFixed(0)}% of AUTO robot-seconds`
      + ` · ${(stationLeft / sides).toFixed(1)} of the station's 57 CORAL still there at the whistle`);
    return { auto: auto / seeds.length, loosePct: 100 * pick.loose / n, idlePct: 100 * idle / ticks, stationLeft: stationLeft / sides };
  };
  // (3) The arms that decide whether the shortfall is a decision or a drive. Each row is the same 24 seeds run
  // twice, both seats, so the error bar is the paired difference and not the seed-to-seed spread. TELEOP is on
  // every row because the question is not whether an arm moves the AUTO column but what it moves it out of.
  const paired = (label, profA, profB = profA, optsA = {}, optsB = {}) => {
    const d = { auto: [], autoPts: [], leave: [], tele: [], coral: [], total: [] };
    for (const seed of seeds) {
      const a = playMatch({ seed, blueProfiles: profA, redProfiles: profA, bluePolicyOpts: optsA, redPolicyOpts: optsA });
      const b = playMatch({ seed, blueProfiles: profB, redProfiles: profB, bluePolicyOpts: optsB, redPolicyOpts: optsB });
      for (const side of ['blue', 'red']) {
        d.auto.push(autoOf(a.final[side]) - autoOf(b.final[side]));
        d.autoPts.push(ptsOf(a.final[side]) - ptsOf(b.final[side]));
        d.leave.push(a.final[side].leave - b.final[side].leave);
        d.total.push(a.final[side].total - b.final[side].total);
        d.tele.push(LVS.reduce((x, lv) => x + a.final[side].coral[lv].tele, 0)
          - LVS.reduce((x, lv) => x + b.final[side].coral[lv].tele, 0));
        d.coral.push(LVS.reduce((x, lv) => x + a.final[side].coral[lv].auto + a.final[side].coral[lv].tele, 0)
          - LVS.reduce((x, lv) => x + b.final[side].coral[lv].auto + b.final[side].coral[lv].tele, 0));
      }
    }
    const stat = (k) => {
      const m = d[k].reduce((x, y) => x + y, 0) / d[k].length;
      const se = Math.sqrt(d[k].reduce((s, v) => s + (v - m) ** 2, 0) / (d[k].length - 1) / d[k].length);
      return { m, se, s: `${(m >= 0 ? '+' : '') + m.toFixed(2)} ± ${se.toFixed(2)}` };
    };
    const st = (k) => `${k} ${stat(k).s}`;
    console.log(`  ${label.padEnd(34)} ${['auto', 'autoPts', 'tele', 'coral', 'leave', 'total'].map(st).join(' · ')}`);
    return Object.fromEntries(['auto', 'autoPts', 'tele', 'coral', 'leave', 'total'].map((k) => [k, stat(k)]));
  };
  const john = PRESETS.find((p) => p.key === 'johnson').trio;
  const repin = (trio, pins) => trio.map((p, i) => ({ ...p, placeSec: { ...p.placeSec }, autoCycles: pins[i] }));
  const pCrowd = paired('AUTO de-conflict 1.5 s', john, john, { autoCrowdSec: 1.5 });
  const pCrowdGeneric = paired('  same arm, generic trio', SAMPLES, SAMPLES, { autoCrowdSec: 1.5 });
  const pSlack0 = paired('budget slack taken to 0', john, john, { autoSlackSec: 0 });
  const pSlackNeg = paired('budget slack taken to -0.8', john, john, { autoSlackSec: -0.8 });
  // Every row is named-arm minus shipped, so the arms that change the lineup rather than the pins are passed
  // first even though they are the counterfactual.
  const pFourth = paired('a fourth piece scripted', repin(john, [4, 4, 4]), john);
  const pJohnRounds = paired("johnson, its own auto_coral rounds", repin(john, [4, 2, 2]), john);
  const newt = PRESETS.find((p) => p.key === 'newton').trio;
  const pNewtonRounds = paired("newton, its own auto_coral rounds", repin(newt, [4, 4, 2]), newt);
  const supGeneric = supply('generic trio', SAMPLES);
  const supJohn = supply('johnson A1', PRESETS.find((p) => p.key === 'johnson').trio);
  console.log('  None of these rows closes the AUTO column, and LEAVE is no longer the reason: every one of them reads leave +0.00, because');
  console.log('  #123 put the fleet on the ROBOT STARTING LINE instead of 40 in on the REEF side of it, so what the budget used to buy with');
  console.log(`  a leg of the routine is now 15 in of bumper. Taking the slack to 0 buys ${pSlack0.auto.s} AUTO CORAL (${pSlack0.autoPts.s} points)`);
  console.log(`  and to -0.8 buys ${pSlackNeg.auto.s} (${pSlackNeg.autoPts.s}), both taken out of TELEOP (${pSlack0.tele.s} and ${pSlackNeg.tele.s}),`);
  console.log(`  so the routine was already spending the seconds it asks for and the slack term only moves pieces between the two periods.`);
  console.log(`  Scripting a fourth piece on all three machines is the same trade larger: ${pFourth.auto.s} AUTO CORAL and ${pFourth.autoPts.s}`);
  console.log(`  AUTO points, ${pFourth.tele.s} TELEOP CORAL and ${pFourth.coral.s} off the MATCH's total CORAL column, for ${pFourth.total.s} of`);
  const epa = (trio) => trio.map((p) => /auto_coral ([\d.]+)/.exec(p.ref)?.[1] ?? '?').join(' / ');
  console.log(`  MATCH score. Rounding each team's own Statbotics auto_coral column (Johnson EPA ${epa(john)}, applied as 4 / 2 / 2)`);
  console.log(`  rather than splitting the alliance ledger cuts both ways too (${pJohnRounds.coral.s} total CORAL on Johnson, ${pNewtonRounds.coral.s} on Newton),`);
  console.log(`  so the shipped rule stays the ledger split and the gap is stated per lineup rather than averaged into a win. The de-conflict`);
  console.log(`  arm has nothing to say about the MATCH either: ${pCrowd.auto.s} AUTO CORAL on Johnson and ${pCrowdGeneric.auto.s} on the generic`);
  console.log(`  trio, ${pCrowd.total.s} and ${pCrowdGeneric.total.s} of MATCH score, ${pCrowd.leave.s} and ${pCrowdGeneric.leave.s} of LEAVE, which`);
  console.log('  is why `autoCrowdSec` is pinned at 0 and guard 30 re-reads the arm every round: the pieces move into the period the ledger');
  console.log(`  counts and out of the one it does not. What is left is distance. The column sits at ${supGeneric.auto.toFixed(2)} (generic)`);
  console.log(`  and ${supJohn.auto.toFixed(2)} (Johnson) against the recorded 9; ${supGeneric.loosePct.toFixed(0)}% and ${supJohn.loosePct.toFixed(0)}%`);
  console.log(`  of the AUTO picks are re-picks of a piece already loose on the carpet; ${supGeneric.idlePct.toFixed(0)}% and ${supJohn.idlePct.toFixed(0)}%`);
  console.log(`  of AUTO robot-seconds are standing still; and ${supGeneric.stationLeft.toFixed(1)} and ${supJohn.stationLeft.toFixed(1)} of the`);
  console.log("  station's 57 CORAL are still there at the whistle. Six MARKs and whatever a machine drops are the only AUTO supply the");
  console.log('  routine can reach, and #123 moved those six to 106 in behind the REEF.');
}

// #124 and #125. The REEF is the only solid thing on the carpet a waypoint can hide behind, and a CORAL is
// carried across that carpet. Both rows are the same MATCHes with one mechanism switched, so the difference is
// the mechanism. The symptom is read off the frames as stretches in which a machine is told to go, has a
// hexagon on the line, is against it, and never gets free — and 12 mirror MATCHes of them, because it is a
// third of one percent of ROBOT-seconds even when it is there.
{
  const GEO2 = layout();
  const REEFS2 = [GEO2.blue.reef, GEO2.red.reef];
  const halfOf = () => 15; // R104's 120 in perimeter as a square: 30 in, half 15
  const FS = 0.4;
  const blocked = (x, y, tx, ty, heading) => {
    const d = Math.hypot(tx - x, ty - y);
    const n = Math.max(2, Math.ceil(d / 10));
    for (let i = 1; i < n; i++) {
      const f = i / n;
      for (const reef of REEFS2) {
        if (reefPenetration(reef, { x: x + (tx - x) * f, y: y + (ty - y) * f, heading, footprintHalfIn: halfOf() })) return true;
      }
    }
    return false;
  };
  const pinned = (x, y, heading) => REEFS2.some((reef) => reefPenetration(
    { x: reef.x, y: reef.y, apothem: reef.apothem + 6 },
    { x, y, heading, footprintHalfIn: halfOf() },
  ));
  // An episode is one unbroken stretch of ROBOT-seconds in which the machine is told to go somewhere more than
  // 22 in away, has a hexagon on the straight line to it, and is against that structure. It ends when any of
  // those stop, and it is a STALL when the stretch ran 3 s or longer without closing 4 in from where it began.
  // Counting whole stretches rather than the seconds past the third is what makes `longest` a number of seconds
  // a driver would agree with, and 12 seeds is enough of them: the symptom is a third of one percent.
  const SN = 12;
  const stall = (override) => {
    let robotSec = 0;
    let stallSec = 0;
    let unstick = 0;
    const runs = [];
    for (let i = 0; i < SN; i++) {
      const m = playMatch({ seed: seedBase + i * 977, blueProfiles: SAMPLES, redProfiles: SAMPLES, scenarioOverride: override, record: true });
      unstick += (m.events || []).filter((e) => e.kind === 'unstick').length;
      const hist = new Map();
      const close = (h) => {
        if (h.since !== null && h.t - h.since >= 3 && h.from - h.last < 4) {
          stallSec += h.t - h.since;
          runs.push(h.t - h.since);
        }
        h.since = null;
      };
      for (const fr of m.frames) {
        for (const rb of fr.robots) {
          const key = `${rb.side}:${rb.slot}`;
          const h = hist.get(key) || { since: null, from: 0, last: 0, t: 0 };
          robotSec += FS;
          h.t += FS;
          const on = rb.target && !rb.busy && !rb.climb && !rb.disabled && !rb.defending;
          const d = on ? Math.hypot(rb.target[0] - rb.x, rb.target[1] - rb.y) : 0;
          if (on && d > 22 && pinned(rb.x, rb.y, rb.heading) && blocked(rb.x, rb.y, rb.target[0], rb.target[1], rb.heading)) {
            if (h.since === null) {
              h.since = h.t;
              h.from = d;
            }
            h.last = d;
          } else close(h);
          hist.set(key, h);
        }
      }
      for (const h of hist.values()) close(h);
    }
    runs.sort((a, b) => a - b);
    return {
      pct: (100 * stallSec) / robotSec,
      eps: runs.length / SN,
      longest: runs.length ? runs[runs.length - 1] : 0,
      unstick: unstick / SN,
    };
  };
  const price = (off, on, sb, seat) => {
    const d = [];
    for (let i = 0; i < N; i++) {
      const seed = sb + i * 977;
      const a = playMatch({ seed, blueProfiles: SAMPLES, redProfiles: SAMPLES, scenarioOverride: off });
      const b = playMatch({ seed, blueProfiles: SAMPLES, redProfiles: SAMPLES, scenarioOverride: on });
      d.push(b.final[seat].total - a.final[seat].total);
    }
    const m = d.reduce((s, v) => s + v, 0) / N;
    const se = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (N - 1) / N);
    return `${(m >= 0 ? '+' : '') + m.toFixed(2)} ± ${se.toFixed(2)} (${d.filter((v) => v !== 0).length}/${N} differ)`;
  };
  // The same arithmetic guard 17 reads the named presets against: 24 MATCHes on seed base 23000, both
  // alliances, CORAL an ALLIANCE. The berth is priced here because that band is what it broke.
  const ledgerCol = (key, sc) => {
    const trio = PRESETS.find((p) => p.key === key).trio;
    let coral = 0;
    let n = 0;
    for (let i = 0; i < N; i++) {
      const m = playMatch({ seed: 23000 + i * 613, blueProfiles: trio, redProfiles: trio, scenarioOverride: sc });
      for (const side of ['blue', 'red']) {
        coral += Object.values(m.final[side].coral).reduce((a, x) => a + x.auto + x.tele, 0);
        n += 1;
      }
    }
    return coral / n;
  };
  const OFF = { detourOff: true, carryDrop: 0 };
  const SHIP = { detourOff: false, carryDrop: 0, detourClearIn: 8, detourPressSec: 0.6 };
  label('#124 the REEF between a ROBOT and its waypoint: when to go around, and how wide a berth to go around at');
  for (const [name, sc] of [
    ['off, the engine before #124', OFF],
    ['press 0.0 s (every blocked trip), berth 8', { ...SHIP, detourPressSec: 0 }],
    ['press 1.2 s, berth 8', { ...SHIP, detourPressSec: 1.2 }],
    ['press 0.6 s, berth 2', { ...SHIP, detourClearIn: 2 }],
    ['press 0.6 s, berth 4', { ...SHIP, detourClearIn: 4 }],
    ['press 0.6 s, berth 14', { ...SHIP, detourClearIn: 14 }],
    ['SHIPPED press 0.6 s, berth 8', SHIP],
  ]) {
    const s = stall(sc);
    const j = ledgerCol('johnson', sc);
    console.log(`  ${name.padEnd(38)} pinned-and-blocked ${s.pct.toFixed(2)}% of ROBOT-seconds · ${s.eps.toFixed(1)} episodes a MATCH · longest ${s.longest.toFixed(1)} s · unstick ${s.unstick.toFixed(1)} a MATCH · Johnson ${j.toFixed(1)} CORAL an ALLIANCE (TBA 59, guard band ±4)`);
  }
  console.log(`  shipped against off, own-side ${price(OFF, SHIP, 9000, 'blue')}`);
  for (const sb of [9000, 21000]) for (const seat of ['blue', 'red']) {
    console.log(`  the shipped fix at base ${sb} from ${seat}: own-side ${price(OFF, SHIP, sb, seat)}`);
  }
  console.log(`  and the two preset columns it was priced against: Johnson ${ledgerCol('johnson', OFF).toFixed(1)} -> ${ledgerCol('johnson', SHIP).toFixed(1)}, Newton ${ledgerCol('newton', OFF).toFixed(1)} -> ${ledgerCol('newton', SHIP).toFixed(1)} (recorded 59 and 56)`);
  label('#125 a CORAL shaken loose by the drive, n=24 mirror MATCHes per rate');
  for (const rate of [0.005, 0.01, 0.02]) {
    const on = { detourOff: false, carryDrop: rate };
    let drops = 0;
    for (let i = 0; i < N; i++) {
      const m = playMatch({ seed: seedBase + i * 977, blueProfiles: SAMPLES, redProfiles: SAMPLES, scenarioOverride: on });
      drops += (m.events || []).filter((e) => e.kind === 'carry-drop').length;
    }
    console.log(`  rate ${String(rate).padEnd(6)} /s   ${(drops / N).toFixed(2)} CORAL a MATCH shaken loose on the drive · own-side against the same rate at 0 ${price(SHIP, on, seedBase, 'blue')}`);
  }
  console.log('  The gate is what makes the cure affordable. Diverting every trip a hexagon stands in cures the symptom and costs the named');
  console.log('  preset a couple of CORAL an ALLIANCE, because a fleet working its own REEF has a hexagon on the line almost always; waiting');
  console.log('  0.6 s for the machine that presses and stays pressed cures it to within noise of the same share and leaves that ledger column');
  console.log('  where the record has it. The width has a floor and then stops mattering: 4, 8 and 14 in read the same share and the same');
  console.log('  longest stretch, while a 2 in berth leaves a 36 s one behind it, so 8 in is the flat part of the curve with room in it.');
  console.log('  The swing is worth points and the shake-loose takes a comparable amount out of the same MATCH, so the two mechanisms');
  console.log('  together leave the score close to where it was and change what happens on the carpet.');
}

// #126. The engine books a BRANCH when the placement completes, not when a machine decides to go there, so before
// this the three machines of an ALLIANCE all bid the same nearest free pipe on their chosen level and the last one
// arrived to find it taken. The count is in the engine (`st.branchShare`, one increment per 0.1 s decision in which
// an ally holds a claim another ally already has), so this reads the same fact the guard asserts rather than a
// recorded timeline. The factor is the tick, and `dup` is allies BEYOND the first, so the result is ROBOT-seconds.
{
  const arm = (kind, sc, sb) => {
    let dup = 0;
    let eps = 0;
    const blue = [];
    const red = [];
    for (let i = 0; i < N; i++) {
      const m = playMatch({
        seed: sb + i * 977, blueKind: kind, redKind: kind,
        blueProfiles: SAMPLES, redProfiles: SAMPLES, scenarioOverride: sc,
      });
      dup += m.branchShare.blue.dup + m.branchShare.red.dup;
      eps += m.branchShare.blue.episodes + m.branchShare.red.episodes;
      blue.push(m.final.blue.total);
      red.push(m.final.red.total);
    }
    return { sec: (0.1 * dup) / (2 * N), eps: eps / N, blue, red };
  };
  const paired = (a, b) => {
    const d = b.blue.map((v, i) => v - a.blue[i]);
    const m = d.reduce((s, v) => s + v, 0) / d.length;
    const se = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (d.length - 1) / d.length);
    return `${(m >= 0 ? '+' : '') + m.toFixed(2)} ± ${se.toFixed(2)} (${d.filter((v) => v !== 0).length}/${d.length} differ)`;
  };
  const col126 = (key, sc) => {
    const trio = PRESETS.find((p) => p.key === key).trio;
    let coral = 0;
    let n = 0;
    for (let i = 0; i < N; i++) {
      const m = playMatch({ seed: 23000 + i * 613, blueProfiles: trio, redProfiles: trio, scenarioOverride: sc });
      for (const side of ['blue', 'red']) {
        coral += Object.values(m.final[side].coral).reduce((a, x) => a + x.auto + x.tele, 0);
        n += 1;
      }
    }
    return coral / n;
  };
  label('#126 two allies on one BRANCH, n=24 mirror MATCHes per fleet and seed base');
  const OFF126 = { branchDedup: false };
  for (const [kind, name] of [['greedy', 'greedy fleet'], ['ai', 'planner fleet']]) {
    for (const sb of [9000, 21000]) {
      const off = arm(kind, OFF126, sb);
      const on = arm(kind, {}, sb);
      console.log(`  ${name.padEnd(14)} base ${sb}: shared ${off.sec.toFixed(1)} -> ${on.sec.toFixed(1)} ROBOT-seconds an ALLIANCE-MATCH · stretches ${off.eps.toFixed(1)} -> ${on.eps.toFixed(1)} · own-side paired ${paired(off, on)}`);
    }
  }
  const jOff = col126('johnson', OFF126);
  const jOn = col126('johnson', {});
  const nOff = col126('newton', OFF126);
  const nOn = col126('newton', {});
  console.log(`  and the two preset columns it is priced against: Johnson ${jOff.toFixed(1)} -> ${jOn.toFixed(1)}, Newton ${nOff.toFixed(1)} -> ${nOn.toFixed(1)} (recorded 59 and 56, guard band ±4)`);
  console.log('  The claim is a steering fact, not a throughput lever: it takes the fleet apart on the REEF and leaves the');
  console.log('  ledger where the record has it, because a machine that was going to arrive second still arrives second — it');
  console.log('  just goes to a different pipe. What it buys is the drive the second machine no longer has to redo, and the');
  console.log('  13 in of pipe between two allies instead of the same branch under both of them.');
}

// #127. A CAGE hold is an action with odds, not a done deal. The engine already rolled one number for every
// completed action and then, for a CLIMB only, discarded the result: a machine could not come off a pipe it had
// committed to. The roll now decides, and what a miss costs is the clock — the machine keeps the CAGE it claimed,
// drops back to the carpet beside it and tries again, and §6.5 prices however far it got (DEEP 12, SHALLOW 6,
// PARK 2). No source prints a hold rate: the manual sets no number, and a ledger cannot recover one either,
// because an alliance that fell and re-hung before the whistle books the same three DEEP CAGEs. `climbRisk: false`
// is the control on every row — the same draws, discarded — so each rate is the same 24 MATCHes, not a new batch.
{
  const trio = (rate, key) => (key ? PRESETS.find((p) => p.key === key).trio : SAMPLES).map((p) => ({ ...p, climbSuccess: rate }));
  const arm = (profiles, sb, over = {}, opts = {}, stride = 977) => {
    const a = { slips: 0, deep: 0, shallow: 0, park: 0, barge: 0, hung: 0, blue: [], red: [] };
    for (let i = 0; i < N; i++) {
      const g = playMatch({
        seed: sb + i * stride, blueProfiles: profiles, redProfiles: profiles,
        scenarioOverride: over, bluePolicyOpts: opts, redPolicyOpts: opts,
      });
      a.slips += (g.events || []).filter((e) => e.kind === 'slip').length;
      for (const side of ['blue', 'red']) {
        const b = g.final[side].barge;
        a.deep += b.deep;
        a.shallow += b.shallow;
        a.park += b.park;
        a.hung += b.deep + b.shallow;
        a.barge += g.final[side].bargePoints;
      }
      a.blue.push(g.final.blue.total);
      a.red.push(g.final.red.total);
    }
    const sides = 2 * N;
    return { ...a, slips: a.slips / N, deep: a.deep / sides, shallow: a.shallow / sides, park: a.park / sides, hung: a.hung / sides, barge: a.barge / sides };
  };
  const paired = (a, b, seat) => {
    const d = b[seat].map((v, i) => v - a[seat][i]);
    const m = d.reduce((s, v) => s + v, 0) / d.length;
    const se = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (d.length - 1) / d.length);
    return `${(m >= 0 ? '+' : '') + m.toFixed(2)} ± ${se.toFixed(2)} (${d.filter((v) => v !== 0).length}/${d.length} differ)`;
  };
  const dsp = (x) => `${x.deep.toFixed(2)}/${x.shallow.toFixed(2)}/${x.park.toFixed(2)}`;
  const SHIP127 = {};
  label('#127 a CAGE hold that does not stick, n=24 mirror MATCHes per rate');
  for (const sb of [9000, 21000]) {
    const off = arm(trio(0.94), sb, { climbRisk: false });
    console.log(`  base ${sb}  the roll discarded   DEEP/SHALLOW/PARK an ALLIANCE ${dsp(off)} · BARGE ${off.barge.toFixed(2)} · own-side 0 (the control)`);
    for (const rate of [1, 0.97, 0.94, 0.9, 0.8, 0.5, 0.3]) {
      const on = arm(trio(rate), sb, SHIP127);
      console.log(`  base ${sb}  success ${rate.toFixed(2)}     ${on.slips.toFixed(2)} slips a MATCH · DEEP/SHALLOW/PARK ${dsp(on)} · BARGE ${on.barge.toFixed(2)} · own-side against the discarded roll ${paired(off, on, 'blue')}`);
    }
  }
  // The same miss priced against the clock it lands in, because that is what decides whether it costs anything: a
  // fleet told to commit with 6 s left has time to fall and re-hang, and a fleet that commits with 2 s does not.
  label('#127 the same rate against the endgame window the fleet is told to commit with (n=24, seed base 9000, blue read)');
  for (const w of [20, 6, 4, 2]) {
    const off = arm(trio(0.94), 9000, { climbRisk: false }, { climbWindowSec: w });
    const on = arm(trio(0.94), 9000, SHIP127, { climbWindowSec: w });
    console.log(`  commit with ${String(w).padStart(2)} s left:  ${on.slips.toFixed(2)} slips a MATCH · DEEP/SHALLOW/PARK ${dsp(on)} against ${dsp(off)} · ${on.hung.toFixed(2)} of 3 hung against ${off.hung.toFixed(2)} · BARGE ${on.barge.toFixed(2)} against ${off.barge.toFixed(2)} · own-side ${paired(off, on, 'blue')}`);
  }
  const jOff = arm(trio(0.94, 'johnson'), 23000, { climbRisk: false }, {}, 613);
  const jOn = arm(trio(0.94, 'johnson'), 23000, SHIP127, {}, 613);
  const nOff = arm(trio(0.94, 'newton'), 23000, { climbRisk: false }, {}, 613);
  const nOn = arm(trio(0.94, 'newton'), 23000, SHIP127, {}, 613);
  console.log(`  the two named lineups the ledger is read against: Johnson ${dsp(jOff)} -> ${dsp(jOn)} and Newton ${dsp(nOff)} -> ${dsp(nOn)}, against three DEEP CAGEs recorded for each side (2025cmptx_f1m1)`);
}
