/* ═══════════════════════════════════════════════════════════════════════════
   bankpack.js — is this file a question bank this app can use?

   The code-only deploy (scripts/build-pwa.js --no-content) ships the app with
   no bank in it: nothing licensed is hosted anywhere. The owner makes a
   package once on the laptop (tools/pack-content.js zips content/ — the
   bank, its figures and the manifest) and imports it on the iPad from Files.
   This is the check that stands between that zip and the database. It is
   pure — bytes in, a verdict out — so tests/verify-bankstore-pure.js drives
   every refusal in Node, and the page runs exactly the same function.

   WHAT IT REFUSES, and why each is fatal rather than a warning. An import
   that half-works is worse than one that says no, because a missing figure
   or a key out of range is found on a ward round, not on import day:
     · no manifest, or a schemaVersion this code does not know — a package
       from a newer or older packer must say so, not be guessed at;
     · no bank, or a bank that is not a list of questions;
     · a question without a usable id, a duplicate id, options that are not a
       list, or a key outside its options;
     · a figure name that could climb out of its folder, a figure the bank
       names that the zip does not carry, or bytes that are not the image
       their extension claims;
     · counts that disagree with the manifest the packer wrote;
     · an extra file (the reference notes' seed and figure files, under
       extra/) that the manifest lists and the zip lacks, whose name is not
       one this app asks for, or that is plainly not JSON.

   NOTHING HERE LOGS OR RETURNS QUESTION TEXT. Problems name ids, file names
   and counts only.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const SCHEMA = 1;
const SAFE_ID = /^[A-Za-z0-9_.-]{1,120}$/;
const SAFE_FIG = /^[A-Za-z0-9_.-]{1,160}\.(webp|png|jpg)$/;
const TYPE = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };
/* The only extra files the app fetches: the reference seed and the notes'
   figure files, one per unit (unit.2.json … for a large unit). */
const EXTRA = /^(refs-seed\.json|refs-images\/[A-Za-z0-9_-]+(\.[0-9]+)?\.json)$/;
const ascii = (b, from, to) => String.fromCharCode.apply(null, Array.prototype.slice.call(b, from, to));
const MAGIC = {
  webp: b => b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  png: b => b.length > 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG',
  jpg: b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
};

function readJSON(bytes) {
  if (!bytes) return { missing: true };
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch (_) { return { bad: true }; }
}

/* files: [{ name, bytes: Uint8Array }] — what ZipRead.read() returns. */
function validate(files) {
  const problems = [];
  const byName = new Map();
  for (const f of files || []) byName.set(String(f.name).replace(/^\.?\//, ''), f.bytes);

  const m = readJSON(byName.get('manifest.json'));
  const manifest = m.value;
  if (m.missing) problems.push('the package has no manifest.json');
  else if (m.bad) problems.push('manifest.json is not JSON');
  else if (!manifest || manifest.schemaVersion !== SCHEMA)
    problems.push(`manifest schemaVersion is ${manifest && manifest.schemaVersion}, this app reads ${SCHEMA}`);

  const qj = readJSON(byName.get('questions.json'));
  const questions = qj.value;
  if (qj.missing) problems.push('the package has no questions.json');
  else if (qj.bad) problems.push('questions.json is not JSON');
  else if (!Array.isArray(questions) || !questions.length) problems.push('questions.json is not a list of questions');

  const figures = [];
  if (Array.isArray(questions)) {
    const seen = new Set(), wanted = new Set();
    questions.forEach((q, i) => {
      const where = q && typeof q.id === 'string' ? q.id : `question ${i + 1}`;
      if (!q || typeof q.id !== 'string' || !SAFE_ID.test(q.id) || q.id.includes('..')) { problems.push(`${where}: no usable id`); return; }
      if (seen.has(q.id)) problems.push(`${q.id}: the id appears twice`);
      seen.add(q.id);
      if (typeof q.ch !== 'string' || !q.ch) problems.push(`${q.id}: no chapter`);
      if (!Array.isArray(q.o) || q.o.length < 2) problems.push(`${q.id}: its options are not a list`);
      else if (!Number.isInteger(q.ci) || q.ci < 0 || q.ci >= q.o.length) problems.push(`${q.id}: its key is outside its options`);
      for (const f of (q.figs || [])) {
        if (typeof f !== 'string' || !SAFE_FIG.test(f) || f.includes('..')) { problems.push(`${q.id}: a figure name that is not safe`); continue; }
        wanted.add(f);
      }
    });
    for (const f of wanted) {
      const bytes = byName.get('figures/' + f);
      const ext = f.slice(f.lastIndexOf('.') + 1);
      if (!bytes) { problems.push(`figures/${f} is named by the bank but not in the package`); continue; }
      if (!MAGIC[ext](bytes)) { problems.push(`figures/${f} is not a ${ext} file`); continue; }
      figures.push({ name: f, bytes, type: TYPE[ext] });
    }
    if (manifest && Number.isInteger(manifest.questions) && manifest.questions !== questions.length)
      problems.push(`the manifest says ${manifest.questions} questions, the bank holds ${questions.length}`);
    if (manifest && Number.isInteger(manifest.figures) && manifest.figures !== wanted.size)
      problems.push(`the manifest says ${manifest.figures} figures, the bank names ${wanted.size}`);
  }

  /* Extras are optional; a package without the notes is still a bank. What
     the manifest lists must be there, named as the app names them, and look
     like JSON — parsed only when the app asks for it, not here, because a
     unit's figure file is megabytes and an iPad pays for every parse. */
  const extras = [];
  const listed = manifest && Array.isArray(manifest.extras) ? manifest.extras : [];
  for (const name of listed) {
    if (typeof name !== 'string' || !EXTRA.test(name)) { problems.push(`extra ${JSON.stringify(String(name).slice(0, 60))} is not a file this app reads`); continue; }
    const bytes = byName.get('extra/' + name);
    if (!bytes) { problems.push(`extra/${name} is listed in the manifest but not in the package`); continue; }
    let i = 0; while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
    if (bytes[i] !== 0x7b && bytes[i] !== 0x5b) { problems.push(`extra/${name} is not JSON`); continue; }
    extras.push({ name, bytes, type: 'application/json' });
  }

  return {
    ok: problems.length === 0,
    problems: problems.slice(0, 50),
    problemCount: problems.length,
    questions: problems.length ? null : questions,
    figures: problems.length ? null : figures,
    extras: problems.length ? null : extras,
    manifest: manifest || null,
  };
}

root.BankPack = { validate, SCHEMA };

})(typeof window !== 'undefined' ? window : this);
