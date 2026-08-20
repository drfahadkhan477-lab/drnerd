#!/usr/bin/env node
/*
 * Drive the built study sheet the way a person would, and check what happened.
 *
 *   NODE_PATH=$(npm root -g) node study/hypertension/check.js [page.html]
 *
 * It runs at a phone viewport because that is where this will actually be read.
 * Two of the assertions wait for a transition to settle rather than reading the
 * computed style the instant after a click: the stripe reveals over 320ms and
 * the progress bar over 420ms, and reading either mid-flight makes the suite
 * fail on a busy machine and pass on an idle one, which is worse than no test.
 *
 * It also audits the bank itself before opening a browser, because the worst
 * defect a drill can have is not a broken button — it is a question you can
 * answer without knowing the medicine.
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, 'hypertension.html'));
let p = 0, f = 0;
const ok = (l, c, d = '') => { c ? p++ : f++; console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? '  → ' + d : '')); };

/* ── the bank, before anything is rendered ────────────────────────────────────
   These need no browser, so they run first and fail fast. */
global.window = global;
require(path.join(__dirname, 'questions.js'));
require(path.join(__dirname, 'facts.js'));
const QS = global.QS, FACTS = global.FACTS;

/* The answer key, written out as the text of the correct option rather than as
   a letter. Positions move — the options were reordered once already to stop
   the keys bunching on B — and a key recorded as "Q3: C" would have silently
   become a lie that day. Recorded as text it cannot: if an option is reworded
   or a key is repointed, this list stops matching and says which question.
   Each of these was checked against the 2017 ACC/AHA guideline and the trial
   named in its explanation. Changing an entry here means changing the medicine,
   so it should be as deliberate as that sounds. */
const ANSWER_KEY = [
  'Lifestyle modification alone, with reassessment in 3–6 months.',
  'Targeting systolic <120 cut cardiovascular events and mortality, but pressure was measured by unattended automated office readings.',
  'A thiazide-type diuretic plus a dihydropyridine calcium channel blocker.',
  'Spironolactone.',
  'A 48-year-old with stage 1 hypertension controlled on one agent, potassium normal.',
  'Spironolactone.',
  'Alpha-blockade should be established before beta-blockade.',
  'Fibromuscular dysplasia.',
  'New papilloedema.',
  'By no more than about 25% of mean arterial pressure in the first hour.',
  'Intravenous esmolol or labetalol first, adding a vasodilator if needed.',
  'Lisinopril.',
  'Coarctation of the aorta.',
  'Regular non-steroidal anti-inflammatory drug use.',
  'White coat hypertension.',
  'It has a longer duration of action and better outcome trial evidence.',
  'An ACE inhibitor or an angiotensin receptor blocker.',
  'Heart failure with reduced ejection fraction.',
  'Bilateral renal artery stenosis.',
  'The patient should sit quietly for 5 minutes, back supported, arm at heart level, feet flat.',
];

function auditBank() {
  console.log('\n── the questions themselves ──');

  ok('the bank is the size the answer key expects', QS.length === ANSWER_KEY.length,
     `${QS.length} questions, ${ANSWER_KEY.length} keys`);
  const wrong = QS.map((q, i) => ({ n: i + 1, got: q.o[q.ci], want: ANSWER_KEY[i] }))
                  .filter(r => r.got !== r.want);
  ok('every key points at the answer that was checked against the guideline', wrong.length === 0,
     wrong.length ? wrong.map(r => `Q${r.n}: "${r.got.slice(0, 40)}" ≠ "${r.want.slice(0, 40)}"`).join(' | ')
                  : `${QS.length}/${QS.length} verified`);

  const malformed = QS.filter(q =>
    typeof q.s !== 'string' || !/\?$/.test(q.s.trim()) ||
    !Array.isArray(q.o) || q.o.length < 4 ||
    !Number.isInteger(q.ci) || q.ci < 0 || q.ci >= q.o.length ||
    typeof q.ex !== 'string' || q.ex.length < 150 || !q.t);
  ok('every item is well-formed and its key is in range', malformed.length === 0,
     malformed.length ? malformed.map(q => q.s.slice(0, 40)).join(' | ') : `${QS.length} questions`);

  const dupes = QS.filter(q => new Set(q.o.map(o => o.trim().toLowerCase())).size !== q.o.length);
  ok('no question repeats an option', dupes.length === 0, dupes.map(q => q.t).join(', ') || 'all distinct');

  /* An explanation that says "option B" silently becomes wrong the moment an
     option is inserted or reordered. Arguing from content instead is what makes
     the rewrite below safe. */
  const positional = QS.filter(q => /\b(?:option|answer|choice)\s+[A-E]\b/i.test(q.ex));
  ok('no explanation argues from a letter rather than from content', positional.length === 0,
     positional.map(q => q.t).join(', ') || 'none');

  /* The tell that matters. Writing a fully specified key beside four throwaway
     distractors lets you score far above chance by picking the long one — this
     bank scored 13/20 that way before the distractors were written out properly.
     Ties are meaningless, so the bar is the visible margin, not the raw count. */
  const margin = QS.map((q, i) => {
    const L = q.o.map(o => o.length);
    return { n: i + 1, by: L[q.ci] - Math.max(...L.filter((_, j) => j !== q.ci)) };
  });
  const tells = margin.filter(m => m.by > 8);
  ok('no key is visibly longer than every distractor', tells.length === 0,
     tells.length ? tells.map(m => `Q${m.n} +${m.by} chars`).join(', ')
                  : `widest margin ${Math.max(...margin.map(m => m.by))} chars`);

  /* Guessing the shortest is the other half of the same trick. */
  const shortest = QS.filter(q => {
    const L = q.o.map(o => o.length);
    return L[q.ci] === Math.min(...L) && L[q.ci] < Math.max(...L) * 0.6;
  });
  ok('and no key is conspicuously the shortest', shortest.length === 0,
     shortest.map(q => q.t).join(', ') || 'none');

  /* Where the key sits is the third free lunch. These bunched at A:6 B:8 C:4
     D:1 E:1, so answering B every time scored 8/20 — double chance, and no
     more about hypertension than picking the longest option was. Even is not
     required; no position carrying more than a third of them is. */
  const keys = QS.map(q => q.ci);
  const perSlot = [0, 1, 2, 3, 4].map(i => keys.filter(k => k === i).length);
  const worst = Math.max(...perSlot);
  ok('no option position carries more than a third of the keys', worst <= Math.ceil(QS.length / 3),
     'ABCDE'.split('').map((L, i) => L + ':' + perSlot[i]).join(' '));

  ok('the crib sheet is populated', FACTS.length >= 20 && FACTS.every(f => f.length === 2 && f[0] && f[1]),
     `${FACTS.length} points`);
}

auditBank();

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 } });   // a phone
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(URL, { waitUntil: 'load' });

  console.log('\n── it boots ──');
  ok('the first question is on screen', await pg.locator('.stem').count() === 1);
  ok('five options', await pg.locator('.opt').count() === 5);
  const strip = await pg.evaluate(() => {
    const b = document.getElementById('ecg-base'), r = document.getElementById('ecg-run');
    return { d: (b.getAttribute('d') || '').length, same: b.getAttribute('d') === r.getAttribute('d'),
             seg: parseFloat(r.style.getPropertyValue('--seg')), len: parseFloat(r.style.getPropertyValue('--len')) };
  });
  ok('the strip is drawn', strip.d > 200 && strip.same, strip.d + ' chars');
  ok('and the sweep was measured off the real path length', strip.len > 700 && strip.seg > 0 && strip.seg < strip.len,
     'len ' + strip.len.toFixed(0) + ', segment ' + strip.seg.toFixed(0));
  ok('position reads 1 of 20', (await pg.locator('#pos').textContent()).trim() === 'Question 1 of 20');
  ok('no horizontal overflow on a phone',
     await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
     await pg.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));

  console.log('\n── answering ──');
  /* The deck is shuffled, so find the answer for the question actually shown. */
  const liveCi = await pg.evaluate(() => {
    const stem = document.querySelector('.stem').textContent;
    const q = window.QS.find(x => x.s === stem); return q.ci;
  });
  await pg.locator('.opt').nth(liveCi).click();
  await pg.waitForSelector('.exp');
  ok('the right option is striped green', await pg.locator('.opt.correct').count() === 1);
  /* The stripe reveals over 320ms, so wait for it to settle rather than
     reading it mid-flight — this assertion is about the end state. */
  const stripe = await pg.waitForFunction(() => {
    const cs = getComputedStyle(document.querySelector('.opt.correct'), '::before');
    return (parseFloat(cs.width) >= 3 && !/inset\(\s*0(px)?\s+100%/.test(cs.clipPath)) ? cs.clipPath : false;
  }, null, { timeout: 3000 }).then(h => h.jsonValue()).catch(() => null);
  ok('the stripe reveals to full width', !!stripe, stripe || 'stayed clipped');
  ok('an explanation appears', (await pg.locator('.exp').textContent()).length > 200);
  ok('every option is now locked', await pg.evaluate(() => [...document.querySelectorAll('.opt')].every(b => b.disabled)));
  ok('the score counts it', /1<\/b> of 1/.test(await pg.locator('#score').innerHTML()));
  const bar = await pg.waitForFunction(() => {
    const m = new DOMMatrix(getComputedStyle(document.getElementById('fill')).transform);
    return m.a > 0.01 ? m.a : false;
  }, null, { timeout: 3000 }).then(h => h.jsonValue()).catch(() => 0);
  ok('progress bar moved', bar > 0.01, 'scaleX ' + Number(bar).toFixed(3));

  console.log('\n── keyboard ──');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(120);
  ok('Enter advances', (await pg.locator('#pos').textContent()).includes('2 of 20'));
  await pg.keyboard.press('1');
  await pg.waitForTimeout(120);
  ok('a number key answers', await pg.locator('.exp').count() === 1);

  console.log('\n── run it out ──');
  for (let i = 0; i < 60; i++) {   // 20 questions × answer+advance, with slack
    if (await pg.locator('#again').count()) break;
    if (await pg.locator('.exp').count()) await pg.keyboard.press('Enter');
    else await pg.locator('.opt').first().click();
    await pg.waitForTimeout(60);
  }
  ok('the score screen arrives', await pg.locator('#again').count() === 1);
  ok('it shows a per-topic breakdown', await pg.locator('.brk li').count() >= 5);
  ok('and a way back in', await pg.locator('#misses').count() === 1);

  console.log('\n── the other two modes ──');
  await pg.locator('#m-review').click();
  await pg.waitForTimeout(200);
  ok('all twenty are listed', await pg.locator('details').count() === 20);
  await pg.locator('details').first().click();
  await pg.waitForTimeout(150);
  ok('opening one shows the answer', (await pg.locator('details').first().textContent()).includes('Answer:'));
  await pg.locator('#m-facts').click();
  await pg.waitForTimeout(200);
  const factTxt = await pg.locator('#app').textContent();
  ok('the night-before sheet is there', factTxt.includes('SPRINT') && factTxt.includes('PATHWAY-2'));
  ok('topic chips hide on that sheet', await pg.evaluate(() => getComputedStyle(document.getElementById('chips')).display === 'none'));

  console.log('\n── filtering ──');
  await pg.locator('#m-quiz').click();
  await pg.waitForTimeout(150);
  const chips = await pg.locator('.chip').count();
  ok('a chip per topic, plus All', chips >= 6, chips + ' chips');
  await pg.locator('.chip').nth(1).click();
  await pg.waitForTimeout(150);
  const label = await pg.locator('.chip').nth(1).textContent();
  const want = +label.trim().split(' ').pop();
  ok('choosing a topic narrows the deck', (await pg.locator('#pos').textContent()).includes('of ' + want), label + ' / ' + await pg.locator('#pos').textContent());

  console.log('\n── theme ──');
  const lightBg = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await pg.locator('#theme').click(); await pg.locator('#theme').click();   // auto → light → dark
  await pg.waitForTimeout(150);
  const darkBg = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('dark is a different ground', lightBg !== darkBg, lightBg + ' → ' + darkBg);
  await pg.reload({ waitUntil: 'load' });
  ok('and it survives a reload', await pg.evaluate(() => document.documentElement.dataset.theme) === 'dark');

  console.log('\n── contrast ──');
  const cr = await pg.evaluate(() => {
    const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
    const bg = lum(getComputedStyle(document.body).backgroundColor);
    const rd = el => { const t = lum(getComputedStyle(el).color); const [a, b] = t > bg ? [t, bg] : [bg, t]; return (a + .05) / (b + .05); };
    return { text: rd(document.querySelector('.stem')), muted: rd(document.querySelector('.sub')) };
  });
  ok('body text clears 7:1 (AAA)', cr.text >= 7, cr.text.toFixed(1) + ':1');
  ok('muted text clears 4.5:1 (AA)', cr.muted >= 4.5, cr.muted.toFixed(1) + ':1');

  console.log('\n── offline ──');
  await pg.context().setOffline(true);
  await pg.reload({ waitUntil: 'load' });
  ok('it works with the network cut', await pg.locator('.stem, details').count() > 0);

  ok('no page errors across the run', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  console.log(`\n${p} passed, ${f} failed\n`);
  process.exit(f ? 1 : 0);
})();
