#!/usr/bin/env node
/*
 * Search by meaning: the arithmetic, and its merge with search by words.
 *
 *   node tests/verify-memorizer-vec-pure.js
 *
 * Pure Node, on vectors written here. The model itself (arctic-embed-s) is
 * not run: which sentences it finds similar is its business; what is held
 * here is what is done with the numbers it gives — the similarity, the
 * floor below which nothing is an answer, and the merge that lets a
 * sentence found by either method rank by both.
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const V = require(path.join(__dirname, '..', 'memorizer', 'src', 'vec.js'));

head('similarity');
{
  ok('the same direction is 1, whatever the length', Math.abs(V.cosine([1, 2, 2], [2, 4, 4]) - 1) < 1e-12);
  ok('at right angles, 0; opposite, -1', Math.abs(V.cosine([1, 0], [0, 3])) < 1e-12 && Math.abs(V.cosine([1, 1], [-2, -2]) + 1) < 1e-12);
  ok('a zero vector is similar to nothing, not NaN', V.cosine([0, 0], [1, 1]) === 0);
  const t = V.top([1, 0], [[0, 1], [1, 0.1], null, [1, 0.5], [1, 0.1]], 3);
  ok('the best k, best first, ties to the earlier, a missing vector last', JSON.stringify(t.map(x => x.i)) === '[1,4,3]', JSON.stringify(t));
}

head('the floor: below it, nothing is an answer');
{
  ok(`a sentence under ${V.MIN_COS} is not kept, however it ranks`, V.keep([{ key: 'a', cos: V.MIN_COS - 0.01 }]).length === 0);
  ok('the measured floor sits above the off-topic questions (0.461) and below the answers (0.504)', V.MIN_COS > 0.461 && V.MIN_COS < 0.504, String(V.MIN_COS));
  const k = V.keep([{ key: 'a', cos: 0.70 }, { key: 'b', cos: 0.66 }, { key: 'c', cos: 0.60 }, { key: 'd', cos: 0.50 }]);
  ok(`near the best only: within ${V.MARGIN} of it`, JSON.stringify(k.map(x => x.key)) === '["a","b"]', JSON.stringify(k));
  ok('nothing given, nothing kept', V.keep([]).length === 0);
}

head('merging two rankings');
{
  const f = V.fuse([['w1', 'w2', 'both'], ['both', 'm1']]);
  ok('found by both ranks above found by one', f[0] === 'both', JSON.stringify(f));
  ok('every key from either list is kept, once', JSON.stringify(f.slice().sort()) === '["both","m1","w1","w2"]');
  ok('among the found-by-one, a first place beats a second', f.indexOf('w1') < f.indexOf('w2'), JSON.stringify(f));
  ok('and equal places tie to the word ranking: second by words before second by meaning', f.indexOf('w2') < f.indexOf('m1'), JSON.stringify(f));
  ok('ties go to the word ranking, then its order', JSON.stringify(V.fuse([['x'], ['y']])) === '["x","y"]');
  ok('one list alone keeps its order', JSON.stringify(V.fuse([['c', 'a', 'b']])) === '["c","a","b"]');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
