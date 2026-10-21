import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerClient } from '../web/js/worker-client.js';
import { runSimulation, simulationSteps, runCooperatively, MAX_BATCH } from '../web/js/simulation.js';
import { frameIndexAtTime, parseReplay } from '../web/js/replay.js';
import { playMatch, aggregate, matchSeed } from '../web/js/league.js';
import { actionBands, periodBands, robotRows, scoreSeries, sourceRows, stockSeries, strideOf, supplySeries } from '../web/js/chartdata.js';
import { SAMPLES } from '../web/js/model.js';

class FakeWorker {
  sent = [];
  terminated = false;
  postMessage(message) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  reply(type, payload, id = this.sent.at(-1).id) { this.onmessage({ data: { id, type, payload } }); }
}

test('worker progress and out-of-order results stay with their request', async () => {
  const worker = new FakeWorker();
  const client = createWorkerClient(() => worker);
  const progress = [];
  const a = client.ask('match', {}, (p) => progress.push(p.done));
  const b = client.ask('batch', {});
  worker.reply('progress', { done: 1 }, 1);
  worker.reply('result', { value: 2 }, 2);
  worker.reply('result', { value: 1 }, 1);
  assert.deepEqual(await a, { value: 1 });
  assert.deepEqual(await b, { value: 2 });
  assert.deepEqual(progress, [1]);
  client.dispose();
});

test('worker crashes and decode errors settle callers and allow recovery', async () => {
  const workers = [];
  const client = createWorkerClient(() => { const w = new FakeWorker(); workers.push(w); return w; });
  const a = assert.rejects(client.ask('match', {}), /crashed/);
  const b = assert.rejects(client.ask('batch', {}), /crashed/);
  workers[0].onerror({ message: 'crashed' });
  await Promise.all([a, b]);
  assert.equal(workers[0].terminated, true);
  const c = assert.rejects(client.ask('match', {}), /decode/);
  workers[1].onmessageerror();
  await c;
  const retry = client.ask('match', {});
  workers[2].reply('result', { ok: true });
  assert.deepEqual(await retry, { ok: true });
  client.dispose();
});

test('cancellation ignores stale messages and task errors remain distinguishable from unavailable workers', async () => {
  const workers = [];
  const client = createWorkerClient(() => { const w = new FakeWorker(); workers.push(w); return w; });
  const cancelled = assert.rejects(client.ask('batch', {}), { name: 'AbortError' });
  const oldHandler = workers[0].onmessage;
  client.dispose();
  await cancelled;
  const next = client.ask('match', {});
  oldHandler({ data: { id: 2, type: 'result', payload: { stale: true } } });
  workers[1].reply('result', { fresh: true });
  assert.deepEqual(await next, { fresh: true });
  const invalid = assert.rejects(client.ask('batch', {}), { name: 'WorkerTaskError' });
  workers[1].reply('error', 'invalid inputs');
  await invalid;
  client.dispose();
});

test('cooperative fallback checks cancellation before starting another match and closes the iterator', async () => {
  const controller = new AbortController();
  let computations = 0;
  let closed = false;
  function* work() {
    try { while (true) { computations++; yield { done: computations }; } }
    finally { closed = true; }
  }
  const run = runCooperatively(work(), {
    signal: controller.signal,
    yieldControl: async () => {},
    onProgress: () => controller.abort(),
  });
  await assert.rejects(run, { name: 'AbortError' });
  assert.equal(computations, 1);
  assert.equal(closed, true);
});

test('timestamp lookup supports irregular replay intervals and clamps at both ends', () => {
  const frames = [0, 0.2, 0.5, 1.5].map((t) => ({ t }));
  assert.equal(frameIndexAtTime(frames, -1), 0);
  assert.equal(frameIndexAtTime(frames, 0.2), 1);
  assert.equal(frameIndexAtTime(frames, 1), 2.5);
  assert.equal(frameIndexAtTime(frames, 10), 3);
  assert.equal(frameIndexAtTime([], 1), 0);
});

test('invalid batch sizes fail before running the engine', () => {
  for (const matches of [0, 1, 1.5, Infinity, NaN]) {
    assert.throws(() => simulationSteps('batch', { matches }).next(), /at least two/);
  }
  assert.throws(() => simulationSteps('batch', { matches: MAX_BATCH + 1 }).next(), /capped at/);
});

test('a batch row replays the MATCH it counted, and every extreme points at its own row', () => {
  const profiles = { blue: structuredClone(SAMPLES), red: structuredClone(SAMPLES) };
  const input = { blueKind: 'greedy', redKind: 'greedy', matches: 4, seedBase: 7000, scenario: {}, profiles };
  const { summary, rows, recorded } = runSimulation('batch', input);
  assert.deepEqual(rows.map((r) => r.seed), [0, 1, 2, 3].map((i) => matchSeed(7000, i)));
  assert.deepEqual(rows.map((r) => r.n), [1, 2, 3, 4]);
  for (const [key, at] of Object.entries(summary.at)) {
    const row = rows[at];
    const value = key.endsWith('Blue') ? row.blue : key.endsWith('Red') ? row.red
      : key.endsWith('Margin') ? row.blue - row.red : row.blue + row.red;
    assert.equal(value, summary[key], `${key} points at a row that scored ${value}`);
  }
  const top = rows[summary.at.bestBlue];
  const again = runSimulation('match', {
    blueKind: input.blueKind, redKind: input.redKind, seed: top.seed,
    scenarioOverride: {}, blueProfiles: profiles.blue, redProfiles: profiles.red,
  });
  assert.equal(again.final.blue.total, top.blue);
  assert.equal(again.final.red.total, top.red);
  // A flagged MATCH is a replay, not a re-roll: the frames have to be the ones the batch drew.
  assert.deepEqual(runSimulation('match', {
    blueKind: input.blueKind, redKind: input.redKind, seed: rows[0].seed,
    scenarioOverride: {}, blueProfiles: profiles.blue, redProfiles: profiles.red,
  }).frames, recorded.frames);
});

test('shared worker/fallback path preserves engine results, aggregation, and exportable plans', async () => {
  const profiles = { blue: structuredClone(SAMPLES), red: structuredClone(SAMPLES) };
  const input = { blueKind: 'greedy', redKind: 'greedy', matches: 2, seedBase: 12345, scenario: {}, profiles };
  const reference = Array.from({ length: 2 }, (_, i) => playMatch({
    blueKind: input.blueKind, redKind: input.redKind, seed: matchSeed(input.seedBase, i),
    blueProfiles: profiles.blue, redProfiles: profiles.red, record: i === 0,
  }));
  const workerPath = runSimulation('batch', input);
  const localPath = await runCooperatively(simulationSteps('batch', input), { yieldControl: async () => {} });
  assert.deepEqual(workerPath.summary, aggregate(reference));
  assert.deepEqual(workerPath.recorded.frames, reference[0].frames);
  assert.deepEqual(localPath, workerPath);
  assert.doesNotThrow(() => structuredClone(workerPath));
  const single = runSimulation('match', { seed: 12345, blueProfiles: profiles.blue, redProfiles: profiles.red });
  assert.deepEqual(single.frames, reference[0].frames);
  profiles.blue[0].team = 99999;
  assert.notEqual(single.profiles.blue[0].team, 99999);
  const file = JSON.stringify({ ...single, kind: 'reefscape' });
  // JSON normalizes signed zero when replay data is exported.
  assert.equal(JSON.stringify(parseReplay(file).frames), JSON.stringify(single.frames));
  const corrupt = JSON.parse(file);
  corrupt.frames[1].t = corrupt.frames[0].t;
  assert.throws(() => parseReplay(JSON.stringify(corrupt)), /unordered/);
  assert.throws(() => parseReplay('{"kind":"xplore-match-v1"}'), /REEFSCAPE/);
  corrupt.frames = [];
  assert.throws(() => parseReplay(JSON.stringify(corrupt)), /REEFSCAPE/);
});
test('the single-MATCH cycle ledger reaches the page and survives an export', () => {
  const profiles = { blue: structuredClone(SAMPLES), red: structuredClone(SAMPLES) };
  const m = runSimulation('match', { seed: 12345, blueProfiles: profiles.blue, redProfiles: profiles.red });
  const back = parseReplay(JSON.stringify({ ...m, kind: 'reefscape' }));
  for (const side of ['blue', 'red']) {
    // The two source splits have to close on the columns the table already had, or the Numbers tab prints
    // an arithmetic that does not add up on screen.
    for (const r of m.final[side].robots) {
      const pf = r.pickedFrom;
      assert.equal(pf.station + pf.theirStation + pf.mark + pf.dropped, r.picked, `${side}${r.slot} CORAL sources`);
      const sf = r.strippedFrom;
      assert.equal(sf.reef + sf.mark + sf.dropped, r.strips, `${side}${r.slot} ALGAE sources`);
      const legs = Object.values(r.movedFt).reduce((a, v) => a + v, 0);
      assert.ok(Math.abs(legs - r.droveFt) <= 0.6, `${side}${r.slot} legs ${legs} against ${r.droveFt} ft`);
      assert.ok(r.droveFt > 50, `${side}${r.slot} drove ${r.droveFt} ft in a MATCH played to the whistle`);
      assert.ok(r.pickMisses >= 0 && r.heldSec >= 0);
      assert.ok(Object.values(r.fullSec).reduce((a, v) => a + v, 0) <= 155, `${side}${r.slot} waited on a full level longer than the MATCH`);
    }
    assert.deepEqual(back.final[side].robots.map((r) => r.pickedFrom), m.final[side].robots.map((r) => r.pickedFrom));
    assert.deepEqual(back.final[side].robots.map((r) => r.busySec), m.final[side].robots.map((r) => r.busySec));
  }
});

// The five single-MATCH charts are drawn from the frames, so a line on a canvas has to be the number the ledger
// row beside it prints. These are the derivations the page runs, against a record a MATCH actually made.
test('the single-MATCH charts derive from the frames and agree with the ledger they sit under', () => {
  const profiles = { blue: structuredClone(SAMPLES), red: structuredClone(SAMPLES) };
  const m = runSimulation('match', { seed: 12345, blueProfiles: profiles.blue, redProfiles: profiles.red });
  const frames = structuredClone(m.frames);
  const final = structuredClone(m.final);
  const span = frames.at(-1).t;
  const stride = strideOf(frames);
  assert.equal(frames.length, 750, `${frames.length} frames of a 150 s MATCH stamped every 0.2 s`);
  assert.ok(Math.abs(stride - 0.2) < 1e-9, `frame stride reads ${stride} s`);

  for (const side of ['blue', 'red']) {
    const s = scoreSeries(frames, side);
    assert.equal(s.t.at(-1), span, `${side} score series stops short of the whistle`);
    assert.equal(s.v.at(-1), final[side].total, `${side} trend line ends somewhere other than the ledger total`);
    assert.ok(s.v.length <= 241, `${side} series draws ${s.v.length} points into a few hundred pixels`);
    const st = stockSeries(frames, side);
    const last = frames.at(-1).reef[side];
    assert.equal(st.coral.at(-1), last.L2 + last.L3 + last.L4 + last.trough);
    assert.equal(st.algae.at(-1), last.algae, `${side} ALGAE curve ends somewhere other than the rings left`);
    // ALGAE only ever leave a REEF, so that curve cannot rise. CORAL can: a piece shaken off a branch is
    // un-booked, so its curve is bounded and ends where the ledger says, but it is not monotone.
    const cap = 36 + 24;
    for (let i = 0; i < st.coral.length; i++) {
      assert.ok(st.coral[i] >= 0 && st.coral[i] <= cap, `${side} reef stock reads ${st.coral[i]} at ${st.t[i]} s, outside 0..${cap}`);
    }
    for (let i = 1; i < st.algae.length; i++) {
      assert.ok(st.algae[i] <= st.algae[i - 1], `${side} ALGAE grew from ${st.algae[i - 1]} to ${st.algae[i]} at ${st.t[i]} s`);
    }
  }

  const bands = periodBands(frames);
  assert.equal(bands[0].p, 'AUTO');
  assert.equal(bands[0].t0, 0);
  assert.equal(bands.at(-1).t1, span);
  assert.equal(bands.length, 2, `the AUTO edge is one stamp, and this record made ${bands.length} period bands`);

  const sup = supplySeries(frames);
  for (const side of ['blue', 'red']) {
    const want = frames.at(-1).stations[side].reduce((a, q) => a + q, 0);
    const got = (side === 'blue' ? sup.blue : sup.red).at(-1);
    assert.equal(got, want, `${side} STATION curve ends at ${got} against the ${want} the frame holds`);
    assert.ok(sup.loose.at(-1) >= 0);
  }
  assert.ok(sup.blue[0] > 0 && sup.red[0] > 0, 'the STATION queues start empty, so the supply chart is drawing nothing');

  const rows = robotRows(frames);
  assert.equal(rows.length, 6);
  for (const row of rows) {
    const ab = actionBands(frames, row.pos);
    let total = 0;
    const byAction = {};
    for (let i = 1; i < ab.length; i++) {
      assert.notEqual(ab[i].a, ab[i - 1].a, 'two neighbouring action bands name the same action, so the merge missed');
    }
    for (const b of ab) {
      total += b.t1 - b.t0;
      byAction[b.a] = (byAction[b.a] || 0) + (b.t1 - b.t0);
    }
    assert.ok(Math.abs(total - span) <= stride * 2, `${row.side}${row.slot} action bands cover ${total.toFixed(1)} s of a ${span} s MATCH`);
    const rec = final[row.side].robots[row.pos % 3];
    for (const [a, sec] of Object.entries(byAction)) {
      if (a === 'idle') continue;
      // The ledger accrues an action's seconds only while the machine is running that action; the band reads
      // the intent that was steering it, which is the same clock from the other side.
      const booked = rec.busySec[a] || 0;
      assert.ok(sec + stride * 2 >= booked, `${row.side}${row.slot} booked ${booked.toFixed(1)} s of ${a} but only ${sec.toFixed(1)} s of the MATCH was steered by it`);
    }
  }

  const src = sourceRows(final);
  assert.equal(src.length, 6);
  for (const r of src) {
    assert.equal(r.station + r.theirStation + r.mark + r.dropped, r.taken, `${r.name} bar does not add up to its own length`);
  }
});
