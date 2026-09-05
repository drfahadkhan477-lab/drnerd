#!/usr/bin/env python3
"""Build a per-figure visual atlas from a page-image dump of a Braunwald unit.

    python3 tools/visual-atlas.py <pages-dir> <text.md> <out-dir> [--jobs 4]

WHAT THIS IS FOR. The reference notes in content/refs cite figures inline as
`![caption](refimg://<unit>/<file>)`, and scripts/ref-images-patch.js resolves
each of those against content/refs-images/. This is the tool that produces the
files to resolve against: it turns "326 photographs of book pages" into "one
cropped image per figure, with the legend as printed".

It is deliberately NOT part of the build chain. The build stays dependency-free
Node; this runs once, by hand, when a new unit arrives, and its output is a
folder of JPEGs you then pick from. It needs Pillow, numpy and the tesseract
binary, none of which the build ever sees.

    pip install Pillow numpy && apt-get install -y tesseract-ocr

WHAT IT EXPECTS. The dump that the PDF-to-markdown step produces:

    pages/page-001.jpg ... page-NNN.jpg    one image per PDF page
    text.md                                 "# PDF Page N" sections, each
                                            carrying that page's extracted text

HOW IT FINDS A FIGURE. No PDF means no text coordinates, so tesseract supplies
them: OCR each page at 2x, group words into lines, and find the lines that open
a caption ("FIG. 54.3", "TABLE 60.1"). That anchor is what makes the crop
precise rather than a guess, because the two kinds of caption sit on opposite
sides of the thing they name:

    a FIGURE legend sits UNDER its artwork  -> take the band from the caption
                                               up to the body text above it
    a TABLE title sits OVER its grid        -> take the band from the title
                                               down to the body text below it

"Body text" is identified structurally, and the page layout is what makes that
reliable: a justified Braunwald line runs the full width of its column and
breaks into a dozen or more glyph runs, and nothing else on the page does both.
Everything inside the band that is not body text is artwork, and the crop is
tightened onto its ink.

The legend TEXT is not taken from the OCR — OCR is trusted for geometry only.
It comes from the extracted-text markdown, which is the PDF's own text layer.

OUTPUT. The same three-part shape the ischemia atlas ships as:

    <out-dir>/visuals/NNN_<LABEL>_pNNN.jpg
    <out-dir>/visual_manifest.json
    <out-dir>/<name>_visual_atlas.md
"""
import argparse, csv, json, os, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

SCALE = 2           # OCR runs on a 2x upscale; page.jpg is ~120 dpi on its own
DARK, SAT = 175, 26  # a pixel is ink if it is this dark, or this saturated
TOP_MARGIN_F, BOT_MARGIN_F = 0.088, 0.962   # clear of running head and folio
BODY_H = (8.5, 12.5)                        # body-text cap height, page pixels
PAD = 6

CAP = re.compile(r'^(E?FIG|E?TABLE)\b\.?\s*(\d{1,3})[.,](\d{1,3})', re.I)
CAP_GLUED = re.compile(r'^(E?FIG|E?TABLE)\.?(\d{1,3})[.,](\d{1,3})', re.I)
LIG = {'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl'}


# ── OCR ─────────────────────────────────────────────────────────────────────
def ocr_page(img_path, tsv_dir, tmp_dir):
    base = os.path.splitext(os.path.basename(img_path))[0]
    tsv = os.path.join(tsv_dir, base + '.tsv')
    if os.path.exists(tsv) and sum(1 for _ in open(tsv)) > 5:
        return tsv
    up = os.path.join(tmp_dir, base + '.png')
    im = Image.open(img_path)
    im.resize((im.width * SCALE, im.height * SCALE), Image.LANCZOS).save(up)
    env = dict(os.environ, OMP_THREAD_LIMIT='1')   # one thread each, we fan out
    subprocess.run(['tesseract', up, os.path.join(tsv_dir, base), 'tsv'],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    os.remove(up)
    return tsv


def lines(tsv):
    """Word rows out of tesseract's TSV, regrouped into lines in page pixels."""
    rows = list(csv.DictReader(open(tsv, encoding='utf-8', errors='replace'),
                               delimiter='\t', quoting=csv.QUOTE_NONE))
    groups = {}
    for r in rows:
        try:
            if int(r['level']) != 5 or float(r['conf']) < 30:
                continue
        except (ValueError, KeyError, TypeError):
            continue
        t = (r['text'] or '').strip()
        if not t:
            continue
        k = (r['block_num'], r['par_num'], r['line_num'])
        L, T, W, H = int(r['left']), int(r['top']), int(r['width']), int(r['height'])
        g = groups.setdefault(k, {'w': [], 'h': [], 'x0': 1e9, 'y0': 1e9, 'x1': -1, 'y1': -1})
        g['w'].append(t); g['h'].append(H)
        g['x0'] = min(g['x0'], L); g['y0'] = min(g['y0'], T)
        g['x1'] = max(g['x1'], L + W); g['y1'] = max(g['y1'], T + H)
    out = [{'text': ' '.join(g['w']), 'n': len(g['w']),
            'x0': g['x0'] / SCALE, 'y0': g['y0'] / SCALE,
            'x1': g['x1'] / SCALE, 'y1': g['y1'] / SCALE,
            'h': float(np.median(g['h'])) / SCALE} for g in groups.values()]
    out.sort(key=lambda l: (l['y0'], l['x0']))
    return out


# ── geometry ────────────────────────────────────────────────────────────────
def _overlaps(l, x0, x1):
    """Share of a line that sits inside the caption's column. A column boundary
    is a few pixels wide, so 'touching' is not 'in the same column'."""
    o = min(l['x1'], x1) - max(l['x0'], x0)
    w = min(l['x1'] - l['x0'], x1 - x0)
    return w > 0 and o / w > 0.5


def _is_body(l, colw):
    return (BODY_H[0] <= l['h'] <= BODY_H[1]
            and (l['x1'] - l['x0']) > 0.80 * colw and l['n'] >= 6)


def _legend(ls, i, cap):
    """The caption's own lines: the run under the anchor that keeps its left
    edge and its (smaller) type size."""
    out, prev = [cap], cap
    for l in ls[i + 1:]:
        if l['y0'] < prev['y1'] - 2:
            continue
        if (l['y0'] - prev['y1'] > max(8, cap['h'] * 1.6)
                or abs(l['x0'] - cap['x0']) > 24 or l['h'] > cap['h'] * 1.55):
            break
        out.append(l); prev = l
    return out


def page_figures(img_path, tsv):
    ls = lines(tsv)
    caps = []
    for i, l in enumerate(ls):
        t = l['text'].lstrip('|. ').strip()
        m = CAP.match(t) or CAP_GLUED.match(t)
        if m:
            caps.append((i, m.group(1).upper().replace('.', ''),
                         f"{m.group(1).upper().replace('.', '')}{m.group(2)}.{m.group(3)}", l))
    if not caps:
        return []

    a = np.asarray(Image.open(img_path).convert('RGB')).astype(np.int16)
    H, W, _ = a.shape
    ink = (a.mean(2) < DARK) | ((a.max(2) - a.min(2)) > SAT)
    top, bot = int(H * TOP_MARGIN_F), int(H * BOT_MARGIN_F)

    out = []
    for i, kind, label, cap in caps:
        leg = _legend(ls, i, cap)
        lx0 = min(l['x0'] for l in leg); lx1 = max(l['x1'] for l in leg)
        ly0 = min(l['y0'] for l in leg); ly1 = max(l['y1'] for l in leg)
        colw = lx1 - lx0
        if colw < W * 0.18:
            colw = W * 0.42                     # a one-line title tells us little

        if kind.endswith('FIG'):
            lo, hi = top, int(ly0) - 3
            for l in ls:
                if l['y1'] < ly0 - 2 and _overlaps(l, lx0, lx1) and _is_body(l, colw):
                    lo = max(lo, int(l['y1']) + 4)
        else:
            lo, hi = int(ly0), bot
            for l in ls:
                if l['y0'] > ly1 + 2 and _overlaps(l, lx0, lx1) and _is_body(l, colw):
                    hi = min(hi, int(l['y0']) - 4); break
        if hi - lo < 55:
            continue

        b0, b1 = max(top, lo), min(bot, hi)
        band = ink[b0:b1, :].copy()
        # A full-width legend makes the whole page the candidate column, which
        # lets a neighbouring paragraph inside the band drag the bounding box
        # across it. Blank the body text out first; what is left is artwork.
        for l in ls:
            if l['y1'] > b0 and l['y0'] < b1 and _is_body(l, colw):
                band[max(0, int(l['y0']) - b0 - 2):int(l['y1']) - b0 + 3,
                     max(0, int(l['x0']) - 3):int(l['x1']) + 3] = False
        if not band.any():
            continue
        xs = np.where(band.any(0))[0]; ys = np.where(band.any(1))[0]
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = b0 + int(ys.min()), b0 + int(ys.max()) + 1
        # the caption anchors the horizontal extent: never wander into the
        # other column because a stray mark landed there
        x0 = max(x0, int(lx0) - 8); x1 = min(x1, int(lx1) + 8)
        if x1 - x0 < 110 or y1 - y0 < 70:
            continue
        if float(ink[y0:y1, x0:x1].mean()) < 0.012:
            continue                            # a sliver of white with one mark
        out.append({'label': label, 'kind': kind, 'box': [x0, y0, x1, y1]})
    return out


# ── the extracted-text side ─────────────────────────────────────────────────
def page_texts(md_path):
    txt = open(md_path, encoding='utf-8').read()
    pages, marks = {}, list(re.finditer(r'^# PDF Page (\d+)\s*$', txt, re.M))
    for j, m in enumerate(marks):
        end = marks[j + 1].start() if j + 1 < len(marks) else len(txt)
        body = txt[m.end():end]
        body = re.sub(r'^!\[.*?\]\(.*?\)\s*$', '', body, flags=re.M)
        pages[int(m.group(1))] = body.replace('## Extracted text', '')
    return pages


def clean(s):
    for a, b in LIG.items():
        s = s.replace(a, b)
    # the export lost the superscript plus on every ion: Ca2!, Na!, K!, H!
    s = re.sub(r'\b(Ca|Mg|Zn)2!', r'\g<1>2+', s)
    s = re.sub(r'\b(Na|K|H|Li)!', r'\g<1>+', s)
    s = re.sub(r'[ \t]*\n[ \t]*', ' ', s)
    return re.sub(r'\s{2,}', ' ', s).strip()


def legend_text(page_text, kind, ch, num):
    stem = ('e?' + kind[-3:]) if kind.startswith('E') else kind
    m = re.search(r'^%s\.?\s*%s\.%s\b' % (stem, ch, num), page_text, re.M | re.I)
    if not m:
        return ''
    tail = page_text[m.start():m.start() + 1400]
    nxt = re.search(r'\n\s*\n', tail[40:])
    if nxt:
        tail = tail[:40 + nxt.start()]
    tail = clean(tail)
    cut = max(tail.rfind('.)'), tail.rfind('. '))     # stop on a full sentence
    return tail[:cut + 1].rstrip() if cut > 120 else tail


# ── driver ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pages_dir'); ap.add_argument('text_md'); ap.add_argument('out_dir')
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--name', default='unit')
    ap.add_argument('--quality', type=int, default=82)
    args = ap.parse_args()

    if not shutil.which('tesseract'):
        sys.exit('tesseract is not installed: apt-get install -y tesseract-ocr')

    texts = page_texts(args.text_md)
    # Only pages whose extracted text carries a caption can hold a figure, so
    # OCR is spent on those alone rather than on the whole unit.
    want = sorted(p for p, t in texts.items()
                  if re.search(r'^(e?(?:FIG|TABLE))\.?\s*\d+\.\d+\b', t, re.M))
    todo = [(p, os.path.join(args.pages_dir, 'page-%03d.jpg' % p)) for p in want]
    todo = [(p, f) for p, f in todo if os.path.exists(f)]
    print(f'{len(texts)} pages, {len(todo)} carry a caption')

    tsv_dir = os.path.join(args.out_dir, '.ocr')
    os.makedirs(tsv_dir, exist_ok=True)
    os.makedirs(os.path.join(args.out_dir, 'visuals'), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        with ThreadPoolExecutor(max_workers=args.jobs) as ex:
            list(ex.map(lambda t: ocr_page(t[1], tsv_dir, tmp), todo))
    print('OCR done')

    best = {}
    for p, f in todo:
        tsv = os.path.join(tsv_dir, 'page-%03d.tsv' % p)
        if not os.path.exists(tsv):
            continue
        for fig in page_figures(f, tsv):
            x0, y0, x1, y1 = fig['box']
            area = (x1 - x0) * (y1 - y0)
            if fig['label'] not in best or area > best[fig['label']][0]:
                best[fig['label']] = (area, p, fig)

    items = sorted(best.values(), key=lambda t: (t[1], t[2]['box'][1]))
    out = []
    for i, (_, page, fig) in enumerate(items, 1):
        m = re.match(r'(E?)(FIG|TABLE)(\d+)\.(\d+)$', fig['label'])
        if not m:
            continue
        e, kind, ch, num = m.groups()
        pretty = f"{'e' if e else ''}{'FIG.' if kind == 'FIG' else 'TABLE'}{ch}.{num}"
        name = f'{i:03d}_{pretty}_p{page:03d}.jpg'
        im = Image.open(os.path.join(args.pages_dir, 'page-%03d.jpg' % page)).convert('RGB')
        x0, y0, x1, y1 = fig['box']
        box = (max(0, x0 - PAD), max(0, y0 - PAD),
               min(im.width, x1 + PAD), min(im.height, y1 + PAD))
        im.crop(box).save(os.path.join(args.out_dir, 'visuals', name), 'JPEG',
                          quality=args.quality, optimize=True)
        out.append({'id': i, 'label': pretty, 'page': page,
                    'caption': legend_text(texts[page], ('E' + kind) if e else kind, ch, num),
                    'image': f'visuals/{name}',
                    # THE BOX, RECORDED. Without it a crop cannot be reopened
                    # on the page it came from, and this detector is wrong often
                    # enough that reopening is the whole point: a figure whose
                    # legend was cut off cannot be recovered by cropping the
                    # crop, only by going back to the page. page_size travels
                    # with it so a box is checkable against what it was measured
                    # on, the same rule tools/figure-crops.json already follows.
                    'box': list(box),
                    'page_image': 'page-%03d.jpg' % page,
                    'page_size': [im.width, im.height]})

    json.dump({'source': args.name, 'source_pages': len(texts),
               'visual_items_detected': len(out), 'items': out},
              open(os.path.join(args.out_dir, 'visual_manifest.json'), 'w'), indent=1)

    md = [f'# {args.name} — Visual Atlas', '',
          'Figures, tables and diagrams cropped from the unit, each with the '
          'legend as printed.', '']
    for it in out:
        md += [f"### {it['label']} — PDF page {it['page']}", '',
               f"![{it['label']}](<{it['image']}>)", '',
               f"**Caption:** {it['caption'] or '(legend not recovered)'}", '',
               f"*Source PDF page: {it['page']}*", '', '---', '']
    open(os.path.join(args.out_dir, f'{args.name}_visual_atlas.md'), 'w').write('\n'.join(md))

    print(f'{len(out)} figures, {sum(1 for i in out if i["caption"])} with a legend')
    print('written:', args.out_dir)


if __name__ == '__main__':
    main()
