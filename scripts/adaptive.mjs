// Does planning beat the best fixed rule when the MATCH is not the median one?
// A fixed 6 s commit is tuned to this field's average pace; jitter makes each machine's pace a per-MATCH
// draw, which is exactly what the planner measures and a fixed rule cannot know.
import { evaluate, playMatch } from '../web/js/league.js';

const FIXED = { placeOrder: ['L3', 'L4', 'L2', 'L1'], climbWindowSec: 6 };
const N = 48;

for (const jit of [0.0, 0.4, 0.6]) {
  const arms = [['ai', 'greedy', {}, FIXED], ['greedy', 'ai', FIXED, {}]];
  const out = [];
  for (const [bn, rn, bOpts, rOpts] of arms) {
    const e = evaluate({ blueKind: bn, redKind: rn, matches: N, seedBase: 31000, bluePolicyOpts: bOpts, redPolicyOpts: rOpts, scenarioOverride: { tempoJitter: jit } });
    // report every margin as planner-minus-fixed so the two seat orders are directly comparable
    const m = bn === 'ai' ? e.avgBlue - e.avgRed : e.avgRed - e.avgBlue;
    out.push(`${bn === 'ai' ? 'planner blue' : 'planner red '} ${m >= 0 ? '+' : ''}${m.toFixed(1)} ± ${e.marginSe.toFixed(1)}`);
  }
  const windows = new Map();
  for (let i = 0; i < 16; i++) {
    const w = playMatch({ blueKind: 'ai', redKind: 'greedy', seed: 31000 + i * 977, scenarioOverride: { tempoJitter: jit }, redPolicyOpts: FIXED }).policies.blue.plan.climbWindowSec;
    windows.set(w, (windows.get(w) ?? 0) + 1);
  }
  console.log(`jitter ${jit.toFixed(1)}: ${out.join(' | ')} · windows chosen ${[...windows.entries()].map(([w, c]) => `${w}s:${c}`).join(' ')}`);
}
