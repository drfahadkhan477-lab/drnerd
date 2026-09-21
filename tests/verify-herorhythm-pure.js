#!/usr/bin/env node
/*
 * The home screen's rhythm rotation, without a home screen.
 *
 *   node tests/verify-herorhythm-pure.js
 *
 * No browser, no build. src/ui/heroRhythm.js says in its own header that it
 * is shaped this way — no DOM, no timers, every rule a small function — "so
 * the ... rules are each one small function you can call from a test without
 * a browser". Nobody then wrote that test. The only suite that touched it was
 * verify-polish, which drives a real build, which CI can never do, so the
 * rules were unprotected in the one place they could most cheaply be held.
 *
 * WHAT IT DEFENDS. Two things, and the second is not cosmetic. The rotation
 * must not show the same rhythm twice in a row, because a "random" pick that
 * repeats reads as broken rather than random. And vfib, asystole, torsades
 * and paced must stay OUT of it: those are teaching content inside Rhythm Lab
 * where somebody went looking for them, not ambient wallpaper on the screen a
 * study app opens on. Adding one to the playlist would be a one-word diff
 * with nothing to object.
 *
 * WHERE THE NO-REPEAT GUARANTEE ACTUALLY STOPS. It holds for a playlist whose
 * entries are unique, which the shipped one is, and this suite proves it
 * exhaustively rather than by sampling. It does NOT hold for a list
 * containing adjacent duplicates: the step-off moves one place, and one place
 * on from a duplicate is the same key again. That boundary is asserted below
 * rather than left implied, because heroRhythm.js's own comment raised
 * duplicate-containing lists as its reason for stepping instead of rerolling
 * — which is true of the hang it avoids, and was not true of the repeat it
 * appeared to promise. The comment has been narrowed to say so.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* Loaded the way verify-rhythms-pure loads its module: executed against a
   stand-in global, so what is tested is the file that ships rather than a
   copy of its logic kept here. */
const root = {};
/* eslint-disable-next-line no-new-func */
new Function(read('src/ui/heroRhythm.js')).call(root);
const H = root.HeroRhythm;

head('the module loaded and exposes what the app calls');
{
  ok('HeroRhythm is on the global it was given', !!H);
  const want = ['HERO_PLAYLIST', 'nextInPlaylist', 'resolveRhythm', 'beatDurationMs'];
  const missing = want.filter(k => !(H && k in H));
  ok('and exports every name this suite exercises', missing.length === 0, missing.join(', '));
}

head('the playlist is the thing the no-repeat rule depends on');
{
  const p = H.HERO_PLAYLIST;
  ok('it is a non-empty list', Array.isArray(p) && p.length > 0, `${p.length} rhythms`);
  ok('every entry is a non-empty string', p.every(k => typeof k === 'string' && k.length > 0));
  /* THE PRECONDITION, STATED. Everything in the next section is true because
     this is true; if a duplicate is ever added here, the no-repeat guarantee
     silently weakens and the section below is what would notice. */
  ok('and no rhythm appears in it twice', new Set(p).size === p.length,
     `${p.length} entries, ${new Set(p).size} distinct`);
}

head('it never shows the same rhythm twice in a row');
{
  const p = H.HERO_PLAYLIST;
  let cases = 0, repeats = [];
  /* Exhaustive, not sampled: every previous rhythm against every index the
     random source can land on. With the shipped playlist that is 19 x 19. */
  for (const prev of p) {
    for (let i = 0; i < p.length; i++) {
      const got = H.nextInPlaylist(prev, null, () => i / p.length);
      cases++;
      if (got === prev) repeats.push(`${prev}@${i}`);
    }
  }
  ok('every previous-rhythm and every landing spot was tried', cases === p.length * p.length,
     `${cases} cases`);
  ok('and not one of them returned the rhythm already on screen',
     repeats.length === 0, repeats.slice(0, 5).join(', '));
  ok('the result is always a member of the playlist',
     p.every(prev => p.every((_, i) => p.includes(H.nextInPlaylist(prev, null, () => i / p.length)))));
}

head('and the guarantee stops exactly where the list stops being unique');
{
  /* Not a defect to fix — the shipped playlist is unique and a list that is
     not cannot reach this function. It is asserted so the boundary is written
     down somewhere executable, instead of a comment implying the rule is
     unconditional. */
  const dup = ['a', 'a', 'b'];
  const landed = [0, 1, 2].map(i => H.nextInPlaylist('a', dup, () => i / 3));
  ok('a list with adjacent duplicates CAN return the previous rhythm',
     landed.includes('a'), `[a,a,b] after "a" → ${JSON.stringify(landed)}`);
  ok('stepping off still terminates — it never loops or returns nothing',
     landed.every(x => typeof x === 'string'), JSON.stringify(landed));
}

head('the alarming rhythms stay out of ambient rotation');
{
  const KEPT_OUT = ['vfib', 'asystole', 'torsades', 'paced'];
  const leaked = KEPT_OUT.filter(k => H.HERO_PLAYLIST.includes(k));
  ok('vfib, asystole, torsades and paced are not in the hero playlist',
     leaked.length === 0, leaked.join(', '));
  /* NON-VACUITY. "Absent from a list" is cheap to satisfy by accident — a
     typo in the name above would pass for ever. These are excluded because
     they are real rhythms the renderer knows how to draw, so the check is
     that they exist to be excluded. */
  const heart = blankComments(read('src/core/heart3d.js'));
  const unknown = KEPT_OUT.filter(k => !new RegExp(`['"]${k}['"]`).test(heart));
  ok('and each of them is a real rhythm the renderer knows, not a typo',
     unknown.length === 0, unknown.length ? `not found in heart3d.js: ${unknown.join(', ')}` : KEPT_OUT.join(', '));
}

head('a random source cannot walk off either end');
{
  const p = H.HERO_PLAYLIST;
  /* Math.random() is specified as [0,1), but this takes an injectable source
     and a caller could hand it one that is not. */
  ok('r() = 1 lands on the last rhythm, not past it',
     p.includes(H.nextInPlaylist(null, null, () => 1)), String(H.nextInPlaylist(null, null, () => 1)));
  ok('r() above 1 is clamped too', p.includes(H.nextInPlaylist(null, null, () => 4.2)));
  ok('a negative r() is clamped to the first', p.includes(H.nextInPlaylist(null, null, () => -0.5)));
  ok('an empty playlist returns nothing rather than throwing',
     H.nextInPlaylist('x', [], Math.random) === undefined);
  ok('a single-rhythm playlist returns it, even if it is the one on screen',
     H.nextInPlaylist('a', ['a'], Math.random) === 'a');
}

head('the beat duration is something a heart could actually do');
{
  const MIN = 280, MAX = 1600;
  const DEFAULT = H.beatDurationMs(68);
  ok('a normal rate gives a normal beat', DEFAULT === Math.round(60000 / 68), `${DEFAULT}ms at 68bpm`);
  for (const hr of [0, -5, undefined, null, NaN]) {
    ok(`hr ${String(hr)} falls back to the resting default rather than dividing by it`,
       H.beatDurationMs(hr) === DEFAULT, `${H.beatDurationMs(hr)}ms`);
  }
  ok('an implausibly slow rate is clamped, not left as a stalled animation',
     H.beatDurationMs(1) === MAX, `${H.beatDurationMs(1)}ms`);
  ok('an implausibly fast one is clamped, not left as a strobe',
     H.beatDurationMs(10000) === MIN, `${H.beatDurationMs(10000)}ms`);
  ok('and every rate in between stays inside the clamp',
     [20, 40, 60, 100, 150, 200, 260].every(hr => {
       const d = H.beatDurationMs(hr);
       return d >= MIN && d <= MAX;
     }));
  /* Faster heart, shorter beat — obvious, and the kind of thing an inverted
     clamp would break while every range check above still passed. */
  const rates = [40, 60, 80, 120, 180];
  const durations = rates.map(H.beatDurationMs);
  ok('a faster rate never produces a longer beat',
     durations.every((d, i) => i === 0 || d <= durations[i - 1]), durations.join(' ≥ '));
}

head('resolveRhythm answers from either registry, and never with nothing');
{
  const base = { sinus: { name: 'Sinus' }, afib: { name: 'AF' } };
  const extra = { wpw: { name: 'WPW' } };
  /* Read through a helper rather than `.name` directly. The failure these
     assert IS resolveRhythm returning nothing, and .name on nothing throws —
     which would end the run with a stack trace instead of a named failure,
     and skip whatever came after it. A dead check reports; it doesn't die. */
  const nameOf = v => (v && v.name);
  ok('a base rhythm resolves from the base table', nameOf(H.resolveRhythm('afib', base, extra)) === 'AF');
  ok('an extra rhythm resolves from the extra table', nameOf(H.resolveRhythm('wpw', base, extra)) === 'WPW');
  ok('an unknown key falls back to sinus rather than undefined',
     nameOf(H.resolveRhythm('nonsense', base, extra)) === 'Sinus',
     String(nameOf(H.resolveRhythm('nonsense', base, extra))));
  /* Two cases, and the first does NOT hold up the `|| null` tail — which is
     what I had it labelled as until deleting the tail left it green. With null
     tables every `&&` short-circuits to null already, so the check passed for
     a reason unrelated to the guard it named. Empty tables are the input that
     tells them apart: `{} && {}['x']` is undefined, and only the tail turns
     that into null. Both are kept, each saying which is which. */
  ok('null registries return null because && already short-circuits there',
     H.resolveRhythm('nonsense', null, null) === null);
  ok('and EMPTY registries return null too — the case the || null tail holds',
     H.resolveRhythm('nonsense', {}, {}) === null,
     String(H.resolveRhythm('nonsense', {}, {})));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
