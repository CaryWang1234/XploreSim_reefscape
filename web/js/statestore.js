// The page's setup as bytes: one localStorage write and one shareable link, both the same encoding.
//
// What this fixes. The 2025 page carries more input than the 2026 one does — six ROBOT cards with sixteen
// numbers each, per-ROBOT presets, two HUMAN PLAYER blocks, three CAGE heights per ALLIANCE, twelve scenario
// switches and a batch seed — and none of it survived a refresh. A teammate who typed a real team's auto CORAL
// and cycle times into six cards lost them to a browser reload, and the only way to hand a setup to somebody
// else was the per-MATCH export, which carries a MATCH rather than the question that produced it.
//
// The link and the autosave are the same object through the same codec, so a link cannot restore anything the
// autosave would not.
//
// It touches no DOM and reads no storage: `ui.js` owns the inputs and the storage, this owns what bytes mean.
// That separation is what lets `scripts/runtime.test.mjs` attack the decoder directly, because everything that
// comes back out of a link or a years-old localStorage entry is hostile input — unknown keys dropped and named,
// numbers checked and clamped to a range a card can be built with, enums matched against the editor's own
// option lists, percentages kept in the model's units so no path has to guess which side divided by 100.
//
// A card is stored as a preset index plus the fields that differ from it, so a Johnson A1 lineup costs a few
// hundred bytes and only a Custom card costs its whole profile. Carrying `ref` and `key` would put provenance
// strings nobody edits into every link.

import { ROBOT_PRESETS, SAMPLES, CHASSIS, HUMAN_PLAYER, PRESETS, presetIndexOf } from './model.js';
import { POLICY_KINDS } from './league.js';

export const SETUP_VERSION = 'reefscape-setup-v1';
export const STORAGE_KEY = 'xplore-reefscape-setup-v1';
export const HASH_PREFIX = '#s=';
// A link has to survive being pasted into a chat app. Long Custom rosters compress badly, so a setup that
// cannot fit is refused with a sentence rather than silently truncated in the middle of a card.
export const MAX_LINK_CHARS = 16384;

// The numbers a ROBOT card can hold, in the units `model.js` stores them in (fractions for the two
// percentages, because the card shows an integer and divides on the way in — a codec that stored "97" for
// `reliability` would be a second unit system nobody asked for). The bounds are the editor's `min`/`max`
// widened a little, not rule limits: R103's 115 lb and R104's perimeter are enforced where they are modelled.
const NUMERIC = {
  driveSpeedIps: [10, 250],
  accelIpsS: [20, 500],
  turnRateDegS: [20, 1200],
  weightLb: [40, 130],
  pickSec: [0.05, 8],
  algaeStripSec: [0.05, 10],
  netScoreSec: [0, 10],
  climbSec: [0.1, 20],
  climbSuccess: [0, 1],
  reliability: [0.5, 1],
  placeTolDeg: [0, 90],
  tempoFactor: [0.3, 3],
};
// Two nested blocks the card edits level by level. They travel flat — `placeL3`, `dropL4` — the same names the
// UI's own field table uses, and are re-nested on the way out so a link cannot invent a fifth level.
const LEVELS_FLAT = {
  place: { prefix: 'place', key: 'placeSec', range: [0.05, 8] },
  drop: { prefix: 'drop', key: 'placeDrop', range: [0, 0.9] },
};
const LEVEL_NAMES = ['L1', 'L2', 'L3', 'L4'];
const INTEGERS = { autoCycles: [0, 10] };
const CHOICE = {
  // `chassis` is the only picker on a card whose options come from a list the editor builds; `check_web.mjs`
  // holds this against the model so a value no select can show never reaches a card.
  chassis: Object.keys(CHASSIS),
};
const BOOL = ['canClimbDeep'];

// Every key a card may have at all. `name` and `team` travel because the CSV importer writes them; `key`,
// `ref` and `pieces` are provenance or construction inputs, not card fields. The eight flat level names are
// the wire form of the two nested blocks, so they are part of what a card may carry.
const PROFILE_KEYS = new Set([
  ...Object.keys(NUMERIC),
  ...Object.keys(INTEGERS),
  ...Object.keys(CHOICE),
  ...BOOL,
  'placeSec',
  'placeDrop',
  ...LEVEL_NAMES.flatMap((lv) => [`place${lv}`, `drop${lv}`]),
  'name',
  'team',
  // Present on every shipped profile and read by nothing in web/js or scripts — carried so a Custom card does
  // not lose data on a round trip, and deliberately not edited by the page.
  'intake',
]);
// ...but "may hold" is not "may be assigned unexamined". Everything in this set reaches a card through the
// clamping loops below rather than through the Custom-card copy, because that copy is the one place a link's
// value would otherwise land on a profile untouched — a fractional `autoCycles` or a `climbSuccess` of 5 is a
// number the engine has no branch for.
const VALIDATED = new Set([
  ...Object.keys(NUMERIC),
  ...Object.keys(INTEGERS),
  ...Object.keys(CHOICE),
  ...BOOL,
  ...LEVEL_NAMES.flatMap((lv) => [`place${lv}`, `drop${lv}`]),
]);

// The twelve switches the setup panel holds, keyed by what `ui.js` reads off them rather than by the derived
// scenario field, so applying a link is "set the controls, then ask the page for its scenario" — one mapping,
// not two that can disagree.
const SWITCHES = [
  'fouls',
  'qual',
  'hpNet',
  'turnRamp',
  'contact',
  'placeRisk',
  'detour',
  'carryDrop',
  'branchDedup',
  'climbRisk',
  'contactFouls',
  'cardLadder',
  'mirror',
];
const NUM = ['jitter', 'seed', 'matches', 'batchSeed'];
const HP_KEYS = { accuracy: [0, 1], throwSec: [0, 10], feedSec: [0.05, 12], storage: [1, 8] };

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const clone = (p) => JSON.parse(JSON.stringify(p));
// A setup whose roster could not be read comes back as the lineup the page itself opens with — Johnson A1 on
// blue, Newton A1 on red, the 2025 Einstein Field final — rather than a half-decoded trio. Cloned, because
// `PRESETS` holds the same objects the preset pickers hand out.
const trioOf = (key) => (PRESETS.find((p) => p.key === key)?.trio || SAMPLES).map(clone);

// ---- one card -------------------------------------------------------------------------------
// A card as a preset plus its differences. `-1` is Custom, which has no preset to diff against.
export function packProfile(prof) {
  const idx = presetIndexOf(prof);
  const base = idx >= 0 ? ROBOT_PRESETS[idx].profile : SAMPLES[0];
  const diff = {};
  for (const key of Object.keys(NUMERIC)) {
    if (prof?.[key] !== undefined && prof[key] !== base[key]) diff[key] = prof[key];
  }
  for (const key of Object.keys(INTEGERS)) {
    if (prof?.[key] !== undefined && prof[key] !== base[key]) diff[key] = prof[key];
  }
  for (const key of Object.keys(CHOICE)) {
    if (prof?.[key] !== base[key]) diff[key] = prof[key];
  }
  for (const key of BOOL) {
    if (!!prof?.[key] !== !!base?.[key]) diff[key] = !!prof[key];
  }
  for (const { prefix, key } of Object.values(LEVELS_FLAT)) {
    for (const lv of LEVEL_NAMES) {
      const a = prof?.[key]?.[lv] ?? 0;
      const b = base?.[key]?.[lv] ?? 0;
      if (Math.abs(a - b) > 1e-9) diff[`${prefix}${lv}`] = a;
    }
  }
  if (prof?.intake !== base?.intake) diff.intake = prof.intake;
  if (prof?.team !== base?.team) diff.team = prof.team;
  if (prof?.name !== base?.name) diff.name = prof.name;
  if (idx >= 0) return { p: idx, d: diff };
  // A Custom card carries its whole self, minus provenance, and it is assembled key by key through the
  // whitelist rather than with `Object.assign`: `__proto__` is an own enumerable property of a JSON.parse'd
  // object, and assigning it is a prototype write — a link would otherwise be a way to reach into the page's
  // object graph from someone's clipboard. The two nested blocks are written as their eight flat numbers for
  // the same reason: a hand-edited link then has to pass through the same clamp every preset diff passes
  // through, and cannot hand the decoder an object of its own choosing.
  const full = {};
  for (const k of PROFILE_KEYS) {
    if (k === 'ref' || k === 'key' || k === 'pieces' || k === 'placeSec' || k === 'placeDrop') continue;
    if (prof?.[k] !== undefined) full[k] = prof[k];
  }
  for (const { prefix, key } of Object.values(LEVELS_FLAT)) {
    for (const lv of LEVEL_NAMES) full[`${prefix}${lv}`] = prof?.[key]?.[lv] ?? 0;
  }
  return { p: -1, d: full };
}

export function unpackProfile(row, problems) {
  const idx = Number.isInteger(row?.p) && row.p >= 0 && row.p < ROBOT_PRESETS.length ? row.p : -1;
  const base = idx >= 0 ? ROBOT_PRESETS[idx].profile : SAMPLES[0];
  let out = clone(base);
  const d = row?.d && typeof row.d === 'object' ? row.d : {};
  if (row?.p === -1) {
    const fresh = clone(base);
    for (const [k, v] of Object.entries(d)) {
      if (k === 'ref' || k === 'key' || k === 'pieces') continue;
      // The level numbers arrive flat and are clamped below; a nested object from a link is not a thing this
      // page ever writes, so it is refused rather than trusted to have the right shape.
      if (k === 'placeSec' || k === 'placeDrop') {
        const pfx = k === 'placeSec' ? 'place' : 'drop';
        problems.push(`a Custom card carried "${k}" as an object; its levels come as ${LEVEL_NAMES.map((lv) => pfx + lv).join(', ')}`);
        continue;
      }
      // The flat level names are the wire form, not profile fields: they are clamped into `placeSec`/
      // `placeDrop` by the loop below, so copying them here would leave a card carrying `placeL4` beside the
      // `placeSec` the engine actually reads. The same reason covers every other validated field — a Custom
      // card's numbers take the clamp path, or they are not validated at all.
      if (/^(place|drop)L[1-4]$/.test(k)) continue;
      if (VALIDATED.has(k)) continue;
      if (!PROFILE_KEYS.has(k)) {
        problems.push(`a Custom card carries "${k}", which no card field is called; dropped`);
        continue;
      }
      fresh[k] = v;
    }
    // A hand-typed card is not anybody's reference machine, so the provenance the diff base carries is
    // stripped on the way out: `key` and `ref` name presets this card no longer is. Nothing in the engine or
    // the page reads them — `presetIndexOf` compares the numbers — so the only thing they can do is mislabel.
    delete fresh.key;
    delete fresh.ref;
    out = fresh;
  }
  for (const [key, range] of Object.entries(NUMERIC)) {
    if (!(key in d)) continue;
    const v = Number(d[key]);
    if (!isFiniteNumber(v)) {
      problems.push(`${key}="${d[key]}" is not a number; kept the ${idx >= 0 ? 'preset' : 'default'} value`);
      continue;
    }
    if (v < range[0] || v > range[1]) {
      out[key] = Math.min(range[1], Math.max(range[0], v));
      problems.push(`${key} ${v} is outside ${range[0]}–${range[1]}; clamped to ${out[key]}`);
    } else out[key] = v;
  }
  for (const [key, range] of Object.entries(INTEGERS)) {
    if (!(key in d)) continue;
    const v = Number(d[key]);
    if (!Number.isInteger(v) || v < range[0] || v > range[1]) {
      problems.push(`${key} ${d[key]} is not a whole number in ${range[0]}–${range[1]}; that card keeps ${out[key]}`);
      continue;
    }
    out[key] = v;
  }
  for (const [key, allowed] of Object.entries(CHOICE)) {
    if (!(key in d)) continue;
    if (typeof d[key] === 'string' && allowed.includes(d[key])) out[key] = d[key];
    else problems.push(`${key}="${d[key]}" is not a drivetrain the editor offers (${allowed.join(', ')}); kept ${out[key]}`);
  }
  for (const key of BOOL) {
    if (!(key in d)) continue;
    if (typeof d[key] === 'boolean') out[key] = d[key];
    else problems.push(`${key}="${d[key]}" is not a yes/no; kept ${!!out[key]}`);
  }
  for (const { prefix, key, range } of Object.values(LEVELS_FLAT)) {
    for (const lv of LEVEL_NAMES) {
      const name = `${prefix}${lv}`;
      if (!(name in d)) continue;
      const v = Number(d[name]);
      if (!isFiniteNumber(v)) {
        problems.push(`${name}="${d[name]}" is not a number; kept ${out[key]?.[lv] ?? 0}`);
        continue;
      }
      if (v < range[0] || v > range[1]) {
        out[key] = { ...(out[key] || {}), [lv]: Math.min(range[1], Math.max(range[0], v)) };
        problems.push(`${name} ${v} is outside ${range[0]}–${range[1]}; clamped to ${out[key][lv]}`);
      } else out[key] = { ...(out[key] || {}), [lv]: v };
    }
  }
  if (typeof d.intake === 'string' && d.intake.length <= 12) out.intake = d.intake;
  if (Number.isInteger(d.team) && d.team >= 0 && d.team <= 99999) out.team = d.team;
  if (typeof d.name === 'string' && d.name.length <= 40) out.name = d.name;
  // Anything else a row carries is dropped here rather than assigned and then discovered. Say which: a link
  // that quietly lost a field is worse than one that refuses.
  const known = new Set([
    ...Object.keys(NUMERIC),
    ...Object.keys(INTEGERS),
    ...Object.keys(CHOICE),
    ...BOOL,
    ...LEVEL_NAMES.flatMap((lv) => [`place${lv}`, `drop${lv}`]),
    'intake',
    'team',
    'name',
  ]);
  const unknown = Object.keys(d).filter((k) => !known.has(k) && k !== 'ref' && k !== 'key' && k !== 'pieces');
  if (unknown.length && row?.p !== -1) {
    problems.push(`a card carries field(s) ${unknown.map((k) => `"${k}"`).join(', ')} that no card has; dropped`);
  }
  return out;
}

// ---- the whole setup -------------------------------------------------------------------------
export function buildSetup({ trios, hp, cageDepth, kinds, switches, numbers }) {
  const problems = [];
  const packSide = (side) => [0, 1, 2].map((i) => packProfile(trios?.[side]?.[i]));
  const sw = {};
  for (const key of SWITCHES) {
    if (typeof switches?.[key] === 'boolean') sw[key] = switches[key];
    else problems.push(`switch "${key}" is not a yes/no; left as the page has it`);
  }
  const num = (key, lo, hi, integer = false) => {
    const v = Number(numbers?.[key]);
    if (!isFiniteNumber(v)) return null;
    if (integer) return Math.max(lo, Math.min(hi, Math.round(v)));
    return Math.max(lo, Math.min(hi, v));
  };
  const hpSide = (side) => {
    const src = hp?.[side] || {};
    const out = {};
    for (const [key, [lo, hi]] of Object.entries(HP_KEYS)) {
      const v = Number(src[key]);
      out[key] = isFiniteNumber(v) ? Math.max(lo, Math.min(hi, v)) : HUMAN_PLAYER[key];
    }
    return out;
  };
  const cage = (side) => [0, 1, 2].map((i) => !!cageDepth?.[side]?.[i]);
  return {
    v: SETUP_VERSION,
    blue: packSide('blue'),
    red: packSide('red'),
    mirror: !!sw.mirror,
    kind: {
      blue: POLICY_KINDS.includes(kinds?.blue) ? kinds.blue : 'greedy',
      red: POLICY_KINDS.includes(kinds?.red) ? kinds.red : 'greedy',
    },
    switches: sw,
    jitter: num('jitter', 0, 60),
    seed: num('seed', 1, 4294967295, true),
    matches: num('matches', 2, 600, true),
    batchSeed: num('batchSeed', 1, 4294967295, true),
    hp: { blue: hpSide('blue'), red: hpSide('red') },
    cageDepth: { blue: cage('blue'), red: cage('red') },
    problems,
  };
}

// The decode path: bytes in, a setup out, or nothing. Everything is re-validated here rather than trusted from
// `buildSetup`, because the bytes may be years old, hand-edited, or somebody's guess.
export function readSetup(obj) {
  const problems = [];
  if (!obj || typeof obj !== 'object') return { setup: null, problems: ['the stored setup is not an object'] };
  if (obj.v !== SETUP_VERSION) {
    return { setup: null, problems: [`stored setup is version ${String(obj.v)}, this page writes ${SETUP_VERSION}`] };
  }
  const trios = {};
  for (const side of ['blue', 'red']) {
    const rows = Array.isArray(obj[side]) ? obj[side] : [];
    if (rows.length !== 3) {
      problems.push(`${side} has ${rows.length} ROBOTS; a MATCH needs three`);
      continue;
    }
    trios[side] = rows.map((r) => unpackProfile(r, problems));
  }
  if (!trios.blue) trios.blue = trioOf('johnson');
  if (!trios.red) trios.red = trioOf('newton');
  const switches = {};
  for (const key of SWITCHES) {
    if (typeof obj.switches?.[key] === 'boolean') switches[key] = obj.switches[key];
    else if (obj.switches?.[key] !== undefined) problems.push(`switch "${key}" arrived as ${JSON.stringify(obj.switches[key])}, not a yes/no; left as the page has it`);
  }
  const clampNum = (v, lo, hi, integer) => {
    const n = Number(v);
    if (!isFiniteNumber(n)) return null;
    const c = Math.max(lo, Math.min(hi, n));
    return integer ? Math.round(c) : c;
  };
  const numbers = {};
  for (const key of NUM) {
    const v = clampNum(obj[key], key === 'jitter' ? 0 : 1, key === 'jitter' ? 60 : key === 'matches' ? 600 : 4294967295, key !== 'jitter');
    if (v !== null) numbers[key] = v;
    else if (obj[key] !== undefined) problems.push(`${key}="${obj[key]}" is not a number; left as the page has it`);
  }
  const kindFor = (side) => {
    const raw = obj.kind?.[side];
    if (POLICY_KINDS.includes(raw)) return raw;
    if (raw !== undefined) problems.push(`${side} policy "${raw}" is not one this build has; kept greedy`);
    return 'greedy';
  };
  const hp = {};
  for (const side of ['blue', 'red']) {
    // Built in HP_KEYS order, exactly as `buildSetup` writes it, so applying a link and reading the page again
    // gives byte-identical bytes. `sameSetup` compares JSON text, and a key order that flipped would make the
    // autosave write on a setup that had not changed.
    hp[side] = {};
    for (const [key, [lo, hi]] of Object.entries(HP_KEYS)) {
      const raw = obj.hp?.[side]?.[key];
      if (raw === undefined) {
        hp[side][key] = HUMAN_PLAYER[key];
        continue;
      }
      const v = Number(raw);
      if (!isFiniteNumber(v)) {
        problems.push(`hp.${side}.${key}="${raw}" is not a number; kept ${HUMAN_PLAYER[key]}`);
        hp[side][key] = HUMAN_PLAYER[key];
        continue;
      }
      if (v < lo || v > hi) {
        hp[side][key] = Math.max(lo, Math.min(hi, v));
        problems.push(`hp.${side}.${key} ${v} is outside ${lo}–${hi}; clamped to ${hp[side][key]}`);
      } else hp[side][key] = v;
    }
  }
  const cageDepth = {};
  for (const side of ['blue', 'red']) {
    const rows = Array.isArray(obj.cageDepth?.[side]) ? obj.cageDepth[side] : [];
    cageDepth[side] = [0, 1, 2].map((i) => (typeof rows[i] === 'boolean' ? rows[i] : true));
    if (rows.length !== 3 && obj.cageDepth?.[side] !== undefined) problems.push(`${side} cageDepth had ${rows.length} entries; the CAGE list has three`);
  }
  return {
    setup: {
      v: SETUP_VERSION,
      trios,
      mirror: !!obj.mirror,
      kind: { blue: kindFor('blue'), red: kindFor('red') },
      switches,
      numbers,
      hp,
      cageDepth,
    },
    problems,
  };
}

// ---- bytes -----------------------------------------------------------------------------------
// Pure base64url over UTF-8, no `btoa` and no `Buffer`, so the same codec runs in the page and in the Node
// test. `+` and `/` become `-` and `_` and padding is dropped, because this goes in a URL fragment.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '';
  }
  return out;
}

export function decode(text) {
  const clean = String(text || '').replace(/^#s=/, '');
  if (!clean) return { obj: null, error: 'empty' };
  let bits = '';
  for (const ch of clean) {
    const i = B64.indexOf(ch);
    if (i < 0) return { obj: null, error: `${JSON.stringify(ch)} is not base64url` };
    bits += i.toString(2).padStart(6, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  let json;
  try {
    json = new TextDecoder().decode(bytes);
  } catch (e) {
    return { obj: null, error: 'the bytes are not UTF-8' };
  }
  try {
    return { obj: JSON.parse(json), error: null };
  } catch (e) {
    return { obj: null, error: 'it is not JSON inside the link' };
  }
}

export function toLink(setup) {
  const text = encode(setup);
  if (text.length > MAX_LINK_CHARS) {
    return { link: null, chars: text.length, error: `this setup needs ${text.length} characters of link, over the ${MAX_LINK_CHARS} this page will write` };
  }
  return { link: HASH_PREFIX + text, chars: text.length, error: null };
}

// A setup is a question, not a result: two setups that differ only in fields the engine never reads are the
// same thing to save twice. This keeps the autosave from writing on every keystroke that changed nothing.
export function sameSetup(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
