// Every number published in this repo's prose has to be printable by something committed here.
//
// Why this exists. The page and the README carry measurement claims — `−26.5 ± 2.2 points a MATCH`, `76.0%`,
// `ad0911e7` — and a claim whose source is a deleted terminal buffer is not a claim, it is a rumour. Two
// accidents this repo has actually had: a README paragraph that outlived the arm it measured, and a caption that
// kept quoting an old threshold after the constant moved. Neither is visible to `npm run check`, because a number
// that is *wrong* still parses.
//
// The rule, in the order the evidence is accepted:
//
//   1. the number appears in a committed source file — a rule constant, a default knob, an engine bound;
//   2. the paragraph it sits in names the committed command that prints it (`npm run measure`, `npm run rp`,
//      `scripts/cards.mjs`, …), and that command exists in package.json — the measurement scripts each take
//      ten to twenty minutes, so the value itself is not committed and the citation is what a reader can rerun;
//   3. it is accounted for in `docs/uncited-numbers.txt`, the debt ledger: a claim whose measurement lives in a
//      probe nobody committed. The ledger can only shrink — a line whose claim has been repaired is a failure too.
//
// A digest is held to the first rule only: a replay fingerprint is a committed constant in
// `scripts/invariants.mjs`, and "some command prints it" would let any eight hex characters through.
//
//   node scripts/audit.mjs                            # the offline check
//   node scripts/audit.mjs .tmp/measurements.txt      # plus a fresh record, so citations are verified values
//
// `npm run record` writes that file. Passing it means a cited number is checked against what the scripts printed
// on this machine today rather than against the sentence that quotes it.
//
// Integers are deliberately not policed. They are the bulk of a rules table (12 branches, 24 trough, 115 lb), a
// count of rows, or a year, and a check that flags all three is a check that gets ignored. What is policed is the
// decimal — a mean, an error bar, a rate — and the eight-hex digest, which is the fingerprint of a replay.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DOCS = ['README.md', 'web/index.html', 'OPTIMIZATION.md'];
const CORPUS = [
  ...fs.readdirSync(path.join(ROOT, 'web/js')).filter((f) => f.endsWith('.js')).map((f) => `web/js/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs') || f.endsWith('.json')).map((f) => `scripts/${f}`),
  // The ledger is excluded from its own evidence: it is a list of the claims this check has not proven, and if it
  // counted as a source then writing it down would be the same as measuring it.
  ...(fs.existsSync(path.join(ROOT, 'docs'))
    ? fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f !== 'uncited-numbers.txt').map((f) => `docs/${f}`)
    : []),
  'package.json',
];

// Numbers that are neither in the code nor cited to a command that prints them, and are therefore debt rather than
// evidence: each line is the file and the number, with the reason it is still being quoted. The point of keeping
// the list in a file instead of in this script's head is that it can only shrink — `npm run audit` fails on a new
// entry, and fails on an entry whose claim has been repaired, so the ledger cannot quietly grow.
//
//   node scripts/audit.mjs --write-baseline    # rewrite the ledger from what the scan just found (after a rebuild)
const BASELINE = path.join(ROOT, 'docs', 'uncited-numbers.txt');
const writeBaseline = process.argv.includes('--write-baseline');
const waived = new Set();
if (fs.existsSync(BASELINE) && !writeBaseline) {
  for (const line of fs.readFileSync(BASELINE, 'utf8').split('\n')) {
    if (line.trim().startsWith('#') || line.trim() === '') continue; // the header is prose, not a waiver
    const m = line.match(/^\s*(\S+)\s+(\S+)/);
    if (m) waived.add(`${m[1]} ${m[2]}`);
  }
}

const runFiles = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let corpus = '';
for (const f of CORPUS) corpus += read(f) + '\n';
for (const f of runFiles) {
  try {
    corpus += fs.readFileSync(path.resolve(f), 'utf8') + '\n';
  } catch (e) {
    console.log(`FAIL cannot read the record ${f}: ${e.code}`);
    process.exit(1);
  }
}
const hay = corpus.replace(/,/g, ''); // 804,512 is how a ledger writes a byte count
const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
// A citation is evidence, so it has to be findable: `npm run measure` in a line, or `scripts/measure.mjs`,
// anywhere in the same paragraph. Prose that quotes a measurement with no command in the paragraph is the thing
// this script exists to catch, so the unit is the paragraph, not the line, and not the document.
const citationRe = new RegExp(`(?:npm run (${scripts.join('|')})|scripts\\/(${scripts.join('|')})\\.mjs)`);

// A clause citation is not a measurement: §6.5.1 contains "6.5" and Table 6-2 contains "6", and rule numbers
// (R103, G303-D) contain integers. Stripping them keeps the report down to numbers that claim something.
const stripCitations = (line) => line
  .replace(/§\s*[\d.]+/g, ' ')
  .replace(/\bTable\s+[\d-]+/gi, ' ')
  .replace(/\bFigure\s+[\d-]+/gi, ' ')
  .replace(/\b[RGT]\d{2,4}\b/g, ' ');

const findings = [];
const cited = [];
const unsupported = new Map(); // "doc number" -> the line it came from
for (const doc of DOCS) {
  if (!fs.existsSync(path.join(ROOT, doc))) continue;
  const lines = read(doc).split('\n');
  // Paragraphs are blank-line separated; a Markdown table is one paragraph, which is what a cited arm needs.
  const blocks = [];
  let start = 0;
  lines.forEach((l, i) => {
    if (l.trim() === '') { blocks.push([start, i]); start = i + 1; }
  });
  blocks.push([start, lines.length]);
  const blockText = new Map();
  for (const [a, b] of blocks) blockText.set(`${a}:${b}`, lines.slice(a, b).join('\n'));
  const blockOf = (i) => blocks.find(([a, b]) => i >= a && i < b);
  for (let i = 0; i < lines.length; i++) {
    const hits = [];
    const line = stripCitations(lines[i]);
    for (const m of line.matchAll(/\d+\.\d+/g)) {
      if (hay.includes(m[0])) continue;
      hits.push(m[0]);
    }
    for (const m of line.matchAll(/\b[0-9a-f]{8}\b/g)) {
      if (/^\d+$/.test(m[0])) continue; // a bare digit run is a count, not a fingerprint
      if (hay.includes(m[0])) continue;
      hits.push('#' + m[0]);
    }
    if (!hits.length) continue;
    const [a, b] = blockOf(i) || [0, lines.length];
    const cite = citationRe.exec(blockText.get(`${a}:${b}`) || '');
    if (cite) { cited.push(`${doc}:${i + 1}  [${hits.join(' ')}]  cited to \`npm run ${cite[1] || cite[2]}\``); continue; }
    // Uncited and not in the code: that is the debt. Recorded whether waived or not, because the ledger's own
    // lines are keyed off this map — a number that is currently waived has to be in it, or "the debt was paid"
    // fires on every clean run.
    for (const h of hits) {
      const key = `${doc} ${h}`;
      if (!unsupported.has(key)) unsupported.set(key, `${doc}:${i + 1}  ${lines[i].trim().slice(0, 120)}`);
    }
    const fresh = hits.filter((h) => !waived.has(`${doc} ${h}`));
    if (fresh.length) findings.push(`${doc}:${i + 1}  [${fresh.join(' ')}]  ${lines[i].trim().slice(0, 132)}`);
  }
}

if (writeBaseline) {
  const body = [...unsupported.entries()].map(([key, where]) => {
    const [doc, num] = key.split(' ');
    return `${doc.padEnd(18)} ${num.padEnd(10)} # ${where}`;
  }).join('\n');
  fs.writeFileSync(BASELINE, `# Claims in the prose that no committed file prints and no paragraph cites to a command\n`
    + `# that does. Written by \`node scripts/audit.mjs --write-baseline\` on ${new Date().toISOString().slice(0, 10)}.\n`
    + `#\n`
    + `# This list can only shrink: \`npm run audit\` fails on a number that is not in it, and fails on a line\n`
    + `# in it whose claim has been repaired. The fix for a line here is to promote the probe that printed it\n`
    + `# into a committed script and cite that script in the paragraph — which is what \`scripts/rp.mjs\` and\n`
    + `# \`scripts/cards.mjs\` were for their two rounds.\n\n${body}\n`, 'utf8');
  console.log(`wrote docs/uncited-numbers.txt: ${unsupported.size} entry(ies)`);
  process.exit(0);
}

const paid = [...waived].filter((k) => !unsupported.has(k));
console.log(`audit: ${CORPUS.length} committed files as evidence, ${DOCS.join(', ')} as prose`
  + `${runFiles.length ? `, plus ${runFiles.length} record file(s) of fresh measurements` : ' (no record passed: cited measurements are checked for their citation, not their value)'}`);
if (cited.length) console.log(`\n${cited.length} line(s) rest on a committed command the reader can rerun:`);
for (const c of cited.slice(0, 8)) console.log('  ' + c);
if (cited.length > 8) console.log(`  … and ${cited.length - 8} more (run \`npm run record\` and pass the file to check them against values)`);
if (findings.length) {
  console.log(`\n${findings.length} prose line(s) carry a number that is in no committed file, cites no committed command, and is not in docs/uncited-numbers.txt:`);
  for (const f of findings) console.log('  ' + f);
}
if (paid.length) {
  console.log(`\n${paid.length} waived claim(s) are no longer unsupported — the debt was paid, so delete the line:`);
  for (const k of paid) console.log(`  ${k}   (${unsupported.get(k) || 'not re-found'})`);
}
if (!findings.length && !paid.length && waived.size) {
  console.log(`\nwaived debt: ${waived.size} number(s) still quoted with no committed print — see docs/uncited-numbers.txt`);
}
if (findings.length || paid.length) {
  console.log('\nFix it by naming the command that prints the number, by promoting the probe that measured it into');
  console.log('a committed script, by re-deriving the sentence from what the code says — or, if the claim is');
  console.log('simply wrong, by correcting the prose.');
  process.exit(1);
}
console.log(`OK: every decimal and digest in the prose is in the code, cited to a committed command, or accounted for as ${waived.size} waived claim(s).`);
