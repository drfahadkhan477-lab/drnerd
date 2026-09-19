'use strict';
/*
 * What the page said before the suite died.
 *
 * TWENTY-SIX SUITES COLLECT CONSOLE AND PAGE ERRORS into a local array and
 * assert on it in their LAST check:
 *
 *     ok('no console or page errors across the run', errors.length === 0, …)
 *
 * which is the right check and the wrong place to keep the evidence. A suite
 * that dies never reaches its last check, so everything the browser said on
 * the way out is collected, held, and then thrown away at exactly the moment
 * it is the only thing anybody wants.
 *
 * verify-home.js is why this exists. It dies on WebKit against the served
 * split build with
 *
 *     page.setViewportSize: Target page, context or browser has been closed
 *
 * after 51 checks — a message about the first call made to a page that was
 * already gone, which names the survivor rather than the cause. Its `errors`
 * array at that moment may hold the reason, and until now nothing printed it.
 *
 * WHY A PROCESS HANDLER AND NOT A try/catch. Wrapping each suite's body would
 * re-indent four hundred lines of it, and a diff that large around code nobody
 * is changing is how a real edit gets lost in review. The handler costs two
 * lines at the top of a suite and catches a throw from anywhere inside it.
 *
 * WHAT IT MUST NOT DO is get between the runner and the error. scripts/cause.js
 * reads the tail of a suite's output for the line that killed it, so this
 * prints its heading in the ── form cause.js skips, its diagnostics as plain
 * lines, and the exception LAST and error-shaped — tests/verify-cause-pure.js
 * asserts that a note does not displace the cause.
 */

/* Formatting kept separate from the exiting so it can be tested without one.
   Returns lines; the caller prints them. */
/* The heading, shared rather than spelled twice: scripts/cause.js finds the
   note in a suite's captured output by looking for this exact line, and two
   copies of a string that must match is how they stop matching. */
const HEADING = '── what the page said before the suite died ──';

function deathNote(err, info = {}) {
  const lines = ['', HEADING];
  /* UNCONDITIONAL, both of them. A line that is only printed when its value
     is the right type cannot be distinguished, in the output, from a note that
     was cut short — and a missing line is exactly how the first real note was
     misread. An absent value says "unknown" and stays visible. */
  lines.push(`  last section reached: ${info.section || 'none — it died before the first'}`);
  lines.push(`  checks completed: ${typeof info.checks === 'number' ? info.checks : 'unknown'}`);
  if (info.events) lines.push(`  page events: ${info.events}`);
  const msgs = (info.errors || []).map(m => String(m).split('\n')[0].trim()).filter(Boolean);
  if (!msgs.length) lines.push('  the page logged nothing at all');
  /* Deduped: one broken resource can log the same line on every render, and a
     hundred copies of it buries the one that is different. */
  const seen = new Set();
  for (const m of msgs) {
    if (seen.has(m)) continue;
    seen.add(m);
    if (seen.size > 20) { lines.push(`  … and ${msgs.length - 20} more`); break; }
    lines.push(`  ${m.slice(0, 200)}`);
  }
  return lines;
}

/* Installs the handler. `collect` is called at death, not now, because the
   arrays it reads are still filling up. */
function onDeath(collect) {
  let fired = false;
  const emit = err => {
    if (fired) return;           /* an unhandled rejection often follows a throw */
    fired = true;
    let info = {};
    try { info = collect() || {}; } catch (_) { /* the note must not die too */ }

    /* ONE WRITE, ONE STREAM, and this is not tidiness. scripts/verify.js
       captures a suite with

           ch.stdout.on('data', d => { out += d; });
           ch.stderr.on('data', d => { out += d; });

       — two pipes concatenated into one string, whose relative order nothing
       guarantees. The first version printed the note with console.log and the
       exception with console.error, and in the owner's log the exception
       landed in the MIDDLE of the note:

           88:  last section reached: the dismiss button is never buried …
           89:page.setViewportSize: Target page, context or browser has been closed
           90:    at C:\Users\Fairy\drnerd\tests\verify-home.js:481:18
           91:  checks completed: 51
           92:  the page logged nothing at all

       noteOf() reads the note as a contiguous indented block and stopped at
       line 89, so a complete note reported one line of four — and looked for
       all the world like a note that had been cut off. Two streams is the bug;
       a cleverer reader would only have hidden it.

       Exiting is deferred to the write's callback because stdout to a pipe is
       asynchronous, and process.exit() does not wait for it. The timer is the
       safety net for a callback that never comes: a suite that dies still owns
       an open browser, so returning without exiting would hang the runner. */
    const text = [...deathNote(err, info), err && err.stack ? err.stack : String(err)].join('\n') + '\n';
    const bail = setTimeout(() => process.exit(1), 3000);
    process.stdout.write(text, () => { clearTimeout(bail); process.exit(1); });
  };
  process.on('unhandledRejection', emit);
  process.on('uncaughtException', emit);
  return emit;
}

/* ── attaching the listeners ───────────────────────────────────────────────
 *
 * The note above reads two arrays. `errors` each suite fills its own way —
 * some push e.message, some String(e), some filter engine noise first — and
 * that is theirs to keep. `events` is the same four lines everywhere, and the
 * suites that need them most are the ones with the most pages to put them on:
 * verify-pwa.js opens twelve. Twelve hand-written copies of four listeners is
 * how one of them ends up subtly different from the other eleven, which is the
 * failure this repo keeps producing in other disguises.
 *
 * WHY IT RETURNS THE PAGE. So the call wraps the creation rather than
 * following it:
 *
 *     const page = watch(await browser.newPage(), events, 'offline');
 *
 * There is no way to write that with the listeners going on before the page
 * exists. The version that takes the page on the next line has one — I wrote
 * it, in verify-type.js, where the page is created inside a loop and my
 * listeners landed above the loop referring to a `page` that did not yet
 * exist. `node --check` cannot see that; it is a runtime ReferenceError in the
 * handler for the crash you were trying to diagnose. tests/verify-engine.js
 * now asserts the ordering, and this shape makes the assertion trivially true.
 *
 * PAGE ERRORS ARE OPTIONAL, and the fourth argument is how. A suite that
 * already has its own pageerror listener has decided what counts as one —
 * verify-heroart.js filters engine noise, verify-figreview.js keeps the whole
 * String(e), verify-splash-heart.js collects console errors alongside — and a
 * helper that pushed them too would double every message or overrule that
 * decision. Those suites pass three arguments. A suite that collects nothing
 * of its own passes its array as the fourth and gets the messages tagged the
 * same way the events are, which is the point: "INJECTED_VT_FAILURE" does not
 * say which of verify-failsafe.js's four sabotaged builds produced it.
 */
function watch(page, events, tag = '', errors = null) {
  const at = tag ? tag + ': ' : '';
  page.on('crash', () => events.push(at + 'the browser CRASHED the page'));
  page.on('close', () => events.push(at + 'the page closed'));
  page.on('requestfailed', r => {
    const why = (r.failure() || {}).errorText || '';
    if (why) events.push(at + 'request failed ' + String(r.url()).slice(-40) + ' — ' + why);
  });
  if (errors) page.on('pageerror', e => errors.push(at + e.message));
  return page;
}

module.exports = { deathNote, onDeath, watch, HEADING };
