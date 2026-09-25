/* ═══════════════════════════════════════════════════════════════════════════
   pack.js — a unit's lessons and questions, written with Claude in the
   owner's own chat, and held to the book before any of it is used.

   PURE. Builds the prompt the owner copies into claude.ai, reads the reply
   pasted back, and checks it. Never calls anything.

   WHY THIS EXISTS. The built-in coach only extracts: it can pick the book's
   sentences, never reason about them. The owner has Claude, with their own
   Braunwald-the-Master and Supreme-Memorizer skills, one chapter per chat.
   So Memorizer writes the request, carrying the chapter's own text with its
   [p.N] page markers (the same excerpt the API path sends, prompts.js), and
   imports what comes back: the lesson, the questions, and what an extractor
   cannot write — the mechanism, the pairs that get confused, why each wrong
   option is wrong, and the trap a question sets.

   HELD TO THE BOOK. What Claude writes is checked against the chapter, and
   what is not found is FLAGGED on screen, never passed off as the book's:
     · every number must be in the section or on the page it cites;
     · every condition, test and treatment it names (ask.js's vocabulary)
       must be named somewhere in the chapter;
     · every page it cites must be in the section;
     · a quoted sentence, its gap filled with the answer, must be the
       section's own words;
     · an analogy may carry no number and no name the chapter does not.
   What cannot be used at all is refused, with the reason: a section whose
   title is not this unit's, a question that is not a fair multiple-choice
   question (prompts.js mcqError), and anything Claude marked NOT_IN_PDF.
   Only what the checks name is checked: a sentence can pass all of them and
   still be Claude's paraphrase, which is why it is labelled "Written with
   Claude". tests/verify-memorizer-pack-pure.js holds every rule.

   The pack stays on this device (store.js `packs`), like the book.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var Prompts = root.MemPrompts || (typeof require === 'function' ? require('./prompts.js') : null);
var Ground = root.MemGround || (typeof require === 'function' ? require('./ground.js') : null);
var Ask = root.MemAsk || (typeof require === 'function' ? require('./ask.js') : null);

var FORMAT = 'memorizer-pack';
var VERSION = 1;
/* Sections per reply. A section's lesson and questions, with a reason for
   every option, run to a couple of thousand words; four keeps a reply well
   inside what a chat will write before it is cut off. */
var PER_REPLY = 4;
var NOT_IN_PDF = Prompts.NOT_IN_PDF;

/* ── the shape ─────────────────────────────────────────────────────────────
   Prompts' lesson and question, each with what a pack adds. Closed and
   every property required, as prompts.js explains: a field left out is a
   refusal with its path, never an undefined that reads as nothing to say. */
function extend(schema, extra) {
  var props = {};
  Object.keys(schema.properties).forEach(function (k) { props[k] = schema.properties[k]; });
  Object.keys(extra).forEach(function (k) { props[k] = extra[k]; });
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}
var S = { type: 'string' }, I = { type: 'integer' };
function arr(items) { return { type: 'array', items: items }; }
var PAGED = Prompts.SCHEMAS.lesson.properties.points.items;
var LESSON = extend(Prompts.SCHEMAS.lesson, {
  mechanism: S,
  distinctions: arr(extend({ properties: {} }, { a: S, b: S, how: S, page: I })),
  pearls: arr(PAGED),
});
var QUESTION = extend(Prompts.SCHEMAS.quiz.properties.questions.items, { why: arr(S), trap: S });
/* What may be left out of a reply, and reads as nothing to say when it is:
   a chat that writes no pearls for a section has not written a wrong one.
   What may not: a lesson's points, and a question's stem, options, answer,
   explanation and page. Keys a reply adds that are not here are left out. */
var LESSON_EMPTY = { overview: '', mechanism: '', numbers: [], distinctions: [], pearls: [], mnemonics: [], analogies: [], flowchart: '' };
var QUESTION_EMPTY = { quote: '', why: [], trap: '' };
function filled(v, schema, empty) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  var o = {};
  Object.keys(schema.properties).forEach(function (k) {
    if (k in v) o[k] = v[k];
    else if (empty && k in empty) o[k] = JSON.parse(JSON.stringify(empty[k]));
  });
  return o;
}

/* One section of a pack, filled in: what the prompt shows as the shape, and
   what the suite checks against the schema — so the example cannot drift
   from what the importer accepts. */
var EXAMPLE = {
  section: 1,
  title: 'the section title, exactly as listed',
  lesson: {
    overview: 'The big idea in one or two plain sentences.',
    mechanism: 'Why it happens, as a chain: A leads to B, which causes C.',
    points: [{ text: 'Key term — the point, at most 25 words.', page: 12 }],
    numbers: [{ text: 'What it measures: the value and its unit.', page: 12 }],
    distinctions: [{ a: 'one thing', b: 'what it is confused with', how: 'How to tell them apart, in one sentence.', page: 13 }],
    pearls: [{ text: 'The one fact most likely to be asked.', page: 12 }],
    mnemonics: [{ title: 'What the list is', letters: 'ABC', words: ['Alpha', 'Beta', 'Gamma'] }],
    analogies: [{ title: 'Short name', text: 'An everyday comparison.', source: 'Claude' }],
    flowchart: 'flowchart TD\n  A["first step"] --> B["next step"]',
  },
  quiz: { questions: [{
    question: 'A vignette or a direct question?',
    quote: '',
    options: ['first option', 'second option', 'third option', 'fourth option'],
    answer: 1,
    explain: 'Why the answer is right, in the book’s words.',
    page: 12,
    why: ['Why the first option is wrong.', '', 'Why the third option is wrong.', 'Why the fourth option is wrong.'],
    trap: 'the confusion this question tests',
  }] },
};

/* ── the prompt ────────────────────────────────────────────────────────── */
function unitName(doc) {
  return doc.bookName ? doc.bookName + (doc.chapter ? ' · chapter ' + doc.chapter : '') + ' · ' + doc.name : doc.name;
}
function pages(c) { return c.pageEnd !== c.pageStart ? 'pp. ' + c.pageStart + '–' + c.pageEnd : 'p. ' + c.pageStart; }
/* Which sections go in which reply: [[first, last], …], 1-based. */
function replies(n) {
  var out = [];
  for (var i = 1; i <= n; i += PER_REPLY) out.push([i, Math.min(n, i + PER_REPLY - 1)]);
  return out;
}
function prompt(doc) {
  var n = doc.clusters.length, name = unitName(doc);
  var plan = replies(n).map(function (r, k) {
    return '  reply ' + (k + 1) + ': section' + (r[0] === r[1] ? ' ' + r[0] : 's ' + r[0] + '–' + r[1]);
  }).join('\n');
  var list = doc.clusters.map(function (c, i) { return '  ' + (i + 1) + '. "' + c.title + '" — ' + pages(c); }).join('\n');
  var text = doc.clusters.map(function (c, i) {
    return '=== SECTION ' + (i + 1) + ': "' + c.title + '" (' + pages(c) + ') ===\n' + Prompts.excerpt(c);
  }).join('\n\n');
  return [
    'MEMORIZER STUDY PACK — ' + name,
    '',
    'Write a study pack for my Memorizer app from the chapter below. Use your Braunwald-the-Master and ' +
    'Supreme-Memorizer skills if this chat has them: teach it as a master clinician would, to be remembered ' +
    'and to be examined on.',
    '',
    'RULES',
    '1. Work ONLY from the chapter text below (and from the chapter’s PDF, if I attach it, for its figures ' +
    'and tables). Every fact, number, dose, threshold, drug, test and condition you write must be in it. Add ' +
    'nothing from your own knowledge, however correct. Where something is needed and the text does not have ' +
    'it, write ' + NOT_IN_PDF + ' instead — Memorizer leaves those items out.',
    '2. Cite a page for every item, numbered as the [p.N] markers in the text number them.',
    '3. Memorizer checks your reply against my book before it uses it: every number, every page, every quoted ' +
    'sentence, and the conditions, tests and treatments you name. Anything it cannot find is shown to me ' +
    'flagged "not found in your book".',
    '4. ' + Prompts.ANALOGY_RULE,
    '5. Reply with JSON only, in one code block, in exactly the shape shown below. Every field is required: ' +
    'write "" or [] when there is nothing to put.',
    '',
    'FOR EACH SECTION',
    '- "section" is its number in the list below, and "title" its title exactly as listed.',
    '- lesson.overview: the big idea, in one or two plain sentences.',
    '- lesson.mechanism: the mechanism or chain of reasoning that makes the section make sense, in two to four ' +
    'sentences ("" if it has none).',
    '- lesson.points: 5 to 10 high-yield points, most important first, each at most 25 words and starting ' +
    'with its key term.',
    '- lesson.numbers: every threshold, cut-off, dose, percentage or duration worth memorising, one to an ' +
    'item, with what it measures.',
    '- lesson.distinctions: the pairs a student confuses — two conditions, drugs, signs or criteria — ' +
    'and how to tell them apart, in one sentence.',
    '- lesson.pearls: one to three exam pearls, the facts most likely to be asked.',
    '- lesson.mnemonics: for every list of three or more items, an acrostic: "words" are the items in order ' +
    'and "letters" their first letters.',
    '- lesson.analogies: one everyday analogy for a mechanism, or [] if none fits.',
    '- lesson.flowchart: a Mermaid "flowchart TD" with quoted labels if the section describes a pathway, ' +
    'sequence or decision; else "".',
    '- quiz.questions: 6 to 8 board-style questions, the most important material first. ' + Prompts.MCQ_RULE +
    ' Exactly ' + Prompts.OPTIONS + ' options; "answer" is the index (0 to ' + (Prompts.OPTIONS - 1) + ') of ' +
    'the right one. Prefer clinical vignettes, "most likely", "next best step" and "all EXCEPT". "explain": ' +
    'why the answer is right, in the book’s words. "why": ' + Prompts.OPTIONS + ' strings, one per ' +
    'option in order — for each wrong option the exact reason it is wrong by the book, and "" for the ' +
    'right one. "trap": the confusion the question tests (e.g. "stenosis vs regurgitation"), or "". "quote": ' +
    '"" unless the question completes a sentence of the text, then that sentence with the gap as _____. No ' +
    '"all of the above" or "none of the above".',
    '',
    'THE SHAPE — one reply:',
    '{ "format": "' + FORMAT + '", "version": ' + VERSION + ', "unit": ' + JSON.stringify(name) + ', "sections": [ … ] }',
    'where each section is like this one:',
    JSON.stringify(EXAMPLE, null, 2),
    '',
    'REPLIES',
    'The chapter has ' + n + ' section' + (n === 1 ? '' : 's') + '. Write ' + (replies(n).length === 1 ? 'them in one reply' : 'them in ' + replies(n).length + ' replies, so that none is cut off') + ':',
    plan,
    replies(n).length === 1 ? '' : 'Each reply is a whole pack in the shape above holding only its sections. After each one I will import it and say "next".',
    '',
    'THE SECTIONS',
    list,
    '',
    'THE CHAPTER TEXT',
    '<<<CHAPTER',
    text,
    'CHAPTER>>>',
  ].join('\n');
}

/* ── reading a reply ───────────────────────────────────────────────────────
   Every pack in the text: a chat's reply wraps its JSON in a code fence and
   a sentence or two, and two replies pasted at once are two packs. */
function packsIn(text) {
  var t = String(text == null ? '' : text), out = [], errors = [], from = 0;
  while (from < t.length) {
    var raw = Prompts.extractObject(t.slice(from));
    if (raw == null) break;
    var at = t.indexOf(raw, from);
    from = at + raw.length;
    var v;
    try { v = JSON.parse(raw); } catch (e) { errors.push('a block that is not valid JSON: ' + e.message); continue; }
    if (v && v.format === FORMAT) out.push(v);
  }
  return { packs: out, errors: errors };
}
/* → { ok, packs } or { ok: false, error }. */
function parse(text) {
  var got = packsIn(text);
  if (!got.packs.length) {
    return { ok: false, error: got.errors.length ? 'the reply’s JSON could not be read (' + got.errors[0] + ')'
      : 'there is no Memorizer pack in it — paste Claude’s whole reply, code block and all' };
  }
  for (var i = 0; i < got.packs.length; i++) {
    var p = got.packs[i];
    if (typeof p.version !== 'number' || p.version > VERSION) return { ok: false, error: 'the pack is version ' + p.version + ', and this Memorizer reads version ' + VERSION };
    if (!Array.isArray(p.sections)) return { ok: false, error: 'the pack has no list of sections' };
  }
  return { ok: true, packs: got.packs };
}

/* ── the book, as the checks read it ──────────────────────────────────── */
function segText(s) {
  if (!s.table) return s.text || '';
  return (s.tableHeader ? [s.tableHeader] : []).concat(s.table).map(function (r) { return r.join(' '); }).join(' ');
}
function norm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
/* "p. 12", "pp. 12–13", "[p.12]": a citation's number is not a claim. */
function unpaged(t) { return String(t || '').replace(/\[?\bpp?\.\s*\d+(?:\s*[–—-]\s*\d+)?\]?/gi, ' '); }
function numbersOf(t) { return Ground.numbersIn(unpaged(t)); }
function idsOf(t) { return Ask.entriesIn(t).map(function (e) { return e.kind + ':' + e.id; }); }
function labelOf(id) {
  var k = id.split(':'), list = Ask.VOCAB[k[0]] || [];
  for (var i = 0; i < list.length; i++) if (list[i][0] === k[1]) return list[i][1];
  return k[1];
}
function bookOf(doc) {
  var byPage = {}, all = [];
  doc.clusters.forEach(function (c) {
    (c.segments || []).forEach(function (s) { var t = segText(s); all.push(t); byPage[s.page] = (byPage[s.page] || '') + ' ' + t; });
  });
  return { byPage: byPage, names: idsOf(all.join(' ')) };
}

/* One claim: '' when it may be shown as it is, else what was not found. */
function claimFlag(text, sec, book, pg) {
  var src = sec.text + ' ' + (pg != null && book.byPage[pg] || '');
  var have = numbersOf(src);
  var newNum = numbersOf(text).filter(function (x) { return have.indexOf(x) === -1; });
  if (newNum.length) return 'a number not in your book: ' + newNum[0];
  var newName = idsOf(text).filter(function (id) { return book.names.indexOf(id) === -1; });
  if (newName.length) return 'names what your chapter does not: ' + labelOf(newName[0]);
  return '';
}
function pageFlag(pg, c) {
  return pg >= c.pageStart && pg <= c.pageEnd ? '' : 'p. ' + pg + ' is not in this section (' + pages(c) + ')';
}
/* A quoted sentence, its gap filled with the answer, is the section's. */
function quoteFlag(q, sec) {
  if (!q.quote) return '';
  var filled = norm(q.quote.replace(/_{3,}/g, ' ' + q.options[q.answer] + ' '));
  return filled && sec.norm.indexOf(filled) !== -1 ? '' : 'the quoted sentence is not your book’s words';
}
function says(t) { return String(t || '').indexOf(NOT_IN_PDF) !== -1; }
function labels(flowchart) {
  var out = [], re = /"([^"]*)"/g, m;
  while ((m = re.exec(String(flowchart || '')))) out.push(m[1]);
  return out.join(' ');
}

/* ── checking a pack against the unit ──────────────────────────────────────
   Returns { sections: [{ index, title, lesson, quiz, flags }], refused:
   [{ section, title, why }], dropped: [{ section, where, why }] }.
   A flagged item keeps a `flag` of what was not found; the section's
   `flags` lists them all, for the import report. */
function checkOne(p0, doc, book) {
  if (!p0 || typeof p0 !== 'object') return { refused: 'it is not a section' };
  if (typeof p0.section !== 'number' || Math.floor(p0.section) !== p0.section) return { refused: 'it has no section number' };
  if (typeof p0.title !== 'string') return { refused: 'it has no title' };
  var p = { section: p0.section, title: p0.title, lesson: filled(p0.lesson, LESSON, LESSON_EMPTY), quiz: p0.quiz || { questions: [] } };
  var lerr = Prompts.check(LESSON, p.lesson, 'lesson');
  if (lerr) return { refused: lerr };
  if (!Array.isArray(p.quiz.questions)) return { refused: 'quiz.questions is not a list' };
  var i = p.section - 1, c = doc.clusters[i];
  if (!c) return { refused: 'this unit has no section ' + p.section };
  if (norm(p.title) !== norm(c.title)) return { refused: 'it is "' + p.title + '", and section ' + p.section + ' here is "' + c.title + '"' };
  var sec = { text: c.segments.map(segText).join(' ') };
  sec.norm = norm(sec.text);
  var flags = [], dropped = [];
  var flag = function (item, where, why) { if (why) { item.flag = why; flags.push({ where: where, text: item.text || item.question || item.how || '', why: why }); } };
  var L = JSON.parse(JSON.stringify(p.lesson)), keep = function (list, where) {
    return list.filter(function (x, k) {
      var t = [x.text, x.a, x.b, x.how].filter(Boolean).join(' ');
      if (says(t)) { dropped.push({ where: where + ' ' + (k + 1), why: 'Claude marked it ' + NOT_IN_PDF }); return false; }
      flag(x, where + ' ' + (k + 1), pageFlag(x.page, c) || claimFlag(t, sec, book, x.page));
      return true;
    });
  };
  L.points = keep(L.points, 'point');
  L.numbers = keep(L.numbers, 'number');
  L.pearls = keep(L.pearls, 'pearl');
  L.distinctions = keep(L.distinctions, 'distinction');
  if (!L.points.length) return { refused: 'its lesson has no points left once what Claude marked ' + NOT_IN_PDF + ' is out' };
  ['overview', 'mechanism'].forEach(function (k) {
    if (says(L[k])) { dropped.push({ where: k, why: 'Claude marked it ' + NOT_IN_PDF }); L[k] = ''; return; }
    var why = L[k] ? claimFlag(L[k], sec, book) : '';
    if (why) { L.flags = L.flags || {}; L.flags[k] = why; flags.push({ where: k, text: L[k], why: why }); }
  });
  L.analogies = L.analogies.filter(function (a, k) {
    var t = a.title + ' ' + a.text;
    var why = numbersOf(t).length ? 'an analogy may not carry a number' : claimFlag(t, sec, book);
    if (why) dropped.push({ where: 'analogy ' + (k + 1), why: why });
    return !why;
  });
  L.mnemonics = L.mnemonics.filter(function (m, k) {
    var ok = m.words.length >= 2 && m.letters.replace(/[^A-Za-z]/g, '').length === m.words.length;
    if (!ok) dropped.push({ where: 'mnemonic ' + (k + 1), why: 'its letters are not one for each word' });
    return ok;
  });
  if (L.flowchart) {
    var fw = says(L.flowchart) ? 'Claude marked part of it ' + NOT_IN_PDF : claimFlag(labels(L.flowchart), sec, book);
    if (fw) { dropped.push({ where: 'flowchart', why: fw }); L.flowchart = ''; }
  }
  L.by = 'pack';

  var qs = [];
  p.quiz.questions.forEach(function (q0, k) {
    var q = JSON.parse(JSON.stringify(filled(q0, QUESTION, QUESTION_EMPTY) || null)), where = 'question ' + (k + 1);
    var err = Prompts.check(QUESTION, q, where) || Prompts.mcqError(q, where);
    if (!err && q.why.length && q.why.length !== q.options.length) err = where + ' has ' + q.why.length + ' reasons for ' + q.options.length + ' options';
    if (!err && says([q.question, q.options[q.answer], q.explain].join(' '))) err = 'Claude marked it ' + NOT_IN_PDF;
    if (err) { dropped.push({ where: where, why: err }); return; }
    var right = q.options[q.answer];
    flag(q, where, pageFlag(q.page, c) || quoteFlag(q, sec) || claimFlag([q.question, right, q.explain].join(' '), sec, book, q.page));
    q.by = 'pack';
    qs.push(q);
  });
  return { value: { index: i, title: c.title, lesson: L, quiz: { questions: qs }, flags: flags }, dropped: dropped };
}
function check(packs, doc) {
  var book = bookOf(doc), out = { sections: [], refused: [], dropped: [] }, seen = {};
  [].concat(packs).forEach(function (pk) {
    pk.sections.forEach(function (p) {
      var r = checkOne(p, doc, book);
      if (r.refused) { out.refused.push({ section: p && p.section, title: p && p.title || '', why: r.refused }); return; }
      r.dropped.forEach(function (d) { d.section = p.section; out.dropped.push(d); });
      if (seen[r.value.index] != null) out.sections[seen[r.value.index]] = r.value;
      else { seen[r.value.index] = out.sections.length; out.sections.push(r.value); }
    });
  });
  return out;
}

/* ── kept on the device ───────────────────────────────────────────────── */
/* The unit's stored pack with a checked import merged in: a section
   imported again is replaced, the rest are kept. */
function merge(rec, checked, doc, now) {
  var r = rec ? JSON.parse(JSON.stringify(rec)) : { id: doc.id, sections: {} };
  checked.sections.forEach(function (s) { s.at = now; r.sections[s.index] = s; });
  r.at = now;
  return r;
}
function sectionOf(rec, i) { return rec && rec.sections && rec.sections[i] || null; }
/* What the owner is told, in counts that come from the check itself. */
function report(checked) {
  var s = checked.sections, q = 0, f = 0;
  s.forEach(function (x) { q += x.quiz.questions.length; f += x.flags.length; });
  var nums = s.map(function (x) { return x.index + 1; });
  return {
    imported: s.length, questions: q, flagged: f, refused: checked.refused.length, dropped: checked.dropped.length,
    line: s.length ? 'Imported ' + (s.length === 1 ? 'section ' : 'sections ') + nums.join(', ') + ': ' +
      s.length + (s.length === 1 ? ' lesson, ' : ' lessons, ') + q + (q === 1 ? ' question' : ' questions') + '. ' +
      (f ? f + (f === 1 ? ' item' : ' items') + ' not found in your book, flagged where it is shown.' : 'Everything checked was found in your book.')
      : 'Nothing was imported.',
  };
}
/* How much of the unit the pack covers. */
function coverage(rec, doc) {
  var have = doc.clusters.filter(function (_, i) { return !!sectionOf(rec, i); }).length;
  var flagged = 0;
  doc.clusters.forEach(function (_, i) { var s = sectionOf(rec, i); if (s) flagged += (s.flags || []).length; });
  return { have: have, of: doc.clusters.length, flagged: flagged,
           next: replies(doc.clusters.length).filter(function (r) { for (var k = r[0]; k <= r[1]; k++) if (!sectionOf(rec, k - 1)) return true; return false; })[0] || null };
}

var MemPack = { FORMAT: FORMAT, VERSION: VERSION, PER_REPLY: PER_REPLY, LESSON: LESSON, QUESTION: QUESTION, EXAMPLE: EXAMPLE,
                prompt: prompt, replies: replies, unitName: unitName, packsIn: packsIn, parse: parse, check: check, merge: merge,
                sectionOf: sectionOf, report: report, coverage: coverage, claimFlag: claimFlag, bookOf: bookOf };
root.MemPack = MemPack;
if (typeof module !== 'undefined' && module.exports) module.exports = MemPack;
})(typeof window !== 'undefined' ? window : this);
