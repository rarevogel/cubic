const fs = require('fs'), path = require('path');
const { laadEngine } = require('./wasihost.js');
(async () => {
  const [wasm, ...files] = process.argv.slice(2);
  const eng = await laadEngine(fs.readFileSync(wasm), (fd, s) => process.stderr.write('[' + fd + '] ' + s));
  for (const f of files) {
    const data = new Uint8Array(fs.readFileSync(f));
    const t0 = Date.now();
    const ok = eng.load(data, path.basename(f), 48000);
    if (!ok) { console.log('FAIL', path.basename(f)); continue; }
    const info = eng.info();
    const buf = eng.X.eng_alloc(48000 * 4);
    let peak = 0, frames = 0;
    for (let k = 0; k < 10; k++) { const n = eng.X.eng_render(buf, 48000); frames += n; const a = new Int16Array(eng.mem().buffer, buf, n * 2); for (const v of a) peak = Math.max(peak, Math.abs(v)); }
    eng.X.eng_free(buf);
    console.log('OK', path.basename(f), info.type || info.system || '', JSON.stringify(info.title || ''), 'songs', info.songs, 'len', Math.round((info.lengthMs || 0) / 1000) + 's', 'peak', peak, Date.now() - t0 + 'ms/10s');
  }
})();
