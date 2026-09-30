/* ═══════════════════════════════════════════════════════════════════════════
   importUI.js — the Import Study dialog: choose or drop a study file, see
   what was found in it, then import.

   Opened through dialog.js like every other modal here, so it is a real one:
   the app behind it is inert, focus starts inside and stays there, Escape
   and the backdrop close it, and focus goes back to the button that opened
   it. The whole drop area is a <label> for the file input, so a tap on it
   opens the Files picker on an iPad; dropping a file works where dragging
   does. Built with DOM calls and textContent only — nothing from a file is
   ever written as markup.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var doc = root.document;

function el(tag, attrs, kids) {
  var e = doc.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'className') e.className = attrs[k];
    else e.setAttribute(k, attrs[k]);
  });
  (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
  return e;
}
function plural(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }

/* What was found, and what of it will be left out, before anything is
   stored. Pack.check can still flag or drop items; the note on the unit
   page after import counts what it did. */
function previewLines(s) {
  var out = [
    ['Words of study text', String(s.words)],
    ['Teaching points', String(s.teaching_points)],
    ['Tables', String(s.tables)],
    ['Flowcharts', String(s.flowcharts)],
    ['Diagrams', String(s.diagrams)],
    ['Questions', s.questions ? s.answered - s.malformed + ' of ' + s.questions + ' usable' : '0'],
  ];
  if (s.unanswered) out.push(['Left out', plural(s.unanswered, 'question') + ' with no marked answer']);
  if (s.malformed) out.push(['Left out', plural(s.malformed, 'question') + ' without exactly four options']);
  return out;
}

function show(onImport) {
  var SI = root.MemStudyImport, Dialog = root.MemDialog, study = null, closeFn = null;
  var input = el('input', { type: 'file', id: 'import-file', accept: SI.ACCEPT, className: 'sr-only' });
  var drop = el('label', { 'for': 'import-file', id: 'import-drop', className: 'import-drop' }, [
    el('span', { className: 'import-drop-main', text: 'Tap to choose a file, or drop it here' }),
    el('span', { className: 'muted import-drop-hint', text: 'Markdown (.md, .markdown, .txt) or a saved web page (.html, .htm), up to ' + (SI.MAX_BYTES / 1048576) + ' MB' }),
  ]);
  var status = el('p', { id: 'import-status', role: 'status', 'aria-live': 'polite', className: 'import-status' });
  var summary = el('dl', { id: 'import-summary', className: 'import-summary' });
  var strict = el('input', { type: 'checkbox', id: 'import-strict' });
  var strictRow = el('label', { 'for': 'import-strict', className: 'import-strict' }, [strict,
    el('span', { text: 'Strict consistency check: also hold the numbers and conditions in each question\u2019s scenario to this file\u2019s own text, and flag any it does not have. It checks the file against itself, not against your book or the medical facts.' })]);
  summary.hidden = true;
  var copyNote = el('span', { id: 'import-copy-status', role: 'status', className: 'muted' });
  var copy = el('button', { type: 'button', id: 'import-copy-prompt', className: 'btn tonal', text: '\u2726 Copy the prompt for Claude' });
  var promptRow = el('div', { className: 'row import-prompt' }, [copy, copyNote]);
  var go = el('button', { type: 'button', id: 'import-go', className: 'btn primary', text: 'Import' });
  go.disabled = true;
  var cancel = el('button', { type: 'button', id: 'import-cancel', className: 'btn', text: 'Cancel' });
  var x = el('button', { type: 'button', id: 'import-close', className: 'btn quiet', 'aria-label': 'Close', text: '×' });
  var box = el('div', { className: 'lightbox import-view', id: 'import-dialog', 'aria-labelledby': 'import-title' }, [
    el('div', { className: 'card import-card' }, [
      el('div', { className: 'import-head' }, [el('h2', { id: 'import-title', text: 'Import a study file' }), x]),
      promptRow, input, drop, status, summary, strictRow,
      el('div', { className: 'row import-foot' }, [cancel, go]),
    ]),
  ]);

  function say(text, kind) { status.textContent = text; status.className = 'import-status' + (kind ? ' ' + kind : ''); }
  function reset() { study = null; go.disabled = true; summary.hidden = true; summary.textContent = ''; }
  function take(file) {
    reset();
    if (!file) return;
    if (file.size > SI.MAX_BYTES) { say('“' + file.name + '” is too large to import at once (' + (file.size / 1048576).toFixed(1) + ' MB; the limit is ' + (SI.MAX_BYTES / 1048576) + ' MB). Split it into smaller study units.', 'bad'); return; }
    say('Reading “' + file.name + '”…');
    var r = new root.FileReader();
    r.onerror = function () { say('That file could not be read.', 'bad'); };
    r.onload = function () {
      /* a tick so "Reading…" is drawn before the parse holds the page */
      root.setTimeout(function () {
        var got = SI.parseStudyFile(String(r.result || ''), file.name);
        if (!got.success) { say('Not imported: ' + got.error + '.', 'bad'); return; }
        study = got.study; study.fileName = file.name;
        summary.textContent = '';
        summary.appendChild(el('dt', { text: 'Unit' })); summary.appendChild(el('dd', { text: got.summary.unit }));
        summary.appendChild(el('dt', { text: 'Read as' })); summary.appendChild(el('dd', { text: got.format === 'html' ? 'a web page (HTML)' : 'Markdown' }));
        previewLines(got.summary).forEach(function (l) { summary.appendChild(el('dt', { text: l[0] })); summary.appendChild(el('dd', { text: l[1] })); });
        summary.hidden = false;
        go.disabled = false;
        say('Ready to import. Flowcharts become the lesson\u2019s flowchart; diagrams are kept as pictures, cleaned first.', 'good');
      }, 0);
    };
    r.readAsText(file);
  }
  input.addEventListener('change', function () { take(input.files && input.files[0]); });
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); take(e.dataTransfer && e.dataTransfer.files[0]); });
  copy.addEventListener('click', function () {
    var text = SI.studyFilePrompt(), done = function () { copyNote.textContent = 'Copied. Paste it into Claude with your chapter, and save the reply as a .md file.'; };
    var fallback = function () {
      var ta = el('textarea', { className: 'sr-only', readonly: '' }); ta.value = text; box.appendChild(ta); ta.select();
      var ok = false; try { ok = doc.execCommand('copy'); } catch (_) {}
      ta.remove();
      if (ok) done(); else copyNote.textContent = 'This browser would not copy it. The same prompt is in docs/MEMORIZER-STUDY-FILE-PROMPT.md.';
    };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });
  function close() { if (closeFn) closeFn(); }
  x.addEventListener('click', close);
  cancel.addEventListener('click', close);
  go.addEventListener('click', function () { if (!study) return; var s = study; s.strict = strict.checked; close(); onImport(s); });

  closeFn = Dialog.open(box, doc.getElementById('app'));
  return close;
}

var api = { show: show, previewLines: previewLines };
root.MemImportUI = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
