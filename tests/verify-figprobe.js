#!/usr/bin/env node
/*
 * The figure probe tells three different failures apart.
 *
 *   node tests/verify-figprobe.js
 *
 * No target and no build: the page below is synthetic and Systole-shaped —
 * ALL_Q, IMGS, S, startQuiz(), render(), a .hero-h1 — carrying one deliberate
 * defect of each kind. The real tool is then run against it as a subprocess,
 * exactly as the owner will run it, and its report is read back.
 *
 * WHY THIS IS WORTH TESTING AT ALL. tools/figure-probe.js exists to answer one
 * question — "the figures are in the build, so why is nothing on screen?" — and
 * its entire value is the DISTINCTION it draws. ABSENT, UNDECODED and UNBOXED
 * are three different bugs with three different fixes, and a probe that
 * confused them would send the investigation somewhere expensive and wrong. A
 * tool that merely says "missing" would be no better than the report it is
 * supposed to sharpen.
 *
 * It also proves the part that cannot be checked by reading: that matching an
 * <img> by its src against IMGS works at all, which is what lets this run
 * without knowing the ACCSAP markup that renders question figures.
 */
'use strict';
const http = require('http');
const path = require('path');
const execFile = require('util').promisify(require('child_process').execFile);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* A real, decodable 1x1 GIF, and a deliberately corrupt one. */
const GOOD = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const BAD  = 'data:image/gif;base64,AAAAnotanimageAAAA';

const PAGE = `<!doctype html><html><head><style>
  .zero-width{width:0}
</style></head><body>
<h1 class="hero-h1">home</h1>
<div id="app"></div>
<script>
  var ALL_Q = [
    { id:'OK_1',   ch:'Fixtures', img:1 },
    { id:'GONE_1', ch:'Fixtures', img:1 },
    { id:'ROT_1',  ch:'Fixtures', img:1 },
    { id:'FLAT_1', ch:'Fixtures', img:1 }
  ];
  var IMGS = {
    OK_1:   [${JSON.stringify(GOOD)}],
    GONE_1: [${JSON.stringify(GOOD)} + '#never-rendered'],
    ROT_1:  [${JSON.stringify(BAD)}],
    FLAT_1: [${JSON.stringify(GOOD)} + '#flat']
  };
  var S = { questions: [], qIdx: 0, screen: 'quiz' };
  function startQuiz(ch){ S.questions = ALL_Q.filter(function(q){ return q.ch === ch; }); S.qIdx = 0; }
  function render(){
    var q = S.questions[S.qIdx];
    var app = document.getElementById('app');
    if (!q) { app.innerHTML = ''; return; }
    var src = (IMGS[q.id] || [])[0];
    /* GONE_1 renders no <img> at all — the app "forgot" it. The others render
       one, with the defect their name describes. */
    var html = '<div class="q">' + q.id + '</div>';
    if (q.id !== 'GONE_1') {
      html += '<img alt="" src="' + src + '"' +
              (q.id === 'FLAT_1' ? ' class="zero-width"' : '') + '>';
    }
    /* Deferred exactly as the app's render() is, so the probe's wait is
       exercised rather than sidestepped. */
    if (document.startViewTransition) document.startViewTransition(function(){ app.innerHTML = html; });
    else setTimeout(function(){ app.innerHTML = html; }, 30);
  }
</script></body></html>`;

(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}/`;

  /* execFile, NOT execFileSync. The synchronous form blocks this process's
     event loop, so the server above cannot answer the request the subprocess
     makes, and the probe dies on "page.goto: Timeout 30000ms exceeded" against
     a server that is listening and idle. Which it did, first run. */
  let out = '', code = 0;
  try {
    const r = await execFile(process.execPath,
      [path.join(__dirname, '..', 'tools', 'figure-probe.js'), origin, '--chapter', 'Fixtures'],
      { encoding: 'utf8' });
    out = r.stdout + r.stderr;
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.code; }
  server.close();

  head('it runs against a page and reports');
  ok('the probe produced a report', /Figure probe/.test(out), out.slice(0, 120));
  ok('and found the four fixture questions', /4 question\(s\) carry a figure/.test(out),
     (out.match(/\d+ question\(s\) carry a figure/) || [''])[0]);

  head('and tells the three failures apart');
  const verdictFor = id => (new RegExp(`(ABSENT|UNDECODED|UNBOXED|UNREACHED|OK)\\s+${id}\\b`).exec(out) || [])[1];
  ok('a figure the app never rendered is ABSENT', verdictFor('GONE_1') === 'ABSENT', String(verdictFor('GONE_1')));
  ok('a figure whose bytes are not an image is UNDECODED',
     verdictFor('ROT_1') === 'UNDECODED', String(verdictFor('ROT_1')));
  ok('a figure with no layout box is UNBOXED', verdictFor('FLAT_1') === 'UNBOXED', String(verdictFor('FLAT_1')));

  /* The one that must NOT be reported. A probe that flags everything is as
     useless as one that flags nothing, and this is the check that says so.

     Tied to the three findings above rather than asserted alone: `undefined`
     is also what this returns when the probe never ran, so on its own it
     passes hardest exactly when everything is broken. It did precisely that on
     the first run, while the other four failed. */
  const foundAllThree = verdictFor('GONE_1') === 'ABSENT' &&
                        verdictFor('ROT_1') === 'UNDECODED' &&
                        verdictFor('FLAT_1') === 'UNBOXED';
  ok('a figure that renders correctly is not reported at all',
     foundAllThree && verdictFor('OK_1') === undefined,
     foundAllThree ? String(verdictFor('OK_1')) : 'the other three were not found either');
  ok('and the tally says exactly one of each plus one OK',
     /OK 1/.test(out) && /ABSENT 1/.test(out) && /UNDECODED 1/.test(out) && /UNBOXED 1/.test(out),
     (out.match(/\d+ checked:.*/) || [''])[0].trim());

  head('and it says what to do with the answer');
  ok('a non-zero exit when something is broken', code === 1, String(code));
  ok('the report explains what each verdict means',
     /ABSENT means the app never rendered it/.test(out) &&
     /UNDECODED means the bytes never became a picture/.test(out) &&
     /UNBOXED means it decoded but has no layout box/.test(out));
  ok('the dimensions are reported, not just the verdict',
     /decoded \d+x\d+, box \d+x\d+/.test(out),
     (out.match(/decoded \d+x\d+, box \d+x\d+/) || [''])[0]);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
