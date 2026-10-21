// Everything the 2025 single-MATCH charts draw, derived from the frames the engine already wrote. A frame is
// stamped every 2nd tick (0.2 s) and carries the REEF occupancy, both STATION queues, the loose pieces, the
// hopper contents and the running score, so a chart line and the ledger row beside it are one computation over
// one record. Nothing here changes an engine number, and nothing here reads a model.

export const ACTION_ORDER = ['fetch-coral', 'strip-algae', 'place', 'process', 'score-net', 'climb', 'defend', 'idle'];

export function strideOf(frames) {
  return frames.length > 1 ? frames[1].t - frames[0].t : 0.2;
}

// 750 frames against a few hundred pixels: thin to at most `cap` points, and always keep the last one, or the
// curve stops short of the number the scoreboard is holding.
export function sampleIdx(n, cap = 240) {
  if (n <= cap) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (cap - 1));
  const out = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  out.push(n - 1);
  return out;
}

export function scoreSeries(frames, side) {
  const idx = sampleIdx(frames.length);
  const t = [];
  const v = [];
  for (const i of idx) {
    t.push(frames[i].t);
    v.push(frames[i].score[side]);
  }
  return { t, v };
}

// §6.4 makes AUTO 15 s of the 150 and there is no separate END GAME period (the CAGE assessment is a 3 s
// scoring window after the whistle, not a period), so this shades one edge and leaves the rest plain.
export function periodBands(frames) {
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const p = frames[i].period;
    const last = out[out.length - 1];
    if (last && last.p === p) last.t1 = frames[i].t;
    else out.push({ p, t0: frames[i].t, t1: frames[i].t });
  }
  return out;
}

// What was still on this ALLIANCE's REEF, frame by frame: the CORAL that had been put on it (branches plus the
// TROUGH) and the ALGAE nobody had taken off it yet. Both end where the ledger says they end, and the shape in
// between is the part the ledger cannot show — whether the stock ran out at 90 s or held until the whistle.
export function stockSeries(frames, side) {
  const idx = sampleIdx(frames.length);
  const t = [];
  const coral = [];
  const algae = [];
  for (const i of idx) {
    const r = frames[i].reef[side];
    t.push(frames[i].t);
    coral.push(r.L2 + r.L3 + r.L4 + r.trough);
    algae.push(r.algae);
  }
  return { t, coral, algae };
}

// The two supply lines a fleet works from: its own STATION queue (what the HUMAN PLAYER is feeding) and the
// CORAL lying loose on the CARPET, which is a piece somebody failed to keep.
export function supplySeries(frames) {
  const idx = sampleIdx(frames.length);
  const t = [];
  const blue = [];
  const red = [];
  const loose = [];
  for (const i of idx) {
    const f = frames[i];
    t.push(f.t);
    blue.push(f.stations.blue.reduce((a, q) => a + q, 0));
    red.push(f.stations.red.reduce((a, q) => a + q, 0));
    loose.push(f.floor.filter((p) => p.kind === 'coral').length);
  }
  return { t, blue, red, loose };
}

// `pos` is the index into the frame's `robots` array, which is blue's three then red's three, in SLOT order.
export function robotRows(frames) {
  if (!frames.length) return [];
  return frames[0].robots.map((x, pos) => ({ pos, side: x.side, slot: x.slot }));
}

// The action a machine was actually running, merged on the action rather than on the frame, so one frame of
// nothing between two drives does not read as a role change. A committed action is `busy`; what is steering a
// machine that is still driving is `intent`.
export function actionBands(frames, pos) {
  const stride = strideOf(frames);
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const r = frames[i].robots[pos];
    const a = r.busy || r.intent || 'idle';
    const last = out[out.length - 1];
    if (last && last.a === a) last.t1 = frames[i].t + stride;
    else out.push({ a, t0: last ? last.t1 : 0, t1: frames[i].t + stride });
  }
  return out;
}

// Where each ROBOT's CORAL came from, as the ledger records it. `taken` is `picked`, the same number the
// alliance table sums a row above, so the bar length and that row agree by construction.
export function sourceRows(final) {
  const out = [];
  for (const side of ['blue', 'red']) {
    for (const r of final[side].robots) {
      const p = r.pickedFrom || {};
      out.push({
        name: r.name,
        side,
        station: p.station || 0,
        theirStation: p.theirStation || 0,
        mark: p.mark || 0,
        dropped: p.dropped || 0,
        taken: r.picked || 0,
      });
    }
  }
  return out;
}
