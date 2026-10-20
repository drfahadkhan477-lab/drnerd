#!/usr/bin/env node
/*
 * Topic runs: three to five questions about the same thing, back to back.
 *
 *   node tests/verify-topicrun-pure.js
 *
 * Pure Node (src/core/topicrun.js). The bank here is INVENTED, and so is its
 * vocabulary (zebratitis, quagga, mongoose...), so the grouping is held by words
 * that carry no meaning anywhere else: a run that gathers the right questions
 * has done it by their shared terms and by nothing else.
 *
 *   - questions on one topic are gathered, questions on another are not;
 *   - a word every question in the chapter uses means nothing and is not "shared";
 *   - a run never crosses chapters, repeats a question, or is only a pair;
 *   - seeds are what you most need (missed, then due), and the order says so;
 *   - the answer is exactly what scoring every seed against every question gives, however it is reached, and the
 *     chapter's kept vectors never answer for text that has changed;
 *   - damaged input never throws.
 */
'use strict';
const T = require('../src/core/topicrun.js').TopicRun;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const mk = (id, ch, stemWords, key) => ({ id, ch, s: `An invented patient presents with ${stemWords}. What is the next step?`, ci: 0,
  o: [{ t: key || 'invented management' }, { t: 'other' }, { t: 'another' }, { t: 'a fourth' }, { t: 'a fifth' }] });

const pool = [];
/* chapter Alpha: topic ZEB (5), topic MON (4), and three that share nothing */
/* ALP_3 carries several words of its own, so it is clearly the least like the others */
['zebratitis quagga fever', 'zebratitis quagga rash', 'zebratitis quagga stripes hooves tail', 'quagga zebratitis hooves', 'zebratitis quagga mane']
  .forEach((w, i) => pool.push(mk(`ALP_${i + 1}`, 'Alpha', w)));
['mongoose cobra venom', 'mongoose cobra bite', 'cobra mongoose antivenom', 'mongoose burrow cobra']
  .forEach((w, i) => pool.push(mk(`ALP_${i + 6}`, 'Alpha', w)));
['lonely walrus ice', 'solitary pelican beak', 'singular narwhal tusk'].forEach((w, i) => pool.push(mk(`ALP_${i + 10}`, 'Alpha', w)));
/* two questions that share a rare word and nothing else with anything: a pair, which is not a run */
['ocelot savanna dusk', 'ocelot canopy dawn'].forEach((w, i) => pool.push(mk(`ALP_${i + 13}`, 'Alpha', w)));
/* chapter Beta: the SAME zebratitis vocabulary, to prove a run does not cross chapters, among
   other questions: if every question in a chapter used those words they would count for
   nothing there (that is the point of the weighting), and Beta would have no run at all. */
['zebratitis quagga fever', 'zebratitis quagga rash', 'zebratitis stripes quagga', 'zebratitis quagga mane'].forEach((w, i) => pool.push(mk(`BET_${i + 1}`, 'Beta', w)));
['gloomy heron marsh', 'cheerful otter river', 'sleepy badger sett', 'restless lynx forest'].forEach((w, i) => pool.push(mk(`BET_${i + 5}`, 'Beta', w)));
const ids = r => r.ids;

head('questions on one topic are gathered, others are not');
{
  const rs = T.runs({ pool });
  const zeb = rs.find(r => r.ch === 'Alpha' && r.ids.includes('ALP_1'));
  const mon = rs.find(r => r.ch === 'Alpha' && r.ids.includes('ALP_6'));
  ok('the zebratitis questions are in one run (four fit; the fifth shares least and is left out)', !!zeb && zeb.ids.length === 4 && zeb.ids.includes('ALP_1'), zeb && zeb.ids.join(','));
  ok('and only zebratitis questions are in it', zeb.ids.every(i => /^ALP_[1-5]$/.test(i)), zeb.ids.join(','));
  ok('the one left out is the one that shares least with the others (ALP_3)', !zeb.ids.includes('ALP_3'), zeb.ids.join(','));
  const big = T.runs({ pool, size: 5 }).find(r => r.ch === 'Alpha' && r.ids.includes('ALP_1'));
  ok('asked for five, all five zebratitis questions are in it', big.ids.length === 5 && big.ids.every(i => /^ALP_[1-5]$/.test(i)), big.ids.join(','));
  ok('the mongoose questions are in another, apart from it', !!mon && mon.ids.every(i => /^ALP_[6-9]$/.test(i)) && !mon.ids.some(i => zeb.ids.includes(i)), mon && mon.ids.join(','));
  ok('the questions that share nothing are in no run', !rs.some(r => r.ids.some(i => /^ALP_1[0-2]$/.test(i))));
  ok('two questions that share only a rare word are a pair, and a pair is not a run', !rs.some(r => r.ids.some(i => /^ALP_1[34]$/.test(i))));
  ok('the run says exactly what its questions have in common, and not what only one has',
     JSON.stringify(zeb.shared) === '["quagga","zebratitis"]' && JSON.stringify(mon.shared) === '["cobra","mongoose"]', `${zeb.shared} | ${mon.shared}`);
}

head('a common word means nothing');
{
  const rs = T.runs({ pool });
  ok('words every question in the chapter uses are not "shared"', rs.every(r => !r.shared.some(t => ['invented', 'management', 'other'].includes(t))), rs.map(r => r.shared.join('/')).join(' | '));
  const v = T.vectorise(pool.filter(q => q.ch === 'Alpha'));
  ok('they carry no weight at all in the vectors', v.every(m => !m.has('invented') && !m.has('presents')), 'invented/presents absent');
}

head('a run is a real run, and keeps to its chapter');
{
  const rs = T.runs({ pool });
  const flat = rs.flatMap(ids);
  ok('no question is in two runs', new Set(flat).size === flat.length, `${flat.length - new Set(flat).size} repeated`);
  ok('Beta, with the same vocabulary, has its own run (so the next check is not vacuous)', rs.some(r => r.ch === 'Beta' && r.ids.includes('BET_1')), rs.filter(r => r.ch === 'Beta').map(r => r.ids.join(',')).join(' | '));
  ok('a run never crosses chapters, though Beta has the same vocabulary', rs.every(r => r.ids.every(i => i.startsWith(r.ch.slice(0, 3).toUpperCase()))), rs.map(r => r.ch + ':' + r.ids.length).join(' '));
  ok('every run has at least three questions: a pair is not a run', rs.every(r => r.ids.length >= 3), rs.map(r => r.ids.length).join(','));
  ok('and at most the size asked for', T.runs({ pool, size: 3 }).every(r => r.ids.length <= 3) && T.runs({ pool, size: 5 }).every(r => r.ids.length <= 5));
  ok('the seed is the first of its run', rs.every(r => r.ids[0] === r.seed));
  ok('the same input gives the same runs', JSON.stringify(T.runs({ pool })) === JSON.stringify(rs));
  ok('a similarity floor leaves out loose matches', T.runs({ pool, minSimilarity: 0.95 }).length < rs.length, `${T.runs({ pool, minSimilarity: 0.95 }).length} < ${rs.length}`);
  ok('max limits how many runs come back', T.runs({ pool, max: 1 }).length === 1);
}

head('seeds are what you most need');
{
  const plain = T.runs({ pool });
  const first = plain.map(r => r.seed);
  const withMiss = T.runs({ pool, missed: ['ALP_8'] });
  const mon = withMiss.find(r => r.ids.includes('ALP_8'));
  ok('a missed question seeds its own run', mon.seed === 'ALP_8', mon.seed);
  ok('and that run comes first', withMiss[0].seed === 'ALP_8', withMiss.map(r => r.seed).join(','));
  const dueRun = T.runs({ pool, due: new Set(['BET_2']) });
  ok('a due question seeds its run, ahead of runs with nothing due', dueRun[0].seed === 'BET_2', dueRun.map(r => r.seed).join(','));
  ok('with nothing missed or due, the seeds are in bank order', first[0] === 'ALP_1', first.join(','));
  const both = T.runs({ pool, missed: ['ALP_8'], due: ['BET_2'] });
  ok('missed outranks due', both[0].seed === 'ALP_8' && both[1].seed === 'BET_2', both.map(r => r.seed).join(','));
}

head('the answer is what scoring every pair gives, only faster');
{
  /* runs() used to score each seed against every question of its chapter, which is a square: on the bank's own size
     (639 questions in uneven chapters) the Study screen waited about 0.4 s for it each time an answer changed what was
     missed or due. It now reads only the lists of the seed's own terms, and keeps a chapter's vectors between calls.
     Both are claims about speed that must not move an answer, so the answer is held against the scan they replaced,
     written out here from the module's own vectorise() and cosine(): the same sum in the same order, which is the same
     number to the last bit, so the same ties broken the same way. */
  const reference = o => {
    const pool = o.pool.filter(q => q && typeof q.id === 'string' && typeof q.ch === 'string');
    const missed = new Set(o.missed instanceof Set ? [...o.missed] : o.missed || []);
    const due = new Set(o.due instanceof Set ? [...o.due] : o.due || []);
    const size = Math.max(2, Math.min(8, Number.isInteger(o.size) ? o.size : 4));
    const floor = Number.isFinite(o.minSimilarity) ? o.minSimilarity : 0.12;
    const max = Number.isInteger(o.max) ? o.max : Infinity;
    const byCh = new Map();
    for (const q of pool) { if (!byCh.has(q.ch)) byCh.set(q.ch, []); byCh.get(q.ch).push(q); }
    const result = [];
    for (const ch of [...byCh.keys()].sort()) {
      const qs = byCh.get(ch);
      if (qs.length < 2) continue;
      const vec = T.vectorise(qs), taken = new Set();
      const rank = i => missed.has(qs[i].id) ? 0 : due.has(qs[i].id) ? 1 : 2;
      for (const s of qs.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b)) {
        if (taken.has(s) || !vec[s].size) continue;
        const near = [];
        for (let j = 0; j < qs.length; j++) {
          if (j === s || taken.has(j)) continue;
          const sim = T.cosine(vec[s], vec[j]);
          if (sim >= floor) near.push({ j, sim });
        }
        near.sort((a, b) => b.sim - a.sim || a.j - b.j);
        const picked = near.slice(0, size - 1);
        if (picked.length < 2) continue;
        const members = [s, ...picked.map(p => p.j)];
        members.forEach(m => taken.add(m));
        const shared = [...vec[s].keys()].filter(t => members.every(m => vec[m].has(t)));
        result.push({ ch, seed: qs[s].id, ids: members.map(m => qs[m].id), shared: shared.sort() });
      }
    }
    const need = r => missed.has(r.seed) ? 0 : due.has(r.seed) ? 1 : 2;
    result.sort((a, b) => need(a) - need(b) || b.ids.length - a.ids.length || (a.seed < b.seed ? -1 : 1));
    return result.slice(0, max);
  };
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const syll = ['zeb', 'ra', 'quag', 'ga', 'mon', 'goose', 'co', 'bra', 'wal', 'rus', 'pel', 'i', 'can', 'nar', 'whal', 'oce', 'lot', 'sa', 'van', 'nah'];
  const makeVocab = n => { const v = []; for (let i = 0; i < n; i++) { let w = ''; for (let k = 2 + ((rnd() * 3) | 0); k > 0; k--) w += syll[(rnd() * syll.length) | 0]; v.push(w); } return v; };
  let cases = 0, withRuns = 0, differing = null;
  for (let round = 0; round < 300 && !differing; round++) {
    const vocab = makeVocab(20 + ((rnd() * 400) | 0)), skew = 1 + rnd() * 2.5;
    const word = () => vocab[Math.min(vocab.length - 1, Math.floor(Math.pow(rnd(), skew) * vocab.length))];
    const para = n => Array.from({ length: n }, word).join(' ');
    const rows = [];
    /* chapter names repeat from round to round with different text, which is how a kept vector goes stale */
    for (let c = 0, nch = 1 + ((rnd() * 6) | 0); c < nch; c++) {
      const n = rnd() < 0.33 ? (rnd() * 3) | 0 : 2 + ((rnd() * 60) | 0);
      for (let i = 0; i < n; i++) {
        const twin = rows.length && rnd() < 0.08 ? rows[rows.length - 1] : null;   /* identical text: scores that tie */
        rows.push({ id: `Q${c}_${i}`, ch: `Ch${c}`, s: twin ? twin.s : (rnd() < 0.04 ? '' : para(3 + ((rnd() * 40) | 0))),
                    o: [0, 1, 2, 3].map(() => ({ t: para(1 + ((rnd() * 6) | 0)) })), ci: twin ? twin.ci : (rnd() * 4) | 0 });
      }
    }
    const some = p => rows.filter(() => rnd() < p).map(q => q.id);
    for (const o of [
      { pool: rows, missed: new Set(some(0.2)), due: new Set(some(0.3)) },
      { pool: rows, missed: new Set(some(0.5)), due: new Set(some(0.5)), size: 3 + ((rnd() * 5) | 0), max: 1 + ((rnd() * 4) | 0) },
      { pool: rows, missed: some(0.1), due: some(0.1), minSimilarity: [0, -1, 0.05, 0.12, 0.3, 0.6, 1e-9][(rnd() * 7) | 0], size: 2 + ((rnd() * 7) | 0) },
    ]) {
      cases++;
      const want = JSON.stringify(reference(o)), got = JSON.stringify(T.runs(o));
      if (want !== '[]') withRuns++;
      if (want !== got) differing = { round, size: o.size, max: o.max, floor: o.minSimilarity, want: want.slice(0, 160), got: got.slice(0, 160) };
    }
  }
  ok(`${cases} invented banks (ties, empty stems, chapters of none or one, every floor from below zero to above one) give the runs the full scan gives, to the id and the shared word`,
     !differing, differing ? JSON.stringify(differing) : `${cases} compared`);
  ok('and most of them have runs in them, so the comparison is not an empty list against an empty list', withRuns > cases * 0.6, `${withRuns} of ${cases} have runs`);

  /* Two questions exactly as near a seed as each other come in bank order, not in the order the seed's words happened to
     reach them. Here the seed's first word is X's (T_2) and its second is Y's (T_1); each is as like the seed as the
     other, to the last bit, and the run has to read T_0, T_1, T_2. Identical twins would not show this: they are reached
     together, in order, by every word they share. */
  {
    const tie = [mk('T_0', 'T', 'alphaword betaword'), mk('T_1', 'T', 'betaword epsilonword'), mk('T_2', 'T', 'alphaword deltaword'),
                 mk('T_3', 'T', 'fillerone fillertwo'), mk('T_4', 'T', 'fillerthree fillerfour'), mk('T_5', 'T', 'fillerfive fillersix')];
    const r = T.runs({ pool: tie });
    ok('questions equally near a seed come in bank order, whichever of the seed\'s words reached them first', r.length === 1 && r[0].ids.join() === 'T_0,T_1,T_2' && JSON.stringify(r) === JSON.stringify(reference({ pool: tie })), JSON.stringify(r.map(x => x.ids)));
  }

  /* A chapter keeps its vectors between calls, so the same chapter with other words in it has to be worked out afresh. */
  {
    const grouped = r => r.map(x => [...x.ids].sort().join('')).sort().join('|');
    const zeb = 'zebratitis quagga hooves stripes', mon = 'mongoose cobra venom burrow';
    const mixed = [mk('M_1', 'M', zeb), mk('M_2', 'M', zeb), mk('M_3', 'M', zeb), mk('M_4', 'M', mon), mk('M_5', 'M', mon), mk('M_6', 'M', mon)];
    const before = grouped(T.runs({ pool: mixed }));
    /* the same six ids in the same chapter and the same order, with two of them rewritten to trade topics */
    const moved = mixed.map(q => q.id === 'M_3' ? mk('M_3', 'M', mon) : q.id === 'M_4' ? mk('M_4', 'M', zeb) : q);
    const after = grouped(T.runs({ pool: moved }));
    ok('a question rewritten between calls moves to the group its new words belong to: the kept vectors do not answer for text that is gone',
       before === 'M_1M_2M_3|M_4M_5M_6' && after === 'M_1M_2M_4|M_3M_5M_6' && after === grouped(reference({ pool: moved })), JSON.stringify([before, after]));
    ok('and putting the old text back gives the old groups again', grouped(T.runs({ pool: mixed })) === before, grouped(T.runs({ pool: mixed })));
  }

  /* Speed, as a ratio to the scan it replaced in the same process, so a slow machine slows both: on a bank the size of the real one the
     lists need a fraction of the scan, and a ratio under 3 means the square is back. */
  {
    const vocab = makeVocab(6000), word = () => vocab[Math.min(vocab.length - 1, Math.floor(Math.pow(rnd(), 2.2) * vocab.length))];
    const para = n => Array.from({ length: n }, word).join(' ');
    const big = [];
    [110, 100, 90, 80, 60, 50, 40, 40, 30, 25, 14].forEach((n, c) => { for (let i = 0; i < n; i++) big.push({ id: `B${c}_${i}`, ch: `Big${c}`, s: para(140), o: [0, 1, 2, 3, 4].map(() => ({ t: para(10) })), ci: 2 }); });
    const o = { pool: big, missed: new Set(big.filter(() => rnd() < 0.15).map(q => q.id)), due: new Set(big.filter(() => rnd() < 0.25).map(q => q.id)), size: 4, max: 3 };
    const time = f => { let best = Infinity; for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); f(o); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6); } return best; };
    T.runs(o); reference(o);
    const was = time(reference), now = time(T.runs);
    ok('on 639 questions in 11 uneven chapters a call takes at most a third of the time the full scan takes', now * 3 <= was && JSON.stringify(T.runs(o)) === JSON.stringify(reference(o)),
       `${now.toFixed(0)} ms against ${was.toFixed(0)} ms, ${(was / now).toFixed(1)}x`);
  }
}

head('damaged input never throws');
{
  const bad = [undefined, null, 5, 'x', [], {}, { pool: 3 }, { pool: [null, 3, { id: 1 }, { id: 'a' }, { id: 'a', ch: 'c' }, { id: 'b', ch: 'c', s: 5, o: 'x' }] }, { pool, size: 'big', max: 'many', minSimilarity: 'x', missed: 5, due: 5 }];
  let threw = null;
  for (const b of bad) { try { const r = T.runs(b); if (!Array.isArray(r)) threw = 'not an array'; } catch (e) { threw = e.message; } }
  ok('anything at all gives a list', threw === null, threw || `${bad.length} inputs`);
  ok('a chapter of one question has no run', T.runs({ pool: [mk('Z_1', 'Z', 'zebratitis quagga')] }).length === 0);
  ok('a question with no usable words does not seed anything', T.runs({ pool: [mk('E_1', 'E', ''), mk('E_2', 'E', ''), mk('E_3', 'E', '')] }).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
