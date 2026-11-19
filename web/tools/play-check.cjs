// Play check: bots play every station like a player and nothing may go wrong that a player would notice.
// Per station: money keeps coming, no NaN/undefined/null in the HUD, no page errors, drivers never walk through another bay's car,
// side orders get served, and at the airport nobody leaves the queue before a second bay is open. Also: an open sheet pauses the game.
const { serve, launch, openGame } = require('./harness.cjs');
const { PERSONAS } = require('./personas.cjs');
const PORT = 8141, SEC = 420, CHUNK = 30, DT = 0.05;

(async () => {
  const server = serve(PORT), browser = await launch(), failures = [], sides = { orders: 0, served: 0 };
  // Two seeds per station, so the side-order rate rests on enough orders to judge.
  for (const seed of [2, 3]) for (const station of ['town', 'highway', 'airport', 'hotel', 'mall']) {
    const errors = [], page = await openGame(browser, PORT, 'bot', { seed, station, errors });
    const P = PERSONAS.optimizer;
    const r = await page.evaluate(([st, pr, sec, chunk, dt, grant]) => {
      const g = window.__cr, s = g.state, out = { flat: 0, clip: 0, hud: [] };
      s.cash = grant;
      let last = s.earned;
      for (let t = 0; t < sec; t += chunk) {
        window.playBot(st, pr, t + chunk, dt, 1e9);
        if (s.earned <= last) out.flat++;
        last = s.earned;
        // A walking driver inside another bay's parked car box counts as clipping.
        const bays = g.openBays();
        for (const b of bays) {
          const d = b.car?.driver;
          if (!d?.g.parent || !d.path?.length) continue;
          for (const o of bays) if (o !== b && o.car && ['charge', 'plug'].includes(o.car.phase) && Math.abs(d.g.position.x - o.car.g.position.x) < 0.75 && Math.abs(d.g.position.z - o.car.g.position.z) < 1.3) out.clip++;
        }
        const text = document.body.innerText;
        if (/NaN|undefined|null|Infinity|\[object/.test(text)) out.hud.push(text.match(/.{0,30}(NaN|undefined|null|Infinity|\[object).{0,30}/)[0]);
      }
      const log = Object.fromEntries(g.log);
      out.left = log.queueleft ?? null;
      out.bay2 = log.bay2 ?? null;
      out.sideOrders = s.goalCount?.sideOrder ?? 0;
      out.sideServed = (s.goalCount?.side0 ?? 0) + (s.goalCount?.side1 ?? 0);
      // Orders still waiting at the table when the run stops are not counted as missed.
      out.sideOpen = g.openBays().filter((b) => b.car?.driver?.sideLeft).length;
      // Everyone walking the lot (player, staff, drivers) must end up the same size on screen.
      out.sizes = [];
      g.player.g.parent.traverse((o) => { if (o.userData.person && o.parent === g.player.g.parent && o.visible) out.sizes.push(+o.scale.y.toFixed(3)); });
      // Real proportions: measured person, parked car and charger, and parked cars must not touch each other.
      const parked = g.openBays().filter((b) => b.car && b.car.phase === 'charge'), plain = parked.filter((b) => !b.car.vip && !b.car.bus);
      const walker = g.openBays().map((b) => b.car?.driver?.g).find((d) => d?.parent);
      if (walker) out.person = g.size(walker).y;
      if (plain[0]) { const c = g.size(plain[0].car.g); out.car = { len: Math.max(c.x, c.z), h: c.y }; out.charger = g.size(plain[0].charger).y; }
      out.touch = parked.some((a) => parked.some((b) => a !== b && g.box(a.car.g).intersectsBox(g.box(b.car.g))));
      return out;
    }, [P.strategy, P, SEC, CHUNK, DT, station === 'town' ? 0 : 600]);
    if (r.flat > 1) failures.push(`${station}: no money came in for ${r.flat} of ${SEC / CHUNK} stretches`);
    if (r.clip) failures.push(`${station}: drivers walked through parked cars ${r.clip} times`);
    if (r.hud.length) failures.push(`${station}: HUD shows "${r.hud[0]}"`);
    if (r.car && r.person) {
      const ratio = (a, b) => (a / b).toFixed(2);
      if (r.person / r.car.h < 1.15 || r.person / r.car.h > 1.8) failures.push(`${station}: person is ${ratio(r.person, r.car.h)}× a car's height (want 1.15 to 1.8)`);
      if (r.car.len / r.person < 1.4 || r.car.len / r.person > 2.2) failures.push(`${station}: car is ${ratio(r.car.len, r.person)}× a person's height long (want 1.4 to 2.2)`);
      if (r.charger / r.person < 0.85 || r.charger / r.person > 1.4) failures.push(`${station}: charger is ${ratio(r.charger, r.person)}× a person (want 0.85 to 1.4)`);
    }
    if (r.touch) failures.push(`${station}: parked cars touch each other`);
    const sizes = [...new Set(r.sizes)];
    if (sizes.length !== 1) failures.push(`${station}: people have different sizes ${sizes.join(', ')}`);
    sides.orders += r.sideOrders - r.sideOpen;
    sides.served += r.sideServed;
    if (station === 'airport' && r.left !== null && (r.bay2 === null || r.left < r.bay2)) failures.push(`airport: a driver left the queue at ${r.left}s before the second bay (${r.bay2}s)`);
    if (errors.length) failures.push(`${station}: page errors: ${errors.slice(0, 2).join(' | ')}`);
    await page.close();
  }
  // Side orders are judged over all runs together, since one station alone sees only about ten.
  if (sides.served / sides.orders < 0.85) failures.push(`only ${sides.served} of ${sides.orders} finished side orders served`);
  // An open Upgrades sheet pauses the game clock.
  const page = await openGame(browser, PORT, 'sim', {});
  await page.click('#startBtn');
  await page.evaluate(() => { document.getElementById('welcome').hidden = true; document.getElementById('panel').hidden = false; });
  const t0 = await page.evaluate(() => window.__cr.state.playSec);
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => window.__cr.state.playSec);
  if (t1 !== t0) failures.push(`the game ran ${(t1 - t0).toFixed(1)}s behind an open sheet`);
  await browser.close();
  server.close();
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS (5 stations: steady income, clean HUD, no clipping, sides served, fair airport start; sheets pause the game)');
  process.exitCode = failures.length ? 1 : 0;
})();
