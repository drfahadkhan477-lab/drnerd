#!/usr/bin/env node
/*
 * The screen a finished session ends on — src/app/results.js.
 *
 *   node tests/verify-results-pure.js
 *
 * Pure Node, over invented state. The module is given the page's state, the bank's chapters, their accents
 * and four helpers, and returns markup; nothing here has a page. The helpers it is handed below are
 * stand-ins that say what they were asked (e('x') is "E(x)", semText('c') is "INK(c)"), so every expected
 * figure is worked out here from the state, never read back from the module, and a helper that was not
 * called shows as its absence.
 *
 * What is measured, rather than assumed:
 *   - the score is the quiz's when a quiz was answered and the session's when none was, rounded, and 0%
 *     with nothing answered; "session total" is added only when it is not the number already shown;
 *   - green, amber and red change at 80 and 60, with the icon and the words, and the ring is drawn to
 *     the same percent;
 *   - a row for every chapter answered at all, in the bank's order, changing colour at 70 and 50, with
 *     the chapter's accent, its name escaped and its percent in ink;
 *   - "Retry Missed" and "Explain my misses" only when something is missed; what the last button says and
 *     restarts, by mode; and that the chapter's name is never written into a handler;
 *   - the eight names of the state it reads, and that it changes nothing it is given;
 *   - the page's one line hands over the page's own state and helpers, the three handlers the buttons
 *     name are the page's, and the page's own helpers, cut from it, draw what the page shows.
 *
 * Nothing here reads the clock or the time zone.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const R = require('../src/app/results.js').ResultsScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);

/* Stand-ins that say what they were asked. None writes a tag, so a button's words can be read whole. */
const KIT = Object.freeze({
  e: s => 'E(' + s + ')',
  icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
  chIcon: ch => '[ch ' + ch + ']',
  semText: v => 'INK(' + v + ')',
});
const state = o => Object.assign({ quizTotal: 0, quizCorrect: 0, sessionTotal: 0, sessionCorrect: 0, chStats: {}, missed: new Set(), mode: 'all', chapter: null }, o);
/* A module that throws says so in the markup, so the check that asked says FAIL and the run goes on. */
const draw = (S, chapters, colors, kit) => { try { return String(R.screenHtml(S, chapters || [], colors || {}, kit || KIT)); } catch (err) { return 'THREW ' + err.message; } };

/* The parts of the markup a reader sees. Each returns something comparable when the part is missing. */
const g = (html, re) => (html.match(re) || []).slice(1);
const scoreOf = html => g(html, /class="score-pct" style="color:([^"]*)">([^<]*)%</);            // [colour, percent]
const subOf = html => (g(html, /<div class="score-sub">([^<]*)<\/div>/)[0] || 'NO SUB LINE');
const msgOf = html => (g(html, /<div class="score-msg">([^<]*)<\/div>/)[0] || 'NO MESSAGE');
const ariaOf = html => (g(html, /aria-label="Score ([^"]*) percent"/)[0] || 'NO LABEL');
const ringOf = html => g(html, /stroke="([^"]+)" stroke-width="10"\s+stroke-dasharray="([^"]+)" stroke-dashoffset="([^"]+)"/);   // [colour, dash, offset]
const rowsOf = html => html.split('<div class="chp-row"').slice(1).map(r => ({
  accent: g(r, /^ style="--accent:([^"]*)"/)[0],
  icon: g(r, /class="chp-icon">([^<]*)</)[0],
  name: g(r, /class="chp-name">([^<]*)</)[0],
  scale: g(r, /class="chp-fill" style="transform:scaleX\(([^)]*)\);background:([^"]*)"/)[0],
  fill: g(r, /class="chp-fill" style="transform:scaleX\(([^)]*)\);background:([^"]*)"/)[1],
  ink: g(r, /class="chp-pct" style="color:([^"]*)">([^<]*)%</)[0],
  pct: g(r, /class="chp-pct" style="color:([^"]*)">([^<]*)%</)[1],
  count: g(r, /class="chp-count">([^<]*)</)[0],
}));
const buttonsOf = html => [...html.matchAll(/<button\b[^>]*\bonclick="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].map(m => [m[1], m[2].trim()]);

head('the score is the quiz\'s when a quiz was answered, and the session\'s when none was');
{
  const quiz = draw(state({ quizTotal: 10, quizCorrect: 7, sessionTotal: 30, sessionCorrect: 12 }));
  ok('a quiz of 7 in 10 inside a session of 12 in 30 says 70%, and gives the session beside it',
     scoreOf(quiz)[1] === '70' && subOf(quiz) === '7 correct · 3 wrong · 10 answered · session total 12/30', scoreOf(quiz)[1] + '% · ' + subOf(quiz));
  const none = draw(state({ quizTotal: 0, quizCorrect: 5, sessionTotal: 8, sessionCorrect: 6 }));
  ok('with no quiz answered the session\'s 6 in 8 is the score, whatever the quiz\'s count was left at',
     scoreOf(none)[1] === '75' && subOf(none).startsWith('6 correct · 2 wrong · 8 answered'), scoreOf(none)[1] + '% · ' + subOf(none));
  ok('and the session is not given a second time beside itself', subOf(none) === '6 correct · 2 wrong · 8 answered', subOf(none));
  const same = draw(state({ quizTotal: 5, quizCorrect: 4, sessionTotal: 5, sessionCorrect: 4 }));
  ok('nor when the quiz was the whole session', subOf(same) === '4 correct · 1 wrong · 5 answered', subOf(same));
  const empty = draw(state({}));
  ok('nothing answered is 0%, with nothing counted', scoreOf(empty)[1] === '0' && subOf(empty) === '0 correct · 0 wrong · 0 answered', scoreOf(empty)[1] + '% · ' + subOf(empty));
  const pcts = [[2, 3], [1, 3], [1, 200], [199, 200]].map(([c, t]) => scoreOf(draw(state({ quizTotal: t, quizCorrect: c })))[1]);
  ok('the percent is rounded to the nearest whole: 2 in 3, 1 in 3, 1 in 200, 199 in 200', J(pcts) === J(['67', '33', '1', '100']), pcts.join(' '));
  ok('and the ring\'s label says the same percent', ariaOf(quiz) === '70' && ariaOf(empty) === '0', ariaOf(quiz) + ', ' + ariaOf(empty));
}

head('green, amber and red, at 80 and 60');
{
  const want = { green: ['var(--green)', 'trophy', 'Outstanding!'], amber: ['var(--amber)', 'target', 'Good Progress!'], red: ['var(--red)', 'book', 'Keep Studying!'] };
  for (const [p, band] of [[80, 'green'], [79, 'amber'], [60, 'amber'], [59, 'red']]) {
    const html = draw(state({ quizTotal: 100, quizCorrect: p }));
    const [colour, name, words] = want[band];
    const got = [ringOf(html)[0], scoreOf(html)[0], msgOf(html)];
    ok(`${p}% is ${band}: the ring, the figure's ink, the icon and the words`,
       J(got) === J([colour, 'INK(' + colour + ')', '[icon ' + name + ' icon-lg] ' + words]), got.join(' · '));
  }
}

head('the ring is drawn to the percent');
{
  const circ = 2 * Math.PI * 50, near = (a, b) => Math.abs(a - b) < 1e-9;
  const at = p => ringOf(draw(state({ quizTotal: 100, quizCorrect: p }))).slice(1).map(Number);
  const [dash70, off70] = at(70);
  ok('its dash is the circumference of a ring of radius 50', near(dash70, circ), String(dash70));
  ok('at 70% the gap left is 30% of it', near(off70, circ * 0.3), String(off70));
  const [, off0] = at(0), [, off100] = at(100);
  ok('at 0% the gap is the whole ring, and at 100% there is none', near(off0, circ) && near(off100, 0), off0 + ', ' + off100);
}

/* The bank's order, deliberately not the alphabet's. Delta was opened and never answered, Epsilon has no
   record, and Ghost has a record but is not a chapter of this bank. */
const BANK = Object.freeze(['Beta', 'Alpha', 'Zeta', 'Gamma', 'Delta', 'Epsilon']);
const RECORD = () => ({ Alpha: { correct: 7, total: 10 }, Beta: { correct: 1, total: 2 }, Zeta: { correct: 69, total: 100 }, Gamma: { correct: 49, total: 100 },
                        Delta: { correct: 0, total: 0 }, Ghost: { correct: 1, total: 1 } });
const COLORS = Object.freeze({ Alpha: '#111111' });

head('a row for every chapter answered, in the bank\'s order');
{
  const html = draw(state({ quizTotal: 10, quizCorrect: 7, chStats: RECORD() }), BANK, COLORS);
  const rows = rowsOf(html), by = n => rows.find(r => r.name === 'E(' + n + ')') || {};
  const answered = ['Beta', 'Alpha', 'Zeta', 'Gamma'].map(n => 'E(' + n + ')');
  ok('the chapters answered are in the order the bank gives them', J(rows.map(r => r.name).filter(n => answered.includes(n))) === J(answered), rows.map(r => r.name).join(' '));
  ok('a chapter never answered, one with no record, and a record with no chapter in the bank have no row',
     rows.length > 0 && rows.every(r => answered.includes(r.name)), rows.map(r => r.name).join(' ') || 'no rows');
  const a = by('Alpha');
  ok('7 in 10 is 70%: a green bar seven tenths long, "70%" and "7/10"', J([a.fill, a.scale, a.pct, a.count]) === J(['var(--green)', '0.7', '70', '7/10']), J([a.fill, a.scale, a.pct, a.count]));
  ok('69% is amber', J([by('Zeta').fill, by('Zeta').pct]) === J(['var(--amber)', '69']), J([by('Zeta').fill, by('Zeta').pct]));
  ok('50% is still amber', J([by('Beta').fill, by('Beta').pct]) === J(['var(--amber)', '50']), J([by('Beta').fill, by('Beta').pct]));
  ok('49% is red', J([by('Gamma').fill, by('Gamma').pct]) === J(['var(--red)', '49']), J([by('Gamma').fill, by('Gamma').pct]));
  const third = rowsOf(draw(state({ chStats: { Alpha: { correct: 2, total: 3 }, Beta: { correct: 1, total: 3 } } }), BANK, COLORS)).map(r => r.pct);
  ok('a row\'s percent is rounded as the score\'s is: 1 in 3 is 33%, 2 in 3 is 67%', J(third) === J(['33', '67']), third.join(' '));
  ok('a row takes its chapter\'s accent, and the teal when the chapter has none', a.accent === '#111111' && by('Beta').accent === 'var(--teal)', a.accent + ', ' + by('Beta').accent);
  ok('the chapter\'s name goes through e(), and its icon is chIcon\'s for that chapter', a.name === 'E(Alpha)' && a.icon === '[ch Alpha]', a.name + ' ' + a.icon);
  ok('every percent on the screen is written in its colour\'s ink, the score and each row',
     rows.length === 4 && [scoreOf(html)[0], ...rows.map(r => r.ink)].every((c, i) => c === 'INK(' + (i ? rows[i - 1].fill : ringOf(html)[0]) + ')'),
     [scoreOf(html)[0], ...rows.map(r => r.ink)].join(' '));
  ok('the rows stand under their heading', html.includes('<div class="section-label">Cumulative Chapter Performance</div><div class="ch-perf"><div class="chp-row"'));
  const bare = draw(state({ quizTotal: 10, quizCorrect: 7, chStats: { Delta: { correct: 0, total: 0 } } }), BANK, COLORS);
  ok('and with no chapter answered there is no heading and no list', !bare.startsWith('THREW') && !bare.includes('Cumulative Chapter Performance') && !bare.includes('ch-perf') && rowsOf(bare).length === 0);
}

head('what the buttons offer');
{
  const clean = buttonsOf(draw(state({ quizTotal: 4, quizCorrect: 4 })));
  ok('"Back to Chapters" is first, and goes home', J(clean[0]) === J(['goHome()', '[icon arrow-left icon-sm] Back to Chapters']), J(clean[0]));
  ok('with nothing missed there is that and the restart, and no more', clean.length === 2 && !clean.some(b => /Missed|misses/.test(b[1])), clean.map(b => b[1]).join(' | '));
  const three = buttonsOf(draw(state({ quizTotal: 4, quizCorrect: 1, missed: new Set(['a', 'b', 'c']) })));
  ok('with three missed, "Retry Missed (3)" starts a quiz of the missed', J(three[1]) === J(['startQuiz(null,\'missed\')', '[icon repeat icon-sm] Retry Missed (3)']), J(three[1]));
  ok('and "Explain my misses" asks Apex', J(three[2]) === J(['askApexMisses()', '[icon zap icon-sm] Explain my misses']), J(three[2]));
  ok('four buttons then, the restart last', three.length === 4 && /^startQuiz\(/.test((three[3] || [''])[0]) && three[0][0] === 'goHome()', three.map(b => b[0]).join(' | '));

  /* [mode, chapter, what the button says, what it does] */
  const RESTART = [
    ['due', 'Alpha', 'Continue Reviewing', 'startQuiz(null,\'due\')'],
    ['flagged', 'Alpha', 'Flagged Again', 'startQuiz(S.chapter,\'flagged\')'],
    ['missed', 'Alpha', 'Restart Chapter', 'startQuiz(S.chapter,\'missed\')'],
    ['missed', null, 'Restart Quiz', 'startQuiz(S.chapter,\'missed\')'],
    ['all', 'Alpha', 'Restart Chapter', 'startQuiz(S.chapter,\'all\')'],
    [undefined, null, 'Restart Quiz', 'startQuiz(S.chapter,\'all\')'],
    ['chapter', '', 'Restart Quiz', 'startQuiz(S.chapter,\'all\')'],
  ];
  for (const [mode, chapter, says, does] of RESTART) {
    const last = buttonsOf(draw(state({ quizTotal: 4, quizCorrect: 4, mode, chapter }))).pop() || [];
    ok(`mode ${J(mode)}, chapter ${J(chapter)}: "${says}", which runs ${does}`, J(last) === J([does, says]), J(last));
  }
  const hostile = draw(state({ quizTotal: 4, quizCorrect: 4, mode: 'all', chapter: 'x\'),alert(1),(\'' }));
  ok('the chapter\'s name is never written into a handler: the button says S.chapter, the page\'s own name for it',
     !hostile.startsWith('THREW') && !hostile.includes('alert(1)') && (buttonsOf(hostile).pop() || [])[0] === 'startQuiz(S.chapter,\'all\')', (buttonsOf(hostile).pop() || [])[0]);
}

head('it reads the state it is given, and changes nothing');
{
  /* The state behind a proxy that notes each name asked for and each attempt to change one. */
  const read = new Set(), wrote = [];
  const watched = S => new Proxy(S, {
    get(t, k) { if (typeof k === 'string') read.add(k); return t[k]; },
    set(t, k) { wrote.push('set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push('delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push('define ' + String(k)); return true; },
  });
  const STATES = [
    state({ quizTotal: 10, quizCorrect: 7, sessionTotal: 30, sessionCorrect: 12, chStats: RECORD(), missed: new Set(['a']), mode: 'all', chapter: 'Alpha' }),
    state({ sessionTotal: 8, sessionCorrect: 6, mode: 'due' }),
    state({ quizTotal: 3, quizCorrect: 3, mode: 'flagged' }),
    state({ mode: 'missed', chapter: null }),
  ];
  const before = STATES.map(S => J([S, [...S.missed]]));
  const drawn = STATES.map(S => draw(watched(S), BANK, COLORS));
  const WANT = ['chStats', 'chapter', 'missed', 'mode', 'quizCorrect', 'quizTotal', 'sessionCorrect', 'sessionTotal'];
  ok('across a quiz, a review, the flagged and the missed it asks for eight names of the state, and no other',
     drawn.every(h => !h.startsWith('THREW')) && J([...read].sort()) === J(WANT), [...read].sort().join(' '));
  ok('it sets, deletes and defines nothing on the state', drawn.every(h => !h.startsWith('THREW')) && wrote.length === 0, wrote.join(', ') || 'nothing');
  ok('and the record, the missed set and the rest are as they were', J(STATES.map(S => J([S, [...S.missed]]))) === J(before));
  /* Frozen all the way down: in a strict module a write throws, and draw() then says THREW. */
  const deep = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object' && !(v instanceof Set)) deep(v); }); return Object.freeze(o); };
  const S = state({ quizTotal: 10, quizCorrect: 7, chStats: RECORD(), missed: new Set(['a']) });
  const loose = draw(S, [...BANK], Object.assign({}, COLORS), Object.assign({}, KIT));
  const frozen = draw(deep(state({ quizTotal: 10, quizCorrect: 7, chStats: RECORD(), missed: new Set(['a']) })), BANK, COLORS, KIT);
  ok('given the state, the chapters, the accents and the helpers frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === loose && rowsOf(frozen).length === 4, frozen.slice(0, 80));
}

head('the page hands over its own state and helpers');
{
  /* Read with its comments blanked: the page explains itself, and quotes what is looked for. Positions are
     kept, so code found in the blanked copy is taken from the real one. */
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const LINE = 'function buildResults(){ return ResultsScreen.screenHtml(S,CHAPTERS,CH_COLORS,{chIcon,e,icon,semText}); }';
  ok('buildResults() is one line: the state, the chapters, their accents and the four helpers', count(LINE) === 1 && count('function buildResults(') === 1, `${count(LINE)} such line(s), ${count('function buildResults(')} declaration(s)`);
  const slot = page.indexOf('@@SLOT[src:src/app/results.js]@@');
  ok('the module is written into the page once, above that line', slot >= 0 && count('@@SLOT[src:src/app/results.js]@@') === 1 && page.indexOf(LINE) > slot, slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the screen\'s own words are no longer in the page', count('Cumulative Chapter Performance') === 0 && count('Back to Chapters') === 0 && count('Retry Missed') === 0,
     ['Cumulative Chapter Performance', 'Back to Chapters', 'Retry Missed'].map(t => count(t)).join(' '));

  /* Every handler the markup can name, over every button it can show. */
  const named = new Set();
  for (const mode of ['due', 'flagged', 'missed', 'all'])
    for (const b of buttonsOf(draw(state({ quizTotal: 4, quizCorrect: 1, missed: new Set(['a']), mode, chapter: 'Alpha' })))) named.add((b[0].match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]);
  const handlers = [...named].sort();
  ok('its buttons name three handlers', J(handlers) === J(['askApexMisses', 'goHome', 'startQuiz']), handlers.join(' '));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));

  /* The page's own helpers and its own line, with the module where the slot stands, in a context that has
     nothing else: what the reader is shown, less the page. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const code = [whole('function icon(name, cls){', '\n}'), whole('const CH_ICONS={', '\n'), whole('function chIcon(ch,cls){', '\n'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'),
                whole('function semText(v){', '\n'), whole('const CH_COLORS={', '\n'), fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'results.js'), 'utf8'), LINE].join('\n');
  const ctx = { S: state({ quizTotal: 10, quizCorrect: 9, chStats: { 'A <b> & "c"': { correct: 9, total: 10 }, Arrhythmias: { correct: 1, total: 4 } } }), CHAPTERS: ['A <b> & "c"', 'Arrhythmias'] };
  ctx.window = ctx; vm.createContext(ctx);
  let shown; try { vm.runInContext(code, ctx); shown = String(vm.runInContext('buildResults()', ctx)); } catch (err) { shown = 'THREW ' + err.message; }
  const rows = rowsOf(shown);
  ok('the page\'s own line draws the screen with the page\'s own helpers', !shown.startsWith('THREW') && rows.length === 2 && scoreOf(shown)[1] === '90', shown.slice(0, 90));
  ok('a chapter\'s name is escaped by the page\'s e()', (rows[0] || {}).name === 'A &lt;b&gt; &amp; &quot;c&quot;' && !shown.includes('<b>'), (rows[0] || {}).name);
  ok('a percent is in ink through the page\'s semText(): the ring green, the figure green-ink, the red row red-ink',
     ringOf(shown)[0] === 'var(--green)' && scoreOf(shown)[0] === 'var(--green-ink)' && (rows[1] || {}).fill === 'var(--red)' && (rows[1] || {}).ink === 'var(--red-ink)',
     [ringOf(shown)[0], scoreOf(shown)[0], (rows[1] || {}).fill, (rows[1] || {}).ink].join(' '));
  const use = n => `<use href="#i-${n}"></use>`;
  ok('and the icons are the page\'s: the trophy, a chapter\'s own, and the pin for one it does not know',
     shown.includes('<svg class="icon icon-lg" aria-hidden="true">' + use('trophy')) && /class="chp-icon"><svg class="icon" aria-hidden="true"><use href="#i-pin">/.test(shown)
     && shown.split('class="chp-icon">')[2]?.startsWith('<svg class="icon" aria-hidden="true">' + use('zap')), (shown.match(/#i-[a-z-]+/g) || []).join(' '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
