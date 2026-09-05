#!/usr/bin/env python3
"""
Build an offline review sheet so a person decides every figure crop.

    python3 tools/figure-review.py                      # content/refs-images
    python3 tools/figure-review.py --dir content/atlas/hf/visuals
    python3 tools/figure-review.py --out build/review.html --max-width 720

    # Review a freshly extracted unit ON ITS SOURCE PAGES, so a box can grow as
    # well as shrink — the only way to recover a legend the detector cut off:
    python3 tools/figure-review.py --manifest out/visual_manifest.json \
                                   --pages pages/ --record tools/figure-crops.valvular.json

WHY THIS EXISTS. Every automatic cropper tried here has been wrong in a way
that destroys information. The colour-based one cut TABLE 56.5 down to 5% of
its page. The ink-profile one in trim-figure.py scores clean multi-panel
artwork as prose — on 022_FIG.55.1 it would have cut at 177px and taken panel A
with it. Three of the four figures it flagged were false positives.

A detector that is wrong three times in four cannot be the thing that decides.
So it stops deciding. It ranks, and a person decides — once, over a sheet that
works on the iPad the figures are actually read on, with no network.

WHAT COMES OUT. Exactly the shape of tools/figure-crops.json: boxes in the
ORIGINAL image's pixels, each with the reason it was cropped, alongside the
figures that were looked at and deliberately left alone. That file is the
durable record — content/ is gitignored because the images are licensed, so a
crop that lives only in a JPEG is lost the next time the images are built.

WHAT IT WILL NOT DO. It never writes an image. The sheet produces JSON;
`trim-figure.py --apply-crops` is what touches pixels, idempotently, and it
refuses any box measured against dimensions the file no longer has.
"""
import sys, os, io, json, base64, glob, hashlib

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CROPS = os.path.join(HERE, 'figure-crops.json')
EXT = ('.jpg', '.jpeg', '.png', '.webp')


def load_record(path=CROPS):
    """The crops already decided. Missing file is not an error — first run."""
    if not os.path.exists(path):
        return {'crops': {}, '_checked_and_left_alone': {}}
    r = json.load(open(path))
    r.setdefault('crops', {})
    r.setdefault('_checked_and_left_alone', {})
    return r


def rank(path):
    """Order the sheet worst-first, so the eye meets the suspects while fresh.

    This is trim-figure's detector used the only way it has earned: to sort,
    never to cut. A high score means 'look at this one first', not 'crop it'."""
    try:
        sys.path.insert(0, HERE)
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'trimfig', os.path.join(HERE, 'trim-figure.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        cut, why = mod.find_trim(path)
        h = Image.open(path).size[1]
        return (cut / float(h) if h else 0.0), why
    except Exception as e:
        return 0.0, f'not scored ({e.__class__.__name__})'


def preview(path, max_w, quality):
    """A downscaled JPEG data URI. Small enough that 200 fit in one file."""
    im = Image.open(path)
    w, h = im.size
    scale = min(1.0, max_w / float(w))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))),
                       Image.LANCZOS)
    buf = io.BytesIO()
    im.convert('RGB').save(buf, 'JPEG', quality=quality, optimize=True)
    return ('data:image/jpeg;base64,' +
            base64.b64encode(buf.getvalue()).decode('ascii')), w, h


def collect_manifest(manifest, pages_dir, max_w, quality, limit=None, record=CROPS):
    """Review a visual-atlas manifest ON ITS SOURCE PAGES, not on its crops.

    The crop-per-file mode below can only ever tighten a box, because the image
    it shows IS the crop. That is enough when the detector over-reaches. It is
    useless when the detector cuts a figure's legend off, which on the valvular
    unit it did — and a legend is not optional, it is what turns a diagram into
    a figure.

    So this mode shows the WHOLE PAGE with the proposed box drawn on it. Every
    edge can move outwards as well as in. One page carrying two figures becomes
    two cards over the same image, which is why the record is keyed by the
    figure's label rather than by a filename."""
    import copy
    man = json.load(open(manifest))
    rec = load_record(record)
    items, seen = [], {}
    for it in man.get('items', []):
        if not it.get('box') or not it.get('page_image'):
            continue
        page = os.path.join(pages_dir, it['page_image'])
        if not os.path.exists(page):
            continue
        key = f"{it['id']:03d}_{it['label']}_p{it['page']:03d}.jpg"
        if key not in seen:
            seen[key] = preview(page, max_w, quality)
        uri, w, h = seen[key]
        prior = None
        if key in rec['crops']:
            c = rec['crops'][key]
            prior = {'verdict': 'crop', 'box': c['box'], 'was': c.get('was', [w, h]),
                     'why': c.get('why', '')}
        elif key in rec['_checked_and_left_alone']:
            prior = {'verdict': 'keep', 'why': rec['_checked_and_left_alone'][key]}
        items.append({
            'key': key, 'w': w, 'h': h, 'src': uri,
            'score': 0.0,
            'hint': f"{it['label']} · page {it['page']} · " +
                    (it.get('caption') or 'NO LEGEND FOUND')[:110],
            'proposed': it['box'],
            'prior': prior,
        })
    if limit:
        items = items[:limit]
    return items, rec


def collect(root, max_w, quality, limit=None, record=CROPS):
    files = [f for f in sorted(glob.glob(os.path.join(root, '**', '*'),
                                         recursive=True))
             if f.lower().endswith(EXT)]
    rec = load_record(record)
    items = []
    for f in files:
        key = os.path.relpath(f, root).replace(os.sep, '/')
        score, why = rank(f)
        items.append({'key': key, 'score': score, 'why': why, 'path': f})
    # Worst first, but anything already decided sinks — it needs no fresh eye.
    def sort_key(it):
        decided = it['key'] in rec['crops'] or it['key'] in rec['_checked_and_left_alone']
        return (1 if decided else 0, -it['score'], it['key'])
    items.sort(key=sort_key)
    if limit:
        items = items[:limit]
    out = []
    for it in items:
        uri, w, h = preview(it['path'], max_w, quality)
        prior = None
        if it['key'] in rec['crops']:
            c = rec['crops'][it['key']]
            prior = {'verdict': 'crop', 'box': c['box'], 'was': c.get('was', [w, h]),
                     'why': c.get('why', '')}
        elif it['key'] in rec['_checked_and_left_alone']:
            prior = {'verdict': 'keep', 'why': rec['_checked_and_left_alone'][it['key']]}
        out.append({'key': it['key'], 'w': w, 'h': h, 'src': uri,
                    'score': round(it['score'], 3), 'hint': it['why'],
                    'prior': prior})
    return out, rec


PAGE = r'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Figure review</title>
<style>
:root{
  --bg:#10171a; --card:#182126; --edge:#243138; --ink:#e6edef; --dim:#8fa3ab;
  --keep:#4cc3a2; --crop:#e8b04b; --none:#5b6d75; --hot:#e06c6c;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  -webkit-text-size-adjust:100%}
header{position:sticky;top:0;z-index:20;background:rgba(16,23,26,.96);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--edge);
  padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));
  display:flex;gap:10px;align-items:center;flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:600;letter-spacing:.01em}
.count{color:var(--dim);font-variant-numeric:tabular-nums;font-size:13px}
.bar{flex:1 1 120px;height:5px;background:var(--edge);border-radius:3px;overflow:hidden;min-width:80px}
.bar i{display:block;height:100%;background:var(--keep);width:0;transition:width .2s}
button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--edge);
  border-radius:8px;padding:7px 12px;cursor:pointer;-webkit-tap-highlight-color:transparent}
button:active{transform:translateY(1px)}
button:focus-visible{outline:2px solid var(--keep);outline-offset:2px}
.filters{display:flex;gap:6px;flex-wrap:wrap}
.filters button.on{background:var(--edge);border-color:var(--dim)}
main{padding:14px;display:flex;flex-direction:column;gap:14px;max-width:900px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--edge);border-radius:12px;overflow:hidden}
.card.done-keep{border-color:color-mix(in srgb,var(--keep) 55%,var(--edge))}
.card.done-crop{border-color:color-mix(in srgb,var(--crop) 55%,var(--edge))}
.hd{display:flex;gap:10px;align-items:baseline;padding:10px 12px;border-bottom:1px solid var(--edge);flex-wrap:wrap}
.key{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.hint{color:var(--dim);font-size:12px;flex:1 1 100%}
.badge{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
  padding:2px 7px;border-radius:4px;border:1px solid currentColor}
.b-keep{color:var(--keep)} .b-crop{color:var(--crop)} .b-none{color:var(--none)}
.b-hot{color:var(--hot)}
.stage{position:relative;touch-action:none;background:#0b1013;display:flex;justify-content:center}
.stage img{display:block;max-width:100%;height:auto;user-select:none;-webkit-user-drag:none}
.shade{position:absolute;background:rgba(8,12,14,.72);pointer-events:none}
.box{position:absolute;border:2px solid var(--crop);pointer-events:none;
  box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.grip{position:absolute;background:var(--crop);border-radius:3px;opacity:.9;
  box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.grip.h{height:12px;left:12%;width:76%;margin-top:-6px}
.grip.v{width:12px;top:12%;height:76%;margin-left:-6px}
.ft{display:flex;gap:8px;padding:10px 12px;flex-wrap:wrap;align-items:center}
.ft .dims{color:var(--dim);font-size:12px;font-variant-numeric:tabular-nums;margin-left:auto}
textarea{width:100%;background:#0b1013;color:var(--ink);border:1px solid var(--edge);
  border-radius:8px;padding:8px 10px;font:13px/1.45 inherit;resize:vertical}
.why{padding:0 12px 12px}
.why[hidden]{display:none}
dialog{border:1px solid var(--edge);border-radius:12px;background:var(--card);color:var(--ink);
  max-width:min(760px,92vw);width:100%;padding:0}
dialog::backdrop{background:rgba(0,0,0,.6)}
.dlg-hd{padding:12px 14px;border-bottom:1px solid var(--edge);display:flex;gap:10px;align-items:center}
.dlg-bd{padding:14px}
.dlg-bd textarea{height:46vh;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.note{color:var(--dim);font-size:12.5px;margin:0 0 10px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<header>
  <h1>Figure review</h1>
  <span class="count" id="count">0 / 0</span>
  <span class="bar"><i id="bar"></i></span>
  <span class="filters" id="filters">
    <button data-f="todo" class="on">To do</button>
    <button data-f="all">All</button>
    <button data-f="crop">Cropped</button>
    <button data-f="keep">Kept</button>
  </span>
  <button id="export">Export JSON</button>
</header>
<main id="list"></main>
<dialog id="out">
  <div class="dlg-hd"><strong>tools/figure-crops.json</strong>
    <button id="copy" style="margin-left:auto">Copy</button>
    <button id="close">Close</button></div>
  <div class="dlg-bd">
    <p class="note">Paste this over <code>__RECORD__</code>, then run
      <code>python3 tools/trim-figure.py --apply-crops __ROOT__ --record __RECORD__</code>.</p>
    <textarea id="json" readonly spellcheck="false"></textarea>
  </div>
</dialog>
<script>
const DATA = __DATA__;
const ROOT = __ROOTJSON__;
const SKEY = 'figreview.' + __SIG__;

/* Decisions survive a reload. An hour of tapping must not depend on the tab. */
let state = {};
try { state = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (e) { state = {}; }
DATA.forEach(d => {
  if (state[d.key]) return;
  if (d.prior && d.prior.verdict === 'crop')
    state[d.key] = {v:'crop', box:d.prior.box.slice(), was:d.prior.was, why:d.prior.why, locked:true};
  else if (d.prior && d.prior.verdict === 'keep')
    state[d.key] = {v:'keep', why:d.prior.why};
});
function save(){ try { localStorage.setItem(SKEY, JSON.stringify(state)); } catch(e){} }

let filter = 'todo';
const list = document.getElementById('list');

function decided(k){ return state[k] && state[k].v; }

function tally(){
  const n = DATA.length, d = DATA.filter(x => decided(x.key)).length;
  document.getElementById('count').textContent = d + ' / ' + n + ' decided';
  document.getElementById('bar').style.width = (n ? d / n * 100 : 0) + '%';
}

function visible(d){
  const v = state[d.key] && state[d.key].v;
  if (filter === 'all') return true;
  if (filter === 'todo') return !v;
  return v === filter;
}

function card(d){
  const st = state[d.key] || {};
  const el = document.createElement('section');
  el.className = 'card' + (st.v ? ' done-' + st.v : '');
  const hot = d.score > 0.10;
  el.innerHTML =
    '<div class="hd">' +
      '<span class="key"></span>' +
      '<span class="badge ' + (st.v === 'keep' ? 'b-keep' : st.v === 'crop' ? 'b-crop' : hot ? 'b-hot' : 'b-none') + '">' +
        (st.v === 'keep' ? 'kept whole' : st.v === 'crop' ? 'cropped' : hot ? 'look here' : 'undecided') +
      '</span>' +
      '<span class="hint"></span>' +
    '</div>' +
    '<div class="stage"><img alt="" draggable="false">' +
      '<div class="shade s-t"></div><div class="shade s-b"></div>' +
      '<div class="shade s-l"></div><div class="shade s-r"></div>' +
      '<div class="box"></div>' +
      '<div class="grip h g-t" data-e="t"></div><div class="grip h g-b" data-e="b"></div>' +
      '<div class="grip v g-l" data-e="l"></div><div class="grip v g-r" data-e="r"></div>' +
    '</div>' +
    '<div class="ft">' +
      '<button data-a="keep">' + (d.proposed ? 'Skip this one' : 'Keep whole') + '</button>' +
      '<button data-a="crop">Use this crop</button>' +
      '<button data-a="reset">Reset box</button>' +
      '<span class="dims"></span>' +
    '</div>' +
    '<div class="why" hidden><textarea rows="2" placeholder="Why this crop — it goes into the record"></textarea></div>';

  el.querySelector('.key').textContent = d.key;
  el.querySelector('.hint').textContent = d.w + '×' + d.h + ' · ' + d.hint;
  const img = el.querySelector('img');
  img.src = d.src;

  /* Box is held in ORIGINAL pixels throughout; the preview is only a lens. */
  /* Where the box starts: a decision already made, else the detector's
     proposal, else the whole image. The proposal matters — on a page review
     there is nothing to see without it, since the card shows a full textbook
     page and the figure is a rectangle somewhere inside it. */
  let box = (st.box && st.box.length === 4) ? st.box.slice()
          : (d.proposed && d.proposed.length === 4) ? d.proposed.slice()
          : [0, 0, d.w, d.h];
  const why = el.querySelector('textarea');
  why.value = st.why || '';
  const wrap = el.querySelector('.why');
  if (st.v === 'crop') wrap.hidden = false;

  function paint(){
    const r = img.getBoundingClientRect();
    if (!r.width) return;
    const sx = r.width / d.w, sy = r.height / d.h;
    const L = box[0]*sx, T = box[1]*sy, R = box[2]*sx, B = box[3]*sy;
    const off = img.offsetLeft;
    const q = s => el.querySelector(s);
    q('.box').style.cssText = 'left:'+(off+L)+'px;top:'+T+'px;width:'+(R-L)+'px;height:'+(B-T)+'px';
    q('.s-t').style.cssText = 'left:'+off+'px;top:0;width:'+r.width+'px;height:'+T+'px';
    q('.s-b').style.cssText = 'left:'+off+'px;top:'+B+'px;width:'+r.width+'px;height:'+(r.height-B)+'px';
    q('.s-l').style.cssText = 'left:'+off+'px;top:'+T+'px;width:'+L+'px;height:'+(B-T)+'px';
    q('.s-r').style.cssText = 'left:'+(off+R)+'px;top:'+T+'px;width:'+(r.width-R)+'px;height:'+(B-T)+'px';
    q('.g-t').style.cssText += ';left:'+(off+L+ (R-L)*0.12)+'px;top:'+T+'px;width:'+((R-L)*0.76)+'px';
    q('.g-b').style.cssText += ';left:'+(off+L+ (R-L)*0.12)+'px;top:'+B+'px;width:'+((R-L)*0.76)+'px';
    q('.g-l').style.cssText += ';left:'+(off+L)+'px;top:'+(T+(B-T)*0.12)+'px;height:'+((B-T)*0.76)+'px';
    q('.g-r').style.cssText += ';left:'+(off+R)+'px;top:'+(T+(B-T)*0.12)+'px;height:'+((B-T)*0.76)+'px';
    el.querySelector('.dims').textContent =
      (box[2]-box[0]) + '×' + (box[3]-box[1]) +
      (box[0]||box[1]||box[2]!==d.w||box[3]!==d.h ? '  (from ' + d.w + '×' + d.h + ')' : '  whole image');
  }

  img.addEventListener('load', paint);
  if (img.complete) requestAnimationFrame(paint);

  /* Edge dragging. Pointer events so Pencil, finger and mouse are one path. */
  let drag = null;
  el.querySelectorAll('.grip').forEach(g => {
    g.style.touchAction = 'none';
    g.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      g.setPointerCapture(ev.pointerId);
      drag = g.dataset.e;
    });
    g.addEventListener('pointermove', ev => {
      if (!drag) return;
      const r = img.getBoundingClientRect();
      const x = Math.round((ev.clientX - r.left) / r.width * d.w);
      const y = Math.round((ev.clientY - r.top) / r.height * d.h);
      const MIN = 16;
      if (drag === 't') box[1] = Math.max(0, Math.min(y, box[3] - MIN));
      if (drag === 'b') box[3] = Math.min(d.h, Math.max(y, box[1] + MIN));
      if (drag === 'l') box[0] = Math.max(0, Math.min(x, box[2] - MIN));
      if (drag === 'r') box[2] = Math.min(d.w, Math.max(x, box[0] + MIN));
      paint();
    });
    const end = ev => { if (drag) { drag = null; wrap.hidden = false; } };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  });

  el.addEventListener('click', ev => {
    const a = ev.target.closest('button[data-a]');
    if (!a) return;
    if (a.dataset.a === 'reset') {
      box = (d.proposed && d.proposed.length === 4) ? d.proposed.slice() : [0,0,d.w,d.h];
      paint(); return;
    }
    if (a.dataset.a === 'keep') {
      state[d.key] = {v:'keep', why: why.value.trim() ||
        'reviewed on the sheet and left whole — no page prose to remove'};
    } else {
      const whole = box[0]===0 && box[1]===0 && box[2]===d.w && box[3]===d.h;
      if (whole && !(d.proposed && d.proposed.length === 4)) {
        alert('That box is the whole image. Drag an edge in first, or press Keep whole.');
        return;
      }
      state[d.key] = {v:'crop', box: box.slice(), was:[d.w, d.h],
        why: why.value.trim() || 'cropped on review to remove page furniture'};
    }
    save(); render();
  });

  why.addEventListener('input', () => {
    if (state[d.key]) { state[d.key].why = why.value.trim(); save(); }
  });

  return el;
}

function render(){
  const keep = window.scrollY;
  list.textContent = '';
  DATA.filter(visible).forEach(d => list.appendChild(card(d)));
  tally();
  window.scrollTo(0, keep);
}

document.getElementById('filters').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b));
  render();
});

function buildJSON(){
  const crops = {}, kept = {};
  DATA.forEach(d => {
    const s = state[d.key];
    if (!s || !s.v) return;
    if (s.v === 'crop') crops[d.key] = {box: s.box, was: s.was, why: s.why};
    else kept[d.key] = s.why;
  });
  return JSON.stringify({
    _why: 'Crops applied to ' + ROOT + ' after extraction. Decided on the review sheet ' +
          'built by tools/figure-review.py — every entry here was looked at by a person. ' +
          'content/ is gitignored (the images are licensed), so the correction has to live ' +
          'here as data or it is lost the next time the images are regenerated. Boxes are ' +
          '[left, top, right, bottom] in the ORIGINAL image pixels. Run: ' +
          'python3 tools/trim-figure.py --apply-crops ' + ROOT,
    crops: crops,
    _checked_and_left_alone: kept
  }, null, 2);
}

document.getElementById('export').addEventListener('click', () => {
  document.getElementById('json').value = buildJSON();
  document.getElementById('out').showModal();
});
document.getElementById('close').addEventListener('click', () =>
  document.getElementById('out').close());
document.getElementById('copy').addEventListener('click', async () => {
  const t = document.getElementById('json');
  const b = document.getElementById('copy');
  try { await navigator.clipboard.writeText(t.value); b.textContent = 'Copied'; }
  catch (e) { t.removeAttribute('readonly'); t.select(); b.textContent = 'Select and copy'; }
  setTimeout(() => { b.textContent = 'Copy'; }, 1800);
});

addEventListener('resize', () => render());
render();
</script></body></html>
'''


def build(root, out, max_w, quality, limit=None, record=CROPS,
          manifest=None, pages_dir=None):
    if manifest:
        items, rec = collect_manifest(manifest, pages_dir, max_w, quality, limit, record)
    else:
        items, rec = collect(root, max_w, quality, limit, record)
    sig = hashlib.sha1((root + '|' + record + '|' + '|'.join(i['key'] for i in items))
                       .encode('utf-8')).hexdigest()[:12]
    html = (PAGE
            .replace('__DATA__', json.dumps(items))
            .replace('__ROOTJSON__', json.dumps(root))
            .replace('__ROOT__', root)
            .replace('__RECORD__', os.path.relpath(record, os.path.dirname(HERE)))
            .replace('__SIG__', json.dumps(sig)))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w') as fh:
        fh.write(html)
    already = sum(1 for i in items if i['prior'])
    hot = sum(1 for i in items if i['score'] > 0.10)
    proposed = sum(1 for i in items if i.get('proposed'))
    where = f'{manifest}' if manifest else root
    print(f'{len(items)} figures from {where}  (record: {record})')
    if proposed:
        print(f'  {already} already decided, {proposed} shown on their full page '
              f'with a proposed box')
    else:
        print(f'  {already} already decided, {hot} ranked worth a first look')
    print(f'  {os.path.getsize(out)/1e6:.1f} MB -> {out}')
    print('\nOpen it on the iPad, decide every card, then Export JSON.')
    return out


def main():
    argv = sys.argv[1:]
    def opt(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default
    root = opt('--dir', 'content/refs-images')
    out = opt('--out', 'build/figure-review.html')
    max_w = int(opt('--max-width', '640'))
    quality = int(opt('--quality', '72'))
    limit = opt('--limit')
    # One record per tree. content/refs-images keeps the historical filename;
    # anything else gets its own, because two trees sharing a record would let
    # a decision about one figure be applied to a different image entirely.
    default_record = CROPS if os.path.normpath(root) == os.path.normpath(
        'content/refs-images') else os.path.join(
            HERE, 'figure-crops.' + os.path.basename(os.path.normpath(root)) + '.json')
    record = opt('--record', default_record)
    manifest = opt('--manifest')
    pages_dir = opt('--pages')
    if manifest:
        if not pages_dir:
            sys.exit('--manifest needs --pages: the manifest names page images, '
                     'and this mode reviews the figure ON its page')
        if not os.path.exists(manifest):
            sys.exit(f'{manifest} does not exist')
        build(root, out, max_w, quality, int(limit) if limit else None, record,
              manifest=manifest, pages_dir=pages_dir)
        return
    if not os.path.isdir(root):
        sys.exit(f'{root} is not a directory — build the content first')
    build(root, out, max_w, quality, int(limit) if limit else None, record)


if __name__ == '__main__':
    main()
