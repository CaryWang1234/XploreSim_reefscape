// The record of what the measurement scripts print, for `scripts/audit.mjs` to check values against.
//
// Why a record at all. `README.md` and the page quote measurements — `+5.50 ± 2.66`, `57.9 CORAL`, `ad0911e7`.
// The code that computes each of them is committed; the *value* it printed lives only in a terminal buffer, which
// is why the audit accepts a citation as evidence by default. Passing a record turns the citation check into a
// value check, and this script is how you get one:
//
//   npm run record            # verify + rp + measure + headroom + …, into .tmp/measurements.txt
//   node scripts/audit.mjs .tmp/measurements.txt
//
// It writes to `.tmp/`, which is gitignored on purpose: a committed dump of one noisy run becomes an authority
// nobody refreshes, and each script here takes tens of minutes. `.tmp/` keeps it what it is — the output of
// a command you can rerun.
//
//   node scripts/record.mjs                     # everything
//   node scripts/record.mjs --only rp,cards     # or refresh two sections and keep the rest

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, '.tmp', 'measurements.txt');

// Each entry is the name the prose cites and the command that prints it. The files are run from the repo root so
// their own relative paths keep working.
const SCRIPTS = [
  ['verify', 'scripts/invariants.mjs'],
  ['rp', 'scripts/rp.mjs'],
  ['cards', 'scripts/cards.mjs'],
  ['measure', 'scripts/measure.mjs'],
  ['headroom', 'scripts/headroom.mjs'],
  ['contact', 'scripts/contact.mjs'],
  ['fastsim', 'scripts/fastsim.mjs'],
  ['strength', 'scripts/strength.mjs'],
  ['aicap', 'scripts/aicap.mjs'],
  ['adaptive', 'scripts/adaptive.mjs'],
];

const only = process.argv.find((a) => a.startsWith('--only='));
const names = only ? only.slice('--only='.length).split(',') : SCRIPTS.map(([n]) => n);
const chosen = SCRIPTS.filter(([n]) => names.includes(n));
if (!chosen.length) {
  console.log(`nothing named ${names.join(', ')}; the record knows ${SCRIPTS.map(([n]) => n).join(', ')}`);
  process.exit(1);
}

// An old record is kept: `--only rp` refreshes one block and must not delete the other nine.
const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
const blocks = new Map();
for (const m of previous.matchAll(/^==== (\w+) ====\n([\s\S]*?)(?=^==== |\Z)/gm)) blocks.set(m[1], m[2]);

const stamp = new Date().toISOString().slice(0, 10);
let text = '';
for (const [name, file] of chosen) {
  console.log(`running ${name} …`);
  const out = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) {
    console.log(`FAIL ${name} exited ${out.status}: ${(out.stderr || '').split('\n')[0]}`);
    process.exit(1);
  }
  const body = (out.stdout || '') + (out.stderr && !out.stdout ? out.stderr : '');
  blocks.set(name, body);
  console.log(`  ${body.split('\n').length} lines`);
}
for (const [name, body] of blocks) text += `==== ${name} ====\n${body.replace(/\n*$/, '\n')}\n`;

const header = `# What the measurement scripts printed, on this machine, for \`scripts/audit.mjs\` to check against.
#
# Written by \`npm run record\` on ${stamp} under ${process.version}. The sections are the stdout of
# scripts/invariants.mjs, rp.mjs, cards.mjs, measure.mjs, headroom.mjs, contact.mjs, fastsim.mjs,
# strength.mjs, aicap.mjs and adaptive.mjs, in that order.
#
# Not committed: this is one run of arms that carry noise, and a file nobody refreshes turns into an authority.
# Pass it to the audit when the prose needs its values checked rather than just its citations —
# \`node scripts/audit.mjs .tmp/measurements.txt\`.
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + text, 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT).replace(/\\/g, '/')}: ${fs.statSync(OUT).size} bytes, ${blocks.size} section(s)`);
console.log('now: node scripts/audit.mjs .tmp/measurements.txt');
