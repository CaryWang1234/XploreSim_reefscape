// Invariants for the REEFSCAPE engine. This is the guard that has to pass before the bundle ships:
// every check below is a property that a wrong model breaks while the page still renders happily.
//
// Run: npm run verify

import { playMatch, evaluate } from '../web/js/league.js';
import { BRANCH_SLOTS_PER_LEVEL, TROUGH_CAP, SAMPLES, PRESETS, CAGE_ROBOT_CAPACITY, ALGAE_PER_ALLIANCE, HUMAN_PLAYER, defaultScenario, layout } from '../web/js/model.js';
import { squareContact, reefPenetration, simulateMatch, INTENT } from '../web/js/engine.js';
import { greedyPolicy } from '../web/js/policy.js';
import { makeContext, estimateAlliance, planValue, SPREAD_PENALTY } from '../web/js/fastsim.js';
import { POINTS, TIME, PIECES, FIELD } from '../web/js/rules.js';

let bad = 0;
// The fingerprint of the committed engine behaviour on seed 12345. Update it only with an explanation.
// 84a8e19f: the physics became the 2026 build's. A ROBOT is now the 30 in square R104's 120 in perimeter
// allows, oriented by a heading that is integrated under the drivetrain's turn rate and spin ramp; two
// of them meet with a separating-axis test, split the overlap by inverse mass and trade momentum along
// the normal; the REEF is its hexagon, not its inscribed circle; and LEAVE / PARK are judged on the
// BUMPERS (§6.5.2) instead of the centre. Cost on this seed: one L2 branch left unfilled, 279→276.
// 1bafff24: on top of that physics, every ROBOT now gets its own tempo for the MATCH (model.tempoJitter,
// ±20% by default) and each HUMAN PLAYER its own form, so the two ALLIANCES are no longer one process
// played twice. Cost on this seed: 276-276 became 270-267 — a MATCH with a winner in it.
// c7da8d95: three of the four ledger columns were wrong against TBA's 2025cmptx records, and this is what
// it took to put them right. (i) The L1 TROUGH could not be reached at all: the placement stand-off was
// measured from the REEF's centre, and the hexagon resolution pushes a ROBOT back out of exactly that
// ring, so no MATCH in the build's history had ever scored a trough CORAL. (ii) AUTO became the three-CORAL
// routine the record shows (9 an ALLIANCE, 7 on L4) instead of one, with the CORAL STATION as a source and
// the cross for LEAVE paid for inside the same 15 s — 8.7 of the 9 LEAVE points instead of the 7.3 the
// first version of that left on the table. (iii) The ROBOTs were re-timed off the ledger rather than off
// a guess. Cost on this seed: 270-267 became 317-317, and the mirror's mean per-ALLIANCE score went from
// 270 to 316, of which 54 is the PROCESSOR credit the Einstein playoff records do not carry at all.
// 50650675: the BARGE was on the wrong half of the field. §5 definitions put the BARGE ZONE "surrounding the
// ALLIANCE'S half of the BARGE" and §5.4 hangs the CAGES and the NET from that same truss, but the geometry
// offset every climbing landmark by `midX + toward * …`, which for blue meant x > 345 — red's half. So a
// robot driving home to park drove through the middle of the opponent, the corner pile-up guard was
// measuring that traffic rather than a repair, and the two halves of the scoreboard disagreed with the two
// halves of the picture. Four things moved with it: (i) the PARK/CLIMB targets are now on their own side
// (blue's zone is [299,345], red's [345,391], the truss's own 22 in), (ii) the zone is 46 in deep per §5
// rather than borrowing the truss's 44, (iii) §6.5 A's 3-second post-AUTO assessment window is honoured, so
// a CORAL from a cycle that began before 0:00 pays 7/6/4/3 instead of 5/4/3/2, and (iv) §6.3.4's staging
// closes at exactly 126 CORAL and 18 ALGAE — the STATION count is derived from the preloads instead of being
// rolled at 57-60 on top of them — and a piece a ROBOT loses now lands on the carpet instead of vanishing,
// which is what makes a loose ALGAE exist at all. Cost on this seed: 317-317 became 321-317, and over the
// 48-MATCH mirror the margin tightened from 4.00 ± 1.92 to −0.02 ± 1.89.
// 321-317 became fa67df3a's 293-305 because of one mechanism, and the ablation below is the proof: with
// `placementRisk: false` the replay prints 50650675 again, byte for byte, so nothing else in this round —
// DEFEND, the opponent's CORAL STATION as a fetch source, the opponent's REEF ALGAE in the strip gate, the
// §7.4.4 family, G421, one-foul-per-engagement instead of one-per-1.5-s, the tightened PIN test — reaches a
// MATCH where two greedy fleets never meet. What the placement model does reach: a CORAL now has to be
// roughly lined up before the push starts (the tolerance is the ROBOT's `placeTolDeg`, not the general 45°
// work angle), and §6.5.1's BRANCH test fails off-axis often enough at L4 to make the trough the level that
// goes short. On this seed 17 trough CORAL became 4 and 13 pieces fell onto the carpet.
// fa67df3a became 65be7627's 251-247 for one reason and it is a profile change, not an engine change: the
// three SAMPLES machines now carry a NET REACH (`netScoreSec` 1.9 / 1.4 / 2.05 s, derived in model.js from
// each one's own L4 time) instead of 0, so §6.1's ROBOT-deposited ALGAE became possible. A reach is a
// property of the elevator, not a scenario knob, so it reaches every one of the four replays below — none
// of these four pins is the value committed before this round any more. What the third and fourth still
// prove is that the ablation works: with `placementRisk: false` the replay books zero dropped CORAL (18
// as shipped), which is the check under them, and the two off values still compose.
const GOLDEN = 0x65be7627;
// fa67df3a with the spread switched off has to be the replay above minus the draws, or the knob's off value
// is not an off value.
const GOLDEN_NO_JITTER = 0xe1eaef89;
// And both knobs' off values together have to hand back the MATCH with no misses in it at all: this round's
// DEFEND, the two deny sources, the §7.4.4 family, G421 and the re-gated contact fouls all need a press,
// and with two lifting greedy fleets on their own REEFs there is nothing else to change.
const GOLDEN_PRE_PLACEMENT = 0x07856316;
const GOLDEN_PRE_PLACEMENT_NO_JITTER = 0xaad9e965;
const fail = (m) => {
  console.log('FAIL ' + m);
  bad += 1;
};
const pass = (m) => console.log('ok   ' + m);

const seed = 12345;
const r = playMatch({ seed, record: true });
const b = r.final.blue;
const e = r.final.red;

// 1. Physical inventory: a branch holds one CORAL (§6.5.1), the trough is the modelled L1 cap, and 18
//    ALGAE are staged per MATCH (§6.3.4.2), 9 of them on each ALLIANCE's own side. Exceeding any of
//    these is a bookkeeping bug, not a strategy.
for (const [side, s] of [['blue', b], ['red', e]]) {
  for (const lv of ['L2', 'L3', 'L4']) {
    const n = s.coral[lv].auto + s.coral[lv].tele;
    if (n > BRANCH_SLOTS_PER_LEVEL) fail(`${side} ${lv} holds ${n} CORAL, capacity ${BRANCH_SLOTS_PER_LEVEL}`);
  }
  if (s.coral.L1.auto + s.coral.L1.tele > TROUGH_CAP) fail(`${side} trough overflows`);
  if (s.algae.processor > ALGAE_PER_ALLIANCE) fail(`${side} processed ${s.algae.processor} ALGAE, only ${ALGAE_PER_ALLIANCE} are staged on its side (§6.3.4.2)`);
  if (s.leaveCount > 3) fail(`${side} has ${s.leaveCount} ROBOTs, LEAVE counted ${s.leaveCount}`);
  if (s.barge.deep + s.barge.shallow + s.barge.park > 3) fail(`${side} BARGE counts ${JSON.stringify(s.barge)}`);
}
if (b.algae.processor + e.algae.processor > 18) fail(`the two PROCESSORs took ${b.algae.processor + e.algae.processor} ALGAE, 18 are staged`);
pass('branch, trough, ALGAE and ROBOT-count inventories are inside their caps');

// 2. Score arithmetic: the total must equal the parts, or the scoreboard is decoration.
for (const [side, s] of [['blue', b], ['red', e]]) {
  const coralPts = ['L1', 'L2', 'L3', 'L4'].reduce((a, lv) => a + s.coral[lv].auto * POINTS.coral[lv][0] + s.coral[lv].tele * POINTS.coral[lv][1], 0);
  const algaePts = s.algae.processor * POINTS.algae.processor[1] + s.algae.net * POINTS.algae.net[1];
  const bargePts = s.barge.deep * POINTS.cageDeep + s.barge.shallow * POINTS.cageShallow + s.barge.park * POINTS.park;
  const expect = coralPts + algaePts + s.leave + bargePts + s.fouls;
  if (expect !== s.total) fail(`${side} total ${s.total} != arithmetic ${expect} (coral ${coralPts} algae ${algaePts} leave ${s.leave} barge ${bargePts} fouls ${s.fouls})`);
  if (coralPts !== s.coralPoints) fail(`${side} coralPoints ${s.coralPoints} != ${coralPts}`);
  const rpSum = s.rp.auto + s.rp.coral + s.rp.barge + s.rp.win + s.rp.tie;
  if (rpSum !== s.rp.total) fail(`${side} rp.total ${s.rp.total} != components ${rpSum}`);
  if (s.coopertition !== (s.coop ? POINTS.coopertition : 0)) fail(`${side} coopertition point disagrees with coop flag`);
}
pass('totals are the sum of their parts, and RP is the sum of its components');

// 3. LEAVE is judged at the end of AUTO (§6.5.2), so a robot that crossed late must not be counted, and
//    the replay must not run past the clock.
if (r.frames[r.frames.length - 1].t > TIME.matchSec) fail(`replay runs to ${r.frames[r.frames.length - 1].t}s, past the ${TIME.matchSec}s clock`);
if (b.leaveCount !== 3 || e.leaveCount !== 3) fail(`expected all six ROBOTs to LEAVE, blue ${b.leaveCount} red ${e.leaveCount}`);
else pass('all six ROBOTs earned LEAVE (3 points each)');

// 4. G409 carry limit, checked on every frame.
let over = 0;
for (const f of r.frames) for (const rb of f.robots) if (rb.coral > 1 || rb.algae > 1) over += 1;
if (over) fail(`${over} frames show a ROBOT controlling more than 1 CORAL and 1 ALGAE`);
else pass('no frame violates the G409 carry limit');

// 5. No NaN anywhere. An undefined profile field used to turn positions into NaN and silently freeze
//    both alliances at their starting squares; that is what this check is for.
let nan = 0;
for (const f of r.frames) {
  for (const rb of f.robots) if (!Number.isFinite(rb.x) || !Number.isFinite(rb.y)) nan += 1;
  if (!Number.isFinite(f.score.blue) || !Number.isFinite(f.score.red)) nan += 1;
}
if (nan) fail(`${nan} NaN readings in the replay`);
else pass('every frame position and score is finite');

// 6. Determinism: the same seed is the same MATCH.
const again = playMatch({ seed });
if (again.final.blue.total !== b.total || again.final.red.total !== e.total) fail(`seed ${seed} is not reproducible: ${b.total}-${e.total} then ${again.final.blue.total}-${again.final.red.total}`);
else pass(`seed ${seed} reproduces ${b.total}-${e.total} exactly`);

// 7. Golden trace. Any change to geometry, tempo or scoring moves this number, which is the point: the
//    diff has to be explained rather than discovered later in a browser.
const fingerprint = (m) => {
  let h = 2166136261;
  const feed = (str) => {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  };
  for (const f of m.frames) feed(`${f.t}|${f.score.blue}|${f.score.red}|${f.robots.map((x) => `${x.side}${x.slot}:${x.x},${x.y}:${x.coral}${x.algae}`).join(';')}`);
  for (const ev of m.events) feed(`${ev.t}${ev.kind}${ev.side ?? ''}${ev.slot ?? ''}${ev.code ?? ''}${ev.level ?? ''}`);
  return h;
};
const hash = fingerprint(r);
console.log(`     golden fingerprint seed ${seed}: ${hash.toString(16)} (${r.frames.length} frames, ${r.events.length} events)`);
if (hash !== GOLDEN) fail(`golden fingerprint changed from ${GOLDEN.toString(16)} to ${hash.toString(16)} — explain it, then update GOLDEN`);
else pass('golden fingerprint matches the committed value');

// 7b. The per-machine spread has to be switchable off, and off has to mean the replay that was committed
// before it existed. This is what makes the jitter an ablation rather than a second guess about tempo.
const noJit = playMatch({ seed, record: true, scenarioOverride: { tempoJitter: 0 } });
const noJitHash = fingerprint(noJit);
if (noJitHash !== GOLDEN_NO_JITTER) fail(`tempoJitter 0 prints ${noJitHash.toString(16)}, not the pre-jitter ${GOLDEN_NO_JITTER.toString(16)} — the off value does not switch the spread off`);
else pass(`tempoJitter 0 reproduces the pre-jitter replay ${noJitHash.toString(16)} at ${noJit.final.blue.total}-${noJit.final.red.total}`);

// 7c. Same for the placement model, and this one carries the rest of the round with it: `placementRisk: false`
// has to hand back the replay committed before the CORAL could miss — including the §7.4.4 family, G421, the
// re-gated contact fouls, DEFEND and the two deny sources, none of which reach a MATCH where two greedy
// fleets stay on their own sides. If this pin moves while GOLDEN does not, a switch that is supposed to be
// inert is not.
const preRisk = playMatch({ seed, record: true, scenarioOverride: { placementRisk: false } });
const preRiskHash = fingerprint(preRisk);
if (preRiskHash !== GOLDEN_PRE_PLACEMENT) fail(`placementRisk false prints ${preRiskHash.toString(16)}, not the committed ${GOLDEN_PRE_PLACEMENT.toString(16)} — something added this round reaches the default MATCH`);
else pass(`placementRisk false reproduces the pre-placement replay ${preRiskHash.toString(16)} at ${preRisk.final.blue.total}-${preRisk.final.red.total}, so this round's other mechanisms are inert without a press`);
// The hash only says the replay is unchanged; it does not say the switch removes the mechanism it is
// supposed to ablate, and a profile-level reach just moved the pin without touching the model. So the off
// value has to book zero misses — the shipped one books the 20 this seed draws.
const offDrops = preRisk.events.filter((ev) => ev.kind === 'drop').length;
if (offDrops) fail(`placementRisk false still dropped ${offDrops} CORAL — the switch is not removing the miss model`);
const preRiskNoJit = fingerprint(playMatch({ seed, record: true, scenarioOverride: { placementRisk: false, tempoJitter: 0 } }));
if (preRiskNoJit !== GOLDEN_PRE_PLACEMENT_NO_JITTER) fail(`placementRisk false + tempoJitter 0 prints ${preRiskNoJit.toString(16)}, not ${GOLDEN_PRE_PLACEMENT_NO_JITTER.toString(16)} — the two off values do not compose`);
else pass('both off values compose into the replay committed before either model existed');

// 7d. And the two switches have to be separate mechanisms: the miss rates are per level, so turning the
// model off while the spread stays on must change the SCORE columns and not the tempo draws.
const risky = playMatch({ seed, record: true });
const missed = risky.events.filter((e) => e.kind === 'drop');
const drops = ['blue', 'red'].reduce((a, s) => a + risky.final[s].robots.reduce((x, r) => x + r.dropped, 0), 0);
if (!(drops > 0)) fail(`the shipped MATCH books 0 dropped CORAL — the placement model is not reaching finishBusy`);
else {
  const aimed = risky.events.filter((e) => e.kind === 'place');
  const worst = Math.max(...aimed.map((e) => e.aimErr ?? 0));
  // The gate is the whole of item 4: no placement may begin more than the ROBOT's own tolerance off the
  // BRANCH, so an event stream with a 40° start means the gate was bypassed. And the per-ROBOT column has to
  // be the same count as the events, or the table and the replay disagree about how many pieces fell.
  if (worst > 30) fail(`${aimed.length} placements include one started ${worst}° off the BRANCH — the aim gate is not holding`);
  else if (!(missed.length === drops && missed.every((e) => e.level && e.aimErr !== undefined))) fail(`the ledger books ${drops} dropped CORAL but ${missed.length} drop events, some without a level or an aim error`);
  else pass(`CORAL fell at ${[...new Set(missed.map((e) => e.level))].sort().join('/')} after starting 0-${Math.max(...missed.map((e) => e.aimErr))}° off; the ${aimed.length} placements that were booked all began within ${worst}°, and ${drops} of them did not stay on`);
}

// 8. The mirror: the same trio on both ALLIANCES, so the mean margin is the field-leak test.
const m = evaluate({ matches: 48, seedBase: 4242, profiles: { blue: SAMPLES, red: SAMPLES } });
const limit = Math.max(0.5, 3 * m.marginSe);
if (Math.abs(m.avgMargin) > limit) fail(`mirror margin ${m.avgMargin.toFixed(2)} exceeds ${limit.toFixed(2)} (3 se) — the field or the serve order is asymmetric`);
else pass(`mirror over 48 MATCHes: blue ${m.avgBlue.toFixed(1)} ± ${m.blueSe.toFixed(1)}, red ${m.avgRed.toFixed(1)} ± ${m.redSe.toFixed(1)}, margin ${m.avgMargin.toFixed(2)} ± ${m.marginSe.toFixed(2)}`);
if (Math.abs(m.winRate - 0.5) > 3 * m.winSe + 0.02) fail(`mirror win rate ${(m.winRate * 100).toFixed(1)}% is not a coin flip`);

// 9. Fouls are an ablation, not a decoration: switching them off has to switch the points off.
const nofoul = playMatch({ seed, scenarioOverride: { foulsOff: true } });
if (nofoul.final.blue.fouls !== 0 || nofoul.final.red.fouls !== 0) fail('foulsOff still credited foul points');
else pass('foulsOff is a real ablation');

// 10. A CAGE is 7 in of pipe (§5.4.1) against a 34 in ROBOT, so the model carries at most
// CAGE_ROBOT_CAPACITY per CAGE, and a sane endgame spreads its climbers instead of stacking them.
const hung = { blue: {}, red: {} };
const perSide = { blue: 0, red: 0 };
for (const e of r.events) {
  if (e.kind !== 'climb') continue;
  hung[e.side][e.cage] = (hung[e.side][e.cage] || 0) + 1;
  perSide[e.side] += 1;
}
for (const side of ['blue', 'red']) {
  for (const [cage, n] of Object.entries(hung[side])) {
    if (n > CAGE_ROBOT_CAPACITY) fail(`${side} hung ${n} ROBOTS on CAGE ${cage}, capacity ${CAGE_ROBOT_CAPACITY}`);
  }
  const distinct = Object.keys(hung[side]).length;
  if (perSide[side] > 1 && distinct < 2) fail(`${side} climbed ${perSide[side]} times using only ${distinct} CAGE(s) — the climbers are stacking`);
}
pass(`climbers spread: blue ${perSide.blue} on ${Object.keys(hung.blue).length} CAGEs, red ${perSide.red} on ${Object.keys(hung.red).length} (capacity ${CAGE_ROBOT_CAPACITY} each)`);

// 11. The baselines have to be different from each other, or "beats greedy" means nothing.
const bench = evaluate({ blueKind: 'greedy', redKind: 'random', matches: 16, seedBase: 7007, profiles: { blue: SAMPLES, red: SAMPLES } });
if (bench.winRate < 0.9) fail(`greedy only wins ${(bench.winRate * 100).toFixed(0)}% against random intents — the baselines are not discriminating`);
else pass(`greedy beats random in ${bench.blueWins}/${bench.matches} MATCHes (margin ${bench.avgMargin.toFixed(1)} ± ${bench.marginSe.toFixed(1)})`);

// 12. The ALGAE chain. An ALLIANCE's NET is fed by the OPPONENT's PROCESSOR (§5.5, §6.1), so the books
//     have to balance piece by piece: a NET point with no opponent PROCESS point behind it is invented
//     score, an area over 4 ALGAE is a G435 violation, and a throw before the AUTO clock expires is a
//     G404 violation. The HUMAN PLAYER rates also have to be real knobs, not decoration.
const chain = playMatch({ seed, record: true });
const hp = defaultScenario().humanPlayer.blue;
const broken = [];
for (const f of chain.frames) {
  for (const side of ['blue', 'red']) {
    const opp = side === 'blue' ? 'red' : 'blue';
    if (f.hpQueue[side] > hp.storage) broken.push(`${f.t}s ${side} PROCESSOR AREA holds ${f.hpQueue[side]} > G435 ${hp.storage}`);
    if (f.net[side] - f.netRobot[side] > f.processor[opp]) broken.push(`${f.t}s ${side} NET ${f.net[side]} (${f.netRobot[side]} by ROBOT) but ${opp} processed ${f.processor[opp]}`);
  }
}
// G404 bars the HUMAN PLAYER from entering ALGAE during AUTO. It does not bar a ROBOT from lifting one into
// its own NET: Table 6-2 gives the NET an AUTO column (4), and a robot deposit is the only way to fill it.
for (const x of chain.events) if (x.kind === 'net' && x.by !== 'robot' && x.t < TIME.autoSec) broken.push(`NET throw at ${x.t}s inside AUTO (G404)`);
if (broken.length) fail(`HP chain: ${broken.slice(0, 3).join(' | ')}`);
else pass(`HP chain: NET ${chain.final.blue.algae.net}/${chain.final.red.algae.net} (ROBOT-deposited ${chain.final.blue.algae.netByRobot}/${chain.final.red.algae.netByRobot}) ≤ opponent PROC ${chain.final.red.algae.processor}/${chain.final.blue.algae.processor}, areas ≤ ${hp.storage}, no AUTO throws`);
const noHp = playMatch({ seed, scenarioOverride: { algaeInNetByHuman: false } });
const zeroAcc = playMatch({ seed, scenarioOverride: { humanPlayer: { blue: { accuracy: 0 }, red: { accuracy: 0 } } } });
const thrown = (s) => s.algae.net - s.algae.netByRobot;
if (thrown(noHp.final.blue) || thrown(noHp.final.red)) fail('algaeInNetByHuman off still had a HUMAN PLAYER throw');
if (thrown(zeroAcc.final.blue) || thrown(zeroAcc.final.red)) fail('accuracy 0 still had a HUMAN PLAYER throw');
const meanNet = (hpo) => {
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const m = playMatch({ seed: 555 + i * 131, scenarioOverride: { humanPlayer: { blue: hpo, red: hpo } } });
    n += m.final.blue.algae.net + m.final.red.algae.net;
  }
  return n / 8;
};
const slow = meanNet({ ...HUMAN_PLAYER, throwSec: 8, accuracy: 0 });
const quick = meanNet({ ...HUMAN_PLAYER, throwSec: 0.8, accuracy: 1 });
if (!(slow === 0 && quick > slow)) fail(`throw rate is not a knob: slow ${slow} quick ${quick}`);
else pass(`HUMAN PLAYER knobs move the NET: 0 throws at throwSec 8 / accuracy 0, ${quick.toFixed(1)} per MATCH at 0.8 s / 100%`);

// 13. Oriented footprints separate. Two ROBOTS are allowed to bump — a few inches of residual on the
//     tick contact starts is what a car covering 13 in per tick looks like — but a pair stuck at half a
//     footprint, or a ROBOT left inside the REEF's hexagon, means the relaxation is not converging and
//     the replay reads as machines driving through each other and through structure. Partners staging on
//     one CAGE are exempt: the engine lets them overlap there on purpose (§6.5.2 allows a chain).
const geo = layout();
const onClimb = (r) => r.climb || r.busy === 'climb';
let worstPair = 0;
let worstReef = 0;
let overlapped = 0;
let freePairs = 0;
for (const f of chain.frames) {
  for (let i = 0; i < f.robots.length; i++) {
    const a = f.robots[i];
    for (const side of ['blue', 'red']) {
      const pen = reefPenetration(geo[side].reef, a);
      if (pen) worstReef = Math.max(worstReef, pen.pen);
    }
    for (let j = i + 1; j < f.robots.length; j++) {
      const b = f.robots[j];
      if (onClimb(a) || onClimb(b)) continue;
      freePairs += 1;
      const hit = squareContact(a, b);
      if (!hit) continue;
      overlapped += 1;
      worstPair = Math.max(worstPair, hit.pen);
    }
  }
}
if (worstPair > 10) fail(`a pair held ${worstPair.toFixed(1)} in of overlap (footprint is 30 in) — separation is not converging`);
if (worstReef > 1.5) fail(`a ROBOT sat ${worstReef.toFixed(1)} in inside the REEF hexagon`);
else pass(`footprints hold: worst pair overlap ${worstPair.toFixed(1)} in, worst REEF penetration ${worstReef.toFixed(1)} in, ${(overlapped / freePairs * 100).toFixed(1)}% of pair-frames in contact`);

// 14. The kinematics have teeth. A knob that never binds is decoration, so each one has to change the
// recorded replay against its own control — a digest test, which is noise-free. The score effect is a
// separate question and is reported with its sign and standard error rather than asserted: over n=16
// paired MATCHes on one seed set the spin ramp looked worth 5.8 pts and over 96 it was worth 0.
const digest = (over) => {
  const m = playMatch({ seed: 5150, record: true, scenarioOverride: over });
  const s = m.frames.map((f) => f.robots.map((x) => `${x.x},${x.y},${x.heading}`).join(';')).join('#');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
};
const shipped = digest({});
for (const [name, over] of [['turnRampOff', { turnRampOff: true }], ['contactRestitution -1', { contactRestitution: -1 }], ['unstickOff', { unstickOff: true }]]) {
  if (digest(over) === shipped) fail(`${name} left the replay byte-identical — the knob is not reaching the motion code`);
}
const totals = (over, n = 48) => {
  const t = [];
  for (let i = 0; i < n; i++) t.push(playMatch({ seed: 3100 + i * 613, scenarioOverride: over }).final.blue.total);
  return t;
};
const base = totals({});
const effect = (over, n) => {
  const other = totals(over, n);
  const d = base.map((v, i) => v - other[i]);
  const mean = d.reduce((x, y) => x + y, 0) / d.length;
  return { mean, se: Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / (d.length - 1) / d.length), differ: d.filter((v) => v !== 0).length, n: d.length };
};
// Where a contact knob actually lands. The positional separation runs before the velocity exchange and does
// not read `rest` at all, so switching the bounce off cannot show up in the score (0.4 ± 1.6 pts over 48
// paired MATCHes, though 44 of 48 scores do differ); it shows up in how long pairs remain in contact,
// because nothing is thrown apart. Measured on one MATCH each way.
const contactFraction = (seed, over) => {
  const m = playMatch({ seed, record: true, scenarioOverride: over });
  let hit = 0;
  let pairs = 0;
  for (const f of m.frames) {
    for (let i = 0; i < f.robots.length; i++) {
      for (let j = i + 1; j < f.robots.length; j++) {
        if (onClimb(f.robots[i]) || onClimb(f.robots[j])) continue;
        pairs += 1;
        if (squareContact(f.robots[i], f.robots[j])) hit += 1;
      }
    }
  }
  return (hit / pairs) * 100;
};
const ramp = effect({ turnRampOff: true });
const impulse = effect({ contactRestitution: -1 });
const fmt = (x) => `${x.mean.toFixed(1)} ± ${x.se.toFixed(1)}`;
// Paired on 16 seeds, because the quantity is a fraction of a percentage point: read on one MATCH it comes
// out either sign depending on the seed (seed 5150 alone says −0.1, the batch says +0.5), and a guard that
// samples noise is a guard that fails next week for no reason.
const restPair = [];
for (let i = 0; i < 16; i++) {
  const s = 5150 + i * 977;
  restPair.push(contactFraction(s, { contactRestitution: -1 }) - contactFraction(s, {}));
}
const restMean = restPair.reduce((a, x) => a + x, 0) / restPair.length;
const restSd = Math.sqrt(restPair.reduce((a, x) => a + (x - restMean) ** 2, 0) / (restPair.length - 1));
const restSe = restSd / Math.sqrt(restPair.length);
const restOn = contactFraction(5150, {});
if (!(ramp.mean - 2 * ramp.se > 0)) fail(`turnRampOff moved the score by ${fmt(ramp)} — the spin ramp does not separate from zero`);
else if (!(restMean - 2 * restSe > 0)) fail(`dropping the bumper impulse changed contact time by ${restMean.toFixed(2)} ± ${restSe.toFixed(2)} pts over 16 paired MATCHes — the exchange is not doing what it is for`);
else pass(`physics knobs bind: the spin ramp is worth ${fmt(ramp)} pts over n=${ramp.n} paired (${ramp.differ}/${ramp.n} scores differ); the bumper impulse is worth ${fmt(impulse)} pts of score but ${restMean.toFixed(2)} ± ${restSe.toFixed(2)} pts of contact time over 16 paired MATCHes (${restOn.toFixed(1)}% of pair-frames in contact as shipped)`);
const tanky = SAMPLES.map((p) => ({ ...p, chassis: 'tank' }));
const swervy = SAMPLES.map((p) => ({ ...p, chassis: 'swerve' }));
// With the per-machine spread on, a 16-MATCH arm cannot resolve an 8-point chassis effect, so this guard
// reads the chassis on the deterministic mirror: it is here to catch the drivetrain being unplumbed.
const meanOf = (profiles) => evaluate({ matches: 16, seedBase: 3100, profiles: { blue: profiles, red: profiles }, scenarioOverride: { tempoJitter: 0 } }).avgBlue;
const tankMean = meanOf(tanky);
const swerveMean = meanOf(swervy);
if (!(swerveMean - tankMean > 5)) fail(`a drivetrain swap moved the mean ${(swerveMean - tankMean).toFixed(1)} — the chassis model is not reaching the motion code`);
else pass(`drivetrain matters: swerve ${swerveMean.toFixed(1)} vs tank ${tankMean.toFixed(1)} per MATCH (n=16)`);

// 15. The spread has to show up as MATCHes that are not the same number twice. Both arms run the same 96
// seeds, so this is the mirror's own tie rate measured against the deterministic mirror, not a new claim
// about which ALLIANCE wins.
//
// It reads the placement model's off arm for the tie count, and both arms for the margin. That is not
// weakening: with CORAL able to miss, the per-placement draw already breaks most of the deterministic
// mirror's exact ties (10/96 → 4/96 with the jitter off), so the tie statistic the jitter was bought for is
// spent, and the 4→6 that remains is a 96-sample count of a ~5% event. What the jitter still has to prove
// is that it widens the margin, which is the thing the three real 2025 Einstein finals margins measure.
const spread = (jitter, placementRisk) => {
  const abs = [];
  let ties = 0;
  for (let i = 0; i < 96; i++) {
    const m = playMatch({ seed: 9000 + i * 977, scenarioOverride: { tempoJitter: jitter, placementRisk } });
    const d = m.final.blue.total - m.final.red.total;
    if (d === 0) ties += 1;
    abs.push(Math.abs(d));
  }
  return { ties, mean: abs.reduce((x, y) => x + y, 0) / abs.length };
};
const jit = defaultScenario().tempoJitter;
const riskOff = { off: spread(0, false), on: spread(jit, false) };
const riskOn = { off: spread(0, true), on: spread(jit, true) };
const widened = (a, b) => (b.mean - a.mean).toFixed(1);
if (!(riskOff.on.ties < riskOff.off.ties)) fail(`tempoJitter ${jit} left ${riskOff.on.ties}/96 exact ties against ${riskOff.off.ties}/96 without it, with the placement model off — the spread is not separating the two ALLIANCES`);
else if (!(riskOn.on.mean > riskOn.off.mean)) fail(`with the shipped model the spread left the mean |margin| at ${riskOn.on.mean.toFixed(1)} against ${riskOn.off.mean.toFixed(1)} without it — the jitter is not reaching the score`);
else pass(`machine spread: with CORAL unable to miss it takes exact ties ${riskOff.off.ties}→${riskOff.on.ties}; as shipped it takes the mean |margin| from ${riskOn.off.mean.toFixed(1)} to ${riskOn.on.mean.toFixed(1)} (ties ${riskOn.off.ties}→${riskOn.on.ties} of 96, noise at this n); the three real 2025 Einstein finals margins were 11, 14, 17`);

// 16. A corner pile-up has to be escapable, and the escape has to stay a repair rather than become the way
// the engine drives. Three ROBOTS used to be able to pin each other against the guardrail at their own CORAL
// STATION and stay there: over 48 seeds the weakest ALLIANCE finished on 13 of the 60 CORAL the field holds
// and the widest mirror gap was 132 points, between two identical trios. Two things were wrong, and the big
// one was not the maneuver. The BARGE ZONE had been placed on the OPPONENT's half of the field, so a robot
// driving home to park drove across the centreline instead, into traffic that had no reason to move; the
// escape only cleaned up what was left after that. With the zone on its own side the escape was worth 2
// CORAL on the weakest ALLIANCE, 8.5 points a MATCH and 15 points of widest mirror gap. Since the trio
// started lifting its own ALGAE the worst-case draw over these seeds is no longer a pile-up — both arms
// floor at 34 CORAL — but 48 of 48 MATCHes still score differently without it, it is worth 6.4 points a
// MATCH and it holds the widest gap from 54 to 36, so the assertions below are about the mean and the spread
// rather than the floor. Both ends were asserted from the start because a first version of the test fired
// 4258 times a MATCH on every ROBOT that was merely turning.
const pileStats = (over) => {
  const p = { floor: 99, fires: 0, matches: 0, widest: 0, total: 0 };
  for (let i = 0; i < 48; i++) {
    const m = playMatch({ seed: 9000 + i * 977, record: true, scenarioOverride: over });
    p.matches += 1;
    p.fires += m.events.filter((e) => e.kind === 'unstick').length;
    for (const side of ['blue', 'red']) {
      p.floor = Math.min(p.floor, Object.values(m.final[side].coral).reduce((a, x) => a + x.auto + x.tele, 0));
    }
    p.widest = Math.max(p.widest, Math.abs(m.final.blue.total - m.final.red.total));
    p.total += m.final.blue.total + m.final.red.total;
  }
  return { floor: p.floor, fires: p.fires, perMatch: p.fires / p.matches, widest: p.widest, meanTotal: p.total / p.matches };
};
const pile = pileStats({});
const off = pileStats({ unstickOff: true });
if (off.fires > 0) fail(`unstickOff still fired the maneuver ${off.fires} times — the switch is not a switch`);
else if (!(pile.perMatch > 0)) fail('the pile-up escape never fired — the corners are not being tested');
else if (off.meanTotal >= pile.meanTotal) fail(`unstickOff did not cost anything: the batch averaged ${off.meanTotal.toFixed(1)} against ${pile.meanTotal.toFixed(1)} with the maneuver — it is dead code`);
else if (!(off.widest > pile.widest)) fail(`unstickOff left the widest mirror gap at ${off.widest} against ${pile.widest} — the escape is not the thing holding two identical trios together`);
else if (pile.floor < 34) fail(`an ALLIANCE still finished on ${pile.floor} CORAL of the 60 the field holds — the pile-up is not being escaped`);
else if (pile.perMatch > 40) fail(`the pile-up escape fired ${pile.perMatch.toFixed(1)} times a MATCH — that is the engine driving, not repairing`);
else pass(`corner pile-up: switched off, over 48 MATCHes the batch averaged ${off.meanTotal.toFixed(1)} against ${pile.meanTotal.toFixed(1)} and the widest mirror gap widened from ${pile.widest} to ${off.widest}, while the weakest ALLIANCE floored at ${off.floor} CORAL either way; backing out was needed ${pile.perMatch.toFixed(1)} times a MATCH`);

// 17. The named PRESET trios have to land on the ledger TBA recorded for the MATCHes they were built from
// (thebluealliance.com/match/2025cmptx_f1m1, read 2026-10-11): Johnson filled 12/12/12 BRANCHES plus 23
// trough CORAL with 9 in AUTO, 9 NET ALGAE and three DEEP CAGES for 295; Newton 12/12/11 plus 21 with the
// same 9 in AUTO, 9 in the NET and three DEEP CAGES for 281. The tolerances are the model's, not the field's:
// the trough is the loosest number in the arena (the manual never prints its capacity) and AUTO is bounded by
// the 15 s, so an ALLIANCE that beats the recorded column is not therefore right.
const PRESET_LEDGER = [
  { key: 'johnson', coral: 59, score: 295, name: 'Johnson A1' },
  { key: 'newton', coral: 56, score: 281, name: 'Newton A1' },
];
const meanCoralOf = (trio, seedBase) => {
  let coral = 0;
  let auto = 0;
  let autoPts = 0;
  let net = 0;
  let deep = 0;
  let leave = 0;
  let proc = 0;
  let total = 0;
  const byLevel = { L1: 0, L2: 0, L3: 0, L4: 0 };
  let n = 0;
  const perRobot = [0, 0, 0]; // the split is the EPA ratio's claim, so it gets printed, not just assumed
  for (let i = 0; i < 24; i++) {
    const m = playMatch({ seed: seedBase + i * 613, blueProfiles: trio, redProfiles: trio });
    for (const side of ['blue', 'red']) {
      const f = m.final[side];
      coral += Object.values(f.coral).reduce((a, x) => a + x.auto + x.tele, 0);
      auto += f.coral.L4.auto + f.coral.L3.auto + f.coral.L2.auto + f.coral.L1.auto;
      autoPts += ['L1', 'L2', 'L3', 'L4'].reduce((a, lv) => a + f.coral[lv].auto * POINTS.coral[lv][0], 0);
      net += f.algae.net;
      deep += f.barge.deep;
      leave += f.leave;
      proc += f.algae.processor;
      total += f.total;
      for (const lv of ['L1', 'L2', 'L3', 'L4']) byLevel[lv] += f.coral[lv].auto + f.coral[lv].tele;
      f.robots.forEach((r, slot) => { perRobot[slot] += r.placed.L1 + r.placed.L2 + r.placed.L3 + r.placed.L4; });
      n += 1;
    }
  }
  return {
    coral: coral / n,
    auto: auto / n,
    autoPts: autoPts / n,
    net: net / n,
    deep: deep / n,
    leave: leave / n,
    proc: proc / n,
    total: total / n,
    L1: byLevel.L1 / n,
    branches: ['L2', 'L3', 'L4'].map((lv) => byLevel[lv] / n),
    perRobot: perRobot.map((v) => v / n),
  };
};
const gen = meanCoralOf(SAMPLES, 23000);
const genericMean = gen.coral;
for (const want of PRESET_LEDGER) {
  const trio = PRESETS.find((p) => p.key === want.key).trio;
  const got = meanCoralOf(trio, 23000);
  const split = got.perRobot.map((v) => v.toFixed(1)).join(' / ');
  if (Math.abs(got.coral - want.coral) > 4) fail(`${want.name} scored ${got.coral.toFixed(1)} CORAL an ALLIANCE against TBA's recorded ${want.coral} — the preset is not calibrated`);
  else if (got.coral - genericMean < 5) fail(`${want.name} produces ${got.coral.toFixed(1)} CORAL against the generic trio's ${genericMean.toFixed(1)} — the preset is decoration, not a faster machine`);
  else pass(`${want.name}: ${got.coral.toFixed(1)} CORAL an ALLIANCE (recorded ${want.coral}), ${got.auto.toFixed(1)} in AUTO (recorded 9), ${got.net.toFixed(1)} in the NET (recorded 9), ${got.deep.toFixed(2)} DEEP CAGEs (recorded 3), per ROBOT ${split} · ${got.total.toFixed(1)} points against the recorded ${want.score}, of which ${(6 * got.proc).toFixed(0)} is a PROCESSOR column that record does not carry (${got.proc.toFixed(1)} ALGAE)`);
}

// 17b. The same ledger columns for the generic trio the page defaults to, because the paragraph under
// "Current state" quotes them side by side with 2025cmptx_f1m1. Printed, not asserted, except for LEAVE:
// every ROBOT crossing the AUTO line is a property of the clock budget, not a calibration target.
if (Math.abs(gen.leave - 9) > 0.3) fail(`the generic trio averaged ${gen.leave.toFixed(1)} LEAVE points an ALLIANCE, the AUTO budget pays 9`);
pass(`generic trio against the read MATCH: ${gen.autoPts.toFixed(1)} AUTO CORAL points (Johnson 63, Newton 60), ${gen.leave.toFixed(1)} LEAVE (both 9), BRANCHES ${gen.branches.map((v) => v.toFixed(1)).join('/')} of 12 (recorded 12/12/12 and 12/12/11), TROUGH ${gen.L1.toFixed(1)} (recorded 23 and 21), NET ${gen.net.toFixed(1)} (both 9), DEEP ${gen.deep.toFixed(2)} (both 3), ${gen.total.toFixed(1)} points with a ${gen.proc.toFixed(1)}-ALGAE PROCESSOR column worth ${(6 * gen.proc).toFixed(0)} of them (that record carries none), ${gen.total.toFixed(1)} - ${(6 * gen.proc).toFixed(0)} = ${(gen.total - 6 * gen.proc).toFixed(1)} without it`);

// 18. §6.3.4 stages 126 CORAL and 18 ALGAE and there is no other source, so every MATCH has to account for
// each piece exactly once: scored, still in a STATION, on a BRANCH or a MARK, loose on the carpet, held, in
// the opponent's PROCESSOR AREA, or overflowed out of it. Both of the two bugs this guard was written against
// were invisible in a score: a station drawn at 57-60 plus three preloads on top staged up to 132 CORAL, and
// a climb zeroed `rb.coral`/`rb.algae` instead of dropping them, so up to a dozen pieces left the field
// picture without anything noticing. The third assertion is that a dropped ALGAE is reachable again: a
// fumbled ring used to be pushed onto the carpet but the STRIP targets only listed the REEF, so the piece
// existed, was drawn, and could never be picked up.
let looseAlgaeFrames = 0;
for (let i = 0; i < 24; i++) {
  const m = playMatch({ seed: 31000 + i * 419, record: true });
  const c = m.stock.coral;
  const a = m.stock.algae;
  if (c.scored + c.stations + c.loose + c.held !== 126) {
    fail(`CORAL accounted for ${JSON.stringify(c)} = ${c.scored + c.stations + c.loose + c.held}, §6.3.4.1 stages 126`);
  }
  // A ring a ROBOT lifts into its own NET is spent without ever reaching a PROCESSOR (§6.1), so `netRobot`
  // is a consuming column of its own; `net` is not, because the thrown half of it is the processed pieces.
  const at = a.processed + a.netRobot + a.onReef + a.loose + a.held;
  if (at !== 18) {
    fail(`ALGAE accounted for ${JSON.stringify(a)} = ${at}, §6.3.4.2 stages 18`);
  }
  for (const f of m.frames) {
    const n = f.floor.filter((p) => p.kind === 'algae').length;
    if (n > 0) looseAlgaeFrames += 1;
    // The CARPET read-out splits the loose pieces by ALLIANCE, and a frame that dropped `side` made it print
    // nothing while every piece was still being drawn.
    for (const p of f.floor) if (p.side !== 'blue' && p.side !== 'red') fail(`a loose ${p.kind} reached the replay without a side`);
  }
}
if (looseAlgaeFrames === 0) fail('not one loose ALGAE appeared on the carpet over 24 MATCHes — the drop path is dead code');
else pass(`pieces close: over 24 MATCHes every one of the 126 CORAL and 18 ALGAE §6.3.4 stages is accounted for, and a loose ALGAE appeared on the carpet in ${looseAlgaeFrames} frames`);

// 19. G421 (1 defender at a time) is on the clause table but is never charged, and "never charged" is only
// honest if the traffic that would charge it is measured. §7.4.3 lets ONE ROBOT per ALLIANCE sit on the
// opponent's half with its BUMPERS fully outside the BARGE ZONES; the second one is a MINOR plus a MAJOR
// every 3 s. The shipped baselines never send a second: greedy prices its own REEF, its own STATION and the
// PROCESSOR, and with 24 CORAL still to place on its own side a crossing is worth nothing. If a Stage 2
// planner starts parking two ROBOTS over the BARGE, this guard fails and the clause has to be charged
// rather than left on the table as decoration.
const g19 = layout();
const bumperReach = 15; // half of the 30 in R104 footprint
let acrossFrames = 0, twoAcross = 0, g19ticks = 0;
for (let i = 0; i < 24; i++) {
  const m = playMatch({ seed: 41000 + i * 383, record: true });
  for (const f of m.frames) {
    g19ticks++;
    for (const side of ['blue', 'red']) {
      const opp = side === 'blue' ? 'red' : 'blue';
      const n = f.robots.filter((r) => {
        if (r.side !== side) return false;
        if (side === 'blue' ? r.x <= g19.midX : r.x >= g19.midX) return false;
        return [g19[side].bargeZone, g19[opp].bargeZone].every((z) => Math.abs(r.x - z.x) > z.halfX + bumperReach || Math.abs(r.y - z.y) > z.halfY + bumperReach);
      }).length;
      if (n >= 1) acrossFrames++;
      if (n >= 2) twoAcross++;
    }
  }
}
if (twoAcross > 0) fail(`G421: ${twoAcross} of ${g19ticks} frames put a 2nd ROBOT on the opponent's half outside the BARGE ZONES without charging the clause`);
else pass(`G421 traffic: over ${g19ticks} frames of 24 MATCHes ${acrossFrames} held a single ROBOT across the BARGE and none held a second, so the clause has nothing to charge — guard 23 drives two across on purpose`);

// 20. The planner has to earn its place in the bundle. Two assertions, and the second is the one that bites:
// it must capture the headroom `npm run headroom` measured over the shipped baseline, AND it must not lose to
// the best fixed rule it could have been replaced by. A planner that rediscovers a good rule from what the
// MATCH shows is shippable; one that discovers it worse is a liability wearing a smarter label. Each check
// runs BOTH seat orders, because a single order lets whatever bias survives the mirror masquerade as a
// strategy. Seeds 51000+ are the guard's own: the published numbers come from 9000 and 21000, so this is a
// held-out set rather than the one the model was tuned against.
const G20FIXED = { placeOrder: ['L3', 'L4', 'L2', 'L1'], climbWindowSec: 6 };
const g20 = (blueKind, redKind, bluePolicyOpts = {}, redPolicyOpts = {}) => {
  const e = evaluate({ blueKind, redKind, matches: 16, seedBase: 51000, bluePolicyOpts, redPolicyOpts });
  return { m: e.avgBlue - e.avgRed, se: e.marginSe, blue: e.avgBlue, red: e.avgRed };
};
const g20a = g20('ai', 'greedy');
const g20b = g20('greedy', 'ai');
const g20c = g20('ai', 'greedy', {}, G20FIXED);
const g20d = g20('greedy', 'ai', G20FIXED, {});
const vsGreedy = (g20a.m - g20b.m) / 2;
const vsFixed = (g20c.m - g20d.m) / 2;
const g20windows = [];
for (let i = 0; i < 16; i++) {
  const r = playMatch({ blueKind: 'ai', redKind: 'greedy', seed: 51000 + i * 977 });
  g20windows.push({ w: r.policies.blue.plan.climbWindowSec, moved: r.policies.blue.planLog.some((e) => e.switchTo) });
}
const g20early = g20windows.filter((x) => x.w <= 8).length;
const g20moved = g20windows.filter((x) => x.moved).length;
if (vsGreedy < 6) fail(`planner captures only ${vsGreedy.toFixed(1)} pts over the shipped baseline (headroom measures +12.5 and +16.2): ${JSON.stringify(g20windows.map((x) => x.w))}`);
else if (vsFixed < -6) fail(`the planner LOSES ${(-vsFixed).toFixed(1)} pts to the fixed rule it was built to replace — planning is not paying for itself`);
else if (g20early < 12) fail(`the planner only chose an early commit in ${g20early}/16 MATCHes, so it is not finding the answer the model predicts`);
else pass(`planner vs shipped baseline ${vsGreedy >= 0 ? '+' : ''}${vsGreedy.toFixed(1)} pts (${g20a.m.toFixed(1)} ± ${g20a.se.toFixed(1)} blue, ${(-g20b.m).toFixed(1)} ± ${g20b.se.toFixed(1)} red) and vs the best fixed rule ${vsFixed >= 0 ? '+' : ''}${vsFixed.toFixed(1)} pts · commit ≤8 s in ${g20early}/16 MATCHes, ${g20moved}/16 re-planned away from the opening plan`);

// 21. The NET has a second feeder, and it is the ROBOT: §6.1 says "ROBOTS also collect ALGAE and score in
//     their PROCESSOR or NET", Table 6-2 pays the NET in the AUTO column, and G404 bars only the HUMAN PLAYER
//     from entering ALGAE during AUTO. The build had it as HUMAN-PLAYER-only on the argument that the mesh
//     hangs 6 ft 4 in up (§5.4.2) against R104's 3 ft 6 in — but R104 measures the STARTING CONFIGURATION, not
//     an elevator in play. So `INTENT.SCORE_NET` exists and is gated on the machine's reach (`netScoreSec`),
//     which the shipped profiles now carry: 1.9 / 1.4 / 2.05 s, each one its own L4 time plus 0.5 s, because
//     a machine that puts a CORAL on the 72 in BRANCH clears the 76 in border. This guard runs the shipped
//     trio and the same trio with the reach forced back to 0, and checks the books still close: the deposit
//     fires, each ring is spent once, the HUMAN PLAYER chain keeps its backing, the ALGAE column is Table 6-2
//     arithmetic, every deposit is made on the ALLIANCE's own half of the FIELD beside its own mesh (G420
//     forbids contacting it, so the ROBOT never goes inside), and the reach is the only thing that decides
//     whether it happens at all.
const g21no = SAMPLES.map((p) => ({ ...p, netScoreSec: 0 }));
const g21mid = layout().midX;
let g21deposits = 0;
let g21matches = 0;
for (let i = 0; i < 16; i++) {
  const m = playMatch({ seed: 61000 + i * 601, blueProfiles: SAMPLES, redProfiles: SAMPLES, record: true });
  const robot = m.final.blue.algae.netByRobot + m.final.red.algae.netByRobot;
  g21deposits += robot;
  if (robot > 0) g21matches += 1;
  const a = m.stock.algae;
  if (a.processed + a.netRobot + a.onReef + a.loose + a.held !== 18) fail(`net-capable MATCH ${i}: ALGAE accounted for ${JSON.stringify(a)}, §6.3.4.2 stages 18`);
  for (const side of ['blue', 'red']) {
    const opp = side === 'blue' ? 'red' : 'blue';
    const s = m.final[side];
    const o = m.final[opp];
    if (s.algae.net - s.algae.netByRobot > o.algae.processor) fail(`net-capable MATCH ${i}: ${side} threw ${s.algae.net - s.algae.netByRobot} into its NET on ${o.algae.processor} processed by ${opp}`);
    if (s.algaePoints !== POINTS.algae.processor[1] * s.algae.processor + POINTS.algae.net[1] * s.algae.net) fail(`net-capable MATCH ${i}: ${side} ALGAE ${s.algaePoints} is not 6·${s.algae.processor} + 4·${s.algae.net} (Table 6-2)`);
  }
  for (const e of m.events.filter((x) => x.kind === 'net' && x.by === 'robot')) {
    const f = m.frames.find((fr) => fr.t >= e.t);
    const r = f && f.robots.find((x) => x.side === e.side && x.slot === e.slot);
    if (!r) fail(`a ROBOT NET event at ${e.t}s had no frame to point at`);
    else if (e.side === 'blue' ? r.x > g21mid : r.x < g21mid) fail(`a ${e.side} ROBOT deposited into the NET from x=${r.x} on the opponent's half`);
  }
}
const g21off = playMatch({ seed: 61000, blueProfiles: g21no, redProfiles: g21no, record: true });
if (g21off.final.blue.algae.netByRobot || g21off.final.red.algae.netByRobot) fail('netScoreSec 0 still deposited an ALGAE into the NET');
if (g21matches < 12) fail(`the NET action only fired in ${g21matches}/16 MATCHes with the shipped reach — it is not a real option`);
else pass(`NET by ROBOT (§6.1): fired in ${g21matches}/16 MATCHes with the shipped trio, ${(g21deposits / 16).toFixed(1)} deposits a MATCH, books closed and every deposit made from its own half; the same seed with the reach forced to 0 made ${g21off.final.blue.algae.netByRobot + g21off.final.red.algae.netByRobot}`);

// 22. Guard 9 proves fouls can be switched OFF, which is worth nothing if nothing switches them ON: over the
//     24-MATCH mirror the shipped baselines charge ZERO fouls, because greedy never drives into an opponent.
//     So this guard drives a fleet that does — one side parked, the other pressing the nearest car — and the
//     referee path has to produce points. It also reads G425's escalation, the one severity in Table 6-3 that
//     depends on how long the violation has already gone on: a MINOR, then a MAJOR for every 3 s the PIN is
//     not corrected, so a 15 s hold costs 26 points and not the 10 a flat MINOR would give.
const g22park = { onPeriodStart() {}, reset() {}, decide: () => ({ mode: INTENT.IDLE }) };
const g22press = {
  onPeriodStart() {},
  reset() {},
  decide(rb, obs) {
    const o = obs.opponents.filter((x) => !x.disabled)[0];
    return o ? { mode: INTENT.IDLE, target: { x: o.x, y: o.y } } : { mode: INTENT.IDLE };
  },
};
const g22 = (foulsOff) => simulateMatch({
  blueProfiles: SAMPLES,
  redProfiles: SAMPLES,
  bluePolicy: g22press,
  redPolicy: g22park,
  scenario: { ...defaultScenario(), foulsOff, seed },
});
const g22on = g22(false);
const g22off = g22(true);
const g22fouls = g22on.events.filter((e) => e.kind === 'foul');
const g22tally = {};
for (const e of g22fouls) g22tally[e.code] = (g22tally[e.code] || 0) + 1;
const g22pin = {};
for (const e of g22fouls.filter((x) => x.code === 'G425')) {
  const k = `${e.side}${e.slot + 1}`;
  (g22pin[k] = g22pin[k] || []).push(e.sev);
}
const g22escalated = Object.values(g22pin).some((sevs) => sevs.length > 1 && sevs[0] === 'minor' && sevs.slice(1).every((s) => s === 'major'));
if (!g22fouls.length) fail('a ROBOT pressing an opponent charged no FOUL at all — the Table 6-3 path is dead code');
else if (g22off.events.some((e) => e.kind === 'foul')) fail('foulsOff still charged fouls while a ROBOT was pressing');
else if (g22on.final.blue.fouls + g22on.final.red.fouls <= 0) fail('fouls were charged but no points came of it');
else if (!g22escalated) fail(`G425 never escalated MINOR -> MAJOR on a repeat: ${JSON.stringify(g22pin)}`);
else pass(`fouls are reachable and graded: a pressing fleet charged ${g22fouls.length} of them (${Object.entries(g22tally).map(([k, v]) => `${k}×${v}`).join(', ')}) worth ${g22on.final.blue.fouls + g22on.final.red.fouls} points, G425 repeats came back as MAJOR, and foulsOff charged none`);

// 23. §7.4.4 has to be reachable, mutually exclusive, and able to end a MATCH. The shipped floor sits at the
//     p90 of the collision distribution, so an ordinary MATCH assesses ~0.3 of these and a guard cannot wait
//     for that tail: this arm drops the floor to 20 and the damage roll to 0.9 and presses on purpose, which
//     is the same code path with the rare event made certain.
const g23ram = {
  onPeriodStart() {},
  reset() {},
  decide(rb, obs) {
    const o = obs.opponents.filter((x) => !x.disabled).sort((a, b) => a.d - b.d)[0];
    return o ? { mode: INTENT.DEFEND, targetRobot: o.slot } : { mode: INTENT.IDLE };
  },
};
const g23 = (over = {}) => simulateMatch({
  blueProfiles: SAMPLES,
  redProfiles: SAMPLES,
  bluePolicy: g23ram,
  redPolicy: greedyPolicy('red', {}),
  scenario: { ...defaultScenario(), seed, contactHitSeverity: 20, contactImpairP: 0.9, ...over },
  record: true,
});
const g23on = g23();
const TRIO = ['G422', 'G423', 'G424'];
const g23fouls = g23on.events.filter((e) => e.kind === 'foul' && TRIO.includes(e.code));
const g23perTick = {};
// Keyed on the PAIR, not on the robot: §7.4.4 assesses one penalty per collision, and a machine that arrives
// wedged between two opponents has had two collisions. Keying on the robot alone reads a double-team as a
// double charge, which is what the press now does since the stand-off holds it at the zone line.
for (const e of g23fouls) {
  const k = `${e.t}|${e.side}${e.slot}|${e.victim || '?'}`;
  g23perTick[k] = (g23perTick[k] || 0) + 1;
}
const g23doubled = Object.entries(g23perTick).filter(([, n]) => n > 1);
const g23nocard = g23fouls.filter((e) => !e.card);
const g23impaired = g23on.frames.some((f) => f.robots.some((r) => r.impair));
const g23off = g23({ contactFouls: false });
const g23defended = g23on.final.blue.robots.reduce((a, r) => a + r.defend, 0);
const g23blocked = g23on.final.blue.robots.reduce((a, r) => a + r.blocked, 0);
const g23dq = g23on.final.blue.robots.filter((r) => r.disabled);
if (!(g23defended > 5)) fail(`the DEFEND intent kept a ROBOT pressuring for only ${g23defended.toFixed(1)} s — the action is not reaching the motion code`);
else if (!(g23fouls.length > 0)) fail('a fleet pressing with the floor at 20 in/s charged no §7.4.4 FOUL — the trio is dead code');
else if (g23doubled.length) fail(`one collision produced ${JSON.stringify(g23doubled)} — §7.4.4 says only the most punitive penalty is assessed`);
else if (g23nocard.length) fail(`${g23nocard.length} of the §7.4.4 fouls carried no card: both clauses are "MAJOR FOUL and YELLOW CARD" or worse`);
else if (!g23impaired) fail('a §7.4.4 call left every ROBOT at full capability — the functional-impairment half of the clause is not plumbed');
else if (!(g23dq.length > 0)) fail(`no ROBOT was DISQUALIFIED after ${g23fouls.length} carded fouls — §6.6.2 makes a second YELLOW in one MATCH a RED`);
else if (g23off.events.some((e) => TRIO.includes(e.code ?? ''))) fail('contactFouls false still assessed the §7.4.4 trio');
else pass(`§7.4.4 is live: ${g23fouls.length} calls in one MATCH (${Object.entries(g23fouls.reduce((a, e) => ({ ...a, [e.code]: (a[e.code] || 0) + 1 }), {})).map(([k, v]) => `${k}×${v}`).join(', ')}), one per collision, every one carded, ${g23dq.length} ROBOT${g23dq.length > 1 ? 's' : ''} out for the MATCH, ${g23defended.toFixed(0)} s of press with ${g23blocked.toFixed(0)} s of it in contact, and none of it with the switch off`);

// 23b. G421 is the clause that makes a second machine out there the violation rather than the tactic, and it
//      has to escalate the way the clause says: MINOR once, then a MAJOR for every 3 s the situation is not
//      corrected. Shipped traffic never gets there — the G421 traffic count above reads 883 frames with one
//      ROBOT beyond the BARGE band and none with a second — and since the trio started lifting its own ALGAE
//      it crosses even less, so the two-defender arm that used to reach the escalation by chasing opponents
//      home now stops at one MINOR. This arm parks two machines at the opponent's ALLIANCE STATION wall on
//      purpose. It uses IDLE with a target rather than DEFEND because G421 is one of the codes `pressOver`
//      counts: a defending pair is sent home for the MATCH by its second strike, before the clause's third
//      second is up, which is the deterrent working as designed and not the ladder.
const g21geo = layout();
const g21greedy = greedyPolicy('blue', {});
const g21wall = FIELD.longIn - 30;
const g21spots = [{ x: g21wall, y: g21geo.midY - 70 }, { x: g21wall, y: g21geo.midY + 70 }];
const g21hold = {
  onPeriodStart: (s) => g21greedy.onPeriodStart(s),
  reset: () => g21greedy.reset(),
  decide(rb, obs) {
    if (rb.slot > 1) return g21greedy.decide(rb, obs);
    return { mode: INTENT.IDLE, target: g21spots[rb.slot] };
  },
};
const g21two = simulateMatch({
  blueProfiles: SAMPLES,
  redProfiles: SAMPLES,
  bluePolicy: g21hold,
  redPolicy: greedyPolicy('red', {}),
  scenario: { ...defaultScenario(), seed },
  record: true,
});
const g21fouls = g21two.events.filter((e) => e.kind === 'foul' && e.code === 'G421');
const g21byRobot = {};
for (const e of g21fouls) (g21byRobot[`${e.side}${e.slot}`] = g21byRobot[`${e.side}${e.slot}`] || []).push(e.sev);
const g21seq = Object.values(g21byRobot).filter((s) => s.length > 1 && s[0] === 'minor' && s.slice(1).every((x) => x === 'major'));
if (!(g21fouls.length > 0)) fail('two ROBOTs were parked beyond the opponent BARGE ZONE and G421 charged nothing — the one-defender limit is not being read');
else if (!g21seq.length) fail(`G421 never escalated MINOR -> MAJOR on a hold that was not corrected: ${JSON.stringify(g21byRobot)}`);
else pass(`G421 charges the second machine across: ${g21fouls.length} fouls over ${Object.keys(g21byRobot).length} ROBOTS, ${g21seq.length} of them escalating MINOR then MAJOR every 3 s as §7.4.3 says`);

// 24. The two deny sources — the opponent's CORAL STATION queue and the opponent's REEF ALGAE — are legal, and
//     greedy never bids them because the crossing costs more per point than the queue at home. "Never bid" is
//     not "impossible", so this drives each one on purpose and checks the books still close.
const g24steal = {
  onPeriodStart() {},
  reset() {},
  decide(rb, obs) {
    if (rb.coral >= 1) {
      const lv = ['L4', 'L3', 'L2', 'L1'].find((l) => obs.free[l] > 0);
      return lv ? { mode: INTENT.PLACE, level: lv } : { mode: INTENT.PROCESS };
    }
    const s = obs.enemyStations.filter((x) => x.remaining > 0).sort((a, b) => a.d - b.d)[0];
    return s ? { mode: INTENT.FETCH_CORAL, target: { x: s.x, y: s.y }, stationIdx: s.i, stationSide: obs.side === 'blue' ? 'red' : 'blue' } : { mode: INTENT.IDLE };
  },
};
const g24stealMatch = simulateMatch({ blueProfiles: SAMPLES, redProfiles: SAMPLES, bluePolicy: g24steal, redPolicy: greedyPolicy('red', {}), scenario: { ...defaultScenario(), seed }, record: true });
const lastFrame = (m) => m.frames[m.frames.length - 1];
const queueOf = (m, side) => lastFrame(m).stations[side].reduce((a, x) => a + x, 0);
const redLeft = queueOf(g24stealMatch, 'red');
const blueLeft = queueOf(g24stealMatch, 'blue');
const stolenPlaced = g24stealMatch.final.blue.robots.reduce((a, r) => a + Object.values(r.placed).reduce((x, y) => x + y, 0), 0);
const stockCoral = g24stealMatch.stock.coral;
const greedyRef = playMatch({ seed, redProfiles: SAMPLES, blueProfiles: SAMPLES, record: true });
if (!(queueOf(greedyRef, 'red') > redLeft + 10)) fail(`a fleet pointed at the opponent's CORAL STATION left ${redLeft} in RED's queues against the baseline's ${queueOf(greedyRef, 'red')} — the fetch never crossed`);
else if (!(stolenPlaced > 0)) fail('the thief fetched from the opponent queue and never placed a CORAL — the source is plumbed but the cycle is not');
else if (stockCoral.scored + stockCoral.stations + stockCoral.loose + stockCoral.held !== PIECES.coral.stagedPerMatch) fail(`the CORAL books do not close on a stolen piece: ${JSON.stringify(stockCoral)}`);
else pass(`CORAL theft works: RED's queue went from ${queueOf(greedyRef, 'red')} left to ${redLeft} while BLUE's went from ${queueOf(greedyRef, 'blue')} to ${blueLeft}, ${stolenPlaced} CORAL placed, and all ${PIECES.coral.stagedPerMatch} the MATCH staged still accounted for`);
const g24algae = {
  onPeriodStart() {},
  reset() {},
  decide(rb, obs) {
    if (rb.algae >= 1) return { mode: INTENT.PROCESS };
    const a = obs.algaeNear.filter((x) => x.enemy)[0] || obs.algaeNear[0];
    return a ? { mode: INTENT.STRIP_ALGAE, target: { x: a.x, y: a.y }, piece: a.ref } : { mode: INTENT.IDLE };
  },
};
const g24a = simulateMatch({ blueProfiles: SAMPLES, redProfiles: SAMPLES, bluePolicy: g24algae, redPolicy: greedyPolicy('red', { noAlgae: true }), scenario: { ...defaultScenario(), seed, contactFouls: false }, record: true });
const enemyRings = g24a.frames[g24a.frames.length - 1].reef.red.algae;
const ownRings = g24a.frames[g24a.frames.length - 1].reef.blue.algae;
if (!(g24a.final.blue.algae.processor > 0)) fail('a fleet told to strip ALGAE scored none in the PROCESSOR');
else if (!(enemyRings < ALGAE_PER_ALLIANCE)) fail(`the ALGAE on the opponent's REEF never moved (${enemyRings} of ${ALGAE_PER_ALLIANCE} left) — the enemy rings are not reachable targets`);
else pass(`the opponent's REEF is a legal ALGAE source: blue took it from ${ALGAE_PER_ALLIANCE} to ${enemyRings} rings left while its own REEF still held ${ownRings}, and booked ${g24a.final.blue.algae.processor} in the PROCESSOR`);

// 25. The zone-risk gate on the enemy REEF (the crossing is charged as G418 — the route to their ALGAE runs
// past their CAGEs, which is where a machine alone on the far half gets touched). Four things have to be
// true: it deters the fleets that are free to choose, without being the lever that decides their MATCH; a fleet
// ORDERED to strip still goes; that trip still costs fouls; and a fleet told never to go over there takes
// none. The ordered fleet is the interesting one and it reads the same either way — 0.63 rings gated against
// 0.50 ungated — because the gate prices a CHOICE, and a duty assignment is not one. The last clause used to
// read "changes nothing about the fleets that never cross"; since the trio carries a NET reach a robot that
// takes their ring and lifts it to its own NET is bid-able, so shipped fleets do cross a little (0.06 rings
// gated against 0.19 ungated) and the gate is live on the default MATCH — what is asserted now is that it is a
// nudge there, not a load-bearing lever.
const zrSeeds = [];
for (const b of [9000, 21000]) for (let i = 0; i < 8; i++) zrSeeds.push(b + i * 977);
const zrRun = (opts, seed, record = false) => playMatch({
  blueKind: 'greedy',
  redKind: 'greedy',
  seed,
  blueProfiles: SAMPLES,
  redProfiles: SAMPLES,
  bluePolicyOpts: { climbWindowSec: 8, ...opts },
  record,
});
// The crossing read is the engine's own deny counter — rings this fleet actually took off the opponent's REEF
// — not a geometric test on where a machine is pointing. A strip TARGET over on their half is not a crossing:
// a ring that fell and came to rest past the centreline is a loose piece with no side to it, and on the arm
// that is told never to cross the two reads disagree (9 frames with their target over there, 0 rings taken).
const zrTaken = (m) => m.final.blue.deny.theirAlgae;
const zrShip = (opts) => {
  let total = 0;
  let cross = 0;
  for (const s of zrSeeds) {
    const m = zrRun(opts, s, true);
    total += m.final.blue.total + m.final.red.total;
    cross += zrTaken(m);
  }
  return { mean: total / zrSeeds.length, cross: cross / zrSeeds.length };
};
const zrShipOn = zrShip({});
const zrShipOff = zrShip({ zoneRisk: false });
const zrArm = (opts) => {
  let pts = 0;
  let cross = 0;
  for (const s of zrSeeds) {
    const m = zrRun({ algaeSlots: [0, 1, 2], ...opts }, s, true);
    pts += m.final.red.fouls;
    cross += zrTaken(m);
  }
  return { pts: pts / zrSeeds.length, cross: cross / zrSeeds.length };
};
const zrDuty = zrArm({});
const zrDutyOff = zrArm({ zoneRisk: false });
const zrNever = zrArm({ enemyAlgae: false });
if (!(zrShipOn.cross < zrShipOff.cross)) fail(`the gate does not reach the shipped fleets: they take ${zrShipOff.cross.toFixed(2)} rings off the opponent's REEF ungated against ${zrShipOn.cross.toFixed(2)} gated — the bid that pays for a crossing is not being read`);
else if (Math.abs(zrShipOn.mean - zrShipOff.mean) > 4) fail(`the gate is load-bearing for the default MATCH: it moves the two fleets by ${(zrShipOn.mean - zrShipOff.mean).toFixed(1)} pts a MATCH`);
else if (!(zrNever.cross === 0 && zrNever.pts === 0)) fail(`the never-crossing control is not inert (${zrNever.cross.toFixed(2)} rings off their REEF, ${zrNever.pts.toFixed(1)} donated fouls) — the read below cannot be trusted`);
else if (!(zrDuty.pts - zrNever.pts >= 1)) fail(`the crossing costs nothing: a fleet told to strip donates ${zrDuty.pts.toFixed(2)} fouls a MATCH against ${zrNever.pts.toFixed(2)} for a fleet told never to go (n=${zrSeeds.length})`);
else if (!(zrDuty.cross > 0)) fail(`the gate is a ban, not a price: a fleet told to strip takes ${zrDuty.cross.toFixed(2)} of their rings a MATCH, and ${zrDutyOff.cross.toFixed(2)} with the gate off, while the never-crossing control takes ${zrNever.cross.toFixed(2)}`);
else pass(`zone risk priced: the gate takes the shipped fleets' crossing from ${zrShipOff.cross.toFixed(2)} to ${zrShipOn.cross.toFixed(2)} rings off the opponent's REEF a MATCH for ${(zrShipOn.mean - zrShipOff.mean).toFixed(1)} pts of combined score; a fleet ORDERED to strip goes anyway (${zrDuty.cross.toFixed(2)} gated, ${zrDutyOff.cross.toFixed(2)} ungated — the gate moves fleets that choose, not fleets that are told) and pays ${zrDuty.pts.toFixed(2)} fouls for it against the ${zrNever.pts.toFixed(2)} of the control that takes none`);

// 26. The ALGAE duty is PRICED, and the price is measured on the engine rather than asserted. This is the
// guard the duty search rests on: a model that cannot see the crossing would rank a duty by which machine it
// happens to free from the station queue. Read one-sided (BLUE told to strip, RED playing the shipped policy)
// for the leakage and the fouls, because in a mirror the donations cancel; and read the MIRROR for the
// ranking, because that is what the planner decides against. What the engine measures under the lifting
// profile, over these 16 seeds: the three duty arms take 0.19 / 0.31 / 0.63 rings from the opponent's REEF for
// one, two and three machines on duty, donate 0.38 / 1.88 / 1.13 points, and the fleet's own ring count (the
// PROCESSOR column plus what a ROBOT lifted into its NET) is 8.69 with no duty against 9.07 / 9.19 / 9.25 with
// it. The one-sided MARGIN is 7.56 / 10.69 / 10.69 / 5.94 — a spread of three points on 16 seeds with no error
// bar, which is why nothing below claims a sign for it.
const drSeeds = [];
for (const b of [9000, 21000]) for (let i = 0; i < 8; i++) drSeeds.push(b + i * 977);
const drPlan = (algaeSlots) => ({ placeOrder: ['L4', 'L3', 'L2', 'L1'], climbWindowSec: 8, algaeSlots, bands: null });
const drEngine = (algaeSlots) => drSeeds.map((s) => {
  const m = playMatch({
    blueKind: 'greedy',
    redKind: 'greedy',
    seed: s,
    blueProfiles: SAMPLES,
    redProfiles: SAMPLES,
    bluePolicyOpts: { climbWindowSec: 8, algaeSlots },
  });
  return {
    margin: m.final.blue.total - m.final.red.total,
    rings: m.final.blue.algae.processor + m.final.blue.algae.netByRobot,
    crossed: m.final.blue.deny.theirAlgae,
    donated: m.final.red.fouls,
  };
});
const drCtx = makeContext({ profiles: SAMPLES, geo: layout(), side: 'blue', scenario: defaultScenario() });
drCtx.efficiency = 1.3925; // the mean of the 1.300 and 1.485 that `npm run fastsim` fits on its two seed bases
const drModel = (algaeSlots, opts = {}) => estimateAlliance(drCtx, drPlan(algaeSlots), opts);
const drNone = drEngine(null);
const drAll = drEngine([0, 1, 2]);
const drOne = drEngine([2]);
const drMean = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;
const drNoneEst = drModel(null, { mirror: false });
const drAllEst = drModel([0, 1, 2], { mirror: false });
const drOneEst = drModel([2], { mirror: false });
// The ranking is the mirror reading: one-sided, a crossing is worth exactly what it gives (6 points in the
// PROCESSOR minus the 4 the opponent's HUMAN PLAYER converts it into, less the fouls it donates), so the
// planner's decision has to come from the case where both fleets are told the same thing.
const drDutyEst = [[2], [1, 2], [0, 1, 2]].map((d) => planValue(drModel(d)) - planValue(drModel(null)));
const drMirrorNone = drModel(null);
const drMirrorDuty = drModel([0, 1, 2]);
if (drNoneEst.donated !== 0 || drNoneEst.algaeCrossed !== 0) fail(`the model books ${drNoneEst.algaeCrossed.toFixed(2)} crossings and ${drNoneEst.donated.toFixed(1)} fouls for a fleet with no ALGAE duty`);
else if (!(drAllEst.algaeCrossed > 0 && drAllEst.donated > 0)) fail(`the model prices nothing: a fleet with three machines on ALGAE books ${drAllEst.algaeCrossed.toFixed(2)} crossings and ${drAllEst.donated.toFixed(1)} fouls`);
else if (drDutyEst.some((v) => !(v <= 0))) fail(`the model prefers a duty plan to none in a mirror: the three arms rank ${drDutyEst.map((v) => v.toFixed(1)).join(' / ')} against no-duty`);
else if (Math.max(drOneEst.algaeCrossed, drAllEst.algaeCrossed) - Math.min(drOneEst.algaeCrossed, drAllEst.algaeCrossed) < 0.1) fail(`the model does not scale the crossing with the duty: one machine ${drOneEst.algaeCrossed.toFixed(2)} crossings, three ${drAllEst.algaeCrossed.toFixed(2)}`);
else if (Math.abs(drAllEst.algaeCrossed - drMean(drAll, 'crossed')) > 0.25) fail(`the leakage is the wrong size: the model sends a three-machine duty fleet across ${drAllEst.algaeCrossed.toFixed(2)} times a MATCH, the engine took ${drMean(drAll, 'crossed').toFixed(2)} rings off the opponent's REEF`);
else if (Math.abs(drOneEst.algaeCrossed - drMean(drOne, 'crossed')) > 0.25) fail(`the leakage does not track the duty: one machine on duty, model ${drOneEst.algaeCrossed.toFixed(2)} crossings against the engine's ${drMean(drOne, 'crossed').toFixed(2)}`);
else if (Math.abs(drAllEst.donated - (drMean(drAll, 'donated') - drMean(drNone, 'donated'))) > 1.5) fail(`the price is the right sign and the wrong size: the model charges ${drAllEst.donated.toFixed(1)} fouls a MATCH, the engine pays ${(drMean(drAll, 'donated') - drMean(drNone, 'donated')).toFixed(1)}`);
else if (Math.abs(drAllEst.algae - drMean(drAll, 'rings')) > 0.6) fail(`the crossing changes the ALGAE column the wrong way: model ${drAllEst.algae.toFixed(2)} rings, engine ${drMean(drAll, 'rings').toFixed(2)}`);
else if (Math.abs(drMirrorDuty.algae - drMirrorNone.algae) > 0.01) fail(`in a mirror the model counts the trip as ${((drMirrorDuty.algae - drMirrorNone.algae) * 6).toFixed(1)} points of new ALGAE (${drMirrorDuty.algae.toFixed(2)} rings against ${drMirrorNone.algae.toFixed(2)}) when the engine says it only moves them`);
else if (!(planValue(drMirrorDuty) < planValue(drMirrorNone))) fail(`in a mirror the model still prefers the duty plan: ${planValue(drMirrorDuty).toFixed(1)} against ${planValue(drMirrorNone).toFixed(1)}`);
else pass(`duty priced: a three-machine duty fleet crosses ${drAllEst.algaeCrossed.toFixed(2)} times a MATCH against the engine's ${drMean(drAll, 'crossed').toFixed(2)} (one machine: ${drOneEst.algaeCrossed.toFixed(2)} against ${drMean(drOne, 'crossed').toFixed(2)}), the trip costs ${drAllEst.donated.toFixed(1)} fouls against the ${(drMean(drAll, 'donated') - drMean(drNone, 'donated')).toFixed(1)} paid over ${drSeeds.length} seeds, the ALGAE column reads ${drAllEst.algae.toFixed(2)} rings against the engine's ${drMean(drAll, 'rings').toFixed(2)}, the three duty arms rank ${drDutyEst.map((v) => v.toFixed(1)).join(' / ')} below no-duty in a mirror, and there the trip moves the column (${drMirrorDuty.algae.toFixed(2)} against ${drMirrorNone.algae.toFixed(2)}) instead of adding to it`);

// 27. The STATION SPREAD is priced as seconds off a cycle rather than as a bonus handed to the plan, and the
// engine has to keep saying the seconds are real. Each ALLIANCE has TWO CORAL STATIONs, in the pockets where
// its WALL meets the guardrails, and the shipped bid sends all three machines to the nearer one, so a pick can
// begin with a teammate already queueing at it: the counter books 27.0% of a one-sided fleet's picks that way.
// `policy.js` trades up to `SPREAD_PENALTY` seconds of drive to avoid the corner and `fastsim.js` credits the
// cycle `SPREAD_SAVED_SEC`, which is 0.15 s now rather than the 0.38 s this lever shipped on. The statistic
// that carried the 0.38 has gone the other way under the lifting profile — a pick that began contested follows
// that machine's last pick by 4.34 ± 0.18 s against 6.83 ± 0.11 s when it began alone (n=257 against 2,703 over
// 24 seeds), because rejoining the corner your fleet never left is a short drive — so the credit is now priced
// off the MATCH, one-sided the way the planner decides: +1.1 ± 2.0 own points over these same 24 paired
// held-out seeds, and −3.1 ± 2.4 margin when both fleets are told to do it. Eight ways that could be hollow, each with a clause: the model might not
// prefer the spread at all; it might prefer it by a FLAT bonus (which would read the same with 90 s left as with
// 30); its step might sit further from the engine read than 2.5 points; it might out-price the measurement's own
// upper band; the corner might not be a queue; pricing it might not thin it (the bid would be moving points and
// not machines); the mirror might not be a wash; or the OFF value might not be off, which would silently
// re-base every number this page publishes.
const spSeeds = [];
for (const b of [51000, 62000]) for (let i = 0; i < 12; i++) spSeeds.push(b + i * 977);
const spOpts = (spread) => ({ climbWindowSec: 6, stationSpread: spread ? SPREAD_PENALTY : 0 });
const spRun = (blueSpread, redSpread, s) => {
  const f = playMatch({
    seed: s, blueKind: 'greedy', redKind: 'greedy', blueProfiles: SAMPLES, redProfiles: SAMPLES,
    bluePolicyOpts: spOpts(blueSpread), redPolicyOpts: spOpts(redSpread),
  }).final;
  return { blue: f.blue.total, margin: f.blue.total - f.red.total, picks: f.blue.contest.picks, contested: f.blue.contest.contested };
};
const spOff = spSeeds.map((s) => spRun(false, false, s));
const spOn = spSeeds.map((s) => spRun(true, false, s));
const spBoth = spSeeds.map((s, i) => spRun(true, true, s));
const spMean = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;
const spShare = (a) => 100 * spMean(a, 'contested') / spMean(a, 'picks');
const paired = (a, b) => {
  const d = a.map((r, i) => r.blue - b[i].blue);
  const m = d.reduce((x, y) => x + y, 0) / d.length;
  return { m, se: Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1) / d.length) };
};
const spGain = paired(spOn, spOff);
const spMirrorMargin = (() => {
  const d = spBoth.map((r, i) => r.margin - spOff[i].margin);
  const m = d.reduce((x, y) => x + y, 0) / d.length;
  return { m, se: Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1) / d.length) };
})();
const spCtx = makeContext({ profiles: SAMPLES, geo: layout(), side: 'blue', scenario: defaultScenario() });
spCtx.efficiency = 1.3925; // the same mean of the two fits, and the price below sits on the plateau: every
// credit from 0.05 s to 0.38 s buys exactly one extra CORAL (+2 plan-value points) at this efficiency, 0 buys
// none, and it takes 0.50 s to buy two.
const spPlan = { placeOrder: ['L4', 'L3', 'L2', 'L1'], climbWindowSec: 6, algaeSlots: null, bands: null };
const spVal = (spread, startAt) => planValue(estimateAlliance(spCtx, { ...spPlan, spread }, { startAt }));
const spPre = spVal(true, TIME.autoSec) - spVal(false, TIME.autoSec);
const spLate = spVal(true, 120) - spVal(false, 120);
const spUntouched = spSeeds.filter((s, i) => playMatch({
  seed: s, blueKind: 'greedy', redKind: 'greedy', blueProfiles: SAMPLES, redProfiles: SAMPLES,
  bluePolicyOpts: { climbWindowSec: 6 }, redPolicyOpts: { climbWindowSec: 6 },
}).final.blue.total !== spOff[i].blue).length;
if (!(spPre > 0)) fail(`the model does not prefer the spread: ${spPre.toFixed(1)} plan-value points from the whistle`);
else if (!(spLate < spPre)) fail(`the spread is priced as a bonus, not as seconds off a cycle: ${spPre.toFixed(1)} points with the whole MATCH to go and ${spLate.toFixed(1)} with 30 s left`);
else if (Math.abs(spPre - spGain.m) > 2.5) fail(`the price is the wrong size: the model pays ${spPre.toFixed(1)} points, the engine gains ${spGain.m.toFixed(1)} ± ${spGain.se.toFixed(1)} one-sided over ${spSeeds.length} paired held-out seeds`);
else if (spPre > spGain.m + 2 * spGain.se) fail(`the model out-prices its own measurement: ${spPre.toFixed(1)} points against an engine read that tops out at ${(spGain.m + 2 * spGain.se).toFixed(1)}`);
else if (!(spShare(spOff) > 20)) fail(`the corner is not really a queue: ${spShare(spOff).toFixed(1)}% of ${spMean(spOff, 'picks').toFixed(1)} CORAL picks a MATCH start with a teammate on the same corner, and the per-cycle credit the model gives the spread is priced on them`);
else if (!(spShare(spOn) < spShare(spOff))) fail(`pricing the crowd does not thin the crowd: ${spShare(spOn).toFixed(1)}% of picks still begin contested against ${spShare(spOff).toFixed(1)}% unpriced — the bid moves points but not machines`);
else if (Math.abs(spMirrorMargin.m) > 2 * spMirrorMargin.se) fail(`in a mirror the spread is not a wash: both fleets spreading moves the margin by ${spMirrorMargin.m.toFixed(1)} ± ${spMirrorMargin.se.toFixed(1)}`);
else if (spUntouched > 0) fail(`the 0 penalty is not an off value: ${spUntouched} of ${spSeeds.length} MATCHes differ from the same bid with no station penalty asked for at all`);
else pass(`station spread priced: the model pays ${spPre.toFixed(1)} points from the whistle and ${spLate.toFixed(1)} with 30 s left against an engine read of ${spGain.m.toFixed(1)} ± ${spGain.se.toFixed(1)} own points (${spMirrorMargin.m.toFixed(1)} ± ${spMirrorMargin.se.toFixed(1)} margin when both fleets do it), its counter books ${spShare(spOff).toFixed(1)}% of ${spMean(spOff, 'picks').toFixed(1)} CORAL picks a MATCH as starting with a teammate on the corner and pricing the crowd takes that to ${spShare(spOn).toFixed(1)}%, and the 0-penalty bid reproduces the shipped MATCH point for point`);

// 28. TIME SENSE and CLAIMING. Three budget rules the baseline leaves off and the planner runs, each with the
// measurement that justifies it on the same paired seeds: a cycle may only be started if the clock covers it
// (`cycleCutoffSec`, 4 s of slack over a straight-line estimate), a ROBOT in the endgame spends what it carries
// before it hangs rather than dropping it on the carpet (`spendBeforeClimb`), and a loose piece a teammate is
// already bound for costs 1.82 s of drive off the bid (`pieceSpread`). The two failure modes the first two
// exist for are read off the frames here, per ALLIANCE: CORAL still in a hopper at the whistle, and CORAL lost
// to a climb; the third is read as seconds a MATCH in which two allies on a TAKE aim within 24 in of each
// other. Eight ways this could be hollow: the flags might not bind at all (dead code); they might bind but only
// move the machine around; the gain might be one base's artefact; the cutoff might be a ban that strands
// machines standing still; the claim might be priced but not obeyed; the claim might pay only on the seeds its
// value was chosen on; the mirror might not be a wash; or the off values might not be off, which would silently
// re-base every number this page publishes. The time-sense arms read on 12 paired seeds of each of the two
// bases the rest of this file uses; the claim, whose 1.82 came off those same bases, is checked on the held-out
// pair guard 27 reads.
const tsSeeds = [];
for (const b of [9000, 21000]) for (let i = 0; i < 12; i++) tsSeeds.push(b + i * 977);
const tsRun = (kind, opts, s) => {
  const m = playMatch({
    blueKind: kind, redKind: kind, seed: s, record: true,
    bluePolicyOpts: opts, redPolicyOpts: opts, blueProfiles: SAMPLES, redProfiles: SAMPLES,
  });
  let drop = 0;
  const prev = new Map();
  for (const f of m.frames) {
    for (const r of f.robots) {
      const p = prev.get(`${r.side}${r.slot}`);
      if (p && p.coral > 0 && r.coral === 0 && (r.climb || p.busy === 'climb' || p.intent === 'climb')) drop += 1;
      prev.set(`${r.side}${r.slot}`, r);
    }
  }
  const held = m.frames[m.frames.length - 1].robots.filter((r) => r.coral > 0).length;
  // The mechanism read for the claim rule: seconds a MATCH in which two allies on a TAKE are aimed within
  // 24 in of each other, i.e. are driving at one piece.
  const taking = ['fetch-coral', 'strip-algae'];
  let overlap = 0;
  for (let j = 1; j < m.frames.length; j += 1) {
    const dt = m.frames[j].t - m.frames[j - 1].t;
    for (const side of ['blue', 'red']) {
      const rs = m.frames[j].robots.filter((r) => r.side === side && r.target && taking.includes(r.busy));
      outer: for (let a = 0; a < rs.length; a += 1) {
        for (let b = a + 1; b < rs.length; b += 1) {
          if (Math.hypot(rs[a].target[0] - rs[b].target[0], rs[a].target[1] - rs[b].target[1]) < 24) { overlap += dt; continue outer; }
        }
      }
    }
  }
  // `held` and `drop` are per ALLIANCE (both are in every count above); `overlap` is a whole-MATCH read, the
  // same one the sweep that chose the pin prints.
  return { combined: m.final.blue.total + m.final.red.total, held: held / 2, drop: drop / 2, overlap };
};
const tsMean = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;
const tsPaired = (a, b) => {
  const d = a.map((r, i) => r.combined - b[i].combined);
  const m = d.reduce((x, y) => x + y, 0) / d.length;
  return { m, se: Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1) / d.length) };
};
const OFF = { cycleCutoffSec: 0, spendBeforeClimb: false, pieceSpread: 0 };
// The claim rule is checked on the two bases nothing in this file chose it on (51000 / 62000, the held-out
// seeds guard 27 reads), because its pin came off the 9000 / 21000 sweep.
const tsHoldSeeds = [];
for (const b of [51000, 62000]) for (let i = 0; i < 12; i++) tsHoldSeeds.push(b + i * 977);
const tsBaseOff = tsSeeds.map((s) => tsRun('greedy', {}, s));
const tsBaseFlag = tsSeeds.map((s) => tsRun('greedy', OFF, s));
const tsBaseSpend = tsSeeds.map((s) => tsRun('greedy', { spendBeforeClimb: true }, s));
const tsPinOff = tsSeeds.map((s) => tsRun('ai', OFF, s));
const tsPinOn = tsSeeds.map((s) => tsRun('ai', {}, s));
const tsCutoff8 = tsSeeds.map((s) => tsRun('ai', { cycleCutoffSec: 8 }, s));
const tsClaimOn = tsHoldSeeds.map((s) => tsRun('ai', {}, s));
const tsClaimOff = tsHoldSeeds.map((s) => tsRun('ai', { pieceSpread: 0 }, s));
const tsSpendGain = tsPaired(tsBaseSpend, tsBaseOff);
const tsPinGain = tsPaired(tsPinOn, tsPinOff);
const tsWide = tsPaired(tsCutoff8, tsPinOn);
const tsClaimGain = tsPaired(tsClaimOn, tsClaimOff);
const tsSame = tsSeeds.filter((s, i) => tsBaseFlag[i].combined !== tsBaseOff[i].combined).length;
if (tsSame > 0) fail(`the off values are not off: ${tsSame} of ${tsSeeds.length} MATCHes differ between the shipped defaults and an explicit cycleCutoffSec 0 / spendBeforeClimb false / pieceSpread 0`);
else if (Math.abs(tsSpendGain.m) < 0.2 && Math.abs(tsMean(tsBaseSpend, 'drop') - tsMean(tsBaseOff, 'drop')) < 0.2) fail(`spendBeforeClimb does not bind: the greedy fleet still loses ${tsMean(tsBaseSpend, 'drop').toFixed(2)} CORAL to a climb against ${tsMean(tsBaseOff, 'drop').toFixed(2)} unspend`);
else if (!(tsSpendGain.m > 1.5)) fail(`the load is free to drop: spending before climbing is worth ${tsSpendGain.m.toFixed(1)} ± ${tsSpendGain.se.toFixed(1)} combined points a MATCH on ${tsSeeds.length} paired seeds, and the climb costs ${tsMean(tsBaseOff, 'drop').toFixed(2)} CORAL an ALLIANCE`);
else if (tsMean(tsBaseSpend, 'drop') > tsMean(tsBaseOff, 'drop') / 2) fail(`spendBeforeClimb keeps its score by something other than its mechanism: climb-dropped CORAL ${tsMean(tsBaseOff, 'drop').toFixed(2)} → ${tsMean(tsBaseSpend, 'drop').toFixed(2)} an ALLIANCE`);
else if (!(tsPinGain.m > 1)) fail(`the planner's time-sense pin is not paying: ${tsPinGain.m.toFixed(1)} ± ${tsPinGain.se.toFixed(1)} combined points a MATCH against the same planner with both rules disabled`);
else if (!(tsMean(tsPinOn, 'held') < tsMean(tsPinOff, 'held'))) fail(`the cutoff does not cut cycles: the pinned planner still ends TELEOP holding ${tsMean(tsPinOn, 'held').toFixed(2)} CORAL an ALLIANCE against ${tsMean(tsPinOff, 'held').toFixed(2)} ungated`);
else if (!(tsWide.m < tsPinGain.m)) fail(`the budget is not a trade-off, it is a ban: an 8 s cutoff reads ${tsWide.m.toFixed(1)} ± ${tsWide.se.toFixed(1)} against the shipped 4 s at ${tsPinGain.m.toFixed(1)} ± ${tsPinGain.se.toFixed(1)}, so no machine is ever stranded by it`);
else if (!(tsClaimGain.m > 1)) fail(`the claim rule does not pay on seeds it was not chosen on: ${tsClaimGain.m.toFixed(1)} ± ${tsClaimGain.se.toFixed(1)} combined points a MATCH over ${tsHoldSeeds.length} paired held-out seeds`);
else if (!(tsMean(tsClaimOn, 'overlap') < tsMean(tsClaimOff, 'overlap') / 2)) fail(`the claim is priced but not obeyed: two allies still drive at one piece for ${tsMean(tsClaimOn, 'overlap').toFixed(1)} s a MATCH against ${tsMean(tsClaimOff, 'overlap').toFixed(1)} s unpriced`);
else pass(`time sense and claiming priced: spending the hopper before hanging turns ${tsMean(tsBaseOff, 'drop').toFixed(2)} climb-dropped CORAL an ALLIANCE into ${tsMean(tsBaseSpend, 'drop').toFixed(2)} and is worth ${tsSpendGain.m.toFixed(1)} ± ${tsSpendGain.se.toFixed(1)} combined points a MATCH for a baseline fleet; the planner's 4 s cycle cutoff takes what it still holds at the whistle from ${tsMean(tsPinOff, 'held').toFixed(2)} to ${tsMean(tsPinOn, 'held').toFixed(2)} for ${tsPinGain.m.toFixed(1)} ± ${tsPinGain.se.toFixed(1)}, and gating harder pays for itself twice over and loses it — an 8 s cutoff holds ${tsMean(tsCutoff8, 'held').toFixed(2)} and drops ${tsMean(tsCutoff8, 'drop').toFixed(2)} an ALLIANCE for ${tsWide.m.toFixed(1)} ± ${tsWide.se.toFixed(1)}; on ${tsHoldSeeds.length} held-out paired seeds the piece claim is worth ${tsClaimGain.m.toFixed(1)} ± ${tsClaimGain.se.toFixed(1)} and takes two-allies-on-one-piece from ${tsMean(tsClaimOff, 'overlap').toFixed(1)} s a MATCH to ${tsMean(tsClaimOn, 'overlap').toFixed(1)}, and all three flags' off values reproduce the shipped MATCH point for point`);

console.log(bad === 0 ? '\nAll invariants hold.' : `\n${bad} failure(s).`);
process.exit(bad === 0 ? 0 : 1);
