// Running MATCHes head-to-head, and the mirror discipline the REBUILT build learned the hard way.
//
// A mirror means the SAME three ROBOTs on both ALLIANCES. Comparing one trio against another is a ROBOT
// comparison wearing a strategy label: in REBUILT a "60-point seat asymmetry" turned out to be exactly
// that (59.8 points of it), so every number here is produced with an identical roster on both sides.
// Stage 3 adds real 2025 team profiles; until then there is one trio, and `ROSTERS` is where the second
// arrives.

import { simulateMatch } from './engine.js';
import { SAMPLES, defaultScenario } from './model.js';
import { BASELINES } from './policy.js';
import { aiPolicy } from './ai.js';

const trio = SAMPLES;
export const ROSTERS = [trio];

// The planner is registered here rather than in `BASELINES` because `ai.js` imports `greedyPolicy` from
// `policy.js` — wrapping the baseline is the point, and a module cannot import the registry it extends.
const POLICIES = { ...BASELINES, ai: aiPolicy };
export const POLICY_KINDS = Object.keys(POLICIES);

export function makePolicy(kind, side, opts = {}) {
  const make = POLICIES[kind] || POLICIES.greedy;
  return make(side, opts);
}

export function playMatch({ blueKind = 'greedy', redKind = 'greedy', seed = 1, record = false, scenarioOverride = {}, rosterIdx = 0, blueProfiles, redProfiles, bluePolicyOpts = {}, redPolicyOpts = {} } = {}) {
  const trio = ROSTERS[rosterIdx % ROSTERS.length];
  const profiles = { blue: blueProfiles || trio, red: redProfiles || trio };
  const scenario = { ...defaultScenario(), ...scenarioOverride, seed };
  const bluePolicy = makePolicy(blueKind, 'blue', { seed: seed * 31 + 7, ...bluePolicyOpts });
  const redPolicy = makePolicy(redKind, 'red', { seed: seed * 17 + 11, ...redPolicyOpts });
  const r = simulateMatch({
    blueProfiles: profiles.blue,
    redProfiles: profiles.red,
    bluePolicy,
    redPolicy,
    scenario,
    record,
  });
  // The policies come back with the MATCH because the planner's decisions are a result the page has to show:
  // what it planned, when it re-planned, and what it measured to plan on.
  return { ...r, policies: { blue: bluePolicy, red: redPolicy } };
}

export function evaluate({ blueKind = 'greedy', redKind = 'greedy', matches = 10, seedBase = 1000, profiles = null, scenarioOverride = {}, bluePolicyOpts = {}, redPolicyOpts = {} } = {}) {
  const totals = { blue: [], red: [], rpBlue: [], rpRed: [], margins: [] };
  let blueWins = 0;
  let ties = 0;
  for (let i = 0; i < matches; i++) {
    const r = playMatch({
      blueKind,
      redKind,
      seed: seedBase + i * 977,
      rosterIdx: i,
      scenarioOverride,
      bluePolicyOpts,
      redPolicyOpts,
      blueProfiles: profiles ? profiles.blue : null,
      redProfiles: profiles ? profiles.red : null,
    });
    const b = r.final.blue.total;
    const e = r.final.red.total;
    totals.blue.push(b);
    totals.red.push(e);
    totals.rpBlue.push(r.final.blue.rp.total);
    totals.rpRed.push(r.final.red.rp.total);
    totals.margins.push(b - e);
    if (b > e) blueWins += 1;
    else if (b === e) ties += 1;
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sem = (a) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length);
  };
  const p = (blueWins + 0.5 * ties) / matches;
  return {
    matches,
    blueKind,
    redKind,
    blueWins,
    ties,
    winRate: p,
    winSe: Math.sqrt((p * (1 - p)) / matches),
    avgBlue: mean(totals.blue),
    avgRed: mean(totals.red),
    blueSe: sem(totals.blue),
    redSe: sem(totals.red),
    avgRpBlue: mean(totals.rpBlue),
    avgRpRed: mean(totals.rpRed),
    avgMargin: mean(totals.margins),
    marginSe: sem(totals.margins),
  };
}

export { SAMPLES };
