// Features check, one case per feature from the player research (claude/PLAYER_RESEARCH.md):
// visible upgrades: buying shows its before → after over the owner and a burst where it works;
// VoltMart: the rival's dare comes after firstSec, shows on screen, pays when won and stops after giveUp wins;
// regulars and the car album; daily tasks; the road-trip convoy; golden car, storm, blackout, outfit and save code.
const { serve, launch, openGame } = require('./harness.cjs');
const { PERSONAS } = require('./personas.cjs');

const PORT = 8179;
(async () => {
  const server = serve(PORT), browser = await launch(), failures = [], errors = [];
  const page = await openGame(browser, PORT, 'sim', { errors });
  await page.click('#startBtn');
  const fail = (m) => failures.push(m);

  // Visible upgrades.
  const up = await page.evaluate(() => {
    const g = window.__cr;
    g.state.cash = 5000;
    return ['tariff', 'capacity', 'speed'].map((k) => { g.buy(k); g.draw(0.05); return g.floats().at(-1) ?? ''; });
  });
  up.forEach((t, i) => { if (!/→/.test(t)) fail(`${['tariff', 'capacity', 'speed'][i]} upgrade showed no before → after (got "${t}")`); });

  // VoltMart: not before firstSec; then a van comes, the dare shows on screen, serving `need` cars wins a bonus, and after giveUp wins
  // it never comes back to this station.
  const rv = await page.evaluate(async () => {
    const { CONFIG } = await import('./config.js'), g = window.__cr, RV = CONFIG.rival, step = (n) => { for (let i = 0; i < n; i++) tick(i); };
    // Camera shots time out in draw(), so a draw every few steps lets them end as they would on screen.
    function tick(i) { g.update(0.05, { x: 0, y: 0 }); if (i % 10 === 9) g.draw(0.5); }
    g.state.playSec = 0;
    step(Math.floor((RV.firstSec - 10) / 0.05));
    const early = Boolean(g.rival());
    const rounds = [];
    // A turn lags the heading a moment, as any car's does; a van built sideways is never aligned.
    let moving = 0, aligned = 0;
    for (let w = 0; w < RV.giveUp + 1; w++) {
      g.state.playSec = Math.max(g.state.playSec, RV.firstSec);
      // While it drives in, the van's long side points the way it moves in most frames.
      for (let i = 0; i < 7000 && g.rival()?.phase !== 'dare'; i++) {
        const v = g.rival()?.g, from = v?.position.clone();
        tick(i);
        if (!v || g.rival()?.phase !== 'in') continue;
        const ry = v.rotation.y;
        v.rotation.y = 0; v.updateMatrixWorld();
        // The body alone: the roof sign spans the width and would square the box.
        const size = g.size(v.children[0]);
        v.rotation.y = ry; v.updateMatrixWorld();
        const step = v.position.clone().sub(from).setY(0), long = size.x >= size.z ? [Math.cos(ry), -Math.sin(ry)] : [Math.sin(ry), Math.cos(ry)];
        if (step.length() > 0.02) { moving++; if (Math.abs(long[0] * step.x + long[1] * step.z) / step.length() >= 0.9) aligned++; }
      }
      if (g.rival()?.phase !== 'dare') { rounds.push('none'); continue; }
      step(1);
      const bar = document.getElementById('rivalBar'), shown = !bar.hidden && /VoltMart/.test(bar.textContent);
      const cash = g.state.cash;
      g.state.served += CONFIG.rival.need; step(2);
      rounds.push({ shown, paid: g.state.cash - cash, wins: g.state.rival.wins });
      step(400);
    }
    return { early, rounds, sideways: moving > 0 && aligned / moving < 0.8, vanAligned: `${aligned}/${moving}` };
  });
  if (rv.early) fail('VoltMart came before firstSec');
  console.log(`info: van aligned in ${rv.vanAligned} moving frames`);
  if (rv.sideways) fail('the VoltMart van drove in sideways');
  rv.rounds.slice(0, 3).forEach((r, i) => {
    if (r === 'none') fail(`VoltMart round ${i + 1} never came`);
    else { if (!r.shown) fail(`round ${i + 1}: the dare was not on screen`); if (r.paid <= 0) fail(`round ${i + 1}: winning paid nothing`); if (r.wins !== i + 1) fail(`round ${i + 1}: wins ${r.wins}`); }
  });
  if (rv.rounds[3] !== 'none') fail('VoltMart came back after giving up');

  // Regulars and the car album, as a player meets them: two minutes of play with a bot brings named regulars and new models,
  // a regular's fifth visit leaves a gift, and the album fills up to a full-album bonus.
  const rg = await page.evaluate(async (pr) => {
    const { CONFIG } = await import('./config.js'), g = window.__cr, s = g.state;
    s.playSec = 0; s.album = []; s.regulars = {};
    window.playBot(pr.strategy, pr, s.playSec + 240, 0.05, 1e9);
    const seenRegulars = Object.values(s.regulars).reduce((a, b) => a + b, 0), albumNow = s.album.length;
    const who = CONFIG.regulars.people[0], at = g.player.g.position.clone(), cash0 = s.cash;
    s.regulars[who.name] = CONFIG.regulars.giftEvery - 1;
    g.regularVisit(who, at);
    const gift = s.cash - cash0;
    const cash1 = s.cash;
    for (const m of ['car_sedan', 'car_hatchback', 'car_taxi', 'limo', 'bus']) g.albumAdd(m, at);
    return { seenRegulars, albumNow, gift, fullPay: s.cash - cash1, album: s.album.length, text: document.getElementById('albumText').textContent };
  }, PERSONAS.engaged);
  if (rg.albumNow < 2) fail(`after 4 min of play the album holds only ${rg.albumNow} models`);
  if (rg.gift <= 0) fail('a regular\'s fifth visit left no gift');
  if (rg.album !== 5 || rg.fullPay <= 0) fail(`album did not fill and pay (${rg.album} models, paid ${rg.fullPay})`);
  console.log(`info: in 4 min of bot play ${rg.seenRegulars} regular visits and ${rg.albumNow} album models`);

  // Daily tasks: three for today, each pays once when done, listed under Today on the goals sheet.
  const dy = await page.evaluate(async () => {
    const { CONFIG } = await import('./config.js'), g = window.__cr;
    g.state.daily.tasks = null;
    const list = g.dailyTasks(), out = [];
    for (const t of list) {
      const def = CONFIG.daily.tasks.find((d) => d.kind === t.kind), cash = g.state.cash;
      for (let i = 0; i < def.goal + 2; i++) g.tally(t.kind === 'sides' ? 'side0' : t.kind);
      out.push({ kind: t.kind, paid: g.state.cash - cash, n: t.n, goal: def.goal });
    }
    document.getElementById('mission').click();
    const sheet = document.getElementById('goalRows').textContent;
    return { count: list.length, out, today: /Today/.test(sheet) };
  });
  if (dy.count !== 3) fail(`${dy.count} daily tasks instead of 3`);
  dy.out.forEach((t) => { if (t.paid <= 0) fail(`daily task ${t.kind} paid nothing`); if (t.n !== t.goal) fail(`daily task ${t.kind} counted past its goal (${t.n}/${t.goal})`); });
  if (!dy.today) fail('the goals sheet has no Today list');

  // Convoy: after firstSec a group of cars arrives at once, marked to pay double, and the police hold off.
  const cv = await page.evaluate(async () => {
    const { CONFIG } = await import('./config.js'), g = window.__cr;
    document.getElementById('goals').hidden = true;
    const before = g.queue.length;
    g.convoy.next = 0;
    for (let i = 0; i < 40 && g.queue.filter((c) => c.convoy).length === 0; i++) { g.update(0.05, { x: 0, y: 0 }); if (i % 10 === 9) g.draw(0.5); }
    return { convoy: g.queue.filter((c) => c.convoy).length, before };
  });
  if (cv.convoy !== 4) fail(`convoy brought ${cv.convoy} cars instead of 4`);

  // Golden car, storm, blackout and outfit, each forced to happen now.
  const ev = await page.evaluate(async () => {
    const { CONFIG } = await import('./config.js'), g = window.__cr, out = {};
    const tick = (n) => { for (let i = 0; i < n; i++) { g.update(0.05, { x: 0, y: 0 }); if (i % 10 === 9) g.draw(0.5); } };
    // The waiting line is cleared off the road too, so no driverless car is left blocking the lane.
    g.queue.splice(0).forEach((c) => c.g.parent?.remove(c.g));
    const keep = CONFIG.golden.chance; CONFIG.golden.chance = 1;
    tick(200);
    out.golden = g.openBays().some((b) => b.car?.golden) || g.queue.some((c) => c.golden);
    CONFIG.golden.chance = keep;
    // Storm.
    g.storm.next = 0; g.grid.next = 1e9;
    tick(2);
    out.stormOn = g.storm.on;
    // Cars joining the line are counted as they come, since the line also empties into free bays meanwhile.
    let joined = 0;
    const push = g.queue.push;
    g.queue.push = (...cars) => { joined += cars.length; return push.apply(g.queue, cars); };
    tick(Math.ceil(CONFIG.storm.carEverySec / 0.05) + 5);
    g.queue.push = push;
    out.stormCars = joined;
    tick(Math.ceil(CONFIG.storm.sec / 0.05) + 20);
    out.stormOver = !g.storm.on;
    // Blackout: chargers stop, standing on the generator brings the power back and pays.
    g.storm.next = 1e9;
    // The blackout is let in only while a car is charging, so there is a charge for it to stop.
    for (let i = 0; i < 4000 && !g.grid.out; i++) { g.grid.next = g.openBays().some((b) => b.car?.phase === 'charge') ? 0 : 1e9; tick(1); }
    out.gridOut = g.grid.out;
    out.bays = g.openBays().map((b) => b.car?.phase ?? '-').join(',');
    const charging = g.openBays().find((b) => b.car?.phase === 'charge')?.car, t0 = charging?.t;
    tick(20);
    out.paused = charging ? charging.t === t0 : 'no car';
    const cash = g.state.cash;
    if (g.grid.gen) g.player.g.position.copy(g.grid.gen.position);
    tick(Math.ceil(CONFIG.blackout.holdSec / 0.05) + 4);
    out.gridBack = !g.grid.out; out.gridPaid = g.state.cash - cash;
    // Outfit: with two album cars the outfit button cycles to a new colour on the clothes.
    g.state.album = ['car_sedan', 'car_taxi'];
    const before = g.outfitMeshes()[0]?.material.color.getHexString();
    document.getElementById('outfitBtn').click();
    out.outfitMeshes = g.outfitMeshes().length;
    out.outfitChanged = before !== g.outfitMeshes()[0]?.material.color.getHexString();
    return out;
  });
  if (!ev.golden) fail('a golden car never showed with chance 1');
  if (!ev.stormOn) fail('the storm did not start');
  if (ev.stormCars < 1) fail('no drivers rushed in during the storm');
  if (!ev.stormOver) fail('the storm did not end');
  if (!ev.gridOut) fail(`the blackout did not start (bays ${ev.bays})`);
  if (ev.paused !== true) fail(`charging did not stop in the blackout (${ev.paused})`);
  if (!ev.gridBack || ev.gridPaid <= 0) fail(`standing on the generator did not restore the power and pay (${ev.gridBack}, ${ev.gridPaid})`);
  if (!ev.outfitMeshes || !ev.outfitChanged) fail(`the outfit did not change (${ev.outfitMeshes} clothes meshes)`);

  // Save code: Copy gives a code, Load with it restarts on the same progress.
  await page.evaluate(() => { document.getElementById('settings').hidden = false; window.__cr.state.playSec = 777; window.__cr.save(); });
  await page.click('#codeCopy');
  await page.waitForTimeout(300);
  let code = await page.evaluate(() => document.getElementById('codeText').value);
  if (!code) code = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  if (!code) fail('Copy gave no save code');
  else {
    await page.evaluate(() => { window.__cr.state.playSec = 5; window.__cr.save(); const b = document.getElementById('codeText'); b.hidden = false; });
    await page.fill('#codeText', code);
    await Promise.all([page.waitForNavigation(), page.click('#codeLoad')]);
    await page.waitForFunction(() => window.__cr);
    const back = await page.evaluate(() => window.__cr.state.playSec);
    if (back < 770) fail(`Load did not bring the coded progress back (playSec ${back})`);
  }

  await browser.close();
  server.close();
  failures.push(...errors.map((e) => `page error: ${e}`));
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS features');
  process.exit(failures.length ? 1 : 0);
})();
