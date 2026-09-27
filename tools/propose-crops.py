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


def prose(l, cw, body_h):
    return (l['n'] >= 5 and (l['x1'] - l['x0']) >= 0.72 * cw and
            l['gap'] <= 2.6 * max(l['h'], 8) and l['h'] >= 0.85 * body_h)


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

    cap = [l for l in lines if l['block'] == A['block'] and l['y0'] >= A['y0'] - 2]
    cy1 = max(l['y1'] for l in cap) if cap else A['y1']
    cx0 = min([A['x0']] + [l['x0'] for l in cap]); cx1 = max([A['x1']] + [l['x1'] for l in cap])
    X0, X1 = column(mask, cx0, cx1, A['y0'], cy1)
    cw = X1 - X0
    inside = lambda l: min(l['x1'], X1) - max(l['x0'], X0) > 0.6 * (l['x1'] - l['x0'])
    is_cap = lambda l: re.match(r'^\W{0,2}e?(F[I1l]G|TAB[L1I]E)\b', l['text'], re.I)

    if lab[1] == 'FIG':
        bottom = cy1
        top, run = 0, []
        for l in sorted((l for l in lines if l['y1'] <= A['y0'] + 2 and inside(l)), key=lambda l: -l['y1']):
            if l['block'] == A['block']:
                continue
            if is_cap(l):
                # the whole of that other caption's paragraph sits above here
                top = max(m['y1'] for m in lines if m['block'] == l['block'] and m['y0'] < A['y0'])
                break
            if prose(l, cw, body_h):
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
        for l in (l for l in lines if l['y0'] > A['y1'] and inside(l)):
            if is_cap(l) and l is not A:
                bottom = l['y0']; break
            if prose(l, cw, body_h):
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


def one(path):
    box, err = propose(path)
    return box, err, Image.open(path).size


def main():
    src, out = sys.argv[1], sys.argv[2]
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
