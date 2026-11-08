// Headless playback test: loads each file into dist/cubic.html and checks that audio comes out.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const files = process.argv.slice(2);
const dist = path.join(__dirname, '..', 'dist');
const srv = http.createServer((q, r) => { const f = path.join(dist, q.url === '/' ? 'cubic.html' : q.url.split('?')[0]); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(`http://localhost:${port}/`);
  await p.waitForTimeout(500);
  let ok = 0, bad = 0;
  for (const spec of files) {
    const group = spec.split('+');            // file+companion+companion
    await p.setInputFiles('#fileIn', group);
    const name = path.basename(group[0]).split('=').pop();
    await p.waitForFunction((n) => window.__cubic.lib.playlist.some(e => (window.__cubic.lib.byId.get(e.id) || {}).name === n), name, { timeout: 8000 }).catch(() => {});
    const r = await p.evaluate(async (name) => {
      const C = window.__cubic; const L = C.lib.playlist;
      let i = -1; for (let k = L.length - 1; k >= 0; k--) { const rec = C.lib.byId.get(L[k].id); if (rec && rec.name === name) { i = k; break; } }
      if (i < 0) return { err: 'not in playlist' };
      await C.playIndex(i);
      const a = C.audio; if (!a.cur) return { err: 'not loaded: ' + document.querySelector('#toast').textContent };
      if (!a.anL) return { err: 'no analyser' };
      const t = new Float32Array(2048); let peak = 0;
      for (let k = 0; k < 25; k++) { await new Promise(r => setTimeout(r, 100)); a.anL.getFloatTimeDomainData(t); for (const v of t) peak = Math.max(peak, Math.abs(v)); a.anR.getFloatTimeDomainData(t); for (const v of t) peak = Math.max(peak, Math.abs(v)); }
      const c = a.cur;
      return { kind: c.kind, type: c.info.type, title: c.info.title, ch: c.info.channels, songs: c.info.songs, len: Math.round(c.lengthMs / 1000), pos: Math.round(a.position()), peak: +peak.toFixed(3), lv: c.l ? Math.max(0, ...c.l) : -1, fr: c.fr ? [...c.fr].filter(Boolean).length : 0, st: c.st };
    }, name);
    const good = r.peak > 0.005 && r.pos > 500;
    good ? ok++ : bad++;
    if (errs.length) { console.log(errs.splice(0).join('\n')); }
    console.log((good ? 'OK  ' : 'FAIL') + ' ' + name.padEnd(36) + JSON.stringify(r));
  }
  if (process.env.SHOT) { await p.screenshot({ path: process.env.SHOT }); }
  console.log(`${ok} ok, ${bad} failed`); if (errs.length) console.log(errs.slice(0, 20).join('\n'));
  await b.close(); srv.close();
})();
