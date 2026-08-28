#!/usr/bin/env node
/*
 * A home screen that says one thing, and a study page that holds the rest.
 *
 *   node scripts/homeflow-patch.js <input.html> <output.html>
 *
 * The home screen had grown into an index of itself: the hero, a pearl, a
 * progress bar, a story rail, five quick buttons, three feed cards and eleven
 * chapter tiles, all competing on one scroll. Everything was reachable and
 * nothing was foremost.
 *
 * So it is cut to three things that answer three questions — what is this
 * (the hero and its ECG), what should I know (the pearl), and where am I
 * (the progress bar) — with a row of doors underneath. Everything pushed off
 * it is not gone: the story rail, the review queue, the shuffle and the
 * eleven chapter tiles move to a Chapters page of their own, which is now a
 * place you go rather than a thing you scroll past.
 *
 * THE PEARL GETS ITS OWN RHYTHM. It is the one card meant to be read, so it
 * is the one card that moves: a live ECG runs along its foot, on the same
 * ECGMonitor the hero uses rather than a second animation invented for it.
 * Slower and shallower than the hero's — this one sits under prose and must
 * not compete with it — and it is a real trace of a real rhythm, not a
 * decorative squiggle.
 *
 * GLASS, WHERE GLASS MEANS SOMETHING. Translucency and blur go on the
 * surfaces that sit ABOVE content — the pearl and the doors — so the page
 * reads as layers rather than as a stack of opaque boxes. Anything that must
 * stay legible against a photograph keeps its own ground.
 *
 * THE LAYOUT SWITCH FOLLOWS ITS SUBJECT. Signal / Focus / Grid governed the
 * rail, the feed and the tile density — all of which now live on the study
 * page — so the switch moves there with them. It still stamps data-home on
 * both wraps, so the density it sets still reaches the hero.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/homeflow-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}
/* Removing a three-kilobyte span by quoting all of it would make this file
   unreadable and would break on a single character of drift somewhere in the
   middle. Both ends are asserted unique, exactly as patch() asserts its find,
   so a moved anchor still fails the build rather than cutting the wrong span. */
function cut(label, from, to) {
  const a = html.split(from).length - 1, b = html.split(to).length - 1;
  if (a !== 1) throw new Error(`[${label}] start anchor matched ${a} times\n${from.slice(0, 200)}`);
  if (b !== 1) throw new Error(`[${label}] end anchor matched ${b} times\n${to.slice(0, 200)}`);
  const i = html.indexOf(from), j = html.indexOf(to, i);
  if (j < 0) throw new Error(`[${label}] the end anchor comes before the start`);
  html = html.slice(0, i) + html.slice(j);
  applied.push(label);
}

/* ── 1. home stops computing what it no longer shows ─────────────────────────
   Every render was filtering the 638-question pool twenty-two times to build a
   story rail, three feed cards and eleven chapter tiles — all of which are
   about to live somewhere else. The same code follows the markup into
   buildStudy() below. */
cut('home: stop building the material that is moving out',
`  /* ── story rail: circular chapter rings, tap to drill ── */`,
`  return \`<div class="home-wrap anim-fade" data-home=`);

/* ── 2. what is left, and the doors under it ─────────────────────────────── */
patch('home: the layout switch goes with the material it governs',
`  return \`<div class="home-wrap anim-fade" data-home="\${S.homeLayout}">
    <div class="home-top">
      <div class="home-segs" role="tablist" aria-label="Home layout">
        \${HOME_LAYOUTS.map(([id,label])=>
          \`<button class="hl-seg\${S.homeLayout===id?' on':''}" role="tab"
             aria-selected="\${S.homeLayout===id}" onclick="setHomeLayout('\${id}')">\${label}</button>\`).join('')}
      </div>
    </div>
    <div class="hero-live">`,
`  return \`<div class="home-wrap anim-fade" data-home="\${S.homeLayout}">
    <div class="hero-live">`);

patch('home: three things, and a row of doors',
`    <div class="story-rail">\${stories}</div>

    <div class="quick-row">
      <button class="quick" onclick="openSearch()"><span>\${icon("search")}</span>Search</button>
      <button class="quick" onclick="goStats()"><span>\${icon("trending-up")}</span>Progress</button>
      <button class="quick" onclick="goLab()"><span>\${icon("activity")}</span>Rhythm Lab</button>
      <button class="quick" onclick="goRefs()"><span>\${icon('folder')}</span>Notes\${typeof REF!=='undefined'&&REF.length?\` \${REF.length}\`:''}</button>
      <button class="quick" onclick="goMemory()"><span>\${icon('book')}</span>Memory\${typeof Memory!=='undefined'&&Memory.count()?\` \${Memory.count()}\`:''}</button>
    </div>

    <div class="feed">
      \${reviewCard}
      \${missCard}
      <button class="feed-card all-card" onclick="startQuiz(null)">
        <div class="fc-top"><span class="fc-badge">FULL BANK</span></div>
        <div class="fc-title">Shuffle all \${TOTAL_Q}</div>
        <div class="fc-sub">Every chapter, random order</div>
        <div class="fc-cta">Start \${icon('arrow-right','icon-sm')}</div>
      </button>
    </div>

    <div class="section-label">Chapters</div>
    <div class="ch-tiles">\${chCards}</div>
  </div>\`;
}`,
`    <div class="door-row">
      <button class="door door-wide" onclick="goStudy()">
        <span class="door-ic">\${icon("book")}</span>
        <span class="door-txt"><b>Chapters</b><i>\${CHAPTERS.length} chapters · \${dueN?\`\${dueN} due for review\`:\`\${TOTAL_Q} questions\`}</i></span>
        <span class="door-go">\${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="door" onclick="openSearch()"><span class="door-ic">\${icon("search")}</span><span class="door-txt"><b>Search</b><i>the whole bank</i></span></button>
      <button class="door" onclick="goStats()"><span class="door-ic">\${icon("trending-up")}</span><span class="door-txt"><b>Progress</b><i>chapter by chapter</i></span></button>
      <button class="door" onclick="goRefs()"><span class="door-ic">\${icon('folder')}</span><span class="door-txt"><b>Notes</b><i>\${typeof REF!=='undefined'&&REF.length?\`\${REF.length} references\`:'your references'}</i></span></button>
      <button class="door" onclick="goMemory()"><span class="door-ic">\${icon('pin')}</span><span class="door-txt"><b>Memory</b><i>\${typeof Memory!=='undefined'&&Memory.count()?\`\${Memory.count()} things Apex knows\`:'what Apex knows'}</i></span></button>
      <button class="door door-wide" onclick="goLab()">
        <span class="door-ic">\${icon("activity")}</span>
        <span class="door-txt"><b>Rhythm Lab</b><i>every trace, drawn live</i></span>
        <span class="door-go">\${icon('arrow-right','icon-sm')}</span>
      </button>
    </div>
  </div>\`;
}

/* ── the page the material moved to ──────────────────────────────────────────
   The story rail, the review queue, the shuffle and the eleven chapter tiles,
   in a place where they are the subject rather than the remainder. The markup
   is the home screen's own, moved rather than rewritten — same classes, same
   handlers, same shapes — so nothing about the study material looks or
   behaves differently for having been given a door.

   The layout switch comes with it, because everything it governs is here. */
function buildStudy(){
  const dueN=dueQuestions().length, seenN=startedCount();

  const stories=CHAPTERS.map(ch=>{
    const m=masteryFor(ch), col=CH_COLORS[ch]||'var(--teal)';
    const R=27,C=2*Math.PI*R;
    return \`<button class="story" onclick="startQuiz(\${JSON.stringify(ch).replace(/"/g,'&quot;')})"
        style="--accent:\${col}" aria-label="\${e(ch)}, \${Math.round(m*100)} percent mastered">
      <span class="story-ring">
        <svg viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="\${R}" fill="none" stroke="var(--border)" stroke-width="4"/>
          <circle cx="32" cy="32" r="\${R}" fill="none" stroke="\${col}" stroke-width="4"
            stroke-dasharray="\${C}" stroke-dashoffset="\${C*(1-m)}" stroke-linecap="round"
            transform="rotate(-90 32 32)"/>
        </svg>
        <span class="story-ico">\${chIcon(ch)}</span>
      </span>
      <span class="story-lbl">\${e(CH_SHORT[ch]||ch.split(' ')[0])}</span>
    </button>\`;
  }).join('');

  const reviewCard=\`<button class="feed-card review-card\${dueN?' live':''}" onclick="startQuiz(null,'due')">
    <div class="fc-glow"></div>
    <div class="fc-top">
      <span class="fc-badge">\${dueN?'DUE NOW':'SPACED REPETITION'}</span>
      \${S.reviewStreak>0?\`<span class="fc-streak">\${S.reviewStreak}d \${icon("flame","icon-sm")}</span>\`:''}
    </div>
    <div class="fc-title">\${dueN?\`\${dueN} card\${dueN===1?'':'s'} ready\`:seenN?'All caught up':'Start your review queue'}</div>
    <div class="fc-sub">\${dueN?'Recall them before the curve drops':seenN?'Next reviews are scheduled':'Active recall, scheduled by FSRS-5'}</div>
    <div class="fc-cta">\${dueN?'Review now':'Begin'} \${icon('arrow-right','icon-sm')}</div>
  </button>\`;

  const missCard=S.missed.size>0?\`<button class="feed-card miss-card" onclick="startQuiz(null,'missed')">
    <div class="fc-top"><span class="fc-badge red">WEAK SPOTS</span></div>
    <div class="fc-title">\${S.missed.size} to reclaim</div>
    <div class="fc-sub">Questions you have missed at least once</div>
    <div class="fc-cta">Drill them \${icon('arrow-right','icon-sm')}</div>
  </button>\`:'';

  const chCards=CHAPTERS.map(ch=>{
    const cnt=POOL.filter(q=>q.ch===ch).length;
    const fig=POOL.filter(q=>q.ch===ch&&q.img).length;
    const st=S.chStats[ch]||{correct:0,total:0};
    const cp=st.total>0?Math.round(st.correct/st.total*100):-1;
    const m=masteryFor(ch);
    const col=CH_COLORS[ch]||'#5EEAD4';
    return \`<button class="ch-tile" onclick="startQuiz(\${JSON.stringify(ch).replace(/"/g,'&quot;')})"
        style="--accent:\${col}">
      <span class="ct-ico">\${chIcon(ch)}</span>
      <span class="ct-name">\${e(ch)}</span>
      <span class="ct-meta">\${cnt} Q\${fig?\` · \${fig} figures\`:''}</span>
      <span class="ct-bar"><i style="width:\${Math.round(m*100)}%"></i></span>
      <span class="ct-foot">\${cp>=0?\`\${cp}% correct\`:m>0?'in progress':'not started'}<b>\${Math.round(m*100)}%</b></span>
    </button>\`;
  }).join('');

  return \`<div class="home-wrap anim-fade study-wrap" data-home="\${S.homeLayout}">
    <div class="study-head">
      <button class="study-back" onclick="goHome()">\${icon('arrow-left','icon-sm')} Home</button>
      <div class="home-segs" role="tablist" aria-label="Home layout">
        \${HOME_LAYOUTS.map(([id,label])=>
          \`<button class="hl-seg\${S.homeLayout===id?' on':''}" role="tab"
             aria-selected="\${S.homeLayout===id}" onclick="setHomeLayout('\${id}')">\${label}</button>\`).join('')}
      </div>
    </div>

    <div class="study-title">
      <h2>Chapters</h2>
      <p>\${TOTAL_Q} questions across \${CHAPTERS.length} chapters, the review queue
         scheduled by FSRS-5, and the full shuffle.</p>
    </div>

    <div class="story-rail">\${stories}</div>

    <div class="feed">
      \${reviewCard}
      \${missCard}
      <button class="feed-card all-card" onclick="startQuiz(null)">
        <div class="fc-top"><span class="fc-badge">FULL BANK</span></div>
        <div class="fc-title">Shuffle all \${TOTAL_Q}</div>
        <div class="fc-sub">Every chapter, random order</div>
        <div class="fc-cta">Start \${icon('arrow-right','icon-sm')}</div>
      </button>
    </div>

    <div class="section-label">Chapters</div>
    <div class="ch-tiles">\${chCards}</div>
  </div>\`;
}
/* Scrolled to the top on the way in: arriving at a long page halfway down it
   is the classic single-page-app failure, and the doors are at the bottom of
   the home screen, which is exactly where the scroll would be left. */
function goStudy(){ S.screen='study'; render(); window.scrollTo(0,0); }`);

patch('home: give the study page a screen',
`    :S.screen==='results'?buildResults():S.screen==='refs'?buildRefs()
    :S.screen==='memory'?buildMemory()`,
`    :S.screen==='results'?buildResults():S.screen==='refs'?buildRefs()
    :S.screen==='memory'?buildMemory():S.screen==='study'?buildStudy()`);

/* ── 3. the pearl gets its own rhythm ────────────────────────────────────── */
patch('pearl: a trace along its foot',
`          <p class="pearl-body pearl-in" id="pearlBody">\${e(p.text)}</p>
          <button class="pearl-open" onclick="goRefs()">Open the note \${icon('arrow-right','icon-sm')}</button>
        </div>
        \${pearlFigure(p)}
      </div>\`; })()}`,
`          <p class="pearl-body pearl-in" id="pearlBody">\${e(p.text)}</p>
          <button class="pearl-open" onclick="goRefs()">Open the note \${icon('arrow-right','icon-sm')}</button>
        </div>
        \${pearlFigure(p)}
        <canvas id="pearlECG" class="pearl-ecg" aria-hidden="true"></canvas>
      </div>\`; })()}`);

patch('pearl: mount the trace on the same monitor the hero uses',
`let heroMon=null, heroHeart3d=null, heroHeart3dCanvas=null, heroRotateTimer=null, heroCurrentKind=null;
function mountHero(){
  if(heroMon){ heroMon.destroy(); heroMon=null; }`,
`let heroMon=null, heroHeart3d=null, heroHeart3dCanvas=null, heroRotateTimer=null, heroCurrentKind=null;
/* The same ECGMonitor the hero runs, deliberately: a second animation written
   for the pearl would be a second thing to keep beating, and the two would
   drift apart on the same screen. Slower and shallower, because this one sits
   under prose and must not compete with the sentence above it. */
let pearlMon=null;
function mountPearlECG(){
  if(pearlMon){ pearlMon.destroy(); pearlMon=null; }
  const cv=document.getElementById('pearlECG');
  if(!cv||typeof ECGMonitor==='undefined') return;
  const accent=(getComputedStyle(document.documentElement).getPropertyValue('--teal')||'#5EEAD4').trim();
  pearlMon=new ECGMonitor(cv,{kind:'sinus',speed:0.07,amp:13,lineWidth:1.6,color:accent});
  pearlMon.start();
}
function mountHero(){
  mountPearlECG();
  if(heroMon){ heroMon.destroy(); heroMon=null; }`);

/* ── 4. how it all looks ─────────────────────────────────────────────────── */
patch('pearl: glass, and room for the trace',
`.pearl-card{display:flex;gap:0;align-items:stretch;background:var(--white);
  border:1.5px solid var(--border2);border-radius:16px;overflow:hidden;
  margin:var(--s4,16px) 0 var(--s5,20px);animation:riseIn .6s var(--glide) .06s both}`,
`/* Glass goes where a surface sits ABOVE content — the pearl and the doors —
   so the screen reads as layers rather than a stack of opaque boxes. Anything
   that has to stay legible over a photograph keeps its own ground. */
.pearl-card{position:relative;display:flex;gap:0;align-items:stretch;
  background:color-mix(in srgb, var(--white) 82%, transparent);
  backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);
  border:1.5px solid var(--border2);border-radius:22px;overflow:hidden;
  box-shadow:0 1px 2px rgba(10,22,40,.04),0 12px 32px -12px rgba(10,22,40,.14);
  margin:var(--s5,20px) 0 var(--s5,20px);
  transition:box-shadow .4s var(--glide),transform .4s var(--glide);
  animation:riseIn .7s var(--glide) .06s both}
.pearl-card:hover{box-shadow:0 1px 2px rgba(10,22,40,.05),0 20px 44px -14px rgba(10,22,40,.20)}
/* The trace runs the full width along the foot — the card's pulse, not a
   panel of its own — and fades out at both ends so it reads as passing
   through rather than starting and stopping inside the card. */
.pearl-ecg{position:absolute;left:0;right:0;bottom:0;width:100%;height:42px;
  pointer-events:none;opacity:.5;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}`);

patch('pearl: it reads larger, and clears its own trace',
`.pearl-main{flex:1;min-width:0;padding:16px 18px}`,
`.pearl-main{flex:1;min-width:0;padding:22px 24px 46px}`);

patch('pearl: the sentence is the largest thing on the screen after the wordmark',
`.pearl-body{margin:0;font-family:var(--font-serif);font-size:19px;line-height:1.5;
  color:var(--ink);text-wrap:pretty}`,
`.pearl-body{margin:0;font-family:var(--font-serif);font-size:23px;line-height:1.45;
  color:var(--ink);text-wrap:pretty;letter-spacing:-.01em}
@media(max-width:900px){.pearl-body{font-size:19px}}`);

patch('home: doors, in glass — and the study page they open onto',
`@media(max-width:700px){
  .pearl-card{flex-wrap:wrap}
  .pearl-body{font-size:16px}`,
`/* Two wide doors and four small ones, so the grid closes evenly at every
   width: the material first, the tool that is a destination in its own right
   last, and the four rooms between them. Everything visible at once is the
   whole point of having moved the rest off this screen. */
.door-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:10px;
  margin-top:var(--s4,16px)}
.door{display:flex;align-items:center;gap:11px;text-align:left;
  padding:15px 16px;border-radius:16px;cursor:pointer;font-family:inherit;
  background:color-mix(in srgb, var(--white) 74%, transparent);
  backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);
  border:1.5px solid var(--border2);color:var(--ink);
  transition:transform .34s var(--spring),box-shadow .34s var(--glide),border-color .22s var(--ease);
  animation:riseIn .6s var(--glide) both}
.door:nth-child(1){animation-delay:.04s}.door:nth-child(2){animation-delay:.08s}
.door:nth-child(3){animation-delay:.12s}.door:nth-child(4){animation-delay:.16s}
.door:nth-child(5){animation-delay:.20s}.door:nth-child(6){animation-delay:.24s}
.door:hover{transform:translateY(-3px);border-color:var(--teal);
  box-shadow:0 14px 30px -14px rgba(10,22,40,.28)}
.door:active{transform:translateY(-1px) scale(.985)}
.door-wide{grid-column:1/-1;padding:18px 20px}
.door-ic{display:flex;flex:0 0 auto;color:var(--teal)}
.door-ic .icon{width:21px;height:21px}
.door-txt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.door-txt b{font-size:13px;font-weight:650;letter-spacing:-.01em}
.door-txt i{font-style:normal;font-size:11px;color:var(--dim);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.door-go{margin-left:auto;color:var(--dim);display:flex;
  transition:transform .28s var(--spring),color .2s}
.door:hover .door-go{color:var(--teal);transform:translateX(4px)}
/* The study page: a back door, the layout switch it inherited, and a title
   that says what the page is — it is entered deliberately now, so it may as
   well introduce itself. */
.study-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin-bottom:var(--s4,16px)}
.study-back{display:flex;align-items:center;gap:6px;padding:8px 13px;border-radius:11px;
  background:color-mix(in srgb, var(--white) 74%, transparent);
  backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);
  border:1.5px solid var(--border2);color:var(--muted);font-family:inherit;
  font-size:13px;font-weight:600;cursor:pointer;
  transition:color .2s,border-color .2s,transform .26s var(--spring)}
.study-back:hover{color:var(--teal);border-color:var(--teal);transform:translateX(-2px)}
.study-title{margin-bottom:var(--s4,16px);animation:riseIn .6s var(--glide) .04s both}
.study-title h2{margin:0;font-size:33px;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.study-title p{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dim);max-width:52ch}
@media(max-width:700px){
  .study-title h2{font-size:28px}
  .pearl-card{flex-wrap:wrap}
  .pearl-body{font-size:16px}`);

/* The Apex button is fixed to the bottom-right corner, and the doors are now
   the last thing on the home screen. Forty pixels of tail was enough when the
   bottom of the page was a grid of chapter tiles you were not aiming at; it
   is not enough when the last thing there is a button. */
patch('home: the last row clears the Apex button',
`.home-wrap{padding:20px 0 40px}`,
`.home-wrap{padding:20px 0 84px}`);

/* ── 5. the quick row leaves nothing behind ──────────────────────────────────
   The five stacked quick buttons were replaced by the doors, and no element
   carries .quick or .quick-row anywhere in the app any more. Eleven rules for
   them survive across the stylesheet, in the base sheet, in two data-home
   variants, in the icon-size table, in the spacing ladder and in a breakpoint.
   Dead CSS is not free: it is the next reader's false lead, and the spacing
   ladder in particular is meant to be the whole story of the app's structural
   rhythm rather than a list of classes that used to exist. */
patch('quick row: Focus has only the rail left to hide',
`html [data-home="focus"] .story-rail,
html [data-home="focus"] .quick-row{display:none}`,
`html [data-home="focus"] .story-rail{display:none}`);

patch('quick row: nothing for Grid to tighten',
`[data-home="grid"] .quick-row{margin-bottom:12px;gap:6px}
[data-home="grid"] .quick{padding:10px 4px}
`,
``);

patch('quick row: out of the icon-size table',
`.quick .icon{width:21px;height:21px}
`,
``);

patch('quick row: out of the spacing ladder',
`.quick{padding:var(--s3) var(--s1);gap:var(--s1)}
`,
``);

patch('quick row: the rules themselves',
`/* ── quick actions ── */
.quick-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:2px 0 16px}
.quick{display:flex;flex-direction:column;align-items:center;gap:5px;padding:12px 4px;
  border-radius:15px;border:1.5px solid var(--border2);background:var(--white);
  color:var(--muted);font-size:11px;font-weight:700;cursor:pointer;
  transition:transform .2s var(--spring),border-color .2s,color .2s}
.quick span{font-size:19px}
.quick:active{transform:scale(.94)}
@media(hover:hover){.quick:hover{border-color:var(--teal);color:var(--teal)}}

/* ── feed cards ── */`,
`/* ── feed cards ── */`);

patch('quick row: out of the narrow breakpoint',
`  .quick-row{grid-template-columns:repeat(2,1fr)}
`,
``);

fs.writeFileSync(OUT, html);
console.log(`Home flow — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
