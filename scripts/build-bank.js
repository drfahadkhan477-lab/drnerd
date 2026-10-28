#!/usr/bin/env node
/*
 * A question bank of your own, built from study files: step 5 of the
 * independence plan.
 *
 *   node scripts/build-bank.js [source/bank] [--out build/bank] [--draft]
 *   node scripts/build-bank.js --sign <study-file.md>
 *   npm run build -- build/bank          then the app is built from it
 *
 * and, to write the questions yourself rather than have Claude draft them:
 *
 *   node scripts/build-bank.js --init "My Cardiology Bank" [--by "…"] [source/bank]
 *   node scripts/build-bank.js --new source/bank/<file>.md --chapter "Valvular Disease"
 *                              [--prefix valve] [--questions 5]
 *   node scripts/build-bank.js --check source/bank/<file>.md
 *
 * --init writes bank.json; --new a study file of numbered question blocks
 * with every field empty, to fill in; --check says what the builder would
 * refuse in one file, or that it is ready to sign.
 *
 * THE SOURCE is a folder (source/bank by default: gitignored, so a bank
 * drafted from your books stays on your own machine) holding
 *
 *   bank.json   which bank this is, the manifest's bank block
 *               (docs/CONTENT-SCHEMA.md): { "id": "my-bank", "name": "My bank" }
 *   *.md        study files in Memorizer's format (the study-file prompt is
 *               Memorizer's docs/MEMORIZER-STUDY-FILE-PROMPT.md, in its own
 *               repository): the questions Claude
 *               drafts from a chapter of your notes, or ones you write
 *
 * and each study file can say, in its front matter,
 *
 *   chapter:   the chapter its questions go under (its title otherwise)
 *   prefix:    the start of every id it gives (its file name otherwise)
 *   reviewed:  written by --sign once you have read every question in it
 *
 * The file is read by Memorizer's parser, kept in scripts/study-file/ since
 * Memorizer moved to its own repository, so a file Memorizer reads one way is
 * not read another way here while the two copies are the same.
 *
 * WHAT IT REFUSES, naming the file and the question's number, never a word
 * of a question:
 *   - a question without exactly 4 options, a Correct Answer, an Explanation,
 *     or a reason for each wrong option: the rule the plan set, that a
 *     question ships only with why each distractor is wrong;
 *   - two options alike, or an "all of the above" or "none of the above";
 *   - a question with no number, a number used twice, an id another file gives;
 *   - a question begun and not finished: a "### Question N" heading with no
 *     stem and options under it, which the parser would pass over in silence;
 *   - a file you have not signed off, or have changed since: --sign records a
 *     digest of its questions, and an edit after that means reading it again.
 * --draft builds unsigned files too, to look at in the app, and names the
 * bank "(draft)" so it cannot be taken for a reviewed one.
 *
 * IDS LAST. An id is <prefix>_<number>, the number the question's heading
 * gives it ("### Question 3: …"). Deleting a question renumbers nothing, so
 * what the app has learned about a question stays with that question.
 *
 * THE BANK it writes is the content schema's: manifest.json with the bank
 * block, questions.json, and an empty figures/. It is checked by
 * src/core/bankpack.js, the check the iPad runs, before it replaces
 * anything, and written beside the old one and swapped in whole.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SI = require('./study-file/studyImport.js');
const Spec = require('./study-file/spec.js');
const { ACCSAP } = require('./which-bank.js');
const { writeBankFolder } = require('./bank-folder.js');

const LETTERS = 'ABCDEFGH';
const SAFE_PREFIX = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,60}$/;
const ALL_NONE = /^(?:all|none|both|neither) of the (?:above|options|others)\b/i;

function bankPack() {
  const sandbox = {};
  new Function(fs.readFileSync(path.join(ROOT, 'src', 'core', 'bankpack.js'), 'utf8')).call(sandbox);
  return sandbox.BankPack;
}

/* The digest --sign records: of what the bank takes from the file, each
   question's number, stem, options, key, explanation and reasons, so an edit
   to any of them, and only to them, needs signing again. */
function digestOf(questions) {
  const canon = questions.map(q => [q.num, q.question, q.options, q.answer, q.explain, q.options.map((_, k) => q.why[k] || '')]);
  return crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex').slice(0, 12);
}
const signedDigest = meta => { const m = /sha256:([0-9a-f]{12})\b/.exec(String(meta.reviewed || '')); return m ? m[1] : ''; };

/* The numbers of the "### Question N" headings in the text the parser reads:
   as it does, without a fence around the whole file, the front matter, HTML
   comments or code blocks, so a question commented out is not one begun. */
function numberedHeadings(text) {
  let src = String(text || '').replace(/\r\n?/g, '\n');
  const fenced = src.trim().match(/^(`{3,}|~{3,})\s*(?:markdown|md)?\s*\n([\s\S]*)\n\1\s*$/i);
  if (fenced) src = fenced[2];
  src = src.replace(/^---\n[\s\S]*?\n---\s*(?:\n|$)/, '').replace(/<!--[\s\S]*?-->/g, '\n').replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, '\n');
  return [...new Set([...src.matchAll(/^#{1,6}[ \t]+q(?:uestion)?[ \t]*(\d+)\b/gim)].map(m => +m[1]))];
}
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* readStudyFile(file) → { name, chapter, prefix, questions, digest, signed, problems }
   problems are "<file>, question N: why", ids and numbers only. */
function readStudyFile(file) {
  const name = path.basename(file);
  const text = fs.readFileSync(file, 'utf8');
  const p = SI.parseMarkdown(text);
  const meta = p.meta || {};
  const problems = [];
  const where = q => `${name}, question ${q.num || '(unnumbered)'}`;
  const chapter = String(meta.chapter || p.title || '').trim();
  const prefix = String(meta.prefix || name.replace(/\.[^.]+$/, '')).trim();
  if (!chapter) problems.push(`${name}: no chapter (front matter "chapter:", or a "# Title")`);
  if (!SAFE_PREFIX.test(prefix)) problems.push(`${name}: the id prefix is not letters, digits, _ . - (set "prefix:" in its front matter)`);
  if (!p.questions.length) problems.push(`${name}: no questions read (a "## Practice Questions" section, each "### Question N: …")`);
  const seen = new Set();
  for (const q of p.questions) {
    if (!q.num) problems.push(`${where(q)}: its heading gives no number ("### Question N: …")`);
    else if (seen.has(q.num)) problems.push(`${where(q)}: the number is used twice in the file`);
    seen.add(q.num);
    if (q.options.length !== Spec.OPTIONS) problems.push(`${where(q)}: ${q.options.length} options, not ${Spec.OPTIONS}`);
    if (!(q.answer >= 0 && q.answer < q.options.length)) problems.push(`${where(q)}: no Correct Answer among its options`);
    if (!String(q.question || '').trim()) problems.push(`${where(q)}: no stem`);
    if (!String(q.explain || '').trim()) problems.push(`${where(q)}: no Explanation`);
    const keys = q.options.map(norm);
    if (new Set(keys).size !== keys.length) problems.push(`${where(q)}: two options are the same`);
    if (q.options.some(o => ALL_NONE.test(String(o).trim()))) problems.push(`${where(q)}: an "all/none of the above" option`);
    const unreasoned = q.options.map((_, k) => k).filter(k => k !== q.answer && !String(q.why[k] || '').trim()).map(k => LETTERS[k]);
    if (unreasoned.length) problems.push(`${where(q)}: no reason why ${unreasoned.join(', ')} ${unreasoned.length === 1 ? 'is' : 'are'} wrong ("Why the distractors are wrong")`);
  }
  /* A question begun and not finished: a heading with no stem and options
     under it is no question to the parser, and would leave the bank without
     a word. So every numbered question heading must come back as a question. */
  const parsed = new Set(p.questions.map(q => q.num));
  for (const n of numberedHeadings(text)) if (!parsed.has(n)) problems.push(`${name}, question ${n}: not finished (no stem with options under its heading)`);
  const digest = digestOf(p.questions);
  return { file, name, chapter, prefix, questions: p.questions, digest, signed: signedDigest(meta) === digest, wasSigned: !!signedDigest(meta), problems };
}

/* A study file's question as the bank holds it. The reasons the wrong
   options are wrong follow the explanation, each under its letter, so the
   app shows them with the commentary; `why` keeps them by option too. */
function bankQuestion(sf, q) {
  const reasons = q.options.map((_, k) => k).filter(k => k !== q.answer).map(k => `${LETTERS[k]}) ${q.why[k]}`);
  return {
    id: `${sf.prefix}_${q.num}`, ch: sf.chapter, n: q.num,
    s: q.question,
    o: q.options.map((t, k) => ({ l: LETTERS[k], t })),
    ci: q.answer,
    ex: q.explain + '\n\nWhy the other options are wrong:\n' + reasons.join('\n'),
    why: q.options.map((_, k) => (k === q.answer ? '' : q.why[k])),
    img: 0, figs: [],
  };
}

const studyFilesIn = dir => fs.readdirSync(dir).filter(f => /\.(md|markdown)$/i.test(f) && f.toLowerCase() !== 'readme.md').sort().map(f => path.join(dir, f));

/* buildBank({ src, out, draft }) → { questions, files, draft, warnings }
   Throws, listing every problem, and leaves out as it was. */
function buildBank({ src, out, draft = false }) {
  const problems = [], warnings = [];
  let which = null, parsed = false;
  const bankJson = path.join(path.basename(src), 'bank.json');
  try { which = JSON.parse(fs.readFileSync(path.join(src, 'bank.json'), 'utf8')); parsed = true; }
  catch (e) { problems.push(`${bankJson}: ${e.code === 'ENOENT' ? 'missing' : 'not JSON'}. It says which bank this is: { "id": "my-bank", "name": "My bank" }`); }
  /* null, a list, a number or a string is JSON, and no bank block. */
  if (parsed && (!which || typeof which !== 'object' || Array.isArray(which))) {
    problems.push(`${bankJson}: not an object. It says which bank this is: { "id": "my-bank", "name": "My bank" }`);
    which = null;
  }
  if (which && which.id === ACCSAP.id) problems.push(`bank.json gives ACCSAP 12's id (${ACCSAP.id}); a bank of your own needs its own, or ACCSAP's corrections would be applied to it`);
  const files = fs.existsSync(src) ? studyFilesIn(src) : [];
  if (!files.length) problems.push(`${src}: no study files (.md) in it`);
  const read = files.map(readStudyFile);
  const ids = new Map();
  for (const sf of read) {
    problems.push(...sf.problems);
    for (const q of sf.questions) {
      const id = `${sf.prefix}_${q.num}`;
      if (q.num && ids.has(id) && ids.get(id) !== sf.name) problems.push(`${sf.name}, question ${q.num}: its id ${id} is given by ${ids.get(id)} too (set a different "prefix:")`);
      ids.set(id, ids.get(id) || sf.name);
    }
    if (!sf.signed) {
      const why = sf.wasSigned ? 'has changed since it was signed off' : 'is not signed off';
      if (draft) warnings.push(`${sf.name} ${why}: built as a draft`);
      else problems.push(`${sf.name} ${why}: read every question in it, then node scripts/build-bank.js --sign ${path.relative(ROOT, sf.file) || sf.file}`);
    }
  }
  if (problems.length) throw new Error(`no bank was built (${problems.length} problem(s)):\n  ` + problems.join('\n  '));

  const isDraft = warnings.length > 0;
  const bank = { id: which.id, name: isDraft ? `${String(which.name).slice(0, 52)} (draft)` : which.name };
  if (which.by) bank.by = which.by;
  const questions = read.flatMap(sf => sf.questions.map(q => bankQuestion(sf, q)));
  const manifest = {
    schemaVersion: bankPack().SCHEMA, bank,
    questions: questions.length, figures: 0,
    chapters: [...new Set(questions.map(q => q.ch))].sort(),
    sources: read.map(sf => ({ file: sf.name, questions: sf.questions.length, digest: sf.digest, signed: sf.signed })),
  };
  const written = [
    { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: 'questions.json', bytes: Buffer.from(JSON.stringify(questions)) },
  ];
  const verdict = bankPack().validate(written.map(f => ({ name: f.name, bytes: new Uint8Array(f.bytes) })));
  if (!verdict.ok) throw new Error(`the bank would be refused on the iPad (${verdict.problemCount} problem(s)):\n  ` + verdict.problems.slice(0, 10).join('\n  '));

  /* Written beside, swapped in whole, and only over a bank: a refusal or a
     crash leaves the last good bank where it was. */
  writeBankFolder(out, written);
  return { questions: questions.length, files: read.length, draft: isDraft, warnings, bank };
}

/* --sign: record that the file was read, with the digest of its questions.
   A file that breaks a rule is not signed: there is nothing to sign off. */
function signStudyFile(file, today = new Date().toISOString().slice(0, 10)) {
  const sf = readStudyFile(file);
  if (sf.problems.length) throw new Error(`${sf.name} was not signed (${sf.problems.length} problem(s)):\n  ` + sf.problems.join('\n  '));
  const line = `reviewed: ${today} sha256:${sf.digest}`;
  const text = fs.readFileSync(file, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  let next;
  if (!fm) next = `---\n${line}\n---\n` + text;
  else {
    const body = /^reviewed:.*$/m.test(fm[1]) ? fm[1].replace(/^reviewed:.*$/m, line) : fm[1] + '\n' + line;
    next = text.slice(0, fm.index) + '---\n' + body + '\n---\n' + text.slice(fm.index + fm[0].length);
  }
  const tmp = file + '.sign-' + process.pid;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  return { file: sf.name, questions: sf.questions.length, digest: sf.digest };
}

/* --init: bank.json, which says which bank this is. The id is the name's,
   lowercased, unless given; the block is held to the rules the app's own
   check holds a manifest's bank to. An existing bank.json is never replaced. */
function initBank(dir, { name, id, by } = {}) {
  if (!name || !String(name).trim()) throw new Error('a bank needs a name: --init "My Cardiology Bank"');
  const block = { id: String(id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40), name: String(name).trim() };
  if (by) block.by = String(by).trim();
  if (block.id === ACCSAP.id) throw new Error(`${ACCSAP.id} is ACCSAP 12's id; a bank of your own needs its own`);
  const v = bankPack().validate([
    { name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify({ schemaVersion: bankPack().SCHEMA, bank: block })) },
    { name: 'questions.json', bytes: new TextEncoder().encode('[{"id":"q_1","ch":"c","o":["a","b"],"ci":0}]') }]);
  if (!v.ok) throw new Error('the app would refuse it: ' + v.problems.join('; '));
  const file = path.join(dir, 'bank.json');
  if (fs.existsSync(file)) throw new Error(`${file} already exists: edit it, or move it away first`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(block, null, 2) + '\n');
  return block;
}

/* --new: a study file to write questions into by hand, in the format the
   builder reads. Every field is empty: one left so is refused, never built
   (an empty question is caught by its heading, above). */
function questionBlock(n) {
  return [`### Question ${n}:`, '**Stem**: ', '', '**Options**:', '- A) ', '- B) ', '- C) ', '- D) ', '',
    '**Correct Answer**: ', '', '**Explanation**: ', '', '**Why the distractors are wrong**:', '- A) ', '- B) ', '- C) ', '- D) ', '', '---', ''].join('\n');
}
function newStudyFile(file, { chapter, prefix, questions = 5 } = {}) {
  if (!chapter || !String(chapter).trim()) throw new Error('say which chapter its questions go under: --chapter "Valvular Disease"');
  if (prefix && !SAFE_PREFIX.test(prefix)) throw new Error('the prefix is letters, digits, _ . - only');
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  const n = Math.max(1, Math.min(50, parseInt(questions, 10) || 5));
  const text = ['---', `chapter: ${String(chapter).trim()}`, ...(prefix ? [`prefix: ${prefix}`] : []), '---',
    `# ${String(chapter).trim()}`, '',
    '<!-- Fill in every field. Under "Why the distractors are wrong", give a reason for each',
    '     wrong option and delete the line for the right one. Keep each question\'s number:',
    '     it becomes the question\'s id. Then: node scripts/build-bank.js --check this file. -->', '',
    '## Practice Questions', '', ...Array.from({ length: n }, (_, k) => questionBlock(k + 1))].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { file: path.basename(file), questions: n };
}

module.exports = { buildBank, signStudyFile, readStudyFile, digestOf, initBank, newStudyFile };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  /* The values the flags take are never the source folder. */
  const VALUED = ['--out', '--sign', '--init', '--id', '--by', '--new', '--chapter', '--prefix', '--questions', '--check'];
  const positional = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  const shown = p => { const r = path.relative(ROOT, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; };
  try {
    if (args.includes('--init')) {
      const dir = path.resolve(positional || path.join(ROOT, 'source', 'bank'));
      const b = initBank(dir, { name: opt('--init'), id: opt('--id'), by: opt('--by') });
      console.log(`wrote ${shown(path.join(dir, 'bank.json'))}: ${b.name} (id ${b.id})`);
      process.exit(0);
    }
    if (args.includes('--new')) {
      const file = opt('--new');
      if (!file) { console.error('usage: node scripts/build-bank.js --new <file.md> --chapter "…" [--prefix …] [--questions N]'); process.exit(2); }
      const r = newStudyFile(path.resolve(file), { chapter: opt('--chapter'), prefix: opt('--prefix'), questions: opt('--questions') });
      console.log(`wrote ${r.file}: ${r.questions} empty questions to fill in. Then: node scripts/build-bank.js --check ${file}`);
      process.exit(0);
    }
    if (args.includes('--check')) {
      const file = opt('--check');
      if (!file) { console.error('usage: node scripts/build-bank.js --check <study-file.md>'); process.exit(2); }
      const sf = readStudyFile(path.resolve(file));
      if (sf.problems.length) { console.log(`${sf.name}: ${sf.problems.length} problem(s)\n  ` + sf.problems.join('\n  ')); process.exit(1); }
      console.log(`${sf.name}: ${sf.questions.length} questions, ${sf.signed ? 'signed' : 'ready to read and sign (--sign)'}`);
      process.exit(0);
    }
    if (args.includes('--sign')) {
      const file = opt('--sign');
      if (!file) { console.error('usage: node scripts/build-bank.js --sign <study-file.md>'); process.exit(2); }
      const r = signStudyFile(path.resolve(file));
      console.log(`signed ${r.file}: ${r.questions} questions, sha256:${r.digest}. An edit to any of them needs signing again.`);
      process.exit(0);
    }
    const src = path.resolve(positional || path.join(ROOT, 'source', 'bank'));
    const out = path.resolve(opt('--out') || path.join(ROOT, 'build', 'bank'));
    const r = buildBank({ src, out, draft: args.includes('--draft') });
    r.warnings.forEach(w => console.log('  draft: ' + w));
    console.log(`built ${r.bank.name}: ${r.questions} questions from ${r.files} study file(s) → ${shown(out)}`);
    console.log(`next: npm run build -- ${shown(out)}`);
  } catch (e) {
    console.error('build-bank: ' + e.message);
    process.exit(1);
  }
}
