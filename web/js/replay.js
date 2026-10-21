// Use recorded timestamps, including imported replays with a different or irregular sample interval.
export function frameIndexAtTime(frames, time) {
  if (!frames.length) return 0;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].t <= time) lo = mid;
    else hi = mid - 1;
  }
  const next = frames[lo + 1];
  return next ? lo + Math.max(0, Math.min(1, (time - frames[lo].t) / (next.t - frames[lo].t))) : lo;
}

export function parseReplay(text) {
  const data = JSON.parse(text);
  if (data?.kind !== 'reefscape' || !Array.isArray(data.frames) || !data.frames.length || !data.scenario) {
    throw new Error('Not a REEFSCAPE match file');
  }
  for (const side of ['blue', 'red']) {
    const final = data.final?.[side];
    if (!Number.isFinite(final?.total) || !Array.isArray(final?.robots) || !final.coral || !final.algae || !final.barge || !final.rp) {
      throw new Error(`Missing ${side} final ledger`);
    }
  }
  let previous = -Infinity;
  for (const frame of data.frames) {
    if (!Number.isFinite(frame?.t) || frame.t < 0 || frame.t <= previous || !Array.isArray(frame.robots) || !Array.isArray(frame.floor)) {
      throw new Error('Invalid or unordered replay frames');
    }
    for (const side of ['blue', 'red']) {
      if (!Number.isFinite(frame.score?.[side]) || !frame.reef?.[side] || !Number.isFinite(frame.hpQueue?.[side])) {
        throw new Error('Missing frame scoreboard or inventory');
      }
    }
    for (const robot of frame.robots) {
      if (!Number.isFinite(robot.x) || !Number.isFinite(robot.y) || !Number.isFinite(robot.heading)) throw new Error('Invalid robot position');
    }
    previous = frame.t;
  }
  if (data.events != null && (!Array.isArray(data.events) || data.events.some((event) => !Number.isFinite(event?.t)))) {
    throw new Error('Invalid replay events');
  }
  data.events ??= [];
  return data;
}
