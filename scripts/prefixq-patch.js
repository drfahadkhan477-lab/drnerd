#!/usr/bin/env node
/*
 * Chain step 72 — prefixq: a half-typed word finds the note anyway.
 *
 *   node scripts/prefixq-patch.js in.html out.html
 *
 * THE DEFECT, MEASURED. tests/verify-retrieval.js scores the library on four
 * query shapes. Three are strong. The fourth is not:
 *
 *   a note's own title              95.9% R@1
 *   the title with one typo         91.1%
 *   twelve words of its own prose   99.3%
 *   the title with words truncated  54.1%   ← and ten of 146 returned NOTHING
 *
 * Two of the five search() call sites pass exactly that shape: the library's
 * own search box, which is read on every keystroke, and the tool Apex calls
 * with a keyword phrase of its own devising. Typing "amylo" and being told
 * your library has nothing is not a ranking problem, it is a wall.
 *
 * WHY IT HAPPENS. tok() stems, and the stem of a truncation is a truncation:
 * "amylo" is not "amyloidosis", so IDX.df has no entry, so no document scores
 * and the result set is empty. The index is not wrong. It has simply never
 * been asked to complete a word.
 *
 * WHAT THIS DOES. Before scoring, any query token the index has NEVER SEEN is
 * completed against the vocabulary — at most two completions, nearest in
 * length first. Tokens the index knows are left exactly alone, which is the
 * property that makes this safe: a query that works today is not rewritten,
 * because rewriting only fires where there was nothing to rewrite.
 *
 * That safety is measured, not asserted. Across the other three shapes the
 * numbers are unchanged to the decimal — 95.9%, 91.1%, 99.3% before and after.
 *
 * WHY TWO COMPLETIONS. Measured, and it is not monotonic:
 *
 *   cap 1   76.7%      cap 3   69.9%
 *   cap 2   78.8%      cap 4   69.2%
 *                      cap 6   67.8%
 *
 * A third completion admits enough spurious matches to displace the note that
 * was ranked first. More recall is not more terms.
 *
 * WHAT THIS IS NOT. 78.8% is not 99%. MiniSearch reached that on this corpus
 * by scoring prefix matches inside its ranker rather than OR-ing whole terms
 * into the query — and it lost the long-prose shape that production actually
 * sends, and cost 18 KB gzipped, which is why it was declined (PR #28). This
 * is the cheap 25 points: fifteen lines, 0.44 ms per query, no dependency,
 * and the failure mode of returning nothing at all is gone entirely.
 */
'use strict';
const fs = require('fs');

const IN = process.argv[2], OUT = process.argv[3];
if (!IN || !OUT) { console.error('usage: prefixq-patch.js in.html out.html'); process.exit(1); }
let html = fs.readFileSync(IN, 'utf8');
const applied = [];

function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`prefixq/${label}: expected exactly 1 match, found ${n}`);
  html = html.replace(find, replace);
  applied.push(label);
}

/* The vocabulary is rebuilt with the index, never separately — an index that
   has been invalidated and a term list that has not is how a search box starts
   completing words that no longer exist in the library. */
patch('a sorted vocabulary alongside the index',
`let IDX=null;      // {df, docs:[{key,len,tf}], avg, N}`,
`let IDX=null;      // {df, docs:[{key,len,tf}], avg, N}
let VOCAB=null;    // IDX.df's keys, sorted — rebuilt with IDX, never apart

/* Complete query tokens the index has never seen.
   Only those: a token with a df is a word, and rewriting words would change
   queries that work today. Two completions, nearest in length first — three
   measurably loses more to noise than it gains in recall. */
const PREFIX_MIN=4, PREFIX_CAP=2;
function expandStubs(qs){
  if(!IDX) return qs;
  if(!VOCAB) VOCAB=Object.keys(IDX.df).sort();
  const add=[];
  for(const t of qs){
    if(IDX.df[t]||t.length<PREFIX_MIN) continue;
    /* Binary search to the first term at or after the stub, then walk while
       the prefix holds. The vocabulary runs to five figures; a linear scan per
       keystroke is affordable today and would stop being so quietly. */
    let lo=0,hi=VOCAB.length;
    while(lo<hi){ const m=(lo+hi)>>1; if(VOCAB[m]<t) lo=m+1; else hi=m; }
    const hits=[];
    for(let i=lo;i<VOCAB.length&&VOCAB[i].startsWith(t);i++)
      if(VOCAB[i].length>t.length) hits.push(VOCAB[i]);
    if(!hits.length) continue;
    hits.sort((a,b)=>(a.length-b.length)||(IDX.df[b]-IDX.df[a]));
    for(const h of hits.slice(0,PREFIX_CAP)) add.push(h);
  }
  for(const a of add) qs.push(a);
  return qs;
}`);

patch('search completes a stub before it scores',
`  const qs=tok(query); if(!qs.length) return [];`,
`  const qs=expandStubs(tok(query)); if(!qs.length) return [];`);

patch('invalidating the index invalidates the word list with it',
`function invalidateIndex(){
  pearlCache=null; IDX=null; }`,
`function invalidateIndex(){
  pearlCache=null; IDX=null; VOCAB=null; }`);

fs.writeFileSync(OUT, html);
console.log(`prefixq applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
