/* ═══════════════════════════════════════════════════════════════════════════
   sheet.js — a lesson laid out to be remembered.

   PURE. The lesson (coach.js or a model) is a big idea, key points, numbers
   and mnemonics; this arranges them the way a clinical text is learned and
   examined:
     · KEY POINTS UNDER CLINICAL HEADINGS — definition, causes, mechanism,
       presentation, diagnosis, treatment, complications — by each point's own
       words (ask.js's headingOf), in that order. A frame the student already
       carries makes a list of sentences into a map.
     · NUMBERS AS TILES — "Severe stenosis: peak velocity ≥ 4 m/s · mean
       gradient ≥ 40 mmHg · valve area < 1.0 cm²" — the value large, what it
       measures under it, instead of the sentence they hide in.
     · NOTHING TWICE — the big idea is not repeated as point 1, nor a
       point already shown as number tiles.
   Every word still comes from the lesson; nothing is reworded except the
   comparison words ("at least" → "≥") and "cm2" → "cm²".
   tests/verify-memorizer-sheet-pure.js holds it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var Ask = root.MemAsk || (typeof require === 'function' ? require('./ask.js') : null);
function coach() { return root.MemCoach || (typeof require === 'function' ? require('./coach.js') : null); }

var CMP = [
  [/^(?:at least|greater than or equal to|no less than|≥)$/i, '≥'],
  [/^(?:at most|less than or equal to|no more than|≤)$/i, '≤'],
  [/^(?:greater than|more than|above|over|exceeds|exceeding|>)$/i, '>'],
  [/^(?:less than|below|under|<)$/i, '<'],
];
var UNIT = '%|percent|mmHg|mm Hg|mm|cm2|cm²|cm|m/s|ms|msec|mL/m2|mL/m²|mL|L/min|bpm|beats per minute|mg/dL|mmol/L|mg|g/dL|g|kg|hours?|days?|weeks?|months?|years?';
var VALUE = new RegExp('(at least|at most|greater than or equal to|less than or equal to|no less than|no more than|greater than|more than|less than|above|below|over|under|exceeds|exceeding|[≥≤<>])?\\s*' +
  '(\\d+(?:\\.\\d+)?(?:\\s*(?:–|-|to)\\s*\\d+(?:\\.\\d+)?)?)\\s*(' + UNIT + ')?(?![\\w/])(\\s+or\\s+(?:less|lower|more|greater|higher))?', 'gi');
var LEADING = /^(?:(?:and|or|but|when|if|while|whereas|with|a|an|the|its|their)\s+)+/i;
var TRAILING = /(?:\s+(?:of|is|are|was|were|falls|fall|rises|rise|reaches|reach|drops|drop|remains|to|by|at|in|than|be|being))+$/i;
var SUBJECT = /^(.{3,60}?)\s+(?:is|are)\s+(?:defined|diagnosed|advised|indicated|recommended|present|suggested)\b|^([^:]{3,60}):/i;
var MAX_LABEL_WORDS = 6;

function symbol(word, after) {
  if (after) return /less|lower/i.test(after) ? '≤' : '≥';
  if (!word) return '';
  for (var i = 0; i < CMP.length; i++) if (CMP[i][0].test(word.trim())) return CMP[i][1];
  return '';
}
function unitOf(u) {
  if (!u) return '';
  return u.replace(/^percent$/i, '%').replace(/m2$/, 'm²').replace(/^mm Hg$/i, 'mmHg').replace(/^beats per minute$/i, 'bpm');
}

/* A sentence's numbers as tiles: { subject, tiles:[{ label, value }] }. A
   number with neither a unit nor a comparison ("1 of 3", "class 2") is not
   a tile: it is not a value to learn. */
function numberTiles(text) {
  var s = String(text || ''), tiles = [], last = 0, m;
  var sm = SUBJECT.exec(s);
  var subject = sm ? (sm[1] || sm[2]).replace(LEADING, '').trim() : '';
  VALUE.lastIndex = 0;
  while ((m = VALUE.exec(s))) {
    if (!m[0].trim()) { VALUE.lastIndex++; continue; }
    var sym = symbol(m[1], m[4]), unit = unitOf(m[3]);
    var before = s.slice(last, m.index);
    last = m.index + m[0].length;
    if (!sym && !unit) continue;
    var clause = before.split(/[,;:()]|\s(?:or|and|when|if|whereas|while)\s/).pop();
    var label = clause.trim().replace(/^.*\b(?:is|are) defined by\s+/i, '').replace(LEADING, '').replace(TRAILING, '').trim();
    var words = label.split(/\s+/).filter(Boolean);
    if (words.length > MAX_LABEL_WORDS) label = words.slice(-MAX_LABEL_WORDS).join(' ');
    if (!label || label.toLowerCase() === subject.toLowerCase()) label = subject || label;
    tiles.push({ label: label, value: (sym ? sym + ' ' : '') + m[2].replace(/\s*(?:–|-|to)\s*/, '–') + (unit ? (unit === '%' ? '' : ' ') + unit : '') });
  }
  return { subject: subject, tiles: tiles };
}

/* The lesson as a study sheet. */
function sheetOf(lesson) {
  var L = lesson || {};
  var big = String(L.overview || '').trim();
  var norm = function (t) { return String(t).replace(/\s+/g, ' ').replace(/[.\s]+$/, '').toLowerCase(); };
  var numbers = (L.numbers || []).map(function (n) {
    var t = numberTiles(n.text);
    return { subject: t.subject, tiles: t.tiles, page: n.page, text: n.text };
  }).filter(function (n) { return n.tiles.length; });
  /* A point shown as tiles is not shown again as a sentence. */
  var tiled = numbers.map(function (n) { return norm(n.text); });
  var points = (L.points || []).filter(function (p) { return (!big || norm(p.text) !== norm(big)) && tiled.indexOf(norm(p.text)) === -1; });
  if (!big && points.length) { big = points[0].text; points = points.slice(1); }
  var order = Ask.HEADINGS.map(function (h) { return h[0]; }).concat([Ask.OTHER]);
  var groups = order.map(function (name) {
    return { heading: name === Ask.OTHER ? 'Also know' : name, points: points.filter(function (p) { return Ask.headingOf(p.text) === name; }) };
  }).filter(function (g) { return g.points.length; });
  return { bigIdea: big, groups: groups, numbers: numbers };
}

/* A section at a glance, the way a teacher draws it on the board:
     · key facts — "the most common cause of …", each its answer large and
       what it is under it;
     · the pathway — the longest chain of the section's own cause and
       effect, left to right, each arrow the verb the book used;
     · its lists — each a box of its items, except a list that already has
       a mnemonic (`hooked`: the lesson's mnemonic titles), shown there.
   All of it the book's words; nothing when the section has none of them. */
var MAX_FACTS = 3, MAX_LISTS = 3, MAX_ITEMS = 6;
function glance(cluster, hooked) {
  var K = coach();
  var facts = K.patternQuestions(cluster).filter(function (q) { return q.kind === 'most'; }).slice(0, MAX_FACTS).map(function (q) {
    return { title: q.answer, sub: q.question.replace(/^What is /, '').replace(/\?$/, ''), page: q.page };
  });
  var f = K.flow(cluster), byId = {};
  f.nodes.forEach(function (n) { byId[n.id] = n; });
  var longest = K.paths(f).sort(function (a, b) { return b.length - a.length; })[0] || [];
  var pathway = longest.length >= 2 ? longest.map(function (st) { return st.start != null ? { label: byId[st.start].label } : { verb: st.verb, label: byId[st.to].label }; }) : [];
  var lists = K.lists(cluster).filter(function (l) { return l.items.length >= 2 && (hooked || []).indexOf(l.title) === -1; }).slice(0, MAX_LISTS).map(function (l) {
    return { title: l.title, items: l.items.slice(0, MAX_ITEMS).map(function (i) { return i.label; }), more: Math.max(0, l.items.length - MAX_ITEMS), page: l.page };
  });
  return facts.length || pathway.length || lists.length ? { facts: facts, pathway: pathway, lists: lists } : null;
}

var MemSheet = { MAX_LABEL_WORDS: MAX_LABEL_WORDS, MAX_FACTS: MAX_FACTS, MAX_LISTS: MAX_LISTS, MAX_ITEMS: MAX_ITEMS, numberTiles: numberTiles, sheetOf: sheetOf, glance: glance };
root.MemSheet = MemSheet;
if (typeof module !== 'undefined' && module.exports) module.exports = MemSheet;
})(typeof window !== 'undefined' ? window : this);
