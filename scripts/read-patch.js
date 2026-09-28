#!/usr/bin/env node
/*
 * Prose that reads like prose.
 *
 *   node scripts/read-patch.js <input.html> <output.html>
 *
 * THE BUG THIS STARTED AS. Reference notes were rendered with
 * `e(body).replace(/\n+/g,'<br>')` — escaped, newlines to line breaks. Every
 * pipe table, every `##`, every `**bold**` arrived on screen as the literal
 * characters somebody typed into the markdown file. The library looked like a
 * text editor with the syntax highlighting switched off.
 *
 * The app already had an md() renderer for Apex's replies. Two reasons it was
 * not enough on its own:
 *
 *   1. It had no table support, and a reference corpus is mostly tables —
 *      likelihood ratios, drug doses, trial results, the comparisons that a
 *      board question is actually built from. Rendering those as pipes is
 *      worse than useless, because a table is precisely the content whose
 *      meaning lives in its alignment.
 *   2. It only understood `###`. Note sections are `##`, so every heading fell
 *      through to a paragraph.
 *
 * WHAT CHANGED, AND WHY THESE SIZES. The app's type ladder is a minor third
 * from a 16px body: 9 · 11 · 13 · 16 · 19 · 23 · 28. Sound ladder, but the
 * app leaned on the bottom of it — 77 declarations at 13px and 61 at 11px
 * against 25 at 16px. A dense reading app used for hours of study was setting
 * almost all of its prose two steps below its own body size.
 *
 * So the surfaces that carry continuous prose move up one step, 13 → 16, and
 * their metadata 11 → 13: note bodies, Apex replies, answer explanations,
 * search results, the peek panel. Chrome that is not read continuously —
 * chips, counters, button labels — stays where it is, because making those
 * bigger costs layout without buying legibility. Every value used is still a
 * step on the existing ladder, so verify-type's rules hold unchanged.
 *
 * Three smaller things that matter more than their size suggests. Note bodies
 * were --muted; long-form reading wants full --text contrast, and dimming is
 * for labels, not paragraphs. Paragraphs get a 68ch measure, because a line
 * that runs the full width of a desktop card is measurably harder to track
 * back from. And line-height goes to 1.7 for prose, which is the one change
 * here that people feel without being able to name.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/read-patch.js <input.html> <output.html>');
  process.exit(1);
}
let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. md() learns tables and the rest of the heading levels ─────────────
   Built by joining lines rather than as a template literal: the function it
   emits is itself full of backticks and ${…}, and escaping those inside a
   template is how you end up debugging a build script instead of a feature. */
const MD_OLD = [
  'function md(t){',
  '  let s=e(t);',
  '  s=s.replace(/```([\\s\\S]*?)```/g,(m,c)=>`<pre><code>${c}</code></pre>`);',
  "  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');",
  "  s=s.replace(/^###\\s+(.+)$/gm,'<h3>$1</h3>');",
  "  s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');",
  "  s=s.replace(/(^|[\\s(])\\*([^*\\n]+)\\*/g,'$1<em>$2</em>');",
  "  s=s.replace(/^\\s*[-•]\\s+(.+)$/gm,'<li>$1</li>');",
  "  s=s.replace(/^\\s*\\d+\\.\\s+(.+)$/gm,'<li>$1</li>');",
  "  s=s.replace(/(<li>[\\s\\S]*?<\\/li>)(?!\\s*<li>)/g,'<ul>$1</ul>');",
  '  s=s.split(/\\n{2,}/).map(p=>/^<(ul|h3|pre)/.test(p.trim())?p:`<p>${p.replace(/\\n/g,\'<br>\')}</p>`).join(\'\');',
  '  return s;',
  '}',
].join('\n');

const MD_NEW = [
  'function md(t){',
  '  let s=e(t);',
  '  s=s.replace(/```([\\s\\S]*?)```/g,(m,c)=>`<pre><code>${c}</code></pre>`);',
  "  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');",
  '  /* Headings before inline marks, so a ## line never becomes a paragraph. */',
  "  s=s.replace(/^####\\s+(.+)$/gm,'<h4>$1</h4>');",
  "  s=s.replace(/^###\\s+(.+)$/gm,'<h3>$1</h3>');",
  "  s=s.replace(/^##\\s+(.+)$/gm,'<h3>$1</h3>');",
  "  s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');",
  "  s=s.replace(/(^|[\\s(])\\*([^*\\n]+)\\*/g,'$1<em>$2</em>');",
  '  /* GFM pipe tables. Runs after the inline marks so cells keep their bold,',
  '     and before the list rules so a |---|---| divider is never read as a',
  '     bullet. The wrapper scrolls sideways: a drug-dose table is wider than a',
  '     phone, and the alternative is a squeezed column nobody can read. */',
  '  s=s.replace(/(?:^\\|.*\\|[ \\t]*\\n)(?:^\\|[ \\t:|-]+\\|[ \\t]*\\n)(?:^\\|.*\\|[ \\t]*\\n?)+/gm,block=>{',
  "    const rows=block.trim().split('\\n');",
  "    const cut=r=>r.trim().replace(/^\\||\\|$/g,'').split('|').map(c=>c.trim());",
  '    const head=cut(rows[0]), body=rows.slice(2).map(cut);',
  '    return `<div class="tw"><table><thead><tr>${head.map(c=>`<th>${c}</th>`).join(\'\')}</tr></thead>`+',
  '      `<tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join(\'\')}</tr>`).join(\'\')}</tbody></table></div>`;',
  '  });',
  "  s=s.replace(/^\\s*[-•]\\s+(.+)$/gm,'<li>$1</li>');",
  "  s=s.replace(/^\\s*\\d+\\.\\s+(.+)$/gm,'<li>$1</li>');",
  "  s=s.replace(/(<li>[\\s\\S]*?<\\/li>)(?!\\s*<li>)/g,'<ul>$1</ul>');",
  '  /* A single newline joins, as markdown says it should. Source files are',
  '     hard-wrapped at ~78 characters; turning each of those into a <br> gave',
  '     paragraphs a ragged false margin that tracked the .md file rather than',
  '     the column it was being read in. A blank line still starts a paragraph. */',
  '  s=s.split(/\\n{2,}/).map(p=>/^<(ul|h3|h4|pre|div|table)/.test(p.trim())?p:`<p>${p.replace(/\\n/g,\' \')}</p>`).join(\'\');',
  '  return s;',
  '}',
].join('\n');

patch('md: pipe tables, ## and #### headings', MD_OLD, MD_NEW);

/* ── 2. notes render as prose, not as their own source ───────────────────── */
patch('refs: render the note body through md()',
`<div class="ref-body">\${e(r.body).replace(/\\n+/g,'<br>')}</div>`,
`<div class="ref-body">\${md(r.body)}</div>`);

/* ── 3. the prose stylesheet ─────────────────────────────────────────────
   A bounded height stays: the library is a list of 126 cards, and a screen
   that is one note tall is a worse way to find anything. 300px is roughly a
   full section, which is the unit a note actually is. */
patch('refs: typography for rendered note bodies',
`.ref-body{font-size:13px;line-height:1.6;color:var(--muted);margin-top:6px;
  max-height:180px;overflow-y:auto}`,
`.ref-body{font-size:16px;line-height:1.7;color:var(--text);margin-top:10px;
  max-height:300px;overflow-y:auto;padding-right:4px}
.ref-body>*:first-child{margin-top:0}
.ref-body>*:last-child{margin-bottom:0}
/* A measure, not the width of the card. Long lines are hard to track back
   from, and a desktop card is far wider than comfortable reading. */
.ref-body p{margin:0 0 12px;max-width:68ch}
.ref-body h3,.ref-body h4{font-size:16px;font-weight:700;color:var(--text);
  margin:18px 0 8px;letter-spacing:-.01em;line-height:1.35}
.ref-body ul{margin:0 0 12px;padding-left:20px;max-width:68ch}
.ref-body li{margin:0 0 6px}
.ref-body strong{color:var(--text);font-weight:700}
.ref-body em{font-style:italic}
.ref-body code{font-family:var(--font-mono);font-size:13px;
  background:var(--card);border:1px solid var(--border);border-radius:4px;padding:1px 5px}
.ref-body pre{margin:0 0 12px;padding:10px 12px;overflow-x:auto;
  background:var(--card);border:1px solid var(--border);border-radius:8px}
.ref-body pre code{border:0;background:none;padding:0}
/* Tables scroll sideways inside their own frame rather than squeezing. */
.ref-body .tw{overflow-x:auto;margin:0 0 14px;
  border:1px solid var(--border);border-radius:10px;-webkit-overflow-scrolling:touch}
.ref-body table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.5}
.ref-body th{text-align:left;font-weight:700;color:var(--text);background:var(--card);
  padding:9px 12px;border-bottom:1.5px solid var(--border);white-space:nowrap}
.ref-body td{padding:9px 12px;border-bottom:1px solid var(--border);
  color:var(--muted);vertical-align:top}
.ref-body tbody tr:last-child td{border-bottom:0}`);

/* ── 3b. tags stop shouting over the note ────────────────────────────────
   A retrieval corpus wants many tags — matching is literal, so synonyms and
   abbreviations both have to be present. Forty of them rendered as chips took
   more vertical space than the note did, and buried the thing you came to
   read. They still all index; only the first eight are shown, with the rest
   behind a count you can hover for the full list. */
patch('refs: show the first eight tags, count the rest',
`\${r.tags?\`<div class="ref-tags">\${e(r.tags).split(',').map(t=>\`<span>\${t.trim()}</span>\`).join('')}</div>\`:''}`,
`\${r.tags?(()=>{const T=e(r.tags).split(',').map(t=>t.trim()).filter(Boolean);
        const shown=T.slice(0,8).map(t=>\`<span>\${t}</span>\`).join('');
        const rest=T.length-8;
        return \`<div class="ref-tags">\${shown}\${rest>0?\`<span class="ref-more" title="\${T.slice(8).join(', ')}">+\${rest} more</span>\`:''}</div>\`;
      })():''}`);

patch('refs: the overflow-tag chip reads as a count, not a tag',
`.ref-tags{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}`,
`.ref-tags{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}
.ref-tags .ref-more{color:var(--dim);background:transparent;border-style:dashed;cursor:default}`);

/* ── 4. Apex's own replies get the same treatment ────────────────────────
   Same renderer, same corpus quoted back at you — it would be strange for a
   table to read well in the library and badly in the answer citing it. */
patch('chat: Apex replies render tables and read at body size',
`.msg{max-width:94%;font-size:13px;line-height:1.62}`,
`.msg{max-width:94%;font-size:16px;line-height:1.7}
.msg p{margin:0 0 10px;max-width:68ch}
.msg p:last-child{margin-bottom:0}
.msg h3,.msg h4{font-size:16px;font-weight:700;margin:14px 0 6px;line-height:1.35}
.msg ul{margin:0 0 10px;padding-left:20px}
.msg li{margin:0 0 5px}
.msg .tw{overflow-x:auto;margin:0 0 12px;border:1px solid var(--border);border-radius:10px}
.msg table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.5}
.msg th{text-align:left;font-weight:700;background:var(--card);padding:8px 11px;
  border-bottom:1.5px solid var(--border);white-space:nowrap}
.msg td{padding:8px 11px;border-bottom:1px solid var(--border);vertical-align:top}
.msg tbody tr:last-child td{border-bottom:0}`);

/* ── 5. the other surfaces that carry continuous prose ───────────────────── */
patch('read: answer explanations at body size',
`.exp-text{font-size:13px;line-height:1.75;color:var(--text);margin-bottom:16px}`,
`.exp-text{font-size:16px;line-height:1.75;color:var(--text);margin-bottom:16px}`);

patch('read: search-result stems at body size',
`.hit-stem{font-size:13px;line-height:1.55;color:var(--muted)}`,
`.hit-stem{font-size:16px;line-height:1.65;color:var(--text)}`);

patch('read: the peek panel at body size',
`.peek-body{overflow-y:auto;padding:14px 16px;font-size:13px;line-height:1.65;color:var(--text)}`,
`.peek-body{overflow-y:auto;padding:14px 16px;font-size:16px;line-height:1.7;color:var(--text)}`);

patch('read: note titles carry the card',
`.ref-title{flex:1;font-weight:700;font-size:13px;letter-spacing:-.01em}`,
`.ref-title{flex:1;font-weight:700;font-size:16px;letter-spacing:-.01em;line-height:1.35}`);

patch('read: the citation line is readable, not a footnote',
`.ref-src{font-family:var(--font-mono);font-size:11px;color:var(--dim);margin-top:3px}`,
`.ref-src{font-family:var(--font-mono);font-size:13px;color:var(--muted);margin-top:5px;line-height:1.45}`);

fs.writeFileSync(OUT, html);
console.log(`read: ${applied.length} edits applied`);
for (const a of applied) console.log(`      · ${a}`);
console.log(`      → ${OUT}`);
