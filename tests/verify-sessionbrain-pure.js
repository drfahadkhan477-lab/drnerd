#!/usr/bin/env node
/*
 * The master Apex Brain's session — src/ui/sessionbrain.js: where the reader is in a question session, as a small brain.
 *
 *   node tests/verify-sessionbrain-pure.js
 *
 * Pure Node, over invented sessions. The owner had the card over the question taken away (November 2026), and then
 * asked for one control for it and Apex: the Apex button wears a brain whose points of light are the session's
 * questions, and Apex's panel begins with the session. What is measured, rather than assumed:
 *   - the layout: one point per question, alternately in the left and right hemisphere, inside the drawing, none on
 *     another, for any session length, and nothing for none;
 *   - each question's state from the answers: right, wrong or not answered; the one on screen; flagged;
 *   - the counts, the nearest question to a tap, and where an arrow key moves the pick;
 *   - the button's brain: a point per question in its state, its ring the share answered, and what the button says
 *     ("k of n", and to a screen reader the counts);
 *   - the asks of Apex: the misses by their own numbers, only when there are some; what next, with the counts; a quiz;
 *   - the panel's session: one row, named by its chapter, with the place and the counts in words, that opens on the
 *     brain a tap or a key picks from, the question picked said in words and a way to go to it unless it is on screen,
 *     start over only for a resumed session; the asks drawn for the tray under the chat, not the row;
 *   - the one motion: the halo of the question on screen, finite and by opacity, and none when motion is reduced;
 *   - the page: the module written in once above the quiz, its actions in the page's tables as written, the session at
 *     the head of Apex's panel, and the button set at each draw of a screen.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const B = require('../src/ui/sessionbrain.js').SessionBrain;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const e = s => 'E(' + s + ')';
const icon = (n, c) => '[icon ' + n + (c ? ' ' + c : '') + ']';
const count = (s, t) => s.split(t).length - 1;

/* A hemisphere's outline as points, read from the drawing's own path (its curve ends), to say a point is inside. */
const poly = d => [...d.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map(m => [+m[1], +m[2]]);
const inside = (pt, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
  const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) c = !c; } return c; };
const L = poly(B.GLYPH.left), R = poly(B.GLYPH.right);

head('one point per question, in the brain');
{
  const sizes = [1, 2, 7, 40, 129, 260];
  const bad = [];
  for (const n of sizes) {
    const pts = B.layout(n);
    if (pts.length !== n) bad.push(n + ': ' + pts.length + ' points');
    pts.forEach((p, q) => { const left = q % 2 === 0; if (!inside(p, left ? L : R)) bad.push(n + ': question ' + (q + 1) + ' outside the ' + (left ? 'left' : 'right') + ' hemisphere at ' + p.x + ',' + p.y); });
    const keys = new Set(pts.map(p => p.x + ',' + p.y)); if (keys.size !== n) bad.push(n + ': ' + (n - keys.size) + ' on another');
  }
  ok('for 1, 2, 7, 40, 129 and 260 questions: as many points, each inside its own hemisphere, none on another', bad.length === 0, bad.slice(0, 3).join(' | ') || 'all');
  ok('the first question is on the left and the second on the right, and so on', B.layout(4).map(p => p.x < 60 ? 'L' : 'R').join('') === 'LRLR', B.layout(4).map(p => p.x).join(' '));
  ok('no session, or a count that is not one, is no points', B.layout(0).length === 0 && B.layout(-3).length === 0 && B.layout('x').length === 0 && B.layout(undefined).length === 0);
  ok('a point is drawn smaller as the session holds more, never below 1.3 or above 3', B.dotR(10) === 3 && B.dotR(40) === 2.6 && B.dotR(129) < B.dotR(40) && B.dotR(100000) === 1.3, [B.dotR(10), B.dotR(40), B.dotR(129), B.dotR(100000)].join(' '));
}

head('each question\'s state, from the answers');
{
  const qs = [{ id: 'a', ci: 0 }, { id: 'b', ci: 1 }, { id: 'c', ci: 2 }, { id: 'd', ci: 0 }];
  const st = B.states(qs, { 0: { selected: 0 }, 1: { selected: 0, cf: 2 }, 3: { selected: null, cf: 1 } }, 2, id => id === 'b' || id === 'c');
  ok('the chosen option the right one is right, another wrong, none chosen not answered (a confidence alone is not an answer)', J(st.map(s => s.state)) === J(['right', 'wrong', 'unseen', 'unseen']), J(st.map(s => s.state)));
  ok('the question on screen, and only it, is marked so', J(st.map(s => s.current)) === J([false, false, true, false]));
  ok('the flagged are marked, whatever their state', J(st.map(s => s.flagged)) === J([false, true, true, false]));
  ok('no answers, no flag test, or no questions at all draw nothing amiss', J(B.states(qs, undefined, 0).map(s => s.state + s.flagged)) === J(['unseenfalse', 'unseenfalse', 'unseenfalse', 'unseenfalse']) && B.states(null, {}, 0).length === 0);
  ok('the counts: right, wrong, flagged, answered, of all', J(B.counts(st)) === J({ right: 1, wrong: 1, flagged: 2, seen: 2, total: 4 }), J(B.counts(st)));
}

head('a tap and a key pick a question');
{
  const pts = [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 90, y: 10 }];
  ok('a tap picks the nearest question, and with none there is none', B.nearest(pts, 80, 20) === 2 && B.nearest(pts, 45, 40) === 1 && B.nearest([], 1, 1) === -1, [B.nearest(pts, 80, 20), B.nearest(pts, 45, 40)].join(' '));
  ok('Left and Up go back one, Right and Down on one, each stopping at the ends', B.step(3, 'ArrowLeft', 9) === 2 && B.step(3, 'ArrowUp', 9) === 2 && B.step(3, 'ArrowRight', 9) === 4 && B.step(3, 'ArrowDown', 9) === 4
     && B.step(0, 'ArrowLeft', 9) === 0 && B.step(8, 'ArrowRight', 9) === 8);
  ok('Home and End go to the ends; any other key, or no session, moves nothing', B.step(4, 'Home', 9) === 0 && B.step(4, 'End', 9) === 8 && B.step(4, 'a', 9) === -1 && B.step(4, 'Enter', 9) === -1 && B.step(0, 'ArrowRight', 0) === -1);
}

const qs = Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i, ci: 1 }));
const answers = { 0: { selected: 1 }, 1: { selected: 0 }, 2: { selected: 1 }, 3: { selected: 1 } };
const model = over => Object.assign({ n: 10, qIdx: 4, states: B.states(qs, answers, 4, id => id === 'q1'), items: qs.map((q, i) => 101 + i), chapter: 'Rhythm & <b>', resumed: false }, over);

head('the button\'s brain');
{
  const html = B.orbHtml(model());
  ok('a drawing alone, hidden from a screen reader: the button says it in words', html.startsWith('<svg class="sb-orb" viewBox="0 0 44 44" aria-hidden="true">'));
  ok('the button shows the place as "k of n"', B.fabCount(model()) === '5 of 10', B.fabCount(model()));
  ok('and says it to a screen reader with the counts, as Apex\'s', B.fabLabel(model()) === 'Apex, with this session: question 5 of 10, 3 right, 1 wrong. Open', B.fabLabel(model()));
  const dots = [...html.matchAll(/<circle class="sb-dot" data-state="([a-z]+)"( data-current="1")?( data-flagged="1")?/g)].map(m => m[1][0] + (m[2] ? '*' : '') + (m[3] ? 'f' : ''));
  ok('a point per question in its state, the one on screen and the flagged marked', J(dots) === J(['r', 'wf', 'r', 'r', 'u*', 'u', 'u', 'u', 'u', 'u']), J(dots));
  const dash = t => (t.match(/class="sb-ring" cx="22" cy="22" r="19.5" stroke-dasharray="([\d.]+) ([\d.]+)"/) || []).slice(1).map(Number);
  const [a, len] = dash(html), [none] = dash(B.orbHtml(model({ states: B.states(qs, {}, 0) })));
  const [all] = dash(B.orbHtml(model({ states: B.states(qs, Object.fromEntries(qs.map((q, i) => [i, { selected: 1 }])), 9) })));
  ok('its ring is the share answered: four of ten, none, all', Math.abs(a / len - 0.4) < 0.01 && none === 0 && Math.abs(all - len) < 0.11, [a, none, all, len].join(' '));
  ok('its drawing\'s gradients are its own (sbP), so the panel\'s (sbB) can stand in the same page', count(html, 'id="sbPL"') === 1 && !html.includes('id="sbB'));
  const halo = /<circle class="sb-halo" cx="([\d.]+)" cy="([\d.]+)"/.exec(html), here = B.layout(10)[4];
  ok('and the halo is in it, on the question on screen, and only there', count(html, 'class="sb-halo"') === 1 && !!halo && +halo[1] === here.x && +halo[2] === here.y, halo ? halo.slice(1).join(',') + ' vs ' + here.x + ',' + here.y : 'none');
}

head('the session\'s asks of Apex');
{
  const A = B.asks(model());
  ok('three: the misses, what next, a quiz', J(A.map(x => x[0])) === J(['Go over my 1 miss', 'What should I study next?', 'Quiz me']), J(A.map(x => x[0])));
  ok('the misses are named by their own numbers in the bank, not their place in the session', A[0][1] === 'Go over the question I missed in this session on Rhythm & <b> (item 102): the idea it tests, why the answer I chose was wrong, and one line to remember.', A[0][1]);
  const two = B.asks(model({ states: B.states(qs, Object.assign({}, answers, { 6: { selected: 0 } }), 4) }));
  ok('two misses are "misses", each gone over', two[0][0] === 'Go over my 2 misses' && two[0][1].includes('(items 102, 107): for each, the idea'), two[0][1]);
  ok('what next carries the counts', A[1][1] === 'This session on Rhythm & <b>: 3 right and 1 wrong of 4 answered, 6 to go. What should I study next, and why?', A[1][1]);
  const clean = B.asks(model({ states: B.states(qs, { 0: { selected: 1 } }, 4) }));
  ok('with no misses there is nothing to go over, and the quiz is on the chapter', J(clean.map(x => x[0])) === J(['What should I study next?', 'Quiz me']) && clean[1][1].includes('on Rhythm & <b>, one at a time'), J(clean));
  ok('with no numbers, a miss is named by its place', B.asks(model({ items: undefined }))[0][1].includes('(item 2)'));
}

head('the session at the head of Apex\'s panel: one row, which opens on the brain');
{
  const html = B.dockHtml(model(), 1, e, icon, true), shut = B.dockHtml(model(), 1, e, icon, false);
  ok('a section named by its chapter, through e(), saying where the reader is', html.startsWith('<section class="ai-session open" id="aiSession" aria-labelledby="sbTitle">') && shut.startsWith('<section class="ai-session" id="aiSession"')
     && html.includes('<span class="sb-title" id="sbTitle">E(Rhythm & <b>)</span>') && html.includes('<span class="sb-where">Question 5 of 10</span>'), html.slice(0, 120));
  ok('one row, a button that opens and shuts the brain (toggleSessionDetail) and says which', shut.includes('<button class="sb-row" type="button" data-action="toggleSessionDetail" aria-expanded="false" aria-controls="sbDetail">')
     && shut.includes('<div class="sb-detail" id="sbDetail" hidden>') && html.includes('aria-expanded="true" aria-controls="sbDetail">') && html.includes('<div class="sb-detail" id="sbDetail">'));
  const stats = x => [...x.matchAll(/<span class="sb-stat" data-state="([a-z]+)"><b>([^<]+)<\/b>( [a-z]+)?<\/span>/g)].map(m => m[1] + ':' + m[2] + (m[3] || ''));
  ok('in the row, the counts in words: right, wrong, flagged only when some are, and the share right of those answered', J(stats(shut)) === J(['right:3 right', 'wrong:1 wrong', 'flagged:1 flagged', 'share:75% right'])
     && J(stats(B.dockHtml(model({ states: B.states(qs, answers, 4) }), 1, e, icon, false))) === J(['right:3 right', 'wrong:1 wrong', 'share:75% right']), J(stats(shut)));
  ok('and before any answer, none answered, not 0%', J(stats(B.dockHtml(model({ states: B.states(qs, {}, 0) }), 0, e, icon, false)).slice(-1)) === J(['share:none answered']));
  ok('the brain is one group a tap picks from (sessionBrainTap) and a key reaches (tabindex 0), its name saying the counts and how',
     /<svg class="sb-brain" viewBox="0 0 120 100" role="group" aria-label="The session as a brain: a point for each of 10 questions, 3 right, 1 wrong, 6 not answered yet\. Tap it, or use the arrow keys, to pick a question\." tabindex="0" data-action="sessionBrainTap">/.test(html));
  ok('a point per question, and a ring on the one picked', count(html, 'class="sb-dot"') === 20 && /<circle class="sb-pick" cx="([\d.]+)" cy="([\d.]+)"/.exec(html).slice(1).join(',') === B.layout(10)[1].x + ',' + B.layout(10)[1].y, count(html, 'class="sb-dot"'));
  ok('the question picked, said in words, and a way to go to it (sessionBrainGo, its index)', html.includes('<p class="sb-picked-t">E(Question 2, answered wrong, flagged)</p>') && html.includes('<button class="sb-go" type="button" data-action="sessionBrainGo" data-i="1">[icon arrow-right icon-sm] Go to question 2</button>'));
  const here = B.dockHtml(model(), 4, e, icon, true);
  ok('the question on screen is said to be, with no way to go to it', here.includes('E(Question 5, on screen, not answered yet)') && here.includes('<p class="sb-here">The question on screen.</p>') && !here.includes('sessionBrainGo'));
  ok('no pick, or one outside the session, picks the question on screen', B.dockHtml(model(), -1, e, icon, true) === here && B.dockHtml(model(), 99, e, icon, true) === here);
  const resumed = B.dockHtml(model({ resumed: true }), 1, e, icon, true);
  ok('start over only for a resumed session, by quizStartOver, and the row says it resumed', !html.includes('quizStartOver') && resumed.includes('<button class="q-restart" type="button" data-action="quizStartOver"') && resumed.includes('<span class="sb-resumed"> · resumed</span>'));
  ok('its drawings\' gradients are their own: the brain\'s (sbB) and the row\'s small one (sbR), not the button\'s (sbP)', count(html, 'id="sbBL"') === 1 && count(html, 'id="sbRL"') === 1 && !html.includes('id="sbPL"'));
  ok('the actions it names are the four the page answers, and no inline handler', J([...new Set([html, resumed].join('').match(/data-action="[a-zA-Z]+"/g))].sort())
     === J(['data-action="quizStartOver"', 'data-action="sessionBrainGo"', 'data-action="sessionBrainTap"', 'data-action="toggleSessionDetail"']) && !/\son[a-z]+=/i.test(html + B.orbHtml(model())));
  const tray = B.asksHtml(model(), e), asks = [...tray.matchAll(/<button class="src-pill sb-ask" type="button" data-action="apexAsk" data-ask="([^"]*)">([^<]*)<\/button>/g)];
  ok('the asks are drawn for the tray, not the row: a group, each sent by apexAsk with its prompt through e()', !html.includes('apexAsk') && tray.startsWith('<div class="src-strip sb-asks" role="group" aria-label="Ask Apex about this session">')
     && asks.length === 3 && asks[0][1] === 'E(' + B.asks(model())[0][1] + ')' && asks[0][2] === 'E(Go over my 1 miss)', asks.length);
}

head('the one motion, and nothing that runs on');
{
  const css = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'gnav.css'), 'utf8'));
  const rule = (css.match(/\.sb-fresh \.sb-halo\{([^}]*)\}/) || [])[1] || '';
  ok('only a fresh brain\'s halo moves: one drawn after the session changed', !/animation/.test((css.match(/(^|[}\n])\.sb-halo\{([^}]*)\}/) || [])[2] || 'animation') && B.orbHtml(model({ fresh: true })).startsWith('<svg class="sb-orb sb-fresh"') && B.orbHtml(model()).startsWith('<svg class="sb-orb" '));
  const anim = (rule.match(/animation:([^;}]*)/) || [])[1] || '';
  ok('the halo has an animation to judge (precondition)', !!anim, anim || 'none');
  ok('it runs a counted number of times, so it rests', /\s\d+\s*$/.test(anim) && !/infinite/.test(anim), anim);
  const frames = (css.match(/@keyframes sbPulse\{([\s\S]*?)\}\s*\}/) || [])[1] || '';
  ok('and moves opacity alone', !!frames && [...frames.matchAll(/([a-z-]+)\s*:/g)].every(m => m[1] === 'opacity'), frames);
  ok('and stops when motion is reduced', /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.sb-fresh \.sb-halo\{animation:none\}/.test(css));
  ok('nothing of the session brain is blurred or filtered', !/\.sb-[a-z-]+[^{]*\{[^}]*(backdrop-filter|filter)\s*:/.test(css));
  const sb = blankComments(fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'sessionbrain.js'), 'utf8'));
  ok('and the module keeps no clock and asks for no frame', !/requestAnimationFrame|setInterval|setTimeout|Date\.now|performance\.now/.test(sb));
}

head('the page writes it in, and answers what it names');
{
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  const SLOT = '@@SLOT[src:src/ui/sessionbrain.js]@@';
  ok('the module is written into the page once, above the question screen', n(SLOT) === 1 && page.indexOf(SLOT) < page.indexOf('@@SLOT[src:src/app/quiz.js]@@'));
  const table = name => (page.match(new RegExp('const ' + name + '=\\{([\\s\\S]*?)\\n\\};')) || [])[1] || '';
  const WANT = { ACTIONS: ['toggleSessionDetail:()=>toggleSessionDetail(),', 'sessionBrainTap:(el,ev)=>sessionBrainTap(el,ev),', 'sessionBrainGo:el=>goToQ(+el.dataset.i),', 'apexAsk:el=>askApex(el.dataset.ask),', 'quizStartOver:()=>restartQuiz(),'],
    KEY_ACTIONS: ['sessionBrainTap:(el,ev)=>sessionBrainKey(ev),'] };
  const missing = Object.entries(WANT).flatMap(([t, es]) => es.filter(x => table(t).split(x).length !== 2).map(x => t + ': ' + x));
  ok('its actions are in the page\'s tables once each, as written: the row, the tap and the keys, go, the asks, start over', missing.length === 0, missing.join(' | ') || 'all');
  const fns = ['toggleSessionDetail', 'sessionBrainTap', 'sessionBrainKey', 'goToQ', 'paintApexSession', 'sessionBrainModel', 'syncApexBrain', 'apexSessionHtml', 'askApex', 'restartQuiz'];
  ok('and the functions they call are the page\'s, once each', fns.every(f => n('function ' + f + '(') === 1), fns.map(f => f + ':' + n('function ' + f + '(')).join(' '));
  const build = (page.match(/function buildAI\(\)\{[\s\S]*?\n\}/) || [''])[0], now = (page.match(/function renderNow\(\)\{[\s\S]*?\n\}/) || [''])[0];
  ok('the session is in Apex\'s head, on its setup screen too', /const session=apexSessionHtml\(\), kit=apexKit\(\), head=ApexPanel\.headHtml\(q,kit,session\);/.test(build) && build.indexOf('apexSessionHtml()') < build.indexOf('setupPanelHtml(head'));
  ok('and the button is set at each draw of a screen', /\bsyncApexBrain\(\);/.test(now));
  const local = (page.match(/function apexLocalHtml\(inTray\)\{[\s\S]*?\n\}/) || [''])[0];
  ok('the session\'s asks head the tray on a question, and only there', /return \(inTray&&onSession\(\)\?SessionBrain\.asksHtml\(sessionBrainModel\(\),e\):''\)\+/.test(local), local.slice(0, 120));
  ok('the button holds the brain and the place beside Apex\'s own mark', /<button class="ai-fab" id="aiFab"[^>]*>\s*<span class="fab-brain" id="fabBrain" aria-hidden="true"><\/span><canvas class="fab-av" id="apexFabAvatar"[^>]*><\/canvas> Apex<span class="fab-count" id="fabCount" aria-hidden="true"><\/span><\/button>/.test(page));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
