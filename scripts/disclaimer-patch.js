#!/usr/bin/env node
/*
 * The app says what it is, in a structure a screen reader can navigate.
 *
 *   node scripts/disclaimer-patch.js <in.html> <out.html>
 *
 * TWO THINGS, ONE STEP, because they are one claim: an app that generates
 * clinical prose should say out loud what it is for, and should say it
 * somewhere the assistive-technology reading order can actually reach.
 *
 * THE DISCLAIMER. Checked before writing this: the string "educational",
 * "not medical advice", "not a substitute" and every neighbouring phrasing
 * appear exactly zero times anywhere in the app. For a board-review tool
 * whose tutor writes clinical explanations on demand, that is a real gap —
 * and the only finding from two external reviews that would matter to a
 * fellow rather than to a maintainer. Two placements:
 *
 *   · the Apex panel, directly above the model line, because that is where
 *     generated clinical text appears and so where the reminder belongs;
 *   · the Progress screen, beside the caveats it already lists, so the app
 *     states it outside the tutor too. NOT the home screen — see the note
 *     above that patch for why the layout tests were right to refuse it.
 *
 * Neither is dismissable. Both use --muted, never --dim: this repo's own
 * standing rule, and the entire reason contrastfix-patch.js exists.
 *
 * THE LANDMARKS. Measured, not assumed, against the current build:
 * document.querySelectorAll('main').length === 0 and
 * document.querySelectorAll('h1').length === 0. The shell is
 * <div id="shell"> → <div id="app">, and the hero title is
 * <div class="hero-h1">Systole</div>. So a screen-reader user gets no
 * "skip to main content" target and no document title in the heading tree,
 * despite the ARIA labelling elsewhere being decent (57 aria-* attributes,
 * 13 roles, alt text generated for every figure). Two tag swaps fix it.
 *
 * WHY THE CSS CHANGES WITH THE TAG. A <div> carries no user-agent styles; an
 * <h1> carries margin-block-start:.67em and font-weight:bold. Measured on
 * the current build, .hero-h1 computes to font-weight 400 and margin-top
 * 0px, so both are pinned explicitly here — the swap is a semantics change,
 * and must not be a visual one.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/disclaimer-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── the landmarks ───────────────────────────────────────────────────────── */

patch('disclaimer: #app becomes the <main> landmark it already was in fact',
`  <div id="app"></div>`,
`  <main id="app"></main>`);

patch('disclaimer: the hero title keeps its look, pinned against the h1 user-agent styles',
`.hero-h1{font-family:var(--font-display);font-size:48px;line-height:1;color:#fff;`,
`.hero-h1{font-family:var(--font-display);font-size:48px;line-height:1;color:#fff;
  margin-top:0;font-weight:400;`);

patch('disclaimer: the hero title becomes the document\'s one real <h1>',
`        <div class="hero-h1">Systole</div>`,
`        <h1 class="hero-h1">Systole</h1>`);

/* ── the disclaimer, and the two rules it needs ──────────────────────────── */

patch('disclaimer: styles, in the same quiet tier the model line already uses',
`.ai-powered{font-size:9px;color:var(--muted);text-align:center;padding:3px 0 8px;letter-spacing:.02em}`,
`.ai-powered{font-size:9px;color:var(--muted);text-align:center;padding:3px 0 8px;letter-spacing:.02em}
/* Never --dim: it fails AA at every theme, which is what contrastfix-patch.js
   exists to have settled. A disclaimer nobody can read is not a disclaimer.
   Sizes are steps on the type ladder, not round numbers — verify-type.js
   rejects any fixed font-size that is not, and rejected 10px here first. */
.ai-disclaim{font-size:var(--t-micro);line-height:1.5;color:var(--muted);text-align:center;
  padding:6px 14px 0;letter-spacing:.01em}
.app-disclaim{font-size:var(--t-tiny);line-height:1.5;color:var(--muted);
  margin:10px 0 0;max-width:60ch}`);

/* The same sentence in both of the panel's two states. buildAI() early-returns
   to the setup screen whenever no key is configured, so a disclaimer added only
   to the connected path would be invisible to exactly the fellow who has not
   set Apex up yet — which is the first thing anyone sees. Defined once here so
   the two placements cannot drift apart. Kept to one line at --t-micro on
   purpose: verify-chat.js requires the thread to hold >80% of the panel, and
   a two-line footer took it to 79%. The constraint is right — the thread is
   what the panel is for. */
const APEX_DISCLAIM =
`<div class="ai-disclaim">Study aid, not clinical advice — Apex can be wrong; ` +
`check anything that changes care.</div>`;

patch('disclaimer: the Apex panel says it, directly above the model line',
`<div class="ai-powered">Powered by `,
APEX_DISCLAIM + `<div class="ai-powered">Powered by `);

patch('disclaimer: and says it on the setup screen too, before a key is ever entered',
`    wrap.innerHTML=head+setupHtml(); bindSetup(); mountApexAvatar(); return; }`,
`    wrap.innerHTML=head+setupHtml()+\`${APEX_DISCLAIM}\`; bindSetup(); mountApexAvatar(); return; }`);

/* NOT the home screen, though that was the first instinct and the plan's own
   preference. verify-home.js asserts the home screen fits an 11-inch iPad in
   landscape with nothing to scroll (`over <= 0` at 1194x834); the disclaimer
   put it 54px over. That test is homeflow's "the home screen is three things"
   thesis, written down and enforced — a fourth block is exactly what it exists
   to refuse, and moving the threshold to fit a new element would be arguing
   with the design rather than reading it. The Progress screen already ends in
   a caveats block, in this same quiet tier, telling the fellow where their
   data lives and how it can be lost. That is the same kind of sentence, so it
   goes there and costs no layout guarantee anywhere. */
patch('disclaimer: the Progress screen says it, beside the caveats it already lists',
`        iPadOS can clear that for files opened directly from Files — export a backup before any system update.</div>`,
`        iPadOS can clear that for files opened directly from Files — export a backup before any system update.
        <p class="app-disclaim">For board preparation and education only — not a clinical
        decision-support tool, and not a substitute for current guidelines or professional
        judgement.</p></div>`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('disclaimer-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
