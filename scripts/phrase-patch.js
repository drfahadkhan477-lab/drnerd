#!/usr/bin/env node
/**
 * Word order counts inside the ranker — chain step 91, on prefixrank(76)'s text.
 *
 *   node scripts/phrase-patch.js <input.html> <output.html>
 *
 * WHAT WAS MEASURED. With the two Braunwald units in the shelf (1145 notes, 615
 * of them new), "prose from the note itself" — the shape the tutor actually
 * sends — found the note first 96.3% of the time against a floor of 98%. The
 * retrieval suite's --why counts, on the owner's build:
 *
 *   42 misses; 32 of them text note beaten by text note; the winner held every
 *   query term in 22; the 12-word window appeared WORD FOR WORD in the winner
 *   0 times out of 42.
 *
 * So nothing was duplicated — refs-merge had already taken repeated sentences
 * out — and every miss had the same shape: the right note holds the phrase,
 * the winner holds its words, scattered, in a slightly shorter note on the
 * same topic. A bag of words cannot tell those apart, and BM25's length
 * normalisation then prefers the shorter one. Titles are the same case: a
 * note's title is a run of its own words in order.
 *
 * WHAT THIS DOES. buildIndex also records, per document, which pairs of
 * adjacent tokens it contains (after tok(), so the pairs are over the same
 * terms the ranker scores). search() takes the adjacent pairs of the query's
 * known terms, and a note earns PHRASE_W times the fraction of those pairs it
 * holds — each pair weighed by its rarity across the index, as BM25 weighs a
 * term, so a pair every note on the topic has earns almost nothing — added beside the coverage credit, weighted the same, on the view
 * that the query's words in the query's order is at least as strong evidence
 * as the query's words present.
 *
 * WHAT IT LEAVES ALONE.
 *   · Questions. The credit is added in the reference-note branch only, the
 *     one that already carries the coverage credit, so question-to-question
 *     similarity (the `exclude` path) ranks exactly as before.
 *   · One-term queries and stubs. No pair, no credit: a pair is formed only
 *     between two terms the index knows, so a half-typed word neither earns
 *     nor costs anything here — prefixrank still scores it as before.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/phrase-patch.js <input.html> <output.html>');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 400)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the index records which terms sit side by side, and how often ─────── */
patch('phrase: the index counts documents per pair',
`  const docs=[], df=Object.create(null), post=Object.create(null);`,
`  const docs=[], df=Object.create(null), post=Object.create(null), bgdf=Object.create(null);`);

patch('phrase: pair counts travel with the index',
`  IDX={df,docs,avg,N:docs.length,post};`,
`  IDX={df,docs,avg,N:docs.length,post,bgdf};`);

patch('phrase: the index keeps adjacent pairs',
`    for(const t in tf){ df[t]=(df[t]||0)+1; (post[t]||(post[t]=[])).push(di); }
    docs.push({key,len:ts.length,tf,meta});`,
`    for(const t in tf){ df[t]=(df[t]||0)+1; (post[t]||(post[t]=[])).push(di); }
    /* ADJACENT PAIRS, over tok()'s own output, so a pair is two scored terms
       side by side. Presence only: order is the evidence, not repetition. */
    const bg=Object.create(null);
    for(let i=0;i+1<ts.length;i++) bg[ts[i]+'\\u0001'+ts[i+1]]=1;
    for(const k in bg) bgdf[k]=(bgdf[k]||0)+1;
    docs.push({key,len:ts.length,tf,meta,bg});`);

/* ── 2. the query's own pairs ──────────────────────────────────────────────── */
patch('phrase: the query keeps its pairs',
`  const nq=Object.keys(seen).length+stubs.length;`,
`  const nq=Object.keys(seen).length+stubs.length;
  /* The query's adjacent pairs of KNOWN terms — a stub is in no document's
     pairs, so a pair with one would only dilute the fraction. */
  const qb=[];
  for(let i=0;i+1<qt.length;i++){
    if(!(qt[i] in seen)||!(qt[i+1] in seen)) continue;
    const k=qt[i]+'\\u0001'+qt[i+1]; if(!qb.includes(k)) qb.push(k);
  }
  /* Each pair weighed by its rarity, as BM25 weighs a term: "heart failure"
     is in hundreds of notes and says little about which one was meant; a
     pair in three says a great deal. Unweighted, the owner's run left 23
     misses whose winners were shorter neighbours earning the common pairs. */
  const qbw=qb.map(k=>{ const n=(IDX.bgdf&&IDX.bgdf[k])||0; return Math.log(1+(IDX.N-n+0.5)/(n+0.5)); });
  const qbW=qbw.reduce((a,b)=>a+b,0);
  const PHRASE_W=6;`);

/* ── 3. a note holding the query's words in its order earns for it ─────────── */
patch('phrase: in order counts, for notes',
`        s = s*2.1 + (covered/nq)*6;`,
`        s = s*2.1 + (covered/nq)*6;
        /* The query's words in the query's order: the right note holds the
           phrase, a neighbour on the same topic only its words. */
        if(qb.length&&qbW>0&&d.bg){ let h=0; for(let j=0;j<qb.length;j++) if(d.bg[qb[j]]) h+=qbw[j]; s += (h/qbW)*PHRASE_W; }`);

fs.writeFileSync(OUT, html);
console.log(`phrase: ${applied.length} edits applied`);
for (const a of applied) console.log(`      ✓ ${a}`);
console.log(`      → ${OUT}`);
