// Field layout, branch inventory and ROBOT profiles for REEFSCAPE.
//
// Coordinates: x runs along the 690 in long axis (the alliance walls are the short ends, blue at x = 0),
// y across the 317 in width. Everything in `layout()` whose *position* is not written down in the manual
// is marked `[estimate]` — the manual gives element DIMENSIONS with clause numbers (those are in
// rules.js) but the exact station/processor offsets live in the 2025 field drawings, which are not
// transcribed here yet. Stage 3 pins them.

import { FIELD, GEO, PIECES } from './rules.js';

// Which side of the field each ALLIANCE owns.
export const SIDES = ['blue', 'red'];

export function layout() {
  const midX = FIELD.longIn / 2;
  const midY = FIELD.wideIn / 2;
  const perSide = {};
  for (const side of SIDES) {
    const toward = side === 'blue' ? 1 : -1;
    const reefX = side === 'blue' ? 144 : FIELD.longIn - 144; // §5.3 "12 ft away from the ALLIANCE WALL"
    perSide[side] = {
      reef: { x: reefX, y: midY, apothem: GEO.reef.hexAcrossFlatsIn / 2 },
      reefZone: { x: reefX, y: midY, apothem: GEO.reefZone.acrossFlatsIn / 2 },
      // The starting line is 88 in from the REEF, between it and the BARGE (§5 definitions). ROBOTS
      // start on the REEF side of it and LEAVE by crossing toward the BARGE.
      startingLineX: reefX + toward * GEO.startingLineFromReefIn,
      // ROBOTS begin between their REEF and its starting line, 3 abreast along the wall side.
      robotStart: [
        { x: reefX + toward * 40, y: midY - 40 },
        { x: reefX + toward * 40, y: midY },
        { x: reefX + toward * 40, y: midY + 40 },
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

// The six CORAL MARKS (§5 definitions, §6.3.4.1 A: 1 CORAL each, 6 total) sit on each alliance's side,
// and 1 ALGAE rests on top of each of them (§6.3.4.2 B). `[estimate]` exact mark positions.
export function coralMarks(geo, side) {
  const r = geo[side].reef;
  const toward = side === 'blue' ? 1 : -1;
  const out = [];
  for (const dy of [-1, 0, 1]) {
    out.push({ x: r.x + toward * (r.apothem + 16), y: r.y + dy * 42 });
  }
  return out;
}

// 6 ALGAE staged on each REEF in three two-piece positions, and 1 on top of the CORAL at each of that
// ALLIANCE's 3 CORAL MARKS — §6.3.4.2 A and B, which together with the other REEF make the 18 a MATCH
// is played out of. `[estimate]` which faces carry them; the counts and the pairing are §6.3.4.2.
export function reefAlgae(geo, side) {
  const r = geo[side].reef;
  return [-0.75, 0, 0.75].map((k) => ({
    x: r.x + (k % 2) * 20,
    y: r.y + k * (r.apothem + 8),
  }));
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
export function branchSlots(center) {
  const out = [];
  const faceNormal = (k) => (Math.PI / 3) * k + Math.PI / 6;
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
// greedy — which bids margin per second — stops routing ALGAE through the PROCESSOR at all (9.0 rings a MATCH
// fall to 3.1), the opponent's HUMAN PLAYER has nothing left to throw, nobody earns the §6.5.3 Coopertition,
// and the mirror loses about 27 points an ALLIANCE. It is also what the one read-line-by-line ledger says:
// 2025cmptx_f1m1's Johnson A1 totals 295 as 63 AUTO CORAL + 145 tele CORAL + 36 NET + 9 LEAVE + 36 DEEP + 6
// FOUL, which is 9 ALGAE in the NET and NONE in the PROCESSOR — the nets were lifted in, not thrown up. The
// same two trios with the reach forced back to 0 print 334.2 and 337.0 on guard 17's own 48 alliance-sides;
// carrying it they print 305.9 against the recorded 295 and 307.5 against 281. `npm run measure`'s netScoreSec
// arms price the route both ways, and 0 stays the ablation.
export const SAMPLES = [
  {
    key: 'coral3lvl',
    name: 'Full-cycle scorer',
    // `[estimate]` calibrated, not guessed: at 160 in/s (4.1 m/s) with these action times the mirror lands
    // on the 2025 Einstein Field ledger TBA records — 12/12/12 BRANCHES, 13.9 trough CORAL, 49.2 CORAL in
    // all against the recorded 12/12/12, 15.1 and 49.66. Slower or slower-driving profiles leave the trough
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
// the third, and every one of the six crossed the line (TBA's per-team auto-leave rate is 97.7-100%).
const REF_CORAL_PER_ROBOT = 16.5; // fitted so a scaled trio lands on the recorded ALLIANCE totals (see below)

// `[estimate]` the fastest 2025 chassis ran about 4.6 m/s, ~180 in/s, so the drivetrain half of the scale is
// clipped: a ROBOT credited with 25 CORAL a MATCH did not get them by outrunning everyone by 50%, it got
// them from a faster mechanism and cleaner paths. Only the action times take the full scale.
const MAX_PRESET_SPEED_IPS = 185;

function presetRobot(base, { team, name, pieces, autoCycles }) {
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
    // `netScoreSec` comes through from `scaleProfile` with the rest of the timeline: a machine credited with
    // 25 pieces a MATCH got them from a faster mechanism, and that includes the one that clears the NET's
    // 6 ft 4 in border. The finals ledger is what this is read against — 2025cmptx_f1m1's Johnson A1 sums to
    // 295 as 63 AUTO CORAL + 145 tele CORAL + 36 NET + 9 LEAVE + 36 DEEP + 6 FOUL, which is nine ALGAE in the
    // NET and none in the PROCESSOR, so the nets were lifted in by the ROBOTS.
    chassis: 'swerve', // every one of these was a swerve drivetrain in 2025
    canClimbDeep: true, // three DEEP CAGES an ALLIANCE in the finals, both sides
  };
}

const JOHNSON = [
  presetRobot(SAMPLES[0], { team: 1690, name: 'Orbit', pieces: 25.1, autoCycles: 3 }),
  presetRobot(SAMPLES[0], { team: 4414, name: 'HighTide', pieces: 21.8, autoCycles: 3 }),
  presetRobot(SAMPLES[0], { team: 2073, name: 'EagleForce', pieces: 12.1, autoCycles: 2 }),
];

const NEWTON = [
  presetRobot(SAMPLES[0], { team: 2910, name: 'Jack in the Bot', pieces: 22.2, autoCycles: 3 }),
  presetRobot(SAMPLES[0], { team: 1323, name: 'MadTown', pieces: 21.5, autoCycles: 3 }),
  presetRobot(SAMPLES[0], { team: 4272, name: 'Maverick', pieces: 12.4, autoCycles: 2 }),
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
    objective: 'rs',
    event: 'regional',
    cageDepth: { blue: [true, false, true], red: [true, false, true] }, // §6.3.5 team choice, per MATCH
    autoWinner: null, // no sitting-out in 2025; both alliances play all three ROBOTS
    algaeInNetByHuman: true, // §6.1: the HUMAN PLAYER's half of the NET — a ROBOT with the reach scores there too, and that is `netScoreSec`
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
    // Per-ALLIANCE HUMAN PLAYER settings, all `[estimate]` except the storage limit.
    humanPlayer: {
      blue: { ...HUMAN_PLAYER },
      red: { ...HUMAN_PLAYER },
    },
  };
}
