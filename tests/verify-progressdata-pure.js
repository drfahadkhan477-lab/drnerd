#!/usr/bin/env node
/*
 * What a saved progress record may hold, read before it is taken — src/core/progressdata.js.
 *
 *   node tests/verify-progressdata-pure.js
 *
 * Pure Node, over invented records. The module is loaded beside FSRS, MockExam and FlagSet, as the page loads it,
 * and every record and every expected answer is written out here, never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - a well-formed record restores to the state the app keeps, with each default where a field is absent;
 *   - a restore refuses, with an Error and before anything is returned, a record holding: a day that is not on the
 *     calendar, more correct than answered (per day, per chapter, per practice), a negative or non-numeric count, a
 *     card whose due day is not a day, a resume index past its deck, a map that is a list, a string field that is
 *     not a string, a missed list with a non-string, an exam entry the app never wrote, and a flag list that is not
 *     a list of question ids;
 *   - an absent flag list leaves the flags alone, and a list, even an empty one, replaces them;
 *   - an export keeps the good entries of each map and leaves the bad ones out, and cleans the exams and flags;
 *   - an exam date is a real day: 29 February only in a leap year;
 *   - nothing handed in is changed;
 *   - the page's names are the calls into this, and the module is written into the page above them, after the
 *     three modules it asks.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ctx = {}; vm.createContext(ctx);
for (const m of ['fsrs', 'mockexam', 'flagset', 'progressdata']) vm.runInContext(read('src/core/' + m + '.js'), ctx);
const P = ctx.ProgressData;
/* The module's sets are made in its own context, so they are of that context's Set, not this file's. */
const CSet = vm.runInContext('Set', ctx);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const show = v => JSON.stringify(v, (k, x) => x instanceof CSet || x instanceof Set ? ['Set', ...x] : x);
/* What a restore of r does: the state, or the message it refused with. */
const restore = r => { try { return { state: P.fromBackup(r) }; } catch (e) { return { refused: e.message }; } };
const copy = x => JSON.parse(JSON.stringify(x));

/* A record as the app writes one: every map with one good entry. */
const GOOD = {
  schemaVersion: 1, theme: 'nocturne', homeLayout: 'signal', sessionCorrect: 3, sessionTotal: 5,
  chStats: { Valvular: { correct: 3, total: 5 } }, missed: ['q2'],
  srs: { q1: { reps: 2, lapses: 0, ivl: 3, stability: 3.1, difficulty: 5, due: '2026-03-10', last: '2026-03-07' } },
  reviewStreak: 4, lastReviewDay: '2026-03-07', daily: { '2026-03-07': { a: 5, c: 3, r: 2 } },
  practice: { Valvular: { n: 4, c: 2, t: 90 } }, sinceBackup: 6, lastBackup: 1772800000000,
  resume: { review: { ids: ['q1', 'q2'], i: 1, correct: 1, total: 1, ts: 1772800000000, answers: { q1: 0 } } },
  focusMode: true, examDate: '2026-06-15',
  exams: [{ ts: 1772800000000, n: 2, answered: 2, correct: 1, ms: 120000, limit: null, ch: null, by: { Valvular: [1, 2] } }],
  flagged: ['q1'],
};

head('a record the app wrote restores to the state the app keeps');
{
  const r = restore(copy(GOOD)), s = r.state || {};
  ok('it is taken', !r.refused, r.refused || '');
  ok('each map and count as it was written', show(s.chStats) === show(GOOD.chStats) && show(s.srs) === show(GOOD.srs) && show(s.daily) === show(GOOD.daily)
     && show(s.practice) === show(GOOD.practice) && s.sessionCorrect === 3 && s.sessionTotal === 5 && s.reviewStreak === 4 && s.sinceBackup === 6);
  ok('missed and flagged as sets, the exam date kept, focus mode a boolean, and not yet resumed', s.missed instanceof CSet && [...s.missed].join() === 'q2'
     && s.flagged instanceof CSet && [...s.flagged].join() === 'q1' && s.examDate === '2026-06-15' && s.focusMode === true && s.resumed === false, show(s));
  ok('the exam history kept', Array.isArray(s.mocks) && s.mocks.length === 1 && s.mocks[0].correct === 1, show(s.mocks));
  const bare = restore({}).state || {};
  ok('an empty record restores to the defaults', show(bare.chStats) === '{}' && bare.sessionCorrect === 0 && bare.theme === 'auto' && bare.homeLayout === 'signal'
     && bare.lastReviewDay === null && bare.examDate === null && bare.focusMode === false && bare.missed instanceof CSet && bare.missed.size === 0, show(bare));
}

head('a record the app never wrote is refused, whole, before anything is taken');
{
  const bad = (label, change) => { const r = copy(GOOD); change(r); return [label, restore(r)]; };
  const cases = [
    bad('a daily key that is not on the calendar', r => { r.daily['2026-02-30'] = { a: 1, c: 1 }; }),
    bad('a day with more correct than answered', r => { r.daily['2026-03-07'].c = 9; }),
    bad('a chapter with more correct than answered', r => { r.chStats.Valvular.correct = 6; }),
    bad('practice with more correct than tried', r => { r.practice.Valvular.c = 5; }),
    bad('a chapter missing its total', r => { delete r.chStats.Valvular.total; }),
    bad('a negative count', r => { r.srs.q1.reps = -1; }),
    bad('a count that is a word', r => { r.daily['2026-03-07'].r = 'two'; }),
    bad('a card due on a day that is not a day', r => { r.srs.q1.due = '2026-13-01'; }),
    bad('a resume index past its deck', r => { r.resume.review.i = 2; }),
    bad('a resume deck holding a number', r => { r.resume.review.ids = ['q1', 7]; }),
    bad('a map that is a list', r => { r.srs = [r.srs.q1]; }),
    bad('a session count that is negative', r => { r.sessionTotal = -3; }),
    bad('a theme that is not a string', r => { r.theme = 3; }),
    bad('a missed list holding a number', r => { r.missed = ['q2', 4]; }),
    bad('an exam entry with more correct than answered', r => { r.exams[0].correct = 3; }),
    bad('a flag list that is not a list', r => { r.flagged = 'q1'; }),
  ];
  const let_in = cases.filter(([, r]) => !r.refused);
  ok('each of ' + cases.length + ' bad records is refused with an Error', let_in.length === 0, let_in.map(([l]) => l).join('; ') || 'all refused');
  ok('and says which kind of thing was wrong', cases.every(([, r]) => /^Invalid (statistics|missed list|exam history|flagged list)\.$/.test(r.refused || '')),
     [...new Set(cases.map(([, r]) => r.refused))].join(' | '));
}

head('the flags: absent says nothing; a list replaces them');
{
  const r = copy(GOOD); delete r.flagged;
  const absent = restore(r).state || {};
  ok('a backup made before flags carries no flagged field, so it cannot empty the flags made since', absent && !('flagged' in absent), show(absent && Object.keys(absent)));
  const r2 = copy(GOOD); r2.flagged = [];
  const empty = restore(r2).state || {};
  ok('an empty list is a list, and replaces them', empty.flagged instanceof CSet && empty.flagged.size === 0);
}

head('an export keeps what is good and leaves out what is not');
{
  const raw = copy(GOOD);
  raw.daily['2026-02-30'] = { a: 1, c: 1 };
  raw.chStats.Broken = { correct: 9, total: 2 };
  raw.srs.q9 = { reps: -1 };
  raw.exams.push({ ts: 0 });
  raw.flagged = ['q1', 'q1', 42];
  const before = show(raw);
  const out = P.usable(raw);
  ok('the bad entry of each map is left out, the good ones kept', Object.keys(out.daily).join() === '2026-03-07' && Object.keys(out.chStats).join() === 'Valvular'
     && Object.keys(out.srs).join() === 'q1', show([Object.keys(out.daily), Object.keys(out.chStats), Object.keys(out.srs)]));
  ok('the exam history keeps its valid entries only', out.exams.length === 1 && out.exams[0].ts === GOOD.exams[0].ts);
  ok('the flags are cleaned: no duplicate, no id that is not a question id', show(out.flagged) === show(['q1']), show(out.flagged));
  ok('and every other field is as it was', out.theme === 'nocturne' && out.sessionTotal === 5 && out.examDate === '2026-06-15');
  ok('what came in is as it was', show(raw) === before);
  ok('a record that is not an object comes back as it was', P.usable(null) === null && P.usable('x') === 'x');
}

head('an exam date is a real day');
{
  ok('a real day', P.examDay('2026-06-15') === true);
  ok('29 February in a leap year, and not in another', P.examDay('2028-02-29') === true && P.examDay('2027-02-29') === false);
  ok('not 31 April, not a month 13, not an unpadded day, not a number', P.examDay('2026-04-31') === false && P.examDay('2026-13-01') === false
     && P.examDay('2026-6-15') === false && P.examDay(20260615) === false);
  ok('and a restore drops an exam date that is not a day, keeping the rest', (restore(Object.assign(copy(GOOD), { examDate: '2026-02-30' })).state || {}).examDate === null);
}

head('the page\'s names are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(read('app/systole.html'));
  const once = text => page.split(text).length - 1 === 1;
  const lines = [
    'const statRecord=v=>ProgressData.record(v);',
    'function statEntryOk(k,v,key){ return ProgressData.entryOk(k,v,key); }',
    'function usableStats(raw){ return ProgressData.usable(raw); }',
    'function progressFromBackup(raw){ return ProgressData.fromBackup(raw); }',
    'function validExamDate(v){ return ProgressData.examDay(v); }',
  ];
  const missing = lines.filter(l => !once(l));
  ok('each old name is one line handing over what it was given', missing.length === 0, missing.join(' | ') || 'all five');
  ok('and the table and its day are no longer the page\'s own', !/const STAT_ENTRY\s*=|const statDay\s*=/.test(page));
  const at = m => page.indexOf('@@SLOT[src:src/core/' + m + '.js]@@');
  const slot = at('progressdata');
  ok('the module is written into the page once, after FSRS, MockExam and FlagSet and above every name that calls it', slot >= 0
     && page.indexOf('@@SLOT[src:src/core/progressdata.js]@@', slot + 1) < 0 && ['fsrs', 'mockexam', 'flagset'].every(m => at(m) >= 0 && at(m) < slot)
     && ['const statRecord=', 'function statEntryOk(', 'function usableStats(', 'function progressFromBackup(', 'function validExamDate('].every(t => page.indexOf(t) > slot),
     slot < 0 ? 'no slot' : 'slot at ' + slot);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
