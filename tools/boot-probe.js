#!/usr/bin/env node
/*
 * Where does the launch time actually go?
 *
 *   node tools/boot-probe.js build/systole.html
 *   node tools/boot-probe.js http://localhost:8080        # the split build
 *   node tools/boot-probe.js http://localhost:8123 --cpu 4 --runs 5
 *   node tools/boot-probe.js http://localhost:8123 --cpu 4 --profile
 *
 * --cpu N slows the CPU N times (Chromium only; it says so when it cannot), the
 * nearest a laptop gets to an iPad without one. --runs N launches N times, each
 * in a fresh context so nothing is cached, and prints the median with the range,
 * because one launch is noise and a change is only worth keeping if it moves the
 * median. Two more sections follow the timings: the files fetched before the
 * hero appeared, slowest first, and the main thread's long tasks (over 50 ms)
 * before it — what makes an iPad feel stuck. Anything the engine cannot measure
 * is printed as unavailable, never as 0: a zero here would read as "fast".
 *
 * --profile adds one launch AFTER the timed ones, under Chrome's sampling CPU
 * profiler, and lists the functions the main thread spent the time on before
 * the hero: by self time (the function's own code) and by total time (itself
 * and everything it called). It is a separate launch because the profiler
 * slows what it watches, and the medians above should not carry that.
 *
 * WHY THIS EXISTS. verify-stage0 asserts "launches without stalling" as
 *
 *     ok('launches without stalling', launchMs < 5000)
 *
 * where launchMs spans page.goto() to the hero being on screen. On a 42 MB
 * single file that interval is mostly the browser reading and parsing 42 MB,
 * which the app does not control and which differs by machine: the same build
 * reports 2-3s on the box the 5000 was calibrated on and 6.0-6.1s on the
 * owner's Windows laptop, 10.5s when the rest of the suite is competing for
 * the disk.
 *
 * That is one number covering two different things, and a threshold over it
 * cannot distinguish "this build stalls" from "this machine is slower than the
 * one nobody wrote down". Raising it to fit the laptop would make it mean even
 * less. So before changing anything, measure where the time goes — on whatever
 * machine is asking.
 *
 * WHAT IT PRINTS, from the page's own Performance timeline rather than a
 * stopwatch in Node:
 *
 *   fetch+parse   navigationStart → domInteractive: the browser getting
 *                 through the document. Proportional to file size.
 *   to hero       domInteractive → the hero heading existing. The app's own
 *                 boot: modules initialising, first render, whatever it does
 *                 before it can show you anything.
 *   total         the number verify-stage0 currently asserts on.
 *
 * It asserts nothing and exits 0 whatever it finds. This is an instrument, not
 * a gate — it exists to tell the person changing the gate what they are
 * looking at.
 */
'use strict';
const path = require('path');
const { launch, engineName, cpuThrottle } = require('../tests/_engine.js');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n) || n < 1) { console.error(`--${name} needs a number of 1 or more`); process.exit(1); }
  return n;
};
const CPU = flag('cpu', 1), RUNS = Math.round(flag('runs', 1)), PROFILE = argv.includes('--profile');
const target = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && /^--(cpu|runs)$/.test(argv[i - 1])));
if (!target) {
  console.error('usage: node tools/boot-probe.js <build/systole.html | http://host:port> [--cpu N] [--runs N]');
  process.exit(1);
}
const URL = /^https?:/.test(target) ? target
                                    : 'file:///' + path.resolve(target).split(path.sep).join('/').replace(/^\/+/, '');

(async () => {
  /* launch() returns the browser, not a {browser, page} pair — the same shape
     tools/figure-probe.js uses three lines below its own call. Assumed rather
     than read, and it cost the owner a round trip on a laptop at midnight. */
  const browser = await launch();
  console.log(`Boot probe — ${engineName()}\n  ${target}` +
              (CPU > 1 ? `, CPU slowed ${CPU}×` : '') + (RUNS > 1 ? `, ${RUNS} runs` : '') + '\n');

  const once = async (profile = false) => {
  const page = await (await browser.newContext()).newPage();
  /* Chromium only, like the throttle; null elsewhere, and said so below. */
  let cdp = null;
  if (profile && engineName() === 'chromium') {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  /* Asked for and not applied is said, not skipped: a --cpu 4 reading taken at
     full speed would be the number someone plans an iPad change around. */
  const throttled = CPU > 1 ? await cpuThrottle(page, CPU) : false;

  /* Stamp the moment the hero exists, from inside the page, so the number is
     on the same clock as the navigation timings rather than Node's. */
  /* OBSERVES `document`, NOT `document.documentElement`. An init script runs at
     document-start, where documentElement is still null, so observing it threw
     and the stamp was never installed — the probe then waited two minutes for a
     value nothing was going to write. Document is always there. The interval is
     a second route to the same answer in case a MutationObserver is not, and
     Node has a third below, because an instrument that reports nothing is
     worse than a crude number. */
  await page.addInitScript(() => {
    window.__heroAt = null;
    const stamp = () => {
      if (window.__heroAt === null && document.querySelector('.hero-h1')) {
        window.__heroAt = performance.now();
        return true;
      }
      return false;
    };
    try { new MutationObserver(stamp).observe(document, { childList: true, subtree: true }); }
    catch (_) { /* the interval below is the fallback */ }
    const tick = setInterval(() => { if (stamp()) clearInterval(tick); }, 30);
    /* null, not [], where the engine has no longtask entries: "no long tasks"
       and "cannot see long tasks" must not print the same. */
    window.__longTasks = null;
    try {
      if ((PerformanceObserver.supportedEntryTypes || []).includes('longtask')) {
        window.__longTasks = [];
        new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longTasks.push([e.startTime, e.duration]); })
          .observe({ type: 'longtask', buffered: true });
      }
    } catch (_) { window.__longTasks = null; }
  });

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* Wait on the DOM condition verify-stage0 itself waits on — proven to work
     against this build — rather than on the stamp, so a stamp that failed to
     install costs precision and not the whole reading. */
  await page.waitForFunction(() => !!document.querySelector('.hero-h1'), null, { timeout: 120000 });
  const cpuProfile = cdp ? (await cdp.send('Profiler.stop')).profile : null;
  const wallMs = Date.now() - t0;
  const heroFallback = await page.evaluate(() => performance.now());

  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      responseEnd: nav.responseEnd || 0,
      domInteractive: nav.domInteractive || 0,
      domContentLoaded: nav.domContentLoadedEventEnd || 0,
      loadEvent: nav.loadEventEnd || 0,
      heroAt: window.__heroAt,
      stamped: window.__heroAt !== null,
      bytes: (performance.getEntriesByType('resource')[0] || {}).transferSize || 0,
      files: performance.getEntriesByType('resource').map(r => ({
        name: r.name, start: r.startTime, end: r.responseEnd, dur: r.duration,
        /* transferSize is 0 for a cached or a file:// resource; encodedBodySize
           is the size on the wire either way, and 0 only when truly unknown. */
        bytes: r.encodedBodySize || r.transferSize || null })),
      longTasks: window.__longTasks,
    };
  });

  /* The stamp is the moment the hero appeared; the fallback is the moment Node
     noticed, which is later by a poll interval and an RPC. Say which is being
     reported rather than presenting one as the other. */
  const heroAt = t.stamped ? t.heroAt : heroFallback;
  await page.context().close();
  return { t, heroAt, wallMs, throttled, cpuProfile };
  };

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    runs.push(await once());
    if (RUNS > 1) process.stdout.write(`  run ${i + 1} of ${RUNS}: hero at ${(runs[i].heroAt / 1000).toFixed(2)}s\n`);
  }
  if (RUNS > 1) console.log('');
  if (CPU > 1 && !runs[0].throttled) {
    console.log(`  --cpu ${CPU} was NOT applied: ${engineName()} has no CPU throttling. These are full-speed numbers.\n`);
  }
  const median = xs => { const v = xs.slice().sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const pick = f => median(runs.map(f));
  const span = f => RUNS > 1 ? `   range ${(Math.min(...runs.map(f)) / 1000).toFixed(2)}–${(Math.max(...runs.map(f)) / 1000).toFixed(2)}s` : '';
  const t = {
    responseEnd: pick(r => r.t.responseEnd),
    domInteractive: pick(r => r.t.domInteractive),
    stamped: runs.every(r => r.t.stamped),
  };
  const heroAt = pick(r => r.heroAt);
  const wallMs = pick(r => r.wallMs);

  const row = (label, ms, note) =>
    console.log('  ' + label.padEnd(26) + (ms / 1000).toFixed(2).padStart(7) + 's' +
                (note ? '   ' + note : ''));

  if (RUNS > 1) console.log(`  medians of ${RUNS} runs\n`);
  row('read off disk', t.responseEnd, 'navigationStart → responseEnd' + span(r => r.t.responseEnd));
  row('hero on screen', heroAt,
      (t.stamped ? 'stamped when it appeared' : 'measured when node noticed — slightly late') + span(r => r.heroAt));
  row('document parsed', t.domInteractive, 'navigationStart → domInteractive' + span(r => r.t.domInteractive));
  console.log('  ' + '─'.repeat(52));
  row('wall clock in node', wallMs, 'what verify-stage0 asserts on' + span(r => r.wallMs));

  /* THE FIRST VERSION OF THIS PRINTED 111%, which is the tell that the metric
     was wrong rather than the build. It assumed the hero would appear AFTER
     domInteractive, so that "to hero" could be heroAt - domInteractive and the
     app's own boot would be the remainder. That is how a page with external
     scripts behaves. It is not how this one does: the app is INLINE in the
     document being parsed, so its script runs, paints the hero, and the
     browser carries on through the remaining megabytes. The hero lands before
     the document is finished. */
  console.log('');
  if (heroAt < t.domInteractive) {
    const early = ((t.domInteractive - heroAt) / 1000).toFixed(2);
    console.log(`  The hero was on screen ${early}s BEFORE the document finished parsing.`);
    console.log('  The app is inline in the document, so it paints as soon as its script');
    console.log('  runs and the browser keeps parsing behind it. Everything before that');
    console.log('  point is the browser getting through the file — not the app booting.');
  } else {
    const own = ((heroAt - t.domInteractive) / 1000).toFixed(2);
    console.log(`  ${own}s passed between the document being parsed and the hero appearing.`);
    console.log('  That interval is the app\'s own boot and is the part it controls.');
  }
  console.log('');

  /* The last run's detail: which files were fetched before the hero, and what
     the main thread was busy with. Medians above; one representative run here,
     because a table of medians per file would describe no launch that happened. */
  const last = runs[runs.length - 1];
  const before = last.t.files.filter(f => f.start < last.heroAt)
                             .sort((a, b) => b.dur - a.dur);
  const short = n => n.replace(/^https?:\/\/[^/]+\//, '').replace(/^file:\/\/.*\//, '').slice(0, 40) || '(document)';
  const size = b => b === null ? 'size n/a' : b >= 1e6 ? (b / 1e6).toFixed(2) + ' MB' : (b / 1e3).toFixed(0) + ' KB';
  /* Chromium keeps no resource timing for a file:// page's own scripts — a
     stand-in page loading a 600 KB app.js from disk reported none — so there
     "0 files" would be false, not small. */
  if (/^file:/.test(URL)) {
    console.log('  Files fetched before the hero: not reported for a file:// page. Serve the split');
    console.log('  build (node scripts/serve.js) and probe its http:// address to see them.');
  } else {
  console.log(`  Files fetched before the hero (last run): ${before.length}`);
  for (const f of before.slice(0, 10)) {
    console.log('    ' + short(f.name).padEnd(42) + size(f.bytes).padStart(10) + (f.dur / 1000).toFixed(2).padStart(8) + 's' +
                `   done at ${(f.end / 1000).toFixed(2)}s`);
  }
  if (before.length > 10) console.log(`    … and ${before.length - 10} more`);
  const known = before.filter(f => f.bytes !== null);
  if (known.length) console.log(`    total ${size(known.reduce((n, f) => n + f.bytes, 0))} across ${known.length} files with a known size`);
  }
  console.log('');
  if (last.t.longTasks === null) {
    console.log('  Long tasks: unavailable — this engine does not report them.');
  } else {
    const lt = last.t.longTasks.filter(([at]) => at < last.heroAt);
    const busy = lt.reduce((n, [, d]) => n + d, 0);
    console.log(`  Long tasks before the hero (last run): ${lt.length}, ${(busy / 1000).toFixed(2)}s of main thread` +
                (lt.length ? `, longest ${(Math.max(...lt.map(([, d]) => d)) / 1000).toFixed(2)}s` : ''));
  }
  console.log('');

  if (PROFILE) {
    const p = (await once(true)).cpuProfile;
    if (!p) console.log('  Profile: unavailable — this engine has no sampling profiler.\n');
    else printProfile(p);
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

/* Self time is the sampled time a function was on top of the stack; total time
   is the time it was anywhere on it, counted once per sample however deep the
   recursion. Idle and the profiler's own bookkeeping are left out of the
   ranking but the garbage collector is kept: on an iPad it is real time. */
function printProfile(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const keyOf = n => {
    const f = n.callFrame;
    /* No URL: a built-in (JSON.parse, a regex) or the probe's own injected
       code (Playwright's polling, the hero stamp), which cannot be told apart
       here, so neither is named as the app's. */
    if (!f.url) return `${f.functionName || '(anonymous)'}  (built-in or probe)`;
    const file = f.url.replace(/^https?:\/\/[^/]+\//, '').replace(/^.*[\\/]/, '');
    return `${f.functionName || '(anonymous)'}  ${file}:${f.lineNumber + 1}`;
  };
  const skip = new Set(['(root)', '(idle)', '(program)']);
  const self = new Map(), total = new Map();
  let sampled = 0;
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i + 1] || 0) / 1000;   // µs → ms, the time until the next sample
    const leaf = byId.get(id);
    if (!leaf || skip.has(leaf.callFrame.functionName)) return;
    sampled += dt;
    self.set(keyOf(leaf), (self.get(keyOf(leaf)) || 0) + dt);
    const seen = new Set();
    for (let n = leaf; n; n = byId.get(parent.get(n.id))) {
      if (skip.has(n.callFrame.functionName)) continue;
      const k = keyOf(n);
      if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) || 0) + dt); }
    }
  });
  /* Under 1% is dropped: at that size a row is sampling noise, and the list is
     for finding where seconds go. */
  const top = (m, n) => [...m.entries()].filter(([, ms]) => ms >= sampled / 100)
                                        .sort((a, b) => b[1] - a[1]).slice(0, n);
  const line = ([k, ms]) => console.log('    ' + (ms / 1000).toFixed(2).padStart(6) + 's  ' +
                                        (100 * ms / sampled).toFixed(0).padStart(3) + '%  ' + k);
  console.log(`  Profile of one more launch, to the hero: ${(sampled / 1000).toFixed(2)}s of main-thread work sampled`);
  console.log('  (a separate launch: the profiler slows what it watches, so these times run long)\n');
  console.log('  By total time — the function and everything it called:');
  top(total, 15).forEach(line);
  console.log('\n  By self time — the function\'s own code:');
  top(self, 15).forEach(line);
  console.log('');
}
