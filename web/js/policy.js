// Baseline policies for REEFSCAPE. A baseline is a plausible hand-written strategy, so beating it is
// the yardstick for anything the planner does later (Stage 2).

import { INTENT } from './engine.js';
import { LEVELS } from './engine.js';
import { POINTS, TIME } from './rules.js';

// Which level a ROBOT aims when it has a CORAL, best points first. The order is the shipped greedy
// behaviour; `greedyPolicy` takes it as an option so an allocation experiment can change it without
// changing this default, and the golden replay has to keep reproducing whatever is here.
const PLACE_ORDER = ['L4', 'L3', 'L2', 'L1'];

// `[estimate]` the endgame window. The comment on the CLIMB branch records why 20 s and not 30 s: the
// BARGE points are worth waiting for only if the CORAL that pays for them is already on the REEF.
const CLIMB_WINDOW_SEC = 20;

// `[estimate]` the error bar on the straight-line AUTO budget, in seconds. See greedyPolicy's AUTO branch.
// `[estimate]` the error bar on the straight-line AUTO budget, in seconds — the acceleration the cruise
// model does not price and the delay before the placement timer starts. Measured: 0 leaves 8.5 of the 9
// LEAVE points, 0.4 gives 8.8 for 1.4 points less AUTO CORAL, and past 0.8 the AUTO column only shrinks.
const AUTO_SLACK_SEC = 0.4;

// `[estimate]` how long a ROBOT may push at a branch before it aims one level lower. The highest free branch
// is not always the reachable one — it can be the one a TEAMMATE is standing in front of — and a driver that
// keeps pushing it does not score, it parks. Without this escape 4 of 96 MATCHes ended with an ALLIANCE
// holding CORAL while two L3 branches stayed empty and its 12 L2 branches and its whole TROUGH went unscored,
// which is a 200-point ALLIANCE no 2025 field ever produced.
const PLACE_PATIENCE_SEC = 4;

// The codes a press earns. Anything in this list that increases while a ROBOT is defending is the radio
// telling its drive team that the press is costing more than it is taking away, so the press pauses.
const DEFEND_FOUL_CODES = ['G421', 'G423', 'G424', 'G425', 'G427', 'G428'];

// `[estimate]` a straight drive as a scripted AUTO routine would budget it: the cheaper of the
// accelerate-then-brake triangle and the cruise-then-brake trapezoid. Exported because `fastsim.js`
// prices a whole MATCH with it — one travel model, not two that can drift apart.
export function travelSec(dist, p) {
  const d = Math.max(dist, 0);
  return Math.min(2 * Math.sqrt(d / p.accelIpsS), d / p.driveSpeedIps + p.driveSpeedIps / p.accelIpsS);
}

export function greedyPolicy(side, opts = {}) {
  // The knobs an allocation study needs, each defaulting to the behaviour the shipped replay runs:
  // `placeOrder` (which level is aimed first), `bands` (per-slot level restriction, so three machines can be
  // told to own three different levels instead of all climbing to the top), and `climbWindowSec` (when the
  // endgame starts). They are options rather than constants because a planner has to be scored against the
  // same rule set it extends, not against a version of greedy the planner cannot express.
  // They live in a mutable object, not in captured consts, because `configure()` lets the planner change the
  // plan mid-MATCH: a planner that had to build a fresh policy would lose the per-robot clocks in `held`, and
  // the measured advantage of re-planning would be the artefact of resetting that history rather than of the
  // new plan.
  const cfg = {
    placeOrder: opts.placeOrder ?? PLACE_ORDER,
    bands: opts.bands ?? null,
    climbWindowSec: opts.climbWindowSec ?? CLIMB_WINDOW_SEC,
    // How many CORAL one ROBOT may drop at a level before it stops aiming that level for the MATCH.
    // `[estimate]` 4: three misses in a row is what a driver calls a broken elevator, and the fourth is the
    // one they argue about on the radio. Infinity is the control arm — it never learns, and it is the arm
    // that made every REEF come back full whatever the miss rate.
    placeGiveUp: opts.placeGiveUp ?? 4,
    // Which slots are told to work the ALGAE instead of the CORAL. `null` is the shipped behaviour: every
    // machine strips when the REEF it is aimed at runs out, none strips while a branch is free.
    algaeSlots: opts.algaeSlots ?? null,
    // Which slots play defense instead of collecting. `null` is the shipped behaviour, and it is the control
    // the A/B reads: a defender takes a machine out of the fleet's cycle count, and what it gets back is the
    // opponent's tempo, which this engine can only charge for by driving into them.
    defendSlots: opts.defendSlots ?? null,
    // Whether a machine presses instead of taking the worst fetch on the menu. This is the 2026 build's
    // idle-press rung ported here and priced: there, a ROBOT that cannot shoot, sweep or pass shadows their
    // scorer rather than idling, and the target is chosen from an opponent-threat score instead of assigned
    // from the page. Here the press competes with the fetch on seconds-per-point (see `pressTakePerSec`), so
    // it can only win time the fleet was already spending badly — which is what makes it different from
    // `defendSlots`, a duty that gives up real cycles for a play effect that `npm run measure` reads as a wash
    // (−5.8 ± 1.4 of its own total against −1.0 ± 1.8 off the opponent's play, 48 paired seeds).
    // `false` is the shipped behaviour: the cheapest piece always wins.
    autoDefend: opts.autoDefend ?? false,
    // What one second of press is worth, in points off the opponent. The planner's pin (`ai.js`) is 0.08 and
    // this default is the higher end of what the duty arm leaves room for: `npm run measure`'s paired arms say a
    // pressed machine takes 1.0 points off the opponent's PLAY over the 25.0 s it spends in the ring, which is
    // about 0.04 a press-second before the fouls it donates, and the same arm's margin is −27.08 once those are
    // counted, because a defender hands over 31.7 and 27.2 foul points a MATCH. Nothing measured here supports a
    // price above a few tenths; the low value is what keeps the press in the idle tail the cutoff hands back.
    pressTakePerSec: opts.pressTakePerSec ?? 0.26,
    // `noAlgae` is not a strategy, it is the price of the ALGAE work measured against the CORAL it displaces:
    // a fleet that never strips tells you what the ALGAE column was worth in cycle time.
    noAlgae: opts.noAlgae ?? false,
    // §6.5.1 scores an ALGAE by the PROCESSOR and the NET, never by whose REEF it grew on, so the nine rings
    // on the opponent's REEF are worth the same as your own. Off is the ablation that pins the behaviour that
    // existed before the two REEFs were both visible to the bid.
    enemyAlgae: opts.enemyAlgae ?? true,
    // Whether a ring on their REEF is only worth reaching when nobody is home to be touched. The clause that
    // charges the trip is G418; the price is measured, not guessed — see `guarded` below. Off is the control arm.
    zoneRisk: opts.zoneRisk ?? true,
    // No clause reserves a CORAL STATION to its own ALLIANCE, so their queue is a source too — at the price
    // of the crossing and of being the one ROBOT G421 counts. Off pins the own-half-only baseline.
    coralTheft: opts.coralTheft ?? true,
    // How long a defender that has just been called stays away from the opponent. `[estimate]` 6 s: the
    // drive team that eats a MAJOR FOUL for touching somebody inside their zone pulls out rather than doing
    // it again next second, and 6 s is roughly one trip back to the CORAL and around. `0` is the control arm
    // and it is what made a held press cost 30 MAJOR FOULs a MATCH.
    defendResetSec: opts.defendResetSec ?? 6,
    // How many seconds of drive a machine will NOT pay to avoid a CORAL STATION pocket a teammate is already
    // bound for. The crowd is real and the engine's own counter books it: 27.5% of a fleet's 58.7 CORAL picks a
    // MATCH start with a teammate on the same corner, and pricing the crowd takes that to 15.1%. What the crowd
    // COSTS did not survive the NET lift — this constant used to ship on a pick-to-pick gap of 7.29 ± 0.21 s
    // contested against 6.27 ± 0.10 s alone, and on the shipped profiles that has inverted to 4.34 ± 0.18 s
    // against 6.83 ± 0.11 s (n=257 against 2,703), because a machine that rejoins the corner its fleet never
    // left has a short drive. So it is a confound, not a wait, and the value is set from the arm the planner
    // decides against instead: one side spreading, the other on the shipped bid, +3.3 ± 2.0 own points over 24
    // paired held-out seeds (guard 27). The bid converts the seconds through this machine's own
    // speed, which makes it a trade in time rather than in inches: a fast machine walks farther off the queue
    // than a slow one. 0.91 is the value the planner's arm measures at, and `npm run headroom` sweeps it rather
    // than defending it — 0.45/0.91/1.6 s read +2.6/+4.7/+5.7 and +2.8/−0.4/+1.1 on the two seed bases, and only
    // the 9000 base clears its bar. `0` is the shipped behaviour — nearest corner, whoever is
    // standing at it — and the planner turns this on where `fastsim.js` prices it.
    stationSpread: opts.stationSpread ?? 0,
    // Time sense. A cycle that cannot finish before the whistle is not a cycle — it is a CORAL left in the
    // hopper, worth the 3-5 points it would have scored. Measured on the shipped build over 48 MATCHes: the
    // planner ends TELEOP holding 0.69 CORAL an ALLIANCE and 0.69 of those 0.69 are pieces picked up inside
    // the last 20 s (a full REEF accounts for 0.00, and 12.1% of its fetches start with under 20 s left);
    // the greedy fleet holds none. `cycleCutoffSec` is the slack the straight-line budget has to leave over,
    // because that model does not see the turn — the AUTO branch uses the same construction with 0.4 s.
    // `0` is the shipped behaviour: start the cycle if a piece is there.
    cycleCutoffSec: opts.cycleCutoffSec ?? 0,
    // The engine drops whatever a ROBOT is carrying when it hangs (engine.js, the CLIMB completion), so a
    // machine that goes to a CAGE with a load trades 3-5 points of CORAL for nothing. Measured on the shipped
    // build: 1.69 and 1.58 CORAL an ALLIANCE a MATCH lost that way by the greedy fleets, 0.75 and 0.90 by the
    // planner (48 MATCHes, two bases). A drive team with the clock to spare scores the piece and then climbs,
    // so this spends first when the remaining seconds cover BOTH legs — and hands the machine to the CAGE the
    // moment they no longer do, which is why it cannot cost the BARGE column by design rather than by luck.
    // `false` is the shipped behaviour: the endgame branch outranks the placement branch.
    spendBeforeClimb: opts.spendBeforeClimb ?? false,
    // Teamwork has a price too: two machines driving for the SAME loose CORAL or the SAME ring is one cycle
    // wasted. `stationSpread` already does this for the STATION queues, and the pocket it moves them off is
    // where the overlap actually sits (38.9-42.2 s a MATCH of two allies aimed within 24 in of each other on a
    // TAKE intent for the planner, 10 s of it at a piece rather than at a queue). This is the same bid in
    // seconds off a cycle, applied to the two piece sources; `0` is the shipped behaviour and the arm the
    // measurement below decides against.
    pieceSpread: opts.pieceSpread ?? 0,
    // The AUTO routine is a SCRIPT (§6.4 — no driver input), and a scripted three-machine AUTO gives each
    // machine its own path; it does not send all three at the same CORAL MARK. The plain bid has them all take
    // `sources[0]`, the nearest, and the field only stages three MARKS an ALLIANCE can reach: `npm run measure`
    // reads that as 78% of a johnson ALLIANCE's AUTO picks off those three, 17% off its own CORAL STATION, 55.7
    // of the station's 57 CORAL still there at the whistle, and 40% of AUTO robot-seconds spent standing still.
    // This is the TELEOP crowd price applied to the AUTO source ranking, in seconds of drive per ally already
    // aimed at that point; the COST the budget tests stays on the true distance, so a machine that walks over
    // to the next MARK does not also convince itself it has more time. Off here, pinned at 1.5 in `ai.js`:
    // +0.28 ± 0.05 AUTO CORAL and about +2 AUTO points an ALLIANCE with LEAVE +0.25 ± 0.12 and 0.92 ± 0.23 extra
    // STATION picks a MATCH, on 144 paired alliance-sides across three seed bases — and the piece TOTAL does
    // not pay for it (-0.01 ± 0.34 on one stride, +1.07 ± 0.38 on the other). Past about 2 s the bid skips the
    // source instead of pricing the drive, which is why the pin is 1.5 rather than 3. Guard 30 holds the pin to
    // that reading: the price must still reach the AUTO branch, must still move picks to the STATION, must not
    // spend LEAVE or the TELEOP count, must still leave `0` equal to the shipped MATCH, and the planner must
    // still differ from the same planner told 0 — which is what notices the pin being dropped.
    autoCrowdSec: opts.autoCrowdSec ?? 0,
    // The error bar the straight-line AUTO budget keeps on top of its own estimate. It is a knob rather than a
    // constant only so `npm run measure` can price it: at the shipped 0.4 the johnson routine lands 7.29 AUTO
    // CORAL an ALLIANCE, taking it to 0 buys +0.21 ± 0.07 of AUTO for -0.19 ± 0.16 of the 9 LEAVE, and to −0.8
    // buys +0.44 ± 0.08 for -0.69 ± 0.24 — so the shortfall against the recorded 9 is NOT this margin being too
    // careful: bought at the cheapest rate it still leaves the column at 7.7. `AUTO_SLACK_SEC` is the value the
    // replay runs.
    autoSlackSec: opts.autoSlackSec ?? AUTO_SLACK_SEC,
  };
  const opp = side === 'blue' ? 'red' : 'blue';
  // G427 charges a MAJOR FOUL for contacting an opponent "partially or fully inside the opponent's BARGE ZONE
  // or REEF ZONE regardless of who initiates", so the defenders worth pressing are the ones out in the open:
  // a machine on its way to a STATION, or rolling an ALGAE. Pressing one at home costs 6 points every time
  // the two touch, which is the reason 2025 defense happened in the corridors and not at the REEF.
  const atHome = (o, obs) => {
    const rz = obs.geo[opp].reefZone;
    const bz = obs.geo[opp].bargeZone;
    // Two margins, not one. The clause judges the zone by the BUMPERS, so a ROBOT is inside as soon as its
    // centre is 15 in past the line (ROBOT_LIMITS.footprintHalfIn); the press then adds a second machine
    // length, because the opponent being pressed retreats HOME and a defender that was legal at the moment it
    // committed is touching somebody inside their zone a second later. Without that margin one defender earned
    // 10 G427s a MATCH by pressing at the line.
    const reach = 15 + 46;
    if (Math.hypot(o.x - rz.x, o.y - rz.y) < rz.apothem + reach) return true;
    return Math.abs(o.x - bz.x) < bz.halfX + reach && Math.abs(o.y - bz.y) < bz.halfY + reach;
  };
  // How many rings are still on the two REEFs for a strip to be worth asking for. The engine reports the
  // opponent's count separately because its own is the number `fastsim.js` drains a MATCH against.
  const algaePool = (obs) => obs.algaeLeft + (cfg.enemyAlgae ? obs.enemyAlgaeLeft || 0 : 0);
  // The cheapest CORAL STATION is not always the nearest one: a second machine on the same corner costs the
  // pair about a second a cycle, so `stationSpread` prices each teammate already bound for it in SECONDS of
  // drive and converts them through this machine's own speed — a fast machine will walk farther off the queue
  // than a slow one for the same wait. At the shipped 0 this is exactly the nearest-station pick.
  const stationBid = (rb, obs, list) => {
    let best = null;
    for (const s of list) {
      const crowded = cfg.stationSpread
        ? obs.allies.reduce((n, o) => n + (o.slot !== rb.slot && o.target
          && Math.hypot(o.target.x - s.x, o.target.y - s.y) <= 45 ? 1 : 0), 0)
        : 0;
      const d = s.d + cfg.stationSpread * crowded * (rb.profile?.driveSpeedIps ?? 160);
      if (!best || d < best.d) best = { s, d };
    }
    return best;
  };
  // The same bid on a PIECE: how many allies are already aimed at this one, converted into seconds of drive
  // for this machine. At the shipped `pieceSpread` 0 it returns 0 and the ranking below is the plain distance.
  // The AUTO routine calls it with `autoCrowdSec` instead, because the two are priced separately on purpose:
  // the TELEOP one is a duty the planner chooses, the AUTO one is what a scripted path has to look like.
  const crowdSec = (rb, obs, x, y, factor = cfg.pieceSpread) => (factor
    ? factor * obs.allies.reduce((n, o) => n + (o.slot !== rb.slot && o.target
      && Math.hypot(o.target.x - x, o.target.y - y) <= 45 ? 1 : 0), 0) * (rb.profile?.driveSpeedIps ?? 160)
    : 0);
  // Reaching an ALGAE on the opponent's REEF means driving past their CAGEs, and G418 charges a MAJOR FOUL
  // (6 points, plus a BARGE Ranking Point in a Qualification MATCH) to whoever is contacted there. The ledger
  // read is what found it: what a stripping fleet hands over is mostly CAGE and zone traffic, not the G427 the
  // clause table points at. `npm run verify`'s zone guard reads the shipped fleets' crossing as 0.13 rings off
  // the opponent a MATCH ungated and 0.00 gated, and the deter is free — 0.0 points of combined score — with the
  // same fleet handing over 1.88 foul points ungated against 0.00 gated. A fleet ORDERED to strip pays 15.6 more
  // fouls than the 0.25 rings it buys, and the control that refuses both crossings takes 0.00 rings and 0.00
  // calls inside their REEF ZONE while its own CAGE-area traffic still costs it 5.63. So the gate moves fleets
  // that choose, not fleets that are told. It ships because a planner offered the duty axis cannot be allowed
  // to choose it while the crossing is unpriced.
  // `[estimate]` 30 in: the ring is on the REEF's face, so a guard anywhere inside the zone plus two machine
  // lengths can be the one that gets touched while the gripper is busy. 46 is the same construction `atHome`
  // uses for a press; 30 is the tighter reading of it.
  const guarded = (obs) => {
    const rz = obs.geo[opp].reefZone;
    return obs.opponents.some((o) => !o.disabled && Math.hypot(o.x - rz.x, o.y - rz.y) < rz.apothem + 30);
  };
  // The ring this machine should go and get: their half is only on the menu while nobody is home to be
  // contacted in it.
  const ringFor = (obs) => {
    if (!cfg.enemyAlgae) return obs.algaeNear.find((a) => !a.enemy);
    if (cfg.zoneRisk && guarded(obs)) return obs.algaeNear.find((a) => !a.enemy);
    return obs.algaeNear[0];
  };
  // slot -> the contact-foul count the press was last measured against, and slot -> when it may press again.
  // A defender is the only thing in this game that earns a living by touching somebody, so the codes that
  // come out of a press are the signal that the press is being paid for rather than used.
  const pressed = new Map();
  const pausedUntil = new Map();
  const strikes = new Map();
  // The slots pressing on THIS tick, so an opportunistic press knows the fleet already has one across. G421
  // makes two a MAJOR, and the seat-count ledger says the second one buys nothing anyway. Cleared on the tick
  // because a press is re-decided every 0.2 s, not committed for a cycle.
  const pressing = new Set();
  let pressTick = -1;
  const pressOver = (rb, obs) => {
    const n = DEFEND_FOUL_CODES.reduce((a, c) => a + (rb.stats.fouls[c] || 0), 0);
    const prev = pressed.get(rb.slot);
    if (prev !== undefined && n > prev) {
      const s = (strikes.get(rb.slot) ?? 0) + 1;
      strikes.set(rb.slot, s);
      // The first foul for contact in their zone costs a trip back to the CORAL. The second costs the press
      // for the MATCH, because that is what a drive team does when the referee has told it twice it is in the
      // wrong place — and it is the only deterrent a G427 carries, since the clause has no card of its own.
      pausedUntil.set(rb.slot, s >= 2 ? Infinity : obs.t + cfg.defendResetSec);
    }
    pressed.set(rb.slot, n);
    return (pausedUntil.get(rb.slot) ?? 0) > obs.t;
  };
  // The pressable opponent, if this fleet is allowed to press right now. Ranked by what the press takes away
  // rather than by who is nearest: a machine carrying CORAL is the one whose next placement is worth stopping,
  // and the distance is the price paid for it — the same shape the 2026 build's threat score uses. Only the
  // open ones count, because G427 charges for contacting a car inside its own zone whoever started it.
  const pressFor = (rb, obs) => {
    if (pressOver(rb, obs)) return null;
    const rank = (o) => (o.coral >= 1 ? 0 : 40) + o.d / 40;
    const tgt = obs.opponents.filter((o) => !o.disabled && !atHome(o, obs)).sort((a, b) => rank(a) - rank(b))[0];
    if (!tgt) return null;
    pressing.add(rb.slot);
    return { mode: INTENT.DEFEND, targetRobot: tgt.slot, target: { x: tgt.x, y: tgt.y } };
  };
  const givenUp = (rb, lv) => (rb.stats.dropsAt ? rb.stats.dropsAt[lv] : 0) >= cfg.placeGiveUp;
  // slot -> { t, placed }: how long this ROBOT has been trying to land the CORAL it holds. `placed` is the
  // count it was measured against, so a placement clears the clock by itself.
  const held = new Map();
  const placeLevel = (rb, obs) => {
    const order = orderFor(rb);
    const placed = LEVELS.reduce((a, lv) => a + rb.stats.placed[lv], 0);
    const h = held.get(rb.slot);
    if (!h || h.placed !== placed) held.set(rb.slot, { t: obs.t, placed });
    const sunk = obs.t - held.get(rb.slot).t;
    const drop = Math.min(Math.floor(sunk / PLACE_PATIENCE_SEC), order.length - 1);
    // A driver who has missed the same branch three times does not go back for the fourth — they take the
    // L2 on the way down and come back if there is time. Without this the baseline keeps aiming a level no
    // matter how many CORAL it has dropped there, which is the reason the top branch always ended full even
    // at a 60% miss rate: the retries are free to a policy that never learns. `placeGiveUp: Infinity` is the
    // control arm, and it is what `npm run measure` compares the level distribution against.
    const want = (lv) => obs.free[lv] > 0 && !givenUp(rb, lv);
    return order.slice(drop).find(want) || order.find(want) || order.find((lv) => obs.free[lv] > 0);
  };
  // A banded ROBOT only counts the levels it was given as room: with a division of labour, "the REEF is
  // full" has to mean "MY band is full", or the machine with no L4 left keeps fishing for CORAL it cannot
  // place and never switches to ALGAE.
  const bandFree = (rb, obs) => orderFor(rb).reduce((a, lv) => a + obs.free[lv], 0);
  // The level list this machine works, in one place: `placeLevel`, `bandFree` and the endgame budget below all
  // have to read the same order, or the budget prices a level the machine will not aim.
  const orderFor = (rb) => (cfg.bands ? cfg.bands[rb.slot] ?? cfg.placeOrder : cfg.placeOrder);
  const wantLevel = (rb, obs) => orderFor(rb).find((lv) => obs.free[lv] > 0 && !givenUp(rb, lv));
  // The endgame legs, priced with the engine's own geometry so the policy and the sim do not drift apart:
  // a PLACE drives to `reefZone.apothem - 6` from the REEF CENTRE (engine.js, the PLACE move) and a CLIMB
  // drives to the CAGE then pays `climbSec`, plus the 1.2 s the engine adds for a DEEP pipe.
  const placeCostSec = (rb, obs, lv, x = rb.x, y = rb.y) => {
    const g = obs.geo[obs.side];
    const d = Math.max(0, Math.hypot(x - g.reef.x, y - g.reef.y) - (g.reefZone.apothem - 6));
    return travelSec(d, rb.profile) + (lv ? rb.profile.placeSec[lv] : Infinity);
  };
  const deliverSec = (rb, obs, x = rb.x, y = rb.y) => {
    const pr = obs.processor;
    const proc = travelSec(Math.hypot(x - pr.x, y - pr.y), rb.profile) + 0.8; // 0.8 s = engine.js's dump
    const net = obs.netDeposit;
    // The NET stand-off the engine reports is measured from where the machine stands now, so the ring-first
    // route prices its own drive twice; the mesh is on the ALLIANCE's own side, so from a source the honest
    // leg is the one from that source to the deposit point.
    return net ? Math.min(proc, travelSec(Math.hypot(x - net.x, y - net.y), rb.profile) + net.sec) : proc;
  };
  const hangSec = (rb, obs) => {
    const open = obs.cages.filter((c) => c.free);
    if (!open.length) return Infinity;
    const usable = rb.profile.canClimbDeep ? open : open.filter((c) => !c.deep);
    const near = (usable.length ? usable : open).sort((a, b) => a.d - b.d)[0];
    return travelSec(near.d, rb.profile) + rb.profile.climbSec + (near.deep ? 1.2 : 0);
  };
  // What it costs, from where this machine stands, to empty the hopper. Infinity when there is nothing to
  // spend or nowhere to spend it, which is what hands the machine back to the CAGE.
  const spendCostSec = (rb, obs) => (rb.coral >= 1 ? placeCostSec(rb, obs, wantLevel(rb, obs)) : rb.algae >= 1 ? deliverSec(rb, obs) : Infinity);
  // A ROBOT that decided to score before hanging has to be allowed to finish the drive: the decision clock
  // re-reads the endgame branch every 0.2 s, and without the latch the CLIMB return would cancel the
  // placement on the next tick and the CORAL would be dropped anyway.
  const spendFirst = new Set();
  return {
    onPeriodStart() {},
    // The planner's handle on the rule set: replace the knobs, keep every robot's history.
    configure(patch) { Object.assign(cfg, patch); },
    config: cfg,
    reset() {
      held.clear();
      pressed.clear();
      pausedUntil.clear();
      spendFirst.clear();
      pressing.clear();
    },
    decide(rb, obs) {
      if (!rb.coral) held.delete(rb.slot);
      if (!rb.coral && !rb.algae) spendFirst.delete(rb.slot);
      if (obs.t !== pressTick) { pressTick = obs.t; pressing.clear(); }
      const timeLeft = TIME.matchSec - obs.t;
      // AUTO (§6.4) has no driver input in reality — it is a pre-programmed routine — and the sim runs
      // the same policy through it. The routine a 2025 team actually scripted was two or three CORAL, not
      // one: TBA's 2025cmptx alliances averaged 9 CORAL in AUTO, 7 of them on L4 — the preload (§6.3.4.1 B)
      // plus a pick off a CORAL MARK (§6.3.4.1 A: six of them are on the carpet, and taking them in AUTO is
      // legal) and a second placement. LEAVE (§6.5.2) comes with the first metre of that path, because G303-D
      // starts the machine straddling the line the routine is measured from.
      if (obs.period === 'AUTO') {
        const autoFree = obs.free.L1 + obs.free.L2 + obs.free.L3 + obs.free.L4;
        if (rb.coral >= 1) {
          const lv = placeLevel(rb, obs);
          if (lv) return { mode: INTENT.PLACE, level: lv };
        }
        // How many CORAL the scripted AUTO routine attempts is a ROBOT property, not a driver choice:
        // `autoCycles` is what a team programmed (§6.4 — no driver input in AUTO). The whole field only stages
        // 6 CORAL MARKS, 3 per ALLIANCE (manual §5 definitions, §6.3.4.1 A), so the preload plus its own 3
        // marks is a 6-CORAL ceiling. The recorded AUTO columns sit above it: `2025cmptx_f1m1` has 9 CORAL in
        // AUTO for EACH alliance and the ledger arithmetic closes only if all nine are on L4 (9 x 7 = 63 of
        // Johnson's 295), and the nine elite teams read off the Statbotics 2025 export average `auto_coral`
        // 1.55-4.19 a ROBOT (mean 2.93, so 8.8 an ALLIANCE). The extra pieces come off the CORAL STATION,
        // which the HUMAN PLAYERS are already feeding at the whistle (G433-A lets the CORAL in through the
        // STATION and bars nobody at the AUTO whistle), so a real auto routine treats the station as a source.
        const p = rb.profile;
        const lineX = obs.geo[obs.side].startingLineX;
        // The budget test is what keeps the routine honest: the ROBOT has to drive to the source, take one,
        // come back and place it, and still have LEFT when AUTO ends, because that is when §6.5.2 scores it.
        // LEAVE is no longer a leg of that path. G303-D stages the ROBOT straddling its starting line, and
        // every source below is on the ALLIANCE-WALL side of it, so the first 15 in of the drive out clears
        // it and the 15 s is all cycle. Reserving the round trip was right for the build that started the
        // fleet 48 in on the wrong side of the line — it is what recovered 7.3 → 9 LEAVE points, against the
        // 97.7-100% per-ROBOT auto-leave rate the 2025cmptx TBA pages show — and it became a cycle spent
        // buying a point for nothing the moment #123 put the CORAL MARKs behind the REEF.
        const placed = LEVELS.reduce((a, lv) => a + rb.stats.placed[lv], 0);
        // Ranked with the crowd price, costed without it: two allies driving at the same MARK is a path a
        // script would never contain, and the fix is to send one of them somewhere else — the next MARK or
        // the STATION. The seconds the routine budgets for the leg stay the true distance, because the
        // machine really does drive that far either way.
        const sources = [
          ...obs.coralOnFloor.slice(0, 2).map((c) => ({ x: c.x, y: c.y, d: c.d + crowdSec(rb, obs, c.x, c.y, cfg.autoCrowdSec), raw: c.d, piece: c.ref })),
          ...obs.stations.filter((s) => s.remaining > 0)
            .map((s) => ({ x: s.x, y: s.y, d: s.d + crowdSec(rb, obs, s.x, s.y, cfg.autoCrowdSec), raw: s.d, stationIdx: s.i })),
        ].sort((a, b) => a.d - b.d);
        const src = sources[0];
        const cost = src ? 2 * travelSec(src.raw, p) + p.pickSec + p.placeSec.L4 + cfg.autoSlackSec : Infinity;
        // `autoCycles` is the number of CORAL the routine spends, counting the preload, so the fetch is open
        // while placements so far are under it.
        if (placed < (p.autoCycles ?? 1) && autoFree > 0 && cost < TIME.autoSec - obs.t) {
          return { mode: INTENT.FETCH_CORAL, target: { x: src.x, y: src.y }, piece: src.piece, stationIdx: src.stationIdx };
        }
        // Nothing fits in the 15 s: clear the line by backing toward the ALLIANCE WALL, which is where a
        // machine with no AUTO job belongs, rather than driving into the BARGE to do it.
        if (!rb.left) return { mode: INTENT.IDLE, target: { x: lineX - (obs.side === 'blue' ? 30 : -30), y: rb.y } };
        return { mode: INTENT.IDLE };
      }
      // The endgame belongs to the CAGES: BARGE points are worth 6-12 each and a 16-point BARGE RP. The window
      // was 30 s, which gave up about a third of TELEOP — the shipped value is `cfg.climbWindowSec`, and the
      // planner re-solves it through TELEOP — because the Einstein alliances that ended with three DEEP CAGES
      // still averaged 12/12/12 branches plus 15 trough CORAL (TBA 2025cmptx).
      if (timeLeft <= cfg.climbWindowSec && !obs.self.climb) {
        // Which pipe to hang on is the engine's call, because it is the one that knows how many ROBOTS are
        // already committed to it; the policy only asks for a climb and stays out of the choice.
        const open = obs.cages.filter((c) => c.free);
        if (open.length) {
          if (cfg.spendBeforeClimb && (rb.coral >= 1 || rb.algae >= 1)) {
            // Score it, then hang: the two legs have to both fit in the clock that is left, which is what
            // keeps this from buying 4 points of CORAL with 6-12 points of BARGE. Once they do not fit, the
            // machine goes — the drop is the engine's, and it is the cheaper half of the trade.
            const both = spendCostSec(rb, obs) + hangSec(rb, obs);
            if (both <= timeLeft) spendFirst.add(rb.slot);
            else spendFirst.delete(rb.slot);
            if (!spendFirst.has(rb.slot)) return { mode: INTENT.CLIMB };
            // Fall through to the PLACE / ALGAE branches below; the latch is what stops the next 0.2 s
            // decision from re-reading this branch and cancelling the drive.
          } else {
            return { mode: INTENT.CLIMB };
          }
        }
      }
      const reefFree = bandFree(rb, obs);
      if (rb.coral >= 1) {
        const lv = placeLevel(rb, obs);
        if (lv) return { mode: INTENT.PLACE, level: lv };
        // A saturated REEF: the CORAL stays in the hopper (G409 allows exactly one, and a ROBOT may not
        // deliberately eject a SCORING ELEMENT out of bounds), so the only productive move left is ALGAE.
      }
      if (rb.algae >= 1) {
        // Two goals for one ring. The PROCESSOR pays 6 but the piece then rolls to the opponent's area and
        // their HUMAN PLAYER throws it into their NET for an expected 4 x accuracy (§5.5, §6.1); the NET pays
        // 4 and gives away nothing, but the mesh's border is 6 ft 4 in up (§5.4.2) and only a machine with
        // the elevator for it can get one in (§6.1). So the margin per second of delivery decides, and the
        // processor is the pick for everything that cannot reach.
        // Route-specific, not the max: `obs.algaeMarginValue` is the bid value for the STRIP (best of the two
        // goals), while this comparison needs the PROCESSOR's own margin, which the opponent's accuracy eats.
        const procMargin = Math.max(1, POINTS.algae.processor[1] - POINTS.algae.net[1] * (obs.hpAccuracy ?? 0));
        const pr = obs.processor;
        const procSec = travelSec(Math.hypot(rb.x - pr.x, rb.y - pr.y), rb.profile) + 0.8; // 0.8 s = engine.js's dump
        const net = obs.netDeposit;
        if (net && POINTS.algae.net[1] / (travelSec(net.d, rb.profile) + net.sec) > procMargin / procSec) {
          return { mode: INTENT.SCORE_NET, target: { x: net.x, y: net.y } };
        }
        return { mode: INTENT.PROCESS };
      }
      if (!cfg.noAlgae && rb.coral >= 1 && reefFree === 0 && algaePool(obs) > 0 && rb.algae < 1) return { mode: INTENT.STRIP_ALGAE };
      // A machine the plan put on DEFEND duty does not go looking for CORAL: its job is the opponent's tempo,
      // and the fleet's throughput is priced on the other two holding their cycles. It still spends what it is
      // carrying and still climbs when the window opens, because both of those branches sit above this one.
      if (cfg.defendSlots?.includes(rb.slot)) {
        // Only an opponent OUT in the open is a pressable target. G427 charges a MAJOR FOUL for contacting a
        // machine inside its own REEF ZONE or BARGE ZONE whoever initiated it, so pressing one at home is not
        // a defence, it is a 6-point donation every time the two touch — which is why 2025 defense happened in
        // the corridors and the press breaks off the moment the opponent gets home. A DUTY seat presses
        // whatever the fleet's other seats are doing, because it was told to; the one-presser rule below is
        // only for a press the machine chooses itself.
        const press = pressFor(rb, obs);
        if (press) return press;
      }
      // Nothing held: pick the cheapest scoring opportunity. A branch is worth 3-5 TELEOP points. An ALGAE
      // is worth 6 in the processor but not 6 of MARGIN: the same piece then lands in the opponent's
      // PROCESSOR AREA and their HUMAN PLAYER throws it into their NET for an expected 4 x accuracy, so
      // the engine hands the net-adjusted figure in obs.algaeMarginValue (§5.5, §6.1).
      const coral = obs.coralOnFloor[0];
      const algae = ringFor(obs);
      const ownBid = stationBid(rb, obs, obs.stations.filter((s) => s.remaining > 0));
      const station = ownBid?.s;
      // The round trip, priced from the SOURCE rather than from here, because that is where the delivery leg
      // starts. `cfg.cycleCutoffSec` is the only thing that looks at it: at 0 every option below is open and
      // the shipped behaviour is exactly the nearest piece.
      const p = rb.profile;
      const want = wantLevel(rb, obs);
      const coralCycle = (src, d) => travelSec(d, p) + p.pickSec + placeCostSec(rb, obs, want, src.x, src.y);
      const algaeCycle = (src, d) => travelSec(d, p) + p.algaeStripSec + deliverSec(rb, obs, src.x, src.y);
      const fits = (sec) => cfg.cycleCutoffSec <= 0 || sec <= timeLeft - cfg.cycleCutoffSec;
      // A machine the plan put on ALGAE duty does not wait for the REEF to empty: the assignment is the
      // plan's, and the fleet's throughput depends on it holding that job.
      if (cfg.algaeSlots?.includes(rb.slot) && algae && fits(algaeCycle(algae, algae.d))) {
        return { mode: INTENT.STRIP_ALGAE, target: { x: algae.x, y: algae.y }, piece: algae.ref };
      }
      const options = [];
      if (reefFree > 0) {
        if (coral && fits(coralCycle(coral, coral.d))) options.push({ mode: INTENT.FETCH_CORAL, d: coral.d + crowdSec(rb, obs, coral.x, coral.y), cyc: coralCycle(coral, coral.d), value: 4, target: { x: coral.x, y: coral.y }, piece: coral.ref });
        if (station && fits(coralCycle(station, station.d))) options.push({ mode: INTENT.FETCH_CORAL, d: ownBid.d + 12, cyc: coralCycle(station, station.d), value: 4, target: { x: station.x, y: station.y }, stationIdx: station.i, stationSide: obs.side });
        // §6.3.4.1 C puts 57-60 CORAL behind each ALLIANCE's two STATIONs and no clause reserves them to
        // their own side, so their queue is a source: the same 4 points, one fewer CORAL they will place, and
        // the whole length of the FIELD to pay for it. `d` is measured from where this machine stands, which
        // is what makes the crossing price itself — and only one ROBOT of the three can be over there, per
        // G421.
        const stolen = cfg.coralTheft ? stationBid(rb, obs, obs.enemyStations?.filter((s) => s.remaining > 0) || []) : null;
        if (stolen && fits(coralCycle(stolen.s, stolen.s.d))) options.push({ mode: INTENT.FETCH_CORAL, d: stolen.d + 12, cyc: coralCycle(stolen.s, stolen.s.d), value: 4, target: { x: stolen.s.x, y: stolen.s.y }, stationIdx: stolen.s.i, stationSide: opp });
      }
      const algaeValue = Math.max(1, obs.algaeMarginValue ?? POINTS.algae.processor[1]);
      if (!cfg.noAlgae && algae && algaePool(obs) > 0 && fits(algaeCycle(algae, algae.d))) {
        options.push({ mode: INTENT.STRIP_ALGAE, d: algae.d + crowdSec(rb, obs, algae.x, algae.y), cyc: algaeCycle(algae, algae.d), value: algaeValue, target: { x: algae.x, y: algae.y }, piece: algae.ref });
      }
      // A second with nothing to buy is a second the opponent can spend for you. This is where the clock gate
      // leaves its leftovers: a machine whose round trip no longer fits, or whose REEF has nothing left at a
      // level it will still aim, comes here instead of driving home empty. Only one of the three does it, and
      // only when nobody was already told to.
      if (!options.length) {
        if (cfg.autoDefend && !pressing.size) {
          const press = pressFor(rb, obs);
          if (press) return press;
        }
        return { mode: INTENT.IDLE, target: { x: obs.geo[obs.side].bargeZone.x, y: obs.geo[obs.side].bargeZone.y } };
      }
      // Cheapest per point of value, with a small penalty for crossing the whole field.
      options.sort((a, b) => a.d / a.value - b.d / b.value);
      const pick = options[0];
      // The press has to beat the fetch it replaces in the one currency the fetch is already priced in:
      // WHOLE-CYCLE seconds per point, because a press is an open-ended job and a cycle is not. `cyc` is the
      // same straight-line budget `cycleCutoffSec` gates on, so the two rules read one number.
      if (cfg.autoDefend && !pressing.size
        && pick.cyc / pick.value > 1 / cfg.pressTakePerSec) {
        const press = pressFor(rb, obs);
        if (press) return press;
      }
      return pick.mode === INTENT.FETCH_CORAL ? { mode: INTENT.FETCH_CORAL, target: pick.target, piece: pick.piece, stationIdx: pick.stationIdx, stationSide: pick.stationSide } : { mode: INTENT.STRIP_ALGAE, target: pick.target, piece: pick.piece };
    },
  };
}

// A floor, not a strategy: uniform random intent. Used to prove the baselines are discriminating.
// The seed is per-MATCH (`league.js` derives it from the match seed) so two different MATCHes are two
// different draw sequences; it used to be ignored, which made one random fleet replay itself every seed.
export function randomPolicy(side, opts = {}) {
  let a = (opts.seed ?? 7) >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    onPeriodStart() {},
    reset() {},
    decide() {
      const r = rnd();
      if (r < 0.5) return { mode: INTENT.FETCH_CORAL };
      if (r < 0.7) return { mode: INTENT.PLACE, level: LEVELS[Math.floor(rnd() * 4)] };
      if (r < 0.85) return { mode: INTENT.STRIP_ALGAE };
      if (r < 0.95) return { mode: INTENT.PROCESS };
      return { mode: INTENT.CLIMB };
    },
  };
}

// Every policy factory has the same shape: (side, opts) -> { reset, onPeriodStart, decide }. A planner
// registered here is selectable by the page and by the leagues the same way greedy is. The Stage 2 planner
// is not in this table: it wraps `greedyPolicy`, so importing it here would make `policy.js` import the
// module that imports it — `league.js` adds it to the registry instead.
export const BASELINES = { greedy: greedyPolicy, random: randomPolicy };
