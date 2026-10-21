// Single MATCHes and batches run off the UI thread. simulation.js is also used by the cooperative
// fallback, so worker availability cannot change seeds, policies, or aggregated results.

import { runSimulation } from './simulation.js';

self.onmessage = (ev) => {
  const { id, type, payload } = ev.data || {};
  try {
    const result = runSimulation(type, payload, (progress) => self.postMessage({ id, type: 'progress', payload: progress }));
    self.postMessage({ id, type: 'result', payload: result });
  } catch (err) {
    self.postMessage({ id, type: 'error', payload: String((err && err.stack) || err) });
  }
};
