// The REEFSCAPE planner (Stage 2).
//
// What this is NOT: a search over when to press. The tick engine's actions are already greedy about the next
// piece, and `npm run headroom` measured that cycle RATE is not where the points are — the REEF's 60 slots and
// the 9 ALGAE are never all reached, so no allocation can spend more than the fleet already does. What the
// study found is one lever worth points (when the fleet commits to the CAGES: +13.0±0.9 and +14.3±1.1 for a
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
// validated: 8/8 of the engine-separable plan pairs ordered correctly on each of two seed bases, with the
// commit window right in sign and within 3 points of size (the model +10.0/+8.0 against the engine's
// +13.0 ± 0.9/+8.0 ± 0.4 at a 9000 base), and the duty arms ordered the way the engine orders them (guard 26).

import { greedyPolicy } from './policy.js';
import { LEVELS } from './engine.js';
import { makeContext, estimateAlliance, planCandidates, coralCycleSec, planValue, SPREAD_PENALTY } from './fastsim.js';
import { TIME } from './rules.js';
import { ALGAE_PER_ALLIANCE } from './model.js';

// `npm run headroom` measured L3 before L4 and L4 before L3 as the two best fixed level orders when this was
// written, everything below them by 4-37 points, and the order is pinned rather than searched so the planner
// never flips machines that are already en route to a branch. It has been re-argued three times since, and the
// third is this round's: L3-first against L4-first now reads +0.5 ± 4.3 and -0.9 ± 2.6, and the planner against
// itself on the same two bases reads +2.1 ± 1.8 and +2.0 ± 2.0 — every one of those four sits inside its own bar,
// which is what an unmeasurable axis looks like. Flipping MEASURED_ORDER re-baselines every fingerprint in
// scripts/invariants.mjs for a reading that is not a finding, so the pin stays.
const MEASURED_ORDER = ['L3', 'L4', 'L2', 'L1'];

// The commit times the planner may choose, in seconds of MATCH left. 4 s is included because the model has to
// be able to say "commit now"; the measured climb takes 4.81 s (mean, max 5.80) once the window opens.
const WINDOWS = [4, 6, 8, 10, 12, 16, 20, 26];

// The same scalar `npm run fastsim` fits offline (1.613 on both seed bases since #123 moved the MARKs), used as the
// starting point and then re-measured from the fleet's own placements.
const SEED_EFFICIENCY = 1.32;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

// The planner's time sense, its two teamwork rules, its one defensive rule and its one AUTO rule, pinned the
// same way the level order is. Every one is a rule in `policy.js` that the baseline leaves off, and every one was
// measured on the mirror's COMBINED alliance score, arm against control on the same seeds. `npm run verify`'s
// time-sense guard re-reads them on held-out seeds every build, and the four TELEOP off values reproduce the
// shipped MATCH point for point:
//
//   cutoff 4 s  what the fleet still holds at the whistle goes from 0.83 to 0.10 CORAL an ALLIANCE, for
//               12.7 ± 3.9 combined points a MATCH. The gate is a maximum, not a guess: an 8 s cutoff holds
//               0.04 and drops 0.02 and costs -5.3 ± 1.4, because past the peak the machines are standing still
//               rather than saving a trip.
//   spend       the engine drops what a ROBOT carries when it hangs; for a baseline fleet the rule turns 1.69
//               climb-dropped CORAL an ALLIANCE into 0.00 and is worth 8.3 ± 1.3 combined points a MATCH. It
//               cannot buy 4 points of CORAL with 6-12 of BARGE.
//   piece 1.82  11.5 ± 5.3 on 24 held-out paired seeds, and the two-allies-on-one-piece overlap goes from 1.9 s
//               a MATCH to 0.5. A loose piece a teammate is already bound for costs this machine 1.82 s of drive
//               off the bid — 291 in at this field's cruise speed: enough to walk to the other source when there
//               is one, not enough to abandon the REEF when there is not. Past about 2 s the penalty is a skip
//               rather than a price; the graded value is kept because a rule that can still take the piece when
//               nothing else is left is the one that does not strand a machine beside an empty REEF.
//   press 0.08  A PRESS IS BOUGHT WITH FOULS, NOT WITH SECONDS. `npm run measure`'s paired arms separate the two
//               halves: one machine told to shadow the nearest opponent costs its own alliance -5.9 ± 1.7 of
//               total and takes -2.8 ± 1.5 off the opponent's (48 paired seeds), which over the
//               20.7 s a MATCH it spends in the ring is a take of about 0.29 a press-second. The same arm read on
//               the MARGIN is -33.63 ± 3.12, or -1.626 a press-second, and the difference is the foul points
//               a defender hands the other alliance (`npm run contact`: 7.7 and 6.1 fouls a MATCH for 45.8 and
//               36.6 points, of which 244 over the 48 MATCHes are G427 for being inside a protected zone). 0.08 now sits below both
//               readings rather than between them: it was written to keep the planner out of the press, and the
//               arms only moved that way once the corrected REEF changed where the machines meet.
//               `npm run verify`'s press guard reads what the price does buy — 0.0 s a MATCH with the rule off,
//               1.2 s at the shipped price, 51.0 s once the price is
//               raised to 3, where it costs itself 17.4 press fouls against the shipped 1.1. Two defenders are
//               worse than one on both halves
//               (-9.9 ± 2.5 own for -2.0 ± 1.4 off the opponent, against one machine's -5.9 ± 1.7 and -2.8 ± 1.5).
//               This round replaced the page's six DEFEND
//               checkboxes with this rule, because a duty the field prices at nothing was not a decision anyone
//               should have to make by hand.
//   AUTO crowd 0  THE AUTO routine is a SCRIPT (§6.4 — no driver input), and a three-machine script should not
//               send all three at the same CORAL MARK. The lever prices an ally already aimed at the same point
//               at seconds of this machine's drive, and for two rounds it was pinned at 1.5 s on +0.28 ± 0.05
//               AUTO CORAL, +0.92 ± 0.23 STATION picks a MATCH and LEAVE +0.25 ± 0.12 over 144 paired
//               alliance-sides. That read belonged to a field this build no longer has: #122 turned the REEF so a
//               FLAT faces the ALLIANCE WALL (Figure 5-4) and put the six ALGAE on all six faces, and #123 moved
//               the six CORAL MARKs to the wall side of the REEF and the fleet onto its own ROBOT STARTING LINE,
//               where G303-D puts it.
//               The lever still reaches a MATCH — 94 of the 144
//               alliance-sides change their AUTO paths when it is paid — but re-read on this geometry
//               the same arms give 0.06 ± 0.08 AUTO CORAL,
//               0.08 ± 0.15 STATION picks and LEAVE 0.00 ± 0.00 — it buys no pieces worth the trip, and LEAVE has
//               no part in it any more because the fleet starts on the line. `npm run verify`'s guard 30 re-reads
//               it every round and
//               fails if it ever buys more than 0.25 AUTO CORAL an ALLIANCE, which is what revives the pin.
//
// Off stays in `policy.js` because the baseline is the yardstick the planner is scored against, and a yardstick
// that improves underneath it re-baselines every fingerprint in `scripts/invariants.mjs`.
const PINS = { cycleCutoffSec: 4, spendBeforeClimb: true, pieceSpread: 1.82, autoDefend: true, pressTakePerSec: 0.08, autoCrowdSec: 0 };

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
      // The pinned rules are read out of the policy that is actually running rather than repeated from
      // `PINS`, so a caller that overrides one through `opts` cannot be shown the pinned value instead.
      return {
        ...plan,
        efficiency: +eff.toFixed(2),
        pins: { cutoff: inner.config.cycleCutoffSec, spend: inner.config.spendBeforeClimb, claim: inner.config.pieceSpread, press: inner.config.autoDefend ? inner.config.pressTakePerSec : 0, auto: inner.config.autoCrowdSec },
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
