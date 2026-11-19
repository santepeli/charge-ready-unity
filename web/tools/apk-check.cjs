// App bundle check: the offline web bundle inside the Android project plays on a phone with every outside request blocked, the font is
// local, the build label matches config.js and every game file is the same as the tested source.
// Usage: node tools/apk-check.cjs [bundle folder], default /home/claude/apk/project/app/src/main/assets/www.
const { devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const { launch } = require('./harness.cjs');

const WWW = process.argv[2] ?? '/home/claude/apk/project/app/src/main/assets/www', SRC = path.join(__dirname, '..'), PORT = 8147;
const types = { '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.html': 'text/html', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const failures = [];

// Same files as the tested source: every .js and every asset.
const list = (dir, base = '') => fs.readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(dir, path.join(base, e.name)) : [path.join(base, e.name)]));
for (const f of [...fs.readdirSync(SRC).filter((n) => n.endsWith('.js')), ...list(SRC, 'assets')]) {
  const b = path.join(WWW, f);
  if (!fs.existsSync(b)) failures.push(`${f} is missing from the bundle`);
  else if (!fs.readFileSync(b).equals(fs.readFileSync(path.join(SRC, f)))) failures.push(`${f} differs from the tested source`);
}

const server = http.createServer((q, r) => {
  const f = path.join(WWW, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(WWW) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader('Content-Type', types[path.extname(f)] ?? 'application/octet-stream');
  r.end(fs.readFileSync(f));
}).listen(PORT);

(async () => {
  const browser = await launch(), ctx = await browser.newContext({ ...devices['Pixel 7'] }), page = await ctx.newPage(), errors = [], outside = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(`http://localhost:${PORT}`)) return r.continue(); outside.push(u); r.abort(); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  // The loading intro plays first, then the opening swoop readies the start screen.
  if (!(await page.waitForFunction(() => document.getElementById('start').classList.contains('ready'), null, { timeout: 20000 }).catch(() => null))) failures.push('start screen never became ready');
  await page.tap('#startBtn', { force: true });
  await page.waitForTimeout(1500);
  if (!(await page.evaluate(() => document.fonts.check("800 20px 'Baloo 2'")))) failures.push('Baloo 2 font not loaded from the bundle');
  // A thumb drag must work without the network.
  await page.mouse.move(200, 600); await page.mouse.down(); await page.mouse.move(280, 600, { steps: 8 }); await page.waitForTimeout(900); await page.mouse.up();
  const label = await page.evaluate(async () => (await import('./config.js')).CONFIG.feedback.build);
  const want = (await import(path.join(SRC, 'config.js'))).CONFIG.feedback.build;
  if (label !== want) failures.push(`bundle says ${label}, source says ${want}`);
  if (errors.length) failures.push(`errors: ${errors.slice(0, 3).join(' | ')}`);
  if (outside.length) failures.push(`asked the network for ${outside.slice(0, 3).join(', ')}`);
  await browser.close();
  server.close();
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : `PASS (${want}: same files as the source, offline, local font, start and drag work)`);
  process.exitCode = failures.length ? 1 : 0;
})();
