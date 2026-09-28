#!/usr/bin/env node
'use strict';
/*
 * Which sections of a reference unit are worth adding to the notes the app
 * already has — decided on the owner's laptop, by rules, without anyone
 * reading the unit.
 *
 *   node tools/refs-merge.js --from source/braunwald [--min-score 2] [--out source/refs-staging]
 *
 * --from is wherever the zip was unpacked: units are found at any depth.
 *
 * WHY. The owner has Braunwald units (heart failure, ischemia — a transcription
 * of the textbook with its page figures) and asked for what is new and high
 * yield to be added to Systole's notes. That text is licensed exactly as the
 * ACCSAP export is: it is not read in a Claude session and none of it is
 * quoted into one. So the choosing is done here, by measurable rules, and what
 * this prints is counts. The headings it kept and the borderline ones go to a
 * review file under --out, on the laptop, for the owner to read.
 *
 * WHAT IT DOES, per unit (each folder under --from that holds .md files):
 *
 *   1. Splits every .md into notes exactly as the importer and refs-patch do —
 *      one note per "## " section, titled by the file's front-matter title.
 *   2. Collapses the unit's own repeats. A unit ships its text more than once
 *      (a whole-unit file and the same pages split into ranges); a section
 *      whose word shingles are mostly inside one already kept is dropped,
 *      keeping the copy with more figures, then the longer.
 *   3. Drops what the app already has: a section whose shingles are mostly
 *      found in the existing notes (content/refs, less any bw-* unit this tool
 *      staged before, so a rerun compares against the owner's own notes).
 *   4. Keeps what is high yield by counting, per 100 words, the things board
 *      questions are made of: numeric thresholds with units, guideline classes
 *      and levels of evidence, trial effect sizes, first-line/contraindicated
 *      language, tables, and figures. Sections under the importer's 40-word
 *      floor, and sections headed History, Introduction, References and the
 *      like, are dropped. The score distribution is printed, so the cut can be
 *      moved with --min-score without reading anything.
 *   5. Writes the kept sections, unchanged and in their original order, to
 *      --out/<unit>/<unit>-selected.md under the source file's front matter,
 *      ready for tools/add-unit.py to bake with the unit's crop record.
 *
 * UNIT NAMES are bw-<folder> (bw-heart-failure, bw-ischemia), never an existing
 * unit's: add-unit replaces content/refs/<unit>-*.md wholesale, so baking a
 * selection under an existing name would delete the notes it was measured
 * against.
 *
 * The rules are plain functions, exported, and tests/verify-refsmerge-pure.js
 * runs them on synthetic notes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIN_WORDS = 40;          // the importer's own floor (refs-patch rejects thinner notes)
const SHINGLE = 5;             // words per shingle
const DUP_WITHIN = 0.8;        // a section this much inside one already kept is the same section
const COVERED = 0.6;           // this much of a section already in the notes is covered
const DEFAULT_MIN_SCORE = 2;   // high-yield signals per 100 words

/* tools/check-refs.js's floors, which the suites enforce on every note:
   BACKREF is its pattern character for character (verify-refsmerge-pure reads
   check-refs.js and compares), MAX_WORDS its ceiling, MIN_TAGS its tag count. */
const BACKREF = /\b(as discussed (above|below)|see (the section|below|above)|the previous section|mentioned earlier)\b/i;
const MAX_WORDS = 600, MIN_TAGS = 4;
const LOW_YIELD_HEADING = /\b(history|historical|introduction|overview of (the )?chapter|references?|classic references|key references|acknowledg\w*|future (directions|perspectives)|conclusions?|summary of changes|disclosures?|abbreviations)\b/i;

/* ── parsing, as the importer does it ────────────────────────────────────── */
function field(fm, key) {
  const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(fm);
  return m ? m[1].trim() : '';
}
function parseNotes(raw, fallbackTitle) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const meta = fm ? fm[1] : '';
  const body = (fm ? raw.slice(fm[0].length) : raw).replace(/\r\n/g, '\n');
  const title = field(meta, 'title') || fallbackTitle;
  const sections = body.split('\n## ').slice(1).map(sec => {
    const lines = sec.split('\n');
    return { heading: lines[0].trim(), body: lines.slice(1).join('\n').trim() };
  });
  return { meta, title, sections };
}

/* ── comparing ───────────────────────────────────────────────────────────── */
const IMG = /!\[[^\]]*\]\((?:<[^>\n]+>|[^)\s]+)\)/g;
function words(text) {
  return text.replace(IMG, ' ').replace(/[#*_`>|\[\]()]/g, ' ').toLowerCase()
    .replace(/[^a-z0-9%.\- ]+/g, ' ').split(/\s+/).filter(w => w && w !== '-' && w !== '.');
}
/* check-refs' own measure — whitespace tokens, links and all. add-unit only
   shortens links, so a count taken here is an upper bound on its. */
const tokens = text => text.split(/\s+/).filter(Boolean).length;
function shingles(text) {
  const w = words(text), out = new Set();
  if (w.length < SHINGLE) { if (w.length) out.add(hash(w.join(' '))); return out; }
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(hash(w.slice(i, i + SHINGLE).join(' ')));
  return out;
}
function hash(s) { return crypto.createHash('sha1').update(s).digest('base64').slice(0, 12); }
/* How much of `set` is inside `index` (another set, or a Set of many notes' shingles). */
function containment(set, index) {
  if (!set.size) return 0;
  let n = 0;
  for (const s of set) if (index.has(s)) n++;
  return n / set.size;
}

/* ── high yield, by counting ─────────────────────────────────────────────── */
const SIGNALS = [
  ['threshold', /\b\d+(?:\.\d+)?\s?(?:mm ?hg|%|ms|msec|mg|µg|mcg|g\/dl|mg\/dl|mmol\/l|meq|ng\/ml|pg\/ml|ml\/kg|ml\/min|ml|l\/min|kg\/m2|m\/s|cm\/s|cm2|mm2|cm|mm|bpm|beats\/min|joules|j\b|hours?|days?|weeks?|months?|years?)\b/gi],
  ['comparator', /(?:[<>≤≥]\s?\d)|\b(?:greater|less|more|fewer) than \d/gi],
  ['guideline', /\bclass (?:i{1,3}|iia|iib|1|2a|2b|3)\b|\blevel of evidence\b|\bloe\b|\b(?:cor|coe)\s?[:\-]?\s?(?:i|ii|iii|1|2|3)|\brecommended\b|\bshould (?:be|not)\b|\bis (?:reasonable|not recommended)\b/gi],
  ['effect', /\b(?:hazard ratio|relative risk|odds ratio|absolute risk|nnt|number needed to treat|hr|rr|or)\s?[=:,]?\s?0?\.\d+|\breduc(?:ed|tion) (?:in )?(?:all-cause )?(?:mortality|death|hospitali[sz]ation|events)\b|\b\d+(?:\.\d+)?% (?:relative )?(?:reduction|increase)\b/gi],
  ['decision', /\bfirst[- ]line\b|\bcontraindicat\w*\b|\bdrug of choice\b|\bgold standard\b|\bdiagnostic of\b|\bpathognomonic\b|\bhallmark\b|\bmost common\b|\bindicated\b/gi],
  ['table', /^\|.*\|\s*$/gm],
  ['figure', IMG],
];
function scoreSection(body) {
  const n = words(body).length;
  const hits = {};
  let total = 0;
  for (const [name, re] of SIGNALS) {
    const c = (body.match(re) || []).length;
    hits[name] = c;
    total += name === 'table' ? Math.min(c, 12) / 4 : name === 'figure' ? c * 2 : c;   // a table row is worth less than a threshold; a figure more
  }
  return { words: n, hits, score: n ? (total * 100) / n : 0 };
}

/* ── the whole decision, for one unit ────────────────────────────────────── */
/* A figure link into visuals/ is a cropped figure (the crop records cover
   those); any other local image link in a unit is a whole-page scan (pages/,
   images/), which is removed rather than baked. */
const isFigureLink = link => /\((?:<)?(?:\.\/)?visuals\//i.test(link);
function stripScans(body) {
  return body.replace(IMG, m => isFigureLink(m) ? m : '').replace(/\n{3,}/g, '\n\n').trim();
}
/* An atlas: a file whose entries are "### " headings, most carrying a figure. */
function atlasEntries(parsed) {
  const out = [];
  for (const s of parsed.sections) {
    /* The body usually opens WITH the first "### " (trimmed, no newline before
       it); splitting on "\n### " alone dropped that first figure as preamble. */
    const parts = ('\n' + s.body).split(/\n### /);
    parts.slice(1).forEach(p => { const l = p.split('\n'); out.push({ heading: l[0].trim(), body: l.slice(1).join('\n').trim() }); });
  }
  return out;
}
/* Most entries must carry a CROPPED figure (visuals/). A file of one "### "
   per page each linking its page scan (images/) looked like an atlas to the
   first version of this test — 302 page scans counted as figures. */
function isAtlas(parsed) {
  const e = atlasEntries(parsed);
  return e.length >= 20 && e.filter(x => (x.body.match(IMG) || []).some(isFigureLink)).length >= e.length / 2;
}
/* A page is ~850 words with no subheadings; notes of that size are neither
   findable nor quotable. Paragraphs are gathered into chunks of CHUNK_MIN to
   CHUNK_MAX words, each its own candidate, headed by its page. */
const CHUNK_MIN = 120, CHUNK_MAX = 350;
/* A paragraph longer than a chunk is cut at sentence ends. The owner's run
   showed the pages have no blank lines at all: ~650 chunks from ~650 pages. */
function units(body) {
  const out = [];
  for (const p of body.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) {
    if (words(p).length <= CHUNK_MAX) { out.push(p); continue; }
    /* A split at the gaps, not a match of the sentences: the first version
       matched, and a match that fails at "4.5" or ".jpg" skips ahead —
       silently dropping "LVEF 4" and half a figure link. */
    const sentences = p.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z(\[!])/);
    let cur = '', n = 0;
    /* and a sentence longer than a chunk (a run-on table flattened to text)
       at word boundaries, so no piece can outgrow check-refs' ceiling. */
    const pieces = [].concat(...sentences.map(x => x.trim()).filter(Boolean).map(t => {
      if (words(t).length <= CHUNK_MAX) return [t];
      const tok = t.split(/\s+/), cut = [];
      for (let i = 0; i < tok.length; i += CHUNK_MAX) cut.push(tok.slice(i, i + CHUNK_MAX).join(' '));
      return cut;
    }));
    for (const t of pieces) {
      const w = words(t).length;
      if (n && n + w > CHUNK_MAX) { out.push(cur); cur = ''; n = 0; }
      cur = cur ? cur + ' ' + t : t; n += w;
    }
    if (cur) out.push(cur);
  }
  return out;
}
function chunks(section) {
  const body = stripScans(section.body);
  if (words(body).length <= CHUNK_MAX) return [{ heading: section.heading, body }];
  const paras = units(body);
  const out = []; let cur = [], n = 0;
  for (const p of paras) {
    const w = words(p).length;
    if (n && n + w > CHUNK_MAX && n >= CHUNK_MIN) { out.push(cur.join('\n\n')); cur = []; n = 0; }
    cur.push(p.trim()); n += w;
  }
  if (cur.length) { if (out.length && n < CHUNK_MIN) out[out.length - 1] += '\n\n' + cur.join('\n\n'); else out.push(cur.join('\n\n')); }
  return out.map((b, i) => ({ heading: out.length > 1 ? `${section.heading} (${i + 1}/${out.length})` : section.heading, body: b }));
}
const linkName = m => { const d = /\((<[^>\n]+>|[^)\s]+)\)$/.exec(m); return d ? path.basename(d[1].replace(/[<>]/g, '')) : ''; };

function selectUnit(files, existingIndex, { minScore = DEFAULT_MIN_SCORE, existingFigures = new Set() } = {}) {
  const cands = [];
  for (const f of files) {
    const parsed = parseNotes(f.raw, f.name.replace(/\.md$/i, ''));
    const atlas = isAtlas(parsed);
    const pieces = atlas
      ? [].concat(...atlasEntries(parsed).map(e => tokens(e.body) > MAX_WORDS ? chunks(e) : [e]))
      : [].concat(...parsed.sections.map(chunks));
    pieces.forEach((s, i) => {
      const sh = shingles(s.body);
      const figs = s.body.match(IMG) || [];
      cands.push({ file: f.name, index: i, meta: parsed.meta, title: parsed.title, kind: atlas ? 'figure' : 'text', ...s, sh,
                   figures: figs.length, figNames: figs.map(linkName), ...scoreSection(s.body) });
    });
  }
  const tally = { sections: cands.length, repeat: 0, covered: 0, thin: 0, backref: 0, lowHeading: 0, lowScore: 0, kept: 0, figures: 0, keptFigures: 0,
                  figureEntries: cands.filter(c => c.kind === 'figure').length };
  const kept = [], keptIndex = new Set(), dropped = [];
  /* The unit's own repeats first: richest copy wins. */
  const order = [...cands].sort((a, b) => b.figures - a.figures || b.words - a.words);
  const unique = [];
  for (const c of order) {
    if (containment(c.sh, keptIndex) >= DUP_WITHIN) { tally.repeat++; continue; }
    unique.push(c); for (const s of c.sh) keptIndex.add(s);
  }
  /* Figures in atlas order, so a short caption joins the figure beside it. */
  const figureOrder = unique.filter(c => c.kind === 'figure').sort((a, b) => a.file.localeCompare(b.file) || a.index - b.index);
  let group = null;
  const joinedTokens = (a, b) => tokens(a.body) + tokens(b.heading) + 1 + tokens(b.body);
  const join = (a, b) => { a.body += `\n\n### ${b.heading}\n${b.body}`; a.words += b.words; a.figures += b.figures;
                           a.joined = (a.joined || 0) + 1 + (b.joined || 0); a.figNames = (a.figNames || []).concat(b.figNames || []); };
  const closeGroup = () => { if (group) { kept.push(group); tally.kept++; tally.keptFigures++; group = null; } };
  for (const c of figureOrder) {
    if (c.figNames.some(n => existingFigures.has(n)) || containment(c.sh, existingIndex) >= COVERED) { tally.covered++; dropped.push({ ...c, why: 'covered' }); continue; }
    if (BACKREF.test(c.body)) { tally.backref++; dropped.push({ ...c, why: 'backref' }); continue; }
    tally.figures += c.figures;
    /* A caption under the importer's floor is not dropped — the figure would
       be lost for want of words. It joins the next figure (or, last of all,
       the one before) in one note, until that note clears the floor. */
    /* Never past check-refs' ceiling: a figure that would push the note over
       it stands alone, and the short note stays open for the next one. */
    if (group && joinedTokens(group, c) > MAX_WORDS) { kept.push({ ...c, joined: 0 }); tally.kept++; tally.keptFigures++; continue; }
    if (!group) group = { ...c, joined: 0 };
    else join(group, c);
    if (group.words >= MIN_WORDS) closeGroup();
  }
  if (group) {
    const prev = [...kept].reverse().find(k => k.kind === 'figure' && joinedTokens(k, group) <= MAX_WORDS);
    if (prev) { join(prev, group); group = null; }
    else { tally.thin++; dropped.push({ ...group, why: 'thin' }); group = null; }
  }
  for (const c of kept) if (c.joined) c.heading += ` (with ${c.joined} more figure${c.joined > 1 ? 's' : ''})`;
  for (const c of unique) {
    if (c.kind === 'figure') continue;
    let why = '';
    if (containment(c.sh, existingIndex) >= COVERED) why = 'covered';
    else if (c.words < MIN_WORDS) why = 'thin';
    else if (BACKREF.test(c.body)) why = 'backref';
    else if (LOW_YIELD_HEADING.test(c.heading)) why = 'lowHeading';
    else if (c.score < minScore) why = 'lowScore';
    if (why) { tally[why]++; dropped.push({ ...c, why }); continue; }
    kept.push(c); tally.kept++; tally.figures += c.figures;
  }
  keyTerms(kept);
  /* Back into reading order: by file, then by position in it. */
  const byFile = f => files.findIndex(x => x.name === f);
  kept.sort((a, b) => byFile(a.file) - byFile(b.file) || a.index - b.index);
  return { tally, kept, dropped, scores: unique.filter(c => c.kind === 'text').map(c => c.score) };
}

/* A title someone could search by. The importer titles each note
   "<file title> — <heading>", and the headings these units carry are
   "PDF Page 162 (2/3)" and "FIG.59.9 — PDF page 162": hundreds of notes a
   digit apart, so a search for one lands on its neighbours. The owner's run
   measured it: R@1 from a note's own title fell to 50%. A page heading gives
   way to the passage's opening words; a figure keeps its number and gains its
   caption's; a real section heading is kept. The page stays, last. */
const GENERIC = /^(pdf )?page \d+\b/i;
const FIGNO = /\bfig(?:ure)?\.?\s*(\d+\.\d+)/i;
function lead(body, n) {
  const text = body.split('\n').filter(l => !/^#{1,6}\s/.test(l)).join(' ')
    .replace(IMG, ' ').replace(/[#*_`>|\[\]]/g, ' ').replace(FIGNO, ' ');
  const w = text.split(/\s+/).filter(t => /[a-z]/i.test(t)).slice(0, n).join(' ');
  return w.replace(/[\s,;:.(—-]+$/, '');
}
/* Opening words were not enough: the owner's --why run put 181 of 203
   title misses on Braunwald notes beaten by other Braunwald notes, none of
   them near-copies and no title shared. A passage's first words are mostly
   its topic's common words, which its neighbours share. So each note is
   titled by the terms that set it apart from the rest of its unit — tf-idf
   over the notes kept, sublinear in tf — in the order the note uses them. */
const STOP = new Set(('with that this from which were have been also into than more such these their other there when where while ' +
  'after before about between during however both each most some only over under within without among because being does used using ' +
  'shown figure page table include including includes associated patients patient').split(' '));
/* Plain letters and digits only: the app's own tokenizer may split
   "NT-proBNP" or "2.5mg" into pieces that are common on their own, so a term
   unique here would not be unique there. */
const termable = w => w.length >= 4 && /^[a-z][a-z0-9]*$/.test(w) && !STOP.has(w);
function keyTerms(notes, n = 5) {
  const df = Object.create(null);
  const bags = notes.map(c => {
    const tf = Object.create(null);
    for (const w of words(c.body.split('\n').filter(l => !/^#{1,6}\s/.test(l)).join(' '))) if (termable(w)) tf[w] = (tf[w] || 0) + 1;
    for (const w in tf) df[w] = (df[w] || 0) + 1;
    return tf;
  });
  const N = notes.length;
  notes.forEach((c, i) => {
    const tf = bags[i];
    /* A term in half the unit's notes or more tells none of them apart.
       And a term in only two is not enough either: the owner's run showed the
       winner holding EVERY term of the missed note's title in 156 of 165
       misses — same file, shorter (median 65 words against 102): a caption
       repeated in the page text around it, which wins on length. So terms no
       other note in the unit has come first, and when there are two or more
       of them the title is made of those alone — then no other note can hold
       the whole title. */
    const scored = Object.keys(tf).map(w => [w, (1 + Math.log(tf[w])) * Math.log((N + 1) / df[w])])
      .filter(([w]) => df[w] * 2 <= N).sort((a, b) => b[1] - a[1]);
    const own = scored.filter(([w]) => df[w] === 1);
    const ranked = (own.length >= 2 ? own : own.concat(scored.filter(([w]) => df[w] > 1))).slice(0, n).map(([w]) => w);
    /* Shown as the note spells it, in the order it uses them. */
    const shown = Object.create(null), order = [];
    for (const raw of c.body.replace(IMG, ' ').split(/\s+/)) {
      const k = raw.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9%]+$/g, '');
      if (ranked.includes(k) && !(k in shown)) { shown[k] = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9%]+$/g, ''); order.push(k); }
    }
    c.terms = order.map(k => shown[k]);
  });
}
const about = (c, n) => (c.terms && c.terms.length ? c.terms.slice(0, n).join(', ') : lead(c.body, n + 3));
function noteTitle(c) {
  const h = c.heading.replace(/\s*\(with \d+ more figures?\)$/, '');
  const more = c.heading.slice(h.length);
  const page = /\bpage (\d+)/i.exec(h);
  const at = page ? ` (p. ${page[1]})` : '';
  const fig = FIGNO.exec(h);
  const base = h.replace(/\s*\(\d+\/\d+\)$/, '');
  let t;
  if (c.kind === 'figure' && fig) t = `Fig. ${fig[1]} — ${about(c, 5)}${at}`;
  else if (GENERIC.test(base)) t = `${about(c, 5)}${at}`;
  else if (base !== h) t = `${base} — ${about(c, 3)}`;
  else return c.heading;
  return t + more;
}

/* Front matter of its own rather than the unit file's, which may lack what
   check-refs requires of every file: a title, a source and four tags. The
   source's own values are kept where it has them. */
function renderSelected(kept, { unit = 'unit', kind = 'text' } = {}) {
  if (!kept.length) return '';
  const meta = kept[0].meta || '';
  const pick = k => { const m = new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(meta); return m ? m[1].trim() : ''; };
  const topic = unit.replace(/^bw-/, '');
  const tags = [...new Set(pick('tags').split(',').map(t => t.trim()).filter(Boolean)
    .concat(['braunwald', topic, kind === 'figure' ? 'figures' : 'text', 'high-yield', 'cardiology']))];
  /* A source file with no title of its own is titled by its file name —
     "Braunwald_13th_HF_full", one unbreakable word that no search splits. */
  const fileTitle = kept[0].title.replace(/_+/g, ' ').trim();
  const head = `---\ntitle: ${fileTitle}${kind === 'figure' ? ' — figures' : ''}\n` +
    `tags: ${tags.join(', ')}\nsource: ${pick('source') || "Braunwald's Heart Disease, 13th edition"}\n---\n\n`;
  const seen = Object.create(null);
  const title = c => { const t = noteTitle(c); seen[t] = (seen[t] || 0) + 1; return seen[t] > 1 ? `${t} (${seen[t]})` : t; };
  return head + kept.map(c => `## ${title(c)}\n${c.body}\n`).join('\n');
}

function indexNotes(dir, skip) {
  const idx = new Set(), figs = new Set();
  let notes = 0;
  if (!fs.existsSync(dir)) return { idx, notes, figs };
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.md$/i.test(e.name) && !/^readme\.md$/i.test(e.name) && !(skip && skip(e.name))) {
        const raw = fs.readFileSync(p, 'utf8');
        for (const m of raw.matchAll(/refimg:\/\/[^)\s>]+/g)) figs.add(path.basename(m[0]));
        for (const s of parseNotes(raw, e.name).sections) { notes++; for (const h of shingles(s.body)) idx.add(h); }
      }
    }
  };
  walk(dir);
  return { idx, notes, figs };
}

function unitFolders(root) {
  const out = [];
  const walk = d => {
    const ents = fs.readdirSync(d, { withFileTypes: true });
    const hasNotes = ents.some(e => e.isFile() && /\.md$/i.test(e.name) && !/^readme\.md$/i.test(e.name));
    const hasFigs = ents.some(e => e.isDirectory() && /^(visuals|images|pages)$/i.test(e.name));
    if (hasNotes && hasFigs) out.push({ dir: d, unit: 'bw-' + path.basename(d).toLowerCase().replace(/[^a-z0-9]+/g, '-') });
    for (const e of ents) if (e.isDirectory() && !/^(visuals|images|pages|__macosx)$/i.test(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name));
  };
  walk(root);
  return out.sort((a, b) => a.unit.localeCompare(b.unit));
}

module.exports = { BACKREF, MAX_WORDS, MIN_TAGS, tokens, noteTitle, keyTerms, chunks, stripScans, isAtlas, atlasEntries, words, unitFolders, parseNotes, shingles, containment, scoreSection, selectUnit, renderSelected, indexNotes,
                   MIN_WORDS, DUP_WITHIN, COVERED, DEFAULT_MIN_SCORE, LOW_YIELD_HEADING };

/* ── the command ─────────────────────────────────────────────────────────── */
if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
  const FROM = opt('--from'), OUT = opt('--out', path.join('source', 'refs-staging'));
  const MIN = +opt('--min-score', DEFAULT_MIN_SCORE);
  const EXISTING = path.join(__dirname, '..', 'content', 'refs');
  if (!FROM || !fs.existsSync(FROM)) { console.error('usage: node tools/refs-merge.js --from <folder of unit folders> [--min-score N] [--out dir]'); process.exit(1); }
  if (/^content[\\/]/.test(path.relative(path.join(__dirname, '..'), path.resolve(OUT)))) { console.error('--out must not be under content/: add-unit writes there'); process.exit(1); }

  /* --shape: how the unit's markdown is organised, without a word of it —
     so a split finer than "## " can be chosen from the facts. Headings by
     level, bold-only lines, and for each level the first few headings as
     shapes (letters to A/a, digits to 9); section sizes and figures per
     section. */
  if (args.includes('--shape')) {
    const shapeOf = t => t.trim().slice(0, 14).replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9').replace(/ /g, '␣');
    const q = (arr, f) => { const b = [...arr].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * f))] : 0; };
    for (const u of unitFolders(FROM)) {
      console.log(`\n${u.unit}`);
      for (const name of fs.readdirSync(u.dir).filter(f => /\.md$/i.test(f)).sort()) {
        const raw = fs.readFileSync(path.join(u.dir, name), 'utf8').replace(/\r\n/g, '\n');
        const lines = raw.split('\n');
        const lv = {}, first = {};
        let bold = 0, boldShapes = [];
        for (const l of lines) {
          const m = /^(#{1,6})\s+(.*)$/.exec(l);
          if (m) { const k = m[1].length; lv[k] = (lv[k] || 0) + 1; (first[k] = first[k] || []).length < 6 && first[k].push(shapeOf(m[2])); }
          else if (/^\*\*[^*].*\*\*\s*$/.test(l.trim())) { bold++; if (boldShapes.length < 6) boldShapes.push(shapeOf(l.replace(/\*/g, ''))); }
        }
        const secs = parseNotes(raw, name).sections;
        const w = secs.map(x => words(x.body).length), f = secs.map(x => (x.body.match(IMG) || []).length);
        const linkDirs = {};
        for (const m of raw.matchAll(/!\[[^\]]*\]\((<[^>\n]+>|[^)\s]+)\)/g)) { const d = m[1].replace(/[<>]/g, '').split('/').slice(0, -1).join('/') || '.'; linkDirs[d] = (linkDirs[d] || 0) + 1; }
        console.log(`  ${name}`);
        console.log(`    headings by level: ${Object.keys(lv).sort().map(k => '#'.repeat(k) + ' ' + lv[k]).join('   ') || 'none'}   bold-only lines ${bold}`);
        for (const k of Object.keys(first).sort()) console.log(`      ${'#'.repeat(k).padEnd(6)} e.g. ${first[k].join('  |  ')}`);
        if (boldShapes.length) console.log(`      bold   e.g. ${boldShapes.join('  |  ')}`);
        console.log(`    "## " sections ${secs.length}: words median ${q(w, 0.5)}, 90th pct ${q(w, 0.9)}, max ${q(w, 1)};  figures per section max ${q(f, 1)}, sections with over 10: ${f.filter(n => n > 10).length}`);
        console.log(`    figure links point into: ${Object.entries(linkDirs).map(([d, n]) => d + ' ' + n).join(', ') || 'none'}`);
      }
    }
    process.exit(0);
  }

  const existing = indexNotes(EXISTING, name => /^bw-/.test(name));
  console.log(`\nexisting notes: ${existing.notes} in ${path.relative(process.cwd(), EXISTING) || EXISTING}  (bw-* units staged by this tool are not counted)`);
  if (!existing.notes) console.log('  — none found: everything will count as new. Is this the drnerd folder, with content/refs in it?');

  /* A unit is a folder holding notes AND a folder of their figures (visuals,
     images or pages), found at any depth under --from — so --from can be
     wherever the zip was unpacked, and a folder holding only a guide .md is
     not mistaken for a unit. */
  const units = unitFolders(FROM);
  if (!units.length) { console.error(`no folder under ${FROM} holds .md notes beside a visuals/, images/ or pages/ folder`); process.exit(1); }

  const review = [];
  for (const u of units) {
    const files = fs.readdirSync(u.dir).filter(f => /\.md$/i.test(f) && !/^readme\.md$/i.test(f)).sort()
      .map(name => ({ name, raw: fs.readFileSync(path.join(u.dir, name), 'utf8') }));
    const perFile = files.map(f => `${f.name.length > 44 ? f.name.slice(0, 41) + '…' : f.name} ${parseNotes(f.raw, f.name).sections.length}`);
    const r = selectUnit(files, existing.idx, { minScore: MIN, existingFigures: existing.figs });
    const t = r.tally;
    const bucket = [0, 0.5, 1, 2, 3, 5, 8].map((lo, i, a) => `${lo}${a[i + 1] !== undefined ? '–' + a[i + 1] : '+'}: ${r.scores.filter(s => s >= lo && (a[i + 1] === undefined || s < a[i + 1])).length}`);
    console.log(`\n${u.unit}   (${files.length} files: ${perFile.join(', ')})`);
    console.log(`  candidates ${t.sections} (${t.figureEntries} atlas figures, ${t.sections - t.figureEntries} text chunks)   repeats of each other ${t.repeat}   already in your notes ${t.covered}`);
    console.log(`  dropped: under ${MIN_WORDS} words ${t.thin}, pointing elsewhere ("see above"…) ${t.backref}, low-yield heading ${t.lowHeading}, score under ${MIN} ${t.lowScore}`);
    console.log(`  KEPT ${t.keptFigures} figure notes and ${t.kept - t.keptFigures} text notes, citing ${t.figures} figures`);
    console.log(`  score of the unique sections (signals per 100 words): ${bucket.join('   ')}`);
    const outDir = path.join(OUT, u.unit);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const figs = r.kept.filter(c => c.kind === 'figure'), text = r.kept.filter(c => c.kind === 'text');
    if (figs.length) fs.writeFileSync(path.join(outDir, `${u.unit}-figures.md`), renderSelected(figs, { unit: u.unit, kind: 'figure' }));
    if (text.length) fs.writeFileSync(path.join(outDir, `${u.unit}-text.md`), renderSelected(text, { unit: u.unit, kind: 'text' }));
    review.push(`# ${u.unit}\n\n## Kept (${r.kept.length})\n` + r.kept.map(c => `- ${noteTitle(c)}  — score ${c.score.toFixed(1)}, ${c.words} words, ${c.figures} fig`).join('\n') +
      `\n\n## Just under the cut (score ${(MIN / 2).toFixed(1)}–${MIN}) — look at these\n` +
      r.dropped.filter(c => c.why === 'lowScore' && c.score >= MIN / 2).map(c => `- ${c.heading}  — score ${c.score.toFixed(1)}, ${c.words} words`).join('\n') + '\n');
    const figDir = path.join(u.dir, 'visuals');
    console.log(`  next: python tools/add-unit.py --unit ${u.unit} --notes "${outDir}" --figures "${fs.existsSync(figDir) ? figDir : u.dir}"` +
      (fs.existsSync(path.join(__dirname, `figure-crops.${u.unit.replace(/^bw-/, '').replace('heart-failure', 'hf')}.json`))
        ? ` --crops tools/figure-crops.${u.unit.replace(/^bw-/, '').replace('heart-failure', 'hf')}.json` : ''));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'review.md'), review.join('\n'));
  console.log(`\nheadings kept, and the ones just under the cut: ${path.join(OUT, 'review.md')} (on this laptop only — ${OUT} is gitignored)`);
}
