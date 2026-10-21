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

// ---- the setup codec: bytes in, a setup out, or nothing --------------------------------------
// `statestore.js` reads no storage and touches no DOM, so the decoder can be attacked here instead of in a
// browser. A half-trusted link would be a way to crash the engine — or reach the page's object graph — from
// somebody's clipboard, which is the reason these tests exist before the buttons do.
import {
  SETUP_VERSION, STORAGE_KEY, MAX_LINK_CHARS, buildSetup, readSetup, encode, decode, toLink, sameSetup, packProfile,
} from '../web/js/statestore.js';
import { PRESETS, HUMAN_PLAYER, ROBOT_PRESETS, presetIndexOf } from '../web/js/model.js';

const shippedSetup = (over = {}) => buildSetup({
  trios: { blue: PRESETS.find((p) => p.key === 'johnson').trio, red: PRESETS.find((p) => p.key === 'newton').trio },
  hp: { blue: { ...HUMAN_PLAYER }, red: { ...HUMAN_PLAYER } },
  cageDepth: { blue: [true, false, true], red: [true, true, false] },
  kinds: { blue: 'ai', red: 'greedy' },
  switches: {
    fouls: true, qual: true, hpNet: true, turnRamp: true, contact: true, placeRisk: true, detour: true,
    carryDrop: true, branchDedup: true, climbRisk: true, contactFouls: false, cardLadder: true, mirror: false,
  },
  numbers: { jitter: 20, seed: 12345, matches: 48, batchSeed: 51000 },
  ...over,
});

test('a setup survives its own link, and the link is the bytes the autosave holds', () => {
  const setup = shippedSetup();
  assert.deepEqual(setup.problems, [], `the shipped lineup should pack without complaint: ${setup.problems.join(' / ')}`);
  const { link, chars, error } = toLink(setup);
  assert.equal(error, null);
  assert.ok(link.startsWith('#s='), `a fragment link, not a query: ${link.slice(0, 12)}`);
  assert.ok(chars < 4000, `six named cards should be a few hundred bytes, not ${chars}`);
  assert.equal(encode(setup), link.slice(3), 'the autosave and the link are different bytes');
  const back = readSetup(decode(link).obj);
  assert.deepEqual(back.problems, [], back.problems.join(' / '));
  const blue = back.setup.trios.blue;
  const source = PRESETS.find((p) => p.key === 'johnson').trio;
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(blue[i], source[i], `card ${i + 1} came back as a different machine`);
  }
  assert.equal(back.setup.switches.contactFouls, false);
  assert.equal(back.setup.kind.blue, 'ai');
  assert.deepEqual(back.setup.cageDepth.red, [true, true, false]);
  assert.equal(back.setup.numbers.seed, 12345);
  // Repacking what the decoder produced must give the same bytes: otherwise "save, restore, save" would
  // drift, and the autosave would write on a setup nobody changed.
  const repacked = buildSetup({
    trios: back.setup.trios,
    hp: back.setup.hp,
    cageDepth: back.setup.cageDepth,
    kinds: back.setup.kind,
    switches: back.setup.switches,
    numbers: back.setup.numbers,
  });
  assert.equal(sameSetup(repacked, setup), true, 'restoring and re-saving produced different bytes');
  assert.equal(toLink(repacked).link, link, 'and therefore a different link for the same setup');
});

test('an edited card with no preset to diff against keeps every number the card can edit', () => {
  const trio = PRESETS.find((p) => p.key === 'johnson').trio.map((p) => JSON.parse(JSON.stringify(p)));
  trio[1].driveSpeedIps = 122;
  trio[1].placeSec.L4 = 2.25;
  trio[1].placeDrop.L4 = 0.31;
  trio[1].autoCycles = 5;
  trio[1].climbSuccess = 0.5;
  trio[1].canClimbDeep = false;
  trio[1].chassis = 'mecanum';
  assert.equal(presetIndexOf(trio[1]), -1, 'the edited card should read as Custom before it is packed');
  const packed = shippedSetup({ trios: { blue: trio, red: PRESETS.find((p) => p.key === 'newton').trio } });
  const back = readSetup(decode(encode(packed)).obj);
  assert.deepEqual(back.problems, [], back.problems.join(' / '));
  // Every field the card can hold, and the identity the importer writes, come back. What does not come back
  // is provenance: a hand-typed machine must not arrive wearing another team's `key`/`ref`/`pieces`.
  const { key, ref, pieces, ...editable } = trio[1];
  assert.deepEqual(back.setup.trios.blue[1], editable, 'a Custom card lost a field through the link');
  assert.notEqual(back.setup.trios.blue[1].key, key, 'provenance rode along on a card that is not that preset');
  const row = packProfile(trio[1]);
  assert.equal(row.p, -1);
  // A Custom card is its own numbers, and the two nested blocks travel flat so they can be clamped.
  assert.ok(row.d.placeL4 && row.d.dropL4 && row.d.autoCycles === 5 && row.d.canClimbDeep === false);
  assert.equal(row.d.placeSec, undefined, 'a nested object must not ride in a link');
  assert.equal(row.d.key, undefined, 'a Custom card must not carry a preset key');
});

test('a link cannot reach the page object graph, and it says what it dropped', () => {
  // The payload is built with JSON.parse because an object literal writes `__proto__` as a *prototype*, not
  // as a key — a fixture written that way would prove nothing. First prove the fixture is a real own key.
  const clean = (side) => packProfile(PRESETS.find((p) => p.key === side).trio[2]);
  const hostile = JSON.parse(
    `{"v":"${SETUP_VERSION}","blue":[{"p":-1,"d":{"__proto__":{"polluted":"yes"},"name":"Evil","driveSpeedIps":99999,"autoCycles":2.5,"team":"abc","placeSec":{"L4":99},"placeL4":0.5,"unknownField":1}},${JSON.stringify(clean('johnson'))},${JSON.stringify(clean('johnson'))}],"red":[${[0, 1, 2].map((i) => JSON.stringify(clean('newton'))).join(',')}]}`,
  );
  assert.ok(Object.getOwnPropertyNames(hostile.blue[0].d).includes('__proto__'), 'the fixture is not hostile after all');
  assert.ok(Object.keys({}).length === 0, 'the control: a fresh object has no keys to begin with');
  const before = Object.keys(Object.prototype);
  const { setup, problems } = readSetup(hostile);
  assert.deepEqual(Object.keys(Object.prototype), before, 'the decoder touched Object.prototype');
  assert.equal(setup.trios.blue[0].polluted, undefined, 'the payload reached a card');
  assert.equal(problems.length > 0, true, 'a hostile row was accepted without a word');
  const text = problems.join(' · ');
  assert.match(text, /__proto__|"unknownField"|no card field is called/i, `the dropped keys were not named: ${text}`);
  assert.match(text, /placeSec.*as an object/, `a nested level block was not refused: ${text}`);
  assert.match(text, /autoCycles/, `a fractional AUTO count was not reported: ${text}`);
  assert.equal(setup.trios.blue[0].driveSpeedIps, 250, 'the out-of-range speed was not clamped');
  assert.equal(setup.trios.blue.length, 3, 'a side with a bad card must keep the other two');
});

test('numbers out of range are clamped with a sentence, and a wrong version is refused whole', () => {
  const setup = shippedSetup();
  setup.blue[0].d = { driveSpeedIps: 99999, climbSuccess: 5, autoCycles: 2.5, netScoreSec: -4 };
  const back = readSetup(setup);
  assert.equal(back.setup.trios.blue[0].driveSpeedIps, 250, 'drive speed was not clamped to the codec range');
  assert.match(back.problems.join(' '), /driveSpeedIps 99999 is outside/, 'a clamp with no message is a silent change');
  assert.match(back.problems.join(' '), /autoCycles/, 'a fractional AUTO count was not reported');
  assert.equal(back.setup.trios.blue[0].climbSuccess, 1);
  assert.equal(back.setup.trios.blue[0].netScoreSec, 0);
  const stale = readSetup({ ...shippedSetup(), v: 'xplore-setup-v1' });
  assert.equal(stale.setup, null);
  assert.match(stale.problems[0], /version/, `a stale entry should be refused by name: ${stale.problems[0]}`);
  assert.match(stale.problems[0], new RegExp(SETUP_VERSION), 'the refusal should say what this page writes');
});

test('a setup that cannot fit a link is refused rather than truncated', () => {
  const padded = { ...shippedSetup(), junk: 'x'.repeat(MAX_LINK_CHARS) };
  const { link, chars, error } = toLink(padded);
  assert.equal(link, null);
  assert.ok(chars > MAX_LINK_CHARS);
  assert.match(error, new RegExp(String(chars)), 'the message should carry the number the reader has to act on');
  assert.ok(STORAGE_KEY.includes('reefscape'), 'the 2025 page must not write into the 2026 page storage key');
});

// ---- the scouting importer: a file in, six cards out, every change said -------------------------------
// The parser is the one place where a wrong column becomes a wrong machine, and the card is what the engine
// drives — so these read a file the way a team writes one (mixed case, `Team Number`, a metric column, a
// percentage as 94), and then run the result back through the same codec the autosave uses. An imported lineup
// that cannot survive its own link is an import the user cannot hand to a teammate.
import { parseScouting, placeRosters, toCard, COLUMN_DOC } from '../web/js/scouting.js';
import { ROBOT_LIMITS } from '../web/js/rules.js';

const SCOUT = [
  'Team Number,Robot Name,Drivetrain,Drive Speed,auto_coral,teleop_coral,barge_points,climb_s,climb_success_pct,arm_s,net_lift_s,weight,reliability_pct,l4_drop_pct,opr',
  '1690,Orbit,swerve,170,4.19,21.4,12.97,2.4,94,1.9,1.5,112,97,18,52.7',
  '9999,Heavy robot,tank drive,300,0.4,1.2,2.1,9,45,11,0,160,61,80,40',
].join('\n');

test('a scouting header lands on the card field it names, in the model’s units', () => {
  const { rows, unknown, problems } = parseScouting(SCOUT);
  assert.equal(rows.length, 2, 'both robots should be read');
  assert.deepEqual(unknown, ['opr'], 'only the aggregate column is unread');
  assert.match(problems.join(' · '), /aggregate point total/, 'a refused column has to say why it was refused');
  const r = rows[0];
  assert.equal(r.team, 1690);
  assert.equal(r.name, 'Orbit');
  assert.equal(r.chassis, 'swerve');
  assert.equal(r.driveSpeedIps, 170, 'Drive Speed is the in/s column');
  assert.equal(r.autoCycles, 4, 'auto_coral is a mean; the card counts the pieces');
  assert.equal(r.teleopCoral, 21.4);
  assert.equal(r.climbSec, 2.4);
  assert.equal(r.climbSuccess, 0.94, 'a percent arrives as a percent and is stored as a fraction');
  assert.equal(r.reliability, 0.97);
  assert.equal(r.dropL4, 0.18);
  assert.equal(r.weightLb, 112);
  assert.equal(r.netLift, 1.5);
  assert.equal(r.bargePoints, 12.97);
  // A value that needed no clamping says nothing, and that is the control for the test below: without it, a
  // parser that reported on every cell would pass both. (The AUTO mean is a rounding, not a clamp, and the
  // first robot's row is allowed exactly one of those.)
  assert.equal(problems.filter((p) => p.startsWith('row 1') && p.includes('outside')).length, 0, problems.join(' · '));
});

test('a number outside the card is clamped and the sentence carries both numbers', () => {
  const { problems } = parseScouting(SCOUT);
  const text = problems.join(' · ');
  assert.match(text, /300 is outside the 40-200/, `the too-fast robot was absorbed silently: ${text}`);
  // Built with `new RegExp`, because `${…}` inside a regex literal is four characters, not an interpolation —
  // and a guard that compares against the literal text "${ROBOT_LIMITS…}" passes whatever the code does.
  assert.match(text, new RegExp(`160 is outside the 40-${ROBOT_LIMITS.weightLbMax}`), 'R103’s cap is the clamp and the message has to say so');
  assert.match(text, /0\.4 is a season mean/, 'a fractional AUTO count is rounded, and rounding is a claim');
  const heavy = parseScouting(SCOUT).rows[1];
  assert.equal(heavy.driveSpeedIps, 200);
  assert.equal(heavy.weightLb, ROBOT_LIMITS.weightLbMax);
  assert.equal(heavy.autoCycles, 0);
  assert.equal(heavy.chassis, 'tank', 'the "tank drive" spelling is the tank chassis, not an unknown one');
});

test('an imported card is a machine: nested where the profile nests, flat names nowhere', () => {
  const row = parseScouting(SCOUT).rows[0];
  const { profile: p, matchedPreset } = toCard(row, []);
  assert.equal(matchedPreset, 'team1690', 'a team this build models is built on its own card');
  assert.equal(p.placeDrop.L4, 0.18, 'the flat drop column has to land inside placeDrop');
  assert.equal(typeof p.placeSec.L3, 'number');
  assert.equal(p.canClimbDeep, true, 'barge_points 12.97 is a DEEP hold');
  assert.equal(p.netScoreSec, 1.5);
  // Nothing that is not a profile field may ride on the card, and nothing that is not this machine's identity
  // may ride either: `key`, `ref` and `pieces` belong to the preset a scouted card overwrote.
  for (const leak of ['armSec', 'coralPerMatch', 'teleopCoral', 'bargePoints', 'netLift', 'dropL4', 'placeL4', 'key', 'ref', 'pieces']) {
    assert.equal(p[leak], undefined, `${leak} reached the card as a wire name nothing reads`);
  }
  // The BARGE line is the midpoint of Table 6-2's three prices, and an explicit DEEP column outranks it. The two
  // readings bracket where the line has to sit: `model.js` gave 1778 (barge_points 2.79) no DEEP hold and kept it
  // for 3683 (5.36), so an importer that drew the line anywhere else would disagree with the cards it ships.
  assert.equal(toCard({ team: 9999, bargePoints: 2.1 }, []).profile.canClimbDeep, false);
  assert.equal(toCard({ team: 9999, bargePoints: 5.36 }, []).profile.canClimbDeep, true);
  assert.equal(toCard({ team: 9999, bargePoints: 2.1, canClimbDeep: true }, []).profile.canClimbDeep, true);
  // The one rate the importer takes from the rules file rather than from itself.
  const weight = COLUMN_DOC.find((c) => c.field === 'weightLb');
  assert.equal(weight.spec, `range:40:${ROBOT_LIMITS.weightLbMax}`, 'the CSV must not carry a second copy of R103');
});

test('arm seconds move the ladder, not the shape of it', () => {
  const base = ROBOT_PRESETS.find((r) => r.profile.team === 1690).profile;
  const { profile: p, notes } = toCard({ team: 1690, armSec: 3 }, []);
  assert.ok(Math.abs(p.pickSec + p.placeSec.L3 - 3) < 0.01, `the card reads ${p.pickSec} + ${p.placeSec.L3} s, not 3 s`);
  const shape = (q) => q.placeSec.L4 / q.placeSec.L1;
  assert.ok(Math.abs(shape(p) / shape(base) - 1) < 0.03, 'one stopwatch number must not redraw the level curve');
  assert.ok(notes.some((n) => n.includes("the drive stays the model's")), 'a derived clock that is not said is a guess');
  // The scale is bounded by what a card can hold, and going past it is reported rather than drawn.
  const slow = toCard({ team: 1690, armSec: 12 }, []);
  assert.ok(slow.notes.some((n) => n.includes('0.33-×3')), slow.notes.join(' · '));
  assert.ok(slow.profile.placeSec.L4 <= 6, 'the derivation must stay inside the card');
});

test('the six cards an import writes survive the link the autosave writes', () => {
  const current = {
    blue: PRESETS.find((p) => p.key === 'johnson').trio.map((p) => JSON.parse(JSON.stringify(p))),
    red: PRESETS.find((p) => p.key === 'newton').trio.map((p) => JSON.parse(JSON.stringify(p))),
  };
  const six = [
    'team,chassis,drive_speed,auto_coral,teleop_coral,arm_s,barge_points,climb_success_pct',
    '1690,swerve,170,4.19,21.4,1.9,12.97,94',
    '4414,swerve,160,2.47,19.3,2.2,11.2,92',
    '2073,swerve,140,1.55,10.8,2.6,6.4,88',
    '2910,swerve,175,3.99,18.5,1.8,12.97,95',
    '1323,mecanum,165,3.61,22.1,2.0,9.1,93',
    '4272,tank,130,2.49,13.9,2.9,2.4,85',
  ].join('\n');
  const rows = parseScouting(six).rows;
  assert.equal(rows.length, 6);
  const { trios, notes } = placeRosters(rows, current);
  // Every card is accounted for and none of them ran out of the FIELD: the notes here are the derivations, and
  // the only ones that would mean trouble are the fit and the leftovers.
  assert.equal(notes.filter((n) => n.includes('did not fit') || n.includes('kept the cards they had')).length, 0, notes.join(' · '));
  assert.equal(trios.red[2].chassis, 'tank');
  const packed = shippedSetup({ trios });
  assert.deepEqual(packed.problems, [], `the imported lineup will not pack: ${packed.problems.join(' / ')}`);
  const back = readSetup(decode(encode(packed)).obj);
  assert.deepEqual(back.problems, [], `an imported card went through the link with a complaint: ${back.problems.join(' / ')}`);
  for (const side of ['blue', 'red']) {
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(back.setup.trios[side][i], trios[side][i], `${side} ${i} is a different machine after the link`);
    }
  }
});

test('a short file leaves the rest of the field alone and says so', () => {
  const current = {
    blue: PRESETS.find((p) => p.key === 'johnson').trio.map((p) => JSON.parse(JSON.stringify(p))),
    red: PRESETS.find((p) => p.key === 'newton').trio.map((p) => JSON.parse(JSON.stringify(p))),
  };
  const one = 'team,drive_speed\n4414,155';
  const { trios, notes } = placeRosters(parseScouting(one).rows, current);
  assert.equal(trios.blue[0].driveSpeedIps, 155);
  assert.deepEqual(trios.blue[1], current.blue[1], 'a one-row file must not rewrite the ally');
  assert.deepEqual(trios.red, current.red, 'a one-row file must not rewrite the other ALLIANCE');
  assert.ok(notes.some((n) => n.includes('Blue 1/3')), notes.join(' · '));
  const eight = parseScouting(['team,speed', ...Array.from({ length: 8 }, (_, i) => `${2000 + i},15${i}`)].join('\n'));
  assert.equal(eight.rows.length, 8);
  const full = placeRosters(eight.rows, current);
  assert.ok(full.notes.some((n) => n.includes('2 row(s) did not fit')), 'the FIELD takes six ROBOTS and the file sent eight');
});

test('a file is read as a file: separators, comments and a header with nothing under it', () => {
  const tabs = ['team\tdrive_speed\tdeep', '2501\t148\tno', '2502\t151\tyes'].join('\n');
  const t = parseScouting(tabs);
  assert.equal(t.rows.length, 2, 'a tab-separated export is the same thing');
  assert.equal(t.rows[1].canClimbDeep, true);
  const commented = parseScouting('# my scouting sheet, week 3\nteam,speed\n7766,142\n\nstray\n');
  assert.equal(commented.rows.length, 1);
  assert.ok(commented.problems.some((p) => p.includes('one cell only')), commented.problems.join(' · '));
  assert.deepEqual(parseScouting('team,speed').problems, ['a CSV needs a header line and at least one robot']);
  assert.deepEqual(parseScouting('').rows, []);
  // A cell that is all words has no number in it, and a parser that read it as 0 would field a robot that
  // cannot move.
  const words = parseScouting('team,speed,weight\n5,"fast","n/a"');
  assert.equal(words.rows[0].driveSpeedIps, undefined, '"fast" became a speed');
  assert.equal(words.rows[0].weightLb, undefined, '"n/a" became 0 lb');
  assert.equal(words.rows[0].team, 5);
  // A sheet with blanks in it is the normal case, not an error: a cell nobody measured is a column the card
  // keeps as shipped, and it must not come back as a complaint about every empty cell in the file.
  const blanks = parseScouting('team,speed,pick_s,weight\n5,,0.55,');
  assert.equal(blanks.rows[0].team, 5);
  assert.equal(blanks.rows[0].pickSec, 0.55);
  assert.equal(blanks.rows[0].driveSpeedIps, undefined);
  assert.deepEqual(blanks.problems, [], `an empty cell was read as a bad one: ${blanks.problems.join(' · ')}`);
});

