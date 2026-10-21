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

console.log(bad === 0 ? `OK: ${files.length} files are UTF-8 clean and index.html tags balance.` : `${bad} problem(s).`);
process.exit(bad === 0 ? 0 : 1);
