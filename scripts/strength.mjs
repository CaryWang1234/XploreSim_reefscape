// Is the planner worth more than the best rule it could be replaced by?
//
// `npm run headroom` measured a fixed rule set that already beats the shipped baseline by +14.7±2.0 and
// +13.1±2.1 (L3 aimed first, commit at 6 s left). Shipping a "planner" that merely rediscovers that in a
// different way would be a relabelling, so the yardstick here is two-armed: the planner plays the SHIPPED
// baseline (does it capture the measured headroom at all) and the BEST FIXED RULE (does planning add anything
// to knowing the answer in advance). Both arms run mirror MATCHes — the same trio on both ALLIANCES — and
// each ordering is run separately, because a single ordering lets whatever seat bias survives the mirror show
// up as a strategy.
//
// Run: npm run strength          (n=96 paired seeds per arm, two seed bases)
//      npm run strength 24       (quicker pass while iterating)

import { playMatch, evaluate } from '../web/js/league.js';

const N = Number(process.argv[2] || 96);
const BASES = [9000, 21000];
const FIXED = { placeOrder: ['L3', 'L4', 'L2', 'L1'], climbWindowSec: 6 };
// The same table once the station spread is in it. Without this arm the yardstick is a rule set from before
// the lever was measured, and a planner that found the lever would look like it beat the table by knowing
// something the table could have known.
const SPREAD = 0.91; // seconds of drive a machine will pay to avoid a corner a teammate is bound for
const FIXED_SPREAD = { ...FIXED, stationSpread: SPREAD };

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const se = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length);
};

// How the planner actually behaved: the window it settled on and when it switched. Read off the policy
// object `playMatch` now hands back, not off the score, because a planner that always answered 6 s is a
// fixed rule and should be described as one.
function behaviour(base, n) {
  const windows = new Map();
  const spreads = new Map();
  const switches = [];
  const effs = [];
  for (let i = 0; i < n; i++) {
    const r = playMatch({ blueKind: 'ai', redKind: 'ai', seed: base + i * 977 });
    const p = r.policies.blue.plan;
    windows.set(p.climbWindowSec, (windows.get(p.climbWindowSec) ?? 0) + 1);
    spreads.set(p.spread ? 'on' : 'off', (spreads.get(p.spread ? 'on' : 'off') ?? 0) + 1);
    effs.push(p.efficiency);
    const sw = r.policies.blue.planLog.find((e) => e.switchTo);
    if (sw) switches.push(sw.t);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w}s:${c}`).join(' ');
  return `window ${top(windows)} · station spread ${[...spreads.entries()].map(([k, c]) => `${k}:${c}`).join(' ')} · switch t ${switches.length ? `${mean(switches).toFixed(0)}s (${switches.length}/${n} switched)` : 'never'} · measured eff ${mean(effs).toFixed(2)}`;
}

for (const base of BASES) {
  console.log(`\nseed base ${base}, n=${N} mirror MATCHes (generic trio both sides)`);
  const arms = [
    ['planner vs shipped baseline', 'ai', {}, 'greedy', {}],
    ['shipped baseline vs planner', 'greedy', {}, 'ai', {}],
    ['best fixed rule vs shipped', 'greedy', FIXED, 'greedy', {}],
    ['planner vs best fixed rule', 'ai', {}, 'greedy', FIXED],
    ['best fixed rule vs planner', 'greedy', FIXED, 'ai', {}],
    ['fixed rule against itself', 'greedy', FIXED, 'greedy', FIXED],
    ['planner vs table + spread', 'ai', {}, 'greedy', FIXED_SPREAD],
    ['table + spread vs planner', 'greedy', FIXED_SPREAD, 'ai', {}],
    ['table + spread against itself', 'greedy', FIXED_SPREAD, 'greedy', FIXED_SPREAD],
    ['planner against itself', 'ai', {}, 'ai', {}],
  ];
  for (const [name, blueKind, blueOpts, redKind, redOpts] of arms) {
    const r = evaluate({ blueKind, redKind, matches: N, seedBase: base, bluePolicyOpts: blueOpts, redPolicyOpts: redOpts });
    const mirror = blueKind === redKind && JSON.stringify(blueOpts) === JSON.stringify(redOpts) ? ' · symmetry check' : '';
    console.log(`  ${name.padEnd(30)} win ${(r.winRate * 100).toFixed(1)}% ± ${(r.winSe * 100).toFixed(1)} · margin ${(r.avgBlue - r.avgRed).toFixed(1)} ± ${r.marginSe.toFixed(1)} · ${r.avgBlue.toFixed(1)} vs ${r.avgRed.toFixed(1)}${mirror}`);
  }
  console.log(`  planner behaviour: ${behaviour(base, Math.min(N, 24))}`);
}

// The same two-armed yardstick against a field that does something.
//
// Against the shipped baseline the planner reproduces the best fixed rule to the point (`npm run strength`:
// +0.6 and −0.5 on the two bases), which is the honest way to say a search that finds the answer a table
// already knew is not yet earning its keep. The arms below are where an allocation layer would have to show
// work if it can show it anywhere: an opponent that presses, one that strips this REEF, and one that does both,
// because those are the three actions the tick policy gained and the shipped baseline never takes. Every arm is
// played from both seats and the planner is read against the best fixed rule on the SAME opponent, so a result
// that is really about which seat scores cannot be reported as a result about planning.
const ADV_N = Math.min(N, 48);
const ADVERSARIES = [
  ['one machine pressing', { defendSlots: [0] }],
  ['all three stripping this REEF', { algaeSlots: [0, 1, 2] }],
  ['pressing and stripping', { defendSlots: [0], algaeSlots: [1, 2] }],
];
const PLANS = [
  ['planner', 'ai', {}],
  ['best fixed rule', 'greedy', FIXED],
  ['fixed rule + spread', 'greedy', FIXED_SPREAD],
  ['shipped baseline', 'greedy', {}],
];

// What the planner DECIDED against this opponent, not just what it scored. An arm can be won by the commit
// window alone, and a score line cannot tell that apart from a planner that used the adversary's behaviour;
// the window/duty histogram can, and so can how often the capacity path fired.
function plannerBehaviour(base, advOpts, n) {
  const hist = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}:${c}`).join(' ');
  const windows = new Map();
  const duties = new Map();
  const spreads = new Map();
  let events = 0;
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const p = playMatch({ blueKind: 'ai', redKind: 'greedy', seed: base + i * 977, rosterIdx: i, redPolicyOpts: advOpts }).policies.blue;
    windows.set(p.plan.climbWindowSec, (windows.get(p.plan.climbWindowSec) ?? 0) + 1);
    const d = p.plan.algaeSlots ? p.plan.algaeSlots.join('+') : 'none';
    duties.set(d, (duties.get(d) ?? 0) + 1);
    spreads.set(p.plan.spread ? 'on' : 'off', (spreads.get(p.plan.spread ? 'on' : 'off') ?? 0) + 1);
    events += p.planLog.filter((e) => e.why === 'capacity').length;
    if (p.planLog.some((e) => e.switchTo)) moved += 1;
  }
  return `window ${hist(windows)} · ALGAE duty ${hist(duties)} · station spread ${hist(spreads)} · ${(events / n).toFixed(2)} capacity re-solves a MATCH · ${moved}/${n} moved off the opening plan`;
}

for (const base of BASES) {
  console.log(`\nseed base ${base}, n=${ADV_N} against an active field (the opponent is handed the action, this side is not)`);
  for (const [adv, advOpts] of ADVERSARIES) {
    const line = [];
    for (const [name, kind, opts] of PLANS) {
      const asBlue = evaluate({ blueKind: kind, redKind: 'greedy', matches: ADV_N, seedBase: base, bluePolicyOpts: opts, redPolicyOpts: advOpts });
      const asRed = evaluate({ blueKind: 'greedy', redKind: kind, matches: ADV_N, seedBase: base, bluePolicyOpts: advOpts, redPolicyOpts: opts });
      // `asRed.winRate` is the OPPONENT's rate from the blue seat, so this side's rate in that ordering is its
      // complement. Averaged without the flip the two seats cancel and every arm reads 50%, which is how a
      // field this side beats 100% of the time got reported as even.
      const win = (asBlue.winRate + (1 - asRed.winRate)) / 2;
      const winSe = Math.hypot(asBlue.winSe, asRed.winSe) / 2;
      const margin = ((asBlue.avgBlue - asBlue.avgRed) - (asRed.avgBlue - asRed.avgRed)) / 2;
      const oppScore = (asBlue.avgRed + asRed.avgBlue) / 2; // what the handed-action ALLIANCE itself makes, for scale
      line.push(`${name}: win ${(win * 100).toFixed(1)}% ± ${(winSe * 100).toFixed(1)} · own-side margin ${margin.toFixed(1)} · opponent ${oppScore.toFixed(0)}`);
      if (kind === 'ai') console.log(`  ${adv.padEnd(28)} ${name} decided: ${plannerBehaviour(base, advOpts, Math.min(ADV_N, 24))}`);
    }
    console.log(`  ${adv.padEnd(28)} ${line.join(' · ')}`);
  }
}
