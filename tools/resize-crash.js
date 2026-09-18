#!/usr/bin/env node
/*
 * What kills the page on WebKit, isolated one thing at a time.
 *
 * Started as a bisect of viewport changes and grew a second half: six suites
 * crash without resizing at all, so the shrink was never the only way in. The
 * cases below cover both — a resize after some setup, and navigation with no
 * resize whatsoever.
 *
 *   $env:SYSTOLE_ENGINE="webkit"
 *   node tools\resize-crash.js http://localhost:8080
 *
 * WHAT IS ALREADY KNOWN, from tools/home-death.js against the served split
 * build on WebKit:
 *
 *   · the suite's whole prelude survives — a full reload, three measured
 *     viewport changes at 1366×1024, 1194×834 and 1024×1366, a jump into a
 *     question and back, and the first-run hint gates
 *   · and then the first resize of the sweep, to 390×844, crashes the page in
 *     TWENTY MILLISECONDS, with `crash event: true` and nothing logged
 *   · yet a probe that did ONLY that sweep survived six full cycles of it
 *
 * So it is not the sweep and it is not the prelude; it is something the
 * prelude leaves behind that the next resize then trips over. The obvious
 * candidate is the size itself — every prelude step puts the page at a LARGE
 * viewport, and the sweep's first move is to a small one — but "obvious" is
 * what the last three hypotheses were.
 *
 * SO THIS CHANGES ONE THING AT A TIME. Each case gets its own browser, its own
 * page and its own boot, does exactly one thing, then resizes to 390×844 and
 * asks whether the page is still there. A case that crashes and a case beside
 * it that does not is the difference that matters; anything both cases do is
 * ruled out rather than argued about.
 *
 * Reports a table. Asserts nothing — it is a tool, like tools/boot-probe.js.
 */
'use strict';
const path = require('path');
const { launch, engineName } = require('../tests/_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tools/resize-crash.js <url-or-path>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
const SMALL = { width: 390, height: 844 };

/* Playwright's wording for a target that no longer exists. Anything else is a
   bug in this file and is reported as one — see tools/home-death.js. */
const GONE = /Target (crashed|closed)|Target page, context or browser has been closed|Browser has been closed/i;

const resize = async (page, w, h) => { await page.setViewportSize({ width: w, height: h }); };
/* The one action that kills it, so the cases testing WHY all do the same thing
   rather than three slightly different things. */
const visitAQuestion = async (p, wantFigure) => {
  await p.evaluate(async want => {
    if (typeof ALL_Q === 'undefined' || typeof jumpTo !== 'function') return;
    const has = x => x.img > 0;
    const q = want === undefined ? ALL_Q.find(x => !x.bad)
            : ALL_Q.find(x => !x.bad && (want ? has(x) : !has(x)));
    if (q) { jumpTo(q.id); render(); }
  }, wantFigure);
  await p.waitForTimeout(300);
  await p.evaluate(() => { if (typeof goHome === 'function') { goHome(); render(); } });
  await p.waitForTimeout(250);
};
const rebuild = page => page.evaluate(async () => {
  if (typeof goHome === 'function') { goHome(); render(); }
  await new Promise(r => setTimeout(r, 250));
});

/* Keeps hold of whatever transition the app starts, so a case can wait for it
   or skip it. Wraps rather than replaces: the page still goes through
   document.startViewTransition exactly as failsafe-patch wrote it. */
const STASH_VT = () => {
  const orig = Document.prototype.startViewTransition;
  if (!orig) return;
  Document.prototype.startViewTransition = function (cb) {
    const vt = orig.call(this, cb);
    try { window.__vt = vt; } catch (_) {}
    return vt;
  };
};

/* heartreuse's loop, parameterised: n round trips between home and a chapter,
   with the two pauses it uses. `awaitVt` waits for each transition to settle
   instead of sleeping, which is the candidate fix. */
const navigate = (n, inMs, outMs, awaitVt) => async p => {
  let changes = 0;
  const screen = () => p.evaluate(() => {
    const a = document.getElementById('app');
    return (a && a.dataset && a.dataset.screen) || null;
  });
  for (let i = 0; i < n; i++) {
    const was = await screen();
    await p.evaluate(() => { if (typeof startQuiz === 'function') startQuiz(CHAPTERS[0]); });
    if (awaitVt) await p.evaluate(() => (window.__vtLive && window.__vtLive.finished
      ? window.__vtLive.finished.catch(() => {}) : null));
    await p.waitForTimeout(inMs);
    if (await screen() !== was) changes++;
    const mid = await screen();
    await p.evaluate(() => { if (typeof goHome === 'function') goHome(); });
    if (awaitVt) await p.evaluate(() => (window.__vtLive && window.__vtLive.finished
      ? window.__vtLive.finished.catch(() => {}) : null));
    await p.waitForTimeout(outMs);
    if (await screen() !== mid) changes++;
  }
  /* VACUITY GUARD, and it is not hypothetical. Both calls are behind
     `typeof … === 'function'`, so on a build where startQuiz is named
     something else — or where CHAPTERS is not defined and the evaluate throws
     before reaching it — this loop does nothing at all and the case reports
     SURVIVED. "Twenty navigations did not crash the page" and "no navigation
     happened" would arrive as the same word, which is the failure this whole
     repository is organised against, and I wrote it into the tool.

     A case that could not do its own setup is not evidence about the thing it
     was testing. Thrown rather than returned, so the runner reports it as a
     probe error instead of a result. */
  if (changes < n) {
    throw new Error(`probe: asked for ${n * 2} screen changes, observed ${changes}`);
  }
};

/* Each case: what it does BEFORE the resize that is under suspicion. An `init`
   runs before the page navigates, for the cases that need the app to boot in a
   different world rather than to be poked afterwards. */
const CASES = [
  ['nothing at all', async () => {}],
  ['one resize to 1366×1024', async p => { await resize(p, 1366, 1024); }],
  ['1366×1024 and a rebuild', async p => { await resize(p, 1366, 1024); await rebuild(p); }],
  ['1194×834 and a rebuild', async p => { await resize(p, 1194, 834); await rebuild(p); }],
  ['1024×1366 and a rebuild', async p => { await resize(p, 1024, 1366); await rebuild(p); }],
  ['a rebuild at the boot size', async p => { await rebuild(p); }],
  ['a full page reload', async p => {
    await p.reload({ waitUntil: 'load', timeout: 200000 });
    await p.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.home-wrap'),
      null, { timeout: 60000 }).catch(() => {});
  }],
  ['a jump into a question and back', async p => {
    await p.evaluate(() => {
      if (typeof ALL_Q === 'undefined' || typeof jumpTo !== 'function') return;
      const q = ALL_Q.find(x => !x.bad); if (q) { jumpTo(q.id); render(); }
    });
    await p.waitForTimeout(300);
    await p.evaluate(() => { if (typeof goHome === 'function') { goHome(); render(); } });
    await p.waitForTimeout(250);
  }],
  ['the whole prelude', async p => {
    await resize(p, 1366, 1024); await rebuild(p);
    await resize(p, 1194, 834); await rebuild(p);
    await resize(p, 1024, 1366); await rebuild(p);
  }],

  /* ── ROUND ONE'S HYPOTHESIS, AND ITS THREE REFUTATIONS ───────────────────
     Kept, not deleted. The story was: a question card registers a
     ResizeObserver, sweepInkHosts() only runs from mountInk(), so going home
     leaves an observer on a detached node and the next resize fires it. It
     explained every observation and it is WRONG — all three of these crash,
     including booting with ResizeObserver deleted, where no observer exists to
     fire. They stay in the list because a refuted case is evidence: anything
     that explains this crash must also explain why removing the observer
     entirely changes nothing.
     ──────────────────────────────────────────────────────────────────────── */
  /* The refuted mechanism, written down so nobody re-derives it:
     a jump into a question and back is the only thing that kills it, at both
     scale factors, and the source suggested this:

       scripts/stage0-patch.js registers an ink host per question card —
           host.__ro = new ResizeObserver(fit); host.__ro.observe(host);
       and sweepInkHosts(), which disconnects the observers of hosts that have
       left the document, is called from EXACTLY ONE PLACE: mountInk().

     mountInk() runs when a QUESTION mounts. Going home replaces the DOM and
     detaches the card, but mounts no question — so the sweep never runs and
     the observer is left watching a node nobody can see. The next resize is
     what fires it.

     That story predicts all three of these. If it is wrong, they will say so
     together rather than one at a time. */
  ['a question, back, then the app\'s own sweep', async p => {
    await visitAQuestion(p);
    await p.evaluate(() => { if (typeof sweepInkHosts === 'function') sweepInkHosts(); });
  }],
  ['a question, back, then disconnecting every ink observer', async p => {
    await visitAQuestion(p);
    await p.evaluate(() => {
      if (typeof INK_HOSTS === 'undefined') return;
      for (const h of INK_HOSTS) { if (h.__ro) { h.__ro.disconnect(); h.__ro = null; } }
    });
  }],
  /* THE DECISIVE ONE. The app already has a fallback for browsers without
     ResizeObserver — a plain window resize listener — so taking the API away
     before boot exercises the same feature through a different mechanism. If
     this survives where the control dies, it is the observer and nothing else. */
  ['a question and back, with ResizeObserver removed at boot',
   visitAQuestion,
   () => { delete window.ResizeObserver; }],

  /* ── ROUND TWO: what about the visit, then? ──────────────────────────────
     Round one established that the visit is necessary and that the observer is
     not the reason. These take the visit apart instead of theorising about
     what it leaves behind. Each isolates one thing the others share. */

  /* Is it the RETURN that matters, or merely having been there? */
  ['a question, and the resize while still on it', async p => {
    await p.evaluate(() => {
      if (typeof ALL_Q === 'undefined' || typeof jumpTo !== 'function') return;
      const q = ALL_Q.find(x => !x.bad); if (q) { jumpTo(q.id); render(); }
    });
    await p.waitForTimeout(400);
  }],
  /* If one more render clears it, whatever it is survives exactly one. */
  ['a question and back, then a second rebuild', async p => {
    await visitAQuestion(p);
    await rebuild(p);
  }],
  /* Figures are the heaviest thing a question carries. */
  ['a question with NO figure, and back', p => visitAQuestion(p, false)],
  ['a question WITH a figure, and back', p => visitAQuestion(p, true)],
  /* If time alone fixes it, something is being collected or settled. */
  ['a question and back, then two seconds of nothing', async p => {
    await visitAQuestion(p);
    await p.waitForTimeout(2000);
  }],
  /* The ink layer, ablated at the source rather than swept afterwards: if the
     card never mounts one, nothing it owns can be what is left behind. */
  ['a question and back, with the ink layer never mounted', async p => {
    await p.evaluate(() => { try { window.mountInk = function () {}; } catch (_) {} });
    await visitAQuestion(p);
  }],
  /* render() swaps the DOM inside an async startViewTransition callback, which
     CLAUDE.md records as the cause of four separate suite races. The app has a
     documented fallback for browsers without it, so taking it away exercises
     the same screen change through plain DOM replacement. */
  ['a question and back, with startViewTransition removed at boot',
   visitAQuestion,
   () => { try { delete Document.prototype.startViewTransition; } catch (_) {}
           try { delete document.startViewTransition; } catch (_) {} }],
  /* And is it the SMALL size, or any resize at all? */
  ['a question and back, then a resize UP instead', visitAQuestion, null, { width: 1366, height: 1024 }],

  /* ── ROUND THREE: the transition, and whether skipping it is the fix ─────
     Round two's three survivors all say the same thing. A view transition
     only starts when the SCREEN CHANGES — failsafe-patch.js:

         const changingScreen = lastScreen!==null && lastScreen!==S.screen;
         if(changingScreen && document.startViewTransition && !reduced){
           const vt=document.startViewTransition(()=>renderNow());

     — which is why a rebuild at the boot size and the whole prelude survive
     (home to home starts nothing) and why a question visit does not (home to
     quiz to home starts two). Waiting two seconds survives because the
     transition has finished. Removing the API survives because none starts.
     Resizing UP survives, so it is the shrink specifically. And the second
     rebuild survived at dpr 1 and died at dpr 2 — a bigger snapshot taking
     longer to settle is exactly the shape of a race.

     These three separate "the transition is live" from "some time has passed",
     and test the fix before anybody writes it. The wrapper stashes the
     transition the app creates, so the page is driven through its own code
     path rather than a substitute for it. */
  ['a question and back, then awaiting the transition', async p => {
    await visitAQuestion(p);
    await p.evaluate(() => (window.__vt && window.__vt.finished
      ? window.__vt.finished.catch(() => {}) : null));
  }, STASH_VT],
  ['a question and back, then skipTransition() on the live one', async p => {
    await visitAQuestion(p);
    await p.evaluate(() => {
      try { if (window.__vt && window.__vt.skipTransition) window.__vt.skipTransition(); } catch (_) {}
    });
  }, STASH_VT],
  /* Bounds the window: two seconds is plenty, is a third of a second? */
  ['a question and back, then 300ms of nothing', async p => {
    await visitAQuestion(p);
    await p.waitForTimeout(300);
  }],

  /* ── ROUND FOUR: the other six, which never resize ───────────────────────
     Six suites crash without resizing at all — gemini, memory, boundary, chat,
     flushguard and heartreuse — so the shrink cannot be the only way in.
     heartreuse says where to look. It dies after four checks, and check four
     is the line immediately before this:

         for (let i = 0; i < 20; i++) {
           await page.evaluate(() => { startQuiz(CHAPTERS[0]); });
           await settle(110);
           await page.evaluate(() => { goHome(); });
           await settle(210);
         }

     Twenty screen changes at 110 and 210 milliseconds. Every one starts a view
     transition, and they start faster than they settle — which the app already
     knows about: failsafe-patch swallows the AbortError that ready and
     finished reject with "whenever a newer transition starts before the
     current one settles". Harmless on Chromium. The question is whether it is
     harmless here.

     If overlapping is the trigger, spacing them out fixes it and awaiting each
     one fixes it completely. Both are cheap to try, and both are the same
     shape as the fix already applied to resizing. */
  ['twenty navigations at the heartreuse pace, no resize', navigate(20, 110, 210), null, 'none'],
  ['twenty navigations, awaiting each transition', navigate(20, 110, 210, true), STASH_VT, 'none'],
  ['twenty navigations, spaced 600ms apart', navigate(20, 600, 600), null, 'none'],
  ['five navigations at the same pace', navigate(5, 110, 210), null, 'none'],
];

(async () => {
  console.log(`engine ${engineName()}   target ${URL}`);
  console.log('each case is a fresh browser; the resize under test is → 390×844 unless the case says otherwise\n');
  const rows = [];
  for (const dpr of [2, 1]) {
    for (const [name, before, init, to] of CASES) {
      const browser = await launch();
      let crashed = false, verdict = '?', note = '';
      try {
        const page = await browser.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: dpr });
        page.on('crash', () => { crashed = true; });
        if (init) await page.addInitScript(init);
        await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
        const { booted } = require('../tests/_render.js');
        await booted(page, { timeout: 150000 });
        await before(page);
        /* The move under suspicion — SMALL unless a case asks otherwise, and
           skipped entirely for the cases that are about navigation instead. */
        if (to !== 'none') {
          const t = to || SMALL;
          await resize(page, t.width, t.height);
        }
        await page.evaluate(() => document.getElementsByTagName('*').length);
        verdict = 'survived';
      } catch (e) {
        const msg = String(e.message).split('\n')[0];
        verdict = GONE.test(msg) ? (crashed ? 'CRASHED' : 'page gone') : 'probe error';
        note = msg.slice(0, 70);
      }
      try { await browser.close(); } catch (_) {}
      rows.push({ dpr, name, verdict, note });
      console.log(`  dpr ${dpr}  ${verdict.padEnd(11)} after ${name}${note ? '  — ' + note : ''}`);
    }
    console.log('');
  }
  /* THE TAIL HAS TO BE ENOUGH ON ITS OWN. This printed only the cases that
     lost the page, which cannot distinguish a case that survived from one that
     never ran: a probe error crashes nothing, so it is absent from that list
     exactly like a success. Two runs were read as "navigation is innocent" on
     that basis and neither could support it.

     So every verdict is counted, and probe errors are named. A case that could
     not do its own setup is not evidence about the thing it was testing, and
     the summary now says which those were instead of leaving them silent. */
  const by = {};
  for (const r of rows) by[r.verdict] = (by[r.verdict] || 0) + 1;
  console.log(`${rows.length} cases: ` +
    Object.entries(by).sort().map(([k, v]) => `${v} ${k}`).join(', '));

  const broken = rows.filter(r => r.verdict === 'probe error');
  if (broken.length) {
    console.log('\nCASES THAT NEVER RAN — these prove nothing either way:');
    for (const r of broken) console.log(`   dpr ${r.dpr}  ${r.name}\n        ${r.note}`);
  }

  const died = rows.filter(r => r.verdict === 'CRASHED' || r.verdict === 'page gone');
  if (died.length && died.length < rows.length) {
    console.log('\nlost the page:');
    for (const r of died) console.log(`   dpr ${r.dpr}  ${r.name}`);
  }

  const lived = rows.filter(r => r.verdict === 'survived');
  if (lived.length && lived.length < rows.length) {
    console.log('\nsurvived — and actually ran:');
    for (const r of lived) console.log(`   dpr ${r.dpr}  ${r.name}`);
  }
  process.exit(0);
})();
