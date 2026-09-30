#!/usr/bin/env node
/*
 * The layout rules from the owner's review, where they are decisions rather
 * than styling:
 *   · a lesson's first screen holds its first Sheet.KEY_FACTS points, under
 *     their headings, and the rest wait for a fold (sheet.js splitPoints);
 *   · a unit's page leads with one next step and why (home.js nextStep):
 *     missed items first once there are enough of them, then the next
 *     section, then the exam.
 * The screens themselves are driven by tests/verify-memorizer-studyimport.js
 * and tests/verify-memorizer.js.
 *
 *   node tests/verify-memorizer-layout-pure.js
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const SRC = path.join(__dirname, '..', 'memorizer', 'src');
const Sheet = require(path.join(SRC, 'sheet.js'));
const Home = require(path.join(SRC, 'home.js'));

head('the lesson’s first screen');
const P = (h, n) => ({ heading: h, points: Array.from({ length: n }, (_, i) => ({ text: h + ' ' + (i + 1) })) });
const sp = Sheet.splitPoints([P('Definition', 3), P('Treatment', 4)]);
ok('the first ' + Sheet.KEY_FACTS + ' points are on the first screen, in order, under their own headings',
   JSON.stringify(sp.first.map(g => [g.heading, g.points.map(p => p.text)])) === JSON.stringify([['Definition', ['Definition 1', 'Definition 2', 'Definition 3']], ['Treatment', ['Treatment 1', 'Treatment 2']]]),
   JSON.stringify(sp.first));
ok('the rest wait, under their headings, and are counted', sp.restN === 2 && JSON.stringify(sp.rest.map(g => [g.heading, g.points.length])) === '[["Treatment",2]]', JSON.stringify(sp.rest));
const few = Sheet.splitPoints([P('Definition', 2)]);
ok('a short lesson has nothing to fold', few.restN === 0 && few.rest.length === 0 && few.first[0].points.length === 2);
ok('the first screen holds between 3 and 5 points, as the review asked', Sheet.KEY_FACTS >= 3 && Sheet.KEY_FACTS <= 5);

head('what to do now');
ok('nothing drilled: start with the first section', Home.nextStep(4, 0, 0, 'Preload').kind === 'start' && /Preload/.test(Home.nextStep(4, 0, 0, 'Preload').why));
ok('part drilled, few misses: continue with the next section', Home.nextStep(4, 2, Home.REVIEW_FIRST - 1, 'Afterload').kind === 'continue');
ok('enough misses waiting: a review round first, and it says how many', (s => s.kind === 'review' && /^3 items you missed are waiting/.test(s.why))(Home.nextStep(4, 2, 3, 'Afterload')));
ok('misses come before the exam too', Home.nextStep(4, 4, 5, '').kind === 'review');
ok('every section drilled and few misses: the exam', Home.nextStep(4, 4, 0, '').kind === 'exam' && /Retake/.test(Home.nextStep(4, 4, 0, '', 0.8).why));

head('the backup reminder');
const Study = require(path.join(SRC, 'study.js'));
const due = (n, last, snooze, day) => Home.backupDue(n, last, snooze, day, Study.daysFrom);
ok('nothing studied, nothing to lose: no reminder', due(0, null, null, '2026-09-30').due === false);
ok('units and no backup yet: reminded', due(1, null, null, '2026-09-30').due === true);
ok('a backup ' + (Home.BACKUP_EVERY - 1) + ' days old: not yet', due(1, '2026-09-24', null, '2026-09-30').due === false);
ok('a backup ' + Home.BACKUP_EVERY + ' days old: reminded, with how old', (b => b.due && /7 days ago/.test(b.why))(due(1, '2026-09-23', null, '2026-09-30')));
ok('"Later" puts it off for the day, and only the day', due(1, null, '2026-09-30', '2026-09-30').due === false && due(1, null, '2026-09-29', '2026-09-30').due === true);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
