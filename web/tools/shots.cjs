// Shot tour for a visual review, in the game exactly as a player gets it (`probe`): at every station the owner first stands still
// for IDLE_MS, then walks to the lot's left, top and right edges; each view is saved and all go on one contact sheet (tools/out/shots-sheet.png) to be looked over before a release. SHOTS_ONLY=mall limits it.
const fs = require('fs'), path = require('path');
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = 8157, OUT = path.join(__dirname, 'out'), IDLE_MS = 10000, VIEWS = [['left', 0, null], ['top', null, 0], ['right', 1, null]];
const STATIONS = process.env.SHOTS_ONLY?.split(',') ?? ['town', 'highway', 'airport', 'hotel', 'mall'];

(async () => {
  const server = serve(PORT), files = [];
  for (const station of STATIONS) {
    const browser = await launch();
    const page = await openGame(browser, PORT, 'probe', { viewport: { width: 390, height: 844 }, station });
    await page.click('#startBtn');
    await page.waitForTimeout(IDLE_MS);
    // A break ad may greet a player arriving at a later station; close it the way a player would.
    if (await page.isVisible('#adCard')) { await page.waitForTimeout(4000); await page.click('#adYes'); }
    const idle = path.join(OUT, `shot-${station}-idle.png`);
    await page.screenshot({ path: idle, timeout: 150000 });
    files.push([station, 'idle', idle]);
    for (const [name, fx, fz] of VIEWS) {
      await page.evaluate(async ([fx, fz]) => {
        const { CONFIG } = await import('./config.js'), g = window.__cr, [x0, x1, z0] = CONFIG.world.bounds;
        Object.assign(g.state, { served: 1, cash: 40, doneAt: 1 });
        const tx = fx === null ? (x0 + x1) / 2 : fx ? x1 : x0, tz = fz === null ? g.player.g.position.z : z0;
        for (let i = 0; i < 300; i++) {
          const p = g.player.g.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          if (d < 0.3) break;
          g.update(0.05, { x: dx / d, y: dz / d });
          g.draw(0.05);
        }
        for (let i = 0; i < 40; i++) { g.update(0.05, { x: 0, y: 0 }); g.draw(0.05); }
      }, [fx, fz]);
      const file = path.join(OUT, `shot-${station}-${name}.png`);
      // The first frame after a long scripted walk can take a while, so the wait is generous.
      await page.screenshot({ path: file, timeout: 150000 });
      files.push([station, name, file]);
    }
    await browser.close();
  }
  // Contact sheet: one row per station, its three views side by side.
  const browser = await launch(), page = await browser.newPage({ viewport: { width: 4 * 200 + 50, height: 600 } });
  const img = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
  await page.setContent(`<body style="margin:0;padding:10px;background:#fff;font:14px sans-serif">${STATIONS.map((st) => `<div><b>${st}</b><div style="display:flex;gap:10px">${files.filter(([s]) => s === st).map(([, n, f]) => `<figure style="margin:0"><img src="${img(f)}" width="200"><figcaption>${n}</figcaption></figure>`).join('')}</div></div>`).join('')}</body>`);
  await page.screenshot({ path: path.join(OUT, 'shots-sheet.png'), fullPage: true });
  await browser.close();
  server.close();
  console.log(`sheet: ${path.join(OUT, 'shots-sheet.png')}`);
})();
