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
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-pearl.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });
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
             tooLong: all.filter(p => p.text.length > 210).length,
             unterminated: all.filter(p => !/[.!?]$/.test(p.text)).length,
             stillMarked: all.filter(p => /[*_`]/.test(p.text)).length,
             everyChapterNamed: all.every(p => p.chapter && p.chapter.length > 1) };
  });
  ok('the library yields a usable number of pearls', harvest.n > 40,
     `${harvest.n} from ${harvest.notes} notes`);
  ok('some carry a figure from their note', harvest.withFig > 5, harvest.withFig + ' with a figure');
  ok('none is longer than a sentence', harvest.tooLong === 0);
  ok('none is a clipped fragment', harvest.unterminated === 0);
  ok('markdown emphasis is stripped before display', harvest.stillMarked === 0);
  ok('each names the note it came from', harvest.everyChapterNamed);

  head('aimed at weak chapters, without becoming only weak chapters');
  const weighting = await page.evaluate(() => {
    S.chStats = { 'Heart Failure & Cardiomyopathies': { correct: 4, total: 30 },
                  'Arrhythmias': { correct: 28, total: 30 } };
    const words = Pearl.weakWords(3);
    const all = Pearl.harvest(REF);
    /* Deterministic sampling: a fixed sequence rather than Math.random, so a
       failure here is a real change in the weighting and not bad luck. */
    let i = 0; const seq = () => ((i = (i * 9301 + 49297) % 233280) / 233280);
    const picks = [];
    for (let n = 0; n < 60; n++) picks.push(Pearl.pick(all, null, seq));
    const hitWeak = picks.filter(p => /failure|cardiomyopath/i.test(p.title + ' ' + p.source)).length;
    const distinct = new Set(picks.map(p => p.id)).size;
    return { words, hitWeak, distinct };
  });
  ok('weak chapters are identified from the score history', weighting.words.length > 0,
     weighting.words.join(', '));
  ok('the weak chapter is over-represented', weighting.hitWeak >= 12,
     weighting.hitWeak + '/60 from the weak chapter');
  ok('but the pearl is not always the same one', weighting.distinct > 15,
     weighting.distinct + ' distinct in 60 draws');

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
      const ecg = document.getElementById('pearlECG');
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
  ok('and so is the trace along the foot', rung.traceAbs);
  ok('so the prose keeps the card', rung.mainShare > 0.5, (rung.mainShare * 100).toFixed(0) + '%');

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
    const p = all.find(x => Pearl.steps(x.text).length === 1);
    if (!p) return null;
    pearlCurrent = p; S.screen = 'home'; render();
    return new Promise(r => setTimeout(() => r({
      steps: document.querySelectorAll('.pearl-step').length,
      body: !!document.querySelector('.pearl-body'),
    }), 700));
  });
  ok('a sentence with no joint is set as prose, not a list of one',
     !prose || (prose.steps === 0 && prose.body), JSON.stringify(prose));

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
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
