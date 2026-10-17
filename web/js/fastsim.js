// A fast analytic model of one ALLIANCE's REEFSCAPE output.
//
// It exists to RANK plans, not to predict scores. A MATCH is 1500 engine ticks and a search wants to
// compare a hundred candidate allocations before the clock runs out, so this prices a CYCLE — the drive,
// the pick, the placement — instead of driving a robot through it. Absolute totals are not what the
// planner reads; it reads the difference between two plans under the same context, which is why the
// residual against the tick engine is printed by `npm run measure` and one scalar (`efficiency`) is
// fitted there rather than tuned until a single number looks right.
//
// What it models is the three things the manual makes scarce: the branch stock (§6.5.1 — 12 CORAL per
// level and the trough, never refilled), the clock (§6.4 — 15 s AUTO + 135 s TELEOP), and the ALGAE supply
// (§6.3.4.2 — nine pieces on an ALLIANCE's own REEF). Everything else is arithmetic.

import { travelSec } from './policy.js';
import { netDeposit } from './engine.js';
import { POINTS, TIME, ROBOT_LIMITS } from './rules.js';
import { BRANCH_SLOTS_PER_LEVEL, TROUGH_CAP, ALGAE_PER_ALLIANCE, CAGE_ROBOT_CAPACITY, MARK_FROM_REEF_IN } from './model.js';

// Mirrored from the engine so the two price the same action (engine.js finishBusy / the CLIMB branch).
const PROCESS_SEC = 0.8;
const DEEP_EXTRA_SEC = 1.2;
// `[estimate]` the extra drive a placement costs beyond the REEF's edge: the ROBOT has to reach the branch
// and settle, and the tick engine does that with a hexagon resolution this model has no room to replay.
const PLACE_LEAD_IN = 14;
// `[estimate]` how close to the BARGE a robot already is when it decides to climb: it has just been at a
// branch, and the trough face is the one turned toward the truss.
const CLIMB_APPROACH_IN = 20;
// What the opponent's REEF is worth to a machine on ALGAE duty, measured rather than derived. The policy can
// legally take a ring from either REEF (§6.5.1 scores an ALGAE by where it lands, never by where it grew) but
// holds back while an opponent is home to be touched, so a duty machine crosses only on the leakage past that
// gate. Over 16 seeds on two bases, with one fleet told to strip and the other playing the shipped policy, the
// duty arms took 0.19 / 0.63 enemy rings a MATCH for one and three machines on duty (two sits between them)
// and donated 7.1 / 41.8 points against the no-duty fleet's 3.8 — about a third of a ring per duty machine.
// The donation is G418 (contacting an opponent CAGE, the furniture a route to their REEF has to pass, a MAJOR
// FOUL) plus G421 when a second machine is out there with it, and most of it is roaming traffic rather than
// the trip, which is why the model charges the rings and not the bill. Both were measured after the trio
// started lifting its own ALGAE, and again after #123 moved the CORAL MARKs behind the REEF: the leakage went
// UP, because a machine whose own nine rings are all it can see at home has one less reason to go over there
// and one more reason for the trip to be the ALGAE that is still on their structure.
const ENEMY_RINGS_PER_DUTY = 0.30;
const CROSS_FOUL_PTS = 3.0;
// The station spread, in two measured numbers. `SPREAD_SEC` is what a CORAL STATION pocket costs when a
// teammate is already queueing at it, and it is also roughly the break-even the bid should use — a machine
// switches pockets only when the extra walk is shorter than the wait it is buying out — so `policy.js` takes it
// as its willingness to pay, and `npm run headroom` sweeps the value rather than defending it.
// `SPREAD_SAVED_SEC` is what the fleet gets back per CORAL cycle once it does spread, and it came down from
// 0.38 s when the trio started lifting its own ALGAE. The statistic that priced it has gone the other way: over
// 24 mirror seeds a pick that began with a teammate on the same corner now follows that machine's last pick by
// 4.34 ± 0.18 s against 6.83 ± 0.11 s when it began alone (n=257 against 2,703) — rejoining the corner your
// fleet never left is a short drive, so that read cannot carry a wait any more. What the lever still does is
// organise the queue, which the engine's own counter reads: 27.5% of a fleet's 58.7 CORAL picks start contested
// unpriced, 15.1% with the crowd at 0.91 s. What that is worth in a MATCH, on the one-sided arm guard 27 runs,
// is +3.3 ± 2.0 own points over 24 paired held-out seeds, and −2.2 ± 3.3 margin when both fleets do it. The credit
// is set on the estimate rather than guessed at: its effect there is a STEP, because a saved second only shows
// up when enough of them stack to fit another whole cycle before the commit window. At the efficiency
// `npm run verify` prices with (1.3925, deliberately NOT the 1.613 `npm run fastsim` fits on both bases since #123
// moved the MARKs — at the fit the credit stops pricing the spread as seconds off a cycle and the guard's two-
// clock clause has nothing to assert) the price reads 0 points with no credit, one extra CORAL (+2) for anything
// from 0.05 s to 0.38 s, two (+4) at 0.50 s and four (+8) at 0.70 s. 0.15 sits in
// the middle of the plateau the engine's read supports.
const SPREAD_SEC = 0.91;
export const SPREAD_PENALTY = SPREAD_SEC;
const SPREAD_SAVED_SEC = 0.15;
const LEVEL_CAP = { L1: TROUGH_CAP, L2: BRANCH_SLOTS_PER_LEVEL, L3: BRANCH_SLOTS_PER_LEVEL, L4: BRANCH_SLOTS_PER_LEVEL };
const LEVELS_DESC = ['L4', 'L3', 'L2', 'L1'];

const hypot = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function makeContext({ profiles, geo, side, scenario, marks = 3 }) {
  const reef = geo[side].reef;
  const opp = side === 'blue' ? 'red' : 'blue';
  const hpAccuracy = scenario.humanPlayer[opp].accuracy;
  return {
    side,
    reef,
    // The crossing a duty machine makes: their REEF, and the way home to this ALLIANCE's PROCESSOR.
    enemyReefD: hypot(geo[opp].reef, reef),
    enemyProcessorD: hypot(geo[opp].reef, geo[side].processor),
    // Cycles return to the nearer corner: greedy prices both STATIONs the same way the engine's baseline
    // does, so the model is comparing like with like rather than with an idealised fleet.
    stationD: Math.min(...geo[side].coralStations.map((s) => hypot(s, reef))),
    markD: MARK_FROM_REEF_IN, // §6.3.4.1 A: three CORAL MARKS, in a line between the REEF and its ALLIANCE WALL
    marks,
    processorD: hypot(geo[side].processor, reef),
    bargeD: hypot(geo[side].bargeZone, reef),
    // §6.1's second ALGAE goal: the ROBOT's own NET, worked from the same stand-off the engine drives to.
    netD: hypot(netDeposit(geo, side, ROBOT_LIMITS.footprintHalfIn), reef),
    cages: geo[side].cages.map((c, i) => ({ i, d: hypot(c, reef), deep: scenario.cageDepth[side][i] })),
    profiles: profiles.map((p) => ({ ...p })),
    hpAccuracy,
    // What the baseline is willing to drive an extra inch for: an ALGAE is worth 6 in the PROCESSOR minus
    // what the opponent's HUMAN PLAYER then converts it into (§5.5, §6.1). The engine hands the same number
    // to the policy as `obs.algaeMarginValue`, so a model that priced it at 6 would pick ALGAE more often
    // than the fleet it is modelling does.
    algaeBidValue: Math.max(1, POINTS.algae.processor[1] - POINTS.algae.net[1] * hpAccuracy),
    // Which placement model the MATCH being planned is running. Read off the scenario rather than assumed,
    // because `npm run fastsim` orders plans against the engine on both arms.
    placementRisk: scenario.placementRisk !== false,
    efficiency: scenario.fastsimEfficiency ?? 1,
  };
}

// The legs of a CORAL cycle, priced apart, because the model has to know which resource each one holds up.
// `efficiency` is a slowdown factor (1 = the straight-line estimate, 1.4 = 40% more time on the drive
// legs), so a fitted value above 1 means the model is being made SLOWER, matching what a robot fighting
// its own teammates for a corner actually does.
function coralLegs(ctx, p, level, fromMarks, eff = ctx.efficiency) {
  const d = fromMarks ? Math.min(ctx.markD, ctx.stationD) : ctx.stationD;
  const out = travelSec(Math.max(d - ctx.reef.apothem, 6), p) * eff;
  const back = (travelSec(Math.max(d - ctx.reef.apothem, 6), p) + PLACE_LEAD_IN / p.driveSpeedIps) * eff;
  // The engine does not score every attempt: §6.5.1 only counts a CORAL whose BRANCH ends up inside its
  // volume, and `placeDrop` is the fraction that does not. A model that priced one attempt per CORAL would
  // believe a fleet with a shaky L4 has the same throughput as one without, so the attempt is divided by the
  // share that stays on. Only the placement time repeats — the piece falls beside the car, so the re-pick is
  // the cheap leg and the drive is unchanged.
  const miss = ctx.placementRisk ? (p.placeDrop ? p.placeDrop[level] || 0 : 0) : 0;
  return { out, pick: p.pickSec, back, place: p.placeSec[level] / (1 - miss) };
}

// One full CORAL cycle, at an efficiency the caller chooses. Exported for the live planner: `efficiency` as
// `npm run fastsim` fits it is a whole-MATCH average of this field, while a MATCH in progress can tell the
// planner its own machines are slower or faster than that, and the commit decision depends on which.
export function coralCycleSec(ctx, p, level, fromMarks, eff = ctx.efficiency) {
  const l = coralLegs(ctx, p, level, fromMarks, eff);
  return l.out + l.pick + l.back + l.place;
}

// The ALGAE legs priced apart, because the baseline bids on the leg to the PIECE and then pays for the
// DELIVERY separately (`policy.js` sorts its options by `d / value`, and `d` is the distance to the piece).
// An ALGAE grows on the robot's own REEF, so a machine standing at a branch is a few feet from one: the ALGAE
// wins the bid whenever one is left, and the fleet drains all nine inside the first minute while the REEF
// still has 11 empty CORAL slots. That is why the engine banks ALGAE columns bigger than the nine a side grows
// (`npm run headroom`'s shipped row: 5.0 processed and 8.0 in the mesh, 5.2 and 7.8 on the other base) — the
// other REEF is legal supply — and why a model that
// bids on the processor round trip bids on nothing worth taking and scores 0.
// `[estimate]` ALGAE_REACH_IN: the gap between neighbouring branch positions on a hexagon face.
const ALGAE_REACH_IN = 18;

function algaeLegs(ctx, p, eff = ctx.efficiency) {
  const reach = travelSec(ALGAE_REACH_IN, p);
  const deliver = travelSec(Math.max(ctx.processorD - ctx.reef.apothem, 6), p) * eff;
  const proc = { bid: reach, total: reach + p.algaeStripSec + deliver + PROCESS_SEC, value: ctx.algaeBidValue, route: 'proc' };
  if (!p.netScoreSec) return proc;
  // A machine that clears the mesh's border has the second route, and it is priced the way `policy.js`
  // prices it: margin over the seconds the delivery costs. 4 kept beats 6 minus what the throw hands back
  // only when the trip to the BARGE is not much longer than the trip to the PROCESSOR.
  const netDeliver = travelSec(Math.max(ctx.netD - ctx.reef.apothem, 6), p) * eff;
  const net = { bid: reach, total: reach + p.algaeStripSec + netDeliver + p.netScoreSec, value: POINTS.algae.net[1], route: 'net' };
  return net.value / net.total > proc.value / proc.total ? net : proc;
}

// One full ALGAE cycle, for the same reason `coralCycleSec` exists.
export function algaeCycleSec(ctx, p, eff = ctx.efficiency) {
  return algaeLegs(ctx, p, eff).total;
}

// What one trip to the opponent's REEF costs OVER a pick at your own: the drive out across the BARGE and the
// drive home to this ALLIANCE's PROCESSOR, less the short reach an own-REEF ring costs. Derived from the field
// geometry the context already holds, so a fleet with slower machines or a wider field pays for the crossing
// in the model the way the engine makes it pay in seconds.
function crossingSec(ctx, p, eff = ctx.efficiency) {
  const out = travelSec(Math.max(ctx.enemyReefD - 2 * ctx.reef.apothem, 40), p) * eff;
  const home = travelSec(Math.max(ctx.enemyProcessorD - ctx.reef.apothem, 6), p) * eff;
  return Math.max(0, out + home + p.algaeStripSec + PROCESS_SEC - algaeCycleSec(ctx, p, eff));
}

// The CORAL leg the baseline bids against. It bids a flat 4 for any CORAL whatever level it will actually
// land on (`value: 4` in policy.js), which is why the fleet keeps choosing CORAL over an ALGAE it prices at
// 3-ish even when the top level is full and it will only get 2.
const CORAL_BID_VALUE = 4;

function climbSec(ctx, p, cage) {
  // A robot leaves for a CAGE from the REEF face it was just placing at, not from the REEF's centre, so the
  // climb leg is priced like the others — the hexagon's apothem off the straight line.
  // `efficiency` is deliberately NOT applied here. It is a fit for the queue three machines form at one CORAL
  // STATION corner, and the BARGE side of the field has no queue: the engine banks roughly three cages at
  // every window from 6 s to 30 s (BARGE 27.3-30.0 across the `npm run headroom` arms), while applying the
  // traffic fudge to this leg made a 6 s commit cost the model all 36 of its CAGE points and flipped the sign
  // of the biggest lever the planner is supposed to find.
  const d = Math.max(cage.d - ctx.reef.apothem - CLIMB_APPROACH_IN, 40);
  return travelSec(d, p) + p.climbSec + (cage.deep ? DEEP_EXTRA_SEC : 0);
}

// The drive alone, with no attach: long enough for §6.5.2's PARK (on the ground inside the BARGE ZONE) but
// not for a pipe. It is the difference between 2 points and 0, and a late commit decision turns entirely on
// which of the two a robot can still make.
function driveToBargeSec(ctx, p) {
  return travelSec(Math.max(ctx.bargeD - ctx.reef.apothem - CLIMB_APPROACH_IN, 12), p);
}

// The cheapest CAGE still open to this machine, or Infinity when every pipe is claimed — which is what makes
// the endgame an allocation rather than a race, and what the baseline cannot express (it asks for a climb and
// lets the engine pick, so a fleet of three with one pipe left just queues).
function bestCage(ctx, p, used) {
  let best = null;
  ctx.cages.forEach((c, i) => {
    if (used[i] >= CAGE_ROBOT_CAPACITY) return;
    const sec = climbSec(ctx, p, c);
    if (!best || sec < best.sec) best = { i, sec, deep: c.deep };
  });
  return best;
}

// The AUTO routine (§6.4) is scripted, so it is a fixed contribution the planner does not drive:
// `autoCycles` CORAL per ROBOT counting the preload (§6.3.4.1 B). LEAVE (§6.5.2) comes with it for free,
// because G303-D stages every ROBOT straddling its starting line and the routine's first move is off it.
// AUTO points are paid at the higher AUTO column (Table 6-2).
function autoOf(ctx, plan) {
  const byLevel = { L1: 0, L2: 0, L3: 0, L4: 0 };
  const cap = { ...LEVEL_CAP };
  ctx.profiles.forEach((p, i) => {
    const order = plan.bands ? plan.bands[i] ?? plan.placeOrder : plan.placeOrder;
    const lv = order.find((l) => cap[l] > 0) || order[0];
    const n = Math.min(p.autoCycles ?? 1, cap[lv]);
    cap[lv] -= n;
    byLevel[lv] += n;
  });
  return byLevel;
}

// The core: three timelines, one piece at a time, always handing the next piece to the machine that is
// free EARLIEST. That is what makes the stock visible — when L4 fills the same code path starts paying L3
// points instead of pretending every cycle is still worth 5, which is the whole reason a fixed rule set
// and a plan that stops CORAL early differ.
//
// `opts` lets the same model answer the question the planner actually asks in a live MATCH: not "what would
// this plan have done from the start" but "what is still left to do from here". `startAt` is the clock,
// `stock`/`algae`/`marks` are what the REEF still holds, and `freeAt` is when each machine next becomes
// available. With none of them the call is the pre-MATCH whole-alliance estimate.
export function estimateAlliance(ctx, plan, opts = {}) {
  const teleopEnd = TIME.matchSec;
  const climbAt = teleopEnd - plan.climbWindowSec;
  // The credit is fitted by `npm run fastsim`, which sweeps it: its effect on the estimate is a STEP (a saved
  // second only shows up when it is enough to fit another whole cycle before the commit window), so the value
  // has to be read off the sweep rather than assumed.
  const spreadCreditSec = opts.spreadCreditSec ?? SPREAD_SAVED_SEC;
  const startAt = Math.max(opts.startAt ?? TIME.autoSec, TIME.autoSec);
  // Once the MATCH is running, AUTO is history: its pieces are already on the board and its share of the
  // stock is already gone, so the estimate must neither reserve for it nor pay its (higher) column.
  const inMatch = startAt > TIME.autoSec;
  const algaeTaken = opts.algae ?? 0;
  const duty = ctx.profiles.map((p, i) => (plan.algaeSlots ? plan.algaeSlots.includes(i) : false));
  // The leakage past the gate, in rings: a duty machine gets across to the opponent's REEF about once every
  // five ALGAE picks it makes (ENEMY_RINGS_PER_DUTY), bounded by what is still growing over there. It is only
  // a thing while this ALLIANCE's own REEF still has rings — which is when the duty exists — so a live re-plan
  // late in the MATCH neither bills the trip again nor books a ring nobody went for.
  const crosses = algaeTaken < ALGAE_PER_ALLIANCE
    ? Math.min(opts.enemyAlgaeLeft ?? ALGAE_PER_ALLIANCE, duty.reduce((a, d) => a + (d ? ENEMY_RINGS_PER_DUTY : 0), 0))
    : 0;
  // A machine on ALGAE duty spends part of its MATCH crossing, so its timeline starts late.
  const free = ctx.profiles.map((p, i) => Math.max(startAt, opts.freeAt?.[i] ?? startAt)
    + (duty[i] && crosses > 0 ? ENEMY_RINGS_PER_DUTY * crossingSec(ctx, p) : 0));
  const auto = inMatch ? { L1: 0, L2: 0, L3: 0, L4: 0 } : autoOf(ctx, plan);
  const byLevel = { L1: 0, L2: 0, L3: 0, L4: 0 };
  const stock = opts.stock ? { L1: opts.stock.L1, L2: opts.stock.L2, L3: opts.stock.L3, L4: opts.stock.L4 } : { ...LEVEL_CAP };
  let algae = algaeTaken;
  let netAlgae = opts.algaeNet ?? 0; // of those, how many went into the ROBOT's own NET (§6.1)
  let marks = opts.marks ?? ctx.marks; // §6.3.4.1 A: three per ALLIANCE, and they are the cheapest first picks
  let srcBusyAt = startAt; // the STATION corner the CORAL cycles queue at
  for (const lv of LEVELS_DESC) {
    byLevel[lv] = auto[lv];
    stock[lv] -= auto[lv];
  }
  const used = opts.cageUsed ? opts.cageUsed.slice() : ctx.cages.map(() => 0);
  const climbed = { deep: 0, shallow: 0, park: 0, missed: 0 };
  let guard = 0;
  while (guard++ < 2000) {
    let slot = -1;
    for (let i = 0; i < free.length; i++) if (slot < 0 || free[i] < free[slot]) slot = i;
    if (free[slot] >= teleopEnd) break;
    const p = ctx.profiles[slot];
    const t = free[slot];
    if (t >= climbAt) {
      // The window is open and this machine is free, so it goes for a CAGE, and what it scores depends on how
      // much MATCH is left: DEEP/SHALLOW if it can reach a pipe and attach, PARK if it can only reach the
      // BARGE ZONE (§6.5.2 PARK is being on the ground inside the zone), and NOTHING if it cannot get there.
      // Counting the unreachable case as a PARK is what made a late commit look free; the engine does not.
      const cage = bestCage(ctx, p, used);
      if (cage && t + cage.sec <= teleopEnd) {
        used[cage.i] += 1;
        if (cage.deep) climbed.deep += 1;
        else climbed.shallow += 1;
      } else if (t + driveToBargeSec(ctx, p) <= teleopEnd) climbed.park += 1;
      else climbed.missed += 1;
      free[slot] = teleopEnd;
      continue;
    }
    const order = plan.bands ? plan.bands[slot] ?? plan.placeOrder : plan.placeOrder;
    const lv = order.find((l) => stock[l] > 0);
    const fromMarks = marks > 0;
    const legs = lv ? coralLegs(ctx, p, lv, fromMarks) : null;
    const aLegs = algaeLegs(ctx, p);
    const algaeRoom = algae < ALGAE_PER_ALLIANCE;
    const coralBid = legs ? legs.out / CORAL_BID_VALUE : Infinity;
    const algaeBid = algaeRoom ? aLegs.bid / aLegs.value : Infinity;
    // A cycle is only worth starting if it finishes before the commit window, because the drive to the source
    // is not a committed action: the engine re-decides every 0.2 s while a ROBOT is moving, so the instant the
    // window opens the machine turns around and goes for a CAGE, and the CORAL it was chasing is never picked
    // up. What it costs to be interrupted is measurable rather than guessed — over 12 MATCHes at a 6 s window
    // the fleet asked at t=144.1 (max 144.5) and took 4.81 s (max 5.80) to get ON the pipe, ending with 1.83 DEEP,
    // 1.00 SHALLOW and 0.08 PARK, i.e. essentially the same BARGE column a 20 s window gets (1.92/1.00/0.00). An interrupted
    // climb is as cheap as a clean one, so the test prices the climb at its own cost and adds nothing.
    // Whichever piece is cheaper per point of value wins the pick — the baseline's own test, not a rule the
    // planner can assume away. A machine the plan put on ALGAE duty has no say in it.
    const takeAlgae = algaeRoom && (duty[slot] || !lv || algaeBid < coralBid);
    if (takeAlgae) {
      if (t + aLegs.total > climbAt) {
        free[slot] = climbAt;
        continue;
      }
      algae += 1;
      if (aLegs.route === 'net') netAlgae += 1;
      free[slot] = t + aLegs.total;
      continue;
    }
    // Nothing to take: no branch stock and no ALGAE left, so the machine waits for its CAGE.
    if (!lv) {
      free[slot] = climbAt;
      continue;
    }
    const startPick = fromMarks ? t + legs.out : Math.max(t + legs.out, srcBusyAt);
    // The spread's credit: `SPREAD_SAVED_SEC` off the cycle, the largest per-cycle saving the engine's two
    // reads of this lever support. Taken off the cycle rather than built into `legs` so the queue lock the
    // shipped plans pay stays exactly as `npm run fastsim` validated it.
    const doneAt = startPick + legs.pick + legs.back + legs.place - (plan.spread ? spreadCreditSec : 0);
    if (doneAt > climbAt) {
      free[slot] = climbAt;
      continue;
    }
    // A cycle holds up the resource it uses. Two CORAL STATIONS sit in the pockets at the ends of the
    // ALLIANCE WALL, three machines want the nearer one, and the tick engine spends real seconds on that
    // queue (it is the pile-up `npm run verify` still prices with `unstickOff`). Without the lock the model
    // says every plan finishes the stock early and the commit window looks free, which is the opposite of
    // what the engine measures.
    srcBusyAt = startPick + legs.pick;
    stock[lv] -= 1;
    byLevel[lv] += 1;
    if (fromMarks) marks -= 1;
    free[slot] = doneAt;
  }
  let coralPoints = 0;
  for (const lv of LEVELS_DESC) {
    const autoN = Math.min(auto[lv], byLevel[lv]);
    coralPoints += autoN * POINTS.coral[lv][0] + (byLevel[lv] - autoN) * POINTS.coral[lv][1];
  }
  const procAlgae = algae - netAlgae;
  // The duty machines' leakage past the gate (ENEMY_RINGS_PER_DUTY, with `crossingSec` billing the seconds it
  // costs): rings taken from the opponent's REEF, delivered to this PROCESSOR like any other. They sit outside
  // the timeline because the loop drains this ALLIANCE's own nine rings, and the gate is what mostly prevents
  // the trip. `donated` is the other half of the trade — the G418 a route past their CAGEs brings them.
  //
  // And in a mirror the trip is not a gain. The planner can see the other side's ROBOTs but not its plan, so
  // the assumption it has to work on is that the same duty sits over there too, in which case every ring this
  // fleet carries home is a ring the other fleet takes off this REEF. The engine measures it: three machines
  // on duty on BOTH sides book the same 9.00 ALGAE an ALLIANCE as a fleet told never to cross, so the
  // crossing moves the ALGAE around and loses a little of it to the drive. `opts.mirror: false` is the
  // one-sided reading the A/B arms use, where only this ALLIANCE is told to strip.
  const lost = opts.mirror === false ? 0 : crosses;
  const gifted = Math.max(0, procAlgae + crosses - lost);
  const donated = crosses * CROSS_FOUL_PTS;
  const algaePoints = gifted * POINTS.algae.processor[1] + netAlgae * POINTS.algae.net[1];
  const bargePoints = climbed.deep * POINTS.cageDeep + climbed.shallow * POINTS.cageShallow + climbed.park * POINTS.park;
  const leave = ctx.profiles.length * POINTS.leave;
  // The Ranking Points a plan banks (§6.6, Table 6-2). AUTO needs every ROBOT to LEAVE and at least one AUTO
  // CORAL; `leave` above already assumes the crossing, so this turns on the AUTO routine placing a piece, and
  // in a live estimate AUTO is history and the term is the same for every candidate. CORAL is 7 on each of the
  // four levels, relaxed to three levels once BOTH PROCESSORS hold 2 ALGAE (§6.5.3) — a one-sided model cannot
  // see the other ALLIANCE's bin, so it assumes the mirror and the caller can say otherwise with `opts.coop`.
  const autoCoral = LEVELS_DESC.reduce((a, lv) => a + auto[lv], 0);
  const coop = opts.coop ?? gifted >= POINTS.coopMinAlgaePerProcessor;
  const levelsFull = LEVELS_DESC.filter((lv) => byLevel[lv] >= POINTS.coralRpThresholdPerLevel).length;
  const rp = {
    auto: autoCoral >= POINTS.autoRpMinCoral ? POINTS.rp.auto : 0,
    coral: (coop ? levelsFull >= POINTS.coralRpLevelsWithCoop : levelsFull >= LEVELS_DESC.length) ? POINTS.rp.coral : 0,
    barge: bargePoints >= POINTS.bargeRpThreshold ? POINTS.rp.barge : 0,
  };
  return {
    byLevel,
    coral: LEVELS_DESC.reduce((a, lv) => a + byLevel[lv], 0),
    coralPoints,
    algae: gifted + netAlgae,
    netAlgae,
    algaeCrossed: crosses,
    donated,
    algaePoints,
    // The ALGAE this ALLIANCE processed is then thrown by the OPPONENT's HUMAN PLAYER into their NET
    // (§5.5, §6.1), so the margin figure is what two plans should be compared on, not the 6 — and a ring a
    // ROBOT lifted into its own NET is not handed to anybody, so only the processed count pays that discount.
    algaeMargin: algaePoints - gifted * POINTS.algae.net[1] * ctx.hpAccuracy,
    leave,
    barge: climbed,
    bargePoints,
    rp,
    total: coralPoints + algaePoints + leave + bargePoints,
  };
}

// What the planner compares two candidate plans on, and what `npm run fastsim` orders them on, so the two
// cannot drift apart. It is a MARGIN rather than a score: the ALGAE this ALLIANCE processes is thrown into the
// opponent's NET by their HUMAN PLAYER, and the fouls a crossing donates never appear on the score sheet this
// estimate reads.
//
// The Ranking Points are computed above and reported, but deliberately NOT added to the ranking. Over 32
// candidate spaces (every roster the page can pick, at the straight-line and at the fitted efficiency, with
// the clock at the whistle, 60 s, 110 s and 132 s) pricing a bonus at 8 points of margin — a third of a MATCH
// win, which is what Table 6-2 says one RP buys — changed the chosen plan in none of them. In
// REEFSCAPE the bonuses move with the points that earn them: 16 BARGE points are the BARGE RP, and 7 CORAL on
// a level is both a level's worth of score and a step toward the CORAL RP. A second coefficient there would
// be a preference, not information.
export function planValue(est) {
  return est.coralPoints + est.algaeMargin + est.bargePoints - est.donated;
}

export const DEFAULT_PLAN = {
  placeOrder: ['L4', 'L3', 'L2', 'L1'],
  climbWindowSec: 20,
  bands: null,
  algaeSlots: null,
};

// The action space the planner searches, which is the headroom `npm run headroom` found and nothing more:
// the commit time moves the score by points, the level order by a little, and a hard division of labour
// moves it the WRONG way, so bands are not offered as candidates.
export function planCandidates(opts = {}) {
  const orders = opts.orders ?? [['L4', 'L3', 'L2', 'L1'], ['L3', 'L4', 'L2', 'L1'], ['L2', 'L3', 'L4', 'L1']];
  const windows = opts.windows ?? [4, 6, 8, 10, 12, 16, 20, 26];
  const duties = opts.duties ?? [[], [2], [1, 2], [0, 1, 2]];
  const spreads = opts.spreads ?? [false, true];
  const out = [];
  for (const placeOrder of orders) {
    for (const climbWindowSec of windows) {
      for (const algaeSlots of duties) {
        for (const spread of spreads) {
          out.push({ placeOrder, climbWindowSec, algaeSlots: algaeSlots.length ? algaeSlots : null, bands: null, spread });
        }
      }
    }
  }
  return out;
}
