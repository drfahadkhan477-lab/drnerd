/* ═══════════════════════════════════════════════════════════════════════════
   coach.js — the built-in coach: a lesson, then a drill of multiple-choice
   questions, with no AI, no key and no network.

   PURE. Three steps with the same arguments as the prompt builders in
   prompts.js — lesson, quiz, exam — each returning an object in the SAME
   schema the model is held to (MemPrompts.SCHEMAS), so the session, the store
   and the screens cannot tell which coach produced a step.
   tests/verify-memorizer-coach-pure.js checks every output against them.

   THE LESSON teaches a section the way a good teacher would walk through it:
   the big idea first (the section's own definition), then the key points in
   the book's order, the numbers worth knowing, a mnemonic for every list,
   the cause-and-effect chain as a flowchart (drawn by the screen from
   flow()), and an everyday analogy. Everything but the analogy is the
   PDF's own words, with pages; the analogies come from analogies.js, were
   written for Memorizer, and the screen labels them so.

   THE DRILL is multiple choice — single best answer, the format exams use —
   and every question is built from the book: the right answer and the
   explanation are its sentences, and the wrong options are real terms,
   items, definitions and numbers from elsewhere in the same unit, chosen to
   be the plausible confusions (another cause from a neighbouring list,
   another definition, a value from the next paragraph). Kinds, hardest
   first: a definition asked backwards, "the most common…", "all of the
   following EXCEPT", which of these belongs to a list, a table cell, a
   value, which statement is true, the missing term, and a definition asked
   forwards. At most two of each kind per section, so a drill is mixed.

   THE EXAM draws on every section with the same kinds, never repeating a
   drill question, and at least half on the weakest sections.

   Same syntax floor as src/: nothing Safari on iPadOS 13.4 cannot parse.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var Analogies = root.MemAnalogies || (typeof require === 'function' ? require('./analogies.js') : null);

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
 'cause causes caused causing ' +
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
   teaching material, and are left out.

   So are list items, unless `withItems`: "Tricuspid atresia" is a thing in a
   list, not a sentence, and a list is taught as a list — its hook, and
   "Name the …" questions. Before this, the gauntlet blanked items as if
   they were sentences ("_____ (eg, myxoma and metastases)"). Word counts
   and the number check still read them: an item's words are the section's
   terms, and its numbers are the section's numbers. */
function sentences(cluster, withItems) {
  var out = [];
  (cluster.segments || []).forEach(function (seg) {
    /* Headings are titles and tables are grids — neither is a sentence. A
       table's own questions come from tableQuestions() below. */
    if (seg.heading || seg.table || (seg.item && !withItems)) return;
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
  sentences(cluster, true).forEach(function (s) {
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

/* ── the lesson ──────────────────────────────────────────────────────────── */

/* The section's first definition, else its highest-scoring sentence: the
   one line a student should be able to say first. */
function overviewOf(cluster, picked) {
  var all = sentences(cluster);
  var def = all.filter(function (s) { var n = s.text.split(/\s+/).length; return DEFINITION.test(s.text) && n >= 6 && n <= 45; })[0];
  if (def) return def;
  return picked[0] || all[0] || null;
}

/* Sentences that state a value — a threshold, a percentage, a dose, a
   duration — each as the student should remember it: the whole sentence
   when it is short, else the words around the number. */
/* "Table 17.1", "Fig. 3", "p. 214": a number that names a place in the book
   is not a fact to learn. */
var REF_WORD = /^(?:table|tables|fig|figs|figure|figures|chapter|section|page|pages|p|pp|ref|refs|box|eq|equation|panel)\.?$/i;
function isFactNumber(ws, i) { return NUM.test(bare(ws[i])) && !(i > 0 && REF_WORD.test(ws[i - 1].replace(/[^A-Za-z.]/g, ''))); }
var UNIT_WORD = /^(?:%|mmhg|mm|cm|ms|mg|mcg|g|kg|ml|l|min|mins|minutes?|hours?|h|days?|weeks?|months?|years?|bpm|beats|mv|mmol|meq|cm2|m2)$/i;
function numberFacts(cluster, limit) {
  var out = [], seen = {};
  sentences(cluster, true).forEach(function (s) {
    /* split on spaces only: the window is shown, and "m/s" or "2–4" must
       come back as the book wrote them (toks() splits on slashes and dashes,
       and the first version showed "4 m s") */
    var ws = s.text.split(/\s+/);
    var at = -1;
    for (var i = 0; i < ws.length; i++) if (isFactNumber(ws, i)) { at = i; break; }
    if (at === -1 || out.length >= (limit || 8)) return;
    var text = ws.length <= 28 ? s.text : (at > 10 ? '… ' : '') + ws.slice(Math.max(0, at - 10), at + 12).join(' ') + (at + 12 < ws.length ? ' …' : '');
    if (!seen[text]) { seen[text] = true; out.push({ text: text, page: s.page }); }
  });
  return out;
}

/* A mnemonic for every list of three to nine items — first letters, the
   items in order — and one over the key points' key terms. */
function mnemonicsOf(cluster, picked) {
  var out = [];
  lists(cluster).filter(function (l) { return l.items.length >= 3 && l.items.length <= 9; }).forEach(function (l) {
    var words = l.items.map(function (i) { return i.label.replace(/\./g, ''); });
    out.push({ title: l.title || 'The list', letters: words.map(function (w) { return w.charAt(0).toUpperCase(); }).join(''), words: words });
  });
  var freq = frequencies(cluster), title = titleStems(cluster), terms = defined(cluster), used = {};
  var hooks = picked.map(function (s) { var t = freshTerm(rankedTerms(s.text, freq, title, terms), used, true); return t ? displayForm(s.text, t.word) : ''; }).filter(Boolean);
  if (!out.length && hooks.length >= 3) out.push({ title: 'The key points, in order', letters: hooks.map(function (w) { return w.charAt(0).toUpperCase(); }).join(''), words: hooks });
  return out;
}

function lesson(cluster) {
  var picked = keySentences(cluster);
  var ov = overviewOf(cluster, picked);
  return {
    overview: ov ? ov.text : '',
    points: picked.map(function (s) { return { text: s.text, page: s.page }; }),
    numbers: numberFacts(cluster, 8),
    mnemonics: mnemonicsOf(cluster, picked),
    analogies: Analogies ? Analogies.forSection(cluster, 2) : [],
    flowchart: '',
  };
}

/* ── multiple choice ───────────────────────────────────────────────────────
   Every question is { question, quote, options, answer, explain, page, kind }:
   `quote` is the book's sentence with a gap when the question completes one
   (else ''), `answer` the index of the right option, `explain` the book's
   sentence that settles it. */
var OPTIONS = 4;
var PER_KIND = 2;
var QUIZ_SIZE = 8;
var KIND_ORDER = ['define-back', 'most', 'except', 'member', 'table', 'number', 'true', 'term', 'define', 'source'];

/* A number from a string, the same every time: options are shuffled with it,
   so the right answer is not always first and a test can reproduce a drill. */
function hash(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function shuffled(list, seed) {
  var a = list.slice(), s = hash(seed) || 1;
  for (var i = a.length - 1; i > 0; i--) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    var j = s % (i + 1), t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* A word as the text writes it (capital kept for a name, punctuation off). */
function displayForm(text, word) {
  var ws = toks(text);
  for (var i = 0; i < ws.length; i++) {
    if (bare(ws[i]) === word) {
      var w = ws[i].replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9%]+$/g, '');
      return i > 0 && /^[A-Z][a-z]/.test(w) && !/[.!?:]$/.test(ws[i - 1]) ? w : (/^[A-Z]{2,}/.test(w) ? w : w.toLowerCase());
    }
  }
  return word;
}
/* What kind of word it is, so a wrong option is the same kind as the right
   one: a disease is offered against diseases, a drug against drugs. */
/* Two technical kinds are enough and plausible: a place (aortic, mitral,
   atrial, pulmonary…) and a thing that happens or is done (stenosis,
   hypertrophy, endocarditis, a drug, a test). The first version split them
   by suffix, found no second "-ophy", and fell back to any word — which is
   how "increases" and "produces" were offered against "hypertrophy". */
var PLACE = /^(?:atrial|ventricul\w*|arterial|venous|pulmonary|coronary|aortic|mitral|tricuspid|valv\w*|annul\w*|septal|apical|basal|anterior|posterior|inferior|lateral|systolic|diastolic|cardiac|myocardial|pericardial|endocardial|intracardiac|left|right)$/;
function kindOf(w) {
  var b = bare(w);
  if (/\s/.test(String(w).trim())) return 'phrase';
  if (PLACE.test(b)) return 'place';
  /* "hypertrophied", "dilating": a verb's form, not a thing's name */
  if (/(?:ed|ing)$/.test(b) && !/(?:disease|syndrome)$/.test(b)) return 'plain';
  if (TECH.test(b)) return 'thing';
  if (/^[A-Z]{2,}$/.test(w)) return 'abbr';
  if (/^[A-Z]/.test(w)) return 'name';
  return 'plain';
}
function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9%.]+/g, ' ').trim(); }

/* The unit's material for wrong options, gathered once per quiz. */
function pools(clusters) {
  var terms = [], defs = [], items = [], nums = [], phrases = [], sents = [], seenT = {}, seenP = {};
  var addPhrase = function (t, ci) { t = String(t).trim(); if (t.split(/\s+/).length >= 2 && !seenP[norm(t)]) { seenP[norm(t)] = true; phrases.push({ text: t, kind: 'phrase', ci: ci }); } };
  (clusters || []).forEach(function (c) {
    var freq = frequencies(c), title = titleStems(c), terms0 = defined(c);
    sentences(c).forEach(function (s) {
      var len = s.text.split(/\s+/).length;
      if (len >= 6 && len <= 30) sents.push({ text: s.text, ci: c.index });
      rankedTerms(s.text, freq, title, terms0).filter(function (t) { return !t.num && t.word.length >= 5 && !GENERIC[t.word] && !GENERIC[stem(t.word)]; }).slice(0, 2).forEach(function (t) {
        var d = displayForm(s.text, t.word);
        if (!seenT[norm(d)]) { seenT[norm(d)] = true; terms.push({ text: d, kind: kindOf(d), ci: c.index }); }
      });
    });
    patternQuestions(c).forEach(function (q) {
      if (q.kind === 'define') { defs.push({ term: q.term, def: q.answer, page: q.page, ci: c.index }); addPhrase(q.term, c.index); }
      if (q.kind === 'most') addPhrase(q.answer, c.index);
    });
    lists(c).forEach(function (l) { l.items.forEach(function (i) { items.push({ text: i.label, list: l.list + ':' + l.title, ci: c.index }); addPhrase(i.label, c.index); }); });
    /* "rheumatic heart disease (RHD)": a named thing, by the section's own say-so */
    (c.segments || []).forEach(function (seg) {
      var re = /((?:[A-Za-z][A-Za-z\-]+\s+){1,4})\(([A-Z]{2,6})\)/g, m;
      while ((m = re.exec(seg.text))) {
        /* the fewest words ending at the bracket whose first letter is the
           abbreviation's: "…revealed transesophageal echocardiogram (TEE)"
           is "transesophageal echocardiogram", not the word before it */
        var ws2 = m[1].trim().split(/\s+/), k = 2;
        while (k <= ws2.length && ws2[ws2.length - k].charAt(0).toUpperCase() !== m[2].charAt(0)) k++;
        if (k <= ws2.length) addPhrase(ws2.slice(-k).join(' ') + ' (' + m[2] + ')', c.index);
      }
    });
    sentences(c, true).forEach(function (s) {
      var ws = toks(s.text);
      ws.forEach(function (w, k) {
        var b = bare(w);
        if (isFactNumber(ws, k)) nums.push({ value: b, unit: /%$/.test(b) ? '%' : (bare(ws[k + 1] || '').match(UNIT_WORD) ? bare(ws[k + 1]) : ''), ci: c.index });
      });
    });
  });
  return { terms: terms, defs: defs, items: items, nums: nums, phrases: phrases, sents: sents };
}

/* Pick `n` wrong options: none equal to the answer or to each other, none
   the answer's own stem, none already said in the question (it would give
   the answer away), the closest kind first. */
function distractors(answer, candidates, n, avoidText, seed) {
  var an = norm(answer), astem = stem(bare(answer.split(/\s+/)[0] || ''));
  var avoid = norm(avoidText || '');
  var out = [], seen = {};
  shuffled(candidates, seed).forEach(function (c) {
    var t = String(c).trim(), k = norm(t);
    if (!t || seen[k] || out.length >= n) return;
    if (k.indexOf(an) !== -1 || an.indexOf(k) !== -1) return;
    if (t.split(/\s+/).length === 1 && (stem(bare(t)) === astem || sameRoot(bare(t), bare(answer)))) return;
    if (avoid && k.length > 3 && (' ' + avoid + ' ').indexOf(' ' + k + ' ') !== -1) return;
    seen[k] = true; out.push(t);
  });
  return out.length === n ? out : null;
}
/* "hypertrophy" and "hypertrophied": one word in two forms, so not a wrong
   option for the other. Six shared letters make a root. */
function sameRoot(a, b) {
  if (a.length < 6 || b.length < 6) return false;
  return a.slice(0, 6) === b.slice(0, 6);
}
function byKind(pool, like) {
  var k = kindOf(like);
  var same = pool.filter(function (t) { return t.kind === k; }).map(function (t) { return t.text; });
  var rest = pool.filter(function (t) { return t.kind !== k; }).map(function (t) { return t.text; });
  return { same: same, rest: rest };
}
/* Same-kind options first; others only to make up the number. */
function pickTerms(answer, pool, avoidText, seed, phrases) {
  if (phrases && String(answer).trim().split(/\s+/).length >= 2) {
    var n = String(answer).trim().split(/\s+/).length;
    var near = phrases.filter(function (p) { return Math.abs(p.text.split(/\s+/).length - n) <= 2; }).map(function (p) { return p.text; });
    var ph = distractors(answer, near, OPTIONS - 1, avoidText, seed);
    if (ph) return ph;
  }
  var b = byKind(pool, answer);
  var first = distractors(answer, b.same, Math.min(OPTIONS - 1, b.same.length), avoidText, seed) || [];
  if (first.length === OPTIONS - 1) return first;
  var rest = distractors(answer, b.rest.filter(function (t) { return first.indexOf(t) === -1; }), OPTIONS - 1 - first.length, avoidText + ' ' + first.join(' '), seed + '+');
  return rest ? first.concat(rest) : null;
}

/* Values for a number question: the unit's other values with the same unit
   first, then values near the right one — never the right one, never
   negative, never a percentage over 100. */
function numberOptions(value, unit, pool, seed) {
  var v = parseFloat(String(value).replace(',', '.')), dec = (String(value).split(/[.,]/)[1] || '').replace('%', '').length;
  var fmt = function (x) { return (dec ? x.toFixed(dec) : String(Math.round(x))) + (unit === '%' ? '%' : ''); };
  var right = fmt(v);
  /* A bare number ("4 m/s" reads as bare: the slash splits it) is offered
     only nearby values: another bare number from the unit may be a
     percentage written out ("55 percent"), and 55 for a velocity is no
     confusion anyone makes. */
  var same = pool.filter(function (n) { return unit && n.unit === unit; }).map(function (n) { var x = parseFloat(n.value.replace(',', '.')); return fmt(x); });
  var near = [v * 2, v / 2, v * 1.5, v + (v >= 10 ? 10 : 1), v - (v >= 10 ? 10 : 1), v * 3].map(fmt);
  var out = [], seen = {};
  seen[right] = true;
  shuffled(same, seed).concat(near).forEach(function (o) {
    var x = parseFloat(o);
    if (seen[o] || out.length >= OPTIONS - 1 || !(x > 0) || (unit === '%' && x > 100)) return;
    seen[o] = true; out.push(o);
  });
  return out.length === OPTIONS - 1 ? { right: right, wrong: out } : null;
}

/* A title inside a sentence: its first letter lowered, unless it is an
   abbreviation or a name ("Causes of TS" → "causes of TS"; "TR" stays). */
function midTitle(t) { return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
/* `src` is the book's text the question rests on, when the explanation
   says more than it (the true-statement kind adds a sentence of its own):
   choose() allows one question per source, and keyed on the explanation it
   let a sentence be asked twice. */
function mcq(kind, question, quote, right, wrong, explain, page, src) {
  var opts = shuffled([right].concat(wrong), question + '|' + quote);
  return { question: question, quote: quote, options: opts, answer: opts.indexOf(right), explain: explain, page: page, kind: kind, src: src || explain };
}
function blankOut(text, word) {
  var esc = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).replace(new RegExp('(^|[^A-Za-z0-9])' + esc + '(?![A-Za-z0-9])', 'i'), function (all, pre) { return pre + '_____'; });
}

/* Every question the section can support, best kinds first. */
function candidates(cluster, P) {
  var out = [], ci = cluster.index;
  var title = String(cluster.title || '').replace(/\s*\(cont\.\)$/, '');
  var sents = sentences(cluster);
  var findSentence = function (frag) { return (sents.filter(function (s) { return s.text.indexOf(frag) !== -1; })[0] || {}).text || frag; };
  var otherTerms = P.terms;

  patternQuestions(cluster).forEach(function (q) {
    var src = findSentence(q.answer.slice(0, 30));
    if (q.kind === 'define') {
      var ts = Object.keys(stemsOf(q.term)), said = stemsOf(q.answer);
      if (ts.length && !ts.every(function (k) { return said[k]; })) {
        var defTerms = P.defs.filter(function (d) { return norm(d.term) !== norm(q.term); }).map(function (d) { return d.term; });
        var w = distractors(q.term, defTerms, Math.min(OPTIONS - 1, defTerms.length), q.answer, q.term) || [];
        if (w.length < OPTIONS - 1) {
          var more = pickTerms(q.term, otherTerms.filter(function (t) { return w.indexOf(t.text) === -1; }),
            q.answer + ' ' + w.join(' '), q.term + '#', P.phrases.filter(function (p) { return w.indexOf(p.text) === -1; }));
          w = more ? w.concat(more).slice(0, OPTIONS - 1) : null;
        }
        if (w && w.length === OPTIONS - 1) out.push(mcq('define-back', 'Which term is defined as “' + q.answer + '”?', '', q.term, w, src, q.page));
      }
      var otherDefs = P.defs.filter(function (d) { return norm(d.term) !== norm(q.term); }).map(function (d) { return d.def; });
      var wd = distractors(q.answer, otherDefs, OPTIONS - 1, q.term, q.answer);
      if (wd) out.push(mcq('define', 'Which best describes ' + q.term.replace(/^[A-Z][a-z]/, function (x) { return x.toLowerCase(); }) + '?', '', q.answer, wd, src, q.page));
    } else if (q.kind === 'most') {
      var itemTexts = P.items.map(function (i) { return i.text; });
      var wm = distractors(q.answer, itemTexts, OPTIONS - 1, q.question, q.question) || pickTerms(q.answer, otherTerms, q.question, q.question, P.phrases);
      if (wm) out.push(mcq('most', q.question, '', q.answer, wm, src, q.page));
    }
  });

  lists(cluster).forEach(function (l) {
    var mine = l.items.map(function (i) { return i.label; });
    /* Any item of the unit may be the odd one out — the same lesion's other
       list included ("acquired causes EXCEPT Ebstein anomaly") — and the
       list's own items are kept out by distractors(), which is given them
       as the text an option may not repeat. */
    var outsiders = P.items.map(function (i) { return i.text; });
    var why = 'The ' + l.title + ': ' + mine.join(' · ') + '.';
    if (mine.length >= 3) {
      var out1 = distractors(mine[0], outsiders, 1, mine.join(' '), l.title + '!') ||
                 /* not the list's own subject: "causes of mitral stenosis EXCEPT
                    mitral stenosis" asks nothing */
                 distractors(mine[0], P.phrases.map(function (p) { return p.text; }).filter(function (t) { return mine.map(norm).indexOf(norm(t)) === -1 && !sameThing(t, l.title); }), 1, mine.join(' '), l.title + '!');
      if (out1) {
        var three = shuffled(mine, l.title).slice(0, OPTIONS - 1);
        out.push(mcq('except', 'All of the following are ' + midTitle(l.title) + ' EXCEPT:', '', out1[0], three, why, l.page));
      }
    }
    if (mine.length >= 1 && outsiders.length >= OPTIONS - 1) {
      var right = shuffled(mine, l.title + '?')[0];
      var wi = distractors(right, outsiders, OPTIONS - 1, mine.join(' '), l.title + '?');
      if (wi) out.push(mcq('member', 'Which of the following is one of the ' + midTitle(l.title) + '?', '', right, wi, why, l.page));
    }
  });

  (cluster.segments || []).forEach(function (seg) {
    if (!seg.table) return;
    var header = seg.tableHeader || seg.table[0], rows = seg.tableHeader ? seg.table : seg.table.slice(1);
    for (var col = 1; col < header.length; col++) {
      var colVals = rows.map(function (r) { return String(r[col] || '').trim(); }).filter(Boolean);
      rows.forEach(function (r) {
        var cell = String(r[col] || '').trim();
        if (!cell || !r[0] || !header[col]) return;
        var wt = distractors(cell, colVals, OPTIONS - 1, r[0] + ' ' + header[col], r[0] + header[col]);
        if (wt) out.push(mcq('table', 'In the table, what is the ' + header[col] + ' for ' + r[0] + '?', '', cell, wt, r.join(' — '), seg.page));
      });
    }
  });

  var picked = keySentences(cluster);
  var freq = frequencies(cluster), tstems = titleStems(cluster), terms0 = defined(cluster);
  /* Values and missing terms from the key points first, then from every
     other sentence long enough to stand alone, so a short section still
     gets a full drill; choose() keeps no two questions on one sentence. */
  var usable = picked.concat(sents.filter(function (s) {
    var n = s.text.split(/\s+/).length;
    return picked.indexOf(s) === -1 && picked.every(function (p) { return p.text !== s.text; }) && n >= 8 && n <= 45;
  }));
  usable.forEach(function (s) {
    var ws = toks(s.text);
    for (var i = 0; i < ws.length; i++) {
      var b = bare(ws[i]);
      if (!isFactNumber(ws, i)) continue;
      var unit = /%$/.test(b) ? '%' : (bare(ws[i + 1] || '').match(UNIT_WORD) ? bare(ws[i + 1]) : '');
      var no = numberOptions(b, unit, P.nums.filter(function (n) { return n.value !== b; }), s.text);
      if (no) out.push(mcq('number', 'Which value completes this statement from your book?', blankOut(s.text, b), no.right, no.wrong, s.text, s.page));
      break;
    }
    /* The missing word is a term — a place, a condition, a drug, a name —
       and every wrong option is the same kind of term, or the question is
       not asked: a verb among nouns gives the answer away by grammar. */
    var t = rankedTerms(s.text, freq, tstems, terms0).filter(function (x) {
      if (x.num) return false;
      var k = kindOf(displayForm(s.text, x.word));
      return k === 'thing' || k === 'place' || k === 'name' || k === 'abbr';
    })[0];
    if (t) {
      var shown = displayForm(s.text, t.word);
      var wt2 = distractors(shown, byKind(otherTerms, shown).same, OPTIONS - 1, s.text, s.text);
      if (wt2) out.push(mcq('term', 'Which term completes this statement from your book?', blankOut(s.text, t.word), shown, wt2, s.text, s.page));
    }
  });

  /* Which statement is true: one key sentence as written, three others
     each made false by one change — a term swapped for another of its kind,
     or a value for another value. A falsified line that happens to be a
     sentence of the book is not used. */
  var bookText = norm(sentences(cluster, true).map(function (s) { return s.text; }).join(' | '));
  var falsify = function (s, seed) {
    var ws = toks(s.text);
    for (var i = 0; i < ws.length; i++) {
      var b = bare(ws[i]);
      if (isFactNumber(ws, i)) {
        var unit = /%$/.test(b) ? '%' : '';
        var no = numberOptions(b, unit, [], seed);
        if (no) return s.text.replace(ws[i], ws[i].replace(b.replace('%', ''), no.wrong[0].replace('%', '')));
      }
    }
    var t = rankedTerms(s.text, freq, tstems, terms0).filter(function (x) {
      if (x.num) return false;
      var k = kindOf(displayForm(s.text, x.word));
      return k === 'thing' || k === 'place' || k === 'name' || k === 'abbr';
    })[0];
    if (!t) return null;
    /* A swap is only plausible within a kind: "stenosis" for "regurgitation",
       never "echocardiogram" for "stenosis". */
    var shown = displayForm(s.text, t.word);
    /* not a word inside a named abbreviation — "Tricuspid disease (TS)"
       gives itself away by the letters */
    var esc = t.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc + '\\s*\\([A-Z]{2,6}\\)', 'i').test(s.text)) return null;
    var same = byKind(otherTerms, shown).same;
    var sw = distractors(shown, same, 1, s.text, seed);
    if (!sw) return null;
    var out = blankOut(s.text, t.word);
    /* keep the sentence's capital when the swapped word opened it */
    var rep = out.indexOf('_____') === 0 ? sw[0].charAt(0).toUpperCase() + sw[0].slice(1) : sw[0];
    return out.replace('_____', rep);
  };
  /* The right statement is a key point; the wrong ones are the section's
     other sentences, each falsified — so a section with three key points
     still has enough to build from. */
  var short = function (x) { var n = x.text.split(/\s+/).length; return n >= 6 && n <= 32 && !REF_WORD.test(x.text.split(/\s+/)[0].replace(/[^A-Za-z.]/g, '')); };
  var shortOnes = picked.filter(short);
  shortOnes.forEach(function (s, k) {
    var others = sents.filter(function (x) { return short(x) && x.text !== s.text; });
    var wrong = [];
    others.forEach(function (o, j) {
      if (wrong.length >= OPTIONS - 1) return;
      var f = falsify(o, s.text + j);
      if (f && f !== o.text && bookText.indexOf(norm(f)) === -1 && wrong.indexOf(f) === -1) wrong.push(f);
    });
    if (wrong.length === OPTIONS - 1) out.push(mcq('true', 'Which statement about ' + title + ' is correct?', '', s.text, wrong, s.text + ' The others each change one detail.', s.page, s.text));
  });

  /* The last resort, for a section with nothing else to ask: which of these
     statements is from this section — the others from the rest of the unit. */
  var elsewhere = P.sents.filter(function (x) { return x.ci !== ci; }).map(function (x) { return x.text; });
  picked.forEach(function (s) {
    if (s.text.split(/\s+/).length > 30) return;
    var w = distractors(s.text, elsewhere, OPTIONS - 1, '', s.text);
    if (w) out.push(mcq('source', 'Which of these statements is from \u201C' + title + '\u201D?', '', s.text, w, s.text, s.page));
  });

  out.forEach(function (q) { q.cluster = ci; });
  return out;
}

/* A drill: up to `size` questions, the kinds in KIND_ORDER, at most
   PER_KIND of each, no two from one sentence of the book, none in `skip`. */
function choose(cands, size, skip) {
  var out = [], perKind = {}, usedSrc = {};
  var skipSet = {};
  (skip || []).forEach(function (q) { skipSet[q] = true; });
  for (var round = 0; round < PER_KIND; round++) {
    KIND_ORDER.forEach(function (k) {
      if (out.length >= size) return;
      var q = cands.filter(function (c) { return c.kind === k && !skipSet[c.question + c.quote] && !usedSrc[c.src] && out.indexOf(c) === -1; })[0];
      if (q && (perKind[k] || 0) <= round) { out.push(q); perKind[k] = (perKind[k] || 0) + 1; usedSrc[q.src] = true; }
    });
  }
  return out;
}

function strip(q, withCluster) {
  var o = { question: q.question, quote: q.quote, options: q.options, answer: q.answer, explain: q.explain, page: q.page };
  if (withCluster) o.cluster = q.cluster;
  return o;
}

/* The section's drill. `clusters` is the whole unit: wrong options come from
   all of it, so a section with little of its own still gets four choices. */
function quiz(cluster, lessonValue, clusters) {
  var P = pools(clusters && clusters.length ? clusters : [cluster]);
  return { questions: choose(candidates(cluster, P), QUIZ_SIZE).map(function (q) { return strip(q, false); }) };
}

/* The final exam: `n` questions across the unit, at least half from `focus`
   (the weakest sections), taken in turn so no one section fills it. A
   question a drill asked (`asked`: their question+quote strings) comes only
   once nothing new is left: short sections give their drills every
   question they have, and the first version then set an empty exam, which
   the schema refuses — the unit could never be finished. */
function exam(clusters, asked, focus, n) {
  var P = pools(clusters);
  var want = Math.max(1, n || 10);
  var inFocus = function (g) { return (focus || []).indexOf(g.ci) !== -1; };
  var groups = function (skip) { return (clusters || []).map(function (c) { return { ci: c.index, qs: choose(candidates(c, P), 40, skip) }; }); };
  var fresh = groups(asked), again = groups(null);
  var got = [], taken = {}, half = Math.ceil(want / 2);
  var weakN = function () { return got.filter(function (q) { return (focus || []).indexOf(q.cluster) !== -1; }).length; };
  function fill(gs, more) {
    for (var round = 0; more(); round++) {
      var any = false;
      gs.forEach(function (g) {
        var q = g.qs[round], k = q && q.question + '|' + q.quote;
        if (q) any = true;
        if (q && more() && !taken[k]) { got.push(q); taken[k] = true; }
      });
      if (!any) break;
    }
  }
  /* New questions first; then, if the exam is still short, drill ones —
     each pass half on the weakest, then the rest, then the weakest again. */
  [fresh, again].forEach(function (gs) {
    fill(gs.filter(inFocus), function () { return got.length < want && weakN() < half; });
    fill(gs.filter(function (g) { return !inFocus(g); }), function () { return got.length < want; });
    fill(gs.filter(inFocus), function () { return got.length < want; });
  });
  return { questions: got.map(function (q) { return strip(q, true); }) };
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
      /* "Congenital" + "causes of TS" → "Congenital causes of TS"; a
         sub-heading that already names its kind ("Causes of aortic
         stenosis") is its own title — the first version appended the
         section's title to it again. */
      var lab = label(seg.text);
      var named = /\b(?:causes?|features?|signs?|symptoms?|types?|indications?|contraindications?|complications?|findings?|risk factors?|treatments?|options?|criteria|agents?|drugs?|classes?)\b/i.test(lab);
      cur = { title: named ? lab : lab + ' ' + topic.replace(/^the\s+/i, ''), items: [], page: seg.page, list: seg.list };
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
      out.push({ question: 'What is ' + term + '?', answer: d[2].trim(), page: s.page, kind: 'define', term: d[1].replace(/^(?:the|a|an)\s+/i, '') });
    }
  });
  return out;
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
  OPTIONS: OPTIONS, PER_KIND: PER_KIND, QUIZ_SIZE: QUIZ_SIZE, KIND_ORDER: KIND_ORDER,
  sentences: sentences, keySentences: keySentences, lists: lists, patternQuestions: patternQuestions, defined: defined, toks: toks,
  rankedTerms: rankedTerms, frequencies: frequencies, bare: bare, numberFacts: numberFacts, mnemonicsOf: mnemonicsOf,
  pools: pools, candidates: candidates, choose: choose, distractors: distractors, numberOptions: numberOptions, shuffled: shuffled, kindOf: kindOf,
  lesson: lesson, quiz: quiz, exam: exam, flow: flow, paths: paths, tree: tree,
};
root.MemCoach = MemCoach;
if (typeof module !== 'undefined' && module.exports) module.exports = MemCoach;
})(typeof window !== 'undefined' ? window : this);
