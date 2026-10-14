'use strict';
/*
 * Which bank a build is made from, and what belongs to ACCSAP 12 alone.
 *
 * A bank names itself in its manifest (docs/CONTENT-SCHEMA.md):
 *
 *     "bank": { "id": "accsap-12", "name": "ACCSAP 12", "by": "ACC" }
 *
 * id is what this file keys on; name is what the app calls the bank; by, when
 * the bank has one, is who wrote its commentary. src/core/bankpack.js checks
 * the block's shape wherever a bank is read. A manifest with no bank block is
 * ACCSAP 12's: every bank built before banks named themselves was, and the
 * content/ folders and iPad packages made then still are.
 *
 * The answer-key corrections (answer-keys.js) and the content flags
 * (content-flags.js) are facts about ACCSAP 12's questions, keyed by its ids.
 * On another bank they would stop the build ("[CON_16] not in the bank") or,
 * worse, rewrite a question that shares an id with one of ACCSAP's and is not
 * the one they were checked against. So they apply to the ACCSAP bank alone:
 * scripts/assemble-app.js, scripts/build-pwa.js (through shippedFixes below)
 * and tools/older-acc-import.js --merge each ask isAccsap() first.
 */
const { CORRECTIONS } = require('./answer-keys.js');
const { applyContentFlags } = require('./content-flags.js');

const ACCSAP = Object.freeze({ id: 'accsap-12', name: 'ACCSAP 12', by: 'ACC' });

/* The manifest's bank block, as its three fields, or ACCSAP 12 for a manifest
   that has none. */
function bankOf(manifest) {
  const b = manifest && manifest.bank;
  if (!b || typeof b !== 'object') return ACCSAP;
  return { id: b.id, name: b.name, by: b.by || '' };
}
const isAccsap = bank => !!bank && bank.id === ACCSAP.id;

/* The bank a built single file says it carries: its BANK_INFO line, which
   scripts/assemble-app.js fills, or ACCSAP 12 for a file made before the line
   existed (or the export itself, which has none). */
const BANK_INFO_RE = /\nconst BANK_INFO=(\{[^\n]*\});(?=\n)/;
function bankOfBuild(html) {
  const m = BANK_INFO_RE.exec(html);
  return m ? bankOf({ bank: JSON.parse(m[1]) }) : ACCSAP;
}

/* What the split build does to the bank it ships (scripts/build-pwa.js). For
   ACCSAP 12: prove every key correction reached it, which the single file's
   build applied, and apply the content flags, which leave a question already
   flagged alone. For any other bank: nothing. Returns the lines build-pwa
   prints; throws, naming ids only, when an ACCSAP correction is missing. */
function shippedFixes(questions, bank) {
  if (!isAccsap(bank)) return [`${bank.name} is not ${ACCSAP.name}: no ACCSAP key correction or content flag applies`];
  const byId = new Map(questions.map(q => [q.id, q]));
  const wrong = CORRECTIONS.filter(c => { const q = byId.get(c.id); return !q || 'ABCDEFGH'[q.ci] !== c.now; });
  if (wrong.length) {
    throw new Error(
      `${wrong.length} correction(s) did not reach the split build: ` +
      wrong.map(c => {
        const q = byId.get(c.id);
        return `${c.id} (ships ${q ? 'ABCDEFGH'[q.ci] : 'absent'}, should be ${c.now})`;
      }).join(', ') +
      `\n  scripts/assemble-app.js corrects ALL_Q before extract-content reads it.` +
      `\n  If they are missing here, that step did not run or extraction lost them.`);
  }
  return [`${CORRECTIONS.length} key corrections present in the shipped bank`, ...applyContentFlags(questions)];
}

module.exports = { ACCSAP, bankOf, isAccsap, bankOfBuild, BANK_INFO_RE, shippedFixes };
