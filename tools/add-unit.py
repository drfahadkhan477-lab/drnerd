#!/usr/bin/env python3
"""Bake a unit of reference notes, and the page images they cite, into content/.

    python tools/add-unit.py --notes <zip-or-folder> --figures <zip-or-folder>
                             [--unit arrhythmias] [--max-width 1400] [--quality 78]
                             [--crops tools/figure-crops.<unit>.json]

WHY THIS EXISTS. A unit written for the in-app importer cites its figures the
way the export laid them out — `![Fig 52.2 — …](page_figures/page_308.jpg)` —
and the importer resolves those against the files picked alongside. The build
does not: scripts/ref-images-patch.js resolves `refimg://<key>` against
content/refs-images/ and throws on a key that is not there. Getting from one to
the other by hand is 11 files of link rewriting and 53 images copied out of a
folder of 260. Done by hand it goes wrong quietly — the build catches a missing
image, but nothing catches the 180 MB of full-resolution pages that did get
copied and now ride inside the unit's figure file, which the app fetches whole.

WHAT IT DOES, in order, and it writes nothing until every step has succeeded:

  1. reads every .md in --notes (a folder, or a zip — the importer's package);
  2. finds each image link that is not already refimg://, http(s) or data:,
     and looks its FILE NAME up in --figures (a folder, or the export's zip —
     no need to unzip 180 MB to use 53 files of it);
  3. stops, naming every one, if any image is missing;
  4. writes the notes to content/refs/<unit>-<file>.md with those links
     rewritten to refimg://<unit>/<file name>;
  5. writes ONLY the cited images to content/refs-images/<unit>/, re-encoded
     as JPEG and scaled down to --max-width if wider — cropped first when
     --crops names a record from tools/figure-review.py.

It owns content/refs/<unit>-*.md and content/refs-images/<unit>/ and replaces
both on every run, so a note or figure dropped from the unit does not linger in
the build. It proves ownership with a marker file and refuses to touch a
folder of that name it did not create.

Needs Pillow (python -m pip install Pillow), the same as the figure tools.
content/ is gitignored and stays that way: nothing here is committed.
"""
import argparse, io, json, os, re, shutil, sys, zipfile

from PIL import Image

LINK = re.compile(r'(!\[[^\]]*\]\()([^)\s]+)(\))')
MARKER = '.add-unit'
IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp')


def listing(src, want):
    """{name-in-source: loader} for files in a folder or zip whose name passes want()."""
    out = {}
    if os.path.isdir(src):
        for root, _, files in os.walk(src):
            for f in files:
                p = os.path.join(root, f)
                rel = os.path.relpath(p, src).replace(os.sep, '/')
                if want(rel):
                    out[rel] = (lambda p=p: open(p, 'rb').read())
    elif zipfile.is_zipfile(src):
        z = zipfile.ZipFile(src)
        for info in z.infolist():
            n = info.filename
            if info.is_dir() or '__MACOSX/' in n or os.path.basename(n).startswith('._'):
                continue
            if want(n):
                out[n] = (lambda n=n: z.read(n))
    else:
        sys.exit(f'{src} is neither a folder nor a zip')
    return out


def by_basename(files):
    """Index by file name. Two different files sharing a name would make every
    lookup a guess, so that is refused rather than resolved."""
    idx = {}
    for rel, load in files.items():
        idx.setdefault(os.path.basename(rel), []).append((rel, load))
    return idx


def local_ref(ref):
    return not re.match(r'^(refimg:|https?:|data:)', ref, re.I)


def scaled_box(box, was, size):
    """A box measured on `was` applied to an image of `size`. The review sheet
    may have been built from the re-encoded copy, which is smaller than the
    original page when --max-width scaled it; the aspect ratio must agree or
    the box describes a different picture."""
    (w0, h0), (w, h) = was, size
    if (w0, h0) == (w, h):
        return tuple(box)
    sx, sy = w / w0, h / h0
    if abs(sx - sy) > 0.01:
        return None
    return tuple(int(round(v * (sx if i % 2 == 0 else sy))) for i, v in enumerate(box))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--notes', required=True, help='folder or zip of .md notes')
    ap.add_argument('--figures', required=True, help='folder or zip holding the cited images')
    ap.add_argument('--unit', default='arrhythmias',
                    help='namespace for file names and refimg:// keys (default: arrhythmias)')
    ap.add_argument('--max-width', type=int, default=1400)
    ap.add_argument('--quality', type=int, default=78)
    ap.add_argument('--crops', help='crop record from tools/figure-review.py (optional)')
    ap.add_argument('--content', default='content', help='content folder (default: ./content)')
    a = ap.parse_args()

    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', a.unit):
        sys.exit(f'--unit "{a.unit}": use lower-case letters, digits, - or _')

    refs_dir = os.path.join(a.content, 'refs')
    img_dir = os.path.join(a.content, 'refs-images', a.unit)
    if os.path.isdir(img_dir) and not os.path.exists(os.path.join(img_dir, MARKER)):
        sys.exit(f'{img_dir} exists and was not made by this tool — pick another --unit')

    # ── 1-3: read, resolve, and stop on anything missing ────────────────────
    notes = listing(a.notes, lambda n: n.lower().endswith('.md')
                    and os.path.basename(n).lower() != 'readme.md')
    if not notes:
        sys.exit(f'no .md files in {a.notes}')
    figs = by_basename(listing(a.figures, lambda n: n.lower().endswith(IMAGE_EXT)))

    texts, cited, missing, ambiguous = {}, {}, [], []
    for rel in sorted(notes):
        raw = notes[rel]().decode('utf-8')
        for m in LINK.finditer(raw):
            ref = m.group(2)
            if not local_ref(ref):
                continue
            name = os.path.basename(ref)
            hits = figs.get(name, [])
            if not hits:
                missing.append(f'{os.path.basename(rel)}: {ref}')
            elif len(hits) > 1:
                ambiguous.append(f'{name}: ' + ', '.join(h[0] for h in hits))
            else:
                cited[name] = hits[0][1]
        texts[os.path.basename(rel)] = raw
    if len(texts) != len(notes):
        sys.exit('two notes files share a name — flatten them into one folder first')
    if missing or ambiguous:
        for x in missing:
            print(f'  MISSING    {x}')
        for x in ambiguous:
            print(f'  AMBIGUOUS  {x}')
        sys.exit(f'{len(missing)} image(s) missing, {len(ambiguous)} ambiguous — nothing written')

    crops = {}
    if a.crops:
        # utf-8-sig: Notepad on the build laptop writes a byte-order mark, and plain
        # utf-8 refuses to parse JSON that starts with one.
        crops = json.load(open(a.crops, encoding='utf-8-sig')).get('crops', {})

    # ── encode every image in memory before touching the disk ───────────────
    encoded, cropped = {}, 0
    for name in sorted(cited):
        im = Image.open(io.BytesIO(cited[name]()))
        im.load()
        c = crops.get(name)
        if c:
            box = scaled_box(c['box'], c['was'], im.size)
            if box is None:
                sys.exit(f'crop for {name} was measured on {c["was"]}, '
                         f'which is not this image ({im.size[0]}x{im.size[1]}) scaled')
            im = im.crop(box)
            cropped += 1
        if im.width > a.max_width:
            im = im.resize((a.max_width, round(im.height * a.max_width / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.convert('RGB').save(buf, 'JPEG', quality=a.quality, optimize=True, progressive=True)
        encoded[name] = buf.getvalue()

    # ── 4-5: replace this unit's files, and only this unit's ────────────────
    os.makedirs(refs_dir, exist_ok=True)
    for f in os.listdir(refs_dir):
        if f.startswith(a.unit + '-') and f.endswith('.md'):
            os.remove(os.path.join(refs_dir, f))
    if os.path.isdir(img_dir):
        shutil.rmtree(img_dir)
    os.makedirs(img_dir)
    open(os.path.join(img_dir, MARKER), 'w').write('written by tools/add-unit.py\n')

    def rewrite(m):
        ref = m.group(2)
        if not local_ref(ref):
            return m.group(0)
        return f'{m.group(1)}refimg://{a.unit}/{os.path.basename(ref)}{m.group(3)}'

    links = 0
    for base, raw in texts.items():
        out, n = LINK.subn(rewrite, raw)
        links += n
        open(os.path.join(refs_dir, f'{a.unit}-{base}'), 'w', encoding='utf-8', newline='\n').write(out)
    total = 0
    for name, data in encoded.items():
        open(os.path.join(img_dir, name), 'wb').write(data)
        total += len(data)

    mb = total / 1048576
    print(f'notes    {len(texts)} files -> {refs_dir}{os.sep}{a.unit}-*.md')
    print(f'links    {links} figure links -> refimg://{a.unit}/...')
    print(f'images   {len(encoded)} files, {mb:.1f} MB -> {img_dir}'
          + (f'  ({cropped} cropped)' if a.crops else ''))
    print(f'         makes content/refs-images/{a.unit}.json about {mb * 4 / 3:.1f} MB in the split build '
          f'(one file per unit; the host refuses any file over 25.0 MB)')
    print('next     node tools/check-refs.js   then build as usual')


if __name__ == '__main__':
    main()
