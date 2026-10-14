// The REEFSCAPE planner (Stage 2).
//
// What this is NOT: a search over when to press. The tick engine's actions are already greedy about the next
// piece, and `npm run headroom` measured that cycle RATE is not where the points are — the REEF's 60 slots and
// the 9 ALGAE are never all reached, so no allocation can spend more than the fleet already does. What the
// study found is one lever worth points (when the fleet commits to the CAGES: +11.3±1.1 and +11.9±0.7 for a
// 6 s window over the shipped 20 s, on two seed bases).
//
// So the planner does two things. It re-solves the commit window and the ALGAE duty through TELEOP against what
// the MATCH actually looks like: the branch stock left, the ALGAE left on both REEFs, which CAGES its allies
// have already claimed, and the fleet's own measured pace. That is the part a fixed rule cannot do — a MATCH
// where the REEF empties at 110 s should commit at 110 s, and one where the machines are stuck in the station
// corner should not. And it ranks candidates on a MARGIN (`planValue`), not on its own score, because the two
// costs this fleet can impose on itself — the ALGAE it processes into the opponent's NET and the fouls a
// crossing donates — land on the other ALLIANCE's sheet.
//
// The level order is the one axis the search is not offered: pinned to the measured top of the list, because
// flipping it mid-MATCH costs the machines already en route to a branch. The pin is now mildly wrong-signed —
// see MEASURED_ORDER for the two readings.
//
// The window and the duty come from `fastsim.js`, the analytic model, and only on the axes `npm run fastsim`
// validated: 7/7 of the engine-separable plan pairs ordered correctly on each of two seed bases, with the
// commit window right in sign and within 2 points of size (the model +10.0/+12.0 against the engine's
// +7.6 ± 0.3/+10.8 ± 0.9 at a 9000 base), and the duty arms ordered the way the engine orders them (guard 26).

import { greedyPolicy } from './policy.js';
import { LEVELS } from './engine.js';
import { makeContext, estimateAlliance, planCandidates, coralCycleSec, planValue, SPREAD_PENALTY } from './fastsim.js';
import { TIME } from './rules.js';
import { ALGAE_PER_ALLIANCE } from './model.js';

// `npm run headroom` measured L3 before L4 and L4 before L3 as the two best fixed level orders when this was
// written, everything below them by 6-31 points, and the order is pinned rather than searched so the planner
// never flips machines that are already en route to a branch. It has been re-argued twice since: the NET reach
// left the greedy fleets reading L3-first against L4-first at -3.9 ± 3.3 and -5.6 ± 3.6, and the clock rules
// leave the planner against itself on 24 paired seeds per base at +2.6 ± 2.8 and -4.4 ± 2.0 — the two bases
// disagree in sign and the pair averages to nothing. Flipping MEASURED_ORDER re-baselines every fingerprint in
// scripts/invariants.mjs for a reading that is not a finding, so the pin stays.
const MEASURED_ORDER = ['L3', 'L4', 'L2', 'L1'];

// The commit times the planner may choose, in seconds of MATCH left. 4 s is included because the model has to
// be able to say "commit now"; the measured climb takes 4.46 s (mean, max 5.80) once the window opens.
const WINDOWS = [4, 6, 8, 10, 12, 16, 20, 26];

// The same scalar `npm run fastsim` fits offline (1.324 against this field's station queue), used as the
// starting point and then re-measured from the fleet's own placements.
const SEED_EFFICIENCY = 1.32;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

// The planner's time sense and its one teamwork rule, pinned the same way the level order is. All three are
// budget rules in `policy.js` that the baseline leaves off, and all three were measured on the mirror's
// COMBINED alliance score, arm against control on the same seeds:
//
//   cutoff 4 s  +3.00 ± 1.43 and +2.92 ± 0.88 — the fleet stops starting a cycle it cannot finish. It ended
//               TELEOP holding 0.73/0.69 CORAL an ALLIANCE before the gate and 0.69 of those 0.69 were pieces
//               picked up inside the last 20 s; the gate took the hold to 0.13/0.15. Re-run against the build
//               that carries all three pins, the gate is a maximum: 6 s costs -1.50/-1.33 and 8 s costs
//               -5.75 ± 0.68 / -3.08 ± 1.14, because past the peak the machines are not saving a wasted trip,
//               they are standing still.
//   spend       +3.33 ± 1.57 and +3.50 ± 0.96 with the cutoff — spend the hopper, then hang. The engine drops
//               what a ROBOT carries when it climbs, which costs the baseline 1.69/1.58 CORAL an ALLIANCE a
//               MATCH (+6.21 ± 0.67 and +6.04 ± 0.47 for the greedy fleet, whose climb-drops go to 0.00). The
//               planner commits late enough that it only loses 0.75/0.90 that way, so on its own the rule is
//               inside the bar (-0.25 ± 0.54, +0.58 ± 0.33); with the cutoff it removes most of what is left
//               (0.21/0.48 -> 0.13/0.27).
//   piece 1.82  +5.82 ± 2.03 pooled over 96 paired seeds, positive on both bases (+7.48 ± 2.88 at n=48 on the
//               9000 base, +4.17 ± 2.63 on the 21000 one), and +6.93 ± 2.36 for the baseline fleet. A loose
//               CORAL or ring a teammate is already bound for costs this machine 1.82 s of drive off the bid,
//               which is 291 in at this field's cruise speed: enough to walk to the other source when there is
//               one, not enough to abandon the REEF when there is not. It takes the two-allies-on-one-piece
//               overlap from 8.7 s a MATCH to 1.7. 3.65 s and 7.30 s read IDENTICALLY (+5.94 ± 2.33 for both,
//               because 3.65 s of drive is 584 in, longer than the FIELD is wide, so past about 2 s the penalty
//               is a skip rather than a price); the graded value is kept because a rule that can still take the
//               piece when nothing else is left is the one that does not strand a machine beside an empty REEF.
//
// Off stays in `policy.js` because the baseline is the yardstick the planner is scored against, and a yardstick
// that improves underneath it re-baselines every fingerprint in `scripts/invariants.mjs`.
const PINS = { cycleCutoffSec: 4, spendBeforeClimb: true, pieceSpread: 1.82 };

export function aiPolicy(side, opts = {}) {
  const order = opts.placeOrder ?? MEASURED_ORDER;
  // The measured level order goes in at construction, not at the first re-plan: a fleet that works L4 first
  // until the model becomes confident and then flips is paying for the model's cold start out of the same
  // +3-5 points the order is worth. The time-sense and claiming pins go in the same way, and a caller can still
  // override any of them through `opts` — which is how the control arm of each reading above is run.
  const inner = greedyPolicy(side, { ...PINS, ...opts, placeOrder: order });
  const windows = opts.windows ?? WINDOWS;
  const replanSec = opts.replanSec ?? 10;
  // How soon after one of those events the fleet is allowed to think again. A re-solve is not free: the plan
  // it produces changes what three machines drive to, and a press that lands two hits a second would have the
  // fleet changing its mind twice a second. `[estimate]` 5 s — one ALGAE cycle, so a re-plan can still land
  // before the next pick is committed.
  const eventCooldown = opts.eventCooldown ?? 5;
  // A plan is only replaced if the new one is worth more than this many modelled points. Without it the
  // window walks one step at a time every time the estimate moves by a fraction, and the fleet spends TELEOP
  // changing its mind.
  const switchPts = opts.switchPts ?? 2;
  // The ALGAE duty is a candidate unless the caller pinned one, because the duty axis is now something the
  // model can price: it drains this ALLIANCE's nine rings, then charges every machine it put on ALGAE for the
  // leakage past the opponent's gate (the crossing's seconds and its fouls). With a duty handed in by the page
  // the search keeps its hands off it.
  const duties = opts.algaeSlots ? [opts.algaeSlots] : undefined;
  const log = [];
  const profiles = new Map(); // slot -> profile, collected from the ROBOTs as they come to decision
  const pace = new Map(); // slot -> { placed, strips, t, ivs } — intervals between CORAL placements
  let plan = { placeOrder: order, climbWindowSec: opts.climbWindowSec ?? 20, algaeSlots: opts.algaeSlots ?? null, bands: null, spread: opts.spread ?? false };
  // The plan is what the tick policy runs, so every field has to be handed down in the units the policy uses:
  // `spread` is a decision here and a willingness to pay (in seconds of drive) there.
  const applyPlan = () => inner.configure({ ...plan, stationSpread: plan.spread ? SPREAD_PENALTY : 0 });
  applyPlan();
  let eff = opts.efficiency ?? SEED_EFFICIENCY;
  let nextReplanAt = TIME.autoSec;
  let lastReplanAt = -Infinity;
  // The fleet's own capacity, as a string: which machines are out and which are limping. A press takes a
  // machine's tempo away for seconds and its motor for the MATCH, and a plan sized for three machines is the
  // wrong plan for two-and-a-half — which is the whole reason this is watched rather than merely re-solved on
  // the 10 s timer.
  const capacity = (obs) => obs.allies.map((a) => (a.disabled ? 'x' : a.impair ? 'i' : '-')).join('');
  let lastCapacity = '';

  // The engine's per-robot counters are the only honest tempo measurement available mid-MATCH: an interval
  // between two CORAL placements with no ALGAE strip inside it is one CORAL cycle, queueing and all.
  function observePace(rb, obs) {
    const placed = LEVELS.reduce((a, lv) => a + rb.stats.placed[lv], 0);
    const strips = rb.stats.strips ?? 0;
    const s = pace.get(rb.slot);
    if (!s) {
      pace.set(rb.slot, { placed, strips, t: obs.t, ivs: [] });
      return;
    }
    if (placed !== s.placed) {
      const dt = obs.t - s.t;
      if (strips === s.strips && dt > 1.5 && dt < 30) s.ivs.push(dt);
      s.placed = placed;
      s.strips = strips;
      s.t = obs.t;
    }
  }

  // observed cycle / cycle the straight-line model would price at eff=1. The denominator is the same
  // `coralCycleSec` the model itself uses, so the ratio is a scale on the model rather than a second opinion.
  function measureEfficiency(ctx, aimLevel, fromMarks) {
    const ratios = [];
    ctx.profiles.forEach((p, i) => {
      const s = pace.get(i);
      if (!s || s.ivs.length < 2) return;
      const mean = s.ivs.reduce((a, b) => a + b, 0) / s.ivs.length;
      const modelled = coralCycleSec(ctx, p, aimLevel, fromMarks, 1);
      if (modelled > 0.5) ratios.push(mean / modelled);
    });
    const m = median(ratios);
    if (m === null) return eff;
    return clamp(0.5 * eff + 0.5 * m, 0.9, 3);
  }

  function valueOf(est) {
    // One definition, shared with `npm run fastsim`, so the ranking the model is validated on is the ranking
    // the planner uses. It is a MARGIN and not a score: the ALGAE processed here is thrown into their NET by
    // their HUMAN PLAYER, and the fouls a duty machine donates land on the other ALLIANCE's sheet, where an
    // estimate of one alliance would otherwise never look.
    return planValue(est);
  }

  function replan(obs, why) {
    if (profiles.size < 3) return;
    const roster = [0, 1, 2].map((i) => profiles.get(i));
    const opp = side === 'blue' ? 'red' : 'blue';
    const scenario = {
      cageDepth: { [side]: obs.cages.map((c) => c.deep) },
      humanPlayer: { [opp]: { accuracy: obs.hpAccuracy } },
    };
    const build = () => makeContext({ profiles: roster, geo: obs.geo, side, scenario: { ...scenario, fastsimEfficiency: eff } });
    const aimLevel = order.find((lv) => obs.free[lv] > 0) || order[0];
    const fromMarks = obs.coralOnFloor.length > 0;
    let ctx = build();
    eff = measureEfficiency(ctx, aimLevel, fromMarks);
    ctx = build();
    const state = {
      startAt: obs.t,
      stock: { L1: obs.free.L1, L2: obs.free.L2, L3: obs.free.L3, L4: obs.free.L4 },
      algae: ALGAE_PER_ALLIANCE - obs.algaeLeft,
      algaeNet: obs.netByRobot, // of those, what the machines lifted into their own NET (§6.1)
      enemyAlgaeLeft: obs.enemyAlgaeLeft, // what is still growing on their REEF, for the duty candidates
      marks: obs.coralOnFloor.length,
      cageUsed: obs.cages.map((c) => c.used),
    };
    // The duty axis IS searched now, because the model can price it: nine rings at the own REEF, then the
    // leakage past the opponent's gate, billed in seconds (`crossingSec`, the drive out past their CAGEs and
    // home to this PROCESSOR) and in the fouls that trip brings them. `npm run aicap` measured the arms this
    // covers — one machine on ALGAE donates 1.75 points a MATCH, three donate 3.67, and a fleet told never to
    // cross donates none and wins the margin by 2.4 to 5.9 — and the engine's ranking of those arms is the
    // thing guard 26 checks the model reproduces. A duty the caller pinned (`opts.algaeSlots`) is not a
    // candidate: the page's duty control is a decision, not an option the planner may talk out of.
    const candidates = planCandidates({ orders: [order], windows, duties });
    const sameDuty = (cand) => JSON.stringify(cand.algaeSlots ?? null) === JSON.stringify(plan.algaeSlots ?? null);
    const samePlan = (cand) => cand.climbWindowSec === plan.climbWindowSec && sameDuty(cand) && !!cand.spread === !!plan.spread;
    let best = null;
    let current = null;
    for (const cand of candidates) {
      const v = valueOf(estimateAlliance(ctx, cand, state));
      if (samePlan(cand)) current = v;
      if (!best || v > best.v) best = { cand, v };
    }
    nextReplanAt = obs.t + replanSec;
    lastReplanAt = obs.t;
    lastCapacity = capacity(obs);
    if (current === null) current = valueOf(estimateAlliance(ctx, plan, state));
    // The commit may be moved EARLIER but never later: once the window has passed the fleet is on its way to
    // the CAGES, and re-opening it would strand machines that already turned around.
    // The switch does not happen at the whistle, and that is the model being honest rather than slow: with the
    // REEF full the estimate says the ALLIANCE is stock-bound, every window places the same CORAL, and no
    // commit is worth moving. It takes ~30 s of measured pace before the estimate believes the MATCH is
    // time-bound. Observed over 24 MATCHes per seed base: the first switch lands at t=44 s, which still leaves
    // the whole 6 s commit intact, and the resulting score is indistinguishable from committing at t=15 s.
    const chosen = best.cand.climbWindowSec > plan.climbWindowSec
      ? { ...best.cand, climbWindowSec: plan.climbWindowSec }
      : best.cand;
    // Clamping the window changes what the candidate is worth, so the value is taken off the plan the fleet
    // would actually run rather than off the one the search liked before the clamp.
    const gain = (chosen === best.cand ? best.v : valueOf(estimateAlliance(ctx, chosen, state))) - current;
    if (samePlan(chosen) || gain <= switchPts) {
      log.push({ t: +obs.t.toFixed(1), why, keep: plan.climbWindowSec, want: chosen.climbWindowSec, gain: +gain.toFixed(1), eff: +eff.toFixed(2), free: obs.free.L1 + obs.free.L2 + obs.free.L3 + obs.free.L4 });
      return;
    }
    plan = { ...chosen, bands: null, placeOrder: order };
    applyPlan();
    log.push({ t: +obs.t.toFixed(1), why, switchTo: plan.climbWindowSec, duty: plan.algaeSlots, spread: plan.spread, gain: +gain.toFixed(1), eff: +eff.toFixed(2), free: state.stock.L1 + state.stock.L2 + state.stock.L3 + state.stock.L4, est: Math.round(current + gain) });
  }

  return {
    kind: 'ai',
    planLog: log,
    get plan() {
      // The three pinned rules are read out of the policy that is actually running rather than repeated from
      // `PINS`, so a caller that overrides one through `opts` cannot be shown the pinned value instead.
      return {
        ...plan,
        efficiency: +eff.toFixed(2),
        pins: { cutoff: inner.config.cycleCutoffSec, spend: inner.config.spendBeforeClimb, claim: inner.config.pieceSpread },
      };
    },
    configure(patch) {
      Object.assign(plan, patch);
      applyPlan();
    },
    onPeriodStart() {},
    reset() {
      inner.reset();
      pace.clear();
      log.length = 0;
      eff = opts.efficiency ?? SEED_EFFICIENCY;
      nextReplanAt = TIME.autoSec;
      lastReplanAt = -Infinity;
      lastCapacity = '';
      plan = { placeOrder: order, climbWindowSec: opts.climbWindowSec ?? 20, algaeSlots: opts.algaeSlots ?? null, bands: null, spread: opts.spread ?? false };
      applyPlan();
    },
    decide(rb, obs) {
      if (!profiles.has(rb.slot)) profiles.set(rb.slot, rb.profile);
      observePace(rb, obs);
      if (obs.period !== 'TELEOP') return inner.decide(rb, obs);
      const cap = capacity(obs);
      // Two ways to think again: the clock, and the fleet losing a machine to a hit. The event path is what
      // lets a 2 s plan change a 20 s plan, and it is the difference between a re-solve and a schedule.
      const broke = lastCapacity !== '' && cap !== lastCapacity;
      if (obs.t >= nextReplanAt) replan(obs, 'timer');
      else if (broke && obs.t - lastReplanAt >= eventCooldown) replan(obs, 'capacity');
      else lastCapacity = cap;
      return inner.decide(rb, obs);
    },
  };
}
