#!/usr/bin/env node
/*
 * Does this reference corpus clear the floors the suites enforce?
 *
 *   node tools/check-refs.js [dir]        # default: content/refs
 *
 * WHY THIS EXISTS. A corpus that is merely present is not a corpus the suites
 * can pass. Six of them read it, each with a floor of its own, and the floors
 * live in six different files — so the first time anybody learns a corpus is
 * too small is 29 minutes into a full run, after a build. That happened, and
 * the run was spent discovering that three worked examples produce 12 notes
 * citing no figures.
 *
 * This answers the same question in about two seconds and without a build.
 *
 * WHAT IT IS NOT. It does not replace verify-references, which drives the real
 * importer in a real browser and asks whether a question retrieves the section
 * that answers it. Retrieval QUALITY cannot be measured here and this says so
 * rather than implying coverage it does not have. Everything below is a
 * structural floor: necessary, not sufficient.
 *
 * The pearl numbers come from the shipped src/core/pearl.js, loaded and run,
 * never reimplemented — a second copy of that scoring logic would drift from
 * the first and report confidently about a module nobody ships.
 *
 * Exit status is 1 when any floor fails, so it can gate a commit.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.resolve(process.argv[2] || path.join(ROOT, 'content', 'refs'));
const IMAGES = path.join(path.dirname(DIR), 'refs-images');

/* Load the app's own pearl module against a stand-in global, the way
   verify-rhythms-pure does. The file ends with an IIFE that attaches to
   window-or-this; handing it an object is enough. */
function loadPearl() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'core', 'pearl.js'), 'utf8')
    .replace(/\}\)\(typeof window[\s\S]*$/, '})(root);');
  const shim = {};
  new Function('root', src)(shim);
  return shim.Pearl;
}

/* The importer's own rule: one note per `##` section, titled "<file> — <section>".
   Kept deliberately close to scripts/refs-patch.js, because a parser that
   disagrees with the one doing the baking would measure a corpus nobody ships. */
function parse(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort();
  const notes = [], meta = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    const front = fm ? fm[1] : '';
    const field = k => ((new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(front) || [, ''])[1] || '').trim();
    const title = field('title');
    const body = fm ? raw.slice(fm[0].length) : raw;
    const sections = body.split(/^## /m).slice(1).map(sec => {
      const nl = sec.indexOf('\n');
      return { title: sec.slice(0, nl).trim(), body: sec.slice(nl + 1).trim() };
    });
    meta.push({
      file: f, title, source: field('source'),
      tags: field('tags').split(',').map(s => s.trim()).filter(Boolean),
      sections, keys: [...raw.matchAll(/refimg:\/\/([^)\s]+)/g)].map(m => m[1]),
    });
    for (const s of sections) {
      notes.push({ title: `${title} — ${s.title}`, body: s.body, file: f });
    }
  }
  return { files, notes, meta };
}

let failed = 0;
const rows = [];
const check = (label, pass, detail) => {
  if (!pass) failed++;
  rows.push({ label, pass, detail: String(detail) });
};

if (!fs.existsSync(DIR)) {
  console.error(`check-refs: ${path.relative(process.cwd(), DIR)} does not exist.`);
  console.error('The build needs one: scripts/refs-patch.js exits 1 without it.');
  console.error('See docs/REFERENCE-GUIDE.md for the format.');
  process.exit(1);
}

const Pearl = loadPearl();
const { files, notes, meta } = parse(DIR);

/* ── the floors, each named with the suite that owns it ───────────────────── */
const thin = [];
const fat = [];
const backref = [];
const BACKREF = /\b(as discussed (above|below)|see (the section|below|above)|the previous section|mentioned earlier)\b/i;
for (const m of meta) {
  for (const s of m.sections) {
    const words = s.body.split(/\s+/).filter(Boolean).length;
    if (words < 40) thin.push(`${m.file} — ${s.title} (${words}w)`);
    if (words > 600) fat.push(`${m.file} — ${s.title} (${words}w)`);
    if (BACKREF.test(s.body)) backref.push(`${m.file} — ${s.title}`);
  }
}
const noFront = meta.filter(m => !m.title || !m.source || !m.tags.length).map(m => m.file);
const fewTags = meta.filter(m => m.tags.length < 4).map(m => `${m.file} (${m.tags.length})`);
const single = meta.filter(m => m.sections.length < 2).map(m => m.file);
const missingImg = [];
for (const m of meta) {
  for (const k of m.keys) if (!fs.existsSync(path.join(IMAGES, k))) missingImg.push(`${m.file}: ${k}`);
}

const pearls = Pearl.harvest(notes);
const lens = pearls.map(p => String(p.text || '').length).sort((a, b) => a - b);
const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
const figTitles = new Set(notes.filter(n => /refimg:\/\//.test(n.body)).map(n => n.title));
const withFig = pearls.filter(p => figTitles.has(p.title)).length;

check('refs-patch: no section under 40 words', thin.length === 0, thin.slice(0, 3).join('; ') || 'none');
check('guide: no section over 600 words', fat.length === 0, fat.slice(0, 3).join('; ') || 'none');
check('guide: no section refers to another', backref.length === 0, backref.slice(0, 3).join('; ') || 'none');
check('guide: every file carries title, tags and source', noFront.length === 0, noFront.slice(0, 3).join(', ') || 'none');
check('guide: every file carries at least four tags', fewTags.length === 0, fewTags.slice(0, 3).join(', ') || 'none');
check('guide: every file splits into more than one section', single.length === 0, single.slice(0, 3).join(', ') || 'none');
check('every refimg:// key resolves to a file', missingImg.length === 0, missingImg.slice(0, 3).join('; ') || 'none');
check('retrieval: more than 100 notes', notes.length > 100, `${notes.length} notes`);
check('pearl: more than 100 pearls', pearls.length > 100, `${pearls.length} pearls`);
check('pearl: more than 5 carry a figure', withFig > 5, `${withFig} with a figure`);
check('pearl: median at least 220 characters', median >= 220, `${median} chars`);
check('pearl: none below the floor', (lens[0] || 0) >= Pearl.MIN, `shortest ${lens[0] || 0}, floor ${Pearl.MIN}`);

console.log(`\n${path.relative(process.cwd(), DIR) || DIR} — ${files.length} files, ${notes.length} notes, ${pearls.length} pearls\n`);
for (const r of rows) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label.padEnd(50)} → ${r.detail}`);
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
if (failed) {
  console.log('\nRetrieval quality (R@1, prefix and typo ranking) is NOT measured here.');
  console.log('It needs the built app — see tests/verify-retrieval.js.');
}
process.exit(failed ? 1 : 0);
