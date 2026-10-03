#!/usr/bin/env node
/*
 * Explain it first: before a section's lesson is shown, what the learner
 * remembers is marked against its key points (memorizer/src/study.js
 * recallDue, recallFirst). The lesson screen itself is driven in a browser
 * by tests/verify-memorizer.js and tests/verify-memorizer-studyimport.js.
 *
 *   node tests/verify-memorizer-recall-pure.js
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const Study = require(path.join(__dirname, '..', 'memorizer', 'src', 'study.js'));
const POINTS = [
  'Preload is the stretch on the ventricular wall at the end of filling.',
  'Diuretics reduce preload by lowering the circulating volume.',
  'An LVEDP above 18 mmHg marks raised filling pressure.',
];
const TEXT = POINTS.join(' ') + ' Venous return sets preload.';

head('when the lesson waits');
const DAY = '2026-09-29', NEXT = '2026-09-30';
ok('not on a first visit: there is nothing to remember yet', Study.recallDue({ lesson: {}, done: false, seenDay: DAY }, NEXT) === false && Study.recallDue(undefined, NEXT) === false);
ok('not the same day it was drilled: minutes after a drill it is only in the way', Study.recallDue({ done: true, seenDay: DAY }, DAY) === false);
ok('on coming back to a drilled section on a later day', Study.recallDue({ done: true, seenDay: DAY }, NEXT) === true);
ok('not when the app has no day for it (a session saved before days were kept)', Study.recallDue({ done: true }, NEXT) === false);

head('what is marked');
const short = Study.recallFirst('preload is stretch', POINTS, TEXT);
ok('fewer than ' + Study.RECALL_MIN_WORDS + ' words is not marked, and says so', short.tooShort === true && short.gaps.length === 0);
const some = Study.recallFirst('Preload is the stretch on the ventricular wall at the end of filling, set by venous return.', POINTS, TEXT);
ok('what was said is known, what was not is a gap to be taught first', JSON.stringify(some.known) === '[0]' && JSON.stringify(some.gaps) === '[1,2]', JSON.stringify(some));
const all = Study.recallFirst('Preload is the stretch on the ventricular wall at the end of filling. Diuretics reduce preload by lowering circulating volume. LVEDP above 18 mmHg marks raised filling pressure.', POINTS, TEXT);
ok('everything said leaves no gap', all.gaps.length === 0 && all.known.length === 3, JSON.stringify(all));
const wrong = Study.recallFirst('Preload is the stretch at the end of filling, and an LVEDP above 25 mmHg is raised.', POINTS, TEXT);
ok('a number the section does not have is named', JSON.stringify(wrong.wrong) === '["25"]', JSON.stringify(wrong.wrong));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
