// What the second YELLOW CARD costs the machine that earns it.

// §6.6.2 is the one place in the 2025 rulebook where a card has a consequence inside a single MATCH: "YELLOW
// CARDS are additive, meaning that a second YELLOW CARD is automatically converted to a RED CARD, including
// earning a second YELLOW CARD during a single MATCH", and a RED DISQUALIFIES the team, which §5 defines as
// inoperable for the rest of the MATCH. The 2026 build could not put a price on its own version of that rule
// (there the second card is a tournament-phase matter); here the ladder is inside the engine and switched on,
// which means the page has been asserting a deterrent nobody measured.

// This prices it. Same seeds, same fleets, same policies, `cardLadder` on and off, and the difference read as
// a paired statistic because two copies of one MATCH differ by far less than two different MATCHes. Two arms,
// because a fleet that never meets another commits no cards: the shipped mirror is the control (0 warnings,
// so the ladder cannot fire and the two arms must print the same scores) and the forced defender is where the
// rule lives at all.

// It exits non-zero if the conversion never happens, because a rule that never fires is not a deterrent, it is
// a comment — and it prints how many robots a RED took out of their own alliance's score, which is the half
// the model does implement (§5's "inoperable", not the "0 MATCH points and 0 Ranking Points" half; see the note
// in `engine.js` about why the alliance ledger cannot attribute a still-scored CORAL back to a DQ'd team).

//   node scripts/cards.mjs                    MATCHES=48
//   MATCHES=96 node scripts/cards.mjs

import { FOULS } from '../web/js/rules.js';
import { playMatch, matchSeed } from '../web/js/league.js';

const MATCHES = Number(process.env.MATCHES || 48);
const BASE = Number(process.env.SEED_BASE || 9000);
const failures = [];

// Card tallies read off the event stream, because that is where the referee's call lives: `kind: 'foul'` with
// `card: 'YELLOW' | 'RED'`. What the ladder added is NOT readable inside one arm — the engine also issues a RED
// outright when a hit leaves the victim unable to drive, and such a call can land on a machine that already
// has a warning — so the price is read as the difference in RED between the two arms on the same seeds.
// `clean` is the subset that cannot be the ladder: a RED on a ROBOT with no warning yet.
function cards(m) {
  const warned = new Map();
  let yellow = 0, red = 0, clean = 0;
  for (const ev of m.events || []) {
    if (ev.kind !== 'foul' || !ev.card) continue;
    const k = `${ev.side}:${ev.slot}`;
    if (ev.card === 'YELLOW') {
      yellow += 1;
      warned.set(k, (warned.get(k) || 0) + 1);
    } else {
      red += 1;
      if (!warned.get(k)) clean += 1;
    }
  }
  const disabled = ['blue', 'red'].map((s) => m.final[s].robots.filter((r) => r.disabled).length).reduce((a, b) => a + b, 0);
  return { yellow, red, clean, disabled };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sem = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length);
};

// `defendSlots` is how `measure.mjs` and `strength.mjs` put a press on the FIELD: the greedy policy takes the
// named slot's opponent as its shadow instead of scoring. `press` is the seconds of ring it holds, read back
// off the engine's own per-ROBOT column so the price can be quoted per press-second as well as per MATCH.
//
// The last two arms raise `contactImpairP`, which is the draw deciding whether a hit actually damaged
// something — and a card only rides on a damage call (G423/G424 are the two clauses in §7.4 that carry one).
// That is NOT a calibration claim: the shipped probability is what `npm run contact` places against the real
// 2025 rate of 0-2 fouls a MATCH, and these arms deliberately push it aside to reach a state the rule cares
// about. They are here because the first version of this file measured the ladder at shipped calibration and
// found nothing to price: 144 MATCHes, 11 warnings, and no ROBOT ever earned a second one.
const ARMS = [
  { name: 'shipped mirror (no defender)', opts: {} },
  { name: 'one defender (blue slot 3)', opts: { bluePolicyOpts: { defendSlots: [2] } } },
  { name: 'two defenders', opts: { bluePolicyOpts: { defendSlots: [1, 2] } } },
  { name: 'one defender, every hard hit damages', opts: { bluePolicyOpts: { defendSlots: [2] } }, over: { contactImpairP: 0.5 } },
  { name: 'two defenders, every hard hit damages', opts: { bluePolicyOpts: { defendSlots: [1, 2] } }, over: { contactImpairP: 0.5 } },
];

console.log(`${MATCHES} paired MATCHes from seed base ${BASE}, both arms on the same seeds. A RED takes its own machine out of the rest of the MATCH; the alliance keeps the points that machine already banked, which is the half this build models.`);

const reach = [];

for (const arm of ARMS) {
  const forced = !!arm.over;
  const on = { tally: [], own: [], margin: [], press: [], c: { yellow: 0, red: 0, clean: 0, disabled: 0 }, carded: 0 };
  const off = { tally: [], own: [], margin: [], press: [], c: { yellow: 0, red: 0, clean: 0, disabled: 0 }, carded: 0 };
  for (const [label, bag, ladder] of [['on', on, true], ['off', off, false]]) {
    for (let i = 0; i < MATCHES; i++) {
      const seed = matchSeed(BASE, i);
      const m = playMatch({
        seed,
        blueKind: 'greedy',
        redKind: 'greedy',
        scenarioOverride: { cardLadder: ladder, ...(arm.over || {}) },
        ...arm.opts,
      });
      const c = cards(m);
      for (const k of ['yellow', 'red', 'clean', 'disabled']) bag.c[k] += c[k];
      if (c.yellow || c.red) bag.carded += 1;
      const blue = m.final.blue.total;
      const redTotal = m.final.red.total;
      bag.own.push(blue); // the defending seat, so its own score is the one paying for a disabled machine
      bag.margin.push(blue - redTotal);
      bag.tally.push(blue + redTotal);
      bag.press.push(m.final.blue.robots.reduce((s, r) => s + r.defend, 0));
    }
  }
  const dOwn = on.own.map((v, i) => v - off.own[i]);
  const dMargin = on.margin.map((v, i) => v - off.margin[i]);
  const dTotal = on.tally.map((v, i) => v - off.tally[i]);
  const differ = on.own.filter((v, i) => v !== off.own[i]).length;
  console.log(`\n── ${arm.name}`);
  // `clean` is the subset of REDs that cannot be the ladder's doing: booked on a ROBOT with no warning yet,
  // which is the engine's outright call when a hit leaves the opponent unable to drive. A RED on a machine
  // that already had a warning is ambiguous — it can be either path — so the switch is isolated by the
  // difference between the two arms, on the same seeds, printed under both.
  console.log(
    `   ladder on : ${on.c.yellow} YELLOW, ${on.c.red} RED (${on.c.clean} of them outright calls on a machine with no warning yet), ${on.c.disabled} ROBOTs DISABLED over the run · ${on.carded}/${MATCHES} MATCHes carded · press ${mean(on.press).toFixed(1)} s/MATCH`,
  );
  console.log(
    `   ladder off: ${off.c.yellow} YELLOW, ${off.c.red} RED (${off.c.clean} outright), ${off.c.disabled} DISABLED · ${off.carded}/${MATCHES} MATCHes carded · press ${mean(off.press).toFixed(1)} s/MATCH`,
  );
  console.log(
    `   defender's own score ${mean(on.own).toFixed(1)} against ${mean(off.own).toFixed(1)} without the ladder = ${mean(dOwn) >= 0 ? '+' : ''}${mean(dOwn).toFixed(2)} ± ${sem(dOwn).toFixed(2)} (${differ}/${MATCHES} MATCHes score differently)`,
  );
  console.log(
    `   MATCH margin ${mean(dMargin) >= 0 ? '+' : ''}${mean(dMargin).toFixed(2)} ± ${sem(dMargin).toFixed(2)}, MATCH total ${mean(dTotal) >= 0 ? '+' : ''}${mean(dTotal).toFixed(2)} ± ${sem(dTotal).toFixed(2)}`,
  );

  const ladderReds = on.c.red - off.c.red;
  console.log(`   REDs the ladder added: ${ladderReds} (the off arm keeps ${off.c.clean} outright calls, which the switch must not touch)`);
  reach.push({ name: arm.name, forced, yellow: on.c.yellow, ladderReds, differ });

  // Teeth, arm by arm.
  if (forced) {
    // The mechanism must be reachable when it is asked for, and it must cost something when it fires. Both of
    // these were written after the first run of this file returned 0 conversions in 144 MATCHes at shipped
    // calibration — which is a fact about the 4% impairment cap, not permission to leave the ladder unproven.
    if (ladderReds < 1) {
      failures.push(`${arm.name}: the ladder turned ${on.c.yellow} warnings into ${ladderReds} extra RED over ${MATCHES} MATCHes — with the probability raised this far it is still unreachable, so the rule is dead code`);
    }
    if (ladderReds > 0 && differ === 0) {
      failures.push(`${arm.name}: ${ladderReds} machines were taken out of the MATCH and not one score changed — DISABLED is not reaching the motion code`);
    }
  } else {
    // The two controls. Two greedy fleets that never meet may card nothing with a consequence, and where a
    // defender does earn a card at shipped calibration, the ladder still has to be the only thing that turned
    // it into a RED.
    if (arm.name.startsWith('shipped') && (on.c.red > 0 || differ > 0)) {
      failures.push(`the shipped mirror produced ${on.c.red} RED and ${differ} score differences across ${MATCHES} MATCHes — the whole README is measured on this arm, and a card would be inside every number in it`);
    }
  }
  if (off.c.red > on.c.red) {
    failures.push(`${arm.name}: the OFF arm booked more REDs (${off.c.red}) than the ON arm (${on.c.red}) — the switch is inverted somewhere`);
  }
  if (on.c.disabled < ladderReds) {
    failures.push(`${arm.name}: ${ladderReds} REDs were booked and only ${on.c.disabled} ROBOTs ended DISABLED — a DISQUALIFICATION is not taking the machine out`);
  }
}

const shipped = reach.filter((r) => !r.forced);
const forcedArms = reach.filter((r) => r.forced);
console.log(
  `\nreachability, the headline this file was written to find: at shipped calibration ${shipped.reduce((s, r) => s + r.yellow, 0)} warnings across ${shipped.length * MATCHES} MATCHes converted into ${shipped.reduce((s, r) => s + r.ladderReds, 0)} RED — no ROBOT earned a second warning in any arm, so §6.6.2's ladder prices at 0.00 and cannot be quoted as a deterrent on the shipped model. Ask for the damage call instead (the last two arms) and the same seeds produce ${forcedArms.reduce((s, r) => s + r.yellow, 0)} warnings and ${forcedArms.reduce((s, r) => s + r.ladderReds, 0)} conversions, which is what the switch is wired into.`,
);

// Fouls are worth what Table 6-3 says they are, so a press that donates them is priced with that number and
// not with a feeling: a MAJOR is 6 points to the opponent, and the cards here only arrive on MAJOR calls.
console.log(`\nfor scale: a MINOR FOUL credits ${FOULS.minor} points and a MAJOR ${FOULS.major} (Table 6-3), and a G423/G424 call — the only ones that carry a card — is a MAJOR, so the fouls a press donates are counted by \`npm run contact\` while this file counts the machine it loses.`);

if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK: the ladder is wired (it converts when a damage call lands twice, and the conversion costs the defending seat score), it is inert when nothing is carded, and at shipped calibration nothing is carded twice.');
