'use strict';
/* ── how long a suite may run, and where its time went ────────────────────────
   Two things the owner's laptop runs could not tell anyone.

   1. A HUNG SUITE HUNG THE RUN. runSuite() waited on the child's 'close' with
      no limit, so a page that stopped answering held the whole run until a
      person noticed and pressed Ctrl+C — losing every count the run had made.
      limitFor() gives each suite a ceiling from its own recorded time, and
      watch() stops the child when it passes it. The suite is then reported as
      having died, with the section it was in, and the run carries on.

   2. THE 71-MINUTE RUN WAS THREE SUITES. The record of 2026-10-06 has layout at
      44 min, selftest at 40 and pearl at 28 on the real build — about thirty
      times what the same suites take on the 5 MB synthetic build. Which step
      inside them grows with the bank was not knowable from the log, which has
      section headings but no clock. sectionClock() timestamps each "── … ──"
      heading as the child prints it, so a run ends with the slowest sections
      named, and the next fix is to a measured step rather than a guess.

   Pure apart from watch(), which takes the child it is given. The runner does
   the I/O; tests/verify-suitetime-pure.js holds all three to their rules. */

const MIN = 60 * 1000;
/* The floor is generous on purpose: a ceiling that fires on a slow-but-alive
   suite turns a green run red, which is the worse failure. Three times the
   recorded time, and never under 20 minutes. A suite with no recorded time is
   new or renamed and gets an hour. */
const FLOOR_MS = 20 * MIN, UNKNOWN_MS = 60 * MIN, FACTOR = 3;

/* recordedSecs: this suite's seconds from tests/test-stats.json, or undefined.
   overrideMin: --suite-timeout in minutes; 0 turns the ceiling off (null). */
function limitFor(recordedSecs, overrideMin) {
  if (overrideMin !== undefined && overrideMin !== null && overrideMin !== '') {
    const m = Number(overrideMin);
    if (!Number.isFinite(m) || m < 0) throw new Error(`--suite-timeout wants minutes (0 = no limit), got "${overrideMin}"`);
    return m === 0 ? null : m * MIN;
  }
  if (!(recordedSecs > 0)) return UNKNOWN_MS;
  return Math.max(FLOOR_MS, FACTOR * recordedSecs * 1000);
}

/* Feed it the child's output as it arrives, with the time it arrived. A heading
   is a line that opens with "── " (every suite's head() prints exactly that).
   A chunk can end mid-line, so the partial tail is held for the next one. */
function sectionClock(start) {
  let buf = '', current = null, since = start;
  const done = [];
  const close = at => { if (current !== null) done.push({ section: current, ms: at - since }); };
  return {
    feed(chunk, at) {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const ln of lines) {
        const m = ln.match(/^\s*── (.+?) ──\s*$/);
        if (!m) continue;
        close(at);
        current = m[1]; since = at;
      }
    },
    /* The section the suite is in right now: what a stopped suite was doing. */
    current: () => current,
    end(at) { close(at); current = null; return done.slice(); },
  };
}

/* The n longest sections across a run, longest first. */
function slowest(results, n) {
  const all = [];
  for (const r of results) for (const s of (r.sections || [])) all.push({ suite: r.name, section: s.section, ms: s.ms });
  return all.sort((a, b) => b.ms - a.ms).slice(0, n);
}

/* Stop the child when the limit passes. Returns cancel(). onTimeout runs first,
   so the runner can write the reason into the suite's output before 'close'. */
function watch(child, limitMs, onTimeout) {
  if (!limitMs) return () => {};
  const t = setTimeout(() => {
    try { onTimeout(); } catch (_) {}
    try { child.kill('SIGKILL'); } catch (_) {}
  }, limitMs);
  if (t.unref) t.unref();
  return () => clearTimeout(t);
}

/* spawnSync with the same ceiling, for the --pwa phases that run one at a
   time after the registry (build-pwa, verify-pwa, verify-pages,
   verify-cachebuckets). They used spawnSync with no timeout, so a hung split
   build waited forever whatever --suite-timeout said (Codex review of #186).
   On a timeout the child is killed and a line naming the stop is appended to
   its stderr, so the runner's own failure printing says why. */
function spawnLimited(cmd, args, opts, limitMs, label) {
  const { spawnSync } = require('child_process');
  const t = Date.now();
  const r = spawnSync(cmd, args, Object.assign({}, opts, limitMs ? { timeout: limitMs, killSignal: 'SIGKILL' } : {}));
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  if (timedOut) {
    r.stderr = String(r.stderr || '') +
      `\nError: ${label || 'this step'} stopped by verify.js after ${fmtMin(Date.now() - t)} (its limit: ${fmtMin(limitMs)})\n`;
    if (r.status === 0) r.status = null;
  }
  r.timedOut = timedOut;
  return r;
}

const fmtMin = ms => (ms / MIN).toFixed(ms < 10 * MIN ? 1 : 0) + ' min';

module.exports = { limitFor, sectionClock, slowest, watch, spawnLimited, fmtMin, FLOOR_MS, UNKNOWN_MS, FACTOR };
