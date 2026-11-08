// Cubic AudioWorklet: one processor that hosts libopenmpt (tracker modules) and the
// WebAssembly engines compiled for this player (AdPlug, Game Music Emu, HivelyTracker, MIDI).
import libopenmptFactory from '../build/libopenmpt.patched.js';

let mpt = null;                 // libopenmpt emscripten module
let mptVersion = '';
const pending = [];             // messages that arrived before libopenmpt was ready
const compiled = {};            // engine kind -> WebAssembly.Module

libopenmptFactory().then(m => {
  mpt = m;
  try { mptVersion = withStack(() => m.UTF8ToString(m._openmpt_get_string(cstrStack('library_version')))); } catch (e) {}
  for (const f of pending.splice(0)) f();
}).catch(e => { mptFailed = String(e); for (const f of pending.splice(0)) f(); });
let mptFailed = null;

function withStack(fn) { const sp = mpt.stackSave(); try { return fn(); } finally { mpt.stackRestore(sp); } }
function cstrStack(s) {
  const b = utf8Encode(s); const p = mpt.stackAlloc(b.length + 1);
  mpt.HEAPU8.set(b, p); mpt.HEAPU8[p + b.length] = 0; return p;
}
function mptStr(p) { if (!p) return ''; const s = mpt.UTF8ToString(p); mpt._openmpt_free_string(p); return s; }

// ---------- minimal WASI host for the zig-built engines ----------
function makeWasi(getMem) {
  const dv = () => new DataView(getMem().buffer);
  return {
    fd_write(fd, iovs, n, nw) { let t = 0; const d = dv(); for (let i = 0; i < n; i++) t += d.getUint32(iovs + i * 8 + 4, true); d.setUint32(nw, t, true); return 0; },
    environ_sizes_get(c, s) { const d = dv(); d.setUint32(c, 0, true); d.setUint32(s, 0, true); return 0; },
    args_sizes_get(c, s) { const d = dv(); d.setUint32(c, 0, true); d.setUint32(s, 0, true); return 0; },
    environ_get() { return 0; }, args_get() { return 0; }, fd_close() { return 0; }, sched_yield() { return 0; },
    clock_time_get(id, prec, out) { dv().setBigUint64(out, BigInt(Math.round(Date.now() * 1e6)), true); return 0; },
    random_get(p, l) { const a = new Uint8Array(getMem().buffer, p, l); for (let i = 0; i < l; i++) a[i] = (Math.random() * 256) | 0; return 0; },
    proc_exit(c) { throw new Error('engine exit ' + c); },
  };
}
// AudioWorkletGlobalScope has no TextEncoder/TextDecoder
function utf8Encode(str) { const out = []; for (const ch of str) { let c = ch.codePointAt(0); if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63); else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63); else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63); } return new Uint8Array(out); }
function utf8Decode(b) { let s = '', i = 0; while (i < b.length) { const c = b[i++]; if (c < 0x80) s += String.fromCharCode(c); else if (c >= 0xc0 && c < 0xe0 && (b[i] & 0xc0) === 0x80) s += String.fromCharCode((c & 31) << 6 | b[i++] & 63); else if (c >= 0xe0 && c < 0xf0 && (b[i] & 0xc0) === 0x80 && (b[i + 1] & 0xc0) === 0x80) { s += String.fromCharCode((c & 15) << 12 | (b[i] & 63) << 6 | b[i + 1] & 63); i += 2; } else s += String.fromCharCode(c); } return s; }
const dec = { decode: utf8Decode };
async function instantiate(kind, bytes) {
  if (!compiled[kind]) compiled[kind] = await WebAssembly.compile(bytes);
  const mod = compiled[kind];
  let mem;
  const wasi = makeWasi(() => mem);
  const imp = {};
  for (const i of WebAssembly.Module.imports(mod)) {
    imp[i.module] = imp[i.module] || {};
    imp[i.module][i.name] = i.module === 'wasi_snapshot_preview1' ? (wasi[i.name] || (() => 52)) : (() => 0);
  }
  const inst = await WebAssembly.instantiate(mod, imp);
  mem = inst.exports.memory;
  if (inst.exports._initialize) inst.exports._initialize();
  const X = inst.exports;
  const E = {
    X, kind,
    u8: () => new Uint8Array(mem.buffer),
    str(p) { const u = new Uint8Array(mem.buffer); let e = p; while (u[e]) e++; return dec.decode(u.subarray(p, e)); },
    put(data) { const p = X.eng_alloc(data.length + 1); new Uint8Array(mem.buffer).set(data, p); new Uint8Array(mem.buffer)[p + data.length] = 0; return p; },
    cstr(s) { return E.put(utf8Encode(s)); },
    json(p) { try { return JSON.parse(E.str(p)); } catch (e) { return {}; } },
  };
  return E;
}

// ---------- the processor ----------
const MAXCH = 64;

class Cubic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = null;      // 'mpt' | 'eng'
    this.playing = false;
    this.loop = false;
    this.pitch = 1; this.tempo = 1;
    this.tick = 0;
    this.endedSent = false;
    this.muted = new Set();
    this.port.onmessage = (e) => { const m = e.data; if (!mpt && !mptFailed && (m.t === 'mpt' || m.t === 'exts')) pending.push(() => this.msg(m)); else this.msg(m); };
  }

  post(m, tr) { this.port.postMessage(m, tr || []); }

  async msg(m) {
    try {
      switch (m.t) {
        case 'exts': this.post({ t: 'exts', list: mpt ? mptStr(mpt._openmpt_get_supported_extensions()).split(';') : [], version: mptVersion }); break;
        case 'mpt': this.unload(); this.loadMpt(m); break;
        case 'eng': this.unload(); await this.loadEng(m); break;
        case 'unload': this.unload(); break;
        case 'play': this.playing = true; break;
        case 'pause': this.playing = false; break;
        case 'loop': this.loop = !!m.on; if (this.mode === 'mpt') mpt._openmpt_module_set_repeat_count(this.mod, this.loop ? -1 : 0); break;
        case 'seek': this.seek(m.ms); break;
        case 'song': this.selectSong(m.n); break;
        case 'mute': this.mute(m.ch, m.on); break;
        case 'pitch': this.pitch = m.f; if (this.mode === 'mpt') this.ctl('play.pitch_factor', String(m.f)); this.step = this.mode === 'eng' ? m.f : 1; break;
        case 'tempo': this.tempo = m.f; if (this.mode === 'mpt') this.ctl('play.tempo_factor', String(m.f)); break;
        case 'stereo': if (this.mode === 'mpt') mpt._openmpt_module_set_render_param(this.mod, 2, m.v | 0); this.sep = m.v; break;
        case 'interp': if (this.mode === 'mpt') mpt._openmpt_module_set_render_param(this.mod, 3, m.v | 0); break;
        case 'cells': this.sendCells(m.pat); break;
        case 'bank': if (this.mode === 'eng' && this.E.X.eng_setbank) { this.E.X.eng_setbank(m.n); } break;
      }
    } catch (e) {
      this.post({ t: 'error', msg: String(e && e.message || e) });
    }
  }

  unload() {
    if (this.mode === 'mpt' && this.ext) { mpt._openmpt_module_ext_destroy(this.ext); }
    if (this.mode === 'mpt' && this.bufL) { mpt._free(this.bufL); mpt._free(this.bufR); }
    this.mode = null; this.mod = 0; this.ext = 0; this.E = null; this.playing = false; this.endedSent = false;
    this.muted.clear(); this.lastNotes = null; this.src = null;
  }

  // ----- libopenmpt -----
  ctl(k, v) { withStack(() => mpt._openmpt_module_ctl_set(this.mod, cstrStack(k), cstrStack(v))); }

  loadMpt(m) {
    if (!mpt) throw new Error('libopenmpt failed to start: ' + mptFailed);
    const data = new Uint8Array(m.data);
    const p = mpt._malloc(data.length); mpt.HEAPU8.set(data, p);
    const ext = mpt._openmpt_module_ext_create_from_memory(p, data.length, 0, 0, 0, 0, 0, 0, 0);
    mpt._free(p);
    if (!ext) { this.post({ t: 'error', msg: 'libopenmpt could not open this file' }); return; }
    this.ext = ext; this.mod = mpt._openmpt_module_ext_get_module(ext); this.mode = 'mpt';
    // interactive interface (channel mute)
    this.iface = 0;
    for (const n of [16, 14, 12]) {
      const ip = mpt._malloc(n * 4);
      const ok = withStack(() => mpt._openmpt_module_ext_get_interface(ext, cstrStack('interactive'), ip, n * 4));
      if (ok) { this.iface = ip; break; }
      mpt._free(ip);
    }
    this.bufL = mpt._malloc(4 * 4096); this.bufR = mpt._malloc(4 * 4096);
    mpt._openmpt_module_set_repeat_count(this.mod, this.loop ? -1 : 0);
    mpt._openmpt_module_set_render_param(this.mod, 2, m.stereo == null ? 100 : m.stereo);
    mpt._openmpt_module_set_render_param(this.mod, 3, m.interp == null ? 8 : m.interp);
    if (m.pitch && m.pitch !== 1) this.ctl('play.pitch_factor', String(m.pitch));
    if (m.tempo && m.tempo !== 1) this.ctl('play.tempo_factor', String(m.tempo));
    if (m.amiga) this.ctl('render.resampler.emulate_amiga', '1');
    const M = this.mod;
    const meta = (k) => withStack(() => mptStr(mpt._openmpt_module_get_metadata(M, cstrStack(k))));
    const names = (cnt, fn) => { const a = []; for (let i = 0; i < cnt; i++) a.push(mptStr(fn(M, i))); return a; };
    const nch = mpt._openmpt_module_get_num_channels(M);
    const songs = mpt._openmpt_module_get_num_subsongs(M);
    const info = {
      engine: 'libopenmpt ' + mptVersion, type: meta('type_long') || meta('type'), tracker: meta('tracker'),
      title: meta('title'), author: meta('artist'), desc: meta('message'), date: meta('date'),
      container: meta('container_long'),
      songs, songNames: names(songs, mpt._openmpt_module_get_subsong_name),
      channels: nch, lengthMs: mpt._openmpt_module_get_duration_seconds(M) * 1000,
      orders: mpt._openmpt_module_get_num_orders(M), patterns: mpt._openmpt_module_get_num_patterns(M),
      instruments: names(mpt._openmpt_module_get_num_instruments(M), mpt._openmpt_module_get_instrument_name),
      samples: names(mpt._openmpt_module_get_num_samples(M), mpt._openmpt_module_get_sample_name),
      channelNames: names(nch, mpt._openmpt_module_get_channel_name),
      canMute: !!this.iface, canSeek: true, hasCells: true, canTempo: true,
    };
    this.nch = nch; this.lastNotes = new Array(nch).fill(0); this.lastRow = -1;
    this.post({ t: 'loaded', info });
  }

  mptMute(ch, on) {
    if (!this.iface) return;
    const fp = mpt.HEAPU32[(this.iface >> 2) + 10];       // set_channel_mute_status
    try { mpt.getWasmTableEntry(fp)(this.ext, ch, on ? 1 : 0); } catch (e) {}
  }

  sendCells(pat) {
    if (this.mode === 'mpt') {
      const M = this.mod, rows = mpt._openmpt_module_get_pattern_num_rows(M, pat), out = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < this.nch; c++) row.push(mptStr(mpt._openmpt_module_format_pattern_row_channel(M, pat, r, c, 0, 1)));
        out.push(row);
      }
      this.post({ t: 'cells', pat, rows: out });
    } else if (this.mode === 'eng' && this.E.X.eng_cell) {
      const X = this.E.X, out = [], nr = this.info.rows || 64;
      for (let r = 0; r < nr; r++) { const row = []; for (let c = 0; c < this.nch; c++) row.push(this.E.str(X.eng_cell(pat, r, c))); out.push(row); }
      this.post({ t: 'cells', pat, rows: out });
    }
  }

  // ----- wasm engines -----
  async loadEng(m) {
    const E = await instantiate(m.kind, m.wasm);
    const X = E.X;
    for (const [n, d] of (m.files || [])) { const pn = E.cstr(n.toLowerCase()), pd = E.put(new Uint8Array(d)); X.eng_addfile(pn, pd, d.byteLength); X.eng_free(pn); X.eng_free(pd); }
    if (m.bank != null && X.eng_setbank) X.eng_setbank(m.bank);
    const data = new Uint8Array(m.data);
    const pd = E.put(data), pn = E.cstr(m.name || 'file');
    const ok = X.eng_load(pd, data.length, pn, sampleRate);
    X.eng_free(pn);
    if (!ok) { this.post({ t: 'error', msg: m.kind + ' engine could not play this file' }); return; }
    this.E = E; this.mode = 'eng';
    this.info = E.json(X.eng_info());
    if (X.eng_banks) this.info.banks = E.json(X.eng_banks());
    this.nch = Math.min(this.info.channels || 0, MAXCH);
    this.out = X.eng_alloc(4096 * 4 + 16);
    this.lv = X.eng_alloc(MAXCH); this.fr = X.eng_alloc(MAXCH * 2);
    this.step = this.pitch; this.frac = 0; this.src = new Float32Array(8192 * 2); this.srcLen = 0; this.srcPos = 0;
    this.seekable = m.kind !== 'hvl';
    Object.assign(this.info, { canMute: true, canSeek: true, hasCells: !!X.eng_cell, canTempo: false });
    this.song = 0;
    this.post({ t: 'loaded', info: this.info });
  }

  engRender(frames) {             // render `frames` engine frames into this.src (append)
    const X = this.E.X;
    let done = 0;
    while (done < frames) {
      const n = Math.min(4096, frames - done);
      X.eng_render(this.out, n);
      const s16 = new Int16Array(this.E.u8().buffer, this.out, n * 2);
      const base = this.srcLen * 2;
      for (let i = 0; i < n * 2; i++) this.src[base + i] = s16[i] / 32768;
      this.srcLen += n; done += n;
    }
  }

  seek(ms) {
    if (this.mode === 'mpt') { mpt._openmpt_module_set_position_seconds(this.mod, ms / 1000); this.endedSent = false; return; }
    if (this.mode !== 'eng') return;
    const X = this.E.X;
    if (this.seekable) X.eng_seek(ms);
    else {                         // HVL: restart the subsong and fast-forward
      X.eng_select(this.song);
      const tmp = this.out;
      let left = Math.max(0, Math.round(ms * sampleRate / 1000));
      while (left > 0) { const n = Math.min(4096, left); X.eng_render(tmp, n); left -= n; }
    }
    this.srcLen = 0; this.srcPos = 0; this.frac = 0; this.endedSent = false;
  }

  selectSong(n) {
    if (this.mode === 'mpt') { mpt._openmpt_module_select_subsong(this.mod, n); this.endedSent = false; this.post({ t: 'songlen', ms: mpt._openmpt_module_get_duration_seconds(this.mod) * 1000 }); return; }
    if (this.mode !== 'eng') return;
    this.E.X.eng_select(n); this.song = n;
    this.srcLen = 0; this.srcPos = 0; this.endedSent = false;
    const inf = this.E.json(this.E.X.eng_info());
    this.post({ t: 'songlen', ms: inf.lengthMs || 0, info: inf });
  }

  mute(ch, on) {
    if (on) this.muted.add(ch); else this.muted.delete(ch);
    if (this.mode === 'mpt') this.mptMute(ch, on);
    else if (this.mode === 'eng') this.E.X.eng_mute(ch, on ? 1 : 0);
  }

  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    if (!this.playing || !this.mode) return true;
    if (this.mode === 'mpt') {
      const got = mpt._openmpt_module_read_float_stereo(this.mod, sampleRate, n, this.bufL, this.bufR);
      L.set(mpt.HEAPF32.subarray(this.bufL >> 2, (this.bufL >> 2) + got));
      R.set(mpt.HEAPF32.subarray(this.bufR >> 2, (this.bufR >> 2) + got));
      if (got === 0 && !this.endedSent) { this.endedSent = true; this.post({ t: 'ended' }); }
    } else {
      // engine output with a linear resampler for the pitch control
      const step = this.step || 1;
      const need = Math.ceil(this.srcPos + this.frac + n * step) + 2;
      if (this.srcLen < need) {
        if (this.srcPos > 0) {          // compact
          this.src.copyWithin(0, this.srcPos * 2, this.srcLen * 2); this.srcLen -= this.srcPos; this.srcPos = 0;
        }
        const want = Math.ceil(this.frac + n * step) + 2 - this.srcLen;
        if (want > 0) this.engRender(want);
      }
      const s = this.src;
      let pos = this.srcPos + this.frac;
      for (let i = 0; i < n; i++) {
        const i0 = pos | 0, f = pos - i0, a = i0 * 2;
        L[i] = s[a] + (s[a + 2] - s[a]) * f;
        R[i] = s[a + 1] + (s[a + 3] - s[a + 1]) * f;
        pos += step;
      }
      this.srcPos = pos | 0; this.frac = pos - this.srcPos;
      if (this.E.X.eng_ended() && !this.endedSent) {
        if (this.loop) { this.seek(0); }
        else { this.endedSent = true; this.post({ t: 'ended' }); }
      }
    }
    if ((++this.tick & 3) === 0) this.status();     // ~86 Hz / 4 = ~21 Hz at 44.1 kHz... (128-frame blocks)
    return true;
  }

  status() {
    const msg = { t: 'tick' };
    if (this.mode === 'mpt') {
      const M = this.mod, nch = this.nch;
      msg.pos = mpt._openmpt_module_get_position_seconds(M) * 1000;
      const order = mpt._openmpt_module_get_current_order(M), pat = mpt._openmpt_module_get_current_pattern(M), row = mpt._openmpt_module_get_current_row(M);
      msg.st = { order, pattern: pat, row, speed: mpt._openmpt_module_get_current_speed(M), tempo: mpt._openmpt_module_get_current_tempo(M),
        bpm: Math.round(mpt._openmpt_module_get_current_estimated_bpm(M)), active: mpt._openmpt_module_get_current_playing_channels(M) };
      const l = new Uint8Array(nch), r = new Uint8Array(nch);
      for (let c = 0; c < nch; c++) {
        l[c] = Math.min(255, Math.sqrt(mpt._openmpt_module_get_current_channel_vu_left(M, c)) * 255);
        r[c] = Math.min(255, Math.sqrt(mpt._openmpt_module_get_current_channel_vu_right(M, c)) * 255);
      }
      if (row !== this.lastRow) {
        this.lastRow = row;
        for (let c = 0; c < nch; c++) { const nt = mpt._openmpt_module_get_pattern_row_channel_command(M, pat, row, c, 0); if (nt > 0 && nt <= 120) this.lastNotes[c] = nt; else if (nt >= 254) this.lastNotes[c] = 0; }
      }
      const fr = new Uint16Array(nch);
      for (let c = 0; c < nch; c++) fr[c] = this.lastNotes[c] && (l[c] + r[c]) > 4 ? Math.round(440 * Math.pow(2, (this.lastNotes[c] - 58) / 12) * this.pitch) : 0;
      msg.l = l; msg.r = r; msg.fr = fr;
    } else {
      const X = this.E.X;
      msg.pos = X.eng_pos_ms();
      msg.st = this.E.json(X.eng_status());
      const n = this.nch ? X.eng_channels(this.lv, this.fr, MAXCH) : 0;
      const u = this.E.u8();
      const lv = u.slice(this.lv, this.lv + n);
      const fr = new Uint16Array(n); const dv = new DataView(u.buffer);
      for (let i = 0; i < n; i++) fr[i] = Math.round(dv.getUint16(this.fr + i * 2, true) * this.pitch);
      msg.l = lv; msg.r = lv; msg.fr = fr;
    }
    this.post(msg);
  }
}
registerProcessor('cubic', Cubic);
