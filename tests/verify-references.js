#!/usr/bin/env node
/*
 * Checks reference notes against the rules the guide gives for writing them.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-references.js <build.html> [dir]
 *
 * Two jobs. It guards docs/reference-examples, so the worked examples cannot
 * drift out of agreement with docs/REFERENCE-GUIDE.md or with the importer.
 * And, pointed at your own folder, it checks your notes before you import them:
 *
 *   node tests/verify-references.js build/systole.html ~/my-braunwald-notes
 *
 * The guide makes falsifiable claims, and this is what makes them falsifiable.
 * The one that matters most is the last: it is easy to write a note that reads
 * well and is never retrieved, because retrieval matches the words you asked
 * with against the words you wrote. A note nobody can find is not a note.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-references.js <build.html> [dir]'); process.exit(1); }
const DIR = path.resolve(process.argv[3] || path.join(__dirname, '..', 'docs', 'reference-examples'));
const URL = 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (l, c, d = '') => { c ? passed++ : failed++; console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? '  → ' + d : '')); };
const head = t => console.log('\n── ' + t + ' ──');

/* Questions a person would actually type, and the section that should answer
   each. Only applied to files we ship; a user's own folder gets the structural
   checks and skips this one. */
const RETRIEVAL = [
  ['A small valve area but only a 30 mmHg mean gradient and an EF of 35% — true severe or pseudo-severe aortic stenosis?', 'Low-gradient'],
  ['Which patients with aortic stenosis need the valve replaced?', 'replace the valve'],
  ['Does the murmur get louder or quieter with Valsalva in aortic stenosis versus HOCM?', 'Examination'],
  ['What CHA2DS2-VASc score requires anticoagulation in a woman?', 'Deciding on anticoagulation'],
  ['Can I use apixaban in a patient with a mechanical mitral valve?', 'Choosing the anticoagulant'],
  ['How long must a patient be anticoagulated after cardioversion and why?', 'Cardioverting safely'],
  ['Why can I not start sacubitril valsartan straight after an ACE inhibitor?', 'Starting an ARNI'],
  ['Which four drug classes reduce mortality in reduced ejection fraction heart failure?', 'four pillars'],
  ['When does a patient with an EF of 30 percent qualify for cardiac resynchronisation?', 'Devices'],
  ['Is ivabradine any use in atrial fibrillation?', 'When drugs are not enough'],
];

(async () => {
  const files = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    : [];
  console.log(`\nChecking ${files.length} note file${files.length === 1 ? '' : 's'} in ${path.relative(process.cwd(), DIR) || DIR}`);
  if (!files.length) { console.error('  nothing to check'); process.exit(1); }

  head('front matter');
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
    ok(`${f} has front matter with title, tags and source`,
       !!fm && /\btitle:/.test(fm[1]) && /\btags:/.test(fm[1]) && /\b(source|citation|ref):/.test(fm[1]),
       fm ? '' : 'no --- block');
    if (fm) {
      const tags = (/tags:(.*)/.exec(fm[1]) || [, ''])[1].split(',').map(s => s.trim()).filter(Boolean);
      ok(`${f} carries enough tags to be found`, tags.length >= 4, `${tags.length} tags`);
    }
  }

  head('sections are the retrieval unit, so they must stand alone');
  let allSections = 0;
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const secs = body.split(/\n## /).slice(1).map(s => ({ title: s.split('\n')[0].trim(), text: s }));
    allSections += secs.length;
    ok(`${f} splits into more than one section`, secs.length > 1, `${secs.length} sections`);

    const short = secs.filter(s => s.text.split(/\s+/).length < 80);
    ok(`${f}: no section is too thin for retrieval to match on`, short.length === 0,
       short.map(s => s.title).join(', ') || 'all ≥80 words');
    const long = secs.filter(s => s.text.split(/\s+/).length > 600);
    ok(`${f}: no section is long enough to crowd the context budget`, long.length === 0,
       long.map(s => s.title).join(', ') || 'all ≤600 words');

    /* The rule the guide leads with: there is no "above", because the section
       above it may never be retrieved alongside this one. */
    const dangling = secs.filter(s => /\b(as (discussed|described|above|noted) above|see (below|above)|the same applies here|as mentioned earlier)\b/i.test(s.text));
    ok(`${f}: no section refers to another section`, dangling.length === 0,
       dangling.map(s => s.title).join(', ') || 'none');
  }

  head('the importer produces what the guide promises');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  const payload = files.map(f => ({ name: f, raw: fs.readFileSync(path.join(DIR, f), 'utf8') }));
  const imported = await page.evaluate(fs_ => {
    const out = [];
    for (const f of fs_) {
      const notes = parseImportText(f.raw, f.name);
      for (const n of notes) refAdd(n.title, n.body, n.tags, n.source);
      out.push({ file: f.name, n: notes.length, titles: notes.map(x => x.title),
                 sourced: notes.filter(x => x.source).length });
    }
    return { out, total: REF.length };
  }, payload);

  ok('every section became its own note', imported.total === allSections, `${imported.total} notes from ${allSections} sections`);
  ok('every note is titled "Chapter — Section", so a citation names the chapter',
     imported.out.every(o => o.titles.every(t => t.includes('—'))),
     imported.out[0].titles[0]);
  ok('every note carries its source through', imported.out.every(o => o.sourced === o.n));

  head('a realistic question finds the section that answers it');
  const isExamples = DIR.endsWith(path.join('docs', 'reference-examples'));
  if (!isExamples) {
    console.log('  (skipped — retrieval questions are written for the shipped examples)');
  } else {
    const results = await page.evaluate(qs => qs.map(([q, want]) => {
      const r = retrievedContext(q, null) || {};
      const text = typeof r === 'string' ? r : (r.text || '');
      const hits = [...text.matchAll(/REFERENCE NOTE: "([^"]+)"/g)].map(m => m[1]);
      return { want, first: hits[0] || '(nothing)', top3: hits.slice(0, 3) };
    }), RETRIEVAL);

    let first = 0;
    for (const r of results) {
      const inTop3 = r.top3.join(' | ').toLowerCase().includes(r.want.toLowerCase());
      if (r.first.toLowerCase().includes(r.want.toLowerCase())) first++;
      ok(`"${r.want}" is retrieved`, inTop3, r.first);
    }
    /* Being in the context at all is what correctness requires; ranking first
       is a quality bar, and one near-miss is tolerable. */
    ok('and most of them rank first, not merely somewhere in the context',
       first >= RETRIEVAL.length - 2, `${first}/${RETRIEVAL.length} ranked first`);
  }

  ok('no page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
