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
var Format = root.MemFormat, Look = root.MemLook, Home = root.MemHome, Pearl = root.Pearl;

var MERMAID = { url: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js',
                sri: 'sha384-WmdflGW9aGfoBdHc4rRyWzYuAjEmDwMdGdiPNacbwfGKxBW/SO6guzuQ76qjnSlr' };

var ui = {
  view: 'library',      /* library | session | review | settings */
  docs: [], cards: [], sessions: {}, at: {}, pearlSkip: 0,
  docId: null, docRec: null, state: null,
  busy: '', error: '', choice: null, pasting: false,
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
function refresh() {
  return Promise.all([Store.all('docs'), Store.all('cards'), Store.all('sessions')]).then(function (r) {
    ui.docs = r[0].sort(function (a, b) { return b.addedAt - a.addedAt; });
    ui.cards = r[1];
    ui.sessions = {}; ui.at = {};
    r[2].forEach(function (x) { ui.sessions[x.id] = x.state; ui.at[x.id] = x.at || 0; });
  });
}
function save() {
  if (!ui.state) return Promise.resolve();
  var at = Date.now();
  ui.sessions[ui.docId] = ui.state; ui.at[ui.docId] = at;
  return Store.put('sessions', { id: ui.docId, state: ui.state, at: at })
    .then(function () { return Store.mergeCards(ui.state.cards); })
    .then(function () { return Store.all('cards'); })
    .then(function (c) { ui.cards = c; });
}

/* Days studied, for the streak: this device's own record, kept in local
   storage because it is a convenience — losing it loses a number, not work. */
var DAYS_KEY = 'memorizer.days.v1';
function studyDays() { try { return JSON.parse(root.localStorage.getItem(DAYS_KEY) || '[]'); } catch (_) { return []; } }
function markStudied() {
  try {
    var d = studyDays(), t = today();
    if (d.indexOf(t) === -1) { d.push(t); root.localStorage.setItem(DAYS_KEY, JSON.stringify(d.slice(-400))); }
  } catch (_) { /* private mode: no streak, nothing else lost */ }
}

function dispatch(event) {
  ui.state = Session.next(ui.state, event);
  if (event.type === 'answered' || event.type === 'examAnswered') markStudied();
  return save();
}

/* ── the step runner: one place that shows busy, error and retry ────────── */
/* kind is lesson | quiz | exam. The built-in coach answers from `local`
   arguments, Claude from `remote` ones (prompts.js); either answer is held to
   the same schema and rules (Prompts.validate), so a bug in the built-in
   coach is an error on screen, never a bad drill. */
function ask(label, kind, local, remote) {
  ui.busy = label; ui.error = ''; render();
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
    ui.busy = ''; return v;
  }, function (e) {
    ui.busy = ''; ui.error = (e && e.message) || String(e); render();
    throw e;
  });
}

function cluster(i) { return ui.docRec.clusters[i == null ? ui.state.section : i]; }

/* Advance whatever the current phase needs from a coach, if anything. */
function pump() {
  var s = ui.state;
  if (!s || ui.busy || ui.error) return;
  var c = s.per[s.section];
  if (s.phase === 'teach' && !c.lesson) {
    ask('Preparing the lesson…', 'lesson', [cluster()], [cluster()])
      .then(function (v) { return dispatch({ type: 'taught', value: v }); })
      .then(render, function () {});
  } else if (s.phase === 'drill' && !c.quiz) {
    ask('Writing your questions…', 'quiz', [cluster(), c.lesson, ui.docRec.clusters], [cluster(), c.lesson])
      .then(function (v) { return dispatch({ type: 'quizReady', value: v }); })
      .then(render, function () {});
  } else if (s.phase === 'exam' && !s.exam.questions) {
    var weak = Session.weakest(s, 2), n = Session.examSize(s), lessons = {};
    ui.docRec.clusters.forEach(function (_, i) { lessons[i] = s.per[i].lesson; });
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
              scanned: (extra && extra.scanned) || [], figures: (extra && extra.figures) || [], hasFile: !!(extra && extra.bytes),
              ocr: (extra && extra.ocr) || [], ocrError: (extra && extra.ocrError) || '' };
  var first = extra && extra.bytes ? Store.put('files', { id: rec.id, bytes: extra.bytes }) : Promise.resolve();
  return first.then(function () { return Store.put('docs', rec); }).then(function () { return rec; });
}
function finishImport(p) {
  return p.then(function (rec) {
    ui.importing = ''; return refresh().then(function () { return openDoc(rec.id); });
  }, function (e) {
    ui.importing = ''; ui.error = (e && e.message) || String(e); render();
  });
}
function importFile(file) {
  if (!file) return;
  ui.importing = 'Opening ' + file.name + '…'; ui.error = ''; render();
  var bytes = null;
  finishImport(readBuffer(file).then(function (buf) {
    bytes = buf;
    return Pdf.read(buf, function (n, total, pass) {
      ui.importing = pass === 'ocr' ? 'Reading scanned page ' + n + ' of ' + total + ' with text recognition…' : 'Reading page ' + n + ' of ' + total + '…';
      render();
    }, function (msg) { ui.importing = msg; render(); });
  }).then(function (r) {
    ui.importing = 'Splitting into sections…'; render();
    return saveUnit(file.name.replace(/\.pdf$/i, ''), 'pdf', r.pages, {
      bytes: bytes, figures: r.figures || [], scanned: Chunk.scannedPages(r.wordCounts), ocr: r.ocr, ocrError: r.ocrError,
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
  var pages = [], chain = Promise.resolve();
  list.forEach(function (f, i) {
    chain = chain.then(function () { ui.importing = 'Reading photo ' + (i + 1) + ' of ' + list.length + '…'; render(); return Ocr.readImage(f, function (m) { ui.importing = m; render(); }); })
      .then(function (r) { pages.push({ page: i + 1, lines: Pdf.linesOf(r.items, r.height) }); });
  });
  finishImport(chain.then(function () {
    return saveUnit('Photos ' + new Date().toLocaleDateString(), 'photo', pages,
      { ocr: pages.map(function (p) { return p.page; }), emptyMessage: 'No text could be read from those photos. Try a sharper, well-lit photo of the page.' });
  }));
}
function importText(name, text) {
  ui.importing = 'Splitting into sections…'; ui.error = ''; render();
  finishImport(new Promise(function (resolve) { resolve(saveUnit(name || 'Pasted notes', 'text', Chunk.pagesFromText(text), { emptyMessage: 'There was no text to learn from.' })); }));
}

function openDoc(id, section) {
  return Promise.all([Store.get('docs', id), Store.get('sessions', id)]).then(function (r) {
    ui.docRec = r[0];
    ui.docId = id;
    var st = r[1] && r[1].state;
    ui.state = st && st.v === Session.VERSION ? st : Session.init(id, ui.docRec.clusters.map(function (c) { return c.title; }));
    ui.state = Session.next(ui.state, { type: 'toUnit' });
    if (typeof section === 'number') ui.state = Session.next(ui.state, { type: 'open', section: section });
    ui.view = 'session'; ui.error = ''; ui.choice = null;
    return save();
  }).then(function () { render(); root.scrollTo(0, 0); });
}
function go(event) {
  ui.choice = null; ui.error = '';
  return dispatch(event).then(function () { render(); root.scrollTo(0, 0); });
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
    /* photos and pasted text have no PDF pages to show */
    if (d.source && d.source !== 'pdf') return null;
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

/* ── HOME ────────────────────────────────────────────────────────────────── */
function viewHome() {
  var sessions = ui.sessions || {};
  var day = today();
  var due = Session.dueCards(ui.cards, day).length;
  var streak = Home.streak(studyDays(), day, FSRS);

  var pdfIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', id: 'pdf-input', class: 'visually-hidden',
    onchange: function (e) { importFile(e.target.files[0]); e.target.value = ''; } });
  var photoIn = h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'photo-input', class: 'visually-hidden',
    onchange: function (e) { importPhotos(e.target.files); e.target.value = ''; } });

  var top = h('header.home-top',
    h('div.home-brand', mascot(), h('div', h('span.hello', Home.greeting(new Date().getHours()) + ' · what shall we'), h('h1.learn', 'Learn?'))),
    h('div.pills',
      h('span.pill', { id: 'streak', title: 'Days in a row' }, h('span', { 'aria-hidden': 'true' }, '🔥'), ' ' + streak),
      h('button.pill', { type: 'button', id: 'pill-due', onclick: function () { startReview(); } }, h('span', { 'aria-hidden': 'true' }, '↻'), ' ' + due + ' due')));

  var drop = h('label.learn-box', { for: 'pdf-input', id: 'door-add',
      ondragover: function (e) { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: function () { drop.classList.remove('over'); },
      ondrop: function (e) { e.preventDefault(); drop.classList.remove('over'); importFile(e.dataTransfer.files[0]); } },
    h('span.learn-prompt', ui.importing || 'I want to learn… add a chapter of your book'),
    h('span.learn-plus', { 'aria-hidden': 'true' }, ui.importing ? '…' : '+'));
  var chips = h('div.chips',
    h('label.chip', { for: 'pdf-input' }, h('span', { 'aria-hidden': 'true' }, '⬆'), ' Upload PDF'),
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

  var recent = Home.recent(ui.docs, sessions, ui.at, 6);
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

  var pk = ui.docs.length ? Home.pearlOf(ui.docs, Pearl, day, ui.pearlSkip || 0) : null;
  var pearl = pk ? h('aside.pearl.card', { id: 'pearl', 'aria-labelledby': 'pearl-label' },
    h('span.eyebrow', { id: 'pearl-label' }, 'Pearl of the day'),
    h('ol.pearl-steps', pk.steps.map(function (st) {
      return h('li', st.lead ? h('span.pearl-lead', st.lead) : null, marked(st.text));
    })),
    h('p.pearl-src', pk.pearl.heading, pk.pearl.page ? page(pk.pearl.page) : null, ui.docs.length > 1 ? ' · ' + pk.pearl.docName : ''),
    pk.of > 1 ? h('div.row', button('Another', function () { ui.pearlSkip = (ui.pearlSkip || 0) + 1; render(); }, 'quiet', { id: 'pearl-next' })) : null) : null;

  var units = ui.docs.map(function (d, i) {
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
            Store.deleteDoc(d.id).then(refresh).then(render);
          }, 'quiet danger'))),
      d.ocr && d.ocr.length ? h('p.muted.ocr-note', 'Read by text recognition: ' + (d.source === 'photo' ? 'every photo' : 'pages ' + d.ocr.slice(0, 12).join(', ') + (d.ocr.length > 12 ? '…' : '')) + '. Check anything surprising against the page.') : null,
      d.scanned && d.scanned.length ? h('p.warn', 'Pages with no readable text: ' + d.scanned.slice(0, 12).join(', ') + (d.scanned.length > 12 ? '…' : '') + '. They are not in any section' +
        (d.ocrError ? ' — the text reader could not run (' + d.ocrError + ').' : '.')) : null);
  });

  return h('main.wrap.home',
    top, pdfIn, photoIn, drop, chips, paste,
    ui.error ? errorCard(null) : null,
    !hasKey() ? h('div.card.note', h('strong', 'Claude needs your API key. '), 'Add it in Settings, or switch back to the built-in coach, which needs none. ',
      button('Settings', function () { ui.view = 'settings'; render(); }, 'primary')) : null,
    jump, weak, pearl,
    ui.docs.length ? h('div.section-head', h('h2', 'My units'), h('label.plus', { for: 'pdf-input', 'aria-label': 'Add a PDF' }, '+')) : null,
    ui.docs.length ? h('ul.units', { id: 'units' }, units) : h('div.card.empty', h('h2', 'Start with a chapter'),
      h('p', 'Upload a chapter of your book as a PDF, take photos of its pages, or paste your notes. Memorizer splits it into sections, teaches each one — key points, numbers to know, mnemonics and analogies — then drills you with multiple-choice questions. Everything you miss comes back as a review card until it sticks.')),
    !Store.persistent ? h('p.warn', 'This browser would not open local storage (private mode?). Your work will not survive a reload.') : null);
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
    allDone ? button(s.exam.score != null ? 'Retake' : 'Start', function () { go({ type: 'toExam' }); }, 'primary', { id: 'to-exam' }) : h('span.lock', { 'aria-hidden': 'true' }, '🔒'));
  return h('main.wrap.unit',
    backBar(d.name, function () { leave('library'); }),
    h('p.muted.unit-meta', Home.count(n, 'section') + ' · ' + Home.count(d.pages, 'page') + ' · ' + doneN + ' drilled'),
    h('div.bar', h('i', { style: 'width:' + Math.round(100 * doneN / Math.max(1, n)) + '%' })),
    h('h2.grid-title', 'Sections (' + n + ')'),
    h('div.sections', { id: 'sections' }, cards),
    examCard,
    h('div.sticky-cta', allDone
      ? button('Take the final exam', function () { go({ type: 'toExam' }); }, 'primary big', { id: 'learn-unit' })
      : button(doneN ? 'Continue: ' + d.clusters[nxt].title : 'Learn unit', function () { go({ type: 'open', section: nxt }); }, 'primary big', { id: 'learn-unit' })));
}

/* ── LESSON ──────────────────────────────────────────────────────────────── */
function steps(which) {
  return h('ol.stepper', { 'aria-label': 'Step' }, [['teach', 'Learn'], ['drill', 'Drill']].map(function (p) {
    var now = p[0] === which, done = which === 'drill' && p[0] === 'teach';
    return h('li' + (now ? '.now' : done ? '.done' : ''), { 'aria-current': now ? 'step' : null }, p[1]);
  }));
}
function sectionBar(which) {
  var s = ui.state, c = cluster(), n = ui.docRec.clusters.length;
  return [backBar(c.title, function () { go({ type: 'toUnit' }); }),
    h('p.muted.unit-meta', 'Section ' + (s.section + 1) + ' of ' + n + ' · ' + (c.pageEnd !== c.pageStart ? 'pp. ' + c.pageStart + '–' + c.pageEnd : 'p. ' + c.pageStart) +
      ' · about ' + Math.max(1, Math.round(c.words / 200)) + ' min read'),
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
  return h('li.point',
    h('span.point-n', String(i + 1)),
    h('div.point-body',
      h('p.point-text', b.lead ? h('strong.lead', b.lead) : null, marked(b.body), ' ', page(p.page)),
      b.subs.length ? h('ul.subs', b.subs.map(function (x) { return h('li', marked(x)); })) : null,
      para && para.text.length > p.text.length + 20 ? h('details.context', h('summary', 'In the book'),
        h('p', marked(para.text))) : null));
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
function viewLesson() {
  var s = ui.state, c = cluster(), L = s.per[s.section].lesson;
  if (!L) return [sectionBar('teach'), ui.error ? errorCard(pump) : busyCard()];
  var analogies = (L.analogies || []).map(function (a) {
    return h('div.card.analogy', h('span.eyebrow', 'Think of it like…'), h('h3', a.title), h('p.analogy-text', a.text),
      h('p.muted.label', a.source === 'Claude' ? 'Analogy written by Claude — not from your book.' : 'Analogy — Memorizer’s, not your book’s. Your book is the authority.'));
  });
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
  return [
    sectionBar('teach'),
    h('div.card.big-idea', { id: 'big-idea' }, h('span.eyebrow', 'The big idea'), h('p.big', marked(L.overview || (L.points[0] && L.points[0].text) || ''))),
    analogies,
    h('div.card', { id: 'points' },
      h('div.card-head', h('h2', 'Key points'), button('🔊 Listen', function () { speak([L.overview].concat(L.points.map(function (p) { return p.text; })).join('. ')); }, 'quiet')),
      h('ol.points', L.points.map(function (p, i) { return pointCard(c, p, i); }))),
    L.numbers && L.numbers.length ? h('div.card', { id: 'numbers' }, h('span.eyebrow', 'Numbers to know'),
      h('ul.numbers', L.numbers.map(function (n) { return h('li', marked(n.text), ' ', page(n.page)); }))) : null,
    mnemonics,
    drawFlowCard(c, L),
    tablesCard(c),
    visualsCard(c),
    full,
    h('div.sticky-cta', button('I’ve got it — start the drill', function () { go({ type: 'toDrill' }); }, 'primary big', { id: 'to-drill' })),
  ];
}

/* ── DRILL and EXAM: multiple choice ─────────────────────────────────────── */
var LETTERS = 'ABCDEFGH';
/* One question: options as big buttons; once one is chosen, the right one
   turns green, a wrong choice red, and the book's reason is shown. The
   answer is recorded on Next, not on the tap. */
function mcqCard(q, meta, onNext, reveal) {
  var chosen = ui.choice;
  var answered = chosen != null;
  var quote = q.quote ? h('blockquote.quote', q.quote.split('_____').map(function (part, i, all) {
    return [part, i < all.length - 1 ? h('span.gap', answered ? q.options[q.answer] : '_____') : null];
  })) : null;
  var opts = h('div.options', { role: 'group', 'aria-label': 'Options' }, q.options.map(function (o, i) {
    var cls = '';
    if (answered) cls = i === q.answer ? '.right' : i === chosen ? '.wrong' : '.dim';
    return h('button.option' + cls, { type: 'button', disabled: answered ? true : null, 'data-i': String(i),
        onclick: function () { ui.choice = i; render(); } },
      h('span.opt-letter', LETTERS[i]), h('span.opt-text', o));
  }));
  var right = answered && chosen === q.answer;
  return h('div.card.mcq', { id: 'mcq' },
    h('div.mcq-meta', meta),
    quote,
    h('h2.q', q.question),
    opts,
    answered ? h('div.why' + (right ? '.good' : '.bad'), { role: 'status' },
      h('strong', right ? '✓ Correct' : '✗ The answer is ' + LETTERS[q.answer] + ': ' + q.options[q.answer]),
      reveal ? h('p.muted', reveal) : null,
      h('p', h('span.why-label', 'Why: '), marked(q.explain), q.page ? [' ', page(q.page)] : null),
      right ? null : h('p.muted', 'This one is now a review card, and it comes back at the end of this drill.'),
      h('div.row', button('Next →', onNext, 'primary big', { id: 'next' }))) : null);
}
function viewDrill() {
  var s = ui.state, c = s.per[s.section];
  if (!c.quiz) return [sectionBar('drill'), ui.error ? errorCard(pump) : busyCard()];
  var qi = c.order[c.pos], q = c.quiz.questions[qi];
  var retry = c.order.indexOf(qi) !== c.pos;
  var firsts = c.quiz.questions.length;
  var meta = [h('span', retry ? 'Again — you missed this one' : 'Question ' + (Math.min(c.pos, firsts - 1) + 1) + ' of ' + firsts),
    h('div.bar', h('i', { style: 'width:' + Math.round(100 * c.pos / c.order.length) + '%' }))];
  return [sectionBar('drill'), mcqCard(q, meta, function () { go({ type: 'answered', choice: ui.choice }); })];
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
      h('p', pct >= 90 ? 'Excellent — this section is yours. Review cards will keep it that way.'
        : pct >= 70 ? 'Good. Look over the ones you missed, then move on; they come back as review cards.'
        : 'Worth another pass: re-read the key points, then drill again before moving on.')),
    missed.length ? h('div.card', h('h2', 'What you missed'), h('ul.missed', missed.map(function (q) {
      return h('li', h('strong', q.question), h('p', '→ ', q.options[q.answer], ' ', q.page ? page(q.page) : null));
    }))) : null,
    h('div.row.result-actions',
      nxt != null ? button('Next section: ' + d.clusters[nxt].title, function () { go({ type: 'open', section: nxt }); }, 'primary big', { id: 'next-section' })
        : button('Take the final exam', function () { go({ type: 'toExam' }); }, 'primary big', { id: 'to-exam' }),
      button('Drill again', function () { go({ type: 'redrill' }); }, '', { id: 'redrill' }),
      button('Back to the lesson', function () { go({ type: 'open', section: s.section }); }, 'quiet')),
  ];
}
function viewExam() {
  var s = ui.state, g = s.exam;
  var bar = backBar('Final exam', function () { go({ type: 'toUnit' }); });
  if (!g.questions) return [bar, ui.error ? errorCard(pump) : busyCard()];
  var qi = g.order[g.pos], q = g.questions[qi];
  /* The section is named only once answered: its title is often the answer. */
  var from = q.cluster != null && ui.docRec.clusters[q.cluster] ? ui.docRec.clusters[q.cluster].title : '';
  var meta = [h('span', 'Question ' + (g.pos + 1) + ' of ' + g.order.length), h('div.bar', h('i', { style: 'width:' + Math.round(100 * g.pos / g.order.length) + '%' }))];
  return [bar, mcqCard(q, meta, function () { go({ type: 'examAnswered', choice: ui.choice }); }, from ? 'From “' + from + '”' : '')];
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
      h('p', pct >= 85 ? 'Unit mastered. Keep up the review cards and it stays mastered.' : 'Review the sections below the line, then retake the exam.')),
    h('div.card', h('h2', 'By section'), h('ul.by-section', Object.keys(by).map(function (k) {
      var t = +k >= 0 ? d.clusters[+k].title : 'Across the unit', b = by[k];
      return h('li', h('span', t), h('span.badge', b.right + '/' + b.n));
    }))),
    h('div.row', button('Retake the exam', function () { go({ type: 'toExam' }); }, 'primary', { id: 'retake' }),
      button('Back to sections', function () { go({ type: 'toUnit' }); })),
  ];
}
function viewSession() {
  var s = ui.state, body;
  if (s.phase === 'teach') body = viewLesson();
  else if (s.phase === 'drill') body = viewDrill();
  else if (s.phase === 'result') body = viewResult();
  else if (s.phase === 'exam') body = viewExam();
  else if (s.phase === 'done') body = viewDone();
  else return viewUnit();
  return h('main.wrap.study', body);
}

function leave(view) {
  ui.drill = null; ui.choice = null;
  ui.view = view; ui.error = '';
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
  var due = dr ? ui.cards.filter(function (c) { return c.docId === dr.docId && c.cluster === dr.cluster && !dr.done[c.id]; })
    : Session.dueCards(ui.cards, today());
  var names = {};
  ui.docs.forEach(function (d) { names[d.id] = d.name; });
  var back = backBar(dr ? 'Drill · ' + dr.title : 'Review', function () { leave('library'); });
  if (!due.length) {
    if (dr) {
      return h('main.wrap', back, h('div.card', h('h1', 'Drill done.'),
        h('p', ui.reviewDone + ' card' + (ui.reviewDone === 1 ? '' : 's') + ' from “' + dr.title + '”, each rated once.'),
        button('Back home', function () { leave('library'); }, 'primary')));
    }
    return h('main.wrap', back, h('div.card', h('h1', ui.reviewDone ? 'Done for today.' : 'Nothing due.'),
      h('p', ui.reviewDone ? ui.reviewDone + ' card' + (ui.reviewDone === 1 ? '' : 's') + ' reviewed. Come back tomorrow.' : 'Cards appear here when you miss something in a drill, and again when they are due.'),
      button('Back home', function () { leave('library'); }, 'primary')));
  }
  var card = due[0];
  var rate = function (r) {
    var upd = Session.review(card, r, today(), FSRS);
    if (dr) dr.done[card.id] = true;
    markStudied();
    Store.put('cards', upd).then(refresh).then(function () { ui.reviewShown = false; ui.choice = null; ui.reviewDone++; render(); });
  };
  var head = h('div.review-head', h('span.count', dr ? 'Drill · ' + due.length + ' left' : due.length + ' due'), h('span.muted', (names[card.docId] || '') + ' · ' + card.title));
  if (card.options && card.options.length) {
    /* A multiple-choice card grades itself: right is Good, wrong is Again. */
    var q = { question: card.front, quote: card.quote || '', options: card.options, answer: card.answer, explain: card.explain || card.back, page: card.page };
    return h('main.wrap', back, head, mcqCard(q, [h('span.tag', card.source === 'exam' ? 'from the exam' : 'from a drill')], function () {
      rate(ui.choice === card.answer ? 3 : 1);
    }));
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
  var saved = h('span.muted', { role: 'status' });
  return h('main.wrap',
    backBar('Settings', function () { leave('library'); }),
    appearanceCard(),
    h('div.card.settings', h('h2', 'Coach'),
      h('label', 'Coach', prov), about, keyed,
      h('div.row', button('Save', function () {
        var P = Provider.PROVIDERS[prov.value];
        var ok = Provider.saveConfig({ provider: prov.value, model: model.value, key: P.noKey ? '' : key.value.trim() });
        saved.textContent = ok ? 'Saved on this device.' : 'This browser refused to save it (private mode?).';
      }, 'primary', { id: 'save-settings' }), saved)),
    h('div.card', h('h2', 'What leaves this device'),
      h('p', 'Your PDF, photos and notes are read here, in the browser, and never uploaded. The PDF reader itself is downloaded once from jsDelivr, and so is the text reader for scanned pages and photos, the first time it is needed; they are read on this device too.'),
      h('p', 'With the built-in coach, nothing else leaves the device. With Claude, each lesson and drill sends only the text of the section you are studying to Anthropic, with your key; the final exam sends the key points of every section and the full text of your two weakest. Your key is kept in this browser’s storage and sent only to Anthropic.')));
}

/* ── frame: a floating bar at the foot of the screen ─────────────────────── */
function nav() {
  var due = Session.dueCards(ui.cards, today()).length;
  var here = ui.view === 'session' ? 'library' : ui.view;
  function tab(v, icon, label, go2, badge) {
    return h('button.nav-btn', { type: 'button', 'aria-current': here === v ? 'page' : null, onclick: go2, 'aria-label': label + (badge ? ', ' + badge + ' due' : '') },
      h('span.nav-icon', { 'aria-hidden': 'true' }, icon), h('span.nav-label', label), badge ? h('span.nav-badge', String(badge)) : null);
  }
  return h('nav.dock', { 'aria-label': 'Main' },
    tab('library', '⌂', 'Home', function () { leave('library'); }),
    tab('review', '↻', 'Review', function () { startReview(); }, due),
    tab('settings', '⚙', 'Settings', function () { leave('settings'); }));
}

function render() {
  var app = doc.getElementById('app');
  var view = ui.view === 'session' && ui.state ? viewSession()
    : ui.view === 'review' ? viewReview()
    : ui.view === 'settings' ? viewSettings() : viewHome();
  app.textContent = '';
  app.appendChild(view);
  app.appendChild(nav());
  if (ui.view === 'session') pump();
}

function start() {
  Store.open().then(refresh).then(render, function (e) {
    ui.error = 'Could not open storage: ' + (e && e.message); render();
  });
}

root.Memorizer = { ui: ui, render: render, start: start, importFile: importFile, importText: importText, importPhotos: importPhotos, openDoc: openDoc };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
