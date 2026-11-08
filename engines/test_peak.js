const fs = require('fs'), path = require('path');
const { laadEngine } = require('./wasihost.js');
(async () => {
  const [wasm, secs, ...files] = process.argv.slice(2);
  const eng = await laadEngine(fs.readFileSync(wasm));
  for (const f of files) {
    if (f.startsWith('+')) { eng.addFile(path.basename(f.slice(1)), new Uint8Array(fs.readFileSync(f.slice(1)))); continue; }
    if (!eng.load(new Uint8Array(fs.readFileSync(f)), path.basename(f), 48000)) { console.log('FAIL', f); continue; }
    const buf = eng.X.eng_alloc(48000 * 4); const peaks = [];
    for (let k = 0; k < +secs; k++) { const n = eng.X.eng_render(buf, 48000); let p = 0; const a = new Int16Array(eng.mem().buffer, buf, n * 2); for (const v of a) p = Math.max(p, Math.abs(v)); peaks.push(p); }
    console.log(path.basename(f), peaks.join(' '));
  }
})();
