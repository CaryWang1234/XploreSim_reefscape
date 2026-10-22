// What a drivetrain is worth, measured rather than asserted.
//
// Run: npm run chassis
//
// The README's intro makes two claims that nothing committed could answer: that `swerve` is worth about twenty
// points a MATCH over `tank`, and that `mecanum` is within error of `swerve`. The only committed print of the
// first was an n=16 arm inside `npm run verify`, whose own comment says it exists to catch an unplumbed
// drivetrain rather than to price one — it carries no error bar, and an 8-point effect is below what 16 MATCHes
// resolve once the per-machine tempo spread is on. This is the same question with the statistics it deserves:
// n=24 paired mirror MATCHes on two seed bases, the margin each fleet runs against itself, and the head-to-head
// played in both seat orders. The seat order matters: this engine is not left-right symmetric, so a matchup that
// always puts one drivetrain on the same side reports that bias as a spec.
//
// Every arm is the same trio with one field changed, so a difference is the drivetrain and not the machine.

import { playMatch, matchSeed } from '../web/js/league.js';
import { SAMPLES, CHASSIS } from '../web/js/model.js';

const N = 24;
const BASES = [9000, 21000];
// Read off the model so a fourth drivetrain is priced the day it is added instead of never.
const KINDS = Object.keys(CHASSIS);

const trio = (chassis) => SAMPLES.map((p) => ({ ...p, chassis }));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const se = (a) => {
  const mu = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1) / a.length);
};
const f1 = (x) => x.toFixed(1);
const pm = (a) => `${f1(mean(a))} ± ${f1(se(a))}`;
const signed = (a) => `${mean(a) >= 0 ? '+' : ''}${pm(a)}`;

// One mirror MATCH of a single drivetrain: both ALLIANCES drive the same three cards on the same seed, so the
// alliance score is read twice per MATCH and the fleet's own number is their mean.
const mirror = (base, chassis) => {
  const profiles = trio(chassis);
  const blue = [];
  const red = [];
  for (let i = 0; i < N; i++) {
    const final = playMatch({ seed: matchSeed(base, i), blueProfiles: profiles, redProfiles: profiles }).final;
    blue.push(final.blue.total);
    red.push(final.red.total);
  }
  return { blue, red, both: blue.map((b, i) => (b + red[i]) / 2), margin: blue.map((b, i) => b - red[i]) };
};

const headToHead = (base, fastKind, slowKind) => {
  const fast = trio(fastKind);
  const slow = trio(slowKind);
  const asBlue = [];
  const asRed = [];
  for (let i = 0; i < N; i++) {
    const seed = matchSeed(base, i);
    // One MATCH per seating, not one per number read: a MATCH is a draw, and drawing it twice to read two
    // columns would make the two seatings look more independent than they are.
    const one = playMatch({ seed, blueProfiles: fast, redProfiles: slow }).final;
    asBlue.push(one.blue.total - one.red.total);
    const other = playMatch({ seed, blueProfiles: slow, redProfiles: fast }).final;
    asRed.push(other.blue.total - other.red.total);
  }
  // `asRed` is the blue side's margin when the other fleet holds blue, so negating it is the yard fleet's own
  // margin from the red side. The mean of the two seatings is the matchup; the half-difference is the field.
  const asRedNeg = asRed.map((v) => -v);
  return {
    asBlue,
    asRed,
    asRedNeg,
    rotated: asBlue.map((b, i) => (b + asRedNeg[i]) / 2),
    seat: asBlue.map((b, i) => (b - asRedNeg[i]) / 2),
  };
};

for (const base of BASES) {
  console.log(`\nseed base ${base} · n=${N} mirror MATCHes per drivetrain (generic trio, both ALLIANCES identical)`);
  const runs = {};
  for (const kind of KINDS) runs[kind] = mirror(base, kind);
  const yard = KINDS[0];
  for (const kind of KINDS) {
    const r = runs[kind];
    const paired = r.both.map((v, i) => v - runs[yard].both[i]);
    console.log(
      `  ${kind.padEnd(8)} blue ${pm(r.blue)}  red ${pm(r.red)}`
      + `  · against itself ${pm(r.margin)}`
      + `  · ${kind === yard ? 'the yardstick' : `vs ${yard} ${signed(paired)}`}`,
    );
  }
  // The matchup the page would otherwise quote from one seating: the same two fleets, both sides of the field.
  const other = KINDS.find((k) => k !== yard);
  const h = headToHead(base, yard, other);
  const both = runs[yard].both.map((v, i) => v - runs[other].both[i]);
  console.log(
    `  head-to-head ${yard} against ${other}: ${yard}'s margin is ${pm(h.asBlue)} from the blue side and `
    + `${pm(h.asRedNeg)} from the red side. Their mean, ${pm(h.rotated)}, is the matchup; their half-difference, `
    + `${pm(h.seat)}, is the field — so the same two fleets read ${f1(Math.abs(mean(h.asBlue) - mean(h.asRedNeg)))}`
    + ` pts apart depending on which side they were put on, and only the mean is a spec`,
  );
  console.log(
    `  the same gap as two mirrors on the same seeds: ${signed(both)} — the prose quotes this one, because it is`
    + ' paired and the seating cannot enter it',
  );
}

console.log(
  `\nEach base costs ${N} mirror MATCHes per drivetrain (${KINDS.length} fleets, both ALLIANCES identical, so each`
  + ` MATCH is scored twice) plus ${N} head-to-head MATCHes played in each of two seatings — about`
  + ' thirty-five seconds of this engine. The two bases are independent draws, so a claim has to hold on both'
  + ' to be a claim.',
);
