// Service check at the Highway Rest Stop: with the tire shop, repair garage and tow truck open, flagged customers must reach their shop,
// get served and pay, the tow truck must bring a car to the garage, the tire swap must make a sound, and screens are saved for review.
const path = require('path');
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = 8137, PLAY_SEC = 180, DT = 0.05, OUT = path.join(__dirname, 'out');

(async () => {
  const server = serve(PORT), browser = await launch(), failures = [], errors = [];
  const page = await openGame(browser, PORT, 'bot', { seed: 4, station: 'highway' });
  page.on('pageerror', (e) => errors.push(e.message));
  const r = await page.evaluate(([sec, dt]) => {
    const g = window.__cr, s = g.state, heard = {};
    g.audio.play = (n) => { heard[n] = (heard[n] ?? 0) + 1; };
    // Highway with stage 1 done, all bays open and the three shops built.
    Object.assign(s, { doneAt: 1, bays: 4, cash: 0 });
    ['tire', 'repair', 'tow'].forEach((k) => g.service.open(k));
    // The player stands on the tire spot the whole time; after a while the tow truck answers a call.
    let towed = false;
    for (let t = 0; t < sec; t += dt) {
      g.player.g.position.set(-3.6, 0, 17.8);
      g.update(dt, { x: 0, y: 0 });
      if (!towed && g.service.calls().length && g.service.tapTruck(0)) towed = true;
    }
    return { ledger: s.ledger, heard, towed, lines: g.service.lines() };
  }, [PLAY_SEC, DT]);
  for (const k of ['tire', 'repair', 'tow']) if (!(r.ledger[k] > 0)) failures.push(`no ${k} income in ${PLAY_SEC}s`);
  if (!r.heard.tool) failures.push('tire swap made no sound');
  if (!r.towed) failures.push('tow truck never went out');
  if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);

  for (const [x, z, name] of [[-3, 16, 'service-left'], [7, 16, 'service-right']]) {
    await page.evaluate(([x, z]) => { const g = window.__cr; g.player.g.position.set(x, 0, z); for (let i = 0; i < 20; i++) g.update(0.05, { x: 0, y: 0 }); document.querySelectorAll('#ticket,#siren,#toast,#stageUp,#done,#cityIntro,#jam').forEach((e) => { e.hidden = true; }); g.draw(0.016); }, [x, z]);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  await browser.close();
  server.close();
  console.log(`income: tire $${r.ledger.tire ?? 0}, repair $${r.ledger.repair ?? 0}, tow $${r.ledger.tow ?? 0}; sounds ${JSON.stringify(r.heard)}`);
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS (tire, repair, tow flows; screens saved to tools/out)');
  process.exitCode = failures.length ? 1 : 0;
})();
