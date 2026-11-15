#!/usr/bin/env node
/*
 * The question screen — src/app/quiz.js.
 *
 *   node tests/verify-quiz-pure.js
 *
 * Pure Node, over invented questions. The module is given the page's state, the log, the chapters' colours and a
 * kit, and returns markup; nothing in the first seven parts has a page. The kit there is stand-ins that say what
 * they were asked (e('x') is "E(x)", fsrsPreview() says the card and grade it was given), so what the screen is
 * expected to say is worked out here and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - the bar: chapter, place in the session, "start over" when resumed, and the score so far;
 *   - the question: its words, number, chapter, flag and pencil badges, figure note and notice;
 *   - the options: before answering, and after, right and chosen, with peer percentages where there are any;
 *   - the reveal: right or wrong, the right answer cut at 58, the commentary in paragraphs, what is said of
 *     the bank's export, and the peer distribution only where every option has a percentage;
 *   - "How sure?" before answering, and "Why did you miss it?" after a miss, each with the one marked;
 *   - the review ratings, each with when the card would come back, until the card is rated;
 *   - the actions: home, back, flag, next or skip, and "View Results" at the end; the keys or a tap;
 *   - that it reads the names of the state and the kit it is given, and changes nothing;
 *   - the page's one line, its handlers and ids, and that line over the page's own helpers, RATINGS and
 *     fsrsPreview() and the real Calib, FSRS and ReviewQueue.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/quiz.js').QuizScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const run = f => { try { return String(f()); } catch (err) { return 'THREW ' + err.message; } };
const g1 = (s, re) => (s.match(re) || [])[1];
const times = (html, text) => html.split(text).length - 1;

const RATINGS = Object.freeze([['again', 'Again', 1, '#E00'], ['good', 'Good', 3, '#0A0']]);
const CALIB = Object.freeze({ BANDS: [{ id: 0, label: 'Guess' }, { id: 2, label: 'Sure' }], REASONS: [{ id: 'gap', label: 'Did not know' }, { id: 'slip', label: 'Slipped' }] });
const kitOf = over => Object.assign({
  BANK: { name: 'Bank<1>' }, RATINGS, IMGS: { q1: ['f1'], q2: [] }, Calib: CALIB, hasPeers: q => q.o.every(o => typeof o.p === 'number'), hasMarkup: () => false,
  fmtInterval: d => 'IVL(' + d + ')', fsrsPreview: (card, g) => ({ ivl: (card ? card.tag : 'new') + '/' + g }),
  chInk: c => 'INK(' + c + ')', e: s => 'E(' + s + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']', window: { innerWidth: 1194 },
}, over);
const question = (id, over) => Object.assign({ id, ch: 'Rhythm', n: 7, s: 'the stem', ex: 'one\n\ntwo\nthree', o: [{ l: 'A', t: 'first', p: 20 }, { l: 'B', t: 'second', p: 80 }], ci: 1 }, over);
const state = over => Object.assign({ questions: [question('q1'), question('q2')], qIdx: 0, selected: null, answered: false, answers: {}, mode: 'all', flagged: new Set(), srs: {}, resumed: false, quizCorrect: 0, quizTotal: 0 }, over);
const draw = (sOver, kOver, LOG, colors) => run(() => M.screenHtml(state(sOver), LOG || [], colors || { Rhythm: '#112233' }, kitOf(kOver)));
const optsOf = html => html.split('<button class="opt').slice(1).map(s => ({ cls: 'opt' + s.slice(0, s.indexOf('"')), dis: / disabled /.test(s.slice(0, 40)), idx: g1(s, /data-idx="(\d+)"/), pressed: g1(s, /aria-pressed="([^"]*)"/), text: g1(s, /class="opt-text">([^<]*)</), pct: g1(s, /class="opt-pct" style="color:([^"]*)">([^<]*)</) }));
const handlersOf = html => [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1]);
const actions = html => handlersOf(g1(html, /<div class="actions">([\s\S]*)<\/div>\s*<\/div>\s*$/) || '');

head('the bar');
{
  const html = draw({ qIdx: 1 });
  ok('the chapter, in chInk()\'s ink on its colour, through e()', html.includes('<span class="ch-badge" style="background:#11223322;color:INK(#112233)">E(Rhythm)</span>'));
  ok('the place in the session, said to a screen reader as in this session', html.includes('<span class="q-counter">2 of 2<span class="sr-only"> in this session</span></span>'));
  ok('the bar is as far along as the place', g1(html, /transform:scaleX\(([^)]*)\)/) === '1.0000' && g1(draw(), /transform:scaleX\(([^)]*)\)/) === '0.5000');
  ok('"start over" only when the session was resumed', draw({ resumed: true }).includes('onclick="restartQuiz()"') && !html.includes('restartQuiz'));
  ok('the score so far, and nothing before the first answer', g1(draw({ quizCorrect: 2, quizTotal: 3 }), /<div class="qstats">([^<]*)</) === 'This quiz: 2/3 (67%)' && g1(html, /<div class="qstats">([^<]*)</) === '');
  ok('a chapter with no colour takes the teal', draw({}, {}, [], {}).includes('style="background:var(--teal)22;color:INK(var(--teal))"'));
}

head('the question');
{
  const html = draw();
  ok('its words, through e(), with its number and chapter', html.includes('E(the stem)') && html.includes('Question 7 · E(Rhythm)'));
  ok('the flagged badge is hidden unless flagged', html.includes('id="qFlagBadge" hidden>') && draw({ flagged: new Set(['q1']) }).includes('id="qFlagBadge">'));
  ok('"annotated" when the reader has marked it', draw({}, { hasMarkup: id => id === 'q1' }).includes('[icon pencil icon-sm] annotated') && !html.includes('annotated</span>'));
  ok('a note that the options are the figure\'s panels, and a question\'s notice, through e()', draw({ questions: [question('q1', { imgopt: true, flag: 'Corrected <x>' })] }).includes('Answer options refer to the labelled panels in the figure.</div>') && draw({ questions: [question('q1', { flag: 'Corrected <x>' })] }).includes('<span>E(Corrected <x>)</span>'));
  const cols = h => g1(h, /<div class="reading-question">([\s\S]*?)<div class="q-card/);
  ok('a figure question\'s figure has a column of its own, the stem and options another', cols(draw({ questions: [question('q1', { img: true })] })) === '<div class="reading-figs"><div class="fig-zone"></div></div><div class="reading-text">\n    ', cols(draw({ questions: [question('q1', { img: true })] })));
  ok('no figure column for a question without a figure, whose figures are missing or whose list is empty', [{ questions: [question('q1')] }, { questions: [question('q3', { img: true })] }, { questions: [question('q2', { img: true })] }].every(o => cols(draw(o)) === '<div class="fig-zone"></div><div class="reading-text">\n    '), [{ questions: [question('q3', { img: true })] }, { questions: [question('q2', { img: true })] }].map(o => cols(draw(o))).join(' | '));
  /* Where the element that opens at i closes: the end of its own </div>, counting the divs between. */
  const closeOf = (h, i) => { let depth = 0; const re = /<(\/?)div\b[^>]*>/g; re.lastIndex = i; for (let m; (m = re.exec(h));) { depth += m[1] ? -1 : 1; if (!depth) return re.lastIndex; } return -1; };
  const textCol = h => { const i = h.indexOf('<div class="reading-text">'), end = closeOf(h, i), q = h.indexOf('<div class="reading-question">'), qEnd = closeOf(h, q);
    return i < 0 || end < 0 || q < 0 ? null : { inner: h.slice(i, end), between: h.slice(end, qEnd), after: h.slice(qEnd, qEnd + 40) }; };
  const tc = [draw(), draw({ questions: [question('q1', { img: true })], answered: true, selected: 0 })].map(textCol);
  ok('the text column holds the card, the options and the hint, and the question column closes with it, before the explanation', tc.every(t => t && /^<div class="reading-text">\n    <div class="q-card/.test(t.inner) && t.inner.includes('<div class="opts">') && t.inner.includes('kb-hint') && t.between === '</div>' && /^\n    <div class="reading-explanation">/.test(t.after)), tc.map(t => t && J(t.between) + ' ' + J(t.after)).join(' | '));
  ok('with no questions, one line says so', draw({ questions: [] }) === '<div style="padding:60px;text-align:center;color:var(--muted)">No questions found.</div>');
}

head('the options');
{
  const before = optsOf(draw());
  ok('before answering: one for each, by index, its letter and words, not pressed, not disabled, no percentages',
     J(before.map(o => [o.cls, o.idx, o.text, o.pressed, o.dis, o.pct])) === J([['opt', '0', 'E(first)', 'false', false, undefined], ['opt', '1', 'E(second)', 'false', false, undefined]]), J(before));
  const wrong = optsOf(draw({ answered: true, selected: 0 }));
  ok('after a wrong answer: the right one marked right, the chosen one wrong and pressed, all disabled',
     wrong[1].cls === 'opt correct' && wrong[0].cls === 'opt wrong' && wrong[0].pressed === 'true' && wrong[1].pressed === 'false' && wrong.every(o => o.dis), J(wrong.map(o => o.cls)));
  const peers = draw({ answered: true, selected: 0 });
  ok('with peer figures, each option says its percentage in the ink of right, wrong or neither',
     peers.includes('<span class="opt-pct" style="color:var(--green-ink)">80%</span>') && peers.includes('<span class="opt-pct" style="color:var(--red-ink)">20%</span>'));
  const held = optsOf(draw({ selected: 0, answered: false }));
  ok('before answering no option is pressed, whatever was chosen before', held.every(o => o.pressed === 'false'), J(held.map(o => o.pressed)));
  ok('an option for a figure\'s panel is marked so', draw({ questions: [question('q1', { imgopt: true })] }).includes('class="opt img-opt"'));
}

head('the reveal');
{
  const right = draw({ answered: true, selected: 1 }), wrong = draw({ answered: true, selected: 0 });
  ok('after a right answer: "Correct!", and how many candidates were right', right.includes('<div class="reveal-verdict">Correct!</div>') && right.includes('80% of candidates answered correctly'));
  ok('after a wrong one: the right letter, and the right answer\'s words', wrong.includes('Incorrect — Answer: B') && wrong.includes('Correct: E(second)'));
  const long = draw({ answered: true, selected: 0, questions: [question('q1', { o: [{ l: 'A', t: 'x' }, { l: 'B', t: 'y'.repeat(70) }] })] });
  ok('a long right answer is cut at 58 letters, through e()', long.includes('Correct: E(' + 'y'.repeat(58) + ')…'));
  ok('the commentary, through e(), a paragraph break for each run of new lines', right.includes('<div class="exp-text">E(one<br><br>two<br><br>three)</div>'), g1(right, /<div class="exp-text">([\s\S]*?)<\/div>/));
  ok('the export\'s truncation and its verification are said, naming the bank through e()',
     draw({ answered: true, questions: [question('q1', { tr: true, src: true })] }).includes('The E(Bank<1>) text export truncated this commentary') && draw({ answered: true, questions: [question('q1', { src: true })] }).includes('verified against the E(Bank<1>) source export'));
  ok('nothing is said of the export for a question whose commentary is whole and not verified', !right.includes('exp-trunc'));
  const rows = [...wrong.matchAll(/<div class="(dist-row[^"]*)">/g)].map(m => m[1]);
  ok('in the distribution the right option\'s row is marked right and the chosen one wrong', J(rows) === J(['dist-row wrong-row', 'dist-row correct-row']), J(rows));
  const noFig = draw({ answered: true, selected: 1, questions: [question('q1', { o: [{ l: 'A', t: 'x' }, { l: 'B', t: 'y' }] })] });
  ok('with no figure for the right answer, nothing is said of candidates', g1(noFig, /<div class="reveal-sub">([^<]*)<\/div>/) === '', g1(noFig, /<div class="reveal-sub">([^<]*)<\/div>/));
  ok('the peer distribution where every option has a figure, and not otherwise', right.includes('Answer Distribution') && times(right, 'class="dist-row') === 2 && !draw({ answered: true, questions: [question('q1', { o: [{ l: 'A', t: 'x', p: 1 }, { l: 'B', t: 'y' }] })] }).includes('Answer Distribution'));
  ok('a bar as long as its share, and never shorter than 0.6', right.includes('clip-path:inset(0 80.00% 0 0 round 5px)') && draw({ answered: true, questions: [question('q1', { o: [{ l: 'A', t: 'x', p: 0 }, { l: 'B', t: 'y', p: 100 }] })] }).includes('clip-path:inset(0 99.40% 0 0'));
  ok('no reveal before answering', !draw().includes('reveal-card'));
}

head('how sure, and why missed');
{
  const cf = draw({ answers: { 0: { cf: 2 } } });
  ok('before answering: a chip for each band, the chosen one marked', cf.includes('data-cf="0" aria-pressed="false" onclick="setConfidence(0)">E(Guess)</button>') && cf.includes('class="cf-chip on" type="button" data-cf="2" aria-pressed="true" onclick="setConfidence(2)">E(Sure)'));
  ok('none once answered', !draw({ answered: true }).includes('cf-row') && run(() => M.cfRowHtml(state({ answered: true }), kitOf())) === '');
  const LOG = [{ q: 'q1', why: 'gap' }, { q: 'q2', why: 'slip' }, { q: 'q1', why: 'slip' }];
  const miss = draw({ answered: true, selected: 0 }, {}, LOG);
  ok('after a miss: a chip for each reason, the one last given for this question marked', miss.includes('class="miss-chip on" type="button" data-why="slip" aria-pressed="true"') && miss.includes('data-why="gap" aria-pressed="false"'));
  const other = draw({ answered: true, selected: 0 }, {}, [{ q: 'q1', why: 'gap' }, { q: 'q2', why: 'slip' }]);
  ok('a reason given for another question since is not this one\'s', other.includes('class="miss-chip on" type="button" data-why="gap"') && !other.includes('class="miss-chip on" type="button" data-why="slip"'));
  ok('and a way to ask Apex why', miss.includes('<button class="miss-ask" type="button" onclick="askApexWhy()">[icon zap icon-sm] Ask Apex why</button>'));
  ok('none after a right answer', !draw({ answered: true, selected: 1 }, {}, LOG).includes('miss-row') && run(() => M.missRowHtml(state(), LOG, kitOf(), true)) === '');
}

head('the review ratings');
{
  const html = draw({ mode: 'due', answered: true, selected: 1, srs: { q1: { tag: 'card' } } });
  const rates = [...html.matchAll(/<button class="rate-btn" style="--rc:([^"]*)" onclick="rateReview\((\d+)\)">\s*<span class="rate-label">([^<]*)<\/span>\s*<span class="rate-sched">([^<]*)<\/span>/g)].map(m => m.slice(1));
  ok('in a review, answered and not yet rated: a button for each rating, with when the card would come back', J(rates) === J([['#E00', '1', 'Again', 'IVL(card/1)'], ['#0A0', '3', 'Good', 'IVL(card/3)']]), J(rates));
  ok('and the flag in the prompt, with no other action', html.includes('<div class="rate-flag"><button class="btn btn-flag" id="qFlag"') && actions(html).length === 0, J(actions(html)));
  ok('once rated, no ratings', !draw({ mode: 'due', answered: true, answers: { 0: { rated: true } } }).includes('rate-prompt'));
  ok('not in practice', !draw({ mode: 'all', answered: true }).includes('rate-prompt'));
}

head('the actions and the keys');
{
  ok('before answering: home, flag and skip; back from the second on', J(actions(draw())) === J(['goHome()', 'toggleFlag()', 'nextQ()']) && J(actions(draw({ qIdx: 1 }))) === J(['goHome()', 'prevQ()', 'toggleFlag()', 'nextQ()']));
  ok('"Skip" before answering, "Next Question" after, "View Results" at the end', draw().includes('Skip [icon arrow-right icon-sm]') && draw({ answered: true }).includes('Next Question [icon arrow-right icon-sm]') && draw({ answered: true, qIdx: 1 }).includes('View Results [icon arrow-right icon-sm]'));
  ok('the flag is a toggle: named Flag, pressed when on', draw().includes('aria-pressed="false"\n    title="Flag this question') && draw({ flagged: new Set(['q1']) }).includes('class="btn btn-flag on" id="qFlag" type="button" onclick="toggleFlag()" aria-pressed="true"'));
  ok('a wide screen is told the keys, the letters of this question\'s options', draw().includes('Press <kbd>A</kbd><kbd>B</kbd> to answer') && draw({ answered: true }).includes('Press <kbd>Enter</kbd> or <kbd>Space</kbd> for next'));
  const three = draw({ qIdx: 1, questions: [question('q1'), question('q2', { o: [{ l: 'A', t: 'x' }, { l: 'B', t: 'y' }, { l: 'C', t: 'z' }] })] });
  ok('the letters are those of the question on screen', three.includes('Press <kbd>A</kbd><kbd>B</kbd><kbd>C</kbd> to answer'));
  ok('a screen narrower than 768 is told to tap', draw({}, { window: { innerWidth: 767 } }).includes('>Tap to answer</div>') && draw({ answered: true }, { window: { innerWidth: 390 } }).includes('>Tap Next to continue</div>') && !draw({}, { window: { innerWidth: 768 } }).includes('Tap to answer'));
}

head('it reads what it is given, and changes nothing');
const KIT_READS = new Set(), S_READS = new Set();
{
  const wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const LOG = [{ q: 'q1', why: 'gap' }];
  const sts = [{ questions: [question('q1', { img: true })] }, { answered: true, selected: 0, quizTotal: 2, quizCorrect: 1, resumed: true }, { mode: 'due', answered: true, selected: 1, srs: { q1: { tag: 'c' } } }];
  const outs = sts.map(o => run(() => M.screenHtml(watched(state(Object.assign({ screen: 'quiz', chapter: 'x' }, o)), S_READS, 'S'), watched(LOG, new Set(), 'LOG'), { Rhythm: '#112233' }, watched(kitOf(), KIT_READS, 'kit'))));
  const names = s => [...s].sort().join(' ');
  ok('of the state it reads the names below and nothing else', !outs.some(o => o.startsWith('THREW')) && names(S_READS) === 'answered answers flagged mode qIdx questions quizCorrect quizTotal resumed selected srs', names(S_READS));
  ok('of the kit, twelve names', names(KIT_READS) === 'BANK Calib IMGS RATINGS chInk e fmtInterval fsrsPreview hasMarkup hasPeers icon window', names(KIT_READS));
  ok('it sets, deletes and defines nothing on any of them', wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object' && !(o instanceof Set)) { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const frozen = run(() => M.screenHtml(deep(state({ answered: true, selected: 0, answers: { 0: { cf: 2 } } })), deep([{ q: 'q1', why: 'gap' }]), deep({ Rhythm: '#112233' }), deep(kitOf())));
  ok('given everything frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === draw({ answered: true, selected: 0, answers: { 0: { cf: 2 } } }, {}, [{ q: 'q1', why: 'gap' }]), frozen.slice(0, 60));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/quiz.js]@@';
  const LINE = 'function buildQuiz(){ return QuizScreen.screenHtml(S,LOG,CH_COLORS,{BANK,RATINGS,IMGS,Calib,hasPeers,hasMarkup,fmtInterval,fsrsPreview,chInk,e,icon,window}); }';
  ok('buildQuiz() is one line: the state, the log, the colours and the kit', count(LINE) === 1 && count('function buildQuiz(') === 1);
  ok('the module is written into the page once, above that line', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT));
  const handed = String(g1(page, /QuizScreen\.screenHtml\(S,LOG,CH_COLORS,\{([^}]*)\}\); \}/));
  ok('the kit is the twelve names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 12 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  ok('cfRowHtml() and missRowHtml() are no longer the page\'s; fsrsPreview(), fmtInterval() and hasPeers are', count('function cfRowHtml(') === 0 && count('function missRowHtml(') === 0 && count('function fsrsPreview(card,rating){') === 1 && count('function fmtInterval(days){') === 1 && count('const hasPeers=q=>') === 1);
  const WORDS = ['How sure?', 'Why did you miss it?', 'Answer Distribution', 'Resumed · start over', 'How well did you know this'];
  ok('and the screen\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = draw({ resumed: true, qIdx: 1 }) + draw({ answered: true, selected: 0 }, {}, [{ q: 'q1', why: null }]) + draw({ mode: 'due', answered: true, selected: 1 });
  const handlers = [...new Set(handlersOf(all).map(h => (h.match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]))].sort();
  ok('its markup names nine handlers', J(handlers) === J(['askApexWhy', 'goHome', 'nextQ', 'prevQ', 'rateReview', 'restartQuiz', 'setConfidence', 'setMissReason', 'toggleFlag']), handlers.join(' '));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  ok('the chips setConfidence() and setMissReason() repaint are found by the classes the module draws', count('document.querySelectorAll(".cf-chip")') === 1 && count('document.querySelectorAll(".miss-chip")') === 1 && all.includes('class="cf-chip') && all.includes('class="miss-chip'));
  const ids = ['qFlag', 'qFlagBadge'];
  ok('the ids the page looks up are drawn', ids.every(id => count("getElementById('" + id + "')") + count("'#" + id) > 0 && draw().includes('id="' + id + '"')), ids.map(id => id + ':' + (count("getElementById('" + id + "')") + count("'#" + id))).join(' '));

  /* The page's own line and helpers, RATINGS, hasPeers, fsrsPreview() and fmtInterval(), with the real Calib, FSRS and
     ReviewQueue and this module, the clock held at one moment. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = ['calib', 'fsrs', 'reviewqueue'].map(m => read('src/core/' + m + '.js')).concat([whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function chInk(hex){', '\n}'),
    whole('const hasPeers=q=>', '\n'), whole("const RATINGS=[['again'", '];'), whole('function isoLocal(d){', '\n'), whole('function todayISO(){', '\n'), whole('function fsrsPreview(card,rating){', '\n'),
    whole('function fmtInterval(days){', '\n'), read('src/app/quiz.js'), whole('function buildQuiz(){', '\n')]).join('\n');
  const NOW = new Date(2026, 10, 15, 9, 0).getTime();
  class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
  const ctx = { Date: FixedDate, innerWidth: 1194, BANK: { name: 'Test Bank' }, IMGS: { a1: ['f1'] }, CH_COLORS: {}, LOG: [], themeIsDark: () => false, hasMarkup: () => false,
    S: { questions: [{ id: 'a1', ch: 'Valves & more', n: 3, s: 'A <b>stem</b>', ex: 'Why.', o: [{ l: 'A', t: 'One', p: 30 }, { l: 'B', t: 'Two & three', p: 70 }], ci: 1, img: true }], qIdx: 0, selected: 1, answered: true, answers: {}, mode: 'due', flagged: new Set(), srs: {}, resumed: false, quizCorrect: 1, quizTotal: 1 } };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(parts + '\n"loaded"');
  const html = String(ask('buildQuiz()'));
  ok('the page\'s own line draws the question over the real modules, its words escaped by the page\'s e(), its figure in a column of its own', loaded === 'loaded' && html.includes('A &lt;b&gt;stem&lt;/b&gt;') && html.includes('<span class="opt-text">Two &amp; three</span>') && html.includes('<div class="reading-figs"><div class="fig-zone"></div></div>'), String(loaded).slice(0, 60) + ' · ' + html.slice(0, 60));
  const scheds = [...html.matchAll(/<span class="rate-label">([^<]*)<\/span>\s*<span class="rate-sched">([^<]*)<\/span>/g)].map(m => [m[1], m[2]]);
  const want = String(ask('JSON.stringify(RATINGS.map(([k,l,g])=>[l, ReviewQueue.fmtInterval(FSRS.update(undefined,g,todayISO()).ivl)]))'));
  ok('a new card\'s four ratings, each with when the real FSRS would bring it back, as the real ReviewQueue says it', scheds.length === 4 && J(scheds) === want, J(scheds));
  ok('the bar and the score are the page\'s', html.includes('<span class="q-counter">1 of 1') && html.includes('This quiz: 1/1 (100%)'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
