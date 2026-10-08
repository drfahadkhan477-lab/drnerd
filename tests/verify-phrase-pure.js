#!/usr/bin/env node
/**
 * Word order in the ranker, measured on the search() the app ships.
 *
 *   node tests/verify-phrase-pure.js
 *
 * WHAT IT RUNS. Not a copy of the ranker: app/systole.html's own tokenizer,
 * index and search() are cut out of the page between two exact anchors and run
 * in a sandbox over a small document list. BEFORE is the same code with the
 * phrase credit's weight (PHRASE_W) set to 0, so every claim below is the
 * ranker with word order counted against the same ranker without it.
 *
 * Until the patch chain was retired this read prefixrank-patch.js's text and
 * ran phrase-patch.js over it; since then the ranker's source is app/, so a
 * suite reading the patch scripts would have gone on passing after the app's
 * ranker changed.
 *
 * THE CASE IT WAS WRITTEN FOR, from the owner's build: a phrase from a note
 * found a shorter note on the same topic first, one holding the phrase's words
 * scattered and never the phrase (verbatim in the winner: 0 of 42). The first
 * check proves the fixture reproduces that with the credit off — without it,
 * "the note now comes first" could be true of a fixture where it always came
 * first.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');

/* The ranker as the page ships it: from the stopword list through the end of
   search(). Both anchors must occur exactly once, or the cut is not the one
   this suite means. */
const APP = fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8');
const FROM = 'const STOP=new Set((', TO = '  return top.filter(r=>r.score>=cut);\n}';
for (const a of [FROM, TO]) {
  const n = APP.split(a).length - 1;
  if (n !== 1) throw new Error(`app/systole.html: expected the anchor once, found ${n}: ${a.slice(0, 50)}`);
}
const RANKER = APP.slice(APP.indexOf(FROM), APP.indexOf(TO) + TO.length);
const W_RE = /const PHRASE_W=(\d+(?:\.\d+)?);/g;
const W_HITS = [...RANKER.matchAll(W_RE)];
if (W_HITS.length !== 1) throw new Error(`the ranker should set PHRASE_W once, found ${W_HITS.length}`);
const PHRASE_W = Number(W_HITS[0][1]);
const UNCREDITED = RANKER.replace(W_RE, 'const PHRASE_W=0;');

const filler = (seed, n) => Array.from({ length: n }, (_, i) => `f${seed}w${i}`).join(' ');
const PHRASE = 'warfarin bridging increases major bleeding without reducing thromboembolism after surgery';
const DOCS = [
  /* the note the phrase comes from: longer, holds the phrase in order */
  { key: 'r:target', text: `Perioperative anticoagulation ${filler('t', 50)} ${PHRASE} ${filler('u', 40)}`, meta: { kind: 'r', id: 'target' } },
  /* a shorter note on the same topic: every word, never in that order */
  /* The rival is ~89% of the target's length (80 filler words). Scanned on
     the app's own ranker, so the limit is written down rather than found
     later: with the credit off the rival wins up to ~98% of the target's
     length; with it on, the target wins from ~78% upward; below that the
     rival wins either way — the credit is weighed like coverage, not made to
     outweigh any length. (The owner's misses: median 158 words against 172,
     ~92%, inside that window.) An earlier version of this suite ran a
     simplified tokenizer and put the window at ~70%; on the real one a rival
     at 70% beats the target even with the credit. */
  { key: 'r:rival', text: `surgery thromboembolism reducing without bleeding major increases bridging warfarin ${filler('r', 80)}`, meta: { kind: 'r', id: 'rival' } },
  /* half the phrase in order, the rest scattered */
  { key: 'r:half', text: `warfarin bridging increases major ${filler('h', 110)} surgery thromboembolism reducing without bleeding`, meta: { kind: 'r', id: 'half' } },
  { key: 'q:1', text: `A question about warfarin and bleeding ${filler('q1', 30)}`, meta: { kind: 'q', id: 'q1' } },
  { key: 'q:2', text: `Another question on major surgery and thromboembolism ${filler('q2', 30)}`, meta: { kind: 'q', id: 'q2' } },
  /* "heart failure": a pair nearly every note on this shelf has */
  ...Array.from({ length: 30 }, (_, i) => ({ key: 'r:o' + i, text: `Unrelated note ${i} on heart failure ${filler('o' + i, 50)}`, meta: { kind: 'r', id: 'o' + i } })),
  { key: 'r:common', text: `cmzz note on heart failure ${filler('cm', 60)}`, meta: { kind: 'r', id: 'common' } },
];

/* The page's buildIndex() reads ALL_Q and REF, so the documents go in as
   those: a question's text as its stem, a note's as its body. */
function load(code) {
  const ALL_Q = DOCS.filter(d => d.meta.kind === 'q')
    .map((d, i) => ({ id: d.meta.id, s: d.text, o: [], ci: 0, ex: '', ch: '', n: i + 1 }));
  const REF = DOCS.filter(d => d.meta.kind === 'r').map(d => ({ id: d.meta.id, title: '', tags: '', body: d.text }));
  const ctx = { ALL_Q, REF, console };
  vm.runInNewContext(code + '\n;this.search=search;', ctx);
  return ctx;
}
const before = load(UNCREDITED), after = load(RANKER);
const rank = (ctx, q) => ctx.search(q, { limit: 40 });
const ids = (ctx, q) => rank(ctx, q).map(h => h.meta.id);
const score = (ctx, q, id) => { const h = rank(ctx, q).find(x => x.meta.id === id); return h ? h.score : null; };

head('the case it was written for');
ok('with the phrase credit off, the shorter note holding the words scattered comes first — the fixture reproduces the miss',
   ids(before, PHRASE)[0] === 'rival', ids(before, PHRASE).slice(0, 3).join(', '));
ok('with the phrase counted, the note that holds it comes first', ids(after, PHRASE)[0] === 'target', ids(after, PHRASE).slice(0, 3).join(', '));
ok('and a note holding half of it in order ranks above the one holding none of it',
   score(after, PHRASE, 'half') - score(before, PHRASE, 'half') > score(after, PHRASE, 'rival') - score(before, PHRASE, 'rival'),
   `half +${(score(after, PHRASE, 'half') - score(before, PHRASE, 'half')).toFixed(2)}, rival +${(score(after, PHRASE, 'rival') - score(before, PHRASE, 'rival')).toFixed(2)}`);

head('what it leaves alone');
/* A query questions answer: both come back in both versions, so their
   scores can be compared rather than their absence. */
const QQ = 'another question major surgery thromboembolism';
const qScores = c => rank(c, QQ).filter(h => h.meta.kind === 'q').map(h => h.meta.id + ':' + h.score.toFixed(6)).sort().join(' ');
ok('a question scores exactly what it scored before', qScores(before) === qScores(after) && qScores(before).length > 0, qScores(after) || 'no question returned');
const one = c => rank(c, 'thromboembolism').map(h => h.meta.id + ':' + h.score.toFixed(6)).join(' ');
ok('a one-word query ranks and scores exactly as before', one(before) === one(after) && one(before).length > 0, one(after).slice(0, 60));
const stub = c => rank(c, 'warfa bleeding').map(h => h.meta.id + ':' + h.score.toFixed(6)).join(' ');
ok('a stub beside a word forms no pair, and changes nothing', stub(before) === stub(after) && stub(before).length > 0, stub(after).slice(0, 60));

/* "warfa" is a stub; "bridging increases" is a pair of known terms the
   target holds. The stub must neither form a pair nor dilute that one. */
const SQ = 'warfa bridging increases';
const gain = score(after, SQ, 'target') - score(before, SQ, 'target');
ok('and a stub does not dilute the credit of the pair beside it — the whole credit, not half', Math.abs(gain - PHRASE_W) < 1e-9, `+${gain.toFixed(3)} of ${PHRASE_W}`);

/* A query opening on the common pair. Unweighted, holding it alone would earn
   1/nb of the credit, the same as holding any rare pair; weighed by rarity it
   earns a small part of that. */
/* "cmzz" is the common note's own rare word, so it is returned; the only
   query pair it holds is heart-failure (it has cmzz-note, not cmzz-heart). */
const HQ = 'cmzz heart failure warfarin';
const nb = 3;   // cmzz-heart, heart-failure, failure-warfarin
/* Both scores must exist: a note cut from the results scores null in both,
   and null minus null is 0 — which reads as "earned almost nothing". */
const cb = score(before, HQ, 'common'), ca = score(after, HQ, 'common');
const commonGain = ca - cb;
ok('a pair nearly every note holds earns a small part of an equal share, not the share', cb !== null && ca !== null && commonGain > 0 && commonGain < 0.5 * PHRASE_W / nb,
   cb === null || ca === null ? 'the note was not returned — nothing measured' : `+${commonGain.toFixed(3)} (an equal share would be +${(PHRASE_W / nb).toFixed(3)})`);

head('the ranker read is the one with the credit in it');
ok('the cut holds the pair index and the credit, and the weight is not zero',
   PHRASE_W > 0 && /bg\[ts\[i\]/.test(RANKER) && RANKER.includes('post,bgdf}') && /PHRASE_W/.test(RANKER.slice(RANKER.indexOf('function search('))),
   `PHRASE_W=${PHRASE_W}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
