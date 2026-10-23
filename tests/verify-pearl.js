#!/usr/bin/env node
/*
 * Behavioural checks for the pearl on the home screen.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-pearl.js /path/to/patched.html
 *
 * The claim: the first thing on the home screen is a fact worth knowing, taken
 * from the fellow's own notes.
 *
 * The failure mode here is not a crash — it is a pearl that is technically a
 * sentence and useless to read. The first version of the scorer rewarded
 * capitals and digits and promoted "Key transcription factors include GATA4,
 * Nkx2.5, SRF, MEF2 and NFAT" above everything else: every signal it looked
 * for, nothing anyone can use in an exam. So most of these checks are about
 * WHICH sentence gets chosen, not whether one appears.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { booted, settled } = require('./_render.js');
const { onDeath } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-pearl.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const errors = [];
  const events = [];
  page.on('crash', () => events.push('the browser CRASHED the page'));
  page.on('close', () => events.push('the page closed'));
  page.on('requestfailed', r => {
    const why = (r.failure() || {}).errorText || '';
    if (why) events.push(`request failed: ${String(r.url()).slice(-50)} — ${why}`);
  });
  /* A crash and a close are different diagnoses; Playwright reports both
     as "Target page, context or browser has been closed" on the next call,
     so only the event says which. See tests/_deathnote.js. */
  onDeath(() => ({ section, checks: passed + failed, errors,
                   events: events.length ? events.join(', ') : 'none' }));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await booted(page, { timeout: 150000 });
  await page.waitForTimeout(900);

  head('what counts as a pearl');
  const rules = await page.evaluate(() => {
    const good = 'Oral beta-blockers should be started within the first 24 hours in patients without a contraindication.';
    const listy = 'Key transcription factors driving the programme include GATA4, Nkx2.5, SRF, MEF2 and NFAT.';
    const dangling = 'This is the reason the threshold matters so much in practice for these patients.';
    const fragment = 'Sacubitril';
    return {
      goodOk: Pearl.isPearl(good), goodScore: Pearl.score(good),
      listyScore: Pearl.score(listy),
      danglingRejected: !Pearl.isPearl(dangling),
      fragmentRejected: !Pearl.isPearl(fragment),
      /* Bullets and table rows never become pearls: they are written to be
         read under a stem and are usually not sentences at all. */
      bulletsDropped: Pearl.plain('Prose sentence here.\n- A bullet item.\n| a | table |').indexOf('bullet') < 0,
      /* A sentence starting with a bolded term must still split off cleanly. */
      splits: Pearl.sentences('…for six months. **Finerenone** is a non-steroidal MRA.').length,
    };
  });
  ok('a decision sentence is accepted', rules.goodOk);
  ok('and scores well', rules.goodScore >= 5, String(rules.goodScore));
  ok('a list of proper nouns scores below it, not above',
     rules.listyScore < rules.goodScore, `list ${rules.listyScore} vs pearl ${rules.goodScore}`);
  ok('a sentence that refers back to its paragraph is refused', rules.danglingRejected);
  ok('a fragment is refused', rules.fragmentRejected);
  ok('bullets and table rows are not mined for pearls', rules.bulletsDropped);
  ok('a sentence opening with a bolded term still splits off its neighbour',
     rules.splits === 2, rules.splits + ' sentence(s)');

  head('the harvest from the shipped library');
  const harvest = await page.evaluate(() => {
    const all = Pearl.harvest(REF);
    return { n: all.length, notes: REF.length,
             withFig: all.filter(p => p.figKey).length,
             tooLong: all.filter(p => p.text.length > Pearl.MAX).length,
             unterminated: all.filter(p => !/[.!?]$/.test(p.text)).length,
             stillMarked: all.filter(p => /[*_`]/.test(p.text)).length,
             everyChapterNamed: all.every(p => p.chapter && p.chapter.length > 1) };
  });
  ok('the library yields a usable number of pearls', harvest.n > 40,
     `${harvest.n} from ${harvest.notes} notes`);
  ok('some carry a figure from their note', harvest.withFig > 5, harvest.withFig + ' with a figure');
  /* Was "none is longer than a sentence". A pearl is now allowed to be a run
     of up to three sentences forming one statement — the cap that made them
     read as clipped. The ceiling is still real and is asserted below. */
  ok('none runs past the ceiling', harvest.tooLong === 0);
  ok('none is a clipped fragment', harvest.unterminated === 0);
  ok('markdown emphasis is stripped before display', harvest.stillMarked === 0);
  ok('each names the note it came from', harvest.everyChapterNamed);

  head('aimed at weak chapters, without becoming only weak chapters');
  /* THIS USED TO ASSERT A BARE COUNT, AND PASSED FOR THE WRONG REASON.
     "hitWeak >= 12 of 60" is only evidence of aiming if you know what share of
     the shelf the weak chapter already occupies. It did not, and the shelf was
     mostly heart failure, so a draw with the weighting entirely broken still
     cleared 12 on the base rate alone — which is exactly what was happening:
     the token "heart", split out of "Heart Failure & Cardiomyopathies",
     matched every source on the shelf ("Braunwald's Heart Disease"), so every
     pearl was boosted and the boost cancelled out.

     So the count is now measured against the base rate it has to beat. A
     broken weighting scores 1.0x by construction, whatever the corpus looks
     like, and the check no longer depends on the corpus staying heart-shaped.
     Note the ratio falls toward 1.0 as the weak chapter's share approaches the
     whole shelf; the floor here is set for the case aiming exists for, where
     the weak chapter is a minority of what is on offer. */
  const weighting = await page.evaluate(() => {
    S.chStats = { 'Heart Failure & Cardiomyopathies': { correct: 4, total: 30 },
                  'Arrhythmias': { correct: 28, total: 30 } };
    const words = Pearl.weakWords(3);
    const all = Pearl.harvest(REF);
    const aimed = Pearl.aimWords(all, words);
    /* Deterministic sampling: a fixed sequence rather than Math.random, so a
       failure here is a real change in the weighting and not bad luck. */
    let i = 0; const seq = () => ((i = (i * 9301 + 49297) % 233280) / 233280);
    const picks = [];
    for (let n = 0; n < 60; n++) picks.push(Pearl.pick(all, null, seq));
    const isWeak = p => /failure|cardiomyopath/i.test(p.title + ' ' + p.source);
    const hitWeak = picks.filter(isWeak).length;
    const baseWeak = all.filter(isWeak).length / all.length;
    const distinct = new Set(picks.map(p => p.id)).size;
    const strong = new Set(picks.filter(p => !isWeak(p)).map(p => p.chapter)).size;
    return { words, aimed, hitWeak, baseWeak, distinct, strong, pool: all.length };
  });
  ok('weak chapters are identified from the score history', weighting.words.length > 0,
     weighting.words.join(', '));
  /* Arrhythmias is 28/30 here — the strong chapter. It used to be aimed at
     anyway, because the weak list was the bottom three by rank and there are
     only two chapters; that went unnoticed until the shelf had arrhythmia
     notes for it to boost. Guarded on a non-empty list, so a weakWords that
     returned nothing at all fails the check above rather than passing this. */
  ok('a chapter scoring above the fellow\'s average is not aimed at',
     weighting.words.length > 0 && !weighting.words.includes('arrhythmias'),
     weighting.words.join(', '));
  /* The guard on the bug itself. Every source on this shelf carries the book's
     name, so a chapter word that also appears in it matches everything. */
  ok('a word that matches the whole shelf is not used to aim',
     weighting.aimed.length > 0 && weighting.aimed.length < weighting.words.length
       && !weighting.aimed.includes('heart'),
     `kept ${weighting.aimed.join(', ') || 'nothing'} of ${weighting.words.join(', ')}`);
  const lift = weighting.baseWeak ? (weighting.hitWeak / 60) / weighting.baseWeak : 0;
  ok('the weak chapter is over-represented against its share of the shelf', lift >= 1.25,
     `${weighting.hitWeak}/60 = ${(100 * weighting.hitWeak / 60).toFixed(0)}% drawn `
       + `vs ${(100 * weighting.baseWeak).toFixed(0)}% of the ${weighting.pool}-pearl shelf `
       + `→ ${lift.toFixed(2)}x`);
  ok('but the pearl is not always the same one', weighting.distinct > 15,
     weighting.distinct + ' distinct in 60 draws');
  ok('and the strong chapters have not been crowded out', weighting.strong >= 5,
     weighting.strong + ' other chapters in the same 60 draws');

  head('on the page');
  const card = await page.evaluate(() => {
    S.screen = 'home'; render();
    return new Promise(r => setTimeout(() => r({
      exists: !!document.getElementById('pearlCard'),
      text: (document.getElementById('pearlBody') || {}).textContent || '',
      cap: (document.getElementById('pearlCap') || {}).textContent || '',
      hasNext: !!document.querySelector('.pearl-next'),
      hasOpen: !!document.querySelector('.pearl-open'),
      /* It sits after the hero and before the progress bar. */
      afterHero: !!(document.querySelector('.hero-live') &&
        document.querySelector('.hero-live').compareDocumentPosition(document.getElementById('pearlCard'))
        & Node.DOCUMENT_POSITION_FOLLOWING),
    }), 700));
  });
  ok('the card is on the home screen', card.exists);
  ok('it carries a real sentence', card.text.length > 40, card.text.slice(0, 70));
  ok('and names its chapter', card.cap.length > 2, card.cap);
  ok('it sits below the hero, not inside it', card.afterHero);
  ok('there is a way to see another', card.hasNext);
  ok('and a way into the note behind it', card.hasOpen);

  head('one sentence, broken at its own joints');
  const lad = await page.evaluate(() => {
    const S1 = 'The highest risk of ischaemic complications is within 180 days, after which risk becomes roughly linear — so the first six months are where secondary prevention earns most of its benefit.';
    const S2 = 'Oral beta-blockers should be started within the first 24 hours — a Class I recommendation — in patients without contraindications.';
    const S3 = 'Early invasive — angiography within 2 hours if very high risk, meaning haemodynamic or electrical instability, cardiogenic shock, or refractory angina; otherwise within 24 hours.';
    const S4 = 'STEMI has persistent ST elevation of 20 minutes or more in at least two contiguous leads.';
    const words = t => t.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim().split(' ').filter(Boolean);
    /* The connective a step was cut at is PARAPHRASED into its label — "after
       which" becomes THEN — so those words legitimately do not survive. Every
       other word must: the ladder rearranges the sentence's punctuation, never
       its content. */
    const LIFTED = ['so','therefore','thus','hence','but','however','yet','after','which','then','or','and'];
    const lost = t => {
      const before = words(t);
      const after = words(Pearl.steps(t).map(s => (s.lead || '') + ' ' + s.text).join(' '));
      return before.filter(w => after.indexOf(w) < 0 && LIFTED.indexOf(w) < 0);
    };
    return {
      joints: Pearl.steps(S1),
      paired: Pearl.steps(S2).length,
      list: Pearl.steps(S3),
      jointless: Pearl.steps(S4).length,
      lost: [S1, S2, S3, S4].map(lost),
      empty: Pearl.steps('').length,
    };
  });
  ok('a sentence with joints becomes a ladder', lad.joints.length === 3,
     lad.joints.map(s => s.text.slice(0, 22)).join(' | '));
  ok('the connective that opens a step is lifted into its label',
     lad.joints[1].lead === 'then' && lad.joints[2].lead === 'so',
     JSON.stringify(lad.joints.map(s => s.lead)));
  /* The lead is drawn in the step's line, before its text: "so It is…" on the owner's iPad. The lead takes the capital
     (as drawn), and the text after it keeps the case the sentence gave it. */
  const leadDrawn = await page.evaluate(() => { const li = document.createElement('em'); li.className = 'pearl-lead'; li.textContent = 'so';
    const c = document.getElementById('pearlCard') || document.body; c.appendChild(li); const tt = getComputedStyle(li).textTransform; li.remove(); return tt; });
  ok('a step after its lead reads on from it: the lead capitalised, the text not',
     /^the first six months/.test(lad.joints[2].text) && leadDrawn === 'capitalize', `${leadDrawn} · ${lad.joints[2].lead} ${lad.joints[2].text.slice(0, 30)}`);
  /* The single most likely way this goes wrong: an em-dash PAIR is a
     parenthesis, and cutting inside it leaves a fragment and an aside. */
  ok('a pair of em-dashes is a parenthesis, not a joint', lad.paired === 1, String(lad.paired));
  /* And the second: "…, or refractory angina" closes a list of three, so
     cutting there beheads it. */
  ok('the tail of a list is not cut off from the list',
     lad.list.some(s => /instability.*shock.*refractory/i.test(s.text)),
     lad.list.map(s => s.text.slice(0, 30)).join(' | '));
  ok('a sentence with no joint stays one step', lad.jointless === 1, String(lad.jointless));
  ok('no content word is dropped — only the connective the label replaced',
     lad.lost.every(l => l.length === 0), JSON.stringify(lad.lost));
  ok('an empty pearl yields no steps', lad.empty === 0);

  head('the ladder, on the page');
  const rung = await page.evaluate(() => {
    const all = pearlAll();
    pearlCurrent = all.find(p => Pearl.steps(p.text).length >= 3) || all[0];
    S.screen = 'home'; render();
    return new Promise(r => setTimeout(() => {
      const card = document.getElementById('pearlCard');
      const main = document.querySelector('.pearl-main');
      const ecg = document.getElementById('pearlCurrent');
      r({
        rungs: document.querySelectorAll('.pearl-step').length,
        numbered: [...document.querySelectorAll('.pearl-n')].map(n => n.textContent.trim()).join(''),
        marked: document.querySelectorAll('.pearl-num').length,
        /* Every rung arrives after the one above it, not all at once. */
        staggered: [...document.querySelectorAll('.pearl-step')]
          .map(el => parseFloat(getComputedStyle(el).animationDelay))
          .every((d, i, a) => i === 0 || d > a[i - 1]),
        /* The paper and the wash are painted behind, and are not in the flow.
           Both are pseudo-elements on a flex row: if either were ever given a
           position other than absolute it would become a flex item and crush
           the prose into a column one word wide. */
        paperAbs: getComputedStyle(card, '::before').position === 'absolute' &&
                  getComputedStyle(card, '::after').position === 'absolute',
        traceAbs: ecg ? getComputedStyle(ecg).position === 'absolute' : false,
        mainShare: main.getBoundingClientRect().width / card.getBoundingClientRect().width,
      });
    }, 800));
  });
  ok('the sentence is set as a numbered ladder', rung.rungs >= 3, String(rung.rungs));
  ok('the rungs are numbered in order', /^123/.test(rung.numbered), rung.numbered);
  ok('the rungs arrive one at a time', rung.staggered);
  ok('the ECG paper is painted behind, not laid out beside', rung.paperAbs);
  ok('and so is the current behind it', rung.traceAbs);
  ok('so the prose keeps the card', rung.mainShare > 0.5, (rung.mainShare * 100).toFixed(0) + '%');

  /* THE LOOP IS THE APP'S OWN PHYSIOLOGY, NOT AN ANIMATION THAT LOOKS CARDIAC.
     It is drawn from Physio.lvPressure/lvVolume — the same pair the cardiac
     cycle screen plots — so the figure in this corner cannot drift from the
     one on that screen. A vectorcardiogram was tried first and rejected: the
     dipole here is three time-separated Gaussians, so the vector goes out and
     back along one axis and draws a needle rather than a loop.

     AND THEN THE LOOP WENT TOO. A 104px square pinned in the corner of the
     prose column competed with the words and won. What the card wanted was a
     pulse along its foot, which is where this started — so the trace is back,
     full width, behind the text, with a travelling head. */
  const trace = await page.evaluate(async () => {
    const cv = document.getElementById('pearlCurrent');
    if (!cv) return null;
    /* Wait for the canvas to catch its card up before measuring. The card
       lays out first and the canvas resizes itself on its own animation frame,
       so a single sample taken while the machine is busy catches the gap — this
       assertion failed once in a full run under load and passed twice
       standalone, which is the signature of measuring before a thing settles
       rather than of the thing being wrong. Polling does not loosen the check:
       it still demands the canvas fill the content box to the pixel, and gives
       up after a bounded wait so a genuine mismatch still fails. */
    const cardWait = document.querySelector('.pearl-card');
    for (let i = 0; i < 40; i++) {
      /* and its foot the prose column's: the card measures that when it changes size (a figure arriving late grows the
         band under the prose), a frame after. */
      const pm = cardWait && cardWait.querySelector('.pearl-main');
      if (cardWait && Math.abs(cv.getBoundingClientRect().width - cardWait.clientWidth) < 1 &&
          pm && Math.abs(cv.getBoundingClientRect().bottom - pm.getBoundingClientRect().bottom) <= 1) break;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    const r = cv.getBoundingClientRect();
    const cardEl = document.querySelector('.pearl-card');
    const card = cardEl.getBoundingClientRect();
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    /* Where the ink actually lands, as a fraction of the canvas height: the
       trace is meant to run along the FOOT of the card, under the prose. */
    let lit = 0, lowest = 1, highest = 0;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        if (d[(y * cv.width + x) * 4 + 3] > 8) { lit++;
          const f = y / cv.height;
          if (f < lowest) lowest = f;
          if (f > highest) highest = f; }
      }
    }
    return {
      mounted: !!pearlTrace,
      lit, topOfInk: lowest, bottomOfInk: highest, cssH: r.height,
      proseFoot: Math.round(r.bottom - cardEl.querySelector('.pearl-main').getBoundingClientRect().bottom),
      band: !!(cardEl.querySelector('.pearl-fig') || cardEl.querySelector('.pearl-emblem')) && getComputedStyle(cardEl).flexDirection === 'column',
      /* Against the card's CONTENT box, not its border box. The card has a
         1px border either side, so a canvas that fills it perfectly measures
         exactly 2px narrower than the border box — and the old `< 2` fudge
         sat exactly on that boundary, passing or failing on which side of a
         reflow it happened to sample. clientWidth removes the fudge: the
         canvas fills the content box to the pixel, so this is now a tighter
         assertion, not a looser one. */
      fullWidth: Math.abs(r.width - cardEl.clientWidth) < 1,
      backing: r.width ? cv.width / r.width : 0,
      dpr: window.devicePixelRatio,
      behind: +getComputedStyle(cv).zIndex === 0 &&
              +getComputedStyle(document.querySelector('.pearl-steps')).zIndex === 1,
    };
  });
  /* Guarded, not dereferenced. On a build without the canvas this section
     should report four failures, not throw on the second line and take the
     rest of the suite with it. */
  const T = trace || { mounted: false, fullWidth: false, backing: 0, dpr: 1, behind: false,
                       topOfInk: 0, bottomOfInk: 0, lit: 0, cssH: 0, proseFoot: NaN, band: false };
  ok('the pearl carries a current, and it is running', T.mounted === true);
  ok('it spans the whole card, where the loop was a corner',
     T.fullWidth, `${T.backing.toFixed(1)}× backing`);
  ok('and backed at device-pixel density like every other canvas here',
     T.backing >= Math.min(T.dpr, 3) - 0.05, `${T.backing.toFixed(2)}× at dpr ${T.dpr}`);
  ok('it sits behind the words rather than over them', T.behind);
  /* The trace belongs along the foot of the card. If it ever drifts up into
     the body of the prose, the contrast check further down is the only thing
     standing between the fellow and an unreadable pearl — so it is held here
     as well, structurally, rather than relying on one number. */
  /* Stacked, the figure (or the emblem) is a band under the prose with a ground of its own, and a trace along the foot
     of the whole card ran under it, out of sight. It ends where the prose column ends. */
  ok('the trace ends where the prose does, never under the figure\'s band', Math.abs(T.proseFoot) <= 1,
     `${T.proseFoot}px from the prose column's foot${T.band ? ', a band under it' : ', side by side'}`);
  ok('the trace runs along the foot of the card, not through the prose',
     T.topOfInk > 0.55, `ink from ${(T.topOfInk * 100).toFixed(0)}% down`);
  /* In CSS pixels, the unit the trace is drawn in: its height is capped at 34px so it stays clear of the prose. This was
     a fraction of the canvas, which measured the column as much as the trace: stacked in portrait, the prose column is
     taller, and the same 34px waveform read as 4.9% of it. A flat line is a stroke, two or three pixels; a waveform
     spans its QRS. */
  const inkPx = (T.bottomOfInk - T.topOfInk) * T.cssH;
  ok('and it is a real waveform, not a flat line',
     inkPx >= 20 && T.lit > 500,
     `${T.lit} lit px, the ink spanning ${inkPx.toFixed(0)}px (${((T.bottomOfInk - T.topOfInk) * 100).toFixed(0)}% of ${Math.round(T.cssH)}px)`);

  const marks = await page.evaluate(() => {
    const all = pearlAll();
    const p = all.find(x => /\d+\s?(mg|%|days|hours|months)/i.test(x.text) && Pearl.steps(x.text).length > 1);
    if (!p) return null;
    pearlCurrent = p; S.screen = 'home'; render();
    return new Promise(r => setTimeout(() => r({
      text: p.text,
      marked: [...document.querySelectorAll('.pearl-num')].map(n => n.textContent),
    }), 700));
  });
  ok('the measurement the question turns on is marked',
     marks && marks.marked.length > 0 && marks.marked.every(m => /\d/.test(m)),
     marks ? marks.marked.join(' · ') : 'no numeric pearl found');

  /* A jointless sentence must fall back to prose rather than render as a
     numbered list of one, which reads as a formatting error. */
  const prose = await page.evaluate(() => {
    const all = pearlAll();
    // The harvested lessons may all contain several whole sentences. Give
    // this rendering check a jointless sentence, independent of the corpus.
    if (!all.length) return null;
    const p = { ...all[0], figKey: null, figCap: '',
      text: 'STEMI has persistent ST elevation of 20 minutes or more in at least two contiguous leads.' };
    pearlCurrent = p; S.screen = 'home'; render();
    return new Promise(r => setTimeout(() => r({
      steps: document.querySelectorAll('.pearl-step').length,
      body: !!document.querySelector('.pearl-body'),
      single: Pearl.lesson(p.text).length === 1,
    }), 700));
  });
  ok('a sentence with no joint is set as prose, not a list of one',
     !!prose && prose.single && prose.steps === 0 && prose.body, JSON.stringify(prose));

  head('asking for another');
  const next = await page.evaluate(() => {
    const before = (document.getElementById('pearlBody') || {}).textContent;
    const beforeFig = !!document.getElementById('pearlFig');
    let changed = false;
    /* Several presses: with weighting, one press can legitimately land on a
       neighbour of similar weight, but the text must move at least once. */
    for (let i = 0; i < 6 && !changed; i++) {
      pearlNext();
      if ((document.getElementById('pearlBody') || {}).textContent !== before) changed = true;
    }
    return { changed, beforeFig,
             heroIntact: !!document.getElementById('heroECG'),
             figMatchesNote: (() => {
               const p = pearlCurrent;
               const shown = !!document.getElementById('pearlFig');
               return !!p && shown === !!(p.figKey && refImgSrc(p.figKey));
             })() };
  });
  ok('the pearl changes', next.changed);
  ok('the figure follows the sentence it belongs to', next.figMatchesNote);
  ok('and the hero is not re-rendered underneath it', next.heroIntact);

  head('a named concept, recall, and the selected source note');
  const current = await page.evaluate(() => ({id:pearlCurrent.id,title:pearlCurrent.title,concept:pearlCurrent.concept,source:pearlCurrent.source}));
  ok('the heading names the selected concept', await page.locator('#pearlConcept').textContent() === current.concept);
  await page.locator('#pearlRecall').click();
  const hidden = await page.evaluate(() => ({body:document.getElementById('pearlBody').hidden,
    prompt:!document.getElementById('pearlPrompt').hidden,expanded:document.getElementById('pearlRecall').getAttribute('aria-expanded'),
    figure:!document.getElementById('pearlFig')||document.getElementById('pearlFig').hidden}));
  ok('recall hides text and image, and shows a recall prompt', hidden.body && hidden.figure && hidden.prompt && hidden.expanded === 'false');
  await page.locator('#pearlRecall').click();
  ok('reveal restores the pearl', await page.locator('#pearlBody').isVisible() && await page.locator('#pearlRecall').getAttribute('aria-expanded') === 'true');
  await page.locator('#pearlRecall').click();
  await page.locator('.pearl-next').click();
  const moved=await page.evaluate(()=>({id:pearlCurrent.id,concept:pearlCurrent.concept,shown:document.getElementById('pearlConcept').textContent,
    source:pearlCurrent.source,shownSource:document.getElementById('pearlSource').textContent,hidden:document.getElementById('pearlBody').hidden}));
  ok('another pearl updates its concept and source and exits recall', moved.id !== current.id && moved.concept === moved.shown && moved.source === moved.shownSource && !moved.hidden);
  // The new figure is inserted without a full render; keyboard zoom must work there too.
  // A randomly drawn pearl may legitimately have no relevant image. Choose
  // a different, resolvable figured pearl for this interaction, through the
  // real Next button, then restore the picker before exercising the figure.
  await page.evaluate(() => {
    const next = pearlAll().find(p => p.id !== pearlCurrent.id && p.figKey && refImgSrc(p.figKey));
    window.__pearlKeyboardPick = Pearl.pick;
    if (next) Pearl.pick = () => next;
  });
  try { await page.locator('.pearl-next').click(); }
  finally { await page.evaluate(() => { Pearl.pick = window.__pearlKeyboardPick; delete window.__pearlKeyboardPick; }); }
  const figureAvailable=await page.locator('#pearlFig').count();
  if(figureAvailable){
    await page.locator('#pearlFig').focus();
    await page.keyboard.press('Enter');
    ok('the replacement figure opens from the keyboard',
       await page.waitForFunction(() => !!document.querySelector('.pswp[role="dialog"]'), null, { timeout: 3000 }).then(() => true, () => false));
    await page.evaluate(()=>closePeek());
  }else ok('the replacement figure opens from the keyboard',false,'fixture supplied no resolvable replacement figure');
  const sourceTitle=await page.evaluate(()=>pearlCurrent.title);
  await page.locator('.pearl-open').click();
  await settled(page,()=>S.screen==='refs'&&!!document.querySelector('.hero-title'),{label:'reference screen'});
  const opened=await page.evaluate(()=>({count:document.querySelectorAll('.ref-card').length,title:document.querySelector('.ref-title')?.textContent}));
  ok('open note displays the selected source rather than the entire shelf',opened.count === 1 && opened.title === sourceTitle);
  await page.evaluate(()=>goHome());
  await settled(page,()=>S.screen==='home'&&!!document.querySelector('.hero-h1'),{label:'home screen'});

  head('each step says what it is, in a colour of its own');
  /* A ladder of steps in one grey read as a paragraph to wade through. Each step now wears the relationship
     Pearl.lesson names for it, in words and in a colour; the label's ink is its step's edge, and steps of different
     kinds are drawn apart. */
  await page.evaluate(() => {
    const all = pearlAll();
    pearlCurrent = all.find(p => p.figKey && refImgSrc(p.figKey) && new Set(Pearl.lesson(p.text).map(s => s.label)).size >= 2) ||
      all.find(p => new Set(Pearl.lesson(p.text).map(s => s.label)).size >= 2) || all[0];
    S.screen = 'home'; render();
  });
  await settled(page, () => !!document.querySelector('#pearlCard .pearl-step') && !window.__vtLive, { label: 'a pearl with steps on the home screen' });
  const kinds = await page.evaluate(() => {
    const want = Pearl.lesson(pearlCurrent.text);
    const steps = [...document.querySelectorAll('#pearlCard .pearl-step')];
    const role = li => li.querySelector('.pearl-role');
    const edge = li => getComputedStyle(li).borderLeftColor;
    const cap = document.querySelector('#pearlFig figcaption');
    return {
      want: want.map(s => s.label), shown: steps.map(li => role(li) ? role(li).textContent.trim() : ''),
      kinds: steps.map(li => li.dataset.kind || ''),
      inkIsEdge: steps.every(li => role(li) && getComputedStyle(role(li)).color === edge(li)),
      edges: steps.map(edge),
      labelsDiffer: new Set(want.map(s => s.label)).size,
      /* A browser does not report ::first-letter through getComputedStyle (it answered 'none' with the capital on screen),
         so the capital is measured: the heading's text is as wide as the word with its first letter raised, not as the
         word as stored. Only a concept that starts in lower case can tell the two apart. */
      first: (() => {
        const h = document.getElementById('pearlConcept'), text = h.textContent;
        if (!/^[a-z]/.test(text)) return 'UNMEASURED: the concept "' + text.slice(0, 1) + '…" does not start in lower case';
        const r = document.createRange(); r.selectNodeContents(h);
        /* The first letter is a box of its own, so the text is two rectangles on one line: measured from the first's left
           to the last's right, and only when they share a line. */
        const rects = [...r.getClientRects()];
        if (!rects.length || rects.some(x => Math.abs(x.bottom - rects[0].bottom) > 2)) return 'UNMEASURED: the heading is on more than one line';
        const cs = getComputedStyle(h), probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + cs.font + ';letter-spacing:' + cs.letterSpacing + ';font-feature-settings:' + cs.fontFeatureSettings;
        document.body.appendChild(probe);
        probe.textContent = text; const lower = probe.getBoundingClientRect().width;
        probe.textContent = text[0].toUpperCase() + text.slice(1); const upper = probe.getBoundingClientRect().width;
        probe.remove();
        const w = Math.max(...rects.map(x => x.right)) - Math.min(...rects.map(x => x.left));
        return Math.abs(upper - lower) > 0.5 && Math.abs(w - upper) < Math.abs(w - lower) ? 'uppercase'
          : `heading ${w.toFixed(1)}px, as stored ${lower.toFixed(1)}px, capitalised ${upper.toFixed(1)}px`;
      })(),
      capPx: cap ? parseFloat(getComputedStyle(cap).fontSize) : 0,
    };
  });
  ok('every step is labelled with the relationship Pearl.lesson names for it', kinds.shown.length >= 2 && kinds.shown.join('|') === kinds.want.join('|'),
     kinds.shown.join(' · ') + ' / wanted ' + kinds.want.join(' · '));
  ok('and carries its kind for the colour', kinds.kinds.every(k => /^(core|detail|contrast|caveat|why|condition)$/.test(k)), kinds.kinds.join(' · '));
  ok('each label is drawn in its own step\'s edge colour', kinds.inkIsEdge, kinds.edges.join(' · '));
  ok('steps of different kinds are drawn in different colours', new Set(kinds.edges).size === kinds.labelsDiffer && kinds.labelsDiffer >= 2,
     `${new Set(kinds.edges).size} colours for ${kinds.labelsDiffer} kinds`);
  ok('the concept is set with a capital', kinds.first === 'uppercase', kinds.first);
  ok('the figure\'s caption is at a reading size', kinds.capPx >= 13, kinds.capPx + 'px');

  /* Landscape on a tablet gives the card a fixed height, and the steps scroll inside it: a line cut at the edge read as
     the end of the pearl. While more is below, the card says so (its foot fades, and a Show all button is under it); at
     the end the fade clears, and the button stays, since the card still holds less than the pearl. Show all opens the
     whole pearl and Show less folds it back. */
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.evaluate(() => {
    pearlCurrent = pearlAll().slice().sort((a, b) => Pearl.lesson(b.text).length - Pearl.lesson(a.text).length || b.text.length - a.text.length)[0];
    S.screen = 'home'; render();
  });
  await settled(page, () => !!document.querySelector('#pearlCard .pearl-step') && !window.__vtLive, { label: 'the longest pearl in landscape' });
  await settled(page, () => !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity),
    { label: 'the steps to arrive' });
  const more = await page.evaluate(() => {
    const wrap = document.getElementById('pearlBody'), card = document.getElementById('pearlCard');
    const cue = () => { const b = card.querySelector('.pearl-morecue'); return !!b && getComputedStyle(b).display !== 'none' && b.tagName === 'BUTTON'; };
    return { over: wrap.scrollHeight - wrap.clientHeight, cue: cue(), cls: card.classList.contains('pearl-more') };
  });
  if (more.over > 4) {
    ok('while the steps run past the card, it says there is more', more.cls && more.cue, `${more.over}px below the fold`);
    await page.evaluate(() => { const w = document.getElementById('pearlBody'); w.scrollTop = w.scrollHeight; });
    await settled(page, () => !document.getElementById('pearlCard').classList.contains('pearl-more'), { timeout: 3000, label: 'the cue to clear at the end' })
      .catch(() => {});
    const end = await page.evaluate(() => ({ fade: document.getElementById('pearlCard').classList.contains('pearl-more'),
      btn: getComputedStyle(document.getElementById('pearlMore')).display }));
    ok('and at the end its foot no longer fades, while Show all stays', !end.fade && end.btn !== 'none', JSON.stringify(end));
    const tapAll = () => page.evaluate(() => { document.getElementById('pearlMore').click();
      const w = document.getElementById('pearlBody'), c = document.getElementById('pearlCard'), b = document.getElementById('pearlMore');
      return { all: c.classList.contains('pearl-all'), over: w.scrollHeight - w.clientHeight, label: b.textContent.trim(), expanded: b.getAttribute('aria-expanded'),
        steps: w.querySelectorAll('.pearl-step').length,
        lastInView: (() => { const r = w.querySelector('.pearl-step:last-child').getBoundingClientRect(), cr = c.getBoundingClientRect(); return r.bottom <= cr.bottom + 1; })() }; });
    const opened = await tapAll();
    ok('Show all opens the whole pearl: every step inside the card, nothing left to scroll', opened.all && opened.over <= 4 && opened.lastInView && opened.label === 'Show less' && opened.expanded === 'true', JSON.stringify(opened));
    const folded = await tapAll();
    ok('and Show less folds it back', !folded.all && folded.over > 4 && folded.label === 'Show all' && folded.expanded === 'false', JSON.stringify(folded));
  } else {
    for (const l of ['while the steps run past the card, it says there is more', 'and at the end its foot no longer fades, while Show all stays',
      'Show all opens the whole pearl: every step inside the card, nothing left to scroll', 'and Show less folds it back'])
      ok(l, false, `UNMEASURED: the longest pearl fits (${more.over}px over), so nothing ran past`);
  }

  /* THE OWNER'S iPAD, IN PORTRAIT: nothing runs past the card there, and yet the last step sat faded under a "More" that
     did nothing when tapped. The card had been measured once, while the steps were still rising in, when a moving
     transform made every pearl run past it, and never again. Read once the steps have landed. */
  await page.setViewportSize({ width: 834, height: 1091 });
  await page.evaluate(() => { S.screen = 'home'; render(); });
  await settled(page, () => !!document.querySelector('#pearlCard .pearl-step') && !window.__vtLive, { label: 'the longest pearl in portrait' });
  await settled(page, () => !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity),
    { label: 'the steps to land, in portrait' });
  const port = await page.evaluate(() => { const w = document.getElementById('pearlBody'), c = document.getElementById('pearlCard'), b = document.getElementById('pearlMore');
    return { over: w.scrollHeight - w.clientHeight, fade: c.classList.contains('pearl-more'), btn: getComputedStyle(b).display, stacked: getComputedStyle(c).flexDirection }; });
  ok('in portrait the pearl is stacked, the steps across the whole card', port.stacked === 'column', port.stacked);
  ok('and where every step fits, no step is faded and nothing offers more', port.over <= 4 && !port.fade && port.btn === 'none', JSON.stringify(port));
  /* A PHONE (22 October 2026): the longest pearl's steps ran off the card's right edge, cut mid-word. A phone's rule wraps
     the card's row, and a column that wraps sizes its line to the widest text rather than to the card. */
  await page.setViewportSize({ width: 390, height: 844 });
  /* What sets the width of that line is the widest thing in it that cannot wrap: the head, with its chapter chip. A
     pearl from a chapter with a short name fitted either way, so the pearl is given the bank's longest chapter name. */
  await page.evaluate(() => { pearlCurrent = Object.assign({}, pearlCurrent, { chapter: CHAPTERS.slice().sort((a, b) => b.length - a.length)[0] });
    S.screen = 'home'; render(); });
  await settled(page, () => !!document.querySelector('#pearlCard .pearl-step') && !window.__vtLive, { label: 'the longest pearl on a phone' });
  const phone = await page.evaluate(() => { const c = document.getElementById('pearlCard').getBoundingClientRect();
    return [...document.getElementById('pearlCard').children].filter(e => e.getBoundingClientRect().width)
      .map(e => ({ el: e.className.split(' ')[0], over: Math.round(e.getBoundingClientRect().right - c.right) })); });
  ok('on a phone every part of the pearl stays inside its card', phone.length > 1 && phone.every(p => p.over <= 1), JSON.stringify(phone));
  await page.setViewportSize({ width: 1100, height: 1100 });

  head('a pearl always has a picture beside it');
  /* A note's figure when it has one; when it has none, its chapter's emblem, as decoration (aria-hidden), never as #pearlFig,
     so the figure checks above still mean the note's own figure. */
  const pics = await page.evaluate(async () => {
    const base = pearlAll()[0], ch = CHAPTERS[0];
    const show = async (p) => { pearlCurrent = p; S.screen = 'home'; render();
      await new Promise(r => { const t0 = performance.now(); const f = () => (document.getElementById('pearlCard') && !window.__vtLive) || performance.now() - t0 > 4000 ? r() : requestAnimationFrame(f); f(); });
      const em = document.getElementById('pearlEmblem');
      return { fig: !!document.getElementById('pearlFig'), emblem: !!em, hidden: em && em.getAttribute('aria-hidden'), named: em ? em.textContent.trim() : '' }; };
    const bare = await show(Object.assign({}, base, { figKey: null, figCap: '', chapter: ch }));
    const withFig = pearlAll().find(p => p.figKey && refImgSrc(p.figKey));
    const fig = withFig ? await show(withFig) : null;
    /* and the emblem follows the pearl when another is asked for */
    const keep = Pearl.pick; Pearl.pick = () => Object.assign({}, base, { figKey: null, figCap: '', chapter: ch, id: base.id + '-again' });
    try { pearlNext(); } finally { Pearl.pick = keep; }
    const swapped = { fig: !!document.getElementById('pearlFig'), emblem: !!document.getElementById('pearlEmblem') };
    return { ch, bare, fig, swapped };
  });
  ok('a pearl whose note has no figure shows its chapter\'s emblem, as decoration', pics.bare.emblem && !pics.bare.fig && pics.bare.hidden === 'true' && pics.bare.named === pics.ch, JSON.stringify(pics.bare));
  ok('a pearl with a figure shows the figure and no emblem', !!pics.fig && pics.fig.fig && !pics.fig.emblem, JSON.stringify(pics.fig));
  ok('another pearl without a figure brings the emblem with it', pics.swapped.emblem && !pics.swapped.fig, JSON.stringify(pics.swapped));

  head('an empty library is not an error');
  const empty = await page.evaluate(() => {
    const keep = REF.slice();
    REF.length = 0; invalidateIndex();
    pearlCurrent = null;
    let threw = false;
    try { S.screen = 'home'; render(); } catch (_) { threw = true; }
    const gone = !document.getElementById('pearlCard');
    REF.push(...keep); invalidateIndex(); pearlCurrent = null;
    return { threw, gone };
  });
  ok('no notes means no card, rather than an empty one', empty.gone);
  ok('and nothing throws', !empty.threw);

  head('regression');
  head('a pearl is a whole thought now');
  {
    /* The old rules capped a pearl at 210 characters and required exactly one
       sentence. Measured over the 146 notes shipped at the time, that gave 96
       pearls with a median of 143 characters — true statements that stopped
       before they taught anything. The assertions below are thresholds, not
       counts, so they hold as the corpus grows. */
    const stats = await page.evaluate(() => {
      const all = Pearl.harvest(REF);
      const lens = all.map(p => p.text.length).sort((a, b) => a - b);
      return {
        n: all.length, min: lens[0], max: lens[lens.length - 1],
        median: lens[Math.floor(lens.length / 2)],
        MIN: Pearl.MIN || 0, MAX: Pearl.MAX || 1e9,
        allEnd: all.every(p => /[.!?]$/.test(p.text.trim())),
        noMarkup: all.every(p => !/[*_`]/.test(p.text)),
        multi: all.filter(p => Pearl.sentences(p.text).length > 1).length,
      };
    });
    ok('the corpus still yields plenty of pearls', stats.n > 100, `${stats.n} pearls`);
    ok('and the median is a statement, not a clause',
       stats.median >= 220, `${stats.median} characters`);
    ok('none is below the floor', stats.min >= stats.MIN, `shortest ${stats.min}, floor ${stats.MIN}`);
    ok('none runs past the ceiling', stats.max <= stats.MAX, `longest ${stats.max}, ceiling ${stats.MAX}`);
    ok('many are more than one sentence, which is the point',
       stats.multi > stats.n * 0.3, `${stats.multi} of ${stats.n}`);
    ok('every one still ends on a sentence ender', stats.allEnd);
    ok('and none leaks markdown into the card', stats.noMarkup);

    /* The specific shape that made "not meaningful" true: a bolded lead-in
       written as a paragraph, with no main verb anywhere in it. */
    const verbless = 'A falling antihypertensive requirement over time in a previously '
      + 'hypertensive patient, which reflects declining stroke volume rather than improving hypertension.';
    const labelled = 'R1 — epicardial conduit arteries. Normally there is no measurable '
      + 'pressure drop, so conduit resistance is negligible and the vessel behaves as a conduit.';
    const judged = await page.evaluate(([a, b]) => ({ verbless: Pearl.isPearl(a), labelled: Pearl.isPearl(b) }),
                                       [verbless, labelled]);
    ok('a verbless noun phrase is refused however long it is', judged.verbless === false);
    ok('but a label followed by its statement is kept', judged.labelled === true);
  }

  head('the current runs behind the words, not over them');
  {
    /* Back to the home screen first: earlier sections navigate away, and a
       card that is not rendered has no canvas to measure. */
    await page.evaluate(() => { goHome(); render(); });
    await page.waitForTimeout(900);
    const seen = await page.evaluate(() => {
      const cv = document.getElementById('pearlCurrent');
      if (!cv) return null;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
      return { ink, pv: !!document.getElementById('pearlPV'),
               z: getComputedStyle(cv).zIndex, pe: getComputedStyle(cv).pointerEvents };
    });
    const V = seen || { ink: 0, pv: true, z: '', pe: '' };
    ok('the pressure-volume loop is gone', V.pv === false);
    ok('and a trace is actually painted', V.ink > 500, `${V.ink} lit pixels`);
    ok('it sits behind the card\'s contents', V.z === '0', String(V.z));
    ok('and never takes a tap', V.pe === 'none', String(V.pe));

    /* THE PROMISE, AS A NUMBER. The brightest pixel the trace paints,
       composited over the card, against the pearl text — in every theme. WCAG
       AA for body text is 4.5:1, and "vibrant" is not a licence to go under
       it. color(srgb r g b / a) gives components 0-1 where rgb() gives 0-255;
       reading that wrong is what made an earlier version of this check report
       1.17:1 for black text on a white card. */
    const contrast = await page.evaluate(async () => {
      const RGBA = s => { s = String(s); const m = s.match(/-?[\d.]+/g); if (!m) return null;
        const sc = /^color\(/.test(s) ? 255 : 1;
        return [+m[0] * sc, +m[1] * sc, +m[2] * sc, m.length > 3 ? +m[3] : 1]; };
      const over = (f, g) => [0, 1, 2].map(i => f[i] * f[3] + g[i] * (1 - f[3]));
      const lum = c => { const [r, g, b] = c.map(v => { v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b);
        return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
      /* ACROSS THE ANIMATION AND ACROSS PEARLS, NOT ONE FRAME OF ONE DRAW.
         The trace is a travelling current and the pearl is chosen at random, so
         a single getImageData samples one instant of one text layout. Measured,
         that made this check's own verdict a coin flip: the same build reported
         4.48 (fail) in one full run, 4.57 three times standalone, and 5.16,
         5.15, 5.55, 5.42 under contention. A check whose answer moves by a
         quarter of its own threshold is not measuring the app.

         The claim is that the text clears 4.5:1 over the trace — at every
         moment, on every pearl, not on average and not if you are lucky. So it
         sweeps frames across the cycle and re-draws several pearls, and takes
         the worst of all of it. That is strictly STRONGER: a lucky frame can no
         longer hide a real shortfall. */
      const FRAMES = 14, PEARLS = 3;
      const frame = () => new Promise(r => requestAnimationFrame(() => r()));
      const out = [];
      for (const t of THEMES) {
        setTheme(t.id);
        await new Promise(r => setTimeout(r, 450));
        let worst = Infinity, best = -Infinity, lit = 0, samples = 0;
        let peakLo = Infinity, peakHi = -Infinity;
        for (let k = 0; k < PEARLS; k++) {
          if (k) {                       /* a different pearl, same theme */
            pearlCache = null; goHome(); render();
            await new Promise(r => setTimeout(r, 350));
          }
          const wrap = document.querySelector('.pearl-bodywrap');
          const card = document.querySelector('.pearl-card');
          const cv = document.getElementById('pearlCurrent');
          if (!wrap || !card || !cv) continue;
          const txt = RGBA(getComputedStyle(wrap).color).slice(0, 3);
          const page = RGBA(getComputedStyle(document.body).backgroundColor);
          const cardEff = over(RGBA(getComputedStyle(card).backgroundColor),
                               over(page, [255, 255, 255, 1]).concat(1));
          const op = parseFloat(getComputedStyle(cv).opacity) || 1;
          if (worst === Infinity) worst = ratio(txt, cardEff);
          for (let f = 0; f < FRAMES; f++) {
            await frame();
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            samples++;
            let peak = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > peak) peak = d[i];
            if (peak / 255 < peakLo) peakLo = peak / 255;
            if (peak / 255 > peakHi) peakHi = peak / 255;
            for (let i = 0; i < d.length; i += 4) {
              const a = (d[i + 3] / 255) * op;
              if (a < 0.02) continue;
              lit++;
              const r = ratio(txt, over([d[i], d[i + 1], d[i + 2], a], cardEff));
              if (r < worst) worst = r;
              if (r > best) best = r;
            }
          }
        }
        out.push({ theme: t.id, worst: +worst.toFixed(2),
                   spread: +(best - worst).toFixed(2), lit, samples,
                   peakLo: +peakLo.toFixed(3), peakHi: +peakHi.toFixed(3) });
      }
      setTheme('auto');
      return out;
    });
    const under = contrast.filter(c => c.worst < 4.5);
    /* A sweep that found no trace pixels would report Infinity and pass
       vacuously — the failure mode that makes a strengthened check weaker. */
    const blind = contrast.filter(c => !c.lit || !c.samples);
    ok('every theme was actually sampled, on lit pixels', blind.length === 0,
       blind.map(c => c.theme).join(', ') ||
         `${contrast.length} themes, ${contrast[0].samples} frames each`);
    ok('the text clears 4.5:1 over the trace in every theme', under.length === 0,
       under.length ? under.map(c => `${c.theme} ${c.worst}`).join(', ')
                    : `worst ${Math.min(...contrast.map(c => c.worst))}:1`);
    /* WHY THE SWEEP ABOVE CAN BE BELIEVED. It samples 42 frames of a
       continuous animation, so its worst is the worst of the whole cycle only
       if the brightest ink does not depend on the frame. It did: the tail was
       stroked a segment at a time, overlaps compounded where it folded back
       on the QRS, and the canvas's peak alpha ran .69 to .84 by where the
       head was — so the verdict depended on which frames a loaded machine
       happened to sample, and Parchment read 4.48:1 in a 177 s run and passed
       in quieter ones. A frame-independent peak is what makes 42 samples
       stand for all of them. Measured on a real build with the per-segment
       tail restored, every theme failed this: light themes .69-.84, dark
       .41-.57, a drift of .13 to .15. The single-stroke tail measured .011
       over a full cycle of a stand-in waveform. The .05 sits between. */
    const drift = contrast.filter(c => !(c.samples > 0 && c.peakHi - c.peakLo < 0.05));
    ok('the trace\'s brightest ink is the same in every frame, so the sample speaks for the cycle',
       drift.length === 0,
       (drift.length ? drift : contrast).map(c => `${c.theme} ${c.peakLo}–${c.peakHi}`).join(', '));
    ok('and the trace is visible in every theme, not just legal',
       contrast.every(c => c.lit > 500),
       `least ${Math.min(...contrast.map(c => c.lit))} lit pixels`);
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
