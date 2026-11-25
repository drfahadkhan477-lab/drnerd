/* ═════════════════════════════════════════════
   sessionbrain.js — where the reader is in a question session, drawn as a small brain.

   The question screen opened on a card that said the chapter, "1 of 129", "Resumed · start over" and a progress line.
   The owner had it taken away (November 2026), and then asked for one control in its place and Apex's: the Apex
   button became the master Apex Brain. On a question it wears a brain seen from above whose points of light are the
   session's questions, each lit by how it went, with a ring round it for how far the session has come, and says
   where the reader is ("6 of 20"). Tapped, it opens Apex, whose panel then begins with the session in one row (the
   chapter, the place, the counts and the share right), which opens on the brain (a question tapped there says how it
   went and is a way to go to it); asks that put Apex to work on the session (its misses, what next, a quiz) wait in
   the tray under the conversation with its other prompts. The owner asked for a clean chat window. Off a question the
   button is Apex as it was.

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
     orbHtml(m)                         the button's brain: the ring and the session's points, drawn small
     fabLabel(m)                        what the button says to a screen reader, and fabCount(m) the place it shows
     asks(m)                            the session's asks of Apex, [label, prompt]: its misses (when there are any),
                                        what to study next, a quiz; asksHtml(m, e) draws them for the tray under the chat
     dockHtml(m, sel, e, icon, open)    the panel's session: one row, the chapter, the place and the counts, that opens
                                        on the brain, the question picked and the way to it, and Start over when resumed

   m is { n, qIdx, states, items, chapter, resumed, fresh }: items the questions' own numbers in the bank (the asks name
   misses by them), fresh when the session changed since the button was last drawn (an answer, a move), which is the
   only time its halo brightens. The page hands it over (app/systole.html, syncApexBrain(), apexSessionHtml() and
   apexLocalHtml()), keeps which question is picked and whether the row is open, and answers the actions the markup
   names: toggleSessionDetail (the row), sessionBrainTap (a tap on the brain, which picks the nearest question),
   sessionBrainGo (data-i, the question to go to), apexAsk (data-ask, sent to Apex as typed) and quizStartOver.

   ALMOST NOTHING MOVES. The Brain page's sparks are a loop of frames; this is still vector drawing, redrawn when the
   screen is (an answer, a move), so it costs nothing between taps. The one motion is the question on screen's halo,
   which brightens twice when the session has changed (an answer, a move; not a redraw of the same) and then rests
   (app/css/gnav.css, opacity only, none when motion is reduced).
   Its depth and glow are drawn into the picture, not a filter or a blur over what lies behind it
   (tests/verify-glassbudget.js counts those).

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
   button's and the panel's can stand in one page. */
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

const at = m => Math.min((m.states || []).length, (m.qIdx || 0) + 1);
function orbHtml(m, id) {
  const list = m.states || [], c = counts(list), n = list.length;
  return '<svg class="sb-orb' + (m.fresh ? ' sb-fresh' : '') + '" viewBox="0 0 44 44" aria-hidden="true"><circle class="sb-orb-ground" cx="22" cy="22" r="19.5"/>'
    + '<circle class="sb-ring-track" cx="22" cy="22" r="19.5"/><circle class="sb-ring" cx="22" cy="22" r="19.5" stroke-dasharray="' + ringDash(c, 19.5) + '" transform="rotate(-90 22 22)"/>'
    + '<svg x="7" y="9" width="30" height="26" viewBox="' + GLYPH.view + '">' + glyph(id || 'sbP', 'sb-dots', layout(n), list, round1(dotR(n) * 1.9), true) + '</svg></svg>';
}
const fabCount = m => at(m) + ' of ' + (m.states || []).length;
function fabLabel(m) {
  const c = counts(m.states);
  return 'Apex, with this session: question ' + fabCount(m) + ', ' + c.right + ' right, ' + c.wrong + ' wrong. Open';
}

function asks(m) {
  const list = m.states || [], c = counts(list), n = list.length, ch = m.chapter ? ' on ' + m.chapter : '';
  const items = m.items || [], num = i => items[i] != null ? items[i] : i + 1;
  const missed = list.map((s, i) => s.state === 'wrong' ? num(i) : null).filter(v => v !== null);
  const out = [];
  if (missed.length) out.push(['Go over my ' + missed.length + (missed.length === 1 ? ' miss' : ' misses'),
    'Go over the question' + (missed.length === 1 ? '' : 's') + ' I missed in this session' + ch + ' (item' + (missed.length === 1 ? ' ' : 's ')
    + missed.join(', ') + '): ' + (missed.length === 1 ? '' : 'for each, ') + 'the idea it tests, why the answer I chose was wrong, and one line to remember.']);
  out.push(['What should I study next?', 'This session' + ch + ': ' + c.right + ' right and ' + c.wrong + ' wrong of ' + c.seen + ' answered, '
    + (n - c.seen) + ' to go. What should I study next, and why?']);
  out.push(['Quiz me', missed.length
    ? 'Quiz me with three short questions on the ideas behind the questions I missed in this session, one at a time, and wait for my answer to each.'
    : 'Quiz me with three short questions' + (m.chapter ? ' on ' + m.chapter : '') + ', one at a time, and wait for my answer to each.']);
  return out;
}

/* The session's asks of Apex, for the tray under the conversation (the ⚡ button), where its prompts are. */
function asksHtml(m, e) {
  return '<div class="src-strip sb-asks" role="group" aria-label="Ask Apex about this session"><span class="src-lbl">This session</span>'
    + asks(m).map(a => '<button class="src-pill sb-ask" type="button" data-action="apexAsk" data-ask="' + e(a[1]) + '">' + e(a[0]) + '</button>').join('') + '</div>';
}

/* The session at the head of Apex's panel: one row, the place and the counts, that opens (toggleSessionDetail) on the
   brain to pick a question and go to it, and Start over for a resumed session. Closed, it is one line over the chat. */
function dockHtml(m, sel, e, icon, open) {
  const list = m.states || [], c = counts(list), n = list.length, pts = layout(n);
  const pick = sel >= 0 && sel < n ? sel : (m.qIdx || 0), s = list[pick] || { state: 'unseen', current: false, flagged: false };
  const r = dotR(n), share = c.seen ? Math.round(100 * c.right / c.seen) + '% right' : 'none answered';
  const stat = (k, v, label) => '<span class="sb-stat" data-state="' + k + '"><b>' + v + '</b> ' + label + '</span>';
  const go = s.current ? '<p class="sb-here">The question on screen.</p>'
    : '<button class="sb-go" type="button" data-action="sessionBrainGo" data-i="' + pick + '">' + icon('arrow-right', 'icon-sm') + ' Go to question ' + (pick + 1) + '</button>';
  return '<section class="ai-session' + (open ? ' open' : '') + '" id="aiSession" aria-labelledby="sbTitle">'
    + '<button class="sb-row" type="button" data-action="toggleSessionDetail" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="sbDetail">'
    + '<span class="sb-mini" aria-hidden="true">' + orbHtml(m, 'sbR') + '</span>'
    + '<span class="sb-row-text"><span class="sb-title" id="sbTitle">' + e(m.chapter || 'Questions') + (m.resumed ? '<span class="sb-resumed"> · resumed</span>' : '') + '</span>'
    + '<span class="sb-where">Question ' + at(m) + ' of ' + n + '</span></span>'
    + '<span class="sb-stats">' + stat('right', c.right, 'right') + stat('wrong', c.wrong, 'wrong') + (c.flagged ? stat('flagged', c.flagged, 'flagged') : '')
    + '<span class="sb-stat" data-state="share"><b>' + share + '</b></span></span>'
    + '<span class="sb-chev" aria-hidden="true">' + icon('chevron-down', 'icon-sm') + '</span></button>'
    + '<div class="sb-detail" id="sbDetail"' + (open ? '' : ' hidden') + '>'
    + '<svg class="sb-brain" viewBox="' + GLYPH.view + '" role="group" aria-label="The session as a brain: a point for each of ' + n + ' questions, '
    + c.right + ' right, ' + c.wrong + ' wrong, ' + (n - c.seen) + ' not answered yet. Tap it, or use the arrow keys, to pick a question." tabindex="0" data-action="sessionBrainTap">'
    + glyph('sbB', 'sb-neurons', pts, list, r, false)
    + '<circle class="sb-pick" cx="' + (pts[pick] ? pts[pick].x : 0) + '" cy="' + (pts[pick] ? pts[pick].y : 0) + '" r="' + round1(r + 1.6) + '"/></svg>'
    + '<div class="sb-picked" aria-live="polite"><p class="sb-picked-t">' + e(said(s, pick)) + '</p>' + go + '</div>'
    + (m.resumed ? '<button class="q-restart" type="button" data-action="quizStartOver" title="Deal this chapter again from the beginning">Start over</button>' : '')
    + '</div></section>';
}

root.SessionBrain = { GLYPH, layout, states, counts, nearest, step, orbHtml, fabLabel, fabCount, asks, asksHtml, dockHtml, said, dotR };

})(typeof window !== 'undefined' ? window : this);
