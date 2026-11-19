// Layout check: on phones in both orientations and on tablets no two HUD parts overlap or leave the screen, and every card and banner fits.
const { serve, launch, openGame } = require('./harness.cjs');

const { SIZES, HUD, SAMPLE, APART, CARDS, BANNERS } = require('./hud-list.cjs');
const PORT = 8133;
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

(async () => {
  const server = serve(PORT), browser = await launch(), failures = [];
  // Each station of the chain has its own name and stage icons, which change the top bar's width.
  const only = process.env.LAYOUT_ONLY?.split(',');
  for (const station of ['town', 'highway', 'airport', 'hotel', 'mall']) for (const [width, height] of SIZES) {
    if (only && !only.includes(`${station}:${width}x${height}`)) continue;
    const page = await openGame(browser, PORT, 'sim', { viewport: { width, height }, station });
    await page.click('#startBtn');
    // Show every HUD element the way a mid-level player sees it.
    await page.evaluate(() => { Object.assign(window.__cr.state, { served: 1, cash: 40, doneAt: 1 }); window.__cr.mobile.open(); });
    const [mx, my] = [width / 2, height * 0.66];
    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + 35, my);
    await page.waitForTimeout(400);
    // Every HUD part is forced on (rare ones with sample text) so each pair is checked at its real size.
    const rects = await page.evaluate(([ids, sample]) => Object.fromEntries(ids.map((id) => {
      const el = document.getElementById(id);
      if (sample[id]) Object.assign(el, { hidden: false, textContent: sample[id] });
      // The rush banner keeps its ×2 button, so only its text is set.
      if (id === 'rush') { el.hidden = false; document.getElementById('rushText').textContent = '🌇 RUSH HOUR · 45s · Burgers ×2'; }
      const r = el.getBoundingClientRect();
      return [id, el.hidden || !r.width ? null : { left: r.left, right: r.right, top: r.top, bottom: r.bottom }];
    })), [HUD, SAMPLE]);
    await page.mouse.up();
    // Every pair, not a hand-picked list: a new HUD part is checked against all others from the day it is added.
    const apart = (a, b) => APART.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    HUD.forEach((a, i) => HUD.slice(i + 1).forEach((b) => { if (rects[a] && rects[b] && !apart(a, b) && overlap(rects[a], rects[b])) failures.push(`${station} ${width}x${height}: ${a} overlaps ${b}`); }));
    for (const [id, r] of Object.entries(rects)) if (r && (r.left < 0 || r.right > width || r.bottom > height)) failures.push(`${station} ${width}x${height}: ${id} off screen`);
    // Cards fit the screen and sit centred in every orientation.
    const cards = await page.evaluate((ids) => ids.map((id) => {
      const el = document.getElementById(id); el.hidden = false;
      const r = el.querySelector('.sheet').getBoundingClientRect(); el.hidden = true;
      return [id, r.left, r.right, r.top, r.bottom];
    }), CARDS);
    // Banners with sample text stay inside the screen.
    const banners = await page.evaluate((list) => Object.entries(list).map(([id, text]) => {
      const el = document.getElementById(id); el.hidden = false;
      if (text) el.textContent = text;
      const r = el.getBoundingClientRect(); el.hidden = true;
      return [id, r.left, r.right, r.top, r.bottom];
    }), BANNERS);
    for (const [id, l, rt, t, bt] of banners) if (l < 0 || rt > width + 1 || t < 0 || bt > height + 1) failures.push(`${station} ${width}x${height}: ${id} banner off screen`);
    for (const [id, l, rt, t, bt] of cards) {
      if (l < 0 || rt > width || t < 0 || bt > height + 1) failures.push(`${station} ${width}x${height}: ${id} card off screen`);
      if (Math.abs((l + rt) / 2 - width / 2) > 20) failures.push(`${station} ${width}x${height}: ${id} card not centred`);
    }
    await page.close();
  }
  await browser.close();
  server.close();
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : `PASS (phones both ways and tablets: ${SIZES.map((s) => s.join('x')).join(', ')}; town, highway, airport, hotel, mall)`);
  process.exitCode = failures.length ? 1 : 0;
})();
