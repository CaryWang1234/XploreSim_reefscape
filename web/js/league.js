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

// The seed stride is one definition because the page's batch button and `npm run measure` have to be
// measuring the same seed family; a different stride is a different set of MATCHes and the numbers are
// then not comparable even though both are called "48 MATCHes from seed base 51000".
export const SEED_STRIDE = 977;
export const matchSeed = (seedBase, i) => seedBase + i * SEED_STRIDE;

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sem = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length);
};

// Histogram bins are fixed edges, not per-batch quantiles, so two batches drawn on the same axis can be
// compared by eye. 100-400 covers the whole range this field has produced for a MATCH score; a margin past
// ±200 lands in the end bucket, and there has never been one.
const SCORE_LO = 100;
const SCORE_HI = 400;
const MARGIN_EDGE = 200;
const BIN = 20;

function histogram(values, lo, hi, bin = BIN) {
  const k = Math.round((hi - lo) / bin);
  const h = new Array(k).fill(0);
  for (const v of values) h[Math.max(0, Math.min(k - 1, Math.floor((v - lo) / bin)))] += 1;
  return h;
}

// Which MATCH sits at each end of a distribution, not just what value is there. A batch prints a best score,
// and the question a reader asks next is "which one was that, and what happened in it" — so the index travels
// with the value and the page can hand that MATCH back as a replay. First index wins a tie.
function extremes(values) {
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[hi]) hi = i;
    if (values[i] < values[lo]) lo = i;
  }
  return { best: values[hi], bestAt: hi, worst: values[lo], worstAt: lo };
}

// One batch's worth of statistics, from the finished MATCHES. `evaluate` runs this loop headless and the
// page runs it one MATCH at a time behind a progress bar, and both end here — so a headline number read
// off the website is the same computation `npm run measure` prints.
export function aggregate(records) {
  const blue = records.map((r) => r.final.blue.total);
  const red = records.map((r) => r.final.red.total);
  const margins = blue.map((b, i) => b - red[i]);
  const rpBlue = records.map((r) => r.final.blue.rp.total);
  const rpRed = records.map((r) => r.final.red.rp.total);
  const n = records.length;
  const blueWins = margins.filter((m) => m > 0).length;
  const redWins = margins.filter((m) => m < 0).length;
  const ties = margins.filter((m) => m === 0).length;
  const p = (blueWins + 0.5 * ties) / n;
  const eBlue = extremes(blue);
  const eRed = extremes(red);
  const eMargin = extremes(margins);
  const eTotal = extremes(blue.map((b, i) => b + red[i]));
  const share = (side, get) => records.reduce((s, r) => s + (get(r.final[side]) ? 1 : 0), 0) / n;
  const per = (side, get) => records.reduce((s, r) => s + get(r.final[side]), 0) / n;
  // Fouls are charged to a ROBOT, so a batch has to say which seat conceded them and under which clause:
  // "1.3 fouls a MATCH" is a geometry question, "100 of them G421" is a rule question.
  const byRobot = new Map();
  for (const r of records) {
    for (const side of ['blue', 'red']) {
      for (const rb of r.final[side].robots) {
        const k = `${side}:${rb.slot}`;
        const row = byRobot.get(k) || { side, slot: rb.slot, team: rb.team, name: rb.name, fouls: 0, codes: new Map() };
        const codes = rb.fouls || {};
        for (const [code, count] of Object.entries(codes)) {
          row.fouls += count;
          row.codes.set(code, (row.codes.get(code) || 0) + count);
        }
        byRobot.set(k, row);
      }
    }
  }
  return {
    matches: n,
    blueWins,
    redWins,
    ties,
    winRate: p,
    winSe: Math.sqrt((p * (1 - p)) / n),
    avgBlue: mean(blue),
    avgRed: mean(red),
    blueSe: sem(blue),
    redSe: sem(red),
    avgRpBlue: mean(rpBlue),
    avgRpRed: mean(rpRed),
    avgMargin: mean(margins),
    marginSe: sem(margins),
    blueScoreHist: histogram(blue, SCORE_LO, SCORE_HI),
    redScoreHist: histogram(red, SCORE_LO, SCORE_HI),
    marginHist: histogram(margins, -MARGIN_EDGE, MARGIN_EDGE),
    bin: { lo: SCORE_LO, hi: SCORE_HI, marginEdge: MARGIN_EDGE, size: BIN },
    bestBlue: eBlue.best,
    worstBlue: eBlue.worst,
    bestRed: eRed.best,
    worstRed: eRed.worst,
    bestMargin: eMargin.best,
    worstMargin: eMargin.worst,
    bestTotal: eTotal.best,
    worstTotal: eTotal.worst,
    at: {
      bestBlue: eBlue.bestAt,
      worstBlue: eBlue.worstAt,
      bestRed: eRed.bestAt,
      worstRed: eRed.worstAt,
      bestMargin: eMargin.bestAt,
      worstMargin: eMargin.worstAt,
      bestTotal: eTotal.bestAt,
      worstTotal: eTotal.worstAt,
    },
    rp: {
      blue: {
        auto: share('blue', (f) => f.rp.auto > 0),
        coral: share('blue', (f) => f.rp.coral > 0),
        barge: share('blue', (f) => f.rp.barge > 0),
        win: share('blue', (f) => f.rp.win > 0),
        tie: share('blue', (f) => f.rp.tie > 0),
      },
      red: {
        auto: share('red', (f) => f.rp.auto > 0),
        coral: share('red', (f) => f.rp.coral > 0),
        barge: share('red', (f) => f.rp.barge > 0),
        win: share('red', (f) => f.rp.win > 0),
        tie: share('red', (f) => f.rp.tie > 0),
      },
    },
    // Table 6-2 pays six columns, and a MATCH total that moves can come from any of them, so the batch has
    // to say which one moved.
    detail: {
      blue: {
        autoCoral: per('blue', (f) => f.autoCoral),
        leave: per('blue', (f) => f.leave),
        coralPoints: per('blue', (f) => f.coralPoints),
        algaePoints: per('blue', (f) => f.algaePoints),
        processor: per('blue', (f) => f.algae.processor),
        net: per('blue', (f) => f.algae.net),
        bargePoints: per('blue', (f) => f.bargePoints),
        deep: per('blue', (f) => f.barge.deep),
        shallow: per('blue', (f) => f.barge.shallow),
        park: per('blue', (f) => f.barge.park),
        coop: per('blue', (f) => f.coopertition),
        foulsWon: per('blue', (f) => f.fouls),
      },
      red: {
        autoCoral: per('red', (f) => f.autoCoral),
        leave: per('red', (f) => f.leave),
        coralPoints: per('red', (f) => f.coralPoints),
        algaePoints: per('red', (f) => f.algaePoints),
        processor: per('red', (f) => f.algae.processor),
        net: per('red', (f) => f.algae.net),
        bargePoints: per('red', (f) => f.bargePoints),
        deep: per('red', (f) => f.barge.deep),
        shallow: per('red', (f) => f.barge.shallow),
        park: per('red', (f) => f.barge.park),
        coop: per('red', (f) => f.coopertition),
        foulsWon: per('red', (f) => f.fouls),
      },
    },
    foulPoints: {
      blue: records.reduce((s, r) => s + (r.foulLog ? r.foulLog.blue.points : 0), 0) / n,
      red: records.reduce((s, r) => s + (r.foulLog ? r.foulLog.red.points : 0), 0) / n,
    },
    foulByRobot: [...byRobot.values()]
      .filter((row) => row.fouls > 0)
      .sort((a, b) => b.fouls - a.fouls || a.side.localeCompare(b.side) || a.slot - b.slot)
      .map((row) => ({
        side: row.side,
        slot: row.slot,
        team: row.team,
        name: row.name,
        fouls: row.fouls / n,
        codes: Object.fromEntries([...row.codes].map(([k, v]) => [k, v / n])),
      })),
  };
}

export function evaluate({ blueKind = 'greedy', redKind = 'greedy', matches = 10, seedBase = 1000, profiles = null, scenarioOverride = {}, bluePolicyOpts = {}, redPolicyOpts = {} } = {}) {
  const records = [];
  for (let i = 0; i < matches; i++) {
    records.push(playMatch({
      blueKind,
      redKind,
      seed: matchSeed(seedBase, i),
      rosterIdx: i,
      scenarioOverride,
      bluePolicyOpts,
      redPolicyOpts,
      blueProfiles: profiles ? profiles.blue : null,
      redProfiles: profiles ? profiles.red : null,
    }));
  }
  return { blueKind, redKind, ...aggregate(records) };
}

export { SAMPLES };
