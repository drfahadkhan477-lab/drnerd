#!/usr/bin/env node
/*
 * The figure auditor's classifier fires on a stem that points at a picture,
 * and stays quiet on one that only sounds like it does.
 *
 *   node tests/verify-figaudit.js
 *
 * Pure Node, no browser, no target argument, no licensed content — every
 * fixture below was written for this file. Same shape as verify-fsrs.js.
 *
 * WHAT IS BEING PROVEN, and why it needs proving. tools/figure-audit.js exists
 * because three separate build gates all check a question against its own
 * declaration — q.img, q.figs, q.imgopt — and none of them reads the question.
 * A stem saying "the tracing shown below" while carrying img: 0 is perfectly
 * self-consistent and passes all three, yet reaches the fellow as a question
 * about a picture that is not on the screen. From the other side of the glass
 * that is indistinguishable from a figure that failed to load, in either build.
 *
 * A regex over clinical prose is only useful if its false-positive rate is
 * known, so the quiet cases below matter at least as much as the loud ones —
 * an auditor that flags a third of the bank tells you nothing. The innocent
 * fixtures are real cardiology phrasings that contain the trigger words and
 * mean nothing of the sort: "figure-of-eight", "an ECG was obtained", "as
 * shown in the trial". Each one is a way this tool could have been wrong.
 */
'use strict';
const { scan, figCount } = require('../tools/figure-audit.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* ── it fires where it must ─────────────────────────────────────────────── */
head('a stem that points at a picture is caught');

const POINTS_AT_A_PICTURE = [
  ['modality then "below"',      'A 64-year-old man presents with palpitations. The ECG below shows which rhythm?'],
  ['modality then "shown"',      'The rhythm strip shown was recorded during the episode. What is the diagnosis?'],
  ['"shown" then modality',      'Shown is a transthoracic echocardiogram from a 30-year-old athlete.'],
  ['numbered figure',            'Which finding in Figure 1 best explains the murmur?'],
  ['abbreviated figure',         'Based on Fig. 2, what is the most likely diagnosis?'],
  ['lettered panel',             'Panel B demonstrates which abnormality?'],
  ['"this" + modality',          'This coronary angiogram was obtained during chest pain. Next step?'],
  ['"the following" + modality', 'The following pressure tracing was recorded at catheterization.'],
  ['"the accompanying"',         'The accompanying chest radiograph shows what finding?'],
  ['asks what is seen',          'What abnormality is demonstrated in the figure?'],
  ['imaging noun, deictic',      'The cardiac MRI displayed here is most consistent with which diagnosis?'],
];
for (const [label, text] of POINTS_AT_A_PICTURE) {
  const hit = scan(text);
  ok(label, !!hit, hit ? `“${hit.phrase}”` : 'NOT CAUGHT');
}

/* ── and it stays quiet where it must ───────────────────────────────────── */
head('prose that merely contains the words is left alone');

const INNOCENT_PROSE = [
  ['a modality in history only',  'An ECG was obtained in the emergency department and was unremarkable.'],
  ['a deictic clause, not a ref',  'This patient underwent coronary angiography two years ago.'],
  ['a deictic about a trial',      'This study reported a 20% reduction in the primary endpoint.'],
  ['a modality as a plan',        'The next step is to obtain a transthoracic echocardiogram.'],
  ['a modality as a finding',     'Echocardiography revealed a left ventricular ejection fraction of 35%.'],
  ['figure-of-eight',             'The defect was closed with a figure-of-eight suture.'],
  ['a trial, not a picture',      'As shown in the trial, mortality was reduced by 18% at one year.'],
  ['a study, not a picture',      'This was demonstrated in the registry analysis of 12,000 patients.'],
  ['a cited legend',              'The values are listed in the figure legend of the original publication.'],
  ['a number that is not a figure','The patient was seen in clinic 2 weeks after discharge.'],
  ['scan as a verb-adjacent noun','A CT scan is indicated if the D-dimer is elevated.'],
  ['plain clinical narrative',    'A 55-year-old woman reports exertional dyspnoea for three months.'],
];
for (const [label, text] of INNOCENT_PROSE) {
  const hit = scan(text);
  ok(label, !hit, hit ? `WRONGLY CAUGHT on “${hit.phrase}”` : '');
}

/* ── the classifier can actually fail ───────────────────────────────────── */
/* Fail-first, inverted: a check that only ever passes proves nothing, so this
   asserts the two populations above are genuinely separated by the patterns
   and not by an accident of how the fixtures were phrased. If scan() were
   stubbed to always return a hit, the quiet block fails; if it were stubbed to
   always return null, the loud block fails. Neither can be silently true. */
head('the two populations are actually distinguished');
{
  const loud  = POINTS_AT_A_PICTURE.filter(([, t]) => scan(t)).length;
  const quiet = INNOCENT_PROSE.filter(([, t]) => !scan(t)).length;
  ok('every pointing stem fires',  loud  === POINTS_AT_A_PICTURE.length,
     `${loud}/${POINTS_AT_A_PICTURE.length}`);
  ok('every innocent stem is quiet', quiet === INNOCENT_PROSE.length,
     `${quiet}/${INNOCENT_PROSE.length}`);
  ok('and the tool is not simply always-on',
     scan('') === null && scan(undefined) === null && scan('Aspirin 81 mg daily.') === null);
}

/* ── figCount reads the field the app's own rendering reads ─────────────── */
/* This is not a formality. verify-content.js carries a long note about exactly
   this: five real questions (COR_102, HEA_3, HEA_40, HEA_56, VAL_65) carry a
   real img count with an empty figs array, and a tool that read figs alone
   would report all five as missing their figures when none of them are. That
   is the precise false alarm this audit exists to avoid producing. */
head('a question figure count is read the way the app reads it');
{
  ok('img alone counts',                 figCount({ img: 2 }) === 2);
  ok('figs alone counts',                figCount({ figs: ['a.webp'] }) === 1);
  ok('img wins when both are present',   figCount({ img: 2, figs: ['a.webp', 'b.webp'] }) === 2);
  ok('img counts even with figs empty',  figCount({ img: 1, figs: [] }) === 1,
     'the COR_102 / HEA_3 / HEA_40 / HEA_56 / VAL_65 shape');
  ok('neither means none',               figCount({ id: 'X' }) === 0);
  ok('an explicit zero means none',      figCount({ img: 0, figs: [] }) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
