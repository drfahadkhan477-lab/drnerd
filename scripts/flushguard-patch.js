#!/usr/bin/env node
/*
 * The last chunk is painted however the stream ends.
 *
 *   node scripts/flushguard-patch.js <in.html> <out.html>
 *
 * FOUND BY AN INDEPENDENT REVIEW, and confirmed here before acting on it.
 *
 * makeStreamPainter exists for one stated reason — so that "the very last
 * chunk is never left unpainted waiting on a frame that may not come."
 * streamthrottle put the flush() after the read loop, which honours that on
 * the one path where the loop ends normally and on no other:
 *
 *   · the user taps stop, aiAbort fires, and the in-flight rd.read() REJECTS;
 *   · the provider sends an error mid-stream and the loop throws.
 *
 * Either way the exception leaves the function past the flush. Verified on the
 * built app rather than inferred: oneTurnGemini contains no try/finally and
 * exactly one painter.flush(), sitting after the loop's closing brace.
 *
 * WHY IT IS WORTH FIXING EVEN THOUGH NOTHING VISIBLY BREAKS TODAY. The review
 * traced the callers and was right about the consequence: on abort,
 * streamReply pushes no partial turn, so the next repaint shows the thread as
 * it stood and the unpainted fragment simply is not there to be missing; on a
 * mid-stream error only err.message is pushed, and the accumulated text is a
 * local the catch cannot reach. So this is a gap against the module's own
 * documented invariant, not a bug a fellow can see.
 *
 * It stops being invisible the moment the error path changes. "Show what Apex
 * got out before it failed, then note the failure" is an obvious improvement
 * to exactly this UI, and on the day someone makes it the missing flush turns
 * into a truncated answer. try/finally costs two lines and removes the trap
 * rather than leaving it armed.
 *
 * ONE CALL SITE, NOT TWO. The review found this in both oneTurnMistral and
 * oneTurnGemini. The second provider has since been removed (see
 * onetutor-patch.js, which runs before this), so there is one loop left and
 * the guard below asserts exactly that rather than trusting it.
 *
 * ALSO HERE, from the same review: the bootloader's app.js-load-failure path
 * called fail() without returning, so it went on to register a service worker
 * for an application that never started. That one is in build-pwa.js, which
 * owns index.html for the split build — not in this file, because the
 * single-file build has no bootloader and no service worker at all.
 *
 * AND THE STOP THAT COULD NOT BE TAPPED — found while proving the above, not
 * by reading it. tests/verify-flushguard.js drives the abort path through the
 * app's own control, and the click did nothing: the composer renders
 *
 *     <button class="ai-send" id="aiSend" ${aiBusy?'disabled':''}>${aiBusy?'■':…}
 *
 * so the button shows a stop square exactly when it is disabled, and the
 * branch behind it — `if(aiBusy){ if(aiAbort)aiAbort.abort(); }` — is the only
 * caller of abort() in the whole app. A reply that has started cannot be
 * stopped: you wait it out, or you leave the question. The disabled attribute
 * goes, the two states get their own label and title, and the abort path stops
 * being decoration. It belongs in this step rather than its own because a
 * guard on a way out that nothing can take is not worth much.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/flushguard-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* The loop is entered inside a try. Nothing else about it changes — the body,
   the breaks and the throws are all untouched — so this is purely a question
   of where control lands on the way out. */
patch('flushguard: the streamed turn enters its loop inside a try',
`  const painter=makeStreamPainter(live,body,()=>text);
  while(true){
    const {done,value}=await rd.read(); if(done)break;`,
`  const painter=makeStreamPainter(live,body,()=>text);
  try{
  while(true){
    const {done,value}=await rd.read(); if(done)break;`);

patch('flushguard: and flushes on every way out of it, not just the tidy one',
`  painter.flush();
  const calls=raw.filter(p=>p.functionCall).map(p=>({`,
`  } finally { painter.flush(); }
  const calls=raw.filter(p=>p.functionCall).map(p=>({`);

/* ── the stop button, which was disabled exactly when it was the stop button ── */
/* Only the attribute and the labels change. The handler was always correct and
   is not touched, because the bug was never in what stop does — it was that
   nothing could ask for it. title carries the pointer hint, aria-label carries
   the name for anyone not looking at a ■, and type="button" stops a composer
   that later grows a <form> around it from submitting instead of stopping. */
patch('flushguard: the stop button can be tapped while there is something to stop',
`       <button class="ai-send" id="aiSend" \${aiBusy?'disabled':''}>\${aiBusy?'■':icon('send','icon-sm')}</button>`,
`       <button class="ai-send\${aiBusy?' stopping':''}" id="aiSend" type="button"
         title="\${aiBusy?'Stop':'Send'}" aria-label="\${aiBusy?'Stop generating':'Send'}"
         >\${aiBusy?'■':icon('send','icon-sm')}</button>`);

/* The dimming came free with :disabled and has to be said out loud now that the
   button is live. A stop control should not look like the send control it
   replaced, and should not look switched off either. */
patch('flushguard: and it looks like a live control rather than a greyed one',
`.ai-send:disabled{opacity:.4}`,
`.ai-send:disabled{opacity:.4}
.ai-send.stopping{background:var(--danger)}`);

/* ── the guards ─────────────────────────────────────────────────────────── */
/* A second streaming turn would need its own try/finally, and would otherwise
   reintroduce exactly the gap this step closes — silently, because the
   existing flush would still be there to read. */
const loops = (html.match(/const painter=makeStreamPainter\(/g) || []).length;
if (loops !== 1) {
  throw new Error(`flushguard: expected exactly 1 streaming turn to guard, found ${loops}.\n`
    + '  A new provider brings its own read loop and needs its own try/finally.');
}
if ((html.match(/\} finally \{ painter\.flush\(\); \}/g) || []).length !== 1) {
  throw new Error('flushguard: the finally did not reach the build');
}
if (/^\s*painter\.flush\(\);\s*$/m.test(html)) {
  throw new Error('flushguard: a bare painter.flush() survives — some path still flushes only on success');
}
/* The stop button's disabled attribute, specifically — the app has other
   disabled buttons and they are none of this step's business. */
if (/id="aiSend"[^>]*disabled/.test(html)) {
  throw new Error('flushguard: the stop button is still rendered disabled');
}
if ((html.match(/aria-label="\$\{aiBusy\?'Stop generating':'Send'\}"/g) || []).length !== 1) {
  throw new Error('flushguard: the stop button did not get its two names');
}
applied.push('flushguard: one streaming turn, one finally, no bare flush left, one tappable stop');

fs.writeFileSync(OUT, html);
console.log(`Flush guard applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
