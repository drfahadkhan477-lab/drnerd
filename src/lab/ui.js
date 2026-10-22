/* The Practice Lab's screens, inside Systole. Everything that is not drawing, sound or storage is in src/lab/*.js and
   tested without a browser; this file wires those to the screen Systole gives it, and tests/verify-lab.js drives it.

   Systole draws the screen (buildPractice) and hands its root element here through LabUI.mount() after every draw, and
   calls LabUI.unmount() when another screen is drawn; the Lab draws its own home, drills and heart map inside that
   element. Its classes and ids all start plab-, so Systole's .btn, .chip and .card never reach it and its own never
   reach Systole; its colours are Systole's theme tokens (app/css/practice.css). It was a separate app, built by
   scripts/build-lab.js, until it moved here. */
(function () {
'use strict';

const HS = window.HeartSounds, TR = window.Tracings, ST = window.Strips, HM = window.HeartMap;
const Drill = window.Drill, LP = window.LabProgress, LI = window.LabItems, FSRS = window.FSRS;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let root = null;   // the element Systole drew for the Lab, while the Lab is on screen
const $ = sel => root ? root.querySelector(sel) : null;
const cssVar = n => (root && getComputedStyle(root).getPropertyValue(n).trim()) || '#888';

/* ── storage: the Lab opens either way ───────────────────────────────── */
let store = null;
try { store = window.localStorage; store.getItem(LP.KEY); } catch (_) { store = null; }
let progress = LP.load(store);
let saveFailed = !store;
const today = () => FSRS.todayISO();
function persist() { saveFailed = !LP.save(store, progress); }

/* ── state ───────────────────────────────────────────────────────────── */
const L = { screen: 'home', kind: null, item: null, options: [], picked: null, stim: null, reason: '', session: { n: 0, c: 0 }, ex: 'snd:as', playing: false };

/* ── sound: one buffer at a time, with a cursor that follows it ──────── */
let ac = null, src = null, t0 = 0, dur = 0;
function context() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  if (!ac) ac = new C();
  /* resume() can stay pending (autoplay with no gesture) and Firefox rejects
     it with "Navigated away from page" when the page reloads; nothing is lost
     then, so the rejection is handled rather than reported as an error. */
  if (ac.state === 'suspended') { const r = ac.resume(); if (r && r.catch) r.catch(() => {}); }
  return ac;
}
function stop() {
  try { if (src) { src.onended = null; src.stop(); } } catch (_) { /* already stopped */ }
  src = null; L.playing = false; setCursor(null);
  const b = $('[data-act="play"]'); if (b) { b.setAttribute('aria-pressed', 'false'); b.textContent = '▶ Play'; }
}
function play(samples, rate, loop) {
  stop();
  const c = context();
  if (!c) { say('This browser cannot play sound.'); return false; }
  const buf = c.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples, 0);
  src = c.createBufferSource(); src.buffer = buf; src.loop = !!loop; src.connect(c.destination);
  src.onended = () => { if (!loop) stop(); };
  src.start(); t0 = c.currentTime; dur = samples.length / rate; L.playing = true;
  const b = $('[data-act="play"]'); if (b) { b.setAttribute('aria-pressed', 'true'); b.textContent = '■ Stop'; }
  (function tick() { if (!L.playing || !ac) return; setCursor(((ac.currentTime - t0) % dur) / dur); requestAnimationFrame(tick); })();
  return true;
}
function setCursor(f) {
  const el = $('.plab-cursor'); if (!el) return;
  if (f == null) { el.classList.remove('plab-on'); return; }
  el.classList.add('plab-on'); el.style.left = (f * 100).toFixed(2) + '%';
}
function say(text) { const l = $('#plab-live'); if (l) l.textContent = text; }

/* ── drawing ─────────────────────────────────────────────────────────── */
function fit(c, h) {
  const w = (c.parentElement && c.parentElement.clientWidth) || 640, d = window.devicePixelRatio || 1;
  c.style.height = h + 'px'; c.width = Math.round(w * d); c.height = Math.round(h * d);
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w, h };
}
const label = (g, text, x, y, color, align) => { g.fillStyle = color; g.textAlign = align || 'center'; g.font = '600 12px ' + cssVar('--plab-font'); g.fillText(text, x, y); };

function drawSound(c, r, reveal) {
  const { g, w, h } = fit(c, 150), mid = h / 2, accent = cssVar('--plab-accent'), ink = cssVar('--plab-trace'), muted = cssVar('--plab-muted');
  const n = r.samples.length, beats = r.beats;
  const ev = id => r.events.find(e => e.id === id).at;
  if (reveal) {
    g.fillStyle = accent; g.globalAlpha = 0.09;
    for (let k = 0; k < beats; k++) g.fillRect((k + ev('mc')) / beats * w, 0, (ev('ac') - ev('mc')) / beats * w, h);
    g.globalAlpha = 1;
  }
  g.strokeStyle = cssVar('--plab-line'); g.lineWidth = 1; g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
  g.strokeStyle = ink; g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x < w; x++) {
    const a = Math.floor(x / w * n), b = Math.max(a + 1, Math.floor((x + 1) / w * n));
    let lo = 0, hi = 0;
    for (let i = a; i < b; i++) { const v = r.samples[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    g.moveTo(x + 0.5, mid - hi * (mid - 8)); g.lineTo(x + 0.5, mid - lo * (mid - 8));
  }
  g.stroke();
  if (reveal) {
    for (let k = 0; k < beats; k++) {
      [['S1', 'mc'], ['S2', 'ac']].forEach(([name, id]) => {
        const x = (k + ev(id)) / beats * w;
        g.strokeStyle = accent; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x, 18); g.lineTo(x, h); g.stroke(); g.setLineDash([]);
        label(g, name, x, 12, accent);
      });
    }
    label(g, 'shaded: systole', w - 6, h - 6, muted, 'right');
  }
}

/* One scale for every tracing, so heights are comparable from one to the next. */
const TRACE_RANGE = (() => {
  let lo = Infinity, hi = -Infinity;
  TR.TRACINGS.forEach(t => { for (let i = 0; i < 200; i++) { const v = t.fn(i / 200); lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  return { lo: Math.floor((lo - 2) / 5) * 5, hi: Math.ceil((hi + 2) / 5) * 5 };
})();

function drawTracing(c, t, reveal) {
  const { g, w, h } = fit(c, 220), L0 = 40, B = 20, T = 8, pw = w - L0 - 8, ph = h - B - T;
  const y = v => T + (1 - (v - TRACE_RANGE.lo) / (TRACE_RANGE.hi - TRACE_RANGE.lo)) * ph;
  g.font = '11px ' + cssVar('--plab-font');
  for (let v = TRACE_RANGE.lo; v <= TRACE_RANGE.hi; v += 5) {
    g.strokeStyle = v % 10 === 0 ? cssVar('--plab-grid-major') : cssVar('--plab-grid'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(L0, y(v) + 0.5); g.lineTo(w - 8, y(v) + 0.5); g.stroke();
    if (v % 10 === 0) label(g, String(v), L0 - 6, y(v) + 4, cssVar('--plab-muted'), 'right');
  }
  label(g, 'mmHg', 2, 12, cssVar('--plab-muted'), 'left');
  g.strokeStyle = cssVar('--plab-trace'); g.lineWidth = 2; g.beginPath();
  for (let x = 0; x <= pw; x++) { const px = L0 + x, v = t.fn((x / pw) * 2); x ? g.lineTo(px, y(v)) : g.moveTo(px, y(v)); }
  g.stroke();
  label(g, 'two beats', w - 10, h - 5, cssVar('--plab-muted'), 'right');
  if (reveal) {
    const f = TR.features(t.fn), accent = cssVar('--plab-accent');
    const mark = (name, at, v) => { const x = L0 + (at / 2) * pw, yy = y(v); g.fillStyle = accent; g.beginPath(); g.arc(x, yy, 3.5, 0, 6.3); g.fill(); label(g, name, x, yy - 8, accent); };
    const at2 = (tt) => [tt, tt + 1];   // marked on both beats
    const addMark = (name, tt) => at2(tt).forEach(a => mark(name, a, t.fn(a % 1)));
    if (f.aPeak >= 1) addMark('a', f.aAt);
    if (f.sysPeak >= 3) addMark(f.sysPeak > f.vPeak ? 'systolic wave' : 'v', f.sysAt);
    else if (f.vPeak >= 1) addMark('v', f.vAt);
    if (f.xDepth >= 0.5) addMark('x', f.xAt);
    if (f.yDepth >= 0.5) addMark('y', f.yAt);
  }
}

function drawStrip(c, tr) {
  const { g, w, h } = fit(c, 190), lo = -0.8, hi = 1.5, y = v => (1 - (v - lo) / (hi - lo)) * h, secs = tr.seconds;
  const line = (x0, y0, x1, y1, col) => { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  for (let k = 0; k * 0.04 <= secs + 1e-9; k++) { const x = Math.round(k * 0.04 / secs * w) + 0.5; line(x, 0, x, h, k % 5 === 0 ? cssVar('--plab-grid-major') : cssVar('--plab-grid')); }
  for (let k = Math.ceil(lo / 0.1); k * 0.1 <= hi + 1e-9; k++) { const yy = Math.round(y(k * 0.1)) + 0.5; line(0, yy, w, yy, k % 5 === 0 ? cssVar('--plab-grid-major') : cssVar('--plab-grid')); }
  g.strokeStyle = cssVar('--plab-trace'); g.lineWidth = 1.7; g.lineJoin = 'round'; g.beginPath();
  const n = tr.samples.length;
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * w, yy = y(tr.samples[i]); i ? g.lineTo(x, yy) : g.moveTo(x, yy); }
  g.stroke();
  label(g, '25 mm/s · 10 mm/mV', w - 8, h - 6, cssVar('--plab-muted'), 'right');
}

/* ── the heart, drawn from the map ───────────────────────────────────── */
function polyline(pts) { return 'M' + pts.map(p => p.x.toFixed(0) + ' ' + p.y.toFixed(0)).join(' L'); }
function heartSvg(c) {
  const C = HM.CHAMBERS, ab = { SVC: 'SVC', RA: 'RA', RV: 'RV', PA: 'PA', Ao: 'Ao', PV: 'PV', LA: 'LA', LV: 'LV' };
  let s = '<svg class="plab-heart" viewBox="0 0 400 390" role="img" aria-label="' + esc(c.alt) + '"><defs>' +
    '<marker id="plab-arr-n" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--plab-muted)"/></marker>' +
    '<marker id="plab-arr-a" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--plab-warn)"/></marker></defs>';
  if (c.pericardium) s += '<ellipse cx="200" cy="200" rx="196" ry="188" fill="none" stroke="var(--plab-muted)" stroke-width="3" stroke-dasharray="3 6"/><text class="plab-lbl plab-lbl-sm" x="200" y="386">pericardium</text>';
  for (const id of Object.keys(C)) {
    const b = C[id], vessel = b.w < 60;
    const cls = ['plab-ch', b.side === 'right' ? 'plab-ch-r' : 'plab-ch-l', c.enlarged.includes(id) ? 'plab-big' : '', c.hypertrophied.includes(id) ? 'plab-thick' : '', c.site === id ? 'plab-site' : ''].filter(Boolean).join(' ');
    s += `<rect class="${cls}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${vessel ? 8 : 22}"><title>${esc(b.name)}</title></rect>`;
    s += `<text class="plab-lbl${vessel ? ' plab-lbl-sm' : ''}" x="${b.x + b.w / 2}" y="${vessel ? b.y + 14 : b.y + b.h / 2}">${ab[id]}</text>`;
  }
  for (const [a, b] of HM.NORMAL_FLOW) {
    const v = Object.values(HM.VALVES).find(x => x.between[0] === a && x.between[1] === b);
    const pts = [HM.centre(a)]; if (v) pts.push({ x: v.x, y: v.y }); pts.push(HM.centre(b));
    s += `<path class="plab-flow-n" d="${polyline(pts)}"/>`;
  }
  for (const f of c.flows) {
    const v = c.valve && HM.VALVES[c.valve], pts = [HM.centre(f.from)];
    if (f.kind === 'jet' && v) pts.push({ x: v.x, y: v.y });
    pts.push(HM.centre(f.to));
    s += `<path class="plab-flow-a" d="${polyline(pts)}"/>`;
  }
  for (const name of Object.keys(HM.VALVES)) {
    const v = HM.VALVES[name], bad = c.valve === name, gap = bad && c.state === 'stenosis' ? 5 : (bad || c.closed === name) ? 0 : 20;
    const cls = 'plab-valve' + (bad && c.state ? ' plab-' + c.state : '');
    s += `<g><title>${esc(v.name)}${bad && c.state ? ': ' + esc(c.state) : ''}</title>` +
      `<rect class="${cls}" x="${v.x - 22}" y="${v.y - 4}" width="${22 - gap / 2}" height="8" rx="3"/>` +
      `<rect class="${cls}" x="${v.x + gap / 2}" y="${v.y - 4}" width="${22 - gap / 2}" height="8" rx="3"/></g>`;
    if (bad) s += `<text class="plab-lbl plab-lbl-sm" x="${v.x}" y="${v.y + (name === 'mitral' || name === 'tricuspid' ? -14 : 18)}">${esc(v.name.replace(' valve', ''))}</text>`;
  }
  return s + '</svg>';
}
function chestSvg(areaId) {
  let s = '<svg class="plab-chest" viewBox="0 0 200 200" role="img" aria-label="Chest, with the place to listen marked"><path class="plab-body" d="M28 200 C28 130 36 70 70 46 L82 28 L118 28 L130 46 C164 70 172 130 172 200"/><path class="plab-body" d="M70 46 L100 54 L130 46"/><path class="plab-body" d="M100 54 L100 156" stroke-dasharray="4 4"/>';
  for (const id of Object.keys(HM.AREAS)) {
    const a = HM.AREAS[id];
    s += `<circle class="plab-area${id === areaId ? ' plab-on' : ''}" cx="${a.x}" cy="${a.y}" r="9"><title>${esc(a.name)}</title></circle>`;
  }
  const a = HM.AREAS[areaId];
  if (a) s += `<text class="plab-lbl plab-lbl-sm" x="${Math.min(150, Math.max(50, a.x))}" y="${a.y > 120 ? a.y + 22 : a.y - 16}">${esc(a.name)}</text>`;
  return s + '</svg>';
}

/* ── screens ─────────────────────────────────────────────────────────── */
const LIVE = '<div id="plab-live" class="plab-sr" aria-live="polite"></div>';
function banner() {
  return saveFailed ? '<div class="plab-banner" role="status">Progress cannot be saved in this window (a private window, or a page opened straight from Files). It will be lost when you close it. Open the installed app to keep it.</div>' : '';
}
function topbar(title, right) {
  return `<div class="plab-topbar"><button class="plab-back" data-act="home">‹ Practice Lab</button><h1 class="plab-title">${esc(title)}</h1><div class="plab-small plab-muted">${esc(right || '')}</div></div>`;
}

function home() {
  const sum = LP.summary(progress, LI.ALL, today());
  const tiles = LI.KINDS.map(k => {
    const s = LP.summary(progress, LI.ITEMS[k.id], today());
    return `<button class="plab-tile" data-act="open" data-kind="${k.id}"><h2>${esc(k.title)}</h2><span class="plab-muted">${esc(k.blurb)}</span>` +
      `<span class="plab-count">${s.seen} of ${s.total} seen${s.due ? ` · <span class="plab-due">${s.due} due</span>` : ''}</span></button>`;
  }).join('') +
    `<button class="plab-tile" data-act="explore"><h2>Show on the heart</h2><span class="plab-muted">Where the valve is, what it loads, where on the chest to listen, and when in the cycle.</span><span class="plab-count">${Object.keys(HM.CONDITIONS).length + Object.keys(HM.TRACING_MAP).length} conditions</span></button>`;
  root.innerHTML = `<div class="plab-head"><div><h1>Practice Lab</h1><p class="plab-muted">Heart sounds, pressure tracings and ECG strips: practise recognising what you will be shown. It remembers what you get wrong and brings it back.</p></div>` +
    `<button class="plab-back" data-act="leave">‹ Home</button></div>${banner()}` +
    `<div class="plab-card"><div class="plab-stats"><div class="plab-stat"><b>${sum.streak}</b><span>day streak</span></div><div class="plab-stat"><b>${sum.today}</b><span>answered today</span></div>` +
    `<div class="plab-stat"><b>${sum.accuracy == null ? '–' : Math.round(sum.accuracy * 100) + '%'}</b><span>right, all time</span></div><div class="plab-stat"><b>${sum.due}</b><span>due for review</span></div></div></div>` +
    `<div class="plab-tiles">${tiles}</div>` +
    `<footer class="plab-foot plab-small plab-muted"><p>Heart sounds are low-pitched: headphones make a real difference. Everything stays on this device. The teaching points were written for this app and have not been reviewed by a clinician: check anything you will rely on against your own sources.</p>` +
    `<button class="plab-btn" data-act="reset">Reset my progress</button></footer>${LIVE}`;
}

function stimulusHtml() {
  const k = L.kind;
  const cvs = '<div class="plab-stage"><canvas class="plab-view" role="img" aria-label="' +
    (k === 'sounds' ? 'Waveform of the heart sound you are listening to' : k === 'tracings' ? 'A pressure tracing, two beats' : 'An ECG strip') + '"></canvas><div class="plab-cursor"></div></div>';
  return cvs + (k === 'sounds' ? '<div class="plab-row"><button class="plab-btn plab-primary" data-act="play" aria-pressed="false">▶ Play</button><span class="plab-small plab-muted">Plays on a loop. Use headphones.</span></div>' : '');
}

function drill() {
  const k = LI.KINDS.find(x => x.id === L.kind), item = L.item, done = L.picked != null;
  const opts = L.options.map((id, i) => {
    const it = LI.byId(id);
    const cls = done ? (id === item.id ? ' plab-right' : id === L.picked ? ' plab-wrong' : '') : '';
    return `<button class="plab-option${cls}" data-act="answer" data-id="${esc(id)}" ${done ? 'disabled' : ''}><span class="plab-num">${i + 1}</span><span>${esc(it.name)}</span></button>`;
  }).join('');
  let fb = '';
  if (done) {
    const right = L.picked === item.id, picked = LI.byId(L.picked);
    const like = item.confusableWith.map(id => LI.byId(id)).filter(Boolean);
    let extra = '';
    if (L.kind === 'strips') { const f = ST.features(L.stim.t.samples, L.stim.t.rate); extra = `<p class="plab-small plab-muted">Rate on this strip: about ${Math.round(f.rate)} a minute.</p>`; }
    fb = `<div class="plab-card" id="plab-feedback"><div class="plab-verdict ${right ? 'plab-right' : 'plab-wrong'}">${right ? 'Correct.' : 'Not quite.'} This is ${esc(item.name)}.</div>` +
      (right ? '' : `<p class="plab-small plab-muted">You chose ${esc(picked.name)}: ${esc(picked.blurb)}</p>`) +
      `<p>${esc(item.blurb)}</p><ul class="plab-points">${item.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>${extra}` +
      (like.length ? `<div class="plab-chips"><span class="plab-small plab-muted">Often mistaken for</span>${like.map(l => `<span class="plab-chip">${esc(l.name)}</span>`).join('')}</div>` : '') +
      `<div class="plab-row"><button class="plab-btn plab-primary" data-act="next" id="plab-next">Next</button>${L.kind !== 'strips' ? `<button class="plab-btn" data-act="explore" data-item="${esc(item.id)}">Show on the heart</button>` : ''}</div></div>`;
  }
  root.innerHTML = topbar(k.title, `${L.session.c} of ${L.session.n} right`) + banner() +
    `<div class="plab-card"><h2>${esc(k.verb)}</h2>${stimulusHtml()}<div class="plab-options" role="group" aria-label="Answers">${opts}</div>` +
    (done ? '' : `<p class="plab-small plab-muted">${esc(L.reason)} Press 1 to ${L.options.length}, or tap.</p>`) + `</div>${fb}${LIVE}`;
}

function explore() {
  const it = LI.byId(L.ex) || LI.byId('snd:as');
  const opt = list => list.map(i => `<option value="${esc(i.id)}" ${i.id === it.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  let c, side = '', stim = '', kv = '';
  if (it.kind === 'sounds') {
    const f = HM.forLesion(it.key), phase = { systolic: 'systole', diastolic: 'diastole', continuous: 'the whole cycle', none: 'no murmur: only the sounds', both: 'systole and diastole' }[f.phase];
    c = Object.assign({}, f, { alt: 'The heart, with ' + it.name + ' marked' });
    side = `<div class="plab-card"><h2>Where to listen</h2>${chestSvg(f.area)}<p class="plab-small plab-muted">${esc(f.listen.name)}: ${esc(f.listen.where)}.</p></div>`;
    stim = '<div class="plab-stage"><canvas class="plab-view" role="img" aria-label="Waveform of this sound, with the first and second heart sounds marked"></canvas><div class="plab-cursor"></div></div><div class="plab-row"><button class="plab-btn plab-primary" data-act="play" aria-pressed="false">▶ Play</button><span class="plab-small plab-muted">Shaded: systole.</span></div>';
    const loaded = (f.enlarged.length ? 'enlarged: ' + f.enlarged.join(', ') : '') + (f.enlarged.length && f.hypertrophied.length ? '; ' : '') + (f.hypertrophied.length ? 'thickened: ' + f.hypertrophied.join(', ') : '');
    kv = `<dl class="plab-kv"><dt>Heard in</dt><dd>${esc(phase)}</dd><dt>Listen at</dt><dd>${esc(f.listen.name)}</dd>${f.radiates ? `<dt>Spreads</dt><dd>${esc(f.radiates)}</dd>` : ''}` +
      `<dt>Valve</dt><dd>${f.valve ? esc(HM.VALVES[f.valve].name + ': ' + f.state) : 'none at fault'}</dd>${loaded ? `<dt>Chambers</dt><dd>${esc(loaded)}</dd>` : ''}</dl><p>${esc(f.note)}</p>`;
  } else {
    const m = HM.TRACING_MAP[it.key];
    const flows = m.valve && m.state === 'stenosis' ? [{ from: HM.VALVES[m.valve].between[0], to: HM.VALVES[m.valve].between[1], kind: 'jet' }] :
      m.valve && m.state === 'regurgitation' ? [{ from: HM.VALVES[m.valve].between[1], to: HM.VALVES[m.valve].between[0], kind: 'jet' }] : [];
    c = { valve: m.valve || null, state: m.state || null, closed: m.valve && !m.state ? m.valve : null, enlarged: [], hypertrophied: m.hypertrophied || [], flows, site: m.site, pericardium: !!m.pericardium, alt: 'The heart, with the place this pressure is measured marked' };
    stim = '<div class="plab-stage"><canvas class="plab-view" role="img" aria-label="' + esc(it.name) + ' pressure tracing, two beats, with its waves marked"></canvas></div>';
    kv = `<dl class="plab-kv"><dt>Measured in</dt><dd>${m.site === 'LA' ? 'the wedge position, which reads the left atrium' : 'the right atrium (the jugular pulse shows the same waves)'}</dd>` +
      (m.valve ? `<dt>Valve</dt><dd>${esc(HM.VALVES[m.valve].name + (m.state ? ': ' + m.state : ': shut while the atrium fires'))}</dd>` : '') + (m.pericardium ? '<dt>Pericardium</dt><dd>involved</dd>' : '') + `</dl><p>${esc(it.blurb)}</p>`;
  }
  root.innerHTML = topbar('Show on the heart') + banner() +
    `<div class="plab-row"><label for="plab-pick" class="plab-muted">Condition</label><select id="plab-pick"><optgroup label="Heart sounds">${opt(LI.ITEMS.sounds)}</optgroup><optgroup label="Pressure tracings">${opt(LI.ITEMS.tracings)}</optgroup></select></div>` +
    `<div class="plab-explore"><div><div class="plab-card"><h2 id="plab-ex-title">${esc(it.name)}</h2>${heartSvg(c)}<div class="plab-legend"><span>Dashed thick outline: enlarged</span><span>Heavy wall: thickened</span><span>Orange arrows: abnormal flow</span><span>Blue outline: where it is measured</span></div></div>${side}</div>` +
    `<div><div class="plab-card">${stim}${kv}</div></div></div>${LIVE}`;
}

/* ── paint what needs layout, after the DOM is there ─────────────────── */
function paint() {
  const c = $('canvas.plab-view'); if (!c) return;
  if (L.screen === 'drill' && L.stim) {
    const done = L.picked != null;
    if (L.kind === 'sounds') drawSound(c, L.stim.r, done);
    else if (L.kind === 'tracings') drawTracing(c, L.stim.t, done);
    else drawStrip(c, L.stim.t);
  } else if (L.screen === 'explore') {
    const it = LI.byId(L.ex);
    if (it.kind === 'sounds') { L.stim = { r: HS.render(it.key, { beats: 3, bpm: 72, seed: 7, rate: 8000 }) }; drawSound(c, L.stim.r, true); }
    else drawTracing(c, TR.byId(it.key), true);
  }
}
/* Moving to another screen stops the sound; redrawing the same question to show the answer does not. A redraw that only
   puts the Lab back (Systole drew its screen again) keeps the page where it was scrolled to. */
function show(screen, keepSound, keepScroll) {
  if (!root) return;
  if (!keepSound) stop();
  L.screen = screen; ({ home, drill, explore })[screen](); paint();
  const b = $('[data-act="play"]'); if (b && L.playing) { b.setAttribute('aria-pressed', 'true'); b.textContent = '■ Stop'; }
  const h = $('h1, h2'); if (h) h.setAttribute('tabindex', '-1');
  if (keepScroll) return;
  if (typeof window.toTop === 'function') window.toTop(); else window.scrollTo(0, 0);
}

/* ── the drill ───────────────────────────────────────────────────────── */
function nextQuestion() {
  stop();
  const items = LI.ITEMS[L.kind], seed = (Math.random() * 1e9) | 0;
  const pick = Drill.next({ items, cards: progress.cards, today: today(), seed, recent: progress.recent });
  L.item = pick.item;
  L.reason = pick.reason === 'due' ? 'Due for review.' : pick.reason === 'new' ? 'New to you.' : 'Nothing due: reviewing what you are closest to forgetting.';
  L.options = Drill.options({ item: L.item, items, n: 4, seed: seed + 1 });
  L.picked = null;
  if (L.kind === 'sounds') L.stim = { r: HS.render(L.item.key, { beats: 4, bpm: [64, 72, 80][seed % 3], seed, rate: 8000 }) };
  else if (L.kind === 'tracings') L.stim = { t: TR.byId(L.item.key) };
  else L.stim = { t: ST.trace(L.item.key, 6) };
  show('drill');
  const first = $('.plab-option'); if (first) first.focus({ preventScroll: true });
}
function answer(id) {
  if (L.picked != null || !L.options.includes(id)) return;
  L.picked = id;
  const right = id === L.item.id;
  L.session.n++; if (right) L.session.c++;
  progress = LP.record(progress, { id: L.item.id, correct: right, today: today() });
  persist();
  show('drill', true);
  say((right ? 'Correct. ' : 'Not quite. ') + 'This is ' + L.item.name + '.');
  const n = $('#plab-next'); if (n) n.focus({ preventScroll: false });
}
function togglePlay() {
  if (L.playing) { stop(); return; }
  const r = L.stim && L.stim.r; if (r) play(r.samples, r.rate, true);
}

/* ── events: on the element Systole drew, so they go when it goes ───── */
function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled || !root || !root.contains(b)) return;
  const act = b.dataset.act;
  if (act === 'home') show('home');
  else if (act === 'leave') { if (typeof window.goHome === 'function') window.goHome(); }
  else if (act === 'open') { L.kind = b.dataset.kind; L.session = { n: 0, c: 0 }; nextQuestion(); }
  else if (act === 'answer') answer(b.dataset.id);
  else if (act === 'next') nextQuestion();
  else if (act === 'play') togglePlay();
  else if (act === 'explore') { if (b.dataset.item) L.ex = b.dataset.item; show('explore'); }
  else if (act === 'reset') { if (window.confirm('Forget everything the Practice Lab has recorded about you?')) { progress = LP.empty(); persist(); show('home'); } }
}
function onChange(e) { if (e.target.id === 'plab-pick') { L.ex = e.target.value; show('explore'); const s = $('#plab-pick'); if (s) s.focus(); } }
/* One listener for the page, answering only while the Lab is on screen: the quiz's own keys (A to E, F) are Systole's,
   and Systole's handler leaves every screen but the quiz and a mock block alone. */
document.addEventListener('keydown', e => {
  if (!root || !root.isConnected) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(SELECT|TEXTAREA|INPUT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (e.target.closest && e.target.closest('#ai')) return;   // typing to Apex is not a key for the drill
  if (e.key === 'Escape' && L.screen !== 'home') { show('home'); return; }
  if (L.screen !== 'drill') return;
  if (L.picked == null && /^[1-9]$/.test(e.key)) { const id = L.options[+e.key - 1]; if (id) { e.preventDefault(); answer(id); } }
  else if (L.picked != null && (e.key === 'n' || e.key === 'Enter') && e.target.tagName !== 'BUTTON') { e.preventDefault(); nextQuestion(); }
  else if (L.kind === 'sounds' && e.key === 'p') { togglePlay(); }
});
let resizing = 0;
window.addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(() => { if (root) paint(); }, 120); });

/* Systole's side. mount() is called after every draw of the Practice Lab screen, with the element it drew: a first visit
   opens on the Lab's home, a redraw of the same screen (the theme changed, Apex opened) puts back where the Lab was and
   leaves a heart sound playing. unmount() is called when any other screen is drawn, and stops the sound. */
function mount(el) {
  if (!el) return;
  const again = !!root;
  if (root !== el) {
    root = el;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
  }
  show(again ? L.screen : 'home', again, again);
}
function unmount() { if (!root) return; stop(); root = null; }   // the next mount opens on the Lab's home
window.LabUI = { mount, unmount };

/* What a test may read: where the Lab is, and what it is asking. Nothing here changes anything. */
window.__lab = { state: () => ({ screen: L.screen, kind: L.kind, item: L.item && L.item.id, options: L.options.slice(), picked: L.picked, session: Object.assign({}, L.session), saveFailed, mounted: !!root }), progress: () => JSON.parse(JSON.stringify(progress)) };
})();
