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
//      tens of minutes, so the value itself is not committed and the citation is what a reader can rerun;
//   3. it is accounted for in `docs/uncited-numbers.txt`, the debt ledger: a claim whose measurement lives in a
//      probe nobody committed. The ledger can only shrink — a line whose claim has been repaired is a failure too.
//
// A digest is held to the first rule only: a replay fingerprint is a committed constant in
// `scripts/invariants.mjs`, and "some command prints it" would let any eight hex characters through.
//
//   node scripts/audit.mjs                            # the offline check
//   node scripts/audit.mjs .tmp/measurements.txt      # plus a fresh record, so citations are verified values
//
// `npm run record` writes that file. Passing it upgrades rule 2: a number whose paragraph names `npm run measure`
// is then looked for in the `measure` section of the record, which is what that script printed on this machine
// today. The record is read as named sections and matched section by section on purpose — a run of ten measurement
// scripts prints thousands of decimals, and "this number appears somewhere in that" would let a stale claim pass
// because some unrelated arm happened to land on the same figure.
//
// Integers are deliberately not policed. They are the bulk of a rules table (12 branches, 24 trough, 115 lb), a
// count of rows, or a year, and a check that flags all three is a check that gets ignored. What is policed is the
// decimal — a mean, an error bar, a rate — and the eight-hex digest, which is the fingerprint of a replay.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecord } from './record_sections.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DOCS = ['README.md', 'web/index.html', 'OPTIMIZATION.md'];
const CORPUS = [
  ...fs.readdirSync(path.join(ROOT, 'web/js')).filter((f) => f.endsWith('.js')).map((f) => `web/js/${f}`),
  // This script is not its own evidence: its comments quote measurement-shaped examples (`2.50`, a TBA mean) to
  // explain the rules, and if they counted as a source then writing an example down would waive the claim it
  // describes. `check_web.mjs` holds that exclusion in place.
  ...fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter((f) => (f.endsWith('.mjs') || f.endsWith('.json')) && f !== 'audit.mjs')
    .map((f) => `scripts/${f}`),
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
const hay = corpus.replace(/,/g, ''); // 804,512 is how a ledger writes a byte count
// Evidence is a number, not a substring: `76.0%` typed in a comment is not the figure `6.0`, and quoting a mean
// as two decimals is the same claim as a table that printed one. Both readings are anchored, so `2.50` matches
// `2.5` and nothing matches inside a longer digit run.
const CODE_NUM = /(?<![\d.])\d+\.\d+(?![\d.])/g;
const codeNums = new Set([...hay.matchAll(CODE_NUM)].map((m) => parseFloat(m[0])));
const digestRe = (hex) => new RegExp(`(?<![0-9a-f])${hex}(?![0-9a-f])`);
const inCode = (hit) => (hit.startsWith('#') ? digestRe(hit.slice(1)).test(hay) : codeNums.has(parseFloat(hit)));
const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
// The record is sections, not a haystack: `npm run measure` excuses a number only if the measure section prints it.
const recordSrc = read('scripts/record.mjs');
const fileToSection = new Map(
  [...recordSrc.matchAll(/\['([a-z]+)',\s*'scripts\/([a-z_]+)\.mjs'\]/g)].map(([, name, file]) => [`scripts/${file}.mjs`, name]),
);
const record = new Map();
for (const f of runFiles) {
  let text;
  try {
    text = fs.readFileSync(path.resolve(f), 'utf8');
  } catch (e) {
    console.log(`FAIL cannot read the record ${f}: ${e.code}`);
    process.exit(1);
  }
  for (const [name, body] of parseRecord(text)) record.set(name, (record.get(name) || '') + body.replace(/,/g, ''));
}
// Matched as numbers inside a section, because the prose and the script round differently: two decimals of the
// same figure are the same figure, and calling that stale would be a false accusation. A digest stays a string —
// eight hex characters have no numeric meaning. The record's own `#` lines (the elapsed figure, the Node version)
// are not output and are dropped first, so `v24.16.0` cannot excuse a claim about 24.16.
const printed = new Map([...record].map(([k, v]) => {
  const body = v.split('\n').filter((l) => !l.startsWith('#')).join('\n');
  return [k, new Set([...body.matchAll(CODE_NUM)].map((m) => parseFloat(m[0])))];
}));
const prints = (set, sectionText, hit) => (hit.startsWith('#')
  ? digestRe(hit.slice(1)).test(sectionText)
  : set.has(parseFloat(hit)));
// A waiver is about the claim, not the file it is typed in: the TBA mean of 260.56 is the same external number
// whether the README or the page quotes it, and the line that accounts for it names the sentence either way.
const waivedNums = new Set([...waived].map((k) => k.split(' ')[1]));
// A citation is evidence, so it has to be findable: `npm run measure` in a line, or `scripts/measure.mjs`,
// anywhere in the same paragraph. Prose that quotes a measurement with no command in the paragraph is the thing
// this script exists to catch, so the unit is the paragraph, not the line, and not the document. Global because a
// paragraph can name more than one command and every one of them is a place a number may come from.
const citationReG = new RegExp(`(?:npm run (${scripts.join('|')})|scripts\\/(${scripts.join('|')})\\.mjs)`, 'g');

// A clause citation is not a measurement: §6.5.1 contains "6.5" and Table 6-2 contains "6", and rule numbers
// (R103, G303-D) contain integers. Stripping them keeps the report down to numbers that claim something.
const stripCitations = (line) => line
  .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}(\.\d{1,3})?\b/g, ' ') // 127.0.0.1:4188 is where the page is served, not a mean
  .replace(/§\s*[\d.]+/g, ' ')
  .replace(/\bTable\s+[\d-]+/gi, ' ')
  .replace(/\bFigure\s+[\d-]+/gi, ' ')
  .replace(/\b[RGT]\d{2,4}\b/g, ' ');

const findings = [];
const stale = []; // cited to a command whose recorded output does not print the number — only a record can say this
const cited = [];
const verified = [];
const unsupported = new Map(); // "doc number" -> the line it came from
for (const doc of DOCS) {
  if (!fs.existsSync(path.join(ROOT, doc))) continue;
  const lines = read(doc).split('\n');
  // Paragraphs are blank-line separated; a Markdown table is one paragraph, which is what a cited arm needs. In
  // the page one blank line can span a dozen `<p>` elements, and a citation from the first of them would excuse a
  // number printed in the last — so an HTML paragraph also ends where `</p>` does.
  const blocks = [];
  let start = 0;
  lines.forEach((l, i) => {
    const ends = l.trim() === '' || /<\/p>\s*(?:-->|$)/.test(l);
    if (ends) { blocks.push([start, i + 1]); start = i + 1; }
  });
  if (start < lines.length) blocks.push([start, lines.length]);
  const blockText = new Map();
  for (const [a, b] of blocks) blockText.set(`${a}:${b}`, lines.slice(a, b).join('\n'));
  const blockOf = (i) => blocks.find(([a, b]) => i >= a && i < b);
  for (let i = 0; i < lines.length; i++) {
    const hits = [];
    const line = stripCitations(lines[i]);
    for (const m of line.matchAll(/\d+\.\d+/g)) {
      if (inCode(m[0])) continue;
      hits.push(m[0]);
    }
    for (const m of line.matchAll(/\b[0-9a-f]{8}\b/g)) {
      if (/^\d+$/.test(m[0])) continue; // a bare digit run is a count, not a fingerprint
      if (inCode('#' + m[0])) continue; // read as a digest, not as a number that happens to start with digits
      hits.push('#' + m[0]);
    }
    if (!hits.length) continue;
    const [a, b] = blockOf(i) || [0, lines.length];
    // A paragraph may legitimately name more than one command — the guard that reads the geometry and the arm
    // that prices it are often quoted in the same breath — so every citation in the block is a place a number is
    // allowed to come from, not just the first one the scan happened to hit.
    const block = blockText.get(`${a}:${b}`) || '';
    const names = [];
    for (const m of block.matchAll(citationReG)) names.push(m[1] || fileToSection.get(`scripts/${m[2]}.mjs`) || null);
    const usable = [...new Set(names.filter((n) => n && record.has(n)))];
    const uncovered = [...new Set(names.filter((n) => n && !record.has(n)))];
    // The value in a section may be printed with one decimal where the prose quotes two; a digest has no latitude.
    const printedHere = (n, h) => prints(printed.get(n), record.get(n), h);
    if (names.length) {
      // A record can only accuse what it covers: if this paragraph names a command the record does not have a
      // section for, the number may live there, and calling it stale would be a guess. A complete record
      // (`npm run record`) leaves no such gap.
      if (record.size && usable.length && !uncovered.length) {
        // A waived claim stays waived: the debt ledger is the place a number goes when nothing here prints it,
        // including a real-world anchor read off The Blue Alliance, and it is not the record's business.
        const missing = hits.filter((h) => !usable.some((n) => printedHere(n, h)) && !waivedNums.has(h));
        if (!missing.length) {
          verified.push(`${doc}:${i + 1}  [${hits.join(' ')}]  printed by \`npm run ${usable[0]}\``);
          continue;
        }
        stale.push(`${doc}:${i + 1}  [${missing.join(' ')}]  cites ${usable.map((n) => `\`npm run ${n}\``).join(', ')}`
          + ' and this record holds their output, but none of those sections prints these — the claim is stale,'
          + ' the arm moved, or the number belongs to a command this paragraph does not name');
        continue;
      }
      const every = [...new Set(names.filter(Boolean))];
      cited.push(`${doc}:${i + 1}  [${hits.join(' ')}]  cited to ${every.map((n) => `\`npm run ${n}\``).join(', ')}`);
      continue;
    }
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
const sections = [...record.keys()];
console.log(`audit: ${CORPUS.length} committed files as evidence, ${DOCS.join(', ')} as prose`
  + `${runFiles.length
    ? `, plus a record with ${sections.length} section(s) checked by name: ${sections.join(', ')}`
    : ' (no record passed: cited measurements are checked for their citation, not their value)'}\n`
  + `  a number is excused by the record only if the section of the command its own paragraph cites prints it`);
if (verified.length) console.log(`\n${verified.length} line(s) rest on what a committed command printed on this machine:`);
for (const v of verified.slice(0, 8)) console.log('  ' + v);
if (verified.length > 8) console.log(`  … and ${verified.length - 8} more`);
if (cited.length) console.log(`\n${cited.length} line(s) rest on a committed command the reader can rerun:`);
for (const c of cited.slice(0, 8)) console.log('  ' + c);
if (cited.length > 8) {
  console.log(`  … and ${cited.length - 8} more`
    + (record.size
      ? ` (their command has no section in the record passed — \`npm run record --only <name>\` refreshes one)`
      : ' (run `npm run record` and pass the file to check them against values)'));
}
if (findings.length) {
  console.log(`\n${findings.length} prose line(s) carry a number that is in no committed file, cites no committed command, and is not in docs/uncited-numbers.txt:`);
  for (const f of findings) console.log('  ' + f);
}
if (stale.length) {
  console.log(`\n${stale.length} prose line(s) cite a command this record printed, and that command's own output`
    + ' does not contain the number:');
  for (const s of stale) console.log('  ' + s);
}
if (paid.length) {
  console.log(`\n${paid.length} waived claim(s) are no longer unsupported — the debt was paid, so delete the line:`);
  for (const k of paid) console.log(`  ${k}   (${unsupported.get(k) || 'not re-found'})`);
}
if (!findings.length && !paid.length && waived.size) {
  console.log(`\nwaived debt: ${waived.size} number(s) still quoted with no committed print — see docs/uncited-numbers.txt`);
}
if (findings.length || stale.length || paid.length) {
  console.log('\nFix it by naming the command that prints the number, by promoting the probe that measured it into');
  console.log('a committed script, by re-deriving the sentence from what the code says — or, if the claim is');
  console.log('simply wrong, by correcting the prose.');
  console.log('\n`npm run record --only <name>` refreshes one section of the record; a stale line is only an'
    + ' accusation if that section is in the file you passed.');
  process.exit(1);
}
console.log(`OK: every decimal and digest in the prose is in the code, cited to a committed command, or accounted for as ${waived.size} waived claim(s).`);
