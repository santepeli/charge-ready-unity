// Reset check: progress is wiped only by two deliberate taps on Reset. A quick double tap, a second tap after the button disarmed,
// or a tap after closing and reopening Settings keeps the run; a second tap after a short pause resets it.
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = 8151;
(async () => {
  const server = serve(PORT), browser = await launch(), failures = [];
  const page = await openGame(browser, PORT, 'sim');
  try {
  await page.click('#startBtn');
  await page.evaluate(() => { window.__cr.state.cash = 4321; });
  // A reset reloads the page, so a wiped run shows as missing cash or a reload; either one ends the check with that reason.
  const kept = async (why) => { await page.waitForTimeout(300); if ((await page.evaluate(() => window.__cr?.state.cash).catch(() => null)) !== 4321) { failures.push(`run was reset by ${why}`); throw new Error('reset'); } };
  const open = () => page.evaluate(() => { document.getElementById('settings').hidden = false; });
  await open();
  await page.dblclick('#resetBtn');
  await kept('a quick double tap');
  await page.waitForTimeout(4500);
  await page.click('#resetBtn');
  await kept('a tap after the button disarmed');
  await page.click('#settingsClose');
  await open();
  await page.waitForTimeout(700);
  await page.click('#resetBtn');
  await kept('a tap after closing and reopening Settings');
  await page.waitForTimeout(700);
  await Promise.all([page.waitForNavigation(), page.click('#resetBtn')]);
  await page.waitForFunction(() => window.__cr);
  if ((await page.evaluate(() => window.__cr.state.cash)) === 4321) failures.push('two deliberate taps did not reset the run');
  } catch (e) { if (!failures.length) failures.push(e.message.split('\n')[0]); }
  await browser.close();
  server.close();
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS (double tap, disarm, reopen keep the run; two deliberate taps reset it)');
  process.exitCode = failures.length ? 1 : 0;
})();
