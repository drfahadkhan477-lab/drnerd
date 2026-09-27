#!/usr/bin/env python3
"""Propose a crop for every figure in a folder, as a record add-unit.py can apply.

    python3 tools/propose-crops.py <visuals-dir> <out.json> [--sheet review.jpg]

A PROPOSAL, NOT A DECISION. tools/figure-review.py explains why no automatic
cropper here gets the last word, and this one is no exception: its output is a
record to be looked at, figure by figure, and corrected by hand where it is
wrong. What it adds over trim-figure.py is that it knows what it is looking for.
The file name carries the label (042_FIG.62.4_p224.jpg -> FIG. 62.4), OCR finds
that caption or table title, and everything is measured from there:

  - the COLUMN is the anchor's span out to the nearest white gutter, so the
    neighbouring column of body prose goes;
  - a FIGURE runs up from its caption over the artwork and stops at body prose
    or at another figure's caption; the caption, which is part of the figure,
    stays;
  - a TABLE runs down from its title, over rows and footnotes, until body prose.

Body prose is told from everything else structurally: a line of several words,
nearly the column's width, at body type size, with the even word spacing of
justified text. Table rows fail that last test (the space between columns is
wide), and figure labels fail the first two.

Needs Pillow, numpy, pytesseract and the tesseract binary.
"""
import json, os, re, sys
from multiprocessing import Pool
import numpy as np
import pytesseract
from PIL import Image

# One tesseract thread per process; the pool supplies the parallelism.
os.environ.setdefault('OMP_THREAD_LIMIT', '1')

PAD = 6


def ocr_lines(im):
    d = pytesseract.image_to_data(im, output_type=pytesseract.Output.DICT)
    lines = {}
    for i, w in enumerate(d['text']):
        if not w.strip():
            continue
        k = (d['block_num'][i], d['par_num'][i], d['line_num'][i])
        lines.setdefault(k, []).append((d['left'][i], d['top'][i],
                                        d['left'][i] + d['width'][i], d['top'][i] + d['height'][i], w))
    out = []
    for k, ws in lines.items():
        ws.sort()
        x0 = min(w[0] for w in ws); y0 = min(w[1] for w in ws)
        x1 = max(w[2] for w in ws); y1 = max(w[3] for w in ws)
        gaps = [ws[i + 1][0] - ws[i][2] for i in range(len(ws) - 1)]
        hs = sorted(w[3] - w[1] for w in ws)
        out.append(dict(block=k[0], x0=x0, y0=y0, x1=x1, y1=y1, n=len(ws),
                        h=hs[len(hs) // 2], gap=max(gaps) if gaps else 0,
                        text=' '.join(w[4] for w in ws)))
    return sorted(out, key=lambda l: (l['y0'], l['x0']))


def label_of(name):
    m = re.search(r'_(e?)(FIG|TABLE)\.?(\d+G?\.\d+)', name, re.I)
    if not m:
        return None
    return (m.group(1).lower() == 'e', m.group(2).upper(), m.group(3))


def find_anchor(lines, lab):
    _, kind, num = lab
    num_re = re.escape(num).replace(r'\.', r'[.,·]?\s*')
    pat = re.compile(r'e?' + ('F[I1l]G' if kind == 'FIG' else 'TAB[L1I]E') + r'[.,]?\s*' + num_re, re.I)
    hits = [l for l in lines if pat.search(l['text'][:40])]
    if not hits:  # the number misread; any caption start of the right kind
        loose = re.compile(r'^\W{0,2}e?' + ('F[I1l]G' if kind == 'FIG' else 'TAB[L1I]E') + r'\b', re.I)
        hits = [l for l in lines if loose.search(l['text'])]
    return hits[0] if hits else None


def nonwhite(im):
    a = np.asarray(im.convert('RGB')).astype(int)
    g = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    return (g < 232) | (sat > 25)


def column(mask, x0, x1, y0, y1, min_gutter=9):
    """Widen [x0,x1] across rows y0..y1 until a white gutter on each side."""
    W = mask.shape[1]
    ink = mask[max(0, y0):max(y0 + 1, y1)].any(axis=0)
    def walk(x, step):
        run = 0
        while 0 <= x < W:
            run = run + 1 if not ink[x] else 0
            if run >= min_gutter:
                return x - step * (run - 1)
            x += step
        return max(0, min(W - 1, x - step))
    return walk(x0, -1), walk(x1, +1)


def prose(l, mask, body_h):
    """Body text: several words, filling most of ITS OWN column, at body size,
    evenly spaced. Measured against the line's own column, not the figure's —
    a half-page column of prose beside a full-width figure is still prose."""
    if l['n'] < 5 or l['gap'] > 2.6 * max(l['h'], 8) or l['h'] < 0.85 * body_h:
        return False
    c0, c1 = column(mask, l['x0'], l['x1'], l['y0'], l['y1'])
    return (l['x1'] - l['x0']) >= 0.72 * (c1 - c0)


def shaded(im):
    """Pale tinted ground (table rows), as opposed to white paper or dark ink."""
    a = np.asarray(im).astype(int)
    g = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
    return (g > 170) & (g < 250) & (sat > 8)


def table_band(im, A):
    """A table's width is its coloured header band's, not the gutter's: the
    white between a table's own columns looks exactly like a page gutter."""
    a = np.asarray(im).astype(int)
    sat = (a.max(axis=2) - a.min(axis=2)) > 60
    best = (0, 0, 0)
    for y in range(A['y1'], min(a.shape[0], A['y1'] + 120)):
        r = np.concatenate(([0], sat[y].astype(np.int8), [0]))
        d = np.diff(r)
        for x0, x1 in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
            if x1 - x0 > best[0]:
                best = (x1 - x0, x0, x1)
    return (best[1], best[2]) if best[0] >= 0.5 * (A['x1'] - A['x0']) else None


def propose(path):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    lab = label_of(os.path.basename(path))
    lines = ocr_lines(im)
    mask = nonwhite(im)
    A = find_anchor(lines, lab) if lab else None
    if A is None:
        return None, 'caption/title not found by OCR'
    hs = sorted(l['h'] for l in lines if l['n'] >= 5)
    body_h = hs[int(len(hs) * .6)] if hs else A['h']

    # The caption paragraph: A's block, but only while the lines keep coming at
    # caption pitch and size. OCR happily folds the next heading into it.
    cap, prev = [A], A
    for l in sorted((l for l in lines if l['block'] == A['block'] and l['y0'] > A['y0'] + 2),
                    key=lambda l: l['y0']):
        if l['y0'] - prev['y1'] > 1.3 * A['h'] or l['h'] > 1.3 * A['h']:
            break
        cap.append(l); prev = l
    cy1 = max(l['y1'] for l in cap)
    cx0 = min(l['x0'] for l in cap); cx1 = max(l['x1'] for l in cap)
    band = table_band(im, A) if lab[1] == 'TABLE' else None
    if band:
        X0, X1 = min(band[0], cx0), max(band[1], cx1)
    else:
        X0, X1 = column(mask, cx0, cx1, A['y0'], cy1)
    overlaps = lambda l: min(l['x1'], X1) - max(l['x0'], X0) > 0.3 * (l['x1'] - l['x0'])
    is_cap = lambda l: re.match(r'^\W{0,2}e?(F[I1l]G|TAB[L1I]E)\b', l['text'], re.I)

    if lab[1] == 'FIG':
        bottom = cy1
        top, run = 0, []
        for l in sorted((l for l in lines if l['y1'] <= A['y0'] + 2 and overlaps(l)), key=lambda l: -l['y1']):
            if l in cap:
                continue
            if is_cap(l):
                # the whole of that other caption's paragraph sits above here
                top = max(m['y1'] for m in lines if m['block'] == l['block'] and m['y0'] < A['y0'])
                break
            if prose(l, mask, body_h):
                run.append(l)
                if len(run) >= 2:
                    top = run[0]['y1']
                    break
            else:
                run = []
        rows = mask[top:A['y0'], X0:X1].any(axis=1)
        art = np.nonzero(rows)[0]
        if len(art) < 20:
            return None, 'no artwork above the caption (caption beside the figure?)'
        y0 = top + art[0]
    else:  # TABLE: from the title down to body prose
        y0 = A['y0']
        bottom, run = H, []
        tint = shaded(im)
        for l in (l for l in lines if l['y0'] > A['y1'] and overlaps(l)):
            if is_cap(l):
                bottom = l['y0']; break
            if tint[l['y0']:l['y1'], max(l['x0'], X0):min(l['x1'], X1)].mean() > 0.3:
                run = []; continue   # a row on the table's shaded ground
            if prose(l, mask, body_h):
                run.append(l)
                if len(run) >= 2:
                    bottom = run[0]['y0']; break
            else:
                run = []
        rows = mask[y0:bottom, X0:X1].any(axis=1)
        filled = np.nonzero(rows)[0]
        bottom = y0 + (filled[-1] + 1 if len(filled) else bottom - y0)

    # tighten to the ink actually inside the box, then pad
    sub = mask[y0:bottom, X0:X1]
    cols = np.nonzero(sub.any(axis=0))[0]; rws = np.nonzero(sub.any(axis=1))[0]
    if not len(cols) or not len(rws):
        return None, 'empty box'
    box = [max(0, X0 + cols[0] - PAD), max(0, y0 + rws[0] - PAD),
           min(W, X0 + cols[-1] + 1 + PAD), min(H, y0 + rws[-1] + 1 + PAD)]
    return box, None


def propose_blob(path):
    """The figure as a connected region: erase body prose, bridge small gaps,
    keep the ink region that joins onto the caption or title."""
    import cv2
    im = Image.open(path).convert('RGB')
    W, H = im.size
    lab = label_of(os.path.basename(path))
    lines = ocr_lines(im)
    A = find_anchor(lines, lab) if lab else None
    if A is None:
        return None, 'caption/title not found by OCR'
    mask = nonwhite(im)
    tint = shaded(im)
    hs = sorted(l['h'] for l in lines if l['n'] >= 5)
    body_h = hs[int(len(hs) * .6)] if hs else A['h']
    cap = [l for l in lines if l['block'] == A['block'] and l['y0'] >= A['y0'] - 2]
    ink = mask.copy()
    for l in lines:
        if l in cap or l['n'] < 4 or l['h'] < 0.8 * body_h:
            continue
        if tint[l['y0']:l['y1'], l['x0']:l['x1']].mean() > 0.3:
            continue
        if l['gap'] > 2.6 * max(l['h'], 8):
            continue
        ink[max(0, l['y0'] - 3):l['y1'] + 3, max(0, l['x0'] - 3):l['x1'] + 3] = False
    k = max(9, int(body_h * 0.9))
    grown = cv2.dilate(ink.astype(np.uint8), np.ones((k, k), np.uint8))
    n, comp = cv2.connectedComponents(grown)
    cy, cx = (A['y0'] + A['y1']) // 2, (A['x0'] + min(A['x1'], A['x0'] + 40)) // 2
    ids = set(np.unique(comp[A['y0']:A['y1'], A['x0']:A['x1']])) - {0}
    if not ids:
        return None, 'caption not in any region'
    sel = np.isin(comp, list(ids)) & mask
    ys, xs = np.nonzero(sel)
    box = [max(0, xs.min() - PAD), max(0, ys.min() - PAD), min(W, xs.max() + 1 + PAD), min(H, ys.max() + 1 + PAD)]
    return box, None


def one(path):
    box, err = (propose_blob if MODE == 'blob' else propose)(path)
    return box, err, Image.open(path).size


MODE = 'blob' if '--blob' in sys.argv else 'lines'


def main():
    src, out = [a for a in sys.argv[1:] if not a.startswith('--')][:2]
    names = sorted(f for f in os.listdir(src) if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    rec = {'_why': 'Proposed by tools/propose-crops.py (caption-anchored, gutter-bounded); '
                   'every box then reviewed by eye and corrected by hand where wrong. '
                   'Boxes are [left, top, right, bottom] in the original image pixels.',
           'crops': {}, '_checked_and_left_alone': {}, '_failed': {}}
    with Pool(os.cpu_count()) as pool:
        results = pool.map(one, [os.path.join(src, n) for n in names])
    for n, (box, err, (W, H)) in zip(names, results):
        if err:
            rec['_failed'][n] = err
        elif box == [0, 0, W, H] or (box[2] - box[0]) * (box[3] - box[1]) > 0.97 * W * H:
            rec['_checked_and_left_alone'][n] = 'already tight'
        else:
            rec['crops'][n] = {'box': [int(v) for v in box], 'was': [W, H], 'why': 'proposed'}
    json.dump(rec, open(out, 'w'), indent=1)
    print(f'{len(rec["crops"])} cropped, {len(rec["_checked_and_left_alone"])} left, '
          f'{len(rec["_failed"])} failed', file=sys.stderr)


if __name__ == '__main__':
    main()
