// Tag reading for audio files: ID3v2/ID3v1, Vorbis comments (FLAC, Ogg Vorbis/Opus), MP4 atoms, RIFF INFO, APEv2.
const asc = (b, o, s) => { for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false; return true; };
const latin = (b) => { let s = ''; for (const c of b) { if (!c) break; s += String.fromCharCode(c); } return s.trim(); };
const utf8 = (b) => new TextDecoder().decode(b).replace(/\0+$/, '').trim();

function id3text(f) {
  const enc = f[0], d = f.subarray(1);
  if (enc === 1 || enc === 2) {
    let le = enc === 1 ? !(d[0] === 0xfe && d[1] === 0xff) : false;
    let s = d; if (enc === 1 && ((d[0] === 0xff && d[1] === 0xfe) || (d[0] === 0xfe && d[1] === 0xff))) s = d.subarray(2);
    try { return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(s).replace(/\0.*$/s, '').trim(); } catch (e) { return ''; }
  }
  return enc === 3 ? utf8(d).replace(/\0.*$/s, '') : latin(d);
}

function readId3v2(b, t) {
  const ver = b[3], flags = b[5];
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  let o = 10; const end = Math.min(b.length, 10 + size);
  if (flags & 0x40) o += ver === 4 ? ((b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3]) : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) + 4;
  const map = ver === 2 ? { TT2: 'title', TP1: 'artist', TAL: 'album', TYE: 'date', TCO: 'genre', TRK: 'track' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album', TYER: 'date', TDRC: 'date', TCON: 'genre', TRCK: 'track', TPE2: 'albumArtist' };
  while (o + (ver === 2 ? 6 : 10) < end) {
    let id, fs;
    if (ver === 2) { id = latin(b.subarray(o, o + 3)); fs = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5]; o += 6; }
    else { id = latin(b.subarray(o, o + 4)); fs = ver === 4 ? ((b[o + 4] << 21) | (b[o + 5] << 14) | (b[o + 6] << 7) | b[o + 7]) : ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]); o += 10; }
    if (!id || !/^[A-Z0-9]+$/.test(id) || fs <= 0) break;
    const f = b.subarray(o, o + fs);
    if (map[id]) t[map[id]] = id3text(f);
    else if (id === 'COMM' || id === 'COM') { const d = f.subarray(4); const tx = id3text(new Uint8Array([f[0], ...d])); const i = tx.indexOf('\0'); t.comment = i >= 0 ? tx.slice(i + 1) : tx; }
    o += fs;
  }
}

function vorbisComments(d, t) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let o = 0; const vl = dv.getUint32(o, true); o += 4 + vl;
  const n = dv.getUint32(o, true); o += 4;
  for (let i = 0; i < n && o + 4 <= d.length; i++) {
    const l = dv.getUint32(o, true); o += 4;
    const s = utf8(d.subarray(o, o + l)); o += l;
    const k = s.indexOf('='); if (k < 0) continue;
    const key = s.slice(0, k).toLowerCase(), val = s.slice(k + 1);
    const m = { title: 'title', artist: 'artist', album: 'album', date: 'date', genre: 'genre', tracknumber: 'track', comment: 'comment', description: 'comment' }[key];
    if (m && !t[m]) t[m] = val;
  }
}

export function readTags(b) {
  const t = {};
  try {
    if (asc(b, 0, 'ID3')) readId3v2(b, t);
    else if (asc(b, 0, 'fLaC')) {
      let o = 4;
      while (o + 4 < b.length) { const last = b[o] & 0x80, type = b[o] & 0x7f, len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; o += 4; if (type === 4) vorbisComments(b.subarray(o, o + len), t); o += len; if (last) break; }
    } else if (asc(b, 0, 'OggS')) {
      const lim = Math.min(b.length, 1 << 18);
      for (let i = 0; i < lim - 8; i++) {
        if (b[i] === 3 && asc(b, i + 1, 'vorbis')) { vorbisComments(b.subarray(i + 7, lim), t); break; }
        if (asc(b, i, 'OpusTags')) { vorbisComments(b.subarray(i + 8, lim), t); break; }
      }
    } else if (asc(b, 0, 'RIFF') && asc(b, 8, 'WAVE')) {
      let o = 12;
      while (o + 8 < b.length) {
        const id = latin(b.subarray(o, o + 4)), len = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24);
        if (id === 'LIST' && asc(b, o + 8, 'INFO')) {
          let p = o + 12; while (p + 8 < o + 8 + len) { const k = latin(b.subarray(p, p + 4)), l = b[p + 4] | (b[p + 5] << 8); const v = latin(b.subarray(p + 8, p + 8 + l)); if (k === 'INAM') t.title = v; else if (k === 'IART') t.artist = v; else if (k === 'IPRD') t.album = v; else if (k === 'ICMT') t.comment = v; p += 8 + l + (l & 1); }
        }
        o += 8 + len + (len & 1); if (len < 0) break;
      }
    } else if (asc(b, 4, 'ftyp')) {
      const want = { '\xa9nam': 'title', '\xa9ART': 'artist', '\xa9alb': 'album', '\xa9day': 'date', '\xa9cmt': 'comment' };
      for (let i = 0; i < b.length - 24; i++) {
        if (b[i] === 0xa9) { const k = String.fromCharCode(...b.subarray(i, i + 4)); if (want[k] && asc(b, i + 8, 'data')) { const l = ((b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]) - 16; if (l > 0 && l < 1024) t[want[k]] = utf8(b.subarray(i + 20, i + 20 + l)); } }
      }
    }
    if (!t.title && b.length > 128 && asc(b, b.length - 128, 'TAG')) {
      const e = b.subarray(b.length - 128);
      t.title = latin(e.subarray(3, 33)); t.artist = latin(e.subarray(33, 63)); t.album = latin(e.subarray(63, 93)); t.date = latin(e.subarray(93, 97));
    }
    // APEv2 (APE, MPC, WavPack)
    if (!t.title) {
      const s = Math.max(0, b.length - 32 - 128);
      for (const o of [b.length - 32, s]) {
        if (o > 0 && asc(b, o, 'APETAGEX')) {
          const size = b[o + 12] | (b[o + 13] << 8) | (b[o + 14] << 16) | (b[o + 15] << 24), n = b[o + 16] | (b[o + 17] << 8);
          let p = o + 32 - size;
          for (let i = 0; i < n && p > 0 && p < o; i++) {
            const l = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24); p += 8;
            let k = ''; while (b[p]) k += String.fromCharCode(b[p++]); p++;
            const v = utf8(b.subarray(p, p + l)); p += l;
            const m = { title: 'title', artist: 'artist', album: 'album', year: 'date', comment: 'comment', genre: 'genre' }[k.toLowerCase()];
            if (m) t[m] = v;
          }
          break;
        }
      }
    }
  } catch (e) { /* tags are a bonus */ }
  return t;
}
