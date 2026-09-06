#!/usr/bin/env node
/*
 * Prefix matching inside the ranker — chain step 73.
 *
 *   node scripts/prefixrank-patch.js <input.html> <output.html>
 *
 * WHAT STEP 72 DID, AND WHERE IT STOPS. `prefixq` completes a query token the
 * index has never seen — "amylo" — against the vocabulary, takes the two
 * nearest in length, and OR-s them into the query as ordinary terms. That took
 * R@1 on truncated titles from 54.1% to 80.1% for fifteen lines, and its own
 * note said the rest "needs prefix matching inside the ranker rather than terms
 * OR-ed into the query". This is that.
 *
 * WHY THE CAP OF TWO IS NOT A NUMBER TO TUNE. Three things go wrong when a
 * prefix is represented by a couple of chosen completions:
 *
 *   1. A document whose only matching term is the completion NOT chosen scores
 *      zero on that stem. It is not ranked low, it is invisible.
 *   2. A document containing both chosen completions is credited twice for
 *      what the fellow typed once.
 *   3. Each completion carries its own idf. A rare wrong completion outweighs
 *      the common right one, so the stem argues for the wrong document.
 *
 * Raising the cap does not fix any of these — it widens 2 and 3 while barely
 * touching 1. Measured on the 295-note shelf at caps of 2/3/4/6/8, R@1 went
 * 63.4 / 61.7 / 61.0 / 62.7 / 63.4: noise around a ceiling, with query time
 * rising throughout. The cap was never the constraint.
 *
 * WHAT THIS DOES INSTEAD. A stub is scored as ONE term whose postings are the
 * union of every vocabulary term it prefixes:
 *
 *   tf  = the sum of the document's frequencies for all terms sharing the
 *         prefix — so a note saying "amyloid" twice and "amyloidosis" once is
 *         credited three times for "amylo", once.
 *   df  = the number of documents containing ANY of them, counted, not summed
 *         — so the idf is the idf of the prefix itself rather than of whichever
 *         completion was picked.
 *
 * That is the standard treatment of a wildcard term, and it removes the cap,
 * the double counting and the wrong-idf problem together rather than trading
 * them off.
 *
 * THE SAFETY PROPERTY IS UNCHANGED AND MATTERS MORE HERE. A token the index
 * knows is never treated as a prefix. It has to be: "as" is a real query term
 * on this shelf (aortic stenosis), and prefix-matching it would drag in
 * aspirin, assess, association and asystole on every search. Known token →
 * exact term, exactly as before. Only a token with no df of its own, at least
 * PREFIX_MIN characters long, is a stub.
 *
 * POSTINGS, BECAUSE THIS HAS TO SCALE. Scoring a prefix by walking every
 * document and testing every term against it is O(docs x terms) per stub, and
 * the corpus just doubled. buildIndex now also records, for each term, the
 * documents it appears in — one array per term, built in the pass that already
 * computes df. A stub then costs the sum of the dfs of the terms it prefixes,
 * which is the number of postings that can possibly match, instead of the size
 * of the whole collection.
 *
 * expandStubs GOES ENTIRELY. Nothing rewrites the query any more, so there is
 * no rewriting to be careful about: a known token reaches the ranker as itself
 * because that is the only path there is, not because a branch decided so. A
 * no-op kept "for its callers" would have had none — the checks that used to
 * call it now ask stubTerms what a stub reaches, which is the thing that
 * actually decides the score.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/prefixrank-patch.js <input.html> <output.html>');
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

/* ── 1. the index records where each term appears ─────────────────────────── */
patch('prefixrank: the index keeps postings',
`function buildIndex(){
  const docs=[], df=Object.create(null);
  const add=(key,text,meta)=>{
    const ts=tok(text); if(!ts.length) return;
    const tf=Object.create(null);
    for(const t of ts) tf[t]=(tf[t]||0)+1;
    for(const t in tf) df[t]=(df[t]||0)+1;
    docs.push({key,len:ts.length,tf,meta});
  };`,
`function buildIndex(){
  const docs=[], df=Object.create(null), post=Object.create(null);
  const add=(key,text,meta)=>{
    const ts=tok(text); if(!ts.length) return;
    const tf=Object.create(null);
    for(const t of ts) tf[t]=(tf[t]||0)+1;
    /* POSTINGS. df already needs a pass over the document's distinct terms;
       recording WHICH document, in the same pass, is what lets a prefix be
       scored from the postings of the terms it covers rather than by walking
       the whole collection once per stub. */
    const di=docs.length;
    for(const t in tf){ df[t]=(df[t]||0)+1; (post[t]||(post[t]=[])).push(di); }
    docs.push({key,len:ts.length,tf,meta});
  };`);

patch('prefixrank: postings travel with the index',
`  IDX={df,docs,avg,N:docs.length};`,
`  IDX={df,docs,avg,N:docs.length,post};`);

/* ── 2. a stub names a range of the vocabulary, not two picks from it ─────── */
patch('prefixrank: a stub resolves to every term it prefixes',
`/* Complete query tokens the index has never seen.
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
}`,
`/* A query token the index has never seen is a STUB, and a stub stands for
   every vocabulary term it prefixes — not for two of them chosen by length.
   Only a token with no df of its own qualifies: a token the index knows is a
   word, and prefix-matching a word would rewrite queries that work today. On
   this shelf that guard is load-bearing rather than theoretical — "as" is
   aortic stenosis, and treating it as a prefix would pull in aspirin, assess
   and asystole on every search that mentions it. */
const PREFIX_MIN=4;
function stubTerms(t){
  if(!IDX||IDX.df[t]||t.length<PREFIX_MIN) return null;
  if(!VOCAB) VOCAB=Object.keys(IDX.df).sort();
  /* Binary search to the first term at or after the stub, then walk while the
     prefix holds. The slice is contiguous because the vocabulary is sorted. */
  let lo=0,hi=VOCAB.length;
  while(lo<hi){ const m=(lo+hi)>>1; if(VOCAB[m]<t) lo=m+1; else hi=m; }
  let end=lo;
  while(end<VOCAB.length&&VOCAB[end].startsWith(t)) end++;
  return end>lo?VOCAB.slice(lo,end):null;
}`);

/* ── 3. the ranker scores a prefix as a term ──────────────────────────────── */
patch('prefixrank: a prefix is scored as one term, with its own idf',
`function search(query,{exclude=null,limit=5}={}){
  if(!IDX) buildIndex();
  const qs=expandStubs(tok(query)); if(!qs.length) return [];
  const k1=1.5,b=0.75, seen=Object.create(null);
  for(const t of qs) seen[t]=(seen[t]||0)+1;
  const out=[];
  for(const d of IDX.docs){
    if(exclude&&d.key==='q:'+exclude) continue;
    let s=0;
    for(const t in seen){
      const f=d.tf[t]; if(!f) continue;
      const n=IDX.df[t]||0;
      const idf=Math.log(1+(IDX.N-n+0.5)/(n+0.5));
      s += idf * (f*(k1+1))/(f + k1*(1-b+b*d.len/IDX.avg));
    }
    if(s>0){
      if(d.meta.kind==='r'){
        // The fellow's own notes are short by nature; BM25 length-normalisation would
        // bury them under 1,500-char commentaries. Boost, and credit query coverage.
        let covered=0; for(const t in seen) if(d.tf[t]) covered++;
        const frac=covered/Object.keys(seen).length;
        s = s*2.1 + frac*6;
      }
      out.push({score:s,meta:d.meta});
    }
  }
  out.sort((a,b)=>b.score-a.score);
  const top=out.slice(0,limit);
  const cut=top.length?top[0].score*0.32:0;      // drop weak tails
  return top.filter(r=>r.score>=cut);
}`,
`function search(query,{exclude=null,limit=5}={}){
  if(!IDX) buildIndex();
  const qt=tok(query); if(!qt.length) return [];
  const k1=1.5,b=0.75, seen=Object.create(null), stubs=[];
  /* Split what was typed into terms the index knows and stubs it does not. A
     stub with nothing to prefix falls through to seen, where it scores zero —
     the same nothing it scored before, and not an error. */
  for(const t of qt){
    const terms=stubTerms(t);
    if(terms) stubs.push({terms});
    else seen[t]=(seen[t]||0)+1;
  }
  const docs=IDX.docs, ND=docs.length;
  /* Each stub's per-document frequency, and the document frequency of the
     prefix itself — counted over documents, not summed over completions, so a
     document holding three terms that share the prefix raises tf and not df.
     Walked through the postings of the covered terms: the cost is the number
     of postings that can match, not the size of the collection. */
  for(const st of stubs){
    const f=new Float64Array(ND); let n=0;
    for(const term of st.terms){
      const ps=IDX.post[term]; if(!ps) continue;
      for(let i=0;i<ps.length;i++){
        const di=ps[i], v=docs[di].tf[term];
        if(!v) continue;
        if(!f[di]) n++;
        f[di]+=v;
      }
    }
    st.f=f;
    st.idf=Math.log(1+(IDX.N-n+0.5)/(n+0.5));
  }
  const nq=Object.keys(seen).length+stubs.length;
  const out=[];
  for(let di=0;di<ND;di++){
    const d=docs[di];
    if(exclude&&d.key==='q:'+exclude) continue;
    const norm=k1*(1-b+b*d.len/IDX.avg);
    let s=0, covered=0;
    for(const t in seen){
      const f=d.tf[t]; if(!f) continue;
      const n=IDX.df[t]||0;
      const idf=Math.log(1+(IDX.N-n+0.5)/(n+0.5));
      s += idf * (f*(k1+1))/(f + norm);
      covered++;
    }
    for(const st of stubs){
      const f=st.f[di]; if(!f) continue;
      s += st.idf * (f*(k1+1))/(f + norm);
      covered++;
    }
    if(s>0){
      if(d.meta.kind==='r'){
        // The fellow's own notes are short by nature; BM25 length-normalisation would
        // bury them under 1,500-char commentaries. Boost, and credit query coverage.
        // A matched stub counts towards coverage exactly as a matched term does:
        // half a typed word found is half the query answered.
        s = s*2.1 + (covered/nq)*6;
      }
      out.push({score:s,meta:d.meta});
    }
  }
  out.sort((a,b)=>b.score-a.score);
  const top=out.slice(0,limit);
  const cut=top.length?top[0].score*0.32:0;      // drop weak tails
  return top.filter(r=>r.score>=cut);
}`);

fs.writeFileSync(OUT, html);
console.log(`prefixrank: ${applied.length} edits applied`);
for (const a of applied) console.log(`      ✓ ${a}`);
console.log(`      → ${OUT}`);
