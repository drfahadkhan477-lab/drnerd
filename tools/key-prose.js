'use strict';
/* A question's key, checked against its own commentary.
 *
 * Half the ACCSAP commentaries name their answer in prose — "The correct
 * answer is …" — and that sentence is an independent record of the fact the
 * key records as an index. tests/verify-keys.js runs this over the built bank
 * (it is how six mis-keyed export questions were found); tools/older-acc.js
 * runs it over every question it would stage, so an imported question whose
 * key and commentary disagree is refused at the door rather than caught by
 * the suite after a merge. One copy, used by both: two copies of a matcher
 * drift apart, and then a question passes one and fails the other.
 *
 * The trap, closed: commentaries argue against distractors in the same words
 * they use for the answer ("… is not the correct answer choice"), so a
 * sentence with a negation near the phrase is not read as a claim. */
const AFTER  = /\b(?:the\s+)?(?:correct|best)\s+(?:answer|response)(?:\s+choice)?\s*(?:is|:)\s*/i;
const BEFORE = /\b(?:is|are|would\s+be|remains)\s+(?:\w+\s+){0,2}?the\s+(?:correct|best|preferred)\s+(?:answer|response)(?:\s+choice)?\b/i;
const STOP = new Set(('a an the is are was were be been being of in on at to for with by from as that this these those ' +
  'and or but not no it its his her their there which who whom whose would should could may might can will shall ' +
  'patient patients most likely best next step following one because since due given about after before during ' +
  'choice answer correct measurement level levels').split(/\s+/));
const words = s => (s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
const firstSentence = t => { const r = /[.!?](?=\s+[A-Z(])/.exec(t); return (r ? t.slice(0, r.index) : t).slice(0, 170); };
const lastSentence = t => { const re = /[.!?]\s+(?=[A-Z(])/g; let s = 0, r; while ((r = re.exec(t))) s = r.index + r[0].length; return t.slice(s).slice(-170); };
const NEGATED = /\b(?:not|never|neither|nor|rather\s+than|incorrect)\b/i;
const covers = (claim, option) => {
  const C = new Set(words(claim)), O = words(option);
  if (!O.length) return 0;
  let hit = 0; for (const w of O) if (C.has(w)) hit++;
  return hit / O.length;
};

/* q: a bank-shaped question — o[].t, ci, ex (a string). Returns whether its
   commentary names an answer (checkable) and whether that answer is a
   different option from the key (disagrees). */
function keyVsProse(q) {
  const ex = q.ex || '';
  const a = AFTER.exec(ex), b = BEFORE.exec(ex);
  let claim = null, at = -1;
  if (a && (!b || a.index <= b.index)) { claim = firstSentence(ex.slice(a.index + a[0].length)); at = a.index; }
  else if (b) { claim = lastSentence(ex.slice(0, b.index)); at = b.index; }
  if (!claim || !words(claim).length) return { checkable: false, disagrees: false };
  if (NEGATED.test(ex.slice(Math.max(0, at - 90), at + 60))) return { checkable: false, disagrees: false };
  const sc = q.o.map(o => covers(claim, o.t));
  const best = sc.indexOf(Math.max(...sc));
  return { checkable: true, disagrees: sc[q.ci] < 0.6 && sc[best] >= 0.6 && best !== q.ci };
}

module.exports = { keyVsProse, AFTER, BEFORE, NEGATED, words, covers };
