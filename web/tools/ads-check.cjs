// Ads and shop check: the test ad and shop cards, the half-paid pad finished by a rewarded ad, purchases that survive a reload,
// and break ads that respect the first minutes and the gap.
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = 8141;
(async () => {
  const server = serve(PORT), browser = await launch(), failures = [], errors = [];
  const fail = (m) => failures.push(m);
  // Real cards: ?ads turns off the bots' auto-watch.
  const page = await openGame(browser, PORT, 'sim&ads', { errors });
  await page.click('#startBtn');
  const visible = (id) => page.evaluate((i) => !document.getElementById(i).hidden, id);

  // Pad: half paid with no cash left, standing on it shows the ad button; the ad pays the rest and the pad is built.
  // The button waits while a toast is up, so the check first lets the opening line go, as a player would.
  await page.waitForFunction(() => document.getElementById('toast').hidden, null, { timeout: 15000 });
  const pad0 = await page.evaluate(() => { const g = window.__cr; const cost = g.padLeft(); Object.assign(g.state, { cash: 0, padPaid: Math.ceil(cost * 0.6) }); g.player.g.position.copy(g.padMesh.position); g.draw(0.016); return g.state.pad; });
  if (!(await visible('padAd'))) fail('pad ad button not shown on a half-paid pad');
  if (await visible('hint')) fail('hint shows under the pad ad button');
  await page.click('#padAd');
  if (!(await visible('adCard'))) fail('rewarded ad card did not open');
  if (!(await page.evaluate(() => document.getElementById('adYes').disabled))) fail('Collect is clickable before the test ad ends');
  const paused = await page.evaluate(() => { const t = window.__cr.state.playSec; return new Promise((r) => setTimeout(() => r(window.__cr.state.playSec === t), 500)); });
  if (!paused) fail('game keeps running behind the ad card');
  await page.waitForFunction(() => !document.getElementById('adYes').disabled, null, { timeout: 6000 });
  await page.click('#adYes');
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__cr.update(0.05, { x: 0, y: 0 }); });
  const pad1 = await page.evaluate(() => window.__cr.state.pad);
  if (pad1 !== pad0 + 1) fail(`pad not built after the ad (pad ${pad0} -> ${pad1})`);

  // Skipping a rewarded ad gives nothing.
  const skipped = await page.evaluate(async () => { const p = window.__cr.ads.rewarded('test'); document.getElementById('adNo').click(); return p; });
  if (skipped) fail('a skipped ad still paid out');

  // Shop: cancel buys nothing; buying the starter pack adds cash and No Ads, and both survive a reload.
  await page.click('#settingsBtn');
  await page.click('#shopNoAds');
  if (!(await visible('adCard'))) fail('No Ads card did not open from Settings');
  await page.click('#adNo');
  if (await page.evaluate(() => window.__cr.state.shop.noAds)) fail('cancelled No Ads was bought');
  const cash0 = await page.evaluate(() => window.__cr.state.cash);
  await page.click('#shopStarter');
  await page.click('#adYes');
  const after = await page.evaluate(() => ({ shop: window.__cr.state.shop, cash: window.__cr.state.cash, owned: document.getElementById('shopNoAds').textContent, row: document.getElementById('shopStarterRow').hidden }));
  if (!after.shop.starter || !after.shop.noAds) fail(`starter pack not applied: ${JSON.stringify(after.shop)}`);
  if (after.cash - cash0 !== 400) fail(`starter pack paid $${after.cash - cash0}, expected $400 at the town`);
  if (after.owned !== 'Owned ✓' || !after.row) fail('Settings still offers what was bought');
  await page.click('#settingsClose');
  await page.reload();
  await page.waitForFunction(() => window.__cr);
  const kept = await page.evaluate(() => window.__cr.state.shop);
  if (!kept.starter || !kept.noAds) fail(`purchase lost after reload: ${JSON.stringify(kept)}`);
  // With No Ads, a break ad never shows.
  await page.evaluate(() => window.__cr.ads.breakAd());
  if (await visible('adCard')) fail('break ad shown after No Ads');

  // Break ads: none before firstSec at the first station, then one, then none again within the gap.
  // Each case gets the browser to itself: pages left running slow the next one down until its taps time out.
  await page.close();
  const fresh = await openGame(browser, PORT, 'sim&ads', { errors });
  await fresh.click('#startBtn');
  const afterWarn = (p) => p.waitForTimeout(3600);
  const card = (p) => p.evaluate(() => !document.getElementById('adCard').hidden);
  await fresh.evaluate(() => window.__cr.adBreak());
  if (await card(fresh)) fail('break ad shown in the first minutes');
  await fresh.evaluate(() => { window.__cr.state.playSec = 310; window.__cr.state.shop.offered = true; window.__cr.adBreak(); });
  // The 3 s warning comes first, then the card.
  await fresh.waitForTimeout(200);
  if (!(await fresh.isVisible('#adWarn'))) fail('no warning before the break ad');
  if (await card(fresh)) fail('break ad card shown before the warning ended');
  await afterWarn(fresh);
  if (!(await card(fresh))) fail('no break ad after the first minutes');
  await fresh.waitForFunction(() => !document.getElementById('adYes').disabled, null, { timeout: 6000 });
  await fresh.click('#adYes');
  await fresh.evaluate(() => window.__cr.adBreak());
  if (await card(fresh)) fail('second break ad shown inside the gap');

  // The starter pack is offered once, after starterAfterSec, instead of a break ad.
  await fresh.close();
  const offer = await openGame(browser, PORT, 'sim&ads', { errors });
  await offer.click('#startBtn');
  await offer.evaluate(() => { window.__cr.state.playSec = 430; window.__cr.adBreak(); });
  await offer.waitForTimeout(200);
  const title = await offer.evaluate(() => document.getElementById('adTitle').textContent);
  if (!title.includes('Starter')) fail(`starter offer not shown (card: ${title})`);
  await offer.click('#adNo');
  await offer.evaluate(() => { window.__cr.adBreak(); });
  await afterWarn(offer);
  if ((await offer.evaluate(() => document.getElementById('adTitle').textContent)).includes('Starter')) fail('starter offer shown twice');

  // Android app: the page uses the app's AdMob bridge. A watched video pays, an unloaded one says so and pays nothing,
  // and a break ad shows the app's interstitial instead of the test card.
  await offer.close();
  const app = await openGame(browser, PORT, 'sim&ads', { errors, init: () => {
    window.__shown = [];
    window.ChargeReadyAds = { ready: (kind) => !(window.__noVideo && kind === 'rewarded'), show: (id, kind) => { window.__shown.push(kind); setTimeout(() => window.__adDone(id, kind === 'rewarded'), 100); } };
  } });
  await app.click('#startBtn');
  // Break ad first: any ad, rewarded too, starts the gap before the next break ad.
  await app.evaluate(() => { window.__cr.state.playSec = 310; window.__cr.state.shop.offered = true; window.__cr.state.shop.noAds = false; });
  await app.evaluate(() => { window.__cr.adBreak(); });
  await afterWarn(app);
  const shown = await app.evaluate(() => window.__shown);
  if (!shown.includes('interstitial')) fail(`no app interstitial for a break ad (shown: ${shown.join(', ')})`);
  if (!(await app.evaluate(() => window.__cr.ads.rewarded('test')))) fail('a video watched in the app did not pay');
  if (await app.evaluate(() => !document.getElementById('adCard').hidden)) fail('the test card showed in the app');
  await app.evaluate(() => { window.__noVideo = true; });
  const none = app.evaluate(() => window.__cr.ads.rewarded('test'));
  await app.waitForTimeout(200);
  const said = await app.evaluate(() => document.getElementById('adTitle').textContent);
  if (!said.includes('No video')) fail(`no "no video" note when none is loaded (card: ${said})`);
  await app.click('#adYes');
  if (await none) fail('an unloaded video still paid');
  await browser.close();
  server.close();
  if (errors.length) fail(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS (pad ad, skip, shop cancel and buy, reload, No Ads, break ad timing, starter once, app AdMob bridge)');
  process.exitCode = failures.length ? 1 : 0;
})();
