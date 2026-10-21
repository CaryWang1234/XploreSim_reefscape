// Field layout, branch inventory and ROBOT profiles for REEFSCAPE.
//
// Coordinates: x runs along the 690 in long axis (the alliance walls are the short ends, blue at x = 0),
// y across the 317 in width. Everything in `layout()` whose *position* is not written down in the manual
// is marked `[estimate]` — the manual gives element DIMENSIONS with clause numbers (those are in
// rules.js) but the exact station/processor offsets live in the 2025 field drawings, which are not
// transcribed here yet. Stage 3 pins them.

import { FIELD, GEO, PIECES, NET_CAPACITY } from './rules.js';

// Which side of the field each ALLIANCE owns.
export const SIDES = ['blue', 'red'];

// §5.3: each REEF is "centered between each guardrail and located 12 ft. away from the ALLIANCE WALL".
// This build reads the 12 ft as centre-to-wall; see the CORAL MARK note below for what the manual's own
// pictures say if it is read surface-to-wall instead.
const REEF_FROM_WALL_IN = 144;

export function layout() {
  const midX = FIELD.longIn / 2;
  const midY = FIELD.wideIn / 2;
  const perSide = {};
  for (const side of SIDES) {
    const toward = side === 'blue' ? 1 : -1;
    const reefX = side === 'blue' ? REEF_FROM_WALL_IN : FIELD.longIn - REEF_FROM_WALL_IN; // §5.3
    perSide[side] = {
      reef: { x: reefX, y: midY, apothem: GEO.reef.hexAcrossFlatsIn / 2 },
      reefZone: { x: reefX, y: midY, apothem: GEO.reefZone.acrossFlatsIn / 2 },
      // The starting line is 88 in from the REEF, between it and the BARGE (§5 definitions). It is also the
      // staging datum below and the thing §6.5.2's LEAVE is judged against.
      startingLineX: reefX + toward * GEO.startingLineFromReefIn,
      // The starting line is 88 in from the REEF, between it and the BARGE (§5 definitions), and G303-D
      // makes it the staging datum: a ROBOT starts with "its BUMPERS overlap[ing] their ROBOT STARTING
      // LINE", so its 30 in footprint straddles the line and the first metre of the AUTO path clears it.
      // This build used to start the fleet 40 in on the REEF side of the line, which is a start no
      // referee would allow and which made LEAVE a leg of the routine rather than a freebie; #123 moved
      // the CORAL MARKs behind the REEF, and the two cannot be fixed apart. Where along the line the
      // three abreast sit is `[estimate]` — the clause fixes x and says nothing about y.
      robotStart: [
        { x: reefX + toward * GEO.startingLineFromReefIn, y: midY - 40 },
        { x: reefX + toward * GEO.startingLineFromReefIn, y: midY },
        { x: reefX + toward * GEO.startingLineFromReefIn, y: midY + 40 },
      ],
      // 2 CORAL STATIONS per ALLIANCE, in the corners joining the ALLIANCE WALL to the guardrails
      // (§5.1, §5.6.2). `[estimate]` exact inset: the opening is 6 ft 4 in wide by 7 in tall.
      coralStations: [
        { x: side === 'blue' ? 6 : FIELD.longIn - 6, y: GEO.coralStation.openingWidthIn / 2 + 4 },
        { x: side === 'blue' ? 6 : FIELD.longIn - 6, y: FIELD.wideIn - (GEO.coralStation.openingWidthIn / 2 + 4) },
      ],
      // §5.5: the PROCESSOR is in the guardrail "near the ALLIANCE'S REEF ZONE and adjacent to the
      // opponent's PROCESSOR AREA", so it belongs beside its own reef, not at midfield. The inset along
      // the guardrail is `[estimate]`; the opening is 28 in × 20 in with a 7 in sill. An earlier draft put
      // it at midfield, which parked every ALGAE runner 25 in from the opponent's outermost CAGE and gave
      // the other alliance a MAJOR G418 roughly every 10 s — a 72-point artefact, and the reason the
      // processor moved.
      processor: { x: reefX + toward * (GEO.reefZone.acrossFlatsIn / 2 + 26), y: side === 'blue' ? 9 : FIELD.wideIn - 9 },
      // §5: PROCESSOR AREA is 3 ft 7 in wide × 7 ft 6 in deep, the alcove beside it. `[estimate]` side.
      processorArea: {
        x: reefX + toward * (GEO.reefZone.acrossFlatsIn / 2 + 26),
        y: side === 'blue' ? GEO.processorArea.depthIn / 2 : FIELD.wideIn - GEO.processorArea.depthIn / 2,
        w: GEO.processorArea.widthIn,
        d: GEO.processorArea.depthIn,
      },
      // §5.4: three CAGE locations per side, at 41.5 / 84 / 127 in from midfield, hung on the face of the
      // truss that looks at that ALLIANCE. The two sides are mirror images through the field centre, so
      // neither ALLIANCE gets a shorter climb — the same point-symmetry rule that stopped a fake 60-point
      // seat asymmetry in the REBUILT build. X is on the ALLIANCE'S OWN half of the truss band: the BARGE
      // spans the centreline and each side owns 22 in of it, so blue's cages sit at midX − 11, not +11.
      // (They were on +11 until this comment was written, which put every ALLIANCE's climbing furniture in
      // the opponent's half and made the field read as if red and blue had been swapped.)
      cages: GEO.barge.cageOffsetsFromMidfieldIn.map((o) => ({ x: midX - toward * (GEO.barge.depthIn / 4), y: midY + toward * o })),
      // §5 definitions: the BARGE ZONE is 3 ft 10 in deep and surrounds that ALLIANCE'S half of the BARGE,
      // so it is bounded by the centreline on one side and reaches 46 in into its own half. PARK (§6.5.2) is
      // judged here, which is why the sign matters: with the zone on the wrong side, a parked ROBOT was
      // standing in the opponent's half.
      bargeZone: {
        x: midX - toward * (GEO.barge.zoneDepthIn / 2),
        y: midY + toward * GEO.barge.cageOffsetsFromMidfieldIn[1],
        halfX: GEO.barge.zoneDepthIn / 2,
        halfY: 73.25,
      },
      // §5.4.2: one NET per ALLIANCE, 4 ft × 12 ft of mesh, suspended from the TOP of the BARGE so its
      // footprint lies on the truss band on that ALLIANCE's own side, 12 ft long across the field width.
      // Its lowest point is 6 ft 4 in up (§5.4.2) while the truss a ROBOT drives under is 5 ft 2 in
      // (§5.4), so a machine with a tall enough elevator stands under it and lifts an ALGAE over the
      // border — which is why the deposit works from OUTSIDE this footprint (G420 forbids contacting the
      // NET) and why whether any given ROBOT can do it at all is `netScoreSec`, a property of the machine.
      // The mesh itself stays display geometry, not a collider: nothing at carpet height can hit it.
      net: { x: midX - toward * (GEO.net.widthIn / 2), y: midY + toward * GEO.barge.cageOffsetsFromMidfieldIn[1], w: GEO.net.widthIn, d: GEO.net.lengthIn, lowPointIn: GEO.net.lowPointIn, aboveRobots: true },
    };
  }
  return { midX, midY, ...perSide };
}

// The six CORAL MARKS (§5: 1 of 6 4 in × 4 in "+" marks; §6.3.4.1 A stages 1 CORAL on each, and §6.3.4.2 B
// puts an ALGAE on top of that CORAL) are 3 per ALLIANCE, in a line parallel to its ALLIANCE WALL, between
// that wall and its REEF.
//
// The manual writes no distance for them, so the two numbers are measured off the manual's own pictures by
// colour-blob centroid — Figure 5-4 (the plan view of areas and zones, 1148 px wide) and Figure 6-2 (the
// staging render, 2412 px). Figure 5-4 is internally consistent at 1.09 px/in: its guardrail-to-guardrail
// span is 346 px for §5.1's 317 in, and its two REEF ZONE hexagons are 105 and 101 px for §5.2's 93.5 in
// face-to-face. At that scale the mark line sits 136 px from the blue REEF centre and 48 px from the wall —
// 0.74 of the way from REEF to wall (Figure 6-2 reads 0.64). `[estimate]` because the pictures are renders,
// not dimensioned drawings, and because the pictures themselves disagree about where the REEF is: the same
// scale puts its two centres 337 in apart, which is what §5.3's "12 ft. away from the ALLIANCE WALL" gives
// if the 12 ft is measured to the REEF's SURFACE, whereas this build reads it centre-to-wall. Keeping the
// build's datum and the pictures' fraction is why the mark is 38 in off the wall rather than the 44 in the
// pixels say. What is not an estimate is which side of the REEF they are on: both pictures put them with
// the wall behind them, and the version this replaced put them on the BARGE side.
//
// Across the field the three marks are 77.7 px apart in Figure 5-4 and 109.9 px in Figure 6-2 — 71.3 and
// 72.3 in at their own scales, so this one is not a fraction, it is the number the two pictures agree on.
const MARK_FROM_WALL_IN = 38;
const MARK_SPACING_IN = 71.5;
export const MARK_FROM_REEF_IN = REEF_FROM_WALL_IN - MARK_FROM_WALL_IN;

export function coralMarks(geo, side) {
  const r = geo[side].reef;
  const toward = side === 'blue' ? 1 : -1;
  const out = [];
  for (const dy of [-1, 0, 1]) {
    out.push({ x: r.x - toward * MARK_FROM_REEF_IN, y: r.y + dy * MARK_SPACING_IN });
  }
  return out;
}

// 6 ALGAE staged on each REEF, one on each of its six FACES, and 1 on top of the CORAL at each of that
// ALLIANCE's 3 CORAL MARKS — §6.3.4.2 A and B, which together with the other REEF make the 18 a MATCH is
// played out of.
//
// §6.3.4.2 A stages them "on pairs of BRANCHES as shown in Figure 6-3": one ring straddles the two pipes of
// a FACE (§5.3: 13 in apart center-to-center), so a REEF carries one ring per FACE and six in all. Figure 5-4
// — the top-down plan, where angles are honest — puts the six centroids at 0°, 60°, ... 300° around the REEF
// centre, which is exactly the FACE normal `branchSlots` uses, with one of the six facing the ALLIANCE WALL.
// The version this replaced staged two rings on each of three alternating FACES, reading "pairs of BRANCHES"
// as "a pair of rings per pair of branches"; it left three faces bare and made stripping a REEF 3 stops
// instead of 6.
//
// Every ring is outside the structure — `[estimate]` 6 in past the flat, the same stand-off as a BRANCH — so
// each has a face a ROBOT can stand at. The earlier draft spread its positions across the REEF's DIAMETER and
// parked a pair at the hexagon's CENTRE, inside 5 ft 5 in of solid structure: nothing could reach those two
// rings and the engine took them anyway, from wherever the machine happened to be (over 8 MATCHes and 168
// strips the median ring came off a ROBOT 48 in away, the worst 173 in). That is what the 16 in reach gate
// in `act` now refuses.
export function reefAlgae(geo, side) {
  const r = geo[side].reef;
  const out = [];
  for (let k = 0; k < 6; k++) {
    const n = (Math.PI / 3) * k; // the same face normals as the BRANCHES
    out.push({ x: r.x + Math.cos(n) * (r.apothem + 6), y: r.y + Math.sin(n) * (r.apothem + 6) });
  }
  return out; // 6
}

// §6.3.4.2: what one ALLIANCE can take off its own side of the field — 6 on its REEF plus 3 riding on
// the CORAL at its marks. Those 9 are its own supply, and §6.1 gives it two goals for them: its
// PROCESSOR (6) or its own NET (4). The other 9 are the opponent's, and the only way they reach this
// ALLIANCE's NET is the opponent pushing them through the opponent's PROCESSOR for a HUMAN PLAYER to
// throw (§5.5, §6.1) — which is why the same NET pays 4 either way but only one of the two routes hands
// the opponent nothing.
export const ALGAE_PER_ALLIANCE = 6 + 3;

// One CORAL can be scored per BRANCH (§6.5.1), and there are 12 branches on each of L2/L3/L4.
// The trough (L1) is not a slot list: §6.5.1 scores a CORAL in the trough if it contacts the trough or
// is supported by one that does, so L1 capacity is geometric rather than fixed. We model it as a queue
// with a physical cap `[estimate]` = 24, which is what the trough area fits at 4 in diameter.
export const BRANCH_SLOTS_PER_LEVEL = GEO.reef.branchesPerLevel; // 12 × 3 levels = 36 branches
export const TROUGH_CAP = 24;

// `[estimate]` How often a held CORAL is shaken onto the carpet by the drive itself — a hard launch, a hard
// stop, a corner taken at full throttle. The manual scores a piece that is not held by §6.5.1's geometry and
// never describes how it came to be loose, so this is the sweep's answer, not a clause: `npm run measure` reads
// 2.04 CORAL a MATCH loose this way across the six machines at 0.01, 0.83 at 0.005 and 3.46 at 0.02, and the
// three rates price within one another's error bars, so the row that decides is how many pieces a MATCH can be
// seen to lose. `0` spends no random number and is the engine as it was.
export const CARRY_DROP_PER_SEC = 0.01;

// How many ROBOTS one CAGE can carry. There is NO rule for this: §6.5.2 requires each ROBOT to contact
// "one and only one of their ALLIANCE'S CAGES" and its item B explicitly allows gripping a partner who is
// already qualified, so a chain is legal and 3-on-1 would score 3 × the CAGE value. The limit is the
// CAGE: 7 in of pipe (§5.4.1) against a 34 in ROBOT means two machines can share one, and a third has
// nothing to hold. `[estimate]` = 2, and it is the reason a policy that sends all three climbers to the
// nearest CAGE is wasting a robot rather than banking 36 points.
export const CAGE_ROBOT_CAPACITY = 2;

// Where the 12 branches of a level actually are: §5.3 says each of the six faces carries pipes 13 in
// apart center-to-center, and every pipe has one branch per level. So a level is 6 faces × 2 slots, and
// the slots sit at the face's outward normal, ±6.5 in along the face. Placement therefore costs a DRIVE:
// a ROBOT has to get to the open slot, not just to somewhere on the reef ring, which is what makes a
// real cycle 8-12 s rather than free.
//
// The hexagon's PHASE is not in the text. Figure 5-4 (top-down) draws a REEF with a FLAT facing the
// ALLIANCE WALL and its vertices toward the guardrails, so the face normals are 0°, 60°, ... 300° in a
// field where x is the long axis — and the ROBOT STARTING LINE, 7 ft 4 in from the REEF, then runs
// parallel to that flat. Turn it 30° the other way and a vertex points at the wall, the two pipes of the
// wall-facing pair straddle the ±x axis, and the REEF ZONE's vertex (53.99 in) reaches past everything
// parked on that side.
export function branchSlots(center) {
  const out = [];
  const faceNormal = (k) => (Math.PI / 3) * k;
  for (let k = 0; k < 6; k++) {
    const n = faceNormal(k);
    const px = Math.cos(n);
    const py = Math.sin(n);
    const tx = -py;
    const ty = px;
    for (const along of [-GEO.reef.pipeSpacingIn / 2, GEO.reef.pipeSpacingIn / 2]) {
      out.push({
        x: center.x + px * (center.apothem + 6) + tx * along,
        y: center.y + py * (center.apothem + 6) + ty * along,
      });
    }
  }
  return out; // 12
}

export function reefGeometry(geo) {
  const out = {};
  for (const side of ['blue', 'red']) out[side] = branchSlots(geo[side].reef);
  return out;
}

export function emptyReef() {
  return {
    L2: new Array(BRANCH_SLOTS_PER_LEVEL).fill(null),
    L3: new Array(BRANCH_SLOTS_PER_LEVEL).fill(null),
    L4: new Array(BRANCH_SLOTS_PER_LEVEL).fill(null),
    trough: { count: 0, cap: TROUGH_CAP },
  };
}

// ---------------------------------------------------------------------------
// ROBOT profiles. NONE of these numbers are rules: they are the modelling
// assumptions about how fast a machine drives, reaches and places. Each is
// deliberately conservative against the rule limits it has to respect (R103
// 115 lb, G415 18 in expansion, G409 one CORAL + one ALGAE).
// ---------------------------------------------------------------------------

// What a drivetrain can do with a command, as fractions of the ROBOT's own numbers. `lateral` is the
// fraction of top speed it reaches sideways, `reverse` the fraction it reaches backing up, `turnAtSpeed`
// what it keeps of its turn rate at full speed (a swerve's modules steer on their own; a tank has to
// scrub both sides), and `turnRampSec` how long the spin takes to reach its peak, which is what turns a
// heading change into a trapezoid instead of a jump. All `[estimate]`: none of this is in the manual.
export const CHASSIS = {
  swerve: { lateral: 1, reverse: 1, turnAtSpeed: 1, turnRampSec: 0.25 },
  tank: { lateral: 0, reverse: 0.6, turnAtSpeed: 0.55, turnRampSec: 0.35 },
  mecanum: { lateral: 0.62, reverse: 0.78, turnAtSpeed: 0.75, turnRampSec: 0.3 },
};

// `netScoreSec` is the one capability in this file that is a REACH rather than a RATE: §6.1 lets a ROBOT
// score ALGAE in its own NET, but the mesh's lowest point hangs 6 ft 4 in above the carpet (§5.4.2), so
// whether a given machine can do it is a property of its elevator. A machine that places an L4 CORAL at 72 in
// clears a 76 in border, so the shipped profiles carry their own L4 time plus `[estimate]` 0.5 s for the extra
// height and the 16 in ring. That is a real cost, not a free option: hand the reach to every machine and
// greedy — which bids margin per second — stops routing ALGAE through the PROCESSOR at all (the MATCH's
// PROCESSOR column falls from 18 rings to 11), the opponent's HUMAN PLAYER has nothing left to throw, nobody
// earns the §6.5.3 Coopertition, and the mirror loses `−26.5 ± 2.2` points a MATCH over 24 paired seeds. It is
// also what the one read-line-by-line ledger says:
// 2025cmptx_f1m1's Johnson A1 totals 295 as 63 AUTO CORAL + 145 tele CORAL + 36 NET + 9 LEAVE + 36 DEEP + 6
// FOUL, which is 9 ALGAE in the NET and NONE in the PROCESSOR — a ledger that fits either a fleet that lifted
// them in or a playoff record that simply dropped the PROCESSOR column.
// Carrying the reach, guard 17 prints 301.4 against the recorded 295 and 303.9 against 281. `npm run measure`'s
// netScoreSec arms price the route both ways, and 0 stays the ablation.
export const SAMPLES = [
  {
    key: 'coral3lvl',
    name: 'Full-cycle scorer',
    // `[estimate]` calibrated, not guessed: at 160 in/s (4.1 m/s) with these action times the mirror lands on
    // the 2025 Einstein Field ledger TBA records for the BRANCHES — guard 17b prints 11.8/12.0/12.0 against the
    // recorded 12/12/12 — but short in the TROUGH, 5.6 against a recorded 15.1, which is why its 41.4 CORAL an
    // ALLIANCE sits under the field's 49.66. Slower or slower-driving profiles leave the trough
    // empty, which is what the engine did before the L1 stand-off was fixed.
    driveSpeedIps: 160,
    turnRateDegS: 380,
    accelIpsS: 150,
    chassis: 'swerve',
    weightLb: 105, // under R103's 115 lb
    // Reaching L4 (72 in up) takes longer than L2 (31 in), so placement time scales with level.
    placeSec: { L1: 0.4, L2: 0.65, L3: 1.0, L4: 1.4 },
    // `[estimate]` §6.5.1 scores an L2-L4 CORAL only "if the BRANCH is inside the volume of the CORAL", and
    // a branch is a 4 in pipe inside an 11 in pipe, so there is about an inch of slop to land in. The
    // fraction that does not rise with the level: an L2 is 31 in up on a 35° branch and an L4 is 72 in up
    // on a vertical one, and the higher the reach the more of it has to hold still while the piece leaves.
    // 0 in every slot is the ablation — it is what the engine did before this existed, and it is why the
    // REEF came back full every MATCH.
    placeDrop: { L1: 0.02, L2: 0.06, L3: 0.13, L4: 0.22 },
    placeTolDeg: 26, // [estimate] aim error at which a placement is as likely to miss as the profile says
    pickSec: 0.6, // pick a CORAL off the floor / from a station
    algaeStripSec: 1.0, // pull a 16 in ALGAE off the REEF
    intake: 'front',
    canClimbDeep: true,
    climbSec: 2.1,
    // `[estimate]` the chance that a climb attempt actually sticks. §6.5.2 gives CAGE points only to a ROBOT
    // contacting one and only one of its ALLIANCE's CAGES and not contacting the carpet, and PARK only to one whose
    // BUMPERS are in the BARGE ZONE without a CAGE, so the endgame is a hold on a 2 ft × 7 in box of four 1 in pipes
    // (§5.4.1) — and Table 6-2 prices the difference between holding and not at 12, 6, or 2. The manual prints no
    // rate, and a ledger cannot report one either: an alliance that fell and re-hung before the assessment books the
    // same three DEEP CAGEs. The engine used to roll this number and throw the result away, so no climb ever failed.
    // 1 is the ablation the guards read, and it is the engine as it was.
    climbSuccess: 0.94,
    netScoreSec: 1.9, // its own L4 (1.4 s) plus 0.5 s of height and ring; see the note above SAMPLES
    // `[estimate]` §6.4: AUTO is a scripted routine, so how many CORAL it spends is a property of the ROBOT
    // and its code, not of the driver. TBA's 2025cmptx alliances averaged 9 AUTO CORAL, 7 on L4 — about three
    // a ROBOT, which is what an elite 2025 auto was.
    autoCycles: 3,
    reliability: 0.97,
    team: 1, // 1/2/3, not a team number: this trio is a role set, not three real machines
  },
  {
    key: 'algae',
    name: 'Algae remover / processor',
    driveSpeedIps: 148,
    turnRateDegS: 360,
    accelIpsS: 140,
    chassis: 'swerve',
    weightLb: 98,
    placeSec: { L1: 0.4, L2: 0.6, L3: 0.8, L4: 0.9 },
    // The algae machine is the one that still has to put a CORAL back when the REEF runs out, and its reach
    // stops lower, so its misses are concentrated at the top.
    placeDrop: { L1: 0.03, L2: 0.08, L3: 0.16, L4: 0.28 },
    placeTolDeg: 24, // [estimate] same reading as above, on a shorter arm
    pickSec: 0.5,
    algaeStripSec: 0.65,
    intake: 'front',
    canClimbDeep: false,
    climbSec: 1.6,
    climbSuccess: 0.94, // the rate is the machine's, not the CAGE's: no source separates a hold in a low cage from one in a high cage
    netScoreSec: 1.4, // its L4 is 0.9 s, so the border is the same 0.5 s above it
    autoCycles: 3,
    reliability: 0.96,
    team: 2,
  },
  {
    key: 'climber',
    name: 'Cage climber / support',
    driveSpeedIps: 117,
    turnRateDegS: 300,
    accelIpsS: 110,
    chassis: 'tank',
    weightLb: 88,
    placeSec: { L1: 0.45, L2: 0.7, L3: 1.05, L4: 1.55 },
    // The support machine has the slowest arm and the least practice at the top, so it pays the most for L4.
    placeDrop: { L1: 0.04, L2: 0.1, L3: 0.18, L4: 0.32 },
    placeTolDeg: 20, // [estimate] a tank chassis cannot trim its approach angle the way a swerve can
    pickSec: 0.7,
    algaeStripSec: 1.4,
    intake: 'front',
    canClimbDeep: true,
    climbSec: 1.3,
    climbSuccess: 0.97, // the role's own advantage, in the same `[estimate]` column as its 1.3 s climb
    netScoreSec: 2.05, // the slowest arm in the file: its L4 is 1.55 s
    autoCycles: 2,
    reliability: 0.95,
    team: 3,
  },
];

// `[estimate]` one machine's whole clock scaled by `slow` (> 1 is the slower ROBOT). A scoreboard cannot say
// whether a team got its tempo from a faster drivetrain or a faster elevator, so this moves both together and
// leaves the ratio between the actions alone. `jitterProfile` in engine.js is this with a per-MATCH draw.
export function scaleProfile(p, slow) {
  const placeSec = {};
  for (const lv of ['L1', 'L2', 'L3', 'L4']) placeSec[lv] = p.placeSec[lv] * slow;
  return {
    ...p,
    tempoFactor: (p.tempoFactor ?? 1) * slow,
    placeSec,
    // A miss rate is not a clock. Scaling the whole profile by `slow` is the model saying this machine is
    // slower at the same things; it is not the model saying this machine is more careful, so the odds of
    // landing a CORAL on a branch carry through untouched and get their own copy so an edit on the card
    // cannot reach back into SAMPLES.
    placeDrop: { ...(p.placeDrop ?? { L1: 0, L2: 0, L3: 0, L4: 0 }) },
    // A rate is not a clock, and a climb rate is not a claim about the machine's tempo: a faster ascent is
    // `climbSec`, holding it once you are there is `climbSuccess`. It carries through untouched, with its own
    // copy so an edit on the card cannot reach back into SAMPLES.
    climbSuccess: p.climbSuccess ?? 1,
    pickSec: p.pickSec * slow,
    algaeStripSec: p.algaeStripSec * slow,
    climbSec: p.climbSec * slow,
    driveSpeedIps: p.driveSpeedIps / slow,
    accelIpsS: p.accelIpsS / slow,
    turnRateDegS: p.turnRateDegS / slow,
    netScoreSec: p.netScoreSec * slow,
  };
}

// The 2025 Einstein Field finalists as presets, built out of two sources kept deliberately apart.
//
// TBA's own MATCH ledger (read from thebluealliance.com/match/2025cmptx_f1m1 on 2026-10-11) gives the ALLIANCE
// totals: Johnson (blue, 295) filled 12/12/12 BRANCHES plus 23 trough CORAL — 59 pieces, 9 of them in AUTO —
// with 9 NET ALGAE and three DEEP CAGES. Newton (red, 281) filled 12/12/11 plus 21 trough — 56 pieces, 9 in
// AUTO — the same 9 NET ALGAE and three DEEP CAGES. That is the scale, and it is what the trio has to sum to.
//
// Statbotics' 2025 EPA export (storage.googleapis.com/site_v1/team_years/2025, 3702 team-years) gives the
// RATIO between the three ROBOTS of an ALLIANCE. Those are expected contributions rather than tallies — 2910
// is credited with barge_points 12.97, more than the 12 one DEEP CAGE can pay — so they split the alliance
// ledger below and never set it. `pieces` is that split: 59 and 56 divided by each team's
// total_game_pieces (1690 25.59, 4414 22.27, 2073 12.39 / 2910 26.48, 1323 25.68, 4272 14.82).
//
// The ROBOT that owns the REEF is the one that gets to the branch first, so `autoCycles` follows the AUTO
// column: the alliance spent 9 CORAL in 15 s, which is three a ROBOT for the two quick machines and two for
// the third. The per-ROBOT alternative — rounding each of these teams own Statbotics `auto_coral` column, now
// read for all six (Johnson 4.19 / 2.47 / 1.55, Newton 3.99 / 3.61 / 2.49) — is in `npm run measure` as two
// paired arms, and it cuts both ways: it takes AUTO down on Johnson and up on Newton, so the ledger split
// stays the rule and the AUTO gap is stated per lineup rather than averaged into a win. The same export's
// `auto_leave_points` is 2.80-3.26 a ROBOT against the 3 one crossing pays, which is the ledger's 9 LEAVE and
// why the budget pays for the cross inside the 15 s instead of leaving it to the end.
// Exported because `scouting.js` honours an imported `coral_per_match` column through the same fit rather than
// inventing its own reference rate: two numbers that mean "what a 16.5-CORAL machine looks like" would be a
// calibration that quietly disagrees with the cards the page ships.
export const REF_CORAL_PER_ROBOT = 16.5; // fitted so a scaled trio lands on the recorded ALLIANCE totals (see below)

// `[estimate]` the fastest 2025 chassis ran about 4.6 m/s, ~180 in/s, so the drivetrain half of the scale is
// clipped: a ROBOT credited with 25 CORAL a MATCH did not get them by outrunning everyone by 50%, it got
// them from a faster mechanism and cleaner paths. Only the action times take the full scale.
const MAX_PRESET_SPEED_IPS = 185;

function presetRobot(base, { team, name, pieces, autoCycles, ref, deep = true }) {
  const p = scaleProfile(base, REF_CORAL_PER_ROBOT / pieces);
  // The two teams in the 2025 Einstein Field Final filled their REEFs: TBA's ledger for f1m1 is 12/12/12
  // BRANCHES plus 23 trough CORAL for Johnson and 12/12/11 plus 21 for Newton. `scaleProfile` moves their
  // clocks to reach that count, but it cannot make a machine that lands the top branch on the first try,
  // and these did: a ROBOT credited with 25 CORAL a MATCH was not spending half of them on retries. So the
  // six named machines get the elite miss column and the generic trio keeps the ordinary one — the same
  // distinction as `placeSec`, where a faster elevator is a shorter time, not a lucky driver.
  const placeDrop = {
    L1: 0.005, L2: 0.01, L3: 0.02, L4: 0.04, // [estimate] fitted to the recorded branch fill, not measured
  };
  // The scale is a ratio, so every derived time is a long decimal. A pit measures to milliseconds, and the
  // ROBOT card is an editor: rounding here is what stops it printing 0.3944223107569721 s.
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const r1 = (x) => Math.round(x * 10) / 10;
  const placeSec = {};
  for (const lv of ['L1', 'L2', 'L3', 'L4']) placeSec[lv] = r3(p.placeSec[lv]);
  return {
    ...p,
    placeSec,
    placeDrop,
    pickSec: r3(p.pickSec),
    algaeStripSec: r3(p.algaeStripSec),
    climbSec: r3(p.climbSec),
    tempoFactor: r3(p.tempoFactor),
    driveSpeedIps: r1(Math.min(p.driveSpeedIps, MAX_PRESET_SPEED_IPS)),
    accelIpsS: r1(p.accelIpsS),
    turnRateDegS: r1(p.turnRateDegS),
    key: `team${team}`,
    name,
    team,
    autoCycles,
    // Printed on the ROBOT card. A preset is a claim about a real machine, so it carries the two numbers it
    // was made from and where each was read: the Statbotics EPA rate that set its SHARE of the alliance and
    // the TBA match ledger that set the TOTAL.
    ref,
    // `netScoreSec` comes through from `scaleProfile` with the rest of the timeline: a machine credited with
    // 25 pieces a MATCH got them from a faster mechanism, and that includes the one that clears the NET's
    // 6 ft 4 in border. The finals ledger is what this is read against — 2025cmptx_f1m1's Johnson A1 sums to
    // 295 as 63 AUTO CORAL + 145 tele CORAL + 36 NET + 9 LEAVE + 36 DEEP + 6 FOUL, which is nine ALGAE in the
    // NET and none in the PROCESSOR, so the nets were lifted in by the ROBOTS.
    chassis: 'swerve', // every one of these was a swerve drivetrain in 2025
    canClimbDeep: deep, // three DEEP CAGES an ALLIANCE in the finals, both sides; the EPA BARGE column is what says otherwise
  };
}

const JOHNSON = [
  presetRobot(SAMPLES[0], { team: 1690, name: 'Orbit', pieces: 25.1, autoCycles: 3, ref: 'EPA 2025 auto_coral 4.19, auto_leave_points 3.02, total_game_pieces 25.59, the share of the 59 CORAL Johnson A1 placed in 2025cmptx_f1m1 (295)' }),
  presetRobot(SAMPLES[0], { team: 4414, name: 'HighTide', pieces: 21.8, autoCycles: 3, ref: 'EPA 2025 auto_coral 2.47, auto_leave_points 3.26, total_game_pieces 22.27, the share of the 59 CORAL Johnson A1 placed in 2025cmptx_f1m1 (295)' }),
  presetRobot(SAMPLES[0], { team: 2073, name: 'EagleForce', pieces: 12.1, autoCycles: 2, ref: 'EPA 2025 auto_coral 1.55, auto_leave_points 2.80, total_game_pieces 12.39, the share of the 59 CORAL Johnson A1 placed in 2025cmptx_f1m1 (295)' }),
];

const NEWTON = [
  presetRobot(SAMPLES[0], { team: 2910, name: 'Jack in the Bot', pieces: 22.2, autoCycles: 3, ref: 'EPA 2025 auto_coral 3.99, auto_leave_points 3.08, total_game_pieces 26.48, the share of the 56 CORAL Newton A1 placed in 2025cmptx_f1m1 (281)' }),
  presetRobot(SAMPLES[0], { team: 1323, name: 'MadTown', pieces: 21.5, autoCycles: 3, ref: 'EPA 2025 auto_coral 3.61, auto_leave_points 3.10, total_game_pieces 25.68, the share of the 56 CORAL Newton A1 placed in 2025cmptx_f1m1 (281)' }),
  presetRobot(SAMPLES[0], { team: 4272, name: 'Maverick', pieces: 12.4, autoCycles: 2, ref: 'EPA 2025 auto_coral 2.49, auto_leave_points 2.98, total_game_pieces 14.82, the share of the 56 CORAL Newton A1 placed in 2025cmptx_f1m1 (281)' }),
];

// The second batch is one row per TEAM rather than one ledger per ALLIANCE, because a preset is now a single
// machine's card. `pieces` is that team's per-match CORAL mean (`auto_coral` + `teleop_coral`) and
// `autoCycles` is `auto_coral` rounded, both read off
// https://storage.googleapis.com/site_v1/team_years/2025 on 2026-10-14 (3702 modelled team-years, 804,512 bytes
// of zlib). Two things follow from using a season mean instead of one read match, and both are stated rather
// than hidden: these are MODELLED contributions, not tallies — the same column gives team 1 a `net_algae` of
// -0.32 and nine teams a negative `total_game_pieces`, so the values are trusted only where they are far from
// that noise floor — and the AUTO count is a mean over ~60 MATCHes, so `autoCycles` is rounded rather than
// scripted. `barge_points` is the same export and it is what separates the two climb identities here, because a
// DEEP CAGE pays 12 and a PARKED one 2: a team credited with 2.79 BARGE points a MATCH is not hanging deep.
const NAMED = [
  presetRobot(SAMPLES[0], { team: 2056, name: 'OP Robotics', pieces: 25.5, autoCycles: 4, ref: 'EPA 2025 rank 1: auto_coral 4.01 + teleop_coral 21.49 a MATCH, net_algae 4.91, barge_points 12.37, 68-7-0 over 75 (read 2026-10-14)' }),
  presetRobot(SAMPLES[0], { team: 1678, name: 'Citrus Circuits', pieces: 21.02, autoCycles: 3, ref: 'EPA 2025 rank 5: auto_coral 3.49 + teleop_coral 17.53 a MATCH, net_algae 3.12, barge_points 12.16, 57-8-0 over 65 (read 2026-10-14)' }),
  presetRobot(SAMPLES[0], { team: 118, name: 'Robonauts', pieces: 22.08, autoCycles: 2, ref: 'EPA 2025 rank 6: auto_coral 2.46 + teleop_coral 19.62 a MATCH, net_algae 2.70, barge_points 11.99, 110-12-0 over 122 (read 2026-10-14)' }),
  presetRobot(SAMPLES[0], { team: 4678, name: 'CyberCavs', pieces: 22.37, autoCycles: 3, ref: 'EPA 2025 rank 10: auto_coral 3.33 + teleop_coral 19.04 a MATCH, net_algae 1.28, barge_points 10.09, 50-3-0 over 53 (read 2026-10-14)' }),
  presetRobot(SAMPLES[0], { team: 3683, name: 'Team DAVE', pieces: 19.29, autoCycles: 3, ref: 'EPA 2025 rank 11: auto_coral 3.34 + teleop_coral 15.95 a MATCH, net_algae 4.22 the largest ALGAE column in this batch, barge_points 5.36 (read 2026-10-14)' }),
  presetRobot(SAMPLES[0], { team: 694, name: 'StuyPulse', pieces: 19.33, autoCycles: 3, ref: 'EPA 2025 rank 12: auto_coral 3.08 + teleop_coral 16.25 a MATCH, barge_points 14.10 the highest climb column here, processor_algae 1.06 (read 2026-10-14)' }),
  presetRobot(SAMPLES[0], { team: 422, name: 'Mech Tech Dragons', pieces: 20.72, autoCycles: 2, ref: 'EPA 2025 rank 14: auto_coral 2.46 + teleop_coral 18.26 a MATCH, barge_points 13.27, net_algae 2.20, 60-8-0 over 68 (read 2026-10-14)' }),
  // The two rows whose BARGE column is at the PARKED rate get a machine that cannot hang deep, which is the
  // only way this file can say "they did not have a climber" without inventing a clock to say it with.
  presetRobot(SAMPLES[0], { team: 1778, name: 'Chill Out', pieces: 23.1, autoCycles: 2, deep: false, ref: 'EPA 2025 rank 16: auto_coral 2.25 + teleop_coral 20.85 a MATCH against barge_points 2.79 — the CORAL of a top-20 team and the ENDGAME of a parking one (read 2026-10-14)' }),
  presetRobot(SAMPLES[0], { team: 5990, name: 'TRIGON', pieces: 18.86, autoCycles: 2, deep: false, ref: 'EPA 2025 rank 28: auto_coral 2.49 + teleop_coral 16.37 a MATCH against barge_points 2.56, 46-13-2 over 61 (read 2026-10-14)' }),
];

export const PRESETS = [
  {
    key: 'model',
    label: 'Calibrated trio',
    note: 'the three roles the engine was calibrated on, not a real team',
    trio: SAMPLES,
  },
  {
    key: 'johnson',
    label: 'Johnson A1 · 1690 / 4414 / 2073',
    note: '2025 Einstein Field runner-up (captain 1690): 295, 274, 276 across the three finals',
    trio: JOHNSON,
  },
  {
    key: 'newton',
    label: 'Newton A1 · 2910 / 1323 / 4272',
    note: '2025 Einstein Field champions (captain 1323): 281, 285, 293 in the finals, and 301 — the highest ALLIANCE the field saw',
    trio: NEWTON,
  },
];

export const SCORING_ELEMENT_LIMITS = PIECES.carryLimit;

// The same machines, one entry per ROBOT, because a preset is a per-slot choice: the 2026 page lets a team
// field its own three machines by picking each one, while an ALLIANCE-level picker can only load a whole trio
// and then throw away two of the three selections. The trios above stay in the model because guard 17 reads
// them as calibrated ALLIANCE ledgers — the point of a named trio is that its three numbers sum to a recorded
// match — and the page still defaults each side to one of them.
const ROLE_NOTE = {
  coral3lvl: 'the REEF machine the mirror was calibrated on: 160 in/s and the four-level ladder that lands the 2025cmptx branch fill',
  algae: 'the ALGAE machine: shorter reach, so its misses concentrate at L4',
  climber: 'the support machine: a tank chassis, the slowest arm in the file and the quickest climb',
};

export const ROBOT_PRESETS = [
  ...SAMPLES.map((p) => ({ key: p.key, label: p.name, note: ROLE_NOTE[p.key] || p.note || '', profile: p })),
  ...JOHNSON.map((p) => ({ key: p.key, label: `#${p.team} ${p.name}`, note: p.ref, profile: p })),
  ...NEWTON.map((p) => ({ key: p.key, label: `#${p.team} ${p.name}`, note: p.ref, profile: p })),
  ...NAMED.map((p) => ({ key: p.key, label: `#${p.team} ${p.name}`, note: p.ref, profile: p })),
];

// Which preset a card is showing: the numbers, not the name, because a driver who edits one field has built a
// different machine and the card should stop claiming to be somebody else's.
const PRESET_MATCH_KEYS = [
  'driveSpeedIps', 'turnRateDegS', 'accelIpsS', 'weightLb', 'pickSec', 'algaeStripSec',
  'climbSec', 'climbSuccess', 'netScoreSec', 'autoCycles', 'reliability', 'chassis', 'canClimbDeep', 'placeTolDeg',
];

export function presetIndexOf(p) {
  if (!p) return -1;
  const same = (a, b) => (typeof a === 'number' || typeof b === 'number'
    ? Math.abs((a ?? 0) - (b ?? 0)) < 1e-6
    : a === b); // `chassis` is a string and `canClimbDeep` a boolean; subtracting either gives NaN, which
  // compares false against everything, so every card used to read "Custom" on a machine it had just loaded.
  return ROBOT_PRESETS.findIndex((r) => {
    const q = r.profile;
    return PRESET_MATCH_KEYS.every((k) => same(q[k], p[k]))
      && ['L1', 'L2', 'L3', 'L4'].every((lv) => same(q.placeSec[lv], p.placeSec[lv])
        && same(q.placeDrop?.[lv] ?? 0, p.placeDrop?.[lv] ?? 0));
  });
}

// The HUMAN PLAYER. What it may do is rules; how fast it does it is not.
//   §6.1  "HUMAN PLAYERS can score ALGAE in their NET once it has been passed to them via their
//         opponent's PROCESSOR" - so the ALGAE this actor throws are the ones the OTHER side processed
//         (§5.5: through the PROCESSOR and into the opponent's PROCESSOR AREA). The same sentence gives
//         the ROBOT its own NET, and those pieces never reach a PROCESSOR at all.
//   G433  CORAL enters the field only through a CORAL STATION, ALGAE only from a PROCESSOR AREA.
//   G435  no more than 4 ALGAE may be stored in a PROCESSOR AREA (3 in the holders + 1 on the ramp).
//   G404  no ALGAE may be entered during AUTO.
export const HUMAN_PLAYER = {
  throwSec: 2.2, // [estimate] one NET throw per 2.2 s, misses included: a throw attempt takes the slot
  accuracy: 0.75, // [estimate] fraction of throws that end above and inside the NET (§6.5.1)
  feedSec: 1.4, // [estimate] CORAL pushed through the CHUTE per station
  storage: 4, // G435: 3 in the holders on top of the PROCESSOR + 1 at the end of the exit ramp
};

export function defaultScenario() {
  return {
    seed: 1,
    // No `objective` and no `event` key here, unlike the 2026 build's scenario. Both were dead: nothing in
    // `engine.js`, `policy.js`, `ai.js` or any committed script reads either one, and the second has no rule
    // to hold — Table 6-2's footnote says the CORAL and BARGE RP bars "may increase" at District/Championship
    // and prints no other number, so a selector would grade a MATCH against a value nobody published. The
    // knob the 2025 manual does give is `playoff` below, which is the page's "Qualification scoring" box.
    cageDepth: { blue: [true, false, true], red: [true, false, true] }, // §6.3.5 team choice, per MATCH
    autoWinner: null, // no sitting-out in 2025; both alliances play all three ROBOTS
    algaeInNetByHuman: true, // §6.1: the HUMAN PLAYER's half of the NET — a ROBOT with the reach scores there too, and that is `netScoreSec`
    // `[estimate]` how many ALGAE one ALLIANCE's mesh can hold; rules.js derives 9 from three 48 in lanes of
    // border taking three 16 in rings (§5.4.2, §5.7.2) each. §6.5.1 caps nothing, so this is a modelled limit
    // and the ablation that turns it off is `netCapacity: 18` — every ring §6.3.4.2 stages a MATCH.
    netCapacity: NET_CAPACITY,
    // #117's other half, and its off value is the pre-#117 engine: three ROBOTS lifting into the same middle
    // of the 12 ft face. `scripts/measure.mjs` prices the stand-off and the ceiling apart on this key and the
    // one above, and `npm run verify` pins the both-off pair to the digest committed before either existed.
    netLaneSpread: true,
    playoff: false, // §6.5.3 / G418: a PLAYOFF series awards no Coopertition Point and no G418 BARGE RP. G410 and G428 carry no such qualifier.
    // `[estimate]` Two alliances running the same DESIGN still field different machines: one drivetrain is
    // tuned a little hotter, one operator is slower at the branch, one HUMAN PLAYER throws flatter. Without
    // this a mirror MATCH is one deterministic process played twice, and 14 of every 96 finished on exactly
    // the same number with 41 of 96 within 3 points. The sweep in scripts/measure.mjs prices the spread: at
    // ±20% the exact ties fall to 7/96 and the mean |margin| reaches 10.1, which is the floor of the three
    // real 2025 Einstein Field finals margins (11, 14, 17). Matching the middle of that band takes ±40%,
    // more difference than two copies of one design should have — what is left is the REEF being drained,
    // not the jitter, and that is Stage 3's calibration. 0 is the old deterministic mirror.
    tempoJitter: 0.20,
    // The corner pile-up escape in engine.js, off. Three ROBOTS can pin each other against the guardrail at
    // their own CORAL STATION and hold that spot for the rest of the MATCH; the escape has them back out
    // after three seconds of making no ground on their waypoint. Off is the ablation the guard reads, not a
    // setting anyone should ship: with it off the weakest ALLIANCE in the 48-MATCH batch finished on 9 CORAL
    // of the 60 the field holds.
    unstickOff: false,
    // #124: steer around the REEF instead of into it. `engine.js` takes the straight line to a waypoint, and a
    // waypoint on the far side of a hexagon is behind structure. `npm run measure` reads what that costs the
    // machine that ends up against it: 3.61% of ROBOT-seconds are a pinned ROBOT with its waypoint more than 22
    // in away on the other side of a REEF, 9.1 such episodes a MATCH, and the longest one 39.6 s of a 150 s
    // clock. Off is the ablation and the pre-#124 engine.
    detourOff: false,
    // The width of that berth, in inches beyond the hexagon's corner plus the car. Swept by `npm run measure`.
    detourClearIn: 8,
    // ...and how long a machine has to be pressing before it is told to go around, in seconds of closing less
    // than 1.5 in on the same waypoint with a hexagon on the line. `0` diverts every blocked trip instead, which
    // is the arm `npm run measure` prices: it takes the pinned-and-blocked share to 0.33% and nearly three CORAL
    // an ALLIANCE off the named preset's throughput (Johnson 55.0 against the shipped 57.9), because a fleet
    // working its own REEF has a hexagon on the line almost always. 0.6 catches the machines that actually stick
    // (0.49%, 1.9 episodes a MATCH, longest 9.2 s), costs nothing on that same column, and stays under the 3 s
    // the pile-up test counts. `[estimate]`, swept.
    detourPressSec: 0.6,
    // #125: `[estimate]` how often a CORAL shaken loose by hard driving lands on the carpet, per second of it.
    // The manual bills a piece that falls (§6.5.1 counts only a BRANCH inside the volume of the CORAL) and never
    // says how it came to fall, so the rate is set on a sweep over what a MATCH can visibly afford, not on a
    // rule. 0 spends no random number and is the pre-fix engine and the page's off value.
    carryDrop: CARRY_DROP_PER_SEC,
    // #126: a branch is claimed by the machine that started driving to it first, so the second ally bids the
    // next pipe instead of arriving to find its branch taken. The engine books a branch only when the placement
    // completes, so before this all three machines took the same nearest free branch from wherever they came
    // off the STATION: `npm run measure` counts 27.3 ROBOT-seconds an ALLIANCE-MATCH (greedy, base 9000) spent
    // aimed at a pipe another ally already had against 9.3 with the claim, and 23.7 against 9.7 for the planner.
    // `false` is the ablation, and it is worth no points either way — the claim is a steering fact.
    branchDedup: true,
    // #127: a climb can miss. Each ROBOT's own `climbSuccess` is rolled when the ascent finishes, and a miss
    // leaves it on the carpet beside the pipe it claimed, still able to try again while the clock runs — and
    // reading as a PARK under §6.5 when it does not. `false` rolls the number and ignores it, which is the
    // engine that never dropped a CAGE, and it is the value `npm run verify` pins the replay on.
    climbRisk: true,
    // The placement model in engine.js: a CORAL only counts when §6.5.1's geometry is satisfied — the BRANCH
    // inside the volume of the CORAL — and a piece pushed in off-axis does not satisfy it, so it falls. Off
    // is the ablation and the control, and it is the engine that produced the replay committed before this
    // existed: every branch filled, every MATCH.
    placementRisk: true,
    // §7.4.4: G423 (damage or functional impairment) and G424 (a deliberate tip), one call per collision, the
    // more punitive of the two only. The probability that a hit in the tail of the severity distribution
    // actually breaks something is the one number in the family with no anchor in the manual, so `false` is
    // the ablation and `npm run contact` is what places the thresholds against the real 2025 rate of 0-2
    // fouls a MATCH. G422 needs a COMPONENT outside the ROBOT PERIMETER, which no machine in this build has.
    contactFouls: true,
    // §6.6.2, verbatim: "YELLOW CARDS are additive, meaning that a second YELLOW CARD is automatically
    // converted to a RED CARD, including earning a second YELLOW CARD during a single MATCH", and a RED CARD
    // DISQUALIFIES the team — §5 defines DISQUALIFIED as inoperable for the remainder of the MATCH, and a
    // DISQUALIFIED team books 0 MATCH points and 0 Ranking Points in a Qualification match. `true` is that
    // rule. `false` is the ablation `scripts/cards.mjs` prices: a second warning that is only a yellow
    // rectangle on the audience display, with the machine still on the carpet. The conversion itself draws
    // nothing — it reads the tally the foul already incremented — but a machine that keeps driving spends
    // the rest of the MATCH differently, so the off arm is a different MATCH, not the same one rolled again.
    cardLadder: true,
    // Per-ALLIANCE HUMAN PLAYER settings, all `[estimate]` except the storage limit.
    humanPlayer: {
      blue: { ...HUMAN_PLAYER },
      red: { ...HUMAN_PLAYER },
    },
  };
}
