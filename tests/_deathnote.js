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
  if (info.section) lines.push(`  last section reached: ${info.section}`);
  if (typeof info.checks === 'number') lines.push(`  checks completed: ${info.checks}`);
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
    for (const line of deathNote(err, info)) console.log(line);
    /* LAST, so scripts/cause.js finds it at the tail. */
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  };
  process.on('unhandledRejection', emit);
  process.on('uncaughtException', emit);
  return emit;
}

module.exports = { deathNote, onDeath, HEADING };
