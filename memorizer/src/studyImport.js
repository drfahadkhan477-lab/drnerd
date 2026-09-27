/* ═══════════════════════════════════════════════════════════════════════════
   studyImport.js — a study file (.md written by Claude, or a saved .html page)
   made into a unit.

   The file is not stored as a unit of its own shape. It becomes two things
   the app already knows how to check and teach:
     · study text, imported the way pasted notes are (ui.js importText), so
       the unit has sections, the built-in coach, Ask and the AI to ground on;
     · a study pack (pack.js) holding the file's own teaching points, tables
       and questions, put through Pack.check against that text like any other.
   HTML is turned into the same markdown shape first, so there is one parser.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var QUIZ_HEAD = /^(?:quiz|questions?|practice questions?|self[- ]?(?:test|assessment)|mcqs?|test yourself|review questions?)\b/i;
var Q_HEAD = /^(?:q(?:uestion)?\s*\d+\b|q\d+\b)/i;
var OPTION = /^\s*(?:[-*]\s+)?\(?([A-Ea-e])[).:]\s+(.+)$/;
var ANSWER = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:correct\s+answer|answer|key)(?:\*\*)?\s*[:\-–]\s*(?:\*\*)?\s*\(?([A-Ea-e])\b/i;
var EXPLAIN = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:explanation|rationale|why)(?:\*\*)?\s*[:\-–]\s*(?:\*\*)?\s*(.*)$/i;
var STEM = /^\s*(?:\*\*)?stem(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/i;
var OPTIONS_HEAD = /^\s*(?:\*\*)?(?:options|choices)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*$/i;
var WHY_HEAD = /^\s*(?:\*\*)?why (?:the )?(?:distractors|other options|others|wrong options)\b/i;
var OTHER_HEAD = /^\s*(?:\*\*)?(?:clinical pearl|pearl|high[- ]yield|key point|takeaway|tip)s?(?:\*\*)?\s*:/i;
var POINT =/^\s*[-*]\s+\*\*([^*]+?)\*\*\s*[:\-–—]\s*(.+)$/;

function plain(t) {
  return String(t || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$|[.,;:])/g, '$1$2')
    .replace(/\s+/g, ' ').trim();
}
function sentence(t) { t = plain(t); return t && !/[.!?:]$/.test(t) ? t + '.' : t; }

/* ── markdown ─────────────────────────────────────────────────────────────
   → { title, sections: [{ heading, lines }], points: [{ term, text }],
       tables: [{ title, columns, rows }], questions: [{ question, options,
       answer (index, -1 when the file marks none), explain, why: [per option] }] } */
function parseMarkdown(text) {
  var src = String(text || '').replace(/\r\n?/g, '\n'), meta = {};
  var fm = src.match(/^---\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (fm) {
    fm[1].split('\n').forEach(function (l) { var m = l.match(/^\s*([\w -]+?)\s*:\s*(.*)$/); if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '').trim(); });
    src = src.slice(fm[0].length);
  }
  src = src.replace(/```[\s\S]*?(?:```|$)/g, '\n').replace(/<svg[\s\S]*?<\/svg>/gi, '\n').replace(/<!--[\s\S]*?-->/g, '\n');
  var out = { title: meta.unit || meta.title || '', sections: [], points: [], tables: [], questions: [] };
  var sec = null, quiz = false, q = null, lines = src.split('\n');
  function newSection(h) { sec = { heading: h, lines: [] }; out.sections.push(sec); }
  function endQ() {
    if (q && q.question && q.options.length) out.questions.push(q);
    q = null;
  }
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i], hm = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (hm) {
      var level = hm[1].length, h = plain(hm[2]);
      if (level === 1 && !out.title) { out.title = h; continue; }
      if (Q_HEAD.test(h) || (quiz && level >= 3)) {
        endQ();
        var rest = h.replace(Q_HEAD, '').replace(/^\s*[:.)\-–—]\s*/, '').trim();
        q = { question: '', title: rest, options: [], answer: -1, explain: '', why: [], mode: '' };
        continue;
      }
      endQ();
      quiz = QUIZ_HEAD.test(h);
      if (!quiz) newSection(h);
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
      if (!l.trim() || /^\s*(?:-{3,}|\*{3,})\s*$/.test(l)) continue;
      if (q.mode === 'explain') q.explain = plain(q.explain + ' ' + l);
      else if (!q.mode && !q.options.length) q.question = plain(q.question + ' ' + l);
      continue;
    }
    if (quiz) continue;
    if (/^\s*\|/.test(l)) {
      var rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;
      var cells = rows.map(function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(plain); });
      var body = cells.filter(function (c, k) { return k > 0 && !c.every(function (x) { return /^:?-{2,}:?$/.test(x) || !x; }); });
      if (cells.length >= 2 && body.length) {
        var cols = cells[0], ok = body.filter(function (r) { return r.length === cols.length; });
        if (ok.length) out.tables.push({ title: sec ? sec.heading : out.title, columns: cols, rows: ok, section: sec });
      }
      continue;
    }
    if (!sec) newSection('');
    var pm = l.match(POINT);
    if (pm) out.points.push({ term: plain(pm[1]), text: plain(pm[2]) });
    sec.lines.push(l);
  }
  endQ();
  out.questions.forEach(function (x) { if (!x.question) x.question = x.title; delete x.title; delete x.mode; });
  if (!out.title) out.title = 'Imported study unit';
  return out;
}

/* ── HTML → the same markdown ─────────────────────────────────────────────
   Takes a Document (DOMParser's). Script, style, svg and navigation are
   dropped; what reads as a question (a .question block, or a heading
   "Question N") keeps its options and, when the page marks one, its answer
   (data-answer, a .correct option, or an "Answer: B" line). */
function htmlToMarkdown(doc) {
  var out = [], title = (doc.querySelector('h1') || doc.querySelector('title') || {}).textContent || '';
  if (title.trim()) out.push('# ' + plain(title));
  var skip = 'script,style,svg,nav,header nav,footer,noscript,button,input,select,textarea,template';
  Array.prototype.forEach.call(doc.querySelectorAll(skip), function (e) { e.remove(); });
  var qn = 0;
  function text(e) { return plain(e.textContent); }
  function question(e) {
    var stemEl = e.querySelector('.stem,[data-stem],.question-text,.q-text,p');
    var optEls = e.querySelectorAll('.option,[data-option],li,label');
    var stem = stemEl ? text(stemEl) : '';
    if (!stem || optEls.length < 2) return false;
    out.push('### Question ' + (++qn), stem);
    var answer = e.getAttribute('data-answer') || '';
    Array.prototype.forEach.call(optEls, function (o, k) {
      var t = text(o).replace(/^\(?[A-Ea-e][).:]\s+/, '');
      out.push(String.fromCharCode(65 + k) + ') ' + t);
      if (!answer && (o.matches('.correct,[data-correct="true"],[data-correct=""]'))) answer = String.fromCharCode(65 + k);
    });
    if (/^\d+$/.test(answer)) answer = String.fromCharCode(65 + (+answer));
    var ex = e.querySelector('.explanation,.rationale,[data-explanation]');
    var tail = text(e).match(/(?:correct\s+answer|answer)\s*[:\-–]\s*\(?([A-E])\b/i);
    if (!answer && tail) answer = tail[1];
    if (answer) out.push('Answer: ' + answer.toUpperCase());
    if (ex) out.push('Explanation: ' + text(ex));
    out.push('');
    return true;
  }
  function walk(e) {
    var tag = e.tagName ? e.tagName.toLowerCase() : '';
    if (!tag) return;
    if (e.matches('.question,[data-question]') && question(e)) return;
    if (/^h[1-6]$/.test(tag)) { if (tag !== 'h1' || plain(e.textContent) !== plain(title)) out.push('', '#'.repeat(Math.max(2, +tag[1])) + ' ' + text(e)); return; }
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
        if (c.tagName.toLowerCase() === 'dt') term = text(c);
        else if (c.tagName.toLowerCase() === 'dd' && term) out.push('- **' + term + '**: ' + text(c));
      });
      return;
    }
    if (tag === 'li') { if (!e.querySelector('ul,ol,table')) { out.push('- ' + text(e)); return; } }
    if (tag === 'p' || tag === 'blockquote' || tag === 'figcaption') { var t = text(e); if (t) out.push('', t); return; }
    Array.prototype.forEach.call(e.children, walk);
  }
  walk(doc.body || doc.documentElement);
  return out.join('\n');
}
function parseHTML(html) {
  return parseMarkdown(htmlToMarkdown(new root.DOMParser().parseFromString(String(html || ''), 'text/html')));
}

/* ── study text for importText ──────────────────────────────────────────── */
function studyText(p) {
  var out = [];
  p.sections.forEach(function (s) {
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
    p.tables.filter(function (t) { return t.section === s; }).forEach(function (t) {
      t.rows.forEach(function (r) { body.push(sentence(r.map(function (v, k) { return (k ? t.columns[k] + ': ' : '') + v; }).join('; '))); });
    });
    body = body.filter(Boolean);
    if (!body.length) return;
    if (s.heading) out.push(s.heading);
    out.push(body.join('\n'));
  });
  return out.join('\n\n');
}

/* ── the pack ─────────────────────────────────────────────────────────────
   Each point, table and question goes to the section whose text shares
   the most of its words; the pack then goes through Pack.check like one
   pasted from a chat. Questions with no marked answer are left out here,
   and counted: a question whose right answer is guessed teaches the guess. */
function words(t) { return String(t || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []; }
function overlap(a, set) { var n = 0; words(a).forEach(function (w) { if (set[w]) n++; }); return n; }
function sectionSets(doc, segText) {
  return doc.clusters.map(function (c) {
    var s = {}; words(c.segments.map(segText).join(' ')).forEach(function (w) { s[w] = true; }); return s;
  });
}
function best(t, sets) {
  var at = 0, top = -1;
  sets.forEach(function (s, i) { var n = overlap(t, s); if (n > top) { top = n; at = i; } });
  return at;
}
function packFor(p, doc, Pack) {
  var sets = sectionSets(doc, Pack.segText), per = doc.clusters.map(function () { return { points: [], tables: [], questions: [] }; });
  p.points.forEach(function (x) { per[best(x.term + ' ' + x.text, sets)].points.push(x); });
  p.tables.forEach(function (t) { per[best(t.columns.concat.apply(t.columns, t.rows).join(' '), sets)].tables.push(t); });
  var unanswered = 0;
  p.questions.forEach(function (q) {
    if (q.answer < 0 || q.answer >= q.options.length) { unanswered++; return; }
    per[best(q.options[q.answer] + ' ' + q.explain + ' ' + q.question, sets)].questions.push(q);
  });
  var sections = [];
  per.forEach(function (x, i) {
    if (!x.points.length) return;
    var c = doc.clusters[i], pg = c.pageStart;
    sections.push({
      section: i + 1, title: c.title,
      lesson: {
        overview: '',
        points: x.points.map(function (pt) { return { text: sentence(pt.term + ': ' + pt.text), page: pg }; }),
        tables: x.tables.map(function (t) { return { title: t.title || 'Table', columns: t.columns, rows: t.rows, page: pg }; }),
      },
      quiz: { questions: x.questions.map(function (q) {
        var why = q.why.some(Boolean) ? q.options.map(function (_, k) { return k === q.answer ? '' : q.why[k] || ''; }) : [];
        return { question: q.question, quote: '', options: q.options, answer: q.answer, explain: q.explain, page: pg, why: why, trap: '' };
      }) },
    });
  });
  return { pack: sections.length ? { format: Pack.FORMAT, version: Pack.VERSION, unit: doc.name, sections: sections } : null, unanswered: unanswered };
}

function detectFormat(name, content) {
  if (/\.(?:html?|xhtml)$/i.test(name || '')) return 'html';
  if (/\.(?:md|markdown|txt)$/i.test(name || '')) return 'markdown';
  return /^\s*(?:<!doctype html|<html|<head|<body)/i.test(content || '') ? 'html' : 'markdown';
}

/* → { success, format, study: { name, text, parsed }, summary } */
function parseStudyFile(content, name) {
  try {
    var format = detectFormat(name, content);
    var parsed = format === 'html' ? parseHTML(content) : parseMarkdown(content);
    var text = studyText(parsed);
    if (!words(text).length) return { success: false, error: 'No study text was found in this file' };
    var answered = parsed.questions.filter(function (q) { return q.answer >= 0 && q.answer < q.options.length; }).length;
    return {
      success: true, format: format,
      study: { name: parsed.title, text: text, parsed: parsed },
      summary: { unit: parsed.title, teaching_points: parsed.points.length, questions: answered,
                 unanswered: parsed.questions.length - answered, tables: parsed.tables.length, words: words(text).length },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

var api = { parseMarkdown: parseMarkdown, htmlToMarkdown: htmlToMarkdown, parseHTML: parseHTML, studyText: studyText,
            packFor: packFor, detectFormat: detectFormat, parseStudyFile: parseStudyFile };
root.MemStudyImport = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
