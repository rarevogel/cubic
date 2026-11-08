// Screenshots of every view, desktop and phone. Usage: node shots.js outdir file...
const { chromium, devices } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const [out, ...files] = process.argv.slice(2);
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); fs.createReadStream(path.join(__dirname, '..', 'dist', 'cubic.html')).pipe(r); }).listen(0);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [label, opts] of [['desk', { viewport: { width: 1440, height: 900 } }], ['phone', { ...devices['Pixel 7'] }]]) {
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
    p.on('pageerror', e => console.log('ERR', e.message));
    await p.goto('http://localhost:' + srv.address().port + '/'); await p.waitForTimeout(500);
    if (process.env.EMPTY) await p.screenshot({ path: `${out}/${label}-empty.png` });
    await p.setInputFiles('#fileIn', files); await p.waitForTimeout(2500);
    for (const v of (process.env.VIEWS || 'channels,tracks,analyzer,scopes,phase,notes,wuerfel,info').split(',')) {
      await p.evaluate((v) => document.querySelector(`[data-v="${v}"]`).click(), v); await p.waitForTimeout(900);
      await p.screenshot({ path: `${out}/${label}-${v}.png` });
    }
    if (label === 'phone') { await p.evaluate(() => document.querySelector('[data-m="lib"]').click()); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${label}-list.png` }); }
    await ctx.close();
  }
  await b.close(); srv.close();
})();
