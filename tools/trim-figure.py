#!/usr/bin/env python3
"""
Trim the page text a figure crop was cut with, leaving the figure.

    python3 tools/trim-figure.py <in.jpg> [out.jpg] [--report]
    python3 tools/trim-figure.py --dir <src> <dst>

WHY THIS EXISTS. The ischemia figures were cropped by a pipeline that cut a
generous box around each detected FIG/TABLE caption. Generous enough that many
of them open with two columns of the page's running prose — text belonging to
whatever paragraph happened to end above the artwork, and nothing to do with
the figure. On a phone that text is the first third of the image, unreadable at
that size and taking the space the diagram needed.

The legend BELOW the artwork is a different matter and is kept. "FIG. 32.4
Algorithm for use of cardiac troponin…" is part of the figure; it names the
abbreviations and cites the source, and a diagram without it is a picture.

HOW IT DECIDES. Body text and artwork differ structurally, not semantically, so
this needs no OCR:

  · Text sets on a regular pitch. Its ink profile is a comb — narrow dark bands
    at even spacing with clean white between them.
  · Artwork does not. A box, an arrow or a plot leaves ink over a tall
    continuous run, or leaves a gap far larger than a line of text.

So the top of the image is walked line-band by line-band while the bands keep
looking like prose, and the first gap taller than a couple of line heights ends
the run. Everything above that gap goes — but only if what was above it really
did look like several lines of text, and only if it is a modest fraction of the
image. A figure that begins with artwork at the very top is left alone, which
is the common case and must stay the cheap one.
"""
import sys, os, glob
import numpy as np
from PIL import Image

INK = 200          # below this, on 0-255 grey, counts as ink
MIN_ROWS = 3       # fewer than three text lines up there is not a text block
MAX_FRACTION = .40 # never eat more than this much of the image
GAP_FACTOR = 2.2   # a gap this many line-heights ends the text run


def bands(mask, min_gap=2):
    """Contiguous runs of inked rows, as (start, end) pairs."""
    out, run = [], None
    gap = 0
    for i, v in enumerate(mask):
        if v:
            if run is None:
                run = i
            gap = 0
        elif run is not None:
            gap += 1
            if gap > min_gap:
                out.append((run, i - gap))
                run = None
    if run is not None:
        out.append((run, len(mask) - 1))
    return out


def find_trim(path):
    img = Image.open(path)
    g = np.asarray(img.convert('L'), dtype=np.uint8)
    h, w = g.shape
    per_row = (g < INK).sum(axis=1) / float(w)
    rows = per_row > 0.012
    bs = bands(rows)
    if not bs:
        return 0, 'blank'

    # Only ever consider a text block that starts at the very top of the crop.
    if bs[0][0] > h * 0.06:
        return 0, 'starts with artwork'

    heights = [b - a + 1 for a, b in bs]
    line_h = float(np.median(heights[:8])) if heights else 0
    if line_h <= 0:
        return 0, 'no line height'

    kept = 0
    for i, (a, b) in enumerate(bs):
        band_h = b - a + 1
        # A band far taller than a line of type is artwork, not prose.
        if band_h > line_h * 3.0:
            break
        # Prose is wide. A short centred label is not a paragraph.
        if per_row[a:b + 1].mean() < 0.05:
            break
        kept = i + 1
        if i + 1 < len(bs):
            gap = bs[i + 1][0] - b
            if gap > line_h * GAP_FACTOR:
                break

    if kept < MIN_ROWS:
        return 0, f'only {kept} text row(s) at the top'
    if kept >= len(bs):
        return 0, 'the whole image is text — a table, most likely'

    cut = (bs[kept - 1][1] + bs[kept][0]) // 2
    if cut > h * MAX_FRACTION:
        return 0, f'would cut {cut/h:.0%}, too much'
    return cut, f'{kept} rows of page text, {cut}px ({cut/h:.0%})'


def apply_crops(root):
    """Replay tools/figure-crops.json onto an extracted content/refs-images.

    The images are licensed and gitignored, so a crop made by hand is lost the
    moment they are regenerated unless it is recorded as data. Idempotent: a
    file already at the cropped size is left alone, so running this twice does
    not crop twice."""
    import json
    here = os.path.dirname(os.path.abspath(__file__))
    spec = json.load(open(os.path.join(here, 'figure-crops.json')))
    for key, c in spec['crops'].items():
        f = os.path.join(root, key)
        if not os.path.exists(f):
            print(f'miss  {key} — not extracted here'); continue
        im = Image.open(f)
        want = (c['box'][2] - c['box'][0], c['box'][3] - c['box'][1])
        if im.size == tuple(want):
            print(f'done  {key} already {im.size[0]}x{im.size[1]}'); continue
        if im.size != tuple(c['was']):
            print(f'SKIP  {key} is {im.size[0]}x{im.size[1]}, not the '
                  f'{c["was"][0]}x{c["was"][1]} this box was measured on'); continue
        im.crop(tuple(c['box'])).convert('RGB').save(
            f, 'JPEG', quality=92, optimize=True, subsampling=0)
        print(f'CROP  {key} {c["was"][0]}x{c["was"][1]} -> {want[0]}x{want[1]}')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    report = '--report' in sys.argv
    if '--apply-crops' in sys.argv:
        apply_crops(args[0] if args else 'content/refs-images')
        return
    if '--dir' in sys.argv:
        src, dst = args[0], args[1]
        os.makedirs(dst, exist_ok=True)
        trimmed = 0
        for f in sorted(glob.glob(os.path.join(src, '*'))):
            if not f.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            cut, why = find_trim(f)
            im = Image.open(f)
            if cut:
                im = im.crop((0, cut, im.size[0], im.size[1]))
                trimmed += 1
            im.convert('RGB').save(os.path.join(dst, os.path.basename(f)),
                                   'JPEG', quality=88, optimize=True, subsampling=0)
            print(f'{"TRIM" if cut else "keep"}  {os.path.basename(f):<34} {why}')
        print(f'\n{trimmed} trimmed')
        return
    cut, why = find_trim(args[0])
    print(f'{args[0]}: {why}')
    if len(args) > 1 and not report:
        im = Image.open(args[0])
        if cut:
            im = im.crop((0, cut, im.size[0], im.size[1]))
        im.convert('RGB').save(args[1], 'JPEG', quality=88, optimize=True, subsampling=0)


if __name__ == '__main__':
    main()
