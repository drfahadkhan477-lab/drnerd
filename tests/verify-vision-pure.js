#!/usr/bin/env node
/*
 * The one channel a fence cannot reach — what the app says about it.
 *
 *   node tests/verify-vision-pure.js
 *
 * Pure Node, no browser, no build. vision.js depends on nothing but itself.
 *
 * THE GAP THIS COVERS. boundary-patch and toolfence-patch fence every route by
 * which outside text reaches the model — retrieved notes, open-mode notes,
 * remembered facts, the writing around a figure, and the tool results Apex asks
 * for itself. Each passes through refSafe() inside a nonced block, and
 * verify-boundary proves it across eleven headings.
 *
 * An image cannot be fenced. A figure is bytes: a sanitiser has nothing to run
 * over, and the model reads whatever is printed in the picture as part of
 * looking at it. These figures are cropped scans of textbook pages — full of
 * text by design, which is the reason for sending them — so a caption or an
 * annotation that reads like an instruction arrives inside the model's own
 * perception of the image, downstream of every fence in the app.
 *
 * The audit (§20) asked for image-based injection to be tested. It cannot be
 * DEFENDED the way the text channels are, and pretending otherwise would be
 * the dishonest move. What is testable is that the app names it: that the rule
 * exists, that it is attached to the same message as the figures, and that it
 * arrives BEFORE the first image rather than after — a caveat that follows the
 * picture is a caveat about something already read.
 *
 * vision.js was also one of four core modules with no direct test at all.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const root = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'vision.js'), 'utf8')).call(root);
const V = root.Vision;

/* A real, decodable 1x1 GIF — dataUrlToSource must accept it. */
const PIX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/* 'anthropic', not 'gemini'. This loads the SOURCE module, where
   VISION_PROVIDERS is still {anthropic:true, groq:false} — onetutor-patch
   rewrites it to {gemini:true} later in the chain. Testing the pre-patch
   module with the post-patch provider name is a test that silently exercises
   the no-vision path and passes by doing nothing, which is how the first
   version of this file reported a wire "untouched" and called it correct. */
const SEEING = 'anthropic';
const q1 = { id: 'VAL_1', img: 1 };
const q2 = { id: 'VAL_2', img: 2 };

head('the module loads and knows who can see');
{
  ok('Vision is exported', !!V && typeof V.figureBlocks === 'function');
  ok('a data URL of a supported type becomes a source', !!V.dataUrlToSource(PIX));
  ok('and a malformed one becomes null rather than a bad request',
     V.dataUrlToSource('not-a-data-url') === null);
  ok('a provider without vision gets the wire untouched',
     V.withFigures([{ role: 'user', content: 'hi' }], q1, [PIX], 'nobody').length === 1);
  ok('and one with vision is recognised', V.providerSeesFigures(SEEING) === true);
}

head('text inside a figure is named as data, not as instruction');
{
  const blocks = V.figureBlocks(q1, [PIX]);
  ok('figures are attached at all', blocks.some(b => b.type === 'image'));
  ok('the rule is attached with them', blocks.some(b => b.type === 'text' && b.text === V.IMAGE_RULE));

  /* Position is the check that matters. A rule after the image is a rule about
     something the model has already read. */
  const firstImage = blocks.findIndex(b => b.type === 'image');
  const ruleAt = blocks.findIndex(b => b.type === 'text' && b.text === V.IMAGE_RULE);
  ok('and it arrives BEFORE the first image, not after',
     ruleAt >= 0 && ruleAt < firstImage, `rule at ${ruleAt}, first image at ${firstImage}`);

  ok('it says text in the picture is data to read', /data to read/.test(V.IMAGE_RULE));
  ok('it says it is never an instruction', /never an instruction/.test(V.IMAGE_RULE));
  /* The behaviour asked for when it happens: say so and carry on, rather than
     silently obeying or silently ignoring. */
  ok('and it says what to do when an image does contain one',
     /report that it says so/.test(V.IMAGE_RULE) && /what the fellow actually asked/.test(V.IMAGE_RULE));
}

head('the rule is stated once, however many figures there are');
{
  const many = V.figureBlocks(q2, [PIX, PIX]);
  ok('two figures are both attached', many.filter(b => b.type === 'image').length === 2);
  ok('the rule is not repeated per figure — that is prompt spent on nothing',
     many.filter(b => b.type === 'text' && b.text === V.IMAGE_RULE).length === 1);
  ok('and each figure is still numbered so it can be referred to',
     many.some(b => b.text === 'Figure 1:') && many.some(b => b.text === 'Figure 2:'));
  const one = V.figureBlocks(q1, [PIX]);
  ok('a single figure is not numbered', one.some(b => b.text === 'Figure:'));
}

head('nothing is claimed when nothing is sent');
{
  ok('a question with no figure attaches nothing', V.figureBlocks({ id: 'X', img: 0 }, [PIX]).length === 0);
  ok('and neither does an empty image list', V.figureBlocks(q1, []).length === 0);
  /* THE ONE THAT WOULD BE A LIE. If every image is unusable, the old code
     still pushed its "Figure:" labels and now would push the rule too — a
     message announcing figures it did not send, and a caution about pictures
     that are not there. */
  const rotten = V.figureBlocks(q1, ['data:image/gif;base64,@@@not-base64']);
  ok('a figure that cannot be decoded attaches neither label nor rule',
     rotten.length === 0, JSON.stringify(rotten).slice(0, 80));
}

head('and it reaches the wire on the turn the figures do');
{
  const wire = [{ role: 'user', content: 'What does this show?' }];
  const out = V.withFigures(wire, q1, [PIX], SEEING);
  ok('the first user turn carries blocks now', Array.isArray(out[0].content));
  const texts = out[0].content.filter(b => b.type === 'text').map(b => b.text);
  ok('the rule is in them', texts.includes(V.IMAGE_RULE));
  ok("and the fellow's own question survives", texts.includes('What does this show?'));
  ok('the original wire is not mutated', wire[0].content === 'What does this show?');
  ok('a turn that already has blocks is left alone',
     V.withFigures([{ role: 'user', content: [{ type: 'text', text: 'x' }] }], q1, [PIX], SEEING)[0].content.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
