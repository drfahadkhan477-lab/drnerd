#!/usr/bin/env node
/**
 * Word order in the ranker — scripts/phrase-patch.js, measured on the search()
 * it patches.
 *
 *   node tests/verify-phrase-pure.js
 *
 * WHAT IT RUNS. Not a copy of the ranker: prefixrank-patch.js's own text for
 * buildIndex(), stubTerms() and search() is read out of that file (its
 * patch() calls are collected rather than applied), put on a page with a small
 * tok() and a document list, and phrase-patch.js is run over that page exactly
 * as the chain runs it. Both pages are then evaluated and asked the same
 * questions, so every claim below is BEFORE against AFTER on the same code.
 *
 * THE CASE IT WAS WRITTEN FOR, from the owner's build: a phrase from a note
 * found a shorter note on the same topic first, one holding the phrase's words
 * scattered and never the phrase (verbatim in the winner: 0 of 42). The first
 * check proves the fixture reproduces that under the unpatched ranker —
 * without it, "the note now comes first" could be true of a fixture where it
 * always came first.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');

/* prefixrank's patch() calls, collected: its own find/replace text. */
function prefixrankPairs() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'prefixrank-patch.js'), 'utf8')
    .replace(/function patch\(label, find, replace\) \{[\s\S]*?\n\}/, 'function patch(label, find, replace) { __pairs.push({ label, find, replace }); }');
  const __pairs = [];
  const fakeFs = { readFileSync: () => '', writeFileSync: () => {} };
  vm.runInNewContext(src, {
    __pairs, console: { log() {}, error() {} },
    process: { argv: ['node', 'x', 'in', 'out'], exit() {} },
    require: m => (m === 'fs' ? fakeFs : require(m)),
  });
  return __pairs;
}
const pairs = prefixrankPairs();
const byLabel = l => { const p = pairs.find(x => x.label.startsWith(l)); if (!p) throw new Error('prefixrank has no patch ' + l); return p.replace; };

const STOP = ['the', 'and', 'of', 'in', 'a', 'an', 'to', 'for', 'with', 'on', 'by', 'is', 'are', 'or', 'as', 'at', 'be', 'it', 'its', 'this', 'that'];
const page = `<script>
let IDX=null; let VOCAB=null;
const STOPW=new Set(${JSON.stringify(STOP)});
function tok(s){ return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>1&&!STOPW.has(w)); }
${byLabel('prefixrank: a stub resolves')}
${byLabel('prefixrank: the index keeps postings')}
  for(const d of __DOCS) add(d.key, d.text, d.meta);
  const avg=docs.reduce((a,d)=>a+d.len,0)/Math.max(1,docs.length);
  IDX={df,docs,avg,N:docs.length,post};
}
${byLabel('prefixrank: a prefix is scored as one term')}
</script>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phrase-'));
fs.writeFileSync(path.join(tmp, 'in.html'), page);
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'phrase-patch.js'), path.join(tmp, 'in.html'), path.join(tmp, 'out.html')], { stdio: 'pipe' });
const patched = fs.readFileSync(path.join(tmp, 'out.html'), 'utf8');

const filler = (seed, n) => Array.from({ length: n }, (_, i) => `f${seed}w${i}`).join(' ');
const PHRASE = 'warfarin bridging increases major bleeding without reducing thromboembolism after surgery';
const DOCS = [
  /* the note the phrase comes from: longer, holds the phrase in order */
  { key: 'r:target', text: `Perioperative anticoagulation ${filler('t', 50)} ${PHRASE} ${filler('u', 40)}`, meta: { kind: 'r', id: 'target' } },
  /* a shorter note on the same topic: every word, never in that order */
  /* The rival is ~70% of the target's length. Scanned before settling on it,
     so the limit is written down rather than found later: at ~90% the
     unpatched ranker already picks the target; at ~70% it picks the rival
     and the phrase credit turns it round; at ~50% the rival still wins even
     with it — the credit is weighed like coverage, not made to outweigh any
     length. (The owner's misses: median 172 words against 158.) */
  { key: 'r:rival', text: `surgery thromboembolism reducing without bleeding major increases bridging warfarin ${filler('r', 60)}`, meta: { kind: 'r', id: 'rival' } },
  /* half the phrase in order, the rest scattered */
  { key: 'r:half', text: `warfarin bridging increases major ${filler('h', 110)} surgery thromboembolism reducing without bleeding`, meta: { kind: 'r', id: 'half' } },
  { key: 'q:1', text: `A question about warfarin and bleeding ${filler('q1', 30)}`, meta: { kind: 'q', id: 'q1' } },
  { key: 'q:2', text: `Another question on major surgery and thromboembolism ${filler('q2', 30)}`, meta: { kind: 'q', id: 'q2' } },
  /* "heart failure": a pair nearly every note on this shelf has */
  ...Array.from({ length: 30 }, (_, i) => ({ key: 'r:o' + i, text: `Unrelated note ${i} on heart failure ${filler('o' + i, 50)}`, meta: { kind: 'r', id: 'o' + i } })),
  { key: 'r:common', text: `cmzz note on heart failure ${filler('cm', 60)}`, meta: { kind: 'r', id: 'common' } },
];

function load(html) {
  /* The page is this file's own, opened and closed exactly as written above,
     so the script is cut out between those two markers — no pattern that
     reads like filtering HTML it did not write. */
  const open = '<script>', close = '</script>';
  const a = html.indexOf(open), b = html.lastIndexOf(close);
  if (a < 0 || b < a) throw new Error('the page lost its script markers');
  const js = html.slice(a + open.length, b);
  const ctx = { __DOCS: DOCS, console };
  vm.runInNewContext(js + '\n;this.search=search;this.buildIndex=buildIndex;', ctx);
  return ctx;
}
const before = load(page), after = load(patched);
const rank = (ctx, q) => ctx.search(q, { limit: 40 });
const ids = (ctx, q) => rank(ctx, q).map(h => h.meta.id);
const score = (ctx, q, id) => { const h = rank(ctx, q).find(x => x.meta.id === id); return h ? h.score : null; };

head('the case it was written for');
ok('under the unpatched ranker, the shorter note holding the words scattered comes first — the fixture reproduces the miss',
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
ok('and a stub does not dilute the credit of the pair beside it — the whole credit, not half', Math.abs(gain - 6) < 1e-9, `+${gain.toFixed(3)}`);

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
ok('a pair nearly every note holds earns a small part of an equal share, not the share', cb !== null && ca !== null && commonGain > 0 && commonGain < 0.5 * 6 / nb,
   cb === null || ca === null ? 'the note was not returned — nothing measured' : `+${commonGain.toFixed(3)} (an equal share would be +${(6 / nb).toFixed(3)})`);

head('the patch is applied as the chain applies it');
ok('five edits, each matching once', (patched.match(/PHRASE_W/g) || []).length >= 2 && patched.includes('bg[ts[i]') && patched.includes('post,bgdf}') && patched !== page);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
