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
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, 'hypertension.html'));
let p = 0, f = 0;
const ok = (l, c, d = '') => { c ? p++ : f++; console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? '  → ' + d : '')); };

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
