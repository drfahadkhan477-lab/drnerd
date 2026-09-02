#!/usr/bin/env node
/*
 * The saved blob's version, and the promise that an older build cannot eat a
 * newer one's data.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-schema.js <patched.html>
 *
 * The check that matters here is the round trip: a field this build has never
 * heard of goes into load() and comes back out of save() unchanged. Everything
 * else in this file is scaffolding around that one sentence.
 *
 * It has to run in a real browser because the thing under test is the app's
 * own save()/load() pair over a real localStorage, not a module that can be
 * required. The arithmetic-free parts — that SCHEMA_KEYS still lists exactly
 * what save() writes — could in principle be read out of the file as text, but
 * asserting it against a blob the running app actually produced is the version
 * that cannot be fooled by a comment.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-schema.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  const KEY = 'accsap12.v2';

  head('the blob says what shape it is in');
  {
    const r = await page.evaluate((KEY) => {
      if (typeof save !== 'function' || typeof DATA_SCHEMA_VERSION === 'undefined') return null;
      save();
      return { blob: JSON.parse(localStorage.getItem(KEY)), v: DATA_SCHEMA_VERSION };
    }, KEY);
    ok('the step is present at all', r !== null);
    ok('DATA_SCHEMA_VERSION is a positive integer', !!r && Number.isInteger(r.v) && r.v > 0, r ? String(r.v) : '—');
    ok('and save() stamps it into the blob', !!r && r.blob && r.blob.schemaVersion === r.v);
  }

  head('a field this build never heard of survives a load → save round trip');
  {
    /* The failure being prevented: two copies of a single-file app on two
       devices at two versions, which is the normal way this app is used. */
    const r = await page.evaluate((KEY) => {
      localStorage.setItem(KEY, JSON.stringify({
        schemaVersion: 99, theme: 'midnight', srs: {},
        boardReadiness: { score: 71, asOf: '2027-01-04' },
        somethingElse: [1, 2, 3],
      }));
      load();                       /* what boot does */
      save();                       /* what any answered question does */
      return JSON.parse(localStorage.getItem(KEY));
    }, KEY);
    ok('an unknown object field is still there afterwards',
       !!r.boardReadiness && r.boardReadiness.score === 71, JSON.stringify(r.boardReadiness));
    ok('and an unknown array field too, with its contents intact',
       Array.isArray(r.somethingElse) && r.somethingElse.join() === '1,2,3');
    ok('while this build still stamps its OWN version, not the one it read',
       r.schemaVersion === await page.evaluate(() => (typeof DATA_SCHEMA_VERSION === 'undefined' ? null : DATA_SCHEMA_VERSION)),
       String(r.schemaVersion));
    ok('and the fields this build does own are written from live state, not echoed back',
       Object.prototype.hasOwnProperty.call(r, 'chStats') && Object.prototype.hasOwnProperty.call(r, 'srs'));
  }

  head('SCHEMA_KEYS still describes what save() actually writes');
  {
    /* If save() gains a field and this list is not updated, that field is
       classified as foreign — it would round-trip, but it would also be
       written twice and read as somebody else's. Cheap to assert, and the
       assertion is against a blob the running app produced. */
    /* Guarded rather than dereferenced. On a build without this step a bare
       SCHEMA_KEYS throws a ReferenceError out of page.evaluate and takes every
       remaining check in the file with it — which reports as a crash rather
       than as the five honest failures it actually is. That is the discipline
       verify-pearl states for its canvas, and it is how this suite behaved the
       first time it was pointed at the pre-step build. */
    const r = await page.evaluate((KEY) => {
      if (typeof SCHEMA_KEYS === 'undefined') return null;
      localStorage.removeItem(KEY);
      load(); save();
      return { written: Object.keys(JSON.parse(localStorage.getItem(KEY))).sort(), declared: SCHEMA_KEYS.slice().sort() };
    }, KEY);
    const missing = r ? r.written.filter(k => !r.declared.includes(k)) : ['(no SCHEMA_KEYS)'];
    const extra = r ? r.declared.filter(k => !r.written.includes(k)) : ['(no SCHEMA_KEYS)'];
    ok('every field save() writes is declared', missing.length === 0, missing.join(', ') || 'none');
    ok('and nothing is declared that save() does not write', extra.length === 0, extra.join(', ') || 'none');
  }

  head('the stores that already exist keep working');
  {
    const r = await page.evaluate((KEY) => {
      /* Exactly the shape every install in the world holds today: no
         schemaVersion, because this step did not exist when it was written. */
      localStorage.setItem(KEY, JSON.stringify({ theme: 'parchment', sessionTotal: 12, srs: { q1: { ivl: 3 } } }));
      const raw = load();
      save();
      const after = JSON.parse(localStorage.getItem(KEY));
      return { raw, after };
    }, KEY);
    ok('an unversioned blob loads rather than being discarded', r.raw.sessionTotal === 12);
    ok('and is stamped on the next write, not backfilled on read',
       r.raw.schemaVersion === undefined && r.after.schemaVersion === 1);
    ok('with no stray foreign keys invented from its known fields',
       !Object.keys(r.after).some(k => !['schemaVersion', 'chStats', 'missed', 'theme', 'homeLayout',
         'sessionCorrect', 'sessionTotal', 'srs', 'reviewStreak', 'lastReviewDay', 'daily',
         'practice', 'sinceBackup', 'lastBackup'].includes(k)),
       Object.keys(r.after).join(', '));
  }

  head('a scheduled card records which scheduler scheduled it');
  {
    const r = await page.evaluate(() =>
      (typeof FSRS === 'undefined' ? null : { sv: FSRS.update(null, 3, '2026-09-02').sv, V: FSRS.SCHEDULER_VERSION }));
    ok('FSRS is on the page and exposes SCHEDULER_VERSION', !!r && Number.isInteger(r.V), r ? String(r.V) : '—');
    ok('and a card it schedules carries that version', !!r && r.sv === r.V);
  }

  head('being handed data from the future is said out loud, once');
  {
    const shown = await page.evaluate((KEY) => new Promise(resolve => {
      const t = document.getElementById('toast'); if (t) t.remove();
      localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 99, srs: {} }));
      load();
      /* The warning is deliberately deferred past the splash, so this waits
         rather than reading synchronously. */
      setTimeout(() => {
        const el = document.getElementById('toast');
        resolve(el ? el.textContent : '');
      }, 5200);
    }), KEY);
    ok('a blob from a newer build produces a visible warning', /older than the data/i.test(shown), shown || '(no toast)');
    const quiet = await page.evaluate((KEY) => new Promise(resolve => {
      const t = document.getElementById('toast'); if (t) t.remove();
      localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 1, srs: {} }));
      load();
      setTimeout(() => { const el = document.getElementById('toast'); resolve(el ? el.textContent : ''); }, 5200);
    }), KEY);
    ok('and an ordinary blob at this version produces none', quiet === '', quiet || '(silent)');
  }

  ok('no page errors along the way', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
