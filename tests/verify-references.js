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
const { launch } = require('./_engine');

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
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  const payload = files.map(f => ({ name: f, raw: fs.readFileSync(path.join(DIR, f), 'utf8') }));
  const imported = await page.evaluate(fs_ => {
    /* The build ships a seeded library now (refs-patch). Start from empty:
       the count below is a claim about what THIS corpus produced, and the
       retrieval check further down wants your notes ranked against each
       other rather than against whatever else happened to be on the shelf. */
    REF.length = 0; invalidateIndex();
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
      /* Retrieved notes are fenced with a per-turn nonce now (boundary-patch),
         so the title is the first line inside the opening fence rather than
         part of a plain heading. */
      const hits = [...text.matchAll(/<<<NOTE-[A-Z0-9]{12}>>>\ntitle: ([^\n]+)/g)].map(m => m[1]);
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

  /* The seeded library has to keep up with the corpus. The first version of
     refSeedApply stored a bare flag and returned early whenever it was set, so
     a device seeded before the notes gained figure citations kept the old
     bodies for ever — the figures were in the build and never reached the
     shelf. These drive refSeedApply directly, because the failure is invisible
     from the outside: the library looks fully populated either way. */
  head('a seeded library keeps up when the corpus changes');
  const sync = await page.evaluate(() => {
    const key = 'accsap12.refseed';
    const v1 = [{ title: 'A — one', body: 'first body', tags: 't', source: 's' }];
    const v2 = [{ title: 'A — one', body: 'first body ![f](refimg://x.jpg)', tags: 't', source: 's' },
                { title: 'B — two', body: 'brand new', tags: 't', source: 's' }];

    localStorage.removeItem(key);
    let shelf = refSeedApply([], v1);
    const seededOnce = shelf.length;

    /* Same seed again: nothing should move, or a deleted note would return on
       every reload. */
    shelf = refSeedApply(shelf, v1);
    const stableOnRerun = shelf.length;

    /* Corpus changes: the untouched note updates, the new one arrives. */
    shelf = refSeedApply(shelf, v2);
    const updated = shelf.find(r => r.title === 'A — one');
    const updatedBody = updated.body;          // read now: it is mutated below
    const addedNew = !!shelf.find(r => r.title === 'B — two');

    /* An edited seeded note must survive a later change to the same title. */
    updated.body = 'I rewrote this myself.';
    const v3 = [{ title: 'A — one', body: 'third body', tags: 't', source: 's' }];
    shelf = refSeedApply(shelf, v3);
    const mine = shelf.find(r => r.title === 'A — one').body;

    /* And a note the fellow wrote is never touched at all. */
    shelf.push({ id: 'own1', title: 'C — mine', body: 'my own note', tags: '', source: '' });
    const v4 = [{ title: 'C — mine', body: 'REPLACED', tags: '', source: '' }];
    shelf = refSeedApply(shelf, v4);
    const own = shelf.find(r => r.title === 'C — mine').body;

    localStorage.removeItem(key);
    return { seededOnce, stableOnRerun, updatedBody, addedNew, mine, own };
  });
  ok('a fresh shelf gets seeded', sync.seededOnce === 1, String(sync.seededOnce));
  ok('the same seed twice changes nothing, so a deleted note stays deleted',
     sync.stableOnRerun === 1, String(sync.stableOnRerun));
  ok('an untouched seeded note picks up the new body — this is the figures bug',
     /refimg:\/\//.test(sync.updatedBody), sync.updatedBody);
  ok('a note added to the corpus arrives on an already-seeded shelf', sync.addedNew);
  ok('a seeded note you edited is never overwritten', sync.mine === 'I rewrote this myself.', sync.mine);
  ok('a note you wrote yourself is never touched', sync.own === 'my own note', sync.own);

  ok('no page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
