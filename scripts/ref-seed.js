#!/usr/bin/env node
/*
 * Reference seed — ship the Braunwald corpus already loaded.
 *
 * A library: scripts/assemble-app.js calls buildRefSeed() to fill REF_SEED.
 * (It was the refs-patch.js step of the patch chain, now deleted.)
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

/* Overridable as ref-images-patch's is, and by the same variable: the two
   read one corpus, and a caller that redirects only one of them pairs the
   real notes with the fixture's figures. */
const REFS_DIR = process.env.SYSTOLE_REFS_DIR || path.join(__dirname, '..', 'content', 'refs');

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

function findMarkdownFiles(dir) {
  const mdFiles = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        mdFiles.push(...findMarkdownFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md') {
        mdFiles.push(fullPath);
      }
    }
  } catch (_) {}
  return mdFiles;
}

/* The seed, built from a corpus directory. Exported so scripts/assemble-app.js
   fills the frozen shell's REF_SEED slot with exactly what this step writes;
   the script below calls it with REFS_DIR. */
function buildRefSeed(dir = REFS_DIR) {
  let notes = [];
  let files = [];

  if (!fs.existsSync(dir)) {
    console.error(`refs: ${path.relative(process.cwd(), dir)} does not exist — nothing to seed.`);
    // Continue with empty seed to keep patch chain intact
  } else {
    files = findMarkdownFiles(dir);
    if (!files.length) {
      console.error(`refs: no .md files in ${path.relative(process.cwd(), dir)} — nothing to seed.`);
    } else {
      for (const f of files) notes.push(...notesFromFile(f));
    }
  }

  /* A note the importer would reject is a note that will never be retrieved.
     Fail loudly here rather than shipping dead weight. */
  const thin = notes.filter(n => n.body.split(/\s+/).length < 40);
  if (thin.length) throw new Error(`refs: ${thin.length} section(s) too thin to retrieve: ${thin.map(n => n.title).join(', ')}`);
  const untitled = notes.filter(n => !n.title.includes('—'));
  if (untitled.length) throw new Error(`refs: ${untitled.length} note(s) missing a chapter title`);

  return { notes, files, seed: JSON.stringify(notes) };
}

module.exports = { buildRefSeed, findMarkdownFiles, REFS_DIR };
