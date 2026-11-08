// Ogg Speex (.spx) decoder: Ogg demuxing in JS, packet decoding by libspeex compiled to WebAssembly.
function oggPackets(b) {
  const packets = []; let cur = [], o = 0;
  while (o + 27 <= b.length) {
    if (b[o] !== 0x4f || b[o + 1] !== 0x67 || b[o + 2] !== 0x67 || b[o + 3] !== 0x53) { o++; continue; }
    const nseg = b[o + 26], segs = b.subarray(o + 27, o + 27 + nseg);
    let p = o + 27 + nseg;
    for (const s of segs) {
      cur.push(b.subarray(p, p + s)); p += s;
      if (s < 255) { const len = cur.reduce((a, c) => a + c.length, 0), pk = new Uint8Array(len); let q = 0; for (const c of cur) { pk.set(c, q); q += c.length; } packets.push(pk); cur = []; }
    }
    o = p;
  }
  return packets;
}

export default async function decode(data, wasmBytes) {
  const { instance } = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: new Proxy({}, { get: () => () => 0 }), env: new Proxy({}, { get: () => () => 0 }) });
  const X = instance.exports; if (X._initialize) X._initialize();
  const mem = () => new Uint8Array(X.memory.buffer);
  const pk = oggPackets(data);
  if (pk.length < 3) throw new Error('not an Ogg Speex file');
  const hp = X.spx_alloc(pk[0].length), op = X.spx_alloc(12);
  mem().set(pk[0], hp);
  const rate = X.spx_open(hp, pk[0].length, op);
  if (!rate) throw new Error('bad Speex header');
  const [fs, nf, ch] = new Int32Array(X.memory.buffer, op, 3);
  const inp = X.spx_alloc(4096), outp = X.spx_alloc(fs * nf * ch * 4 + 64);
  const L = [], R = [];
  for (let i = 2; i < pk.length; i++) {
    if (pk[i].length > 4096) continue;
    mem().set(pk[i], inp);
    const n = X.spx_decode(inp, pk[i].length, outp);
    if (n <= 0) continue;
    const f = new Float32Array(X.memory.buffer, outp, n * ch);
    if (ch === 2) { const l = new Float32Array(n), r = new Float32Array(n); for (let k = 0; k < n; k++) { l[k] = f[k * 2]; r[k] = f[k * 2 + 1]; } L.push(l); R.push(r); }
    else L.push(f.slice());
  }
  const join = (a) => { const t = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { t.set(x, o); o += x.length; } return t; };
  return { channelData: ch === 2 ? [join(L), join(R)] : [join(L)], sampleRate: rate };
}
