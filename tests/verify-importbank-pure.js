#!/usr/bin/env node
/*
 * A licensed bank, as its publisher exports it, becomes a bank the app runs
 * on, and a file that cannot be read as one is refused without a word of it.
 *
 *   node tests/verify-importbank-pure.js
 *
 * Pure Node. scripts/import-bank.js reads a CSV, TSV or JSON export, one
 * question a row, and writes a bank in the content schema, which npm run build
 * turns into the app. This holds:
 *
 *   - each row becomes a question with its id, chapter, stem, options, key,
 *     commentary, the reasons wrong options are wrong, its peer statistics and
 *     its figures, copied byte for byte; numbered by its place in its chapter
 *     when the file gives no number; in the bank --name and --by name; the
 *     manifest records the file and its digest; a column no field takes is
 *     named in the report, as are questions with no commentary;
 *   - the app builds from it as that bank, its commentary the publisher's,
 *     with no ACCSAP correction or flag, and it packs for the iPad;
 *   - a CSV as spreadsheets write it: quoted commas, quotes and line breaks, a
 *     byte-order mark, CRLF, semicolons, blank rows; a TSV, and UTF-16 as a
 *     spreadsheet's "Unicode text"; a field that holds HTML turned into the
 *     text it marks up, every tag and comment gone, even one that only
 *     appears when another is taken out, and the <img> tags counted; a field
 *     that holds none left as it is, "<ULN" and a comparison with it; a file
 *     in an old code page, or with a quote never closed, refused;
 *   - JSON with lists for options, peers and reasons imports as the CSV does,
 *     and a bank already in the schema's shape is read back unchanged;
 *   - every refusal names the row and the id, never a word of a question, nor
 *     passes on JSON.parse's own message, which quotes the text;
 *   - a licensed file is read only from outside the repository or from its
 *     source/ or content/, and a bank written only outside it or to build/,
 *     source/ or content/, links followed;
 *   - a refused import leaves the last bank as it was, a folder holding
 *     anything but a bank is never replaced, nor one the file is in.
 *
 * Every question here is invented placeholder text.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const I = require(path.join(ROOT, 'scripts', 'import-bank.js'));
const A = require(path.join(ROOT, 'scripts', 'assemble-app.js'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'importbank-'));
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const attempt = fn => { try { return { r: fn(), why: '' }; } catch (e) { return { r: null, why: e.message }; } };

/* A spreadsheet's CSV: quoted where it must be, a byte-order mark, CRLF. */
const cell = v => (/[",;\t\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const csv = (rows, sep = ',') => '﻿' + rows.map(r => r.map(cell).join(sep)).join('\r\n') + '\r\n';
const HEAD = ['Question ID', 'Category', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Explanation',
  'Why A', 'Why B', 'Why C', 'Why D', 'Percent A', 'Percent B', 'Percent C', 'Percent D', 'Images', 'Notes'];
const ROWS = [
  ['V-1', 'Invented Valves', 'Invented stem one, with a comma\nand a second line?', 'Invented one', 'Invented "two"', 'Invented three', 'Invented four', 'B',
   '<p>Invented <b>reason</b> &ge; 2</p>', 'Invented why A', '', 'Invented why C', 'Invented why D', '10', '70%', '15', '5', 'ecg-1.png; ecg-2.jpg', 'a note'],
  ['R-1', 'Invented Rhythm', 'Invented stem two?', 'Invented one b', 'Invented two b', 'Invented three b', '', '1', 'Invented commentary two.',
   '', '', '', '', '', '', '', '', '', ''],
  ['V-2', 'Invented Valves', 'Invented stem three?', 'Invented one c', 'Invented two c', 'Invented three c', 'Invented four c', 'd', '',
   '', '', '', '', '', '', '', '', 'ecg-1.png', ''],
  HEAD.map(() => ''),
];
/* What the three rows must become. */
const WANT = [
  { id: 'V-1', ch: 'Invented Valves', n: 1, s: 'Invented stem one, with a comma\nand a second line?',
    o: [{ l: 'A', t: 'Invented one', p: 10 }, { l: 'B', t: 'Invented "two"', p: 70 }, { l: 'C', t: 'Invented three', p: 15 }, { l: 'D', t: 'Invented four', p: 5 }],
    ci: 1, ex: 'Invented reason ≥ 2\n\nWhy the other options are wrong:\nA) Invented why A\nC) Invented why C\nD) Invented why D',
    img: 2, figs: ['ecg-1.png', 'ecg-2.jpg'], why: ['Invented why A', '', 'Invented why C', 'Invented why D'] },
  { id: 'R-1', ch: 'Invented Rhythm', n: 1, s: 'Invented stem two?', o: [{ l: 'A', t: 'Invented one b' }, { l: 'B', t: 'Invented two b' }, { l: 'C', t: 'Invented three b' }],
    ci: 0, ex: 'Invented commentary two.', img: 0, figs: [] },
  { id: 'V-2', ch: 'Invented Valves', n: 2, s: 'Invented stem three?',
    o: [{ l: 'A', t: 'Invented one c' }, { l: 'B', t: 'Invented two c' }, { l: 'C', t: 'Invented three c' }, { l: 'D', t: 'Invented four c' }],
    ci: 3, ex: '', img: 1, figs: ['ecg-1.png'] },
];
/* Key order aside: the bank's JSON as a comparable string. */
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(y => [y, x[y]])) : x));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('invented png bytes')]);
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('invented jpg bytes')]);

let n = 0;
/* A folder holding the file and, beside it, figures/. → the file's path. */
const exportOf = (name, content, figs = { 'ecg-1.png': PNG, 'ecg-2.jpg': JPG, 'unused.png': PNG }) => {
  const at = path.join(dir, 'export-' + (++n));
  fs.mkdirSync(path.join(at, 'figures'), { recursive: true });
  for (const [f, b] of Object.entries(figs)) fs.writeFileSync(path.join(at, 'figures', f), b);
  fs.writeFileSync(path.join(at, name), content);
  return path.join(at, name);
};
const NAME = { name: 'Invented Licensed Bank', by: 'Invented Press' };
const imp = (input, o = {}) => attempt(() => I.importBank({ input, ...NAME, out: path.join(dir, 'out-' + (++n)), ...o }));
const bankAt = r => (r ? readJSON(path.join(r.out, 'questions.json')) : []);

(async () => {
head('a CSV becomes a bank the app builds from');
const main = exportOf('bank.csv', csv([HEAD, ...ROWS]));
const m = imp(main);
const qs = bankAt(m.r);
const man = m.r ? readJSON(path.join(m.r.out, 'manifest.json')) : {};
ok('it imports every row with a question in it, and passes over the blank one', !!m.r && m.r.questions === 3 && qs.length === 3 && man.questions === 3, m.why.split('\n').slice(0, 3).join(' | '));
ok('in the bank --name and --by name, its id made from the name',
   JSON.stringify(man.bank) === JSON.stringify({ id: 'invented-licensed-bank', name: 'Invented Licensed Bank', by: 'Invented Press' }), JSON.stringify(man.bank));
const field = (k, f) => canon(qs[k] && qs[k][f]) === canon(WANT[k][f]);
ok('each row a question: its id, chapter, stem with its line break, options and key, a letter in either case or a number from 1',
   qs.length === 3 && [0, 1, 2].every(k => ['id', 'ch', 's', 'ci'].every(f => field(k, f)) && canon(qs[k].o.map(o => o.l + o.t)) === canon(WANT[k].o.map(o => o.l + o.t))),
   qs.map(q => `${q.id}:${q.ci}`).join(' '));
ok('options run to the last one filled: three where D is empty', qs.length === 3 && qs[1].o.length === 3, qs[1] ? `${qs[1].o.length}` : '');
ok('the commentary as text, then why each wrong option is wrong, under its letter', qs.length === 3 && field(0, 'ex') && field(0, 'why') && field(1, 'ex') && !('why' in qs[1]),
   qs[0] ? JSON.stringify(qs[0].ex).slice(0, 120) : '');
ok('peer statistics kept, each option\'s share as a number, "70%" too', qs.length === 3 && canon(qs[0].o.map(o => o.p)) === '[10,70,15,5]', qs[0] ? JSON.stringify(qs[0].o.map(o => o.p)) : '');
ok('and a question with none has none', qs.length === 3 && qs[1].o.every(o => !('p' in o)) && qs[2].o.every(o => !('p' in o)));
ok('numbered by its place in its chapter when the file gives no number', qs.map(q => q.n).join() === '1,1,2', qs.map(q => q.n).join());
const figBytes = f => { try { return fs.readFileSync(path.join(m.r.out, 'figures', f)); } catch (_) { return null; } };
ok('its figures named, counted, and copied byte for byte; a figure no question names is not',
   qs.length === 3 && field(0, 'figs') && field(0, 'img') && field(2, 'figs') && field(2, 'img') && man.figures === 2 &&
   !!figBytes('ecg-1.png') && figBytes('ecg-1.png').equals(PNG) && !!figBytes('ecg-2.jpg') && figBytes('ecg-2.jpg').equals(JPG) && !figBytes('unused.png'),
   m.r ? fs.readdirSync(path.join(m.r.out, 'figures')).join(',') : '');
ok('every question exactly as it should be', canon(qs) === canon(WANT), qs.length ? '' : 'none');
ok('the manifest records the file, its format and its digest',
   canon(man.source) === canon({ file: 'bank.csv', format: 'csv', sha256: crypto.createHash('sha256').update(fs.readFileSync(main)).digest('hex').slice(0, 16) }), JSON.stringify(man.source));
ok('the report names the column no field takes, and counts what it should say',
   !!m.r && JSON.stringify(m.r.unread) === '["Notes"]' && m.r.noCommentary === 1 && m.r.plained === 1, m.r ? `${JSON.stringify(m.r.unread)} ${m.r.noCommentary} ${m.r.plained}` : '');
{
  let app = null;
  try { app = m.r ? A.producers({ bank: await A.readBank(m.r.out) }) : null; } catch (e) { ok('the app reads it', false, e.message.split('\n')[0]); }
  ok('the app builds from it as that bank, its commentary the publisher\'s', !!app && app('payload', 'BANK') === JSON.stringify({ id: 'invented-licensed-bank', name: 'Invented Licensed Bank', by: 'Invented Press' }),
     app ? app('payload', 'BANK') : 'no app');
  /* ACCSAP's corrections, applied to a bank they were not made for, throw:
     that is a failure of this check, not of the suite. */
  let all = [], allWhy = '';
  try { all = app ? JSON.parse(app('payload', 'ALL_Q')) : []; } catch (e) { allWhy = e.message.split('\n')[0]; }
  ok('with every question as the file gave it: no ACCSAP correction or flag',
     all.length === 3 && all.every((x, k) => x.ci === WANT[k].ci && x.ex === WANT[k].ex && !x.flag && !x.bad && canon(x.o) === canon(WANT[k].o)), allWhy || `${all.length} questions`);
  let read = null;
  try {
    const zip = path.join(dir, 'licensed.zip');
    require(path.join(ROOT, 'tools', 'pack-content.js')).pack(m.r.out, zip);
    read = await A.readBank(zip);
  } catch (e) { read = { error: e.message.split('\n')[0] }; }
  ok('and it packs for the iPad, its name and figures with it', !!read && !read.error && read.questions.length === 3 &&
     JSON.stringify(read.manifest.bank) === JSON.stringify(man.bank) && !!read.figures.get('ecg-2.jpg') && read.figures.get('ecg-2.jpg').bytes.equals(JPG),
     read && read.error ? read.error : '');
}

head('the CSV as spreadsheets write it');
{
  const rows = attempt(() => I.parseDelimited('a,"b,c","d ""e""","f\r\ng"\r\nh,i,,j', ','));
  ok('a quoted field keeps its separators, its quotes and its line breaks; an empty field is empty',
     JSON.stringify(rows.r) === JSON.stringify([['a', 'b,c', 'd "e"', 'f\ng'], ['h', 'i', '', 'j']]), rows.why || JSON.stringify(rows.r));
  const bom = attempt(() => I.decode(Buffer.from('﻿id,stem\r\n', 'utf8')));
  ok('a byte-order mark is not part of the first heading', bom.r === 'id,stem\r\n', bom.why || JSON.stringify(bom.r));
  const semi = imp(exportOf('bank.csv', csv([HEAD, ...ROWS], ';')));
  ok('a CSV whose header is split by semicolons is read by them', canon(bankAt(semi.r)) === canon(WANT), semi.why.split('\n')[1] || '');
  const tsvText = [HEAD, ...ROWS].map(r => r.map(c => c.replace(/\n/g, ' ')).join('\t')).join('\r\n');
  const tsv = imp(exportOf('bank.tsv', tsvText));
  ok('a TSV', !!tsv.r && bankAt(tsv.r).length === 3 && bankAt(tsv.r)[0].s === 'Invented stem one, with a comma and a second line?', tsv.why.split('\n')[1] || '');
  const utf16 = imp(exportOf('bank.txt', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(tsvText, 'utf16le')])));
  ok('and UTF-16 tab-separated text, as a spreadsheet saves "Unicode text"', !!utf16.r && canon(bankAt(utf16.r)) === canon(bankAt(tsv.r)), utf16.why.split('\n')[0]);
  const cp1252 = imp(exportOf('bank.csv', Buffer.concat([Buffer.from(csv([HEAD, ...ROWS.slice(0, 1)]).slice(1), 'latin1'), Buffer.from([0xE9, 0x0D, 0x0A])])));
  ok('a file in an old code page is refused, not guessed at', !cp1252.r && /not UTF-8 text/.test(cp1252.why), cp1252.why || 'imported');
  const open = imp(exportOf('bank.csv', 'id,chapter,stem,a,b,answer\r\nq1,c,"Invented stem never closed,x,y,A\r\n'));
  ok('a quoted field never closed is refused, by the line it opens on', !open.r && /line 2: a quoted field is never closed/.test(open.why), open.why || 'imported');
  const p1 = I.plainOf('<p>Invented <b>reason</b> &ge; 2 &amp; &#8805; 3</p><ul><li>one</li><li>two</li></ul>BP <90 and >60');
  ok('markup becomes the text it marks up, entities their letters', p1.text === 'Invented reason ≥ 2 & ≥ 3\n- one\n- two\nBP <90 and >60' && p1.changed, JSON.stringify(p1));
  const p2 = I.plainOf('Invented: BP <90 and >60, AT&T; x < y');
  ok('and text with no markup is left as it is', p2.text === 'Invented: BP <90 and >60, AT&T; x < y' && !p2.changed, JSON.stringify(p2));
  const p3 = I.plainOf('troponin <ULN and BNP >100');
  ok('a letter after "<" in a field that holds no HTML is words, not a tag', p3.text === 'troponin <ULN and BNP >100' && !p3.changed, JSON.stringify(p3));
  /* A tag made by taking another out: nothing of it may be left to read as one. */
  const NESTED = ['Invented <<b>iframe src=x>after', 'Invented <<b>i>mg src=x onerror=y>after', 'Invented <<i><b>script>x</script>after'];
  const p4 = NESTED.map(t => I.plainOf(t));
  ok('in a field that holds HTML every tag goes, even one that only appears when another is taken out',
     p4.every(p => !/<[A-Za-z\/!]/.test(p.text)) && p4[0].text === 'Invented after', p4.map(p => JSON.stringify(p.text)).join(' '));
  /* No tag outside the comments, so only they can mark the field as HTML. */
  const p5 = I.plainOf('a<!-- one -->b<!-- two --!>c');
  ok('and every comment, whether it ends with --> or --!>, with no other tag in the field', p5.text === 'abc' && p5.changed, JSON.stringify(p5));
  const p6 = I.plainOf('<p>Invented <abbr title="x">EF</abbr> and <x-widget a="1">y</x-widget></p>');
  ok('a tag of a kind it has not heard of goes with the rest', p6.text === 'Invented EF and y', JSON.stringify(p6));
  /* Each of these, alone in a field, is enough to make it HTML: no other tag
     is there to do it. */
  const MARKERS = 'p br b i u em strong ul ol li div span sup sub table thead tbody tr td th h1 h2 h3 h4 h5 h6 a font blockquote hr img figure figcaption pre code small s del ins mark dl dt dd'.split(' ');
  const unmarked = MARKERS.filter(tag => { const r = I.plainOf(`x <${tag}>y</${tag}> z`); return !r.changed || /<\/?[A-Za-z]/.test(r.text); });
  ok('any one of the common HTML tags is enough to make a field HTML', unmarked.length === 0, unmarked.join(' ') || `${MARKERS.length} tags`);
  const p7 = I.plainOf('<p>See <img src="a.png"> and <IMG src=b.png></p>');
  ok('<img> tags are counted as they go, in either case', p7.images === 2 && !/img/i.test(p7.text) && I.plainOf('no tags here').images === 0, JSON.stringify(p7));
}

head('an image in the text');
{
  const IMG_ROWS = [HEAD, ['I-1', 'Invented Imaging', 'Invented stem <p>with <img src="ecg-1.png"> inside</p>', 'one', 'two', '', '', 'A', 'Invented commentary', '', '', '', '', '', '', '', '', '', '']];
  const withImg = imp(exportOf('bank.csv', csv(IMG_ROWS)));
  const q = bankAt(withImg.r)[0] || {};
  ok('an <img> in a stem is dropped from it, and the report counts it', !!withImg.r && withImg.r.images === 1 && q.s === 'Invented stem with  inside' && q.img === 0,
     withImg.why.split('\n')[1] || JSON.stringify(q.s));
  ok('and a file with none reports none', !!m.r && m.r.images === 0, m.r ? String(m.r.images) : m.why.split('\n')[1]);
}

head('JSON');
{
  const list = [
    { id: 'V-1', chapter: 'Invented Valves', stem: ROWS[0][2], options: ROWS[0].slice(3, 7), answer: 'B', explanation: ROWS[0][8],
      why: ROWS[0].slice(9, 13), percents: [10, '70%', 15, 5], figures: ['ecg-1.png', 'ecg-2.jpg'], notes: 'a note' },
    { id: 'R-1', chapter: 'Invented Rhythm', stem: ROWS[1][2], options: ROWS[1].slice(3, 6), answer: 1, explanation: ROWS[1][8] },
    { id: 'V-2', chapter: 'Invented Valves', stem: ROWS[2][2], options: ROWS[2].slice(3, 7), answer: 'd', figures: 'ecg-1.png' },
  ];
  const j = imp(exportOf('bank.json', JSON.stringify(list)));
  ok('a JSON list with options, peers and reasons as lists imports as the CSV does', canon(bankAt(j.r)) === canon(WANT), j.why.split('\n').slice(0, 2).join(' | '));
  const wrapped = imp(exportOf('bank.json', JSON.stringify({ questions: list })));
  ok('and so does one under "questions"', canon(bankAt(wrapped.r)) === canon(WANT), wrapped.why.split('\n')[1] || '');
  /* The bank the CSV became, read back as an export: the content schema's
     own shape, its figures beside it. */
  const schema = m.r ? exportOf('schema.json', fs.readFileSync(path.join(m.r.out, 'questions.json')), { 'ecg-1.png': PNG, 'ecg-2.jpg': JPG }) : null;
  const again = schema ? imp(schema) : { r: null, why: 'no bank to read back' };
  ok('a bank already in the schema\'s shape is read as one, unchanged, its reasons not given twice', canon(bankAt(again.r)) === canon(WANT),
     again.why.split('\n').slice(0, 2).join(' | ') || JSON.stringify((bankAt(again.r)[0] || {}).ex).slice(0, 100));
}

head('refused, by row and id, never by a word of a question');
const refusals = [];
const refused = (label, file, re, o) => {
  const r = imp(file, o);
  refusals.push(r.why);
  ok(label, !r.r && re.test(r.why), (r.why.split('\n').find(l => re.test(l)) || r.why.split('\n').slice(0, 2).join(' ') || 'imported').trim().slice(0, 160));
};
{
  const withRows = (...rows) => exportOf('bank.csv', csv([HEAD, ...rows]));
  const row = (k, at, v) => { const r = ROWS[k].slice(); r[HEAD.indexOf(at)] = v; return r; };
  refused('no id column', exportOf('bank.csv', csv([HEAD.slice(1), ...ROWS.map(r => r.slice(1))])), /no id column/);
  refused('a row with no id', withRows(ROWS[0], row(1, 'Question ID', '')), /^ {2}row 3: no id$/m);
  refused('an id used twice', withRows(ROWS[0], ROWS[1], row(2, 'Question ID', 'V-1')), /row 4 \(id V-1\): the id is given by row 2 too/);
  refused('an id that cannot be a file name', withRows(row(0, 'Question ID', 'V 1/2')), /row 2: its id is not letters, digits, _ \. -/);
  refused('a row with no chapter', withRows(row(0, 'Category', '')), /row 2 \(id V-1\): no chapter/);
  refused('no chapter column, and no --chapter', exportOf('bank.csv', csv([HEAD.filter(h => h !== 'Category'), ...ROWS.map(r => r.filter((_, k) => k !== 1))])), /no chapter column/);
  refused('--chapter for a file that has a chapter column', main, /--chapter is for a file without one/, { chapter: 'Invented' });
  refused('no stem', withRows(row(0, 'Question', '')), /row 2 \(id V-1\): no stem$/m);
  refused('fewer than two options', withRows(row(1, 'Option B', '').map((c, k) => (k >= 4 && k <= 6 ? '' : c))), /row 2 \(id R-1\): fewer than two options/);
  refused('an empty option before a filled one', withRows(row(0, 'Option B', '')), /row 2 \(id V-1\): option B is empty, and a later one is not/);
  refused('an answer that is not one of its options', withRows(row(1, 'Correct Answer', 'D')), /row 2 \(id R-1\): its answer is not one of its 3 options/);
  refused('an answer that is no letter or number', withRows(row(0, 'Correct Answer', 'Invented two')), /row 2 \(id V-1\): its answer is not one of its 4 options/);
  refused('peers for some options and not others', withRows(row(0, 'Percent C', '')), /row 2 \(id V-1\): peers for 3 of its 4 options/);
  refused('peers that are not numbers from 0 to 100', withRows(row(0, 'Percent B', '170')), /row 2 \(id V-1\): the peers for B are not numbers from 0 to 100/);
  refused('a figure not in the folder', withRows(row(2, 'Images', 'missing.png')), /row 2 \(id V-2\): figure missing\.png is not in /);
  refused('a figure that is not a .webp, .png or .jpg', withRows(row(2, 'Images', 'scan.gif')), /row 2 \(id V-2\): figure "scan\.gif" is not a \.webp, \.png or \.jpg/);
  refused('a figure named with a folder', withRows(row(2, 'Images', '../ecg-1.png')), /row 2 \(id V-2\): figure "\.\.\/ecg-1\.png" is not/);
  refused('a figure whose bytes are not what its name says', exportOf('bank.csv', csv([HEAD, ROWS[2]]), { 'ecg-1.png': JPG }), /figures\/ecg-1\.png is not a png file/);
  refused('two columns that give the same thing', exportOf('bank.csv', csv([[...HEAD, 'Stem'], ...ROWS.map(r => [...r, ''])])), /the columns "Question" and "Stem" give the same thing/);
  refused('a cell under no heading', withRows([...ROWS[0], 'stray']), /row 2: 1 cell\(s\) with no column heading/);
  refused('a number column that is not whole numbers', exportOf('bank.csv', csv([[...HEAD, 'Item Number'], [...ROWS[0], 'three']])), /row 2 \(id V-1\): its number is not a whole number from 1/);
  refused('ACCSAP 12\'s id for the bank', main, /accsap-12 is ACCSAP 12's id/, { id: 'accsap-12' });
  refused('no --name', main, /--name "Bank Name"/, { name: '' });
  refused('a name the app would refuse', main, /the app would refuse this bank's name/, { name: 'Invented <b>' });
  const jsonBad = exportOf('bank.json', '[{"id": "V-1", "stem": Invented stem never quoted}]');
  /* JSON.parse's message can quote the text near the fault: the refusal is
     the importer's own sentence and nothing more. */
  refused('a file that is not JSON, without passing on what JSON.parse quotes of it', jsonBad, /^the file is not JSON(?: \(at character \d+\))?$/);
  refused('options that are not a list, in JSON', exportOf('bank.json', JSON.stringify([{ id: 'V-1', chapter: 'c', stem: 'Invented stem', options: 'Invented one', answer: 'A' }])),
          /item 1 \(id V-1\): its options are not a list/);
  ok('and no refusal carries a word of a question', refusals.length > 20 && refusals.every(w => w && !/Invented (stem|one|two|three|four|why|reason|commentary)|never (closed|quoted)/.test(w)),
     refusals.filter(w => /Invented (stem|one|two|three|four|why|reason|commentary)|never (closed|quoted)/.test(w)).map(w => w.slice(0, 80)).join(' | ') || `${refusals.length} refusals`);
}

head('where a licensed bank may be');
{
  /* A repository of its own, so nothing is written into this one. */
  const repo = path.join(dir, 'repo');
  for (const d of ['source', 'content', 'build', 'tests', 'docs', 'assets']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  const put = rel => { const f = path.join(repo, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, csv([HEAD, ROWS[1]])); return f; };
  const inRepo = (input, o = {}) => attempt(() => I.importBank({ input, ...NAME, root: repo, ...o }));
  const tracked = inRepo(put('tests/bank.csv'), { out: path.join(dir, 'out-tracked') });
  ok('a file in the repository outside source/ and content/ is refused', !tracked.r && /the file is in the repository at tests\/bank\.csv, outside source\/, content\//.test(tracked.why), tracked.why || 'imported');
  const fromSource = inRepo(put('source/bank.csv'));
  ok('read from source/, it is written to build/<id> by default', !!fromSource.r && fromSource.r.out === path.join(repo, 'build', 'invented-licensed-bank') &&
     fs.existsSync(path.join(repo, 'build', 'invented-licensed-bank', 'questions.json')), fromSource.why || (fromSource.r && fromSource.r.out));
  const toDocs = inRepo(put('content/bank.csv'), { out: path.join(repo, 'docs', 'bank') });
  ok('a bank written in the repository outside build/, source/ and content/ is refused', !toDocs.r && /the bank is in the repository at docs\/bank, outside build\/, source\/, content\//.test(toDocs.why) &&
     !fs.existsSync(path.join(repo, 'docs', 'bank')), toDocs.why || 'written');
  const figs = inRepo(put('source/b2.csv'), { figures: path.join(repo, 'assets') });
  ok('and a figures folder in the repository outside source/ and content/', !figs.r && /the figures folder is in the repository at assets/.test(figs.why), figs.why || 'imported');
  const link = path.join(dir, 'link.csv');
  fs.symlinkSync(put('tests/linked.csv'), link);
  const linked = inRepo(link, { out: path.join(dir, 'out-linked') });
  ok('a link from outside to a file in the repository is followed', !linked.r && /the file is in the repository at tests\/linked\.csv/.test(linked.why), linked.why || 'imported');
}

head('a refused import leaves the last bank as it was');
{
  const out = path.join(dir, 'kept');
  const first = imp(main, { out });
  const bytes = () => { try { return fs.readFileSync(path.join(out, 'questions.json')); } catch (_) { return null; } };
  const snapshot = first.r ? bytes() : null;
  const second = imp(exportOf('bank.csv', csv([HEAD, ROWS[0], ROWS[0]])), { out });
  ok('the bank written before is still there, byte for byte', !!first.r && !second.r && !!snapshot && !!bytes() && bytes().equals(snapshot) &&
     !fs.readdirSync(dir).some(f => /^kept\.(tmp|old)-/.test(f)), second.r ? 'the second import went through' : first.why.split('\n')[0]);
  const mine = path.join(dir, 'not-a-bank');
  fs.mkdirSync(mine);
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'kept');
  const over = imp(main, { out: mine });
  ok('an --out folder that holds no bank is refused, and left as it was', !over.r && /not-a-bank is there and holds no bank/.test(over.why) &&
     fs.readdirSync(mine).join() === 'notes.txt', over.r ? 'it was replaced' : over.why.split('\n')[0]);
  const inside = path.join(out, 'bank.csv');
  if (first.r) fs.copyFileSync(main, inside);
  const self = imp(inside, { out, figures: path.join(path.dirname(main), 'figures') });
  ok('and so is a file inside the folder the bank is written to, which stays', !self.r && /the file is inside .*kept, the folder the bank is written to/.test(self.why) && fs.existsSync(inside),
     self.why || 'imported');
}

head('the command line');
{
  const cli = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'import-bank.js'), ...a], { encoding: 'utf8', cwd: dir });
  const figs = path.join(dir, 'elsewhere-figures');
  fs.mkdirSync(figs);
  fs.writeFileSync(path.join(figs, 'ecg-1.png'), PNG);
  fs.writeFileSync(path.join(figs, 'ecg-2.jpg'), JPG);
  const file = path.join(dir, 'cli-bank.csv');
  fs.writeFileSync(file, csv([HEAD, ...ROWS]));
  const out = path.join(dir, 'cli-out');
  const r1 = cli('--name', 'Invented Licensed Bank', '--by', 'Invented Press', '--figures', figs, '--out', out, file);
  ok('it imports, figures from --figures, exit 0, and says what it read and what to run next', r1.status === 0 &&
     /^imported Invented Licensed Bank \(id invented-licensed-bank, by Invented Press\): 3 questions in 2 chapter\(s\), 2 figure\(s\), from CSV/.test(r1.stdout) &&
     /not read: "Notes"/.test(r1.stdout) && /1 question\(s\) have no commentary/.test(r1.stdout) && /next: npm run build -- /.test(r1.stdout) && fs.existsSync(path.join(out, 'figures', 'ecg-2.jpg')),
     `exit ${r1.status}: ${(r1.stdout + r1.stderr).trim().split('\n')[0]}`);
  const withImg = path.join(dir, 'cli-img.csv');
  fs.writeFileSync(withImg, csv([HEAD, ['I-1', 'Invented Imaging', 'Invented stem <p>with <img src="ecg-1.png"></p>', 'one', 'two', '', '', 'A', 'Invented commentary', '', '', '', '', '', '', '', '', '', '']]));
  const r4 = cli('--name', 'Invented Licensed Bank', '--out', path.join(dir, 'cli-img-out'), withImg);
  ok('it says how many <img> tags it dropped, and where an image belongs', r4.status === 0 && /^  1 <img> tag\(s\) in the text were dropped: an image comes through a figures column, not a stem$/m.test(r4.stdout),
     `exit ${r4.status}: ${(r4.stdout + r4.stderr).trim().split('\n').slice(0, 3).join(' / ')}`);
  ok('and says nothing of images when there were none', r1.status === 0 && !/<img>/.test(r1.stdout));
  const keyH = ROWS[0].slice();
  keyH[HEAD.indexOf('Correct Answer')] = 'H';
  const r2 = cli(exportOf('bank.csv', csv([HEAD, keyH])), '--name', 'X');
  ok('a refused file stops it, exit 1, and says why', r2.status === 1 && /^import-bank: no bank was written/.test(r2.stderr), `exit ${r2.status}: ${r2.stderr.split('\n')[0]}`);
  const r3 = cli('--name', 'X');
  ok('no file, exit 2 with the usage', r3.status === 2 && /^usage: node scripts\/import-bank\.js/.test(r3.stderr), `exit ${r3.status}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})().catch(e => {
  ok('the suite ran to its end', false, String(e && e.message || e).split('\n')[0]);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
});
