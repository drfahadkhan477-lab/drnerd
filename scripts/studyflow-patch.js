#!/usr/bin/env node
/*
 * Chapters converges on one layout, and gets a real entrance cascade.
 *
 *   node scripts/studyflow-patch.js <in.html> <out.html>
 *
 * THE SWITCHER WAS NEVER THE HOME SCREEN'S. home-segs / S.homeLayout /
 * setHomeLayout() / the data-home attribute all read as belonging to the
 * home screen, and once did — before homeflow moved the story rail, the
 * feed and the chapter tiles onto their own page. Checked directly before
 * touching anything: the switcher's markup exists in exactly one place,
 * buildStudy()'s header. buildHome() never renders it, and contains none of
 * .story-rail / .feed / .ch-tiles either. So today, despite the name, every
 * visible effect of this control is on Chapters:
 *
 *   [data-home="focus"] .story-rail{display:none}        drops the rail
 *   [data-home="focus"/"grid"] .feed*                     resizes the feed
 *   [data-home="grid"] .ch-tiles{...136px...}             a denser grid
 *
 * Signal — today's default — is the layout kept: it is the one the previous
 * session's own work already enlarged and tested against (wider tiles,
 * bigger icons, a taller glowing bar). Focus drops the rail, a real
 * navigation aid just improved; Grid's denser tiles partly undo that work.
 * Neither is a step forward from where this screen already is.
 *
 * REMOVING THE ATTRIBUTE, NOT HUNTING THE CSS. .study-wrap's own data-home
 * is what every Focus/Grid rule above is scoped through, and .ch-tiles etc.
 * live nowhere else. Dropping data-home from .study-wrap alone — not from
 * .home-wrap generally, buildHome() keeps its own — makes those rules
 * permanently non-matching here without touching a single one of them.
 * setHomeLayout()'s only call site was the switcher itself; removing the
 * switcher leaves S.homeLayout/HOME_LAYOUTS/setHomeLayout unreachable from
 * any UI, left in place rather than deleted because a few [data-home=...]
 * rules also size the actual hero, and that is buildHome()'s own concern.
 *
 * THE CASCADE. Every piece already animates — .story pops in with its own
 * stagger, .ch-tiles>* staggers 11 steps (last session's work), .study-title
 * has its own riseIn. What was missing, confirmed by reading every relevant
 * rule before writing this: all of them start at animation-delay 0. The
 * title, the rail's first ring, the feed's first card and the first tile all
 * fire on the same frame — nothing sequences the SECTIONS, which is exactly
 * the technique that makes the home screen read as animated (hero, then
 * pearl, then progress, then doors, each a little later than the one above).
 * So this does not add new animation — it gives each section a base delay
 * and shifts each stagger already in place by that offset, the same way
 * .door's ladder already works on Home:
 *
 *   .study-back     new, .00s   — first
 *   .study-title    kept,  .04s
 *   .story-rail     +.10s base — its five-item ladder shifts to .10–.25s
 *   .feed-card      new three-item ladder, .30–.38s
 *   .section-label  new,  .40s
 *   .ch-tiles>*     +.40s base — its eleven-step ladder shifts to .42–.72s
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/studyflow-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── remove the switcher and its attribute ── */
patch('studyflow: the switcher is gone, only the back button remains',
`  return \`<div class="home-wrap anim-fade study-wrap" data-home="\${S.homeLayout}">
    <div class="study-head">
      <button class="study-back" onclick="goHome()">\${icon('arrow-left','icon-sm')} Home</button>
      <div class="home-segs" role="tablist" aria-label="Home layout">
        \${HOME_LAYOUTS.map(([id,label])=>
          \`<button class="hl-seg\${S.homeLayout===id?' on':''}" role="tab"
             aria-selected="\${S.homeLayout===id}" onclick="setHomeLayout('\${id}')">\${label}</button>\`).join('')}
      </div>
    </div>`,
`  return \`<div class="home-wrap anim-fade study-wrap">
    <div class="study-head">
      <button class="study-back" onclick="goHome()">\${icon('arrow-left','icon-sm')} Home</button>
    </div>`);

/* ── the cascade: one section, one delay, in order down the page ── */
patch('studyflow: the back button gets a first-in-sequence entrance',
`.study-back{display:flex;align-items:center;gap:6px;padding:8px 13px;border-radius:11px;
  background:color-mix(in srgb, var(--white) 74%, transparent);
  backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);
  border:1.5px solid var(--border2);color:var(--muted);font-family:inherit;
  font-size:13px;font-weight:600;cursor:pointer;
  transition:color .2s,border-color .2s,transform .26s var(--spring)}`,
`.study-back{display:flex;align-items:center;gap:6px;padding:8px 13px;border-radius:11px;
  background:color-mix(in srgb, var(--white) 74%, transparent);
  backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);
  border:1.5px solid var(--border2);color:var(--muted);font-family:inherit;
  font-size:13px;font-weight:600;cursor:pointer;
  animation:riseIn .5s var(--glide) both;
  transition:color .2s,border-color .2s,transform .26s var(--spring)}`);

patch('studyflow: the rail follows the title instead of co-starting with it',
`.story{flex:0 0 auto;background:none;border:none;cursor:pointer;padding:0;
  display:flex;flex-direction:column;align-items:center;gap:5px;width:66px;
  animation:popIn .4s var(--spring) both}
.story:nth-child(2){animation-delay:.03s}.story:nth-child(3){animation-delay:.06s}
.story:nth-child(4){animation-delay:.09s}.story:nth-child(5){animation-delay:.12s}
.story:nth-child(n+6){animation-delay:.15s}`,
`.story{flex:0 0 auto;background:none;border:none;cursor:pointer;padding:0;
  display:flex;flex-direction:column;align-items:center;gap:5px;width:66px;
  animation:popIn .4s var(--spring) .10s both}
.story:nth-child(2){animation-delay:.13s}.story:nth-child(3){animation-delay:.16s}
.story:nth-child(4){animation-delay:.19s}.story:nth-child(5){animation-delay:.22s}
.story:nth-child(n+6){animation-delay:.25s}`);

patch('studyflow: the feed cards stagger and follow the rail',
`.feed-card{position:relative;overflow:hidden;text-align:left;border:1.5px solid var(--border2);
  background:var(--white);border-radius:18px;padding:16px 18px;cursor:pointer;font:inherit;
  color:var(--text);animation:riseIn .45s var(--glide) both;
  transition:transform .24s var(--spring),box-shadow .24s var(--glide),border-color .2s}`,
`.feed-card{position:relative;overflow:hidden;text-align:left;border:1.5px solid var(--border2);
  background:var(--white);border-radius:18px;padding:16px 18px;cursor:pointer;font:inherit;
  color:var(--text);animation:riseIn .45s var(--glide) .30s both;
  transition:transform .24s var(--spring),box-shadow .24s var(--glide),border-color .2s}
.feed>.feed-card:nth-child(2){animation-delay:.34s}
.feed>.feed-card:nth-child(3){animation-delay:.38s}`);

patch('studyflow: the CHAPTERS divider gets an entrance of its own',
`.section-label{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;
  text-transform:uppercase;margin-bottom:12px;margin-top:24px;
  display:flex;align-items:center;gap:8px}`,
`.section-label{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;
  text-transform:uppercase;margin-bottom:12px;margin-top:24px;
  display:flex;align-items:center;gap:8px;animation:riseIn .5s var(--glide) .40s both}`);

patch('studyflow: the tile grid follows the feed instead of co-starting with the title',
`.ch-tiles>*{animation:riseIn .5s var(--glide) both}
.ch-tiles>*:nth-child(1){animation-delay:.02s}.ch-tiles>*:nth-child(2){animation-delay:.05s}
.ch-tiles>*:nth-child(3){animation-delay:.08s}.ch-tiles>*:nth-child(4){animation-delay:.11s}
.ch-tiles>*:nth-child(5){animation-delay:.14s}.ch-tiles>*:nth-child(6){animation-delay:.17s}
.ch-tiles>*:nth-child(7){animation-delay:.20s}.ch-tiles>*:nth-child(8){animation-delay:.23s}
.ch-tiles>*:nth-child(9){animation-delay:.26s}.ch-tiles>*:nth-child(10){animation-delay:.29s}
.ch-tiles>*:nth-child(n+11){animation-delay:.32s}`,
`.ch-tiles>*{animation:riseIn .5s var(--glide) both}
.ch-tiles>*:nth-child(1){animation-delay:.42s}.ch-tiles>*:nth-child(2){animation-delay:.45s}
.ch-tiles>*:nth-child(3){animation-delay:.48s}.ch-tiles>*:nth-child(4){animation-delay:.51s}
.ch-tiles>*:nth-child(5){animation-delay:.54s}.ch-tiles>*:nth-child(6){animation-delay:.57s}
.ch-tiles>*:nth-child(7){animation-delay:.60s}.ch-tiles>*:nth-child(8){animation-delay:.63s}
.ch-tiles>*:nth-child(9){animation-delay:.66s}.ch-tiles>*:nth-child(10){animation-delay:.69s}
.ch-tiles>*:nth-child(n+11){animation-delay:.72s}`);

fs.writeFileSync(OUT, html);
console.log(`Study flow — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
