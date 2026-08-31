#!/usr/bin/env node
/*
 * One quiet line for someone opening this for the first time.
 *
 *   node scripts/welcome-patch.js <in.html> <out.html>
 *
 * THE GAP. There is no onboarding anywhere in this app — no tour, no
 * coachmark, no first-run anything. That is mostly right: the home screen's
 * whole design is "say one thing, offer doors", and a wizard would argue with
 * that on the one screen built hardest to be calm. But two of the app's doors
 * are not discoverable by looking at them. Chapters is where all 638
 * questions actually live, and Apex — the floating button at the bottom
 * right — is the tutor that will explain any answer and can read the figures.
 * A first-time reader finds both by poking, or not at all.
 *
 * SO: ONE CARD, UNDER THE DOORS, DISMISSED FOREVER BY ONE TAP. Not a modal,
 * not an overlay with cut-outs pointing at things. An overlay tour has to
 * know where its targets are on screen, which means it breaks the moment the
 * layout it was measured against changes — and this layout already reflows
 * between phone, portrait iPad and landscape iPad. A card in the normal flow
 * simply cannot be wrong about where anything is, because it does not claim
 * to know.
 *
 * IT NEVER APPEARS FOR SOMEONE WHO HAS ALREADY BEEN USING THE APP. Gated on
 * three things, not one: the dismissal flag, an empty scheduler, and an empty
 * review log. The flag alone would be wrong — everyone already carrying
 * months of progress would be handed a "New here?" card the first time they
 * loaded a build containing this step, which is precisely the audience it is
 * not for. With the history checks, the fellow whose app this is will never
 * see it at all; it exists only for someone he sends the link to.
 *
 * And if localStorage cannot be read, helloSeen() answers TRUE — never show
 * it — rather than false. A hint that cannot remember being dismissed is a
 * hint that reappears on every single launch, which is worse than no hint.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/welcome-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── the card's own styles ──────────────────────────────────────────────────
   --muted throughout, never --dim: --dim is this app's decorative tertiary
   token and measures 2.3:1 against a light card, which is below AA for text
   anyone is expected to read. That was measured on the progress card in the
   same design pass this step belongs to. */
patch('welcome: the card, in the app\'s own glass vocabulary',
`.door-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:10px;`,
`.hello{display:flex;align-items:flex-start;gap:12px;margin-top:14px;padding:14px 16px;
  border-radius:16px;border:1.5px solid color-mix(in srgb, var(--teal) 34%, transparent);
  background:color-mix(in srgb, var(--teal) 9%, var(--white));
  animation:riseIn .5s var(--glide) .3s both}
.hello-ic{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:10px;
  background:color-mix(in srgb, var(--teal) 18%, transparent);color:var(--teal)}
.hello-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.hello-txt>b{font-size:13px;font-weight:700;color:var(--text)}
.hello-txt>i{font-style:normal;font-size:13px;line-height:1.45;color:var(--muted)}
.hello-txt>i b{color:var(--text);font-weight:700}
/* THE DISMISS BUTTON LIVES ON THE LEFT, UNDER THE TEXT, AND THAT IS NOT A
   VISUAL PREFERENCE. Apex's floating button is position:fixed in the
   bottom-right corner of the viewport, so it passes over whatever happens to
   be scrolled beneath it — margins cannot move content out of its way. The
   first draft put "Got it" at the right-hand end of the card's own row, and
   on an iPad in portrait the FAB landed exactly on top of it:
   elementFromPoint at the button's own centre returned aiFab, so the one
   control whose entire job is making this card go away could not be tapped
   at all. Anything interactive therefore stays out of the right-hand edge,
   where the FAB is; the left is a place the FAB never occupies at any scroll
   position or viewport size. */
.hello-x{align-self:flex-start;margin-top:9px;padding:7px 14px;border-radius:99px;cursor:pointer;
  border:1.5px solid var(--border2);background:var(--white);color:var(--text);
  font-family:inherit;font-size:13px;font-weight:700;
  transition:transform .2s var(--spring),background .18s}
.hello-x:active{transform:scale(.94)}
.hello.gone{opacity:0;transform:translateY(-6px);transition:opacity .24s,transform .24s}
.door-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:10px;`);

/* ── whether it is shown at all, and what dismissing it means ── */
patch('welcome: three gates, and a dismissal that sticks',
`function buildHome(){`,
`/* TRUE on failure, deliberately: if the dismissal cannot be remembered then
   showing the card would mean showing it on every launch for ever. */
function helloSeen(){
  try{ return localStorage.getItem('accsap12.welcomed')==='1'; }catch(_){ return true; }
}
/* Only for someone who genuinely has not used this yet — an empty scheduler
   and an empty review log, not merely an unset flag. */
function showHello(){
  if(helloSeen()) return false;
  try{ if(S.srs&&Object.keys(S.srs).length) return false; }catch(_){}
  try{ if(typeof LOG!=='undefined'&&LOG&&LOG.length) return false; }catch(_){}
  return true;
}
function dismissHello(){
  try{ localStorage.setItem('accsap12.welcomed','1'); }catch(_){}
  const el=document.getElementById('homeHello');
  if(!el) return;
  /* Faded out rather than yanked: the card is directly under the doors, and
     removing it in one frame jumps everything below it upward. */
  el.classList.add('gone');
  setTimeout(()=>{ if(el.parentNode) el.remove(); },260);
}
function buildHome(){`);

/* ── the markup, under the door row ── */
patch('welcome: it sits under the doors, naming the two that cannot be guessed',
`      <button class="door door-wide" onclick="goLab()">
        <span class="door-ic">\${icon("activity")}</span>
        <span class="door-txt"><b>Rhythm Lab</b><i>every trace, drawn live</i></span>
        <span class="door-go">\${icon('arrow-right','icon-sm')}</span>
      </button>
    </div>`,
`      <button class="door door-wide" onclick="goLab()">
        <span class="door-ic">\${icon("activity")}</span>
        <span class="door-txt"><b>Rhythm Lab</b><i>every trace, drawn live</i></span>
        <span class="door-go">\${icon('arrow-right','icon-sm')}</span>
      </button>
    </div>
    \${showHello()?\`<div class="hello" id="homeHello">
      <span class="hello-ic">\${icon('zap')}</span>
      <div class="hello-txt">
        <b>New here?</b>
        <i><b>Chapters</b> holds all \${TOTAL_Q} questions, grouped by topic.
           <b>Apex</b> — the button at the bottom right — explains any answer,
           and can read the figures with you.</i>
        <button class="hello-x" onclick="dismissHello()">Got it</button>
      </div>
    </div>\`:''}`);

fs.writeFileSync(OUT, html);
console.log(`Welcome — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
