// Scouting data in, ROBOT cards out.
//
// The 2025 page has always been filled by hand: six cards, sixteen fields each, typed from a spreadsheet
// somebody else measured — and that is the work that stops a team from using a simulator at all. This reads
// the CSV a team actually has instead: a scouting sheet, a Statbotics EPA dump, a TBA spreadsheet download.
// No network at runtime, the rule this project keeps, so the data arrives as a file the user hands to the
// page.
//
// Two kinds of column arrive in those files and they are not the same thing:
//
//   a PROCESS number — drive speed, cycle seconds, climb seconds, pick seconds — is a stopwatch, and it
//     writes the clock field it names;
//   an OUTCOME number — auto CORAL, BARGE points, CORAL a MATCH — is what the machine achieved, and it can
//     only be honoured the way `model.js` already honours it for the named presets: the AUTO count sets
//     `autoCycles` directly (that field IS the routine), the BARGE column says whether the team hangs DEEP
//     (Table 6-2 prices DEEP 12, SHALLOW 6, PARK 2), and a per-MATCH CORAL rate scales the whole timeline
//     through the same `scaleProfile` the Johnson and Newton cards were built with.
//
// An aggregate like OPR or EPA is deliberately not here: it is a point total, and a point in this model is a
// CORAL on a named branch or an ALGAE in a named volume, so an alliance-level total cannot be split into a
// drive speed and a cycle rate without guessing which of the two the team is good at. A file that carries
// only those will import with one line per column this model cannot use — which is the honest outcome.
//
// Units are the manual's (§1.6, inches and seconds). Metric columns are accepted under their own names and
// converted here rather than silently read as inches. A percentage may arrive as 0-1 or 0-100; either way the
// profile stores a fraction, because that is what `model.js` and the card's own display already do.

import { CHASSIS, SAMPLES, ROBOT_PRESETS, scaleProfile, REF_CORAL_PER_ROBOT } from './model.js';
import { ROBOT_LIMITS } from './rules.js';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const round = (n) => Math.round(n * 100) / 100;

// The card's own editable numbers, in the card's own ranges. Those ranges are `SPEC_FIELDS` in `ui.js` rather
// than rule limits, on purpose: a value the panel cannot show is a measurement the user could not correct, so
// an out-of-range cell is clamped with a sentence naming the range instead of being absorbed. `check_web.mjs`
// holds the two tables against each other. `weightLb` is the one column here the card prints but does not
// edit — R103 caps it at 115 lb, and `engine.js` uses it for the momentum exchange and the severity of every
// hit, so it is worth honouring and worth clamping.
const COLUMNS = [
  ['team', 'team', 'integer', 'names the card and finds the modelled machine'],
  ['name', 'name', 'text', 'shown in the card title'],
  ['chassis', 'chassis', 'choice', 'swerve / tank / mecanum'],
  ['drivespeedips', 'driveSpeedIps', 'range:40:200', 'in/s'],
  ['drivespeedmps', 'driveSpeedIps', 'mps', 'm/s × 39.37'],
  ['turnratedegs', 'turnRateDegS', 'range:60:900', 'deg/s'],
  ['weightlb', 'weightLb', `range:40:${ROBOT_LIMITS.weightLbMax}`, 'lb — R103 caps it, read from rules.js'],
  ['autocoral', 'autoCycles', 'count:0:10', 'CORAL in the 15 s AUTO, the preload counted'],
  ['armsec', 'armSec', 'range:0.5:12', 's of mechanism time between two CORAL (pick + place)'],
  ['coralpermatch', 'coralPerMatch', 'range:1:40', 'CORAL a MATCH, scales the whole timeline'],
  ['teleopcoral', 'teleopCoral', 'range:0:40', 'CORAL a MATCH after the AUTO whistle'],
  ['picksec', 'pickSec', 'range:0.3:4', 's to take one CORAL'],
  ['placel1', 'placeL1', 'range:0.1:6', 's'],
  ['placel2', 'placeL2', 'range:0.1:6', 's'],
  ['placel3', 'placeL3', 'range:0.1:6', 's'],
  ['placel4', 'placeL4', 'range:0.1:6', 's'],
  ['dropl1', 'dropL1', 'pct:0:90', '% of L1 CORAL that fall off'],
  ['dropl2', 'dropL2', 'pct:0:90', '%'],
  ['dropl3', 'dropL3', 'pct:0:90', '%'],
  ['dropl4', 'dropL4', 'pct:0:90', '%'],
  ['algaestripsec', 'algaeStripSec', 'range:0.4:5', 's to pull a 16 in ALGAE off the REEF'],
  ['netlift', 'netLift', 'lift', 'seconds, or yes to use the L4 time + 0.5 s'],
  ['climbsec', 'climbSec', 'range:0.5:10', 's'],
  ['climbsuccess', 'climbSuccess', 'pct:30:100', '% of CAGE holds that stick'],
  ['bargepoints', 'bargePoints', 'range:0:36', 'MATCH-mean BARGE points — decides DEEP or not'],
  ['deep', 'canClimbDeep', 'bool', 'explicit DEEP choice, overrides the BARGE column'],
  ['reliability', 'reliability', 'pct:60:100', '% of MATCHes with no terminal fault'],
];

const LOOKUP = new Map(COLUMNS.map((c) => [norm(c[0]), c]));
// How teams write those headers in a spreadsheet. A name that is not here is reported, not guessed, because a
// wrong guess silently becomes a card.
for (const [alias, header] of [
  ['team_number', 'team'], ['team_no', 'team'], ['teamno', 'team'], ['number', 'team'], ['robot_number', 'team'],
  ['robot_name', 'name'], ['robot', 'name'],
  ['drivetrain', 'chassis'], ['drive_type', 'chassis'],
  ['speed', 'drivespeedips'], ['drive_speed', 'drivespeedips'], ['max_speed', 'drivespeedips'], ['top_speed', 'drivespeedips'],
  ['speed_mps', 'drivespeedmps'], ['drive_speed_mps', 'drivespeedmps'], ['max_speed_mps', 'drivespeedmps'],
  ['turn_rate', 'turnratedegs'], ['max_angular', 'turnratedegs'],
  ['weight', 'weightlb'], ['robot_weight', 'weightlb'], ['weight_lbs', 'weightlb'],
  ['auto_coral', 'autocoral'], ['coral_auto', 'autocoral'], ['auto', 'autocoral'], ['auto_score', 'autocoral'],
  ['arm_s', 'armsec'], ['pick_place_s', 'armsec'], ['manipulation_s', 'armsec'], ['arm_cycle_s', 'armsec'],
  ['total_game_pieces', 'coralpermatch'], ['coral_per_match', 'coralpermatch'], ['pieces', 'coralpermatch'],
  ['avg_coral', 'coralpermatch'], ['game_pieces', 'coralpermatch'],
  ['teleop_coral', 'teleopcoral'], ['coral_teleop', 'teleopcoral'], ['teleop', 'teleopcoral'],
  ['pick_s', 'picksec'], ['acq_s', 'picksec'], ['acquisition_s', 'picksec'], ['intake_s', 'picksec'],
  ['place_l1_s', 'placel1'], ['place_l2_s', 'placel2'], ['place_l3_s', 'placel3'], ['place_l4_s', 'placel4'],
  ['l1_drop_pct', 'dropl1'], ['l2_drop_pct', 'dropl2'], ['l3_drop_pct', 'dropl3'], ['l4_drop_pct', 'dropl4'],
  ['strip_s', 'algaestripsec'], ['algae_strip_s', 'algaestripsec'],
  ['net_lift_s', 'netlift'], ['net_score_s', 'netlift'], ['can_net', 'netlift'], ['lifts_net', 'netlift'],
  ['climb_s', 'climbsec'], ['climb_sec', 'climbsec'], ['ascent_s', 'climbsec'],
  ['climb_success_pct', 'climbsuccess'], ['hang_rate', 'climbsuccess'],
  ['barge_points', 'bargepoints'], ['endgame_points', 'bargepoints'], ['avg_barge', 'bargepoints'],
  ['deep_cage', 'deep'], ['can_deep', 'deep'], ['climb_depth', 'deep'],
  ['reliability_pct', 'reliability'], ['robot_reliability', 'reliability'],
]) {
  const col = LOOKUP.get(norm(header));
  if (col) LOOKUP.set(norm(alias), col);
}

// The columns a real 2025 export carries and this model will not take, each with the reason and the column that
// does the job instead. Keyed the way `norm` reads a header — lowercase, no spaces or punctuation — because
// `cycle_s` and `Cycle Time` have to land on the same sentence. A file that carries only EPA aggregates imports
// with these lines rather than with a card that looks calibrated and is not.
const REFUSALS = {
  // The engine drives the legs itself, from the FIELD and the machine's own speed, so a stopwatch cycle that
  // already contains a drive would be paid for twice.
  cycles: 'a full CORAL cycle contains the drive leg and this model computes that one from the FIELD, so the number would be spent twice — give the mechanism half as arm_s (pick + place) or the outcome as coral_per_match',
  avgcycle: 'see cycle_s: the arm is yours to measure, the drive is the model\'s',
  cycletime: 'see cycle_s: the arm is yours to measure, the drive is the model\'s',
  cycle: 'see cycle_s: the arm is yours to measure, the drive is the model\'s',
  netalgae: 'an EPA ALGAE column is a share of an ALLIANCE total, not a reach — the card asks for the reach: net_lift_s (seconds to clear the 6 ft 4 in border, §5.4.2) or can_net (yes/no)',
  processoralgae: 'processing is the HUMAN PLAYER\'s route in this model unless the ROBOT has the NET reach (see net_lift_s); which ALGAE go where is the driver policy\'s, not the card\'s',
  autorp: 'a ranking-point column is what the FIELD paid for a ledger this model recomputes from the pieces themselves (Table 6-2); npm run rp regrades a real batch against the same rule',
  coralrp: 'see auto_rp: RP is an output of this model, not an input',
  bargerp: 'see auto_rp: RP is an output of this model, not an input',
  rp: 'see auto_rp: RP is an output of this model, not an input',
  opr: 'an aggregate point total cannot be split into a drive speed and a cycle rate without guessing which of the two the team is good at — give the stopwatch columns, or coral_per_match',
  epa: 'see opr: a scored contribution is not a machine property',
  dc: 'a dimensionless rating names no clock to change — give the stopwatch columns, or coral_per_match',
};



const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on', 'deep', 'hangs']);
const FALSY = new Set(['0', 'false', 'no', 'n', 'off', 'shallow', 'park', 'parks']);

export const COLUMN_DOC = COLUMNS.map(([header, field, spec, unit]) => ({ header, field, spec, unit }));

function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delim && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function headerDelim(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') || '';
  const counts = [',', ';', '\t'].map((d) => [d, splitLine(first, d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

const num = (v) => {
  const m = String(v).replace(/[^\d.\-]/g, '');
  // A cell that is all words ("fast", "n/a", "tbd") has nothing left once the digits are stripped, and
  // Number('') is 0 — which would write a 40 in/s robot instead of skipping the column.
  if (m === '' || m === '-' || m === '.') return null;
  const n = Number(m);
  return Number.isFinite(n) ? n : null;
};

// Every numeric column ends up here, so a value that has to be clamped is always *said*: a card that quietly
// absorbed a 130 lb robot as a 115 lb one would be a measurement the user cannot see.
function put(patch, field, value, lo, hi, where, problems) {
  const v = Math.max(lo, Math.min(hi, value));
  if (v !== value) problems.push(`${where}: ${round(value)} is outside the ${lo}-${hi} this model can run; clamped to ${v}`);
  patch[field] = round(v);
}

const CHASSIS_KEYS = Object.keys(CHASSIS);
const CHASSIS_ALIAS = { swerve: 'swerve', module: 'swerve', wow: 'swerve', tank: 'tank', tankdrive: 'tank', wheels: 'tank', pro: 'tank', mecanum: 'mecanum', omni: 'mecanum' };

function applyKind(col, raw, patch, problems, where) {
  const [, field, spec, unit] = col;
  const [kind, lo, hi] = spec.split(':');
  if (kind === 'choice') {
    const key = norm(raw);
    const v = CHASSIS_ALIAS[key] && CHASSIS_KEYS.includes(CHASSIS_ALIAS[key]) ? CHASSIS_ALIAS[key] : key;
    if (CHASSIS_KEYS.includes(v)) patch.chassis = v;
    else problems.push(`${where}: "${raw}" is not a drivetrain this engine models (${CHASSIS_KEYS.join('/')}); column skipped`);
    return;
  }
  if (kind === 'bool') {
    const s = String(raw).toLowerCase();
    if (TRUTHY.has(s)) patch.canClimbDeep = true;
    else if (FALSY.has(s)) patch.canClimbDeep = false;
    else problems.push(`${where}: "${raw}" is not a yes/no; column skipped`);
    return;
  }
  if (kind === 'lift') {
    const n = num(raw);
    if (n === null) {
      const s = String(raw).toLowerCase();
      if (TRUTHY.has(s)) patch.netLift = 'yes'; // resolved against the card's own L4 time in `toCard`
      else if (FALSY.has(s)) patch.netLift = 0;
      else problems.push(`${where}: "${raw}" is neither a number of seconds nor a yes/no; column skipped`);
      return;
    }
    put(patch, 'netLift', n, 0, 6, where, problems);
    return;
  }
  if (kind === 'pct') {
    const n = num(raw);
    if (n === null) { problems.push(`${where}: "${raw}" is not a number; column skipped`); return; }
    // A percentage arrives either way — 94 or 0.94 — and the profile stores the fraction, which is what
    // `model.js` and the card's own display both do. Above 1 is read as the percent form; the bounds are then
    // the same pair divided by 100, so a 0.95 fraction cannot slip past a 90 % ceiling.
    const frac = n > 1 ? n / 100 : n;
    put(patch, field, frac, Number(lo) / 100, Number(hi) / 100, where, problems);
    return;
  }
  if (kind === 'count') {
    const n = num(raw);
    if (n === null) { problems.push(`${where}: "${raw}" is not a number; column skipped`); return; }
    put(patch, field, n, Number(lo), Number(hi), where, problems);
    // `auto_coral` in a Statbotics export is a mean over sixty-odd MATCHes, and the field is a count of the
    // pieces one routine spends. Rounding is the same call `model.js` made when it built its named batch
    // (4.01 → 4), and it is said rather than done quietly, because a mean of 3.6 is a team that lands four
    // sometimes and three others.
    const r = Math.round(patch[field]);
    if (r !== patch[field]) {
      patch[field] = r;
      problems.push(`${where}: ${round(n)} is a season mean; the card counts the pieces one routine spends, so AUTO CORAL is ${r}`);
    }
    return;
  }
  if (kind === 'mps') {
    const n = num(raw);
    if (n === null) { problems.push(`${where}: "${raw}" is not a number; column skipped`); return; }
    put(patch, 'driveSpeedIps', n * 39.3701, 40, 200, where, problems);
    return;
  }
  if (kind === 'integer') {
    const n = num(raw);
    if (n === null) { problems.push(`${where}: "${raw}" is not a number; column skipped`); return; }
    patch.team = Math.round(n);
    return;
  }
  if (kind === 'text') {
    patch.name = String(raw).slice(0, 40);
    return;
  }
  if (kind === 'range') {
    const n = num(raw);
    if (n === null) { problems.push(`${where}: "${raw}" is not a number; column skipped`); return; }
    put(patch, field, n, Number(lo), Number(hi), where, problems);
    return;
  }
  problems.push(`${where}: no reader for "${spec}" — tell the maintainer`);
  void unit;
}

export function parseScouting(text) {
  const problems = [];
  const rows = [];
  const clean = String(text || '').replace(/^/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (lines.length < 2) {
    return { rows, problems: ['a CSV needs a header line and at least one robot'], unknown: [] };
  }
  const delim = headerDelim(clean);
  const head = splitLine(lines[0], delim);
  const spec = head.map((h, i) => {
    const key = norm(h);
    const found = LOOKUP.get(key);
    // The column record is kept as an array beside its index, not spread into an object: `applyKind` reads it
    // by position, and a spread would turn it into an object with numeric keys that no destructuring works on.
    if (found) return { idx: i, col: found };
    // A column this model refuses gets its reason and the name of the column that would have been read,
    // because "not a field" alone leaves a team with a spreadsheet and no idea what to do with it.
    if (REFUSALS[key]) problems.push(`column ${i + 1} "${h}" is deliberately not read: ${REFUSALS[key]}`);
    else problems.push(`column ${i + 1} "${h}" is not a field this model reads`);
    return null;
  });
  const unknown = head.filter((h, i) => !spec[i]);
  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r], delim);
    if (cells.length < 2) { problems.push(`row ${r}: one cell only, skipped`); continue; }
    const patch = {};
    for (const entry of spec) {
      if (!entry) continue;
      const raw = cells[entry.idx];
      if (raw === undefined || raw === '') continue;
      applyKind(entry.col, raw, patch, problems, `row ${r} (${entry.col[0]})`);
    }
    if (!Object.keys(patch).length) { problems.push(`row ${r}: nothing usable in it, skipped`); continue; }
    rows.push(patch);
  }
  return { rows, problems, unknown };
}

// A row arrives with the card's own flat names; a profile keeps `placeSec` and `placeDrop` nested, and the three
// outcome columns that are not card fields (`armSec`, `coralPerMatch`, `bargePoints`, plus a `netLift` written
// "yes") have to be turned into the numbers the engine reads. Doing it here rather than with an `Object.assign`
// in the page is what makes an imported measurement actually reach the machine instead of sitting on the card
// unread — and it is where each derivation gets *said*, because a card whose clock came from an arithmetic
// step nobody printed is not a card a team can argue with.
const r3 = (x) => Math.round(x * 1000) / 1000;

// `scaleProfile` is `model.js`'s own "one machine's whole clock, times one number", and the field that carries
// that number onto a card — `tempoFactor` — is allowed 0.3 to 3 by the codec. So that is the honest reach of an
// outcome column too: a row asking for more than that is not a slower ROBOT, it is a different game, and it is
// clamped with the number it asked for rather than drawn as one.
const SPEED_CAP = [1 / 3, 3];
function fitScale(want, where, note) {
  const s = Math.max(SPEED_CAP[0], Math.min(SPEED_CAP[1], want));
  if (s !== want) {
    note.push(`${where}: that would move the whole timeline by ×${round(want)}, past the ×0.33-×3 a card can hold; used ×${round(s)}`);
  }
  return s;
}

export function toCard(row, note = []) {
  const preset = row.team ? ROBOT_PRESETS.find((p) => p.profile.team === row.team) : null;
  // A team this build already models keeps its fitted clocks: the named presets were scaled onto a real
  // ledger, so #1690 Orbit with one new column is Orbit plus that column, not a generic card wearing a name.
  let base = preset ? JSON.parse(JSON.stringify(preset.profile)) : JSON.parse(JSON.stringify(SAMPLES[0]));
  if (!preset) note.push(`#${row.team ?? '?'} is not one of the ${ROBOT_PRESETS.length} modelled machines — built on the calibrated trio`);
  else note.push(`${preset.label}: kept its fitted clocks, took your columns`);

  // The mechanism half of a cycle: one stopwatch number, spread over the shipped ladder in its own proportions,
  // because a pit times the whole loop and does not break it down level by level. The drive leg stays the
  // engine's — it comes from the FIELD and the machine's own speed — which is why `cycle_s` is refused above.
  if (row.armSec !== undefined) {
    const own = base.pickSec + base.placeSec.L3;
    const k = fitScale(row.armSec / own, `arm ${row.armSec} s against this card's own ${r3(own)} s`, note);
    base.pickSec = r3(base.pickSec * k);
    for (const lv of ['L1', 'L2', 'L3', 'L4']) base.placeSec[lv] = r3(base.placeSec[lv] * k);
    note.push(`arm ${row.armSec} s → pick ${base.pickSec} s, place L1-L4 ${['L1', 'L2', 'L3', 'L4'].map((lv) => base.placeSec[lv]).join('/')} s (the drive stays the model's)`);
  }
  // A per-MATCH CORAL rate is honoured exactly the way `model.js` honoured the ones it built its named presets
  // from — `scaleProfile(base, REF_CORAL_PER_ROBOT / pieces)` — because a machine credited with 25 CORAL a
  // MATCH got them from shorter actions and cleaner paths, not from a longer AUTO. A file that carries
  // `teleop_coral` and `auto_coral` instead of the sum gets the same treatment, which is the sum `model.js`
  // used for its own `pieces`.
  const perMatch = row.coralPerMatch !== undefined
    ? row.coralPerMatch
    : row.teleopCoral !== undefined ? row.teleopCoral + (row.autoCycles ?? 0) : undefined;
  if (perMatch !== undefined) {
    const slow = fitScale(REF_CORAL_PER_ROBOT / perMatch, `${perMatch} CORAL a MATCH`, note);
    base = scaleProfile(base, slow);
    note.push(`${perMatch} CORAL a MATCH → the whole timeline ×${round(slow)} (the same fit ${ROBOT_PRESETS.length - SAMPLES.length} named machines in model.js were built with)`);
  }
  // `scaleProfile` multiplies, and a product of two rounded clocks is a long decimal. A pit measures to
  // milliseconds and the card is an editor, so this is the same rounding `model.js`'s own `presetRobot` applies
  // on the way in — without it the NET derivation below would print 1.0802952755905513 s to somebody who read
  // 1.08, and the card would carry a number nobody could retype.
  base.pickSec = r3(base.pickSec);
  base.algaeStripSec = r3(base.algaeStripSec);
  base.climbSec = r3(base.climbSec);
  base.netScoreSec = r3(base.netScoreSec);
  base.tempoFactor = r3(base.tempoFactor);
  for (const lv of ['L1', 'L2', 'L3', 'L4']) base.placeSec[lv] = r3(base.placeSec[lv]);
  const out = { ...base };
  delete out.key;
  delete out.ref;
  delete out.note;
  delete out.pieces;
  for (const k of ['driveSpeedIps', 'turnRateDegS', 'weightLb', 'pickSec', 'algaeStripSec', 'climbSec', 'climbSuccess', 'reliability', 'autoCycles', 'chassis', 'canClimbDeep']) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  for (const lv of ['L1', 'L2', 'L3', 'L4']) {
    if (row[`place${lv}`] !== undefined) out.placeSec[lv] = row[`place${lv}`];
    if (row[`drop${lv}`] !== undefined) out.placeDrop[lv] = row[`drop${lv}`];
  }
  if (row.netLift !== undefined) {
    // `yes` is not a second number, it is the derivation `model.js` documents above SAMPLES: a machine that
    // lands a CORAL at 72 in clears the NET's 76 in border (§5.4.2), and the ring is the wider piece.
    const yes = row.netLift === 'yes';
    out.netScoreSec = yes ? r3(out.placeSec.L4 + 0.5) : row.netLift;
    note.push(yes
      ? `NET reach = its own L4 (${out.placeSec.L4} s) + 0.5 s = ${out.netScoreSec} s`
      : (out.netScoreSec === 0 ? 'no NET reach: 0 s, so its ALGAE go through the PROCESSOR' : `NET lift ${out.netScoreSec} s`));
  }
  if (row.bargePoints !== undefined && row.canClimbDeep === undefined) {
    // Table 6-2 prices the ENDGAME at DEEP 12, SHALLOW 6, PARK 2, so the line between the two climb identities
    // sits between a parked ROBOT and a shallow one — 4 is their midpoint. `model.js` used the same reading:
    // of the fifteen named machines `model.js` ships, only the two teams at `barge_points` 2.79 and 2.56 lost
    // the DEEP hold and the next one up was 5.36. EPA credits a *contribution*, so a single ROBOT can read over
    // 12 (2910 is 12.97); that is why this is a threshold on a mean and not a tally divided by 12.
    out.canClimbDeep = row.bargePoints >= 4;
    note.push(`barge_points ${row.bargePoints} → ${out.canClimbDeep ? 'a DEEP hold' : 'no DEEP hold'} (Table 6-2: DEEP 12, SHALLOW 6, PARK 2, so the line is at 4)`);
  }
  // Two derivations compound — an `arm_s` and a `coral_per_match` in the same row each multiply the ladder, and
  // the product can leave a clock outside the ranges the card can be set to even though each step stayed inside
  // its own ×0.33-×3. This is the last gate before a row becomes a card, and it clips the drivetrain the way
  // `model.js` clips its own preset scale: a machine credited with 25 CORAL a MATCH did not get them by
  // outrunning every other robot by 50%, it got them from a faster mechanism and cleaner paths.
  const CLIP = [
    ['driveSpeedIps', 40, 200], ['turnRateDegS', 60, 900], ['pickSec', 0.3, 4], ['algaeStripSec', 0.4, 5],
    ['netScoreSec', 0, 6], ['climbSec', 0.5, 10],
  ];
  for (const [k, lo, hi] of CLIP) {
    const v = Math.max(lo, Math.min(hi, out[k]));
    if (v !== out[k]) {
      note.push(`${k} ${round(out[k])} is outside the ${lo}-${hi} a card can be set to; used ${round(v)}`);
      out[k] = round(v);
    }
  }
  for (const lv of ['L1', 'L2', 'L3', 'L4']) {
    const v = Math.max(0.1, Math.min(6, out.placeSec[lv]));
    if (v !== out.placeSec[lv]) {
      note.push(`place ${lv} ${round(out.placeSec[lv])} s is outside the 0.1-6 s a card can be set to; used ${v}`);
      out.placeSec[lv] = v;
    }
  }
  if (row.team) out.team = row.team;
  if (row.name) out.name = row.name;
  else if (preset) out.name = preset.profile.name;
  else out.name = `Scouted ${row.team ?? 'card'}`;
  return { profile: out, notes: note, matchedPreset: preset ? preset.key : null };
}

// Two ALLIANCES of three, filled in row order: the first three rows are Blue, the next three Red. A file with
// one row in it is a team asking about its own machine, so the rest of the field stays as it was — and that is
// reported too, because a batch run reads differently depending on whether the other side is a scouted trio or
// the shipped Johnson A1.
export function placeRosters(rows, current) {
  const next = { blue: current.blue.map((p) => ({ ...p })), red: current.red.map((p) => ({ ...p })) };
  const notes = [];
  const cards = rows.map((r) => toCard(r, notes));
  const filled = { blue: 0, red: 0 };
  cards.slice(0, 6).forEach((c, i) => {
    const side = i < 3 ? 'blue' : 'red';
    next[side][i % 3] = c.profile;
    filled[side] += 1;
  });
  if (cards.length > 6) notes.push(`${cards.length - 6} row(s) did not fit: the FIELD takes three ROBOTS an ALLIANCE, so they are not loaded`);
  if (cards.length < 6) notes.push(`the file filled Blue ${filled.blue}/3 and Red ${filled.red}/3; the other slots kept the cards they had`);
  return { trios: next, cards, notes };
}

