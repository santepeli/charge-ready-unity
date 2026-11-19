// Offline check: away earnings use the measured income rate, stop at the 2 h cap, pay half, and arrive through the welcome card.
// Also checks a VIP drops its bill trail and the player can pick it up.
const { serve, launch, openGame } = require('./harness.cjs');
const PORT = 8139;

(async () => {
  const server = serve(PORT), browser = await launch(), failures = [], errors = [];
  const page = await openGame(browser, PORT, 'sim', { viewport: { width: 360, height: 800 }, errors });
  // Plants a save that was away for `hours` with a measured rate, then reloads without letting the old page overwrite it.
  const away = async (hours, rate) => {
    await page.evaluate(([h, r]) => {
      const s = { ...window.__cr.state, version: 3, cash: 100, rate: r, savedAt: Date.now() - h * 3600e3, daily: { last: new Date().toLocaleDateString('en-CA'), streak: 1 } };
      Storage.prototype.setItem.call(localStorage, 'charge-ready-v2', JSON.stringify(s));
      Storage.prototype.setItem = () => {};
    }, [hours, rate]);
    await page.reload();
    await page.waitForFunction(() => window.__cr, null, { timeout: 10000 });
    await page.click('#startBtn');
    await page.waitForTimeout(300);
    return page.evaluate(() => ({ shown: !document.getElementById('welcome').hidden, amount: document.getElementById('welcomeAmount').textContent }));
  };
  // 1 h at $2/s pays 3600 × 2 × 0.5; 5 h is capped at 2 h.
  const one = await away(1, 2);
  const num = (t) => Number(t.replace(/[^0-9]/g, ''));
  if (!one.shown || Math.abs(num(one.amount) - 3600) > 5) failures.push(`1 h away: card ${JSON.stringify(one)}, expected +$3600`);
  const box = await page.evaluate(() => { const r = document.querySelector('#welcome .sheet').getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; });
  if (box[0] < 0 || box[1] > 360 || box[2] < 0 || box[3] > 800) failures.push(`welcome card leaves the 360×800 screen: ${box}`);
  await page.screenshot({ path: 'tools/screens/welcome.png' });
  await page.click('#welcomeDouble');
  const cash = await page.evaluate(() => window.__cr.state.cash);
  if (Math.abs(cash - 100 - 2 * num(one.amount)) > 1) failures.push(`×2 collect gave cash ${cash}, expected ${100 + 2 * num(one.amount)}`);
  const five = await away(5, 2);
  if (five.amount !== '+$7200') failures.push(`5 h away paid ${five.amount}, expected the 2 h cap +$7200`);
  // VIP trail: a fed VIP drops bills on the walk back and the player picks one up.
  const trail = await page.evaluate(() => {
    const g = window.__cr, s = g.state;
    document.getElementById('welcome').hidden = true;
    Object.assign(s, { spawned: 100, playSec: 1000 });
    let dropped = 0, picked = 0;
    for (let i = 0; i < 6000 && !picked; i++) {
      const bay = g.openBays()[0], d = bay.car?.driver;
      if (bay.car && !bay.car.vip) bay.car = null;
      if (d && d.phase === 'order') d.need = 0;
      g.update(0.05, { x: 0, y: 0 });
      dropped = Math.max(dropped, g.vipBills().length);
      if (dropped) { const b = g.vipBills()[0]; if (b) { const before = s.cash; g.player.g.position.copy(b.m.position).setY(0); g.update(0.05, { x: 0, y: 0 }); picked = s.cash - before; } }
    }
    return { dropped, picked };
  });
  if (!trail.dropped) failures.push('a fed VIP dropped no bills');
  if (!(trail.picked > 0)) failures.push('walking over a VIP bill paid nothing');
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  server.close();
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : `PASS (away pay = rate × time × 0.5, 2 h cap, ×2 collect, card fits 360 px, VIP trail ${trail.dropped} bills)`);
  process.exitCode = failures.length ? 1 : 0;
})();
