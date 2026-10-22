// The section codec behind `.tmp/measurements.txt`, kept out of `record.mjs` so it can be tested without running
// a thirteen-minute measurement script.
//
// A record is a flat text file of named sections:
//
//   ==== verify ====
//   <the stdout of scripts/invariants.mjs>
//   ==== rp ====
//   <…>
//
// `--only rp` reads the old file, replaces one section, and writes the rest back, so the codec's whole job is to
// survive that round trip. It used to do it with a lookahead — `(?=^==== |\Z)` — and `\Z` is not an end-of-string
// anchor in JavaScript: outside unicode mode it is an identity escape for the letter Z. The last section of a file
// therefore never matched, and `--only rp` quietly dropped whichever section happened to sit last. Splitting on the
// marker lines has no such case: a section is whatever follows its marker up to the next one, including the last.

const SECTION = /^==== (\w+) ====\n/m;

export function parseRecord(text) {
  const blocks = new Map();
  // parts[0] is the file's leading `#` comment block, which the writer rebuilds and the reader discards; the rest
  // alternate name, body, because the capturing group is kept by `split`.
  const parts = String(text || '').split(SECTION);
  for (let i = 1; i < parts.length; i += 2) blocks.set(parts[i], parts[i + 1] ?? '');
  return blocks;
}

export function renderRecord(blocks, header = '') {
  let out = header;
  for (const [name, body] of blocks) out += `==== ${name} ====\n${String(body).replace(/\n*$/, '\n')}\n`;
  return out;
}
