#!/usr/bin/env node
/*
 * The home screen, reworked: a larger welcome bar, a progress bar under it,
 * and a choice of three layouts.
 *
 *   node scripts/home-patch.js <theme-output.html> <output.html>
 *
 * Three things the home page was asked for:
 *
 *   1. A larger welcome bar. The live ECG strip along the bottom of the hero
 *      is the thing the eye lands on first, so it is given room to breathe.
 *
 *   2. A progress bar under it. Not a decorative one — it is the real state of
 *      the bank, in two layers: how much has been seen, and inside that, how
 *      much is actually retained (FSRS's own recall estimate, the same number
 *      the chapter rings use). It grows from empty on each load and a highlight
 *      sweeps the filled part, so it reads as momentum rather than a statistic.
 *
 *   3. A choice of layout. The same blocks, arranged three ways, because
 *      different people want different things from a home screen:
 *        · Signal — the full briefing: rings, shortcuts, review feed, chapters.
 *        · Focus  — everything but the next action stripped away, for sitting
 *                   down to work; a bigger hero and the review feed, nothing else.
 *        · Grid   — a dense dashboard: compact hero, the feed side by side, and
 *                   the chapters as a tighter grid.
 *      The choice is a data-home attribute on the wrapper and lives entirely in
 *      CSS — the markup is identical for all three — so it cannot fall out of
 *      sync with itself, and it is remembered between sessions.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/home-patch.js <theme-output.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. a larger welcome bar ──────────────────────────────────────────────── */
patch('css: enlarge the hero ECG strip and make room for it',
`.hero-ecg{height:clamp(64px,9.5vw,104px)!important}
.hero-live{padding-bottom:clamp(76px,11vw,116px)!important}`,
`.hero-ecg{height:clamp(92px,13.5vw,140px)!important}
.hero-live{padding-bottom:clamp(104px,16vw,158px)!important}`);

/* ── 2. the progress bar, and the layout switch, and the layout variants ──── */
patch('css: progress bar and layout system',
`.home-wrap{padding:20px 0 40px}`,
`.home-wrap{padding:20px 0 40px}

/* the layout switch — a small segmented control, right-aligned above the hero */
.home-top{display:flex;justify-content:flex-end;margin-bottom:10px}
.home-segs{display:inline-flex;background:var(--border2);border:1px solid var(--border);
  border-radius:11px;padding:3px;gap:2px}
.hl-seg{border:none;background:none;font:600 12px var(--font-sans);color:var(--muted);
  padding:6px 13px;border-radius:8px;cursor:pointer;transition:all .16s var(--ease);letter-spacing:.01em}
.hl-seg.on{background:var(--card);color:var(--text);box-shadow:var(--e1)}
@media(hover:hover){.hl-seg:not(.on):hover{color:var(--text)}}

/* the progress bar under the hero */
.home-progress{margin:-4px 2px 18px;padding:0 2px}
.hp-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px}
.hp-cap{font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.hp-val{font-family:var(--font-mono);font-size:12px;color:var(--dim)}
.hp-val b{color:var(--teal);font-weight:700}
.hp-track{position:relative;height:9px;border-radius:6px;background:var(--border2);
  overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.10)}
.hp-seen,.hp-mast{position:absolute;top:0;bottom:0;left:0;border-radius:6px}
.hp-seen{background:color-mix(in srgb,var(--teal) 34%,transparent);
  animation:hpGrow 1.05s var(--glide) both}
.hp-mast{background:linear-gradient(90deg,var(--teal2),var(--teal));
  box-shadow:0 0 8px color-mix(in srgb,var(--teal) 50%,transparent);
  animation:hpGrow 1.05s var(--glide) .08s both}
.hp-shine{position:absolute;top:0;bottom:0;width:38%;pointer-events:none;border-radius:6px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.42),transparent);
  animation:hpShine 2.6s var(--glide) 1s infinite}
@keyframes hpGrow{from{width:0}}
@keyframes hpShine{0%{transform:translateX(-120%)}60%,100%{transform:translateX(360%)}}
@media(prefers-reduced-motion:reduce){
  .hp-seen,.hp-mast{animation:none}.hp-shine{display:none}
}

/* ── Focus: the next action and nothing else ── */
html [data-home="focus"] .story-rail,
html [data-home="focus"] .quick-row{display:none}
[data-home="focus"] .hero-h1{font-size:clamp(40px,10vw,56px)}
[data-home="focus"] .hero-live{padding-top:34px}
[data-home="focus"] .feed{gap:12px}
[data-home="focus"] .feed-card{padding:20px}
[data-home="focus"] .fc-title{font-size:20px}

/* ── Grid: a dense dashboard ── */
[data-home="grid"] .hero-live{padding-top:20px}
[data-home="grid"] .hero-h1{font-size:clamp(30px,7vw,40px)}
[data-home="grid"] .hero-ecg{height:clamp(72px,10vw,104px)!important}
[data-home="grid"] .feed{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:stretch}
[data-home="grid"] .feed-card{padding:14px}
[data-home="grid"] .fc-title{font-size:15px}
[data-home="grid"] .fc-sub{font-size:11.5px}
[data-home="grid"] .ch-tiles{grid-template-columns:repeat(auto-fill,minmax(136px,1fr));gap:8px}
[data-home="grid"] .quick-row{margin-bottom:12px;gap:6px}
[data-home="grid"] .quick{padding:10px 4px}
@media(max-width:380px){[data-home="grid"] .feed{grid-template-columns:1fr}}`);

/* ── 3. wire the metric, the switch and the bar into the markup ───────────── */
patch('home: compute the two progress figures',
`  const covered=Math.round(seenN/TOTAL_Q*100);`,
`  const covered=Math.round(seenN/TOTAL_Q*100);
  /* Mastery is FSRS's own recall estimate, summed over the whole bank — the
     same measure the chapter rings show, aggregated. So the bar and the rings
     can never tell different stories. */
  const masteryFrac=TOTAL_Q?CHAPTERS.reduce((s,ch)=>s+masteryFor(ch)*POOL.filter(q=>q.ch===ch).length,0)/TOTAL_Q:0;
  const masteryPct=Math.round(masteryFrac*100);`);

patch('home: the layout switch and the wrapper attribute',
`  return \`<div class="home-wrap anim-fade">
    <div class="hero-live">`,
`  return \`<div class="home-wrap anim-fade" data-home="\${S.homeLayout}">
    <div class="home-top">
      <div class="home-segs" role="tablist" aria-label="Home layout">
        \${HOME_LAYOUTS.map(([id,label])=>
          \`<button class="hl-seg\${S.homeLayout===id?' on':''}" role="tab"
             aria-selected="\${S.homeLayout===id}" onclick="setHomeLayout('\${id}')">\${label}</button>\`).join('')}
      </div>
    </div>
    <div class="hero-live">`);

patch('home: the progress bar under the hero',
`      \${heartSVG('heroHeart')}
      <canvas id="heroHeart3d" class="heart-3d-mini" aria-hidden="true"></canvas>
    </div>

    <div class="story-rail">`,
`      \${heartSVG('heroHeart')}
      <canvas id="heroHeart3d" class="heart-3d-mini" aria-hidden="true"></canvas>
    </div>

    <div class="home-progress" aria-label="Bank progress">
      <div class="hp-head">
        <span class="hp-cap">Your progress</span>
        <span class="hp-val"><b>\${masteryPct}%</b> mastered · \${covered}% seen</span>
      </div>
      <div class="hp-track" role="progressbar" aria-valuenow="\${masteryPct}" aria-valuemin="0" aria-valuemax="100">
        <div class="hp-seen" style="width:\${covered}%"></div>
        <div class="hp-mast" style="width:\${masteryPct}%"><span class="hp-shine"></span></div>
      </div>
    </div>

    <div class="story-rail">`);

/* ── 4. the model behind the switch ───────────────────────────────────────── */
patch('js: the home layouts, and switching between them',
`function chIcon(ch,cls){ return icon(CH_ICONS[ch]||'pin', cls||''); }`,
`function chIcon(ch,cls){ return icon(CH_ICONS[ch]||'pin', cls||''); }

/* The three arrangements of the home screen. The markup is identical for all
   three; only a data-home attribute and the CSS above differ, so nothing here
   can drift out of step with what is drawn. */
const HOME_LAYOUTS=[['signal','Signal'],['focus','Focus'],['grid','Grid']];
function setHomeLayout(id){
  if(!HOME_LAYOUTS.some(l=>l[0]===id)) return;
  S.homeLayout=id; save(); render();
}`);

patch('state: default the layout, and remember it',
`  mode:'all',zoomed:-1,theme:boot.theme||'auto'};`,
`  mode:'all',zoomed:-1,theme:boot.theme||'auto',homeLayout:boot.homeLayout||'signal'};`);

patch('state: persist the layout choice',
`  chStats:S.chStats,missed:[...S.missed],theme:S.theme,`,
`  chStats:S.chStats,missed:[...S.missed],theme:S.theme,homeLayout:S.homeLayout,`);

fs.writeFileSync(OUT, html);
console.log(`Home reworked — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
