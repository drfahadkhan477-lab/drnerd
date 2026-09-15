#!/usr/bin/env node
/*
 * What Apex remembers, and how much of it it is allowed to say — in bare Node.
 *
 *   node tests/verify-memory-pure.js
 *
 * memory.js depends on two app globals and nothing else, so it loads here with
 * loadJSON/saveJSON stubbed and needs no browser and no build. It was one of
 * four core modules with no direct test at all: verify-memory.js drives it
 * through the built app, which is thorough and also means every check costs a
 * forty-minute build on the one laptop that has the licensed export.
 *
 * TWO THINGS ARE PROVEN HERE.
 *
 * 1. PROVENANCE. Both writers are the model — the `remember` tool and the
 *    summariser — and nothing recorded which, nor the difference that matters
 *    more: whether the fellow SAID it or Apex CONCLUDED it. Stored identically,
 *    rendered identically, read back as established fact. An inference
 *    presented as their own words is how a tutor ends up confidently teaching
 *    around a weakness they never had.
 *
 * 2. THE BUDGET, and this one was found by measuring rather than reasoning.
 *    verify-memory.js has always asserted the whole block stays under 1600
 *    chars, and BUDGET bounds only the LINES — so the preamble's length was
 *    never accounted for anywhere. Adding provenance markers lengthened it, and
 *    a full store came out at 1641. Over the bound, in a check that only runs
 *    on the laptop. The worst case is asserted here now, so the next person to
 *    lengthen that preamble finds out in CI.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* A fresh store per test. memory.js reads once at load, so each call reloads
   the module rather than trying to reset it — closer to what a page reload
   does anyway. */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'memory.js'), 'utf8');
function fresh(seed) {
  let store = seed === undefined ? null : seed;
  const root = {
    loadJSON: (k, d) => (store === null ? d : store),
    saveJSON: (k, v) => { store = v; },
  };
  new Function('loadJSON', 'saveJSON', SRC).call(root, root.loadJSON, root.saveJSON);
  return { M: root.Memory, dump: () => store };
}

head('a memory records where it came from');
{
  const { M } = fresh();
  const stated = M.add('Sitting the boards in October 2026.', 'fact', { src: 'tool', said: true });
  ok('a fact the fellow stated is marked as said', stated.said === true);
  ok('and records which mechanism wrote it', stated.src === 'tool', String(stated.src));

  const guessed = M.add('Keeps reading constrictive as restrictive.', 'gap', { src: 'tool' });
  /* The safe default, and the reason it is the default: "did they really say
     that?" answered by omission has to mean no. */
  ok('an unmarked memory is stored as an inference, not as their words',
     guessed.said === false, String(guessed.said));

  const summary = M.add('Answered twelve on valvular disease.', 'session', { src: 'summary', said: false });
  ok('a session summary is always the summariser and never their words',
     summary.src === 'summary' && summary.said === false);

  const bare = M.add('Added the old way, with no meta at all.', 'fact');
  ok('a two-argument call still works and is treated as an inference',
     bare.said === false && bare.src === 'tool', `${bare.src}/${bare.said}`);
  ok('an unknown src is not stored as given', M.add('x'.repeat(12), 'fact', { src: 'nonsense' }).src === 'tool');
}

head('confirmation moves one way only');
{
  const { M } = fresh();
  const first = M.add('Sitting the boards in October.', 'fact', { src: 'tool' });
  ok('starts as an inference', first.said === false);
  const again = M.add('Sitting the boards in October.', 'fact', { src: 'tool', said: true });
  ok('saying it twice is still one memory', M.count() === 1, String(M.count()));
  ok('but the fellow confirming it upgrades it', again.said === true && again.id === first.id);
  /* And never back again: an inference must not quietly demote something they
     actually told you. */
  M.add('Sitting the boards in October.', 'fact', { src: 'tool', said: false });
  ok('and a later inference does not demote it', M.all()[0].said === true);
}

head('the model is told which is which');
{
  const { M } = fresh();
  M.add('Sitting the boards in October 2026.', 'fact', { src: 'tool', said: true });
  M.add('Keeps reading constrictive pericarditis as restrictive.', 'gap', { src: 'tool' });
  const block = M.build();
  ok('what they said carries no marker — the plain case is the strong one',
     /• \[m[a-z0-9]+\] Sitting the boards/.test(block));
  ok('what Apex concluded is marked', /\(inferred\) Keeps reading constrictive/.test(block));
  ok('and the marker is explained once, not on every line',
     (block.match(/\(inferred\)/g) || []).length === 2, 'once in the preamble, once on the line');
  ok('the preamble says what unmarked means', /Unmarked means they told you/.test(block));
  ok('and how to confirm one', /call remember again with said/.test(block));

  /* A record written before provenance existed is neither, and says so rather
     than being backfilled — the rule logReview follows for `ef`. */
  const { M: M2 } = fresh([{ id: 'mold1', text: 'Written before any of this existed.', kind: 'fact', created: 1, seq: 1 }]);
  ok('a record predating the field is marked unrecorded, not guessed at',
     /\(unrecorded\) Written before/.test(M2.build()));
  ok('and it is not silently backfilled', M2.all()[0].said === undefined, String(M2.all()[0].said));
}

head('the block fits the prompt budget it claims to');
{
  /* THE ONE THAT WAS ACTUALLY OVER. verify-memory.js asserts the whole block
     is under 1600 chars; BUDGET bounds only the lines. Filling the store with
     tagged memories is the worst case, because every line then carries a
     marker AND the preamble is at full length. */
  const { M } = fresh();
  for (let i = 0; i < 40; i++)
    M.add(`Confuses entity ${i} with entity ${i + 1} whenever the stem mentions a gradient.`, 'gap', { src: 'tool' });
  for (let i = 0; i < 20; i++)
    M.add(`Prefers explanation style ${i} with the mechanism stated before any trial data.`, 'preference', { src: 'tool' });
  const block = M.build();
  ok('a full store of marked memories stays under the 1600 verify-memory asserts',
     block.length < 1600, `${block.length} chars`);
  ok('and it is not trivially short — the budget is actually being used',
     block.length > 900, `${block.length} chars`);
  ok('an empty store says nothing at all', fresh().M.build() === '');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
