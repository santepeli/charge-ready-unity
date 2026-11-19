// Shared test harness: serves the game folder, launches Chromium and opens seeded pages with local three.js.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');

const ROOT = path.join(__dirname, '..');
const threeLocal = (() => { try { return path.join(path.dirname(require.resolve('three', { paths: [ROOT, process.cwd()] })), 'three.module.js'); } catch { return null; } })();

// CR_PATCH="c.economy.chargeFeeBase = 7" tries a config change without touching config.js.
function serve(port) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    const type = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)] ?? 'text/html';
    res.setHeader('Content-Type', type);
    const patch = file.endsWith('config.js') && process.env.CR_PATCH ? `\n((c) => { ${process.env.CR_PATCH}; })(CONFIG);\n` : '';
    res.end(type === 'image/png' ? fs.readFileSync(file) : fs.readFileSync(file, 'utf8') + patch);
  });
  server.listen(port);
  return server;
}

const launch = () => chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

// Opens the game; a seed replaces Math.random with a repeatable generator so runs can be compared.
// `init` runs in the page before the game loads, for checks that watch the game from inside.
async function openGame(browser, port, query, { seed, viewport = { width: 390, height: 844 }, scale = 1, errors = [], station, init, initArg } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  if (init) await page.addInitScript(init, initArg);
  // `station` starts the run at that station of the chain, written once before the first load only.
  if (station) await page.addInitScript((id) => { if (!sessionStorage.getItem('cr-station')) { sessionStorage.setItem('cr-station', id); localStorage.setItem('charge-ready-v2', JSON.stringify({ version: 4, active: id, stations: {} })); } }, station);
  page.on('pageerror', (e) => errors.push(e.message));
  // three.js and its addons come from the local npm copy instead of the CDN.
  if (threeLocal) await page.route('https://cdn.jsdelivr.net/**', (r) => {
    const addon = r.request().url().split('/examples/jsm/')[1];
    r.fulfill({ path: addon ? path.join(path.dirname(threeLocal), '..', 'examples', 'jsm', addon) : threeLocal, contentType: 'text/javascript' });
  });
  await page.route('https://fonts.**', (r) => r.abort());
  if (seed !== undefined) {
    await page.addInitScript((s) => {
      let a = s >>> 0;
      window.__seedRandom = (v) => { a = v >>> 0; };
      Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }, seed);
  }
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForFunction(() => window.__cr);
  // Building the scene draws random numbers too (every three.js object takes a random id), so the seed starts over once the world
  // stands: a bot run then depends on the seed alone, not on how many props a station has.
  if (seed !== undefined) await page.evaluate((s) => window.__seedRandom(s), seed);
  await page.addScriptTag({ path: path.join(__dirname, 'bot-player.js') });
  return page;
}

const mmss = (s) => (s == null ? '-' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

module.exports = { serve, launch, openGame, mmss };
