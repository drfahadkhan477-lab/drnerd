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
