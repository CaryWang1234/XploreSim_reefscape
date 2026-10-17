// Web Worker: the batch button runs the real engine, and a batch is dozens of MATCHes at ~0.3 s each — a
// quarter of a minute of arithmetic that would otherwise stop the field, the progress bar and every click on
// the page. `ui.js` keeps the identical loop on the main thread as a fallback, because a host that refuses a
// module worker would otherwise be left with exactly the button that does nothing.

import { playMatch, aggregate, matchSeed } from './league.js';

// A policy object carries its own `act` closure, and a message cannot hold a function. What the page shows
// from a planner is the plain data it decided on, so that is what rides back.
const planOf = (p) => (p && p.kind === 'ai' ? { kind: p.kind, plan: p.plan, planLog: p.planLog } : null);

const recordedOf = (r) => (r ? {
  final: r.final,
  events: r.events,
  frames: r.frames,
  scenario: r.scenario,
  foulLog: r.foulLog,
  stock: r.stock,
  contactHits: r.contactHits,
  policies: { blue: planOf(r.policies.blue), red: planOf(r.policies.red) },
} : null);

self.onmessage = (ev) => {
  const { id, type, payload } = ev.data || {};
  try {
    if (type !== 'batch') {
      self.postMessage({ id, type: 'error', payload: `unknown worker message: ${type}` });
      return;
    }
    const { blueKind, redKind, matches, seedBase, scenario, profiles } = payload;
    const records = [];
    let first = null;
    for (let i = 0; i < matches; i++) {
      const r = playMatch({
        blueKind,
        redKind,
        seed: matchSeed(seedBase, i),
        record: i === 0,
        scenarioOverride: scenario,
        blueProfiles: profiles.blue,
        redProfiles: profiles.red,
      });
      if (i === 0) first = r;
      records.push(r);
      self.postMessage({ id, type: 'progress', payload: { done: i + 1, total: matches } });
    }
    self.postMessage({ id, type: 'result', payload: { summary: aggregate(records), recorded: recordedOf(first) } });
  } catch (err) {
    self.postMessage({ id, type: 'error', payload: String((err && err.stack) || err) });
  }
};
