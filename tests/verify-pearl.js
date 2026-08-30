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
  const trace = await page.evaluate(() => {
    const cv = document.getElementById('pearlCurrent');
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    const card = document.querySelector('.pearl-card').getBoundingClientRect();
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
      lit, topOfInk: lowest, bottomOfInk: highest,
      fullWidth: Math.abs(r.width - card.width) < 2,
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
                       topOfInk: 0, bottomOfInk: 0, lit: 0 };
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
  ok('the trace runs along the foot of the card, not through the prose',
     T.topOfInk > 0.55, `ink from ${(T.topOfInk * 100).toFixed(0)}% down`);
  ok('and it is a real waveform, not a flat line',
     T.bottomOfInk - T.topOfInk > 0.05 && T.lit > 500,
     `${T.lit} lit px across ${((T.bottomOfInk - T.topOfInk) * 100).toFixed(0)}% of height`);

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
  head('a pearl is a whole thought now');
  {
    /* The old rules capped a pearl at 210 characters and required exactly one
       sentence. Measured over the 146 shipped notes that gave 96 pearls with a
       median of 143 characters — true statements that stopped before they
       taught anything. */
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
      const out = [];
      for (const t of THEMES) {
        setTheme(t.id);
        await new Promise(r => setTimeout(r, 450));
        const wrap = document.querySelector('.pearl-bodywrap');
        const card = document.querySelector('.pearl-card');
        const cv = document.getElementById('pearlCurrent');
        if (!wrap || !card || !cv) continue;
        const txt = RGBA(getComputedStyle(wrap).color).slice(0, 3);
        const page = RGBA(getComputedStyle(document.body).backgroundColor);
        const cardEff = over(RGBA(getComputedStyle(card).backgroundColor),
                             over(page, [255, 255, 255, 1]).concat(1));
        const op = parseFloat(getComputedStyle(cv).opacity) || 1;
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let worst = ratio(txt, cardEff), lit = 0;
        for (let i = 0; i < d.length; i += 4) {
          const a = (d[i + 3] / 255) * op;
          if (a < 0.02) continue;
          lit++;
          const r = ratio(txt, over([d[i], d[i + 1], d[i + 2], a], cardEff));
          if (r < worst) worst = r;
        }
        out.push({ theme: t.id, worst: +worst.toFixed(2), lit });
      }
      setTheme('auto');
      return out;
    });
    const under = contrast.filter(c => c.worst < 4.5);
    ok('the text clears 4.5:1 over the trace in every theme', under.length === 0,
       under.length ? under.map(c => `${c.theme} ${c.worst}`).join(', ')
                    : `worst ${Math.min(...contrast.map(c => c.worst))}:1`);
    ok('and the trace is visible in every theme, not just legal',
       contrast.every(c => c.lit > 500),
       `least ${Math.min(...contrast.map(c => c.lit))} lit pixels`);
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
