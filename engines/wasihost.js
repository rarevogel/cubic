// Minimal WASI host for the Cubic engines (also used inside the AudioWorklet).
function maakWasi(getMem, log) {
  const dv = () => new DataView(getMem().buffer);
  const E = { BADF: 8, NOSYS: 52 };
  return {
    fd_write(fd, iovs, n, nwritten) {
      let s = "", tot = 0; const d = dv();
      for (let i = 0; i < n; i++) { const p = d.getUint32(iovs + i * 8, true), l = d.getUint32(iovs + i * 8 + 4, true); s += new TextDecoder().decode(new Uint8Array(getMem().buffer, p, l)); tot += l; }
      d.setUint32(nwritten, tot, true); if (log) log(fd, s); return 0;
    },
    fd_read() { return E.BADF; }, fd_close() { return 0; }, fd_seek() { return E.BADF; }, fd_fdstat_get() { return E.BADF; },
    fd_prestat_get() { return E.BADF; }, fd_prestat_dir_name() { return E.BADF; }, fd_filestat_get() { return E.BADF; },
    path_open() { return E.BADF; }, path_filestat_get() { return E.BADF; },
    environ_sizes_get(c, s) { const d = dv(); d.setUint32(c, 0, true); d.setUint32(s, 0, true); return 0; },
    environ_get() { return 0; },
    args_sizes_get(c, s) { const d = dv(); d.setUint32(c, 0, true); d.setUint32(s, 0, true); return 0; },
    args_get() { return 0; },
    clock_time_get(id, prec, out) { const d = dv(); d.setBigUint64(out, BigInt(Math.round(Date.now() * 1e6)), true); return 0; },
    random_get(p, l) { const a = new Uint8Array(getMem().buffer, p, l); for (let i = 0; i < l; i++) a[i] = (Math.random() * 256) | 0; return 0; },
    proc_exit(c) { throw new Error("proc_exit " + c); },
    sched_yield() { return 0; }, poll_oneoff() { return E.NOSYS; },
  };
}
async function laadEngine(bytes, log) {
  let mem;
  const wasi = maakWasi(() => mem, log);
  const mod = await WebAssembly.compile(bytes);
  const imp = {};
  for (const i of WebAssembly.Module.imports(mod)) {
    imp[i.module] = imp[i.module] || {};
    if (i.module === "wasi_snapshot_preview1") imp[i.module][i.name] = wasi[i.name] || (() => 52);
    else imp[i.module][i.name] = () => 0;
  }
  const inst = await WebAssembly.instantiate(mod, imp);
  mem = inst.exports.memory;
  if (inst.exports._initialize) inst.exports._initialize();
  const X = inst.exports;
  const str = (p) => { const u = new Uint8Array(mem.buffer); let e = p; while (u[e]) e++; return new TextDecoder().decode(u.subarray(p, e)); };
  const cstr = (s) => { const b = new TextEncoder().encode(s + "\0"); const p = X.eng_alloc(b.length); new Uint8Array(mem.buffer).set(b, p); return p; };
  return { X, mem: () => mem, str, cstr,
    addFile(name, data) { if (!X.eng_addfile) return; const p = X.eng_alloc(data.length); new Uint8Array(mem.buffer).set(data, p); const n = cstr(name); X.eng_addfile(n, p, data.length); X.eng_free(p); X.eng_free(n); },
    load(data, name, rate) { const p = X.eng_alloc(data.length); new Uint8Array(mem.buffer).set(data, p); const n = cstr(name); const ok = X.eng_load(p, data.length, n, rate); X.eng_free(n); this.dataPtr = p; return ok; },
    info() { return JSON.parse(str(X.eng_info())); },
    status() { return X.eng_status ? JSON.parse(str(X.eng_status())) : {}; },
  };
}
if (typeof module !== "undefined") module.exports = { laadEngine, maakWasi };
