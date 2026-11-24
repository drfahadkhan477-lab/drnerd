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
 *   - where the reader is: the page's session brain (src/ui/sessionbrain.js, held by verify-sessionbrain-pure), drawn
 *     first, and nothing left of the card it replaced: chapter, bar, score and start over;
 *   - the question: its words, number, chapter, flag and pencil badges, figure note and notice;
 *   - the options: before answering, and after, right and chosen, with peer percentages where there are any;
 *   - the reveal: right or wrong, the right answer cut at 58, the commentary in paragraphs, what is said of
 *     the bank's export, and the peer distribution only where every option has a percentage;
 *   - "How sure?" before answering, and "Why did you miss it?" after a miss, each with the one marked;
 *   - the review ratings, each with when the card would come back, until the card is rated;
 *   - the actions: home, back, flag, next or skip, and "View Results" at the end; the keys or a tap;
 *   - that it reads the names of the state and the kit it is given, and changes nothing;
 *   - the question's figures: what each is called, a card for each in order with its picture, the one enlarged and
 *     only it marked and scaled, the number the reader sees, the full-screen button beside the card and not in it,
 *     none for a question without one; and the page's figLabel() and buildFigures() as one line each;
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
  sessionBrainHtml: () => '[SESSION BRAIN]',
}, over);
const question = (id, over) => Object.assign({ id, ch: 'Rhythm', n: 7, s: 'the stem', ex: 'one\n\ntwo\nthree', o: [{ l: 'A', t: 'first', p: 20 }, { l: 'B', t: 'second', p: 80 }], ci: 1 }, over);
const state = over => Object.assign({ questions: [question('q1'), question('q2')], qIdx: 0, selected: null, answered: false, answers: {}, mode: 'all', flagged: new Set(), srs: {}, resumed: false, quizCorrect: 0, quizTotal: 0 }, over);
const draw = (sOver, kOver, LOG, colors) => run(() => M.screenHtml(state(sOver), LOG || [], colors || { Rhythm: '#112233' }, kitOf(kOver)));
const optsOf = html => html.split('<button class="opt').slice(1).map(s => ({ cls: 'opt' + s.slice(0, s.indexOf('"')), dis: / disabled /.test(s.slice(0, 40)), idx: g1(s, /data-idx="(\d+)"/), pressed: g1(s, /aria-pressed="([^"]*)"/), text: g1(s, /class="opt-text">([^<]*)</), pct: g1(s, /class="opt-pct" style="color:([^"]*)">([^<]*)</) }));
/* docs/ROADMAP.md, E2. Attribute names, read tag by tag with each value consumed whole, so text inside a value is never
   taken for a name; and the actions the markup names, in the order drawn. */
const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
const actionsOf = html => [...html.matchAll(/data-action="([^"]*)"/g)].map(m => m[1]);
const actions = html => actionsOf(g1(html, /<div class="actions">([\s\S]*)<\/div>\s*<\/div>\s*$/) || '');

head('where the reader is');
{
  /* The card over the question (the chapter, "k of n", start over, the bar and the score) went for the session brain,
     the owner's choice of November 2026: its pill and panel are the page's (sessionBrainHtml), held by
     verify-sessionbrain-pure and, drawn by the page, below. */
  let asked = 0;
  const html = draw({ qIdx: 1, resumed: true, quizCorrect: 2, quizTotal: 3 }, { sessionBrainHtml: () => (asked++, '[SESSION BRAIN]') });
  ok('the page\'s session brain, asked once, is the first thing on the screen', asked === 1 && html.includes('<div class="quiz-wrap">\n    [SESSION BRAIN]\n'), asked + ' asked');
  ok('and nothing is left of the card it replaced: no chapter badge, bar, score or start over of the screen\'s own',
     !/ch-badge|prog-track|prog-fill|qstats|q-restart|quizStartOver|q-counter/.test(html), (html.match(/ch-badge|prog-track|prog-fill|qstats|q-restart|quizStartOver|q-counter/g) || []).join(' ') || 'none');
  ok('a page that hands no session brain gets none, and the screen still draws', !/SESSION BRAIN/.test(draw({}, { sessionBrainHtml: undefined })) && draw({}, { sessionBrainHtml: undefined }).includes('class="q-card'));
  ok('a chapter with no colour takes the teal, on the card\'s edge and its dot', draw({}, {}, [], {}).includes('style="border-left-color:var(--teal)"') && draw({}, {}, [], {}).includes('class="q-tag-dot" style="color:var(--teal)"'));
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
  ok('before answering: a chip for each band, the chosen one marked', cf.includes('data-cf="0" aria-pressed="false" data-action="setConfidence">E(Guess)</button>') && cf.includes('class="cf-chip on" type="button" data-cf="2" aria-pressed="true" data-action="setConfidence">E(Sure)'));
  ok('none once answered', !draw({ answered: true }).includes('cf-row') && run(() => M.cfRowHtml(state({ answered: true }), kitOf())) === '');
  const LOG = [{ q: 'q1', why: 'gap' }, { q: 'q2', why: 'slip' }, { q: 'q1', why: 'slip' }];
  const miss = draw({ answered: true, selected: 0 }, {}, LOG);
  ok('after a miss: a chip for each reason, the one last given for this question marked', miss.includes('class="miss-chip on" type="button" data-why="slip" aria-pressed="true" data-action="setMissReason">') && miss.includes('data-why="gap" aria-pressed="false" data-action="setMissReason">'));
  const other = draw({ answered: true, selected: 0 }, {}, [{ q: 'q1', why: 'gap' }, { q: 'q2', why: 'slip' }]);
  ok('a reason given for another question since is not this one\'s', other.includes('class="miss-chip on" type="button" data-why="gap"') && !other.includes('class="miss-chip on" type="button" data-why="slip"'));
  ok('and a way to ask Apex why, by the askApexWhy action', miss.includes('<button class="miss-ask" type="button" data-action="askApexWhy">[icon zap icon-sm] Ask Apex why</button>'));
  ok('none after a right answer', !draw({ answered: true, selected: 1 }, {}, LOG).includes('miss-row') && run(() => M.missRowHtml(state(), LOG, kitOf(), true)) === '');
}

head('the review ratings');
{
  const html = draw({ mode: 'due', answered: true, selected: 1, srs: { q1: { tag: 'card' } } });
  const rates = [...html.matchAll(/<button class="rate-btn" style="--rc:([^"]*)" data-action="rateReview" data-grade="(\d+)">\s*<span class="rate-label">([^<]*)<\/span>\s*<span class="rate-sched">([^<]*)<\/span>/g)].map(m => m.slice(1));
  ok('in a review, answered and not yet rated: a button for each rating, with when the card would come back', J(rates) === J([['#E00', '1', 'Again', 'IVL(card/1)'], ['#0A0', '3', 'Good', 'IVL(card/3)']]), J(rates));
  ok('and the flag in the prompt, with no other action', html.includes('<div class="rate-flag"><button class="btn btn-flag" id="qFlag"') && actions(html).length === 0, J(actions(html)));
  ok('once rated, no ratings', !draw({ mode: 'due', answered: true, answers: { 0: { rated: true } } }).includes('rate-prompt'));
  ok('not in practice', !draw({ mode: 'all', answered: true }).includes('rate-prompt'));
}

head('the actions and the keys');
{
  ok('before answering: home, flag and skip; back from the second on', J(actions(draw())) === J(['goHome', 'toggleFlag', 'nextQ']) && J(actions(draw({ qIdx: 1 }))) === J(['goHome', 'prevQ', 'toggleFlag', 'nextQ']) && J(actions(draw({ answered: true }))) === J(['goHome', 'toggleFlag', 'nextQ']), J(actions(draw({ qIdx: 1 }))));
  ok('"Skip" before answering, "Next Question" after, "View Results" at the end', draw().includes('Skip [icon arrow-right icon-sm]') && draw({ answered: true }).includes('Next Question [icon arrow-right icon-sm]') && draw({ answered: true, qIdx: 1 }).includes('View Results [icon arrow-right icon-sm]'));
  ok('the flag is a toggle: named Flag, pressed when on', draw().includes('aria-pressed="false"\n    title="Flag this question') && draw({ flagged: new Set(['q1']) }).includes('class="btn btn-flag on" id="qFlag" type="button" data-action="toggleFlag" aria-pressed="true"'));
  ok('a wide screen is told the keys, the letters of this question\'s options', draw().includes('Press <kbd>A</kbd><kbd>B</kbd> to answer') && draw({ answered: true }).includes('Press <kbd>Enter</kbd> or <kbd>Space</kbd> for next'));
  const three = draw({ qIdx: 1, questions: [question('q1'), question('q2', { o: [{ l: 'A', t: 'x' }, { l: 'B', t: 'y' }, { l: 'C', t: 'z' }] })] });
  ok('the letters are those of the question on screen', three.includes('Press <kbd>A</kbd><kbd>B</kbd><kbd>C</kbd> to answer'));
  ok('a screen narrower than 768 is told to tap', draw({}, { window: { innerWidth: 767 } }).includes('>Tap to answer</div>') && draw({ answered: true }, { window: { innerWidth: 390 } }).includes('>Tap Next to continue</div>') && !draw({}, { window: { innerWidth: 768 } }).includes('Tap to answer'));
  /* The keys are offered only once a key is pressed (the page's data-keys; app/css/home-quiz.css): an iPad with no keyboard
     showed "Press A to answer" to a finger. So the hints that name keys say so (kb-keys), and a phone's tap hint does not. */
  ok('the hints that name keys are marked as keys (kb-keys), and a phone\'s hint to tap is not',
     draw().includes('<div class="kb-hint kbd-row kb-keys">Press ') && draw({ answered: true }).includes('<div class="kb-hint kb-keys">Press ')
     && draw({}, { window: { innerWidth: 767 } }).includes('<div class="kb-hint kbd-row">Tap to answer') && draw({ answered: true }, { window: { innerWidth: 767 } }).includes('<div class="kb-hint">Tap Next'));
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
  ok('of the state it reads the names below and nothing else', !outs.some(o => o.startsWith('THREW')) && names(S_READS) === 'answered answers flagged mode qIdx questions selected srs', names(S_READS));
  ok('of the kit, thirteen names', names(KIT_READS) === 'BANK Calib IMGS RATINGS chInk e fmtInterval fsrsPreview hasMarkup hasPeers icon sessionBrainHtml window', names(KIT_READS));
  ok('it sets, deletes and defines nothing on any of them', wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object' && !(o instanceof Set)) { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const frozen = run(() => M.screenHtml(deep(state({ answered: true, selected: 0, answers: { 0: { cf: 2 } } })), deep([{ q: 'q1', why: 'gap' }]), deep({ Rhythm: '#112233' }), deep(kitOf())));
  ok('given everything frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === draw({ answered: true, selected: 0, answers: { 0: { cf: 2 } } }, {}, [{ q: 'q1', why: 'gap' }]), frozen.slice(0, 60));
}

head('the question\'s figures');
{
  const K = kitOf();
  const F = (q, src, at) => run(() => M.figuresHtml(q, src, at, { e: K.e, icon: K.icon }));
  const L = (q, i, n) => run(() => M.figLabel(q, i, n));
  const panels = question('qp', { img: 1, imgopt: 1, o: [{ l: 'A', t: 'ECG A' }, { l: 'B', t: 'ECG B' }] });
  ok('a figure per labelled option is called by the option: "ECG A", "ECG B"', L(panels, 0, 2) === 'ECG A' && L(panels, 1, 2) === 'ECG B', L(panels, 0, 2) + ' / ' + L(panels, 1, 2));
  ok('otherwise one figure is "Figure", and of several each is numbered from 1', L(panels, 0, 3) === 'Figure 1' && L(panels, 2, 3) === 'Figure 3' && L(panels, 0, 1) === 'Figure'
     && L(question('q9'), 1, 2) === 'Figure 2', [L(panels, 0, 3), L(panels, 0, 1), L(question('q9'), 1, 2)].join(' / '));
  const q = question('q1', { img: 1 });
  ok('a question without a figure, or whose figures are not on the device, has none', F(question('q1'), ['f1'], { zoomed: -1, num: 7 }) === '' && F(q, undefined, { zoomed: -1, num: 7 }) === '' && F(q, [], { zoomed: -1, num: 7 }) === '');
  const two = F(q, ['u0', 'u1'], { zoomed: -1, num: 7 });
  const slots = two.split('<div class="fig-slot">').slice(1);
  ok('each picture is a card in a slot of its own, in order', slots.length === 2 && g1(slots[0], /data-fig="(\d+)"/) === '0' && g1(slots[1], /data-fig="(\d+)"/) === '1'
     && g1(slots[0], /<img class="fig-img" src="([^"]*)"/) === 'u0' && g1(slots[1], /<img class="fig-img" src="([^"]*)"/) === 'u1', slots.length + ' slots');
  ok('the card says what it is and that a tap enlarges it, and its picture whose question it is', g1(slots[0], /role="button" tabindex="0"\s+aria-label="([^"]*)"/) === 'E(Figure 1) — tap to enlarge'
     && g1(slots[1], /alt="([^"]*)"/) === 'E(Figure 2) for question 7' && times(slots[0], 'Tap to enlarge') === 1 && times(slots[0], '📊 E(Figure 1)') === 1, g1(slots[1], /alt="([^"]*)"/));
  ok('beside the card, not inside it, a button opens it full screen', /<\/div>\s*<button class="fig-full" type="button" aria-label="Open E\(Figure 1\) full screen"\s+data-action="openQuestionFigures" data-qid="E\(q1\)" data-i="0">\[icon expand icon-sm\]<\/button>\s*<\/div>$/.test(slots[0])
     && slots.every(t => { const pre = t.slice(0, t.indexOf('<button class="fig-full"')); return times(pre, '<div') === times(pre, '</div>'); }), slots[0].slice(-170));
  const z = F(q, ['u0', 'u1'], { zoomed: 1, num: 7 }).split('<div class="fig-slot">').slice(1);
  ok('the one enlarged, and only it, is marked, scaled, and says a tap shrinks it', z.length === 2 && !/fig-card zoomed/.test(z[0]) && /fig-card zoomed/.test(z[1])
     && /transform:scale\(1\);/.test(z[0]) && /transform:scale\(1\.8\) translateY\(10%\);/.test(z[1]) && /tap to shrink/.test(z[1]) && /Tap to shrink/.test(z[1]) && /Tap to enlarge/.test(z[0]),
     z.map(t => (t.match(/transform:[^;]*/) || [''])[0]).join(' | '));
  const lab = F(panels, ['p0', 'p1'], { zoomed: -1, num: 9 });
  ok('a labelled panel is called by its option everywhere, and the number is the one the reader sees', times(lab, 'E(ECG B)') === 4 && times(lab, 'E(Figure') === 0 && times(lab, 'for question 9') === 2, times(lab, 'E(ECG B)') + ' uses');
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  const lines = ['function figLabel(q,i,n){ return QuizScreen.figLabel(q,i,n); }',
    "function buildFigures(q){ return QuizScreen.figuresHtml(q,IMGS[q.id],{zoomed:S.zoomed,num:S.screen==='mock'&&S.mock?S.mock.i+1:q.n},{e,icon}); }"];
  ok('the page\'s figLabel() and buildFigures() are one line each, handing over the pictures, the one enlarged and the number shown',
     lines.every(l => n(l) === 1) && n('function figLabel(') === 1 && n('function buildFigures(') === 1, lines.filter(l => n(l) !== 1).join(' | ') || 'both');
  ok('and the page keeps no copy of the cards', n('data-action="openQuestionFigures" data-qid=') === 0 && n("'Figure '+(i+1)") === 0);
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/quiz.js]@@';
  const LINE = 'function buildQuiz(){ return QuizScreen.screenHtml(S,LOG,CH_COLORS,{BANK,RATINGS,IMGS,Calib,hasPeers,hasMarkup,fmtInterval,fsrsPreview,chInk,e,icon,window,sessionBrainHtml}); }';
  ok('buildQuiz() is one line: the state, the log, the colours and the kit', count(LINE) === 1 && count('function buildQuiz(') === 1);
  ok('the module is written into the page once, above that line', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT));
  const handed = String(g1(page, /QuizScreen\.screenHtml\(S,LOG,CH_COLORS,\{([^}]*)\}\); \}/));
  ok('the kit is the thirteen names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 13 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  ok('cfRowHtml() and missRowHtml() are no longer the page\'s; fsrsPreview(), fmtInterval() and hasPeers are', count('function cfRowHtml(') === 0 && count('function missRowHtml(') === 0 && count('function fsrsPreview(card,rating,id){') === 1 && count('function fmtInterval(days){') === 1 && count('const hasPeers=q=>') === 1);
  const WORDS = ['How sure?', 'Why did you miss it?', 'Answer Distribution', 'Resumed · start over', 'How well did you know this'];
  ok('and the screen\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = draw({ resumed: true, qIdx: 1 }) + draw({ answered: true, selected: 0 }, {}, [{ q: 'q1', why: null }]) + draw({ mode: 'due', answered: true, selected: 1 });
  const named = [...new Set(actionsOf(all))].sort();
  ok('its markup names eight actions and carries no inline handler (start over is the session brain\'s now)', J(named) === J(['askApexWhy', 'goHome', 'nextQ', 'prevQ', 'rateReview', 'setConfidence', 'setMissReason', 'toggleFlag']) && inlineOf(all).length === 0, named.join(' ') + ' · ' + (inlineOf(all).join(' ') || 'no on* attribute'));
  const TABLES = ['ACTIONS', 'INPUT_ACTIONS', 'CHANGE_ACTIONS'];
  const tableOf = name => (page.match(new RegExp('const ' + name + '=\\{([\\s\\S]*?)\\n\\};')) || [])[1] || '';
  const keyed = (t, n) => (tableOf(t).match(new RegExp('(^|\\s)' + n + ':', 'g')) || []).length;
  const ENTRY = { setConfidence: 'setConfidence:el=>setConfidence(Number(el.dataset.cf)),', setMissReason: 'setMissReason:el=>setMissReason(el.dataset.why),', askApexWhy: 'askApexWhy:()=>askApexWhy(),',
    toggleFlag: 'toggleFlag:()=>toggleFlag(),', rateReview: 'rateReview:el=>rateReview(Number(el.dataset.grade)),', prevQ: 'prevQ:()=>prevQ(),', nextQ: 'nextQ:()=>nextQ(),', quizStartOver: 'quizStartOver:()=>restartQuiz(),', goHome: 'goHome:()=>goHome(),' };
  ok('each is in the page\'s ACTIONS table once, as written, and in neither of the others: the numbers read back as numbers',
     named.length === 8 && named.every(n => ENTRY[n] && tableOf('ACTIONS').split(ENTRY[n]).length === 2 && keyed('ACTIONS', n) === 1 && keyed('INPUT_ACTIONS', n) === 0 && keyed('CHANGE_ACTIONS', n) === 0),
     named.map(n => n + ':' + TABLES.map(t => keyed(t, n)).join('/') + (ENTRY[n] && tableOf('ACTIONS').split(ENTRY[n]).length === 2 ? '' : ' (not as written)')).join(' '));
  const CALLS = ['askApexWhy', 'goHome', 'nextQ', 'prevQ', 'rateReview', 'setConfidence', 'setMissReason', 'toggleFlag'];
  ok('they call eight functions the page declares, once each, and the page listens for taps on the document', CALLS.every(n => count('function ' + n + '(') === 1) && count('Actions.install(document,ACTIONS);') === 1, CALLS.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  ok('the chips setConfidence() and setMissReason() repaint are found by the classes the module draws', count('document.querySelectorAll(".cf-chip")') === 1 && count('document.querySelectorAll(".miss-chip")') === 1 && all.includes('class="cf-chip') && all.includes('class="miss-chip'));
  const ids = ['qFlag', 'qFlagBadge'];
  ok('the ids the page looks up are drawn', ids.every(id => count("getElementById('" + id + "')") + count("'#" + id) > 0 && draw().includes('id="' + id + '"')), ids.map(id => id + ':' + (count("getElementById('" + id + "')") + count("'#" + id))).join(' '));

  /* The page's own line and helpers, RATINGS, hasPeers, fsrsPreview() and fmtInterval(), with the real Calib, FSRS and
     ReviewQueue and this module, the clock held at one moment. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = ['calib', 'fsrs', 'reviewqueue'].map(m => read('src/core/' + m + '.js')).concat([whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function chInk(hex){', '\n}'),
    whole('const hasPeers=q=>', '\n'), whole("const RATINGS=[['again'", '];'), whole('function isoLocal(d){', '\n'), whole('function todayISO(){', '\n'), whole('function fsrsPreview(card,rating,id){', '\n'),
    whole('function fmtInterval(days){', '\n'), read('src/ui/sessionbrain.js'), whole('let sbOpen=false, sbSel=-1', '\n'), whole('function sessionBrainModel(){', '\n}'),
    whole('function sessionBrainHtml(){', '\n}'), read('src/app/quiz.js'), whole('function buildQuiz(){', '\n')]).join('\n');
  const NOW = new Date(2026, 10, 15, 9, 0).getTime();
  class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
  const ctx = { Date: FixedDate, innerWidth: 1194, BANK: { name: 'Test Bank' }, IMGS: { a1: ['f1'] }, CH_COLORS: {}, LOG: [], themeIsDark: () => false, hasMarkup: () => false,
    S: { questions: [{ id: 'a1', ch: 'Valves & more', n: 3, s: 'A <b>stem</b>', ex: 'Why.', o: [{ l: 'A', t: 'One', p: 30 }, { l: 'B', t: 'Two & three', p: 70 }], ci: 1, img: true }], qIdx: 0, selected: 1, answered: true, answers: { 0: { selected: 1 } }, mode: 'due', flagged: new Set(), srs: {}, resumed: false, quizCorrect: 1, quizTotal: 1 } };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(parts + '\n"loaded"');
  const html = String(ask('buildQuiz()'));
  ok('the page\'s own line draws the question over the real modules, its words escaped by the page\'s e(), its figure in a column of its own', loaded === 'loaded' && html.includes('A &lt;b&gt;stem&lt;/b&gt;') && html.includes('<span class="opt-text">Two &amp; three</span>') && html.includes('<div class="reading-figs"><div class="fig-zone"></div></div>'), String(loaded).slice(0, 60) + ' · ' + html.slice(0, 60));
  const scheds = [...html.matchAll(/<span class="rate-label">([^<]*)<\/span>\s*<span class="rate-sched">([^<]*)<\/span>/g)].map(m => [m[1], m[2]]);
  /* Named by the question's id, as a rating names it (S4): the day a button shows is the day a tap gives. */
  const want = String(ask('JSON.stringify(RATINGS.map(([k,l,g])=>[l, ReviewQueue.fmtInterval(FSRS.update(undefined,g,todayISO(),"a1").ivl)]))'));
  const unnamed = String(ask('JSON.stringify(RATINGS.map(([k,l,g])=>[l, ReviewQueue.fmtInterval(FSRS.update(undefined,g,todayISO()).ivl)]))'));
  ok('for this question, naming the card changes at least one rating\'s day, so the next check can tell (precondition)', want !== unnamed, want + ' vs ' + unnamed);
  ok('a new card\'s four ratings, each with when the real FSRS would bring this card back, as the real ReviewQueue says it', scheds.length === 4 && J(scheds) === want, J(scheds));
  ok('where the reader is, and the score, are the page\'s session brain: one of one, one right', /<button class="sb-pill( sb-fresh)?" id="sbPill"/.test(html) && html.includes('<span class="q-counter">1 of 1') && html.includes('question 1 of 1: 1 right, 0 wrong'));
  /* A tap, as the page takes it: the real src/core/actions.js listening on a stand-in document over the page's own
     tables, with a recording stand-in for each function they call, and as the element each button the page's own line
     drew over the real Calib and RATINGS, its attributes read back as a browser reads them, in the order drawn. Three
     drawings: a review waiting for its rating; a resumed session's second question, not yet answered; and a miss. */
  const rating = html;
  ask(`S.questions.push({ id: 'a2', ch: 'Valves & more', n: 4, s: 'S', ex: 'E', o: [{ l: 'A', t: 'x' }, { l: 'B', t: 'y' }], ci: 0 }); S.qIdx = 1; S.answered = false; S.selected = null; S.mode = 'all'; S.resumed = true; S.answers = {};`);
  const asking = String(ask('buildQuiz()'));
  ask(`S.answered = true; S.selected = 1; S.resumed = false; LOG.push({ q: 'a2', why: null });`);
  const missed = String(ask('buildQuiz()'));
  const tcalls = [];
  const tctx = { tcalls }; tctx.window = tctx; vm.createContext(tctx);
  const tables = TABLES.map(t => (page.match(new RegExp('const ' + t + '=\\{[\\s\\S]*?\\n\\};')) || ['const ' + t + '={};'])[0].replace(/^const /, 'var ')).join('\n');
  const called = [...new Set([...tables.matchAll(/([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))].filter(n => n !== 'Number');
  vm.runInContext(read('src/core/actions.js') + '\nvar S={chapter:null}, offlineJob={busy:false};\n'
    + called.map(n => `function ${n}(){ tcalls.push(${J(n)} + (arguments.length ? " " + JSON.stringify([].slice.call(arguments)) : "")); }`).join('\n') + '\n' + tables
    + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\nActions.install(doc,ACTIONS);\nActions.install(doc,INPUT_ACTIONS,"input");\nActions.install(doc,CHANGE_ACTIONS,"change");', tctx);
  const unescape = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const tapAll = h => { tcalls.length = 0; [...h.matchAll(/<button\b([^>]*)>/g)].forEach(m => {
    const at = Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map(x => [x[1], unescape(x[2])]));
    const dataset = Object.fromEntries(Object.keys(at).filter(k => k.startsWith('data-')).map(k => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), at[k]]));
    const el = { nodeType: 1, dataset, getAttribute: k => (k in at ? at[k] : null), closest: sel => (sel === '[data-action]' && 'data-action' in at ? el : null) };
    tctx.listeners.filter(l => l[0] === 'click').forEach(l => l[1]({ type: 'click', target: el })); }); return tcalls.slice(); };
  const tr = tapAll(rating), ta = tapAll(asking), tm = tapAll(missed);
  ok('tapped through the real Actions and the page\'s tables, waiting for a rating: the session brain, each rating with its grade as a number (Again 1 to Easy 4), then the flag',
     J(tr) === J(['toggleSessionBrain', 'rateReview [1]', 'rateReview [2]', 'rateReview [3]', 'rateReview [4]', 'toggleFlag']), J(tr));
  ok('a resumed session\'s second question: the session brain (whose panel holds start over), each band as a number, home, back, flag and skip',
     J(ta) === J(['toggleSessionBrain', 'setConfidence [0]', 'setConfidence [1]', 'setConfidence [2]', 'setConfidence [3]', 'goHome', 'prevQ', 'toggleFlag', 'nextQ']), J(ta));
  ok('a miss: the session brain, each of the real reasons, Ask Apex why, home, back, flag and next',
     J(tm) === J(['toggleSessionBrain', 'setMissReason ["gap"]', 'setMissReason ["misread"]', 'setMissReason ["mixed"]', 'setMissReason ["slip"]', 'setMissReason ["guess"]', 'askApexWhy', 'goHome', 'prevQ', 'toggleFlag', 'nextQ']), J(tm));

}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
