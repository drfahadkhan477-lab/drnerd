#!/usr/bin/env node
/*
 * Behavioural checks for figures appearing in Apex's answers.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-chatfigs.js /path/to/patched.html
 *
 * The claim: when Apex answers from a note that carries a figure, the fellow
 * sees the figure. Every part of that already existed — the note cites it, the
 * library renders it, a vision model receives it — and the one place it never
 * appeared was the answer, which is the only place it was needed.
 *
 * Two failure modes this guards, both of which produce a silent nothing rather
 * than an error. The strip must be built by the app from the notes actually
 * retrieved, so it does not depend on the model emitting markup it would have
 * to reproduce byte-perfect. And it must not be gated on grounded mode, which
 * is what hid it before: sending an image and showing one are different
 * decisions with different costs, and only the first should be rationed.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-chatfigs.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const sse = text => [
  'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }),
  'data: [DONE]',
  '',
].join('\n\n');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  const sent = [];
  let reply = 'Pressure overload adds sarcomeres in parallel.';
  await page.route('**/v1/chat/completions', route => {
    try { sent.push(JSON.parse(route.request().postData() || '{}')); } catch (_) {}
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(reply) });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });
  await page.waitForTimeout(900);

  /* Ask a question, then pin lastHits to a note that definitely has a figure —
     rather than hoping retrieval picks one — and re-render. */
  const ask = async grounded => {
    sent.length = 0;
    return page.evaluate(async grounded => {
      AI.provider = 'mistral';
      AI.mistral = { key: 'test-mistral-key', model: 'pixtral-large-latest' };
      AI_GROUNDED = grounded;
      const note = REF.find(x => /refimg:\/\//.test(x.body || ''));
      const sh = document.getElementById('shell');
      if (!sh.classList.contains('ai-open')) toggleAI();
      buildAI();
      fire('explain this');
      await new Promise(r => setTimeout(r, 1600));
      lastHits = [{ kind: 'r', id: note.id, title: note.title }];
      buildAI();
      const img = document.querySelector('.fig-strip .ai-fig img');
      return {
        noteTitle: note.title,
        figs: document.querySelectorAll('.fig-strip .ai-fig').length,
        src: (img && img.getAttribute('src') || '').slice(0, 22),
        caption: (document.querySelector('.fig-strip figcaption') || {}).textContent || '',
        label: (document.querySelector('.fig-strip .src-lbl') || {}).textContent || '',
      };
    }, grounded);
  };

  head('open mode — where the figure used to be invisible');
  const open = await ask(false);
  ok('a figure from the cited note is shown', open.figs >= 1, open.figs + ' figure(s)');
  ok('it is a real decoded image, not a dead reference', /^data:image\//.test(open.src), open.src);
  ok('it is captioned', open.caption.length > 20, open.caption.slice(0, 60));
  ok('and attributed to the note it came from',
     open.caption.includes(open.noteTitle.slice(0, 18)), open.caption.slice(-40));
  ok('the strip says what it is', /figure/i.test(open.label), open.label);

  head('the vision attachment stays rationed, though the display is not');
  const openSys = (sent.find(Boolean) || {});
  const openHasImage = JSON.stringify(openSys).includes('"type":"image_url"');
  ok('open mode still does not spend tokens sending note figures', !openHasImage);

  head('grounded mode — shown and sent');
  const grounded = await ask(true);
  ok('the figure is still shown', grounded.figs >= 1, grounded.figs + ' figure(s)');
  const gReq = sent.find(Boolean) || {};
  ok('and now it is sent to the model too', JSON.stringify(gReq).includes('"type":"image_url"'));

  head('the model may place one inline, and then it is not shown twice');
  const inline = await page.evaluate(async () => {
    const note = REF.find(x => /refimg:\/\//.test(x.body || ''));
    const key = /refimg:\/\/([^)\s]+)/.exec(note.body)[1];
    const q = null;
    CHATS['_general'] = [
      { role: 'user', content: 'explain' },
      { role: 'assistant', content: 'Look here: ![the figure](refimg://' + key + ') — note the branch points.' },
    ];
    saveJSON(AI_CHAT, CHATS);
    S.screen = 'home';
    lastHits = [{ kind: 'r', id: note.id, title: note.title }];
    buildAI();
    return {
      inBody: document.querySelectorAll('.msg.bot figure.ref-fig img').length,
      inStrip: document.querySelectorAll('.fig-strip .ai-fig').length,
    };
  });
  ok('a citation the model copied renders inside the reply', inline.inBody === 1, inline.inBody + ' inline');
  ok('and the strip does not repeat it underneath', inline.inStrip === 0, inline.inStrip + ' in strip');

  /* AND IT MUST FIT. Every .ref-fig rule was scoped to .ref-body — the Notes
     panel — so a figure the model placed in a reply had no styles at all and
     took its natural size: 824px inside a 430px panel. The conversation then
     scrolled sideways, which on a touch device reads as the app being stuck:
     you cannot swipe back to the thread, and the composer is off the edge.
     Checked at phone width, where the panel is narrowest. */
  await page.setViewportSize({ width: 430, height: 932 });
  await page.waitForTimeout(400);
  const fits = await page.evaluate(() => {
    buildAI();
    return new Promise(r => setTimeout(() => {
      const body = document.querySelector('.ai-body');
      const img = document.querySelector('.msg.bot figure.ref-fig img');
      r({ bodyW: body.clientWidth, bodyScrollW: body.scrollWidth,
          imgW: img ? Math.round(img.getBoundingClientRect().width) : 0,
          natural: img ? img.naturalWidth : 0,
          maxW: img ? getComputedStyle(img).maxWidth : '' });
    }, 700));
  });
  ok('the figure is scaled down to the panel, not shown at its own size',
     fits.imgW > 0 && fits.imgW <= fits.bodyW && fits.natural > fits.bodyW,
     `${fits.imgW}px in ${fits.bodyW}px, natural ${fits.natural}px`);
  ok('so the conversation never scrolls sideways',
     fits.bodyScrollW <= fits.bodyW + 1, `scrollWidth ${fits.bodyScrollW} vs ${fits.bodyW}`);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.waitForTimeout(300);

  head('the evidence belongs to one conversation');
  /* lastHits is a single global. Before it was tagged with its thread, asking
     about one question and then opening another that already had a chat showed
     the first question's notes — and, once figures were added, printed the
     first question's diagram as the evidence for the second. */
  const leak = await page.evaluate(async () => {
    const note = REF.find(x => /refimg:\/\//.test(x.body || ''));
    const [a, b] = ALL_Q.filter(x => !x.bad).slice(0, 2);
    /* A conversation exists on B, but the retrieval that produced lastHits
       happened on A. */
    CHATS[b.id] = [{ role: 'user', content: 'unrelated' },
                   { role: 'assistant', content: 'An answer with no figure in it.' }];
    saveJSON(AI_CHAT, CHATS);
    lastHits = [{ kind: 'r', id: note.id, title: note.title }];
    lastHitsKey = a.id;
    jumpTo(b.id); buildAI();
    const strayFigs = document.querySelectorAll('.fig-strip .ai-fig').length;
    const strayPills = document.querySelectorAll('.src-strip .src-pill').length;
    /* And when the hits do belong to this thread, they draw as normal. */
    lastHitsKey = b.id; buildAI();
    return { strayFigs, strayPills,
             ownFigs: document.querySelectorAll('.fig-strip .ai-fig').length };
  });
  ok('another thread\'s figure is not printed as this one\'s evidence',
     leak.strayFigs === 0, leak.strayFigs + ' stray figure(s)');
  ok('nor are its "drawing on" pills', leak.strayPills === 0, leak.strayPills + ' stray pill(s)');
  ok('while the thread\'s own figure still shows', leak.ownFigs === 1, leak.ownFigs + ' figure(s)');

  head('a figure opens, and closes four ways');
  /* The complaint that started this was an image with no way out. A figure in
     a reply is a 982px diagram whose legend is six-point type; scaled into the
     panel it is legible as a shape and not as a document. */
  /* At desktop width the figure already fits at its natural size, so "bigger
     in the viewer" and "magnifies" have nothing to say. The claims are about a
     panel narrower than the picture, which is the phone and the iPad. */
  await page.setViewportSize({ width: 430, height: 932 });
  await page.waitForTimeout(300);
  const view = await page.evaluate(async () => {
    /* Its own fixture: the thread state a few checks ago is not this check's
       business, and depending on it is how a suite starts failing for reasons
       that have nothing to do with what it tests. */
    const note = REF.find(x => /refimg:\/\//.test(x.body || ''));
    const key = /refimg:\/\/([^)\s]+)/.exec(note.body)[1];
    CHATS['_general'] = [
      { role: 'user', content: 'explain' },
      { role: 'assistant', content: 'Look: ![Troponin triage algorithm](refimg://' + key + ')' },
    ];
    S.screen = 'home';
    buildAI();
    await new Promise(r => setTimeout(r, 500));
    const fig = document.querySelector('.msg.bot figure.ref-fig');
    if (!fig) return { none: true };
    fig.click();
    await new Promise(r => setTimeout(r, 300));
    const w = document.getElementById('peek');
    const img = w.querySelector('.figv-scroll img');
    const out = {
      opened: /fig-open/.test(w.className),
      locked: document.body.classList.contains('peek-locked'),
      hasClose: !!w.querySelector('.figv-x'),
      fitW: img ? Math.round(img.getBoundingClientRect().width) : 0,
      natural: img ? img.naturalWidth : 0,
    };
    /* Tapping the picture magnifies rather than dismisses — you cannot read a
       legend you dismissed. */
    img.click();
    await new Promise(r => setTimeout(r, 350));
    out.stillOpen = /fig-open/.test(document.getElementById('peek').className);
    out.zoomW = Math.round(img.getBoundingClientRect().width);
    out.pannable = img.closest('.figv-scroll').scrollWidth > img.closest('.figv-scroll').clientWidth;
    /* Escape. */
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise(r => setTimeout(r, 200));
    out.afterEsc = document.getElementById('peek').className;
    out.unlocked = !document.body.classList.contains('peek-locked');
    /* Backdrop. The obvious ev.target===wrap test is wrong here: .figv is
       stretched over the whole overlay, so the backdrop is never the target
       and tap-to-dismiss silently does nothing. */
    fig.click();
    await new Promise(r => setTimeout(r, 250));
    document.querySelector('.figv').click();
    await new Promise(r => setTimeout(r, 200));
    out.afterBackdrop = document.getElementById('peek').className;
    return out;
  });
  ok('tapping a figure opens it full size', !view.none && view.opened && view.hasClose);
  ok('and it is bigger there than it was in the panel',
     view.fitW > 0 && view.natural > view.fitW, `${view.fitW}px shown, ${view.natural}px source`);
  ok('tapping the picture magnifies instead of dismissing',
     view.stillOpen && view.zoomW === view.natural && view.pannable,
     `${view.zoomW}px, pannable ${view.pannable}`);
  ok('Escape closes it and gives the page back',
     view.afterEsc === '' && view.unlocked, JSON.stringify(view.afterEsc));
  ok('and so does a tap outside the picture', view.afterBackdrop === '', JSON.stringify(view.afterBackdrop));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.waitForTimeout(250);

  head('the figures can be put away — they arrive shut and fold back');
  {
    /* Reported from an iPad: the figures appeared with the reply, took a third
       of the panel, and had no control of any kind. On a landscape split the
       answer you asked for sat four lines above pictures you did not. */
    await page.evaluate(() => { S.screen = 'home'; });
    const shut = await ask(false);
    const start = await page.evaluate(() => {
      const wrap = document.querySelector('.fig-strip');
      const btn = document.getElementById('aiFigs');
      const list = document.getElementById('aiFigList');
      if (!wrap || !btn || !list) return null;
      return {
        open: wrap.classList.contains('open'),
        display: getComputedStyle(list).display,
        tag: btn.tagName, expanded: btn.getAttribute('aria-expanded'),
        controls: btn.getAttribute('aria-controls'),
        label: btn.textContent.trim(),
        listH: Math.round(list.getBoundingClientRect().height),
      };
    });
    ok('the strip has a control at all', start !== null);
    ok('and it is a button, not a label somebody has to guess is tappable',
       !!start && start.tag === 'BUTTON', start ? start.tag : '—');
    ok('it arrives shut', !!start && start.open === false);
    ok('so the figures take no height until asked for',
       !!start && start.display === 'none' && start.listH === 0,
       start ? `${start.display}, ${start.listH}px` : '—');
    ok('the collapsed row still says how many are behind it',
       !!start && /^\d+ figures? from those notes$/.test(start.label), start ? start.label : '—');
    ok('and it is wired to the list it controls, for a screen reader',
       !!start && start.expanded === 'false' && start.controls === 'aiFigList',
       start ? `${start.expanded} / ${start.controls}` : '—');
    ok('the figures are really there, just folded', shut.figs >= 1, `${shut.figs} figure(s)`);

    /* Guarded, not dereferenced. On a build without this step every one of
       these throws out of page.evaluate and takes the rest of the FILE with
       it — the six honest failures above became a crash the first time this
       was pointed at the pre-step build. */
    const noCtl = { open: null, display: null, listH: -1, expanded: null };
    const opened = await page.evaluate(() => {
      const b = document.getElementById('aiFigs');
      if (!b) return { open: null, display: null, listH: -1, expanded: null };
      b.click();
      const list = document.getElementById('aiFigList');
      return {
        open: document.querySelector('.fig-strip').classList.contains('open'),
        display: getComputedStyle(list).display,
        listH: Math.round(list.getBoundingClientRect().height),
        expanded: document.getElementById('aiFigs').getAttribute('aria-expanded'),
      };
    });
    ok('one tap opens them', opened.open === true && opened.display !== 'none', String(opened.display));
    ok('and they occupy real height once open', opened.listH > 40, `${opened.listH}px`);
    ok('with aria-expanded following', opened.expanded === 'true');

    /* The whole reason this is a class toggle rather than a buildAI(): the
       panel re-renders from scratch, and a rebuild here would throw away a
       half-written question. The chips control already avoids it this way. */
    const draft = await page.evaluate(() => {
      const ta = document.getElementById('aiIn');
      if (!ta) return null;
      ta.value = 'half-typed question';
      const b = document.getElementById('aiFigs');
      if (b) { b.click(); b.click(); }
      return document.getElementById('aiIn').value;
    });
    ok('toggling does not discard what you were typing', draft === 'half-typed question', String(draft));

    const closed = await page.evaluate(() => {
      const btn = document.getElementById('aiFigs');
      const wrap = document.querySelector('.fig-strip');
      const list = document.getElementById('aiFigList');
      if (!btn || !wrap || !list) return { open: null, display: null };
      if (wrap.classList.contains('open')) btn.click();
      return { open: wrap.classList.contains('open'), display: getComputedStyle(list).display };
    });
    ok('and tapping again folds them away', closed.open === false && closed.display === 'none');

    /* buildAI() runs several times per exchange. A flag held in the DOM would
       be reset by every one of them, so opening the figures would not survive
       the next token of the next answer. */
    const survives = await page.evaluate(() => {
      const b = document.getElementById('aiFigs');
      if (!b) return { open: null, expanded: null };
      b.click();
      buildAI();
      const after = document.getElementById('aiFigs');
      return {
        open: !!document.querySelector('.fig-strip.open'),
        expanded: after ? after.getAttribute('aria-expanded') : null,
      };
    });
    ok('once opened, a panel re-render leaves them open', survives.open === true);
    ok('and the control re-renders in the state it was left in', survives.expanded === 'true');
  }

  head('the strip is evidence, not furniture');
  const empty = await page.evaluate(() => {
    delete CHATS['_general']; saveJSON(AI_CHAT, CHATS);
    lastHits = [];
    S.screen = 'home';
    buildAI();
    return document.querySelectorAll('.fig-strip').length;
  });
  ok('an empty thread shows no figure strip', empty === 0, String(empty));

  head('the system prompt tells the model how to place one safely');
  const prompt = await page.evaluate(() => SYSTEM);
  ok('it explains the citation form', /refimg:\/\/KEY/.test(prompt));
  ok('it insists the key be copied verbatim', /EXACTLY|character for character/.test(prompt));
  ok('it forbids inventing one, which would render as nothing',
     /Never invent, guess or abbreviate/i.test(prompt));

  head('regression');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
