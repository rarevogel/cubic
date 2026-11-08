// Unpacking of archives (ZIP, GZip, TAR) and parsing of CUE sheets and playlists.
import { unzipSync, gunzipSync } from 'fflate';
import { ext, baseName, dirName } from './formats.js';

const asc = (b, o, s) => { for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false; return true; };
export const isZip = (b) => b.length > 4 && asc(b, 0, 'PK\x03\x04');
export const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
export const isTar = (b) => b.length > 512 && asc(b, 257, 'ustar');

// gzip → [name, bytes]; keeps the inner extension (song.vgz → song.vgm, x.mod.gz → x.mod)
export function gunzipNamed(name, b) {
  const out = gunzipSync(b);
  let n = name;
  if (/\.vgz$/i.test(n)) n = n.replace(/z$/i, 'm');
  else if (/\.(gz|tgz)$/i.test(n)) n = n.replace(/\.gz$/i, '').replace(/\.tgz$/i, '.tar');
  // gzip header may carry the original name
  if (b[3] & 8) { let i = 10; if (b[3] & 4) i += 2 + (b[10] | (b[11] << 8)); let s = ''; while (i < b.length && b[i]) s += String.fromCharCode(b[i++]); if (s && /\.[a-z0-9]{1,6}$/i.test(s)) n = (dirName(name) ? dirName(name) + '/' : '') + baseName(s); }
  return [n, out];
}

export function untar(b) {
  const files = []; let o = 0;
  while (o + 512 <= b.length) {
    const h = b.subarray(o, o + 512);
    if (!h[0]) break;
    let name = ''; for (let i = 0; i < 100 && h[i]; i++) name += String.fromCharCode(h[i]);
    let prefix = ''; for (let i = 345; i < 500 && h[i]; i++) prefix += String.fromCharCode(h[i]);
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(String.fromCharCode(...h.subarray(124, 136)).replace(/[^0-7]/g, '') || '0', 8);
    const type = h[156];
    o += 512;
    if (type === 0 || type === 48) files.push([name, b.slice(o, o + size)]);
    o += Math.ceil(size / 512) * 512;
  }
  return files;
}

// Expand one file into a list of [path, bytes] (recursively for archives in archives).
export function expand(path, b, depth = 0) {
  if (depth > 3) return [[path, b]];
  try {
    if (isZip(b)) {
      const z = unzipSync(b);
      let base = path.replace(/\.[^./]*$/, '');
      const names = Object.keys(z).filter(n => !n.endsWith('/'));
      const top = baseName(base) + '/';
      if (names.length && names.every(n => n.startsWith(top))) base = dirName(base) ? dirName(base) : '';   // zip already has a folder of that name
      const out = [];
      for (const [n, d] of Object.entries(z)) if (!n.endsWith('/') && d.length) out.push(...expand((base ? base + '/' : '') + n, d, depth + 1));
      return out;
    }
    if (isGzip(b)) { const [n, d] = gunzipNamed(path, b); return expand(n, d, depth + 1); }
    if (isTar(b)) { const base = path.replace(/\.[^./]*$/, ''); return untar(b).flatMap(([n, d]) => expand(base + '/' + n, d, depth + 1)); }
  } catch (e) { console.warn('unpack failed', path, e); }
  return [[path, b]];
}

// ---- CUE sheets ----
const msf = (s) => { const [m, sec, f] = s.split(':').map(Number); return (m * 60 + sec + f / 75) * 1000; };
export function parseCue(text) {
  const out = { title: '', performer: '', files: [] };
  let file = null, track = null;
  const unq = (s) => s.trim().replace(/^"(.*)"$/, '$1');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const [cmd] = line.split(/\s+/); const rest = line.slice(cmd.length).trim();
    switch (cmd.toUpperCase()) {
      case 'FILE': { const m = rest.match(/^("([^"]*)"|(\S+))\s*(\S*)$/); file = { name: m ? (m[2] ?? m[3]) : unq(rest), tracks: [] }; out.files.push(file); track = null; break; }
      case 'TRACK': if (file) { track = { n: parseInt(rest, 10), title: '', performer: '', start: 0 }; file.tracks.push(track); } break;
      case 'TITLE': if (track) track.title = unq(rest); else out.title = unq(rest); break;
      case 'PERFORMER': if (track) track.performer = unq(rest); else out.performer = unq(rest); break;
      case 'INDEX': if (track) { const [idx, t] = rest.split(/\s+/); if (parseInt(idx, 10) === 1) track.start = msf(t); } break;
    }
  }
  for (const f of out.files) f.tracks.forEach((t, i) => { t.end = i + 1 < f.tracks.length ? f.tracks[i + 1].start : null; });
  return out;
}

// ---- M3U / PLS: returns a list of relative paths or URLs ----
export function parsePlaylist(name, text) {
  if (ext(name) === 'pls') return text.split(/\r?\n/).map(l => l.match(/^File\d+=(.*)$/i)).filter(Boolean).map(m => m[1].trim());
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

export function decodeText(b) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return new TextDecoder('windows-1252').decode(b); }
}
