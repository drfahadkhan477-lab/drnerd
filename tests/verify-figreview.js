#!/usr/bin/env node
/*
 * The figure review sheet, driven the way a person drives it.
 *
 *   node tests/verify-figreview.js
 *
 * WHY THIS EXISTS. Every automatic cropper tried on this corpus has been wrong
 * in a way that destroys information — the last one would have cut panel A off
 * 022_FIG.55.1 entirely. So the decision moves to a person, and the sheet that
 * carries that decision becomes load-bearing: an hour of tapping is worth
 * nothing if the box it records is wrong.
 *
 * ONE INVARIANT ABOVE ALL. The sheet shows a DOWNSCALED preview, and records a
 * box in ORIGINAL pixels. Confuse the two and every crop comes out a fraction
 * of its intended size — trim-figure.py would then refuse them all, because it
 * checks the box against the dimensions it was measured on. That is exactly
 * the failure this session hit three times in other places: measuring the
 * painted thing instead of the real thing. So the fixture is deliberately
 * built at a size the preview cannot be (900 wide, previewed at 300), and the
 * assertions are on the ORIGINAL scale.
 *
 * The fixture is synthetic and generated here — no licensed image is involved.
 * It needs python3 with Pillow, the same dependency tools/figure-review.py has.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch } = require('./_engine');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'figreview-'));
const SRC = path.join(TMP, 'src');
const OUT = path.join(TMP, 'review.html');

/* A tall page-shaped image with a band of "prose" on top and artwork below,
   and a small clean one. Different sizes on purpose: one box scaled wrong
   would still look plausible if every fixture were the same shape. */
const MAKE = `
import os
from PIL import Image, ImageDraw
os.makedirs("${SRC}/demo", exist_ok=True)
im = Image.new("RGB", (900, 1200), "white"); d = ImageDraw.Draw(im)
for i in range(12):                      # page prose across the top
    d.rectangle([60, 40 + i * 26, 840, 40 + i * 26 + 9], fill=(40, 40, 40))
d.rectangle([120, 420, 780, 1120], outline=(0, 0, 0), width=6)
d.ellipse([260, 560, 640, 940], outline=(0, 0, 0), width=6)
im.save("${SRC}/demo/tall_FIG.1.1_p001.jpg", quality=90)
im = Image.new("RGB", (400, 300), "white"); d = ImageDraw.Draw(im)
d.rectangle([30, 30, 370, 270], outline=(0, 0, 0), width=5)
im.save("${SRC}/demo/small_FIG.1.2_p002.jpg", quality=90)
`;

(async () => {
  execFileSync('python3', ['-c', MAKE], { stdio: 'pipe' });
  execFileSync('python3', [path.join(ROOT, 'tools', 'figure-review.py'),
    '--dir', SRC, '--out', OUT, '--max-width', '300'], { stdio: 'pipe' });

  head('the sheet is built, and it is self-contained');
  const html = fs.readFileSync(OUT, 'utf8');
  ok('it exists and is not empty', html.length > 5000, `${html.length} bytes`);
  ok('every image is inlined — it must open on an iPad with no network',
     !/<img[^>]+src="(?!data:)/.test(html));
  ok('nothing is fetched from anywhere',
     !/https?:\/\//.test(html.replace(/data:image[^"']+/g, '')));

  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, hasTouch: true });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('file://' + OUT);
  await page.waitForSelector('.card');

  head('both figures arrive undecided');
  ok('two cards on the To do filter', await page.locator('.card').count() === 2);
  ok('the counter says nothing is decided yet',
     (await page.locator('#count').textContent()).trim().startsWith('0 / 2'),
     (await page.locator('#count').textContent()).trim());

  const tall = page.locator('.card').filter({ hasText: 'tall_FIG.1.1' });
  ok('the tall figure is on the sheet', await tall.count() === 1);

  head('the preview really is downscaled — otherwise this proves nothing');
  const shown = await tall.locator('img').evaluate(el => el.getBoundingClientRect().width);
  ok('the tall figure is shown far narrower than its 900px original',
     shown > 0 && shown <= 320, `${Math.round(shown)}px on screen`);

  head('dragging the top edge down records a box in ORIGINAL pixels');
  {
    const img = await tall.locator('img').boundingBox();
    const grip = await tall.locator('.grip.g-t').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    /* Drag to one third down the preview → ~400 in original pixels. */
    await page.mouse.move(img.x + img.width / 2, img.y + img.height / 3, { steps: 12 });
    await page.mouse.up();

    const dims = (await tall.locator('.dims').textContent()).trim();
    ok('the readout names the original size, not the preview size',
       /from 900×1200/.test(dims), dims);

    await tall.locator('button[data-a="crop"]').click();
    await page.locator('#export').click();
    const out = JSON.parse(await page.locator('#json').inputValue());
    const key = 'demo/tall_FIG.1.1_p001.jpg';
    const c = out.crops[key];
    ok('the crop is recorded under its path', !!c, Object.keys(out.crops).join(','));
    ok('`was` is the original size', c && JSON.stringify(c.was) === '[900,1200]',
       c && JSON.stringify(c.was));
    ok('the box spans the full original width — no edge was dragged sideways',
       c && c.box[0] === 0 && c.box[2] === 900, c && JSON.stringify(c.box));
    ok('the top edge landed near a third of the ORIGINAL height, not of the preview',
       c && c.box[1] > 300 && c.box[1] < 500, c && `top=${c.box[1]}`);
    ok('the bottom edge is untouched at the original height',
       c && c.box[3] === 1200, c && `bottom=${c.box[3]}`);
    ok('and the box is one trim-figure.py would accept',
       c && c.box[2] - c.box[0] === 900 && c.box[3] - c.box[1] === 1200 - c.box[1]);
    ok('a reason travels with it', c && typeof c.why === 'string' && c.why.length > 10);
  }

  head('keeping a figure whole is a decision, and a different one');
  {
    await page.locator('#close').click();
    await page.locator('#filters button[data-f="all"]').click();
    const small = page.locator('.card').filter({ hasText: 'small_FIG.1.2' });
    await small.locator('button[data-a="keep"]').click();
    await page.locator('#export').click();
    const out = JSON.parse(await page.locator('#json').inputValue());
    ok('it lands in the left-alone record',
       !!out._checked_and_left_alone['demo/small_FIG.1.2_p002.jpg']);
    ok('and NOT in the crops — a kept figure must never reach --apply-crops',
       !out.crops['demo/small_FIG.1.2_p002.jpg']);
    ok('exactly one crop is recorded, not two',
       Object.keys(out.crops).length === 1, Object.keys(out.crops).join(','));
    await page.locator('#close').click();
  }

  head('pressing crop without moving an edge is refused');
  {
    await page.locator('#filters button[data-f="keep"]').click();
    const small = page.locator('.card').filter({ hasText: 'small_FIG.1.2' });
    await small.locator('button[data-a="reset"]').click();
    let alerted = null;
    page.once('dialog', async d => { alerted = d.message(); await d.dismiss(); });
    await small.locator('button[data-a="crop"]').click();
    await page.waitForTimeout(120);
    ok('the whole image is not accepted as a crop', /whole image/i.test(alerted || ''),
       String(alerted));
  }

  head('an hour of tapping survives a reload');
  {
    await page.reload();
    await page.waitForSelector('#count');
    const txt = (await page.locator('#count').textContent()).trim();
    ok('both decisions come back', txt.startsWith('2 / 2'), txt);
    await page.locator('#export').click();
    const out = JSON.parse(await page.locator('#json').inputValue());
    ok('with the same box, to the pixel',
       out.crops['demo/tall_FIG.1.1_p001.jpg'].box[3] === 1200);
    await page.locator('#close').click();
  }

  head('the record it writes is one trim-figure.py can replay — the whole point');
  {
    await page.locator('#export').click();
    const text = await page.locator('#json').inputValue();
    const rec = path.join(TMP, 'record.json');
    fs.writeFileSync(rec, text);
    const box = JSON.parse(text).crops['demo/tall_FIG.1.1_p001.jpg'].box;

    const run = () => execFileSync('python3',
      [path.join(ROOT, 'tools', 'trim-figure.py'), '--apply-crops', SRC, '--record', rec],
      { encoding: 'utf8' });
    const first = run();
    ok('it reports the crop it made', /CROP/.test(first), first.trim().split('\n').pop());

    const size = execFileSync('python3', ['-c',
      `from PIL import Image;print(*Image.open("${SRC}/demo/tall_FIG.1.1_p001.jpg").size)`],
      { encoding: 'utf8' }).trim().split(' ').map(Number);
    ok('the image on disk is now exactly the box the sheet recorded',
       size[0] === box[2] - box[0] && size[1] === box[3] - box[1],
       `${size.join('×')} vs box ${box.join(',')}`);

    const second = run();
    ok('running it twice does not crop twice', /already/.test(second),
       second.trim().split('\n').pop());
    ok('the figure kept whole was never touched',
       !/small_FIG/.test(first) && !/small_FIG/.test(second));
    await page.locator('#close').click();
  }

  head('two trees cannot share one record');
  {
    /* A box measured on one image must never be applied to a different image
       that happens to share its relative path. The guard is that each tree
       defaults to its own record file. */
    const sheet = (dir, out) => execFileSync('python3',
      [path.join(ROOT, 'tools', 'figure-review.py'), '--dir', dir,
       '--out', path.join(TMP, out), '--max-width', '160'], { encoding: 'utf8' });
    const other = path.join(TMP, 'other');
    fs.mkdirSync(other, { recursive: true });
    fs.copyFileSync(path.join(SRC, 'demo', 'small_FIG.1.2_p002.jpg'),
                    path.join(other, 'small_FIG.1.2_p002.jpg'));
    const a = sheet(SRC, 'a.html'), b = sheet(other, 'b.html');
    const nameOf = t => (t.match(/record: (\S+)\)/) || [])[1] || '';
    ok('each tree names a record of its own', nameOf(a) !== nameOf(b),
       `${path.basename(nameOf(a))} vs ${path.basename(nameOf(b))}`);
    ok('and the name is derived from the tree, not invented',
       nameOf(b).endsWith('figure-crops.other.json'), path.basename(nameOf(b)));
  }

  head('the page ran clean');
  ok('no uncaught errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
