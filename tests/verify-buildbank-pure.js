#!/usr/bin/env node
/*
 * A bank of your own is built from study files you have reviewed, and from
 * nothing less.
 *
 *   node tests/verify-buildbank-pure.js
 *
 * Pure Node. scripts/build-bank.js turns study files in Memorizer's format
 * (docs/MEMORIZER-STUDY-FILE-PROMPT.md) and a bank.json into a bank in the
 * content schema, which npm run build turns into the app. This holds:
 *
 *   - a signed study file becomes a bank the app builds from: each question
 *     keeps its stem, options, key, explanation and the reason each wrong
 *     option is wrong, under an id from its own number, in the bank that
 *     bank.json names, and no ACCSAP correction touches it;
 *   - a question without 4 options, a key, an explanation or a reason for
 *     each wrong option, with two options alike or an "all of the above",
 *     without a number or with one used twice, is refused; so is an id two
 *     files give, a missing bank.json, or one with ACCSAP 12's id; every
 *     refusal names the file and the number, never a word of the question;
 *   - a file not signed off, or changed since, is refused, and an edit
 *     outside its questions does not count; --draft builds it, and says so
 *     in the bank's name; --sign refuses a file that breaks a rule;
 *   - deleting a question renumbers none of the others;
 *   - a refused build leaves the last good bank as it was, and a bank
 *     replaces only a bank: an --out folder holding anything else is refused;
 *   - to write the questions yourself: --init writes bank.json and never
 *     replaces one, nor takes ACCSAP 12's id or a name the app would refuse;
 *     --new writes a study file of empty numbered questions and never replaces
 *     a file; a question begun and not finished, which the parser would pass
 *     over in silence, is refused even in a draft, but one commented out is
 *     not; filled in, the file checks, signs and builds; --check says which.
 *
 * Every question here is invented placeholder text.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'scripts', 'build-bank.js'));
const A = require(path.join(ROOT, 'scripts', 'assemble-app.js'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildbank-'));

/* A study file in the format the prompt asks for. q: { num, stem, options,
   answer (letter), explain, why: { A: '…' } }; any field can be left out or
   broken to make the file a fixture for one refusal. */
const L = 'ABCD';
const question = q => [
  q.num === null ? '### A question with no number' : `### Question ${q.num}: invented point ${q.num}`,
  `**Stem**: Invented stem ${q.num}, about an invented finding?`, '',
  '**Options**:', ...q.options.map((t, k) => `- ${L[k]}) ${t}`), '',
  ...(q.answer ? [`**Correct Answer**: ${q.answer}`, ''] : []),
  ...(q.explain === '' ? [] : [`**Explanation**: ${q.explain || 'Invented reason the key is right.'}`, '']),
  '**Why the distractors are wrong**:', ...Object.entries(q.why).map(([k, t]) => `- ${k}) ${t}`), '', '---', ''].join('\n');
const good = num => ({ num, options: ['Invented one', 'Invented two', 'Invented three', 'Invented four'].map(t => `${t} ${num}`),
  answer: 'B', why: { A: 'Invented reason A fails.', C: 'Invented reason C fails.', D: 'Invented reason D fails.' } });
const studyFile = (qs, fm = { chapter: 'Invented Chapter', prefix: 'inv' }, teaching = 'an invented fact') =>
  (fm ? '---\n' + Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n' : '') +
  `# Invented unit\n\n## Teaching\n\n- **Term**: ${teaching}.\n\n## Practice Questions\n\n` + qs.map(question).join('\n');
let n = 0;
const source = (files, bankJson = { id: 'my-bank', name: 'My Bank' }) => {
  const src = path.join(dir, 'src-' + (++n));
  fs.mkdirSync(src);
  if (bankJson) fs.writeFileSync(path.join(src, 'bank.json'), JSON.stringify(bankJson));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(src, name), text);
  return src;
};
/* '' when signed, else why not: a file the builder will not sign is a fixture
   for a refusal, or a check below that fails and says so. */
const sign = (src, name) => { try { B.signStudyFile(path.join(src, name), '2026-10-14'); return ''; } catch (e) { return e.message; } };
const tryBuild = (src, opts = {}) => {
  const out = opts.out || path.join(dir, 'out-' + (++n));
  try { return { r: B.buildBank({ src, out, draft: !!opts.draft }), out, why: '' }; }
  catch (e) { return { r: null, out, why: e.message }; }
};
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));

(async () => {
head('a signed study file becomes a bank the app builds from');
{
  const src = source({ 'one.md': studyFile([good(1), good(2)]) });
  sign(src, 'one.md');
  const b = tryBuild(src);
  ok('it builds', !!b.r, b.why.split('\n').slice(0, 2).join(' '));
  if (b.r) {
    const m = readJSON(path.join(b.out, 'manifest.json')), qs = readJSON(path.join(b.out, 'questions.json'));
    ok('in the bank bank.json names, with every question counted', JSON.stringify(m.bank) === JSON.stringify({ id: 'my-bank', name: 'My Bank' }) && m.questions === 2 && qs.length === 2,
       JSON.stringify(m.bank) + `, ${qs.length}`);
    const q = qs[0];
    ok('each question under an id from its own number, in the chapter its file names',
       q.id === 'inv_1' && qs[1].id === 'inv_2' && q.ch === 'Invented Chapter' && q.n === 1, `${q.id} ${qs[1].id} ${q.ch} ${q.n}`);
    ok('with its stem, its four options as the app reads them, and its key',
       q.s === 'Invented stem 1, about an invented finding?' && JSON.stringify(q.o.map(o => o.l + ':' + o.t)) === JSON.stringify(good(1).options.map((t, k) => L[k] + ':' + t)) && q.ci === 1,
       `${q.ci} ${q.o.map(o => o.l).join('')}`);
    ok('and its explanation, then why each wrong option is wrong, under its letter',
       q.ex === 'Invented reason the key is right.\n\nWhy the other options are wrong:\nA) Invented reason A fails.\nC) Invented reason C fails.\nD) Invented reason D fails.' &&
       JSON.stringify(q.why) === JSON.stringify(['Invented reason A fails.', '', 'Invented reason C fails.', 'Invented reason D fails.']), q.ex.replace(/\n/g, ' / '));
    let fromApp = null;
    try { fromApp = A.producers({ bank: await A.readBank(b.out) }); } catch (e) { ok('the app reads it', false, e.message.split('\n')[0]); }
    if (fromApp) {
      ok('the app builds from it as that bank', fromApp('payload', 'BANK') === JSON.stringify({ id: 'my-bank', name: 'My Bank', by: '' }), fromApp('payload', 'BANK'));
      const app = JSON.parse(fromApp('payload', 'ALL_Q'));
      ok('with every question as the bank gave it: no ACCSAP correction or flag', app.length === 2 && app.every((x, k) => x.ci === qs[k].ci && !x.flag && !x.bad && x.ex === qs[k].ex));
    }
  }
  if (b.r) {
    /* The code-only deploy's road: the package the iPad imports, read back
       with the page's own reader and checked with its own check. */
    const zip = path.join(dir, 'mine.zip');
    let read = null;
    try {
      require(path.join(ROOT, 'tools', 'pack-content.js')).pack(b.out, zip);
      read = await A.readBank(zip);
    } catch (e) { read = { error: e.message.split('\n')[0] }; }
    ok('and it packs for the iPad, its name with it', !!read && !read.error && read.questions.length === 2 && JSON.stringify(read.manifest.bank) === JSON.stringify({ id: 'my-bank', name: 'My Bank' }),
       read && read.error ? read.error : read ? JSON.stringify(read.manifest.bank) : 'nothing');
  }
  const plain = source({ 'heart-unit.md': studyFile([good(1)], { }) });
  sign(plain, 'heart-unit.md');
  const p = tryBuild(plain);
  const pq = p.r ? readJSON(path.join(p.out, 'questions.json'))[0] : {};
  ok('with no front matter to say, the chapter is the file\'s title and the prefix its name',
     pq.ch === 'Invented unit' && pq.id === 'heart-unit_1', `${pq.ch} ${pq.id} ${p.why.split('\n')[1] || ''}`);
}

head('a question that breaks a rule is refused, by file and number, never by its words');
const refusals = [];
const refused = (label, files, re, bankJson) => {
  const src = source(files, bankJson);
  for (const name of Object.keys(files)) sign(src, name);   // a broken file is not signed: the build refuses it either way
  const b = tryBuild(src);
  refusals.push(b.why);
  ok(label, !b.r && re.test(b.why), (b.why.split('\n').find(l => re.test(l)) || b.why.split('\n')[1] || 'built').trim());
};
{
  const noReason = good(3); delete noReason.why.C;
  refused('a wrong option with no reason why', { 'f.md': studyFile([good(1), noReason]) }, /f\.md, question 3: no reason why C is wrong/);
  refused('three options', { 'f.md': studyFile([{ ...good(1), options: good(1).options.slice(0, 3), why: { A: 'a', C: 'c' } }]) }, /question 1: 3 options, not 4/);
  refused('no Correct Answer', { 'f.md': studyFile([{ ...good(1), answer: '' }]) }, /question 1: no Correct Answer/);
  refused('no Explanation', { 'f.md': studyFile([{ ...good(1), explain: '' }]) }, /question 1: no Explanation/);
  refused('two options alike', { 'f.md': studyFile([{ ...good(1), options: ['Same', 'same.', 'Other', 'Fourth'] }]) }, /question 1: two options are the same/);
  refused('an "all of the above"', { 'f.md': studyFile([{ ...good(1), options: ['One', 'Two', 'Three', 'All of the above'] }]) }, /question 1: an "all\/none of the above" option/);
  refused('a question with no number', { 'f.md': studyFile([good(1), { ...good(2), num: null }]) }, /question \(unnumbered\): its heading gives no number/);
  refused('a number used twice', { 'f.md': studyFile([good(1), good(1)]) }, /question 1: the number is used twice/);
  refused('an id two files give', { 'a.md': studyFile([good(1)]), 'b.md': studyFile([good(1)]) }, /b\.md, question 1: its id inv_1 is given by a\.md too/);
  refused('no bank.json', { 'f.md': studyFile([good(1)]) }, /bank\.json: missing/, null);
  refused('a bank.json with ACCSAP 12\'s id', { 'f.md': studyFile([good(1)]) }, /gives ACCSAP 12's id/, { id: 'accsap-12', name: 'Mine' });
  ok('and no refusal carries a word of a question', refusals.every(w => w && !/Invented (stem|one|two|three|four|reason)/.test(w)),
     refusals.filter(w => /Invented (stem|one|two|three|four|reason)/.test(w)).map(w => w.slice(0, 60)).join(' | ') || `${refusals.length} refusals`);
}

head('nothing ships unreviewed');
{
  const src = source({ 'f.md': studyFile([good(1), good(2)]) });
  const unsigned = tryBuild(src);
  ok('a file not signed off is refused, and told how to sign it', !unsigned.r && /f\.md is not signed off: read every question in it, then node scripts\/build-bank\.js --sign/.test(unsigned.why),
     unsigned.why.split('\n')[1] || 'built');
  const d = tryBuild(src, { draft: true });
  ok('--draft builds it, says so, and names the bank a draft', !!d.r && d.r.draft && /f\.md is not signed off: built as a draft/.test(d.r.warnings.join()) &&
     readJSON(path.join(d.out, 'manifest.json')).bank.name === 'My Bank (draft)', d.r ? d.r.warnings.join(' | ') : d.why.split('\n')[1]);
  sign(src, 'f.md');
  const signedText = fs.readFileSync(path.join(src, 'f.md'), 'utf8');
  ok('--sign records the date and the digest of its questions in the front matter',
     /^---\nchapter: Invented Chapter\nprefix: inv\nreviewed: 2026-10-14 sha256:[0-9a-f]{12}\n---\n/.test(signedText), signedText.split('\n').slice(0, 5).join(' / '));
  ok('and the signed file builds, not as a draft', (b => !!b.r && !b.r.draft)(tryBuild(src)));
  fs.writeFileSync(path.join(src, 'f.md'), signedText.replace('Invented teaching', 'x').replace('an invented fact', 'a rewritten invented fact'));
  ok('an edit outside its questions does not need signing again', (b => !!b.r)(tryBuild(src)), tryBuild(src).why.split('\n')[1] || '');
  fs.writeFileSync(path.join(src, 'f.md'), signedText.replace('Invented reason C fails.', 'Invented reason C fails, edited.'));
  const changed = tryBuild(src);
  ok('an edit to a question, even to one reason, does', !changed.r && /f\.md has changed since it was signed off/.test(changed.why), changed.why.split('\n')[1] || 'built');
  const bare = source({ 'g.md': studyFile([good(1)], null) });
  sign(bare, 'g.md');
  ok('a file with no front matter gets one to hold the sign-off', /^---\nreviewed: 2026-10-14 sha256:[0-9a-f]{12}\n---\n# Invented unit/.test(fs.readFileSync(path.join(bare, 'g.md'), 'utf8')));
  const broken = source({ 'h.md': studyFile([{ ...good(1), answer: '' }]) });
  const before = fs.readFileSync(path.join(broken, 'h.md'), 'utf8');
  const why = sign(broken, 'h.md');
  ok('--sign refuses a file that breaks a rule, and leaves it as it was', /h\.md was not signed/.test(why) && fs.readFileSync(path.join(broken, 'h.md'), 'utf8') === before, why.split('\n')[0] || 'signed');
}

head('ids last: deleting a question renumbers nothing');
{
  const src = source({ 'f.md': studyFile([good(1), good(2), good(3)]) });
  fs.writeFileSync(path.join(src, 'f.md'), studyFile([good(1), good(3)]));
  sign(src, 'f.md');
  const b = tryBuild(src);
  const ids = b.r ? readJSON(path.join(b.out, 'questions.json')).map(q => q.id) : [];
  ok('question 3 keeps its id when question 2 is deleted', ids.join() === 'inv_1,inv_3', ids.join() || b.why.split('\n')[1]);
}

head('a refused build leaves the last good bank as it was');
{
  const src = source({ 'f.md': studyFile([good(1)]) });
  sign(src, 'f.md');
  const out = path.join(dir, 'kept');
  const first = tryBuild(src, { out });
  const bytes = () => { try { return fs.readFileSync(path.join(out, 'questions.json')); } catch (_) { return null; } };
  const snapshot = first.r ? bytes() : null;
  fs.writeFileSync(path.join(src, 'f.md'), fs.readFileSync(path.join(src, 'f.md'), 'utf8').replace('Invented reason A fails.', 'Edited after signing.'));
  const second = tryBuild(src, { out });
  const now = bytes();
  ok('the bank written before is still there, byte for byte', !!first.r && !second.r && !!now && !!snapshot && now.equals(snapshot) &&
     !fs.readdirSync(dir).some(f => /^kept\.(tmp|old)-/.test(f)), second.r ? 'the second build went through' : now ? 'kept' : 'gone');
  /* --out build, or a folder of your own: a bank takes the place of a bank,
     and of nothing else. */
  const fine = source({ 'f.md': studyFile([good(1)]) });
  sign(fine, 'f.md');
  const mine = path.join(dir, 'not-a-bank');
  fs.mkdirSync(mine);
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'kept');
  const over = tryBuild(fine, { out: mine });
  ok('an --out folder that holds no bank is refused, and left as it was', !over.r && /not-a-bank is there and holds no bank/.test(over.why) &&
     fs.readdirSync(mine).join() === 'notes.txt' && fs.readFileSync(path.join(mine, 'notes.txt'), 'utf8') === 'kept', over.r ? 'it was replaced' : over.why.split('\n')[0]);
}

head('writing the questions yourself: --init, --new, --check');
/* The template --new writes, with the questions numbered in nums filled in
   as a fellow would: a stem, four options, the key, the explanation, and a
   reason for each wrong option, the right one's line deleted. */
const fillIn = (text, nums) => text.split(/(?=^### Question \d+:)/m).map(part => {
  const m = /^### Question (\d+):/.exec(part);
  if (!m || !nums.includes(+m[1])) return part;
  const k = m[1];
  return part.replace(/^### Question \d+:/, `### Question ${k}: invented point ${k}`)
    .replace('**Stem**: ', `**Stem**: Invented stem ${k}, about an invented finding?`)
    .replace(/(\*\*Options\*\*:\n)- A\) \n- B\) \n- C\) \n- D\) /, `$1- A) Invented one ${k}\n- B) Invented two ${k}\n- C) Invented three ${k}\n- D) Invented four ${k}`)
    .replace('**Correct Answer**: ', '**Correct Answer**: B')
    .replace('**Explanation**: ', '**Explanation**: Invented reason the key is right.')
    .replace(/(\*\*Why the distractors are wrong\*\*:\n)- A\) \n- B\) \n- C\) \n- D\) /, '$1- A) Invented reason A fails.\n- C) Invented reason C fails.\n- D) Invented reason D fails.');
}).join('');
const attempt = fn => { try { return { r: fn(), why: '' }; } catch (e) { return { r: null, why: e.message }; } };
{
  const own = path.join(dir, 'own');
  const i1 = attempt(() => B.initBank(own, { name: 'My Cardiology Bank', by: 'Dr Invented' }));
  const bj = attempt(() => readJSON(path.join(own, 'bank.json')));
  ok('--init writes bank.json: the name, an id made from it, and whose commentary it is',
     JSON.stringify(bj.r) === JSON.stringify({ id: 'my-cardiology-bank', name: 'My Cardiology Bank', by: 'Dr Invented' }), i1.why || bj.why || JSON.stringify(bj.r));
  const before = fs.existsSync(path.join(own, 'bank.json')) ? fs.readFileSync(path.join(own, 'bank.json'), 'utf8') : null;
  const again = attempt(() => B.initBank(own, { name: 'Another Name' }));
  ok('it never replaces a bank.json already there', !again.r && /already exists/.test(again.why) && before !== null && fs.readFileSync(path.join(own, 'bank.json'), 'utf8') === before,
     again.why || 'replaced');
  const asAccsap = attempt(() => B.initBank(path.join(dir, 'own-accsap'), { name: 'Mine', id: 'accsap-12' }));
  ok('it refuses ACCSAP 12\'s id', !asAccsap.r && /ACCSAP 12's id/.test(asAccsap.why) && !fs.existsSync(path.join(dir, 'own-accsap', 'bank.json')), asAccsap.why || 'written');
  const badName = attempt(() => B.initBank(path.join(dir, 'own-bad'), { name: 'Mine <b>' }));
  ok('and a name the app\'s own check would refuse', !badName.r && !fs.existsSync(path.join(dir, 'own-bad', 'bank.json')), badName.why || 'written');

  /* Named apart from its prefix, so the ids show which one they come from. */
  const file = path.join(own, 'valvular-disease.md');
  const n1 = attempt(() => B.newStudyFile(file, { chapter: 'Valvular Disease', prefix: 'valve', questions: 3 }));
  const blank = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const heads = [...blank.matchAll(/^### Question (\d+):$/gm)].map(m => +m[1]);
  ok('--new writes a study file of the questions asked for, numbered, under its chapter and prefix',
     heads.join() === '1,2,3' && /^---\nchapter: Valvular Disease\nprefix: valve\n---\n/.test(blank), n1.why || heads.join() || 'no file');
  const asIs = attempt(() => B.readStudyFile(file));
  const notFinished = asIs.r ? asIs.r.problems.filter(p => /^valvular-disease\.md, question \d: not finished \(no stem with options under its heading\)$/.test(p)) : [];
  ok('left as it is, each of its questions is refused as not finished, by number', notFinished.length === 3, asIs.why || asIs.r.problems.join(' | '));
  const kept = attempt(() => B.newStudyFile(file, { chapter: 'Elsewhere' }));
  ok('--new never replaces a file', !kept.r && /already exists/.test(kept.why) && fs.readFileSync(file, 'utf8') === blank, kept.why || 'replaced');
  const noChapter = attempt(() => B.newStudyFile(path.join(own, 'nochapter.md'), {}));
  ok('and asks which chapter, writing nothing without one', !noChapter.r && /--chapter/.test(noChapter.why) && !fs.existsSync(path.join(own, 'nochapter.md')), noChapter.why || 'written');

  /* The silent drop this guards: a question whose heading is written and
     whose stem and options are not is no question to the parser, so without
     the check the file would build, a question short, and say nothing. */
  fs.writeFileSync(file, fillIn(blank, [1, 3]));
  const begun = attempt(() => B.readStudyFile(file));
  const left = begun.r ? begun.r.problems : [begun.why];
  ok('a question begun and not finished is refused even when the rest are done',
     left.length === 1 && left[0] === 'valvular-disease.md, question 2: not finished (no stem with options under its heading)', left.join(' | ') || 'no problem found');
  const draftToo = tryBuild(own, { draft: true });
  ok('and even a draft build refuses it', !draftToo.r && /question 2: not finished/.test(draftToo.why), draftToo.r ? `built ${draftToo.r.questions} questions` : draftToo.why.split('\n')[1]);
  fs.writeFileSync(file, fillIn(blank, [1, 3]).replace(/### Question 2:[\s\S]*?---\n/, m => '<!--\n' + m.replace(/-->/g, '') + '-->\n'));
  const commented = attempt(() => B.readStudyFile(file));
  ok('a question commented out is not one begun', !!commented.r && commented.r.problems.length === 0 && commented.r.questions.length === 2,
     commented.r ? commented.r.problems.join(' | ') : commented.why);

  fs.writeFileSync(file, fillIn(blank, [1, 2, 3]));
  const filled = attempt(() => B.readStudyFile(file));
  const signed = sign(own, 'valvular-disease.md');
  const built = tryBuild(own);
  const qs = built.r ? readJSON(path.join(built.out, 'questions.json')) : [];
  const m = built.r ? readJSON(path.join(built.out, 'manifest.json')) : {};
  ok('filled in, it checks clean, signs, and builds under its prefix, in its chapter, as the bank --init named',
     !!filled.r && filled.r.problems.length === 0 && signed === '' && qs.map(q => q.id).join() === 'valve_1,valve_2,valve_3' &&
     qs.every(q => q.ch === 'Valvular Disease') && JSON.stringify(m.bank) === JSON.stringify({ id: 'my-cardiology-bank', name: 'My Cardiology Bank', by: 'Dr Invented' }),
     (filled.r ? filled.r.problems.join(' | ') : filled.why) || signed.split('\n')[0] || built.why.split('\n')[1] || qs.map(q => q.id).join());
}

head('the command line');
{
  const src = source({ 'f.md': studyFile([good(1)]) });
  /* From a folder of its own, so a flag's value taken for a folder lands in
     the scratch folder, not in the repository. */
  const cli = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-bank.js'), ...a], { encoding: 'utf8', cwd: dir });
  const out = path.join(dir, 'cli-out');
  const r1 = cli(src, '--out', out);
  ok('an unsigned file stops it, exit 1', r1.status === 1 && /not signed off/.test(r1.stderr), `exit ${r1.status}`);
  const r2 = cli('--sign', path.join(src, 'f.md'));
  ok('--sign signs it, exit 0', r2.status === 0 && /^signed f\.md: 1 questions, sha256:[0-9a-f]{12}/.test(r2.stdout), `exit ${r2.status}: ${r2.stdout.trim()}`);
  const r3 = cli(src, '--out', out);
  ok('then it builds, and says what to run next', r3.status === 0 && /^built My Bank: 1 questions from 1 study file/.test(r3.stdout) && /next: npm run build -- /.test(r3.stdout), `exit ${r3.status}`);

  const mine = path.join(dir, 'cli-own');
  const i = cli('--init', 'Clinic Bank', '--by', 'Me', mine);
  const ib = attempt(() => readJSON(path.join(mine, 'bank.json')));
  ok('--init "…" --by "…" <folder> writes bank.json in that folder, exit 0',
     i.status === 0 && JSON.stringify(ib.r) === JSON.stringify({ id: 'clinic-bank', name: 'Clinic Bank', by: 'Me' }) && /^wrote .*bank\.json: Clinic Bank \(id clinic-bank\)/.test(i.stdout),
     `exit ${i.status}: ${(i.stdout + i.stderr).trim()}`);
  const f = path.join(mine, 'unit.md');
  const nw = cli('--new', f, '--chapter', 'Invented Chapter', '--questions', '2');
  ok('--new <file> --chapter "…" --questions 2 writes it, exit 0', nw.status === 0 && /^wrote unit\.md: 2 empty questions to fill in/.test(nw.stdout), `exit ${nw.status}: ${(nw.stdout + nw.stderr).trim()}`);
  const c1 = cli('--check', f);
  ok('--check says each unfinished question, exit 1', c1.status === 1 && /^unit\.md: \d+ problem\(s\)/.test(c1.stdout) && /question 1: not finished/.test(c1.stdout) && /question 2: not finished/.test(c1.stdout),
     `exit ${c1.status}: ${c1.stdout.split('\n')[0]}`);
  if (fs.existsSync(f)) fs.writeFileSync(f, fillIn(fs.readFileSync(f, 'utf8'), [1, 2]));
  const c2 = cli('--check', f);
  ok('filled in, it is ready to read and sign, exit 0', c2.status === 0 && c2.stdout.trim() === 'unit.md: 2 questions, ready to read and sign (--sign)', `exit ${c2.status}: ${c2.stdout.trim()}`);
  cli('--sign', f);
  const c3 = cli('--check', f);
  ok('and once signed, says so', c3.status === 0 && c3.stdout.trim() === 'unit.md: 2 questions, signed', `exit ${c3.status}: ${c3.stdout.trim()}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})().catch(e => {
  ok('the suite ran to its end', false, String(e && e.message || e).split('\n')[0]);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
});
