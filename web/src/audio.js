// Audio core: one AudioContext, the Cubic worklet (libopenmpt + wasm engines), cawtooth players,
// PCM playback, and the master chain with analysers.
import { asset, assetURL, importAsset } from './assets.js';
import { engines, ext, PCM_EXTS, setMptExts, ENGINE_NAMES } from './formats.js';
import { readTags } from './meta.js';
import { gunzipSync } from 'fflate';

const CAW_FORMATS = {
  psid: ['caw-w-psid', 'caw-sidplay'],
  ay: ['caw-w-ay', 'caw-ayumi'],
  sndh: ['caw-w-sndh', 'caw-sndh'],
  zxay: ['caw-w-zxay', 'caw-zxay'],
};

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [7, 6, 4.5, 2, 0, 0, 0, 0, 0, 0],
  Loudness: [6, 4.5, 2, 0, -1, -1, 0, 2, 4, 5],
  Treble: [0, 0, 0, 0, 0, 0.5, 2, 4, 6, 7],
  'Amiga warm': [2, 2, 1.5, 1, 0, 0, -1, -3, -6, -9],
  'Chip sparkle': [-2, -1, 0, 0, 0, 1, 2.5, 4, 4, 2],
  'AdLib room': [3, 2.5, 1, 0, -1, 0, 1.5, 1, 0, -2],
  Vocal: [-3, -2, -1, 1, 3.5, 4, 3, 1, 0, -1],
  Headphones: [3, 2, 0, -1, -0.5, 0.5, 1.5, 3, 2, 1],
  'Small speaker': [-6, -4, 0, 3, 4, 3, 1, 0, -1, -2],
};

export class AudioCore {
  constructor() {
    this.ctx = null;
    this.cb = {};              // loaded, tick, ended, error, state
    this.cur = null;           // current song state
    this.gen = 0;
    this.vol = 1; this.bal = 0; this.width = 1; this.pitch = 1; this.tempo = 1;
    this.loop = false;
    this.defaultLenMs = 180000;
    this.mptOpts = { stereo: 100, interp: 8, amiga: false };
    this.midiBank = 58;
    this.soundfont = null;     // Uint8Array
    this.sentWasm = new Set();
    this.pendingLoad = null;
    this.mptVersion = '';
    this.eq = EQ_FREQS.map(() => 0); this.eqOn = true;
  }

  on(ev, fn) { this.cb[ev] = fn; }
  emit(ev, a) { if (this.cb[ev]) this.cb[ev](a); }

  async init() {
    if (!this.initP) this.initP = this.initOnce();
    await this.initP;
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
  }
  async initOnce() {
    const ctx = this.ctx = new AudioContext({ latencyHint: 'playback' });
    await ctx.audioWorklet.addModule(await assetURL('worklet'));
    this.node = new AudioWorkletNode(ctx, 'cubic', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node.port.onmessage = (e) => this.onWorklet(e.data);
    // master chain: input -> width matrix -> volume -> balance -> out (+ analysers)
    this.input = ctx.createGain();
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    this.wLL = ctx.createGain(); this.wLR = ctx.createGain(); this.wRL = ctx.createGain(); this.wRR = ctx.createGain();
    // 10-band graphic equalizer (shelves at the ends, peaking filters in between) with automatic preamp
    this.pre = ctx.createGain();
    this.eqNodes = EQ_FREQS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1.2; return b; });
    this.input.connect(this.pre);
    this.eqNodes.reduce((prev, n) => { prev.connect(n); return n; }, this.pre).connect(split);
    this.applyEq();
    split.connect(this.wLL, 0); split.connect(this.wLR, 0); split.connect(this.wRL, 1); split.connect(this.wRR, 1);
    this.wLL.connect(merge, 0, 0); this.wRL.connect(merge, 0, 0); this.wLR.connect(merge, 0, 1); this.wRR.connect(merge, 0, 1);
    this.gain = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    merge.connect(this.gain); this.gain.connect(this.pan); this.pan.connect(ctx.destination);
    // analysers
    const s2 = ctx.createChannelSplitter(2);
    this.pan.connect(s2);
    this.anL = ctx.createAnalyser(); this.anR = ctx.createAnalyser();
    for (const a of [this.anL, this.anR]) { a.fftSize = 2048; a.smoothingTimeConstant = 0; }
    s2.connect(this.anL, 0); s2.connect(this.anR, 1);
    this.anF = ctx.createAnalyser(); this.anF.fftSize = 8192; this.anF.smoothingTimeConstant = 0.55; this.anF.minDecibels = -96; this.anF.maxDecibels = -10;
    this.pan.connect(this.anF);
    this.node.connect(this.input);
    this.applyMix();
    this.node.port.postMessage({ t: 'exts' });
    this.node.port.postMessage({ t: 'loop', on: this.loop });
    ctx.onstatechange = () => this.emit('state');
  }

  setEq(i, db) { this.eq[i] = Math.max(-12, Math.min(12, Math.round(db * 2) / 2)); this.applyEq(); }
  setEqAll(arr) { this.eq = arr.slice(0, EQ_FREQS.length); while (this.eq.length < EQ_FREQS.length) this.eq.push(0); this.applyEq(); }
  setEqOn(on) { this.eqOn = on; this.applyEq(); }
  applyEq() {
    if (!this.eqNodes) return;
    const t = this.ctx.currentTime;
    this.eqNodes.forEach((n, i) => n.gain.setTargetAtTime(this.eqOn ? this.eq[i] : 0, t, 0.02));
    const boost = this.eqOn ? Math.max(0, ...this.eq) : 0;
    this.pre.gain.setTargetAtTime(Math.pow(10, -boost * 0.6 / 20), t, 0.02);   // keep boosts from clipping
  }
  // magnitude response of the whole EQ (dB) at the given frequencies
  eqResponse(freqs) {
    const out = new Float32Array(freqs.length);
    if (!this.eqNodes) { for (let i = 0; i < freqs.length; i++) out[i] = 0; return out; }
    const mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
    for (const n of this.eqNodes) { n.getFrequencyResponse(freqs, mag, ph); for (let i = 0; i < freqs.length; i++) out[i] += 20 * Math.log10(mag[i] || 1e-6); }
    return out;
  }

  applyMix() {
    if (!this.ctx) return;
    const w = this.width, a = (1 + w) / 2, b = (1 - w) / 2;
    this.wLL.gain.value = a; this.wRR.gain.value = a; this.wLR.gain.value = b; this.wRL.gain.value = b;
    this.gain.gain.value = this.vol * this.vol;
    this.pan.pan.value = this.bal;
  }
  setVolume(v) { this.vol = Math.max(0, Math.min(1.5, v)); this.applyMix(); }
  setBalance(v) { this.bal = Math.max(-1, Math.min(1, v)); this.applyMix(); }
  setWidth(v) { this.width = Math.max(-1, Math.min(1, v)); this.applyMix(); }
  setPitch(f) {
    this.pitch = Math.max(0.25, Math.min(4, f));
    this.node && this.node.port.postMessage({ t: 'pitch', f: this.pitch });
    if (this.cur && this.cur.kind === 'pcm' && this.pcmSrc) { this.pcmSyncPos(); this.pcmSrc.playbackRate.value = this.pitch; }
  }
  setTempo(f) { this.tempo = Math.max(0.25, Math.min(4, f)); this.node && this.node.port.postMessage({ t: 'tempo', f: this.tempo }); }
  setLoop(on) {
    this.loop = on; this.node && this.node.port.postMessage({ t: 'loop', on });
    if (this.cur && this.cur.kind === 'caw' && this.caw && this.caw.setSubsongDurationSec) this.caw.setSubsongDurationSec(on ? null : this.cur.lengthMs / 1000);
  }
  setMpt(k, v) {
    this.mptOpts[k] = v;
    if (!this.node) return;
    if (k === 'stereo') this.node.port.postMessage({ t: 'stereo', v });
    if (k === 'interp') this.node.port.postMessage({ t: 'interp', v });
  }
  setBank(n) { this.midiBank = n; this.node && this.node.port.postMessage({ t: 'bank', n }); }

  onWorklet(m) {
    switch (m.t) {
      case 'exts': setMptExts(m.list); this.mptVersion = m.version; break;
      case 'loaded': case 'error': if (this.pendingLoad) { const p = this.pendingLoad; this.pendingLoad = null; m.t === 'loaded' ? p.res(m.info) : p.rej(new Error(m.msg)); } else if (m.t === 'error') this.emit('error', m.msg); break;
      case 'tick': if (this.cur && (this.cur.kind === 'mpt' || this.cur.engine)) { this.cur.posMs = m.pos; this.cur.st = m.st; this.cur.l = m.l; this.cur.r = m.r; this.cur.fr = m.fr; } break;
      case 'ended': if (this.cur && (this.cur.kind === 'mpt' || this.cur.engine)) this.songEnded(); break;
      case 'cells': this.emit('cells', m); break;
      case 'songlen': if (this.cur) { this.cur.lengthMs = m.ms; if (m.info) this.cur.info = Object.assign(this.cur.info, m.info, { songs: this.cur.info.songs }); this.emit('loaded', this.cur); } break;
    }
  }

  songEnded() {
    if (!this.cur || this.cur.endedFired) return;
    this.cur.endedFired = true;
    this.emit('ended', this.cur);
  }

  workletCall(msg, transfer) {
    return new Promise((res, rej) => {
      if (this.pendingLoad) this.pendingLoad.rej(new Error('superseded'));
      this.pendingLoad = { res, rej };
      this.node.port.postMessage(msg, transfer || []);
      setTimeout(() => { if (this.pendingLoad && this.pendingLoad.res === res) { this.pendingLoad = null; rej(new Error('engine timeout')); } }, 20000);
    });
  }

  async stopAll() {
    this.node && this.node.port.postMessage({ t: 'unload' });
    if (this.caw) { try { await this.caw.dispose(); } catch (e) {} this.caw = null; this.cawUnsub = null; }
    this.pcmStop();
    this.pcmBuf = null;
    this.cur = null;
  }

  // ---- loading ----
  // item: {name, data: Uint8Array, siblings: () => Promise<[name, Uint8Array][]>, cue: {start, end}, title...}
  async load(item, { autoplay = true, subsong = null } = {}) {
    await this.init();
    const gen = ++this.gen;
    await this.stopAll();
    let data = item.data;
    if (data[0] === 0x1f && data[1] === 0x8b) { try { data = gunzipSync(data); } catch (e) {} }   // VGZ and other gzipped songs
    const order = engines(item.name, data);
    let lastErr = null;
    for (const kind of order) {
      if (gen !== this.gen) return null;
      try {
        const cur = await this.loadWith(kind, item, data);
        if (gen !== this.gen) return null;
        cur.item = item; cur.kind = kind; cur.engineName = ENGINE_NAMES[kind];
        cur.song = cur.song || 0; cur.posMs = 0; cur.endedFired = false;
        this.cur = cur;
        if (subsong != null && subsong !== cur.song && cur.info.songs > 1) this.selectSong(subsong);
        this.emit('loaded', cur);
        if (autoplay) this.play();
        return cur;
      } catch (e) {
        lastErr = e;
        console.warn(kind, 'could not play', item.name, e);
        if (kind === 'caw' && this.caw) { try { await this.caw.dispose(); } catch (e2) {} this.caw = null; }
      }
    }
    throw lastErr || new Error('No engine can play this file');
  }

  async loadWith(kind, item, data) {
    if (kind === 'mpt') {
      const info = await this.workletCall({ t: 'mpt', data: data.slice().buffer, name: item.name, pitch: this.pitch, tempo: this.tempo, ...this.mptOpts });
      return { info, lengthMs: info.lengthMs, kind };
    }
    if (kind === 'adplug' || kind === 'gme' || kind === 'hvl' || kind === 'midi') {
      const msg = { t: 'eng', kind, name: item.name, data: data.slice().buffer, files: [] };
      if (!this.sentWasm.has(kind)) { msg.wasm = (await asset(kind)).slice().buffer; }
      if (kind === 'adplug' && item.siblings) msg.files = (await item.siblings()).map(([n, d]) => [n.replace(/^.*[\\/]/, ''), d.slice().buffer]);
      if (kind === 'midi') { msg.bank = this.midiBank; if (this.soundfont) msg.files = [['soundfont.sf2', this.soundfont.slice().buffer]]; }
      const tr = [msg.data, ...(msg.wasm ? [msg.wasm] : []), ...msg.files.map(f => f[1])];
      let info;
      try { info = await this.workletCall(msg, tr); }
      finally { if (msg.wasm || this.sentWasm.has(kind)) this.sentWasm.add(kind); }
      let len = info.lengthMs || 0;
      if (!len) len = kind === 'hvl' ? 0 : this.defaultLenMs;
      return { info, lengthMs: len, engine: kind };
    }
    if (kind === 'caw') return this.loadCaw(item, data);
    if (kind === 'pcm') return this.loadPcm(item, data);
    throw new Error('unknown engine ' + kind);
  }

  async loadCaw(item, data) {
    if (!this.cawMod) this.cawMod = await importAsset('caw');
    if (!this.cawFactory) {
      const formats = {};
      for (const [k, [w, m]] of Object.entries(CAW_FORMATS)) formats[k] = { workletUrl: await assetURL(w), wasmUrl: await assetURL(m, 'application/wasm') };
      this.cawFactory = await this.cawMod.CawtoothPlayer.init({ formats, audioContext: this.ctx });
    }
    const p = await this.cawFactory.load(data, { filename: item.name, loop: this.loop });
    if (!p) throw new Error('cawtooth: unsupported');
    this.caw = p;
    p.output.connect(this.input);
    const inf = p.info || {};
    const songs = inf.songs || (inf.subsongs && inf.subsongs.length) || 1;
    const fmt = inf.format || p.format || '';
    const info = {
      engine: 'cawtooth', type: ({ psid: 'C64 SID', ay: 'AY-3-8910 / YM2149', sndh: 'Atari ST SNDH', zxay: 'ZX Spectrum AY' })[fmt] || fmt,
      title: inf.name || inf.title || '', author: inf.author || inf.composer || '', desc: [inf.released, inf.comment, inf.variant, inf.container].filter(Boolean).join(' · '),
      songs, channels: 0, canMute: false, canSeek: true, model: inf.model,
    };
    const cur = { info, kind: 'caw', song: Math.max(0, (inf.subsong || 1) - 1), lengthMs: (p.duration || 0) * 1000, l: new Uint8Array(0), r: new Uint8Array(0), fr: new Uint16Array(0), voiceBuf: null };
    if (!cur.lengthMs) { cur.lengthMs = this.defaultLenMs; cur.guessLen = true; if (p.setSubsongDurationSec) p.setSubsongDurationSec(this.loop ? null : this.defaultLenMs / 1000); }
    p.onProgress((pr) => { if (this.cur === cur) { cur.posMs = pr.currentTimeSec * 1000; if (pr.durationSec && !cur.guessLen) cur.lengthMs = pr.durationSec * 1000; } });
    p.onEnded(() => { if (this.cur === cur) { if (this.loop) { p.seek(0); p.play(); } else this.songEnded(); } });
    // per voice taps -> levels and scopes
    const nv = fmt === 'psid' ? 9 : fmt === 'ay' ? (inf.turboSound ? 6 : 3) : fmt === 'sndh' ? 3 : 3;
    if (p.onChannels) {
      p.onChannels((buf, frames) => {
        if (this.cur !== cur) return;
        const n = Math.round(buf.length / frames) || nv;
        if (!cur.info.channels) { cur.info.channels = n; cur.l = new Uint8Array(n); cur.r = cur.l; cur.fr = new Uint16Array(n); cur.voiceNames = Array.from({ length: n }, (_, i) => fmt === 'psid' ? `SID${(i / 3 | 0) + 1} voice ${i % 3 + 1}` : `Channel ${'ABCDEF'[i]}`); this.emit('channels', cur); }
        for (let v = 0; v < n; v++) {
          let s = 0, zc = 0, prev = 0;
          for (let f = 0; f < frames; f++) { const x = buf[f * n + v]; s += x * x; if ((x >= 0) !== (prev >= 0)) zc++; prev = x; }
          const lv = Math.min(255, Math.sqrt(s / frames) * 4 * 255);
          cur.l[v] = Math.max(lv, cur.l[v] * 0.85);
          cur.fr[v] = lv > 6 ? Math.round(zc / 2 * this.ctx.sampleRate / frames) : 0;
        }
        cur.voiceBuf = buf; cur.voiceFrames = frames; cur.voiceN = n;
      });
    }
    return cur;
  }

  // ---- PCM ----
  async decodePcm(name, data) {
    const dec = PCM_EXTS[ext(name)] || 'native';
    const order = dec === 'native' ? ['native'] : dec === 'aac' ? ['native', 'aac'] : [dec, 'native'];
    let err;
    for (const d of order) {
      try {
        if (d === 'native') return await this.ctx.decodeAudioData(data.slice().buffer);
        let r;
        if (d === 'mpg123') {
          const m = await importAsset('dec-mpg123');
          const D = new m.MPEGDecoder(); await D.ready; r = D.decode(data); D.free();
        } else if (d === 'speex') {
          const m = await importAsset('dec-speex'); r = await m.default(data, await asset('speex'));
        } else {
          const m = await importAsset('dec-' + d); r = await m.default(data);
        }
        if (!r || !r.channelData || !r.channelData.length || !r.channelData[0].length) throw new Error('decoder returned no audio');
        const nc = Math.min(2, r.channelData.length);
        const buf = this.ctx.createBuffer(nc, r.channelData[0].length, r.sampleRate);
        for (let c = 0; c < nc; c++) buf.copyToChannel(r.channelData[c] instanceof Float32Array ? r.channelData[c] : Float32Array.from(r.channelData[c]), c);
        if (r.channelData.length > 2) { // fold surround channels in: center + LFE to both
          const L = buf.getChannelData(0), R = buf.getChannelData(1), C = r.channelData[2];
          for (let i = 0; i < L.length; i++) { L[i] = (L[i] + C[i] * 0.707) * 0.7; R[i] = (R[i] + C[i] * 0.707) * 0.7; }
        }
        return buf;
      } catch (e) { err = e; }
    }
    throw err || new Error('cannot decode');
  }

  async loadPcm(item, data) {
    const buf = await this.decodePcm(item.name, data);
    this.pcmBuf = buf;
    const tags = readTags(data);
    const start = item.cue ? item.cue.start : 0;
    const end = item.cue && item.cue.end != null ? item.cue.end : buf.duration * 1000;
    const info = {
      engine: 'Web Audio', type: (ext(item.name) || 'audio').toUpperCase() + ' audio', title: item.title || tags.title || '', author: item.artist || tags.artist || '',
      album: tags.album || '', date: tags.date || '', desc: tags.comment || '', songs: 1, channels: 2,
      rate: buf.sampleRate, srcChannels: buf.numberOfChannels, canMute: true, canSeek: true, voices: ['Left', 'Right'],
    };
    this.pcmOffset = 0; this.pcmStart = start; this.pcmEnd = end; this.pcmMute = [false, false];
    return { info, kind: 'pcm', lengthMs: end - start, l: new Uint8Array(2), r: new Uint8Array(2), fr: new Uint16Array(2) };
  }
  pcmStop() { if (this.pcmSrc) { this.pcmSrc.onended = null; try { this.pcmSrc.stop(); } catch (e) {} this.pcmSrc.disconnect(); this.pcmSrc = null; } }
  pcmSyncPos() { if (this.pcmSrc) { this.pcmOffset += (this.ctx.currentTime - this.pcmT0) * 1000 * this.pcmSrc.playbackRate.value; this.pcmT0 = this.ctx.currentTime; } }
  pcmPlay() {
    this.pcmStop();
    const cur = this.cur, s = this.ctx.createBufferSource();
    s.buffer = this.pcmBuf; s.playbackRate.value = this.pitch;
    // channel mute via a splitter/merger only when needed
    if (this.pcmMute[0] || this.pcmMute[1]) {
      const sp = this.ctx.createChannelSplitter(2), mg = this.ctx.createChannelMerger(2);
      s.connect(sp); if (!this.pcmMute[0]) sp.connect(mg, 0, 0); if (!this.pcmMute[1]) sp.connect(mg, this.pcmBuf.numberOfChannels > 1 ? 1 : 0, 1);
      mg.connect(this.input);
    } else s.connect(this.input);
    const off = (this.pcmStart + this.pcmOffset) / 1000;
    const dur = Math.max(0, (this.pcmEnd - this.pcmStart - this.pcmOffset) / 1000);
    s.start(0, off, dur);
    this.pcmT0 = this.ctx.currentTime;
    s.onended = () => { if (this.cur === cur && this.pcmSrc === s) { this.pcmSrc = null; if (this.loop) { this.pcmOffset = 0; this.pcmPlay(); } else { this.cur.posMs = this.cur.lengthMs; this.songEnded(); } } };
    this.pcmSrc = s;
  }

  // ---- transport ----
  get playing() { return !!(this.cur && this.cur.playing); }
  play() {
    if (!this.cur) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.cur.playing = true;
    if (this.cur.kind === 'caw') this.caw.play();
    else if (this.cur.kind === 'pcm') this.pcmPlay();
    else this.node.port.postMessage({ t: 'play' });
    this.emit('state');
  }
  pause() {
    if (!this.cur) return;
    this.cur.playing = false;
    if (this.cur.kind === 'caw') this.caw.pause();
    else if (this.cur.kind === 'pcm') { this.pcmSyncPos(); this.pcmStop(); }
    else this.node.port.postMessage({ t: 'pause' });
    this.emit('state');
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  position() {
    const c = this.cur; if (!c) return 0;
    if (c.kind === 'pcm') return this.pcmSrc ? this.pcmOffset + (this.ctx.currentTime - this.pcmT0) * 1000 * this.pcmSrc.playbackRate.value : this.pcmOffset;
    return c.posMs || 0;
  }
  seek(ms) {
    const c = this.cur; if (!c) return;
    ms = Math.max(0, c.lengthMs ? Math.min(ms, c.lengthMs - 50) : ms);
    c.endedFired = false;
    if (c.kind === 'caw') this.caw.seek(ms / 1000);
    else if (c.kind === 'pcm') { this.pcmOffset = ms; if (c.playing) this.pcmPlay(); }
    else this.node.port.postMessage({ t: 'seek', ms });
    c.posMs = ms;
  }
  selectSong(n) {
    const c = this.cur; if (!c || n < 0 || n >= (c.info.songs || 1)) return;
    c.song = n; c.endedFired = false; c.posMs = 0;
    if (c.kind === 'caw') { if (this.caw.selectSong) this.caw.selectSong(n + 1); if (c.playing) this.caw.play(); }
    else this.node.port.postMessage({ t: 'song', n });
    this.emit('loaded', c);
  }
  mute(ch, on) {
    const c = this.cur; if (!c) return;
    c.muted = c.muted || new Set();
    on ? c.muted.add(ch) : c.muted.delete(ch);
    if (c.kind === 'pcm') { this.pcmMute[ch] = on; if (c.playing) { this.pcmSyncPos(); this.pcmPlay(); } }
    else if (c.kind !== 'caw') this.node.port.postMessage({ t: 'mute', ch, on });
  }
  solo(ch) {
    const c = this.cur; if (!c) return;
    const n = c.info.channels || 0;
    const only = c.muted && c.muted.size === n - 1 && !c.muted.has(ch);
    for (let i = 0; i < n; i++) this.mute(i, only ? false : i !== ch);
  }
  requestCells(pat) { this.node && this.node.port.postMessage({ t: 'cells', pat }); }

  // live channel levels for PCM (from the analysers)
  pcmLevels() {
    const c = this.cur; if (!c || c.kind !== 'pcm') return;
    const t = this.tmp || (this.tmp = new Float32Array(2048));
    [this.anL, this.anR].forEach((a, i) => { a.getFloatTimeDomainData(t); let s = 0; for (let k = 0; k < t.length; k++) s += t[k] * t[k]; const lv = Math.min(255, Math.sqrt(s / t.length) * 3 * 255); c.l[i] = lv; c.r[i] = lv; });
  }
}
