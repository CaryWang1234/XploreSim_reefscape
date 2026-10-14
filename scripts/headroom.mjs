// Is there anything a planner could win here? Each arm is the SAME trio on the SAME seeds with ONE
// allocation rule changed, so a difference is the rule rather than the machine. Paired on two seed bases
// because one base has already proved it can read an effect as noise.
//
// Run: npm run headroom
//
// This block is the gate in front of Stage 2: the REEF is a stock that the shipped tempo drains every
// MATCH, so the headroom a search could exploit is in WHICH branch and WHEN, not in cycle rate. If no arm
// here separates from the shipped rule, a planner would only be reproducing greedy at compute cost, and
// that is the finding.

import { playMatch } from '../web/js/league.js';

const N = 24;
const BASES = [9000, 21000];
const L3FIRST = ['L3', 'L4', 'L2', 'L1'];
const ARMS = [
  ['shipped: L4 first, 20 s endgame', {}],
  ['L3 first', { placeOrder: L3FIRST }],
  ['L2 first', { placeOrder: ['L2', 'L3', 'L4', 'L1'] }],
  ['trough first', { placeOrder: ['L1', 'L2', 'L3', 'L4'] }],
  ['bands: one machine per level', { bands: [['L4'], ['L3', 'L2', 'L1'], ['L2', 'L1', 'L3']] }],
  ['bands: two push up, one works low', { bands: [['L4'], ['L4', 'L3'], ['L2', 'L1', 'L3']] }],
  ['endgame at 6 s', { climbWindowSec: 6 }],
  ['endgame at 12 s', { climbWindowSec: 12 }],
  ['endgame at 16 s', { climbWindowSec: 16 }],
  ['endgame at 30 s', { climbWindowSec: 30 }],
  ['endgame 12 s + L3 first', { climbWindowSec: 12, placeOrder: L3FIRST }],
  ['endgame 6 s + L3 first', { climbWindowSec: 6, placeOrder: L3FIRST }],
  ['no ALGAE work at all', { noAlgae: true }],
  ['no ALGAE + endgame 12 s', { noAlgae: true, climbWindowSec: 12 }],
  // The two CORAL STATIONS are in the pockets at either end of the ALLIANCE WALL and the shipped bid sends all
  // three machines to the nearer one. Pricing a teammate already bound for it at what the queue costs (0.91 s
  // of drive) is the ablation's opposite: `stationSpread: 0` is what every other arm in this table runs on.
  ['station spread 0.45 s', { stationSpread: 0.45 }],
  ['station spread 0.91 s', { stationSpread: 0.91 }],
  ['station spread 1.6 s', { stationSpread: 1.6 }],
  ['station spread 0.91 s + endgame 6 s + L3 first', { stationSpread: 0.91, climbWindowSec: 6, placeOrder: L3FIRST }],
];

const one = (seed, opts) => playMatch({ seed, bluePolicyOpts: opts, redPolicyOpts: opts }).final.blue;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const se = (a) => {
  const mu = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1) / a.length);
};

for (const base of BASES) {
  // The shipped arm is run once per seed and reused: every other arm is measured against those same
  // MATCHes, so a difference is the rule and not the draw.
  const shipped = [];
  for (let i = 0; i < N; i++) shipped.push(one(base + i * 977, {}));
  console.log(`\nseed base ${base}, n=${N} mirror MATCHes (generic trio, blue side read)`);
  for (const [name, opts] of ARMS) {
    const arm = [];
    const d = [];
    for (let i = 0; i < N; i++) {
      const f = name.startsWith('shipped') ? shipped[i] : one(base + i * 977, opts);
      arm.push(f);
      d.push(f.total - shipped[i].total);
    }
    const mu = mean(d);
    const differ = d.filter((x) => x !== 0).length;
    const mixMean = ['L4', 'L3', 'L2', 'L1']
      .map((lv) => mean(arm.map((f) => f.coral[lv].auto + f.coral[lv].tele)).toFixed(1))
      .join('/');
    const proc = mean(arm.map((f) => f.algae.processor)).toFixed(1);
    const net = mean(arm.map((f) => f.algae.net)).toFixed(1);
    const barge = mean(arm.map((f) => f.bargePoints)).toFixed(1);
    const rp = mean(arm.map((f) => f.rp.total)).toFixed(2);
    console.log(
      `${name.padEnd(34)} mean ${(mean(arm.map((f) => f.total))).toFixed(1).padStart(6)} · vs shipped ${(mu >= 0 ? '+' : '') + mu.toFixed(1)} ± ${se(d).toFixed(1)} (${differ}/${N} differ)` +
        ` · L4/L3/L2/L1 ${mixMean} · proc/net ${proc}/${net} · BARGE ${barge} · RP ${rp}`
    );
  }
}
