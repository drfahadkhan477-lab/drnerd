'use strict';
/*
 * The pearls of the seeded notes, found at build time.
 *
 * Pearl.harvest() searched every run of every paragraph of every note at
 * launch — a dozen regular expressions, thousands of times — and on the
 * owner's laptop at an iPad's pace it was the largest cost left, blocking the
 * page just after the home screen appeared. The notes the app is seeded with
 * are fixed at build time, so this runs src/core/pearl.js's OWN bake() over
 * them and assemble-app fills the REF_PEARLS slot with the result.
 *
 * The table holds no note text: per note fingerprint, where its pearl sits
 * and its score (see "THE HARVEST, BAKED" in src/core/pearl.js). harvest()
 * checks every entry against the note it is given and searches exactly as
 * before when one does not fit, so a stale or missing table costs time, never
 * a wrong pearl.
 *
 * A module of its own so it can be tested without the reference notes the
 * real build reads (tests/verify-pearlbake-pure.js).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadPearl(root = ROOT) {
  const box = {};
  new Function('window', fs.readFileSync(path.join(root, 'src', 'core', 'pearl.js'), 'utf8'))(box);
  if (!box.Pearl || typeof box.Pearl.bake !== 'function') throw new Error('pearl-bake: src/core/pearl.js has no Pearl.bake');
  return box.Pearl;
}

/* seedJson: the REF_SEED payload, a JSON array of { title, body, … }. */
function bakePearls(seedJson, root = ROOT) {
  const notes = JSON.parse(seedJson || '[]');
  return JSON.stringify(loadPearl(root).bake(Array.isArray(notes) ? notes : []));
}

module.exports = { bakePearls, loadPearl };
