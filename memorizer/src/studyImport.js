/* ═══════════════════════════════════════════════════════════════════════════
   studyImport.js — a study file (.md written by Claude, or a saved .html page)
   made into a unit.

   The file is read once into one intermediate, the StudyFile:
     { title, meta, sections: [{ heading, quiz, lines, points, tables,
       questions, emitted }], points, tables, questions }
   where every point, table and question stays in the section it was written
   under (the flat lists are views of the same objects). From it come the two
   things the app already knows how to check and teach:
     · study text, imported the way pasted notes are (ui.js saveUnit), so the
       unit has sections, the built-in coach, Ask and the AI to ground on;
     · a study pack (pack.js) with the file's points, tables and questions,
       put through Pack.check against that text like any other.
   HTML is turned into the same markdown shape first, so there is one parser.

   Flowcharts (```mermaid, or drawn in text with arrows) become the lesson's
   flowchart; SVG drawings are cleaned and kept with the unit as diagrams.

   A citation written in the file — "[p. 123]", "(pp. 12–13)" — is kept in
   the text it sits in, so it reaches the lesson and Ask as written. The
   pack's own `page` is the unit's page, which is a different thing.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var Spec = root.MemSpec || (typeof require === 'function' ? require('./spec.js') : null);
var MAX_BYTES = 2 * 1024 * 1024;
var QUIZ_HEAD = /^(?:quiz|questions?|practice questions?|self[- ]?(?:test|assessment)|mcqs?|test yourself|review questions?)\b/i;
var Q_HEAD = /^(?:q(?:uestion)?\s*\d+\b|q\d+\b)/i;
var OPTION = /^\s*(?:[-*]\s+)?\(?([A-Ea-e])[).:]\s+(.+)$/;
var ANSWER = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:correct\s+answer|answer|key)(?:\*\*)?\s*[:\-–]\s*(?:\*\*)?\s*\(?([A-Ea-e])\b/i;
var EXPLAIN = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:explanation|rationale|why)(?:\*\*)?\s*[:\-–]\s*(?:\*\*)?\s*(.*)$/i;
var STEM = /^\s*(?:\*\*)?stem(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/i;
var OPTIONS_HEAD = /^\s*(?:\*\*)?(?:options|choices)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*$/i;
var WHY_HEAD = /^\s*(?:\*\*)?why (?:the )?(?:distractors|other options|others|wrong options)\b/i;
var OTHER_HEAD = /^\s*(?:\*\*)?(?:clinical pearl|pearl|high[- ]yield|key point|takeaway|tip)s?(?:\*\*)?\s*:/i;
var POINT = /^\s*[-*]\s+\*\*([^*]+?)\*\*\s*[:\-–—]\s*(.+)$/;
var CITE = /[[(]\s*pp?\.\s*\d+(?:\s*[–—-]\s*\d+)?\s*[\])]/i;

function plain(t) {
  return String(t || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$|[.,;:])/g, '$1$2')
    .replace(/\s+/g, ' ').trim();
}
function sentence(t) { t = plain(t); return t && !/[.!?:\])]$/.test(t) ? t + '.' : t; }
function norm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

/* ── front matter: "key: value" and "key:" followed by "  - item" lines ── */
function frontMatter(block) {
  var meta = {}, list = null;
  block.split('\n').forEach(function (l) {
    var item = l.match(/^\s+-\s+(.*)$/);
    if (item && list) { meta[list].push(item[1].replace(/^["']|["']$/g, '').trim()); return; }
    var m = l.match(/^\s*([\w -]+?)\s*:\s*(.*)$/);
    if (!m) return;
    var k = m[1].toLowerCase().replace(/[\s-]+/g, '_'), v = m[2].replace(/^["']|["']$/g, '').trim();
    if (v) { meta[k] = v; list = null; } else { meta[k] = []; list = k; }
  });
  return meta;
}

/* ── flowcharts ───────────────────────────────────────────────────────────
   A ```mermaid block (or one that starts "flowchart"/"graph") is kept as it
   is. A block drawn in text with arrows — the study-file prompt asks for
   these — is turned into the same thing: each line a step, "↓" lines
   dropped, and a "├─"/"└─" line a branch from the nearest step to its left.
   Anything else in a code block is not a flowchart and is left out. */
var MAX_NODES = 30;
function flowLabel(t) {
  return plain(t).replace(/^[\s→>\-–—]+/, '').replace(/"/g, "'").replace(/\[/g, '(').replace(/\]/g, ')').trim();
}
function asciiFlow(body) {
  if (!/[↓→├└]|-->|->/.test(body)) return '';
  var nodes = [], edges = [], stack = [];
  body.split('\n').forEach(function (raw) {
    var line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^[\s↓↑|v│▼⬇→]+$/.test(line)) return;
    if (nodes.length >= MAX_NODES) return;
    var b = line.match(/^([\s│|]*)[├└+`][─—\-]*\s*(?:→|->|>)?\s*(.+)$/);
    var label = flowLabel(b ? b[2] : line);
    if (!label) return;
    var id = 'N' + nodes.length;
    nodes.push('  ' + id + '["' + label + '"]');
    if (b) {
      var depth = b[1].length;
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      if (stack.length) edges.push('  ' + stack[stack.length - 1].id + ' --> ' + id);
      stack.push({ depth: depth, id: id });
    } else {
      if (stack.length) edges.push('  ' + stack[0].id + ' --> ' + id);
      stack = [{ depth: -1, id: id }];
    }
  });
  return nodes.length >= 3 && edges.length >= 2 ? 'flowchart TD\n' + nodes.join('\n') + '\n' + edges.join('\n') : '';
}
function flowchartOf(b) {
  var body = String(b.body || '').trim();
  if (b.lang === 'mermaid' || /^(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\b/.test(body)) return /-->|==>|-\.->/.test(body) ? body : '';
  return asciiFlow(body);
}

/* ── diagrams ─────────────────────────────────────────────────────────────
   An SVG from the file is shown only as an <img> (where SVG runs no script
   and loads nothing), and is cleaned first all the same: elements and
   attributes from an allowlist, no event handlers, no link that leaves the
   drawing, no style that fetches. Tiny icons and oversize drawings are
   dropped. Needs a DOM (DOMParser, XMLSerializer). */
var SVG_MAX = 200 * 1024, DIAGRAMS_MAX = 12;
var SVG_TAGS = ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'marker', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'pattern', 'mask', 'symbol'];
function sanitizeSvg(svg) {
  svg = String(svg || '');
  if (!svg || svg.length > SVG_MAX || !root.DOMParser) return '';
  var d = new root.DOMParser().parseFromString(svg, 'image/svg+xml'), top = d.documentElement;
  if (!top || top.nodeName.toLowerCase() !== 'svg' || d.getElementsByTagName('parsererror').length) return '';
  (function clean(el) {
    Array.prototype.slice.call(el.children).forEach(function (c) {
      var tag = c.nodeName.toLowerCase();
      if (tag === 'a') { while (c.firstChild) el.insertBefore(c.firstChild, c); c.remove(); return; }
      if (SVG_TAGS.indexOf(tag) === -1) { c.remove(); return; }
    });
    Array.prototype.slice.call(el.children).forEach(clean);
    Array.prototype.slice.call(el.attributes).forEach(function (a) {
      var n = a.name.toLowerCase(), v = a.value;
      if (/^on/.test(n) || ((n === 'href' || n === 'xlink:href') && !/^#/.test(v)) || /url\(\s*['"]?(?!#)/i.test(v) || /javascript:|expression\(|@import/i.test(v)) el.removeAttribute(a.name);
    });
  })(top);
  var shapes = top.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,text').length;
  if (shapes < 3) return '';
  if (!top.getAttribute('xmlns')) top.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new root.XMLSerializer().serializeToString(top);
}

/* A reply copied with the code fence it came in (```markdown … ```) is the
   file inside it: the fence's first and last lines are dropped, whatever
   fences the file itself holds. */
function unwrap(src) {
  var m = src.trim().match(/^(`{3,}|~{3,})\s*(?:markdown|md)?\s*\n([\s\S]*)\n\1\s*$/i);
  return m ? m[2] : src;
}

/* ── markdown → StudyFile ─────────────────────────────────────────────── */
function parseMarkdown(text) {
  var src = unwrap(String(text || '').replace(/\r\n?/g, '\n')), meta = {};
  var fm = src.match(/^---\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (fm) { meta = frontMatter(fm[1]); src = src.slice(fm[0].length); }
  var blocks = [];
  function hold(b) { blocks.push(b); return '\n@@MZBLOCK' + (blocks.length - 1) + '@@\n'; }
  src = src.replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/```([\w-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g, function (_, lang, body) { return hold({ kind: 'code', lang: lang.toLowerCase(), body: body }); })
    .replace(/<svg[\s\S]*?<\/svg>/gi, function (svg) { return hold({ kind: 'svg', body: svg }); });
  var out = { title: typeof meta.unit === 'string' ? meta.unit : typeof meta.title === 'string' ? meta.title : '', meta: meta,
              sections: [], points: [], tables: [], questions: [], flowcharts: [], diagrams: [] };
  var sec = null, q = null, lines = src.split('\n');
  function newSection(h, quiz) {
    sec = { heading: h, quiz: !!quiz, lines: [], points: [], tables: [], questions: [], flowcharts: [], diagrams: [], emitted: [] };
    out.sections.push(sec);
  }
  function endQ() {
    if (q && (q.question || q.title) && q.options.length) {
      if (!q.question) q.question = q.title;
      delete q.title; delete q.mode;
      if (!sec) newSection('', true);
      q.section = sec; sec.questions.push(q); out.questions.push(q);
    }
    q = null;
  }
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i], hm = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/), bm = l.match(/^@@MZBLOCK(\d+)@@$/);
    if (bm) {
      if (q) continue;
      if (!sec) newSection('');
      var blk = blocks[+bm[1]], item;
      if (blk.kind === 'svg') { item = { title: sec.heading || out.title, svg: blk.body, section: sec }; sec.diagrams.push(item); out.diagrams.push(item); }
      else if ((item = flowchartOf(blk))) { item = { code: item, section: sec }; sec.flowcharts.push(item); out.flowcharts.push(item); }
      continue;
    }
    if (hm) {
      var level = hm[1].length, h = plain(hm[2]);
      if (level === 1 && !out.title) { out.title = h; continue; }
      if (Q_HEAD.test(h) || (sec && sec.quiz && level >= 3)) {
        endQ();
        var rest = h.replace(Q_HEAD, '').replace(/^\s*[:.)\-–—]\s*/, '').trim();
        q = { question: '', title: rest, options: [], answer: -1, explain: '', why: [], mode: '' };
        continue;
      }
      endQ();
      newSection(h, QUIZ_HEAD.test(h));
      continue;
    }
    if (q) {
      var m;
      if ((m = l.match(ANSWER))) { q.answer = m[1].toUpperCase().charCodeAt(0) - 65; q.mode = ''; continue; }
      if ((m = l.match(EXPLAIN))) { q.explain = plain(m[1]); q.mode = 'explain'; continue; }
      if (WHY_HEAD.test(l)) { q.mode = 'why'; continue; }
      if (OTHER_HEAD.test(l)) { q.mode = 'other'; continue; }
      if (OPTIONS_HEAD.test(l)) continue;
      if ((m = l.match(OPTION))) {
        var k = m[1].toUpperCase().charCodeAt(0) - 65;
        if (q.mode === 'why') { q.why[k] = plain(m[2]); continue; }
        if (!q.mode && (q.question || q.title)) {
          q.options.push(plain(m[2]).replace(/\s*(?:✓|✔|\(correct\))\s*$/i, ''));
          if (/(?:✓|✔|\(correct\))\s*$/i.test(m[2]) && q.answer < 0) q.answer = q.options.length - 1;
          continue;
        }
      }
      if ((m = l.match(STEM))) { q.question = plain(m[1]); continue; }
      if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(l)) { endQ(); continue; }
      if (!l.trim()) continue;
      if (q.mode === 'explain') q.explain = plain(q.explain + ' ' + l);
      else if (!q.mode && !q.options.length) q.question = plain(q.question + ' ' + l);
      continue;
    }
    if (sec && sec.quiz) {
      if (!l.trim() || /^\s*(?:-{3,}|\*{3,})\s*$/.test(l)) continue;
      newSection('');
    }
    if (!sec) newSection('');
    if (/^\s*\|/.test(l)) {
      var rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;
      var cells = rows.map(function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(plain); });
      var body = cells.filter(function (c, j) { return j > 0 && !c.every(function (x) { return /^:?-{2,}:?$/.test(x) || !x; }); });
      if (cells.length >= 2 && body.length) {
        var cols = cells[0], ok = body.filter(function (r) { return r.length === cols.length; });
        if (ok.length) { var t = { title: sec.heading || out.title, columns: cols, rows: ok, section: sec }; sec.tables.push(t); out.tables.push(t); }
      }
      continue;
    }
    var pm = l.match(POINT);
    if (pm) { var pt = { term: plain(pm[1]), text: plain(pm[2]), section: sec }; sec.points.push(pt); out.points.push(pt); }
    sec.lines.push(l);
  }
  endQ();
  if (!out.title) out.title = 'Imported study unit';
  return out;
}

/* ── HTML → the same markdown ─────────────────────────────────────────────
   Takes a Document (DOMParser's). A question is a .question or
   [data-question] block, or a <fieldset> of radio buttons. Its answer is
   read BEFORE form controls are dropped, from: data-answer (a letter or a
   0-based index), an option marked .correct / data-correct / aria-checked,
   a checked or selected control, or an "Answer: B" line. Its options are the
   .option / [data-option] elements, else the items of its first list, else
   its radio labels — never a list inside its explanation. */
var EXPLAINISH = '.explanation,.rationale,.why-wrong,.why,.feedback,.answer-explanation,[data-explanation]';
function optionEls(e) {
  function mine(x) { var c = x.parentElement && x.parentElement.closest(EXPLAINISH); return !c || !e.contains(c) || c === e; }
  var marked = Array.prototype.filter.call(e.querySelectorAll('.option,[data-option]'), mine);
  if (marked.length) return marked;
  var list = Array.prototype.filter.call(e.querySelectorAll('ol,ul'), function (x) { return mine(x) && !x.matches(EXPLAINISH); })[0];
  if (list) return Array.prototype.filter.call(list.children, function (x) { return x.tagName.toLowerCase() === 'li'; });
  return Array.prototype.filter.call(e.querySelectorAll('label'), function (x) { return mine(x) && x.querySelector('input[type=radio],input[type=checkbox]') || (x.htmlFor && e.querySelector('#' + CSS.escape(x.htmlFor))); });
}
function letterOf(v, n) {
  v = String(v || '').trim();
  if (/^[A-Ea-e]$/.test(v)) return v.toUpperCase();
  if (/^\d+$/.test(v) && +v < n) return String.fromCharCode(65 + (+v));
  return '';
}
function answerOf(e, opts) {
  var a = letterOf(e.getAttribute('data-answer') || e.getAttribute('data-correct'), opts.length);
  if (a) return a;
  for (var k = 0; k < opts.length; k++) {
    var o = opts[k];
    if (o.matches('.correct,.is-correct,[data-correct="true"],[data-correct=""],[aria-checked="true"]') ||
        o.querySelector('input:checked,input[checked],input[data-correct="true"],option[selected],.correct')) return String.fromCharCode(65 + k);
  }
  var tail = String(e.textContent).match(/(?:correct\s+answer|answer)\s*[:\-–]\s*\(?([A-E])\b/i);
  return tail ? tail[1].toUpperCase() : '';
}
function htmlToMarkdown(doc) {
  var out = [], titleEl = doc.querySelector('h1') || doc.querySelector('title'), title = titleEl ? plain(titleEl.textContent) : '';
  if (title) out.push('# ' + title);
  function text(e) { return plain(e.textContent); }
  var qs = Array.prototype.filter.call(doc.querySelectorAll('.question,[data-question],fieldset'), function (e) {
    return !e.parentElement || !e.parentElement.closest('.question,[data-question]');
  });
  qs.forEach(function (e) {
    var opts = optionEls(e);
    if (opts.length < 2) return;
    e.setAttribute('data-mz-q', '');
    e.setAttribute('data-mz-answer', answerOf(e, opts));
    opts.forEach(function (o) { o.setAttribute('data-mz-opt', ''); });
  });
  Array.prototype.forEach.call(doc.querySelectorAll('script,style,nav,footer,noscript,button,input,select,textarea,template,iframe,object'), function (e) { e.remove(); });
  var qn = 0;
  function question(e) {
    var opts = e.querySelectorAll('[data-mz-opt]');
    var stemEl = e.querySelector('.stem,[data-stem],.question-text,.q-text,legend');
    if (!stemEl) stemEl = Array.prototype.filter.call(e.querySelectorAll('p,h2,h3,h4,h5,h6'), function (p) { return !p.closest('[data-mz-opt]') && !p.closest(EXPLAINISH); })[0];
    var stem = stemEl ? text(stemEl) : '';
    if (!stem) return false;
    out.push('', '### Question ' + (++qn), stem);
    Array.prototype.forEach.call(opts, function (o, k) { out.push(String.fromCharCode(65 + k) + ') ' + text(o).replace(/^\(?[A-Ea-e][).:]\s+/, '')); });
    var a = e.getAttribute('data-mz-answer');
    if (a) out.push('Answer: ' + a);
    var ex = e.querySelector('.explanation,.rationale,.answer-explanation,[data-explanation]');
    if (ex) out.push('Explanation: ' + text(ex));
    out.push('', '---', '');
    return true;
  }
  function walk(e) {
    var tag = e.tagName ? e.tagName.toLowerCase() : '';
    if (!tag) return;
    if (e.hasAttribute('data-mz-q') && question(e)) return;
    if (/^h[1-6]$/.test(tag)) { var ht = text(e); if (ht && !(tag === 'h1' && ht === title)) out.push('', '#'.repeat(Math.max(2, +tag[1])) + ' ' + ht); return; }
    if (tag === 'table') {
      var rows = Array.prototype.map.call(e.querySelectorAll('tr'), function (tr) {
        return Array.prototype.map.call(tr.querySelectorAll('th,td'), function (c) { return text(c).replace(/\|/g, '/'); });
      }).filter(function (r) { return r.length; });
      if (rows.length >= 2) {
        out.push('', '| ' + rows[0].join(' | ') + ' |', '|' + rows[0].map(function () { return '---'; }).join('|') + '|');
        rows.slice(1).forEach(function (r) { out.push('| ' + r.join(' | ') + ' |'); });
        out.push('');
      }
      return;
    }
    if (tag === 'dl') {
      var term = '';
      Array.prototype.forEach.call(e.children, function (c) {
        var ct = c.tagName.toLowerCase();
        if (ct === 'dt') term = text(c);
        else if (ct === 'dd' && term) out.push('- **' + term + '**: ' + text(c));
      });
      return;
    }
    if (tag === 'svg') { out.push('', e.outerHTML.replace(/\s*\n\s*/g, ' '), ''); return; }
    if (tag === 'pre') {
      var code = e.querySelector('code'), lang = ((code && code.className || e.className).match(/language-([\w-]+)/) || ['', ''])[1];
      out.push('', '```' + lang, e.textContent.replace(/\n$/, ''), '```', '');
      return;
    }
    if (tag === 'img') { var alt = plain(e.getAttribute('alt')); if (alt.split(' ').length >= 3) out.push('', 'Figure: ' + sentence(alt)); return; }
    if (tag === 'li' && !e.querySelector('ul,ol,table,p,div')) { var lt = text(e); if (lt) out.push('- ' + lt); return; }
    if (/^(?:p|blockquote|figcaption)$/.test(tag)) {
      var t = text(e);
      if (t) out.push('', tag === 'figcaption' ? 'Figure: ' + sentence(t) : t);
      Array.prototype.forEach.call(e.querySelectorAll('img'), walk);
      return;
    }
    Array.prototype.forEach.call(e.children, walk);
  }
  walk(doc.body || doc.documentElement);
  return out.join('\n');
}
function parseHTML(html) {
  return parseMarkdown(htmlToMarkdown(new root.DOMParser().parseFromString(String(html || ''), 'text/html')));
}

/* ── study text for saveUnit; each section remembers the lines it gave ── */
function studyText(p) {
  var out = [];
  p.sections.forEach(function (s) {
    s.emitted = [];
    if (s.quiz) return;
    var body = [], para = [];
    function flush() { if (para.length) { body.push(plain(para.join(' '))); para = []; } }
    s.lines.forEach(function (l) {
      if (!l.trim()) { flush(); return; }
      var pm = l.match(POINT);
      if (pm) { flush(); body.push(sentence(plain(pm[1]) + ': ' + pm[2])); return; }
      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(l)) { flush(); body.push(sentence(l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))); return; }
      if (/^\s*(?:-{3,}|\*{3,}|>)\s*$/.test(l)) { flush(); return; }
      para.push(l.replace(/^\s*>\s?/, ''));
    });
    flush();
    s.tables.forEach(function (t) { t.rows.forEach(function (r) { body.push(tableRow(t, r)); }); });
    body = body.filter(Boolean);
    if (!body.length) return;
    s.emitted = body;
    if (s.heading) out.push(s.heading);
    out.push(body.join('\n'));
  });
  return out.join('\n\n');
}
function tableRow(t, r) { return sentence(r.map(function (v, k) { return (k ? t.columns[k] + ': ' : '') + v; }).join('; ')); }

/* ── the pack ─────────────────────────────────────────────────────────────
   Where each item goes is read, not guessed: a point or table row is in
   the unit's text word for word, so it goes to the section whose text holds
   it, looked for first among the sections its own heading's text landed in.
   A question written under a content heading goes with that heading's text.
   Only a question in a quiz section at the end has no place of its own; it
   goes where its right answer and explanation share the most words, a tie
   to the section holding its citation if it has one, else to the earlier.

   A section is sent when anything reached it. One with questions or tables
   but no "**Term**:" points takes the built-in coach's points from its own
   text, since Pack.check refuses a lesson with none. Questions without a
   marked answer are left out here, and counted. */
function words(t) { return String(t || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []; }
function packFor(p, doc, Pack, Coach) {
  studyText(p);
  var C = doc.clusters.map(function (c) { return norm(c.segments.map(Pack.segText).join(' ')); });
  var all = C.map(function (_, i) { return i; });
  var sets = C.map(function (t) { var s = {}; words(t).forEach(function (w) { s[w] = true; }); return s; });
  function holding(t, among) { var n = norm(t); if (!n) return -1; for (var k = 0; k < among.length; k++) if (C[among[k]].indexOf(n) !== -1) return among[k]; return -1; }
  function closest(t, among) {
    var at = among[0], top = -1, cite = (String(t).match(CITE) || [''])[0];
    among.forEach(function (i) {
      var n = 0; words(t).forEach(function (w) { if (sets[i][w]) n++; });
      if (n > top || (n === top && cite && C[i].indexOf(norm(cite)) !== -1 && C[at].indexOf(norm(cite)) === -1)) { top = n; at = i; }
    });
    return at;
  }
  var landed = new Map();
  function sectionClusters(s) {
    if (landed.has(s)) return landed.get(s);
    var got = [];
    s.emitted.forEach(function (line) { var i = holding(line, all); if (i !== -1 && got.indexOf(i) === -1) got.push(i); });
    got.sort(function (a, b) { return a - b; });
    /* a section that gave no text of its own (a figure heading with only
       its drawing) belongs where the section before it landed */
    if (!got.length) {
      var at = p.sections.indexOf(s);
      for (var k = at - 1; k >= 0 && !got.length; k--) if (p.sections[k].emitted.length) got = sectionClusters(p.sections[k]);
    }
    landed.set(s, got.length ? got : all);
    return landed.get(s);
  }
  function place(t, s) { var among = s ? sectionClusters(s) : all, i = holding(t, among); return i !== -1 ? i : closest(t, among); }
  var per = doc.clusters.map(function () { return { points: [], tables: [], questions: [], flowchart: '' }; }), diagrams = [];
  p.points.forEach(function (x) { per[place(sentence(x.term + ': ' + x.text), x.section)].points.push(x); });
  p.tables.forEach(function (t) { per[place(tableRow(t, t.rows[0]), t.section)].tables.push(t); });
  p.flowcharts.forEach(function (f) { var i = sectionClusters(f.section)[0]; if (!per[i].flowchart) per[i].flowchart = f.code; });
  p.diagrams.forEach(function (g) { if (diagrams.length < DIAGRAMS_MAX) diagrams.push({ index: sectionClusters(g.section)[0], title: g.title, svg: g.svg }); });
  var unanswered = 0;
  p.questions.forEach(function (q) {
    if (q.answer < 0 || q.answer >= q.options.length) { unanswered++; return; }
    var among = q.section && !q.section.quiz ? sectionClusters(q.section) : all;
    per[closest([q.options[q.answer], q.explain, q.question].join(' '), among)].questions.push(q);
  });
  var sections = [];
  per.forEach(function (x, i) {
    if (!x.points.length && !x.tables.length && !x.questions.length && !x.flowchart) return;
    var c = doc.clusters[i], pg = c.pageStart;
    var points = x.points.map(function (pt) { return { text: sentence(pt.term + ': ' + pt.text), page: pg }; });
    var by = 'file';
    if (!points.length) { points = Coach.lesson(c).points.map(function (pt) { return { text: pt.text, page: pt.page }; }); by = 'coach'; }
    sections.push({
      section: i + 1, title: c.title, pointsBy: by,
      lesson: { overview: '', points: points, flowchart: x.flowchart,
                tables: x.tables.map(function (t) { return { title: t.title || 'Table', columns: t.columns, rows: t.rows, page: pg }; }) },
      quiz: { questions: x.questions.map(function (q) {
        var why = q.why.some(Boolean) ? q.options.map(function (_, k) { return k === q.answer ? '' : q.why[k] || ''; }) : [];
        return { question: q.question, quote: '', options: q.options, answer: q.answer, explain: q.explain, page: pg, why: why, trap: '' };
      }) },
    });
  });
  return { pack: sections.length ? { format: Pack.FORMAT, version: Pack.VERSION, unit: doc.name, sections: sections } : null, unanswered: unanswered, diagrams: diagrams };
}

/* Strict import: a question's scenario is held to the text too. Pack.check
   holds what a question claims (its right answer and its explanation) and
   leaves the stem alone, because a vignette's age or pressure is set up,
   not asserted. A study file's question is not the model's, though, and in
   strict mode every number and named condition in its stem must be in the
   unit's text, or the question is flagged where it is shown. */
function strictQuestions(checked, doc, Pack) {
  var book = Pack.bookOf(doc), n = 0;
  checked.sections.forEach(function (s) {
    var c = doc.clusters[s.index], sec = { text: c.segments.map(Pack.segText).join(' ') };
    s.quiz.questions.forEach(function (q) {
      if (q.flag) return;
      var why = Pack.claimFlag(q.question, sec, book, q.page);
      if (!why) return;
      q.flag = 'in its scenario, ' + why;
      s.flags.push({ where: 'question stem', text: q.question, why: q.flag });
      n++;
    });
  });
  return n;
}

/* What the unit keeps of the front matter: the fields the study-file prompt
   asks for, when they are there. */
var META = { source_book: 'sourceBook', source_page_range: 'pageRange', difficulty_level: 'difficulty',
             estimated_study_time_minutes: 'minutes', prerequisites: 'prerequisites', learning_objectives: 'objectives' };
function studyMeta(p) {
  var out = {};
  Object.keys(META).forEach(function (k) { var v = p.meta[k]; if (v && (typeof v === 'string' || v.length)) out[META[k]] = v; });
  return out;
}

/* ── the study-file prompt, built from spec.js ────────────────────────────
   What the owner pastes into Claude with their chapter. Its rules are
   spec.js's, word for word, as the study-pack prompt's are; its format is the
   one parseMarkdown reads, and STUDY_EXAMPLE, which the prompt shows, is
   parsed by the suite: a prompt that asks for a shape this file cannot read
   fails there. docs/MEMORIZER-STUDY-FILE-PROMPT.md is this, written by
   scripts/study-file-prompt.js. */
var FENCE = '```';
var STUDY_EXAMPLE = [
  '---',
  'unit: Aortic Stenosis',
  'source_book: Braunwald 12e, chapter 72',
  'source_page_range: 1450-1470',
  'difficulty_level: advanced',
  'estimated_study_time_minutes: 40',
  '---',
  '',
  '## Diagnosis and grading',
  '',
  'Aortic stenosis is graded on echocardiography by the peak jet velocity and the mean gradient across the valve [p. 1452].',
  '',
  '- **Peak velocity**: 4 m/s or more marks severe aortic stenosis [p. 1452].',
  '- **Mean gradient**: 40 mmHg or more marks severe aortic stenosis [p. 1452].',
  '- **Aortic stenosis vs aortic sclerosis**: sclerosis thickens the leaflets without obstructing flow; stenosis raises the peak velocity [p. 1451].',
  '',
  '| Measure | Severe aortic stenosis |',
  '|---|---|',
  '| Peak velocity | 4 m/s or more |',
  '| Mean gradient | 40 mmHg or more |',
  '',
  '## Treatment and timing',
  '',
  'Valve replacement is indicated once symptoms appear [p. 1460].',
  '',
  FENCE + 'mermaid',
  'flowchart TD',
  '  A["Severe aortic stenosis"] --> B{"Symptoms?"}',
  '  B -->|"yes"| C["Valve replacement"]',
  '  B -->|"no"| D["Follow-up echocardiography"]',
  FENCE,
  '',
  '## Practice Questions',
  '',
  '### Question 1: timing',
  '**Stem**: A patient with severe aortic stenosis on echocardiography develops exertional syncope. What is the next best step?',
  '',
  '**Options**:',
  '- A) Follow-up echocardiography',
  '- B) Valve replacement',
  '- C) Medical therapy alone',
  '- D) Balloon valvotomy as definitive treatment',
  '',
  '**Correct Answer**: B',
  '',
  '**Explanation**: Valve replacement is indicated once symptoms appear [p. 1460].',
  '',
  '**Why the distractors are wrong**:',
  '- A) Follow-up is for severe stenosis without symptoms.',
  '- C) Medical therapy does not relieve the obstruction.',
  '- D) Balloon valvotomy is only a bridge.',
  '',
  '---',
].join('\n');
function studyFilePrompt() {
  var R = Spec.RULES, Q = Spec.QUESTIONS.file;
  return [
    'MEMORIZER STUDY FILE',
    '',
    'You are a master clinician and a medical educator preparing a candidate for boards and oral exams. From the ' +
    'chapter I give you (pasted below, or attached as a PDF), write ONE markdown study file for my Memorizer app. ' +
    'After one pass through it I should understand why, recall every high-yield fact, and defend it under questioning.',
    '',
    'RULES',
    '1. ' + R.onlySource + ' Where something is needed and the chapter does not have it, leave it out.',
    '2. Write in your own words; do not copy the chapter’s sentences. ' + R.numbers,
    '3. Cite the chapter’s page for every point, table and explanation as [p. N].',
    '4. Memorizer checks the file against its own text: a number in a point, table, answer or explanation that the ' +
    'file’s text does not have is flagged. So every number you use in a question’s answer must also be in a point or table.',
    '5. Reply with the file itself, as plain markdown, not inside a code block, and nothing before or after it, in ' +
    'exactly the shape shown under THE SHAPE.',
    '',
    'WHAT GOES IN IT',
    '- The front matter: unit, source_book, source_page_range, difficulty_level (beginner, intermediate or ' +
    'advanced), estimated_study_time_minutes.',
    '- One "## " heading per topic of the chapter, in its order. Under each: one or two plain sentences on the big ' +
    'idea, then its points, one per line as "- **Key term**: the fact [p. N]". Points: ' + R.points,
    '- ' + R.distinction + ' Write it as a point: "- **A vs B**: the feature that tells them apart [p. N]".',
    '- ' + R.table + ' Write it as a markdown table under the heading it belongs to.',
    '- ' + R.flowchart + ' Write it in a ' + FENCE + 'mermaid code block under the heading it belongs to.',
    '- A diagram, if a figure would teach what words cannot: an <svg> drawn by you, labelled, under its heading. ' +
    'Memorizer shows it as a picture and does not check it.',
    '- Last, "## Practice Questions": ' + Q[0] + ' to ' + Q[1] + ' board-style questions, the most important material ' +
    'first, each as "### Question N: what it tests", then **Stem**, **Options** (A to D), **Correct Answer**, ' +
    '**Explanation** and **Why the distractors are wrong**, and a line of three dashes after it. ' +
    R.mcq + ' ' + R.options + ' ' + R.style + ' ' + R.explain + ' ' + R.why,
    '',
    'BEFORE YOU REPLY, check: every number against the chapter; every table row has one cell per column; every ' +
    'flowchart label is in quotes; every question has exactly ' + Spec.OPTIONS + ' options and one Correct Answer line.',
    '',
    'THE SHAPE — a short example; yours covers the whole chapter:',
    '````markdown',
    STUDY_EXAMPLE,
    '````',
    '',
    'THE CHAPTER',
    '[Paste the chapter here, or attach its PDF.]',
  ].join('\n');
}

var ACCEPT = '.md,.markdown,.txt,.html,.htm';
function detectFormat(name, content) {
  if (/\.html?$/i.test(name || '')) return 'html';
  if (/\.(?:md|markdown|txt)$/i.test(name || '')) return 'markdown';
  return /^\s*(?:<!doctype html|<html|<head|<body)/i.test(content || '') ? 'html' : 'markdown';
}

/* → { success, format, study: { name, text, parsed, meta }, summary } */
function parseStudyFile(content, name) {
  try {
    if (String(content || '').length > MAX_BYTES) return { success: false, error: 'This file is too large to import at once (over ' + (MAX_BYTES / 1048576) + ' MB). Split it into smaller study units' };
    var format = detectFormat(name, content);
    var parsed = format === 'html' ? parseHTML(content) : parseMarkdown(content);
    var text = studyText(parsed);
    if (!words(text).length) return { success: false, error: 'No study text was found in this file' };
    var qs = parsed.questions;
    var answered = qs.filter(function (q) { return q.answer >= 0 && q.answer < q.options.length; });
    var usable = answered.filter(function (q) { return q.options.length === Spec.OPTIONS; }).length;
    return {
      success: true, format: format,
      study: { name: parsed.title, text: text, parsed: parsed, meta: studyMeta(parsed) },
      summary: { unit: parsed.title, words: words(text).length, teaching_points: parsed.points.length, tables: parsed.tables.length,
                 flowcharts: parsed.flowcharts.length, diagrams: Math.min(parsed.diagrams.length, DIAGRAMS_MAX),
                 questions: qs.length, answered: answered.length, unanswered: qs.length - answered.length,
                 malformed: answered.length - usable },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

var api = { MAX_BYTES: MAX_BYTES, ACCEPT: ACCEPT, STUDY_EXAMPLE: STUDY_EXAMPLE, studyFilePrompt: studyFilePrompt, parseMarkdown: parseMarkdown, htmlToMarkdown: htmlToMarkdown, parseHTML: parseHTML,
            studyText: studyText, packFor: packFor, asciiFlow: asciiFlow, sanitizeSvg: sanitizeSvg, DIAGRAMS_MAX: DIAGRAMS_MAX, strictQuestions: strictQuestions, studyMeta: studyMeta, detectFormat: detectFormat, parseStudyFile: parseStudyFile };
root.MemStudyImport = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
