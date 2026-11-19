// Rescue check, the two things players of this genre hate most: getting stuck and losing progress.
// Unstuck puts the owner back at the start spot from anywhere. A save that gets wiped is offered back from the backup on the next
// start and Restore brings the play time back; Keep this one declines it; a deliberate two-tap Reset does not offer the old run.
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = 8177;
(async () => {
  const server = serve(PORT), browser = await launch(), failures = [], errors = [];
  const page = await openGame(browser, PORT, 'sim', { errors });
  const played = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('charge-ready-v2') ?? '{}'); return Object.values(s.stations ?? {}).reduce((t, st) => t + (st.playSec ?? 0), 0); });
  const reopen = async () => { await page.reload(); await page.waitForFunction(() => window.__cr); await page.click('#startBtn'); await page.waitForTimeout(400); };
  // The game saves as it unloads, so the wipe happens on another page of the same site, as storage loss would.
  const wipeAndReopen = async () => {
    await page.goto(`http://localhost:${PORT}/privacy.html`);
    await page.evaluate(() => localStorage.setItem('charge-ready-v2', JSON.stringify({ version: 5, active: 'town', stations: {} })));
    await page.goto(`http://localhost:${PORT}/?sim`);
    await page.waitForFunction(() => window.__cr);
    await page.click('#startBtn');
    await page.waitForTimeout(400);
  };
  try {
    await page.click('#startBtn');

    // Unstuck from a far corner.
    const spot = await page.evaluate(async () => {
      const { CONFIG } = await import('./config.js'), g = window.__cr;
      g.player.g.position.set(CONFIG.world.bounds[1], 0, CONFIG.world.bounds[2]);
      document.getElementById('settings').hidden = false;
      return CONFIG.world.playerSpawn;
    });
    await page.click('#unstuckBtn');
    const at = await page.evaluate(() => ({ x: window.__cr.player.g.position.x, z: window.__cr.player.g.position.z, open: !document.getElementById('settings').hidden }));
    if (Math.hypot(at.x - spot[0], at.z - spot[1]) > 0.1) failures.push(`Unstuck left the owner at ${at.x.toFixed(1)},${at.z.toFixed(1)}`);
    if (at.open) failures.push('Unstuck left Settings open');

    // Ten minutes of play reach the backup.
    await page.evaluate(() => { const g = window.__cr; for (let i = 0; i < 600; i++) { g.state.playSec += 1; if (i % 61 === 60) g.save(); } g.save(); });
    const before = await played();
    // The save gets wiped (as on the Claude page once); the next start must offer the backup and Restore must bring it back.
    await wipeAndReopen();
    if (!(await page.isVisible('#restore'))) failures.push('a wiped save was not offered back');
    else {
      await Promise.all([page.waitForNavigation(), page.click('#restoreYes')]);
      await page.waitForFunction(() => window.__cr);
      const after = await played();
      // The backup is at most backupSec behind the save.
      if (after < before - 60) failures.push(`Restore brought back ${Math.round(after)}s of ${Math.round(before)}s`);
    }

    // Declining keeps the current game and does not ask again.
    await wipeAndReopen();
    if (await page.isVisible('#restore')) {
      await page.click('#restoreNo');
      await page.evaluate(() => { const g = window.__cr; for (let i = 0; i < 70; i++) g.state.playSec += 1; g.save(); });
      await reopen();
      if (await page.isVisible('#restore')) failures.push('Keep this one was asked again on the next start');
    } else failures.push('the second wipe was not offered back');

    // A deliberate reset does not bring the old run back.
    await page.evaluate(() => { const g = window.__cr; for (let i = 0; i < 600; i++) g.state.playSec += 1; g.save(); document.getElementById('settings').hidden = false; });
    await page.click('#resetBtn');
    await page.waitForTimeout(700);
    await Promise.all([page.waitForNavigation(), page.click('#resetBtn')]);
    await page.waitForFunction(() => window.__cr);
    await page.click('#startBtn');
    await page.waitForTimeout(400);
    if (await page.isVisible('#restore')) failures.push('after a deliberate reset the old run was offered back');
  } catch (e) { failures.push(e.message.split('\n')[0]); }
  await browser.close();
  server.close();
  failures.push(...errors.map((e) => `page error: ${e}`));
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS (Unstuck, backup offered and restored, decline remembered, reset drops the backup)');
  process.exit(failures.length ? 1 : 0);
})();
