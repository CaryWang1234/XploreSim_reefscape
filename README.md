# XploreSim REEFSCAPE

A tick-level simulator of the 2025 FRC game REEFSCAPE, and the tactical page that shows it. It is the
sibling of the 2026 REBUILT simulator: same engine shape (kinematic ticks, a policy per robot, a replay
you can scrub), different game.

The manual is the source. §5 gives the arena, §6 the scoring, §7 the fouls. Every constant in
`web/js/rules.js` carries its clause; every number that is NOT in the manual is marked `[estimate]` at
its definition. That separation is the product — a planner is only as good as what it is allowed to
assume.

## Quick start

```
npm run serve      # http://127.0.0.1:4188
npm run check      # encoding, HTML tag balance, every module parses
npm run verify     # engine invariants, the golden replay fingerprint, the mirror, the planner
npm run measure    # the A/B numbers quoted on the page, each with its n
npm run headroom   # which allocation levers the tick engine actually responds to
npm run contact    # the collision-severity distribution the contact fouls are thresholded against
npm run fastsim    # does the analytic model rank plans the way the engine does
npm run strength   # the planner against the shipped baseline and the best fixed rule
```

## What is modelled

`web/js/` is five modules:

| file | holds |
| --- | --- |
| `rules.js` | field, element, piece, clock, point, foul and robot-limit constants, each with a clause |
| `model.js` | where things are on the carpet, the branch inventory, the ROBOT profiles, the scenario |
| `engine.js` | the 0.1 s tick: movement and contacts, pickup, placement (which can miss), ALGAE (processor and the ROBOT's own NET), climbing, the HUMAN PLAYER's throws, fouls including the §7.4.4 contact trio, scoring, frames |
| `policy.js` | the hand-written baselines (greedy, random) and the knobs an allocation study needs, plus DEFEND: a named seat that stops scoring and presses an opponent |
| `fastsim.js` | the analytic cycle model: what a plan would score, in microseconds instead of ticks |
| `ai.js` | the planner — re-solves the commit window through TELEOP and wraps the baseline it extends |
| `league.js` | run MATCHes, and the statistics that say whether a difference is real |
| `viz.js` / `ui.js` | the canvas and the page |

Movement is the 2026 build's. A ROBOT is the 30 in square R104's 120 in perimeter allows, oriented by a
heading that is integrated under its drivetrain's turn rate and an angular-acceleration ramp. A pair that
meets is separated on a separating axis by inverse mass and trades momentum along the normal; the REEF is
its convex hexagon, not its inscribed circle; and LEAVE and PARK are judged on the BUMPERS (§6.5.2), which
is what actually crosses the line. `swerve` / `tank` / `mecanum` set the sideways and reverse fractions,
and the choice is worth about 29 points a MATCH (`tank` 253.6 against `swerve` 282.8, each played as its own
24-MATCH mirror on both seats; `mecanum` at 280.2 is level with swerve). Both the spin ramp and the
momentum exchange have
an off value in the page's advanced column, so each is a measured arm rather than an assumption — and so does
the escape from a corner pile-up (`unstickOff`): three ROBOTS can pin each other against the ALLIANCE wall at
their own CORAL STATION, and one told to go that closes less than 4 in over 3 s backs out along its own
heading for 0.6 s and re-decides. Every ROBOT also
draws one tempo factor per MATCH (`model.tempoJitter`, ±20% by default, printed per ROBOT in the results
table), because without it two ALLIANCES running the same design are one process played twice.

A CORAL placement is a per-level action with a per-level chance of not staying on. `profile.placeSec` is a map
(the generic trio spends 0.4 s on the L1 TROUGH, 0.65 at L2, 1.0 at L3, 1.4 at L4: a horizontal reach has to
hold still for less time than a vertical one does) and `profile.placeDrop` is its partner
(`L1 0.02 / L2 0.06 / L3 0.13 / L4 0.22`), because §6.5.1's test for an L2-L4 CORAL is geometric — "the BRANCH
is inside the volume of the CORAL" — and an 11 in piece around a 4 in branch leaves about 3.5 in of slop. The
push only begins once the ROBOT is actually facing the branch (`placeTolDeg`, 26° on the swerve trio, 20° on
the tank machine): at 45° off a car a foot from the REEF points 11 in wide of the pipe it aimed at, so an
action started there is not a risky placement, it is a different action, and the ROBOT turns first and pays the
turn. Inside the tolerance the miss roll is a function of how much of it was used. What that costs is measured:
the TROUGH goes from **15.0 of its 24 filled to 11.2**, L2/L3/L4 stay at 12.0/12.0/12.0, **8.0 CORAL an
ALLIANCE-MATCH** ends up on the carpet against 0.0 with `placementRisk: false`, and the alliance pays
**−14.0 ± 3.1** points a MATCH for the model (−14.6 ± 2.6 on a second seed base, 23/24 and 24/24 scores differ).
On the guard's seed 89 placements were booked, every one of them begun within 23° of the branch, and 20 of them
did not stay on.

A MATCH is 1500 ticks of AUTO and TELEOP plus the 3 s CAGE assessment the manual allows after the
whistle (§6.5 C). ROBOTs decide every 0.2 s. Scoring is tracked per branch and per period, because
Table 6-2 pays AUTO and TELEOP differently and the CORAL RP is counted per level. AUTO (§6.4) has no
driver input in reality — it is a pre-programmed routine — and the baseline runs one here that is shaped
like what 2025 teams actually scripted: the preload (§6.3.4.1 B), then a pick off a floor CORAL MARK
(§6.3.4.1 A puts six on the carpet, and taking them in AUTO is legal) and a placement, with the cross of
the starting line priced into the 15 s instead of hoped for at the end, because LEAVE is judged at the
AUTO→TELEOP boundary (§6.5.2). `npm run measure` prices that trade: 1 cycle an ALLIANCE takes 2.94 AUTO
CORAL for 20.5 points with 8.94 of the 9 LEAVE, 2 cycles take 5.27 for 36.8 and 8.94, and the shipped 3 take
6.25 for 43.6 and 8.56. The third cycle is worth 6.8 AUTO points and costs 0.38 of the 9 LEAVE — which is why
`autoCycles` is a per-ROBOT field rather than a constant. The pieces it places can now miss: before the
placement model the same arm read 7.00 CORAL for 48.8, so part of what AUTO lost this round is CORAL that fell
off an L4 branch on the way out of the routine.

The three resources that make this game different from a queue-and-shoot game:

- **Branch inventory.** 12 branches on each of L2/L3/L4, one CORAL per branch, never refilled
  (§6.5.1). The REEF is a stock, not a rate. Whether a MATCH drains it decides what a good cycle is.
- **CAGE choice.** Deep is 12 points and shallow 6, chosen before the match (§5.4.1, §6.3.5), and the
  BARGE RP needs 16 BARGE points, so two deep climbs are the RP and the third robot is the margin.
- **The ALGAE chain.** An ALGAE through your PROCESSOR is worth 6 to you and rolls into the opponent's
  PROCESSOR AREA, where their HUMAN PLAYER throws it into their NET for 4 (§5.5, §6.1). So processing
  has a negative margin: it is worth 6 − 4 × (their accuracy) to the score difference. The price of the
  whole throwing end is measurable from either side: an ALLIANCE whose own HUMAN PLAYER makes no throw at all
  scores `261.0 ± 2.5` instead of the default `274.8 ± 3.8`, and crippling the *opponent's* HUMAN PLAYER swings
  the margin by `25.9 ± 3.5` (`blue 281.1 ± 3.1` against `red 255.3 ± 2.4`). Their area holds at
  most 4 (G435); the rest are counted as overflow, not as a foul, because the clause exempts a
  good-faith HUMAN PLAYER — cutting it to 1 leaves the ALLIANCE on `271.2 ± 3.0` against the default and takes
  the MATCH's G435 overflow count from 2 to 5.

### The NET has two feeders

§6.1 is one sentence with two subjects: "ROBOTS collect ALGAE and score in their PROCESSOR or NET. HUMAN
PLAYERS can score ALGAE in their NET once it has been passed to them via their opponent's PROCESSOR." The
build had only the second half. It was argued into that with the mesh's lowest point 6 ft 4 in up (§5.4.2)
against R104's 3 ft 6 in — but R104 measures the STARTING CONFIGURATION, not an elevator in play, Table 6-2
gives the NET an AUTO column, and G404 bars only the HUMAN PLAYER from entering ALGAE during AUTO. So a ROBOT
that can lift a ring over the border is the only thing that can score in the NET in AUTO at all — and note the
"can": the scripted AUTO routine in `policy.js` spends its 15 s on CORAL and does not try.

`INTENT.SCORE_NET` is that action. It works from beside the mesh rather than under it, because G420 forbids
contacting the NET and §6.5.1 counts a ring only while it is not touching a ROBOT of that ALLIANCE; the
stand-off is the same construction as a branch (`netDeposit()` in `engine.js`). Whether a machine can do it is
`profile.netScoreSec` — 0 means the elevator does not clear 6 ft 4 in — and **the shipped trio carries one**:
1.9 / 1.4 / 2.05 s, each derived from that machine's own L4 placement time plus 0.5 s, because a ROBOT that
lands a CORAL at 72 in clears a border 76 in up and a 16 in ring is the wider piece. No 2025 source prints
which machines had the height, so it is derived from the one number the ledger does give rather than asserted,
and 0 stays the ablation. Guard 21 runs the shipped trio against the same trio with the reach forced to 0 over
16 MATCHes: it fired in 16 of 16, 11.1 deposits a MATCH, the 18 staged ALGAE still close, no deposit was ever
made from the opponent's half, and the forced-0 control made 0.

What it buys is asymmetric, which is why both arms are measured (`npm run measure`, n=24 mirror MATCHes on seed
base 9000, and the same trio with the reach forced to 0 as the control):

| arm | result |
| --- | --- |
| the shipped reach, both ALLIANCES | blue `274.8 ± 3.8`, red `273.1 ± 2.9` against `301.6 ± 2.7 / 301.0 ± 2.9` with the reach forced to 0 — `−26.8 ± 4.2` a MATCH (23/24 scores differ). Forcing all six machines to one lift time instead: `1.2` s reads `−45.0 ± 2.7` (24/24), `1.9` s `−21.3 ± 4.0` (24/24, and `−28.1 ± 3.5` on a second seed base, 23/24, so the sign is not sample-dependent), `3` s `−4.5 ± 2.2` (22/24) — the price scales with how fast the lift is |
| blue as shipped, red at 0 | blue `290.5 ± 2.1`, red `280.2 ± 3.2`: margin `+10.3 ± 4.0`, paired margin shift vs neither side having it `+9.7 ± 3.9` (23/24). The uniform arms read the same shape: `1.2` s `+11.4 ± 4.1` margin and `+10.8 ± 3.2` paired, `1.9` s `+12.6 ± 3.9` / `+12.0 ± 3.5` |

Both fleets having the reach is worse for everybody than neither having it, and one side having it is worth
about ten points. That is not a contradiction, it is the chain: the ALGAE in *your* NET are the pieces your
*opponent* pushed through their PROCESSOR, so a fleet that lifts its own rings in refuses to supply the goal
it is scoring at — on the seed the table above prints, the 1.2 s field runs `PROC 8 NET 18 (10 by ROBOT)`
against the control's `PROC 18 NET 17 (ROBOT 0)`. It also withholds the 2-in-each-PROCESSOR Coopertition
(§6.5.3) it would otherwise hand the other side. Greedy bids the two routes against each other on margin per
second (`policy.js`), the analytic model does the same (`fastsim.js` prices the net leg off `netDeposit()`),
and the planner inherits whichever the machines can do.


### Defense, theft and the contact fouls

`INTENT.DEFEND` is a seat that stops collecting and starts pressing: it shadows the nearest opponent who is
*out* of their own REEF ZONE or BARGE ZONE (G427 bars contacting "an opponent ROBOT partially or fully inside
the opponent's BARGE ZONE or REEF ZONE, regardless of who initiates contact", so pressing a car in its own zone
is donating a MAJOR — 6 points), still spends what it
is already carrying, and still climbs in the endgame. Fetch can name the opponent's CORAL STATION as a source
and STRIP can name their REEF, so a machine on the other side of the field is not idle.

What that is worth is measured, and it is not what the action looks like it should be (`npm run measure`, 48
paired MATCHes over two seed bases, "own" = the pressing ALLIANCE's total, "off" = the pressed one's): **one
defender takes `−7.0 ± 1.7` points off the opponent and costs its own ALLIANCE `−5.9 ± 1.9`.** Switching the
§7.4.4 adjudication off reads `−5.5 ± 1.4` and `−6.4 ± 1.7`, so the cards are worth about 1.5 points of the
take. Two defenders take `−7.0 ± 1.7` off the opponent for `−15.6 ± 2.9` of their own: the second seat buys
nothing, it only doubles the machine that is not cycling. In this model defense is a
negative-margin action, and the page says so in the tooltip instead of selling it.

The two deny-source options are worth a fraction each, and the fractions point the other way: switching CORAL
theft off costs the would-be thief `0.6 ± 0.4` of its own total and `0.2 ± 0.4` off the opponent, and switching
the opponent's REEF ALGAE off *gains* the fleet `0.8 ± 0.4` while taking `0.3 ± 0.4` off the opponent. Greedy
bids distance-per-point from its own REEF, so two fleets rarely arrive at the same opponent STATION and the
option is nearly never taken. Whether the machinery works at all is guard 24, which sends one machine there on
purpose: RED's queue went from 18 CORAL left to **5** while BLUE's went from 15 to **57**, 23 CORAL still got
placed, and all 126 the MATCH stages are still accounted for; the enemy-REEF strip takes blue's opponent from
9 rings to **0** while its own REEF still held 0 and booked 18 in the PROCESSOR.

What the enemy REEF *costs* turned out to be the interesting half, and the ledger found it rather than the
clause list: the fouls a stripping fleet donates are not the G427 zone contacts the clause table points at but
**G418 — contacting an opponent CAGE**, which is what the only route to their REEF runs past, plus G421 when a
second machine is out there with it. With the trio lifting its own rings the trip is no longer the duty's
main cost: over 16 seeds one machine on duty takes 0.19 rings off the opponent's REEF a MATCH and donates
0.38 points, three take 0.63 and donate 1.13 — about **3.0 points per ring carried home**, which is what
`CROSS_FOUL_PTS` is set to, down from the 5.9 a processor-only fleet paid. `policy.js` still holds a strip back
while an opponent is sitting inside its own REEF ZONE (`zoneRisk`, off is the control arm), and guard 25 reads
what that does on the engine's own deny counter rather than on where a machine is pointing: the shipped fleets
take 0.19 rings ungated against 0.06 gated, for 0.8 points of combined score, and a fleet ORDERED to strip
goes anyway (0.63 gated against 0.50 ungated) and pays 1.13 fouls for it while the never-crossing control takes
nothing and pays nothing. So the gate moves fleets that choose, not fleets that are told; that a machine
pointing at a ring past the centreline is not a crossing at all (a ring that fell and rolled over there belongs
to neither REEF) is exactly why the guard stopped reading the target.

§7.4.4's three clauses are adjudicated together, one call per collision, because the manual makes them
mutually exclusive and asks for only the most punitive penalty. G422 needs a COMPONENT outside the ROBOT
PERIMETER, which nothing in this build has, so it is blocked by construction; G423 (damage or functional
impairment) and G424 (deliberate tip or entanglement) are MAJOR + YELLOW CARD, or + RED if the victim
"cannot be driven", and §6.6.2 turns a second YELLOW in the same MATCH into a RED, which DISABLES that ROBOT
for the rest of it — the escalation the 2026 build did not need and this one does. The guard's MATCH takes 6
calls (all G423), cards every one, and leaves 3 ROBOTS disqualified. Impairment is modelled as a speed
fraction for a fixed number of seconds rather than as broken hardware, because the engine has no mechanism
model. G421 (two ROBOTS across the BARGE with their BUMPERS out of the zone) is charged per 3 s uncorrected,
and the shipped traffic never earns it: over 18000 frames of 24 MATCHes, 20 held a *single* ROBOT across and
none held a second, so guard 23b drives two across on purpose and reads the MINOR → MAJOR escalation.



`model.js` ships three trios. The generic one is the role set the engine was calibrated on — a fast L4
machine, a second scorer, an ALGAE runner — and is not a team. The other two are the alliances that played
the 2025 Einstein Field finals: Johnson A1 (1690 Orbit, 4414 HighTide, 2073 EagleForce) and Newton A1
(2910 Jack in the Bot, 1323 MadTown, 4272 Maverick). Each ALLIANCE picks its own on the page, and it opens
with blue running Johnson and red running Newton — the final itself; the <b>Mirror</b> box folds the field
back to one trio for a BATCH that is supposed to mean strategy against strategy.

Their tempos come from two sources kept apart on purpose. TBA's alliance ledger for `2025cmptx_f1m1` sets
the SCALE: Johnson 12/12/12 branches plus 23 trough CORAL, 9 of them in AUTO, 9 ALGAE in the NET and three
DEEP CAGES for 295; Newton 12/12/11 plus 21 for 281. Statbotics' 2025 EPA export only splits that scale
between the three machines of an alliance, because its columns are expected contributions rather than
tallies — it credits 2910 with 12.97 BARGE points, more than the 12 one DEEP CAGE pays, and two teams with
negative entries. Guard 17 in `scripts/invariants.mjs` is what keeps them from being blended: it re-runs
each preset and asserts both that the CORAL total lands within 4 of the recorded ledger and that it stays
above the generic trio's (45.1 an ALLIANCE on the same seeds, from its 11.9/12.0/12.0 branches plus 9.2 in the
TROUGH). Currently Johnson makes 58.1 an ALLIANCE
against 59 recorded, Newton 58.8 against 56, at 7.4 and 7.5 AUTO against 9 and 9, 8.8 and 8.9 in the NET
against 9 and 9, and 2.96 and 2.98 DEEP
CAGEs against 3. The split the same guard prints — 22.7 / 22.5 / 13.0 and 22.9 / 22.2 / 13.7 against the
25.1 / 21.8 / 12.1 and 22.2 / 21.5 / 12.4 the two sources imply — is close enough to be the
same shape and not close enough to call it fitted. Their TOTALS are `305.9` against the recorded 295 for
Johnson and `307.5` against 281 for Newton, of which 23 and 22 points are the PROCESSOR column that record does
not carry (3.9 and 3.7 ALGAE): take it out and they read 282.9 and 285.5, twelve short of one and four over the
other — which is the shape of a fleet that lifts its ALGAE into the NET like the recorded alliances did and
still has a PROCESSOR left to fill.

## Measurement discipline

Inherited from the 2026 build, where each of these was paid for in a wrong number:

- **A mirror means the same trio on both sides.** The page can now put a different trio on each ALLIANCE,
  which is what the two real 2025 finalist alliances are, so the mirror is a checkbox rather than a default.
  With it off the BATCH margin is a ROBOT comparison and the batch card says so; a strategy claim needs it on.
- **The engine serves the alliances alternately**, on the tick and on the decision clock. Building
  blue first lets blue win every contested piece, which was worth ~30 points between two identical
  policies in the other game.
- **Staging is point-symmetric about the field centre.** An asymmetric layout makes one side's element
  closer and shows up as a fake seat advantage. The BARGE's own half was the violation of this line: the
  CAGES, the NET and the BARGE ZONE were all offset into the opponent's half, so the field the mirror was
  played on was not symmetric at all.
- **State n and the standard error.** `npm run verify` prints the mirror over 48 MATCHes as
  `273.2 ± 2.6` blue and `269.0 ± 2.2` red with a margin of `4.17 ± 2.53`; the greedy-vs-random arm wins
  16 of 16 with a margin of `167.5 ± 8.1`. That arm reads wider than it used to (was `137.0 ± 5.9`) because
  `randomPolicy` now takes a seed per MATCH: it had been ignoring one, so the "random" fleet was the same
  random fleet in all 16 — an error bar on one draw, not on sixteen.
- **A mirror that always ties is not testing anything.** Run the mirror with `tempoJitter: 0` *and* the CORAL
  unable to miss and the two ALLIANCES are one deterministic process played twice on symmetric geometry: 9 of
  96 MATCHes tie outright, which is not a finding about the game — it is the model having no way to tell the
  two sides apart. Each ROBOT now draws one tempo factor per MATCH (`model.tempoJitter`, ±20%, and
  the results table prints it per ROBOT) and each HUMAN PLAYER draws its own form. Over the same 96 seeds
  the spread reads a 9.4 ± 0.8 mean |margin| at 0, 11.0 ± 1.0 at ±10%, 13.5 ± 1.0 at ±20%, and 19.7 ± 1.4 at
  ±40%; the exact-tie count moves 7 → 6 → 3 → 4 across those arms, which is noise at n=96 and is why the guard
  asserts the |margin| rather than the ties. The three real 2025 Einstein Field finals margins were 11, 14 and
  17, so ±10% and ±20% sit inside that band and ±40% above its top — a bigger claim about two copies
  of one design than this build wants to make. What keeps the margins from separating further is that both
  ALLIANCES still drain the REEF's branches, and that is Stage 3's tempo calibration.
- **Pair an ablation on the same seeds, and name the seed base.** Two independent means carry the seed
  spread, and the seed spread of this engine is several points. The heading-spin-ramp arm has read `5.8`
  unpaired, `0.9 ± 1.2` paired over 96 seeds, and `+1.2 ± 3.0` paired over 24 on the 9000 base; the same arm
  now reads `+9.4 ± 3.0` there with all 24 scores different, `+6.8 ± 2.8` on the 21000 base (22/24), and
  `5.8 ± 2.2` over the guard's 48 paired seeds with 45/48 scores different. The base that read nothing and
  the base that reads seven points are the same engine, and the shift between the last two readings
  of one base is the reason this page quotes the 48-seed run rather than a single arm. Pairing makes the
  difference real, repeating it on another base makes it stable, and re-reading
  it after anything that moves the ROBOTS is what keeps the first two honest. The cheapest example of all is
  the HUMAN PLAYER: switching its throws off is worth `+18.4 ± 3.2` a MATCH over 24 paired seeds, 22/24 scores
  different — a mechanism the old build could only have guessed at.
- **Every physics knob has an off value.** `foulsOff` is checked to credit zero, `algaeInNetByHuman`
  off is checked to leave both NETs empty, and `accuracy: 0` likewise. `turnRampOff` and
  `contactRestitution: -1` are checked a step earlier: each has to change the recorded replay's digest,
  so a knob that quietly stopped reaching the motion code fails the build instead of becoming folklore.
  "Off credits zero" is only half a test, though: the shipped baselines charge **no fouls at all** across the
  24-MATCH mirror, because greedy never drives into an opponent, so guard 22 runs a fleet that does (one side
  parked, one pressing the nearest car) and requires the ON direction to produce points — 133 of them on that
  seed, `G403×9 G405×2 G421×100 G425×21 G427×1` worth 786 — and it reads G425's escalation, which is the only
  severity in Table 6-3 that depends on how long the violation has already run (MINOR, then MAJOR per further
  3 s). The same fleet is what made two referee bugs visible: a contact foul used to be charged every 1.5 s
  that the two cars stayed touching, which turned one engagement into ~10 MAJOR FOULs, and a PIN was called
  whenever *this* car was pushing, when §G425 defines it as preventing the *other* one's movement. Both are
  now one call per engagement (a pair that separates for less than a second is still the same engagement)
  and a PIN that reads the victim's speed.
- **An off value also pins the model it came from.** `tempoJitter: 0` reproduces the replay committed before
  the spread existed; `placementRisk: false` reproduces the one with no misses in it. As of this round the
  shipped fingerprint is `65be7627` (251-247, 162 events), its jitter-off value is `e1eaef89` (263-265),
  `placementRisk: false` prints `7856316` (267-279) and the two off values compose into `aad9e965` (278-279).
  All four moved together, and for one reason: `netScoreSec` is a property of the machine, so a reach written
  into `SAMPLES` reaches every replay in the file. The pins are therefore no longer the values committed before
  those models — they are this round's values with each mechanism switched off — and what proves the ablation
  still ablates is read straight off the replay: `placementRisk: false` books **0 dropped CORAL** against the
  shipped seed's 20. On the golden seed 89 placements were booked, every one of them begun within 23° of its
  branch, and 20 did not stay on. Nothing else this round — DEFEND, the opponent's STATION as a fetch source,
  their REEF's ALGAE in the strip gate, §7.4.4, G421 — reaches a MATCH where two greedy fleets work their own
  REEFs: the shipped mirror books no fouls at all, and the §7.4.4 trio charges none with its switch off.
- **A threshold has to be placed against a distribution that exists.** The §7.4.4 trio's severity floor came
  over from the 2026 build at 130, and `npm run contact` showed the number was meaningless here: two mirror
  greedy fleets produced **29 collisions over 48 MATCHes** (27 on the 9000 base, 2 on the 21000 one), because
  each alliance works its own REEF. The sample that has any collisions in it is one that fields a defender —
  1,583 of them over 48 MATCHes, median 33 and 34 on the two bases, p90 112 and 109, p99 181 and 186 — so the
  floor sits just under that p90 (`CONTACT_HIT_SEVERITY` 100) and the tip floor just under its p99 (180). It
  was set against the wider press this build used to
  field (p90 104 and 105, p99 174 and 194), and the press the stand-off and the two-strike give-up produce now
  sits just under it, which is the point of re-measuring rather than re-asserting. As shipped, the §7.4.4 trio
  assesses **0.23 fouls a MATCH** with one defender (11 G423 over 48, no G424 reached) and none between two fleets
  that never meet; the whole press bill is **4.5 and 4.9 fouls a MATCH for 26.5 and 29.3 points**, and almost none
  of it is §7.4.4: over those 48 MATCHes 141 are G427, which bars contacting "an opponent ROBOT partially or
  fully inside the opponent's BARGE ZONE or REEF ZONE, regardless of who initiates contact",
  and 69 are G418 against the opponent's CAGE — which is why the shipped DEFEND targets an opponent who is
  *out* of their own zones, why the hold point is clamped out of them, and why a defence study in this game is
  mostly a geometry study. That is the
  honest shape of a 2025 MATCH: the manual's own note says "FIRST Robotics Competition can be a full-contact
  competition", and the zones are protected so well that contact fouls are rare.
- **An ablation measures what the mechanism currently does, so re-read it after anything changes the
  traffic.** The bumper momentum exchange is the most misled number on this page. It read `+14.3 ± 4.3` on
  a perfect mirror (where the two sides' collisions cancel), `+53.2 ± 14.1` and `+50.4 ± 12.9` on two seed
  bases once the machines were allowed to differ, `+3.8 ± 2.2` once an explicit pile-up escape took the
  bounce's day job, `+8.6 ± 2.6` (`+6.2 ± 3.0` on the second base) after the CORAL started falling off
  branches and sending machines back out to the STATION, and now that the trio carries a NET lift the same
  arm reads `+6.7 ± 2.9` and `+5.8 ± 3.5` (23/24 scores differ on each) while the guard's own 16 paired seeds
  read `0.6 ± 2.3`. None of these was a better measurement of the impulse than the one before it: the first
  two were measuring the corner pile-up, which the bounce happened to be shoving three machines out of, and
  the rest are measuring whatever traffic the last model change left behind. What has stayed put is the
  quantity that is not score: pairs spend 3.2% of their frames in contact as shipped, and taking the exchange
  out moves that share by `0.67 ± 0.28` percentage points over 16 paired seeds. That is why the physics guard
  asserts the contact
  share too, because a mechanism worth under a percentage point of contact would otherwise read as dead code.
- **A golden fingerprint on one replay.** The hash in `scripts/invariants.mjs` moves when geometry,
  tempo or scoring moves, so a model change has to be explained before it ships.

Five bugs the guards were written around:

- A profile field was read under the wrong name (`accelIps` for `accelIpsS`). Positions became `NaN`,
  both alliances froze on their starting squares, and the MATCH still "finished" with a plausible score.
  Now `verify` fails on any non-finite position, and on any score that is not the sum of its parts.
- The PROCESSOR was placed at midfield, which is where the opponent's outermost CAGE hangs. Every ALGAE
  runner therefore committed a MAJOR G418 about every 10 s: 72 points of pure geometry. §5.5 says the
  PROCESSOR sits near its own REEF ZONE, and the mirror margin went from lopsided to zero when it moved.
- An editing slip left a stray `}` in `applyIntent`, which closed the function before the CLIMB branch:
  the module stopped parsing, and nothing in a browser would have shown why the field was blank. `npm
  run check` parses every module for exactly this, and it caught it before the page did.
- Three ROBOTS at their own CORAL STATION, in the pocket where the ALLIANCE WALL meets the guardrail, can
  pin each other there for the rest of the MATCH: one of them still carrying a CORAL it has been aiming at
  a branch for eighty seconds. Switched off on the build where this was found, the weakest ALLIANCE over the
  48-MATCH batch finished on 13 of the 60 CORAL the field holds and the widest mirror gap was 132 points
  between two identical trios — a blowout that looked like a finding about the game and was a finding about
  a deadlock. That batch ran on the old geometry, with the BARGE's own half on the wrong side of the field;
  the same ablation on the corrected one is far milder, and guard 16 now reads it as a 48-MATCH batch of
  **543.5** points against **537.1** when the escape is switched off, a widest mirror gap of **36** points
  against **54**, and the weakest ALLIANCE flooring at **34** CORAL either way — the collapse does not come
  back any more, which is itself the lesson: a good
  part of the original blowout was machines being routed through the middle of the opponent to get home.
  Neither first attempt at
  the escape was right: a speed test fired 0 times, because a pinned machine is at full throttle and going
  nowhere, and a "have I closed on my best distance yet" test fired 4258 times a MATCH, because after the
  window resets that comparison is true on the very next tick. What works is 3 s of intent plus less than
  4 in closed, and guard 16 asserts both ends of it — switched off the gap has to widen, the manoeuvre
  is needed **11.2** times a MATCH, and more than 40 would mean it has become the way the engine drives.
- A ROBOT told to place at the highest free branch keeps pushing at it even when a TEAMMATE is standing in
  front of it, which is parking with a full gripper rather than scoring. 4 of 96 MATCHes ended with one
  ALLIANCE holding CORAL while two L3 branches stayed empty and its twelve L2 branches and its whole TROUGH
  went unscored. `PLACE_PATIENCE_SEC` makes it aim one level lower after 4 s of no progress; the same
  reasoning as the pile-up, one layer up in the stack.

## What is not true yet

Read this before quoting any absolute number.

Two things changed since this section said the profiles were simply uncalibrated. The named presets are
now tied to a real ledger: Johnson A1 makes `58.1` CORAL an ALLIANCE where TBA recorded 59, Newton `58.8`
against 56, and both bank `8.8` / `8.9` NET ALGAE against the recorded 9 and hang `2.96` / `2.98` DEEP CAGES
against 3, so their per-machine tempos are no longer free to drift. And the corner pile-up is gone: over the
48-MATCH mirror batch the guard's margin used to read `30.6 ± 15.5`, then `4.00 ± 1.92` once the escape existed
but the BARGE was on the wrong half, and now reads `4.17 ± 2.53` (blue 273.2 ± 2.6 against red 269.0 ± 2.2).

What is still hot is the alliance TOTAL. On seed 12345 the mirror is `251-247`: blue 176 CORAL points over 46
pieces (10/12/12/12 of L1/L2/L3/L4), 36 ALGAE with **all nine rings lifted into the NET by a ROBOT and none
processed**, 9 LEAVE and 30 BARGE; red 172 over 43 with the same nine lifted. Against the one MATCH whose
ledger has been read line by line (`2025cmptx_f1m1`) that is the recorded *shape* — 9 NET, no PROCESSOR column
at all. Over the guard's 48 alliance-sides the generic trio is at 42.7 AUTO CORAL points where Johnson took 63
and Newton 60, 8.8 LEAVE where both took 9, 11.9/12.0/12.0 of the three branch rows where both filled all
three, 9.2 trough CORAL where the finals left 23 and 21, 8.9 NET where both left 9, and 2.00 DEEP CAGES where
both hung three. Its PROCESSOR column is down to 3.4 rings, 21 points, from the 8.9 rings and 54 points it ran
when nothing could reach the mesh, and the alliance mean with it is `269.9` against a field that averaged
260.56 over its 32 playoff alliance-sides and topped out at 301. Take that column out and it reads 249.4. Both
ends of that band are inside the real one now, which they were not when the same three trios with
`netScoreSec` forced back to 0 printed 301.3, 334.2 and 337.0.

The two columns the lift did not touch are still out of line: AUTO (42.7 points against a recorded 63 and 60)
and the TROUGH (9.2 of its 24 against the finals' 23 and 21). Stage 3's remaining work is those two, and it
needs the per-column counts re-read, not this paragraph re-argued.

The consequence for the planner is unchanged: at that level the REEF is capacity-bound, **greedy is already
at the ceiling**, and the only headroom is which branch, which level and when — plus the endgame. Slowing
the cycle estimates turns the REEF from a stock that always empties into one that does not, which is the
game where allocation matters and where a margin can be more than a branch. It
also makes the ALGAE margin price work: with the supply exhausted, blue processes 9 ALGAE whatever red's
HUMAN PLAYER can do with them, so the 6 − 4 × accuracy discount in `policy.js` changes no decision yet.

That calibration is Stage 3 and needs per-match CORAL and ALGAE counts, not only totals.

## Stage 2: what the planner does, and what it bought

The planner exists (`web/js/ai.js`, selectable as **Planner** on either ALLIANCE) and it beats the shipped
baseline by `+15.6` and `+17.3` points own-side over 96 paired mirror MATCHes on each of two seed bases —
`npm run strength` runs both seat orders (on the 9000 base `+15.6 ± 1.7` from one seat and `+13.2 ± 1.8` from
the other, on the 21000 base `+17.3 ± 1.7` and `+14.5 ± 1.6`), because reading only one order puts whatever seat
bias survives the mirror into the strategy column. From the seat it is asked to play it wins `84.4% ± 3.7` and
`83.9% ± 3.8` of those MATCHes; with the seats swapped the baseline wins `24.5% ± 4.4` and `18.8% ± 4.0` of them.

What it is worth being honest about: the same points are mostly available from a **fixed rule** — aim L3 before
L4, commit to the CAGES with 6 s left — which on its own beats the shipped baseline by `+15.2 ± 1.7` and
`+11.8 ± 1.7`. Against that rule the planner reads `+3.9 ± 1.6` from blue and `−0.5 ± 1.8` from red on the 9000
base, `+3.9 ± 1.8` and `+0.5 ± 1.7` on the 21000 one; averaged over the two seat orders that is `+1.7` and
`+2.2`. But the control that says what an average of zero would look like on this seed construction — the
planner against itself, two identical policies — reads `+2.1 ± 1.8` and `+2.8 ± 1.7` in blue's favour, where the
fixed rule against itself reads `−0.3 ± 1.9` and `−0.6 ± 2.0`. So `+1.7` and `+2.2` are inside what a null
difference produces here, and this page still says **reproduces the best fixed rule** rather than beats it; what
the pins moved is the planner's own score, `283.9` → `287.1` against the baseline on the 9000 base, and its win
rate over the baseline, `81.8%` → `84.4%`. Against a table that has been told about the CORAL STATION queue too
(`fixed rule + spread` in `npm run strength`) it is level now, `−2.1 ± 1.7` on the 9000 base and `+1.1 ± 1.9` on
the 21000 one, where it was `−5.2` and `−3.4` before the clock rules went in. `npm run adaptive` still says the
re-plan itself earns nothing separable: with the per-ROBOT
tempo spread pushed to ±40% and ±60% the planner's margin over the fixed rule is `+7.0 ± 3.5` from one seat and
`−2.3 ± 3.7` from the other (`+8.1 ± 4.6` and `−1.2 ± 4.4` at ±60%), and at ±0% spread, where it has nothing to
react to, the same two arms read `+0.1 ± 2.0` and `−2.2 ± 1.8`. The signs still track the seat rather than the
re-plan — but the window the planner picks does move with the jitter the fixed rule cannot see: 16/16 MATCHes
commit at 6 s at ±0%, 14/16 at ±40% and 12/16 at ±60%, the rest spread over 4 and 8 s. What the planner adds
is that the answer is derived from what the MATCH left on the REEF rather than assumed, and `npm run verify`'s
guard 20 holds that on held-out seeds (51000+): `+16.9` over the baseline (`19.9 ± 3.5` from blue,
`13.9 ± 4.2` from red), `+2.1` over the fixed rule, a commit of ≤8 s in 16/16 MATCHes with 16/16 re-planned
away from their opening plan.

The order of work matters here, because it is the opposite of the one that was tempting. `npm run headroom`
ran the knobs through the tick engine first: the commit window is worth `+10.8 ± 0.9` and `+11.9 ± 0.9`
(6 s against the shipped 20 s, with `+7.6 ± 0.3` / `+8.0 ± 0.4` at 12 s and `−11.1 ± 0.4` / `−11.1 ± 0.7` at
30 s), the level order spans `−3.9 ± 3.3` and `−5.6 ± 3.6` for working L3 before L4 and `−9.7 ± 3.2` /
`−6.7 ± 2.6` for L2 before L4, down to `−31.3 ± 3.4` and `−25.2 ± 4.4` for working the TROUGH first, rigid
per-machine level bands cost `−10.0 ± 3.0` and `−8.6 ± 3.5` for one machine per level and `−25.8 ± 3.4` and
`−28.8 ± 3.9` for two pushing up while one works low, and refusing to touch ALGAE at all costs `−43.0 ± 3.7` and
`−40.0 ± 4.2` — which is the ALGAE column, priced in the CORAL it displaces (that arm places 18.2 and 17.2 in
the L1 ring against the shipped 11.5 and 8.8, and scores 0.0/0.0 PROC/NET against 3.1/9.5 and 2.9/9.8). What the
study said about cycle *rate* — every one of the REEF's 36 branch slots gets filled (12.0 on each of L4, L3 and
L2 on both seed bases) and only 11.5 / 8.8 of the 24-piece TROUGH, so no **allocation of pieces** can outwork
the fleet — was right, and it was overread as "tempo is worth nothing".
A planner built to sort pieces would have been searching an empty column; the seconds turned out to be worth
something where they are spent standing at a STATION, which is the one thing no piece allocation touches.

`npm run fastsim` is then the gate on the analytic model, and it failed the first three times. Two of the
failures were the model being wrong about mechanisms rather than about constants:

- It scored an ALGAE column of **0** while the engine scored 9. The model only stripped ALGAE once the REEF
  was empty, but the REEF never empties; the baseline actually strips on a bid of *distance to the piece per
  point of value*, and a robot standing at a branch is a foot from an ALGAE and ninety from a STATION. Bidding
  the delivery leg instead of the reach leg made the model blind to the mechanism that earns 54 points. The
  column has since split in two (3.1 to the PROCESSOR and 9.5 lifted into the NET against the model's 9 rings,
  on the 9000 base), so the model's *total* now reads 251.0 against the 274.8 the engine banks; what is used
  for the search is the ordering, and that is what the agreement line above is measuring.
- It applied the fitted traffic factor (`efficiency`, fit at 1.300 and 1.485 on the two seed bases and priced at
  their mean 1.3925) to the drive to a CAGE. That factor is a fit for
  the queue three machines form at one CORAL STATION corner; the BARGE side has no queue. With the factor
  applied, a 6 s commit cost the model all 36 of its CAGE points and gave the biggest lever in the game the
  wrong sign. The engine's real tail was measured instead of estimated: over 12 MATCHes at a 6 s window the
  fleet asked at `t = 144.1` (max 144.6) and was on the pipe `4.40 s` later (max 5.80), finishing with
  1.92 DEEP, 1.00 SHALLOW and 0.08 PARK — nearly the same BARGE column a 20 s window gets. Interrupting a
  drive is free, so the model's cycle bound belongs at the start of a cycle, not the whistle.

After those two, the model ranks 7/7 of the plan pairs the engine can separate (of 15 tried) on each of two
seed bases, and gets the commit window right in sign and size (`+10/+12` predicted against `+7.6 ± 0.3 /
+10.8 ± 0.9` measured on one seed base and `+8.0 ± 0.4 / +11.9 ± 0.9` on the other). One arm per base is still
more than four points off — the station-spread arm (`+11.6` measured against `+16.0` predicted) on the 9000
base, the one-machine-on-ALGAE arm (`+11.2` against `+6.0`) on the 21000 one — which is why the guards price the
two levers off the engine's own arms rather than off this model. Three axes used to be outside its action space
and are now inside it, which changed what the planner is allowed to search.

**The level order.** The claim in this file for two rounds was that the model ranks the axis the wrong way
because it prices a cycle's PLACE time but not the circling a robot does to find a free slot at a filling
level. That mechanism was tested and is not in the engine: over 2,169 placements in 48 MATCHes the time a
machine spends placing is flat in how full its level already is (L2 0.71 → 0.70 s from the first quartile of
occupancy to the last, L3 1.01 → 0.99, L4 1.23 → 1.27). What the model was missing was the per-level placement
time and drop rate, and once those went in the ranking came right on its own. At the shipped 20 s commit its
ordering of the level arms matches the engine's wherever the engine can separate them (`−8.0` and `−10.0`
predicted against `−9.7 ± 3.2`
and `−6.7 ± 2.6` for working L2 before L4, `−8.0` and `−10.0` against `−10.0 ± 3.0` and `−8.6 ± 3.5` for one
machine per level, `−24.0` and `−30.0` against `−25.8 ± 3.4` and `−28.8 ± 3.9` for two pushing up while one
works low, `−46.0` and `−52.0` against `−31.3 ± 3.4` and `−25.2 ± 4.4` for the TROUGH first — the order right,
the size too harsh on the worst arm; the predicted rows are `estimateAlliance` read at the efficiency
`npm run fastsim` fits, against the `npm run headroom` arms).
The order is not searched, though: `MEASURED_ORDER` in `web/js/ai.js` pins it to L3-before-L4 — the measured top
of the list on the build that found it — so the planner answers L3-first on 24/24 seeds of both bases. The lift
re-argued that pin once and the clock rules re-argued it again. The greedy fleets read L3-first against L4-first
at `−3.9 ± 3.3` and `−5.6 ± 3.6` (the baseline runs none of the pinned rules, so that reading is unchanged), and
the planner asked the same question of itself — the same planner told to aim L4 before L3 on 24 paired seeds per
base, with the three pinned rules still running — now answers `+2.6 ± 2.8` and `−4.4 ± 2.0`: the two bases
disagree in sign and the pair averages to nothing, which is what an unmeasurable axis
looks like. The pin stays because flipping it re-baselines every fingerprint in `scripts/invariants.mjs` for at
most a few points, which is a decision about measurement cost rather than a finding.

**Per-machine ALGAE duty.** One queue for three machines cannot show that taking one out of it helps the other
two, and for a while the model had nothing else to say about duty either: it drained the same nine rings
whichever slots were told to strip. What duty used to cost was the crossing — a machine that has run out of
rings on its own REEF reaches over to theirs, and the only way to their REEF is past their CAGEs, where G418
costs a MAJOR FOUL. With the trio carrying a NET reach the crossing nearly went away: over 16 seeds one machine
on duty takes 0.19 rings off the opponent a MATCH and three take 0.63, where the same arms told to feed the
PROCESSOR crossed several times that often. The model bills what is left the same two ways — `crossingSec`
takes the drive out and home off a duty machine's timeline from the field geometry, and `CROSS_FOUL_PTS = 3.0`
per ring carried home is the pooled measured donation (0.38 / 1.88 / 1.13 points for one / two / three machines
over those seeds) — and it knows a mirror: if both fleets were told to strip, every ring this one takes is a
ring the other takes back, so the ALGAE column does not grow, which is what the engine says (9.00 rings an
ALLIANCE with both fleets told to strip against 9.00 with neither). Guard 26 holds it all on held-out seeds: the
model's crossings within 0.25 of the engine's at one machine and at three, its fouls within 1.5 of the donation
the engine pays, its ALGAE column within 0.6 rings of `PROC + what a ROBOT lifted`, every duty arm ranked at or
below no-duty in a mirror (they are, by −0.6 / −1.1 / −1.7), and the mirror ALGAE column unmoved by the trip.
What the guard does NOT claim is a sign for the duty arms read one-sided: the engine's margins there are
7.56 / 10.69 / 10.69 / 5.94 over the same 16 seeds with no error bar, which is a spread, not a result.

**The CORAL STATION queue.** The one tempo lever the inventory study left out is where the pieces are picked up.
Each ALLIANCE has two CORAL STATIONs, in the pockets where its WALL meets the guardrails, and the shipped bid
takes the nearest one whoever is standing there: the engine's own counter — which reads the tick the pick starts
on, not the 0.2 s frame — books `27.0%` of a fleet's `65.4` CORAL picks a MATCH as beginning with a teammate
already bound for the same corner. `policy.js` prices each teammate on the corner as so many seconds of *this
machine's* drive (`stationSpread`, so a fast ROBOT will walk farther off the queue than a slow one) and takes
the other pocket when the walk is shorter than the wait; the shipped willingness to pay is 0.91 s. Pricing the
crowd does thin it: `17.7%`.

What the crowd costs, though, turned out not to survive the lift. The number this lever shipped on was the time
between two picks by the same machine — `7.29 ± 0.21` s when the later one began contested against
`6.27 ± 0.10` s when it began alone — and on the shipped profiles that difference has gone the other way:
`4.34 ± 0.18` s contested against `6.83 ± 0.11` s alone (n=257 against 2,703 over 24 mirror seeds). It was
always a confound rather than a wait: a machine that rejoins the corner its fleet never left has a short drive,
which is what the negative now reads. So the per-cycle credit is priced off the MATCH instead, on the arm the
planner actually decides against — one side spreading, the other playing the shipped bid, 24 paired held-out
seeds — and the engine gives it `+1.1 ± 2.0` own points, `−3.1 ± 2.4` of margin when BOTH fleets are told to
spread. `fastsim.js` credits `0.15` s of every CORAL cycle, per cycle rather than as a bonus, so a MATCH with
30 s left is credited for less than one with 90 (the guard's teeth clause is that a flat bonus would read the
same at both clocks: `2.0` from the whistle against `0.0` with 30 s left). The credit's effect on the estimate
is a STEP, because a saved second only matters when enough of them stack to fit another whole cycle before the
commit window: at the efficiency the guards price with, 0.05 s to 0.38 s all buy exactly one extra CORAL
(+2), 0.50 s buys two, 0.70 s buys four. Guard 27 holds the sign, the size against that step, the fact that the
corner really is a queue and that pricing it thins it, and — the clause that protects every other number in this
file — that `stationSpread: 0` reproduces the shipped MATCH point for point. It is not the shipped default for
that reason: the pinned replays in `scripts/invariants.mjs` are a record of the nearest-corner bid, and
re-basing them is its own change.

The planner therefore ranks on a **margin** now (`planValue`, the same function `npm run fastsim` orders
candidates with, so the model cannot be validated against a yardstick nothing uses), and the duty axis is on the
menu unless the caller pinned one. Against a passive field it lands on the answers the table already knew: the
6 s commit on 48/48 MATCHes across the two bases (the level order is pinned rather than chosen, as above). The
queue is the axis where the search goes somewhere the table did not, and it is choosing less often than it used
to: the spread is on in 11 of 24 MATCHes on the 9000 base and 16 of 24 on the 21000 one, where the same two
arm counts read 18 and 16 before the clock rules went in — the piece-claim rule has taken over part of the job
the station spread was doing, because a fleet that no longer double-tasks a loose CORAL does not need to split
its pockets to avoid doubling up. Against an opponent with an agenda it takes ALGAE duty in 1 of 24 MATCHes on
the 21000 base (slot 2) in each of the two arms where something presses, and in 0 of 24 on the 9000 base in all
three — which is what a priced crossing looks like when the option is worth taking occasionally rather than a
switch that is never thrown.

`npm run strength` also runs arms against a field that does something — one machine pressing, three stripping
this REEF, both at once — with four policies in the seat: the planner, the best fixed rule, that rule told about
the queue (`fixed rule + spread`), and the shipped baseline. Own-side margin over 48 MATCHes per arm, the two
seed bases: the planner beats the baseline in all six (`45.7 / 16.7 / 46.3` and `42.6 / 18.5 / 40.9` against
`30.4 / 0.6 / 30.5` and `32.4 / 2.5 / 33.6`) and the old fixed rule in all six (`+3.5 / +2.9 / +5.0` and
`+7.4 / +3.5 / +1.6`) — the arm where the opponent only strips is the one that separates the baseline from
everything else, because the shipped baseline wins barely half of those MATCHes (`49.5% ± 5.1` and
`55.7% ± 5.1`). Against the table that has been told about the queue the six are now split three and three
(`+1.4 / −1.8 / −1.5` and `+0.3 / +1.7 / −4.0`, `−0.65` averaged over the six), where they were six losses and
`−1.7` averaged before the clock rules went in. The queue is still worth having — the told table beats the untold
one in `44.3` against `42.2` and `18.5` against `13.8` — but it is no longer something only the table can hand
over, because the planner now dedups pieces itself.

The Ranking Points are computed by the model (`rp.auto/coral/barge`) and are **not** added to the ranking. A
bonus is a third of a MATCH win by Table 6-2, which at this engine's margin spread is worth about 8 points of
score, and pricing it at that changed the chosen plan in 0 of 32 candidate spaces (every roster the page can
pick, at the straight-line and the fitted efficiency, with the clock at the whistle, 60 s, 110 s and 132 s). In
REEFSCAPE the bonuses move with the points that earn them — 16
BARGE points *are* the BARGE RP, 7 CORAL on a level is a level's worth of score and a step toward the CORAL RP —
so a second coefficient would be a preference, not information.

Re-planning is no longer only on a clock. The planner watches its own fleet's capacity (a machine disqualified,
a machine limping on an IMPAIRMENT — `obs.allies[].impair`, which the engine did not report until this was
built) and re-solves within `eventCooldownSec` of losing one, tagging the entry in the plan log. The path fires
in the arms where something actually breaks the fleet: against one pressing machine 0.04-0.21 re-solves a MATCH
on the two seed bases, against a fleet that presses and strips 0.04-0.13, and against a fleet that only strips
0.00 — which is the control, because taking ALGAE does not take a machine out. The press does disable things,
just not often: over 12 MATCHes on the 9000 base a single defending machine spends 20.7 s a MATCH defending and
leaves 1.6 machine-seconds of DISABLED time on the victim fleet with no IMPAIRMENT frames at all, and that is
how rarely the re-solve has a reason to fire. Where the press is aimed hard on purpose — the fouls guard, one
fleet parked and one driving at the nearest car — it takes 3 ROBOTs out for the MATCH.

### The clock, the hopper and the teammate

Three of the planner's rules are not plan fields the model searches but budget rules it pins. All three live in
`policy.js` with off values, and `ai.js` hands them in at construction, so a caller can still run the control
arm through its options. They were found the same way the commit window was: read the failure off the frames
first, then price the fix.

- **A cycle has to fit the clock** (`cycleCutoffSec: 4`). Read over 48 MATCHes on two seed bases, the planner
  ended TELEOP holding 0.73 and 0.69 CORAL an ALLIANCE, and 0.69 of those were picked up inside the last 20 s —
  a full REEF accounted for 0.00 of them, so this was never a saturation problem. Greedy holds 0.00 because it
  stops fetching when its window opens. Refusing a fetch whose round trip (drive to the source, take, drive
  back to the REEF face, place) does not fit with 4 s to spare — the same straight-line budget the AUTO routine
  already uses — took the hold to 0.13/0.15 and was worth `+3.00 ± 1.43` and `+2.92 ± 0.88` combined points a
  MATCH over 24 paired seeds per base when it was the only rule switched on. Against the build that now runs all
  three, the same gate is a maximum rather than a guess: raising it to 8 s costs `−5.75 ± 0.68` and
  `−3.08 ± 1.14` over 24 paired seeds per base, and the guard's own 12-per-base subset prints `−4.7 ± 1.1`,
  loosening it to 6 s costs `−1.50 ± 0.86` and `−1.33 ± 0.91`, and 3 s reads `−1.58 ± 0.82` and
  `+0.50 ± 0.71`. Past the peak the machines are not saving a wasted trip, they are standing still.
- **The hopper gets spent before the CAGE** (`spendBeforeClimb`). The engine drops whatever a ROBOT is holding
  when it hangs, so a machine that goes to a pipe with a load trades 3-5 points for nothing: the same read says
  the baseline loses 1.69 and 1.58 CORAL an ALLIANCE a MATCH that way and the planner 0.75 and 0.90. The rule
  spends first only when the clock left covers BOTH legs, which is what stops it buying a CORAL with the BARGE
  column. For the baseline that is `+6.21 ± 0.67` and `+6.04 ± 0.47` with the climb-drops at 0.00; for the
  planner on its own it is inside the bar (`−0.25 ± 0.54`, `+0.58 ± 0.33`), because a 6 s commit rarely leaves
  time to score anyway, and with the cutoff the pair reads `+3.33 ± 1.57` and `+3.50 ± 0.96`.
- **A piece a teammate is bound for is not chased** (`pieceSpread: 1.82`). Filtering the same frames to the two
  intents that TAKE something, two allies are aimed within 24 in of each other for 38.9-42.2 s of a MATCH, and
  the bulk of it (27.6-32.2 s) is at a STATION pocket, which `stationSpread` already prices. About 10 s a MATCH
  is at one loose piece, so the same seconds-off-a-cycle bid goes on the floor CORAL and the ALGAE rings: 1.82 s
  of drive, 291 in at this field's cruise speed, takes the overlap to 1.7 s and is worth `+7.48 ± 2.88` and
  `+4.17 ± 2.63` on the two bases, `+5.82 ± 2.03` pooled over 96 paired seeds, and `+10.60 ± 3.16` over 48
  paired held-out seeds the value was not chosen on. `3.65 s` and `7.30 s` read *identically* (+5.94 ± 2.33 for
  both), because 3.65 s of drive is 584 in, wider than the FIELD — past roughly 2 s the penalty is a skip, not a
  price. The graded value is kept so a machine beside an empty REEF still takes the only piece left.

The pins are worth `+11.85 ± 3.17` combined points a MATCH over 48 paired held-out seeds against the same
planner with all three disabled, and the columns say where they come from over 48 MATCHes: ALGAE `+4.17`, BARGE
`+1.96` (with `+0.23` DEEP and `−0.15` SHALLOW, so the climb is not being bought by parking more machines),
CORAL `+1.79`, and `+0.00` on both AUTO CORAL and LEAVE — which is right, because none of the three rules is
allowed to fire in AUTO. Two of them are worth more to the baseline than to the planner — the baseline
commits to the CAGES with 20 s left and so carries a load into a climb twice as often — and the baseline keeps
them off for the reason the level order gives: it is the yardstick, and a yardstick that improves underneath the
planner re-baselines every fingerprint in `scripts/invariants.mjs`. `npm run verify`'s time-sense guard checks
each rule binds, keeps its score through its own mechanism rather than some other one, pays on held-out seeds,
and that all three off values reproduce the shipped MATCH point for point. One honest dilution note: against a
baseline that *does* take the late pieces the planner declines, the margin over it barely moves
(`+16.0 ± 1.7` to `+15.6 ± 1.7` on the 9000 base) even though the planner's own score goes `283.9` → `287.1` and
its win rate `81.8%` → `84.4%`, because the baseline it is playing against goes `267.9` → `271.5` on the same
arm. The mirror reading, where both fleets have the rules, is the one that shows the gain.

Also open: the exact station / processor / CORAL-MARK insets (the field drawings, not the rule text), the
L1 trough capacity of 24 as a number, the HUMAN PLAYER throw rate and accuracy and the 1.4 s CHUTE feed,
the per-level miss odds (`placeDrop`) and the aim tolerance (`placeTolDeg`), which are anchored to §6.5.1's
geometry (a 4 in BRANCH inside an 11 in CORAL leaves about 3.5 in of slop) but are not in the manual at any
number, and the severity floors behind §7.4.4, which are quantiles of this engine's own defender traffic
rather than anything a referee would score, and the AUTO cycle count, which is a scripted-routine assumption
(`p.autoCycles`, 2 or 3 per the TBA
alliance averages of 9 CORAL in AUTO) rather than anything in the manual. The preset split rests on
Statbotics EPA ratios, which are expected contributions, not tallies — they are allowed to divide an
alliance ledger, never to set it. The ROBOT footprint is now R104's 120 in perimeter as a 30 in square with
no bumper allowance added, which is the rule's bound rather than a measured machine — real robots are
rectangles with bumpers, and the square is what the perimeter permits, not what any team built.

## Commands

| command | does |
| --- | --- |
| `npm run serve` | static preview of `web/` on loopback |
| `npm run check` | UTF-8 clean, tag balance, every module parses |
| `npm run verify` | invariants, golden replay, mirror, ablation, baseline separation, the planner's two assertions |
| `npm run measure` | the A/B blocks behind the numbers printed on the page |
| `npm run headroom` | what each allocation knob is worth in the engine, before anything is built on it |
| `npm run contact` | the collision-severity distribution the §7.4.4 thresholds are placed against |
| `npm run fastsim` | does the analytic model rank plans the way the engine does (pairwise, with error bars) |
| `npm run aicap` | the ceiling on each plan axis: every arm as a fixed rule, then what hindsight over the arms says a policy could still win |
| `npm run strength` | the planner against the shipped baseline AND against the best fixed rule — twice, once against the rule as it was measured and once against the same rule with the station queue priced in — both seat orders, then the same yardsticks against a field that presses, strips or does both |
| `npm run adaptive` | whether re-planning beats a fixed commit once the MATCH's pace varies |
| `npm run all` | check then verify |
