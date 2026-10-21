// One simulation path for the worker and its cooperative main-thread fallback.
import { playMatch, aggregate, matchSeed } from './league.js';

const planOf = (p) => p?.kind === 'ai' ? { kind: p.kind, plan: p.plan, planLog: p.planLog } : null;

// The ceiling on one batch, in MATCHes. It lives here rather than in the page so the input, the worker and
// `npm run verify` all refuse the same number. A MATCH is a fifth of a second of the engine with two greedy
// fleets and about half a second with the planner on, so this is the wait a browser tab is willing to sit
// through with a progress bar and a cancel button.
export const MAX_BATCH = 600;

export function recordedOf(r, profiles) {
  return {
    final: r.final, events: r.events, frames: r.frames, scenario: r.scenario,
    foulLog: r.foulLog, stock: r.stock, contactHits: r.contactHits,
    profiles: structuredClone(profiles),
    policies: { blue: planOf(r.policies.blue), red: planOf(r.policies.red) },
  };
}

export function* simulationSteps(type, payload) {
  if (type === 'match') {
    return recordedOf(playMatch({ ...payload, record: true }), {
      blue: payload.blueProfiles, red: payload.redProfiles,
    });
  }
  if (type !== 'batch') throw new Error(`Unknown simulation task: ${type}`);
  const { blueKind, redKind, matches, seedBase, scenario, profiles } = payload;
  if (!Number.isSafeInteger(matches) || matches < 2) throw new RangeError('A batch needs at least two whole MATCHes');
  if (matches > MAX_BATCH) throw new RangeError(`A batch is capped at ${MAX_BATCH} MATCHes`);
  const records = [];
  // One row per MATCH: what it scored and which seed scored it. The frames are not kept — 600 of them would be
  // the bulk of the page's memory, and every one of them is reproducible from the seed in this row, which is
  // what makes "replay MATCH 37" a 0.5 s re-run rather than a storage problem.
  const rows = [];
  let recorded;
  for (let i = 0; i < matches; i++) {
    const seed = matchSeed(seedBase, i);
    const result = playMatch({
      blueKind, redKind, seed, record: i === 0,
      scenarioOverride: scenario, blueProfiles: profiles.blue, redProfiles: profiles.red,
    });
    if (i === 0) recorded = recordedOf(result, profiles);
    // Aggregation reads only the final ledger and the foul tally. Do not retain every policy closure and event log.
    records.push({ final: result.final, foulLog: result.foulLog });
    rows.push({
      n: i + 1,
      seed,
      blue: result.final.blue.total,
      red: result.final.red.total,
      fouls: (result.foulLog?.blue.points || 0) + (result.foulLog?.red.points || 0),
    });
    yield { done: i + 1, total: matches };
  }
  return { summary: aggregate(records), rows, recorded };
}

export function runSimulation(type, payload, onProgress) {
  const steps = simulationSteps(type, payload);
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) return step.value;
    onProgress?.(step.value);
  }
}

// Cancellation is checked before every MATCH. A host without workers can yield between matches,
// but cannot interrupt the synchronous physics loop halfway through one MATCH.
export async function runCooperatively(steps, { signal, yieldControl, onProgress } = {}) {
  try {
    while (true) {
      signal?.throwIfAborted();
      await yieldControl();
      signal?.throwIfAborted();
      const step = steps.next();
      if (step.done) return step.value;
      onProgress?.(step.value);
    }
  } finally {
    steps.return();
  }
}
