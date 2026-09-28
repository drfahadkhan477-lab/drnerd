'use strict';
/* The older ACC bank, as the built app should carry it.
 *
 * tools/older-acc-import.js --merge adds questions filed under one chapter
 * ("Older ACC bank") to the export's own. The suites that count the bank —
 * verify-pwa's questions and figures, verify-chapters' tiles — used to hold
 * the whole of it to the export's totals, which a merge makes false. Raising
 * those numbers by hand would be prose leading the record, and would pass a
 * half-done merge. So the bank is split in two and each part held exactly:
 *
 *   the export's part  — still every question and figure the export has;
 *   the older part     — absent, or EXACTLY the staging on this machine
 *                        (source/older-staging/questions.json), no more, no
 *                        fewer, figure for figure.
 *
 * A build merged from a staging that has since been re-run, or one carrying
 * the older chapter with no staging here to compare against, fails: neither
 * can be told apart from a merge that went wrong. */
const fs = require('fs');
const path = require('path');
const { CATEGORY } = require('../tools/older-acc.js');

const STAGING = path.join(__dirname, '..', 'source', 'older-staging', 'questions.json');

function readStaging(file = STAGING) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const qs = JSON.parse(raw);
  return { count: qs.length, figs: qs.reduce((a, q) => a + ((q.figs || []).length), 0) };
}

/* qs: the bank as served. figsOf: how many figures a served question
   references. staged: readStaging()'s result, or null. */
function splitBank(qs, figsOf, staged) {
  const older = qs.filter(q => q && q.ch === CATEGORY);
  const exp = qs.filter(q => !(q && q.ch === CATEGORY));
  const sum = xs => xs.reduce((a, q) => a + figsOf(q), 0);
  const out = { exportCount: exp.length, exportFigs: sum(exp), olderCount: older.length, olderFigs: sum(older) };
  if (!older.length) return { ...out, ok: true, why: 'no older bank in this build' };
  if (!staged) return { ...out, ok: false, why: `${older.length} older-bank questions and no staging here to compare them with` };
  const ok = older.length === staged.count && out.olderFigs === staged.figs;
  return { ...out, ok, why: ok ? `older bank ${older.length} questions, ${out.olderFigs} figures — exactly the staging`
                                : `older bank ${older.length} questions / ${out.olderFigs} figures, staging ${staged.count} / ${staged.figs}` };
}

module.exports = { CATEGORY, STAGING, readStaging, splitBank };
