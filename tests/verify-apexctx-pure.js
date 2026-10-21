#!/usr/bin/env node
/*
 * What Apex is told about the fellow's answer and their misses, and what it may not be told — over the page's own code.
 *
 *   node tests/verify-apexctx-pure.js
 *
 * No browser and no build. runTool(), flushNav(), aiCtx() and the helpers they call are cut out of app/systole.html
 * (tests/_appcut.js: each anchor once) and run in a vm over an invented world: one question keyed C, answered B, the review
 * log row the page writes for that answer, and the real src/core/apexsignals.js. Nothing here copies what the page does.
 *
 * What is measured, rather than assumed:
 *   - open mode is told what was chosen, that it was not the answer, how sure, how long and why the fellow says they missed it;
 *   - grounded mode, which withholds the answer key and the bank's wording, is told how sure and how long and that they answered,
 *     and nothing that names the option or says whether it was right or why it was missed: beside the missed-id lists it already
 *     has, each is the key by another name;
 *   - the misses tool gives the option chosen, the keyed option, the stem and the options' wording in open mode, and in grounded
 *     mode only which items and how they went in the fellow's own terms (a miss rules its option out, so that is withheld too);
 *   - the line about the question is told only on the quiz, for the question open, once it is answered;
 *   - the performance tool says how they answer and whether they are on track; the plan tool builds the session the page
 *     builds and queues it to open after the reply; a quiz can be asked of the flagged questions;
 *   - while a mock block is open every tool refuses, the bank door included, and nothing queued opens: a reply that was on its
 *     way when the block was opened cannot carry into it.
 */
'use strict';
const vm = require('vm');
const { cut } = require('./_appcut.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const safely = (fn, otherwise) => { try { return fn(); } catch (_) { return otherwise; } };

const APP = 'app/systole.html';
const code = [
  cut(APP, 'const BANK=(window.SYSTOLE_BANK', '\n/* ═══════════ custom line-icon system'),
  cut(APP, 'const STOP=new Set((', 'function refAdd(title,body,tags,source){'),
  cut(APP, 'const TOOLS=[', '\nlet pendingNav=null, toolTrace=[];'),
  cut(APP, 'function apexAway(){', '\nfunction runTool(name,input){'),
  cut(APP, 'function runTool(name,input){', '\nfunction flushNav(){'),
  cut(APP, 'function flushNav(){', '\n/* ═══════ reference-note library UI'),
  cut(APP, 'function apexStandingLines(){', '\nfunction aiCtx(q){'),
  cut(APP, 'function aiCtx(q){', '\nconst CHIPS=['),
].join('\n');

const NOW = Date.now(), DAY = 86400000;
const q = { id: 'ZZ_7', ch: 'Invented chapter', n: 7, ci: 2, s: 'An invented stem: transthyretin amyloidosis, tafamidis or not.',
  o: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((t, i) => ({ l: 'ABCDE'[i], t: t + 'opt', p: 10 + i })), ex: 'Invented commentary, keyed sentinel kz9.' };
const other = { id: 'ZZ_8', ch: 'Another chapter', n: 8, ci: 0, s: 'Another invented stem.', o: [{ l: 'A', t: 'aopt' }, { l: 'B', t: 'bopt' }], ex: 'Another commentary.' };

/* The review log as the page writes it: the miss on ZZ_7 (chose B, Certain, 94 s, "misread the stem") and, after it, the self-rating the
   review screen logs, which is not an answer and carries neither a reason nor a choice. */
const missRow = over => Object.assign({ t: NOW - DAY, q: 'ZZ_7', ch: q.ch, g: null, ok: 0, m: 'practice', ms: 94000, cf: 3, why: 'misread', pick: 1 }, over || {});

function world(over) {
  over = over || {};
  const calls = [];
  const ctx = {
    ALL_Q: [q, other], REF: [], Memory: { build: () => '' }, Vision: { figureContextLine: () => '' }, AI: { provider: 'gemini' },
    AI_GROUNDED: !!over.grounded, window: {}, BANK_INFO: require('../scripts/which-bank.js').ACCSAP,
    document: { documentElement: { hasAttribute: () => !!over.block } },
    ApexSignals: require('../src/core/apexsignals.js').ApexSignals,
    LOG: over.log || [missRow()], QBYID: { ZZ_7: q, ZZ_8: other },
    S: Object.assign({ screen: 'quiz', questions: [q], qIdx: 0, answered: true, selected: 1, answers: { 0: { cf: 3 } }, flagged: new Set(),
      missed: new Set(['ZZ_7']), mocks: [], examDate: null, chStats: { 'Invented chapter': { correct: 3, total: 10 } }, srs: {}, sessionCorrect: 3, sessionTotal: 10 }, over.S || {}),
    POOL: [q, other], CHAPTERS: [q.ch, other.ch].sort(), flaggedQs: () => (over.flagged || []), FSRS: { todayISO: () => '2026-10-16', daysBetween: () => 41 },
    examDaysLeft: () => (over.daysLeft === undefined ? null : over.daysLeft),
    dueQuestions: () => [], TOTAL_Q: 2, recentPerDay: () => 6,
    StudyPlan: { readiness: () => ({ text: 'INVENTED-READINESS: 41 days left, on track.' }) },
    planNow: m => ({ items: over.noPlan ? [] : [{ id: 'ZZ_7' }, { id: 'ZZ_8' }], text: over.noPlan ? 'Nothing to plan: there are no questions to draw from.' : m + ' min · 2 questions: 1 due for review, 1 new.' }),
    startPlan: m => calls.push(['plan', m]), jumpTo: id => calls.push(['open', id]), startQuiz: (ch, mode) => calls.push(['startQuiz', mode]),
    startAdhocQuiz: qs => calls.push(['quiz', qs.map(x => x.id)]), shuf: a => a, pendingNav: null,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  ctx.AI_GROUNDED = !!over.grounded;
  ctx.calls = calls;
  ctx.tools = () => vm.runInContext('TOOLS', ctx);
  return ctx;
}
const text = (ctx, name, input) => safely(() => String(ctx.runTool(name, input || {}).result), 'THREW');
const ctxOf = (ctx, qq) => safely(() => ctx.aiCtx(qq), 'THREW');
const didLine = c => (c.match(/WHAT THE FELLOW DID ON THIS ITEM[^\n]*\n[^\n]*/) || [''])[0];

head('open mode: told what the fellow did, and what was wrong with it');
{
  const c = ctxOf(world(), q), d = didLine(c);
  ok('what was chosen, that it was not the answer, how sure, how long, and the reason they gave',
    /The fellow chose B, which was not the answer\. Before answering they marked themselves "Certain"\. They took 94 s\. They say they missed it because: Misread the stem\./.test(d), d);
  ok('and the instruction to engage with it, and to press on a wrong answer given with confidence', /engage with it\. A wrong answer given with high confidence is the most valuable thing to correct/.test(d));
  ok('a flag on the question is told too', /They flagged it to come back to\./.test(didLine(ctxOf(world({ S: { flagged: new Set(['ZZ_7']) } }), q))));
  ok('a right answer is told as right, with no reason',
    (() => { const d2 = didLine(ctxOf(world({ S: { selected: 2 }, log: [missRow({ ok: 1, pick: 2, why: null })] }), q)); return /The fellow chose C, which was right\./.test(d2) && !/because/.test(d2); })());
  ok('the reason comes from the answer, not from the self-rating logged after it',
    /missed it because: Misread the stem/.test(didLine(ctxOf(world({ log: [missRow(), { t: NOW, q: 'ZZ_7', ch: q.ch, g: 1, ok: 0, m: 'review', ms: null, cf: null, why: null, pick: null }] }), q))));
  ok('the time and the reason are those of the question open: another question\'s row does not lend its own',
    (() => { const d2 = didLine(ctxOf(world({ log: [missRow(), missRow({ q: 'ZZ_8', ms: 5000, why: 'gap' })] }), q)); return /They took 94 s/.test(d2) && /Misread the stem/.test(d2); })());
  ok('a question not answered yet is told nothing of this, whatever option is still marked', !/WHAT THE FELLOW DID/.test(ctxOf(world({ S: { answered: false, selected: null } }), q)) && !/WHAT THE FELLOW DID/.test(ctxOf(world({ S: { answered: false, selected: 1 } }), q)));
  ok('nor on any screen but the quiz', !/WHAT THE FELLOW DID/.test(ctxOf(world({ S: { screen: 'home' } }), q)));
  ok('nor for a question that is not the one open', !/WHAT THE FELLOW DID/.test(ctxOf(world({ S: { questions: [other] } }), q)));
  ok('nor without a recorded choice', !/WHAT THE FELLOW DID/.test(ctxOf(world({ S: { selected: null } }), q)));
  ok('the model is not told it in the browsing context, where no question is open', !/WHAT THE FELLOW DID/.test(ctxOf(world(), null)));
}

head('the choice is told in the bank\'s own letters, from the latest answer, and with the history there is');
{
  const odd = { id: 'ZZ_9', ch: 'Lettered chapter', n: 9, ci: 3, s: 'A stem.', o: ['v', 'w', 'x', 'y'].map((t, i) => ({ l: 'VWXY'[i], t: t + 'opt' })), ex: 'x' };
  const w = world({ S: { questions: [odd], selected: 1, answers: { 0: { cf: 1 } } }, log: [missRow({ q: 'ZZ_9', pick: 1 })] });
  w.QBYID.ZZ_9 = odd;
  const d = didLine(ctxOf(w, odd));
  ok('the letter is the bank\'s: a choice of the second option in a bank lettered V to Y is W', /The fellow chose W, which was not the answer\./.test(d), d);
  ok('the latest answer to the question is the one that is told: its reason, not an earlier one\'s',
    (() => { const d2 = didLine(ctxOf(world({ log: [missRow({ why: 'gap', ms: 5000 }), missRow({ why: 'misread', ms: 94000 })] }), q)); return /Misread the stem/.test(d2) && /94 s/.test(d2) && !/Didn't know/.test(d2); })());
  const block = { ts: NOW - 2 * DAY, n: 20, answered: 20, correct: 15, ms: 600000, limit: null, ch: null, by: { A: [8, 10], B: [7, 10] } };
  ok('the last mock block is in how they answer', /Last mock block \(2 days ago\): 15 of 20 right \(75%\)/.test(ctxOf(world({ S: { mocks: [block] } }), q)));
  ok('a tool called with no input is a tool called with none', /\[ZZ_7\]/.test(safely(() => String(world().runTool('get_misses').result), 'THREW')));
}

head('grounded mode: the choice, the confidence and the time, and nothing that is the key by another name');
{
  const c = ctxOf(world({ grounded: true }), q), d = didLine(c);
  ok('grounded mode is genuinely on', /commentary for this item is withheld/.test(c));
  ok('that they answered, how sure, how long: and not which option', /They have answered; the option they chose is withheld in grounded mode\. Before answering they marked themselves "Certain"\. They took 94 s\./.test(d) && !/fellow chose/.test(d), d);
  ok('and no verdict, no reason, no remark about a wrong answer',
    !/not the answer|which was right|because|wrong|most valuable/.test(d), d);
  ok('a right answer reads the same as a wrong one, and a different option the same as this one: the option is not told, so the record cannot give the key',
    didLine(ctxOf(world({ grounded: true, S: { selected: 2 }, log: [missRow({ ok: 1, pick: 2, why: null })] }), q)) === d);
  ok('the key, the commentary and the candidates\' percentages are still withheld',
    !/← CORRECT|kz9|of candidates chose|OFFICIAL/.test(c));
}

head('how they answer: told in both modes, whatever the question');
{
  const log = Array.from({ length: 14 }, (_, i) => missRow({ q: 'X' + i, ok: i < 9 ? 1 : 0, cf: 3, why: i < 9 ? null : 'gap', pick: null }));
  for (const grounded of [false, true]) {
    const w = world({ grounded, log: log.concat([missRow()]), daysLeft: 41, flagged: [q] });
    const c = ctxOf(w, q);
    ok((grounded ? 'grounded' : 'open') + ': the block is there, with certain-and-wrong, the exam and the flags',
      /HOW THE FELLOW ANSWERS/.test(c) && /Marked Certain on 15 answers and was wrong on 6 of them \(40%\)\./.test(c) && /The exam is in 41 days\./.test(c) && /1 question flagged to come back to\./.test(c));
  }
  ok('and in the browsing context, where no question is open', /HOW THE FELLOW ANSWERS[^\n]*\n[^\n]*Marked Certain/.test(ctxOf(world({ log }), null)));
  ok('a thin log says nothing: no block at all', !/HOW THE FELLOW ANSWERS/.test(ctxOf(world(), q)));
  ok('a log that is not a list costs the block and not the turn', (() => { const c = ctxOf(world({ log: 'abc' }), q); return typeof c === 'string' && c !== 'THREW' && !/HOW THE FELLOW ANSWERS/.test(c) && /CURRENT QUESTION/.test(c); })());
  ok('and when the module is missing the turn goes on', (() => { const w = world(); w.ApexSignals = undefined; const c = ctxOf(w, q); return c !== 'THREW' && /CURRENT QUESTION/.test(c) && !/WHAT THE FELLOW DID|HOW THE FELLOW ANSWERS/.test(c); })());
}

head('get_misses: the keyed option and the wording in open mode, only which items in grounded mode');
{
  const open = text(world(), 'get_misses');
  ok('open: the item, the choice and the key, how sure, the reason, the time', /\[ZZ_7\] Invented chapter, item 7 — yesterday\n  Chose B; the key is C\. Marked "Certain"\. Reason given: Misread the stem\. 94 s\./.test(open), open.slice(0, 220));
  ok('open: the stem and the wording of the two options', /Stem: An invented stem/.test(open) && /\n  B: betaopt/.test(open) && /\n  C: gammaopt/.test(open));
  ok('open: not the commentary, which the bank tool gives and this does not', !/kz9/.test(open));
  const g = text(world({ grounded: true }), 'get_misses'), rows = g.split('\n\n').slice(1).join('\n\n');
  ok('grounded: the item, how sure, the reason and the time', /\[ZZ_7\] Invented chapter, item 7 — yesterday\n  Marked "Certain"\. Reason given: Misread the stem\. 94 s\./.test(g), g.slice(0, 260));
  ok('grounded: no choice, no key, no stem, no option wording, no commentary', !/Chose|Choice|the key|Stem:|opt\b|kz9|transthyretin|tafamidis/.test(rows), rows.slice(0, 200));
  ok('grounded: it says it withholds them, so the model does not go looking', /Grounded mode: the key, the stems, the options' wording and the option the fellow chose are withheld\./.test(g));

  ok('a question answered right since is not a miss', /No recent misses/.test(text(world({ log: [missRow(), missRow({ ok: 1, pick: 2, why: null })] }), 'get_misses')));
  ok('nor one the app no longer calls missed', /No recent misses/.test(text(world({ S: { missed: new Set() } }), 'get_misses')));
  ok('the limit is the fellow\'s to ask for, one to fifteen', (() => {
    const many = Array.from({ length: 20 }, (_, i) => missRow({ q: 'L' + i, t: NOW - i * 1000 }));
    const w = world({ log: many }); const byId = {}; many.forEach(r => { byId[r.q] = Object.assign({}, other, { id: r.q }); }); w.QBYID = byId; w.S.missed = new Set(many.map(r => r.q));
    const n = input => (String(w.runTool('get_misses', input).result).match(/^\[L\d+\]/gm) || []).length;
    return n({}) === 8 && n({ limit: 3 }) === 3 && n({ limit: 99 }) === 15 && n({ limit: 0 }) === 1;
  })());
}

head('the tools the page declares');
{
  const w = world(), tools = safely(() => w.tools(), []);
  const names = tools.map(x => x.name);
  const byName = n => tools.filter(x => x.name === n)[0] || {};
  ok('the misses tool and the plan tool are declared, with their one argument each',
    names.indexOf('get_misses') >= 0 && names.indexOf('plan_session') >= 0 &&
    (byName('get_misses').input_schema || { properties: {} }).properties.limit.type === 'integer' && (byName('plan_session').input_schema || { properties: {} }).properties.minutes.type === 'integer');
  ok('the quiz tool can be asked of the flagged questions', ((byName('start_quiz').input_schema || { properties: {} }).properties.flagged_only || {}).type === 'boolean');
  ok('every tool the page declares has a door: none answers "Unknown tool."', names.length >= 10 && names.every(n => text(world(), n) !== 'Unknown tool.'), names.filter(n => text(world(), n) === 'Unknown tool.').join(' '));
  ok('the misses tool says what open mode gives and what grounded mode withholds',
    /the keyed option, the stem and the wording of the two options/.test(byName('get_misses').description || '') &&
    /Grounded mode withholds the keyed option, the stems, the options' wording and the option they chose/.test((safely(() => world({ grounded: true }).tools(), []).filter(x => x.name === 'get_misses')[0] || {}).description || ''));
  ok('and the performance tool says it now also tells how they answer and whether they are on track', /how they answer/.test(byName('get_performance').description || '') && /on track/.test(byName('get_performance').description || ''));
}

head('get_performance, plan_session and start_quiz');
{
  const log = Array.from({ length: 14 }, (_, i) => missRow({ q: 'X' + i, ok: i < 9 ? 1 : 0, cf: 3, why: i < 9 ? null : 'gap', pick: null }));
  const perf = text(world({ log }), 'get_performance');
  ok('performance still gives the score and the chapters', /Answered overall: 3\/10/.test(perf) && /Invented chapter: 3\/10 \(30%\)/.test(perf), perf.slice(0, 160));
  ok('and now how they answer', /\n\nHow they answer:\nMarked Certain on 14 answers and was wrong on 5 of them \(36%\)\./.test(perf));
  ok('and whether they are on track', /\n\nOn track for the exam\? INVENTED-READINESS: 41 days left, on track\./.test(perf));
  ok('a thin log adds no "how they answer" section', !/How they answer/.test(text(world(), 'get_performance')));
  const w = world();
  const planned = text(w, 'plan_session', { minutes: 30 });
  ok('plan: it says what the session holds and that it opens after the reply', /^30 min · 2 questions: 1 due for review, 1 new\. It will open as a review session as soon as this reply finishes/.test(planned), planned);
  ok('plan: the session is queued, not started', JSON.stringify(w.pendingNav) === '{"kind":"plan","minutes":30}' && w.calls.length === 0);
  w.flushNav();
  ok('and opens when the reply is over, as the page\'s own plan', JSON.stringify(w.calls) === '[["plan",30]]' && w.pendingNav === null);
  ok('minutes: five to a hundred and twenty, twenty when not a whole number', (() => {
    const m = input => { const x = world(); x.runTool('plan_session', input); return x.pendingNav && x.pendingNav.minutes; };
    return m({ minutes: 1 }) === 5 && m({ minutes: 500 }) === 120 && m({ minutes: 45 }) === 45 && m({}) === 20 && m({ minutes: '45' }) === 20 && m({ minutes: 2.5 }) === 20;
  })());
  ok('nothing to plan: it says so and queues nothing', (() => { const x = world({ noPlan: true }); const r = text(x, 'plan_session'); return /Nothing to plan/.test(r) && x.pendingNav === null; })());
  const fq = world({ flagged: [q, other] });
  fq.runTool('start_quiz', { flagged_only: true });
  ok('a quiz of the flagged questions', JSON.stringify(fq.pendingNav) === '{"kind":"quiz","ids":["ZZ_7","ZZ_8"]}', JSON.stringify(fq.pendingNav));
  ok('flagged and missed together are the flagged questions that are missed', (() => { const x = world({ flagged: [q, other] }); x.runTool('start_quiz', { flagged_only: true, missed_only: true }); return JSON.stringify(x.pendingNav) === '{"kind":"quiz","ids":["ZZ_7"]}'; })());
  ok('flagged restricts what else was asked: ids to the flagged ones among them, a chapter to the flagged in it, none flagged there is none', (() => {
    const run = (flagged, input) => { const x = world({ flagged }); const r = text(x, 'start_quiz', input); return { nav: JSON.stringify(x.pendingNav), r }; };
    return run([other], { question_ids: ['ZZ_7', 'ZZ_8'], flagged_only: true }).nav === '{"kind":"quiz","ids":["ZZ_8"]}' &&
      run([q, other], { chapter: 'Another', flagged_only: true }).nav === '{"kind":"quiz","ids":["ZZ_8"]}' &&
      /No questions matched/.test(run([q], { question_ids: ['ZZ_8'], flagged_only: true }).r) && /No questions matched/.test(run([q], { chapter: 'Another', flagged_only: true }).r);
  })());
  ok('with nothing flagged no quiz is built', (() => { const x = world({ flagged: [] }); const r = text(x, 'start_quiz', { flagged_only: true }); return /No questions matched/.test(r) && x.pendingNav === null; })());
}

head('a mock block is open: every tool refuses, and nothing queued opens');
{
  const w = world({ block: true, flagged: [q] });
  const refuse = r => /mock exam block is open/.test(r) && !/Correct:|Commentary:|kz9|betaopt|gammaopt|transthyretin/.test(r);
  const calls = [['search_question_bank', { query: 'tafamidis transthyretin amyloidosis' }], ['get_performance', {}], ['get_misses', {}], ['plan_session', { minutes: 20 }],
    ['start_quiz', { question_ids: ['ZZ_7'] }], ['open_question', { question_id: 'ZZ_7' }], ['start_review_session', {}]];
  ok('each of seven tools refuses, and gives nothing from the bank', calls.every(([n, i]) => refuse(text(w, n, i))), calls.map(([n, i]) => refuse(text(w, n, i)) ? '' : n).join(' '));
  ok('and queues nothing', w.pendingNav === null);
  w.pendingNav = { kind: 'plan', minutes: 20 }; w.flushNav();
  ok('a navigation already queued does not open into the block, and is dropped', w.calls.length === 0 && w.pendingNav === null);
  ok('apexAway says it', w.apexAway() === true && world().apexAway() === false);
  /* The block's screen is set but the page has not drawn it: the render, which sets the attribute, runs inside a view transition. */
  const coming = world({ S: { screen: 'mock', mock: { ids: ['ZZ_7'] } } });
  ok('apexAway is true from the moment the block\'s screen is set, before the page has drawn it; a screen with no block, and a block on another screen, are not',
    coming.apexAway() === true && world({ S: { screen: 'mock', mock: null } }).apexAway() === false && world({ S: { screen: 'home', mock: { ids: ['ZZ_7'] } } }).apexAway() === false);
  ok('and then every tool refuses and a queued move is dropped', calls.every(([n, i]) => refuse(text(coming, n, i))) && (() => { coming.pendingNav = { kind: 'plan', minutes: 20 }; coming.flushNav(); return coming.calls.length === 0 && coming.pendingNav === null; })());
  const clear = world({ flagged: [q] });
  ok('with no block open the same tools answer', !/mock exam block is open/.test(text(clear, 'get_misses')) && !/mock exam block is open/.test(text(clear, 'get_performance')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
