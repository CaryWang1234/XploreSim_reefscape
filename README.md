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
| `policy.js` | the hand-written baselines (greedy, random) and the knobs an allocation study needs, plus the DEFEND intent: a machine that stops scoring and presses an opponent, either assigned (`defendSlots`, the duty arm the measurements read) or chosen (`autoDefend`, the priced rule the planner ships with) |
| `fastsim.js` | the analytic cycle model: what a plan would score, in microseconds instead of ticks |
| `ai.js` | the planner — re-solves the commit window through TELEOP and wraps the baseline it extends |
| `league.js` | run MATCHes, and the statistics that say whether a difference is real |
| `viz.js` / `ui.js` | the canvas and the page |

Movement is the 2026 build's. A ROBOT is the 30 in square R104's 120 in perimeter allows, oriented by a
heading that is integrated under its drivetrain's turn rate and an angular-acceleration ramp. A pair that
meets is separated on a separating axis by inverse mass and trades momentum along the normal; the REEF is
its convex hexagon, not its inscribed circle; and LEAVE and PARK are judged on the BUMPERS (§6.5.2), which
is what actually crosses the line. `swerve` / `tank` / `mecanum` set the sideways and reverse fractions,
and the choice is worth about 20 points a MATCH (swerve 272.8 against tank 252.9 in the guard's n=16 mirror;
played as a 24-MATCH mirror each, swerve reads 269.6 ± 2.4 blue and 271.1 ± 3.1 red and tank
245.2 ± 3.4 and 244.3 ± 2.9). `mecanum` is within error of swerve — 270.9 ± 3.1 and 272.1 ± 2.3 against
269.6 ± 2.4 and 271.1 ± 3.1 — and none of the three has a seat advantage to claim: the margins each fleet runs
against itself are swerve's −1.54 ± 3.76, tank's 0.96 ± 3.40 and mecanum's −1.25 ± 3.16, every one of them inside
its own error bar. Both the spin ramp and the
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
the TROUGH goes from **10.2 of its 24 filled to 5.2**, L2/L3/L4 come down from **12.0/12.0/12.0 to
11.7/12.0/11.9**, **10.1 CORAL
an ALLIANCE-MATCH** end up on the carpet against 0.0 with `placementRisk: false`, and the alliance pays
**17.6 ± 2.1** points a MATCH for the model (12.5 ± 2.0 on a second seed base, 24/24 and 24/24 scores differ).
Letting a ROBOT that misses keep trying the same level instead of giving up on it buys nothing visible: 9.5 CORAL
fall and L2/L3/L4 read 11.6/12.0/12.0, while the TROUGH stays at 5.2. On the guard's seed 76 placements
were booked, every one of them begun within 23° of the
branch, and 27 of them did not stay on.

A MATCH is 1500 ticks of AUTO and TELEOP plus the 3 s CAGE assessment the manual allows after the
whistle (§6.5 C). ROBOTs decide every 0.2 s. Scoring is tracked per branch and per period, because
Table 6-2 pays AUTO and TELEOP differently and the CORAL RP is counted per level. AUTO (§6.4) has no
driver input in reality — it is a pre-programmed routine — and the baseline runs one here that is shaped
like what 2025 teams actually scripted: the preload (§6.3.4.1 B), then a pick off a floor CORAL MARK
(§6.3.4.1 A puts six on the carpet, and taking them in AUTO is legal) and a placement, with the cross of
the starting line priced into the 15 s instead of hoped for at the end, because LEAVE is judged at the
AUTO→TELEOP boundary (§6.5.2). `npm run measure` prices that trade: 1 cycle an ALLIANCE takes 2.92 AUTO
CORAL for 20.2 points with 9.00 of the 9 LEAVE, 2 cycles take 5.17 for 35.9 and 9.00, and forcing all three
machines to 3 take 5.52 for 38.4 and 9.00. The third cycle is worth 2.5 AUTO points and no longer costs any of the
LEAVE column — #123 moved the ROBOT STARTING LINE onto the ROBOT rather than the ROBOT onto the line, and once the
fleet starts *on* it the cross is a few inches instead of a leg of the routine, which is why `autoCycles` is a
per-ROBOT field rather than a constant.

The three resources that make this game different from a queue-and-shoot game:

- **Branch inventory.** 12 branches on each of L2/L3/L4, one CORAL per branch, never refilled
  (§6.5.1). The REEF is a stock, not a rate. Whether a MATCH drains it decides what a good cycle is.
- **CAGE choice.** Deep is 12 points and shallow 6, chosen before the match (§5.4.1, §6.3.5), and the
  BARGE RP needs 16 BARGE points, so two deep climbs are the RP and the third robot is the margin.
- **The ALGAE chain.** An ALGAE through your PROCESSOR is worth 6 to you and rolls into the opponent's
  PROCESSOR AREA, where their HUMAN PLAYER throws it into their NET for 4 (§5.5, §6.1). So processing
  has a negative margin: it is worth 6 − 4 × (their accuracy) to the score difference. The price of the
  whole throwing end is measurable from either side: an ALLIANCE whose own HUMAN PLAYER makes no throw at all
  scores `248.0 ± 2.7` instead of the default `263.2 ± 2.8`, and crippling the *opponent's* HUMAN PLAYER takes
  the mirror margin from `−2.0 ± 3.6` to `27.8 ± 3.9` in the other alliance's favour (`blue 272.2 ± 3.7`
  against `red 244.5 ± 2.4`). Their area holds at
  most 4 (G435); the rest are counted as overflow, not as a foul, because the clause exempts a
  good-faith HUMAN PLAYER — cutting it to 1 leaves the ALLIANCE on `262.7 ± 2.8` against the default and takes
  the MATCH's G435 overflow count from 0 to 3 while its NET column drops from 17 to 15. Since #117 the mesh, not the area,
  is what has a ceiling: 9 rings an ALLIANCE — and since #119 the ceiling is on the mesh rather than on the lift,
  so a ring that arrives after the ninth stays in the hopper instead of scoring into a nine-ring mesh.

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
16 MATCHes: it fired in 16 of 16, 9.1 deposits a MATCH, the 18 staged ALGAE still close, no deposit was ever
made from the opponent's half, and the forced-0 control made 0.

What it buys depends on what the mesh can hold, which is why both arms are measured twice (`npm run measure`,
n=24 mirror MATCHes on seed base 9000, and the same trio with the reach forced to 0 as the control):

| arm | result |
| --- | --- |
| the shipped reach, both ALLIANCES | blue `263.2 ± 2.8`, red `265.2 ± 3.1` against `295.3 ± 2.7 / 289.3 ± 2.5` with the reach forced to 0 — `−32.0 ± 3.1` a MATCH (24/24 scores differ). Forcing all six machines to one lift time instead: `1.2` s reads `−40.9 ± 2.7` (24/24), `1.9` s `−24.9 ± 3.5` (23/24, and `−22.7 ± 2.4` on a second seed base, 24/24, so the sign is not sample-dependent), `3` s `−7.3 ± 2.5` (21/24) — the price scales with how fast the lift is |
| blue as shipped, red at 0 | blue `271.9 ± 2.5`, red `277.6 ± 2.5`: margin `−5.7 ± 4.0`, paired margin shift vs neither side having it `−11.7 ± 3.3`. The uniform arms are the same shape now rather than a wash: `1.2` s reads `−7.4 ± 3.5` margin and `−13.4 ± 2.7` paired, `1.9` s `−5.9 ± 3.9` and `−11.9 ± 3.4` — every one-sided arm is a loss for the side that lifts. With the ceiling taken off the same arm reverses: `netCapacity: 18` gives it `+7.9 ± 4.1` on the 9000 base and `+7.0 ± 3.4` on the 21000 (n=24 each), while at the shipped nine it reads `−5.7 ± 4.0` and `−6.8 ± 3.1`. #123's MARK move is what flipped this arm; the #117 round published it as a win |

Both fleets having the reach is worse for everybody than neither having it. One side having it costs that side
about twelve points of the paired margin; it is the same chain either
way — the ALGAE in *your* NET are the pieces your *opponent* pushed through their PROCESSOR, so a fleet that
lifts its own rings in refuses to supply the goal it is scoring at. What the ceiling adds is that it also runs
out of mesh: the two nets of a MATCH hold 18 rings between them and no more, so the column reads `18.00 → 16.54`
rings on the 9000 base and `18.00 → 16.50` on the 21000 (n=24 an arm), and the rings the ceiling turns away go
through the PROCESSOR (`8.21 → 9.33`, `7.83 → 9.13`), where they pay 6 rather than 4 and hand the opponent a
throw to make. What #119 fixed is that the gate sat on the wrong end of the action: `netDepositFor()` refused a
LIFT when the three lanes were already full, but a machine that committed while there was room and arrived after
the ninth ring went in was billed a ring the mesh could not hold, so the score read past nine while the drawn
lanes stopped at nine. The ceiling is now on the mesh, the lane that gets the dot is the one with room, and guard
7f scans every frame of both ALLIANCEs over 16 MATCHes: the mesh peaks at 9, 0 frames sit over the ceiling, 0
frames disagree with what is drawn, and the same fleets with `netCapacity: 18` reach 16.
Over the 24 MATCHes the table above averages, the shipped field runs `PROC 13 NET 17` with 5 of the 17 lifted in
by a ROBOT against the control's `PROC 18 NET 18 (ROBOT 0)`, and a 1.2 s field `PROC 7 NET 17 (ROBOT 11)`. It also withholds the 2-in-each-PROCESSOR Coopertition
(§6.5.3) it would otherwise hand the other side. Greedy bids the two routes against each other on margin per
second (`policy.js`), the analytic model does the same (`fastsim.js` prices the net leg off `netDeposit()`),
and the planner inherits whichever the machines can do.

### Three lanes and nine rings

The mesh is 4 ft × 12 ft of border (§5.4.2), and until #117 the engine spent the whole ALLIANCE on one point of
it: `netDeposit()` returned a single coordinate at the middle of the face, so all three ROBOTS queued
bumper-to-bumper to lift into the same patch — which is what the replay looked like. The face now splits into
three 4 ft lanes and a machine works its own (`rb.slot`), moving to the nearest lane with room once its patch is
full; on the golden seed the 15 ROBOT deposits that used to sit at one stand-off spread 48 in along the face
(`npm run verify`'s guard 7e reads exactly that, in both directions — the stand-off each ring was billed at, not
where the machine had been shoved to when it let go). `npm run measure` prices the two #117
changes apart on paired seeds (n=24 an arm, both bases), with `netLaneSpread: false` and `netCapacity: 18` as the
off values. What #122's REEF and then #123's MARKs did to that price is the honest part of this paragraph: the
spread alone reads `+1.29 ± 3.76` combined points a MATCH on the 9000 base and `−5.04 ± 3.76` on the 21000 — the
sign does not survive a second set of seeds, against the `+17.3 ± 1.7` this arm once printed — and neither does
the side effect it was kept for: the unstick fires move `+1.00 ± 1.10` a MATCH on one base and `−2.13 ± 0.93` on
the other, so the quieter carpet the #123 round published is gone with the REEF that stopped offering one face
per two machines. The lanes are still what the replay looks like, and they are still what guard 7e switches; what
is no longer true is that they buy anything.

Capacity is a modelled limit, not a clause. §6.5.1 counts a ring "contacting the NET or ALGAE contacting the
NET", which makes a pile legal, and the only ceiling the rules give is the 18 ALGAE §6.3.4.2 stages a MATCH. The
geometry is the estimate: three 16 in rings (§5.7.2) fit along a 48 in lane, so a NET holds **9** —
`NET_CAPACITY` in `rules.js`, and `netCapacity: 18` is the ablation that lets every ring the MATCH has into the
mesh; over the guard's 16 MATCHes a mesh goes over nine on 14 of them with the ceiling off, peaking at 16 against
the shipped ceiling's 9, and the same fleets with one mesh scanned frame by frame reach 16. Once a mesh is full the deposit
point disappears from `obs.netDeposit`, the machine's ALGAE routes to the PROCESSOR, and the HUMAN PLAYER stops
throwing into it rather than spending a throw slot on a piece that cannot count. That part of the arm has kept
its sign on every base: the cap
alone takes `1.46 ± 0.29` rings out of the two NETs on the 9000 base and `1.50 ± 0.24` on the 21000, and puts
`1.13 ± 0.24` / `1.29 ± 0.27` of them back through the PROCESSOR, where a ring pays 6 instead of 4, so the ceiling
alone leaves the batch ahead on both bases (`+2.29 ± 2.68` / `+2.25 ± 2.70`) and both #117 changes together are
inside their own bars (`+2.67 ± 3.80` on the 9000 base, `+0.25 ± 4.50` on the 21000). The weakest ALLIANCE of the guard's
48 MATCHes draws 31 CORAL at the shipped engine against the 29 it draws with the pile-up escape switched off — the
cycle the mesh now makes a machine spend elsewhere, not
a pile-up, which is why guard 16 reads that floor against the same batch with the escape off
instead of against a number pinned to one engine build.

### One ring per face, and the hexagon the other way round

Two field errors shipped together, and both came from reading the manual's isometric figure instead of its
top-down ones.

**The ALGAE.** `reefAlgae()` used to put two rings on each of three alternating faces. §6.3.4.2 A says "6 ALGAE
are staged on pairs of BRANCHES as shown in Figure 6-3", and each face carries two BRANCHES at a level (12 per
level over six faces), so a ring on a *pair* straddles one face — six faces, one ring each, not three faces with
two. Figure 5-4's ring centroids sit on the face normals, at 0°, 60°, 120°…; the same six directions the
BRANCHES use (`branchSlots()` in `web/js/model.js`), which is what a ring wedged between two pipes has to do.
The fix is one line and it changes the shape of every ALGAE route: a machine at a branch is now a foot from the
ring on its own face, and stripping a REEF costs six stops instead of three.

**The rotation.** `hexSupport()`, `reefPenetration()` and `hexPath()` all placed the first vertex on the +x
axis, which points a *corner* at the ALLIANCE WALL. Figure 5-4's outline is flat-sided to the wall and Figure
6-2's is too; the vertices are therefore at 30° + 60°k and the face normals at 0° + 60°k, which is what the
branch spacing (13 in along a face parallel to the wall) has always assumed. The collision shape, the drawn
shape and the ROBOT start squares now agree on that. Both figures were read by extracting the embedded raster
and thresholding for the piece colour, then scaled off the REEF ZONE's 93.5 in face-to-face (§5.2), because the
manual's overlays are not globally to scale.

What it costs is spread through this file rather than hidden in a diff: refusing ALGAE work entirely reads
`−34.7 ± 3.0` and `−36.6 ± 2.1` (`npm run headroom`), the pins' ALGAE column is `−1.04` of its `+8.88`
(`npm run measure`), a three-machine duty fleet crosses 0.90 times a MATCH against the engine's 0.75 (`npm run
verify`'s guard 26), and the #117 NET lanes print `+1.29 ± 3.76` and `−5.04 ± 3.76` combined points a MATCH for
the spread alone on the two seed bases — against the `+17.3 ± 1.7` and `+14.9 ± 1.9` this same pair read before
#122, because the corner queue they were priced against is not the queue this REEF makes. All eight committed
fingerprints were re-recorded on this geometry.

### The six CORAL MARKs were on the wrong side of the REEF

§5 defines a CORAL MARK as "1 of 6 4 in × 4 in \"+\" marks" and §6.3.4.1 A stages one CORAL on each, three an
ALLIANCE, without writing a distance for them. The build had put them 48 in from the REEF centre on the **BARGE**
side. Both of the manual's top-down pictures put them between the REEF and its own ALLIANCE WALL, with the wall
behind them, and further out than that.

Figure 5-4 (the plan view of areas and zones, 1148 px wide) is internally consistent at 1.09 px/in: its
guardrail-to-guardrail span is 346 px for §5.1's 317 in, and its two REEF ZONE hexagons are 105 and 101 px for
§5.2's 93.5 in face-to-face. At that scale the mark line sits 136 px from the blue REEF centre and 48 px from the
wall, so it is 0.74 of the way from REEF to wall; Figure 6-2's staging render reads 0.64 at its own local
1.508–1.542 px/in. The build takes the fraction and its own datum rather than the raw pixels, which puts the line
**38 in off the ALLIANCE WALL**, 106 in behind the REEF centre. Across the field the three marks are 77.7 px apart
in Figure 5-4 and 109.9 px in Figure 6-2 — 71.3 in and 72.3 in at their own scales — so `MARK_SPACING_IN` is
**71.5**, the one number the two pictures agree on rather than a fraction. Which side of the REEF they are on is
not an estimate; the inset is, because these are renders and not dimensioned drawings, and the same scale puts
the two REEF centres 337 in apart, which is what §5.3's "12 ft. away from the ALLIANCE WALL" returns only if the
12 ft is read surface-to-surface while this build reads it centre-to-wall.

The move then exposed a second error that was not about MARKs at all. The fleet was staged 40 in on the REEF side
of its own ROBOT STARTING LINE, and G303-D requires the opposite: at the start of AUTO "its BUMPERS overlap their
ROBOT STARTING LINE". With the marks behind the REEF every scripted AUTO leg crossed that line twice, and LEAVE —
which §6.5.2 judges at the AUTO→TELEOP boundary — would not come back to the ledger's 9. Both halves are fixed
together: `robotStart` is now the line's own coordinate (x = 232 in for blue) at ±40 in along it, and the LEAVE
test is symmetric, `Math.abs(rb.x - line) > half`, because the clause names the BUMPERS and no direction. Nothing
in the manual says a ROBOT has to end AUTO on the BARGE side of the line, and this build no longer assumes it.

What that cost, and what it bought: the mirror moved from `269.1 ± 1.8` / `265.6 ± 2.0` and a margin of
`3.58 ± 1.93` to `262.5 ± 2.5` / `264.8 ± 2.3` and `−2.27 ± 2.50` over the same 48 MATCHes, the AUTO column of the
generic trio reads `5.50` an ALLIANCE where it read `6.46`, and the planner's separation from the best fixed rule
got *bigger* rather than smaller — `+8.3 ± 1.5` and `+8.8 ± 1.7` from blue on the two bases against a fixed-rule
null of `−1.4 ± 1.5` and `+2.7 ± 2.0` (`npm run strength`). The one honest reversal in this file is the ROBOT NET
lift: on the MARK geometry a one-sided lift is a loss even one-sided (`−5.7 ± 4.0` margin at the shipped nine-ring
ceiling), which is the sign opposite to the one the #117 round published, and the arm that reads positive only does
so with the ceiling taken off.

### A hexagon between a machine and its waypoint, and a CORAL that falls out on the drive

A ROBOT is driven to a point, and §5 puts exactly one solid thing on the carpet between two of those points: the
REEF, a 65.5 in hexagon. The build had no answer for a waypoint behind it — the machine drove into the face,
`reefResolve` pushed it out, the policy re-decided 0.2 s later and bid the same piece again. `npm run measure`
reads that as **3.61% of ROBOT-seconds** spent inside a stretch of at least three seconds in which a machine is
against a REEF, its waypoint more than 22 in away on the far side, the straight line to it crossing the hexagon,
and it closes less than 4 in on the whole stretch: **9.1 such episodes a MATCH, the longest 39.6 s** of a 150 s
clock, on 12 mirror MATCHes at seed base 9000. The pile-up escape fires 16.3 times a MATCH on that same batch,
and guard 16 is what it is worth there — the tail of the distribution, not its mean.

The answer is a waypoint the machine can actually follow. When a hexagon is on the line, the aim point moves onto
the tangent of a circle of (REEF corner + the car's own half + 8 in) about the structure, pushed to the side the
REEF is *not* on, recomputed every tick — so it walks the face and takes the direct line again the moment the
line clears. Two `[estimate]` knobs came out of the sweep rather than out of a guess, and they are worth very
different amounts. The **width** barely matters once the rest is right: 2, 4, 8 and 14 in read `0.67%`, `0.65%`,
`0.51%` and `0.60%` of ROBOT-seconds pinned-and-blocked, longest stretch `8.4`, `8.0`, `7.6` and `7.2` s, so 8 in
is kept as the width that also keeps the long stretches from coming back. The **gate** is everything. Diverting
*every* trip a hexagon stands in cures the symptom and takes the Johnson preset from **56.8 CORAL an ALLIANCE to
54.6**, out of the ±4 band guard 17 reads against TBA's record, because a fleet working its own REEF has
structure on the line almost always. Waiting **0.6 s** of closing less than 1.5 in, for the machine that is
really pressed, cures the same share and leaves that column at **57.6**. On the generic trio the swing is worth
**+5.54 ± 2.85** own points (24 paired seeds, base 9000) and the same arm is positive read from the other seat
and the other base (`+1.96 ± 2.88`, `+0.58 ± 2.52`, `+8.46 ± 2.71`).

The clock is a property of one drive leg, and that mattered more than the width. The first version latched the
press on the machine, so a robot that had once pressed carried the swing through its next placement and diverted
on the first blocked tick of the leg after it without the 0.6 s ever being spent; the ablation pair showed it
because the same switch-off stopped reproducing a replay that had nothing else in it. The clock now restarts when
the leg does — the machine starts working, faces an element, loses its waypoint, or the detour is switched off.

The second mechanism is a held CORAL coming loose on the drive rather than only on a missed placement. The
trigger is the acceleration the drivetrain actually got — a machine pinned against the separation solver
accelerates hard and moves nowhere, which is the shudder that shakes a piece out — and the rate is **0.01 a
second of full throttle**. `npm run measure` reads **2.38 CORAL a MATCH** loose this way across the six machines
at that rate, 1.08 at 0.005 and 3.88 at 0.02, for **−4.08 ± 2.80** own points (23 of 24 paired MATCHes score
differently); three of them are in the replay this repo fingerprints. `[estimate]` on both numbers, because §6.5
bills a piece that is not held and never says how it came to fall, and the three rates price within one another's
error bars — the row that decides is how many pieces a MATCH can be seen to lose.

Both are switchable, and `detourOff: true` with `carryDrop: 0` hands back the engine before them on all eight
replays `scripts/invariants.mjs` pins (guard 7g). The off value of a rate that spends no random number at all is
the same MATCH, not a different roll of it.

### Defense, theft and the contact fouls

`INTENT.DEFEND` is a seat that stops collecting and starts pressing: it shadows the nearest opponent who is
*out* of their own REEF ZONE or BARGE ZONE (G427 bars contacting "an opponent ROBOT partially or fully inside
the opponent's BARGE ZONE or REEF ZONE, regardless of who initiates contact", so pressing a car in its own zone
is donating a MAJOR — 6 points), still spends what it
is already carrying, and still climbs in the endgame. Fetch can name the opponent's CORAL STATION as a source
and STRIP can name their REEF, so a machine on the other side of the field is not idle.

What that is worth is measured, and it is not what the action looks like it should be (`npm run measure`, 48
paired MATCHes over two seed bases, "own" = the pressing ALLIANCE's total, "off" = the pressed one's): **forcing
one seat to defend costs its own ALLIANCE `−5.2 ± 1.3` and takes `−4.0 ± 1.6` off the opponent** — within the bars
of a wash, and the dearer half of it is the presser's. With the §7.4.4 adjudication off the same arm reads
`−7.3 ± 1.4` own and `−3.1 ± 1.5` off, so the cards and the impairment the two cars earn are worth 2.1 points to
the pressing side's own total and cost the other one 0.9 more: the referee's bill lands on both, and the press is
not stopped by it. Two defenders read `−5.7 ± 2.2` own for `−3.4 ± 1.8` off the opponent: the second seat costs
its own side half a point more and takes 0.6 *less* off the other one, so past one machine nothing is bought. And
what makes it lose is not the shadowing: the same
arm read on the **margin** is `−35.38 ± 3.40` over the **23.9 s** a MATCH the seat spends in the ring —
**−1.481 a press-second** — and the difference between the two readings is the ~30 foul points a defender donates
(`npm run contact`: 4.9 and 5.1 fouls a MATCH for 29.2 and 30.3 points, 158 of them G427 over the 48 MATCHes). In this model defense
is a negative-margin action, and that is why it is no longer
something a seat is ordered to do: the six DEFEND checkboxes are gone and the decision is in the
planner, bidding one second of pressing against one second of the cheapest cycle on its menu at a price
(`pressTakePerSec` 0.08) that is an order of magnitude below the −1.481 the margin shows once the fouls are
counted. It is NOT above the ~0.17 a second of shadowing takes off the opponent's play (4.0 points over 23.9 s),
which is what it used to
be: the price is deliberately set against the fouls rather than against the damage, and #116 is the open task
that has to give that choice a source. `npm run verify`'s press guard reads what that price buys — `0.0 s` a MATCH with the
rule off, `1.4 s` at the shipped price (the seconds the 4 s cycle cutoff hands back), `54.2 s` once the price is
raised to 3, where it costs itself `18.7` press fouls a MATCH against the shipped `0.4`. The shipped trio's
contact IMPAIRMENT is also capped, at 4% per hit against the 2026 build's 15%, so a press cannot end an
ALLIANCE's MATCH.

The two deny-source options are worth a fraction each, and on this geometry the fleets barely take them at all:
switching CORAL theft off moves the would-be thief `+0.1 ± 0.2` of its own total and `+0.4 ± 0.3` off the opponent
over 48 paired MATCHes, and switching the opponent's REEF ALGAE off *gains* the fleet `+0.1 ± 0.6` of its own while
taking `+0.3 ± 0.4` off the opponent. Greedy bids distance-per-point from its own REEF, so two fleets rarely
arrive at the same opponent STATION, and nothing here separates the re-priced ALGAE route from the traffic that
moved with it. Whether the machinery works at all is guard 24, which sends one machine there on
purpose: RED's queue went from 27 CORAL left to **3** while BLUE's went from 20 to **57**, 23 CORAL still got
placed, and all 126 the MATCH stages are still accounted for; the enemy-REEF strip takes blue's opponent from
9 rings to **0** while its own REEF still held 0 and booked 18 in the PROCESSOR.

What the enemy REEF *costs* turned out to be the interesting half, and the ledger found it rather than the
clause list: the fouls a stripping fleet donates are not the G427 zone contacts the clause table points at but
**G418 — contacting an opponent CAGE**, which is what the only route to their REEF runs past, plus G421 when a
second machine is out there with it. The gap between what the model charges for the trip and what the trip
actually hands over is printed rather than closed: guard 26 reads a three-machine duty fleet crossing
**0.90** times a MATCH against the engine's own **0.75** (one machine **0.30** against **0.13**) and the model
charging **2.7** foul points for it against the **51.3** the duty fleet really donates, most of which is traffic
rather than G418 — so `CROSS_FOUL_PTS` is not a measured per-ring price and this file says so instead of the
docs implying one. The same guard reads the ALGAE column of that fleet at **9.90** rings against the engine's
**9.63**, and in a mirror, where both alliances run the duty, the three arms rank **−0.9 / −1.8 / −2.7** below
no-duty and the trip moves the column (**9.00** against **9.00**) instead of adding to it.
`policy.js` still holds a strip back
while an opponent is sitting inside its own REEF ZONE (`zoneRisk`, off is the control arm), and guard 25 reads
what that does on the engine's own deny counter rather than on where a machine is pointing. On the MARK geometry
the shipped fleets take **0.00** rings off the opponent's REEF with the gate off and **0.00** with it on — 0.0
points of combined score and 2.63 fouls donated either way — so the gate is no longer what holds them home:
their own NET and their own MARKS are, and nothing in this file measures what does. The bite is still there when
a fleet is told to go: ordered to strip it reads **0.06** gated against **0.75** ungated and pays
**37.8** more fouls than the **0.44** rings it buys, while the
control that refuses both crossings takes **0.00** rings and **0.00** calls inside their REEF ZONE a MATCH even though
its own CAGE-area traffic still costs it **5.63**. That a
machine pointing at a ring past the centreline is not a crossing at all (a ring that fell and rolled over there
belongs
to neither REEF) is exactly why the guard stopped reading the target — and why the control's own read is a
rate against the ordered fleet's rather than a demand that it be exactly zero, since a REEF that offers six
reachable rings also drops six that can roll.

§7.4.4's three clauses are adjudicated together, one call per collision, because the manual makes them
mutually exclusive and asks for only the most punitive penalty. G422 needs a COMPONENT outside the ROBOT
PERIMETER, which nothing in this build has, so it is blocked by construction; G423 (damage or functional
impairment) and G424 (deliberate tip or entanglement) are MAJOR + YELLOW CARD, or + RED if the victim
"cannot be driven", and §6.6.2 turns a second YELLOW in the same MATCH into a RED, which DISABLES that ROBOT
for the rest of it — the escalation the 2026 build did not need and this one does. The guard's MATCH takes 6
calls (all G423), cards every one, and leaves 3 ROBOTS disqualified. Impairment is modelled as a speed
fraction for a fixed number of seconds rather than as broken hardware, because the engine has no mechanism
model. G421 (two ROBOTS across the BARGE with their BUMPERS out of the zone) is charged per 3 s uncorrected,
and the shipped traffic never earns it: over 18000 frames of 24 MATCHes, 144 held a *single* ROBOT across with its
bumpers clear of both zones and none held a second, so guard 23b drives two across on purpose and reads the
MINOR → MAJOR escalation — 52 fouls over 2 ROBOTS, 2 of them escalating as §7.4.3 says. What #117 corrected was the boundary, not the traffic: `checkDefenders` exempted the
whole `midX ± 46 in` stripe, reading the two BARGE ZONEs as one band, while the clause's exemption is the zones
themselves — 3 ft 10 in deep by 12 ft 2½ in long each (§5), which leaves a 21½ in gap at midfield and 1¼ in at
each rail. The test is now those two rectangles measured against the ROBOT's oriented footprint, the same
construction `squareContact` uses, and the guard counts with it instead of with an axis-aligned 15 in. It is
fidelity with no measured cost: `0.00 ± 0.00` points and `0.00 ± 0.00` fouls paired over 96 mirror MATCHes and
over the 24 the traffic guard runs, because none of the 144 frames that do put a machine over the centreline with
its bumpers clear of both zones holds a second one there.



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
more than 5 CORAL above the generic trio's (39.6 an ALLIANCE, from its 11.5/12.0/11.9 branches plus 4.2 in the
TROUGH on the same seeds). Currently Johnson makes 56.8 an ALLIANCE
against 59 recorded, Newton 56.1 against 56, at 7.3 and 7.5 AUTO against 9 and 9, 8.4 and 8.3 in the NET
against 9 and 9, and 3.00 and 3.00 DEEP
CAGEs against 3. The split the same guard prints — 23.1 / 21.1 / 12.5 and 21.5 / 21.4 / 13.2 against the
25.1 / 21.8 / 12.1 and 22.2 / 21.5 / 12.4 the two sources imply — is close enough to be the
same shape and not close enough to call it fitted. Their TOTALS are `307.0` against the recorded 295 for
Johnson and `306.0` against 281 for Newton, of which 27 and 29 points is the PROCESSOR column each record does
not carry (4.5 and 4.8 ALGAE): take it out and they read 280.0 and 277.0 — 15.0 short of Johnson's 295 and 4.0
short of Newton's 281 — which is the shape of a fleet that lifts its ALGAE into the NET like the recorded
alliances did and still has a PROCESSOR left to fill.

## Measurement discipline

Inherited from the 2026 build, where each of these was paid for in a wrong number:

- **A mirror means the same trio on both sides.** The page can now put a different trio on each ALLIANCE,
  which is what the two real 2025 finalist alliances are, so the mirror is a checkbox rather than a default.
  With it off the BATCH margin is a ROBOT comparison and the batch card says so; a strategy claim needs it on.
- **The page's batch is paired by its seed base.** The Batch tab runs `seedBase`, `seedBase+977`,
  `seedBase+2×977` … — the stride `npm run measure` uses — and the base sits in a field instead of being
  rolled, so pressing the button twice measures the *same* MATCHes and the line under the charts is a paired
  difference. Changing the base is the other question (what does a fresh draw of the field say), and that
  line names which of the two it just priced, along with every setting that moved between the two runs.
- **The engine serves the alliances alternately**, on the tick and on the decision clock. Building
  blue first lets blue win every contested piece, which was worth ~30 points between two identical
  policies in the other game.
- **Staging is point-symmetric about the field centre.** An asymmetric layout makes one side's element
  closer and shows up as a fake seat advantage. The BARGE's own half was the violation of this line: the
  CAGES, the NET and the BARGE ZONE were all offset into the opponent's half, so the field the mirror was
  played on was not symmetric at all.
- **State n and the standard error.** `npm run verify` prints the mirror over 48 MATCHes as
  `262.5 ± 2.5` blue and `264.8 ± 2.3` red with a margin of `−2.27 ± 2.50`; the greedy-vs-random arm wins
  16 of 16 with a margin of `129.8 ± 8.0`. That arm used to read one draw's error bar, because
  `randomPolicy` was ignoring its per-MATCH seed — the same "random" fleet in all 16.
- **A mirror that always ties is not testing anything.** Run the mirror with `tempoJitter: 0` *and* the CORAL
  unable to miss and the two ALLIANCES are one deterministic process played twice on symmetric geometry: over
  288 paired seeds that arm used to take 24 of them as exact ties, which is not a finding about the game — it is
  the model having no way to tell the two sides apart. Each ROBOT now draws one tempo factor per MATCH
  (`model.tempoJitter`, ±20%, and
  the results table prints it per ROBOT) and each HUMAN PLAYER draws its own form. The guard asserts the
  |margin| rather than the ties, because the tie count is noise at n=288 — with the jitter off the deterministic
  arm still ties a score of those seeds and with it on a different score, and demanding either be a particular
  number is a coin flip. What is asserted is the
  widening: as shipped the spread takes the mean
  |margin| up (guard 15 reads `10.5 → 11.6` over 576 paired seeds, `1.10 ± 0.51`, and ties 32 → 28), and with CORAL
  unable to miss it does too (`0.57 ± 0.47`, ties 26 → 30); over the 96 seeds
  `npm run measure` sweeps, ±0% reads `10.0 ± 0.7`, ±10% `10.2 ± 0.9`, ±20% `11.3 ± 0.9` and ±40%
  `16.8 ± 1.3`, with exact ties 7 → 6 → 4 → 2 across those arms. The three real 2025 Einstein Field finals
  margins were 11, 14 and
  17, so ±10% and ±20% sit inside that band and ±40% above its top — a bigger claim about two copies
  of one design than this build wants to make. What keeps the margins from separating further is that both
  ALLIANCES still drain the REEF's branches, and that is Stage 3's tempo calibration.
- **Pair an ablation on the same seeds, and name the seed base.** Two independent means carry the seed
  spread, and the seed spread of this engine is several points. The heading-spin-ramp arm has read `5.8`
  unpaired, `0.9 ± 1.2` paired over 96 seeds, `+1.2 ± 3.0` paired over 24 on the 9000 base, `+6.5 ± 2.7` there
  with 24/24 scores different, `+5.3 ± 2.4` on the 21000 base (22/24) and `3.8 ± 1.9` over the guard's 48 paired
  seeds (46/48 differ) — and on the #124 geometry the same arm is `−1.8 ± 2.5` on the 9000 base (24/24 differ),
  `−0.0 ± 2.6` on the 21000 (23/24) and `−0.4 ± 1.9` over the guard's 48 (44/48), which is why guard 14 asserts
  the digest and reports the score instead of asserting a sign it cannot resolve. The base that reads minus two
  and the base that reads nothing are the same engine, and the shift between the last two readings
  of one base is the reason this page quotes the 48-seed run rather than a single arm. Pairing makes the
  difference real, repeating it on another base makes it stable, and re-reading
  it after anything that moves the ROBOTS is what keeps the first two honest. The cheapest example of all is
  the HUMAN PLAYER: switching its throws off is worth `+17.3 ± 2.5` a MATCH over 24 paired seeds, 22/24 scores
  different — a mechanism the old build could only have guessed at.
- **Every physics knob has an off value.** `foulsOff` is checked to credit zero, `algaeInNetByHuman`
  off is checked to leave both NETs empty, and `accuracy: 0` likewise. `turnRampOff` and
  `contactRestitution: -1` are checked a step earlier: each has to change the recorded replay's digest,
  so a knob that quietly stopped reaching the motion code fails the build instead of becoming folklore.
  "Off credits zero" is only half a test, though: the shipped baselines charge **no fouls at all** across the
  24-MATCH mirror, because greedy never drives into an opponent, so guard 22 runs a fleet that does (one side
  parked, one pressing the nearest car, eight presses) and requires the ON direction to produce points — 1079 of
  them, `G405×15 G403×110 G421×800 G427×7 G425×146 G423×1`, worth 6374 — and it reads G425's escalation, which is the only
  severity in Table 6-3 that depends on how long the violation has already run (MINOR, then MAJOR per further
  3 s). The same fleet is what made two referee bugs visible: a contact foul used to be charged every 1.5 s
  that the two cars stayed touching, which turned one engagement into ~10 MAJOR FOULs, and a PIN was called
  whenever *this* car was pushing, when §G425 defines it as preventing the *other* one's movement. Both are
  now one call per engagement (a pair that separates for less than a second is still the same engagement)
  and a PIN that reads the victim's speed.
- **An off value also pins the model it came from.** `tempoJitter: 0` reproduces the replay committed before
  the spread existed; `placementRisk: false` reproduces the one with no misses in it. As of #124 the
  shipped fingerprint is `39e8cfaf` (255-237, 750 frames, 157 events), its jitter-off value is `9cb1982c` (263-267),
  `placementRisk: false` prints `ec227315` (263-269) and the two off values compose into `c7f6d163` (301-281).
  With `detourOff: true` and `carryDrop: 0` folded into each of them the eight print the engine that ran before
  #124 — `b365567f` at 243-257 and its seven ablation partners — which is the form the ablation had to take once
  two more switchable mechanisms were in the steering.
  Four of the eight moved this round, for two reasons that are the same reason: #124 swings a machine around a
  hexagon that used to stop it, and its press clock is now scoped to one drive leg, so a latch left behind by the
  leg before a placement no longer buys the next one an instant detour. The pins are therefore no longer the values committed before
  those models — they are this round's values with each mechanism switched off — and what proves the ablation
  still ablates is read straight off the replay: `placementRisk: false` books **0 dropped CORAL** while the
  shipped replay books its misses. On the golden seed 76 placements were booked, every one of them begun within
  23° of its
  branch, 27 did not stay on, and 3 more came off a carrier on the drive. Nothing else this round — DEFEND, the
  opponent's STATION as a fetch source,
  their REEF's ALGAE in the strip gate, §7.4.4, G421 — reaches a MATCH where two greedy fleets work their own
  REEFs: the shipped mirror books no fouls at all, and the §7.4.4 trio charges none with its switch off.
- **A threshold has to be placed against a distribution that exists.** The §7.4.4 trio's severity floor came
  over from the 2026 build at 130, and `npm run contact` showed the number was meaningless here: two mirror
  greedy fleets produced **0 collisions over 48 MATCHes** at the time, because
  each alliance works its own REEF. That distribution has since moved three times — the CORAL that falls off a branch
  sends a machine back out, #122's six reachable rings put three machines on one structure, and #123's MARKs put
  the queue behind the REEF instead of beside it — and the same
  arm now reads 0 and 3 collisions over 24 MATCHes on the two bases (0.0 and 0.1 a MATCH), still nothing like a
  defender's sample.
  The sample that has any collisions in it is still the one that fields a defender —
  512 and 479 of them over 24 MATCHes on the two bases, median 32 and 39, p90 112 and 119, p99 187 and 193 — so the
  floor sits just under that p90 (`CONTACT_HIT_SEVERITY` 100) and the tip floor just under its p99 (180). A
  two-defender fleet is wider (700 and 724 collisions over 24, median 37 and 37, p90 109 and 122, p99 203 and
  207), which is the point of re-measuring rather than re-asserting. With one defender forced on, the §7.4.4 trio
  assesses **3 calls over those 48 MATCHes** (all G423 — 0.06 a MATCH) and none between two fleets
  that never meet; the whole press bill is **4.9 fouls a MATCH for 29.2 points** on one base and 5.1 for 30.3 on
  the other, and almost none
  of it is §7.4.4: over those 48 MATCHes 158 are G427, which bars contacting "an opponent ROBOT partially or
  fully inside the opponent's BARGE ZONE or REEF ZONE, regardless of who initiates contact",
  and 73 are G418 against the opponent's CAGE — which is why the shipped DEFEND targets an opponent who is
  *out* of their own zones, why the hold point is clamped out of them, and why a defence study in this game is
  mostly a geometry study. That is the
  honest shape of a 2025 MATCH: the manual's own note says "FIRST Robotics Competition can be a full-contact
  competition", and the zones are protected so well that contact fouls are rare.
- **An ablation measures what the mechanism currently does, so re-read it after anything changes the
  traffic.** The bumper momentum exchange is the most misled number on this page. It read `+14.3 ± 4.3` on
  a perfect mirror (where the two sides' collisions cancel), `+53.2 ± 14.1` and `+50.4 ± 12.9` on two seed
  bases once the machines were allowed to differ, `+3.8 ± 2.2` once an explicit pile-up escape took the
  bounce's day job, `+8.6 ± 2.6` (`+6.2 ± 3.0` on the second base) after the CORAL started falling off
  branches and sending machines back out to the STATION, `+15.0 ± 8.2` and `+7.8 ± 2.6` once the mesh had lanes
  and a ceiling (23/24 and 22/24 differ) with the guard's own 16 paired MATCHes reading `10.6 ± 4.3` of score,
  then `+20.9 ± 9.8` and `+13.9 ± 7.3` (24/24 and 22/24) with the guard's 16 reading `15.4 ± 5.0`, on the
  MARK geometry `−0.2 ± 2.9` and `+11.7 ± 3.9` (22/24 and 24/24) with the guard's 16 reading
  `5.8 ± 3.7`, and after #124 re-routed the blocked trips around the hexagon and #125 started shaking CORAL
  loose on the drive, `+1.5 ± 3.3` and `+7.1 ± 4.8` (23/24 and 23/24) with that run reading `10.3 ± 4.3`.
  None of these was a better measurement of the impulse than the one before it: the first
  two were measuring the corner pile-up, which the bounce happened to be shoving three machines out of, and
  the rest are measuring whatever traffic the last model change left behind. What has stayed put is the
  quantity that is not score: pairs spend 3.3% of their frames in contact as shipped, and taking the exchange
  out moves that share by `1.73 ± 0.23` percentage points over 16 paired MATCHes. That is why the physics guard
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
  the same ablation on the corrected one is the escape doing real work again — guard 16 reads it as a 48-MATCH
  batch of **530.4** points against **529.7** when the escape is switched off, a widest mirror gap of **43**
  points against **51**, and the weakest ALLIANCE flooring at **31** of the 60 CORAL the field holds with the
  escape on against **29** with it off. Backing out is needed **10.2** times a MATCH,
  and more
  than 40 would mean it has become the way the engine drives rather than repairing. Neither first attempt at
  the escape was right: a speed test fired 0 times, because a pinned machine is at full throttle and going
  nowhere, and a "have I closed on my best distance yet" test fired 4258 times a MATCH, because after the
  window resets that comparison is true on the very next tick. What works is 3 s of intent plus less than
  4 in closed, and guard 16 asserts both ends of it.
- A ROBOT told to place at the highest free branch keeps pushing at it even when a TEAMMATE is standing in
  front of it, which is parking with a full gripper rather than scoring. 4 of 96 MATCHes ended with one
  ALLIANCE holding CORAL while two L3 branches stayed empty and its twelve L2 branches and its whole TROUGH
  went unscored. `PLACE_PATIENCE_SEC` makes it aim one level lower after 4 s of no progress; the same
  reasoning as the pile-up, one layer up in the stack.

## What is not true yet

Read this before quoting any absolute number.

Two things changed since this section said the profiles were simply uncalibrated. The named presets are
now tied to a real ledger: Johnson A1 makes `56.8` CORAL an ALLIANCE where TBA recorded 59, Newton `56.1`
against 56, and both bank `8.4` and `8.3` NET ALGAE against the recorded 9 and hang `3.00` DEEP CAGES
against 3, so their per-machine tempos are no longer free to drift. And the corner pile-up is gone: over the
48-MATCH mirror batch the guard's margin used to read `30.6 ± 15.5`, then `4.00 ± 1.92` once the escape existed
but the BARGE was on the wrong half, and now reads `−2.27 ± 2.50` (blue 262.5 ± 2.5 against red 264.8 ± 2.3).

What is still hot is the alliance TOTAL. On seed 12345 the mirror is `255-237`: blue 166 CORAL points,
50 ALGAE (3 processed, 8 in the NET and 6 of them lifted in by a ROBOT), 9 LEAVE, 30 BARGE and no fouls; red
150 CORAL and 48 ALGAE (2 processed, 9 in the NET, 7 lifted in).
Against the one MATCH whose
ledger has been read line by line (`2025cmptx_f1m1`) that is the recorded *shape* — 9 NET, no PROCESSOR column
at all. Over the guard's 48 alliance-sides the generic trio is at 39.3 AUTO CORAL points where Johnson took 63
and Newton 60, 9.0 LEAVE where both took 9, 11.5/12.0/11.9 of the three branch rows where both filled all
three (Newton left one L4 empty), 4.2 trough CORAL where the finals left 23 and 21, 8.2 NET where both left 9, and 2.00 DEEP CAGES where
both hung three. Its PROCESSOR column is 4.7 rings, 28 points, and the alliance mean with it is `262.6`; take
the column out and the guard prints 234.4 — against a field that averaged
260.56 over its 32 playoff alliance-sides and topped out at 301. The mean is inside the real band either way, and
so is the arm with the NET reach forced back to 0, which prints `295.3 ± 2.7` and `289.3 ± 2.5` across the
24-MATCH mirror — 32.0 ± 3.1 points of score above the shipped one on the paired seeds, because a machine that
lifts a ring spends
elevator time it would otherwise spend on a branch.

The two columns the lift did not touch are still out of line: AUTO (39.3 points against a recorded 63 and 60)
and the TROUGH (4.2 of its 24 against the finals' 23 and 21).

**AUTO has now been worked, and the residual is distance.** The ledger puts nine CORAL an ALLIANCE in the
period, all of them on L4, because 9 × 7 = 63 is the only way that row closes inside 295. `npm run measure`
tests four explanations against the engine and kills all four. Scripting a fourth piece on every machine buys
`+0.40 ± 0.10` AUTO CORAL and `+2.71 ± 0.67` AUTO points, gives back `−0.06 ± 0.44` in TELEOP, adds
`+0.33 ± 0.44` to the MATCH's total CORAL column and `+1.17 ± 1.26` to its score, with LEAVE at `+0.00 ± 0.00` —
more pieces in the period, no MATCH won by it. Loosening the budget test's own
error bar is the same trade smaller: slack 0 reads `+0.10 ± 0.04` AUTO CORAL (`+0.73 ± 0.31` points) and slack
−0.8 `+0.23 ± 0.07` (`+1.60 ± 0.48`), both taken out of TELEOP (`−0.60 ± 0.40` and `−0.88 ± 0.55`) and both for
`+0.00 ± 0.00` LEAVE. LEAVE stopped being the price of any of this in #123: the fleet
now starts *on* its ROBOT STARTING LINE, as G303-D requires, so the cross the 15 s budget used to buy with a leg
of the routine is 15 in of bumper. Rounding each team's own Statbotics `auto_coral` (Johnson
4.19 / 2.47 / 1.55, applied as 4 / 2 / 2) instead of splitting the alliance ledger cuts both ways — `−0.98 ± 0.68`
total CORAL on Johnson, `+0.08 ± 0.27` on Newton — so the shipped rule stays the ledger split.

The fourth arm used to be the one the planner kept, and #122 took it away. De-conflicting the three scripted
paths so they do not all bid on the nearest CORAL MARK (`autoCrowdSec`) was pinned at 1.5 s in `ai.js` on
`+0.28 ± 0.05` AUTO CORAL, `+0.92 ± 0.23` more STATION picks and LEAVE `+0.25 ± 0.12` over 144 paired
alliance-sides — a lever that spent neither ledger column. That read belonged to the REEF with a VERTEX toward
the ALLIANCE WALL: the three starting squares were inside that hexagon, so `reefResolve` shoveled all three
machines off their own start on tick 1 and the paths really did cross. On the FLAT Figure 5-4 draws, with the
starts on the line and the MARKs behind the REEF, the same 144 alliance-sides read `0.21 ± 0.06` AUTO CORAL for
`−0.17 ± 0.24` STATION picks and `0.00 ± 0.00` of LEAVE, and the MATCH score that buys is `+1.08 ± 1.64` on the
named lineup and `+1.73 ± 1.87` on the generic trio — both inside their own bars. So the pin is 0, and guard 30
holds the retirement rather than the price: the lever must still reach a MATCH when it is paid (58/144
alliance-sides move their AUTO paths),
`autoCrowdSec: 0` must still be the shipped baseline behaviour, and `ai.js`
must still be the retired one — which is what notices the price being put back while the guard goes on praising a
lever nobody pulls. What is left is distance, and the frames now say so directly (`npm run measure`): the generic
trio banks 5.50 CORAL an ALLIANCE, making 31% of its AUTO picks at a MARK and 9% at its own STATION and 60%
re-picks of a piece already loose on the carpet, standing still for 21% of its AUTO robot-seconds, and leaving
56.3 of the station's 57 CORAL there at the whistle. Johnson A1 reads 7.46, 37% / 22% / 41%, 22% idle and 55.3 of
57 still on the shelf. §6.3.4.1 A stages six floor MARKS, three an ALLIANCE, and §6.3.4.1 B three preloads, so
six pieces are reachable without leaving one's own half; the ninth has to come off a CORAL STATION pocket about
190 in away, in the corner where the ALLIANCE WALL meets the guardrail, and a routine that spends most of its
period re-picking what its own placements dropped is not going to make that trip. That is why the column is
written down short rather than fitted — the knobs that would close the rest spend TELEOP, which is another ledger
column this file is scored against.

The TROUGH is the other one still out of line, and Stage 3's remaining work is that column plus the per-column
counts re-read, not this paragraph re-argued.

The consequence for the planner is unchanged: at that level the REEF is capacity-bound, **greedy is already
at the ceiling**, and the only headroom is which branch, which level and when — plus the endgame. Slowing
the cycle estimates turns the REEF from a stock that always empties into one that does not, which is the
game where allocation matters and where a margin can be more than a branch. It
also makes the ALGAE margin price work: with the supply exhausted, blue processes 9 ALGAE whatever red's
HUMAN PLAYER can do with them, so the 6 − 4 × accuracy discount in `policy.js` changes no decision yet.

That calibration is Stage 3 and needs per-match CORAL and ALGAE counts, not only totals.

## Stage 2: what the planner does, and what it bought

The planner exists (`web/js/ai.js`, selectable as **Planner** on either ALLIANCE) and it beats the shipped
baseline from both seats: `npm run strength` runs n=96 mirror MATCHes on each of two seed bases in both seat
orders, and on the 9000 base the planner's own-side margin is `+19.6 ± 2.0` (285.9 against 266.2) from one seat
and the reversed pairing leaves the baseline `−16.3 ± 2.3` (272.8 against 289.1); on the 21000 base `+18.7 ± 2.2`
(287.5 against 268.9) and `−17.7 ± 2.4` (267.2 against 284.9). It wins `89.1% ± 3.2` and `84.9% ± 3.7` of those
MATCHes from the seat it
is asked to play, and the baseline wins `15.6% ± 3.7` and `14.6% ± 3.6` of the reversed arms.

What it is worth being honest about: a **fixed rule** — aim L3 before L4, commit to the CAGES with 6 s left —
also beats the shipped baseline, by `+12.9 ± 2.4` and `+8.1 ± 3.3` on the two bases. Against that rule the
planner reads `+8.3 ± 1.5` and `+8.8 ± 1.7` from blue, and read from the rule's own seat the reversed pairing is
`−7.2 ± 1.4` and `−7.9 ± 2.0`, so the rule loses from either side. The nulls decide what those numbers mean, and
this round they are small: the fixed rule against itself
reads `−1.4 ± 1.5` and `+2.7 ± 2.0` in blue's favour and the planner against itself `+2.1 ± 1.5` and
`+1.2 ± 1.9` — neither `+8.3` nor `+8.8` sits inside a seeding effect. On the build this section last described
the reversed arm on the 9000 base was `+0.5` against a `+4.6` seat null, which is no such thing here. Against a table that has been told about the CORAL STATION queue too
(`fixed rule + spread`) the planner reads `+6.1 ± 1.7` and `+6.1 ± 2.0` from blue against a null of `−1.4 ± 1.5`
and `+1.7 ± 1.9`, and the told table read from its own seat is `−6.3 ± 1.7` and `−5.3 ± 2.3`. Last round this
section could claim the search was ahead of the best fixed rule from either seat on one base; on this geometry it
says that of both. What the planner is
ahead by, where it is ahead, is the arrival gates and the ALGAE route, not anything the search itself was given.
Against a field that does something the gap is bigger and does not depend on the seat: handed one pressing
machine, three stripping this REEF, or both at once, 48 MATCHes per arm on each base, the planner's own-side
margin is `44.8 / 22.4 / 50.7` and `48.2 / 21.3 / 48.8` against the shipped baseline's `29.4 / 12.5 / 33.1` and
`28.2 / 10.9 / 30.3`, the fixed rule's `34.0 / 23.3 / 42.8` and `32.1 / 24.6 / 37.2`, and the queue-told table's
`28.8 / 14.2 / 30.0` and `33.6 / 13.6 / 33.5` — ahead of the baseline and of the told table in all six, winning
82-97% of those MATCHes, but *behind* the fixed rule in the two arms where the opponent only strips
(`22.4` against `23.3`, then `21.3` against `24.6`), which is the one column on this page where the searched plan
is not on top. `npm run adaptive` does
**not** separate the re-plan from the rest of the search: on seed base 31000 at n=48 an arm, planner against the
fixed rule reads `+8.3 ± 1.8` from one seat and `+5.9 ± 1.2` from the other at ±0% tempo spread, then
`+7.9 ± 3.2` and `+5.1 ± 3.6` at ±40%, then `+5.5 ± 4.3` and `−1.8 ± 3.7` at ±60%. The ±0% arm is the control: at
±0% there is nothing to react to, so that `+8.3` is the other search dimensions and not the re-plan — and the
jittered arms straddle it, one seat above at ±40% and both inside their bars by ±60%, which is this round saying
the jitter is still not shown to be worth anything the search could not already get. What the planner does with
the jitter the fixed rule cannot see is
change its mind: all 16 plan reads commit at 6 s at ±0%, fourteen at ±40% with two at 4 s, and at ±60% twelve at 6 s
with 4 s twice, 8 s once and 20 s once. What the planner adds
is that the answer is derived from what the MATCH left on the REEF rather than assumed, and `npm run verify`'s
guard 20 holds that on held-out seeds (51000+): `+14.5` over the baseline (`11.3 ± 4.4` from blue,
`17.8 ± 6.2` from red), `+7.7` over the fixed rule, a commit of ≤8 s in 16/16 MATCHes with 16/16 re-planned
away from their opening plan.

The order of work matters here, because it is the opposite of the one that was tempting. `npm run headroom`
ran the knobs through the tick engine first: the commit window is worth `+13.3 ± 1.0` and `+12.7 ± 1.0`
(6 s against the shipped 20 s, with `+8.3 ± 0.5` / `+7.9 ± 0.4` at 12 s, `+4.1 ± 0.3` / `+3.8 ± 0.4` at 16 s and
`−10.4 ± 0.5` / `−11.0 ± 0.5` at 30 s — a peak, not a slope), the level order has since flattened out
(`+3.8 ± 2.2` and `+1.0 ± 2.2` for working L3 before L4, where the same arm used to be the strongest argument in
this file, `−3.7 ± 2.2` / `−6.7 ± 2.4` for L2 before L4), down to `−24.7 ± 3.8` and `−29.3 ± 3.3` for working the
TROUGH first, rigid per-machine level bands cost `−2.8 ± 2.4` and `−6.0 ± 2.2` for one machine per level and
`−16.5 ± 2.4` and `−21.3 ± 1.7` for two pushing up while one works low, and refusing to touch ALGAE at all costs
`−34.7 ± 3.0` and `−36.6 ± 2.1` — which is the ALGAE column, priced in the CORAL it displaces (that arm places
17.5 and 17.2 in the L1 ring against the shipped 5.0 and 5.4, and scores 0.0/0.0 PROC/NET against 4.7/8.3 and
4.7/8.2). Half of what that column used to be worth went with the NET reach: a ring lifted into the NET is a
ring that does not need a runner. The seconds the ALGAE column now buys are six stops instead of three, because
each of the six REEF faces carries one ring rather than two faces carrying two. What the
study said about cycle *rate* — the REEF's 36 branch slots are all but full (11.8/12.0/11.7 on the three BRANCH
rows on one seed base, 11.9/12.0/11.8 on the other) and only 5.0 / 5.4 of the 24-piece TROUGH, so no
**allocation of pieces** can outwork
the fleet — was right, and it was overread as "tempo is worth nothing".
A planner built to sort pieces would have been searching an empty column; the seconds turned out to be worth
something where they are spent standing at a STATION, which is the one thing no piece allocation touches.

`npm run fastsim` is then the gate on the analytic model, and it failed the first three times. Two of the
failures were the model being wrong about mechanisms rather than about constants:

- It scored an ALGAE column of **0** while the engine was filling both bins. The model only stripped ALGAE once
  the REEF
  was empty, but the REEF never empties; the baseline actually strips on a bid of *distance to the piece per
  point of value*, and a robot standing at a branch is a foot from an ALGAE and ninety from a STATION. Bidding
  the delivery leg instead of the reach leg made the model blind to the mechanism. The
  column has since split in two, and the split is the model's remaining error: it prints ALGAE **9** where the
  engine banks **4.7** processed and **8.3** in the NET on one seed base (**4.7** and **8.2** on the other), so
  its total reads **237.0** against the **263.2** and **264.4** the engine plays out; its CORAL column is the
  fitted one (**40.0** against **40.0**, and **41.0** against **41.0** on the second base). What is used for the search is the ordering, and that is what
  the agreement line below is measuring.
- It applied the fitted traffic factor (`efficiency`, fit at **1.613** and **1.607** on the two seed bases this
  round) to the
  drive to a CAGE. That factor is a fit for
  the queue three machines form at one CORAL STATION corner; the BARGE side has no queue. With the factor
  applied, a 6 s commit cost the model all 36 of its CAGE points and gave the biggest lever in the game the
  wrong sign. The engine's real tail was measured instead of estimated: over 12 MATCHes at a 6 s window the
  fleet asked at `t = 144.1` (max 144.7) and was on the pipe `4.86 s` later (max 5.80), finishing with
  1.92 DEEP, 1.00 SHALLOW and 0.08 PARK — against 2.00, 1.00 and 0.00 at both a 12 s and a 20 s window.
  Interrupting a drive is free, so the model's cycle bound belongs at the start of a cycle, not the whistle.

After those two, the model ranks 10/10 of the plan pairs the engine can separate on the 9000 base and 10/11 on
the 21000 one (of 15 tried on each), and gets the commit window right in sign and short of it in size (`+10.0/+8.0`
predicted against `+13.3 ± 1.0 / +8.3 ± 0.5` measured on one seed base and `+12.7 ± 1.0 / +7.9 ± 0.4` on the
other). The
station-spread arm reads `+12.0` against `+19.8 ± 1.3` and `+17.6 ± 2.0`, and two arms per base sit more than
four points off — the 6 s L3-first and the station spread on both
bases (`+17.5 ± 2.3` and `+15.7 ± 2.2` against `+12.0`) — which `npm run fastsim` prints
as its own flagged line rather than leaving to be noticed in the prose. On the 21000 base it also prints an order
flip of its own: the engine puts the 6 s L4-first plan `4.9 ± 2.2` points under the station spread the model
ranks below it. That is why the guards price the
two levers off the engine's own arms rather than off this model. Three axes used to be outside its action space
and are now inside it, which changed what the planner is allowed to search.

**The level order.** The claim in this file for two rounds was that the model ranks the axis the wrong way
because it prices a cycle's PLACE time but not the circling a robot does to find a free slot at a filling
level. That mechanism was tested and is not in the engine: over 2,169 placements in 48 MATCHes (a one-off probe
on the build before the staging fix, not a committed arm — the per-level place time it reads is untouched by
where the rings sit) the time a
machine spends placing is flat in how full its level already is (L2 0.71 → 0.70 s from the first quartile of
occupancy to the last, L3 1.01 → 0.99, L4 1.23 → 1.27). What the model was missing was the per-level placement
time and drop rate, and once those went in the ranking came right on its own. The same comparison re-run after
the arrival gates has less to say, because the arm is small on one base and inside its own bar on both: L3 before
L4 now reads `+3.8 ± 2.2` on the
9000 base and `+1.0 ± 2.2` on the 21000 one, and `npm run fastsim` predicts `+0.0` at the shipped 20 s window and
`+12.0` at a 6 s one — the model still says the order is worth nothing with 20 s left, and the engine says a point
or four that neither base resolves at n=24. The bottom of the list still separates:
L2 before L4 is
`−3.7 ± 2.2` and `−6.7 ± 2.4`, working the TROUGH first `−24.7 ± 3.8` and `−29.3 ± 3.3`, one machine per level
`−2.8 ± 2.4` and `−6.0 ± 2.2`, two pushing up while one works low `−16.5 ± 2.4` and `−21.3 ± 1.7`.
The order is not searched, though: `MEASURED_ORDER` in `web/js/ai.js` pins it to L3-before-L4 — the measured top
of the list on the build that found it — so the planner answers L3-first on 24/24 seeds of both bases. The lift
re-argued that pin once and the arrival gates re-argued it again. Two readings that sit inside each other's
error bar is what an unmeasurable axis
looks like. The pin stays because flipping it re-baselines every fingerprint in `scripts/invariants.mjs` for at
most a few points, which is a decision about measurement cost rather than a finding.

**Per-machine ALGAE duty.** One queue for three machines cannot show that taking one out of it helps the other
two, and for a while the model had nothing else to say about duty either: it drained the same nine rings
whichever slots were told to strip. What duty used to cost was the crossing — a machine that has run out of
rings on its own REEF reaches over to theirs, and the only way to their REEF is past their CAGEs, where G418
costs a MAJOR FOUL. With the trio carrying a NET reach the crossing mostly went away: the engine's own deny
counter says a duty machine crosses the centreline **0.13** times a MATCH for one machine on duty and **0.75**
for three, and the model's geometry says **0.30** and **0.90**. The model bills what is left the same two ways — `crossingSec`
takes the drive out and home off a duty machine's timeline from the field geometry, and `CROSS_FOUL_PTS = 3.0`
per ring carried home — and it knows a mirror: if both fleets were told to strip, every ring this one takes is a
ring the other takes back, so the ALGAE column does not grow, which is what the engine says (9.00 rings an
ALLIANCE with both fleets told to strip against 9.00 with neither). Guard 26 holds it all on held-out seeds: the
model's crossings above the engine's at one machine and at three and inside 0.45 of it at three, its foul charge
(2.7 points for the
trip) against the 38.0 the duty fleet really hands over, its ALGAE column within 0.6 rings of `PROC + what a
ROBOT lifted` (9.90 against 9.63), every duty arm ranked at or
below no-duty in a mirror (they are, by −0.9 / −1.8 / −2.7), and the mirror ALGAE column unmoved by the trip.
What the guard does NOT claim is a sign for the duty arms read one-sided, because a mirror is where the reading
is: the four one-sided margins this paragraph used to print came with no error bar, which is a spread, not a
result.

**The CORAL STATION queue.** The one tempo lever the inventory study left out is where the pieces are picked up.
Each ALLIANCE has two CORAL STATIONs, in the pockets where its WALL meets the guardrails, and the shipped bid
takes the nearest one whoever is standing there: the engine's own counter — which reads the tick the pick starts
on, not the 0.2 s frame — books `27.5%` of a fleet's `58.7` CORAL picks a MATCH as beginning with a teammate
already bound for the same corner. `policy.js` prices each teammate on the corner as so many seconds of *this
machine's* drive (`stationSpread`, so a fast ROBOT will walk farther off the queue than a slow one) and takes
the other pocket when the walk is shorter than the wait; the greedy baseline ships at 0 and the planner's table
pays 0.91 s. Pricing
the crowd does thin it: `15.1%`.

What the crowd costs, though, turned out not to survive the lift. The number this lever shipped on was the time
between two picks by the same machine — `7.29 ± 0.21` s when the later one began contested against
`6.27 ± 0.10` s when it began alone — and on the shipped profiles that difference has gone the other way:
`4.34 ± 0.18` s contested against `6.83 ± 0.11` s alone (n=257 against 2,703 over 24 mirror seeds; that pair was
read before this round's arrival gates, has not been re-run since the staging fix, and is a one-off probe rather
than a committed arm). It was
always a confound rather than a wait: a machine that rejoins the corner its fleet never left has a short drive,
which is what the negative now reads. So the per-cycle credit is priced off the MATCH instead, on the arm the
planner actually decides against — one side spreading, the other playing the shipped bid, 24 paired held-out
seeds — and the engine gives it `+3.3 ± 2.0` own points, `−2.2 ± 3.3` of margin when BOTH fleets are told to
spread; `npm run measure`'s greedy arm, where the option is switched off rather than told, reads `+3.4 ± 1.4` of
its own and `+2.1 ± 1.1` off the opponent over 48 paired — which clears its bar, unlike the mirror, and is the
one of the two readings that says the wait is real. `fastsim.js` credits `0.15` s of every CORAL cycle, per cycle rather than as a bonus, so a MATCH with
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
6 s commit on all 24 plan reads of each base (the level order is pinned rather than chosen, as above). The
queue is the axis where the search goes somewhere the table did not: the spread is on in 19 of 24 plan reads on the
9000 base and 17 of 24 on the 21000 one this round, against the 23 and 24 it printed last round and the 20 and 18
before that, which is what it means
for the answer to be derived rather than assumed. A pick that now requires the machine to be at the piece makes
two cars at one corner cost a whole wasted trip rather than a shorter one. Against an opponent with an agenda it takes ALGAE duty
in 2-3 of 24 MATCHes per block and declines it in the other 21-22, and it spreads on 18-21 of 24 depending on the
arm — which is what a priced crossing looks like when the option is worth taking occasionally rather than a
switch that is never thrown.

`npm run strength` also runs arms against a field that does something — one machine pressing, three stripping
this REEF, both at once — with four policies in the seat: the planner, the best fixed rule, that rule told about
the queue (`fixed rule + spread`), and the shipped baseline. Own-side margin over 48 MATCHes per arm, the two
seed bases: the planner beats the baseline in all six (`44.8 / 22.4 / 50.7` and `48.2 / 21.3 / 48.8` against
`29.4 / 12.5 / 33.1` and `28.2 / 10.9 / 30.3`) and the told table in all six (against `28.8 / 14.2 / 30.0` and
`33.6 / 13.6 / 33.5`), and it loses to the plain fixed rule in the two arms where nothing is pressing
(`22.4` against `23.3` on the 9000 base, `21.3` against `24.6` on the 21000) — the only column in this file where
a searched plan sits second. The arm where the opponent only strips is the one that separates the baseline from
everything else: it wins `74.0% ± 4.5` and `67.7% ± 4.7` of those MATCHes while its own side is only `12.5` and
`10.9` points ahead, the smallest of the four in both. What the spread is worth to a fleet that is only told to
take it is `+6.4 ± 1.6` and `+1.0 ± 1.7` blue-side points at 0.45 s in `npm run headroom`, `+5.2 ± 1.4` and
`+3.3 ± 1.9` at 0.91 s, `+6.6 ± 1.8` and `−1.0 ± 2.7` at 1.6 s — positive on both bases at the two narrower
settings and inside its own bar at the widest — while `npm run measure`'s greedy arm, paired over 48 MATCHes on
both bases, reads `+3.8 ± 1.0` of its own total and `−2.0 ± 1.3` off the opponent. The planner takes it on 17 or 19
of its 24 MATCHes depending on the seed base anyway,
because it dedups pieces and prices
the crossing at the same time, and a fixed rule that spends its cycles avoiding each other is not converting that
into a win against an opponent who is pressing or stripping.

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
in the arms where something actually breaks the fleet, and barely at all: against one pressing machine
`0.04` re-solves a MATCH on the 9000 base and `0.00` on the 21000 one, against a fleet that only strips `0.00` on
both, and against a fleet that presses and strips `0.04` and `0.00` — the strip is the control, because
taking ALGAE does not take a machine out. The press does disable things, just not often: with one seat forced to
defend, `npm run measure` reads `20.7 s` a MATCH spent in the ring worth `−33.63 ± 3.12` of margin (so `−1.626` a
press-second) and `npm run contact` 7.7 fouls a MATCH for 45.8 points on one base and 6.1 for 36.6 on the other,
of which the whole §7.4.4 trio is 4 calls over the 48-MATCH sample — no DISABLED time and no
DISQUALIFICATION at the shipped severity floors and the 4% impairment cap. That is how rarely the re-solve has a
reason to fire. Where the press is aimed hard on
purpose — the fouls guard, one
fleet parked and one driving at the nearest car with the damage floor dropped — it takes 3 ROBOTs out for the
MATCH.

### The clock, the hopper and the teammate

Five of the planner's rules are not plan fields the model searches but budget rules it pins. All of them live in
`policy.js` with off values, and `ai.js` hands them in at construction, so a caller can still run the control
arm through its options. They were found the same way the commit window was: read the failure off the frames
first, then price the fix. The fourth one is the press, and it is in the defence section above, because its
price is the part of it that measurement does not support; the fifth is `autoCrowdSec`, which only fires inside
AUTO and is the one the measurement retired — pinned at 0, because paying the old 1.5 s buys `0.06 ± 0.08` AUTO
CORAL for `0.08 ± 0.15` STATION picks and `0.00 ± 0.00` of LEAVE across 144 alliance-sides (see the AUTO paragraph
above).

- **A cycle has to fit the clock** (`cycleCutoffSec: 4`). What the fleet still holds at the whistle is the
  failure: `npm run verify`'s time-sense guard reads the planner holding **0.83** CORAL an ALLIANCE at the horn
  with the gate off against **0.10** with it on, and prices that at **12.7 ± 3.9** combined points a MATCH. Refusing a
  fetch whose round trip (drive to the source, take, drive back to the REEF face, place) does not fit with 4 s to
  spare is the same straight-line budget the AUTO routine runs. The gate is a maximum rather than a guess, and the
  arm on the far side of the peak says so: an 8 s cutoff holds **0.04** and drops **0.02** an ALLIANCE and costs
  **−5.3 ± 1.4** — past the peak the machines are not saving a
  wasted trip, they are standing still.
- **The hopper gets spent before the CAGE** (`spendBeforeClimb`). The engine drops whatever a ROBOT is holding
  when it hangs, so a machine that goes to a pipe with a load trades 3-5 points for nothing. The guard's baseline
  fleet, which has no such rule, drops **1.71** CORAL an ALLIANCE that way and the rule takes it to **0.00** for
  **6.5 ± 0.5** combined points a MATCH. The rule spends first only when
  the clock left covers BOTH legs, which is what stops it buying a CORAL with the BARGE column.
- **A piece a teammate is bound for is not chased** (`pieceSpread: 1.82`). Filtering the frames to the two
  intents that TAKE something, two allies are aimed within 24 in of each other for **2.4 s** of a MATCH on the
  arm that does not price it, and **0.6 s** on the one that does; on the guard's 24 held-out paired seeds, which
  the value was not chosen on, the claim is worth **13.3 ± 4.2** points. The graded value is kept so a
  machine beside an empty REEF still takes the only piece left.

`npm run measure` prices the pins at `+8.88` combined points a MATCH over 48 paired seeds against the same
planner with all of them disabled, and the columns say where they come from: CORAL `+3.13`, ALGAE `−1.04`, BARGE
`+0.92` (with `+0.08` DEEP, `+0.02` SHALLOW and `−0.10` PARK), AUTO CORAL `+0.00` and LEAVE `+0.00`. Nothing reaches
AUTO any more, and that is the `autoCrowdSec: 0` pin doing exactly what its measurement said: the lever that used
to be the only one of the five to touch the period is the one that was retired. The
same arm read `+18.33` on the #122 geometry, `+17.31` when the only thing that had moved was the mesh and
`+17.79` before that, and the ALGAE column has been `+0.83` → `+0.21` → `+2.58` → `+0.58` → `−1.04` across those
readings while the CORAL one went `+7.23` → `+8.79` → `+10.67` → `+8.79` → `+3.13`. This round does not say why
either column moved the way it did; it says the pins are worth `+8.88` where the geometry before #124 printed
`+12.71`. Two of them are worth more
to the baseline than to the planner — the baseline
commits to the CAGES with 20 s left and so carries a load into a climb twice as often, and it does not dedup
pieces at all — and the baseline keeps them off for the reason the level order gives: it is the yardstick, and a
yardstick that improves underneath the
planner re-baselines every fingerprint in `scripts/invariants.mjs`. `npm run verify`'s time-sense guard checks
each rule binds, keeps its score through its own mechanism rather than some other one, pays on held-out seeds,
and that all four off values reproduce the shipped MATCH point for point. One honest dilution note: the pins show
up in the planner's own score, `285.9` and `287.5` in the mirror against the baseline's `266.2` and `268.9`, and
the margin over a baseline that is *also* given the late pieces moves less than the score does — which is why
every arm here is quoted against the fixed baseline the guards pin, not against a moving one.

Also open: the exact station and processor insets (the field drawings, not the rule text), the
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
