#!/usr/bin/env node
/* What this WebKit build supports, for the two checks that fail on Windows
   with transitions off: verify-lab's heart sounds (Web Audio) and verify-chat's
   overscroll-behavior. Prints capabilities only. */
'use strict';
const { webkit } = require('playwright');
(async () => {
  const b = await webkit.launch(); const p = await b.newPage();
  await p.setContent('<div id=d style="overscroll-behavior:contain;overflow:auto;height:50px"><div style="height:200px"></div></div>');
  const r = await p.evaluate(() => {
    const C = window.AudioContext || window.webkitAudioContext;
    let ctx = null, buf = null, err = null;
    try { if (C) { ctx = new C(); buf = !!ctx.createBuffer(1, 8000, 8000); } } catch (e) { err = String(e.message || e); }
    return {
      AudioContext: typeof window.AudioContext, webkitAudioContext: typeof window.webkitAudioContext,
      contextState: ctx ? ctx.state : null, createBuffer: buf, audioError: err,
      supportsOverscroll: CSS.supports('overscroll-behavior', 'contain'),
      computedOverscroll: getComputedStyle(document.getElementById('d')).overscrollBehavior,
    };
  });
  console.log(`webkit ${b.version()} on ${process.platform}:`, JSON.stringify(r));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
