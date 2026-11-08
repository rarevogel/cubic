// Library (imported files) and playlist, persisted in IndexedDB.
import { dirName, baseName, ext, isPlayable } from './formats.js';
import { expand, parseCue, parsePlaylist, decodeText } from './containers.js';

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('cubic', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('files', { keyPath: 'id', autoIncrement: true }); d.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
};
export const kvGet = (k) => tx('kv', 'readonly', s => s.get(k)).catch(() => undefined);
export const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k)).catch(e => console.warn('kv', e));

// Android: content:// URIs and remote URLs are served through the app's own origin (no CORS there)
export function urlFor(rec) {
  const u = rec.uri;
  if (u.startsWith('content:')) return '/__doc?u=' + encodeURIComponent(u);
  if (window.CubicAndroid && /^https?:/.test(u) && !u.startsWith(location.origin)) return '/__proxy?u=' + encodeURIComponent(u);
  return u;
}

export class Library {
  constructor() { this.files = []; this.byId = new Map(); this.playlist = []; this.persist = true; this.mem = new Map(); }

  async open() {
    try {
      const all = await tx('files', 'readonly', s => s.getAll());
      for (const f of all || []) { const r = { ...f }; delete r.blob; this.files.push(r); this.byId.set(r.id, r); }
      this.playlist = ((await kvGet('playlist')) || []).filter(e => this.byId.has(e.id));
    } catch (e) { console.warn('library unavailable', e); }
  }
  savePlaylist() { return kvSet('playlist', this.playlist); }

  async addRecord(rec, blob) {
    rec.added = Date.now();
    if (this.persist) {
      try { rec.id = await tx('files', 'readwrite', s => s.add(blob ? { ...rec, blob } : rec)); }
      catch (e) { console.warn('could not store', rec.path, e); rec.id = 'm' + Math.random().toString(36).slice(2); }
    } else rec.id = 'm' + Math.random().toString(36).slice(2);
    if (blob && String(rec.id).startsWith('m')) this.mem.set(rec.id, blob);
    this.files.push(rec); this.byId.set(rec.id, rec);
    return rec;
  }

  // Import File objects (from <input>, drag & drop). Archives are unpacked; returns added records.
  async importFiles(list, onProgress) {
    const added = [];
    let i = 0;
    for (const { file, path } of list) {
      i++; if (onProgress) onProgress(i, list.length, path);
      const p = path || file.name;
      const e = ext(p);
      const lower = p.toLowerCase();
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const archive = (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3) || (head[0] === 0x1f && head[1] === 0x8b && !/\.(vgz)$/.test(lower)) || e === 'tar';
      if (archive && file.size < 512 * 1024 * 1024) {
        const parts = expand(p, new Uint8Array(await file.arrayBuffer()));
        for (const [n, d] of parts) {
          if (!isPlayable(n) && !['cue', 'm3u', 'pls', 'dat', 'bnk', '003', 'ins', 'sf2', 'txt', 'nfo'].includes(ext(n)) && !/patch\./i.test(n)) continue;
          added.push(await this.addRecord({ path: n, name: baseName(n), size: d.length }, new Blob([d])));
        }
      } else {
        added.push(await this.addRecord({ path: p, name: baseName(p), size: file.size }, file));
      }
    }
    return added;
  }
  // Remote/URI references (Android folder picks, URLs)
  async importRefs(refs) {
    const added = [];
    for (const r of refs) added.push(await this.addRecord({ path: r.path, name: baseName(r.path), size: r.size || 0, uri: r.uri }));
    return added;
  }

  async bytes(rec) {
    if (rec.uri) {
      const r = await fetch(urlFor(rec));
      if (!r.ok) throw new Error('download failed: ' + r.status);
      return new Uint8Array(await r.arrayBuffer());
    }
    let blob = this.mem.get(rec.id);
    if (!blob) { const full = await tx('files', 'readonly', s => s.get(rec.id)); blob = full && full.blob; }
    if (!blob) throw new Error('file data missing');
    return new Uint8Array(await blob.arrayBuffer());
  }

  siblings(rec) { const d = dirName(rec.path); return this.files.filter(f => f !== rec && dirName(f.path) === d); }
  async siblingData(rec, limit = 40) {
    const out = [];
    // likely companions first: same base name (song.ins, song.snd), then data files (insts.dat, standard.bnk, *patch.003)
    const stem = (n) => n.toLowerCase().replace(/\.[^.]*$/, '');
    const score = (f) => stem(f.name) === stem(rec.name) ? 0 : !isPlayable(f.name) ? 1 : 2;
    const sib = this.siblings(rec).map(f => [score(f), f]).filter(([s]) => s < 2 || this.siblings(rec).length <= limit).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    for (const f of sib) {
      if (out.length >= limit) break;
      if (f.size > 1024 * 1024 || f.uri) continue;
      try { out.push([f.name, await this.bytes(f)]); } catch (e) {}
    }
    return out;
  }

  async remove(ids) {
    const set = new Set(ids);
    this.files = this.files.filter(f => !set.has(f.id));
    for (const id of ids) { this.byId.delete(id); this.mem.delete(id); }
    this.playlist = this.playlist.filter(e => !set.has(e.id));
    try { await tx('files', 'readwrite', s => { for (const id of ids) if (typeof id === 'number') s.delete(id); }); } catch (e) {}
    this.savePlaylist();
  }
  async clear() {
    this.files = []; this.byId.clear(); this.mem.clear(); this.playlist = [];
    try { await tx('files', 'readwrite', s => s.clear()); } catch (e) {}
    this.savePlaylist();
  }

  // Playlist entries for a record: CUE sheets and M3U/PLS lists expand to their tracks.
  async entriesFor(rec) {
    const e = ext(rec.name);
    if (e === 'cue') {
      const cue = parseCue(decodeText(await this.bytes(rec)));
      const out = [];
      for (const f of cue.files) {
        const target = this.findRelative(rec, f.name) || this.findRelative(rec, f.name.replace(/\.[^.]+$/, ''), true);
        if (!target) continue;
        for (const t of f.tracks) out.push({ id: target.id, cue: { start: t.start, end: t.end }, title: t.title || `Track ${t.n}`, artist: t.performer || cue.performer, album: cue.title });
      }
      return out;
    }
    if (e === 'm3u' || e === 'm3u8' || e === 'pls') {
      const out = [];
      for (const ref of parsePlaylist(rec.name, decodeText(await this.bytes(rec)))) {
        if (/^https?:/i.test(ref)) { const [r] = await this.importRefs([{ path: 'web/' + baseName(ref.split('?')[0]), uri: ref }]); out.push({ id: r.id }); continue; }
        const t = this.findRelative(rec, ref);
        if (t && isPlayable(t.name)) out.push({ id: t.id });
      }
      return out;
    }
    if (!isPlayable(rec.name)) return [];
    return [{ id: rec.id }];
  }
  findRelative(rec, rel, anyExt = false) {
    const parts = (dirName(rec.path) ? dirName(rec.path).split('/') : []);
    for (const seg of rel.replace(/\\/g, '/').split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
    const want = parts.join('/').toLowerCase();
    return this.files.find(f => { const p = f.path.toLowerCase(); return anyExt ? p.replace(/\.[^./]+$/, '') === want && isPlayable(f.name) : p === want; })
      || this.files.find(f => f.name.toLowerCase() === baseName(rel).toLowerCase());
  }
}
