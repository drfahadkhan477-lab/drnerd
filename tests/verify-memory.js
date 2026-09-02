#!/usr/bin/env node
/*
 * Behavioural checks for durable memory.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-memory.js /path/to/patched.html
 *
 * The claim this suite defends: Apex still knows you next time. That breaks in
 * quiet ways — a store that saves but is never sent, a block that reaches one
 * provider and not another, a grounded mode that silently drops it, a summariser
 * that fires once per question instead of once per sitting and burns the free
 * tier. So the important checks here intercept the real outbound request and
 * read the body, the same discipline verify-stage3 and verify-gemini use for
 * vision: state that looks right in localStorage proves nothing about what the
 * model was actually told.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-memory.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const flat = t => String(t || '').replace(/\s+/g, ' ');

const SSE = [
  'data: {"choices":[{"delta":{"content":"Noted."}}]}',
  'data: [DONE]',
  '',
].join('\n\n');

const GEM_SSE = 'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Noted."}]}}]}\n\n';

/* What the summariser's one-shot call returns. Three lines plus a blank and a
   bullet, because a model will not reliably hand back clean output. */
const SUMMARY = 'Sits the boards in October 2026.\n- Confuses constriction with restriction.\n\nPrefers mechanism before trials.';

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  const mist = [], gem = [];
  await page.route('**/v1/chat/completions', route => {
    let b = null; try { b = JSON.parse(route.request().postData() || '{}'); } catch (_) {}
    mist.push(b);
    /* The summariser is the only non-streaming Mistral call this app makes. */
    if (b && !b.stream) {
      route.fulfill({ status: 200, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: SUMMARY } }] }) });
      return;
    }
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: SSE });
  });
  await page.route('**/generativelanguage.googleapis.com/**', route => {
    const url = route.request().url();
    let b = null; try { b = JSON.parse(route.request().postData() || '{}'); } catch (_) {}
    gem.push({ url, body: b });
    if (/\/v1beta\/models(\?|$)/.test(url)) {
      route.fulfill({ status: 200, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ models: [{ name: 'models/gemini-9.9-flash', displayName: 'G',
          supportedGenerationMethods: ['generateContent', 'countTokens'] }] }) });
      return;
    }
    if (/:streamGenerateContent/.test(url)) {
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: GEM_SSE });
      return;
    }
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: SUMMARY }] } }] }) });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(900);

  const seed = () => page.evaluate(() => {
    Memory.clear();
    Memory.add('Sitting the ABIM boards in October 2026.', 'fact');
    Memory.add('Keeps reading constrictive pericarditis as restrictive cardiomyopathy.', 'gap');
    Memory.add('Wants the mechanism before the trial.', 'preference');
  });

  head('the store');
  const store = await page.evaluate(() => {
    Memory.clear();
    const empty = Memory.build();
    const a = Memory.add('Sitting the boards in October 2026.', 'fact');
    const dupe = Memory.add('  sitting THE boards in October 2026!!  ', 'fact');
    const blank = Memory.add('   ', 'fact');
    const bad = Memory.add('Something odd.', 'not-a-kind');
    const b = Memory.add('Second-year fellow.', 'fact');
    const afterAdds = Memory.count();               // a, bad, b — dupe and blank added nothing
    const newest = Memory.all()[0].text;
    const removed = Memory.remove(b.id);
    const afterRemove = Memory.count();
    return { empty, count: afterAdds, dupeSame: dupe && dupe.id === a.id,
             blank, badKind: bad && bad.kind, newest,
             removed, afterRemove, removeMissing: Memory.remove('nope') };
  });
  ok('an empty store contributes nothing to the prompt', store.empty === '', JSON.stringify(store.empty));
  ok('the same thing said twice is one memory, not two',
     store.dupeSame && store.count === 3, 'same record: ' + store.dupeSame + ', count ' + store.count);
  ok('an empty memory is refused', store.blank === null);
  ok('an unknown kind falls back to fact rather than creating a new bucket', store.badKind === 'fact', store.badKind);
  ok('newest is first even within the same millisecond', store.newest === 'Second-year fellow.', store.newest);
  ok('remove works', store.removed === true && store.afterRemove === 2, 'left ' + store.afterRemove);
  ok('removing something absent reports false rather than throwing', store.removeMissing === false);

  head('the cap decays session summaries first');
  const capped = await page.evaluate(() => {
    Memory.clear();
    const keep = Memory.add('Sits boards in October.', 'fact');
    for (let i = 0; i < Memory.MAX + 20; i++) Memory.add('Session note number ' + i + '.', 'session');
    return { count: Memory.count(), max: Memory.MAX,
             keptTheFact: Memory.all().some(m => m.id === keep.id),
             oldestSessionGone: !Memory.all().some(m => m.text === 'Session note number 0.'),
             newestSessionKept: Memory.all().some(m => m.text === 'Session note number ' + (Memory.MAX + 19) + '.') };
  });
  ok('the store stays at its cap', capped.count === capped.max, capped.count + '/' + capped.max);
  ok('a fact the fellow shaped survives a flood of auto-summaries', capped.keptTheFact);
  ok('the oldest session summary is what gets dropped', capped.oldestSessionGone);
  ok('the newest session summary is kept', capped.newestSessionKept);

  head('the block itself');
  await seed();
  const block = await page.evaluate(() => Memory.build());
  ok('it is headed so the model knows what it is', /WHAT YOU ALREADY KNOW ABOUT THIS FELLOW/.test(block));
  ok('it tells the model not to recite it back', /do not recite it back/i.test(block));
  ok('every line carries an id the forget tool can name', (block.match(/\[m[a-z0-9]+\]/g) || []).length === 3,
     JSON.stringify((block.match(/\[m[a-z0-9]+\]/g) || [])));
  ok('the kinds are grouped, not run together', /About them:/.test(block) && /How they want to be taught:/.test(block));
  ok('it stays within a sane prompt budget', block.length < 1600, block.length + ' chars');

  head('it survives a reload — the whole point');
  await page.reload({ waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && typeof Memory !== 'undefined', { timeout: 120000 });
  await page.waitForTimeout(600);
  const survived = await page.evaluate(() => ({ n: Memory.count(), has: /October 2026/.test(Memory.build()) }));
  ok('memories are still there after a reload', survived.n === 3 && survived.has, 'count ' + survived.n);

  const ask = async (provider) => {
    mist.length = 0; gem.length = 0;
    await page.evaluate(async (provider) => {
      AI.provider = provider;
      AI.mistral = { key: 'test-mistral-key', model: 'pixtral-large-latest' };
      AI.gemini = { key: 'AQ.test', model: 'gemini-9.9-flash' };
      const q = ALL_Q.find(x => !x.bad);
      jumpTo(q.id);
      const sh = document.getElementById('shell');
      if (!sh.classList.contains('ai-open')) toggleAI();
      buildAI();
      fire('why is this the answer?');
    }, provider);
    await page.waitForTimeout(1500);
    return provider === 'mistral' ? mist.find(Boolean)
      : (gem.find(g => /:streamGenerateContent/.test(g.url)) || {}).body;
  };

  head('it actually reaches the model — Mistral');
  const aReq = await ask('mistral');
  const aSys = flat((aReq && aReq.messages || []).find(m => m.role === 'system')?.content || '');
  ok('a request was made', !!aReq);
  ok('the memory block is in the system prompt', /WHAT YOU ALREADY KNOW ABOUT THIS FELLOW/.test(aSys));
  ok('the actual memory text is there, not just the heading', /boards in October 2026/.test(aSys));

  head('it actually reaches the model — Gemini, with no per-provider code');
  const gReq = await ask('gemini');
  const gSys = flat(((gReq && gReq.systemInstruction || {}).parts || []).map(p => p.text || '').join('\n'));
  ok('a request was made', !!gReq);
  ok('the memory block is in the systemInstruction', /WHAT YOU ALREADY KNOW ABOUT THIS FELLOW/.test(gSys));
  ok('the actual memory text is there', /boards in October 2026/.test(gSys));

  head('grounded mode keeps it — it is who you teach, not what you teach from');
  mist.length = 0;
  await page.evaluate(async () => {
    AI.provider = 'mistral';
    AI_GROUNDED = true;
    const q = ALL_Q.find(x => !x.bad);
    jumpTo(q.id); buildAI();
    fire('what do my notes say?');
  });
  await page.waitForTimeout(1500);
  const gReq2 = mist.find(Boolean);
  const gSys2 = flat((gReq2 && gReq2.messages || []).find(m => m.role === 'system')?.content || '');
  ok('grounded mode is genuinely on', /GROUNDED MODE IS ON/.test(gSys2));
  ok('memory is still present in grounded mode', /WHAT YOU ALREADY KNOW ABOUT THIS FELLOW/.test(gSys2));
  ok('and the commentary is still withheld, so grounding was not weakened',
     !/OFFICIAL ACC COMMENTARY/.test(gSys2));
  await page.evaluate(() => { AI_GROUNDED = false; });

  head('the tools');
  const tools = await page.evaluate(() => {
    Memory.clear();
    const declared = TOOLS.filter(t => t.name === 'remember' || t.name === 'forget').map(t => t.name);
    const r = runTool('remember', { text: 'Sits the boards in October.', kind: 'fact' });
    const afterRemember = Memory.count();
    const id = Memory.all()[0].id;
    const f = runTool('forget', { id });
    const afterForget = Memory.count();
    const fMissing = runTool('forget', { id: 'nope' });
    const rEmpty = runTool('remember', { text: '   ' });
    return { declared, saved: /Kept as \[/.test(r.result), count: afterRemember,
             forgot: /Forgotten/.test(f.result), gone: afterForget,
             missingHandled: /No memory has that id/.test(fMissing.result),
             emptyHandled: /Nothing to remember/.test(rEmpty.result),
             labels: [TOOL_LABEL.remember, TOOL_LABEL.forget, TOOL_LABEL.start_review_session] };
  });
  ok('both tools are declared to the model', tools.declared.length === 2, tools.declared.join(', '));
  ok('remember stores, and reports the id back so forget can name it', tools.saved && tools.count === 1);
  ok('forget removes', tools.forgot && tools.gone === 0);
  ok('forgetting something absent does not lie about success', tools.missingHandled);
  ok('remembering nothing is refused rather than stored blank', tools.emptyHandled);
  ok('the tool chips are labelled, including the review session that never was',
     tools.labels.every(Boolean), JSON.stringify(tools.labels));

  head('the panel');
  await seed();
  /* render() runs through startViewTransition when the screen changes, so the
     new DOM is not there on the next line — wait for the cards, not a timer. */
  await page.evaluate(() => goMemory());
  await page.waitForFunction(() => document.querySelectorAll('.ref-card').length > 0, { timeout: 5000 });
  const panel = await page.evaluate(() => ({
    screen: S.screen,
    cards: document.querySelectorAll('.ref-card').length,
    groups: [...document.querySelectorAll('.section-label')].map(x => x.textContent),
    hasForgetAll: /Forget everything/.test(document.body.textContent),
  }));
  ok('it is a screen of its own, like the note library', panel.screen === 'memory');
  ok('every memory is shown', panel.cards === 3, panel.cards + ' cards');
  ok('they are grouped by kind', panel.groups.length === 3, panel.groups.join(' | '));
  ok('there is a way to forget everything', panel.hasForgetAll);

  const before = await page.evaluate(() => {
    window.confirm = () => true;
    const n = Memory.count();
    document.querySelector('.ref-card .chip').click();
    return n;
  });
  await page.waitForFunction(() => document.querySelectorAll('.ref-card').length === 2, { timeout: 5000 })
    .catch(() => {});
  const deleted = await page.evaluate(() => ({
    after: Memory.count(), stillOnScreen: document.querySelectorAll('.ref-card').length }));
  ok('Delete removes one and re-renders', deleted.after === before - 1 && deleted.stillOnScreen === 2,
     `${before} → ${deleted.after}, ${deleted.stillOnScreen} shown`);

  head('the session summariser');
  await page.evaluate(() => {
    Memory.clear();
    AI.provider = 'mistral'; AI_GROUNDED = false;
    S.sessionCorrect = 14; S.sessionTotal = 20;
    sessionSummarised = false;
  });
  mist.length = 0;
  await page.evaluate(() => summariseSession());
  await page.waitForTimeout(900);
  const summ = await page.evaluate(() => ({ n: Memory.count(),
    kinds: [...new Set(Memory.all().map(m => m.kind))],
    texts: Memory.all().map(m => m.text) }));
  const oneShot = mist.filter(b => b && !b.stream);
  ok('exactly one non-streaming call was made', oneShot.length === 1, oneShot.length + ' call(s)');
  ok('it is small — this runs unasked, on a free tier', oneShot[0] && oneShot[0].max_tokens <= 400,
     oneShot[0] && String(oneShot[0].max_tokens));
  ok('it carries no tools, so it cannot wander off', oneShot[0] && !oneShot[0].tools);
  ok('at most three memories are kept from one sitting', summ.n > 0 && summ.n <= 3, String(summ.n));
  ok('they are filed as session summaries', summ.kinds.length === 1 && summ.kinds[0] === 'session', summ.kinds.join(','));
  ok('list punctuation is stripped from the model output',
     summ.texts.every(t => !/^[-•*\d.]/.test(t)), JSON.stringify(summ.texts));

  mist.length = 0;
  await page.evaluate(() => summariseSession());
  await page.waitForTimeout(500);
  ok('it will not fire twice for one sitting', mist.filter(b => b && !b.stream).length === 0);

  const thin = await page.evaluate(async () => {
    Memory.clear();
    CHATS = {}; saveJSON(AI_CHAT, CHATS);
    S.sessionCorrect = 1; S.sessionTotal = 2; sessionSummarised = false;
    await summariseSession();
    return Memory.count();
  });
  ok('a two-question session is not worth an API call', thin === 0, String(thin));

  const survivesError = await page.evaluate(async () => {
    Memory.clear();
    S.sessionCorrect = 9; S.sessionTotal = 12; sessionSummarised = false;
    AI.mistral = { key: '', model: 'pixtral-large-latest' };   // no key → oneShot bails
    let threw = false;
    try { await summariseSession(); } catch (_) { threw = true; }
    AI.mistral = { key: 'test-mistral-key', model: 'pixtral-large-latest' };
    return { threw, n: Memory.count() };
  });
  ok('a summariser that cannot run fails silently rather than breaking the screen',
     !survivesError.threw && survivesError.n === 0);

  head('backup round trip');
  const backup = await page.evaluate(() => {
    Memory.clear();
    Memory.add('Sits the boards in October.', 'fact');
    Memory.add('Mixes up constriction and restriction.', 'gap');
    const exported = { mem: Memory.all() };
    Memory.clear();
    const afterWipe = Memory.count();
    Memory.replaceAll(exported.mem);
    return { afterWipe, restored: Memory.count(), text: Memory.build() };
  });
  ok('memory is wiped by a clear, as expected', backup.afterWipe === 0);
  ok('and comes back from a backup', backup.restored === 2 && /boards in October/.test(backup.text));

  head('regression');
  ok('no console or page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
