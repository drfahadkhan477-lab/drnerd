#!/usr/bin/env node
/*
 * The build's own notes brought up to date on a device, without touching the fellow's — src/core/refseed.js.
 *
 *   node tests/verify-refseed-pure.js
 *
 * Pure Node, over invented notes. The hash is held to FNV-1a's published test values, not to itself; every sync
 * below is a device's notes and a seed written out here, and what each note must become is worked out from the rules.
 *
 * What is measured, rather than assumed:
 *   - the hash is 32-bit FNV-1a, in base 36;
 *   - no seed yet, or this very seed already applied, is nothing to do: the device's notes are left as they are, and
 *     with no seed the stored version is not even asked;
 *   - a fresh device gets every seeded note, each stamped and marked as the build's, with the hash of its body;
 *   - a note the fellow wrote is never touched, even under a seeded note's title;
 *   - a seeded note the fellow has edited is left alone; one untouched is brought up to date, and counted only when
 *     something changed; one seeded before fingerprints existed is adopted;
 *   - a seeded note the fellow deleted comes back when the corpus changes;
 *   - the version to store is the hash of the whole seed;
 *   - the page's refHash() and refSeedApply() are the calls into this, the module is written into the page above the
 *     line that seeds the library as it loads, and the page keeps no second copy of the rules.
 *
 * verify-references is the browser half: it drives the built page's refSeedApply() across corpus versions.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const R = require('../src/core/refseed.js').RefSeed;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };
const clone = v => JSON.parse(J(v));
/* An environment that records whether the stored version was asked for. */
const env = stored => { const e = { asked: 0, now: 1700000000000, id: n => 'seed-' + n }; e.stored = () => (e.asked++, stored); return e; };

head('the hash is FNV-1a, 32-bit');
{
  /* The FNV reference values: the offset basis for "", 0xe40c292c for "a", 0xbf9cf968 for "foobar". */
  ok('the published values, in base 36', safely(() => R.hash('')) === (0x811c9dc5).toString(36) && safely(() => R.hash('a')) === (0xe40c292c).toString(36) && safely(() => R.hash('foobar')) === (0xbf9cf968).toString(36),
     [R.hash(''), R.hash('a'), R.hash('foobar')].join(' '));
  ok('and a one-character change changes it', safely(() => R.hash('Apical sparing.')) !== safely(() => R.hash('Apical sparing!')));
}

const SEED = [{ title: 'Amyloid', body: 'Apical sparing.', tags: 'cmp', source: 'Seed' }, { title: 'HCM', body: 'SAM of the mitral valve.', tags: 'cmp', source: 'Seed' }];
const V = R.hash(J(SEED));

head('nothing to do');
{
  const e = env(null), cur = [{ id: 'x', title: 'Mine', body: 'b' }], before = J(cur);
  ok('no seed yet is nothing to do, and the stored version is not even asked', safely(() => R.apply(cur, [], e)) === null && safely(() => R.apply(cur, null, e)) === null && e.asked === 0 && J(cur) === before);
  const e2 = env(V);
  ok('this very seed already applied is nothing to do', safely(() => R.apply(cur, SEED, e2)) === null && e2.asked === 1 && J(cur) === before);
}

head('a fresh device');
{
  const cur = [], r = safely(() => R.apply(cur, SEED, env(null)));
  ok('gets every seeded note, and says so', J(r) === J({ version: V, added: 2, updated: 0 }), J(r));
  ok('each with its id, the time, the build\'s mark and the hash of its body', J(cur) === J([
    { id: 'seed-0', title: 'Amyloid', body: 'Apical sparing.', tags: 'cmp', source: 'Seed', ts: 1700000000000, seed: true, seedHash: R.hash('Apical sparing.') },
    { id: 'seed-1', title: 'HCM', body: 'SAM of the mitral valve.', tags: 'cmp', source: 'Seed', ts: 1700000000000, seed: true, seedHash: R.hash('SAM of the mitral valve.') }]), J(cur).slice(0, 120));
  ok('the version to store is the hash of the whole seed', r && r.version === R.hash(J(SEED)));
}

head('the fellow\'s writing is never touched');
{
  const mine = { id: 'm', title: 'Amyloid', body: 'My own words on amyloid.', tags: 'mine', source: '' };
  const cur = [clone(mine)], r = safely(() => R.apply(cur, SEED, env(null)));
  ok('a note they wrote is left as it was, under a seeded note\'s title, and the other is added', J(cur[0]) === J(mine) && cur.length === 2 && cur[1].title === 'HCM' && r.added === 1 && r.updated === 0, J(cur[0]).slice(0, 80));
  /* Seeded with "Old body", then edited by the fellow: its body no longer hashes to what was seeded. */
  const edited = { id: 's', title: 'Amyloid', body: 'Old body, and my addition.', tags: 'cmp', source: 'Seed', seed: true, seedHash: R.hash('Old body') };
  const cur2 = [clone(edited)];
  safely(() => R.apply(cur2, SEED, env(null)));
  ok('a seeded note they have edited is left alone', J(cur2[0]) === J(edited), J(cur2[0]).slice(0, 80));
}

head('the build\'s notes are kept up to date');
{
  const untouched = { id: 's', title: 'Amyloid', body: 'Old body', tags: 'old', source: 'Old', seed: true, seedHash: R.hash('Old body') };
  const cur = [clone(untouched)], r = safely(() => R.apply(cur, SEED, env('an older version')));
  ok('an untouched seeded note takes the new body, tags and source, and its fingerprint', cur[0].body === 'Apical sparing.' && cur[0].tags === 'cmp' && cur[0].source === 'Seed' && cur[0].seedHash === R.hash('Apical sparing.') && cur[0].id === 's',
     J(cur[0]).slice(0, 100));
  ok('and is counted as updated', r && r.updated === 1 && r.added === 1, J(r));
  const same = [{ id: 's', title: 'Amyloid', body: 'Apical sparing.', tags: 'cmp', source: 'Seed', seed: true, seedHash: R.hash('Apical sparing.') }];
  const r2 = safely(() => R.apply(same, SEED.slice(0, 1).concat([]), env('older')));
  ok('one already as the seed has it is not counted, but the version is still given to store', r2 && r2.updated === 0 && r2.added === 0 && r2.version === R.hash(J(SEED.slice(0, 1))), J(r2));
  /* Seeded before fingerprints existed: no seedHash, so an edit cannot be told from an original. */
  const legacy = [{ id: 'l', title: 'HCM', body: 'Machine-written once.', tags: '', source: '', seed: true }];
  safely(() => R.apply(legacy, SEED, env(null)));
  ok('one seeded before fingerprints existed is adopted, and gets one', legacy[0].body === 'SAM of the mitral valve.' && legacy[0].seedHash === R.hash('SAM of the mitral valve.'), J(legacy[0]).slice(0, 90));
  const noBody = [];
  safely(() => R.apply(noBody, [{ title: 'Empty', tags: '', source: '' }], env(null)));
  ok('a seeded note with no body is fingerprinted as empty', noBody[0] && noBody[0].seedHash === R.hash(''));
}

head('a deleted seeded note comes back with a new corpus');
{
  const cur = [{ id: 's', title: 'Amyloid', body: 'Apical sparing.', tags: 'cmp', source: 'Seed', seed: true, seedHash: R.hash('Apical sparing.') }];
  const r = safely(() => R.apply(cur, SEED, env('the version before HCM was deleted')));
  ok('the corpus changed, so the deleted note is added again', r && r.added === 1 && cur.length === 2 && cur[1].title === 'HCM', J(r));
}

head('the page\'s names are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  ok('refHash() is one line into the module, and refSeedApply() hands it the page\'s storage, clock and ids', n('function refHash(s){ return RefSeed.hash(s); }') === 1
     && n('const r=RefSeed.apply(cur,seed,{stored:()=>localStorage.getItem(REF_SEED_KEY),now:Date.now(),') === 1 && n('function refSeedApply(') === 1);
  ok('and stores the version, saving and re-indexing only when a note was added or changed',
     n('localStorage.setItem(REF_SEED_KEY, r.version);') === 1 && n('if(r.added || r.updated){') === 1);
  const slot = page.indexOf('@@SLOT[src:src/core/refseed.js]@@');
  ok('the module is written into the page once, above the line that seeds the library as it loads', slot >= 0 && n('@@SLOT[src:src/core/refseed.js]@@') === 1 && slot < page.indexOf('let REF = refSeedApply('), slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the page keeps no second copy of the rules', n('0x811c9dc5') === 0 && n('if(!r.seed) continue;') === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
