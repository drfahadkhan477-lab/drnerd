#!/usr/bin/env node
/*
 * The tutor panel: spacious, quiet, and it scrolls.
 *
 *   node scripts/apexroom-patch.js <input.html> <output.html>
 *
 * THREE THINGS.
 *
 * 1. NINE PROMPTS ABOVE THE TEXT BOX. "Why is this the answer?", "Kill the
 *    distractors", "Go deeper on mechanism" and six more, wrapped across two or
 *    three rows, present on every question whether or not anyone has ever
 *    pressed them. They are useful and they stay — behind a button. The panel
 *    opens with the conversation and nothing else.
 *
 * 2. IT WAS SET TIGHT. 13px in the composer, 14px padding, 12px between
 *    messages — a panel that is a reading surface, set smaller than the reading
 *    column beside it. The measure, the leading and the block spacing all open
 *    up.
 *
 * 3. IT STICKS ON iOS, AND I HAVE NOT REPRODUCED IT. Said plainly, because I
 *    twice thought I had. The first time I found .ai-body without min-height:0
 *    and called it the classic flex scroll trap; measured, it scrolls anyway,
 *    because #ai is overflow:hidden. The second time I measured the thread
 *    window at 49px of a 962px panel and thought that was it — it was the
 *    panel's own 280ms open transition, caught mid-flight. Settled, the window
 *    was 716px, or 74% of the panel, and it scrolled.
 *
 *    What the chips are worth is real but it is not a scroll fix: 716px to
 *    809px, 74% of the panel to 84%. That is thirteen percent more thread on
 *    screen, and it is a spaciousness change.
 *
 *    So the scroll changes below treat the two KNOWN WebKit causes by
 *    inspection, and none of them is claimed to be the bug:
 *
 *      · .ai-body has no overscroll-behavior. #app has it, in the portrait
 *        split, and for the same reason: when a nested scroller reaches its
 *        end, the gesture chains to the parent, and in portrait the parent is
 *        html/body with overflow:hidden — nowhere to go. On iOS that reads
 *        exactly as the panel locking until you lift and swipe again.
 *
 *      · .msg .tw is a horizontally-scrollable table wrapper sitting inside the
 *        thread. A vertical drag that starts on one can be swallowed by it.
 *
 *    And min-height:0, measured to change nothing today — the panel scrolls
 *    because #ai is overflow:hidden — kept because .ai-body is a flex:1 child
 *    of a column flex container without it, which is the classic way to build
 *    a box that refuses to scroll. It is one layout change away from mattering.
 *
 *    IF IT STILL CATCHES, the useful report is: which orientation, and whether
 *    the finger was on a table, a figure, or plain prose. That distinguishes
 *    the two causes above from a third I have not thought of.
 *
 *    One suspect of my own, from the last round: apexPanelRestore writes
 *    scrollTop on every rebuild. Writing the same value is a no-op in principle
 *    — but on iOS, writing scrollTop DURING a momentum scroll stops the
 *    momentum dead. It now only writes when the value actually differs.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/apexroom-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the chips go behind a button ─────────────────────────────────────── */
patch('apexroom: nine prompts, one button',
`     <div class="chips">\${CHIPS.map((c,i)=>\`<button class="chip\${i<2?' hot':''}" data-chip="\${i}">\${e(c[0])}</button>\`).join('')}
       \${hist.length?'<button class="chip" data-chip="clear">Clear thread</button>':''}</div>
     <div class="ai-foot"><div class="ai-input">`,
`     <div class="chips\${apexChipsOpen?' open':''}" id="aiChips">\${CHIPS.map((c,i)=>\`<button class="chip\${i<2?' hot':''}" data-chip="\${i}">\${e(c[0])}</button>\`).join('')}
       \${hist.length?'<button class="chip" data-chip="clear">Clear thread</button>':''}</div>
     <div class="ai-foot"><div class="ai-input">
       <button class="ai-more\${apexChipsOpen?' on':''}" id="aiMore" type="button"
         aria-controls="aiChips" aria-expanded="\${apexChipsOpen?'true':'false'}"
         title="Suggested prompts" aria-label="Suggested prompts">\${icon('zap','icon-sm')}</button>`);

patch('apexroom: the button remembers whether it was open',
`let apexFigMemo={key:null,figs:[]};`,
`/* Shut on every launch. The point of moving the prompts out of the way is
   that the panel opens as a conversation; remembering that they were left open
   yesterday would undo that every morning. It does persist for the session, so
   using them repeatedly in one sitting is not a fight. */
let apexChipsOpen=false;
let apexFigMemo={key:null,figs:[]};`);

patch('apexroom: and the button works',
`  const panel=document.getElementById('ai')||document;
  panel.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>{`,
`  const panel=document.getElementById('ai')||document;
  const more=document.getElementById('aiMore');
  if(more) more.onclick=()=>{
    apexChipsOpen=!apexChipsOpen;
    const strip=document.getElementById('aiChips');
    if(strip) strip.classList.toggle('open',apexChipsOpen);
    more.classList.toggle('on',apexChipsOpen);
    more.setAttribute('aria-expanded',apexChipsOpen?'true':'false');
  };
  panel.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>{`);

/* ── 2. the styles: hidden chips, a button for them, and more room ───────── */
patch('apexroom: room to read, and the prompts out of the way until asked',
`.chips{display:flex;flex-wrap:wrap;gap:6px 8px;padding:0 14px 10px}`,
`/* Closed by default and genuinely absent from the layout — display:none
   rather than height:0, so it takes no space and nothing inside it is
   focusable while it is shut. */
.chips{display:none;flex-wrap:wrap;gap:7px 9px;padding:0 18px 12px}
.chips.open{display:flex}
.ai-more{flex:0 0 auto;width:40px;height:40px;border-radius:11px;
  border:1.5px solid var(--border);background:var(--card);color:var(--muted);
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  transition:color .16s var(--ease),border-color .16s var(--ease),background .16s var(--ease)}
.ai-more.on{border-color:var(--teal);color:var(--teal);background:var(--teal4)}`);

patch('apexroom: the panel is a reading surface, set like one',
`.ai-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;
  -webkit-overflow-scrolling:touch}`,
`.ai-body{flex:1;min-height:0;overflow-y:auto;padding:18px 18px 20px;
  display:flex;flex-direction:column;gap:18px;
  /* THE GESTURE STOPS HERE. Without this, reaching the end of the thread
     chains the scroll to a parent — which in the portrait split is html/body
     with overflow:hidden, so there is nowhere for it to go and the panel reads
     as locked until you lift your finger. #app already carries this, for
     exactly the same reason.
     min-height:0 above is the other half: .ai-body is a flex:1 child of a
     column flex container, and without it a flex item will not shrink below
     its content. It happens to scroll today because #ai is overflow:hidden;
     this is what stops that being load-bearing. */
  overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch}`);

patch('apexroom: a cited figure is evidence, not the whole panel',
`.fig-strip{display:flex;flex-direction:column;gap:8px;padding:0 14px 10px}`,
`/* MEASURED: with three cited figures at 320px each the strip reached 428px of
   an 888px panel and left the conversation 275px — a third of the tutor,
   showing pictures. The figures matter and they stay; they are bounded, and
   the strip scrolls if there are more than fit. Tapping one still opens it
   full size, which is where a figure is actually read. */
.fig-strip{display:flex;flex-direction:column;gap:8px;padding:0 18px 10px;
  max-height:min(32vh,260px);overflow-y:auto;overscroll-behavior:contain}`);

patch('apexroom: and one figure does not fill the strip on its own',
`.ai-fig img{display:block;width:100%;height:auto;max-height:320px;object-fit:contain;background:var(--white)}`,
`.ai-fig img{display:block;width:100%;height:auto;max-height:190px;object-fit:contain;background:var(--white)}`);

patch('apexroom: a table must not swallow a vertical swipe',
`.msg .tw{overflow-x:auto;margin:0 0 12px;border:1px solid var(--border);border-radius:10px}`,
`/* pan-y as well as pan-x: a drug-dose table scrolls sideways, and a vertical
   drag that happens to start on one belongs to the thread behind it. */
.msg .tw{overflow-x:auto;touch-action:pan-x pan-y;margin:0 0 14px;
  border:1px solid var(--border);border-radius:10px;-webkit-overflow-scrolling:touch}`);

patch('apexroom: the message column, opened up',
`.msg{max-width:94%;font-size:16px;line-height:1.7}
.msg p{margin:0 0 10px;max-width:68ch}`,
`.msg{max-width:96%;font-size:16px;line-height:1.75}
.msg p{margin:0 0 13px;max-width:72ch}`);

patch('apexroom: and the composer stops being smaller than the app',
`.ai-input textarea{flex:1;border:1.5px solid var(--border);border-radius:12px;
  padding:9px 12px;font:inherit;font-size:13px;resize:none;max-height:120px;
  background:var(--white);color:var(--text);outline:none}`,
`.ai-input textarea{flex:1;min-width:0;border:1.5px solid var(--border);border-radius:12px;
  /* 16, not 15. The type suite holds every fixed size to the 9/11/13/16/19
     ladder, and 15 is exactly the off-ladder size it exists to refuse — it
     caught this. 16 is also what .msg is set at, so the composer and the
     conversation are finally the same size, which is the point. */
  padding:11px 14px;font:inherit;font-size:16px;line-height:1.5;resize:none;max-height:132px;
  background:var(--white);color:var(--text);outline:none}`);

/* ── 3. do not fight a momentum scroll ───────────────────────────────────── */
patch('apexroom: only write the scroll when it actually moved',
`  if(body) body.scrollTop = st.pinned ? body.scrollHeight : st.top;`,
`  /* Only when it differs. Writing scrollTop is a no-op in principle when the
     value is unchanged, but on iOS writing it AT ALL during a momentum scroll
     stops the momentum — and this runs on every rebuild, which is after every
     tool step. */
  if(body){
    const want = st.pinned ? body.scrollHeight : st.top;
    if(Math.abs(body.scrollTop - want) > 1) body.scrollTop = want;
  }`);

fs.writeFileSync(OUT, html);
console.log(`Spacious, quiet, and it scrolls — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
