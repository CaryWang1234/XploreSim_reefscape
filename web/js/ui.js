// Page wiring: settings -> engine -> replay. Nothing here models the game; it only moves data between
// web/js/engine.js and the DOM, and keeps the two rules of this repo visible (n and the error bar, and
// which numbers are rules).

import { playMatch, evaluate } from './league.js';
import { HUMAN_PLAYER, CHASSIS, PRESETS } from './model.js';
import { layout } from './model.js';
import { drawField } from './viz.js';
import { POINTS, GEO, FOULS, PIECES, TIME, FIELD, ROBOT_LIMITS } from './rules.js';
import { BRANCH_SLOTS_PER_LEVEL, TROUGH_CAP } from './model.js';

const $ = (id) => document.getElementById(id);

const PRESET_BY_KEY = new Map(PRESETS.map((p) => [p.key, p]));
// Each ALLIANCE picks its own trio, so the page can put the two real 2025 Einstein finalists on the field
// at once. The mirror is a checkbox rather than a preset: it is a statement about what the BATCH means
// (strategy vs strategy) and not about which machines are on the carpet.
const PRESET_OPTIONS = PRESETS.map((p) => ({ value: p.key, label: p.label, note: p.note, trio: p.trio }));

function trioFor(side) {
  return state.mirror ? state.trios.blue : state.trios[side];
}
const clone = (p) => ({ ...p, placeSec: { ...p.placeSec }, placeDrop: { ...(p.placeDrop || {}) } });

// The four levels are four separate numbers on purpose. §5.3 gives them different heights (L1 is the trough
// at the base, L2 31 in, L3 47 in, L4 72 in) and L2/L3 branches are angled up at 35° while L4 stands
// vertical, so the time an elevator spends putting a CORAL on one is not a fixed fraction of the time it
// spends putting one on another. An earlier card exposed only L4 and derived L3 = 0.71× and L2 = 0.48× from
// it, which made the whole ladder move as one knob and quietly fixed the shape of the curve.
const PLACE_LEVELS = ['L1', 'L2', 'L3', 'L4'];

const SPEC_FIELDS = [
  { key: 'driveSpeedIps', label: 'drive in/s', min: 40, max: 200, step: 5 },
  { key: 'pickSec', label: 'pick s', min: 0.3, max: 4, step: 0.1 },
  ...PLACE_LEVELS.map((lv) => ({
    key: `place${lv}`,
    label: `${lv} place s`,
    min: 0.1,
    max: 6,
    step: 0.05,
    get: (p) => p.placeSec[lv],
    set: (p, v) => { p.placeSec[lv] = v; },
    title: `Seconds to put a CORAL on ${lv}. ${lv === 'L1' ? 'The trough at the base of the REEF (§5.3): no branch to thread, so this is a dump, and §6.5.1 scores it as soon as it contacts the trough.' : `§5.3 puts ${lv} at ${lv === 'L2' ? '2 ft 7 in with the branch angled up 35°' : lv === 'L3' ? '3 ft 11 in angled up 35°' : '6 ft 0 in, vertical'}, and §6.5.1 only scores it once the BRANCH is inside the volume of the CORAL.`}`,
  })),
  ...PLACE_LEVELS.map((lv) => ({
    key: `drop${lv}`,
    label: `${lv} drop %`,
    min: 0,
    max: 90,
    step: 1,
    pct: true,
    get: (p) => (p.placeDrop ? p.placeDrop[lv] : 0),
    set: (p, v) => { if (!p.placeDrop) p.placeDrop = { L1: 0, L2: 0, L3: 0, L4: 0 }; p.placeDrop[lv] = v; },
    title: `Chance that a CORAL aimed at ${lv} does not stay on it. §6.5.1 scores an L2-L4 CORAL only "if the BRANCH is inside the volume of the CORAL", and a 4 in pipe through an 11 in pipe has about an inch of slop, so a placement that is not roughly lined up is not a score — it falls. 0 switches this level's risk off; the shipped values rise with the level because the higher the reach, the more of it has to hold still.`,
  })),
  { key: 'algaeStripSec', label: 'strip s', min: 0.4, max: 5, step: 0.1 },
  // 0 = the elevator cannot clear the NET's border, which is 6 ft 4 in up (§5.4.2). §6.1 lets the ROBOT score
  // ALGAE there, so this is a machine property rather than a rules question, and it is the one knob on the
  // card with no shipped value: every profile runs 0 and the goal is the HUMAN PLAYER's.
  { key: 'netScoreSec', label: 'NET lift s', min: 0, max: 6, step: 0.1, title: 'Seconds to lift an ALGAE over the NET border and release it (§5.4.2: the mesh hangs 6 ft 4 in above the carpet). The shipped profiles carry their own L4 placement time plus 0.5 s — a machine that lands a CORAL at 72 in clears the 76 in border, and a 16 in ring is the wider piece. 0 is the ablation. Above 0 the ROBOT drives under its own BARGE and keeps the 4 rather than processing for 6 minus the 4 the opponent\'s HUMAN PLAYER will throw back; in a mirror that trade costs both sides about 27 points a MATCH, because a lifted ring never feeds the other side\'s net.' },
  { key: 'climbSec', label: 'climb s', min: 0.5, max: 10, step: 0.1 },
  { key: 'turnRateDegS', label: 'turn deg/s', min: 60, max: 900, step: 20 },
  { key: 'reliability', label: 'reliability %', min: 60, max: 100, step: 1, pct: true },
];

// The drivetrain is a choice, not a per-number edit: it sets the sideways and reverse fractions, how
// much of the turn rate survives at full speed, and how long the spin takes to ramp up.
const CHASSIS_HINT = {
  swerve: 'Strafes and spins in place; turning at speed costs nothing.',
  tank: 'No sideways motion at all: it reverses rather than turning around, reverses at 60%, and keeps 55% of its turn rate at full speed.',
  mecanum: 'Strafes at 62% of top speed, reverses at 78%, and its in-place spin is traction-bound.',
};

const state = {
  // Two rosters, one per ALLIANCE, defaulted to the pair that played the 2025 Einstein Field final: Johnson
  // A1 on blue, Newton A1 on red. That is what a real MATCH looks like, and guard 17 runs each of those
  // trios against the numbers TBA recorded for it.
  // The discipline the mirror checkbox exists to protect: with two different trios on the field a score
  // difference says as much about the machines as about the driving, so any A/B of POLICY has to be run
  // with it ticked. The batch says which of the two it was.
  trios: { blue: PRESET_BY_KEY.get('johnson').trio.map(clone), red: PRESET_BY_KEY.get('newton').trio.map(clone) },
  mirror: false,
  // The HUMAN PLAYERS are the one exception: per-ALLIANCE on purpose, because the chain that feeds a
  // NET is the OPPONENT's PROCESSOR (§5.5, §6.1), so "our HP is better than theirs" is a real question
  // a team can ask and a trio comparison cannot answer.
  hp: { blue: { ...HUMAN_PLAYER }, red: { ...HUMAN_PLAYER } },
  geo: layout(),
  match: null,
  frame: 0,
  playing: false,
  fill: false, // the CSS stand-in for fullscreen, used when the host refuses the request
  speed: 1,
  timer: 0,
  raf: 0,
  anchor: null,
};

// HP fields: only `storage` is a rule (G435); the rest are [estimate] rates Stage 3 has to calibrate.
const HP_FIELDS = [
  { key: 'accuracy', label: 'NET throw %', min: 0, max: 100, step: 5, pct: true, title: '§6.5.1: an ALGAE is scored in the NET if it ends above and inside the perimeter and is not touching one of your ROBOTS. The fraction of throws that do is an [estimate].' },
  { key: 'throwSec', label: 'throw s', min: 0.8, max: 8, step: 0.1, title: '[estimate] seconds per NET throw attempt. A miss takes the slot too, so this is the HP throughput limit.' },
  { key: 'feedSec', label: 'chute s', min: 0.3, max: 8, step: 0.1, title: 'G433A: only a HUMAN PLAYER or DRIVER may put CORAL onto the FIELD, through the CORAL STATION. [estimate] seconds between feeds.' },
  { key: 'storage', label: 'area max', min: 1, max: 8, step: 1, title: 'G435: no more than 4 ALGAE stored in a PROCESSOR AREA — 3 in the holders plus 1 at the end of the exit ramp. Anything past that is counted as overflow, not as a foul, because the clause exempts a good-faith HP.' },
];

// ---------------------------------------------------------------------------
// setup panel
// ---------------------------------------------------------------------------
// One number control, used for both the ROBOT specs and the HUMAN PLAYER rates. A percentage is stored
// as a fraction and shown as an integer, because a number input silently rejects "97%" and the field
// comes up blank — which is how `reliability` read as an empty box for a whole build.
function specField(f, get, set) {
  const shown = (v) => (f.pct ? String(Math.round(v * 100)) : String(v));
  // Inverse of `shown`: the browser hands back the digits the user typed, and a percentage field has to
  // be divided on the way into the model.
  const read = (txt) => {
    let v = parseFloat(txt);
    if (!Number.isFinite(v)) v = f.min;
    v = Math.max(f.min, Math.min(f.max, v));
    return f.pct ? v / 100 : v;
  };
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = f.min;
  input.max = f.max;
  input.step = f.step;
  input.value = shown(get());
  input.title = f.title || `${f.label} — an [estimate] ROBOT property, not a rule. R103 caps weight at ${ROBOT_LIMITS.weightLbMax} lb, R104 at ${ROBOT_LIMITS.perimeterInMax} in perimeter and ${ROBOT_LIMITS.heightInMax} in tall.`;
  input.addEventListener('change', () => {
    const v = read(input.value);
    set(v);
    input.value = shown(v);
  });
  const name = document.createElement('span');
  name.textContent = f.label;
  label.append(name);
  label.append(input);
  return label;
}

function rosterCard(side, idx) {
  // trioFor, not state.trios: with the mirror ticked what Red actually drives is Blue's trio, and the cards
  // have to show the machines that are on the carpet rather than the ones parked in the other editor.
  const p = trioFor(side)[idx];
  const wrap = document.createElement('div');
  wrap.className = 'robo';
  const title = document.createElement('div');
  title.className = 'robot-title';
  title.innerHTML = `<b>${p.name}</b><span>#${p.team} · ${Math.round(p.weightLb)} lb</span>`;
  wrap.appendChild(title);
  const specs = document.createElement('div');
  specs.className = 'specs';
  for (const f of SPEC_FIELDS) {
    specs.appendChild(specField(f, () => (f.get ? f.get(p) : p[f.key]), (v) => {
      if (f.set) f.set(p, v);
      else p[f.key] = v;
    }));
  }
  wrap.appendChild(specs);
  const pick = document.createElement('label');
  pick.className = 'pick chassis';
  const ch = document.createElement('select');
  for (const key of Object.keys(CHASSIS)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = key;
    o.title = `${CHASSIS[key].label}: ${CHASSIS_HINT[key]} [estimate] — the manual says nothing about drivetrains.`;
    ch.appendChild(o);
  }
  ch.value = p.chassis;
  ch.addEventListener('change', () => { p.chassis = ch.value; });
  const cap = document.createElement('span');
  cap.textContent = 'drivetrain';
  pick.append(cap, ch);
  wrap.appendChild(pick);
  return wrap;
}

function cageRow(side) {
  const wrap = document.createElement('div');
  for (let i = 0; i < 3; i++) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = i !== 1;
    input.dataset.side = side;
    input.dataset.i = String(i);
    label.append(input);
    const t = document.createElement('span');
    t.textContent = `CAGE ${i + 1} deep`;
    label.append(t);
    label.title = '§6.3.5: a team picks the height of its CAGEs before the match. Deep is 12 points, shallow 6 (§5.4.1, Table 6-2).';
    wrap.appendChild(label);
  }
  return wrap;
}

function hpRow(side) {
  const wrap = document.createElement('div');
  wrap.className = 'specs hp';
  const head = document.createElement('div');
  head.className = 'hp-head';
  head.textContent = 'HUMAN PLAYER';
  head.title = '§6.1: an ALLIANCE scores ALGAE in its own NET, and only gets them from its opponent PROCESSING them. The HP is modelled as a rate and an accuracy, not as a body on the carpet — it cannot be positioned, blocked, or defended.';
  wrap.appendChild(head);
  for (const f of HP_FIELDS) {
    wrap.appendChild(specField(f, () => state.hp[side][f.key], (v) => { state.hp[side][f.key] = v; }));
  }
  return wrap;
}

// Choosing a PRESET replaces one ALLIANCE's three machines wholesale. The cards below it stay the editor for
// whatever is on the field, so the real 2025 alliances can be inspected and then nudged, and the note says
// whose ledger the numbers came from.
function buildPresetSelects() {
  for (const side of ['blue', 'red']) {
    const sel = $(`preset-${side}`);
    sel.innerHTML = '';
    for (const o of PRESET_OPTIONS) {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      op.title = o.note;
      sel.appendChild(op);
    }
    sel.value = side === 'blue' ? 'johnson' : 'newton';
    sel.addEventListener('change', () => applyPreset(side, sel.value));
    $(`preset-note-${side}`).textContent = PRESET_BY_KEY.get(sel.value).note;
  }
  $('chk-mirror').addEventListener('change', (e) => {
    state.mirror = e.target.checked;
    setBatchLabel();
    buildSetup();
  });
  setBatchLabel();
  buildSetup();
}

// A BATCH means two different things depending on the rosters, and the number that comes out is only
// readable if the label says which one ran: with a mirror the mean margin is the field-leak test, with
// two trios it is a ROBOT comparison wearing a strategy label.
function setBatchLabel() {
  const b = $('btn-batch');
  b.textContent = state.mirror ? 'Mirror batch' : 'Batch (2 rosters)';
  b.title = state.mirror
    ? 'Same trio on both ALLIANCES: the mean margin is the field-leak test, not a result'
    : 'Two different trios: the margin is a ROBOT comparison, so read the two means and not the winner';
}

function applyPreset(side, value) {
  const opt = PRESET_OPTIONS.find((o) => o.value === value) || PRESET_OPTIONS[0];
  state.trios[side] = opt.trio.map(clone);
  $(`preset-note-${side}`).textContent = opt.note;
  $(`preset-${side}`).value = opt.value;
  buildSetup();
}

function buildSetup() {
  for (const side of ['blue', 'red']) {
    const roster = $(`roster-${side}`);
    roster.innerHTML = '';
    for (let i = 0; i < 3; i++) roster.appendChild(rosterCard(side, i));
    if (state.mirror && side === 'red') {
      const t = document.createElement('p');
      t.className = 'hint';
      t.textContent = 'Mirror is on: Red runs Blue’s trio, which is what makes a batch a policy comparison instead of a roster comparison.';
      roster.appendChild(t);
    }
    const cages = $(`cages-${side}`);
    cages.innerHTML = '';
    cages.appendChild(cageRow(side));
    const hp = $(`hp-${side}`);
    hp.innerHTML = '';
    hp.appendChild(hpRow(side));
  }
}

function scenarioFromUI() {
  const cageDepth = { blue: [false, false, false], red: [false, false, false] };
  for (const input of document.querySelectorAll('.cages input')) {
    cageDepth[input.dataset.side][Number(input.dataset.i)] = input.checked;
  }
  return {
    cageDepth,
    foulsOff: !$('chk-fouls').checked,
    playoff: !$('chk-qual').checked,
    // Off = no HUMAN PLAYER throws at all: the ablation that prices the whole NET branch of the chain.
    algaeInNetByHuman: $('chk-hp-net').checked,
    humanPlayer: { blue: { ...state.hp.blue }, red: { ...state.hp.red } },
    // The two physics controls, in the same spirit as foulsOff: `turnRampOff` snaps the heading to its
    // target in one tick instead of ramping the spin, and `contactRestitution: -1` keeps the positional
    // separation but drops the bumper impulse, so the momentum exchange can be priced against a control.
    turnRampOff: !$('chk-turn-ramp').checked,
    contactRestitution: $('chk-contact').checked ? undefined : -1,
    // The placement model and the §7.4.4 family, each with the off value the guards read: `placementRisk:
    // false` is the engine that filled every branch every MATCH, `contactFouls: false` is the one that never
    // charges a hit.
    placementRisk: $('chk-place-risk').checked,
    contactFouls: $('chk-contact-fouls').checked,
    // 0 is the deterministic mirror: both ALLIANCES then play one process twice and land on the same
    // number, which is the artefact the field of machines is there to remove.
    tempoJitter: Math.max(0, Math.min(0.6, (parseFloat($('inp-jitter').value, 10) || 0) / 100)),
  };
}

function optsFromUI() {
  return { labels: $('chk-labels').checked, targets: $('chk-targets').checked, numbers: $('chk-numbers').checked, geo: state.geo };
}

// ---------------------------------------------------------------------------
// match + replay
// ---------------------------------------------------------------------------
function setStatus(text, cls) {
  const chip = $('chip-status');
  chip.textContent = text;
  chip.className = 'chip' + (cls ? ' ' + cls : '');
}

function setScrub(frames) {
  const sc = $('rng-scrub');
  sc.max = String(Math.max(0, frames - 1));
  sc.value = '0';
  sc.step = '1';
}

function defendFor(side) {
  const slots = [...document.querySelectorAll(`.defend[data-side="${side}"]`)].filter((i) => i.checked).map((i) => Number(i.dataset.slot));
  return slots.length ? slots : null;
}

function runMatch() {
  const seed = Math.max(1, parseInt($('inp-seed').value, 10) || 1);
  setStatus('Simulating', 'busy');
  const t0 = performance.now();
  const r = playMatch({
    blueKind: $('sel-blue-kind').value,
    redKind: $('sel-red-kind').value,
    seed,
    record: true,
    scenarioOverride: scenarioFromUI(),
    blueProfiles: trioFor('blue'),
    redProfiles: trioFor('red'),
    bluePolicyOpts: { defendSlots: defendFor('blue') },
    redPolicyOpts: { defendSlots: defendFor('red') },
  });
  state.match = r;
  state.frame = 0;
  stop();
  setScrub(r.frames.length);
  buildScrubMarks(r.events);
  renderRobotsTable(r.final);
  renderInventoryTable(r.final);
  renderScoreDetail();
  renderEventList(r.events);
  renderPlanLog(r);
  paintFrame();
  setStatus(`seed ${seed} · ${Math.round(performance.now() - t0)} ms · ${r.frames.length} frames`, 'done');
}

// state.frame is a float because playback advances by elapsed time, not by ticks. Indexing the frame
// array with 12.5 returns undefined, which threw inside the very first paint after pressing Play and
// left the field frozen with no visible error.
function frameAt(i) {
  const n = state.match.frames.length;
  return state.match.frames[Math.max(0, Math.min(n - 1, Math.floor(i)))];
}

// Frames are written every 0.2 s of match time, so drawing one of them as-is is a 5 fps field. The
// 2026 build interpolates between the two bracketing frames and it shows, which is the whole difference
// between "scrubbing a slideshow" and "watching a match": positions and heading are lerped, and the
// discrete stuff (score, branch occupancy, who is holding what) stays on the earlier frame because an
// element is either scored or it is not.
function interpFrame(i) {
  const fl = state.match.frames;
  const n = fl.length;
  const k = Math.max(0, Math.min(n - 1, Math.floor(i)));
  const a = fl[k];
  const b = fl[Math.min(n - 1, k + 1)];
  const frac = Math.max(0, Math.min(1, i - k));
  if (!b || b === a || frac <= 0) return a;
  const robots = a.robots.map((r0, j) => {
    const r1 = b.robots[j];
    if (!r1 || r1.side !== r0.side || r1.slot !== r0.slot) return r0;
    let dh = r1.heading - r0.heading;
    while (dh > 180) dh -= 360;
    while (dh < -180) dh += 360;
    return { ...r0, x: r0.x + (r1.x - r0.x) * frac, y: r0.y + (r1.y - r0.y) * frac, heading: r0.heading + dh * frac };
  });
  return { ...a, robots, t: a.t + (b.t - a.t) * frac };
}

// The field is 690 x 317 in with a 26 in margin, and the canvas keeps that ratio. The backing store is
// set from the displayed box times devicePixelRatio, so a branch dot is drawn at the size it is shown.
const CANVAS_RATIO = (FIELD.longIn + 52) / (FIELD.wideIn + 52);

// In the immersive layouts the canvas cannot be sized by percentage: the wrap's flex height depends on the
// canvas and the canvas's height depends on the wrap, and the cycle resolves to the bitmap's own height — a
// picture taller than the panel, with the REEFs and the BARGE running off the bottom of the screen. So the
// wrap (`flex-basis: 0`) is measured as the space that is actually left over, and the canvas is given an
// explicit pixel box inside it. Same construction as the 2026 page's `fieldBox()`.
function sizeCanvas() {
  const c = $('field');
  const immersive = state.fill || !!document.fullscreenElement;
  const box = immersive
    ? document.querySelector('.canvas-wrap').getBoundingClientRect()
    : c.getBoundingClientRect();
  // No floor on the leftover height: a box smaller than the picture needs is the host being small (a narrow
  // preview panel), and a minimum here would put the canvas back outside its wrap and crop the field again.
  const cssW = Math.min(box.width, box.height * CANVAS_RATIO);
  if (!cssW) return;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = Math.round(cssW * dpr);
  const h = Math.round(w / CANVAS_RATIO);
  if (immersive) {
    const shown = `${Math.round(cssW)}px`;
    if (c.style.width !== shown) c.style.width = shown;
    const tall = `${Math.round(cssW / CANVAS_RATIO)}px`;
    if (c.style.height !== tall) c.style.height = tall;
  } else if (c.style.width) {
    c.style.width = '';
    c.style.height = '';
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

function paintFrame() {
  const m = state.match;
  if (!m) return;
  const f = interpFrame(state.frame);
  sizeCanvas();
  const ctx = $('field').getContext('2d');
  drawField(ctx, f, optsFromUI());
  const secs = f.t;
  const left = Math.max(0, TIME.matchSec - secs);
  $('timer-label').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  $('period-label').textContent = f.period === 'AUTO' ? 'AUTONOMOUS' : secs >= TIME.matchSec ? 'CAGE ASSESSMENT' : 'TELEOP';
  for (const side of ['blue', 'red']) {
    // The scoreboard number is the LIVE one: `f.score` is what that ALLIANCE has banked by this frame, so
    // scrubbing back to 0:40 reads 0. The itemised ledger under the field is the finished MATCH's, and the
    // two are deliberately different numbers.
    $(`score-${side}`).textContent = String(f.score[side]);
    const live = $(`sd-live-${side}`);
    if (live) live.textContent = String(f.score[side]);
    const teams = trioFor(side).map((p) => p.team).join(' / ');
    $(`teams-${side}`).textContent = teams;
  }
  const d = f.score.blue - f.score.red;
  $('margin-label').textContent = d === 0 ? 'tied' : `${d > 0 ? 'blue' : 'red'} +${Math.abs(d)}`;
  // The loose pieces are the part of the stock a viewer could not otherwise see: §6.3.4.1 A puts a CORAL on
  // each of the six MARKS and §6.3.4.2 B an ALGAE on top, and anything a ROBOT fumbles or lets go of while
  // climbing lands on the carpet too. They are gone from the picture inside AUTO at the shipped tempos, so
  // without this line the field reads as if it were never staged.
  const loose = (side) => f.floor.filter((p) => p.side === side);
  const free = (side) => {
    const q = f.reef[side];
    const L = loose(side);
    const carpet = L.length ? ` · CARPET ${L.filter((p) => p.kind === 'coral').length}C/${L.filter((p) => p.kind === 'algae').length}A` : '';
    return ['L2', 'L3', 'L4'].map((lv) => `${lv} ${BRANCH_SLOTS_PER_LEVEL - q[lv]}`).join(' · ') + ` · L1 ${TROUGH_CAP - q.trough} · ALGAE ${q.algae} · HP ${f.hpQueue[side]}/${state.hp[side].storage}` + carpet;
  };
  const strip = $('inventory-strip');
  strip.innerHTML = '';
  for (const side of ['blue', 'red']) {
    const label = document.createElement('span');
    label.className = 'inv-label ' + side;
    label.textContent = side.toUpperCase();
    const val = document.createElement('b');
    val.textContent = free(side);
    strip.append(label, val);
  }
  $('rng-scrub').value = String(Math.floor(state.frame));
  paintFoulStrip(f.t);
}

function paintFoulStrip(untilT) {
  const strip = $('foul-strip');
  strip.innerHTML = '';
  if (!state.match) return;
  for (const e of state.match.events) {
    if (e.kind !== 'foul' || e.t > untilT) continue;
    const chip = document.createElement('span');
    chip.className = 'foul';
    chip.textContent = `${e.t.toFixed(1)}s ${e.side[0].toUpperCase()}${e.slot + 1} ${e.code} ${e.sev === 'major' ? 'MAJOR +6' : 'MINOR +2'}`;
    strip.appendChild(chip);
  }
}

// A frame is written every 0.2 s of match time, so 1x is 5 frames per real second.
const FRAMES_PER_SEC = 5;
const HIDDEN_TICK_MS = 50;

function advance() {
  if (!state.playing || !state.match) return;
  const secs = (performance.now() - state.anchor.now) / 1000;
  state.frame = Math.min(state.match.frames.length - 1, state.anchor.frame + secs * FRAMES_PER_SEC * state.speed);
  paintFrame();
  if (state.frame >= state.match.frames.length - 1) stop();
}

function play() {
  if (!state.match) runMatch();
  if (state.frame >= state.match.frames.length - 1) state.frame = 0; // a finished match replays from 0:00
  state.playing = true;
  $('btn-play').textContent = 'Pause';
  state.anchor = { now: performance.now(), frame: state.frame };
  // requestAnimationFrame runs at the display rate, which is what makes the replay read as continuous,
  // but the delivery preview hosts the page as a background surface where rAF never fires at all. Both
  // clocks call the same wall-time advance, so it is smooth in a tab and still moves in the panel.
  clearInterval(state.timer);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  if (document.visibilityState === 'visible') {
    const loop = () => {
      if (!state.playing) return;
      advance();
      state.raf = requestAnimationFrame(loop);
    };
    state.raf = requestAnimationFrame(loop);
  } else {
    state.timer = setInterval(advance, HIDDEN_TICK_MS);
  }
}

function stop() {
  state.playing = false;
  $('btn-play').textContent = 'Play';
  clearInterval(state.timer);
  state.timer = 0;
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
}

function stepTo(kind) {
  if (!state.match) return;
  const times = state.match.events.filter((e) => e.kind === kind || e.kind === 'climb' || e.kind === 'fumble' || e.kind === 'drop').map((e) => e.t);
  const cur = frameAt(state.frame).t;
  const i = kind === 'prev' ? times.filter((t) => t < cur - 0.25).pop() : times.find((t) => t > cur + 0.05);
  if (i === undefined) return;
  state.frame = Math.round(i / 0.2);
  paintFrame();
}

function buildScrubMarks(events) {
  const wrap = $('scrub-marks');
  wrap.innerHTML = '';
  const span = TIME.matchSec;
  for (const e of events) {
    // A CORAL that fell off a BRANCH is the fault the carpet shows, so the scrubber marks it: the pieces are
    // on the ground for about a second each, and without a mark to jump to there is no way to stop on one.
    if (e.kind !== 'foul' && e.kind !== 'climb' && e.kind !== 'fumble' && e.kind !== 'drop') continue;
    const i = document.createElement('i');
    i.className = e.kind === 'foul' ? '' : e.kind;
    i.style.left = `min(${(e.t / span) * 100}%, calc(100% - 2px))`;
    i.title = `${e.t.toFixed(1)}s ${e.kind}${e.code ? ' ' + e.code : ''}`;
    wrap.appendChild(i);
  }
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------
// The detailed ledger, under the field. Table 6-2 pays six separate columns and the AUTO and TELEOP values
// for CORAL differ, so a single line under the score box could not show WHICH exchange was won — only that
// one alliance had more points. The big number in the scoreboard stays live with the scrubber; this block is
// the scored MATCH as the ledger reads it.
function renderScoreDetail() {
  const m = state.match;
  const out = $('score-detail');
  out.innerHTML = '';
  if (!m) return;
  for (const side of ['blue', 'red']) {
    const s = m.final[side];
    const col = document.createElement('div');
    col.className = 'sd-col ' + side;
    const head = document.createElement('h4');
    head.innerHTML = `<span class="sd-side">${side}</span><b class="sd-live" id="sd-live-${side}">0</b>`;
    col.appendChild(head);
    const coralPieces = ['L1', 'L2', 'L3', 'L4'].reduce((a, lv) => a + s.coral[lv].auto + s.coral[lv].tele, 0);
    const algaePieces = s.algae.processor + s.algae.net;
    const rows = [
      ['CORAL', `${coralPieces} · ${s.coralPoints} pts`, ['L4', 'L3', 'L2', 'L1'].map((lv) => `${lv} ${s.coral[lv].auto}A/${s.coral[lv].tele}T`).join(' ')],
      ['ALGAE', `${algaePieces} · ${s.algaePoints} pts`, `PROC ${s.algae.processor} × ${POINTS.algae.processor[1]} · NET ${s.algae.net} × ${POINTS.algae.net[1]} (${s.algae.netByRobot} lifted in by a ROBOT, §6.1)`],
      ['LEAVE', `${s.leaveCount}/3 · ${s.leave} pts`, 'judged on the AUTO→TELEOP boundary (§6.5.2)'],
      ['BARGE', `${s.bargePoints} pts`, `DEEP ${s.barge.deep} · SHALLOW ${s.barge.shallow} · PARK ${s.barge.park}`],
      ['COOPERTITION', `${s.coopertition} pts`, s.coop ? '≥2 ALGAE in each PROCESSOR (§6.5.3)' : 'not met'],
      ['FOULS', `+${s.fouls} pts`, 'the opponent\'s MINOR are 2 and MAJOR are 6 (Table 6-3)'],
      ['RP', `${s.rp.auto + s.rp.coral + s.rp.barge + s.rp.win + s.rp.tie} pts-worth`, `AUTO ${s.rp.auto} · CORAL ${s.rp.coral} · BARGE ${s.rp.barge}`],
    ];
    for (const [k, v, sub] of rows) {
      const r = document.createElement('div');
      r.className = 'sd-row';
      const label = document.createElement('span');
      label.className = 'sd-k';
      label.textContent = k;
      const value = document.createElement('b');
      value.textContent = v;
      r.append(label, value);
      if (sub) {
        const s2 = document.createElement('span');
        s2.className = 'sd-sub';
        s2.textContent = sub;
        r.appendChild(s2);
      }
      col.appendChild(r);
    }
    const total = document.createElement('div');
    total.className = 'sd-row sd-final';
    total.innerHTML = `<span class="sd-k">TOTAL</span><b>${s.total}</b><span class="sd-sub">the final number, not the live one</span>`;
    col.appendChild(total);
    out.appendChild(col);
  }
}

function renderInventoryTable(final) {
  const t = $('tbl-inventory');
  t.innerHTML = '';
  const head = document.createElement('tr');
  for (const h of ['level', 'blue AUTO', 'blue TELE', 'free', 'red AUTO', 'red TELE', 'free']) {
    const th = document.createElement('th');
    th.textContent = h;
    if (h !== 'level') th.className = 'mono';
    head.appendChild(th);
  }
  t.appendChild(head);
  const cap = { L1: TROUGH_CAP, L2: BRANCH_SLOTS_PER_LEVEL, L3: BRANCH_SLOTS_PER_LEVEL, L4: BRANCH_SLOTS_PER_LEVEL };
  for (const lv of ['L1', 'L2', 'L3', 'L4']) {
    const tr = document.createElement('tr');
    const mk = (txt, mono) => {
      const td = document.createElement('td');
      td.textContent = txt;
      if (mono) td.className = 'mono';
      return td;
    };
    tr.appendChild(mk(`${lv} (${lv === 'L1' ? 'trough' : cap[lv] + ' branches'})`));
    for (const side of ['blue', 'red']) {
      tr.appendChild(mk(String(final[side].coral[lv].auto), true));
      tr.appendChild(mk(String(final[side].coral[lv].tele), true));
      tr.appendChild(mk(String(cap[lv] - final[side].coral[lv].auto - final[side].coral[lv].tele), true));
    }
    t.appendChild(tr);
  }
  const rpRow = document.createElement('tr');
  const mkCell = (txt) => {
    const td = document.createElement('td');
    td.className = 'mono';
    td.textContent = txt;
    return td;
  };
  rpRow.appendChild(mkCell('RP'));
  for (const side of ['blue', 'red']) {
    const s = final[side];
    rpRow.appendChild(mkCell(String(s.rp.auto)));
    rpRow.appendChild(mkCell(String(s.rp.coral)));
    rpRow.appendChild(mkCell(`barge ${s.rp.barge} · coop ${s.coopertition}`));
  }
  t.appendChild(rpRow);
  // The two deny actions move no score column of their own: a CORAL out of the opponent's STATION never gets
  // counted as anything, and an ALGAE taken off their REEF shows up only as their column coming up short.
  // Without this row a match reads "0 steals" as if the action did not exist, when the honest reading is that
  // the trip across the BARGE is never the shorter bid — `npm run measure`'s deny arms put the number that
  // does move it: one machine already over there pressing takes 2.8 CORAL a MATCH.
  const denyRow = document.createElement('tr');
  denyRow.appendChild(mkCell('DENIAL'));
  for (const side of ['blue', 'red']) {
    const d = final[side].deny || { station: 0, theirAlgae: 0 };
    const td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'mono';
    td.textContent = `their STATION ${d.station} · their REEF ALGAE ${d.theirAlgae}`;
    td.title = 'CORAL taken out of the opponent\'s CORAL STATION, and ALGAE stripped off their REEF. Neither scores by itself — they only keep the other ALLIANCE from scoring, which is why no column carries them. 0 in an ordinary MATCH is a measured outcome, not a missing action: the station trip is 677 in across the FIELD, so it loses the bid to the machine\'s own corner unless it is already over there. Tick DEFEND and the press does.';
    denyRow.appendChild(td);
  }
  t.appendChild(denyRow);
}

function renderRobotsTable(final) {
  const t = $('tbl-robots');
  t.innerHTML = '';
  const head = document.createElement('tr');
  for (const h of ['ROBOT', 'CORAL L1/2/3/4', 'ALGAE', 'picks', 'climb', 'fouls']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  t.appendChild(head);
  for (const side of ['blue', 'red']) {
    for (const r of final[side].robots) {
      const tr = document.createElement('tr');
      const p = r.placed;
      const fouls = Object.entries(r.fouls || {}).map(([k, v]) => `${k}×${v}`).join(' ');
      const cells = [
        `${side === 'blue' ? 'B' : 'R'}${r.slot + 1} #${r.team} · ${r.tempo}×`,
        // A CORAL that fell off is not a miss of the same kind as a fumble: §6.5.1's BRANCH test failed, so
        // the column is next to the levels it was aimed at rather than hidden in the picks count.
        `${p.L1}/${p.L2}/${p.L3}/${p.L4}${r.dropped ? ` · ${r.dropped} fell` : ''}`,
        `${r.processor} proc${r.netScored ? ` / ${r.netScored} NET` : ''} / ${r.strips} strip${r.defend ? ` / ${Math.round(r.defend)}s defend` : ''}`,
        String(r.picked + r.strips),
        r.climb ? `${r.climb} C${r.climbCage + 1}` : r.left ? 'left' : '—',
        fouls || '—',
      ];
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (i > 0) td.className = 'mono';
        tr.appendChild(td);
      });
      t.appendChild(tr);
    }
  }
}

function renderEventList(events) {
  const box = $('events');
  box.innerHTML = '';
  const keep = events.filter((e) => e.kind !== 'place' || e.auto);
  const rows = keep.slice(-90);
  const LABEL = {
    net: 'NET +4',
    netMiss: 'NET miss',
    overflow: 'AREA FULL (G435)',
    processor: 'PROC +6',
    leave: 'LEAVE',
    unstick: 'backed out of a pile-up',
    drop: (e) => `CORAL ${e.level} fell off (${e.aimErr}° off the BRANCH)`,
  };
  for (const e of rows) {
    const line = document.createElement('div');
    const who = e.side ? `${e.side[0].toUpperCase()}${(e.slot ?? 0) + 1}` : '';
    const label = e.kind === 'place' ? `CORAL ${e.level} in AUTO` : e.kind === 'climb' ? `CAGE ${e.level}` : e.kind === 'foul' ? `${e.code} ${e.sev}${e.card === 'RED' ? ' + RED CARD, out for the MATCH' : e.card === 'YELLOW' ? ' + YELLOW' : ''}` : e.kind === 'fumble' ? `dropped ${e.intent}` : e.kind === 'net' ? (e.by === 'robot' ? 'NET +4 lifted in by the ROBOT' : 'NET +4 thrown') : typeof LABEL[e.kind] === 'function' ? LABEL[e.kind](e) : LABEL[e.kind] || e.kind;
    line.innerHTML = `<b>${e.t.toFixed(1)}s</b> ${who} ${label}`;
    box.appendChild(line);
  }
}

// What the Planner decided, as opposed to what it scored: the commit time it settled on, when it first
// moved off the opening plan, and the fleet pace it measured to plan against. Without this the difference
// between "planning" and "a rule I typed in" is invisible on the page.
function renderPlanLog(r) {
  const out = $('plan-out');
  out.innerHTML = '';
  // An imported file carries frames and a ledger, not the policies that made them, so the rail has to say so
  // rather than keep the cards from whatever MATCH was running before the import.
  const planning = r.policies ? [['blue', r.policies.blue], ['red', r.policies.red]].filter(([, p]) => p && p.kind === 'ai') : [];
  if (!planning.length) {
    out.innerHTML = r.policies
      ? '<p class="hint">Neither ALLIANCE is planning this MATCH — pick <b>Planner</b> under Baseline.</p>'
      : '<p class="hint">This MATCH was imported, so the file carries no plan to show — only what it scored.</p>';
    return;
  }
  for (const [side, p] of planning) {
    const list = p.planLog;
    const switches = list.filter((e) => e.switchTo);
    const last = list[list.length - 1];
    // The duty is on the card because the planner now decides it: the model prices the trip to their REEF in
    // seconds and in the fouls it brings back, so "nobody" is an answer rather than an absence of a question.
    const byEvent = list.filter((e) => e.why === 'capacity').length;
    const pin = p.plan.pins;
    const endgame = pin.cutoff > 0 ? `a cycle needs ${pin.cutoff} s of clock to spare${pin.spend ? ', and the hopper is spent before the CAGE' : ''}` : 'no clock budget on a cycle';
    const claim = pin.claim > 0 ? `a piece a teammate is bound for costs ${pin.claim.toFixed(2)} s of drive` : 'every machine bids the nearest piece';
    out.appendChild(card(`${side} commit window`, `${p.plan.climbWindowSec} s of MATCH left`, `ALGAE duty: ${p.plan.algaeSlots ? `machine ${p.plan.algaeSlots.join(' and ')}` : 'nobody — the model prices the crossing'} · CORAL STATIONs: ${p.plan.spread ? 'split, both pockets worked' : 'all three at the nearer one'} · aiming ${p.plan.placeOrder.join('/')} · ${endgame} · ${claim} · ${list.length} re-solves through TELEOP${byEvent ? `, ${byEvent} of them after the fleet lost a machine` : ''}`));
    out.appendChild(card(`${side} first move`, switches.length ? `t = ${switches[0].t.toFixed(0)} s → ${switches[0].switchTo} s` : 'never moved', switches.length ? `the model expected +${switches[0].gain.toFixed(1)} points against the opening plan` : 'no plan ever beat the opening one by more than the churn allowance'));
    out.appendChild(card(`${side} fleet pace`, `${p.plan.efficiency.toFixed(2)}× the straight-line cycle`, last ? `at t = ${last.t.toFixed(0)} s the REEF still had ${last.free} slots · ${switches.length} switch${switches.length === 1 ? '' : 'es'}` : 'planned once'));
  }
}

// ---------------------------------------------------------------------------
// batch measurements
// ---------------------------------------------------------------------------
function card(k, v, n) {
  const d = document.createElement('div');
  d.className = 'card';
  d.innerHTML = `<div class="k"></div><div class="v"></div><div class="n"></div>`;
  d.querySelector('.k').textContent = k;
  d.querySelector('.v').textContent = v;
  d.querySelector('.n').textContent = n;
  return d;
}

function batch(kind) {
  const out = $('batch-out');
  const matches = kind === 'mirror' ? 48 : 24;
  setStatus(`Running ${matches} MATCHes`, 'busy');
  const base = 1000 + Math.floor(Math.random() * 9000);
  const blueKind = $('sel-blue-kind').value;
  const redKind = kind === 'bench' ? 'random' : $('sel-red-kind').value;
  const t0 = performance.now();
  const e = evaluate({
    blueKind,
    redKind,
    matches,
    seedBase: base,
    profiles: { blue: trioFor('blue'), red: trioFor('red') },
    scenarioOverride: scenarioFromUI(),
    bluePolicyOpts: { defendSlots: defendFor('blue') },
    redPolicyOpts: { defendSlots: defendFor('red') },
  });
  out.innerHTML = '';
  const meanSe = (a, b) => `${a.toFixed(1)} ± ${b.toFixed(1)}`;
  const rosters = state.mirror ? `${trioFor('blue')[0].name} trio on both ALLIANCES` : `${$('preset-blue').value} blue vs ${$('preset-red').value} red`;
  out.appendChild(card(kind === 'bench' ? 'Greedy (blue) mean' : 'Blue mean', meanSe(e.avgBlue, e.blueSe), `n=${matches} MATCHes, seedBase ${base}, ${rosters}`));
  out.appendChild(card('Red mean', meanSe(e.avgRed, e.redSe), rosters));
  out.appendChild(card('Margin', meanSe(e.avgMargin, e.marginSe), state.mirror ? (e.marginSe > 0.5 ? 'blue minus red; a mirror margin is the field-leak test' : 'indistinguishable from zero') : 'blue minus red across two trios: a ROBOT comparison, not a leak'));
  out.appendChild(card('Blue win rate', `${(e.winRate * 100).toFixed(1)} ± ${(e.winSe * 100).toFixed(1)}%`, `${e.blueWins}W ${e.ties}T of ${matches}`));
  out.appendChild(card('RP mean', `${e.avgRpBlue.toFixed(2)} / ${e.avgRpRed.toFixed(2)}`, 'auto + coral + barge + win/tie'));
  setStatus(`${Math.round(performance.now() - t0)} ms · ${matches} MATCHes`, 'done');
}

// ---------------------------------------------------------------------------
// rule tables
// ---------------------------------------------------------------------------
function buildRuleTables() {
  const pts = $('tbl-points');
  const rows = [
    ['element', 'AUTO', 'TELEOP', 'clause'],
    ['LEAVE', POINTS.leave, '—', 'Table 6-2'],
    ['CORAL trough L1', POINTS.coral.L1[0], POINTS.coral.L1[1], 'Table 6-2'],
    ['CORAL L2 branch', POINTS.coral.L2[0], POINTS.coral.L2[1], 'Table 6-2'],
    ['CORAL L3 branch', POINTS.coral.L3[0], POINTS.coral.L3[1], 'Table 6-2'],
    ['CORAL L4 branch', POINTS.coral.L4[0], POINTS.coral.L4[1], 'Table 6-2'],
    ['ALGAE processor', POINTS.algae.processor[0], POINTS.algae.processor[1], 'Table 6-2'],
    ['ALGAE net', POINTS.algae.net[0], POINTS.algae.net[1], 'Table 6-2'],
    ['PARK', '—', POINTS.park, 'Table 6-2'],
    ['CAGE shallow', '—', POINTS.cageShallow, 'Table 6-2'],
    ['CAGE deep', '—', POINTS.cageDeep, 'Table 6-2'],
    ['Coopertition point', '—', POINTS.coopertition, '§6.5.3 (a point, not an RP)'],
    ['AUTO RP', '—', `1 if all LEAVE + ${POINTS.autoRpMinCoral} CORAL`, 'Table 6-2'],
    ['CORAL RP', '—', `${POINTS.coralRpThresholdPerLevel}/level ×4, or ×3 with coop`, 'Table 6-2'],
    ['BARGE RP', '—', `≥${POINTS.bargeRpThreshold} BARGE points`, 'Table 6-2'],
    ['Win / tie', '—', `${POINTS.rp.win} / ${POINTS.rp.tie}`, 'Table 6-2'],
  ];
  fillTable(pts, rows);

  const arena = $('tbl-arena');
  fillTable(arena, [
    ['element', 'size', 'clause'],
    ['FIELD', `${FIELD.longIn} × ${FIELD.wideIn} in`, '§5.1'],
    ['REEF', `${GEO.reef.hexAcrossFlatsIn} in hexagon, ${GEO.reef.branchesPerLevel} branches per level`, '§5.3'],
    ['branch heights', `L1 ${GEO.reef.heightIn.L1} · L2 ${GEO.reef.heightIn.L2} · L3 ${GEO.reef.heightIn.L3} · L4 ${GEO.reef.heightIn.L4} in`, '§5.3'],
    ['REEF ZONE', `${GEO.reefZone.acrossFlatsIn} in across flats`, '§5'],
    ['BARGE', `${GEO.barge.widthIn} × ${GEO.barge.depthIn} × ${GEO.barge.heightIn} in, truss ${GEO.barge.trussHeightIn} in`, '§5.4'],
    ['CAGE', `${GEO.cage.heightIn} × ${GEO.cage.widthIn} in, shallow ${GEO.cage.shallowBottomIn} in, deep ${GEO.cage.deepBottomIn} in`, '§5.4.1'],
    ['NET', `4 ft × 12 ft mesh off the top of the BARGE, low point ${GEO.net.lowPointIn} in, 1 per ALLIANCE`, '§5.4.2'],
    ['PROCESSOR', `${GEO.processor.openingWidthIn} × ${GEO.processor.openingHeightIn} in, sill ${GEO.processor.sillIn} in`, '§5.5'],
    ['PROCESSOR AREA', `${GEO.processorArea.widthIn} × ${GEO.processorArea.depthIn} in, holds ≤${HUMAN_PLAYER.storage} ALGAE`, '§5, G435'],
    ['CORAL STATION', `opening ${GEO.coralStation.openingWidthIn} × ${GEO.coralStation.openingHeightIn} in, 4 total`, '§5.6.2'],
    ['CORAL', `${PIECES.coral.lengthIn} in × ${PIECES.coral.diameterIn} in, ${PIECES.coral.stagedPerMatch} per MATCH`, '§5.7.1, §6.3.4.1'],
    ['ALGAE', `${PIECES.algae.diameterIn[0]} in dia, ${PIECES.algae.stagedPerMatch} per MATCH (${PIECES.algae.onReef} on the REEFs, ${PIECES.algae.onCoralMarks} on the marks)`, '§5.7.2, §6.3.4.2'],
    ['carry limit', `${PIECES.carryLimit.coral} CORAL + ${PIECES.carryLimit.algae} ALGAE`, 'G409'],
    ['ROBOT limits', `${ROBOT_LIMITS.weightLbMax} lb, ${ROBOT_LIMITS.perimeterInMax} in perimeter, ${ROBOT_LIMITS.heightInMax} in tall`, 'R103, R104'],
    ['clock', `AUTO ${TIME.autoSec} s, TELEOP ${TIME.teleopSec} s, CAGE assessment +${TIME.cageAssessAfterSec} s`, '§6.4, §6.5'],
  ]);

  const f = $('tbl-fouls');
  const BY = { charge: 'charged', block: 'blocked by the action set', none: 'no action for it yet' };
  const frows = [['clause', 'what', 'foul', 'in this build']];
  for (const [code, rule] of Object.entries(FOULS.list)) {
    frows.push([code, rule.what, `${rule.sev === 'major' ? FOULS.major : FOULS.minor} pts${rule.awards ? ' + ' + rule.awards.toUpperCase() + ' RP' : ''}`, BY[rule.by] || rule.by]);
  }
  fillTable(f, frows);
}

function fillTable(el, rows) {
  el.innerHTML = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    r.forEach((c, j) => {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      cell.textContent = String(c);
      if (i > 0 && j > 0 && j === r.length - 1) cell.className = 'mono';
      tr.appendChild(cell);
    });
    el.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
// export / import, keys
// ---------------------------------------------------------------------------
function exportMatch() {
  if (!state.match) return;
  const blob = new Blob([JSON.stringify({ kind: 'reefscape', profiles: { blue: trioFor('blue'), red: trioFor('red') }, scenario: state.match.scenario, frames: state.match.frames, events: state.match.events, final: state.match.final }, null, 0)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reefscape-${state.match.scenario.seed}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importMatch(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(String(fr.result));
      if (!d.frames || !d.final) throw new Error('not a match file');
      state.match = d;
      state.frame = 0;
      setScrub(d.frames.length);
      buildScrubMarks(d.events || []);
      renderRobotsTable(d.final);
      renderInventoryTable(d.final);
      renderScoreDetail();
      renderEventList(d.events || []);
      renderPlanLog(d);
      paintFrame();
      setStatus(`imported ${d.frames.length} frames`, 'done');
    } catch (err) {
      setStatus('import failed: ' + err.message, 'busy');
    }
  };
  fr.readAsText(file);
}

// Fullscreen is a request, not a guarantee: an embedded preview panel rejects it with "Permissions check
// failed", and a rejected promise nobody looks at is exactly a button that does nothing. `body.fill` is the
// same layout without the browser chrome disappearing, so the control always has a visible effect and the
// Esc key still means "leave".
function setFill(on) {
  state.fill = on;
  document.body.classList.toggle('fill', on);
  // The button is the only way back for anyone who cannot use the keyboard, so it has to read as a toggle
  // in the fallback layout too — not just once true fullscreen reports fullscreenchange.
  const btn = $('btn-fs');
  if (btn) btn.textContent = on || document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  requestAnimationFrame(paintFrame);
}

function toggleFullscreen() {
  const panel = document.querySelector('.field-panel');
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (state.fill) {
    setFill(false);
  } else if (panel.requestFullscreen) {
    panel.requestFullscreen({ navigationUI: 'hide' }).catch(() => setFill(true));
  } else {
    setFill(true);
  }
}

function keys(ev) {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  // Esc leaves the fill layout whether or not a MATCH has been run, so it is handled before the
  // "nothing to navigate yet" guard below.
  if (ev.key === 'Escape' && state.fill) {
    setFill(false);
    return;
  }
  const n = state.match ? state.match.frames.length : 0;
  if (!n) return;
  const jump = (i) => {
    state.frame = Math.max(0, Math.min(n - 1, i));
    paintFrame();
  };
  const map = {
    ' ': () => (state.playing ? stop() : play()),
    '[': () => stepTo('prev'),
    ']': () => stepTo('next'),
    Home: () => jump(0),
    End: () => jump(n - 1),
    ArrowLeft: () => jump(state.frame - 5),
    ArrowRight: () => jump(state.frame + 5),
    f: toggleFullscreen,
  };
  const fn = map[ev.key];
  if (fn) {
    ev.preventDefault();
    fn();
  }
}

function bind() {
  $('btn-run').addEventListener('click', () => {
    runMatch();
    play();
  });
  $('btn-new').addEventListener('click', () => {
    $('inp-seed').value = String(1 + Math.floor(Math.random() * 999999));
    runMatch();
    play();
  });
  $('btn-batch').addEventListener('click', () => batch('mirror'));
  $('btn-bench').addEventListener('click', () => batch('bench'));
  $('btn-play').addEventListener('click', () => (state.playing ? stop() : play()));
  $('btn-ev-prev').addEventListener('click', () => stepTo('prev'));
  $('btn-ev-next').addEventListener('click', () => stepTo('next'));
  $('btn-export').addEventListener('click', exportMatch);
  $('btn-import').addEventListener('click', () => $('inp-import').click());
  $('inp-import').addEventListener('change', (e) => e.target.files[0] && importMatch(e.target.files[0]));
  $('btn-fs').addEventListener('click', toggleFullscreen);
  // The browser owns leaving true fullscreen (its own Esc), and nothing else tells the page, so the label
  // and the repaint have to follow that event. setFill owns the label so the two cannot disagree.
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) $('btn-fs').textContent = 'Exit fullscreen';
    else setFill(false);
    requestAnimationFrame(paintFrame);
  });
  $('sel-speed').addEventListener('change', (e) => {
    state.speed = parseFloat(e.target.value);
  });
  // One delegated handler for the rail: a tab is a display change, not a new run, so nothing here may
  // touch the MATCH. The topbar buttons are the same control from the other end of the page.
  const showTab = (name) => {
    for (const t of document.querySelectorAll('.tabs .tab')) t.classList.toggle('active', t.dataset.tab === name);
    for (const b of document.querySelectorAll('.tab-body')) b.hidden = b.id !== `tab-${name}`;
  };
  for (const t of document.querySelectorAll('.tabs .tab')) {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  }
  $('btn-tab-rules').addEventListener('click', () => showTab('rules'));
  $('btn-tab-data').addEventListener('click', () => showTab('data'));
  $('rng-scrub').addEventListener('input', (e) => {
    stop();
    state.frame = Number(e.target.value);
    paintFrame();
  });
  for (const id of ['chk-labels', 'chk-targets', 'chk-numbers']) $(id).addEventListener('change', paintFrame);
  window.addEventListener('resize', paintFrame);
  // The panel can turn into a real tab mid-playback; re-enter the loop so it picks up the display clock.
  document.addEventListener('visibilitychange', () => {
    if (state.playing) play();
  });
  document.addEventListener('keydown', keys);
}

buildPresetSelects();
buildRuleTables();
bind();
// A match on load: the page should never present an empty canvas, and the first number a visitor sees
// should be one the current build actually produced.
runMatch();
paintFrame();
