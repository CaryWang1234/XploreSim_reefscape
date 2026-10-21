// Static guard for the shipped web bundle: encoding, and HTML tag balance.
//
// Two accidents this repo has actually had: a file written through a shell redirect came out as
// mojibake, and an edit to index.html deleted the opening tags of the neighbouring <details> block.
// Both rendered fine in a local browser until the text was unreadable or a section vanished, so they
// are checked here rather than eyeballed. Run with `npm run check` before publishing.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const files = [HTML, 'web/styles.css', 'package.json', '.gitignore']
  .map((f) => path.join(ROOT, f))
  .concat(fs.readdirSync(path.join(ROOT, JS_DIR)).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, JS_DIR, f)));

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (!fs.existsSync(f)) { fail(`${rel} is listed but missing`); continue; }
  const buf = fs.readFileSync(f);
  const txt = buf.toString('utf8');
  if (buf.includes(REPLACEMENT)) fail(`${rel} contains U+FFFD, the decoder replacement character`);
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

console.log(bad === 0 ? `OK: ${files.length} files are UTF-8 clean and index.html tags balance.` : `${bad} problem(s).`);
process.exit(bad === 0 ? 0 : 1);
