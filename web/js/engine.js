// REEFSCAPE tick simulator: 0.1 s kinematics, game-piece inventory, branch placement, scoring and fouls.
//
// Two rules of this repo's own making, inherited from REBUILT because they each burned a wrong number:
//
//   - ALLIANCES ARE SERVED ALTERNATELY. Blue's ROBOTS are built first, so a plain
//     `for (const rb of robots)` lets blue win every contested pickup. The acting order flips every tick
//     and again on the decision clock.
//   - EVERY CONSTANT IS EITHER A CLAUSE OR AN ESTIMATE. Rules come from rules.js; anything else is
//     labelled `[estimate]` where it is defined, and Stage 3 calibrates those against real 2025 MATCHes.

import { TIME, POINTS, PIECES, FOULS, GEO, FIELD, ROBOT_LIMITS, NET_LANES, NET_CAPACITY } from './rules.js';
import { layout, emptyReef, coralMarks, reefAlgae, defaultScenario, BRANCH_SLOTS_PER_LEVEL, reefGeometry, CAGE_ROBOT_CAPACITY, HUMAN_PLAYER, CHASSIS, scaleProfile } from './model.js';

export const INTENT = {
  FETCH_CORAL: 'fetch-coral',
  STRIP_ALGAE: 'strip-algae',
  PLACE: 'place',
  PROCESS: 'process',
  SCORE_NET: 'score-net',
  CLIMB: 'climb',
  DEFEND: 'defend',
  IDLE: 'idle',
};

export const LEVELS = ['L1', 'L2', 'L3', 'L4'];
const TICK = 0.1;
const DECIDE_EVERY = 2; // written to be a 0.2 s pass like the 2026 engine; the parity below makes it every tick
const TICKS = Math.round(TIME.matchSec / TICK);

// Same generator as the REBUILT build so a seed means the same stream of numbers in both games.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hypot = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Oriented footprints. A ROBOT is the square R104's 120 in perimeter allows (30 in a side), and once
// it has a front that front matters twice: a CORAL is launched from the bumpers (G412) and an ALGAE has
// to go through a 28 in opening in the guardrail (§5.5). So heading is its own state, integrated under
// the drivetrain's turn rate, and contact between two of them is a separating-axis test rather than a
// centre distance. Testing only the centre distance let two ROBOTs turned 45° to each other share an
// 11 in corner overlap, and testing only the world axes let a turned pair drive straight through each
// other, so all four of their own axes get tested.
// ---------------------------------------------------------------------------
const DEG = Math.PI / 180;
// FRC BUMPERS are foam over plywood: they absorb almost all of a hit. `[estimate]`, and the knob the
// A/B is measured against (`scenario.contactRestitution = -1` removes the impulse entirely).
const CONTACT_RESTITUTION = 0.12;
// How square a ROBOT has to be to its work. A CORAL is launched from the BUMPERS into a branch (G412)
// and an ALGAE is pushed through a 28 in opening (§5.5), so both are done from the face, not from any
// angle. 45° is the wide end of that: a driver lines the car up on the branch rather than threading it.
const FACE_TOL_DEG = 45;

// ---------------------------------------------------------------------------
// §7.4.4 Opponent interaction: G422 / G423 / G424, judged together on one collision.
//
// The manual is explicit that these need more than contact. G423's own note: "FIRST Robotics Competition
// can be a full-contact competition and may include rigorous game play", and G424: "tipping as an
// unintended consequence of normal ROBOT to ROBOT interaction, including single BUMPER to BUMPER hits that
// result in a ROBOT tipping, is not a violation of this rule." So an ordinary bump is legal play, and a
// call needs damage or functional impairment (G423) or a DELIBERATE tip (G424). G422 needs "a COMPONENT
// outside its ROBOT PERIMETER (except its BUMPERS)", which this build does not have — every machine is the
// 30 in box R104 allows, so G422 can never be committed and rules.js marks it `block`.
//
// §7.4.4's opening note makes the three mutually exclusive: "A single ROBOT to ROBOT interaction which
// violates more than 1 of these rules results in the most punitive penalty, and only the most punitive
// penalty, being assessed." One adjudication per collision, one code.
//
// `[estimate]` There are no mechanisms to break, so "damage" is an impulse the victim cannot absorb: the
// closing speed on the tick the BUMPERS first overlap, scaled by how much heavier the rammer is. Measured with
// `npm run contact`: two mirror greedy fleets almost never touch (2 logged collisions in 48 MATCHes, because
// each alliance works its own REEF), so the sample these thresholds are placed against is one that fields a
// defender — 2,316 collisions over 48 MATCHes, median 30-35, p90 104, p95 127-134, p99 174-194, max 261. The
// floor sits at the p90 so "a hard hit" means a hit in the tail rather than every bump, and the chance that a
// tail hit breaks something ramps from there; the tip floor is the p99 and "unable to drive" is beyond it.
// No real-world anchor for the probability itself, which is what makes the family a scenario switch
// (`contactFouls`) with an off value. `[estimate]` the ceiling is 0.04, and it is set low on purpose: a break
// is what takes a machine off the FIELD (the victim at 0 speed for 20 s, the rammer on a RED that ends its
// MATCH), and `npm run contact` reads 0.15 as 0.38 §7.4.4 calls a MATCH against a pressed fleet with 0.29 at
// 0.04 and 0.17 at 0.02. The press's take goes with it (7.25 → 5.79 off the opponent on the 21000 base), which
// is the honest price of not breaking things — the machine it was pressing is still driving.
const CONTACT_HIT_SEVERITY = 100;
const CONTACT_IMPAIR_RAMP = 500;
const CONTACT_MAX_IMPAIR_P = 0.04;
// G424 is the deliberate one: "A ROBOT may not deliberately, attach to, tip, or entangle with an opponent
// ROBOT." Pressing an opponent is not tipping it, so a tip needs the deliberate hit to also be in the
// extreme tail of the measured distribution — p99 of the defender sample.
const CONTACT_TIP_SEVERITY = 180;
// "Unable to drive" means that because of the incident, the DRIVER can no longer drive to a desired
// location in a reasonable time (generally)" — the manual's own ~20+ s, so that is the severe outcome. The
// milder one (a bent module, a stuck relay) is a machine that still plays, slower.
const CONTACT_UNABLE_SEVERITY = 190;
const CONTACT_IMPAIR_SEC = 20;
const CONTACT_IMPAIR_MINOR_SEC = 15;
const CONTACT_IMPAIR_FACTOR = 0.7;
// G421's own clock: MINOR, "and for every 3 seconds in which the situation is not corrected, a MAJOR FOUL
// is assessed" — the same 3-count G425 uses for a PIN.
const G421_REPEAT_SEC = 3;
// How long a pair has to be apart before a new touch is a new engagement. Two 30 in boxes that are pressed
// together rattle: they lose overlap for a tick and regain it, and a transition test alone turns one
// engagement into ten calls. The manual's own PIN criteria end a count on a 6 ft separation, which in this
// engine is about a second of real gap, so 1 s is the hysteresis. `[estimate]`
const CONTACT_ENGAGEMENT_SEC = 1;
// Where a defender stands to press an opponent: its own half-footprint, theirs, and 8 in of carpet. The gap
// is not politeness — G427 charges a MAJOR FOUL for contacting an opponent inside ITS OWN REEF ZONE or
// BARGE ZONE "regardless of who initiates", so a defender that closes the last 8 in at the opponent's REEF
// is paying 6 points every cooldown for the privilege, which is exactly the calculation a 2025 drive team
// made at their driver meet.
const DEFEND_STANDOFF_IN = 8;
// A press in this engine takes tempo away through CONTACT, and that is modelled as measured rather than as
// wished. A work-time penalty on the pressed machine (0.45 on the pick and the placement) moved its column by
// nothing — 30.9 → 31.4 CORAL placed over 16 seeds with §7.4.4 switched off — because a fleet with slack in its
// clock absorbs a slower pick. Denying the SOURCE outright cost 0.6 CORAL a MATCH with three machines parked on
// it, and denying the MACHINE instead of the point froze one opponent at 62% of its placements, which is a
// stopped game rather than a defended one. `npm run measure` prices the collision, and the AI's press price is
// read off that.
export { CONTACT_UNABLE_SEVERITY, CONTACT_HIT_SEVERITY, CONTACT_IMPAIR_SEC };

// Signed smallest difference between two bearings in degrees, in (-180, 180].
export function angleDeltaDeg(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}
export const bearingDeg = (dx, dy) => Math.atan2(dy, dx) / DEG;

export const footprintHalf = (rb) => rb.footprintHalfIn || ROBOT_LIMITS.footprintHalfIn;

// Where a ROBOT stands to lift an ALGAE into its own NET: beside the mesh and over its 12 ft border
// (§5.4.2), not under it — G420 forbids contacting the NET, and §6.5.1 only counts a ring that is not
// touching a ROBOT of that ALLIANCE. The stand-off is the same construction as a BRANCH: half the goal,
// half the car, 2 in of slack. `lane` picks which 4 ft square of the 12 ft face it stands at, because at one
// stand-off the three machines of an ALLIANCE queued bumper-to-bumper on the middle of the mesh. Exported so
// a policy bids the point the engine will drive to.
export function netDeposit(geo, side, half, lane = (NET_LANES - 1) / 2) {
  const net = geo[side].net;
  const outward = Math.sign(net.x - geo.midX) || 1;
  return {
    x: net.x + outward * (net.w / 2 + half + 2),
    y: net.y + (lane - (NET_LANES - 1) / 2) * (net.d / NET_LANES),
  };
}

// Rings per lane still to give, or all zeros once the mesh is full. A lane the ROBOT prefers is only a
// preference: when its own patch is packed the deposit moves to the nearest one that is not, which is what
// keeps a 9-ring NET from being a three-ring NET with two idle stand-offs.
function netLaneRoom(net, perLane) {
  return net.lanes.map((n) => Math.max(0, perLane - n));
}

export const netCapacityOf = (scenario) => scenario.netCapacity ?? NET_CAPACITY;
export const netLaneCapacity = (scenario) => Math.ceil(netCapacityOf(scenario) / NET_LANES);

// Which patch of mesh this machine should use, or null when the whole face is full.
export function netLaneFor(st, side, prefer, y) {
  const per = netLaneCapacity(st.scenario);
  const room = netLaneRoom(st.net[side], per);
  if (room[prefer] > 0) return prefer;
  const net = st.geo[side].net;
  let best = null;
  for (let i = 0; i < NET_LANES; i++) {
    if (!room[i]) continue;
    const dy = Math.abs(net.y + (i - (NET_LANES - 1) / 2) * (net.d / NET_LANES) - y);
    if (best === null || dy < best.dy) best = { i, dy };
  }
  return best ? best.i : null;
}

// The stand-off this ROBOT will actually be driven to, or null when it cannot lift (no elevator) or its NET
// is full. Shared by the move and the observation so the two can never disagree about where the point is.
// The lane is still what the ring is billed against with `netLaneSpread: false` — that ablation moves the
// stand-off back to the middle of the face, which is the pre-#117 behaviour, not the bookkeeping.
export function netDepositFor(st, rb) {
  if (!rb.profile.netScoreSec) return null;
  const lane = netLaneFor(st, rb.side, rb.slot % NET_LANES, rb.y);
  if (lane === null) return null;
  const at = st.scenario.netLaneSpread === false ? (NET_LANES - 1) / 2 : lane;
  return { ...netDeposit(st.geo, rb.side, footprintHalf(rb), at), lane };
}

// Projected half-width of a square of half-width h onto a world axis: the two edge directions each
// contribute their own half-extent times the cosine of the angle to that axis.
function projectHalf(h, headingDeg, ux, uy) {
  const c = Math.cos(headingDeg * DEG);
  const s = Math.sin(headingDeg * DEG);
  return h * (Math.abs(ux * c + uy * s) + Math.abs(ux * -s + uy * c));
}

// Shallowest penetration between two oriented squares, as the world axis it is measured along pointing
// from `a` to `b`, or null when they are apart.
export function squareContact(a, b) {
  const ha = footprintHalf(a);
  const hb = footprintHalf(b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) > (ha + hb) * 1.4143) return null; // circumscribed-circle broad phase
  const ax = [a.heading, a.heading + 90, b.heading, b.heading + 90];
  let best = null;
  for (const deg of ax) {
    const ux = Math.cos(deg * DEG);
    const uy = Math.sin(deg * DEG);
    const overlap = projectHalf(ha, a.heading, ux, uy) + projectHalf(hb, b.heading, ux, uy) - Math.abs(dx * ux + dy * uy);
    if (overlap <= 0) return null;
    if (!best || overlap < best.pen) {
      const s = dx * ux + dy * uy >= 0 ? 1 : -1;
      best = { pen: overlap, ux: ux * s, uy: uy * s };
    }
  }
  return best;
}

// The REEF is a regular hexagon (§5.3: 65 in across flats), not a circle. Its support along any axis is
// the farthest of its six vertices, and the vertices sit at apothem / cos 30° on 30°, 90°, ... — i.e. a
// FLAT faces the ALLIANCE WALL (Figure 5-4) — the same layout `branchSlots` puts its faces on, so a ROBOT
// that cuts the corner of a reef hits structure where the real one does.
function hexSupport(apothem, ux, uy) {
  const rv = apothem / Math.cos(Math.PI / 6);
  let m = -Infinity;
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    m = Math.max(m, ux * Math.cos(a) + uy * Math.sin(a));
  }
  return rv * m;
}

// How deep a ROBOT's oriented square sits inside one REEF's hexagon, along the shallowest axis that
// still overlaps, or 0 when they are clear. Both bodies are centrally symmetric, so the three REEF face
// normals (0°, 60°, 120°) and the two ROBOT axes are the whole test.
export function reefPenetration(reef, rb) {
  const dx = rb.x - reef.x;
  const dy = rb.y - reef.y;
  const axes = [0, 60, 120, rb.heading, rb.heading + 90];
  let best = null;
  for (const deg of axes) {
    const ux = Math.cos(deg * DEG);
    const uy = Math.sin(deg * DEG);
    const pen = hexSupport(reef.apothem, ux, uy) + projectHalf(footprintHalf(rb), rb.heading, ux, uy) - Math.abs(dx * ux + dy * uy);
    if (pen <= 0) return null;
    if (!best || pen < best.pen) {
      const s = dx * ux + dy * uy >= 0 ? 1 : -1;
      best = { pen, ux: ux * s, uy: uy * s };
    }
  }
  return best;
}

// Push a ROBOT out of both REEFs. The opponent's REEF is tested too: a machine can end up on that side
// of the field (the rules make it a foul there rather than impossible), and it is still solid structure.
function reefResolve(st, rb) {
  for (const side of ['blue', 'red']) {
    const hit = reefPenetration(st.geo[side].reef, rb);
    if (!hit) continue;
    rb.x += hit.ux * hit.pen;
    rb.y += hit.uy * hit.pen;
  }
}

// How much room a ROBOT leaves itself when it is steered around a REEF, in inches beyond the hexagon's corner
// plus the car's own half. `[estimate]` — the manual has nothing to say about a berth. Swept by
// `npm run measure` at 2, 4, 8 and 14 in: at the gate below all four read the same pinned-and-blocked share, so
// the width is not what the cure turns on, and 8 in is kept as the middle of that range — wide enough that the
// hexagon's corner and the car's own footprint both clear the tangent line the machine is asked to follow.
const REEF_PASS_CLEAR_IN = 8;

// How long a machine has to be pressing before the swing is worth its distance, and how little it has to have
// closed in that time to count as pressing. Both `[estimate]` and both swept by `npm run measure`: diverting
// every trip a hexagon stands in (0 s) cures the stuck machines and takes a couple of CORAL an ALLIANCE off the
// named presets' ledger column, because a fleet working its own REEF has structure on the line almost always;
// 0.6 s reads the same cure and leaves that column where the record has it. 1.5 in over that window is under
// 2.5 in/s of closing, which is a machine against the structure rather than one driving to it.
const REEF_PRESS_SEC = 0.6;
const REEF_PRESS_IN = 1.5;

// Which REEF, if any, is between this ROBOT and the point it is driving to, tested against the same hexagon
// `reefResolve` collides with. Only the part of the line that can reach the structure is sampled: the hexagon
// plus a car's footprint fits inside a disc, so the chord the line cuts through that disc is the whole search
// interval — usually a couple of samples, and none at all on the clear majority of trips. The waypoint itself
// is never a candidate: a BRANCH stand-off sits outside the structure on purpose, and treating the machine's
// own target as the obstacle is how it would never arrive.
export function reefBetween(st, rb, tgt) {
  const vx = tgt.x - rb.x;
  const vy = tgt.y - rb.y;
  const len = Math.hypot(vx, vy);
  if (len < 1) return null;
  const ux = vx / len;
  const uy = vy / len;
  const nx = -uy;
  const ny = ux;
  const half = footprintHalf(rb);
  const probe = { x: 0, y: 0, heading: rb.heading, footprintHalfIn: half };
  for (const side of ['blue', 'red']) {
    const reef = st.geo[side].reef;
    const r = reef.apothem / Math.cos(Math.PI / 6) + half * 1.5;
    const wx = reef.x - rb.x;
    const wy = reef.y - rb.y;
    const lat = wx * nx + wy * ny;
    if (Math.abs(lat) >= r) continue;
    const along = wx * ux + wy * uy;
    const chord = Math.sqrt(r * r - lat * lat);
    const t0 = Math.max(0, along - chord);
    const t1 = Math.min(len, along + chord);
    if (t1 <= t0) continue;
    const steps = Math.max(2, Math.ceil((t1 - t0) / 10));
    for (let i = 0; i <= steps; i++) {
      const f = (t0 + (t1 - t0) * (i / steps)) / len;
      if (f > 0.98) break;
      probe.x = rb.x + vx * f;
      probe.y = rb.y + vy * f;
      if (reefPenetration(reef, probe)) return reef;
    }
  }
  return null;
}

// Steer around the hexagon instead of into it. A driver does not park against a REEF face and wait for the
// waypoint to move: it slides along the structure to the next face. This takes the straight line to the
// waypoint, finds where the REEF centre sits along it, and asks to be driven to that abeam point pushed off
// the line, past the structure on the side it is not on. Recomputed every tick, so the waypoint walks around
// the hexagon with the ROBOT and the direct line is taken again the moment it clears. Deterministic, and it
// only ever changes a heading, never a decision.
export function reefDetour(st, rb, tgt) {
  const reef = reefBetween(st, rb, tgt);
  if (!reef) return tgt;
  const vx = tgt.x - rb.x;
  const vy = tgt.y - rb.y;
  const len = Math.hypot(vx, vy);
  if (len < 40) return tgt; // a shuffle to the next branch is not a trip worth swinging 70 in around
  const ux = vx / len;
  const uy = vy / len;
  const nx = -uy;
  const ny = ux; // the left of the travel direction
  const wx = reef.x - rb.x;
  const wy = reef.y - rb.y;
  const along = wx * ux + wy * uy;
  const sideLat = wx * nx + wy * ny; // where the REEF sits relative to the line, + is left
  const r = reef.apothem / Math.cos(Math.PI / 6) + footprintHalf(rb) + (st.scenario.detourClearIn ?? REEF_PASS_CLEAR_IN);
  // Aim at the abeam point pushed to the side the REEF is NOT on, far enough that the hexagon and the car's
  // own footprint both clear. Recomputed each tick, so this walks the ROBOT along the structure's face.
  const s = sideLat >= 0 ? -1 : 1;
  const push = r - Math.abs(sideLat);
  const half = footprintHalf(rb);
  return {
    x: clamp(rb.x + ux * along + nx * s * push, half, FIELD.longIn - half),
    y: clamp(rb.y + uy * along + ny * s * push, half, FIELD.wideIn - half),
  };
}

// When to go around. A hexagon between the machine and its waypoint is not by itself a reason to swing 60 in
// wide: most of those trips the car resolves by pressing the near face and sliding off it under `reefResolve`,
// and diverting all of them costs the fleet two CORAL an ALLIANCE (`npm run measure` reads it on the named
// presets at every berth width, because the price is the engagement, not the width). The swing is for the
// machine that pressed and stayed pressed — the same REEF_PRESS_SEC of not closing on the same waypoint the
// pile-up escape tests for, only shorter, so it goes around before it ever reaches the 3 s the stall test
// counts. `detourPressSec: 0` is the ungated arm, and the sweep is what picked 0.6.
function reefPress(st, rb, tgt, dist) {
  const pressSec = st.scenario.detourPressSec ?? REEF_PRESS_SEC;
  const blocked = !!tgt && dist > 22 && reefBetween(st, rb, tgt);
  if (pressSec <= 0) return blocked;
  if (blocked) {
    if (rb.pressSince === null) {
      rb.pressSince = st.t;
      rb.pressFrom = dist;
    } else if (st.t - rb.pressSince >= pressSec) {
      if (rb.pressFrom - dist < REEF_PRESS_IN) rb.press = true;
      else {
        rb.pressSince = st.t;
        rb.pressFrom = dist;
      }
    }
  } else {
    rb.pressSince = null;
    rb.press = false;
  }
  return rb.press;
}

// The same DESIGN is not the same MACHINE. One MATCH, one tempo factor per ROBOT: everything that takes
// time stretches by it and everything that covers ground shrinks by it, so a 6% slower robot is a robot
// that is 6% slower, not a robot with one slow action. Reliability is left alone — a FUMBLE is already a
// per-event draw. `spread` 0 is the identity, which is what the guard pins the old fingerprint to.
export function jitterProfile(p, rng, spread) {
  // carried into the results table, so a MATCH where one side came out slower shows why
  return scaleProfile(p, 1 + (rng() * 2 - 1) * spread);
}

export function makeAlliance(profiles, side, geo) {
  return profiles.map((p, slot) => {
    const start = geo[side].robotStart[slot] || geo[side].robotStart[0];
    return {
      slot,
      side,
      team: p.team,
      name: p.name,
      profile: p,
      x: start.x,
      y: start.y,
      heading: side === 'blue' ? 0 : 180,
      turnVel: 0, // deg/s of the chassis spinning in place: real state, bled off under angular accel
      faceDeg: null, // which way the bumpers must point while this ROBOT works, or null for travel
      vx: 0,
      vy: 0,
      contacts: [], // who this ROBOT's footprint is actually overlapping on this tick
      cageTouch: false, // inside a CAGE's 7 in of pipe on the previous tick: one G418 per engagement, not per 1.5 s
      coral: p.preload === false ? 0 : 1, // §6.3.4.1 B: up to 1 CORAL preloaded per ROBOT
      algae: 0,
      busy: null,
      disabled: false,
      left: false,
      climb: null,
      climbCage: null,
      pinWith: null,
      pinSince: null,
      contactSince: null,
      defending: null, // the opponent SLOT this ROBOT is pressuring, or null: §7.4.4's "deliberately" test
      impair: null, // { left, speed } — the physical half of a G423/G424 call: a bent machine, not a rule state
      yellow: 0, // §6.6.2: a second YELLOW CARD in the same MATCH is converted to a RED
      contactFouls: 0, // how many times this ROBOT has been called under §7.4.4 (G424's CONTINUOUS test)
      g421At: null, // when this ROBOT's breach of the one-defender limit was last charged
      acrossSince: null, // when its whole footprint cleared the BARGE ZONE band on the opponent's side
      stallSince: null, // the pile-up test in stepRobot: when this leg started and how far the waypoint was
      stallFrom: 0,
      pressSince: null, // #124's shorter version of the same test, run only while a REEF is on the line
      pressFrom: 0,
      press: false, // latched once the machine is found to be pressing against the structure: go around
      branch: null, // { lv, idx, t }: the branch this machine is driving a CORAL to, so an ally aims another pipe
      lastDecideT: 0, // the clock of the last decision, so the one after it knows how much time it covered
      unstickUntil: 0,
      stats: {
        placed: { L1: 0, L2: 0, L3: 0, L4: 0 },
        dropped: 0,
        carryDropped: 0, // shaken loose by the drive itself, not by a missed placement
        dropsAt: { L1: 0, L2: 0, L3: 0, L4: 0 }, // per level, because giving up on L4 is a different call from giving up on the trough
        processor: 0,
        netScored: 0,
        picked: 0,
        strips: 0,
        // how many seconds this machine spent pressuring an opponent, and how many of them it actually
        // reached one: without it the DEFEND A/B can only report the score, not what was given up to move it
        defendSec: 0,
        blockSec: 0,
        climbLevel: null,
        slips: 0, // #127: climb attempts that did not stick, counted so the endgame column can be read apart from the clock
        fouls: {},
        // #129 bookkeeping: where each piece came from, what the machine spent its seconds and its inches
        // on, and the two ways a cycle ends with nothing in hand. None of it is a frame key, an event or a
        // random draw, so the fingerprint ladder in scripts/invariants.mjs holds every arm it held before
        // these lines existed — the recorded MATCHes replay identical with these counting.
        pickedFrom: { station: 0, theirStation: 0, mark: 0, dropped: 0 },
        strippedFrom: { reef: 0, mark: 0, dropped: 0 }, // the ring came off a BRANCH, off a MARK, or off the carpet
        pickMisses: 0, // a grab that finished and the piece was already gone, or the corner was empty
        heldSec: 0, // seconds spent within reach of a piece it could not get to, driving alongside it
        // Two different failures, because they are two different fixes. `fullSec` is a level that filled and
        // the fleet kept aiming at it — a routing problem, priced in seconds. `fullMiss` is an arm that
        // finished and found the branch it drove to gone — a booking race, priced in actions.
        fullSec: { L1: 0, L2: 0, L3: 0, L4: 0 },
        fullMiss: { L1: 0, L2: 0, L3: 0, L4: 0 },
        busySec: { 'fetch-coral': 0, 'strip-algae': 0, place: 0, process: 0, 'score-net': 0, climb: 0, defend: 0 },
        movedIn: { 'fetch-coral': 0, 'strip-algae': 0, place: 0, process: 0, 'score-net': 0, climb: 0, defend: 0, idle: 0 },
        distance: 0,
      },
    };
  });
}

function makeState({ blueProfiles, redProfiles, scenario: raw }) {
  // The panel and the measurement scripts both override one HUMAN PLAYER field at a time, so a partial
  // block is completed here rather than at every call site: a missing key on the untouched side would
  // only surface as a TypeError on the first ALGAE through a PROCESSOR.
  const hp = raw.humanPlayer || {};
  const scenario = {
    ...raw,
    humanPlayer: {
      blue: { ...HUMAN_PLAYER, ...(hp.blue || {}) },
      red: { ...HUMAN_PLAYER, ...(hp.red || {}) },
    },
  };
  const geo = layout();
  const rng = makeRng(scenario.seed);
  const reef = { blue: emptyReef(), red: emptyReef() };
  const placedPeriod = { blue: {}, red: {} };
  for (const side of ['blue', 'red']) {
    for (const lv of ['L2', 'L3', 'L4']) placedPeriod[side][lv] = new Array(BRANCH_SLOTS_PER_LEVEL).fill(null);
    placedPeriod[side].trough = [];
  }
  // Floor CORAL: the 6 CORAL MARKS for the MATCH, 3 per ALLIANCE (§6.3.4.1 A: "1 CORAL is staged on
  // each CORAL MARK (6 total...)"). The rest of the 126 sit behind the
  // CORAL STATIONS (§6.3.4.1 C) and enter through the chute, so they are a queue, not a scatter.
  const floor = [];
  for (const side of ['blue', 'red']) {
    // `rot` is only for the replay: a CORAL is an 11 in pipe, so it lies some way, and the marks are
    // staged across their own axis (§6.3.4.1 A). `from` is only for the ledger: it tells the pick site
    // that this piece was put on the FIELD by the staging, not dropped there by a missed placement.
    coralMarks(geo, side).forEach((m, i) => floor.push({ kind: 'coral', x: m.x, y: m.y, side, taken: false, rot: i * 60, from: 'mark' }));
  }
  // ALGAE: §6.3.4.2 stages 18 for the MATCH, 6 on each REEF in three two-piece positions (A) and 1 on
  // top of the CORAL at each CORAL MARK (B), so an ALLIANCE has 9 pieces it can take off its own REEF
  // and the other 9 belong to the opponent.
  const algaeReef = { blue: [], red: [] };
  for (const side of ['blue', 'red']) {
    for (const p of reefAlgae(geo, side)) algaeReef[side].push({ x: p.x, y: p.y, taken: false, where: 'reef' });
    for (const m of coralMarks(geo, side)) algaeReef[side].push({ x: m.x, y: m.y, taken: false, where: 'mark' });
  }
  const stations = { blue: [], red: [] };
  for (const side of ['blue', 'red']) {
    // §6.3.4.1 accounts for every one of the 126 CORAL: 1 on each of the 6 CORAL MARKS, up to 1 preloaded
    // per ROBOT, and "remaining CORAL are split evenly behind each CORAL STATION (57 to 60 per ALLIANCE,
    // depending on how many are preloaded in ROBOTS)". The old arm drew 57-60 at random and still preloaded
    // all three machines, which staged up to 132 pieces — so the remainder is derived, not rolled:
    // 63 per ALLIANCE half minus its 3 mark CORAL minus what its own ROBOTS are already holding.
    const preloaded = (side === 'blue' ? blueProfiles : redProfiles).filter((p) => p.preload !== false).length;
    const total = PIECES.coral.stagedPerMatch / 2 - PIECES.coral.onMarks / 2 - preloaded;
    // Split so the two stations sum to `total` exactly: rounding each half up staged 58 where the
    // arithmetic says 57, and 57+57+6+6 = 126 is the whole point of deriving it.
    const halves = [Math.ceil(total / 2), Math.floor(total / 2)];
    geo[side].coralStations.forEach((s, i) => stations[side].push({ x: s.x, y: s.y, remaining: halves[i], feedReadyAt: 0 }));
  }
  // `[estimate]` Each ALLIANCE fields its own three machines and has its own HUMAN PLAYER on the NET:
  // drawn per slot from the MATCH stream, in slot order, so it is reproducible but not the same draw on
  // both sides. Without this a mirror MATCH is one deterministic process played twice.
  const robots = { blue: makeAlliance(blueProfiles, 'blue', geo), red: makeAlliance(redProfiles, 'red', geo) };
  const spread = scenario.tempoJitter ?? 0;
  if (spread > 0) {
    for (const side of ['blue', 'red']) {
      for (const rb of robots[side]) rb.profile = jitterProfile(rb.profile, rng, spread);
      const hp = scenario.humanPlayer[side];
      hp.accuracy = clamp(hp.accuracy * (1 + (rng() * 2 - 1) * spread), 0, 1);
    }
  }
  return {
    geo,
    slots: reefGeometry(geo),
    rng,
    scenario,
    reef,
    placedPeriod,
    floor,
    algaeReef,
    stations,
    processor: { blue: { auto: 0, tele: 0 }, red: { auto: 0, tele: 0 } },
    net: { blue: { count: 0, readyAt: 0, byRobot: 0, lanes: new Array(NET_LANES).fill(0) }, red: { count: 0, readyAt: 0, byRobot: 0, lanes: new Array(NET_LANES).fill(0) } },
    // §5.5 + §6.1: ALGAE that goes through a PROCESSOR lands in the OPPONENT's PROCESSOR AREA, and that
    // is what that side's HUMAN PLAYER throws into its own NET. So hpQueue[blue] is blue's HP's supply,
    // fed by red's robots. hpOverflow counts what arrived while the area was already at the G435 limit.
    hpQueue: { blue: 0, red: 0 },
    hpOverflow: { blue: 0, red: 0 },
    robots,
    events: [],
    fouls: { blue: { minor: 0, major: 0, points: 0, byRobot: {} }, red: { minor: 0, major: 0, points: 0, byRobot: {} } },
    // G410 / G418 / G428 give the opposing ALLIANCE a Ranking Point outright; scoreSide reads this.
    rpAward: { blue: { coral: false, barge: false }, red: { coral: false, barge: false } },
    // Robots committed to each CAGE (climbing or already hung), so a third one cannot join a 7 in pipe.
    cageClaim: { blue: [0, 0, 0], red: [0, 0, 0] },
    // CORAL picks and how many of them began with a teammate already bound for the same corner. The spread
    // rule in `policy.js` is priced on this, and the planner reads it live rather than assuming the fleet is
    // crowded. See SPREAD_SEC in `fastsim.js`.
    contest: { blue: { picks: 0, contested: 0 }, red: { picks: 0, contested: 0 } },
    // #126: how many 0.1 s decisions two allies of one ALLIANCE aimed the SAME branch on the same level, and how
    // many stretches of that happened. The claim is `rb.branch`; without a count the only way to see the jostle
    // is to record 750 frames per MATCH, which `npm run measure` cannot afford for every arm.
    branchShare: { blue: { dup: 0, episodes: 0, was: false }, red: { dup: 0, episodes: 0, was: false } },
    // The two deny actions, counted where they happen: a CORAL taken out of the OPPONENT's STATION, and an
    // ALGAE stripped off their REEF. Both are legal and both are invisible in the score column — the piece
    // simply never arrives in their ledger — so without this the page cannot say whether the option was ever
    // taken, which is the question `npm run measure`'s deny arms answer by ablation.
    deny: { blue: { station: 0, theirAlgae: 0 }, red: { station: 0, theirAlgae: 0 } },
    // The tick each PAIR last had overlapping footprints. See CONTACT_ENGAGEMENT_SEC.
    inContact: new Map(),
    // Every collision's severity, logged before the damage roll and regardless of its outcome. This is the
    // sample `npm run contact` reads to place CONTACT_HIT_SEVERITY at the 90th percentile of the
    // distribution the engine actually produces, rather than at a number copied from the 2026 build.
    contactHits: [],
  };
}

export function periodAt(t) {
  return t < TIME.autoSec ? 'AUTO' : 'TELEOP';
}

// §6.5 A: "assessment of CORAL scored on the REEF and ALGAE scored in the PROCESSOR or NET continues for up
// to 3 seconds after the ARENA timer displays 0:00 following AUTO", and §6.4 calls the same thing "a 3-second
// delay between AUTO and TELEOP for scoring purposes". The engine stamps the period when the action
// COMPLETES, so without this a CORAL pushed onto a branch at 15.4 s of a cycle that began before the whistle
// pays 5 instead of 7. Requiring the action to have BEGUN before 0:00 is what keeps a fast TELEOP cycle from
// being paid as AUTO: the window extends the assessment of what was already in progress, not the AUTO clock.
// PROCESSOR and NET pay the same in both periods (Table 6-2: 6/6 and 4/4), so the window only moves them
// between ledger columns; the CORAL levels are the ones worth points.
function inAuto(st, rb) {
  if (st.t < TIME.autoSec) return true;
  if (st.t > TIME.autoSec + TIME.assessGraceSec) return false;
  return !rb.busy || st.t - rb.busy.t < TIME.autoSec;
}

function freeSlots(st, side, lv) {
  if (lv === 'L1') return st.reef[side].trough.cap - st.reef[side].trough.count;
  return st.reef[side][lv].filter((x) => !x).length;
}

// Which branch a CORAL goes onto is chosen by proximity, so the drive to an open slot is part of the
// cycle cost. §5.3: six faces, two pipes per face 13 in apart, one branch of each level per pipe.
function freeSlotNear(st, side, lv, x, y, avoid) {
  if (lv === 'L1') return st.reef[side].trough.count < st.reef[side].trough.cap ? -1 : null;
  const slots = st.reef[side][lv];
  const pos = st.slots[side];
  let best = null;
  let bestD = Infinity;
  let any = null;
  let anyD = Infinity;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) continue;
    const d = hypot(x, y, pos[i].x, pos[i].y);
    // The fallback is the nearest free branch whether or not an ally is aimed at it. Every branch of the
    // level being claimed is a full REEF, and a machine that refuses to place there stops scoring.
    if (d < anyD) { anyD = d; any = i; }
    if (avoid && avoid.has(i)) continue;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best === null ? any : best;
}

// Which branches of this level another machine of the same ALLIANCE is already driving to. The engine books a
// branch only when the placement completes, so without this the three machines bid the same nearest free pipe
// from wherever they came off the STATION; `npm run verify` prints how many ROBOT-seconds an ALLIANCE-MATCH goes
// to that duplicate claim with the ablation on and off. The one that lost the race had to re-aim. A machine that
// has already been aimed at a branch keeps it against a machine that decided later, which is what stops the pair
// from trading places every 0.1 s; the tie is broken by SLOT so it is still one decision, not a coin.
// `branchDedup: false` is the ablation.
function branchAvoid(st, rb, lv, prior) {
  if (lv === 'L1' || st.scenario.branchDedup === false) return null;
  const out = new Set();
  for (const o of st.robots[rb.side]) {
    if (o.slot === rb.slot || o.coral < 1) continue;
    if (o.busy && o.busy.kind === INTENT.PLACE && o.busy.level === lv && o.busy.idx >= 0) {
      out.add(o.busy.idx);
      continue;
    }
    const c = o.branch;
    if (!c || c.lv !== lv || c.idx === null) continue;
    if (c.t < prior || (c.t === prior && o.slot < rb.slot)) out.add(c.idx);
  }
  return out;
}

// One count per decision tick, and every tick of this engine is a decision tick (see the loop above), so the clock
// is 0.1 s. `dup` is allies BEYOND the first on a branch, which makes `dup × 0.1` ROBOT-seconds of an ALLIANCE-MATCH
// aimed at a pipe somebody else had claimed first — not wall-clock seconds of the MATCH being stacked. `episodes`
// counts the stretches that began.
function countBranchShare(st) {
  for (const side of ['blue', 'red']) {
    const b = st.branchShare[side];
    const seen = new Set();
    let dup = 0;
    for (const rb of st.robots[side]) {
      const c = rb.branch;
      if (!c || c.idx === null || rb.coral < 1) continue;
      const key = `${c.lv}:${c.idx}`;
      if (seen.has(key)) dup += 1;
      else seen.add(key);
    }
    b.dup += dup;
    if (dup && !b.was) b.episodes += 1;
    b.was = dup > 0;
  }
}

function placeCoral(st, rb, lv, idx, aimErr) {
  const side = rb.side;
  const auto = inAuto(st, rb);
  if (lv === 'L1') {
    const tr = st.reef[side].trough;
    if (tr.count >= tr.cap) return false;
    tr.count += 1;
    st.placedPeriod[side].trough.push(auto ? 'A' : 'T');
  } else {
    const slots = st.reef[side][lv];
    let i = idx;
    if (i === undefined || i === null || i < 0 || slots[i]) {
      i = freeSlotNear(st, side, lv, rb.x, rb.y);
      if (i === null) return false;
    }
    slots[i] = true;
    st.placedPeriod[side][lv][i] = auto ? 'A' : 'T';
  }
  rb.coral -= 1;
  rb.stats.placed[lv] += 1;
  st.events.push({ t: st.t, kind: 'place', side, slot: rb.slot, level: lv, auto, aimErr: Math.round(aimErr || 0) });
  return true;
}

function stepRobot(st, rb, dt) {
  // The §7.4.4 impairment is a physical state with a clock on it, not a referee decision: the machine is
  // still on the carpet, still scoring, just slower. It ticks down even while the ROBOT is hung or disabled,
  // so a call at the whistle cannot outlast the MATCH.
  if (rb.impair) {
    rb.impair.left -= dt;
    if (rb.impair.left <= 0) rb.impair = null;
  }
  if (rb.disabled || rb.climb) return; // a hung ROBOT is on a CAGE above the carpet, not driving
  const p = rb.profile;
  const im = rb.impair ? rb.impair.speed : 1;
  const ch = CHASSIS[p.chassis] || CHASSIS.swerve;
  const target = rb.busy ? rb.busy.at : rb.target;
  // A ROBOT that is working, or holding a face, is already at its element and moving a few inches; sending it
  // around the REEF at that moment would be steering it away from the thing it is doing. Long trips only, and
  // only while it is not facing anything: the detour is a routing change, not a new decision.
  const rawDist = target ? Math.hypot(target.x - rb.x, target.y - rb.y) : 0;
  // The press clock is a property of ONE drive leg. A machine that reached an element and worked it has not
  // been pressing against the REEF, and one that has just been shoved off a face has: without this the latch
  // of the leg before the placement would hand the next trip its swing on the first blocked tick, and the
  // 0.6 s gate would only be a gate on the first trip of the MATCH.
  if (!target || rb.busy || rb.faceDeg !== null || st.scenario.detourOff) { rb.pressSince = null; rb.press = false; }
  const around = !!target && !rb.busy && rb.faceDeg === null && !st.scenario.detourOff && reefPress(st, rb, target, rawDist);
  rb.press = around; // the frames report the trips this engine actually routed around, ungated arm included
  const aim = around ? reefDetour(st, rb, target) : target;
  const dx = aim ? aim.x - rb.x : 0;
  const dy = aim ? aim.y - rb.y : 0;
  const dist = Math.hypot(dx, dy);
  // Closed loop: a drivetrain brakes into its waypoint instead of arriving at full speed and ringing
  // around it. sqrt(2 a d) is the exact stopping distance for the profile's acceleration.
  const desired = dist > 0.05 ? Math.min(p.driveSpeedIps * im, Math.sqrt(2 * p.accelIpsS * im * dist)) : 0;

  // ---- heading, turned first, because a chassis that cannot strafe gets its velocity FROM its heading
  const travelDeg = dist > 1 ? bearingDeg(dx, dy) : null;
  const canStrafe = ch.lateral > 0;
  // A working ROBOT keeps its face on the element: G412 launches a CORAL from the BUMPERS inside the
  // REEF ZONE and §5.5 puts an ALGAE through a 28 in opening in the guardrail, so it does not reverse
  // its way in. Any other trip more than 90° off the heading backs up instead of spending half a second
  // turning around, which is the honest cost of a drivetrain with no sideways motion.
  const reversing = !canStrafe && rb.faceDeg === null && travelDeg !== null && Math.abs(angleDeltaDeg(travelDeg, rb.heading)) > 90;
  const headTarget = rb.faceDeg !== null ? rb.faceDeg : reversing ? travelDeg + 180 : travelDeg;
  if (headTarget !== null) {
    const speed = Math.hypot(rb.vx, rb.vy);
    const speedFrac = Math.min(1, speed / Math.max(40, p.driveSpeedIps));
    // Turning at speed costs traction and the chassis says how much: a swerve's modules steer on their
    // own and barely notice, a tank drive has to scrub both sides.
    const turnRate = p.turnRateDegS * im * (1 - (1 - ch.turnAtSpeed) * speedFrac);
    const delta = angleDeltaDeg(headTarget, rb.heading);
    // `turnRampOff: true` restores the old one-tick snap, so the ramp is measured against a control.
    if (st.scenario.turnRampOff) {
      rb.heading += clamp(delta, -turnRate * dt, turnRate * dt);
      rb.turnVel = 0;
    } else {
      // The peak rate is a ceiling, not a step. `brake` is the spin rate that can still be brought to
      // zero inside the angle that is left, which is what stops the ramp from ringing past its target.
      // The ramp is derived from the rate the chassis is currently allowed, so editing `turn deg/s` in
      // the panel moves the spin-up with it instead of leaving a stale second number behind.
      const accel = turnRate / (ch.turnRampSec || 0.3);
      const brake = Math.sqrt(2 * accel * Math.abs(delta));
      const cmd = clamp(delta, -Math.min(turnRate, brake) * dt, Math.min(turnRate, brake) * dt) / dt;
      rb.turnVel += clamp(cmd - rb.turnVel, -accel * dt, accel * dt);
      rb.heading += rb.turnVel * dt;
    }
    if (rb.heading > 180) rb.heading -= 360;
    else if (rb.heading <= -180) rb.heading += 360;
  } else if (rb.turnVel !== 0) {
    // No heading to hold: the spin still has to be bled off instead of vanishing.
    const accel = p.turnRateDegS / (ch.turnRampSec || 0.3);
    rb.turnVel -= clamp(rb.turnVel, -accel * dt, accel * dt);
  }

  // ---- velocity, through the chassis: the wanted velocity is split into the heading frame, and what
  // the drivetrain can do with those two halves IS the difference between a swerve and a tank.
  const cosH = Math.cos(rb.heading * DEG);
  const sinH = Math.sin(rb.heading * DEG);
  let fwd = 0;
  let lat = 0;
  if (desired > 0) {
    const ux = dx / dist;
    const uy = dy / dist;
    fwd = (ux * cosH + uy * sinH) * desired;
    lat = (ux * -sinH + uy * cosH) * desired * ch.lateral;
    if (fwd < 0) fwd *= ch.reverse;
  }
  const maxDelta = p.accelIpsS * im * dt;
  const vx0 = rb.vx;
  const vy0 = rb.vy;
  rb.vx += clamp(fwd * cosH - lat * sinH - rb.vx, -maxDelta, maxDelta);
  rb.vy += clamp(fwd * sinH + lat * cosH - rb.vy, -maxDelta, maxDelta);
  const px0 = rb.x;
  const py0 = rb.y;
  rb.x += rb.vx * dt;
  rb.y += rb.vy * dt;

  // The REEF is solid hexagonal structure (§5.3) and the guardrail is the field edge. The BARGE truss
  // stands 5 ft 2 in up (§5.4) against R104's 3 ft 6 in ROBOT, so it is driven under, not around.
  const half = footprintHalf(rb);
  for (let pass = 0; pass < 2; pass++) {
    rb.x = clamp(rb.x, half, FIELD.longIn - half);
    rb.y = clamp(rb.y, half, FIELD.wideIn - half);
    reefResolve(st, rb);
  }
  // Inches are measured after the structure has had its say, so a machine pinned against the REEF accrues
  // nothing — which is the point of the column. They are charged to the action it is performing (a busy
  // ROBOT is working an element, not driving), and that is what makes "96 ft going and coming back for
  // CORAL" readable apart from "14 ft of it while pinned".
  const moved = Math.hypot(rb.x - px0, rb.y - py0);
  if (moved > 0) {
    const leg = rb.busy ? rb.busy.kind : rb.intent || 'idle';
    rb.stats.distance += moved;
    rb.stats.movedIn[leg] = (rb.stats.movedIn[leg] || 0) + moved;
  }

  // A CORAL held against a REEF branch, or out on a field where the driver is standing on the throttle, comes
  // loose. The trigger is the acceleration the drivetrain actually got this tick, not the speed it is carrying:
  // a machine pinned against the separation solver accelerates hard and moves nowhere, and that is exactly the
  // shudder that shakes a piece out. `carryDrop` is the per-second rate at full throttle, `[estimate]` because
  // §6.5 charges a CORAL that falls without ever saying how it came to fall, and 0 spends no random number at
  // all, which is what makes the off value a control rather than a different roll order.
  if (rb.coral > 0 && !rb.busy && st.scenario.carryDrop > 0) {
    const throttle = Math.hypot(rb.vx - vx0, rb.vy - vy0) / Math.max(maxDelta, 1e-9);
    if (throttle > 0.85 && st.rng() < st.scenario.carryDrop * dt) {
      rb.coral -= 1;
      rb.stats.carryDropped += 1;
      dropHere(st, rb, 'coral');
      st.events.push({ t: st.t, kind: 'carry-drop', side: rb.side, slot: rb.slot, x: Math.round(rb.x), y: Math.round(rb.y) });
    }
  }

  // `[estimate]` A CORAL STATION sits in the corner where the ALLIANCE WALL meets the guardrail, three ROBOTS
  // can want the same one, and a corner pile-up does not untangle itself: without an escape an ALLIANCE can
  // spend the rest of its MATCH pressed against its own station — 4 of 96 seeds finished with one side at
  // 11-23 CORAL while its opponent filled all 60, a 130-point mirror gap no 2025 field produced, and the
  // deterministic mirror only tied on 4 seeds of 48 because of it. The test is three seconds of being told to
  // go and closing less than 4 in on the waypoint, which is that pile-up and not a turn or an approach: a
  // speed test alone never fires, because a pinned machine oscillates against the separation solver at 5 in/s
  // while its position does not change. What a driver does then is back out and re-decide, so this reverses
  // along its own heading for 0.6 s and the next decision is taken from somewhere else.
  if (dist > 22 && rb.faceDeg === null && !rb.busy && !st.scenario.unstickOff) {
    if (rb.stallSince === null) {
      rb.stallSince = st.t;
      rb.stallFrom = dist;
    } else if (st.t - rb.stallSince >= 3) {
      if (rb.stallFrom - dist < 4) {
        rb.stallSince = null;
        rb.unstickUntil = st.t + 0.6;
        rb.target = { x: rb.x - cosH * 26, y: rb.y - sinH * 26 };
        st.events.push({ t: st.t, kind: 'unstick', side: rb.side, slot: rb.slot });
      } else {
        rb.stallSince = st.t;
        rb.stallFrom = dist;
      }
    }
  } else {
    rb.stallSince = null;
  }

  // §6.5.2: LEAVE is its BUMPERS no longer overlapping the line, so the whole 30 in footprint has to be
  // clear of it — and the clause names no direction, so backing off toward the ALLIANCE WALL counts the
  // same as driving out toward the BARGE. G303-D starts the ROBOT straddling the line, which is what makes
  // this a test of the footprint rather than of a crossing.
  const line = st.geo[rb.side].startingLineX;
  const crossed = Math.abs(rb.x - line) > half;
  if (crossed && !rb.left) {
    rb.left = true;
    st.events.push({ t: st.t, kind: 'leave', side: rb.side, slot: rb.slot });
  }
}

// One pass over the six pairs of ROBOTS, positions first and then velocities. `close` is the rate the
// gap closes along the contact normal, read before anything is modified, because it is both the impulse
// the bumpers absorb and the impact speed the contact rules are judged on.
function contactPass(st) {
  const all = [...st.robots.blue, ...st.robots.red];
  for (const rb of all) rb.contacts.length = 0;
  const now = new Map();
  const pairs = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (a.disabled || b.disabled) continue;
      const hit = squareContact(a, b);
      if (!hit) continue;
      const close = hit.ux * (a.vx - b.vx) + hit.uy * (a.vy - b.vy);
      const key = `${a.side}${a.slot}|${b.side}${b.slot}`;
      const last = st.inContact.get(key);
      const first = last === undefined || st.t - last > CONTACT_ENGAGEMENT_SEC;
      a.contacts.push({ other: b, pen: hit.pen, ux: hit.ux, uy: hit.uy, close, first });
      b.contacts.push({ other: a, pen: hit.pen, ux: -hit.ux, uy: -hit.uy, close, first });
      now.set(key, st.t);
      // §7.4.4 is judged here, on the tick the footprints first meet, because that is the only tick where
      // `close` is still the impact speed rather than what is left of it after the positional sweep.
      // A ROBOT already hung on a CAGE is above the carpet and protected by G428 instead.
      if (a.side !== b.side && first && !a.climb && !b.climb) adjudicateContact(st, a, b, close);
      // A ROBOT hanging on a CAGE is not shoved around by whoever bumps into it, and two partners
      // staging on the same pipe are climbing one 3-D structure, so in this top-down view they overlap
      // rather than shove each other off the base. Without that, a three-ROBOT climb becomes a shoving
      // match at the CAGE.
      const working = (r) => (r.busy && r.busy.kind === INTENT.CLIMB) || r.climb;
      if (working(a) || working(b)) continue;
      pairs.push([a, b]);
    }
  }
  st.inContact = now;
  // Position first, and iteratively. Two things have to be settled together: a ROBOT pair that overlaps,
  // and a ROBOT that the pair resolution just shoved into the REEF. One pass leaves 12 in of a 30 in car
  // inside its partner and up to 10 in inside the hexagon, which reads as machines driving through each
  // other and through the structure. Each sweep re-tests, so the residual falls by ~60% a pass.
  for (let sweep = 0; sweep < 5; sweep++) {
    let any = false;
    for (const [a, b] of pairs) {
      const hit = squareContact(a, b);
      if (!hit) continue;
      any = true;
      const sum = a.profile.weightLb + b.profile.weightLb;
      const share = hit.pen * (sweep === 4 ? 1 : 0.6);
      a.x -= hit.ux * share * (b.profile.weightLb / sum);
      a.y -= hit.uy * share * (b.profile.weightLb / sum);
      b.x += hit.ux * share * (a.profile.weightLb / sum);
      b.y += hit.uy * share * (a.profile.weightLb / sum);
    }
    for (const rb of all) {
      if (rb.climb) continue; // a hung ROBOT is above the carpet, wherever the cage is
      reefResolve(st, rb);
      const half = footprintHalf(rb);
      rb.x = clamp(rb.x, half, FIELD.longIn - half);
      rb.y = clamp(rb.y, half, FIELD.wideIn - half);
    }
    if (!any) break;
  }
  // Then the velocity exchange, on the closing rate read above. Bumper contact has to bounce, because
  // position correction alone leaves two ROBOTS that meet head-on driving into each other while they
  // crawl apart. The split conserves momentum exactly (ma*dv_a + mb*dv_b = 0).
  const rest = st.scenario.contactRestitution ?? CONTACT_RESTITUTION;
  if (rest <= -1) return;
  for (const [a, b] of pairs) {
    for (const hit of a.contacts) {
      if (hit.other !== b || hit.close <= 0) continue;
      const sum = a.profile.weightLb + b.profile.weightLb;
      const imp = hit.close * (1 + rest);
      a.vx -= hit.ux * imp * (b.profile.weightLb / sum);
      a.vy -= hit.uy * imp * (b.profile.weightLb / sum);
      b.vx += hit.ux * imp * (a.profile.weightLb / sum);
      b.vy += hit.uy * imp * (a.profile.weightLb / sum);
      break;
    }
  }
}

// One collision, one call, per §7.4.4: "G422, G423, G424 are mutually exclusive. A single ROBOT to ROBOT
// interaction which violates more than 1 of these rules results in the most punitive penalty, and only the
// most punitive penalty, being assessed." `close` is the rate the gap closed along the contact normal on the
// tick the footprints first met, so whoever was moving towards the other is the rammer — the manual's own
// test, "for the purposes of this rule, initiating contact requires movement towards an opponent ROBOT".
function adjudicateContact(st, a, b, close) {
  const sc = st.scenario;
  if (!sc.contactFouls) return;
  const rammer = close >= 0 ? a : b;
  const victim = rammer === a ? b : a;
  const severity = Math.abs(close) * (rammer.profile.weightLb / victim.profile.weightLb);
  if (severity <= 0) return;
  // Recorded before the floor and before the roll, so `npm run contact` sees the whole distribution and not
  // just the tail that was called.
  st.contactHits.push(Math.round(severity));
  if (sc.foulsOff) return;
  const floor = sc.contactHitSeverity ?? CONTACT_HIT_SEVERITY;
  if (severity < floor || victim.disabled) return;
  // `deliberate` is the DEFEND flag aimed at THIS opponent: pressuring somebody is what separates
  // "intentionally and/or recklessly" (G423 A) from two machines converging on the same pile, and G424 only
  // exists in the deliberate case, because an unintended tip is explicitly not a violation.
  const deliberate = rammer.defending === victim.slot;
  const tipped = deliberate && severity >= (sc.contactTipSeverity ?? CONTACT_TIP_SEVERITY);
  const p = sc.contactImpairP ?? Math.min(CONTACT_MAX_IMPAIR_P, (severity - floor) / CONTACT_IMPAIR_RAMP);
  // G423 is a damage call, and the manual's own example A assigns "no violation" to a hit where "no damage
  // [is] seen", so the roll has to say something actually failed. A deliberate tip is the violation by
  // itself. With `contactImpairP: 0` no draw is spent at all, which is what keeps the measured distribution
  // a property of the un-impaired MATCH it came from.
  if (!tipped && !(p > 0 && st.rng() < p)) return;
  const code = tipped ? 'G424' : 'G423';
  // Both clauses reach the RED CARD when the opponent is "unable to drive"; G424 also reaches it when the
  // contact is CONTINUOUS, which inside one MATCH is the same ROBOT being called under §7.4.4 again.
  const unable = severity >= (sc.contactUnableSeverity ?? CONTACT_UNABLE_SEVERITY) || (code === 'G424' && rammer.contactFouls > 0);
  // The physical half of the same incident. "Unable to drive" is defined as the DRIVER no longer being able
  // to get the ROBOT where it wants in a reasonable time, which the manual times at ~20+ s; a stopped
  // drivetrain is the mildest model of that that is not also a DISQUALIFICATION, which the RED CARD below
  // already does to the machine that caused it.
  victim.impair = { left: unable ? CONTACT_IMPAIR_SEC : CONTACT_IMPAIR_MINOR_SEC, speed: unable ? 0 : CONTACT_IMPAIR_FACTOR };
  rammer.contactFouls += 1;
  foul(st, rammer, code, { card: unable ? 'RED' : 'YELLOW', victim: `${victim.side === 'blue' ? 'B' : 'R'}${victim.slot + 1}`, severity: Math.round(severity) });
}

// A piece a ROBOT loses has to land where another ROBOT can actually get at it: inside the REEF's
// support polygon it would be unreachable, and one unreachable piece ties up a machine for the rest of
// the MATCH (the 2026 build learned that the hard way). The same clamp serves a fumble and a climb,
// because both put the piece on the carpet at roughly where the car stands.
function dropHere(st, rb, kind) {
  let dx = rb.x + (st.rng() - 0.5) * 30;
  let dy = rb.y + (st.rng() - 0.5) * 30;
  dx = Math.max(20, Math.min(FIELD.longIn - 20, dx));
  dy = Math.max(20, Math.min(FIELD.wideIn - 20, dy));
  for (const s of ['blue', 'red']) {
    const r = st.geo[s].reef;
    const need = r.apothem + ROBOT_LIMITS.footprintIn / 2 + 4;
    const d = hypot(dx, dy, r.x, r.y);
    if (d < need) {
      const k = need / (d || 1);
      dx = r.x + (dx - r.x) * k;
      dy = r.y + (dy - r.y) * k;
    }
  }
  // A CORAL is an 11 in pipe, so it lies some way; an ALGAE is a 16 in ring, so it rolls to a rest.
  // `from` is the ledger tag: a piece that got here by being dropped is not the same as one the staging
  // put down, and the second pick of it is a machine cleaning up after the first.
  st.floor.push({ kind, x: dx, y: dy, side: rb.side, taken: false, rot: Math.round(st.rng() * 180), from: 'drop' });
}

// The chance that a placement does not stay on the REEF, read off the level and off how far off-face the
// car actually was. §6.5.1 is a geometric test — an L2-L4 CORAL is scored only "if the BRANCH is inside the
// volume of the CORAL" — and a BRANCH is a 4 in pipe inside an 11 in one, so the slop is about an inch wide
// and a piece pushed in at an angle does not occupy it. The aim term is quadratic rather than linear because
// what costs accuracy is the lateral offset at the far end of the arm, and that offset grows like the sine of
// the error: an arm 6 ft out at 25° off is 25 in wide of the branch it aimed at, which is not a miss by a
// little, it is a different branch. `placeTolDeg` is where the model says the error has doubled the base
// chance rather than merely added to it.
function placeMissP(rb, b) {
  const p = rb.profile;
  const base = p.placeDrop ? p.placeDrop[b.level] || 0 : 0;
  if (!(base > 0)) return 0;
  const tol = p.placeTolDeg || 26;
  const e = Math.min(1, (b.aimErr || 0) / tol);
  return Math.min(0.95, base * (0.25 + 2.75 * e * e));
}

// A grab is only worked while the ROBOT is beside the piece. Two things used to make a take happen at a
// distance: the timer started at the DECISION (fixed by the same reach test the engine already applies to the
// sources it picks for itself), and once started it kept counting while the machine drove PAST the piece — a
// 150 in/s car with a 1.5 s strip does not stop on a 16 in target, so the replay showed rings changing hands
// 42 in downwind of them. The clock therefore only advances inside one box-length (R104's 30 in plate) of the
// piece, and a machine that cannot get back within the action's own duration gives it up and re-decides. A
// version that cancelled the moment the car drifted out cost 17% of all strip attempts and 9 points a MATCH,
// which is a penalty the driver who overshoots by a foot and a half does not pay.
const GRAB_BREAK_IN = 30;

// Returns true when the tick was consumed by the action (worked or held), so the caller skips the timer.
function stepGrab(st, rb) {
  const b = rb.busy;
  const isGrab = (b.kind === INTENT.FETCH_CORAL || b.kind === INTENT.STRIP_ALGAE) && b.piece;
  if (isGrab && b.at && hypot(rb.x, rb.y, b.at.x, b.at.y) > GRAB_BREAK_IN) {
    b.held = (b.held || 0) + TICK;
    rb.stats.heldSec += TICK;
    if (b.held > b.sec) { rb.busy = null; rb.faceDeg = null; }
    return true;
  }
  b.t += TICK;
  rb.stats.busySec[b.kind] = (rb.stats.busySec[b.kind] || 0) + TICK;
  if (b.t >= b.sec) finishBusy(st, rb);
  return true;
}

function finishBusy(st, rb) {
  const b = rb.busy;
  if (!b) return;
  // NoManipulationIsPerfect: a real 2025 cycle occasionally drops the CORAL, which is the only reason
  // two MATCHes on the same staging score differently. Without this the engine is deterministic and a
  // weight search has no variance to measure, so `reliability` reads straight off the ROBOT profile.
  // A PLACE gets a different number to compare against when the placement model is on, but the same single
  // draw and the same comparison: that is what lets `placementRisk: false` reproduce the replay committed
  // before the model existed, rather than a replay with the same average and a different roll order.
  // A CLIMB gets a third number, and this is where #127 was: the draw always happened and its result was
  // thrown away for a climb, so a CAGE hold could not fail. `climbRisk: false` puts that back on purpose —
  // same single draw, same comparison, so the off value hands back the replay committed before this existed.
  const ok = b.kind === INTENT.PLACE && st.scenario.placementRisk
    ? 1 - placeMissP(rb, b)
    : b.kind === INTENT.CLIMB && st.scenario.climbRisk
      ? rb.profile.climbSuccess ?? 1
      : rb.profile.reliability;
  const flub = st.rng() > ok;
  if (flub && b.kind === INTENT.CLIMB && st.scenario.climbRisk) {
    // The machine loses the pipe and comes down beside it. It keeps the CAGE it claimed and re-decides, which
    // is what a driver does with seconds on the clock; with none left it is a ROBOT inside its own BARGE ZONE
    // and not on a CAGE, and §6.5 reads that as a PARK. Nothing it carries is shaken loose: the piece a
    // successful hang lets go of is let go when the hang happens.
    rb.stats.slips += 1;
    st.events.push({ t: st.t, kind: 'slip', side: rb.side, slot: rb.slot, deep: !!b.deep, cage: b.cage });
    rb.busy = null;
    rb.faceDeg = null;
    return;
  }
  if (flub && b.kind !== INTENT.CLIMB) {
    // A CLIMB that flubbed with the model switched off hangs anyway: that discarding of the draw is what the
    // engine did before #127, and the off value has to keep doing it or the ablation is a re-roll, not a switch.
    if (b.kind === INTENT.PLACE && st.scenario.placementRisk) {
      // A missed placement shakes loose the piece being put away, not the ring in the other hand: G409 lets
      // the ROBOT hold one of each, and the arm that missed is the one that was holding the CORAL.
      if (rb.coral > 0) {
        rb.coral -= 1;
        dropHere(st, rb, 'coral');
      }
      rb.stats.dropped += 1;
      rb.stats.dropsAt[b.level] += 1;
      st.events.push({
        t: st.t, kind: 'drop', side: rb.side, slot: rb.slot, level: b.level,
        aimErr: Math.round(b.aimErr || 0), x: Math.round(rb.x), y: Math.round(rb.y),
      });
      rb.busy = null;
      rb.faceDeg = null;
      return;
    }
    // G409 lets a ROBOT carry a CORAL and an ALGAE at once, so a fumble can put either or both on the
    // carpet. Dropping only the CORAL made loose ALGAE impossible on the field: the ring vanished.
    if (rb.coral > 0) {
      rb.coral -= 1;
      dropHere(st, rb, 'coral');
    }
    if (rb.algae > 0) {
      // Including a PROCESS that flubs at the sill: the ring is what missed, so the ring is what ends up on
      // the carpet. The 6 points are lost with it, and because the STRIP targets read the floor the piece can
      // come back — which is the only reason a loose ALGAE ever exists to be drawn.
      rb.algae -= 1;
      dropHere(st, rb, 'algae');
    }
    st.events.push({ t: st.t, kind: 'fumble', side: rb.side, slot: rb.slot, intent: b.kind });
    rb.busy = null;
    return;
  }
  if (b.kind === INTENT.FETCH_CORAL) {
    if (b.piece) {
      if (!b.piece.taken) {
        b.piece.taken = true;
        rb.coral += 1;
        rb.stats.picked += 1;
        // A MARK piece is one the staging put on the FIELD and nobody has handled; a dropped one is a
        // piece some machine lost, so the second ALLIANCE to pick it up is cleaning up after the first.
        rb.stats.pickedFrom[b.piece.from === 'mark' ? 'mark' : 'dropped'] += 1;
      } else {
        // The grab ran its whole clock and the pipe was not there at the end of it: an ally or an
        // opponent got there first. It costs a cycle and the score does not show either.
        rb.stats.pickMisses += 1;
      }
    } else if (b.stationIdx !== null && b.stationIdx !== undefined) {
      const ss = b.stationSide || rb.side;
      const q = st.stations[ss][b.stationIdx];
      if (q && q.remaining > 0) {
        q.remaining -= 1;
        q.feedReadyAt = st.t + st.scenario.humanPlayer[ss].feedSec; // [estimate] CHUTE feed per station
        rb.coral += 1;
        rb.stats.picked += 1;
        rb.stats.pickedFrom[ss === rb.side ? 'station' : 'theirStation'] += 1;
      } else rb.stats.pickMisses += 1;
    }
  } else if (b.kind === INTENT.STRIP_ALGAE) {
    const a = b.piece;
    if (a && !a.taken) {
      a.taken = true;
      rb.algae += 1;
      rb.stats.strips += 1;
      // `where` is set on the 18 rings the staging put on a REEF or a MARK; a ring with none of those is
      // one that came off a PROCESSOR or a missed placement and is lying on the carpet.
      rb.stats.strippedFrom[a.where === 'reef' ? 'reef' : a.where === 'mark' ? 'mark' : 'dropped'] += 1;
    } else if (a) rb.stats.pickMisses += 1;
  } else if (b.kind === INTENT.PLACE) {
    // The branch it drove to can be gone by the time the arm finishes: an ally booked it, or the whole level
    // filled. The CORAL stays in the hopper and the machine re-decides, and this is the cycle the score
    // never mentions — a full action with nothing to show for it.
    if (!placeCoral(st, rb, b.level, b.idx, b.aimErr)) rb.stats.fullMiss[b.level] += 1;
  } else if (b.kind === INTENT.PROCESS) {
    if (rb.algae > 0) {
      rb.algae -= 1;
      const auto = inAuto(st, rb); // Table 6-2 pays the PROCESSOR 6 in either period; this only moves the column
      st.processor[rb.side][auto ? 'auto' : 'tele'] += 1;
      rb.stats.processor += 1;
      // The 6 points are yours; the ALGAE itself is the opponent's. It rolls out of your PROCESSOR into
      // their PROCESSOR AREA, where their HUMAN PLAYER can throw it into their NET for 4 more (§5.5,
      // §6.1). G435 keeps 4 in that area (3 holders + 1 on the ramp); anything after that has nowhere
      // legal to be stored, and the good-faith exception means it is not automatically a foul, so it is
      // counted as an overflow rather than charged as one.
      const opp = rb.side === 'blue' ? 'red' : 'blue';
      const cap = st.scenario.humanPlayer[opp].storage;
      if (st.hpQueue[opp] < cap) st.hpQueue[opp] += 1;
      else {
        st.hpOverflow[opp] += 1;
        st.events.push({ t: st.t, kind: 'overflow', side: opp });
      }
      st.events.push({ t: st.t, kind: 'processor', side: rb.side, slot: rb.slot });
    }
  } else if (b.kind === INTENT.SCORE_NET) {
    const net = st.net[rb.side];
    // The ceiling is the MESH's, not the patch's. `netDepositFor` refuses a LIFT when the three lanes are full,
    // but a machine that committed while there was room and arrived after the last ring went in has nowhere to
    // put this one: §6.5.1 counts a ring only above and inside the perimeter, so it stays in the hopper and the
    // ALLIANCE processes it. Billing it regardless is what let a nine-ring mesh read eleven in a score while
    // the drawn lanes stopped at nine.
    if (rb.algae > 0 && net.count < netCapacityOf(st.scenario)) {
      rb.algae -= 1;
      net.count += 1;
      net.byRobot += 1;
      // The lane was chosen when the lift started, and two machines can pick the same patch in the same
      // window. A ring that arrives at a patch which filled underneath it is billed to the patch that still
      // has room, because that is where it hangs: keeping `lanes` the same book as `count` is what lets the
      // replay draw every ring the score counts rather than one fewer.
      const aimed = b.at && b.at.lane != null ? b.at.lane : 0;
      const lane = netLaneFor(st, rb.side, aimed, rb.y) ?? aimed;
      net.lanes[lane] += 1;
      rb.stats.netScored += 1;
      // §6.5.1 needs the ring above the mesh, inside its perimeter, and not touching a ROBOT of that
      // ALLIANCE, so the release is the end of the action: the piece is not on the field to be re-taken.
      // `lane` is which patch of mesh holds the ring; `standoffY` is the point the machine was driven to, and
      // the two are not the same book — `netLaneSpread: false` moves the second back to the middle of the face
      // and leaves the first alone.
      st.events.push({ t: st.t, kind: 'net', side: rb.side, slot: rb.slot, by: 'robot', lane, standoffY: b.at && b.at.y != null ? b.at.y : st.geo[rb.side].net.y });
    }
  } else if (b.kind === INTENT.CLIMB) {
    rb.climb = { level: b.deep ? 'deep' : 'shallow', cage: b.cage, at: st.t };
    rb.stats.climbLevel = rb.climb.level;
    // `[estimate]` a ROBOT climbing lets go of what it holds — but it lets go on the carpet, it does not
    // evaporate. Deleting them silently removed up to 6 CORAL and 6 ALGAE an ALLIANCE from the field
    // picture, which is why the replay never showed the pieces a parked machine had been carrying.
    if (rb.coral > 0) { rb.coral -= 1; dropHere(st, rb, 'coral'); }
    if (rb.algae > 0) { rb.algae -= 1; dropHere(st, rb, 'algae'); }
    st.events.push({ t: st.t, kind: 'climb', side: rb.side, slot: rb.slot, level: b.deep ? 'deep' : 'shallow', cage: b.cage });
  }
  rb.busy = null;
  rb.faceDeg = null; // the work is done; nothing to keep the bumper pointed at
}

// The HUMAN PLAYER is a clock and a probability, not a ROBOT: it cannot be positioned, blocked, or
// defended, so it does not need the tick machinery - it needs a rate, an accuracy, and the G404 gate.
// A miss still burns the throw slot (§6.5.1 needs the ALGAE above and inside the NET), which is why
// accuracy multiplies the rate instead of destroying the piece: the HP tries again with the same ALGAE.
function stepHumanPlayer(st, side) {
  if (!st.scenario.algaeInNetByHuman) return; // the ablation: no NET points at all, so the chain has an off value
  const hp = st.scenario.humanPlayer[side];
  const net = st.net[side];
  if (st.t < TIME.autoSec) return; // G404: no ALGAE enters the field during AUTO
  if (net.readyAt > st.t) return;
  if (st.hpQueue[side] <= 0) return;
  // A mesh already holding its rings has nowhere for another one to land, so the HUMAN PLAYER stops throwing
  // rather than spending a slot on a piece that cannot count (§6.5.1 needs it above and inside the perimeter).
  if (net.count >= netCapacityOf(st.scenario)) return;
  net.readyAt = st.t + hp.throwSec; // the attempt costs the slot whether it goes in or not
  if (st.rng() < hp.accuracy) {
    st.hpQueue[side] -= 1;
    net.count += 1;
    let lane = net.lanes.findIndex((n) => n < netLaneCapacity(st.scenario));
    if (lane < 0) lane = NET_LANES - 1; // the machines filled a patch first: bill `count`, which is the gate
    net.lanes[lane] += 1;
    st.events.push({ t: st.t, kind: 'net', side, by: 'hp' });
  } else {
    st.events.push({ t: st.t, kind: 'netMiss', side });
  }
}

function foul(st, rb, code, info) {
  if (st.scenario.foulsOff) return;
  const rule = FOULS.list[code];
  const f = st.fouls[rb.side];
  // G425 is one MINOR and then a MAJOR for every 3 s the PIN is not corrected, so the severity of a
  // repeat is not the severity of the clause. Read before the counter below is bumped: the first
  // charge of a code is the clause's own severity.
  const sev = rule.escalates && rb.stats.fouls[code] ? rule.escalates : rule.sev;
  if (sev === 'minor') f.minor += 1;
  else f.major += 1;
  f.points += sev === 'minor' ? FOULS.minor : FOULS.major;
  f.byRobot[rb.slot] = (f.byRobot[rb.slot] || 0) + 1;
  rb.stats.fouls[code] = (rb.stats.fouls[code] || 0) + 1; // the per-ROBOT column in the results table
  // Three clauses hand the OTHER alliance a Ranking Point outright (G410 CORAL RP, G418/G428 BARGE RP). Only
  // G418 says "if a Qualification MATCH" — G410 and G428 carry no such qualifier — so the gate reads the
  // clause, not the group (`qualOnly`), and a playoff sim still loses the CORAL and BARGE RP to a G410/G428.
  if (rule.awards && !(rule.qualOnly && st.scenario.playoff)) st.rpAward[rb.side === 'blue' ? 'red' : 'blue'][rule.awards] = true;
  // §6.6.2: "YELLOW CARDS are additive, meaning that a second YELLOW CARD is automatically converted to a
  // RED CARD, including earning a second YELLOW CARD during a single MATCH", and a RED CARD DISQUALIFIES the
  // team for the MATCH, which §5 defines as DISABLED: "inoperable for the remainder of the MATCH". So the
  // deterrent the 2026 build had to leave out (there a second card is a tournament-phase matter) is inside a
  // single 2025 MATCH: two broken machines and the rammer sits out the rest of its own game. §6.6.3's
  // playoff rule — cards assigned to the whole ALLIANCE — is tournament bookkeeping and not modelled.
  let card = info?.card || null;
  if (card === 'YELLOW') {
    rb.yellow += 1;
    // The conversion is what makes the second warning a consequence, so it is the one thing
    // `cardLadder: false` removes — the machine keeps its tally of warnings and stays on the carpet.
    if (st.scenario.cardLadder && rb.yellow >= 2) card = 'RED';
  }
  if (card === 'RED') rb.disabled = true;
  // What this build does with a RED CARD is the DISABLED half of §5's definitions — "commanded to deactivate
  // all outputs, rendering the ROBOT inoperable for the remainder of the MATCH". The other half, "a
  // DISQUALIFIED team receives 0 MATCH points and 0 Ranking Points in a Qualification MATCH", is not
  // implemented, and the reason is bookkeeping rather than oversight: the alliance ledger counts what is
  // standing on each BRANCH, on each TROUGH and in each NET, and a CORAL that a rammer placed and a teammate
  // later re-seated is one piece with no owner. Zeroing a team's points would need a per-ROBOT record of the
  // pieces still scored, kept honest through drops, re-scores and de-scoring — which is a new ledger under the
  // eight committed fingerprints, not a clause to switch on. So the price `scripts/cards.mjs` prints is a
  // floor: it is what losing a machine for the rest of the MATCH costs, and a real DQ also takes that team's
  // tally and its RPs off the alliance.
  st.events.push({
    t: st.t, kind: 'foul', side: rb.side, slot: rb.slot, code, sev, card,
    victim: info?.victim || null, severity: info?.severity || null,
    awards: rule.awards || null, x: +rb.x.toFixed(0), y: +rb.y.toFixed(0),
  });
}

// Which of its OWN zones a point falls in (§5 definitions: REEF ZONE, BARGE ZONE). `reach` is how far
// outside the centre the BUMPERS stick: the manual judges these volumes by the bumpers — PARK needs the
// bumpers "partially or completely contained" (§6.5.2) and a zone is entered by the part of the car that
// reaches it — so a 15 in half-footprint is added rather than testing the centre.
function ownZoneAt(st, side, x, y, reach = 0) {
  const rz = st.geo[side].reefZone;
  if (hypot(x, y, rz.x, rz.y) < rz.apothem + reach) return 'reef';
  const bz = st.geo[side].bargeZone;
  if (Math.abs(x - bz.x) < bz.halfX + reach && Math.abs(y - bz.y) < bz.halfY + reach) return 'barge';
  return null;
}

// The nearest point that is NOT inside a side's own zones, measured for a footprint of `reach`, keeping the
// direction the machine came from. A defender parked inside the opponent's REEF ZONE is one touch from a
// G427 MAJOR, and the drive team that keeps pressing there is the one that gets carded — so the stand-off is
// taken to the line instead of over it.
function outsideZones(st, side, p, reach) {
  let q = p;
  const rz = st.geo[side].reefZone;
  const dr = Math.hypot(q.x - rz.x, q.y - rz.y);
  const need = rz.apothem + reach;
  if (dr < need) q = { x: rz.x + ((q.x - rz.x) / (dr || 1)) * need, y: rz.y + ((q.y - rz.y) / (dr || 1)) * need };
  const bz = st.geo[side].bargeZone;
  if (Math.abs(q.x - bz.x) < bz.halfX + reach && Math.abs(q.y - bz.y) < bz.halfY + reach) {
    const push = bz.halfX + reach - Math.abs(q.x - bz.x);
    q = { x: q.x + (q.x >= bz.x ? push : -push), y: q.y };
  }
  return q;
}

// Contact-style fouls are adjudicated on the footprint overlap the physics pass just recorded, each with
// a cooldown so one sustained engagement is one foul rather than ten. G427 and G428 need a SECOND ROBOT:
// the clauses penalize contacting an opponent who is in their zone, not standing in one, which is legal.
function checkFouls(st, rb) {
  const opp = rb.side === 'blue' ? 'red' : 'blue';
  // The DEFEND ledger: how long the machine spent pressuring, and how much of that an opponent was actually
  // in front of it. A measure that reports only the score cannot tell "defending does not pay" apart from
  // "the defender never got there".
  if (rb.defending !== null) {
    rb.stats.defendSec += TICK;
    if (rb.contacts.some((h) => h.other.side === opp && h.other.slot === rb.defending)) rb.stats.blockSec += TICK;
  }
  // One call per engagement, not one per 1.5 s of it. A referee charges "contacting an opponent's CAGE" and
  // ZONE protection once for a collision or a touch-and-go, and the manual's escalation language ("for every
  // 3 seconds in which the situation is not corrected") appears only in the clauses that mean it — G421,
  // G425, G426 — which have their own clocks below. The old fixed 1.5 s cooldown turned one sustained press
  // into 30 MAJOR FOULs a MATCH, which is ten times the foul count any 2025 field produced.
  const half = footprintHalf(rb);
  // A CAGE is contacted when the projected footprint reaches its 7 in of pipe (§5.4.1), which is a few
  // inches less generous than a centre-distance circle and depends on how the ROBOT is turned.
  // The row is on its OWN face of the BARGE, and the truss is not solid in this top-down view, so a machine
  // hugging its own row overlaps the opponent's pipes by a few inches from the wrong side. G418 is charged
  // for contacting their CAGE, which means being on their side of the FIELD to reach it.
  const onTheirSide = rb.side === 'blue' ? rb.x > st.geo.midX : rb.x < st.geo.midX;
  let cageTouched = null;
  if (onTheirSide) {
    for (const c of st.geo[opp].cages) {
      const d = Math.hypot(rb.x - c.x, rb.y - c.y) || 1;
      const ux = (c.x - rb.x) / d;
      const uy = (c.y - rb.y) / d;
      if (d < projectHalf(half, rb.heading, ux, uy) + GEO.cage.widthIn / 2) cageTouched = true;
    }
  }
  // G419/G420 are not modelled: the ANCHORS and the NET both hang above 5 ft (§5.4.1, §5.4.2) and R104
  // caps a ROBOT at 3 ft 6 in, so a ROBOT in the simulation cannot be inside either volume.
  if (cageTouched && !rb.cageTouch) foul(st, rb, st.t < TIME.autoSec ? 'G405' : 'G418');
  rb.cageTouch = !!cageTouched;
  const pastBarge = rb.side === 'blue' ? rb.x > st.geo.midX + GEO.barge.depthIn / 2 : rb.x < st.geo.midX - GEO.barge.depthIn / 2;
  for (const hit of rb.contacts) {
    const o = hit.other;
    if (o.side !== opp || o.disabled) continue;
    const theirZone = ownZoneAt(st, opp, o.x, o.y, footprintHalf(o));
    const myZone = ownZoneAt(st, rb.side, rb.x, rb.y, footprintHalf(rb));
    // G427, whoever initiates. The note under the clause treats two robots that meet while each is in
    // its OWN BARGE ZONE as a foul for both alliances rather than one, and that pairing is the ordinary
    // climbing traffic, so it is left out of the single-sided charge.
    if (theirZone && !(theirZone === 'barge' && myZone === 'barge') && hit.first) foul(st, rb, 'G427');
    // G428: the last 20 s belong to anyone already on a CAGE.
    if (o.climb && hit.first && st.t > TIME.matchSec - TIME.bargeLightsFlashAtSec) foul(st, rb, 'G428');
    // G403: a ROBOT that drove completely across the BARGE ZONE may not touch anyone in AUTO.
    if (st.t < TIME.autoSec && pastBarge && hit.first) foul(st, rb, 'G403');
    // G425: a 3-count on PINs. The clause is about what happens to the OTHER car — "A ROBOT is PINNING if it
    // is preventing the movement of an opponent ROBOT by contact" — so the test reads the victim's speed as
    // well as the closing rate: two machines still driving at each other are a shoving match, a machine that
    // cannot get away is a PIN. The earlier form charged one for any 1 in of overlap at 6 in/s, which turned
    // a held press into 16 MAJOR FOULs a MATCH. The clause's own escalation ("for every 3 seconds in which
    // the situation is not corrected") is the one place where a repeat charge is the rule rather than an
    // artefact of the clock, so it keeps a timer instead of a first-contact gate.
    const pinned = Math.hypot(o.vx, o.vy) < 10;
    const drivingIn = hit.pen > 0.5 && hit.close > 4 && pinned;
    if (drivingIn) {
      if (rb.pinWith !== o.slot) {
        rb.pinWith = o.slot;
        rb.pinSince = st.t;
      } else if (st.t - rb.pinSince > 3) {
        foul(st, rb, 'G425');
        rb.pinSince = st.t;
      }
    } else if (rb.pinWith === o.slot) rb.pinWith = null;
  }
}

// G421 1 defender at a time: "No more than 1 ROBOT may be on the opponent's side of the FIELD (i.e.
// containing the opponent REEF) with its BUMPERS fully outside and beyond the BARGE ZONES." Two conditions, so
// two tests: the centreline decides the side, and the clause's exemption is the two BARGE ZONE rectangles —
// each 3 ft 10 in deep by 12 ft 2½ in long (§5 definitions), which is 293 in of the 317 in field width. A
// machine in the y-gap between them is on the opponent's side and outside both zones, and the earlier version
// of this test exempted the whole `midX ± 46 in` band, which is 97 robot-frames of 18,000 too lenient against
// the 41 it did count. Severity follows the clause: one MINOR, then a MAJOR for every 3 s the situation is not
// corrected (`escalates`). The clause limits the ALLIANCE to one, so which of two machines across counts as
// "the defender" is decided by who got there first; the second one and any after it are the violation.
function checkDefenders(st) {
  for (const side of ['blue', 'red']) {
    const toward = side === 'blue' ? 1 : -1;
    const opp = side === 'blue' ? 'red' : 'blue';
    const zones = [st.geo[side].bargeZone, st.geo[opp].bargeZone];
    const robots = st.robots[side];
    for (const rb of robots) {
      const half = footprintHalf(rb);
      const reachX = projectHalf(half, rb.heading, 1, 0);
      const reachY = projectHalf(half, rb.heading, 0, 1);
      const onTheirSide = toward > 0 ? rb.x > st.geo.midX : rb.x < st.geo.midX;
      const clearOf = (z) => Math.abs(rb.x - z.x) > z.halfX + reachX || Math.abs(rb.y - z.y) > z.halfY + reachY;
      const beyond = rb.disabled || rb.climb ? false : onTheirSide && zones.every(clearOf);
      if (!beyond) {
        rb.acrossSince = null;
        // Leaving the wrong side corrects the situation, so the next excursion starts a fresh MINOR.
        rb.g421At = null;
        continue;
      }
      if (rb.acrossSince === null) rb.acrossSince = st.t;
    }
    const across = robots.filter((rb) => rb.acrossSince !== null).sort((a, b) => a.acrossSince - b.acrossSince);
    for (const rb of across.slice(1)) {
      if (rb.g421At === null || st.t - rb.g421At >= G421_REPEAT_SEC) {
        foul(st, rb, 'G421');
        rb.g421At = st.t;
      }
    }
  }
}

export function makeObs(st, rb) {
  const side = rb.side;
  const opp = side === 'blue' ? 'red' : 'blue';
  const free = { L1: freeSlots(st, side, 'L1'), L2: freeSlots(st, side, 'L2'), L3: freeSlots(st, side, 'L3'), L4: freeSlots(st, side, 'L4') };
  const algaeLeft = st.algaeReef[side].filter((a) => !a.taken).length;
  const floorCoral = [];
  for (const p of st.floor) {
    if (p.taken || p.kind !== 'coral') continue;
    floorCoral.push({ x: p.x, y: p.y, d: hypot(rb.x, rb.y, p.x, p.y), ref: p, side: p.side, enemy: p.side !== side });
  }
  floorCoral.sort((a, b) => a.d - b.d);
  const algae = [];
  // Two things were missing here. A dropped ALGAE lived in `st.floor` and was never a target, so the ring
  // the engine had just released could not be picked up again — it just left the MATCH. And §6.5.1 scores
  // ALGAE by the PROCESSOR and the NET, not by whose REEF it grew on: taking the opponent's ALGAE off their
  // BRANCHES is legal (no clause forbids it, unlike the opponent's CAGES in G418), so both sides' pieces are
  // candidates and the nearest one wins.
  for (const a of st.algaeReef[side]) {
    if (a.taken) continue;
    algae.push({ x: a.x, y: a.y, d: hypot(rb.x, rb.y, a.x, a.y), ref: a });
  }
  for (const a of st.algaeReef[side === 'blue' ? 'red' : 'blue']) {
    if (a.taken) continue;
    algae.push({ x: a.x, y: a.y, d: hypot(rb.x, rb.y, a.x, a.y), ref: a, enemy: true });
  }
  for (const p of st.floor) {
    if (p.taken || p.kind !== 'algae') continue;
    algae.push({ x: p.x, y: p.y, d: hypot(rb.x, rb.y, p.x, p.y), ref: p });
  }
  algae.sort((a, b) => a.d - b.d);
  const stations = st.stations[side].map((q, i) => ({ i, x: q.x, y: q.y, remaining: q.remaining, d: hypot(rb.x, rb.y, q.x, q.y) }));
  // The opponent's two CORAL STATIONS are a source too: no clause reserves them to their own ALLIANCE, and
  // taking a CORAL out of their queue denies it as surely as scoring it. The price is the crossing, and on
  // that half of the FIELD the machine is the one G421 counts and G427 protects the other side's pieces in.
  const enemyStations = st.stations[opp].map((q, i) => ({ i, x: q.x, y: q.y, remaining: q.remaining, d: hypot(rb.x, rb.y, q.x, q.y) }));
  const netPos = netDepositFor(st, rb);
  return {
    t: st.t,
    period: periodAt(st.t),
    side,
    geo: st.geo,
    free,
    algaeLeft,
    // The nine rings on the OPPONENT's REEF. §6.5.1 scores ALGAE by the PROCESSOR and the NET, never by whose
    // REEF it grew on, so these are as available as the ones on its own — and taking them is the one piece of
    // denial in this game that cannot be argued about, because there is no clause about it (unlike their
    // CAGES, which G418 protects).
    enemyAlgaeLeft: st.algaeReef[opp].filter((a) => !a.taken).length,
    coralOnFloor: floorCoral.slice(0, 6),
    algaeNear: algae.slice(0, 4),
    stations,
    enemyStations,
    // How many CORAL this fleet has started picking and how many of those picks began with a teammate already
    // bound for the same corner. The planner prices the station spread on the ratio, so a fleet that is not
    // actually queuing does not get credited for spreading.
    contest: st.contest[side],
    processor: st.geo[side].processor,
    processorCount: st.processor[side].auto + st.processor[side].tele,
    net: st.net[side].count,
    netCapacity: netCapacityOf(st.scenario),
    netByRobot: st.net[side].byRobot,
    // Where this ROBOT would stand to lift an ALGAE into its own NET, or null when its elevator cannot
    // clear the mesh's border (`netScoreSec` 0) or when the mesh is already holding its rings. The lane
    // inside it is the patch of the 12 ft face this machine owns, so the fleet does not queue on one point.
    // Priced, not assumed: §6.1 gives the NET to the ROBOT too.
    netDeposit: netPos ? { x: netPos.x, y: netPos.y, d: hypot(rb.x, rb.y, netPos.x, netPos.y), sec: rb.profile.netScoreSec } : null,
    hpQueue: st.hpQueue[side],
    hpStorage: st.scenario.humanPlayer[side].storage, // G435: the area is full, so more ALGAE has nowhere to go
    // What one ALGAE is worth to THIS ROBOT's margin. Two routes: the piece scores 6 in the processor and
    // then rolls to the opponent's area, where their HUMAN PLAYER converts it into an expected 4 x accuracy
    // for them; or a ROBOT that reaches the mesh banks 4 and hands over nothing (§5.5, §6.1). Whichever this
    // machine can do better is what the strip is worth — a policy that prices algae at 6 over-fishes them.
    algaeMarginValue: Math.max(
      POINTS.algae.processor[1] - POINTS.algae.net[1] * st.scenario.humanPlayer[opp].accuracy,
      netPos ? POINTS.algae.net[1] : 0,
    ),
    // The raw figure the planner needs to price an ALGAE the same way `fastsim.js` does. `algaeMarginValue`
    // is the net number a policy bids with; recovering the accuracy from it would tie the planner to one
    // algebraic route to the same fact.
    hpAccuracy: st.scenario.humanPlayer[opp].accuracy,
    cages: st.geo[side].cages.map((c, i) => ({ i, x: c.x, y: c.y, deep: st.scenario.cageDepth[side][i], d: hypot(rb.x, rb.y, c.x, c.y), used: st.cageClaim[side][i], free: st.cageClaim[side][i] < CAGE_ROBOT_CAPACITY })),
    allies: st.robots[side].map((o) => ({ slot: o.slot, x: o.x, y: o.y, coral: o.coral, algae: o.algae, disabled: o.disabled, busy: o.busy ? o.busy.kind : null, target: o.target ? { x: o.target.x, y: o.target.y } : null, impair: o.impair ? { left: +o.impair.left.toFixed(1), speed: o.impair.speed } : null })),
    // `target` and `busy` are what makes a press a press rather than a chase: the point a defender wants is
    // the one its opponent is driving to, and the engine knows it. `d` is the reach test the policy bids on.
    opponents: st.robots[opp].map((o) => ({ slot: o.slot, x: o.x, y: o.y, coral: o.coral, algae: o.algae, disabled: o.disabled, busy: o.busy ? o.busy.kind : null, defending: o.defending, d: hypot(rb.x, rb.y, o.x, o.y), target: o.target ? { x: o.target.x, y: o.target.y } : null, impair: o.impair ? { left: +o.impair.left.toFixed(1), speed: o.impair.speed } : null })),
    self: { slot: rb.slot, x: rb.x, y: rb.y, coral: rb.coral, algae: rb.algae, busy: rb.busy ? rb.busy.kind : null, climb: rb.climb ? rb.climb.level : null },
  };
}

function scoreSide(st, side) {
  const pp = st.placedPeriod[side];
  const byLevel = {
    L1: { auto: pp.trough.filter((x) => x === 'A').length, tele: pp.trough.filter((x) => x === 'T').length },
    L2: { auto: pp.L2.filter((x) => x === 'A').length, tele: pp.L2.filter((x) => x === 'T').length },
    L3: { auto: pp.L3.filter((x) => x === 'A').length, tele: pp.L3.filter((x) => x === 'T').length },
    L4: { auto: pp.L4.filter((x) => x === 'A').length, tele: pp.L4.filter((x) => x === 'T').length },
  };
  let coralPoints = 0;
  for (const lv of LEVELS) coralPoints += byLevel[lv].auto * POINTS.coral[lv][0] + byLevel[lv].tele * POINTS.coral[lv][1];
  const processor = st.processor[side];
  const algaePoints = processor.auto * POINTS.algae.processor[0] + processor.tele * POINTS.algae.processor[1] + st.net[side].count * POINTS.algae.net[1];
  const robots = st.robots[side];
  const leftCount = st.leftAt ? st.leftAt[side] : robots.filter((r) => r.left).length;
  const leave = leftCount * POINTS.leave;
  let deep = 0;
  let shallow = 0;
  let park = 0;
  for (const r of robots) {
    if (r.climb) (r.climb.level === 'deep' ? (deep += 1) : (shallow += 1));
    else {
      // §6.5.2: PARK is the BUMPERS partially or completely inside the BARGE ZONE, so a car that is only
      // nose-in counts.
      const bz = st.geo[side].bargeZone;
      const reach = footprintHalf(r);
      if (Math.abs(r.x - bz.x) < bz.halfX + reach && Math.abs(r.y - bz.y) < bz.halfY + reach) park += 1;
    }
  }
  const bargePoints = deep * POINTS.cageDeep + shallow * POINTS.cageShallow + park * POINTS.park;
  // §6.5.3: the bonus needs at least 2 ALGAE in EACH ALLIANCE'S PROCESSOR, so it is an AND across both sides,
  // and it opens "In Qualification MATCHES" — a playoff series does not award it, which also means the CORAL
  // RP stays at the four-level bar rather than the relaxed three. And it is a Coopertition POINT (Table 6-2
  // has its own column), which §10.5.3 uses as a tiebreaker — it is not a Ranking Point and must not be
  // summed into rp.
  const coopAlgae = (s) => st.processor[s].auto + st.processor[s].tele;
  const coop = !st.scenario.playoff && coopAlgae('blue') >= POINTS.coopMinAlgaePerProcessor && coopAlgae('red') >= POINTS.coopMinAlgaePerProcessor;
  const coralLevelsFull = LEVELS.filter((lv) => byLevel[lv].auto + byLevel[lv].tele >= POINTS.coralRpThresholdPerLevel);
  const coralRp = (coop ? coralLevelsFull.length >= POINTS.coralRpLevelsWithCoop : coralLevelsFull.length >= LEVELS.length) || st.rpAward[side].coral;
  const autoCoral = LEVELS.reduce((a, lv) => a + byLevel[lv].auto, 0);
  const autoRp = leftCount >= robots.filter((r) => !r.disabled).length && autoCoral >= POINTS.autoRpMinCoral;
  const bargeRp = bargePoints >= POINTS.bargeRpThreshold || st.rpAward[side].barge;
  return {
    contest: st.contest[side], // CORAL picks and how many began with a teammate on the same corner
    deny: st.deny[side], // CORAL taken out of their STATION, ALGAE stripped off their REEF
    coral: byLevel,
    coralPoints,
    algae: { processor: processor.auto + processor.tele, net: st.net[side].count, netByRobot: st.net[side].byRobot },
    algaePoints,
    leave,
    leaveCount: leftCount,
    barge: { deep, shallow, park },
    bargePoints,
    coop,
    coopertition: coop ? POINTS.coopertition : 0,
    total: coralPoints + algaePoints + leave + bargePoints,
    rp: { auto: autoRp ? POINTS.rp.auto : 0, coral: coralRp ? POINTS.rp.coral : 0, barge: bargeRp ? POINTS.rp.barge : 0, win: 0, tie: 0 },
    // Which of the two ways an ALLIANCE leaves with the CORAL or BARGE RP: its own tally, or a MAJOR foul the
    // opponent committed under G410/G418/G428 (§7.4). The bars printed on the page are the same bars either
    // way, so without this the batch's "BARGE RP 62%" cannot be answered with "and 9 points of it were gifts"
    // — and `scripts/rp.mjs` grades every MATCH twice from these flags and the tallies to prove the two paths
    // are not being conflated. Nothing here changes what is scored: it is the same `st.rpAward` the RP above
    // already read, exported.
    rpAward: { coral: !!st.rpAward[side].coral, barge: !!st.rpAward[side].barge },
    autoCoral,
    robots: robots.map((r) => ({
      slot: r.slot, team: r.team, name: r.name, tempo: +(r.profile.tempoFactor ?? 1).toFixed(2),
      placed: r.stats.placed, dropped: r.stats.dropped, carryDropped: r.stats.carryDropped,
      processor: r.stats.processor, netScored: r.stats.netScored, picked: r.stats.picked, strips: r.stats.strips,
      defend: +r.stats.defendSec.toFixed(1), blocked: +r.stats.blockSec.toFixed(1),
      yellow: r.yellow, climb: r.climb ? r.climb.level : null, climbCage: r.climb ? r.climb.cage : null,
      slips: r.stats.slips, left: r.left, disabled: r.disabled, fouls: r.stats.fouls, x: r.x, y: r.y,
      // #129: the cycle ledger. Seconds and feet are rounded here because that is all the page shows and
      // this object is also what the export file writes.
      pickedFrom: r.stats.pickedFrom, strippedFrom: r.stats.strippedFrom, pickMisses: r.stats.pickMisses,
      heldSec: +r.stats.heldSec.toFixed(1), fullMiss: r.stats.fullMiss,
      fullSec: Object.fromEntries(LEVELS.map((lv) => [lv, +r.stats.fullSec[lv].toFixed(1)])),
      busySec: Object.fromEntries(Object.entries(r.stats.busySec).map(([k, v]) => [k, +v.toFixed(1)])),
      movedFt: Object.fromEntries(Object.entries(r.stats.movedIn).map(([k, v]) => [k, +(v / 12).toFixed(1)])),
      droveFt: +(r.stats.distance / 12).toFixed(1),
    })),
  };
}

export function simulateMatch({ blueProfiles, redProfiles, bluePolicy, redPolicy, scenario = defaultScenario(), record = false }) {
  const st = makeState({ blueProfiles, redProfiles, scenario });
  st.t = 0;
  const frames = record ? [] : null;
  let decideFlip = false;
  let lastPeriod = 'AUTO';
  for (let tick = 0; tick < TICKS; tick++) {
    st.t = +(tick * TICK).toFixed(2);
    const period = periodAt(st.t);
    if (period !== lastPeriod) {
      // §6.5.2: LEAVING is judged "at the end of AUTO", not at the end of the MATCH, so the count is
      // frozen on the AUTO -> TELEOP boundary and later driving cannot earn or lose it.
      if (period === 'TELEOP') {
        st.leftAt = {
          blue: st.robots.blue.filter((r) => r.left).length,
          red: st.robots.red.filter((r) => r.left).length,
        };
      }
      for (const side of ['blue', 'red']) {
        for (const rb of st.robots[side]) {
          const pol = side === 'blue' ? bluePolicy : redPolicy;
          if (pol.onPeriodStart) pol.onPeriodStart(period, makeObs(st, rb));
        }
      }
      lastPeriod = period;
    }
    // Serve order flips every tick, so each ALLIANCE gets the first claim on a contested piece half the time.
    // The decision parity below was written to make each ROBOT re-decide every 0.2 s; because `decideFlip` is
    // inverted on the same parity it is compared against, `decideOn` is true on every tick and a machine
    // really does re-decide every 0.1 s. That is the cadence the shipped fingerprints were timed through, so
    // it is left as it is and `applyIntent` measures its seconds off the clock instead of off this line.
    const sides = tick % 2 === 0 ? ['blue', 'red'] : ['red', 'blue'];
    const decideOn = tick % DECIDE_EVERY === (decideFlip ? 1 : 0);
    for (const side of sides) {
      for (const rb of st.robots[side]) {
        const pol = side === 'blue' ? bluePolicy : redPolicy;
        if (rb.busy) {
          stepGrab(st, rb);
          continue;
        }
        if (rb.climb || !decideOn) continue;
        const obs = makeObs(st, rb);
        const want = pol.decide(rb, obs) || { mode: INTENT.IDLE };
        applyIntent(st, rb, want, obs);
      }
    }
    decideFlip = !decideFlip;
    if (decideOn) countBranchShare(st); // before the steering moves anyone, on the claims this decision set
    for (const side of sides) {
      for (const rb of st.robots[side]) stepRobot(st, rb, TICK);
    }
    // Contacts are resolved before the fouls are read: the pair has to be adjudicated on the overlap
    // and the closing rate that actually happened, not on a centre distance.
    contactPass(st);
    for (const side of sides) {
      for (const rb of st.robots[side]) checkFouls(st, rb);
    }
    // Once per tick, not per ROBOT: G421 counts an ALLIANCE's ROBOTS against each other, so it needs the
    // whole fleet's view of who crossed first.
    checkDefenders(st);
    for (const side of sides) stepHumanPlayer(st, side);
    if (record && tick % 2 === 0) frames.push(snapshot(st));
  }
  // §6.5 C: CAGE assessment happens 3 s after the clock hits 0:00, so a robot still on its way to a
  // cage when the whistle goes can finish inside the grace window.
  const graceTicks = Math.round(TIME.cageAssessAfterSec / TICK);
  for (let g = 0; g < graceTicks; g++) {
    st.t = +(TIME.matchSec + g * TICK).toFixed(2);
    for (const side of ['blue', 'red']) {
      for (const rb of st.robots[side]) {
        if (rb.busy) stepGrab(st, rb);
        stepRobot(st, rb, TICK);
      }
    }
    contactPass(st);
    // §6.5 B gives the PROCESSOR and the NET the same 3 seconds as the REEF, so a HUMAN PLAYER whose throw
    // was still queued when the clock hit 0:00 still gets it in. Only the CORAL points differ between the
    // two periods (Table 6-2), which is why the loop above needs inAuto and this one does not.
    for (const side of ['blue', 'red']) stepHumanPlayer(st, side);
  }
  const blue = scoreSide(st, 'blue');
  const red = scoreSide(st, 'red');
  // Every piece the MATCH staged, counted where it ended up. Guard 18 reads this to prove the staging
  // arithmetic closes: §6.3.4 stages 126 CORAL and 18 ALGAE and nothing else exists.
  // ALGAE are counted by where the piece went, and there are two ways to spend one: a ring pushed through a
  // PROCESSOR (6) leaves the field and may earn the opponent 4 more at their NET (§5.5, §6.1), and a ring a
  // ROBOT lifts into its OWN NET (4) is gone without ever reaching a PROCESSOR. So `processed` and
  // `netRobot` are the two consuming columns and `net` counts both feeders of the mesh — adding `net` on
  // top of `processed` would bill the thrown pieces twice, which is why guard 18 sums processed + netRobot.
  const sum = (xs) => xs.reduce((a, x) => a + x, 0);
  const bothSides = (fn) => sum(['blue', 'red'].map(fn));
  const coralScored = bothSides((s) => {
    const f = s === 'blue' ? blue : red;
    return sum(['L1', 'L2', 'L3', 'L4'].map((lv) => f.coral[lv].auto + f.coral[lv].tele));
  });
  const untakenFloor = (kind) => st.floor.filter((p) => !p.taken && p.kind === kind).length;
  const stock = {
    coral: {
      scored: coralScored,
      stations: bothSides((s) => sum(st.stations[s].map((q) => q.remaining))),
      loose: untakenFloor('coral'),
      held: bothSides((s) => sum(st.robots[s].map((rb) => rb.coral))),
    },
    algae: {
      processed: bothSides((s) => (s === 'blue' ? blue : red).algae.processor),
      net: bothSides((s) => (s === 'blue' ? blue : red).algae.net),
      netRobot: bothSides((s) => (s === 'blue' ? blue : red).algae.netByRobot),
      onReef: bothSides((s) => st.algaeReef[s].filter((x) => !x.taken).length),
      loose: untakenFloor('algae'),
      held: bothSides((s) => sum(st.robots[s].map((rb) => rb.algae))),
      inArea: st.hpQueue.blue + st.hpQueue.red,
      overflow: st.hpOverflow.blue + st.hpOverflow.red,
    },
  };
  blue.fouls = st.fouls.red.points; // the opponent's fouls are credited to you (Table 6-3)
  red.fouls = st.fouls.blue.points;
  blue.total += blue.fouls;
  red.total += red.fouls;
  const winner = blue.total === red.total ? null : blue.total > red.total ? 'blue' : 'red';
  if (winner) {
    blue.rp.win = winner === 'blue' ? POINTS.rp.win : 0;
    red.rp.win = winner === 'red' ? POINTS.rp.win : 0;
  } else {
    blue.rp.tie = POINTS.rp.tie;
    red.rp.tie = POINTS.rp.tie;
  }
  // blue.coop / red.coop are already the both-sides condition (§6.5.3), and the Coopertition POINT is
  // reported separately from the RP total, so nothing is added to rp here.
  for (const s of [blue, red]) s.rp.total = s.rp.auto + s.rp.coral + s.rp.barge + s.rp.win + s.rp.tie;
  return {
    final: { blue, red },
    branchShare: st.branchShare,
    stock,
    foulLog: { blue: st.fouls.blue, red: st.fouls.red },
    // Every §7.4.4 candidate collision's severity, in in/s-of-impact scaled by the weight ratio, logged
    // before the damage roll. `npm run contact` places CONTACT_HIT_SEVERITY from this; nothing else reads it.
    contactHits: st.contactHits,
    events: st.events,
    frames,
    scenario,
  };
}

function applyIntent(st, rb, want, obs) {
  // The unstick maneuver owns the steering for its own 0.8 s: a fresh decision issued in the middle of backing
  // out of a pile-up would point the ROBOT straight back at it.
  if (st.t < rb.unstickUntil) return;  const p = rb.profile;
  // How much clock this decision covers, so a seconds column can be timed off the clock rather than off an
  // assumed cadence. `decideOn` reads as if it gated decisions to every 0.2 s, but `decideFlip` is inverted
  // on the same parity it is compared against, so the gate is open on every tick and a decision really does
  // come every TICK. That is recorded here rather than fixed, because the shipped fingerprints are timed
  // through that gate: moving it is an engine change, not a ledger one.
  const sinceLast = st.t - rb.lastDecideT;
  rb.lastDecideT = st.t;
  const mode = want.mode;
  rb.intent = mode || null; // the replay panel shows what each ROBOT decided, not just where it is
  // The facing requirement is cleared every decision and re-armed by the two work modes that need it,
  // so a ROBOT that gives up on a placement does not keep pointing at the branch while it drives away.
  rb.faceDeg = null;
  rb.defending = null; // re-armed below only by a DEFEND decision, so §7.4.4's "deliberate" is never stale
  if (mode !== INTENT.PLACE) rb.branch = null; // a branch claim is only a claim while it is still driving there
  if (mode === INTENT.IDLE || !mode) {
    rb.target = want.target || null;
    return;
  }
  if (mode === INTENT.FETCH_CORAL) {
    if (rb.coral >= 1) return; // G409: one CORAL and one ALGAE at a time
    // A policy that NAMED a STATION gets that STATION, on either side of the FIELD; otherwise the engine
    // takes its own nearest source. The index alone cannot tell the two apart — it means "the corner of its
    // own ALLIANCE" — so the fetch carries the side it belongs to all the way to `finishBusy`.
    const named = want.stationIdx !== null && want.stationIdx !== undefined;
    const pick = named
      ? stationPick(st, rb, want.stationSide || rb.side, want.stationIdx)
      : want.target && want.piece
        ? { x: want.target.x, y: want.target.y, piece: want.piece }
        : nearestCoral(st, rb, obs);
    if (!pick) {
      rb.target = null;
      return;
    }
    if (pick.travelOnly) {
      rb.target = { x: pick.x, y: pick.y };
      return;
    }
    rb.target = { x: pick.x, y: pick.y };
    // A piece is taken where it lies, not where the ROBOT happens to be standing when it decides. The two
    // sources the engine picks for itself already test this (`stationPick` hands back `travelOnly` past 20 in,
    // `nearestCoral` past 22) and the path a POLICY names did not, because that branch trusts the caller and
    // hands the pick straight to `finishBusy`. Measured over 8 MATCHes before the line: 840 picks, the median
    // one 9 in from the source, but 7% of them more than 24 in and the worst 145 in.
    if (hypot(rb.x, rb.y, pick.x, pick.y) > 22) return;
    // Count the pick against the corner it is bound for, and whether a teammate was already heading there.
    // This is the crowding the spread rule trades against, and the planner cannot see it any other way.
    const c = st.contest[rb.side];
    c.picks += 1;
    // What the spread rule trades against: another machine of this fleet already on its way to the same
    // corner FOR A CORAL. 45 in is two 30 in boxes plus room to pass. A machine that has just picked and is
    // carrying is not in the queue, so it does not make the next pick look contested.
    const queued = (o) => o !== rb && o.target
      && hypot(o.target.x, o.target.y, pick.x, pick.y) <= 45
      && (o.busy ? o.busy.kind === INTENT.FETCH_CORAL : !o.coral && o.intent === INTENT.FETCH_CORAL);
    if (st.robots[rb.side].some(queued)) c.contested += 1;
    if (pick.stationSide && pick.stationSide !== rb.side) st.deny[rb.side].station += 1;
    rb.busy = { kind: mode, t: 0, sec: p.pickSec, at: { x: pick.x, y: pick.y }, piece: pick.piece || null, stationIdx: pick.stationIdx ?? null, stationSide: pick.stationSide || rb.side };
    return;
  }
  if (mode === INTENT.STRIP_ALGAE) {
    if (rb.algae >= 1) return; // G409
    // A policy that named the ring gets that ring: the two REEFs' ALGAE are both legal targets and which one
    // is worth crossing for is a tactical call, not something the reach test can decide.
    const a = (want.piece && obs.algaeNear.find((x) => x.ref === want.piece)) || obs.algaeNear[0];
    if (!a) {
      rb.target = null;
      return;
    }
    rb.target = { x: a.x, y: a.y };
    // The ring is taken from the face it rides on. §6.3.4.2 A stages each ALGAE on a pair of BRANCHES, which are
    // 6 in out from a 5 ft 5 in hexagon `reefResolve` refuses to let anything enter, so the closest legal position
    // for a machine is its own half-footprint off that flat — about 9 in from the ring. 16 in is INTENT.PLACE's
    // stand-off for a BRANCH, and the same test applied to the CORAL above: before it, 168 strips over 8 MATCHes
    // completed at a median 48 in from the ring and a worst 173 in, which is a machine on one side of the REEF
    // taking an ALGAE off the other.
    if (hypot(rb.x, rb.y, a.x, a.y) > 16) return;
    if (st.algaeReef[rb.side === 'blue' ? 'red' : 'blue'].includes(a.ref)) st.deny[rb.side].theirAlgae += 1;
    rb.busy = { kind: mode, t: 0, sec: p.algaeStripSec, at: { x: a.x, y: a.y }, piece: a.ref };
    return;
  }
  if (mode === INTENT.PLACE) {
    const lv = want.level || 'L4';
    if (rb.coral < 1) { rb.branch = null; return; }
    // The claim's age is what makes the yield one-way: keep it while this machine still wants the same level,
    // and start a fresh one the moment it switches levels.
    if (!rb.branch || rb.branch.lv !== lv) rb.branch = { lv, idx: null, t: st.t };
    const idx = freeSlotNear(st, rb.side, lv, rb.x, rb.y, branchAvoid(st, rb, lv, rb.branch.t));
    if (idx === null) {
      // The level this machine is holding a CORAL for has no room left, and it will ask again on the next
      // decision having moved nowhere. Priced in the clock the ask actually covered — a routing failure,
      // not a booking race, and the fix is a different level rather than a faster arm.
      rb.stats.fullSec[lv] += sinceLast;
      return; // that level is full; the policy picks another or goes for ALGAE
    }
    rb.branch.idx = idx >= 0 ? idx : null;
    // G412: CORAL may only be launched with the BUMPERS inside the ALLIANCE'S own REEF ZONE. Placement
    // is modelled from the branch itself, so a ROBOT outside the zone steers in rather than fouling.
    const zone = st.geo[rb.side].reefZone;
    const reef = st.geo[rb.side].reef;
    let pos;
    let standOffFrom;
    if (idx === -1) {
      // §5.3: the L1 TROUGH is the opening at the base of the REEF, so unlike a BRANCH it is scored from
      // whichever FACE the ROBOT happens to be standing at. The stand-off is the hexagon's apothem plus the
      // ROBOT's own half-footprint, measured outward toward it. Aim at the REEF CENTRE instead and no ROBOT
      // can ever reach it — reefResolve keeps every ROBOT outside the hexagon, which is why the trough sat
      // empty in every MATCH until this was fixed (TBA's 2025cmptx alliances averaged 15.1 trough CORAL).
      const vx = rb.x - reef.x;
      const vy = rb.y - reef.y;
      const vn = Math.hypot(vx, vy) || 1;
      const edge = reef.apothem + footprintHalf(rb) + 2;
      pos = { x: reef.x + (vx / vn) * edge, y: reef.y + (vy / vn) * edge };
      standOffFrom = { x: pos.x, y: pos.y, r: 4 };
    } else {
      pos = st.slots[rb.side][idx];
      standOffFrom = { x: pos.x, y: pos.y, r: 16 };
    }
    const need = hypot(rb.x, rb.y, pos.x, pos.y);
    if (need > standOffFrom.r) {
      // Drive to the slot side of the reef, staying inside the REEF ZONE line.
      const dx = pos.x - reef.x;
      const dy = pos.y - reef.y;
      const dn = Math.hypot(dx, dy) || 1;
      const reach = Math.min(zone.apothem - 6, dn + 10);
      rb.target = { x: reef.x + (dx / dn) * reach, y: reef.y + (dy / dn) * reach };
      return;
    }
    // G412 launches the CORAL from the BUMPERS, so the car has to arrive with its face on the branch.
    // Turning in place costs a fifth of a second at a swerve's rate and about half a second for a tank
    // drive to scrub around, which is the difference the replay shows between the two chassis.
    rb.faceDeg = bearingDeg(pos.x - rb.x, pos.y - rb.y);
    // How far off the branch the face actually was is recorded on the action, because §6.5.1's test for an
    // L2-L4 CORAL is geometric — "the BRANCH is inside the volume of the CORAL" — and a 4 in BRANCH inside
    // an 11 in CORAL leaves about 3.5 in before that stops being true.
    //
    // The gate is `placeTolDeg`, not the general 45° work tolerance: measured over 24 MATCHes and 1213
    // placements, a third of them started 10° or more off the branch, because 45° lets a ROBOT begin the
    // busy while it is still swinging around. At 45° off, a car a foot from the REEF points 11 in wide of
    // the pipe it aimed at, which is past the slop, so an action that begins there is not a placement with
    // a bad chance — it is a different action. Beyond the tolerance the ROBOT turns first and pays the turn.
    //
    // The tolerance belongs to `placementRisk` rather than standing on its own because the two are one
    // mechanism: a model that charges for misalignment has to be the model that requires alignment, and the
    // knob's off value has to hand back the engine that produced the committed replay, gate included.
    const tol = st.scenario.placementRisk ? p.placeTolDeg || FACE_TOL_DEG : FACE_TOL_DEG;
    const aimErr = Math.abs(angleDeltaDeg(rb.faceDeg, rb.heading));
    if (aimErr > tol) return;
    rb.busy = { kind: mode, t: 0, sec: p.placeSec[lv], at: { x: rb.x, y: rb.y }, level: lv, idx, aimErr };
    return;
  }
  if (mode === INTENT.PROCESS) {
    if (rb.algae < 1) return;
    const pr = st.geo[rb.side].processor;
    if (hypot(rb.x, rb.y, pr.x, pr.y) > 26) {
      rb.target = { x: pr.x, y: pr.y };
      return;
    }
    // §5.5: the ALGAE goes through a 28 in x 20 in opening in the guardrail, so it is pushed in from the
    // face, not from the side.
    rb.faceDeg = bearingDeg(pr.x - rb.x, pr.y - rb.y);
    if (Math.abs(angleDeltaDeg(rb.faceDeg, rb.heading)) > FACE_TOL_DEG) return;
    rb.busy = { kind: mode, t: 0, sec: 0.8, at: { x: pr.x, y: pr.y } }; // `[estimate]` dump time
    return;
  }
  // §6.1: "ROBOTS also collect ALGAE and score in their PROCESSOR or NET", so the NET has a second feeder and
  // it is the machine. §5.4.2 hangs the mesh's lowest point 6 ft 4 in above the carpet while the truss a ROBOT
  // drives under is 5 ft 2 in, so the question is the elevator, not the rule: `netScoreSec` is 0 on a machine
  // that cannot clear the border and this branch is inert for it.
  if (mode === INTENT.SCORE_NET) {
    if (rb.algae < 1) return; // nothing to lift
    const sec = rb.profile.netScoreSec || 0;
    if (!sec) return;
    const net = st.geo[rb.side].net;
    const pos = netDepositFor(st, rb);
    if (!pos) return; // no elevator, or the mesh is already full
    if (hypot(rb.x, rb.y, pos.x, pos.y) > 20) {
      rb.target = pos;
      return;
    }
    // Aimed at the patch of mesh above the machine, not at the middle of the 12 ft face: from an end lane the
    // centre is 48 in along the border, and pointing at it would put the bumper off-axis to the deposit.
    rb.faceDeg = bearingDeg(net.x - rb.x, pos.y - rb.y);
    if (Math.abs(angleDeltaDeg(rb.faceDeg, rb.heading)) > FACE_TOL_DEG) return;
    rb.busy = { kind: mode, t: 0, sec, at: pos };
    return;
  }
  // There is no HANDOFF intent: a ROBOT cannot give an ALGAE to its own HUMAN PLAYER. The only way an
  // ALLIANCE's PROCESSOR AREA is supplied is the opponent pushing it through the opponent's PROCESSOR
  // (§5.5, §6.1), and G433B keeps ALGAE entry on the HUMAN PLAYER's side of that wall.
  if (mode === INTENT.CLIMB) {
    const cages = st.geo[rb.side].cages.map((c, i) => ({ i, c, deep: st.scenario.cageDepth[rb.side][i], used: st.cageClaim[rb.side][i], d: hypot(rb.x, rb.y, c.x, c.y) }));
    // A ROBOT holds onto the CAGE it already claimed: three climbers deciding in the same 0.1 s window
    // would otherwise each see the same free pipe and pile onto it. The claim is taken when it starts
    // driving, not when it hangs, because the queue is what has to be spread.
    let mine = rb.climbCage === null || rb.climbCage === undefined ? null : cages.find((x) => x.i === rb.climbCage);
    if (!mine) {
      const open = cages.filter((x) => x.used < CAGE_ROBOT_CAPACITY);
      if (!open.length) return;
      // Deep is worth 12 and shallow 6, so a machine that can reach deep should not spend a deep pipe.
      const usable = rb.profile.canClimbDeep ? open : open.filter((x) => !x.deep);
      const pool = usable.length ? usable : open;
      const deepPool = pool.filter((x) => x.deep);
      (deepPool.length ? deepPool : pool).sort((a, b) => a.d - b.d);
      mine = (deepPool.length ? deepPool : pool)[0];
      st.cageClaim[rb.side][mine.i] += 1;
      rb.climbCage = mine.i;
    }
    if (mine.d > 20) {
      rb.target = { x: mine.c.x, y: mine.c.y };
      return;
    }
    const deep = mine.deep && rb.profile.canClimbDeep;
    rb.busy = { kind: mode, t: 0, sec: rb.profile.climbSec + (deep ? 1.2 : 0), at: { x: mine.c.x, y: mine.c.y }, deep, cage: mine.i };
    return;
  }
  // DEFEND: stand between an opponent and where it is going. There is no timer on it — a drive team holds a
  // press for as long as it keeps the car in front of the other one, so this re-decides every 0.1 s like any
  // other trip — and there is no points column for it either. What it buys is geometry: two 30 in boxes and a
  // REEF ZONE the opponent has to get around. What it costs is the cycle this machine is not doing, G421 if a
  // second ALLIANCE ROBOT crosses with it, and G427 the moment it touches somebody inside their own zone —
  // which is why the stand-off leaves 8 in of carpet instead of closing onto their BUMPERS.
  if (mode === INTENT.DEFEND) {
    const opp = rb.side === 'blue' ? 'red' : 'blue';
    const tgt = obs.opponents.find((o) => o.slot === want.targetRobot && !o.disabled)
      || obs.opponents.filter((o) => !o.disabled).sort((a, b) => a.d - b.d)[0];
    if (!tgt) {
      rb.target = null;
      return;
    }
    rb.defending = tgt.slot;
    // What is being blocked: the point the policy named, else whatever the opponent is driving to, else its
    // own REEF. Pressing from that side takes the lane; pressing from behind buys nothing but a G427.
    const block = want.block || tgt.target || st.geo[opp].reef;
    const dx = block.x - tgt.x;
    const dy = block.y - tgt.y;
    const dn = Math.hypot(dx, dy) || 1;
    const half = footprintHalf(rb);
    const stand = half + footprintHalf(tgt) + DEFEND_STANDOFF_IN;
    // A press that closes the last inch is a contact foul, so the defender holds the ring: once it is inside
    // its own stand-off it gives ground instead of driving into them. That is what a 2025 drive team does to
    // keep a lane without eating G427 every second, and without it a held press reads as a PIN — which the
    // clause charges a MAJOR FOUL for every 3 s, correctly.
    const gap = Math.hypot(rb.x - tgt.x, rb.y - tgt.y) < stand - 6 ? stand + 14 : stand;
    rb.faceDeg = bearingDeg(tgt.x - rb.x, tgt.y - rb.y); // BUMPERS take the hit, and square-on they present their widest face
    // The lane it takes is on THIS side of their zone line. Blocking the road home means standing between them
    // and their REEF, which is inside the volume G427 protects, so the point is pulled out to the boundary —
    // the defender guards the entrance, it does not sit in the doorway.
    const hold = outsideZones(st, opp, { x: tgt.x + (dx / dn) * gap, y: tgt.y + (dy / dn) * gap }, half);
    rb.target = {
      x: clamp(hold.x, half, FIELD.longIn - half),
      y: clamp(hold.y, half, FIELD.wideIn - half),
    };
    return;
  }
}

// Reach and readiness for a CORAL STATION in one place, so a STATION the policy names explicitly costs the
// ROBOT the same drive as the one the engine would have picked for it: within 20 in of the opening, and with
// a CORAL in the queue. `side` is which ALLIANCE's corner it is — the opponent's feed clock is theirs too.
function stationPick(st, rb, side, i) {
  const q = st.stations[side]?.[i];
  if (!q || q.remaining <= 0) return null;
  if (hypot(rb.x, rb.y, q.x, q.y) > 20 || q.feedReadyAt > st.t) return { x: q.x, y: q.y, travelOnly: true };
  return { x: q.x, y: q.y, source: 'station', stationIdx: i, stationSide: side };
}

function nearestCoral(st, rb, obs) {
  const near = obs.coralOnFloor[0];
  const stations = obs.stations.filter((s) => s.remaining > 0).sort((a, b) => a.d - b.d);
  if (near && (!stations.length || near.d <= stations[0].d)) {
    if (near.d > 22) return { x: near.x, y: near.y, travelOnly: true };
    return { x: near.x, y: near.y, source: 'floor', piece: near.ref };
  }
  const s = stations[0];
  return s ? stationPick(st, rb, rb.side, s.i) : null;
}

function snapshot(st) {
  // Which BRANCHES and which ALGAE nodes are actually occupied, as a bitmask per level. The counts alone made
  // the replay draw the first N branches in slot order, so a CORAL booked on the face at 150° appeared on the
  // face at 30° and a ring the engine had taken from one pair showed up missing from another. The indices are
  // `st.slots[side]` order, which is what `freeSlotNear` books and what viz.js draws from `branchSlots`.
  const occ = (side) => {
    const mask = (lv) => st.reef[side][lv].reduce((m, v, i) => (v ? m | (1 << i) : m), 0);
    // Which ALGAE are still on the REEF, and which still ride the CORAL MARKS, as two bitmasks in the order
    // `makeState` fills them (`reefAlgae` then `coralMarks`). The counts alone made the replay remove rings from
    // the top of the list, so a machine that took the ring at one pair left a picture with a ring missing from
    // another. viz.js draws from these two masks against the same two calls.
    let reefM = 0;
    let markM = 0;
    let ri = 0;
    let mi = 0;
    for (const a of st.algaeReef[side]) {
      // The bit index is the ring's position in the list, taken or not, so it lines up with `reefAlgae` and
      // `coralMarks` on the drawing side.
      if (a.where === 'reef') {
        if (!a.taken) reefM |= 1 << ri;
        ri += 1;
      } else {
        if (!a.taken) markM |= 1 << mi;
        mi += 1;
      }
    }
    return {
      L2: st.reef[side].L2.filter(Boolean).length, L3: st.reef[side].L3.filter(Boolean).length,
      L4: st.reef[side].L4.filter(Boolean).length, trough: st.reef[side].trough.count,
      L2m: mask('L2'), L3m: mask('L3'), L4m: mask('L4'),
      algae: st.algaeReef[side].filter((a) => !a.taken).length,
      algaeReef: st.algaeReef[side].filter((a) => !a.taken && a.where === 'reef').length,
      algaeMarks: st.algaeReef[side].filter((a) => !a.taken && a.where === 'mark').length,
      algaeReefM: reefM, algaeMarksM: markM,
    };
  };
  return {
    t: st.t,
    period: periodAt(st.t),
    robots: ['blue', 'red'].flatMap((side) =>
      st.robots[side].map((r) => ({ side, slot: r.slot, x: +r.x.toFixed(1), y: +r.y.toFixed(1), heading: +(r.heading || 0).toFixed(0), coral: r.coral, algae: r.algae, busy: r.busy ? r.busy.kind : null, intent: r.intent || null, target: r.target ? [+r.target.x.toFixed(0), +r.target.y.toFixed(0)] : null, press: r.press ? 1 : 0, climb: r.climb ? r.climb.level : null, cage: r.climb ? r.climb.cage : null, disabled: r.disabled, defending: r.defending, impair: r.impair ? { left: +r.impair.left.toFixed(1), speed: r.impair.speed } : null })),
    ),
    reef: { blue: occ('blue'), red: occ('red') },
    floor: st.floor.filter((p) => !p.taken).map((p) => ({ x: p.x, y: p.y, kind: p.kind, side: p.side, rot: p.rot || 0 })),
    stations: { blue: st.stations.blue.map((q) => q.remaining), red: st.stations.red.map((q) => q.remaining) },
    cages: st.scenario.cageDepth,
    cageUsed: { blue: st.cageClaim.blue.slice(), red: st.cageClaim.red.slice() },
    hpQueue: { blue: st.hpQueue.blue, red: st.hpQueue.red },
    processor: { blue: st.processor.blue.auto + st.processor.blue.tele, red: st.processor.red.auto + st.processor.red.tele },
    net: { blue: st.net.blue.count, red: st.net.red.count },
    netLanes: { blue: st.net.blue.lanes.slice(), red: st.net.red.lanes.slice() },
    netCap: netCapacityOf(st.scenario),
    netRobot: { blue: st.net.blue.byRobot, red: st.net.red.byRobot },
    score: { blue: scoreSide(st, 'blue').total, red: scoreSide(st, 'red').total },
  };
}
