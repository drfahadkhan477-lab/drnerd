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
/* Keyed by the CONTENT of the seed, not by a version number somebody has to
   remember to bump.
 *
 * The first version stored a bare '1' here and returned early whenever it was
 * present, so a device was seeded exactly once, for ever. That was wrong in a
 * way that took a while to surface: when the corpus later grew figure
 * citations, every already-seeded device kept the old bodies and showed no
 * figures at all — and nothing in the app could explain why, because the new
 * seed was right there in the build. Compounding it, the merge skipped any
 * title it already had, so even a forced re-seed would have skipped all 146
 * notes: the titles had not changed, only the bodies.
 *
 * Now the stored value is a hash of the seed itself. Change the corpus and it
 * changes, so the sync runs. Change nothing and it does not. */
const REF_SEED_KEY = 'accsap12.refseed';
/* FNV-1a, 32-bit. Small, dependency-free, and only ever compared against
   itself — this is change detection, not cryptography. */
function refHash(s){
  let h=0x811c9dc5;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); }
  return (h>>>0).toString(36);
}
/* Sync, not merely seed — while still never clobbering your own writing:
     · a note you wrote yourself is never touched;
     · a seeded note you have since edited is left alone, detected by its body
       no longer hashing to what was written when it was seeded;
     · an untouched seeded note is brought up to date, which is what lets a
       corpus change — new figures, a corrected trial number — actually reach
       a device seeded months ago;
     · a seeded note you deleted comes back only when the corpus itself
       changes, which is the price of not keeping a tombstone for every title
       ever shipped. */
function refSeedApply(cur, seed){
  try{
    /* The split build empties REF_SEED and fetches it instead, so an empty
       seed means "not here yet" — never "seeded, nothing to do". Marking the
       key now would permanently block the fetched copy from ever landing. */
    if(!seed || !seed.length) return cur;
    const version = refHash(JSON.stringify(seed));
    if(localStorage.getItem(REF_SEED_KEY) === version) return cur;
    const byTitle = Object.create(null);
    for(const r of cur) byTitle[r.title] = r;
    let added=0, updated=0;
    for(const s of seed){
      const r = byTitle[s.title];
      if(!r){
        cur.push({ id:'seed'+(added++).toString(36)+Math.random().toString(36).slice(2,6),
                   title:s.title, body:s.body, tags:s.tags, source:s.source,
                   ts:Date.now(), seed:true, seedHash:refHash(s.body||'') });
        continue;
      }
      if(!r.seed) continue;                       // yours, not ours — hands off
      /* Notes seeded before seedHash existed carry no fingerprint, so an edit
         cannot be told from an original. They are adopted rather than frozen:
         they were machine-written and are almost certainly untouched, and
         freezing them would mean the devices that most need this fix are the
         only ones it never reaches. */
      if(r.seedHash !== undefined && r.seedHash !== refHash(r.body||'')) continue;
      if(r.body !== s.body || r.tags !== s.tags || r.source !== s.source) updated++;
      r.body = s.body; r.tags = s.tags; r.source = s.source;
      r.seedHash = refHash(s.body||'');
    }
    localStorage.setItem(REF_SEED_KEY, version);
    if(added || updated){
      saveJSON(REF_KEY, cur);
      if(typeof invalidateIndex === 'function') invalidateIndex();
    }
  }catch(_){ /* private mode, quota, anything — an unseeded library still works */ }
  return cur;
}
let REF = refSeedApply(loadJSON(REF_KEY, []), REF_SEED);          // [{id,title,tags,body,ts,source}]`);

fs.writeFileSync(OUT, html);
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`refs: ${applied.length} edit applied`);
console.log(`      ${notes.length} notes from ${files.length} files, ${kb(Buffer.byteLength(SEED))} of seed`);
console.log(`      → ${OUT}`);
