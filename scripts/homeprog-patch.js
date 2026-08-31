#!/usr/bin/env node
/*
 * The progress bar under the pearl, given the weight the number deserves.
 *
 *   node scripts/homeprog-patch.js <in.html> <out.html>
 *
 * .home-progress already existed — a 9px line and two lines of 11-13px text,
 * sitting in open space between the pearl and the door row. Both are real
 * numbers (FSRS mastery over the whole bank, and how much of it has been
 * opened at all) but nothing about the presentation said they mattered: no
 * card, no legend, a bar thin enough to miss glancing past it.
 *
 * WHAT CHANGES, AND WHAT DOES NOT. The bar becomes a card — the same glass
 * recipe .off-card already uses two sections down, so it reads as a sibling
 * of the offline-download card rather than a new visual idiom. The track
 * triples in height. A legend spells out what the two fills mean instead of
 * asking the fellow to infer it from a single line of mixed units. The due
 * count — computed in buildHome() already, but previously surfaced only as a
 * word inside the Chapters door's subtitle — gets its own pill, because it is
 * the single most actionable number on the screen and it was the one hiding.
 *
 * WHAT DOES NOT CHANGE: per-chapter detail stays off the home screen. homeflow
 * cut this screen to three things on purpose — the trace, the pearl, the
 * progress — and everything else moved behind a door. Eleven chapter segments
 * here would undo that, and the Chapters screen is precisely where that
 * detail belongs.
 *
 * THE NUMBERS COUNT UP ON ENTRY, because a static "38%" sitting next to a bar
 * that visibly grows from zero reads as two different animations that forgot
 * to agree with each other. mountHomeProgress() ties them to the same clock.
 * Under prefers-reduced-motion the count is skipped and the final number is
 * written immediately — matching every other reduced-motion gate in this file,
 * which sets end states rather than leaving something frozen at zero.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/homeprog-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── the card ── */
patch('homeprog: .home-progress becomes a card, the track triples in height',
`.home-progress{margin:-4px 2px 18px;padding:0 2px}
.hp-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px}
.hp-cap{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.hp-val{font-family:var(--font-mono);font-size:13px;color:var(--dim)}
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
}`,
`.home-progress{margin:-4px 2px 18px;padding:17px 19px 19px;border-radius:19px;
  background:color-mix(in srgb, var(--white) 74%, transparent);
  backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);
  border:1.5px solid var(--border2);
  animation:riseIn .6s var(--glide) .18s both}
.hp-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:13px}
.hp-cap{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;
  letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
/* The one number on this screen that asks for something. Everything else here
   reports; this invites — so it is the one element styled to be pressed. */
.hp-due{display:inline-flex;align-items:center;gap:5px;padding:5px 8px 5px 12px;border-radius:99px;
  border:1.5px solid color-mix(in srgb, var(--amber) 45%, transparent);
  background:color-mix(in srgb, var(--amber) 15%, transparent);
  color:var(--amber);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;
  transition:transform .22s var(--spring),background .18s}
@media(hover:hover){.hp-due:hover{background:color-mix(in srgb, var(--amber) 22%, transparent)}}
.hp-due:active{transform:scale(.94)}
.hp-track{position:relative;height:22px;border-radius:12px;background:var(--border2);
  overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.12)}
.hp-seen,.hp-mast{position:absolute;top:0;bottom:0;left:0;border-radius:12px}
.hp-seen{background:color-mix(in srgb,var(--teal) 30%,transparent);
  animation:hpGrow 1.15s var(--glide) both}
.hp-mast{background:linear-gradient(90deg,var(--teal2),var(--teal));
  box-shadow:0 0 10px color-mix(in srgb,var(--teal) 55%,transparent);
  animation:hpGrow 1.15s var(--glide) .1s both}
.hp-shine{position:absolute;top:0;bottom:0;width:32%;pointer-events:none;border-radius:12px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.48),transparent);
  animation:hpShine 2.8s var(--glide) 1.15s infinite}
.hp-legend{display:flex;align-items:center;flex-wrap:wrap;column-gap:18px;row-gap:6px;margin-top:13px}
/* --muted, not --dim. --dim is this app's decorative tertiary token and
   measures 2.3:1 against this card on the two default light themes — below
   AA, and these are not decoration: they are the words that say what the
   number beside them counts. Measured across all eight themes rather than
   eyeballed; --muted clears 4.5:1 on every one. */
.hp-stat{display:inline-flex;align-items:baseline;gap:6px;font-size:13px;color:var(--muted)}
.hp-dot{width:8px;height:8px;border-radius:50%;flex:none;align-self:center}
.hp-dot-mast{background:linear-gradient(135deg,var(--teal2),var(--teal))}
.hp-dot-seen{background:color-mix(in srgb,var(--teal) 42%,transparent)}
.hp-num{font-family:var(--font-mono);font-weight:800;color:var(--text);font-variant-numeric:tabular-nums}
/* THE TWO NUMBERS MUST RANK EACH OTHER THE WAY THEIR BARS ALREADY DO. The
   mastered bar is a glowing teal gradient and the seen bar is a flat 30%
   wash — the bars say plainly that one of these matters more. The numbers
   used to be identical to each other (both --text at 800), so they said the
   opposite, and the reader got two contradictory rankings of the same pair.
   The obvious repair — tint the mastered number teal to match its bar — was
   measured and rejected: --teal against this card is 3.68:1 on the default
   light theme, so it would have dropped the single most important number on
   the home screen from 16:1 to below AA in order to decorate it. Demoting
   the secondary number says the same thing and costs nothing: mastered
   stays at full strength, seen recedes to the same --muted as its own
   label, and both stay comfortably readable. */
.hp-stat-sub .hp-num{color:var(--muted);font-weight:700}
.hp-stat-count{margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--muted)}
@keyframes hpGrow{from{width:0}}
@keyframes hpShine{0%{transform:translateX(-130%)}60%,100%{transform:translateX(380%)}}
@media(prefers-reduced-motion:reduce){
  .hp-seen,.hp-mast{animation:none}.hp-shine{display:none}
}`);

/* ── the markup ── */
patch('homeprog: legend, a due pill, and hooks for the count-up',
`    <div class="home-progress" aria-label="Bank progress">
      <div class="hp-head">
        <span class="hp-cap">Your progress</span>
        <span class="hp-val"><b>\${masteryPct}%</b> mastered · \${covered}% seen</span>
      </div>
      <div class="hp-track" role="progressbar" aria-valuenow="\${masteryPct}" aria-valuemin="0" aria-valuemax="100">
        <div class="hp-seen" style="width:\${covered}%"></div>
        <div class="hp-mast" style="width:\${masteryPct}%"><span class="hp-shine"></span></div>
      </div>
    </div>`,
`    <div class="home-progress" id="homeProgress" aria-label="Bank progress">
      <div class="hp-head">
        <span class="hp-cap">\${icon('trending-up','icon-sm')} Your progress</span>
        \${dueN?\`<button class="hp-due" onclick="startQuiz(null,'due')" aria-label="\${dueN} due for review">\${dueN} due \${icon('arrow-right','icon-sm')}</button>\`:''}
      </div>
      <div class="hp-track" role="progressbar" aria-valuenow="\${masteryPct}" aria-valuemin="0" aria-valuemax="100"
        aria-label="\${masteryPct}% mastered, \${covered}% seen">
        <div class="hp-seen" style="width:\${covered}%"></div>
        <div class="hp-mast" style="width:\${masteryPct}%"><span class="hp-shine"></span></div>
      </div>
      <div class="hp-legend">
        <span class="hp-stat"><i class="hp-dot hp-dot-mast"></i>Mastered <b class="hp-num" data-count="\${masteryPct}">0</b>%</span>
        <span class="hp-stat hp-stat-sub"><i class="hp-dot hp-dot-seen"></i>Seen <b class="hp-num" data-count="\${covered}">0</b>%</span>
        <span class="hp-stat-count">\${seenN} of \${TOTAL_Q}</span>
      </div>
    </div>`);

/* ── the mount function, in the same idiom as mountHero/mountInk/etc. ── */
patch('homeprog: mountHomeProgress ties the numbers to the same clock as the bar',
"function buildHome(){",
`/* Counts every .hp-num up from 0 to its data-count over the same window the
   bar spends growing. A no-op wherever the card is not on screen — called
   unconditionally from renderNow(), the same as every other mount* here. */
function mountHomeProgress(){
  const nums=document.querySelectorAll('#homeProgress .hp-num');
  if(!nums.length)return;
  const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  nums.forEach(el=>{
    const target=+el.dataset.count||0;
    if(reduced){ el.textContent=target; return; }
    const dur=900,start=performance.now();
    const tick=now=>{
      const t=Math.min(1,(now-start)/dur);
      const eased=1-Math.pow(1-t,3);
      el.textContent=Math.round(target*eased);
      if(t<1)requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function buildHome(){`);

patch('homeprog: mounted on every render, like the other home-screen widgets',
"  if(typeof mountInk==='function') mountInk();",
"  if(typeof mountInk==='function') mountInk();\n  if(typeof mountHomeProgress==='function') mountHomeProgress();");

fs.writeFileSync(OUT, html);
console.log(`Home progress card — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
