/* Systole Lab: the screens. Everything that is not drawing, sound or storage is in src/lab/*.js
   and tested without a browser; this file wires those to a page, and tests/verify-lab.js drives it. */
(function () {
'use strict';

const HS = window.HeartSounds, TR = window.Tracings, ST = window.Strips, HM = window.HeartMap;
const Drill = window.Drill, LP = window.LabProgress, LI = window.LabItems, FSRS = window.FSRS;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el) => (el || document).querySelector(sel);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
const app = $('#app');

/* ── storage: the Lab opens either way ───────────────────────────────── */
let store = null;
try { store = window.localStorage; store.getItem(LP.KEY); } catch (_) { store = null; }
let progress = LP.load(store);
let saveFailed = !store;
const today = () => FSRS.todayISO();
function persist() { saveFailed = !LP.save(store, progress); }

/* ── state ───────────────────────────────────────────────────────────── */
const S = { screen: 'home', kind: null, item: null, options: [], picked: null, stim: null, reason: '', session: { n: 0, c: 0 }, ex: 'snd:as', playing: false };

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
  src = null; S.playing = false; setCursor(null);
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
  src.start(); t0 = c.currentTime; dur = samples.length / rate; S.playing = true;
  const b = $('[data-act="play"]'); if (b) { b.setAttribute('aria-pressed', 'true'); b.textContent = '■ Stop'; }
  (function tick() { if (!S.playing || !ac) return; setCursor(((ac.currentTime - t0) % dur) / dur); requestAnimationFrame(tick); })();
  return true;
}
function setCursor(f) {
  const el = $('.cursor'); if (!el) return;
  if (f == null) { el.classList.remove('on'); return; }
  el.classList.add('on'); el.style.left = (f * 100).toFixed(2) + '%';
}
function say(text) { const l = $('#live'); if (l) l.textContent = text; }

/* ── drawing ─────────────────────────────────────────────────────────── */
function fit(c, h) {
  const w = (c.parentElement && c.parentElement.clientWidth) || 640, d = window.devicePixelRatio || 1;
  c.style.height = h + 'px'; c.width = Math.round(w * d); c.height = Math.round(h * d);
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w, h };
}
const label = (g, text, x, y, color, align) => { g.fillStyle = color; g.textAlign = align || 'center'; g.font = '600 12px ' + cssVar('--font'); g.fillText(text, x, y); };

function drawSound(c, r, reveal) {
  const { g, w, h } = fit(c, 150), mid = h / 2, accent = cssVar('--accent'), ink = cssVar('--trace'), muted = cssVar('--muted');
  const n = r.samples.length, beats = r.beats;
  const ev = id => r.events.find(e => e.id === id).at;
  if (reveal) {
    g.fillStyle = accent; g.globalAlpha = 0.09;
    for (let k = 0; k < beats; k++) g.fillRect((k + ev('mc')) / beats * w, 0, (ev('ac') - ev('mc')) / beats * w, h);
    g.globalAlpha = 1;
  }
  g.strokeStyle = cssVar('--line'); g.lineWidth = 1; g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
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
  const { g, w, h } = fit(c, 220), L = 40, B = 20, T = 8, pw = w - L - 8, ph = h - B - T;
  const y = v => T + (1 - (v - TRACE_RANGE.lo) / (TRACE_RANGE.hi - TRACE_RANGE.lo)) * ph;
  g.font = '11px ' + cssVar('--font');
  for (let v = TRACE_RANGE.lo; v <= TRACE_RANGE.hi; v += 5) {
    g.strokeStyle = v % 10 === 0 ? cssVar('--grid-major') : cssVar('--grid'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, y(v) + 0.5); g.lineTo(w - 8, y(v) + 0.5); g.stroke();
    if (v % 10 === 0) label(g, String(v), L - 6, y(v) + 4, cssVar('--muted'), 'right');
  }
  label(g, 'mmHg', 2, 12, cssVar('--muted'), 'left');
  g.strokeStyle = cssVar('--trace'); g.lineWidth = 2; g.beginPath();
  for (let x = 0; x <= pw; x++) { const px = L + x, v = t.fn((x / pw) * 2); x ? g.lineTo(px, y(v)) : g.moveTo(px, y(v)); }
  g.stroke();
  label(g, 'two beats', w - 10, h - 5, cssVar('--muted'), 'right');
  if (reveal) {
    const f = TR.features(t.fn), accent = cssVar('--accent');
    const mark = (name, at, v) => { const x = L + (at / 2) * pw, yy = y(v); g.fillStyle = accent; g.beginPath(); g.arc(x, yy, 3.5, 0, 6.3); g.fill(); label(g, name, x, yy - 8, accent); };
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
  for (let k = 0; k * 0.04 <= secs + 1e-9; k++) { const x = Math.round(k * 0.04 / secs * w) + 0.5; line(x, 0, x, h, k % 5 === 0 ? cssVar('--grid-major') : cssVar('--grid')); }
  for (let k = Math.ceil(lo / 0.1); k * 0.1 <= hi + 1e-9; k++) { const yy = Math.round(y(k * 0.1)) + 0.5; line(0, yy, w, yy, k % 5 === 0 ? cssVar('--grid-major') : cssVar('--grid')); }
  g.strokeStyle = cssVar('--trace'); g.lineWidth = 1.7; g.lineJoin = 'round'; g.beginPath();
  const n = tr.samples.length;
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * w, yy = y(tr.samples[i]); i ? g.lineTo(x, yy) : g.moveTo(x, yy); }
  g.stroke();
  label(g, '25 mm/s · 10 mm/mV', w - 8, h - 6, cssVar('--muted'), 'right');
}

/* ── the heart, drawn from the map ───────────────────────────────────── */
function polyline(pts) { return 'M' + pts.map(p => p.x.toFixed(0) + ' ' + p.y.toFixed(0)).join(' L'); }
function heartSvg(c) {
  const C = HM.CHAMBERS, ab = { SVC: 'SVC', RA: 'RA', RV: 'RV', PA: 'PA', Ao: 'Ao', PV: 'PV', LA: 'LA', LV: 'LV' };
  let s = '<svg class="heart" viewBox="0 0 400 390" role="img" aria-label="' + esc(c.alt) + '"><defs>' +
    '<marker id="arr-n" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--muted)"/></marker>' +
    '<marker id="arr-a" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--warn)"/></marker></defs>';
  if (c.pericardium) s += '<ellipse cx="200" cy="200" rx="196" ry="188" fill="none" stroke="var(--muted)" stroke-width="3" stroke-dasharray="3 6"/><text class="lbl small" x="200" y="386">pericardium</text>';
  for (const id of Object.keys(C)) {
    const b = C[id], vessel = b.w < 60;
    const cls = ['ch', b.side, c.enlarged.includes(id) ? 'big' : '', c.hypertrophied.includes(id) ? 'thick' : '', c.site === id ? 'site' : ''].filter(Boolean).join(' ');
    s += `<rect class="${cls}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${vessel ? 8 : 22}"><title>${esc(b.name)}</title></rect>`;
    s += `<text class="lbl${vessel ? ' small' : ''}" x="${b.x + b.w / 2}" y="${vessel ? b.y + 14 : b.y + b.h / 2}">${ab[id]}</text>`;
  }
  for (const [a, b] of HM.NORMAL_FLOW) {
    const v = Object.values(HM.VALVES).find(x => x.between[0] === a && x.between[1] === b);
    const pts = [HM.centre(a)]; if (v) pts.push({ x: v.x, y: v.y }); pts.push(HM.centre(b));
    s += `<path class="flow-n" d="${polyline(pts)}"/>`;
  }
  for (const f of c.flows) {
    const v = c.valve && HM.VALVES[c.valve], pts = [HM.centre(f.from)];
    if (f.kind === 'jet' && v) pts.push({ x: v.x, y: v.y });
    pts.push(HM.centre(f.to));
    s += `<path class="flow-a" d="${polyline(pts)}"/>`;
  }
  for (const name of Object.keys(HM.VALVES)) {
    const v = HM.VALVES[name], bad = c.valve === name, gap = bad && c.state === 'stenosis' ? 5 : (bad || c.closed === name) ? 0 : 20;
    const cls = 'valve' + (bad && c.state ? ' ' + c.state : '');
    s += `<g><title>${esc(v.name)}${bad && c.state ? ': ' + esc(c.state) : ''}</title>` +
      `<rect class="${cls}" x="${v.x - 22}" y="${v.y - 4}" width="${22 - gap / 2}" height="8" rx="3"/>` +
      `<rect class="${cls}" x="${v.x + gap / 2}" y="${v.y - 4}" width="${22 - gap / 2}" height="8" rx="3"/></g>`;
    if (bad) s += `<text class="lbl small" x="${v.x}" y="${v.y + (name === 'mitral' || name === 'tricuspid' ? -14 : 18)}">${esc(v.name.replace(' valve', ''))}</text>`;
  }
  return s + '</svg>';
}
function chestSvg(areaId) {
  let s = '<svg class="chest" viewBox="0 0 200 200" role="img" aria-label="Chest, with the place to listen marked"><path class="body" d="M28 200 C28 130 36 70 70 46 L82 28 L118 28 L130 46 C164 70 172 130 172 200"/><path class="body" d="M70 46 L100 54 L130 46"/><path class="body" d="M100 54 L100 156" stroke-dasharray="4 4"/>';
  for (const id of Object.keys(HM.AREAS)) {
    const a = HM.AREAS[id];
    s += `<circle class="area${id === areaId ? ' on' : ''}" cx="${a.x}" cy="${a.y}" r="9"><title>${esc(a.name)}</title></circle>`;
  }
  const a = HM.AREAS[areaId];
  if (a) s += `<text class="lbl small" x="${Math.min(150, Math.max(50, a.x))}" y="${a.y > 120 ? a.y + 22 : a.y - 16}">${esc(a.name)}</text>`;
  return s + '</svg>';
}

/* ── screens ─────────────────────────────────────────────────────────── */
function banner() {
  return saveFailed ? '<div class="banner" role="status">Progress cannot be saved in this window (a private window, or a page opened straight from Files). It will be lost when you close it. Open the hosted copy to keep it.</div>' : '';
}
function topbar(title, right) {
  return `<div class="topbar"><button class="back" data-act="home">‹ Home</button><div class="title">${esc(title)}</div><div class="small muted">${esc(right || '')}</div></div>`;
}

function home() {
  const sum = LP.summary(progress, LI.ALL, today());
  const tiles = LI.KINDS.map(k => {
    const s = LP.summary(progress, LI.ITEMS[k.id], today());
    return `<button class="tile" data-act="open" data-kind="${k.id}"><h2>${esc(k.title)}</h2><span class="muted">${esc(k.blurb)}</span>` +
      `<span class="count">${s.seen} of ${s.total} seen${s.due ? ` · <span class="due">${s.due} due</span>` : ''}</span></button>`;
  }).join('') +
    `<button class="tile" data-act="explore"><h2>Show on the heart</h2><span class="muted">Where the valve is, what it loads, where on the chest to listen, and when in the cycle.</span><span class="count">${Object.keys(HM.CONDITIONS).length + Object.keys(HM.TRACING_MAP).length} conditions</span></button>`;
  app.innerHTML = `<h1>Systole Lab</h1><p class="muted">Practice recognising what you will be shown. It remembers what you get wrong and brings it back.</p>${banner()}` +
    `<div class="card"><div class="stats"><div class="stat"><b>${sum.streak}</b><span>day streak</span></div><div class="stat"><b>${sum.today}</b><span>answered today</span></div>` +
    `<div class="stat"><b>${sum.accuracy == null ? '–' : Math.round(sum.accuracy * 100) + '%'}</b><span>right, all time</span></div><div class="stat"><b>${sum.due}</b><span>due for review</span></div></div></div>` +
    `<div class="tiles">${tiles}</div>` +
    `<footer class="small muted"><p>Heart sounds are low-pitched: headphones make a real difference. Everything stays on this device. The teaching points were written for this app and have not been reviewed by a clinician: check anything you will rely on against your own sources.</p>` +
    `<button class="btn" data-act="reset">Reset my progress</button></footer><div id="live" class="sr" aria-live="polite"></div>`;
}

function stimulusHtml() {
  const k = S.kind;
  const cvs = '<div class="stage"><canvas class="view" role="img" aria-label="' +
    (k === 'sounds' ? 'Waveform of the heart sound you are listening to' : k === 'tracings' ? 'A pressure tracing, two beats' : 'An ECG strip') + '"></canvas><div class="cursor"></div></div>';
  return cvs + (k === 'sounds' ? '<div class="row"><button class="btn primary" data-act="play" aria-pressed="false">▶ Play</button><span class="small muted">Plays on a loop. Use headphones.</span></div>' : '');
}

function drill() {
  const k = LI.KINDS.find(x => x.id === S.kind), item = S.item, done = S.picked != null;
  const opts = S.options.map((id, i) => {
    const it = LI.byId(id);
    const cls = done ? (id === item.id ? ' right' : id === S.picked ? ' wrong' : '') : '';
    return `<button class="option${cls}" data-act="answer" data-id="${esc(id)}" ${done ? 'disabled' : ''}><span class="num">${i + 1}</span><span>${esc(it.name)}</span></button>`;
  }).join('');
  let fb = '';
  if (done) {
    const right = S.picked === item.id, picked = LI.byId(S.picked);
    const like = item.confusableWith.map(id => LI.byId(id)).filter(Boolean);
    let extra = '';
    if (S.kind === 'strips') { const f = ST.features(S.stim.t.samples, S.stim.t.rate); extra = `<p class="small muted">Rate on this strip: about ${Math.round(f.rate)} a minute.</p>`; }
    fb = `<div class="card" id="feedback"><div class="verdict ${right ? 'right' : 'wrong'}">${right ? 'Correct.' : 'Not quite.'} This is ${esc(item.name)}.</div>` +
      (right ? '' : `<p class="small muted">You chose ${esc(picked.name)}: ${esc(picked.blurb)}</p>`) +
      `<p>${esc(item.blurb)}</p><ul class="points">${item.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>${extra}` +
      (like.length ? `<div class="chips"><span class="small muted">Often mistaken for</span>${like.map(l => `<span class="chip">${esc(l.name)}</span>`).join('')}</div>` : '') +
      `<div class="row"><button class="btn primary" data-act="next" id="next">Next</button>${S.kind !== 'strips' ? `<button class="btn" data-act="explore" data-item="${esc(item.id)}">Show on the heart</button>` : ''}</div></div>`;
  }
  app.innerHTML = topbar(k.title, `${S.session.c} of ${S.session.n} right`) + banner() +
    `<div class="card"><h2>${esc(k.verb)}</h2>${stimulusHtml()}<div class="options" role="group" aria-label="Answers">${opts}</div>` +
    (done ? '' : `<p class="small muted">${esc(S.reason)} Press 1 to ${S.options.length}, or tap.</p>`) + `</div>${fb}<div id="live" class="sr" aria-live="polite"></div>`;
}

function explore() {
  const it = LI.byId(S.ex) || LI.byId('snd:as');
  const opt = list => list.map(i => `<option value="${esc(i.id)}" ${i.id === it.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  let c, side = '', stim = '', kv = '';
  if (it.kind === 'sounds') {
    const f = HM.forLesion(it.key), phase = { systolic: 'systole', diastolic: 'diastole', continuous: 'the whole cycle', none: 'no murmur: only the sounds', both: 'systole and diastole' }[f.phase];
    c = Object.assign({}, f, { alt: 'The heart, with ' + it.name + ' marked' });
    side = `<div class="card"><h2>Where to listen</h2>${chestSvg(f.area)}<p class="small muted">${esc(f.listen.name)}: ${esc(f.listen.where)}.</p></div>`;
    stim = '<div class="stage"><canvas class="view" role="img" aria-label="Waveform of this sound, with the first and second heart sounds marked"></canvas><div class="cursor"></div></div><div class="row"><button class="btn primary" data-act="play" aria-pressed="false">▶ Play</button><span class="small muted">Shaded: systole.</span></div>';
    const loaded = (f.enlarged.length ? 'enlarged: ' + f.enlarged.join(', ') : '') + (f.enlarged.length && f.hypertrophied.length ? '; ' : '') + (f.hypertrophied.length ? 'thickened: ' + f.hypertrophied.join(', ') : '');
    kv = `<dl class="kv"><dt>Heard in</dt><dd>${esc(phase)}</dd><dt>Listen at</dt><dd>${esc(f.listen.name)}</dd>${f.radiates ? `<dt>Spreads</dt><dd>${esc(f.radiates)}</dd>` : ''}` +
      `<dt>Valve</dt><dd>${f.valve ? esc(HM.VALVES[f.valve].name + ': ' + f.state) : 'none at fault'}</dd>${loaded ? `<dt>Chambers</dt><dd>${esc(loaded)}</dd>` : ''}</dl><p>${esc(f.note)}</p>`;
  } else {
    const m = HM.TRACING_MAP[it.key], t = TR.byId(it.key);
    const flows = m.valve && m.state === 'stenosis' ? [{ from: HM.VALVES[m.valve].between[0], to: HM.VALVES[m.valve].between[1], kind: 'jet' }] :
      m.valve && m.state === 'regurgitation' ? [{ from: HM.VALVES[m.valve].between[1], to: HM.VALVES[m.valve].between[0], kind: 'jet' }] : [];
    c = { valve: m.valve || null, state: m.state || null, closed: m.valve && !m.state ? m.valve : null, enlarged: [], hypertrophied: m.hypertrophied || [], flows, site: m.site, pericardium: !!m.pericardium, alt: 'The heart, with the place this pressure is measured marked' };
    stim = '<div class="stage"><canvas class="view" role="img" aria-label="' + esc(it.name) + ' pressure tracing, two beats, with its waves marked"></canvas></div>';
    kv = `<dl class="kv"><dt>Measured in</dt><dd>${m.site === 'LA' ? 'the wedge position, which reads the left atrium' : 'the right atrium (the jugular pulse shows the same waves)'}</dd>` +
      (m.valve ? `<dt>Valve</dt><dd>${esc(HM.VALVES[m.valve].name + (m.state ? ': ' + m.state : ': shut while the atrium fires'))}</dd>` : '') + (m.pericardium ? '<dt>Pericardium</dt><dd>involved</dd>' : '') + `</dl><p>${esc(it.blurb)}</p>`;
  }
  app.innerHTML = topbar('Show on the heart') + banner() +
    `<div class="row"><label for="ex-pick" class="muted">Condition</label><select id="ex-pick"><optgroup label="Heart sounds">${opt(LI.ITEMS.sounds)}</optgroup><optgroup label="Pressure tracings">${opt(LI.ITEMS.tracings)}</optgroup></select></div>` +
    `<div class="explore"><div><div class="card"><h2 id="ex-title">${esc(it.name)}</h2>${heartSvg(c)}<div class="legend"><span>Dashed thick outline: enlarged</span><span>Heavy wall: thickened</span><span>Orange arrows: abnormal flow</span><span>Blue outline: where it is measured</span></div></div>${side}</div>` +
    `<div><div class="card">${stim}${kv}</div></div></div><div id="live" class="sr" aria-live="polite"></div>`;
}

/* ── paint what needs layout, after the DOM is there ─────────────────── */
function paint() {
  const c = $('canvas.view'); if (!c) return;
  if (S.screen === 'drill' && S.stim) {
    const done = S.picked != null;
    if (S.kind === 'sounds') drawSound(c, S.stim.r, done);
    else if (S.kind === 'tracings') drawTracing(c, S.stim.t, done);
    else drawStrip(c, S.stim.t);
  } else if (S.screen === 'explore') {
    const it = LI.byId(S.ex);
    if (it.kind === 'sounds') { S.stim = { r: HS.render(it.key, { beats: 3, bpm: 72, seed: 7, rate: 8000 }) }; drawSound(c, S.stim.r, true); }
    else drawTracing(c, TR.byId(it.key), true);
  }
}
/* Moving to another screen stops the sound; redrawing the same question to show the answer does not. */
function show(screen, keepSound) {
  if (!keepSound) stop();
  S.screen = screen; ({ home, drill, explore })[screen](); paint();
  const b = $('[data-act="play"]'); if (b && S.playing) { b.setAttribute('aria-pressed', 'true'); b.textContent = '■ Stop'; }
  const h = $('h1, h2'); if (h) h.setAttribute('tabindex', '-1');
  window.scrollTo(0, 0);
}

/* ── the drill ───────────────────────────────────────────────────────── */
function nextQuestion() {
  stop();
  const items = LI.ITEMS[S.kind], seed = (Math.random() * 1e9) | 0;
  const pick = Drill.next({ items, cards: progress.cards, today: today(), seed, recent: progress.recent });
  S.item = pick.item;
  S.reason = pick.reason === 'due' ? 'Due for review.' : pick.reason === 'new' ? 'New to you.' : 'Nothing due: reviewing what you are closest to forgetting.';
  S.options = Drill.options({ item: S.item, items, n: 4, seed: seed + 1 });
  S.picked = null;
  if (S.kind === 'sounds') S.stim = { r: HS.render(S.item.key, { beats: 4, bpm: [64, 72, 80][seed % 3], seed, rate: 8000 }) };
  else if (S.kind === 'tracings') S.stim = { t: TR.byId(S.item.key) };
  else S.stim = { t: ST.trace(S.item.key, 6) };
  show('drill');
  const first = $('.option'); if (first) first.focus({ preventScroll: true });
}
function answer(id) {
  if (S.picked != null || !S.options.includes(id)) return;
  S.picked = id;
  const right = id === S.item.id;
  S.session.n++; if (right) S.session.c++;
  progress = LP.record(progress, { id: S.item.id, correct: right, today: today() });
  persist();
  show('drill', true);
  say((right ? 'Correct. ' : 'Not quite. ') + 'This is ' + S.item.name + '.');
  const n = $('#next'); if (n) n.focus({ preventScroll: false });
}
function togglePlay() {
  if (S.playing) { stop(); return; }
  const r = S.stim && S.stim.r; if (r) play(r.samples, r.rate, true);
}

/* ── events ──────────────────────────────────────────────────────────── */
app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === 'home') show('home');
  else if (act === 'open') { S.kind = b.dataset.kind; S.session = { n: 0, c: 0 }; nextQuestion(); }
  else if (act === 'answer') answer(b.dataset.id);
  else if (act === 'next') nextQuestion();
  else if (act === 'play') togglePlay();
  else if (act === 'explore') { if (b.dataset.item) S.ex = b.dataset.item; show('explore'); }
  else if (act === 'reset') { if (window.confirm('Forget everything the Lab has recorded about you?')) { progress = LP.empty(); persist(); show('home'); } }
});
app.addEventListener('change', e => { if (e.target.id === 'ex-pick') { S.ex = e.target.value; show('explore'); const s = $('#ex-pick'); if (s) s.focus(); } });
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape' && S.screen !== 'home') { show('home'); return; }
  if (S.screen !== 'drill' || /^(SELECT|TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
  if (S.picked == null && /^[1-9]$/.test(e.key)) { const id = S.options[+e.key - 1]; if (id) { e.preventDefault(); answer(id); } }
  else if (S.picked != null && (e.key === 'n' || e.key === 'Enter') && e.target.tagName !== 'BUTTON') { e.preventDefault(); nextQuestion(); }
  else if (S.kind === 'sounds' && e.key === 'p') { togglePlay(); }
});
let resizing = 0;
window.addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(paint, 120); });
window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener && window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => paint());

/* What a test may read: where the page is, and what it is asking. Nothing here changes anything. */
window.__lab = { state: () => ({ screen: S.screen, kind: S.kind, item: S.item && S.item.id, options: S.options.slice(), picked: S.picked, session: Object.assign({}, S.session), saveFailed }), progress: () => JSON.parse(JSON.stringify(progress)) };

home();
})();
