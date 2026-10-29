#!/usr/bin/env node
/*
 * Flags and annotations in the app: a question marked to come back to, the deck of what was marked, and the
 * list of the questions that have a sticky note or a pencil mark on them.
 *
 *   node tests/verify-flags.js build/synthetic/systole.html
 *
 * src/core/flagset.js is held by verify-flagset-pure; this holds that the app is wired to it:
 *   · the quiz has a Flag button and the F key, each turning the flag on and off for the question on screen,
 *     drawn in place (the note being typed in is not closed), told to a screen reader, kept in storage,
 *     left alone by a modifier key, a held key and a letter typed in a sticky note, and not an answer:
 *     the progress record is the same before and after;
 *   · a flag belongs to a question, not to a place in a deck, and neither answering it right nor wrong
 *     takes it off;
 *   · flags survive a reload and a Reset, are read back from damaged storage as the ids in it and no more,
 *     leave and enter a backup, and a backup whose list is not ids is refused by name;
 *   · the Flagged deck holds the flagged questions the bank has and nothing else, keeps no place to resume,
 *     asks again from the results screen, and an empty one says so without a dialog;
 *   · the Study screen's Flagged card counts what the bank still has, starts the deck, and clears every flag
 *     in two taps and not a dialog, leaving the notes alone;
 *   · the Annotations list shows every question with a sticky note or a mark, newest note first, and none
 *     the bank lacks; typing narrows it in place with the keyboard still in the box; a note is text, never
 *     markup; a row opens its question with its note; Practise deals what the list shows;
 *   · a mock block's flags are the block's own until it is handed in, then are added to the Flagged list,
 *     never taken from it, and a block thrown away adds none;
 *   · a search hit says it is flagged;
 *   · the quiz's row of buttons fits from a phone to an iPad, the Flag word goes on a phone and stays for
 *     a screen reader, and nothing throws.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet, resized } = require('./_render.js');
const { blankComments } = require('./_source.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-flags.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* Drives the real importer with a real File, as verify-backup.js does: importMarkup() makes its own <input> and never
   hands it back, so it is reached by watching document.createElement for the moment it runs. Resolves when the
   asynchronous reader has finished, not when a toast or a timer says so. */
const RESTORE = `(text) => new Promise((resolve, reject) => {
  const file = new File([text], 'backup.json', { type: 'application/json' });
  const orig = document.createElement;
  let input = null;
  document.createElement = function (tag) {
    const el = orig.call(document, tag);
    if (tag === 'input') { input = el; el.click = () => {}; }
    return el;
  };
  importMarkup();
  document.createElement = orig;
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  const read = FileReader.prototype.readAsText;
  FileReader.prototype.readAsText = function () {
    const loaded = this.onload;
    this.onload = function () {
      const reader = this, args = arguments;
      Promise.resolve().then(() => loaded.apply(reader, args)).then(resolve, reject);
    };
    return read.apply(this, arguments);
  };
  try { input.onchange(); } finally { FileReader.prototype.readAsText = read; }
})`;

(async () => {
  const browser = await launch();
  const errors = [], events = [], dialogs = [];
  let answerDialogs = false;
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 834, height: 1194 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  /* Nothing here may open a native dialog; Reset's own confirm is the one the test answers, when it says to. */
  page.on('dialog', d => { dialogs.push(d.message()); return answerDialogs ? d.accept() : d.dismiss(); });
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  /* A fellow with nothing done, nothing marked and no block anywhere. */
  const fresh = () => page.evaluate(() => {
    S.srs = {}; S.chStats = {}; S.missed = new Set(); S.daily = {}; S.practice = {}; S.sessionCorrect = 0; S.sessionTotal = 0; S.resume = {};
    S.flagged = new Set(); NOTES = {}; INK = {}; saveJSON(NOTE_KEY, NOTES); saveJSON(INK_KEY, INK);
    S.mocks = []; S.mock = null; S.mockLast = null; LOG.length = 0; _mockArm = false; _flagArm = false;
    localStorage.removeItem('accsap12.mock'); localStorage.removeItem('accsap12.mocklast'); save();
  });
  const snap = () => page.evaluate(() => ({
    chStats: JSON.parse(JSON.stringify(S.chStats)), sessionTotal: S.sessionTotal, sessionCorrect: S.sessionCorrect,
    missed: [...S.missed].sort(), practice: JSON.parse(JSON.stringify(S.practice)), srs: JSON.stringify(S.srs),
    day: JSON.parse(JSON.stringify(S.daily[FSRS.todayISO()] || { a: 0, c: 0, r: 0 })), log: LOG.length, resume: JSON.stringify(S.resume),
  }));
  const reached = (screen, ms) => page.waitForFunction(s => S.screen === s, screen, { timeout: ms || 6000 }).then(() => true, () => false);
  const drawn = sel => page.waitForSelector(sel, { timeout: 4000 }).then(() => true, () => false);
  /* The question being asked is the one on screen: S.screen is set at once and the markup follows, and a move inside the
     quiz leaves the last question's markup up until the new one replaces it. */
  const showing = id => page.waitForFunction(id => {
    const q = QBYID[id], t = document.querySelector('.q-tag');
    return S.screen === 'quiz' && !!t && t.textContent.indexOf('Question ' + q.n + ' · ' + q.ch) >= 0 && !!document.getElementById('qFlag');
  }, id, { timeout: 6000 }).then(() => true, () => false);
  const settle = () => quiet(page);
  /* A theme colour as the browser computes it (a token is a hex or a var, a style reads back rgb). */
  const tokenColor = name => page.evaluate(n => { const s = document.createElement('span'); s.style.color = 'var(--' + n + ')'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; }, name);
  /* A colour is read when it has stopped changing: the buttons ease between states, and a value read mid-way is neither. */
  const stilled = () => page.waitForFunction(() => document.getAnimations().every(a => !(a.effect && Number.isFinite(a.effect.getTiming().iterations)) || a.playState !== 'running'), null, { timeout: 8000 }).catch(() => {});
  const deal = async ids => {
    await page.evaluate(ids => startAdhocQuiz(ids.map(id => QBYID[id]), null), ids);
    const up = await showing(ids[0]); await settle(); return up;
  };
  const flagRead = () => page.evaluate(() => {
    const q = S.questions[S.qIdx], b = document.getElementById('qFlag'), g = document.getElementById('qFlagBadge');
    const saved = (JSON.parse(localStorage.getItem('accsap12.v2') || '{}').flagged || []);
    return {
      id: q.id, pressed: b.getAttribute('aria-pressed'), on: b.classList.contains('on'), badge: g.offsetWidth > 0 && g.offsetHeight > 0, badgeText: g.textContent.trim(),
      inSet: S.flagged.has(q.id), saved: saved.includes(q.id), size: S.flagged.size, live: document.getElementById('srLive').textContent,
    };
  });
  const tapFlag = () => page.click('#qFlag');
  const first = await page.evaluate(() => CHAPTERS.slice(0, 4).map(ch => POOL.find(q => q.ch === ch).id));
  const [A, B, C, D] = first;
  const all = await page.evaluate(() => POOL.map(q => q.id));

  head('the new styles keep the Safari floor');
  {
    /* overflow-wrap:anywhere is not understood before Safari 15.4: a rule that uses it needs the older words for the same job. */
    const found = [], bad = [];
    for (const f of ['study.css', 'home-quiz.css', 'figures.css']) {
      const css = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'css', f), 'utf8'));
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim().replace(/\s+/g, ' ');
        if (!/\.anno|\.flag|\.rate-flag|\.btn-flag/.test(sel) || !/overflow-wrap\s*:\s*anywhere/.test(m[2])) continue;
        found.push(sel.slice(0, 40));
        const before = m[2].slice(0, m[2].search(/overflow-wrap\s*:\s*anywhere/));
        if (!/overflow-wrap\s*:\s*break-word/.test(before) || !/word-break\s*:\s*break-word/.test(m[2])) bad.push(sel.slice(0, 40));
      }
    }
    ok('the scan found the rules that use overflow-wrap:anywhere, which it is there to check', found.length >= 2, found.join(' | '));
    ok('each has overflow-wrap:break-word before it and word-break:break-word with it, for Safari before 15.4', bad.length === 0, bad.join(' | '));
  }

  head('the flag on the question on screen');
  await fresh();
  ok('a deck of three questions opens', await deal([A, B, C]));
  {
    const r = await page.evaluate(() => {
      const b = document.getElementById('qFlag'), r = b.getBoundingClientRect();
      return { word: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), title: b.title, type: b.type };
    });
    const before = await flagRead();
    ok('a Flag button is on the question, named Flag, a real button', r.word === 'Flag' && r.type === 'button', JSON.stringify(r));
    ok('and at least 44 px each way, so a thumb finds it', r.w >= 44 && r.h >= 44, r.w + 'x' + r.h);
    ok('it says the key: F', /\(F\)/.test(r.title), r.title);
    const hint = await page.evaluate(() => document.querySelector('.kb-hint').textContent);
    ok('and the hint under the options says F flags', /F to flag/.test(hint), hint);
    ok('nothing is flagged to begin with: not pressed, no badge, not in the set, not kept', before.pressed === 'false' && !before.on && !before.badge && !before.inSet && !before.saved && before.size === 0, JSON.stringify(before));
  }
  {
    const rec = await snap();
    await page.keyboard.press('f');
    const on = await flagRead();
    ok('pressing F flags the question: the button is pressed, the badge says flagged, the set has it', on.pressed === 'true' && on.on && on.badge && on.inSet && on.size === 1, JSON.stringify(on));
    ok('the badge reads "flagged" for a screen reader as well as the eye', on.badgeText === 'flagged', on.badgeText);
    ok('the flag is in storage the moment it is made, read back from there', on.saved === true);
    ok('a screen reader is told, and how many are flagged', on.live === 'Flagged. 1 question is in your Flagged list.', on.live);
    await page.keyboard.press('f');
    const off = await flagRead();
    ok('pressing F again takes it off: not pressed, no badge, not in the set, not in storage', off.pressed === 'false' && !off.on && !off.badge && !off.inSet && !off.saved && off.size === 0, JSON.stringify(off));
    ok('and a screen reader is told that too', off.live === 'Flag removed. Your Flagged list is empty.', off.live);
    await tapFlag();
    const t1 = await flagRead();
    await tapFlag();
    const t2 = await flagRead();
    ok('tapping the button flags it, and tapping it again takes it off', t1.inSet && t1.pressed === 'true' && t1.saved && !t2.inSet && t2.pressed === 'false' && !t2.saved, JSON.stringify([t1.inSet, t2.inSet]));
    ok('flagging and unflagging is not an answer: no total, no missed list, no log, no schedule, no resume place changed', same(await snap(), rec));
  }
  {
    /* The key is F whatever the case: Shift, or Caps Lock, makes it a capital. */
    await page.keyboard.press('Shift+F');
    const cap = await flagRead();
    ok('a capital F flags too', cap.inSet && cap.pressed === 'true', JSON.stringify(cap));
    const look = async () => { await page.mouse.move(2, 2); await stilled(); return page.evaluate(() => {
      const b = document.getElementById('qFlag'), g = document.getElementById('qFlagBadge'), cs = getComputedStyle(b);
      return { color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor, fill: getComputedStyle(b.querySelector('.icon')).fill, badge: g.offsetWidth > 0 ? getComputedStyle(g).color : null };
    }); };
    const on = await look();
    await page.keyboard.press('f');
    const off = await look();
    ok('a flag that is on looks different from one that is off: its colour, its ground and its edge', on.color !== off.color && on.bg !== off.bg && on.border !== off.border, JSON.stringify([on, off]));
    ok('and not by colour alone: the pennant is filled when on and open when off', on.fill === on.color && off.fill === 'none', JSON.stringify([on.fill, on.color, off.fill]));
    ok('the badge beside the stem is the same amber as the pressed button', on.badge === on.color, JSON.stringify([on.badge, on.color]));
    /* The count a screen reader is given is the bank's: an id the bank has lost is not a question flagged. */
    await page.evaluate(() => { S.flagged.add('NO_SUCH_QUESTION_AT_ALL'); });
    await page.keyboard.press('f');
    const ghost = await flagRead();
    ok('a flag on an id the bank has lost is not counted when a screen reader is told how many are flagged', ghost.live === 'Flagged. 1 question is in your Flagged list.', ghost.live);
    await page.keyboard.press('f');
    await page.evaluate(() => { S.flagged.delete('NO_SUCH_QUESTION_AT_ALL'); save(); });
  }
  {
    await tapFlag();
    await page.evaluate(() => nextQ());
    const onB = await showing(B); await settle();
    const rb = await flagRead();
    ok('the next question is not flagged because this one is: the flag is on the question, not on the place', onB && rb.id === B && !rb.inSet && rb.pressed === 'false' && !rb.badge, JSON.stringify(rb));
    await page.evaluate(() => prevQ());
    const onA = await showing(A); await settle();
    const ra = await flagRead();
    ok('and going back finds the flag where it was left, drawn on the button and the badge', onA && ra.id === A && ra.inSet && ra.pressed === 'true' && ra.badge, JSON.stringify(ra));
    await tapFlag();
  }
  {
    await page.keyboard.down('f'); await page.keyboard.down('f'); await page.keyboard.up('f');
    const held = await flagRead();
    ok('a held F flags once, and does not flag and unflag as it repeats', held.inSet && held.size === 1, JSON.stringify(held));
    await page.keyboard.press('f');
    await page.keyboard.press('Control+f'); await page.keyboard.press('Meta+f'); await page.keyboard.press('Alt+f');
    const mod = await flagRead();
    ok('Control, Command and Option with F are not the flag key: the question stays unflagged', !mod.inSet && mod.size === 0, JSON.stringify(mod));

  }
  {
    await page.evaluate(() => addSticky());
    const sticky = await drawn('.note-layer .sticky textarea');
    await page.keyboard.type('fish');
    const typed = await page.evaluate(() => ({ text: document.querySelector('.note-layer .sticky textarea').value, flagged: S.flagged.size, focus: document.activeElement.tagName }));
    ok('a sticky note was open with the keyboard in it', sticky && typed.focus === 'TEXTAREA', typed.focus);
    ok('an F typed into a sticky note is a letter in the note and is not the flag', typed.text === 'fish' && typed.flagged === 0, JSON.stringify(typed));
    await page.evaluate(() => document.activeElement.blur());
  }
  {
    /* The x on a sticky note takes a press. The note's header captures the pointer so the note can be dragged, and a
       header that captured a press that began on the x sent the release to itself: no click reached the x, which
       answered a script's b.click() and nothing a hand did. These presses go through the browser's own hit test, as a
       finger, a Pencil and a mouse do; the drag is held too, because the fix must not take the header from the grip. */
    const spot = sel => page.evaluate(s => {
      const el = document.querySelector(s); el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel);
    const read = () => page.evaluate(() => { const l = NOTES[currentQ().id] || []; return { n: l.length, shown: document.querySelectorAll('.note-layer .sticky').length, at: l.length ? [l[0].x, l[0].y] : null }; });
    const before = await read();
    const grip = await spot('.note-layer .sticky .sticky-grip');
    await page.mouse.move(grip.x, grip.y); await page.mouse.down();
    await page.mouse.move(grip.x + 90, grip.y + 50, { steps: 6 }); await page.mouse.up();
    const dragged = await read();
    ok('a sticky note is dragged by its grip', before.at && dragged.at && dragged.at[0] > before.at[0] + 0.02 && dragged.at[1] > before.at[1] + 0.02, JSON.stringify([before.at, dragged.at]));
    const x = await spot('.note-layer .sticky .sticky-x');
    await page.mouse.click(x.x, x.y);
    const gone = await read();
    ok('a click on the x of a sticky note deletes the note, from the list the notes are kept in and from the screen',
       before.n > 0 && gone.n === before.n - 1 && gone.shown === before.shown - 1, JSON.stringify({ before, gone }));
  }

  {
    await fresh();
    const long = 'L'.repeat(120);
    await page.evaluate(([a, id]) => { const q = Object.assign({}, QBYID[a], { id }); QBYID[id] = q; startAdhocQuiz([q], null); }, [A, long]);
    await showing(long); await settle();
    await page.keyboard.press('f');
    const r = await flagRead();
    await page.evaluate(id => { delete QBYID[id]; }, long);
    ok('a question whose id is 120 characters, the longest a bank may give, can be flagged, and the reader is told so', r.id === long && r.inSet && r.saved && r.pressed === 'true' && r.live === 'Flagged. 1 question is in your Flagged list.', JSON.stringify([r.inSet, r.saved, r.live]));
  }

  head('a flag is not an answer, and an answer does not take it off');
  await fresh();
  await deal([A, B]);
  {
    await page.keyboard.press('f');
    await page.evaluate(() => selectOpt(S.questions[S.qIdx].ci));
    await settle();
    const right = await page.evaluate(() => ({ flagged: S.flagged.has(S.questions[S.qIdx].id), missed: S.missed.has(S.questions[S.qIdx].id), btn: !!document.getElementById('qFlag'),
      pressed: document.getElementById('qFlag') && document.getElementById('qFlag').getAttribute('aria-pressed'), saved: JSON.parse(localStorage.getItem('accsap12.v2')).flagged }));
    ok('answering a flagged question right leaves it flagged: it is "right but unsure" that a flag holds', right.flagged && !right.missed && right.saved.includes(A), JSON.stringify(right));
    ok('and the Flag button is still there once the answer is shown, pressed', right.btn && right.pressed === 'true');
    ok('and the hint under the answer says F flags', /F to flag/.test(await page.evaluate(() => document.querySelector('.kb-hint').textContent)));
    /* With the answer shown, the F line is the only thing in the key handler that reads the key's name. */
    const errs = errors.length;
    await page.evaluate(() => document.dispatchEvent(new Event('keydown')));
    await page.waitForTimeout(50);
    ok('a key event that names no key does nothing and throws nothing', errors.length === errs && await page.evaluate(() => S.flagged.size) === 1, errors.slice(errs).join(' | '));
    await page.evaluate(() => nextQ());
    await showing(B); await settle();
    await page.keyboard.press('f');
    await page.evaluate(() => selectOpt((S.questions[S.qIdx].ci + 1) % S.questions[S.qIdx].o.length));
    await settle();
    const wrong = await page.evaluate(() => ({ flagged: S.flagged.has(S.questions[S.qIdx].id), missed: S.missed.has(S.questions[S.qIdx].id), n: S.flagged.size }));
    ok('answering a flagged question wrong flags nothing more and takes nothing off, and it is missed as any is', wrong.flagged && wrong.missed && wrong.n === 2, JSON.stringify(wrong));
    await page.keyboard.press('f');
    const un = await page.evaluate(() => ({ flagged: S.flagged.has(S.questions[S.qIdx].id), missed: S.missed.has(S.questions[S.qIdx].id) }));
    ok('unflagging an answered question does not put it right or wrong: the missed list is the same', !un.flagged && un.missed === true, JSON.stringify(un));
  }

  head('a review session: the flag is in the rating prompt');
  await fresh();
  {
    await page.evaluate(([a, b]) => startQuiz(null, 'due', [QBYID[a], QBYID[b]]), [A, B]);
    const up = await reached('quiz') && await showing(A); await settle();
    await page.evaluate(() => selectOpt(S.questions[S.qIdx].ci));
    const inPrompt = await drawn('.rate-prompt #qFlag'); await settle();
    const r = await page.evaluate(() => {
      const b = document.getElementById('qFlag'), q = b ? b.getBoundingClientRect() : null, a = document.querySelector('.actions');
      const p = b && b.closest('.rate-prompt'), pr = p ? p.getBoundingClientRect() : null, rr = document.querySelector('.rate-row');
      return { n: document.querySelectorAll('#qFlag').length, inPrompt: !!p, row: a ? a.children.length : -1, w: q && Math.round(q.width), h: q && Math.round(q.height), pressed: b && b.getAttribute('aria-pressed'),
        off: q && pr ? Math.round(Math.abs((q.left + q.right) / 2 - (pr.left + pr.right) / 2)) : null, gap: q && rr ? Math.round(q.top - rr.getBoundingClientRect().bottom) : null };
    });
    ok('a review session is up, and a card has been answered', up);
    ok('the rating prompt holds the Flag button, which is the only one on the screen, while the action row is empty', inPrompt && r.inPrompt && r.n === 1 && r.row === 0, JSON.stringify(r));
    ok('and it is at least 44 px each way, and not pressed', r.w >= 44 && r.h >= 44 && r.pressed === 'false', JSON.stringify(r));
    ok('and it sits in the middle of the prompt, set apart from the ratings by a gap', r.off !== null && r.off <= 3 && r.gap !== null && r.gap >= 10, JSON.stringify(r));
    await page.click('#qFlag');
    const on = await flagRead();
    ok('tapping it there flags the question, before the card is rated', on.id === A && on.inSet && on.saved && on.pressed === 'true' && on.badge, JSON.stringify(on));
    await page.locator('.rate-btn').nth(2).click();
    const next = await showing(B); await settle();
    ok('rating the card moves on and leaves the flag where it was put', next && await page.evaluate(a => S.flagged.has(a), A));
    await page.evaluate(() => selectOpt(S.questions[S.qIdx].ci));
    await drawn('.rate-prompt #qFlag'); await settle();
    await page.keyboard.press('f');
    ok('the F key flags in the prompt too', (await flagRead()).id === B && (await flagRead()).inSet);
  }

  head('the keyboard on an answered question');
  await fresh();
  await deal([A, B, C]);
  {
    await page.evaluate(() => selectOpt(S.questions[S.qIdx].ci)); await settle();
    await page.focus('#qFlag'); await page.keyboard.press('Enter');
    const enter = await page.evaluate(() => ({ i: S.qIdx, n: S.flagged.size }));
    ok('Enter on the focused Flag button flags the question and stays on it', enter.i === 0 && enter.n === 1, JSON.stringify(enter));
    await page.keyboard.press('Space');
    const space = await page.evaluate(() => ({ i: S.qIdx, n: S.flagged.size }));
    ok('Space on it takes the flag off and stays on the question', space.i === 0 && space.n === 0, JSON.stringify(space));
    await page.evaluate(() => nextQ());
    await showing(B); await settle();
    await page.evaluate(() => selectOpt(S.questions[S.qIdx].ci)); await settle();
    await page.focus('.btn-prev'); await page.keyboard.press('Enter');
    const prev = await showing(A); await settle();
    ok('Enter on the focused Previous button goes back, as the button says, and not on', prev && (await page.evaluate(() => S.qIdx)) === 0);
    await page.focus('#qFlag'); await page.keyboard.press('ArrowRight');
    const right = await showing(B); await settle();
    ok('the arrow keys are not a button\'s: Right moves on from a focused Flag button', right && (await page.evaluate(() => S.qIdx)) === 1);
    await page.focus('#qFlag'); await page.keyboard.press('ArrowLeft');
    const left = await showing(A); await settle();
    ok('and Left goes back', left && (await page.evaluate(() => S.qIdx)) === 0);
    await page.evaluate(() => focusEl('.reveal-header'));
    const onHeading = await page.evaluate(() => document.activeElement && document.activeElement.className.indexOf('reveal-header') >= 0);
    await page.keyboard.press('Enter');
    const adv = await showing(B);
    ok('Enter on the heading the answer moved the keyboard to still moves on', onHeading && adv && (await page.evaluate(() => S.qIdx)) === 1, String(onHeading));
  }

  head('flags are kept, and read back only as ids');
  await fresh();
  await deal([A, B, C]);
  await page.keyboard.press('f');
  await page.evaluate(() => nextQ()); await showing(B); await settle();
  await page.evaluate(() => nextQ()); await showing(C); await settle();
  await page.keyboard.press('f');
  {
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('accsap12.v2')).flagged);
    ok('the record keeps the flags in the order they were made', same(stored, [A, C]), JSON.stringify(stored));
    ok('and the saved record names the field the schema declares', await page.evaluate(() => SCHEMA_KEYS.includes('flagged') && Object.keys(JSON.parse(localStorage.getItem('accsap12.v2'))).includes('flagged')));
    await page.reload({ waitUntil: 'load', timeout: 200000 }); await booted(page);
    const back = await page.evaluate(() => [...S.flagged]);
    ok('after a reload the same questions are flagged, in the same order', same(back, [A, C]), JSON.stringify(back));
  }
  {
    await page.evaluate(() => { S.chStats = { [CHAPTERS[0]]: { correct: 3, total: 5 } }; S.sessionTotal = 5; S.sessionCorrect = 3; save(); });
    answerDialogs = true;
    await page.evaluate(() => resetProgress());
    answerDialogs = false;
    await reached('home'); await settle();
    const r = await page.evaluate(() => ({ chStats: Object.keys(S.chStats).length, flagged: [...S.flagged], saved: JSON.parse(localStorage.getItem('accsap12.v2')).flagged }));
    ok('Reset did run: the scores are gone', r.chStats === 0, JSON.stringify(r));
    ok('and Reset leaves the flags, which are the fellow\'s marks and not a score', same(r.flagged, [A, C]) && same(r.saved, [A, C]), JSON.stringify(r));
  }
  {
    const boot = async blob => {
      await page.evaluate(b => localStorage.setItem('accsap12.v2', JSON.stringify(b)), blob);
      await page.reload({ waitUntil: 'load', timeout: 200000 }); await booted(page);
      return page.evaluate(() => ({ flagged: [...S.flagged], screen: S.screen }));
    };
    const errs0 = errors.length;
    const junk = await boot({ flagged: ['x', 5, null, 'x', '', { a: 1 }, 'y'] });
    ok('storage with ids and other things in the list gives the ids, once each, in order', same(junk.flagged, ['x', 'y']), JSON.stringify(junk.flagged));
    ok('a flagged list that is a string, an object or a number gives none, and the app still starts', same((await boot({ flagged: 'abc' })).flagged, []) && same((await boot({ flagged: { 0: 'a', length: 1 } })).flagged, []) && same((await boot({ flagged: 7 })).flagged, []));
    ok('a record from before flags, with no such field, gives none and starts', same((await boot({ chStats: {} })).flagged, []));
    const inherited = await boot({ flagged: ['constructor', '__proto__', A] });
    const dealtFor = await page.evaluate(() => flaggedQs().map(q => q.id));
    ok('a list naming "constructor" and "__proto__" keeps them as ids but deals nothing for them', same(inherited.flagged, ['constructor', '__proto__', A]) && same(dealtFor, [A]), JSON.stringify([inherited.flagged, dealtFor]));
    ok('none of that threw', errors.length === errs0, errors.slice(errs0).join(' | '));
  }

  head('flags go into a backup and come out of one');
  await fresh();
  await page.evaluate(([a, c]) => { S.flagged = new Set([a, c]); save(); }, [A, C]);
  {
    const exported = async () => page.evaluate(async () => {
      const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click; let blob = null;
      URL.createObjectURL = b => { blob = b; return 'blob:stub'; }; HTMLAnchorElement.prototype.click = () => {};
      try { await exportMarkup(); } finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
      return blob ? await blob.text() : null;
    });
    const text = await exported();
    const stats = text ? (JSON.parse(text).stats || {}) : {};
    ok('an export holds the flagged list', same(stats.flagged, [A, C]), JSON.stringify(stats.flagged));
    await page.evaluate(() => { const raw = JSON.parse(localStorage.getItem('accsap12.v2')); raw.flagged = ['keep', 5, null, 'keep']; localStorage.setItem('accsap12.v2', JSON.stringify(raw)); });
    const dirty = await exported();
    ok('an export leaves out what is not an id, as the import would refuse it', same((JSON.parse(dirty).stats || {}).flagged, ['keep']), JSON.stringify((JSON.parse(dirty).stats || {}).flagged));
    const verdicts = await page.evaluate(() => {
      const run = f => { try { const p = validateAnnotationBackup({ stats: { flagged: f } }); return { ok: true, has: 'flagged' in p, flagged: p.flagged ? [...p.flagged] : null }; } catch (e) { return { ok: false, msg: e.message }; } };
      const bare = (() => { try { const p = validateAnnotationBackup({ stats: {} }); return { ok: true, has: 'flagged' in p }; } catch (e) { return { ok: false, msg: e.message }; } })();
      return { good: run(['a', 'b']), dup: run(['a', 'a']), num: run(['a', 5]), str: run('abc'), obj: run({}), none: bare, nul: run(null), empty: run([]) };
    });
    ok('a backup with ids in its flagged list is accepted and gives them', verdicts.good.ok && same(verdicts.good.flagged, ['a', 'b']), JSON.stringify(verdicts.good));
    ok('and the same id twice is one flag', verdicts.dup.ok && same(verdicts.dup.flagged, ['a']), JSON.stringify(verdicts.dup));
    ok('a list with a number in it is refused, by name', !verdicts.num.ok && verdicts.num.msg === 'Invalid flagged list.', JSON.stringify(verdicts.num));
    ok('a flagged list that is a string or an object is refused, by name', !verdicts.str.ok && verdicts.str.msg === 'Invalid flagged list.' && !verdicts.obj.ok && verdicts.obj.msg === 'Invalid flagged list.', JSON.stringify([verdicts.str, verdicts.obj]));
    ok('a backup from before flags, or with the list null, is accepted and says nothing of flags', verdicts.none.ok && verdicts.none.has === false && verdicts.nul.ok && verdicts.nul.has === false, JSON.stringify([verdicts.none, verdicts.nul]));
    ok('a backup with an empty list is accepted and says there are none', verdicts.empty.ok && verdicts.empty.has === true && same(verdicts.empty.flagged, []), JSON.stringify(verdicts.empty));
    await page.evaluate(([a, c]) => { S.flagged = new Set([a, c]); save(); }, [A, C]);
    const restored = await page.evaluate(`(${RESTORE})(${JSON.stringify(JSON.stringify({ stats: { flagged: [B, D], chStats: {} } }))}).then(() => ({ flagged: [...S.flagged], saved: JSON.parse(localStorage.getItem('accsap12.v2')).flagged }))`);
    ok('importing a backup puts its flags where the live list and the storage both have them, in place of what was there', same(restored.flagged, [B, D]) && same(restored.saved, [B, D]), JSON.stringify(restored));
    const refusedBefore = await page.evaluate(() => [...S.flagged]);
    await page.evaluate(`(${RESTORE})(${JSON.stringify(JSON.stringify({ stats: { flagged: ['ok', 5] } }))}).catch(() => {})`);
    ok('importing a backup whose list is not ids changes nothing', same(await page.evaluate(() => [...S.flagged]), refusedBefore) && same(await page.evaluate(() => JSON.parse(localStorage.getItem('accsap12.v2')).flagged), refusedBefore));
    await page.evaluate(`(${RESTORE})(${JSON.stringify(JSON.stringify({ stats: { chStats: {} } }))}).catch(() => {})`);
    const older = await page.evaluate(() => ({ live: [...S.flagged], saved: JSON.parse(localStorage.getItem('accsap12.v2')).flagged }));
    ok('importing an older backup, which has no flagged list, leaves the flags made since: it says nothing of them', same(older.live, [B, D]), JSON.stringify(older));
    ok('and the record kept after the import still holds them, so a reload does not lose them', same(older.saved, [B, D]), JSON.stringify(older));
    await page.evaluate(`(${RESTORE})(${JSON.stringify(JSON.stringify({ stats: { flagged: [], chStats: {} } }))}).catch(() => {})`);
    ok('importing a backup with an empty list does empty the flags: a list, even an empty one, replaces them', same(await page.evaluate(() => [...S.flagged]), []) && same(await page.evaluate(() => JSON.parse(localStorage.getItem('accsap12.v2')).flagged), []));
    await page.evaluate(`(${RESTORE})(${JSON.stringify(JSON.stringify({ stats: { chStats: {} } }))}).catch(() => {})`);
    const bare = await page.evaluate(() => JSON.parse(localStorage.getItem('accsap12.v2')));
    ok('and an older backup restored over nothing flagged is kept as it is: no flagged field is added to its record', same(bare, { chStats: {} }), JSON.stringify(bare));
  }

  head('the Flagged deck');
  await fresh();
  {
    const ghost = 'NO_SUCH_QUESTION_' + Date.now();
    await page.evaluate(([a, b, c, ghost]) => { QBYID[b].bad = true; S.flagged = new Set([a, b, ghost, 'constructor', c]); save(); }, [A, B, C, ghost]);
    const up = await page.evaluate(() => { startQuiz(null, 'flagged'); return true; });
    const dealt = up && await reached('quiz') && await drawn('#qFlag');
    ok('the Flagged deck opens on the quiz screen', dealt);
    const d = await page.evaluate(() => ({ ids: S.questions.map(q => q && q.id).sort(), mode: S.mode, chapter: S.chapter, resumed: S.resumed, answers: Object.keys(S.answers).length }));
    ok('it holds the flagged questions the bank has and no others: not the quarantined one, not the id the bank lacks, not "constructor"', same(d.ids, [A, C].sort()), JSON.stringify(d.ids));
    ok('it is a Flagged deck of the whole bank, fresh, not a chapter\'s and not a resumed one', d.mode === 'flagged' && d.chapter === null && d.resumed === false && d.answers === 0, JSON.stringify(d));
    const before = JSON.stringify(await page.evaluate(() => S.resume));
    await page.evaluate(() => selectOpt(S.questions[S.qIdx].ci));
    await settle();
    ok('answering in it keeps no place to resume, because a deck that shrinks as flags come off has none', JSON.stringify(await page.evaluate(() => S.resume)) === before && !Object.keys(await page.evaluate(() => S.resume)).some(k => /flag/.test(k)));
    await page.evaluate(() => goStudy()); await onScreen(page, 'study', { marker: '#flagCard' }); await settle();
    const card = await page.evaluate(() => document.getElementById('flagCount').textContent);
    ok('the Study card counts what the bank still has: two, not five', card === '2 questions flagged', card);
    await page.evaluate(b => { delete QBYID[b].bad; }, B);
  }
  {
    await page.evaluate(([a, c]) => { S.flagged = new Set([a, c]); save(); startQuiz(null, 'flagged'); }, [A, C]);
    await reached('quiz'); await drawn('#qFlag'); await settle();
    const firstId = await page.evaluate(() => S.questions[0].id);
    await page.keyboard.press('f');
    const run = await page.evaluate(() => ({ n: S.questions.length, flagged: S.flagged.size }));
    ok('taking a flag off inside the deck does not shorten the run being made', run.n === 2 && run.flagged === 1, JSON.stringify(run));
    await page.evaluate(() => { S.qIdx = S.questions.length - 1; restoreQuizState(); selectOpt(S.questions[S.qIdx].ci); nextQ(); });
    const results = await reached('results') && await drawn('.results-btns');
    const btns = await page.evaluate(() => [...document.querySelectorAll('.results-btns .btn')].map(b => b.textContent.trim().replace(/\s+/g, ' ')));
    ok('the deck ends on the results screen, with "Flagged Again" among its buttons', results && btns.some(t => /^Flagged Again/.test(t)), JSON.stringify(btns));
    await page.evaluate(() => [...document.querySelectorAll('.results-btns .btn')].find(b => /^Flagged Again/.test(b.textContent.trim())).click());
    const again = await reached('quiz') && await drawn('#qFlag');
    const d2 = await page.evaluate(() => ({ mode: S.mode, ids: S.questions.map(q => q.id) }));
    ok('"Flagged Again" deals the Flagged deck again, and what was unflagged on the way is not in it', again && d2.mode === 'flagged' && d2.ids.length === 1 && d2.ids[0] !== firstId, JSON.stringify(d2));
  }
  {
    await fresh();
    await page.evaluate(() => goStudy()); await onScreen(page, 'study', { marker: '#planCard' }); await settle();
    const dialogsBefore = dialogs.length;
    await page.evaluate(() => startQuiz(null, 'flagged'));
    await page.waitForFunction(() => { const t = document.getElementById('toast'); return !!t && /Nothing is flagged/.test(t.textContent); }, null, { timeout: 4000 }).catch(() => {});
    const t = await page.evaluate(() => ({ toast: (document.getElementById('toast') || {}).textContent || '', screen: S.screen }));
    ok('asking for the Flagged deck with nothing flagged says so, in the app and not in a dialog, and stays where it is', /Nothing is flagged\. Tap Flag on a question, or press F/.test(t.toast) && t.screen === 'study' && dialogs.length === dialogsBefore, JSON.stringify([t, dialogs.length - dialogsBefore]));
  }

  head('the Study screen\'s Flagged card');
  await fresh();
  {
    await page.evaluate(() => goStudy()); await onScreen(page, 'study', { marker: '#planCard' }); await settle();
    const none = await page.evaluate(() => ({ flag: !!document.getElementById('flagCard'), anno: !!document.getElementById('annoCard') }));
    ok('with nothing flagged and nothing written, neither card is there', !none.flag && !none.anno, JSON.stringify(none));
    await page.evaluate(a => { S.flagged = new Set([a]); save(); goStudy(); }, A);
    await drawn('#flagCard'); await settle();
    ok('one flag is "1 question flagged"', await page.evaluate(() => document.getElementById('flagCount').textContent) === '1 question flagged');
    await page.evaluate(([a, b, c]) => { S.flagged = new Set([a, b, c]); S.missed = new Set([a]); NOTES[b] = [{ id: 'n1', x: .1, y: .1, text: 'hello', color: '' }]; saveJSON(NOTE_KEY, NOTES); save(); goStudy(); }, [A, B, C]);
    await drawn('#flagCard'); await settle();
    const r = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#app .feed-card')], at = sel => cards.findIndex(x => x.matches(sel)), c = document.getElementById('flagCard');
      const ctl = [...c.querySelectorAll('button')].concat([document.getElementById('annoCard')]);
      return {
        text: document.getElementById('flagCount').textContent, miss: at('.miss-card'), flag: at('#flagCard'), anno: at('#annoCard'), all: at('.all-card'),
        small: ctl.filter(b => b.offsetHeight < 44).map(b => b.id), role: c.getAttribute('role'), label: c.getAttribute('aria-label'),
        spill: [...c.querySelectorAll('*')].some(x => { const b = x.getBoundingClientRect(), k = c.getBoundingClientRect(); return b.width > 0 && (b.right > k.right + 1 || b.left < k.left - 1); }),
        annoTag: document.getElementById('annoCard').tagName,
      };
    });
    ok('three flags are "3 questions flagged"', r.text === '3 questions flagged', r.text);
    ok('the cards sit after the weak spots and before the whole bank: weak spots, Flagged, Annotated, then the full bank', r.miss >= 0 && r.miss < r.flag && r.flag < r.anno && r.anno < r.all, JSON.stringify(r));
    ok('every button on them is at least 44 px tall', r.small.length === 0, r.small.join());
    ok('the Flagged card is a labelled group, and nothing spills out of it', r.role === 'group' && /Flagged/.test(r.label) && !r.spill, JSON.stringify([r.role, r.label, r.spill]));
    ok('the Annotated card is one button, which a keyboard reaches', r.annoTag === 'BUTTON');
    const amber = await tokenColor('amber-ink');   /* text in amber is written in its ink (base.css) */
    const badges = await page.evaluate(() => ['#flagCard .fc-badge', '#annoCard .fc-badge'].map(s => getComputedStyle(document.querySelector(s)).color));
    ok('the badges on the two cards are amber', badges.every(c => c === amber), JSON.stringify([badges, amber]));
    await page.click('#flagGo');
    const go = await reached('quiz') && await drawn('#qFlag');
    const deck = await page.evaluate(() => ({ mode: S.mode, ids: S.questions.map(q => q.id).sort() }));
    ok('"Go through them" deals the Flagged deck', go && deck.mode === 'flagged' && same(deck.ids, [A, B, C].sort()), JSON.stringify(deck));
  }
  {
    /* A flag on an id the bank has lost, which is kept; the card does not count it and Clear does not touch it. */
    await page.evaluate(() => { S.flagged.add('GHOST_FLAG_ID_KEPT'); save(); goStudy(); });
    await onScreen(page, 'study', { marker: '#flagCard' }); await settle();
    const log0 = await snap();
    const dwelled = () => page.waitForFunction(() => Date.now() - _flagArmAt >= FLAG_DWELL_MS, null, { timeout: 4000 }).then(() => true, () => false);
    const clearLook = () => page.evaluate(() => { const b = document.getElementById('flagClear'); return b ? getComputedStyle(b).color : null; });
    await page.mouse.move(2, 2); await stilled();
    const resting = await clearLook();
    await page.click('#flagClear');
    await drawn('#flagClear.arm'); await page.mouse.move(2, 2); await stilled();
    const armed = await page.evaluate(() => { const b = document.getElementById('flagClear'); return { text: b ? b.textContent.trim() : null, n: flaggedQs().length, raw: S.flagged.size, focus: document.activeElement && document.activeElement.id, color: b ? getComputedStyle(b).color : null }; });
    const red = await tokenColor('red-ink');
    ok('the first tap on Clear arms it, says how many the card counts, and clears nothing', armed.n === 3 && armed.raw === 4 && /^Tap again to clear all 3$/.test(armed.text || ''), JSON.stringify(armed));
    ok('an armed Clear looks armed: red, and not the colour it rests in', armed.color === red && resting !== red, JSON.stringify([resting, armed.color, red]));
    ok('and the keyboard is still on the button that was pressed', armed.focus === 'flagClear', armed.focus);
    const echo = await page.evaluate(() => { _flagArmAt = Date.now(); clearFlags(); return { raw: S.flagged.size, armed: _flagArm }; });
    ok('a second tap on its heels, the echo of the first, clears nothing and leaves it armed', echo.raw === 4 && echo.armed === true, JSON.stringify(echo));
    await page.waitForFunction(() => !document.getElementById('flagClear') || !document.getElementById('flagClear').classList.contains('arm'), null, { timeout: 9000 }).catch(() => {});
    const timed = await page.evaluate(() => { const b = document.getElementById('flagClear'); return { n: S.flagged.size, arm: b ? b.classList.contains('arm') : null, focus: document.activeElement && document.activeElement.id }; });
    ok('left alone for five seconds it puts itself back, with every flag still there', timed.n === 4 && timed.arm === false, JSON.stringify(timed));
    ok('and the keyboard is still on the button when it does', timed.focus === 'flagClear', timed.focus);
    await page.click('#flagClear'); await drawn('#flagClear.arm');
    await dwelled();
    await page.click('#flagClear');
    await page.waitForFunction(() => !document.getElementById('flagCard'), null, { timeout: 4000 }).catch(() => {});
    const cleared = await page.evaluate(() => ({ card: !!document.getElementById('flagCard'), n: flaggedQs().length, raw: [...S.flagged], saved: JSON.parse(localStorage.getItem('accsap12.v2')).flagged, notes: Object.keys(NOTES).length, anno: !!document.getElementById('annoCard'), live: document.getElementById('srLive').textContent }));
    ok('the second tap clears the flags the card counted: the card goes and none is dealt', !cleared.card && cleared.n === 0, JSON.stringify(cleared));
    ok('a flag on a question the bank has lost is kept, in the set and in the storage', same(cleared.raw, ['GHOST_FLAG_ID_KEPT']) && same(cleared.saved, ['GHOST_FLAG_ID_KEPT']), JSON.stringify([cleared.raw, cleared.saved]));
    ok('and the notes are not touched', cleared.notes === 1 && cleared.anno === true);
    ok('a screen reader is told', cleared.live === 'All flags cleared.', cleared.live);
    ok('clearing the flags is not an answer', same(await snap(), log0));
  }

  head('the Annotations list');
  await fresh();
  const NOTE_WORDS = 'class i for sotalol? check the qt avoid beta blockers in cocaine chest pain second note on this one';
  /* Three questions in three chapters, each with a word in its stem that is in no note written below, no chapter's name and
     neither of the other two stems: what lets "the stem is searched" be told from "the note is". */
  const trio = await page.evaluate(notes => {
    const tok = q => FlagSet.words(q.s).filter(t => t.length >= 5);
    const byCh = CHAPTERS.slice(0, 3).map(ch => POOL.filter(q => q.ch === ch)), chNames = CHAPTERS.join(' ').toLowerCase();
    for (const x of byCh[0]) for (const y of byCh[1]) for (const z of byCh[2]) {
      const t = [x, y, z], words = t.map((q, i) => tok(q).find(w => notes.indexOf(w) < 0 && chNames.indexOf(w) < 0 && t.every((o, j) => j === i || tok(o).indexOf(w) < 0)));
      if (words.every(Boolean)) return { ids: t.map(q => q.id), words };
    }
    return null;
  }, NOTE_WORDS);
  ok('three questions can be found whose stems each hold a word of their own', !!trio, JSON.stringify(trio));
  {
    const [A, B, C] = trio ? trio.ids : [first[0], first[1], first[2]];
    /* A note made the way a fellow makes one: open the question, add a sticky, type into it. */
    const note = async (id, text, fresh1) => {
      if (fresh1) { await page.evaluate(id => jumpTo(id), id); await showing(id); await settle(); }
      await page.evaluate(() => addSticky());
      await page.waitForFunction(() => document.querySelectorAll('.note-layer .sticky textarea').length > 0, null, { timeout: 4000 });
      await page.fill('.note-layer .sticky:last-child textarea', text);
      await page.waitForTimeout(25);
    };
    await note(A, 'Class I for sotalol? check the QT', true);
    await note(B, 'Avoid beta blockers in cocaine chest pain', true);
    await note(B, 'second note on this one', false);
    /* The mark on C is drawn with the pencil tool and a pointer, as a fellow draws one: a stroke written by hand in a shape the
       app does not write ({t,c,p:[[x,y,pressure]]}) makes the question's canvas throw when that question is next drawn. */
    await page.evaluate(id => jumpTo(id), C); await showing(C); await settle();
    await page.evaluate(() => railAction('pen'));
    await drawn('.q-card .ink-canvas');
    /* A pointer reaches the canvas only when the canvas is what is under it. A change of screen starts a view transition (Chromium;
       WebKit runs with them off) and while one runs the page is not hit-tested: the pointer lands on <html> and makes no stroke. This
       section's first jumpTo is such a change, so on a quick machine the pencil came down in the middle of it. The point it touches
       is waited for until the canvas is under it, and a canvas that never is gets a failure of its own that names what is there. */
    const pencilAt = () => page.evaluate(() => {
      const c = document.querySelector('.q-card .ink-canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect(), x = r.left + r.width * .2, y = r.top + r.height * .3, el = document.elementFromPoint(x, y);
      return { x, y, w: r.width, h: r.height, on: el === c, under: el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') : 'nothing' };
    });
    await page.waitForFunction(() => {
      const c = document.querySelector('.q-card .ink-canvas');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width * .2, r.top + r.height * .3) === c;
    }, null, { timeout: 6000 }).catch(() => {});
    const pt = await pencilAt();
    ok('the canvas is what is under the pencil when it touches down: the screen has stopped moving', !!pt && pt.on, pt ? pt.under : 'no canvas');
    if (pt) {
      await page.mouse.move(pt.x, pt.y); await page.mouse.down();
      await page.mouse.move(pt.x + pt.w * .4, pt.y + pt.h * .3, { steps: 6 }); await page.mouse.up();
    }
    await page.evaluate(() => railAction('pen'));
    const inked = await page.evaluate(id => { const s = INK[id + ':q'] || []; return { n: s.length, pts: s[0] && s[0].p ? s[0].p.length : 0, tool: s[0] && s[0].t }; }, C);
    ok('the pencil drew a stroke on the third question: the marks the list is to find are the app\'s own', inked.n === 1 && inked.pts >= 2 && inked.tool === 'pen', JSON.stringify(inked));
    await page.evaluate(([a, b]) => { NOTES['NO_SUCH_QUESTION'] = [{ id: 'n1', text: 'a note on a question the bank lost' }]; saveJSON(NOTE_KEY, NOTES); S.flagged = new Set([a]); S.missed = new Set([b]); save(); goStudy(); }, [A, B]);
    await onScreen(page, 'study', { marker: '#annoCard' }); await settle();
    const card = await page.evaluate(() => ({ title: document.querySelector('#annoCard .fc-title').textContent.trim(), h: document.getElementById('annoCard').offsetHeight }));
    ok('the Annotated card counts the questions with a note or a mark, and not the one the bank lacks', card.title === '3 questions you wrote on', card.title);
    await page.click('#annoCard');
    const up = await reached('annotations') && await drawn('#annoList .anno-row'); await settle();
    const rows = () => page.evaluate(() => [...document.querySelectorAll('#annoList .anno-row')].map(r => ({ id: r.dataset.anno, note: r.querySelector('.anno-text').textContent.trim(), none: r.querySelector('.anno-text').classList.contains('none'),
      top: r.querySelector('.hit-top').textContent.replace(/\s+/g, ' ').trim(), stem: r.querySelector('.anno-stem').textContent.trim() })));
    const list = await rows();
    ok('the list opens', up && list.length > 0);
    ok('three questions are listed: those with a note, and the one with pencil only; none the bank lacks', same(list.map(r => r.id).sort(), [A, B, C].sort()), JSON.stringify(list.map(r => r.id)));
    ok('the newest note\'s question is first, then the older, then the one with only pencil', same(list.map(r => r.id), [B, A, C]), JSON.stringify(list.map(r => r.id)));
    const info = await page.evaluate(([a, b, c]) => [a, b, c].map(id => ({ id, ch: QBYID[id].ch, n: QBYID[id].n, s: QBYID[id].s })), [A, B, C]);
    const at = id => list.find(r => r.id === id) || {}, meta = id => info.find(i => i.id === id);
    ok('a note\'s text is shown as it was typed', at(A).note === 'Class I for sotalol? check the QT' && at(B).note === 'Avoid beta blockers in cocaine chest pain · second note on this one', JSON.stringify([at(A).note, at(B).note]));
    ok('a question with only pencil says so instead of showing nothing', at(C).none && /Pencil marks, no words/.test(at(C).note), at(C).note);
    ok('each row names its chapter and question number', list.every(r => r.top.indexOf(meta(r.id).ch + ' · ' + meta(r.id).n) >= 0), JSON.stringify(list.map(r => r.top)));
    ok('each row shows the question\'s stem, so the note is not out of context', list.every(r => meta(r.id).s.indexOf(r.stem.replace(/…$/, '').slice(0, 30)) === 0), JSON.stringify(list.map(r => r.stem.slice(0, 30))));
    ok('a row says what the question is marked with: flagged, previously missed, how many notes, pencil', /flagged/.test(at(A).top) && !/flagged/.test(at(B).top) && /previously missed/.test(at(B).top) && /2 notes/.test(at(B).top) && /note/.test(at(A).top) && /pencil/.test(at(C).top), JSON.stringify(list.map(r => r.top)));
    const head0 = await page.evaluate(() => ({ count: document.getElementById('annoCount').textContent, practise: document.getElementById('annoPractise').textContent.trim(), dis: document.getElementById('annoPractise').disabled,
      label: document.getElementById('annoQ').getAttribute('aria-label'), type: document.getElementById('annoQ').type, h: document.getElementById('annoPractise').offsetHeight, hq: document.getElementById('annoQ').offsetHeight,
      hb: document.querySelector('.anno-wrap .sb-back').offsetHeight }));
    ok('it counts them, and offers to practise all three', /^3 questions with a sticky note or pencil marks$/.test(head0.count) && head0.practise === 'Practise these 3' && head0.dis === false, JSON.stringify(head0));
    ok('the count is a status, so a screen reader hears it change as the list narrows', await page.evaluate(() => document.getElementById('annoCount').getAttribute('role')) === 'status');
    ok('the box is a search box with a name, and the box and the buttons are at least 44 px tall', head0.type === 'search' && /annotations/i.test(head0.label) && head0.h >= 44 && head0.hq >= 44 && head0.hb >= 44, JSON.stringify(head0));

    /* typing narrows the list in place */
    await page.evaluate(() => { window.__box = document.getElementById('annoQ'); window.__list = document.getElementById('annoList'); });
    await page.focus('#annoQ'); await page.keyboard.type('SOTALOL');
    const f1 = await page.evaluate(() => ({ ids: [...document.querySelectorAll('#annoList .anno-row')].map(r => r.dataset.anno), count: document.getElementById('annoCount').textContent,
      practise: document.getElementById('annoPractise').textContent.trim(), sameBox: document.getElementById('annoQ') === window.__box, focus: document.activeElement === window.__box,
      sameList: document.getElementById('annoList') === window.__list, marks: [...document.querySelectorAll('#annoList mark')].map(m => m.textContent.toLowerCase()) }));
    ok('typing a word of a note, in any case, leaves the one question that has it', same(f1.ids, [A]), JSON.stringify(f1.ids));
    ok('and says "1 of 3 match", and offers to practise that one', f1.count === '1 of 3 match' && f1.practise === 'Practise these 1', JSON.stringify([f1.count, f1.practise]));
    ok('the list was repainted and the screen was not: the same box, the keyboard still in it', f1.sameBox && f1.focus && f1.sameList, JSON.stringify([f1.sameBox, f1.focus, f1.sameList]));
    ok('the word typed is marked where it is found', f1.marks.includes('sotalol'), JSON.stringify(f1.marks));
    await page.fill('#annoQ', info.find(i => i.id === B).ch);
    const f2 = await page.evaluate(() => [...document.querySelectorAll('#annoList .anno-row')].map(r => r.dataset.anno));
    ok('typing a chapter\'s name finds the annotated questions in it', f2.includes(B) && f2.every(id => info.filter(i => i.ch === info.find(x => x.id === B).ch).map(i => i.id).includes(id)), JSON.stringify(f2));
    await page.fill('#annoQ', trio ? trio.words[1] : 'zzzz');
    const f3 = await page.evaluate(() => [...document.querySelectorAll('#annoList .anno-row')].map(r => r.dataset.anno));
    ok('typing a word that is only in a question\'s stem finds that question', same(f3, [B]), JSON.stringify([trio && trio.words[1], f3]));
    await page.fill('#annoQ', 'sotalol cocaine');
    const f4 = await page.evaluate(() => ({ n: document.querySelectorAll('#annoList .anno-row').length, text: document.getElementById('annoList').textContent.trim(), count: document.getElementById('annoCount').textContent,
      dis: document.getElementById('annoPractise').disabled, practise: document.getElementById('annoPractise').textContent.trim() }));
    ok('two words that are in different notes find neither: every word has to be there', f4.n === 0 && /Nothing matched/.test(f4.text) && f4.count === '0 of 3 match', JSON.stringify(f4));
    ok('and with nothing to show, Practise is switched off', f4.dis === true && f4.practise === 'Practise these 0', JSON.stringify(f4));
    await page.fill('#annoQ', '');
    const f5 = await page.evaluate(() => ({ ids: [...document.querySelectorAll('#annoList .anno-row')].map(r => r.dataset.anno), count: document.getElementById('annoCount').textContent, dis: document.getElementById('annoPractise').disabled }));
    ok('clearing the box brings all three back', same(f5.ids, [B, A, C]) && /^3 questions/.test(f5.count) && f5.dis === false, JSON.stringify(f5));

    /* practise */
    await page.fill('#annoQ', 'cocaine');
    await page.click('#annoPractise');
    const pr = await reached('quiz') && await drawn('#qFlag');
    const pd = await page.evaluate(() => ({ ids: S.questions.map(q => q.id), mode: S.mode, toast: (document.getElementById('toast') || {}).textContent }));
    ok('Practise deals the questions the list was showing, and only those', pr && same(pd.ids, [B]) && pd.mode === 'pick', JSON.stringify(pd));
    ok('and says how many it dealt', /1 question\./.test(pd.toast || ''), pd.toast);
    await page.evaluate(() => goAnnotations()); await reached('annotations'); await drawn('#annoList .anno-row'); await settle();
    await page.click('#annoPractise');
    ok('with nothing typed, Practise deals all three', await reached('quiz') && await page.evaluate(() => S.questions.length) === 3);

    /* opening a row */
    await page.evaluate(() => goAnnotations()); await reached('annotations'); await drawn('#annoList .anno-row'); await settle();
    await page.click('.anno-row[data-anno="' + A + '"]');
    const op = await showing(A);
    const noteUp = await drawn('.note-layer .sticky textarea');
    const opened = await page.evaluate(() => ({ id: S.questions[S.qIdx].id, n: S.questions.length, note: (document.querySelector('.note-layer .sticky textarea') || {}).value }));
    ok('a row opens its question', op && opened.id === A && opened.n === 1, JSON.stringify(opened));
    ok('with its note on it, as it was written', noteUp && opened.note === 'Class I for sotalol? check the QT', JSON.stringify(opened));
  }
  {
    /* a note is text */
    await fresh();
    const evil = '<img src=x onerror="window.__xss=1"> & <b>bold</b> <script>window.__xss=2<\/script>';
    await page.evaluate(([a, evil]) => { NOTES[a] = [{ id: 'n' + Date.now().toString(36), x: .1, y: .1, text: evil, color: '' }]; saveJSON(NOTE_KEY, NOTES); goAnnotations(); }, [A, evil]);
    await reached('annotations'); await drawn('#annoList .anno-row'); await settle();
    await page.fill('#annoQ', 'bold');
    await page.waitForTimeout(150);
    const x = await page.evaluate(() => ({ text: document.querySelector('.anno-text').textContent, kids: document.querySelectorAll('#annoList .anno-text img, #annoList .anno-text script').length,
      bold: document.querySelectorAll('#annoList .anno-text b').length, xss: window.__xss === undefined }));
    ok('a note with markup in it is shown as the characters it is, and runs nothing', x.text === evil && x.kids === 0 && x.xss, JSON.stringify({ kids: x.kids, xss: x.xss, text: x.text.slice(0, 40) }));
    ok('typing a word of it marks the word and still makes no markup of the note', x.bold <= 1 && x.kids === 0, JSON.stringify(x.bold));
    const amp = 'Ampicillin & gentamicin "quoted" it\'s 39 mg';
    await page.evaluate(([a, amp]) => { NOTES[a] = [{ id: 'n' + Date.now().toString(36), x: .1, y: .1, text: amp, color: '' }]; saveJSON(NOTE_KEY, NOTES); goAnnotations(); }, [A, amp]);
    await drawn('#annoList .anno-row'); await settle();
    const marks = async q => { await page.fill('#annoQ', q); return page.evaluate(() => ({ text: document.querySelector('.anno-text').textContent, marks: [...document.querySelectorAll('#annoList .anno-text mark')].map(m => m.textContent) })); };
    const m1 = await marks('amp'), m2 = await marks('quot'), m3 = await marks('39');
    ok('a note with an ampersand is not harmed by a search for "amp": the word is marked where it is written and the text is as typed', same(m1.marks, ['Amp']) && m1.text === amp, JSON.stringify(m1));
    ok('nor by one for "quot", which is also the name of the entity of a quote', same(m2.marks, ['quot']) && m2.text === amp, JSON.stringify(m2));
    ok('nor an apostrophe by "39", the number in its entity: the 39 that is written is marked, the one in the entity is not there to mark', same(m3.marks, ['39']) && m3.text === amp, JSON.stringify(m3));
    const raw = { s: 'Stem with <b>markup</b> & <i>amp</i> text', ch: 'Chapter <u>x</u> & y' };
    await page.evaluate(([a, raw]) => { const q = QBYID[a]; window.__was = { s: q.s, ch: q.ch }; q.s = raw.s; q.ch = raw.ch; ANNO.q = ''; goAnnotations(); }, [A, raw]);
    await drawn('#annoList .anno-row'); await settle();
    const y = await page.evaluate(() => ({ stem: document.querySelector('.anno-stem').textContent, top: document.querySelector('.hit-ch').textContent,
      tags: document.querySelectorAll('#annoList .anno-stem b, #annoList .anno-stem i, #annoList .hit-ch u').length }));
    await page.fill('#annoQ', 'amp');
    const ys = await page.evaluate(() => ({ stem: document.querySelector('.anno-stem').textContent, marks: [...document.querySelectorAll('#annoList .anno-stem mark')].map(m => m.textContent) }));
    await page.evaluate(a => { QBYID[a].s = window.__was.s; QBYID[a].ch = window.__was.ch; }, A);
    ok('a stem and a chapter\'s name with markup characters in them are shown as the characters they are', y.stem === raw.s && y.top.indexOf(raw.ch) === 0 && y.tags === 0, JSON.stringify(y));
    ok('and a word searched for is marked in a stem that holds an ampersand where it is written, not in the ampersand\'s entity', same(ys.marks, ['amp']) && ys.stem === raw.s, JSON.stringify(ys));
    await fresh();
    await page.evaluate(() => goAnnotations()); await reached('annotations'); await settle();
    const empty = await page.evaluate(() => ({ rows: document.querySelectorAll('#annoList .anno-row').length, text: document.getElementById('annoList').textContent.trim(), count: document.getElementById('annoCount').textContent, dis: document.getElementById('annoPractise').disabled }));
    ok('with nothing written anywhere the screen says so, and how to begin, and Practise is switched off', empty.rows === 0 && /Nothing is written on any question yet/.test(empty.text) && /sticky note/.test(empty.text) && empty.dis === true && /Nothing is written/.test(empty.count), JSON.stringify(empty));
    await page.click('.sb-back');
    ok('the way back goes to the Study screen', await reached('study'));
  }

  head('a mock block\'s flags');
  {
    const runBlock = async (ids, steps) => {
      await fresh();
      await page.evaluate(([p]) => { S.flagged = new Set([p]); save(); }, [D]);
      await page.evaluate(ids => { const real = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = 0; _mockCfg.n = 20; _mockCfg.ch = ''; try { startMock(); } finally { MockExam.build = real; } mockStopTicker(); }, ids);
      await reached('mock');
      await page.evaluate(steps => steps.forEach(s => { MockExam.go(S.mock, s.i); if (s.pick != null) mockPick(s.pick); if (s.flag) mockFlag(); }), steps);
    };
    const right = id => page.evaluate(id => QBYID[id].ci, id);
    const [q0, q1, q2, q3, q4, q5] = all.filter(id => id !== D).slice(0, 6);
    await runBlock([q0, q1, q2, q3, q4, q5], [
      { i: 0, pick: await right(q0) }, { i: 1, pick: await right(q1), flag: true }, { i: 2, flag: true }, { i: 2, flag: true },
      { i: 3, pick: await right(q3), flag: true }, { i: 4, flag: true }, { i: 5, pick: await right(q5) },
    ]);
    const during = await page.evaluate(() => ({ flagged: [...S.flagged], block: Object.keys(S.mock.flag).map(Number) }));
    ok('inside a block, the flags are the block\'s own: the Flagged list is as it was', same(during.flagged, [D]), JSON.stringify(during));
    ok('and the block holds three flags: one set and taken off again is not among them', same(during.block, [1, 3, 4]), JSON.stringify(during.block));
    await page.evaluate(() => mockSubmit());
    const done = await reached('mockreport') && await drawn('.mock-report');
    await settle();
    const after = await page.evaluate(() => ({ flagged: [...S.flagged], saved: JSON.parse(localStorage.getItem('accsap12.v2')).flagged, line: [...document.querySelectorAll('.mock-slow')].map(x => x.textContent.trim()) }));
    ok('the block is handed in and its report is up', done);
    ok('handing in adds the block\'s flagged questions to the Flagged list, a blank one too, and keeps what was there', same(after.flagged, [D, q1, q3, q4]), JSON.stringify(after.flagged));
    ok('a question answered and not flagged, and one flagged and unflagged, are not added', !after.flagged.includes(q0) && !after.flagged.includes(q2) && !after.flagged.includes(q5));
    ok('and they are in the saved record', same(after.saved, [D, q1, q3, q4]), JSON.stringify(after.saved));
    ok('the report says how many of the three flagged are in the Flagged list: all three', after.line.some(t => /3 flagged/.test(t) && /In your Flagged list: 3 of 3\./.test(t)), JSON.stringify(after.line));
    await page.evaluate(() => mockReview('all'));
    const rev = await reached('quiz') && await showing(q0); await settle();
    const r0 = await flagRead();
    ok('in the review of the block, a question that was not flagged shows the Flag button off', rev && r0.id === q0 && r0.pressed === 'false' && !r0.badge, JSON.stringify(r0));
    await page.evaluate(() => nextQ());
    await showing(q1); await settle();
    const r1 = await flagRead();
    ok('and a question flagged in the block shows it on: the button pressed and the badge up', r1.id === q1 && r1.pressed === 'true' && r1.badge && r1.inSet, JSON.stringify(r1));
    await page.keyboard.press('f');
    const un = await flagRead();
    ok('a carried flag is taken off there as any flag is, and the other carried flags stay', !un.inSet && un.size === 3 && same(await page.evaluate(() => [...S.flagged]), [D, q3, q4]), JSON.stringify(un));
    const reportLine = async () => { await page.evaluate(() => openMockReport()); await reached('mockreport'); await drawn('.mock-report'); await settle(); return page.evaluate(() => [...document.querySelectorAll('.mock-slow')].map(x => x.textContent.trim()).join(' | ')); };
    const l2 = await reportLine();
    ok('the report, opened again, says how many are in the list now: two of the three', /3 flagged/.test(l2) && /In your Flagged list: 2 of 3\./.test(l2), l2);
    await page.evaluate(() => { S.flagged = new Set(); save(); });
    const l0 = await reportLine();
    ok('and with every flag gone, none of the three: it does not say they were added', /In your Flagged list: 0 of 3\./.test(l0) && !/Added/.test(l0), l0);
    await page.evaluate(([a, b]) => { S.flagged = new Set([a]); save(); }, [q1, q3]);
    ok('and with one of them flagged again, one of the three', /In your Flagged list: 1 of 3\./.test(await reportLine()));
  }
  {
    /* a block with no flag adds none, and says nothing of it; one thrown away adds none */
    const [q0, q1, q2, q3] = all.filter(id => id !== D).slice(0, 4);
    await fresh();
    await page.evaluate(ids => { const real = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = 0; _mockCfg.n = 20; _mockCfg.ch = ''; try { startMock(); } finally { MockExam.build = real; } mockStopTicker(); }, [q0, q1, q2, q3]);
    await reached('mock');
    await page.evaluate(() => { MockExam.go(S.mock, 0); mockPick(0); MockExam.go(S.mock, 1); mockPick(1); mockSubmit(); });
    await reached('mockreport'); await drawn('.mock-report'); await settle();
    const none = await page.evaluate(() => ({ flagged: S.flagged.size, said: /Flagged list/.test(document.querySelector('.mock-report').textContent) }));
    ok('a block with nothing flagged adds nothing, and the report says nothing of a Flagged list', none.flagged === 0 && none.said === false, JSON.stringify(none));
    await fresh();
    await page.evaluate(ids => { const real = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = 0; _mockCfg.n = 20; _mockCfg.ch = ''; try { startMock(); } finally { MockExam.build = real; } mockStopTicker(); }, [q0, q1, q2, q3]);
    await reached('mock');
    await page.evaluate(() => { MockExam.go(S.mock, 0); mockFlag(); MockExam.go(S.mock, 2); mockFlag(); goSessions(); });
    await onScreen(page, 'sessions', { marker: '#mockDiscard' }); await settle();
    await page.click('#mockDiscard'); await drawn('#mockDiscard.arm'); await page.click('#mockDiscard');
    await page.waitForFunction(() => !S.mock, null, { timeout: 4000 }).catch(() => {});
    const thrown = await page.evaluate(() => ({ block: !!S.mock, flagged: S.flagged.size, saved: (JSON.parse(localStorage.getItem('accsap12.v2')).flagged || []).length }));
    ok('a block thrown away adds none of its flags', thrown.block === false && thrown.flagged === 0 && thrown.saved === 0, JSON.stringify(thrown));
  }

  head('a search hit says it is flagged');
  {
    await fresh();
    /* Make the search evidence independent of the installed bank and note
       corpus. Keep the real questions/ids and real index; restore their stems
       afterward without sending any private text out of the browser. */
    await page.evaluate(ids => {
      window.__flagSearchOriginal = ids.map(id => ({ q: QBYID[id], stem: QBYID[id].s }));
      window.__flagSearchOriginal.forEach((x, i) => { x.q.s = 'systoleflagfixture public search example ' + i; });
      invalidateIndex(); SQ.ch = ''; searchGo('systoleflagfixture');
    }, [A, B]);
    try {
      await reached('search'); await drawn('.hit'); await settle();
      const hits = await page.evaluate(() => SQ.hits.map(h => h.q.id));
      ok('the search has hits to look at', hits.length >= 2, String(hits.length));
      await page.evaluate(id => { S.flagged = new Set([id]); searchGo('systoleflagfixture'); }, hits[0]);
      await drawn('.hit-flag.flagged'); await settle();
      const r = await page.evaluate(() => ({ badges: [...document.querySelectorAll('.hit')].map(h => [h.getAttribute('onclick'), !!h.querySelector('.hit-flag.flagged')]) }));
      const flaggedRows = r.badges.filter(b => b[1]);
      ok('exactly the flagged hit carries the badge', flaggedRows.length === 1 && flaggedRows[0][0].indexOf(hits[0]) >= 0, JSON.stringify(flaggedRows));
      ok('and it says "flagged"', await page.evaluate(() => document.querySelector('.hit-flag.flagged')?.textContent.trim()) === 'flagged');
      const amber = await tokenColor('amber-ink'), red = await tokenColor('red-ink');
      const hc = await page.evaluate(() => { const badge = document.querySelector('.hit-flag.flagged'); return badge ? getComputedStyle(badge).color : null; });
      ok('and it is amber, which is not the red of "previously missed"', hc === amber && hc !== red, JSON.stringify([hc, amber, red]));
    } finally {
      await page.evaluate(() => {
        (window.__flagSearchOriginal || []).forEach(x => { x.q.s = x.stem; });
        delete window.__flagSearchOriginal; invalidateIndex();
      });
    }
  }

  head('the quiz\'s row of buttons, from a phone to an iPad');
  {
    await fresh();
    const widths = [[320, 640], [360, 780], [390, 844], [834, 1194]];
    const rows = [];
    for (const [w, h] of widths) {
      await resized(page, w, h);
      await page.evaluate(([a, b]) => { startAdhocQuiz([QBYID[a], QBYID[b]], null); }, [A, B]);
      await showing(A); await settle();
      await page.evaluate(() => nextQ());
      await showing(B); await settle();
      await page.evaluate(() => selectOpt(0));
      await page.waitForSelector('.btn-next', { timeout: 4000 }).catch(() => {});
      /* The Next button's entrance scales it, and a rectangle read mid-way is not its size: wait for the finite animations. */
      await page.waitForFunction(() => document.getAnimations().every(a => !(a.effect && Number.isFinite(a.effect.getTiming().iterations)) || a.playState !== 'running'), null, { timeout: 8000 }).catch(() => {});
      rows.push(await page.evaluate(w => {
        const vw = document.documentElement.clientWidth;
        const btns = [...document.querySelectorAll('.actions .btn')].map(b => { const r = b.getBoundingClientRect(); return { cls: b.className.replace(/ ?anim-pop/, ''), l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
        const word = document.querySelector('.btn-flag-l').getBoundingClientRect();
        return { w, vw, btns, wordW: Math.round(word.width), wordH: Math.round(word.height), wordText: document.querySelector('.btn-flag-l').textContent, flag: btns.find(b => /btn-flag/.test(b.cls)) };
      }, w));
    }
    for (const r of rows) {
      ok(`${r.w} px: every button in the row is on the screen, none cut off at either edge`, r.btns.length === 4 && r.btns.every(b => b.l >= 0 && b.r <= r.vw), JSON.stringify(r.btns.map(b => [b.cls.split(' ')[1], b.l, b.r])));
      ok(`${r.w} px: the Flag button is at least 44 px each way`, r.flag && r.flag.w >= 44 && r.flag.h >= 44, JSON.stringify(r.flag));
    }
    const phone = rows.filter(r => r.w <= 480), pad = rows.find(r => r.w === 834);
    ok('on a phone the word Flag is hidden from the eye (a pixel) and kept for a screen reader', phone.every(r => r.wordW <= 1 && r.wordH <= 1 && r.wordText === 'Flag'), JSON.stringify(phone.map(r => [r.w, r.wordW, r.wordText])));
    ok('on an iPad the word is there to read', pad.wordW > 10 && pad.wordText === 'Flag', JSON.stringify([pad.wordW, pad.wordText]));
    const narrow = rows.find(r => r.w === 320);
    ok('where the four do not fit a row, Next goes to a line of its own and fills it, rather than running off the screen', narrow.btns.find(b => /btn-next/.test(b.cls)).t > narrow.flag.t && narrow.btns.find(b => /btn-next/.test(b.cls)).w >= 250, JSON.stringify(narrow.btns.map(b => [b.cls.split(' ')[1], b.t, b.w])));
    const mid = rows.find(r => r.w === 360);
    ok('at 360 px the four fit one row', new Set(mid.btns.map(b => b.t)).size <= 2 && Math.abs(mid.btns.find(b => /btn-next/.test(b.cls)).t - mid.flag.t) <= 3, JSON.stringify(mid.btns.map(b => [b.cls.split(' ')[1], b.t])));
    await resized(page, 834, 1194);
  }

  head('nothing threw, and no dialog opened');
  ok('no page error', errors.length === 0, errors.join(' | '));
  ok('no native dialog was opened by any of it', dialogs.filter(m => !/^Reset all scores/.test(m)).length === 0, dialogs.join(' | '));

  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
