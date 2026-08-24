#!/usr/bin/env node
/*
 * Reference seed — ship the Braunwald corpus already loaded.
 *
 *   node scripts/refs-patch.js <input.html> <output.html>
 *
 * The library and the importer already exist (braunwald-patch). What was
 * missing is that a fresh install starts empty, so grounded mode has nothing
 * to be grounded against until somebody remembers to import a folder. This
 * step reads content/refs/*.md at build time and bakes the resulting notes in
 * as a seed, so the app opens with the corpus already there.
 *
 * THREE THINGS THIS IS CAREFUL ABOUT.
 *
 * 1. IT NEVER CLOBBERS YOUR NOTES. The seed is merged into whatever is already
 *    stored, and only for titles not already present. Your own edits to a
 *    seeded note survive, because the merge is keyed on title and skips any
 *    title it finds.
 *
 * 2. IT SEEDS ONCE, NOT EVERY LOAD. A version key records that seeding has
 *    happened. Without it, deleting a seeded note would simply bring it back
 *    on the next reload, which is infuriating and looks like a bug. Bump the
 *    version in REF_SEED_KEY when the corpus changes enough to want re-seeding.
 *
 * 3. IT STAYS OUT OF THE PWA SHELL. The corpus is ~295 KB, and the split
 *    build's shell budget is 800 KB with ~708 KB already spent. So the seed is
 *    emitted between two marker comments that build-pwa.js can find, lift out
 *    to content/, and replace with a fetch — the same move extract-content.js
 *    already makes for the question bank. The single-file build keeps it
 *    inline, where 295 KB against 27 MB is not worth a round trip.
 *
 * The parse here must agree with the app's own parseImportText: one note per
 * `##` section, titled "<file title> — <section>", carrying the file's tags and
 * source. tests/verify-references.js checks the corpus against the same rules
 * the importer applies, so a file that would import badly fails there first.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/refs-patch.js <input.html> <output.html>');
  process.exit(1);
}

const REFS_DIR = path.join(__dirname, '..', 'content', 'refs');

/* ── parse the corpus exactly the way the importer will ───────────────────── */
function field(fm, key) {
  const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(fm);
  return m ? m[1].trim() : '';
}

function notesFromFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const meta = fm ? fm[1] : '';
  const body = fm ? raw.slice(fm[0].length) : raw;
  const title = field(meta, 'title') || path.basename(file, '.md');
  const tags = field(meta, 'tags');
  const source = field(meta, 'source') || field(meta, 'citation') || field(meta, 'ref');

  return body.split('\n## ').slice(1).map(sec => {
    const lines = sec.split('\n');
    return {
      title: title + ' — ' + lines[0].trim(),
      body: lines.slice(1).join('\n').trim(),
      tags, source,
    };
  });
}

if (!fs.existsSync(REFS_DIR)) {
  console.error(`refs: ${path.relative(process.cwd(), REFS_DIR)} does not exist — nothing to seed.`);
  process.exit(1);
}
const files = fs.readdirSync(REFS_DIR)
  .filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
  .sort();
if (!files.length) {
  console.error(`refs: no .md files in ${path.relative(process.cwd(), REFS_DIR)} — nothing to seed.`);
  process.exit(1);
}

const notes = [];
for (const f of files) notes.push(...notesFromFile(path.join(REFS_DIR, f)));

/* A note the importer would reject is a note that will never be retrieved.
   Fail loudly here rather than shipping dead weight. */
const thin = notes.filter(n => n.body.split(/\s+/).length < 40);
if (thin.length) throw new Error(`refs: ${thin.length} section(s) too thin to retrieve: ${thin.map(n => n.title).join(', ')}`);
const untitled = notes.filter(n => !n.title.includes('—'));
if (untitled.length) throw new Error(`refs: ${untitled.length} note(s) missing a chapter title`);

const SEED = JSON.stringify(notes);

/* ── the patch ────────────────────────────────────────────────────────────── */
let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

patch('refs: the library ships already populated',
`let REF = loadJSON(REF_KEY, []);          // [{id,title,tags,body,ts}]`,
`const REF_SEED = /*REF_SEED_START*/${SEED}/*REF_SEED_END*/;
/* Bump this key to re-seed after the corpus changes. Leaving it alone is what
   stops a deleted note reappearing on every reload. */
const REF_SEED_KEY = 'accsap12.refseed.v1';
/* Merge, never overwrite: a title already present is left exactly as it is,
   so your edits to a seeded note survive and your own notes are untouched. */
function refSeedApply(cur, seed){
  try{
    /* The split build empties REF_SEED and fetches it instead, so an empty
       seed means "not here yet" — never "seeded, nothing to do". Marking the
       key now would permanently block the fetched copy from ever landing. */
    if(!seed || !seed.length) return cur;
    if(localStorage.getItem(REF_SEED_KEY)) return cur;
    const have = Object.create(null);
    for(const r of cur) have[r.title] = 1;
    let n = 0;
    for(const s of seed){
      if(have[s.title]) continue;
      cur.push({ id:'seed'+(n++).toString(36)+Math.random().toString(36).slice(2,6),
                 title:s.title, body:s.body, tags:s.tags, source:s.source,
                 ts:Date.now(), seed:true });
    }
    localStorage.setItem(REF_SEED_KEY,'1');
    if(n) saveJSON(REF_KEY, cur);
  }catch(_){ /* private mode, quota, anything — an unseeded library still works */ }
  return cur;
}
let REF = refSeedApply(loadJSON(REF_KEY, []), REF_SEED);          // [{id,title,tags,body,ts,source}]`);

fs.writeFileSync(OUT, html);
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`refs: ${applied.length} edit applied`);
console.log(`      ${notes.length} notes from ${files.length} files, ${kb(Buffer.byteLength(SEED))} of seed`);
console.log(`      → ${OUT}`);
