// Canvas visualisations, in the spirit of Open Cubic Player's text-mode screens.
const NOTE = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
export function noteName(f) {
  if (!f) return '···';
  const n = Math.round(12 * Math.log2(f / 440) + 57);
  if (n < 0 || n > 131) return '···';
  return NOTE[n % 12] + Math.floor(n / 12);
}

export class Views {
  constructor(canvas, audio, theme) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.audio = audio; this.theme = theme;
    this.view = 'channels';
    this.cells = new Map(); this.cellsReq = -1; this.cellsKey = null;
    this.chanOffset = 0; this.chanScroll = 0;
    this.peaks = new Float32Array(256); this.peakT = new Float32Array(256);
    this.fft = null; this.td = null; this.tdR = null;
    this.water = document.createElement('canvas');
    this.noteTrail = [];
    this.angle = { x: 0.5, y: 0.3, z: 0 }; this.stars = Array.from({ length: 140 }, () => [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()]);
    this.hits = [];
    this.anMode = 'bars'; this.bandPeaks = new Float32Array(16); this.bandSmooth = new Float32Array(256);
    this.t0 = performance.now();
    audio.on('cells', (m) => { this.cells.set(m.pat, m.rows); });
  }
  resetSong() { this.cells.clear(); this.cellsReq = -1; this.chanOffset = 0; this.chanScroll = 0; this.noteTrail = []; this.peaks.fill(0); const w = this.water.getContext('2d'); w.clearRect(0, 0, this.water.width, this.water.height); }

  col(i) { const c = this.theme.chan; return c[i % c.length]; }

  resize() {
    const r = this.cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.dpr = d; this.W = r.width; this.H = r.height;
  }

  font(px, big) { this.g.font = `${big ? '' : '500 '}${px}px ${big ? '"VT323", monospace' : '"JetBrains Mono", ui-monospace, monospace'}`; }

  draw() {
    this.resize();
    const g = this.g, T = this.theme;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.hits = [];
    const a = this.audio, cur = a.cur;
    if (a.anF) {
      if (!this.fft) { this.fft = new Uint8Array(a.anF.frequencyBinCount); this.td = new Float32Array(a.anL.fftSize); this.tdR = new Float32Array(a.anR.fftSize); }
      a.anL.getFloatTimeDomainData(this.td); a.anR.getFloatTimeDomainData(this.tdR);
      a.anF.getByteFrequencyData(this.fft);
    }
    const fade = this.view === 'phase' || this.view === 'scopes';
    if (!fade) { g.fillStyle = T.bg; g.fillRect(0, 0, this.W, this.H); }
    switch (this.view) {
      case 'channels': this.drawChannels(cur); break;
      case 'tracks': this.drawTracks(cur); break;
      case 'analyzer': this.drawAnalyzer(); break;
      case 'eq': this.drawEq(); break;
      case 'scopes': this.drawScopes(cur); break;
      case 'phase': this.drawPhase(); break;
      case 'notes': this.drawNotes(cur); break;
      case 'wuerfel': this.drawWuerfel(cur); break;
    }
  }

  empty(msg, sub) {
    const g = this.g, T = this.theme;
    this.font(28, true); g.fillStyle = T.dim; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(msg, this.W / 2, this.H / 2 - 10);
    if (sub) { this.font(12); g.fillText(sub, this.W / 2, this.H / 2 + 18); }
    g.textAlign = 'left';
  }

  // segmented LED bar
  bar(x, y, w, h, v, flip) {
    const g = this.g, T = this.theme, seg = Math.max(3, Math.floor(h * 0.55)), n = Math.max(1, Math.floor(w / seg)), lit = Math.round(v * n);
    for (let i = 0; i < n; i++) {
      const k = flip ? n - 1 - i : i, f = i / n;
      g.fillStyle = i < lit ? (f > 0.85 ? T.red : f > 0.6 ? T.yellow : T.green) : T.off;
      g.fillRect(x + k * seg, y, seg - 1, h);
    }
  }

  drawChannels(cur) {
    const g = this.g, T = this.theme;
    if (!cur) return this.empty('NO SONG LOADED', 'Open files, a folder or an archive to start');
    const n = cur.info.channels || (cur.l ? cur.l.length : 0);
    if (!n) return this.empty('NO CHANNEL DATA', cur.info.type || '');
    if (this.audio.cur.kind === 'pcm') this.audio.pcmLevels();
    const names = cur.info.voices || cur.voiceNames || cur.info.channelNames || [];
    const st = cur.st || {};
    const cells = cur.info.hasCells && st.pattern != null ? this.cells.get(cur.kind === 'mpt' ? st.pattern : st.order) : null;
    if (cur.info.hasCells) this.wantCells(cur);
    const pad = 10, avail = this.H - pad * 2;
    let cols = this.W > 1100 && n > 16 ? 2 : 1;
    let rh = Math.floor(avail / Math.ceil(n / cols));
    rh = Math.max(14, Math.min(30, rh));
    const perCol = Math.max(1, Math.floor(avail / rh));
    if (perCol * cols < n && this.W > 760 && cols === 1) cols = 2;
    const visible = perCol * cols;
    this.chanScroll = Math.max(0, Math.min(this.chanScroll, n - visible));
    const colW = (this.W - pad * 2) / cols;
    const fs = Math.max(10, Math.min(13, rh - 6));
    this.font(fs); g.textBaseline = 'middle';
    const cw = g.measureText('0').width;
    for (let k = 0; k < Math.min(visible, n - this.chanScroll); k++) {
      const i = k + this.chanScroll;
      const cx = pad + Math.floor(k / perCol) * colW, cy = pad + (k % perCol) * rh, mid = cy + rh / 2;
      const muted = cur.muted && cur.muted.has(i);
      const c = this.col(i);
      if (k % 2 === 0) { g.fillStyle = T.stripe; g.fillRect(cx, cy, colW - 8, rh); }
      this.hits.push({ x: cx, y: cy, w: colW - 8, h: rh, ch: i });
      let x = cx + 6;
      g.fillStyle = muted ? T.dim : c; g.fillText(String(i + 1).padStart(2, '0'), x, mid); x += cw * 3;
      g.fillStyle = muted ? T.red : T.dim; g.fillText(muted ? 'M' : '·', x, mid); x += cw * 2;
      const lv = (cur.l && cur.l[i] || 0) / 255, rv = (cur.r && cur.r[i] || 0) / 255;
      const nameW = colW > 640 ? 16 : colW > 420 ? 10 : 0;
      if (nameW) { g.fillStyle = muted ? T.dim : T.fg; const nm = (names[i] || '').slice(0, nameW); g.fillText(nm, x, mid); x += cw * (nameW + 1); }
      const barH = Math.max(4, rh - 10), rest = cx + colW - 8 - x;
      const showCell = cells && rest > cw * 50;
      const showNote = rest > cw * 22;
      const showHz = rest > cw * 34;
      const bw = Math.max(40, (rest - (showNote ? cw * (showHz ? 12 : 5) : 0) - (showCell ? cw * 18 : 0)) / 2 - 6);
      if (muted) { g.globalAlpha = 0.25; }
      this.bar(x, mid - barH / 2, bw, barH, lv, true); x += bw + 4;
      this.bar(x, mid - barH / 2, bw, barH, cur.l === cur.r ? lv : rv, false); x += bw + 8;
      g.globalAlpha = 1;
      if (showNote) {
        const f = cur.fr && cur.fr[i] || 0;
        g.fillStyle = f ? c : T.dim; g.fillText(noteName(f), x, mid);
        if (showHz) { g.fillStyle = T.dim; g.fillText(f ? String(f).padStart(5) + 'Hz' : '', x + cw * 4, mid); } x += cw * (showHz ? 12 : 5);
      }
      if (showCell) { const row = cells[st.row]; if (row) { g.fillStyle = muted ? T.dim : T.fg; g.fillText((row[i] || '').slice(0, 17), x, mid); } }
    }
    if (n > visible) { this.font(11); g.fillStyle = T.dim; g.textAlign = 'right'; g.fillText(`${this.chanScroll + 1}-${Math.min(n, this.chanScroll + visible)} of ${n} · scroll`, this.W - 10, this.H - 8); g.textAlign = 'left'; }
  }

  wantCells(cur) {
    const st = cur.st || {}; const pat = cur.kind === 'mpt' ? st.pattern : st.order;
    if (pat == null || pat < 0) return;
    if (!this.cells.has(pat) && this.cellsReq !== pat) { this.cellsReq = pat; this.audio.requestCells(pat); }
    // prefetch next pattern for modules
  }

  drawTracks(cur) {
    const g = this.g, T = this.theme;
    if (!cur) return this.empty('NO SONG LOADED');
    if (!cur.info.hasCells) {
      const list = (cur.info.instruments || []).concat(cur.info.samples || []).filter(Boolean);
      if (!list.length) return this.empty('NO PATTERN DATA', `${cur.info.type || 'This format'} has no track view`);
      this.font(13); g.fillStyle = T.dim; g.fillText('No pattern data for this format. Instruments:', 14, 20);
      this.font(12); const lh = 17, per = Math.max(1, Math.floor((this.H - 40) / lh)), cols = Math.ceil(list.length / per), cwid = (this.W - 20) / Math.max(1, cols);
      list.forEach((s, i) => { g.fillStyle = this.col(i); g.fillText(String(i + 1).padStart(2, '0'), 14 + Math.floor(i / per) * cwid, 44 + (i % per) * lh); g.fillStyle = T.fg; g.fillText(s.slice(0, Math.floor(cwid / 8) - 4), 40 + Math.floor(i / per) * cwid, 44 + (i % per) * lh); });
      return;
    }
    this.wantCells(cur);
    const st = cur.st || {}; const pat = cur.kind === 'mpt' ? st.pattern : st.order;
    const rows = this.cells.get(pat);
    if (!rows) return this.empty('LOADING PATTERN…');
    const fs = this.W < 500 ? 11 : 13; this.font(fs); g.textBaseline = 'middle';
    const cw = g.measureText('0').width, lh = fs + 5;
    const n = rows[0] ? rows[0].length : 0;
    const cellChars = Math.max(...rows.slice(0, 8).flatMap(r => r.map(s => s.length)), 3);
    const colW = (cellChars + 1) * cw + 6, left = cw * 4 + 14;
    const fit = Math.max(1, Math.floor((this.W - left - 6) / colW));
    this.chanOffset = Math.max(0, Math.min(this.chanOffset, Math.max(0, n - fit)));
    const vis = Math.min(fit, n - this.chanOffset);
    const center = Math.floor(this.H / 2 / lh), rowsOn = Math.ceil(this.H / lh);
    // header
    g.fillStyle = T.panel; g.fillRect(0, 0, this.W, lh + 4);
    for (let c = 0; c < vis; c++) {
      const ch = c + this.chanOffset, x = left + c * colW, muted = cur.muted && cur.muted.has(ch);
      g.fillStyle = muted ? T.dim : this.col(ch); g.fillText(`${muted ? 'M' : 'CH'}${String(ch + 1).padStart(2, '0')}`, x, lh / 2 + 2);
      const lv = (cur.l && cur.l[ch] || 0) / 255; g.fillStyle = this.col(ch); g.globalAlpha = 0.6; g.fillRect(x + cw * 5.5, lh / 2 - 2, (colW - cw * 6.5) * lv, 5); g.globalAlpha = 1;
      this.hits.push({ x, y: 0, w: colW, h: lh + 4, ch });
    }
    const y0 = lh + 6;
    // current row bar
    const cy = y0 + center * lh;
    g.fillStyle = T.hilite; g.fillRect(0, cy - lh / 2, this.W, lh);
    for (let k = -center; k < rowsOn - center; k++) {
      const r = st.row + k, y = cy + k * lh;
      if (y < y0 - lh / 2 || y > this.H) continue;
      if (r < 0 || r >= rows.length) continue;
      const isCur = k === 0;
      g.fillStyle = isCur ? T.hi : (r % 4 === 0 ? T.yellow : T.dim);
      g.fillText(String(r).padStart(3, '0'), 8, y);
      for (let c = 0; c < vis; c++) {
        const ch = c + this.chanOffset, s = rows[r][ch] || '', x = left + c * colW;
        const muted = cur.muted && cur.muted.has(ch);
        this.cellText(s, x, y, isCur, muted, cw, ch);
      }
    }
    if (n > vis) { this.font(11); g.fillStyle = T.dim; g.textAlign = 'right'; g.fillText(`channels ${this.chanOffset + 1}-${this.chanOffset + vis} of ${n} · drag ⇆`, this.W - 8, this.H - 8); g.textAlign = 'left'; }
  }
  cellText(s, x, y, isCur, muted, cw, ch) {
    const g = this.g, T = this.theme;
    if (muted) { g.fillStyle = T.dim; g.fillText(s, x, y); return; }
    // colour the parts: note, instrument, volume, effects
    const parts = s.split(' ');
    let xx = x;
    parts.forEach((p, i) => {
      const empty = /^[.\-·^=~ ]*$/.test(p) && !/[0-9A-G]/i.test(p.replace(/\./g, ''));
      g.fillStyle = empty ? T.faint : i === 0 ? (isCur ? T.hi : T.fg) : i === 1 ? T.cyan : i === 2 ? T.green : T.magenta;
      if (i === 0 && /^(==|\^\^|~~|OFF)/.test(p)) g.fillStyle = T.red;
      g.fillText(p, xx, y); xx += (p.length + 1) * cw;
    });
  }

  // spectrum as `n` log-spaced bands (0..1), from the 8192-point FFT
  bands(n, fmin = 30, fmax = 18000) {
    const a = this.audio, bins = this.fft, out = new Float32Array(n);
    if (!bins || !a.ctx) return out;
    const rate = a.ctx.sampleRate, nb = bins.length; fmax = Math.min(fmax, rate / 2);
    for (let i = 0; i < n; i++) {
      const f0 = fmin * Math.pow(fmax / fmin, i / n), f1 = fmin * Math.pow(fmax / fmin, (i + 1) / n);
      const b0 = Math.floor(f0 / rate * 2 * nb), b1 = Math.max(b0 + 1, Math.ceil(f1 / rate * 2 * nb));
      let m = 0, s = 0, c = 0;
      for (let b = b0; b < b1 && b < nb; b++) { m = Math.max(m, bins[b]); s += bins[b]; c++; }
      out[i] = (c ? (m * 0.7 + s / c * 0.3) : 0) / 255;
    }
    return out;
  }
  // colour along the spectrum: cyan (bass) -> green -> yellow -> magenta (treble)
  specColor(f, alpha = 1) {
    const T = this.theme, stops = [T.cyan, T.green, T.yellow, T.magenta];
    const x = Math.max(0, Math.min(0.999, f)) * (stops.length - 1), i = Math.floor(x), t = x - i;
    const A = rgbOf(stops[i]), B = rgbOf(stops[i + 1]);
    return `rgba(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)},${alpha})`;
  }
  peakHold(vals) {
    const now = performance.now();
    if (this.peaks.length < vals.length) { this.peaks = new Float32Array(vals.length); this.peakT = new Float32Array(vals.length); }
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] >= this.peaks[i]) { this.peaks[i] = vals[i]; this.peakT[i] = now; }
      else if (now - this.peakT[i] > 450) this.peaks[i] = Math.max(0, this.peaks[i] - 0.011);
    }
  }
  smooth(vals) { // fast attack, slow release, for fluid motion
    const s = this.bandSmooth.length >= vals.length ? this.bandSmooth : (this.bandSmooth = new Float32Array(vals.length));
    for (let i = 0; i < vals.length; i++) s[i] = vals[i] > s[i] ? vals[i] : s[i] * 0.86 + vals[i] * 0.14;
    return s.subarray(0, vals.length);
  }

  drawAnalyzer() {
    const g = this.g, T = this.theme, a = this.audio;
    if (!a.anF) return this.empty('ANALYZER', 'starts with the first song');
    const W = this.W, H = this.H, mode = this.anMode;
    const fmin = 30, fmax = Math.min(18000, a.ctx.sampleRate / 2);
    const withWater = mode !== 'radial' && H > 260;
    const specH = withWater ? Math.floor(H * 0.62) : H - 18;
    if (mode === 'radial') this.anRadial(W, H);
    else if (mode === 'mirror') this.anMirror(W, specH);
    else if (mode === 'line') this.anLine(W, specH, fmin, fmax);
    else this.anBars(W, specH);
    if (mode !== 'radial' && mode !== 'mirror') {
      this.font(10); g.fillStyle = T.dim; g.textBaseline = 'top';
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { if (f > fmax) continue; const x = 10 + Math.log(f / fmin) / Math.log(fmax / fmin) * (W - 20); g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x, specH - 2); }
    }
    if (withWater) this.waterfall(W, specH + 16, H - specH - 16, fmin, fmax);
    // mode label
    this.font(10); g.textBaseline = 'top'; g.textAlign = 'right'; g.fillStyle = T.dim;
    g.fillText({ bars: 'LED BARS', mirror: 'MIRROR', line: 'CURVE', radial: 'RADIAL' }[mode] + '  ·  tap to change', W - 10, 8);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }
  anBars(W, specH) {
    const g = this.g, T = this.theme;
    const bars = Math.max(20, Math.min(96, Math.floor(W / 11)));
    const vals = this.bands(bars); this.peakHold(vals);
    const bw = (W - 20) / bars, top = 26, h0 = specH - 6 - top, seg = Math.max(3, Math.round(h0 / 40)), nseg = Math.floor(h0 / seg);
    for (let i = 0; i < bars; i++) {
      const x = 10 + i * bw, lit = Math.round(vals[i] * nseg), w = Math.max(1, bw - 2);
      for (let s = 0; s < nseg; s++) {
        const f = s / nseg, y = specH - 6 - (s + 1) * seg;
        if (s < lit) { g.fillStyle = f > 0.85 ? T.red : f > 0.62 ? T.yellow : f > 0.32 ? T.green : T.cyan; g.fillRect(x, y, w, seg - 1); }
        else { g.fillStyle = T.off; g.globalAlpha = 0.35; g.fillRect(x, y, w, seg - 1); g.globalAlpha = 1; }
      }
      const pk = Math.round(this.peaks[i] * nseg);
      if (pk > 0) { g.fillStyle = T.hi; g.fillRect(x, specH - 6 - pk * seg, w, Math.max(2, seg - 1)); }
    }
  }
  anMirror(W, specH) {
    const g = this.g, T = this.theme;
    const bars = Math.max(24, Math.min(128, Math.floor(W / 8)));
    const vals = this.smooth(this.bands(bars)); this.peakHold(vals);
    const mid = specH / 2 + 8, half = specH / 2 - 22, bw = (W - 20) / bars;
    g.shadowBlur = T.glow ? 14 : 0;
    for (let i = 0; i < bars; i++) {
      const v = vals[i], x = 10 + i * bw, h = Math.max(1, v * half), col = this.specColor(i / bars);
      g.fillStyle = col; g.shadowColor = col;
      g.fillRect(x, mid - h, Math.max(1, bw - 2), h);
      g.globalAlpha = 0.45; g.fillRect(x, mid + 2, Math.max(1, bw - 2), h * 0.8); g.globalAlpha = 1;
      g.fillStyle = T.hi; g.fillRect(x, mid - this.peaks[i] * half - 3, Math.max(1, bw - 2), 2);
    }
    g.shadowBlur = 0;
    g.fillStyle = T.line; g.fillRect(10, mid, W - 20, 1);
  }
  anLine(W, specH, fmin, fmax) {
    const g = this.g, T = this.theme;
    const n = Math.max(48, Math.min(240, Math.floor(W / 4)));
    const vals = this.smooth(this.bands(n, fmin, fmax)); this.peakHold(vals);
    const top = 26, h0 = specH - 8 - top, base = specH - 8;
    const pts = Array.from(vals, (v, i) => [10 + i / (n - 1) * (W - 20), base - v * h0]);
    const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < n - 1; i++) { const xc = (pts[i][0] + pts[i + 1][0]) / 2, yc = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc); } g.lineTo(pts[n - 1][0], pts[n - 1][1]); };
    // grid
    g.strokeStyle = T.line; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const y = base - h0 * k / 4; g.beginPath(); g.moveTo(10, y); g.lineTo(W - 10, y); g.stroke(); }
    const grad = g.createLinearGradient(10, 0, W - 10, 0);
    grad.addColorStop(0, this.specColor(0, 0.55)); grad.addColorStop(0.33, this.specColor(0.33, 0.55)); grad.addColorStop(0.66, this.specColor(0.66, 0.55)); grad.addColorStop(1, this.specColor(1, 0.55));
    path(); g.lineTo(W - 10, base); g.lineTo(10, base); g.closePath();
    const fade = g.createLinearGradient(0, top, 0, base); fade.addColorStop(0, 'rgba(255,255,255,0.0)'); fade.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grad; g.fill(); g.fillStyle = fade; g.fill();
    const line = g.createLinearGradient(10, 0, W - 10, 0);
    line.addColorStop(0, this.specColor(0)); line.addColorStop(0.33, this.specColor(0.33)); line.addColorStop(0.66, this.specColor(0.66)); line.addColorStop(1, this.specColor(1));
    g.strokeStyle = line; g.lineWidth = 2.2; g.shadowColor = T.cyan; g.shadowBlur = T.glow ? 10 : 0; path(); g.stroke(); g.shadowBlur = 0;
    // peak trace
    g.strokeStyle = T.hi; g.globalAlpha = 0.5; g.lineWidth = 1; g.beginPath();
    for (let i = 0; i < n; i++) { const x = pts[i][0], y = base - this.peaks[i] * h0; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.globalAlpha = 1;
  }
  anRadial(W, H) {
    const g = this.g, T = this.theme, now = performance.now();
    const n = 96, vals = this.smooth(this.bands(n));
    const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) * 0.17, R1 = Math.min(W, H) * 0.31;
    let bass = 0; for (let i = 0; i < 10; i++) bass += vals[i]; bass /= 10;
    const rot = now / 9000;
    g.lineCap = 'round';
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < n; i++) {
        const ang = rot + (side ? -1 : 1) * (i / n) * Math.PI - Math.PI / 2, v = vals[i];
        const r0 = R0 * (1 + bass * 0.25), r1 = r0 + 4 + v * R1;
        const col = this.specColor(i / n);
        g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = T.glow ? 8 : 0; g.lineWidth = Math.max(2, (2 * Math.PI * r0) / (n * 2) - 1.5);
        g.beginPath(); g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); g.stroke();
      }
    }
    g.shadowBlur = 0; g.lineCap = 'butt';
    // inner disc pulses with the bass
    const rr = R0 * (0.82 + bass * 0.3);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rr); grad.addColorStop(0, this.specColor(0.85, 0.5)); grad.addColorStop(1, this.specColor(0.1, 0.05));
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R0 * 0.8, 0, Math.PI * 2); g.stroke();
  }
  waterfall(W, wy, wfH, fmin, fmax) {
    const g = this.g, T = this.theme, a = this.audio, bins = this.fft, rate = a.ctx.sampleRate, nb = bins.length;
    const wf = this.water;
    if (wf.width !== Math.round(W) || wf.height !== Math.max(1, Math.round(wfH))) { wf.width = Math.round(W); wf.height = Math.max(1, Math.round(wfH)); }
    const wg = wf.getContext('2d');
    wg.drawImage(wf, 0, 1);
    const line = wg.createImageData(wf.width, 1);
    for (let x = 0; x < wf.width; x++) {
      const f = fmin * Math.pow(fmax / fmin, x / wf.width), b = Math.min(nb - 1, Math.floor(f / rate * 2 * nb));
      const v = bins[b] / 255, [r, gg, bb] = heat(v, T.heat);
      line.data[x * 4] = r; line.data[x * 4 + 1] = gg; line.data[x * 4 + 2] = bb; line.data[x * 4 + 3] = 255;
    }
    wg.putImageData(line, 0, 0);
    g.drawImage(wf, 0, wy, W, wfH);
  }

  // ---- graphic equalizer ----
  drawEq() {
    const g = this.g, T = this.theme, a = this.audio, W = this.W, H = this.H;
    const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const top = 50, specH = Math.max(80, Math.floor((H - top) * 0.42)), fmin = 20, fmax = 20000;
    const xOf = (f) => 16 + Math.log(f / fmin) / Math.log(fmax / fmin) * (W - 32);
    // live spectrum behind the response curve
    if (a.anF) {
      const n = Math.max(48, Math.min(200, Math.floor(W / 5)));
      const vals = this.smooth(this.bands(n, fmin, Math.min(fmax, a.ctx.sampleRate / 2)));
      const bw = (W - 32) / n;
      for (let i = 0; i < n; i++) { const h = vals[i] * (specH - 10); g.fillStyle = this.specColor(i / n, 0.55); g.fillRect(16 + i * bw, top + specH - h, Math.max(1, bw - 1), h); }
    }
    // 0 dB line and ±12 dB grid
    const dbY = (db) => top + specH / 2 - db / 15 * (specH / 2);
    g.strokeStyle = T.line; g.lineWidth = 1;
    for (const db of [-12, -6, 0, 6, 12]) { g.globalAlpha = db ? 0.6 : 1; g.beginPath(); g.moveTo(16, dbY(db)); g.lineTo(W - 16, dbY(db)); g.stroke(); }
    g.globalAlpha = 1;
    this.font(10); g.fillStyle = T.dim; g.textBaseline = 'middle';
    for (const db of [12, 0, -12]) g.fillText((db > 0 ? '+' : '') + db, W - 34, dbY(db) - 7);
    // EQ response curve
    const N = 160, fs = new Float32Array(N); for (let i = 0; i < N; i++) fs[i] = fmin * Math.pow(fmax / fmin, i / (N - 1));
    const resp = a.eqResponse(fs);
    g.strokeStyle = a.eqOn ? T.yellow : T.dim; g.lineWidth = 2.4; g.shadowColor = T.yellow; g.shadowBlur = T.glow && a.eqOn ? 10 : 0;
    g.beginPath(); for (let i = 0; i < N; i++) { const x = xOf(fs[i]), y = dbY(Math.max(-15, Math.min(15, resp[i]))); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.shadowBlur = 0;
    // sliders
    const sTop = top + specH + 22, sBot = H - 34, sH = sBot - sTop;
    const colW = (W - 32) / freqs.length;
    const lv = this.bands(10, 22, 20000);
    this.eqLevels = this.eqLevels || new Float32Array(10);
    for (let i = 0; i < freqs.length; i++) {
      const cx = 16 + colW * (i + 0.5), db = a.eq[i], col = this.specColor(i / 9);
      this.eqLevels[i] = Math.max(lv[i], this.eqLevels[i] * 0.9);
      // live band level (left of the track)
      const lh = this.eqLevels[i] * sH, seg = 4;
      for (let y = 0; y < lh - 1; y += seg) { g.fillStyle = col; g.globalAlpha = 0.35 + 0.65 * (y / sH); g.fillRect(cx - 14, sBot - y - seg + 1, 5, seg - 1); }
      g.globalAlpha = 1;
      // track
      g.fillStyle = T.off; g.fillRect(cx - 2, sTop, 4, sH);
      const yOf = (d) => sTop + sH / 2 - d / 12 * (sH / 2);
      const y0 = yOf(0), y1 = yOf(db);
      // LED fill from 0 dB towards the knob
      const step = 5;
      if (Math.abs(y1 - y0) > 1) for (let y = Math.min(y0, y1); y < Math.max(y0, y1); y += step) { g.fillStyle = a.eqOn ? col : T.dim; g.fillRect(cx - 6, y, 12, step - 1.5); }
      g.fillStyle = T.line; g.fillRect(cx - 10, y0, 20, 1);
      // knob
      g.fillStyle = T.hi; g.shadowColor = col; g.shadowBlur = T.glow ? 12 : 0;
      g.fillRect(cx - 13, y1 - 5, 26, 10); g.shadowBlur = 0;
      g.fillStyle = a.eqOn ? col : T.dim; g.fillRect(cx - 13, y1 - 1, 26, 2);
      // labels
      this.font(11); g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillStyle = T.fg; g.fillText(freqs[i] >= 1000 ? freqs[i] / 1000 + 'k' : String(freqs[i]), cx, sBot + 8);
      g.textBaseline = 'bottom'; g.fillStyle = db ? T.yellow : T.dim; g.fillText((db > 0 ? '+' : '') + db.toFixed(db % 1 ? 1 : 0), cx, sTop - 4);
      g.textAlign = 'left';
      this.hits.push({ x: cx - colW / 2, y: sTop - 18, w: colW, h: sH + 36, eq: i, sTop, sH });
    }
    g.textBaseline = 'alphabetic';
  }

  // small always-visible spectrum for the now-playing panel
  drawMini(cv) {
    const d = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    const g = cv.getContext('2d'), T = this.theme; g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    const n = Math.max(16, Math.min(72, Math.floor(w / 9))), vals = this.bands(n);
    this.miniPk = this.miniPk && this.miniPk.length === n ? this.miniPk : new Float32Array(n);
    const bw = w / n, seg = 3, rows = Math.floor(h / seg);
    for (let i = 0; i < n; i++) {
      const v = Math.min(1, Math.pow(vals[i], 0.8) * 1.15), lit = Math.round(v * rows), x = i * bw;
      this.miniPk[i] = Math.max(v, this.miniPk[i] - 0.015);
      for (let r = 0; r < rows; r++) {
        g.fillStyle = r < lit ? this.specColor(i / n, 0.35 + 0.65 * r / rows) : T.off;
        if (r >= lit) g.globalAlpha = 0.25;
        g.fillRect(x, h - (r + 1) * seg, Math.max(1, bw - 2), seg - 1);
        g.globalAlpha = 1;
      }
      const pr = Math.round(this.miniPk[i] * rows);
      if (pr > 0) { g.fillStyle = T.hi; g.fillRect(x, h - pr * seg, Math.max(1, bw - 2), seg - 1); }
    }
  }

  trigger(buf) { // rising zero crossing for a steady trace
    for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) return i;
    return 0;
  }
  drawScopes(cur) {
    const g = this.g, T = this.theme, W = this.W, H = this.H;
    g.fillStyle = T.fadeBg; g.fillRect(0, 0, W, H);
    if (!this.td) return;
    const voices = cur && cur.kind === 'caw' && cur.voiceBuf ? cur.voiceN : 0;
    const mainH = voices ? H * 0.45 : H;
    const half = mainH / 2;
    const span = Math.floor(this.td.length * 0.6);
    [[this.td, T.cyan, 0], [this.tdR, T.magenta, 1]].forEach(([buf, color, k]) => {
      const y0 = half * k + half / 2, t = this.trigger(buf);
      g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y0); g.lineTo(W, y0); g.stroke();
      g.strokeStyle = color; g.lineWidth = 1.6; g.shadowColor = color; g.shadowBlur = T.glow ? 6 : 0;
      g.beginPath();
      for (let i = 0; i < span; i++) { const x = i / span * W, y = y0 - buf[t + i] * half * 0.45; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.shadowBlur = 0;
      this.font(11); g.fillStyle = T.dim; g.fillText(k ? 'RIGHT' : 'LEFT', 8, half * k + 14);
    });
    if (voices) {
      const buf = cur.voiceBuf, fr = cur.voiceFrames, n = voices, cols = n > 4 ? 3 : n, rowsN = Math.ceil(n / cols);
      const cw = W / cols, ch = (H - mainH) / rowsN;
      for (let v = 0; v < n; v++) {
        const x0 = (v % cols) * cw, y0 = mainH + Math.floor(v / cols) * ch, mid = y0 + ch / 2;
        g.strokeStyle = T.line; g.strokeRect(x0 + 2, y0 + 2, cw - 4, ch - 4);
        g.strokeStyle = this.col(v); g.lineWidth = 1.3; g.beginPath();
        for (let i = 0; i < fr; i++) { const x = x0 + 4 + i / fr * (cw - 8), y = mid - buf[i * n + v] * ch * 0.9; i ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
        this.font(10); g.fillStyle = T.dim; g.fillText((cur.voiceNames && cur.voiceNames[v]) || 'V' + (v + 1), x0 + 8, y0 + 14);
      }
    }
  }

  drawPhase() {
    const g = this.g, T = this.theme, W = this.W, H = this.H;
    g.fillStyle = T.fadeBg; g.fillRect(0, 0, W, H);
    if (!this.td) return;
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.42;
    g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r);
    g.moveTo(cx - r * 0.7, cy - r * 0.7); g.lineTo(cx + r * 0.7, cy + r * 0.7); g.moveTo(cx + r * 0.7, cy - r * 0.7); g.lineTo(cx - r * 0.7, cy + r * 0.7); g.stroke();
    g.fillStyle = T.green; g.shadowColor = T.green; g.shadowBlur = T.glow ? 4 : 0;
    let sLR = 0, sL = 0, sR = 0;
    for (let i = 0; i < this.td.length; i += 1) {
      const L = this.td[i], R = this.tdR[i];
      sLR += L * R; sL += L * L; sR += R * R;
      const x = cx + (R - L) * r * 0.75, y = cy - (L + R) * r * 0.75;
      g.fillRect(x, y, 1.5, 1.5);
    }
    g.shadowBlur = 0;
    const corr = sL && sR ? sLR / Math.sqrt(sL * sR) : 0;
    // correlation meter
    const mw = Math.min(300, W - 40), mx = cx - mw / 2, my = H - 22;
    g.fillStyle = T.bg; g.fillRect(mx - 40, my - 14, mw + 80, 26);
    g.fillStyle = T.off; g.fillRect(mx, my - 3, mw, 6);
    g.fillStyle = corr < 0 ? T.red : T.cyan; g.fillRect(cx, my - 3, corr * mw / 2, 6);
    this.font(10); g.fillStyle = T.dim; g.fillText('-1', mx - 18, my + 4); g.fillText('+1', mx + mw + 5, my + 4);
    g.fillText('PHASE  L/R correlation ' + corr.toFixed(2), 10, 16);
  }

  drawNotes(cur) {
    const g = this.g, T = this.theme, W = this.W, H = this.H;
    if (!cur) return this.empty('NO SONG LOADED');
    const n = cur.fr ? cur.fr.length : 0;
    if (!n || !cur.fr.some(Boolean) && !cur.info.channels) return this.empty('NO NOTE DATA', 'note dots need per-channel pitch information');
    if (cur.kind === 'pcm') return this.empty('NO NOTE DATA', 'audio files carry no note information');
    const lo = 24, hi = 108, keyH = Math.min(46, H * 0.16), top = 8, laneH = (H - keyH - top - 8) / Math.max(1, n);
    const xOf = (midi) => 10 + (midi - lo) / (hi - lo) * (W - 20);
    // octave grid
    this.font(10); g.textBaseline = 'middle';
    for (let m = lo; m <= hi; m += 12) { const x = xOf(m); g.strokeStyle = T.line; g.beginPath(); g.moveTo(x, top); g.lineTo(x, H - keyH - 4); g.stroke(); }
    for (let i = 0; i < n; i++) {
      const y = top + i * laneH + laneH / 2;
      if (laneH > 6) { g.fillStyle = i % 2 ? T.stripe : 'transparent'; g.fillRect(0, y - laneH / 2, W, laneH); }
      const f = cur.fr[i], lv = (cur.l && cur.l[i] || 0) / 255;
      const muted = cur.muted && cur.muted.has(i);
      if (f && lv > 0.02 && !muted) {
        const midi = 12 * Math.log2(f / 440) + 69, x = xOf(midi);
        const r = Math.max(2, Math.min(laneH * 0.45, 3 + lv * 8));
        this.noteTrail.push([x, y, r, i, performance.now()]);
        g.fillStyle = this.col(i); g.shadowColor = this.col(i); g.shadowBlur = T.glow ? 10 : 0;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      }
    }
    const now = performance.now();
    this.noteTrail = this.noteTrail.filter(t => now - t[4] < 900);
    for (const [x, y, r, i, t] of this.noteTrail) { g.globalAlpha = 0.25 * (1 - (now - t) / 900); g.fillStyle = this.col(i); g.fillRect(x - 1, y - 1, 2, 2); }
    g.globalAlpha = 1;
    // keyboard
    const ky = H - keyH;
    for (let m = lo; m < hi; m++) {
      const black = [1, 3, 6, 8, 10].includes(m % 12), x = xOf(m), w = xOf(m + 1) - x;
      g.fillStyle = black ? T.keyBlack : T.keyWhite; g.fillRect(x, ky + (black ? 0 : 0), Math.max(1, w - 1), black ? keyH * 0.62 : keyH);
    }
    for (let i = 0; i < n; i++) { const f = cur.fr[i]; if (f && (cur.l[i] || 0) > 6 && !(cur.muted && cur.muted.has(i))) { const m = Math.round(12 * Math.log2(f / 440) + 69); if (m >= lo && m < hi) { g.fillStyle = this.col(i); g.fillRect(xOf(m), ky + keyH - 6, xOf(m + 1) - xOf(m) - 1, 6); } } }
    for (let m = lo; m <= hi; m += 12) { g.fillStyle = T.dim; g.fillText('C' + (m / 12 - 1), xOf(m) + 2, ky - 8); }
  }

  drawWuerfel(cur) {
    const g = this.g, T = this.theme, W = this.W, H = this.H, now = performance.now();
    const dt = Math.min(0.05, (now - (this.lastW || now)) / 1000); this.lastW = now;
    let bass = 0, mid = 0, hiE = 0;
    if (this.fft) { for (let i = 2; i < 24; i++) bass += this.fft[i]; for (let i = 24; i < 200; i++) mid += this.fft[i]; for (let i = 200; i < 900; i++) hiE += this.fft[i]; bass /= 22 * 255; mid /= 176 * 255; hiE /= 700 * 255; }
    this.pulse = Math.max(bass, (this.pulse || 0) * 0.92);
    // starfield
    const cx = W / 2, cy = H / 2;
    for (const s of this.stars) {
      s[2] -= dt * (0.15 + mid * 1.5); if (s[2] <= 0.02) { s[0] = Math.random() * 2 - 1; s[1] = Math.random() * 2 - 1; s[2] = 1; }
      const x = cx + s[0] / s[2] * W * 0.25, y = cy + s[1] / s[2] * H * 0.25;
      g.fillStyle = T.fg; g.globalAlpha = Math.min(1, (1 - s[2]) * 1.4); g.fillRect(x, y, 1.6, 1.6);
    }
    g.globalAlpha = 1;
    const a = this.angle; a.x += dt * (0.4 + mid * 1.2); a.y += dt * (0.55 + hiE * 2); a.z += dt * 0.15;
    const size = Math.min(W, H) * (0.22 + this.pulse * 0.12);
    const V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    const Ed = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const proj = (v, s) => {
      let [x, y, z] = v.map(c => c * s);
      let t; const cxr = Math.cos(a.x), sxr = Math.sin(a.x), cyr = Math.cos(a.y), syr = Math.sin(a.y), czr = Math.cos(a.z), szr = Math.sin(a.z);
      t = y * cxr - z * sxr; z = y * sxr + z * cxr; y = t;
      t = x * cyr + z * syr; z = -x * syr + z * cyr; x = t;
      t = x * czr - y * szr; y = x * szr + y * czr; x = t;
      const p = 600 / (600 + z);
      return [cx + x * p, cy + y * p, z];
    };
    const draw = (s, color, lw) => {
      const P = V.map(v => proj(v, s));
      g.strokeStyle = color; g.lineWidth = lw; g.shadowColor = color; g.shadowBlur = T.glow ? 12 : 0;
      g.beginPath(); for (const [i, j] of Ed) { g.moveTo(P[i][0], P[i][1]); g.lineTo(P[j][0], P[j][1]); } g.stroke();
      g.fillStyle = color; for (const p of P) g.fillRect(p[0] - 2, p[1] - 2, 4, 4);
      g.shadowBlur = 0;
    };
    draw(size, T.cyan, 2);
    draw(size * (0.45 + hiE * 0.6), T.magenta, 1.5);
    // channel energy ring
    if (cur && cur.l && cur.l.length) {
      const n = cur.l.length, R = size * 1.9;
      for (let i = 0; i < n; i++) {
        const ang = i / n * Math.PI * 2 + a.z, v = (cur.l[i] || 0) / 255;
        g.strokeStyle = this.col(i); g.lineWidth = Math.max(2, 120 / n);
        g.beginPath(); g.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R * 0.6); g.lineTo(cx + Math.cos(ang) * (R + v * size * 0.8), cy + Math.sin(ang) * (R + v * size * 0.8) * 0.6); g.stroke();
      }
    }
    // scroller
    const txt = cur ? `  ${[cur.info.title || (cur.item && cur.item.name), cur.info.author, cur.info.type, cur.engineName].filter(Boolean).join('  ·  ')}  ·  CUBIC PLAYER  ` : '  CUBIC PLAYER  ·  DROP SOME MUSIC  ';
    this.font(Math.max(22, Math.min(44, H / 9)), true); g.textBaseline = 'middle';
    const tw = g.measureText(txt).width, sx = W - ((now / 9) % (tw + W));
    const base = H - Math.max(26, H / 12);
    for (let i = 0, x = sx; i < txt.length; i++) {
      const chw = g.measureText(txt[i]).width;
      if (x > -40 && x < W + 40) { g.fillStyle = this.col(i >> 2); g.fillText(txt[i], x, base + Math.sin(now / 300 + x / 60) * 8); }
      x += chw;
    }
  }

  hit(x, y) { for (const h of this.hits) if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h; return null; }
}

const rgbCache = new Map();
function rgbOf(c) {
  if (rgbCache.has(c)) return rgbCache.get(c);
  const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; const h = x.fillStyle;
  let r;
  if (h[0] === '#') r = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  else r = (h.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  rgbCache.set(c, r); return r;
}

function heat(v, pal) {
  // palette stops [[pos, r, g, b], ...]
  for (let i = 1; i < pal.length; i++) {
    if (v <= pal[i][0]) { const a = pal[i - 1], b = pal[i], t = (v - a[0]) / (b[0] - a[0] || 1); return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]; }
  }
  const l = pal[pal.length - 1]; return [l[1], l[2], l[3]];
}
