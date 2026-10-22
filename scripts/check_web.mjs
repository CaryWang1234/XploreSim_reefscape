// Static guard for the shipped web bundle: encoding, and HTML tag balance.
//
// Two accidents this repo has actually had: a file written through a shell redirect came out as
// mojibake, and an edit to index.html deleted the opening tags of the neighbouring <details> block.
// Both rendered fine in a local browser until the text was unreadable or a section vanished, so they
// are checked here rather than eyeballed. Run with `npm run check` before publishing.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTML = 'web/index.html';
const JS_DIR = 'web/js';

// Byte sequences that only appear when UTF-8 text has been read as latin-1 and re-encoded, or when a
// decoder substituted U+FFFD. A real page never contains them.
const MOJIBAKE = ['â€', 'Ã©', 'Ã¨', 'Ã¼', 'å­', 'æµ', 'ä¸­', 'çš„', 'è¡¨', '\ufeff'];
const REPLACEMENT = Buffer.from([0xef, 0xbf, 0xbd]);

// The tags index.html uses as containers. Void elements are excluded because they have no close tag.
const TAGS = ['details', 'summary', 'div', 'p', 'label', 'select', 'option', 'strong', 'span', 'em', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'ul', 'li', 'section', 'aside', 'main', 'header', 'footer', 'button', 'h1', 'h2', 'h3'];

let bad = 0;
const fail = (msg) => { console.log('FAIL ' + msg); bad++; };

const files = [HTML, 'web/styles.css', 'package.json', '.gitignore', 'README.md', 'OPTIMIZATION.md']
  .map((f) => path.join(ROOT, f))
  .concat(fs.readdirSync(path.join(ROOT, JS_DIR)).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, JS_DIR, f)))
  // The prose and the measurement scripts are where the Chinese and the §-citations live, and a shell redirect
  // has turned a source file into mojibake twice here — so they get the same encoding scan as the page.
  .concat(fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs') || f.endsWith('.json')).map((f) => path.join(ROOT, 'scripts', f)))
  .concat(fs.existsSync(path.join(ROOT, 'docs'))
    ? fs.readdirSync(path.join(ROOT, 'docs')).map((f) => path.join(ROOT, 'docs', f))
    : []);

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (!fs.existsSync(f)) { fail(`${rel} is listed but missing`); continue; }
  const buf = fs.readFileSync(f);
  const txt = buf.toString('utf8');
  if (buf.includes(REPLACEMENT)) fail(`${rel} contains U+FFFD, the decoder replacement character`);
  // The guard holds each mojibake sequence as a literal, so it would find them in itself; the sequences are what
  // is being looked for, not evidence about this file. U+FFFD — a byte that never appears by accident — still is.
  if (rel === 'scripts/check_web.mjs') continue;
  for (const pat of MOJIBAKE) if (txt.includes(pat)) fail(`${rel} contains ${JSON.stringify(pat)}: mojibake`);
}

const html = fs.readFileSync(path.join(ROOT, HTML), 'utf8');
for (const tag of TAGS) {
  const open = (html.match(new RegExp('<' + tag + '(?=[\\s>])', 'g')) || []).length;
  const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  if (open !== close) fail(`<${tag}> opens ${open} times and closes ${close} times`);
}

// A module that does not parse renders as a blank page with an EMPTY console in the in-app browser,
// which is how one unescaped apostrophe in a UI string hid for a whole session. `node --check` is the
// parser, so it is asked directly instead of pattern-matching quotes.
for (const name of fs.readdirSync(path.join(ROOT, JS_DIR))) {
  if (!name.endsWith('.js')) continue;
  const out = spawnSync(process.execPath, ['--check', path.join(ROOT, JS_DIR, name)], { encoding: 'utf8' });
  if (out.status !== 0) fail(`${name} does not parse: ${(out.stderr || '').split('\n').slice(0, 3).join(' / ')}`);
}
for (const name of fs.readdirSync(path.join(ROOT, 'scripts'))) {
  if (!name.endsWith('.mjs')) continue;
  const out = spawnSync(process.execPath, ['--check', path.join(ROOT, 'scripts', name)], { encoding: 'utf8' });
  if (out.status !== 0) fail(`scripts/${name} does not parse: ${(out.stderr || '').split('\n').slice(0, 3).join(' / ')}`);
}

// The batch cap is three things that have to say the same number: the constant the worker refuses to exceed,
// the `max` each input publishes, and the ceiling the page tells the reader about. A mismatch is an input that
// silently rounds a request down, or a hint that promises more than the run will do.
{
  const sim = fs.readFileSync(path.join(ROOT, JS_DIR, 'simulation.js'), 'utf8');
  const cap = Number(sim.match(/export const MAX_BATCH = (\d+)/)?.[1]);
  if (!Number.isInteger(cap)) fail('simulation.js has no `export const MAX_BATCH = <n>` for the batch cap');
  else {
    for (const id of ['inp-matches', 'inp-replay-match']) {
      const m = html.match(new RegExp('id="' + id + '"[^>]*\\bmax="(\\d+)"'));
      if (!m) fail(`#${id} has no max attribute for the batch cap ${cap}`);
      else if (Number(m[1]) !== cap) fail(`#${id} publishes max=${m[1]} while simulation.js caps a batch at ${cap}`);
    }
  }
}

// The single-MATCH ledger (#129) is one contract in three files: engine.js has to hand the counters over on
// the per-ROBOT record, ui.js has to read them and ask for the elements, and index.html has to carry those
// elements. A missing id is a table that stays empty, which reads as a MATCH with no data rather than as a
// broken page — the one failure mode this file can cheaply rule out by looking for the strings.
{
  const eng = fs.readFileSync(path.join(ROOT, JS_DIR, 'engine.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, JS_DIR, 'ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'web', 'styles.css'), 'utf8');
  for (const key of ['pickedFrom', 'strippedFrom', 'pickMisses', 'heldSec', 'fullSec', 'fullMiss', 'busySec', 'movedFt', 'droveFt']) {
    if (!eng.includes(`${key}:`)) fail(`engine.js no longer exports ${key} on the per-ROBOT record`);
    if (!ui.includes(key)) fail(`ui.js never reads ${key}, so the ledger column it belongs to prints nothing`);
  }
  for (const id of ['tbl-flow', 'tbl-work', 'flow-note', 'rp-live']) {
    if (!html.includes(`id="${id}"`)) fail(`#${id} is not in index.html — the ledger has nowhere to render`);
    if (!ui.includes(`'${id}'`)) fail(`ui.js never asks for #${id}`);
  }
  // The live REEF line is a reading aid, so Fill and Fullscreen drop it the same way they drop the ledger
  // boxes under the transport bar. Without the rule the FIELD layout grows a line and the canvas loses it.
  if (!css.includes('#rp-live')) fail('styles.css no longer hides #rp-live in the Fill and Fullscreen layouts');
}

// #130: the five single-MATCH charts. The derivations live in a module that touches no DOM — that is what lets
// runtime.test.mjs run them against a real record instead of trusting the drawing — ui.js imports and calls
// them, and index.html carries the five canvases and the line under them. The last check keeps this true: a
// chart library would arrive as a <script src>, and the page has to load with no network at all.
{
  const ui = fs.readFileSync(path.join(ROOT, JS_DIR, 'ui.js'), 'utf8');
  const data = fs.readFileSync(path.join(ROOT, JS_DIR, 'chartdata.js'), 'utf8');
  if (!ui.includes("from './chartdata.js'")) fail('ui.js does not import chartdata.js, so the charts have no data source');
  for (const fn of ['scoreSeries', 'periodBands', 'stockSeries', 'supplySeries', 'actionBands', 'robotRows', 'sourceRows']) {
    if (!data.includes(`export function ${fn}`)) fail(`chartdata.js no longer exports ${fn}, which ui.js draws`);
    if (!ui.includes(`${fn}(`)) fail(`ui.js never calls ${fn}`);
  }
  if (data.includes('document.') || data.includes('window.')) fail('chartdata.js touches the DOM, so runtime.test.mjs cannot run the derivations');
  // The legend line names the actions, so the import list has to carry that list too. Missing it is not a
  // broken caption: the throw lands in the middle of showMatch, and everything after the charts stops rendering.
  const chartImport = ui.match(/import \{([^}]*)\} from '\.\/chartdata\.js'/);
  if (!chartImport || !chartImport[1].includes('ACTION_ORDER')) fail('ui.js does not import ACTION_ORDER from chartdata.js, which its chart legend names');
  for (const id of ['chart-trend', 'chart-stock', 'chart-supply', 'chart-roles', 'chart-picks', 'chart-shape-note']) {
    if (!html.includes(`id="${id}"`)) fail(`#${id} is not in index.html — that chart has nowhere to draw`);
    if (!ui.includes(`'${id}'`)) fail(`ui.js never asks for #${id}`);
  }
  // A canvas inside a `hidden` panel has no box to draw into, so entering the panel and resizing both have to
  // repaint; without the calls the page shows four charts at the 320 px fallback width forever.
  if (!ui.includes("if (name === 'numbers') redrawMatchCharts();")) fail('showTab never redraws the MATCH charts when the Numbers panel opens');
  for (const rung of ['L2', 'L3', 'L4', 'trough']) {
    if (!data.includes(`r.${rung}`)) fail(`chartdata.js no longer reads the ${rung} occupancy the frame carries`);
  }
  for (const lib of ['cdn.', 'jsdelivr', 'unpkg', 'chart.js', 'echarts']) {
    if (html.includes(lib) || ui.includes(lib)) fail(`the page references ${lib}: charts are hand-drawn and must load offline`);
  }
}

// This round's RP contract. The batch legend is five rows of prose beside five bars, and it spent a while
// claiming "≥3 CORAL placed in AUTO", "4 CORAL at each of L2-L4" and "≥12 BARGE points" — three numbers that
// are not in Table 6-2 and not what `engine.js` grades (1, 7 on each of four levels or three with Coopertition,
// and 16). So: the array may not contain a digit outside an interpolation, it must name the four constants, and
// `scripts/rp.mjs` — which regrades every MATCH of a batch out of `POINTS` and compares with the engine — has
// to stay wired into `npm run validate`. The gift path is checked the same way: `engine.js` exports `rpAward`
// and the Numbers row reads it, because a BARGE RP the opponent handed over and one the CAGEs earned both
// printed as `1`.
{
  const ui = fs.readFileSync(path.join(ROOT, JS_DIR, 'ui.js'), 'utf8');
  const eng = fs.readFileSync(path.join(ROOT, JS_DIR, 'engine.js'), 'utf8');
  const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  const audit = fs.readFileSync(path.join(ROOT, 'scripts', 'rp.mjs'), 'utf8');
  const block = ui.match(/const rpRows = \[[\s\S]*?\n  \];/)?.[0];
  if (!block) fail('ui.js no longer has the batch RP legend array this guard reads');
  else {
    const bare = block
      .replace(/\$\{[^}]*\}/g, '')
      .replace(/Table 6-2/g, '') // a clause citation is not a threshold; every other digit in there is
      .replace(/§[\d.]+/g, '');
    const digits = bare.match(/\d/g);
    if (digits) fail(`the RP legend hard-codes ${[...new Set(digits)].join('')} — thresholds come from POINTS/LEVELS, or the caption drifts from the grading again`);
    for (const c of ['POINTS.autoRpMinCoral', 'POINTS.coralRpThresholdPerLevel', 'POINTS.coralRpLevelsWithCoop', 'POINTS.bargeRpThreshold', 'POINTS.rp.win', 'POINTS.rp.tie', 'LEVELS.length']) {
      if (!block.includes(c)) fail(`the RP legend stopped naming ${c}, which is the number the engine graded with`);
    }
    if (!ui.includes('it separated nobody')) fail('ui.js no longer says out loud what a bar every ALLIANCE crossed means');
  }
  if (!eng.includes('rpAward: {')) fail('engine.js stopped exporting which RP a MAJOR foul gifted');
  if (!ui.includes('s.rpAward')) fail('ui.js never reads rpAward, so a gifted RP prints as an earned one');
  if (!/"validate": "[^"]*npm run rp/.test(pkg)) fail('package.json runs validate without the RP audit — its per-MATCH regrading is the only thing that catches a grading drift');
  for (const c of ['POINTS.autoRpMinCoral', 'POINTS.coralRpThresholdPerLevel', 'POINTS.bargeRpThreshold', 'rpAward']) {
    if (!audit.includes(c)) fail(`scripts/rp.mjs no longer reads ${c}: the audit would be regrading something other than what the engine grades`);
  }
  // One RP column, because the manual prints one. Table 6-2's footnote says the CORAL and BARGE bars "may
  // increase" at District/Championship and gives no number, and `objective`/`event` were keys nothing read.
  // If a future manual does publish a second column, this is the guard that has to be replaced by a real one.
  const model = fs.readFileSync(path.join(ROOT, JS_DIR, 'model.js'), 'utf8');
  const scenario = model.match(/export function defaultScenario\(\) \{[\s\S]*?\n  \};/)?.[0] || '';
  for (const dead of ['objective:', 'event:']) {
    if (scenario.includes(dead)) fail(`defaultScenario carries ${dead} again — nothing in web/js or scripts reads it, and no 2025 clause gives a second RP column`);
  }
}

// §6.6.2's card ladder is one rule with four homes, and the pair that broke silently before it was measured
// was the switch and the checkbox: `engine.js` converts, `model.js` ships it on, `ui.js` reads the box into the
// scenario, `index.html` carries the box, and `scripts/cards.mjs` prices it. Any missing link is a control that
// lies to the reader — a box that changes nothing, or a measured price with no box to reproduce.
{
  const ui = fs.readFileSync(path.join(ROOT, JS_DIR, 'ui.js'), 'utf8');
  const eng = fs.readFileSync(path.join(ROOT, JS_DIR, 'engine.js'), 'utf8');
  const model = fs.readFileSync(path.join(ROOT, JS_DIR, 'model.js'), 'utf8');
  const audit = fs.readFileSync(path.join(ROOT, 'scripts', 'cards.mjs'), 'utf8');
  if (!html.includes('id="chk-cardladder"')) fail('index.html lost the second-YELLOW checkbox');
  if (!ui.includes("$('chk-cardladder')")) fail('ui.js never reads #chk-cardladder, so the box is decoration');
  if (!ui.includes('cardLadder:')) fail('ui.js no longer puts cardLadder into the scenario');
  if (!model.includes('cardLadder: true')) fail('model.js no longer ships the ladder ON, which is the rule');
  if (!eng.includes('st.scenario.cardLadder && rb.yellow >= 2')) fail('engine.js no longer gates the second-yellow conversion on the switch');
  for (const needle of ['cardLadder', 'defendSlots', 'contactImpairP']) {
    if (!audit.includes(needle)) fail(`scripts/cards.mjs no longer reads ${needle}: it would be pricing something other than the shipped mechanism`);
  }
  if (!/"cards": "node scripts\/cards.mjs"/.test(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))) fail('package.json has no `npm run cards`, so the price has no reproducible print');
}

// The setup codec and the controls it is allowed to touch. `statestore.js` is DOM-free on purpose — that is
// what lets runtime.test.mjs attack a hostile link — so this is where the two halves are held together: every
// switch the codec can carry must be a checkbox the page has, and a checkbox the page has must be read by
// something other than the codec, or the link stores a setting nothing runs with.
{
  const store = fs.readFileSync(path.join(ROOT, JS_DIR, 'statestore.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, JS_DIR, 'ui.js'), 'utf8');
  for (const bad of ['document.', 'window.', 'localStorage.']) {
    if (store.includes(bad)) fail(`statestore.js contains ${bad}: the codec must stay runnable outside a browser`);
  }
  const declared = [...store.matchAll(/const SWITCHES = \[([\s\S]*?)\];/g)][0];
  if (!declared) fail('statestore.js has no SWITCHES list to compare the page against');
  const names = declared ? [...declared[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]) : [];
  const idBlock = ui.match(/const SWITCH_IDS = \{([\s\S]*?)\};/);
  if (!idBlock) fail('ui.js has no SWITCH_IDS map, so the autosave cannot read the switches the codec names');
  const mapPairs = [...(idBlock ? idBlock[1].matchAll(/^\s*([a-zA-Z]+): '([a-z0-9-]+)',/gm) : [])].map((m) => [m[1], m[2]]);
  const mapped = mapPairs.map(([k]) => k);
  for (const n of names) if (!mapped.includes(n)) fail(`the codec carries "${n}" but ui.js has no control for it`);
  for (const n of mapped) if (!names.includes(n)) fail(`ui.js maps "${n}" to a control the codec will not carry`);
  for (const [name, id] of mapPairs) {
    const inHtml = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
    if (inHtml !== 1) fail(`#${id} for the "${name}" switch appears ${inHtml} times in index.html`);
    const reads = (ui.match(new RegExp(`'${id}'`, 'g')) || []).length;
    if (reads < 2) fail(`#${id} is in the capture map but nothing else reads it — the switch is stored and never used`);
  }
  if (!ui.includes("from './statestore.js'")) fail('ui.js does not import statestore.js');
  for (const fn of ['buildSetup as packSetup', 'readSetup', 'encode', 'decode', 'toLink', 'STORAGE_KEY', 'HASH_PREFIX']) {
    const importLine = ui.match(/import \{[^}]*\} from '\.\/statestore\.js'/)?.[0] || '';
    if (!importLine.includes(fn)) fail(`ui.js does not import ${fn} from statestore.js`);
  }
  for (const [btn, fn] of [['btn-copy-link', 'copySetupLink'], ['btn-forget', 'forgetSetup'], ['setup-store', 'setupLine']]) {
    if (!html.includes(`id="${btn}"`)) fail(`index.html has no #${btn}`);
    if (!ui.includes(`'${btn}'`) || !ui.includes(`${fn}`)) fail(`ui.js never wires #${btn} to ${fn}`);
  }
  // A card is stored as a preset index, which only works if the codec and the card use the same identity test.
  if (!store.includes('presetIndexOf')) fail('statestore.js no longer diffs a card against its preset');
  if (!/restoreSetup\(\);/.test(ui)) fail('ui.js never restores the setup before the first MATCH — a saved link would show one lineup and play another');
  // Rebuilding a CAGE row has to carry the ticks over: §6.3.5 puts the choice in the DOM (`scenarioFromUI`
  // reads it there), so a re-render that resets it silently loses a restored link's or an imported CSV's
  // endgame — which is exactly how this round's first browser run came back with the shipped pattern.
  if (!ui.includes('const keep = ticks.length === 3 ? ticks.map((c) => c.checked) : null;')) fail('buildSetup no longer carries the CAGE ticks through a rebuild');
  if (!ui.includes('input.checked = deep ? !!deep[i] : i !== 1;')) fail('cageRow no longer renders from the carried-over ticks');
}

// The scouting importer. Its first contract is the codec's: no DOM, because the parser is the place where a
// wrong column becomes a wrong card and only a test can hold it to that. Then the four ways this file can drift
// out of agreement with the page it writes cards into: a column whose range disagrees with the editor that has
// to display it; a header alias that normalizes onto a real column and shadows it, or onto a name that does not
// exist and quietly does nothing; a refusal key written with an underscore, which `norm` strips, so the reason
// is never found and the column reads as unknown; and a derived column that reaches a card as a wire name the
// engine never reads.
{
  const scout = fs.readFileSync(path.join(ROOT, JS_DIR, 'scouting.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, JS_DIR, 'ui.js'), 'utf8');
  const normOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const bad of ['document.', 'window.', 'localStorage.']) {
    if (scout.includes(bad)) fail(`scouting.js contains ${bad}: the parser must stay runnable outside a browser`);
  }
  const colsBlock = scout.match(/const COLUMNS = \[([\s\S]*?)\n\];/);
  if (!colsBlock) fail('scouting.js has no COLUMNS table to read');
  const rows = (colsBlock ? colsBlock[1] : '').split('\n').filter((l) => /^\s*\['/.test(l)).length;
  // A field name may carry a digit — `placeL1`, `dropL4` — and a pattern that forgets it silently reads the
  // eight level columns out of the table, which is how this guard itself first shipped: a contract that cannot
  // see half the rows is a contract that will not notice those rows being wrong.
  const cols = [...scout.matchAll(/^\s*\['([a-z0-9]+)', '([a-zA-Z0-9]+)', (?:'([^']+)'|`([^`]+)`)/gm)]
    .map((m) => ({ header: m[1], field: m[2], spec: m[3] ?? m[4] ?? '' }));
  if (!colsBlock || cols.length !== rows) {
    fail(`the COLUMNS table has ${rows} rows but the guard could read ${cols.length}: fix the pattern before trusting the checks below`);
  }
  const headers = new Set(cols.map((c) => c.header));
  // The card editor's own min/max, read out of the one table that builds the inputs.
  const editor = new Map();
  const specBlock = ui.match(/const SPEC_FIELDS = \[([\s\S]*?)\n\];/);
  if (!specBlock) fail('ui.js has no SPEC_FIELDS block to hold the importer against');
  for (const m of (specBlock ? specBlock[1] : '').matchAll(/key: [`']([a-zA-Z]+(?:\$\{lv\})?)[`'],[\s\S]{0,320}?min: ([\d.]+),\s*max: ([\d.]+)/g)) {
    if (m[1].includes('${lv}')) {
      const pfx = m[1].startsWith('place') ? 'place' : 'drop';
      for (const lv of ['L1', 'L2', 'L3', 'L4']) editor.set(`${pfx}${lv}`, [Number(m[2]), Number(m[3])]);
    } else editor.set(m[1], [Number(m[2]), Number(m[3])]);
  }
  if (editor.size < 14) fail(`the card editor reads as ${editor.size} numbered fields — the regex has lost the table`);
  for (const c of cols) {
    const m = c.spec.match(/^(?:range|count|pct):([\d.]+):([\d.]+)$/);
    if (!m) continue;
    const [lo, hi] = [Number(m[1]), Number(m[2])];
    const e = editor.get(c.field);
    if (!e) {
      if (!['weightLb', 'armSec', 'coralPerMatch', 'teleopCoral', 'bargePoints', 'netLift'].includes(c.field)) {
        fail(`scouting writes ${c.field} ${lo}-${hi}, which the card editor has no input for and no derivation explains`);
      }
      continue;
    }
    if (lo < e[0] || hi > e[1]) fail(`scouting lets ${c.field} go to ${lo}-${hi} but the card can only be set to ${e[0]}-${e[1]} — the panel would show a value it cannot edit`);
  }
  // Aliases. A second spelling of the same thing is fine; an alias that lands on another column's header, or
  // that points at a name the table does not have, is a silent change of meaning or a silent nothing.
  const aliasBlock = scout.match(/for \(const \[alias, header\] of \[([\s\S]*?)\]\) \{/);
  if (!aliasBlock) fail('scouting.js has no header-alias loop to check');
  const aliasTo = new Map();
  for (const m of (aliasBlock ? aliasBlock[1] : '').matchAll(/\['([a-z0-9_]+)', '([a-z0-9_]+)'\]/g)) {
    const key = normOf(m[1]);
    if (!headers.has(m[2])) fail(`alias "${m[1]}" points at "${m[2]}", which is not a column — the alias does nothing`);
    if (headers.has(key) && key !== m[2]) fail(`alias "${m[1]}" normalizes to ${key}, another column's header — it would be overwritten`);
    if (aliasTo.has(key) && aliasTo.get(key) !== m[2]) fail(`two spellings normalize to ${key} and mean different columns (${aliasTo.get(key)} and ${m[2]})`);
    aliasTo.set(key, m[2]);
  }
  // Refusals: keyed the way `norm` reads, never reaching for a name the table owns.
  const refBlock = scout.match(/const REFUSALS = \{([\s\S]*?)\n\};/);
  if (!refBlock) fail('scouting.js has no REFUSALS table, so a column it refuses by design reads as an unrecognised one');
  for (const m of (refBlock ? refBlock[1] : '').matchAll(/^\s*'?([a-z0-9_]+)'?: '/gm)) {
    // Underscores are matched *so they can be reported*: a pattern of only [a-z0-9] would skip the one key
    // written in the wrong form, which is precisely the mistake this rule exists to catch.
    const key = m[1];
    if (normOf(key) !== key) fail(`REFUSALS key "${key}" contains punctuation that norm() strips — its reason would never be found`);
    if (headers.has(key) || aliasTo.has(key)) fail(`REFUSALS refuses "${key}" while the column table also reads it`);
  }
  // The derived columns are not card fields, so they must be explained in `toCard` and absent from its whitelist.
  const toCard = scout.match(/export function toCard\([\s\S]*?\n\}/)?.[0] || '';
  if (!toCard) fail('scouting.js has no toCard function to inspect');
  const whitelist = (toCard.match(/for \(const k of \[([^\]]*)\]/) || [])[1] || '';
  for (const derived of ['armSec', 'coralPerMatch', 'teleopCoral', 'bargePoints', 'netLift']) {
    if (!toCard.includes(`row.${derived}`)) fail(`${derived} is a derived column that toCard never reads — it would land on the card as a wire name nothing runs`);
    if (whitelist.includes(`'${derived}'`)) fail(`${derived} is not a profile field and must not be copied onto a card`);
  }
  for (const k of ['key', 'ref', 'pieces']) {
    if (!toCard.includes(`delete out.${k};`)) fail(`toCard no longer strips provenance key ${k} off an imported card`);
  }
  if (!/scaleProfile\(base, /.test(toCard)) fail('toCard no longer honours a per-MATCH CORAL rate through the same scaleProfile model.js uses for its presets');
  if (!scout.includes('REF_CORAL_PER_ROBOT')) fail('scouting.js no longer uses the reference CORAL rate model.js fits its presets with');
  if (!/export const REF_CORAL_PER_ROBOT/.test(fs.readFileSync(path.join(ROOT, JS_DIR, 'model.js'), 'utf8'))) fail('model.js keeps REF_CORAL_PER_ROBOT private, so the importer has to invent its own');
  // The page side: one button, one hidden input, one report, all wired.
  for (const id of ['btn-import-scouting', 'inp-scouting', 'import-report', 'import-notes']) {
    const n = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
    if (n !== 1) fail(`#${id} appears ${n} times in index.html, expected once`);
    if (!ui.includes(`'${id}'`)) fail(`ui.js never touches #${id}`);
  }
  const scoutImport = ui.match(/import \{[^}]*\} from '\.\/scouting\.js'/)?.[0] || '';
  for (const fn of ['parseScouting', 'placeRosters']) {
    if (!scoutImport.includes(fn)) fail(`ui.js does not import ${fn} from scouting.js`);
  }
  if (!/function importScouting/.test(ui) || !/void importScouting\(/.test(ui)) fail('nothing calls importScouting, so the button is decoration');
  if (!/function reportImport/.test(ui)) fail('the import has no report block, so a clamped or refused column cannot be read back');
  // And somebody has to test the mapping, because every assertion above is a string comparison — the only way
  // to know a header lands on the right *value* is to parse a file and read the card back.
  const tests = fs.readFileSync(path.join(ROOT, 'scripts', 'runtime.test.mjs'), 'utf8');
  if (!tests.includes('scouting.js')) fail('nothing imports scouting.js in the tests: a column can map to the wrong field and stay green');
  // The example file is the contract a team reads, and the only place the header spellings are written down
  // outside the code. It has to parse with nothing refused, and every header in it has to be a name README.md
  // actually documents — otherwise the page promises a column the parser never agreed to.
  const examplePath = path.join(ROOT, 'docs', 'scouting-example.csv');
  if (!fs.existsSync(examplePath)) fail('docs/scouting-example.csv is missing: the column contract has no example');
  else {
    const read = fs.readFileSync(examplePath, 'utf8');
    const head = read.split(/\r?\n/).find((l) => l.trim() !== '' && !l.trim().startsWith('#')).split(',');
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const { parseScouting } = await import(pathToFileURL(path.join(ROOT, JS_DIR, 'scouting.js')).href);
    const parsed = parseScouting(read);
    if (parsed.unknown.length) fail(`docs/scouting-example.csv has header(s) the parser no longer reads: ${parsed.unknown.join(', ')}`);
    if (parsed.rows.length !== 6) fail(`docs/scouting-example.csv parses as ${parsed.rows.length} cards, not the six it prints`);
    const remarks = parsed.problems.filter((p) => !/season mean|outside the/.test(p));
    if (remarks.length) fail(`the example file does not parse cleanly: ${remarks.join(' · ')}`);
    for (const h of head) if (!readme.includes(`\`${h}\``)) fail(`the example carries the header "${h}" and README.md never lists it`);
  }
}

// Every `npm run …` this repo tells a reader to type has to be a script that exists, and the evidence the
// numbers rest on has to be a file that exists. Both halves of that have drifted here: a `npm run all` outlived
// the script it named, and README paragraphs outlived the terminal buffers that printed them.
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const cited = new Set();
  for (const doc of [readme, html]) {
    for (const m of doc.matchAll(/npm run ([a-zA-Z]+)/g)) cited.add(m[1]);
  }
  for (const name of cited) {
    if (!pkg.scripts[name]) fail(`the page or README says \`npm run ${name}\` and package.json has no such script — found in: ${[readme, html].map((d) => (d.match(new RegExp('npm run ' + name + '\\b[^\\n]{0,40}', 'g')) || [])[0]).filter(Boolean).join(' | ').slice(0, 160)}`);
  }
  if (!/npm run audit/.test(pkg.scripts.validate || '')) fail('npm run validate skips the prose audit, so a stale number can ship');
  for (const f of ['scripts/audit.mjs', 'scripts/record.mjs']) {
    if (!fs.existsSync(path.join(ROOT, f))) fail(`${f} is missing: the measurement numbers in the prose have no check`);
  }
  if (!readme.includes('npm run audit')) fail('README never tells a reader how the prose numbers are held');
  if (pkg.scripts.all) fail('package.json still defines `all`, which nothing documents — `validate` is the full sweep');
}

console.log(bad === 0 ? `OK: ${files.length} files are UTF-8 clean and index.html tags balance.` : `${bad} problem(s).`);
process.exit(bad === 0 ? 0 : 1);
