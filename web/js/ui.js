// Page wiring: settings -> engine -> replay. Nothing here models the game; it only moves data between
// web/js/engine.js and the DOM, and keeps the two rules of this repo visible (n and the error bar, and
// which numbers are rules).

import { playMatch, aggregate, matchSeed } from './league.js';
import { HUMAN_PLAYER, CHASSIS, PRESETS, ROBOT_PRESETS, presetIndexOf } from './model.js';
import { layout } from './model.js';
import { drawField } from './viz.js';
import { POINTS, GEO, FOULS, PIECES, TIME, FIELD, ROBOT_LIMITS } from './rules.js';
import { BRANCH_SLOTS_PER_LEVEL, TROUGH_CAP, CARRY_DROP_PER_SEC } from './model.js';

const $ = (id) => document.getElementById(id);

const PRESET_BY_KEY = new Map(PRESETS.map((p) => [p.key, p]));
// The two sides default to the pair that played the 2025 Einstein Field final, and each of the six machines
// can then be swapped per slot from the card. The mirror is a checkbox rather than a preset: it is a statement
// about what the BATCH means (strategy vs strategy) and not about which machines are on the carpet.

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
  fill: false, // the Fill layout (button, key C): the FIELD takes the page and the browser chrome stays
  speed: 1,
  timer: 0,
  raf: 0,
  anchor: null,
  // The previous batch is kept so the next one can be read as a change rather than as four fresh numbers,
  // and a settings snapshot is kept with it because two batches only mean "the effect of one change" while
  // everything else stayed put.
  prevBatch: null,
  batch: null,
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

// The small word in front of a card's dropdowns ("drivetrain", "preset"). Both pickers need one and the label
// element is the only place the layout is decided.
const capText = (txt) => {
  const s = document.createElement('span');
  s.textContent = txt;
  return s;
};

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
  // One preset per ROBOT, the way the 2026 page does it: a team fields its own three machines, so the choice
  // is made at each slot and editing one number does not touch the other two. The card shows the machine it is
  // showing — "Custom" the moment the numbers stop matching anybody else's.
  const pickPreset = document.createElement('label');
  pickPreset.className = 'pick preset';
  const ps = document.createElement('select');
  for (const r of ROBOT_PRESETS) {
    const o = document.createElement('option');
    o.value = r.key;
    o.textContent = r.label;
    o.title = r.note;
    ps.appendChild(o);
  }
  const custom = document.createElement('option');
  custom.value = '-1';
  custom.textContent = 'Custom';
  ps.appendChild(custom);
  const note = document.createElement('span');
  note.className = 'preset-note';
  // The identity has to follow the numbers, not the last thing that was clicked: a card whose drive speed was
  // edited is no longer #1690 Orbit's machine, and leaving the picker on a name the fields contradict is the
  // one lie this control can tell. Every editor on the card calls it, and it touches only these two nodes so
  // the input that just changed keeps its focus.
  const syncPreset = () => {
    const i = presetIndexOf(p);
    ps.value = i >= 0 ? ROBOT_PRESETS[i].key : '-1';
    note.textContent = i >= 0 ? ROBOT_PRESETS[i].note : 'edited on this card';
  };
  syncPreset();
  ps.addEventListener('change', () => {
    const r = ROBOT_PRESETS.find((x) => x.key === ps.value);
    // Only this slot is replaced. The other two machines keep whatever they were, including any edits.
    trioFor(side)[idx] = r ? clone(r.profile) : p;
    buildSetup();
  });
  pickPreset.append(capText('preset'), ps, note);
  wrap.appendChild(pickPreset);
  const specs = document.createElement('div');
  specs.className = 'specs';
  for (const f of SPEC_FIELDS) {
    specs.appendChild(specField(f, () => (f.get ? f.get(p) : p[f.key]), (v) => {
      if (f.set) f.set(p, v);
      else p[f.key] = v;
      syncPreset();
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
  ch.addEventListener('change', () => { p.chassis = ch.value; syncPreset(); });
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

// The mirror is a statement about what the BATCH means (strategy vs strategy), not about which machines are on
// the carpet, so it stays an ALLIANCE-level control while the machines themselves are chosen per slot.
function buildRosterControls() {
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
    // #124 routes a drive around the hexagon instead of into it; #125 lets the drive itself shake a CORAL loose.
    // Each off value is the engine as it was, and 0 for `carryDrop` spends no random number at all, so the
    // control is the same MATCH rather than the same MATCH rolled differently.
    detourOff: !$('chk-detour').checked,
    carryDrop: $('chk-carry-drop').checked ? CARRY_DROP_PER_SEC : 0,
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

// Module scope because the batch button switches to its own tab so the progress bar and the charts are on
// screen while the MATCHes run, and a hidden canvas has no width to draw into.
function showTab(name) {
  for (const t of document.querySelectorAll('.tabs .tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const b of document.querySelectorAll('.tab-body')) b.hidden = b.id !== `tab-${name}`;
}

function setScrub(frames) {
  const sc = $('rng-scrub');
  sc.max = String(Math.max(0, frames - 1));
  sc.value = '0';
  sc.step = '1';
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
  });
  showMatch(r);
  setStatus(`seed ${seed} · ${Math.round(performance.now() - t0)} ms · ${r.frames.length} frames`, 'done');
}

// Loading a finished MATCH onto the field. A batch records its first MATCH for exactly this, so the
// distribution on the Batch tab and the replay on the canvas are the same set of seeds rather than two
// unrelated things the reader has to trust separately.
function showMatch(r) {
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

// The scrubber's marks and what the ‹ › buttons walk between are one set, so one list decides both. A mark
// the page paints but no control can stop on is the complaint this answers: `foul` used to be missing here
// while the buttons' own title promised it.
const MARKS = ['foul', 'climb', 'fumble', 'drop', 'carry-drop'];

function seekFrame(i) {
  if (!state.match) return;
  // `advance` recomputes the frame from the anchor it was handed at Play, so a jump made while the replay
  // runs is overwritten on the next tick. Measured in the browser: pressing "event ›" at 1x moved the frame
  // 7 → 8 and then 12 → 17, which is why the button read as dead. The scrubber's own handler already stops
  // first; so does the 2026 build's goToTime. Every seek on this page now goes through here.
  if (state.playing) stop();
  state.frame = Math.max(0, Math.min(state.match.frames.length - 1, i));
  paintFrame();
}

function stepTo(dir) {
  if (!state.match) return;
  const times = state.match.events.filter((e) => MARKS.includes(e.kind)).map((e) => e.t);
  const cur = frameAt(state.frame).t;
  const t = dir === 'prev' ? times.filter((x) => x < cur - 0.25).pop() : times.find((x) => x > cur + 0.05);
  if (t === undefined) return;
  seekFrame(Math.round(t * FRAMES_PER_SEC));
}

function buildScrubMarks(events) {
  const wrap = $('scrub-marks');
  wrap.innerHTML = '';
  const span = TIME.matchSec;
  for (const e of events) {
    // A CORAL that fell off a BRANCH is the fault the carpet shows, so the scrubber marks it: the pieces are
    // on the ground for about a second each, and without a mark to jump to there is no way to stop on one.
    if (!MARKS.includes(e.kind)) continue;
    const i = document.createElement('i');
    i.className = e.kind === 'foul' ? '' : e.kind;
    i.style.left = `min(${(e.t / span) * 100}%, calc(100% - 2px))`;
    i.title = `${e.t.toFixed(1)}s ${e.kind}${e.code ? ' ' + e.code : ''}`;
    // The mark is clickable because it is the thing on the track that says "something happened here"; the
    // 2026 page already jumps from its marks, and a mark you can only look at sends you back to ‹ ›.
    i.addEventListener('click', () => seekFrame(Math.round(e.t * FRAMES_PER_SEC)));
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
        // the column is next to the levels it was aimed at rather than hidden in the picks count. The two
        // ways it came off are named apart — off a BRANCH, or off the carrier while it was driving.
        `${p.L1}/${p.L2}/${p.L3}/${p.L4}${r.dropped ? ` · ${r.dropped} fell` : ''}${r.carryDropped ? ` · ${r.carryDropped} shaken` : ''}`,
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
    'carry-drop': 'CORAL shaken loose by the drive',
  };
  for (const e of rows) {
    const line = document.createElement('div');
    const who = e.side ? `${e.side[0].toUpperCase()}${(e.slot ?? 0) + 1}` : '';
    const label = e.kind === 'place' ? `CORAL ${e.level} in AUTO` : e.kind === 'climb' ? `CAGE ${e.level}` : e.kind === 'foul' ? `${e.code} ${e.sev}${e.card === 'RED' ? ' + RED CARD, out for the MATCH' : e.card === 'YELLOW' ? ' + YELLOW' : ''}` : e.kind === 'fumble' ? `dropped ${e.intent}` : e.kind === 'net' ? (e.by === 'robot' ? 'NET +4 lifted in by the ROBOT' : 'NET +4 thrown') : typeof LABEL[e.kind] === 'function' ? LABEL[e.kind](e) : LABEL[e.kind] || e.kind;
    line.innerHTML = `<b>${e.t.toFixed(1)}s</b> ${who} ${label}`;
    // Reading the ledger and stopping the replay on the line you just read is one gesture, the way the 2026
    // page's rows are. Every row carries a time, so every row goes there — not only the ones the scrubber
    // marks; a NET throw is worth looking at even though it is not a fault.
    line.className = 'ev';
    line.title = 'jump to this';
    line.addEventListener('click', () => seekFrame(Math.round(e.t * FRAMES_PER_SEC)));
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
    const press = pin.press > 0 ? `a press has to beat the cycle it replaces at ${pin.press.toFixed(2)} points a press-second` : 'defense is not on the menu';
    const autoCrowd = pin.auto > 0 ? `the three AUTO paths price an ally already at the same CORAL MARK at ${pin.auto} s of drive` : 'AUTO: all three bid the nearest MARK';
    out.appendChild(card(`${side} commit window`, `${p.plan.climbWindowSec} s of MATCH left`, `ALGAE duty: ${p.plan.algaeSlots ? `machine ${p.plan.algaeSlots.join(' and ')}` : 'nobody — the model prices the crossing'} · CORAL STATIONs: ${p.plan.spread ? 'split, both pockets worked' : 'all three at the nearer one'} · aiming ${p.plan.placeOrder.join('/')} · ${autoCrowd} · ${endgame} · ${claim} · ${press} · ${list.length} re-solves through TELEOP${byEvent ? `, ${byEvent} of them after the fleet lost a machine` : ''}`));
    out.appendChild(card(`${side} first move`, switches.length ? `t = ${switches[0].t.toFixed(0)} s → ${switches[0].switchTo} s` : 'never moved', switches.length ? `the model expected +${switches[0].gain.toFixed(1)} points against the opening plan` : 'no plan ever beat the opening one by more than the churn allowance'));
    out.appendChild(card(`${side} fleet pace`, `${p.plan.efficiency.toFixed(2)}× the straight-line cycle`, last ? `at t = ${last.t.toFixed(0)} s the REEF still had ${last.free} slots · ${switches.length} switch${switches.length === 1 ? '' : 'es'}` : 'planned once'));
  }
}

// ---------------------------------------------------------------------------
// batch measurements (the Monte-Carlo button)
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

const meanSe = (a, b) => `${a.toFixed(1)} ± ${b.toFixed(1)}`;
const pctOf = (v) => `${(v * 100).toFixed(0)}%`;
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;

// The label names the machines, because a batch of two different rosters is a ROBOT comparison and the
// preset keys would not say which three cars were actually on the carpet — they can be edited per slot now.
const roster = (side) => trioFor(side).map((p) => `${p.team === 1 || p.team === 2 || p.team === 3 ? p.name : `#${p.team} ${p.name}`}`).join('/');

// ---------------------------------------------------------------------------------------------
// Worker plumbing. The batch is engine work rather than page work, and doing it off-thread is what keeps
// the field animating and the click handlers answering while it runs. A host that refuses module workers
// gets the same loop on this thread — see `runBatch` — because a silently rejected `new Worker()` is the
// same frozen button this repo has already been bitten by twice.
// ---------------------------------------------------------------------------------------------
let worker = null;
let workerDead = false;
const pending = new Map();
let msgId = 0;

function ensureWorker() {
  if (workerDead) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    workerDead = true;
    return null;
  }
  worker.onmessage = (ev) => {
    const { id, type, payload } = ev.data || {};
    const entry = pending.get(id);
    if (!entry) return;
    if (type === 'progress') {
      entry.onProgress?.(payload);
      return;
    }
    pending.delete(id);
    if (type === 'error') entry.reject(new Error(payload));
    else entry.resolve(payload);
  };
  // A worker that dies mid-batch would otherwise leave its promise unresolved forever, which from the page
  // looks identical to a button that was never wired up.
  worker.onerror = (e) => {
    workerDead = true;
    for (const entry of pending.values()) entry.reject(new Error(e.message || 'the worker stopped'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function askWorker(type, payload, onProgress) {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error('no worker in this host'));
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    try {
      w.postMessage({ id, type, payload });
    } catch (e) {
      pending.delete(id);
      reject(e);
    }
  });
}

// A MATCH is ~0.3 s of the engine and a batch is dozens of them, so the old synchronous loop froze the tab
// for a quarter of a minute with nothing on screen to say it was working. One MATCH per frame keeps the
// field, the progress bar and the rest of the page alive, and costs the wall clock almost nothing next to
// the simulation itself. Which host answers first is not knowable from here: a foreground tab gives a frame
// every ~16 ms, while a window the compositor has stopped drawing clamps `setTimeout` to half a second and a
// 48-MATCH batch would then spend more time waiting than simulating. So ask for a frame and put a short
// timer underneath it.
const nextTick = () => new Promise((res) => {
  let done = false;
  const finish = () => { if (done) return; done = true; res(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
  setTimeout(finish, 60);
});

function setProgress(frac, label) {
  const box = $('progress');
  if (!box) return;
  box.hidden = frac == null;
  if (frac == null) return;
  $('progress-bar').style.width = `${Math.round(frac * 100)}%`;
  $('progress-label').textContent = label || '';
}

function setBusy(on) {
  for (const id of ['btn-run', 'btn-new', 'btn-batch', 'btn-bench']) {
    const el = $(id);
    if (el) el.disabled = on;
  }
}

async function runBatch(kind) {
  const matches = Math.max(4, Math.min(240, parseInt($('inp-matches').value, 10) || 48));
  $('inp-matches').value = String(matches);
  const seedBase = Math.max(1, parseInt($('inp-batchseed').value, 10) || 51000);
  $('inp-batchseed').value = String(seedBase);
  showTab('bench');
  const blueKind = $('sel-blue-kind').value;
  const redKind = kind === 'bench' ? 'random' : $('sel-red-kind').value;
  const scenario = scenarioFromUI();
  const profiles = { blue: trioFor('blue'), red: trioFor('red') };
  setBusy(true);
  setStatus(`Running ${matches} MATCHes`, 'busy');
  const t0 = performance.now();
  let summary = null;
  let recorded = null;
  try {
    const out = await askWorker(
      'batch',
      { blueKind, redKind, matches, seedBase, scenario, profiles },
      (p) => setProgress(p.done / p.total, `${p.done}/${p.total}`),
    );
    summary = out.summary;
    recorded = out.recorded;
  } catch (err) {
    // Same loop, this thread, one MATCH per frame. Slower to answer a click, never slower to finish.
    setStatus(`No worker here (${err.message}) — running them on this thread`, 'busy');
    const records = [];
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
      if (i === 0) recorded = r;
      records.push(r);
      setProgress((i + 1) / matches, `${i + 1}/${matches}`);
      await nextTick();
    }
    summary = aggregate(records);
  }
  setProgress(null);
  setBusy(false);
  state.batch = summary;
  const ran = {
    matches,
    seedBase,
    blueKind,
    redKind,
    ms: Math.round(performance.now() - t0),
    snapshot: batchSnapshot({ matches, seedBase, blueKind, redKind, scenario }),
  };
  renderBatch(summary, ran, kind);
  // The first MATCH of the batch goes on the field, so the distribution and the replay are the same seeds
  // rather than two things the reader has to trust separately.
  if (recorded) showMatch(recorded);
  setStatus(`${ran.ms} ms · ${matches} MATCHes · seedBase ${seedBase}`, 'done');
  state.prevBatch = { ...e, ...ran };
}

// Everything a batch can be given, in one object, so the next batch can say which single thing moved.
function batchSnapshot({ matches, seedBase, blueKind, redKind, scenario }) {
  return {
    matches,
    seedBase,
    blueKind,
    redKind,
    mirror: state.mirror,
    trioBlue: JSON.stringify(trioFor('blue')),
    trioRed: JSON.stringify(trioFor('red')),
    jitter: scenario.tempoJitter,
    fouls: scenario.foulsOff,
    contact: scenario.contactRestitution === undefined,
    placeRisk: scenario.placementRisk,
    hpNet: scenario.algaeInNetByHuman,
    turnRamp: scenario.turnRampOff,
    detour: !scenario.detourOff,
    carryDrop: scenario.carryDrop,
    playoff: scenario.playoff,
  };
}

const DIFF_LABEL = {
  matches: 'the MATCH count',
  seedBase: 'the batch seed base (a different family of MATCHes)',
  blueKind: "blue's strategy",
  redKind: "red's strategy",
  mirror: 'the mirror',
  trioBlue: 'the blue ROBOTS',
  trioRed: 'the red ROBOTS',
  jitter: 'the tempo jitter',
  fouls: 'the foul switch',
  contact: 'the bumper-impulse switch',
  placeRisk: 'the CORAL-miss switch',
  hpNet: "the HUMAN PLAYER's NET throws",
  turnRamp: 'the turn-ramp switch',
  detour: 'steer-around-the-REEF switch',
  carryDrop: 'the CORAL-falls-on-the-drive switch',
  playoff: 'Qualification vs Playoff',
};

function renderBatchDelta(e, ran) {
  const host = $('batch-delta');
  host.innerHTML = '';
  const prev = state.prevBatch;
  if (!prev) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'This is the first batch of the session, so there is nothing to compare it against yet. Run it again after changing one control and the line below prices that change.';
    host.appendChild(p);
    return;
  }
  const changed = Object.keys(ran.snapshot).filter((k) => ran.snapshot[k] !== prev.snapshot[k]).map((k) => DIFF_LABEL[k] || k);
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = changed.length === 0
    ? 'Same settings as the previous batch, so the move below is engine noise on the same MATCHes.'
    : changed.length === 1
      ? `One thing changed since the previous batch (${changed[0]}), so the move below is that setting's effect and nothing else.`
      : `${changed.length} settings changed (${changed.join(', ')}), so this compares two different questions rather than one change.`;
  host.appendChild(note);
  const cell = (name, a, b, digits = 1) => {
    const d = a - b;
    const span = document.createElement('span');
    span.className = 'delta-cell';
    span.textContent = `${name} ${b.toFixed(digits).replace('-', '−')} → ${a.toFixed(digits).replace('-', '−')} (${signed(d, digits)})`;
    span.dataset.dir = Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down';
    return span;
  };
  const line = document.createElement('p');
  line.className = 'delta-line';
  line.appendChild(document.createTextNode(`Against the previous batch (${prev.matches} MATCHes, seedBase ${prev.seedBase}): `));
  for (const c of [
    cell('blue win', e.winRate * 100, prev.winRate * 100, 1),
    cell('blue mean', e.avgBlue, prev.avgBlue, 1),
    cell('red mean', e.avgRed, prev.avgRed, 1),
    cell('margin', e.avgMargin, prev.avgMargin, 1),
    cell('blue RP', e.avgRpBlue, prev.avgRpBlue, 2),
  ]) line.appendChild(c);
  host.appendChild(line);
}

function renderBatch(e, ran, kind) {
  const out = $('batch-out');
  out.innerHTML = '';
  const rosters = state.mirror ? `${roster('blue')} trio on both ALLIANCES` : `${roster('blue')} blue vs ${roster('red')} red`;
  const scope = $('batch-scope');
  scope.textContent = `${kind === 'bench' ? 'Baseline check' : state.mirror ? 'Mirror batch' : 'Two-roster batch'} · ${ran.matches} MATCHes · seedBase ${ran.seedBase} (stride 977) · ${ran.blueKind} blue vs ${ran.redKind} red · ${rosters} · ${ran.ms} ms`;
  out.appendChild(card(kind === 'bench' ? 'Greedy (blue) mean' : 'Blue mean', meanSe(e.avgBlue, e.blueSe), `worst ${e.worstBlue} to best ${e.bestBlue}, n=${ran.matches}`));
  out.appendChild(card('Red mean', meanSe(e.avgRed, e.redSe), `worst ${e.worstRed} to best ${e.bestRed}`));
  out.appendChild(card('Margin', meanSe(e.avgMargin, e.marginSe), state.mirror ? (e.marginSe > 0.5 ? 'blue minus red; a mirror margin is the field-leak test' : 'indistinguishable from zero') : 'blue minus red across two trios: a ROBOT comparison, not a leak'));
  out.appendChild(card('Blue win rate', `${(e.winRate * 100).toFixed(1)} ± ${(e.winSe * 100).toFixed(1)}%`, `${e.blueWins}W ${e.redWins}L ${e.ties}T, ties counted half`));
  out.appendChild(card('RP mean', `${e.avgRpBlue.toFixed(2)} / ${e.avgRpRed.toFixed(2)}`, 'auto + coral + barge + win/tie'));
  out.appendChild(card('Spread of a MATCH', `± ${(Math.max(e.blueSe, e.redSe) * 1.96).toFixed(0)} pt`, 'the 95% band on one ALLIANCE: the same strategy loses by this much sometimes'));

  const labels = [];
  for (let i = 0; i < e.blueScoreHist.length; i++) labels.push(i % 2 === 0 ? String(e.bin.lo + i * e.bin.size) : '');
  histChart($('chart-score'), [
    { values: e.blueScoreHist, css: '--blue' },
    { values: e.redScoreHist, css: '--red' },
  ], labels);
  const mLabels = [];
  const mb = e.marginHist.length;
  for (let i = 0; i < mb; i++) mLabels.push(i % 2 === 0 ? String(-e.bin.marginEdge + i * e.bin.size) : '');
  histChart($('chart-margin'), [{ values: e.marginHist, css: '--good' }], mLabels);
  $('chart-note').textContent = `Bins are ${e.bin.size} points on fixed edges, not per-batch quantiles, so two batches drawn on the same axis can be compared by eye. Each score bin draws BLUE first, then RED; the margin chart is blue minus red, and a bar left of zero is a MATCH blue lost.`;

  const rpRows = [
    ['AUTO RP', 'all three LEAVE and ≥3 CORAL placed in AUTO (Table 6-2)'],
    ['CORAL RP', '4 CORAL at each of L2-L4, or 3 with the Coopertition point'],
    ['BARGE RP', '≥12 BARGE points'],
    ['Win RP', '3 for the winner'],
    ['Tie RP', '1 each'],
  ];
  const list = $('rp-list');
  list.innerHTML = '';
  rpRows.forEach(([name, note], i) => {
    const key = ['auto', 'coral', 'barge', 'win', 'tie'][i];
    const row = document.createElement('div');
    row.className = 'rp-row';
    const label = document.createElement('span');
    label.innerHTML = '<b></b><br /><small class="hint"></small>';
    label.querySelector('b').textContent = name;
    label.querySelector('small').textContent = note;
    const nums = document.createElement('strong');
    nums.className = 'mono';
    nums.textContent = `${pctOf(e.rp.blue[key])} / ${pctOf(e.rp.red[key])}`;
    row.appendChild(label);
    row.appendChild(nums);
    for (const side of ['blue', 'red']) {
      const bar = document.createElement('div');
      bar.className = `rp-bar ${side}`;
      const fill = document.createElement('i');
      fill.style.width = `${Math.round(e.rp[side][key] * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
    }
    list.appendChild(row);
  });
  $('rp-note').textContent = 'Chance a MATCH ends with that RP, blue then red. Table 6-2 pays an RP for the whole ALLIANCE, so these are all-or-nothing per MATCH, not averages.';

  const d = e.detail;
  fillTable($('batch-table'), [
    ['what a MATCH produces', 'blue', 'red'],
    ['CORAL points', d.blue.coralPoints.toFixed(1), d.red.coralPoints.toFixed(1)],
    ['of those, placed in AUTO', `${d.blue.autoCoral.toFixed(1)} CORAL`, `${d.red.autoCoral.toFixed(1)} CORAL`],
    ['LEAVE', d.blue.leave.toFixed(2), d.red.leave.toFixed(2)],
    ['ALGAE points', d.blue.algaePoints.toFixed(1), d.red.algaePoints.toFixed(1)],
    ['PROCESSOR / NET', `${d.blue.processor.toFixed(1)} / ${d.blue.net.toFixed(1)}`, `${d.red.processor.toFixed(1)} / ${d.red.net.toFixed(1)}`],
    ['BARGE points', d.blue.bargePoints.toFixed(1), d.red.bargePoints.toFixed(1)],
    ['DEEP / SHALLOW / PARK', `${d.blue.deep.toFixed(2)} / ${d.blue.shallow.toFixed(2)} / ${d.blue.park.toFixed(2)}`, `${d.red.deep.toFixed(2)} / ${d.red.shallow.toFixed(2)} / ${d.red.park.toFixed(2)}`],
    ['Coopertition point', d.blue.coop.toFixed(2), d.red.coop.toFixed(2)],
    ['Foul points credited', d.blue.foulsWon.toFixed(2), d.red.foulsWon.toFixed(2)],
    ['Best MATCH score', e.bestBlue, e.bestRed],
    ['Worst MATCH score', e.worstBlue, e.worstRed],
    ['Best / worst margin', `${signed(e.bestMargin)} / ${signed(e.worstMargin)}`, `${signed(-e.worstMargin)} / ${signed(-e.bestMargin)}`],
  ]);
  const foul = e.foulByRobot;
  const fRows = [['seat', 'fouls a MATCH', 'which clauses']];
  if (!foul.length) fRows.push(['nobody', '0', 'neither fleet drove into an opponent on these seeds — the fouls this model has to offer are geometric, so an empty row is a statement about the plans, not about the rule table']);
  for (const row of foul) {
    fRows.push([
      `${row.side} ${row.slot + 1} · ${row.name}`,
      row.fouls.toFixed(2),
      Object.entries(row.codes).map(([code, per]) => `${code}×${per.toFixed(2)}`).join(' · '),
    ]);
  }
  fillTable($('batch-foul-table'), fRows, false);
  $('batch-foul-note').textContent = foul.length
    ? `Table 6-6 charges a MINOR as 5 points and a MAJOR as 15 to the other ALLIANCE; across this batch blue conceded ${e.foulPoints.blue.toFixed(1)} points a MATCH and red ${e.foulPoints.red.toFixed(1)}.`
    : 'The clause counts below would be where a defensive plan shows up: G421 is one ROBOT across the BARGE ZONE, G425 a PIN, G427 inside the opponent zone.';
  renderBatchDelta(e, ran);
}

// ---------------------------------------------------------------------------------------------
// Chart helpers (plain canvas, no libraries). Same construction as the 2026 page: the backing store
// is the displayed box times devicePixelRatio, so a 1 px gridline is 1 px on a HiDPI screen.
// ---------------------------------------------------------------------------------------------
const CHART_GRID = '#1e2836';
const CHART_AXIS = '#6f809b';

function prepCanvas(canvas, fallbackW = 320, fallbackH = 130) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || fallbackW;
  const h = canvas.clientHeight || fallbackH;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function histChart(canvas, series, labels) {
  if (!canvas) return;
  const { ctx, w, h } = prepCanvas(canvas);
  const padL = 26;
  const padB = 15;
  const padT = 10;
  const plotH = Math.max(1, h - padB - padT);
  const k = series[0].values.length;
  const max = Math.max(1, ...series.reduce((a, s) => a.concat(s.values), []));
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const f of [0, 0.5, 1]) {
    const y = h - padB - f * plotH;
    ctx.strokeStyle = f === 0 ? '#33415a' : CHART_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y + 0.5);
    ctx.lineTo(w - 4, y + 0.5);
    ctx.stroke();
    ctx.fillStyle = CHART_AXIS;
    ctx.fillText(String(Math.round(max * f)), padL - 5, y);
  }
  const bw = (w - padL - 4) / k;
  const barW = Math.max(1.5, (bw - 3) / series.length);
  series.forEach((s, j) => {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(s.css).trim() || '#2f7de1';
    s.values.forEach((v, i) => {
      if (!v) return;
      const bh = (plotH * v) / max;
      ctx.fillRect(padL + i * bw + 1.5 + j * barW, h - padB - bh, barW, bh);
    });
  });
  ctx.fillStyle = CHART_AXIS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  labels.forEach((lb, i) => {
    if (!lb) return;
    ctx.fillText(lb, padL + i * bw + bw / 2, h - 4);
  });
}

function redrawBatchCharts() {
  const e = state.batch;
  if (!e) return;
  const labels = [];
  for (let i = 0; i < e.blueScoreHist.length; i++) labels.push(i % 2 === 0 ? String(e.bin.lo + i * e.bin.size) : '');
  histChart($('chart-score'), [
    { values: e.blueScoreHist, css: '--blue' },
    { values: e.redScoreHist, css: '--red' },
  ], labels);
  const mLabels = [];
  for (let i = 0; i < e.marginHist.length; i++) mLabels.push(i % 2 === 0 ? String(-e.bin.marginEdge + i * e.bin.size) : '');
  histChart($('chart-margin'), [{ values: e.marginHist, css: '--good' }], mLabels);
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

// `monoLast` is false for the tables whose last column is prose (the clause list of a seat's fouls), where
// right-aligning a sentence reads as a mistake.
function fillTable(el, rows, monoLast = true) {
  el.innerHTML = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    r.forEach((c, j) => {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      cell.textContent = String(c);
      if (monoLast && i > 0 && j > 0 && j === r.length - 1) cell.className = 'mono';
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

// Fill and true fullscreen are two different asks, and the page now has a button for each. Fill is a
// promise the page keeps by itself — the FIELD takes the viewport, the other panels step aside, the browser
// chrome stays — so it is the mode to use when jumping between this tab and something else. Fullscreen
// hands the panel to the browser and the chrome goes too, but it is a request, not a guarantee: an embedded
// preview panel rejects it with "Permissions check failed", and a rejected promise nobody looks at is
// exactly a button that does nothing. The Fill layout is therefore also what the Fullscreen button falls
// back to, so the control always has a visible effect and Esc still means "leave".
function setFill(on) {
  state.fill = on;
  document.body.classList.toggle('fill', on);
  const btn = $('btn-fill');
  if (btn) btn.textContent = on ? 'Exit fill' : 'Fill';
  // Each button owns its own label: the fullscreen one follows `fullscreenchange`, this one follows the
  // Fill toggle, and a fallback that lands here has to leave the other reading "Fullscreen".
  const fs = $('btn-fs');
  if (fs) fs.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  requestAnimationFrame(paintFrame);
}

function toggleFullscreen() {
  const panel = document.querySelector('.field-panel');
  if (document.fullscreenElement) {
    document.exitFullscreen();
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
  // Same reason as Esc: Fill is a layout, not a step through a MATCH, so it works on an empty field.
  if (ev.key === 'c' || ev.key === 'C') {
    ev.preventDefault();
    setFill(!state.fill);
    return;
  }
  const n = state.match ? state.match.frames.length : 0;
  if (!n) return;
  const map = {
    ' ': () => (state.playing ? stop() : play()),
    '[': () => stepTo('prev'),
    ']': () => stepTo('next'),
    Home: () => seekFrame(0),
    End: () => seekFrame(n - 1),
    ArrowLeft: () => seekFrame(state.frame - 5),
    ArrowRight: () => seekFrame(state.frame + 5),
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
  $('btn-batch').addEventListener('click', () => runBatch('mirror'));
  $('btn-bench').addEventListener('click', () => runBatch('bench'));
  $('btn-play').addEventListener('click', () => (state.playing ? stop() : play()));
  $('btn-ev-prev').addEventListener('click', () => stepTo('prev'));
  $('btn-ev-next').addEventListener('click', () => stepTo('next'));
  $('btn-export').addEventListener('click', exportMatch);
  $('btn-import').addEventListener('click', () => $('inp-import').click());
  $('inp-import').addEventListener('change', (e) => e.target.files[0] && importMatch(e.target.files[0]));
  $('btn-fill').addEventListener('click', () => setFill(!state.fill));
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
  for (const t of document.querySelectorAll('.tabs .tab')) {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  }
  $('btn-tab-rules').addEventListener('click', () => showTab('rules'));
  $('rng-scrub').addEventListener('input', (e) => {
    stop();
    state.frame = Number(e.target.value);
    paintFrame();
  });
  for (const id of ['chk-labels', 'chk-targets', 'chk-numbers']) $(id).addEventListener('change', paintFrame);
  window.addEventListener('resize', () => {
    paintFrame();
    redrawBatchCharts();
  });
  // The panel can turn into a real tab mid-playback; re-enter the loop so it picks up the display clock.
  document.addEventListener('visibilitychange', () => {
    if (state.playing) play();
  });
  document.addEventListener('keydown', keys);
}

buildRosterControls();
buildRuleTables();
bind();
// A match on load: the page should never present an empty canvas, and the first number a visitor sees
// should be one the current build actually produced.
runMatch();
paintFrame();
