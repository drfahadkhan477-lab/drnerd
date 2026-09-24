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
var Format = root.MemFormat, Look = root.MemLook, Home = root.MemHome, Pearl = root.Pearl;

var MERMAID = { url: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js',
                sri: 'sha384-WmdflGW9aGfoBdHc4rRyWzYuAjEmDwMdGdiPNacbwfGKxBW/SO6guzuQ76qjnSlr' };

var ui = {
  view: 'library',      /* library | session | review | settings */
  docs: [], cards: [], sessions: {}, pearlSkip: 0,
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
  return Promise.all([Store.all('docs'), Store.all('cards'), Store.all('sessions')]).then(function (r) {
    ui.docs = r[0].sort(function (a, b) { return b.addedAt - a.addedAt; });
    ui.cards = r[1];
    ui.sessions = {};
    r[2].forEach(function (x) { ui.sessions[x.id] = x.state; });
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
  var bytes = null;
  readBuffer(file).then(function (buf) {
    bytes = buf;
    return Pdf.read(buf, function (n, total, pass) {
      ui.importing = pass === 'ocr' ? 'Reading scanned page ' + n + ' of ' + total + ' with text recognition…' : 'Reading page ' + n + ' of ' + total + '…';
      render();
    }, function (msg) { ui.importing = msg; render(); });
  }).then(function (r) {
    var blocks = Chunk.blocksFromPages(r.pages).blocks;
    var clusters = Chunk.clusterBlocks(blocks);
    if (!clusters.length) throw new Error(r.ocrError
      ? 'No readable text in this PDF. It looks like a scan (pictures of pages), and the text reader for scans could not run: ' + r.ocrError
      : 'No readable text in this PDF, even with text recognition. If it is a scan, it may be too faint or too small to read.');
    var rec = {
      id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: file.name.replace(/\.pdf$/i, ''), addedAt: Date.now(), pages: r.numPages,
      scanned: Chunk.scannedPages(r.wordCounts), clusters: clusters, figures: r.figures || [], hasFile: true,
      ocr: r.ocr || [], ocrError: r.ocrError || '',
    };
    return Store.put('files', { id: rec.id, bytes: bytes }).then(function () { return Store.put('docs', rec); });
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
/* The home screen, laid out as Systole's: a hero band with the greeting and
   where you are, progress in two layers, today's pearl beside it, then the
   doors, then the units. Nothing on it moves (src/home.js says why). */
function viewLibrary() {
  var input = h('input', { type: 'file', accept: 'application/pdf,.pdf', id: 'pdf-input', class: 'visually-hidden',
    onchange: function (e) { importFile(e.target.files[0]); e.target.value = ''; } });
  var sessions = ui.sessions || {};
  var day = today();
  var prog = Home.progress(ui.docs, sessions, ui.cards, day, FSRS);
  var cur = Home.current(ui.docs, sessions);
  var due = Session.dueCards(ui.cards, day).length;

  function where(d, st) {
    var n = d.clusters.length;
    if (!st) return 'Not started';
    if (st.phase === 'done') return 'Mastered — run it again any time';
    if (st.phase === 'gauntlet') return 'Gauntlet next';
    return 'Section ' + (st.cluster + 1) + ' of ' + n;
  }

  /* ── hero ── */
  var meter = h('div.meter', { role: 'img', id: 'home-meter',
      'aria-label': prog.studied + ' of ' + prog.sections + ' sections studied; ' + prog.held + ' of ' + prog.cards + ' review cards held' },
    h('i.studied', { style: 'width:' + prog.studiedPct + '%' }), h('i.held', { style: 'width:' + prog.heldPct + '%' }));
  var trace = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  trace.setAttribute('class', 'hero-trace'); trace.setAttribute('viewBox', '0 0 600 48');
  trace.setAttribute('preserveAspectRatio', 'none'); trace.setAttribute('aria-hidden', 'true');
  var tp = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  tp.setAttribute('d', Home.tracePath(600, 4));
  trace.appendChild(tp);
  var hero = h('section.home-hero', { 'aria-labelledby': 'home-title' }, trace,
    h('span.hero-greet', Home.greeting(new Date().getHours())),
    h('h1', { id: 'home-title' }, cur ? cur.doc.name : 'Master a whole unit.'),
    h('p.hero-sub', cur ? where(cur.doc, cur.state) + ' · ' + Home.count(cur.doc.clusters.length, 'section') + ' · ' + Home.count(cur.doc.pages, 'page')
      : 'Add a PDF. Each section goes through encode → recall → teach-back, then a hostile gauntlet; everything you miss comes back as a review card until it sticks.'),
    ui.docs.length ? [meter,
      h('div.meter-key',
        h('span', h('b.k-studied', { 'aria-hidden': 'true' }), prog.studied + ' of ' + Home.count(prog.sections, 'section') + ' studied'),
        h('span', h('b.k-held', { 'aria-hidden': 'true' }), prog.cards ? prog.held + ' of ' + Home.count(prog.cards, 'card') + ' held today' : 'No review cards yet'))] : null);

  /* ── the pearl ── */
  var pk = ui.docs.length ? Home.pearlOf(ui.docs, Pearl, day, ui.pearlSkip || 0) : null;
  var pearl;
  if (pk) {
    pearl = h('aside.pearl.card', { id: 'pearl', 'aria-labelledby': 'pearl-label' },
      h('span.eyebrow', { id: 'pearl-label' }, 'Today’s pearl'),
      h('ol.pearl-steps', pk.steps.map(function (st) {
        return h('li', st.lead ? h('span.pearl-lead', st.lead) : null,
          Home.marks(st.text).map(function (r) { return r.num ? h('mark', r.text) : r.text; }));
      })),
      h('p.pearl-src', pk.pearl.heading, pk.pearl.page ? page(pk.pearl.page) : null, ui.docs.length > 1 ? ' · ' + pk.pearl.docName : ''),
      h('div.row',
        pk.of > 1 ? button('Another', function () { ui.pearlSkip = (ui.pearlSkip || 0) + 1; render(); }, '', { id: 'pearl-next' }) : null,
        button('Open the unit', function () { openDoc(pk.pearl.docId); }, 'quiet')));
  } else {
    pearl = h('aside.pearl.card', { id: 'pearl' },
      h('span.eyebrow', 'How it works'),
      h('ol.pearl-steps',
        h('li', h('span.pearl-lead', 'encode'), 'Read the section’s key points and its memory hook'),
        h('li', h('span.pearl-lead', 'recall'), 'Answer from memory, then check'),
        h('li', h('span.pearl-lead', 'teach'), 'Explain it back in your own words'),
        h('li', h('span.pearl-lead', 'gauntlet'), 'Hard questions across the unit, aimed at your weakest sections')),
      h('p.pearl-src', ui.docs.length ? 'A pearl appears here once a section has a sentence worth one.' : 'A pearl from your own PDF appears here once you add one.'));
  }

  /* ── doors ── */
  function door(id, icon, title, sub, go, extra) {
    return h('button.door', Object.assign({ type: 'button', id: id, onclick: go }, extra || {}),
      h('span.door-icon', { 'aria-hidden': 'true' }, icon), h('span.door-title', title), h('span.door-sub', sub));
  }
  var addDoor = h('label.door.drop', { for: 'pdf-input', id: 'door-add',
      ondragover: function (e) { e.preventDefault(); addDoor.classList.add('over'); },
      ondragleave: function () { addDoor.classList.remove('over'); },
      ondrop: function (e) { e.preventDefault(); addDoor.classList.remove('over'); importFile(e.dataTransfer.files[0]); } },
    h('span.door-icon', { 'aria-hidden': 'true' }, '+'),
    h('span.door-title', ui.importing ? 'Reading…' : 'Add a PDF'),
    h('span.door-sub', ui.importing || 'Tap to choose, or drop it here. Read on this device.'));
  var doors = h('nav.doors', { 'aria-label': 'Start here' },
    cur ? door('door-continue', '▶', cur.started ? 'Continue' : 'Start', cur.doc.name + ' · ' + where(cur.doc, cur.state), function () { openDoc(cur.doc.id); }) : addDoor,
    door('door-review', '↻', due ? 'Review · ' + due : 'Review', due ? due + ' card' + (due === 1 ? '' : 's') + ' due today' : ui.cards.length ? 'Nothing due today' : 'Misses become cards here',
      function () { startReview(); }),
    cur ? addDoor : null,
    door('door-settings', '⚙', 'Settings', 'Theme, text size, coach', function () { leave('settings'); }));

  /* ── weak spots: where the sessions say you are shakiest ── */
  var spots = Home.weakSpots(ui.docs, sessions, ui.cards, Session.mastery, 3);
  var weak = spots.length ? h('section.card.weak', { id: 'weak', 'aria-labelledby': 'weak-label' },
    h('span.eyebrow', { id: 'weak-label' }, 'Weak spots'),
    h('ul.weak-list', spots.map(function (w) {
      return h('li',
        h('div.weak-what', h('strong', w.title), h('span.muted', (ui.docs.length > 1 ? w.docName + ' · ' : '') + w.pct + '% mastered')),
        w.cards ? button('Drill · ' + w.cards, function () { startDrill(w); }, '', { 'aria-label': 'Drill the ' + w.cards + ' card' + (w.cards === 1 ? '' : 's') + ' from ' + w.title })
          : h('span.muted', 'No cards'));
    }))) : null;

  /* ── units ── */
  var list = ui.docs.map(function (d) {
    var st = sessions[d.id];
    var n = d.clusters.length;
    var pct = Math.round(100 * Home.studiedOf(d, st) / Math.max(1, n));
    return h('li.card.doc',
      h('div.doc-head', h('strong.doc-name', d.name),
        h('span.muted', Home.count(d.pages, 'page') + ' · ' + Home.count(n, 'section'))),
      h('div.bar', h('i', { style: 'width:' + pct + '%' })), h('span.muted', where(d, st)),
      d.ocr && d.ocr.length ? h('p.muted.ocr-note', 'Scanned pages read by text recognition: ' + d.ocr.slice(0, 12).join(', ') + (d.ocr.length > 12 ? '…' : '') + '. Check anything surprising against the page itself.') : null,
      d.scanned && d.scanned.length ? h('p.warn', 'Pages with no readable text (scanned?): ' + d.scanned.slice(0, 12).join(', ') + (d.scanned.length > 12 ? '…' : '') + '. They are not in any section' +
        (d.ocrError ? ' — the text reader could not run (' + d.ocrError + ').' : '.')) : null,
      h('div.row', button(!st ? 'Start' : st.phase === 'done' ? 'Review session' : 'Continue', function () { openDoc(d.id); }, 'primary'),
        button('Restart', function () {
          if (!root.confirm('Start "' + d.name + '" from the beginning? Your review cards are kept.')) return;
          Store.del('sessions', d.id).then(function () { openDoc(d.id); });
        }),
        button('Delete', function () {
          if (!root.confirm('Delete "' + d.name + '" and its review cards from this device?')) return;
          Store.deleteDoc(d.id).then(refresh).then(render);
        }, 'quiet')));
  });

  return h('main.wrap.home',
    h('div.home-top', hero, pearl),
    input, doors, weak,
    !hasKey() ? h('div.card.note', h('strong', 'Claude needs your API key. '), 'Add it in Settings, or switch back to the built-in coach, which needs none. ',
      button('Settings', function () { ui.view = 'settings'; render(); }, 'primary')) : null,
    hasKey() && builtin() ? h('p.muted.coach-line', 'Using the built-in coach: free, no key, nothing leaves this device. For smarter questions and grading, add a Claude key in Settings.') : null,
    ui.error ? errorCard(null) : null,
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
          h('span.muted', (c.pageEnd !== c.pageStart ? 'pages ' + c.pageStart + '–' + c.pageEnd : 'page ' + c.pageStart) + ' · ' + c.words + ' words'))
      : h('div.where', h('h1', s.phase === 'done' ? 'Unit complete' : 'The gauntlet')),
    h('div.bar', h('i', { style: 'width:' + Math.round(100 * (s.phase === 'gauntlet' || s.phase === 'done' ? n : s.cluster) / n) + '%' })),
    s.phase !== 'done' ? stepper(s) : null);
}

/* ── the study page's pieces ─────────────────────────────────────────────── */

/* A point as a bullet: its key term bold, its sub-points below. format.js
   only removes words, so this is still the PDF talking. */
function bulletItem(p) {
  var b = Format.bullet(p.text);
  return h('li',
    b.lead ? h('span.lead', b.lead) : null, b.body, page(p.page),
    b.subs.length ? h('ul.subs', b.subs.map(function (x) { return h('li', x); })) : null);
}

/* The built-in hook is "First letters: CECCC — a · b · c. …": drawn as an
   acrostic. Anything else (Claude's) is shown as written, in the script face. */
function hookCard(per) {
  if (!per.mnemonic) return null;
  var m = /^First letters(?: of ([^:]+))?: ([A-Z]+) \u2014 (.+?)\. Say/.exec(per.mnemonic);
  var body = m
    ? [m[1] ? h('p.muted', { style: 'margin:.25rem 0 0' }, m[1]) : null,
       h('p.hook-script', m[2].split('').join(' \u00B7 ')),
       h('ul.acrostic', m[3].split(' \u00B7 ').map(function (w) {
         return h('li', h('span.letter', w.charAt(0).toUpperCase()), h('span.word', w));
       })),
       h('p.muted', m[1] ? 'Say the letters, then name each one.' : 'Say the letters, then what each stands for.')]
    : [h('p.hook-script', per.mnemonic)];
  return h('div.card.hook', { id: 'hook' }, h('span.eyebrow', 'Memory hook'), body);
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
function flowCard(c, per) {
  var f = null, fromModel = false;
  if (per.flowchart && per.flowchart.trim()) {
    var parsed = parseMermaid(per.flowchart);
    if (parsed.edges.length) { f = parsed; fromModel = true; }
    else return h('div.card', h('span.eyebrow', 'Flow'), flowchart(per.flowchart));
  }
  if (!f) { f = Coach.flow(c); if (f.edges.length < 2) return null; }
  return h('div.card', { id: 'flow' }, h('div.card-head', h('span.eyebrow', 'Flow'),
      h('span.muted', fromModel ? 'drawn by Claude from this section' : 'from this section’s cause-and-effect sentences')),
    drawFlow(f));
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
  }));
}

/* Figures and pages are drawn from the PDF kept on this device. */
function withBytes() {
  if (ui.bytesFor === ui.docId) return Promise.resolve(ui.bytes);
  return Store.get('files', ui.docId).then(function (f) { ui.bytesFor = ui.docId; ui.bytes = f && f.bytes; return ui.bytes; });
}
function lazyImage(alt, pageNo, box, scale) {
  var img = h('img', { alt: alt });
  withBytes().then(function (bytes) {
    if (!bytes) throw new Error('no file');
    return Pdf.renderBox(ui.docId, bytes, pageNo, box, scale);
  }).then(function (url) { img.src = url; }, function () { img.alt = alt + ' (could not be drawn)'; });
  return img;
}
function lightbox(pageNo, box, name) {
  var close = function () { if (el.parentNode) el.parentNode.removeChild(el); doc.removeEventListener('keydown', esc); };
  var esc = function (e) { if (e.key === 'Escape') close(); };
  var el = h('div.lightbox', { role: 'dialog', 'aria-modal': 'true', 'aria-label': name || 'Page ' + pageNo, onclick: function (e) { if (e.target === el) close(); } },
    lazyImage('Page ' + pageNo + (box ? ' figure' : ''), pageNo, box, 2.5), button('Close', close, 'primary'));
  doc.addEventListener('keydown', esc);
  doc.body.appendChild(el);
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
    return h('div.card', h('span.eyebrow', 'Figures and pages'),
      h('p.muted', 'This PDF was added before figures and pages could be shown. Delete it and add it again to see them here.'));
  }
  var figs = figuresOf(c);
  var pages = [];
  for (var pn = c.pageStart; pn <= c.pageEnd && pages.length < 6; pn++) pages.push(pn);
  return h('div.card', { id: 'visuals' },
    figs.length ? [h('span.eyebrow', 'Figures'), h('div.figs', figs.map(function (f, i) {
      var name = f.label || 'Figure ' + (i + 1);
      return h('figure.fig', h('button', { type: 'button', 'aria-label': 'Enlarge ' + name, onclick: function () { lightbox(f.page, f.box, name); } },
        lazyImage(f.caption || name + ', page ' + f.page, f.page, f.box, 2)),
        h('figcaption', f.caption ? h('span.fig-cap', f.caption) : name, ' ', page(f.page)));
    }))] : null,
    h('span.eyebrow', 'The pages'),
    h('p.muted', 'Everything as printed — tables, charts and diagrams included. Tap to enlarge.'),
    h('div.pages', pages.map(function (pn) {
      return h('figure.fig', h('button', { type: 'button', 'aria-label': 'Open page ' + pn, onclick: function () { lightbox(pn, null); } },
        lazyImage('Page ' + pn, pn, null, 0.5)), h('figcaption', 'Page ' + pn));
    })));
}

function glanceCard(c, per) {
  var figs = figuresOf(c).length;
  var tables = c.segments.filter(function (g) { return g.table; }).length;
  return h('div.card.glance', h('span.eyebrow', 'At a glance'), h('dl',
    h('dt', 'Pages'), h('dd', c.pageStart + (c.pageEnd !== c.pageStart ? '–' + c.pageEnd : '')),
    h('dt', 'Key points'), h('dd', String(per.points.length)),
    h('dt', 'Words'), h('dd', String(c.words)),
    tables ? [h('dt', 'Tables'), h('dd', String(tables))] : null,
    figs ? [h('dt', 'Figures'), h('dd', String(figs))] : null));
}

var wide = root.matchMedia ? root.matchMedia('(min-width: 62rem)') : null;
if (wide && wide.addEventListener) wide.addEventListener('change', function () { if (ui.view === 'session') render(); });
function hookBeside() { return Look.load().hook === 'side' && !!(wide && wide.matches); }

function viewEncode(c, per) {
  var src = h('details.source', h('summary', 'Show the PDF text for this section'),
    c.segments.map(function (seg) { return seg.table ? null : h(seg.heading ? 'h3' : 'p', page(seg.page), ' ', seg.text); }));
  var points = h('div.card', { id: 'points' },
    h('div.card-head', h('h2', 'Key points'), button('🔊 Listen', function () { speak(per.points.map(function (p) { return p.text; }).join('. ')); }, 'quiet')),
    h('ul.bullets', per.points.map(bulletItem)));
  var hook = hookCard(per);
  var side = hookBeside();
  var main = h('div.study-main', points, side ? null : hook, flowCard(c, per), tablesCard(c), visualsCard(c), src);
  var aside = side ? h('aside.study-aside', { 'aria-label': 'Memory hook and summary' }, hook, glanceCard(c, per)) : null;
  return [
    h('div.study-grid', main, aside),
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
  /* The section is named only once the question is answered: "Which term
     is defined as …" under a header reading "· Afterload" asks nothing. */
  var from = (ui.docRec.clusters[ci] || {}).title;
  return [
    h('div.card.gauntlet',
      h('span.count', 'Gauntlet ' + (g.idx + 1) + ' of ' + g.questions.length),
      h('h2.q', q.question),
      answerBox('Defend your answer…', function (a) {
        ask('The examiner is reading your answer…', 'gradeRecall', [ui.docRec.clusters[ci], q, a]).then(function (v) {
          ui.feedback = { kind: 'gauntlet', grade: v, q: q, answer: a, from: from, event: { type: 'gauntletGraded', value: v, answer: a } };
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
  ui.drill = null;
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
    f.from ? h('p.muted', { id: 'from' }, 'From \u201C' + f.from + '\u201D') : null,
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
  return h('main.wrap.study', sessionHeader(), h('div.phase', { 'data-phase': s.phase }, body));
}

/* ── REVIEW ──────────────────────────────────────────────────────────────── */
function startReview() {
  ui.view = 'review'; ui.reviewIdx = 0; ui.reviewShown = false; ui.reviewDone = 0; ui.drill = null;
  refresh().then(render);
}
/* A drill: every card from one weak section, due or not, each once. Rating
   one early is still a review — FSRS reads how long it has been. */
function startDrill(w) {
  ui.view = 'review'; ui.reviewIdx = 0; ui.reviewShown = false; ui.reviewDone = 0;
  ui.drill = { docId: w.docId, cluster: w.cluster, title: w.title, done: {} };
  refresh().then(render);
}
function viewReview() {
  var dr = ui.drill;
  var due = dr ? ui.cards.filter(function (c) { return c.docId === dr.docId && c.cluster === dr.cluster && !dr.done[c.id]; })
    : Session.dueCards(ui.cards, today());
  var names = {};
  ui.docs.forEach(function (d) { names[d.id] = d.name; });
  if (!due.length) {
    if (dr) {
      return h('main.wrap', h('div.card', h('h1', 'Drill done.'),
        h('p', ui.reviewDone + ' card' + (ui.reviewDone === 1 ? '' : 's') + ' from \u201C' + dr.title + '\u201D, each rated once.'),
        button('Back to library', function () { ui.drill = null; ui.view = 'library'; render(); }, 'primary')));
    }
    return h('main.wrap', h('div.card', h('h1', ui.reviewDone ? 'Done for today.' : 'Nothing due.'),
      h('p', ui.reviewDone ? ui.reviewDone + ' card' + (ui.reviewDone === 1 ? '' : 's') + ' reviewed. Come back tomorrow.' : 'Cards appear here when you miss something in a session, and again when they are due.'),
      button('Back to library', function () { ui.view = 'library'; render(); }, 'primary')));
  }
  var card = due[0];
  var rate = function (r) {
    var upd = Session.review(card, r, today(), FSRS);
    if (dr) dr.done[card.id] = true;
    Store.put('cards', upd).then(refresh).then(function () { ui.reviewShown = false; ui.reviewDone++; render(); });
  };
  return h('main.wrap',
    h('div.review-head', h('span.count', dr ? 'Drill · ' + due.length + ' left' : due.length + ' due'), h('span.muted', (names[card.docId] || '') + ' · ' + card.title)),
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
/* Appearance: Systole's themes, text size and layout. Every choice applies at
   once and is saved at once — there is nothing to confirm. */
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
  function swatch(id, name, sw) {
    return h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(look.theme === id), 'data-theme-id': id,
        onclick: function () { set('theme', id); } },
      h('i', { style: 'background:linear-gradient(135deg,' + sw[0] + ' 0 55%,' + sw[1] + ' 55% 100%)', 'aria-hidden': 'true' }), name);
  }
  var themes = function (mode) {
    return Look.THEMES.filter(function (t) { return t.mode === mode; }).map(function (t) { return swatch(t.id, t.name, t.swatch); });
  };
  return h('div.card.settings', { id: 'appearance' }, h('h2', 'Appearance'),
    h('p.muted', 'Systole’s themes and type scale. Contrast and brightness adjust whichever theme you pick, and every setting keeps text at WCAG AA or better.'),
    h('div.group-label', { id: 'lbl-theme' }, 'Theme'),
    h('div.swatches', { role: 'radiogroup', 'aria-labelledby': 'lbl-theme' },
      swatch('auto', 'Auto', ['#EFF3F8', '#0A1628']), themes('light')),
    h('div.swatches', { role: 'radiogroup', 'aria-labelledby': 'lbl-theme' }, themes('dark')),
    seg('size', 'Text size'), seg('width', 'Reading width'), seg('spacing', 'Line spacing'),
    seg('contrast', 'Contrast'), seg('bright', 'Brightness'),
    seg('font', 'Font'), seg('hook', 'Memory hook'),
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
    h('h1', { style: 'margin-top:1rem' }, 'Settings'),
    appearanceCard(),
    h('div.card.settings', h('h2', 'Coach'),
      h('label', 'Coach', prov), about, keyed,
      h('div.row', button('Save', function () {
        var P = Provider.PROVIDERS[prov.value];
        var ok = Provider.saveConfig({ provider: prov.value, model: model.value, key: P.noKey ? '' : key.value.trim() });
        saved.textContent = ok ? 'Saved on this device.' : 'This browser refused to save it (private mode?).';
      }, 'primary', { id: 'save-settings' }), saved)),
    h('div.card', h('h2', 'What leaves this device'),
      h('p', 'Your PDF is read here, in the browser, and is never uploaded. The PDF reader itself is downloaded once from jsDelivr, and so is the text reader for scanned pages, the first time a PDF has one; scanned pages are read on this device too.'),
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
