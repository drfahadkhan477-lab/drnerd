/* ═══════════════════════════════════════════════════════════════════════════
   ui.js — the screens: Home, a unit's sections, a section's lesson, its
   multiple-choice drill and result, the final exam, Review and Settings.

   Everything a coach says reaches the page as TEXT (textContent), never as
   markup. The exceptions are the mascot and progress rings, which are this
   file's own SVG, and a Mermaid flowchart, rendered by Mermaid under
   securityLevel "strict" and falling back to its source as plain text.

   The protocol lives in session.js; this file dispatches events to it and
   draws whatever state comes back. It keeps one thing of its own while a
   question is open: `ui.choice`, the option tapped, which is recorded on
   Next — the reason is read before the answer is filed.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var doc = root.document;
var Chunk = root.MemChunk, Prompts = root.MemPrompts, Session = root.MemSession, Ocr = root.MemOcr;
var Provider = root.MemProvider, Store = root.MemStore, Pdf = root.MemPdf, FSRS = root.FSRS, Coach = root.MemCoach;
var Skill = root.MemSkill, Monitor = root.MemMonitor;
var Format = root.MemFormat, Look = root.MemLook, Home = root.MemHome, Pearl = root.Pearl, Book = root.MemBook, Ask = root.MemAsk, Ground = root.MemGround, LLM = root.MemLLM, Vec = root.MemVec, Sheet = root.MemSheet, Figure = root.MemFigure, Agent = root.MemAgent, Dialog = root.MemDialog, Prov = root.MemProvenance, Study = root.MemStudy, Pack = root.MemPack;

var MERMAID = { url: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js',
                sri: 'sha384-WmdflGW9aGfoBdHc4rRyWzYuAjEmDwMdGdiPNacbwfGKxBW/SO6guzuQ76qjnSlr' };

var ui = {
  view: 'library',      /* library | book | session | ask | review | settings */
  askIdx: null, askFor: null, askQ: '', askR: null, askKind: 'chapters', askBusy: false,
  ai: { status: '', busy: '', summary: null, lesson: {} },
  docs: [], cards: [], sessions: {}, at: {}, pearlSkip: 0, books: [], days: [], bookId: null,
  docsStale: true, pearlCache: null,
  docId: null, docRec: null, state: null,
  busy: '', busyKey: '', stepSeq: 0, moving: false, rating: false, saveError: '', notice: '',
  error: '', choice: null, pasting: false,
  importing: '', reviewShown: false, reviewDone: 0, drill: null,
};

/* ── tiny DOM helper: h('div.cls', {attrs}, children…) ─────────────────── */
function h(sel, attrs) {
  var m = sel.split('.');
  var el = doc.createElement(m[0] || 'div');
  if (m.length > 1) el.className = m.slice(1).join(' ');
  var kids = Array.prototype.slice.call(arguments, 2);
  if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) Object.keys(attrs).forEach(function (k) {
    var v = attrs[k];
    if (v == null || v === false) return;
    if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  });
  (function add(list) {
    list.forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) add(c);
      else el.appendChild(c.nodeType ? c : doc.createTextNode(String(c)));
    });
  })(kids);
  return el;
}


function today() { return FSRS.todayISO(); }
function cfg() { return Provider.loadConfig(); }
function hasKey() { return Provider.ready(cfg()); }
function builtin() { return !Provider.needsKey(cfg()); }

/* ── persistence ─────────────────────────────────────────────────────────── */
/* The units are reloaded only when they have changed (docsChanged()): a
   whole book is hundreds of them and megabytes of text, and refresh() runs
   after every review card. */
function docsChanged() { ui.docsStale = true; ui.pearlCache = null; }
function refresh() {
  return Promise.all([ui.docsStale ? Store.all('docs') : Promise.resolve(null), Store.all('cards'), Store.all('sessions'),
                      Store.all('books'), Store.get('meta', 'days'), Store.get('meta', 'coach-profile'), Store.get('meta', 'checks'), Store.get('meta', 'practice'), Store.get('meta', 'plan'), Store.get('meta', 'notes'), Store.get('meta', 'activity'), Store.get('meta', 'pearl-recall')]).then(function (r) {
    if (r[0]) { ui.docs = r[0].sort(function (a, b) { return b.addedAt - a.addedAt; }); ui.docsStale = false; ui.docs.forEach(retitleDoc); }
    ui.cards = retitleCards(r[1]);
    ui.sessions = {}; ui.at = {};
    r[2].forEach(function (x) { ui.sessions[x.id] = x.state; ui.at[x.id] = x.at || 0; });
    ui.books = r[3].sort(function (a, b) { return b.addedAt - a.addedAt; });
    ui.days = r[4] && Array.isArray(r[4].days) ? r[4].days : legacyDays();
    ui.profile = r[5] && r[5].profile || null;
    ui.checks = r[6] && r[6].recs || {};
    ui.practiceLog = r[7] && r[7].history || [];
    ui.examDate = r[8] && r[8].examDate || '';
    ui.notes = r[9] && r[9].recs || {};
    ui.activity = r[10] && r[10].log || null;
    ui.pearlRecalls = r[11] && r[11].recs || {};
  });
}
/* A unit stored before its titles could be read properly is named the way
   the chunker names one now (chunk.js retitle), in memory, every load: the
   owner's book showed "hy = rly: THERAPY" and a run of "(cont.)" after
   both were fixed, because the titles were stored when it was added. The
   cards and the session carry copies of the titles, so they follow. */
function retitleDoc(d) {
  Chunk.retitle(d.clusters).forEach(function (t, i) { d.clusters[i].title = t; });
}
function retitleCards(cards) {
  var by = {};
  (ui.docs || []).forEach(function (d) { by[d.id] = d; });
  (cards || []).forEach(function (c) {
    var d = by[c.docId], cl = d && c.cluster != null && d.clusters[c.cluster];
    if (cl && c.title != null && c.title !== cl.title) c.title = cl.title;
  });
  return cards;
}
/* The session and the cards it made are stored in one transaction
   (Store.saveStep), and a failure is SAID, never swallowed: ui.saveError
   puts a banner on every screen until a save succeeds. The step itself
   stays on screen — the whole session is written each time, so the next
   save that works stores everything the failed one did not. save() never
   rejects: a rejected save used to stop go() before it redrew, leaving the
   old screen up with nothing to say why. */
function save() {
  if (!ui.state) return Promise.resolve();
  var at = Date.now();
  ui.sessions[ui.docId] = ui.state; ui.at[ui.docId] = at;
  return Store.saveStep({ id: ui.docId, state: ui.state, at: at }, ui.state.cards)
    .then(function (c) { ui.cards = c; ui.saveError = ''; }, saveFailed);
}
function saveFailed(e) {
  var name = e && e.name, msg = (e && e.message) || String(e || 'unknown error');
  ui.saveError = name === 'QuotaExceededError' ? 'this device is out of space for Memorizer' : msg;
}

/* Days studied, for the streak, in IndexedDB with the units and cards.
   They were in localStorage, and the browser suite measured a whole
   localStorage lost across a reload (1 run in 6, and 1 in 12 reopening in a
   new page — a key the test itself had just written went with it) while
   IndexedDB kept everything. Read from localStorage once, to carry over a
   streak begun before. */
var DAYS_KEY = 'memorizer.days.v1';
function legacyDays() { try { return JSON.parse(root.localStorage.getItem(DAYS_KEY) || '[]'); } catch (_) { return []; } }
function studyDays() { return ui.days || []; }
/* The week's log (study.js logActivity): what was done, when. */
function logActivity(kind, info) {
  ui.activity = Study.logActivity(ui.activity, today(), kind, Object.assign({ now: Date.now() }, info || {}));
  Store.put('meta', { id: 'activity', log: ui.activity }).then(null, function () {});
}
function markStudied() {
  var t = today();
  if (studyDays().indexOf(t) !== -1) return;
  ui.days = studyDays().concat([t]).slice(-400);
  Store.put('meta', { id: 'days', days: ui.days }).then(null, function (e) { saveFailed(e); render(); });
}

function dispatch(event) {
  var before = ui.state && ui.state.phase;
  ui.state = Session.next(ui.state, event);
  if (event.type === 'answered' || event.type === 'examAnswered') {
    markStudied();
    var sp = ui.state.per[ui.state.section], la = event.type === 'answered' && sp && sp.answers[sp.answers.length - 1];
    if (la) logActivity('answer', { correct: la.correct, title: ui.state.titles[ui.state.section], source: 'drill' });
    else if (event.type === 'examAnswered') {
      var er = ui.state.exam.results[ui.state.exam.results.length - 1], eq = er && ui.state.exam.questions[er.q] || {};
      if (er) logActivity('answer', { correct: !!er.correct, title: ui.state.titles[eq.cluster] || '', source: 'exam' });
    }
  }
  if (before === 'drill' && ui.state.phase === 'result' && ui.docRec) afterDrill(ui.docRec, ui.state.section);
  return save();
}
/* A section drilled (study.js): its checks at 1, 3, 7 and 21 days begin,
   and its recall cards are made — cloze cards from its sentences and a
   figure's hidden label — starting tomorrow, so the drill does not end in
   a second drill of the same sentences. */
function afterDrill(d, ci) {
  var key = d.id + ':' + ci;
  if (!ui.checks[key]) { ui.checks[key] = { start: today(), done: [], scores: [] }; saveChecks(); }
  return makeStudyCards(d, ci);
}
function saveChecks() { return Store.put('meta', { id: 'checks', recs: ui.checks }).then(null, function (e) { saveFailed(e); render(); }); }
function makeStudyCards(d, ci) {
  var c = d.clusters[ci];
  var figs = c && d.figures ? Chunk.assignFigures(d.clusters, d.figures)[ci] || [] : [];
  var have = {};
  ui.cards.forEach(function (x) { have[x.id] = true; });
  var from = Study.addDays(today(), 1);
  var fresh = Study.clozeCards(d, ci).concat(d.hasFile ? Study.occlusionCards(d, ci, figs) : []).filter(function (x) { return !have[x.id]; });
  fresh.forEach(function (x) { x.dueFrom = from; });
  return Promise.all(fresh.map(function (x) { return Store.put('cards', x); })).then(function () {
    ui.cards = ui.cards.concat(fresh); return fresh;
  }, function (e) { saveFailed(e); return []; });
}

/* ── the step runner: one place that shows busy, error and retry ────────── */
/* kind is lesson | quiz | exam. The built-in coach answers from `local`
   arguments, Claude from `remote` ones (prompts.js); either answer is held to
   the same schema and rules (Prompts.validate), so a bug in the built-in
   coach is an error on screen, never a bad drill. */
/* A step belongs to the screen that asked for it. stepKey() names that
   screen (unit, section, phase); a reply that arrives after the reader has
   moved on — Claude takes seconds, and Back is one tap — is dropped, not
   filed into whatever section is open by then. That was a real bug: section
   1's lesson, still on its way, arrived as section 2's. `ui.stepSeq` is the
   ticket; render() cancels a step whose screen is no longer showing, so the
   new screen can ask for its own. */
function stepKey() { var s = ui.state; return s ? ui.docId + '|' + s.section + '|' + s.phase : ''; }
function current(seq, key) { return seq === ui.stepSeq && (key == null || key === stepKey()); }
function ask(label, kind, local, remote) {
  var seq = ++ui.stepSeq, key = stepKey();
  ui.busy = label; ui.busyKey = key; ui.error = ''; render();
  var c = cfg();
  var step = !Provider.needsKey(c)
    ? new Promise(function (resolve) {
        var v = Coach[kind].apply(null, local);
        /* the built-in coach may find nothing to drill in a tiny section;
           the session files that as done, with no score */
        var err = kind === 'quiz' && v && v.questions && !v.questions.length ? '' : Prompts.validate(kind, v);
        if (err) throw new Error('the built-in coach produced a malformed ' + kind + ': ' + err);
        resolve(v);
      })
    : Provider.call(c, Prompts[kind].apply(null, remote), kind);
  return step.then(function (v) {
    if (!current(seq, key)) throw STALE;
    ui.busy = ''; return v;
  }, function (e) {
    if (!current(seq, key)) throw STALE;
    ui.busy = ''; ui.error = (e && e.message) || String(e); render();
    throw e;
  });
}
var STALE = { stale: true };
/* Before every redraw: a step still busy for a screen that is not this one
   is let go — its reply will be dropped — and this screen asks afresh. */
function releaseStale() {
  if (ui.busy && ui.busyKey !== stepKey()) { ui.stepSeq++; ui.busy = ''; ui.busyKey = ''; }
}

function cluster(i) { return ui.docRec.clusters[i == null ? ui.state.section : i]; }

/* Advance whatever the current phase needs from a coach, if anything. */
function pump() {
  var s = ui.state;
  if (!s || ui.busy || ui.error) return;
  var c = s.per[s.section];
  /* The unit's pack (pack.js), where it has this section: already checked
     against the book when it was imported, so nothing to ask for. */
  var fromPack = Pack.sectionOf(ui.pack, s.section);
  if (s.phase === 'teach' && !c.lesson && fromPack) {
    dispatch({ type: 'taught', value: JSON.parse(JSON.stringify(fromPack.lesson)) }).then(render);
  } else if (s.phase === 'drill' && !c.quiz && fromPack && fromPack.quiz.questions.length) {
    dispatch({ type: 'quizReady', value: JSON.parse(JSON.stringify(fromPack.quiz)) }).then(render);
  } else if (s.phase === 'teach' && !c.lesson) {
    ask('Preparing the lesson…', 'lesson', [cluster()], [cluster()])
      .then(function (v) { return dispatch({ type: 'taught', value: v }); })
      .then(render, function () {});
  } else if (s.phase === 'drill' && !c.quiz) {
    ask('Writing your questions…', 'quiz', [cluster(), c.lesson, ui.docRec.clusters], [cluster(), c.lesson])
      .then(function (v) {
        if (!builtin() || !aiOn() || !v.questions.length) return v;
        var seq = ui.stepSeq;
        ui.busy = 'Writing harder questions with the on-device AI…'; ui.busyKey = stepKey(); render();
        return aiQuestions(cluster()).then(function (ai) {
          if (!current(seq)) throw STALE;
          ui.busy = '';
          var seen = {};
          var all = ai.concat(v.questions).filter(function (q) { var k = q.question + '|' + q.quote; if (seen[k]) return false; seen[k] = true; return true; });
          return { questions: all.slice(0, Coach.QUIZ_SIZE + ai.length) };
        });
      })
      .then(function (v) { return dispatch({ type: 'quizReady', value: v }); })
      .then(render, function () {});
  } else if (s.phase === 'exam' && !s.exam.questions) {
    var weak = Session.weakest(s, 2), n = Session.examSize(s), lessons = {};
    ui.docRec.clusters.forEach(function (_, i) { lessons[i] = s.per[i].lesson; });
    /* With a pack, the exam asks its questions for the sections it covers
       (pack.js exam) and the built-in coach's for the rest. */
    if (builtin() && Pack.coverage(ui.pack, ui.docRec).have) {
      dispatch({ type: 'examReady', value: Pack.exam(ui.pack, Coach.exam(ui.docRec.clusters, Session.asked(s), weak, n), weak, n) }).then(render);
      return;
    }
    ask('Setting your final exam…', 'exam', [ui.docRec.clusters, Session.asked(s), weak, n], [ui.docRec.clusters, lessons, weak, n])
      .then(function (v) { return dispatch({ type: 'examReady', value: v }); })
      .then(render, function () {});
  }
}

/* ── adding material ─────────────────────────────────────────────────────── */
function newId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
/* One place that turns pages into a unit and stores it. */
function saveUnit(name, source, pages, extra) {
  var blocks = Chunk.blocksFromPages(pages).blocks;
  var clusters = Chunk.clusterBlocks(blocks);
  if (!clusters.length) throw new Error(extra && extra.emptyMessage || 'No readable text was found.');
  var rec = { id: newId(), name: name, addedAt: Date.now(), pages: pages.length, source: source, clusters: clusters,
              scanned: (extra && extra.scanned) || [], figures: (extra && extra.figures) || [], figuresV: Pdf.FIGURES_V, hasFile: !!(extra && extra.bytes),
              ocr: (extra && extra.ocr) || [], ocrError: (extra && extra.ocrError) || '', ocrConf: (extra && extra.ocrConf) || {},
              fingerprint: (extra && extra.fingerprint) || '', fileName: (extra && extra.fileName) || '', processing: processing() };
  var first = extra && extra.bytes ? Store.put('files', { id: rec.id, bytes: extra.bytes }) : Promise.resolve();
  return first.then(function () { return Store.put('docs', rec); }).then(function () { return rec; });
}
/* What read this unit: the build of Memorizer (its data-build stamp, set
   by scripts/build-memorizer.js; 'dev' when run from the repository), the
   PDF reader's version and the figure finder's. Kept with the unit so a
   later fix can tell what it would change. */
function processing() {
  return { build: doc.documentElement.getAttribute('data-build') || 'dev', pdfjs: Pdf.PDFJS_V, figures: Pdf.FIGURES_V };
}
/* The same bytes added again open the unit already here, with its
   progress, rather than starting a second copy of it from nothing. */
function duplicate(fp) {
  var dup = Prov.duplicateOf(ui.docs, fp);
  if (!dup) return false;
  ui.importing = '';
  ui.notice = 'You had already added this as \u201C' + dup.name + '\u201D \u2014 here it is, with your progress. (Start over is in its menu on the home screen.)';
  openDoc(dup.id);
  return true;
}
var DUPLICATE = { duplicate: true };
function finishImport(p) {
  return p.then(function (rec) {
    ui.importing = ''; docsChanged(); return refresh().then(function () { return openDoc(rec.id); });
  }, function (e) {
    if (e === DUPLICATE) return;
    ui.importing = ''; ui.error = (e && e.message) || String(e); render();
  });
}
function importFile(file) {
  if (!file) return;
  ui.importing = 'Opening ' + file.name + '…'; ui.error = ''; render();
  var bytes = null, fp = '';
  finishImport(readBuffer(file).then(function (buf) {
    bytes = buf;
    return Prov.fingerprint(buf);
  }).then(function (f) {
    fp = f;
    if (duplicate(fp)) throw DUPLICATE;
    return Pdf.read(bytes, function (n, total, pass) {
      ui.importing = pass === 'ocr' ? 'Reading scanned page ' + n + ' of ' + total + ' with text recognition…' : 'Reading page ' + n + ' of ' + total + '…';
      render();
    }, function (msg) { ui.importing = msg; render(); });
  }).then(function (r) {
    ui.importing = 'Splitting into sections…'; render();
    return saveUnit(file.name.replace(/\.pdf$/i, ''), 'pdf', r.pages, {
      fingerprint: fp, fileName: file.name, bytes: bytes, figures: r.figures || [], scanned: Chunk.scannedPages(r.wordCounts), ocr: r.ocr, ocrError: r.ocrError, ocrConf: r.ocrConf || {},
      emptyMessage: r.ocrError
        ? 'No readable text in this PDF. It looks like a scan (pictures of pages), and the text reader for scans could not run: ' + r.ocrError
        : 'No readable text in this PDF, even with text recognition. If it is a scan, it may be too faint or too small to read.',
    });
  }));
}
/* Photos of pages, in the order chosen: each read by text recognition. */
function importPhotos(files) {
  var list = Array.prototype.slice.call(files || []);
  if (!list.length) return;
  ui.error = '';
  var pages = [], conf = {}, chain = Promise.resolve();
  list.forEach(function (f, i) {
    chain = chain.then(function () { ui.importing = 'Reading photo ' + (i + 1) + ' of ' + list.length + '…'; render(); return Ocr.readImage(f, function (m) { ui.importing = m; render(); }); })
      .then(function (r) { if (r.items.confidence) conf[i + 1] = r.items.confidence; pages.push({ page: i + 1, lines: Pdf.linesOf(r.items, r.height) }); });
  });
  finishImport(chain.then(function () {
    return saveUnit('Photos ' + new Date().toLocaleDateString(), 'photo', pages,
      { ocr: pages.map(function (p) { return p.page; }), ocrConf: conf, emptyMessage: 'No text could be read from those photos. Try a sharper, well-lit photo of the page.' });
  }));
}
function importText(name, text) {
  ui.importing = 'Splitting into sections…'; ui.error = ''; render();
  finishImport(Prov.fingerprint(String(text || '')).then(function (fp) {
    if (duplicate(fp)) throw DUPLICATE;
    return saveUnit(name || 'Pasted notes', 'text', Chunk.pagesFromText(text), { fingerprint: fp, emptyMessage: 'There was no text to learn from.' });
  }));
}

/* ── a whole book ────────────────────────────────────────────────────────── */
/* The book's name: what its parts' names share, without the page numbers
   ("Topol_1-500", "Topol_501-1000" → "Topol"). */
function bookName(files) {
  var names = files.map(function (f) { return f.name.replace(/\.pdf$/i, ''); });
  var pre = names.reduce(function (a, b) { var i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
  pre = pre.replace(/[\s_\-\d.,]+$/, '').trim();
  return pre.length >= 2 ? pre.replace(/_/g, ' ') : names[0];
}
/* Chapters → units. A chapter whose pages are unchanged keeps its unit, and
   so its progress and cards, whatever it is now called (cutting by another
   method renames chapters); the others are built from the book's stored
   text, and units no chapter uses any more are deleted. */
function applyChapters(book, chapters, pages) {
  var old = {};
  (book.chapters || []).forEach(function (c) { if (c.docId) old[c.pageStart + ':' + c.pageEnd] = c.docId; });
  var keep = {}, now = Date.now(), num = 0;
  var puts = chapters.map(function (c, i) {
    var k = c.pageStart + ':' + c.pageEnd, label = c.front ? 0 : ++num;
    if (old[k]) {
      keep[old[k]] = true;
      return Store.get('docs', old[k]).then(function (d) {
        return d && (d.name !== c.title || d.chapter !== label) ? Store.put('docs', Object.assign(d, { name: c.title, chapter: label })) : null;
      }).then(function () { return Object.assign({}, c, { docId: old[k] }); });
    }
    var mine = pages.filter(function (p) { return p.page >= c.pageStart && p.page <= c.pageEnd; });
    var clusters = Chunk.clusterBlocks(Chunk.blocksFromPages(Book.stripHeaders(mine)).blocks);
    if (!clusters.length) return Promise.resolve(Object.assign({}, c, { docId: null, empty: true }));
    var id = book.id + ':c' + c.pageStart + '-' + c.pageEnd;
    keep[id] = true;
    var rec = { id: id, name: c.title, bookId: book.id, bookName: book.name, chapter: label, addedAt: now - i, pages: c.pageEnd - c.pageStart + 1,
                pageStart: c.pageStart, pageEnd: c.pageEnd, source: 'pdf', clusters: clusters, hasFile: true, parts: book.parts, figures: null,
                scanned: (book.scanned || []).filter(function (n) { return n >= c.pageStart && n <= c.pageEnd; }),
                ocr: (book.ocr || []).filter(function (n) { return n >= c.pageStart && n <= c.pageEnd; }), ocrError: book.ocrError || '' };
    return Store.put('docs', rec).then(function () { return Object.assign({}, c, { docId: id }); });
  });
  return Promise.all(puts).then(function (list) {
    var gone = Object.keys(old).map(function (k) { return old[k]; }).filter(function (id) { return !keep[id]; });
    return Promise.all(gone.map(function (id) { return Store.deleteDoc(id); })).then(function () {
      book.chapters = list;
      docsChanged();
      return Store.put('books', book);
    });
  });
}
function bookPages(book) {
  return Promise.all(book.parts.map(function (_, i) { return Store.get('bookpages', book.id + ':' + i); }))
    .then(function (r) { return r.reduce(function (all, x) { return all.concat(x ? x.pages : []); }, []); });
}
function importBook(fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  files = Book.orderParts(files.map(function (f) { return f.name; })).map(function (i) { return files[i]; });
  var book = { id: 'b' + newId().slice(1), name: bookName(files), addedAt: Date.now(), parts: [], scanned: [], ocr: [], ocrError: '', outline: [] };
  var all = [], offset = 0;
  ui.error = '';
  var chain = Promise.resolve();
  files.forEach(function (f, k) {
    var bytes;
    chain = chain.then(function () {
      ui.importing = 'Part ' + (k + 1) + ' of ' + files.length + ': opening ' + f.name + '…'; render();
      return readBuffer(f);
    }).then(function (buf) {
      bytes = buf;
      return Pdf.read(buf, function (n, total, pass) {
        ui.importing = 'Part ' + (k + 1) + ' of ' + files.length + ': ' + (pass === 'ocr' ? 'text recognition, scanned page ' : 'reading page ') + n + ' of ' + total + '…';
        render();
      }, function (msg) { ui.importing = msg; render(); }, { figures: false });
    }).then(function (r) {
      var fileId = book.id + ':f' + k;
      var pages = r.pages.map(function (p) { return { page: p.page + offset, lines: p.lines }; });
      book.parts.push({ fileId: fileId, name: f.name, first: offset + 1, last: offset + r.numPages });
      r.outline.forEach(function (e) { book.outline.push({ title: e.title, page: e.page + offset, depth: e.depth }); });
      Chunk.scannedPages(r.wordCounts).forEach(function (n) { book.scanned.push(n + offset); });
      r.ocr.forEach(function (n) { book.ocr.push(n + offset); });
      if (r.ocrError) book.ocrError = r.ocrError;
      all = all.concat(pages);
      offset += r.numPages;
      return Promise.all([Store.put('files', { id: fileId, bytes: bytes }), Store.put('bookpages', { id: book.id + ':' + k, pages: pages })]);
    });
  });
  chain.then(function () {
    ui.importing = 'Finding the chapters…'; render();
    book.pages = offset;
    var c = Book.candidates(all, book.outline, offset);
    book.method = Book.pick(c, offset);
    book.found = {};
    Book.METHODS.forEach(function (m) { book.found[m] = c[m].filter(function (x) { return !x.front; }).length; });
    ui.importing = 'Splitting ' + c[book.method].length + ' chapters into sections…'; render();
    return applyChapters(book, c[book.method], all);
  }).then(function () {
    ui.importing = ''; return refresh().then(function () { openBook(book.id); });
  }, function (e) {
    ui.importing = ''; ui.error = (e && e.message) || String(e); render();
  });
}
function openBook(id) {
  ui.view = 'book'; ui.bookId = id; ui.error = ''; ui.state = null;
  refresh().then(function () { render(); root.scrollTo(0, 0); });
}
/* Cut the book again: by another method, or with one chapter joined to the
   one before. Chapters left as they were keep their progress. */
function recut(book, chapters, method) {
  ui.importing = 'Cutting the chapters again…'; render();
  return bookPages(book).then(function (pages) {
    if (method) book.method = method;
    return applyChapters(book, chapters || Book.candidates(pages, book.outline, book.pages)[book.method], pages);
  }).then(function () { ui.importing = ''; return refresh(); }).then(render, function (e) {
    ui.importing = ''; ui.error = (e && e.message) || String(e); render();
  });
}

function openDoc(id, section) {
  return Promise.all([Store.get('docs', id), Store.get('sessions', id), Store.get('packs', id)]).then(function (r) {
    ui.docRec = r[0];
    if (ui.docRec) retitleDoc(ui.docRec);
    ui.docId = id;
    ui.pack = r[2] || null; ui.packReport = null; ui.packText = ''; ui.packOpen = false; ui.packShow = false;
    var st = r[1] && r[1].state;
    ui.state = Session.resumable(st) ? st : Session.init(id, ui.docRec.clusters.map(function (c) { return c.title; }));
    if (ui.state.titles && ui.state.titles.length === ui.docRec.clusters.length) ui.state.titles = ui.docRec.clusters.map(function (c) { return c.title; });
    ui.state = Session.next(ui.state, { type: 'toUnit' });
    if (typeof section === 'number') ui.state = Session.next(ui.state, { type: 'open', section: section });
    ui.view = 'session'; ui.error = ''; ui.choice = null;
    ensureFigures(ui.docRec);
    return save();
  }).then(function () { render(); root.scrollTo(0, 0); });
}
/* One transition at a time. A second tap before the first has been stored
   and drawn lands on the OLD screen's button: on "I knew it" that skipped a
   memorise card, and on Next it filed an answer with no choice. While a
   step is being stored, taps are ignored. */
function go(event) {
  if (ui.moving) return Promise.resolve();
  ui.moving = true;
  ui.choice = null; ui.sure = false; ui.error = ''; ui.back = 0; ui.notice = '';
  var p;
  try { p = dispatch(event); } catch (e) { ui.moving = false; throw e; }
  return p.then(function () { ui.moving = false; render(); root.scrollTo(0, 0); });
}

/* ── speech: the lesson can be listened to ───────────────────────────────── */
function speak(text) {
  if (!root.speechSynthesis) return;
  root.speechSynthesis.cancel();
  var u = new root.SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  root.speechSynthesis.speak(u);
}

/* Blob.arrayBuffer() fallback, Mermaid and the flow drawing, as before. */
/* Blob.arrayBuffer() is Safari 14; FileReader is everywhere. */
function readBuffer(file) {
  if (file.arrayBuffer) return file.arrayBuffer();
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { reject(r.error || new Error('could not read the file')); };
    r.readAsArrayBuffer(file);
  });
}
function readText(file) {
  if (file.text) return file.text();
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { reject(r.error || new Error('could not read the file')); };
    r.readAsText(file);
  });
}
/* ── mermaid, loaded only when a flowchart is first shown ────────────────── */
var mermaidP = null;
function mermaid() {
  if (mermaidP) return mermaidP;
  mermaidP = new Promise(function (resolve, reject) {
    var s = doc.createElement('script');
    s.src = MERMAID.url; s.integrity = MERMAID.sri; s.crossOrigin = 'anonymous';
    s.onload = function () {
      var dark = root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches;
      root.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral' });
      resolve(root.mermaid);
    };
    s.onerror = function () { mermaidP = null; reject(new Error('offline')); };
    doc.head.appendChild(s);
  });
  return mermaidP;
}
var chartSeq = 0;
function flowchart(code) {
  var box = h('div.chart', h('p.muted', 'Drawing the diagram…'));
  var fallback = function () { box.textContent = ''; box.appendChild(h('pre.chart-src', code)); };
  mermaid().then(function (M) {
    return M.render('mchart' + (++chartSeq), code).then(function (out) {
      box.innerHTML = out.svg;
    });
  }).catch(fallback);
  return box;
}

/* A flowchart as boxes and arrows, drawn as HTML so it works offline and in
   every theme. From the built-in coach's flow, or from a simple Mermaid chart
   Claude wrote. */
function drawFlow(f) {
  var label = {};
  f.nodes.forEach(function (n) { label[n.id] = n.label; });
  function draw(t, root) {
    var box = h('div.flow-node' + (root ? '.root' : '') + (t.again ? '.again' : ''), label[t.id]);
    if (!t.next.length) return h('div.flow-tree', box);
    var kids = t.next.map(function (b) { return h('div.flow-branch', h('div.flow-arrow', b.verb), draw(b.node, false)); });
    return h('div.flow-tree', box, kids.length > 1 ? h('div.flow-fork', kids) : kids[0]);
  }
  return h('div.flow', Coach.tree(f).map(function (t) { return draw(t, true); }));
}
/* Mermaid's simple forms: A["x"] --> B["y"], A -->|label| B, A -- label --> B. */
function parseMermaid(code) {
  var labels = {}, edges = [];
  var node = /([A-Za-z0-9_]+)\s*(?:\[\s*"?([^"\]]*)"?\s*\]|\(\s*"?([^")]*)"?\s*\)|\{\s*"?([^"}]*)"?\s*\})?/;
  String(code || '').split(/\n|;/).forEach(function (line) {
    var m = /^\s*(.+?)\s*(?:--\s*([^->|]+?)\s*-->|-->\s*\|([^|]*)\||-->|==>|-\.->)\s*(.+?)\s*$/.exec(line);
    if (!m) return;
    var a = node.exec(m[1]), b = node.exec(m[4]);
    if (!a || !b) return;
    [a, b].forEach(function (x) { var l = x[2] || x[3] || x[4]; if (l) labels[x[1]] = l; else if (!labels[x[1]]) labels[x[1]] = x[1]; });
    edges.push({ from: a[1], to: b[1], verb: (m[2] || m[3] || '').trim() });
  });
  var ids = Object.keys(labels);
  return { nodes: ids.map(function (id) { return { id: id, label: labels[id] }; }), edges: edges };
}
function tableRoundButton(c) {
  return button('Quiz me on this table', function () { ui.view = 'ask'; render(); askNow('quiz me on the table in ' + c.title); }, 'quiet', { id: 'table-round' });
}
function tablesCard(c) {
  var segs = c.segments.filter(function (g) { return g.table; });
  if (!segs.length) return null;
  return h('div.card', { id: 'tables' }, h('span.eyebrow', 'Tables'), segs.map(function (g) {
    var headRow = g.tableHeader || g.table[0];
    var body = g.tableHeader ? g.table : g.table.slice(1);
    return [h('div.table-wrap', h('table.data',
        h('thead', h('tr', headRow.map(function (x) { return h('th', { scope: 'col' }, x); }))),
        h('tbody', body.map(function (r) { return h('tr', r.map(function (x, i) { return i === 0 ? h('th', { scope: 'row' }, x) : h('td', x); })); })))),
      h('p.muted.table-cap', 'Table', page(g.page), g.tableHeader ? ' · continued' : '')];
  }), h('div.row', tableRoundButton(c)));
}

/* Figures and pages are drawn from the PDF kept on this device. A chapter
   of a book names its book's parts; a page is drawn from the part holding
   it, at that file's own page number. One file's bytes are kept at a time. */
function where(d, pageNo) {
  return d && d.parts ? Book.locate(d.parts, pageNo) : { fileId: d ? d.id : ui.docId, page: pageNo };
}
function withBytes(fileId) {
  if (ui.bytesFor === fileId) return Promise.resolve(ui.bytes);
  return Store.get('files', fileId).then(function (f) { ui.bytesFor = fileId; ui.bytes = f && f.bytes; return ui.bytes; });
}
function lazyImage(alt, pageNo, box, scale, d) {
  var img = h('img', { alt: alt });
  var at = where(d || ui.docRec, pageNo);
  (at ? withBytes(at.fileId) : Promise.resolve(null)).then(function (bytes) {
    if (!bytes) throw new Error('no file');
    return Pdf.renderBox(at.fileId, bytes, at.page, box, scale);
  }).then(function (url) { img.src = url; }, function () { img.alt = alt + ' (could not be drawn)'; });
  return img;
}
/* A book's chapter finds its figures the first time it is opened: looking
   through 1,500 pages at import would take far longer than the text. And
   any PDF whose figures were found by an older finder (figuresV behind
   Pdf.FIGURES_V) looks again, so a fix to the finder reaches what is
   already on the device. */
function ensureFigures(d) {
  if (!d || !d.hasFile || (d.figures && d.figuresV === Pdf.FIGURES_V) || ui.figuresBusy === d.id) return;
  var byFile = {};
  for (var pn = d.bookId ? d.pageStart : 1, last = d.bookId ? d.pageEnd : d.pages; pn <= last; pn++) {
    var at = where(d, pn);
    if (at) (byFile[at.fileId] = byFile[at.fileId] || []).push(at.page);
  }
  var found = [];
  ui.figuresBusy = d.id;
  Object.keys(byFile).reduce(function (p, fileId) {
    var first = d.parts ? d.parts.filter(function (pt) { return pt.fileId === fileId; })[0].first : 1;
    return p.then(function () { return withBytes(fileId); }).then(function (bytes) {
      return bytes ? Pdf.figuresOn(fileId, bytes, byFile[fileId]) : [];
    }).then(function (fs) { fs.forEach(function (f) { f.page = f.page + first - 1; found.push(f); }); });
  }, Promise.resolve()).then(function () {
    d.figures = found; d.figuresV = Pdf.FIGURES_V;
    return Store.put('docs', d);
  }).then(function () {
    ui.figuresBusy = null; ui.figsFor = null;
    ui.docs.forEach(function (x, i) { if (x.id === d.id) ui.docs[i] = d; });
    if (ui.docRec && ui.docRec.id === d.id) { ui.docRec = d; render(); }
  }, function () { ui.figuresBusy = null; d.figures = []; });
}
/* Modal, with focus managed (dialog.js): in on open, kept inside, given
   back to the button that opened it on close. */
function lightbox(pageNo, box, name) {
  var close = function () { closeFn(); };
  var where = (box ? (name || 'Figure') + ' · ' : '') + 'page ' + pageNo + (ui.docRec && ui.docRec.name ? ' of ' + ui.docRec.name : '');
  var el = h('div.lightbox', { 'aria-label': name || 'Page ' + pageNo },
    lazyImage('Page ' + pageNo + (box ? ' figure' : ''), pageNo, box, 2.5),
    h('p.muted.lb-where', { id: 'lb-where' }, where),
    button('Close', close, 'primary', { 'data-autofocus': true, id: 'lb-close' }));
  el.setAttribute('aria-describedby', 'lb-where');
  var closeFn = Dialog.open(el, doc.getElementById('app'));
}
/* The figures a section uses: the ones its text names, else the ones on its
   pages (chunk.js's assignFigures). Worked out once per unit opened. */
function figuresOf(c) {
  var d = ui.docRec;
  if (ui.figsFor !== d) { ui.figsFor = d; ui.figs = Chunk.assignFigures(d.clusters, d.figures || []); }
  return ui.figs[c.index] || [];
}
function visualsCard(c) {
  var d = ui.docRec;
  if (!d.hasFile) {
    /* photos and pasted text have no PDF pages to show */
    if (d.source && d.source !== 'pdf') return null;
    return h('div.card', h('span.eyebrow', 'Figures and pages'),
      h('p.muted', 'This PDF was added before figures and pages could be shown. Delete it and add it again to see them here.'));
  }
  if (ui.figuresBusy === d.id) return h('div.card', { id: 'visuals' }, h('span.eyebrow', 'Figures and pages'),
    h('p.muted', { role: 'status' }, 'Finding the figures in this chapter…'));
  var figs = figuresOf(c);
  var pages = [];
  for (var pn = c.pageStart; pn <= c.pageEnd && pages.length < 6; pn++) pages.push(pn);
  return h('div.card', { id: 'visuals' },
    figs.length ? fold('figures', 'Figures', figs.length, h('div.figs', figs.map(function (f, i) {
      var name = f.label || 'Figure ' + (i + 1);
      return h('figure.fig', h('button', { type: 'button', 'aria-label': 'Enlarge ' + name, onclick: function () { lightbox(f.page, f.box, name); } },
        lazyImage(f.caption || name + ', page ' + f.page, f.page, f.box, 2)),
        h('figcaption', f.caption ? h('span.fig-cap', f.caption) : name, ' ', page(f.page)));
    }))) : null,
    fold('pages', 'The pages', pages.length, [
      h('p.muted', 'Everything as printed — tables, charts and diagrams included. Tap to enlarge.'),
      h('div.pages', pages.map(function (pn) {
        return h('figure.fig', h('button', { type: 'button', 'aria-label': 'Open page ' + pn, onclick: function () { lightbox(pn, null); } },
          lazyImage('Page ' + pn, pn, null, 0.5)), h('figcaption', 'Page ' + pn));
      }))]));
}
/* A part of a card the reader can minimise — figures, pages — with a − / +
   button in its head. Minimised stays minimised, for every section, and
   across visits on this device (a convenience: lost storage just opens it). */
var FOLD_KEY = 'memorizer.folds.v1';
function folds() {
  if (!ui.folds) { try { ui.folds = JSON.parse(root.localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (_) { ui.folds = {}; } }
  return ui.folds;
}
function fold(key, title, n, body) {
  var shut = folds()[key] === false;
  /* The tap sets both the element and the remembered state at once; the
     browser's own 'toggle' event comes later, after a redraw may already
     have read the old state. */
  var el = h('details.fold', { id: 'fold-' + key, open: shut ? null : true },
    h('summary.fold-head', { onclick: function (e) {
      e.preventDefault();
      el.open = !el.open;
      folds()[key] = el.open;
      try { root.localStorage.setItem(FOLD_KEY, JSON.stringify(ui.folds)); } catch (_) {}
    } }, h('span.eyebrow', title + ' (' + n + ')'), h('span.fold-btn', { 'aria-hidden': 'true' })),
    body);
  return el;
}


/* ── shared pieces ───────────────────────────────────────────────────────── */
/* A page reference. In a unit whose PDF is on the device, it opens that
   page as printed (phase 2: "page references that open the PDF page"). */
function page(n) {
  if (n == null) return null;
  var d = ui.view === 'session' && ui.docRec;
  var first = d && (d.bookId ? d.pageStart : 1), lastP = d && (d.bookId ? d.pageEnd : d.pages);
  if (!d || !d.hasFile || !(n >= first && n <= lastP)) return h('span.pg', 'p.' + n);
  return h('button.pg.pg-open', { type: 'button', 'aria-label': 'Open page ' + n, title: 'Open page ' + n,
    onclick: function (e) { e.preventDefault(); e.stopPropagation(); lightbox(n, null); } }, 'p.' + n);
}
function button(label, onclick, cls, attrs) {
  var a = attrs || {};
  a.onclick = onclick; a.type = 'button';
  return h('button.btn' + (cls ? '.' + cls : ''), a, label);
}
function busyCard() {
  return h('div.card.busy', { role: 'status', 'aria-live': 'polite' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', ui.busy));
}
function errorCard(retry) {
  return h('div.card.error', { role: 'alert' },
    h('strong', 'That step did not work.'), h('p', ui.error),
    h('div.row', retry ? button('Try again', function () { ui.error = ''; retry(); }, 'primary') : null,
      !hasKey() ? button('Open Settings', function () { ui.view = 'settings'; ui.error = ''; render(); }) : null));
}
/* A progress ring: `pct` 0..100, drawn still. */
function ring(pct, size) {
  var r = 16, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
  var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('class', 'ring' + (size ? ' ring-' + size : '')); svg.setAttribute('aria-hidden', 'true');
  [['track', c], ['fill', c * (1 - p / 100)]].forEach(function (x) {
    var e = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    e.setAttribute('cx', '20'); e.setAttribute('cy', '20'); e.setAttribute('r', String(r)); e.setAttribute('class', x[0]);
    if (x[0] === 'fill') { e.setAttribute('stroke-dasharray', c.toFixed(2)); e.setAttribute('stroke-dashoffset', x[1].toFixed(2)); }
    svg.appendChild(e);
  });
  return h('span.ring-wrap', svg, h('span.ring-pct', Math.round(p) + '%'));
}
/* Text with the numbers that carry units marked, so values stand out. */
function marked(text) {
  return Home.marks(text).map(function (r) { return r.num ? h('mark', r.text) : r.text; });
}
var HUES = [190, 150, 260, 30, 330, 210, 100, 0, 280, 50];
function hue(i) { return HUES[i % HUES.length]; }
/* A still ECG trace across the foot of the hero, drawn by CSS when motion
   is allowed (stroke-dashoffset), shown whole when it is not. */
function heroTrace() {
  var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 600 48'); svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'hero-trace'); svg.setAttribute('aria-hidden', 'true');
  var p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', Home.tracePath(600, 5)); p.setAttribute('pathLength', '1');
  svg.appendChild(p);
  return svg;
}
function mascot() {
  var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('class', 'mascot'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6FA8"/><stop offset="1" stop-color="#7A5CFF"/></linearGradient></defs>' +
    '<path d="M32 56 C12 42 4 32 4 21 C4 12 11 6 19 6 C25 6 29 9 32 13 C35 9 39 6 45 6 C53 6 60 12 60 21 C60 32 52 42 32 56Z" fill="url(#mg)"/>' +
    '<circle cx="23" cy="24" r="3.2" fill="#1B1330"/><circle cx="41" cy="24" r="3.2" fill="#1B1330"/>' +
    '<path d="M25 33 Q32 39 39 33" stroke="#1B1330" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
    '<path d="M6 30 h9 l3 -6 l4 12 l3 -6 h9" stroke="#FFFFFF" stroke-opacity=".85" stroke-width="2" fill="none" stroke-linejoin="round"/>';
  return svg;
}

/* The pearl's mark: a cut gem, faceted, in the accent with a light edge. */
function gemIcon() {
  var e = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  e.setAttribute('viewBox', '0 0 32 28'); e.setAttribute('class', 'gem-icon'); e.setAttribute('aria-hidden', 'true');
  e.innerHTML = '<path class="gem-body" d="M7 2h18l6 8-15 17L1 10z"/>' +
    '<path class="gem-facet" d="M1 10h30M11 2l-3 8 8 17 8-17-3-8M8 10l8-8 8 8"/>' +
    '<path class="gem-shine" d="M9 4.5l-2.6 3.7"/>';
  return e;
}

/* ── HOME ────────────────────────────────────────────────────────────────── */
function homeParts() {
  var sessions = ui.sessions || {};
  var day = today();
  var due = Session.dueCards(ui.cards, day).length;
  var sk = Study.streak(studyDays(), day), streak = sk.n;
  var frozenNow = sk.frozen.filter(function (f) { return Study.weekOf(f) === Study.weekOf(day); });

  var pdfIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', id: 'pdf-input', class: 'visually-hidden',
    onchange: function (e) { importFile(e.target.files[0]); e.target.value = ''; } });
  var photoIn = h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'photo-input', class: 'visually-hidden',
    onchange: function (e) { importPhotos(e.target.files); e.target.value = ''; } });
  var bookIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, id: 'book-input', class: 'visually-hidden',
    onchange: function (e) { importBook(e.target.files); e.target.value = ''; } });

  /* The hero band: who it is for, today, and three numbers that matter —
     days in a row, cards due, and how much of what you have studied is held
     (FSRS says 90% or better today). A trace runs along its foot. */
  var prog = Home.progress(ui.docs, sessions, ui.cards, day, FSRS);
  var cur = Home.current(ui.docs.filter(function (d) { return !d.bookId || ui.at[d.id]; }), sessions);
  var top = h('header.home-top.home-hero', { id: 'home-hero' },
    /* Systole's live strip (monitor.js); the still trace where it is absent */
    Monitor ? Monitor.mount(doc, reducedMotion) : heroTrace(),
    h('div.home-brand', mascot(), h('div', h('span.hello', Home.greeting(new Date().getHours()) + ' · what shall we'), h('h1.learn', 'Learn?'),
      h('p.hero-line', cur ? [h('span.hero-dot', { 'aria-hidden': 'true' }), 'Up next: ', h('strong', cur.doc.name), cur.next ? ' · ' + cur.next : ''] : 'Add a chapter of your book to begin.'),
      /* under the line that names it, small: the trace keeps the band's foot */
      cur ? h('div.row.hero-continue', button([h('span', { 'aria-hidden': 'true' }, '\u25B6 '), cur.started ? 'Continue: ' + cur.doc.name : 'Start: ' + cur.doc.name],
        function () { openDoc(cur.doc.id); }, 'tonal', { id: 'continue' })) : null)),
    h('div.pills.hero-stats',
      h('span.pill.stat', { id: 'streak', title: 'Days in a row' + (frozenNow.length ? ' — a missed day this week was forgiven (one a week)' : '') }, h('span.stat-label', 'Streak'), h('span', h('span', { 'aria-hidden': 'true' }, '🔥'),
        frozenNow.length ? h('span.freeze', { id: 'streak-freeze', 'aria-label': 'one missed day forgiven this week' }, '🧊') : null), ' ' + streak),
      h('button.pill.stat', { type: 'button', id: 'pill-due', onclick: function () { startReview(); } }, h('span.stat-label', 'Review'), h('span', { 'aria-hidden': 'true' }, '↻'), ' ' + due + ' due'),
      /* What the ring measures, said where it is shown: the share of review
         cards FSRS expects you to recall today with 90% odds or better. It is
         the scheduler's estimate about the cards — not how much of the book
         you know — and the old one-word "Held" let it read as the latter. */
      h('span.pill.stat.stat-ring', { id: 'stat-held', role: 'img',
          'aria-label': prog.heldPct + '% of your ' + prog.cards + ' review card' + (prog.cards === 1 ? '' : 's') + ' likely recalled today (estimated recall of 90% or more)',
          title: 'Likely recalled: of your ' + prog.cards + ' review card' + (prog.cards === 1 ? '' : 's') + ', the share the scheduler (FSRS) estimates you would recall today with 90% odds or better. An estimate about the cards, not a measure of how much of the book you know.' },
        ring(prog.heldPct), h('span.stat-label', 'Likely recalled'))));

  var drop = h('label.learn-box', { for: 'pdf-input', id: 'door-add',
      ondragover: function (e) { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: function () { drop.classList.remove('over'); },
      ondrop: function (e) { e.preventDefault(); drop.classList.remove('over'); importFile(e.dataTransfer.files[0]); } },
    h('span.learn-prompt', ui.importing || 'I want to learn… add a chapter of your book'),
    h('span.learn-plus', { 'aria-hidden': 'true' }, ui.importing ? '…' : '+'));
  var chips = h('div.chips',
    h('label.chip', { for: 'pdf-input' }, h('span', { 'aria-hidden': 'true' }, '⬆'), ' Upload PDF'),
    h('label.chip', { for: 'book-input' }, h('span', { 'aria-hidden': 'true' }, '📚'), ' Whole book'),
    h('label.chip', { for: 'photo-input' }, h('span', { 'aria-hidden': 'true' }, '📷'), ' Photo'),
    button([h('span', { 'aria-hidden': 'true' }, '📋'), ' Paste'], function () { ui.pasting = true; render(); }, 'chip', { id: 'chip-paste' }));

  var paste = ui.pasting ? h('div.card.paste', { id: 'paste' },
    h('h2', 'Paste your notes'),
    h('input', { id: 'paste-name', placeholder: 'Name, e.g. Aortic stenosis notes', 'aria-label': 'Name' }),
    h('textarea', { id: 'paste-text', rows: 8, placeholder: 'Paste text here. A short line on its own becomes a section heading.', 'aria-label': 'Text' }),
    h('div.row', button('Split into sections', function () {
      var t = doc.getElementById('paste-text').value, n = doc.getElementById('paste-name').value.trim();
      ui.pasting = false; importText(n, t);
    }, 'primary', { id: 'paste-go' }), button('Cancel', function () { ui.pasting = false; render(); }, 'quiet'))) : null;

  /* A book's chapters join "jump back in" once opened: a new book is not
     a hundred units begun. */
  var recent = Home.recent(ui.docs.filter(function (d) { return !d.bookId || ui.at[d.id]; }), sessions, ui.at, 6);
  var jump = recent.length ? [h('div.section-head', h('h2', 'Jump back in')),
    h('div.jump', { id: 'jump' }, recent.map(function (r) {
      return h('button.jump-card', { type: 'button', onclick: function () { openDoc(r.doc.id); } },
        ring(r.pct), h('span.jump-text', h('strong', r.doc.name), h('span.muted', r.next)));
    }))] : null;

  var spots = Home.weakSpots(ui.docs, sessions, ui.cards, Session.mastery, 3);
  var weak = spots.length ? [h('div.section-head', h('h2', 'Needs work')),
    h('ul.weak-list.card', { id: 'weak' }, spots.map(function (w) {
      return h('li',
        h('div.weak-what', h('strong', w.title), h('span.muted', (ui.docs.length > 1 ? w.docName + ' · ' : '') + w.pct + '% on the drill')),
        h('div.row', button('Relearn', function () { openDoc(w.docId, w.cluster); }, 'quiet'),
          w.cards ? button('Drill · ' + w.cards, function () { startDrill(w); }, '', { 'aria-label': 'Drill the ' + w.cards + ' card' + (w.cards === 1 ? '' : 's') + ' from ' + w.title }) : null));
    }))] : null;

  /* Worked out once per day and per "Another": over a whole book it reads
     every chapter's prose. */
  var pkey = day + '|' + (ui.pearlSkip || 0);
  if (!ui.pearlCache || ui.pearlCache.key !== pkey) ui.pearlCache = { key: pkey, pk: ui.docs.length ? Home.pearlOf(ui.docs, Pearl, day, ui.pearlSkip || 0, Coach.yieldOf) : null };
  var pk = ui.pearlCache.pk;
  /* The pearl is the feature of the page: larger, and with its own
     section's figure or table beside it (Home.pearlVisual), so the fact is
     seen as well as read. */
  var pdoc = pk ? ui.docs.filter(function (d) { return d.id === pk.pearl.docId; })[0] : null;
  var vis = pk && pdoc ? Home.pearlVisual(pdoc, pk.pearl, Chunk) : null;
  var visual = null;
  if (vis && vis.kind === 'figure') {
    visual = h('figure.pearl-visual', { id: 'pearl-visual', 'data-kind': 'figure' },
      h('button.pearl-fig', { type: 'button', 'aria-label': 'Enlarge the figure', onclick: function () { ui.docRec = pdoc; lightbox(vis.page, vis.box); } },
        lazyImage(vis.caption || 'Figure, page ' + vis.page, vis.page, vis.box, 2, pdoc)),
      h('figcaption', vis.caption ? h('span.fig-cap', vis.caption) : (vis.number ? 'Figure ' + vis.number : 'Figure'), ' ', page(vis.page)));
  } else if (vis && vis.kind === 'table') {
    visual = h('figure.pearl-visual', { id: 'pearl-visual', 'data-kind': 'table' },
      h('div.table-wrap', h('table.data', vis.header ? h('thead', h('tr', vis.header.map(function (x) { return h('th', x); }))) : null,
        h('tbody', vis.rows.map(function (r) { return h('tr', r.map(function (x) { return h('td', x); })); })))),
      h('figcaption', 'Table', vis.more ? ' \u00B7 ' + vis.more + ' more row' + (vis.more === 1 ? '' : 's') : '', ' ', page(vis.page)));
  }
  var pearl = pk ? h('aside.pearl.card' + (visual ? '.with-visual' : ''), { id: 'pearl', 'aria-labelledby': 'pearl-label' },
    h('div.pearl-main',
      /* its name is a gem, not a label (the owner: "just an icon of pearls
         or diamond"); a screen reader still hears "Pearl of the day" */
      h('span.eyebrow.pearl-mark', { id: 'pearl-label', title: 'Pearl of the day' }, gemIcon(), h('span.visually-hidden', 'Pearl of the day')),
      pearlSteps(pk),
      h('p.pearl-src', pk.pearl.heading, pk.pearl.page ? page(pk.pearl.page) : null, ui.docs.length > 1 ? ' · ' + pk.pearl.docName : ''),
      h('div.row.pearl-actions',
        pdoc ? button('Open the section', function () { openDoc(pdoc.id, pdoc.clusters.map(function (c) { return c.index; }).indexOf(pk.pearl.cluster)); }, 'tonal', { id: 'pearl-open' }) : null,
        pk.of > 1 ? button('Another', function () { ui.pearlSkip = (ui.pearlSkip || 0) + 1; render(); }, 'quiet', { id: 'pearl-next' }) : null)),
    visual) : null;

  var books = ui.books.map(function (b, i) {
    var ds = b.chapters.filter(function (c) { return c.docId; }).map(function (c) { return ui.docs.filter(function (d) { return d.id === c.docId; })[0]; }).filter(Boolean);
    var pct = ds.length ? Math.round(ds.reduce(function (n, d) { return n + Home.unitPct(d, sessions[d.id]); }, 0) / ds.length) : 0;
    return h('li.unit-row.book-row', { style: '--hue:' + hue(i + 3) },
      h('button.unit-open', { type: 'button', onclick: function () { openBook(b.id); } },
        h('strong.doc-name', b.name),
        h('span.muted', Home.count(b.chapters.filter(function (c) { return !c.front; }).length, 'chapter') + ' · ' + Home.count(b.pages, 'page') +
          (b.parts.length > 1 ? ' · ' + b.parts.length + ' PDFs' : ''))),
      pct ? h('span.badge', pct + '%') : null);
  });
  var units = ui.docs.filter(function (d) { return !d.bookId; }).map(function (d, i) {
    var st = sessions[d.id], pct = Home.unitPct(d, st);
    return h('li.unit-row', { style: '--hue:' + hue(i) },
      h('button.unit-open', { type: 'button', onclick: function () { openDoc(d.id); } },
        h('strong.doc-name', d.name),
        h('span.muted', Home.count(d.clusters.length, 'section') + ' · ' + Home.count(d.pages, 'page'))),
      pct ? h('span.badge', pct + '%') : null,
      h('details.menu', h('summary', { 'aria-label': 'More for ' + d.name }, '⋮'),
        h('div.menu-list',
          button('Start over', function () {
            if (!root.confirm('Start "' + d.name + '" from the beginning? Your review cards are kept.')) return;
            Store.del('sessions', d.id).then(function () { return openDoc(d.id); });
          }, 'quiet'),
          button('Delete', function () {
            if (!root.confirm('Delete "' + d.name + '" and its review cards from this device?')) return;
            docsChanged(); Store.deleteDoc(d.id).then(refresh).then(render);
          }, 'quiet danger'))),
      d.ocr && d.ocr.length ? h('p.muted.ocr-note', 'Read by text recognition: ' + (d.source === 'photo' ? 'every photo' : 'pages ' + d.ocr.slice(0, 12).join(', ') + (d.ocr.length > 12 ? '…' : '')) + '. Check anything surprising against the page.') : null,
      d.scanned && d.scanned.length ? h('p.warn', 'Pages with no readable text: ' + d.scanned.slice(0, 12).join(', ') + (d.scanned.length > 12 ? '…' : '') + '. They are not in any section' +
        (d.ocrError ? ' — the text reader could not run (' + d.ocrError + ').' : '.')) : null);
  });

  var checks = checksCard(), plan = ui.docs.length ? planCard() : null, week = weekCard();
  var keyNote = !hasKey() ? h('div.card.note', h('strong', 'Claude needs your API key. '), 'Add it in Settings, or switch back to the built-in coach, which needs none. ',
    button('Settings', function () { ui.view = 'settings'; render(); }, 'primary')) : null;
  var empty = !units.length && !books.length ? h('div.card.empty', h('h2', 'Start with a chapter, or the whole book'),
    h('p', 'Upload a chapter of your book as a PDF, take photos of its pages, or paste your notes — or add the whole textbook, in as many PDFs as it came in. Memorizer splits it into chapters and sections, teaches each one — key points, numbers to know, mnemonics and analogies — then drills you with multiple-choice questions. Everything you miss comes back as a review card until it sticks.')) : null;
  return { top: top, inputs: [pdfIn, photoIn, bookIn], keyNote: keyNote, pearl: pearl, jump: jump, weak: weak, checks: checks, plan: plan, week: week,
           add: h('section.home-add', { id: 'home-add', 'aria-label': 'Add material' }, drop, chips), paste: paste, books: books, units: units, empty: empty };
}

/* ── HOME: three things ────────────────────────────────────────────────────
   The owner: "home screen layout not upto mark, too much scrolling down, in
   home just add 2 or 3 sections including brain, move chapters to other
   page". So home is the hero (with what to continue), the brain, and the
   pearl — nothing else. Before anything is added, the box to add a chapter
   is here too, since there is nothing else to do. Everything about the
   chapters — adding, the books and units, jumping back in, the plan, the
   checks, what needs work, the week — is the Chapters page (viewShelf),
   a tab of its own. */
function viewHome() {
  var P = homeParts(), none = !ui.docs.length && !ui.books.length;
  /* the pearl sits beside the brain, in its card; alone only when no unit
     has been opened for the brain to draw */
  var brain = masteryCard(P.pearl);
  return h('main.wrap.home',
    P.top, P.inputs,
    ui.error ? errorCard(null) : null, P.keyNote,
    brain,
    brain ? null : P.pearl,
    none ? [P.add, P.paste, P.empty] : null);
}

/* ── CHAPTERS: the books and units, and what to do with them ─────────────── */
function viewShelf() {
  var P = homeParts();
  var side = P.plan || P.jump || P.checks || P.weak || P.week ? h('div.home-side', { id: 'home-side' }, P.plan, P.jump, P.checks, P.weak, P.week) : null;
  var shelf = h('div.shelf-main',
    P.books.length ? [h('div.section-head', h('h2', 'My books'), h('label.plus', { for: 'book-input', 'aria-label': 'Add a book' }, '+')),
      h('ul.units', { id: 'books' }, P.books)] : null,
    P.units.length ? [h('div.section-head', h('h2', 'My units'), h('label.plus', { for: 'pdf-input', 'aria-label': 'Add a PDF' }, '+')),
      h('ul.units', { id: 'units' }, P.units)] : null,
    P.empty);
  return h('main.wrap.home.shelf',
    h('header.shelf-head', h('h1', 'Chapters'), h('p.muted', Home.count(ui.books.length, 'book') + ' · ' + Home.count(ui.docs.filter(function (d) { return !d.bookId; }).length, 'unit'))),
    P.inputs,
    ui.error ? errorCard(null) : null, P.keyNote,
    P.add, P.paste,
    h('div.home-grid' + (side ? '.two' : ''), { id: 'shelf-grid' }, shelf, side));
}

/* ── UNIT: the sections as cards ─────────────────────────────────────────── */
/* What "Learn unit" opens: the current section if it is not drilled yet,
   else the next one that is not. */
function upNext(s) {
  var n = s.titles.length;
  for (var k = 0; k < n; k++) { var i = (s.section + k) % n; if (!s.per[i].done) return i; }
  return 0;
}
function backBar(title, onBack, extra) {
  return h('header.topbar', button('‹', onBack, 'round', { 'aria-label': 'Back' }), h('h1.bar-title', title), extra || null);
}
function viewUnit() {
  var s = ui.state, d = ui.docRec, n = d.clusters.length;
  var doneN = d.clusters.filter(function (_, i) { return s.per[i].done; }).length;
  var nxt = upNext(s);
  var allDone = Session.allDone(s);
  var cards = d.clusters.map(function (c, i) {
    var p = s.per[i], pct = Home.sectionPct(s, i);
    var state = p.done ? 'Drilled' : p.lesson ? 'Taught' : 'New';
    return h('button.section-card', { type: 'button', style: '--hue:' + hue(i), 'data-state': state.toLowerCase(),
        onclick: function () { go({ type: 'open', section: i }); } },
      h('span.band', h('span.band-n', String(i + 1))),
      h('span.section-body',
        h('strong.section-title', c.title),
        h('span.muted', (c.pageEnd !== c.pageStart ? 'pp. ' + c.pageStart + '–' + c.pageEnd : 'p. ' + c.pageStart) + ' · ' + state)),
      pct != null ? h('span.badge', pct + '%') : null);
  });
  var examCard = h('div.card.exam-card' + (allDone ? '' : '.locked'), { id: 'exam-card' },
    h('div', h('strong', 'Final exam'),
      h('p.muted', allDone ? (s.exam.score != null ? 'Last score ' + Math.round(100 * s.exam.score) + '%. Take it again any time.' : 'Mixed questions across the unit, weighted to your weakest sections.')
        : 'Unlocks when every section has been drilled (' + doneN + ' of ' + n + ').')),
    allDone ? h('div.exam-go', button(examMode() ? '\u2713 Exam conditions' : 'Exam conditions', function () { setExamMode(!examMode()); render(); }, examMode() ? 'chip sure-on' : 'chip quiet',
        { id: 'exam-mode', 'aria-pressed': String(examMode()), title: 'Timed at a board\u2019s pace, answers shown at the end' }),
      button(s.exam.score != null ? 'Retake' : 'Start', function () { go({ type: 'toExam' }); }, 'primary', { id: 'to-exam' })) : h('span.lock', { 'aria-hidden': 'true' }, '🔒'));
  return h('main.wrap.unit',
    backBar(d.name, function () { if (d.bookId) openBook(d.bookId); else leave('shelf'); }),
    d.bookId ? h('p.muted.book-of', d.bookName + (d.chapter ? ' · chapter ' + d.chapter : ' · front matter') + ' · pp. ' + d.pageStart + '–' + d.pageEnd) : null,
    h('p.muted.unit-meta', Home.count(n, 'section') + ' · ' + Home.count(d.pages, 'page') + ' · ' + doneN + ' drilled'),
    h('div.bar', h('i', { style: 'width:' + Math.round(100 * doneN / Math.max(1, n)) + '%' })),
    /* Where to go next, at the top: it floated over the foot of the page
       and covered the last sections (the owner's screenshot). */
    h('div.unit-cta', allDone
      ? button('Take the final exam', function () { go({ type: 'toExam' }); }, 'primary big', { id: 'learn-unit' })
      : button(doneN ? 'Continue: ' + d.clusters[nxt].title : 'Learn unit', function () { go({ type: 'open', section: nxt }); }, 'primary big', { id: 'learn-unit' })),
    ui.notice ? h('p.card.note', { id: 'notice', role: 'status' }, ui.notice) : null,
    packCard(d),
    weakCard(s),
    h('h2.grid-title', 'Sections (' + n + ')'),
    h('div.sections', { id: 'sections' }, cards),
    examCard,
    compareButton(s, d),
    sourceCard(d));
}

/* THE PEARL AS THE DAY'S RECALL (phase 4; home.js recallParts): its values
   hidden until asked for, then an honest "knew it" kept per day, and how
   many of the last seven days it was recalled. */
function pearlSteps(pk) {
  var id = pk.pearl.id, rec = ui.pearlShow && ui.pearlShow.id === id ? ui.pearlShow : null;
  if (!rec) {
    return [h('ol.pearl-steps', pk.steps.map(function (st) { return h('li', st.lead ? h('span.pearl-lead', st.lead) : null, marked(st.text)); })),
      button('\u21BA Recall it first', function () { ui.pearlShow = { id: id, shown: false }; render(); }, 'quiet', { id: 'pearl-recall' })];
  }
  var rp = Home.recallParts(pk.steps), day = today(), rs = Home.recallStreak(ui.pearlRecalls, day, 7, Study.addDays);
  var rate = function (knew) {
    ui.pearlRecalls = Object.assign({}, ui.pearlRecalls); ui.pearlRecalls[day] = knew; ui.pearlShow = null;
    Store.put('meta', { id: 'pearl-recall', recs: ui.pearlRecalls }).then(null, function (e) { saveFailed(e); });
    logActivity('review', {}); render();
  };
  return [h('ol.pearl-steps.recalling', { id: 'pearl-recalling' }, rp.steps.map(function (st) {
      var lead = st.lead ? h('span.pearl-lead', st.leadBlank && !rec.shown ? h('span.blank', '\u2003?\u2003') : st.lead) : null;
      return h('li', lead, st.parts.map(function (p) { return p.blank ? (rec.shown ? h('mark', p.text) : h('span.blank', '\u2003?\u2003')) : p.text; }));
    })),
    rec.shown ? h('div.row', { id: 'pearl-rate' }, button('\u2717 Not yet', function () { rate(false); }, 'quiet', { id: 'pearl-notyet' }),
        button('\u2713 I knew it', function () { rate(true); }, 'primary', { id: 'pearl-knew' }))
      : button('Show ' + (rp.blanks === 1 ? 'it' : 'them'), function () { rec.shown = true; render(); }, 'primary', { id: 'pearl-show' }),
    rs.of ? h('p.muted', { id: 'pearl-streak' }, 'Recalled on ' + rs.knew + ' of the last ' + rs.of + (rs.of === 1 ? ' day' : ' days') + ' you tried.') : null];
}
/* THE STUDY PACK (pack.js): the prompt to copy into the owner's own
   Claude chat, and the reply pasted back, checked against the book before
   any of it is stored. */
function packCard(d) {
  var cov = Pack.coverage(ui.pack, d), r = ui.packReport;
  var status = h('span.muted', { id: 'pack-copy-status', role: 'status' });
  var area = h('textarea', { id: 'pack-text', rows: '4', 'aria-label': 'Claude\u2019s reply', placeholder: 'Paste Claude\u2019s whole reply here, code block and all.',
    oninput: function () { ui.packText = area.value; } });
  area.value = ui.packText || '';
  var file = h('input', { type: 'file', accept: 'application/json,.json,text/plain,.txt', id: 'pack-file', class: 'visually-hidden',
    onchange: function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) readText(f).then(importPack, function (err) { ui.packReport = { error: err.message || String(err) }; render(); }); } });
  var left = cov.next && cov.have ? 'Still to import: ' + (cov.next[0] === cov.next[1] ? 'section ' + cov.next[0] : 'sections ' + cov.next[0] + '\u2013' + cov.next[1]) + '.' : '';
  /* folded to its one line until opened; open after an import, for its
     report. Every tap redraws the page, so the fold is remembered. */
  var card = h('details.card.pack-card', { id: 'pack-card', open: ui.packOpen || r ? true : null, ontoggle: function () { ui.packOpen = card.open; } },
    h('summary', h('span.eyebrow', '\u2726 Study pack \u00B7 written with Claude'),
      h('span.muted.pack-status', { id: 'pack-status' }, cov.have ? cov.have + ' of ' + cov.of + ' sections' + (cov.flagged ? ' \u00B7 ' + cov.flagged + ' flagged' : '') : 'none yet')),
    h('p', 'Have Claude write this unit\u2019s lessons and questions, with your Braunwald and Memorizer skills, and import its reply here. ' +
      'Memorizer checks every number, page and quoted sentence, and the conditions, tests and treatments it names, against your book; what it cannot find is flagged where it is shown.'),
    h('ol.pack-steps',
      h('li', 'Copy the prompt. It carries this unit\u2019s text, page by page.'),
      h('li', 'Paste it into a new chat on claude.ai' + (cov.of > Pack.PER_REPLY ? ', and say \u201Cnext\u201D after each reply' : '') + '.'),
      h('li', 'Paste each reply here and import it.')),
    h('div.row', button('Copy the prompt', function () { copyText(Pack.prompt(d), status, function () { ui.packShow = true; render(); }); }, 'primary', { id: 'pack-copy' }),
      button(ui.packShow ? 'Hide the prompt' : 'Show the prompt', function () { ui.packShow = !ui.packShow; render(); }, 'quiet', { id: 'pack-show' }), status),
    ui.packShow ? h('textarea.pack-prompt', { id: 'pack-prompt', rows: '6', readonly: true, 'aria-label': 'The prompt for Claude', onfocus: function (e) { e.target.select(); } }, Pack.prompt(d)) : null,
    left ? h('p.muted', { id: 'pack-next' }, left) : null,
    area,
    h('div.row', button('Check and import', function () { importPack(area.value); }, 'primary', { id: 'pack-import' }),
      file, h('label.chip', { for: 'pack-file' }, 'Or choose a file'),
      cov.have ? button('Remove the pack', function () { removePack(d); }, 'quiet danger', { id: 'pack-remove' }) : null),
    r ? packReportView(r) : null);
  return card;
}
function packReportView(r) {
  if (r.error) return h('p.warn', { id: 'pack-report', role: 'status' }, 'Not imported: ' + r.error + '.');
  return h('div.pack-report', { id: 'pack-report', role: 'status' },
    h('p', h('strong', r.report.line)),
    r.refused.length ? h('ul.pack-refused', r.refused.map(function (x) {
      return h('li', 'Section ' + (x.section == null ? '?' : x.section) + (x.title ? ' \u201C' + x.title + '\u201D' : '') + ' was not imported: ' + x.why + '.');
    })) : null,
    r.dropped.length ? h('details.pack-dropped', h('summary', Home.count(r.dropped.length, 'item') + ' left out'),
      h('ul', r.dropped.map(function (x) { return h('li', 'Section ' + x.section + ', ' + x.where + ': ' + x.why + '.'); }))) : null);
}
/* A reply, checked and stored: its sections replace the built-in lessons
   and questions (session.js 'packed'); nothing is stored when nothing
   passed. */
function importPack(text) {
  var d = ui.docRec, got = Pack.parse(text);
  if (!got.ok) { ui.packReport = { error: got.error }; render(); return Promise.resolve(); }
  var checked = Pack.check(got.packs, d);
  ui.packReport = { report: Pack.report(checked), refused: checked.refused, dropped: checked.dropped };
  if (!checked.sections.length) { render(); return Promise.resolve(); }
  var rec = Pack.merge(ui.pack, checked, d, Date.now());
  return Store.put('packs', rec).then(function () {
    ui.pack = rec; ui.packText = '';
    return dispatch({ type: 'packed', value: { sections: checked.sections } });
  }).then(render, function (e) { saveFailed(e); render(); });
}

/* The pack removed: the sections it taught go back to the built-in coach
   (session.js 'unpacked'); scores and cards stay. */
function removePack(d) {
  if (!root.confirm('Remove the study pack from "' + d.name + '"? Its sections are taught by the built-in coach again; your scores and review cards are kept.')) return Promise.resolve();
  return Store.del('packs', d.id).then(function () {
    ui.pack = null; ui.packReport = null;
    return dispatch({ type: 'unpacked' });
  }).then(render, function (e) { saveFailed(e); render(); });
}

/* Where this unit came from and how well it was read (provenance.js):
   folded away, and open by itself only when there are pages to check. */
function sourceCard(d) {
  var r = Prov.report(d), pr = d.processing;
  var when = d.addedAt ? new Date(d.addedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  var from = d.bookId ? d.bookName + ', pp. ' + d.pageStart + '\u2013' + d.pageEnd : d.fileName || d.name;
  return h('details.card.source-card', { id: 'source-card', 'data-verdict': r.verdict, open: r.verdict === 'good' ? null : true },
    h('summary', h('span.eyebrow', 'Source \u00B7 ' + r.label)),
    h('ul.src-lines', r.lines.map(function (l) { return h('li', { 'data-kind': l.kind }, l.text); }), unsureLines(d)),
    h('p.muted.src-meta', 'From ', h('strong', from), when ? ' \u00B7 added ' + when : '',
      d.fingerprint ? [' \u00B7 ', h('span', { title: d.fingerprint }, Prov.shortPrint(d.fingerprint))] : '',
      pr ? ' \u00B7 read by Memorizer ' + pr.build + (d.source === 'pdf' ? ', PDF reader ' + pr.pdfjs : '') : ''),
    h('p.muted', 'Everything Memorizer teaches from this unit is this source\u2019s own text. It is what your book says, as of its edition \u2014 not a check against current guidelines.'));
}

/* The scanned pages text recognition was least sure of (study.js
   pageConfidence): where to check the numbers. */
function unsureLines(d) {
  var conf = d.ocrConf || {};
  var low = Object.keys(conf).map(Number).filter(function (n) { return conf[n] && conf[n].mean < Study.LOW_CONFIDENCE; }).sort(function (a, b) { return a - b; });
  if (!low.length) return null;
  return h('li', { 'data-kind': 'unsure', id: 'ocr-unsure' }, 'Text recognition was unsure of ' + (low.length === 1 ? 'p. ' : 'pp. ') +
    low.map(function (n) { return n + ' (' + conf[n].mean + '%)'; }).join(', ') + ': check the numbers there against the page, and correct them in the lesson.');
}

/* The weak list in one line, as the skill shows it, with its round. */
function weakCard(s) {
  var line = Skill.weakLine(Object.keys(s.weak || {}).map(function (k) { return s.weak[k]; }).filter(function (w) { return w.source !== 'exam'; }));
  if (!line) return null;
  var n = Session.pending(s).length;
  return h('div.card.weak-line', { id: 'weak-line' }, h('p', h('strong', '\u26A0\uFE0F '), line),
    button('Review round (' + n + ')', function () { go({ type: 'toReview' }); }, 'quiet', { id: 'unit-review' }));
}

/* ── BOOK: its chapters, and how they were found ─────────────────────────── */
function viewBook() {
  var b = ui.books.filter(function (x) { return x.id === ui.bookId; })[0];
  if (!b) return viewHome();
  var byId = {};
  ui.docs.forEach(function (d) { byId[d.id] = d; });
  var k = 0;
  var rows = b.chapters.map(function (c, i) {
    var d = c.docId && byId[c.docId], st = d && ui.sessions[d.id], pct = d ? Home.unitPct(d, st) : 0;
    var label = c.front ? '·' : String(++k);
    return h('li.unit-row.chapter-row' + (c.front ? '.front' : ''), { style: '--hue:' + hue(i), 'data-start': String(c.pageStart) },
      h('button.unit-open', { type: 'button', disabled: d ? null : true, onclick: function () { if (d) openDoc(d.id); } },
        h('strong.doc-name', h('span.chapter-n', label), ' ', c.title),
        h('span.muted', 'pp. ' + c.pageStart + '–' + c.pageEnd + ' · ' + (d ? Home.count(d.clusters.length, 'section') : 'no readable text'))),
      pct ? h('span.badge', pct + '%') : null,
      i > 0 ? h('details.menu', h('summary', { 'aria-label': 'More for ' + c.title }, '⋮'),
        h('div.menu-list', button('Join to the chapter before', function () {
          if (!root.confirm('Join "' + c.title + '" to the chapter before it? Both start again; every other chapter keeps its progress.')) return;
          recut(b, Book.merge(b.chapters, i));
        }, 'quiet', { 'data-join': String(i) }))) : null);
  });
  var real = b.chapters.filter(function (c) { return !c.front; }).length;
  var studied = b.chapters.filter(function (c) { var d = c.docId && byId[c.docId]; return d && Home.unitPct(d, ui.sessions[d.id]) === 100; }).length;
  var methods = h('div.seg', { role: 'radiogroup', 'aria-label': 'Chapters found by', id: 'methods' }, Book.METHODS.map(function (m) {
    return h('button', { type: 'button', role: 'radio', 'aria-checked': String(m === b.method), 'data-method': m,
        onclick: function () {
          if (m === b.method) return;
          if (!root.confirm('Cut "' + b.name + '" into chapters by ' + Book.LABELS[m].toLowerCase() + '? Chapters that change start again; the others keep their progress.')) return;
          recut(b, null, m);
        } }, Book.LABELS[m] + ' · ' + (b.found ? b.found[m] : '?'));
  }));
  return h('main.wrap.book',
    backBar(b.name, function () { leave('shelf'); }),
    h('p.muted.unit-meta', Home.count(real, 'chapter') + ' · ' + Home.count(b.pages, 'page') + (b.parts.length > 1 ? ' in ' + b.parts.length + ' PDFs' : '') + ' · ' + studied + ' fully drilled'),
    h('div.bar', h('i', { style: 'width:' + Math.round(100 * studied / Math.max(1, real)) + '%' })),
    ui.importing ? h('div.card.busy', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', ui.importing)) : null,
    ui.error ? errorCard(null) : null,
    h('div.card', { id: 'found-by' }, h('h2', 'How the chapters were found'),
      h('p.muted', 'Each way of finding chapters is tried; the one that fits the book best is used. If the chapters below look wrong, try another — or join a chapter to the one before it. Chapters that stay the same keep your progress.'),
      methods),
    h('h2.grid-title', 'Chapters (' + real + ')'),
    h('ul.units', { id: 'chapters' }, rows),
    b.scanned.length ? h('p.warn', 'Pages with no readable text: ' + b.scanned.slice(0, 12).join(', ') + (b.scanned.length > 12 ? '…' : '') + '.') : null,
    h('div.row', button('Delete this book', function () {
      if (!root.confirm('Delete "' + b.name + '", its chapters and their review cards from this device?')) return;
      docsChanged(); Store.deleteBook(b.id).then(function () { leave('shelf'); });
    }, 'quiet danger', { id: 'delete-book' })));
}

/* Compare the sections taught so far, side by side, as one figure. */
function compareButton(s, d) {
  var rows = d.clusters.map(function (c, i) {
    var L = s.per[i].lesson;
    return L ? { title: c.title, sheet: Sheet.sheetOf(L), mnemonic: (L.mnemonics || [])[0] } : null;
  }).filter(Boolean);
  if (rows.length < 2) return null;
  return h('div.row.compare-row', button('🖼 Compare sections (' + rows.length + ')', function () { showFigure(Figure.compareChart(d.name, rows), d.name + ' compared'); }, 'quiet', { id: 'make-compare' }));
}

/* ── LESSON ──────────────────────────────────────────────────────────────── */
function steps(which) {
  var PH = [['teach', 'Learn'], ['memorize', 'Memorize'], ['drill', 'Drill']], at = PH.map(function (p) { return p[0]; }).indexOf(which);
  return h('ol.stepper', { 'aria-label': 'Step' }, PH.map(function (p, k) {
    var now = p[0] === which, done = k < at;
    return h('li' + (now ? '.now' : done ? '.done' : ''), { 'aria-current': now ? 'step' : null }, p[1]);
  }));
}
function sectionBar(which) {
  var s = ui.state, c = cluster(), n = ui.docRec.clusters.length;
  return [backBar(c.title, function () { go({ type: 'toUnit' }); }),
    h('div.section-meta', h('p.muted.unit-meta', 'Section ' + (s.section + 1) + ' of ' + n + ' · ' + (c.pageEnd !== c.pageStart ? 'pp. ' + c.pageStart + '–' + c.pageEnd : 'p. ' + c.pageStart) +
      ' · about ' + Math.max(1, Math.round(c.words / 200)) + ' min read'),
      button(focusOn() ? '\u25C9 Focus' : '\u25CB Focus', function () { setFlag_(FOCUS_KEY, 'focus', !focusOn()); render(); }, 'quiet focus-btn',
        { id: 'focus-toggle', 'aria-pressed': String(focusOn()), title: 'Hide the dock, the robot and the background while you study' })),
    steps(which)];
}
/* A point as a card: its key term bold, its sub-points below, and the
   paragraph it came from one tap away. */
function paragraphOf(c, text) {
  var head = String(text).slice(0, 40);
  return (c.segments || []).filter(function (s) { return !s.heading && !s.table && String(s.text).indexOf(head) !== -1; })[0];
}
function pointCard(c, p, i) {
  var b = Format.bullet(p.text), para = paragraphOf(c, p.text);
  var rec = ui.state && ui.notes ? notesFor(ui.docId, ui.state.section) : null, marked_ = !!(rec && rec.marks && rec.marks.indexOf(p.text) !== -1);
  return h('li.point' + (marked_ ? '.marked' : ''),
    h('span.point-n', String(i + 1)),
    ui.state ? button(marked_ ? '★' : '☆', function () { toggleMark(c, p.text); }, 'quiet mark-btn', { id: 'mark-' + i, 'aria-pressed': String(marked_), 'aria-label': marked_ ? 'Unmark this point' : 'Mark this point to be asked' }) : null,
    h('div.point-body',
      hyTags(p.text),
      h('p.point-text', b.lead ? [h('strong.lead', b.lead), marked(b.body)] : withKey(b.body, Coach.keyTermOf(c, p.text)), ' ', page(p.page)),
      flagLine(p.flag),
      b.subs.length ? h('ul.subs', b.subs.map(function (x) { return h('li', marked(x)); })) : null,
      para && para.text.length > p.text.length + 20 ? h('details.context', h('summary', 'In the book'),
        h('p', marked(para.text))) : null));
}
/* What a pack's check could not find in the book (pack.js), said on the
   item itself. */
function flagLine(why) {
  return why ? h('p.flag', { 'data-flag': why }, '\u26A0 ' + why.charAt(0).toUpperCase() + why.slice(1) + '.') : null;
}
/* Why a point is high-yield, from its own words (Coach.yieldOf): "Most
   common", "First-line", "Threshold" … — whatever wrote the lesson. */
function hyTags(text) {
  var hy = Coach.yieldOf(text);
  return hy.length ? h('p.hy-tags', h('span.hy', 'High yield'), hy.map(function (t) { return h('span.hy-why', t); })) : null;
}
/* The point with its key term in bold, every word still the book's. */
function withKey(text, key) {
  var at = key ? String(text).indexOf(key) : -1;
  if (at === -1 && key) at = String(text).toLowerCase().indexOf(key.toLowerCase());
  if (at === -1) return marked(text);
  return [marked(text.slice(0, at)), h('strong.key', text.slice(at, at + key.length)), marked(text.slice(at + key.length))];
}
/* The section at a glance: key facts, its pathway, its lists (sheet.js). */
function glanceCard(c, L, noPath) {
  /* a list with a mnemonic of its own is shown there, not twice */
  var g = Sheet.glance(c, (L.mnemonics || []).map(function (m) { return m.title; }));
  if (g && noPath) g = { facts: g.facts, pathway: [], lists: g.lists };
  if (!g || !g.facts.length && !g.pathway.length && !g.lists.length) return null;
  return h('div.card.glance', { id: 'glance' }, h('span.eyebrow', 'At a glance'),
    g.facts.length ? h('div.gl-facts', g.facts.map(function (f) { return h('div.gl-fact', h('strong', f.title), h('span', f.sub)); })) : null,
    g.pathway.length ? [h('p.gl-caption', 'The mechanism, as your book tells it'), h('div.gl-path', g.pathway.map(function (st, i) {
      return [i ? h('span.gl-arrow', h('span.gl-verb', st.verb), h('span', { 'aria-hidden': 'true' }, '→')) : null, h('span.gl-step', st.label)];
    }))] : null,
    g.lists.length ? h('div.gl-lists', g.lists.map(function (l) {
      return h('div.gl-list', h('strong', l.title), h('span', l.items.join(' · ') + (l.more ? ' · +' + l.more + ' more' : '')));
    })) : null);
}
/* One question from the drill's own pool, asked in the lesson and not
   recorded: active recall while the section is fresh. */
/* TEACH IT BACK: the section explained in your own words, checked against
   its key points (study.js teachBack); what was left out can become cards. */
function teachCard(c, L) {
  var key = ui.docId + ':' + ui.state.section, got = ui.teach && ui.teach.key === key ? ui.teach : null;
  var points = Sheet.sheetOf(L).groups.reduce(function (a, g) { return a.concat(g.points); }, []);
  /* a pack's lesson is scored against its rubric: its pearls and its
     mechanism too (study.js rubricOf) */
  if (L.by === 'pack') points = Study.rubricOf(points, L);
  var area = h('textarea', { id: 'teach-text', rows: '5', 'aria-label': 'Your explanation', placeholder: 'Explain this section as if to a colleague: what it is, why it happens, the numbers.',
    oninput: function () { ui.teachDraft = area.value; } });
  area.value = ui.teachDraft || '';
  var check = function () {
    var r = Study.teachBack(area.value, points.map(function (p) { return p.text; }), c.text);
    ui.teach = { key: key, said: area.value, r: r, points: points }; render();
  };
  var res = got ? h('div', { id: 'teach-result' },
    h('p', h('strong', 'You covered ' + got.r.covered.length + ' of ' + (got.r.covered.length + got.r.missed.length) + ' key points.')),
    got.r.wrong.length ? h('p.warn', { id: 'teach-wrong' }, 'You gave ' + got.r.wrong.join(', ') + ' — this section has no such number. Check it against the page.') : null,
    got.r.missed.length ? [h('p.muted', L.by === 'pack' ? 'What you left out, in the lesson\u2019s words:' : 'What you left out, in your book’s words:'), h('ul.teach-missed', got.r.missed.map(function (i) { return h('li', marked(got.points[i].text), ' ', page(got.points[i].page)); })),
      button('Make cards of what I left out', function () { teachCards(c, got); }, 'quiet', { id: 'teach-cards' })] : h('p', '✓ Everything the section’s key points say.'),
    ui.teachMade != null ? h('p.muted', { id: 'teach-made' }, ui.teachMade + ' card' + (ui.teachMade === 1 ? '' : 's') + ' made, from tomorrow.') : null) : null;
  return h('div.card.teach-card', { id: 'teach-back' }, h('span.eyebrow', '🗣 Teach it back'),
    h('p.muted', 'Explaining it is how you find what you have not got yet. Say it or type it, then check it against the book.'),
    area, h('div.row', micButton(function (t) { ui.teachDraft = ((ui.teachDraft || '') + ' ' + t).trim(); render(); }, 'teach-mic'),
      button('Check my explanation', check, 'primary', { id: 'teach-check' })), res);
}
function teachCards(c, got) {
  var d = ui.docRec, ci = ui.state.section, from = Study.addDays(today(), 1), have = {};
  ui.cards.forEach(function (x) { have[x.id] = true; });
  var made = got.r.missed.map(function (i) { return Study.clozeOf({ text: got.points[i].text, page: got.points[i].page }, Coach.frequencies(c)); }).filter(Boolean).map(function (x) {
    return { id: d.id + ':explain:' + ci + ':' + x.sentence.length + ':' + x.answer, docId: d.id, source: 'explain', kind: 'cloze', cluster: ci, title: c.title,
      front: x.front, back: x.answer, explain: x.sentence, page: x.page, srs: null, dueFrom: from, errorType: '', confusedWith: '' };
  }).filter(function (x) { return !have[x.id]; });
  Promise.all(made.map(function (x) { return Store.put('cards', x); })).then(function () { ui.cards = ui.cards.concat(made); ui.teachMade = made.length; render(); }, function (e) { saveFailed(e); render(); });
}
/* Speech to text, where the browser has it (Safari's dictation: Apple may
   process the audio). Nothing is shown where it does not. */
function micButton(onText, id) {
  var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  if (!SR) return null;
  var on = ui.listening === id;
  return button(on ? '■ Stop' : '🎙 Speak', function () {
    if (on) { if (ui.rec) ui.rec.stop(); return; }
    var r = new SR();
    r.lang = (root.navigator && root.navigator.language) || 'en-US'; r.interimResults = false; r.continuous = false;
    r.onresult = function (e) {
      var t = Array.prototype.map.call(e.results, function (x) { return x[0].transcript; }).join(' ').trim();
      if (t) onText(t);
    };
    r.onerror = function (e) { ui.voiceError = (e && e.error) || 'it did not work'; };
    r.onend = function () { ui.listening = null; ui.rec = null; render(); };
    ui.rec = r; ui.listening = id; ui.voiceError = '';
    r.start(); render();
  }, on ? 'chip sure-on' : 'chip quiet', { id: id, 'aria-pressed': String(on), title: 'Speak instead of typing (your device’s dictation)' });
}
/* CORRECT THE TEXT: a paragraph of a section read by text recognition,
   corrected by you (study.js correctSegment) and kept with what it said
   before; the lesson is taught again from the corrected text. */
function fixCard(c) {
  var d = ui.docRec, ci = ui.state.section;
  if (!(d.source === 'photo' || Prov.ocrPagesIn(d, c).length)) return null;
  var fixes = (d.corrections || []).filter(function (x) { return x.ci === ci; });
  return h('details.card.fix-card', { id: 'fix-text', open: ui.fixOpen ? true : null }, h('summary', h('span.eyebrow', '✎ Correct the text'), h('span.muted', ' — if recognition misread a word or number')),
    c.segments.map(function (seg, si) {
      if (seg.heading || seg.table) return null;
      var area = h('textarea', { rows: '3', 'data-si': String(si), 'aria-label': 'Paragraph ' + (si + 1) + ' of the section' });
      area.value = seg.text;
      return h('div.fix-row', area, h('div.row', page(seg.page), seg.corrected ? h('span.tag', 'corrected by you') : null,
        button('Save', function () { saveFix(ci, si, area.value); }, 'quiet', { 'data-fix': String(si) })));
    }),
    fixes.length ? h('p.muted', { id: 'fix-log' }, fixes.length + ' correction' + (fixes.length === 1 ? '' : 's') + ' in this section, each kept with what it said before.') : null);
}
function saveFix(ci, si, text) {
  var fixed = Study.correctSegment(ui.docRec, ci, si, text, today());
  if (!fixed) return;
  ui.fixOpen = true;
  Store.put('docs', fixed).then(function () {
    ui.docRec = fixed; docsChanged();
    ui.notice = 'Corrected. The lesson is taught again from your text.';
    if (ui.state.phase !== 'teach') return;
    return ask('Preparing the lesson…', 'lesson', [fixed.clusters[ci]], [fixed.clusters[ci]]).then(function (v) { return dispatch({ type: 'taught', value: v }); });
  }).then(function () { return refresh(); }).then(render, function (e) { saveFailed(e); render(); });
}
/* YOUR NOTES: kept per section as yours, never mixed with the book's words. */
function notesFor(docId, ci) { return ui.notes[Study.noteKey(docId, ci)] || null; }
function saveNotes() { return Store.put('meta', { id: 'notes', recs: ui.notes }).then(null, function (e) { saveFailed(e); render(); }); }
function noteCard(c) {
  var key = Study.noteKey(ui.docId, ui.state.section), rec = ui.notes[key] || { text: '', marks: [] };
  var area = h('textarea', { id: 'note-text', rows: '3', 'aria-label': 'Your note on this section', placeholder: 'Your own words: a link to a case you saw, a way you remember it.' });
  area.value = rec.text || '';
  return h('div.card.note-card', { id: 'notes' }, h('span.eyebrow', '📝 Your notes'),
    h('p.muted', 'Yours, not the book’s — shown with this section’s cards and in the Coach, labelled as yours. Mark a key point with ☆ to have it asked as a card.'),
    area, h('div.row', button('Save note', function () {
      ui.notes[key] = { text: area.value.trim(), marks: rec.marks || [] }; saveNotes(); ui.notice = 'Note saved.'; render();
    }, 'quiet', { id: 'note-save' }), (rec.marks || []).length ? h('span.muted', { id: 'mark-count' }, rec.marks.length + ' point' + (rec.marks.length === 1 ? '' : 's') + ' marked') : null));
}
/* A key point marked: kept, and made a cloze card (study.js markCard) from
   tomorrow; unmarked, its card goes if it was never reviewed. */
function toggleMark(c, text) {
  var d = ui.docRec, ci = ui.state.section, key = Study.noteKey(d.id, ci);
  var rec = Study.toggleMark(ui.notes[key], text), on = rec.marks.indexOf(text) !== -1;
  ui.notes[key] = rec; saveNotes();
  var card = Study.markCard(d, ci, text);
  if (!card) { render(); return; }
  var have = ui.cards.filter(function (x) { return x.id === card.id; })[0];
  if (on && !have) { card.dueFrom = Study.addDays(today(), 1); Store.put('cards', card).then(function () { ui.cards.push(card); render(); }); return; }
  if (!on && have && !have.srs) { Store.del('cards', card.id).then(function () { ui.cards = ui.cards.filter(function (x) { return x.id !== card.id; }); render(); }); return; }
  render();
}
function quickCheck(c, L) {
  var key = ui.docId + ':' + ui.state.section;
  if (!ui.quick || ui.quick.key !== key) {
    var qs = Coach.quiz(c, L, ui.docRec.clusters).questions;
    ui.quick = { key: key, q: qs[0] || null, choice: null };
  }
  var q = ui.quick.q;
  if (!q) return null;
  var chosen = ui.quick.choice, answered = chosen != null;
  return h('div.card.quick', { id: 'quick' }, h('span.eyebrow', '⚡ Quick check'),
    q.quote ? h('blockquote.quote', q.quote.split('_____').map(function (part, i, all) { return [part, i < all.length - 1 ? h('span.gap', answered ? q.options[q.answer] : '_____') : null]; })) : null,
    h('p.q', q.question),
    h('div.options', q.options.map(function (o, i) {
      var cls = answered ? (i === q.answer ? '.right' : i === chosen ? '.wrong' : '.dim') : '';
      return h('button.option' + cls, { type: 'button', disabled: answered ? true : null, 'data-i': String(i), onclick: function () { ui.quick.choice = i; render(); } },
        h('span.opt-letter', LETTERS[i]), h('span.opt-text', o));
    })),
    answered ? h('p.why' + (chosen === q.answer ? '.good' : '.bad'), h('strong', chosen === q.answer ? '✓ Right. ' : '✗ It is ' + q.options[q.answer] + '. '), marked(q.explain), ' ', page(q.page),
      h('span.muted', ' — not counted; the drill is next.')) : null);
}
function drawFlowCard(c, lessonV) {
  var f = null, fromModel = false;
  if (lessonV.flowchart && lessonV.flowchart.trim()) {
    var parsed = parseMermaid(lessonV.flowchart);
    if (parsed.edges.length) { f = parsed; fromModel = true; }
    else return h('div.card', h('span.eyebrow', 'How it works'), flowchart(lessonV.flowchart));
  }
  if (!f) { f = Coach.flow(c); if (f.edges.length < 2) return null; }
  return h('div.card', { id: 'flow' }, h('div.card-head', h('span.eyebrow', 'How it works'),
      h('span.muted', fromModel ? 'drawn by Claude from this section' : 'from this section’s cause-and-effect sentences')),
    drawFlow(f));
}
/* ── figures made from the book (figure.js): shown, and saved as a PNG ─── */
function svgUrl(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
function savePng(svg, name) {
  var img = new Image();
  img.onload = function () {
    var c = doc.createElement('canvas'), k = 2;
    c.width = img.naturalWidth * k; c.height = img.naturalHeight * k;
    var ctx = c.getContext('2d'); ctx.scale(k, k); ctx.drawImage(img, 0, 0);
    c.toBlob(function (b) {
      var a = doc.createElement('a');
      a.href = URL.createObjectURL(b); a.download = name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.png';
      doc.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }, 'image/png');
  };
  img.src = svgUrl(svg);
}
function showFigure(svg, name, note) {
  var close = function () { closeFn(); };
  var el = h('div.lightbox.figure-view', { 'aria-label': name },
    h('img', { src: svgUrl(svg), alt: name }),
    h('p.muted.fig-note', note || 'Every word and number here is your book\u2019s, arranged by Memorizer.'),
    h('div.row', button('Save image', function () { savePng(svg, name); }, 'primary', { id: 'save-figure' }), button('Close', close, '', { 'data-autofocus': true, id: 'fig-close' })));
  var closeFn = Dialog.open(el, doc.getElementById('app'));
}
function sourceLine(d, c) {
  return (d.bookName ? d.bookName + ' · ' : '') + d.name + ' · ' + (c.pageEnd !== c.pageStart ? 'pp. ' + c.pageStart + '–' + c.pageEnd : 'p. ' + c.pageStart);
}

/* Clinical headings, each with a small mark so the eye finds its place. */
var HEAD_MARK = { 'Definition': '◆', 'Causes and risk factors': '⚑', 'Mechanism': '⚙', 'Presentation': '☺', 'Diagnosis': '⌕', 'Treatment': '✚',
                  'Complications and prognosis': '⚠', 'Also know': '•' };
function numbersCard(sh, play) {
  if (!sh.numbers.length) return null;
  var at = 0;
  return h('div.card', { id: 'numbers', 'data-comp': play ? 'numbers:' + ui.docId + ':' + ui.state.section : null }, h('span.eyebrow', 'Numbers to know'),
    sh.numbers.map(function (n) {
      return h('div.fact', n.subject ? h('p.fact-subject', n.subject, ' ', page(n.page)) : null,
        h('div.tiles', n.tiles.map(function (t) {
          if (!play) return h('div.tile', h('span.tile-value', t.value), h('span.tile-label', t.label));
          /* NUMBERS BUILDING UP: the comparison sign first, then the value
             rises into place beside it, then what it measures. */
          var m = /^([≥≤<>])\s(.*)$/.exec(t.value), t0 = at;
          at += 0.9;
          return h('div.tile', h('span.tile-value', m ? [h('span.tv-sign', { 'data-start': t0, 'data-duration': 0.3, 'data-anim': 'pop' }, m[1]), ' ',
              h('span.tv-num', { 'data-start': t0 + 0.25, 'data-duration': 0.45, 'data-anim': 'rise' }, m[2])]
              : h('span.tv-num', { 'data-start': t0, 'data-duration': 0.45, 'data-anim': 'rise' }, t.value)),
            h('span.tile-label', { 'data-start': t0 + 0.55, 'data-duration': 0.35, 'data-anim': 'fade' }, t.label));
        })),
        n.subject ? null : h('p.muted.fact-src', 'p.' + n.page),
        flagLine(n.flag),
        h('details.context', h('summary', 'The sentence'), h('p', marked(n.text), ' ', page(n.page))));
    }));
}
function analogyCard(a, first) {
  return h('div.card.analogy' + (first ? '' : '.more'), h('span.eyebrow', 'Think of it like…'), h('h3', a.title), h('p.analogy-text', a.text),
    h('p.muted.label', a.source === 'Claude' ? 'Analogy written by Claude — not from your book.' : 'Analogy — Memorizer’s, not your book’s. Your book is the authority.'));
}
/* Where this section's text came from text recognition, the lesson says so
   on the section itself — the home screen's note is a long way from here. */
function ocrNote(c) {
  var d = ui.docRec, ns = d.source === 'photo' ? [c.pageStart] : Prov.ocrPagesIn(d, c);
  if (!ns.length) return null;
  return h('p.warn.ocr-lesson', { id: 'ocr-note' },
    d.source === 'photo' ? 'This section was read from a photo by text recognition. ' : 'Part of this section was read from a scanned page by text recognition (' + (ns.length === 1 ? 'p. ' : 'pp. ') + Prov.pageList(ns) + '). ',
    'Recognition can misread a number or a word: check anything surprising against the page.');
}
/* THE CLINICAL MAP (sheet.js clinicalMap): what the section names, grouped
   — shown when it names two things or more. */
function mapCard(c) {
  var m = Sheet.clinicalMap(c);
  if (m.count < 2) return null;
  return h('div.card.clinical-map', { id: 'clinical-map' }, h('span.eyebrow', 'Clinical map'),
    h('div.map-groups', m.groups.map(function (g) {
      return h('div.map-group', { 'data-kind': g.kind }, h('strong.map-kind', g.label),
        h('div.map-items', g.items.map(function (it) { return h('span.map-item', it.label, page(it.page)); })));
    })),
    h('p.muted', 'What this section names, grouped by Memorizer, each with the page it is first named on.'));
}
/* WHY? WHY? WHY? (study.js socratic): down the chain, one link at a time,
   each answer hidden until asked for. */
function socraticCard(c, L, gl) {
  var sc = Study.socratic(gl && gl.pathway, L.mechanism);
  if (!sc) return null;
  var key = ui.docId + ':' + ui.state.section;
  if (!ui.soc || ui.soc.key !== key) ui.soc = { key: key, shown: 0 };
  var n = ui.soc.shown;
  return h('div.card.socratic', { id: 'socratic', 'data-source': sc.source }, h('span.eyebrow', 'Why? Why? Why?'),
    h('p.muted', sc.source === 'book' ? 'Down the section\u2019s own chain of cause and effect. Answer each aloud, then look.'
      : 'Down the lesson\u2019s mechanism' + (L.by === 'pack' ? ', written with Claude' : '') + ', a step at a time. Answer aloud, then look.'),
    h('ol.soc-steps', sc.steps.map(function (st, k) {
      if (k > n) return null;
      return h('li', h('p.soc-ask', st.ask), k < n ? h('p.soc-answer', marked(st.answer))
        : button('Show', function () { ui.soc.shown = k + 1; render(); }, 'quiet', { id: 'soc-show' }));
    })),
    n >= sc.steps.length ? h('p.muted', { id: 'soc-done' }, 'That is the chain. Say it through once more without looking.') : null);
}
/* ROUNDS (phase 4): a pack's oral cases — the stem, the examiner's
   question, the model answer on request, and an honest "had it". */
function roundsCard(L) {
  var cs = L.cases || [];
  if (!cs.length) return null;
  var key = ui.docId + ':' + ui.state.section;
  if (!ui.rounds || ui.rounds.key !== key) ui.rounds = { key: key, c: 0, a: 0, shown: false, had: 0, n: 0 };
  var r = ui.rounds, cur = cs[r.c], ask = cur && cur.asks[r.a];
  var rate = function (had) { r.n++; if (had) r.had++; r.shown = false; r.a++; if (r.a >= cur.asks.length) { r.c++; r.a = 0; } render(); };
  if (!cur) return h('div.card.rounds', { id: 'rounds' }, h('span.eyebrow', 'Rounds'),
    h('p', { id: 'rounds-done' }, 'Rounds done: ' + r.had + ' of ' + r.n + ' answered.'),
    button('Again', function () { ui.rounds = null; render(); }, 'quiet', { id: 'rounds-again' }));
  return h('div.card.rounds', { id: 'rounds' }, h('span.eyebrow', 'Rounds \u00B7 case ' + (r.c + 1) + ' of ' + cs.length),
    h('p.rounds-stem', cur.stem),
    h('p.rounds-q', h('strong', 'Q: '), ask.q),
    r.shown ? [h('p.rounds-a', { id: 'rounds-answer' }, h('strong', 'A: '), marked(ask.a), ' ', page(cur.page)), flagLine(ask.flag),
      h('div.row', button('\u2717 Missed it', function () { rate(false); }, 'quiet', { id: 'rounds-missed' }),
        button('\u2713 Had it', function () { rate(true); }, 'primary', { id: 'rounds-had' }))]
      : button('Say it aloud, then show the answer', function () { r.shown = true; render(); }, 'primary', { id: 'rounds-show' }),
    h('p.muted', 'A case written with Claude from your book; each answer checked against it.'));
}
/* THE ONE-SCREEN REVIEW (sheet.js reviewSheet), in a dialog. */
function showReview(c, L) {
  var r = Sheet.reviewSheet(L), close = function () { closeFn(); };
  var el = h('div.lightbox.review-sheet', { id: 'review-sheet', 'aria-label': c.title + ' on one screen' },
    h('h2', c.title), r.idea ? h('p.rs-idea', marked(r.idea)) : null,
    r.points.length ? [h('h3', 'Key points'), h('ol.rs-points', r.points.map(function (p) { return h('li', marked(p.text)); }))] : null,
    r.values.length ? [h('h3', 'Values'), h('div.rs-values', r.values.map(function (v) { return h('span.rs-value', h('strong', v.value), ' ', v.label); }))] : null,
    r.confuse.length ? [h('h3', 'Don\u2019t confuse'), h('ul.rs-confuse', r.confuse.map(function (x) { return h('li', h('strong', x.a), ' vs ', h('strong', x.b), ' \u2014 ', x.how); }))] : null,
    r.hooks.length ? [h('h3', 'Hooks'), h('ul.rs-hooks', r.hooks.map(function (m) { return h('li', h('strong', m.letters), ' ', m.title); }))] : null,
    r.pearls.length ? [h('h3', 'Pearls'), h('ul.rs-pearls', r.pearls.map(function (t) { return h('li', marked(t)); }))] : null,
    button('Close', close, 'primary', { 'data-autofocus': true, id: 'review-close' }));
  var closeFn = Dialog.open(el, doc.getElementById('app'));
}
/* What only a pack's lesson has (pack.js): the label saying who wrote it,
   the mechanism, the pairs that get confused, the pearls. */
function packCards(L) {
  var asks = (L.cases || []).reduce(function (a, cs) { return a.concat(cs.asks); }, []);
  var flagged = (L.points || []).concat(L.numbers || [], L.pearls || [], L.distinctions || [], asks).filter(function (x) { return x.flag; }).length +
    Object.keys(L.flags || {}).length;
  return {
    label: h('p.pack-label', { id: 'pack-label' }, h('strong', '\u2726 Written with Claude'), ' \u00B7 checked against your book',
      flagged ? h('span.pack-flagged', ' \u00B7 ' + flagged + ' not found in it, flagged') : null),
    mechanism: L.mechanism ? h('div.card.mechanism', { id: 'mechanism' }, h('span.eyebrow', 'The mechanism'), h('p', marked(L.mechanism)),
      flagLine(L.flags && L.flags.mechanism)) : null,
    distinctions: (L.distinctions || []).length ? h('div.card.distinctions', { id: 'distinctions' }, h('span.eyebrow', 'Don\u2019t confuse'),
      h('ul.confuse', L.distinctions.map(function (x) {
        return h('li', h('p.confuse-pair', h('strong', x.a), h('span.vs', ' vs '), h('strong', x.b)), h('p', marked(x.how), ' ', page(x.page)), flagLine(x.flag));
      }))) : null,
    pearls: (L.pearls || []).length ? h('div.card.pearls', { id: 'pearls' }, h('span.eyebrow', 'Exam pearls'),
      h('ul.pearl-list', L.pearls.map(function (x) { return h('li', marked(x.text), ' ', page(x.page), flagLine(x.flag)); }))) : null,
  };
}
function viewLesson() {
  var s = ui.state, c = cluster(), L = s.per[s.section].lesson;
  if (!L) return [sectionBar('teach'), ui.error ? errorCard(pump) : busyCard()];
  var sh = Sheet.sheetOf(L);
  var analogies = L.analogies || [];
  var mnemonics = (L.mnemonics || []).map(function (m) {
    return h('div.card.hook', h('span.eyebrow', 'Remember it'), h('h3', m.title),
      h('p.hook-script', m.letters.split('').join(' · ')),
      h('ul.acrostic', m.words.map(function (w) { return h('li', h('span.letter', w.charAt(0).toUpperCase()), h('span.word', w)); })),
      h('p.muted', 'Say the letters, then name each one.'));
  });
  var full = h('details.source', h('summary', 'Read the whole section'),
    c.segments.map(function (seg) {
      if (seg.table) return null;
      if (seg.heading) return h('h3', seg.text);
      return h(seg.item ? 'p.item' : 'p', marked(seg.text), ' ', page(seg.page));
    }));
  var n = 0;
  var all = [{ text: sh.bigIdea }].concat(sh.groups.reduce(function (a, g) { return a.concat(g.points); }, []));
  var tools = h('div.row',
    button('🖼 Study card', function () { showFigure(Figure.studyCard(c.title, sh, L.mnemonics || [], sourceLine(ui.docRec, c)), c.title + ' study card', fromPack ? 'Written with Claude from your book, and checked against it; arranged by Memorizer.' : ''); }, 'quiet', { id: 'make-card' }),
    button('🔊 Listen', function () { speak(all.map(function (p) { return p.text; }).join('. ')); }, 'quiet'),
    button('📋 One screen', function () { showReview(c, L); }, 'quiet', { id: 'one-screen' }));
  var group = function (g) {
    return h('section.point-group', h('h3.group-head', h('span.group-mark', { 'aria-hidden': 'true' }, HEAD_MARK[g.heading] || '•'), g.heading),
      h('ol.points', { start: String(n + 1) }, g.points.map(function (p) { return pointCard(c, p, n++); })));
  };
  var fromPack = L.by === 'pack';
  var bigIdea = h('div.card.big-idea', { id: 'big-idea' }, h('span.eyebrow', 'The big idea'), h('p.big', marked(sh.bigIdea)),
    fromPack && L.flags && sh.bigIdea === L.overview ? flagLine(L.flags.overview) : null);
  var pk = fromPack ? packCards(L) : {};
  var moreAnalogies = analogies.length > 1 ? h('details.card.more-analogies', h('summary', 'More analogies (' + (analogies.length - 1) + ')'), analogies.slice(1).map(function (a) { return analogyCard(a, false); })) : null;
  /* the built-in pathway is on the glance card; a model's flowchart is its own */
  var flowCard = L.flowchart && L.flowchart.trim() || !(Sheet.glance(c) || {}).pathway || !Sheet.glance(c).pathway.length ? drawFlowCard(c, L) : null;
  /* the drill opens only once the section is memorised (session.js) */
  var drill = h('div.end-cta', s.per[s.section].memorized
    ? button('Start the drill', function () { go({ type: 'toDrill' }); }, 'primary big', { id: 'to-drill' })
    : button('I’ve got it — now memorise it', function () { go({ type: 'toMemorize', value: { cards: Coach.recallCards(c, L).length } }); }, 'primary big', { id: 'to-drill' }));
  var gl = Sheet.glance(c, (L.mnemonics || []).map(function (m) { return m.title; }));
  var mapC = mapCard(c), soc = socraticCard(c, L, gl), rounds = roundsCard(L);
  if (stepMode()) {
    /* STEP BY STEP, in the stages of the owner's plan (sheet.js stages):
       orient — the idea and the section's clinical map; mechanism — how it
       works, then why, asked down the chain; recognise — the glance and each
       heading's points, the pearls; numbers; don't confuse; recall — the
       mnemonics, a check, teaching it back, rounds; then what else the
       section has. The drill at the end. */
    var parts = [{ label: 'The big idea', stage: 'orient', nodes: [pk.label, bigIdea, analogies.length ? analogyCard(analogies[0], true) : null] }];
    if (mapC) parts.push({ label: 'Clinical map', stage: 'orient', nodes: [mapC] });
    if (pk.mechanism) parts.push({ label: 'The mechanism', stage: 'mechanism', nodes: [pk.mechanism] });
    if (gl && gl.pathway.length >= 2) parts.push({ label: 'How it works', stage: 'mechanism', nodes: [pathwayPlay(gl.pathway)] });
    if (soc) parts.push({ label: 'Why? Why? Why?', stage: 'mechanism', nodes: [soc] });
    var facts = glanceCard(c, L, true);
    if (facts) parts.push({ label: 'At a glance', stage: 'recognise', nodes: [facts] });
    sh.groups.forEach(function (g) {
      parts.push({ label: g.heading, stage: 'recognise', nodes: [h('div.card', { id: 'points' }, h('div.card-head', h('h2', 'Key points'), tools), group(g))] });
    });
    if (pk.pearls) parts.push({ label: 'Exam pearls', stage: 'recognise', nodes: [pk.pearls] });
    var nums = numbersCard(sh, true);
    if (nums) parts.push({ label: 'Numbers to know', stage: 'numbers', nodes: [nums] });
    if (pk.distinctions) parts.push({ label: 'Don\u2019t confuse', stage: 'confuse', nodes: [pk.distinctions] });
    (L.mnemonics || []).forEach(function (m) { parts.push({ label: 'Remember it: ' + m.title, stage: 'recall', nodes: [mnemonicPlay(m)] }); });
    var qc = quickCheck(c, L);
    if (qc) parts.push({ label: 'Check yourself', stage: 'recall', nodes: [qc] });
    parts.push({ label: 'Teach it back', stage: 'recall', nodes: [teachCard(c, L)] });
    if (rounds) parts.push({ label: 'Rounds', stage: 'recall', nodes: [rounds] });
    parts.push({ label: 'Also in this section', stage: 'recall', nodes: [moreAnalogies, flowCard, tablesCard(c), visualsCard(c), noteCard(c), fixCard(c), full] });
    var key = ui.docId + ':' + s.section;
    if (!ui.step || ui.step.key !== key) ui.step = { key: key, i: 0 };
    var i = Math.min(ui.step.i, parts.length - 1), last = i === parts.length - 1;
    var move = function (d) { ui.step.i = Math.max(0, Math.min(parts.length - 1, i + d)); render(); root.scrollTo(0, 0); };
    var has = {};
    parts.forEach(function (pt) { has[pt.stage] = true; });
    var stageList = Sheet.stages(has), now = parts[i].stage, nowAt = -1;
    stageList.forEach(function (st, k) { if (st.id === now) nowAt = k; });
    return [
      sectionBar('teach'),
      ocrNote(c),
      h('ol.stage-strip', { id: 'stages', 'aria-label': 'Stages of this lesson' }, stageList.map(function (st, k) {
        var first = -1;
        parts.forEach(function (pt, j) { if (first === -1 && pt.stage === st.id) first = j; });
        return h('li', { 'data-state': k === nowAt ? 'now' : k < nowAt ? 'done' : 'next', 'data-stage': st.id },
          button(st.label, function () { if (first !== -1) { ui.step.i = first; render(); root.scrollTo(0, 0); } }, 'quiet stage-btn',
            { 'aria-current': k === nowAt ? 'step' : null, disabled: first === -1 ? true : null }));
      })),
      h('div.step-head', { id: 'lesson-steps' },
        h('div.step-count', h('strong', 'Slide ' + (i + 1) + '/' + parts.length), h('span', ' · ' + parts[i].label)),
        button('↻ Replay', function () { replay(); }, 'quiet', { id: 'replay' }),
        button('Show the whole lesson', function () { setStepMode(false); render(); }, 'quiet', { id: 'whole-page' })),
      h('div.bar.step-bar', h('i', { style: 'width:' + Math.round(100 * (i + 1) / parts.length) + '%' })),
      parts[i].nodes,
      h('div.step-nav', button('← Back', function () { move(-1); }, 'quiet', { id: 'step-back', disabled: i === 0 ? true : null }),
        last ? drill : button('Next →', function () { move(1); }, 'primary big', { id: 'step-next' })),
    ];
  }
  return [
    sectionBar('teach'),
    ocrNote(c),
    h('div.row.lesson-mode', button('▶ Play this section', function () { setStepMode(true); ui.step = null; render(); root.scrollTo(0, 0); }, 'quiet', { id: 'step-mode' })),
    pk.label,
    bigIdea,
    mapC,
    pk.mechanism,
    soc,
    glanceCard(c, L),
    analogies.length ? analogyCard(analogies[0], true) : null,
    h('div.card', { id: 'points' },
      h('div.card-head', h('h2', 'Key points'), tools),
      sh.groups.map(group),
      h('p.muted.arranged-note', fromPack ? 'Headings arranged by Memorizer; the points written with Claude from your book.' : 'Headings arranged by Memorizer; the points are your book’s.')),
    numbersCard(sh),
    pk.distinctions,
    pk.pearls,
    mnemonics,
    /* after everything has been read: recall, not a look at the next card */
    quickCheck(c, L),
    teachCard(c, L),
    rounds,
    noteCard(c),
    fixCard(c),
    moreAnalogies,
    /* the on-device AI tutor is in the robot's window now (robot()) */
    flowCard,
    tablesCard(c),
    visualsCard(c),
    full,
    drill,
  ];
}
/* Exam conditions and focus: the reader's choices, remembered on this
   device (a convenience — lost storage means off). Focus hides the dock,
   the robot and the aurora while studying a section. */
var EXAM_KEY = 'memorizer.exammode.v1', FOCUS_KEY = 'memorizer.focus.v1';
function flag_(k, cache) { if (ui[cache] == null) { try { ui[cache] = root.localStorage.getItem(k) === '1'; } catch (_) { ui[cache] = false; } } return ui[cache]; }
function setFlag_(k, cache, on) { ui[cache] = !!on; try { root.localStorage.setItem(k, on ? '1' : '0'); } catch (_) {} }
function examMode() { return flag_(EXAM_KEY, 'examMode'); }
function setExamMode(on) { setFlag_(EXAM_KEY, 'examMode', on); }
function focusOn() { return flag_(FOCUS_KEY, 'focus'); }
function applyFocus() { doc.documentElement.setAttribute('data-focus', focusOn() && ui.view === 'session' ? 'on' : 'off'); }
/* Step by step or the whole page: the reader's choice, remembered on this
   device (a convenience — lost storage means the whole page). */
var STEP_KEY = 'memorizer.stepmode.v1';
function stepMode() {
  if (ui.stepMode == null) { try { ui.stepMode = root.localStorage.getItem(STEP_KEY) === '1'; } catch (_) { ui.stepMode = false; } }
  return ui.stepMode;
}
function setStepMode(on) {
  ui.stepMode = !!on;
  try { root.localStorage.setItem(STEP_KEY, on ? '1' : '0'); } catch (_) {}
}

/* The lesson's AI card: plain words and an analogy, on request. */
function aiLessonCard(c, L) {
  if (!aiOn()) return null;
  var key = ui.docId + ':' + ui.state.section, got = ui.ai.lesson[key] || {};
  var text = c.segments.map(function (s) { return s.text; }).join(' ');
  var points = L.points.map(function (p) { return p.text; });
  return h('div.card.ai-card', { id: 'ai-lesson' }, h('span.eyebrow', '✨ On-device AI tutor'),
    got.plain ? [h('h3', 'In plain words'), got.plain.kept.length ? h('p', { id: 'ai-plain-text' }, got.plain.kept.join(' ')) : h('p.muted', 'Nothing it wrote could be checked against the section, so nothing is shown.'),
      aiNote(got.plain.kept, got.plain.dropped.length)] : null,
    got.analogy ? [h('h3', 'Think of it like…'), got.analogy.ok ? h('p', { id: 'ai-analogy-text' }, got.analogy.text) : h('p.muted', 'Its analogy was dropped: ' + got.analogy.why + '.'),
      h('p.muted.ai-label', '✨ Analogy by the on-device AI — not from your book; checked to carry no number and no name the section does not.')] : null,
    ui.ai.busy ? h('p.muted', { role: 'status' }, ui.ai.busy) : null,
    ui.ai.status && !LLM.ready() ? h('p.muted', ui.ai.status) : null,
    ui.ai.error ? h('p.warn', 'The on-device AI could not run: ' + ui.ai.error) : null,
    h('div.row', button('Explain in plain words', function () {
      aiJob('Explaining…', function () { return LLM.chat(LLM.SYSTEM, LLM.plainPrompt(c.title, points), null, 220); }).then(function (t) {
        if (t == null) return; got.plain = Ground.plain(t, text); ui.ai.lesson[key] = got; render();
      });
    }, 'quiet', { id: 'ai-plain' }), button('An analogy', function () {
      aiJob('Thinking of an analogy…', function () { return LLM.chat(LLM.SYSTEM, LLM.analogyPrompt(c.title, points), null, 120); }).then(function (t) {
        if (t == null) return; var why = Ground.analogyError(t, text); got.analogy = { text: t.trim(), ok: !why, why: why }; ui.ai.lesson[key] = got; render();
      });
    }, 'quiet', { id: 'ai-analogy' })));
}

/* ── DRILL and EXAM: multiple choice ─────────────────────────────────────── */
var LETTERS = 'ABCDEFGH';
/* One question: options as big buttons; once one is chosen, the right one
   turns green, a wrong choice red, and the book's reason is shown. The
   answer is recorded on Next, not on the tap. */
/* `nav` (drill and exam): { hist, back } — the answers given so far and how
   far back the reader is looking. Looking back shows an answered question
   as it was answered, read-only: answers are recorded on Next, and changing
   one afterwards would change a score and a review card already made. */
function mcqCard(q, meta, onNext, reveal, nav, after, opts) {
  var askSure = !!(opts && opts.sure), blind = !!(opts && opts.blind);
  var past = nav && nav.back > 0 ? nav.hist[nav.hist.length - nav.back] : null;
  var chosen = past ? past.choice : ui.choice;
  var answered = chosen != null;
  var unsure = chosen === Session.NOT_SURE;
  var canPrev = nav && nav.hist.length - nav.back > 0;
  var prev = canPrev ? button('← Previous', function () { ui.back = nav.back + 1; render(); }, 'quiet', { id: 'prev-q' }) : null;
  var fwd = past ? button(nav.back === 1 ? 'Back to the current question →' : 'Forward →', function () { ui.back = nav.back - 1; render(); }, 'primary big', { id: 'fwd-q' }) : null;
  var quote = q.quote ? h('blockquote.quote', q.quote.split('_____').map(function (part, i, all) {
    return [part, i < all.length - 1 ? h('span.gap', answered && !blind ? q.options[q.answer] : '_____') : null];
  })) : null;
  var opts = h('div.options', { role: 'group', 'aria-label': 'Options' }, q.options.map(function (o, i) {
    var cls = '';
    /* EXAM CONDITIONS: the choice is held, and whether it was right waits
       for the end, as in the exam hall */
    if (answered) cls = blind ? (i === chosen ? '.chosen' : '.dim') : i === q.answer ? '.right' : i === chosen ? '.wrong' : '.dim';
    return h('button.option' + cls, { type: 'button', disabled: answered || past ? true : null, 'data-i': String(i),
        onclick: function () { ui.choice = i; render(); } },
      h('span.opt-letter', LETTERS[i]), h('span.opt-text', o));
  }));
  var right = answered && chosen === q.answer;
  /* "Not sure" is an answer, not a skip: the skill files it as never
     encountered, and it is re-taught from the page (skill.js). */
  var notSure = answered || past ? null : h('div.row.not-sure-row', askSure ? sureToggle() : null, button('Not sure', function () { ui.choice = Session.NOT_SURE; render(); }, 'quiet', { id: 'not-sure' }));
  return h('div.card.mcq', { id: 'mcq' },
    h('div.mcq-meta', meta),
    quote,
    h('h2.q', q.question),
    opts,
    notSure,
    answered && blind ? h('div.why.blind', { role: 'status', id: 'blind-note' }, h('p.muted', 'Answer held \u2014 you will see how you did at the end.'),
      past ? null : h('div.row.mcq-nav', prev, button('Next \u2192', onNext, 'primary big', { id: 'next' }))) :
    answered ? h('div.why' + (right ? '.good' : '.bad'), { role: 'status' },
      h('strong', right ? '✓ Correct' : (unsure ? '✗ Not sure \u2014 the answer is ' : '✗ The answer is ') + LETTERS[q.answer] + ': ' + q.options[q.answer]),
      reveal ? h('p.muted', reveal) : null,
      askSure && !right && !unsure && ui.sure ? hazardNote() : null,
      h('p', h('span.why-label', 'Why: '), marked(q.explain), q.page ? [' ', page(q.page)] : null),
      whyNot(q, chosen, right),
      past ? null : after ? after(chosen, right) : right ? null : h('p.muted', 'This one is now a review card, and it comes back at the end of this drill.'),
      past ? null : h('div.row.mcq-nav', prev, button('Next →', onNext, 'primary big', { id: 'next' }))) : null,
    past ? h('div.row.mcq-nav', prev, fwd) : !answered && prev ? h('div.row.mcq-nav', prev) : null);
}
/* A pack's question (pack.js) says why each wrong option is wrong, and
   names the trap it sets: the reason for the one chosen first, then every
   option's, folded. */
function whyNot(q, chosen, right) {
  var why = q.why || [];
  var mine = !right && chosen >= 0 && why[chosen] ? h('p.why-not', { id: 'why-not' }, h('span.why-label', 'Why not ' + LETTERS[chosen] + ': '), marked(why[chosen])) : null;
  var all = why.length === q.options.length && why.some(Boolean) ? h('details.why-all', { id: 'why-all' }, h('summary', 'Why each option is right or wrong'),
    h('ul', q.options.map(function (o, i) {
      return h('li' + (i === q.answer ? '.right' : ''), h('strong', LETTERS[i] + '. ' + o), ' \u2014 ', i === q.answer ? 'the answer.' : marked(why[i] || ''));
    }))) : null;
  return [mine, q.trap ? h('p.trap', { id: 'trap' }, h('span.why-label', 'The trap: '), q.trap) : null, flagLine(q.flag), all];
}
/* Sure or not, said before answering (study.js rateWith). */
function sureToggle() {
  return button(ui.sure ? '✓ I’m sure' : 'I’m sure', function () { ui.sure = !ui.sure; render(); }, ui.sure ? 'chip sure-on' : 'chip quiet',
    { id: 'sure', 'aria-pressed': String(!!ui.sure), title: 'Say it before you answer: a confident miss is flagged and asked again' });
}
function hazardNote() {
  return h('p.hazard-note', { id: 'hazard-note' }, h('span.hazard-lead', '⚠ You were sure. '), 'A confident miss is the most dangerous kind: it is flagged, and asked again before you finish.');
}
function navOf(hist) {
  hist = hist || [];
  ui.back = Math.max(0, Math.min(ui.back || 0, hist.length));
  return { hist: hist, back: ui.back };
}
/* MEMORIZE: active recall, one card at a time. Try to bring it back, then
   look, then say honestly whether you knew it; one not known comes back at
   the end. The drill opens when every card has been known once. */
var RECALL_LABEL = { idea: 'The big idea', point: 'Key point', number: 'Number to know', mnemonic: 'Mnemonic', chain: 'The chain' };
function viewMemorize() {
  var s = ui.state, c = cluster(), p = s.per[s.section], m = p.memo;
  var cards = Coach.recallCards(c, p.lesson), card = cards[m.order[m.pos]];
  if (!card) return [sectionBar('memorize'), h('div.card', h('p', 'This section’s cards have changed.'), button('Back to the lesson', function () { go({ type: 'open', section: s.section }); }, 'primary'))];
  var shown = ui.recallShown === m.pos;
  var rate = function (knew) { ui.recallShown = null; go({ type: 'recalled', knew: knew }); };
  return [sectionBar('memorize'),
    h('div.card.recall', { id: 'recall' },
      h('div.mcq-meta', h('span', 'Card ' + (m.pos + 1) + ' of ' + m.order.length + (m.pos >= cards.length ? ' · again' : '')),
        h('div.bar', h('i', { style: 'width:' + Math.round(100 * m.pos / m.order.length) + '%' }))),
      h('span.eyebrow', RECALL_LABEL[card.kind] || 'Recall'),
      h('p.recall-prompt', card.prompt),
      shown ? h('div.recall-answer', { id: 'recall-answer' }, h('strong', card.answer),
        card.full && card.full !== card.answer ? h('p.muted', card.full, card.page ? [' ', page(card.page)] : null) : null) : null,
      shown ? h('div.row.recall-rate', button('✗ Not yet', function () { rate(false); }, 'quiet', { id: 'recall-notyet' }),
          button('✓ I knew it', function () { rate(true); }, 'primary big', { id: 'recall-knew' }))
        : h('div.row', button('Show the answer', function () { ui.recallShown = m.pos; render(); }, 'primary big', { id: 'recall-show' })),
      h('p.muted', 'Say it first — aloud or in your head — then look. The drill opens when every card has been known once.')),
    h('div.row', button('← Back to the lesson', function () { go({ type: 'open', section: s.section }); }, 'quiet', { id: 'recall-lesson' }))];
}
function viewDrill() {
  var s = ui.state, c = s.per[s.section];
  if (!c.quiz) return [sectionBar('drill'), ui.error ? errorCard(pump) : busyCard()];
  var qi = c.order[c.pos], q = c.quiz.questions[qi];
  var nav = navOf(c.answers);
  if (nav.back) {
    var rec = nav.hist[nav.hist.length - nav.back];
    return [sectionBar('drill'), mcqCard(c.quiz.questions[rec.q], [h('span.looking-back', 'Looking back · answer ' + (nav.hist.length - nav.back + 1) + ' of ' + nav.hist.length)], null, null, nav)];
  }
  var retry = c.order.indexOf(qi) !== c.pos;
  var firsts = c.quiz.questions.length;
  var meta = [h('span', retry ? 'Again — you missed this one' : 'Question ' + (Math.min(c.pos, firsts - 1) + 1) + ' of ' + firsts),
    q.by === 'ai' ? h('span.tag.ai-tag', '✨ AI question · its answer checked against your book') : null,
    q.by === 'pack' ? h('span.tag.pack-tag', { 'data-flagged': q.flag ? 'true' : 'false' }, q.flag ? '\u2726 Written with Claude \u00B7 \u26A0 not all of it found in your book' : '\u2726 Written with Claude \u00B7 checked against your book') : null,
    h('div.bar', h('i', { style: 'width:' + Math.round(100 * c.pos / c.order.length) + '%' }))];
  /* The kind of miss, read from what happened (skill.js); a second miss in
     a row is re-taught on the spot with a different kind of hook. */
  var after = function (chosen, right) {
    if (right) return retry ? typeChip('R', '', 'It came back when asked again.') : null;
    if (retry) return [typeChip('E', ''), reteachCard(Coach.reteach({ q: q, types: ['E'], confusedWith: '' }, cluster()))];
    var t = Session.missType(q, chosen).t, picked = chosen >= 0 ? q.options[chosen] : '';
    /* a wrong value is anchored at once, among the section's other values */
    return [typeChip(t, t === 'C' || t === 'V' ? picked : ''), t === 'V' ? reteachCard(Coach.reteach({ q: q, types: ['V'], confusedWith: picked }, cluster())) : null,
      h('p.muted', 'Now a review card; it comes back at the end of this drill.')];
  };
  return [sectionBar('drill'), mcqCard(q, meta, function () { go({ type: 'answered', choice: ui.choice, sure: !!ui.sure }); }, null, nav, after, { sure: true })];
}
/* The error type of a miss, and the skill's fix for it. */
function typeChip(t, confusedWith, lead) {
  var e = Skill.ERRORS[t];
  return h('div.type-chip', { 'data-type': t, id: 'type-chip' },
    h('span.type-badge', 'Type ' + t + ' \u00B7 ' + e.name),
    h('span', lead ? lead + ' ' : '', (t === 'C' || t === 'V') && confusedWith ? 'You picked \u201C' + confusedWith + '\u201D. ' : '', e.fix));
}
/* A re-teach (Coach.reteach): every line the book's own sentence. */
function reteachCard(r) {
  return h('div.reteach', { id: 'reteach', 'data-hook': r.hookType || 'none' },
    h('span.eyebrow', 'Re-teach \u00B7 ' + (Skill.HOOKS[r.hookType] || 'More retrieval')),
    h('h3', r.title),
    r.lines.map(function (l) {
      return h('div.reteach-line' + (l.app ? '.app' : ''),
        h('span.reteach-label', l.label),
        l.chain ? h('p.chain', l.chain.map(function (x, i) { return i % 2 ? h('span.chain-verb', ' ' + x + ' \u2192 ') : h('strong', x); }))
          : h('p', marked(l.text), l.page ? [' ', page(l.page)] : null));
    }));
}
/* A review round of the weak list: cold retest, interleaved (skill §7). */
function viewReviewRound() {
  var s = ui.state, r = s.review, w = Session.reviewItem(s), q = w.q;
  var n = r.queue.length;
  var meta = [h('span', (r.final ? 'Before the exam \u00B7 ' : '') + 'Review round \u00B7 cold retest \u00B7 ' + (r.idx + 1) + ' of ' + n),
    h('div.bar', h('i', { style: 'width:' + Math.round(100 * r.idx / n) + '%' }))];
  var from = ui.docRec.clusters[w.cluster] ? ui.docRec.clusters[w.cluster].title : '';
  var after = function (chosen, right) {
    if (right) return h('p.muted', w.hits.length ? 'Right again, in a later round: that graduates it off the weak list.' : 'Right. One more time in a later round and it graduates.');
    var t = w.streak >= 1 ? 'E' : Session.missType(q, chosen).t;
    var picked = chosen >= 0 ? q.options[chosen] : '';
    var item = { q: q, types: w.types.concat([t]), confusedWith: t === 'C' || t === 'V' ? picked : w.confusedWith };
    return [typeChip(t, picked), Session.needsReteach(s) ? reteachCard(Coach.reteach(item, ui.docRec.clusters[w.cluster])) : null,
      h('p.muted', 'It comes back once more at the end of this round.')];
  };
  return [backBar('Review round', function () { go({ type: 'toUnit' }); }),
    mcqCard(q, meta, function () { go({ type: 'reviewAnswered', choice: ui.choice }); }, from ? 'From \u201C' + from + '\u201D' : '', null, after)];
}
/* Text to the clipboard, and `status` says whether it got there. */
function copyText(text, status, onFail) {
  var done = function () { status.textContent = 'Copied.'; };
  try {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) { root.navigator.clipboard.writeText(text).then(done, fallback); return; }
  } catch (_) {}
  fallback();
  function fallback() {
    var ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px' }); ta.value = text; doc.body.appendChild(ta); ta.select();
    var copied = false;
    try { copied = doc.execCommand('copy'); } catch (_) {}
    doc.body.removeChild(ta);
    if (copied) done();
    else { status.textContent = 'Your browser would not copy it.'; if (onFail) onFail(); }
  }
}
/* The skill's closing deliverable, after the exam (skill §16). */
function closingCard(s) {
  var c = Session.closing(s), status = h('span.muted', { id: 'copy-status', role: 'status' });
  var copy = function () { copyText(Session.closingText(s), status); };
  return h('div.card.closing', { id: 'closing' },
    h('h2', 'Your sheet for the exam'),
    h('h3', 'Three pillars'), h('ol.pillars', c.pillars.map(function (p) { return h('li', marked(p.text), p.page ? [' ', page(p.page)] : null); })),
    c.sheet.length ? [h('h3', 'Mnemonic sheet'), h('ul.mnemonic-sheet', c.sheet.map(function (m) {
      return h('li', h('strong.letters', m.letters), ' ', m.title, h('span.muted', ' \u2014 ' + m.words.join(', ')));
    }))] : null,
    h('h3', 'Weak-area report'),
    c.weak.length ? h('ul.weak-report', c.weak.map(function (w) {
      return h('li', { 'data-graduated': String(w.graduated) },
        h('strong', w.answer), ' ', w.page ? page(w.page) : null,
        h('span.muted', ' \u2014 ' + w.misses + (w.misses === 1 ? ' miss' : ' misses') + ', type ' + w.types.join('/') +
          (w.confusedWith ? ', confused with \u201C' + w.confusedWith + '\u201D' : '') + (w.graduated ? ' \u00B7 graduated' : ' \u00B7 still weak')));
    })) : h('p', 'Nothing was missed.'),
    h('div.row', button('Copy sheet', copy, '', { id: 'copy-sheet' }), status));
}

function viewResult() {
  var s = ui.state, c = s.per[s.section], d = ui.docRec;
  var qs = c.quiz.questions, firsts = c.answers.filter(function (a) { return a.first; });
  if (!qs.length) {
    var nx = Session.nextSection(s);
    return [backBar(cluster().title, function () { go({ type: 'toUnit' }); }),
      h('div.card.result', { id: 'result' }, h('h2', 'Nothing here to drill'),
        h('p', 'This section is too short to ask good questions of. It counts as done; its lesson is always here to re-read.')),
      h('div.row.result-actions', nx != null ? button('Next section: ' + d.clusters[nx].title, function () { go({ type: 'open', section: nx }); }, 'primary big', { id: 'next-section' })
        : button('Take the final exam', function () { go({ type: 'toExam' }); }, 'primary big', { id: 'to-exam' }),
        button('Back to sections', function () { go({ type: 'toUnit' }); }))];
  }
  var right = firsts.filter(function (a) { return a.correct; }).length;
  var missed = firsts.filter(function (a) { return !a.correct; }).map(function (a) { return qs[a.q]; });
  var nxt = Session.nextSection(s);
  var pct = Math.round(100 * c.score);
  return [
    backBar(cluster().title, function () { go({ type: 'toUnit' }); }),
    h('div.card.result', { id: 'result' }, ring(pct, 'big'),
      h('h2', right + ' of ' + firsts.length + ' right first time'),
      h('p', pct >= 90 ? 'Excellent — you know this section today. Its review cards over the coming days are what make it last.'
        : pct >= 70 ? 'Good. Look over the ones you missed, then move on; they come back as review cards.'
        : 'Worth another pass: re-read the key points, then drill again before moving on.')),
    missed.length ? h('div.card', h('h2', 'What you missed'), h('ul.missed', missed.map(function (q) {
      return h('li', h('strong', q.question), h('p', '→ ', q.options[q.answer], ' ', q.page ? page(q.page) : null));
    }))) : null,
    h('div.row.result-actions',
      s.reviewDue ? button('Review round: ' + Session.pending(s).length + ' weak item' + (Session.pending(s).length === 1 ? '' : 's') + ', mixed', function () { go({ type: 'toReview' }); }, 'primary big', { id: 'review-round' }) : null,
      nxt != null ? button('Next section: ' + d.clusters[nxt].title, function () { go({ type: 'open', section: nxt }); }, 'primary big', { id: 'next-section' })
        : button('Take the final exam', function () { go({ type: 'toExam' }); }, 'primary big', { id: 'to-exam' }),
      button('Drill again', function () { go({ type: 'redrill' }); }, '', { id: 'redrill' }),
      button('Back to the lesson', function () { go({ type: 'open', section: s.section }); }, 'quiet')),
    aiOn() ? caseCard(d, s.section) : null,
  ];
}
/* A case by the on-device model (study.js): kept only if its answer is a
   sentence of the section (ground.js question) and its story names no
   number, disease, test or drug the section does not. */
function aiCase(d, ci) {
  var c = d.clusters[ci], sents = Coach.sentences(c);
  if (sents.length < 3) return Promise.resolve({ q: null, why: 'this section is too short for a case' });
  return aiJob('Writing a case from this section\u2026', function () { return LLM.chat(LLM.SYSTEM, Study.vignettePrompt(c.title, sents), Study.VIGNETTE_SCHEMA, 420); })
    .then(function (t) {
      if (t == null) return { q: null, why: 'the on-device AI could not run' };
      var v = Study.parseVignette(t);
      if (!v) return { q: null, why: 'its reply was not a case with four options' };
      var bad = Ground.claimError(v.quote, [c.text], 0);
      if (bad && !/too little|says nothing|nothing in it/.test(bad)) return { q: null, why: 'the case ' + bad };
      var g = Ground.question(v, sents);
      return g.q ? { q: g.q, why: '' } : { q: null, why: g.why };
    });
}
function caseCard(d, ci) {
  var key = d.id + ':' + ci, got = ui.ai.cases && ui.ai.cases[key];
  if (!got) return h('div.card.case-card', { id: 'case-card' }, h('span.eyebrow', '✨ A case'),
    h('p.muted', 'The on-device AI writes a short patient case on this section; it is kept only if its answer is a sentence of your book.'),
    ui.ai.busy ? h('p.muted', { role: 'status' }, ui.ai.busy) : button('Write a case', function () {
      aiCase(d, ci).then(function (r) { ui.ai.cases = ui.ai.cases || {}; ui.ai.cases[key] = r; ui.choice = null; render(); });
    }, 'quiet', { id: 'ai-case' }));
  if (!got.q) return h('div.card.case-card', { id: 'case-card' }, h('span.eyebrow', '✨ A case'), h('p', { id: 'case-dropped' }, 'Not shown: ' + got.why + '. Your book stays the source.'),
    button('Try another', function () { delete ui.ai.cases[key]; render(); }, 'quiet'));
  return h('div', { id: 'case-card' }, mcqCard(got.q, [h('span.tag.ai-tag', '✨ A case by the on-device AI · its answer checked against your book')],
    function () { delete ui.ai.cases[key]; ui.choice = null; render(); }, null, null, function () { return null; }));
}
function viewExam() {
  var s = ui.state, g = s.exam;
  var bar = backBar('Final exam', function () { go({ type: 'toUnit' }); });
  if (!g.questions) return [bar, ui.error ? errorCard(pump) : busyCard()];
  var nav = navOf(g.results);
  if (nav.back) {
    var rec = nav.hist[nav.hist.length - nav.back], pq = g.questions[rec.q];
    var pfrom = pq.cluster != null && ui.docRec.clusters[pq.cluster] ? ui.docRec.clusters[pq.cluster].title : '';
    return [bar, mcqCard(pq, [h('span.looking-back', 'Looking back · answer ' + (nav.hist.length - nav.back + 1) + ' of ' + nav.hist.length)], null, pfrom ? 'From “' + pfrom + '”' : '', nav, null, { blind: examMode() })];
  }
  var qi = g.order[g.pos], q = g.questions[qi];
  /* The section is named only once answered: its title is often the answer. */
  var from = q.cluster != null && ui.docRec.clusters[q.cluster] ? ui.docRec.clusters[q.cluster].title : '';
  var clock = null;
  if (examMode()) {
    var ek = ui.docId + ':' + s.round;
    if (!ui.examStart || ui.examStart.key !== ek) ui.examStart = { key: ek, at: Date.now() };
    var ck = Study.examClock(ui.examStart.at, Date.now(), g.order.length, g.pos);
    clock = h('span.exam-clock' + (ck.behind ? '.behind' : ''), { id: 'exam-clock' }, '\u23F1 ' + ck.elapsed + ' of ' + ck.target);
  }
  var meta = [h('span', 'Question ' + (g.pos + 1) + ' of ' + g.order.length), clock, h('div.bar', h('i', { style: 'width:' + Math.round(100 * g.pos / g.order.length) + '%' }))];
  return [bar, mcqCard(q, meta, function () { go({ type: 'examAnswered', choice: ui.choice }); }, from ? 'From “' + from + '”' : '', nav, null, { blind: examMode() })];
}
function viewDone() {
  var s = ui.state, g = s.exam, d = ui.docRec;
  var by = {};
  g.results.forEach(function (r) {
    var q = g.questions[r.q], k = q.cluster == null ? -1 : q.cluster;
    by[k] = by[k] || { right: 0, n: 0 }; by[k].n++; if (r.correct) by[k].right++;
  });
  var pct = Math.round(100 * (g.score || 0));
  return [
    backBar(d.name, function () { go({ type: 'toUnit' }); }),
    h('div.card.result', { id: 'result' }, ring(pct, 'big'), h('h2', 'Final exam: ' + pct + '%'),
      h('p', pct >= 85 ? 'Exam passed. That is today\u2019s recall: keep up the review cards over the coming days to turn it into long-term memory.' : 'Review the sections below the line, then retake the exam.')),
    h('div.card', h('h2', 'By section'), h('ul.by-section', Object.keys(by).map(function (k) {
      var t = +k >= 0 ? d.clusters[+k].title : 'Across the unit', b = by[k];
      return h('li', h('span', t), h('span.badge', b.right + '/' + b.n));
    }))),
    examMissed(g),
    closingCard(s),
    h('div.row', button('Retake the exam', function () { go({ type: 'toExam' }); }, 'primary', { id: 'retake' }),
      button('Back to sections', function () { go({ type: 'toUnit' }); })),
  ];
}
/* What the exam got wrong, each with the answer, why, and — for a pack's
   question — why the option picked was wrong: the review exam conditions
   held back until the end. */
function examMissed(g) {
  var wrong = g.results.filter(function (r) { return !r.correct; });
  if (!wrong.length) return null;
  return h('div.card', { id: 'exam-missed' }, h('h2', 'What you missed (' + wrong.length + ')'),
    h('ol.missed', wrong.map(function (r) {
      var q = g.questions[r.q], mine = r.choice >= 0 ? q.options[r.choice] : 'Not sure';
      return h('li', h('strong', q.question), h('p.muted', 'You: ' + mine), h('p', '\u2192 ', h('strong', q.options[q.answer]), ' ', q.page ? page(q.page) : null),
        h('p', h('span.why-label', 'Why: '), marked(q.explain)), q.why && r.choice >= 0 && q.why[r.choice] ? h('p', h('span.why-label', 'Why not yours: '), marked(q.why[r.choice])) : null);
    })));
}
function viewSession() {
  var s = ui.state, body;
  if (s.phase === 'teach') body = viewLesson();
  else if (s.phase === 'memorize') body = viewMemorize();
  else if (s.phase === 'drill') body = viewDrill();
  else if (s.phase === 'result') body = viewResult();
  else if (s.phase === 'exam') body = viewExam();
  else if (s.phase === 'done') body = viewDone();
  else if (s.phase === 'review') body = viewReviewRound();
  else return viewUnit();
  return h('main.wrap.study', body);
}

function leave(view) {
  stopPractice();
  ui.drill = null; ui.choice = null;
  ui.view = view; ui.error = ''; ui.notice = '';
  refresh().then(render);
}

/* ── REVIEW ──────────────────────────────────────────────────────────────── */
function startReview() {
  ui.view = 'review'; ui.reviewShown = false; ui.reviewDone = 0; ui.drill = null; ui.choice = null;
  refresh().then(render);
}
/* A drill: every card from one weak section, due or not, each once. Rating
   one early is still a review — FSRS reads how long it has been. */
function startDrill(w) {
  ui.view = 'review'; ui.reviewShown = false; ui.reviewDone = 0; ui.choice = null;
  ui.drill = { docId: w.docId, cluster: w.cluster, title: w.title, done: {} };
  refresh().then(render);
}
function viewReview() {
  var dr = ui.drill;
  var due = dr ? ui.cards.filter(function (c) { return c.docId === dr.docId && c.cluster === dr.cluster && !c.kind && !dr.done[c.id]; })
    : Study.reviewOrder(Session.dueCards(ui.cards, today()), today());
  var names = {};
  ui.docs.forEach(function (d) { names[d.id] = d.name; });
  var back = backBar(dr ? 'Drill · ' + dr.title : 'Review', function () { leave('library'); });
  /* a confident miss is asked again once the due cards are done */
  ui.againQ = (ui.againQ || []).filter(function (id) { return ui.cards.some(function (c) { return c.id === id; }); });
  var againCard = !due.length && ui.againQ.length ? ui.cards.filter(function (c) { return c.id === ui.againQ[0]; })[0] : null;
  if (!due.length && !againCard) {
    if (dr) {
      return h('main.wrap', back, h('div.card', h('h1', 'Drill done.'),
        h('p', ui.reviewDone + ' card' + (ui.reviewDone === 1 ? '' : 's') + ' from “' + dr.title + '”, each rated once.'),
        button('Back home', function () { leave('library'); }, 'primary')));
    }
    return h('main.wrap', back, h('div.card', h('h1', ui.reviewDone ? 'Done for today.' : 'Nothing due.'),
      h('p', ui.reviewDone ? ui.reviewDone + ' card' + (ui.reviewDone === 1 ? '' : 's') + ' reviewed. Come back tomorrow.' : 'Cards appear here when you miss something in a drill, and again when they are due.'),
      button('Back home', function () { leave('library'); }, 'primary')), practiceCard());
  }
  var isAgain = !due.length, card = isAgain ? againCard : due[0];
  /* Rated once, and counted only when stored: a failed write leaves the
     card due and says so, rather than showing it as reviewed. A card asked
     again is not rated again: FSRS already has the miss. */
  var rate = function (r, how) {
    if (ui.rating) return;
    var next = function () { ui.rating = false; ui.reviewShown = false; ui.choice = null; ui.sure = false; ui.clozeTyped = ''; ui.clozeVerdict = ''; render(); };
    if (isAgain) { ui.againQ.shift(); next(); return; }
    ui.rating = true;
    var upd = Session.review(card, r, today(), FSRS);
    if (how && how.hazard) upd.hazard = true;
    markStudied(); logActivity('review', {});
    Store.put('cards', upd).then(function () {
      if (dr) dr.done[card.id] = true;
      if (how && how.again && ui.againQ.indexOf(card.id) === -1) ui.againQ.push(card.id);
      ui.saveError = ''; ui.reviewDone++;
      return refresh();
    }, saveFailed).then(next);
  };
  var head = h('div.review-head', h('span.count', isAgain ? 'Asked again · ' + ui.againQ.length + ' left' : dr ? 'Drill · ' + due.length + ' left' : due.length + ' due'),
    h('span.muted', (names[card.docId] || '') + ' · ' + card.title));
  var tag = isAgain ? h('span.tag.again-tag', '⚠ asked again — you were sure') : h('span.tag', card.source === 'exam' ? 'from the exam' : card.kind === 'occlusion' ? 'a figure, one label hidden' : 'from a drill');
  var note = notesFor(card.docId, card.cluster), noteEl = note && note.text ? h('p.card-note', { id: 'card-note' }, h('span.note-label', 'Your note, not the book’s: '), note.text) : null;
  if (card.kind === 'cloze') return h('main.wrap', back, head, clozeCard(card, tag, rate), ui.clozeVerdict ? noteEl : null);
  if (card.options && card.options.length) {
    /* A multiple-choice card grades itself: right is Good (Hard if you were
       not sure), wrong is Again — and asked again if you were sure. */
    var q = { question: card.front, quote: card.quote || '', options: card.options, answer: card.answer, explain: card.explain || card.back, page: card.page };
    return h('main.wrap', back, head, mcqCard(q, [tag, card.kind === 'occlusion' ? occlusionFigure(card) : null], function () {
      var how = Study.rateWith(ui.choice === card.answer, !!ui.sure);
      rate(how.rating, how);
    }, null, null, function () { return null; }, { sure: !isAgain }), ui.choice != null ? noteEl : null, isAgain ? null : practiceCard());
  }
  /* A card from before multiple choice: shown, then rated by you. */
  return h('main.wrap', back, head,
    h('div.card.flash',
      h('span.tag', card.source === 'explain' ? 'teach-back gap' : card.source),
      h('h2.q', card.front),
      ui.reviewShown ? [h('hr'), h('p.back', card.back, ' ', page(card.page)),
        h('div.grades',
          button('Again', function () { rate(1); }, 'g1'), button('Hard', function () { rate(2); }, 'g2'),
          button('Good', function () { rate(3); }, 'g3'), button('Easy', function () { rate(4); }, 'g4'))]
        : button('Show answer', function () { ui.reviewShown = true; render(); }, 'primary big', { id: 'show-answer' })));
}
/* A cloze card: the book's sentence with its number or term blanked, the
   answer typed (study.js checkTyped). */
function clozeCard(card, tag, rate) {
  var v = ui.clozeVerdict;
  var parts = String(card.front).split(Study.BLANK);
  var input = h('input', { id: 'cloze-input', type: 'text', value: ui.clozeTyped || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-label': 'The missing word or number', oninput: function () { ui.clozeTyped = input.value; },
    onkeydown: function (e) { if (e.key === 'Enter') check(); } });
  var check = function () { ui.clozeTyped = input.value; ui.clozeVerdict = Study.checkTyped(input.value, card.back); render(); };
  var next = function () {
    var how = v === 'close' ? { rating: 2, again: false, hazard: false } : Study.rateWith(v === 'right', !!ui.sure);
    rate(how.rating, how);
  };
  return h('div.card.cloze', { id: 'cloze' }, h('div.mcq-meta', tag),
    h('p.cloze-front', parts.map(function (p, i) { return [p, i < parts.length - 1 ? h('span.gap', v ? card.back : '_____') : null]; })),
    v ? h('div.why' + (v === 'wrong' ? '.bad' : '.good'), { id: 'cloze-verdict', role: 'status', 'data-verdict': v },
        h('strong', v === 'right' ? '✓ Right' : v === 'close' ? '≈ Close — the book has “' + card.back + '”' : '✗ The book has “' + card.back + '”'),
        v === 'wrong' && ui.sure ? hazardNote() : null,
        h('p', marked(card.explain), ' ', page(card.page)),
        h('div.row.mcq-nav', button('Next →', next, 'primary big', { id: 'next' })))
      : [h('div.row.cloze-row', input, button('Check', check, 'primary', { id: 'cloze-check' })), h('div.row', sureToggle())]);
}
/* The figure with its label hidden: the image drawn from the stored PDF,
   and a mask where the label was printed (study.js maskOf). Answered, the
   mask lifts. */
function occlusionFigure(card) {
  var d = ui.docs.filter(function (x) { return x.id === card.docId; })[0];
  var m = card.mask, pc = function (v) { return (100 * v).toFixed(2) + '%'; };
  return h('div.occlusion' + (ui.choice != null ? '.revealed' : ''), { id: 'occlusion' },
    lazyImage('A figure with one label hidden', card.figure.page, card.figure.box, 2, d),
    h('span.occlusion-mask', { 'aria-hidden': 'true', style: 'left:' + pc(m.left) + ';top:' + pc(m.top) + ';width:' + pc(m.width) + ';height:' + pc(m.height) }));
}

/* ── THE MASTERY MAP and THE WEEK (study.js) ─────────────────────────────── */
/* ── THE BRAIN (home.js brainLayout) ─────────────────────────────────────
   The mastery map, drawn as a brain whose neurons are your sections: lit as
   each is drilled, in the colour of how well it is held, and wired into one
   net. It sits under the hero. A tap on a neuron says which section it is
   and how it stands, with the way to open it — a neuron is small under a
   finger, and a mis-tap should not start a lesson. Arrow keys walk the
   neurons in order; Enter opens the one chosen. */
var SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, kids) {
  var e = doc.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) e.setAttribute(k, String(attrs[k])); });
  (kids || []).forEach(function (k) { if (k) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k); });
  return e;
}
/* A small whole number from a string, for a neuron's own angles. */
function hashOf(t) { var x = 7; for (var i = 0; i < t.length; i++) x = (x * 31 + t.charCodeAt(i)) >>> 0; return x; }
function dendrites(n) {
  var h0 = hashOf(n.key), d = '', k;
  for (k = 0; k < 4; k++) {
    var a = (h0 % 628) / 100 + k * Math.PI / 2 + ((h0 >> (k + 3)) % 60 - 30) / 100;
    var len = n.r * (1.5 + ((h0 >> (k * 2)) % 9) / 10), bend = ((h0 >> k) % 2 ? 1 : -1) * n.r * 0.5;
    var sx = n.x + Math.cos(a) * n.r * 0.8, sy = n.y + Math.sin(a) * n.r * 0.8;
    var ex = n.x + Math.cos(a) * (n.r + len), ey = n.y + Math.sin(a) * (n.r + len);
    var cx = (sx + ex) / 2 - Math.sin(a) * bend, cy = (sy + ey) / 2 + Math.cos(a) * bend;
    d += 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + 'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + ex.toFixed(1) + ' ' + ey.toFixed(1);
    /* a fork at the tip of every other branch */
    if (k % 2 === 0) {
      var fa = a + 0.6, fx = ex + Math.cos(fa) * n.r * 0.7, fy = ey + Math.sin(fa) * n.r * 0.7;
      d += 'M' + ex.toFixed(1) + ' ' + ey.toFixed(1) + 'L' + fx.toFixed(1) + ' ' + fy.toFixed(1);
    }
  }
  return d;
}
/* A connection's curve: its bend is home.js axonCtrl's, the same one the
   live impulses follow, so an impulse runs on the line that is drawn. */
function axonPath(a, b, i) {
  var c = Home.axonCtrl(a, b, i);
  return 'M' + a.x + ' ' + a.y + 'Q' + c.x + ' ' + c.y + ' ' + b.x + ' ' + b.y;
}
/* A glow that fades from its middle: one per state, so nothing needs a blur
   filter redrawn every frame. */
function glowGrad(id, cls) {
  return svg('radialGradient', { id: id }, [svg('stop', { offset: '0', 'class': cls + ' g0' }), svg('stop', { offset: '.45', 'class': cls + ' g1' }), svg('stop', { offset: '1', 'class': cls + ' g2' })]);
}
/* ── THE BRAIN, LIVE (home.js liveStep) ────────────────────────────────────
   Impulses run the wiring, neurons flash where they land, a tap fires one.
   Run by requestAnimationFrame, at most about thirty draws a second; only
   while the brain is on the page — a redraw that replaces it hands its
   activity to the new one, and leaving the home screen stops it — and not
   at all when the device asks for reduced motion. ui.brainLive says what
   it is doing (the suite reads it). */
function brainLive(art, L) {
  if (reducedMotion() || !root.requestAnimationFrame) { ui.brainLive = null; return; }
  var prev = ui.brainLive, st = prev && prev.L === L ? prev.st : Home.liveInit(L);
  var live = ui.brainLive = { L: L, st: st, frames: prev && prev.L === L ? prev.frames : 0, running: true, token: (prev ? prev.token : 0) + 1 };
  var token = live.token, pool = [], flashEls = {}, hotEls = {}, shown = {}, hot = {}, last = 0, drawn = 0, seen = false, waits = 0, onScreen = true;
  art.querySelectorAll('.flash').forEach(function (c) { flashEls[c.getAttribute('data-i')] = c; });
  art.querySelectorAll('.brain-axons path').forEach(function (p) { hotEls[p.getAttribute('data-e')] = p; });
  art.querySelectorAll('.spark').forEach(function (g) { pool.push({ g: g, tails: g.querySelectorAll('.tail'), head: g.querySelector('.head'), halo: g.querySelector('.halo') }); });
  function draw() {
    pool.forEach(function (p, k) {
      var s = st.sparks[k];
      if (!s) { if (p.on) { p.g.style.display = 'none'; p.on = false; } return; }
      if (!p.on) { p.g.style.display = ''; p.on = true; }
      if (p.state !== s.state) { p.g.setAttribute('data-state', s.state); p.halo.setAttribute('fill', 'url(#glow-' + s.state + ')'); p.state = s.state; }
      var at = Home.sparkAt(L, st, s, 0);
      p.head.setAttribute('transform', 'translate(' + at.x.toFixed(1) + ' ' + at.y.toFixed(1) + ')');
      for (var t = 0; t < p.tails.length; t++) {
        var b = Home.sparkAt(L, st, s, 0.045 * (t + 1));
        p.tails[t].setAttribute('cx', b.x.toFixed(1)); p.tails[t].setAttribute('cy', b.y.toFixed(1));
      }
    });
    Object.keys(st.flash).forEach(function (i) {
      var el = flashEls[i]; if (!el) return;
      el.style.opacity = (st.flash[i] / Home.LIVE.FLASH_MS * (L.nodes[i].state === 'new' ? 0.5 : 1)).toFixed(2); shown[i] = true;
    });
    Object.keys(shown).forEach(function (i) { if (!(i in st.flash)) { flashEls[i].style.opacity = '0'; delete shown[i]; } });
    var now = {};
    st.sparks.forEach(function (x) { now[x.e] = true; });
    Object.keys(now).forEach(function (e) { if (!hot[e] && hotEls[e]) hotEls[e].setAttribute('data-hot', ''); });
    Object.keys(hot).forEach(function (e) { if (!now[e] && hotEls[e]) hotEls[e].removeAttribute('data-hot'); });
    hot = now;
  }
  function frame(ts) {
    if (ui.brainLive !== live) return;
    if (!art.isConnected) {
      if (seen || ++waits > 240) { live.running = false; return; }
      root.requestAnimationFrame(frame); return;
    }
    /* Watched from when it is on the page, and by the latest report. The
       first version observed it before it was placed and read the first
       report: Chromium delivered two at once — not in view (not yet
       placed), then in view — and the brain stood still after one frame.
       Either change alone fixes it (both were measured); both are kept. */
    if (!seen && root.IntersectionObserver) new root.IntersectionObserver(function (es) { onScreen = es[es.length - 1].isIntersecting; }).observe(art);
    seen = true;
    var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    if (!onScreen || doc.hidden) { last = ts; root.requestAnimationFrame(frame); return; }
    if (ts - drawn >= 30) {
      Home.liveStep(st, L, dt, Math.random); draw(); drawn = ts; last = ts; live.frames++;
    }
    root.requestAnimationFrame(frame);
  }
  root.requestAnimationFrame(frame);
}
var MM_LABEL = { new: 'not drilled yet', weak: 'weak', fading: 'fading', solid: 'solid' };
function brainData() {
  var map = Study.masteryMap(ui.docs.filter(function (d) { return !d.bookId || ui.at[d.id]; }), ui.sessions || {}, ui.cards, today(), FSRS)
    .filter(function (u) { return u.sections.length; });
  /* Laid out once per state of the map: the home redraws often. */
  var sig = JSON.stringify(map.map(function (u) { return [u.docId, u.name, u.sections.map(function (x) { return x.state + (x.recall == null ? '' : x.recall) + x.title; })]; }));
  if (!ui.brainCache || ui.brainCache.sig !== sig) ui.brainCache = { sig: sig, L: Home.brainLayout(map) };
  return ui.brainCache.L;
}
function masteryCard(pearl) {
  var L = brainData();
  if (!L.nodes.length) return null;
  var B = Home.BRAIN, nodes = L.nodes;
  var lit = nodes.filter(function (x) { return x.state !== 'new'; }).length;
  /* the neuron to point at: the one chosen, else the next section to learn
     (the first not drilled), else the first */
  var nextI = -1;
  nodes.forEach(function (x, i) { if (nextI === -1 && x.state === 'new') nextI = i; });
  var selI = -1;
  nodes.forEach(function (x, i) { if (x.key === ui.brainSel) selI = i; });
  var focusI = selI !== -1 ? selI : nextI !== -1 ? nextI : 0;
  var lobeHue = function (k) { return hue(k + 1); };

  var defs = svg('defs', {}, [
    svg('radialGradient', { id: 'brain-tissue', cx: '42%', cy: '36%', r: '72%' }, [
      svg('stop', { offset: '0', 'class': 'bt-1' }), svg('stop', { offset: '.62', 'class': 'bt-2' }), svg('stop', { offset: '1', 'class': 'bt-3' })]),
    svg('linearGradient', { id: 'brain-sheen', x1: '0', y1: '0', x2: '0', y2: '1' }, [
      svg('stop', { offset: '0', 'class': 'bs-1' }), svg('stop', { offset: '.5', 'class': 'bs-2' })]),
    glowGrad('glow-solid', 'gl-solid'), glowGrad('glow-fading', 'gl-fading'), glowGrad('glow-weak', 'gl-weak'), glowGrad('glow-new', 'gl-new'), glowGrad('glow-spark', 'gl-spark'),
    svg('linearGradient', { id: 'brain-glint-g', x1: '0', y1: '0', x2: '1', y2: '0' }, [
      svg('stop', { offset: '0', 'class': 'bg-0' }), svg('stop', { offset: '.5', 'class': 'bg-1' }), svg('stop', { offset: '1', 'class': 'bg-0' })]),
    svg('clipPath', { id: 'brain-clip' }, [svg('path', { d: B.cerebrum })]),
    svg('clipPath', { id: 'cbl-clip' }, [svg('path', { d: B.cerebellum })]),
    /* depth: the tissue darkens toward its underside and back, in its own tone */
    svg('radialGradient', { id: 'brain-shade', cx: '68%', cy: '88%', r: '75%' }, [svg('stop', { offset: '0', 'class': 'sh-0' }), svg('stop', { offset: '1', 'class': 'sh-1' })]),
    svg('radialGradient', { id: 'brain-floor', cx: '50%', cy: '50%', r: '50%' }, [svg('stop', { offset: '0', 'class': 'fl-0' }), svg('stop', { offset: '1', 'class': 'fl-1' })])]);
  /* The body as an atlas draws it: a soft shadow under it; the stem and
     the cerebellum with their lines; the cortex in its tissue, its folds
     each drawn twice — a lit edge and the groove beside it, so they read as
     ridges — the main fissures deeper; a shade toward the underside, the
     sheen from above, and the rim. */
  var gyrus = function (cls, dx) { return svg('g', { 'class': cls, 'clip-path': 'url(#brain-clip)' }, [svg('g', { transform: dx ? 'translate(' + dx + ' ' + dx + ')' : null },
    B.GYRI.map(function (d) { return svg('path', { d: d }); }).concat(B.SULCI.map(function (d) { return svg('path', { d: d, 'class': 'major' }); })))]); };
  var body = svg('g', { 'class': 'brain-body', 'aria-hidden': 'true' }, [
    svg('ellipse', { 'class': 'brain-floor', cx: 520, cy: 652, rx: 330, ry: 24, fill: 'url(#brain-floor)' }),
    svg('path', { 'class': 'brain-stem', d: B.stem }),
    svg('g', { 'class': 'brain-stem-lines' }, B.STEM_LINES.map(function (d) { return svg('path', { d: d }); })),
    svg('path', { 'class': 'brain-cbl', d: B.cerebellum }),
    svg('g', { 'class': 'brain-folia', 'clip-path': 'url(#cbl-clip)' }, B.FOLIA.map(function (d) { return svg('path', { d: d }); })),
    svg('path', { 'class': 'brain-cortex', d: B.cerebrum, fill: 'url(#brain-tissue)' }),
    gyrus('brain-grooves', 0),
    gyrus('brain-gyri-lit', -2.2),
    gyrus('brain-sulci', 0),
    svg('path', { 'class': 'brain-shade', d: B.cerebrum, fill: 'url(#brain-shade)' }),
    svg('path', { 'class': 'brain-sheen', d: B.cerebrum, fill: 'url(#brain-sheen)' }),
    /* the light glancing across it, every few seconds */
    svg('g', { 'clip-path': 'url(#brain-clip)' }, [svg('g', { transform: 'skewX(-20)' }, [svg('rect', { 'class': 'brain-glint', x: -420, y: 0, width: 260, height: 720, fill: 'url(#brain-glint-g)' })])]),
    svg('path', { 'class': 'brain-rim', d: B.cerebrum })]);
  var lobes = svg('g', { 'class': 'brain-lobes', 'clip-path': 'url(#brain-clip)', 'aria-hidden': 'true' }, L.units.map(function (u, k) {
    return svg('circle', { cx: u.x, cy: u.y, r: Math.round(L.gap * (1.2 + Math.sqrt(u.n))), style: 'fill:hsla(' + lobeHue(k) + ',75%,60%,.10)' });
  }));
  var axons = svg('g', { 'class': 'brain-axons', 'aria-hidden': 'true' }, L.edges.map(function (e, i) {
    return svg('path', { d: axonPath(nodes[e.a], nodes[e.b], i), 'data-fired': e.lit, 'data-state': e.state, 'data-kind': e.kind, 'data-e': i });
  }));
  var signals = svg('g', { 'class': 'brain-signals', 'aria-hidden': 'true' }, L.edges.filter(function (e) { return e.lit === 2; }).map(function (e, i) {
    return svg('path', { d: axonPath(nodes[e.a], nodes[e.b], L.edges.indexOf(e)), 'data-state': e.state, style: 'animation-delay:-' + ((hashOf(nodes[e.a].key) % 30) / 10) + 's' });
  }));
  /* each lit neuron's glow, breathing on its own beat */
  var glow = svg('g', { 'class': 'brain-glow', 'aria-hidden': 'true' }, nodes.filter(function (x) { return x.state !== 'new'; }).map(function (x) {
    return svg('circle', { cx: x.x, cy: x.y, r: (x.r * 2.6).toFixed(1), 'data-state': x.state, fill: 'url(#glow-' + x.state + ')',
      style: 'animation-delay:-' + ((hashOf(x.key) % 36) / 10) + 's' });
  }));
  /* where an impulse lands: a flash, drawn at nothing until one does */
  var flashes = svg('g', { 'class': 'brain-flashes', 'aria-hidden': 'true' }, nodes.map(function (x, i) {
    return svg('circle', { 'class': 'flash', 'data-i': i, cx: x.x, cy: x.y, r: (x.r * 3.4).toFixed(1), fill: 'url(#glow-' + (x.state === 'new' ? 'new' : x.state) + ')', style: 'opacity:0' });
  }));
  /* the impulses: a pool drawn once and moved, a glowing head and a tail */
  var sparkR = Math.max(18, L.gap * 0.8);
  var sparks = svg('g', { 'class': 'brain-sparks', 'aria-hidden': 'true' }, Array.apply(null, Array(Home.LIVE.MAX_SPARKS)).map(function () {
    return svg('g', { 'class': 'spark', style: 'display:none' }, [
      svg('circle', { 'class': 'tail t1', r: 4.2 }), svg('circle', { 'class': 'tail t2', r: 3.5 }), svg('circle', { 'class': 'tail t3', r: 2.8 }), svg('circle', { 'class': 'tail t4', r: 2.1 }),
      svg('g', { 'class': 'head' }, [svg('circle', { 'class': 'halo', r: sparkR.toFixed(1), fill: 'url(#glow-spark)' }), svg('circle', { 'class': 'core', r: 5 })])]);
  }));
  var cells = svg('g', { 'class': 'brain-neurons' }, nodes.map(function (x, i) {
    var label = x.title + ', ' + MM_LABEL[x.state] + (x.recall != null ? ', recall ' + x.recall + '% today' : '');
    return svg('g', { 'class': 'neuron mm-cell' + (i === nextI ? ' next' : '') + (i === selI ? ' sel' : ''), 'data-key': x.key, 'data-state': x.state, 'data-i': i,
        role: 'button', tabindex: i === focusI ? '0' : '-1', 'aria-label': label, 'aria-pressed': i === selI ? 'true' : 'false' }, [
      svg('title', {}, [label]),
      svg('circle', { 'class': 'hit', cx: x.x, cy: x.y, r: Math.max(x.r * 1.9, L.gap * 0.5).toFixed(1) }),
      svg('path', { 'class': 'dendrite', d: dendrites(x) }),
      i === nextI ? svg('circle', { 'class': 'next-ring', cx: x.x, cy: x.y, r: (x.r * 1.6).toFixed(1) }) : null,
      svg('circle', { 'class': 'soma', cx: x.x, cy: x.y, r: x.r }),
      svg('circle', { 'class': 'nucleus', cx: (x.x - x.r * 0.25).toFixed(1), cy: (x.y - x.r * 0.25).toFixed(1), r: (x.r * 0.34).toFixed(1) })]);
  }));
  /* a tap fires the neuron, down every connection it has */
  var pick = function (i) {
    if (ui.brainLive && ui.brainLive.L === L) Home.liveFire(ui.brainLive.st, L, i, Math.random, -1, 'tap');
    ui.brainSel = nodes[i].key; render(); var el = doc.querySelector('#mastery .neuron[data-i="' + i + '"]'); if (el) el.focus();
  };
  var open = function (i) { openDoc(nodes[i].docId, nodes[i].ci); };
  var art = svg('svg', { viewBox: B.VIEW, 'class': 'brain-svg', role: 'group', id: 'brain',
      'aria-label': 'Your brain: ' + lit + ' of ' + nodes.length + ' sections drilled. Arrow keys move between them; Enter opens one.' },
    [defs, body, lobes, axons, signals, glow, flashes, sparks, cells]);
  brainLive(art, L);
  art.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('.neuron');
    if (g) pick(+g.getAttribute('data-i'));
  });
  art.addEventListener('keydown', function (e) {
    var g = e.target.closest && e.target.closest('.neuron'); if (!g) return;
    var i = +g.getAttribute('data-i'), k = e.key;
    if (k === 'Enter' || k === ' ') { e.preventDefault(); open(i); return; }
    var step = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    var j = (i + step + nodes.length) % nodes.length;
    g.setAttribute('tabindex', '-1');
    var nx = art.querySelector('.neuron[data-i="' + j + '"]'); nx.setAttribute('tabindex', '0'); nx.focus();
  });

  /* What a tapped neuron is, under the statistics. Nothing until one is
     tapped: what is up next is the hero's Continue. */
  var shownI = selI;
  var info = shownI !== -1 ? (function () {
    var x = nodes[shownI], u = L.units[x.unit];
    return h('div.brain-info', { id: 'brain-info', 'aria-live': 'polite', 'data-state': x.state },
      h('span.eyebrow', 'This neuron'),
      h('strong.brain-title', x.title),
      h('span.muted', u.name + ' · section ' + (x.ci + 1) + ' · ' + MM_LABEL[x.state] + (x.recall != null ? ' · recall ' + x.recall + '% today' : '')),
      button(x.state === 'new' ? 'Learn it' : 'Open it', function () { open(shownI); }, 'primary', { id: 'brain-open' }));
  })() : null;
  var c = L.counts, pct = Math.round(100 * lit / nodes.length);
  /* ONE CARD (the owner, choosing between five mock-ups: "Option E …
     bring brain statistics below the brain as in option A and adjust
     PEARLS on side of brain all in one section"): the brain, and its
     statistics under it, in one column; the pearl of the day in the other.
     On a phone the column comes first, then the pearl. */
  return h('section.card.brain-card' + (pearl ? '.with-pearl' : ''), { id: 'mastery', 'aria-labelledby': 'brain-h' },
    h('div.brain-col',
      h('div.brain-stage', art),
      h('div.brain-stats',
        h('div.brain-stats-row',
          h('div.brain-headline', h('span.eyebrow', { id: 'brain-h' }, 'Your brain'),
            h('p.brain-big', h('strong', { id: 'brain-lit' }, pct + '%'), h('span', ' lit · ' + lit + ' of ' + Home.count(nodes.length, 'neuron')))),
          h('p.mm-legend', ['solid', 'fading', 'weak', 'new'].map(function (k) {
            return h('span', { 'data-k': k }, h('i.mm-dot', { 'data-state': k, 'aria-hidden': 'true' }), MM_LABEL[k] + ' ', h('b', String(c[k] || 0)));
          }))),
        info,
        h('div.brain-lobes-list', L.units.map(function (u, k) {
          return h('button.chip.lobe-chip', { type: 'button', style: '--lobe:' + lobeHue(k), onclick: function () { openDoc(u.docId); } },
            h('i', { 'aria-hidden': 'true' }), h('span', u.name), h('b', u.done + '/' + u.n));
        })),
        L.hidden.sections ? h('p.muted', { id: 'brain-more' }, '+ ' + Home.count(L.hidden.sections, 'more section') + (L.hidden.units ? ' in ' + Home.count(L.hidden.units, 'unit') : '') + ', not drawn.') : null)),
    pearl || null);
}
function weekCard() {
  var w = Study.weekly(ui.activity, today()), a = w.week, b = w.before;
  if (!a.answers && !a.reviews && !b.answers && !b.reviews) return null;
  var vs = function (x, y, unit) { return y ? (x > y ? ' ▲' : x < y ? ' ▼' : ' =') : ''; };
  return h('div.card.week-card', { id: 'weekly' }, h('span.eyebrow', 'This week'),
    h('div.week-stats',
      h('div', h('strong', { 'data-k': 'minutes' }, String(a.minutes)), h('span', ' min' + vs(a.minutes, b.minutes))),
      h('div', h('strong', { 'data-k': 'answers' }, String(a.answers)), h('span', ' answers' + vs(a.answers, b.answers))),
      h('div', h('strong', { 'data-k': 'accuracy' }, a.accuracy == null ? '—' : a.accuracy + '%'), h('span', ' right' + (a.accuracy != null && b.accuracy != null ? vs(a.accuracy, b.accuracy) : ''))),
      h('div', h('strong', { 'data-k': 'reviews' }, String(a.reviews)), h('span', ' reviews')),
      h('div', h('strong', { 'data-k': 'days' }, String(a.days)), h('span', ' days'))),
    a.weakest.length ? h('p.muted', { id: 'week-weakest' }, 'Missed most this week: ' + a.weakest.join(', ') + '.') : null,
    b.answers || b.reviews ? h('p.muted', 'Last week: ' + b.minutes + ' min, ' + b.answers + ' answers' + (b.accuracy != null ? ', ' + b.accuracy + '% right' : '') + '.') : null);
}

/* ── THE EXAM PLAN (study.js studyPlan) ─────────────────────────────────── */
function planUnits() {
  return ui.docs.filter(function (d) { return !d.bookId || ui.at[d.id]; }).slice().sort(function (a, b) { return a.addedAt - b.addedAt; }).map(function (d) {
    var st = ui.sessions[d.id];
    return { docId: d.id, name: d.name, sections: d.clusters.map(function (c, i) { return { ci: i, title: c.title, done: !!(st && st.per && st.per[i] && st.per[i].done) }; }) };
  });
}
function examPlan() { return ui.examDate ? Study.studyPlan(planUnits(), today(), ui.examDate) : null; }
function setExamDate(iso) {
  ui.examDate = iso || '';
  return (iso ? Store.put('meta', { id: 'plan', examDate: iso }) : Store.del('meta', 'plan')).then(null, function (e) { saveFailed(e); });
}
function planText(p) {
  if (!p) return '';
  if (p.past) return 'The exam date has passed.';
  if (!p.daysLeft) return 'The exam is today: timed practice and your weak items, nothing new.';
  var t = p.days[0];
  return 'Exam in ' + p.daysLeft + ' day' + (p.daysLeft === 1 ? '' : 's') + '. ' + (p.todo ? p.todo + ' section' + (p.todo === 1 ? '' : 's') + ' to learn, ' + p.perDay + ' a day. ' : 'Everything is learned: review until then. ') +
    (t.learn.length ? 'Today: ' + t.learn.map(function (x) { return x.title; }).join(', ') + '.' : 'Today: review — your due cards, weak items and a timed practice.');
}
function planCard() {
  var p = examPlan();
  var input = h('input', { type: 'date', id: 'exam-date', value: ui.examDate || '', 'aria-label': 'Exam date', min: today() });
  var set = button(ui.examDate ? 'Change' : 'Set', function () { setExamDate(input.value).then(render); }, 'chip', { id: 'exam-set' });
  if (!p) return h('div.card.plan-card', { id: 'exam-plan' }, h('span.eyebrow', '📅 Exam plan'),
    h('p.muted', 'Set your exam date and each day gets its sections, with the last days kept for review.'), h('div.row', input, set));
  var t = p.days[0];
  return h('div.card.plan-card', { id: 'exam-plan', 'data-days': String(p.daysLeft) }, h('span.eyebrow', '📅 Exam plan · ' + p.examDate),
    h('p', { id: 'plan-line' }, planText(p)),
    !p.fits ? h('p.warn', 'More to learn than days to learn it: about ' + p.perDay + ' sections a day.') : null,
    t && t.learn.length ? h('div.chips', t.learn.map(function (x) { return button(x.title, function () { openDoc(x.docId, x.ci); }, 'chip', { 'data-plan': x.docId + ':' + x.ci }); }))
      : t ? h('div.chips', button('Timed practice', function () { startPractice(20); }, 'chip', { id: 'plan-practice' })) : null,
    h('div.row', input, set, button('Clear', function () { setExamDate('').then(render); }, 'quiet', { id: 'exam-clear' })));
}

/* ── SECTION CHECKS: 1, 3, 7 and 21 days after a drill (study.js) ────────── */
function checkItems() {
  return Study.checksDue(ui.checks, today()).map(function (x) {
    var at = x.key.lastIndexOf(':'), docId = x.key.slice(0, at), ci = +x.key.slice(at + 1);
    var d = ui.docs.filter(function (y) { return y.id === docId; })[0];
    return d && d.clusters[ci] ? { key: x.key, rec: x.rec, doc: d, ci: ci, title: d.clusters[ci].title } : null;
  }).filter(Boolean);
}
function checksCard() {
  var items = checkItems();
  if (!items.length) return null;
  return h('div.card.checks-card', { id: 'checks' }, h('span.eyebrow', 'Section checks due'),
    h('p.muted', 'Three questions each, days after the drill — so forgetting is caught before it becomes a miss.'),
    h('ul.check-list', items.slice(0, 4).map(function (x) {
      return h('li', h('span.check-what', h('strong', x.title), h('span.muted', ' · check ' + ((x.rec.done || []).length + 1) + ' of ' + Study.CHECK_DAYS.length)),
        button('Check', function () { startCheck(x); }, 'chip', { 'data-key': x.key }));
    })));
}
function startCheck(x) {
  var st = ui.sessions[x.doc.id], per = st && st.per && st.per[x.ci];
  var qs = per && per.quiz && per.quiz.questions && per.quiz.questions.length ? per.quiz.questions
    : Coach.quiz(x.doc.clusters[x.ci], lessonFor(x.doc, x.ci), x.doc.clusters).questions;
  ui.check = { key: x.key, title: x.title, qs: Study.checkQuestions(qs, (x.rec.done || []).length), pos: 0, right: 0, done: false };
  ui.view = 'check'; ui.choice = null; render(); root.scrollTo(0, 0);
}
function viewCheck() {
  var k = ui.check, back = backBar('Section check', function () { leave('library'); });
  if (!k) return h('main.wrap', back);
  if (k.done) {
    var rec = ui.checks[k.key], nx = Study.nextCheck(rec);
    return h('main.wrap', back, h('div.card.result', { id: 'check-result' }, ring(Math.round(100 * k.right / k.qs.length), 'big'),
      h('h2', k.right + ' of ' + k.qs.length + ' · ' + k.title),
      h('p', k.right / k.qs.length < 0.5 ? 'This one has faded: its checks start again from tomorrow. Re-read its key points today.'
        : nx ? 'Holding. The next check is on ' + nx + '.' : 'All four checks done: this section is in long-term memory.')),
      h('div.row', button('Back home', function () { leave('library'); }, 'primary big')));
  }
  var q = k.qs[k.pos];
  return h('main.wrap', back, mcqCard(q, [h('span', 'Check · ' + (k.pos + 1) + ' of ' + k.qs.length + ' · ' + k.title)], function () {
    logActivity('answer', { correct: ui.choice === q.answer, title: k.title, source: 'check' });
    if (ui.choice === q.answer) k.right++;
    k.pos++; ui.choice = null;
    if (k.pos >= k.qs.length) {
      ui.checks[k.key] = Study.checkTaken(ui.checks[k.key], today(), k.right / k.qs.length);
      k.done = true; markStudied(); saveChecks();
    }
    render(); root.scrollTo(0, 0);
  }, null, null, function () { return null; }));
}

/* ── TIMED PRACTICE (study.js timedSet) ─────────────────────────────────── */
function practiceCard() {
  var tr = Study.practiceTrend(ui.practiceLog);
  return h('div.card.practice-card', { id: 'practice-start' }, h('span.eyebrow', '⏱ Timed practice'),
    h('p.muted', 'Due cards, weak items and each unit’s hardest questions, mixed, about one a minute.' +
      (tr.pct.length ? ' Last: ' + tr.pct[tr.pct.length - 1] + '%' + (tr.dir === 'up' ? ', up.' : tr.dir === 'down' ? ', down.' : tr.dir === 'level' ? ', level.' : '.') : '')),
    tr.pct.length > 1 ? h('div.trend', { 'aria-label': 'Recent practice scores' }, tr.pct.map(function (p, i) { return h('i', { title: tr.days[i] + ': ' + p + '%', style: 'height:' + Math.max(6, p) + '%' }); })) : null,
    h('div.chips', [10, 20, 30].map(function (m) { return button(m + ' min', function () { startPractice(m); }, 'chip', { id: 'practice-' + m }); })));
}
function cardQ(c) { return { question: c.front, quote: c.quote || '', options: c.options, answer: c.answer, explain: c.explain || c.back, page: c.page }; }
function practicePool() {
  var due = Session.dueCards(ui.cards, today()).filter(function (c) { return c.options && c.options.length && c.kind !== 'occlusion'; })
    .map(function (c) { return { id: c.id, kind: 'due', q: cardQ(c), title: c.title }; });
  var weak = [], hard = [];
  ui.docs.forEach(function (d) {
    var st = ui.sessions[d.id];
    if (!st || !st.per) return;
    Session.pending(st).forEach(function (w) { weak.push({ id: w.id, kind: 'weak', q: w.q, title: st.titles[w.cluster] || '' }); });
    /* the unit's hardest: its lowest-scored drilled section's questions */
    /* per is keyed by section number, not an array */
    var drilled = (st.titles || []).map(function (_, i) { return { i: i, p: st.per[i] || {} }; }).filter(function (x) { return x.p.quiz && x.p.quiz.questions && x.p.quiz.questions.length && x.p.score != null; })
      .sort(function (a, b) { return a.p.score - b.p.score || a.i - b.i; });
    if (drilled[0]) drilled[0].p.quiz.questions.forEach(function (q, k) { hard.push({ id: d.id + ':hard:' + drilled[0].i + ':' + k, kind: 'hard', q: q, title: st.titles[drilled[0].i] }); });
  });
  return { due: due, weak: weak, hard: hard };
}
function startPractice(minutes) {
  stopPractice();
  ui.practice = { minutes: minutes, qs: Study.timedSet(practicePool(), minutes), pos: 0, right: 0, ends: Date.now() + minutes * 60000, done: false };
  ui.view = 'practice'; ui.choice = null;
  if (ui.practice.qs.length) ui.practiceTimer = setInterval(function () {
    var el = doc.getElementById('practice-clock');
    if (Date.now() >= ui.practice.ends) { finishPractice(); render(); return; }
    if (el) el.textContent = clockOf(ui.practice.ends - Date.now());
  }, 1000);
  render(); root.scrollTo(0, 0);
}
function stopPractice() { if (ui.practiceTimer) { clearInterval(ui.practiceTimer); ui.practiceTimer = null; } }
function clockOf(ms) { var t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2); }
function finishPractice() {
  var p = ui.practice;
  if (!p || p.done) return;
  stopPractice(); p.done = true;
  if (!p.pos) return;
  ui.practiceLog = (ui.practiceLog || []).concat([{ day: today(), right: p.right, asked: p.pos, minutes: p.minutes }]).slice(-60);
  markStudied();
  Store.put('meta', { id: 'practice', history: ui.practiceLog }).then(null, function (e) { saveFailed(e); render(); });
}
function viewPractice() {
  var p = ui.practice, back = backBar('Timed practice', function () { stopPractice(); leave('review'); });
  if (!p || !p.qs.length) return h('main.wrap', back, h('div.card', h('h2', 'Nothing to practise yet'), h('p', 'Drill a section or two first: practice mixes your due cards, weak items and hardest questions.')));
  if (p.done) {
    var tr = Study.practiceTrend(ui.practiceLog);
    return h('main.wrap', back, h('div.card.result', { id: 'practice-result' }, ring(p.pos ? Math.round(100 * p.right / p.pos) : 0, 'big'),
      h('h2', p.right + ' of ' + p.pos + ' in ' + p.minutes + ' minutes'),
      h('p', tr.dir === 'up' ? 'Up on last time.' : tr.dir === 'down' ? 'Down on last time: the misses are on your weak list.' : tr.dir === 'level' ? 'Level with last time.' : 'Your first timed practice: the next one is compared with it.')),
      practiceCard());
  }
  var it = p.qs[p.pos];
  return h('main.wrap', back, mcqCard(it.q, [h('span.practice-clock', { id: 'practice-clock', role: 'timer' }, clockOf(p.ends - Date.now())),
      h('span', 'Question ' + (p.pos + 1) + ' of ' + p.qs.length + (it.title ? ' · ' + it.title : '')), h('span.tag', it.kind === 'due' ? 'due card' : it.kind === 'weak' ? 'weak item' : 'hardest')],
    function () {
      logActivity('answer', { correct: ui.choice === it.q.answer, title: it.title || '', source: 'practice' });
      if (ui.choice === it.q.answer) p.right++;
      p.pos++; ui.choice = null;
      if (p.pos >= p.qs.length) finishPractice();
      render(); root.scrollTo(0, 0);
    }, null, null, function () { return null; }));
}

/* ── ON-DEVICE AI (llm.js), every word it writes checked by ground.js ───── */
function aiOn() { return LLM.loadConfig().on; }
function aiEnsure() {
  if (LLM.ready()) return Promise.resolve();
  var c = LLM.loadConfig();
  return LLM.supported().then(function (s) {
    if (!s.ok) throw new Error(s.why);
    return LLM.start(c.model, function (p, text) { ui.ai.status = 'Starting the on-device AI: ' + Math.round(100 * p) + '%' + (text ? ' — ' + text : ''); render(); });
  }).then(function () { ui.ai.status = 'Ready: running on this device.'; });
}
/* Run one AI job with a busy line, and never let its failure stop the app. */
function aiJob(label, fn) {
  ui.ai.busy = label; ui.ai.error = ''; render();
  return aiEnsure().then(fn).then(function (v) { ui.ai.busy = ''; render(); return v; }, function (e) {
    ui.ai.busy = ''; ui.ai.error = (e && e.message) || String(e); render(); return null;
  });
}
function aiNote(kept, dropped) {
  return h('p.muted.ai-label', '✨ On-device AI, checked against your book' + (dropped ? ' — ' + dropped + ' sentence' + (dropped === 1 ? '' : 's') + ' dropped for saying what the book does not' : ''));
}
/* A drill's harder questions: the model's, each kept only when its answer
   is in the section — explained by the book's sentence, not the model's. */
var AI_QUESTIONS_MS = 120000;
function aiQuestions(c) {
  var sents = Coach.sentences(c);
  if (sents.length < 3) return Promise.resolve([]);
  var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(''); }, AI_QUESTIONS_MS); });
  return aiEnsure().then(function () {
    return Promise.race([LLM.chat(LLM.SYSTEM, LLM.questionsPrompt(c.title, sents), LLM.QUESTIONS_SCHEMA, 700), timeout]);
  }).then(function (text) {
    return LLM.parseQuestions(text || '').map(function (q) { return Ground.question(q, sents).q; }).filter(Boolean).slice(0, 4);
  }, function () { return []; });
}

/* ── ASK YOUR BOOK ───────────────────────────────────────────────────────── */
/* Built once per set of units: over a whole book it reads every sentence. */
/* One build at a time: opening the Coach and asking at once used to start
   two, each redrawing the screen — a tap landing in a redraw can be lost. */
function askIndex() {
  /* Units changed and not yet read back: read them first. The index was
     built from the ones in memory, kept, and a unit just edited or added
     was missing from every answer until the next change (CI caught it
     twice, on a slow runner). */
  if (ui.docsStale) return refresh().then(askIndex);
  if (ui.askIdx && ui.askFor === ui.docs) return Promise.resolve(ui.askIdx);
  if (ui.askBuild && ui.askBuildFor === ui.docs) return ui.askBuild;
  ui.askBusy = true; ui.askBusyText = ''; render();
  var docs = ui.docs;
  ui.askBuildFor = docs;
  ui.askBuild = new Promise(function (resolve) {
    setTimeout(function () {                      /* let "Indexing…" paint first */
      ui.askIdx = Ask.build(docs); ui.askFor = docs; ui.askBusy = false; ui.askBuild = null;
      resolve(ui.askIdx);
    }, 30);
  });
  return ui.askBuild;
}
function meaningOn() { return !!LLM.loadConfig().meaning; }
/* Every section's vector, made once and kept (the vectors store), in the
   order of idx.sections. */
function sectionVectors(idx) {
  if (ui.secVecs && ui.secVecsFor === idx) return Promise.resolve(ui.secVecs);
  var byDoc = {}, need = [];
  return Promise.all(ui.docs.map(function (d) { return Store.get('vectors', d.id); })).then(function (recs) {
    ui.docs.forEach(function (d, k) {
      var r = recs[k];
      if (r && r.model === LLM.EMBED.id && r.vecs.length === d.clusters.length) byDoc[d.id] = r.vecs;
      else need.push(d);
    });
    var total = need.reduce(function (n, d) { return n + d.clusters.length; }, 0), done = 0;
    return need.reduce(function (p, d) {
      return p.then(function () {
        return LLM.embed(d.clusters.map(function (c) { return c.title + '. ' + c.text; }), function (n) {
          ui.askBusyText = 'Reading your units for meaning (once): ' + (done + n) + ' of ' + total + ' sections…'; render();
        });
      }).then(function (vecs) {
        done += vecs.length; byDoc[d.id] = vecs;
        return Store.put('vectors', { id: d.id, model: LLM.EMBED.id, vecs: vecs });
      });
    }, Promise.resolve());
  }).then(function () {
    ui.secVecs = idx.sections.map(function (s) { return (byDoc[s.docId] || [])[s.ci] || null; });
    ui.secVecsFor = idx; ui.sentVecs = {};
    return ui.secVecs;
  });
}
/* Sentences found by meaning: the best sections' sentences, embedded now
   (and remembered), kept above vec.js's floor. */
function byMeaning(idx, q) {
  var qv;
  return LLM.startEmbed(function (p) { ui.askBusyText = 'Starting search by meaning: ' + Math.round(100 * p) + '%'; render(); })
    .then(function () { return sectionVectors(idx); })
    .then(function (secVecs) { return LLM.embed([Vec.QUERY_PREFIX + q]).then(function (v) { qv = v[0]; return secVecs; }); })
    .then(function (secVecs) {
      var ids = [];
      Vec.top(qv, secVecs, Vec.TOP_SECTIONS).forEach(function (t) { for (var i = idx.sections[t.i].first; i < idx.sections[t.i].last; i++) ids.push(i); });
      var missing = ids.filter(function (i) { return !ui.sentVecs[i]; });
      return LLM.embed(missing.map(function (i) { return idx.sents[i].text; })).then(function (vs) {
        missing.forEach(function (i, k) { ui.sentVecs[i] = vs[k]; });
        return Vec.keep(ids.map(function (i) { return { key: i, i: i, cos: Vec.cosine(qv, ui.sentVecs[i]) }; }));
      });
    });
}
/* ── the Coach as an agent (agent.js) ───────────────────────────────────
   A message is read (by the on-device model when it is on, else by the
   rules), a tool is chosen and used on the book, and the answer joins the
   conversation; the topic is remembered for "quiz me on that". */
function askNow(q) {
  ui.askQ = q;
  if (!q.trim()) { ui.askR = null; render(); return; }
  ui.turns = ui.turns || []; ui.memory = ui.memory || {};
  return askIndex().then(function (idx) {
    return aiOn() && LLM.ready() ? modelLoop(idx, q) : clauseLoop(idx, q);
  });
}
/* The rules' loop (agent.js clauses / afterStep): the message as steps,
   each planned when its turn comes, with what the last one found. */
function clauseLoop(idx, q) {
  var queue = Agent.clauses(q).map(function (c) { return { clause: c }; });
  var multi = queue.length > 1, n = 0, mine = [];
  function step() {
    if (!queue.length || n >= Agent.MAX_STEPS + 2) { render(); return; }
    var item = queue.shift(); n++;
    var p = item.plan || Agent.plan(item.clause, ui.memory);
    var turn = { q: n === 1 ? q : null, plan: p, step: n, multi: multi || !!p.recovered };
    /* a recovery makes a one-step message several: number the steps already shown */
    if (p.recovered) { multi = true; mine.forEach(function (t) { t.multi = true; }); }
    mine.push(turn);
    return (p.tool === 'search' ? searchStep(idx, p, item.clause || p.topic, turn) : Promise.resolve(toolStep(idx, p, turn))).then(function (obs) {
      ui.turns.push(turn); recordTurn(p.tool, titlesOf(turn)); render();
      var nx = Agent.afterStep(p, obs);
      if (nx) queue.unshift({ plan: nx });
      return step();
    });
  }
  return step();
}
/* The on-device model's loop (agent.js run): it names each next tool
   having seen what the last ones found, then answers — and its answer is
   shown only as far as it holds to those results (ground.js). A first
   reply that is not a usable step hands the message to the rules' loop. */
function modelLoop(idx, q) {
  var n = 0, mine = [];
  return Agent.run(q, { memory: ui.memory, profile: coachProfileLine(),
    think: function (prompt) {
      ui.askBusy = true; ui.askBusyText = 'Thinking…'; render();
      return LLM.chat('You are the coach in a study app. Reply only with JSON.', prompt, Agent.LOOP_SCHEMA, 240)
        .then(function (t) { ui.askBusy = false; return t; }, function (e) { ui.askBusy = false; throw e; });
    },
    act: function (p) {
      n++;
      var turn = { q: n === 1 ? q : null, plan: p, step: n, multi: n > 1 };
      if (n === 2) mine[0].multi = true;
      mine.push(turn);
      return (p.tool === 'search' ? searchStep(idx, p, n === 1 ? q : p.topic || q, turn) : Promise.resolve(toolStep(idx, p, turn))).then(function () {
        ui.turns.push(turn); recordTurn(p.tool, titlesOf(turn)); render();
        return { observation: Agent.observe(p.tool, obsData(turn)), turn: turn };
      });
    },
    check: function (text, obs) { return Ground.summary(text, obs.map(function (o) { return { text: o }; })); },
    rules: function () { return clauseLoop(idx, q); },
  }).then(function (res) {
    if (res.answer) ui.turns.push({ q: null, plan: { tool: 'answer', by: 'ai' }, answer: res.answer, sources: Study.claimSources(res.answer.kept, res.steps) });
    render();
  });
}
/* What a step's turn tells the model (agent.js observe). */
function obsData(t) {
  var title = t.at ? t.at.sec.title : '';
  switch (t.plan.tool) {
    case 'explain': return t.at ? { explain: t.explain, title: title } : {};
    case 'quiz': case 'table': return t.at ? { quiz: t.quiz, title: title } : {};
    case 'mnemonic': return t.at ? { mnemonics: t.at.L.mnemonics || [], title: title } : {};
    case 'numbers': return t.at ? { sheet: t.sheet, title: title } : {};
    case 'open': return { title: title };
    case 'compare': return { rows: (t.rows || []).map(function (r) { return { title: r.sec.title, bigIdea: Sheet.sheetOf(r.L).bigIdea }; }) };
    default: return t;
  }
}
function titlesOf(t) {
  return t.found ? [t.found] : t.at ? [t.at.sec.title] : t.rows ? t.rows.map(function (r) { return r.sec.title; }) : [];
}
/* What the coach remembers (agent.js remember): the tools used and the
   book's section titles they landed on — never what was typed. */
function recordTurn(tool, titles) {
  ui.profile = Agent.remember(ui.profile, tool, titles);
  Store.put('meta', { id: 'coach-profile', profile: ui.profile });
}
function coachProfileLine() {
  var w = Agent.weakItems(ui.docs, ui.sessions || {}, 3)[0];
  return Agent.profileLine(ui.profile, w ? w.line : '');
}
/* A search step: the reader's own words (unless it only follows on), or,
   recovering, the topic by meaning alone. What it found is the observation. */
function searchStep(idx, p, clause, turn) {
  var query = p.meaningOnly ? p.topic : Agent.plan(clause, ui.memory).tool === 'search' ? Agent.plan(clause, ui.memory).topic : clause;
  turn.query = query;
  var done = function (r) {
    ui.askR = r; turn.r = r;
    var title = r.found && r.sections.length ? idx.sections[r.sections[0]].title : '';
    if (title) ui.memory.topic = title;
    turn.found = title;
    return { section: title, missing: !title, meaning: meaningOn() };
  };
  if (!meaningOn()) return Promise.resolve(done(p.meaningOnly ? { found: false, groups: [], sections: [], question: query } : Ask.ask(idx, query)));
  ui.askBusy = true; ui.askBusyText = 'Searching by meaning…'; render();
  return byMeaning(idx, query).then(function (m) {
    ui.askBusy = false; return done(Ask.ask(idx, query, m));
  }, function (e) {
    ui.askBusy = false; ui.ai.error = 'search by meaning could not run (' + ((e && e.message) || e) + '); searched by words'; return done(Ask.ask(idx, query));
  });
}
/* A tool step: the tool's result goes on the turn, and what it found — or
   did not — is the observation. */
function toolStep(idx, p, turn) {
  var t = agentTurn(idx, p, turn.q);
  Object.keys(t).forEach(function (k) { if (k !== 'q') turn[k] = t[k]; });
  var sec = turn.at ? turn.at.sec.title : '';
  return {
    section: sec, meaning: meaningOn(),
    missing: turn.at === null || !!(turn.rows && !turn.rows.length),
    empty: p.tool === 'quiz' ? !!turn.quiz && !turn.quiz.length
      : p.tool === 'mnemonic' ? !!turn.at && !(turn.at.L.mnemonics || []).length
      : p.tool === 'numbers' ? !!turn.sheet && !turn.sheet.numbers.length : false,
  };
}
/* A tool used on the book: what it found, kept with the turn. */
function lessonFor(docRec, ci) {
  var st = ui.sessions && ui.sessions[docRec.id];
  return st && st.per && st.per[ci] && st.per[ci].lesson || Coach.lesson(docRec.clusters[ci]);
}
function sectionOf(idx, topic) {
  var i = Agent.findSection(idx, topic);
  if (i < 0) return null;
  var sec = idx.sections[i], d = ui.docs.filter(function (x) { return x.id === sec.docId; })[0];
  return d && d.clusters[sec.ci] ? { sec: sec, doc: d, ci: sec.ci, c: d.clusters[sec.ci], L: lessonFor(d, sec.ci) } : null;
}
function agentTurn(idx, p, q) {
  var t = { q: q, plan: p };
  if (p.tool === 'compare') {
    t.rows = (p.topics || []).map(function (x) { return sectionOf(idx, x); }).filter(Boolean);
    if (t.rows.length === 2 && t.rows[0].sec === t.rows[1].sec) t.rows = t.rows.slice(0, 1);
    if (t.rows.length) ui.memory.topic = t.rows[t.rows.length - 1].sec.title;
    return t;
  }
  if (/^(?:explain|quiz|mnemonic|numbers|open|table)$/.test(p.tool)) {
    t.at = sectionOf(idx, p.topic);
    if (!t.at) return t;
    ui.memory.topic = t.at.sec.title;
    if (p.tool === 'explain') t.explain = Coach.explainSection(t.at.c, t.at.L);
    if (p.tool === 'quiz') t.quiz = Coach.quiz(t.at.c, t.at.L, t.at.doc.clusters).questions.slice(0, 3).map(function (x) { return { q: x, choice: null }; });
    if (p.tool === 'numbers') t.sheet = Sheet.sheetOf(t.at.L);
    if (p.tool === 'table') t.quiz = Study.tableRound(Coach.candidates(t.at.c, Coach.pools(t.at.doc.clusters))).map(function (x) { return { q: x, choice: null }; });
    if (p.tool === 'open') setTimeout(function () { openDoc(t.at.doc.id, t.at.ci); }, 600);
  }
  var day = today();
  if (p.tool === 'weak') { t.items = Agent.weakItems(ui.docs, ui.sessions || {}, 3); t.spots = Home.weakSpots(ui.docs, ui.sessions || {}, ui.cards, Session.mastery, 3); }
  if (p.tool === 'mistake') t.mistakes = Agent.mistakes(ui.docs, ui.sessions || {}, 3);
  if (p.tool === 'schedule') t.week = Agent.schedule(ui.cards, day);
  if (p.tool === 'review') t.due = Session.dueCards(ui.cards, day).length;
  if (p.tool === 'plan') t.planText = nextSteps();
  if (p.tool === 'exam') {
    var when = Study.parseExamDate(p.topic || q || '', day);
    if (when) setExamDate(when);
    t.examDate = when || ui.examDate; t.exam = examPlan(); t.planText = t.exam ? planText(t.exam) : '';
  }
  if (p.tool === 'teach') {
    t.at = sectionOf(idx, p.topic);
    if (t.at) { ui.memory.topic = t.at.sec.title; t.title = t.at.sec.title; ui.teachFocus = true; setTimeout(function () { openDoc(t.at.doc.id, t.at.ci); }, 600); }
  }
  if (p.tool === 'round') {
    /* the unit with the most a round can ask; it opens there, the round begun */
    var w = Agent.weakItems(ui.docs, ui.sessions || {}, 3).filter(function (x) { return x.review > 0; })[0];
    t.round = w ? { started: true, n: w.review, name: w.name, docId: w.docId } : { started: false };
    if (w) setTimeout(function () { openDoc(w.docId).then(function () { return go({ type: 'toReview' }); }).then(null, function (e) { ui.error = (e && e.message) || String(e); render(); }); }, 600);
  }
  return t;
}
/* The plan in words, for the model: the same three steps coachActions shows. */
function nextSteps() {
  var spots = Home.weakSpots(ui.docs, ui.sessions || {}, ui.cards, Session.mastery, 1);
  var due = Session.dueCards(ui.cards, today()).length;
  var cur = Home.current(ui.docs.filter(function (d) { return !d.bookId || ui.at[d.id]; }), ui.sessions || {});
  return [cur ? 'Carry on with ' + cur.doc.name + (cur.next ? ' (next: ' + cur.next + ')' : '') + '.' : '',
    spots[0] ? 'Relearn the weakest section: ' + spots[0].title + ' (' + spots[0].pct + '%).' : '',
    due ? 'Review ' + due + ' due card' + (due === 1 ? '' : 's') + '.' : ''].filter(Boolean).join(' ') || 'Add a chapter and start its first section.';
}
function turnView(t, idx, latest) {
  if (t.plan.tool === 'answer') return answerView(t, latest);
  var p = t.plan, title = t.at ? t.at.sec.title : t.rows && t.rows.length ? t.rows.map(function (r) { return r.sec.title; }).join('” and “') : '';
  var body = [];
  var steps = h('p.agent-steps', t.multi ? 'Step ' + t.step + ' · ' : '', p.by === 'ai' ? '✨ ' : '🧭 ',
    p.tool === 'search' ? (p.meaningOnly ? 'Searched your book by meaning' : 'Searched your book') : 'Used: ' + p.tool, title ? ' · ' + title : '',
    p.because ? ' · ↪ ' + p.because : '');
  var open = t.at ? button('Open this section', function () { openDoc(t.at.doc.id, t.at.ci); }, 'chip quiet') : null;
  var missing = (t.at === null || (t.rows && !t.rows.length)) && p.tool !== 'search';
  if (missing) body.push(h('p', 'I couldn’t find “' + (p.topic || (p.topics || []).join(', ')) + '” in your book. Try the name of the condition, test or drug.'));
  else if (p.tool === 'help' || p.tool === 'weak' || p.tool === 'plan' || p.tool === 'review') body.push(coachActions(p.tool));
  else if (p.tool === 'mistake') body.push(t.mistakes.length ? h('ul.agent-mistakes', { id: latest ? 'agent-mistakes' : null }, t.mistakes.map(function (m) {
      return h('li', h('p', h('strong', m.label), ' ', h('span.type-badge', 'Type ' + m.type + ' · ' + m.name), m.confusedWith ? ' — confused with ' + m.confusedWith : ''),
        h('p.muted', m.means + ' ', h('strong', 'Fix: '), m.fix));
    })) : h('p', 'No misses yet: drill a section and I’ll tell you why any go wrong.'));
  else if (p.tool === 'schedule') body.push(h('ol.agent-week', { id: latest ? 'agent-week' : null }, t.week.map(function (d) {
      return h('li', { 'data-n': String(d.n) }, h('span.week-day', d.label), h('span.week-bar', h('i', { style: 'width:' + Math.min(100, d.n * 10) + '%' })), h('strong', String(d.n)));
    })));
  else if (p.tool === 'exam') body.push(t.exam ? [h('p', { id: latest ? 'agent-exam' : null }, planText(t.exam)),
      h('ol.agent-plan', t.exam.days.slice(0, 5).map(function (d) { return h('li', h('strong', d.day), ' ', d.learn.length ? d.learn.map(function (x) { return x.title; }).join(', ') : 'review'); }))]
    : h('p', 'Tell me the date — “my exam is on 10 October”, or “in 3 weeks”.'));
  else if (p.tool === 'teach') body.push(h('p.muted', 'Opening it: explain it in your own words at “Teach it back”.'));
  else if (p.tool === 'round') body.push(t.round.started ? h('p.muted', 'Opening ' + t.round.name + ' for a round of ' + t.round.n + '…') : h('p', 'Nothing is on the weak list: drill a section first.'));
  else if (p.tool === 'explain') {
    var e = t.explain, en = t.at && notesFor(t.at.doc.id, t.at.ci);
    body.push(en && en.text ? h('p.card-note', { id: latest ? 'agent-note' : null }, h('span.note-label', 'Your note, not the book’s: '), en.text) : null,
      e.gist ? h('p', h('strong', 'In one line: '), marked(e.gist)) : null, e.chain ? h('p', h('strong', 'How it works: '), e.chain) : null,
      e.facts.length ? h('ul', e.facts.map(function (f) { return h('li', f); })) : null,
      e.hooks.map(function (m) { return h('p', h('strong', 'Remember: '), m.letters.split('').join(' · ') + ' — ' + m.words.join(', ')); }),
      h('div.chips', open, button('Quiz me on this', function () { askNow('quiz me on that'); }, 'chip quiet'), button('Mnemonics', function () { askNow('mnemonics'); }, 'chip quiet')));
  } else if (p.tool === 'quiz' || p.tool === 'table') {
    body.push(t.quiz.length ? h('ol.agent-quiz', t.quiz.map(function (x, k) {
      var q = x.q, answered = x.choice != null;
      return h('li.agent-q', { 'data-k': String(k) }, q.quote ? h('blockquote.quote', q.quote) : null, h('p.q', q.question),
        h('div.options', q.options.map(function (o, i) {
          return h('button.option' + (answered ? (i === q.answer ? '.right' : i === x.choice ? '.wrong' : '.dim') : ''), { type: 'button', disabled: answered ? true : null, 'data-i': String(i),
            onclick: function () { x.choice = i; render(); } }, h('span.opt-letter', LETTERS[i]), h('span.opt-text', o));
        })),
        answered ? h('p.why' + (x.choice === q.answer ? '.good' : '.bad'), h('strong', x.choice === q.answer ? '✓ Right. ' : '✗ It is ' + q.options[q.answer] + '. '), marked(q.explain), ' ', page(q.page)) : null);
    })) : h('p', p.tool === 'table' ? 'This section has no table to ask from.' : 'This section is too short to ask good questions of.'), h('div.chips', open));
  } else if (p.tool === 'mnemonic') {
    var ms = t.at.L.mnemonics || [];
    body.push(ms.length ? ms.map(function (m) { return h('div.agent-hook', h('strong', m.title), h('p.hook-script', m.letters.split('').join(' · ')), h('p', m.words.join(', '))); })
      : h('p', 'This section has no list to make a mnemonic of.'), h('div.chips', open));
  } else if (p.tool === 'numbers') {
    body.push(t.sheet.numbers.length ? numbersCard(t.sheet) : h('p', 'This section gives no numbers to learn.'), h('div.chips', open));
  } else if (p.tool === 'compare') {
    body.push(h('div.agent-compare', t.rows.map(function (r) {
      var sh = Sheet.sheetOf(r.L), m = (r.L.mnemonics || [])[0];
      return h('div.cmp-col', h('h3', r.sec.title), h('p', marked(sh.bigIdea)),
        [].concat.apply([], sh.numbers.map(function (n) { return n.tiles.map(function (x) { return h('p.cmp-num', h('strong', x.value), ' ' + x.label); }); })),
        m ? h('p.muted', m.title + ': ' + m.letters.split('').join(' · ')) : null,
        button('Open', function () { openDoc(r.doc.id, r.ci); }, 'chip quiet'));
    })), t.rows.length === 2 ? h('div.chips', button('🖼 As a chart', function () {
      showFigure(Figure.compareChart('Compare', t.rows.map(function (r) { return { title: r.sec.title, sheet: Sheet.sheetOf(r.L), mnemonic: (r.L.mnemonics || [])[0] }; })), 'Comparison chart');
    }, 'chip quiet')) : null);
  } else if (p.tool === 'open') body.push(h('p.muted', 'Opening it now…'));
  return h('div.turn', { 'data-tool': p.tool },
    t.q ? h('div.you', h('div.bubble.mine', t.q)) : null,
    p.tool === 'search' ? steps : h('div.coach-says', h('div.coach-avatar.small', mascot()),
      h('div.bubble.agent' + (latest ? '.latest' : ''), { id: latest ? 'agent-latest' : null }, steps, h('p', Agent.say(p, title)), body)));
}
/* The model's answer: each sentence it wrote that held to the step results
   it cites (ground.js), with their step numbers; the rest dropped, and
   counted. */
function answerView(t, latest) {
  var a = t.answer;
  return h('div.turn', { 'data-tool': 'answer' }, h('div.coach-says', h('div.coach-avatar.small', mascot()),
    h('div.bubble.agent.agent-answer' + (latest ? '.latest' : ''), { id: latest ? 'agent-latest' : null },
      h('p.agent-steps', '✨ Answer, from the steps above'),
      a.kept.length ? h('p', { id: latest ? 'agent-answer' : null }, a.kept.map(function (k, i) {
          var src = t.sources && t.sources[i] ? t.sources[i].sources : [];
          return [k.text, ' ', h('sup.cite', k.cites.map(function (n) { return '[' + n + ']'; }).join('')),
            src.map(function (x) { return h('span.claim-src', { title: 'Step ' + x.step + ' found this in ' + x.title }, x.title + (x.page ? ' · p.' + x.page : '')); })];
        }).reduce(function (x, y) { return x.concat([' '], y); }))
        : h('p.muted', 'Nothing it wrote could be checked against what the steps found, so nothing is shown.'),
      aiNote(a.kept, a.dropped.length))));
}
function coachActions(tool) {
  var spots = Home.weakSpots(ui.docs, ui.sessions || {}, ui.cards, Session.mastery, 3);
  var due = Session.dueCards(ui.cards, today()).length;
  var cur = Home.current(ui.docs.filter(function (d) { return !d.bookId || ui.at[d.id]; }), ui.sessions || {});
  if (tool === 'help') return h('div.chips', ['Explain preload', 'Quiz me on heart failure', 'Compare aortic stenosis and aortic regurgitation', 'What should I study today?', 'Where am I weakest?']
    .map(function (x) { return button(x, function () { askNow(x); }, 'chip quiet'); }));
  if (tool === 'review') return due ? button('Review my ' + due + ' due card' + (due === 1 ? '' : 's'), function () { startReview(); }, 'chip', { id: 'agent-review' }) : h('p', 'No cards are due today.');
  if (tool === 'weak') {
    /* The items still weak, by unit (skill.js), then the weakest sections. */
    var items = Agent.weakItems(ui.docs, ui.sessions || {}, 3);
    var itemList = items.length ? h('ul.agent-weak-items', { id: 'agent-weak-items' }, items.map(function (w) {
      return h('li', h('p', h('strong', w.name + ': '), w.line), w.review ? button('Review round: ' + w.name, function () { openDoc(w.docId); }, 'chip quiet') : null);
    })) : null;
    if (!spots.length && !itemList) return h('p', 'Nothing yet: drill a section or two and I’ll know where you are shaky.');
    return [itemList, spots.length ? h('ul', spots.map(function (w) { return h('li', button(w.title, function () { openDoc(w.docId, w.cluster); }, 'chip quiet')); })) : null];
  }
  return h('ol', [cur ? h('li', button('Carry on with ' + cur.doc.name, function () { openDoc(cur.doc.id); }, 'chip quiet')) : null,
    spots[0] ? h('li', button('Relearn your weakest: ' + spots[0].title, function () { openDoc(spots[0].docId, spots[0].cluster); }, 'chip quiet')) : null,
    due ? h('li', button('Review ' + due + ' due card' + (due === 1 ? '' : 's'), function () { startReview(); }, 'chip quiet')) : null].filter(Boolean).concat(
    !cur && !spots[0] && !due ? [h('li', 'Add a chapter and start its first section.')] : []));
}
function sectionLink(idx, secId, extra) {
  var sec = idx.sections[secId];
  return h('li', button([h('strong', sec.title), h('span.muted', ' ' + (sec.book ? sec.book + ' · ' : '') + sec.chapter + ' · p. ' + sec.pageStart + (extra ? ' · ' + extra : ''))],
    function () { openDoc(sec.docId, sec.ci); }, 'quiet link', { 'data-sec': String(secId) }));
}
function viewAsk() {
  var idx = ui.askIdx, r = ui.askR;
  /* What is typed is kept as it is typed: the screen is redrawn when the
     index finishes building, and the first version lost a question typed
     before that (the browser suite caught it once a unit was added). */
  var input = h('input', { id: 'ask-q', type: 'search', value: ui.askQ, placeholder: 'e.g. How is aortic stenosis treated?', 'aria-label': 'Your question',
    oninput: function () { ui.askQ = input.value; },
    onkeydown: function (e) { if (e.key === 'Enter') askNow(input.value); } });
  var answer = null;
  if (r && idx) {
    var sum = ui.ai.summary && ui.ai.summary.q === r.question ? ui.ai.summary : null;
    var aiBox = r.found && aiOn() ? h('div.card.ai-card', { id: 'ai-answer' },
      sum ? [sum.kept.length ? h('p', sum.kept.map(function (k) { return [k.text, ' ', h('sup.cite', k.cites.map(function (n) { return '[' + n + ']'; }).join(''))]; }).reduce(function (a, b) { return a.concat([' '], b); }))
                             : h('p.muted', 'Nothing it wrote could be checked against the quotes, so nothing is shown.'), aiNote(sum.kept, sum.dropped.length)]
        : h('div.row', button('✨ Summarise with the on-device AI', function () {
            var items = r.groups.reduce(function (a, g) { return a.concat(g.items); }, []).sort(function (a, b) { return b.score - a.score; }).slice(0, 6);
            aiJob('Summarising your book\u2019s answer…', function () { return LLM.chat(LLM.SYSTEM, LLM.summaryPrompt(r.question, items), null, 260); }).then(function (t) {
              if (t == null) return; var g = Ground.summary(t, items); ui.ai.summary = { q: r.question, kept: g.kept, dropped: g.dropped, items: items }; render();
            });
          }, 'quiet', { id: 'ai-summarise' })),
      ui.ai.busy ? h('p.muted', { role: 'status' }, ui.ai.busy) : null,
      ui.ai.error ? h('p.warn', 'The on-device AI could not run: ' + ui.ai.error) : null) : null;
    answer = r.found ? h('div.card', { id: 'answer' },
      h('p.muted.legend', h('span.src', 'Book · p.'), ' your book’s own words, where it printed them · ', h('span.arranged', 'Headings'), ' arranged by Memorizer, not the book'),
      r.groups.map(function (g) {
        return [h('h3.arranged', g.heading), h('ul.quotes', g.items.map(function (it) {
          var sec = idx.sections[it.sec];
          return h('li', h('p.quote-text', marked(it.text)), h('span.src', (sec.book || sec.chapter) + ' · p. ' + it.page),
            it.by === 'meaning' ? h('span.tag.meaning-tag', ' found by meaning') : null);
        }))];
      }),
      h('h3', 'Read more'), h('ul.read-more', { id: 'read-more' }, r.sections.map(function (s) { return sectionLink(idx, s); })))
      : h('div.card', { id: 'not-found', role: 'status' }, h('h2', 'Not found in your book'),
        h('p', 'Nothing in your units matches that question. Try the name of the condition, test or drug, or browse the indexes below. Memorizer does not answer from anywhere but your book.'));
  }
  var kinds = [['chapters', 'Chapters']].concat(Object.keys(Ask.KIND_LABELS).map(function (k) { return [k, Ask.KIND_LABELS[k]]; }));
  var browse = null;
  if (idx) {
    var list = ui.askKind === 'chapters'
      ? idx.chapters.map(function (c) { return h('li', h('details', h('summary', (c.book ? c.book + ' · ' : '') + c.title), h('ul.read-more', c.sections.map(function (s) { return sectionLink(idx, s); })))); })
      : idx.index[ui.askKind].map(function (e) {
          return h('li', h('details', h('summary', e.label + ' · ' + Home.count(e.sections.length, 'section')),
            h('ul.read-more', e.sections.slice(0, 20).map(function (w) { return sectionLink(idx, w.sec, w.count + '×'); }))));
        });
    browse = h('div.card', { id: 'browse' }, h('h2', 'Browse your book'),
      h('div.seg', { role: 'radiogroup', 'aria-label': 'Index' }, kinds.map(function (k) {
        return h('button', { type: 'button', role: 'radio', 'aria-checked': String(ui.askKind === k[0]), 'data-kind': k[0], onclick: function () { ui.askKind = k[0]; render(); } }, k[1]);
      })),
      list.length ? h('ul.index-list', list) : h('p.muted', 'Nothing of this kind is named in your units.'));
  }
  /* The coach speaks first: what it can do, and the next best step. */
  var spots = Home.weakSpots(ui.docs, ui.sessions || {}, ui.cards, Session.mastery, 1);
  var due = Session.dueCards(ui.cards, today()).length;
  var cur = Home.current(ui.docs.filter(function (d) { return !d.bookId || ui.at[d.id]; }), ui.sessions || {});
  var suggest = [
    spots[0] ? button('Teach me my weakest section: ' + spots[0].title, function () { openDoc(spots[0].docId, spots[0].cluster); }, 'chip', { id: 'coach-weak' }) : null,
    cur ? button('Carry on with ' + cur.doc.name, function () { openDoc(cur.doc.id); }, 'chip', { id: 'coach-continue' }) : null,
    due ? button('Review my ' + due + ' due card' + (due === 1 ? '' : 's'), function () { startReview(); }, 'chip', { id: 'coach-review' }) : null,
    ui.askR ? null : ['How is aortic stenosis treated?', 'What causes heart failure?'].map(function (q) {
      return button(q, function () { askNow(q); }, 'chip quiet');
    }),
  ];
  var ai = aiOn(), meaning = meaningOn();
  return h('main.wrap.ask',
    backBar('Your coach', function () { leave('library'); }),
    h('div.coach-intro',
      h('div.coach-avatar', mascot()),
      h('div.bubble', h('p', h('strong', 'I’m your coach. '), 'Ask me anything about your book, or tell me what to do — “explain preload”, “quiz me on heart failure”, “compare aortic stenosis and regurgitation”, “what should I study?”. I answer from your book, with the page, or say it isn’t there. ' +
        (ai ? 'My on-device AI can summarise and explain, and everything it says is checked against the book.' : 'Turn on the on-device AI in Settings and I can also summarise and explain.')),
        h('p.muted', 'Search: ' + (meaning ? 'by words and by meaning.' : 'by words. Turn on search by meaning in Settings to find ideas phrased differently.')),
        ui.profile && ui.profile.turns ? h('p.muted', { id: 'coach-memory' }, 'What I remember, on this iPad only: ' + (Agent.profileLine(ui.profile, '') || 'nothing yet') + ' ',
          button('Forget', function () { ui.profile = null; Store.del('meta', 'coach-profile').then(function () { render(); }); }, 'quiet', { id: 'coach-forget' })) : null,
        h('div.chips.suggest', suggest))),
    h('div.card.ask-card', h('div.row.ask-row', input, micButton(function (t) { ui.askQ = t; askNow(t); }, 'ask-mic'), button('Ask', function () { askNow(doc.getElementById('ask-q').value); }, 'primary', { id: 'ask-go' })),
      h('p.muted', 'Found on this device, never sent anywhere.')),
    (ui.turns || []).map(function (t, k, all) {
      var latest = k === all.length - 1;
      /* the latest search shows its answer in full; an earlier one, its first lines */
      if (t.plan.tool === 'search' && t.r !== ui.askR) return [turnView(t, idx, false), h('div.card.earlier', h('p.muted', t.r.found ? 'From your book: ' : 'Not found in your book.'),
        t.r.found ? h('ul.quotes', t.r.groups.reduce(function (a, g) { return a.concat(g.items); }, []).slice(0, 2).map(function (it) { return h('li', marked(it.text), ' ', page(it.page)); })) : null)];
      return t.plan.tool === 'search' ? [turnView(t, idx, latest), typeof aiBox !== 'undefined' ? aiBox : null, answer] : turnView(t, idx, latest);
    }),
    ui.askBusy ? h('div.card.busy', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', ui.askBusyText || 'Indexing your book (once)…')) : null,
    ui.ai.error && ui.view === 'ask' ? h('p.warn', ui.ai.error) : null,
    !ui.docs.length ? h('div.card.empty', h('p', 'Add a chapter or a book first; then ask it anything.')) : null,
    browse);
}

/* ── SETTINGS ────────────────────────────────────────────────────────────── */
function appearanceCard() {
  var look = Look.load();
  function set(k, v) { look[k] = v; Look.apply(look); Look.save(look); render(); }
  function seg(kind, label) {
    return [h('div.group-label', { id: 'lbl-' + kind }, label),
      h('div.seg', { role: 'radiogroup', 'aria-labelledby': 'lbl-' + kind }, Look.OPTIONS[kind].map(function (o) {
        var at = { type: 'button', role: 'radio', 'aria-checked': String(look[kind] === o[0]), onclick: function () { set(kind, o[0]); } };
        at['data-' + kind] = o[0];
        return h('button', at, o[1]);
      }))];
  }
  /* Each theme shown as itself in miniature: its ground, a card on it with
     a line of text, and its accent — the choice is seen, not guessed from
     two dots. Auto shows its day and night themes side by side. */
  function mini(th) {
    var t = th.t;
    return h('span.sw-mini', { style: 'background:' + t.bg + ';border-color:' + t.line, 'aria-hidden': 'true' },
      h('span.sw-card', { style: 'background:' + t.surface + ';border-color:' + t.line },
        h('span.sw-line', { style: 'background:' + t.ink }), h('span.sw-line.short', { style: 'background:' + t.muted }),
        h('span.sw-pill', { style: 'background:' + t.accent })));
  }
  function swatch(id, name, minis, note) {
    return h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(look.theme === id), 'data-theme-id': id,
        onclick: function () { set('theme', id); } },
      h('span.sw-minis', minis), h('span.sw-name', h('strong', name), note ? h('small', note) : null));
  }
  var NOTES = { daylight: 'iPad light', clinical: 'Near-black, monitor green', paper: 'Warm, for long reading', neuron: 'Deep indigo, electric cyan',
    ice: 'Quantum blue on ice glass', mint: 'Ghost green on zero black', butter: 'Royal iris on butter yellow', graphite: 'Graphite, a calm blue',
    grape: 'Acid lime on cyber grape', contrast: 'Systole\u2019s, strongest' };
  var themes = function (mode) {
    return Look.THEMES.filter(function (t) { return t.mode === mode; }).map(function (t) { return swatch(t.id, t.name, [mini(t)], NOTES[t.id]); });
  };
  return h('div.card.settings', { id: 'appearance' }, h('h2', 'Appearance'),
    h('p.muted', 'Daylight by day and Clinical at night; Paper, Ice and Butter in the light; Neuron, Mint Night, Graphite and Grape in the dark; or Systole\u2019s Contrast. Systole\u2019s type scale. Contrast and brightness adjust whichever theme you pick, and every setting keeps text at WCAG AA or better.'),
    h('div.group-label', { id: 'lbl-theme' }, 'Theme'),
    h('div.swatches', { role: 'radiogroup', 'aria-labelledby': 'lbl-theme' },
      swatch('auto', 'Auto', [mini(Look.byId(Look.AUTO.light)), mini(Look.byId(Look.AUTO.dark))], 'Follows the device'), themes('light')),
    h('div.swatches', { role: 'radiogroup', 'aria-labelledby': 'lbl-theme' }, themes('dark')),
    seg('size', 'Text size'), seg('width', 'Reading width'), seg('spacing', 'Line spacing'),
    seg('contrast', 'Contrast'), seg('bright', 'Brightness'),
    seg('font', 'Font'),
    h('div.preview', h('span.count', 'Preview'), h('p', { style: 'margin:0' },
      h('strong', 'Preload'), ' — the stretch on ventricular myocytes at the end of diastole.', page(4))));
}

function viewSettings() {
  var c = cfg();
  var prov = h('select', { id: 'provider', onchange: function () { fillModels(); } },
    Object.keys(Provider.PROVIDERS).map(function (k) { return h('option', { value: k, selected: k === c.provider }, Provider.PROVIDERS[k].label); }));
  var model = h('select', { id: 'model' });
  var key = h('input', { id: 'key', type: 'password', autocomplete: 'off', spellcheck: 'false', value: c.key });
  var hint = h('p.muted');
  var keyed = h('div', h('label', 'Model', model), h('label', 'API key', key), hint);
  var about = h('div.card.note', { id: 'builtin-about' },
    h('strong', 'The built-in coach '), 'teaches from your book’s own sentences — the big idea, key points, numbers to know and a mnemonic for every list — ',
    'adds everyday analogies for common cardiology ideas (labelled as Memorizer’s, not your book’s), and drills you with multiple-choice questions built from the book: ',
    'the right answer and its explanation are the book’s words, and the wrong options are real terms, causes and values from elsewhere in the same unit. ',
    'It needs no key and no account, and nothing leaves this device. Claude writes deeper lessons, analogies for any topic and clinical-vignette questions.');
  function fillModels() {
    var P = Provider.PROVIDERS[prov.value];
    model.textContent = '';
    P.models.forEach(function (m) { model.appendChild(h('option', { value: m[0], selected: m[0] === c.model }, m[1])); });
    hint.textContent = P.keyHint ? 'Key: ' + P.keyHint : '';
    keyed.style.display = P.noKey ? 'none' : '';
    about.style.display = P.noKey ? '' : 'none';
  }
  fillModels();
  var saved = h('span.muted', { role: 'status', id: 'settings-status' });
  var clearKey = c.key ? button('Clear key', function () {
    var ok = Provider.saveConfig({ provider: c.provider, model: c.model, key: '' });
    key.value = '';
    saved.textContent = ok ? 'Key removed from this device.' : 'This browser refused to change it (private mode?).';
    if (ok) clearKey.remove();
  }, 'quiet danger', { id: 'clear-key' }) : null;
  keyed.appendChild(h('p.muted.key-warn', { id: 'key-warn' }, 'Your key is kept in this browser\u2019s storage on this device, unencrypted, and sent only to the provider. Any browser extension or script allowed to run on this page could read it: use a key with a spending limit, and clear it when you stop using Claude here.'));
  return h('main.wrap',
    backBar('Settings', function () { leave('library'); }),
    appearanceCard(),
    h('div.card.settings', h('h2', 'Coach'),
      h('label', 'Coach', prov), about, keyed,
      h('div.row', button('Save', function () {
        var P = Provider.PROVIDERS[prov.value];
        var ok = Provider.saveConfig({ provider: prov.value, model: model.value, key: P.noKey ? '' : key.value.trim() });
        saved.textContent = ok ? 'Saved on this device.' : 'This browser refused to save it (private mode?).';
      }, 'primary', { id: 'save-settings' }), clearKey, saved)),
    aiSettingsCard(),
    h('div.card', h('h2', 'What leaves this device'),
      h('p', 'Your PDF, photos and notes are read here, in the browser, and never uploaded. The PDF reader itself is downloaded once from jsDelivr, and so is the text reader for scanned pages and photos, the first time it is needed; they are read on this device too.'),
      h('p', 'With the built-in coach, nothing else leaves the device. With Claude, each lesson and drill sends only the text of the section you are studying to Anthropic, with your key; the final exam sends the key points of every section and the full text of your two weakest. Your key is kept in this browser’s storage and sent only to Anthropic.')),
    /* Which build is running, so an update can be checked on the device:
       the owner's screenshots were of a build two releases old. */
    h('p.muted.build-line', { id: 'build' }, 'Memorizer build ' + (doc.documentElement.getAttribute('data-build') || 'unbuilt (running from source)') +
      '. When you are online the newest build loads each time the app opens.'));
}

function aiSettingsCard() {
  var c = LLM.loadConfig();
  var model = h('select', { id: 'ai-model' }, LLM.MODELS.map(function (m) {
    return h('option', { value: m.id, selected: m.id === c.model }, m.label + ' — about ' + (m.mb >= 1000 ? (m.mb / 1000).toFixed(1) + ' GB' : m.mb + ' MB') + ' · ' + m.licence);
  }));
  return h('div.card.settings.ai-card', { id: 'ai-card' }, h('h2', '✨ On-device AI tutor'),
    h('p', 'Optional. A small language model (Qwen3, Apache-2.0), downloaded once and run on this iPad\u2019s GPU, that explains sections in plain words, suggests analogies, summarises what your book says in answer to a question, and writes harder questions. It also runs your Coach as an agent: it can use several of the Coach’s tools on your book before it answers, and what it says is checked against what they found. It needs no key and, once downloaded, no connection.'),
    h('p', h('strong', 'It is not a source of facts. '), 'Every sentence it writes is checked against your book before you see it: no number and no disease, test or drug the book passage does not have, and a question is kept only when your book states its answer — and the book\u2019s own sentence is shown as the explanation. What fails the check is dropped and counted.'),
    h('label', 'Model', model),
    h('p.muted', 'Needs WebGPU (iPadOS 26 or later). The engine comes pinned and integrity-checked from jsDelivr; the model itself comes from Hugging Face through that engine, which does not check it against a hash, and is kept in this browser\u2019s cache.'),
    h('div.row', button(c.on ? 'Turn off' : 'Turn on', function () {
      var on = !c.on;
      LLM.saveConfig({ on: on, model: model.value, meaning: c.meaning });
      if (on) aiJob('Downloading and starting the model (once)…', function () { return true; }); else render();
    }, c.on ? 'quiet' : 'primary', { id: 'ai-toggle' }), h('span.muted', { id: 'ai-status', role: 'status' }, ui.ai.busy || ui.ai.status || (c.on ? (LLM.ready() ? 'Ready.' : 'On — starts when first used.') : 'Off.'))),
    h('h3', 'Search by meaning'),
    h('p', 'Ask finds your book\u2019s sentences by their words; this finds them by what they mean too — "why do people pass out" finds "exertional syncope". A small model (' + LLM.EMBED.label + ', about ' + LLM.EMBED.mb + ' MB, ' + LLM.EMBED.licence +
      ') reads each section once, on this device. The answers are still your book\u2019s own sentences with their pages.'),
    h('div.row', button(c.meaning ? 'Turn off' : 'Turn on', function () {
      LLM.saveConfig({ on: c.on, model: c.model, meaning: !c.meaning }); render();
    }, c.meaning ? 'quiet' : 'primary', { id: 'meaning-toggle' }), h('span.muted', c.meaning ? 'On.' : 'Off.')),
    ui.ai.error ? h('p.warn', { id: 'ai-error' }, 'The on-device AI could not run: ' + ui.ai.error) : null,
    h('div.row', button('Delete the downloaded model', function () {
      ui.ai.busy = 'Deleting the downloaded model…'; ui.ai.error = ''; render();
      LLM.clearModel(model.value).then(function () { ui.ai.busy = ''; ui.ai.status = 'Deleted. Turn it on to download it again, from the start.'; render(); },
        function (e) { ui.ai.busy = ''; ui.ai.error = (e && e.message) || String(e); render(); });
    }, 'quiet', { id: 'ai-clear' }), h('span.muted', 'If a download broke part-way and keeps failing, this starts it clean.')));
}

/* ── frame: a floating bar at the foot of the screen ─────────────────────── */
function nav() {
  var due = Session.dueCards(ui.cards, today()).length;
  var here = ui.view === 'session' || ui.view === 'book' ? 'shelf' : ui.view;
  function tab(v, icon, label, go2, badge) {
    return h('button.nav-btn', { type: 'button', 'aria-current': here === v ? 'page' : null, onclick: go2, 'aria-label': label + (badge ? ', ' + badge + ' due' : '') },
      h('span.nav-icon', { 'aria-hidden': 'true' }, icon), h('span.nav-label', label), badge ? h('span.nav-badge', String(badge)) : null);
  }
  /* the one next thing on this screen (study.js contextAction) */
  var ctx = ui.view === 'session' && ui.state ? Study.contextAction(ui.state, Session.allDone(ui.state)) : null;
  return h('nav.dock', { 'aria-label': 'Main' },
    ctx ? h('button.nav-btn.nav-context', { type: 'button', id: 'dock-context', 'data-action': ctx.id, onclick: function () { contextGo(ctx.id); } },
      h('span.nav-icon', { 'aria-hidden': 'true' }, '\u25B6'), h('span.nav-label', ctx.label)) : null,
    tab('library', '⌂', 'Home', function () { leave('library'); }),
    tab('shelf', '📚', 'Chapters', function () { leave('shelf'); }),
    tab('ask', '🎓', 'Coach', function () { ui.view = 'ask'; ui.error = ''; refresh().then(function () { render(); if (ui.docs.length) askIndex().then(render); }); }),
    tab('review', '↻', 'Review', function () { startReview(); }, due),
    tab('settings', '⚙', 'Settings', function () { leave('settings'); }));
}

function contextGo(id) {
  var s = ui.state;
  if (id === 'learn') return go({ type: 'open', section: upNext(s) });
  if (id === 'exam') return go({ type: 'toExam' });
  if (id === 'memorise') return go({ type: 'toMemorize', value: { cards: Coach.recallCards(cluster(), s.per[s.section].lesson).length } });
  if (id === 'drill') return go({ type: 'toDrill' });
  if (id === 'sections') return go({ type: 'toUnit' });
  if (id === 'next') { var nx = Session.nextSection(s); return go(nx != null ? { type: 'open', section: nx } : { type: 'toExam' }); }
}

/* ── motion: HyperFrames' composition model, played live ───────────────────
   HyperFrames (HeyGen, Apache-2.0) describes a video as HTML whose pieces
   carry data-start and data-duration on one timeline, which a player can
   seek to any instant. The same model here, played in the app with the
   browser's Web Animations — no video file, nothing downloaded:
     · a composition is any element with data-comp="<key>";
     · each piece inside has data-start / data-duration (seconds) and
       data-anim (rise, fade, pop, draw, unfold);
     · play() starts it when the slide is drawn; a slide drawn again
       (another tap on the page) shows it finished instead of replaying;
     · seek(t) sets every piece to time t — deterministic, as in HyperFrames
       — which is also how the browser suite checks what is visible when.
   With reduced motion asked for, nothing moves: every piece is simply there. */
var ANIMS = {
  rise: [{ opacity: 0, transform: 'translateY(.75rem)' }, { opacity: 1, transform: 'none' }],
  fade: [{ opacity: 0 }, { opacity: 1 }],
  pop: [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.15)', offset: .7 }, { opacity: 1, transform: 'none' }],
  draw: [{ transform: 'scaleY(0)', opacity: 1 }, { transform: 'scaleY(1)', opacity: 1 }],
  unfold: [{ clipPath: 'inset(0 100% 0 0)', opacity: 1 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }],
};
function reducedMotion() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function pieces(comp) { return Array.prototype.slice.call(comp.querySelectorAll('[data-start]')); }
function total(comp) { return pieces(comp).reduce(function (m, el) { return Math.max(m, +el.getAttribute('data-start') + (+el.getAttribute('data-duration') || 0.5)); }, 0); }
function play(comp) {
  if (reducedMotion() || !comp.animate) return;
  ui.played = ui.played || {};
  var key = comp.getAttribute('data-comp'), done = ui.played[key];
  comp.__anims = pieces(comp).map(function (el) {
    return el.animate(ANIMS[el.getAttribute('data-anim')] || ANIMS.fade,
      { delay: +el.getAttribute('data-start') * 1000, duration: (+el.getAttribute('data-duration') || 0.5) * 1000, fill: 'both', easing: 'cubic-bezier(.2,.7,.2,1)' });
  });
  if (done) seek(comp, total(comp));
  ui.played[key] = true;
}
function seek(comp, t) { (comp.__anims || []).forEach(function (a) { a.pause(); a.currentTime = t * 1000; }); }
function replay() {
  Array.prototype.forEach.call(doc.querySelectorAll('[data-comp]'), function (comp) {
    (comp.__anims || []).forEach(function (a) { a.cancel(); });
    delete (ui.played || {})[comp.getAttribute('data-comp')];
    play(comp);
  });
}
/* 1. THE PATHWAY, animated: each step of the book's chain appears in turn,
   and the arrow to the next draws itself, the book's verb riding on it. */
var STEP_GAP = 1.1;
function pathwayPlay(path) {
  return h('div.card.pathway', { id: 'pathway-play', 'data-comp': 'path:' + ui.docId + ':' + ui.state.section },
    h('span.eyebrow', 'How it works — your book’s cause and effect'),
    h('ol.pp', path.map(function (st, i) {
      var t = i * STEP_GAP;
      return h('li.pp-item', i ? h('div.pp-arrow', { 'aria-hidden': 'true' },
          h('span.pp-line', { 'data-start': t - 0.55, 'data-duration': 0.5, 'data-anim': 'draw' }),
          h('span.pp-verb', { 'data-start': t - 0.35, 'data-duration': 0.35, 'data-anim': 'fade' }, st.verb)) : null,
        h('span.pp-step', { 'data-start': t, 'data-duration': 0.45, 'data-anim': 'rise' }, i ? h('span.sr-only', st.verb + ' ') : null, st.label));
    })),
    h('p.muted', 'Say each step aloud as it appears.'));
}
/* 3. THE MNEMONIC, revealed: the letters appear one by one, then each word
   unfolds from its letter. */
function mnemonicPlay(m) {
  var n = m.words.length, lt = 0.35, wt = 0.5, wordsAt = n * lt + 0.3;
  return h('div.card.hook', { 'data-comp': 'hook:' + ui.docId + ':' + ui.state.section + ':' + m.title },
    h('span.eyebrow', 'Remember it'), h('h3', m.title),
    h('p.hook-script', m.letters.split('').map(function (ch, i) {
      return [i ? ' · ' : '', h('span.hs-letter', { 'data-start': i * lt, 'data-duration': 0.3, 'data-anim': 'pop' }, ch)];
    })),
    h('ul.acrostic', m.words.map(function (w, i) {
      return h('li', h('span.letter', w.charAt(0).toUpperCase()),
        h('span.word', { 'data-start': wordsAt + i * wt, 'data-duration': 0.45, 'data-anim': 'unfold' }, w));
    })),
    h('p.muted', 'Say the letters, then name each one.'));
}

/* ── the robot: the coach, on the right, explaining what is on screen ──────
   A small robot at the foot of the screen, on the right, during a lesson,
   a drill or the exam. Tapped, it opens a small window: for a question,
   what kind it is, where to look and a hint (never in the exam, and never
   the answer); once answered, why, and where the book mentions each wrong
   option. For a lesson, the section in one line, its cause and effect, what
   is asked most, its mnemonics — and the on-device AI tutor, when it is on,
   lives here now rather than in the lesson. coach.js writes the words
   (explainQuestion, explainSection); this only lays them out. */
function robotContext() {
  if (ui.view !== 'session' || !ui.state) return null;
  var s = ui.state;
  if (s.phase === 'teach') return s.per[s.section].lesson ? { type: 'lesson', c: cluster(), L: s.per[s.section].lesson } : null;
  if (s.phase === 'drill') {
    var p = s.per[s.section];
    if (!p.quiz || !p.quiz.questions.length) return null;
    var pr = ui.back > 0 && p.answers[p.answers.length - ui.back];
    return pr ? { type: 'question', c: cluster(), q: p.quiz.questions[pr.q], chosen: pr.choice } : { type: 'question', c: cluster(), q: p.quiz.questions[p.order[p.pos]] };
  }
  if (s.phase === 'exam' && s.exam.questions) {
    var er = ui.back > 0 && s.exam.results[s.exam.results.length - ui.back];
    var q = er ? s.exam.questions[er.q] : s.exam.questions[s.exam.order[s.exam.pos]];
    return q ? { type: 'question', exam: true, c: ui.docRec.clusters[q.cluster] || cluster(), q: q, chosen: er ? er.choice : undefined } : null;
  }
  return null;
}
function robotFace() {
  var ns = 'http://www.w3.org/2000/svg';
  var svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'robot-svg');
  svg.innerHTML = '<line class="rb-stalk" x1="32" y1="6" x2="32" y2="15"/><circle class="rb-bulb" cx="32" cy="6" r="4"/>' +
    '<rect class="rb-ear" x="5" y="26" width="6" height="14" rx="3"/><rect class="rb-ear" x="53" y="26" width="6" height="14" rx="3"/>' +
    '<rect class="rb-head" x="10" y="15" width="44" height="36" rx="12"/><rect class="rb-visor" x="16" y="22" width="32" height="18" rx="9"/>' +
    '<g class="rb-eyes"><circle cx="25" cy="31" r="3.6"/><circle cx="39" cy="31" r="3.6"/></g>' +
    '<path class="rb-smile" d="M26 45 Q32 49 38 45"/><rect class="rb-neck" x="26" y="51" width="12" height="5" rx="2"/>';
  return svg;
}
function robotLine(label, body) { return h('div.rb-line', h('span.rb-label', label), h('p', body)); }
function robotBody(ctx) {
  if (ctx.type === 'lesson') {
    var e = Coach.explainSection(ctx.c, ctx.L);
    return [
      e.gist ? robotLine('In one line', marked(e.gist)) : null,
      e.chain ? robotLine('How it works', e.chain) : null,
      e.facts.length ? h('div.rb-line', h('span.rb-label', 'Asked most'), h('ul', e.facts.map(function (f) { return h('li', f); }))) : null,
      e.hooks.map(function (m) { return robotLine('Remember: ' + m.title, [h('strong.rb-letters', m.letters.split('').join(' · ')), ' — ' + m.words.join(', ')]); }),
      aiLessonCard(ctx.c, ctx.L),
    ];
  }
  var q = ctx.q, chosen = ctx.chosen != null ? ctx.chosen : ui.choice;
  var x = Coach.explainQuestion(ctx.c, q, chosen);
  if (chosen == null) {
    return [robotLine('What it asks', x.kind),
      ctx.exam ? h('p.muted', 'This is the exam, so no hints — answer, and I’ll explain every option.') : [
        x.where ? robotLine('Where to look', ['Under “' + x.where + '” in this section’s key points', x.page ? [' ', page(x.page)] : null, '.']) : null,
        x.hint ? robotLine('Your book says', ['“' + x.hint + '”']) : null,
        !x.where && !x.hint ? h('p.muted', 'Read the question twice, rule out what you are sure is wrong, then choose.') : null]];
  }
  return [robotLine('What it asked', x.kind),
    robotLine('Why', [marked(x.why), x.page ? [' ', page(x.page)] : null]),
    h('ol.rb-options', x.options.map(function (o, i) {
      return h('li' + (o.right ? '.right' : o.chosen ? '.wrong' : ''),
        h('span.opt-letter', LETTERS[i]), h('div', h('strong', o.text), o.right ? h('span.rb-tag', ' ✓ the answer') : o.chosen ? h('span.rb-tag', ' ✗ your choice') : null,
          o.right ? null : h('p.muted', o.said ? ['In your book: “', o.said, '” ', page(o.page)] : 'Not what your book says here.')));
    }))];
}
function robot() {
  var ctx = robotContext();
  if (!ctx) { ui.robotOpen = false; return null; }
  var open = !!ui.robotOpen;
  var toggle = function () { ui.robotOpen = !ui.robotOpen; render(); };
  return h('div.robot-dock', { id: 'robot-dock' },
    open ? h('section.robot-panel', { id: 'robot-panel', role: 'dialog', 'aria-label': 'Coach explains' },
      h('div.rb-head', h('strong', ctx.type === 'lesson' ? 'This section, explained' : 'This question, explained'),
        h('button.rb-close', { type: 'button', 'aria-label': 'Close', onclick: toggle }, '×')),
      h('div.rb-body', robotBody(ctx))) : null,
    h('button.robot' + (open ? '.on' : ''), { id: 'robot', type: 'button', 'aria-expanded': open ? 'true' : 'false',
      'aria-label': ctx.type === 'lesson' ? 'Coach: explain this section' : 'Coach: explain this question', onclick: toggle }, robotFace()));
}

/* Said on every screen, not only Home: work that will not survive a reload,
   or a step that was not stored, is the one thing the reader must not have
   to go looking for. */
function storageBanner() {
  if (ui.saveError) {
    return h('div.card.error.store-banner', { id: 'store-banner', role: 'alert' },
      h('strong', 'Your last step was not saved. '), 'The browser said: ' + ui.saveError + '. ',
      'It stays on screen and is saved with your next step; if this keeps happening, delete a unit you have finished to free space.',
      h('div.row', button('Try saving again', function () {
        (ui.state ? save() : Promise.resolve()).then(render);
      }, 'primary', { id: 'store-retry' })));
  }
  /* Opened from the iPad's Files app, Safari shows the file as a data: URL:
     no origin, so no storage of any kind, and no "normal window" fixes it. */
  if (!Store.persistent && /^data:/.test(String(root.location && root.location.protocol))) {
    return h('p.warn.store-banner', { id: 'store-banner', role: 'status' },
      h('strong', 'Nothing you add here will be kept. '),
      'Opened from the Files app, Safari gives this page no storage at all, so units, progress and cards are gone when the tab closes. ' +
      'Open Memorizer from its web address instead (for example your Cloudflare Pages link), then Share → Add to Home Screen.');
  }
  if (!Store.persistent) {
    return h('p.warn.store-banner', { id: 'store-banner', role: 'status' },
      h('strong', 'Study data is kept only for this visit. '),
      'This browser would not open its storage (private browsing does this), so your units, progress and cards will be gone after a reload. Open Memorizer in a normal window to keep them.');
  }
  return null;
}

/* The light on the glass follows the finger, or the pointer: the pane
   under it is marked lit, with the light's place as --px / --py (app.css
   draws it; appearance.js fits text against it at its brightest). A
   finger lifted takes it away; with reduced motion there is none. */
var GLASSY = '.card:not(.big-idea):not(.pearl), .jump-card, .unit-row, .section-card, .option, .learn-box, details.source';
var lit = null, lastView = null;
function unlight() { if (lit) lit.removeAttribute('data-lit'); lit = null; }
function light(e) {
  var el = !reducedMotion() && e.target && e.target.closest ? e.target.closest(GLASSY) : null;
  if (lit !== el) unlight();
  if (!el) return;
  var r = el.getBoundingClientRect();
  el.style.setProperty('--px', Math.round(e.clientX - r.left) + 'px');
  el.style.setProperty('--py', Math.round(e.clientY - r.top) + 'px');
  el.setAttribute('data-lit', '');
  lit = el;
}
doc.addEventListener('pointermove', light, { passive: true });
doc.addEventListener('pointerdown', light, { passive: true });
doc.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') unlight(); }, { passive: true });
doc.addEventListener('pointercancel', unlight, { passive: true });
doc.addEventListener('pointerout', function (e) { if (!e.relatedTarget) unlight(); }, { passive: true });

function render() {
  releaseStale();
  applyFocus();
  var app = doc.getElementById('app');
  var view = ui.view === 'session' && ui.state ? viewSession()
    : ui.view === 'book' ? viewBook()
    : ui.view === 'ask' ? viewAsk()
    : ui.view === 'review' ? viewReview()
    : ui.view === 'check' ? viewCheck()
    : ui.view === 'practice' ? viewPractice()
    : ui.view === 'settings' ? viewSettings()
    : ui.view === 'shelf' ? viewShelf() : viewHome();
  /* A new screen settles in (app.css, main[data-enter]); a redraw of the
     same screen does not. */
  if (ui.view !== lastView) { view.setAttribute('data-enter', ''); lastView = ui.view; }
  app.textContent = '';
  var banner = storageBanner();
  if (banner) view.insertBefore(banner, view.firstChild && view.firstChild.nextSibling);
  app.appendChild(view);
  app.appendChild(nav());
  var rb = robot();
  if (rb) app.appendChild(rb);
  Array.prototype.forEach.call(app.querySelectorAll('[data-comp]'), play);
  if (ui.view === 'session') { pump(); focusTeach(); }
}

/* The Coach asked for a teach-back: its card, once the lesson is drawn. */
function focusTeach() {
  if (!ui.teachFocus || ui.view !== 'session') return;
  var el = doc.getElementById('teach-text');
  if (!el) return;
  ui.teachFocus = false;
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  el.focus();
}
function start() {
  Store.open().then(refresh).then(render, function (e) {
    ui.error = 'Could not open storage: ' + (e && e.message); render();
  });
}

root.Memorizer = { makeStudyCards: makeStudyCards, aiCase: aiCase, startPractice: startPractice, motion: { seek: seek, total: total, replay: replay }, ui: ui, render: render, start: start, importBook: importBook, openBook: openBook, importFile: importFile, importText: importText, importPhotos: importPhotos, openDoc: openDoc };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
