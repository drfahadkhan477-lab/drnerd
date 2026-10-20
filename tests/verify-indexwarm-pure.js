#!/usr/bin/env node
/**
 * The search index, built a slice at a time while the search screen is opening.
 *
 *   node tests/verify-indexwarm-pure.js
 *
 * The first search used to build the whole index in the one call it made, which on a library the size of the real one is
 * about a second of a frozen screen under the first letter typed (and an iPad takes longer). warmIndex() now does the same
 * work in slices of a few milliseconds from the moment the search screen opens. A change of that kind has one way to go
 * wrong that matters more than speed: an index built in pieces that is not the index built at once, which ranks the same
 * query another way. So this holds the sliced index to the whole one, and holds what surrounds it: that it really is cut
 * into slices, that a search which cannot wait finishes the job it finds rather than starting another, that a note changed
 * while it is being built throws the job away, and that asking twice does not build twice.
 *
 * WHAT IT RUNS. Not a copy: app/systole.html's own tokenizer, index and search() are cut out of the page between the two
 * anchors tests/verify-phrase-pure.js uses, and run in a sandbox whose clock moves one millisecond every time the code looks
 * at it and whose timers are run by hand, so a slice is a fixed number of documents and nothing waits for real time.
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

const APP = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
const FROM = 'const STOP=new Set((', TO = '  return top.filter(r=>r.score>=cut);\n}';
for (const a of [FROM, TO]) {
  const n = APP.split(a).length - 1;
  if (n !== 1) throw new Error(`app/systole.html: expected the anchor once, found ${n}: ${a.slice(0, 50)}`);
}
const RANKER = APP.slice(APP.indexOf(FROM), APP.indexOf(TO) + TO.length);
const OPEN_SEARCH = APP.slice(APP.indexOf('function openSearch(){'), APP.indexOf('function quizFromSearch(){'));

/* ── invented documents ──────────────────────────────────────────────────────── */
let seed = 20261019;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const VOCAB = Array.from({ length: 260 }, (_, i) => pick(['cardio', 'valve', 'stent', 'atria', 'septal', 'mitral', 'aortic', 'pulmon', 'renal', 'beta']) + pick(['ac', 'ive', 'osis', 'itis', 'ing', 'ed', 'al', 'ic']) + i);
const words = n => Array.from({ length: n }, () => (rnd() < 0.25 ? pick(['the', 'with', 'of', 'and']) : pick(VOCAB))).join(' ');
function bank(nq, nr) {
  const ALL_Q = Array.from({ length: nq }, (_, i) => ({ id: 'Q' + i, ch: 'Ch' + (i % 5), n: i + 1, ci: 1, s: words(40 + Math.floor(rnd() * 40)),
    o: Array.from({ length: 4 }, () => ({ t: words(4) })), ex: words(60 + Math.floor(rnd() * 60)) }));
  const REF = Array.from({ length: nr }, (_, i) => ({ id: 'r' + i, title: words(3), tags: pick(VOCAB), body: words(80 + Math.floor(rnd() * 120)) }));
  return { ALL_Q, REF };
}
const copy = o => JSON.parse(JSON.stringify(o));

/* A sandbox for one library. The clock moves one millisecond every time it is read, so the page's slice budget of
   INDEX_SLICE_MS is that many documents; timers wait in a queue until the test runs them. */
function sandbox(b, channel) {
  const queue = [];
  let now = 0, tokCalls = 0;
  const ctx = { ALL_Q: copy(b.ALL_Q), REF: copy(b.REF), console, performance: { now: () => ++now }, setTimeout: f => { queue.push(f); return queue.length; }, clearTimeout: () => {} };
  /* The page yields with a message where it can (a timer that sets itself again is held to 4 ms) and with a timer where it cannot.
     The channel here is a queue of the same kind, so both ways are run by hand, and the suite runs once through each. */
  if (channel) ctx.MessageChannel = function () { const self = this; this.port1 = { onmessage: null }; this.port2 = { postMessage: () => { queue.push(() => self.port1.onmessage({})); } }; };
  vm.runInNewContext(RANKER + '\n;this.search=search;this.buildIndex=buildIndex;this.warmIndex=warmIndex;this.invalidateIndex=invalidateIndex;this.tok=tok;' +
    'this.state=()=>({IDX,IDXJOB,IDXWARM,SLICE:INDEX_SLICE_MS});', ctx);
  const realTok = ctx.tok;
  ctx.tok = s => { tokCalls++; return realTok(s); };
  return { ctx, queue, tokCalls: () => tokCalls, state: () => ctx.state(), runOne: () => queue.shift()(), runAll: () => { let n = 0; while (queue.length) { queue.shift()(); n++; } return n; } };
}
const QUERIES = ['cardio', 'valve', 'mitral aortic', 'aorti', 'beta stent atria', 'renal itis', 'zzzz', 'the with'].map((q, i) => (i === 2 ? q + ' ' + VOCAB[7] : q));
const results = sb => QUERIES.map(q => JSON.stringify(sb.ctx.search(q, { limit: 30 })));

for (const channel of [false, true]) {
  const mode = channel ? 'yielding by message' : 'yielding by timer';
  head(`${mode}: the sliced index is the whole index`);
  {
    let identical = true, searchesSame = true, detail = [];
    for (const [nq, nr] of [[0, 0], [1, 0], [0, 1], [30, 30], [70, 50]]) {
      const b = bank(nq, nr);
      const whole = sandbox(b, channel); whole.ctx.buildIndex();
      const sliced = sandbox(b, channel); sliced.ctx.warmIndex(); sliced.runAll();
      const same = JSON.stringify(whole.state().IDX) === JSON.stringify(sliced.state().IDX) && whole.state().IDX !== null;
      const sr = results(whole).join('|') === results(sliced).join('|');
      identical = identical && same; searchesSame = searchesSame && sr;
      detail.push(`${nq}+${nr}: ${same ? 'same' : 'DIFFERENT'}`);
    }
    ok('built in slices to the end, the index is the one built at once, for no documents, one, and a library of 120 (every field of it)', identical, detail.join(', '));
    ok('and every query ranks and scores the same on it, stubs and pairs and a query of nothing but stopwords included', searchesSame);
    const order = sandbox(bank(5, 4), channel); order.ctx.buildIndex();
    const keys = order.state().IDX.docs.map(d => d.key);
    ok('documents are indexed in the order the library holds them: the questions, then the notes',
       JSON.stringify(keys) === JSON.stringify([...order.ctx.ALL_Q.map(q => 'q:' + q.id), ...order.ctx.REF.map(r => 'r:' + r.id)]), keys.join(' '));
  }

  head(`${mode}: it really is cut into slices`);
  {
    const b = bank(70, 50), n = 120;
    const sb = sandbox(b, channel), SLICE = sb.state().SLICE;
    sb.ctx.warmIndex();
    const steps = [];
    let slices = 0, last = 0;
    while (sb.queue.length) {
      sb.runOne(); slices++;
      const job = sb.state().IDXJOB; const at = job ? job.i : n;
      steps.push(at - last); last = at;
    }
    ok('a library of 120 documents is built in at least 120 / the slice budget slices, not in one', slices >= Math.floor(n / SLICE), `${slices} slices of at most ${Math.max(...steps)} documents, budget ${SLICE} ms`);
    ok('no slice takes more documents than its budget allows', Math.max(...steps) <= SLICE, `the largest took ${Math.max(...steps)}`);
    ok('and the last slice leaves the index whole and the job gone', sb.state().IDX !== null && sb.state().IDXJOB === null && sb.state().IDXWARM === null, `index ${sb.state().IDX !== null ? 'built' : 'missing'}, job ${sb.state().IDXJOB === null ? 'gone' : 'still held'}, chain ${sb.state().IDXWARM === null ? 'cleared' : 'still marked'}`);
  }

  head(`${mode}: a search that cannot wait finishes the job it finds`);
  {
    const b = bank(70, 50);
    const clean = sandbox(b, channel); const want = results(clean);
    const sb = sandbox(b, channel);
    sb.ctx.warmIndex(); sb.runOne(); sb.runOne(); sb.runOne();
    const partial = sb.state().IDXJOB && sb.state().IDXJOB.i;
    const before = sb.tokCalls();
    const got = results(sb);
    const built = sb.state().IDX;
    ok('three slices in, a search gets the same answers as a search on a library that was never warmed', got.join('|') === want.join('|') && partial > 0 && partial < 120, `${partial} of 120 documents were done`);
    ok('it finished the job where it stood, and did not start another: the text of each document was read once', sb.tokCalls() - before === 120 - partial + QUERIES.length && sb.state().IDXJOB === null,
       `${sb.tokCalls() - before} reads for ${120 - partial} documents left and ${QUERIES.length} queries`);
    const timers = sb.queue.length;
    sb.runAll();
    ok('the slice that was waiting finds the work done, does nothing, and leaves the index it found', timers === 1 && sb.state().IDX === built && sb.queue.length === 0 && sb.state().IDXWARM === null, `${timers} timer(s) were waiting`);
  }

  head(`${mode}: a note changed while it is being built throws the job away`);
  {
    const b = bank(40, 30);
    const sb = sandbox(b, channel);
    sb.ctx.warmIndex(); sb.runOne(); sb.runOne();
    sb.ctx.REF.push({ id: 'new', title: 'a note written mid-build', tags: '', body: 'zzqmarker warfarin zzqmarker' });
    sb.ctx.invalidateIndex();
    ok('invalidating drops the half-built job', sb.state().IDXJOB === null && sb.state().IDX === null);
    sb.runAll();
    ok('the slice that was waiting does not build from the dead job or set an index', sb.state().IDX === null && sb.state().IDXJOB === null);
    sb.ctx.warmIndex(); sb.runAll();
    const hits = sb.ctx.search('zzqmarker', { limit: 5 });
    ok('warming again builds from the library as it is now: the note written mid-build is found', hits.length > 0 && hits[0].meta.id === 'new', hits.map(h => h.meta.id).join(',') || 'nothing found');
    const sb2 = sandbox(b, channel);
    sb2.ctx.warmIndex(); sb2.runOne();
    sb2.ctx.invalidateIndex(); sb2.ctx.warmIndex();
    ok('and asking again at once, before the old slice has run, starts a new chain and not a second one beside it', sb2.queue.length === 2, `${sb2.queue.length} timers queued`);
    sb2.runAll();
    ok('both run, only the new one works, and the index is whole once', sb2.state().IDX !== null && sb2.state().IDX.docs.length === 70, `${sb2.state().IDX && sb2.state().IDX.docs.length} documents`);
  }

  head(`${mode}: asking twice builds once, and a built index is left alone`);
  {
    const b = bank(20, 10);
    const sb = sandbox(b, channel);
    sb.ctx.warmIndex(); sb.ctx.warmIndex(); sb.ctx.warmIndex();
    ok('three calls queue one slice', sb.queue.length === 1, `${sb.queue.length} queued`);
    sb.runAll();
    const built = sb.state().IDX;
    sb.ctx.warmIndex();
    ok('with the index built, a call queues nothing', sb.queue.length === 0 && sb.state().IDX === built);
  }
}

head('opening the search screen is what starts it');
{
  ok('openSearch() asks for the index to be warmed, after it has drawn the screen', /render\(\);\s*toTop\(\);\s*warmIndex\(\);/.test(OPEN_SEARCH), OPEN_SEARCH.split('\n')[0].slice(0, 110));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
