/* ═════════════════════════════════════════════
   sessionbrain.js — where the reader is in a question session, drawn as a small brain.

   The question screen opened on a card that said the chapter, "1 of 129", "Resumed · start over" and a progress line.
   The owner had it taken away (November 2026) for a control of its own, chosen from three drawn for them: a pill the
   size of the Apex button, at the other bottom corner, holding a brain seen from above whose points of light are the
   session's questions, each lit by how it went, with a ring round it for how far the session has come. Tapped, it
   opens a panel with the same brain large: a question tapped there says how it went and is a way to go to it.

   It is not the Brain page's brain (src/core/brain.js), which is a lilac side view of the whole bank lit by memory:
   the owner asked for a brain of its own, so this one is two hemispheres seen from above, in the app's cyan.

     GLYPH                              the drawing: viewBox, the two hemispheres, their folds
     layout(n)                          where each of n questions sits: alternately in the left and right hemisphere,
                                        each a sunflower spiral, so any session length fills the brain evenly
     states(questions, answers, qIdx, isFlagged)
                                        each question: 'right', 'wrong' or 'unseen', whether it is the one on screen,
                                        and whether it is flagged
     counts(states)                     how many right, wrong, flagged and seen, of how many
     nearest(points, x, y)              the question nearest a point of the drawing (a tap on the brain picks one)
     step(sel, key, n)                  the question an arrow key moves the pick to (Left and Up back, Right and Down on,
                                        Home and End the ends), or -1 for any other key
     pillHtml(m, e)                     the pill: the ring, the brain, and where the reader is ("12 of 40")
     panelHtml(m, sel, e, icon)         the panel: the brain large, the chapter and the counts, the question picked
                                        and the way to it, and Start over for a resumed session

   m is { n, qIdx, states, chapter, resumed, open, fresh }: fresh when the session changed since the pill was last drawn
   (an answer, a move), which is the only time its halo brightens. The page hands it over (app/systole.html, sessionBrainHtml()), keeps
   whether the panel is open and which question is picked, and answers the actions the markup names:
   toggleSessionBrain, sessionBrainTap (a tap on the brain, which picks the nearest question), sessionBrainGo
   (data-i, the question to go to) and quizStartOver.

   ALMOST NOTHING MOVES. The Brain page's sparks are a loop of frames; this is still vector drawing, redrawn when the
   screen is (an answer, a move), so it costs nothing between taps. The one motion is the question on screen's halo,
   which brightens twice when the session has changed (an answer, a move; not a redraw of the same) and then rests (app/css/gnav.css, opacity only, none when motion is reduced).
   Its depth and glow are drawn into the picture, not a filter or a blur over what lies behind it
   (tests/verify-glassbudget.js counts those). The panel is small on purpose (the owner's word): a brain a little
   wider than the pill, and beside it what the reader acts on.

   Pure: no DOM, no clock, no storage. ES2015; Safari 13.4 is the floor (README).
   tests/verify-sessionbrain-pure.js holds all of it.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const GLYPH = {
  view: '0 0 120 100',
  left: 'M57 12C45 8 30 12 22 22C12 26 6 38 9 48C4 58 8 72 18 78C22 88 36 94 48 90C53 92 57 90 57 86Z',
  right: 'M63 12C75 8 90 12 98 22C108 26 114 38 111 48C116 58 112 72 102 78C98 88 84 94 72 90C67 92 63 90 63 86Z',
  folds: ['M22 30C30 26 38 32 48 27', 'M13 46C22 42 30 50 40 45S52 44 55 47', 'M15 64C24 60 32 67 42 62', 'M24 80C32 76 40 82 50 78',
          'M98 30C90 26 82 32 72 27', 'M107 46C98 42 90 50 80 45S68 44 65 47', 'M105 64C96 60 88 67 78 62', 'M96 80C88 76 80 82 70 78'],
};
/* Each hemisphere's spiral: its centre, its half-width and half-height, and how much of them it fills. */
const HEMI = [{ cx: 34, cy: 52 }, { cx: 86, cy: 52 }], RX = 19, RY = 33, FILL = 0.82, GOLDEN = 2.399963;

const round1 = v => Math.round(v * 10) / 10;

function layout(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0)), out = [];
  const per = [Math.ceil(count / 2), Math.floor(count / 2)];
  for (let q = 0; q < count; q++) {
    const side = q % 2, i = Math.floor(q / 2), k = Math.sqrt((i + 0.5) / Math.max(1, per[side])) * FILL, t = i * GOLDEN;
    out.push({ x: round1(HEMI[side].cx + k * RX * Math.cos(t)), y: round1(HEMI[side].cy + k * RY * Math.sin(t)) });
  }
  return out;
}

function states(questions, answers, qIdx, isFlagged) {
  const qs = Array.isArray(questions) ? questions : [], ans = answers || {};
  return qs.map((q, i) => {
    const a = ans[i], picked = a && typeof a.selected === 'number' ? a.selected : null;
    const state = picked === null || !q ? 'unseen' : picked === q.ci ? 'right' : 'wrong';
    return { state, current: i === qIdx, flagged: !!(q && typeof isFlagged === 'function' && isFlagged(q.id)) };
  });
}

function counts(list) {
  const c = { right: 0, wrong: 0, flagged: 0, seen: 0, total: 0 };
  (list || []).forEach(s => { c.total++; if (s.state === 'right') c.right++; if (s.state === 'wrong') c.wrong++;
    if (s.state !== 'unseen') c.seen++; if (s.flagged) c.flagged++; });
  return c;
}

function step(sel, key, n) {
  if (!(n > 0)) return -1;
  const at = sel >= 0 && sel < n ? sel : 0;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(0, at - 1);
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(n - 1, at + 1);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return -1;
}
function nearest(points, x, y) {
  let best = -1, d = Infinity;
  (points || []).forEach((p, i) => { const dd = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (dd < d) { d = dd; best = i; } });
  return best;
}

/* How large a question's point is drawn: smaller as the session holds more, so a chapter of 130 still reads as points. */
const dotR = n => round1(Math.max(1.3, Math.min(3, 2.6 * Math.sqrt(40 / Math.max(1, n)))));

const WORD = { right: 'answered right', wrong: 'answered wrong', unseen: 'not answered yet' };
function said(s, i) {
  return 'Question ' + (i + 1) + ', ' + (s.current ? 'on screen, ' : '') + WORD[s.state] + (s.flagged ? ', flagged' : '');
}

/* The ring: the share of the session answered, so a session skipped through is not called done. */
function ringDash(c, r) {
  const len = 2 * Math.PI * r, frac = c.total ? c.seen / c.total : 0;
  return round1(len * frac) + ' ' + round1(len);
}

/* THE LOOK OF DEPTH, drawn rather than filtered (a filter is a pass the iPad pays for at every frame): each hemisphere is
   lit from the upper left by a radial gradient and shaded below by a second, the folds are pressed in with a dark line
   and a light one a little above it, and a soft highlight sits on each crown. The ids are the drawing's own (id), so the
   pill's and the panel's can stand in one page. */
function defs(id) {
  return '<defs><radialGradient id="' + id + 'L" cx="34%" cy="28%" r="78%"><stop offset="0" class="sb-l0"/><stop offset=".55" class="sb-l1"/><stop offset="1" class="sb-l2"/></radialGradient>'
    + '<linearGradient id="' + id + 'S" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" class="sb-s0"/><stop offset="1" class="sb-s1"/></linearGradient>'
    + '<radialGradient id="' + id + 'H" cx="50%" cy="50%" r="50%"><stop offset="0" class="sb-h0"/><stop offset="1" class="sb-h1"/></radialGradient></defs>';
}
function glyph(id, cls, pts, list, r, mini) {
  const hemis = d => '<path class="sb-hemi" d="' + d + '" fill="url(#' + id + 'L)"/><path class="sb-shade" d="' + d + '" fill="url(#' + id + 'S)"/>';
  const folds = mini ? '' : '<g class="sb-folds-dark" transform="translate(0 .7)">' + GLYPH.folds.map(d => '<path d="' + d + '"/>').join('') + '</g>'
    + '<g class="sb-folds-lit">' + GLYPH.folds.map(d => '<path d="' + d + '"/>').join('') + '</g>';
  const crowns = '<ellipse class="sb-crown" cx="33" cy="26" rx="' + (mini ? 15 : 13) + '" ry="' + (mini ? 9 : 7) + '" fill="url(#' + id + 'H)"/>'
    + '<ellipse class="sb-crown" cx="85" cy="26" rx="' + (mini ? 15 : 13) + '" ry="' + (mini ? 9 : 7) + '" fill="url(#' + id + 'H)"/>';
  const halos = pts.map((p, i) => list[i].current ? '<circle class="sb-halo" cx="' + p.x + '" cy="' + p.y + '" r="' + round1(r * 2.6) + '"/>' : '').join('');
  const dots = pts.map((p, i) => { const s = list[i];
    return '<circle class="sb-dot" data-state="' + s.state + '"' + (s.current ? ' data-current="1"' : '') + (s.flagged ? ' data-flagged="1"' : '')
      + ' cx="' + p.x + '" cy="' + p.y + '" r="' + r + '"/>'; }).join('');
  return defs(id) + hemis(GLYPH.left) + hemis(GLYPH.right) + folds + crowns
    + '<path class="sb-rim" d="' + GLYPH.left + '"/><path class="sb-rim" d="' + GLYPH.right + '"/>'
    + '<g class="' + cls + '">' + halos + dots + '</g>';
}

function pillHtml(m, e) {
  const list = m.states || [], c = counts(list), n = list.length, pts = layout(n), at = Math.min(n, (m.qIdx || 0) + 1);
  return '<button class="sb-pill' + (m.fresh ? ' sb-fresh' : '') + '" id="sbPill" type="button" data-action="toggleSessionBrain" aria-expanded="' + (m.open ? 'true' : 'false') + '"'
    + ' aria-controls="sbPanel" aria-label="This session, question ' + at + ' of ' + n + ': ' + c.right + ' right, ' + c.wrong + ' wrong. Show its brain">'
    + '<svg class="sb-orb" viewBox="0 0 44 44" aria-hidden="true"><circle class="sb-orb-ground" cx="22" cy="22" r="19.5"/>'
    + '<circle class="sb-ring-track" cx="22" cy="22" r="19.5"/><circle class="sb-ring" cx="22" cy="22" r="19.5" stroke-dasharray="' + ringDash(c, 19.5) + '" transform="rotate(-90 22 22)"/>'
    + '<svg x="7" y="9" width="30" height="26" viewBox="' + GLYPH.view + '">' + glyph('sbP', 'sb-dots', pts, list, round1(dotR(n) * 1.9), true) + '</svg></svg>'
    + '<span class="q-counter">' + at + ' of ' + n + '<span class="sr-only"> in this session</span></span></button>';
}

function panelHtml(m, sel, e, icon) {
  const list = m.states || [], c = counts(list), n = list.length, pts = layout(n);
  const pick = sel >= 0 && sel < n ? sel : (m.qIdx || 0), s = list[pick] || { state: 'unseen', current: false, flagged: false };
  const r = dotR(n);
  const chips = '<span class="sb-chip" data-state="right">' + c.right + ' right</span><span class="sb-chip" data-state="wrong">' + c.wrong + ' wrong</span>'
    + (c.flagged ? '<span class="sb-chip" data-state="flagged">' + c.flagged + ' flagged</span>' : '');
  const go = s.current ? '<p class="sb-here">The question on screen.</p>'
    : '<button class="sb-go" type="button" data-action="sessionBrainGo" data-i="' + pick + '">' + icon('arrow-right', 'icon-sm') + ' Go to question ' + (pick + 1) + '</button>';
  return '<div class="sb-panel" id="sbPanel" role="dialog" aria-labelledby="sbTitle">'
    + '<svg class="sb-brain" viewBox="' + GLYPH.view + '" role="group" aria-label="The session as a brain: a point for each of ' + n + ' questions, '
    + c.right + ' right, ' + c.wrong + ' wrong, ' + (n - c.seen) + ' not answered yet. Tap it, or use the arrow keys, to pick a question." tabindex="0" data-action="sessionBrainTap">'
    + glyph('sbB', 'sb-neurons', pts, list, r, false)
    + '<circle class="sb-pick" cx="' + (pts[pick] ? pts[pick].x : 0) + '" cy="' + (pts[pick] ? pts[pick].y : 0) + '" r="' + round1(r + 1.6) + '"/></svg>'
    + '<div class="sb-info"><p class="sb-eyebrow">This session' + (m.resumed ? ' · resumed' : '') + '</p>'
    + '<h2 class="sb-title" id="sbTitle" tabindex="-1">' + e(m.chapter || 'Questions') + '</h2>'
    + '<p class="sb-where">Question ' + Math.min(n, (m.qIdx || 0) + 1) + ' of ' + n + '</p>'
    + '<div class="sb-chips">' + chips + '</div></div>'
    + '<div class="sb-picked" aria-live="polite"><p class="sb-picked-t">' + e(said(s, pick)) + '</p>' + go + '</div>'
    + '<div class="sb-actions">' + (m.resumed ? '<button class="q-restart" type="button" data-action="quizStartOver" title="Deal this chapter again from the beginning">Start over</button>' : '')
    + '<button class="sb-done" type="button" data-action="toggleSessionBrain">Done</button></div></div>';
}

root.SessionBrain = { GLYPH, layout, states, counts, nearest, step, pillHtml, panelHtml, said, dotR };

})(typeof window !== 'undefined' ? window : this);
