// Cubic Player: user interface.
import { AudioCore, EQ_FREQS, EQ_PRESETS } from './audio.js';
import { Views, noteName } from './views.js';
import { Library, kvGet, kvSet, urlFor } from './library.js';
import { ext, dirName, baseName, isPlayable, FORMAT_GROUPS, MPT_EXTS } from './formats.js';
import { asset, hasAsset } from './assets.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (ms) => { if (!isFinite(ms) || ms < 0) ms = 0; const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
const fmt2 = (ms) => { const s = Math.floor(Math.max(0, ms) / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const ls = { get(k, d) { try { const v = localStorage.getItem('cubic.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('cubic.' + k, JSON.stringify(v)); } catch (e) {} } };
const isAndroid = !!window.CubicAndroid;

const S = Object.assign({
  theme: 'vga', scan: true, glow: true, view: 'channels', side: 'playlist', repeat: 'off', shuffle: false, allSubsongs: true,
  defaultLen: 180, stereo: 100, interp: 8, amiga: false, bank: 58, vol: 100, bal: 0, wid: 100, pit: 100, tem: 100, persist: true, mixerOpen: window.innerWidth > 1000, eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], eqOn: true, eqPreset: 'Flat', anMode: 'bars',
  onlineUrl: 'https://ftp.modland.com/pub/modules/',
}, ls.get('settings', {}));
const save = () => ls.set('settings', S);

const audio = new AudioCore();
const lib = new Library();
let views, theme;
let pi = -1;                 // playlist index playing
let failStreak = 0;
let midiBanks = ls.get('banks', null);
const icons = {
  play: '<path d="M7 4v16l13-8z"/>', pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  playS: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  shuf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

// ---------- theme ----------
function readTheme() {
  const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue('--' + n).trim();
  const hex = (c) => { const d = document.createElement('canvas').getContext('2d'); d.fillStyle = c; return d.fillStyle; };
  const rgb = (c) => { const h = hex(c).replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((c, i) => Math.round(c + (y[i] - c) * t)).join(',')})`; };
  const bg = v('bg'), acc = v('accent');
  const T = {
    bg, panel: v('panel'), fg: v('fg'), hi: v('hi'), dim: v('dim'), faint: v('faint'), line: v('line'),
    cyan: v('cyan'), magenta: v('magenta'), yellow: v('yellow'), green: v('green'), red: v('red'), blue: v('blue'),
    off: mix(bg, v('line2'), 0.55), stripe: mix(bg, v('panel2'), 0.7), hilite: mix(bg, acc, 0.16),
    fadeBg: `rgba(${rgb(bg).join(',')},0.32)`, keyWhite: mix(bg, v('fg'), 0.75), keyBlack: mix(bg, v('panel2'), 0.5),
    glow: S.glow,
  };
  T.chan = [T.cyan, T.green, T.yellow, T.magenta, T.red, T.blue, T.hi, v('amber') || T.yellow];
  const b = rgb(bg), a1 = rgb(v('blue')), a2 = rgb(acc), a3 = rgb(v('yellow'));
  T.heat = [[0, ...b], [0.35, ...a1], [0.6, ...a2], [0.85, ...a3], [1, 255, 255, 255]];
  return T;
}
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  document.body.classList.toggle('scan', S.scan);
  document.body.classList.toggle('glow', S.glow);
  theme = readTheme();
  if (views) views.theme = theme;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = theme.bg;
}

// ---------- toast / progress ----------
let toastT;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast' + (err ? ' err' : ''), err ? 4200 : 2400); }
function progress(f) { $('#progress').style.width = f == null ? '0' : Math.round(f * 100) + '%'; }

// ---------- playback ----------
function entryTitle(e) {
  const r = lib.byId.get(e.id);
  return e.title || (r ? r.name : '?');
}
async function playIndex(i, opts = {}) {
  if (i < 0 || i >= lib.playlist.length) return;
  pi = i;
  const e = lib.playlist[i], rec = lib.byId.get(e.id);
  renderSide();
  if (!rec) return;
  try {
    $('#title').textContent = entryTitle(e);
    $('#sub').textContent = 'loading…';
    const data = await lib.bytes(rec);
    const cur = await audio.load({ id: rec.id, name: rec.path, data, cue: e.cue, title: e.title, artist: e.artist, siblings: () => lib.siblingData(rec) }, { subsong: opts.subsong ?? e.sub ?? null, autoplay: opts.autoplay !== false });
    if (!cur) return;
    failStreak = 0;
    if (!e.title && cur.info.title && cur.info.title.trim()) e.ttl = cur.info.title.trim();
    e.dur = cur.lengthMs; e.type = shortType(cur);
    lib.savePlaylist();
    renderSide();
  } catch (err) {
    console.error(err);
    toast(`${rec.name}: ${err.message}`, true);
    $('#sub').textContent = 'could not play this file';
    failStreak++;
    if (failStreak < Math.min(lib.playlist.length, 8) && lib.playlist.length > 1) setTimeout(() => next(true), 900);
  }
}
function shortType(cur) {
  const t = cur.info.type || '';
  if (cur.kind === 'mpt') return (ext(cur.item.name) || t).toUpperCase().slice(0, 6);
  return (ext(cur.item.name) || cur.kind).toUpperCase().slice(0, 6);
}
function next(auto) {
  const n = lib.playlist.length; if (!n) return;
  if (S.shuffle) { let j = Math.floor(Math.random() * n); if (n > 1 && j === pi) j = (j + 1) % n; return playIndex(j); }
  if (pi + 1 < n) return playIndex(pi + 1);
  if (S.repeat === 'all' || !auto) return playIndex(0);
  audio.pause();
}
function prev() {
  if (audio.cur && audio.position() > 3000) { audio.seek(0); return; }
  const n = lib.playlist.length; if (!n) return;
  playIndex(pi > 0 ? pi - 1 : n - 1);
}
audio.on('ended', (cur) => {
  if (S.allSubsongs && cur.info.songs > 1 && cur.song + 1 < cur.info.songs) { audio.selectSong(cur.song + 1); return; }
  next(true);
});
audio.on('loaded', (cur) => { views && views.resetSong(); updateStatic(); renderInfo(); mediaMeta(); });
audio.on('channels', () => renderInfo());
audio.on('state', () => { updatePlayIcon(); androidState(); });
audio.on('error', (m) => toast(m, true));

async function togglePlay() {
  if (!audio.cur) { if (lib.playlist.length) await playIndex(pi >= 0 ? pi : 0); else if (hasAsset('demo')) playDemo(); else $('#fileIn').click(); return; }
  audio.toggle();
}
function updatePlayIcon() { $('#playIcon').innerHTML = audio.playing ? icons.pause : icons.play; $('#bPlay').setAttribute('aria-label', audio.playing ? 'Pause' : 'Play'); }

async function playDemo() {
  const data = await asset('demo');
  let rec = lib.files.find(f => f.path === 'Cubic demo/cubic-demo.mid');
  if (!rec) [rec] = await lib.importFiles([{ file: new File([data], 'cubic-demo.mid'), path: 'Cubic demo/cubic-demo.mid' }]);
  let i = lib.playlist.findIndex(e => e.id === rec.id);
  if (i < 0) { lib.playlist.push({ id: rec.id }); i = lib.playlist.length - 1; lib.savePlaylist(); }
  playIndex(i);
}

// ---------- status ----------
function setSlider(el, v) { el.value = v; const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }
function updateStatic() {
  const c = audio.cur;
  if (!c) { $('#title').textContent = 'Cubic Player'; $('#sub').innerHTML = 'Tracker modules · chiptunes · AdLib · MIDI · audio'; $('#fields').innerHTML = ''; return; }
  const e = lib.playlist[pi];
  const t = (e && e.title) || (c.info.title && c.info.title.trim()) || baseName(c.item.name);
  $('#title').textContent = t;
  const bits = [];
  if (c.info.author) bits.push(`<b>${esc(c.info.author)}</b>`);
  if (c.info.game) bits.push(esc(c.info.game));
  if (c.info.album) bits.push(esc(c.info.album));
  bits.push(esc(c.info.type || ''));
  if (t !== baseName(c.item.name)) bits.push(esc(baseName(c.item.name)));
  $('#sub').innerHTML = bits.filter(Boolean).join(' · ');
  const songs = c.info.songs || 1;
  $('#songsel').style.display = songs > 1 ? '' : 'none';
  $('#songN').textContent = `${c.song + 1} / ${songs}`;
  document.title = `${t} · Cubic Player`;
  $('#tLen').textContent = fmt(c.lengthMs);
}
let lastFields = '';
function updateFields() {
  const c = audio.cur; if (!c) return;
  const st = c.st || {}, f = [];
  const add = (k, v, opt) => f.push(`<span class="f${opt ? ' opt' : ''}"><i>${k}</i><b>${esc(v)}</b></span>`);
  add('engine', c.kind === 'mpt' ? 'libopenmpt' : c.engineName === 'MIDI' ? (c.info.engine || 'MIDI') : c.engineName);
  if (c.info.songs > 1) add('song', `${c.song + 1}/${c.info.songs}`);
  if (st.order != null && (c.info.orders || c.kind === 'mpt')) add('order', `${String(st.order).padStart(3, '0')}/${String(c.info.orders || 0).padStart(3, '0')}`);
  if (st.pattern != null && c.kind === 'mpt') add('pat', String(st.pattern).padStart(3, '0'), true);
  if (st.row != null) add('row', String(st.row).padStart(2, '0'));
  if (st.speed) add('speed', st.tempo ? `${st.speed}/${st.tempo}` : st.speed);
  if (st.bpm) add('bpm', st.bpm, true);
  const n = c.info.channels || 0;
  if (n) add('chan', st.active != null ? `${st.active}/${n}` : n);
  if (c.info.bank) add('bank', c.info.bank.slice(0, 22), true);
  if (c.info.model) add('sid', c.info.model, true);
  if (c.info.rate) add('rate', (c.info.rate / 1000).toFixed(1) + ' kHz', true);
  if (audio.pitch !== 1) add('pitch', Math.round(audio.pitch * 100) + '%');
  if (audio.tempo !== 1 && c.info.canTempo) add('speed×', Math.round(audio.tempo * 100) + '%');
  if (c.muted && c.muted.size) add('muted', c.muted.size);
  const html = f.join('');
  if (html !== lastFields) { $('#fields').innerHTML = html; lastFields = html; }
}

// master peak meters
const meter = { l: 0, r: 0, pl: 0, pr: 0, tl: 0, tr: 0 };
function drawMeters() {
  if (!views || !views.td) return;
  const now = performance.now();
  let l = 0, r = 0; for (let i = 0; i < views.td.length; i++) { l = Math.max(l, Math.abs(views.td[i])); r = Math.max(r, Math.abs(views.tdR[i])); }
  meter.l = Math.max(l, meter.l * 0.88); meter.r = Math.max(r, meter.r * 0.88);
  if (meter.l >= meter.pl || now - meter.tl > 1200) { meter.pl = meter.l; meter.tl = now; }
  if (meter.r >= meter.pr || now - meter.tr > 1200) { meter.pr = meter.r; meter.tr = now; }
  [['#mL', meter.l, meter.pl], ['#mR', meter.r, meter.pr]].forEach(([id, v, p]) => {
    const cv = $(id), d = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    const db = (x) => Math.max(0, Math.min(1, (20 * Math.log10(x + 1e-6) + 48) / 48));
    const seg = 5, n = Math.floor(w / seg), lit = Math.round(db(v) * n), pk = Math.round(db(p) * n);
    for (let i = 0; i < n; i++) { const f = i / n; g.fillStyle = i < lit || i === pk - 1 ? (f > 0.88 ? theme.red : f > 0.7 ? theme.yellow : theme.green) : theme.off; g.fillRect(i * seg, 0, seg - 1, h); }
  });
}

let seeking = false, lastStat = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (S.view !== 'info' && document.visibilityState === 'visible') views.draw();
  else if (audio.anL && views.td) { audio.anL.getFloatTimeDomainData(views.td); audio.anR.getFloatTimeDomainData(views.tdR); if (views.fft) audio.anF.getByteFrequencyData(views.fft); }
  drawMeters();
  if (views.fft) views.drawMini($('#mS'));
  if (now - lastStat > 120) {
    lastStat = now;
    const c = audio.cur;
    if (c) {
      const pos = audio.position();
      $('#time').innerHTML = `${fmt2(pos)}<span> / ${fmt2(c.lengthMs)}</span>`;
      $('#tPos').textContent = fmt(pos);
      if (!seeking) setSlider($('#seek'), c.lengthMs ? Math.min(1000, pos / c.lengthMs * 1000) : 0);
      updateFields();
      if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && c.lengthMs && now - (frame.mp || 0) > 2000) { frame.mp = now; try { navigator.mediaSession.setPositionState({ duration: c.lengthMs / 1000, position: Math.min(c.lengthMs, pos) / 1000, playbackRate: 1 }); } catch (e) {} }
    }
  }
}

// ---------- info view ----------
function renderInfo() {
  const el = $('#infoView'), c = audio.cur;
  if (!c) { el.innerHTML = `<h3>No song loaded</h3><p>Open files, a folder or an archive. Press <kbd>?</kbd> for keys and the list of formats.</p>`; return; }
  const i = c.info, rows = [];
  const kv = (k, v) => { if (v != null && v !== '' && v !== 0) rows.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`); };
  kv('Title', i.title); kv('Author', i.author); kv('Game', i.game); kv('Album', i.album); kv('Date', i.date); kv('Copyright', i.copyright); kv('Dumper', i.dumper);
  kv('Format', i.type); kv('Container', i.container); kv('Tracker', i.tracker); kv('Engine', i.engine || c.engineName);
  kv('File', c.item.name); kv('Length', c.lengthMs ? fmt(c.lengthMs) + (c.guessLen ? ' (default; length unknown)' : '') : 'unknown');
  kv('Subsongs', i.songs > 1 ? i.songs : ''); kv('Channels', i.channels); kv('Orders', i.orders); kv('Patterns', i.patterns);
  kv('Sample rate', i.rate ? i.rate + ' Hz' : ''); kv('SID model', i.model); kv('MIDI bank', i.bank);
  let h = `<h3>${esc(i.title || baseName(c.item.name))}</h3><dl class="kv">${rows.join('')}</dl>`;
  if (i.songNames && i.songNames.some(Boolean)) h += `<h3>Subsongs</h3><ol class="ilist">${i.songNames.map((s, k) => `<li><b>${k + 1}</b>${esc(s || '—')}</li>`).join('')}</ol>`;
  if (i.desc) h += `<h3>Message</h3><div class="msg">${esc(i.desc)}</div>`;
  const list = (name, arr) => { if (arr && arr.some(s => s && s.trim())) h += `<h3>${name}</h3><ol class="ilist">${arr.map((s, k) => `<li><b>${String(k + 1).padStart(2, '0')}</b>${esc(s) || '&nbsp;'}</li>`).join('')}</ol>`; };
  list('Instruments', i.instruments); list('Samples', i.samples); list('Voices', i.voices || c.voiceNames); list('Channel names', i.channelNames);
  el.innerHTML = h;
}

// ---------- views ----------
function setView(v) {
  S.view = v; save();
  $$('#vtabs .tab').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#infoView').classList.toggle('show', v === 'info');
  $('#cv').style.display = v === 'info' ? 'none' : '';
  if (views) views.view = v;
  if (v === 'info') renderInfo();
  $('#eqbar').hidden = v !== 'eq';
  if (window.innerWidth <= 820) setMob('player');
}

// ---------- side panel ----------
const collapsed = new Set(ls.get('collapsed', []));
let libFilter = '', online = { url: S.onlineUrl, items: [], loading: false, error: '' };
function setSide(s) { S.side = s; save(); $$('#stabs .tab').forEach(b => b.classList.toggle('on', b.dataset.s === s)); renderSide(true); }
function renderSide(tools) {
  $('#plCount').textContent = lib.playlist.length;
  if (tools) renderTools();
  if (S.side === 'playlist') renderPlaylist();
  else if (S.side === 'library') renderLibrary();
  else renderOnline();
}
function renderTools() {
  const t = $('#tools');
  if (S.side === 'playlist') t.innerHTML = `<button class="btn" id="tShuf" title="Shuffle the order">${icons.shuf}<span>Shuffle list</span></button><button class="btn" id="tClear" title="Clear the playlist">${icons.trash}<span>Clear</span></button>`;
  else if (S.side === 'library') t.innerHTML = `<input type="search" id="tSearch" placeholder="Search ${lib.files.length} files" value="${esc(libFilter)}" aria-label="Search library"><button class="ib" id="tAddAll" title="Add everything shown to the playlist">${icons.plus}</button>`;
  else t.innerHTML = `<button class="ib" id="tUp" title="Up one folder">${icons.up}</button><input type="url" id="tUrl" value="${esc(online.url)}" aria-label="Address"><button class="btn" id="tGo">Go</button>`;
}
function rowHtml(i, e, isCur) {
  const r = lib.byId.get(e.id), name = e.title || e.ttl || (r ? r.name : '?');
  const sub = e.title ? (e.artist || (r && r.name)) : (e.ttl ? r && r.name : (r ? dirName(r.path) : ''));
  return `<div class="row${isCur ? ' cur' : ''}" data-i="${i}" draggable="true"><span class="n">${isCur && audio.playing ? '▶' : i + 1}</span><span class="t">${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="d">${e.type ? `<span class="tag">${esc(e.type)}</span>` : ''}${e.dur ? ' ' + fmt(e.dur) : ''}<button class="ib x" data-del="${i}" title="Remove" aria-label="Remove">${icons.x}</button></span></div>`;
}
function renderPlaylist() {
  const L = $('#list');
  if (!lib.playlist.length) {
    L.innerHTML = `<div class="empty"><span class="disp">PLAYLIST IS EMPTY</span>Drop files, folders or archives anywhere, or<br><button class="btn pri" data-act="open">${icons.plus} Open files</button><button class="btn" data-act="folder">Open a folder</button>${hasAsset('demo') ? `<br><button class="btn" data-act="demo">${icons.playS} Play the demo tune</button>` : ''}<p style="font-size:11px">Over 200 formats: MOD, XM, IT, S3M, HVL, SID, NSF, SPC, VGM, AdLib, MIDI, MP3, FLAC…</p></div>`;
    return;
  }
  L.innerHTML = lib.playlist.map((e, i) => rowHtml(i, e, i === pi)).join('');
  const c = L.querySelector('.row.cur'); if (c && !renderPlaylist.noScroll) c.scrollIntoView({ block: 'nearest' });
}
function renderLibrary() {
  const L = $('#list');
  if (!lib.files.length) { L.innerHTML = `<div class="empty"><span class="disp">LIBRARY IS EMPTY</span>Files you open are kept here${S.persist ? ' between sessions' : ''}.<br><button class="btn pri" data-act="open">${icons.plus} Open files</button><button class="btn" data-act="folder">Open a folder</button></div>`; return; }
  const q = libFilter.toLowerCase();
  const groups = new Map();
  for (const f of lib.files) {
    if (q && !f.path.toLowerCase().includes(q)) continue;
    const e = ext(f.name); if (!isPlayable(f.name) && !['cue', 'm3u', 'm3u8', 'pls'].includes(e)) continue;
    const d = dirName(f.path) || '(loose files)';
    if (!groups.has(d)) groups.set(d, []); groups.get(d).push(f);
  }
  const big = lib.files.length > 400 && !q;
  let h = '';
  for (const [d, fs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const closed = q ? false : (collapsed.has(d) || (big && !collapsed.has('+' + d)));
    h += `<div class="folder" data-dir="${esc(d)}">${closed ? '▸' : '▾'} ${icons.folder}<span>${esc(d)}</span><small>${fs.length}</small><button class="ib" data-fplay="${esc(d)}" title="Play folder">${icons.playS}</button><button class="ib" data-fadd="${esc(d)}" title="Add folder to playlist">${icons.plus}</button><button class="ib" data-fdel="${esc(d)}" title="Remove folder from library">${icons.trash}</button></div>`;
    if (closed) continue;
    fs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const f of fs) h += `<div class="row" data-f="${f.id}"><span class="n">${icons.file}</span><span class="t">${esc(f.name)}<small>${f.size ? (f.size / 1024).toFixed(f.size < 10240 ? 1 : 0) + ' KB' : f.uri ? 'remote' : ''}</small></span><span class="d"><span class="tag">${esc(ext(f.name))}</span><button class="ib x" data-fq="${f.id}" title="Add to playlist" aria-label="Add">${icons.plus}</button></span></div>`;
  }
  L.innerHTML = h || `<div class="empty">Nothing matches “${esc(libFilter)}”.</div>`;
}
function renderOnline() {
  const L = $('#list');
  if (online.loading) { L.innerHTML = `<div class="empty"><span class="disp">LOADING…</span>${esc(online.url)}</div>`; return; }
  if (online.error) { L.innerHTML = `<div class="empty"><span class="disp">CANNOT OPEN</span>${esc(online.error)}<p style="font-size:11px">${isAndroid ? '' : 'Browsers only allow reading sites that permit it (CORS). Many archives, including Modland, do not; the Android app has no such limit.'}</p></div>`; return; }
  if (!online.items.length) { L.innerHTML = `<div class="empty"><span class="disp">ONLINE</span>Browse a web or FTP-over-HTTP directory listing, such as Modland, or paste the address of a single music file or ZIP.<br><button class="btn pri" data-act="go">Open ${esc(online.url)}</button></div>`; return; }
  L.innerHTML = online.items.map((it, i) => `<div class="row" data-o="${i}"><span class="n">${it.dir ? icons.folder : icons.file}</span><span class="t">${esc(it.name)}${it.info ? `<small>${esc(it.info)}</small>` : ''}</span><span class="d">${it.dir ? '' : `<button class="ib x" data-oq="${i}" title="Add to playlist">${icons.plus}</button>`}</span></div>`).join('');
}

async function browse(url) {
  online.url = url; S.onlineUrl = url; save();
  online.loading = true; online.error = ''; renderTools(); renderOnline();
  try {
    const r = await fetch(urlFor({ uri: url }));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = r.headers.get('content-type') || '';
    if (!/html|text/.test(ct) && isPlayable(url)) { online.loading = false; await addUrls([url], true); online.items = []; renderOnline(); return; }
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const base = url.endsWith('/') ? url : url + '/';
    const seen = new Set(), items = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href'); if (!href || href.startsWith('?') || href.startsWith('#') || href.startsWith('javascript:')) continue;
      let abs; try { abs = new URL(href, base).href; } catch (e) { continue; }
      if (!abs.startsWith(base) || abs === base || seen.has(abs)) continue;
      seen.add(abs);
      const dir = abs.endsWith('/'); const name = decodeURIComponent(abs.slice(base.length).replace(/\/$/, ''));
      if (name.includes('/')) continue;
      if (!dir && !isPlayable(name) && !/\.(zip|gz|tgz|lha|7z)$/i.test(name)) continue;
      const tr = a.closest('tr'); const info = tr ? [...tr.cells].slice(1).map(c => c.textContent.trim()).filter(t => t && t !== '-').join(' · ') : '';
      items.push({ name, url: abs, dir, info: info.slice(0, 60) });
    }
    items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    online.items = items;
    if (!items.length) online.error = 'No folders or playable files found on this page.';
  } catch (e) { online.error = e.message === 'Failed to fetch' ? 'The site could not be reached or does not allow access from a web page.' : e.message; online.items = []; }
  online.loading = false; renderOnline();
}
async function addUrls(urls, play) {
  const refs = urls.map(u => ({ path: 'Online/' + decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).slice(-2).join('/')), uri: u }));
  // archives must be downloaded and unpacked now
  const added = [];
  for (const r of refs) {
    if (/\.(zip|gz|tgz|tar)$/i.test(r.path)) {
      try { progress(0.3); const b = await fetch(urlFor(r)).then(x => { if (!x.ok) throw new Error('HTTP ' + x.status); return x.blob(); }); added.push(...await lib.importFiles([{ file: new File([b], baseName(r.path)), path: r.path }])); }
      catch (e) { toast(e.message, true); } finally { progress(null); }
    } else added.push(...await lib.importRefs([r]));
  }
  await queue(added, play);
}

async function queue(recs, play) {
  const start = lib.playlist.length;
  for (const r of recs) for (const e of await lib.entriesFor(r)) lib.playlist.push(e);
  lib.savePlaylist();
  renderSide();
  if (play && lib.playlist.length > start) playIndex(start);
  else if (lib.playlist.length > start) toast(`${lib.playlist.length - start} added to the playlist`);
}

// ---------- importing ----------
async function importList(list, playFirst = true) {
  if (!list.length) return;
  try {
    lib.persist = S.persist;
    progress(0.02);
    const added = await lib.importFiles(list, (i, n) => progress(i / n));
    progress(null);
    const sf = added.find(r => ext(r.name) === 'sf2');
    if (sf) { await loadSoundfont(await lib.bytes(sf)); }
    const playable = added.filter(r => isPlayable(r.name) || ['cue', 'm3u', 'm3u8', 'pls'].includes(ext(r.name)));
    // a CUE sheet replaces the audio file it describes
    const cueTargets = new Set();
    for (const c of playable.filter(r => ext(r.name) === 'cue')) for (const e of await lib.entriesFor(c)) cueTargets.add(e.id);
    const lists = playable.filter(r => ['m3u', 'm3u8', 'pls'].includes(ext(r.name)));
    const recs = (lists.length ? lists.concat(playable.filter(r => ext(r.name) === 'cue')) : playable).filter(r => !cueTargets.has(r.id));
    recs.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    if (!recs.length) { toast(sf ? 'SoundFont loaded for MIDI playback' : 'No playable files found', !sf); renderSide(true); return; }
    const wasEmpty = !audio.cur;
    await queue(recs, playFirst && (wasEmpty || !audio.playing));
    renderTools();
  } catch (e) { progress(null); toast(e.message, true); console.error(e); }
}
function filesFromInput(input) { return [...input.files].map(f => ({ file: f, path: f.webkitRelativePath || f.name })); }
async function filesFromDrop(dt) {
  const out = [], items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files].map(f => ({ file: f, path: f.name }));
  const walk = async (entry, path) => {
    if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file: f, path: path + f.name }); }
    else if (entry.isDirectory) {
      const rd = entry.createReader(); let batch;
      do { batch = await new Promise((res, rej) => rd.readEntries(res, rej)); for (const e of batch) await walk(e, path + entry.name + '/'); } while (batch.length);
    }
  };
  for (const e of items) await walk(e, '');
  return out;
}
async function loadSoundfont(bytes) {
  audio.soundfont = bytes; await kvSet('soundfont', new Blob([bytes]));
  toast('SoundFont loaded: MIDI files now use it');
}

// ---------- settings & help ----------
function seg(name, opts, val) { return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`; }
function renderSettings() {
  const banks = midiBanks ? midiBanks.map((b, i) => `<option value="${i}" ${i === S.bank ? 'selected' : ''}>${i}: ${esc(b)}</option>`).join('') : '';
  $('#settingsBody').innerHTML = `<div class="set">
  <h4>Display</h4>
  <label>Theme</label>${seg('theme', [['vga', 'VGA'], ['dos', 'DOS blue'], ['amber', 'Amber'], ['phosphor', 'Phosphor']], S.theme)}
  <label>CRT scanlines</label>${seg('scan', [[1, 'On'], [0, 'Off']], S.scan ? 1 : 0)}
  <label>Glow</label>${seg('glow', [[1, 'On'], [0, 'Off']], S.glow ? 1 : 0)}
  <h4>Playback</h4>
  <label>Play all subsongs<small>Before moving to the next file</small></label>${seg('allSubsongs', [[1, 'Yes'], [0, 'No']], S.allSubsongs ? 1 : 0)}
  <label>Default song length<small>For SID, MIDI and other tunes that never end</small></label><input type="number" id="sLen" min="10" max="3600" value="${S.defaultLen}">
  <label>Stereo separation<small>Tracker modules: 0 = mono, 100 = default, 200 = wide</small></label><input type="range" id="sSep" min="0" max="200" value="${S.stereo}">
  <label>Interpolation<small>Tracker modules</small></label><select id="sInt"><option value="1">None (nearest)</option><option value="2">Linear</option><option value="4">Cubic</option><option value="8">Windowed sinc, 8 taps</option></select>
  <label>Amiga resampler<small>Emulates Paula filtering for Amiga modules</small></label>${seg('amiga', [[1, 'On'], [0, 'Off']], S.amiga ? 1 : 0)}
  <h4>MIDI</h4>
  <label>FM bank<small>libADLMIDI OPL3 instrument bank</small></label>${banks ? `<select id="sBank">${banks}</select>` : `<input type="number" id="sBank" min="0" max="80" value="${S.bank}">`}
  <label>SoundFont<small>${audio.soundfont ? 'Loaded: MIDI uses the SoundFont' : 'Load an SF2 file to use samples instead of FM'}</small></label><div>${audio.soundfont ? '<button class="btn" id="sSfClear">Use FM again</button>' : '<button class="btn" id="sSf">Load SF2…</button>'}</div>
  <h4>Library</h4>
  <label>Remember files<small>Keep opened files in this ${isAndroid ? 'app' : 'browser'} between sessions</small></label>${seg('persist', [[1, 'Yes'], [0, 'No']], S.persist ? 1 : 0)}
  <label>Stored files<small id="sStore">${lib.files.length} files</small></label><div><button class="btn" id="sClearLib">Clear library</button></div>
  </div>`;
  $('#sInt').value = String(S.interp);
  setSlider($('#sSep'), S.stereo);
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { const el = $('#sStore'); if (el) el.textContent = `${lib.files.length} files · ${(e.usage / 1048576).toFixed(1)} MB used`; }).catch(() => {});
}
function renderHelp() {
  const keys = [
    ['Space', 'Play / pause'], ['Enter', 'Next file'], ['Backspace', 'Previous file'], ['← →', 'Seek 5 s (Shift: 30 s)'],
    [', .', 'Previous / next subsong'], ['+ −', 'Volume (also F2 / F3)'], ['F5 F6', 'Panning'], ['F7 F8', 'Balance'], ['F9 F10', 'Speed'], ['F11 F12', 'Pitch'],
    ['1 … 0', 'Mute channel 1–10 (Shift: solo)'], ['C T A E O B N W I', 'Channels, Tracks, Analyzer (A again: next style), Equalizer, Scopes, Phase, Note dots, Würfel, Info'],
    ['L', 'Repeat mode'], ['S', 'Shuffle'], ['F', 'Full-screen visuals'], ['?', 'This help'],
  ];
  $('#helpBody').innerHTML = `
    <p>Cubic is a modern take on <b>Open Cubic Player</b>: the same idea of a text-mode music player with channel meters, track views and analyzers, with a refreshed look. Everything runs locally; nothing is uploaded.</p>
    <h3 class="disp" style="font-size:22px;color:var(--accent);font-weight:normal">KEYS</h3>
    <div class="keys">${keys.map(([k, v]) => `<div>${k.split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join('')}</div><div>${esc(v)}</div>`).join('')}</div>
    <p style="color:var(--dim);font-size:12px">Channels view: click a channel to mute it, double-click (or long-press) to solo. Tracks view: drag sideways to see more channels. Equalizer: drag a slider, scroll over it, or double-click it to reset; it changes the sound of every engine. Analyzer: tap to switch between LED bars, mirror, curve and radial.</p>
    <h3 class="disp" style="font-size:22px;color:var(--accent);font-weight:normal">FORMATS</h3>
    <dl class="fmt">${FORMAT_GROUPS.map(([g, l]) => `<dt>${esc(g)}</dt><dd>${esc(l)}</dd>`).join('')}</dl>
    <h3 class="disp" style="font-size:22px;color:var(--accent);font-weight:normal">ENGINES &amp; LICENCES</h3>
    <p style="font-size:12px">libopenmpt${audio.mptVersion ? ' ' + esc(audio.mptVersion) : ''} (BSD) via chiptune3 (MIT) · AdPlug (LGPL 2.1) with Nuked OPL3 · Game Music Emu (LGPL 2.1) · HivelyTracker replayer (BSD) · libADLMIDI (LGPL 2.1) · TinySoundFont (MIT) · cawtooth (GPL 3) with libsidplayfp/reSID, Ayumi, Hatari-derived SNDH and AY emulation · libspeex (BSD) · mpg123 decoder (LGPL 2.1) · @audio decoders for QOA, WavPack, TTA, APE, Musepack, WMA, AAC/ALAC, AIFF, CAF, DSD, AC-3 (various open licences) · fflate (MIT) · VT323 and JetBrains Mono fonts (OFL). Cubic itself is GPL 3.</p>`;
}

// ---------- media session & android ----------
function mediaMeta() {
  const c = audio.cur; if (!c) return;
  const title = $('#title').textContent;
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: c.info.author || '', album: c.info.game || c.info.album || c.info.type || 'Cubic Player' });
    } catch (e) {}
  }
  androidState();
}
function androidState() {
  if (!isAndroid) return;
  try { window.CubicAndroid.setPlaying(audio.playing, $('#title').textContent, audio.cur ? (audio.cur.info.author || audio.cur.info.type || '') : ''); } catch (e) {}
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession, h = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) {} };
  h('play', () => audio.play()); h('pause', () => audio.pause()); h('nexttrack', () => next()); h('previoustrack', () => prev());
  h('seekto', (d) => audio.seek(d.seekTime * 1000)); h('seekforward', () => audio.seek(audio.position() + 10000)); h('seekbackward', () => audio.seek(audio.position() - 10000));
}
window.__androidFolder = async (json) => {
  try {
    const refs = JSON.parse(json);
    if (!refs.length) { toast('No files found in that folder'); return; }
    const added = await lib.importRefs(refs);
    const play = added.filter(r => isPlayable(r.name) || ext(r.name) === 'cue').sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    await queue(play, !audio.playing);
    renderTools();
  } catch (e) { toast(e.message, true); }
};
window.__androidMedia = (a) => { if (a === 'toggle') togglePlay(); else if (a === 'next') next(); else if (a === 'prev') prev(); else if (a === 'pause') audio.pause(); };
window.__terug = () => {
  const open = $('dialog[open]'); if (open) { open.close(); return true; }
  if (document.fullscreenElement) { document.exitFullscreen(); return true; }
  if ($('#app').classList.contains('lib')) { setMob('player'); return true; }
  return false;
};

function setMob(m) { $('#app').classList.toggle('lib', m === 'lib'); $$('#mobnav button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); if (m === 'lib') renderSide(true); }

// ---------- mixer ----------
function mixerUI() {
  const map = [['rVol', 'vol', 'vVol', v => v + '%', v => audio.setVolume(v / 100)], ['rBal', 'bal', 'vBal', v => (v > 0 ? 'R' : v < 0 ? 'L' : '') + Math.abs(v), v => audio.setBalance(v / 100)],
    ['rWid', 'wid', 'vWid', v => v, v => audio.setWidth(v / 100)], ['rPit', 'pit', 'vPit', v => v + '%', v => audio.setPitch(v / 100)], ['rTem', 'tem', 'vTem', v => v + '%', v => audio.setTempo(v / 100)]];
  const defaults = { vol: 100, bal: 0, wid: 100, pit: 100, tem: 100 };
  for (const [id, key, out, show, apply] of map) {
    const el = $('#' + id);
    const set = (v) => { S[key] = v; setSlider(el, v); $('#' + out).textContent = show(v); apply(v); save(); };
    el.addEventListener('input', () => set(+el.value));
    el.addEventListener('dblclick', () => set(defaults[key]));
    set(S[key]);
    mixerUI[key] = (d) => set(Math.max(+el.min, Math.min(+el.max, S[key] + d)));
  }
}

// two-step confirmation inside the page (no confirm() dialogs: they are blocked in some hosts)
function armed(el, label, msg) {
  if (el.dataset.armed && Date.now() - +el.dataset.armed < 4000) { delete el.dataset.armed; return true; }
  el.dataset.armed = Date.now();
  if (label) { const old = el.textContent; el.textContent = label; setTimeout(() => { el.textContent = old; }, 4000); }
  if (msg) toast(msg);
  return false;
}

// ---------- equalizer toolbar ----------
let lastEqBand = 0;
function syncEqBar() {
  const sel = $('#eqPreset'); if (!sel) return;
  sel.value = S.eqPreset && EQ_PRESETS[S.eqPreset] ? S.eqPreset : '';
  $$('#eqOn button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === S.eqOn));
}
function eqBar() {
  const el = $('#eqbar');
  el.innerHTML = `<label for="eqPreset">Preset</label><select id="eqPreset"><option value="">Custom</option>${Object.keys(EQ_PRESETS).map(p => `<option>${esc(p)}</option>`).join('')}</select>
    <div class="seg" id="eqOn"><button data-v="1">On</button><button data-v="0">Bypass</button></div>`;
  el.addEventListener('change', (e) => { if (e.target.id === 'eqPreset' && EQ_PRESETS[e.target.value]) { S.eqPreset = e.target.value; audio.setEqAll(EQ_PRESETS[S.eqPreset]); S.eq = audio.eq.slice(); save(); } });
  el.addEventListener('click', (e) => { const b = e.target.closest('#eqOn button'); if (b) { S.eqOn = b.dataset.v === '1'; audio.setEqOn(S.eqOn); save(); syncEqBar(); } });
  syncEqBar();
}

// ---------- events ----------
function bind() {
  $('#bOpen').onclick = () => $('#fileIn').click();
  $('#bFolder').onclick = () => { if (isAndroid && window.CubicAndroid.pickFolder) window.CubicAndroid.pickFolder(); else $('#dirIn').click(); };
  $('#fileIn').onchange = (e) => { importList(filesFromInput(e.target)); e.target.value = ''; };
  $('#dirIn').onchange = (e) => { importList(filesFromInput(e.target)); e.target.value = ''; };
  $('#sfIn').onchange = async (e) => { const f = e.target.files[0]; if (f) { await loadSoundfont(new Uint8Array(await f.arrayBuffer())); renderSettings(); } e.target.value = ''; };
  $('#bPlay').onclick = togglePlay;
  $('#bNext').onclick = () => next();
  $('#bPrev').onclick = prev;
  $('#sPrev').onclick = () => audio.cur && audio.selectSong(audio.cur.song - 1);
  $('#sNext').onclick = () => audio.cur && audio.selectSong(audio.cur.song + 1);
  const repIcon = () => { const b = $('#bLoop'); b.classList.toggle('on', S.repeat !== 'off'); b.title = `Repeat: ${S.repeat === 'off' ? 'off' : S.repeat === 'song' ? 'this song' : 'playlist'} (L)`; b.style.position = 'relative'; b.dataset.mode = S.repeat; b.innerHTML = b.innerHTML.replace(/<b[^>]*>1<\/b>/, '') + (S.repeat === 'song' ? '<b style="position:absolute;font-size:9px;right:4px;bottom:2px">1</b>' : ''); audio.setLoop(S.repeat === 'song'); };
  $('#bLoop').onclick = () => { S.repeat = { off: 'all', all: 'song', song: 'off' }[S.repeat]; save(); repIcon(); toast('Repeat: ' + ({ off: 'off', all: 'playlist', song: 'this song' })[S.repeat]); };
  $('#bShuffle').onclick = () => { S.shuffle = !S.shuffle; save(); $('#bShuffle').classList.toggle('on', S.shuffle); toast('Shuffle ' + (S.shuffle ? 'on' : 'off')); };
  $('#bShuffle').classList.toggle('on', S.shuffle); repIcon();
  $('#bMixer').onclick = () => { S.mixerOpen = !S.mixerOpen; save(); $('#mixer').classList.toggle('open', S.mixerOpen); $('#bMixer').classList.toggle('on', S.mixerOpen); };
  $('#mixer').classList.toggle('open', S.mixerOpen); $('#bMixer').classList.toggle('on', S.mixerOpen);
  const sk = $('#seek');
  sk.addEventListener('input', () => { seeking = true; setSlider(sk, sk.value); if (audio.cur) $('#tPos').textContent = fmt(sk.value / 1000 * audio.cur.lengthMs); });
  sk.addEventListener('change', () => { seeking = false; if (audio.cur && audio.cur.lengthMs) audio.seek(sk.value / 1000 * audio.cur.lengthMs); });
  $$('#vtabs .tab').forEach(b => b.onclick = () => setView(b.dataset.v));
  $$('#stabs .tab').forEach(b => b.onclick = () => setSide(b.dataset.s));
  $$('#mobnav button').forEach(b => b.onclick = () => setMob(b.dataset.m));
  $('#bSettings').onclick = () => { renderSettings(); $('#dSettings').showModal(); };
  $('#bHelp').onclick = () => { renderHelp(); $('#dHelp').showModal(); };
  $$('dialog').forEach(d => { d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); }); });

  // settings events
  $('#settingsBody').addEventListener('click', async (e) => {
    const b = e.target.closest('.seg button');
    if (b) {
      const k = b.parentElement.dataset.seg, v = b.dataset.v;
      if (k === 'theme') { S.theme = v; applyTheme(); }
      else if (k === 'scan') { S.scan = v === '1'; applyTheme(); }
      else if (k === 'glow') { S.glow = v === '1'; applyTheme(); }
      else if (k === 'allSubsongs') S.allSubsongs = v === '1';
      else if (k === 'amiga') { S.amiga = v === '1'; audio.mptOpts.amiga = S.amiga; toast('Applies from the next module'); }
      else if (k === 'persist') { S.persist = v === '1'; lib.persist = S.persist; }
      save(); $$('button', b.parentElement).forEach(x => x.classList.toggle('on', x === b));
      return;
    }
    if (e.target.closest('#sSf')) $('#sfIn').click();
    if (e.target.closest('#sSfClear')) { audio.soundfont = null; await kvSet('soundfont', null); renderSettings(); toast('MIDI uses OPL3 FM again'); }
    if (e.target.closest('#sClearLib')) { if (armed(e.target.closest('#sClearLib'), 'Tap again to clear')) { await audio.stopAll(); pi = -1; await lib.clear(); renderSide(true); updateStatic(); renderSettings(); } }
  });
  $('#settingsBody').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'sLen') { S.defaultLen = Math.max(10, Math.min(3600, +t.value || 180)); audio.defaultLenMs = S.defaultLen * 1000; }
    if (t.id === 'sInt') { S.interp = +t.value; audio.setMpt('interp', S.interp); }
    if (t.id === 'sBank') { S.bank = +t.value; audio.setBank(S.bank); if (audio.cur && audio.cur.kind === 'midi') toast('Bank changes from the next note'); }
    save();
  });
  $('#settingsBody').addEventListener('input', (e) => { if (e.target.id === 'sSep') { S.stereo = +e.target.value; setSlider(e.target, S.stereo); audio.setMpt('stereo', S.stereo); save(); } });

  // side panel events
  const list = $('#list');
  list.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (act) { const a = act.dataset.act; if (a === 'open') $('#fileIn').click(); else if (a === 'folder') $('#bFolder').click(); else if (a === 'demo') playDemo(); else if (a === 'go') browse(online.url); return; }
    const del = e.target.closest('[data-del]');
    if (del) { const i = +del.dataset.del; lib.playlist.splice(i, 1); if (i < pi) pi--; else if (i === pi) pi = -1; lib.savePlaylist(); renderPlaylist.noScroll = true; renderSide(); renderPlaylist.noScroll = false; return; }
    const row = e.target.closest('.row[data-i]');
    if (row) { playIndex(+row.dataset.i); if (window.innerWidth <= 820) setMob('player'); return; }
    const fq = e.target.closest('[data-fq]');
    if (fq) { await queue([lib.byId.get(isNaN(+fq.dataset.fq) ? fq.dataset.fq : +fq.dataset.fq)], false); return; }
    const fr = e.target.closest('.row[data-f]');
    if (fr) { const id = isNaN(+fr.dataset.f) ? fr.dataset.f : +fr.dataset.f; await queue([lib.byId.get(id)], true); return; }
    const fp = e.target.closest('[data-fplay]'), fa = e.target.closest('[data-fadd]'), fd = e.target.closest('[data-fdel]');
    if (fp || fa || fd) {
      const d = (fp || fa || fd).dataset[fp ? 'fplay' : fa ? 'fadd' : 'fdel'];
      const recs = lib.files.filter(f => (dirName(f.path) || '(loose files)') === d).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (fd) { if (armed(fd, '', `Tap again to remove “${d}” (${recs.length} files)`)) { await lib.remove(recs.map(r => r.id)); pi = lib.playlist.findIndex(x => audio.cur && x.id === audio.cur.item.id); renderSide(true); } return; }
      if (fp) { lib.playlist = []; pi = -1; }
      const cueT = new Set(); for (const c of recs.filter(r => ext(r.name) === 'cue')) for (const x of await lib.entriesFor(c)) cueT.add(x.id);
      await queue(recs.filter(r => !cueT.has(r.id) && (isPlayable(r.name) || ext(r.name) === 'cue')), !!fp);
      if (fp && window.innerWidth <= 820) setMob('player');
      return;
    }
    const fo = e.target.closest('.folder');
    if (fo) { const d = fo.dataset.dir; const big = lib.files.length > 400; if (big) { collapsed.has('+' + d) ? collapsed.delete('+' + d) : collapsed.add('+' + d); } else { collapsed.has(d) ? collapsed.delete(d) : collapsed.add(d); } ls.set('collapsed', [...collapsed]); renderLibrary(); return; }
    const oq = e.target.closest('[data-oq]');
    if (oq) { await addUrls([online.items[+oq.dataset.oq].url], false); return; }
    const o = e.target.closest('.row[data-o]');
    if (o) { const it = online.items[+o.dataset.o]; if (it.dir) browse(it.url); else { await addUrls([it.url], true); } }
  });
  // drag to reorder the playlist
  let dragI = null;
  list.addEventListener('dragstart', (e) => { const r = e.target.closest('.row[data-i]'); if (r) { dragI = +r.dataset.i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-cubic', String(dragI)); } });
  list.addEventListener('dragover', (e) => { if (dragI != null) { e.preventDefault(); e.stopPropagation(); } });
  list.addEventListener('drop', (e) => {
    if (dragI == null) return; e.preventDefault(); e.stopPropagation();
    const r = e.target.closest('.row[data-i]'); if (!r) { dragI = null; return; }
    const to = +r.dataset.i, curE = lib.playlist[pi];
    const [m] = lib.playlist.splice(dragI, 1); lib.playlist.splice(to, 0, m); pi = lib.playlist.indexOf(curE);
    dragI = null; lib.savePlaylist(); renderPlaylist.noScroll = true; renderPlaylist(); renderPlaylist.noScroll = false;
  });
  list.addEventListener('dragend', () => { dragI = null; });
  $('#tools').addEventListener('click', (e) => {
    if (e.target.closest('#tShuf')) { const curE = lib.playlist[pi]; for (let i = lib.playlist.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lib.playlist[i], lib.playlist[j]] = [lib.playlist[j], lib.playlist[i]]; } pi = lib.playlist.indexOf(curE); lib.savePlaylist(); renderPlaylist(); }
    if (e.target.closest('#tClear')) { lib.playlist = []; pi = -1; lib.savePlaylist(); renderSide(); }
    if (e.target.closest('#tAddAll')) { const q = libFilter.toLowerCase(); queue(lib.files.filter(f => isPlayable(f.name) && (!q || f.path.toLowerCase().includes(q))).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })), false); }
    if (e.target.closest('#tGo')) browse($('#tUrl').value.trim());
    if (e.target.closest('#tUp')) { const u = new URL(online.url); const p = u.pathname.replace(/[^/]+\/?$/, ''); browse(u.origin + (p || '/')); }
  });
  $('#tools').addEventListener('input', (e) => { if (e.target.id === 'tSearch') { libFilter = e.target.value; clearTimeout(bind.st); bind.st = setTimeout(renderLibrary, 150); } });
  $('#tools').addEventListener('keydown', (e) => { if (e.target.id === 'tUrl' && e.key === 'Enter') browse(e.target.value.trim()); });

  // canvas interaction: mute / solo / scroll
  const cv = $('#cv');
  let tapT = 0, lastCh = -1, press = null, dragX = null, dragOff = 0;
  let eqDrag = null;
  const eqSet = (e) => { const r = cv.getBoundingClientRect(), y = e.clientY - r.top; const db = (eqDrag.sTop + eqDrag.sH / 2 - y) / (eqDrag.sH / 2) * 12; audio.setEq(eqDrag.eq, db); S.eq = audio.eq.slice(); S.eqPreset = ''; syncEqBar(); };
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect(), h = views.hit(e.clientX - r.left, e.clientY - r.top);
    if (views.view === 'eq') {
      if (h && h.eq != null) {
        eqDrag = h; cv.setPointerCapture(e.pointerId); eqSet(e); lastEqBand = h.eq;
      }
      return;
    }
    if (views.view === 'analyzer') return;
    dragX = e.clientX; dragOff = views.chanOffset;
    if (h && audio.cur) press = setTimeout(() => { press = 'solo'; audio.solo(h.ch); }, 550);
  });
  cv.addEventListener('pointermove', (e) => {
    if (eqDrag) { eqSet(e); return; }
    if (dragX != null && views.view === 'tracks' && Math.abs(e.clientX - dragX) > 12) { if (press && press !== 'solo') { clearTimeout(press); press = null; } views.chanOffset = Math.max(0, dragOff - Math.round((e.clientX - dragX) / 60)); }
  });
  cv.addEventListener('pointerup', (e) => {
    if (views.view === 'eq') { if (eqDrag) { eqDrag = null; save(); } return; }
    if (views.view === 'analyzer') { const modes = ['bars', 'mirror', 'line', 'radial']; S.anMode = views.anMode = modes[(modes.indexOf(views.anMode) + 1) % modes.length]; save(); return; }
    const wasDrag = dragX != null && Math.abs(e.clientX - dragX) > 12; dragX = null;
    if (press === 'solo') { press = null; return; }
    if (press) clearTimeout(press); press = null;
    if (wasDrag) return;
    const r = cv.getBoundingClientRect(), h = views.hit(e.clientX - r.left, e.clientY - r.top);
    if (!h || !audio.cur || !audio.cur.info.canMute) { if (h && audio.cur && !audio.cur.info.canMute) toast('This engine has no channel muting'); return; }
    const now = performance.now();
    if (now - tapT < 320 && lastCh === h.ch) { audio.solo(h.ch); tapT = 0; }
    else { audio.mute(h.ch, !(audio.cur.muted && audio.cur.muted.has(h.ch))); tapT = now; lastCh = h.ch; }
  });
  cv.addEventListener('dblclick', (e) => { if (views.view !== 'eq') return; const r = cv.getBoundingClientRect(), h = views.hit(e.clientX - r.left, e.clientY - r.top); if (h && h.eq != null) { audio.setEq(h.eq, 0); S.eq = audio.eq.slice(); S.eqPreset = ''; syncEqBar(); save(); } });
  cv.addEventListener('wheel', (e) => { if (views.view === 'eq') { const r = cv.getBoundingClientRect(), h = views.hit(e.clientX - r.left, e.clientY - r.top); if (h && h.eq != null) { audio.setEq(h.eq, audio.eq[h.eq] - Math.sign(e.deltaY) * 0.5); S.eq = audio.eq.slice(); S.eqPreset = ''; syncEqBar(); save(); e.preventDefault(); } return; } if (views.view === 'channels') { views.chanScroll += Math.sign(e.deltaY) * 2; e.preventDefault(); } else if (views.view === 'tracks') { views.chanOffset = Math.max(0, views.chanOffset + Math.sign(e.deltaY || e.deltaX)); e.preventDefault(); } }, { passive: false });

  // drag & drop files
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (dragI != null || !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragDepth++; $('#drop').classList.add('show'); });
  window.addEventListener('dragleave', (e) => { if (dragI != null) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').classList.remove('show'); });
  window.addEventListener('dragover', (e) => { if (dragI == null) e.preventDefault(); });
  window.addEventListener('drop', async (e) => { if (dragI != null) return; e.preventDefault(); dragDepth = 0; $('#drop').classList.remove('show'); importList(await filesFromDrop(e.dataTransfer)); });

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=search], input[type=url], input[type=number], select') || $('dialog[open]') && e.key !== '?') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key, c = audio.cur;
    const digit = /^Digit[0-9]$/.test(e.code) ? (e.code === 'Digit0' ? 9 : +e.code.slice(5) - 1) : -1;
    if (digit >= 0 && c) { if (e.shiftKey) audio.solo(digit); else if (digit < (c.info.channels || 0)) audio.mute(digit, !(c.muted && c.muted.has(digit))); e.preventDefault(); return; }
    const views_ = { c: 'channels', t: 'tracks', a: 'analyzer', e: 'eq', o: 'scopes', b: 'phase', n: 'notes', w: 'wuerfel', i: 'info' };
    if (k.toLowerCase() === 'a' && S.view === 'analyzer' && !e.shiftKey) { const modes = ['bars', 'mirror', 'line', 'radial']; S.anMode = views.anMode = modes[(modes.indexOf(views.anMode) + 1) % modes.length]; save(); return; }
    if (views_[k.toLowerCase()] && !e.shiftKey) { setView(views_[k.toLowerCase()]); return; }
    switch (k) {
      case ' ': togglePlay(); break;
      case 'Enter': next(); break;
      case 'Backspace': prev(); break;
      case 'ArrowRight': audio.seek(audio.position() + (e.shiftKey ? 30000 : 5000)); break;
      case 'ArrowLeft': audio.seek(audio.position() - (e.shiftKey ? 30000 : 5000)); break;
      case ',': case '<': c && audio.selectSong(c.song - 1); break;
      case '.': case '>': c && audio.selectSong(c.song + 1); break;
      case '+': case '=': case 'F3': mixerUI.vol(5); break;
      case '-': case 'F2': mixerUI.vol(-5); break;
      case 'F5': mixerUI.wid(-10); break; case 'F6': mixerUI.wid(10); break;
      case 'F7': mixerUI.bal(-10); break; case 'F8': mixerUI.bal(10); break;
      case 'F9': mixerUI.tem(-5); break; case 'F10': mixerUI.tem(5); break;
      case 'F11': mixerUI.pit(-5); break; case 'F12': mixerUI.pit(5); break;
      case 'l': case 'L': $('#bLoop').click(); break;
      case 's': case 'S': $('#bShuffle').click(); break;
      case 'f': case 'F': { const v = $('#viewport'); if (document.fullscreenElement) document.exitFullscreen(); else v.requestFullscreen && v.requestFullscreen().catch(() => {}); break; }
      case '?': case 'h': case 'H': if ($('#dHelp').open) $('#dHelp').close(); else { renderHelp(); $('#dHelp').showModal(); } break;
      default: return;
    }
    e.preventDefault();
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 820) $('#app').classList.remove('lib'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && audio.ctx && audio.playing && audio.ctx.state !== 'running') audio.ctx.resume(); });
}

// ---------- start ----------
async function start() {
  applyTheme();
  views = new Views($('#cv'), audio, theme);
  bind(); mixerUI();
  audio.defaultLenMs = S.defaultLen * 1000;
  Object.assign(audio.mptOpts, { stereo: S.stereo, interp: S.interp, amiga: S.amiga });
  audio.midiBank = S.bank;
  audio.setEqAll(S.eq); audio.eqOn = S.eqOn; views.anMode = S.anMode; eqBar();
  lib.persist = S.persist;
  await lib.open();
  try { const sf = await kvGet('soundfont'); if (sf) audio.soundfont = new Uint8Array(await sf.arrayBuffer()); } catch (e) {}
  setView(S.view); setSide(S.side);
  updateStatic(); renderInfo();
  // remember libADLMIDI bank names once known
  const origLoaded = audio.cb.loaded;
  audio.on('loaded', (cur) => { origLoaded(cur); if (cur.info.banks && !midiBanks) { midiBanks = cur.info.banks; ls.set('banks', midiBanks); } });
  requestAnimationFrame(frame);
  if (document.fonts) document.fonts.ready.then(() => views.resize());
}
window.__cubic = { audio, lib, playIndex, S, get pi() { return pi; } };
start();
