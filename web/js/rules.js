// REEFSCAPE (2025 FRC) rule constants.
//
// Every value below is transcribed from the 2025 Game Manual, V13, downloaded from
// https://firstfrc.blob.core.windows.net/frc2025/Manual/2025GameManual.pdf — the citation is the clause
// or table it comes from. A value that is NOT in the manual is labelled `[estimate]` and is a modelling
// assumption, never a rule claim; those are the ones Stage 3 calibrates against real 2025 match data.
//
// Units: inches and seconds. The manual states ft/in with a metric approximation; the inch value below
// is the ft/in converted exactly, not rounded to the manual's cm figure.

// ---------------------------------------------------------------------------
// Arena (§5.1 FIELD, §5.3 REEF, §5.4 BARGE, §5.4.1 CAGE, §5.4.2 NET, §5.5 PROCESSOR, §5.6.2 CORAL STATION)
// ---------------------------------------------------------------------------
// The field is 26 ft 5 in across (the short axis, between the two long guardrails) and 57 ft 6 in
// between the alliance walls, so the LONG axis is the one the two REEFs sit along. That is what makes
// the 29 ft 2 in BARGE fit: it spans the short axis and its legs stand outside the guardrail (§5.4).
export const FIELD = {
  longIn: 57 * 12 + 6, // 690 in — §5.1
  wideIn: 26 * 12 + 5, // 317 in — §5.1
  // Robot positions run along the alliance wall; x is the long axis, blue wall at x = 0.
};

export const GEO = {
  reef: {
    hexAcrossFlatsIn: 5 * 12 + 5, // 65 in — §5.3 "5 ft 5 in (~166 cm) hexagonal structures"
    // §5.3: "Each REEF has 4 levels"; §5.x gives 12 BRANCHES on L2, 12 on L3, 12 on L4 (36 branches),
    // two per face on six faces, pipes 1 ft 1 in apart center to center.
    branchesPerLevel: 12, // §5.3 (L2/L3/L4 each "the 12 ... BRANCHES")
    levels: 4, // §5.3
    pipeSpacingIn: 12 + 1, // 13 in center-to-center on a face — §5.3
    // Heights are the highest point of the branch, measured from the carpet (§5.3).
    heightIn: {
      L1: 12 + 6, // trough front edge 1 ft 6 in — §5.3
      L2: 2 * 12 + 7, // 31 in — §5.3
      L3: 3 * 12 + 11, // 47 in — §5.3
      L4: 6 * 12, // 72 in — §5.3
    },
    // §5.3: L2 and L3 branches are angled up at 35°, L4 branches are vertical, each inset ~1 in from
    // the REEF base. The angle is what makes a high branch slower to reach than a low one.
    branchAngleDeg: { L2: 35, L3: 35, L4: 0 },
  },
  // §5 definition: REEF ZONE is a 6-sided volume, 7 ft 9½ in wide face-to-face, surrounding the REEF.
  reefZone: { acrossFlatsIn: 7 * 12 + 9.5 }, // 93.5 in — §5 (definitions)
  // §5.4: BARGE is 29 ft 2 in wide × 3 ft 8 in deep × 8 ft 5 in tall, truss 5 ft 2 in above the carpet,
  // with 3 CAGE locations per side at 3 ft 5½ in, 7 ft and 10 ft 7 in from midfield.
  barge: {
    widthIn: 29 * 12 + 2, // 350 in
    depthIn: 3 * 12 + 8, // 44 in — the truss structure itself
    heightIn: 8 * 12 + 5, // 101 in
    trussHeightIn: 5 * 12 + 2, // 62 in
    // §5 definitions: the BARGE ZONE is "a 3 ft. 10 in. deep by 12 ft. 2½ in. long … volume surrounding
    // the ALLIANCE'S half of the BARGE". It is a different number from the truss depth above, and each
    // ALLIANCE owns the half on its own side of the centreline.
    zoneDepthIn: 3 * 12 + 10, // 46 in
    cageOffsetsFromMidfieldIn: [3 * 12 + 5.5, 7 * 12, 10 * 12 + 7], // 41.5, 84, 127
  },
  // §5.4.1: a CAGE is 2 ft tall × 7 in wide. Staged shallow its bottom sits 2 ft 6⅛ in off the carpet;
  // staged deep, 3⅛ in. A team picks the height of the CAGE nearest its driver stations (§6.3.5).
  cage: {
    heightIn: 24,
    widthIn: 7,
    shallowBottomIn: 2 * 12 + 6.125,
    deepBottomIn: 3.125,
    shallowPoints: 6, // Table 6-2
    deepPoints: 12, // Table 6-2
    parkPoints: 2, // Table 6-2: PARK in the BARGE ZONE, no CAGE points
  },
  // §5.4.2: NET is 4 ft × 12 ft mesh, lowest point 6 ft 4 in above the carpet, suspended from the TOP of
  // the BARGE. §6.1 scores ALGAE there for the ALLIANCE and a ROBOT is one of the two actors that can put
  // one there (the other is the HUMAN PLAYER), so the reach is a property of the machine, not of the rule:
  // R104's 3 ft 6 in caps the STARTING CONFIGURATION only. G420 forbids CONTACTING it, not scoring in it.
  net: { widthIn: 48, lengthIn: 144, lowPointIn: 6 * 12 + 4 },
  // §5.5: PROCESSOR opening is 2 ft 4 in wide × 1 ft 8 in tall, sill 7 in off the carpet.
  processor: { openingWidthIn: 2 * 12 + 4, openingHeightIn: 12 + 8, sillIn: 7 },
  // §5 definition: PROCESSOR AREA is 3 ft 7 in wide × 7 ft 6 in deep.
  processorArea: { widthIn: 3 * 12 + 7, depthIn: 7 * 12 + 6 },
  // §5.6.2: 4 CORAL STATIONS, one per corner, opening 6 ft 4 in wide × 7 in tall; the CHUTE feeds it.
  coralStation: { openingWidthIn: 6 * 12 + 4, openingHeightIn: 7 },
  // §5 definition: the ROBOT STARTING LINE spans the width between each REEF and the BARGE, 7 ft 4 in
  // from the REEF. Datum is read as REEF centre; the field drawings would pin it exactly (see README).
  startingLineFromReefIn: 7 * 12 + 4, // 88 in
};

// ---------------------------------------------------------------------------
// Game pieces (§5.7.1 CORAL, §5.7.2 ALGAE)
// ---------------------------------------------------------------------------
export const PIECES = {
  coral: {
    lengthIn: 11, // §5.7.1 "11 in. long (~30 cm) piece of 4 in. diameter ... PVC pipe"
    diameterIn: 4,
    weightLb: [1.1, 1.8], // §5.7.1
    stagedPerMatch: 126, // §6.3.4.1
    onMarks: 6, // §6.3.4.1 A: 1 CORAL on each of the 6 CORAL MARKS
    preloadedMax: 6, // §6.3.4.1 B: up to 1 per ROBOT
    behindStationsPerAlliance: [57, 60], // §6.3.4.1 C: the remainder split behind the CORAL STATIONS
  },
  algae: {
    diameterIn: [16, 16.5], // §5.7.2 inflated to between 16 in and 16.5 in
    stagedPerMatch: 18, // §6.3.4.2: 12 on the two REEFs (6 each, one straddling each face's BRANCH pair) + 1 on each mark CORAL
    onReef: 12, // §6.3.4.2 A, field total: 6 per ALLIANCE
    onCoralMarks: 6, // §6.3.4.2 B, field total: 3 per ALLIANCE
  },
  // G409 "1 of each at a time": a ROBOT may not CONTROL more than 1 CORAL and 1 ALGAE simultaneously.
  carryLimit: { coral: 1, algae: 1 },
};

// ---------------------------------------------------------------------------
// NET capacity (§5.4.2 geometry + §5.7.2 ring size; §6.5.1 sets no number)
// ---------------------------------------------------------------------------
// The mesh is 4 ft × 12 ft, so its long face splits into three 4 ft squares of border, and each of an
// ALLIANCE's three ROBOTS gets one. `[estimate]` how many rings a patch holds: a ring is 16 in across
// (§5.7.2's lower bound) and 48 in of border takes three laid end to end, so 9 an ALLIANCE. This is geometry,
// not a clause — §6.5.1 counts a ring "contacting the NET or ALGAE contacting the NET", which makes stacking
// legal, and the only ceiling the rules do impose is the 18 ALGAE §6.3.4.2 stages a MATCH. A full single
// layer (floor(48/16.5) × floor(144/16.5) = 16) is the other reading, and it never binds: the busiest NET in
// 192 measured alliances was 15.
export const NET_LANES = Math.round(GEO.net.lengthIn / GEO.net.widthIn); // 3
export const NET_LANE_CAPACITY = Math.floor(GEO.net.widthIn / PIECES.algae.diameterIn[0]); // 3
export const NET_CAPACITY = NET_LANES * NET_LANE_CAPACITY; // 9

// ---------------------------------------------------------------------------
// Match clock (§6.4 MATCH Phases)
// ---------------------------------------------------------------------------
export const TIME = {
  autoSec: 15, // §6.4
  teleopSec: 2 * 60 + 15, // §6.4 "the remaining 2 minutes and 15 seconds"
  matchSec: 15 + 2 * 60 + 15, // 150 s
  assessGraceSec: 3, // §6.5 A/B: scoring assessment continues up to 3 s after 0:00
  cageAssessAfterSec: 3, // §6.5 C: CAGE points assessed 3 s after 0:00, or when all ROBOTS rest
  bargeLightsFlashAtSec: 20, // §5.4: the BARGE lights flash for the final 20 s
};

// ---------------------------------------------------------------------------
// Points and Ranking Points (Table 6-2, read from the manual's table columns AUTO | TELEOP |
// MATCH points | Ranking Points | Coopertition Points)
// ---------------------------------------------------------------------------
export const POINTS = {
  leave: 3, // Table 6-2, AUTO column. Per ROBOT (§6.5.2 defines it per ROBOT).
  coral: {
    // Table 6-2: [AUTO, TELEOP] per scored CORAL at that level.
    L1: [3, 2], // trough
    L2: [4, 3],
    L3: [6, 4],
    L4: [7, 5],
  },
  algae: {
    processor: [6, 6], // Table 6-2: same in both periods
    net: [4, 4],
  },
  park: 2, // Table 6-2, TELEOP column: BARGE ZONE, no CAGE points
  cageShallow: 6, // Table 6-2
  cageDeep: 12, // Table 6-2
  coopertition: 1, // Table 6-2 + §6.5.3: at least 2 ALGAE in each ALLIANCE'S PROCESSOR
  rp: {
    auto: 1, // Table 6-2: every non-BYPASSED ROBOT LEAVEs and at least 1 CORAL scored in AUTO
    coral: 1, // Table 6-2: at least 7 CORAL scored on each level; with Coopertition, 7 on each of 3 levels
    barge: 1, // Table 6-2: at least 16 BARGE points
    win: 3,
    tie: 1,
  },
  coralRpThresholdPerLevel: 7, // Table 6-2
  coralRpLevelsWithCoop: 3, // Table 6-2: "at least 7 CORAL ... on each of 3 levels"
  bargeRpThreshold: 16, // Table 6-2
  autoRpMinCoral: 1, // Table 6-2
  coopMinAlgaePerProcessor: 2, // §6.5.3
  // Those four bars are ONE column, on purpose. The Table 6-2 footnote reads: "*For District Championship
  // and/or FIRST Championship events, the CORAL or BARGE RP requirement may increase" — and prints no other
  // number. The 2026 manual's Table 6-5 does print a district CHAMPIONSHIP column next to the regional one,
  // so that build has an event selector and this one must not fake one: a knob whose values nobody published
  // would grade a MATCH against an invention. Every place the bars appear on the page — the batch's RP legend,
  // the live RP ladder, the Rule sources table — is spelled out of these constants, because the legend used to
  // carry its own numbers and read "≥3 CORAL placed in AUTO", "4 CORAL at each of L2-L4" and "≥12 BARGE
  // points" while the engine graded 1, 7 on each of four levels (three with Coopertition) and 16.
  // `scripts/rp.mjs` recomputes every RP from these numbers and compares with the engine, MATCH by MATCH.
};

// ---------------------------------------------------------------------------
// Violations (§6.6, Table 6-3)
// ---------------------------------------------------------------------------
export const FOULS = {
  minor: 2, // Table 6-3: MINOR FOUL credits 2 points to the opponent
  major: 6, // Table 6-3: MAJOR FOUL credits 6 points
  // Modelled in the sim. The clause is in brackets so an ablation can name it.
  // `awards` is part of the violation, not an extra: the manual hands the opponent a Ranking Point for
  // three of these, and a sim that only charges the 6 points understates a cage-contact foul by a whole RP.
  // Severity column checked line by line against §7.4 (V11) — G403/G405/G411/G412/G418/G427 are MAJOR.
  // `by` is how the clause binds in THIS build, and it is on the page because a reader cannot tell from
  // the clause list which ones the simulator can actually commit:
  //   charge  — a referee call the engine adjudicates and scores
  //   block   — the action set cannot produce the violation, so it never happens
  //   none    — no corresponding action exists yet (Stage 2/3 territory; listed, not modelled)
  // There is no 'reach' band any more. Two clauses had been parked there on the argument that the ANCHORS
  // and the NET hang above R104's 3 ft 6 in cap, and that is wrong twice over: R104 measures the STARTING
  // CONFIGURATION, and §5.4.1 lists ANCHOR surfaces G/inside and F/upper end of the CAGE pipes, which for a
  // DEEP CAGE sit 3-27 in off the carpet. A ROBOT is beside them all MATCH.
  list: {
    G403: { sev: 'major', by: 'charge', what: 'in AUTO, contacting an opponent from across the BARGE ZONE' },
    G405: { sev: 'major', by: 'charge', what: "in AUTO, a ROBOT contacts an opposing ALLIANCE's CAGE" },
    G409: { sev: 'minor', by: 'block', what: 'CONTROLLING more than 1 CORAL and 1 ALGAE at a time' },
    G410: { sev: 'major', by: 'none', what: "de-scoring a CORAL scored on the opponent's REEF", awards: 'coral' },
    G411: { sev: 'major', by: 'none', what: "deliberately putting ALGAE on the opponent's REEF" },
    G412: { sev: 'major', by: 'block', what: 'launching CORAL with BUMPERS outside its own REEF ZONE' },
    G418: { sev: 'major', by: 'charge', what: "in TELEOP, contacting an opponent's CAGE", awards: 'barge', qualOnly: true },
    G419: { sev: 'major', by: 'none', what: 'contacting ANCHORS; the ROBOT also loses its CAGE points' },
    G420: { sev: 'major', by: 'block', what: 'contacting either NET, or any ALGAE scored in an opponent NET' },
    // §7.4.4 opens with: "G422, G423, G424 are mutually exclusive. A single ROBOT to ROBOT interaction which
    // violates more than 1 of these rules results in the most punitive penalty, and only the most punitive
    // penalty, being assessed." So engine.js adjudicates the three together, one call per collision.
    // G421 sits in §7.4.3 above that note, so a defender that also hits somebody answers for both.
    G421: { sev: 'minor', escalates: 'major', by: 'charge', what: "2+ ROBOTS on the opponent's side with their BUMPERS beyond the BARGE ZONES; MAJOR every 3 s uncorrected" },
    G422: { sev: 'minor', by: 'block', what: 'initiating contact with a COMPONENT outside the ROBOT PERIMETER (except its BUMPERS)' },
    G423: { sev: 'major', card: 'yellow', by: 'charge', what: 'damaging or functionally impairing an opponent ROBOT, deliberately or by initiating contact' },
    G424: { sev: 'major', card: 'yellow', by: 'charge', what: 'deliberately attaching to, tipping or entangling an opponent ROBOT' },
    G425: { sev: 'minor', escalates: 'major', by: 'charge', what: 'PINNING an opponent for more than 3 seconds; MAJOR for every 3 s not corrected' },
    G426: { sev: 'major', by: 'none', what: 'two or more ROBOTS colluding to shut down a major part of gameplay' },
    G427: { sev: 'major', by: 'charge', what: "contacting an opponent ROBOT inside the opponent's BARGE ZONE or REEF ZONE, whoever initiates" },
    G428: { sev: 'major', by: 'charge', what: 'contacting an opponent ROBOT that is touching an opponent CAGE in the last 20 s', awards: 'barge' },
  },
};

// ---------------------------------------------------------------------------
// Robot constraints (§5.2 / R103 / G415 / G422-G424)
// ---------------------------------------------------------------------------
export const ROBOT_LIMITS = {
  weightLbMax: 115, // R103
  perimeterInMax: 120, // R104: STARTING CONFIGURATION perimeter may not exceed 120 in (~304 cm)
  heightInMax: 3 * 12 + 6, // R104: no more than 3 ft 6 in (~106 cm) tall
  // G415 / R105: a ROBOT may not extend more than 1 ft 6 in beyond the vertical projection of its
  // ROBOT PERIMETER.
  expansionIn: 18,
  // 120 in of perimeter measured on the assembled ROBOT is a 30 in square, and R104 measures the
  // STARTING CONFIGURATION, bumpers included, so no separate bumper allowance is added. The sim's
  // collision box is that square, oriented by the ROBOT's heading: the earlier 34 in was a bumper
  // guess that made every contact test 4 in too generous.
  footprintIn: 30,
  footprintHalfIn: 15,
  // G409 caps what it can hold, not how fast. Speed and manipulation rates are NOT rules — see the
  // `[estimate]` profiles in model.js, which is where a real team's numbers belong.
};

export const PERIODS = ['AUTO', 'TELEOP'];
