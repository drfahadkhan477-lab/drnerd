#!/usr/bin/env node
/*
 * Reading the fellow's own notes as they are imported — src/core/refimport.js.
 *
 *   node tests/verify-refimport-pure.js
 *
 * Pure Node, over invented files. The module is given a file's text and name, or a link and the files that came
 * with it, so every expected value is written out here from the fixture, never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - front matter is taken off and never becomes a note; its title, tags and source are read, quoted or not, and
 *     a source written as citation: or ref: is still a source; a file without it comes back as it was;
 *   - a heading inside a fenced code block does not split the note;
 *   - a JSON array of notes is taken as it stands; a Markdown file with several sections is a note per section,
 *     titled with the front matter's title as a prefix; a file with one section is one note, titled from the front
 *     matter, else its heading, else its description, else its file name;
 *   - tags come from the front matter, else its name, else the file name;
 *   - an image link is resolved by its exact path, else the one path ending in it, else the one file of its base
 *     name, and to nothing where none of those is unique;
 *   - a note's refimg:// figures, in the order cited, and no other image;
 *   - nothing handed in is changed;
 *   - the page's five functions are the calls into this, and the module is written into the page above them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const R = require('../src/core/refimport.js').RefImport;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* A module that throws says FAIL where it was asked, and the run goes on. */
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };
const show = v => JSON.stringify(v);

head('front matter is taken off, and read');
{
  const raw = '---\nname: heart_failure-notes\ndescription: Notes on failure\ntitle: "Heart failure"\ntags: hf, gdmt\ncitation: Invented Atlas, ch. 3\n---\n# Diuretics\nLoop first.\n';
  const r = safely(() => R.frontmatter(raw));
  ok('the body is what follows the closing ---', r.body === '# Diuretics\nLoop first.\n', show(r.body));
  ok('title (its quotes taken off), tags, name and description are read', r.meta && r.meta.title === 'Heart failure' && r.meta.tags === 'hf, gdmt'
     && r.meta.name === 'heart_failure-notes' && r.meta.desc === 'Notes on failure', show(r.meta));
  ok('a source written as citation: is the source', r.meta && r.meta.source === 'Invented Atlas, ch. 3', show(r.meta && r.meta.source));
  const ref = safely(() => R.frontmatter('---\nref: Invented Review 2020\n---\nBody'));
  ok('and so is one written as ref:', ref.meta && ref.meta.source === 'Invented Review 2020' && ref.body === 'Body', show(ref));
  const crlf = safely(() => R.frontmatter('---\r\ntitle: Windows\r\n---\r\nText'));
  ok('Windows line endings are front matter too', crlf.meta && crlf.meta.title === 'Windows' && crlf.body === 'Text', show(crlf));
  const none = safely(() => R.frontmatter('# Just a note\n---\nnot front matter'));
  ok('a file that does not open with --- has none, and comes back as it was', none.meta === null && none.body === '# Just a note\n---\nnot front matter', show(none));
}

head('sections split at headings, never inside a fenced block');
{
  const body = 'Intro line\n# One\nA\n```\n# a shell comment, not a heading\n```\n## Two\nB\n\n### Three\n';
  const s = safely(() => R.sections(body));
  ok('three headings after an intro make four sections, the fenced # left inside the first heading\'s', same(s, [
    'Intro line', '# One\nA\n```\n# a shell comment, not a heading\n```', '## Two\nB', '### Three']), show(s));
  ok('a line of #s with no space after is not a heading', same(safely(() => R.sections('#hashtag\ntext')), ['#hashtag\ntext']));
  ok('blank sections are dropped', same(safely(() => R.sections('\n\n# A\n\n')), ['# A']));
}

head('a file becomes notes');
{
  const json = '[{"title":"T1","body":"B1","tags":"x"},{"body":"B2"}]';
  ok('a JSON array is taken as it stands, an untitled note called Untitled', same(safely(() => R.parse(json, 'n.json')),
    [{ title: 'T1', body: 'B1', tags: 'x' }, { title: 'Untitled', body: 'B2', tags: '' }]));
  const multi = '---\ntitle: Valves\ntags: vhd\nsource: Invented Text\n---\n# Aortic stenosis\nGradient.\n## Mitral stenosis\nOpening snap.\n';
  ok('several sections: a note each, titled with the front matter\'s title first, its tags and source on each', same(safely(() => R.parse(multi, 'valves.md')), [
    { title: 'Valves — Aortic stenosis', body: 'Gradient.', tags: 'vhd', source: 'Invented Text' },
    { title: 'Valves — Mitral stenosis', body: 'Opening snap.', tags: 'vhd', source: 'Invented Text' }]));
  ok('without front matter, each section is titled by its own heading, and the tags are the file name\'s words', same(safely(() => R.parse('# A\nx\n# B\ny', 'heart_failure-notes.md')), [
    { title: 'A', body: 'x', tags: 'heart failure notes', source: '' }, { title: 'B', body: 'y', tags: 'heart failure notes', source: '' }]));
  ok('a front matter name is the tags where it gives none', same(safely(() => R.parse('---\nname: cath-lab_basics\n---\nOne paragraph.', 'f.md')),
    [{ title: 'f', body: 'One paragraph.', tags: 'cath lab basics', source: '' }]));
  ok('one section: titled by its heading, the heading taken off the body', same(safely(() => R.parse('# Pericarditis\nFriction rub.', 'p.md')),
    [{ title: 'Pericarditis', body: 'Friction rub.', tags: 'p', source: '' }]));
  ok('else by the front matter\'s description', same(safely(() => R.parse('---\ndescription: About syncope\n---\nNo heading here.', 's.md')),
    [{ title: 'About syncope', body: 'No heading here.', tags: 's', source: '' }]));
  ok('else by the file name', same(safely(() => R.parse('Plain text only.', 'plain-notes.txt')),
    [{ title: 'plain-notes', body: 'Plain text only.', tags: 'plain notes', source: '' }]));
  ok('the front matter never becomes a note of its own', safely(() => R.parse('---\ntitle: T\n---\n# H\nx', 'f.md')).every(n => !/---|title:/.test(n.body)));
}

head('the file an image link names: exact, then the one path ending in it, then the one file of its name');
{
  const f = n => ({ name: n.split('/').pop(), id: n });
  const files = ['atlas/visuals/012.jpg', 'atlas/visuals/013.jpg', 'other/visuals/013.jpg', 'loose/014.png', 'a/015.png', 'b/015.png'].map(f);
  const byPath = {}, byName = {};
  for (const x of files) { byPath[x.id] = x; (byName[x.name] = byName[x.name] || []).push(x); }
  const before = show([byPath, byName]);
  const at = ref => { const r = safely(() => R.resolveAsset(ref, byPath, byName)); return r && r.id !== undefined ? r.id : r; };
  ok('its exact path', at('atlas/visuals/012.jpg') === 'atlas/visuals/012.jpg');
  ok('a leading ./ or /, and a ?query or #hash, are taken off first', at('./atlas/visuals/012.jpg?v=2') === 'atlas/visuals/012.jpg' && at('/atlas/visuals/012.jpg#x') === 'atlas/visuals/012.jpg');
  ok('the one path that ends in it', at('visuals/012.jpg') === 'atlas/visuals/012.jpg');
  ok('two paths ending in it, and two files of its name: nothing, never a guess', at('visuals/013.jpg') === null, show(at('visuals/013.jpg')));
  ok('the one file of its name, when no path ends in it', at('figures/014.png') === 'loose/014.png');
  ok('two files of that name: nothing', at('015.png') === null);
  ok('no file at all: nothing', at('missing.png') === null);
  ok('and the maps handed in are as they were', show([byPath, byName]) === before);
}

head('a note\'s figures, in the order cited');
{
  const body = 'See ![LV in systole](refimg://ab12.webp) then ![](refimg://cd34.png), not ![web](https://x.invalid/a.png) or ![local](visuals/1.jpg).';
  ok('each refimg:// figure with its caption, in order, and no other image', same(safely(() => R.images(body)), [{ caption: 'LV in systole', key: 'ab12.webp' }, { caption: '', key: 'cd34.png' }]));
  ok('a note with no body has none', same(safely(() => R.images(undefined)), []) && same(safely(() => R.images('')), []));
  ok('asked twice, the same answer (no state kept between calls)', same(safely(() => R.images(body)), safely(() => R.images(body))));
}

head('the page\'s five functions are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const once = text => page.split(text).length - 1 === 1;
  const lines = [
    'function extractRefImages(body){ return RefImport.images(body); }',
    'function stripFrontmatter(raw){ return RefImport.frontmatter(raw); }',
    'function splitSections(body){ return RefImport.sections(body); }',
    'function parseImportText(raw,filename){ return RefImport.parse(raw,filename); }',
    'function refResolveAsset(ref, byPath, byName){ return RefImport.resolveAsset(ref,byPath,byName); }',
  ];
  const names = ['extractRefImages', 'stripFrontmatter', 'splitSections', 'parseImportText', 'refResolveAsset'];
  const missing = lines.filter((l, i) => !once(l) || !once('function ' + names[i] + '('));
  ok('each old name is one line handing over what it was given, and is defined once', missing.length === 0, missing.join(' | ') || 'all five');
  const slot = page.indexOf('@@SLOT[src:src/core/refimport.js]@@');
  ok('and the module is written into the page once, above all five', slot >= 0 && page.indexOf('@@SLOT[src:src/core/refimport.js]@@', slot + 1) < 0
     && names.every(n => page.indexOf('function ' + n + '(') > slot), slot < 0 ? 'no slot' : 'slot at ' + slot);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
