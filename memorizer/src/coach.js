/* ═══════════════════════════════════════════════════════════════════════════
   coach.js — the built-in coach: the whole protocol with no AI, no key and no
   network.

   Written because the keyed providers failed a real user on first contact —
   Gemini "high demand", Groq rejecting the key — and a study app that cannot
   start a session until a third-party account works is not one you can rely
   on the night before an exam. This is the default now; Claude is an
   optional upgrade.

   PURE. The same five functions, with the same arguments, as the prompt
   builders in prompts.js — encode, recall, gradeRecall, gradeExplain,
   gauntlet — and each returns an object in the SAME schema the model is held
   to (MemPrompts.SCHEMAS). The session, the store and the screens cannot tell
   which coach produced a step. tests/verify-memorizer-coach-pure.js checks
   every output against those schemas.

   WHAT IT DOES, AND WHAT IT CANNOT:
     · encode   picks the section's key sentences — VERBATIM, with their pages.
                It invents nothing, so it can never teach you something your
                PDF does not say. The memory hook is the first letters of each
                point's key term. No flowchart: drawing one needs to understand
                the text, which this does not.
     · recall   fill-in-the-blank on each key sentence, hiding its key term —
                a number when there is one, since numbers are what exams test.
     · grading  by matching words: exact, a typo in a long word, or a plural
                or tense away. A synonym is marked wrong; the screen offers
                "count it as correct" for exactly that.
     · teach-back  scored by how many key points your explanation touches,
                judged by their key terms. It cannot tell a right explanation
                from a wrong one that uses the same words.
     · gauntlet fill-in-the-blank on sentences recall did not use, and on
                different words of the ones it did, weighted to your weakest
                sections.

   Same syntax floor as src/: nothing Safari on iPadOS 13.4 cannot parse.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var STOP = {};
('a about above after again against all also am an and any are as at be because been before being below ' +
 'between both but by can could did do does doing down during each either else few for from further had ' +
 'has have having he her here hers him his how i if in into is it its itself just may me might more most ' +
 'much must my no nor not now of off often on once only or other our ours out over own per rather same ' +
 'shall she should so some such than that the their theirs them then there these they this those though ' +
 'through thus to too under until up upon us very was we were what when where whether which while who whom ' +
 'whose why will with within without would yet you your yours one two three first second also however ' +
 'usually generally typically include includes including called known using used use may can see figure ' +
 'table chapter section page example eg ie etc').split(' ').forEach(function (w) { STOP[w] = true; });

var SENTENCE_END = /[.!?]["'”’)\]]*$/;
var CAUSAL = /\b(is|are|means|defined|refers|causes?|leads?|results?|because|therefore|due|increases?|decreases?|reduces?|occurs?|requires?|indicates?)\b/i;
var NUM = /^\d+(?:[.,]\d+)?%?$/;
var DEFINITION = /^(?:\S+\s+){0,5}(?:is|are|refers to|means|is defined as)\s/i;
/* "X is the most common cause of Y": the single highest-yield sentence shape
   in a clinical text, and a question in its own right. */
var MOST = /\b(?:is|are|remains?|represents?)\s+(?:by far\s+)?the\s+most\s+(?:common|frequent|important)\s+/i;

/* Words: split on spaces, dashes and slashes, so "leaflets—septal" is two
   words (the owner's hook once offered "leaflets—septal" as one). */
function toks(text) { return String(text || '').split(/[\s\u2014\u2013\/]+/).filter(Boolean); }

/* Words that are almost never the thing being taught — the connective
   tissue of academic prose. Seen in the owner's first hook: "lists",
   "accounting". A penalty, not a ban: a sentence with nothing else still
   gets a blank. */
var GENERIC = {};
('list lists listed accounting account accounts consider considered revealed reveal reveals connected connecting ' +
 'remainder following shown show shows known noted seen found given based related relative associated importance important ' +
 'commonly usually typically generally often rarely frequently patients patient cases case studies study recent recently ' +
 'result results resulting approximately especially particularly respectively however therefore various several certain ' +
 'present presents presented occur occurs occurring involve involves involved include includes included approach term terms ' +
 'number numbers level levels degree type types form forms part parts setting settings process processes people ' +
 'somewhat compared comparison described describe describes discussed discuss later earlier above below').split(' ')
  .forEach(function (w) { GENERIC[w] = true; });
/* Endings that mark a technical term: a disease, a procedure, a drug class. */
var TECH = /(?:itis|osis|oses|emia|aemia|pathy|ectomy|otomy|ostomy|plasty|gram|graphy|scopy|algia|megaly|trophy|plasia|genic|lytic|ase|ases|ine|ines|ide|ides|olol|pril|sartan|statin|mab|nib|azole|mycin|cillin|cardia|stenosis|sclerosis|thrombo\w*|valv\w*|atrial|ventricul\w*|arterial|venous|pulmonary|coronary|aortic|mitral|tricuspid|annul\w*|syndrome|disease|anomal\w*|atresia|failure|infarct\w*|ischaemi\w*|ischemi\w*|regurgitation|dilat\w*|hypertroph\w*|carcino\w*|malignan\w*|endocarditis|echocardiogra\w*)$/;

/* Terms a section defines as abbreviations — "rheumatic heart disease
   (RHD)" — and the words of their expansions. Both are terms by the
   section's own say-so. */
function defined(cluster) {
  var out = {};
  (cluster.segments || []).forEach(function (seg) {
    var re = /((?:[A-Za-z][A-Za-z\-]+\s+){1,5})\(([A-Z]{2,6})\)/g, m;
    while ((m = re.exec(seg.text))) {
      out[m[2].toLowerCase()] = true;
      toks(m[1]).slice(-m[2].length).forEach(function (w) { var b = bare(w); if (isContent(b)) out[stem(b)] = true; });
    }
  });
  return out;
}

function bare(w) { return String(w).toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9%]+$/g, ''); }
function isContent(b) { return b.length >= 4 && !STOP[b] && /[a-z]/.test(b); }
function stem(b) { return b.replace(/(?:ies|es|s|ed|ing|ly)$/, '').replace(/(.)\1$/, '$1'); }

/* The section's sentences, each with its page. Headings are titles, not
   teaching material, and are left out. */
function sentences(cluster) {
  var out = [];
  (cluster.segments || []).forEach(function (seg) {
    /* Headings are titles and tables are grids — neither is a sentence. A
       table's own questions come from tableQuestions() below. */
    if (seg.heading || seg.table) return;
    var cur = [];
    String(seg.text).split(/\s+/).filter(Boolean).forEach(function (w, i, all) {
      cur.push(w);
      if (SENTENCE_END.test(w) || i === all.length - 1) { out.push({ text: cur.join(' '), page: seg.page }); cur = []; }
    });
  });
  return out.map(function (s, i) { s.index = i; return s; });
}

/* How often each content word appears in the section, by stem: what the
   section keeps coming back to is what it is about. */
function frequencies(cluster) {
  var f = {};
  sentences(cluster).forEach(function (s) {
    toks(s.text).forEach(function (w) {
      var b = bare(w);
      if (isContent(b)) f[stem(b)] = (f[stem(b)] || 0) + 1;
    });
  });
  return f;
}

function titleStems(cluster) {
  var t = {};
  String(cluster.title || '').split(/\s+/).forEach(function (w) { var b = bare(w); if (b) t[stem(b)] = true; });
  return t;
}

/* The words of a sentence ranked by how much they belong to THIS sentence:
   numbers first (they are what exams test), then content words that the
   section uses rarely — the word that makes this sentence this sentence,
   not the section's topic, which every sentence shares. A title word counts
   half (hiding the topic's own name is too easy); longer beats shorter.

   The first version ranked by how OFTEN the section used a word, which is
   the opposite, and the suite caught both consequences: the blanks were
   "stretch, stretches, volume, volume, preload", and a teach-back of half
   the points scored 80, because every point's key words were the same few
   the whole section repeats. */
/* On top of that, TERMNESS — whether a word names the thing being taught:
   a technical ending, a term the section defines (with its abbreviation),
   a capitalised word mid-sentence (Ebstein, Whipple, Fabry) all count up;
   the connective words of academic prose, and -ly adverbs, count down. */
function rankedTerms(text, freq, title, terms) {
  var seen = {}, out = [];
  var ws = toks(text);
  ws.forEach(function (w, pos) {
    var b = bare(w);
    if (!b || seen[b]) return;
    if (NUM.test(b)) { seen[b] = true; out.push({ word: b, score: 1000 + b.length, pos: pos, num: true }); return; }
    if (!isContent(b)) return;
    seen[b] = true;
    var s = (1 / (freq[stem(b)] || 1)) * (title[stem(b)] ? 0.5 : 1);
    var bonus = 0;
    if (TECH.test(b)) bonus += 1.5;
    if (terms && (terms[b] || terms[stem(b)])) bonus += 1.5;
    if (pos > 0 && /^[A-Z][a-z]{3,}/.test(w.replace(/^[^A-Za-z]+/, '')) && !/[.!?:]$/.test(ws[pos - 1])) bonus += 1;
    if (GENERIC[b] || GENERIC[stem(b)]) bonus -= 2;
    else if (/ly$/.test(b) && !TECH.test(b)) bonus -= 1;
    out.push({ word: b, score: s + bonus + b.length / 40, pos: pos, num: false });
  });
  out.sort(function (a, b) { return b.score - a.score || a.pos - b.pos; });
  return out;
}

/* The best-ranked term whose stem is not already taken, so no two points
   share a hook letter's word and no two questions blank the same word. */
function freshTerm(ranked, used, noNumbers) {
  for (var i = 0; i < ranked.length; i++) {
    var t = ranked[i];
    if (noNumbers && t.num) continue;
    if (!used[stem(t.word)]) { used[stem(t.word)] = true; return t; }
  }
  return null;
}

function scoreSentence(s, freq) {
  var ws = toks(s.text);
  var sum = 0;
  ws.forEach(function (w) { var b = bare(w); if (isContent(b)) sum += freq[stem(b)] || 0; });
  /* Multipliers, not additions: a flat bonus was small beside the frequency
     sum and a sentence stating a threshold ("below 12 mmHg") lost to
     sentences that merely repeated the topic. */
  var mult = (ws.some(function (w) { return NUM.test(bare(w)); }) ? 1.6 : 1) * (CAUSAL.test(s.text) ? 1.2 : 1) *
             (MOST.test(s.text) ? 1.8 : 1);
  return (sum / Math.sqrt(ws.length)) * mult;
}

/* The sentence with one word replaced by a blank, and that word. */
/* The first whole-word occurrence of term, blanked — found by pattern, so a
   term inside "leaflets—septal" or "(RHD)" is found too. */
function cloze(text, term) {
  var esc = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('(^|[^A-Za-z0-9])' + esc + '(?![A-Za-z0-9])', 'i');
  return String(text).replace(re, function (all, pre) { return pre + '_____'; });
}

/* ── the five steps ──────────────────────────────────────────────────────── */

function keySentences(cluster) {
  var freq = frequencies(cluster);
  var all = sentences(cluster);
  var usable = all.filter(function (s) { var n = s.text.split(/\s+/).length; return n >= 6 && n <= 60; });
  if (!usable.length) usable = all.filter(function (s) { return s.text.split(/\s+/).length >= 3; });
  /* 3..7 points, about one for every five sentences: enough to carry a
     section, few enough to hold in mind at once. (It was 5..9, and a short
     section came out as nine near-sentences — the owner asked for smaller.) */
  var k = Math.max(1, Math.min(7, Math.max(3, Math.round(all.length / 5)), usable.length));
  var byScore = usable.slice().sort(function (a, b) { return scoreSentence(b, freq) - scoreSentence(a, freq) || a.index - b.index; });
  /* A sentence that states a number — a threshold, a dose, a percentage —
     is taken first, up to half the points, whatever its words score: its
     words are often rare in the section (so it scores low), and it is
     exactly what an exam asks. */
  var hasNum = function (s) { return s.text.split(/\s+/).some(function (w) { return NUM.test(bare(w)); }); };
  var picked = byScore.filter(hasNum).slice(0, Math.ceil(k / 2));
  /* So is the section's first DEFINITION — "X is …", "X refers to …" near
     the start of the sentence. It is the first thing an exam asks, and it is
     often plainly worded, so it too can score low. The screenshot of the
     first built-in session showed "Preload is the stretch on ventricular
     myocytes at the end of diastole" left out of the Preload section. */
  var def = usable.filter(function (s) { return DEFINITION.test(s.text); })[0];
  if (def && picked.indexOf(def) === -1) picked.unshift(def);
  byScore.forEach(function (s) { if (picked.length < k && picked.indexOf(s) === -1) picked.push(s); });

  return picked.sort(function (a, b) { return a.index - b.index; });
}

function encode(cluster) {
  var freq = frequencies(cluster), title = titleStems(cluster), terms = defined(cluster);
  var picked = keySentences(cluster);
  var used = {};
  var hooks = picked.map(function (s) {
    var t = freshTerm(rankedTerms(s.text, freq, title, terms), used, true);
    return t ? t.word : '';
  }).filter(Boolean);
  var letters = hooks.map(function (w) { return w[0].toUpperCase(); }).join('');
  /* A list is what an acrostic is FOR: when the section has one of three to
     nine items, the hook is its items' first letters — "Acquired causes of
     TS: R·I·N·P·C…" — rather than one word from each point. */
  var list = lists(cluster).filter(function (l) { return l.items.length >= 3 && l.items.length <= 9; })
    .sort(function (a, b) { return b.items.length - a.items.length; })[0];
  var mnemonic = '';
  if (list) {
    var labels = list.items.map(function (i) { return i.label.replace(/\./g, ''); });
    mnemonic = 'First letters of ' + list.title + ': ' + labels.map(function (w) { return w.charAt(0).toUpperCase(); }).join('') +
      ' \u2014 ' + labels.join(' \u00B7 ') + '. Say the letters, then name each one.';
  } else if (hooks.length >= 2) {
    mnemonic = 'First letters: ' + letters + ' \u2014 ' + hooks.join(' \u00B7 ') + '. Say the letters, then say what each word stands for in this section.';
  }
  return {
    points: picked.map(function (s) { return { text: s.text, page: s.page }; }),
    mnemonic: mnemonic,
    flowchart: '',
  };
}

/* ── tables ────────────────────────────────────────────────────────────────
   A table asks itself questions: given the row's label and the column's
   header, what is in the cell? Numbers first — a table of values is where a
   section keeps them. Needs a header row and at least one data row. */
function tableQuestions(cluster, limit) {
  var out = [];
  (cluster.segments || []).forEach(function (seg) {
    if (!seg.table || out.length >= limit) return;
    var header = seg.tableHeader || seg.table[0];
    var rows = seg.tableHeader ? seg.table : seg.table.slice(1);
    var cells = [];
    rows.forEach(function (row) {
      for (var ci = 1; ci < row.length; ci++) {
        var cell = String(row[ci] || '').trim();
        if (!cell || !row[0] || !header[ci]) continue;
        var toks = cell.split(/\s+/).map(bare).filter(Boolean);
        var num = toks.filter(function (t) { return NUM.test(t); })[0];
        var word = num || toks.filter(isContent)[0];
        if (word) cells.push({ row: row[0], col: header[ci], cell: cell, word: word, num: !!num });
      }
    });
    cells.sort(function (a, b) { return (b.num ? 1 : 0) - (a.num ? 1 : 0); });
    cells.slice(0, limit - out.length).forEach(function (c) {
      out.push({ question: 'From the table: ' + c.row + ' \u2014 ' + c.col + ': ' + cloze(c.cell, c.word),
                 answer: c.word, page: seg.page });
    });
  });
  return out;
}

/* ── flow ──────────────────────────────────────────────────────────────────
   A flowchart built from the section's own cause-and-effect sentences:
   "A raises B", "B leads to C", "…, resulting in D". Every box is words
   of the sentence it came from; every arrow is the verb that sentence used.
   Boxes that name the same thing ("pulmonary venous pressure", "venous
   pressure") are merged, which is what turns separate sentences into a
   chain. Nothing is inferred: a link that no sentence states is not drawn. */
var CAUSE = /\b(leads? to|lead to|results? in|causes?|triggers?|produces?|increases?|decreases?|raises?|lowers?|reduces?|activates?|inhibits?|stimulates?|promotes?|impairs?|worsens?|improves?|leading to|resulting in|causing|triggering|producing)\b/i;
var CLAUSE_END = /[,;:.]|\s(?:and|but|while|whereas|because|since|which|who|when|by|through|via|so|although|unless|in order)\s/i;
var LEADING = /^(?:the|a|an|this|these|that|those|its|their|such)\s+/i;
/* A box label from a stretch of sentence. The owner's first real flowchart
   had "(TS) and tricuspid regur gitation (TR) can" and "myxoma and
   metastases)—Usually" as boxes: parentheses cut in half, a dash, a modal
   verb left on the end. So: asides in brackets go whole, a label is cut at a
   dash or a stray bracket, and modal verbs, adverbs and conjunctions are
   trimmed from its ends. A label that is still long, or has no content word,
   is no label — the arrow is not drawn. */
var MODAL_END = /\s+(?:can|may|might|could|will|would|should|must|often|usually|typically|commonly|also|then|generally|frequently|rarely|further|thus|therefore|which|that|who)$/i;
var CONJ_START = /^(?:and|or|but|both|either|neither|which|that|who|whereas|while|then|also|usually|often|typically)\s+/i;
function phrase(text, fromEnd, max) {
  var t = String(text).replace(/\([^()]*\)/g, ' ').replace(/\[[^\[\]]*\]/g, ' ');
  /* whatever lies across a dash or a stray bracket from the verb is another clause */
  var parts = t.split(/\s*[\u2014\u2013()\[\]]\s*|\s-\s/);
  t = fromEnd ? parts[parts.length - 1] : parts[0];
  var ws = t.replace(/^[\s,;:]+|[\s,;:.]+$/g, '').split(/\s+/).filter(Boolean);
  ws = fromEnd ? ws.slice(-max) : ws.slice(0, max);
  var out = ws.join(' ');
  var guard = 0;
  while (guard++ < 6 && (LEADING.test(out) || CONJ_START.test(out) || MODAL_END.test(out))) {
    out = out.replace(LEADING, '').replace(CONJ_START, '').replace(MODAL_END, '');
  }
  out = out.replace(/[.,;:]+$/, '').trim();
  if (out.split(/\s+/).length > 6) return '';
  return out;
}
function stemsOf(label) {
  var out = {};
  String(label).split(/\s+/).forEach(function (w) { var b = bare(w); if (isContent(b)) out[stem(b)] = true; });
  return out;
}
function sameThing(a, b) {
  var ka = Object.keys(stemsOf(a)), kb = stemsOf(b);
  var nb = Object.keys(kb).length;
  if (!ka.length || !nb) return false;
  var both = ka.filter(function (k) { return kb[k]; }).length;
  return both / Math.min(ka.length, nb) >= 0.6;
}
function flow(cluster) {
  var nodes = [], edges = [];
  function node(label, page) {
    if (!label || !Object.keys(stemsOf(label)).length) return -1;
    for (var i = 0; i < nodes.length; i++) if (sameThing(nodes[i].label, label)) return i;
    if (nodes.length >= 10) return -1;
    nodes.push({ id: nodes.length, label: label, page: page });
    return nodes.length - 1;
  }
  function edge(a, verb, b) {
    if (a < 0 || b < 0 || a === b) return;
    if (edges.some(function (e) { return e.from === a && e.to === b; })) return;
    edges.push({ from: a, to: b, verb: verb.toLowerCase() });
  }
  sentences(cluster).forEach(function (s) {
    var rest = s.text, subject = null, m;
    var guard = 0;
    while ((m = CAUSE.exec(rest)) && guard++ < 4) {
      var before = rest.slice(0, m.index), after = rest.slice(m.index + m[0].length);
      var participle = /ing\b/i.test(m[1]) && /,\s*$/.test(before);
      /* The subject is the end of what precedes the verb, after its last
         comma — "When preload rises, the ventricle stretches" starts at
         "the ventricle". A participle ("…, leading to C") takes the
         previous object as its subject instead. */
      var subj;
      if (participle && subject != null) subj = subject.lastObject;
      else subj = phrase(before.split(/[,;:]/).pop(), true, 7);
      var endAt = after.search(CLAUSE_END);
      var obj = phrase(endAt === -1 ? after : after.slice(0, endAt), false, 7);
      var a = node(subj, s.page), b = node(obj, s.page);
      edge(a, m[1], b);
      subject = { label: subj, lastObject: obj };
      rest = endAt === -1 ? '' : after.slice(endAt);
      /* "A raises B and causes C": the "and" keeps A as the subject. */
      if (/^\s*and\s/i.test(rest) && CAUSE.test(rest.slice(0, 40))) {
        var mm = CAUSE.exec(rest);
        if (mm && /^\s*and\s*$/i.test(rest.slice(0, mm.index))) {
          var obj2End = rest.slice(mm.index + mm[0].length).search(CLAUSE_END);
          var tail2 = rest.slice(mm.index + mm[0].length);
          var obj2 = phrase(obj2End === -1 ? tail2 : tail2.slice(0, obj2End), false, 7);
          edge(node(subj, s.page), mm[1], node(obj2, s.page));
          subject = { label: subj, lastObject: obj2 };
          rest = obj2End === -1 ? '' : tail2.slice(obj2End);
        }
      }
    }
  });
  /* Only CONNECTED pieces are a flow. Two unrelated "A causes B" pairs side
     by side — what the owner's first flowchart was — teach less than the
     sentences did. A piece is kept when it links at least three boxes. */
  var parent = {};
  var find = function (x) { while (parent[x] !== undefined && parent[x] !== x) x = parent[x]; return x; };
  edges.forEach(function (e) { parent[e.from] = parent[e.from] === undefined ? e.from : parent[e.from]; parent[e.to] = parent[e.to] === undefined ? e.to : parent[e.to]; });
  edges.forEach(function (e) { var a = find(e.from), b = find(e.to); if (a !== b) parent[a] = b; });
  var size = {};
  Object.keys(parent).forEach(function (k) { var r = find(+k); size[r] = (size[r] || 0) + 1; });
  edges = edges.filter(function (e) { return size[find(e.from)] >= 3; });
  var used = {};
  edges.forEach(function (e) { used[e.from] = true; used[e.to] = true; });
  return { nodes: nodes.filter(function (n) { return used[n.id]; }), edges: edges };
}

/* Paths through the flow for drawing it top to bottom: from each box nothing
   points into, follow the arrows. A box with two arrows out starts two
   paths. Cycles are cut where they close. */
function paths(f) {
  var into = {}, out = {};
  f.edges.forEach(function (e) { into[e.to] = true; (out[e.from] = out[e.from] || []).push(e); });
  var roots = f.nodes.filter(function (n) { return !into[n.id]; }).map(function (n) { return n.id; });
  if (!roots.length && f.nodes.length) roots = [f.nodes[0].id];
  var res = [];
  function walk(id, path, seen) {
    var next = (out[id] || []).filter(function (e) { return !seen[e.to]; });
    if (!next.length) { res.push(path); return; }
    next.forEach(function (e) {
      var s2 = {}; Object.keys(seen).forEach(function (k) { s2[k] = true; }); s2[e.to] = true;
      walk(e.to, path.concat([{ verb: e.verb, to: e.to }]), s2);
    });
  }
  roots.forEach(function (r) { var sn = {}; sn[r] = true; walk(r, [{ start: r }], sn); });
  return res.slice(0, 6);
}

/* ── lists ─────────────────────────────────────────────────────────────────
   The section's lists (chunk.js marks their items), each split at its
   sub-headings, titled from the sentence that introduces it: "Table 17.1
   lists the causes of TS" + sub-heading "Acquired" → "Acquired causes of
   TS". Every word of a title is a word of the section. */
function label(text) {
  var t = String(text).split(/\s*(?:\(|\u2014|\u2013|,|;|:|\s-\s)/)[0].trim();
  var ws = t.split(/\s+/);
  return ws.slice(0, 5).join(' ').replace(/[.]+$/, '');
}
function topicOf(sentence) {
  var m = /\b(?:lists?|shows?|summari[sz]es?|includes?|are|is)\s+(?:the\s+)?((?:main\s+|major\s+|common\s+)?(?:causes?|features?|signs?|symptoms?|types?|indications?|contraindications?|complications?|findings?|risk factors?|treatments?|options?|criteria|agents?|drugs?|classes?)\b[^.:;]*)/i.exec(sentence || '');
  return m ? m[1].replace(/\s+(?:below|as follows)$/i, '').trim() : '';
}
function lists(cluster) {
  var segs = cluster.segments || [], out = [];
  var cur = null, intro = '';
  segs.forEach(function (seg, i) {
    if (!seg.item) {
      if (!seg.heading && !seg.table) {
        var ss = sentences({ segments: [seg] });
        intro = ss.length ? ss[ss.length - 1].text : intro;
      }
      cur = null;
      return;
    }
    var topic = topicOf(intro) || String(cluster.title || '').replace(/\s*\(cont\.\)$/, '');
    if (seg.sub) {
      cur = { title: label(seg.text) + ' ' + topic.replace(/^the\s+/i, ''), items: [], page: seg.page, list: seg.list };
      out.push(cur);
      return;
    }
    if (!cur || cur.list !== seg.list) { cur = { title: topic, items: [], page: seg.page, list: seg.list }; out.push(cur); }
    cur.items.push({ text: seg.text, label: label(seg.text), page: seg.page });
  });
  return out.filter(function (l) { return l.items.length >= 2; });
}

/* ── questions that ask, rather than blank ─────────────────────────────────
   "Rheumatic heart disease (RHD) is the most common cause of TS" →
   "What is the most common cause of TS?" and "Preload is the stretch on …"
   → "What is preload?". The answer is the section's own words. */
function patternQuestions(cluster) {
  var out = [];
  sentences(cluster).forEach(function (s) {
    var t = s.text.replace(/^(?:\(?\d{1,2}[.)]|[IVX]+\.|[A-H]\.)\s+/, '');
    var m = /^(.{3,90}?)\s+(?:is|are|remains?|represents?)\s+(?:by far\s+)?the\s+most\s+(common|frequent|important)\s+([^,.;]{3,80})/i.exec(t);
    if (m && m[1].split(/\s+/).length <= 10) {
      out.push({ question: 'What is the most ' + m[2].toLowerCase() + ' ' + m[3].trim() + '?', answer: m[1].trim(), page: s.page, kind: 'most' });
      return;
    }
    var d = /^((?:[A-Za-z][\w\-]*\s+){0,4}[A-Za-z][\w\-]*(?:\s+\([A-Z]{2,6}\))?)\s+(?:is|are|refers to|is defined as|are defined as|means)\s+(.{12,160}?)(?:[.;]|,\s+(?:which|and|but)\s|$)/.exec(t);
    if (d && !/^(?:this|that|it|there|these|those|which|the\s+(?:most|first|only))\b/i.test(d[1]) && !MOST.test(t) &&
        /^(?:a|an|the)\s/i.test(d[2])) {
      var term = d[1].replace(/^(?:the|a|an)\s+/i, '');
      /* "Preload" opens its sentence with a capital; the question reads it as
         a term. An abbreviation or a name (second letter a capital) is kept. */
      if (/^[A-Z][a-z]/.test(term)) term = term.charAt(0).toLowerCase() + term.slice(1);
      out.push({ question: 'What is ' + term + '?', answer: d[2].trim(), page: s.page, kind: 'define' });
    }
  });
  return out;
}

function recall(cluster, points) {
  var freq = frequencies(cluster), title = titleStems(cluster), terms = defined(cluster);
  var out = [], used = {}, usedSent = {};
  /* Asked questions first — "what is the most common …", "what is …" —
     then the section's biggest list, then blanks. Six at most. */
  patternQuestions(cluster).slice(0, 2).forEach(function (q) { out.push({ question: q.question, answer: q.answer, page: q.page }); });
  var big = lists(cluster).sort(function (a, b) { return b.items.length - a.items.length; })[0];
  if (big && big.items.length >= 3) {
    out.push({ question: 'Name the ' + big.title + ' (' + big.items.length + ').', answer: big.items.map(function (i) { return i.label; }).join('; '), page: big.page });
  }
  (points || []).forEach(function (p) {
    if (out.length >= 6) return;
    if (out.some(function (q) { return p.text.indexOf(q.answer) !== -1 && q.answer.split(' ').length > 1; })) return;
    var t = freshTerm(rankedTerms(p.text, freq, title, terms), used, false);
    if (!t) return;
    out.push({ question: (/^\d/.test(t.word) ? 'Fill in the number: ' : 'Fill in the blank: ') + cloze(p.text, t.word), answer: t.word, page: p.page });
  });
  tableQuestions(cluster, 2).forEach(function (q) { if (out.length < 7 && !used[stem(q.answer)]) { used[stem(q.answer)] = true; out.push(q); } });
  /* A section that is all table and no sentence still gets asked something. */
  return { prompts: out };
}

function lev(a, b) {
  var m = a.length, n = b.length, d = [];
  for (var i = 0; i <= m; i++) { d[i] = [i]; }
  for (var j = 1; j <= n; j++) d[0][j] = j;
  for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

/* Does the answer contain the word? Numbers must be exactly equal — 5 is not
   50. A word matches exactly, by stem (a plural or tense away), or within
   one typo when it is at least five letters long (two at nine or more). */
function matches(answer, word) {
  var target = bare(word);
  var toks = String(answer || '').split(/\s+/).map(bare).filter(Boolean);
  if (!target) return false;
  if (NUM.test(target)) {
    var tv = parseFloat(target.replace(',', '.'));
    return toks.some(function (t) { return NUM.test(t) && parseFloat(t.replace(',', '.')) === tv; });
  }
  return toks.some(function (t) {
    if (t === target) return true;
    if (target.length >= 4 && stem(t) === stem(target)) return true;
    if (target.length >= 5) return lev(t, target) <= (target.length >= 9 ? 2 : 1);
    return false;
  });
}

/* A phrase answer ("rheumatic heart disease (RHD)", "the stretch on
   ventricular myocytes at the end of diastole") is right when the answer
   carries most of its substance: its abbreviation alone, or three in five of
   its content words (all of them if it has two or fewer), with any number
   in it exact. */
function phraseMatch(answer, target) {
  var abbr = /\(([A-Z]{2,6})\)/.exec(target);
  if (abbr && new RegExp('\\b' + abbr[1] + '\\b').test(String(answer || ''))) return true;
  var core = target.replace(/\([^)]*\)/g, ' ');
  var words = [], seen = {};
  toks(core).forEach(function (w) { var b = bare(w); if ((isContent(b) || NUM.test(b)) && !seen[stem(b)]) { seen[stem(b)] = true; words.push(b); } });
  if (!words.length) return matches(answer, target);
  var nums = words.filter(function (w) { return NUM.test(w); });
  if (!nums.every(function (n) { return matches(answer, n); })) return false;
  var hit = words.filter(function (w) { return matches(answer, w); }).length;
  return words.length <= 2 ? hit === words.length : hit / words.length >= 0.6;
}
/* A list item is named when any of its SPECIFIC words is: "carcinoid" names
   "Carcinoid syndrome", "Whipple" names "Whipple disease". The generic head
   noun alone ("disease", "syndrome") names nothing. */
var HEADS = { disease: 1, syndrome: 1, failure: 1, anomaly: 1, disorder: 1, infection: 1, lesion: 1, condition: 1, therapy: 1, treatment: 1 };
function itemMatch(answer, item) {
  var ws = toks(item).map(bare).filter(function (b) { return (isContent(b) || NUM.test(b)) && !HEADS[b]; });
  if (!ws.length) return phraseMatch(answer, item);
  return ws.some(function (w) { return matches(answer, w); });
}
function gradeRecall(cluster, prompt, answer) {
  var said = String(answer || '').trim();
  var target = String(prompt.answer || '');
  /* A list: "a; b; c". Right when three in five items are named. */
  if (target.indexOf('; ') !== -1) {
    var items = target.split('; ');
    var named = items.filter(function (it) { return itemMatch(said, it); });
    var missing = items.filter(function (it) { return named.indexOf(it) === -1; });
    var okL = named.length / items.length >= 0.6;
    return { correct: okL, missing: missing, misconception: '',
      feedback: !said ? 'No answer given.' : 'You named ' + named.length + ' of ' + items.length + '.' +
        (missing.length ? ' Missing: ' + missing.join(', ') + '.' : ' All of them.') };
  }
  var ok = target.split(/\s+/).length > 1 ? phraseMatch(said, target) : matches(said, target);
  return {
    correct: ok,
    missing: ok ? [] : [target],
    misconception: '',
    feedback: ok ? 'Right.' : (said
      ? 'The answer was \u201C' + target + '\u201D. If you said the same thing in other words, count it as correct.'
      : 'No answer given \u2014 the answer was \u201C' + target + '\u201D.'),
  };
}

/* A point is covered when the explanation uses most of its key terms. */
function pointTerms(p, freq, title, terms) {
  return rankedTerms(p.text, freq, title, terms).slice(0, 3).map(function (t) { return t.word; });
}
function gradeExplain(cluster, points, explanation) {
  var freq = frequencies(cluster), title = titleStems(cluster), terms = defined(cluster);
  var gaps = [];
  var covered = 0;
  (points || []).forEach(function (p) {
    var pt = pointTerms(p, freq, title, terms);
    var hit = pt.filter(function (t) { return matches(explanation, t); }).length;
    if (pt.length && hit >= Math.min(2, pt.length)) covered++;
    else gaps.push({ point: p.text, page: p.page });
  });
  var n = (points || []).length;
  var score = n ? Math.round(100 * covered / n) : 0;
  return {
    score: score,
    gaps: gaps,
    misconceptions: numberSlips(cluster, explanation),
    feedback: score >= 80 ? 'You touched nearly every key point. Now say it again, faster.'
      : score >= 50 ? 'About half the key points came through. Re-read the ones listed, then explain it once more.'
      : 'Most key points were missing. Go back to Encode, read the points aloud, then try again from memory.',
  };
}

/* The one misconception words can catch: a wrong number. For each thing
   the student said that has a number in it, find the section sentence that
   shares the most of its words; if that sentence has numbers and none is
   theirs, it is said back to them with the page. */
function numberSlips(cluster, explanation) {
  var src = sentences(cluster).map(function (s) {
    var st = {}, nums = [];
    toks(s.text).forEach(function (w) { var b = bare(w); if (NUM.test(b)) nums.push(parseFloat(b)); else if (isContent(b)) st[stem(b)] = true; });
    return { s: s, st: st, nums: nums };
  });
  var out = [];
  String(explanation || '').split(/(?:[.;!?]\s+|\n+)/).forEach(function (said) {
    var mine = [], st = [];
    toks(said).forEach(function (w) { var b = bare(w); if (NUM.test(b)) mine.push(parseFloat(b)); else if (isContent(b)) st.push(stem(b)); });
    if (!mine.length || out.length >= 3) return;
    var best = null, bestN = 0;
    src.forEach(function (x) {
      var n = st.filter(function (k) { return x.st[k]; }).length;
      if (x.nums.length && n > bestN) { bestN = n; best = x; }
    });
    if (best && bestN >= 2 && !mine.some(function (v) { return best.nums.indexOf(v) !== -1; })) {
      out.push('You said ' + mine.join(', ') + '; the PDF says: \u201C' + best.s.text + '\u201D (p.' + best.s.page + ')');
    }
  });
  return out;
}

function gauntlet(clusters, pointsByCluster, focus, n) {
  var want = Math.max(1, n || 5);
  var fromFocus = [], fromRest = [];
  (clusters || []).forEach(function (c) {
    var freq = frequencies(c), title = titleStems(c), terms = defined(c);
    var points = pointsByCluster[c.index] || [];
    var used = {};
    points.forEach(function (p) { used[p.text] = true; });
    var isFocus = focus.indexOf(c.index) !== -1;
    /* Sentences recall never showed, then the recall sentences again with a
       DIFFERENT word blanked, so the gauntlet is never a repeat. */
    var fresh = sentences(c).filter(function (s) {
      var len = s.text.split(/\s+/).length;
      return !used[s.text] && len >= 6 && len <= 60;
    }).sort(function (a, b) { return scoreSentence(b, freq) - scoreSentence(a, freq) || a.index - b.index; })
      .map(function (s) { var t = rankedTerms(s.text, freq, title, terms)[0]; return t && { s: s, word: t.word }; });
    var second = points.map(function (p) { var t = rankedTerms(p.text, freq, title, terms)[1]; return t && { s: p, word: t.word }; });
    var qs = fresh.concat(second).filter(Boolean).map(function (x) {
      return { question: 'Gauntlet — fill in the blank: ' + cloze(x.s.text, x.word), answer: x.word, cluster: c.index, page: x.s.page };
    });
    (isFocus ? fromFocus : fromRest).push(qs);
  });
  /* Take round-robin across sections, focus first, so no one section fills
     the gauntlet: at least half from the weakest, while there are any. */
  function drain(groups, k) {
    var out = [];
    for (var round = 0; out.length < k; round++) {
      var any = false;
      for (var i = 0; i < groups.length && out.length < k; i++) {
        if (groups[i][round]) { out.push(groups[i][round]); any = true; }
      }
      if (!any) break;
    }
    return out;
  }
  var a = drain(fromFocus, Math.ceil(want / 2));
  var b = drain(fromRest, want - a.length);
  var c2 = a.length + b.length < want ? drain(fromFocus, want - b.length).slice(a.length) : [];
  var all = a.concat(b, c2);
  if (!all.length) {
    /* A unit with nothing left to ask still gets a gauntlet: its own points,
       first word, so the protocol can finish. */
    (clusters || []).forEach(function (c) {
      var freq = frequencies(c), title = titleStems(c), terms = defined(c);
      (pointsByCluster[c.index] || []).forEach(function (p) {
        var t = rankedTerms(p.text, freq, title, terms)[0];
        if (t && all.length < want) all.push({ question: 'Gauntlet — fill in the blank: ' + cloze(p.text, t.word), answer: t.word, cluster: c.index, page: p.page });
      });
    });
  }
  return { questions: all };
}

/* The flow as a tree for drawing: each box once, its arrows out as
   branches beneath it. Paths repeated the shared start of every branch —
   the first screenshot drew "Diuretics → preload" twice. A box reached
   again is not drawn again: the branch stops at a reference to it. */
function tree(f) {
  var out = {}, into = {};
  f.edges.forEach(function (e) { into[e.to] = true; (out[e.from] = out[e.from] || []).push(e); });
  var roots = f.nodes.filter(function (n) { return !into[n.id]; }).map(function (n) { return n.id; });
  if (!roots.length && f.nodes.length) roots = [f.nodes[0].id];
  var drawn = {};
  function grow(id) {
    if (drawn[id]) return { id: id, again: true, next: [] };
    drawn[id] = true;
    return { id: id, next: (out[id] || []).map(function (e) { return { verb: e.verb, node: grow(e.to) }; }) };
  }
  return roots.map(grow);
}

var MemCoach = {
  sentences: sentences, keySentences: keySentences, lists: lists, patternQuestions: patternQuestions, phraseMatch: phraseMatch, itemMatch: itemMatch, numberSlips: numberSlips, defined: defined, toks: toks, rankedTerms: rankedTerms, matches: matches, cloze: cloze,
  encode: encode, recall: recall, flow: flow, paths: paths, tree: tree, tableQuestions: tableQuestions, gradeRecall: gradeRecall, gradeExplain: gradeExplain, gauntlet: gauntlet,
  bare: bare, frequencies: frequencies,
};
root.MemCoach = MemCoach;
if (typeof module !== 'undefined' && module.exports) module.exports = MemCoach;
})(typeof window !== 'undefined' ? window : this);
