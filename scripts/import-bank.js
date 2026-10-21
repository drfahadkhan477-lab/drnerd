#!/usr/bin/env node
/*
 * A licensed question bank, imported: the third road to a bank of the app's
 * own (docs/OWN-BANK.md), for a bank you hold a licence to and have as a
 * spreadsheet or JSON export.
 *
 *   node scripts/import-bank.js <bank.csv|.tsv|.txt|.json> --name "Bank Name"
 *        [--by "Publisher"] [--id bank-id] [--figures <folder>]
 *        [--chapter "…"] [--out build/<id>]
 *   npm run build -- build/<id>          then the app is built from it
 *
 * THE FILE is one row (or JSON object) per question. Its columns are found by
 * name, in any order and case, spaces and punctuation ignored:
 *
 *   id            id, qid, question id, item id      required, and kept: the
 *                 app holds what it has learned about a question by its id
 *   chapter       chapter, category, section, topic, domain, subject
 *                 (or --chapter, for a file with no such column)
 *   stem          stem, question, question text, prompt, vignette
 *   options       A … H, option A …, choice A …     at least two, from A on
 *   answer        answer, correct, correct answer, key, answer key
 *                 a letter, or a number counting from 1
 *   commentary    explanation, rationale, commentary, critique, discussion
 *   reasons       why A …, reason A …                why that option is wrong
 *   peers         p A …, percent A …, pct A …         the share of candidates
 *                 who chose it, 0–100: every option of a question, or none
 *   figures       figures, figure, images, image     file names in the
 *                 figures folder (--figures; a "figures" folder beside the
 *                 file otherwise), split by ; | or ,
 *   number        n, item, item number, number       the number the app shows
 *                 beside the chapter; by its place in its chapter otherwise
 *
 * JSON is a list of objects with those keys (or { "questions": [ … ] }), and
 * may give options, peers and reasons as lists: "options": ["…", …] (or
 * objects with "t" and "p"), "percents": [ … ], "why": [ … ]. A bank already
 * in the content schema's shape (id, ch, s, o, ci, ex) is read as one.
 *
 * Text is read as UTF-8 (or UTF-16 with its byte-order mark, which is what a
 * spreadsheet's "Unicode text" export is); a CSV's separator is a comma, a
 * semicolon or a tab, whichever its header row uses. A field that holds HTML
 * (<p>, <br>, <b> …) is turned into the plain text the app shows: every tag
 * and comment goes, and &amp; and the like become their characters. The
 * report counts any <img> that went. A field with no HTML tag in it is text
 * and is left as it is, so "troponin <ULN" survives.
 *
 * WHAT IT REFUSES, naming the row and the id, never a word of a question:
 * a row with no id, an id used twice or one that cannot be a file name, no
 * chapter, no stem, fewer than two options or an empty one before a filled
 * one, an answer that is not one of its options, peers for some options and
 * not others or outside 0–100, a figure that is not in the folder or is not a
 * .webp, .png or .jpg; a file that is not UTF-8 or a CSV quote never closed;
 * two columns that give the same thing; ACCSAP 12's id as the bank's, since
 * that is the id ACCSAP's corrections are made for. It also refuses to read
 * from or write to the repository outside its private folders: a licensed
 * bank is read from source/ or content/ (or from outside the repository) and
 * written to build/, source/ or content/, which Git ignores and
 * scripts/leak-guard.js refuses.
 *
 * Columns no field takes are named in the report, so nothing is dropped
 * unseen. A licensed bank is shipped as its publisher wrote it: it is not
 * signed off question by question as a bank of your own is (build-bank.js),
 * and it gets none of ACCSAP's corrections (scripts/which-bank.js).
 *
 * THE BANK it writes is the content schema's (docs/CONTENT-SCHEMA.md):
 * manifest.json with the bank block and the source file's digest,
 * questions.json, and figures/. It is checked by src/core/bankpack.js, the
 * check the iPad runs, before anything is written, then written beside the
 * old bank and swapped in whole (scripts/bank-folder.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const { ACCSAP } = require('./which-bank.js');
const { writeBankFolder } = require('./bank-folder.js');

const LETTERS = 'ABCDEFGH';
const REASONS = 'Why the other options are wrong:';
const SAFE_ID = /^[A-Za-z0-9_.-]{1,120}$/;
const SAFE_FIG = /^[A-Za-z0-9_.-]{1,160}\.(webp|png|jpg)$/;

function bankPack() {
  const sandbox = {};
  new Function(fs.readFileSync(path.join(ROOT, 'src', 'core', 'bankpack.js'), 'utf8')).call(sandbox);
  return sandbox.BankPack;
}

/* ── reading the file ────────────────────────────────────────────────────── */

/* Bytes → text: UTF-8 with or without its byte-order mark, or UTF-16 with
   its mark; the decoder drops the mark. A file in an old code page is
   refused, not guessed at: its accents would turn into other letters with
   no sign. */
function decode(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (_) { throw new Error('the file is not UTF-8 text: save it as "CSV UTF-8" (or UTF-16 "Unicode text") and import that'); }
}

/* RFC 4180: fields split by sep, a field in double quotes may hold the
   separator, line breaks and "" for a quote. → rows of fields. */
function parseDelimited(text, sep) {
  const rows = [];
  let row = [], field = '', quoted = false, line = 1, opened = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; continue; }
      if (c === '\n') line++;
      field += c;
      continue;
    }
    if (c === '"' && field === '') { quoted = true; opened = line; continue; }
    if (c === sep) { row.push(field); field = ''; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; line++;
      continue;
    }
    field += c;
  }
  if (quoted) throw new Error(`line ${opened}: a quoted field is never closed`);
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(f => f.replace(/\r\n?/g, '\n')));
}

/* The separator a CSV's header row uses most, outside quotes. */
function separatorOf(text) {
  const head = text.slice(0, text.search(/\r?\n|$/));
  const count = ch => head.replace(/"[^"]*"/g, '').split(ch).length - 1;
  return [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
}

/* JSON.parse's own message can quote the text near the fault, which is the
   bank's text: only the position is kept. */
function parseJSON(text) {
  try { return JSON.parse(text); }
  catch (e) { const at = /position (\d+)/.exec(e.message); throw new Error(`the file is not JSON${at ? ` (at character ${at[1]})` : ''}`); }
}

/* A column's name as it is matched: "Option A", "option_a" and "OPTION-A"
   are one name. */
const key = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

/* field → the names that give it. Options, reasons and peers are per letter. */
const NAMES = {
  id: ['id', 'qid', 'questionid', 'itemid', 'uid'],
  ch: ['chapter', 'category', 'section', 'topic', 'domain', 'subject', 'ch'],
  s: ['stem', 'question', 'questiontext', 'prompt', 'vignette', 's'],
  n: ['n', 'item', 'itemnumber', 'number', 'questionnumber'],
  answer: ['answer', 'correct', 'correctanswer', 'key', 'answerkey', 'correctoption'],
  ci: ['ci'],
  ex: ['explanation', 'rationale', 'commentary', 'critique', 'discussion', 'ex'],
  figs: ['figures', 'figure', 'images', 'image', 'figs'],
  options: ['options', 'choices', 'o'],
  percents: ['percents', 'peers', 'percentages'],
  whys: ['why', 'reasons'],
};
for (let k = 0; k < LETTERS.length; k++) {
  const x = LETTERS[k].toLowerCase();
  NAMES['opt' + k] = [x, 'option' + x, 'choice' + x];
  NAMES['p' + k] = ['p' + x, 'percent' + x, 'pct' + x, 'peer' + x];
  NAMES['why' + k] = ['why' + x, 'reason' + x];
}
const FIELD_OF = new Map(Object.entries(NAMES).flatMap(([f, names]) => names.map(n => [n, f])));

/* The file as records: { where, get(field) → value } and the columns it has. */
function recordsOf(file, buf) {
  const ext = path.extname(file).toLowerCase();
  const text = decode(buf);
  if (ext === '.json') {
    const data = parseJSON(text);
    const items = Array.isArray(data) ? data : data && Array.isArray(data.questions) ? data.questions : null;
    if (!items) throw new Error('the JSON is not a list of questions (or an object whose "questions" is one)');
    const columns = new Map();
    const records = items.map((item, i) => {
      const fields = new Map();
      if (item && typeof item === 'object' && !Array.isArray(item))
        for (const [name, value] of Object.entries(item)) { columns.set(name, true); fields.set(name, value); }
      return { where: `item ${i + 1}`, fields, object: !!item && typeof item === 'object' && !Array.isArray(item) };
    });
    return { format: 'json', columns: [...columns.keys()], records };
  }
  if (!['.csv', '.tsv', '.txt'].includes(ext)) throw new Error(`a ${ext || 'nameless'} file is not one this reads: a .csv, .tsv (.txt) or .json file`);
  const sep = ext === '.csv' ? separatorOf(text) : '\t';
  const rows = parseDelimited(text, sep);
  if (!rows.length) throw new Error('the file is empty');
  const header = rows[0].map(h => h.trim());
  const records = [];
  rows.slice(1).forEach((cells, i) => {
    if (cells.every(c => !c.trim())) return;            // a blank row a spreadsheet leaves
    const fields = new Map();
    header.forEach((h, k) => { if (h) fields.set(h, cells[k] === undefined ? '' : cells[k]); });
    const extra = cells.slice(header.length).filter(c => c.trim()).length + header.filter((h, k) => !h && (cells[k] || '').trim()).length;
    records.push({ where: `row ${i + 2}`, fields, object: true, extra });
  });
  return { format: sep === '\t' ? 'tsv' : 'csv', columns: header.filter(Boolean), records };
}

/* ── turning a record into a question ────────────────────────────────────── */

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', deg: '°', plusmn: '±', micro: 'µ', times: '×', divide: '÷', le: '≤', ge: '≥', ne: '≠', asymp: '≈', middot: '·', bull: '•',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', kappa: 'κ', lambda: 'λ', mu: 'μ', sigma: 'σ', sup2: '²', sup3: '³',
  frac12: '½', frac14: '¼', frac34: '¾', rarr: '→', larr: '←', uarr: '↑', darr: '↓' };
/* A tag of the kind an export puts in its text marks a field as HTML. A field
   with none is plain text and is left as it is: "troponin <ULN and BNP >100"
   in it is words, not a tag. */
const TAG = /<\/?(?:p|br|b|i|u|em|strong|ul|ol|li|div|span|sup|sub|table|thead|tbody|tr|td|th|h[1-6]|a|font|blockquote|hr|img|figure|figcaption|pre|code|small|s|del|ins|mark|dl|dt|dd)\b[^<>]*>/i;
/* In a field that is HTML, "<" and a letter open a tag, as they do on the
   publisher's own page (a "<" in its words is written &lt; there), so every
   tag goes, known or not, and every comment, which ends at --> or --!>. */
const ANY_TAG = /<!--[\s\S]*?--!?>|<\/?[A-Za-z][^<>]*>/g;
const ENTITY_RE = /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,7});/gi;
/* The app escapes what it shows, so a bank's markup would be shown as
   markup: it is turned into the text it marks up. images counts the <img>
   tags that went, since an image does not come through a stem.
   → { text, changed, images } */
function plainOf(value) {
  let t = String(value).replace(/\r\n?/g, '\n'), changed = false, images = 0;
  if (TAG.test(t) || t.includes('<!--')) {
    changed = true;
    images = (t.match(/<img\b/gi) || []).length;
    t = t.replace(/<br\b[^<>]*>/gi, '\n').replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, '\n').replace(/<li\b[^<>]*>/gi, '- ');
    /* Taking one tag out can leave the ends of two side by side ("<<b>i>"),
       so until nothing more comes out. */
    for (let before = null; before !== t;) { before = t; t = t.replace(ANY_TAG, ''); }
    t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }
  t = t.replace(ENTITY_RE, (m, e) => {
    let to = m;
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); if (cp > 0 && cp <= 0x10FFFF) to = String.fromCodePoint(cp); }
    else if (Object.prototype.hasOwnProperty.call(ENTITY, e.toLowerCase())) to = ENTITY[e.toLowerCase()];
    if (to !== m) changed = true;
    return to;
  });
  return { text: t.trim(), changed, images };
}

/* importBank({ input, name, by, id, figures, chapter, out, root })
   → { bank, questions, figures, chapters, unread, noCommentary, plained, images, out, format }
   Throws, listing every problem by row and id, and writes nothing. */
function importBank(opts) {
  const root = opts.root || ROOT;
  const problems = [];
  const input = path.resolve(opts.input || '');
  if (!opts.input || !fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error(`no file to import at ${opts.input || '(none given)'}`);

  /* Which bank: the name the app shows, an id from it, whose commentary. */
  const name = String(opts.name || '').trim();
  if (!name) throw new Error('say what the bank is called: --name "Bank Name"');
  const bank = { id: String(opts.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40), name };
  if (opts.by && String(opts.by).trim()) bank.by = String(opts.by).trim();
  if (bank.id === ACCSAP.id) throw new Error(`${ACCSAP.id} is ACCSAP 12's id, which ACCSAP's corrections are made for; give this bank its own (--id)`);
  /* Held now to the rules the app holds a manifest's bank block to, so a
     name it would refuse stops the import before the file is read. */
  const block = bankPack().validate([
    { name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify({ schemaVersion: bankPack().SCHEMA, bank })) },
    { name: 'questions.json', bytes: new TextEncoder().encode('[{"id":"q_1","ch":"c","o":["a","b"],"ci":0}]') }]);
  if (!block.ok) throw new Error('the app would refuse this bank\'s name: ' + block.problems.join('; ') + ' (--name ≤ 60 and --by ≤ 30 characters, no < > & " `)');
  const out = path.resolve(opts.out || path.join(root, 'build', bank.id));
  const figDir = path.resolve(opts.figures || path.join(path.dirname(input), 'figures'));
  /* The bank's folder is replaced whole: the file cannot be in it. */
  const within = (dir, p) => { const r = path.relative(dir, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
  if (within(out, input)) throw new Error(`the file is inside ${out}, the folder the bank is written to, which is replaced whole: move it, or give --out another folder`);

  /* Licensed text stays where Git cannot take it. */
  const where = privateWhere(root);
  const refusedAt = [where(input, ['source', 'content'], 'the file'), opts.figures ? where(figDir, ['source', 'content'], 'the figures folder') : '',
    where(out, ['build', 'source', 'content'], 'the bank')].filter(Boolean);
  if (refusedAt.length) throw new Error(refusedAt.join('\n'));

  const bytes = fs.readFileSync(input);
  const { format, columns, records } = recordsOf(input, bytes);

  /* Which column gives which field, and none given twice. */
  const byField = new Map(), unread = [];
  for (const c of columns) {
    const f = FIELD_OF.get(key(c));
    if (!f) { unread.push(c); continue; }
    if (byField.has(f)) problems.push(`the columns "${byField.get(f)}" and "${c}" give the same thing`);
    else byField.set(f, c);
  }
  if (!byField.has('id')) problems.push('no id column (id, qid, question id …): the app keeps what it has learned about a question by its id, so each needs one that stays the same from one import to the next');
  if (!byField.has('s')) problems.push('no stem column (stem, question, question text …)');
  if (!byField.has('ch') && !opts.chapter) problems.push('no chapter column (chapter, category, section …): add one, or give every question one with --chapter "…"');
  if (byField.has('ch') && opts.chapter) problems.push('the file has a chapter column; --chapter is for a file without one');
  if (byField.has('answer') && byField.has('ci')) problems.push('both an answer column and a ci column: keep one');
  if (!byField.has('answer') && !byField.has('ci')) problems.push('no answer column (answer, correct answer, key …)');
  if (byField.has('options') && byField.has('opt0')) problems.push('both an options list and option columns: keep one');
  if (problems.length) throw refusal(problems);

  const questions = [], seen = new Map(), figFiles = new Map();
  let noCommentary = 0, plained = 0, images = 0;
  const clean = v => { const p = plainOf(v); if (p.changed) plained++; images += p.images; return p.text; };
  /* A field's text, '' when the record has none, or { bad } when it is not
     text at all (a list or an object in JSON). */
  const text = (rec, f) => {
    const col = byField.get(f);
    if (!col) return '';
    const v = rec.fields.get(col);
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string' && typeof v !== 'number') return { bad: true };
    return clean(v);
  };
  const inChapter = new Map();
  for (const rec of records) {
    const at = rec.where;
    if (!rec.object) { problems.push(`${at}: not an object`); continue; }
    if (rec.extra) { problems.push(`${at}: ${rec.extra} cell(s) with no column heading`); continue; }
    const id = text(rec, 'id');
    const tag = typeof id === 'string' && id ? `${at} (id ${SAFE_ID.test(id) ? id : '?'})` : at;
    const bad = f => { problems.push(`${tag}: its ${f} is not text`); };
    if (typeof id !== 'string') { bad('id'); continue; }
    if (!id) { problems.push(`${at}: no id`); continue; }
    if (!SAFE_ID.test(id) || id.includes('..')) { problems.push(`${at}: its id is not letters, digits, _ . - (an id becomes a file name)`); continue; }
    if (seen.has(id)) { problems.push(`${tag}: the id is given by ${seen.get(id)} too`); continue; }
    seen.set(id, at);

    const ch = opts.chapter ? String(opts.chapter).trim() : text(rec, 'ch');
    const s = text(rec, 's'), ex = text(rec, 'ex');
    if (typeof ch !== 'string') { bad('chapter'); continue; }
    if (typeof s !== 'string') { bad('stem'); continue; }
    if (typeof ex !== 'string') { bad('commentary'); continue; }
    if (!ch) problems.push(`${tag}: no chapter`);
    if (!s) problems.push(`${tag}: no stem`);

    /* The options with what goes with each: its share of candidates, and the
       reason it is wrong. */
    const choice = optionsOf(rec, byField, text, clean, tag, problems);
    if (!choice) continue;
    const { texts, ps, whys } = choice;

    let ci = -1;
    if (byField.has('ci')) {
      const v = rec.fields.get(byField.get('ci'));
      const k = typeof v === 'number' ? v : /^\s*\d+\s*$/.test(String(v || '')) ? +v : NaN;
      if (Number.isInteger(k) && k >= 0 && k < texts.length) ci = k;
    } else {
      const a = text(rec, 'answer');
      const m = typeof a === 'string' ? /^\(?([A-Ha-h]|\d{1,2})[).:]?$/.exec(a.trim()) : null;
      if (m) ci = /\d/.test(m[1]) ? +m[1] - 1 : m[1].toUpperCase().charCodeAt(0) - 65;
      if (!(ci >= 0 && ci < texts.length)) ci = -1;
    }
    if (ci < 0) problems.push(`${tag}: its answer is not one of its ${texts.length} options (a letter, or a number from 1)`);

    const given = ps.filter(p => p !== '').length;
    let pcts = null;
    if (given && given < texts.length) problems.push(`${tag}: peers for ${given} of its ${texts.length} options; give every option's, or none`);
    else if (given) {
      pcts = ps.map(p => (typeof p === 'number' ? p : parseFloat(String(p).trim().replace(/%$/, ''))));
      const off = pcts.map((p, k) => (Number.isFinite(p) && p >= 0 && p <= 100 && /^\s*\d+(\.\d+)?\s*%?\s*$/.test(String(ps[k])) ? '' : LETTERS[k])).filter(Boolean);
      if (off.length) { problems.push(`${tag}: the peers for ${off.join(', ')} are not numbers from 0 to 100`); pcts = null; }
    }

    let n = 0;
    if (byField.has('n')) {
      const v = text(rec, 'n');
      n = typeof v === 'string' && /^\d{1,5}$/.test(v) && +v > 0 ? +v : 0;
      if (!n) problems.push(`${tag}: its number is not a whole number from 1`);
    } else if (typeof ch === 'string') n = (inChapter.get(ch) || 0) + 1;
    if (typeof ch === 'string') inChapter.set(ch, Math.max(inChapter.get(ch) || 0, n));

    const figs = figuresOf(rec, byField, tag, problems, figDir, figFiles);

    if (!ex) noCommentary++;
    /* The reasons follow the commentary, as build-bank.js writes them, unless
       it carries them already (a bank this repository built, read back). */
    const reasons = texts.map((_, k) => k).filter(k => k !== ci && whys[k]).map(k => `${LETTERS[k]}) ${whys[k]}`);
    const withReasons = reasons.length && !ex.includes(REASONS) ? (ex ? ex + '\n\n' : '') + REASONS + '\n' + reasons.join('\n') : ex;
    const q = {
      id, ch, n, s,
      o: texts.map((t, k) => (pcts ? { l: LETTERS[k], t, p: pcts[k] } : { l: LETTERS[k], t })),
      ci, ex: withReasons,
      img: figs.length, figs,
    };
    if (reasons.length) q.why = texts.map((_, k) => (k === ci ? '' : whys[k] || ''));
    questions.push(q);
  }
  if (!records.length) problems.push('no questions in the file');
  if (problems.length) throw refusal(problems);

  const manifest = {
    schemaVersion: bankPack().SCHEMA, bank,
    questions: questions.length, figures: figFiles.size,
    chapters: [...new Set(questions.map(q => q.ch))].sort(),
    source: { file: path.basename(input), format, sha256: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16) },
  };
  const files = [
    { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: 'questions.json', bytes: Buffer.from(JSON.stringify(questions)) },
    ...[...figFiles].map(([f, p]) => ({ name: 'figures/' + f, bytes: fs.readFileSync(p) })),
  ];
  const verdict = bankPack().validate(files.map(f => ({ name: f.name, bytes: new Uint8Array(f.bytes) })));
  if (!verdict.ok) throw new Error(`no bank was written: the iPad would refuse it (${verdict.problemCount} problem(s)):\n  ` + verdict.problems.slice(0, 20).join('\n  '));
  writeBankFolder(out, files);
  return { bank, questions: questions.length, figures: figFiles.size, chapters: manifest.chapters.length, unread, noCommentary, plained, images, out, format };
}

const refusal = problems => new Error(`no bank was written (${problems.length} problem(s)):\n  ` + problems.slice(0, 30).join('\n  ') +
  (problems.length > 30 ? `\n  … and ${problems.length - 30} more` : ''));

/* A record's options, peers and reasons, by letter column or by list. */
function optionsOf(rec, byField, text, clean, tag, problems) {
  let texts = [], ps = [], whys = [];
  if (byField.has('options')) {
    const list = rec.fields.get(byField.get('options'));
    if (!Array.isArray(list)) { problems.push(`${tag}: its options are not a list`); return null; }
    const listOf = f => { const v = byField.has(f) ? rec.fields.get(byField.get(f)) : undefined; return Array.isArray(v) ? v : null; };
    const pl = listOf('percents'), wl = listOf('whys');
    for (let k = 0; k < list.length; k++) {
      const o = list[k];
      const t = typeof o === 'string' || typeof o === 'number' ? o : o && typeof o === 'object' ? (o.t !== undefined ? o.t : o.text) : undefined;
      if (typeof t !== 'string' && typeof t !== 'number') { problems.push(`${tag}: option ${LETTERS[k] || k + 1} is not text`); return null; }
      texts.push(clean(t));
      const p = o && typeof o === 'object' ? (o.p !== undefined ? o.p : o.percent) : pl ? pl[k] : undefined;
      ps.push(p === undefined || p === null || p === '' ? '' : p);
      const w = wl ? wl[k] : undefined;
      whys.push(typeof w === 'string' ? clean(w) : '');
    }
  } else {
    for (let k = 0; k < LETTERS.length; k++) {
      const t = text(rec, 'opt' + k), p = text(rec, 'p' + k), w = text(rec, 'why' + k);
      if ([t, p, w].some(v => typeof v !== 'string')) { problems.push(`${tag}: option ${LETTERS[k]} is not text`); return null; }
      texts.push(t); ps.push(p); whys.push(w);
    }
    let last = texts.length - 1;
    while (last >= 0 && !texts[last]) last--;
    texts = texts.slice(0, last + 1); ps = ps.slice(0, last + 1); whys = whys.slice(0, last + 1);
  }
  if (texts.length > LETTERS.length) { problems.push(`${tag}: more than ${LETTERS.length} options`); return null; }
  const gap = texts.findIndex(t => !t);
  if (gap >= 0) { problems.push(`${tag}: option ${LETTERS[gap]} is empty, and a later one is not`); return null; }
  if (texts.length < 2) { problems.push(`${tag}: fewer than two options`); return null; }
  return { texts, ps, whys };
}

/* A record's figures: file names in the figures folder, each safe to be a
   file name in the bank and there to be copied. */
function figuresOf(rec, byField, tag, problems, figDir, figFiles) {
  if (!byField.has('figs')) return [];
  const v = rec.fields.get(byField.get('figs'));
  const names = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[;|,\n]/) : v == null ? [] : null;
  if (!names) { problems.push(`${tag}: its figures are not a list of file names`); return []; }
  const figs = [];
  for (const raw of names) {
    const f = String(raw).trim();
    if (!f || figs.includes(f)) continue;
    if (/[\\/]/.test(f) || !SAFE_FIG.test(f) || f.includes('..')) { problems.push(`${tag}: figure ${JSON.stringify(f.slice(0, 80))} is not a .webp, .png or .jpg file name of letters, digits, _ . - (no folder)`); continue; }
    const p = path.join(figDir, f);
    if (!fs.existsSync(p)) { problems.push(`${tag}: figure ${f} is not in ${figDir}`); continue; }
    figFiles.set(f, p);
    figs.push(f);
  }
  return figs;
}

/* where(p, allowed, what) → '' when p is outside the repository or under one
   of its allowed folders, else why not. Links are followed, so a link inside
   the repository to a folder outside is outside, and the other way round. */
function privateWhere(root) {
  const real = p => {
    let at = p, rest = [];
    while (!fs.existsSync(at) && path.dirname(at) !== at) { rest.unshift(path.basename(at)); at = path.dirname(at); }
    return path.join(fs.realpathSync(at), ...rest);
  };
  const repo = real(root);
  return (p, allowed, what) => {
    const rel = path.relative(repo, real(p));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return '';
    const top = rel.split(path.sep)[0];
    if (allowed.includes(top)) return '';
    return `${what} is in the repository at ${rel.split(path.sep).join('/') || '.'}, outside ${allowed.map(a => a + '/').join(', ')}: a licensed bank is ${what === 'the bank' ? 'written' : 'read'} only where Git ignores it and leak-guard refuses it`;
  };
}

module.exports = { importBank, parseDelimited, plainOf, decode };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const VALUED = ['--name', '--by', '--id', '--figures', '--chapter', '--out'];
  const input = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  const shown = p => { const r = path.relative(ROOT, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; };
  if (!input || args.includes('--help')) {
    console.error('usage: node scripts/import-bank.js <bank.csv|.tsv|.json> --name "Bank Name" [--by "Publisher"] [--id bank-id] [--figures <folder>] [--chapter "…"] [--out build/<id>]');
    process.exit(2);
  }
  try {
    const r = importBank({ input, name: opt('--name'), by: opt('--by'), id: opt('--id'), figures: opt('--figures'), chapter: opt('--chapter'), out: opt('--out') });
    console.log(`imported ${r.bank.name} (id ${r.bank.id}${r.bank.by ? ', by ' + r.bank.by : ''}): ${r.questions} questions in ${r.chapters} chapter(s), ${r.figures} figure(s), from ${r.format.toUpperCase()} → ${shown(r.out)}`);
    if (r.unread.length) console.log(`  not read: ${r.unread.map(c => JSON.stringify(c)).join(', ')} (no field of the bank takes them)`);
    if (r.noCommentary) console.log(`  ${r.noCommentary} question(s) have no commentary`);
    if (r.plained) console.log(`  ${r.plained} field(s) held markup or entities, turned into plain text`);
    if (r.images) console.log(`  ${r.images} <img> tag(s) in the text were dropped: an image comes through a figures column, not a stem`);
    console.log(`next: npm run build -- ${shown(r.out)}`);
  } catch (e) {
    console.error('import-bank: ' + e.message);
    process.exit(1);
  }
}
