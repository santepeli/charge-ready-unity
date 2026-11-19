// Progress check: the save is one versioned object; nothing ever resets a station, older saves migrate, and travel keeps every station.
const { serve, launch, openGame } = require('./harness.cjs');
const PORT = 8138;

(async () => {
  const server = serve(PORT), browser = await launch(), failures = [], errors = [];
  const page = await openGame(browser, PORT, 'sim', { viewport: { width: 390, height: 844 }, errors });
  const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__cr, null, { timeout: 10000 }); };
  // Writes a save and stops the running game from overwriting it on the way out.
  const plant = (raw) => page.evaluate((raw) => { Storage.prototype.setItem.call(localStorage, 'charge-ready-v2', raw); Storage.prototype.setItem = () => {}; }, raw);
  await page.click('#startBtn');
  // The town with every stage built and maxed: one star opens the highway, and no pad appears that starts it over.
  const before = await page.evaluate(async () => {
    const { CONFIG } = await import('./config.js');
    const g = window.__cr, s = g.state;
    Object.assign(s, { doneAt: 1, served: 50, pad: CONFIG.pads.length, bays: 4, cash: 3645, mission: { i: 5, progress: 2 }, coffee: true, office: true, accounting: true, sides: [true, true] });
    ['mobile', 'wash'].forEach((k) => g[k].open());
    for (const grp of [CONFIG.upgrades, CONFIG.coffee.upgrades, CONFIG.mobile.upgrades, CONFIG.wash.upgrades]) Object.keys(grp).forEach((k) => { s.levels[k] = grp[k].maxLevel; });
    for (let i = 0; i < 40; i++) g.update(0.05, { x: 0, y: 0 });
    return { pad: g.currentPad()?.type ?? null, expansion: CONFIG.extras.order.includes(g.currentPad()?.type), cash: s.cash, mission: s.mission.i, wash: Boolean(s.wash), stars: g.stars(), badge: document.getElementById('city').classList.contains('new') };
  });
  // After the last stage only an expansion pad (Moto Park, Mini Mart, Air & Glass) may show.
  if (before.pad && !before.expansion) failures.push(`a "${before.pad}" pad appeared after the last stage`);
  if (before.stars[0] < 2) failures.push(`a fully built town has ${before.stars[0]} stars, expected 2`);
  if (!before.badge) failures.push('the station name shows no badge although the highway is open');
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  await reload();
  const after = await page.evaluate(() => { const s = window.__cr.state; return { cash: s.cash, mission: s.mission.i, wash: Boolean(s.wash), version: s.version }; });
  for (const k of ['mission', 'wash']) if (after[k] !== before[k]) failures.push(`after reload ${k} is ${after[k]}, expected ${before[k]}`);
  if (Math.abs(after.cash - before.cash) > 200) failures.push(`after reload cash is ${after.cash}, expected about ${before.cash}`);
  if (after.version !== 5) failures.push(`save version is ${after.version}, expected 5`);
  // The map lists both stations and travel keeps the wallet; the highway starts its own build, and going back finds the town as it was.
  await page.click('#startBtn');
  await page.evaluate(() => { document.getElementById('welcome').hidden = true; document.getElementById('city').click(); });
  const nodes = await page.$$eval('#chainRows .node', (n) => n.length);
  if (nodes < 2) failures.push(`the station map shows ${nodes} stations`);
  await page.click('[data-go="highway"]');
  await reload();
  const hw = await page.evaluate(() => { const g = window.__cr; return { id: g.station.id, cash: g.state.cash, pad: g.currentPad()?.type, wash: Boolean(g.state.wash), town: Boolean(g.chain().stations.town?.wash) }; });
  if (hw.id !== 'highway' || hw.pad !== 'bay' || hw.wash || !hw.town || Math.abs(hw.cash - before.cash) > 200) failures.push(`after travel: ${JSON.stringify(hw)}`);
  await page.evaluate(() => window.__cr.travel('town'));
  await reload();
  const back = await page.evaluate(() => { const g = window.__cr; return { id: g.station.id, wash: Boolean(g.state.wash), mission: g.state.mission.i }; });
  if (back.id !== 'town' || !back.wash || back.mission !== before.mission) failures.push(`back in town: ${JSON.stringify(back)}`);
  // A version 2 save loads with its progress and without the retired "complete" flag.
  await plant(JSON.stringify({ cash: 900, pad: 6, bays: 4, doneAt: 10, coffee: true, cityDone: 400, mission: { i: 3, progress: 1 }, levels: { tariff: 2 } }));
  await reload();
  const v2 = await page.evaluate(() => { const s = window.__cr.state; return { coffee: s.coffee, mission: s.mission.i, tariff: s.levels.tariff, cityDone: s.cityDone, version: s.version, cash: s.cash }; });
  if (!v2.coffee || v2.mission !== 3 || v2.tariff !== 2 || v2.cityDone || v2.version !== 5 || v2.cash !== 900) failures.push(`version 2 save migrated wrong: ${JSON.stringify(v2)}`);
  // A version 3 save that owns the tire shop moves it with its upgrades to the highway; the town keeps everything else.
  await plant(JSON.stringify({ version: 3, cash: 500, pad: 6, bays: 4, doneAt: 10, coffee: true, service: { tire: { cash: 0 } }, levels: { tariff: 3, tireSpeed: 2 } }));
  await reload();
  const v3 = await page.evaluate(() => { const g = window.__cr, hw = g.chain().stations.highway; return { town: g.station.id, tire: Boolean(g.state.service?.tire), tariff: g.state.levels.tariff, hwTire: Boolean(hw?.service?.tire), hwLevel: hw?.levels?.tireSpeed }; });
  if (v3.town !== 'town' || v3.tire || v3.tariff !== 3 || !v3.hwTire || v3.hwLevel !== 2) failures.push(`version 3 save migrated wrong: ${JSON.stringify(v3)}`);
  // The player whose shops moved is told once, and the highway starts with the town's charging and diner build so nothing must be redone.
  await page.click('#startBtn');
  const told = await page.evaluate(() => !document.getElementById('notice').hidden);
  if (!told) failures.push('no notice that the shops moved to the highway');
  await page.evaluate(() => { document.getElementById('welcome').hidden = true; });
  await page.click('#noticeGo');
  await reload();
  const hw3 = await page.evaluate(() => { const g = window.__cr; for (let i = 0; i < 20; i++) g.update(0.05, { x: 0, y: 0 }); return { id: g.station.id, tariff: g.state.levels.tariff, tire: g.state.levels.tireSpeed, bays: g.state.bays, done: g.state.doneAt, notice: g.state.notice }; });
  if (hw3.id !== 'highway' || hw3.tariff !== 3 || hw3.tire !== 2 || hw3.bays !== 4 || hw3.done == null || hw3.notice) failures.push(`moved shops' highway not ready: ${JSON.stringify(hw3)}`);
  // A broken save is copied to a backup key before the game starts fresh.
  await plant('{broken');
  await reload();
  const backups = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('charge-ready-v2-backup')).length);
  if (!backups) failures.push('a broken save was dropped without a backup');
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  server.close();
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS (one save; no reset pad; town stars open the highway; travel keeps both stations; v2 and v3 migrate; broken save backed up)');
  process.exitCode = failures.length ? 1 : 0;
})();
