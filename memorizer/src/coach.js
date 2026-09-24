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

function bare(w) { return String(w).toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9%]+$/g, ''); }
function isContent(b) { return b.length >= 4 && !STOP[b] && /[a-z]/.test(b); }
function stem(b) { return b.replace(/(?:ies|es|s|ed|ing|ly)$/, '').replace(/(.)\1$/, '$1'); }

/* The section's sentences, each with its page. Headings are titles, not
   teaching material, and are left out. */
function sentences(cluster) {
  var out = [];
  (cluster.segments || []).forEach(function (seg) {
    if (seg.heading) return;
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
    s.text.split(/\s+/).forEach(function (w) {
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
function rankedTerms(text, freq, title) {
  var seen = {}, out = [];
  text.split(/\s+/).forEach(function (w, pos) {
    var b = bare(w);
    if (!b || seen[b]) return;
    if (NUM.test(b)) { seen[b] = true; out.push({ word: b, score: 1000 + b.length, pos: pos, num: true }); return; }
    if (!isContent(b)) return;
    seen[b] = true;
    var s = (1 / (freq[stem(b)] || 1)) * (title[stem(b)] ? 0.5 : 1);
    out.push({ word: b, score: s + b.length / 40, pos: pos, num: false });
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
  var ws = s.text.split(/\s+/);
  var sum = 0;
  ws.forEach(function (w) { var b = bare(w); if (isContent(b)) sum += freq[stem(b)] || 0; });
  /* Multipliers, not additions: a flat bonus was small beside the frequency
     sum and a sentence stating a threshold ("below 12 mmHg") lost to
     sentences that merely repeated the topic. */
  var mult = (ws.some(function (w) { return NUM.test(bare(w)); }) ? 1.6 : 1) * (CAUSAL.test(s.text) ? 1.2 : 1);
  return (sum / Math.sqrt(ws.length)) * mult;
}

/* The sentence with one word replaced by a blank, and that word. */
function cloze(text, term) {
  var done = false;
  var q = text.split(/\s+/).map(function (w) {
    if (done || bare(w) !== term) return w;
    done = true;
    return w.replace(/[A-Za-z0-9][A-Za-z0-9.,%'\-]*[A-Za-z0-9%]|[A-Za-z0-9]/, '_____');
  }).join(' ');
  return q;
}

/* ── the five steps ──────────────────────────────────────────────────────── */

function keySentences(cluster) {
  var freq = frequencies(cluster);
  var all = sentences(cluster);
  var usable = all.filter(function (s) { var n = s.text.split(/\s+/).length; return n >= 6 && n <= 60; });
  if (!usable.length) usable = all.filter(function (s) { return s.text.split(/\s+/).length >= 3; });
  var k = Math.max(1, Math.min(9, Math.max(5, Math.round(all.length / 4)), usable.length));
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
  var freq = frequencies(cluster), title = titleStems(cluster);
  var picked = keySentences(cluster);
  var used = {};
  var hooks = picked.map(function (s) {
    var t = freshTerm(rankedTerms(s.text, freq, title), used, true);
    return t ? t.word : '';
  }).filter(Boolean);
  var letters = hooks.map(function (w) { return w[0].toUpperCase(); }).join('');
  return {
    points: picked.map(function (s) { return { text: s.text, page: s.page }; }),
    mnemonic: hooks.length >= 2
      ? 'First letters: ' + letters + ' — ' + hooks.join(' · ') + '. Say the letters, then say what each word stands for in this section.'
      : '',
    flowchart: '',
  };
}

function recall(cluster, points) {
  var freq = frequencies(cluster), title = titleStems(cluster);
  var out = [], used = {};
  (points || []).forEach(function (p) {
    if (out.length >= 5) return;
    var t = freshTerm(rankedTerms(p.text, freq, title), used, false);
    if (!t) return;
    out.push({ question: 'Fill in the blank: ' + cloze(p.text, t.word), answer: t.word, page: p.page });
  });
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

function gradeRecall(cluster, prompt, answer) {
  var ok = matches(answer, prompt.answer);
  return {
    correct: ok,
    missing: ok ? [] : [prompt.answer],
    misconception: '',
    feedback: ok ? 'Right.' : (String(answer || '').trim()
      ? 'The word was “' + prompt.answer + '”. If you wrote a synonym, count it as correct.'
      : 'No answer given — the word was “' + prompt.answer + '”.'),
  };
}

/* A point is covered when the explanation uses most of its key terms. */
function pointTerms(p, freq, title) {
  return rankedTerms(p.text, freq, title).slice(0, 3).map(function (t) { return t.word; });
}
function gradeExplain(cluster, points, explanation) {
  var freq = frequencies(cluster), title = titleStems(cluster);
  var gaps = [];
  var covered = 0;
  (points || []).forEach(function (p) {
    var terms = pointTerms(p, freq, title);
    var hit = terms.filter(function (t) { return matches(explanation, t); }).length;
    if (terms.length && hit >= Math.min(2, terms.length)) covered++;
    else gaps.push({ point: p.text, page: p.page });
  });
  var n = (points || []).length;
  var score = n ? Math.round(100 * covered / n) : 0;
  return {
    score: score,
    gaps: gaps,
    misconceptions: [],
    feedback: score >= 80 ? 'You touched nearly every key point. Now say it again, faster.'
      : score >= 50 ? 'About half the key points came through. Re-read the ones listed, then explain it once more.'
      : 'Most key points were missing. Go back to Encode, read the points aloud, then try again from memory.',
  };
}

function gauntlet(clusters, pointsByCluster, focus, n) {
  var want = Math.max(1, n || 5);
  var fromFocus = [], fromRest = [];
  (clusters || []).forEach(function (c) {
    var freq = frequencies(c), title = titleStems(c);
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
      .map(function (s) { var t = rankedTerms(s.text, freq, title)[0]; return t && { s: s, word: t.word }; });
    var second = points.map(function (p) { var t = rankedTerms(p.text, freq, title)[1]; return t && { s: p, word: t.word }; });
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
      var freq = frequencies(c), title = titleStems(c);
      (pointsByCluster[c.index] || []).forEach(function (p) {
        var t = rankedTerms(p.text, freq, title)[0];
        if (t && all.length < want) all.push({ question: 'Gauntlet — fill in the blank: ' + cloze(p.text, t.word), answer: t.word, cluster: c.index, page: p.page });
      });
    });
  }
  return { questions: all };
}

var MemCoach = {
  sentences: sentences, keySentences: keySentences, rankedTerms: rankedTerms, matches: matches, cloze: cloze,
  encode: encode, recall: recall, gradeRecall: gradeRecall, gradeExplain: gradeExplain, gauntlet: gauntlet,
  bare: bare, frequencies: frequencies,
};
root.MemCoach = MemCoach;
if (typeof module !== 'undefined' && module.exports) module.exports = MemCoach;
})(typeof window !== 'undefined' ? window : this);
