#!/usr/bin/env node
/*
 * Writes docs/MEMORIZER-STUDY-FILE-PROMPT.md from the app's own prompt
 * (memorizer/src/studyImport.js studyFilePrompt, whose rules are spec.js's).
 *
 *   node scripts/study-file-prompt.js          write it
 *   node scripts/study-file-prompt.js --check  exit 1 if it is out of date
 *
 * The doc is generated so that it cannot say one thing while the app asks
 * Claude for another: tests/verify-memorizer-spec-pure.js runs --check.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'MEMORIZER-STUDY-FILE-PROMPT.md');
const SI = require(path.join(ROOT, 'memorizer', 'src', 'studyImport.js'));
const Spec = require(path.join(ROOT, 'memorizer', 'src', 'spec.js'));

function doc() {
  return [
    '# Memorizer study file: the prompt for Claude',
    '',
    '<!-- Written by scripts/study-file-prompt.js from memorizer/src/spec.js and',
    '     memorizer/src/studyImport.js. Do not edit by hand: change those and run the script. -->',
    '',
    'Use this when you have a chapter (your own PDF) and want Claude to write a study',
    'file for it. The same prompt is in the app: **Import Study → Copy the prompt for Claude**.',
    '',
    '1. Paste the prompt into Claude, with the chapter pasted after it or its PDF attached.',
    '2. Save Claude\'s reply as a `.md` file.',
    '3. In Memorizer: **Import Study**, choose the file, check the preview, **Import**.',
    '',
    'Its rules are the same ones, word for word, as the study-pack prompt Memorizer',
    'builds for a unit already in the app (`memorizer/src/spec.js`): ' + Spec.POINTS.min + ' to ' + Spec.POINTS.max +
      ' points',
    'of at most ' + Spec.POINTS.words + ' words, exactly ' + Spec.OPTIONS + ' options per question with one right, a reason for',
    'each wrong option, numbers copied exactly, tables and Mermaid flowcharts drawn to',
    'the same limits.',
    '',
    '**What Memorizer takes from the file:** the text under every heading, as the',
    'unit\'s text; each `- **Term**: fact` line as a lesson point; tables; Mermaid',
    'flowcharts (a flowchart drawn in text with arrows is read too); SVG diagrams,',
    'cleaned and shown as pictures; the front matter, shown under the unit\'s title;',
    'and each practice question with exactly ' + Spec.OPTIONS + ' options and a Correct Answer line. A',
    'question with no marked answer is left out and counted, never guessed. Points,',
    'tables and questions are checked against the file\'s own text, and anything with',
    'a number the text does not have is flagged. The **Strict consistency check** box also holds',
    'each question\'s scenario to the text. All of this checks the file against itself: it',
    'does not check it against your book or the medical facts.',
    '',
    '## The prompt',
    '',
    '`````text',
    SI.studyFilePrompt(),
    '`````',
    '',
  ].join('\n');
}

if (require.main === module) {
  const want = doc();
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (have !== want) { console.error('docs/MEMORIZER-STUDY-FILE-PROMPT.md is out of date: run node scripts/study-file-prompt.js'); process.exit(1); }
    console.log('docs/MEMORIZER-STUDY-FILE-PROMPT.md is the app\'s prompt');
  } else {
    fs.writeFileSync(OUT, want);
    console.log('wrote ' + path.relative(process.cwd(), OUT));
  }
}
module.exports = { doc, OUT };
