/* ═══════════════════════════════════════════════════════════════════════════
   ui.js — the screens. Library, Session, Review, Settings.

   Everything a model says reaches the page as TEXT (textContent), never as
   markup. The one exception is a Mermaid flowchart, which is rendered by
   Mermaid itself under securityLevel "strict" — Mermaid sanitises its own
   output — and falls back to the diagram source shown as plain text.

   The protocol lives in session.js; this file dispatches events to it and
   draws whatever state comes back. It keeps exactly one thing of its own:
   `ui.feedback`, the grade card shown after an answer, which is a view of a
   step already taken rather than part of the protocol.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var doc = root.document;
var Chunk = root.MemChunk, Prompts = root.MemPrompts, Session = root.MemSession;
var Provider = root.MemProvider, Store = root.MemStore, Pdf = root.MemPdf, FSRS = root.FSRS, Coach = root.MemCoach;

var MERMAID = { url: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js',
                sri: 'sha384-WmdflGW9aGfoBdHc4rRyWzYuAjEmDwMdGdiPNacbwfGKxBW/SO6guzuQ76qjnSlr' };

var ui = {
  view: 'library',      /* library | session | review | settings */
  docs: [], cards: [],
  docId: null, docRec: null, state: null,
  busy: '', error: '', feedback: null,
  importing: '', draft: '', reviewIdx: 0, reviewShown: false, reviewDone: 0,
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
function refresh() {
  return Promise.all([Store.all('docs'), Store.all('cards')]).then(function (r) {
    ui.docs = r[0].sort(function (a, b) { return b.addedAt - a.addedAt; });
    ui.cards = r[1];
  });
}
function save() {
  if (!ui.state) return Promise.resolve();
  return Store.put('sessions', { id: ui.docId, state: ui.state })
    .then(function () { return Store.mergeCards(ui.state.cards); })
    .then(function () { return Store.all('cards'); })
    .then(function (c) { ui.cards = c; });
}

function dispatch(event) {
  ui.state = Session.next(ui.state, event);
  ui.draft = '';
  return save();
}

/* ── the step runner: one place that shows busy, error and retry ────────── */
/* kind names the step; args are the same for either coach — prompts.js
   builds a request for Claude from them, coach.js answers from them
   directly. The built-in coach's answer is held to the same schema the
   model's is, so a bug there is an error on screen, never a bad grade. */
function ask(label, kind, args) {
  ui.busy = label; ui.error = ''; render();
  var c = cfg();
  var step = !Provider.needsKey(c)
    ? new Promise(function (resolve) {
        var v = Coach[kind].apply(null, args);
        var err = Prompts.check(Prompts.SCHEMAS[kind], v);
        if (err) throw new Error('the built-in coach produced a malformed ' + kind + ': ' + err);
        resolve(v);
      })
    : Provider.call(c, Prompts[kind].apply(null, args), kind);
  return step.then(function (v) {
    ui.busy = ''; return v;
  }, function (e) {
    ui.busy = ''; ui.error = (e && e.message) || String(e); render();
    throw e;
  });
}

function cluster(i) { return ui.docRec.clusters[i == null ? ui.state.cluster : i]; }

/* Advance whatever the current phase needs from the model, if anything. */
function pump() {
  var s = ui.state;
  if (!s || ui.busy || ui.error || ui.feedback) return;
  var c = s.per[s.cluster];
  if (s.phase === 'encode' && !c.points) {
    ask('Reading this section and building your memory hooks…', 'encode', [cluster()])
      .then(function (v) { return dispatch({ type: 'encoded', value: v }); })
      .then(render, function () {});
  } else if (s.phase === 'recall' && !c.prompts) {
    ask('Writing your recall questions…', 'recall', [cluster(), c.points])
      .then(function (v) { return dispatch({ type: 'recallPrompts', value: v }); })
      .then(render, function () {});
  } else if (s.phase === 'gauntlet' && !s.gauntlet.questions) {
    var points = {};
    ui.docRec.clusters.forEach(function (_, i) { points[i] = s.per[i].points || []; });
    ask('Preparing the gauntlet — hostile questions on your weakest sections…',
        'gauntlet', [ui.docRec.clusters, points, Session.weakest(s, 2), Session.gauntletSize(s)])
      .then(function (v) { return dispatch({ type: 'gauntletReady', value: v }); })
      .then(render, function () {});
  }
}

/* ── import ──────────────────────────────────────────────────────────────── */
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
function importFile(file) {
  if (!file) return;
  ui.importing = 'Opening ' + file.name + '…'; ui.error = ''; render();
  readBuffer(file).then(function (buf) {
    return Pdf.read(buf, function (n, total) { ui.importing = 'Reading page ' + n + ' of ' + total + '…'; render(); });
  }).then(function (r) {
    var blocks = Chunk.blocksFromPages(r.pages).blocks;
    var clusters = Chunk.clusterBlocks(blocks);
    if (!clusters.length) throw new Error('No readable text in this PDF. It looks like a scan (pictures of pages) — this version cannot read those yet.');
    var rec = {
      id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: file.name.replace(/\.pdf$/i, ''), addedAt: Date.now(), pages: r.numPages,
      scanned: Chunk.scannedPages(r.wordCounts), clusters: clusters,
    };
    return Store.put('docs', rec);
  }).then(function () {
    ui.importing = ''; return refresh();
  }).then(render, function (e) {
    ui.importing = ''; ui.error = (e && e.message) || String(e); render();
  });
}

function openDoc(id) {
  return Promise.all([Store.get('docs', id), Store.get('sessions', id)]).then(function (r) {
    ui.docRec = r[0];
    ui.docId = id;
    ui.state = r[1] ? r[1].state : Session.init(id, ui.docRec.clusters.map(function (c) { return c.title; }));
    ui.view = 'session'; ui.error = ''; ui.feedback = null;
    return save();
  }).then(function () { render(); root.scrollTo(0, 0); });
}

/* ── speech ──────────────────────────────────────────────────────────────── */
var Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
var listening = null;
function dictate(textarea, button) {
  if (listening) { listening.stop(); return; }
  var rec = new Recognition();
  rec.continuous = true; rec.interimResults = true; rec.lang = doc.documentElement.lang || 'en-US';
  var base = textarea.value ? textarea.value.replace(/\s*$/, ' ') : '';
  rec.onresult = function (ev) {
    var said = '';
    for (var i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
    textarea.value = base + said;
  };
  rec.onend = function () { listening = null; button.textContent = '🎙 Speak'; button.classList.remove('live'); };
  rec.onerror = rec.onend;
  listening = rec;
  button.textContent = '■ Stop'; button.classList.add('live');
  rec.start();
}
function speak(text) {
  if (!root.speechSynthesis) return;
  root.speechSynthesis.cancel();
  var u = new root.SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  root.speechSynthesis.speak(u);
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

/* ── shared pieces ───────────────────────────────────────────────────────── */
function page(n) { return h('span.pg', 'p.' + n); }
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

/* ── LIBRARY ─────────────────────────────────────────────────────────────── */
function viewLibrary() {
  var input = h('input', { type: 'file', accept: 'application/pdf,.pdf', id: 'pdf-input', class: 'visually-hidden',
    onchange: function (e) { importFile(e.target.files[0]); e.target.value = ''; } });
  var drop = h('label.drop', { for: 'pdf-input',
      ondragover: function (e) { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: function () { drop.classList.remove('over'); },
      ondrop: function (e) { e.preventDefault(); drop.classList.remove('over'); importFile(e.dataTransfer.files[0]); } },
    h('span.drop-icon', { 'aria-hidden': 'true' }, '📄'),
    h('strong', ui.importing || 'Add a PDF to master'),
    h('span.muted', ui.importing ? '' : 'Tap to choose, or drop it here. It is read on this device.'));

  var due = Session.dueCards(ui.cards, today()).length;
  var list = ui.docs.map(function (d) {
    var sess = null;
    var progress = h('div.bar', h('i', { style: 'width:0%' }));
    Store.get('sessions', d.id).then(function (s) {
      sess = s && s.state;
      if (!sess) return;
      var n = d.clusters.length;
      var doneC = sess.phase === 'done' ? n : sess.phase === 'gauntlet' ? n : sess.cluster;
      progress.firstChild.style.width = Math.round(100 * doneC / n) + '%';
      status.textContent = sess.phase === 'done' ? 'Mastered — run it again any time'
        : sess.phase === 'gauntlet' ? 'Gauntlet next' : 'Section ' + (sess.cluster + 1) + ' of ' + n;
      go.textContent = sess.phase === 'done' ? 'Review session' : 'Continue';
    });
    var status = h('span.muted', 'Not started');
    var go = button('Start', function () { openDoc(d.id); }, 'primary');
    return h('li.card.doc',
      h('div.doc-head', h('strong.doc-name', d.name),
        h('span.muted', d.pages + ' pages · ' + d.clusters.length + ' sections')),
      progress, status,
      d.scanned && d.scanned.length ? h('p.warn', 'Pages with no readable text (scanned?): ' + d.scanned.slice(0, 12).join(', ') + (d.scanned.length > 12 ? '…' : '') + '. They are not in any section.') : null,
      h('div.row', go,
        button('Restart', function () {
          if (!root.confirm('Start "' + d.name + '" from the beginning? Your review cards are kept.')) return;
          Store.del('sessions', d.id).then(function () { openDoc(d.id); });
        }),
        button('Delete', function () {
          if (!root.confirm('Delete "' + d.name + '" and its review cards from this device?')) return;
          Store.deleteDoc(d.id).then(refresh).then(render);
        }, 'quiet')));
  });

  return h('main.wrap',
    h('section.hero',
      h('h1', 'Master a whole unit.'),
      h('p.lede', 'Upload the PDF. Each section goes through encode → recall → teach-back, then a hostile gauntlet. Everything you miss comes back as a spaced-repetition card until it sticks.')),
    !hasKey() ? h('div.card.note', h('strong', 'Claude needs your API key. '), 'Add it in Settings, or switch back to the built-in coach, which needs none. ',
      button('Settings', function () { ui.view = 'settings'; render(); }, 'primary')) : null,
    hasKey() && builtin() ? h('p.muted', 'Using the built-in coach: free, no key, nothing leaves this device. For smarter questions and grading, add a Claude key in Settings.') : null,
    ui.error ? errorCard(null) : null,
    input, drop,
    due ? h('div.card.note', h('strong', due + ' card' + (due === 1 ? '' : 's') + ' due today. '),
      button('Review now', function () { startReview(); }, 'primary')) : null,
    ui.docs.length ? h('h2', 'Your units') : null,
    h('ul.docs', list),
    !Store.persistent ? h('p.warn', 'This browser would not open local storage (private mode?). Your work will not survive a reload.') : null);
}

/* ── SESSION ─────────────────────────────────────────────────────────────── */
var PHASES = [['encode', 'Encode'], ['recall', 'Recall'], ['explain', 'Teach back'], ['gauntlet', 'Gauntlet']];

function stepper(s) {
  var order = { encode: 0, recall: 1, explain: 2, gauntlet: 3, done: 4 };
  return h('ol.stepper', { 'aria-label': 'Protocol step' }, PHASES.map(function (p, i) {
    var state = i < order[s.phase] ? 'done' : i === order[s.phase] ? 'now' : '';
    return h('li' + (state ? '.' + state : ''), { 'aria-current': state === 'now' ? 'step' : null }, p[1]);
  }));
}

function sessionHeader() {
  var s = ui.state, n = ui.docRec.clusters.length;
  var c = s.phase === 'gauntlet' || s.phase === 'done' ? null : cluster();
  return h('header.session-head',
    h('div.crumbs', button('← Library', function () { leave('library'); }, 'quiet'),
      h('span.muted', ui.docRec.name)),
    c ? h('div.where', h('span.count', 'Section ' + (s.cluster + 1) + ' of ' + n), h('h1', c.title),
          h('span.muted', 'pages ' + c.pageStart + (c.pageEnd !== c.pageStart ? '–' + c.pageEnd : '') + ' · ' + c.words + ' words'))
      : h('div.where', h('h1', s.phase === 'done' ? 'Unit complete' : 'The gauntlet')),
    h('div.bar', h('i', { style: 'width:' + Math.round(100 * (s.phase === 'gauntlet' || s.phase === 'done' ? n : s.cluster) / n) + '%' })),
    s.phase !== 'done' ? stepper(s) : null);
}

function viewEncode(c, per) {
  var src = h('details.source', h('summary', 'Show the PDF text for this section'),
    cluster().segments.map(function (seg) { return h(seg.heading ? 'h3' : 'p', page(seg.page), ' ', seg.text); }));
  return [
    h('div.card',
      h('h2', 'Key points'),
      h('ol.points', per.points.map(function (p) { return h('li', p.text, ' ', page(p.page)); })),
      h('div.row', button('🔊 Listen', function () { speak(per.points.map(function (p) { return p.text; }).join('. ')); }, 'quiet'))),
    per.mnemonic ? h('div.card.mnemonic', h('h2', 'Memory hook'), h('p', per.mnemonic)) : null,
    per.flowchart && per.flowchart.trim() ? h('div.card', h('h2', 'The flow'), flowchart(per.flowchart)) : null,
    src,
    h('div.card.cta',
      h('p', 'Read the points twice, say the hook out loud, then close your eyes and replay them. Ready?'),
      button('I’m ready — test me', function () { dispatch({ type: 'toRecall' }).then(render); }, 'primary big', { id: 'to-recall' })),
  ];
}

function answerBox(placeholder, onSubmit, withMic) {
  var ta = h('textarea.answer', { rows: withMic ? 8 : 4, placeholder: placeholder, 'aria-label': 'Your answer',
    onkeydown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } } });
  if (ui.draft) ta.value = ui.draft;
  /* The draft survives a failed grading call, so Try again does not cost the
     answer you just wrote. It is cleared once a grade lands. */
  function go() { ui.draft = ta.value; onSubmit(ta.value); }
  var mic = withMic && Recognition ? button('🎙 Speak', function () { dictate(ta, mic); }, 'mic') : null;
  setTimeout(function () { try { ta.focus(); } catch (_) {} }, 0);
  return h('div.answer-wrap', ta, h('div.row', mic, button(withMic ? 'Grade my teach-back' : 'Check', go, 'primary', { id: 'submit-answer' }),
    withMic && !Recognition ? h('span.muted', 'Dictation is not available in this browser — type it, or use the keyboard’s mic.') : null));
}

function viewRecall(c, per) {
  var i = per.recallIdx, q = per.prompts[i];
  return [
    h('div.card',
      h('span.count', 'Question ' + (i + 1) + ' of ' + per.prompts.length),
      h('h2.q', q.question),
      h('p.muted', 'From memory — no peeking. Write what you would say in the exam.'),
      answerBox('Your answer…', function (a) {
        ask('Grading your answer…', 'gradeRecall', [cluster(), q, a]).then(function (v) {
          ui.feedback = { kind: 'recall', grade: v, q: q, answer: a, event: { type: 'recallGraded', value: v, answer: a } };
        }).then(render, function () {});
      })),
  ];
}

function viewExplain(c, per) {
  return [
    h('div.card',
      h('h2', 'Teach it back'),
      h('p', 'Explain “' + c.title + '” out loud as if you were teaching a colleague who has never seen it. Cover the why, not just the what. No notes.'),
      answerBox('Your explanation (tap Speak to dictate)…', function (a) {
        ask('Listening like an examiner…', 'gradeExplain', [cluster(), per.points, a]).then(function (v) {
          ui.feedback = { kind: 'explain', grade: v, title: c.title, event: { type: 'explainGraded', value: v, explanation: a } };
        }).then(render, function () {});
      }, true)),
  ];
}

function viewGauntlet() {
  var g = ui.state.gauntlet, q = g.questions[g.idx];
  var ci = q.cluster == null ? Session.gauntletCluster(ui.state, g.idx) : q.cluster;
  return [
    h('div.card.gauntlet',
      h('span.count', 'Gauntlet ' + (g.idx + 1) + ' of ' + g.questions.length + ' · ' + (ui.docRec.clusters[ci] || {}).title),
      h('h2.q', q.question),
      answerBox('Defend your answer…', function (a) {
        ask('The examiner is reading your answer…', 'gradeRecall', [ui.docRec.clusters[ci], q, a]).then(function (v) {
          ui.feedback = { kind: 'gauntlet', grade: v, q: q, answer: a, event: { type: 'gauntletGraded', value: v, answer: a } };
        }).then(render, function () {});
      })),
  ];
}

/* A grade is shown before it is recorded, so the one thing a grader cannot
   know — that "fibre" and "fiber", or a synonym, were right — can be put
   right by the one person who does. The step is dispatched on Continue, or
   when leaving the screen: settle() is the only way a shown grade is lost
   to nothing, and nothing calls it without dispatching. */
function settle() {
  var f = ui.feedback;
  ui.feedback = null;
  return f && f.event ? dispatch(f.event) : Promise.resolve();
}
function leave(view) {
  settle().then(function () { ui.view = view; ui.error = ''; return refresh(); }).then(render);
}
function viewFeedback() {
  var f = ui.feedback, g = f.grade;
  var next = button('Continue', function () { settle().then(function () { render(); root.scrollTo(0, 0); }); }, 'primary big', { id: 'continue' });
  var overrule = f.kind !== 'explain' && !g.correct
    ? button('I had it right \u2014 count it as correct', function () {
        var fixed = { correct: true, missing: [], misconception: '', feedback: 'Counted as correct by you.' };
        f.grade = fixed; f.event.value = fixed; render();
      }, 'quiet', { id: 'overrule' })
    : null;
  if (f.kind === 'explain') {
    return h('div.card.feedback' + (g.score >= 80 ? '.good' : g.score >= 50 ? '.mid' : '.bad'), { role: 'status' },
      h('div.score', h('strong', String(g.score)), h('span', '/ 100')),
      h('h2', 'Teach-back: ' + f.title),
      h('p', g.feedback),
      g.gaps.length ? [h('h3', 'What you left out — now review cards'), h('ul', g.gaps.map(function (x) { return h('li', x.point, ' ', page(x.page)); }))] : h('p', 'Nothing left out. 🎉'),
      g.misconceptions.length ? [h('h3', 'Said, but the PDF says otherwise'), h('ul', g.misconceptions.map(function (x) { return h('li', x); }))] : null,
      next);
  }
  return h('div.card.feedback' + (g.correct ? '.good' : '.bad'), { role: 'status' },
    h('h2', g.correct ? '✓ Correct' : '✗ Not quite — this is now a review card'),
    h('p', g.feedback),
    g.missing.length && !(g.missing.length === 1 && g.missing[0] === f.q.answer)
      ? [h('h3', 'Missing'), h('ul', g.missing.map(function (x) { return h('li', x); }))] : null,
    g.misconception ? [h('h3', 'Misconception'), h('p', g.misconception)] : null,
    h('h3', 'Model answer'), h('p', f.q.answer, ' ', page(f.q.page)),
    /* A fill-in-the-blank question, shown whole: the word alone, without its
       sentence, is not much to learn from. */
    /_____/.test(f.q.question)
      ? h('p.muted', { id: 'filled' }, f.q.question.replace(/^[^:]*blank:\s*/, '').replace('_____', '\u00AB' + f.q.answer + '\u00BB')) : null,
    h('div.row', next, overrule));
}

function viewDone() {
  var s = ui.state;
  var mine = ui.cards.filter(function (c) { return c.docId === ui.docId; });
  var right = s.gauntlet.results.filter(function (r) { return r.correct; }).length;
  return [
    h('div.card',
      h('h2', 'Gauntlet: ' + right + ' of ' + s.gauntlet.results.length + ' defended'),
      h('p', mine.length + ' review card' + (mine.length === 1 ? '' : 's') + ' from this unit. They come back on a spaced schedule (FSRS) — tomorrow for the ones you just missed, then further apart each time you get them.'),
      h('div.row', button('Review cards now', function () { startReview(); }, 'primary big'))),
    h('div.card', h('h2', 'Mastery by section'),
      h('ul.mastery', ui.docRec.clusters.map(function (c, i) {
        var m = Session.mastery(s, i) || 0;
        return h('li', h('span', c.title), h('div.bar', h('i', { style: 'width:' + Math.round(m * 100) + '%' })), h('span.muted', Math.round(m * 100) + '%'));
      }))),
  ];
}

function viewSession() {
  var s = ui.state, per = s.per[s.cluster], body;
  if (ui.feedback) body = viewFeedback();
  else if (ui.error) body = errorCard(function () { render(); pump(); });
  else if (ui.busy) body = busyCard();
  else if (s.phase === 'done') body = viewDone();
  else if (s.phase === 'gauntlet') body = s.gauntlet.questions ? viewGauntlet() : busyCard();
  else if (s.phase === 'encode') body = per.points ? viewEncode(cluster(), per) : busyCard();
  else if (s.phase === 'recall') body = per.prompts ? viewRecall(cluster(), per) : busyCard();
  else body = viewExplain(cluster(), per);
  return h('main.wrap', sessionHeader(), h('div.phase', { 'data-phase': s.phase }, body));
}

/* ── REVIEW ──────────────────────────────────────────────────────────────── */
function startReview() {
  ui.view = 'review'; ui.reviewIdx = 0; ui.reviewShown = false; ui.reviewDone = 0;
  refresh().then(render);
}
function viewReview() {
  var due = Session.dueCards(ui.cards, today());
  var names = {};
  ui.docs.forEach(function (d) { names[d.id] = d.name; });
  if (!due.length) {
    return h('main.wrap', h('div.card', h('h1', ui.reviewDone ? 'Done for today.' : 'Nothing due.'),
      h('p', ui.reviewDone ? ui.reviewDone + ' card' + (ui.reviewDone === 1 ? '' : 's') + ' reviewed. Come back tomorrow.' : 'Cards appear here when you miss something in a session, and again when they are due.'),
      button('Back to library', function () { ui.view = 'library'; render(); }, 'primary')));
  }
  var card = due[0];
  var rate = function (r) {
    var upd = Session.review(card, r, today(), FSRS);
    Store.put('cards', upd).then(refresh).then(function () { ui.reviewShown = false; ui.reviewDone++; render(); });
  };
  return h('main.wrap',
    h('div.review-head', h('span.count', due.length + ' due'), h('span.muted', (names[card.docId] || '') + ' · ' + card.title)),
    h('div.card.flash',
      h('span.tag', card.source === 'explain' ? 'teach-back gap' : card.source),
      h('h2.q', card.front),
      ui.reviewShown ? [h('hr'), h('p.back', card.back, ' ', page(card.page)),
        h('div.grades',
          button('Again', function () { rate(1); }, 'g1'), button('Hard', function () { rate(2); }, 'g2'),
          button('Good', function () { rate(3); }, 'g3'), button('Easy', function () { rate(4); }, 'g4'))]
        : button('Show answer', function () { ui.reviewShown = true; render(); }, 'primary big', { id: 'show-answer' })));
}

/* ── SETTINGS ────────────────────────────────────────────────────────────── */
function viewSettings() {
  var c = cfg();
  var prov = h('select', { id: 'provider', onchange: function () { fillModels(); } },
    Object.keys(Provider.PROVIDERS).map(function (k) { return h('option', { value: k, selected: k === c.provider }, Provider.PROVIDERS[k].label); }));
  var model = h('select', { id: 'model' });
  var key = h('input', { id: 'key', type: 'password', autocomplete: 'off', spellcheck: 'false', value: c.key });
  var hint = h('p.muted');
  var keyed = h('div', h('label', 'Model', model), h('label', 'API key', key), hint);
  var about = h('div.card.note', { id: 'builtin-about' },
    h('strong', 'The built-in coach '), 'teaches from your PDF\u2019s own sentences \u2014 it never invents anything \u2014 ',
    'quizzes you with fill-in-the-blank questions, and grades by matching your words (a synonym can be counted as correct by you). ',
    'It needs no key and no account, and nothing leaves this device. Claude writes deeper questions and understands answers in your own words.');
  function fillModels() {
    var P = Provider.PROVIDERS[prov.value];
    model.textContent = '';
    P.models.forEach(function (m) { model.appendChild(h('option', { value: m[0], selected: m[0] === c.model }, m[1])); });
    hint.textContent = P.keyHint ? 'Key: ' + P.keyHint : '';
    keyed.style.display = P.noKey ? 'none' : '';
    about.style.display = P.noKey ? '' : 'none';
  }
  fillModels();
  var saved = h('span.muted', { role: 'status' });
  return h('main.wrap',
    h('div.card.settings', h('h1', 'Settings'),
      h('label', 'Coach', prov), about, keyed,
      h('div.row', button('Save', function () {
        var P = Provider.PROVIDERS[prov.value];
        var ok = Provider.saveConfig({ provider: prov.value, model: model.value, key: P.noKey ? '' : key.value.trim() });
        saved.textContent = ok ? 'Saved on this device.' : 'This browser refused to save it (private mode?).';
      }, 'primary', { id: 'save-settings' }), saved)),
    h('div.card', h('h2', 'What leaves this device'),
      h('p', 'Your PDF is read here, in the browser, and is never uploaded. The PDF reader itself is downloaded once from jsDelivr.'),
      h('p', 'With the built-in coach, nothing else leaves the device. With Claude, each step sends only the text of the section you are studying \u2014 plus your answer \u2014 to Anthropic, with your key; the gauntlet sends the key points of every section and the full text of your two weakest. Your key is kept in this browser\u2019s storage and sent only to Anthropic.')));
}

/* ── frame ───────────────────────────────────────────────────────────────── */
function nav() {
  var due = Session.dueCards(ui.cards, today()).length;
  function tab(v, label, go) {
    return h('button.tab', { type: 'button', 'aria-current': ui.view === v ? 'page' : null, onclick: go }, label);
  }
  return h('nav.top', { 'aria-label': 'Main' },
    h('span.brand', h('span.logo', { 'aria-hidden': 'true' }, '◆'), 'Memorizer'),
    h('div.tabs',
      tab('library', 'Library', function () { leave('library'); }),
      tab('review', due ? 'Review · ' + due : 'Review', function () { settle().then(startReview); }),
      tab('settings', 'Settings', function () { leave('settings'); })));
}

function render() {
  var app = doc.getElementById('app');
  var view = ui.view === 'session' && ui.state ? viewSession()
    : ui.view === 'review' ? viewReview()
    : ui.view === 'settings' ? viewSettings() : viewLibrary();
  app.textContent = '';
  app.appendChild(nav());
  app.appendChild(view);
  if (ui.view === 'session') pump();
}

function start() {
  Store.open().then(refresh).then(render, function (e) {
    ui.error = 'Could not open storage: ' + (e && e.message); render();
  });
}

root.Memorizer = { ui: ui, render: render, start: start, importFile: importFile, openDoc: openDoc };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
